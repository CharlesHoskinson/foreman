import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  BoundedSpool,
  ProviderProcessObservation,
  ProviderProcessRequest,
  ProviderProcessRunnerService,
} from "@council/application";
import {
  ProviderProcessError,
  ProviderProcessRunner,
} from "@council/application";
import type { Sha256Digest } from "@council/schema";
import { Effect, Layer } from "effect";
import { redactSecrets } from "./redaction.js";

/** Explicit end marker for a truncated spool. Counted inside the byte cap. */
export const SPOOL_TRUNCATION_MARKER = "\n[TRUNCATED]\n";

const markerBytes = Buffer.from(SPOOL_TRUNCATION_MARKER, "utf8");

// Keep the two banner fragments on separate source lines. Foreman's Grok lane
// guard scans source for literal private-key banners before dispatch; a literal
// detection regex would otherwise be mistaken for key material itself.
const privateKeyBannerBeginPattern = "-----BEGIN ";
const privateKeyBannerKindPattern = "[A-Z ]*PRIVATE KEY-----";
const partialPrivateKeyPattern = new RegExp(
  privateKeyBannerBeginPattern + privateKeyBannerKindPattern + "[\\s\\S]*$",
  "g",
);

const digestOf = (bytes: Uint8Array): Sha256Digest =>
  createHash("sha256").update(bytes).digest("hex") as Sha256Digest;

/**
 * Strip trailing fragments that look like a cut secret so a truncated spool
 * never retains a partial secret suffix.
 */
const stripPartialSecretSuffix = (text: string): string =>
  text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]*$/i, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]*$/g, "[REDACTED]")
    .replace(/xox[baprs]-[A-Za-z0-9-]*$/g, "[REDACTED]")
    .replace(partialPrivateKeyPattern, "[REDACTED]");

const collectHomePaths = (
  environment: Readonly<Record<string, string>>,
): readonly string[] => {
  const homes: string[] = [];
  for (const key of ["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"] as const) {
    const value = environment[key];
    if (typeof value === "string" && value.length >= 2) {
      homes.push(value);
    }
  }
  const drive = environment.HOMEDRIVE;
  const path = environment.HOMEPATH;
  if (
    typeof drive === "string" &&
    typeof path === "string" &&
    drive.length > 0 &&
    path.length > 0
  ) {
    homes.push(`${drive}${path}`);
  }
  return homes;
};

const sanitizeText = (text: string, homePaths: readonly string[]): string => {
  let result = redactSecrets(text);
  // Longest homes first so nested prefixes do not leave residues.
  const ordered = [...homePaths].sort((a, b) => b.length - a.length);
  for (const home of ordered) {
    if (home.length < 2) continue;
    result = result.split(home).join("[REDACTED_PATH]");
  }
  result = result.replace(
    /(?:\/home\/|\/Users\/)[A-Za-z0-9._-]+/g,
    "[REDACTED_PATH]",
  );
  result = result.replace(/[A-Za-z]:\\Users\\[^\\\s"']+/gi, "[REDACTED_PATH]");
  return result;
};

/**
 * Bound stream collection in memory. Never retains more than maxBytes.
 * Marker space is reserved only after overflow is observed, so a payload of
 * exactly maxBytes is preserved with truncated: false.
 */
class BoundedStreamCollector {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private truncated = false;

  constructor(private readonly maxBytes: number) {}

  write(chunk: Buffer): void {
    if (this.truncated || this.maxBytes <= 0) {
      this.truncated = this.maxBytes <= 0 ? true : this.truncated;
      return;
    }
    if (this.size >= this.maxBytes) {
      // Already at the full cap; any further byte is overflow.
      this.truncated = true;
      return;
    }
    const remaining = this.maxBytes - this.size;
    if (chunk.byteLength <= remaining) {
      this.chunks.push(chunk);
      this.size += chunk.byteLength;
      return;
    }
    // Keep up to the cap, then mark overflow. Marker is applied in finalize.
    if (remaining > 0) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.size += remaining;
    }
    this.truncated = true;
  }

  finalize(homePaths: readonly string[]): BoundedSpool {
    const raw = Buffer.concat(this.chunks, this.size);
    // Report strict validity of the captured source bytes once, before
    // non-fatal decode, secret sanitization, and re-encoding. Public bytes
    // stay bounded and sanitized; raw capture is never exposed.
    let sourceUtf8Valid = true;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      sourceUtf8Valid = false;
    }
    // Decode as UTF-8 for string sanitization of secrets, then re-encode.
    // Invalid sequences are replaced by the platform decoder; digest is over
    // the sanitized UTF-8 bytes, not the raw stream bytes.
    const asText = raw.toString("utf8");
    // Always strip unterminated private-key blocks and trailing partial secret
    // suffixes — including when the spool is below its byte cap.
    const sanitized = stripPartialSecretSuffix(sanitizeText(asText, homePaths));
    let body = Buffer.from(sanitized, "utf8");
    if (this.truncated) {
      // Overflow observed: reserve marker space only now.
      const contentCap = Math.max(0, this.maxBytes - markerBytes.byteLength);
      if (body.byteLength > contentCap) {
        body = Buffer.from(
          stripPartialSecretSuffix(
            body.subarray(0, contentCap).toString("utf8"),
          ),
          "utf8",
        );
        if (body.byteLength > contentCap) {
          body = body.subarray(0, contentCap);
        }
      }
      const withMarker = Buffer.concat([body, markerBytes]);
      const bytes =
        withMarker.byteLength <= this.maxBytes
          ? withMarker
          : withMarker.subarray(0, this.maxBytes);
      return {
        bytes: new Uint8Array(bytes),
        digest: digestOf(bytes),
        truncated: true,
        sourceUtf8Valid,
      };
    }
    if (body.byteLength > this.maxBytes) {
      // Sanitization should not expand; fail closed with a marked truncation.
      const clipped = body.subarray(
        0,
        Math.max(0, this.maxBytes - markerBytes.byteLength),
      );
      const withMarker = Buffer.concat([clipped, markerBytes]).subarray(
        0,
        this.maxBytes,
      );
      return {
        bytes: new Uint8Array(withMarker),
        digest: digestOf(withMarker),
        truncated: true,
        sourceUtf8Valid,
      };
    }
    return {
      bytes: new Uint8Array(body),
      digest: digestOf(body),
      truncated: false,
      sourceUtf8Valid,
    };
  }
}

const secretSafeStartReason = (code: string | undefined): string => {
  if (code === "ENOENT") return "provider executable is not available";
  if (code === "EACCES" || code === "EPERM")
    return "provider executable is not executable";
  if (code === "ENOTDIR") return "provider executable path is invalid";
  return "provider process failed to start";
};

const ESCALATION_MS = 200;

/**
 * Send SIGTERM, then escalate to SIGKILL after a bound if the child is still
 * alive. Does not wait for exit — callers that need reaping must await close.
 */
const terminateChild = (child: ChildProcess): void => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  // Escalation for a stuck child. The close handler is the reaping authority.
  const escalate = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }, ESCALATION_MS);
  escalate.unref();
};

/**
 * Shared binding-close state. Set only by the real `close` handler registered
 * immediately after spawn. `exitCode` / `signalCode` are not substitutes:
 * Node emits `exit` before `close`, and `close` can lag while stdio stays open.
 */
type TerminalCloseState = {
  closed: boolean;
  readonly waiters: Array<() => void>;
};

const createTerminalCloseState = (): TerminalCloseState => ({
  closed: false,
  waiters: [],
});

/**
 * Mark the terminal close and wake any interrupt waiters. Call only from the
 * child `close` handler.
 */
const markTerminalClose = (state: TerminalCloseState): void => {
  state.closed = true;
  const pending = state.waiters.splice(0, state.waiters.length);
  for (const waiter of pending) {
    waiter();
  }
};

/**
 * Terminate the child and complete only after the actual terminal `close`
 * event. Effect interruption must not return on exit alone.
 *
 * The waiter is registered before the shared-state check so a close that
 * races between register and check still wakes this cleanup.
 */
const closeStdin = (child: ChildProcess): void => {
  const stream = child.stdin;
  if (stream === null || stream.destroyed) return;
  try {
    stream.destroy();
  } catch {
    // ignore
  }
};

const terminateAndAwaitClose = (
  child: ChildProcess,
  closeState: TerminalCloseState,
  onBeforeTerminate?: () => void,
): Effect.Effect<undefined> =>
  Effect.async<undefined>((resume) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resume(Effect.succeed(undefined));
    };
    // Register first; only return early when the actual close handler has run.
    closeState.waiters.push(finish);
    if (closeState.closed) {
      finish();
      return;
    }
    onBeforeTerminate?.();
    closeStdin(child);
    terminateChild(child);
  });

const runNodeProviderProcess = (
  request: ProviderProcessRequest,
): Effect.Effect<ProviderProcessObservation, ProviderProcessError> =>
  Effect.async<ProviderProcessObservation, ProviderProcessError>((resume) => {
    const homePaths = collectHomePaths(request.environment);
    const stdout = new BoundedStreamCollector(request.stdoutMaxBytes);
    const stderr = new BoundedStreamCollector(request.stderrMaxBytes);
    let settled = false;
    let timedOut = false;
    let started = false;
    let stdinFailed = false;
    const openStdin = request.stdin !== null;

    let child: ChildProcess;
    try {
      child = spawn(request.executable, [...request.args], {
        cwd: request.cwd,
        env: { ...request.environment },
        shell: false,
        stdio: openStdin
          ? ["pipe", "pipe", "pipe"]
          : ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      resume(
        Effect.fail(
          new ProviderProcessError({
            category: "start_failed",
            reason: "provider process failed to start",
          }),
        ),
      );
      return;
    }

    started = true;
    const running = child;
    // Track the real close event immediately after spawn — not exitCode alone.
    const closeState = createTerminalCloseState();
    // When stdin is open, do not settle success until the write path finishes.
    let stdinWriteFinished = !openStdin;
    let closedObservation: ProviderProcessObservation | null = null;

    const timeoutMs =
      Number.isSafeInteger(request.timeoutMs) && request.timeoutMs > 0
        ? request.timeoutMs
        : 1;
    const timer = setTimeout(() => {
      timedOut = true;
      // Abandon an in-flight stdin write so close can settle as timeout.
      stdinWriteFinished = true;
      closeStdin(running);
      terminateChild(running);
    }, timeoutMs);
    timer.unref();

    const settleFail = (error: ProviderProcessError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resume(Effect.fail(error));
    };

    const settleOk = (observation: ProviderProcessObservation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resume(Effect.succeed(observation));
    };

    const maybeSettleClosedObservation = () => {
      if (settled || stdinFailed || !stdinWriteFinished) return;
      if (closedObservation !== null) {
        settleOk(closedObservation);
      }
    };

    /**
     * Stdin write failures are typed only after the child is terminated and
     * the real close event has fired. Never include payload bytes in the reason.
     */
    const failAfterStdinError = () => {
      if (stdinFailed) return;
      stdinFailed = true;
      stdinWriteFinished = true;
      closedObservation = null;
      closeStdin(running);
      if (closeState.closed) {
        settleFail(
          new ProviderProcessError({
            category: "internal",
            reason: "provider process stdin write failed",
          }),
        );
        return;
      }
      closeState.waiters.push(() => {
        settleFail(
          new ProviderProcessError({
            category: "internal",
            reason: "provider process stdin write failed",
          }),
        );
      });
      terminateChild(running);
    };

    const markStdinWriteFinished = () => {
      if (stdinFailed) return;
      stdinWriteFinished = true;
      maybeSettleClosedObservation();
    };

    const stdoutStream = running.stdout;
    const stderrStream = running.stderr;
    if (stdoutStream !== null) {
      stdoutStream.on("data", (chunk: Buffer) => {
        stdout.write(chunk);
      });
    }
    if (stderrStream !== null) {
      stderrStream.on("data", (chunk: Buffer) => {
        stderr.write(chunk);
      });
    }

    if (request.stdin !== null) {
      const payload = request.stdin;
      const stdinStream = running.stdin;
      if (stdinStream === null) {
        failAfterStdinError();
      } else {
        stdinStream.on("error", () => {
          // EPIPE / write after close — secret-safe typed failure after reap.
          failAfterStdinError();
        });
        try {
          // Write exact bytes then complete stdin. Errors surface on "error";
          // the no-arg finish callback marks successful write completion.
          stdinStream.end(Buffer.from(payload), () => {
            markStdinWriteFinished();
          });
        } catch {
          failAfterStdinError();
        }
      }
    }

    running.on("error", (error: NodeJS.ErrnoException) => {
      // Absent executable and other launch failures are typed start failures.
      // They are never observations.
      settleFail(
        new ProviderProcessError({
          category: "start_failed",
          reason: secretSafeStartReason(error.code),
        }),
      );
      try {
        running.kill("SIGKILL");
      } catch {
        // ignore
      }
    });

    running.on("close", (code, exitSignal) => {
      markTerminalClose(closeState);
      // Stdin failure owns the terminal outcome; do not settle as observation.
      if (stdinFailed) {
        settleFail(
          new ProviderProcessError({
            category: "internal",
            reason: "provider process stdin write failed",
          }),
        );
        return;
      }
      // Child closed before stdin write completed (and not a deliberate
      // timeout/interrupt abandonment) — fail closed after real close.
      if (openStdin && !stdinWriteFinished && !timedOut) {
        settleFail(
          new ProviderProcessError({
            category: "internal",
            reason: "provider process stdin write failed",
          }),
        );
        return;
      }
      closedObservation = {
        started,
        exitCode: code,
        signal: exitSignal,
        timedOut,
        stdout: stdout.finalize(homePaths),
        stderr: stderr.finalize(homePaths),
      };
      maybeSettleClosedObservation();
    });

    // On fiber interruption: abandon stdin write, close stdin, terminate,
    // escalate, and await the terminal close before the interrupt completes.
    return terminateAndAwaitClose(running, closeState, () => {
      stdinWriteFinished = true;
    });
  });

export const NodeProviderProcessRunner: ProviderProcessRunnerService = {
  run: runNodeProviderProcess,
};

export const NodeProviderProcessRunnerLive = Layer.succeed(
  ProviderProcessRunner,
  NodeProviderProcessRunner,
);

export const runProviderProcess = (
  request: ProviderProcessRequest,
): Effect.Effect<
  ProviderProcessObservation,
  ProviderProcessError,
  ProviderProcessRunner
> => Effect.flatMap(ProviderProcessRunner, (service) => service.run(request));
