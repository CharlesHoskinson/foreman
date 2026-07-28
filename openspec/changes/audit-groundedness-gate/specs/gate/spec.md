# Spec delta — audit groundedness gate

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Note on format: this delta uses the header shape the OpenSpec CLI actually
parses (`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`), as
established by `lock-primitive-hardening`.

Scope note: `three-outcome-verdicts` owns the verdict vocabulary, the
always-written verdict artifact, the binding of a verdict to the diff's content
hash, the audit timeout, and stable finding ids. `decision-lineage-and-telemetry`
owns the `audit_verdict`, `finding` and `gate_decision` events. This delta
consumes all of them and redefines none of them.

## ADDED Requirements

### Requirement: only closed-world checks may block a merge

The groundedness layer SHALL classify every check it performs as either
closed-world or open-world, and SHALL record that classification alongside the
check's result.

A closed-world check is a set-membership, range-containment or structural
implication test whose answer is fully determined by artifacts Foreman produced:
the diff, the run record, the verdict artifact, the repository at a named commit,
or the spec.
WHERE a check is classified open-world, it SHALL NOT block a merge under any
configuration.
Every blocking check SHALL carry, in this specification, a stated argument for
why a false positive is structurally impossible.
IF a check cannot carry that argument, THEN it SHALL be advisory, and no
configuration value SHALL make it blocking.
A blocking check SHALL NOT be justified by a measured false-positive percentage.

#### Scenario: an open-world check cannot be configured into a blocker

- WHEN an operator sets an evidence-sufficiency check to enforcing in
  configuration
- THEN the checker refuses the configuration with a named error
- AND the merge gate's blocking behaviour is unchanged.

#### Scenario: every blocking check declares its world

- WHEN the groundedness checker writes its result artifact
- THEN each check result carries its check id, its tier, its world
  classification, and whether it was blocking for this evaluation.

### Requirement: audit output is checked for internal coherence

The groundedness layer SHALL verify that an audit verdict is consistent with the
findings the same audit reported.

WHEN a verdict is `APPROVED` AND the same audit reported a finding of severity
`critical` or `high`, THEN the layer SHALL report a violation.
WHEN a verdict is `BLOCKED` AND the same audit reported no finding of severity
`critical` or `high` AND declared no criterion miss, THEN the layer SHALL report
a violation.
WHEN a verdict is `WARNING` AND the same audit reported no findings at all, THEN
the layer SHALL report a violation.
Each of these SHALL be a separate check with its own identifier and its own
message, and they SHALL NOT be expressed as one check over a disjunction.
The layer SHALL NOT evaluate whether the verdict is the right verdict.

#### Scenario: an approval that contradicts its own findings is caught

- WHEN an audit returns `APPROVED` together with one `critical` finding
- THEN a violation is reported naming the verdict, the finding id and the
  severity
- AND the violation states the evidence required to resolve it.

#### Scenario: a rejection with no addressable justification is caught

- WHEN an audit returns `BLOCKED` with an empty findings array and no declared
  criterion miss
- THEN a violation is reported
- AND it is distinct from the violation reported for a contradictory approval.

#### Scenario: a coherent verdict produces no violation

- WHEN an audit returns `APPROVED` with two `low` findings
- THEN the coherence checks report no violation.

### Requirement: findings that cite nothing real are rejected

The groundedness layer SHALL resolve every path cited by a finding against the
diff under evaluation and against the repository at the head commit.

IF a cited path resolves to no file in the diff, no file in the repository at the
head commit, and no pre-rename name in the diff, THEN the layer SHALL report a
blocking-class violation, because a path that exists nowhere cannot be a real
citation.
WHERE a cited path resolves to a file that exists but is outside the diff, the
layer SHALL report an advisory violation and SHALL count it, and SHALL NOT block.
Path resolution SHALL consider the diff's old-side names and detected renames
before declaring a path unresolvable.

#### Scenario: a hallucinated citation is caught

- WHEN a finding cites `src/retry_handler.go` and no such path exists in the diff
  or in the repository at the head commit
- THEN a blocking-class violation is reported naming the finding id and the path
- AND the violation names the required evidence as a path present in the reviewed
  change.

#### Scenario: a finding about an impacted caller outside the diff is not blocked

- WHEN a finding cites a file that exists in the repository at the head commit
  but is not part of the diff
- THEN an advisory violation is recorded and counted
- AND the merge is not blocked by it.

#### Scenario: a renamed file is resolved, not rejected

- WHEN a finding cites the pre-rename path of a file the diff renames
- THEN the path resolves through the detected rename
- AND no violation is reported for it.

### Requirement: findings that cite impossible lines are rejected

The groundedness layer SHALL check every cited line number against the cited
file.

IF a cited line number exceeds the line count of the cited file at the head
commit, THEN the layer SHALL report a blocking-class violation, because such a
line cannot exist.
WHERE a cited line exists but falls outside every changed hunk of that file, the
layer SHALL report an advisory violation and SHALL count it, and SHALL NOT block.
WHERE a finding cites line `0`, the layer SHALL treat it as a file-level finding
and SHALL NOT report a line violation for it.

#### Scenario: a line beyond the end of the file is caught

- WHEN a finding cites line 900 of a file that is 130 lines long at the head
  commit
- THEN a blocking-class violation is reported naming the finding, the file and
  the line
- AND the message states the file's actual line count.

#### Scenario: a finding on unchanged code is reported without blocking

- WHEN a finding cites line 412 of a file whose only changed hunk covers lines
  10 to 24
- THEN an advisory violation is recorded describing an audit of the file rather
  than of the diff
- AND the merge is not blocked by it.

#### Scenario: a file-level finding is accepted

- WHEN a finding cites line 0 of a file present in the diff
- THEN no line violation is reported.

### Requirement: cross-vendor separation is asserted against what actually ran

The groundedness layer SHALL compare the vendor recorded as having produced the
attempt with the vendor recorded as having performed the audit.

The comparison SHALL use the vendors recorded in the run record as having run,
and SHALL NOT use the configured defaults.
WHERE the configured policy requires cross-vendor separation AND the two recorded
vendors are equal, the layer SHALL report a blocking-class violation.
WHERE the configured policy does not require separation, the layer SHALL report
an advisory violation instead.
IF either vendor is unrecorded, THEN the layer SHALL report that the check could
not be evaluated, SHALL count it as unevaluated, and SHALL NOT infer a vendor
from a configuration value or a filesystem path.

#### Scenario: a substituted auditor is caught after the fact

- WHEN the configured auditor is unavailable and the audit is recorded as having
  run under the same vendor as the worker
- THEN a blocking-class violation is reported under a policy requiring separation
- AND it names both recorded vendors.

#### Scenario: an unrecorded vendor makes the check silent, not green

- WHEN the run record carries no vendor for the attempt
- THEN the check reports that it could not be evaluated
- AND the unevaluated count in the result artifact is incremented
- AND no violation and no pass is claimed for it.

### Requirement: the rubric an audit claims is identified and resolvable

The groundedness layer SHALL verify that an audit names the rubric it applied and
the version of that rubric.

The verdict artifact SHALL carry a rubric identifier and a rubric version written
by the harness.
WHEN either is absent, the layer SHALL report a violation.
WHEN the named rubric version does not resolve in the repository at the base
commit of the change under evaluation, the layer SHALL report a violation.
The layer SHALL NOT evaluate whether the rubric was applied well.

#### Scenario: an audit scored against a since-changed rubric is caught

- WHEN an audit records a rubric version that does not exist in the repository at
  the base commit
- THEN a violation is reported naming the rubric, the recorded version and the
  base commit.

#### Scenario: an unnamed rubric is caught

- WHEN the verdict artifact carries no rubric identifier
- THEN a violation is reported stating that a rubric identifier and version are
  the required evidence.

### Requirement: scope and criterion checks wait for the spec format

The groundedness layer SHALL support scope containment and acceptance-criterion
coverage as checks over machine-readable spec fields.

Scope containment SHALL compare every changed path against the scope globs
declared by the spec.
Criterion coverage SHALL require every declared criterion identifier to be
discharged by a check result, a finding, or an explicit waiver.
WHILE the five-part spec format does not carry scope globs and stable criterion
identifiers, both checks SHALL report as unevaluated and SHALL NOT be blocking.
Criterion identifiers SHALL be declared in the spec and SHALL NOT be derived from
a hash of the criterion text for any blocking use, because a reworded criterion
would silently reset its coverage.

#### Scenario: the checks are inert before the format change

- WHEN a spec without scope globs or criterion identifiers is evaluated
- THEN scope containment and criterion coverage report as unevaluated
- AND both are counted as unevaluated in the result artifact.

#### Scenario: silent non-coverage becomes visible once identifiers exist

- WHEN a spec declares four criterion identifiers and the audit addresses three
- THEN a violation names the undischarged identifier
- AND the message states that a check result, a finding, or a waiver is the
  required evidence.

### Requirement: the checker proves it can fail before it is trusted

The groundedness checker SHALL validate itself against a known-violating fixture
corpus on every invocation, before its own result is trusted.

The corpus SHALL contain a conforming baseline and, for every check, at least one
mutation of that baseline which the check is required to flag.
The checker SHALL assert the expected violation count and the expected focus of
each expected violation, and SHALL NOT assert only that some violation was
produced.
IF the corpus produces fewer violations than expected, or cannot be read, or does
not match the artifact shape the checker parses, THEN the groundedness result
SHALL be recorded as `UNVERIFIED` and the merge gate SHALL fail closed with a
reason distinct from any real violation.
The checker SHALL NOT report a pass on the basis of an unvalidated check set.

#### Scenario: a check that has silently become a no-op fails the gate closed

- WHEN a change to the checker makes one check produce no results at all
- THEN the canary reports fewer violations than expected
- AND the groundedness result is `UNVERIFIED`
- AND the gate fails with a reason naming the canary, not a code finding.

#### Scenario: a canary pass is asserted per invocation, not per build

- WHEN the checker runs twice in one session
- THEN the fixture corpus is evaluated on both invocations.

#### Scenario: a canary failure is never conflated with an audit violation

- WHEN the canary fails
- THEN the gate decision's reason names the validator self-test
- AND no groundedness violation is attributed to the change under evaluation.

### Requirement: every check ships non-blocking and is promoted by measurement

Every groundedness check SHALL be introduced in shadow mode, in which it is
evaluated, recorded and reported but blocks nothing.

WHILE a check is in shadow mode, its violations SHALL appear in the result
artifact and in the gate's warnings, and SHALL NOT appear in the gate's blocking
reasons.
A check SHALL be promoted to enforcing only WHERE a promotion record exists in
the repository stating the threshold declared before measurement, the number of
merges measured, and the observed violation and false-positive counts.
The promotion record SHALL be committed alongside the configuration change that
promotes the check.
IF no promotion record exists for a check, THEN the checker SHALL treat that
check as shadow regardless of configuration.

#### Scenario: promotion without a record does not take effect

- WHEN configuration marks a check as enforcing and no promotion record exists
- THEN the check runs in shadow
- AND the checker reports that the configured promotion was not honoured.

#### Scenario: shadow violations are visible without blocking

- WHEN a check in shadow mode reports three violations
- THEN all three appear in the gate's warnings and in the result artifact
- AND the gate's pass or fail outcome is unchanged by them.

### Requirement: a check with a missing input is silent and counted

The groundedness layer SHALL distinguish "no violation" from "not evaluated".

IF an input a check needs is absent, THEN the check SHALL report as unevaluated
with the named missing input, and SHALL NOT report a pass.
The result artifact SHALL carry a count of unevaluated checks.
WHEN any check is unevaluated, the gate output SHALL state which checks did not
run.
The layer SHALL NOT substitute a configured default, a filesystem path, or an
inferred value for a missing recorded input.

#### Scenario: partial coverage is never reported as full coverage

- WHEN two of seven checks cannot be evaluated for missing inputs
- THEN the result artifact records five evaluated and two unevaluated
- AND the gate output names the two and the input each was missing.

### Requirement: violations are addressed records naming their required evidence

The groundedness layer SHALL emit one record per violation.

Each record SHALL carry the check identifier, the focus of the violation, the
cited path where one applies, a human-readable message, the required evidence to
resolve it, the world classification, and whether it was blocking.
The records SHALL be written to the run directory as a machine-readable artifact.
Blocking-class violations SHALL be folded into the gate decision's reasons, and
advisory violations into the gate decision's warnings.
The layer SHALL NOT emit a violation whose message names only a failed
combination of checks rather than the missing evidence.

#### Scenario: a violation tells the reader what to supply

- WHEN a finding cites a path that exists nowhere
- THEN the violation record names the finding, the path, and the required
  evidence
- AND the required evidence is a sentence a human or an agent can act on.

#### Scenario: violations reach the gate decision by class

- WHEN one blocking-class and two advisory violations are produced
- THEN the gate decision carries one reason and two warnings
- AND the result artifact carries all three with their classifications.

### Requirement: evidence sufficiency is advisory in this release

The layer MAY evaluate whether the graph or the run record supports a claim the
audit makes, and any such check SHALL be advisory.

WHERE an evidence-sufficiency check runs, its output SHALL be recorded as a
warning and SHALL NOT contribute to the gate's blocking reasons.
Before any evidence-sufficiency check is proposed for promotion, its precision
SHALL be measured on Foreman's own merges against the eventual outcome, over a
sample size and against a threshold both declared in advance.
The layer SHALL NOT block on an evidence-sufficiency result in this release under
any configuration.

#### Scenario: an unsupported claim warns and merges

- WHEN an evidence-sufficiency check finds no supporting record for a claim
- THEN a warning is recorded naming the claim and the evidence it lacks
- AND the gate's pass or fail outcome is unchanged.

### Requirement: the gate states what the groundedness layer checks

The gate output and the pull-request body SHALL state that the groundedness layer
checks provenance and internal consistency, not correctness.

The statement SHALL name the artifact that does check correctness.
WHEN any check was unevaluated or in shadow mode, the statement SHALL say so
rather than presenting the layer as fully applied.

#### Scenario: a reader cannot mistake the gate for a correctness gate

- WHEN a pull request is opened for a change that passed the groundedness layer
- THEN the body states that the layer checked provenance and consistency and not
  correctness
- AND it names the independent checks artifact as the correctness signal.

### Requirement: gate tiers escalate in order and short-circuit

The merge gate SHALL evaluate its deterministic repository checks before the
groundedness layer, and the groundedness layer before the audit verdict is
consulted as a merge signal.

IF an earlier tier produces a blocking failure, THEN later tiers SHALL NOT run.
The groundedness layer SHALL run after the audit has returned and SHALL validate
the audit artifact rather than the code.
A tier that did not run because an earlier tier failed SHALL be recorded as not
run, and SHALL NOT be recorded as passed.

#### Scenario: a hash-drift failure does not pay for a groundedness run

- WHEN the protected-file hash check fails
- THEN the groundedness layer does not run
- AND the gate decision records it as not run rather than as passed.
