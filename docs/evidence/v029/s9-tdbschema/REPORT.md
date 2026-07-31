# REPORT — terminusdb-schema (s9-tdbschema)

## T1 — Author the frozen schema
**DONE**

- Authoritative schema: largest fenced JSON block in
  `openspec/changes/terminusdb-schema/design.md` (33 objects: 1 `@context`,
  12 enums, 19 classes, 1 TaggedUnion; 15 concrete classes + Provenance
  subdocument + 3 abstracts).
- Version `v0.2.9` documented in `@documentation.@title` and new section
  **Schema version and change procedure** (extract-from-design.md, human
  review, CQ/manifest co-update, live gate, version bump).
- Structural checker
  `openspec/changes/terminusdb-schema/scripts/check-schema-structure.py`
  confirms all T1 task bullets: no `parent_of`/`PARENT_OF`/`mentions`/`Mention`,
  no plain `supersedes`; `has_attempt`/`subtask_of`/`depends_on`/
  `artifact_depends_on`/`broader_than` on the documented classes only;
  `GraphNode.graphify_version` Optional string; EvaluationTarget on
  Evaluation.target (required) and Finding.about (optional);
  Entity.resolved_to / resolved_reviewed_by; Supersession top-level;
  LLM fields closed enums; Measurement.value xsd:decimal exception;
  Provenance ValueHash subdocument; AgentRun SLSA fields Optional without
  `@min_cardinality` on resolved_deps.
- Proposal drift fixed: PARENT_OF split includes `subtask_of`; Provenance
  required on Claim/Entity only (Finding is WorkNode).

Command: `python3 openspec/changes/terminusdb-schema/scripts/check-schema-structure.py`
→ `PASS: structural checks ok (33 schema objects, 12 enums, 15 concrete classes, CQ 1-24)`

## T2 — Competency question audit
**DONE**

- All 24 N2 §9 questions mapped in design.md table (rows 1–24).
- Exactly two gaps: **CQ-16**, **CQ-22** (Answered-by starts with `gap`).
- CQ field names match schema (has_attempt, subtask_of, depends_on,
  EvaluationTarget, Supersession, consumed, contradicts, etc.).
- graphify → schema manifest v1: six file_types (code, document, paper,
  image, concept, rationale), reject rule for unmapped types, hyperedges
  drop-with-record.

## T3 — Gate (openspec, markdownlint, live load-test, bugeventlog)
**DONE**

| Gate | Command / evidence | Result |
|---|---|---|
| openspec | `/usr/local/bin/openspec validate terminusdb-schema --strict` | Change valid |
| markdownlint | `markdownlint-cli2 --config /tmp/mdlint-schema.jsonc :openspec/changes/terminusdb-schema/{design,proposal,tasks}.md :openspec/changes/terminusdb-schema/specs/store-schema/spec.md` | 0 issues in 4 files |
| live load | `bash openspec/changes/terminusdb-schema/scripts/schema-live-gate.sh` | GATE RESULT: PASSED |
| bugeventlog | appended friction notes for this package | present |

**Live checks (pinned `terminusdb/terminusdb-server:v12.0.6@sha256:e02eaa3a5b75e01550cee2a662a846db7fceb725193983f1f35e1842ab580fee`):**

1. schema `full_replace` → HTTP 200  
2. schema GET contains every declared class/enum name  
3. positive Agent → HTTP 200  
4. invalid `vendor` enum → HTTP 400 (rejected)  
5. undeclared field → HTTP 400 (rejected)  
6. drop-and-rebuild schema identical  

All 19 `tasks.md` checkboxes marked `[x]`.

## Verification evidence (undeclared field / invalid enum / drop-rebuild)
**DONE — live, not structural-only**

Known-bad inputs **observed failing** (write rejected):

- Invalid enum: `vendor: "not-a-real-vendor"` → HTTP **400**
- Undeclared field: `not_a_declared_field` → HTTP **400**

Positive control: well-formed Agent → HTTP **200**

Drop-and-rebuild: second `full_replace` + GET identical to first GET snapshot.

Checker soundness (harness must fail when a case fails):

- `check-schema-structure.py --self-test` → known-bad `parent_of` and missing CQ-22 gap both rejected; `SELF-TEST PASS`
- `schema-live-gate.sh --self-test-fail` → exit **1**, `GATE RESULT: FAILED (1 check(s))`

## Deferred / notes
**None deferred.** Package implemented fully.

Notes for architect / consumers:

- Repo markdownlint config ignores `openspec/changes/**`; bare globs give a
  vacuous green. Use `:` literal paths (recorded in bugeventlog).
- No `git commit` performed (BRIEF). No graphify invoked.
- `npx` not used; openspec via `/usr/local/bin/openspec`.
- No bats suite was added for this package (gates are the Python structural
  checker + shell live gate); if a later lane adds bats, gate through
  `flock /tmp/foreman-bats.lock`.
