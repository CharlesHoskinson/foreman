# Spec delta: resume supervisor

The [ForeDi R-M6-008 ownership requirement](../../../foredi-06-adoption/specs/foredi-06-adoption/spec.md)
supersedes automatic legacy resume through the new supervisor.
Its `ActiveLegacyRun` refusal precedes reservation, restore, and queue submission.
The original controller's command-preservation and migration obligations remain open.

## ADDED Requirements

### Requirement: resume-budget inspection uses one validator

`@foreman/event-log` SHALL expose one read-only resume-budget inspector. Atomic
reservation SHALL use the same validator.

#### Scenario: inspection becomes stale

- WHEN inspection reports available budget
- AND another process reserves that budget first
- THEN the later reservation SHALL fail closed
- AND restore and queue submission SHALL not run.

### Requirement: restore binds the selected checkpoint and reservation

The restore service SHALL require equal run, lane, and attempt identity in the
checkpoint and reservation. It SHALL reject a dirty, changed, aliased, or
invalid worktree before checkout.
The ForeDi supervisor SHALL refuse legacy resume before invoking this service.

#### Scenario: a legacy checkpoint is valid and its worktree is clean

- WHEN the ForeDi supervisor selects that legacy round
- THEN it returns `ActiveLegacyRun` and exits 3 before restore-service inspection
- AND the valid checkpoint does not authorize reservation, checkout, or queue submission.

#### Scenario: a dirty worktree is selected

- WHEN the selected worktree has uncommitted changes
- THEN inspection SHALL fail before resume reservation
- AND no checkout or queue submission SHALL occur.

#### Scenario: overlay restore succeeds

- WHEN the worktree is clean and the checkpoint is a valid commit
- THEN restore SHALL check out tracked paths from that commit
- AND SHALL preserve post-checkpoint untracked files
- AND SHALL not move `HEAD`.

### Requirement: queue execution preserves the stored round

The original controller's command-preservation contract remains a migration
obligation owned by `lane-runtime-typescript`. It requires the exact stored
gate, report path, run, lane, worktree, and command vector, including empty
arguments, Unicode, spaces, and shell metacharacters.
This obligation is not completed by ForeDi's refusal path.

For a legacy round, the ForeDi supervisor SHALL return `ActiveLegacyRun` with
exit code 3 before reservation, restore, or queue submission.
It SHALL preserve the journal, worktree contents, and `HEAD`.
It SHALL NOT return a ready command vector or infer a verified original
controller executable from historical ownership records.
This boundary does not change direct `lane-run.sh --round` execution.

#### Scenario: pueue is unavailable

- WHEN the ForeDi supervisor selects a recoverable legacy round
- AND pueue is unavailable
- THEN it SHALL return `ActiveLegacyRun` and exit 3
- AND no resume attempt, worktree restore, ready command, or round spawn occurs
- AND the journal, worktree contents, and `HEAD` remain unchanged.

### Requirement: supervisor decisions are fail-safe

The supervisor SHALL use typed event recovery, resume-budget inspection,
process observation, lock observation, and `decideRoundResume`.

#### Scenario: the lane is not safe to resume

- WHEN the decision is `Wait`, `Completed`, `NoRound`, or `Refused`
- THEN the supervisor SHALL not reserve budget
- AND SHALL not restore or queue a round.

#### Scenario: dry-run selects a resumable lane

- WHEN `--dry-run` selects a `Resume` decision
- THEN the supervisor SHALL report the planned action
- AND SHALL not reserve, restore, or queue.

### Requirement: the supervisor runtime is Node.js TypeScript

R5D SHALL use Node.js 24, strict TypeScript, and Effect. The tracked
`lane-supervise.js` bundle SHALL be deterministic and manifest-bound.

#### Scenario: the shell entry point runs

- WHEN an operator invokes `lane-supervise.sh`
- THEN the adapter SHALL execute the tracked Node.js bundle
- AND SHALL contain no supervisor decision, restore, or queue product logic.
