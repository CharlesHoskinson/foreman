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
its fixed numeric threshold and its single action, committed with a timestamp
before the corresponding measurement runs.

Each registered criterion SHALL name exactly one metric, exactly one fixed
threshold, exactly one measurement that evaluates it, exactly one measured
subject, exactly one action, and exactly one uncomputable rule.
The action vocabulary SHALL be the closed enum
`revert | descope | keep-off | keep`. This is the three-value enum
`revert | descope | keep` extended once, here, by the single value `keep-off`,
and the extension is recorded in the register itself rather than implied by
prose: "the component stays in the tree, is disabled by default, and carries no
claim" is the outcome eight of the criteria below require, and neither `revert`
(the code is removed) nor `descope` (a narrower scope ships enabled) states it —
while the counterfactual arm this package mandates needs the component present
but off. The outcomes "keep off", "stay warning-only", "block promotion" and
"freeze" in the source documents are all this one action.
`keep` SHALL NOT be registered as the action of any criterion, because a
criterion whose met-action is `keep` cannot fail anything; it is retained in the
enum only as the recorded outcome of a criterion that was evaluated and not met.
An action field SHALL carry the action and nothing else. A reporting or
publication obligation that a criterion imposes SHALL be recorded in a separate
`Report:` field, so that "one action" is a property of the register's shape and
not of a reader's charity.
WHERE a source criterion carries more than one branch, it SHALL be split into
separately identified criteria with one condition and one action each.
A criterion SHALL NOT be added, amended, or removed after the measurement it
governs has been run; a later change SHALL be recorded as a new criterion for
the next release.
IF a criterion has no fixed number at registration time, THEN it SHALL NOT be
registered, and no measurement SHALL be reported as governed by it.
A criterion that was not registered before the measurement SHALL NOT be used to
justify keeping any part of the graph plane.

**Thresholds against locked measurements.** A threshold SHALL be a fixed number
at registration time. A threshold expressed against a quantity that an *earlier*
registered measurement has itself locked, published and hashed before this
criterion's measurement runs SHALL count as fixed, and the register SHALL name
the measurement that supplies the quantity and the commit that locks it. A
threshold expressed against a quantity produced by the same run it governs SHALL
NOT count as fixed and SHALL NOT be registrable, because a bar the run sets for
itself is not a bar.

**Derived predicates.** A criterion MAY register a predicate over more than one
measured quantity as its single metric only WHERE all of the following hold:
every input comes from one named measurement; the combinator is written out in
the register as a total boolean function of those inputs; every input shares the
criterion's one subject and one action; and the report states each input's
measured value beside the predicate's verdict, naming which input made a
disjunctive predicate true. A predicate whose branches carry different actions,
different subjects, or inputs from different measurements SHALL be split into
separate criteria instead. This rule generalises the treatment the register
previously gave only to KC-8 and KC-9, and it is what keeps "one metric, one
threshold, one action" true for KC-13 and KC-15 without hiding a branch.

**Outcomes, and the uncomputable state.** Every evaluation of a registered
criterion SHALL return exactly one of `MET`, `NOT-MET` or `UNCOMPUTABLE`.
Each criterion SHALL carry an explicit uncomputable rule naming the conditions
under which its metric has no value — at minimum every denominator its metric
divides by, and every minimum observation count it states.
`UNCOMPUTABLE` SHALL be returned WHERE that rule holds: where any denominator is
zero, where the measurement did not run, or where it produced fewer observations
than the criterion's own stated minimum.
`UNCOMPUTABLE` SHALL NOT be reported, recorded, aggregated or treated as
`NOT-MET`, as a pass, as a waiver, as "inapplicable", or as evidence for the
component it governs.
IF a criterion returns `UNCOMPUTABLE`, THEN the component it governs SHALL NOT
ship enabled by default in that release, no claim resting on that criterion
SHALL be published, the release SHALL state the criterion, the missing input,
and the release in which the input is expected to exist, and the criterion SHALL
be carried forward under the same identifier rather than retired.
A measured zero SHALL be distinguished from an absent measurement: a metric
whose inputs were never recorded is `UNCOMPUTABLE` and SHALL NOT be reported as
a measured zero, which is the failure mode that would let an uninstrumented
release satisfy a threshold of zero.

**Fireability.** A criterion SHALL be registrable only WHERE some measurement
the release can actually produce could cross its threshold. Each threshold SHALL
be checked before registration against the measured or published quantity it is
anchored on, and a threshold no achievable measurement of the release's actual
corpus, sample or cost could reach SHALL be re-baselined onto that quantity, or
struck. A criterion that cannot fire is not a criterion, for the same reason a
checker that cannot fail is not a checker. The check SHALL be recorded in the
register's basis field, naming the achievable range it was checked against.

Every threshold below is transcribed from
`docs/research/vnext/PM-acceptance-criteria.md` §4 where that document fixes a
number, and is attributed inline. The four thresholds that document leaves open
(KC-3, KC-7, KC-8, KC-9) are fixed here, now, as architect decisions and are
labelled as such. One transcribed threshold — KC-13's wall clock — was found
unfireable against its own basis and is re-baselined here, before any
measurement it governs has run, with the re-baselining recorded. The register
SHALL contain exactly the following criteria:

- **KC-1 census multi-hop share** — metric: the share of 100 consecutively
  logged architect and lane retrieval queries classified genuine
  multi-hop-cross-run. Threshold: **< 20%**. Measurement: T1, the query census.
  Subject: GP-5 `graph-context-builder`, the knowledge-plane consumption layer.
  Action: **descope** to provenance-only. Uncomputable: fewer than 100 queries
  recorded, or the census failed its own unclassifiable bound — the denominator
  is the recorded query count and a share over a short or discredited census has
  no value. Basis: PM §4 K-1 Measurement A, whose number this is ("if (c) <
  20%"), judgement, fixed in that document; fireable — the observed range of the
  share is 0–100%. This criterion SHALL NOT act on GP-6 — see the separate
  requirement below.
- **KC-2a baseline head-to-head** — metric: arm A (graph context block) task
  success minus `max(arm B prompt-only, arm C lexical)` on the Tier-1 replay
  corpus, at least 10 rounds by 3 repeats, models pinned. Threshold: **the
  margin does not exceed the confidence half-width locked and published by T2**,
  a quantity fixed and hashed before T4 runs and named here under the
  locked-measurement rule above. Measurement: T4. Subject: GP-5. Action:
  **descope** to the query classes the census proved. Uncomputable: any of the
  three arms has zero completed rounds, or T2's half-width is not yet locked —
  a margin against an unlocked bar is not evaluable. Basis: PM §4 K-1
  Measurement B, measured and published (the sigma rule is R6's); fireable —
  T2's published band puts the half-width at single-digit percentage points,
  which arm A's margin can be either side of.
- **KC-2b baseline regression** — metric: the number of locked arms on which arm
  A task success falls below the locked prompt-only baseline by more than T2's
  locked confidence half-width. Threshold: **1 or more**. Measurement: T4.
  Subject: graph context in the default lane path. Action: **revert**.
  Uncomputable: zero locked arms completed, or T2's half-width is not yet
  locked. Basis: PM §4 K-1 Measurement B, second branch; restated as a count so
  that "on any one arm" is the metric rather than a second condition; fireable —
  the count ranges over the locked arms.
- **KC-3 resolution** — metric: the three-repeat percentile-bootstrap confidence
  half-width on task success over the locked canary set. Threshold: **> 5.0
  percentage points**. Measurement: T2. Subject: the graph plane's default-on
  state. Action: **keep-off**. Report: publish the sample size that would
  resolve the effect. Uncomputable: fewer than three completed repeats, or an
  empty canary set — a bootstrap over fewer than its stated repeats has no
  half-width. Basis: architect decision, fixed now, anchored on the published
  agent-benchmark band this package's `design.md` records (sigma 1.5–2.7 pp,
  three-run half-widths 2.7–4.9 pp); 5.0 pp is the first value above that band.
  Fireability: checked and retained. The anchoring band is other harnesses';
  Foreman's own half-width is unmeasured, and measuring it is precisely T2's
  purpose, so a value above 5.0 pp is achievable. This is the register's
  narrowest fireability margin and it is recorded as such.
- **KC-4 shadow promotion precision** — metric: precision of the open-world
  evidence-sufficiency checks measured on Foreman's own merges over a
  pre-declared shadow window of **at least 100 merges**, that is true blocks
  divided by all blocks the checks would have issued. Threshold: **< 100%**.
  Measurement: T5. Subject: promotion of those checks to blocking. Action:
  **keep-off** — warning-only, permanently. Uncomputable: fewer than 100 merges
  in the window, or the checks would have issued **zero** blocks over it — with
  no predicted blocks the denominator is zero and precision has no value; a
  checker that never fires is not thereby precise. Basis: PM §4 K-6, published
  and verbatim: shadow mode for 100 merges, and "any check promoted to blocking
  whose FP rate is not 0% by construction is reverted to WARN, no discussion";
  the arithmetic is 93% precision by 40 merges per week, about three false blocks
  per week; fireable — one false block over the window trips it.
- **KC-5 unique catch** — metric: the M5 unique-catch rate of a vendor pair,
  computed on the Tier-1 replay corpus by substituting recorded auditor
  transcripts, that is uniquely-caught findings divided by all gate-blocking
  findings on that corpus. Threshold: **< 5%**. Measurement: T7. Subject: that
  vendor pair's quality and independence claim — not the lane, which is kept as
  a coverage lane. Action: **revert** the claim from README, SKILL.md, lanes.md,
  `ROADMAP.md` and every PR body. Uncomputable: **zero** gate-blocking findings
  on the corpus, or a vendor pair with no completed replay — a rate over no
  findings has no value and SHALL NOT be reported as 0% or as 100%. Basis: PM §4
  K-4, published, taken verbatim from R6 §6.1; fireable — the rate ranges over
  0–100% once findings exist.
- **KC-6 serializer** — metric: the best per-vendor serializer and served-edge
  configuration's task success minus the prompt-only arm for that vendor.
  Threshold: **does not exceed T2's locked confidence half-width**, named here
  under the locked-measurement rule. Measurement: T6. Subject: that vendor's
  graph context block. Action: **keep-off** for that vendor. Uncomputable: that
  vendor has no completed sweep, or its prompt-only arm has zero completed
  rounds — a difference against an unmeasured arm has no value, and a vendor
  without a completed sweep SHALL be reported unvalidated rather than passing.
  Basis: PM §4 K-1 Measurement B's sigma rule applied per vendor, as this
  package's sweep requirement requires; fireable — the margin can be either side
  of the half-width.
- **KC-7 citation** — metric: the share of citation-required claims — those
  flagged citation-required in the closed, structured claim inventory, never a
  prose judgement of "load-bearing" — carrying a valid in-block edge identifier,
  scored by the deterministic checker. Threshold: **< 72%**. Measurement: T6.
  Subject: graph context served to auditor lanes. Action: **keep-off** for
  auditor lanes until the citation contract is repaired. Uncomputable: **zero**
  claims flagged citation-required in the inventory — the denominator is that
  count, and an inventory with no flagged claims scores nothing rather than
  scoring 100%. Basis: architect decision, fixed now, anchored on PM §3.7 C8's
  published ALCE ceiling of about 72% citation precision — "roughly 1 in 4 cited
  edges is wrong" — where Foreman's citation target is a row rather than a
  paragraph, so failing to reach a prose ceiling on an easier target falsifies
  the contract; fireable — the share ranges over 0–100%.
- **KC-8 cost ratchet** — metric: one derived predicate over inputs from one
  measurement, stated in full as the metric's definition: median cost per merged
  change rises by **more than 10%** against the locked baseline on the same
  accounting basis, **AND** neither first-pass gate rate nor escaped-defect rate
  improves by more than T2's locked confidence half-width. Threshold: that
  predicate is true. Measurement: T4. Subject: the graph plane's default-on
  state. Action: **keep-off**. Report: the three input values beside the
  predicate's verdict. Uncomputable: **zero** merged changes in either the
  baseline or the measured release — a median cost per merged change over no
  merged changes has no value — or zero gate attempts, which leaves the
  first-pass gate rate undefined. Basis: the ratchet rule is R6's — a lateral
  move at higher cost reverts; the 10% margin is an architect decision fixed
  now, and exists only to bound rounding churn, because dollar cost is exactly
  accounted; fireable — cost and both quality rates are all measured on the same
  release.
- **KC-9 store maintenance** — metric: one derived predicate over inputs from
  one measurement, stated in full: recorded ontology and store maintenance
  exceeds **8 hours in one release** **AND** no gate escape was prevented by the
  store in that release. Threshold: that predicate is true. Measurement: the
  release checklist's recorded maintenance hours and prevented-escape record.
  Subject: GP-6 `graph-store-port`'s store adapter. Action: **descope**. Report:
  both input values beside the predicate's verdict. Uncomputable: maintenance
  hours were not recorded for the release, or the prevented-escape record does
  not exist — an unrecorded input is not a zero. Basis: architect decision fixed
  now, anchored on PM §4 K-3f's stated adoption cost of about five developer-days
  plus a permanent operational surface plus a quarterly health obligation; 8
  hours is one working day per release; fireable — the stated adoption cost is
  five developer-days, well above the bound.
- **KC-10 distraction** — metric: the count of locked slices on which an arm
  served graph context scores below the same arm without it by more than T2's
  locked confidence half-width. Threshold: **1 or more**. Measurement: T4.
  Subject: the graph context block for that task class. Action: **keep-off** for
  that class. Uncomputable: zero locked slices measured on both arms, or T2's
  half-width is not yet locked. Basis: PM §2 AC-1's per-slice discipline,
  measured — six injected local regressions moved an aggregate pass rate by only
  −1.7 to −5.9 pp while the owning slice dropped −25 to −91 pp; fireable — the
  measured per-slice drops are an order of magnitude above any plausible
  half-width.
- **KC-11a relation F1** — metric: predicate-scored relation F1 against the
  hand-built gold set over Foreman's own corpus. Threshold: **< 0.60**.
  Measurement: the extraction-quality measurement over the
  `knowledge-plane-refresh` slow cadence. Subject: LLM semantic extraction.
  Action: **revert** semantic extraction, leaving an AST-only plane.
  Uncomputable: the gold set contains **zero** relations, or the extraction
  produced zero relations — F1's precision and recall denominators are then
  zero and F1 has no value; it SHALL NOT be reported as 0.0, which would trip
  the criterion on an absent measurement. Basis: PM §4 K-2, published — the
  cookbook band is relations F1 0.60–0.75 and that band is an upper bound
  because predicate wording is ignored; fireable — the published band's floor is
  the threshold.
- **KC-11b non-isolated nodes** — metric: the non-isolated-node share of the
  extracted graph, that is non-isolated nodes divided by all extracted nodes.
  Threshold: **< 70%**. Measurement: as KC-11a. Subject: LLM semantic
  extraction. Action: **revert**. Uncomputable: the extraction produced **zero**
  nodes — the denominator is the node count. Basis: PM §4 K-2, measured — N3
  reports KGP 46.03%, GraphRAG 72.51%, LightRAG 69.71%, plain KG methods about
  90%; fireable — two of the four measured systems sit below the threshold.
- **KC-11c false merges** — metric: the count of false merges in the gold
  sample. Threshold: **1 or more**. Measurement: as KC-11a. Subject: entity
  resolution. Action: **revert** entity resolution and keep surface forms.
  Report: the target is zero, and the count is published with the gold sample's
  size. Uncomputable: the gold sample is empty, or entity resolution performed
  no merges over it — zero false merges out of no merges is not a measured zero.
  Basis: PM §4 K-2, published — a false merge contaminates many traversals and
  corrupts other answers rather than being locally wrong; fireable — one false
  merge trips it.
- **KC-11d one-pass merge ceiling** — metric: the share of nodes merged in a
  single resolution pass, that is nodes merged in one pass divided by all nodes
  merged. Threshold: **> 40%**. Measurement: as KC-11a. Subject: that resolution
  pass. Action: **revert** the pass — it is a bug, not a discovery.
  Uncomputable: **zero** nodes merged — the denominator is the merged-node
  count, and a share of 0% computed over no merges would read as a pass. Basis:
  PM §4 K-2, published, R4 §5.3; fireable — the reported one-pass shares in R4
  §5.3 straddle the threshold.
- **KC-12 round-mode occurrence reduction** — metric: the percentage reduction
  in class-1 background-and-stop occurrences per 100 lane-starts, before and
  after `durable.enabled = true`. Threshold: **< 50%**. Measurement: the
  round-mode occurrence measurement emitted by `round-ownership-default`.
  Subject: the claim that the round-mode default fixes the release's number-one
  failure class. Action: **revert** that claim from `ROADMAP.md`, the release
  notes and the README. Report: both window counts. Uncomputable: fewer than 30
  lane-starts in either window, or **zero** occurrences in the before-window —
  the reduction's denominator is the before-window rate, and a reduction from
  zero has no value. Basis: PM §4 K-8, judgement, whose numbers — 50% and 30
  lane-starts — are fixed in that document; fireable — the reduction ranges over
  the full band. Any rescue is a new criterion registered prospectively in a
  later release.
- **KC-13 store rebuild** — metric: one derived predicate over inputs from one
  measurement, stated in full: a timed drop-and-rebuild of the store from
  `events.jsonl`, `graph.json` and the per-lane `GraphUpdate` journals, at the
  release's actual corpus size, **does not complete**, **OR** its diff against
  the dropped state is not clean, **OR** its wall clock exceeds **60 seconds**.
  Threshold: that predicate is true. Measurement: the release's drop-and-rebuild
  run. Subject: the SQLite ontology adapter behind GP-6. Action: **revert** GP-6
  to files-only. Report: all three input values, and which one made the predicate
  true. Uncomputable: the drop-and-rebuild run was not attempted, or the corpus
  size at which it ran is not recorded — a run that did not happen is not a run
  that did not complete. Basis: PM §4 K-3b, judgement anchored on measurement —
  R8 measured about 1,070 documents per second and 9.7 MB on disk for about
  5,500 documents. **Fireability, and the re-baselining this forced:** PM's
  transcribed 15-minute bound is unfireable at this release's corpus size. At
  R8's measured rate a 5,500-document rebuild takes about 5.1 seconds, so 900
  seconds is roughly 176 times the achievable measurement and would require a
  corpus near one million documents — no measurement this release can produce
  could cross it, which is the same defect class as a checker that cannot fail.
  The wall-clock input is therefore re-baselined to 60 seconds, about twelve
  times the measured rebuild time: still generous against normal variance, and
  trippable by a genuine regression in rebuild throughput. The re-baselining is
  made now, before the measurement it governs has run, which the amendment rule
  permits; the 15-minute figure and the reason it was replaced are retained here
  so the change is not silent. The other two inputs were fireable as transcribed
  and are unchanged.
- **KC-14 store usage** — metric: the count of time-travel queries and
  graph-diff queries actually issued during the release. Threshold: **0**.
  Measurement: PM K-3c Measurement 1, from the same query census instrumentation
  as KC-1. Subject: the SQLite ontology adapter behind GP-6. Action:
  **keep-off** — the port stays, the ontology stays, the adapter is shelved.
  Uncomputable: the
  census instrumentation did not run for the release, or did not cover the store
  — an absent instrumentation record is `UNCOMPUTABLE` and SHALL NOT be read as
  a measured count of zero, which would otherwise let an uninstrumented release
  satisfy this threshold without measuring anything. Basis: PM §4 K-3c
  Measurement 1, whose threshold is zero; fireable — zero issued queries is the
  outcome R8's usage evidence makes plausible.
- **KC-15 files-only head-to-head** — metric: one derived predicate over inputs
  from one measurement, stated in full: a files-only arm answers **all three**
  cross-run architect questions correctly **AND** its latency is at most **2
  times** the SQLite ontology arm's latency, both at the release's actual corpus
  size. Threshold: that predicate is true. Measurement: PM K-3c Measurement 2.
  Subject: the SQLite ontology adapter behind GP-6. Action: **keep-off**.
  Report: the per-question correctness of both arms, both latencies, and the ratio; and
  record the corpus size at which the question is reopened. Uncomputable: the
  SQLite ontology arm did not run, or its measured latency is zero — the ratio's
  denominator is that latency — or fewer than three questions were put to both
  arms. Basis: PM §4 K-3c Measurement 2, judgement on the 2 times band, anchored
  on R8's measured 202 ms document listing and about 230 ms negation scan;
  fireable — a files-only scan over a 9.7 MB corpus is within the same order as
  those measurements, so the ratio can land on either side of 2.

#### Scenario: the register precedes the measurement

- WHEN a kill criterion is evaluated
- THEN its registration commit predates the first run of the measurement that
  evaluates it
- AND the register hash cited in the report matches that commit.

#### Scenario: a criterion without a fixed number is not registrable

- WHEN a proposed criterion states a threshold as "the registered share", "the
  registered margin", or any other placeholder rather than a number
- THEN it is refused registration and no measurement is reported as governed by
  it
- AND the release states which measurement is therefore ungoverned.

#### Scenario: a threshold against a locked prior measurement is registrable, one against its own run is not

- WHEN a criterion states its threshold as T2's published and hashed confidence
  half-width, committed before T4 runs
- THEN it is registrable and the register names T2 and the locking commit
- AND a criterion stating its threshold as the half-width computed by its own
  T4 run is refused registration, because a run that sets its own bar cannot
  fail it.

#### Scenario: a multi-branch criterion is split before registration

- WHEN a source criterion states two conditions with two different actions
- THEN it is registered as two criteria with separate identifiers, one condition
  and one action each
- AND neither registered criterion names an action outside
  `revert | descope | keep-off | keep`.

#### Scenario: a derived predicate is registrable only when its branches share one action

- WHEN a proposed criterion combines two measured quantities under one predicate
- THEN it is registrable only if both inputs come from one measurement and share
  one subject and one action, and the register writes the combinator out
- AND a proposal combining T4 task success with T7 unique-catch under "either"
  is refused, because its inputs come from two measurements and its branches
  would carry two actions.

#### Scenario: a zero denominator is uncomputable, never a pass

- WHEN the shadow window records 100 merges but the evidence-sufficiency checks
  would have issued no blocks at all
- THEN KC-4 is reported `UNCOMPUTABLE`, naming the zero denominator
- AND it is not reported as 100% precision, as `NOT-MET`, or as grounds for
  promoting the checks to blocking
- AND the checks remain off by default with the missing input and the release in
  which it is expected named.

#### Scenario: an absent measurement is not a measured zero

- WHEN a release ships without the census instrumentation covering the store
- THEN KC-14 is reported `UNCOMPUTABLE` rather than as zero time-travel queries
- AND the adapter is not shelved on the strength of an unmeasured count, and no
  claim resting on KC-14 is published.

#### Scenario: a criterion that no achievable measurement could trip is re-baselined

- WHEN a proposed threshold is checked against the measured quantity it is
  anchored on and no measurement of the release's actual corpus could cross it —
  as a 15-minute rebuild bound cannot, at a measured 1,070 documents per second
  over about 5,500 documents
- THEN the threshold is re-baselined onto that measured quantity before the
  measurement runs, and the register records the old number and the reason
- AND a criterion that cannot fire is not registered as though it could.

#### Scenario: an unregistered criterion cannot rescue the plane

- WHEN a favourable measurement not covered by any registered criterion is
  produced
- THEN it is reported as an observation
- AND it is not used to justify keeping any part of the plane.

### Requirement: the census verdict governs the consumption layer and never the store

WHEN the query census returns a verdict, THEN that verdict SHALL be applied to
GP-5 `graph-context-builder` alone, and it SHALL NOT freeze, land, or otherwise
decide GP-6 `graph-store-port`.

The register SHALL carry exactly one criterion keyed to the census multi-hop
share — KC-1 — and its subject SHALL be GP-5.
The store SHALL be governed only by KC-13, KC-14 and KC-15, which measure the
store's own differentiators.
IF any release document states that a multi-hop share below 20% freezes GP-6,
THEN that statement SHALL be corrected to name KC-14 and KC-15 as the store's
criteria.
The census SHALL still report its multi-hop share for the store's benefit, and
that share SHALL constrain the claims made for the store in a later release
rather than the landing decision in this one.

#### Scenario: a census below the registered share leaves the store untouched

- WHEN the census reports a genuine multi-hop-cross-run share below 20%
- THEN KC-1's registered action is executed against GP-5 only
- AND GP-6 is neither frozen nor descoped by that result
- AND the report states that the store is governed by KC-14 and KC-15.

#### Scenario: the store is frozen by its own criteria or not at all

- WHEN GP-6 is frozen in any release
- THEN the freeze cites KC-13, KC-14 or KC-15 and the measurement that met it
- AND no freeze cites the census multi-hop share as its criterion.

### Requirement: an architect override records the criterion as failed and leaves the component off

IF a registered criterion is met, THEN its registered action SHALL be executed
in the same release; and IF the architect overrides that action within the same
release, THEN the criterion SHALL be recorded as FAILED and the affected
component SHALL be left off.

An override SHALL NOT record the criterion as passed, waived, inapplicable, or
superseded, and SHALL NOT re-enable the component it governs.
An override SHALL be recorded naming the criterion, the measured number, the
registered action, and the reason.
Any rescue of an overridden component SHALL require a new criterion, registered
prospectively in a later release and evaluated only on data recorded after that
registration; the overriding release's own data SHALL NOT be reused to rescue
it.
A criterion that can be overridden into success is not a criterion, so no
override path SHALL exist that produces a passing outcome.
An `UNCOMPUTABLE` outcome SHALL NOT be overridden at all. There is no measured
number to override, so the component it governs stays off until the criterion
returns `MET` or `NOT-MET` on a real measurement; an override recorded against
an uncomputable criterion SHALL be refused rather than recorded, because it
would be the register's only route from "nothing was measured" to "the component
ships".

#### Scenario: an override does not turn a failure into a pass

- WHEN a registered criterion is met and the architect overrides its action
- THEN the falsification report records that criterion as FAILED with its
  measured number
- AND the component it governs remains off in the shipped release
- AND the override record names the criterion, the number, the registered action
  and the reason.

#### Scenario: a rescue requires a new prospectively registered criterion

- WHEN a later release proposes to re-enable a component whose criterion was
  overridden
- THEN it registers a new criterion before the measurement that would rescue it
- AND a re-reading of the overriding release's data is refused as a basis.

### Requirement: extraction quality is registered with four independent thresholds

Foreman SHALL measure semantic extraction quality against a hand-built gold set
over its own corpus, and SHALL evaluate KC-11a, KC-11b, KC-11c and KC-11d
independently against that measurement.

The measurement SHALL report entity precision, recall and F1; relation
precision, recall and F1 with predicate scoring; the false-merge count in the
sample; the non-isolated-node share; and the share of nodes merged in a single
resolution pass.
The measurement SHALL report, beside every rate and share, the denominator it
was computed over — the gold set's relation count, the extracted node count, the
gold sample's size, and the merged-node count — so that a zero denominator is
visible in the report rather than inferred from a suspiciously round rate.
The measured subject SHALL be the extraction produced by
`knowledge-plane-refresh`'s slow cadence, and the gold set SHALL be built before
the extraction under test is scored.
Each of the four criteria SHALL be evaluated and reported separately, and one
of them being met SHALL NOT suppress the evaluation of the others.
IF any of the four criteria's denominators is zero, THEN that criterion SHALL be
reported `UNCOMPUTABLE` under the register's uncomputable rule, and SHALL NOT be
reported as a favourable rate: an F1 of 0.0 over an empty gold set, a
non-isolated share over zero nodes, zero false merges over an empty sample, and
a 0% one-pass share over zero merges are all absent measurements, and two of
them would otherwise read as passes.
An LLM SHALL NOT be asked to decide an edge's domain, range, cardinality or
disjoint status, and SHALL NOT be asked to infer relations between opaque
Foreman-generated identifiers; these are rules, not thresholds, and no
measurement makes them negotiable.

#### Scenario: relation F1 below the registered floor kills semantic extraction

- WHEN predicate-scored relation F1 against the gold set is below 0.60, over a
  gold set containing at least one relation
- THEN KC-11a is met and its registered action reverts semantic extraction to an
  AST-only plane
- AND the measured F1 is published with the gold set's size.

#### Scenario: a single false merge is enough

- WHEN the gold sample contains one or more false merges
- THEN KC-11c is met and entity resolution is reverted, keeping surface forms
- AND the report does not average the false merge away against a favourable
  compression ratio.

#### Scenario: no merges at all is uncomputable, not a clean sheet

- WHEN entity resolution performs zero merges over the gold sample
- THEN KC-11c and KC-11d are both reported `UNCOMPUTABLE` with their zero
  denominators named
- AND neither is reported as zero false merges or as a 0% one-pass share, and
  entity resolution does not ship enabled on the strength of them.

### Requirement: the round-mode occurrence reduction is registered and measured

Foreman SHALL measure class-1 background-and-stop occurrences per 100
lane-starts before and after `durable.enabled = true`, over at least 30
lane-starts, and SHALL evaluate KC-12 against that measurement.

The occurrence records SHALL come from the round-ownership telemetry emitted by
`round-ownership-default`, and SHALL NOT be counted by recollection or by
re-reading `bugeventlog.md` after the fact.
The before-window and the after-window SHALL each contain at least 30
lane-starts, and the report SHALL state both counts.
IF fewer than 30 lane-starts are recorded in either window, THEN KC-12 SHALL be
reported `UNCOMPUTABLE`, and the release SHALL NOT claim the round-mode default
fixed the failure class.
IF the before-window records zero class-1 occurrences, THEN KC-12 SHALL be
reported `UNCOMPUTABLE`, because the reduction is computed against that rate and
a reduction from zero has no value; it SHALL NOT be reported as a 0% or a 100%
reduction.
`UNCOMPUTABLE` here carries the register's general consequence: it is not a
pass, the claim stays withdrawn, and the criterion is carried into the next
release under the same identifier.

#### Scenario: an unfixed failure class withdraws the claim

- WHEN occurrences per 100 lane-starts fall by less than 50% over at least 30
  lane-starts in each window, with a non-zero before-window rate
- THEN KC-12 is met and the claim that the round-mode default fixes class-1 is
  reverted from `ROADMAP.md`, the release notes and the README
- AND the design is reopened under a new criterion registered for the next
  release.

#### Scenario: too few lane-starts is not a pass

- WHEN either window contains fewer than 30 lane-starts
- THEN KC-12 is reported `UNCOMPUTABLE`
- AND no release document claims the failure class was fixed
- AND the criterion is carried into the next release under the same identifier.

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
The report SHALL state, for every one of the registered criteria, its outcome as
exactly one of `MET`, `NOT-MET` or `UNCOMPUTABLE`, and for every `UNCOMPUTABLE`
outcome the input that was missing or the denominator that was zero, the
component left off as a result, and the release in which the input is expected
to exist. A criterion omitted from that table SHALL be treated as
`UNCOMPUTABLE`, so that silence about a criterion is never silence in the
component's favour.
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
