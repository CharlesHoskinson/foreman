/**
 * Effect services for queue admission: process execution, sleep, path
 * resolution, and bounded file reads. Tests inject deterministic layers.
 */

import { Context, Effect, Layer } from "effect";
import { spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { delimiter, join } from "node:path";

/** Default bound for captured child stdout+stderr combined. */
export const MAX_CAPTURE_BYTES = 1_048_576;

/** Bound for pueue config file reads. */
export const MAX_CONFIG_BYTES = 1_048_576;

/** Readiness status probe wall-clock bound. */
export const TIMEOUT_STATUS_PROBE_MS = 1_000;

/**
 * Daemon start, group configuration, admission, public status, and kill
 * wall-clock bound.
 */
export const TIMEOUT_QUEUE_OP_MS = 10_000;

export type CapturedProcessResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type ProcessFailureReason =
  | "spawn_failed"
  | "timeout"
  | "output_bound"
  | "cancelled";

export class ProcessFailure {
  readonly _tag = "ProcessFailure" as const;
  constructor(readonly reason: ProcessFailureReason) {}
}

export type RunCapturedOptions = {
  readonly command: string;
  readonly args: readonly string[];
  readonly maxOutputBytes?: number;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  /** Optional working directory. When absent, inherits the parent cwd. */
  readonly cwd?: string;
};

export type RunForegroundOptions = {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  /** Optional working directory. When absent, inherits the parent cwd. */
  readonly cwd?: string;
};

/**
 * Spawn a short-lived launcher (e.g. `pueued -d`) with all standard streams
 * ignored so a daemonized child cannot retain capture pipes. Waits for the
 * launcher process to exit. Returns a closed typed result with empty streams.
 */
export type RunIgnoredStdioOptions = {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  /** Optional working directory. When absent, inherits the parent cwd. */
  readonly cwd?: string;
};

/** Maximum wait for an owned child to close after cancellation (milliseconds). */
export const OWNED_CHILD_CANCEL_WAIT_MS = 5_000;

export class ProcessExec extends Context.Tag("ProcessExec")<
  ProcessExec,
  {
    readonly runCaptured: (
      opts: RunCapturedOptions,
    ) => Effect.Effect<CapturedProcessResult, ProcessFailure>;
    /**
     * Run a process with stdin/stdout/stderr ignored. Wait for exit. On
     * timeout, terminate only the owned launcher process or process group.
     * stdout and stderr in the success result are always empty strings.
     */
    readonly runIgnoredStdio: (
      opts: RunIgnoredStdioOptions,
    ) => Effect.Effect<CapturedProcessResult, ProcessFailure>;
    readonly runForeground: (
      opts: RunForegroundOptions,
    ) => Effect.Effect<number, ProcessFailure>;
  }
>() {}

export class Sleeper extends Context.Tag("Sleeper")<
  Sleeper,
  {
    readonly sleep: (ms: number) => Effect.Effect<void>;
  }
>() {}

export class PathLookup extends Context.Tag("PathLookup")<
  PathLookup,
  {
    /** Resolve an executable on PATH (command -v style). */
    readonly which: (name: string) => Effect.Effect<string | null>;
    /** True when path exists as a regular file (for MSYS .exe sibling). */
    readonly fileExists: (path: string) => Effect.Effect<boolean>;
    /** True when path is executable. */
    readonly isExecutable: (path: string) => Effect.Effect<boolean>;
  }
>() {}

/**
 * Closed result for a bounded config read. Callers must not collapse these
 * into a single null.
 */
export type BoundedReadResult =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Ok"; readonly text: string }
  | { readonly _tag: "Oversized" }
  | { readonly _tag: "Unreadable" }
  | { readonly _tag: "MalformedUtf8" }
  | { readonly _tag: "IdentityChanged" };

export class BoundedFs extends Context.Tag("BoundedFs")<
  BoundedFs,
  {
    readonly readFileBounded: (
      path: string,
      maxBytes: number,
    ) => Effect.Effect<BoundedReadResult>;
  }
>() {}

export class EnvVars extends Context.Tag("EnvVars")<
  EnvVars,
  {
    readonly get: (name: string) => Effect.Effect<string | undefined>;
    readonly home: () => Effect.Effect<string | undefined>;
  }
>() {}

export type QueueIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export const liveSleeper = Layer.succeed(Sleeper, {
  sleep: (ms) =>
    Effect.async<void>((resume) => {
      const t = setTimeout(() => resume(Effect.void), ms);
      return Effect.sync(() => {
        clearTimeout(t);
      });
    }),
});

export const liveEnvVars = Layer.succeed(EnvVars, {
  get: (name) => Effect.sync(() => process.env[name]),
  home: () => Effect.sync(() => process.env.HOME ?? process.env.USERPROFILE),
});

function pathIsExecutable(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    try {
      // Windows: X_OK may not apply; existence of a file is enough.
      accessSync(path, fsConstants.F_OK);
      return existsSync(path);
    } catch {
      return false;
    }
  }
}

export const livePathLookup = Layer.succeed(PathLookup, {
  which: (name) =>
    Effect.sync(() => {
      const pathEnv = process.env.PATH ?? "";
      const exts =
        process.platform === "win32"
          ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT")
              .split(";")
              .filter((e) => e.length > 0)
          : [""];
      for (const dir of pathEnv.split(delimiter)) {
        if (!dir) continue;
        for (const ext of exts) {
          const candidate = join(dir, name + ext);
          if (pathIsExecutable(candidate)) {
            return candidate;
          }
        }
        // MSYS-style: bare name without suffix when .exe sibling exists later
        const bare = join(dir, name);
        if (pathIsExecutable(bare)) {
          return bare;
        }
      }
      return null;
    }),
  fileExists: (path) => Effect.sync(() => existsSync(path)),
  isExecutable: (path) => Effect.sync(() => pathIsExecutable(path)),
});

function isNotFoundError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "ENOENT"
  );
}

export function readFileBoundedSync(
  path: string,
  maxBytes: number,
): BoundedReadResult {
  let fd: number | undefined;
  try {
    let before;
    try {
      before = statSync(path);
    } catch (e) {
      if (isNotFoundError(e)) return { _tag: "Absent" };
      return { _tag: "Unreadable" };
    }
    if (!before.isFile()) {
      return { _tag: "Unreadable" };
    }

    fd = openSync(path, fsConstants.O_RDONLY);
    const opened = fstatSync(fd);
    if (
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      opened.size !== before.size
    ) {
      return { _tag: "IdentityChanged" };
    }

    const cap = maxBytes + 1;
    const buf = Buffer.allocUnsafe(cap);
    let offset = 0;
    while (offset < cap) {
      const n = readSync(fd, buf, offset, cap - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    if (offset > maxBytes) {
      return { _tag: "Oversized" };
    }

    let afterOpen;
    try {
      afterOpen = fstatSync(fd);
    } catch {
      return { _tag: "IdentityChanged" };
    }
    if (
      afterOpen.ino !== opened.ino ||
      afterOpen.dev !== opened.dev ||
      afterOpen.size !== opened.size ||
      afterOpen.mtimeMs !== opened.mtimeMs
    ) {
      return { _tag: "IdentityChanged" };
    }

    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        buf.subarray(0, offset),
      );
      return { _tag: "Ok", text };
    } catch {
      return { _tag: "MalformedUtf8" };
    }
  } catch (e) {
    if (isNotFoundError(e)) return { _tag: "Absent" };
    return { _tag: "Unreadable" };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

export const liveBoundedFs = Layer.succeed(BoundedFs, {
  readFileBounded: (path, maxBytes) =>
    Effect.sync(() => readFileBoundedSync(path, maxBytes)),
});

/**
 * Terminate an owned child. On POSIX, kill the process group when the child
 * was spawned into its own group. On Windows, use the strongest portable
 * Node kill on the child handle. Idempotent.
 */
export function terminateOwnedChild(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") {
      child.kill();
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore — already reaped or never started */
  }
}

function spawnOptsBase(opts: {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly stdio: "inherit" | readonly ["ignore", "pipe", "pipe"] | readonly ["ignore", "ignore", "ignore"];
  readonly detached: boolean;
}): Parameters<typeof spawn>[2] {
  const base: Parameters<typeof spawn>[2] = {
    env: opts.env ?? process.env,
    stdio: opts.stdio as "inherit",
    windowsHide: true,
    detached: opts.detached,
  };
  if (opts.cwd !== undefined) {
    base.cwd = opts.cwd;
  }
  return base;
}

/**
 * Finalizer: kill owned child and observe close within the cancel wait bound.
 * An exit or signal code alone is not a close observation — only the `close`
 * event (or the wait bound) completes the finalizer.
 * Does not resume the outer Effect (interrupt ownership stays with Effect).
 */
function cancelOwnedFinalizer(child: ChildProcess): Effect.Effect<void> {
  return Effect.async<void>((resume) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resume(Effect.void);
    };
    const timer = setTimeout(finish, OWNED_CHILD_CANCEL_WAIT_MS);
    // Register close first. Exit/signal alone must not finish the finalizer.
    child.once("close", () => {
      clearTimeout(timer);
      finish();
    });
    // Never started: no pid means there is no child to observe.
    if (child.pid === undefined) {
      clearTimeout(timer);
      finish();
      return;
    }
    terminateOwnedChild(child);
  });
}

function runCapturedOwned(
  opts: RunCapturedOptions,
): Effect.Effect<CapturedProcessResult, ProcessFailure> {
  return Effect.async<CapturedProcessResult, ProcessFailure>((resume) => {
    // Declare timer and child before settle / spawn catch so a synchronous
    // spawn failure never reads them in the TDZ (ReferenceError defect).
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let child: ChildProcess | undefined;

    const settle = (
      outcome: Effect.Effect<CapturedProcessResult, ProcessFailure>,
    ) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resume(outcome);
    };

    const maxBytes = opts.maxOutputBytes ?? MAX_CAPTURE_BYTES;
    const useGroup = process.platform !== "win32";
    try {
      child = spawn(
        opts.command,
        [...opts.args],
        spawnOptsBase({
          command: opts.command,
          args: opts.args,
          ...(opts.env !== undefined ? { env: opts.env } : {}),
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          stdio: ["ignore", "pipe", "pipe"],
          detached: useGroup,
        }),
      );
    } catch {
      settle(Effect.fail(new ProcessFailure("spawn_failed")));
      return;
    }

    const owned = child;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let total = 0;
    let timedOut = false;
    let outputBound = false;

    const onData = (target: Buffer[], chunk: Buffer) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > maxBytes) {
        outputBound = true;
        terminateOwnedChild(owned);
        settle(Effect.fail(new ProcessFailure("output_bound")));
        return;
      }
      target.push(chunk);
    };

    owned.stdout?.on("data", (c: Buffer) => onData(stdoutChunks, c));
    owned.stderr?.on("data", (c: Buffer) => onData(stderrChunks, c));

    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        terminateOwnedChild(owned);
      }, opts.timeoutMs);
    }

    owned.on("error", () => {
      settle(Effect.fail(new ProcessFailure("spawn_failed")));
    });

    owned.on("close", (code) => {
      if (settled) return;
      if (outputBound) {
        settle(Effect.fail(new ProcessFailure("output_bound")));
        return;
      }
      if (timedOut) {
        settle(Effect.fail(new ProcessFailure("timeout")));
        return;
      }
      settle(
        Effect.succeed({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
        }),
      );
    });

    return Effect.suspend(() => {
      if (settled) return Effect.void;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      return cancelOwnedFinalizer(owned);
    });
  });
}

function runForegroundOwned(
  opts: RunForegroundOptions,
): Effect.Effect<number, ProcessFailure> {
  return Effect.async<number, ProcessFailure>((resume) => {
    // Declare child before settle / spawn catch so synchronous spawn
    // exceptions remain typed ProcessFailure, never a TDZ defect.
    let settled = false;
    let child: ChildProcess | undefined;

    const settle = (outcome: Effect.Effect<number, ProcessFailure>) => {
      if (settled) return;
      settled = true;
      resume(outcome);
    };

    const useGroup = process.platform !== "win32";
    try {
      child = spawn(
        opts.command,
        [...opts.args],
        spawnOptsBase({
          command: opts.command,
          args: opts.args,
          ...(opts.env !== undefined ? { env: opts.env } : {}),
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          stdio: "inherit",
          detached: useGroup,
        }),
      );
    } catch {
      settle(Effect.fail(new ProcessFailure("spawn_failed")));
      return;
    }

    const owned = child;
    owned.on("error", () => {
      settle(Effect.fail(new ProcessFailure("spawn_failed")));
    });

    owned.on("close", (code) => {
      settle(Effect.succeed(code ?? 1));
    });

    return Effect.suspend(() => {
      if (settled) return Effect.void;
      settled = true;
      return cancelOwnedFinalizer(owned);
    });
  });
}

/**
 * Spawn with all stdio ignored. Wait for the launcher to exit. On timeout,
 * kill only the owned launcher (process group on POSIX). Success always
 * returns empty stdout/stderr — never open capture pipes a daemon can retain.
 */
function runIgnoredStdioOwned(
  opts: RunIgnoredStdioOptions,
): Effect.Effect<CapturedProcessResult, ProcessFailure> {
  return Effect.async<CapturedProcessResult, ProcessFailure>((resume) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let child: ChildProcess | undefined;

    const settle = (
      outcome: Effect.Effect<CapturedProcessResult, ProcessFailure>,
    ) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resume(outcome);
    };

    const useGroup = process.platform !== "win32";
    try {
      child = spawn(
        opts.command,
        [...opts.args],
        spawnOptsBase({
          command: opts.command,
          args: opts.args,
          ...(opts.env !== undefined ? { env: opts.env } : {}),
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          stdio: ["ignore", "ignore", "ignore"],
          detached: useGroup,
        }),
      );
    } catch {
      settle(Effect.fail(new ProcessFailure("spawn_failed")));
      return;
    }

    const owned = child;
    let timedOut = false;

    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        terminateOwnedChild(owned);
      }, opts.timeoutMs);
    }

    owned.on("error", () => {
      settle(Effect.fail(new ProcessFailure("spawn_failed")));
    });

    owned.on("close", (code) => {
      if (settled) return;
      if (timedOut) {
        settle(Effect.fail(new ProcessFailure("timeout")));
        return;
      }
      settle(
        Effect.succeed({
          exitCode: code ?? 1,
          stdout: "",
          stderr: "",
        }),
      );
    });

    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      terminateOwnedChild(owned);
    });
  });
}

export const liveProcessExec = Layer.succeed(ProcessExec, {
  runCaptured: (opts) => runCapturedOwned(opts),
  runIgnoredStdio: (opts) => runIgnoredStdioOwned(opts),
  runForeground: (opts) => runForegroundOwned(opts),
});



export const liveQueueServices = Layer.mergeAll(
  liveProcessExec,
  liveSleeper,
  livePathLookup,
  liveBoundedFs,
  liveEnvVars,
);
