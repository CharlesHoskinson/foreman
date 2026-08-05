# Spec delta: attempt-bound durable resume counts

## ADDED Requirements

### Requirement: resume count reservation is attempt-bound

`RunJournal.reserveResumeAttempt` SHALL accept one `AttemptIdentity` and one
`resumeMaxAttempts` value. It SHALL use the run and lane in the exact identity.

The latest `prompt` event for that lane SHALL contain the same valid
`payload.attempt`. The operation SHALL fail with `attempt_not_current` when the
latest prompt is absent, malformed, or names a different attempt.

A successful call SHALL append one `resume_attempt` event for the same lane.
Its payload SHALL contain exactly `attempt` and `resumeCount`. `attempt` SHALL
equal the supplied attempt ID. `resumeCount` SHALL equal the prior valid
lane-wide resume count plus one.

#### Scenario: a newer attempt replaced the requested attempt

- WHEN the latest lane prompt names attempt 4
- AND reservation requests attempt 3
- THEN reservation fails with `attempt_not_current`
- AND the journal is unchanged.

### Requirement: resume count history is closed and consecutive

The operation SHALL validate every prior `resume_attempt` event for the lane.
Each payload SHALL contain exactly `attempt` and `resumeCount`. Each attempt
SHALL be a valid positive attempt ID. The lane-wide count sequence SHALL be
exactly 1 through N in journal order.

The operation SHALL fail with `invalid_resume_history` for an unknown payload
key, missing key, invalid value, duplicate count, gap, decrease, or count above
100. It SHALL NOT sort, infer, reset, or repair the history.

A prior `resume` event for the lane SHALL fail with `legacy_unbound`. The
operation SHALL NOT infer its attempt identity from a nearby event.

Unknown event types SHALL remain opaque and SHALL NOT affect the count.

#### Scenario: a malformed prior count could be skipped

- WHEN prior counts are 1 and 3
- THEN reservation fails with `invalid_resume_history`
- AND it does not append count 4 or repair count 2.

### Requirement: reservation enforces the bounded budget

`resumeMaxAttempts` SHALL be an integer from 1 through 100. An invalid value
SHALL fail with `invalid_limit`.

WHEN the current valid count is equal to or greater than the limit, reservation
SHALL fail with `resume_limit_reached`. A failed reservation SHALL not append an
event.

The reservation event SHALL be durable before a later restore or refusal action
can consume that budget. R5C SHALL NOT perform the later action.

#### Scenario: the last permitted reservation exists

- WHEN the valid count is 1
- AND the limit is 1
- THEN reservation fails with `resume_limit_reached`
- AND no count 2 event exists.

### Requirement: reservation is one atomic journal transaction

Count derivation and event append SHALL occur while the same exclusive journal
lock is held. The operation SHALL retain the current journal no-follow,
identity, replay, size, canonical encoding, fsync, and post-write pathname
checks.

Concurrent successful reservations SHALL return distinct consecutive counts.
No successful reservation SHALL exceed `resumeMaxAttempts`.

#### Scenario: two callers race for the only available count

- WHEN two callers concurrently reserve the same current attempt with limit 1
- THEN exactly one call succeeds with count 1
- AND exactly one canonical `resume_attempt` event exists
- AND the other call fails with `resume_limit_reached`.

### Requirement: failures are typed and non-leaking

`ResumeAttemptFailure` SHALL be branded. Its reason SHALL be one of
`invalid_limit`, `attempt_not_current`, `legacy_unbound`,
`invalid_resume_history`, or `resume_limit_reached`.

The failure SHALL expose no path, command, credential, or raw exception.
Filesystem and journal integrity failures SHALL remain `RunJournalFailure`.
No defect from the live boundary SHALL escape as an untyped exception.

#### Scenario: a filesystem seam throws

- WHEN a live filesystem seam throws during reservation
- THEN the Effect fails with a closed typed failure
- AND the serialized failure contains no filesystem path or raw exception.

### Requirement: R5C stays inside the TypeScript event-log boundary

R5C SHALL use Node.js 24, strict TypeScript, and Effect. It SHALL add no Python,
shell, PowerShell, Bun, or Deno product logic.

R5C SHALL NOT restore a worktree, inspect process or lock state, enqueue or
launch a command, add a supervisor CLI, or modify `lane-supervise.sh`,
`lane-run.sh`, or `resume.sh`.

#### Scenario: the next step needs worktree mutation

- WHEN a caller needs to restore a checkpoint or enqueue a resumed round
- THEN R5C returns only the durable reservation
- AND a later TypeScript executor owns that mutation.
