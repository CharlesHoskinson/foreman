# Tasks — graph-dogfood

The tasks implement an evidence-producing release exercise. They do not alter
the frozen schema, adapter semantics, query definitions, refresh cadence, or
falsification policy. No task may claim success from an exit code without the
required artifact and numeric checks.

## 1. Establish the run contract and evidence layout

- [ ] 1.1 Implement `skills/foreman/scripts/graph-dogfood.sh` with a required
      clean repository commit, unique `run_id`, and run-scoped output directory
      `artifacts/graph-dogfood/<run-id>/`.
- [ ] 1.2 Write `run-manifest.json` before database mutation with repository
      commit, dirty status, graph path/hash/build commit, graphify version,
      refresh cadence, schema hash, `manifest_version`, TerminusDB version and
      digest, tracked-file count, represented files, unrepresented files, and
      per-stage states.
- [ ] 1.3 Make every stage transition atomic and restrict states to
      `pending`, `running`, `passed`, `failed`, `skipped`, and `not-run`; a
      failed stage must mark all unstarted later stages `not-run`.
- [ ] 1.4 Add a fixture-free smoke test in `tests/graph-dogfood.bats` that
      invokes manifest-only preflight against the committed
      `graphify-out/graph.json` and asserts the evidence directory and required
      identity fields exist.

## 2. Compose the owner-package preflight and graph refresh

- [ ] 2.1 Verify the required interfaces from
      `knowledge-plane-refresh`, `terminusdb-schema`,
      `terminusdb-adapter`, and `terminusdb-operations` exist and record their
      content hashes; stop before writes if any owner prerequisite is absent.
- [ ] 2.2 Invoke only
      `skills/foreman/scripts/graph-refresh.sh` for the release refresh; do not
      call graphify directly from the dogfood runner.
- [ ] 2.3 Copy the exact refreshed `graph.json` and refresh metadata into the
      run directory, record SHA-256, and refuse every Neo4j, FalkorDB, Cypher,
      GraphML, HTML, or visualization input.
- [ ] 2.4 Record the named run commit separately from `built_at_commit`, and
      report replay drift and every unrepresented tracked file when the two
      commits differ.
- [ ] 2.5 Add negative tests proving exporter input, dirty commits, missing
      owner interfaces, and graph hash changes between classification and
      ingest stop the run before database writes.

## 3. Build the exact input disposition ledger

- [ ] 3.1 Enumerate every node by graphify `id`, every link by its array index
      plus ordered `(source, target, relation)` tuple, and every top-level
      `hyperedges` entry by `id`; treat `graph.hyperedges` as metadata rather
      than a second input array, and write one `pending` row per input to
      `input-dispositions.ndjson`.
- [ ] 3.2 Load graph direction through
      `build_from_json(raw, directed=True)`, record the artifact's observed
      `directed`/`multigraph` values, and calculate descending endpoint count.
- [ ] 3.3 Apply only manifest v1 and the adapter's published node-kind,
      relation, and property classifiers. Record the exact rule and primary
      outcome; unknown shapes receive `rejected` with the owner `fail` reason,
      later unprocessed inputs receive `unreached`, and the run stops at the
      owner boundary.
- [ ] 3.4 Assert the committed baseline pre-ingest operands are exactly 3,579
      nodes, 3,668 links, and 6 hyperedges when its recorded graph hash is in
      use; refreshed inputs use their newly recorded operands instead.
- [ ] 3.5 Add mutation tests that remove one disposition, duplicate one
      disposition, invent a drop rule, swap one ordered endpoint tuple, and
      canonicalize all endpoint order; each mutation must trip a different
      named predicate.

## 4. Start a fresh pinned TerminusDB and load the frozen schema

- [ ] 4.1 Use the deployment interface owned by
      `terminusdb-operations` to start TerminusDB 12.0.6 at digest
      `sha256:e02eaa3a5b75e01550cee2a662a846db7fceb725193983f1f35e1842ab580fee`
      with a new native-filesystem data directory for this run.
- [ ] 4.2 Refuse a version/digest mismatch before schema load and record both
      expected and observed values.
- [ ] 4.3 Load the exact frozen 33-object schema through the adapter, read it
      back, and record schema object count, content hash, startup wall clock,
      initial disk bytes, and idle RSS bytes.
- [ ] 4.4 Verify the live generated-key behavior by using returned identifiers
      only; no graphify ID may be submitted as TerminusDB `@id`.
- [ ] 4.5 Add negative tests for digest mismatch, schema hash mismatch,
      undeclared fields, invalid enum values, and caller-submitted generated
      identifiers.

## 5. Run two-pass ingest and prove arithmetic conservation

- [ ] 5.1 Invoke the unchanged adapter with the pinned manifest and
      caller-supplied graphify version; record document-pass and link-pass
      timings, batch results, returned generated identifiers, and all
      drop-with-record outcomes.
- [ ] 5.2 Recount top-level documents by class, auxiliary/reified documents by
      class, and native relations by schema field directly from TerminusDB;
      record each `input_key -> returned_db_id`, and compare the database
      document recount to the distinct projected-ID set rather than to the
      count of node primary outcomes. Do not use adapter log totals as the
      database recount.
- [ ] 5.3 Write `counts.json` with input operands, primary stored outcomes,
      auxiliary outputs, distinct projected IDs, per-rule drops, rejected and
      unreached counts, database recounts, the three conservation residuals,
      and the three full accounting identities from the dogfood spec.
- [ ] 5.4 Check exact disjoint accounting partitions; require rejected and
      unreached counts zero plus exact stored/named-drop partitions for a
      conservation pass. Fail on missing keys, duplicate keys, unknown drop
      reasons, unexplained projected-ID collisions, or database-recount
      mismatch.
- [ ] 5.5 On adapter or schema failure, preserve the complete classification
      ledger and all committed batch outcomes, identify the first lost or
      rejected input, mark later stages `not-run`, and continue only to honest
      report rendering.
- [ ] 5.6 Add an integration mutation that deletes one accepted database
      document after ingest; the database recount and conservation gate must
      fail even though the adapter report remains unchanged.

## 6. Audit ordered direction and provenance round trips

- [ ] 6.1 Compare every stored relation or reified-link primary outcome with
      its exact input `(source, target, relation)` tuple and fail on any
      reversal.
- [ ] 6.2 Require descending endpoint count greater than zero; for the
      committed baseline assert the measured count is 1,465.
- [ ] 6.3 Write `provenance-samples.json` for node `foreman_skill` at
      `skills/foreman/SKILL.md:L1` and its exact `contains` link to
      `foreman_skill_foreman_architect_worker_orchestration` at `L14`, including
      input identity, generated database identity if any, retrieved source
      fields, audit level `EXTRACTED`, and `confidence_score` 1.0.
- [ ] 6.4 Add the input-index 1200 `shares_data_with` witness with audit level
      `INFERRED` and score 0.95, and input-index 3614
      `conceptually_related_to` witness with audit level `AMBIGUOUS` and score
      0.3; assert nullable source locations survive and explicit levels are not
      recomputed from score.
- [ ] 6.5 Compare `source_file`, `source_location`, `confidence_score`, and
      audit level across every stored input that carries them, reporting field
      mismatch counts and example identifiers.
- [ ] 6.6 If the frozen schema cannot represent the named link provenance,
      record an ontology finding and fail/incomplete status; do not add a
      generic field or ingest-local document class.

## 7. Execute the 24-query real-graph competency matrix

- [ ] 7.1 Evaluate all operations-owned competency entries `Q-W1` through
      `Q-W13`, `Q-K14` through `Q-K20`, and `Q-X21` through `Q-X24`; invoke each
      mapped query through its expected-emptiness wrapper and evaluate
      owner-declared gap entries K16 and X22 without inventing queries.
- [ ] 7.2 Write exactly 24 rows to `competency-results.json`, each with query
      ID, question name, plane, formalism tags, emptiness contract, execution
      status, elapsed milliseconds, result count, and classification. Every
      successfully evaluated row has exactly one of `answered`,
      `empty-but-valid`, or `unanswerable`; failed and not-run rows have null
      classification plus their error or blocking stage.
- [ ] 7.3 For a completed query stage require
      `answered + empty-but-valid + unanswerable = 24`; for every report also
      require
      `answered + empty-but-valid + unanswerable + failed + not-run = 24`.
      List every unanswerable query by ID with its missing data or ontology
      capability.
- [ ] 7.4 Keep transport, syntax, schema, timeout, deduplication-wrapper, and
      expected-emptiness failures outside successful classifications and fail
      the matrix gate on any such error.
- [ ] 7.5 Assert K16 and X22 retain the owner packages' gap dispositions, W4 is
      identified as partial, and W6, W13, and X23 report whether their
      same-release dependencies are present in the actual graph.
- [ ] 7.6 Add a negative test in which a query wrapper returns HTTP success
      with zero rows despite an `expect-results` contract; it must be a failed
      query, not `empty-but-valid`.

## 8. Record ontology findings without working around them

- [ ] 8.1 Write `ontology-findings.json` entries for every real input shape the
      frozen schema/manifest cannot represent, including input key, source
      evidence, attempted class/relation, manifest disposition, affected
      count, first failing stage, and proposed owner-package revision.
- [ ] 8.2 Explicitly evaluate required base fields for real Source documents,
      unsupported real relation types, provenance-bearing links, and the six
      baseline hyperedges.
- [ ] 8.3 Group repeated instances under one proposed schema/manifest change
      while retaining the full list of affected input keys and per-shape
      counts.
- [ ] 8.4 Assert schema and manifest content hashes remain unchanged from
      preflight through teardown.
- [ ] 8.5 Render the findings into `report.md` as proposals to
      `terminusdb-schema`, never as changes silently applied by dogfood.

## 9. Measure first ingest and timed drop-and-rebuild

- [ ] 9.1 Write `metrics.json` with commands, timestamps, environment, per-stage
      and total wall clock, top-level and auxiliary document counts, relations
      by type, disk bytes, idle RSS bytes, batch size, and calculated
      documents per second.
- [ ] 9.2 Label 2.6-second startup, 38 MB idle RSS, 9.7 MB for 5,500 documents,
      and approximately 1,070 documents/second as historical reference values,
      never current measurements.
- [ ] 9.3 Invoke the operations-owned drop-and-rebuild path against the
      run-scoped live data directory, record its wall clock, and repeat database
      recount, conservation, provenance, and competency checks.
- [ ] 9.4 Compare pre-drop and post-rebuild document/relation counts and every
      competency classification; any divergence fails with the differing keys.
- [ ] 9.5 Add a negative test that removes one required metric and verify the
      report becomes `INCOMPLETE` rather than substituting zero or a historical
      value.

## 10. Render an honest report

- [ ] 10.1 Generate `report.md` exclusively from the run's machine-readable
      evidence, with stage outcomes, exact counts, equations with substituted
      operands, drop reasons, provenance sample, 24-query table, ontology
      findings, measurements, rebuild comparison, and first blocker.
- [ ] 10.2 Render absent measurements as `missing`, unstarted stages as
      `not-run`, and successful zero-row queries as `empty-but-valid`; never
      collapse those states.
- [ ] 10.3 Emit `PASSED` only when every required stage and evidence predicate
      succeeds; an observed failure takes precedence as `FAILED`, while
      missing/unexecuted evidence in the absence of an observed failure yields
      `INCOMPLETE`.
- [ ] 10.4 Add golden rendering tests for a complete pass, a node-pass schema
      rejection, an unknown link relation, a query transport failure, a
      conservation residual, and a missing measurement.

## 11. Gate — run the real Foreman dogfood and verify the artifacts

- [ ] 11.1 Run the full exercise at a named clean Foreman commit against a
      fresh pinned TerminusDB and preserve the complete
      `artifacts/graph-dogfood/<run-id>/` directory.
- [ ] 11.2 Run `skills/foreman/scripts/graph-dogfood-gate.sh <run-dir>` and
      verify it checks file presence and schemas, three zero residuals, three
      exact set partitions, database recount parity, non-vacuous direction,
      provenance evidence, exactly 24 competency rows, named unanswerables,
      ontology finding integrity, current-run measurements, and rebuild parity.
- [ ] 11.3 If the pipeline cannot complete, verify the gate returns nonzero and
      the report names the first blocker, retains partial numbers, and marks
      later stages `not-run`; do not waive the gate to obtain a green result.
- [ ] 11.4 Run `bats tests/graph-dogfood.bats`, `shellcheck` on both new scripts,
      the repository docs gate, and
      `/usr/local/bin/openspec validate graph-dogfood --strict`; record exact
      commands and outputs in the run report.
- [ ] 11.5 Enumerate the package with `find` and scoped
      `git status --porcelain --untracked-files=all -- openspec/changes/graph-dogfood`;
      require exactly the four allowed OpenSpec paths, and do not commit.
