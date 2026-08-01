# Proposal — regression harness tiers

## Why

Foreman's orchestration layer has 50 bats files / 635 tests
(`find tests -maxdepth 1 -type f -name '*.bats' | wc -l` and
`find tests -maxdepth 1 -type f -name '*.bats' | xargs grep -h '^@test' | wc -l`;
`tests/run.sh` selects that top-level set, and the gate prints `tests=635`).
`grep -rn FOREMAN_CI_BATS .github/workflows/` shows `gates-linux.yml`
setting `FOREMAN_CI_BATS: "1"`, so the suite runs and gates on Linux for
pushes to `main` and every pull request (`on.push.branches: [main]` plus
`pull_request`), and `gates-windows.yml` setting it to `"0"`, which
disables the full suite as a gate; Windows still executes a deliberate
two-file non-gating bats probe over `tests/line-endings.bats` and
`tests/plugin-drift.bats` (`gates-windows.yml` lines 86–114).
A historical fresh-clone baseline (2026-07-28 hand-triage recorded in
test-infrastructure-hardening) was 373 pass / 9 fail, and
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

This package specifies a three-tier regression harness that separates
"did the orchestration layer regress" (cheap, deterministic, gates every
commit) from "did vendor-quality drift" (expensive, statistical,
non-gating), so the harness stops asking every question at every price
point. A fourth tier -- a fixed external-benchmark drift anchor -- was
scoped and then cut by the 2026-07-28 proportionality review; the reasoning
above is why it was considered, and the Cuts section of `design.md` records
why it is not in this release.

## What changes

- Define three active tiers (Tier 0-2) with an explicit statement of what
  each tier establishes and does not establish, and record that an
  external-benchmark drift tier is cut from this release.
- Tier 0: slice the existing bats suite into baseline-locked per-slice
  gates (per-slice baseline mechanics themselves are owned by
  test-infrastructure-hardening) and add an annual regression-injection
  self-test that proves the slicing actually catches subsystem
  regressions the aggregate hides.
- Tier 1: a deterministic vendor-replay corpus of 10-12 golden rounds,
  recorded as vendor transcripts, seeded from every failure class in
  bugeventlog.md, asserting only on the decision trace (gate fired,
  verdict reached, events emitted) and never on model prose. Every round
  ships a paired defective decision trace and a `demonstration.json`
  record, and the Tier 1 runner re-executes the fail-then-pass pair on
  every run -- a round that cannot be shown to fail on its own seeded
  defect fails the Tier 1 suite rather than merely narrowing a claim.
- Tier 2: 8-12 locked specs with seeded defects, pinned vendor models,
  N=3 runs, and bootstrap confidence intervals, run on demand by an
  explicit maintainer invocation -- never automatically on a commit, a PR,
  or a release cut -- with an explicit rule that a difference smaller than
  measured variance is not a result.
- **Cut from this release:** a 50-task SWE-bench Pro external-benchmark
  drift anchor. Three paid runs do not support the claimed inference and a
  general coding benchmark tests something other than Foreman's
  orchestration contract. It carries no requirement, no task and no budget
  here; reviving it requires a new requirement in a future release's own
  change.
- Explicit cost/runtime budgets and cadence per active tier, with a fixed
  20% material-margin threshold and a stated zero-denominator rule, so
  nobody accidentally wires Tier 2 into a per-commit gate and no rate is
  reported as zero when it was never measured.

## Impact

- Affected specs: adds `regression-harness` capability
  (`openspec/changes/regression-harness-tiers/specs/regression-harness/spec.md`).
- Affected code: none directly authored by this package; Tier 0
  execution depends on test-infrastructure-hardening's per-slice
  baseline/skip-budget/CI mechanism, which this package treats as a
  dependency and does not redefine.
- No breaking changes; this is additive test infrastructure.
