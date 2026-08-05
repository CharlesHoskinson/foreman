# Tasks: resume-supervisor-typescript

## R5D: bounded restore and Node supervisor

- [x] Add RED tests for read-only resume-budget inspection and inspect/reserve
      races.
- [x] Export `ResumeAttemptBudgetV1` and `inspectResumeAttemptBudget` from
      `@foreman/event-log`. Reuse it in atomic reservation.
- [x] Add RED tests for clean worktree inspection, exact checkpoint binding,
      overlay restore, identity recheck, and closed failures.
- [x] Implement `WorktreeRestore` and its live Node.js layer with bounded Git
      argument vectors.
- [x] Add RED tests for exact round-vector preservation and strict
      `inspect -> reserve -> restore -> submit` ordering.
- [x] Implement `QueueSubmitter` and `runResumeQueueExecution`. Never use the
      queue direct-spawn fallback.
- [x] Add RED tests for `--once`, `--all`, `--dry-run`, per-run leases, typed
      ownership selection, and all no-mutation decisions.
- [x] Implement the one-shot supervisor, live services, CLI, and main entry.
- [x] Build and verify the tracked `lane-supervise.js` runtime artifact.
- [x] Replace `lane-supervise.sh` with a thin Node.js adapter. Keep
      `lane-run.sh`, `watch.sh`, and `resume.sh` behavior unchanged.
- [x] Run focused tests, typecheck, runtime verification, full Node
      verification, strict OpenSpec validation, and adapter parity tests.
- [ ] Run one different-family cold audit on the complete R5D batch.
- [ ] Push one immutable candidate and pass Linux, Windows, and formal gates.
