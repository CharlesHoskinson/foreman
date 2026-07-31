# SPEC — terminusdb-schema, round 1

Read `AGENT_TRAPS.md` IN FULL first. No `git commit`. No graphify — this package
is about a graph store, which makes it tempting; do not.

## Scope

19 checkboxes, the smallest remaining package. Implement it fully if you can;
report anything deferred.

## The architectural decisions already made — do not relitigate them

- **The product owner decided TerminusDB ships.** `graph-store-port` owns the
  port abstraction and the files-only implementation; **this package owns the
  ontology only.**
- **Closed-world document schema. OWL was REJECTED**, on measurement: 10 of 24
  competency questions require negation-as-failure. Do not introduce OWL
  constructs or open-world reasoning.
- **TerminusDB is a regenerable materialisation, never the system of record.**
  The schema must be droppable and rebuildable. If anything you write would make
  the store authoritative for data that exists elsewhere, that is a defect.
- Verified live already: a draft 18-class ontology loaded into pinned TerminusDB
  12.0.6, accepted, persisted, and correctly rejected undeclared fields and
  invalid enums. A later re-run gave 5/5. So the shape is known to work — read
  `docs/research/vnext/R8-terminusdb-store.md` and
  `VERIFY-terminusdb-schema-live.md` before writing.

## Deliverables

The frozen, human-authored schema, plus whatever validation the package
specifies. **Frozen means it has a version and a documented change procedure** —
a schema that can drift silently is worse than none, because consumers will bind
to a shape nobody promised.

## Verification

- The schema loads into TerminusDB if a pinned instance is reachable. **If no
  instance is reachable, say so plainly and validate structurally instead — do
  NOT claim a live load you did not perform.**
- It **rejects** an undeclared field and an invalid enum value. Show both
  failing, because a schema that accepts anything is the vacuous case here.
- Drop-and-rebuild produces an identical schema. Assert it.
