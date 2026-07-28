# Proposal — regression harness tiers

## Why

Foreman's orchestration layer has 33 bats files / 382 tests and runs on no
CI on any platform. A fresh-clone baseline is 373 pass / 9 fail, and
hand-triage of that baseline found only 2 of the 9 failures were product
defects; the rest were platform, privilege, build-artefact or
test-validity problems wearing the same red as a real bug. A flat
aggregate pass/fail number cannot distinguish these, and it also cannot
surface subsystem-level regressions: measured evidence from a 238-case,
23-slice suite (arXiv 2606.11686) shows six injected regressions moved
the aggregate only -1.7 to -5.9 percentage points while the owning slice
dropped -25 to -91 points. At Foreman's scale, an aggregate-only gate is
close to useless as a regression detector.

Meanwhile, external SWE-bench-style benchmarks are not a usable
substitute for an orchestration regression harness. OpenAI formally
deprecated SWE-bench Verified on 2026-02-23 because 59.4% of audited
failing problems have flawed tests. SWE-ABS rejects 19.71% of "passing"
patches. A full HAL-style run costs roughly 40000 USD; a reduced
Verified-Mini-scale run costs roughly 259 USD. None of this is
affordable or trustworthy as a per-commit or even per-release gate on its
own, and none of it exercises Foreman's own decision logic (which gate
fired, which verdict was reached) rather than a vendor's code-writing
skill.

This package specifies a four-tier regression harness that separates
"did the orchestration layer regress" (cheap, deterministic, gates every
commit) from "did vendor-quality drift" (expensive, statistical,
non-gating), so the harness stops asking every question at every price
point.

## What changes

- Define four tiers (Tier 0-3) with an explicit statement of what each
  tier establishes and does not establish.
- Tier 0: slice the existing bats suite into baseline-locked per-slice
  gates (per-slice baseline mechanics themselves are owned by
  test-infrastructure-hardening) and add an annual regression-injection
  self-test that proves the slicing actually catches subsystem
  regressions the aggregate hides.
- Tier 1: a deterministic vendor-replay corpus of 10-12 golden rounds,
  recorded as vendor transcripts, seeded from every failure class in
  bugeventlog.md, asserting only on the decision trace (gate fired,
  verdict reached, events emitted) and never on model prose.
- Tier 2: 8-12 locked specs with seeded defects, pinned vendor models,
  N=3 runs, and bootstrap confidence intervals, run per release rather
  than per commit, with an explicit rule that a difference smaller than
  measured variance is not a result.
- Tier 3: a 50-task SWE-bench Pro sanity subset that is a drift anchor
  only and never gates a commit, PR, or release.
- Explicit cost/runtime budgets and cadence per tier, so nobody
  accidentally wires Tier 2 or Tier 3 into a per-commit gate.

## Impact

- Affected specs: adds `regression-harness` capability
  (`openspec/changes/regression-harness-tiers/specs/regression-harness/spec.md`).
- Affected code: none directly authored by this package; Tier 0
  execution depends on test-infrastructure-hardening's per-slice
  baseline/skip-budget/CI mechanism, which this package treats as a
  dependency and does not redefine.
- No breaking changes; this is additive test infrastructure.
