# Change: terminusdb-schema

## Why

The product owner has decided TerminusDB ships in v0.2.9
(`graph-store-port` proposal + R8). That package owns the port abstraction
and the files-only implementation; it does not own the ontology itself. This
package is the schema behind the port: the frozen, human-authored TerminusDB
document schema that every write and read in the graph plane validates
against.

R8 loaded a draft 18-class/enum schema live against TerminusDB 12.0.6 and
verified it: schema accepted on first attempt, all three lineage queries
(including the negation-as-failure query that closed the OWL-vs-closed-world
decision) returned correct answers on first run. That draft is the starting
point, not the destination. N2's ontology-engineering lane reviewed it
against 24 hand-written competency questions and found five blocking defects:

1. **`Round` and `Attempt` were missing from the earlier brief's own node
   list**, even though R8's draft schema already carried them -- without them,
   five competency questions are unanswerable and `AgentRun` has nowhere to
   hang.
2. **`Agent` was missing as a node.** `AgentRun` carried `vendor`/`model` as
   plain strings. Cross-vendor orchestration is Foreman's whole thesis, and
   you cannot query across vendors when the vendor is a string, not a node.
3. **`Spec` was missing as a node.** The five-part spec is Foreman's central
   artifact; modelling it as `Artifact{kind:spec}` forces a kind-filter into
   every query and prevents `criteria` from being schema-required.
4. **`Metric` conflated the definition of a measure with a measurement
   event.** SEON's split (`Metric`/`Measurement`) is needed to answer "which
   metrics regressed between commit A and commit B".
5. **`PARENT_OF` was three unrelated relations wearing one name**
   (Round to Attempt, Task to Subtask, Entity to Entity taxonomy) -- OOPS!
   pitfall P07, and exactly the shape of overload an LLM extractor resolves
   at domain/range F1 approximately 0.03 (Bakker et al. 2025, measured).

Two further findings are structural, not additive:

- **TerminusDB has no edge properties.** It is a document graph. Any
  attribute that belongs on an edge (span/confidence on a mention, timestamp
  and reason on a supersession) must be reified into an intermediate
  document, or it silently disappears (R8 section 3.1, verified live).
- **TerminusDB's constraint language is thin.** No regex, no ranges, no
  uniqueness beyond `@key`, no conditional constraints, no cross-document
  constraints, and no formal class disjointness declaration. `sys:JSON` is an
  unchecked escape hatch. Several invariants this ontology needs -- acyclicity
  of `DEPENDS_ON`/`SUBTASK_OF`/`BROADER_THAN`/`RESOLVED_TO`, mutual exclusion
  of `DERIVED_FROM`/`REVISES`/being-superseded, the disjointness of the
  work-DAG and knowledge planes -- are **not enforceable by the schema at
  all** and must be checked by an external validator (N4's territory). This
  package states each one explicitly rather than pretending the schema
  covers it.

Every LLM-populated field is an enum or a reference, never a free float or an
open string -- graphify's own extraction spec (`skills/graphify/references/
extraction-spec.md`) records a measured production failure of exactly this
kind: continuous confidence values collapsing bimodally (>50% at 0.5, >40%
at 0.85+) because the model cannot follow a continuous rubric. This schema
applies that lesson everywhere an LLM writes a field, not just where R8 or N2
happened to flag it.

## What changes

- **A frozen, human-authored TerminusDB schema document** -- the actual
  schema, not a sketch -- covering the work-DAG plane (`Task`, `Round`,
  `Attempt`, `AgentRun`, `Agent`, `Spec`, `Commit`, `Evaluation`, `Finding`,
  `Metric`, `Measurement`), the knowledge plane (`Claim`, `Entity`), the one
  designed plane-crossing class (`Source`), and the reified classes
  (`Provenance`, `EvaluationTarget`, `Supersession`) needed because
  TerminusDB has no edge properties. See `design.md` for the full JSON.
- **`PARENT_OF` does not exist in this schema.** It is replaced by three
  distinct relations: `has_attempt` (`Round` to `Attempt`), `depends_on` used
  for `Task` to `Task` sub-tasking, and `broader_than` (`Entity` to `Entity`,
  knowledge plane only).
- **`EVALUATES` and `Finding.about` are a `TaggedUnion`** (`EvaluationTarget`)
  with exactly one of `attempt`/`artifact`/`claim` set, never a union query
  over an untyped target.
- **`RESOLVED_TO` (`Entity.resolved_to`) is functional** (at most one target,
  enforced natively by `Optional`), carries a `resolved_reviewed_by` field,
  and its acyclicity is declared as an external invariant the schema cannot
  enforce.
- **`SUPERSEDES` is reified** as a `Supersession` document carrying `at` and
  `reason`, because a plain field cannot carry edge properties.
  `DERIVED_FROM` and `REVISES` stay plain fields; their mutual exclusion
  against an accepted `Supersession` is declared as an external invariant.
- **`MENTIONS` is not in this schema.** Per N2's finding (highest-volume
  edge, serves one competency question weakly) it is demoted to a derived
  index built by the ingest layer, out of this package's scope, and excluded
  from anything shown to an extracting model.
- **`Entity` carries a closed `kind` enum** and is structurally disjoint from
  every work-DAG type: it inherits `GraphNode` directly and never
  `WorkNode`. `Source` is the one deliberate, documented exception -- it
  inherits the plane-bridging `Artifact` abstract class, not `WorkNode`, and
  its `origin` field records whether it is a human, external, or
  agent-produced source.
- **A `Provenance` subdocument** (embedded, never top-level) is required on
  every LLM-written node (`Claim`, `Entity`, `Finding`) and records the
  extracting agent-or-human, timestamp, a three-value discrete confidence
  enum (`extracted`/`inferred`/`ambiguous` -- never a float), and a required
  source locator.
- **`AgentRun`'s SLSA-shaped provenance fields are `Optional`, not
  required**, so that an incomplete ("unverified") agent run can actually be
  written and then found by a query -- a schema that makes those fields
  required would make the "which runs are unverified" competency question
  answerable in principle and impossible in practice, because the
  non-conforming write would simply be rejected.
- **A full mapping of N2's 24 competency questions to schema elements**, in
  `design.md`, with every unmapped question recorded as an explicit gap
  rather than silently dropped.

## Impact

- **New:** `openspec/changes/terminusdb-schema/` -- this package. Nothing
  outside it is modified.
- **Depended on by `graph-store-port`.** That package's write-time validation
  requirement, its adapter's schema-registration step, and its ingest path
  all target the schema defined here.
- **`graph-store-port` needs an architect revision -- flagged, not applied by
  this lane:**
  1. Its `proposal.md` closes with *"May be deferred by architect decision
     behind GP-7's query census... If the census finds genuine multi-hop
     cross-run queries are rare, this package is frozen and nothing above it
     changes."* The product owner's decision that TerminusDB ships
     supersedes the premise that adoption itself is still open; what remains
     genuinely open is only per-host opt-in, which the same package already
     handles correctly via the files-only default.
  2. Its `design.md` opens with *"Does Foreman need a queryable, versioned,
     schema-enforced store? Unresolved. GP-7's query census answers it."*
     Same supersession as above.
  3. Its `design.md`'s rejected-alternatives section still frames "skip the
     store entirely" as live pending GP-7, for the same reason.
  4. Its `specs/store/spec.md` already contains a **Requirement: the frozen
     N2 schema is enforced at write time**, with its own partial class
     enumeration (it never mentions `Finding`, `Provenance`,
     `EvaluationTarget`, or `Supersession`, and separately references a
     `Finding` class under a different requirement without ever defining
     one). That requirement should be revised to point at this package's
     schema rather than restating an independent, now-divergent class list.
  5. Its `tasks.md` T2 ("the frozen schema") duplicates this package's
     deliverable and should be replaced with a dependency on this package
     rather than its own authoring task.
  None of the above is changed by this lane -- `graph-store-port` is
  explicitly untouched per this spec's Files section. The architect owns the
  reconciliation.
- **Depends on nothing new.** This package defines a document, not code; it
  requires no new dependency.
