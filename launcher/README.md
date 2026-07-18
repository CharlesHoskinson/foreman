# foreman-launch

TypeScript-on-Bun supervisor, compiled to a self-contained executable, that
owns a spawned command's whole process tree.

- **Windows**: assigns the child to a Job Object with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` — closing the job's last handle (even
  because the launcher itself was killed) reaps every process still
  assigned to it, kernel-enforced, orphans impossible by construction.
- **POSIX** (WSL/Linux build): spawns the child under `setsid` so it becomes
  its own session/process-group leader; the whole tree shares that pgid via
  ordinary fork inheritance. This is a **cooperative** mechanism, not a
  kernel-enforced one — see "POSIX asymmetry" below.

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
  running this heartbeat loop). Kill-shot tooling targets this field.
- `pid` — `Bun.spawn().pid` of CMD's root child. Tree/liveness observation
  keys on this field. On POSIX this also equals the child's process-group id
  (pgid), since `setsid` makes the child its own session/group leader.
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

## POSIX asymmetry (important — read before wiring an external reaper)

Unlike Windows' `KILL_ON_JOB_CLOSE` (a **kernel-enforced** guarantee that
fires even if the launcher process itself is killed without ever running its
own cleanup code), POSIX process groups have no equivalent automatic
cascade. Empirically verified on WSL2 (util-linux setsid 2.41.3):

- `setsid ./foreman-launch --heartbeat-file hb -- sh -c 'sleep 60 & sleep 60'`
  produces a launcher with its own pgid (say `L`) and a CMD subtree with a
  DIFFERENT pgid (say `C`, recorded as the heartbeat's `pid` field) — the
  launcher wraps the CMD in its own `setsid`, so the two are independent
  sessions.
- `kill -9 L` (killing ONLY the launcher pid) leaves the `C` process group
  fully alive — no cascade.
- `kill -9 -C` (a **group-directed** signal using the pgid recorded in the
  heartbeat's `pid` field) reaps the whole subtree.

**Conclusion for any external reaper (e.g. lane-run.sh's launcher-absent
fallback sweep)**: on POSIX, recover the `pid` field from the last heartbeat
line and send the signal to `-pid` (the group), not to `launcher_pid` alone.
The Windows kill-shot semantics (`taskkill /PID launcher_pid /F` reaps
everything) do NOT carry over to the POSIX build as-is.

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
