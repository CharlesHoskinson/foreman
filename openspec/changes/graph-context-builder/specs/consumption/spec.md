# Graph-context consumption specification

## ADDED Requirements

### Requirement: Foreman builds context from qualified graph authority

Foreman SHALL accept only canonical Graphify 0.9.48 graph and metadata bytes.
The metadata graph digest SHALL match the complete graph bytes. The metadata
SHALL record zero model input and output tokens.

#### Scenario: graph metadata does not match

- **WHEN** the metadata digest differs from the graph digest
- **THEN** the builder refuses the input.

#### Scenario: the qualified graph exceeds one MiB

- **WHEN** a valid graph is larger than one MiB and not larger than 32 MiB
- **THEN** the builder accepts the graph.

### Requirement: context selection is deterministic and bounded

Foreman SHALL select no more than eight task-matched seeds. Foreman SHALL apply
the role relation allowlist before two-hop edge selection. Equal inputs SHALL
produce byte-identical context output.

#### Scenario: no seed matches the task

- **WHEN** no graph node matches the task tokens
- **THEN** the builder emits `NO GRAPH CONTEXT`
- **AND** the builder does not select a fallback subgraph.

#### Scenario: the requested budget is outside the range

- **WHEN** the requested budget is less than 256 or greater than 4,000
- **THEN** the builder clamps it to the nearest limit
- **AND** the estimated block size does not exceed the applied budget.

### Requirement: every served edge has stable citation identity

Foreman SHALL derive each edge key from its source, target, relation, source
file, and source location. Foreman SHALL assign deterministic block-local
aliases in selection order.

#### Scenario: Graphify omits a source location

- **WHEN** a valid edge has no `source_location`
- **THEN** the builder uses an empty source-location value
- **AND** the builder derives a stable edge key.

### Requirement: context output is replayable

Foreman SHALL emit canonical LF-terminated JSON. The block SHALL contain the
graph digest, source commit, task digest, role, budget, token estimate, seeds,
edges, and citation instruction. The builder SHALL return the digest of the
complete block bytes.

#### Scenario: source and copied runtime process the same inputs

- **WHEN** both entry points process the same qualified graph and task
- **THEN** both entry points emit byte-identical output.

### Requirement: citation verification is closed and model-free

Foreman SHALL verify citations with exact graph and block lookups. The verifier
SHALL report only `HALLUCINATED_EDGE_ID`, `OUT_OF_CONTEXT_CITATION`, and
`UNSUPPORTED_CLAIM`. The verifier SHALL NOT call a model.

#### Scenario: a response contains all citation failures

- **WHEN** a response cites an unknown edge, cites an unserved edge, and omits a
  citation for one claim
- **THEN** the verifier returns all three failure codes in deterministic order.

### Requirement: v0.4 context remains opt-in

Foreman SHALL NOT attach graph context to a worker or auditor automatically in
v0.4. Tranche 8 SHALL evaluate the context arm before a default can change.

#### Scenario: a normal lane runs without graph context

- **WHEN** no caller invokes the graph-context command
- **THEN** lane behavior remains unchanged.
