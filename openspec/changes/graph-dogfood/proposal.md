# Change: graphify-to-SQLite-ontology dogfood

## Why

Foreman v0.2.9 specifies the graph plane across multiple packages, but the real
Foreman corpus has not been exercised end to end through the local SQLite
ontology. This package adds that release exercise: refresh the repository's
real graph, map `graph.json` through a frozen manifest, create a fresh ontology
database from `skills/foreman/ontology/schema.sql`, ingest, query, rebuild, and
publish the evidence.

The measured release-planning baseline is large and irregular enough to expose
defects that fixtures hide: 3,579 nodes, 3,668 links, 6 hyperedges, 380
communities, and 358 represented files out of 471 tracked files. The graph was
built at `d4af3a92`; at the measurement snapshot it was three commits stale and
omitted 26 files. It is a simple undirected artifact whose ordered endpoints
still carry direction; 1,465 links descend by endpoint order. Those values
belong only to that named input and are not silently reused after refresh.

The real relation vocabulary includes `calls`, `contains`, `defines`,
`imports`, `imports_from`, `implements`, `method`, `rationale_for`,
`re_exports`, `conceptually_related_to`, `semantically_similar_to`, and
`shares_data_with`. A frozen mapping must fail closed on an unknown relation
rather than guess. Link provenance includes `source_file`,
`source_location`, `confidence_score`, and the `EXTRACTED` / `INFERRED` /
`AMBIGUOUS` audit level, so a fixture-only pass cannot establish survival.

R8's live TerminusDB evaluation on 2026-07-28 found that the evaluated document
graph could not attach properties to relations; that dated finding motivated
reification. TerminusDB was withdrawn on 2026-07-30 in commit `b3bbdc3`. The
current target is the SQLite ontology, whose declared junction and reified
tables can retain only shapes represented by `schema.sql`; everything else
must become a counted finding, never an ingest-local workaround.

The deliverable is evidence, not another implementation of graph refresh, the
schema, the adapter, the query suite, or falsification policy. A failed run with
a complete ledger and named blocking seam is valid dogfood evidence. A claimed
success without the counts is not.

## What changes

- Add a reproducible dogfood run over the Foreman repository at a named clean
  commit, recording the graph build commit and replay staleness separately.
- Compose existing owners in order: `knowledge-plane-refresh` produces the
  graph; `skills/foreman/ontology/schema.sql` supplies the pinned ontology;
  the SQLite ontology adapter maps and ingests; the permanent 24-entry SQL
  competency suite queries; and `graph-eval-falsification` owns kill decisions.
- Require a fresh local database file created from the exact schema whose
  SHA-256 is
  `1a7c15a97fe594a07746d285a9e14b3a0820b3386c40c0206d55389f7a6eb76f`.
  The adapter verifies that hash before use.
- Require `graphify-out/graph.json` as the sole graph ingest source. No Cypher,
  graph-database, GraphML, or visualization export is admissible.
- Produce one primary disposition for every input plus exact arithmetic and set
  conservation for nodes, links, and hyperedges. Rejected and unreached inputs
  balance partial evidence but cannot pass conservation.
- Recount the SQLite database directly after ingest, including base rows,
  junction rows, reified rows, returned integer identities, lexical keys, and
  every named drop subtotal.
- Reconstruct direction with graphify's consumer path, compare exact ordered
  endpoint tuples, and require a nonzero descending-endpoint population.
- Round-trip named real provenance witnesses for all three audit levels or emit
  a counted ontology finding when the pinned schema cannot represent them.
- Evaluate all 24 competency entries through parameterised SQL and the
  expected-emptiness wrapper, preserving answered, empty-but-valid,
  unanswerable, failed, and not-run as distinct states.
- Record unrepresentable real shapes as proposed, versioned changes to
  `schema.sql` and its adapter mapping; never mutate the pinned schema during a
  run.
- Measure stage and total wall clock, database rows and bytes, adapter process
  RSS, ingest throughput, integrity checks, and a timed drop-and-rebuild.
- Emit `PASSED`, `FAILED`, or `INCOMPLETE` from a deterministic evidence gate.
  Missing measurements remain missing and are never replaced with zero.

## Impact

- **New capability delta:** `dogfood`, the release exercise and evidence
  contract for the real graphify-to-SQLite-ontology path.
- **Intended implementation surfaces:**
  `skills/foreman/scripts/graph-dogfood.sh`,
  `skills/foreman/scripts/graph-dogfood-gate.sh`,
  `tests/graph-dogfood.bats`, and run-scoped evidence beneath
  `artifacts/graph-dogfood/<run-id>/`.
- **Depends on, but does not redefine:** `knowledge-plane-refresh`, the pinned
  `schema.sql`, the SQLite ontology adapter and SQL competency suite from
  `graph-store-port`, and `graph-eval-falsification`.
- The exercise is expected to create ontology findings. The current real graph
  is not assumed to ingest successfully.
- No schema migration is authorised by dogfood. Findings require a human
  review, schema version change, new hash pin, and the normal migration or
  rebuild gate.
- The package adds no graph generator, synthetic corpus, alternate adapter,
  schema definition, query definition, refresh cadence, or kill criterion.
- Authoring this package reads the committed `graph.json`; it does not refresh
  or regenerate the graph.
