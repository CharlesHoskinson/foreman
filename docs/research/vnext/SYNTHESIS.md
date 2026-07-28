# SYNTHESIS — Foreman v0.2.9 graph plane: one architecture from twelve lanes

**Written:** 2026-07-28, synthesis lane. **Inputs:** R1–R8, N1–N4, F-uutils-mkdir-blocker,
`SOURCE-karpathy-graph-engineering.txt`, `ROADMAP.md`, `bugeventlog.md`, and the two
authored packages (`lock-primitive-hardening`, `test-infrastructure-hardening`).
**Audience:** the architect. Decisions below are recommendations with tradeoffs stated;
each carries its evidence lane. Where a lane measured something, the number is quoted.
Where nothing was measured, that is said in words.

---

## 0. The decision, in one page

**Two planes, two write disciplines, one join, one gate rule.**

1. **The work-DAG plane is a deterministic projection of the event log. No LLM ever
   writes it, and it never passes through graphify.** `events.jsonl` is already the
   lineage store (R5 §2–3); the ontology-learning numbers say LLMs cannot be trusted to
   author structure (taxonomy F1 0.02–0.66, axioms 0.03–0.36 — N2 §3); and the work-DAG
   is fully determined by data Foreman already emits. Materialise it with a projector
   script, keyed by the identifier scheme in §2.4 (R5 §9, adopted with two amendments).

2. **The knowledge plane is graphify's, on a two-cadence schedule.** AST-only
   `graphify update` per merge (deterministic, measured zero-token — R5 §4.1); semantic
   extraction, clustering, and community labels on a slow cadence (nightly/release).
   No LLM in the per-commit path, ever (the GraphRAG community-refresh analogue is
   ~14M tokens per corpus change — R4 §2.2).

3. **TerminusDB is adopted with guardrails as a queryable materialisation, never as the
   system of record.** Knowledge plane + work-DAG both stored **as documents**; the
   TerminusDB commit log is an audit trail only, never load-bearing for lineage
   (measured 2.4 ms/commit linear scan, O(offset) paging — R8 §8.3). Everything in the
   store is regenerable from `events.jsonl` + `graph.json` + the per-lane GraphUpdate
   journals. All access goes through a `GraphStore` port with a files-only fallback, so
   the bus-factor-1 risk (one person wrote 93% of the last year's commits; the project
   already went dormant for 14 months; 105 npm downloads/month — R8 §2) is bounded to a
   re-materialisation, not a rewrite.

4. **Formalism: closed-world document schema, validated at write time. OWL is
   rejected.** 10 of 24 competency questions require negation-as-failure (N2 §9); the
   draft ontology loaded into TerminusDB 12.0.6 and all three lineage queries — including
   the negation query — ran correct on first attempt (R8 §6.1). Settled, with three
   modelling taxes recorded in §2.5.

5. **Consumption is a pre-serialized, content-hashed, token-budgeted context block
   built host-side — not agentic graph traversal.** Pre-serialization matches or beats
   traversal at 1/6–1/8 the LLM calls (89.80 vs 82.6 WebQSP Hit — N3 §8); it is also the
   only design where the audit trail can prove what the worker saw. graphify's MCP
   server survives as a bounded, read-only escape hatch that returns facts, not context.

6. **The gate rule: only closed-world checks block; open-world evidence checks warn;
   the model's verdict is one signal among several and is itself verified.** Measured
   open-world grounding runs at 88–94% precision — ruinous for a blocking gate at
   Foreman's merge volume (N4 §4). The v0.2.9 gate additions (G9, G1/G2, G4/G5) need
   **no graph store at all** and catch a failure class nothing catches today:
   hallucinated and self-contradictory audit output (N4 §7.7).

7. **The whole plane ships with its own falsification harness, or it does not ship.**
   R6 and N1 independently insist on the "just prompt the model with good context"
   baseline; N1's LEED case (assembled neurosymbolic pipeline at 61.6% vs its own
   text-only baseline at 67.3%) is the default failure mode of exactly this
   architecture. §4 names the bet and the kill criteria.

**Precondition for all of it:** `lock-primitive-hardening` lands first. The uutils
`mkdir` TOCTOU (57 violations / 15 rounds of 8 racers, vs 0 for GNU — F-finding) breaks
the mutex every concurrent write path in this design leans on. The authored package
already states the ordering constraint; it is real.

---

## 1. The architecture

### 1.1 Layering

```
                       WORK PLANE                          KNOWLEDGE PLANE
                       ──────────                          ───────────────
 source of truth   events.jsonl (append-only,          repo files at HEAD
                   frozen schema v2) + refs/            (git is the store)
                   checkpoints/* + run-dir JSON
                        │                                     │
 extraction        graph-project.sh                     graphify update (AST only,
 (deterministic,   (projection, zero LLM)               0 tokens, per merge)
 per merge)             │                                     │
                        ▼                                     ▼
 derived artifacts worklog.jsonl (append-only,          graphify-out/graph.json
                   keyed by JK-1..5)                    (+ GRAPH_REPORT.md)
                        │                                     │
 slow cadence           │                               semantic extract + cluster
 (nightly/release)      │                               + community labels (LLM,
                        │                               cached, non-evidential)
                        └──────────────┬──────────────────────┘
                                       ▼
                        GraphStore port  ── files-only impl (graph.json + worklog.jsonl)
                                         ── TerminusDB impl (documents; branch-per-lane;
                                            CAS on shared docs; commits = audit trail)
                                       │
                          host-side validate-then-commit
                          (schema + provenance + policy; agents NEVER write)
                                       │
                 ┌─────────────────────┴──────────────────────┐
                 ▼                                            ▼
      graph-context-builder                        deterministic gate checks
      (pre-serialized GraphContextBlock,           (G1–G9 over run subgraph;
      content-hashed, ≤2,000 tok default,          closed-world only may block)
      arrow DSL + edge IDs + citation contract)
                 │                                            │
                 ▼                                            ▼
      workers / auditors (READ-ONLY;               merge gate / PR body
      MCP escape hatch: facts, not context)
```

Three rules carry most of the safety, each with a measured basis:

- **No LLM in the per-commit path.** AST only. (LightRAG's measured ~14M-token
  community regeneration per corpus change; Stack Graphs' quadratic-reanalysis design
  rule — R4 §2–3.)
- **Agents read; only the host-side consolidate step writes, after validation.**
  Oracle Poisoning attacked a production 42M-node code KG: at moderate sophistication
  every tested model (9 models, 3 providers) trusted poisoned data 100% of the time,
  and of five defences **only read-only access control eliminated the direct mutation
  vector** (R4 §8.8). Lanes append `GraphUpdate` records to
  `~/.foreman/runs/<RUN>/graph/<lane>.jsonl`; consolidate validates and applies
  serially. Serial apply is a throughput ceiling that is irrelevant at ≤16 lanes.
- **Every write is additive: supersede and invalidate, never mutate or delete.**
  (Graphiti's invalidate-don't-delete; PROV-O `wasInvalidatedBy` — R4 §4, §7.)

### 1.2 What is extracted, by whom

| Content | Extractor | Cadence | Cost | Trust class |
|---|---|---|---|---|
| Code symbols, files, calls/imports/defines | graphify AST (`_origin: ast`) | per merge | 0 tokens (measured: committed graph built at 0 in / 0 out — R5 §4.1) | evidential |
| Work-DAG: runs, lanes, attempts, verdicts, gate decisions, merge bases | `graph-project.sh` from `events.jsonl` + checkpoints + run-dir JSON | per merge (or on demand) | 0 tokens, deterministic | evidential — reconstructible and diffable against the log |
| Docs/papers/concepts/rationale | graphify semantic pass (LLM, per-file cache, prompt-fingerprinted) | nightly / release | bounded; cached | advisory |
| Community labels, clustering, god-node report | graphify cluster/label | nightly / release | bounded | advisory — never evidence |
| Claims/entities from reports (if/when added) | LLM against the frozen N2 schema; every field an enum or a reference | slow cadence, host-validated | bounded | claim-with-provenance; decision edges enforced |

The `EXTRACTED / INFERRED / AMBIGUOUS` confidence enum is preserved end-to-end;
`INFERRED`/`AMBIGUOUS` edges are segregated and excluded from evaluator grounding by
default (R4 §10.3). LLM prose rationales are stored flagged non-evidential — LLM
self-explanations are measured "unstable, weakly faithful" (R4 §5.2).

### 1.3 What is stored where

- **`events.jsonl` stays the system of record for work lineage.** Frozen top-level
  shape `{seq,ts,type,lane,commit?,payload}`; all additions nest in `payload` (legal
  today, no signature migration — R5 §2.2). Gains in v0.2.9: `payload.vendor`,
  `payload.model`, `payload.usage`, universal `payload.attempt`, and — critically —
  `gate-eval.sh` and `audit-run.sh` start emitting events (today the two most
  decision-relevant artifacts, the verdict and the gate decision, never enter the
  lineage store — R5 §3.2).
- **git stays the store for commit ancestry.** `children`/`leaves`/`lineage`/`diff`
  are three SQL statements in AgentHub and four git commands here; re-modelling
  ancestry as KG edges buys nothing and adds a sync failure mode (R4 §9.1 #10,
  R1 §4). `Commit` nodes in the store are sha references only.
- **`graph.json` is the knowledge-plane interchange artifact and the ingest source.**
  It is strictly the highest-fidelity artifact graphify produces; the `cypher.txt`
  export destroys the entire audit trail (emits 5 fields; drops `source_file`,
  `source_location`, `confidence_score`, hyperedges, communities — R7 §8.3). The store
  ingests `graph.json` directly. **The `export neo4j`/`falkordb` file path is banned.**
- **`worklog.jsonl` is the work-DAG projection** — a sibling of `graph.json`, never
  written into it, because `graphify --update` rebuilds from the filesystem and would
  destroy injected rows on every refresh (R5 §4.5). Keyed by graphify node id so the
  two planes join (§2.4).
- **TerminusDB holds the queryable materialisation of both planes, as documents.**
  Rebuildable at any time from the artifacts above. Never the sole holder of anything.

### 1.4 What is queried, and by whom

| Consumer | Question shape | Mechanism |
|---|---|---|
| Worker lane | "what touches this module; what conflicts; what did the last attempt conclude" | pre-serialized `GraphContextBlock` (§1.5), built host-side, hashed into the run record |
| Auditor lane | same + criterion coverage, prior findings on these files | same, auditor-scoped edge allowlist |
| Gate | G1–G9 closed-world checks; "does cited edge exist"; "is any criterion uncovered" | deterministic scripts / store queries; **absence questions are always queries, never model reading** (LLMs score ≈0.0% on disconnected-nodes — N3 §10.2) |
| Architect | cross-run: "which findings recur", "which spec patterns produce escaped defects", "what did we believe at round 3" | WOQL/GraphQL over the store; time-travel by store commit; this is the query class the plane exists for |
| Evaluation harness | citation precision, K-sweeps, baseline arms | deterministic replay against hashed context blocks |

### 1.5 Context construction (the consumption contract)

Adopt N3 §9's context-builder spec as written, including its corrections to the source
paper's 7-step design. Load-bearing parameters, all traceable to measurements:

- **Format:** subject-grouped arrow DSL with per-edge IDs — measured cheapest of 13
  formats at **13.7 tokens/edge** (JSON-LD expanded is 3.64×); subject grouping is the
  incident-style layout worth up to 34–88 accuracy points; syntax preference inverts
  across vendors (IoU < 0.2), so the serializer is one swappable function measured per
  vendor, not a dogma (N3 §2).
- **Budget:** default 2,000 tokens ≈ 145 edges; hard cap 4,000. The knee is measured
  at 100–200 triples, and over-serving goes **below the no-graph baseline** (Lost in
  the Middle: 20–30-doc contexts under closed-book; every model's effective context
  ≤8K — N3 §6). Under-serve; the truncated flag licenses the tool escape hatch.
- **Selection:** entity-link seeds → role-scoped edge-type allowlist → 2-hop candidate
  closure → relevance-ranked top-K. Explicitly not PPR, not GNN scoring (both measured
  to fail or degrade — N3 §3). The retriever does the hop, not the worker (2-hop model
  reliability is ~60–70% of 1-hop even in short context).
- **Citations:** edge IDs in context at generation time, cited inline, plus a
  structured `cited_edges` field. Post-hoc citation attachment collapses recall
  73.6 → 26.7 (N3 §5.1). Never summarize served edges (−8 to −15 citation precision).
  Every citation is then verified deterministically: ID exists; ID was in *this*
  block; load-bearing claims carry ≥1 citation. Our citation targets are DB rows, not
  paragraphs — the weakest link in the attribution literature becomes an exact check.
- **Conflicts:** pinned in a separately-headed, explicitly-labelled block, ≤10 edges,
  never interleaved (unlabelled contradictions are distractors; distractor harm
  amplifies with length — N3 §7 step 5).
- **The block is immutable and content-hashed** into the run record — the audit trail
  can prove what the worker saw, and the auditor can be served the same bytes.

### 1.6 The gate (two-speed rule)

N4's tiering, adopted:

| Tier | Nature | Power |
|---|---|---|
| 0 | write-time schema validation on every graph write | reject the write |
| 1 | existing deterministic gate (paths, hash drift, checks, docs, freshness) | BLOCK |
| 2 | audit groundedness over the run subgraph: **G1** finding cites a file in the diff, **G2** line in a changed hunk, **G3** criterion coverage, **G4** cross-vendor invariant, **G5** rubric pinned, **G6** scope containment, **G7/G8** provenance invariants, **G9** verdict/finding consistency | BLOCK — all closed-world, 0% FP by construction |
| 3 | evidence sufficiency (does the graph support the claim) | **WARN only, never block** — measured 88–94% precision open-world; at ~40 merges/week a blocking check false-blocks ~3 correct merges/week and teaches the operator to bypass the gate |
| 4 | cross-vendor model audit, scoped to the residual (sampling-diversity and unarticulated-architecture defect classes) | BLOCK on BLOCKED, as today |

Two operational disciplines from executed evidence (N4 §6.6): **the validator ships
with a known-violating canary and fails closed on it** (pySHACL silently reported
`Conforms: True` when SPARQL-targeted shapes weren't evaluated — a no-op gate is worse
than no gate); and **the PR body states that the symbolic layer checks provenance and
consistency, not correctness** — correctness remains `checks-run.sh`'s job.

The verdict schema also gains the **three-outcome contract**: an errored audit lane
returns UNVERIFIED, never REFUTED/BLOCKED (R2 P2 — Anthropic shipped this as a bugfix
in `/deep-research`; it directly resolves the existing audit tie-break pain).

No SHACL engine, no Datalog engine, no reasoner in v0.2.9. G1–G6 and G9 are jq + git
over JSON (N4 §7.7: items 1–5 deliver most of the lane's value with no graph at all).
The reified-violation output shape — one addressed record per violation, with the
`required_evidence` sentence — is copied; the engine is not. If a constraint ever
genuinely needs recursion, the recorded decision path is: SHACL Core components with
SPARQL targets pinned to one engine, and stratified Datalog only if recursion is
unbounded (N4 §3.5, §9 Q5b).

---

## 2. The four conflicts, resolved

### 2.1 R5 ("graphify can't carry the work-DAG") vs R4 ("AST-only per commit")

**Not actually in conflict — they answer different axes, and both are adopted.**
R4's rule is about the knowledge plane's refresh cadence: nothing LLM-priced runs per
commit. R5's rule is about the plane split: work-DAG records are not derivable from
files on disk, so they are at risk under any `graphify --update` (which rebuilds from
the filesystem) and must live in a companion store. The resolution is the two-track
design of §1.1: graphify owns knowledge extraction on a two-cadence schedule; the
work-DAG is a projection of the event log into `worklog.jsonl`, keyed by graphify node
id, refreshed at zero token cost. The one genuine tension — R4 flagged graphify's
committed graph as `directed: false, multigraph: false`, which silently collapses
parallel decision edges (SUPPORTS + CONTRADICTS between the same pair) — is resolved
by mandate: `--directed` becomes mandatory in the refresh automation, decision edges
never round-trip through `graph.json` at all (they are store-native), and R8 confirmed
the store side holds them as distinct document properties.

### 2.2 N2 ("no LLM writes the work-DAG") vs N3 ("pre-serialize beats tools") vs R7 ("the MCP server is the natural read path")

**All three are adopted, because they govern three different pipeline stages.**
N2 governs the **write** side: the work plane is authored deterministically
(§1.1 rule 1); the measured collapse of LLM ontology-learning competence (axioms
F1 0.03–0.36; the gibberish ablation showing lexical-prior matching, which makes
Foreman's opaque run/lane IDs adversarial inputs) makes this non-negotiable. N3
governs the **read-construction** side: the primary consumption path is the
pre-serialized context block — it wins on accuracy-per-call (89.80 vs 82.6 at 1/6–1/8
the calls), on context-rot avoidance, and decisively on auditability (a hashed block
is replayable; an agentic traversal sees different evidence every run). R7's MCP
server is demoted to the **escape hatch**: read-only, bounded (~40-edge result cap,
counted against the same budget), used when entity resolution returns zero seeds,
when the candidate set was truncated, for absence/count questions, and for the
auditor's deterministic `get_edge` citation checks. Two R7 findings enforce the
demotion: all 10 MCP tools return prose strings, not JSON — unsuitable as a primary
machine path without a wrapper — and `query_graph`'s literal substring matching
silently returns zero recall without the vocab-expansion pre-step, so any lane-facing
access goes through Foreman's wrapper or not at all. What actually gets built:
projector (write), context builder (read), thin MCP wrapper (escape hatch), in that
priority order.

### 2.3 R8 ("commit log scales linearly; work-DAG as documents") vs R5 ("the event log is already the lineage store")

**R8's finding survives contact — by strengthening R5's.** The measured commit-log
scan (2.4 ms/commit, dead linear; O(offset) paging; the fast version is literally the
Enterprise paywall) kills any design where TerminusDB commits are the lineage
representation at commit-per-write volume. But Foreman never needed them to be:
`events.jsonl` is the durable, append-only, replayable work record, and R5 §3.1 shows
ten lineage questions it already answers with jq. So the division of labour is:
**event log = system of record; store documents = queryable projection; store commits
= audit trail only** (author field carries `run_id`/lane; the authenticated `user`
field is the non-spoofable identity). Lineage queries run over `Task`/`Round`/
`Attempt`/`AgentRun`/`Evaluation` documents (~230 ms over 5k docs, independent of
commit count — R8 measured). What R5's world must change to make the projection
worth having: vendor/model/verdict/gate events enter the log (§3.2 gaps 1–3),
`payload.attempt` becomes universal, and `durable.enabled` defaults true — otherwise
the log is empty for most rounds and there is nothing to project. Batching rule from
R8: appends of distinct documents need no CAS (12/12 concurrent writers green);
read-modify-write on shared documents requires the `Terminusdb-Data-Version` header
(10/10 silent last-write-wins without it); independent lane work uses
branch-per-lane + `/api/apply`, which is also the only path with real conflict
detection.

### 2.4 The identifier scheme (R5 §9) — assessed and adopted with amendments

JK-1..JK-5 are adopted as the join between planes:

- **JK-1** `foreman:run/<RUN>/lane/<LANE>/attempt/<N>` as the canonical work id;
  `payload.attempt` mandatory on every event (schema-legal, no migration).
- **JK-2** checkpoint SHA as the work→knowledge bridge: `git diff-tree` over the
  checkpoint commit yields `source_file` values that are already graphify node keys.
  Mechanical, zero-LLM. Symbol-level refinement by greatest `source_location` ≤ first
  changed hunk line; **fall back to the file node, never guess.**
- **JK-3** `payload.nodes` on `round_done` for the reverse lookup.
- **JK-4** content-hashed finding ids (`sha256(file+line+summary)`) — this is what
  makes "which findings recur across runs" a query for the first time.
- **JK-5** vendor + model as first-class payload keys at the `prompt` emit site.

Two amendments from R7 §8.5: graphify node IDs are stable across content edits,
machines, and Unicode variance, but **a file move re-IDs every symbol in it and a
graphify version upgrade can migrate the whole ID space** (it happened at #1504). So
(a) the store treats an ID change as rename-with-lineage, never delete+create, and
(b) every ingest stamps the producing graphify version — `graph.json` does not record
it. Precondition for the whole scheme: automated refresh; the committed graph is
already 3 commits stale with 26 files (including all six v0.2.9 packages) entirely
unrepresented (R5 §4.3).

### 2.5 The formalism decision — settled

**Closed-world document schema (TerminusDB's), validated at write time. OWL rejected.
No second formalism.** The deciding facts: 10 of 24 CQs are negation/aggregation
questions that are unanswerable in principle under OWA (N2 §4.2, §9); Foreman's graph
is a record of a bounded, fully-observed process, so closed-world is the correct model
of the world, not a convenience; ANCHOR's finding that prompt-based schema inclusion
fails and only write-time validation buys conformance (R4 §6); and R8 verified live
that the draft schema loads and the negation query (leaves with no evaluation) runs
correct in WOQL — with the explicit note that **GraphQL cannot express negation over
backlinks; WOQL owns those queries**. Keep the schema OWL 2 RL-shaped (no property
chains, no complex class expressions) so a mechanical RDF export stays possible.

Recorded modelling taxes, all verified against the live store or the schema reference:

1. **No edge properties.** Reify `Mention` now; plan reification for
   `SUPPORTS`/`CONTRADICTS` the moment per-edge confidence is needed (retrofit is a
   migration + backfill — R8 §3.1/§3.3).
2. **No conditional constraints** (`sh:xone` equivalent). Invariant 1
   ("sourced or marked inference") is enforced in the host-side validator we own
   anyway, not in the store schema (N4 §6.1).
3. **`Claim`/`Evaluation`/`Finding`/`Source` are top-level document classes, never
   `@subdocument`** — cascade-delete silently violates "superseded objects remain
   addressable" (N4 §6.4).
4. **No symmetric-transitive relations in the ontology** — measured to move
   incremental maintenance cost by three orders of magnitude (0.05 s vs 95 min at
   comparable scale — N4 §3.5.4).
5. **`ChangeParents` is unimplemented** in the migration API: keep the
   `GraphNode`/`WorkNode` abstract bases thin and stable (R8 §4).
6. **Every LLM-populated field is an enum or a reference** — Foreman's own graphify
   extraction spec measured continuous ranges collapsing to a bimodal binary
   (>50% at 0.5, >40% at 0.85+ — N2 §8.3).
7. Class names are common English words (`Attempt`, `Round`, `Verdict`) — measured 4×
   axiom-F1 spread between familiar and coined vocabularies (N2 §0.3). N2's blocking
   additions (`Round`, `Attempt`, `Agent`, `Spec`, `Measurement`; split `PARENT_OF`
   into three; `EVALUATES` exactly-one target) are accepted into the schema draft.

Also settled by the diff/query footguns (R8 §5.1, §6.3): **every Foreman store
wrapper normalises version references and asserts expected non-emptiness** — the
dominant failure mode of this database is a silent empty result, and the wrapper is
where that dies.

### 2.6 One flagged input defect: the Gemini lane evidence is about the wrong tool

R3 evaluated `@google/gemini-cli` 0.52.0; the mandated Gemini lane is `agy`
(Antigravity CLI 1.1.7), which per the coordinator has `--json-schema`,
`--mode plan|accept-edits`, and `--effort` — i.e. schema-forced verdicts and a
first-class read-only mode, closing the two biggest shims R3 designed around. R3's
**contract** stands (eight adapter points; stdin never the prompt channel; git-status
digest as the only write evidence; per-lane config-home isolation; cap 1 until a T5b
green row exists; unavailability always reported). R3's **gemini row** is invalid and
must be re-derived live against `agy` before the multi-vendor package freezes. This
does not touch the graph plane; it is recorded here so the invalid row is not copied
forward.

---

## 3. The honest case against — stated, not buried

The disconfirming evidence is strong, consistent across independent lanes, and it
narrows what this release may claim.

1. **Cross-vendor independence is mostly an illusion.** Nine frontier LLMs across
   seven families behave as **~2 effective independent votes**; individual top models
   matched or exceeded the full panel; the gap to the independence ideal was 8–22 pp
   and better aggregation closed at most 11% of it (R6 §6.1). Corroborated by
   behavioral-entanglement results (Spearman 0.64–0.71 between entanglement and judge
   over-endorsement). **Consequence:** the independence argument justifies ~2 vendors.
   Foreman's real decorrelation mechanism is the cold diff — *different evidence set
   and different role* — which is stronger than anything these papers audited, and it
   is the thing to protect. The fourth vendor is a capability/cost/availability lane
   until M5 (unique-catch rate per vendor pair) measures otherwise, and it is
   documented as such.
2. **Graph retrieval loses to trivial baselines on the common case.** BM-25 beats all
   nine GraphRAG systems on True/False; six of nine fall below it on reasoning;
   LightRAG spent 83.9M construction tokens to score below TF-IDF; MSFT GraphRAG paid
   ~101M tokens per accuracy point (N3 §4.4). HippoRAG 2 concedes KG-augmented RAG
   drops "considerably below standard RAG" on factual memory. The full-context
   baseline beat the memory vendor's own system in its own numbers (73% vs 68% —
   R4 §4.1). Anthropic's guidance: under ~200k tokens, skip retrieval entirely.
   **Consequence:** the graph plane is not a retrieval-accuracy play and must never be
   sold as one. Lookup-shaped questions route to lexical/deterministic paths.
3. **Assembled neurosymbolic systems lose to their own baselines by default.** LEED:
   full pipeline 61.6% vs text-only 67.3%, with the deterministic sub-check locally
   perfect — extraction failures and conservatism cost more globally than the
   symbolic precision bought (N1 §6.1). The distraction effect: a noisy graph
   degrades reasoning even when a correct signal is also present (N1 §5.4).
   **Consequence:** the plane needs an off-switch and an A/B path, not a one-way
   migration.
4. **"Graphs reduce hallucination" is unmeasured.** The KG-hallucination survey
   contains no measured reduction anywhere (N3 §4.2). Foreman claims citation
   precision and multi-hop accuracy — things it can measure — and nothing else.
5. **The store is fragile.** TerminusDB: bus factor 1, one prior 14-month dormancy,
   105 npm downloads/month, performance headroom held by the paid tier (R8 §2). Hence:
   port + regenerability + quarterly re-evaluation, and the files-only implementation
   stays warm.
6. **The multi-agent premise itself is under attack.** Auto-designed MAS underperform
   CoT-SC at up to 10× cost; token budget explains 80% of performance variance;
   coding has fewer parallelizable tasks than research (R6 §2.2, §6.2). Foreman is
   expert-architected — the one configuration that paper found beats auto-MAS — but
   Foreman has **never run a cost-matched single-agent baseline**, and that critique
   lands.

**What this release is betting.** Not that graphs improve single-task answers — the
evidence says they will not. The bet is narrower, and it is the only bet §VIII-C of
the source paper endorses: **(a)** cross-session, cross-lane provenance questions
("which findings recur", "which spec patterns produce escaped defects", "what did the
agent believe at round 3") are frequent and valuable enough to justify a typed,
queryable, durable record; and **(b)** deterministic closed-world checks over that
record (G1–G9, citation verification) remove a real, currently-invisible failure
class — hallucinated findings, incoherent verdicts, silent criterion non-coverage —
at 0% false-positive cost. Bet (b) is near-free and does not even need the store.
Bet (a) is the expensive half, and it is falsifiable.

**What proves it wrong (kill criteria, decided before building):**

- The **query census** (one release of architect queries, classified point-lookup /
  single-doc / genuinely multi-hop-cross-run): if the multi-hop-cross-run share is
  small, the store materialisation is Table VI's "activity without progress" — freeze
  GP-6, keep the journal and the gate checks.
- The **locked baseline arm**: on the Tier-2 canary (R6 §5), "one strong model +
  spec + diff + report in the prompt + deterministic checks" at equal cost. If
  graph-context lanes do not beat it on cross-session tasks, the context builder is
  demoted to those queries the census proved (or shelved).
- **Shadow-mode Tier-3** for ~100 merges: precision measured on our data; promotion
  to blocking only on a pre-declared threshold. Do not promote on vibes.
- **M5 per vendor pair** before any 4-vendor quality claim; below ~5% unique catch,
  the lane is documented as capacity, not quality.
- The first release's canary budget goes to **measuring Foreman's own run-to-run σ**,
  not to claiming an improvement (R6 open question 1).

---

## 4. What Foreman should actually build, in priority order

Ordered by value per unit of risk. Each item names its evidence; items marked
**[judgement]** go beyond what any lane measured.

1. **Land `lock-primitive-hardening` and `test-infrastructure-hardening`** (already
   authored). Evidence: F-finding (57/15×8 mutex violations); everything below
   assumes concurrent writers. Not graph work; strictly first.
2. **Make round-mode dispatch the default** (`durable.enabled=true`). Evidence: the
   #1 failure class (background-and-stop, 11+ occurrences, three vendors) is
   prompt-immune and its structural fix is shipped but off (R5 §6.2). Without it the
   event log is empty for most rounds and the work plane has nothing to project.
3. **Work-plane telemetry into the event log** (GP-1): `vendor`, `model`,
   `payload.usage {tokens, cost_usd, effort}`, universal `attempt`, `finding` events,
   and `el_emit` calls in `gate-eval.sh` / `audit-run.sh`. Evidence: R5 §3.2 gaps
   1–3, 9; R6 §4.3 — M1–M8 and every cost-matched comparison are uncomputable
   without `usage`; this is the single biggest telemetry gap.
4. **Deterministic audit-groundedness gate** (GP-2): G9 first (~15 lines of jq),
   then G1/G2, then G4/G5 via verdict-contract fields, then G6/G3 as the spec format
   gains scope globs and criterion IDs; three-outcome verdicts; validator canary.
   Evidence: N4 §7 (all closed-world, 0% FP; catches hallucinated findings nothing
   catches today); R2 P2/P3; executed canary finding (fail-open is real).
5. **Knowledge-plane refresh automation** (GP-3): post-merge/CI `graphify update`
   (AST-only), `--directed` mandated, one pinned interpreter + version (today three
   versions coexist: 0.9.15 skill / 0.9.16 PATH / 0.9.18 dist-packages — R7 §3),
   `diagnose multigraph --json` as a health gate, single-writer discipline (graphify
   has one advisory flock that the skill path ignores; two writers are silent
   last-writer-wins — R7 §9.4), cohesion sidecar snapshotted before cleanup,
   `graphify_version` stamped at ingest. Evidence: R7 §11; R5 §4.3–4.4 (manual
   refresh is the substrate's biggest operational weakness).
6. **Work-DAG projection** (GP-4): `graph-project.sh`, `worklog.jsonl`, JK-1..5.
   Evidence: R5 §9 (all inputs exist; zero LLM); N2 §0.1/§10.5 (`event_offset` makes
   the plane reconstructible and diffable — "is the graph correct?" becomes a
   deterministic check).
7. **Context builder** (GP-5): N3 §9 spec as written; reads `graph.json` +
   `worklog.jsonl` directly so it does not block on the store. Evidence: N3 §§2–9
   throughout (every parameter carries a number); deterministic citation
   verification is the cheap, novel win.
8. **Store port + TerminusDB adapter** (GP-6): `GraphStore` protocol; files-only
   impl first; TerminusDB impl per R8 §12's guardrails (documents not commits;
   branch-per-lane; CAS on shared docs; assert-non-empty wrappers; version pinned;
   stop-and-tar backups; quarterly health re-check). Evidence: R8 (live-verified
   capability, ~5 dev-days), R4 §9.2 (what the store gives free). **[judgement]**:
   adopting now rather than after the census — justified because the port bounds the
   downside to a re-materialisation and the ontology work is store-agnostic; the
   architect may legitimately defer GP-6 behind the census with no change to
   anything above it.
9. **Falsification harness** (GP-7): query census, locked baseline arm, shadow
   Tier-3, per-vendor serializer/K-sweep, M5. Evidence: R6 §5 (Tier 0–2 design,
   layer-isolated per-slice baselines), N1 §9 Q1–Q2, N3 §9.4. This is what makes §3's
   kill criteria executable.
10. **Metrics M1–M8 + per-release rollup** — computable once (3) lands. Evidence:
    R6 §4 (each metric ships with its misreading and companion number).
    **[judgement]** on the exact metric set; the design rules are evidenced.

Explicitly *not* in this order despite being in-scope elsewhere: multi-vendor V1–V12
(in flight; blocked on the agy re-derivation — §2.6), WSL P1–P6 (authored), and the
v0.4.0 audit-latency work.

---

## 5. Package map — graph plane only

Multi-vendor, workflow, lock, and test-infrastructure packages exist or are in
flight and are not re-specified. Landing order below assumes R5 §7.1's sequence for
the non-graph packages (P2 → P1 → lock → test-infra → P4 → multi-vendor → P3), with
graph packages additive after the contended files (`lane-run.sh`, `tool-check.sh`)
settle. P5 (CI parity) lands last so CI asserts the final surface.

| # | Package | Capability | Purpose (one line) | Depends on | Land |
|---|---|---|---|---|---|
| GP-1 | `work-plane-telemetry` | eventlog | Vendor/model/usage/finding payload keys, universal `attempt`, gate+audit events, `durable.enabled=true` — the work plane becomes recordable | lock-primitive-hardening, test-infrastructure-hardening | 1st |
| GP-2 | `audit-groundedness-gate` | gate | G9/G1/G2 now, G4/G5 via verdict-contract fields, G3/G6 with spec-format IDs; three-outcome verdicts; validator canary; no graph store required | GP-1 (verdict fields) | 2nd |
| GP-3 | `knowledge-plane-refresh` | graphify integration | Automated AST refresh, `--directed`, pinned interpreter+version, health gate, single-writer rule, cohesion/version capture; ban the cypher.txt path | none (parallel with GP-1/2) | 2nd (parallel) |
| GP-4 | `work-dag-projection` | work plane | `graph-project.sh`: events.jsonl + checkpoints → `worklog.jsonl` under JK-1..5; reconstructible-and-diffable invariant | GP-1, GP-3 | 3rd |
| GP-5 | `graph-context-builder` | consumption | Pre-serialized, hashed, budgeted GraphContextBlock + citation contract + deterministic post-verification; MCP wrapper as bounded escape hatch | GP-3, GP-4 (not GP-6) | 4th |
| GP-6 | `graph-store-port` | store | `GraphStore` port; files-only impl; TerminusDB adapter (N2 schema, documents-not-commits, CAS/branch rules, non-empty assertions, guardrails) | GP-3, GP-4 | 5th — may be deferred behind the GP-7 census by architect decision |
| GP-7 | `graph-eval-falsification` | evaluation | Query census, locked prompt-baseline arm, shadow Tier-3, per-vendor serializer sweep, M5 per-pair unique catch, σ measurement | GP-5 | 6th — but the census instrumentation can start with GP-1 |

Dependency shape worth noticing: **GP-1 through GP-5 never touch TerminusDB.** The
context builder and the gate run off `graph.json` + `worklog.jsonl` + run-dir JSON.
If the store is deferred or dies, the plane degrades to files and loses only
time-travel, branch/merge on the graph, and the cross-run query ergonomics — not the
gate, not the context, not the record.

---

## 6. What we are NOT doing, and why (the refuse list)

Extending N1 §8.3 across all lanes. Each entry names the evidence that closes it.

1. **No LLM writes to the work-DAG plane** — taxonomy/axiom F1 collapse (N2 §3); the
   plane is fully determined by the event log.
2. **No end-to-end differentiable neurosymbolic anything** (LTNs, DeepProbLog,
   semantic loss) — no gradient plane, no labels; the reasoning-shortcut pathology
   lives here; shortcut-freeness is coNP-complete (N1 §8.3.12).
3. **No autoformalization of specs into a proof assistant** — typecheck catches
   41.2% of semantic drift; agents are weak at exactly what a spec is (N1 §8.3.13).
4. **No ontology-validation-as-trust-boundary** — single-axiom edits: 93.3% attack
   success, 100% consistency-checker stealth, detection at chance. Ontology and rule
   changes are code: review, signed commits, the same gate (N1 §8.3.14).
5. **No LLM as the reasoner over the whole graph** — systematic hallucination past a
   KB-size threshold; "semantic RAG is fundamentally unsuited for rule enforcement";
   absence questions score ≈0.0% (N1 §8.3.15, N3 §10.2). Rules go to queries.
6. **No community summaries as a per-commit index artifact** — the ~14M-token
   refresh trap (R4 §2.2). Slow cadence, advisory only.
7. **No `graphify export neo4j`/`falkordb` file path, ever** — 5 fields survive; the
   audit trail does not (R7 §8.3). Ingest `graph.json`.
8. **No TerminusDB-commit-per-write lineage, no `/api/log` on any query path** —
   measured linear scan; the fast path is the paid tier (R8 §8.3).
9. **No fourth-vendor independence claims** — ~2 effective votes (R6 §6.1). Gemini
   is capability/cost until M5 says otherwise.
10. **No PageRank/PPR or GNN scoring in retrieval** — both measured to fail or
    degrade (N3 §3.1). No agentic traversal as the primary read path (6–8× calls for
    ≤parity).
11. **No "the graph reduces hallucination" claims** — unmeasured in the entire
    literature (N3 §4.2). Claim citation precision and multi-hop accuracy only.
12. **No worker test-writing ceremony, no elaborate self-critique scaffolding** —
    measured no-ops; external adversarial verification is where the wins are
    (R6 §3.3, N1 §8.3.17).
13. **No LLM-authored ontology, axioms, domains, ranges, cardinalities, or
    disjointness** — F1 0.03–0.36 (N2 §3.3). One human author, reviewed, frozen.
14. **No free floats or open strings in any LLM-populated field** — measured bimodal
    collapse of continuous rubrics (N2 §8.3). Enums and references only.
15. **No symmetric-transitive relations in the ontology** — 0.05 s vs 95 min
    incremental-maintenance spread (N4 §3.5.4).
16. **No `@subdocument` for Claim/Evaluation/Finding/Source** — cascade-delete
    silently violates addressability (N4 §6.4).
17. **No learned surrogate inside a gate** — 95% accuracy is the reliability band of
    the thing being disciplined (N4 §3.2).
18. **No blocking open-world evidence checks** — 88–94% precision false-blocks
    ~3 merges/week and teaches gate bypass (N4 §4.4). Warn, measure, promote by
    number.
19. **No re-modelling of git commit ancestry as graph edges** — git answers
    children/leaves/lineage/diff already; the planes "should not be collapsed"
    (R4 §9.1 #10; source paper §V-A).
20. **No agent write access to the graph, no unsigned GraphUpdate ingestion without
    host-side validation** — read-only access control was the only defence that
    eliminated the poisoning vector (R4 §8.8).
21. **No transcripts, file contents, full diffs, or per-call token detail in the
    graph** — digests and references; "store artifacts before storing conversations"
    (R4 §10.3).
22. **No shipping the plane without the baseline harness** — LEED is what this
    architecture does by default when nobody measures it (N1 §6.1, §8.3.16).

---

## 7. Residuals and open questions (owned, not hidden)

1. **agy re-derivation** (§2.6) — the entire Gemini adapter row, live, before
   multi-vendor freezes. Includes the quota/headless-fallback behaviour R3 flagged
   as its single most important untested item.
2. **The break-even KB size** for solver-vs-model checks is uncharacterised in the
   literature (N1 §9.1); Foreman's work-DAG invariants may sit below it. Measured by
   GP-7 before any engine dependency is added.
3. **Selective un-merge in TerminusDB** (R4 §11 Q4) — assumed impossible; hence the
   `RESOLVED_TO` additive-edge layer is non-negotiable. Confirm rather than assume.
4. **Valid-time scope** — transaction time comes from the store; validity windows
   are built only on decision edges to start (R4 #3). Widen only on demonstrated
   need.
5. **Criterion IDs and scope globs in the five-part spec** — G3/G6 require a spec
   format change (N4 §9.2); blast radius is architect authoring habits, so it lands
   with GP-2's second wave, not its first.
6. **Does subject-grouping help or hurt our mixed workload?** PathRAG vs Context
   Rot pull opposite directions (N3 §10.1). A/B in GP-7.
7. **Retention/pruning** — no policy exists for archiving a RUN's subgraph
   (R4 §11 Q10). Not blocking at current scale; needs an owner before v0.3.x.
8. **TerminusDB quarterly health check** — commit cadence and second-maintainer
   watch (R8 §12.6), calendarised with the release checklist.
9. **Non-root WSL migration** — inherited residual; interacts with test validity
   (F-finding's test-50 root bypass).
10. **The cost-matched single-agent baseline** (R6 §6.2) — the most uncomfortable
    open question in the corpus, and the one this plan finally schedules (GP-7).

---

*Assembled from R1–R8, N1–N4, and F by the synthesis lane, 2026-07-28. Every number
above is quoted from a lane report that labels it VERIFIED or measured-here; the
judgement calls are marked as such in §4. The architect owns every decision in §0–§2;
this document is the argument, not the authority.*
