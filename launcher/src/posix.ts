// POSIX job-object equivalent (WSL/Linux build). No FFI here at all: `setsid`
// wraps the spawned command so it becomes its own session/process-group
// leader (pgid == pid, since setsid execs directly into CMD without an
// internal fork when the calling process is not already a group leader —
// which Bun.spawn's freshly forked child never is). Every descendant CMD
// spawns inherits that pgid automatically (fork() inherits pgid unless a
// process explicitly calls setpgid/setsid itself), so — unlike the Windows
// AssignProcessToJobObject path — there is no post-spawn assignment race:
// the whole tree is grouped from the moment `setsid` execs.
//
// Killing the tree is `kill(-pgid, signal)` — the negative pid targets the
// whole process group, reaping children and grandchildren the same way
// KILL_ON_JOB_CLOSE does on Windows.
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
