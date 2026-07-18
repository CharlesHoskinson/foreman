// POSIX job-object equivalent (WSL/Linux build). `setsid` wraps the spawned
// command so it becomes its own session/process-group leader (pgid == pid,
// since setsid execs directly into CMD without an internal fork when the
// calling process is not already a group leader — which Bun.spawn's freshly
// forked child never is). Every descendant CMD spawns inherits that pgid
// automatically (fork() inherits pgid unless a process explicitly calls
// setpgid/setsid itself), so — unlike the Windows AssignProcessToJobObject
// path — there is no post-spawn assignment race: the whole tree is grouped
// from the moment `setsid` execs.
//
// Killing the tree is `kill(-pgid, signal)` — the negative pid targets the
// whole process group, reaping children and grandchildren the same way
// KILL_ON_JOB_CLOSE does on Windows. This pgid mechanism is COOPERATIVE
// (the launcher's own running code must call it) — it is the fallback path
// when the pidns-init cascade below (Task 2, posix-bootstrap.ts) is
// unavailable; see launcher/README.md "POSIX asymmetry".
//
// Task 1 (posix-cascade-parity plan) adds one piece of FFI: a one-shot
// prctl(PR_SET_CHILD_SUBREAPER) safety net, dlopen("libc.so.6") exactly like
// the existing kernel32 pattern in src/win/jobobject.ts (lazy, memoized,
// never polled — oven-sh/bun#31941 is sustained FFI *polling*; a single
// startup call is not that).
import { dlopen, FFIType, ptr } from "bun:ffi";
import {
  pidnsAvailable,
  buildUnshareArgv,
  buildEnvp,
  execReplaceWithUnshare,
  HOST_PID_ENV,
  PIDNS_INNER_ENV,
} from "./posix-bootstrap";

export { HOST_PID_ENV } from "./posix-bootstrap";

export class UnsupportedPlatformError extends Error {}

/** Prepends the `setsid` wrapper to cmd. POSIX-only (never call on win32). */
export function wrapWithSetsid(cmd: string[]): string[] {
  if (process.platform === "win32") throw new UnsupportedPlatformError();
  return ["setsid", ...cmd];
}

/** Hard-kills the whole process group rooted at pid (== pgid, via setsid).
 * ESRCH (group already gone) is swallowed — that's the desired end state,
 * not an error. */
export function terminateProcessGroup(pid: number, signal: NodeJS.Signals | number = "SIGKILL"): void {
  if (process.platform === "win32") throw new UnsupportedPlatformError();
  try {
    process.kill(-pid, signal);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ESRCH") throw err;
  }
}

// --- Task 1: subreaper safety net ------------------------------------
const PR_SET_CHILD_SUBREAPER = 36;
const PR_GET_CHILD_SUBREAPER = 37;

// Two separate dlopen() declarations for the SAME underlying libc symbol:
// the SET call's second arg is a plain value (1), so it's typed u64 per the
// plan; the GET call's second arg must be an actual pointer (the kernel
// writes the current flag back through it), so it needs its own FFIType.ptr
// signature. bun:ffi ties argument types to the symbol declaration at
// dlopen() time, not per-call, so mixing both shapes under one declared
// symbol isn't an option — two independent (cheap) dlopen handles instead.
let prctlSetLib: ReturnType<typeof dlopenPrctlSet> | null = null;
function dlopenPrctlSet() {
  return dlopen("libc.so.6", {
    prctl: {
      args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64],
      returns: FFIType.i32,
    },
  });
}
const prctlSet = () => (prctlSetLib ??= dlopenPrctlSet());

let prctlGetLib: ReturnType<typeof dlopenPrctlGet> | null = null;
function dlopenPrctlGet() {
  return dlopen("libc.so.6", {
    prctl: {
      args: [FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.u64],
      returns: FFIType.i32,
    },
  });
}
const prctlGet = () => (prctlGetLib ??= dlopenPrctlGet());

/** One-shot prctl(PR_SET_CHILD_SUBREAPER, 1) on THIS process (no fork around
 * it — the launcher is single-threaded at the point this is called, before
 * any child is spawned). Adopts any descendant that re-parents away (e.g. a
 * setsid/double-forked escapee whose immediate parent already exited)
 * instead of losing it to real init. ADDITIVE to the pidns-init bootstrap
 * (posix-bootstrap.ts) — that is the primary guarantee; this is a safety
 * net on top of it, and also the ONLY extra guarantee available when the
 * pidns bootstrap itself is unavailable/degraded.
 *
 * Never throws on FFI failure: per spec, a failed prctl call must be logged
 * and the launcher must continue (the pidns bootstrap, when available,
 * doesn't depend on this). Returns true iff the kernel confirmed the flag
 * is now set. Throws UnsupportedPlatformError on win32 (this module is
 * POSIX-only throughout, matching wrapWithSetsid/terminateProcessGroup). */
export function setChildSubreaper(): boolean {
  if (process.platform === "win32") throw new UnsupportedPlatformError();
  try {
    const rc = prctlSet().symbols.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) as number;
    if (rc !== 0) {
      console.error(
        `foreman-launch: prctl(PR_SET_CHILD_SUBREAPER) failed (rc=${rc}) -- continuing without the subreaper safety net (the pidns bootstrap, if available, is the primary guarantee)`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `foreman-launch: prctl(PR_SET_CHILD_SUBREAPER) unavailable: ${err instanceof Error ? err.message : String(err)} -- continuing without the subreaper safety net`,
    );
    return false;
  }
}

/** Test/verification-only probe: reads back PR_GET_CHILD_SUBREAPER's
 * current value for THIS process via a pointer arg (a 4-byte buffer the
 * kernel writes through). Not used by the launcher's own runtime path
 * (setChildSubreaper() doesn't need to verify itself, and this is exactly
 * the kind of FFI call this module never *polls* — it's called once, by a
 * test, to confirm the SET call already took effect). */
export function getChildSubreaperFlag(): number {
  if (process.platform === "win32") throw new UnsupportedPlatformError();
  const out = new Int32Array(1);
  prctlGet().symbols.prctl(PR_GET_CHILD_SUBREAPER, ptr(out), 0, 0, 0);
  return out[0];
}

// --- Task 2: pidns-init bootstrap entry --------------------------------
export type PidnsBootstrapResult = "already-inner" | "degraded";

/** Task 2 entry point. Call ONCE from launch.ts's main(), POSIX-only, and
 * ONLY on the path that is actually about to supervise() a CMD — never from
 * the `--detach` foreground orchestrator, which must stay a plain,
 * un-wrapped process so ITS own normal exit doesn't tear down the detached
 * copy it just spawned as a child (that copy would inherit the same fresh
 * namespace and die with it).
 *
 * On success this function NEVER RETURNS — see posix-bootstrap.ts's header
 * for why real image replacement (not spawn+wait) is required for the
 * kill-anywhere-in-the-chain guarantee. It only returns here for:
 *  - "already-inner": this process IS the re-exec'd copy
 *    (FOREMAN_LAUNCH_PIDNS_INNER is set) — nothing left to do, the caller
 *    proceeds straight to supervise().
 *  - "degraded": `unshare` is unavailable, or failed even after this
 *    process's own disposable-probe check already reported success (a rare
 *    environment-changed-mid-flight race). The downgrade is ALWAYS logged
 *    here — never silent — and the caller proceeds to supervise() using the
 *    existing setsid+pgid path with no pidns guarantee. */
export function bootstrapPidnsCascade(rawArgv: string[]): PidnsBootstrapResult {
  if (process.platform === "win32") throw new UnsupportedPlatformError();
  if (process.env[PIDNS_INNER_ENV] === "1") return "already-inner";

  if (!pidnsAvailable()) {
    console.error(
      "foreman-launch: unshare unavailable/failed (availability probe) -- " +
        "DEGRADED: falling back to setsid+pgid, no kernel pidns cascade guarantee",
    );
    return "degraded";
  }

  const hostPid = process.pid;
  const unsharePath = Bun.which("unshare");
  if (!unsharePath) {
    // pidnsAvailable() just proved `unshare ... -- true` ran successfully
    // via Bun.spawnSync's own PATH search, so this should be unreachable in
    // practice — defensive only, per "never silently proceed."
    console.error(
      "foreman-launch: unshare resolved by the probe but not by Bun.which() -- " +
        "DEGRADED: falling back to setsid+pgid, no kernel pidns cascade guarantee",
    );
    return "degraded";
  }
  const argv = buildUnshareArgv(process.execPath, rawArgv);
  // execve(3) needs an EXPLICIT envp — see posix-bootstrap.ts's header for
  // why `process.env[K] = v` here would silently fail to reach the child
  // (Bun's env mirror doesn't sync back to the real environ execve reads).
  const envp = buildEnvp(process.env, { [HOST_PID_ENV]: String(hostPid), [PIDNS_INNER_ENV]: "1" });
  const { rc } = execReplaceWithUnshare(unsharePath, argv, envp);
  // Only reachable if execve(3) failed AFTER a successful probe -- rare,
  // but per the "never silently proceed" rule this must still degrade
  // loudly rather than pretending the bootstrap happened.
  console.error(
    `foreman-launch: unshare exec failed unexpectedly after a successful probe (execve rc=${rc}) -- ` +
      "DEGRADED: falling back to setsid+pgid, no kernel pidns cascade guarantee",
  );
  return "degraded";
}
