# Capability: store-adapter

TerminusDB-specific client, connection/auth, commit boundaries, CAS and
non-empty wrappers, `graph.json` ingest, rename-with-lineage, error
taxonomy, retry policy, and drop-and-rebuild. Satisfies the `GraphStore`
port for the TerminusDB backend. Schema class shapes are owned by the
Council 1 schema/ontology package; deploy/pin/backup/health/query-DSL
lifecycle is owned by the Council 3 operations package.

## ADDED Requirements

### Requirement: Adapter targets the HTTP API directly

The TerminusDB adapter SHALL issue all server interactions over raw HTTP
using a general-purpose HTTP library (Python `httpx` or `requests`) and
SHALL NOT depend on, import, or wrap the official packages `terminusdb`,
`terminusdb-client`, or `@terminusdb/terminusdb-client`.

#### Scenario: Raw HTTP client is used for a document write

- WHEN the adapter performs a document upsert against a live or mocked
  TerminusDB server
- THEN the request is an HTTP `PUT` or `POST` to
  `/api/document/{org}/{db}` (with required query parameters) issued by
  the raw HTTP library
- AND no official TerminusDB client package is imported in the adapter
  module graph

#### Scenario: Official client dependency is forbidden

- WHEN the adapter's declared dependencies are inspected
- THEN neither `terminusdb` nor `terminusdb-client` appears as a runtime
  dependency of the adapter

---

### Requirement: Connection and Basic authentication

The adapter SHALL connect to a TerminusDB server (default base URL
`http://127.0.0.1:6363`) using HTTP Basic authentication with username
`admin` and password from the environment variable
`TERMINUSDB_ADMIN_PASS`. WHERE `TERMINUSDB_ADMIN_PASS` is unset and the
adapter is asked to perform a live-server operation, the adapter SHALL
raise `AuthError` (or `AdapterValidationError`) before issuing the
request. The adapter SHALL treat the server as single-node HTTP on port
6363 and SHALL NOT assume an embedded or in-process mode.

#### Scenario: Missing admin password fails closed

- WHEN a live write is requested and `TERMINUSDB_ADMIN_PASS` is unset
- THEN the adapter raises before the HTTP call
- AND no request reaches the server

#### Scenario: Database create uses verified endpoint shape

- WHEN the adapter creates a database
- THEN it sends `POST /api/db/{org}/{db}` with Basic auth

---

### Requirement: Schema writes always pass full_replace=true

WHEN the adapter writes schema documents (including payloads that
contain an `@context` object), it SHALL always pass
`full_replace=true` on the schema write request and SHALL NOT make
`full_replace` conditional on payload inspection.

#### Scenario: Schema replace includes full_replace

- WHEN the adapter loads or replaces schema via
  `POST /api/document/{org}/{db}` with `graph_type=schema`
- THEN the query string includes `full_replace=true`
- AND includes `author` and `message` parameters

#### Scenario: Context payload still forces full_replace

- WHEN the schema payload contains an `@context` object
- THEN the request still includes `full_replace=true`
- AND the adapter does not omit `full_replace` under any branch

---

### Requirement: Batched document writes at size 500

The adapter SHALL batch document upsert bodies at a maximum batch size
of 500 documents per HTTP write so that each successful batch is exactly
one commit. Single-document commits SHALL NOT be used for bulk ingest
paths. A final partial batch of fewer than 500 documents SHALL be sent
as one commit.

#### Scenario: Ingest of 1200 nodes uses three commits

- WHEN ingest upserts 1200 node documents
- THEN the adapter issues at most three document-write HTTP calls for
  those nodes (500 + 500 + 200)
- AND each call is one commit for its entire body

#### Scenario: Default ingest uses PUT upsert

- WHEN the bulk ingest path writes documents
- THEN it uses `PUT /api/document/{org}/{db}?create=true&author=...&message=...`
- AND does not use per-document serial commits for bulk data

---

### Requirement: Author-field encoding for run_id, lane, and attempt

The adapter SHALL encode Foreman commit identity into the TerminusDB
`author` plain-string field using the exact scheme
`fm|<run_id>|<lane>|<attempt>` with delimiter `|`. The encoder SHALL
reject (raise `AdapterValidationError`) any `run_id`, `lane`, or
`attempt` value that contains the delimiter character. The adapter
SHALL provide a matching parser that accepts only strings with exactly
four `|`-separated segments whose first segment is `fm`. The adapter
SHALL NOT assume any structured JSON commit metadata field exists.

#### Scenario: Valid identity encodes and parses round-trip

- WHEN `run_id="run-1"`, `lane="lane-7"`, `attempt=1` are encoded
- THEN `author` equals `fm|run-1|lane-7|1`
- AND the parser returns the same three identity components

#### Scenario: Delimiter inside run_id is rejected

- WHEN `run_id` contains `|`
- THEN the encoder raises `AdapterValidationError`
- AND no HTTP write is issued

#### Scenario: Non-Foreman author string fails parse

- WHEN the parser is given `author="R8"` or any string not matching the
  four-segment `fm|...` form
- THEN it raises `AdapterValidationError`

---

### Requirement: CAS wrapper refuses RMW without precondition and retries mismatch

The adapter's public write function SHALL accept an explicit
`cas_required` flag (or equivalent). WHEN `cas_required` is true, the
adapter SHALL send the caller-supplied data-version token as the
`TerminusDB-Data-Version` request header. WHEN a call site is tagged as
read-modify-write against a shared document and omits the CAS
precondition (`cas_required` true without a token, or an RMW-tagged call
with `cas_required` false), the adapter SHALL raise `CasRequiredError`
before issuing the HTTP call. WHEN the server returns HTTP 400 with
`@type` `api:DataVersionMismatch`, the adapter SHALL treat it as a
retryable conflict under the bounded retry policy (max 3 retries after
the initial attempt, exponential backoff base 50ms multiplier 2 with
full jitter) and SHALL raise `ConflictError` if retries are exhausted.

#### Scenario: Shared-document RMW without CAS is refused

- WHEN a write is tagged read-modify-write against a shared document and
  `cas_required` is false or the data-version token is missing
- THEN the adapter raises `CasRequiredError` before any HTTP request

#### Scenario: Stale CAS token retries then surfaces conflict

- WHEN `cas_required` is true and the server responds
  `api:DataVersionMismatch` on each attempt
- THEN the adapter retries at most 3 times after the first attempt
- AND finally raises `ConflictError` to the caller

#### Scenario: Successful CAS write sends precondition header

- WHEN `cas_required` is true and a valid `data_version` is supplied
- THEN the HTTP request includes request header `TerminusDB-Data-Version`
  with that value
- AND HTTP 200 commits the write

---

### Requirement: Fan-in appends of distinct documents require no CAS

WHERE concurrent writers append or upsert distinct document IDs on the
same branch, the adapter SHALL allow `cas_required=false` and SHALL NOT
require a `TerminusDB-Data-Version` request header for those calls.

#### Scenario: Distinct-document write without CAS is permitted

- WHEN a write targets a document ID not shared for read-modify-write and
  `cas_required` is false
- THEN the adapter issues the HTTP write without a
  `TerminusDB-Data-Version` request header
- AND does not raise `CasRequiredError`

#### Scenario: Concurrent distinct writers are not forced into CAS

- WHEN N callers upsert N distinct documents with `cas_required=false`
- THEN each call is eligible to succeed without CAS preconditions
- AND the adapter does not inject blanket CAS headers

---

### Requirement: normalize_data_version validates against the live branch list, never trusts a bare prefix-strip

The adapter SHALL define two distinct types: DataVersionToken (opaque,
produced only by read/write responses, usable only as a
TerminusDB-Data-Version request header) and DiffRef (a bare branch name or
commit:<id>, the only type accepted in before_data_version,
after_data_version, or any other *_data_version diff request field).

DataVersionToken SHALL NOT be accepted by any function whose parameter type
is DiffRef, and vice versa -- the two types SHALL NOT be interchangeable at
the type level.
normalize_data_version(ref: str) -> DiffRef SHALL strip a leading branch:
prefix only when the remainder, after stripping, is confirmed against the
live branch list or matches the commit:<id> shape; otherwise it SHALL raise
AdapterValidationError.
The adapter SHALL NOT document or encourage passing a raw
TerminusDB-Data-Version response header value into normalize_data_version
or any *_data_version diff field.

#### Scenario: a hand-written branch ref normalizes cleanly

- WHEN normalize_data_version("branch:main") is invoked and "main" is
  present in the live branch list
- THEN the result is the bare name "main" wrapped as DiffRef

#### Scenario: an opaque response-header token is rejected, not silently accepted

- WHEN normalize_data_version is given the stripped remainder of a real
  TerminusDB-Data-Version header value (an opaque id, not a branch name)
- THEN the remainder does not match any name in the live branch list
- AND the adapter raises AdapterValidationError rather than returning a
  value that merely lacks a branch: prefix

#### Scenario: commit refs normalize cleanly

- WHEN normalize_data_version is given commit:<id>
- THEN the function returns a DiffRef without raising

#### Scenario: DataVersionToken and DiffRef are never interchangeable

- WHEN a DataVersionToken value is passed to a function typed to accept
  DiffRef (or vice versa)
- THEN the call is a type error, not a runtime coincidence that happens to
  work

---

### Requirement: Non-empty query wrapper with expect parameter

The adapter's query-issuing function SHALL take an explicit
`expect` parameter with allowed values `"results" | "empty" | "unknown"`.
WHEN `expect="results"` and the query returns zero rows, the adapter
SHALL raise `UnexpectedEmptyResultError`. WHEN `expect="empty"`, the
adapter SHALL NOT raise solely because zero rows returned. WHEN
`expect="unknown"`, the adapter SHALL NOT raise on zero rows and SHALL
emit a distinct log line tagged `woql_expect_unknown` so production
call sites can be grepped.

#### Scenario: expect results raises on empty bindings

- WHEN a WOQL query is issued with `expect="results"` and the server
  returns zero bindings
- THEN the adapter raises `UnexpectedEmptyResultError`

#### Scenario: expect empty never raises on zero rows

- WHEN a WOQL query is issued with `expect="empty"` and zero rows return
- THEN the adapter returns an empty result without raising

#### Scenario: expect unknown logs a greppable marker

- WHEN a WOQL query is issued with `expect="unknown"`
- THEN the adapter logs a line containing `woql_expect_unknown`
- AND returns the rows (empty or not) without raising on emptiness

---

### Requirement: Distinct is structurally mandatory around Path queries

The adapter SHALL wrap the store's `Distinct` operator around every
Path-typed WOQL query it issues. The function that builds a Path query
SHALL NOT be callable from outside the adapter without going through the
Distinct wrapper (structural enforcement, not a per-call-site reminder).

#### Scenario: Path query is issued only with Distinct

- WHEN the adapter executes a lineage or other Path-typed WOQL query
- THEN the issued WOQL includes a `Distinct` operator wrapping the Path
  expression

#### Scenario: No public raw Path builder without Distinct

- WHEN public adapter APIs for Path queries are inspected
- THEN every path that can emit a Path operator also applies Distinct
- AND there is no exported function that sends Path without Distinct

---

### Requirement: /api/log is a structurally banned endpoint

The adapter SHALL NOT call /api/log on any query path, and SHALL NOT issue
a commit-log query using non-zero start (offset) paging. WHEN a call site
attempts either, the adapter SHALL raise BannedEndpointError naming the
attempted endpoint, before any HTTP request is issued.

#### Scenario: a direct /api/log call is refused before HTTP

- WHEN any code path attempts to call /api/log
- THEN the adapter raises BannedEndpointError naming /api/log
- AND no HTTP request reaches the server

#### Scenario: non-zero offset paging against the commit log is refused

- WHEN a commit-log query is attempted with a non-zero start parameter
- THEN the adapter raises BannedEndpointError before the HTTP call

#### Scenario: the ban is proven by a negative test, not by absence of code

- WHEN the adapter test suite runs its /api/log negative test
- THEN attempting the banned call raises BannedEndpointError
- AND a grep of the adapter module graph finds no direct /api/log call
  outside this enforcement path

---

### Requirement: Canary fixtures fail closed when disabled

The adapter test suite SHALL include two named canary fixtures:
(a) `canary_branch_prefix_diff` — covers BOTH the hand-written
`branch:main` form AND the opaque-token form (a stripped remainder that
does not match the live branch list must also be rejected), and asserts
the wrapper rejects each before the HTTP call; (b)
`canary_anyuri_string_unification` — reproduces the
anyURI-vs-string-literal WOQL unification failure and asserts that
`expect="results"` raises. Both canaries SHALL be proven to fail (test
suite goes red) if the assertion or normalization machinery is disabled.

#### Scenario: Branch-prefix canary rejects before HTTP

- WHEN `canary_branch_prefix_diff` runs against a correctly wired adapter
- THEN the assertion passes because normalization/refusal prevents the
  HTTP call for both the hand-written `branch:main` form and an
  opaque-token form that does not match the live branch list

#### Scenario: anyURI canary expects UnexpectedEmptyResultError

- WHEN `canary_anyuri_string_unification` runs with `expect="results"` on
  a query that unifies a URI-typed value with a string literal via `eq/2`
- THEN the adapter raises `UnexpectedEmptyResultError` (or the canary
  asserts that raise path)

#### Scenario: Canaries fail closed when machinery is disabled

- WHEN the test suite is run with normalization or expect-empty
  assertions disabled (as specified in tasks.md gate)
- THEN both canaries fail (suite red)
- AND the failure is observed by running the suite, not by reading code

---

### Requirement: Ingest reads graph.json only and refuses export files

The ingest function SHALL read NetworkX `node_link_data` JSON
(`graphify-out/graph.json` shape with top-level keys including
`directed`, `multigraph`, `graph`, `nodes`, `links`, and optionally
`hyperedges`, `built_at_commit`). WHEN handed a `cypher.txt` path or any
graph-database export file (Neo4j / FalkorDB / Cypher export), the
ingest function SHALL raise `IngestSourceError` and SHALL name fields
that export path drops, including at minimum: `source_file`,
`source_location`, `confidence_score`, `weight`, `context`, `rationale`,
`author`, `contributor`, `source_url`, `captured_at`, `verification`,
`metadata`, hyperedges, communities, `built_at_commit`.

#### Scenario: graph.json ingest is accepted

- WHEN ingest is given a valid `graph.json` node_link_data document
- THEN parsing proceeds without `IngestSourceError`

#### Scenario: cypher.txt is refused by name

- WHEN ingest is given a path whose basename is `cypher.txt`
- THEN it raises `IngestSourceError`
- AND the error message names dropped fields including `source_file`
  and `built_at_commit`

---

### Requirement: Two-pass ingest ordering documents before links

The ingest pipeline SHALL write node (and hyperedge-as-object) documents
in pass 1 before link/edge documents in pass 2, each pass using batch
size 500. IF a link references endpoints, THEN those endpoint documents
SHALL have been written in pass 1 of this ingest or already present from
a prior successful ingest.

#### Scenario: Nodes commit before edges

- WHEN ingest runs on a graph with both nodes and links
- THEN all node-document batch writes complete before the first
  link-document batch write

#### Scenario: Hyperedges are part of document pass when present

- WHEN `graph.json` contains a non-empty `hyperedges` array
- THEN hyperedge-as-object documents are written in the document pass
  before link pass completion requirements are evaluated

---

### Requirement: Ingest idempotency via content-hash batch skip

The adapter SHALL compute a content hash over each canonical batch
payload and SHALL skip HTTP write for a batch whose hash was already
successfully committed for the target org/db. Re-ingest of an unchanged
`graph.json` SHALL succeed as a no-op (no duplicate-commit requirement).

#### Scenario: Second identical ingest skips writes

- WHEN ingest has succeeded once for a given `graph.json` content
- AND ingest is invoked again with the same content and org/db
- THEN batch HTTP writes are skipped via content-hash match
- AND the call returns success

#### Scenario: Changed node invalidates hash skip for that batch

- WHEN a single node payload changes between ingests
- THEN the batch containing that node is rewritten
- AND unchanged batches may still skip

---

### Requirement: Producing graphify version is stamped from caller

The ingest function SHALL require a caller-supplied
`graphify_version: str` and SHALL stamp that value onto written
documents. The stamped field is `graphify_version` on the `GraphNode` base
class the schema package declares; the adapter SHALL NOT invent or rename
this field. The adapter SHALL NOT read producing graphify version from
`graph.json` (it is absent there). WHEN `graphify_version` is missing
or empty, the adapter SHALL raise `AdapterValidationError` before any
write.

#### Scenario: Caller stamp is applied

- WHEN ingest runs with `graphify_version="1.2.3"`
- THEN written documents carry that producing-version stamp on the
  `graphify_version` field

#### Scenario: Missing graphify_version fails closed

- WHEN ingest is invoked without a non-empty `graphify_version`
- THEN `AdapterValidationError` is raised
- AND no document write HTTP calls occur

---

### Requirement: Reification classifier closed outcome set

For every edge property on a link (and property on hyperedges where
applicable), the adapter SHALL resolve the property to exactly one of
`reify`, `drop-with-record`, `fold-onto-node`, or `fail` via
`classify_edge_property`. Unknown properties SHALL default to `fail`.
WHEN classification is `fail`, ingest SHALL raise `ReificationError`
naming the property and edge. WHEN classification is `drop-with-record`,
the drop SHALL be recorded in the ingest report (not silent).

#### Scenario: Unknown property fails closed

- WHEN an edge carries a property name not present in the allow/classify
  table
- THEN classification is `fail`
- AND ingest raises `ReificationError`

#### Scenario: Each property maps to exactly one class

- WHEN `classify_edge_property` is invoked for a known property
- THEN the result is exactly one of `reify`, `drop-with-record`,
  `fold-onto-node`, or `fail`
- AND never more than one class

---

### Requirement: ingest classifies every node kind and edge relation type against the schema's mapping manifest

The ingest function SHALL classify every graphify node's file_type and every
graphify edge's relation type against the terminusdb-schema package's
published mapping manifest, identified by manifest_version, rather than
inventing its own class or field mapping.

WHEN a node's file_type is absent from the current manifest_version's
node-kind table, the adapter SHALL raise UnmappedNodeKindError naming the
node id and file_type, before any write for that node.
WHEN an edge's relation type is absent from the current manifest_version's
edge-relation table, the adapter SHALL classify it fail via
classify_edge_relation and SHALL raise ReificationError naming the relation
type and edge.
WHEN graph.json carries a non-empty hyperedges array, the adapter SHALL
classify every hyperedge object drop-with-record under manifest_version 1
and SHALL record the drop in the ingest report.

#### Scenario: a mapped node kind writes under its manifest class

- WHEN ingest processes a node with file_type "concept"
- THEN the document is written as an Entity with kind EntityKind.concept,
  per the manifest's node-kind table

#### Scenario: an unmapped node kind is rejected before any write

- WHEN ingest processes a node whose file_type is not in the manifest
- THEN UnmappedNodeKindError is raised naming the node id and file_type
- AND no document write HTTP call occurs for that node

#### Scenario: an unmapped edge relation type fails closed

- WHEN ingest processes an edge whose relation type is not in the
  manifest's edge-relation table
- THEN classify_edge_relation resolves it to fail
- AND ReificationError is raised naming the relation type and edge

#### Scenario: hyperedges are recorded, not silently dropped

- WHEN graph.json carries hyperedges
- THEN each is classified drop-with-record under the pinned manifest_version
- AND the ingest report records the drop

---

### Requirement: Rename-with-lineage detection via git correlation

WHEN two consecutive successful ingests expose distinct
`built_at_commit` SHAs, the adapter SHALL correlate file renames between
those SHAs using git rename detection in the caller-supplied repository
work tree and SHALL record lineage so graph identity follows the rename.
WHERE both SHAs are present and git correlation fails, the adapter SHALL
raise `RenameCorrelationError` unless the caller set
`allow_rename_skip=true`.

#### Scenario: File rename produces lineage linkage

- WHEN `built_at_commit` advances across a git rename of `source_file`
- THEN ingest records lineage linking the old path identity to the new
  path

#### Scenario: Correlation failure fails closed by default

- WHEN both SHAs are present and git rename correlation cannot run
- AND `allow_rename_skip` is not true
- THEN the adapter raises `RenameCorrelationError`

---

### Requirement: Error taxonomy and retry policy

The adapter SHALL raise errors only from the closed set:
`AdapterValidationError`, `CasRequiredError`, `ConflictError`,
`DataVersionMismatchError`, `UnexpectedEmptyResultError`,
`IngestSourceError`, `ReificationError`, `UnmappedNodeKindError`,
`BannedEndpointError`, `RenameCorrelationError`,
`AuthError`, `NotFoundError`, `DocumentIdAlreadyExistsError`,
`TransportError`, `ServerError`, `DropRebuildError`. Retryable classes
SHALL be limited to `DataVersionMismatchError` (CAS path) and
`TransportError` (including 5xx). The retry bound SHALL be max 3
retries after the initial attempt with exponential backoff base 50ms,
multiplier 2, and full jitter. All other classes (including
`UnmappedNodeKindError` and `BannedEndpointError`) SHALL fail immediately
without retry.

#### Scenario: Transport error is retried with bounded backoff

- WHEN a write fails with a retryable transport/5xx error
- THEN the adapter retries up to 3 times after the first attempt using
  exponential backoff with full jitter
- AND surfaces `TransportError` (or mapped final error) if exhausted

#### Scenario: Validation errors are not retried

- WHEN `AdapterValidationError` or `CasRequiredError` is raised
- THEN the adapter does not retry
- AND the error propagates to the caller immediately

---

### Requirement: Drop-and-rebuild scoped to graph.json-derived facts

The adapter SHALL provide `drop_and_rebuild` that removes
graph.json-derived facts for the target org/db and re-runs full ingest
from a supplied `graph.json` and `graphify_version`. The function SHALL
NOT delete event-log-derived documents, pins, or operations metadata
owned by the Council 3 operations package. WHERE a whole-database drop
would remove non-graph facts, the adapter SHALL refuse with
`DropRebuildError` or re-apply those facts from their sources of truth;
the default safe path is selective delete of graph.json-derived types
then re-ingest.

#### Scenario: Rebuild re-ingests graph.json facts

- WHEN `drop_and_rebuild` runs with a valid `graph.json` and
  `graphify_version`
- THEN prior graph.json-derived documents are removed
- AND ingest repopulates from the supplied graph

#### Scenario: Event-log-derived facts are preserved

- WHEN event-log-derived documents exist in the same org/db
- AND `drop_and_rebuild` runs
- THEN those event-log-derived documents remain
- AND only graph.json-derived facts are rebuilt

---

### Requirement: Response data-version is surfaced only via normalization path

WHEN the server returns a `Terminusdb-Data-Version` response header, the
adapter SHALL expose that value typed as `DataVersionToken`, not
`DiffRef`. It is usable only as a CAS request header; it SHALL NOT be
passed to `normalize_data_version` or placed in any `*_data_version` diff
field. The adapter SHALL NOT document or encourage round-tripping the raw
`branch:<id>` header value into diff fields.

#### Scenario: Read returns a version token for optional CAS

- WHEN a document read succeeds
- THEN the adapter returns the payload and a `DataVersionToken`
- AND using that token as a CAS precondition on a later write is
  supported when `cas_required` is true
- AND using that token as a diff ref is not supported

---

### Requirement: Operational note on server workers is documented only

The adapter specification SHALL note that `TERMINUSDB_SERVER_WORKERS`
defaults to 8 and must be raised before running more than 8 concurrent
lanes, and SHALL cross-reference the Council 3 operations package for
actual deployment configuration. The adapter itself SHALL NOT own or
mutate that deployment config.

#### Scenario: Adapter does not set TERMINUSDB_SERVER_WORKERS

- WHEN the adapter starts or issues writes
- THEN it does not require mutating `TERMINUSDB_SERVER_WORKERS`
- AND operational scaling remains outside this package's runtime duties

---

### Requirement: Strict-create mode maps DocumentIdAlreadyExists

WHEN the adapter is invoked in strict-create mode, it SHALL use HTTP
`POST` to `/api/document/{org}/{db}` and SHALL map
`api:DocumentIdAlreadyExists` to `DocumentIdAlreadyExistsError`. The
default ingest path SHALL continue to use PUT upsert, not strict-create.

#### Scenario: Duplicate strict create raises named error

- WHEN strict-create POST targets an existing document ID
- THEN the adapter raises `DocumentIdAlreadyExistsError`

---

### Requirement: Single-parent commits only

The adapter SHALL model each write as a single-parent commit and SHALL
NOT invent multi-parent merge ancestry through the TerminusDB commit
graph (upstream multi-parent commits unsupported).

#### Scenario: Batch write is one commit

- WHEN a batch PUT of up to 500 documents succeeds
- THEN exactly one commit corresponds to that HTTP write
- AND no merge-commit API is called
