# Tasks: v0.2.9.0 release convergence

## T0: recover the review plane

- [x] Admit authenticated `agy` through Setup with a zero-inference probe.
  Evidence: commit `1e127c6`, Pueue task 40, 73 focused tests, and live
  `LANE_READY: agy=yes` plus `SETUP: READY` output.
- [x] Keep `agy` concurrency at one until isolated credential seeding is verified.
  Evidence: `skills/foreman/scripts/lane-queue.sh` declares `agy:1`; the
  focused audit-routing and Setup gate passed at that limit in Pueue task 40.
- [x] Re-run verification for the crash-preserved Council Task 2 rework.
  Evidence: Council round-4 candidate evidence contains 27 targeted tests,
  docs-check, six line-ending tests, strict OpenSpec validation, and Agy
  plugin validation.
- [x] Commit the verified Council rework on its implementation branch.
  Evidence: Council implementation commit
  `8a6ef2363a3ca6f70816126ed5963ba63ec9c2a8`.
- [ ] Build a new immutable bundle and complete a dissent-free Council round.

## T1: reconcile scope and packages

- [x] Add a fail-closed validator for `evidence/package-matrix.tsv`.
  Evidence: commit `8c4adfeb17ac8a18beb020fc0962e73cb6479013`,
  `skills/foreman/scripts/package-matrix-check.sh`, and
  `bats tests/package-matrix-check.bats` (20 tests).
- [x] Add one matrix row for every active OpenSpec package.
  Evidence: the matrix checker accepts all 35 active package rows.
- [x] Bind each `v029-implemented` row to consuming code and a verification command.
  Evidence: eight implemented rows contain all required evidence fields and
  pass `package-matrix-check.sh`.
- [x] Split each partial package into shipped v0.2.9.0 scope and preserved v0.3.x scope.
  Evidence: eight split rows name tracked `V030-RESIDUAL.md` preservation
  files in their owning packages.
- [x] Correct `checklist.md` against SessionDB Fact 238.
  Evidence: commit `2c7332c` narrows the release scope and preserves the
  graph work for v0.3.0.
- [x] Prove that v0.2.9.0 has no default graph-context path.
  Evidence: the `2c7332c` reconciliation records the source and configuration
  scan at the 243-file graph snapshot.

## T2: implement safety controls

- [ ] Implement criterion 4 at the `kind: gate` and `check_id` unit.
- [x] Preserve probe and verdict-predicate control expansion for v0.3 and
  withdraw exhaustive assertion registration.
  Evidence: `openspec/changes/positive-control-expansion/` and plan commit
  `10ff0af`.
- [ ] Prove registry completeness and every negative control.
- [ ] Extend the Tier 2 trigger scan across its real invocation surface.
- [ ] Add a `not_evaluated` path for unavailable Tier 2 cost.
- [ ] Correct the six stale `test-infrastructure-hardening` claims.

## T3: implement audit and telemetry evidence

- [ ] Define the per-package audit artifact and schema.
- [ ] Build a package audit index that refuses missing or stale artifacts.
- [ ] Record worker and auditor model families with each artifact.
- [ ] Publish Foreman's measurement sigma before comparative claims.
- [ ] Render unavailable sigma as `not_evaluated`.

## T4: close documentation, plugin, and freshness tooling

- [ ] Correct stale release-checklist annotations.
- [ ] Remove live TerminusDB doctrine outside dated history.
- [ ] Prove plugin drift detection with known-bad fixtures.
- [ ] Add a report-first SessionDB freshness sweep.
- [ ] Run freshness apply mode only at the final candidate commit.

## T4A: execute the dependency-ordered closeout packages

- [ ] C1: Admit the WSL preflight, vendor preflight, inventory scanner,
  metrics rollup, doctrine checker, GraphStore, knowledge refresh, round
  ownership, freshness, audit-index, and Tier 2 candidates only after their
  host gates and independent cold audits pass.
- [ ] C2: Correct the stale test-infrastructure claims and record the four
  user-delegated README decisions plus the initial claim-ledger scaffold.
- [ ] I1: Implement and verify the idempotent WSL-native environment file and
  non-interactive lane sourcing.
- [ ] I2: Wire Setup, lane launch, and tool-check to one identity-bound vendor
  readiness record with exact remediation.
- [ ] I3: Seed the doctrine registry and integrate it with docs-check, release
  records, Windows checks, and bounded probe execution.
- [ ] I4: Implement the repeated unchanged-code sigma calculator with
  per-metric qualification and an explicit `not_evaluated` result.
- [ ] I5: Complete the README ledger, twelve-section rewrite, doctrine rows,
  fact check, and structure gate after all described behavior has landed.
- [ ] I7: Remove live TerminusDB doctrine and correct the devlog, bug ledger,
  release notes, roadmap, and checklist against accepted implementation.
- [ ] R1: Freeze the release manifest and finalize the matrix, archive, and
  package-audit-index predicates before control capture.
- [ ] I6: Capture real known-bad and known-good records for every member of the
  frozen `kind: gate` inventory and prove the comparator itself can fail.
- [ ] R2: Archive each shipped package with source cold-audit evidence, then
  produce its immutable cross-family audit artifact and the final index.
- [ ] R3: Refresh SessionDB, Graphify, measurements, release prose, and Council
  evidence at one final candidate commit.

## T5: finalize the release

- [ ] Archive each shipped OpenSpec package with its evidence.
- [ ] Validate all change packages under strict mode.
- [ ] Run the full Foreman release gate.
- [ ] Resolve all new failures through Grok and Council loops.
- [ ] Refresh all quoted release measurements at the final candidate commit.
- [ ] Complete the devlog correction block and release notes.
- [ ] Mark the roadmap and checklist released.
- [ ] Create tag `v0.2.9` with message `Total GeorgeCall` only after all gates pass.
- [ ] Prove no tracked file changed after the final Council bundle and before
  tag creation.
