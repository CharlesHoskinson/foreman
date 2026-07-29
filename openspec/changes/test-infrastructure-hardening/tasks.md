# Tasks — test-infrastructure-hardening

Ordering: T1-T2 are serial and land first (helper + runner). T3 is wide and
mechanical, and depends on both. T4-T7 may run in parallel after T3. T8-T9
carry the checker-soundness discipline and gate every other group's checks --
T8 in particular applies to the gates T2 and T7 introduce, so it lands with
them rather than after them, and it now also builds the registry artefact and
the full-repository inventory scanner that make the discipline mechanically
checkable. T10 gates.

## T1 — the precondition helper

- [x] Create `tests/lib/preconditions.bash` with `require_platform`,
      `require_tool`, `require_non_root`, `require_built`, and
      `require_no_live_vendor`.
- [x] Every helper skips with a message naming the unmet requirement and, where
      applicable, the command that would satisfy it.
- [x] A bare `skip` with no reason is treated as a failure by the runner.
- [x] shdoc headers on every function; shellcheck clean.

## T2 — runner: budgets, baselines, reporting

- [x] Extend `tests/run.sh` to record per-file pass/fail/skip counts.
- [x] Add `tests/skip-budget.tsv` (file × platform → permitted skips) and fail
      the run when a file exceeds its budget.
- [x] Add `tests/baseline.tsv` (file → expected pass count) and fail the run on
      any per-slice regression, independent of the aggregate.
- [x] Report budget slack so budgets can be ratcheted down.
- [x] Emit a machine-readable per-slice report for CI upload.
- [x] `tests/baseline.tsv` is never regenerated automatically from a failing
      run — regeneration is an explicit, separate command.

## T3 — annotate the existing suite

- [ ] Annotate the three Windows-dialect tests (105 pueue `.exe` quoting, 275
      backslashed `LANE_CONFIG_DIR`, 356 `taskkill //T` grandchild sweep) with
      `require_platform windows`.
- [ ] Annotate test 174 with `require_built launcher/dist` (or have the harness
      build it) — coordinate with `wsl-launcher-shipped`.
- [ ] Annotate test 343 with `require_tool docker`; triage whether its current
      failure is the precondition or a real defect, and say which.
- [ ] Triage test 138 (`lane-run kill_cmd_bounded`) — it was never diagnosed;
      classify it as defect, precondition, or flake and record the evidence.
- [ ] Sweep the remaining 33 files for undeclared preconditions rather than
      only fixing today's nine.
- [ ] Set initial skip budgets from the annotated state, per platform.

## T4 — remove live-vendor coupling

- [ ] Stub the `lane-run` grok readiness probe (`timeout 10 grok models`) in
      the grok-lane and vendor-isolation unit tests, closing the v0.2.8
      residual.
- [ ] Sweep for any other test that touches the network or vendor auth.
- [ ] Tag genuine integration tests and exclude them from the default run.

## T5 — determinism

- [ ] Move load-sensitive timing assertions onto `WATCH_VTICK` rather than
      wall-clock sleeps.
- [ ] Verify test 43 is deterministic under load once
      `lock-primitive-hardening` lands; IF it is not, log it as a separate
      finding rather than adjusting the assertion to fit.
- [ ] Establish a quarantine mechanism (tagged, excluded from default, with a
      tracking note) for any test that resists determinism.

## T6 — installer stops dirtying the tree

- [ ] Remove the working-tree chmod at `install.sh:61-63`, relying on the
      index exec bit from `crlf-extensionless-hardening`.
- [ ] Confirm `scripts/nats/setup.sh` is covered — R5 found the current chmod
      misses it entirely.
- [ ] Add a test asserting `git status --porcelain` is empty after
      `install.sh` on a clean clone.

## T7 — CI

- [ ] Add `.github/workflows/tests.yml` running the suite on `ubuntu-latest`
      and `windows-latest` (`shell: bash`), coordinating with `wsl-ci-parity`
      rather than duplicating its job.
- [ ] Upload the per-slice report as an artefact.
- [ ] Start the `windows-latest` job non-blocking; measure its flake rate over
      one release before making it blocking.
- [ ] Fix `windows-smoke.yml` to use `powershell.exe` 5.1, not `pwsh` — the
      field failure it exists to catch was 5.1-specific (R5 §20).

## T8 — positive controls: prove every predicate discriminates

- [ ] Add `tests/lib/positive-control.bash` providing the helper a check uses
      to record that it was run against an input it must reject and did reject
      it.
- [ ] Every gate, probe or assertion introduced by this release carries a
      positive control before it is trusted; a check with none is not counted
      as coverage.
- [ ] The control asserts the check produces the **negative** answer on the
      known-bad arm **and** the positive answer on the known-good arm in the
      same run — a check that classifies both arms identically is rejected.
- [ ] Create `tests/positive-control-registry.tsv` -- the committed registry
      artefact, header row plus one row per check, fields exactly `check_id`,
      `kind`, `known_bad_input`, `known_good_input`, `control_record`,
      `demonstrated_at`. Maintained like `tests/baseline.tsv`: edited
      deliberately, never regenerated from a run.
- [ ] Create `tests/lib/check-inventory.sh` -- the scanner. It sweeps the
      **whole repository tree at the commit under test** (not the release
      diff), emits `tests/.check-inventory.tsv`, and derives `check_id` as
      `<repository-relative path>::<check name>` so a row and an inventory
      member match by string equality. Recognizer grammar is the four kinds
      the spec names: `gate`, `probe`, `assertion`, `verdict-predicate`.
- [ ] Add the comparator to the release build: an inventory member with no row
      fails the build naming the `check_id`; a row whose `check_id` the
      full-repository inventory does not contain fails the build naming the
      stale row; an empty inventory fails with `inventory-empty` rather than
      reporting "no unregistered checks".
- [ ] Run the scanner at each landing stage's tip, not once at the start of
      the release, so a check landed by an earlier stage is inventoried before
      the stage that gates on it.
- [ ] Use the four known checks as the scanner's acceptance fixture rather
      than as the inventory itself: assert `check-inventory.sh` independently
      finds the `mkdir` atomicity probe (`lock-primitive-hardening` T4), the
      skip-budget check (T2), the per-slice baseline check (T2) and the docs
      gate, and record any it misses as a grammar gap to be closed. This list
      is a test of the scanner; it is NOT a hand-maintained inventory and
      nothing may be registered on the strength of appearing here.
- [ ] Retrofit the four measured incidents as fixtures: an unanchored
      `violation` substring predicate against `[ok] No violation found`; an
      exit-0-with-no-artifact lane; a truncated checker output; a
      wrong-entrypoint run.
- [ ] shdoc headers; shellcheck clean.

## T9 — artifact-bound predicates, vacuity, cross-checking

- [ ] Sweep the harness, the lane launchers and the gates for success
      predicates that read a process exit code, an unanchored substring, or an
      agent's self-report, and rebind each to the artifact and its content.
- [ ] Anchored outcome tokens everywhere output is parsed for a verdict;
      output matching no known token is ERROR, never PASS.
- [ ] Add the missing-deliverable assertion to every lane completion path — a
      lane that exits 0 with its deliverable absent is recorded as failed,
      naming the artifact. Coordinate with `vendor-adapter-contract`'s
      `vendor-multiround.sh` write-evidence digest rather than duplicating it.
- [ ] Where the mechanism allows, report precondition reachability and state
      variation alongside a passing assertion, and mark a satisfied-but-never-
      reached assertion as vacuous rather than as a pass.
- [ ] Vacuous assertions do not count toward the coverage of the property they
      name, and do not count toward a file's baseline pass count.
- [ ] Maintain a registry of predicates observed to be vacuous, each with the
      property it cannot answer and the property that can; seed it with
      `rework_rounds_bounded` → `audit_attempts_bounded_by_three`.
- [ ] Record the cross-checking rule for release-deciding results: independent
      predicate, mechanism or actor; a disagreement holds the decision; an
      uncorroborated result is reported as uncorroborated, never as verified.
- [ ] Two runs of the same predicate are not corroboration — state this in the
      rule, since it is the obvious way to satisfy it cheaply and wrongly.

## T10 — regression injection and gate

- [ ] Create `tests/inject-regressions.sh` seeding known defects (duplicate
      sequence number, swallowed concurrency collision, dropped provenance
      field) and asserting the owning slice fails for each.
- [ ] Report any seeded defect whose owning slice stays green as an
      unprotected defect class.
- [ ] Full suite green on WSL/Ubuntu 26.04 with zero unexplained failures and
      every skip inside budget.
- [ ] Full suite green on Git-Bash/Windows on the same terms.
- [ ] Confirm the nine failures observed on 2026-07-28 are each either fixed,
      skipped with a stated reason inside budget, or explicitly quarantined —
      and that none was silenced by weakening an assertion.
- [ ] `bugeventlog.md` entry recording the triage-tax failure class and this
      enhancement.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] The registry/inventory comparator runs in the release build and exits
      zero: every member of the full-repository inventory has a registry row,
      no row is stale, and the inventory is non-empty. The gate is the
      comparator's exit status, not a human reading a list.
- [ ] Each registry row's `control_record` is present and shows the check
      FAILING on the known-bad arm and passing on the known-good arm in the
      same run.
- [ ] The comparator is itself demonstrated: a deliberately unregistered check
      is shown failing the build, and adding its row is shown restoring a
      passing build.
- [ ] Every rate the runner reports names its denominator, and a run with a
      zero denominator renders `UNCOMPUTABLE (<denominator name> = 0)` rather
      than 0, 100%, blank or `n/a`; a gate depending on an uncomputable rate
      is recorded ERROR, never pass.
- [ ] No success predicate in the harness, the launchers or the gates reads a
      process exit code, an unanchored substring, or an agent's self-report.
- [ ] The four measured vacuous-check incidents of 2026-07-28 are present as
      fixtures and each is rejected by the corresponding check.
- [ ] `bugeventlog.md` entry recording the vacuous-check failure class — the
      four instances, the common shape (a predicate believed without ever
      having been observed to fail), and this enhancement.
