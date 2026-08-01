## ADDED Requirements

### Requirement: Reproducible Foreman corpus

WHERE the corpus is the Foreman repository, the dogfood runner SHALL record the
repository commit, dirty state, tracked-file count, graphify version, graph
path, graph build commit, graph SHA-256, and input counts in a machine-readable
manifest before ingest. The run SHALL use `graphify-out/graph.json` as the sole
graph exchange artifact and SHALL reject Cypher, Neo4j, FalkorDB, HTML,
GraphML, or other lossy exports. A release run SHALL refresh at the named clean
commit through `knowledge-plane-refresh`; a baseline replay SHALL name its
separate build commit and SHALL NOT represent stale input as current.

#### Scenario: Name the exact corpus

- WHEN a dogfood run starts
- THEN its manifest records the exact Foreman commit and whether the graph was
  refreshed there or replayed from a separately named build commit
- AND the report records tracked-file coverage and every entirely unrepresented
  tracked file

#### Scenario: Reject a lossy exchange path

- WHEN the configured ingest source is not `graphify-out/graph.json`
- THEN the run fails before mapping
- AND the error states that the source cannot support provenance and hyperedge
  checks

### Requirement: Schema-pinned end-to-end execution

WHEN a release dogfood run executes, the runner SHALL refresh through
`knowledge-plane-refresh`, map through the frozen SQLite ontology manifest,
ingest through the SQLite ontology adapter, and query through the permanent SQL
competency layer. The database SHALL be a fresh run-scoped local SQLite file
created from `skills/foreman/ontology/schema.sql`. Before any database use, the
runner SHALL verify the schema SHA-256 equals
`1a7c15a97fe594a07746d285a9e14b3a0820b3386c40c0206d55389f7a6eb76f`, enable
and verify foreign keys, and record the SQLite runtime and pragma values. The
report SHALL record the outcome and elapsed wall clock of every stage without
redefining owner behavior.

#### Scenario: Complete the pipeline in dependency order

- WHEN a release run reaches execution
- THEN it records independently checkable refresh, mapping, database creation,
  schema discrimination, two-pass ingest, round-trip audit, SQL competency,
  integrity, rebuild, and teardown results
- AND no later stage is reported executed after an earlier required failure

#### Scenario: Refuse a schema mismatch

- WHEN the observed schema hash differs from the pin
- THEN the run stops before database creation or data SQL
- AND records expected and observed hashes

#### Scenario: Refuse disabled foreign keys

- WHEN `PRAGMA foreign_keys` cannot be enabled and read back as `1`
- THEN the run stops before ingest
- AND records the observed value as a schema-enforcement failure

### Requirement: Arithmetic conservation ledger

WHEN mapping and ingest complete, the runner SHALL produce a machine-readable
ledger in which every input node, link, and hyperedge has exactly one primary
terminal disposition. A successful disposition is stored by a manifest mapping
or dropped by one named manifest rule. Fail-closed mapping or write SHALL be
`rejected`; input not reached after a blocker SHALL be `unreached`; neither is
an ingest success. The runner SHALL calculate and require:

`node_residual = input_nodes - stored_node_primary_outcomes - sum(nodes_dropped_by_rule)`

`link_residual = input_links - relation_outcomes - reified_link_outcomes - sum(links_dropped_by_rule)`

`hyperedge_residual = input_hyperedges - stored_hyperedge_outcomes - sum(hyperedges_dropped_by_rule)`

Each residual SHALL equal zero for a passing run. Each input key SHALL appear
once in `stored + named-drop + rejected + unreached`, and each partition total
SHALL equal its input count. Passing SHALL additionally require zero rejected,
zero unreached, and exact `input = stored disjoint-union named-drop`. Multiple
inputs MAY resolve to one lexical ontology key; primary outcomes SHALL be
counted per input, while distinct lexical keys, adapter-returned integer row
IDs, and actual SQLite rows SHALL be recounted separately. Duplicate
dispositions, unknown drop rules, unexplained key collisions, recount
mismatches, and nonzero residuals SHALL each fail. Auxiliary junction or
reified rows SHALL be reported separately and SHALL NOT be double-counted.

#### Scenario: Baseline arithmetic balances

- WHEN the committed baseline of 3,579 nodes, 3,668 links, and 6 hyperedges is
  replayed
- THEN those measured operands appear in all three equations
- AND SQLite recounts, distinct lexical keys and row IDs, per-rule drops,
  primary outcomes, rejected/unreached counts, uniqueness checks, and residuals
  are present

#### Scenario: Detect silent loss

- WHEN an input has no stored outcome and no named drop
- THEN it is recorded rejected or unreached and the relevant exact-set or
  residual check is nonzero
- AND the run fails with the missing key and first disappearance stage

#### Scenario: Detect double counting

- WHEN one link is counted as both a native/junction outcome and a reified
  outcome, or belongs to multiple drop buckets
- THEN duplicate-disposition fails even if aggregate subtraction is zero

### Requirement: Direction, ontology-guard, and graph-shape integrity

WHERE `graph.json` declares `directed:false` and `multigraph:false`, the loader
SHALL reconstruct traversal direction with `build_from_json(raw,
directed=True)` as graphify consumers do. The audit SHALL compare every mapped
link's ordered source-target tuple with its junction or reified representation,
report descending endpoint count, and fail as nondiscriminating when that count
is zero. The audit SHALL execute `PRAGMA integrity_check` and every ontology
lint view. Recursive ontology traversal SHALL use the views shipped by
`schema.sql`; a `claim_head` row with nonzero `still_superseded` SHALL be
reported guard-stopped and SHALL NOT be treated as current.

#### Scenario: Exercise the non-vacuous direction gate

- WHEN the committed baseline is replayed
- THEN the audit observes 1,465 descending endpoint-order links
- AND any stored source-target reversal fails the ordered-tuple comparison

#### Scenario: Account for collapsed parallel types

- WHEN the simple graph already collapsed parallel typed edges
- THEN the report identifies pre-ingest input loss
- AND does not claim to recover absent edge instances

#### Scenario: Guarded traversals terminate and remain honest

- WHEN contradiction and supersession cycle fixtures are queried
- THEN both shipped traversal views terminate
- AND a guarded supersession stop is not reported as a true head

### Requirement: Provenance and audit-level survival

WHEN an input maps to stored data, the representation SHALL retain or traceably
reference its `source_file`, nullable `source_location`, `confidence_score`,
and explicit audit level `EXTRACTED`, `INFERRED`, or `AMBIGUOUS` according to
the frozen manifest. The audit SHALL compare retrieved values with
`graph.json`, reject undeclared-table/column workarounds, and record three named
spot-check bundles: the `EXTRACTED` node/link bundle from
`skills/foreman/SKILL.md`; the `INFERRED` link at input index 1200 with score
0.95; and the `AMBIGUOUS` link at input index 3614 with score 0.3. Each bundle
SHALL include input identity, lexical ontology key, integer row ID when stored,
retrieved fields, and originating file. IF the pinned schema cannot represent a
witness, THEN the runner SHALL record a counted ontology finding and SHALL NOT
invent a side table or undeclared column.

#### Scenario: Trace the named sample

- WHEN the named `skills/foreman/SKILL.md` bundle is retrieved from SQLite
- THEN the report traces node `foreman_skill` and its named `contains` link
  through lexical keys and any integer row IDs to `L1` and `L14`
- AND retrieved score 1.0 and level `EXTRACTED` equal `graph.json`

#### Scenario: Preserve inferred and ambiguous levels without rebucketing

- WHEN input-index 1200 and 3614 are audited
- THEN levels remain `INFERRED` and `AMBIGUOUS` and scores remain 0.95 and 0.3
- AND numeric score does not reclassify the explicit audit level

#### Scenario: Detect provenance erosion

- WHEN a required provenance field is lost, changed, or untraceable
- THEN the audit fails with input key, field, expected value, and retrieved
  value

### Requirement: Real-graph SQL competency matrix

WHEN ingest completes, all 24 permanent competency entries SHALL be evaluated
against the real Foreman graph. Every mapped parameterised SQL query SHALL
execute through its expected-emptiness wrapper; an explicit gap SHALL be
evaluated without inventing SQL. The report SHALL contain exactly one row per
question with execution status, elapsed time, result count, SQL-or-gap
identity, and classification. A successful row SHALL carry exactly one of
`answered`, `empty-but-valid`, or `unanswerable`. Failed or not-run mapped rows
SHALL carry no answer classification and SHALL name their error or blocker. An
`empty-but-valid` result SHALL require successful SQL whose contract permits
zero. SQL syntax, constraint, timeout, busy, guard, or wrapper failure SHALL NOT
be classified empty or unanswerable. A completed stage SHALL satisfy
`answered + empty-but-valid + unanswerable = 24`; every report SHALL satisfy
`answered + empty-but-valid + unanswerable + failed + not-run = 24`.

#### Scenario: Distinguish zero rows from failure

- WHEN a competency SQL query succeeds and permits zero rows
- THEN it is `empty-but-valid` with success evidence and result count zero
- AND it cannot also be unanswerable or failed

#### Scenario: Name every unanswerable question

- WHEN the graph or pinned ontology cannot answer a competency question
- THEN the report names the question and exact absent data or representation
- AND aggregate counts alone fail the matrix gate

#### Scenario: Preserve SQL failure as failure

- WHEN a competency query encounters SQL, constraint, timeout, busy, guard, or
  wrapper error
- THEN its row records the error with no answer classification
- AND arithmetic counts it as failed, not empty or unanswerable

### Requirement: Ontology findings remain findings

IF the real corpus contains an element or property the pinned `schema.sql` and
mapping manifest cannot represent, THEN the runner SHALL apply only the
manifest-declared drop or fail disposition, record an ontology finding, and
propose a human-reviewed versioned schema or mapping change. A fail disposition
SHALL be `rejected` and SHALL fail the run; it SHALL NOT be relabeled as a drop.
Dogfood SHALL NOT add undeclared tables or columns, disable constraints, coerce
invalid enums, conflate distinct relations, submit graphify identifiers as
SQLite row IDs, or invent an ingest-only workaround. Schema and manifest hashes
SHALL remain unchanged from preflight through teardown.

#### Scenario: Record a schema gap

- WHEN a real input cannot be represented by the pinned schema
- THEN the finding includes input key, source, attempted table/relation,
  manifest outcome, affected count, first failing stage, and proposed change
- AND the schema file and database schema remain unchanged during that run

#### Scenario: Reject an undeclared-column workaround

- WHEN ingest attempts to preserve a property through a column absent from the
  reviewed mapping and schema
- THEN the adapter rejects it before SQL mutation
- AND the run reports an ontology finding rather than preservation success

### Requirement: Measured performance and rebuild baseline

WHEN the schema-pinned dogfood run executes, the runner SHALL measure total and
per-stage wall clock, rows by table, relation/junction rows by type, database
and WAL bytes, adapter-process resident memory, busy retries, and insert
throughput with recorded commands and timestamps. It SHALL delete only the
run-scoped ontology database, recreate it from the pinned schema, re-ingest,
repeat conservation, recount, integrity, lint, guarded traversal, provenance,
and competency gates, and report both passes. The previously measured
2.6-second startup, 38 MB idle RSS, 9.7 MB for 5,500 documents, and roughly
1,070 documents/second SHALL NOT be used as current SQLite results.

#### Scenario: Produce a comparable baseline

- WHEN first ingest and timed rebuild finish
- THEN the report contains environment, commands, timestamps, durations, table
  rows, database/WAL bytes, process RSS, busy retries, and calculated rows per
  second for both passes
- AND the second pass independently satisfies all evidence gates

#### Scenario: Prevent borrowed performance claims

- WHEN a required current-run measurement is missing
- THEN the baseline cannot be complete
- AND historical values are labeled historical rather than substituted

### Requirement: Honest terminal report

WHILE any stage is incomplete or failed, the report SHALL name the first
blocking stage, preserve measurements and partial ledgers obtained before the
stop, and mark every unexecuted stage `not-run`. An observed failed predicate
or execution error SHALL take precedence and produce `FAILED`; without an
observed failure, missing evidence or an unexecuted required stage SHALL produce
`INCOMPLETE`. The report SHALL state `PASSED` only when schema hash and pragma
checks, three conservation equations, exact identifier partitions, independent
SQLite recount, integrity/lint/guard checks, direction, provenance samples,
24-row competency matrix, ontology findings, first-pass metrics, and timed
rebuild all contain required numeric evidence.

#### Scenario: Fail without fabricated success

- WHEN the pipeline stops before all required stages complete
- THEN the report names the stopping condition and marks later stages `not-run`
- AND missing numbers cannot be represented as zero, empty-but-valid, or
  success

#### Scenario: Gate a passing report

- WHEN a report is evaluated for release acceptance
- THEN a deterministic gate checks every required section and numeric field
- AND returns success only when every acceptance predicate is present and true
