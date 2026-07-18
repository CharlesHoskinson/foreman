// Task 2 (posix-cascade-parity plan): the pidns-init bootstrap mechanics.
//
// The POSIX launcher self-re-execs (real process-IMAGE replacement, not
// fork+wait) under `unshare --pid --mount-proc --fork --kill-child --
// <this same binary> <original args>`, so THIS process's own pid (whatever
// host-visible pid the caller captured at spawn time -- e.g. bats' `$!`)
// becomes the `unshare` wrapper's pid once the exec commits. `unshare(1)`
// then forks a child that execs back into this binary; per `unshare(1)`'s
// own PID-namespace semantics, that forked child is PID 1 (init) of a
// fresh PID namespace. Linux kernel rule: when a PID-namespace's init dies
// (for ANY reason -- normal exit, crash, OOM, SIGKILL), the kernel
// SIGKILLs every remaining process in that namespace and tears it down --
// including setsid/double-forked escapees, with zero polling by foreman.
// `--kill-child` closes the reverse edge: if the outer `unshare` process
// (this re-exec'd image) is killed instead, the kernel SIGKILLs the forked
// child too, so either kill target cascades the same way. Both directions
// were verified empirically on this WSL2 host (util-linux unshare 2.41.3)
// before writing this module: killing the ns-init child directly, and
// killing the outer `unshare` wrapper, both left zero survivors of a
// setsid+backgrounded-subshell escapee.
//
// WHY IMAGE REPLACEMENT, NOT Bun.spawn+wait: if this process instead
// *spawned* `unshare` as a child and blocked waiting for it, an external
// SIGKILL of THIS process's pid would NOT touch that child at all (a
// plainly spawned child has no parent-death propagation; PDEATHSIG only
// fires for a process that set it on itself, which a stock `unshare`
// binary doesn't do) -- the child would simply be orphaned and keep
// running, reparented up, exactly the escape hatch this plan closes. Only
// true execve-style replacement keeps the ORIGINAL, externally-known pid
// as the thing whose death (for ANY reason, including an uncatchable
// SIGKILL) tears down the whole tree. This is also why `--detach`'s own
// self-re-exec (see launch.ts's runDetached) is not a usable model here:
// that one deliberately lets the ORIGINAL (foreground) process exit
// immediately after handing off, which is fine there (nothing should
// survive it) but wrong here (the pid callers key on must stay alive and
// be the SAME thing that supervises CMD for its whole run).
//
// Availability is checked via a DISPOSABLE PROBE FORK (`unshare ... --
// true`, via Bun.spawnSync -- an ordinary fork+wait, fine for a bounded
// throwaway) before ever committing to the irreversible replacement:
// unshare(1)'s own internal unshare(2) syscall can fail (permissions,
// resource limits, a restrictive seccomp/container policy) even when the
// `unshare` BINARY itself is present on PATH, and once this process's
// image has been replaced there is no code left to fall back FROM. Only
// once the probe has already proven the exact invocation succeeds do we
// attempt it for real.
//
// EXPLICIT envp, NOT execvp+ambient environ (load-bearing, found the hard
// way): `process.env[K] = v` in Bun updates Bun's own JS-level mirror only
// -- verified empirically (WSL) that it does NOT call the real libc
// setenv() (a mutated var is absent from /proc/self/environ afterward). A
// raw FFI `execvp(3)` call inherits the process's REAL environ, not Bun's
// mirror, so setting FOREMAN_LAUNCH_PIDNS_INNER via `process.env` and then
// calling execvp silently DROPPED it -- the re-exec'd copy always saw a
// "fresh" (unmarked) environment and bootstrapped again, forever (observed:
// dozens of recursive re-execs before an unrelated resource limit finally
// broke the loop). Fix: use `execve(3)` with an envp array built explicitly
// in JS (current `process.env` entries + our two overrides layered on top),
// so the child's environment is exactly what this code intends regardless
// of whether Bun's env mirror is synced to the kernel's real environ.
import { dlopen, FFIType, ptr } from "bun:ffi";

/** Set on the re-exec'd copy so it knows not to bootstrap again (avoids an
 * infinite unshare-of-unshare loop) and can skip straight to supervise(). */
export const PIDNS_INNER_ENV = "FOREMAN_LAUNCH_PIDNS_INNER";
/** Carries the ORIGINAL (pre-exec) host pid across the re-exec, so the
 * re-exec'd copy's heartbeat can report a pid that's actually meaningful to
 * an external kill-shot -- its OWN process.pid inside the namespace reads
 * as a small namespace-local number (e.g. 1 or 2), not the host-visible pid
 * whoever spawned this launcher captured. */
export const HOST_PID_ENV = "FOREMAN_LAUNCH_HOST_PID";

/** Disposable-probe availability check: forks (never execs/replaces) a
 * throwaway `unshare --pid --mount-proc --fork --kill-child -- true` and
 * reports whether the WHOLE invocation succeeded end to end (exit 0).
 * Never touches this process's own image -- safe to call speculatively,
 * any number of times. */
export function pidnsAvailable(): boolean {
  try {
    const probe = Bun.spawnSync(
      ["unshare", "--pid", "--mount-proc", "--fork", "--kill-child", "--", "true"],
      {
        stdout: "ignore",
        stderr: "ignore",
        // Explicit `env: process.env` (NOT omitted for ambient inheritance):
        // verified empirically that Bun.spawnSync's executable-PATH-search
        // does NOT pick up a live `process.env.PATH` mutation unless `env`
        // is passed explicitly (an ambient-inherit spawn appears to resolve
        // against a cached/native environ snapshot instead) -- without this,
        // a test (or an operator) that overrides PATH to simulate/force
        // "unshare absent" would be silently ignored here.
        env: process.env,
      },
    );
    return probe.exitCode === 0;
  } catch {
    return false; // e.g. ENOENT: `unshare` not resolvable on PATH at all
  }
}

/** Pure, side-effect-free: the argv this process will hand to execve(3).
 * `execPath` is `process.execPath` (this same compiled binary, or the bun
 * interpreter + script in dev — same idiom launch.ts's own runDetached()
 * already uses for self-re-exec). Exported separately from the FFI call
 * itself so `bun test` can assert its shape without any process effects. */
export function buildUnshareArgv(execPath: string, originalArgs: string[]): string[] {
  return ["unshare", "--pid", "--mount-proc", "--fork", "--kill-child", "--", execPath, ...originalArgs];
}

/** Pure, side-effect-free: the envp this process will hand to execve(3) --
 * the current environment (as Bun's process.env sees it: accurate for
 * whatever this process actually inherited at ITS OWN startup, since only
 * post-startup MUTATIONS are the part that doesn't sync back to the real
 * environ) with `overrides` layered on top (last-wins on key collision). */
export function buildEnvp(baseEnv: NodeJS.ProcessEnv, overrides: Record<string, string>): string[] {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v !== undefined) merged[k] = v;
  }
  Object.assign(merged, overrides);
  return Object.entries(merged).map(([k, v]) => `${k}=${v}`);
}

let execveLib: ReturnType<typeof dlopenExecve> | null = null;
function dlopenExecve() {
  return dlopen("libc.so.6", {
    // All three args are raw pointers we build ourselves (see packCArray) --
    // NOT FFIType.cstring, which bun:ffi treats identically to a plain
    // pointer for ARGS (no automatic JS-string-to-C-string conversion on
    // the input side; that only happens for `returns`). Matches the
    // existing dlopen(...mkfifo...) pattern used elsewhere in bun's own
    // test suite: manually encode a NUL-terminated buffer, pass ptr(buffer).
    execve: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  });
}
const execveSym = () => (execveLib ??= dlopenExecve());

/** Packs a NUL-terminated array of char* (argv[] or envp[] shape) for
 * execve(3): one pointer per string, plus a trailing NULL slot. Each
 * string's own backing buffer is returned alongside the packed pointer
 * array purely so the caller keeps a live reference across the FFI call --
 * the call happens synchronously, immediately after, in the same
 * expression's evaluation, so nothing here is actually reachable by a GC
 * pause in between, but returning them keeps that invariant explicit
 * rather than relying on it. */
function packCArray(strings: string[]): { buf: Uint8Array; strBufs: Uint8Array[] } {
  const encoder = new TextEncoder();
  const strBufs = strings.map((s) => encoder.encode(s + "\0"));
  const buf = new Uint8Array(8 * (strBufs.length + 1));
  const view = new DataView(buf.buffer);
  for (let i = 0; i < strBufs.length; i++) {
    view.setBigUint64(i * 8, BigInt(ptr(strBufs[i])), true); // little-endian (x86_64)
  }
  view.setBigUint64(strBufs.length * 8, 0n, true); // NULL terminator
  return { buf, strBufs };
}

/** THE IRREVERSIBLE STEP: replaces this process's own image with `unshare`
 * via execve(3), using `path` (the CALLER-resolved absolute path -- e.g.
 * `Bun.which("unshare")`; execve(3) does NOT search PATH, unlike execvp)
 * and an explicit `envp` (see module header for why this can't just be
 * "whatever this process's environ already is"). execve(3) only returns on
 * failure -- a successful call never returns; this process simply BECOMES
 * `unshare` (same pid, fresh image). Returns (rather than throws) on
 * failure so the caller logs/degrades per the frozen "never silently
 * proceed without the guarantee" rule. */
export function execReplaceWithUnshare(path: string, argv: string[], envp: string[]): { rc: number } {
  const pathStrBuf = new TextEncoder().encode(path + "\0");
  const { buf: argvBuf, strBufs: argvStrBufs } = packCArray(argv);
  const { buf: envpBuf, strBufs: envpStrBufs } = packCArray(envp);
  const rc = execveSym().symbols.execve(ptr(pathStrBuf), ptr(argvBuf), ptr(envpBuf)) as number;
  // execve(3) only returns on error -- reaching here means it failed.
  // These buffers must outlive the call above; referencing them here (a
  // no-op) keeps that requirement visible at the call site.
  void pathStrBuf;
  void argvStrBufs;
  void envpStrBufs;
  return { rc };
}
