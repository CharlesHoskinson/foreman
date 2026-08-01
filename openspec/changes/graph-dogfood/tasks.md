# Tasks — graph-dogfood

The tasks implement an evidence-producing release exercise. They do not alter
the pinned SQLite schema, adapter semantics, SQL query definitions, refresh
cadence, or falsification policy. No task may infer success from an exit code
without the required artifact and numeric checks.

## 1. Establish the run contract and evidence layout

- [ ] 1.1 Implement `skills/foreman/scripts/graph-dogfood.sh` with a required
      clean repository commit, unique `run_id`, and run-scoped output directory
      `artifacts/graph-dogfood/<run-id>/`.
- [ ] 1.2 Write `run-manifest.json` before database mutation with repository
      commit, dirty state, graph path/hash/build commit, graphify version,
      refresh cadence, schema path, pinned/observed schema hashes, ontology
      version, `manifest_version`, SQLite runtime version, required pragmas,
      tracked/represented/unrepresented files, and per-stage states.
- [ ] 1.3 Make every stage transition atomic and restrict states to `pending`,
      `running`, `passed`, `failed`, `skipped`, and `not-run`; failure marks
      every unstarted later stage `not-run`.
- [ ] 1.4 Add a fixture-free manifest-only smoke test against the committed
      `graphify-out/graph.json` and assert all identity fields exist.

## 2. Compose owner preflight and graph refresh

- [ ] 2.1 Verify the published interfaces from `knowledge-plane-refresh`, the
      SQLite ontology adapter and 24-entry SQL suite in `graph-store-port`, and
      `graph-eval-falsification`; record their content hashes and stop before
      writes if any prerequisite is absent.
- [ ] 2.2 Invoke only `skills/foreman/scripts/graph-refresh.sh` for release
      refresh; do not call graphify internals from the dogfood runner.
- [ ] 2.3 Copy the exact refreshed `graph.json` and metadata into the run
      directory, record SHA-256, and refuse Neo4j, FalkorDB, Cypher, GraphML,
      HTML, or visualization input.
- [ ] 2.4 Record the run commit separately from `built_at_commit`, report replay
      drift, and name every unrepresented tracked file.
- [ ] 2.5 Verify `schema.sql` SHA-256 equals
      `1a7c15a97fe594a07746d285a9e14b3a0820b3386c40c0206d55389f7a6eb76f`.
- [ ] 2.6 Add negative tests proving exporter input, dirty commits, missing
      owner interfaces, graph hash drift, and schema hash mismatch stop before
      database mutation.

## 3. Build the exact input disposition ledger

- [ ] 3.1 Enumerate every node by graphify `id`, every link by array index plus
      ordered `(source, target, relation)`, and every top-level hyperedge by
      `id`; treat `graph.hyperedges` as metadata and write one `pending` row per
      conserved input.
- [ ] 3.2 Load direction through `build_from_json(raw, directed=True)`, record
      observed `directed`/`multigraph`, and calculate descending endpoints.
- [ ] 3.3 Apply only the frozen manifest and adapter classifiers. Record exact
      rule and primary outcome; unknown shapes become `rejected`, later inputs
      become `unreached`, and processing stops at the owner boundary.
- [ ] 3.4 Assert baseline operands are exactly 3,579 nodes, 3,668 links, and 6
      hyperedges only when the recorded baseline hash is in use; refreshed
      inputs use their recorded operands.
- [ ] 3.5 Add mutations that remove and duplicate dispositions, invent a drop
      rule, swap an ordered tuple, and canonicalise endpoint order; each must
      trip a different named predicate.

## 4. Create a fresh schema-pinned SQLite ontology

- [ ] 4.1 Create a new run-scoped local database file by applying the exact
      pinned `skills/foreman/ontology/schema.sql`.
- [ ] 4.2 Enable and read back `PRAGMA foreign_keys=ON` and WAL before data
      access; record expected and observed values.
- [ ] 4.3 Read back ontology metadata and `sqlite_master`, recording schema
      object counts, content hash, open/create wall clock, initial database/WAL
      bytes, and adapter-process RSS bytes.
- [ ] 4.4 Run positive acceptance plus discriminating invalid-enum,
      undeclared-field, cross-plane, duplicate-key, and supersession controls.
- [ ] 4.5 Verify returned integer IDs and lexical keys are recorded together;
      no graphify ID may be submitted as a SQLite row ID.
- [ ] 4.6 Add negative tests for schema hash mismatch, foreign keys disabled,
      undeclared fields, invalid enum values, caller-selected row IDs, and a
      nonempty lint view.

## 5. Run two-pass ingest and prove arithmetic conservation

- [ ] 5.1 Invoke the unchanged adapter with the pinned manifest, schema hash,
      graph hash, and graphify version; record base-row and link-row timings,
      atomic batch outcomes, integer IDs, lexical keys, and named drops.
- [ ] 5.2 Recount base, junction, and reified rows directly through independent
      audit SQL. Record `input_key -> lexical_key -> row_id` and compare rows
      to distinct projected keys rather than node primary-outcome count.
- [ ] 5.3 Write `counts.json` with operands, primary outcomes, auxiliary rows,
      distinct keys/IDs, per-rule drops, rejected/unreached counts, database
      recounts, three residuals, and full accounting identities.
- [ ] 5.4 Require exact disjoint partitions, zero rejected/unreached for a pass,
      known drop reasons, explained projected-key collisions, and recount
      parity. Fail each invariant independently.
- [ ] 5.5 On mapping, constraint, busy, or SQL failure, roll back the active
      batch, preserve completed dispositions and batches, identify the first
      rejected/lost input, mark later stages `not-run`, and render honestly.
- [ ] 5.6 Delete one accepted row after ingest in an integration mutation; the
      independent recount and conservation gate must fail even when adapter
      totals remain unchanged.

## 6. Audit direction, ontology guards, and provenance

- [ ] 6.1 Compare every stored junction or reified primary relation with its
      exact input `(source, target, relation)` tuple and fail any reversal.
- [ ] 6.2 Require descending endpoint count greater than zero; assert 1,465 for
      the committed baseline.
- [ ] 6.3 Write `provenance-samples.json` for node `foreman_skill` at
      `skills/foreman/SKILL.md:L1` and its exact `contains` link at `L14`, with
      input identity, lexical key, integer row ID if stored, retrieved source,
      `EXTRACTED`, and score 1.0.
- [ ] 6.4 Add link-index 1200 with `INFERRED`/0.95 and link-index 3614 with
      `AMBIGUOUS`/0.3; preserve nullable locations and never recompute explicit
      level from score.
- [ ] 6.5 Compare `source_file`, `source_location`, `confidence_score`, and
      audit level across every stored input carrying them; report mismatch
      counts and example IDs.
- [ ] 6.6 Run every lint view, `PRAGMA integrity_check`, a contradiction cycle,
      and a supersession cycle; traversal views must terminate and any nonzero
      `claim_head.still_superseded` must be reported guard-stopped.
- [ ] 6.7 If the pinned schema cannot represent a witness, record an ontology
      finding and failed/incomplete status; do not add a local table or column.

## 7. Execute the 24-query real-graph competency matrix

- [ ] 7.1 Evaluate `Q-W1` through `Q-W13`, `Q-K14` through `Q-K20`, and
      `Q-X21` through `Q-X24`; invoke every mapped parameterised SQL statement
      through expected-emptiness and evaluate K16/X22 gaps without inventing
      queries.
- [ ] 7.2 Write exactly 24 rows to `competency-results.json`, each with query
      ID/name, plane, SQL-or-gap identity, emptiness contract, status, elapsed
      milliseconds, result count, and classification. Successful rows use only
      `answered`, `empty-but-valid`, or `unanswerable`; failed/not-run rows have
      null classification plus error or blocker.
- [ ] 7.3 Require `answered + empty-but-valid + unanswerable = 24` for a
      completed stage and always require
      `answered + empty-but-valid + unanswerable + failed + not-run = 24`.
- [ ] 7.4 Keep SQL syntax, constraint, timeout, busy, guard, and emptiness
      failures outside successful classifications and fail on any such error.
- [ ] 7.5 Retain K16/X22 as gaps, identify W4 as partial, and report whether W6,
      W13, and X23 same-release dependencies are present.
- [ ] 7.6 Add a negative test where known-positive SQL returns zero despite
      `expect-results`; it must be failed, never `empty-but-valid`.

## 8. Record ontology findings without working around them

- [ ] 8.1 Write `ontology-findings.json` for every unrepresentable real shape,
      including input key, source, attempted table/relation, manifest outcome,
      affected count, first failing stage, and proposed versioned schema or
      mapping change.
- [ ] 8.2 Evaluate missing required columns/defaults, unsupported relation
      types, provenance-bearing links, and all six baseline hyperedges.
- [ ] 8.3 Group repeated shapes under one proposal while retaining every
      affected input key and per-shape count.
- [ ] 8.4 Assert schema and manifest hashes remain unchanged from preflight
      through teardown.
- [ ] 8.5 Render findings as proposals to the human-owned `schema.sql` and
      adapter mapping, never changes silently applied by dogfood.

## 9. Measure first ingest and timed drop-and-rebuild

- [ ] 9.1 Write `metrics.json` with commands, timestamps, environment,
      per-stage and total wall clock, rows by table, database/WAL bytes,
      adapter-process RSS bytes, batch size, busy retries, and calculated rows
      per second.
- [ ] 9.2 Label 2.6-second startup, 38 MB idle RSS, 9.7 MB for 5,500 documents,
      and approximately 1,070 documents/second as historical reference values,
      never current SQLite measurements.
- [ ] 9.3 Delete only the run-scoped ontology database, recreate it from the
      pinned schema, re-ingest, and repeat recount, conservation, provenance,
      lint, integrity, guarded traversal, and competency checks.
- [ ] 9.4 Compare pre-drop/post-rebuild tables, relation rows, and every
      competency classification; fail with differing keys.
- [ ] 9.5 Remove one required metric and verify `INCOMPLETE`, never substituted
      zero or historical data.

## 10. Render an honest report

- [ ] 10.1 Generate `report.md` exclusively from run evidence, with stages,
      exact counts and equations, drops, provenance, 24-entry table, findings,
      schema/pragma/integrity evidence, metrics, rebuild comparison, and first
      blocker.
- [ ] 10.2 Render absent measurements as `missing`, unstarted stages as
      `not-run`, and successful expected-zero queries as `empty-but-valid`.
- [ ] 10.3 Emit `PASSED` only when every required predicate succeeds; observed
      failure wins as `FAILED`, otherwise missing/unexecuted evidence yields
      `INCOMPLETE`.
- [ ] 10.4 Add golden reports for a pass, schema-hash mismatch, constraint
      rejection, unknown relation, SQL failure, conservation residual, guarded
      traversal stop, and missing measurement.

## 11. Gate — run the real Foreman dogfood

- [ ] 11.1 Run at a named clean commit against a fresh schema-pinned local
      ontology database and preserve the complete run directory.
- [ ] 11.2 Run `skills/foreman/scripts/graph-dogfood-gate.sh <run-dir>` and
      verify schemas, hashes, pragmas, integrity, lint, three residuals, exact
      partitions, recount parity, non-vacuous direction, provenance, exactly 24
      competency rows, findings, measurements, and rebuild parity.
- [ ] 11.3 If incomplete, require nonzero gate status, first blocker, partial
      evidence, and later `not-run`; never waive the gate.
- [ ] 11.4 Run `bats tests/graph-dogfood.bats`, `shellcheck` on both scripts,
      repository docs checks, and
      `/usr/local/bin/openspec validate graph-dogfood --strict`; record exact
      commands and outputs.
- [ ] 11.5 Enumerate the package and scoped status; require exactly the four
      allowed OpenSpec paths and do not commit.
