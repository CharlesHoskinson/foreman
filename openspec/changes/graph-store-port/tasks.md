# Tasks — graph-store-port

Ordering note: commit `933c308` already landed the port, files-only backend,
named errors, and 18-case backend-neutral contract suite. Completed checkboxes
below identify that shipped foundation. The remaining work extends it; no task
reimplements or replaces it.

Precondition: GP-3 supplies a fresh, directed, version-stamped `graph.json` and
GP-4 supplies `worklog.jsonl`. Neither is built here.

## T1 — retain and harden the landed GraphStore port

- [x] Define the `GraphStore` port with schema registration, deterministic
      upsert, typed lookup, named lineage queries, optional capabilities, and
      the expected-emptiness contract.
- [x] Keep backend-specific concepts out of the required argument surface.
- [x] Ship the files-only backend, named errors, and a backend-neutral
      conformance suite with a deliberately broken negative-control backend.
- [ ] Add a repository gate proving Foreman core issues no SQL against the
      ontology and opens no ontology database outside the SQLite ontology
      adapter or its tests.
- [ ] Run the existing suite unchanged against both files-only and the SQLite
      ontology adapter; backend-specific tests may add assertions but may not
      waive shared ones.

## T2 — pin and discriminate the authoritative SQLite schema

- [ ] Pin `skills/foreman/ontology/schema.sql` at SHA-256
      `1a7c15a97fe594a07746d285a9e14b3a0820b3386c40c0206d55389f7a6eb76f`.
- [ ] Verify each connection enables and reads back `PRAGMA foreign_keys=ON`
      before any data access.
- [ ] Prove `node_kind(kind, plane)` rejects cross-plane kinds rather than
      relying on an adapter-only check.
- [ ] Prove all enum `CHECK` constraints reject an out-of-domain value and all
      lexical `UNIQUE` keys reject a duplicate.
- [ ] Prove set-valued relations use their declared junction tables and cannot
      create self-links where the schema forbids them.
- [ ] Prove `supersession` retains `at` and `reason`, rejects blank reasons and
      self-links, and permits at most one successor per old node.
- [ ] Add negative controls for every lint view; a seeded violation must make
      its view nonempty and a clean database must return zero rows.
- [ ] Add cycle fixtures for `claim_head` and
      `claim_contradiction_reach`; both queries must terminate.
- [ ] Assert every `claim_head` consumer checks `still_superseded` before
      treating `head_key` as current.
- [ ] Retain relational representations for `Task`, `Round`, `Attempt`,
      `AgentRun`, `Agent`, `Artifact`, `Spec`, `Source`, and `Evaluation`; do
      not claim full adapter conformance while a required type is absent.
- [ ] Keep `HAS_ATTEMPT`, `SUBTASK_OF`, and `BROADER_THAN` distinct and check
      the latter two for cycles.
- [ ] Model `EVALUATES` as exactly one target from `Attempt`, `Artifact`, or
      `Claim`; add a two-target rejection test.
- [ ] Make `RESOLVED_TO` functional and acyclic and retain its provenance and
      reviewer in the declared relational representation.
- [ ] Check `DEPENDS_ON` acyclicity and keep `DERIVED_FROM`, `REVISES`, and
      `SUPERSEDES` mutually exclusive on each ordered pair.
- [ ] Keep `MENTIONS` a derived index excluded from model context; measure its
      share of the real graph and record which competency questions degrade
      without it.
- [ ] Require every LLM-populated field to use a closed enum or reference; no
      free float or open string.
- [ ] Keep `Claim`, `Evaluation`, `Finding`, and `Source` independently
      addressable rather than cascade-owned subrecords.
- [ ] Prohibit a relation from being both symmetric and transitive; keep the
      kind/plane base thin and the schema OWL 2 RL-shaped for mechanical RDF
      export.
- [ ] Map all 24 competency questions to exact tables, junctions, views, or a
      named gap; no entry may disappear.
- [ ] Keep schema authorship human-reviewed and require a versioned migration
      or full rebuild for every future schema-hash change.

## T3 — preserve the files-only default

- [x] Implement the port with no database, container, or network and make that
      implementation the default.
- [x] Report `time_travel`, `branch_merge`, and `cross_run_query` unavailable
      by name and require callers to query capabilities before use.
- [x] Run the full contract suite and soundness control against files-only.
- [ ] Wire the files-only conformance suite into every-commit CI.
- [ ] Prove a full round evaluates the gate, builds and hashes the context
      block, and completes the run record with no ontology database present.

## T4 — implement the SQLite ontology adapter

- [ ] Create a fresh local database file by applying the exact pinned
      `schema.sql`; never synthesise or mutate the schema in adapter code.
- [ ] Verify the schema hash before opening an existing database or creating a
      new one; raise a named configuration error with expected and observed
      hashes on mismatch.
- [ ] Record ontology version, schema hash, and hash algorithm in database
      metadata and verify them before use.
- [ ] Implement port registration as schema verification, not as an alternate
      schema authoring path.
- [ ] Map deterministic lexical business keys to the schema's `UNIQUE` columns
      and return the stable row identity needed for round-trip evidence.
- [ ] Execute parameterised SQL only inside the adapter; reject undeclared
      fields before constructing a statement.
- [ ] Query ordinary relationships through tables/junctions and recursive
      relationships only through the shipped guarded views.
- [ ] Run the complete shared conformance suite with divergences limited to
      honestly reported optional capabilities.

## T5 — permanent SQL competency and emptiness suite

- [ ] Port all 24 archived competency entries to named parameterised SQL or an
      explicit ontology-gap entry; no question may disappear.
- [ ] Execute every mapped query in CI and record query ID, expected-emptiness
      contract, elapsed time, row count, and outcome.
- [ ] Keep successful nonempty, successful expected-empty, ontology gap, SQL
      failure, and not-run as distinct states.
- [ ] Unexpected emptiness raises the existing named error and never returns
      an unqualified empty result.
- [ ] Wrap all recursive traversal through the shipped views and deduplicate
      answer identities where multiple paths reach the same row.
- [ ] Canary 1: a known-positive join with a deliberately mismatched type must
      fail the expected-nonempty assertion.
- [ ] Canary 2: a known-positive traversal with its assertion layer disabled
      must make the suite fail closed.
- [ ] Prove both canaries discriminate by running the suite with the relevant
      guard disabled and observing nonzero status.

## T6 — SQLite concurrency

- [ ] Enable WAL and use short transactions with a finite `busy_timeout` or
      bounded retry policy; record the selected bounds.
- [ ] Distinct-row inserts may fan in, but every accepted insert must be
      visible after contention completes.
- [ ] Shared read-modify-write begins a guarded write transaction before the
      read, rechecks observed state, and raises a named retryable conflict on
      staleness.
- [ ] Apply each independent lane batch atomically; uniqueness, foreign-key, or
      stale-state conflict rolls back the whole batch.
- [ ] Bound conflict retry and raise a named terminal error after exhaustion;
      no silent infinite retry.
- [ ] Add tests for twelve distinct writers, two contending shared updates,
      busy-retry exhaustion, and whole-batch rollback.

## T7 — graph and session projection ingest

- [ ] Read `graphify-out/graph.json` directly and refuse Cypher, Neo4j,
      FalkorDB, GraphML, and visualization exports with an error naming their
      lost fields.
- [ ] Verify the schema hash and initialise the empty database before the first
      input write.
- [ ] Classify every node, link, and hyperedge before writing; unknown shapes
      fail closed and produce an ontology finding.
- [ ] Use two passes inside an atomic batch: nodes/base rows before link and
      junction rows.
- [ ] Make re-ingest idempotent through lexical unique keys and explicit
      conflict handling; identical input twice produces no row differences.
- [ ] Stamp the graphify version and exact input hash on every batch.
- [ ] Record identifier changes as lineage through a declared representation,
      never as silent delete-and-create.
- [ ] Represent set links with junction tables and attributed relations with
      declared reified tables; fail on an attribute with neither a mapping nor
      a named drop rule.
- [ ] Preserve `fm-session.py project()` as one direction only: canonical
      session SQLite rows project into the ontology, and ontology rows never
      write back into the session store.

## T8 — schema pin, backup, integrity, rebuild, and exit

- [ ] Refuse use when the observed `schema.sql` hash differs from the pinned
      hash and report both values.
- [ ] Document a transactionally consistent backup using SQLite's backup API
      or an equivalent copy that includes required WAL state.
- [ ] Prove the rebuild path by deleting only a run-scoped ontology database,
      recreating it from `schema.sql` and grounded inputs, and comparing all
      tables plus query classifications.
- [ ] Run `PRAGMA integrity_check`, every lint view, the 24-query suite, and a
      timed drop/rebuild at least quarterly and before a schema-pin change.
- [ ] Keep the four withdrawal gate checks permanent: positive acceptance,
      invalid-enum rejection, undeclared-field rejection, and drop/rebuild
      identity.
- [ ] Document and rehearse fallback to files-only within one release.
- [ ] If the ontology database becomes unavailable mid-round, continue on
      files-only and record each degraded optional capability.

## T9 — gate

- [ ] Shared conformance suite green against files-only and the SQLite ontology
      adapter, with divergence limited to declared optional capabilities.
- [ ] The no-ontology full round passes end to end.
- [ ] Schema-hash mismatch, foreign-keys-off, invalid enum, undeclared field,
      guarded-cycle, and shared-clobber negative controls all discriminate.
- [ ] All 24 competency entries are present; every mapped SQL query runs in CI
      and every gap remains named.
- [ ] Drop/rebuild yields identical table contents and query classifications.
- [ ] The adapter-boundary repository scan is clean.
- [ ] `shellcheck` is clean on every new script and repository documentation
      checks pass.
- [ ] `openspec validate graph-store-port --strict` passes.
- [ ] Append any workflow failure or friction event to `bugeventlog.md`.
