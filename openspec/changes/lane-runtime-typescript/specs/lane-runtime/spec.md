# Lane runtime specification

## ADDED Requirements

### Requirement: Round ownership in the runtime

The `lane-round` runtime SHALL own one complete round: admission, launcher
spawn, event mirroring, checkpoint, gate, report assertion, and cleanup.
WHEN `lane-run.sh` starts, it SHALL locate Node, forward its exact arguments
and environment, execute `skills/foreman/runtime/dist/lane-round.js`, and
preserve its exit status and byte streams. `lane-run.sh` SHALL NOT parse
domain data, schedule work, retry work, or supervise processes.

#### Scenario: Adapter forwards a round

- **WHEN** `lane-run.sh --round GATE REPORT RUN LANE WT -- CMD...` runs
- **THEN** `lane-round.js` receives the same argument vector after the adapter name
- **AND** the adapter's exit status equals the runtime's exit status

#### Scenario: Node is absent

- **WHEN** `node` is not on PATH
- **THEN** the adapter prints `lane-run: node is required` to stderr
- **AND** exits 3

### Requirement: Event and heartbeat parity

The runtime SHALL emit the same event types with the same payload fields as
the Bash round of commit `00c342bd449948ab2ea5ca0b9d0c890614dd81d6`. WHEN a
round completes, the `round_done` payload SHALL carry `exit_code` and, on the
launcher-present path, `exit_source`. The heartbeat file SHALL keep its eight
frozen keys.

#### Scenario: Ownership payload is unchanged

- **WHEN** a round spawns CMD under the launcher
- **THEN** the `ownership` payload contains `attempt`, `launcher_pid`, `pid`, `job_id`, `worktree`, `config_dir`, `launcher`, and `containment`

#### Scenario: Bats parity

- **WHEN** `tests/lane-run.bats`, `tests/round-ownership.bats`, and `tests/watch.bats` run against the adapter
- **THEN** every case that passed at the baseline passes

### Requirement: Containment policy in the runtime

WHEN a round starts, the runtime SHALL run the launcher in `--probe-only`
mode and read the capability record. WHILE `LANE_VENDOR` is set or
`FOREMAN_CONTAINMENT_REQUIRE=strong`, IF the capability is not strong and
`FOREMAN_CONTAINMENT_APPROVAL` is empty, THEN the runtime SHALL emit
`alert {kind: "containment_refused"}` and exit 2 before CMD runs. WHEN the
capability is strong, the runtime SHALL send `SIGKILL` to the launcher pid
on cleanup and SHALL NOT signal the namespace-local process group.

#### Scenario: Implementation lane refused

- **WHEN** the capability record says `Degraded` and no approval is set
- **AND** `LANE_VENDOR=grok`
- **THEN** the runtime emits `containment_refused` and exits 2
- **AND** the vendor CLI never starts

#### Scenario: Strong round cleanup

- **WHEN** the runtime receives SIGTERM during a strong round
- **THEN** it sends SIGKILL to the launcher pid
- **AND** a `setsid` descendant of CMD does not survive

### Requirement: Launcher resolution

The runtime SHALL resolve the launcher in this order: `FOREMAN_LAUNCH`,
then `skills/foreman/runtime/dist/foreman-launch.js` under
`FOREMAN_TOOL_ROOT`, then PATH. WHERE `FOREMAN_LAUNCH_IMPL=bun` is set and
`launcher/dist/foreman-launch` exists, the runtime SHALL use that binary and
SHALL NOT pass containment flags to it.

#### Scenario: Node bundle preferred

- **WHEN** `FOREMAN_LAUNCH` is unset and the bundle exists
- **THEN** the runtime spawns `node <bundle>`

#### Scenario: Override is authoritative

- **WHEN** `FOREMAN_LAUNCH` names a missing path
- **THEN** the runtime treats the launcher as absent
- **AND** emits `alert {kind: "degraded", reason: "launcher_absent"}`

### Requirement: Watchdog in the runtime

`watch.sh` SHALL be a thin adapter to `skills/foreman/runtime/dist/lane-watch.js`.
The watch runtime SHALL keep the typed state machine and the exit codes of
the Bash watchdog. WHEN the watched round has an `ownership` event with a
`containment` object, the state line SHALL append `containment=<kind>`.

#### Scenario: DEAD exits 3

- **WHEN** the round's owning pid is gone and no `round_done` exists after the dead threshold
- **THEN** the watch prints the kill-and-retry hint
- **AND** exits 3

### Requirement: Policy pins retired

WHEN this change integrates, `packages/policy/src/architecture-adapter.ts`
SHALL contain no digest pin for `lane-run.sh` or `watch.sh`. Both scripts
SHALL pass the thin-adapter grammar.

#### Scenario: Policy check passes without pins

- **WHEN** `architecture-policy.js check --base 00c342b` runs
- **THEN** the result is `Pass`
- **AND** `LANE_RUN_BODY_SHA256` does not appear in the source

#### Scenario: A domain line is added to the adapter

- **WHEN** a line that parses JSON is added to `lane-run.sh`
- **THEN** the policy check fails with `legacy_adapter_domain_logic`
