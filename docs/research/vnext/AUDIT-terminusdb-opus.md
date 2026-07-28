# AUDIT — TerminusDB change packages (Opus lane)

**Lane:** Opus, independent. A parallel GPT-5.6 Sol lane audited identical scope; no coordination.
**Scope:** `openspec/changes/terminusdb-schema` (`store-schema`), `terminusdb-adapter` (`store-adapter`),
`terminusdb-operations` (`store-operations`).
**Evidence base:** `docs/research/vnext/R8-terminusdb-store.md`, `N2-ontology-engineering.md`,
`RECONCILE.md`, `openspec/changes/graph-store-port/`, plus `graph-eval-falsification`,
`knowledge-plane-refresh`, `work-dag-projection`, `graph-context-builder`.
**Method:** read all 12 package files in full; cross-read the four sibling packages; re-verified
four TerminusDB syntax claims against the live R8 documentation crawl at
`/tmp/terminusdb-docs/pages/docs__schema-reference-guide.md`. Read-only; nothing modified.
**Date:** 2026-07-28.

---

## Verdict — **BLOCKED**

These are strong packages. The research is real, the reasoning is traceable, the R8 footguns are
taken seriously, and the operations package in particular is the best-specified of the three — its
tripwires are genuinely numeric and its exit path is genuinely *rehearsed*, not merely documented.
I found no census overclaim anywhere. But the trio is not landable as written, for three
independent reasons. **(1) The frozen schema has never been loaded into TerminusDB, and no task in
any of the three packages loads it before it is frozen** — the schema materially supersedes R8's
live-loaded draft while inheriting its credibility, and the first package that starts a server
preconditions on the schema and adapter having already landed. **(2) The ingest path cannot write a
single document**: `graphify_version` must be stamped onto every document but no class declares it,
no graphify-node-to-class mapping exists in any package, and the classifier fails closed on unknown
edge properties with no reified target to send them to. **(3) An explicit RECONCILE landing
condition is unmet** — the `GraphUpdate` journal is still ownerless while remaining in the rebuild
source set, which makes the non-waivable timed drop-and-rebuild unimplementable as specified. Layered
on top, all three packages *document* graph-store-port's contradictions and all three explicitly
decline to fix them, so `store` and the three new capabilities are simultaneously live and
normatively conflicting on at least seven points that `openspec validate --strict` cannot see. Every
blocker below is bounded — mostly one-to-three-line spec edits plus one live-load task and one
architect-owned MODIFIED delta. This is a gating verdict, not a redesign verdict.

---

## Blocking findings

### B1 — The frozen schema was never loaded into TerminusDB, and nothing loads it before the freeze

**Package/file:** `terminusdb-schema/tasks.md` T3; `terminusdb-schema/design.md` L21–27.

`design.md` claims the schema is "Verified against terminusdb.org/docs/schema-reference-guide/
(fetched live 2026-07-28) … and against R8 own live-loaded draft (… section 3.2, **which this schema
supersedes**)". Verification against a draft you have replaced is not verification. The delta is
material: R8 §3.2 loaded 18 classes/enums; this schema has 12 enums, 3 abstract classes, 15 concrete
classes, plus a `@subdocument` (`Provenance`) that holds **document-valued links**
(`source_artifact: Source`, `extractor_agent: Agent`), a **top-level** `TaggedUnion`
(`EvaluationTarget`) keyed `ValueHash`, a `sys:JSON` field, a `Set` with `@min_cardinality`, and five
property names reused across classes with divergent ranges (B-adjacent, see N4). None of that shape
was in the payload R8 actually POSTed.

T3, the package's own gate, is: `openspec validate --strict`, `markdownlint-cli2`, and *"The JSON
schema block in design.md is valid JSON (parse it standalone to confirm)"*. Valid JSON is not a valid
TerminusDB schema. `terminusdb-adapter/tasks.md` is entirely unit/fixture work with no live server
(T11 gate has no integration step). `terminusdb-operations/tasks.md` is the only package that starts
a container — and its stated precondition is *"`graph-store-port`'s port, schema, adapter, and ingest
have landed."* So under the specified ordering, the first TerminusDB process in this programme starts
**after** the schema is frozen and the adapter is gated green.

**Why it matters:** the schema is declared frozen and un-amendable by any model
(`specs/store-schema/spec.md` L219–228). A construct rejected at load time is then a human-reviewed
revision on the critical path, discovered at the worst moment. The package's own stated principle —
*"Rather than ship an unverified construct in a frozen schema"* (design.md L316–317, justifying the
`Entity` synthetic key) — is violated by at least four constructs it does ship.

**Fix:** add to `terminusdb-schema/tasks.md` T3: *POST the exact fenced JSON block to a pinned
`terminusdb/terminusdb-server` 12.0.6 container at
`/api/document/{org}/{db}?graph_type=schema&full_replace=true`, assert HTTP 200, then
`GET …?graph_type=schema&as_list=true` and assert every declared class and enum is present.* Make it
a gate item, not a T1 checklist line. Reorder `terminusdb-operations` T1 (deployment) ahead of
`terminusdb-schema` T3, or give the schema package its own throwaway container fixture.

---

### B2 — `SUBTASK_OF` is missing; `depends_on` merges two of N2's three relations — the exact defect the requirement claims to prevent

**Package/file:** `terminusdb-schema/specs/store-schema/spec.md` L36–57; `tasks.md` T1;
`design.md` schema block L100–106 and CQ table row 8.

The requirement is titled *"PARENT_OF does not exist; three named relations replace it"*. It then
states: *"The schema SHALL define `Task.depends_on` as a Task-to-Task set property **for sub-tasking
and general task dependency**"* (L43–44) — and two lines later: *"IF a future revision proposes a
single relation covering more than one of has_attempt, task dependency, or broader_than, THEN that
revision SHALL be rejected as a reintroduction of the merged-concept defect this requirement exists
to prevent"* (L47–50). The requirement merges two concepts in its own normative text while
prohibiting exactly that.

N2 §10.3 lists `SUBTASK_OF` (`Task`→`Task`, 0..n → 0..1, acyclic) and `DEPENDS_ON`
(`Task`→`Task`, `Artifact`→`Artifact`, acyclic, `prov:used`) as **separate** edges with different
cardinality and different PROV analogues. `graph-store-port/specs/store/spec.md` L145–148 names all
three splits explicitly, `SUBTASK_OF` among them. The word `subtask` appears nowhere in
`terminusdb-schema`, and the design's "Alternatives considered and REJECTED" section never records
dropping it — this is a silent omission, not a documented decision.

Two further contradictions in the same package: `tasks.md` T1 says *"depends_on (on Task and
Artifact separately)"*, while `spec.md`'s scenario L56–57 asserts *"has_attempt, depends_on, and
broader_than each appear on exactly one class."* Both cannot be true.

**Why it matters:** `terminusdb-operations` Q-W8 is *"do any `DEPENDS_ON` cycles exist"* with
*"non-empty result is an invariant violation, must alert"*. Against this schema that query conflates
subtask nesting (a tree, legitimately deep) with dependency ordering, and — because `depends_on` is
also declared on `Artifact` — traverses the knowledge/work plane boundary the schema advertises as
its structural guarantee. A false alert on every nested task, or a type-guard nobody specified.

**Fix:** add `subtask_of: {"@type":"Optional","@class":"Task"}` to `Task`; restrict `Task.depends_on`
to dependency only; give `Artifact`'s property a distinct name (`artifact_depends_on`) or state the
type-guard obligation in the Q-W8 contract. Reconcile `tasks.md` T1 with the `spec.md` scenario.

---

### B3 — The `GraphUpdate` journal is still ownerless, and the non-waivable drop-and-rebuild depends on it

**Package/file:** `terminusdb-operations/specs/store-operations/spec.md` L115, L243–244; `tasks.md` T7.

`RECONCILE.md` R7 (L266–271) and the §5 landing conditions are explicit: *"`terminusdb-operations`
owns the `GraphUpdate` journal (format, validation, production and consolidation) — or, if that lane
cannot carry it, the journal is removed from the rebuild source set and rebuild is defined from the
recorded artifacts (`graph.json`, `worklog.jsonl`, run JSON) alone."* §6 repeats it directly to the
council lanes.

Neither branch was taken. `GraphUpdate` appears **zero times** in all three packages (grepped). The
operations spec keeps the journal in the rebuild source set in two normative requirements — *"a
drop-and-rebuild from `events.jsonl`, `graph.json`, and **the lane journals** under the new schema"*
(L115) and *"dropped and rebuilt from `events.jsonl`, `graph.json`, and **the lane journals** on a
fixed schedule"* (L243–244) — without defining what they are, who writes them, or how they validate.
`work-dag-projection` produces `worklog.jsonl`, a different artifact with a different owner and
schema; no package produces a `GraphUpdate` journal.

**Why it matters:** RECONCILE §5 calls the timed drop-and-rebuild *"not waivable — both lanes and
the PM agree it is what makes 'never the system of record' a fact."* As specified, that job reads an
input no component produces. The single most important landing condition is unbuildable.

**Fix:** either (a) add a requirement to `store-operations` defining the `GraphUpdate` journal's
format, validation, producer and consolidation, or (b) strike "the lane journals" from
`store-operations` spec L115 and L243–244 and file a `## MODIFIED Requirements` delta against
`graph-store-port/specs/store/spec.md` L14/L32/L40 replacing the journal with `worklog.jsonl` + run
JSON. (b) is cheaper and is the branch RECONCILE pre-authorised.

---

### B4 — The ingest path cannot write a single document

**Package/file:** `terminusdb-adapter/design.md` D9.4, D10; `specs/store-adapter/spec.md` L383–428;
`tasks.md` T7.5, T7.7, T10.2; `terminusdb-schema/specs/store-schema/spec.md` L219–228.

Three independent stoppers, all landing on the same code path:

1. **`graphify_version` has nowhere to go.** The adapter *"SHALL require a caller-supplied
   `graphify_version: str` and SHALL stamp that value onto written documents"* (spec L383–390; T7.7).
   No class in the frozen schema declares such a field. TerminusDB rejects documents with undeclared
   fields (R8 §10: *"TerminusDB rejects anything not in the schema"*). Every ingest write fails at the
   server. The design acknowledges the coupling — *"field name coordinated with Council 1 schema
   package"* (D9.4) — but Council 1 does not declare it and declares the schema frozen against model
   amendment.
2. **No graphify-node-to-class mapping exists in any package.** R8 §10 lists it as a distinct
   one-day work item. The adapter defers it (`tasks.md` T10.2 *"Cross-link Council 1 schema package
   for `@type` names"*; open questions #2 and #3 defer hyperedge and fold-target naming to Council 1).
   Council 1 puts ingest out of scope (design.md CQ-16 row: *"the derived MENTIONS index
   (ingest-layer, out of this package scope)"*). Nobody owns it.
3. **The classifier fails closed with no reified target.** D10: *"Unknown properties default to
   `fail`"*, raising `ReificationError`. `graph-store-port` L197–211 simultaneously requires
   *"`MENTIONS` SHALL be reified as a `Mention` document carrying span and confidence"* (L204–205)
   **and**, forty lines earlier, *"`MENTIONS` SHALL NOT be a stored edge; it SHALL be a derived
   index"* (L156–157). graph-store-port contradicts itself; the schema resolves it one way (no
   `Mention` class, per N2's demotion) and the adapter's fail-closed classifier hits the resulting
   void. The first ingest of the live 3,579-node `graph.json` — whose edges carry
   `confidence_score`, `weight`, `context`, `rationale`, `source_location` per the adapter's own
   refusal-message list — aborts.

**Fix:** add a producer-stamp field to `GraphNode` (e.g. `graphify_version: Optional<xsd:string>`)
**before** the freeze; publish the graphify node/edge-type → Foreman class mapping table in
`terminusdb-schema` (it is ontology, not transport); resolve the `Mention` contradiction with a
MODIFIED delta on `graph-store-port` L204–205; and ship `classify_edge_property`'s concrete property
table in the spec, derived from the real `graphify-out/graph.json`, rather than *"may be extended in
implementation"*.

---

### B5 — `normalize_data_version` silently produces an invalid ref for the real data-version token

**Package/file:** `terminusdb-adapter/specs/store-adapter/spec.md` L196–226 vs L512–527; `design.md` D6;
`tasks.md` T3.1, T6.1.

R8 §8.2 shows the response header verbatim:
`TerminusDB-Data-Version: branch:97slyhm3dqtqqjeq988v7wzr2pab3go` — `branch:` followed by an **opaque
data-version id**, not a branch name. R8 §5.1's silently-empty diff case is the *hand-written*
`branch:main`. These are two different things that share a prefix, and R8 flags the collision
explicitly (*"galling, because `branch:<id>` is exactly the format the response header returns"*).

The spec collapses them: *"`normalize_data_version(ref: str)` that **strips a leading `branch:`
prefix, producing the bare branch name**"*, with a post-condition that only checks the prefix is
gone. Applied to a real header token it yields `97slyhm3dqtqqjeq988v7wzr2pab3go` — neither a branch
name nor `commit:<id>` — which passes the assert, passes the `DataVersionRef` type gate, and reaches
HTTP. That is the silent-empty-diff class the wrapper exists to prevent, reintroduced by the wrapper.
The package half-sees this: L512–518 requires the adapter *"SHALL NOT document or encourage
round-tripping the raw `branch:<id>` header value into diff fields"* — while L196–210 supplies the
exact function that makes it type-check, and canary (a) (T6.1) only exercises the `branch:main` form.

**Fix:** two distinct types. `DataVersionToken` — opaque, produced only by reads/writes, usable only
as a `TerminusDB-Data-Version` **request header**, never accepted in a `*_data_version` field.
`DiffRef` — a bare branch name validated against the live branch list
(`GET /api/document/{org}/{db}/_meta?type=Branch&as_list=true`, R8 §5) or `commit:<id>`.
`normalize_data_version` must reject any post-strip value that is not a known branch. Extend canary
(a) to cover the opaque-token form.

---

### B6 — The `/api/log` ban is declared by two packages and implemented by none

**Package/file:** `graph-store-port/specs/store/spec.md` L108–134; `terminusdb-adapter` (all files);
`terminusdb-operations/specs/store-operations/spec.md` L210–211.

`graph-store-port` L113: *"The TerminusDB adapter SHALL NOT call `/api/log` on any query path"*;
L118: *"SHALL NOT use offset paging with a non-zero start value against the commit log"*; and the
scenario at L130–134 requires *"the adapter raises a named error identifying the banned call AND the
gate fails."*

`/api/log` appears **zero times** in `terminusdb-adapter`'s design, spec and tasks. The adapter's
error taxonomy is explicitly *closed* (spec L457–461, D12, T2.4) and contains no banned-call error.
T11's gate has no such check. `terminusdb-operations` forbids the call only inside the monitoring
script (L210–211) — correct but orthogonal.

**Answering the brief directly: no, `/api/log` is not genuinely banned from query paths.** It is
asserted three times and enforced nowhere, and the one component that could enforce it never mentions
it. This is the mitigation for R8's single most load-bearing finding (2.4 ms/commit, dead linear,
O(offset) paging, and the literal Enterprise upsell), so the gap matters more than its size suggests.

**Fix:** add `BannedEndpointError` to the adapter's closed error set; add a requirement that the
adapter refuses `/api/log` on any query path and refuses non-zero `start` against the commit log; add
a T11 gate item that greps the adapter module graph for the endpoint and runs a negative test.

---

### B7 — Three new capabilities contradict an unamended sibling; no package carries a MODIFIED delta

**Package/file:** all three proposals' Impact sections; `graph-store-port/specs/store/spec.md`.

All three lanes found graph-store-port's defects and all three explicitly refused to fix them.
`terminusdb-schema/proposal.md` L115–146 lists five (including *"its own partial class enumeration
(it never mentions `Finding`, `Provenance`, `EvaluationTarget`, or `Supersession`, and separately
references a `Finding` class under a different requirement without ever defining one)"* and *"its
`tasks.md` T2 … duplicates this package's deliverable"*), closing *"None of the above is changed by
this lane."* `terminusdb-adapter/proposal.md` L80–102 lists three. `terminusdb-operations/proposal.md`
L84–100 lists three. Correct process discipline — and the net effect is that `store` and
`store-schema`/`store-adapter`/`store-operations` are **simultaneously live and normatively
conflicting**:

| graph-store-port requires | The trio delivers |
|---|---|
| `SUBTASK_OF` as a distinct relation (L146) | absent; merged into `depends_on` (B2) |
| `RESOLVED_TO` acyclic, write rejected on cycle (L151, L190–195) | *"SHALL NOT claim to enforce acyclicity"*; external validator *"which this package does not implement"* |
| `RESOLVED_TO` carries **its own provenance** and a reviewer (L151–152) | one optional free-string `resolved_reviewed_by`; no edge provenance (N1) |
| `DEPENDS_ON` acyclicity *"checked, not assumed"* (L153) | *"not schema-enforced … external invariant, N4 territory"* — N4 is a research lane, not a package |
| `DERIVED_FROM`/`REVISES`/`SUPERSEDES` mutually exclusive (L154–155) | *"documented as an external invariant"*; scenario admits the schema accepts all three |
| `MENTIONS` reified as a `Mention` document (L204–205) | no `Mention` class (correct per N2 — but graph-store-port still says both) |
| no *"open string in any LLM-populated field"* (L158–159) | narrowed to floats only (N3) |
| *"every graph read and write goes through the port"* (L45–47) | RECONCILE R7 ordered this **struck**; still live, unamended |

`openspec validate --strict` checks structure, not cross-capability consistency, so all four packages
validate while contradicting each other.

**Fix:** one architect-owned change package carrying `## MODIFIED Requirements` against the `store`
capability — strike the every-read-and-write sentence per R7, recount and name the frozen schema
exactly per R7, resolve the `MENTIONS` self-contradiction, and repoint the schema requirement at
`store-schema` rather than restating a divergent class list. It must land **before** the trio, not
after.

---

### B8 — Every-CQ-is-a-regression-test collides with two declared schema gaps and one deferred package

**Package/file:** `terminusdb-operations/specs/store-operations/spec.md` L146–198; `design.md` CQ table
rows K16 and X22; `tasks.md` T5, T9; `terminusdb-schema/design.md` CQ table rows 16 and 22.

Operations requires *"one named, version-controlled, regression-tested query for **every** competency
question enumerated in N2 section 9 (24 total)"*, with a scenario *"every one of the 24 competency
questions maps to exactly one named query AND **none is left unmapped**"* (L194–198) and a gate item
*"All 24 named queries pass the regression suite against a known fixture"* (T9).

`terminusdb-schema/design.md` records CQ-16 and CQ-22 as gaps *by design*: CQ-16's other half needs
the MENTIONS index the frozen schema forbids as a stored edge; CQ-22 has *"no modelled link from
AgentRun to the Claims or Entities 'in its context'"*. Operations' own table maps Q-K16 with **no gap
flag** (its note *"aggregation(>=2) + negation"* presumes a mentions relation that does not exist),
and flags Q-X22 only as *"not yet landed"* — but RECONCILE §5 **deferred `graph-context-builder` to
v0.3.x**, so Q-X22's dependency is not landing this release at all. Operations flags four dependency
rows (W6, W13, X22, X23) as *"mapped, not gaps"*; two of the 24 are in fact gaps in the frozen
schema, and the CI gate as written cannot go green.

**Fix:** carry the schema package's dispositions into the operations manifest — mark Q-K16 and Q-X22
as recorded gaps with the same wording, restate Q-X22's dependency as *deferred to v0.3.x*, and amend
the L194–198 scenario to *"each of the 24 maps to exactly one named query **or a recorded gap**, and
none is silently absent."* Otherwise close the gaps in the schema before the freeze.

---

## Non-blocking findings

### N1 — `RESOLVED_TO` loses the per-edge provenance the whole graph plane exists to carry

`terminusdb-schema/design.md` L210–211 gives `resolved_to: Optional<Entity>` (functional ✔) plus
`resolved_reviewed_by: Optional<xsd:string>`. N2 §10.4 is emphatic: *"`RESOLVED_TO` is the only
identity-changing edge and needs the strictest treatment: functional, acyclic, **its own
provenance**, and a `reviewed_by` field. Entity resolution errors are the one class of extraction
error that corrupts *other* answers."* `graph-store-port` L151–152 repeats it. What ships: one
node-level `Provenance` block on `Entity` that records the *entity's extraction*, not the
*resolution decision* — so who merged A into B, when, and at what confidence is unrecoverable. And
`resolved_reviewed_by` is a free string, not an `Agent` reference, breaking the package's own
enum-or-reference rule. **Fix:** reify as `Resolution { old: Entity, new: Entity, provenance:
Provenance, reviewed_by: Optional<Agent>, reviewer_is_human: xsd:boolean, at: xsd:dateTime }` — the
exact shape already used for `Supersession`, at zero migration cost pre-data.

### N2 — No edge carries provenance at all; N2 §10.5's "and edge" clause is silently dropped

N2 §10.5 mandates the `P` block *"on every LLM-written node **and edge**."* The schema puts
`Provenance` on `Claim` and `Entity` only. `supports`, `contradicts`, `about`, `sourced_from`,
`broader_than` are LLM-written edges with no provenance; edges added in round 5 by a different agent
are indistinguishable from the node's original round-1 extraction. This is *defensible* — R8 §7
explicitly sanctions node-level `run_id` as the mitigation for a store with no per-edge provenance —
but the design never states the tradeoff, so a reader believes N2 §10.5 was implemented. **Fix:**
record it as an accepted, R8-grounded limitation in `design.md`, and note that reified edge classes
remain free until data exists.

### N3 — "Every LLM-populated field is an enum or a reference" is narrowed to "no floats"

`terminusdb-schema/specs/store-schema/spec.md` L151–154 bans only `xsd:decimal`, `xsd:float`,
`xsd:double`. `graph-store-port` L158–159 and N2 §10.1 rule 3 also ban **open strings**. The schema
then carries `Supersession.reason`, `Finding.text`, `Evaluation.rationale`, `Entity.canonical_name`,
`Entity.aliases`, `Provenance.source_locator`, `resolved_reviewed_by` as open strings on
LLM-populated classes. Several (`Claim.text`, `Supersession.reason`) are sanctioned by N2 §10.2/§10.3
and are genuinely unavoidable — but the requirement changes its own scope without saying so.
**Fix:** restate as *"no free numeric range, and every **categorical** LLM-written field is an enum
or a reference; free text is permitted only where N2 §10.2 names a text field"*, and enumerate the
exemptions the way `Measurement.value` is already exempted.

### N4 — Five property names carry divergent ranges across classes

`depends_on` (`Task`→`Set<Task>` vs `Artifact`→`Set<Artifact>`), `kind` (`ArtifactKind` vs
`EntityKind`), `status` (`RunStatus` vs `ClaimStatus`), `state` (`TaskState` vs `AttemptState`),
`about` (`Set<Entity>` vs `Optional<EvaluationTarget>`). The schema reference guide (L1105,
`VERIFIED-docs`) states TerminusDB *fails the schema check* when same-named properties conflict in
range under **multiple inheritance**; no class here uses multiple inheritance, so the documented rule
does not fire and whether the check is global is unverified — folding into B1's load test. Independent
of acceptance, the consequence is real: a WOQL `Triple(?s, "depends_on", ?o)` or `"about"` spans the
work-DAG and knowledge planes, defeating the structural disjointness this schema names as its main
guarantee (`design.md` L204, L337–344). This is also the OOPS! P19 multiple-domain pattern the
`PARENT_OF` split was justified by avoiding. **Fix:** plane-unique property names, or state the
type-guard obligation in every affected named query.

### N5 — `SUPPORTS`/`CONTRADICTS` reification deferred against an explicit R8 instruction

R8 §3.3: *"If `SUPPORTS`/`CONTRADICTS` later need per-edge confidence, they must be reified too —
**plan for that now**, because reifying after data exists is a `MoveClassProperty` + backfill."* R8's
risk table: *"Reify `MENTIONS` now; plan reification for `SUPPORTS`/`CONTRADICTS`."*
`graph-store-port` L207–209 requires the reified form *"designed and documented before first
ingest"*, and its scenario L220–225 promises *"the pre-documented reified class is added to the
schema … AND no existing document requires a property move."* The schema sketches it in prose
(design.md L297–309) but keeps it **out of the frozen artifact** — so adding it later is a schema
change under a freeze that forbids model-authored amendment, i.e. precisely the migration R8 warned
about. Separately, N2 §10.3 gives `SUPPORTS` the domain `Source|Claim → Claim` with a mandatory
`strength` enum; the schema has only `Claim.supports: Set<Claim>` and no strength anywhere.
**Fix:** add the `Support` class now (a `source_or_claim` TaggedUnion plus a closed `strength` enum).
It is an insert today and a migration tomorrow.

### N6 — Three representations of supersession, no invariant tying them

`Supersession` documents, `AttemptState.superseded`, and `ClaimStatus.superseded` all encode the same
fact with nothing constraining them to agree. Q-W5, Q-K19 and Q-K20 can each return a different
answer. **Fix:** name the derivation direction (documents authoritative, enum derived) as an external
invariant alongside the `DERIVED_FROM`/`REVISES`/`SUPERSEDES` exclusion the spec already records.

### N7 — `Supersession.old`/`new` typed `GraphNode` drops N2's domain constraint

N2 §10.3 scopes `SUPERSEDES` to `Attempt`→`Attempt` and `Claim`→`Claim`. The reified class admits any
`GraphNode` pair — an `Attempt` can supersede a `Metric`. Reification traded an over-specific edge
for an under-specific one. **Fix:** two subclasses, or add it to the external-invariant list.

### N8 — `AgentRun.on_behalf_of` narrows N2's range and breaks CQ-13's tail

N2 §10.3: `ON_BEHALF_OF` is `AgentRun → AgentRun|Agent`. The schema restricts it to
`Optional<AgentRun>`, so *"on behalf of which architect decision"* (CQ-13) cannot terminate at a
human or a non-run `Agent`. The CQ table row 13 claims the chain answers it. Undocumented narrowing.

### N9 — Branch-per-lane plus `/api/apply` is required by the port and implemented by nobody

`graph-store-port` L238–240: *"WHERE lanes perform independent bodies of work, the adapter SHALL use
one branch per lane and merge through the store's apply operation, which is the only path with real
conflict detection."* The adapter spec covers CAS and fan-in and never mentions branches, `/api/apply`
or merge; operations never mentions them either. R8 §8.2 is unambiguous that this is the *only* path
with real conflict detection — same-branch contention is last-write-wins. **Fix:** add the
branch-per-lane requirement to `store-adapter`, or amend `graph-store-port` to drop it and say why.

### N10 — Port purity: `cas_required` and data-version tokens sit on the public write API

`graph-store-port` L52–55 forbids the port exposing *"store-specific concepts such as branches,
commits, or data-version tokens as required arguments."* The adapter's **public** write function takes
`cas_required` plus a data-version token (D5; spec L137–150). If that function is the port
implementation, TerminusDB semantics have leaked into every port consumer and the files-only backend
must accept them too. Relatedly, *"a call site tagged as read-modify-write against a shared
document"* recurs throughout without ever defining who tags it or how the adapter knows — a
competent implementer must invent the mechanism (buildability). **Fix:** state that `cas_required` is
adapter-internal and that the port infers write shape, or specify the tagging mechanism.

### N11 — The adapter trusts a caller string where GP-3 already writes the authoritative value

`knowledge-plane-refresh/specs/graphify-integration/spec.md` L86–89 requires the refresh to write
`graphify_version`, the interpreter path, `built_at_commit` and the timestamp into
`graphify-out/refresh-meta.json` — a sidecar, deliberately not in `graph.json`. The adapter requires a
**caller-supplied** `graphify_version` and forbids reading it from `graph.json` (true, but the wrong
file). Trusting a caller argument defeats the detection GP-3 exists to provide — that *"a graphify
upgrade can migrate the whole ID space"*. Note `graph-store-port/proposal.md` L120–122 compounds this
by claiming GP-3 supplies *"a `graph.json` … stamped with the producing graphify version"*, which is
not what GP-3 does. **Fix:** read `refresh-meta.json`; treat the caller argument as an override that
must match, and fail closed on mismatch.

### N12 — Circular ordering around the live canary

Canary (b) `canary_anyuri_string_unification` reproduces a **server-side** WOQL unification behaviour
and is a hard gate item (T6.2, T11.2). No adapter task provisions a server; operations owns
deployment and preconditions on the adapter having landed. **Fix:** give the adapter its own pinned
container fixture, or move `terminusdb-operations` T1 ahead of the adapter gate (this also unblocks
B1).

### N13 — One of graph-store-port's four health-check categories has no tripwire

The tripwires are otherwise excellent and genuinely numeric: <50 upstream commits per rolling 6
months, single-author share >90% sustained across two consecutive quarterly checks, any in-use
capability moving to Enterprise, any licence change off Apache-2.0 — each traceable to an R8
measurement, with an inconclusive-not-green failure mode. But `graph-store-port` L323–325 names four
categories and **release cadence** gets no tripwire; author-share is substituted for *"whether a
second maintainer has appeared"*, which is a reasonable proxy but not the same signal. R8 §2.2's
sharpest dormancy evidence was a **12½-month release gap** (v11.1.12 → v11.1.13), which a commit-count
tripwire can miss entirely. **Fix:** add *"no stable release in any rolling 9-month window."*

### N14 — Deferral-assuming passages: Council 3 found 3; the full set is 8, across 4 packages

Verified all three of Council 3's, plus five more. Two of the new ones are in **normative spec text**,
which matters more than prose:

| # | Location | Text | Flagged by |
|---|---|---|---|
| 1 | `graph-store-port/proposal.md` L129–132 | *"May be deferred by architect decision behind GP-7's query census…"* | all three councils |
| 2 | `graph-store-port/design.md` L6–9 | *"Does Foreman need a queryable, versioned, schema-enforced store? Unresolved. GP-7's query census answers it."* | councils 1, 2, 3 |
| 3 | `graph-store-port/design.md` L109–116 | *"this package is explicitly deferrable — SYNTHESIS §5 grants the architect that call"* | council 1 (item 3) |
| 4 | `graph-eval-falsification/proposal.md` L114 | *"The census outcome is the architect's documented basis for landing or freezing the store."* | council 3 |
| **5** | **`graph-eval-falsification/specs/evaluation/spec.md` L11** | requirement titled *"a query census classifies one release of real queries **before the store is justified**"* | **none — new** |
| **6** | **same file, L257–260 (KC-1)** | *"IF the genuine multi-hop-cross-run share … falls below the registered share, THEN **freeze the store package** … descope the store for the release series."* | **none — new** |
| **7** | **`graph-eval-falsification/tasks.md` L21–22** | *"Hand the census verdict to the architect as the documented basis for landing or freezing GP-6."* | **none — new** |
| **8** | **`graph-context-builder/design.md` L158–161** | *"if GP-6 is deferred behind the query census, or if the store proves fragile…"* | **none — new** (fourth package; councils checked only three) |

\#6 is the serious one: a **live, registered kill criterion that can order the shipped store frozen
or descoped**, sitting in a spec RECONCILE explicitly ships at S4. Under the ship decision it needs
rewording to a *tuning/exit-path* trigger rather than a land/freeze gate — otherwise v0.3.x inherits
a rule that contradicts a v0.2.9 product decision. Separately, `terminusdb-adapter/proposal.md`'s
"Quote C" is a **mis-flag**: `graph-store-port` L86–88 (*"the omission SHALL be limited to
time-travel, graph branch and merge, and cross-run query ergonomics"*) is a scoping clause about
files-only capability, not deferral framing, and needs no correction.

---

## Evidence-fidelity audit — what I sampled against R8 / N2, and what I found

**Sampled from R8 and traced into the packages (16 claims):**

| Claim in packages | R8 source | Verdict |
|---|---|---|
| ~1,070 docs/s at batch 500; ~35 commits/s serial (p50 28 ms, p95 34 ms) | §8.3 | **Accurate**, correctly used to justify batch 500 |
| CAS via `TerminusDB-Data-Version`, undocumented, `api:DataVersionMismatch`, branch-scoped | §8.2 Test 3 | **Accurate and honestly labelled** "undocumented; verified live"; branch-scoping correctly drives the no-blanket-CAS decision |
| 12/12 concurrent distinct-doc writers green; 10/10 same-doc silent last-write-wins | §8.2 Tests 1–2 | **Accurate**; correctly produces the two-shape write contract |
| `branch:`-prefixed diff returns `[]` at HTTP 200 | §5.1 | **Accurate but conflated** with the response-header token form — see **B5** |
| WOQL `anyURI` vs string `eq/2` silent-empty is the vendor's own #1 issue | §6.3 | **Accurate**, quoted correctly; canary is the right response |
| `Distinct` mandatory around `Path` (10 rows for 4 answers) | §6.1(a) | **Accurate**; adapter's structural enforcement (no public raw Path builder) is stronger than R8 asked for — good |
| `/api/log` ~2.4 ms/commit linear, O(offset) paging | §8.3 | **Accurate**; correctly drives work-DAG-as-documents. But the ban is unenforced — **B6** |
| `full_replace=true` mandatory with `@context` | §3.2 | **Accurate**, propagated to both schema and adapter |
| `PUT ?create=true` idempotent; `POST` insert-only → `api:DocumentIdAlreadyExists` | §10 | **Accurate** |
| Both language clients dependabot-only; raw HTTP recommended | §8.4, §13 | **Accurate**; adapter D1's rationale is well-argued |
| `ChangeParents` and `ChangeCollection` unimplemented | §4 | **Accurate** (`VERIFIED-docs`). Council 3's routing of inheritance change to drop-and-rebuild is correct **and** is the right use of the regenerability property — see Migration below |
| 38 MB idle RSS, 9.7 MB / 5,500 docs, 2.6 s cold start, no `/api/metrics` in OSS | §8.1, §2.7 | **Accurate**; monitoring thresholds (3× baseline) are derived, not invented |
| ~93% single-author share; 27 commits in 2024; 12½-month gap; 105 npm dl/mo | §2.3, §2.2, §2.5 | **Accurate**; correctly converted into numeric tripwires |
| `TERMINUSDB_SERVER_WORKERS` default 8 | §8.1 | **Accurate**; correctly routed to operations, with the adapter refusing to mutate it |
| Commits single-parent (upstream #2430) | §5.3 | **Accurate**; adapter explicitly refuses to model merge ancestry |
| No edge properties; reification is the only answer | §3.1 | **Accurate** as a premise; the *consequences* are partly unimplemented — **N1, N2, N5** |

**Nothing I sampled was overstated relative to R8.** The one fidelity failure is inheritance rather
than exaggeration: `terminusdb-schema/design.md` L21–27 borrows the credibility of R8's live-loaded
draft for a schema that supersedes it (**B1**). Two `INFERRED` R8 items are correctly carried as
inferences rather than measurements (the 10k/100k commit-log extrapolation is never quoted as
measured; the reification tax is presented as a modelling consequence).

**Sampled from N2 (the §10.4 corrections the brief asks about):**

| N2 §10.4 correction | Delivered? |
|---|---|
| `PARENT_OF` split into three named relations | **Partial — 2 of 3.** `has_attempt` ✔, `broader_than` ✔, `SUBTASK_OF` **absent**, merged into `depends_on` — **B2** |
| `MENTIONS` demoted from stored edge to derived index | **Yes**, and well-argued in the rejected-alternatives section (though nobody owns the index — **B4**) |
| `RESOLVED_TO` functional / acyclic / human-reviewable | **Partial.** Functional ✔ by `Optional`. Acyclicity honestly declared unenforced (assessed below). Reviewability is a free string with no provenance — **N1** |
| `EVALUATES` exactly-one tagged union | **Yes.** `EvaluationTarget` TaggedUnion reused by `Finding.about` — a genuinely good call |
| Missing types added: `Round`, `Attempt`, `Agent`, `Spec`, `Measurement` | **Yes, all five**, plus the SEON `Metric`/`Measurement` split and `Finding` (which CQ-4 needed and N2 did not name) |
| Every LLM-populated field an enum or a reference | **Partial** — narrowed to "no floats"; `ConfidenceLevel` correctly replaces the float, matching the in-house bimodal-collapse post-mortem (N2 §8.3) — **N3** |
| `Verdict` stays an enum, not a node | **Yes** — the P17 trap N2 warned about is avoided |
| `Entity` given a closed `kind` enum and plane disjointness | **Partial.** Closed enum ✔ (P21 avoided). Disjointness is structural-by-convention only, honestly recorded as an unsolved gap needing an unowned lint |

**On the "external invariant" honesty question (the brief asks directly).** The schema's claim that
`RESOLVED_TO` acyclicity is an external invariant is **honest and technically correct** — TerminusDB
has no cross-document constraints, no uniqueness, no regex and no conditionals, and the package says
so plainly in three places rather than implying enforcement. `spec.md` L85–89 even makes the honesty
normative (*"IF a component asserts that the schema enforces resolved_to acyclicity, THEN that
assertion SHALL be treated as false"*), which is unusually good practice. It is **not sufficient**,
for one reason: every one of the five external invariants (RESOLVED_TO acyclicity, DEPENDS_ON
acyclicity, DERIVED_FROM/REVISES/SUPERSEDES exclusion, Entity/work-DAG disjointness, and the
supersession-representation agreement of **N6**) is deferred to *"N4 territory"* or *"an external lint
check (N4)"*. **N4 is a research lane, not a change package.** No package in
`openspec/changes/` owns any of them, and `graph-store-port` L153 requires DEPENDS_ON acyclicity be
*"checked, not assumed."* Honest declaration plus unassigned ownership is how invariants quietly
never get built. **Fix:** either give `store-schema` or `store-operations` a requirement owning the
five-check external validator with a CI hook, or file the change package that does.

---

## What I checked and found correct

Coverage, not just complaints — including two findings I abandoned after checking.

- **Two syntax suspicions falsified against the docs.** I initially flagged `{"@type":"Set",
  "@min_cardinality":1}` on `Spec.criteria` as likely invalid (expecting the `Cardinality` family) and
  a top-level `TaggedUnion` keyed `ValueHash` as unverified. Both are **explicitly documented**:
  schema-reference-guide L1982–2068 shows `@min_cardinality` on `Set` with a worked example, and
  L424–453 shows a top-level `TaggedUnion` (`BinaryTree`) keyed `ValueHash`. `sys:JSON` is likewise
  real (12.0 release notes). I dropped both. The schema's syntax claims held up on every construct I
  could check against the crawl.
- **`@subdocument` key restriction observed.** `Provenance` is the only subdocument and keys
  `ValueHash`, never `Lexical` — matching the documented restriction the design cites.
- **Abstract bases kept thin** (`GraphNode` 6 fields, `WorkNode` zero) with the `ChangeParents`
  rationale documented at the class — exactly R8 §4's mitigation, applied in the right place.
- **Lexical keys with natural business keys throughout**, giving deterministic IDs and idempotent
  re-ingest — R8 §10's stated precondition, carried correctly into the adapter's `PUT ?create=true`.
- **The `EvaluationTarget` reuse decision** (named TaggedUnion class over inline `@oneOf`, so
  `Finding.about` shares the shape) is correct and well-reasoned.
- **The `AgentRun` Optional-SLSA-fields argument is genuinely good.** Making the provenance fields
  required would make CQ-7 *"answerable in principle and impossible in practice"*. That is a real
  insight, correctly overriding N2's literal `!` annotations, and it is documented at the class, in
  the design, in the proposal and as a spec requirement with an IF-a-future-revision guard.
- **The `Entity` synthetic-key caution** (avoiding an enum inside a `Lexical` key because nothing in
  296 crawled pages confirms it) is exactly the right instinct — it is only inconsistent because the
  same caution was not applied to B1's constructs.
- **`Distinct` enforcement is structural**, not advisory: no public raw Path builder exists. Stronger
  than R8 asked for.
- **The three-way write-shape contract** (fan-in no CAS / shared-doc RMW CAS-required / refuse
  untagged RMW before HTTP) maps R8 §8.2's three tests precisely, and the rejection of blanket CAS on
  retry-storm grounds is correct reasoning from branch-scoping.
- **Retry policy is fully specified** — 3 retries, base 50 ms, ×2, full jitter, closed retryable set,
  counters in structured logs. No hand-waving.
- **The error taxonomy is genuinely closed** and every error has a named raise site in tasks.
- **The `cypher.txt` / Neo4j / FalkorDB refusal names the dropped fields**, matching
  `graph-store-port` L360–362 and R8 §10 — and includes edge-direction-inversion (bug #563), which is
  beyond what R8 required.
- **Canaries are specified to fail closed and be *verified by running the suite, not by reading
  code*** (adapter T11.2, operations T9) — the correct discipline, stated explicitly.
- **Operations is the strongest of the three.** `/mnt/*` exclusion reasoned from the existing
  `durable-lanes.md` fsync rule rather than asserted; digest pinning with both digests in the error;
  backup-before-version-bump enforced by the script; restore drill defined as *reproducing
  query-layer results*, not just extracting a tarball; monitoring proportionate to a 38 MB
  single-container deployment with an explicit rejection of a Prometheus stack; every runbook carrying
  a verification step.
- **The exit path is specified as *rehearsed*, and correctly so** — *"by running a full round on the
  files-only implementation with the TerminusDB adapter stopped"*, before reliance, with re-rehearsal
  within one release of any tripwire firing (spec L290–293; T8; gate T9). This satisfies RECONCILE's
  landing condition precisely, and it is the difference between a documented exit and a real one.
- **The honest-claim check passes.** Zero occurrences of *"validated by the census"* or any
  census-derived justification across all three packages. All three explicitly frame adoption as a
  product-owner decision on R8's live evidence, matching RECONCILE §4's sanctioned language. The
  operations proposal restates R8's fragility numbers *in the Why section* rather than burying them.
  Tripwires are numeric and actionable (see N13 for the one gap).
- **Migration story (brief item G): Council 3's `ChangeParents` claim is correct**, and the reasoning
  is better than the claim. `ChangeParents` is documented unimplemented (R8 §4, `VERIFIED-docs`), and
  routing inheritance restructuring to drop-and-rebuild is the right call *because* regenerability is
  already required — the escape hatch already exists and costs nothing extra. The weakening/
  strengthening split, the dry-run-then-backup-then-apply order, the refusal of strengthening changes
  without an explicit default, and restore-rather-than-partial-recovery on failure are all correct
  against R8 §4. **Completeness gap:** the runbook covers *"the ontology changes after data already
  exists"* but is silent on the two changes we will realistically make first — (a) adding the
  producer-stamp field and the `Support`/`Resolution` reified classes (**B4**, **N1**, **N5**), which
  are weakening changes needing no runbook but *do* need to happen before the freeze rather than
  after; and (b) a **cross-version store-directory upgrade**, which R8 §14 lists as undocumented
  upstream and which the runbook only addresses via "back up first" without a compatibility check or
  a rollback criterion. Add a version-upgrade section that treats the restore drill as the acceptance
  test for the new binary.

---

## What I could not check, and why

1. **Whether the schema actually loads.** No TerminusDB container is running on this box (`docker ps`
   empty) and my mandate is read-only, so I could not POST the schema. This is the whole point of
   **B1**: nobody else has either. My syntax review is docs-based only.
2. **Whether TerminusDB globally rejects same-named properties with divergent ranges** (N4). The
   reference guide documents the rule only for multiple inheritance (L1105); no class here uses
   multiple inheritance, and the crawl does not cover the general case. Folded into B1's load test.
3. **Whether a `@subdocument` may hold document-valued links** (`Provenance.source_artifact: Source`,
   `extractor_agent: Agent`). Not addressed in the sections of the reference guide I sampled. Also
   folded into B1.
4. **The real `graph.json` edge-property inventory.** I did not open `graphify-out/graph.json`, so I
   cannot enumerate which `classify_edge_property` entries are required or how many would currently
   hit the `fail` default. **B4**'s conclusion (that first ingest aborts) rests on the adapter's own
   refusal-message field list, not on the artifact.
5. **Upstream re-verification.** I did not re-fetch the TerminusDB migration reference, the
   `ChangeParents` status, or GitHub commit statistics; I relied on R8's `VERIFIED-docs` /
   `VERIFIED-code` labels and the cached crawl at `/tmp/terminusdb-docs/`.
6. **Whether `graph-store-port` will be amended.** All three packages flag its defects and decline to
   fix them, and the architect owns that reconciliation. I audited the trio *against* graph-store-port
   as it stands today; if it is amended, **B7** and parts of **B2**, **B4** and **B6** change shape.
7. **The N4 symbolic-verification lane.** I read only the packages under `openspec/changes/`, so I
   cannot confirm whether `N4-symbolic-verification.md` proposes a checker that would own the five
   external invariants — only that no *change package* does.
8. **The parallel GPT-5.6 Sol lane's findings.** By design, not consulted.

---

*Opus audit lane, 2026-07-28. Verdict: **BLOCKED** on B1–B8, all bounded. Fix order:
B7 (architect MODIFIED delta on `graph-store-port`) → B2/B4 (schema content, pre-freeze) →
B1 (live load as a gate) → B3/B8 (operations scope corrections) → B5/B6 (adapter).*
