# Tasks: v0.3.0 release program

## 0. Authority and program baseline

- [ ] 0.1 Publish the canonical v0.2.8.2 and v0.2.9.0 accomplishment ledger.
      The tracked candidate is complete. GitHub publication is pending.
- [ ] 0.2 Correct README, ROADMAP, checklist, residuals, and release metadata.
      Tracked authority is current. GitHub release metadata still needs the
      merged notes.
- [ ] 0.3 Reconcile implemented, partial, absent, parked, and stale OpenSpec tasks.
- [ ] 0.4 Freeze `coverage-matrix.md` and its SHA-256 digest. The matrix is
      tracked. The immutable Council bundle is pending.
- [ ] 0.5 Run a ledger-bound Council review with `SpecCorrectnessV1`.
- [ ] 0.6 Record every cleanup candidate before any destructive action. The
      register exists. Owner and digest completion plus the `DST-0052`
      late-registration incident remain open.
- [ ] 0.7 Reconcile the TypeScript migration package inventory to nine families
      that include `@foreman/policy` as its own package family (CW-023).
      Acceptance evidence: `typescriptmigration.md` states nine package
      families, lists `@foreman/policy` as its own family, and uses the Sprint
      0-through-17 order from `sprints.md` by exact reference without a
      contradictory 0-through-9 table. The file states that this package owns
      cross-package sprint order and that `node-typescript-runtime` retains
      detailed module contracts. Do not mark this task complete before the
      reviewed candidate is published and verified.
- [ ] 0.8 Assign `graph-project` ownership to `@foreman/knowledge` with typed
      `@foreman/event-log` input contracts (CW-024).
      Acceptance evidence: `design.md`, `specs/release-program/spec.md`,
      `sprints.md`, and `typescriptmigration.md` state that ownership. They
      state that `graph-project` consumes typed `@foreman/event-log` inputs
      and does not become the event-log system of record. Do not mark this
      task complete before the reviewed candidate is published and verified.

## 1. Program execution

- [ ] 1.1 Execute Sprints 1 through 17 in `sprints.md` order.
- [ ] 1.2 Use Grok workers in isolated Foreman worktrees for implementation.
- [ ] 1.3 Run deterministic checks and a different-family Codex cold audit for
      every complete sprint diff.
- [ ] 1.4 Run Council at each immutable commitment boundary.
- [ ] 1.5 Rework every actionable finding before the next sprint starts.

## 2. Release convergence

- [ ] 2.1 Verify all coverage rows have shipped evidence or an approved defer.
- [ ] 2.2 Verify the destruction log has no unknown recovery owner.
- [ ] 2.3 Verify zero in-scope Python and no new non-TypeScript product logic.
- [ ] 2.4 Rebuild Graphify as one current knowledge unit.
- [ ] 2.5 Pass all local and hosted gates on one unchanged pushed commit.
- [ ] 2.6 Complete cold audit, Council review, release record, tag, and
      publication verification.
