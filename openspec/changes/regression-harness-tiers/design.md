# Design — regression harness tiers

## Approach

Four tiers, ordered by increasing cost and decreasing determinism. Each
tier answers exactly one question and states plainly what it does not
answer, so a passing tier is never quietly over-read as evidence for a
claim it was not built to support.

- **Tier 0 (deterministic, no vendor calls, per commit).** The existing
  383-test bats suite, sliced into roughly 14 per-subsystem gates. This
  package does not redefine how baselines are stored, how skip budgets
  are computed, or how CI wiring works — that mechanism belongs to
  test-infrastructure-hardening. What this package adds on top is the
  annual regression-injection self-test: inject a known defect into one
  slice, confirm the owning slice's pass rate drops materially while the
  aggregate barely moves, and record the delta pair (slice-delta,
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
  rather than being invented in the abstract.
- **Tier 2 (live vendor calls, statistical, per release).** 8-12 locked
  specs with seeded defects, run N=3 times against pinned model
  versions, reported with bootstrap confidence intervals. A result
  smaller than the measured variance is reported as inconclusive, not as
  a regression or an improvement — single-shot vendor evaluation is not
  a statistically defensible pass/fail signal, and Foreman should not
  pretend otherwise just because a number came back.
- **Tier 3 (live vendor calls, drift-only, per release or on demand).**
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
- **Tier 3 is the tier most likely to be quietly promoted into a gate**
  by a future contributor who sees a number and assumes lower means
  worse. The spec states explicitly, next to every Tier 3 result, that
  it never gates and why, to make that promotion a deliberate, visible
  spec change rather than an accidental CI edit.
