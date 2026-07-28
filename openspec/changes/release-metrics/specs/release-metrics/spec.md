# Spec delta — release-metrics

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Header shape matches the OpenSpec CLI parser (`## ADDED Requirements` →
`### Requirement:` → `#### Scenario:`), as established by
`lock-primitive-hardening`.

## ADDED Requirements

### Requirement: every published metric SHALL carry a documented misreading and a companion number

A release-metrics report SHALL NOT present any of M1-M13 in isolation. Each
metric definition SHALL be published together with (a) its documented
misreading — the specific wrong conclusion a reader would draw from the
number alone — and (b) a companion number that would contradict or qualify
that wrong conclusion.

WHEN a report renders a metric value, THE reporting layer SHALL render its
companion number in the same table row or the same sentence, not in a
separate section a reader can skip.
IF a metric is rendered without its companion number, THEN the report SHALL
be treated as invalid output and SHALL NOT be published or cited in release
notes.

#### Scenario: M1 without its companion is rejected

- WHEN a report renders "first-pass gate rate: 78%" with no adjacent
  architect-authored-share figure
- THEN the report is rejected by the report linter before publication.

#### Scenario: a metric with its companion passes

- WHEN a report renders "first-pass gate rate: 78% (architect-authored share
  of merged lines: 12%)" in the same row
- THEN the report linter accepts the row.

### Requirement: M1 — first-pass gate rate, companion architect-authored share

M1 SHALL be defined as: the fraction of tasks that reach `gate: pass` on
round 1 (`el_emit round_done` with `round == 1` and a passing
`gate_decision` event, once `decision-lineage-and-telemetry` emits it), out
of all tasks that reached round 1.

M1's documented misreading: "a rising first-pass gate rate means the
implementer model is improving." THE reporting layer SHALL state this
misreading verbatim next to M1.
M1's companion number SHALL be the architect-authored share of merged lines
in the same window (lines the architect wrote or hand-edited, divided by
total merged lines), computed over the identical task population as M1.

#### Scenario: architect intervention inflates M1

- WHEN the architect hand-writes 40% of a task's merged lines before gate
- AND that task passes gate on round 1
- THEN the task counts toward M1's numerator
- AND the architect-authored-share companion for that window reflects the
  40%, so a reader sees both numbers together.

### Requirement: M2 — rounds-to-green distribution, not a single point estimate

M2 SHALL be reported as three figures together, never fewer: p50
rounds-to-green, p90 rounds-to-green, and the abandoned-task count (tasks
that exhausted `limits.max_rework_rounds` or were manually abandoned) as a
fraction of tasks started, over the same window.

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

### Requirement: M3 — cost per merged change includes failed attempts

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

#### Scenario: a task with three failed rounds before merge

- WHEN a task costs $2 on round 1 (gated out), $2 on round 2 (gated out),
  and $2 on round 3 (merges)
- THEN M3 attributes $6 to that merged change, not $2
- AND the companion figure reports 2 non-merging attempts costing $4 (67%
  of the task's total cost).

### Requirement: M4 — wall-clock split by phase

M4 SHALL report elapsed wall-clock time per task decomposed into four
mutually exclusive, collectively exhaustive phases: queue (waiting for a
lane slot), implement (worker execution), audit (auditor execution), and
gate (gate-eval execution). The four phase durations for a task SHALL sum
to that task's total wall-clock time within a stated tolerance, and any
unallocated time SHALL be reported under a fifth `unaccounted` bucket
rather than silently dropped.

#### Scenario: unaccounted time is surfaced, not hidden

- WHEN a task's four phase durations sum to 40 minutes but total
  wall-clock is 55 minutes
- THEN the report SHALL show `unaccounted: 15m` rather than silently
  reconciling the four phases to 55 minutes.

### Requirement: M5 — cross-vendor auditor unique-catch rate, per vendor pair, currently uncomputable

M5 SHALL be defined per ordered vendor pair (implementer vendor, auditor
vendor): the fraction of merged-then-later-found defects, or of BLOCKED/
WARNING findings, that the auditor vendor caught and the implementer
vendor's own re-read of its own diff did not. THE reporting layer SHALL NOT
report a single aggregate M5 across all vendor pairs; it SHALL report one
figure per observed pair with its sample size.

M5 SHALL NOT be reported, and no independence claim about cross-vendor
auditing SHALL be published, WHILE `audit-run.sh` and `gate-eval.sh` emit
zero `el_emit` calls, because the finding-level provenance M5 requires does
not exist in the event log under schema v2. Once
`decision-lineage-and-telemetry` lands the `finding` and `audit_verdict`
events with vendor identity, M5 becomes computable and this restriction is
lifted.

WHEN M5 is computed, THE reporting layer SHALL cite the counter-evidence
that nine frontier LLMs across seven families collapse to approximately 2
effective independent votes, with aggregation recovering at most 11% of an
8-22 percentage-point deficit, and SHALL NOT claim vendor independence for
any pair without a measured per-pair M5 supporting it.

#### Scenario: M5 is blocked today

- WHEN a report is generated on the current codebase
- THEN M5 SHALL render as "uncomputable — no finding-level provenance in
  events.jsonl schema v2" rather than a fabricated or estimated number.

#### Scenario: M5 is reported per pair, not aggregated

- WHEN telemetry lands and M5 is computed for (grok, codex) and
  (codex, grok) pairs
- THEN the report SHALL show two distinct figures with two distinct sample
  sizes
- AND SHALL NOT collapse them into one aggregate "cross-vendor catch
  rate."

### Requirement: M6 — escaped-defect rate per 1k merged lines, fixed 14-day window

M6 SHALL be computed as the count of defects discovered after merge
(escaped defects: bugs, reverts, or hotfixes attributable to a merged
change) per 1,000 merged lines, over a fixed trailing 14-day observation
window measured from each change's merge time. A change merged fewer than
14 days before the report SHALL be excluded from that window's M6
denominator and numerator alike, not partially counted.

#### Scenario: a change too recent to have completed its window is excluded

- WHEN a change merged 5 days before the report is generated
- THEN that change's lines SHALL NOT be counted in the current M6 window's
  denominator.

### Requirement: M7 — lane mortality per 100 lane-starts

M7 SHALL be computed as the count of lanes that terminate without
producing a gate decision (crashed, orphaned, killed, or timed out per
`bugeventlog.md`'s orphan-reaping failure class) divided by total lane
starts in the window, multiplied by 100.

#### Scenario: an orphaned lane counts as mortality

- WHEN a lane's worker process is orphaned and reaped without ever
  reaching `gate-eval.sh`
- THEN that lane-start counts in M7's numerator.

### Requirement: M8 — evidence completeness

M8 SHALL be computed as the fraction of gate decisions in the window whose
required evidence artifacts (audit-verdict.json, diff content hash, event
log entries for `round_done` and `gate_decision`) are all present and
schema-valid, out of all gate decisions in the window.

#### Scenario: a gate decision missing its audit artifact lowers M8

- WHEN a gate decision has no corresponding `audit-verdict.json`
- THEN that gate decision counts against M8's numerator as incomplete.

### Requirement: extended metrics M9-M13 are defined but their computation may be deferred

M9 (verdict distribution), M10 (auditor-architect agreement, Cohen's
kappa), M11 (flake rate), M12 (budget consumed vs declared), and M13
(prediction-hold rate) SHALL be defined with formula, misreading, and
companion in the metrics reference doc. THE package SHALL NOT require
their computation to ship before M1-M8, and a report MAY omit M9-M13
entirely provided it does not label itself complete.

#### Scenario: a report omitting M9-M13 is still valid if unlabeled complete

- WHEN a report includes M1-M8 only and is titled "core metrics"
- THEN the report is valid
- AND a report covering only M1-M8 titled "complete release metrics" is
  rejected by the report linter.

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

### Requirement: gaming-detector — a metric movable without moving the outcome SHALL be flagged

For each of M1-M13, the metrics reference doc SHALL document at least one
concrete way the metric could be moved by an actor (architect, implementer,
or auditor) without the underlying release quality changing, and SHALL
name the companion or cross-check that would expose the gaming.

WHEN a metric's reported value moves by more than its measured sigma
between consecutive windows, THE reporting layer SHALL check whether its
named companion moved in a corroborating direction. IF the companion did
not move correspondingly, THEN the report SHALL flag the metric as a
gaming-candidate requiring manual review before it is cited in release
notes.

#### Scenario: M1 rises while architect share rises in lockstep — flagged

- WHEN M1 rises 15 points in a window
- AND architect-authored share of merged lines also rises substantially in
  the same window
- THEN the report flags M1 as a gaming-candidate rather than citing it as
  an implementer-quality improvement.

#### Scenario: M1 rises with stable architect share — not flagged

- WHEN M1 rises 15 points in a window
- AND architect-authored share stays within its own measured sigma
- THEN the report does not flag M1 as gaming, and the delta may be
  evaluated against the sigma rule above.

### Requirement: this package owns metric definitions and claim discipline, not the telemetry plumbing or the harness

Metric formulas, their misreadings, their companion numbers, the
sigma-before-claim rule, per-vendor-pair M5 computation, and the
gaming-detector rule SHALL be specified in this package.

THE event payload keys (`usage`, `finding`, `audit_verdict`,
`gate_decision`) and per-run `metrics.json` production SHALL remain owned
by `decision-lineage-and-telemetry`. The regression harness SHALL remain
owned by `regression-harness-tiers`. The test suite SHALL remain owned by
`test-infrastructure-hardening`. This package SHALL NOT redefine any of
those three packages' artifact shapes; where it consumes their output, it
SHALL cite the field names verbatim rather than inventing parallel ones.

#### Scenario: a metric definition cites the upstream field name

- WHEN M1's spec text refers to the event that records a gate outcome
- THEN it SHALL name the `gate_decision` event and `round_done` event as
  defined by `decision-lineage-and-telemetry`, not a locally invented
  event name.
