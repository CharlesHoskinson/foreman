# Design: atomic resume-attempt reservation

## Selected approach

Extend the live `RunJournal` service with one operation:

```ts
readonly reserveResumeAttempt: (
  attemptIdentity: AttemptIdentity,
  resumeMaxAttempts: number,
) => Effect.Effect<ResumeAttemptReservationV1, ResumeAttemptFailure | RunJournalFailure>
```

The operation uses the run journal named by `attemptIdentity.runId`. It acquires
the existing events lock, reads the journal without following links, validates
the complete sequence chain, derives the current lane count, and appends the
next event before it releases the lock.

The implementation can refactor the private append machinery so ordinary
append and resume reservation share one locked read-and-write path. It must not
duplicate the journal parser, path-identity checks, canonical JSON encoder, or
durability rules.

## Stored event

The canonical event has this exact shape:

```json
{
  "type": "resume_attempt",
  "lane": "<laneId>",
  "payload": {
    "attempt": 3,
    "resumeCount": 2
  }
}
```

The journal assigns `seq` and `ts`. `attempt` is the source attempt that the
later executor wants to resume. `resumeCount` is lane-wide within one run, so a
new attempt does not reset the bounded auto-resume budget. The exact attempt
binding prevents a count from being credited to another attempt.

The reservation is the budget-consuming durable fact. A later executor calls
it only for an action that must consume resume budget. This includes a resume
attempt or a terminal refusal. A `Wait` observation does not reserve a count.
R5C does not implement that executor.

## History rules

Before append, the operation validates these rules for the selected lane:

1. The complete run journal has a consecutive sequence chain that starts at 1.
2. The latest `prompt` for the lane contains the exact selected attempt.
3. Every `resume_attempt` payload has exactly `attempt` and `resumeCount`.
4. Each payload contains a valid positive attempt ID.
5. Resume counts are the exact sequence 1 through N with no duplicate or gap.
6. A legacy lane `resume` event makes the history `legacy_unbound` because it
   does not prove which source attempt consumed the budget.
7. The supplied limit is an integer from 1 through 100.
8. The next count cannot exceed the supplied limit or 100.

Unknown event types for the lane stay opaque. A malformed `resume_attempt` is
not ignored or repaired.

## Failure surface

`ResumeAttemptFailure` is branded and has one closed reason:

- `invalid_limit`
- `attempt_not_current`
- `legacy_unbound`
- `invalid_resume_history`
- `resume_limit_reached`

Failures contain no filesystem path, command, credential, or raw exception.
Filesystem and journal integrity failures continue to use
`RunJournalFailure`.

## Concurrency and durability

The count derivation and append occur under the same exclusive events lock.
Two concurrent reservations cannot return the same count. The concurrency
proof uses two separate Node.js processes. The holder stops at an injected test
seam while it owns the journal lock. The contender's injected lock-wait seam
records that exclusive create observed the held lock. The parent releases the
holder only after that contention marker exists. An in-process fiber test or a
shared start file without observed lock contention is not sufficient. With
limit one, the holder appends count one and the contender receives
`resume_limit_reached` after it acquires the released lock.

The append retains the current file identity, no-follow, complete-candidate
replay, fsync, size, and path-reobservation checks. A failed reservation does
not append a partial event.

## Boundaries

R5C does not change `decideRoundResume`. It does not claim the later executor,
worktree restore, queue admission, Node supervisor CLI, thin shell adapter, or
round-preserving Bats proof.

`npm run build` compiles the event-log change into the tracked `lane-round`
runtime bundle. R5C therefore updates only that deterministic bundle and its
manifest entry. It does not change another generated runtime artifact.
