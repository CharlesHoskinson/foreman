## Purpose

Defines durable Council run behavior, including event commitment, recovery, budgets, cancellation, retries, and terminal outcomes.

## ADDED Requirements

### Requirement: State changes commit before observation
Council SHALL durably append every authoritative domain event before publishing it, acknowledging progress, releasing ingest capacity, or exposing derived state.

#### Scenario: Event append fails
- **WHEN** a state transition is decided but its append transaction fails
- **THEN** subscribers receive no transition and the caller receives a typed persistence failure

### Requirement: Run replay is deterministic
Council MUST derive run state through pure, versioned evolution of the authoritative event stream, and snapshots MUST remain disposable caches.

#### Scenario: Snapshot is corrupt
- **WHEN** a snapshot hash or reducer version fails verification
- **THEN** Council discards it and rebuilds the same state by replaying valid events

### Requirement: Required checkpoints are durable
Council SHALL checkpoint the validated plan before fan-out, each terminal branch result before synthesis, every approval request before notification, and every committed side-effect outcome before acknowledgment.

#### Scenario: Crash before synthesis
- **WHEN** branch result checkpoints exist and Council restarts before synthesis completes
- **THEN** Council reuses those immutable results and does not rerun completed advisers

### Requirement: Terminal states are absorbing
Council SHALL append exactly one terminal run outcome, and completed, failed, and cancelled runs MUST reject state-changing commands.

#### Scenario: Provider succeeds after cancellation
- **WHEN** a late provider terminal record arrives after run cancellation
- **THEN** Council stores it as late evidence without changing the cancelled outcome

### Requirement: Cancellation owns the complete process tree
Council SHALL persist cancellation intent, stop new scheduling, request graceful termination, wait a bounded grace period, terminate the owned process tree, and drain remaining output before finalizing cancellation.

#### Scenario: Provider ignores graceful termination
- **WHEN** a provider remains alive after the cancellation grace period
- **THEN** Council terminates the complete platform-specific process tree and reports no remaining owned process

### Requirement: Budgets are reserved before work starts
Council MUST reserve shared wall-time, token, cost, tool, turn, retry, concurrency, event, and artifact budgets before launching work and reconcile reservations from observed usage.

#### Scenario: Concurrent branches request the final reservation
- **WHEN** two branches concurrently request more than the remaining shared budget
- **THEN** at most one branch is admitted and the hard limit is not oversubscribed

### Requirement: Retry ownership is singular and bounded
Council SHALL own outer retries, retry only classified transient failures within attempt and run deadlines, and count provider-internal retries without multiplying them.

#### Scenario: Provider retries while still running
- **WHEN** an adapter observes an internal provider retry event
- **THEN** Council charges the retry to budget and does not start another outer attempt concurrently

### Requirement: Ambiguous side effects are not replayed
Council MUST classify a mutating operation with an unconfirmed outcome as `outcome_unknown` and MUST require reconciliation or explicit human direction before another attempt.

#### Scenario: Process dies after a mutating request
- **WHEN** the process exits after sending a write request but before observing its committed result
- **THEN** Council records `outcome_unknown` and does not automatically repeat the operation
