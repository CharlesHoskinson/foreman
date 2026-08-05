# Tasks: round-resume-typescript

## R5A: pure decision authority

- [ ] Add RED tests for current-attempt selection.
- [ ] Add RED tests for legacy and invalid prompt refusal.
- [ ] Add RED tests for duplicate and decreasing event sequences.
- [ ] Add RED tests for completed, wait, exhausted, and resume decisions.
- [ ] Add `selectLatestRoundAttempt` to `@foreman/orchestration`.
- [ ] Add `decideRoundResume` to `@foreman/orchestration`.
- [ ] Preserve the exact stored plan and checkpoint identity.
- [ ] Export the new public types and functions.
- [ ] Run focused tests, typecheck, build, runtime verification, and full Node verification.
- [ ] Run a different-family cold audit on the committed candidate.

## Later work packages

- [ ] Add bounded Effect live services for liveness, locks, restore, and queue admission.
- [ ] Add a Node supervisor CLI and tracked runtime artifact.
- [ ] Replace `lane-supervise.sh` with a thin Node adapter.
- [ ] Record typed round plans from every round-owned dispatch.
- [ ] Prove round-preserving resume in Bats and hosted gates.
