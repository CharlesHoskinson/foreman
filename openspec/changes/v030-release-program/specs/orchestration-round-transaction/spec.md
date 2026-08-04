# Spec delta: attempt-bound round transaction

## ADDED Requirements

### Requirement: one round plan binds one attempt

WHEN Foreman starts a durable round, `@foreman/orchestration` SHALL allocate one
attempt identity before it records the prompt event.

`RoundPlanV1` SHALL contain `schemaVersion: 1`, `runId`, `laneId`, `attemptId`,
`mode: "round"`, `commandArgv`, `gateCommand`, `reportPath`, and
`reportBaseline`.

`RoundRequestV1` SHALL contain `runId`, `laneId`, `commandArgv`, `gateCommand`,
and `reportPath`. It SHALL NOT contain `attemptId` or `reportBaseline`.

The attempt allocator SHALL be the only source of `RoundPlanV1.attemptId`. The
captured baseline SHALL be the only source of `RoundPlanV1.reportBaseline`.

The prompt event SHALL store the complete plan under `payload.roundPlan`. The
prompt event SHALL also store the numeric attempt ID under `payload.attempt`.

Every structural event in the round SHALL store the same numeric attempt ID
under `payload.attempt`.

#### Scenario: an event has a different attempt

- WHEN the reducer reads an event with a different lane ID or attempt ID
- THEN the reducer returns a typed invalid-transition result
- AND the reducer does not change the round state.

#### Scenario: a legacy prompt has no round plan

- WHEN recovery reads a prompt with no `payload.roundPlan`
- THEN recovery returns `LegacyUnbound`
- AND recovery does not reconstruct a plan from `payload.cmd`
- AND recovery does not interpret a missing mode as `plain`.

### Requirement: round inputs are byte-bounded and preserve arguments

WHEN Foreman decodes a round plan, the decoder SHALL apply these UTF-8 byte
bounds:

- `commandArgv` has at most 256 entries.
- Each command argument has at most 65,536 bytes.
- All command arguments together have at most 1,048,576 bytes.
- `gateCommand` has at most 1,048,576 bytes.
- `reportPath` has at most 32,768 bytes.
- Report content has at most 8,388,608 bytes.

The decoder SHALL reject NUL in a command argument, gate command, or report
path. `commandArgv` SHALL contain at least one entry. Its first entry SHALL be
nonempty. Later empty entries SHALL remain unchanged.

The implementation SHALL pass `commandArgv` as an argument vector. It SHALL
NOT join, split, quote, or escape the vector.

#### Scenario: a later argument is empty

- WHEN `commandArgv` contains an empty entry after its first entry
- THEN the implementation command receives the empty entry unchanged.

#### Scenario: the total command bytes exceed the bound

- WHEN the UTF-8 byte total of `commandArgv` exceeds 1,048,576
- THEN plan decoding fails with a typed contract failure
- AND no round event is recorded.

### Requirement: report freshness uses content identity only

`ReportSnapshotV1` SHALL be `Absent` or `Present`. A present snapshot SHALL
contain a lowercase 64-character SHA-256 digest and a nonnegative
`byteLength`. A present snapshot with `byteLength: 0` SHALL represent an empty
file.

WHEN Foreman starts a round, it SHALL capture the report baseline before it
records the prompt event. WHEN the gate completes, Foreman SHALL capture the
post-gate report snapshot.

A report SHALL be fresh only when the post-gate snapshot is present, nonempty,
within 8,388,608 bytes, and content-different from the baseline. An absent
baseline followed by a valid present snapshot SHALL be fresh.

`ReportSnapshotReader` SHALL enforce the 8,388,608-byte report-content bound.
It SHALL return a typed `report_too_large` failure before it retains content
above that bound.

The implementation SHALL NOT use modification time, filename patterns, or
report text patterns as freshness evidence.

#### Scenario: the gate rewrites identical report bytes

- WHEN the post-gate report digest equals the baseline digest
- THEN the round outcome is incomplete
- AND the reason is `report_unchanged`.

#### Scenario: the post-gate report read fails

- WHEN the post-gate report read returns a typed read failure
- THEN the round outcome is incomplete
- AND the reason is `report_read_failed`.

#### Scenario: the post-gate report is empty

- WHEN the post-gate snapshot is present with `byteLength: 0`
- THEN the round outcome is incomplete
- AND the reason is `report_empty`.

### Requirement: the transaction records one closed event sequence

`RoundOutcomeV1` SHALL be `completed` or `incomplete`. A completed outcome
SHALL require gate exit code zero, `reportFresh: true`, and report evidence.

A completed outcome SHALL contain `_tag: "completed"`, the exact attempt
identity, `implementationExitCode`, `gateExitCode: 0`, `reportFresh: true`,
`reportBaseline`, and the present post-gate snapshot under `report`.

An incomplete outcome SHALL contain `_tag: "incomplete"`, the exact attempt
identity, `implementationExitCode`, `gateExitCode`, `reportFresh: false`, one
closed `reason`, `reportBaseline`, and `report`. The `report` field SHALL be a
snapshot or `null`. It SHALL be `null` only when the post-gate reader returns
`report_too_large` or `report_read_failed`.

The closed incomplete-reason set SHALL be `gate_failed`, `report_missing`,
`report_empty`, `report_unchanged`, `report_too_large`, and
`report_read_failed`. Exit codes SHALL be integers from 0 through 255.

The outcome decision SHALL use this first-match order:

1. A nonzero gate exit selects `gate_failed`.
2. A post-gate `report_too_large` reader failure selects `report_too_large`.
3. Any other post-gate reader failure selects `report_read_failed`.
4. An absent post-gate snapshot selects `report_missing`.
5. A zero-byte present snapshot selects `report_empty`.
6. A post-gate digest equal to the present baseline selects
   `report_unchanged`.
7. All remaining inputs select `completed`.

`round_done.payload` SHALL contain `attempt` and the completed outcome under
`outcome`. `waiting_child.payload` SHALL contain `attempt` and the incomplete
outcome under `outcome`. The terminal alert payload SHALL contain `attempt`,
`kind: "round_incomplete"`, and the same incomplete outcome under `outcome`.

The successful event order SHALL be:

1. `prompt`
2. zero or more annotation events
3. `state` with `verifying`
4. `round_done`

The incomplete event order SHALL be:

1. `prompt`
2. zero or more annotation events
3. `state` with `verifying`
4. `waiting_child`
5. `alert` with `round_incomplete`

The reducer states SHALL be `Unstarted`, `Implementing`, `Verifying`,
`Completed`, and `Incomplete`.

The reducer SHALL reject duplicate prompt, verifying, or terminal events. It
SHALL reject a terminal event before verifying. It SHALL reject missing
attempt identity and conflicting outcomes.

#### Scenario: implementation exits nonzero

- WHEN the implementation command returns a nonzero exit code
- THEN Foreman captures a checkpoint
- AND Foreman records the verifying state
- AND Foreman runs the gate command.

#### Scenario: the gate fails

- WHEN the gate returns a nonzero exit code
- THEN Foreman records `waiting_child`
- AND Foreman records `round_incomplete`
- AND the incomplete reason is `gate_failed`.

#### Scenario: the gate fails and the report is missing

- WHEN the gate returns a nonzero exit code
- AND the post-gate snapshot is absent
- THEN the incomplete reason is `gate_failed`.

### Requirement: Effect owns transaction boundaries

`@foreman/orchestration` SHALL expose Effect services named
`AttemptAllocator`, `RoundEventSink`, `ReportSnapshotReader`,
`ImplementationCommand`, `CheckpointCapture`, and `GateCommand`.

The transaction SHALL run these operations in order:

1. Allocate the attempt.
2. Capture the report baseline.
3. Durably record the prompt.
4. Run the implementation command.
5. Capture the checkpoint.
6. Durably record the verifying state.
7. Run the gate command.
8. Capture the post-gate report snapshot.
9. Decide the outcome.
10. Durably record the terminal sequence.

The implementation SHALL use injected services for every fallible boundary.
It SHALL fail closed on allocation, durable append, command transport,
checkpoint, or baseline-read failure. It SHALL NOT invent attempt `1`. It
SHALL NOT retry a transaction implicitly.

#### Scenario: prompt append fails

- WHEN the event sink fails while recording the prompt
- THEN the implementation command does not start
- AND the transaction returns a typed boundary failure.

#### Scenario: the transaction is interrupted after verifying

- WHEN the Effect fiber is interrupted after the verifying event is durable
- THEN recovery observes the exact attempt identity
- AND recovery does not synthesize a terminal outcome.

### Requirement: recovery preserves exact round identity

`recoverRoundAttempt` SHALL return exactly one of `Recoverable`, `Completed`,
`LegacyUnbound`, or `Invalid`.

A recoverable result SHALL contain the exact stored round plan. It SHALL also
contain a checkpoint identity with the exact attempt identity and nonempty
checkpoint commit.

A `Completed` recovery result SHALL mean that replay found a durable terminal
event. It SHALL contain the exact attempt identity and the exact stored
`RoundOutcomeV1`. Its outcome MAY have `_tag: "completed"` or
`_tag: "incomplete"`.

Recovery SHALL read a completed outcome only from `round_done.payload.outcome`.
Recovery SHALL read an incomplete outcome only from a terminal
`alert.payload.outcome` whose kind is `round_incomplete`. A `waiting_child`
event alone SHALL remain recoverable and SHALL NOT become `Completed`.

Recovery SHALL reject interleaved or conflicting events for the selected
attempt. Recovery SHALL NOT read external process state. Recovery SHALL NOT
launch a process, restore a worktree, enqueue a supervisor task, access a
credential, or scan the filesystem.

#### Scenario: two attempts are interleaved

- WHEN replay contains events for two attempt IDs
- THEN recovery selects only the exact requested attempt
- AND an event from the other attempt cannot advance the selected reducer.

### Requirement: R2 is a pure transaction core

This slice SHALL NOT modify the legacy `lane-run.sh` adapter. This slice SHALL
NOT implement filesystem attempt allocation, filesystem event append, process
launch, worktree restore, supervisor enqueue, external process-state reads,
credential access, secret scans, or Windows Job Objects.

#### Scenario: a legacy adapter would require product logic

- WHEN a proposed change requires new shell product logic
- THEN the implementer leaves the adapter unchanged
- AND the implementer reports the later integration requirement.
