# Design: TerminusDB client, adapter, and ingest path

## Context

Foreman v0.2.9 ships TerminusDB as the concrete backend behind the
`GraphStore` port defined in `openspec/changes/graph-store-port/`. This
package is the adapter layer only: HTTP client, auth, commit boundaries,
CAS / non-empty / Path-Distinct wrappers, `graph.json` ingest,
rename-with-lineage, error taxonomy, retry policy, and drop-and-rebuild.

**Out of scope (sibling packages):**

| Concern | Owner |
| --- | --- |
| Ontology / schema class definitions | Council 1 schema/ontology package |
| Pinning, backup, health-check, query-DSL surface, deploy lifecycle, `TERMINUSDB_SERVER_WORKERS` config | Council 3 operations package |
| Port-level behavioral contract, files-only backend, repo-scan gate definition | `graph-store-port` |

**Verified inputs (R8 / R7 research, not re-litigated here):**

- Server: `terminusdb/terminusdb-server:latest`, single-node only, port
  `:6363`. No embedded/in-process mode exists.
- Auth: Basic `admin` / `$TERMINUSDB_ADMIN_PASS` (REQUIRED at container
  start; no default password).
- Every write is one commit; batch body = one commit for the whole batch.
- R8 measured ~1,070 docs/s at batch size 500 vs ~35 commits/s serial
  single-doc (p50 28ms, p95 34ms).
- Concurrent distinct-doc writers: safe without CAS. Concurrent
  same-doc RMW: last-writer-wins silently unless CAS header is set.
- CAS via request header `TerminusDB-Data-Version` (undocumented; verified
  live) returns `api:DataVersionMismatch` on stale token. Token is
  **branch-scoped**, not document-scoped.
- Diff with `branch:`-prefixed refs returns `[]` silently (HTTP 200).
- WOQL anyURI-vs-string `eq/2` returns zero bindings silently.
- Path queries emit one row per distinct path, not per answer — need
  `Distinct`.
- Source of truth for ingest: `graphify-out/graph.json` (NetworkX
  `node_link_data`), never Cypher / Neo4j / FalkorDB export paths.

## Goals / Non-Goals

**Goals**

1. Provide a TerminusDB adapter that fully satisfies the `GraphStore` port
   for this backend.
2. Fail closed on every silent-empty footgun R8 measured (diff
   `branch:` prefix, WOQL empty bindings, Path over-count).
3. Ingest the highest-fidelity artifact (`graph.json`) with two-pass
   ordering, content-hash idempotency, reification classification, and
   rename-with-lineage detection.
4. Encode Foreman lane identity into the only available commit metadata
   channel (`author` string) with a fail-closed parser.
5. Keep all TerminusDB HTTP access inside the adapter boundary so the
   port-level repo-scan gate remains green.

**Non-Goals**

1. Defining schema `@type` classes, `@context`, or ontology vocabulary
   (Council 1).
2. Deployment, pinning, backup, health endpoints, query-DSL public API,
   or tuning `TERMINUSDB_SERVER_WORKERS` (Council 3 — this package only
   notes that workers default to 8 and must be raised before >8 concurrent
   lanes).
3. Multi-parent merge ancestry (upstream #2430 open; commits are
   single-parent).
4. Re-implementing the port's files-only backend or re-stating port
   behavioral requirements verbatim.
5. Adopting official TerminusDB language clients.

## Decisions

### D1 — Raw HTTP client (not official SDKs)

**Decision:** The adapter talks to TerminusDB over raw HTTP using
Python `httpx` (preferred) or `requests`. It does **not** depend on
`terminusdb` (PyPI v12.0.5), `terminusdb-client` (v10.2.6), or
`@terminusdb/terminusdb-client` / the v12 JS package.

**Rationale:** Both client repos have been dependabot-only since ~Feb
2026 (no human commits). The v12 API surface is young and unproven
(~105 npm downloads/month for the new JS client vs 502 for the old one;
vendor docs still show 21 old-package samples vs 2 new). R8 verified
every needed capability over raw HTTP already. Raw HTTP means only
Foreman's own tests can drift against the server — not a third-party
wrapper under weaker maintenance than the server itself.

### D2 — Connection and auth

**Decision:**

- Base URL default: `http://127.0.0.1:6363` (overridable).
- Org/db names: configurable; adapter does not hard-code product
  branding beyond a documented default pair used in tests.
- Auth: HTTP Basic, user `admin`, password from
  `TERMINUSDB_ADMIN_PASS` (required; adapter refuses to start if unset
  when targeting a live server).
- DB create: `POST /api/db/{org}/{db}`.
- Schema load/replace:
  `POST /api/document/{org}/{db}?graph_type=schema&full_replace=true&author=...&message=...`
  — `full_replace=true` is **always** set on schema writes, never
  conditional (undocumented papercut: `@context` without full replace
  returns `api:message: "Inserting contexts is not allowed without using a
  'full replace'."`).
- Document upsert (default ingest path):
  `PUT /api/document/{org}/{db}?create=true&author=...&message=...`
  (idempotent create-or-replace).
- Strict create (optional): `POST` same path; maps
  `api:DocumentIdAlreadyExists` into the error taxonomy.
- Every response carries `Terminusdb-Data-Version`
  (`branch:<opaque-id>`); the adapter surfaces this value only through
  `normalize_data_version` / typed wrappers (D5).

### D3 — Commit boundary and batch size

**Decision:** Every HTTP write = one commit. Ingest MUST batch document
bodies at **batch size 500** (matching R8's measurement). Partial final
batches (<500) are one commit each. No multi-call open-transaction API
is modeled. Commits are single-parent; merge ancestry is not modeled
through the commit graph.

### D4 — Author encoding for run_id / lane / attempt

**Decision:** There is no structured JSON commit metadata — only plain
`author` and `message` strings. The adapter packs Foreman identity into
`author` with a deterministic encoding and matching parser:

```
author = "fm" + DELIM + run_id + DELIM + lane + DELIM + attempt
DELIM  = "|"
```

Example: `fm|run-2026-07-18T12:00:00Z|lane-7|1`

Rules:

- Prefix `fm` identifies Foreman-authored commits.
- `run_id`, `lane`, and `attempt` MUST NOT contain `|`. The encoder
  **rejects** (raises `AdapterValidationError`) any component that
  contains the delimiter — fail closed, never silently truncate or
  escape.
- `attempt` is a non-negative integer rendered in decimal without
  leading zeros (except `0` itself).
- `message` remains free-form commit message text (ingest summary,
  schema message, etc.); it is not parsed for identity.
- Decoder: split on `|`; require exactly 4 segments with first == `fm`;
  otherwise raise `AdapterValidationError` (unknown / non-Foreman
  author strings are not silently coerced).

### D5 — CAS wrapper and write shapes

**Decision:** Public write API takes explicit `cas_required: bool`
(and, when true, a `data_version` precondition). The adapter:

| Write shape | `cas_required` | Behavior |
| --- | --- | --- |
| Fan-in append, distinct documents | `false` | No `TerminusDB-Data-Version` request header; concurrent writers OK (R8 Test 1). |
| Shared-document read-modify-write | `true` | MUST send last-read version as request header; on `api:DataVersionMismatch` map to retryable conflict. |
| Tagged RMW / shared-doc but CAS omitted | — | **Refuse before HTTP**: raise `CasRequiredError`. Hard requirement, not a lint. |

CAS is branch-scoped: any other commit on the branch invalidates the
token. Therefore the adapter never applies blanket CAS on every write
(that would cause retry storms under N concurrent lanes).

Retry on `DataVersionMismatch`: bounded exponential backoff, max **3**
retries after the initial attempt (4 attempts total), base delay 50ms,
multiplier 2, full jitter. Exhaustion → `ConflictError` (non-success to
caller). See D11.

Operational note (not owned here): `TERMINUSDB_SERVER_WORKERS` defaults
to 8; raise before running >8 concurrent lanes — Council 3 ops package
owns the deployment config.

### D6 — normalize_data_version (diff footgun)

**Decision:**

```text
normalize_data_version(ref: str) -> DataVersionRef
```

- If `ref` starts with `branch:`, strip that prefix → bare branch name
  (e.g. `branch:main` → `main`).
- Bare names (`main`), `commit:<id>`, and loud-safe forms such as
  `admin/foreman/local/branch/main` pass through after validation.
- The type `DataVersionRef` is the **only** accepted type for
  `before_data_version` / `after_data_version` fields on diff (and any
  other `*_data_version` request field). Call sites cannot pass a raw
  `str` into those fields without going through normalization.
- A post-condition assert: if the value still starts with `branch:`
  after normalization, raise `AdapterValidationError` (must not reach
  HTTP).
- Canary (a): fixture that attempts a diff with a `branch:`-prefixed
  ref and asserts rejection **before** the HTTP call; with the
  assertion/normalization machinery disabled, the canary suite MUST go
  red.

### D7 — Non-empty query wrapper (WOQL footgun)

**Decision:** Query-issuing function signature includes:

```text
expect: "results" | "empty" | "unknown"
```

| expect | Zero rows | Non-zero rows |
| --- | --- | --- |
| `"results"` | raise `UnexpectedEmptyResultError` | return rows |
| `"empty"` | return empty | return rows (no raise) |
| `"unknown"` | return empty; emit a distinct log line tagged `woql_expect_unknown` (greppable) | return rows + same log class is not required |

`"unknown"` is permitted only for exploratory/debug call sites.

Canary (b): fixture that reproduces anyURI-vs-string-literal unification
failure and asserts `expect="results"` raises; with machinery disabled,
suite MUST go red.

### D8 — Distinct mandatory around Path queries

**Decision:** The function that builds a Path-typed WOQL query is private
and only reachable through a wrapper that injects the store's `Distinct`
operator around the Path expression. There is no public API to issue a
raw Path query without Distinct. (R8 §6.1(a): 10 rows for 4 distinct
answers without Distinct.)

### D9 — Ingest pipeline

**Decision:**

1. **Source refusal:** Ingest entry point accepts only a path/handle to a
   NetworkX `node_link_data` JSON document whose top-level keys include
   `directed`, `multigraph`, `graph`, `nodes`, `links` (and may include
   `hyperedges`, `built_at_commit`). If the path basename is
   `cypher.txt` or the payload looks like a graph-DB export (Cypher
   statements / Neo4j / FalkorDB export), raise
   `IngestSourceError` naming the fields that path drops:
   `source_file`, `source_location`, `confidence_score`, `weight`,
   `context`, `rationale`, `author`, `contributor`, `source_url`,
   `captured_at`, `verification`, `metadata`, hyperedges, communities,
   `built_at_commit`, plus risk of direction-inverted edges (bug #563).

2. **Two-pass ordering:**
   - Pass 1: upsert all node (and hyperedge-as-object) documents in
     batches of 500.
   - Pass 2: upsert all link/edge documents (after reification
     classification) in batches of 500.
   - Never emit a link whose endpoint documents are not yet written in
     this ingest (or already present from a prior idempotent ingest).

3. **Idempotency:** For each batch, compute a content hash over the
   canonical serialized batch payload. If the same hash was successfully
   committed for this org/db in a prior ingest (adapter-local or
   store-recorded batch ledger — implementation chooses durable ledger
   inside the adapter boundary), skip the HTTP write. Re-ingest of an
   unchanged `graph.json` is a no-op success.

4. **Producing graphify version stamp:** `graph.json` does **not**
   carry the producing graphify version. The caller MUST supply
   `graphify_version: str` to the ingest function; the adapter stamps it
   onto every written document (field name coordinated with Council 1
   schema package; adapter owns the stamping action). Missing stamp →
   `AdapterValidationError` before any write.

5. **Node fields consumed (verified sample shape):** `label`,
   `file_type` ∈ {code, document, paper, image, rationale, concept},
   `source_file`, `source_location` (str|null), `_origin` (`"ast"` or
   absent), `id`, `community`, `norm_label`, optional `metadata` (~13%
   of nodes in the live 3,579-node Foreman graph). Links carry relation
   type, endpoints, and optional edge properties subject to D10.
   Hyperedges-as-objects, `_origin`, `built_at_commit`, and
   `community_name` are preserved when present — they coexist only in
   `graph.json`.

6. **Schema writes during ingest bootstrap:** any schema document write
   uses D2 (`full_replace=true` always). Concrete class shapes come from
   Council 1; this package only performs the HTTP write correctly.

### D10 — Reification classifier

**Decision:** Every edge property on a link resolves to **exactly one**
of:

| Class | Meaning |
| --- | --- |
| `reify` | Promote edge+properties to a reified document (edge becomes a node-like document with endpoint refs). |
| `drop-with-record` | Drop the property from the stored edge; record the drop in an adapter-side ingest report (not silent). |
| `fold-onto-node` | Fold the property onto one endpoint node document (deterministic endpoint rule documented in code). |
| `fail` | Abort ingest with `ReificationError` naming property and edge. |

The classifier is a pure function
`classify_edge_property(name, value) -> one of the four`. Unknown
properties default to `fail` (fail closed). Concrete property→class
tables may be extended in implementation without changing this closed
outcome set. Hyperedge objects follow the same property rules where
properties appear.

### D11 — Rename-with-lineage detection

**Decision:** When two consecutive successful ingests expose distinct
`built_at_commit` SHAs (from `graph.json`), the adapter runs a git
rename correlation between those SHAs (`git diff --name-status -M`
or equivalent) in the repo work tree supplied by the caller.

- Detected renames (`R*`) produce lineage edges / document updates that
  link the old `source_file` identity to the new one so graph identity
  does not silently fork.
- If git is unavailable, SHAs are missing, or correlation fails, raise
  `RenameCorrelationError` (or skip with explicit report flag
  `rename_detection: "skipped"` only when the caller sets
  `allow_rename_skip=true`; default is fail closed on partial evidence
  when both SHAs are present but git fails).
- Synthetic file-move fixture is required in tests (tasks T-gate).

### D12 — Error taxonomy and retry policy

**Closed error set (adapter-raised names):**

| Error | Meaning | Retry? |
| --- | --- | --- |
| `AdapterValidationError` | Bad args, delimiter in identity fields, missing graphify_version, post-normalize `branch:` leak | No |
| `CasRequiredError` | Shared-doc RMW without CAS precondition | No |
| `ConflictError` | CAS mismatch exhausted retries / unrecoverable conflict | No (after policy) |
| `DataVersionMismatchError` | Single CAS mismatch (internal; may be retried) | Yes — bounded |
| `UnexpectedEmptyResultError` | `expect="results"` and zero rows | No |
| `IngestSourceError` | Wrong source file kind (cypher / export) | No |
| `ReificationError` | Edge property classified `fail` | No |
| `RenameCorrelationError` | Rename detection failed with fail-closed policy | No |
| `AuthError` | 401/403 | No |
| `NotFoundError` | 404 db/document | No |
| `DocumentIdAlreadyExistsError` | Strict-create POST collision | No |
| `TransportError` | Network/timeout/5xx | Yes — bounded |
| `ServerError` | Other 4xx mapped after body parse | No (unless classified mismatch) |
| `DropRebuildError` | Drop-and-rebuild preconditions failed | No |

**Retry policy:**

- Retryable classes: `DataVersionMismatchError` (CAS path),
  `TransportError` (and 5xx folded into it).
- Bound: max **3** retries (4 attempts total).
- Backoff: exponential, base **50ms**, multiplier **2**, **full jitter**.
- Non-retryable classes fail immediately to the caller.
- Retry counters and final error class MUST be visible in structured logs.

### D13 — Drop-and-rebuild

**Decision:** `drop_and_rebuild(...)` is an adapter function that:

1. Deletes graph.json-derived documents for the target org/db (or drops
   and recreates the database — implementation may choose DB drop if
   cheaper; either way the post-condition is empty of graph.json-derived
   facts).
2. Re-runs full ingest from a supplied `graph.json` + `graphify_version`.
3. **Scope boundary:** ONLY graph.json-derived facts are removed and
   rebuilt. Event-log-derived documents, pins, and ops metadata owned by
   Council 3 are **not** deleted by this function. If the implementation
   uses whole-DB drop, it MUST re-apply non-graph facts from their
   sources of truth or refuse whole-DB drop when such facts exist
   (`DropRebuildError`). Default safe path: selective delete of
   graph.json-derived `@type`s (types named by Council 1 schema package)
   then re-ingest.

## Alternatives Considered

### Adopt the official `terminusdb` Python client

**Rejected.** Dependabot-only maintenance since Feb 2026 means no human
is verifying its API surface against server behavior; the v12 client is
~105 npm-downloads/month adoption on the JS side (effectively unproven);
vendor docs still predominantly show the abandoned `terminusdb-client`
import path; and R8 verified every documented capability over raw HTTP
already, so the client buys nothing but an extra dependency with a
weaker maintenance signal than the server itself.

### Adopt `terminusdb-client` (v10.2.6)

**Rejected.** Last released Nov 2023; superseded by `terminusdb` v12;
same thin-wrapper concerns; docs drift risk is the problem statement,
not the solution.

### Adopt `@terminusdb/terminusdb-client` (JS/TS)

**Rejected.** Wrong language for this Foreman adapter surface; 502
npm downloads/month and dependabot-only maintenance; same R8 conclusion
to skip thin clients.

### Blanket CAS on every write

**Rejected.** CAS tokens are branch-scoped. Under N concurrent lanes,
any commit invalidates every other writer's token → retry storm. Caller
explicit `cas_required` per write shape is mandatory.

### Per-document commits for ingest

**Rejected.** ~35 commits/s serial vs ~1,070 docs/s at batch 500 (R8).
Batch size 500 is a hard requirement.

### Ingest from `graphify export neo4j` / FalkorDB / `cypher.txt`

**Rejected.** That path emits five fields total and drops high-fidelity
fields; can direction-invert edges (bug #563). `graph.json` only.

### Multi-call open transaction API

**Rejected.** Server has no multi-call open-transaction API; one HTTP
write = one commit. Batch body is the batching primitive.

### Model multi-parent merge commits

**Rejected.** Upstream issue #2430 open; commits are single-parent.
Do not model merge ancestry through the commit graph.

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| Undocumented CAS header / full_replace papercut drift on server upgrade | Canaries + adapter integration tests pin observed behavior; Council 3 health checks |
| Branch-scoped CAS surprises callers | Explicit `cas_required`; refuse RMW without CAS; document write shapes |
| Official docs push abandoned clients | This design freezes raw HTTP; do not "fix" by adopting SDK later without a new change package |
| Reification `fail` default blocks ingest on new edge properties | Ingest report lists failures; classifier table is intentionally fail-closed |
| Rename detection needs git + SHAs | Fail closed by default when both SHAs present but correlation fails; synthetic fixture in CI |
| Whole-DB drop could wipe ops facts | D13 selective delete default; refuse unsafe whole-DB drop |
| Worker default 8 caps concurrency | Operational note → Council 3; adapter does not silently raise workers |
| Silent empty diffs/queries if wrappers bypassed | Structural types + canaries that fail when disabled |

## Migration Plan

1. Land this OpenSpec package (`openspec validate terminusdb-adapter --strict`).
2. Implement client module → CAS / normalize / non-empty / Path-Distinct
   wrappers → ingest → rename detection → drop-and-rebuild (see tasks.md).
3. Council 1 schema package must provide document classes before
   production ingest (adapter can still unit-test HTTP with fixtures).
4. Council 3 brings up server, secrets, workers, backup/pin.
5. Feature-flag first live ingest against a non-prod org/db; run
   idempotent re-ingest and rename fixture.
6. Port-level repo-scan confirms no TerminusDB HTTP outside adapter.
7. Rollback: point `GraphStore` factory back to files-only backend from
   `graph-store-port`; leave adapter code dormant. No data migration
   required for rollback if production cutover has not yet marked
   TerminusDB as source of truth (cutover flag owned at composition
   root, not this package).

## Open Questions

1. Exact durable ledger location for content-hash batch skip (adapter
   local table vs a TerminusDB document type from Council 1) — decide
   at implement time inside the adapter boundary.
2. Fold-onto-node endpoint selection rule when an edge is undirected —
   default to source endpoint unless Council 1 schema says otherwise.
3. Whether hyperedge ingestion uses a dedicated `@type` name — Council 1
   names it; adapter maps the `hyperedges` array when present.
4. Cross-package: confirm event-log document `@type` list with Council 3
   so drop-and-rebuild selective delete cannot collide.
