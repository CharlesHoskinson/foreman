# Tasks — regression harness tiers

## 1. Tier 0 — slice gates and the annual self-test

- [ ] 1.1 Confirm the ~14 per-slice groupings of the existing 33 bats
      files map cleanly onto test-infrastructure-hardening's baseline
      mechanism; do not invent a second baseline store.
- [ ] 1.2 Write the annual regression-injection self-test harness: inject
      one defect per run into a single named slice, capture the
      owning-slice pass-rate delta and the aggregate pass-rate delta.
- [ ] 1.3 Assert the owning-slice delta is materially larger than the
      aggregate delta for each injected defect; fail the self-test loudly
      if a slice fails to show a detectable drop.
- [ ] 1.4 Record each self-test run's delta pair so next year's run has a
      comparison baseline.
- [ ] 1.5 Add a documentation flag/check that marks the self-test overdue
      once 12 months have elapsed since the last recorded run.

## 2. Tier 1 — vendor-replay golden corpus

- [ ] 2.1 Define the recorded-transcript format: vendor identity, input
      context, full response text, recorded-at timestamp/version.
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
      classes against seeded golden rounds and names any gap explicitly.
- [ ] 2.7 Wire a process rule: a new bugeventlog.md entry is not
      considered closed until its golden round exists.

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
- [ ] 3.7 Wire Tier 2 to run per release only; confirm no per-commit
      trigger exists.

## 4. Tier 3 — drift anchor

- [ ] 4.1 Select and fix the 50-task SWE-bench Pro sanity subset.
- [ ] 4.2 Build the runner so its result is recorded as a drift signal
      only, with no pass/fail exit status consumed by any CI job.
- [ ] 4.3 Attach the documented benchmark-validity caveats (OpenAI's
      2026-02-23 Verified deprecation, SWE-ABS's 19.71% false-pass rate)
      to every published Tier 3 result.
- [ ] 4.4 Wire Tier 3 to run per release or on demand only; confirm no
      commit, PR, or release is blocked by its score.

## 5. Cost, cadence and budget enforcement

- [ ] 5.1 Declare a runtime/cost budget and cadence for each tier (Tier
      0: seconds, no vendor cost, per commit; Tier 1: low seconds, no
      vendor cost, per commit/PR; Tier 2: declared vendor-call cost for
      N=3 x 8-12 specs, per release; Tier 3: declared cost for the
      50-task subset bounded well under full-HAL-run cost, per release
      or on demand).
- [ ] 5.2 Add a budget-review flag when a tier's actual runtime or cost
      materially exceeds its declared budget.
- [ ] 5.3 Confirm no automation path can trigger Tier 2 or Tier 3 on a
      plain commit push.

## 6. Gate

- [ ] 6.1 `wsl -e bash -lc 'cd /root/foreman && /usr/local/bin/openspec
      validate regression-harness-tiers --strict'` passes with no
      errors.
