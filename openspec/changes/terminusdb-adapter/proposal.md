# Change: TerminusDB client, adapter, and ingest path

## Why

Foreman needs a concrete `GraphStore` backend so that graph-backed
cross-run query, versioned commits, and schema-enforced storage can ship
in v0.2.9. The sibling package `openspec/changes/graph-store-port/`
defines the port contract and previously framed TerminusDB as
deferrable behind GP-7's query census. The product owner has decided
that TerminusDB ships in this release. This package owns the client
choice, connection and auth mechanics, transaction and commit
boundaries, the CAS and non-empty wrappers, the `graph.json` ingest
pipeline (including reification classification and rename-with-lineage
detection), the adapter error taxonomy and retry policy, and the
drop-and-rebuild command — everything required to satisfy the port for
TerminusDB specifically.

Schema and ontology class definitions live in the sibling schema /
ontology package (Council 1). Operations, pinning, backup, health-check,
query-DSL surface, and lifecycle deployment config live in the sibling
operations package (Council 3). This package references those packages
by name where the adapter necessarily touches them, and does not
duplicate their scope.

## What Changes

- Introduce a raw-HTTP TerminusDB adapter (Python `httpx` or `requests`)
  behind the `GraphStore` port. Official Python/JS clients are rejected
  (see design Alternatives).
- Connection and Basic-auth mechanics against
  `terminusdb/terminusdb-server:latest` on `:6363`, using env
  `TERMINUSDB_ADMIN_PASS` (required at container start; no default).
- Schema-write path that always passes `full_replace=true` (mandatory
  whenever the payload contains `@context`; never conditional).
- Batched document writes (batch size 500) so ingest is one commit per
  batch, not one commit per document.
- Deterministic `author` encoding/parser for `run_id` + `lane` +
  `attempt` (plain-string only; no structured commit metadata).
- CAS wrapper driven by explicit caller `cas_required`, with hard
  refusal of shared-document read-modify-write calls that omit the
  `TerminusDB-Data-Version` precondition; version-mismatch is a
  bounded retryable conflict.
- `normalize_data_version` that strips/rejects the silent-empty
  `branch:` prefix form before any `*_data_version` field.
- Non-empty query wrapper with `expect: "results" | "empty" | "unknown"`.
- Structural `Distinct` wrapping of every `Path`-typed WOQL query.
- Two canary fixtures that fail closed when normalization / expect
  machinery is disabled.
- Ingest from `graphify-out/graph.json` only (refuse Cypher / graph-DB
  export files by name); two-pass ordering (documents before links);
  content-hash batch skip for idempotent re-ingest; caller-supplied
  producing-graphify-version stamp.
- Edge-property reification classifier
  (`reify` | `drop-with-record` | `fold-onto-node` | `fail`).
- Rename-with-lineage detection via git rename correlation between
  consecutive `built_at_commit` SHAs.
- Closed error taxonomy and per-class retry policy.
- Drop-and-rebuild adapter function scoped to graph.json-derived facts
  only (event-log-derived facts are out of scope for this function).

## Capabilities

### New Capabilities

- `store-adapter`: TerminusDB-specific client, connection/auth,
  transaction/commit boundaries, CAS and non-empty wrappers, ingest
  pipeline from `graph.json`, rename-with-lineage detection, error
  taxonomy, retry policy, and drop-and-rebuild. Satisfies the
  `GraphStore` port contract for the TerminusDB backend without
  re-stating port-level behavioral requirements.

### Modified Capabilities

- (none — this package does not modify existing OpenSpec capability
  specs; it adds the concrete adapter capability that the
  `graph-store-port` package's port assumes can exist)

## Impact

**Supersession of graph-store-port deferral framing.** The sibling
package framed TerminusDB as optional pending GP-7. The product owner's
ship decision for v0.2.9 supersedes all three quotes below — TerminusDB
is no longer a deferrable "if the census wants it" question; it ships
this release, so this package proceeds unconditionally rather than
pending GP-7.

- Quote A (`graph-store-port/proposal.md`, Impact section): "May be
  deferred by architect decision behind GP-7's query census (SYNTHESIS
  §5). If the census finds genuine multi-hop cross-run queries are rare,
  this package is frozen and nothing above it changes. The specs here
  are written so that deferral costs a decision, not a rewrite."
- Quote B (`graph-store-port/design.md`, opening framing): "1. Does
  Foreman need a queryable, versioned, schema-enforced store?
  Unresolved. GP-7's query census answers it. Nothing in this package
  pretends otherwise."
- Quote C (`graph-store-port/specs/store/spec.md`, requirement "a
  files-only implementation satisfies the port with no database"):
  "WHERE the files-only implementation cannot provide a capability, the
  omission SHALL be limited to time-travel, graph branch and merge, and
  cross-run query ergonomics."

**Affected code / surfaces (target, not yet present):**

- New adapter module under the Foreman store boundary (exact path set at
  implementation; all TerminusDB HTTP access MUST live inside this
  adapter so the port-level repo-scan gate continues to pass).
- Ingest entry point consuming `graphify-out/graph.json`.
- Config: `TERMINUSDB_ADMIN_PASS`, server URL (default
  `http://127.0.0.1:6363`), org/db names; worker-count note cross-refs
  Council 3 ops package for `TERMINUSDB_SERVER_WORKERS`.
- Depends on: `openspec/changes/graph-store-port/` (port contract),
  Council 1 schema/ontology package (document class shapes), Council 3
  operations package (deploy, pin, backup, health, query-DSL lifecycle).
- Does not edit: `graph-store-port`, schema package, or ops package.
- Client dependency: raw HTTP (`httpx` or `requests`) only — not
  `terminusdb`, not `terminusdb-client`, not
  `@terminusdb/terminusdb-client`.
