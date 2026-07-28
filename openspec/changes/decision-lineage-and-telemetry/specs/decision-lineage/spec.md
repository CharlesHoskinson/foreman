# Spec delta — decision lineage

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Note on format: this delta uses the header shape the OpenSpec CLI actually
parses (`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`), as
established by `lock-primitive-hardening`.

## ADDED Requirements

### Requirement: audit decisions enter the event log

The audit stage SHALL emit an `audit_verdict` event to the run's event log for
every audit it performs, including audits that produced no judgment.

The event payload SHALL carry the audit vendor, the audit model identifier, the
requested reasoning effort, the verdict, the reason when the verdict is
`UNVERIFIED`, the evidence reference for the reviewed diff, and the audit's
duration in seconds.
The vendor and model recorded SHALL be the ones that actually ran, not the
configured defaults.
WHEN the audit stage cannot emit the event, it SHALL write the failure to
standard error and SHALL NOT alter the audit's outcome.

#### Scenario: an unverified audit is still recorded

- WHEN an audit times out and records `UNVERIFIED`
- THEN an `audit_verdict` event exists for that run carrying the verdict, the
  reason, the vendor, the model and the duration.

#### Scenario: the model that reviewed a merged change is recoverable from the log alone

- WHEN a change has been merged
- THEN replaying the run's event log yields the vendor and model of the audit
  that reviewed it
- AND no console output is required to answer the question.

### Requirement: findings are individually recorded and their outcome is recorded later

The audit stage SHALL emit one `finding` event per finding reported by the
audit.

The payload SHALL carry the finding's stable id, its source, its severity, and
the file and line it cites.
The payload SHALL carry an `upheld` field, written as null at audit time.
WHEN a later round determines whether a finding held, the outcome SHALL be
recorded as a new event referencing the finding id, and the original event
SHALL NOT be rewritten.
Findings SHALL be emitted as individual events, and SHALL NOT be recorded only
as an array nested inside the verdict event.

#### Scenario: findings are countable without parsing free text

- WHEN an audit reports three findings of differing severity
- THEN three `finding` events exist
- AND a count by severity is obtainable by filtering event payload fields.

#### Scenario: the log is never rewritten to record an outcome

- WHEN a finding is later determined to have held
- THEN a new event records that outcome against the finding id
- AND the original `finding` event's bytes are unchanged.

### Requirement: gate decisions enter the event log

The merge gate SHALL emit a `gate_decision` event for every gate evaluation.

The payload SHALL carry the pass or fail outcome, the reasons array the gate
already constructs, the base and head commit shas, and which gate inputs were
evaluated.
IF the emission fails, THEN the gate's own decision output SHALL record that the
event emission failed, so that the incompleteness of the record is itself
recorded.
A failed emission SHALL NOT change the gate's pass or fail outcome.

#### Scenario: a rejection's reasons survive the session

- WHEN the gate fails a task for a forbidden path and a failing check
- THEN a `gate_decision` event records both reasons verbatim
- AND they are readable from the event log after the session that produced them
  has ended.

#### Scenario: a lost event is visible, not silent

- WHEN the `gate_decision` emission fails
- THEN the gate's decision output records the emission failure
- AND the gate's pass or fail outcome is the same as it would have been.

### Requirement: decision events extend the vocabulary additively

The decision event types SHALL be added without modifying the event log
library.

The top-level record shape and the emit function's positional signature SHALL
remain unchanged.
Decision events SHALL be structural and SHALL NOT be collapsible by compaction.
The per-consumer cursor mechanism SHALL be unchanged.
The event vocabulary table in `skills/foreman/references/durable-lanes.md`
SHALL be updated to list the new types and their payloads.

#### Scenario: the library is untouched

- WHEN this change is reviewed
- THEN the diff contains no modification to the event log library's emit, read,
  replay, cursor or compaction functions.

#### Scenario: compaction never rolls up a decision

- WHEN compaction runs over a log containing `audit_verdict`, `finding` and
  `gate_decision` events older than the cutoff
- THEN all three are preserved individually
- AND only heartbeat events are collapsed.

### Requirement: recorded payloads carry references, never contents

Decision and telemetry payloads SHALL carry hashes, identifiers, counts and
references.

They SHALL NOT carry prompt text, diff text, audit prompt bodies, or file
contents.
WHERE a payload needs to identify reviewed content, it SHALL do so by content
hash.

#### Scenario: a diff is identified without being copied

- WHEN an `audit_verdict` event records which diff was reviewed
- THEN the payload contains the diff's content hash
- AND the payload contains no portion of the diff itself.
