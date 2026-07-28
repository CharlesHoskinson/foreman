# Change: graph-store-port

## Why

The graph plane (SYNTHESIS §1.1) materialises two planes — a work-DAG projected
deterministically from `events.jsonl`, and a knowledge plane extracted by
graphify — and then wants to ask cross-run questions of both: *which findings
recur*, *which spec patterns produce escaped defects*, *what did the agent
believe at round 3*. Those are the only questions SYNTHESIS §3 is willing to
fund a store for. Everything else in the plane (GP-1 through GP-5) runs off
`graph.json` + `worklog.jsonl` + run-dir JSON and never touches a database.

R8 evaluated TerminusDB **live** against 12.0.6 in Docker on the reference box
on 2026-07-28 — not from the brochure. The draft Foreman ontology (18
classes/enums) loaded clean on first attempt; all three lineage queries,
including the negation query that OWL cannot express, returned correct answers
on first run; 12 concurrent writers to one branch all landed; time-travel to a
prior commit returned exactly the pre-write state. It does what it advertises,
in a 38 MB idle / 2.6-second-cold-start container holding 5,500 documents in
9.7 MB on disk.

It is also **fragile in a specific, measured way**:

| Signal | Measured |
|---|---|
| Share of the last year's commits written by one person | **~93%** (793 of ~860) |
| Prior dormancy | **12½ months** between v11.1.12 (2024-03) and v11.1.13 (2025-03); 27 commits in all of 2024 |
| npm `terminusdb` (the current v12 client) | **105 downloads/month** |
| Founder's last commit | 2025-04-22 — gone |
| Forks with more than one star | **none** |

And it has two failure modes that return HTTP 200:

- A diff whose `before_data_version` carries the plausible-looking `branch:`
  prefix returns **`[]` silently** (`VERIFIED-live`, R8 §5.1) — galling,
  because `branch:<id>` is exactly the format the `TerminusDB-Data-Version`
  *response* header hands back.
- The vendor's own troubleshooting page names its top issue: *"Query returns 0
  bindings silently — no error message, just empty results… **This is the
  single most common WOQL debugging issue.**"* (`VERIFIED-docs`, R8 §6.3).

Two silent-empty paths in the same product means **the dominant failure mode of
this database is a wrong answer that looks like a true answer**, and that lands
directly on an audit trail. R8's verdict is ADOPT-WITH-GUARDRAILS. This package
is those guardrails, written as requirements rather than advice.

The third measured finding decides the data model. R8 timed `/api/log`:

| Commits on branch | Full scan |
|---|---|
| 178 | 459 ms |
| 278 | 680 ms |
| 378 | 932 ms |
| 478 | **1,152 ms** |

~2.4 ms per commit, dead linear, with `start=` paging costing O(offset)
(`count=10 start=400` → 442 ms against 35 ms at `start=0`). Foreman writes a
commit per write. The fast version of this query is literally the Enterprise
paywall (*"very fast commit history queries"*). So **the work-DAG is modelled as
documents, not commits** — where the same lineage answers cost ~230 ms over
5,000 documents, independent of commit count.

## What changes

- **A `GraphStore` port** — one protocol every graph read and write in Foreman
  goes through. Foreman core never imports a TerminusDB client, never builds a
  TerminusDB URL, and never sees a WOQL AST.
- **A files-only implementation, and it is the default.** It answers the port
  over `graphify-out/graph.json` + `worklog.jsonl` + run-dir JSON with no
  database installed, no container running, and no network. If the store is
  deferred, dies, or is simply not wanted on a given host, the plane keeps the
  gate, the context block, and the record; it loses time-travel, graph
  branch/merge, and cross-run query ergonomics, and nothing else.
- **A TerminusDB adapter** behind the same port, targeting the HTTP API
  directly (R8 §8.4: both thin clients are in dependabot-only maintenance;
  everything R8 verified was done over raw HTTP).
- **The N2 schema as the frozen write-time contract**, with N2 §10.4's
  corrections applied: `Round`, `Attempt`, `Agent`, `Spec` and `Measurement`
  added; `PARENT_OF` split into `HAS_ATTEMPT` / `SUBTASK_OF` / `BROADER_THAN`;
  `EVALUATES` given exactly one target as a `TaggedUnion`; `RESOLVED_TO`
  functional, acyclic and human-reviewable; `MENTIONS` demoted from a stored
  edge to a derived index; every LLM-populated field an enum or a reference.
- **Reification where the store has no edge properties.** TerminusDB is a
  document graph: `(p)-[:LIVES_IN {since: 2020}]->(c)` renders as
  `{"lives_in": "City/London"}` and `since` silently disappears (R8 §3.1).
  `Mention` is reified now; the reification of `SUPPORTS`/`CONTRADICTS` is
  designed now and applied when per-edge confidence is first needed, because
  retrofitting it after data exists is a `MoveClassProperty` plus a backfill.
- **A concurrency contract** matching what R8 measured: appends of distinct
  documents need no CAS (12/12 green); read-modify-write on a shared document
  **requires** the `TerminusDB-Data-Version` CAS header, because without it 10
  of 10 contending writers returned 200 and the last one silently won;
  independent lane work uses branch-per-lane plus `/api/apply`, the only path
  with real conflict detection.
- **Assert-non-empty everywhere**, as a hard requirement rather than a habit —
  every query and diff declares whether it expects results, version references
  are normalised before use, and two canary fixtures (one per known
  silent-empty path) must fail closed in CI.
- **Guardrails with an exit path**: the server version and image digest are
  pinned, the store directory is backed up by stop-and-tar, a quarterly health
  re-check runs with named trigger conditions, and the documented response to
  those triggers firing is a one-release retreat to the files-only
  implementation — which is survivable only because everything in the store is
  regenerable.
- **Ingest from `graph.json`, schema-first, two-pass, `PUT ?create=true`.**
  R8 estimates ~5 developer-days. The `graphify export neo4j` / `falkordb`
  file path is banned outright: it emits 5 fields and drops `source_file`,
  `source_location`, `confidence_score`, hyperedges and communities — it
  destroys exactly the audit trail this store exists to hold.

## Impact

- **New:** the `GraphStore` port and its two implementations; the frozen
  schema document and its migration runner; the ingest exporter; the query
  wrapper layer; a port conformance suite that runs identically against both
  implementations.
- **Affected:** nothing in Foreman core changes behaviour when the store is
  absent — that is the point of the port, and the conformance suite is what
  proves it.
- **Depends on GP-3 (`knowledge-plane-refresh`)** for a `graph.json` that is
  fresh, `--directed`, and stamped with the producing graphify version, and on
  **GP-4 (`work-dag-projection`)** for `worklog.jsonl` under the JK-1..5
  identifier scheme. Neither is implemented here.
- **Depended on by nothing.** GP-1 through GP-5 never touch this store. That
  is deliberate: it is what makes deferral cheap.
- **Ordering.** `lock-primitive-hardening` lands first — this package
  specifies concurrent writers and inherits whatever locking discipline exists
  when it is written.
- **May be deferred by architect decision** behind GP-7's query census
  (SYNTHESIS §5). If the census finds genuine multi-hop cross-run queries are
  rare, this package is frozen and nothing above it changes. The specs here
  are written so that deferral costs a decision, not a rewrite.
