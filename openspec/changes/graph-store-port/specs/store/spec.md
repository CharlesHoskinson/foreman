# Spec delta — graph store

## ADDED Requirements

### Requirement: the store is a regenerable materialisation, never the system of record

The graph store SHALL hold no fact that cannot be regenerated from
`events.jsonl`, `graphify-out/graph.json`, the per-lane `GraphUpdate` journals,
or the canonical session SQLite store through its one-way projector.

The SQLite ontology database SHALL be rebuildable from those artifacts and
`skills/foreman/ontology/schema.sql` by one documented command that requires no
manual step and no data extracted from the ontology database itself. WHEN the
rebuild runs against an empty database, it SHALL produce table contents and
query classifications equal to those produced incrementally from the same
inputs. IF a component would write a fact with no grounded counterpart, THEN
the adapter SHALL reject the write with a named error. The event log SHALL
remain the system of record for work lineage, git SHALL remain the store for
commit ancestry, and the canonical session database SHALL remain the write
path for session recovery.

#### Scenario: the ontology database is destroyed and rebuilt with no loss

- WHEN a run-scoped ontology database file is deleted and the documented
  rebuild command is run against the same grounded inputs
- THEN every table and every conformance-query classification matches the
  pre-deletion result
- AND no manual reconstruction or ontology-database export is required

#### Scenario: a store-only fact is refused

- WHEN a component proposes fields that cannot be derived from a named source
  artifact or canonical session row
- THEN the write is rejected with a named error identifying the ungrounded
  fields
- AND the ontology database is unchanged

### Requirement: every graph read and write goes through the GraphStore port

Foreman SHALL access the persistent graph plane exclusively through the landed
`GraphStore` port.

Foreman core SHALL NOT issue SQL against the ontology, open the ontology
database, or construct ontology table or view names outside the SQLite ontology
adapter. The port SHALL continue to expose schema registration, deterministic
upsert, typed lookup, the named lineage query set, and expected emptiness; it
SHALL NOT expose database paths, pragmas, transactions, table names, or SQL as
required arguments. WHERE a capability exists in one implementation and not
another, the port SHALL expose it as explicitly optional, callers SHALL query
it before use, and callers SHALL degrade rather than fail when it is absent.

#### Scenario: no direct ontology access exists outside the adapter

- WHEN the repository is scanned for ontology SQL, direct `sqlite3` ontology
  connections, and references to ontology tables or views
- THEN every executable occurrence is inside the SQLite ontology adapter or
  its own tests
- AND the scan runs as part of the gate

#### Scenario: an optional capability is absent and the caller degrades

- WHEN a caller requests time-travel and the active implementation does not
  provide it
- THEN the port reports the capability unavailable
- AND the caller returns a result marked current-state-only rather than
  failing the round

### Requirement: the landed files-only implementation remains the default

The `GraphStore` port SHALL retain an implementation that runs with no database
installed, no container, and no network, backed only by `graph.json`,
`worklog.jsonl`, and run-dir JSON.

The files-only implementation SHALL remain the default and the SQLite ontology
adapter SHALL be opt-in per host. The port conformance suite SHALL run in full
against both implementations and SHALL run against files-only on every commit.
WHERE files-only cannot provide a capability, the omission SHALL remain limited
to time-travel, graph branch/merge, and cross-run query ergonomics. IF a merge
gate, context block, or run record fails when the SQLite ontology adapter is
absent, THEN that component SHALL be treated as defective and SHALL block the
gate.

#### Scenario: the whole plane runs with no ontology database

- WHEN a full round runs with files-only selected and no ontology database
  present
- THEN the merge gate evaluates, the context block is built and hashed, and
  the run record is complete
- AND no required step reports a missing store

#### Scenario: conformance remains identical across implementations

- WHEN the shared suite runs over identical fixture data against files-only and
  the SQLite ontology adapter
- THEN every assertion outside declared optional capabilities has the same
  outcome
- AND any divergence is a named conformance failure

### Requirement: ontology lineage is queried as data through shipped guarded views

Lineage queries SHALL be answered from ontology tables, junction tables, and
the guarded views shipped by `schema.sql`; they SHALL NOT be reconstructed from
git ancestry, session history, adapter logs, or an unguarded recursive CTE.

The SQLite ontology adapter SHALL query `claim_head` for supersession heads and
`claim_contradiction_reach` for contradiction reachability. Every consumer of
`claim_head` SHALL inspect `still_superseded`; a nonzero value SHALL NOT be
reported as a true head. IF a proposed traversal is not supplied by a guarded
view, THEN it SHALL be added through a reviewed schema revision or declared
unsupported. Query cost SHALL be independent of unrelated `Commit` rows.

#### Scenario: a guarded supersession cycle terminates without a false head

- WHEN a cycle fixture is queried through `claim_head`
- THEN the query terminates within its configured bound
- AND any row with nonzero `still_superseded` is reported as guard-stopped, not
  current

#### Scenario: lineage ignores unrelated commit population

- WHEN the lineage query set runs before and after the database receives an
  order of magnitude more unrelated `Commit` rows
- THEN result sets remain equal and latency remains within measurement noise
- AND no query reads git history or adapter logs

### Requirement: schema.sql is the pinned store-enforced ontology contract

The SQLite ontology adapter SHALL use
`skills/foreman/ontology/schema.sql` as the single authoritative schema and
SHALL verify its pinned SHA-256 before opening or creating an ontology database.

Every connection SHALL enable and verify `PRAGMA foreign_keys=ON`. The
`node_kind(kind, plane)` composite foreign key SHALL store-enforce kind/plane
disjointness. Enum domains SHALL remain `CHECK`-constrained, lexical business
keys SHALL remain `UNIQUE`, sets SHALL use declared junction tables, and
numeric measurements SHALL reject nonnumeric values. `Claim`, `Measurement`,
`Finding`, `Entity`, `Commit`, `Metric`, `Provenance`, and reified
`Supersession` SHALL use their declared relational forms. `Supersession` SHALL
carry `at` and nonblank `reason`, SHALL reject self-links, and SHALL permit at
most one successor per old node. All lint views SHALL return zero rows on an
accepted database. The schema SHALL remain human-authored and reviewed; a
model SHALL NOT extend it during ingest.

The complete port ontology SHALL also retain relational representations for
`Task`, `Round`, `Attempt`, `AgentRun`, `Agent`, `Artifact`, `Spec`, `Source`,
and `Evaluation`; the adapter SHALL NOT claim full conformance while any
required representation is absent. It SHALL NOT use a generic `PARENT_OF`
relation: `HAS_ATTEMPT` (`Round` to `Attempt`), `SUBTASK_OF` (`Task` to `Task`),
and `BROADER_THAN` (`Entity` to `Entity`, knowledge plane only) SHALL remain
distinct. `EVALUATES` SHALL have exactly one target from `Attempt`, `Artifact`,
or `Claim`. `RESOLVED_TO` SHALL be functional and acyclic and SHALL retain its
provenance and reviewer. `DEPENDS_ON`, `SUBTASK_OF`, and `BROADER_THAN` SHALL be
checked for cycles. `DERIVED_FROM`, `REVISES`, and `SUPERSEDES` SHALL be
mutually exclusive on one ordered pair. `MENTIONS` SHALL remain a derived index
excluded from data served to a model. Every LLM-populated field SHALL be an
enum or reference and SHALL NOT admit a free float or open string. `Claim`,
`Evaluation`, `Finding`, and `Source` SHALL remain independently addressable
rows rather than cascade-owned subrecords. No relation SHALL be both symmetric
and transitive. The abstract kind/plane base SHALL remain thin and stable. The
schema SHALL remain OWL 2 RL-shaped, with no property chains or complex class
expressions, so mechanical RDF export remains possible. Any representation
not present in the current pinned baseline SHALL be added only by a
human-reviewed versioned `schema.sql` revision with a new hash and explicit
migration or rebuild; it SHALL NOT be approximated in adapter-private tables.

#### Scenario: disjointness is rejected by the store

- WHEN a write attempts to attach an `Entity` node to the work plane
- THEN SQLite rejects the row through the composite foreign key
- AND the adapter reports the offending kind and plane

#### Scenario: invalid enum and undeclared field both fail closed

- WHEN a write supplies an out-of-domain claim status or a field absent from
  the adapter's declared mapping
- THEN the enum is rejected by a schema constraint and the undeclared field is
  rejected before SQL execution
- AND neither write changes the database

#### Scenario: supersession remains attributed and unambiguous

- WHEN a caller records a successor
- THEN the stored row includes old node, new node, timestamp, and nonblank
  reason
- AND a second successor for the same old node is rejected

#### Scenario: the three split relations stay distinct

- WHEN SQL asks for the attempts of a round
- THEN it traverses the declared `HAS_ATTEMPT` representation only
- AND no result arrives through `SUBTASK_OF` or `BROADER_THAN`

#### Scenario: an evaluation with two targets is refused

- WHEN a write proposes one `Evaluation` targeting both an `Attempt` and an
  `Artifact`
- THEN the write is rejected atomically
- AND the error states that `EVALUATES` takes exactly one target

#### Scenario: entity resolution stays reviewed and acyclic

- WHEN a `RESOLVED_TO` write would create a cycle or a second target
- THEN the write is rejected
- AND every accepted resolution retains its provenance and reviewer

### Requirement: attributed relations use declared relational representations

The graph plane SHALL NOT rely on properties that exist only on an in-memory
edge.

WHEN a relation carries attributes, the SQLite ontology adapter SHALL represent
it with a declared reified table, as `supersession` does, rather than discard
the attributes. Set-valued relations SHALL use declared junction tables.
Cosmetic properties MAY be dropped only by an explicit named rule whose count
is recorded. IF an attribute has neither a declared table mapping nor a named
drop rule, THEN ingest SHALL fail atomically. The adapter SHALL NOT create
ingest-only columns or tables outside `schema.sql`.
The reified forms of `SUPPORTS` and `CONTRADICTS` SHALL be
designed and documented before first ingest. WHEN per-relation confidence is
required, a human-reviewed schema revision SHALL add the pre-documented
reified table without moving existing relation data.

#### Scenario: an attributed relation is never silently lost

- WHEN ingest encounters a relation property with neither a declared
  relational mapping nor a named drop rule
- THEN ingest fails with the relation type and property name
- AND the current batch leaves no partial rows

#### Scenario: supersession attributes round-trip

- WHEN a supersession row is written and retrieved
- THEN its old node, new node, timestamp, and reason equal the input values
- AND no attribute is inferred from adapter logs or neighboring rows

#### Scenario: the reification of a decision edge is a schema addition, not a migration

- WHEN per-relation confidence is first required on `SUPPORTS`
- THEN a human-reviewed schema revision adds the pre-documented reified table
- AND no existing relation data requires migration

### Requirement: concurrent writes follow the measured three-way concurrency rule

The SQLite ontology adapter SHALL select its transaction discipline from the
shape of the write and SHALL NOT treat lock contention or stale shared state as
successful completion.
After contention, both lanes' changes SHALL be present in the final state. The
adapter SHALL reject the losing update. The losing lane SHALL retry its change
against the current state. The adapter SHALL NOT drop either lane's change.

WHERE lanes insert distinct rows, the adapter SHALL use short transactions and
bounded handling of `SQLITE_BUSY`. WHERE a lane performs a shared
read-modify-write, it SHALL begin a guarded write transaction before the read,
recheck the observed state, and treat staleness as a named retryable conflict.
IF a caller omits this guard, THEN the `GraphStore` port SHALL reject the
operation before the adapter executes SQL.
WHERE a lane applies a batch, every row in that batch SHALL commit or roll back
as one unit. Retry SHALL be finite and observable. IF the bound is exhausted,
THEN the adapter SHALL raise a named terminal error and SHALL NOT return
success.

#### Scenario: distinct inserts fan in without loss

- WHEN twelve lanes concurrently insert distinct valid ontology rows
- THEN every accepted insert is present after the writers complete
- AND any busy retry is bounded and recorded

#### Scenario: contending shared updates cannot silently clobber

- WHEN two lanes attempt to update the same logical fact from the same observed
  state
- THEN the adapter rejects the stale update with a named retryable conflict
- AND the losing lane retries its change against the current row
- AND both lanes' changes are present in the final state

#### Scenario: an unguarded shared-document write is refused

- WHEN a caller submits a shared-row update without the required write guard
- THEN the `GraphStore` port refuses the operation before it reaches SQLite
- AND the named error identifies the missing guard

#### Scenario: a failing batch is atomic

- WHEN one row in a lane batch violates uniqueness or a foreign key
- THEN the entire batch rolls back
- AND no earlier row from that batch remains committed

### Requirement: empty results are explicit and all 24 competency queries run in CI

Every query issued through the store wrapper SHALL declare whether it expects
an empty or nonempty result, and the wrapper SHALL enforce that declaration.

IF a query declared expected-nonempty returns no rows, THEN the wrapper SHALL
raise a named error and SHALL NOT return an empty result to its caller. A query
whose correct answer is empty SHALL be declared expected-empty. The archived
24 competency questions SHALL each have a permanent entry consisting of named
parameterised SQL or an explicit ontology gap. Every mapped SQL query SHALL run
in CI. Successfully nonempty, successfully expected-empty, ontology gap, SQL
failure, and not-run SHALL remain distinct states. The suite SHALL contain
known-positive canaries that fail when expected-emptiness enforcement is
disabled.
WHERE an implementation offers snapshot comparison or diff as an optional
capability, every comparison SHALL use the same emptiness declaration and SHALL
validate its snapshot reference before SQL. A malformed or unsupported
reference SHALL fail before query execution and SHALL NOT be converted into an
empty comparison. Every path-shaped SQL query SHALL deduplicate answer
identities so multiple paths do not become duplicate answers.

#### Scenario: an unexpectedly empty SQL query fails loudly

- WHEN a known-positive query declared expected-nonempty returns zero rows
- THEN the wrapper raises the named unexpected-empty error
- AND no caller receives a result it could mistake for a true negative

#### Scenario: a true negative remains expressible

- WHEN a query declared expected-empty executes successfully and returns zero
  rows
- THEN the wrapper returns an empty result marked as an expected true negative
- AND no error is raised

#### Scenario: the competency suite cannot silently shrink

- WHEN the permanent competency suite is evaluated
- THEN exactly 24 named entries are present and every mapped SQL query has an
  execution outcome
- AND disabling the emptiness assertion makes the known-positive canaries fail

### Requirement: the adapter is schema-hash pinned and has a rehearsed exit path

The SQLite ontology adapter SHALL pin `schema.sql` at SHA-256
`1a7c15a97fe594a07746d285a9e14b3a0820b3386c40c0206d55389f7a6eb76f` and SHALL
refuse use when the observed hash differs.

The adapter SHALL record expected and observed hashes and SHALL NOT migrate or
accept a new schema implicitly. A transactionally consistent backup SHALL be
taken before an approved schema change. At least quarterly and before every
schema-pin change, the gate SHALL run `PRAGMA integrity_check`, every lint view,
the 24-query suite, and a timed drop-and-rebuild. The exit path SHALL be
rehearsed by completing a full round on files-only after SQLite ontology use.
The quarterly gate SHALL also evaluate named health triggers. WHEN a trigger
fires, the gate SHALL decide to switch to files-only within one release. The
report SHALL record this named fallback action instead of an open-ended report.
IF the ontology database becomes unavailable, THEN Foreman SHALL continue on
files-only and SHALL report degraded optional capabilities.

#### Scenario: a schema-hash mismatch is refused

- WHEN the adapter observes a `schema.sql` hash different from the release pin
- THEN it refuses database use before executing data SQL
- AND the error records both hashes

#### Scenario: a health trigger produces a decision, not a discussion

- WHEN the quarterly health check finds a named trigger condition
- THEN the check records the trigger, evidence, and decision to use files-only
  within one release
- AND the report names the fallback action instead of an open-ended discussion

#### Scenario: the ontology disappears mid-round

- WHEN the ontology database cannot be opened or fails integrity during a
  round
- THEN the round completes through files-only
- AND the run record names every degraded optional capability

### Requirement: ingest is schema-first, two-pass, idempotent, and one-way

Graph ingest SHALL read `graphify-out/graph.json` directly and SHALL reject
Cypher, Neo4j, FalkorDB, GraphML, HTML, or visualization exports as inputs.

Ingest SHALL verify and apply the pinned schema before the first data write,
classify every input before mutation, write base rows before link and junction
rows, and commit each batch atomically. Deterministic lexical keys and explicit
conflict handling SHALL make identical re-ingest produce no row differences.
Every batch SHALL record the graphify version and exact input hash. Identifier
changes SHALL be represented with declared lineage rather than silent
delete-and-create. The `fm-session.py project()` path SHALL remain one-way from
the canonical session SQLite store into the ontology; the ontology adapter
SHALL NOT write back into session tables.

#### Scenario: re-ingesting an identical graph changes nothing

- WHEN the same `graph.json` is ingested twice under the same schema pin
- THEN the second ingest produces no table differences
- AND row counts and query classifications remain unchanged

#### Scenario: the lossy export path is unavailable

- WHEN ingest receives a graph-database or visualization export instead of
  `graph.json`
- THEN it refuses before mapping and names the provenance or shape fields that
  source cannot preserve

#### Scenario: a moved file is a rename, not a deletion

- WHEN a file moves between two ingests and its symbols get new identifiers
- THEN the ontology records renames with lineage to the prior identifiers
- AND it does not record deletions plus unrelated insertions

#### Scenario: session projection cannot reverse direction

- WHEN session rows are projected into the ontology
- THEN projected Claim, Measurement, Finding, Provenance, Commit, Entity, and
  Supersession data can be queried from the ontology
- AND no ontology operation mutates the canonical session database
