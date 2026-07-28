# Spec delta - regression harness tiers

EARS-phrased. See skills/foreman/references/five-part-spec.md.
Header shape follows the OpenSpec CLI's parseable form (see
lock-primitive-hardening/tasks.md T8 for the repo-wide conformance debt).

## ADDED Requirements

### Requirement: Four-tier structure separates orchestration guarantees from vendor-quality guarantees

The regression harness SHALL organize orchestration-layer testing into four
tiers, Tier 0 through Tier 3, ordered by increasing cost and decreasing
determinism, and each tier's specification SHALL state what it establishes
and what it explicitly does not establish.

WHEN a contributor or auditor asks what a passing tier proves, THEN the
tier's own documentation SHALL answer without reference to another tier's
guarantees.
IF a proposed test does not fit any tier's stated purpose, THEN it SHALL NOT
be added to that tier merely because it is convenient to run there.
The four tiers SHALL be: Tier 0 (deterministic, no-LLM, per-commit slice
gates), Tier 1 (deterministic vendor-replay against recorded transcripts,
per-commit or per-PR), Tier 2 (live vendor calls against seeded defects with
statistical discipline, per-release), and Tier 3 (a fixed external-benchmark
drift anchor, non-gating, per-release or on demand).

#### Scenario: Tier 0 passing does not certify vendor behaviour

- WHEN all Tier 0 slice gates pass on a commit
- THEN that result SHALL be read only as "no orchestration-code regression
  detected in the sliced bats suite"
- AND SHALL NOT be represented as evidence that any vendor model behaves
  correctly.

#### Scenario: Tier 3 passing does not gate a release

- WHEN the Tier 3 SWE-bench Pro anchor run completes with any score
- THEN that result SHALL NOT block or approve a release by itself
- AND SHALL be recorded only as a drift signal for separate review.

### Requirement: Tier 0 slice gates catch subsystem regressions the aggregate hides

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

#### Scenario: an injected defect is caught by its slice even when the aggregate barely moves

- WHEN a defect is injected into a single Tier 0 slice during the annual
  self-test
- THEN the owning slice SHALL show a pass-rate drop materially larger than
  the aggregate suite's drop
- AND the self-test SHALL fail loudly if the owning slice's drop is not
  detectable while the aggregate drop is within normal noise.

#### Scenario: Tier 0 alone does not replace the annual self-test

- WHEN a full year passes without running the regression-injection
  self-test
- THEN Tier 0's per-commit gates SHALL be considered unverified as
  regression detectors
- AND the harness documentation SHALL flag the self-test as overdue.

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
byte-for-byte deterministically.
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

### Requirement: Tier 2 seeded-defect runs require statistical discipline, not single-shot verdicts

Tier 2 SHALL run 8-12 locked specs with seeded defects against pinned
vendor models, each run SHALL be repeated N=3 times, and results SHALL be
reported with a bootstrap confidence interval rather than a single point
estimate.

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

### Requirement: Tier 3 is a drift anchor and never a gate

Tier 3 SHALL run a fixed 50-task SWE-bench Pro sanity subset, and its
result SHALL never block, approve, or otherwise gate any commit, PR, or
release.

WHEN Tier 3 completes, THEN its output SHALL be recorded solely as a drift
signal to be reviewed by a maintainer, and SHALL carry no pass/fail status
that any automation acts upon.
IF a Tier 3 score changes materially between runs, THEN it SHALL prompt a
manual investigation, AND the investigation SHALL NOT be automated into a
gate.
The harness SHALL document, next to the Tier 3 result, the known
limitations of SWE-bench-style benchmarks (OpenAI's 2026-02-23 deprecation
of SWE-bench Verified because 59.4% of audited failing problems have flawed
tests, and SWE-ABS's 19.71% rejection rate of "passing" patches) so a
reader does not over-trust the anchor.

#### Scenario: no CI step fails because of Tier 3

- WHEN Tier 3 is run in CI or on demand and returns any score, including
  zero
- THEN no CI job SHALL exit non-zero because of that score
- AND no merge or release SHALL be blocked by it.

#### Scenario: a Tier 3 score is presented with its caveats

- WHEN a Tier 3 result is published to maintainers
- THEN it SHALL be accompanied by the documented benchmark-validity
  caveats
- AND SHALL NOT be presented as a bare number implying orchestration
  correctness.

### Requirement: each tier carries an explicit cost/runtime budget and cadence

Each tier SHALL declare a maximum runtime budget, a maximum vendor-cost
budget, and the cadence at which it runs, and the harness SHALL NOT run a
tier more frequently than its declared cadence permits without an explicit
override.

WHEN Tier 0 runs, THEN it SHALL complete within a per-commit-appropriate
budget (seconds, no vendor cost) and SHALL run on every commit.
WHEN Tier 1 runs, THEN it SHALL complete within a per-commit-or-per-PR
budget (low seconds, no vendor cost) and SHALL run on every commit or PR.
WHEN Tier 2 runs, THEN it SHALL run per release, not per commit, and SHALL
declare its expected vendor-call cost before execution given N=3 runs
across 8-12 specs with pinned models.
WHEN Tier 3 runs, THEN it SHALL run per release or on demand, not per
commit, and SHALL declare its expected cost given a 50-task subset, noting
that a full HAL-style run at full scale can run approximately 40000 USD and
a reduced Verified-Mini-scale run approximately 259 USD, and SHALL size its
actual subset to stay within a maintainer-approved budget.
IF any tier's actual runtime or cost exceeds its declared budget by a
material margin, THEN the run SHALL be flagged for budget review before
its result is trusted.

#### Scenario: Tier 2 is never invoked on a per-commit basis

- WHEN a commit is pushed that is not part of a release cycle
- THEN Tier 2 SHALL NOT be triggered automatically
- AND only Tier 0 and Tier 1 SHALL run on that commit.

#### Scenario: a runaway Tier 3 cost is caught before it is trusted

- WHEN a Tier 3 run's actual vendor cost materially exceeds its declared
  budget
- THEN the result SHALL be flagged for budget review
- AND SHALL NOT be silently accepted as a valid drift measurement.
