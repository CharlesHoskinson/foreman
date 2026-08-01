## ADDED Requirements

### Requirement: Reproducible Foreman corpus

WHERE the dogfood corpus is the Foreman repository itself, the dogfood runner SHALL record the repository commit, dirty-worktree state, tracked-file count, graphify version, graph artifact path, graph build commit, and graph input counts in a machine-readable run manifest before ingest begins. The run SHALL use `graphify-out/graph.json` as the sole graph exchange artifact and SHALL reject Neo4j, Cypher, HTML, GraphML, or other lossy exports as ingest sources. A release run SHALL refresh the graph at the named clean commit under the procedure owned by `knowledge-plane-refresh`; a replay of the committed baseline SHALL identify its build commit separately and SHALL not misrepresent a stale artifact as current.

#### Scenario: Name the exact corpus

- WHEN a dogfood run starts
- THEN its run manifest records the exact Foreman commit and whether the graph was refreshed at that commit or replayed from a separately named graph build commit
- AND the report records tracked-file coverage and names every entirely unrepresented tracked file

#### Scenario: Reject a lossy exchange path

- WHEN the configured ingest source is not `graphify-out/graph.json`
- THEN the run fails before mapping and reports that the source cannot support the required provenance and hyperedge checks

### Requirement: Pinned end-to-end execution

WHEN a release dogfood run is executed, the runner SHALL refresh the graph through `knowledge-plane-refresh`, map the resulting `graph.json` through the frozen manifest owned by `graph-store-port`, ingest through its two-pass SQLite ontology adapter, and query through its SQL layer and shipped guarded views. The database SHALL be a fresh local SQLite ontology file created from `skills/foreman/ontology/schema.sql` pinned to SHA-256 `1a7c15a97fe594a07746d285a9e14b3a0820b3386c40c0206d55389f7a6eb76f`. The report SHALL record the outcome and elapsed wall clock of every stage without redefining the behavior owned by those packages.

#### Scenario: Complete the pipeline in dependency order

- WHEN a release dogfood run reaches its execution phase
- THEN it records independently checkable results for refresh, manifest mapping, fresh-database startup, schema load, two-pass ingest, round-trip audit, competency queries, and teardown
- AND no later stage is reported as executed when an earlier required stage failed

#### Scenario: Refuse an unpinned database

- WHEN the observed ontology schema hash differs from the required pin
- THEN the run stops before schema load and records the observed schema hash

### Requirement: Arithmetic conservation ledger

WHEN mapping and ingest complete, the runner SHALL produce a machine-readable conservation ledger in which every input node, link, and hyperedge has exactly one primary terminal disposition. A successful disposition is either stored by its manifest-declared representation or dropped by one named manifest rule. A fail-closed mapping or write is recorded as `rejected`, and an input not reached after an earlier blocker is recorded as `unreached`; neither is an ingested or dropped success. The runner SHALL calculate and require all three conservation residuals to equal zero:

`node_residual = input_nodes - stored_node_primary_outcomes - sum(nodes_dropped_by_rule)`

`link_residual = input_links - relation_outcomes - reified_link_outcomes - sum(links_dropped_by_rule)`

`hyperedge_residual = input_hyperedges - stored_hyperedge_outcomes - sum(hyperedges_dropped_by_rule)`

Each input identifier SHALL appear exactly once in the corresponding accounting partition `stored + named-drop + rejected + unreached`, and each partition total SHALL equal its input count. A conservation pass additionally requires `rejected = 0`, `unreached = 0`, and the exact successful partition `input = stored disjoint-union named-drop`. Multiple node inputs MAY resolve to the same generated database document under a manifest key; therefore primary stored outcomes SHALL be counted per input, while distinct projected database identifiers and actual database documents SHALL be recounted and compared separately. Duplicate dispositions, unknown drop reasons, unexplained projected-ID collisions, mismatches between reported output counts and database recounts, and nonzero conservation residuals SHALL fail the run. Secondary documents or relations emitted for one primary outcome SHALL be reported separately and SHALL NOT be double-counted as additional conserved inputs.

#### Scenario: Baseline arithmetic balances

- WHEN the committed baseline containing 3,579 nodes, 3,668 links, and 6 hyperedges is replayed
- THEN the ledger substitutes those three measured inputs into the equations
- AND database recounts, distinct projected-ID counts, per-rule drop subtotals, primary outcome counts, rejection and unreached counts, uniqueness checks, and all three residuals are present in the report

#### Scenario: Detect silent loss

- WHEN any input identifier has no stored outcome and no named manifest drop disposition
- THEN it is recorded as rejected or unreached, the relevant conservation residual or successful identifier-set difference is nonzero
- AND the run fails while naming the missing identifiers and the first stage at which they disappeared

#### Scenario: Detect double counting

- WHEN one input link is counted both as a relation outcome and as a reified-link outcome, or is assigned to more than one drop bucket
- THEN the duplicate-disposition check fails even if an aggregate subtraction happens to equal zero

### Requirement: Direction and graph-shape integrity

WHERE `graph.json` declares `directed:false` and `multigraph:false`, the loader SHALL reconstruct traversal direction with `build_from_json(raw, directed=True)` as graphify's path, explain, and serve consumers do. The audit SHALL compare the ordered source-target tuple of every mapped link with its stored relation or reified representation. It SHALL report how many input links descend by endpoint order and SHALL fail as non-discriminating if that count is zero.

#### Scenario: Exercise the non-vacuous direction gate

- WHEN the committed baseline is replayed
- THEN the audit observes 1,465 descending endpoint-order links
- AND any source-target reversal in those links causes the ordered-tuple comparison to fail

#### Scenario: Account for collapsed parallel types

- WHEN the simple-graph artifact has already collapsed parallel typed edges
- THEN the report identifies that limitation as an input-artifact fact
- AND it does not claim to recover edge instances that are absent from `graph.json`

### Requirement: Provenance and audit-level survival

WHEN an input graph element maps to stored data, the stored representation SHALL retain or traceably reference its `source_file`, nullable `source_location`, `confidence_score`, and audit level `EXTRACTED`, `INFERRED`, or `AMBIGUOUS` according to the frozen mapping manifest. The round-trip audit SHALL compare the stored values to `graph.json`, reject undeclared-field workarounds, and record three named spot-check bundles: the `EXTRACTED` node/link bundle from `skills/foreman/SKILL.md`; the `INFERRED` link at input index 1200 from `agents_codex_implementer_evidence_contract` to `agents_grok_implementer_evidence_contract` with score 0.95; and the `AMBIGUOUS` link at input index 3614 from `docs_research_openai_codex_exec_sandbox_policy` to `docs_research_openai_codex_sandbox_page_not_found` with score 0.3. Each bundle SHALL include the input identity, generated database identifier when stored as a document, retrieved values, and originating file.

#### Scenario: Trace the named sample

- WHEN the named `skills/foreman/SKILL.md` sample bundle is retrieved from the local database file
- THEN the report shows an unbroken trace for node `foreman_skill` and its named `contains` link through any generated database identifiers to source locations `L1` and `L14`
- AND the link's retrieved `confidence_score` is 1.0 and its audit level is `EXTRACTED`, equal to `graph.json`

#### Scenario: Preserve inferred and ambiguous levels without rebucketing

- WHEN the named input-index 1200 and 3614 links are audited
- THEN their retrieved audit levels remain `INFERRED` and `AMBIGUOUS` and their scores remain 0.95 and 0.3
- AND the 0.95 `INFERRED` input is not silently reclassified as `EXTRACTED` by numeric score bucketing

#### Scenario: Detect provenance erosion

- WHEN any required provenance field is lost, changed, or no longer traceable after ingest
- THEN the provenance audit fails and names the input element, field, expected value, and retrieved value

### Requirement: Real-graph competency matrix

WHEN ingest has completed, all 24 competency questions owned by `graph-store-port` SHALL be evaluated against the real Foreman graph. Every mapped query SHALL execute; an owner-declared gap with no executable query SHALL be evaluated from its manifest disposition without inventing a query. The report SHALL contain exactly one row per named question with query status, elapsed time, result count, and a classification field. A successfully evaluated row SHALL carry exactly one classification from `answered`, `empty-but-valid`, or `unanswerable`; owner-declared gaps such as K16 and X22 SHALL be `unanswerable` and name the missing capability. A failed or not-run mapped query row SHALL carry no answer classification and SHALL instead name its error or blocking stage, causing the competency stage and overall run to fail or remain incomplete. An `empty-but-valid` result SHALL require a successfully executed query returning zero results; a transport, syntax, schema, timeout, or adapter failure SHALL not be classified as empty or unanswerable. For a completed competency stage, the three classification totals SHALL sum arithmetically to 24; every report, including a partial one, SHALL satisfy `answered + empty-but-valid + unanswerable + failed + not-run = 24`.

#### Scenario: Distinguish zero results from failure

- WHEN a competency query executes successfully and returns zero bindings
- THEN it is recorded as `empty-but-valid` with success evidence and result count zero
- AND the same row cannot be marked `unanswerable` or failed

#### Scenario: Name every unanswerable question

- WHEN the real graph or frozen ontology cannot answer a competency question
- THEN the report names that question and the exact absent evidence or representation
- AND the matrix gate fails if only an aggregate unanswerable count is supplied

#### Scenario: Preserve a failed query as failure

- WHEN a competency query encounters a transport, syntax, schema, timeout, or adapter error
- THEN its row records the error with no answer classification
- AND the report arithmetic counts it as `failed`, not `empty-but-valid` or `unanswerable`

### Requirement: Ontology findings remain findings

IF the real Foreman corpus contains a graph element or property that the frozen 33-object schema and mapping manifest cannot represent, THEN the runner SHALL apply only the manifest-declared drop or fail disposition, record the evidence as an ontology finding, and propose a versioned change to `skills/foreman/ontology/schema.sql`. A fail disposition SHALL be accounted as `rejected` and SHALL fail the run; it SHALL NOT be relabeled as a drop to balance conservation. The dogfood run SHALL NOT add undeclared fields, coerce invalid enum values, conflate distinct relations such as `subtask_of` and `depends_on`, submit caller-selected identifiers for generated-key classes, or silently invent an ingest-only workaround.

#### Scenario: Record a schema gap

- WHEN a real input element cannot be represented by the frozen schema
- THEN the report includes its input identifier, source evidence, attempted mapped class or relation, applicable manifest drop or fail decision, affected counts, and proposed schema change
- AND the frozen schema remains unchanged during that run

#### Scenario: Reject an undeclared-field workaround

- WHEN an ingest attempt tries to preserve a graph property by adding an undeclared field
- THEN schema validation rejects the document and the run reports an ontology finding rather than claiming successful preservation

### Requirement: Measured performance and rebuild baseline

WHEN the pinned dogfood run executes, the runner SHALL measure total and per-stage wall clock, stored document count by class, relation count by type, database disk footprint after ingest, idle resident memory, and insert throughput using explicitly recorded measurement commands and timestamps. It SHALL then time a drop-and-rebuild into the fresh pinned database, repeat the conservation and schema recount gates, and report both ingest passes without treating the previously measured 2.6-second startup, 38 MB idle RSS, 9.7 MB footprint for 5,500 documents, or approximately 1,070 documents per second as current-run results.

#### Scenario: Produce a comparable baseline

- WHEN the first ingest and timed drop-and-rebuild finish
- THEN the report contains the environment, commands, start and end timestamps, wall-clock durations, document counts, disk bytes, idle RSS bytes, and calculated documents-per-second for both passes
- AND the second pass independently satisfies conservation and output recount checks

#### Scenario: Prevent borrowed performance claims

- WHEN any required current-run measurement is missing
- THEN the run cannot report the performance baseline as complete
- AND reference measurements are labeled historical rather than substituted for missing evidence

### Requirement: Honest terminal report

WHILE any pipeline stage is incomplete or failed, the dogfood report SHALL name the first blocking stage, preserve all measurements and partial ledgers obtained before the stop, and mark every unexecuted stage as `not-run`. An observed failed predicate or execution error SHALL take precedence and produce overall result `FAILED`, even though later stages are consequently `not-run`. In the absence of an observed failure, missing required evidence or an unexecuted required stage SHALL produce `INCOMPLETE`. The report SHALL state `PASSED` only when the pinned execution, three conservation equations, identifier uniqueness, provenance samples, 24-row competency matrix, ontology-findings section, first-pass baseline, and timed drop-and-rebuild all contain their required numeric evidence.

#### Scenario: Fail without fabricated success

- WHEN the pipeline stops before all required stages complete
- THEN the report names the stopping condition and records later stages as `not-run`
- AND absence of numbers cannot be represented as zero, empty-but-valid, or success

#### Scenario: Gate a passing report

- WHEN the report is evaluated for release acceptance
- THEN a deterministic gate checks every required section and numeric field
- AND the gate returns success only if every acceptance predicate is present and true
