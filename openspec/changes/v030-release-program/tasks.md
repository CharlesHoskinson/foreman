# Tasks: v0.3.0 release program

## 0. Authority and program baseline

- [ ] 0.1 Publish the canonical v0.2.8.2 and v0.2.9.0 accomplishment ledger.
      The tracked candidate is complete. GitHub publication is pending.
- [ ] 0.2 Correct README, ROADMAP, checklist, residuals, and release metadata.
      Tracked authority is current. GitHub release metadata still needs the
      merged notes.
- [x] 0.3 Reconcile implemented, partial, absent, parked, and stale OpenSpec
      tasks. The bounded 2026-08-04 reconciliation corrected four stale task
      boxes and one completed 10-of-10 Tier 1 evidence statement. It kept
      gate-dependent and parked tasks open. The shipped v0.2.9 preflight
      package remains a protected `released_reference`; `DST-0061` registers
      its later archive relocation. All 32 tracked non-archive packages pass
      strict OpenSpec validation.
- [x] 0.4 Freeze `coverage-matrix.md` and its SHA-256 digest. The matrix,
      strict `SpecCorrectnessV1` evaluator, and Effect admission command are
      tracked. The first exact live activation record is in
      `docs/evidence/v0.3.0/spec-correctness-round-001/`.
- [ ] 0.5 Ship the Effect admission command, then run a ledger-bound Council
      review with `SpecCorrectnessV1` on one exact candidate.
      Landed evidence: specification-correctness core and admission at
      `a45b0a2c5fb4c95bdc67caef678c51c278c7f314` and
      `71b6fbdee5887f123891433266064db3d50b5def`. Live activation record at
      `b193ffdd97fbeb428fce0d410fe1405612843a6b` for head `71b6fbd`. One live
      Grok verdict is admitted. The default three-verdict, two-model-family
      Council quorum remains pending. Keep this task open.
- [ ] 0.6 Record every cleanup candidate before any destructive action. The
      register exists. The `DST-0052` historical-process incident mitigation
      remains unfinished. Destruction-admission code landed at
      `d360fbec540a3c99d1eba50ac5712c50e838b5b0` with review record
      `e8f9686cf8ae77145d7812a65f8fc573a521bca9`
      (`docs/evidence/v0.3.0/destruction-guard-spec-correctness-round-001/`).
      R2 slice: `@foreman/core` plus `@foreman/policy` with one canonical
      sentinel register (no projection table), pure evaluator with closed
      approval facts, committed-HEAD authority binding, DST-0060 denial
      (`state_blocked` when clean; `authority_dirty` when uncommitted), and
      live relocate fail-closed (`platform_invariant_unproven`). Keep open
      until DST-0059 register disposition and incident mitigation finish.
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
      Landed partial evidence through
      `04a310acd824d8dc06fe2b81dd19b8fa543e649b` (do not mark complete):
      - Architecture policy:
        `99accf3ba5d75c311aa9ede3460b4a4a49d9aa3e` (feat),
        `96d0f0750f415697985b4201f47b915734146d9b` (review record).
      - Installed-runtime integrity:
        `6a0bc5fdcfc6e06b9b56f52d7a3e9787ea99ae72` (feat),
        `524290f5f0a59c1f4ae05bcb4ceb8acf4fd15c88` (review record).
      - Windows path-seam:
        `aba8124d54ba35d34c1ffe973ea2031b6073ab8e` (memory install paths),
        `3164cfa5779b8aac8eebeea710c16f3f9688d56f` (delayed handle release).
      - Event-log foundation:
        `cbe27e831b3dcc95db8de248168374fe08e20350`.
      - Sprint 3 R1 queue admission:
        `a1e0dcf142eb02f5f198c0da730a51c11396a196`, corrected at
        `67ad311d831a150d3f91c327ba0b620232e3e9cb`.
      - Sprint 3 R2 attempt-bound round core:
        OpenSpec at `784b4a9`, `4f3287b`, and `238225c`; Node 24
        TypeScript and Effect implementation at
        `04a310acd824d8dc06fe2b81dd19b8fa543e649b`.
      - Sprint 3 R3 live round runtime: landed as the live Effect adapters,
        `lane-round` CLI/main, and tracked `dist/lane-round.js` runtime
        artifact under the same Node 24 TypeScript program; Setup and
        shell ownership seams remain open.
      - Sprint 3 R4A typed vendor preflight (partial): closed contract,
        capability table from `env/reference-manifest.toml` only, pure
        classifier, Effect `VendorPreflight` + `ProcessExec`/`PathLookup`
        live adapter, `vendor-preflight` CLI, and embedded capability
        injection into `skills/foreman/runtime/dist/vendor-preflight.js`.
        Focused package tests 45/45 pass; host typecheck fixed by aligning
        `PreflightCliEnv.layer` to `ProcessExec | PathLookup | PreflightClock`
        (CLI calls `inspectVendor` directly and must not require the
        unused `VendorPreflight` tag). Setup/`foreman-setup.sh` and lane
        callers are intentionally not wired in this slice.
      The remaining Sprint 3 work stays open (R4B+ shell migration,
        ownership, heartbeat, reaping, credential profiles, and other
        open Sprint 3 ports).
- [ ] 1.2 Use Grok workers in isolated Foreman worktrees for implementation.
- [ ] 1.3 Run deterministic checks and a different-family Codex cold audit for
      every complete sprint diff.
- [ ] 1.4 Run Council at each immutable commitment boundary.
- [ ] 1.5 Rework every actionable finding before the next sprint starts.

## 2. Release convergence

- [ ] 2.1 Verify all coverage rows have shipped evidence or an
      `evidenced_defer` that names reason, owner, target release, blocking
      dependency, and acceptance evidence.
- [ ] 2.2 Verify the destruction log has no unknown recovery owner.
- [ ] 2.3 Verify zero in-scope Python and no new non-TypeScript product logic.
- [ ] 2.4 Rebuild Graphify as one current knowledge unit.
- [ ] 2.5 Pass all local and hosted gates on one unchanged pushed commit.
- [ ] 2.6 Complete cold audit, Council review, release record, tag, and
      publication verification.
