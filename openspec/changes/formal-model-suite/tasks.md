# Tasks — formal-model-suite

Ordering: T1 lands first (the classifier everything else reads through, with
its positive control). T2-T3 are serial on T1. T4-T7 may run in parallel once
T3 lands. T8 gates.

## T1 — the outcome classifier and its positive control

- [x] Create `formal/run-checks.sh` with a single classifier that maps checker
      output to `VIOLATED` / `HOLDS` / `ERROR`.
- [x] Match anchored outcome lines only: `^\[violation\]` and `^\[ok\]`. No
      unanchored substring search — `[ok] No violation found` contains
      `violation`, and that predicate reported every run on 2026-07-28 as
      violated, control arms included.
- [x] Output matching neither anchor is `ERROR`, never `PASS`. A crash, a
      timeout or a changed output format is an unknown, and unknowns are not
      green.
- [x] Positive control: `formal/fixtures/` holds one known-violating and one
      known-holding run whose classification is asserted before any real row is
      executed. IF either fixture misclassifies, THEN the suite aborts without
      running the manifest.
- [x] shdoc headers on every function; shellcheck clean.

## T2 — the expectation manifest

- [x] Create `formal/expectations.tsv`: model, config (`--init`/`--step` or
      `--main`), invariant or witness, expected outcome, method, bound, tier,
      provenance.
- [x] Seed the gating rows from the architect-reproduced inventory in
      `formal/reports/VERIFY-quint-architect.md` and nothing else.
- [x] `eventlog_concurrency`: `toctou`/`mutual_exclusion` VIOLATED,
      `toctou`/`seq_uniqueness` VIOLATED, `atomic`/`mutual_exclusion` HOLDS,
      `atomic`/`seq_uniqueness` HOLDS.
- [x] `audit_gate`: `pre_fix`/`no_stale_approved_merge` VIOLATED,
      `pre_fix`/`no_unaudited_merge` VIOLATED, `post_fix`/both HOLDS.
- [x] `audit_gate`: `uncapped_errors`/`audit_attempts_bounded_by_three`
      VIOLATED, `capped_errors`/`audit_attempts_bounded_by_three` HOLDS.
- [x] `audit_gate`: `post_fix`/`no_unverified_checks_merge` VIOLATED,
      `post_fix`/`no_unverified_docs_merge` VIOLATED,
      `post_fix_full_binding`/`no_unverified_checks_merge` HOLDS.
- [x] `lane_lifecycle`: `init_prefix`/`step_prefix` VIOLATED against both
      `inv_round_done_requires_fresh_report` and
      `inv_no_completion_from_exit_code`;
      `init_postfix`/`step_postfix_without_resume` HOLDS against
      `inv_round_done_requires_fresh_report`.
- [x] `lane_lifecycle`: `init_postfix`/`step_shipped_resume_bug` REACHABLE for
      `witness_shipped_resume_loses_round_ownership`;
      `init_postfix`/`step_postfix` NOT REACHABLE for the same witness.
- [ ] Record every lane-reported but unreproduced finding as a **non-gating**
      row marked `unreproduced` — M2's fail-open, compaction, NATS-token and
      lock-ordering results; M3's gate-to-merge TOCTOU, merge-freshness,
      `WARNING`-authorises-merge and cross-vendor-gateway results.
- [x] The manifest is never generated from a run. Regeneration is not a
      supported operation.

## T3 — the runner

- [x] `formal/run-checks.sh` executes every gating row and compares observed to
      expected in both directions.
- [x] A VIOLATED-expected row observed to hold fails the run and reports the
      model as having lost its discriminating power.
- [x] A HOLDS-expected row observed to violate fails the run and reports a
      regression in the modelled fix.
- [x] Refuse to record a result against a named configuration when no explicit
      entrypoint was supplied; report which entrypoint was exercised instead.
- [x] Pin and assert Quint 0.32.0 and Apalache 0.56.1; fail naming both
      versions on mismatch.
- [x] Resolve the checker through a stable absolute path, not the `fnm`
      multishell path (`/run/user/0/fnm_multishells/...`) that does not survive
      a new shell; an absent checker fails, it does not skip.
- [x] Emit a machine-readable per-row report for CI upload.

## T4 — vacuous-predicate registry

- [x] Create `formal/vacuous-predicates.tsv`: predicate, property it cannot
      answer, property that can, evidence.
- [x] Seed `rework_rounds_bounded` → cannot answer UNVERIFIED-loop termination
      (it constrains `round`, which never advances in that loop) → use
      `audit_attempts_bounded_by_three`.
- [ ] Fail the run IF a manifest row or a report cites a registered predicate
      for its registered property.
- [x] Cross-reference the correction in `three-outcome-verdicts`: the loop
      needs a separate bound (`max_audit_attempts` /
      `max_consecutive_unverified`) and must not reuse
      `limits.max_rework_rounds`. Do not implement it here.

## T5 — coverage records and the drift gate

- [ ] Create `formal/coverage.tsv` mapping each model to the source files it
      abstracts.
- [ ] Add a coverage header to each `.qnt` naming those files, and cite line
      ranges where an action mirrors specific code — starting with
      `witness_shipped_resume_loses_round_ownership` →
      `lane-supervise.sh:343-345`.
- [x] Gate: a change touching a covered file with no model or manifest change
      fails, naming the drift.
- [ ] The escape hatch is a recorded sentence in the change stating why the
      abstraction is unaffected — explicit, never silent.
- [ ] Docs rule: a drifted model SHALL NOT be cited as evidence anywhere.

## T6 — method and bound in the output

- [ ] Every reported row carries its method (simulation samples and trace
      length, or Apalache depth) and the checker version.
- [ ] A no-counterexample-within-N result prints as "no counterexample within N
      steps", never as proof, guarantee or "verified correct".
- [ ] Carry the standing limits: M2 at 20k samples, M3 at 10k, Apalache bounds
      8-12; nothing established about fairness, torn writes, real subprocess
      kill or hash collisions.
- [x] Record M1's `eventually_terminal` as a no-fairness stuttering artifact,
      explicitly not a liveness defect.

## T7 — CI and operational discipline

- [x] Add `.github/workflows/formal.yml`: typecheck all three models plus the
      per-commit manifest tier; upload the per-row report.
- [x] Tier the manifest so the per-commit set fits the CI budget — measured
      Apalache runtimes span 7.7 s to 385.8 s per configuration — and schedule
      the deep-bound tier separately.
- [x] Ban `pkill -f` in `formal/` and in lane recipes; terminate an owned PID
      or process group. `pkill -f "quint verify"` matched the issuing lane's
      own command line on 2026-07-28 and would also have killed a sibling lane
      on the shared Apalache server at port 8822.
- [ ] Make ownership of a shared Apalache server explicit; a non-owner never
      stops it.

## T8 — gate

- [x] All three models typecheck under the pinned Quint 0.32.0.
- [ ] Every gating manifest row reproduces its recorded outcome on the
      reference WSL box, and the run output is attached — not summarised.
- [ ] Positive control: deliberately weaken one pre-fix configuration so it
      stops violating, and confirm the suite **fails**. A suite never observed
      failing is not evidence. Revert afterwards.
- [x] Positive control: feed the classifier a `[ok] No violation found` line
      and confirm it classifies as HOLDS, and a truncated output and confirm it
      classifies as ERROR.
- [ ] Confirm no report or proposal in the repo describes a bounded result as a
      proof.
- [ ] `bugeventlog.md` entry recording the three vacuous checks of 2026-07-28,
      their common shape, and this enhancement.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [x] `openspec validate formal-model-suite --strict` passes.
