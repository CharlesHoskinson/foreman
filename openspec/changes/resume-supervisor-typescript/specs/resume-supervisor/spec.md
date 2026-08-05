# Spec delta: resume supervisor

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

The executor SHALL submit `lane-run.sh --round` with the exact stored gate,
report path, run, lane, worktree, and command vector. It SHALL preserve empty
arguments, Unicode, spaces, and shell metacharacters as argument values.

#### Scenario: pueue is unavailable

- WHEN queue readiness is unavailable
- THEN the executor SHALL return one ready command vector
- AND SHALL not spawn the round directly.

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
