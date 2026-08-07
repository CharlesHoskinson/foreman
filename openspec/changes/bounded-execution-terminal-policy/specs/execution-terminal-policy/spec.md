# Spec delta: execution terminal policy

## ADDED Requirements

### Requirement: Foreman Endstop is a persistent required control

Foreman SHALL identify this control as **Foreman Endstop** in user-facing
output and documentation.

Foreman SHALL store Endstop state under the external Foreman state root.

Worktree cleanup, branch deletion, process restart, and session restart SHALL
NOT remove an Endstop contract.

Every future Foreman workstream SHALL create an Endstop contract before its
first actionful dispatch.

Foreman SHALL report `NOT_READY` when the installed Endstop runtime is missing
or invalid.

Foreman SHALL NOT fall back to unbounded execution.

#### Scenario: a new workstream cannot bypass Endstop

- WHEN a new workstream requests its first actionful dispatch
- AND no valid Endstop contract exists
- THEN Foreman refuses the dispatch
- AND Foreman starts no external process.

#### Scenario: cleanup does not reset Endstop

- WHEN a terminal workstream deletes its worktree and branch
- AND a new session requests work under the same contract
- THEN Foreman returns the existing terminal state
- AND Foreman starts no external process.

### Requirement: one contract bounds the complete feedback path

Foreman SHALL use one immutable execution contract for one release package.

The contract SHALL bind implementation, verification, audit, correction,
Council, provider retry, resume, integration, and publication actions.

A new round, lane, session, process, or attempt SHALL NOT reset a contract
counter.

#### Scenario: a new round does not reset the correction count

- WHEN a correction consumes the final correction unit
- AND Foreman creates a new round identifier
- THEN Foreman refuses another correction
- AND Foreman records an absorbing terminal decision.

### Requirement: terminal states are absorbing

Foreman SHALL use these terminal states: `Completed`, `Escalated`, `Stalled`,
`BudgetExhausted`, `Cancelled`, `Invalidated`, and `BlockedExternal`.

Foreman SHALL return the existing terminal state for every later event.

#### Scenario: a late success cannot clear cancellation

- WHEN the user cancels a running contract
- AND a late provider result reports success
- THEN the contract stays `Cancelled`
- AND Foreman does not admit more work.

### Requirement: strict defaults bound the loop

The default contract SHALL permit two implementation rounds.

The default contract SHALL permit one correction round.

The default contract SHALL permit one audit round.

The default contract SHALL permit one Council round.

The default contract SHALL permit two provider retries.

The default contract SHALL permit two resume attempts.

The default contract SHALL permit 12 total action reservations.

The default wall-time limit SHALL be 120 minutes.

The default no-product-change limit SHALL be 30 minutes.

#### Scenario: the full feedback loop reaches a terminal state

- WHEN a caller repeats every feedback action
- THEN Foreman reaches a terminal state within 12 reservations
- AND every later action is refused before process start.

### Requirement: Foreman persists admission before external work

Foreman SHALL reserve each action in one locked journal transaction.

Foreman SHALL persist the reservation before an external process starts.

An ambiguous external result SHALL consume its reservation.

#### Scenario: concurrent callers request the last unit

- WHEN two callers request the last available action unit concurrently
- THEN exactly one caller receives a reservation
- AND the other caller receives a terminal or exhausted result.

### Requirement: only product-state changes reset the stall deadline

Foreman SHALL calculate product progress from the allowed product paths.

Foreman SHALL NOT count logs, reports, checkpoints, audit records, or Council
records as product progress.

#### Scenario: repeated reviews do not hide a stall

- WHEN review artifacts change for 30 minutes
- AND no allowed product path changes
- THEN Foreman sets the contract to `Stalled`.

### Requirement: unchanged verification evidence is reused

Foreman SHALL bind verification evidence to the candidate tree hash and the
verification command hash.

Foreman SHALL refuse a second verification process for the same hash pair.

#### Scenario: the same test command does not run again

- WHEN verification exists for one candidate and command hash pair
- AND a caller requests the same verification again
- THEN Foreman returns the existing evidence reference
- AND Foreman starts no verification process.

### Requirement: a frozen package blocks only its dependents

Foreman SHALL keep a non-completed terminal package frozen.

Foreman SHALL block each package that depends on the frozen package.

Foreman MAY continue a package with no dependency path to the frozen package.

Foreman SHALL NOT complete the release while a required package is frozen.

#### Scenario: independent work continues safely

- WHEN package A becomes `Escalated`
- AND package B has no dependency path to package A
- THEN Foreman can admit package B
- AND package A stays frozen.

#### Scenario: dependent work does not bypass the failure

- WHEN package C depends on package A
- AND package A is not `Completed`
- THEN Foreman refuses package C.

### Requirement: only the user can authorize a replacement contract

Foreman SHALL require a new contract identifier for replacement work.

The replacement SHALL contain a new user authorization hash.

The replacement SHALL identify the terminal contract that it supersedes.

An agent, model, Council result, checkpoint, or session resume SHALL NOT create
replacement authority.

#### Scenario: a session restart does not create authority

- WHEN a terminal contract exists
- AND a new agent session starts
- THEN the terminal contract stays terminal
- AND Foreman refuses work without a user-authorized replacement contract.
