# Graphify integration specification

## ADDED Requirements

### Requirement: Graphify is qualified before adoption

Foreman SHALL pin Graphify 0.9.48 and SHALL build two isolated code-only
candidates from the same source commit and configuration before publication.
The normalized graph bytes and normalized health report SHALL match.

#### Scenario: Identical builds agree

- **WHEN** Graphify 0.9.48 builds the registered good corpus twice
- **THEN** normalized graph bytes are identical
- **AND** normalized health reports are identical
- **AND** the candidate is eligible for the remaining qualification checks

#### Scenario: A build is nondeterministic

- **WHEN** either normalized identity differs
- **THEN** qualification refuses with `nondeterministic`
- **AND** no published graph or metadata byte changes

### Requirement: The merge qualification is code-only

The v0.4 qualification SHALL use Graphify's code-only extraction with one AST
worker. It SHALL refuse any nonzero input-token or output-token count. It SHALL
not invoke semantic extraction, labelling, or an LLM backend.

#### Scenario: Model use appears

- **WHEN** either candidate reports a nonzero model-token count
- **THEN** qualification refuses with `model_usage`
- **AND** no candidate is published

### Requirement: Producer identity is exact

The interpreter SHALL resolve from `graphify-out/.graphify_python` or the
reference manifest. The resolved path SHALL be absolute, regular, executable,
outside the repository, and SHALL report exactly Graphify 0.9.48.

#### Scenario: The interpreter or version differs

- **WHEN** the path is unsafe or the reported version differs from the pin
- **THEN** qualification refuses before extraction
- **AND** the diagnostic contains no raw child output or stack

### Requirement: Graph health checks are discriminating

The qualifier SHALL reject invalid graph shapes, duplicate node identifiers,
missing locations on source-backed nodes and links, unsafe source paths,
dangling endpoints, duplicate ordered endpoint and relation tuples, and
nonzero Graphify dangling, missing, or non-object edge counters. It SHALL count
0.9.48 external/import placeholder nodes and unlocated `dynamic_import` links
separately. When links exist, it SHALL require at least one link whose source
sorts after its target.

The graph's `directed` field SHALL be recorded but SHALL NOT determine
qualification. Store-native parallel decision edges SHALL NOT be claimed as
round-tripping through `graph.json`.

#### Scenario: A registered bad corpus is checked

- **WHEN** one health invariant is violated
- **THEN** the qualifier refuses for that invariant
- **AND** the corresponding good corpus remains qualified

### Requirement: Publication has one writer

Every publication SHALL use one bounded advisory lock in the common Git
directory. Qualification reads SHALL not take this lock. Publication SHALL
atomically replace the graph and canonical metadata only after every check
passes. A failure SHALL leave the previous files unchanged.

#### Scenario: Two writers compete

- **WHEN** two publishers target one repository
- **THEN** at most one holds the publication lock
- **AND** the other waits within the bound or refuses with `lock_timeout`
- **AND** neither process publishes a partial file

### Requirement: Metadata binds the qualified graph

`graphify-out/refresh-meta.json` SHALL be canonical JSON. It SHALL bind the
Graphify version, resolved interpreter, source commit, graph digest, normalized
graph digest, health digest, token counts, observed directed field,
endpoint-order count, source-file count, rename records, cadence, timestamp,
and `lastRefreshFailed` state.

#### Scenario: Metadata is substituted

- **WHEN** metadata does not bind the graph bytes and source commit
- **THEN** freshness returns `Invalid`
- **AND** no graph claim is supplied to a consumer

### Requirement: Rename lineage is explicit

The publisher SHALL compute Git rename records from the prior qualified commit
to the candidate commit. It SHALL map every old file and symbol node that can
be matched to the new path and SHALL list every unmappable node explicitly.
It SHALL never guess.

#### Scenario: A multi-symbol file moves

- **WHEN** Git reports a file rename and the old and new graphs contain its
  file and symbol nodes
- **THEN** metadata records each exact old-to-new node mapping
- **AND** unmatched nodes appear in `unmapped`

### Requirement: Freshness is Graphify-free

The freshness command SHALL use only Git, graph bytes, and metadata. It SHALL
distinguish `Fresh`, `Stale`, `Unrelated`, `Missing`, `Invalid`, and
`RefreshFailed`. It SHALL report commit drift and tracked source files absent
from the graph.

#### Scenario: Graphify is unavailable

- **WHEN** the graph and metadata are valid but Graphify is not installed
- **THEN** freshness still returns its exact result
- **AND** ordinary Foreman operation remains available

#### Scenario: No qualified graph is available

- **WHEN** the graph is missing, stale, unrelated, invalid, or failed
- **THEN** a consumer selects direct-source or lexical mode
- **AND** it does not emit claims from the graph

### Requirement: Lossy export is outside the release path

The v0.4 knowledge plane SHALL consume only the qualified `graph.json` and
metadata pair. Neo4j, FalkorDB, Cypher, semantic extraction, and community
labels SHALL not be release evidence.

#### Scenario: A release check cites an advisory or lossy artifact

- **WHEN** evidence names one of those outputs
- **THEN** the evidence is rejected

## MODIFIED Requirements

### Requirement: Maintenance reports knowledge freshness

The maintenance graph stage and the maintenance workflow SHALL invoke the
Graphify-free freshness runtime. They SHALL not install or run Graphify in CI.

#### Scenario: CI has no Graphify installation

- **WHEN** maintenance checks a qualified graph
- **THEN** it reports freshness from Git and tracked artifacts
- **AND** the existing no-Graphify CI boundary remains intact
