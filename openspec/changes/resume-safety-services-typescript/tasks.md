# Tasks: resume-safety-services-typescript

## R5B: Effect observation services

- [ ] Add RED tests for process result classification.
- [ ] Add RED tests for lock path classification.
- [ ] Add RED tests for Effect service composition.
- [ ] Add `ResumeProcessProbe` and its live layer.
- [ ] Add `ResumeLockProbe` and its live layer.
- [ ] Add `observeResumeSafety`.
- [ ] Export the public services, layers, and observation types.
- [ ] Run focused tests, typecheck, build, runtime verification, and full Node verification.
- [ ] Run a different-family cold audit on the committed candidate.

## Later work packages

- [ ] Add attempt-bound durable resume-count events.
- [ ] Add bounded worktree restore and queue-admission services.
- [ ] Add a Node supervisor CLI and tracked runtime artifact.
- [ ] Replace `lane-supervise.sh` with a thin Node adapter.
- [ ] Prove round-preserving resume in Bats and hosted gates.
