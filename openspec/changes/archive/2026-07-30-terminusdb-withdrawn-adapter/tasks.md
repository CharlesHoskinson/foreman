# Tasks: terminusdb-adapter

Implementation order respects dependencies: client → wrappers (CAS,
normalize, non-empty, Path-Distinct) → ingest pipeline → rename
detection → drop-and-rebuild → gates.

Schema class names come from the Council 1 schema/ontology package;
deploy/pin/backup/health and `TERMINUSDB_SERVER_WORKERS` from the
Council 3 operations package. Do not implement those packages here.

## T1 — Package scaffold and HTTP client

- [ ] T1.1 Create the adapter module boundary (all TerminusDB HTTP access
      lives here; no callers import raw endpoints outside this tree).
- [ ] T1.2 Add raw HTTP dependency (`httpx` preferred, or `requests`);
      do **not** add `terminusdb` or `terminusdb-client`.
- [ ] T1.3 Implement connection config: base URL (default
      `http://127.0.0.1:6363`), org, db, Basic auth user `admin`,
      password from `TERMINUSDB_ADMIN_PASS` (fail closed if unset on
      live ops).
- [ ] T1.4 Implement `POST /api/db/{org}/{db}` database create helper.
- [ ] T1.5 Implement schema write helper that **always** sets
      `full_replace=true` (plus `graph_type=schema`, `author`, `message`).
- [ ] T1.6 Implement document PUT upsert
      (`create=true&author=&message=`) and optional strict-create POST
      mapping `api:DocumentIdAlreadyExists` →
      `DocumentIdAlreadyExistsError`.
- [ ] T1.7 Capture `Terminusdb-Data-Version` response headers on reads
      and writes; surface only via the normalization path (T3).
- [ ] T1.8 Unit tests: auth missing, schema query string always contains
      `full_replace=true`, PUT vs POST paths.

**Depends on:** nothing (first code).

## T2 — Author encoding and error taxonomy

- [ ] T2.1 Implement `encode_author(run_id, lane, attempt) -> str` as
      `fm|<run_id>|<lane>|<attempt>` with delimiter `|`.
- [ ] T2.2 Reject any component containing `|` with
      `AdapterValidationError` (no escape/truncate).
- [ ] T2.3 Implement matching parser (exactly four segments, first
      `fm`).
- [ ] T2.4 Implement closed error types:
      `AdapterValidationError`, `CasRequiredError`, `ConflictError`,
      `DataVersionMismatchError`, `UnexpectedEmptyResultError`,
      `IngestSourceError`, `ReificationError`, `UnmappedNodeKindError`,
      `BannedEndpointError`, `RenameCorrelationError`,
      `AuthError`, `NotFoundError`, `DocumentIdAlreadyExistsError`,
      `TransportError`, `ServerError`, `DropRebuildError`.
- [ ] T2.5 Implement retry helper: max 3 retries after initial attempt,
      exponential backoff base 50ms, multiplier 2, full jitter; only
      `DataVersionMismatchError` and `TransportError` (5xx) retryable.
- [ ] T2.6 Unit tests for encode/parse round-trip, delimiter rejection,
      retry bounds, non-retry of validation errors.

**Depends on:** T1 (client used in transport retry integration).

## T3 — normalize_data_version, DataVersionToken, and DiffRef

- [ ] T3.1 Implement two types: `DataVersionToken` (opaque CAS header
      only) and `DiffRef` (bare branch name or `commit:<id>` for diff
      fields). Implement `normalize_data_version(ref: str) -> DiffRef`
      that strips leading `branch:` only when the remainder matches the
      live branch list or is `commit:<id>` shaped; otherwise raise
      `AdapterValidationError`.
- [ ] T3.2 Make `DiffRef` the only accepted type for `*_data_version`
      request fields (structural, not convention); `DataVersionToken`
      must not be interchangeable.
- [ ] T3.3 Post-condition: still-prefixed `branch:` or opaque token not
      in live branch list raises `AdapterValidationError` before HTTP.
- [ ] T3.4 Wire diff API to accept only `DiffRef`.
- [ ] T3.5 Unit tests for bare name, `commit:<id>`, strip `branch:main`
      when live, rejection of opaque-token form, and both canary forms.

**Depends on:** T1, T2.

## T4 — CAS wrapper

- [ ] T4.1 Public write API takes `cas_required: bool` and optional
      data-version token.
- [ ] T4.2 When `cas_required=true`, send `TerminusDB-Data-Version`
      request header.
- [ ] T4.3 Refuse shared-document RMW without CAS
      (`CasRequiredError` before HTTP).
- [ ] T4.4 Map `api:DataVersionMismatch` → retry via T2.5 →
      `ConflictError` on exhaustion.
- [ ] T4.5 Fan-in distinct-document writes allow `cas_required=false`
      with no CAS header.
- [ ] T4.6 Tests: refusal path, successful CAS header, mismatch retry,
      distinct-doc no-CAS permitted (at least two scenarios on
      CAS-refusal).

**Depends on:** T1, T2, T3.

## T5 — Non-empty query wrapper and Path Distinct

- [ ] T5.1 Query issuer takes `expect: "results" | "empty" | "unknown"`.
- [ ] T5.2 `expect="results"` + zero rows →
      `UnexpectedEmptyResultError`.
- [ ] T5.3 `expect="empty"` never raises on zero rows.
- [ ] T5.4 `expect="unknown"` logs `woql_expect_unknown` (greppable).
- [ ] T5.5 Structural Distinct wrapper around every Path-typed WOQL
      builder; no public raw Path without Distinct.
- [ ] T5.6 Tests for all three expect modes and Distinct injection.
- [ ] T5.7 Implement the /api/log structural ban and non-zero-offset
      commit-log-paging ban; raise `BannedEndpointError` before HTTP.

**Depends on:** T1, T2.

## T6 — Canary fixtures

- [ ] T6.1 Add canary `canary_branch_prefix_diff`: covers BOTH the
      hand-written `branch:main` form AND the opaque-token form (a
      stripped remainder that does not match the live branch list must
      also be rejected); asserts rejection before HTTP.
- [ ] T6.2 Add canary `canary_anyuri_string_unification`: reproduces
      anyURI-vs-string `eq/2` silent empty; asserts
      `expect="results"` raises.
- [ ] T6.3 Document how to run the suite with normalization / expect
      machinery disabled and prove both canaries go red (gate uses this).
- [ ] T6.4 Ensure canary names appear in both this tasks file and
      `specs/store-adapter/spec.md` (already named there).

**Depends on:** T3, T5.

## T7 — Ingest pipeline (core)

- [ ] T7.1 Ingest entry point accepts `graph.json` path + required
      caller `graphify_version`.
- [ ] T7.2 Refuse `cypher.txt` / Neo4j / FalkorDB export files with
      `IngestSourceError` naming dropped fields
      (`source_file`, `source_location`, `confidence_score`, `weight`,
      `context`, `rationale`, `author`, `contributor`, `source_url`,
      `captured_at`, `verification`, `metadata`, hyperedges,
      communities, `built_at_commit`).
- [ ] T7.3 Parse NetworkX `node_link_data` keys: `directed`,
      `multigraph`, `graph`, `nodes`, `links`, optional `hyperedges`,
      `built_at_commit`.
- [ ] T7.4 Pass 1: batch-upsert nodes (and hyperedge-as-objects) at
      batch size **500**.
- [ ] T7.5 Implement `classify_edge_property` → exactly one of
      `reify` | `drop-with-record` | `fold-onto-node` | `fail`;
      unknown → `fail` → `ReificationError`.
- [ ] T7.6 Pass 2: batch-upsert links after classification at batch
      size **500**.
- [ ] T7.7 Stamp `graphify_version` on written documents; missing
      stamp → `AdapterValidationError` before writes (field name is
      GraphNode.graphify_version, as declared by the schema package —
      do not invent a different name).
- [ ] T7.8 Content-hash per batch; skip HTTP when hash already
      committed for org/db (idempotent re-ingest).
- [ ] T7.9 Author identity on ingest commits via T2 encoding
      (`run_id` / `lane` / `attempt` from caller).
- [ ] T7.10 Tests: source refusal, two-pass order, batch sizing,
      idempotent re-ingest (at least two scenarios), version stamp,
      reification fail-closed.
- [ ] T7.11 Implement `classify_edge_relation` and node-kind lookup
      against the schema package's mapping manifest (pin
      manifest_version); raise `UnmappedNodeKindError` /
      `ReificationError` per the spec requirement; tests for a mapped
      node kind, an unmapped node kind, a mapped relation type, an
      unmapped relation type, and hyperedge drop-with-record.

**Depends on:** T1–T5. Prefer T4 complete so ingest can choose
`cas_required=false` for distinct-doc fan-in batches.

## T8 — Rename-with-lineage detection

- [ ] T8.1 When consecutive ingests expose distinct `built_at_commit`
      SHAs, run git rename correlation (`git diff --name-status -M`
      or equivalent) on caller-supplied repo root.
- [ ] T8.2 Record lineage links for detected renames (`R*` paths).
- [ ] T8.3 Default fail closed → `RenameCorrelationError` when both
      SHAs present and correlation fails; honor
      `allow_rename_skip=true` only when explicitly set.
- [ ] T8.4 Synthetic file-move fixture test (green path).

**Depends on:** T7.

## T9 — Drop-and-rebuild

- [ ] T9.1 Implement `drop_and_rebuild(org, db, graph_json,
      graphify_version, ...)` selective delete of graph.json-derived
      types then full re-ingest.
- [ ] T9.2 Do **not** delete event-log-derived facts / pins / ops
      metadata (Council 3); refuse unsafe whole-DB drop with
      `DropRebuildError` when those facts exist and cannot be
      preserved.
- [ ] T9.3 Tests: rebuild repopulates graph facts; event-log facts
      preserved (fixture).

**Depends on:** T7 (and T8 if rebuild should re-run rename logic).

## T10 — Integration notes and docs in-tree

- [ ] T10.1 Document operational note: `TERMINUSDB_SERVER_WORKERS`
      defaults to 8; raise before >8 concurrent lanes — config owned
      by Council 3 operations package.
- [ ] T10.2 Cross-link Council 1 schema package for `@type` names used
      in selective delete and document shapes.
- [ ] T10.3 Cross-link `graph-store-port` for port factory wiring and
      repo-scan gate (do not re-implement the scan).
- [ ] T10.4 Confirm single-parent commit modeling only (no merge
      ancestry API).

**Depends on:** T1–T9 for accurate docs.

## T11 — FINAL GATE (merge criteria)

Ordering: run after T1–T10 complete.

- [ ] T11.1 `cd /root/foreman && /usr/local/bin/openspec validate
      terminusdb-adapter --strict` passes cleanly.
- [ ] T11.2 Both canaries proven fail-closed when disabled: run the
      test suite with normalization / expect-empty assertion machinery
      off and confirm `canary_branch_prefix_diff` and
      `canary_anyuri_string_unification` go red (verify by running the
      suite, not by reading code).
- [ ] T11.3 Re-enable machinery; full adapter unit/integration suite
      green including both canaries in the enabled configuration.
- [ ] T11.4 Confirm adapter files live inside the adapter boundary
      scanned by `graph-store-port`'s direct-TerminusDB-access repo-scan
      gate (do not re-implement the scan; ensure no TerminusDB HTTP
      clients exist outside this adapter package).
- [ ] T11.5 Idempotent re-ingest test green (unchanged `graph.json`
      second run skips via content-hash).
- [ ] T11.6 Rename-with-lineage test green against the synthetic
      file-move fixture.
- [ ] T11.7 Drop-and-rebuild test green with event-log fact
      preservation assertion.
- [ ] T11.8 Append `~/foreman/bugeventlog.md` with any workflow
      friction hit while implementing this package (OpenSpec,
      TerminusDB papercuts, canary harness, etc.).
- [ ] T11.9 Negative test proves `BannedEndpointError` is raised for a
      direct `/api/log` attempt and for a non-zero-offset commit-log
      query; a grep of the adapter module for `/api/log` finds no call
      site outside the enforcement path — verify by running the test,
      not by reading code.

**Depends on:** T1–T10, T6 canaries, T7 idempotency, T8 rename, T9
drop-and-rebuild.
