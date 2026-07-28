# Design: graphify-to-TerminusDB dogfood

## Approach

The dogfood run is a thin orchestrator plus an evidence ledger. It calls each
owner package through its published interface, snapshots what happened, and
judges only the end-to-end properties that no owner can prove in isolation.
The central design choice is to make every claim reproducible from
machine-readable evidence rather than from log prose.

### Ownership boundaries

| Concern | Owner consumed by this package | Dogfood responsibility |
|---|---|---|
| Graph production, freshness, version pin, endpoint-order direction gate | `knowledge-plane-refresh` | Invoke it at the named run commit and record its artifact and metadata |
| Frozen 33-object schema and manifest v1 | `terminusdb-schema` | Pin their hashes/versions, never edit them during a run |
| HTTP client, generated-key handling, two-pass ingest, reification classification, idempotent upsert | `terminusdb-adapter` | Capture inputs, adapter dispositions, returned identifiers, and failures |
| TerminusDB deployment, 24 queries, monitoring measurements, drop-and-rebuild | `terminusdb-operations` | Execute the published operations and preserve their results |
| Kill criteria and off-switch decisions | `graph-eval-falsification` | Link dogfood evidence as input; do not evaluate or redefine kill policy |

This package does not duplicate fixture suites from those owners. Its tests
exercise orchestration, ledger arithmetic, evidence completeness, and honest
failure using the real corpus.

### Run identity and immutable evidence

Every run receives a unique `run_id` and writes only beneath
`artifacts/graph-dogfood/<run-id>/`. Before any database write, it records:

- repository commit and dirty status;
- tracked-file count and represented/unrepresented file lists;
- graph path, SHA-256, `built_at_commit`, graphify version and refresh cadence;
- schema content hash and mapping `manifest_version`;
- TerminusDB version and image digest;
- raw input counts and timestamps for each stage.

The release exercise runs at a named clean Foreman commit. The refresh procedure
is the one owned by `knowledge-plane-refresh`; the orchestrator does not call
graphify internals. A baseline replay may use the already committed graph, but
must identify `d4af3a92` as the graph build commit rather than pretending it was
built at the replay commit. The authoring of this OpenSpec package is such a
read-only inspection and performs no refresh.

The run directory contains:

- `run-manifest.json`: immutable identity, pins, hashes, stage state and timing;
- `graph.json` and refresh metadata: immutable copies of the exact graph input
  and the owner-produced freshness/version evidence;
- `input-dispositions.ndjson`: one primary disposition per input element;
- `counts.json`: input, output, drop subtotals, database recounts and residuals;
- `competency-results.json`: exactly 24 named query outcomes;
- `provenance-samples.json`: input-to-generated-ID-to-source traces;
- `ontology-findings.json`: evidence and proposed owner-package changes;
- `metrics.json`: startup, ingest, RSS, disk and rebuild measurements;
- `report.md`: human-readable rendering of the same evidence.

The report is derived from those files. It is not an independent source of
truth.

### Pipeline

1. **Preflight.** Verify a clean named commit, owner-package gates, required
   commands, schema/manifest hashes, and exact TerminusDB pin. A mismatch stops
   before writes.
2. **Refresh and snapshot.** Invoke the owner refresh, capture the resulting
   `graph.json` and refresh metadata, and copy the exact artifact into the run
   evidence directory. Ingest never reads an exporter output.
3. **Parse directionally.** Load via `build_from_json(raw, directed=True)`,
   retain input array ordinals, and enumerate node IDs, link keys, and
   top-level `hyperedges` IDs. Link key is the zero-based `links` array index
   plus its ordered `(source, target, relation)` tuple; this remains unique even
   though links have no explicit IDs. The duplicate convenience copy under
   `graph.hyperedges` is metadata, not a second conserved input array.
4. **Classify before writing.** Apply the frozen manifest and adapter
   classifiers to every input. Unknown shapes receive a `rejected` accounting
   disposition with the owner-defined `fail` reason and stop at that boundary.
   Inputs not reached after the blocker receive `unreached`. Neither outcome is
   accepted conservation, and no dogfood-local mapping is allowed.
5. **Start fresh store and load schema.** Use the deployment procedure owned by
   operations, verify version and digest, load/read back the schema, and record
   startup, RSS, and initial disk measurements.
6. **Two-pass ingest.** Use the adapter unchanged. Record returned generated
   document identifiers; never submit graphify IDs as TerminusDB `@id` values.
   On failure, close the current stage, preserve the partial ledger, mark later
   stages `not-run`, and render an honest report.
7. **Round-trip audit.** Recount stored classes and relations from the database,
   reconcile them against successful adapter outcomes, evaluate conservation,
   compare ordered endpoint tuples, and retrieve the named provenance sample.
8. **Competency matrix.** Evaluate all 24 operations-owned manifest entries,
   invoking every mapped query through its expected-emptiness wrapper and
   evaluating declared gaps without inventing queries. Transport/query errors
   remain failures; successful zero-row results become `empty-but-valid`;
   declared ontology gaps become `unanswerable` and name the missing capability.
9. **Ontology findings.** Convert every representational failure into a finding
   containing the exact input, source, manifest decision, impact count, and a
   proposed schema/manifest revision. Do not retry with a local workaround.
10. **Measure rebuild.** Capture first-pass metrics, drop and rebuild via the
    operations/adapter interfaces, repeat database recount and conservation,
    and compare pre-drop and post-rebuild query classifications.
11. **Render and gate.** Produce the report from evidence and evaluate all
    required predicates. The gate emits `PASSED` only with complete numeric
    evidence; otherwise it emits `FAILED` or `INCOMPLETE`.

### Arithmetic conservation

Conservation is both cardinality arithmetic and exact set partitioning.
Aggregate equality alone can conceal one missing input and one duplicated input.

For nodes, primary outcomes are counted per input even when several manifest
keys project onto the same generated database document:

`node_residual = input_nodes - stored_node_primary_outcomes - sum(node_drops_by_rule)`

For links:

`link_residual = input_links - relation_outcomes - reified_link_outcomes - sum(link_drops_by_rule)`

For hyperedges:

`hyperedge_residual = input_hyperedges - stored_hyperedge_outcomes - sum(hyperedge_drops_by_rule)`

Each conservation residual must be zero for a passing run. Separately, the
accounting identity

`input = stored + named-drop + rejected + unreached`

must balance even for a failed or partial run. Passing conservation requires
both `rejected = 0` and `unreached = 0`. In addition:

`input_keys = stored_primary_keys disjoint-union dropped_keys_by_named_rule`

is checked independently for each element kind. A link that produces a native
relation and an auxiliary provenance document still has one manifest-declared
primary outcome; auxiliary outputs are counted in `documents_out` but not as a
second conserved input. For nodes, `input_key -> returned_db_id` is recorded;
the database document recount is compared to the distinct projected-ID set,
not to the number of primary input outcomes. Unknown rule names, unexplained
projected-ID collisions, missing keys, duplicate keys, and recount mismatches
each fail with their own diagnostic.

For the committed baseline, `counts.json` must show the literal substitutions
3,579, 3,668, and 6 on the left sides. Those values are not silently carried
forward after a refresh changes the corpus.

### Direction check

The artifact's `directed:false` is observational. Direction is the ordered
source-target tuple restored by graphify and loaded through
`build_from_json(raw, directed=True)`. The audit compares every stored primary
link outcome with its exact input tuple. It also counts descending endpoint
pairs and refuses to call the test discriminating if the count is zero. The
baseline expectation is 1,465 descending links.

This does not promise to recover parallel typed edges already collapsed by the
simple graph. That limitation is recorded as input loss before TerminusDB, not
as a successful store round trip.

### Provenance check

The named sample witnesses are deliberately real:

- node `foreman_skill`, a `document` from `skills/foreman/SKILL.md` at `L1`;
- link index selected by the exact tuple
  `foreman_skill` -> `foreman_skill_foreman_architect_worker_orchestration`,
  relation `contains`, from the same file at `L14`, audit level `EXTRACTED`,
  `confidence_score` 1.0.
- link input index 1200, relation `shares_data_with`, from
  `agents/codex-implementer.md`, with nullable source location, audit level
  `INFERRED`, and `confidence_score` 0.95;
- link input index 3614, relation `conceptually_related_to`, from
  `docs/research/openai_codex_sandbox.txt`, with nullable source location,
  audit level `AMBIGUOUS`, and `confidence_score` 0.3.

The node tests input-ID to generated-ID to source traceability. The links test
the harder case: TerminusDB has no edge properties, so retaining its file,
location, numeric confidence, and audit level requires a schema-declared
representation. If the frozen manifest cannot represent it, the expected result
is an ontology finding and a failed/incomplete run, never an undeclared field or
an invented edge document. The `INFERRED` 0.95 witness additionally detects the
manifest rule that would rebucket a high numeric score as `extracted` despite
the input's explicit audit level.

The audit also reports population-level mismatches for `source_file`,
`source_location`, `confidence_score`, and audit level. The sample is a
human-readable witness, not a substitute for the full comparison.

### Competency outcome model

`competency-results.json` has one row for each operations-owned ID `Q-W1`
through `Q-W13`, `Q-K14` through `Q-K20`, and `Q-X21` through `Q-X24`.
Every row records execution status, elapsed time, result count, expected
emptiness contract, and a classification field. Successfully evaluated rows
receive exactly one dogfood classification:

- `answered`: query executed successfully and returned a valid nonempty answer;
- `empty-but-valid`: query executed successfully, its contract permits zero
  rows, and it returned zero;
- `unanswerable`: the named query cannot be executed against this real graph
  because required data or ontology is absent.

Every mapped query executes. K16 and X22 have owner-declared gap entries rather
than executable queries; evaluating those entries yields `unanswerable` without
inventing a query. For a completed competency stage, the three classification
totals must sum to 24. Query transport, syntax, schema, timeout, and wrapper
failures receive a null classification plus a named error and prevent
completion; not-run rows likewise remain unclassified. Every report also checks
`answered + empty-but-valid + unanswerable + failed + not-run = 24`, so partial
execution cannot lose a question or force it into a false answer category.

Known owner-package dispositions remain visible: K16 and X22 are frozen/deferred
gaps, W4 is partial, and W6, W13, and X23 have same-release dependencies.
Dogfood reports what the real corpus does with those dispositions; it does not
change them.

### Current real-data findings to test first

The package is designed to expose, not pre-fix, these observed seams:

1. The graph's four node `file_type` values are covered by manifest v1, but the
   manifest's Source mapping does not state defaults for required inherited
   `GraphNode.created_at` / `GraphNode.labels` or required `Source.origin`.
   Unless the adapter supplies schema-owned values through an already-reviewed
   rule, node pass 1 should fail schema validation.
2. The first real link is `rationale_for`, and most observed real relation names
   are absent from manifest v1. The adapter should fail closed at relation
   classification rather than ingesting a guessed relation.
3. Plain TerminusDB relations cannot carry the provenance present on real
   graphify links. Manifest v1 names no general reified link-provenance class.
4. All six baseline hyperedges are explicitly `drop-with-record` in manifest
   v1. Conservation can balance, but the corpus supplies direct evidence for a
   future reified hyperedge/community design.

These are proposed schema changes only after the run confirms them. The dogfood
orchestrator never patches the frozen ontology in place.

## Rejected alternatives

### Declare success from stage exit codes

Rejected. An exit code proves only that a process returned; it does not prove
that the report, counts, or round-trip evidence exists. File presence, schema
validation, numeric fields, and arithmetic predicates are gate inputs.

### Use fixture counts as the end-to-end proof

Rejected. Fixtures have already passed and do not contain the real relation
vocabulary, provenance-bearing links, coverage drift, communities, or
hyperedges this exercise exists to test.

### Ingest through the Neo4j or Cypher exporter

Rejected. That path loses source provenance, numeric confidence, communities,
hyperedges, and build metadata before TerminusDB sees them. Conservation after
such a transform would certify a lossy input.

### Compare aggregate counts only

Rejected. Equal totals can hide a missing input paired with a duplicate. Exact
identifier partitions and database recounts accompany the equations.

### Patch the schema or coerce data until ingest succeeds

Rejected. The frozen schema is the thing under test. A local workaround erases
the ontology finding and makes the exercise non-reproducible.

### Trust `directed:true` as the direction gate

Rejected. The real artifact correctly declares `directed:false`; ordered
endpoints carry direction. Requiring the field would reject every valid
graphify CLI artifact and still would not compare stored edge orientation.

### Reimplement owner-package behavior in the dogfood runner

Rejected. A second mapper, ingest client, query suite, refresh path, or rebuild
procedure could pass while production code remains broken. The runner composes
published owner interfaces only.

## Risks

- **The run stops during node pass 1.** This is likely given required schema
  fields absent from manifest defaults. Mitigation: preserve a complete
  pre-write classification ledger and publish the exact validation error.
- **The run reaches link pass and stops on `rationale_for` or `contains`.**
  Mitigation: fail closed and aggregate the unsupported real vocabulary into
  one proposed manifest revision, without guessing semantics.
- **A refreshed graph changes all baseline counts.** Mitigation: baseline
  numbers apply only to replay of hash-identified input; every release run
  records fresh left-hand operands.
- **Generated TerminusDB keys obscure input identity.** Mitigation: record the
  adapter-returned ID mapping in the sidecar ledger and never submit an `@id`.
- **The simple graph already lost parallel typed edges.** Mitigation: state the
  pre-ingest limitation and do not charge TerminusDB with restoring absent
  inputs.
- **A query returns HTTP success with the wrong empty answer.** Mitigation:
  preserve the operations package's expected-emptiness wrappers and record
  execution success separately from result count.
- **Partial evidence is mistaken for a pass.** Mitigation: an observed failure
  takes precedence as `FAILED`; without one, unrun stages or absent evidence
  produce `INCOMPLETE`; the final deterministic gate requires every specified
  artifact and predicate for `PASSED`.
- **The dogfood package drifts into sibling ownership.** Mitigation: pin owner
  interface versions/hashes and route every required change back to the owner
  package rather than implementing it locally.
