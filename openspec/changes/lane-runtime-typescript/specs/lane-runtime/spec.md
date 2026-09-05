# Lane runtime specification

## ADDED Requirements

### Requirement: Round ownership in the runtime

The `lane-round` runtime SHALL own one complete round: admission, launcher
spawn, event mirroring, checkpoint, gate, report assertion, and cleanup.

#### Scenario: Runtime owns the round

- **WHEN** a round runs through `lane-round.js`
- **THEN** every event of the round is appended by the runtime process or its children
- **AND** no Bash process appends an event

### Requirement: Thin adapter forwarding

WHEN `lane-run.sh` starts, it SHALL execute
`skills/foreman/runtime/dist/lane-round.js` with the same argument vector
after the adapter name and the same environment. The adapter SHALL preserve
the runtime's exit status and byte streams. The adapter SHALL NOT parse
domain data, schedule work, retry work, or supervise processes.

#### Scenario: Adapter forwards a round

- **WHEN** `lane-run.sh --round GATE REPORT RUN LANE WT -- CMD...` runs
- **THEN** `lane-round.js` receives `--round GATE REPORT RUN LANE WT -- CMD...`
- **AND** the adapter's exit status equals the runtime's exit status

#### Scenario: Node is absent

- **WHEN** `node` is not on PATH
- **THEN** the adapter prints `lane-round: node is required` to stderr
- **AND** exits 3

### Requirement: Event parity

The runtime SHALL emit the same event types with the same payload fields as
the Bash round of commit `00c342bd449948ab2ea5ca0b9d0c890614dd81d6`.

#### Scenario: Ownership payload is unchanged

- **WHEN** a round spawns CMD under the launcher
- **THEN** the `ownership` payload contains `attempt`, `launcher_pid`, `pid`, `job_id`, `worktree`, `config_dir`, `launcher`, and `containment`

#### Scenario: Round done carries exit source

- **WHEN** a launcher-present round completes
- **THEN** the `round_done` payload carries `exit_code` and `exit_source`

### Requirement: Heartbeat parity

The heartbeat file SHALL keep its eight frozen keys and its line order.

#### Scenario: Heartbeat keys unchanged

- **WHEN** the runtime mirrors a heartbeat line
- **THEN** the line has exactly the keys `ts`, `launcher_pid`, `pid`, `job_id`, `alive`, `stdout_bytes`, `stderr_bytes`, `elapsed_s`

### Requirement: Bats parity

WHEN `tests/lane-run.bats`, `tests/round-ownership.bats`, and
`tests/watch.bats` run against the adapters, every case that passed at the
baseline SHALL pass. The report-freshness parity fixture SHALL set the
report's modification time before the round start, so only the `attempt`
match can satisfy freshness.

#### Scenario: Bats parity holds

- **WHEN** the three Bats files run
- **THEN** the pass set equals the baseline pass set

#### Scenario: Stale report with matching attempt

- **WHEN** a gate writes a report with `attempt: 2` during attempt 1 and an old modification time
- **THEN** the round records `round_incomplete`

### Requirement: Containment probe execution

WHEN a round starts and a launcher is resolved, the runtime SHALL run the
launcher with `--probe-only --capability-file <WT>/.harness/capability.json
--require-containment any` before CMD is spawned. IF no launcher is
resolved, THEN the runtime SHALL emit
`alert {kind: "degraded", reason: "launcher_absent"}`, SHALL skip the
probe, and SHALL skip the containment decision, as the baseline did.

#### Scenario: Probe runs before spawn

- **WHEN** a launcher is resolved
- **THEN** the probe invocation precedes the CMD spawn in the launcher argv log

#### Scenario: Launcher absent

- **WHEN** `FOREMAN_LAUNCH` names a missing path
- **THEN** the runtime emits the `launcher_absent` alert
- **AND** runs no probe and makes no containment decision

### Requirement: Capability record reading

WHEN the probe has run, the runtime SHALL read `tag`, `kind`, and `reason`
from the record. IF the record is absent or unparsable, THEN the runtime
SHALL use `tag = Unknown`, `kind = unknown`, `reason = capability_file_missing`
and SHALL treat the capability as not strong.

#### Scenario: Record read

- **WHEN** the probe writes a `Strong` record
- **THEN** the runtime records `strong = true`

#### Scenario: Record malformed

- **WHEN** the record is not valid JSON
- **THEN** the runtime records `Unknown`, `unknown`, `capability_file_missing`
- **AND** `strong = false`

### Requirement: Containment decision table

WHEN a probe has run, the runtime SHALL decide admission from three
inputs: `strong` (the record tag is `Strong` or `AlreadyInner`), `require`
(`FOREMAN_CONTAINMENT_REQUIRE` when set, otherwise `strong` when
`LANE_VENDOR` is set, otherwise `any`), and `approval`
(`FOREMAN_CONTAINMENT_APPROVAL`, empty or text). The table is total. A dash
means the input does not affect the row.

| strong | require | approval | decision |
|---|---|---|---|
| true | strong | dash | proceed, `require_effective = strong` |
| true | any | dash | proceed, `require_effective = strong` |
| false | any | dash | proceed degraded, one `degraded` alert, `require_effective = any` |
| false | strong | empty | refuse, `containment_refused` alert, exit 2 |
| false | strong | text | proceed degraded, alert carries the approval, `require_effective = any` |

WHEN the decision is refuse, the runtime SHALL emit
`alert {kind: "containment_refused", tag, capability_kind, reason, required: "strong"}`,
print `lane-round: REFUSED containment=<kind> reason=<reason> required=strong`,
and exit 2 before CMD runs. WHEN the decision is proceed degraded, the
runtime SHALL emit `alert {kind: "degraded", reason: "containment_<reason>", capability_kind, approval}`
once per round. The ownership payload SHALL carry
`containment: {tag, kind, reason, approval}`.

#### Scenario: Implementation lane refused

- **WHEN** the Node launcher's probe runs with a PATH that has no `unshare`, so the record says `Degraded` with reason `unshare_missing`
- **AND** `LANE_VENDOR=grok` and no approval is set
- **THEN** the runtime emits `containment_refused` and exits 2
- **AND** the vendor CLI never starts

#### Scenario: Explicit any with a vendor

- **WHEN** `FOREMAN_CONTAINMENT_REQUIRE=any` and `LANE_VENDOR=grok` and the record says `Degraded`
- **THEN** the round proceeds degraded with one `degraded` alert

#### Scenario: Approval recorded

- **WHEN** `FOREMAN_CONTAINMENT_APPROVAL="operator accepted"` admits a degraded round
- **THEN** the `degraded` alert and the `ownership` payload both carry `approval: "operator accepted"`

### Requirement: Spawn-time enforcement

WHEN the runtime spawns CMD or the gate under a launcher that produced a
record, it SHALL pass `--require-containment <require_effective>`, where
`require_effective` is `strong` when `strong` is true and `any` otherwise.
The CMD spawn SHALL also pass `--capability-file`. WHEN the record was
absent or malformed, the runtime SHALL pass neither flag.

#### Scenario: Strong round cannot silently degrade

- **WHEN** the probe said `Strong` and the launcher later cannot enter a namespace
- **THEN** the launcher refuses with exit 125 and the round records `exit_source: launcher`

#### Scenario: Recordless launcher gets no flags

- **WHEN** `FOREMAN_LAUNCH` names a launcher that writes no capability record
- **THEN** the spawn argv contains no `--require-containment`

### Requirement: Kill target

WHEN the runtime cleans up a round with `strong` true, it SHALL send
`SIGKILL` to the launcher pid and SHALL NOT signal the process group named
by the heartbeat `pid`. WHEN `strong` is false, it SHALL send `SIGTERM` to
the negative heartbeat `pid` and then `SIGTERM` to the launcher pid, as the
baseline did.

#### Scenario: Strong round cleanup

- **WHEN** the runtime receives SIGTERM during a strong round
- **THEN** it sends SIGKILL to the launcher pid
- **AND** a `setsid` descendant of CMD does not survive

#### Scenario: Degraded round cleanup

- **WHEN** the runtime receives SIGTERM during a degraded round
- **THEN** it signals the process group first, then the launcher

### Requirement: Launcher resolution

The runtime SHALL resolve the launcher in this order: `FOREMAN_LAUNCH`,
then `node <FOREMAN_TOOL_ROOT>/skills/foreman/runtime/dist/foreman-launch.js`,
then PATH. The runtime SHALL NOT read `FOREMAN_LAUNCH_IMPL`. This is an
intentional departure from the baseline: the POSIX Bun fallback retires in
tranche 3 and the runtime is written for that end state.

#### Scenario: Node bundle preferred

- **WHEN** `FOREMAN_LAUNCH` is unset and the bundle exists
- **THEN** the runtime spawns `node <bundle>`

#### Scenario: Override is authoritative

- **WHEN** `FOREMAN_LAUNCH` names a missing path
- **THEN** the runtime treats the launcher as absent

### Requirement: Watchdog in the runtime

`watch.sh` SHALL be a thin adapter to
`skills/foreman/runtime/dist/lane-watch.js`. The watch runtime SHALL keep
the typed state machine, the exit codes, and the stderr lines of the Bash
watchdog at the baseline. WHEN the watched round has an `ownership` event
with a `containment` object, the state line SHALL append
`containment=<kind>`.

#### Scenario: DEAD exits 3

- **WHEN** the round's owning pid is gone and no `round_done` exists after the dead threshold
- **THEN** the watch prints the kill-and-retry hint
- **AND** exits 3

#### Scenario: Node absent for the watchdog

- **WHEN** `node` is not on PATH
- **THEN** `watch.sh` prints `lane-watch: node is required` and exits 3

### Requirement: Policy pins retired

WHEN this change integrates, `packages/policy/src/architecture-adapter.ts`
SHALL contain no digest pin for `lane-run.sh` or `watch.sh`, and both
scripts SHALL pass the thin-adapter grammar unchanged.

#### Scenario: Policy check passes without pins

- **WHEN** `architecture-policy.js check --base 00c342bd449948ab2ea5ca0b9d0c890614dd81d6` runs
- **THEN** the result is `Pass`
- **AND** `LANE_RUN_BODY_SHA256` does not appear in the source

#### Scenario: A domain line is added to the adapter

- **WHEN** a line that parses JSON is added to `lane-run.sh`
- **THEN** the policy check fails with `legacy_adapter_domain_logic`
