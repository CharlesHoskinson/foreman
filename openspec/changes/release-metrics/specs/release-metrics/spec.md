# Spec delta -- release-metrics

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Header shape matches the OpenSpec CLI parser (`## ADDED Requirements` ->
`### Requirement:` -> `#### Scenario:`), as established by
`lock-primitive-hardening`.

## ADDED Requirements

### Requirement: every published metric this package defines SHALL carry a documented misreading and a companion number

A release-metrics report SHALL NOT present any metric this package defines
(M1-M4, M6-M13) in isolation. M5 is defined and owned by
`graph-eval-falsification`, not this package -- see the ownership
requirement below. Each metric definition SHALL be published together with
(a) its documented misreading -- the specific wrong conclusion a reader
would draw from the number alone -- and (b) a companion number that would
contradict or qualify that wrong conclusion.

WHEN a report renders a metric value, THE reporting layer SHALL render its
companion number in the same table row or the same sentence, not in a
separate section a reader can skip.
IF a metric is rendered without its companion number, THEN the report SHALL
be treated as invalid output and SHALL NOT be published or cited in release
notes.
WHERE a metric renders its uncomputable-state string instead of a value, the
companion-number rule is satisfied by that string together with the named
blocking input and package: no companion is required because no value is
claimed. A blank cell, a placeholder zero, or an omitted row SHALL NOT be
treated as an uncomputable render.

#### Scenario: M1 without its companion is rejected

- WHEN a report renders "first-pass gate rate: 78%" with no adjacent
  architect-authored-share figure
- THEN the report is rejected by the report linter before publication.

#### Scenario: a metric with its companion passes

- WHEN a report renders "first-pass gate rate: 78% (architect-authored share
  of merged lines: 12%)" in the same row
- THEN the report linter accepts the row.

### Requirement: M1 -- first-pass gate rate, companion architect-authored share, blocked pending authorship instrumentation

M1 SHALL be defined as: the fraction of tasks that reach `gate: pass` on
round 1 (`el_emit round_done` with `round == 1` joined to a passing gate
outcome), out of all tasks that reached round 1. The gate-outcome input is
available today as the `pass` field of `gate-decision.json` in the run
directory (an interim file-based join keyed by run directory), and will be
available as a `gate_decision` event once `decision-lineage-and-telemetry`
lands it.

M1's documented misreading: "a rising first-pass gate rate means the
implementer model is improving." THE reporting layer SHALL state this
misreading verbatim next to M1.
M1's companion number SHALL be the architect-authored share of merged lines
in the same window (lines the architect wrote or hand-edited, divided by
total merged lines), computed over the identical task population as M1.
M1 SHALL NOT be reported, and no first-pass-gate-rate claim SHALL be
published, WHILE no instrumentation exists that measures architect-authored
share. As of this fix, no package in the current release scope is committed
to producing that measurement, so M1 renders as "uncomputable -- no
architect-authored-share instrumentation scoped in this release" rather than
a bare number, until a package is scoped to provide it. M1 is therefore
excluded from the v0.2.9 active metric set (see the reduced-set requirement
below) even though the gate-rate half of its formula is already computable.

#### Scenario: architect intervention inflates M1

- WHEN the architect hand-writes 40% of a task's merged lines before gate
- AND that task passes gate on round 1
- THEN the task counts toward M1's numerator
- AND the architect-authored-share companion for that window reflects the
  40%, so a reader sees both numbers together, once M1 is unblocked.

#### Scenario: M1 is blocked today for lack of authorship instrumentation

- WHEN a report is generated on the current codebase
- THEN M1 SHALL render as "uncomputable -- no architect-authored-share
  instrumentation scoped in this release" rather than a bare percentage
- AND SHALL NOT be counted toward the v0.2.9 active metric set.

### Requirement: M2 -- rounds-to-green distribution, not a single point estimate, computable today from existing events

M2 SHALL be reported as three figures together, never fewer: p50
rounds-to-green, p90 rounds-to-green, and the abandoned-task count (tasks
that exhausted `limits.max_rework_rounds` or were manually abandoned) as a
fraction of tasks started, over the same window.

M2's exact inputs, confirmed present today: `el_emit round_done` events
(round number, lane, sha) exist today in `events.jsonl`; the "reached
green" signal is read from `gate-decision.json`'s `pass` field per run
directory (a file-based join, not yet an event); the abandoned-task count is
read from the `alert` events `lane-supervise.sh` already emits for
abandonment and timeout. M2 is therefore computable today, joined by run
directory rather than by a dedicated event; `decision-lineage-and-telemetry`'s
future `gate_decision` event would make the join cleaner but is not a hard
blocker for M2.

WHILE only p50 is available for a window, THE reporting layer SHALL mark M2
as incomplete rather than publish p50 alone.
IF the abandoned-task count is zero for a window with fewer than 20 task
starts, THEN the report SHALL flag the p90 and abandoned-rate figures as
low-sample and SHALL NOT support a comparative claim from them alone.

#### Scenario: p50 alone hides the tail

- WHEN a window has p50 = 1 round and p90 = 6 rounds with 8% abandoned
- THEN the report SHALL show all three figures
- AND a report showing only "p50 = 1 round" is rejected by the report
  linter.

### Requirement: M3 -- cost per merged change includes failed attempts, blocked pending usage telemetry

M3 SHALL be computed as: total token cost across every attempt (round) of
every task started in the window, including tasks that were abandoned or
gated out and never merged, divided by the count of tasks that merged in
that window.

IF M3 is computed using only the cost of the attempt that ultimately
merged, THEN that computation SHALL be labeled `M3-optimistic` and SHALL
NOT be published under the name M3.
M3's documented misreading: "cost per merged change measures efficiency of
the winning attempt." Its companion number SHALL be the count and cost
share of non-merging attempts in the same window.
M3 SHALL NOT be reported, and no cost-per-merged-change claim SHALL be
published, WHILE no `usage` event or equivalent cost telemetry exists in
`events.jsonl` schema v2 -- confirmed by inspection: no orchestration
script emits `input_tokens`, `output_tokens`, or `cost_usd` today. M3
renders as "uncomputable -- no usage/cost telemetry in events.jsonl
schema v2, pending decision-lineage-and-telemetry" until that package (a
sibling landing in this same v0.2.9 release) lands the `usage` payload on
lane-completion and audit-completion events. M3 remains in the v0.2.9
active metric set because its blocking input is scoped to land within this
release, unlike M1 and M6 below.

#### Scenario: a task with three failed rounds before merge

- WHEN a task costs $2 on round 1 (gated out), $2 on round 2 (gated out),
  and $2 on round 3 (merges)
- THEN M3 attributes $6 to that merged change, not $2, once usage telemetry
  lands
- AND the companion figure reports 2 non-merging attempts costing $4 (67%
  of the task's total cost).

#### Scenario: M3 is blocked today for lack of cost telemetry

- WHEN a report is generated on the current codebase
- THEN M3 SHALL render as "uncomputable -- no usage/cost telemetry in
  events.jsonl schema v2, pending decision-lineage-and-telemetry"
- AND SHALL NOT be published as a bare number until that package lands.

### Requirement: M4 -- wall-clock split by phase, blocked pending phase-boundary telemetry

M4 SHALL report elapsed wall-clock time per task decomposed into five
mutually exclusive, collectively exhaustive buckets: four named phases --
queue (waiting for a lane slot), implement (worker execution), audit
(auditor execution), gate (gate-eval execution) -- plus `unaccounted`, which
holds every interval not attributable to one of the four. The four named
phases are mutually exclusive but NOT collectively exhaustive on their own,
which is exactly why `unaccounted` exists; the five buckets together are
what sum to the task's total wall-clock time, within a stated tolerance.
Unallocated time SHALL be reported under `unaccounted` rather than silently
dropped or reconciled into a named phase.

M4 SHALL NOT be reported, and no phase-split wall-clock claim SHALL be
published, WHILE `events.jsonl` schema v2 records only a single
phase-transition site (`state: verifying` in `lane-run.sh`) and carries no
queue/implement/audit/gate phase-boundary timestamps -- confirmed by
inspection of every `el_emit state` call site. M4 renders as "uncomputable
-- no four-phase timestamp instrumentation in events.jsonl schema v2,
pending decision-lineage-and-telemetry" until that package lands
phase-boundary events or an equivalent `metrics.json` payload carrying
phase timing. M4 remains in the v0.2.9 active metric set because its
blocking input is scoped to land within this same release.

#### Scenario: unaccounted time is surfaced, not hidden

- WHEN a task's four phase durations sum to 40 minutes but total
  wall-clock is 55 minutes
- THEN the report SHALL show `unaccounted: 15m` rather than silently
  reconciling the four phases to 55 minutes, once M4 is unblocked.

#### Scenario: M4 is blocked today for lack of phase-boundary instrumentation

- WHEN a report is generated on the current codebase
- THEN M4 SHALL render as "uncomputable -- no four-phase timestamp
  instrumentation in events.jsonl schema v2, pending
  decision-lineage-and-telemetry"
- AND SHALL NOT be published as a bare number until that package lands.

### Requirement: M5 is owned and defined by graph-eval-falsification, not this package

M5 (cross-vendor auditor unique-catch rate) was previously defined
independently and conflictingly in both this package and
`graph-eval-falsification`'s evaluation spec. Per the audit's
proportionality review, this package removes its own M5 definition;
`graph-eval-falsification` is the sole owner of M5's formula,
per-vendor-pair reporting shape, and threshold.

This package remains a consumer of M5 for the cross-cutting discipline it
owns: WHERE a report this package's linter covers renders M5, the
companion-number rule and the sigma-before-claim rule SHALL still apply to
it, citing `graph-eval-falsification`'s field names and formula verbatim
rather than restating or inventing a parallel M5 definition here.

The independence-claim rule SHALL be stated so that it has a reachable
satisfying witness and a reachable rejected input, rather than blocking every
claim for a reason unrelated to measurement. **In v0.2.9 no report this
package lints renders M5** -- the reduced-set requirement below forbids
computing or citing it -- so in v0.2.9 no independence claim about
cross-vendor auditing SHALL be published at all, and the linter SHALL reject
such a claim naming M5's absence as the reason. The citation exception
becomes available only in a release in which M5 is computable and rendered:
from that release onward, no independence claim SHALL be published unless it
cites a measured per-pair M5 computed per `graph-eval-falsification`'s
definition, and a claim citing a collapsed aggregate SHALL be rejected. The
rule therefore rejects two concrete known-bad inputs -- a v0.2.9 report
asserting cross-vendor independence, and a later report citing an aggregate
M5 -- rather than being unsatisfiable by construction.

#### Scenario: a v0.2.9 report asserting cross-vendor independence is rejected

- WHEN a v0.2.9 release-metrics report claims that cross-vendor auditing
  found defects a single vendor would have missed
- THEN the report linter rejects the claim, naming M5 as not rendered in
  this release
- AND the report is valid only once the claim is removed.

#### Scenario: M5 is consumed, not redefined, in a release that renders it

- WHEN a release in which M5 is computable renders M5 in a release-metrics
  report
- THEN it SHALL use `graph-eval-falsification`'s per-vendor-pair formula and
  field names verbatim
- AND this package's own metrics reference doc SHALL NOT contain a
  competing M5 formula.

### Requirement: M6 -- escaped-defect rate per 1k merged lines, fixed 14-day window, blocked pending defect-to-merge linkage

M6 SHALL be computed as the count of defects discovered after merge
(escaped defects: bugs, reverts, or hotfixes attributable to a merged
change) per 1,000 merged lines, over a fixed trailing 14-day observation
window measured from each change's merge time. A change merged fewer than
14 days before the report SHALL be excluded from that window's M6
denominator and numerator alike, not partially counted.

Per the audit's proportionality review, M6 SHALL NOT be reported WHILE no
mechanical linkage exists tying an escaped defect (a bugeventlog.md entry,
revert, or hotfix) back to the specific merged change that caused it --
today that attribution is manual and undocumented, so a numerator computed
from it would be an unverifiable human judgment call presented as a
mechanical count. M6 renders as "uncomputable -- no defect-to-merge
linkage mechanism" until such a mechanism is scoped; no package currently
owns it (not `decision-lineage-and-telemetry`,
`regression-harness-tiers`, nor `test-infrastructure-hardening`). M6 is
therefore excluded from the v0.2.9 active metric set alongside M1.

#### Scenario: a change too recent to have completed its window is excluded

- WHEN a change merged 5 days before the report is generated
- THEN that change's lines SHALL NOT be counted in the current M6 window's
  denominator, once M6 is unblocked.

#### Scenario: M6 is blocked today for lack of defect-to-merge linkage

- WHEN a report is generated on the current codebase
- THEN M6 SHALL render as "uncomputable -- no defect-to-merge linkage
  mechanism" rather than an estimated or manually-attributed number
- AND SHALL NOT be counted toward the v0.2.9 active metric set.

### Requirement: M7 -- lane mortality per 100 lane-starts, computable today from existing alert events

M7 SHALL be computed as the count of lanes that terminate without
producing a gate decision (crashed, orphaned, killed, or timed out per
bugeventlog.md's orphan-reaping failure class) divided by total lane
starts in the window, multiplied by 100.

M7's exact inputs, confirmed present today: the `alert` events already
emitted by `lane-run.sh` (`worker_timeout`, `worker_launcher_error`,
`ownership_timeout`, `degraded`/`launcher_absent`, `round_incomplete`) and by
`lane-supervise.sh` (`abandoned`) form the numerator; the `ownership` event
`lane-run.sh` already emits when a lane claims work forms the denominator
(lane starts). M7 is therefore computable today with no dependency on
`decision-lineage-and-telemetry`.

M7's documented misreading: "lane mortality measures how fragile the
orchestration layer is." It does not -- it counts every termination without a
gate decision, including the ones a maintainer caused on purpose by
cancelling a lane or by tightening a timeout, so tightening a timeout raises
M7 while improving the system. THE reporting layer SHALL state this
misreading verbatim next to M7.
M7's companion number SHALL be the window's total lane starts (M7's own
denominator, so the reader can see the sample size) together with the count
of terminations that were maintainer-initiated (cancel or abandon) rather
than unattended (crash, orphan, timeout), rendered in the same row or
sentence as M7.

#### Scenario: an orphaned lane counts as mortality

- WHEN a lane's worker process is orphaned and reaped without ever
  reaching `gate-eval.sh`
- THEN that lane-start counts in M7's numerator.

#### Scenario: M7 without its companion is rejected

- WHEN a report renders "lane mortality: 6 per 100 lane-starts" with no
  adjacent lane-start count and no maintainer-initiated share
- THEN the report linter rejects the row before publication.

### Requirement: M8 -- evidence completeness, partially computable today via filesystem artifacts

M8 SHALL be computed as the fraction of gate decisions in the window whose
required evidence artifacts (`audit-verdict.json`, diff content hash, event
log entries for `round_done` and `gate_decision`) are all present and
schema-valid, out of all gate decisions in the window.

M8's exact inputs and their current status: `audit-verdict.json` presence
and `.verdict` schema-validity are computable today via filesystem
inspection of each run directory; the diff content hash is computable today
the same way; the `round_done` event is computable today from
`events.jsonl`. The `gate_decision` event-log entry is NOT computable
today -- `gate-eval.sh` emits zero `el_emit` calls, confirmed by
inspection. Until `decision-lineage-and-telemetry` lands the `gate_decision`
event, M8 SHALL be computed using `gate-decision.json`'s presence in the run
directory as a documented interim substitute for that one input, and the
report SHALL state which basis (event or file) was used for that input. M8
remains in the v0.2.9 active metric set on this partial, interim basis.

M8's documented misreading: "high evidence completeness means the audits
were thorough." M8 measures only that the required artifacts are present and
schema-valid, never that their content is substantive: an
`{"verdict":"APPROVED","findings":[],"summary":""}` file scores identically
to a detailed one. THE reporting layer SHALL state this misreading verbatim
next to M8.
M8's companion number SHALL be the window's total gate decisions (M8's own
denominator) together with the share of the M8 population whose
`gate_decision` input was satisfied by the interim `gate-decision.json` file
basis rather than by the event, rendered in the same row or sentence as M8.

#### Scenario: a gate decision missing its audit artifact lowers M8

- WHEN a gate decision has no corresponding `audit-verdict.json`
- THEN that gate decision counts against M8's numerator as incomplete.

#### Scenario: M8 without its companion is rejected

- WHEN a report renders "evidence completeness: 94%" with no adjacent
  gate-decision count and no interim-basis share
- THEN the report linter rejects the row before publication.

#### Scenario: M8 states which basis it used for the gate-decision input

- WHEN a report computes M8 before `decision-lineage-and-telemetry`'s
  `gate_decision` event lands
- THEN the report states it used the `gate-decision.json` file as the interim
  basis for that input
- AND once the event lands, the report SHALL state it switched to the event
  basis.

### Requirement: v0.2.9 ships a reduced active metric set per the audit's proportionality review; M9-M13 are deferred entirely

For v0.2.9, this package's release report SHALL actively compute and
publish M2, M3, M4, M7, and M8, each subject to the input-availability
restrictions stated in its own requirement above (M3 and M4 render
uncomputable until `decision-lineage-and-telemetry` lands; M8 uses an
interim file-based basis for one input). M1 and M6 remain defined in this
package but SHALL NOT be reported until their stated blocking dependency
lands -- neither currently has a package scoped to provide it. M5 is
owned by `graph-eval-falsification`, not this package.

M9 (verdict distribution), M10 (auditor-architect agreement, Cohen's
kappa), M11 (flake rate), M12 (budget consumed vs declared), and M13
(prediction-hold rate) SHALL be defined with formula, misreading, and
companion in the metrics reference doc, but SHALL be deferred entirely from
v0.2.9's shipped report. THE package SHALL NOT compute or cite any of
M9-M13 in a v0.2.9 release report, even where partial data exists for one
of them.

The justification for the cut SHALL be stated accurately rather than
overstated: of the five metrics in the active set, **two (M2 and M7) are
computed from inputs confirmed present today, one (M8) is computed on a
documented interim basis for one of its inputs, and two (M3 and M4) render
uncomputable pending `decision-lineage-and-telemetry`.** The reduced set is
therefore not "five metrics fully computed"; it is a set of five whose input
availability is stated per metric. That is still the honest cut, because
thirteen nominal metrics over incomplete populations misleads a reader more
than five metrics each of which says exactly what it could and could not
measure -- but the report SHALL NOT describe the active set as fully
computed.

#### Scenario: a v0.2.9 report ships the reduced set and is valid

- WHEN a report includes M2 and M7 with their companions, M8 with its
  companion on the documented interim basis, and M3 and M4 rendering their
  uncomputable-state strings, and is titled "v0.2.9 release metrics"
- THEN the report is valid
- AND a v0.2.9 report that computes or cites any of M1, M5, M6, or M9-M13
  is rejected by the report linter.

#### Scenario: describing the active set as fully computed is rejected

- WHEN a v0.2.9 report states that its five active metrics are fully
  computed
- THEN the report linter rejects that statement, naming M3 and M4 as
  uncomputable and M8 as interim-basis
- AND the report is valid only once the claim is corrected.

#### Scenario: labeling a reduced report as complete is rejected

- WHEN a report includes only the v0.2.9 active set and is titled "complete
  release metrics"
- THEN the report linter rejects the title
- AND the report is valid only when retitled to reflect its reduced scope.

### Requirement: a metric with a zero denominator is uncomputable, never zero, and never a satisfied threshold

Every metric this package defines is a rate, a ratio, a per-unit figure or a
distribution over a population, and each SHALL name its denominator
explicitly in the metrics reference doc. A zero denominator records that
nothing was measured, not that the measured value was zero, and the two SHALL
NOT be rendered identically.

The denominators are: M1 -- tasks that reached round 1; M2 -- tasks started in
the window; M3 -- tasks that merged in the window; M4 -- tasks with recorded
phase timing; M6 -- merged lines whose 14-day window has completed; M7 -- lane
starts in the window; M8 -- gate decisions in the window.
WHEN a metric's denominator is zero for a window, THEN the report SHALL
render `uncomputable -- zero denominator (<denominator name> = 0 over
<window>)` and SHALL NOT render `0`, `0%`, `100%`, a blank cell, `n/a`, or an
omitted row.
IF a metric renders as zero-denominator uncomputable, THEN it SHALL NOT
satisfy any threshold, SHALL NOT support a comparative claim, and SHALL NOT
be carried into any aggregate or period-over-period delta as though it were
zero; the sigma-before-claim rule has no delta to evaluate and the
gaming-review rule has no move to flag.
A zero-denominator render SHALL be distinguishable in the report from a
blocked-input uncomputable render: the first names the empty population, the
second names the missing instrumentation and its blocking package. Neither
SHALL be reported as a pass, a target met, or an improvement.
WHERE a metric renders a blocked-input uncomputable string, the report linter
SHALL verify that the named blocking package exists as a change under
`openspec/changes/` and has not landed, and SHALL reject the render when the
named blocker does not exist or has already landed -- so the mark cannot be
used to excuse a metric whose input is in fact available.

#### Scenario: a window with no lane starts does not report zero mortality

- WHEN a report window contains zero lane starts
- THEN M7 renders `uncomputable -- zero denominator (lane starts = 0 over
  <window>)`
- AND it is not rendered as 0 per 100 lane-starts and is not cited as
  evidence of lane reliability.

#### Scenario: a zero-denominator metric cannot carry a comparative claim

- WHEN M8's window contains zero gate decisions and the previous window's
  M8 was 94%
- THEN the report states M8 as zero-denominator uncomputable for the current
  window and makes no release-over-release comparison
- AND the linter rejects any sentence describing M8 as improved, regressed,
  better or worse across those two windows.

#### Scenario: an uncomputable mark naming a landed blocker is rejected

- WHEN a report renders M3 as uncomputable pending
  `decision-lineage-and-telemetry` after that package has landed its `usage`
  payload
- THEN the report linter rejects the render, naming the landed blocker
- AND the metric must be computed or a different blocking input named.

### Requirement: no comparative claim SHALL be published before variance is measured and stated

Foreman's own noise floor (run-to-run variance, sigma, for each metric
under unchanged code) SHALL be measured before any release-over-release
delta for that metric is characterized as an improvement or regression. THE
reporting layer SHALL require a stated sigma alongside any comparative
claim.

IF a reported delta between two releases is smaller than the measured
sigma for that metric, THEN the report SHALL state that the delta is not
distinguishable from noise, and SHALL NOT characterize it as an improvement
or a regression.

#### Scenario: a delta smaller than sigma is not a finding

- WHEN M1 rises from 74% to 76% between two releases and the measured
  sigma for M1 is 5 percentage points
- THEN the report SHALL state "not distinguishable from measurement noise
  (sigma=5pp)" and SHALL NOT claim improvement.

#### Scenario: an undocumented sigma blocks the claim entirely

- WHEN a report claims "M6 improved 30%" with no sigma stated anywhere in
  the report
- THEN the report linter rejects the claim.

### Requirement: gaming exposure relies on a typed companion field and human review, not automated directional inference

For each metric M1-M4 and M6-M13 that this package defines (M5's gaming
exposure is `graph-eval-falsification`'s responsibility, per the ownership
requirement below), the metrics reference doc SHALL document at least one
concrete way the metric could be moved by an actor (architect, implementer,
or auditor) without the underlying release quality changing, and SHALL
name the typed companion field a human reviewer checks when investigating
that risk.

Cut per the audit's proportionality review: an earlier design attempted
automated directional-corroboration inference -- comparing whether a
companion "moved in a corroborating direction" whenever a metric moved by
more than sigma, and auto-flagging a mismatch as gaming. That automation is
itself an unvalidated predicate with no positive control demonstrating it
distinguishes real gaming from coincidental correlated movement, and it adds
complexity disproportionate to this release's scope. Retained instead: the
companion field SHALL be present, typed, and adjacent to the metric
(enforced by the existing companion-number linter rule). WHEN a metric's
reported value moves by more than its measured sigma between consecutive
windows, THE report SHALL flag it for human review alongside its companion
value, and SHALL NOT auto-classify it as gaming or as legitimate without
that review.

#### Scenario: a large metric move is flagged for human review, not auto-classified

- WHEN M2's p50 rounds-to-green falls 15% in a window, more than its
  measured sigma
- THEN the report flags M2 for human review with its abandoned-task-count
  companion shown alongside
- AND the report does NOT automatically label the move as gaming or as a
  legitimate improvement.

#### Scenario: a metric within its sigma is not flagged

- WHEN a metric's move in a window is within its measured sigma
- THEN the report does not flag it for gaming review
- AND the delta may still be evaluated against the sigma-before-claim rule.

### Requirement: this package owns metric definitions and claim discipline for M1-M4 and M6-M13, not the telemetry plumbing, the harness, or M5

Metric formulas, their misreadings, their companion numbers, the
sigma-before-claim rule, and gaming-exposure documentation for M1-M4 and
M6-M13 SHALL be specified in this package.

M5 (cross-vendor auditor unique-catch rate) SHALL be defined and owned by
`graph-eval-falsification`'s evaluation spec, not by this package -- see
the M5 requirement above for the full resolution.

THE event payload keys (`usage`, `finding`, `audit_verdict`,
`gate_decision`) and per-run `metrics.json` production SHALL remain owned
by `decision-lineage-and-telemetry`. The regression harness SHALL remain
owned by `regression-harness-tiers`. The test suite SHALL remain owned by
`test-infrastructure-hardening`. This package SHALL NOT redefine any of
those three packages', or `graph-eval-falsification`'s, artifact shapes;
where it consumes their output, it SHALL cite the field names verbatim
rather than inventing parallel ones.

#### Scenario: a metric definition cites the upstream field name

- WHEN M1's spec text refers to the event that records a gate outcome
- THEN it SHALL name the `gate_decision` event and `round_done` event as
  defined by `decision-lineage-and-telemetry`, not a locally invented
  event name.

#### Scenario: M5 is consumed, not redefined by the ownership requirement

- WHEN a release-metrics report renders M5
- THEN it SHALL use `graph-eval-falsification`'s per-vendor-pair formula and
  field names verbatim
- AND this package's own reference doc SHALL NOT contain a competing M5
  formula.
