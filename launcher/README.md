# foreman-launch

TypeScript-on-Bun supervisor, compiled to a self-contained executable, that
owns a spawned command's whole process tree.

- **Windows**: assigns the child to a Job Object with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` — closing the job's last handle (even
  because the launcher itself was killed) reaps every process still
  assigned to it, kernel-enforced, orphans impossible by construction.
- **POSIX** (WSL/Linux build): bootstraps itself as the init (PID 1) of a
  fresh PID namespace (`unshare --pid --mount-proc --fork --kill-child`),
  then spawns the child under `setsid` inside it. Killing the launcher for
  ANY reason — normal exit, crash, OOM, an external SIGKILL — makes the
  kernel tear down that whole namespace, kernel-enforced, the same
  orphans-impossible guarantee as Windows's Job Object. A subreaper safety
  net and a setsid+pgid fallback (used only if `unshare` is unavailable,
  logged loudly when that happens) round it out — see "POSIX asymmetry"
  below for the full mechanism.

Streams the child's stdout/stderr through unmodified, writes JSON heartbeat
lines to a file, and performs a graded stop on timeout.

## CLI contract (frozen)

```text
foreman-launch [--timeout SECS] [--grace SECS=10] [--heartbeat-file F]
               [--heartbeat-interval SECS=15] [--detach] -- CMD [ARGS...]
foreman-launch --version
```

- stdout/stderr of CMD pass through unmodified.
- CMD's stdin is the null device (`stdin: "ignore"`). The launcher never
  inherits the caller's stdin.
- Heartbeat JSON lines go ONLY to `--heartbeat-file` (if given): one
  immediately at spawn, then one every `--heartbeat-interval` seconds while
  CMD is alive, and one final line after it exits.
- Exit codes: **child's own exit code**; **124** = timeout kill; **125** =
  launcher error (bad args, FFI/spawn failure, `--detach` handoff timeout).
- `Bun.version` is asserted `=== "1.3.14"` at startup; drift only warns
  (stderr), never fails the run.

## Graded stop (binding contract — no cooperative phase)

On `--timeout`, the ENTIRE stop sequence is: wait `--grace` seconds, then
hard-kill (`TerminateJobObject` on Windows / `SIGKILL` the process group on
POSIX). There is no CTRL_BREAK / cooperative-shutdown phase:
`CTRL_BREAK` is impossible to deliver via `Bun.spawn` (it needs a shared
console plus `CREATE_NEW_PROCESS_GROUP`, which the launcher does not set up),
and CMD's stdin is already the null device, so closing it signals nothing to
the child. This is a deliberate, documented simplification (T1 spec REV2,
resolution 1) — do not add a cooperative phase without updating this file,
the header comment in `src/launch.ts`, and the stop test in
`tests/supervise.test.ts` (which is written FIRST in that file, ahead of the
plain exit-code cases, precisely because it pins this contract).

## Heartbeat schema (frozen — T2 consumes these exact field names)

```json
{
  "ts": "2026-07-18T03:24:04.407Z",
  "launcher_pid": 3204,
  "pid": 29008,
  "job_id": "536",
  "alive": true,
  "stdout_bytes": 93,
  "stderr_bytes": 0,
  "elapsed_s": 1.012
}
```

- `launcher_pid` — `process.pid` of the job-owning supervisor (the process
  running this heartbeat loop). Kill-shot tooling targets this field. On
  POSIX, when the pidns bootstrap is active, this is NOT simply
  `process.pid` read from inside the namespace (that would read as a small
  namespace-local number, e.g. `1`, meaningless to a host-side kill) — it's
  the ORIGINAL host pid captured before the bootstrap's self-re-exec,
  carried across via `FOREMAN_LAUNCH_HOST_PID` (see "POSIX asymmetry"
  below). Falls back to plain `process.pid` unchanged on Windows and on the
  POSIX degraded (no-pidns) path.
- `pid` — `Bun.spawn().pid` of CMD's root child. Tree/liveness observation
  keys on this field. On POSIX this also equals the child's process-group id
  (pgid), since `setsid` makes the child its own session/group leader; under
  the pidns bootstrap this pid is namespace-local, which is fine — the
  internal `--timeout`/`--grace` kill path runs from inside that same
  namespace, so it stays self-consistent.
- `job_id` — Windows: the job handle's numeric value, stringified. POSIX: the
  same value as `pid` (there is no separate OS "job" primitive; the pgid IS
  the identifier).
- `alive` — heartbeat-time liveness snapshot; the final line (written right
  after the child exits) always has `alive: false`.

## `--detach`

Foreground `--detach` first resets `--heartbeat-file` to empty (a one-time,
synchronous write that happens strictly BEFORE the detached copy is spawned —
fixed in rework round 1, see below), then self-re-execs the SAME binary
(`Bun.spawn([process.execPath, ...argvSansDetach], {detached: true, stdio:
["ignore","ignore","ignore"], windowsHide: true}).unref()`), then blocks on a
bounded (≤5s) poll of `--heartbeat-file` for the detached copy's FIRST
heartbeat line, then exits 0. `--detach` therefore REQUIRES
`--heartbeat-file` (that is the only handoff signal available) — omitting it
is a usage error (exit 125). The detached copy is the SOLE writer of the
heartbeat file from that point on; the foreground process never touches it
again after the reset.

**F1 fix (rework round 1)**: without the reset, a pre-existing, still-
parseable heartbeat line left over from a PRIOR `--detach` run would let the
bounded poll false-succeed on stale data before the NEW detached copy ever
wrote anything — `supervise()` only ever appends, nothing else truncates F.
Resetting F immediately before spawn (not after, and not via counting
pre-spawn lines) means any parseable line the poll observes afterward is
guaranteed fresh, since nothing else can be writing to F until the detached
copy exists. This reinforces, rather than weakens, the sole-writer
invariant: the reset happens strictly before that writer's lifetime begins.

## Exit codes at a glance

| Code | Meaning |
| --- | --- |
| *(child's own code)* | CMD ran to completion; passthrough |
| `124` | `--timeout` elapsed, grace expired, tree hard-killed |
| `125` | launcher error: bad args, missing `--`, FFI/spawn failure, `--detach` handoff timeout |

## Build

On WSL, `skills/foreman/scripts/foreman-setup.sh` builds the POSIX launcher
automatically when `dist/foreman-launch` is absent and `bun` is available. It
skips an existing executable, so repeated Setup runs do not rebuild it. The
manual fallback is:

```bash
cd launcher && bun run build:posix
```

```powershell
pwsh -File build.ps1
```

Produces `dist/foreman-launch.exe` (Windows x64, **unsigned** — CI signing is
out of scope for local builds). Deliberately **no** `--windows-icon` (no
asset ships in this repo; the flag fails the build without one — Bun #19916
territory) and **never** `--bytecode` (cross-compile hazard, #18416).
`--no-compile-autoload-dotenv --no-compile-autoload-bunfig` are set for
deterministic builds.

POSIX build (run inside WSL/Linux, where `bun` must be installed separately —
see below):

```bash
bun build --compile --target=bun-linux-x64 \
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  src/launch.ts --outfile dist/foreman-launch
```

(equivalently `bun run build:posix` from `package.json`).

Bun is pinned to **1.3.14** (`.bun-version` + `package.json`
`packageManager`). If WSL doesn't have Bun yet:
`curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"`.

## POSIX asymmetry — closed via pidns-init (v0.2.7.5 posix-cascade-parity)

Historically, POSIX process groups had no automatic cascade equivalent to
Windows' `KILL_ON_JOB_CLOSE`: `kill -9 <launcher_pid>` alone left the CMD
subtree fully alive (a plain setsid+pgid launcher is a **cooperative**
mechanism — it only reaps the tree if the launcher's OWN code is still
running to call `kill(-pgid)`). As of v0.2.7.5 the POSIX build closes that
gap for the common case, with a documented, honestly-labeled fallback for
when it can't.

### The mechanism: pidns-init bootstrap (primary guarantee)

On startup the launcher self-re-execs (`launcher/src/posix-bootstrap.ts`,
real `execve(3)` process-image replacement — not spawn+wait, which would
reintroduce an orphan-prone layer; see that file's header for the full
reasoning) under:

```bash
unshare --pid --mount-proc --fork --kill-child -- <this same binary> <original args>
```

This makes the launcher **PID 1 (init) of a fresh PID namespace**. Per
Linux's own pidns semantics: when a namespace's init process dies — normal
exit, crash, OOM, an external SIGKILL, ANY cause — the kernel SIGKILLs
every remaining process in that namespace and tears it down, with zero
polling by foreman. This reaps setsid/detached escapees that a plain
pgid-directed kill would miss, because they're STILL inside the same
namespace even when they're outside CMD's own process group.

`--kill-child` closes the reverse edge: `unshare(1)` itself keeps running
in the host namespace as the launcher's outer wrapper (a Linux pidns
requirement — a process cannot move itself into a new PID namespace, only
its *children* can, so this outer layer is unavoidable, see `unshare(1)`).
If THAT outer process is killed instead of the inner one, `--kill-child`
makes the kernel SIGKILL the forked child (the actual namespace init) too,
which then triggers the same whole-namespace teardown. Either kill target
cascades identically — both were verified empirically on WSL2 (util-linux
`unshare` 2.41.3) before and after writing this code.

**Kill-shot, updated**: unlike the pre-v0.2.7.5 build, a plain
`kill -9 <launcher_pid>` now DOES reap the whole tree, INCLUDING escapees —
no `-pgid` negative-pid trick required. `launcher_pid` in the heartbeat is
the ORIGINAL host pid (captured before the self-re-exec, carried across via
`FOREMAN_LAUNCH_HOST_PID`), which is exactly what `unshare(1)`'s own pid
becomes once the exec commits — so it's a pid any host-side caller (bats,
`lane-run.sh`) already has from having spawned the launcher in the first
place.

### The subreaper safety net (additive)

The launcher also calls `prctl(PR_SET_CHILD_SUBREAPER, 1)` on itself at
startup (`launcher/src/posix.ts`, via `bun:ffi` `dlopen("libc.so.6")`, a
one-shot call with no fork around it and no polling). Any descendant that
re-parents away (its immediate parent already exited) is adopted by the
launcher rather than lost to whatever the nearest real init happens to be.
This is ADDITIVE to the pidns bootstrap above — the pidns cascade is the
guarantee that matters when the launcher itself dies; the subreaper matters
for correctly tracking/adopting orphans while the launcher is still alive,
and it's the only extra guarantee available when pidns bootstrap itself is
degraded (below). A failed `prctl` call is logged and non-fatal.

### The fallback ladder — when `unshare` is unavailable or fails

`unshare`'s own internal `unshare(2)` syscall can fail even when the
`unshare` BINARY is present (permissions, resource limits, a restrictive
container/seccomp policy) — the launcher checks this via a disposable probe
fork (`unshare ... -- true`) BEFORE ever committing to the irreversible
self-replacement, precisely so a failure there doesn't strand the launcher
mid-bootstrap with no code left to fall back from.

1. **Automatic (what this launcher does today)**: fall back to the
   pre-v0.2.7.5 `setsid` + `kill(-pgid)` path, and **log a DEGRADED marker**
   to stderr — never silently proceed as if the kernel-cascade guarantee
   still held. The old asymmetry applies in full here: an external
   `kill -9 <launcher_pid>` will NOT reap a setsid-detached escapee; only
   the launcher's own internal `--timeout`/`--grace` kill path (or an
   external reaper that explicitly sends `-pid`, the pgid recorded in the
   heartbeat's `pid` field) does.
2. **Manual, operator-available, NOT automated by this launcher**: in an
   environment where `unshare --pid` specifically is blocked but
   **systemd + cgroup v2** are available, wrap the launcher invocation in
   `systemd-run --scope --collect -- <launcher> ...`. systemd creates a
   per-invocation transient cgroup scope and — with `--collect` — cleans it
   up (killing any remaining member processes) once the scope's main
   process exits, which is a real, kernel-cgroup-backed whole-tree
   guarantee independent of PID namespaces. This is a documented option for
   whoever is invoking the launcher (e.g. a hardened `lane-run.sh` profile),
   not something `foreman-launch` sets up on its own — it needs its own
   honest availability check (`systemctl --user status` / cgroup v2 mounted
   at `/sys/fs/cgroup`) wherever it's used.

**Availability, plainly**: the primary guarantee needs `unshare` with
`--pid --mount-proc --fork --kill-child` to actually succeed (verified
unprivileged on this WSL2 host); the manual cgroup/systemd-run fallback
needs `systemd` and cgroup v2, and is the OPERATOR's responsibility to wire
up, not this launcher's.

**Conclusion for any external reaper (e.g. lane-run.sh's launcher-absent
fallback sweep)**: recover `launcher_pid` from the last heartbeat line and
send it a plain `SIGKILL` — that's now sufficient whenever the pidns
bootstrap is active (no DEGRADED marker was logged). If a DEGRADED marker
WAS logged for that run, the old asymmetry still applies and `-pid` (the
group, from the heartbeat's `pid` field) is still required for a
setsid-detached escapee specifically.

## Known caveats carried from the research base

- `bun:ffi` is officially experimental; oven-sh/bun#31941 documents a
  trampoline segfault under sustained 100ms FFI polling in compiled exes —
  this launcher never polls FFI (exit detection is `child.exited`;
  heartbeats are a plain `setInterval`).
- Grandchild assignment race (Windows only): a child can spawn a grandchild
  in the microseconds between `Bun.spawn` returning and
  `AssignProcessToJobObject` running. Accepted for v0.2.5 (vendor CLIs boot
  slower than this window); the escalation path, if ever observed, is FFI
  `CreateProcessW` with `CREATE_SUSPENDED`.
- No Windows ARM64 FFI support (#28055) — this is an x64-only artifact.
- `Bun.main.includes("$bunfs")` (not `Bun.isStandaloneExecutable`, undefined
  on 1.3.14) is the correct standalone-executable check if this launcher
  ever needs to resolve embedded-asset paths; not currently used since no
  assets are embedded.
- **`process.env[K] = v` does not reach the real environ** (confirmed via
  `/proc/self/environ` on Bun 1.3.14) — it only updates Bun's own JS-level
  mirror. A raw FFI `execve(3)`/`execvp(3)` call inherits the process's
  REAL environ, not that mirror, so anything that needs a variable to
  survive an FFI exec call must build an explicit `envp` array
  (`posix-bootstrap.ts`'s `buildEnvp()`) rather than relying on a prior
  `process.env` assignment. Found the hard way: relying on the assignment
  produced a silent infinite re-exec loop (the bootstrapped copy never saw
  its own "already inside the namespace" marker).
- **`Bun.spawnSync`'s executable-PATH-search ignores a live
  `process.env.PATH` mutation unless `env` is passed explicitly** to that
  call — an ambient-inherit spawn (no `env` option) appears to resolve
  against a cached/native environ snapshot instead. `pidnsAvailable()`
  always passes `env: process.env` for exactly this reason; without it, an
  operator (or a test) overriding `PATH` to force/simulate "`unshare`
  absent" would be silently ignored.
