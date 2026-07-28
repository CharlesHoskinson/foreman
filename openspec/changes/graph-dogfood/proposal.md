# Change: graphify-to-TerminusDB dogfood

## Why

Foreman v0.2.9 "Total GeorgeCall" specifies the graph plane across multiple
packages, but the TerminusDB path is proven only with fixtures. This package
adds the missing end-to-end release exercise: use the Foreman repository as the
corpus, refresh its real graph, map the resulting `graph.json` through the
frozen manifest, ingest it into a fresh pinned TerminusDB, query it, rebuild it,
and publish the numbers.

The measured release-planning baseline is large and irregular enough to expose
defects that small fixtures hide: 3,579 nodes, 3,668 links, 6 hyperedges, 380
communities, and 358 represented files out of 471 tracked files. The graph
artifact was built at `d4af3a92`; at the measurement snapshot it was three
commits stale and omitted 26 files entirely. It is a simple undirected artifact
whose ordered endpoints still carry direction; 1,465 links descend by endpoint
order. These values describe that named snapshot and are not silently reused
after the repository evolves.

Inspection of the real artifact already shows why this package is necessary.
Its relation vocabulary includes `calls`, `contains`, `defines`, `imports`,
`imports_from`, `implements`, `method`, `rationale_for`, `re_exports`,
`conceptually_related_to`, `semantically_similar_to`, and
`shares_data_with`; manifest v1 does not declare those relations and correctly
requires the adapter to fail closed rather than guess. Link provenance also
contains `source_file`, `source_location`, `confidence_score`, and the
`EXTRACTED` / `INFERRED` / `AMBIGUOUS` audit level, while TerminusDB has no edge
properties. A fixture-only pass cannot establish that those real shapes survive.

The deliverable is therefore an evidence-producing exercise, not another
implementation of the schema, adapter, refresh, operations, or falsification
packages. A failed run with a counted ledger and a named blocking seam is valid
dogfood evidence. A claimed success without the counts is not.

## What changes

- Add a reproducible dogfood run over the Foreman repository at a named clean
  commit, with the graph build commit and any replay staleness recorded
  separately.
- Orchestrate the existing owners in order:
  `knowledge-plane-refresh` produces the graph,
  `terminusdb-schema` supplies schema and manifest,
  `terminusdb-adapter` maps and ingests it,
  `terminusdb-operations` supplies the pinned deployment, rebuild, and 24-entry
  competency manifest with mapped queries or declared gaps, and
  `graph-eval-falsification` remains the owner of kill decisions.
- Require `graphify-out/graph.json` as the sole ingest source. No Neo4j,
  FalkorDB, Cypher, GraphML, or visualization export is an admissible
  intermediate.
- Produce a per-input disposition ledger and three arithmetic conservation
  equations for nodes, links, and hyperedges. Each input has exactly one
  primary stored, named-drop, rejected, or unreached accounting outcome;
  conservation passes only when rejected and unreached are zero. Duplicate and
  missing dispositions fail independently of aggregate totals.
- Recount the database after ingest and report nodes in, top-level and
  auxiliary documents out, links in, relation outcomes out, reified outcomes
  out, hyperedges in, and every drop subtotal by manifest rule.
- Reconstruct direction with the consumer path owned by
  `knowledge-plane-refresh`, compare ordered endpoint tuples, and require a
  nonzero descending-endpoint population so the direction gate can
  discriminate.
- Round-trip named real provenance witnesses for all three audit levels:
  the `EXTRACTED` bundle from `skills/foreman/SKILL.md`, the input-index 1200
  `INFERRED` link, and the input-index 3614 `AMBIGUOUS` link.
- Evaluate all 24 operations-owned competency entries, invoke every mapped
  query, and classify every successfully evaluated row as `answered`,
  `empty-but-valid`, or `unanswerable`, with declared gaps and successful
  zero-row queries kept distinct from query failures.
- Record unrepresentable real shapes as proposed versioned changes to
  `terminusdb-schema`; do not mutate the frozen schema or add ingest-only
  workarounds.
- Measure stage and total wall clock, document counts, disk footprint, idle RSS,
  throughput, and a timed drop-and-rebuild against the pinned TerminusDB
  instance.
- Emit `PASSED`, `FAILED`, or `INCOMPLETE` from a deterministic evidence gate.
  Missing measurements are missing, never zero.

## Impact

- New capability delta: `dogfood`, the release exercise and evidence contract
  for the real graphify-to-TerminusDB path.
- Intended implementation surfaces:
  `skills/foreman/scripts/graph-dogfood.sh`,
  `skills/foreman/scripts/graph-dogfood-gate.sh`,
  `tests/graph-dogfood.bats`, and run-scoped evidence under
  `artifacts/graph-dogfood/<run-id>/`.
- Depends on, but does not redefine:
  `openspec/changes/terminusdb-schema/`,
  `openspec/changes/terminusdb-adapter/`,
  `openspec/changes/terminusdb-operations/`,
  `openspec/changes/knowledge-plane-refresh/`, and
  `openspec/changes/graph-eval-falsification/`.
- The exercise is expected to create schema findings. Manifest v1's unknown
  relation fail-closed behavior means the current real graph is not assumed to
  ingest successfully.
- No production schema migration is authorized by a dogfood run. Findings are
  proposed back to the owning package and require its normal human review and
  version bump.
- The package adds no graph generator, synthetic corpus, database adapter, query
  implementation, deployment definition, refresh cadence, or kill criterion.
- Authoring this package reads the already committed
  `graphify-out/graph.json`; it does not refresh or regenerate the graph.
