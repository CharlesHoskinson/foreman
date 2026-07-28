# Tasks — regression harness tiers

## 1. Tier 0 — slice gates and the annual self-test

- [ ] 1.1 Confirm the ~14 per-slice groupings of the existing 33 bats
      files map cleanly onto test-infrastructure-hardening's baseline
      mechanism; do not invent a second baseline store.
- [ ] 1.2 Write the annual regression-injection self-test harness: inject
      one defect per run into a single named slice, capture the
      owning-slice pass-rate delta and the aggregate pass-rate delta.
- [ ] 1.3 Assert the stated detection criterion for each injected defect:
      owning-slice pass-rate drop >= 20 percentage points AND exceeding the
      aggregate drop by >= 15 percentage points. Fail the self-test loudly
      when either figure is not met, naming both measured drops. Compare
      differences, never a ratio of the two drops.
- [ ] 1.4 Record each self-test run's delta pair so next year's run has a
      comparison baseline.
- [ ] 1.5 Add a documentation flag/check that marks the self-test overdue
      once 12 months have elapsed since the last recorded run.

## 2. Tier 1 — vendor-replay golden corpus

- [ ] 2.1 Define the recorded-transcript format: vendor identity, input
      context, full response text, recorded-at timestamp/version, plus
      `round_id`, the covered `bugeventlog.md` failure class, and the paths
      of the paired defective and corrected decision traces.
- [ ] 2.2 Read bugeventlog.md and enumerate every distinct failure class
      recorded there.
- [ ] 2.3 Seed one golden round per failure class (10-12 rounds
      initially), each reproducing the decision-trace conditions of that
      failure.
- [ ] 2.4 Build the replay harness: feed a recorded transcript in place
      of a live vendor call, with zero network access.
- [ ] 2.5 Write decision-trace assertions only (gate fired, verdict
      reached, events emitted) — no assertion may depend on literal
      vendor prose.
- [ ] 2.6 Add a coverage check that compares bugeventlog.md failure
      classes against golden rounds **with a demonstrated fail/pass pair**,
      not merely against seeded rounds, and names any gap explicitly.
- [ ] 2.7 Wire a process rule: a new bugeventlog.md entry is not
      considered closed until its golden round exists and its demonstration
      record exists.
- [ ] 2.8 Create the round layout `tests/golden-rounds/<round_id>/` holding
      `transcript.json`, `defective-trace.json`, `corrected-trace.json` and
      `demonstration.json`, with `demonstration.json` fields `round_id`,
      `failure_class`, `defective_trace`, `corrected_trace`,
      `defective_verdict`, `corrected_verdict`, `harness_version`,
      `demonstrated_at`, `demonstrated_by`.
- [ ] 2.9 Build the demonstration into the Tier 1 runner: on every Tier 1
      execution, replay each round against both traces and compare the
      observed pair against `demonstration.json`. A missing artefact, a
      record that is not fail-then-pass, or a replay that does not reproduce
      the pair FAILS the Tier 1 run naming the `round_id` -- a suite failure,
      not only a narrowing of the claimed coverage.
- [ ] 2.10 Name the actors: the Tier 1 job (per commit or PR) executes the
      demonstration; the maintainer adding or modifying a round authors
      `defective-trace.json`, and a round may not be added without one.

## 3. Tier 2 — seeded-defect statistical runs

- [ ] 3.1 Lock 8-12 specs with seeded defects against pinned vendor model
      versions.
- [ ] 3.2 Implement N=3 repeated runs per spec per comparison condition.
- [ ] 3.3 Implement bootstrap confidence interval computation over the
      N=3 results.
- [ ] 3.4 Implement the inconclusive-result rule: a difference smaller
      than the bootstrap CI width is reported as inconclusive, never as a
      detected regression or improvement.
- [ ] 3.5 Report pinned model identifier/version, N, point estimate, and
      CI together on every Tier 2 result.
- [ ] 3.6 Detect and flag an unpinned/updated model mid-comparison as
      invalidating that comparison.
- [ ] 3.7 Confirm Tier 2 has no automatic trigger at all: no CI workflow,
      release script, tag hook or scheduled job invokes it on a commit, a
      PR, or a release cut. Tier 2 runs only on explicit maintainer
      invocation, per the spec's on-demand cadence.

## 4. External-benchmark drift anchor — CUT from v0.2.9, no tasks

The former Tier 3 (a 50-task SWE-bench Pro sanity subset) is cut from this
release by the 2026-07-28 proportionality review and carries **no tasks**.
Nothing under this package may build, wire, budget or gate it. Reintroducing
an external-benchmark drift tier requires a new requirement in a future
release's own change, per the spec's anti-revival clause; adding tasks here
is exactly the silent revival that clause forbids. This section is retained
only so the numbering of sections 5 and 6 is stable and the cut is visible
rather than inferred from an absence.

## 5. Cost, cadence and budget enforcement

- [ ] 5.1 Declare a runtime/cost budget and cadence for each of the three
      active tiers (Tier 0: seconds, `cost_usd` budget 0, per commit; Tier
      1: low seconds, `cost_usd` budget 0, per commit/PR; Tier 2: declared
      vendor-call cost for N=3 x 8-12 specs, on demand only -- never on a
      commit, a PR, or a release cut). No Tier 3 budget is declared; the
      tier is cut.
- [ ] 5.2 Add a budget-review flag when a tier's actual runtime or cost
      exceeds its declared budget by more than the fixed 20%
      material-margin threshold, recorded as a constant alongside the
      budget constants rather than chosen per run.
- [ ] 5.3 Confirm no automation path can trigger Tier 2 on a commit push, a
      PR, or a release cut.
- [ ] 5.4 Implement the zero-denominator rule in the run record: every rate
      names its denominator; a zero denominator records `uncomputable` with
      the denominator's name rather than a number; a zero declared
      `cost_usd` budget with non-zero measured cost records
      `budget_breach: true` unconditionally with no percentage; an empty or
      short Tier 2 results array records the CI `uncomputable` and the
      comparison `inconclusive`; any decision depending on an uncomputable
      figure records `not_evaluated`, never a pass.

## 6. Gate

- [ ] 6.1 `wsl -e bash -lc 'cd /root/foreman && /usr/local/bin/openspec
      validate regression-harness-tiers --strict'` passes with no
      errors.
