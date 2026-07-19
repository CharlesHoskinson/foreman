# Change: posix-cascade-parity

## Why

foreman-launch's Windows build gets a kernel-guaranteed whole-tree kill via
Job Objects `KILL_ON_JOB_CLOSE`: closing the last handle (including on
launcher crash) reaps the entire process tree by construction. The POSIX
build (Bun, runs on WSL2) has only `setsid` + `kill(-pgid)`: a
double-fork/`setsid` escapee survives, and if the launcher itself dies there
is NO kernel cascade. v0.3.0 will run vendor-CLI sessions on WSL through this
build, so the asymmetry — documented as an honest limit in v0.2.5 — becomes
load-bearing.

Live probing on this host's WSL (2026-07-18) confirmed the Linux analog: a
process cannot re-parent itself into a new PID namespace, but if the launcher
is *bootstrapped as* PID 1 of a fresh PID namespace, the kernel SIGKILLs
every process in that namespace the instant its init dies — crash, OOM,
SIGKILL — however deeply double-forked. This is the true `KILL_ON_JOB_CLOSE`
parity, and `unshare --pid --fork --kill-child` provides it with zero polling
and zero custom native code.

## What changes

- The POSIX launcher gains a namespace-init bootstrap: it is invoked under
  `unshare --pid --mount-proc --fork --kill-child`, making the launcher the
  namespace init so its death cascades to the whole tree.
- `PR_SET_CHILD_SUBREAPER` (via `bun:ffi` `prctl`) as a safety net so any
  escapee remains reapable/discoverable.
- The existing `setsid` + `kill(-pgid)` path stays the graceful fast path.
- A documented fallback ladder (per-session cgroup + `systemd-run --scope
  --collect`) for hosts where full pidns wrapping conflicts with telemetry.
- WSL bats kill-shot tests proving the cascade.

## Impact

- Affected: `launcher/src/posix.ts` (and its bootstrap wrapper),
  `launcher/README.md` (the POSIX-asymmetry section becomes "closed via
  pidns"), `tests/launcher.bats` (WSL-guarded kill-shot),
  `skills/foreman/references/orchestration-hardening.md` (the POSIX teardown
  doctrine).
- The Windows build is unchanged.
- Adds a runtime dependency on `unshare` (util-linux, present in Ubuntu) for
  the POSIX guarantee; the fast path degrades gracefully where absent.
