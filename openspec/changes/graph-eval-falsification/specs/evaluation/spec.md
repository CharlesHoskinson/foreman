# Spec delta: graph evaluation and falsification

## ADDED Requirements

### Requirement: the run set accounts for 2,000 paired slots

Foreman SHALL accept a canonical run set with exactly 2,000 planned slots. The
slots SHALL represent 1,000 baseline and graph pairs. A recorded observation
SHALL identify one pair, one arm, and one closed outcome.

#### Scenario: no measurements exist

- **WHEN** the run set contains no observations
- **THEN** the report records zero completed runs
- **AND** the report records 2,000 not-run runs.

#### Scenario: a slot appears twice

- **WHEN** two observations identify the same pair and arm
- **THEN** the evaluator refuses the run set.

### Requirement: absent evidence is never a pass

Foreman SHALL return `GRAPH_OFF_UNCOMPUTABLE` when any planned slot is
unavailable or not run. `GRAPH_OFF_UNCOMPUTABLE` SHALL keep the graph default
off.

#### Scenario: one observation is missing

- **WHEN** 1,999 valid observations are recorded
- **THEN** the result is `GRAPH_OFF_UNCOMPUTABLE`
- **AND** graph context remains off by default.

#### Scenario: one observation is unavailable

- **WHEN** all slots are recorded and one outcome is `UNAVAILABLE`
- **THEN** the result is `GRAPH_OFF_UNCOMPUTABLE`.

### Requirement: a complete measurement has a deterministic verdict

Foreman SHALL compare pass counts only when all 2,000 observations completed.
A graph win SHALL return `PROMOTE`. A graph loss SHALL return
`GRAPH_OFF_FAILED`. Equal pass counts SHALL return `GRAPH_OFF_INCONCLUSIVE`.

#### Scenario: graph wins one additional pair

- **WHEN** the baseline arm has 600 passes
- **AND** the graph arm has 601 passes
- **THEN** the result is `PROMOTE`
- **AND** the graph default is on.

#### Scenario: graph does not win

- **WHEN** the graph arm has no more passes than the baseline arm
- **THEN** the graph default remains off.

### Requirement: run-set decoding is strict and bounded

Foreman SHALL reject a run set larger than 16 MiB, malformed UTF-8,
noncanonical JSON, duplicate keys, unknown fields, invalid enums, out-of-range
pair identifiers, duplicate slots, and incorrectly ordered observations.

#### Scenario: a canonical field is unknown

- **WHEN** a run set contains an extra field
- **THEN** the evaluator refuses it.

#### Scenario: input exceeds the byte limit

- **WHEN** a run set exceeds 16 MiB
- **THEN** the evaluator refuses it before evaluation.

### Requirement: the report is canonical and replayable

Foreman SHALL bind the report to the complete run-set digest. Equal input bytes
SHALL produce equal canonical report bytes and an equal report digest.

#### Scenario: source and copied runtime evaluate the release run set

- **WHEN** both entry points receive the v0.4 run-set bytes
- **THEN** both entry points emit byte-identical output.

### Requirement: the release publishes the negative result

The v0.4 release SHALL publish its run set and generated report. The report
SHALL return `GRAPH_OFF_UNCOMPUTABLE` and SHALL keep graph context off by
default. The release SHALL NOT claim a measured graph-context improvement.

#### Scenario: v0.4 ships without fabricated observations

- **WHEN** no paired model observations were completed before release
- **THEN** the run set contains no fabricated observations
- **AND** the release can ship with graph context opt-in.
