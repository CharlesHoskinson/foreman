## ADDED Requirements

### Requirement: Node launcher package surface

The system SHALL provide `@foreman/launcher` as TypeScript source that runs on
Node.js 24. The package SHALL NOT import or invoke Bun or Deno.

#### Scenario: Version names Node

- **WHEN** the launcher is invoked with `--version`
- **THEN** stdout contains `foreman-launch` and `node` and does not contain `bun`

#### Scenario: Frozen CLI and exits

- **WHEN** the launcher is invoked with the frozen flag set and a child command
- **THEN** it accepts `--timeout`, `--grace`, `--heartbeat-file`,
  `--heartbeat-interval`, `--detach`, `--`, maps timeout to exit 124, launcher
  failure to exit 125, and otherwise returns the child exit code

### Requirement: Stream and heartbeat contracts

The launcher SHALL keep child stdout and stderr as separate byte streams, set
child stdin to the null device, and write heartbeat lines only to
`--heartbeat-file` when provided.

#### Scenario: Heartbeat field set

- **WHEN** a heartbeat line is written
- **THEN** it is one JSON object line with exactly the keys `ts`,
  `launcher_pid`, `pid`, `job_id`, `alive`, `stdout_bytes`, `stderr_bytes`,
  and `elapsed_s`

#### Scenario: Immediate and final lines

- **WHEN** a child is supervised with a heartbeat file
- **THEN** one live line is written immediately at spawn and one final line with
  `alive: false` is written after exit

#### Scenario: Detach stale handoff refusal

- **WHEN** `--detach` is used with `--heartbeat-file`
- **THEN** the foreground process resets the heartbeat file before spawning the
  detached copy and accepts only a post-reset valid first line within five
  seconds

### Requirement: Platform containment capabilities

The launcher SHALL resolve a closed platform capability before spawn and SHALL
report degraded results without claiming unavailable parity.

#### Scenario: POSIX strong plan

- **WHEN** the unshare probe succeeds
- **THEN** the launcher plans image replacement with the absolute unshare path,
  exact PID-namespace flags, recursion marker, and host launcher PID, using an
  injectable `process.execve` service

#### Scenario: POSIX degraded process group

- **WHEN** the unshare probe is missing or fails
- **THEN** the launcher reports `posix_process_group_degraded` on stderr, spawns
  a detached process group, and terminates with negative PID signals without
  claiming PID-namespace cascade

#### Scenario: Windows degraded boundary

- **WHEN** the launcher runs on Windows in this package
- **THEN** it reports `windows_job_object_unavailable` before spawn and uses an
  injectable `taskkill.exe /PID <pid> /T /F` boundary without claiming Job
  Object kill-on-close parity

### Requirement: Supervision safety

The launcher SHALL prevent double completion and timer leaks. On hosts that
expose Linux `/proc`, a supervised worker that remains live while creating more
than 1,000 short descendants SHALL leave the launcher process with zero zombie
direct children under that observation. System-wide process-table exhaustion
proof and escaped-descendant closure remain open follow-on.

#### Scenario: Graded stop

- **WHEN** `--timeout` elapses
- **THEN** the launcher waits `--grace` seconds and performs exactly one hard
  tree termination, then clears timers

#### Scenario: Descendant churn (bounded live fixture)

- **WHEN** a supervised worker stays live while creating more than 1,000
  short-lived descendants on a Linux host with `/proc`
- **THEN** observation of the launcher process via `/proc` shows zero zombie
  direct children and a small direct-child count
- **WHEN** `/proc` is unavailable
- **THEN** the control records a typed skip rather than claiming a false zero

### Requirement: Runtime artifact

The build SHALL emit a deterministic self-contained
`skills/foreman/runtime/dist/foreman-launch.js` bound in the runtime manifest
and executable from a copied skill tree without repository `node_modules`.

#### Scenario: Copied bundle version

- **WHEN** the compiled bundle is copied outside the repository and run with
  `--version`
- **THEN** it exits 0 and prints a Node version line without resolving repository
  `node_modules`
