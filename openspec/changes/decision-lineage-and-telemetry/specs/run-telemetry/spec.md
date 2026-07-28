# Spec delta — run telemetry

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirements

### Requirement: token counts, cost and model identity are recorded per round

Every round-completion and audit-completion event SHALL carry a `usage` payload
block.

The block SHALL carry the vendor, the model identifier, the requested effort,
input tokens, output tokens, cached tokens, cost in USD, and a `source` field.
The model identifier SHALL be recorded as a structured field, and SHALL NOT be
recoverable only by parsing the round's command string.
The recorded identity SHALL comprise the alias the run requested together with
whatever version string the vendor CLI reports, and the record SHALL NOT imply
that these are the same thing.

#### Scenario: cost and model are queryable without string scraping

- WHEN a round completes
- THEN its completion event carries a `usage` block with the vendor and model
  as fields
- AND answering "which model ran this round, and what did it cost" requires no
  parsing of the command string.

### Requirement: an unmeasured cost is recorded as unmeasured, never as zero

The `usage` block's `source` field SHALL take exactly one of
`vendor_reported`, `estimated`, or `unavailable`.

WHERE the vendor CLI reports usage, `source` SHALL be `vendor_reported`.
WHERE a figure is derived rather than reported, `source` SHALL be `estimated`,
and estimated figures SHALL NOT be combined into a total without a separate
subtotal.
IF no figure is obtainable, THEN `source` SHALL be `unavailable` and the numeric
fields SHALL be recorded as absent.
A missing usage figure SHALL NOT be recorded as zero under any circumstance.
Any reported cost aggregate SHALL be accompanied by the share of its rounds
whose `source` was `unavailable`.

#### Scenario: a silent CLI does not deflate the cost total

- WHEN a vendor CLI reports no usage for a round
- THEN the round's `usage` block records `source: "unavailable"` with no
  numeric cost
- AND the run's cost aggregate excludes that round and reports it in the
  unavailable share.

#### Scenario: an estimate is labelled as an estimate

- WHEN a token count is derived rather than reported
- THEN `source` is `estimated`
- AND the aggregate presents estimated figures as their own subtotal.

### Requirement: phase timing is recorded per round

Each round SHALL record the wall-clock duration of its phases: queue wait,
implementation, gate, and audit.

Durations SHALL be recorded in seconds against the round's own events, so that
the split is derivable by replaying the log.
The audit duration SHALL be the one recorded by the audit stage, and SHALL NOT
be re-derived by a separate timer.

#### Scenario: the audit's share of a round is derivable

- WHEN a round completes after an audit
- THEN replaying the run's events yields the audit's duration and the round's
  total duration
- AND the audit's share of wall clock is computable without external timing.

### Requirement: a per-run metrics rollup is derived from the event log

A per-run `metrics.json` SHALL be written by the merge gate.

Every figure in it SHALL be derived by replaying the run's own event log, and
SHALL NOT be accumulated in memory across the run.
IF the replay stops at a malformed or in-progress line, THEN the rollup SHALL
be marked partial and SHALL state where the replay stopped.
The rollup SHALL be reproducible: recomputing it from the same log SHALL yield
identical figures.
IF a figure the rollup needs cannot be derived from the log, THEN that SHALL be
reported as a missing event rather than obtained from any other source.

#### Scenario: a crashed run still produces a correct rollup

- WHEN a run is interrupted and later replayed
- THEN the rollup reflects every event that reached the log before the
  interruption
- AND no figure is lost because an in-memory counter was discarded.

#### Scenario: a torn tail produces a partial rollup, not a wrong one

- WHEN the event log's final line is a partial append
- THEN the rollup is marked partial and states the line at which replay stopped
- AND it does not present the valid prefix as a complete run.

### Requirement: every recorded metric ships with its companion number

A metric SHALL NOT be recorded or reported without the companion figure that
detects its common misreading.

WHERE a metric is reported as an average, the tail figure and the count of
catastrophic cases SHALL be reported alongside it.
The metrics documentation SHALL state, for each metric, its common misreading
and the companion number that detects it.

#### Scenario: an average never stands alone

- WHEN rounds-to-green is reported
- THEN the tail figure and the count of abandoned specs are reported with it
- AND the report does not present the average alone.

### Requirement: telemetry failure never changes an outcome

A failure to record telemetry SHALL degrade the record and SHALL NOT alter any
merge, gate, or round outcome.

Every telemetry emission SHALL be guarded in the manner already established for
the runner's existing emissions: a failure writes to standard error and
execution continues.
WHERE a telemetry failure means a decision's record is incomplete, that
incompleteness SHALL itself be recorded.

#### Scenario: an unwritable event log does not fail a gate

- WHEN the event log cannot be written during a gate evaluation
- THEN the gate's pass or fail outcome is unchanged
- AND the failure is reported on standard error and in the gate's own output.
