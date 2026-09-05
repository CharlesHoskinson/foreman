/**
 * Reliable queue admission over pueue (v4.0.4).
 *
 * Ports lane-queue product behavior to TypeScript and fixes the ensure-to-add
 * race: every `add` independently establishes bounded daemon readiness and the
 * fixed group topology before one admission attempt.
 */

import { Effect } from "effect";
import {
  BoundedFs,
  EnvVars,
  MAX_CAPTURE_BYTES,
  MAX_CONFIG_BYTES,
  PathLookup,
  ProcessExec,
  ProcessFailure,
  Sleeper,
  TIMEOUT_QUEUE_OP_MS,
  TIMEOUT_STATUS_PROBE_MS,
  type BoundedReadResult,
  type CapturedProcessResult,
  type QueueIo,
} from "./queue-services.js";

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_CONFIG = 2;
export const EXIT_MISSING_CLI = 3;

/**
 * Canonical `add` usage string, shared with queue-cli.ts so a stale
 * duplicate cannot drift from the real, Endstop-guarded contract
 * (bugeventlog.md, 2026-08-06, "a root cause inferred from test names,
 * published, and wrong" -- this string used to be written twice and one
 * copy went stale).
 */
export const ADD_USAGE =
  "usage: lane-queue.sh ensure|add GROUP [--endstop-prior-reservation-id ID] --endstop-state-root ABS --endstop-contract-id ID --endstop-contract-sha SHA256 [--endstop-family-sha SHA256 --endstop-child-id ID] --endstop-action ACTION --endstop-candidate-sha SHA256 [--containment-approval REASON] [--release-program v040 --release-phase PHASE --release-owner PACKAGE --release-repo ABS --release-candidate-commit SHA40 --release-register ABS --release-evidence ABS] -- CMD [ARGS...]|status [TASK_ID]|kill TASK_ID";

/** Fixed topology: proven caps only. No claude group. */
export const FIXED_GROUPS: readonly { name: string; parallel: number }[] = [
  { name: "grok", parallel: 3 },
  { name: "codex", parallel: 2 },
  { name: "misc", parallel: 2 },
  { name: "gate", parallel: 1 },
  { name: "agy", parallel: 1 },
] as const;

export const GROUP_RE = /^[a-z][a-z0-9_-]*$/;
export const TASK_ID_RE = /^[0-9]+$/;

// ---------------------------------------------------------------------------
// Quoting (pure)
// ---------------------------------------------------------------------------

/** PowerShell single-quoted literal: embedded ' doubled. */
export function pwshQuote(token: string): string {
  return "'" + token.replace(/'/g, "''") + "'";
}

/** POSIX single-quoted literal: close / escaped-quote / reopen. */
export function posixQuote(token: string): string {
  return "'" + token.replace(/'/g, "'\\''") + "'";
}

/**
 * True when the resolved pueue client is a Windows binary (.exe suffix or
 * MSYS sibling `<path>.exe` on disk).
 */
export function isWindowsPueuePath(
  pueueBin: string,
  fileExists: (path: string) => boolean,
): boolean {
  if (pueueBin.toLowerCase().endsWith(".exe")) return true;
  return fileExists(pueueBin + ".exe");
}

/**
 * Closed parse of daemon.shell_command from pueue YAML text.
 * Not a general YAML parser. Only keys under a top-level `daemon` section
 * authorize the value. Same-named keys in other sections are ignored for
 * authorization and cannot hide a daemon value.
 */
export type ShellCommandParse =
  | { readonly _tag: "Default" }
  | { readonly _tag: "Override"; readonly value: string }
  | { readonly _tag: "Uncertain" };

/**
 * True when a YAML scalar rest is empty, null, or a trailing comment only.
 * These are the only top-level `daemon:` value forms the narrow parser
 * treats as an ordinary block-mapping introduction.
 */
function isEmptyOrNullYamlRest(rest: string): boolean {
  const t = rest.trim();
  if (t.length === 0) return true;
  if (t.startsWith("#")) return true;
  if (t === "null" || t === "~") return true;
  // `null # comment` / `~ # comment`
  if (/^(null|~)(\s+#.*)?$/.test(t)) return true;
  return false;
}

/**
 * Values the narrow parser will not treat as a plain shell_command scalar.
 * Aliases, anchors, merge keys, flow collections, and block scalars can
 * hide or supply an override the line scanner cannot authorize.
 */
function isAmbiguousYamlScalar(val: string): boolean {
  if (val.length === 0) return false;
  const c = val[0]!;
  return (
    c === "*" ||
    c === "&" ||
    c === "{" ||
    c === "[" ||
    c === "!" ||
    c === "|" ||
    c === ">" ||
    c === "?"
  );
}

/**
 * Extract daemon.shell_command. Absent or YAML null → Default.
 * Any non-null plain command string under an ordinary block daemon → Override.
 * Duplicate or structurally ambiguous daemon forms → Uncertain.
 *
 * Fail closed on top-level daemon flow/anchor/alias forms, merge keys under
 * daemon, flow/alias shell values, and duplicate daemon sections. The narrow
 * parser only authorizes ordinary block mapping with absent/null or a plain
 * quoted/unquoted shell_command scalar.
 */
export function parseShellCommandOverride(configText: string): ShellCommandParse {
  let section: string | null = null;
  let daemonSections = 0;
  let shellSeen = 0;
  let shellValue: string | null | undefined = undefined;

  const lines = configText.split(/\n/);
  for (const raw of lines) {
    // Drop a single trailing CR so CRLF files parse, but do not strip
    // embedded CR inside values (those remain part of the line body).
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    // Top-level mapping key: no leading whitespace.
    // Also match keys introduced with YAML merge/anchor punctuation when the
    // key token itself is still a plain identifier (e.g. `daemon:`).
    const top = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (top !== null && line === line.trimStart()) {
      const key = top[1] ?? "";
      const rest = top[2] ?? "";
      if (key === "daemon") {
        daemonSections += 1;
        if (daemonSections > 1) return { _tag: "Uncertain" };
        // Ordinary block introduction: empty, null, or trailing comment only.
        // Any other inline value (flow map, anchor, alias, scalar) is Uncertain.
        if (!isEmptyOrNullYamlRest(rest)) return { _tag: "Uncertain" };
        section = "daemon";
        continue;
      }
      section = key;
      continue;
    }

    // Top-level non-plain forms that can introduce daemon content (e.g.
    // `? daemon` complex keys) are not accepted as ordinary block keys.
    // If the line is top-level and looks like a mapping but did not match
    // the plain-key pattern, leave section unchanged (ignored).

    if (section !== "daemon") continue;

    // Merge key under daemon can inject shell_command from elsewhere.
    if (/^\s+<<\s*:/.test(line)) return { _tag: "Uncertain" };

    const nested = line.match(/^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (nested === null) {
      // Indented non-mapping content under daemon (sequence item, flow
      // continuation, etc.) is ambiguous relative to shell authorization.
      if (/^\s+\S/.test(line)) return { _tag: "Uncertain" };
      continue;
    }
    if (nested[1] !== "shell_command") continue;

    shellSeen += 1;
    if (shellSeen > 1) return { _tag: "Uncertain" };

    let val = (nested[2] ?? "").trim();
    // Strip a trailing YAML comment on the same line for plain scalars only
    // after empty/null checks; comments after quoted forms stay inside quotes.
    if (val.length === 0 || val === "null" || val === "~") {
      shellValue = null;
      continue;
    }
    if (/^(null|~)(\s+#.*)?$/.test(val)) {
      shellValue = null;
      continue;
    }
    if (isAmbiguousYamlScalar(val)) return { _tag: "Uncertain" };

    const dq = val.match(/^"(.*)"$/);
    const sq = val.match(/^'(.*)'$/);
    if (dq) val = dq[1] ?? val;
    else if (sq) val = sq[1] ?? val;
    else {
      // Unquoted plain scalar: drop trailing comment if present.
      const hash = val.indexOf(" #");
      if (hash >= 0) val = val.slice(0, hash).trimEnd();
    }
    if (isAmbiguousYamlScalar(val)) return { _tag: "Uncertain" };
    shellValue = val;
  }

  if (shellSeen === 0 || shellValue === null || shellValue === undefined) {
    return { _tag: "Default" };
  }
  if (shellValue.length === 0) return { _tag: "Default" };
  return { _tag: "Override", value: shellValue };
}

export type ShellDialect = "powershell" | "posix";

export type QuoteResult =
  | {
      readonly ok: true;
      readonly dialect: ShellDialect;
      readonly argv: readonly string[];
    }
  | { readonly ok: false; readonly reason: "unclassifiable_shell" };

/**
 * Quote CMD tokens for the daemon shell implied by the client binary.
 * Unclassifiable shell_command override fails closed.
 */
export function quoteForShell(
  pueueBin: string,
  tokens: readonly string[],
  shellOverride: string | null,
  fileExists: (path: string) => boolean,
): QuoteResult {
  if (shellOverride !== null && shellOverride.length > 0) {
    return { ok: false, reason: "unclassifiable_shell" };
  }
  if (isWindowsPueuePath(pueueBin, fileExists)) {
    return {
      ok: true,
      dialect: "powershell",
      argv: ["&", ...tokens.map(pwshQuote)],
    };
  }
  return { ok: true, dialect: "posix", argv: tokens.map(posixQuote) };
}

// ---------------------------------------------------------------------------
// Pre-accept classifier (tested; keep closed and private to product callers)
// ---------------------------------------------------------------------------

/**
 * Classify known pueue 4.0.4 English pre-accept refusals from bounded
 * captured stderr alone. Unknown or localized messages fail closed.
 */
export function isPreAcceptRefusal(stderr: string): boolean {
  const s = stderr.replace(/\r/g, "").slice(0, MAX_CAPTURE_BYTES);
  if (s.includes("Failed to connect to the daemon")) return true;
  if (s.includes("Couldn't find a configuration file")) return true;
  return false;
}

/**
 * True when stdout is empty after permitting at most one ordinary line
 * terminator (LF, or CRLF as a single Windows terminator).
 */
export function isEmptyAdmissionStdout(stdout: string): boolean {
  return stdout === "" || stdout === "\n" || stdout === "\r\n";
}

/**
 * Parse a decimal task id without normalization.
 * Accepts digits alone, digits + one final LF, or digits + one final CRLF.
 * Rejects embedded CR/LF, multiple final newlines, empty, non-decimal, mixed.
 */
export function parseTaskId(stdout: string): string | null {
  let body = stdout;
  if (body.endsWith("\r\n")) {
    body = body.slice(0, -2);
  } else if (body.endsWith("\n")) {
    body = body.slice(0, -1);
  }
  if (body.length === 0) return null;
  if (body.includes("\n") || body.includes("\r")) return null;
  if (!TASK_ID_RE.test(body)) return null;
  return body;
}

/**
 * A nonzero add result is retryable only when stdout is empty (one optional
 * terminator), stderr alone matches a closed known pre-accept refusal, and
 * neither stream was truncated or otherwise indeterminate.
 */
export function isRetryablePreAcceptFailure(
  result: CapturedProcessResult,
): boolean {
  if (result.exitCode === 0) return false;
  if (!isEmptyAdmissionStdout(result.stdout)) return false;
  return isPreAcceptRefusal(result.stderr);
}

function joinHome(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

// ---------------------------------------------------------------------------
// Client / daemon resolution
// ---------------------------------------------------------------------------

export const resolvePueueClient: Effect.Effect<
  string | null,
  never,
  EnvVars | PathLookup
> = Effect.gen(function* () {
  const env = yield* EnvVars;
  const paths = yield* PathLookup;
  const force = yield* env.get("LANE_QUEUE_FORCE_MISSING");
  if (force === "1") return null;

  const onPath = yield* paths.which("pueue");
  if (onPath !== null) return onPath;

  const home = yield* env.home();
  if (home === undefined || home.length === 0) return null;

  const base = joinHome(home, ".foreman", "tools", "pueue");
  const stagedExe = joinHome(base, "pueue.exe");
  if (yield* paths.isExecutable(stagedExe)) return stagedExe;
  const staged = joinHome(base, "pueue");
  if (yield* paths.isExecutable(staged)) return staged;
  return null;
});

export const resolvePueued: Effect.Effect<
  string | null,
  never,
  EnvVars | PathLookup
> = Effect.gen(function* () {
  const env = yield* EnvVars;
  const paths = yield* PathLookup;
  const force = yield* env.get("LANE_QUEUE_FORCE_MISSING");
  if (force === "1") return null;

  const onPath = yield* paths.which("pueued");
  if (onPath !== null) return onPath;

  const home = yield* env.home();
  if (home === undefined || home.length === 0) return null;

  const base = joinHome(home, ".foreman", "tools", "pueue");
  const stagedExe = joinHome(base, "pueued.exe");
  if (yield* paths.isExecutable(stagedExe)) return stagedExe;
  const staged = joinHome(base, "pueued");
  if (yield* paths.isExecutable(staged)) return staged;
  return null;
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type ShellOverrideRead =
  | { readonly _tag: "Default" }
  | { readonly _tag: "Override"; readonly value: string }
  | { readonly _tag: "ConfigError" };

function mapReadToShell(
  read: BoundedReadResult,
): ShellOverrideRead {
  switch (read._tag) {
    case "Absent":
      return { _tag: "Default" };
    case "Ok": {
      const parsed = parseShellCommandOverride(read.text);
      if (parsed._tag === "Default") return { _tag: "Default" };
      if (parsed._tag === "Override") {
        return { _tag: "Override", value: parsed.value };
      }
      return { _tag: "ConfigError" };
    }
    case "Oversized":
    case "Unreadable":
    case "MalformedUtf8":
    case "IdentityChanged":
      return { _tag: "ConfigError" };
    default: {
      const _exhaustive: never = read;
      void _exhaustive;
      return { _tag: "ConfigError" };
    }
  }
}

/**
 * Resolve shell_command policy from config. Absent file → Default.
 * Present but oversized/unreadable/malformed/identity-changed → ConfigError.
 * Only daemon.shell_command is inspected.
 */
export const readShellCommandOverride: Effect.Effect<
  ShellOverrideRead,
  never,
  EnvVars | BoundedFs
> = Effect.gen(function* () {
  const env = yield* EnvVars;
  const fs = yield* BoundedFs;
  const cfgPath = yield* env.get("PUEUE_CONFIG_PATH");
  if (cfgPath !== undefined && cfgPath.length > 0) {
    const text = yield* fs.readFileBounded(cfgPath, MAX_CONFIG_BYTES);
    return mapReadToShell(text);
  }

  const appdata = yield* env.get("APPDATA");
  if (appdata !== undefined && appdata.length > 0) {
    const win = joinHome(appdata, "pueue", "pueue.yml");
    const text = yield* fs.readFileBounded(win, MAX_CONFIG_BYTES);
    if (text._tag !== "Absent") return mapReadToShell(text);
  }

  const xdg = yield* env.get("XDG_CONFIG_HOME");
  const home = yield* env.home();
  const posixBase =
    xdg !== undefined && xdg.length > 0
      ? xdg
      : home !== undefined
        ? joinHome(home, ".config")
        : null;
  if (posixBase !== null) {
    const p = joinHome(posixBase, "pueue", "pueue.yml");
    const text = yield* fs.readFileBounded(p, MAX_CONFIG_BYTES);
    if (text._tag !== "Absent") return mapReadToShell(text);
  }
  return { _tag: "Default" };
});

// ---------------------------------------------------------------------------
// pueue helpers
// ---------------------------------------------------------------------------

const runPueue = (
  pueueBin: string,
  args: readonly string[],
  timeoutMs: number,
): Effect.Effect<CapturedProcessResult, ProcessFailure, ProcessExec> =>
  Effect.gen(function* () {
    const proc = yield* ProcessExec;
    return yield* proc.runCaptured({
      command: pueueBin,
      args,
      maxOutputBytes: MAX_CAPTURE_BYTES,
      timeoutMs,
    });
  });

/**
 * Daemon reachability only. Uses `status --json "last 1"` so the probe does
 * not capture full historical task volume under the 1 MiB capture bound.
 * Public `cmdStatus` keeps full `status --json` behavior.
 */
const statusProbe = (
  pueueBin: string,
): Effect.Effect<boolean, never, ProcessExec> =>
  Effect.gen(function* () {
    const r = yield* runPueue(
      pueueBin,
      ["status", "--json", "last 1"],
      TIMEOUT_STATUS_PROBE_MS,
    );
    return r.exitCode === 0;
  }).pipe(Effect.catchAll(() => Effect.succeed(false)));

/**
 * Ensure one group exists and set its parallel cap. "already exists" is
 * idempotent success. Any other group-add or parallel failure fails closed.
 */
export const ensureGroup = (
  pueueBin: string,
  name: string,
  parallel: number,
): Effect.Effect<void, { readonly _tag: "GroupConfigFailed" }, ProcessExec> =>
  Effect.gen(function* () {
    const add = yield* runPueue(
      pueueBin,
      ["group", "add", name],
      TIMEOUT_QUEUE_OP_MS,
    ).pipe(
      Effect.catchAll(() =>
        Effect.succeed({
          exitCode: 1,
          stdout: "",
          stderr: "spawn_failed",
        } satisfies CapturedProcessResult),
      ),
    );
    if (add.exitCode !== 0) {
      const err = (add.stderr + add.stdout).replace(/\r/g, "");
      if (!err.includes("already exists")) {
        return yield* Effect.fail({ _tag: "GroupConfigFailed" as const });
      }
    }
    const par = yield* runPueue(
      pueueBin,
      ["parallel", String(parallel), "--group", name],
      TIMEOUT_QUEUE_OP_MS,
    ).pipe(
      Effect.catchAll(() =>
        Effect.succeed({
          exitCode: 1,
          stdout: "",
          stderr: "spawn_failed",
        } satisfies CapturedProcessResult),
      ),
    );
    if (par.exitCode !== 0) {
      return yield* Effect.fail({ _tag: "GroupConfigFailed" as const });
    }
  });

export type EnsureOptions = {
  /** Suppress the ordinary `ready` stderr line (internal add path). */
  readonly quiet?: boolean;
};

/**
 * Establish daemon reachability and fixed group topology.
 * Exit: 0 ready, 1 unreachable/config fail, 3 client absent (public ensure only).
 *
 * Probe status before resolving the daemon binary. If reachable, do not
 * require or resolve pueued. If unreachable, resolve/start pueued and run
 * five bounded probes. Missing pueued after an unreachable probe is exit 1.
 */
export const cmdEnsure = (
  io: QueueIo,
  options?: EnsureOptions,
): Effect.Effect<
  number,
  never,
  ProcessExec | Sleeper | PathLookup | BoundedFs | EnvVars
> =>
  Effect.gen(function* () {
    const quiet = options?.quiet === true;
    const pueueBin = yield* resolvePueueClient;
    if (pueueBin === null) {
      if (!quiet) {
        io.writeStderr(
          "lane-queue: pueue not found on PATH or $HOME/.foreman/tools/pueue -- fallback mode\n",
        );
      }
      return EXIT_MISSING_CLI;
    }

    const reachable = yield* statusProbe(pueueBin);
    if (!reachable) {
      const pueuedBin = yield* resolvePueued;
      if (pueuedBin === null) {
        if (!quiet) {
          io.writeStderr(
            "lane-queue: pueued daemon binary missing after unreachable status probe\n",
          );
        }
        return EXIT_FAIL;
      }

      // Daemonizer boundary: ignore stdio so a forked pueued cannot retain
      // capture pipes. Wait for the launcher to exit (10s). Timeout kills only
      // this owned launcher/group. Reachability remains the five-probe loop.
      const proc = yield* ProcessExec;
      yield* proc
        .runIgnoredStdio({
          command: pueuedBin,
          args: ["-d"],
          timeoutMs: TIMEOUT_QUEUE_OP_MS,
        })
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      const sleeper = yield* Sleeper;
      let ready = false;
      let waited = 0;
      while (waited < 5) {
        if (yield* statusProbe(pueueBin)) {
          ready = true;
          break;
        }
        yield* sleeper.sleep(1000);
        waited += 1;
      }
      if (!ready) {
        if (!quiet) {
          io.writeStderr(
            `lane-queue: pueued daemon unreachable after spawn + ${waited}s retry\n`,
          );
        }
        return EXIT_FAIL;
      }
    }

    for (const g of FIXED_GROUPS) {
      const r = yield* ensureGroup(pueueBin, g.name, g.parallel).pipe(
        Effect.either,
      );
      if (r._tag === "Left") {
        if (!quiet) {
          io.writeStderr(
            `lane-queue: group configuration failed for ${g.name}\n`,
          );
        }
        return EXIT_FAIL;
      }
    }

    if (!quiet) {
      io.writeStderr(
        "lane-queue: ready (groups: grok codex misc gate agy)\n",
      );
    }
    return EXIT_OK;
  });

/**
 * Add CMD to group. Independently safe: establishes readiness before one
 * admission. One classified pre-accept retry only. Never direct-spawns when
 * a client is present. Never echoes raw vendor streams on failure.
 */
export const cmdAdd = (
  io: QueueIo,
  group: string,
  cmd: readonly string[],
  containmentApproval?: string,
): Effect.Effect<
  number,
  never,
  ProcessExec | Sleeper | PathLookup | BoundedFs | EnvVars
> =>
  Effect.gen(function* () {
    if (!GROUP_RE.test(group)) {
      io.writeStderr(
        `lane-queue: invalid GROUP '${group}' (must match ^[a-z][a-z0-9_-]*$)\n`,
      );
      return EXIT_CONFIG;
    }
    if (cmd.length === 0) {
      io.writeStderr(ADD_USAGE + "\n");
      return EXIT_CONFIG;
    }

    const pueueBin = yield* resolvePueueClient;
    if (pueueBin === null) {
      const g = FIXED_GROUPS.find((g) => g.name === group);
      const cap = g ? g.parallel : "unknown";
      io.writeStderr(`lane-queue: degraded direct-spawn (pueue absent) - missing cap for ${group}: ${cap}\n`);
      return EXIT_FAIL;
    }

    // Shell classification BEFORE any pueue invocation.
    const paths = yield* PathLookup;
    const exeSibling = pueueBin + ".exe";
    const hasExeSibling = yield* paths.fileExists(exeSibling);
    const fileExists = (p: string): boolean =>
      p === exeSibling ? hasExeSibling : false;

    const shellRead = yield* readShellCommandOverride;
    if (shellRead._tag === "ConfigError") {
      io.writeStderr(
        "lane-queue: pueue configuration unreadable or uncertain -- refusing before any queue process call\n",
      );
      return EXIT_CONFIG;
    }
    if (shellRead._tag === "Override") {
      io.writeStderr(
        "lane-queue: pueue config overrides daemon.shell_command -- lane-queue does not know how to quote for that shell and refuses to guess\n",
      );
      return EXIT_CONFIG;
    }

    const queued = containmentApproval === undefined
      ? cmd
      : ["env", `FOREMAN_CONTAINMENT_APPROVAL=${containmentApproval}`, ...cmd];
    const quoted = quoteForShell(pueueBin, queued, null, fileExists);
    if (!quoted.ok) {
      io.writeStderr(
        "lane-queue: pueue config overrides daemon.shell_command -- lane-queue does not know how to quote for that shell and refuses to guess\n",
      );
      return EXIT_CONFIG;
    }

    // Establish readiness (suppress ready line so stdout is only the task id).
    const readyCode = yield* cmdEnsure(io, { quiet: true });
    if (readyCode !== EXIT_OK) {
      // Client was present for quoting; absence after race is still fail (not 3).
      return readyCode === EXIT_MISSING_CLI ? EXIT_FAIL : readyCode;
    }

    const attemptAdd = () =>
      runPueue(
        pueueBin,
        ["add", "--group", group, "--print-task-id", "--", ...quoted.argv],
        TIMEOUT_QUEUE_OP_MS,
      );

    // Indeterminate ProcessFailure (timeout/output_bound/spawn) becomes an
    // empty-stream nonzero result so the pre-accept classifier never retries.
    let result = yield* attemptAdd().pipe(
      Effect.catchAll(() =>
        Effect.succeed({
          exitCode: 1,
          stdout: "",
          stderr: "",
        } satisfies CapturedProcessResult),
      ),
    );

    if (result.exitCode === 0) {
      const id = parseTaskId(result.stdout);
      if (id === null) {
        io.writeStderr(
          "lane-queue: ambiguous add result (malformed task id)\n",
        );
        return EXIT_FAIL;
      }
      io.writeStdout(id + "\n");
      return EXIT_OK;
    }

    // Failed: only one retry for classified pre-accept refusals.
    if (!isRetryablePreAcceptFailure(result)) {
      io.writeStderr(`lane-queue: pueue add failed for group ${group}\n`);
      return EXIT_FAIL;
    }

    const retryReady = yield* cmdEnsure(io, { quiet: true });
    if (retryReady !== EXIT_OK) {
      return retryReady === EXIT_MISSING_CLI ? EXIT_FAIL : retryReady;
    }

    result = yield* attemptAdd().pipe(
      Effect.catchAll(() =>
        Effect.succeed({
          exitCode: 1,
          stdout: "",
          stderr: "",
        } satisfies CapturedProcessResult),
      ),
    );

    if (result.exitCode === 0) {
      const id = parseTaskId(result.stdout);
      if (id === null) {
        io.writeStderr(
          "lane-queue: ambiguous add result (malformed task id)\n",
        );
        return EXIT_FAIL;
      }
      io.writeStdout(id + "\n");
      return EXIT_OK;
    }

    io.writeStderr(`lane-queue: pueue add failed for group ${group}\n`);
    return EXIT_FAIL;
  });

/**
 * Status: whole queue JSON or single-task compact JSON.
 * Successful status --json is always parsed. Invalid JSON returns 1 with no
 * raw body. Whole status prints compact CR-free JSON.
 */
export const cmdStatus = (
  io: QueueIo,
  taskId: string | undefined,
): Effect.Effect<
  number,
  never,
  ProcessExec | PathLookup | BoundedFs | EnvVars
> =>
  Effect.gen(function* () {
    const pueueBin = yield* resolvePueueClient;
    if (pueueBin === null) {
      io.writeStdout('{"degraded":true}\n');
      return EXIT_OK;
    }

    const raw = yield* runPueue(
      pueueBin,
      ["status", "--json"],
      TIMEOUT_QUEUE_OP_MS,
    ).pipe(
      Effect.catchAll(() =>
        Effect.succeed({
          exitCode: 1,
          stdout: "",
          stderr: "",
        } satisfies CapturedProcessResult),
      ),
    );
    if (raw.exitCode !== 0) {
      io.writeStderr("lane-queue: pueue status failed\n");
      return EXIT_FAIL;
    }

    // Parse the original status stdout. Do not strip CR before parse: JSON
    // whitespace already permits an ordinary CRLF terminator, and removing
    // CR would falsely accept invalid embedded CR inside string values.
    // After a successful parse, JSON.stringify emits compact CR-free output.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.stdout);
    } catch {
      io.writeStderr("lane-queue: invalid status JSON\n");
      return EXIT_FAIL;
    }

    if (taskId === undefined || taskId.length === 0) {
      // Compact CR-free JSON for whole status.
      io.writeStdout(JSON.stringify(parsed) + "\n");
      return EXIT_OK;
    }

    const tasks =
      typeof parsed === "object" &&
      parsed !== null &&
      "tasks" in parsed &&
      typeof (parsed as { tasks: unknown }).tasks === "object" &&
      (parsed as { tasks: unknown }).tasks !== null
        ? (parsed as { tasks: Record<string, unknown> }).tasks
        : ({} as Record<string, unknown>);

    const one = Object.prototype.hasOwnProperty.call(tasks, taskId)
      ? tasks[taskId]
      : {};
    io.writeStdout(JSON.stringify(one ?? {}) + "\n");
    return EXIT_OK;
  });

/**
 * Kill a decimal task ID. Failures emit only a fixed diagnostic.
 */
export const cmdKill = (
  io: QueueIo,
  taskId: string,
): Effect.Effect<
  number,
  never,
  ProcessExec | PathLookup | BoundedFs | EnvVars
> =>
  Effect.gen(function* () {
    if (!TASK_ID_RE.test(taskId)) {
      io.writeStderr(
        `lane-queue: invalid TASK_ID '${taskId}' (must match ^[0-9]+$)\n`,
      );
      return EXIT_CONFIG;
    }

    const pueueBin = yield* resolvePueueClient;
    if (pueueBin === null) {
      io.writeStderr(
        "lane-queue: kill unsupported in fallback mode (direct spawns are owned by the caller)\n",
      );
      return EXIT_CONFIG;
    }

    const raw = yield* runPueue(pueueBin, ["kill", taskId], TIMEOUT_QUEUE_OP_MS).pipe(
      Effect.catchAll(() =>
        Effect.succeed({
          exitCode: 1,
          stdout: "",
          stderr: "",
        } satisfies CapturedProcessResult),
      ),
    );
    if (raw.exitCode !== 0) {
      io.writeStderr(`lane-queue: pueue kill failed for task ${taskId}\n`);
      return EXIT_FAIL;
    }
    // Fixed success line from the already-validated decimal task id only —
    // never raw vendor stdout/stderr.
    io.writeStdout(`Tasks are being killed: ${taskId}\n`);
    return EXIT_OK;
  });
