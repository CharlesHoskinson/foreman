# Spec delta: typed round resume

## ADDED Requirements

### Requirement: select one exact current attempt

`selectLatestRoundAttempt` SHALL accept decoded `StoredEvent` values, one `RunId`, and one `LaneId`.
It SHALL select the prompt with the greatest sequence for that lane.

The selected prompt SHALL contain a valid positive `payload.attempt` value.
It SHALL contain a valid `payload.roundPlan` value.
The plan lane and attempt SHALL equal the selected lane and attempt.

The function SHALL return `NoRound` when the lane has no prompt.
It SHALL return `LegacyUnbound` when the selected prompt has no round plan.
It SHALL return `Invalid` when the selected prompt has an invalid or mismatched plan.

#### Scenario: an older prompt has a valid plan

- WHEN the newest prompt is legacy and an older prompt has a valid plan
- THEN selection returns `LegacyUnbound`
- AND selection does not resume the older attempt.

### Requirement: resume uses the existing recovery authority

`decideRoundResume` SHALL call `recoverRoundAttempt` for the selected `AttemptIdentity`.
It SHALL NOT implement a second event reducer.

A `Resume` decision SHALL contain the exact stored `RoundPlanV1`.
It SHALL contain the exact recovered `CheckpointIdentityV1`.
It SHALL preserve every command argument as one array entry.
It SHALL preserve `gateCommand` and `reportPath` unchanged.

The function SHALL NOT read `payload.cmd`.
It SHALL NOT join, split, quote, or shell-interpret `commandArgv`.

#### Scenario: the command contains an empty later argument

- WHEN the stored command vector contains an empty argument after its first argument
- THEN a `Resume` decision preserves that empty argument.

### Requirement: the decision is closed and fail-safe

`RoundResumeDecisionV1` SHALL be one of `NoRound`, `Completed`, `Wait`, `Resume`, or `Refused`.

`Completed` SHALL contain the exact terminal attempt identity and outcome.
`Wait` SHALL contain the selected attempt identity and one wait reason.
`Resume` SHALL contain the exact round plan and checkpoint identity.
`Resume` SHALL contain `nextResumeCount`, which equals `resumeCount + 1`.
`Refused` SHALL contain the selected attempt identity when one is available.

`Wait.reason` SHALL be one of `prior_attempt_active`, `process_state_unknown`, `lock_held`, or `lock_state_unknown`.
`Refused.reason` SHALL be one of `legacy_unbound`, `invalid_history`,
`checkpoint_missing`, `resume_limit_reached`, or `invalid_observation`.

`decideRoundResume` SHALL accept these explicit observations:

- `resumeCount` as an integer from 0 through 100.
- `resumeMaxAttempts` as an integer from 1 through 100.
- `processState` as `inactive`, `active`, or `unknown`.
- `lockState` as `free`, `held`, or `unknown`.

The function SHALL return `Refused` for an invalid observation.
It SHALL NOT throw an untyped exception.

The function SHALL use this first-match order:

1. Durable terminal outcome returns `Completed`.
2. Invalid or legacy recovery returns `Refused`.
3. An invalid observation returns `Refused`.
4. A reached resume limit returns `Refused`.
5. Active or unknown process state returns `Wait`.
6. Held or unknown lock state returns `Wait`.
7. A recoverable attempt returns `Resume`.

#### Scenario: the prior process state is unknown

- WHEN recovery is otherwise possible
- AND process state is `unknown`
- THEN the decision is `Wait`
- AND no resume action is returned.

### Requirement: R5A is a pure TypeScript module

R5A SHALL use Node.js 24 and strict TypeScript.
R5A SHALL add no Python, shell, PowerShell, Bun, or Deno code.

R5A SHALL NOT read a file, inspect a process, inspect a lock, restore a worktree, or enqueue a command.
R5A SHALL NOT modify `lane-run.sh`, `lane-supervise.sh`, or `resume.sh`.

#### Scenario: a boundary is required

- WHEN a decision needs live process or filesystem evidence
- THEN the caller supplies the observation
- AND the pure module performs no boundary operation.
