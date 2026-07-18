#!/usr/bin/env bun
// foreman-launch — TypeScript-on-Bun supervisor that owns a spawned
// command's whole process tree via a Windows Job Object with
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (orphans impossible by construction),
// or, on POSIX, a setsid-created process group. Streams stdio through
// unmodified, writes JSON heartbeats to a file, performs a graded stop on
// timeout.
//
// GRADED STOP CONTRACT (binding, T1 spec REV2 resolution 1): there is no
// cooperative phase. CTRL_BREAK is impossible via Bun.spawn (it needs a
// shared console + CREATE_NEW_PROCESS_GROUP) and CMD's stdin is already the
// null device, so closing stdin signals nothing. On timeout: wait --grace
// seconds, then hard-kill (TerminateJobObject / SIGKILL the process
// group). That is the entire contract — see src/supervise.ts.
//
// Exit codes: child's own exit code; 124 = timeout kill; 125 = launcher
// error (bad args, FFI failure, etc).
import { readFileSync, writeFileSync } from "node:fs";
import { supervise } from "./supervise";

const FOREMAN_LAUNCH_VERSION = "0.2.5";
const PINNED_BUN_VERSION = "1.3.14";

function usage(): string {
  return [
    "usage: foreman-launch [--timeout SECS] [--grace SECS=10]",
    "                       [--heartbeat-file F] [--heartbeat-interval SECS=15]",
    "                       [--detach] -- CMD [ARGS...]",
    "       foreman-launch --version",
    "",
    "stdout/stderr of CMD pass through unmodified. CMD's stdin is the null",
    "device (the launcher forwards it; it never inherits the caller's stdin).",
    "Heartbeat JSON lines go ONLY to --heartbeat-file, one per",
    "--heartbeat-interval seconds (plus one immediately at spawn).",
    "Exit codes: child's own code; 124 = timeout kill; 125 = launcher error.",
  ].join("\n");
}

class UsageError extends Error {}

interface ParsedArgs {
  timeoutSecs?: number;
  graceSecs: number;
  heartbeatFile?: string;
  heartbeatIntervalSecs: number;
  detach: boolean;
  cmd: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const sepIdx = argv.indexOf("--");
  if (sepIdx === -1) throw new UsageError("missing '--' separator before CMD");
  const flagArgs = argv.slice(0, sepIdx);
  const cmd = argv.slice(sepIdx + 1);
  if (cmd.length === 0) throw new UsageError("no CMD given after '--'");

  let timeoutSecs: number | undefined;
  let graceSecs = 10;
  let heartbeatFile: string | undefined;
  let heartbeatIntervalSecs = 15;
  let detach = false;

  for (let i = 0; i < flagArgs.length; i++) {
    const a = flagArgs[i];
    switch (a) {
      case "--timeout": {
        const v = Number(flagArgs[++i]);
        if (!Number.isFinite(v) || v <= 0) throw new UsageError("--timeout requires a positive number");
        timeoutSecs = v;
        break;
      }
      case "--grace": {
        const v = Number(flagArgs[++i]);
        if (!Number.isFinite(v) || v < 0) throw new UsageError("--grace requires a non-negative number");
        graceSecs = v;
        break;
      }
      case "--heartbeat-file": {
        const v = flagArgs[++i];
        if (!v) throw new UsageError("--heartbeat-file requires a path");
        heartbeatFile = v;
        break;
      }
      case "--heartbeat-interval": {
        const v = Number(flagArgs[++i]);
        if (!Number.isFinite(v) || v <= 0) throw new UsageError("--heartbeat-interval requires a positive number");
        heartbeatIntervalSecs = v;
        break;
      }
      case "--detach":
        detach = true;
        break;
      default:
        throw new UsageError(`unrecognized flag: ${a}`);
    }
  }

  if (detach && !heartbeatFile) {
    // The bounded-poll handoff (see runDetached) has nothing to poll
    // without a heartbeat file to watch for the detached copy's first line.
    throw new UsageError("--detach requires --heartbeat-file");
  }

  return { timeoutSecs, graceSecs, heartbeatFile, heartbeatIntervalSecs, detach, cmd };
}

/** Args as the user passed them, whether we're running via `bun run
 * src/launch.ts ...args` (dev) or as a `--compile`d standalone exe
 * (production). Bun.main is the resolved entry-point path; dev-run argv
 * includes it as argv[1], the compiled exe's argv does not. */
function resolveCliArgs(): string[] {
  const argv = Bun.argv;
  if (argv.length > 1 && argv[1] === Bun.main) return argv.slice(2);
  return argv.slice(1);
}

/** `--detach`: self-re-exec detached, sole-writer-of-heartbeat rule
 * (resolution 2). The foreground copy blocks on a bounded (<=5s) poll of
 * heartbeatFile for the detached copy's FIRST heartbeat line, then exits 0.
 * The detached copy is the SOLE writer of heartbeatFile from that point on. */
async function runDetached(rawArgv: string[], heartbeatFile: string): Promise<number> {
  const sepIdx = rawArgv.indexOf("--");
  const flagsPart = rawArgv.slice(0, sepIdx).filter((a) => a !== "--detach");
  const cmdPart = rawArgv.slice(sepIdx); // keep "--" and everything after verbatim
  const argvSansDetach = [...flagsPart, ...cmdPart];

  // F1 fix (rework round 1, Opus audit): a pre-existing, still-parseable
  // heartbeat line left over from a PRIOR run would otherwise let the
  // bounded poll below false-succeed on stale data before the NEW detached
  // copy ever writes anything (supervise() only ever appends; nothing else
  // truncates F). Reset F here, synchronously, BEFORE spawning the detached
  // copy: at this point the detached copy does not exist yet, so this is
  // not a second concurrent writer — it's a one-time reset strictly before
  // the sole writer's lifetime begins. Any parseable line the poll sees
  // afterward is therefore guaranteed to come from the NEW copy, which
  // reinforces (rather than violates) the sole-writer invariant.
  try {
    writeFileSync(heartbeatFile, "");
  } catch (err) {
    console.error(
      `foreman-launch: --detach: failed to reset --heartbeat-file before handoff: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 125;
  }

  const child = Bun.spawn([process.execPath, ...argvSansDetach], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  child.unref();

  const deadlineMs = Date.now() + 5000;
  while (Date.now() < deadlineMs) {
    try {
      const content = readFileSync(heartbeatFile, "utf8");
      const firstLine = content.split("\n").find((l) => l.trim().length > 0);
      if (firstLine) {
        JSON.parse(firstLine); // must be well-formed before we call it "written"
        return 0;
      }
    } catch {
      /* file not yet created, or not yet a complete line — keep polling */
    }
    await Bun.sleep(100);
  }
  console.error("foreman-launch: --detach: timed out waiting for detached copy's first heartbeat");
  return 125;
}

async function main(): Promise<number> {
  const rawArgv = resolveCliArgs();

  if (Bun.version !== PINNED_BUN_VERSION) {
    console.error(`foreman-launch: warning: running on Bun ${Bun.version}, pinned to ${PINNED_BUN_VERSION}`);
  }

  const sepIdx = rawArgv.indexOf("--");
  const versionRequested = sepIdx === -1 ? rawArgv.includes("--version") : rawArgv.slice(0, sepIdx).includes("--version");
  if (versionRequested) {
    console.log(`foreman-launch ${FOREMAN_LAUNCH_VERSION} (bun ${Bun.version})`);
    return 0;
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(rawArgv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`foreman-launch: ${err.message}`);
      console.error(usage());
      return 125;
    }
    throw err;
  }

  if (parsed.detach) {
    // parseArgs already guarantees heartbeatFile is set when detach is set.
    return runDetached(rawArgv, parsed.heartbeatFile as string);
  }

  try {
    const result = await supervise({
      cmd: parsed.cmd,
      timeoutSecs: parsed.timeoutSecs,
      graceSecs: parsed.graceSecs,
      heartbeatFile: parsed.heartbeatFile,
      heartbeatIntervalSecs: parsed.heartbeatIntervalSecs,
    });
    if (result.timedOut) return 124;
    return result.exitCode;
  } catch (err) {
    console.error(`foreman-launch: launcher error: ${err instanceof Error ? err.message : String(err)}`);
    return 125;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`foreman-launch: unhandled launcher error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(125);
  });
