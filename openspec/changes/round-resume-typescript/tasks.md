# Tasks: round-resume-typescript

## R5A: pure decision authority

- [x] Add RED tests for current-attempt selection.
- [x] Add RED tests for legacy and invalid prompt refusal.
- [x] Add RED tests for duplicate and decreasing event sequences.
- [x] Add RED tests for completed, wait, exhausted, and resume decisions.
- [x] Add `selectLatestRoundAttempt` to `@foreman/orchestration`.
- [x] Add `decideRoundResume` to `@foreman/orchestration`.
- [x] Preserve the exact stored plan and checkpoint identity.
- [x] Export the new public types and functions.
- [x] Run focused tests, typecheck, build, runtime verification, and full Node verification.
- [x] Run a different-family cold audit on the committed candidate.

## Later work packages

- [x] Add bounded Effect live observation services for process liveness and locks.
- [ ] Add bounded Effect services for restore and queue admission.
- [ ] Add a Node supervisor CLI and tracked runtime artifact.
- [ ] Replace `lane-supervise.sh` with a thin Node adapter.
- [ ] Record typed round plans from every round-owned dispatch.
- [ ] Prove round-preserving resume in Bats and hosted gates.
