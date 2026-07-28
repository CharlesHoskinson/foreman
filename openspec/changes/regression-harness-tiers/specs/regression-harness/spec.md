# Spec delta - regression harness tiers

EARS-phrased. See skills/foreman/references/five-part-spec.md.
Header shape follows the OpenSpec CLI's parseable form (see
lock-primitive-hardening/tasks.md T8 for the repo-wide conformance debt).

## ADDED Requirements

### Requirement: orchestration-gating tiers are Tier 0 and Tier 1; Tier 2 is on-demand vendor research; Tier 3 is cut from this release

The regression harness SHALL organize orchestration-layer testing into three
active tiers for v0.2.9 -- Tier 0, Tier 1, and Tier 2 -- ordered by
increasing cost and decreasing determinism, and each tier's specification
SHALL state what it establishes and what it explicitly does not establish.

WHEN a contributor or auditor asks what a passing tier proves, THEN the
tier's own documentation SHALL answer without reference to another tier's
guarantees.
IF a proposed test does not fit any tier's stated purpose, THEN it SHALL NOT
be added to that tier merely because it is convenient to run there.
The three active tiers SHALL be: Tier 0 (deterministic, no-LLM, per-commit
slice gates, gating), Tier 1 (deterministic vendor-replay against recorded
transcripts, per-commit or per-PR, gating), and Tier 2 (live vendor calls
against seeded defects with statistical discipline, on-demand vendor
research, non-gating).
Tier 3 (a fixed external-benchmark drift anchor) is cut from v0.2.9's scope
per the audit's proportionality review: three paid runs do not support the
claimed inference, and a 50-task external benchmark tests general coding
ability more than Foreman's orchestration contract. IF a future release
reintroduces an external-benchmark drift tier, THEN it SHALL be specified as
a new requirement in that release's own change, not silently revived by
adding tasks under this package.

#### Scenario: Tier 0 passing does not certify vendor behaviour

- WHEN all Tier 0 slice gates pass on a commit
- THEN that result SHALL be read only as "no orchestration-code regression
  detected in the sliced bats suite"
- AND SHALL NOT be represented as evidence that any vendor model behaves
  correctly.

#### Scenario: Tier 2 is non-gating research, never a release blocker

- WHEN a Tier 2 seeded-defect run completes with any result
- THEN that result SHALL NOT block or approve a release by itself
- AND SHALL be recorded only as a research finding for maintainer review.

### Requirement: Tier 0 slice gates catch subsystem regressions the aggregate hides, and the claim is falsifiable

Tier 0 SHALL run the existing bats suite sliced into per-subsystem
baseline-locked gates, and SHALL be exercised at least annually by a
regression-injection self-test that measures whether an injected defect
moves its owning slice's pass rate, not only the aggregate.

WHILE Tier 0 gates are baseline-locked per test-infrastructure-hardening's
mechanism, the regression-harness-tiers package SHALL treat that mechanism
as a dependency and SHALL NOT redefine per-slice baseline storage, skip
budgets, or CI wiring.
IF the annual regression-injection self-test injects a defect into one
slice, THEN it SHALL assert that the owning slice's pass rate drops by an
amount consistent with a real regression, AND SHALL assert that the
aggregate pass rate alone would not be a reliable detector.
WHEN the self-test's injected-defect run is complete, THEN its result
(owning-slice delta vs aggregate delta) SHALL be recorded so the next year's
self-test can compare against it.
"Materially larger" SHALL be a fixed, computed criterion rather than a
judgement: the detection criterion is met WHEN the owning slice's pass-rate
drop is at least **20 percentage points** AND exceeds the aggregate suite's
pass-rate drop by at least **15 percentage points**. Both figures are stated
as differences, never as a ratio of the two drops, because a ratio is
undefined in the very case the self-test most wants to reward -- an aggregate
that does not move at all. The two constants are grounded in the measured
evidence this package cites (aggregate moved -1.7 to -5.9 points while the
owning slice dropped -25 to -91 points); a release that changes them SHALL
record the measurement that justifies the new values.
Tier 0's claim to be a working regression detector is falsifiable by a
stated observation: IF the most recently completed annual self-test's
injected defect did NOT meet that criterion, THEN Tier 0 SHALL be treated as
an unverified regression detector until the self-test (or the slicing it
tests) is fixed and rerun successfully. A Tier 0 whose own self-test cannot
be shown to fail under a real injected defect provides the same evidence as
a self-test that has never been run.

#### Scenario: an injected defect is caught by its slice even when the aggregate barely moves

- WHEN a defect is injected into a single Tier 0 slice during the annual
  self-test
- THEN the owning slice SHALL show a pass-rate drop of at least 20
  percentage points that exceeds the aggregate suite's drop by at least 15
  percentage points
- AND the self-test SHALL fail loudly when either figure is not met, naming
  both measured drops.

#### Scenario: Tier 0 alone does not replace the annual self-test

- WHEN a full year passes without running the regression-injection
  self-test
- THEN Tier 0's per-commit gates SHALL be considered unverified as
  regression detectors
- AND the harness documentation SHALL flag the self-test as overdue.

#### Scenario: Tier 0's detector claim is withdrawn when its own self-test cannot fail

- WHEN the most recent annual self-test's injected defect fails the stated
  detection criterion (slice drop below 20 points, or exceeding the
  aggregate drop by fewer than 15 points)
- THEN Tier 0 SHALL be reported as an unverified regression detector
- AND the report SHALL name the self-test run that failed to demonstrate
  detection, not merely note the suite's ordinary pass rate.

### Requirement: Tier 1 vendor replay asserts on the decision trace, never on model prose

Tier 1 SHALL replay a corpus of golden rounds from recorded vendor
transcripts, and every Tier 1 assertion SHALL be made against the decision
trace (which gate fired, which verdict was reached, which events were
emitted), and SHALL NOT be made against the literal text of any vendor's
generated prose.

WHEN a golden round is replayed, THEN the harness SHALL feed the recorded
transcript to the orchestration layer as if it were a live vendor response,
and SHALL make no live vendor call.
IF a golden round's recorded transcript changes wording without changing
its semantic content, THEN a Tier 1 assertion tied only to the decision
trace SHALL still pass, because the assertion SHALL NOT depend on exact
prose.
The recorded-transcript format SHALL capture, at minimum, the vendor
identity, the round's input context, the full vendor response text, and the
timestamp/version of when it was recorded, so it can be replayed
byte-for-byte deterministically. It SHALL additionally carry the round's
`round_id`, the `bugeventlog.md` failure class it covers, and the
repository-relative paths of the paired defective and corrected decision
traces the demonstration requirement below replays it against -- without that
slot the demonstration has no input and cannot be run.
Tier 1 SHALL run deterministically, with no network access and no vendor
API cost.

#### Scenario: a decision-trace assertion survives a cosmetic transcript edit

- WHEN a golden round's recorded vendor response is replayed with identical
  decision-relevant content but different phrasing
- THEN the Tier 1 assertion on gate/verdict/emitted-events SHALL still pass
- AND no assertion SHALL exist in Tier 1 that fails solely due to wording.

#### Scenario: Tier 1 runs with zero vendor calls

- WHEN the Tier 1 suite executes in CI or locally
- THEN it SHALL make no outbound call to any vendor API
- AND its runtime and cost SHALL be attributable entirely to local replay.

### Requirement: each Tier 1 golden round is demonstrated to fail against its own seeded defect

A golden round whose assertions are too loose to ever fail provides no
regression coverage regardless of how many rounds the corpus contains. For
every golden round in the Tier 1 corpus, the demonstration SHALL be executed
by the harness rather than asserted in prose: the round's assertion FAILS
when replayed against a decision trace exhibiting the specific defect it is
meant to catch (drawn from the bugeventlog.md failure class it covers), and
PASSES when replayed against the corrected trace.

**The artefact.** Each golden round SHALL be a directory
`tests/golden-rounds/<round_id>/` containing `transcript.json` (the recorded
vendor transcript), `defective-trace.json`, `corrected-trace.json`, and
`demonstration.json`. `demonstration.json` SHALL carry the fields `round_id`,
`failure_class`, `defective_trace`, `corrected_trace`, `defective_verdict`,
`corrected_verdict`, `harness_version`, `demonstrated_at` (commit id) and
`demonstrated_by` (the actor that produced the record). A valid record has
`defective_verdict == "fail"` and `corrected_verdict == "pass"`.

**The mechanism and the actor.** The Tier 1 runner SHALL, on every Tier 1
execution, replay each round against both traces and compare the observed
verdict pair against `demonstration.json`. Tier 1 is deterministic, offline
and free, so the demonstration is re-executed rather than trusted from a
record. The actor is therefore the Tier 1 job itself (per commit or per PR);
the maintainer adding or modifying a round is the actor who authors
`defective-trace.json`, and a round may not be added without one.

WHEN a golden round is added or modified, THEN it SHALL be run once against
its defective decision trace and once against its corrected trace, and the
two runs SHALL produce different verdicts (fail, then pass), recorded in
`demonstration.json`.
IF a round directory lacks `defective-trace.json` or `demonstration.json`,
or its record is not the fail-then-pass pair, or the runner's replay does not
reproduce that pair, THEN the Tier 1 run SHALL FAIL naming the `round_id` and
the discrepancy -- this is a suite failure, not only a reporting-scope
narrowing, and it is the mechanism that makes this requirement enforceable
rather than asserted.
IF a golden round's assertion produces the same verdict against both the
defective and the corrected trace, THEN the round SHALL additionally be
treated as providing no protection for its target failure class, and it SHALL
be excluded from the corpus's claimed failure-class coverage until fixed.
Tier 1 as a whole SHALL NOT be reported as a verified regression detector
for a failure class whose golden round lacks this demonstrated fail/pass
pair on record.

#### Scenario: a golden round that cannot fail is excluded from claimed coverage

- WHEN a golden round's assertion is run against a decision trace with its
  target defect reintroduced
- AND it still reports pass
- THEN the Tier 1 run fails naming the `round_id`
- AND the round is excluded from the corpus's claimed coverage and the
  failure class it was meant to cover is reported as unseeded by name.

#### Scenario: a round shipped without a defective trace fails the Tier 1 run

- WHEN a golden round directory contains `transcript.json` but no
  `defective-trace.json` or no `demonstration.json`
- THEN the Tier 1 run fails naming the `round_id` and the missing artefact
- AND the corpus is not reported as covering that round's failure class.

#### Scenario: Tier 1 reports only demonstrated coverage

- WHEN every golden round in the corpus has a recorded fail-on-defect /
  pass-on-fix pair
- THEN Tier 1 is reported as a verified regression detector for those
  failure classes
- AND any round missing this pair excludes its failure class from that
  claim.

### Requirement: every bugeventlog.md failure class earns a golden round

The Tier 1 corpus SHALL be seeded such that every distinct failure class
recorded in bugeventlog.md has at least one corresponding golden round
that reproduces the decision-trace conditions of that failure.

WHEN a new failure class is appended to bugeventlog.md, THEN a golden
round covering it SHALL be added to the Tier 1 corpus before the fix is
considered closed.
IF a failure class in bugeventlog.md has no corresponding golden round,
THEN the Tier 1 corpus SHALL be treated as incomplete and the gap SHALL be
listed by failure-class name.
The corpus SHALL target 10-12 golden rounds initially, sized to
failure-class coverage rather than to an arbitrary round count.

#### Scenario: a new bugeventlog entry without a golden round is a tracked gap

- WHEN a failure event is appended to bugeventlog.md describing a
  previously unseen failure class
- THEN the Tier 1 corpus coverage check SHALL report that failure class as
  unseeded
- AND SHALL name it explicitly rather than silently passing.

#### Scenario: corpus size follows failure-class coverage, not a fixed count

- WHEN the number of distinct failure classes in bugeventlog.md exceeds
  the number of golden rounds
- THEN the corpus SHALL be grown to cover the missing classes
- AND SHALL NOT be considered complete merely because it has reached 10-12
  rounds.

### Requirement: Tier 2 seeded-defect runs are on-demand vendor research with statistical discipline, not a release gate

Tier 2 SHALL run 8-12 locked specs with seeded defects against pinned
vendor models, on demand rather than automatically per release, each run
repeated N=3 times, and results SHALL be reported with a bootstrap
confidence interval rather than a single point estimate. No Tier 2 result
SHALL gate, block, or approve a commit, PR, or release; it is a research
signal for maintainers only. This narrows Tier 2's cadence per the audit's
proportionality review: three paid runs do not support a release-gating
inference, so Tier 2 moves from automatic per-release execution to
maintainer-triggered, on-demand research.

IF a comparison between two conditions (e.g. before/after a change) shows a
difference smaller than the measured variance across the N=3 runs, THEN the
harness SHALL report it as inconclusive, and SHALL NOT report it as a
detected regression or improvement.
WHEN a Tier 2 run reports a result, THEN it SHALL include the pinned model
identifier and version, the N value, and the bootstrap confidence interval
alongside the point estimate.
The vendor models used in Tier 2 SHALL be pinned to a specific version for
the duration of a comparison, so that a result is not confounded by an
unannounced vendor-side model update.
WHEN a Tier 2 run is initiated, THEN it SHALL be a maintainer-triggered,
on-demand action, and SHALL NOT be wired into any CI trigger that runs
automatically on a commit, PR, or release cut.

#### Scenario: a difference within measured variance is not reported as a regression

- WHEN a Tier 2 seeded-defect run shows a score difference smaller than the
  bootstrap confidence interval's width
- THEN the harness SHALL classify the result as inconclusive
- AND SHALL NOT emit a pass/fail verdict claiming a regression was
  detected.

#### Scenario: an unpinned model silently updating invalidates the comparison

- WHEN a Tier 2 run's vendor model version is not pinned and the vendor
  updates the model between the N=3 runs
- THEN the harness SHALL flag the run as invalid for regression comparison
- AND SHALL require re-running with a pinned version before reporting a
  result.

#### Scenario: Tier 2 never runs automatically

- WHEN a release is cut, or a commit or PR is pushed
- THEN Tier 2 SHALL NOT be triggered automatically by either event
- AND it SHALL run only when a maintainer explicitly invokes it as
  research.

### Requirement: each active tier carries an explicit cost/runtime budget and cadence

Each of Tier 0, Tier 1 and Tier 2 SHALL declare a maximum runtime budget, a
maximum vendor-cost budget, and the cadence at which it runs, and the
harness SHALL NOT run a tier more frequently than its declared cadence
permits without an explicit override.

WHEN Tier 0 runs, THEN it SHALL complete within a per-commit-appropriate
budget (seconds, no vendor cost) and SHALL run on every commit.
WHEN Tier 1 runs, THEN it SHALL complete within a per-commit-or-per-PR
budget (low seconds, no vendor cost) and SHALL run on every commit or PR.
WHEN Tier 2 runs, THEN it SHALL run only on demand -- never automatically on
a commit, PR, or release cut -- and SHALL declare its expected vendor-call
cost before execution given N=3 runs across 8-12 specs with pinned models.
IF any tier's actual runtime or cost exceeds its declared budget by more
than the fixed 20% material-margin threshold, THEN the run SHALL be flagged
for budget review before its result is trusted.

#### Scenario: Tier 2 is never invoked automatically, on a commit or a release

- WHEN a commit is pushed, a PR is opened, or a release is cut
- THEN Tier 2 SHALL NOT be triggered by any of those events
- AND it runs only when explicitly invoked on demand.

### Requirement: a harness figure with a zero denominator is uncomputable, never zero and never a passing budget

Every rate, ratio, share, percentage or per-unit figure this harness computes
SHALL name its denominator and SHALL define what it reports when that
denominator is zero. A zero denominator records the absence of a measurement,
not a measurement of zero, and SHALL NOT be rendered as `0`, `0%`, `100%`,
blank or `n/a`, and SHALL NOT satisfy a budget, a threshold or a comparison.

The figures this package owns and their denominators are: a slice or aggregate
pass rate (tests executed in that population), the budget-breach margin
(the tier's declared `duration_s` or `cost_usd` budget), Tier 1 corpus
coverage (distinct `bugeventlog.md` failure classes), and a Tier 2 relative
difference (the baseline condition's point estimate).
WHEN any of those denominators is zero, THEN the harness SHALL record the
figure as `uncomputable` in the run record together with the denominator's
name, and SHALL NOT record it as a numeric value.
IF a tier's declared `cost_usd` budget is zero -- as it is for Tier 0 and
Tier 1 -- THEN no percentage margin SHALL be computed against it; any measured
cost greater than zero SHALL be recorded as `budget_breach: true`
unconditionally, so a zero-cost tier that starts spending is caught rather
than dividing by zero.
IF a Tier 2 results array is empty or contains fewer than N entries, THEN the
bootstrap confidence interval SHALL be recorded as `uncomputable` with the
observed entry count, and the comparison SHALL be recorded as `inconclusive`,
never as a detected regression or improvement.
IF a gating or flagging decision depends on a figure recorded `uncomputable`,
THEN the run SHALL be recorded as `not_evaluated` for that decision and SHALL
NOT be recorded as having passed it.

#### Scenario: a zero-cost tier that starts spending is caught, not divided by zero

- WHEN Tier 1 runs with a declared `cost_usd` budget of 0 and the measured
  run records a non-zero `cost_usd`
- THEN the run record shows `budget_breach: true` with the measured cost and
  no percentage margin
- AND the harness does not compute a margin against a zero denominator.

#### Scenario: an empty results array does not produce a confidence interval

- WHEN a Tier 2 comparison's results array for a condition is empty
- THEN the run record shows the confidence interval as `uncomputable` with
  the observed entry count
- AND the comparison is recorded `inconclusive` rather than as a detected
  regression or improvement.

#### Scenario: a slice with no executed tests does not report a pass rate

- WHEN a Tier 0 slice executes zero tests because all of them skipped on the
  running platform
- THEN that slice's pass rate is recorded `uncomputable` naming
  `tests executed = 0`
- AND the slice's gate is recorded `not_evaluated`, not passed.

### Requirement: tier budgets and Tier 2's statistical discipline are computable, not merely stated in prose

Each tier's budget check, and Tier 2's N=3/bootstrap-CI discipline, SHALL be
expressed as a computation a script can evaluate: a measured input, where it
is recorded, the comparison performed, and the action taken on breach.

WHEN a tier runs, THEN the harness SHALL record its wall-clock runtime and,
where applicable, vendor-call cost, to a per-run machine-readable record
(for example a `tier-run.json` with fields `tier`, `started_at`,
`duration_s`, `cost_usd`) alongside the tier's declared budget constants for
the same fields.
WHEN a tier's run record is written, THEN the harness SHALL compute
`budget_breach` as a boolean comparing measured `duration_s`/`cost_usd`
against the declared budget, recording the delta, rather than leaving
budget compliance as an unverified prose claim.
IF `budget_breach` is true by more than the material-margin threshold, which
is fixed at **20%** of the declared budget for the breached field, THEN the
run SHALL be flagged in the harness's summary output and SHALL NOT be cited
as a trusted budget-compliant run until reviewed. The threshold is a constant
recorded alongside the budget constants, not an example; where the declared
budget for the breached field is zero, the zero-denominator requirement above
governs instead of a percentage.
For Tier 2, the N=3/bootstrap-CI discipline SHALL be computed as: run each
of the 8-12 locked specs three times, record each run's score to a results
array in the per-run record, compute a bootstrap confidence interval (a
stated resample count and confidence level, for example 1000 resamples at
95%) over that array, and record the point estimate, the CI bounds, N, and
the pinned model identifier in the same record.
WHEN a Tier 2 comparison is made between two conditions, THEN the
comparison SHALL subtract the two point estimates and test whether the
absolute difference exceeds the wider of the two conditions' CI
half-widths; IF it does not, THEN the result SHALL be recorded as
`inconclusive` in the run record, not silently omitted or asserted as a
finding in prose alone.
The exact script names and file paths implementing this computation are an
implementation detail owned by the harness build; this requirement binds
only to the observable behaviour: a machine-readable record exists per run,
a comparison is made mechanically, and a breach or inconclusive result is
recorded rather than only asserted in a report's prose.

#### Scenario: a Tier 0 run exceeding its budget is recorded, not just claimed

- WHEN Tier 0 runs and its measured duration exceeds its declared
  per-commit budget by more than the fixed 20% material-margin threshold
- THEN the run record shows `budget_breach: true` with the measured and
  declared values
- AND the summary output flags the run for review.

#### Scenario: a Tier 2 bootstrap CI is computed and recorded, not asserted

- WHEN a Tier 2 comparison runs N=3 against two conditions
- THEN the run record contains the point estimate, the bootstrap CI
  bounds, N=3, and the pinned model identifier for both conditions
- AND a difference smaller than the wider CI half-width is recorded as
  `inconclusive`, never as `regression` or `improvement`.
