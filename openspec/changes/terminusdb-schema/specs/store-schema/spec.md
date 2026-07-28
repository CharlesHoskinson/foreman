# Spec delta -- store schema

EARS-phrased. See skills/foreman/references/five-part-spec.md. Header shape
follows openspec/changes/graph-store-port/specs/store/spec.md, the shape
the OpenSpec CLI actually parses.

## ADDED Requirements

### Requirement: the schema defines the work-DAG, knowledge, and bridge planes as named classes

The store schema SHALL define Task, Round, Attempt, AgentRun,
Agent, Evaluation, Finding, Metric, and Measurement as work-DAG
plane classes inheriting WorkNode.

The schema SHALL define Claim and Entity as knowledge-plane classes
inheriting GraphNode directly, never WorkNode.
The schema SHALL define Artifact as an abstract class inheriting
GraphNode directly, with Spec and Commit as work-plane-only subtypes
and Source as the one subtype permitted to carry knowledge-plane content,
distinguished by its origin field.
WHERE a class is materialised deterministically from the append-only event
log, that class SHALL NOT be written or amended by a model.

#### Scenario: a knowledge-plane class never inherits the work-DAG marker

- WHEN the schema is inspected for every class inheriting GraphNode
- THEN Claim and Entity inherit it directly
- AND neither inherits WorkNode.

#### Scenario: Source is the only class bridging the two planes

- WHEN the schema is inspected for classes inheriting Artifact
- THEN Spec and Commit carry no field indicating knowledge-plane origin
- AND Source is the only such subtype, and it carries origin.

### Requirement: PARENT_OF does not exist; four named relations replace it

The schema SHALL NOT define a class or property named parent_of or
PARENT_OF.

The schema SHALL define Round.has_attempt as a Round-to-Attempt set
property.
The schema SHALL define Task.subtask_of as an Optional Task-to-Task
property for subtask nesting only (functional -- at most one parent).
The schema SHALL define Task.depends_on as a Task-to-Task set property
for dependency ordering only -- it SHALL NOT be used for subtask nesting
now that subtask_of exists.
The schema SHALL define Artifact.artifact_depends_on as an
Artifact-to-Artifact set property, kept plane-distinct from
Task.depends_on by name so a WOQL traversal cannot silently cross the
work-DAG/knowledge-plane-adjacent boundary.
The schema SHALL define Entity.broader_than as an Entity-to-Entity set
property, present only on the knowledge-plane class.
IF a future revision proposes a single relation covering more than one of
has_attempt, subtask_of, task dependency, artifact_depends_on, or
broader_than, THEN that revision SHALL be rejected as a reintroduction
of the merged-concept defect this requirement exists to prevent.

#### Scenario: no merged relation exists

- WHEN the schema is scanned for a property or class named parent_of
  or PARENT_OF
- THEN no such property or class exists
- AND has_attempt, subtask_of, depends_on (on Task, dependency-only),
  artifact_depends_on, and broader_than each appear on exactly one class
- AND Task.subtask_of and Task.depends_on are never the same property.

#### Scenario: subtask nesting and dependency ordering are distinct relations

- WHEN a Task is queried for its parent task
- THEN the answer comes from subtask_of, never from depends_on
- AND a query for a Task's ordering dependencies comes from depends_on,
  never from subtask_of
- AND no single query traverses both relations under one name.

### Requirement: EVALUATES and Finding targets use a tagged union with exactly one member

The schema SHALL define EvaluationTarget as a TaggedUnion over attempt,
artifact, and claim, and no other shape.

Evaluation.target SHALL be typed EvaluationTarget and SHALL be required.
Finding.about SHALL be typed EvaluationTarget and SHALL be optional.
IF a write sets more than one member of an EvaluationTarget instance, THEN
the store SHALL reject the write, because a TaggedUnion enforces
mutual exclusivity structurally.

#### Scenario: an evaluation always resolves to exactly one target type

- WHEN an Evaluation document is read back
- THEN exactly one of target.attempt, target.artifact, or target.claim
  is present
- AND no query needs a union across three differently-shaped fields to find
  it.

### Requirement: RESOLVED_TO is functional and human-reviewable; its acyclicity is an external invariant

Entity.resolved_to SHALL be typed Optional of Entity, making it functional
by construction -- at most one resolution target per entity.

Entity SHALL carry a resolved_reviewed_by field alongside
resolved_to.
The schema SHALL NOT claim to enforce acyclicity of resolved_to, because
TerminusDB constraint language has no cycle-detection construct.
IF a component asserts that the schema enforces resolved_to acyclicity,
THEN that assertion SHALL be treated as false, and the acyclicity check
SHALL be implemented as an external validator instead.

#### Scenario: at most one resolution target is representable

- WHEN an Entity write attempts to set two different resolved_to
  targets in one document
- THEN the write is rejected, because Optional admits at most one value
- AND the rejection is a native Optional-cardinality rejection, not a
  custom check.

#### Scenario: a resolution cycle is not caught by the schema

- WHEN entity A resolves to B and a write then sets B to resolve to A
- THEN the schema accepts both writes individually
- AND the cycle is only caught by the external validator, which this
  package does not implement.

### Requirement: SUPERSEDES is reified because the store has no edge properties

The schema SHALL define Supersession as a top-level document class with
old, new, at, and reason fields, and SHALL NOT define supersedes as
a plain field on GraphNode.

GraphNode.derived_from and GraphNode.revises SHALL remain plain fields,
because neither requires edge properties.
The mutual exclusion of derived_from, revises, and an accepted
Supersession record for the same pair of nodes SHALL be documented as an
external invariant, not a schema-enforced constraint.

#### Scenario: a supersession carries its timestamp and reason

- WHEN a node is superseded
- THEN a Supersession document is written with old, new, at, and
  reason all populated
- AND no data is silently dropped, unlike a plain field would drop it.

#### Scenario: the schema does not block a contradictory triple of relations

- WHEN a pair of nodes simultaneously has a derived_from link, a revises
  link, and an accepted Supersession record between them
- THEN the schema accepts all three
- AND only the external invariant check, not implemented here, flags the
  contradiction.

### Requirement: MENTIONS is not a stored edge

The schema SHALL NOT define a Mention class or a mentions property.

Any co-occurrence relationship between a Source and an Entity SHALL be
computed as a derived index outside this schema, and SHALL be excluded from
any content served to an extracting model.
IF a future revision reintroduces MENTIONS as a stored edge, THEN that
revision SHALL cite a competency question this schema gap list (CQ-16)
does not already cover, per this package design record.

#### Scenario: no stored mention edge exists

- WHEN the schema is scanned for a class or property representing
  source-to-entity mentions
- THEN none exists
- AND the schema design record names the derived-index alternative.

### Requirement: every LLM-populated field is an enum or a reference

No field written by an extracting model SHALL be typed xsd:decimal,
xsd:float, or xsd:double.

Provenance.confidence SHALL be typed ConfidenceLevel, a three-value
closed enum, and SHALL NOT be a numeric range.
Claim.status SHALL be typed ClaimStatus, a closed enum.
Entity.kind SHALL be typed EntityKind, a closed enum, and SHALL NOT be an
open xsd:string.
WHERE a field is a deterministic measurement rather than an LLM-authored
judgement (Measurement.value), the enum-or-reference rule SHALL NOT apply,
and the schema SHALL document the exemption at the field.

#### Scenario: confidence is never a float

- WHEN the schema is scanned for every field typed ConfidenceLevel
- THEN each such field accepts only extracted, inferred, or ambiguous
- AND no LLM-populated field in the schema accepts an open numeric range.

#### Scenario: a measurement value is the documented exception

- WHEN Measurement.value is inspected
- THEN it is typed xsd:decimal
- AND its class-level documentation states why the enum-or-reference rule
  does not apply to it.

### Requirement: Claim, Evaluation, Finding, and Source are top-level document classes

Claim, Evaluation, Finding, and Source SHALL NOT carry
@subdocument.

Provenance and EvaluationTarget MAY carry @subdocument or be a
TaggedUnion respectively, because they are always owned by exactly one
parent document and are never independently addressed.
Any class carrying @subdocument SHALL key with Random or ValueHash,
never Lexical, per the store own key-strategy restriction on
subdocuments.

#### Scenario: a superseded claim remains independently addressable

- WHEN a Claim is superseded
- THEN the superseded Claim document remains independently queryable by
  its own @id
- AND it is not cascade-deleted as a subdocument would be if its owner were
  deleted.

### Requirement: unverified agent runs are representable, not rejected

AgentRun.invocation_id, AgentRun.external_params, and the
non-emptiness of AgentRun.resolved_deps SHALL NOT be enforced as
write-time requirements.

An AgentRun missing one or more of invocation_id, external_params, or
any resolved_deps entries SHALL be accepted by the schema and SHALL be
queryable as unverified.
IF a future revision makes any of these fields required, THEN that revision
SHALL first confirm that the competency question "which agent runs are
unverified" is answerable by some other means, because a required field
makes the non-conforming case un-writable.

#### Scenario: an incomplete agent run is written and later found

- WHEN an AgentRun is written with invocation_id and external_params
  both absent
- THEN the write succeeds
- AND a query for agent runs missing either field returns that document.

### Requirement: the schema is authored by one human, reviewed, and frozen

This schema document SHALL be treated as authored by a single human
reviewer and frozen for v0.2.9.

No model SHALL extend, amend, or re-author this schema class or property
list without a new, explicitly human-reviewed revision.
The schema SHALL remain OWL 2 RL-shaped -- no property chains, no complex
class expressions beyond TaggedUnion/@oneOf -- so a mechanical RDF export
remains possible later, even though this package does not build one.
Every one of N2 24 competency questions SHALL be mapped to schema elements
or explicitly recorded as a gap in this package design record.

#### Scenario: every competency question has a disposition

- WHEN the design record competency-question table is read
- THEN each of the 24 questions has either a schema-element mapping or an
  explicit gap entry
- AND no question is silently absent from the table.

#### Scenario: the schema rejects a property-chain-shaped addition

- WHEN a proposed revision would add a property chain or a complex class
  expression beyond TaggedUnion/@oneOf
- THEN the revision is rejected as breaking the OWL 2 RL-shaped constraint
- AND the rejection cites this requirement.

#### Scenario: the frozen schema is proven to load, not merely proven to parse

- WHEN this package's gate runs
- THEN the exact fenced schema block is loaded into a fresh pinned
  TerminusDB 12.0.6 container with full_replace=true and read back
- AND a positive instance fixture is accepted and a negative instance
  fixture is rejected
- AND valid JSON syntax alone is not treated as sufficient evidence the
  schema is usable.

### Requirement: every GraphNode-derived document carries a producer-version stamp

GraphNode SHALL declare graphify_version as an Optional xsd:string field,
inherited by every concrete class in the schema.

The field SHALL be the sole mechanism by which an ingested document records
the graphify version that produced it. No other class SHALL declare a
differently-named field for the same purpose.

#### Scenario: a document stamped with graphify_version is accepted

- WHEN a document of any concrete GraphNode-derived class is written with
  graphify_version set
- THEN the write succeeds, because the field is schema-declared
- AND the value round-trips on read.

#### Scenario: an undeclared field is still rejected

- WHEN a document is written carrying a field name that is not declared on
  its class or an ancestor
- THEN TerminusDB rejects the write
- AND graphify_version does not need this treatment because it is now
  declared on the common ancestor every class inherits.

### Requirement: the graphify-to-schema mapping is a versioned manifest, not an implicit convention

This package SHALL publish a versioned mapping manifest (design.md,
"graphify -> schema mapping manifest") that maps every graphify node file_type
to exactly one schema class, every graphify edge relation type to exactly
one schema field or an explicit drop rule, and every graphify hyperedge to
an explicit drop rule, because no schema class or property may be inferred
by a downstream package without a named, reviewed source of truth.

The manifest SHALL carry a manifest_version integer. Any graphify shape not
covered by the current manifest_version SHALL be rejected or dropped-with-
record, never silently written under a best-guess class.

#### Scenario: every graphify node kind maps to exactly one class

- WHEN each of the six graphify file_type values is looked up in the
  manifest
- THEN each resolves to exactly one schema class and key-derivation rule
- AND no file_type resolves to more than one class.

#### Scenario: an unmapped node kind is rejected, not guessed

- WHEN a graphify node carries a file_type not present in the manifest
- THEN ingest rejects that node before any write, naming the node id and
  the unrecognized file_type
- AND no document is written under a best-guess class.

#### Scenario: hyperedges are recorded, not silently dropped

- WHEN graph.json carries a non-empty hyperedges array
- THEN every hyperedge object is classified drop-with-record under the
  current manifest_version
- AND the drop appears in the ingest report, not only in a log line nobody
  reads.
