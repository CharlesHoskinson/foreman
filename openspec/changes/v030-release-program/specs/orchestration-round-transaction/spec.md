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

A completed outcome SHALL contain `_tag: "completed"`,
`attemptIdentity: AttemptIdentity`, `implementationExitCode`,
`gateExitCode: 0`, `reportFresh: true`, `reportBaseline`, and the present
post-gate snapshot under `report`.

An incomplete outcome SHALL contain `_tag: "incomplete"`,
`attemptIdentity: AttemptIdentity`, `implementationExitCode`, `gateExitCode`,
`reportFresh: false`, one closed `reason`, `reportBaseline`, and `report`. The
`report` field SHALL be a snapshot or `null`. It SHALL be `null` only when the
post-gate reader returns `report_too_large` or `report_read_failed`.

`AttemptIdentity` SHALL be the exact `{ runId, laneId, attemptId }` type
exported by `@foreman/event-log`. Every stored outcome and its enclosing event
payload SHALL describe the same attempt identity. The numeric
`payload.attempt` SHALL equal `outcome.attemptIdentity.attemptId`.

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

The transaction SHALL record exactly one `checkpoint` event after checkpoint
capture and before the verifying-state event. Its top-level `commit` SHALL be
nonempty. Its payload SHALL contain the numeric attempt under `attempt`. The
top-level `commit` is the sole durable checkpoint-commit source for R2
recovery.

The recognized nonterminal round annotations SHALL be `ownership`,
`heartbeat`, and `checkpoint`. An `ownership` or `heartbeat` event for the
selected attempt leaves reducer state unchanged. The transaction core itself
SHALL emit the required `checkpoint`; injected boundaries MAY durably append
zero or more `ownership` or `heartbeat` annotations.

The successful event order SHALL be:

1. `prompt`
2. zero or more `ownership` or `heartbeat` annotations
3. exactly one `checkpoint` with a nonempty top-level `commit`
4. zero or more `ownership` or `heartbeat` annotations
5. `state` with `verifying`
6. `round_done`

The incomplete event order SHALL be:

1. `prompt`
2. zero or more `ownership` or `heartbeat` annotations
3. exactly one `checkpoint` with a nonempty top-level `commit`
4. zero or more `ownership` or `heartbeat` annotations
5. `state` with `verifying`
6. `waiting_child`
7. `alert` with `round_incomplete`

The reducer states SHALL be `Unstarted`, `Implementing`, `Verifying`,
`Completed`, and `Incomplete`.

The reducer SHALL use this closed transition table for structural events of
the selected attempt:

- `prompt` moves `Unstarted` to `Implementing`.
- `checkpoint` requires `Implementing`, records the checkpoint identity, and
  remains `Implementing`.
- `state` with `verifying` requires the recorded checkpoint and moves
  `Implementing` to `Verifying`.
- `waiting_child` requires `Verifying`, stores the incomplete outcome as
  pending, and remains `Verifying`.
- `round_done` requires `Verifying` and a completed outcome, and moves to
  `Completed`.
- `alert` with `kind: "round_incomplete"` requires `Verifying` and the exact
  pending outcome from `waiting_child`, and moves to `Incomplete`.

Only `round_done` and `alert` with `kind: "round_incomplete"` are terminal
round events. `waiting_child` is nonterminal. The reducer SHALL reject a
duplicate prompt, checkpoint, verifying event, waiting-child event, or
terminal event. It SHALL reject a terminal event before verifying, an unknown
event type bound to the selected attempt, missing attempt identity, and
conflicting outcomes.

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
6. Durably record the checkpoint event with its top-level commit.
7. Durably record the verifying state.
8. Run the gate command.
9. Capture the post-gate report snapshot.
10. Decide the outcome.
11. Durably record the terminal sequence.

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

A `CheckpointIdentityV1` SHALL contain
`attemptIdentity: AttemptIdentity` and `commit: string`. Its `commit` SHALL be
nonempty and SHALL equal the selected attempt's `checkpoint` event top-level
`commit`.

A `Recoverable` result SHALL contain `_tag: "Recoverable"`, the exact stored
round plan under `roundPlan`, and the checkpoint identity under
`checkpointIdentity`. A prompt without a later valid checkpoint SHALL return
`Invalid` with reason `checkpoint_missing`. A checkpoint before a prompt or a
verifying event before a valid checkpoint SHALL return `Invalid` with reason
`invalid_transition`.

A `Completed` recovery result SHALL mean that replay found a durable terminal
event. It SHALL contain `_tag: "Completed"`,
`attemptIdentity: AttemptIdentity`, and the exact stored `RoundOutcomeV1`
under `outcome`. Its outcome MAY have `_tag: "completed"` or
`_tag: "incomplete"`. The outer `attemptIdentity` SHALL equal
`outcome.attemptIdentity`.

A `LegacyUnbound` result SHALL contain `_tag: "LegacyUnbound"` and the exact
requested `attemptIdentity`. An `Invalid` result SHALL contain
`_tag: "Invalid"`, the exact requested `attemptIdentity`, and one reason from
the closed set `invalid_transition`, `checkpoint_missing`,
`conflicting_outcome`, and `invalid_payload`.

`recoverRoundAttempt` SHALL accept the replayed `readonly StoredEvent[]` and
the exact requested `AttemptIdentity`. It SHALL use only those inputs.

Recovery SHALL read a completed outcome only from `round_done.payload.outcome`.
Recovery SHALL read an incomplete outcome only from a terminal
`alert.payload.outcome` whose kind is `round_incomplete`. A `waiting_child`
event alone SHALL remain `Recoverable` and SHALL NOT become `Completed` or
move the reducer to `Incomplete`.

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
