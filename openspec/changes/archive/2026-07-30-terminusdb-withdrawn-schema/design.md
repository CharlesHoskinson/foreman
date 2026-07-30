# Design -- terminusdb-schema

## Approach

One human-authored TerminusDB document schema, frozen, reviewed, never
LLM-authored or LLM-extended (N2 section 2.2 step 4).

The type set is the union of what N2 24 competency questions need (section
9 of docs/research/vnext/N2-ontology-engineering.md), per N2 own
methodology (section 2.2 step 3): build the minimal type set as the union of
CQ requirements, delete anything left over. Three classes exist that are not
directly named in N2 terse table -- Provenance, EvaluationTarget,
Supersession -- and each is a reification forced by TerminusDB having no
edge properties, not speculative modelling. Two properties exist that N2
edge table does not list -- AgentRun.consumed and Evaluation.contradicts
-- and both are justified by name against a specific competency question in
the mapping table below, not added speculatively (OOPS! P04 discipline).

## The schema

Verified against terminusdb.org/docs/schema-reference-guide/ (fetched live
2026-07-28) for Set/@min_cardinality, TaggedUnion, @subdocument
(subdocuments must key Random or ValueHash, never Lexical), Enum, and
sys:JSON syntax, and against R8 own live-loaded draft
(docs/research/vnext/R8-terminusdb-store.md section 3.2, which this schema
supersedes) for the base JSON-LD context shape and the Optional/Set
patterns already confirmed to load against TerminusDB 12.0.6.

```json
[
{ "@type": "@context",
  "@base": "terminusdb:///foreman/data/",
  "@schema": "terminusdb:///foreman/schema#",
  "@documentation": {
    "@title": "Foreman Graph Plane -- v0.2.9 frozen schema",
    "@description": "Work-DAG (Task/Round/Attempt/AgentRun/Agent/Evaluation/Finding/Spec/Commit/Metric/Measurement) plus knowledge plane (Entity/Claim/Source), with reified provenance and lineage.",
    "@authors": ["Foreman v0.2.9 -- Council Lane 1 (schema/ontology)"] } },

{ "@id": "TaskState", "@type": "Enum",
  "@value": ["pending", "in_progress", "blocked", "done", "abandoned"] },
{ "@id": "AttemptState", "@type": "Enum",
  "@value": ["pending", "running", "passed", "failed", "superseded", "abandoned"] },
{ "@id": "RunStatus", "@type": "Enum",
  "@value": ["pending", "running", "succeeded", "failed", "cancelled", "timeout"] },
{ "@id": "LaneRole", "@type": "Enum",
  "@value": ["implement", "audit", "advise", "plan", "search"] },
{ "@id": "Vendor", "@type": "Enum",
  "@value": ["anthropic", "openai", "xai", "google", "human"] },
{ "@id": "Verdict", "@type": "Enum",
  "@value": ["pass", "fail", "blocked", "inconclusive"] },
{ "@id": "ArtifactKind", "@type": "Enum",
  "@value": ["code", "config", "doc", "transcript", "dataset", "binary", "other"] },
{ "@id": "ClaimStatus", "@type": "Enum",
  "@value": ["live", "superseded", "retracted"] },
{ "@id": "EntityKind", "@type": "Enum",
  "@value": ["person", "organization", "system", "concept", "standard", "tool", "file", "other"] },
{ "@id": "SourceOrigin", "@type": "Enum",
  "@value": ["human", "external", "agent_run"] },
{ "@id": "ConfidenceLevel", "@type": "Enum",
  "@value": ["extracted", "inferred", "ambiguous"] },
{ "@id": "FindingSeverity", "@type": "Enum",
  "@value": ["info", "minor", "major", "critical"] },

{ "@id": "Provenance", "@type": "Class", "@subdocument": [],
  "@key": { "@type": "ValueHash" },
  "@documentation": { "@comment": "N2 section 10.5 P block, embedded -- never a top-level document. Required on every LLM-populated node. Confidence is a discrete enum, never a float." },
  "extractor_agent": { "@type": "Optional", "@class": "Agent" },
  "extractor_is_human": "xsd:boolean",
  "extracted_at": "xsd:dateTime",
  "confidence": "ConfidenceLevel",
  "source_artifact": "Source",
  "source_locator": "xsd:string" },

{ "@id": "EvaluationTarget", "@type": "TaggedUnion",
  "@key": { "@type": "ValueHash" },
  "@documentation": { "@comment": "Exactly one target per Evaluation or Finding -- N2 section 10.4." },
  "attempt": "Attempt",
  "artifact": "Artifact",
  "claim": "Claim" },

{ "@id": "GraphNode", "@type": "Class", "@abstract": [],
  "@documentation": { "@comment": "Common base: every node is provenanced and lineage-linked. Thin and stable by design -- the store migration API cannot restructure inheritance (ChangeParents is documented as unimplemented), so this class must not grow. This class gained one field, graphify_version (Optional xsd:string), as a deliberate, reviewed pre-freeze weakening exception -- the producing-graphify-version stamp every ingested document must carry, per the live-verified finding that ingest fails without it (see docs/research/vnext/VERIFY-terminusdb-schema-live.md in the read-only research tree)." },
  "created_at": "xsd:dateTime",
  "run_id": { "@type": "Optional", "@class": "xsd:string" },
  "event_offset": { "@type": "Optional", "@class": "xsd:integer" },
  "labels": { "@type": "Set", "@class": "xsd:string" },
  "derived_from": { "@type": "Set", "@class": "GraphNode" },
  "revises": { "@type": "Optional", "@class": "GraphNode" },
  "graphify_version": { "@type": "Optional", "@class": "xsd:string" } },

{ "@id": "WorkNode", "@type": "Class", "@abstract": [], "@inherits": ["GraphNode"],
  "@documentation": { "@comment": "Work-DAG plane marker. Materialised deterministically from events.jsonl -- never LLM-written. No knowledge-plane class inherits this, which is the structural half of the Entity disjointness requirement." } },

{ "@id": "Artifact", "@type": "Class", "@abstract": [], "@inherits": ["GraphNode"],
  "@documentation": { "@comment": "Deliberate plane bridge (N2 open question, docs/research/vnext/N2-ontology-engineering.md section 11 Q1): Spec and Commit are work-plane only; Source is the one designed crossing into the knowledge plane, distinguished by its origin field. Inherits GraphNode directly, not WorkNode, precisely so this bridge is possible without breaking the Entity disjointness." },
  "digest": "xsd:string",
  "kind": "ArtifactKind",
  "path": { "@type": "Optional", "@class": "xsd:string" },
  "artifact_depends_on": { "@type": "Set", "@class": "Artifact" } },

{ "@id": "Task", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "Lexical", "@fields": ["task_key"] },
  "task_key": "xsd:string",
  "title": "xsd:string",
  "state": "TaskState",
  "spec": { "@type": "Optional", "@class": "Spec" },
  "subtask_of": { "@type": "Optional", "@class": "Task" },
  "depends_on": { "@type": "Set", "@class": "Task" } },

{ "@id": "Round", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "Lexical", "@fields": ["task_key", "index"] },
  "task_key": "xsd:string",
  "task": "Task",
  "index": "xsd:integer",
  "opened_at": "xsd:dateTime",
  "closed_at": { "@type": "Optional", "@class": "xsd:dateTime" },
  "has_attempt": { "@type": "Set", "@class": "Attempt" } },

{ "@id": "Attempt", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "Lexical", "@fields": ["attempt_key"] },
  "attempt_key": "xsd:string",
  "round": "Round",
  "lane": "LaneRole",
  "index": "xsd:integer",
  "state": "AttemptState" },

{ "@id": "Agent", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "Lexical", "@fields": ["agent_key"] },
  "agent_key": "xsd:string",
  "vendor": "Vendor",
  "model": "xsd:string",
  "version": { "@type": "Optional", "@class": "xsd:string" } },

{ "@id": "AgentRun", "@type": "Class", "@inherits": ["WorkNode"],
  "@documentation": { "@comment": "SLSA-shaped provenance fields (invocation_id, external_params) are Optional, deliberately, not required -- a required field would make a non-conforming (unverified) run un-writable, which defeats N2 competency question 7 (which artifacts were produced by an unverified agent run). Unverified is a query predicate over an accepted document, not a write-time rejection." },
  "@key": { "@type": "Lexical", "@fields": ["agent_run_id"] },
  "agent_run_id": "xsd:string",
  "attempt": "Attempt",
  "agent": "Agent",
  "on_behalf_of": { "@type": "Optional", "@class": "AgentRun" },
  "status": "RunStatus",
  "started_at": "xsd:dateTime",
  "ended_at": { "@type": "Optional", "@class": "xsd:dateTime" },
  "tokens_in": { "@type": "Optional", "@class": "xsd:integer" },
  "tokens_out": { "@type": "Optional", "@class": "xsd:integer" },
  "invocation_id": { "@type": "Optional", "@class": "xsd:string" },
  "resolved_deps": { "@type": "Set", "@class": "xsd:string" },
  "external_params": { "@type": "Optional", "@class": "sys:JSON" },
  "produced": { "@type": "Set", "@class": "Artifact" },
  "consumed": { "@type": "Set", "@class": "Artifact" } },

{ "@id": "Spec", "@type": "Class", "@inherits": ["Artifact"],
  "@key": { "@type": "Lexical", "@fields": ["spec_key"] },
  "spec_key": "xsd:string",
  "version": "xsd:string",
  "criteria": { "@type": "Set", "@class": "xsd:string", "@min_cardinality": 1 } },

{ "@id": "Commit", "@type": "Class", "@inherits": ["Artifact"],
  "@documentation": { "@comment": "Foreign in spirit, not in the TerminusDB Foreign-type sense: the sha is the only load-bearing field. Git remains the store for commit ancestry -- this class exists so Measurement and PRODUCED have something typed to point at." },
  "@key": { "@type": "Lexical", "@fields": ["sha"] },
  "sha": "xsd:string",
  "repo": "xsd:string",
  "branch": { "@type": "Optional", "@class": "xsd:string" },
  "parents": { "@type": "Set", "@class": "xsd:string" } },

{ "@id": "Source", "@type": "Class", "@inherits": ["Artifact"],
  "@key": { "@type": "Lexical", "@fields": ["uri"] },
  "uri": "xsd:string",
  "origin": "SourceOrigin",
  "captured_at": { "@type": "Optional", "@class": "xsd:dateTime" },
  "excerpt": { "@type": "Optional", "@class": "xsd:string" },
  "produced_by": { "@type": "Optional", "@class": "AgentRun" } },

{ "@id": "Evaluation", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "Lexical", "@fields": ["evaluation_id"] },
  "evaluation_id": "xsd:string",
  "target": "EvaluationTarget",
  "verdict": "Verdict",
  "rationale": { "@type": "Optional", "@class": "xsd:string" },
  "evaluator_agent": { "@type": "Optional", "@class": "Agent" },
  "evaluator_is_human": "xsd:boolean",
  "at": "xsd:dateTime",
  "metrics": { "@type": "Set", "@class": "Measurement" },
  "contradicts": { "@type": "Set", "@class": "Claim" } },

{ "@id": "Finding", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "ValueHash" },
  "evaluation": "Evaluation",
  "severity": "FindingSeverity",
  "text": "xsd:string",
  "spec_clause": { "@type": "Optional", "@class": "xsd:string" },
  "about": { "@type": "Optional", "@class": "EvaluationTarget" } },

{ "@id": "Claim", "@type": "Class", "@inherits": ["GraphNode"],
  "@key": { "@type": "Lexical", "@fields": ["claim_key"] },
  "claim_key": "xsd:string",
  "text": "xsd:string",
  "status": "ClaimStatus",
  "provenance": "Provenance",
  "about": { "@type": "Set", "@class": "Entity" },
  "supports": { "@type": "Set", "@class": "Claim" },
  "contradicts": { "@type": "Set", "@class": "Claim" },
  "sourced_from": { "@type": "Set", "@class": "Source" } },

{ "@id": "Entity", "@type": "Class", "@inherits": ["GraphNode"],
  "@documentation": { "@comment": "Inherits GraphNode directly, never WorkNode -- this is the structural disjointness against every work-DAG type. kind is a closed enum, not a free string, so this class cannot become the P21 miscellaneous-class catch-all every extraction failure lands in." },
  "@key": { "@type": "Lexical", "@fields": ["entity_key"] },
  "entity_key": "xsd:string",
  "canonical_name": "xsd:string",
  "kind": "EntityKind",
  "aliases": { "@type": "Set", "@class": "xsd:string" },
  "resolved_to": { "@type": "Optional", "@class": "Entity" },
  "resolved_reviewed_by": { "@type": "Optional", "@class": "xsd:string" },
  "broader_than": { "@type": "Set", "@class": "Entity" },
  "provenance": "Provenance" },

{ "@id": "Metric", "@type": "Class", "@inherits": ["WorkNode"],
  "@documentation": { "@comment": "SEON Metric/Measurement split: this is the definition (name/unit/scale), never a value." },
  "@key": { "@type": "Lexical", "@fields": ["name"] },
  "name": "xsd:string",
  "unit": { "@type": "Optional", "@class": "xsd:string" },
  "scale": { "@type": "Optional", "@class": "xsd:string" } },

{ "@id": "Measurement", "@type": "Class", "@inherits": ["WorkNode"],
  "@documentation": { "@comment": "The measurement event: one Metric, one subject Commit, one value, one timestamp. value is xsd:decimal deliberately -- this is a deterministic measurement, not an LLM-authored opinion, so the enum-or-reference rule does not apply to it." },
  "@key": { "@type": "ValueHash" },
  "metric": "Metric",
  "subject": "Commit",
  "value": "xsd:decimal",
  "at": "xsd:dateTime" },

{ "@id": "Supersession", "@type": "Class", "@inherits": ["GraphNode"],
  "@documentation": { "@comment": "Reified SUPERSEDES. This is the one lineage relation the TerminusDB lack of edge properties forces into a document now, because N2 requires SUPERSEDES to carry at and reason, and a plain field cannot carry them. derived_from and revises stay plain GraphNode fields because neither needs properties." },
  "@key": { "@type": "ValueHash" },
  "old": "GraphNode",
  "new": "GraphNode",
  "at": "xsd:dateTime",
  "reason": "xsd:string" }
]
```

Load with (per R8 section 3.2, verified live against 12.0.6 -- full_replace=true
is mandatory whenever the payload contains an @context object):

```bash
curl -u admin:$TERMINUSDB_ADMIN_PASS -X POST \
  "http://localhost:6363/api/document/admin/foreman?graph_type=schema&full_replace=true&author=terminusdb-schema&message=v0.2.9+frozen+ontology" \
  -H "Content-Type: application/json" --data-binary @foreman-schema.json
```

## Schema version and change procedure

**Schema version:** `v0.2.9` (recorded in the `@context` `@documentation.@title`
above and in this section). This is the frozen ontology for the v0.2.9 release.

**Authoritative source:** the fenced JSON schema block in this file
(`design.md`). Downstream packages MUST extract that block deterministically
(largest parseable fenced JSON block in this file) rather than retyping or
maintaining a parallel copy.

**Change procedure (mandatory for any post-freeze edit):**

1. Open a new OpenSpec change (or a new revision of this package) that names
   the target schema version (for example `v0.2.10`) and the motivating
   competency question or production defect.
2. Human-author the schema delta; no model may extend, amend, or re-author the
   class or property list without that human review (see store-schema spec,
   "the schema is authored by one human, reviewed, and frozen").
3. Update the CQ mapping table and the graphify mapping manifest in the same
   change. Bump `manifest_version` when node/edge/hyperedge treatment changes.
4. Run `scripts/schema-live-gate.sh` against pinned
   `terminusdb/terminusdb-server:v12.0.6` (digest
   `sha256:e02eaa3a5b75e01550cee2a662a846db7fceb725193983f1f35e1842ab580fee`).
   All live checks must pass, including positive acceptance, invalid-enum
   rejection, undeclared-field rejection, and drop-and-rebuild identity.
5. Record the version bump in this section and in `@documentation.@title`.

Silent drift is a defect: consumers bind to a shape nobody promised.

## Competency question mapping (N2 section 9, 24 questions)

| CQ | Answered by | Notes |
|---|---|---|
| 1 | Round.has_attempt to Attempt; Attempt via AgentRun.attempt (backlink) to AgentRun.agent to Agent | direct |
| 2 | AgentRun.produced to Commit; Commit via Attempt (via AgentRun.attempt backlink) | tag-reachability half is git, not the graph -- division of labour matches graph-store-port design.md |
| 3 | Attempt with no Evaluation whose target.attempt (EvaluationTarget) points at it | negation over the tagged union backlink |
| 4 | Evaluation(verdict=fail) to Finding.evaluation (backlink) to Finding.spec_clause vs Spec.criteria | this CQ is why Finding exists |
| 5 | Supersession.old=Attempt, .new, .at, .reason | reason is free text; a formal Spec reference inside Supersession is a candidate future refinement, not added now (kept to what the CQ requires) |
| 6 | AgentRun.agent (Agent.vendor/model) vs an external routing policy | Agent as a node is the blocking requirement N2 flagged; the policy comparison itself is external logic, not graph data |
| 7 | AgentRun where invocation_id, resolved_deps, or external_params is absent | representable only because these fields are Optional -- see the AgentRun documentation comment |
| 8 | Task.depends_on cycle check (dependency ordering only -- distinct from Task.subtask_of, which is a separate functional relation not covered by this CQ) | not schema-enforced -- TerminusDB constraint language has no cycle check; this is an external invariant, N4 territory |
| 9 | Commit.branch vs git branch-head timestamps | schema supplies the Commit data; the "landed after worktree creation" comparison is external, same division as CQ-2 |
| 10 | AgentRun.consumed vs Supersession/revises timestamps on the consumed Artifact | consumed is not in N2 edge table; added here because no modelled path otherwise answers this CQ (PROV prov:used is the direct precedent, N2 section 7.1) |
| 11 | Round.has_attempt aggregated across a Task Round set (via Round.task); AgentRun.consumed diff between the passing and last failing attempt | |
| 12 | AgentRun.tokens_in/tokens_out vs AgentRun.produced to no Evaluation(verdict=pass) targeting it | |
| 13 | Commit via AgentRun.produced (backlink) to .attempt to .round to .task; AgentRun.on_behalf_of chain | |
| 14 | Claim.sourced_from empty | |
| 15 | Claim.sourced_from to Source.origin==agent_run to Source.produced_by (recursive) | |
| 16 | gap, by design -- answered by the derived MENTIONS index (ingest-layer, out of this package scope), combined with Entity.resolved_to | N2 explicitly demoted MENTIONS; this CQ other half lives outside the frozen schema |
| 17 | Evaluation.contradicts to Claim; Claim.sourced_from on each side | Evaluation.contradicts is not in N2 edge table as a separate field from Claim.contradicts -- added because N2 own table lists CONTRADICTS domain as Claim-or-Evaluation to Claim, and a single TerminusDB property cannot carry two different source types without a TaggedUnion wrapper this CQ does not otherwise need |
| 18 | Claim.sourced_from recursive to a Source with origin != agent_run | |
| 19 | Claim.about intersection, Claim.contradicts, Claim.status != superseded, no Supersession between the pair | |
| 20 | Claim.status==superseded; Artifact.derived_from includes that Claim (the base GraphNode.derived_from field is untyped-by-class, so an Artifact can legally derive from a Claim) | |
| 21 | Spec (as Artifact) with no Evaluation.target.artifact pointing at it; Finding.spec_clause vs Spec.criteria membership | |
| 22 | gap, by design -- no modelled link from AgentRun to the Claims or Entities "in its context" | not added speculatively; inventing an edge for one CQ with fuzzy operational semantics is exactly the over-modelling N2 section 2.2 step 3 warns against |
| 23 | Source(bugeventlog entries, ingested) to Claim.sourced_from to Evaluation.target.claim(verdict=pass) | schema supports it; the ingestion of bugeventlog.md entries as Source documents is a process question, not a schema gap |
| 24 | Measurement.subject (two Commits, same Metric) diff; Commit via AgentRun.produced (backlink) | this CQ is why Metric/Measurement were split |

Two gaps are recorded, not silently dropped: CQ-16 MENTIONS half, and
CQ-22 in full. Both are candidates for the schema next revision if the
ingest census or a later round shows they are load-bearing.

## graphify -> schema mapping manifest (v1)

This manifest is versioned (`manifest_version: 1`, recorded as a constant
the adapter reads). It is the authoritative, deterministic mapping from
graphify's node/edge/hyperedge shapes onto this schema's classes and
fields. The adapter package consumes it and enforces its reject/drop rule
-- it does not invent its own mapping.

### Table 1 -- node kind to class

| graphify file_type | Foreman class | class-specific enum/field | key field | key source (from graphify node) | required-field defaults | provenance treatment |
|---|---|---|---|---|---|---|
| code | Source | kind = ArtifactKind.code | uri | source_file | digest = sha256 of excerpt (or of label if excerpt absent); path = source_file | see Provenance rule below |
| document | Source | kind = ArtifactKind.doc | uri | source_file | same as code | same |
| paper | Source | kind = ArtifactKind.doc | uri | source_file | same as code; paper folds into the doc enum value -- a deliberate, documented lossy fold, not an omission | same |
| image | Source | kind = ArtifactKind.binary | uri | source_file | digest = sha256 of label (no textual excerpt available for images) | same |
| concept | Entity | kind = EntityKind.concept | entity_key | id | canonical_name = norm_label if present else label; aliases = {label} when norm_label differs from label | same |
| rationale | Claim | status = ClaimStatus.live | claim_key | id | text = label; about = empty Set (populated by a later resolution pass, not at ingest); sourced_from = {the Source derived from source_file} when that Source was already ingested in this run, else empty | same |

**Provenance rule** (applies to every row above that carries a Provenance
subdocument -- Source does not carry Provenance directly since it inherits
Artifact/GraphNode, not Claim/Entity; Entity and Claim do): confidence is
derived from graphify node `metadata.confidence_score` when present, bucketed
as extracted (>=0.85), inferred (0.5-0.85), ambiguous (<0.5 or absent);
extractor_is_human = false; extracted_at = ingest timestamp;
source_locator = source_location if present else source_file.

**Reject rule:** any graphify node whose file_type is not one of the six rows
above SHALL be rejected before any write for that node, naming the node id
and the unrecognized file_type. (The adapter package names the concrete
error; see terminusdb-adapter.)

### Table 2 -- edge relation type to schema field

A second, symmetric classification alongside the existing edge-property
classifier D10 in terminusdb-adapter; this table classifies the relation
label itself, D10 classifies the properties riding on it:

| graphify relation type | schema treatment |
|---|---|
| derived_from | GraphNode.derived_from (plain field) |
| revises | GraphNode.revises (plain field) |
| supports | Claim.supports (plain field; both endpoints must resolve to Claim) |
| contradicts | Claim.contradicts (plain field; both endpoints must resolve to Claim) |
| cites, references | Claim.sourced_from when the target resolves to a Source; otherwise dropped-with-record |
| broader_than, subtopic_of | Entity.broader_than (plain field; both endpoints must resolve to Entity) |
| mentions | dropped-with-record -- MENTIONS is not a stored edge in this schema (see the MENTIONS requirement); the drop is recorded in the ingest report, never silent |
| any relation type not listed above | fail closed -- the adapter's classify_edge_relation function (mirroring classify_edge_property's four-outcome set) defaults unknown relation types to fail, raising a named error before any write for that edge |

**Hyperedges:** the frozen schema has no reified hyperedge/community class for
v0.2.9. Every object in graph.json's `hyperedges` array SHALL be classified
drop-with-record by the adapter and recorded in the ingest report -- never
silently discarded, never written as an unmapped shape. A future schema
revision MAY add a reified hyperedge-membership class; this manifest's
version SHALL be bumped when that happens, and the adapter's drop-with-record
default for hyperedges retired at that point, not before.

## Alternatives considered and REJECTED

Keep PARENT_OF as a single relation with a discriminator field.
Rejected: this is exactly OOPS! P07 (merging different concepts in one
class) with extra steps -- a discriminator field is still one relation an
LLM extractor must pick a domain/range for, and Bakker et al. measured that
choice at F1 approximately 0.03-0.04. Three named relations each have a
fixed, unambiguous domain/range instead. This schema's own initial draft of
this requirement made the same mistake in miniature by naming `depends_on`
for both subtask nesting and dependency ordering; that has been corrected by
splitting subtask nesting into `subtask_of` -- record this as a self-correction,
not silently.

Model Spec as Artifact{kind: spec} rather than a subtype. Rejected
per N2 section 10.4: it forces a kind-filter into every query touching specs
and prevents criteria from being schema-required (Optional fields cannot be
conditionally required based on another field value -- the constraint
language has no conditionals).

Reify SUPPORTS/CONTRADICTS now, with a strength enum, matching N2 literal
edge table (Source-or-Claim to Claim). Rejected for this release:
graph-store-port design.md already made this call -- reification is
designed, not yet applied, because retrofitting it after data exists is
MoveClassProperty plus a backfill, while adding it before data exists is a
plain schema addition. This schema keeps Claim.supports/.contradicts as
plain Set of Claim, and Claim.sourced_from as the separate, already-adequate
answer to "which claims have no source" (N2 own CQ-14). A future
Support/Contradiction reified class, when strength is first required,
looks like: a source_or_claim TaggedUnion over source and claim, plus a
strength enum -- sketched here so implementing it later is an insert, not
a migration, per the pattern graph-store-port design.md already
established for Mention.

Give Entity a composite Lexical key directly on (canonical_name, kind).
Rejected out of caution, not a documented incompatibility: the
live-verified TerminusDB examples in the schema reference guide only show
Lexical keys over plain string/scalar fields, never an Enum-typed field,
and nothing in 296 crawled pages confirms or denies enum fields inside a
Lexical key. Rather than ship an unverified construct in a frozen schema,
Entity uses a synthetic entity_key string field, matching the same
already-verified pattern used for Agent.agent_key and Spec.spec_key.

Make every AgentRun provenance field required, matching N2 literal !
annotations. Rejected: N2 table marks invocation_id, resolved_deps,
and external_params as required, but a schema that rejects any write
missing them makes competency question 7 ("which artifacts were produced by
an unverified agent run") answerable in principle and impossible in
practice -- the non-conforming run is simply never written, so there is
nothing left to query. These fields are Optional; "unverified" is a query
predicate over an accepted document, not a write-time rejection. N2 !
marks are read as documentation of the trustworthy case, not a hard schema
constraint, for this specific class only.

Use @oneOf on the Evaluation class directly instead of a separate
EvaluationTarget TaggedUnion. Rejected for reuse: Finding.about needs
the identical exactly-one-of-three shape, and a named TaggedUnion class is
referenced from both places; @oneOf is inline per-class and would have to
be duplicated.

Declare formal owl:disjointWith-style disjointness between Entity and
the work-DAG classes. Not available -- TerminusDB schema language has no
disjointness declaration at all (confirmed against the live schema reference
guide). Disjointness here is structural only: Entity and Claim inherit
GraphNode directly, every work-DAG class inherits WorkNode, and nothing
in this schema makes a class inherit both branches. This is enforced by
discipline, not the store, and needs an external lint check (N4) to stay
true as the schema evolves -- recorded as a gap, not solved.

A MENTIONS reified class, matching R8 live-verified draft. Rejected
per N2 explicit correction and graph-store-port already-adopted
requirement: highest-volume edge in graphify actual output, serves one
competency question weakly (CQ-16), and would dominate the token budget of
anything shown to an extracting model (N2 section 5 approximately-10-node
budget). Demoted to a derived index, out of this package scope.

## Risks

- The two-gap CQ list (16, 22) may turn out to be load-bearing. If a
  later round needs "which entities are co-mentioned but unresolved" or
  "which claims contradict what the agent had in context" as a hard
  requirement, this schema needs a revision -- a MENTIONS index integration
  for the first, and a deliberately-scoped AgentRun.saw edge (with its
  operational semantics pinned down first) for the second. Mitigation:
  both are flagged now rather than discovered late.
- The structural disjointness between Entity/Claim and the work-DAG is
  a convention, not a store-enforced guarantee. A future schema edit could
  make a work-DAG class inherit GraphNode directly by mistake and nothing
  in TerminusDB would refuse it. Mitigation: this needs a lint rule in N4
  checker, not solved here.
- Entity synthetic entity_key and the Lexical-key-on-Enum
  uncertainty it avoids is a caution, not a measured fact -- nobody
  verified live whether Lexical accepts an Enum field. If it turns out
  to work fine, the synthetic key is one field more than strictly necessary,
  which is a cheap and reversible cost.
- AgentRun.consumed and Evaluation.contradicts are additions beyond
  N2 literal table. Both are justified against a named competency
  question above; if a reviewer disagrees with either, removing a property
  from an unshipped schema costs nothing.
