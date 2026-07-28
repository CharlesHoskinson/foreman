# TerminusDB Change Packages — Codex Cross-Vendor Audit

## Verdict

**BLOCKED.** The decision to ship TerminusDB in v0.2.9 is not in question, and the
packages preserve several important R8 guardrails, but they are not yet a safe,
buildable implementation specification. The most serious failures are at the
seams: the final schema and `graph.json` ingest have no defined mapping; the
CAS-token representation is conflated with the incompatible diff-reference
representation; the schema admits identity-changing and LLM-authored edges
without the required edge provenance or an owned external invariant checker;
the operations rebuild requires source streams that no adapter task ingests;
and the supposedly all-green 24-CQ gate includes known schema gaps and a
v0.3.x-deferred dependency. These are concrete package fixes, not reasons to
revisit the owner decision.

## Blocking findings

### B1 — No package defines an end-to-end, regenerable materialization

- **Packages/files:** `terminusdb-adapter/design.md` D9/D13 and
  `specs/store-adapter/spec.md` lines 312–494;
  `terminusdb-operations/design.md` lines 19–29,
  `specs/store-operations/spec.md` lines 102–145 and 241–259, and `tasks.md`
  T4/T7; `terminusdb-schema/design.md` lines 29–237; against
  `RECONCILE.md` R7.
- **What is wrong:** the adapter only defines ingestion and selective rebuild
  for `graph.json`-derived facts. Operations requires rebuild from
  `events.jsonl + graph.json + lane journals`, but defines no adapter or task
  that ingests the event stream, `worklog.jsonl`, run JSON, or a lane journal.
  More critically, `RECONCILE.md` made `terminusdb-operations` the owner of the
  `GraphUpdate` journal's format, validation, production, and consolidation (or
  required the journal to be removed from the source set); the term
  `GraphUpdate` does not appear anywhere in this package. The adapter's
  `drop_and_rebuild` and operations' scheduled rebuild are therefore different
  mechanisms over different source sets.
- **Why it matters:** the store cannot be proved to be a regenerable
  materialization or safely used as a migration escape hatch. A timed rebuild
  that restores only knowledge facts while silently omitting work facts can
  still pass the adapter's current tests.
- **Concrete fix:** choose and freeze one source set consistent with R7:
  preferably `graph.json + worklog.jsonl + run JSON`, unless
  `terminusdb-operations` fully specifies and delivers `GraphUpdate`. Add exact
  record schemas, producer/consolidator ownership, ingestion functions, type
  partitions, and one destructive-from-empty integration test whose pre/post
  comparison covers every named query and every document class. Make the
  adapter and operations invoke the same command and remove the alternative
  source-set wording.

### B2 — The adapter conflates CAS tokens with diff references and cannot specify a safe CAS retry

- **Package/files:** `terminusdb-adapter/design.md` D2/D5/D6
  (especially lines 109–111, 149–195);
  `specs/store-adapter/spec.md` lines 137–170, 196–225, and 512–526;
  `tasks.md` T1.7, T3, and T4.
- **What is wrong:** R8's successful CAS request round-trips the raw response
  header value `branch:<opaque-version>` in the
  `TerminusDB-Data-Version` request header. The diff API is different:
  `branch:main` silently returns `[]` and must become bare `main`. This package
  exposes response versions only through a normalizer that strips `branch:`,
  then says the resulting token is also supported as a CAS precondition. Those
  are not one type. Stripping `branch:<opaque-version>` produces an opaque bare
  value that is neither the demonstrated CAS token nor a documented branch
  name. Separately, retrying a stale read-modify-write after backoff without
  re-reading the document, obtaining a fresh token, and recomputing the mutation
  merely resends a stale precondition; replacing the token without recomputing
  risks clobbering the intervening change.
- **Why it matters:** the safety wrapper can reject every contended write or,
  if implemented by guesswork, recreate the silent last-writer-wins loss it is
  meant to prevent.
- **Concrete fix:** define disjoint types and APIs: an opaque
  `CasVersionToken` that preserves and round-trips the response header byte for
  byte, and a `DiffRef` with explicit `branch(name)` and `commit(id)`
  constructors that serialize to the forms R8 proved. A CAS mismatch must
  either return conflict immediately or invoke a specified
  read/recompute/retry callback; never blindly replay a stale body. Add a live
  pinned-12.0.6 canary: read A, commit B, attempt stale A, assert
  `api:DataVersionMismatch` and no clobber, then prove the recomputed retry
  retains both changes.

### B3 — The schema's external-invariant story is honest but not sufficient, and `RESOLVED_TO` is not actually human-reviewable/provenanced

- **Package/files:** `terminusdb-schema/proposal.md` lines 43–52 and 78–85;
  `design.md` lines 203–213 and 337–344;
  `specs/store-schema/spec.md` lines 78–131; `tasks.md` T1–T3; against
  `graph-store-port/specs/store/spec.md` lines 136–195.
- **What is wrong:** the package correctly admits that TerminusDB cannot enforce
  cycles, cross-document mutual exclusion, conditionals, or class
  disjointness. It then assigns these checks vaguely to an external validator
  and implements no task, owner, command, or write-boundary integration for
  that validator. No other reviewed package owns it. The schema also makes
  `resolved_reviewed_by` an independent optional `xsd:string`; an accepted
  `resolved_to` can therefore omit a reviewer, name an arbitrary string, and
  carries no edge-specific provenance. This directly contradicts the port's
  requirement that a cycle be rejected and every accepted resolution record
  its own provenance and reviewer. Given the stated removal of OWL validation
  in v10, there is no hidden reasoner that closes this gap.
- **Why it matters:** identity-resolution cycles corrupt answers transitively,
  and a document schema that intentionally accepts them is unsafe unless the
  external check is transactional and unavoidable.
- **Concrete fix:** assign the invariant validator to a named package (most
  naturally the adapter write boundary), with exact checks and failure types for
  `RESOLVED_TO`, `DEPENDS_ON`, task hierarchy, `BROADER_THAN`, plane
  disjointness, and relation mutual exclusion. Reify resolution as a document
  containing source, target, required reviewer reference, timestamp, and
  provenance, or enforce an equivalent required conditional in the external
  validator. Add accepted/rejected fixtures, including 2-node and longer
  cycles, and require no partial write on failure.

### B4 — N2's relation split and per-edge provenance corrections are not implemented

- **Package/files:** `terminusdb-schema/proposal.md` lines 71–89;
  `design.md` lines 81–98, 192–236 and 297–309;
  `specs/store-schema/spec.md` lines 36–57 and 106–149; against
  `N2-ontology-engineering.md` sections 10.3–10.5.
- **What is wrong:** N2 split `PARENT_OF` into `HAS_ATTEMPT`,
  `SUBTASK_OF`, and `BROADER_THAN`, while retaining `DEPENDS_ON` as a distinct
  semantic relation. The package instead uses `Task.depends_on` for both
  sub-tasking and general dependency, so one merged-concept defect is replaced
  with another. N2 also requires provenance on every LLM-written edge and a
  strength enum on `SUPPORTS`; the schema stores `about`, `supports`,
  `contradicts`, `sourced_from`, `broader_than`, and `resolved_to` as direct
  properties with no per-edge provenance, and explicitly defers
  SUPPORTS/CONTRADICTS reification. `Supersession` itself has no provenance,
  even though claim supersession may be an LLM/human judgment.
- **Why it matters:** the graph plane exists to preserve who asserted a
  relationship and from what source. Document-level provenance cannot identify
  the producer of one member of a set-valued edge, and delayed reification
  creates mixed old/new representations.
- **Concrete fix:** add `subtask_of` separately from `depends_on`; enumerate
  which relations are deterministic projections and which are
  human/LLM-authored; reify every authored relation that needs provenance
  (`Resolution`, `Support`, `Contradiction`, `Supersession`, and any authored
  taxonomy edge) with required `Provenance`. Define the exact adapter
  property-to-reified-class table before first ingest. If a direct relation is
  retained, state and test why document-level provenance is lossless for it.

### B5 — `graph.json` cannot be ingested against the frozen schema as specified

- **Package/files:** `terminusdb-adapter/design.md` D9/D10 and open questions
  1–4; `specs/store-adapter/spec.md` lines 312–429; `tasks.md` T7;
  `terminusdb-schema/design.md` schema block.
- **What is wrong:** the input contains graphify node kinds
  (`code`, `document`, `paper`, `image`, `rationale`, `concept`), node fields,
  hyperedges, arbitrary relation types, edge properties, and a required
  producing-version stamp. The frozen schema has no generic graphify node or
  hyperedge class and no `graphify_version` field. The package provides no
  node-kind-to-class mapping, required-field synthesis rules, ID mapping,
  relation-property mapping, hyperedge type, or treatment of schema-rejected
  fields. The reification classifier specifies only four outcomes, not the
  property table or target document shapes; several of these are left as open
  questions for implementation.
- **Why it matters:** TerminusDB is schema-first and rejects unknown fields.
  A competent implementer cannot make the first production ingest succeed
  without inventing ontology and data-loss policy.
- **Concrete fix:** add a versioned mapping manifest to the packages: every
  accepted graphify node/edge/hyperedge shape to an exact schema class and
  property, deterministic ID/key derivation, required-field source/default,
  provenance treatment, and explicit reject/drop rule. Add the producing
  version to the schema (or a typed batch-ledger class), define the durable
  idempotency ledger, and gate with a full real-shape fixture plus round-trip
  counts and provenance assertions.

### B6 — The operations package promises an impossible 24-query green gate

- **Package/files:** `terminusdb-operations/design.md` lines 41–75;
  `specs/store-operations/spec.md` lines 146–198; `tasks.md` T5/T9; against
  `terminusdb-schema/design.md` lines 249–280 and `RECONCILE.md` section 5.
- **What is wrong:** the schema explicitly records CQ-16 and CQ-22 as gaps, yet
  operations requires all 24 named queries to have hand-computed answers and
  pass before merge. CQ-16 has no stored `MENTIONS` and no package owns the
  derived index. CQ-22 needs an AgentRun-context link and evaluation feedback;
  the schema has neither, and GP-5 is explicitly deferred to v0.3.x. W13 needs
  an architect-decision node that the final schema does not define; X23 needs a
  bugeventlog ingest path no package owns; W4 is admitted to be only a bounded
  path, not the CQ's shortest path. The design also uses stale names/shapes
  (`AgentRun.vendor`, `HAS_ATTEMPT`, `SUPERSEDES.timestamp`) inconsistent with
  the final schema.
- **Why it matters:** the gate is unachievable as written, or it will go green
  using stubs/partials while claiming all competency questions are covered.
- **Concrete fix:** freeze a manifest with dispositions
  `implemented | partial | deferred-gap`, exact final-schema field names, and
  executable acceptance rules per disposition. The v0.2.9 gate must require
  every `implemented` query to pass and every gap to fail closed with a named
  unsupported result; it must not call five partial/deferred rows "all 24
  pass." Assign CQ-16's derived index if it is meant to ship; leave CQ-22
  explicitly deferred with GP-5 otherwise.

### B7 — The fail-closed canaries contradict the normalization contract and are not proven mutations

- **Package/files:** `terminusdb-adapter/design.md` D6/D7;
  `specs/store-adapter/spec.md` lines 196–219 and 280–308; `tasks.md` T6/T11;
  `terminusdb-operations/tasks.md` T5/T9.
- **What is wrong:** the public normalizer says `branch:main` is stripped to
  `main` and proceeds, while `canary_branch_prefix_diff` says the same input is
  rejected before HTTP. Both cannot be the specified success condition. The
  tasks then say to run with normalization/assertions “disabled” but define no
  mutation switch, test seam, command, or expected failure. The anyURI canary
  tests that an expected-results wrapper rejects zero rows, but no live fixture
  proves the query genuinely returned the known wrong empty answer; the
  operations Q-X21 “third canary” likewise has no defined mutation that makes
  it fail.
- **Why it matters:** a canary asserted only against mocks or an impossible
  alternate behavior can stay green when the vendor or wrapper drifts.
- **Concrete fix:** resolve the prefixed-ref behavior (prefer typed rejection
  for diff refs), and define mutation tests with exact commands and a test-only
  seam: bypass the diff guard and observe the pinned server's silent `[]`;
  replace URI-node construction with a string literal and observe the known
  empty binding; remove `Distinct` and observe 10 rows vs 4; disable negation
  and observe the hand-computed X21 mismatch. Require each mutant red and the
  unmutated suite green.

### B8 — Schema migration covers `ChangeParents` but not the changes this schema is likely to need

- **Packages/files:** `terminusdb-operations/design.md` lines 19–29 and
  104–118; `specs/store-operations/spec.md` lines 102–145; `tasks.md` T4;
  `terminusdb-schema/design.md` lines 297–309.
- **What is wrong:** the verified upstream claim that `ChangeParents` is
  unimplemented is correct, but the package calls it the one unsupported
  operation. The same current upstream migration reference also marks
  `ChangeCollection` unimplemented. More importantly, the schema says future
  SUPPORTS/CONTRADICTS reification becomes “an insert, not a migration” merely
  because its shape is designed now. Existing direct edges would still need a
  deterministic backfill, dual-read transition, validation, and removal plan;
  R8 explicitly warned that post-data reification is a property move plus
  backfill. Resolution reification, enum/key changes, collection changes, and
  required provenance additions have similar instance-data effects.
- **Why it matters:** the migration runbook can select an unsupported in-place
  path or silently strand old relationships outside the new query model.
- **Concrete fix:** route both parent and collection restructuring to the
  tested rebuild path. Add a schema-change decision table for every operation
  currently anticipated, including direct-edge-to-reified-document backfill,
  key/ID/reference rewrites, defaults, enum contraction, and provenance
  strengthening. Test at least one realistic reification migration and one
  inheritance/collection rebuild against populated fixtures.

### B9 — Ownership still overlaps `graph-store-port`, and its unresolved boundary is not repaired

- **Packages/files:** all three proposals/tasks, especially
  `terminusdb-schema/proposal.md` lines 118–144,
  `terminusdb-adapter/proposal.md` lines 102–116,
  `terminusdb-operations/proposal.md` lines 33–38 and 79–83; against
  `graph-store-port/tasks.md` T1–T8 and `RECONCILE.md` R7.
- **What is wrong:** the new packages correctly notice some duplication but do
  not resolve it. `graph-store-port` still owns authoring the schema, adapter,
  ingest, query wrapper, concurrency, pinning, backup, health, and exit path;
  the three packages each claim those same deliverables. Operations even states
  as a precondition that `graph-store-port`'s schema, adapter, and ingest have
  landed. The port also still says every graph read/write goes through it and
  files-only remains default, contrary to R7's narrowed
  persistent/cross-run/versioned-query boundary and TerminusDB-as-default for
  those consumers. The schema proposal's “every write and read in the graph
  plane” wording repeats the over-broad boundary.
- **Why it matters:** implementers cannot know which task/file is authoritative,
  and a literal implementation risks making GP-1 through GP-5 port/store
  clients, violating the critical no-store-dependency invariant.
- **Concrete fix:** revise `graph-store-port` before dispatch: retain only the
  narrow port contract, files-only implementation/conformance suite, exact
  module path/signatures/record/error vocabulary, capability negotiation, and
  no-direct-TerminusDB scan. Replace its T2/T4–T8 with explicit dependencies on
  these packages. State in all four specs that GP-1 through GP-5 keep direct
  file reads and are not port clients; TerminusDB is default only for the
  port's persistent/cross-run/versioned-query consumers.

### B10 — The exact final schema is not live-tested

- **Package/files:** `terminusdb-schema/design.md` lines 19–27 and schema block;
  `tasks.md` T3.
- **What is wrong:** the JSON block is syntactically valid JSON, and its
  `TaggedUnion`, `Set` cardinality, abstract class, multiple inheritance,
  subdocument, and key constructs match the current schema reference. However,
  R8 live-loaded a materially different draft. The schema package's final gate
  only parses JSON and runs document linters; it never loads this exact schema
  into pinned TerminusDB 12.0.6 or writes representative instances.
- **Why it matters:** “valid JSON using documented constructs” is not evidence
  that the frozen schema is accepted or has the claimed cardinality and
  rejection behavior.
- **Concrete fix:** extract the fenced schema deterministically, load it into a
  fresh pinned 12.0.6 database with `full_replace=true`, read the schema back,
  and run positive/negative instance fixtures for `EvaluationTarget`,
  `Optional resolved_to`, minimum Spec criteria, subdocument provenance, and
  unknown-field rejection. Make this an implementation gate, not a prose
  cross-check.

## Non-blocking findings

### N1 — “Every LLM-populated field is an enum or reference” is overstated

- **Package/files:** `terminusdb-schema/proposal.md` lines 54–60,
  `specs/store-schema/spec.md` lines 151–176, `tasks.md` T1.
- **What is wrong:** the audit task checks only confidence/status/kind, while
  LLM-authored `Claim.text`, `Finding.text`, `Finding.spec_clause`,
  `Entity.canonical_name`/aliases, `Supersession.reason`, and provenance
  locators are open strings. N2's own provenance sketch also needs a locator
  string, so the useful rule is about categorical/relational judgments, not all
  text.
- **Why it matters:** the current universal claim is mechanically false and
  will make a reasonable schema look non-conforming.
- **Concrete fix:** narrow the rule to LLM-populated categorical,
  confidence, identity, and relation-selection fields; enumerate explicitly
  allowed grounded text/locator fields and require source provenance for each.

### N2 — Work/bridge classification contradicts the schema's inheritance

- **Package/files:** `terminusdb-schema/specs/store-schema/spec.md` lines 9–34;
  `design.md` lines 90–170.
- **What is wrong:** the requirement calls Spec and Commit work-plane classes,
  but both inherit `Artifact -> GraphNode`, not `WorkNode`. Conversely Finding
  inherits WorkNode, whose documentation says its members are deterministic and
  never LLM-written, while the proposal calls Finding LLM-written and requires
  provenance on it; Finding has no provenance property.
- **Why it matters:** plane linting and the claim that Source is the only bridge
  cannot be implemented consistently.
- **Concrete fix:** define plane membership independently of inheritance or use
  compatible multiple inheritance; choose whether Finding is a deterministic
  projection or authored content and add the required provenance if authored.

### N3 — The resource tripwires are not fully computable as written

- **Package/files:** `terminusdb-operations/design.md` lines 77–102;
  `specs/store-operations/spec.md` lines 200–239 and 273–317; `tasks.md` T6/T8.
- **What is wrong:** the longevity thresholds are mostly numeric and have a
  concrete fallback action, but no canonical upstream repository/branch, bot
  treatment, author normalization, or rolling-window boundary is defined. The
  package says it sharpens release cadence but supplies no release-cadence
  threshold. “Three times 9.7 MB per ~5,500 docs for the current document
  count” has no formula for fixed overhead or corpus scaling, and “rebuild
  budget derived from 1,070 docs/s” omits startup, schema, non-graph streams,
  deletion, and regression-suite time. It also omits RECONCILE's fixed
  15-minute rebuild ceiling.
- **Why it matters:** two implementers can produce different alerts from the
  same state, and a self-derived budget can ratchet to excuse regressions.
- **Concrete fix:** define exact data sources and normalization, add a numeric
  release-cadence threshold, specify the disk/RSS formulas, and combine a
  corpus-derived expected duration with the fixed 15-minute ceiling.

### N4 — The adapter is specified against `latest` while operations requires a pinned release

- **Package/files:** `terminusdb-adapter/proposal.md` line 31 and
  `design.md` line 21; `terminusdb-operations/specs/store-operations/spec.md`
  lines 9–41.
- **What is wrong:** the adapter names
  `terminusdb/terminusdb-server:latest`; operations requires a version tag plus
  digest, and the evidence is specifically for server 12.0.6.
- **Why it matters:** tests against a moving image no longer establish the R8
  behavior the packages cite.
- **Concrete fix:** make the adapter consume the single operations-owned
  `12.0.6@sha256:...` pin and require an explicit evidence refresh before any
  bump.

### N5 — Deferral-assuming sibling passages remain beyond Council 3's list

- **Package/files:** reported list in
  `terminusdb-operations/proposal.md` lines 84–100; additional passages in
  `graph-store-port/design.md` lines 109–116 and
  `graph-eval-falsification/design.md` lines 23–53,
  `specs/evaluation/spec.md` lines 11–28 and 257–260, and `tasks.md` lines
  3–22.
- **What is wrong:** Council 3 found three stale passages, but not the port's
  “GP-7 may yet choose [files only]/explicitly deferrable” alternative, nor the
  falsification design/spec/tasks statements that the census runs before the
  adapter, can freeze GP-6, and is the basis for landing/freezing it.
- **Why it matters:** these passages contradict the owner decision and
  RECONCILE's honest claim set, even though the census remains useful for
  v0.3.x claims and tuning.
- **Concrete fix:** revise every passage consistently: the store lands in
  v0.2.9 on R8 evidence; the census cannot report in this release and first
  reports in v0.3.x; its result constrains later claims/consumers or triggers
  the already-defined exit path, not v0.2.9 landing.

### N6 — Operations package/file locations and commands are underspecified

- **Package/files:** `terminusdb-operations/tasks.md` T1–T9 and
  `terminusdb-adapter/proposal.md` lines 102–106.
- **What is wrong:** tasks say “write the script/definition/manifest” without
  exact paths, command names, scheduler mechanism, fixture paths, public
  function signatures, or bounded timeout values. The adapter explicitly
  leaves its exact module path to implementation, despite RECONCILE R7
  requiring exact path/signatures/records/errors at the port seam.
- **Why it matters:** parallel implementers must invent interfaces and will
  collide at composition.
- **Concrete fix:** name every created/modified/test file, CLI and exit code,
  schedule owner, function signature, record schema, timeout, and expected test
  command/output before dispatch.

## Evidence-fidelity audit

- **R8 measurements sampled:** 12.0.6 live schema acceptance; three lineage
  queries; 12/12 distinct-document writers; 10/10 same-document
  last-writer-wins; stale-header CAS rejection; 500-document batches at about
  1,070 docs/s; 28 ms p50/34 ms p95 single-document commits; 202 ms for 5,058
  documents; 38 MB idle RSS; 2.6 s cold start; 9.7 MB at about 5,500 documents;
  `Path` producing 10 rows for 4 answers without `Distinct`; silent
  anyURI/string empty bindings; and `/api/log` at about 2.4 ms/commit with
  O(offset) paging. The numeric reproductions in the packages match R8 within
  its stated corpus/host context. The extrapolated 10k/100k log costs remain
  correctly treated as an inference, not a live measurement.
- **N2 sampled:** all 24 CQs, the node/edge tables, missing-type corrections,
  PARENT_OF split, MENTIONS demotion, EVALUATES tagged union, RESOLVED_TO
  constraints, SUPPORTS strength, and provenance block. The package includes
  Round, Attempt, Agent, Spec, and Measurement and uses a tagged union, but
  fails the distinct SUBTASK_OF requirement and the per-edge provenance/
  SUPPORTS requirements described above.
- **RECONCILE sampled:** R7 boundary and journal ownership, section 4 honest
  claims, section 5 landing conditions, and the note to council lanes. No scoped
  package says the store was “validated by the census” or that census demand is
  already measured. The packages do not overclaim the census. They do,
  however, leave the old sibling decision text and do not make the required
  journal/rebuild ownership real.
- **Current upstream documentation sampled:** the current
  [TerminusDB schema reference](https://terminusdb.org/docs/schema-reference-guide/)
  confirms the used `TaggedUnion`, `Set` cardinality,
  `@subdocument`, `@abstract`, multiple-inheritance, and key syntax. The current
  [migration reference](https://terminusdb.org/docs/schema-migration-reference-guide/)
  still marks both `ChangeParents` and `ChangeCollection` unimplemented.
  Current official
  [document API reference](https://terminusdb.org/docs/document-insertion/)
  and [Python client reference](https://terminusdb.org/docs/python/) document
  the response data-version header and an SDK `last_data_version` precondition,
  so “undocumented” should be narrowed to the raw-HTTP/concurrency behavior
  that R8 had to prove live rather than asserted without qualification.

## What I checked and found correct

- The final schema fenced block parses as JSON: 33 entries, 32 named schema
  objects, no duplicate `@id`.
- The schema includes all five N2 missing types and makes `Evaluation.target`
  a required `EvaluationTarget` tagged union.
- `Entity.resolved_to` is natively functional at the document level via
  `Optional`; the package does not falsely claim native acyclicity.
- MENTIONS is absent from the schema and explicitly treated as a derived-index
  concern, consistent with N2's demotion decision (ownership of that index is
  still missing).
- SUPERSEDES is represented as a top-level document with `old`, `new`, `at`,
  and `reason`; those edge attributes are not silently discarded.
- Every specified WOQL `Path` is required to pass through `Distinct`, and the
  named-query suite repeats that rule.
- `/api/log` is banned from query paths by `graph-store-port`; operations does
  not introduce a query-log use and explicitly forbids it for monitoring. The
  port also has a task for a regression test that detects a query-path call.
- The packages preserve the critical architectural intent that files remain
  authoritative and describe a files-only exit rehearsal with the adapter
  stopped. Operations makes backup restore, timed rebuild, and exit rehearsal
  executable landing gates rather than documentation-only aspirations.
- The longevity thresholds for commit count and author share are numeric, and
  every tripwire has the concrete action “fall back within one release.”
- The claim set is honest about v0.2.9: adoption is the owner decision, and no
  package claims census validation, measured graph demand, or a v0.2.9 census
  verdict.
- Upstream still documents `ChangeParents` as unimplemented, so routing
  inheritance restructuring to rebuild is sound in principle.

## What I could not check, and why

- I could not live-load the final schema or execute HTTP/CAS/diff/WOQL canaries:
  no TerminusDB image or running instance is present in the workspace. This is
  also why B10 requires the package itself to add a pinned live-load gate.
- I could not verify a pinned image digest because the packages do not contain
  one; they reference `latest` or defer the digest to implementation.
- I could not verify rebuild duration, restore fidelity, or files-only round
  completion because these are specification packages and the named scripts,
  commands, fixtures, and implementation do not yet exist.
- I did not run or inspect `graphify-out/graph.json`, per the audit's explicit
  prohibition. Shape claims were checked only against the committed package
  text and the permitted R8/N2/RECONCILE evidence.
- I did not coordinate with or inspect the parallel Opus audit lane.
