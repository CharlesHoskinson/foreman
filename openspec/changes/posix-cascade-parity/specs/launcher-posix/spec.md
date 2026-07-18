# Spec delta — POSIX launcher whole-tree teardown parity

EARS-phrased. See `skills/foreman/references/five-part-spec.md`. Windows
build behavior is frozen; these requirements apply to the POSIX build/run
path only.

## ADDED Requirement: the POSIX launcher runs as PID-namespace init

WHERE the POSIX build is used, the launcher SHALL be bootstrapped as the init
(PID 1) of a fresh PID namespace via `unshare --pid --mount-proc --fork
--kill-child -- <launcher> …`, so that the kernel SIGKILLs every process in
the namespace when the launcher terminates for any reason.

- WHEN the launcher process dies (normal exit, crash, OOM, SIGKILL), the
  kernel SHALL reap every descendant in the namespace, including
  double-forked / `setsid`-detached processes, with no polling by foreman.
- WHILE `unshare` with the required options is unavailable or fails, the
  launcher SHALL fall back to the `setsid` + `kill(-pgid)` path and SHALL log
  the downgrade (an operator-visible degraded marker), never silently
  proceeding without the guarantee.
- `--kill-child` SHALL be set so that if the outer `unshare` wrapper dies,
  the launcher (its child) receives SIGKILL — closing the reverse edge.

#### Scenario: killing the launcher reaps a double-forked escapee

- WHEN a CMD under the pidns-wrapped launcher spawns a grandchild that
  `setsid`s and double-forks to escape its process group
- AND the launcher is then killed with SIGKILL
- THEN no process from that CMD tree survives (verified by post-kill scan of
  the namespace / `ps` for the recorded pids), whereas the pgid-only path
  would leave the escapee alive.

## ADDED Requirement: a subreaper safety net keeps escapees reapable

The POSIX launcher SHALL call `prctl(PR_SET_CHILD_SUBREAPER, 1)` on itself at
startup (via `bun:ffi` `dlopen("libc.so.6")`), so that any process which
re-parents away is adopted by the launcher rather than lost to real init.

- The `prctl` call SHALL be a one-shot on the launcher's own thread (no fork
  around it), and IF it fails, THEN the launcher SHALL continue (the pidns
  bootstrap is the primary guarantee; the subreaper is additive) and log the
  failure.

## ADDED Requirement: exit-code and heartbeat contract is unchanged

The pidns bootstrap SHALL NOT change the frozen launcher contract: exit code
= child's / 124 timeout / 125 launcher error, the heartbeat schema
`{ts,launcher_pid,pid,job_id,alive,stdout_bytes,stderr_bytes,elapsed_s}`, and
stdio passthrough. `job_id` on POSIX MAY carry the namespace/pgid identifier;
its presence and shape SHALL remain as the Windows build documents.

#### Scenario: contract parity across builds

- WHEN a CMD exits 3 under the POSIX pidns launcher
- THEN the launcher exits 3 and emits a final heartbeat with `alive:false`,
  identical in shape to the Windows build.

## MODIFIED Requirement: the launcher README documents the closed asymmetry

`launcher/README.md`'s "POSIX asymmetry" section SHALL be updated from "no
kernel cascade" to describe the pidns-init cascade as the parity mechanism,
the `--kill-child` reverse edge, the subreaper net, and the fallback ladder
(per-session cgroup + `systemd-run --scope --collect`), with the honest note
that the guarantee requires `unshare` and (for the fallback) systemd/cgroup-v2
availability.
