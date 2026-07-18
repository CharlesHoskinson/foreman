# Design — posix-cascade-parity

## Research basis (2026-07-18, probed live on this WSL)

WSL2 Ubuntu-26.04, kernel 6.18.33.1-microsoft-standard-WSL2. All findings
reproduced via `wsl -u root`.

| Mechanism | Guarantee | WSL2 (probed) | Bun-impl |
|---|---|---|---|
| PID-namespace init death | Kernel SIGKILLs ALL namespace processes when init (PID 1) dies — the true KILL_ON_JOB_CLOSE analog (man pid_namespaces(7)) | works; `unshare --user --pid --fork --kill-child` runs WITHOUT CAP_SYS_ADMIN (capsh drop test passed) | via outer `unshare` wrapper at process start (a process can't self-enter a new pidns) |
| `--kill-child` (PDEATHSIG) | ties the forked child's death to unshare's own death | reproduced: killing `unshare` killed its `sleep` child | same wrapper |
| `cgroup.kill` (cgroup v2) | atomic SIGKILL of the whole cgroup on write "1" | confirmed: cgroup2 mounted w/ nsdelegate; wrote 1 to a test scope's cgroup.kill → process vanished, cgroup auto-removed | needs an external writer on launcher death — fallback only |
| `systemd-run --scope --collect` | scope torn down on explicit kill or command exit; NOT on unrelated-parent death | confirmed: systemd running (PID 1), scope created + auto-GC'd | fallback: graceful per-session kill + observability |
| `PR_SET_CHILD_SUBREAPER` | reparenting only, NO kill | plain syscall | one-shot `prctl` via bun:ffi libc dlopen |

**Decision:** pidns-init wrapping is primary (zero polling, kernel-guaranteed,
unprivileged on WSL). Subreaper is the additive net. cgroup/systemd is the
documented fallback for hosts where full pidns wrapping conflicts with the
existing `/proc`-based telemetry. `setsid`+`kill(-pgid)` remains the graceful
fast path.

**Caveats carried into the spec as honest limits:** cgroup delegation to a
non-root user was NOT probed (root-only instance); `bun:ffi prctl` rests on
Bun's documented libc-dlopen pattern, not a direct test (Bun absent in the
probed WSL). The pidns bootstrap is the load-bearing path and does not depend
on either.

## Approach

The launcher gains a thin bootstrap: when the POSIX build starts, re-exec (or
be invoked) under `unshare --pid --mount-proc --fork --kill-child`. `--mount-proc`
gives the namespace a correct `/proc` for the launcher's own telemetry. The
launcher then `prctl`s itself as subreaper and runs its normal supervise loop;
teardown is now kernel-automatic on launcher death. Fall back + log on any
`unshare` failure. WSL bats build the escapee tree, kill the launcher, assert
zero survivors.

## Execution

Implementer: **Sonnet 5**. Audit: **Opus 4.8**. The kill-shot test is the
package's SC-style proof.
