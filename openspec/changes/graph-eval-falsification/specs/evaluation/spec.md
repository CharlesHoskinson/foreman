# Spec delta — graph plane evaluation and falsification

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Note on format: this delta uses the header shape the OpenSpec CLI actually
parses (`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`), as
established by `lock-primitive-hardening`.

## ADDED Requirements

### Requirement: a query census classifies one release of real queries before the store is justified

Foreman SHALL instrument the queries its architects and worker lanes actually
issue against the graph plane, over one full release, and SHALL classify each
into point-lookup, single-document, genuine multi-hop-cross-run, or
unclassifiable.

The census SHALL record queries as they are issued and SHALL NOT be assembled
from recollection or from a sample chosen after the fact.
A query SHALL be classified as genuine multi-hop-cross-run only WHERE answering
it requires joining facts from more than one run, spec, or defect, and it
cannot be answered by a point lookup or by reading one document.
The census SHALL report the unclassifiable share, and IF that share exceeds one
tenth of all recorded queries, THEN the census SHALL be reported as failed and
SHALL NOT be used to justify or to freeze any package.
The census instrumentation SHALL be able to run ahead of the rest of this
package, alongside the work-plane telemetry, so that its verdict is available
before the store adapter is built.

#### Scenario: the census returns a distribution, not an anecdote

- WHEN one release has completed with census instrumentation active
- THEN the census reports counts and shares for all four classes over every
  recorded query
- AND each recorded query carries the timestamp and the lane or architect
  context in which it was issued.

#### Scenario: an unrepresentative census is refused

- WHEN more than one tenth of recorded queries fall in the unclassifiable
  bucket
- THEN the census is reported as failed
- AND no package is landed or frozen on its basis.

### Requirement: the prompt-only baseline arm is locked before the graph arm is measured

Foreman SHALL measure a prompt-only baseline arm — one strong model with the
spec, the diff and the report in the prompt, plus the host-side deterministic
checks and the merge gate — at cost matched to the graph arm.

The baseline arm SHALL be locked before the graph arm is measured: its prompt,
its model version, its cost and its results SHALL be content-hashed and
committed with a timestamp.
The graph arm SHALL NOT be measured until the baseline lock is committed.
IF the baseline is re-run after the graph arm has been measured, THEN the
re-run SHALL be reported as a separate labelled measurement and SHALL NOT
replace the locked baseline in any comparison.
WHERE a model version changes on any arm, the baseline SHALL be invalidated and
re-measured rather than compared across versions.
The comparison SHALL be reported per query class from the census, not only in
aggregate.

#### Scenario: the lock precedes the treatment

- WHEN the graph arm is measured
- THEN the baseline lock commit predates the first graph-arm run
- AND the baseline hash in the report matches the committed lock.

#### Scenario: a post-hoc baseline improvement cannot be substituted

- WHEN the baseline is re-run and scores higher after the graph arm result is
  known
- THEN the report presents both the locked baseline and the labelled re-run
- AND every kill-criterion evaluation uses the locked baseline.

### Requirement: run-to-run variance is measured before any improvement is claimed

Foreman SHALL measure its own run-to-run variance on the locked canary task set
before reporting any comparison as an improvement or a regression.

The first release SHALL spend its canary budget on measuring variance rather
than on claiming an effect.
Repeats SHALL be reported as a mean with a percentile bootstrap confidence
interval, and never as a bare average.
IF an observed difference is smaller than the measured confidence interval,
THEN it SHALL be reported as no measurable difference and SHALL NOT be
described as an improvement, a regression, or a trend.
WHERE the measured noise floor exceeds the effect the plane could plausibly
deliver, the report SHALL state that the question cannot be answered at this
sample size, and SHALL state the sample size that would answer it.

#### Scenario: a sub-noise delta is not an improvement

- WHEN the graph arm scores above the locked baseline by less than the
  confidence half-width
- THEN the report states no measurable difference
- AND no release note, README, or PR body claims an improvement.

#### Scenario: variance is measured before the first comparison

- WHEN the first falsification report is published
- THEN it contains a measured run-to-run variance figure for the canary set
- AND every subsequent comparison cites it.

### Requirement: open-world evidence checks run in shadow before they may ever block

Evidence-sufficiency checks over the graph SHALL run in shadow mode, recording
what they would have blocked without blocking it, for a pre-declared number of
merges before any promotion is considered.

The shadow period SHALL be pre-declared and SHALL be at least one hundred
merges.
Precision SHALL be measured on Foreman's own merges and SHALL NOT be inherited
from published figures.
Promotion to blocking SHALL require a precision threshold declared before the
shadow period began, and SHALL be an explicit architect decision recorded with
the measured number.
A demotion rule SHALL be declared at the same time as the promotion threshold,
stating the measured condition under which a promoted check returns to warning.
IF the promotion threshold is not met, THEN the check SHALL remain a warning
indefinitely and SHALL NOT be promoted on qualitative grounds.

#### Scenario: shadow precision decides promotion

- WHEN the shadow period completes
- THEN the report states the measured precision, the pre-declared threshold,
  and whether the threshold was met
- AND promotion occurs only if the threshold was met.

#### Scenario: a promoted check has a way back

- WHEN a promoted blocking check meets its declared demotion condition
- THEN it returns to warning without requiring a new decision process
- AND the demotion is recorded with the measurement that triggered it.

### Requirement: the serializer and context budget are swept per vendor, never assumed

The context serializer and the served-edge count SHALL be measured per vendor,
because format preference does not transfer across model families.

The sweep SHALL cover the serializer variants the context builder can emit and
a range of served-edge counts spanning the budget the builder can serve.
The sweep SHALL be run separately for each vendor lane in use, and results
SHALL be reported per vendor.
WHERE a vendor has no completed sweep, its lane SHALL use the shared default
serializer AND the report SHALL flag that vendor's configuration as
unvalidated.
The sweep SHALL measure both a synthesis-shaped task and a single-fact-lookup
task, because grouped layout is expected to help one and harm the other.
IF no serializer configuration beats the prompt-only arm for a given vendor,
THEN that vendor's lane SHALL NOT be served a graph context block by default.

#### Scenario: an unswept vendor is flagged, not assumed fine

- WHEN a vendor lane runs before its sweep has completed
- THEN the release report lists that vendor's serializer configuration as
  unvalidated
- AND the default serializer is used.

#### Scenario: a vendor that gains nothing is not served a context block

- WHEN the sweep for a vendor shows no configuration exceeding the prompt-only
  arm beyond the confidence interval
- THEN that vendor's lanes receive no graph context block by default
- AND the finding is recorded with its measurement.

### Requirement: M5 per-pair unique-catch rate is computed from finding telemetry

Foreman SHALL compute the unique-catch rate of each cross-vendor auditor pair —
the fraction of gate-blocking findings produced only by that auditor, and not
by the deterministic checks and not by the architect.

M5 SHALL be computed from first-class finding records emitted by the work-plane
telemetry, and SHALL NOT be estimated from verdict counts.
M5 SHALL be reported per vendor pair, not as a single aggregate across the
panel.
M5 SHALL be computable offline against the recorded-vendor replay corpus by
substituting one vendor's recorded auditor transcript for another's on the same
diff.
M5 SHALL be reported alongside its companion numbers: the count of blocking
verdicts the architect overturned, and the deterministic-check catch rate on
the same diffs.
IF a vendor pair's unique-catch rate falls below the pre-registered threshold,
THEN that vendor SHALL be documented as a capacity, cost or availability lane,
and no quality or independence claim SHALL be made for it in the README, the
release notes, or any PR body.

#### Scenario: a low-unique-catch vendor loses its quality claim

- WHEN a vendor pair's measured unique-catch rate is below the registered
  threshold
- THEN the release documents that vendor as a capacity lane
- AND every independence or quality claim for it is removed.

#### Scenario: M5 is computed without new spend

- WHEN the replay corpus is run with one auditor transcript substituted for
  another vendor's on the same diffs
- THEN M5 is produced for that pair
- AND no vendor call is made.

### Requirement: every reported metric carries its misreading and a companion number

Each metric this harness reports SHALL be published together with its most
common misreading and the companion number that detects the misreading.

No metric SHALL be reported as a bare average; tail values and
catastrophic-case counts SHALL accompany every distribution.
A resolution compression ratio SHALL be reported and SHALL NOT be optimised,
and it SHALL be accompanied by a false-merge rate and a component-count delta
that alarms in both directions, because compression alone rewards over-merging
and an over-merged graph is connected and false.
Citation precision SHALL be accompanied by a check against trivial gaming,
because verbatim copying with self-citation scores near-perfect citation
metrics at near-zero utility.
The first-pass gate rate SHALL be accompanied by median spec size and the
architect-authored share of merged lines, because it improves when specs shrink.
Extraction quality SHALL be accompanied by graph connectivity, because richer
extraction has been measured to produce worse-connected graphs.
The instrument used to score an output SHALL NOT also be the objective that
output is optimised against.

#### Scenario: a metric without a companion is not publishable

- WHEN the falsification report is assembled
- THEN every metric in it carries a stated misreading and at least one
  companion number
- AND a metric lacking either is omitted from the report and recorded as a gap.

#### Scenario: a flattering compression ratio is caught

- WHEN entity resolution reports an improved compression ratio
- THEN the report presents the false-merge rate and component-count delta
  alongside it
- AND an improvement accompanied by a rising false-merge rate is reported as a
  regression.

### Requirement: kill criteria are pre-registered with thresholds and actions before measurement

Foreman SHALL maintain a pre-registration register of kill criteria, each with
its threshold and its action, committed with a timestamp before the
corresponding measurement runs.

Each registered criterion SHALL name its metric, its threshold, the measurement
that evaluates it, and exactly one action from revert, descope, or keep.
A criterion SHALL NOT be added, amended, or removed after the measurement it
governs has been run; a later change SHALL be recorded as a new criterion for
the next release.
IF a criterion is met, THEN its registered action SHALL be executed in the same
release, and any decision to override it SHALL be recorded as an explicit
architect override naming the criterion and the reason.
A criterion that was not registered before the measurement SHALL NOT be used to
justify keeping any part of the graph plane.
The register SHALL include at minimum the following, with the release setting
the numeric thresholds before the first measurement:

- **KC-1 census** — IF the genuine multi-hop-cross-run share of classified
  queries falls below the registered share, THEN freeze the store package and
  keep the projection journal and the deterministic gate checks. Below the
  registered lower share, descope the store for the release series.
- **KC-2 baseline** — IF the graph arm does not exceed the locked prompt-only
  baseline by more than the measured confidence interval on cross-session
  tasks at matched cost, THEN descope the context builder to the query classes
  the census proved. IF it scores below the baseline on any arm, THEN revert
  graph context out of the default lane path.
- **KC-3 variance** — IF the measured noise floor exceeds the plausible effect,
  THEN keep the plane off by default and claim nothing; publish the required
  sample size.
- **KC-4 shadow tier** — IF shadow precision is below the registered
  threshold over the shadow period, THEN the evidence checks stay warning-only
  permanently.
- **KC-5 unique catch** — IF a vendor pair's unique-catch rate is below the
  registered threshold, THEN document that vendor as a capacity lane and drop
  every quality claim for it.
- **KC-6 serializer** — IF no serializer configuration beats the prompt-only
  arm for a vendor, THEN that vendor's lanes are served no context block.
- **KC-7 citation** — IF the share of load-bearing claims carrying a valid
  in-block edge identifier is below the registered threshold, THEN block
  promotion of graph context to auditor lanes until the citation contract is
  fixed.
- **KC-8 cost** — IF cost per merged change rises beyond the registered margin
  with no improvement outside the confidence interval in first-pass gate rate
  or escaped-defect rate, THEN revert the plane to off by default, per the
  ratchet rule that a lateral move at higher cost reverts.
- **KC-9 maintenance** — IF ontology and store maintenance exceeds the
  registered hours per release with no gate escape prevented, THEN descope the
  store.
- **KC-10 distraction** — IF any arm served graph context scores below the same
  arm without it on any locked slice, THEN the plane is off by default for that
  task class.

#### Scenario: the register precedes the measurement

- WHEN a kill criterion is evaluated
- THEN its registration commit predates the first run of the measurement that
  evaluates it
- AND the register hash cited in the report matches that commit.

#### Scenario: a met criterion produces its registered action

- WHEN a registered criterion is met
- THEN its registered action is executed in the same release, or an explicit
  architect override is recorded naming the criterion and the reason
- AND the outcome appears in the falsification report.

#### Scenario: an unregistered criterion cannot rescue the plane

- WHEN a favourable measurement not covered by any registered criterion is
  produced
- THEN it is reported as an observation
- AND it is not used to justify keeping any part of the plane.

### Requirement: the falsification report states the negative evidence it was designed to take seriously

Each release SHALL publish a falsification report that states, in its own
words, the disconfirming evidence this programme was built to test against, and
what the release's own measurements did to it.

The report SHALL name at minimum: that a lexical baseline beat all nine
evaluated graph retrieval systems on true/false questions and that six of nine
fell below it on reasoning; that one graph system spent 83.9 million
construction tokens to score below TF-IDF; that an assembled neurosymbolic
pipeline scored 61.6% against its own 67.3% text-only baseline; and that a
nine-model panel across seven families behaved as approximately two effective
independent votes.
The report SHALL state which of those findings the release's own measurements
reproduced, contradicted, or left untested.
The release SHALL NOT claim that the graph plane reduces hallucination, because
no measured reduction exists in the literature this programme drew on.
The release SHALL claim only what it measured: citation precision, multi-hop
accuracy on the census-proven query classes, cost, and task success.
The report SHALL be published whether its verdict is positive or negative.

#### Scenario: the report publishes a negative verdict

- WHEN the measurements do not support the plane
- THEN the falsification report is published with the negative verdict, the
  criteria that were met, and the actions taken
- AND publication is not deferred to a later release.

#### Scenario: an unmeasured claim is refused

- WHEN release notes are assembled containing a hallucination-reduction claim
- THEN the claim is removed and the omission recorded
- AND the report states that the quantity was never measured.

### Requirement: a negative verdict has an executable landing path

The graph plane SHALL be built so that concluding it was not worth building is
an executable outcome rather than a discussion.

The graph context block SHALL have an off-switch that disables it for a lane,
a vendor, or a task class without disabling the merge gate, the run record, or
the deterministic checks.
The harness SHALL support running the same task set with and without the graph
plane, so that the counterfactual remains available after the plane ships.
WHERE a kill criterion's action is revert or descope, executing it SHALL NOT
require changes to the event log, the gate, or the run record.
IF the plane is turned off for a task class, THEN the release SHALL record
which class, which criterion, and which measurement.

#### Scenario: the plane is switched off for one task class

- WHEN a distraction criterion is met for a task class
- THEN graph context is disabled for that class
- AND the merge gate, run record and deterministic checks are unaffected.

#### Scenario: the counterfactual survives shipping

- WHEN the harness is run after the plane has shipped
- THEN both the with-graph and without-graph arms are runnable on the same task
  set
- AND their costs are recorded on the same basis.
