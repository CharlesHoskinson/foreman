# Tasks: v0.2.9.0 release convergence

## T0: recover the review plane

- [ ] Admit authenticated `agy` through Setup with a zero-inference probe.
- [ ] Keep `agy` concurrency at one until isolated credential seeding is verified.
- [ ] Re-run verification for the crash-preserved Council Task 2 rework.
- [ ] Commit the verified Council rework on its implementation branch.
- [ ] Build a new immutable bundle and complete a dissent-free Council round.

## T1: reconcile scope and packages

- [x] Add a fail-closed validator for `evidence/package-matrix.tsv`.
  Evidence: commit `8c4adfeb17ac8a18beb020fc0962e73cb6479013`,
  `skills/foreman/scripts/package-matrix-check.sh`, and
  `bats tests/package-matrix-check.bats` (20 tests).
- [ ] Add one matrix row for every active OpenSpec package.
- [ ] Bind each `v029-implemented` row to consuming code and a verification command.
- [ ] Split each partial package into shipped v0.2.9.0 scope and preserved v0.3.x scope.
- [x] Correct `checklist.md` against SessionDB Fact 238.
  Evidence: commit `2c7332c` narrows the release scope and preserves the
  graph work for v0.3.0.
- [x] Prove that v0.2.9.0 has no default graph-context path.
  Evidence: the `2c7332c` reconciliation records the source and configuration
  scan at the 243-file graph snapshot.

## T2: implement safety controls

- [ ] Implement criterion 4 at the `kind: gate` and `check_id` unit.
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

## T5: finalize the release

- [ ] Archive each shipped OpenSpec package with its evidence.
- [ ] Validate all change packages under strict mode.
- [ ] Run the full Foreman release gate.
- [ ] Resolve all new failures through Grok and Council loops.
- [ ] Refresh all quoted release measurements at the final candidate commit.
- [ ] Complete the devlog correction block and release notes.
- [ ] Mark the roadmap and checklist released.
- [ ] Create tag `v0.2.9` with message `Total GeorgeCall` only after all gates pass.
