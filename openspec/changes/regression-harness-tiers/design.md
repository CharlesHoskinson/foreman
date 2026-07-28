# Design — regression harness tiers

## Approach

Three active tiers, ordered by increasing cost and decreasing determinism.
Each tier answers exactly one question and states plainly what it does not
answer, so a passing tier is never quietly over-read as evidence for a
claim it was not built to support. A fourth tier was designed and then cut
by the 2026-07-28 proportionality review; its bullet below is retained as a
record of the rejected-for-now design and matches no requirement, no task
and no budget in this package.

- **Tier 0 (deterministic, no vendor calls, per commit).** The existing
  383-test bats suite, sliced into roughly 14 per-subsystem gates. This
  package does not redefine how baselines are stored, how skip budgets
  are computed, or how CI wiring works — that mechanism belongs to
  test-infrastructure-hardening. What this package adds on top is the
  annual regression-injection self-test: inject a known defect into one
  slice, confirm the owning slice's pass rate drops by at least 20
  percentage points and exceeds the aggregate drop by at least 15
  percentage points, and record the delta pair (slice-delta,
  aggregate-delta) as evidence the slicing still works. Without this
  self-test, "Tier 0 passed" is an unverified claim about detection
  power, not just about the suite's current pass rate.
- **Tier 1 (deterministic, no vendor calls, per commit/PR).** Golden
  rounds recorded as vendor transcripts (vendor identity, input context,
  full response text, recorded-at version), replayed with zero network
  access. Assertions are made only against the decision trace: which
  gate fired, which verdict was reached, which events were emitted. This
  is deliberate — asserting on prose text would make the corpus brittle
  to harmless rewording and would silently start testing vendor style
  instead of orchestration logic. The corpus is seeded by
  bugeventlog.md: every distinct failure class recorded there earns at
  least one golden round, so the corpus grows with real incident history
  rather than being invented in the abstract. Each round additionally
  ships a paired defective decision trace and a `demonstration.json`
  record, and the Tier 1 runner re-executes the fail-then-pass pair on
  every run rather than trusting the record -- Tier 1 is offline and free,
  so re-execution costs nothing and a round that cannot be shown to fail
  on its own seeded defect fails the suite.
- **Tier 2 (live vendor calls, statistical, on-demand research, non-gating -- moved off the per-release cadence in the 2026-07-28 fix round; see Cuts below).** 8-12 locked
  specs with seeded defects, run N=3 times against pinned model
  versions, reported with bootstrap confidence intervals. A result
  smaller than the measured variance is reported as inconclusive, not as
  a regression or an improvement — single-shot vendor evaluation is not
  a statistically defensible pass/fail signal, and Foreman should not
  pretend otherwise just because a number came back.
- **Tier 3 -- CUT from v0.2.9 in the 2026-07-28 fix round (see Cuts below); this bullet is retained as a historical record of the rejected-for-now design, not as a live requirement.**
  A fixed 50-task SWE-bench Pro subset. It never gates anything. Given
  OpenAI's own 2026-02-23 deprecation of SWE-bench Verified (59.4% of
  audited failing problems have flawed tests) and SWE-ABS's 19.71%
  false-pass rate, treating this tier as a gate would mean gating
  releases on a benchmark whose own maintainers do not trust it at that
  level of rigor. It is retained anyway because a drift signal — is our
  score trending down over quarters — is still useful, just not as a
  release blocker.

## Alternatives REJECTED

- **Single aggregate pass/fail gate (status quo).** Rejected: the
  measured -1.7 to -5.9 pp aggregate move against a -25 to -91 pp
  slice-level move (arXiv 2606.11686) shows an aggregate gate would have
  missed the injected regressions entirely at Foreman's suite size.
- **Make SWE-bench Verified (or a similar benchmark) the primary
  regression gate.** Rejected: OpenAI's own 2026-02-23 deprecation
  notice and SWE-ABS's 19.71% rejection rate of "passing" patches mean
  the benchmark's own pass signal is not reliable enough to gate a
  release, let alone a commit; cost (~40000 USD full HAL run) also rules
  out per-commit or per-release-blocking use.
- **Assert Tier 1 golden rounds on literal vendor output text.**
  Rejected: prose varies harmlessly between runs and even between
  equivalent phrasings from the same vendor; asserting on text would
  produce constant false failures unrelated to orchestration correctness
  and would incentivize brittle golden-file updates instead of real
  triage.
- **Skip statistical treatment in Tier 2 and report single-run
  pass/fail against seeded defects.** Rejected: vendor call outputs are
  not deterministic; a single run cannot distinguish a real regression
  from ordinary run-to-run variance, which is exactly the failure mode
  N=3 plus bootstrap CI is meant to prevent.
- **Run Tier 2 or Tier 3 on every commit.** Rejected on cost and
  cadence grounds: Tier 2 requires real vendor spend across 8-12 specs
  times N=3, and Tier 3's 50-task subset carries real, non-trivial
  vendor cost; per-commit cadence at these tiers is not affordable and
  is not needed to catch orchestration-layer regressions, which Tier 0
  and Tier 1 already catch deterministically and for free.

## Risks

- **Tier 1 corpus goes stale relative to bugeventlog.md.** New failure
  classes get logged but no golden round is added, silently eroding the
  seeding guarantee. Mitigated by a coverage check that names unseeded
  failure classes explicitly rather than passing quietly.
- **The annual Tier 0 self-test is skipped for a year (or more) and
  nobody notices.** The slicing mechanism could stop actually detecting
  subsystem regressions without anyone finding out until a real
  regression slips through. Mitigated by flagging the self-test as
  overdue in harness documentation once a year has elapsed.
- **Tier 2's N=3 is itself a small sample.** Bootstrap CIs on N=3 are
  wide; a real small regression may still be swallowed as
  "inconclusive." This is accepted as the honest cost of not overclaiming
  significance rather than a defect to fix by inflating N without
  budget to match.
- **An external-benchmark drift tier is the thing most likely to be
  quietly revived** by a future contributor who sees a number and assumes
  lower means worse. Because the tier is cut rather than de-scoped, there
  is no requirement, task or budget for it to attach to; the spec's
  anti-revival clause makes reintroduction a deliberate, visible new
  requirement in a future release's own change rather than an accidental
  CI edit or an added task here. `tasks.md` section 4 is retained, empty,
  as the visible record of the cut.


## Cuts and falsifiability fixes (2026-07-28 fix round)

**Tier 3 cut from v0.2.9; Tier 2 moved from per-release to on-demand
research.** Per the audit's proportionality review: "Keep regression Tiers
0 and 1 after scoping/fixing them. Move Tier 2 to on-demand research and cut
Tier 3 from this release. Three paid runs do not support the claimed
inference, and a 50-task external benchmark tests general coding ability
more than Foreman's orchestration contract." Tier 3's SWE-bench Pro
subset, its cost figures, and its benchmark-validity caveats were sound
design work but disproportionate for this release; they are cut entirely
from the ADDED requirements rather than left half-specified. Tier 2's
statistical design (N=3, bootstrap CI) is retained -- it is the right
discipline for vendor research -- but its cadence changes from "per
release" (implying a release gate) to "on demand" (a maintainer-triggered
research tool that never gates). If a future release wants a drift anchor
again, the audit's reasoning (cost, benchmark-validity) means it should be
re-justified as a fresh requirement rather than silently resurrected.

**Tier 0 and Tier 1 acceptance criteria are now falsifiable.** Previously,
"Tier 0 catches subsystem regressions" and "Tier 1 replays golden rounds"
were unfalsifiable as written -- nothing in the spec text said what
observation would show either tier was NOT working. The fix states the
falsifying observation directly: for Tier 0, its own annual self-test
failing to show a slice-level pass-rate drop under an injected defect
falsifies the "working regression detector" claim; for Tier 1, any golden
round that cannot be shown to fail against its own target defect falsifies
that round's claimed coverage, and Tier 1's aggregate "verified regression
detector" claim is scoped to only the failure classes with a demonstrated
fail/pass pair on record. Both fixes follow the same shape as
`test-infrastructure-hardening`'s positive-control requirement: a check
that cannot be observed failing is not evidence, whether the check is a
bats assertion or an entire tier.

Both claims are now **mechanised as well as stated**, because a
falsification rule with no executor is only a better-worded assertion. Tier
0's "materially larger" is fixed as two constants -- an owning-slice drop of
at least 20 percentage points that exceeds the aggregate drop by at least 15
percentage points -- expressed as differences rather than as a ratio of the
two drops, since a ratio is undefined precisely when the aggregate does not
move, which is the outcome the self-test most wants to reward. Tier 1's
demonstration gets an artefact (`tests/golden-rounds/<round_id>/` holding
`transcript.json`, `defective-trace.json`, `corrected-trace.json` and
`demonstration.json`), an input slot in the recorded-transcript format for
the paired traces, an executor (the Tier 1 runner, on every run), a named
actor (the maintainer authoring the defective trace; the Tier 1 job
executing the pair), and a consequence that bites: the Tier 1 run FAILS on a
missing artefact, a record that is not fail-then-pass, or a replay that does
not reproduce it. The coverage-narrowing consequence is retained as a second
effect, not as the only one.

**Budgets and statistical gates are now computable, not just stated.** The
original text declared budgets and the N=3/bootstrap-CI discipline in
prose without saying what a script measures, where it records the
measurement, what comparison it runs, or what happens on a breach. The new
requirement binds to observable behaviour -- a machine-readable per-run
record, a mechanical breach/inconclusive comparison, and a flagged review
state on breach -- while leaving the exact script names and file paths as
an implementation detail, so the requirement does not accidentally freeze a
premature file-format decision that belongs to the harness build.

Two arithmetic gaps in that computation are closed here. The material-margin
threshold is fixed at **20%** and recorded as a constant beside the budget
constants, rather than offered as an example a future implementer picks; a
flagging predicate whose threshold is chosen at flagging time is not
computable. And every rate the harness reports now names its denominator and
states its zero-denominator behaviour: a rate with no denominator is
`uncomputable`, never `0`, never `100%`, and never a satisfied budget. The
concrete cases are a slice that executed no tests, a Tier 2 results array
that is empty or short of N, a corpus coverage figure over zero recorded
failure classes, and -- the one that would otherwise divide by zero on every
run -- Tier 0's and Tier 1's declared `cost_usd` budget of zero, where any
measured spend is an unconditional breach rather than an infinite percentage.
