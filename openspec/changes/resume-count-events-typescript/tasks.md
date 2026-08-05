# Tasks: resume-count-events-typescript

## R5C: attempt-bound durable resume counts

- [x] Add RED tests for count derivation, exact attempt binding, and closed
      failure values.
- [x] Add RED tests for legacy events, malformed payloads, count gaps,
      non-current attempts, invalid limits, and exhausted limits.
- [x] Add a RED separate-process reservation test that pauses one holder inside
      the journal lock, observes the contender's lock-retry seam, and proves
      one unique count with no append past the limit.
- [x] Add `ResumeAttemptFailure`, `ResumeAttemptReservationV1`, and the
      `RunJournal.reserveResumeAttempt` Effect interface.
- [x] Implement one locked read-validate-append transaction by reusing the
      existing run-journal integrity and durability rules.
- [x] Export the public types, failure guard, and service operation from
      `@foreman/event-log`.
- [x] Rebuild only the tracked `lane-round` runtime bundle and its manifest
      entry.
- [x] Run focused tests, typecheck, build, runtime verification, full Node
      verification, strict OpenSpec validation, and architecture policy.
- [ ] Run a different-family cold audit on the committed candidate.

## Later work packages

- [ ] Add bounded worktree restore and queue-admission services.
- [ ] Add a Node supervisor CLI and tracked runtime artifact.
- [ ] Replace `lane-supervise.sh` with a thin Node adapter.
- [ ] Prove round-preserving resume in Bats and hosted gates.
