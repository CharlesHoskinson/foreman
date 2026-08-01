# Design — graph-store-port

## Decision shape

The storage boundary has two implementations:

1. `FilesOnlyGraphStore`, landed in commit `933c308`, remains the default and
   supports the required port behavior without a database, container, or
   network.
2. The SQLite ontology adapter is opt-in and materialises the same grounded
   data into a local database created from
   `skills/foreman/ontology/schema.sql`.

Every graph consumer uses the existing `GraphStore` port. The SQLite adapter is
the only component allowed to issue ontology SQL. GP-1 through GP-5 retain
their direct file inputs and must not acquire an ontology dependency.

## Historical decision record

R8 evaluated TerminusDB 12.0.6 live on 2026-07-28 and found working schema
validation, lineage queries, distinct-document concurrency, and time-travel.
The same dated run found two silent-empty query paths, linear commit-log scans,
last-write-wins shared updates, and severe project-health concentration.

On 2026-07-28, R8 ranked TerminusDB first only while native versioning and
ontology enforcement were weighted heavily. It rejected direct adoption
without a port, commit-log lineage, per-edge commits, and unguarded empty
results. Those rejected alternatives remain historical evidence; none is a
current implementation target.

On 2026-07-30, commit `b3bbdc3` withdrew TerminusDB after a four-lens council:
recovery must work offline, the release was moving CI local, and no adapter,
server, or stored data existed. The archived withdrawal record requires two
ideas to survive: the 24 competency queries as a permanent CI suite, and the
four-way live gate covering acceptance, invalid enum, undeclared field, and
drop/rebuild identity.

The 2026-07-28 measurement that `/api/log` scaled at roughly 2.4 ms per commit
and exceeded one second at 478 commits remains the historical reason lineage is
stored and queried as data rather than reconstructed from store history. The
2026-07-28 observation that TerminusDB relations could not carry attributes
remains the historical reason edge facts were designed for reification.

## SQLite ontology boundary

`schema.sql` is the single authoritative definition. The adapter verifies its
pinned SHA-256 before opening or creating a database, enables foreign keys on
every connection, and applies the schema to an empty local file before the
first data write. A mismatch is a hard configuration error, not an implicit
migration.

The schema supplies the invariants:

- `node_kind(kind, plane)` plus the composite foreign key store-enforces
  disjointness across work, artifact, knowledge, and lineage planes;
- `CHECK` constraints close enum and scalar domains;
- lexical business keys are `UNIQUE`;
- set-valued relations use junction tables;
- `supersession` is a row with `old_id`, `new_id`, `at`, and `reason`, and its
  unique `old_id` index forbids ambiguous successor forks;
- lint views must return zero rows;
- `claim_head` and `claim_contradiction_reach` are the public traversal forms.

The tested baseline does not authorise the adapter to forget requirements that
already exist at the port boundary. Full conformance still requires relational
forms for the remaining work/artifact types; distinct `HAS_ATTEMPT`,
`SUBTASK_OF`, and `BROADER_THAN`; exactly-one-target `EVALUATES`; functional,
reviewed, acyclic `RESOLVED_TO`; acyclic dependencies; mutually exclusive
lineage relations; derived-only `MENTIONS`; closed LLM fields; independently
addressable Claim/Evaluation/Finding/Source rows; and the OWL 2 RL-shaped export
boundary. If the current pinned schema lacks one of those forms, the result is
a named gap until a human-reviewed versioned schema revision changes the hash.
An adapter-private side table is not conformance.

The adapter does not duplicate recursive CTEs. SQLite has no `CYCLE` clause,
and the repository measured the unguarded supersession walk hanging. Shipping
the traversal as a view makes the path delimiter, depth cap, and cycle guard
part of the schema contract. A `claim_head` consumer must inspect
`still_superseded`; nonzero means the walk stopped on a guard and is not a true
current head.

## Port and landed files-only behavior

The port already exposes schema registration, deterministic upsert, typed
lookup, named lineage queries, expected emptiness, and optional capabilities.
The rewrite preserves that surface. SQLite-specific path names, pragmas,
transactions, table names, and SQL do not become required port arguments.

Files-only remains the default because it is exercised continuously. It reports
time-travel, branch/merge, and cross-run query ergonomics unavailable and lets
callers degrade. The SQLite adapter may advertise only capabilities it actually
implements; a local database file does not imply native time-travel or branch
merge.

The contract suite runs unchanged against files-only and against the SQLite
adapter. Backend-specific additions may test schema hashing, SQL, transactions,
and the shipped views, but may not relax the shared assertions.

## Query discipline and the permanent competency suite

Every SQL statement is parameterised and lives inside the adapter. Ordinary
lookups may query tables directly. Recursive traversal must query the shipped
views. No caller copies a recursive CTE into core code.

Every query declares expected-empty or expected-non-empty. An unexpected empty
raises the existing named error; an expected true negative returns an empty
result carrying that declaration. The guard is tested with known-positive
fixtures and with the assertion layer deliberately disabled, so a no-op suite
cannot pass.

The 24 competency questions archived with the withdrawn operations package are
ported to named SQL statements or explicit gap entries and run permanently in
CI. All mapped SQL executes. A successful zero-row result, an ontology gap, a
SQL error, and a not-run query remain four different states.

## Schema discrimination and rebuild identity

Acceptance alone is not evidence that constraints work. The adapter gate keeps
the repository's existing discrimination style:

- a conforming write is accepted;
- an invalid enum is rejected by the engine;
- an undeclared field is rejected at the adapter boundary before SQL;
- rebuilding a fresh database from the same grounded inputs produces identical
  rows and query classifications.

The ontology's existing 18 checks remain required. Adapter tests add negative
controls for every lint view, both traversal guards, schema-hash mismatch,
foreign keys disabled, unexpected emptiness, and shared-update contention.

## Ingest and one-way projection

Graphify ingest reads `graphify-out/graph.json` directly. It does not accept
Cypher, Neo4j, FalkorDB, GraphML, or visualization exports because they omit
audit fields and graph shapes. The adapter classifies every input before
writing, creates base rows before link rows, uses deterministic lexical keys,
and commits a batch atomically. Re-ingesting identical input leaves no row
differences.

Attributes on relations require a declared relational representation. Sets use
junction tables; facts with their own attributes use reified tables, as
`supersession` does. An attribute with neither a table mapping nor an explicit
named drop rule stops ingest and records a finding.

`fm-session.py project()` is one-directional: the canonical session SQLite
store supplies Claim, Measurement, Finding, Provenance, Commit, Entity, and
Supersession projection records; the ontology never writes back. A projection
failure cannot destroy the source record.

## Concurrency

SQLite WAL permits readers with a writer but still serialises writes. The
adapter therefore distinguishes three cases without exposing them through the
port:

- distinct inserts use short transactions and bounded retry on `SQLITE_BUSY`;
- a shared read-modify-write starts a guarded write transaction before the
  read, rechecks the observed state, and commits atomically; stale state becomes
  a named retryable conflict rather than a last-write-wins success;
- independent lane batches stage their complete changes and apply them in one
  transaction, rejecting uniqueness, foreign-key, or stale-state conflicts as
  a unit.

Busy retry is bounded and observable. Partial batches and infinite retry are
forbidden.

## Schema hash, integrity, backup, and exit

The release pin for `schema.sql` is
`1a7c15a97fe594a07746d285a9e14b3a0820b3386c40c0206d55389f7a6eb76f`.
The adapter verifies the file hash before use and records it in database
metadata. A new hash requires a reviewed schema change and explicit migration
or rebuild; it is never accepted automatically.

Backups use SQLite's online backup API or a transactionally consistent copy,
including WAL state where applicable. `PRAGMA integrity_check`, lint views,
the 24-query suite, and timed drop/rebuild run at least quarterly and before a
schema-pin change. If the ontology becomes unavailable or fails integrity, the
round continues on files-only and records degraded capabilities.

## Rejected current alternatives

**Expose SQLite directly to Foreman core.** Rejected because it would erase the
landed port boundary and make future storage changes a core rewrite.

**Replace files-only with SQLite as the default.** Rejected because GP-1 through
GP-5 intentionally have no database dependency and the existing default is
already implemented and continuously tested.

**Copy recursive SQL into each caller.** Rejected because a missed guard can
hang; the views are the tested executable traversal contract.

**Use sqlite-graph.** Rejected by the 2026-07-30 council after 28 queries showed
no schema enforcement, silently wrong answers, incompatibility with Python's
stdlib `sqlite3`, and no variable-length path operator.

**Treat schema acceptance as sufficient.** Rejected. The dated N1 result that
single-axiom edits could remain consistent while changing outcomes is why
ontology changes remain human-reviewed code and every constraint needs a
negative control.

## Risks

- **Core bypasses the adapter.** Mitigation: a repository scan for ontology SQL
  and direct `sqlite3` ontology access outside the adapter and its tests.
- **Foreign keys are left off.** Mitigation: set and verify
  `PRAGMA foreign_keys=ON` on every connection, then run a discriminating bad
  write.
- **A recursive query bypasses its guard.** Mitigation: expose traversals only
  through shipped views and test cycles plus `still_superseded`.
- **A schema change is accepted accidentally.** Mitigation: the hard hash pin,
  recorded expected/observed hashes, and reviewed migration/rebuild decision.
- **The files-only path rots.** Mitigation: it remains the default and its full
  contract suite runs on every commit.
- **A shared update silently clobbers.** Mitigation: guarded transactions,
  stale-state detection, bounded retry, and a contention test.
- **A correct empty answer is confused with a broken query.** Mitigation: the
  expected-emptiness contract and permanent positive canaries for the SQL
  competency suite.
