# Change: graph-store-port

## Why

The graph plane materialises a work-DAG from `events.jsonl` and a knowledge
plane from graphify, then asks cross-run questions of both. GP-1 through GP-5
continue to run from `graph.json`, `worklog.jsonl`, and run-dir JSON; the store
is a regenerable query projection, never a system of record.

R8 evaluated TerminusDB 12.0.6 live in Docker on 2026-07-28. The draft
ontology loaded, the three lineage queries returned correct answers, twelve
concurrent distinct-document writers landed, and time-travel returned the
pre-write state. The same dated evaluation measured 38 MB idle RSS, a
2.6-second cold start, 5,500 documents in 9.7 MB, and two HTTP-200 paths that
returned a plausible but wrong empty result. It also measured a bus factor of
one, a prior 12.5-month dormancy, and roughly 105 monthly npm downloads.

On 2026-07-30, commit `b3bbdc3` withdrew that server dependency. The class
vocabulary survived in `skills/foreman/ontology/schema.sql`, a local SQLite
ontology that is already implemented and discrimination-tested. It is stronger
at several boundaries: the engine enforces kind/plane disjointness through a
composite foreign key, enums use `CHECK`, lexical keys use `UNIQUE`, sets use
junction tables, and supersession is reified with timestamp and reason.
Recursive traversals ship as guarded views because an unguarded SQLite
recursive query was measured to hang; `claim_head.still_superseded` distinguishes
a real head from a walk stopped by its guard.

The original live evaluation remains historical evidence for the port,
expected-emptiness contract, and regenerability requirements. It is not the
current build target.

## What changes

- Keep the landed `GraphStore` port and files-only default from commit
  `933c308`. Store-specific SQL stays behind the port; Foreman core never
  issues SQL against the ontology outside the SQLite ontology adapter.
- Add a SQLite ontology adapter behind that same port. It creates a local
  database file by applying `skills/foreman/ontology/schema.sql` and verifies
  the pinned schema hash before any use.
- Treat `schema.sql` as the single authoritative ontology definition. The
  adapter uses its store-enforced disjointness, enum checks, lexical keys,
  junction tables, reified `supersession`, lint views, and guarded traversal
  views rather than rebuilding those rules in caller code.
- Preserve the files-only implementation as the default and keep its complete
  conformance suite running on every commit. SQLite remains opt-in per host;
  time-travel and branch/merge stay explicitly optional capabilities.
- Express ontology reads and writes as parameterised SQL. Traversals use the
  shipped views, including `claim_head.still_superseded`; callers do not copy
  recursive CTEs or omit their cycle guards.
- Preserve the expected-emptiness contract for every query. A query that
  expects rows may not return an unqualified empty result, and a true negative
  is declared explicitly.
- Preserve the withdrawal record's two most important guardrails: all 24
  competency queries become a permanent CI-run SQL suite, and the live schema
  gate continues to prove positive acceptance, invalid-enum rejection,
  undeclared-field rejection, and drop-and-rebuild identity.
- Use SQLite transactions and bounded busy handling so concurrent lane writes
  cannot silently clobber shared state. Distinct inserts may fan in; a shared
  read-modify-write reads and writes within one guarded transaction.
- Keep ingest lossless and schema-first. `graph.json` is the only graphify
  ingest source, unsupported shapes fail closed, and edge attributes are
  represented by declared tables or junction tables rather than discarded.
- Preserve `fm-session.py project()` as a one-way SQLite-to-ontology projector.
  The ontology never writes back into the canonical session store.

## Impact

- **Retained:** `GraphStore`, the files-only implementation, its named errors,
  its optional-capability protocol, and its backend-agnostic contract suite.
- **New:** the SQLite ontology adapter, SQL competency suite, schema-hash gate,
  graph ingest path, and rebuild/integrity runbook.
- **Authoritative schema:** `skills/foreman/ontology/schema.sql`, pinned for this
  package at SHA-256
  `1a7c15a97fe594a07746d285a9e14b3a0820b3386c40c0206d55389f7a6eb76f`.
- **Affected:** no GP-1 through GP-5 behavior. If the SQLite ontology is absent
  or unavailable, the current files-only path continues and reports optional
  capability degradation.
- **Depends on:** GP-3 for a fresh directed/version-stamped `graph.json` and
  GP-4 for `worklog.jsonl`; neither is implemented here.
- **Historical record:** the R8 live results of 2026-07-28 remain the reason for
  the port and fail-closed query contract, while commit `b3bbdc3` records why
  the evaluated server was withdrawn on 2026-07-30.
