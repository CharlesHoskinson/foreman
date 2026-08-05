# Design: typed round-resume decision

## Selected approach

Add one pure decision module before the live supervisor port.
The module consumes decoded stored events and explicit safety observations.
The module does not inspect process state or filesystem state.

This approach gives the later live layer one closed interface.
It also prevents the live layer from reconstructing command text.

## Components

`selectLatestRoundAttempt` selects the last prompt event for one lane by sequence.
It accepts only a prompt with a valid numeric attempt and a valid `RoundPlanV1`.
It returns `LegacyUnbound` when the last prompt has no round plan.

`decideRoundResume` calls `recoverRoundAttempt` for the selected attempt.
It combines that result with the supplied resume count, process state, and lock state.
It returns one closed `RoundResumeDecisionV1` value.

## Decision order

Apply this order:

1. Return `Completed` for a durable terminal outcome.
2. Return `Refused` for invalid or legacy history.
3. Return `Refused` for an invalid observation.
4. Return `Refused` when the resume limit is reached.
5. Return `Wait` when process state is active or unknown.
6. Return `Wait` when lock state is held or unknown.
7. Return `Resume` with the exact stored plan and checkpoint identity.

The decision order prevents a cap or safety observation from changing completed history.

## Boundaries

This change does not read an event file.
This change does not restore a worktree.
This change does not inspect a process.
This change does not inspect a lock.
This change does not enqueue a command.

The next work package will implement those boundaries as Effect services.
