# Design: graphify-to-SQLite-ontology dogfood

## Approach

The dogfood run is a thin orchestrator plus an evidence ledger. It calls each
owner through its published interface, snapshots the result, and judges only
end-to-end properties no owner proves alone. Every claim must be reproducible
from machine-readable evidence rather than log prose.

### Ownership boundaries

| Concern | Owner consumed by this package | Dogfood responsibility |
|---|---|---|
| Graph production, freshness, version pin, endpoint-order direction | `knowledge-plane-refresh` | Invoke at the named commit and record artifact plus metadata |
| Store-enforced ontology | `skills/foreman/ontology/schema.sql` | Verify the pinned hash; never edit it during a run |
| Mapping, two-pass ingest, lexical/integer identity, transactions | SQLite ontology adapter from `graph-store-port` | Capture classifications, dispositions, returned identities, and failures |
| Guarded traversals and 24 competency entries | SQLite ontology adapter and permanent SQL suite | Execute parameterised SQL and preserve results |
| Kill criteria and off-switch decisions | `graph-eval-falsification` | Link evidence as input; do not redefine kill policy |

The package does not duplicate fixture suites from those owners. Its tests
exercise orchestration, ledger arithmetic, evidence completeness, and honest
failure over the real corpus.

### Historical context

R8 evaluated TerminusDB 12.0.6 live on 2026-07-28. Its measured lack of edge
properties motivated relation reification, and its silent-empty query findings
motivated the expected-emptiness wrapper. On 2026-07-30, commit `b3bbdc3`
withdrew TerminusDB; those findings remain dated design evidence and are not a
current deployment instruction.

The withdrawn operations package made all 24 competency questions a permanent
CI suite, and the withdrawn schema gate required positive acceptance,
invalid-enum rejection, undeclared-field rejection, and drop/rebuild identity.
This dogfood run consumes the SQL versions of those guards without depending on
an archived package.

### Run identity and immutable evidence

Every run receives a unique `run_id` and writes only beneath
`artifacts/graph-dogfood/<run-id>/`. Before database mutation it records:

- repository commit and dirty state;
- tracked, represented, and unrepresented file sets;
- graph path, SHA-256, `built_at_commit`, graphify version, and refresh cadence;
- schema path, pinned and observed SHA-256, ontology version, and mapping
  `manifest_version`;
- SQLite runtime version and required pragma values;
- raw input counts and timestamps for each stage.

The pinned schema hash is
`1a7c15a97fe594a07746d285a9e14b3a0820b3386c40c0206d55389f7a6eb76f`.
A mismatch stops before database use.

A release run uses a named clean Foreman commit. A baseline replay may use the
committed graph but must identify `d4af3a92` as its build commit rather than
pretending it was built at replay time.

The run directory contains:

- `run-manifest.json`: immutable identity, pins, hashes, stage state, timing;
- `graph.json` and refresh metadata: exact graph input and freshness evidence;
- `input-dispositions.ndjson`: one primary disposition per input;
- `counts.json`: input/output counts, drops, SQLite recounts, residuals;
- `competency-results.json`: exactly 24 named SQL/gap outcomes;
- `provenance-samples.json`: input-to-row-ID/to-lexical-key/to-source traces;
- `ontology-findings.json`: evidence and proposed versioned changes;
- `metrics.json`: open, ingest, RSS, database bytes, integrity, rebuild;
- `report.md`: a human rendering of those machine-readable files.

The report is derived evidence, not an independent source of truth.

### Pipeline

1. **Preflight.** Verify a clean named commit, owner gates, required commands,
   exact schema hash, manifest hash, SQLite runtime, and pragma support. Any
   mismatch stops before database creation.
2. **Refresh and snapshot.** Invoke the owner refresh and copy its exact
   `graph.json` plus metadata into the run directory. Ingest never reads an
   exporter output.
3. **Parse directionally.** Load through `build_from_json(raw, directed=True)`,
   retain array ordinals, and enumerate node IDs, link keys, and top-level
   hyperedge IDs. The duplicate `graph.hyperedges` value is metadata, not a
   second conserved input.
4. **Classify before writing.** Apply only the frozen manifest and adapter
   classifiers. Unknown shapes become `rejected`; inputs after a blocker become
   `unreached`. Neither state can pass conservation.
5. **Create a fresh ontology database.** Apply the exact pinned `schema.sql` to
   a new run-scoped file, enable and verify foreign keys and WAL, read back
   schema metadata, and run the positive/negative schema controls.
6. **Two-pass ingest.** Use the unchanged SQLite ontology adapter. Write base
   rows before junction/reified rows in atomic batches and record returned
   integer IDs plus lexical keys. A failure preserves the ledger, rolls back
   the active batch, and marks later stages `not-run`.
7. **Round-trip audit.** Recount tables directly from SQLite, reconcile them to
   successful dispositions, evaluate conservation, compare ordered endpoint
   tuples, run lint views and integrity checks, and retrieve named provenance
   witnesses.
8. **Competency matrix.** Evaluate all 24 permanent entries. Every mapped SQL
   query runs through the expected-emptiness wrapper; declared gaps remain
   `unanswerable`. SQL errors remain failures, never empty answers.
9. **Ontology findings.** Convert each unrepresentable shape into a finding
   with exact input, source, manifest decision, impact count, and proposed
   versioned schema/mapping change. Do not retry with a local table or column.
10. **Measure rebuild.** Record first-pass metrics, delete only the run-scoped
    database, recreate it from the pinned schema and input, and repeat recount,
    integrity, conservation, provenance, and competency checks.
11. **Render and gate.** Render the report from evidence. Emit `PASSED` only
    with complete numeric evidence; otherwise emit `FAILED` or `INCOMPLETE`.

### SQLite schema checks

The dogfood run treats `schema.sql` as executable ontology, not documentation.
Before ingest it proves:

- a conforming row is accepted;
- an invalid enum is rejected;
- an undeclared property is rejected by the adapter before SQL;
- `node_kind(kind, plane)` rejects a cross-plane kind;
- lexical duplicate keys are rejected;
- supersession requires attributes and one successor;
- lint views are empty on clean data;
- guarded traversal views terminate on cycle fixtures;
- `claim_head.still_superseded` is interpreted rather than ignored.

These complement, and do not replace, the 18 checks in
`skills/foreman/ontology/test_ontology.py`.

### Arithmetic conservation

Conservation combines cardinality arithmetic and exact set partitioning.
Aggregate equality alone can conceal one missing and one duplicated input.

`node_residual = input_nodes - stored_node_primary_outcomes - sum(node_drops_by_rule)`

`link_residual = input_links - relation_outcomes - reified_link_outcomes - sum(link_drops_by_rule)`

`hyperedge_residual = input_hyperedges - stored_hyperedge_outcomes - sum(hyperedge_drops_by_rule)`

Each residual must be zero for a pass. Independently,
`input = stored + named-drop + rejected + unreached` must balance even for a
partial run. Passing requires `rejected = 0`, `unreached = 0`, and the exact
successful disjoint partition `input = stored disjoint-union named-drop`.

Several node inputs may map to one lexical ontology entity; therefore primary
outcomes are counted per input while distinct lexical keys, integer row IDs,
and database rows are recounted separately. Junction or reified rows are
auxiliary outputs unless the manifest declares them the primary relation
outcome. Unknown rules, unexplained key collisions, missing or duplicate keys,
and recount mismatches fail independently.

The committed baseline substitutes 3,579, 3,668, and 6 on the left sides.
Those operands are never carried into a refreshed run.

### Direction check

The artifact's `directed:false` is observational. Direction is the ordered
source/target tuple restored by graphify consumers. The audit compares every
stored relation or declared reified relation with its exact input tuple and
requires a nonzero descending-endpoint population. The baseline expects 1,465.

The simple graph may already have collapsed parallel typed edges. That is
recorded as pre-ingest input loss; the SQLite ontology is not credited or
blamed for restoring absent inputs.

### Provenance check

Named witnesses remain:

- node `foreman_skill`, from `skills/foreman/SKILL.md` at `L1`;
- its exact `contains` link at `L14`, audit level `EXTRACTED`, score 1.0;
- link input index 1200, `shares_data_with`, audit level `INFERRED`, score 0.95;
- link input index 3614, `conceptually_related_to`, audit level `AMBIGUOUS`,
  score 0.3.

R8's 2026-07-28 TerminusDB test exposed the harder provenance case because the
evaluated store's relations could not carry fields. The current SQLite schema
uses declared junction or reified tables where available, but it has no license
to invent a generic provenance-link table. If the pinned schema cannot retain a
witness, the result is a counted ontology finding plus failed/incomplete status,
never an undeclared column or local side table.

The audit also reports population-level mismatches for `source_file`, nullable
`source_location`, `confidence_score`, and explicit audit level. Numeric score
never rebuckets the explicit level.

### Competency outcomes

`competency-results.json` has one row for each ID `Q-W1` through `Q-W13`,
`Q-K14` through `Q-K20`, and `Q-X21` through `Q-X24`. Every row records SQL or
gap identity, execution status, elapsed time, row count, expected emptiness,
and classification.

Successful rows receive exactly one of:

- `answered`: SQL succeeded with a valid nonempty result;
- `empty-but-valid`: SQL succeeded, permitted emptiness, and returned zero;
- `unanswerable`: the named entry is an explicit ontology/data gap.

Failed and not-run rows have no answer classification. A completed stage
requires `answered + empty-but-valid + unanswerable = 24`; every report also
requires `answered + empty-but-valid + unanswerable + failed + not-run = 24`.

K16 and X22 retain their gap status, W4 remains partial, and W6, W13, and X23
report whether same-release dependencies are present. Dogfood observes these
dispositions and does not redefine them.

### Current real-data findings to test first

1. The graph's node types do not map one-for-one to the ontology's declared
   tables and required columns. Missing reviewed defaults should fail mapping.
2. Most real relation names are absent from the current schema. Classification
   should reject them rather than conflate them.
3. General graph-link provenance has no declared table in the pinned schema.
4. All six baseline hyperedges require a named manifest outcome and evidence
   for a future reviewed representation.

These become proposed versioned changes only after measured confirmation. The
dogfood runner never patches `schema.sql` in place.

## Rejected alternatives

### Declare success from exit codes

Rejected. Exit zero does not prove that counts, integrity, or round-trip
evidence exists.

### Use fixture counts as end-to-end proof

Rejected. Fixtures omit the real relation vocabulary, provenance, coverage
drift, communities, and hyperedges.

### Ingest through an exporter

Rejected. Exporters lose audit fields, communities, hyperedges, or build
metadata before SQLite receives them.

### Compare aggregate counts only

Rejected. Equal totals can hide paired loss and duplication.

### Patch the schema or coerce data until ingest succeeds

Rejected. The pinned schema is under test; a local workaround erases the
finding and breaks reproducibility.

### Query SQLite directly from the runner

Rejected except for independent audit recounts and integrity inspection. All
production mapping, writes, and competency queries must use the published
adapter so dogfood cannot pass while production behavior is broken.

## Risks

- **The run stops during node mapping.** Preserve the complete pre-write ledger
  and exact error.
- **The run stops on an unknown relation.** Fail closed and aggregate the real
  vocabulary into a proposed mapping/schema revision.
- **A refreshed graph changes baseline counts.** Bind all expectations to the
  exact graph hash and record new operands.
- **Integer row IDs obscure graph input identity.** Record input ID, lexical
  key, and adapter-returned row ID together.
- **The simple graph already lost parallel typed edges.** State that
  pre-ingest limitation explicitly.
- **A SQL query returns a wrong empty answer.** Preserve the expected-emptiness
  wrapper and separate execution success from row count.
- **A cycle guard is bypassed.** Require shipped traversal views and interpret
  `still_superseded`.
- **Partial evidence is mistaken for a pass.** Observed failure wins as
  `FAILED`; otherwise missing required evidence yields `INCOMPLETE`.
- **Dogfood drifts into owner implementation.** Pin interface/schema hashes and
  route every change proposal back through normal human review.
