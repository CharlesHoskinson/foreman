# Change: graph-context-builder

## Why

Foreman is about to have a knowledge plane (`knowledge-plane-refresh`) and a
work-DAG projection (`work-dag-projection`). Neither is worth anything until a
worker can read them, and the way a worker reads a graph is the part of this
design with the most measured evidence behind it — and the most measured ways to
get it wrong.

**Serving the graph badly is worse than not serving it.** In the
Lost-in-the-Middle measurements, 20- and 30-document contexts score *below
closed-book* (53.8 and 50.5 against a 56.1 baseline), with a 22.9-point swing
attributable to position alone. Effective context is measured at **≤8K tokens
for every model tested** against claimed windows of 128K–2M, and 10 of 12 models
fall below half their short-context baseline at 32K. Context Rot reproduces the
degradation across 18 current frontier models and finds distractor harm
*amplifying* with length. A context builder that dumps a neighbourhood into the
prompt is not a neutral act; it is a measurable regression.

**Letting the worker traverse is worse than pre-serializing, and it destroys the
audit trail.** Pre-serialized top-100 triples reach WebQSP Hit **89.80** in a
single LLM call; agentic traversal at depth 3 × width 3 reaches **82.6** in
**6–8 calls**. Beyond the accuracy and the 6–8× cost, a traversal sees a
different subgraph every run, so "the auditor saw different evidence than the
implementer" becomes the default rather than the exception. A pre-serialized
block is a fixed, hashable artifact: we can record exactly what the worker saw,
replay it, and serve the auditor the same bytes.

**The graphify MCP server cannot be the primary path.** All ten of its tools
return plain text strings rather than structured JSON, and `query_graph`'s
matcher is case-folded substring plus IDF with a trigram index — graphify's own
`references/query.md` states there is *"no stemming, no synonyms, no
cross-language match"* and mandates a vocabulary-expansion pre-step, without
which the matcher silently returns zero hits. Any lane that calls it raw gets
silent zero recall and answers from model memory.

**Citations must be issued during generation or they are worthless.** ALCE
measures inline citation at **73.6 recall / 72.5 precision** and post-hoc
attachment of the same content at **26.7 / 26.7** — correctness moves −2.1 while
citation recall collapses by 46.9 points. AttributedQA reproduces it
architecturally (65.5 AIS retrieve-then-read versus 55.6 post-hoc). And
summarising the served evidence, which looks like a free budget win, costs
**8–15 points of citation precision**.

**But we have something the attribution literature does not: our citation
targets are database rows, not paragraphs.** Verifying "does edge `e07` exist,
and was it in this block" is an O(1) exact lookup rather than an NLI judgement.
The weakest link in that literature becomes a cheap deterministic check — the
novel, near-free win in this package.

**And absence cannot be delegated to the model.** On the disconnected-nodes
task, accuracy is **0.5% zero-shot and ≈0.0% for zero-CoT, few-shot, CoT and
CoT-BaG** — *"LLMs lack a global model of a graph."* "What is missing" and "what
contradicts this" must be computed by the builder and handed to the model, never
asked of it.

One structural gap has to be closed before any of this works: **graphify edges
have no identifier.** The edge record is `{source, target, relation, confidence,
confidence_score, source_file, source_location, context, _origin}` — no `id`
field anywhere in `graph.json`. Citation, verification and replay all key on
edge identity, so the builder mints it.

## What changes

- **New `skills/foreman/scripts/graph-context.sh`** (plus its library) —
  `build_context(task, role, budget) -> GraphContextBlock`, run host-side before
  a lane is dispatched. It reads `graphify-out/graph.json`,
  `graphify-out/worklog.jsonl` and the run-dir JSON. It reads no database.
- **Edge identity.** Every served edge gets a durable `edge_key` —
  `sha256(source ‖ target ‖ relation ‖ source_file ‖ source_location)`, truncated
  — and a short in-block alias (`e07`) that the worker actually types. The alias
  table is part of the block and part of the hash.
- **Retrieval**: seed resolution from the task text (cap 8 seeds) → role-scoped
  edge-type allowlist → 2-hop bounded candidate generation → relevance ranking →
  top-K. The k-hop closure is never served. No PageRank, no PPR, no GNN.
- **Budget**: default 2,000 tokens ≈ 145 edges at the measured 13.7 tokens/edge;
  floor 40 edges; hard cap 4,000 tokens ≈ 290 edges. Zero seeds emits an explicit
  `NO GRAPH CONTEXT` marker and no fallback subgraph.
- **Serialization**: subject-grouped arrow DSL with inline edge IDs — measured
  cheapest of 13 candidate formats at 13.7 tok/edge against 50.0 for JSON-LD
  expanded. The *layout* is specified normatively; the surface syntax is one
  swappable function, because format preference is measured to invert across
  vendors.
- **Fixed block layout**: task restated first and last; groups ordered ascending
  by score so the strongest material sits last; a separately-headed, explicitly
  labelled conflicts block of ≤10 edges outside the K budget; a pinned
  artifact-version block of ≤10 edges, marked as an untested assumption.
- **Citation contract** issued in-band with at least one worked demonstration,
  requiring inline `[e07]` markers plus a structured `cited_edges` field and an
  `uncited_claims` list.
- **Deterministic post-verification**: `HALLUCINATED_EDGE_ID` (no such edge),
  `OUT_OF_CONTEXT_CITATION` (real edge, not in this block), `UNSUPPORTED_CLAIM`
  (load-bearing claim with no citation). No model in that loop.
- **Absence and contradiction as builder queries** — computed and served as
  findings, never asked of the worker.
- **Content-hashed, replayable blocks.** The block hash goes into the run record;
  the block itself is stored under the run directory so an auditor can be served
  the identical bytes and an evaluation can be replayed.
- **A thin MCP wrapper** as a bounded read-only escape hatch: it performs the
  mandatory vocabulary expansion against `.vocab.txt`, logs the expansion, caps
  results at ~40 edges counted against the same budget, returns structured JSON,
  and fails loudly on empty expansion instead of letting the caller answer from
  memory.

## Impact

- Affected: `skills/foreman/scripts/lane-run.sh` and
  `skills/foreman/scripts/worker-run.sh` (a block is built and attached before
  dispatch), `skills/foreman/scripts/audit-run.sh` (the auditor is served the
  implementer's block plus its auditor-scoped extension),
  `skills/foreman/scripts/gate-eval.sh` (citation verification runs as a
  deterministic check), the verdict contract (`cited_edges`, `uncited_claims`).
- New: `skills/foreman/scripts/graph-context.sh`,
  `skills/foreman/scripts/lib/graph-context.sh`,
  `skills/foreman/scripts/graph-mcp.sh`, `tests/graph-context.bats`,
  `skills/foreman/references/graph-context.md`.
- **Depends on `knowledge-plane-refresh` (GP-3)** for a graph that is fresh,
  directed, version-stamped and single-writer safe, and for the freshness figure
  stamped into every block.
- **Depends on `work-dag-projection` (GP-4)** for `worklog.jsonl` — the work-plane
  half of the served context (prior attempts, verdicts, findings) comes from
  there, keyed by graphify node ID.
- **Explicitly does not depend on `graph-store-port` (GP-6).** The builder reads
  `graph.json` + `worklog.jsonl` + run-dir JSON. If the store is deferred or
  abandoned, this package is unaffected — that independence is a design
  constraint, not an accident.
- **Feeds `graph-eval-falsification` (GP-7).** The K-sweep, the per-vendor
  serializer sweep and the locked prompt-only baseline arm all run against hashed
  blocks produced here. This package ships the instrumentation; GP-7 owns the
  verdict on whether the block helps at all.
- Behaviour change: workers gain a graph block in their prompt and gain an output
  contract (`cited_edges`, `uncited_claims`). Lanes that produce neither are
  reported as uncited rather than silently accepted.
- Claim discipline: this package claims **citation precision** and **multi-hop
  accuracy**, both measurable here. It does not claim reduced hallucination —
  that number does not exist anywhere in the KG-RAG literature.
