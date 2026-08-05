# Tasks: resume-supervisor-typescript

## R5D: bounded restore and Node supervisor

- [ ] Add RED tests for read-only resume-budget inspection and inspect/reserve
      races.
- [ ] Export `ResumeAttemptBudgetV1` and `inspectResumeAttemptBudget` from
      `@foreman/event-log`. Reuse it in atomic reservation.
- [ ] Add RED tests for clean worktree inspection, exact checkpoint binding,
      overlay restore, identity recheck, and closed failures.
- [ ] Implement `WorktreeRestore` and its live Node.js layer with bounded Git
      argument vectors.
- [ ] Add RED tests for exact round-vector preservation and strict
      `inspect -> reserve -> restore -> submit` ordering.
- [ ] Implement `QueueSubmitter` and `runResumeQueueExecution`. Never use the
      queue direct-spawn fallback.
- [ ] Add RED tests for `--once`, `--all`, `--dry-run`, per-run leases, typed
      ownership selection, and all no-mutation decisions.
- [ ] Implement the one-shot supervisor, live services, CLI, and main entry.
- [ ] Build and verify the tracked `lane-supervise.js` runtime artifact.
- [ ] Replace `lane-supervise.sh` with a thin Node.js adapter. Keep
      `lane-run.sh`, `watch.sh`, and `resume.sh` behavior unchanged.
- [ ] Run focused tests, typecheck, runtime verification, full Node
      verification, strict OpenSpec validation, and adapter parity tests.
- [ ] Run one different-family cold audit on the complete R5D batch.
- [ ] Push one immutable candidate and pass Linux, Windows, and formal gates.

