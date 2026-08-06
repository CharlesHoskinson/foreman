# Design: launcher-node-port

## Goals

1. Ship a closed `@foreman/launcher` package that runs on Node.js 24 only.
2. Preserve frozen CLI, heartbeat field set, stream separation, null stdin,
   exit codes 124/125, and graded stop (timeout → grace → hard kill).
3. Report platform containment as a closed typed capability before spawn.
4. Use Effect for child lifetime, stream pumps, timers, heartbeat I/O,
   cancellation, and hard termination.
5. Integrate the compiled artifact into root typecheck, tests, build, runtime
   manifest, and install verification.

## Non-goals (this package)

- Native Windows Job Object / kill-on-close parity.
- Switching every shell consumer from `launcher/dist/foreman-launch` to the
  Node bundle.
- Deleting or rewriting the legacy Bun `launcher/` tree.
- Claiming live PID-namespace cascade on hosts where `unshare` probe fails
  (this host: Operation not permitted).
- Hostile escaped-descendant closure proof when the host cannot supply the
  strong kernel path.
- Destruction-register changes.

## Capability model

| State | When | Spawn behavior | Kill behavior | Claim |
| --- | --- | --- | --- | --- |
| `posix_pidns_strong` | probe `unshare --pid --mount-proc --fork --kill-child -- true` succeeds | plan `process.execve` with absolute unshare path, recursion marker, host PID | kernel cascade after successful image replace | strong cascade |
| `posix_process_group_degraded` | probe missing/fails/execve fails | detached process group | `kill(-pgid, SIGKILL)` | no pidns cascade |
| `windows_job_object_unavailable` | always on win32 in this package | ordinary spawn | injectable `taskkill.exe /PID <pid> /T /F` | no Job Object parity |

Capability diagnostics write to stderr only and never contaminate child stdout.

## Effect boundaries

- **Services:** ChildSpawner, ProcessGroupTerminator, WindowsTreeTerminator,
  ExecveService, UnshareProbeService, HeartbeatWriter, ByteSink, LauncherClock,
  DetachSpawner, StderrLog.
- **Pure:** CLI parse, heartbeat format/validate, capability transitions,
  unshare argv/env plans, taskkill argv, exit mapping.
- **Live:** Node `child_process.spawn` with `stdio: ['ignore','pipe','pipe']`,
  `detached` process group on POSIX, `process.execve` only via ExecveService.

## Tests

`node:test` suite covers CLI, streams, timeout/grace/cleanup, heartbeat schema
and write isolation, POSIX plan/degrade, Windows taskkill boundary, detach
handoff `launcher_pid` binding, Effect interruption tree kill, async spawn
error → exit 125, large-payload byte-exact pass-through, bounded live
descendant-churn observation of the launcher PID via `/proc` (typed skip
without `/proc`), and copied-bundle `--version` without repository
`node_modules`. Live strong-path execve is never run inside the test process.

## Status of proof (honest)

| Claim | Status |
| --- | --- |
| Node core CLI, streams, timeout, heartbeat, exit map | proved by package tests |
| Live stdout/stderr drain + large piped byte-exact pass-through | proved via compiled bundle |
| Async spawn `error` event → launcher exit 125 | proved (not child exit 1) |
| Effect interruption after spawn → one tree kill | proved via injectable kill services |
| Detach handoff requires matching `launcher_pid` | proved |
| POSIX process-group fallback + negative-PID kill | proved on this host |
| Bounded churn: worker live + 1000+ descendants; launcher zombie direct children = 0 on `/proc` | proved; typed skip without `/proc` |
| System-wide process-table exhaustion / escaped descendants | open |
| PID-namespace live cascade | designed; host probe Operation not permitted → degraded |
| Windows degraded capability + taskkill shape | proved by pure/injectable tests |
| Windows Job Object parity | open |
| Legacy caller conversion and Bun tree retirement | open |
| Hostile escaped-descendant closure | open without strong host capability |
