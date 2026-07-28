# Live verification of the frozen schema — architect, 2026-07-28

Both audit lanes returned BLOCKED and both put the same defect first: the
council's frozen schema was never actually loaded into TerminusDB. The
packages' gate checks that the JSON parses, not that the database accepts it,
while citing R8's live-loaded **draft** (18 classes) as evidence for a
materially different final schema (33 objects).

Rather than accept or dispute that on paper, the architect ran the test the
auditors specified. Foreman doctrine: an auditor's verdict is a claim with
provenance, not an unexamined gate.

## Method

- `terminusdb/terminusdb-server:v12.0.6`, digest
  `sha256:e02eaa3a5b75e01550cee2a662a846db7fceb725193983f1f35e1842ab580fee`,
  fresh container, healthy in **3 s** (R8 measured 2.6 s — consistent).
- The schema block was extracted **deterministically from the package itself**
  (`terminusdb-schema/design.md`), not retyped: the largest parseable fenced
  JSON block. 33 objects — 1 `@context`, 12 `Enum`, 19 `Class`, 1 `TaggedUnion`.
- Loaded via `POST /api/document/admin/foreman?graph_type=schema&full_replace=true`.

## Results

| # | Check | Result |
|---|---|---|
| 1 | Schema loads and persists; reads back | **PASS** — 33 objects |
| 2 | Undeclared field (`graphify_version`) rejected | **PASS** (rejected) |
| 3 | Well-formed `Agent` instance accepted | **PASS** |
| 4 | Invalid enum value rejected | **PASS** |

TerminusDB accepted all 33 objects on first load and returned the full class
list: `TaskState … Supersession`.

## What this settles

**Finding "the frozen schema is not live-tested" (Opus B1 / Codex B10) —
the process criticism is UPHELD; the implied risk is NOT.** The packages' gate
is genuinely prose-only and must become an executable load test; that fix
stands. But the schema itself is accepted by pinned 12.0.6 exactly as written,
including the constructs the auditors flagged as unverified (top-level
`TaggedUnion`, subdocument-with-links, abstract classes, multiple inheritance).
The severity should drop from "unlandable defect" to "missing gate", because
the artifact under suspicion is sound.

**Finding "ingest cannot write a single document" (Opus B4 / Codex B5) —
CONFIRMED LIVE, and it is the real blocker.** Check 2 demonstrates the
mechanism directly: TerminusDB rejects a document carrying `graphify_version`
because no class declares that field. The adapter package requires that stamp
on every ingested document. As specified, the first production ingest fails on
its first write. This is not a paper contradiction between two packages — it is
reproducible in three seconds, and it must be fixed before any ingest task is
dispatched.

Check 4 also confirms the schema's enum discipline is real and enforced at
write time, which is the property N2's "every LLM-populated field is an enum or
a reference" rule depends on.

## Consequence for the fix round

- Reclassify the schema-not-tested finding: keep the executable-gate fix,
  drop the severity.
- Keep "ingest cannot write" at blocking, now with a live reproduction rather
  than a cross-package reading.
- Add the load test above to `terminusdb-schema` T3 as the gate, and the
  unknown-field probe to the adapter's ingest tasks — both are four `curl`
  calls and run in under ten seconds.

## Honest limits of this verification

This tested schema acceptance and four instance behaviours. It did **not** test
the `EvaluationTarget` exactly-one constraint, `Optional resolved_to`
cardinality, subdocument provenance round-tripping, the CAS header, the
`branch:`-prefixed diff footgun, or any of the 24 competency queries. Those
remain unverified and the auditors' findings on them stand untouched. The
container was removed after the run; no state persists.


---

## Second run, 2026-07-28 — after the ingest fix (corrects the record above)

**The table above is the PRE-FIX state and check 2 says the opposite of what was
later claimed from it.** After Fix Lane C added `GraphNode.graphify_version`, the
schema was re-extracted and re-loaded and the fixtures re-run. That run was
reported in conversation and **never written here**, so for several hours the
only artifact on disk contradicted the claim being made about it. The Opus
re-audit checked the artifact rather than the claim and caught it (TD4). It was
right to, and the omission is the architect's.

Method identical to the first run: schema block extracted deterministically from
`terminusdb-schema/design.md` (33 objects), fresh pinned
`terminusdb/terminusdb-server:v12.0.6`, `full_replace=true`. Fixtures carry every
required field and only enum values read from the schema — an earlier attempt
failed four times on invented values and missing fields, which is why the
fixtures are now derived rather than guessed.

| # | Check | Result |
|---|---|---|
| 1 | A `Source` carrying `graphify_version` is accepted | **PASS** (was rejected pre-fix) |
| 2 | An undeclared field is still rejected | **PASS** |
| 3 | An invalid enum value is still rejected | **PASS** |
| 4 | `subtask_of` accepted | **PASS** |
| 5 | `depends_on` accepted as a distinct relation | **PASS** |

5 passed, 0 failed. The ingest blocker is closed and the schema remains strict.
Note `@id` must be omitted — these classes use generated keys, and a submitted
`@id` yields `SubmittedIdDoesNotMatchGeneratedId`.

**What this run does not cover**, unchanged from the first: the
`EvaluationTarget` exactly-one constraint, `Optional resolved_to` cardinality,
subdocument provenance round-tripping, the CAS header, the `branch:` diff
footgun, and all 24 competency queries.
