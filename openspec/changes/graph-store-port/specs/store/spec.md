# Spec delta — graph store

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Note on format: this delta uses the header shape the OpenSpec CLI actually
parses (`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`), as
established by `lock-primitive-hardening`.

## ADDED Requirements

### Requirement: the store is a regenerable materialisation, never the system of record

The graph store SHALL hold no fact that cannot be regenerated from
`events.jsonl`, `graphify-out/graph.json`, and the per-lane `GraphUpdate`
journals.

The store SHALL be rebuildable from those artifacts by a single documented
command that requires no manual step and no data extracted from the store
itself.
WHEN the rebuild runs against an empty store, it SHALL produce a store whose
query results are equal to those of a store built incrementally from the same
artifacts.
IF any component would write a fact to the store that has no counterpart in
those artifacts, THEN the write SHALL be rejected and the component SHALL be
treated as defective.
The event log SHALL remain the system of record for work lineage, and git SHALL
remain the store for commit ancestry.

#### Scenario: the store is destroyed and rebuilt with no loss

- WHEN the store's data directory is deleted and the documented rebuild command
  is run against the same `events.jsonl`, `graph.json` and lane journals
- THEN every conformance query returns the same result set as before the
  deletion
- AND no manual reconstruction step is required.

#### Scenario: a store-only fact is refused

- WHEN a component attempts to write a document whose fields cannot be derived
  from the event log, `graph.json`, or a lane journal
- THEN the write is rejected with a named error identifying the ungrounded
  fields
- AND the store contents are unchanged.

### Requirement: every graph read and write goes through the GraphStore port

Foreman SHALL access the graph plane exclusively through a `GraphStore` port.

Foreman core SHALL NOT import a TerminusDB client, construct a TerminusDB URL,
or build a WOQL or GraphQL document outside the TerminusDB adapter.
The port SHALL expose the operations the plane actually needs — schema
registration, document upsert, typed document lookup, the lineage query set,
and the expected-emptiness contract of the query wrapper — and SHALL NOT expose
store-specific concepts such as branches, commits, or data-version tokens as
required arguments.
WHERE a capability exists in one implementation and not the other, the port
SHALL expose it as an explicitly optional capability that callers query before
use, and callers SHALL degrade rather than fail when it is absent.

#### Scenario: no direct store access outside the adapter

- WHEN the repository is scanned for TerminusDB client imports, endpoint URLs,
  or WOQL AST construction
- THEN every occurrence is inside the TerminusDB adapter or its own tests
- AND the scan runs as part of the gate.

#### Scenario: an optional capability is absent and the caller degrades

- WHEN a caller requests time-travel to a prior state and the active
  implementation does not provide it
- THEN the port reports the capability as unavailable
- AND the caller returns a result marked as current-state-only rather than
  raising an error.

### Requirement: a files-only implementation satisfies the port with no database

The `GraphStore` port SHALL have an implementation that runs with no database
installed, no container running, and no network access, backed only by
`graph.json`, `worklog.jsonl`, and run-dir JSON.

The files-only implementation SHALL be the default implementation, and the
TerminusDB adapter SHALL be opt-in per host.
The port conformance suite SHALL run in full against both implementations, and
SHALL run against the files-only implementation on every commit.
WHERE the files-only implementation cannot provide a capability, the omission
SHALL be limited to time-travel, graph branch and merge, and cross-run query
ergonomics.
IF a merge-gate check, a context block, or a run record would fail when the
TerminusDB adapter is absent, THEN that component SHALL be treated as
defective and the failure SHALL block the gate.

#### Scenario: the whole plane runs with no store at all

- WHEN a full round runs on a host with no TerminusDB container and the
  files-only implementation selected
- THEN the merge gate evaluates, the context block is built and hashed, and the
  run record is complete
- AND no step reports a missing store.

#### Scenario: conformance is identical across implementations

- WHEN the port conformance suite runs against the files-only implementation
  and against the TerminusDB adapter over the same fixture data
- THEN every assertion outside the declared optional capabilities produces the
  same result in both
- AND any divergence is reported as a conformance failure naming the operation.

### Requirement: the work-DAG is stored as documents and never queried through the commit log

Lineage queries SHALL be answered from typed documents, and SHALL NOT depend on
the store's commit log.

The TerminusDB adapter SHALL NOT call `/api/log` on any query path.
The store's commits SHALL be treated as an audit trail only; the commit
`author` field SHALL carry the run and lane identity and the authenticated
`user` field SHALL be recorded as the non-spoofable identity.
The adapter SHALL NOT use offset paging with a non-zero start value against the
commit log, because paging cost is proportional to the offset.
IF a proposed query can only be answered by scanning commit history, THEN it
SHALL be re-expressed against documents or declared unsupported.

#### Scenario: lineage cost is independent of commit count

- WHEN the lineage query set runs against a store holding a fixed document
  population and a commit count an order of magnitude larger than the initial
  ingest
- THEN query latency is unchanged within measurement noise
- AND no lineage query issued a commit-log request.

#### Scenario: a commit-log query path is refused

- WHEN a code path calls the commit-log endpoint during query evaluation
- THEN the adapter raises a named error identifying the banned call
- AND the gate fails.

### Requirement: the frozen N2 schema is enforced at write time

The store SHALL validate every write against a single human-authored schema
covering the nine node types and the edge types of the graph plane, and SHALL
reject any document that does not conform.

The schema SHALL define `Task`, `Round`, `Attempt`, `AgentRun`, `Agent`,
`Artifact` with its `Spec`, `Commit` and `Source` subtypes, `Evaluation`,
`Claim`, `Entity`, `Metric` and `Measurement`.
The schema SHALL NOT define a single `PARENT_OF` relation; it SHALL define
`HAS_ATTEMPT` (`Round` → `Attempt`), `SUBTASK_OF` (`Task` → `Task`, acyclic)
and `BROADER_THAN` (`Entity` → `Entity`, acyclic, knowledge plane only) as
three distinct relations.
`EVALUATES` SHALL have exactly one target, modelled as a tagged union of
`Attempt`, `Artifact` and `Claim`.
`RESOLVED_TO` SHALL be functional, acyclic, and SHALL carry its own provenance
and a reviewer field.
`DEPENDS_ON` SHALL be acyclic and the acyclicity SHALL be checked, not assumed.
`SUPERSEDES` SHALL carry a timestamp and a reason, and `DERIVED_FROM`,
`REVISES` and `SUPERSEDES` SHALL be mutually exclusive on any given pair.
`MENTIONS` SHALL NOT be a stored edge; it SHALL be a derived index, excluded
from anything served to a model.
Every field populated by an LLM SHALL be an enum or a reference; the schema
SHALL NOT admit a free float or an open string in any LLM-populated field.
`Claim`, `Evaluation`, `Finding` and `Source` SHALL be top-level document
classes and SHALL NOT be sub-documents.
The schema SHALL NOT declare any relation both symmetric and transitive.
The abstract bases SHALL stay thin and stable, because the migration
operation that changes a class's parents is unimplemented in the store.
The schema SHALL remain OWL 2 RL-shaped, using no property chains and no
complex class expressions, so that a mechanical RDF export stays possible.
The schema SHALL be authored by one human, reviewed, and frozen; it SHALL NOT
be authored, extended, or amended by a model.

#### Scenario: a non-conforming write is rejected at the boundary

- WHEN a lane journal proposes a `Claim` whose confidence is a free float
  rather than the discrete confidence enum
- THEN the write is rejected before it reaches the store
- AND the rejection names the offending field and the enum it must use.

#### Scenario: the three split relations stay distinct

- WHEN a query asks for the attempts of a round
- THEN it traverses `HAS_ATTEMPT` only
- AND no result arrives via `SUBTASK_OF` or `BROADER_THAN`.

#### Scenario: an evaluation with two targets is refused

- WHEN a write proposes an `Evaluation` referencing both an `Attempt` and an
  `Artifact`
- THEN the write is rejected
- AND the error states that `EVALUATES` takes exactly one target.

#### Scenario: entity resolution stays reviewable and acyclic

- WHEN a `RESOLVED_TO` write would create a cycle or a second resolution target
  for the same entity
- THEN the write is rejected
- AND an accepted `RESOLVED_TO` write records its provenance and its reviewer.

### Requirement: edge attributes are reified because the store has no edge properties

The graph plane SHALL NOT rely on properties attached to edges.

WHEN an edge carries attributes, the adapter SHALL reify it as an intermediate
document rather than dropping the attributes.
`MENTIONS` SHALL be reified as a `Mention` document carrying span and
confidence.
Cosmetic edge properties produced by the extraction substrate SHALL be dropped
explicitly and the drop SHALL be recorded, rather than being lost silently.
The reified form of `SUPPORTS` and `CONTRADICTS` SHALL be designed and
documented before first ingest, and SHALL be applied when per-edge confidence
is first required.
IF an edge attribute would be silently discarded by the adapter, THEN ingest
SHALL fail rather than complete.

#### Scenario: an edge attribute is never silently lost

- WHEN ingest encounters an edge carrying a property that has neither a reified
  target document nor an explicit drop rule
- THEN ingest fails with an error naming the edge type and the property
- AND no partial ingest is left behind.

#### Scenario: the reification of a decision edge is a schema addition, not a migration

- WHEN per-edge confidence is first required on `SUPPORTS`
- THEN the pre-documented reified class is added to the schema and populated
  going forward
- AND no existing document requires a property move.

### Requirement: concurrent writes follow the measured three-way concurrency rule

The adapter SHALL select its concurrency mechanism from the shape of the write,
not from a single blanket policy.

WHERE a write appends distinct documents, the adapter SHALL write without a
compare-and-swap precondition.
WHERE a write is a read-modify-write against a document another lane may also
hold, the adapter SHALL send the store's data-version header as a
compare-and-swap precondition and SHALL treat a version-mismatch response as a
retryable conflict.
WHERE lanes perform independent bodies of work, the adapter SHALL use one
branch per lane and merge through the store's apply operation, which is the
only path with real conflict detection.
IF a read-modify-write is issued against a shared document without the
compare-and-swap precondition, THEN the operation SHALL be refused by the
wrapper, because the store accepts contending writes with a success status and
silently keeps the last one.
The deployment SHALL raise the store's worker count above its default of eight
before running more than eight concurrent lanes.

#### Scenario: contending writes cannot silently clobber

- WHEN two lanes read the same document and both write a modified version
- THEN the second write is rejected as a version mismatch and retried against
  the current state
- AND both lanes' changes are present in the final document.

#### Scenario: fan-in appends need no precondition

- WHEN twelve lanes concurrently append distinct documents to one branch
- THEN every append succeeds
- AND every document is present.

#### Scenario: an unguarded shared-document write is refused

- WHEN a caller issues a read-modify-write against a shared document without a
  data-version precondition
- THEN the wrapper refuses the call before it reaches the store
- AND the error names the missing precondition.

### Requirement: an empty result is never silently accepted

Every query and every diff issued through the store wrapper SHALL declare
whether it expects a non-empty result, and the wrapper SHALL enforce that
declaration.

IF a query declared as expecting results returns none, THEN the wrapper SHALL
raise a named error and SHALL NOT return an empty result to the caller.
The wrapper SHALL normalise version references before use, and SHALL reject a
version reference carrying the response-header prefix form, because that form
is accepted and returns an empty diff with a success status.
The wrapper SHALL apply the store's deduplication operator around every path
query, because a path query returns one row per distinct path rather than one
row per answer.
The test suite SHALL carry one canary fixture per known silent-empty path — the
prefixed version reference and the URI-versus-string unification failure — and
each canary SHALL fail when the assertion machinery is disabled.
A query whose correct answer is genuinely empty SHALL be declared as
expecting emptiness, so that an empty result is always distinguishable from a
failed query.

#### Scenario: a prefixed version reference is rejected rather than answered

- WHEN a diff is requested with a version reference in the response-header
  prefix form
- THEN the wrapper rejects the request before issuing it
- AND the error names the accepted reference forms.

#### Scenario: an unexpectedly empty query fails loudly

- WHEN a query declared as expecting results returns no rows
- THEN the wrapper raises a named error identifying the query
- AND no caller receives an empty result it could mistake for a true negative.

#### Scenario: a true negative is expressible

- WHEN a query for attempts with no evaluation runs against a fixture where
  every attempt has one
- THEN the wrapper returns an empty result marked as an expected true negative
- AND no error is raised.

#### Scenario: the canaries fail closed

- WHEN the non-emptiness assertions are disabled and the test suite runs
- THEN both silent-empty canaries fail
- AND the gate blocks.

### Requirement: the adapter is pinned and has a rehearsed exit path

The TerminusDB adapter SHALL pin the server version and the container image
digest, and SHALL refuse to run against an unpinned or mismatched image.

The store's data directory SHALL be backed up by stopping the server and
archiving the directory, and the backup SHALL be taken before any version
change, because cross-version directory compatibility is undocumented.
A health re-check SHALL run at least quarterly, recording commit cadence,
whether a second maintainer has appeared, release cadence, and whether any
capability in use has moved behind the paid tier.
The health re-check SHALL carry named trigger conditions, and WHEN any trigger
fires the documented response SHALL be to fall back to the files-only
implementation within one release.
The exit path SHALL be rehearsed at least once before the store is relied upon,
by running a full round on the files-only implementation after the adapter has
been in use.
IF the store becomes unavailable in normal operation, THEN Foreman SHALL
continue on the files-only implementation and SHALL report the degradation
rather than failing the round.

#### Scenario: an unpinned image is refused

- WHEN the adapter starts against a container whose digest does not match the
  pinned digest
- THEN the adapter refuses to start
- AND the error names both digests.

#### Scenario: a health trigger produces a decision, not a discussion

- WHEN the quarterly health re-check finds a trigger condition met
- THEN the check emits the trigger, the evidence, and the documented fallback
  action
- AND the finding is recorded in the release checklist.

#### Scenario: the store disappears mid-round

- WHEN the store becomes unreachable during a round
- THEN the round completes on the files-only implementation
- AND the run record states which capabilities were degraded.

### Requirement: ingest reads graph.json through a schema-first, two-pass, idempotent path

Ingest SHALL read `graphify-out/graph.json` directly.

Ingest SHALL NOT use the extraction substrate's Cypher or graph-database export
files, because that export emits five fields and drops source file, source
location, confidence score, hyperedges and communities.
Ingest SHALL register the schema before the first document write.
Ingest SHALL run in two passes, writing documents before the link-valued
properties that reference them.
Ingest SHALL use the store's create-or-replace upsert with deterministic
lexical keys, so that re-ingesting the same input is idempotent and leaves the
store unchanged.
Ingest SHALL stamp the producing version of the extraction substrate on every
ingested batch, because the interchange artifact does not record it.
WHEN a node identifier changes between ingests, the store SHALL record it as a
rename with lineage and SHALL NOT record it as a delete followed by a create.

#### Scenario: re-ingesting the same graph changes nothing

- WHEN the same `graph.json` is ingested twice
- THEN the second ingest produces no document differences
- AND the store's document count is unchanged.

#### Scenario: the lossy export path is unavailable

- WHEN ingest is invoked with a Cypher or graph-database export file
- THEN ingest refuses with an error naming the fields that export drops
- AND directs the caller to `graph.json`.

#### Scenario: a moved file is a rename, not a deletion

- WHEN a file move re-identifies every symbol it contains
- THEN the affected documents record a rename with lineage to their prior
  identifiers
- AND no document is deleted.
