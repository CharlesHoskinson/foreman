# Work-plane specification

## ADDED Requirements

### Requirement: Foreman projects durable events without model authorship

Foreman SHALL derive the v0.4 work DAG only from a run identifier and the
recorded event log. The projector SHALL NOT invoke a model, Graphify, or a
network service. It SHALL NOT modify the event log or the source graph.

#### Scenario: projection is a local read boundary

- **WHEN** the projector processes a valid event log
- **THEN** every output value is copied from an event or mechanically derived
- **AND** the input event bytes remain unchanged.

### Requirement: the projection is deterministic

Foreman SHALL emit compact JSONL in a fixed byte-wise order. It SHALL emit no
new timestamp. Equal event content SHALL produce byte-identical output on every
checkout.

#### Scenario: two projections agree

- **WHEN** the same run identifier and event content are projected twice
- **THEN** the output bytes are identical.

#### Scenario: equivalent event order does not change the result

- **WHEN** equivalent known events arrive in a different input order
- **THEN** the keyed and sorted projection bytes are identical.

### Requirement: the work record is closed and honest

Foreman SHALL project attempt, verdict, gate-decision, finding, lineage-edge,
incomplete, and coverage records. Findings SHALL use stable recorded IDs or a
content digest. Missing required identity fields SHALL produce an incomplete
record when the event can be identified. Unknown event types SHALL be ignored.

#### Scenario: a run has no projectable attempts

- **WHEN** an event log is empty or contains no projectable attempt events
- **THEN** the coverage record reports zero attempts
- **AND** it does not present the run as containing work records.

#### Scenario: the same finding recurs

- **WHEN** two runs record the same file, line, and summary without a supplied
  finding identifier
- **THEN** both projections derive the same finding identifier.

### Requirement: invalid input fails without publication

Foreman SHALL refuse a missing event file, malformed JSON line, empty line, or
torn final line. If an output already exists, refusal SHALL leave its bytes
unchanged.

#### Scenario: a torn event does not replace the projection

- **WHEN** the final event lacks its line terminator
- **THEN** the command exits nonzero
- **AND** the prior output remains byte-identical.

### Requirement: publication and checking are explicit

Foreman SHALL write to stdout unless `--out` is supplied. An output publication
SHALL use a temporary sibling and rename. `--check` SHALL compare a fresh
projection with the selected output and SHALL NOT rewrite it.

#### Scenario: a hand edit is detected

- **WHEN** an output byte differs from a new projection
- **THEN** `--check` exits nonzero
- **AND** the selected output remains unchanged.
