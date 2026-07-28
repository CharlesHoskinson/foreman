# R4 — Durable Graph Memory for Agent Systems: State of the Art, and the graphify Gap Analysis

Research lane R4. Written 2026-07-28. Scope updated twice mid-lane:
(1) release scope is maximal — both graph planes ship in v0.2.9; graphify is the
**mandated extraction substrate**; (2) a versioned graph store (TerminusDB, evaluated
separately by R8) is the candidate **store/ontology layer**. This report is therefore
SOTA research *plus* a store-aware gap analysis of graphify. It does not evaluate
TerminusDB (R8) or characterise the committed `graphify-out/` corpus (R5).

Every claim below is labelled **VERIFIED** (I fetched the source and read the number)
or **INFERRED** (my reasoning from verified inputs). Marketing claims are marked as
vendor claims even when verified as *published*.

---

## 1. Sources fetched

| URL | Status | Date fetched |
|---|---|---|
| https://arxiv.org/abs/2404.16130 (MS GraphRAG, "From Local to Global") | OK | 2026-07-28 |
| https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/ | OK | 2026-07-28 |
| https://microsoft.github.io/graphrag/index/architecture/ | OK | 2026-07-28 |
| https://arxiv.org/abs/2410.05779 + https://arxiv.org/html/2410.05779v2 (LightRAG, full text w/ cost table) | OK | 2026-07-28 |
| https://arxiv.org/abs/2405.14831 (HippoRAG) | OK | 2026-07-28 |
| https://arxiv.org/abs/2502.14802 (HippoRAG 2) | OK | 2026-07-28 |
| https://arxiv.org/abs/2606.25656 (Is GraphRAG Needed?, ACL 2026 GEM) | OK | 2026-07-28 |
| https://arxiv.org/abs/2605.15109 (Why Neighborhoods Matter — traversal provenance) | OK | 2026-07-28 |
| https://arxiv.org/abs/2510.14271 (Less is More / DEG-RAG — KG denoising + ER study) | OK | 2026-07-28 |
| https://arxiv.org/abs/2501.13956 (Zep / Graphiti temporal KG) | OK | 2026-07-28 |
| https://arxiv.org/abs/2504.19413 (Mem0) | OK | 2026-07-28 |
| https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/ | OK | 2026-07-28 |
| https://raw.githubusercontent.com/getzep/graphiti/main/README.md | OK | 2026-07-28 |
| https://arxiv.org/abs/2502.12110 (A-MEM, NeurIPS 2025) | OK | 2026-07-28 |
| https://arxiv.org/abs/2604.22085 (Memanto — typed memory, no KG) | OK | 2026-07-28 |
| https://arxiv.org/abs/2605.09822 (Oracle Poisoning — KG poisoning of a 42M-node code graph) | OK | 2026-07-28 |
| https://arxiv.org/abs/2408.03910 (CodexGraph) | OK | 2026-07-28 |
| https://arxiv.org/abs/2410.14684 (RepoGraph) | OK | 2026-07-28 |
| https://raw.githubusercontent.com/sourcegraph/scip/main/README.md | OK | 2026-07-28 |
| https://raw.githubusercontent.com/sourcegraph/scip/main/docs/DESIGN.md | OK | 2026-07-28 |
| https://github.blog/open-source/introducing-stack-graphs/ | OK | 2026-07-28 |
| https://glean.software/docs/introduction/ | OK | 2026-07-28 |
| https://raw.githubusercontent.com/potpie-ai/potpie/main/README.md | OK | 2026-07-28 |
| https://arxiv.org/abs/2506.02509 (LLM-CER, in-context clustering ER) | OK | 2026-07-28 |
| https://arxiv.org/abs/2405.16884 (ComEM — match/compare/select) | OK | 2026-07-28 |
| https://arxiv.org/abs/2401.03426 (uncertainty-reduction ER) | OK | 2026-07-28 |
| https://arxiv.org/abs/2606.01210 (Can we trust LLM self-explanations for ER?) | OK | 2026-07-28 |
| https://arxiv.org/abs/2510.20345 (LLM-empowered KG construction: a survey) | OK | 2026-07-28 |
| https://arxiv.org/abs/2308.02357 (Text2KGBench — ontology conformance) | OK | 2026-07-28 |
| https://arxiv.org/abs/2606.01208 (ANCHOR — SHACL-validated schema-agnostic KG) | OK | 2026-07-28 |
| https://arxiv.org/abs/2412.20942 (Ontology-grounded KG construction, Wikidata schema) | OK | 2026-07-28 |
| https://www.w3.org/TR/prov-o/ | OK | 2026-07-28 |
| https://slsa.dev/spec/v1.0/provenance | OK | 2026-07-28 |
| https://raw.githubusercontent.com/in-toto/attestation/main/spec/v1/statement.md | OK | 2026-07-28 |
| https://www.anthropic.com/news/contextual-retrieval | OK | 2026-07-28 |
| http://export.arxiv.org/api/query (GraphRAG / ER / agent-memory / ontology listings) | OK | 2026-07-28 |
| https://raw.githubusercontent.com/blarApp/blar-graph/main/README.md | **FAIL — 404** | 2026-07-28 |
| SPDX 3.0 spec | **NOT FETCHED** — deprioritised; PROV-O + in-toto/SLSA cover the vocabulary need | — |
| Local: `/root/foreman/skills/graphify/SKILL.md`, `/root/foreman/graphify-out/graph.json` | read directly | 2026-07-28 |

---

## 2. The GraphRAG family: what works, what it costs, what the critics found

### 2.1 What each actually indexes

**Microsoft GraphRAG** (arXiv 2404.16130, Apr 2024) — VERIFIED. Two LLM passes at index
time: (1) derive an entity knowledge graph from source documents; (2) **pre-generate
community summaries for all groups of closely related entities**. Query time is
map-reduce: each community summary produces a partial answer, then a final summary.
Target is *global sensemaking* ("what are the main themes?") over ~1M-token corpora —
explicitly a query-focused-summarisation task, not a retrieval task.

The second index pass is where all the money goes. That is the single most important
architectural fact in this section.

**LightRAG** (arXiv 2410.05779) — VERIFIED. Same LLM entity/relation extraction per
chunk, but **no community-summary pre-generation**. Dual-level retrieval (specific
entities + broad topics) over graph + vectors, and an incremental update that merges new
extractions into the existing graph rather than rebuilding.

**HippoRAG / HippoRAG 2** (2405.14831 / 2502.14802) — VERIFIED. Open-IE KG plus
Personalized PageRank as the retrieval mechanism (hippocampal indexing analogy). One
retrieval step replaces iterative retrieval.

**LazyGraphRAG** (MSR blog, Nov 2024) — VERIFIED. Defers all LLM use to query time. No
prior summarisation of source data at all. Cost/quality is controlled by one knob, the
*relevance test budget*.

### 2.2 Measured costs — the numbers that matter

All VERIFIED from the sources named.

| Measurement | Value | Source |
|---|---|---|
| LazyGraphRAG indexing cost | **identical to vector RAG = 0.1% of full GraphRAG** | MSR LazyGraphRAG blog |
| LazyGraphRAG global-query cost at comparable quality to GraphRAG global search | **>700× lower** | MSR LazyGraphRAG blog |
| LazyGraphRAG at 4% of GraphRAG C2 global query cost | significantly outperforms all 8 competing conditions, local **and** global | MSR LazyGraphRAG blog |
| GraphRAG global retrieval, Legal dataset (94 docs, 5.08M tokens) | 610 level-2 community reports × ~1,000 tokens = **610,000 tokens per query**, plus hundreds of API calls | LightRAG §4.5 |
| LightRAG retrieval, same dataset | **<100 tokens, 1 API call** | LightRAG §4.5 |
| GraphRAG **incremental update** on that dataset | must dismantle and regenerate the community structure: 1,399 communities × 2 × ~5,000 tokens ≈ **14M tokens** | LightRAG §4.5 |
| LightRAG incremental update | extraction cost of the new text only | LightRAG §4.5 |
| HippoRAG single-step vs IRCoT iterative retrieval | **10–30× cheaper, 6–13× faster**, up to +20% multi-hop | HippoRAG abstract |
| Anthropic Contextual Retrieval (no graph) | −49% retrieval failures (−67% with reranking); one-time index cost **$1.02 per million document tokens** | Anthropic, Sep 2024 |

**The single most load-bearing number for Foreman: GraphRAG's community-summary layer
costs ~14M tokens to refresh on a corpus change.** A dev-orchestration graph changes on
*every commit*. Community summarisation as an index-time artifact is therefore
disqualified for per-commit updates and belongs on a slow cadence (merge/nightly) if at
all. INFERRED from the LightRAG measurement + Foreman's commit frequency.

### 2.3 Published critiques and negative results

- **HippoRAG 2's own framing** (VERIFIED): prior graph-augmented RAG approaches
  improve sense-making and associativity but their "performance on more basic factual
  memory tasks **drops considerably below standard RAG**." This is a graph-KG paper
  conceding that adding a graph made the common case worse. It is the cleanest published
  negative result in the family.
- **"Is GraphRAG Needed?"** (2606.25656, ACL 2026 GEM workshop, VERIFIED): 9 standardised
  RAG scenarios compared. Two findings we should internalise. (a) A context-engineering
  method cut token usage **19–53%** in GraphRAG/Agentic RAG by fixing context/memory
  overflow — i.e. a large fraction of graph-RAG cost is avoidable plumbing, not signal.
  (b) There is a **retrieval–generation gap**: expanded retrieval does not proportionally
  improve generation quality, so "retrieval-oriented metrics overstate advanced retrieval
  benefits." Translation for us: do not accept "the graph retrieved more relevant edges"
  as evidence that the graph improved outcomes. Measure the outcome.
- **"Why Neighborhoods Matter"** (2605.15109, VERIFIED): in agentic GraphRAG, cited
  evidence is *necessary* (removing it changes answers and reduces accuracy) but **not
  sufficient** — accurate answers also depend on *uncited traversal context* and
  surrounding graph structure. The authors argue citation evaluation must move to
  **provenance over the whole retrieval trajectory**. Direct implication for the Karpathy
  note's "cite the edge identifiers" design: edge citations alone are an incomplete audit
  trail. Foreman should log the *traversal* (entry nodes, hops, edge-type filters, budget)
  alongside the cited edges.
- **DEG-RAG / "Less is More"** (2510.14271, VERIFIED): LLM-constructed KGs are "noisy…
  with redundant entities and unreliable relationships"; the noise "degrades retrieval and
  generation performance while also increasing computational cost." Entity resolution +
  triple reflection drastically shrink the graph *and* consistently improve QA across
  multiple Graph-RAG variants. This is the strongest evidence that a raw LLM-extracted
  graph is a liability until it is denoised.

**Assessment.** GraphRAG's contribution is global sensemaking over a static corpus. Its
cost model is hostile to a repository that changes hourly. LightRAG/LazyGraphRAG are the
architecturally relevant ancestors for us — *defer LLM work to query time, never
pre-summarise the whole graph*. For Foreman, the analogue is: graphify's AST pass (free,
deterministic) per commit; semantic extraction and community labelling on a slow cadence.

---

## 3. Code knowledge graphs

| Approach | What it indexes | Provenance | Incremental update | Notes |
|---|---|---|---|---|
| **SCIP** (Sourcegraph) | Language-agnostic protobuf index of definitions/references/implementations; indexers for Java/Scala/Kotlin, TS/JS, Rust (rust-analyzer), C/C++, Ruby, Python, C#, Dart, PHP | Symbol → file + range; index is per-snapshot | Design doc lists "**Adding file-level incrementality should be easy**" as a *goal*, i.e. not built in. Practically: re-index per commit at repo granularity | VERIFIED. Mature, many languages, needs a build/typecheck for precision |
| **Stack Graphs** (GitHub) | Name-binding rules per language via a DSL; powers precise code nav for all public+private Python repos | Per-file facts | **Incremental by construction.** At index time each file is analysed *completely in isolation*; graphs are merged at query time. GitHub built it this way explicitly because otherwise "we'll have to reanalyze *every* file… whenever *any* file changes", making work quadratic in changed files | VERIFIED. **This is the design rule to copy.** No build system, no repo-owner config. Cost moves to query-time path finding |
| **Glean** (Meta) | Facts about source code in RocksDB, Angle query language; ships indexers+schemas but you can define your own schemas and store arbitrary facts (test coverage, profiling) alongside code facts | Fact-level, schema-typed | Incremental fact storage (RocksDB-backed) | VERIFIED. The "store non-code facts next to code facts under one schema" property is exactly the dual-plane idea, already productionised |
| **CodexGraph** (2408.03910) | Repo → graph database with a unified schema; LLM agent writes and executes graph queries for context retrieval | Schema-level | Not addressed | VERIFIED. Evaluated on CrossCodeEval, SWE-bench, EvoCodeBench |
| **RepoGraph** (2410.14684) | Plug-in repo-level structure module | — | Not addressed | VERIFIED. Boosted all four SWE-bench methods it was plugged into |
| **potpie** | Code + structure + **decisions, source history, team knowledge, engineering workflows**; CLI + daemon + harness integration; agent ingests/updates | — | Agent-driven ingest/update | VERIFIED (README). Closest in *ambition* to Foreman's graph plane |
| **blar-graph** | — | — | — | **Source failed (404).** Cannot assess |
| **graphify** (ours) | AST structural extraction (deterministic, **no LLM, no API key**) + optional semantic extraction for docs/papers/images | `source_file` + `source_location` + confidence enum per edge | `--update` re-extracts only new/changed files; semantic results cached per source file | VERIFIED from `/root/foreman/skills/graphify/SKILL.md` |

**Update cost on every commit.** The honest ranking: Stack-Graphs-style per-file
isolation ≈ graphify's AST pass (both ~free per changed file, both LLM-free) ≪ SCIP
repo re-index ≪ any LLM semantic pass ≪ GraphRAG community regeneration (~14M tokens).
INFERRED, but each rung is grounded in a verified measurement or design statement.

**Conclusion for Foreman:** the per-commit graph update must be *AST-only and
deterministic*. Any LLM in the per-commit path is a cost and nondeterminism bug.

---

## 4. Agent memory systems: temporality, contradictions, reversibility

| System | Temporal model | Contradiction handling | Reversibility | Measured |
|---|---|---|---|---|
| **Zep / Graphiti** | **Explicit bi-temporal**: every fact/edge carries a validity window (when it became true, when it stopped). Episodes = raw ingested data; every derived fact traces back to an episode | **Automatic fact invalidation** when new data conflicts — old facts are *invalidated, not deleted*; query "what is true now" or "what was true at time T" | Invalidation is non-destructive; history preserved | DMR 94.8% vs MemGPT 93.4%; LongMemEval up to **+18.5% accuracy, −90% latency** (vendor-authored paper, VERIFIED as published) |
| **Mem0 / Mem0-graph** | Extraction + consolidation of salient facts | LLM-driven consolidation | Not documented | LOCOMO: +26% relative vs OpenAI memory (LLM-judge); graph variant only **~+2%** over non-graph base; −91% p95 latency, >90% token savings vs full context. VERIFIED as published |
| **A-MEM** (NeurIPS 2025) | Zettelkasten-style notes with keywords/tags; **memory evolution** — new memories trigger updates to existing notes' attributes | Implicit via evolution | Not documented | VERIFIED |
| **Memanto** (2604.22085) | **Typed schema (13 memory categories) + temporal versioning, deliberately NO knowledge graph** | Automated conflict resolution mechanism | Versioning | LongMemEval **89.8%**, LoCoMo **87.1%**, single retrieval query, **no ingestion cost**, sub-90 ms. VERIFIED as published |
| **Letta/MemGPT** | Paged context + archival memory | — | — | Used as the baseline Zep beats; not separately fetched this lane |

### 4.1 The benchmark warning you must read before believing any of the above

Zep published a detailed rebuttal of Mem0's SOTA claim (VERIFIED, blog.getzep.com, May
2025, updated Jun 2026). Findings:

- Re-run correctly, Zep scores **75.14% ±0.17** on LoCoMo vs the 65.99% Mem0 reported for
  it — ~10% relative better than Mem0's best config.
- Mem0's harness misconfigured the competitor three ways: assigned **both** conversation
  participants to a single user graph; passed timestamps by **appending them to message
  text** instead of the dedicated `created_at` field (defeating temporal reasoning); ran
  searches **sequentially**, inflating reported latency.
- LoCoMo itself is weak: conversations average only 16k–26k tokens; it has **no
  knowledge-update questions** (the one thing agent memory is for); category 5 has missing
  ground truth; multimodal and speaker-attribution errors.
- **The killer line, from Mem0's own numbers: a plain full-context baseline scored ~73%
  vs Mem0's best ~68%.** Feeding the whole conversation beat the specialised memory system.

Two takeaways. (a) Vendor benchmarks in agent memory are not trustworthy; every number in
§4 is a *published claim*, not an independent replication. (b) **If the state fits in
context, memory systems lose.** That belongs in the "against graphs" section and in
Foreman's decision rule.

### 4.2 What to copy

From Graphiti, three ideas are worth copying outright (INFERRED recommendation from
VERIFIED design):
1. **Episodes as the provenance root** — every derived fact points back to the raw
   ingested unit. For Foreman the episode is the `AgentRun` + its `FOREMAN_REPORT.json`.
2. **Invalidate, never delete** — supersession is a validity-window write, not a mutation.
3. **Prescribed *or* learned ontology** — Graphiti supports developer-defined Pydantic
   entity/edge types *and* learned types. The industry hedges on this question; so should
   we (see §6).

---

## 5. Entity resolution: procedure, metrics, false-merge safeguards

### 5.1 Recommended procedure (blocking → cheap scoring → LLM only in the uncertain band)

Grounded in DEG-RAG (2510.14271), LLM-CER (2506.02509), ComEM (2405.16884),
uncertainty-reduction ER (2401.03426), and the Karpathy note §V-D/§IX-G.

1. **Type-partition first.** Never compare across node types (`Entity` vs `Artifact`) or
   across `_origin` (AST-extracted symbol vs LLM-extracted concept). Cheapest and most
   effective false-merge guard there is.
2. **Block** on cheap deterministic signals: normalised label, file path prefix, symbol
   namespace, embedding neighbourhood. DEG-RAG is the first systematic study of blocking
   strategies / embeddings / similarity metrics / merging techniques *for LLM-generated
   KGs* — use it as the design menu rather than inventing one (VERIFIED).
3. **Auto-merge only the high-confidence band**; auto-reject the low band; send **only the
   uncertain band** to an LLM. Uncertainty-reduction ER (2401.03426) formalises this:
   initialise candidate partitions, quantify uncertainty, select the *most informative*
   pairs to spend an LLM call on, update the distribution on the answer.
4. **Prefer clustering/selection over pairwise matching.** LLM-CER clusters records
   directly instead of pairwise: up to **150% higher accuracy, +10% F-measure, 5× fewer
   API calls** at comparable cost (VERIFIED). ComEM finds the **"select"** strategy
   (choose the match from a candidate set) beats binary "match" prompting, and composes
   strategies for cost-effectiveness (VERIFIED, 8 ER datasets × 10 LLMs).
5. **Write the merge as an edge, never as a destructive collapse** (see §5.3).
6. **Denoise relations too.** DEG-RAG pairs entity resolution with *triple reflection*
   (removing erroneous relations). Both halves were needed for the QA gains.

### 5.2 Metrics — and the two that lie

- **Primary: false-merge rate.** Target ≈ 0. This is the metric that matters because a
  false merge "can contaminate many traversals… every downstream query may combine their
  employers, projects, dates, and actions" (Karpathy §IX-G, VERIFIED in source doc).
- Pairwise precision / recall on a hand-built gold set; missed-merge rate; manual review
  rate.
- **Compression ratio: report, never optimise.** The source note is explicit —
  "Compression alone rewards over-merging" (Table III) and "a high compression ratio is
  not automatically good — over-merging creates a connected but false graph."
- **Connected-component count: a two-sided alarm, not a target.** "One component is not
  always desirable" (Table III). A sudden *rise* in isolated nodes signals resolution
  regression; a sudden *fall* signals over-merging (§VII-D).
- **Do not store the LLM's own explanation as evidence.** "Can we trust LLM
  Self-Explanations for ER?" (2606.01210, VERIFIED) — the first large-scale systematic
  evaluation, across 3 LLMs × 10 datasets × multiple prompting strategies, finds
  self-explanations are "**unstable, weakly faithful, and poorly aligned with
  counterfactual evidence**," with a substantial gap between plausibility and causal
  relevance. Store the *blocking features and deterministic score* as the evidence; keep
  the prose rationale as a human-readable note explicitly flagged non-evidential.

### 5.3 Reversibility when resolution decisions live in a versioned store

The scope update asks: revert a commit, or a `RESOLVED_TO` edge with retained aliases?
**Both, layered — and the edge layer is the load-bearing one.** INFERRED design, grounded
in Graphiti's invalidate-don't-delete model and the Karpathy note's "resolution should be
additive and inspectable… incorrect merges can then be reversed without reconstructing the
entire pipeline."

- **Layer 0 — additive resolution (always).** Surface-form nodes are never deleted. A
  merge writes `surface_node -[RESOLVED_TO {run_id, agent_id, method, blocking_features,
  score, valid_from}]-> canonical_node`, and the canonical node retains `aliases[]` and
  `source_docs[]`. Un-merging is a *new* write that sets `valid_to` and
  `invalidated_by=<run>` on the `RESOLVED_TO` edge. Nothing is destroyed; the previous
  belief remains queryable and citable.
- **Layer 1 — store revert (coarse, cheap, situational).** If an entire resolution pass
  was bad, revert its commit. **Precondition: every resolution pass must be its own
  commit on its own branch, never mixed with extraction output or worker artifacts** —
  otherwise reverting the bad merges also reverts unrelated good work. This is a hard
  process constraint on the store integration, not a nice-to-have.
- **Why both.** Store revert cannot selectively un-merge one entity out of a pass of
  10,000 without discarding the other 9,999. `RESOLVED_TO` invalidation can, and preserves
  the audit trail of *what we believed and when we stopped believing it* — which store
  revert erases from the current view. Conversely, `RESOLVED_TO` alone gives no atomic
  "undo the whole bad run."
- **Additional safeguards**: cap merges per pass (a pass that wants to merge 40% of nodes
  is a bug, not a discovery); require the advisor/human on any merge crossing a
  `file_type` or `_origin` boundary; never auto-merge a node that already has ≥N inbound
  `SUPPORTS` edges without review (high-degree nodes do the most damage when wrong);
  alarm on component-count deltas per pass.

---

## 6. Ontology-enforced vs schemaless — what the literature actually says

This is now a live architectural decision, so here is the evidence both ways.

**The field itself treats this as the open axis.** The 2025 survey "LLM-empowered
knowledge graph construction" (2510.20345, VERIFIED) organises the entire literature into
exactly two paradigms: **schema-based** ("structure, normalization, and consistency")
and **schema-free** ("flexibility, adaptability, and open discovery"), and reviews each
across ontology engineering / extraction / fusion. Nobody has declared a winner.

**For enforcement:**
- **ANCHOR** (2606.01208, VERIFIED) is the sharpest data point. It reports that
  **prompt-based schema inclusion fails to scale on large ontologies**, and that what
  actually buys conformance is **SHACL-based validation of type assignments at write
  time**. It outperforms baselines on ontology typing and schema compliance. The lesson is
  precise: *telling the model the schema is not enforcement; validating the write is.*
- **Text2KGBench** (2308.02357, VERIFIED) exists because ontology conformance is
  separately measurable from extraction quality — it defines seven metrics spanning fact
  extraction, **ontology conformance**, and **hallucination**. Its baseline results show
  "room for improvement," i.e. giving an LLM an ontology does not by itself produce a
  conformant graph. Confirms ANCHOR's point from the benchmark side.
- **Ontology-grounded construction under Wikidata schema** (2412.20942, VERIFIED):
  grounding generation in an authored ontology yields "consistency and interpretability"
  and interoperable output.
- **DEG-RAG** (VERIFIED): unconstrained extraction produces redundant entities and
  unreliable relations that must be cleaned post-hoc at real cost. Constraining at write
  time is strictly cheaper than denoising later.
- **Memanto** (VERIFIED): a **typed** 13-category schema with automated conflict
  resolution and temporal versioning — *and no graph at all* — hits 89.8% LongMemEval /
  87.1% LoCoMo, beating hybrid graph systems, with no ingestion cost. Strong evidence that
  **the typing is doing the work, not the graph**.

**Against enforcement (or for hedging):**
- GraphRAG and LightRAG both succeed with open/loose entity typing over arbitrary corpora;
  neither requires a curated ontology. Schema-freedom is what lets them ingest anything.
- **Graphiti ships both** — prescribed types via Pydantic *or* learned types (VERIFIED
  from README). The most mature production temporal-KG engine deliberately refuses to pick.
- Ontology enforcement cannot make claims true. The source note is blunt: "A graph is only
  as good as its sources, extraction prompts, ontology, and resolution policy… it does not
  convert claims into truth" (§IX-F), and "the graph amplifies the ontology and source
  policy" (§IX-H). A wrong ontology, enforced, scales the error.
- No source I found shows schema enforcement *directly* preventing false merges.
  Enforcement constrains **types and predicates**; false merges are an **identity**
  problem, solved by resolution policy (§5), not by SHACL.

**Verdict for Foreman (INFERRED, but I hold it firmly).** Split the decision by plane:

- **Work plane — enforce hard.** `AgentRun`, `Artifact`, `Evaluation`, `Task`, `Commit`,
  `Metric` are produced by Foreman itself, not extracted from prose. Their fields are
  already known (`RUN_ID`, lane, vendor, model, spec digest, verdict, sha). Validation is
  nearly free and catches real bugs — a lane that publishes an `Evaluation` with no rubric
  id or an `Artifact` with no authoring run is a broken lane. This directly implements the
  source note's four write invariants (§Appendix): every claim has a source or is marked
  inference; every artifact has an authoring run and version; every evaluation identifies a
  rubric; every superseded object remains addressable.
- **Knowledge plane — loose types, hard edges.** Let graphify's open relation vocabulary
  (`contains`, `calls`, `defines`, `references`, `imports`, `implements`, `cites`,
  `rationale_for`, `conceptually_related_to`…) stay open. Enforce only on the **decision
  edges** that the evaluator and the ship gate consume: `SUPPORTS`, `CONTRADICTS`,
  `SUPERSEDES`, `RESOLVED_TO`, `DERIVED_FROM`, `PRODUCED`, `EVALUATES`. Those must carry
  full provenance or be rejected. Everything else is advisory context.
- Enforcement mechanism should be **validation at write time** (ANCHOR's finding), not
  "we put the schema in the prompt."

---

## 7. Provenance vocabularies worth adopting

**W3C PROV-O** (VERIFIED — term counts read from the spec). Core: `prov:Entity`,
`prov:Activity`, `prov:Agent`, plus `wasGeneratedBy`, `used`, `wasAttributedTo`,
`wasAssociatedWith`, `wasDerivedFrom`, `wasInformedBy`, `wasRevisionOf`,
`specializationOf`, `alternateOf`, `wasInvalidatedBy`, `invalidatedAtTime`,
`startedAtTime`/`endedAtTime`, and the `qualified*` reification pattern (e.g.
`qualifiedGeneration`) for attaching attributes to a relationship.

Mapping onto the paper's node/edge types — this is a near-perfect fit and we should not
invent our own vocabulary (INFERRED):

| Foreman/paper concept | PROV-O |
|---|---|
| `AgentRun` | `prov:Activity` (`startedAtTime`/`endedAtTime`) |
| worker/auditor model+vendor | `prov:Agent` (`wasAssociatedWith`) |
| `Artifact`, `Claim`, `Metric`, `Source` | `prov:Entity` |
| `PRODUCED` | `wasGeneratedBy` |
| `DERIVED_FROM` | `wasDerivedFrom` |
| `SUPERSEDES` | `wasRevisionOf` (+ `wasInvalidatedBy` / `invalidatedAtTime` for retraction) |
| a specific version of an artifact | `specializationOf` |
| run-to-run causal chain (plan → implement → audit) | `wasInformedBy` |
| per-edge provenance attributes (confidence, run, policy) | the `qualified*` reification pattern |

The important borrow: PROV-O already gives us **invalidation as a first-class relation**.
That is exactly the "supersession without deletion" semantic, standardised since 2013.

**in-toto Attestation Statement v1** (VERIFIED). Shape:
`{_type, subject:[{name, digest}], predicateType, predicate}`. Two properties worth
stealing: **subjects are immutable and matched purely by digest**, and `predicateType`
namespaces the claim so heterogeneous evidence coexists. For Foreman this gives a
content-addressed way to say "this evidence is about *this exact diff*", independent of
whatever store we pick — which means "addressable superseded objects" does not have to
depend on the store's versioning.

**SLSA Provenance v1** (VERIFIED). `buildDefinition{buildType, externalParameters,
internalParameters, resolvedDependencies}` + `runDetails{builder{id, builderDependencies,
version}, metadata{invocationId, startedOn, finishedOn}, byproducts}`.

The mapping onto Foreman is almost embarrassingly direct (INFERRED):

| SLSA field | Foreman |
|---|---|
| `subject[].digest` | the diff / artifact sha the run produced |
| `externalParameters` | the five-part spec + acceptance criteria |
| `resolvedDependencies` | base commit, worktree, tool versions from `env/reference-manifest.toml` |
| `builder.id` | vendor + CLI + model (`grok-4.5 via grok CLI`, `gpt-5.6-sol via codex exec`) |
| `builder.version` | CLI/model version pins |
| `metadata.invocationId` | `RUN_ID` |
| `startedOn` / `finishedOn` | lane wall-clock |
| `byproducts` | `FOREMAN_REPORT.md/.json`, logs, evidence bundle |

**Recommendation:** adopt PROV-O *semantics* for the graph edges, and SLSA/in-toto
*shape* for the `AgentRun` → `Artifact` attestation record. Do not invent a third
vocabulary. SPDX not evaluated (not fetched) — its value would be dependency/licence
lineage, which Foreman does not currently need.

---

## 8. Evidence AGAINST graphs (kept, and it got stronger)

Specific, sourced, and uncomfortable.

1. **The full-context baseline beat the memory system, in the memory vendor's own paper.**
   Mem0's LoCoMo results show a plain full-context baseline at ~73% J-score vs Mem0's best
   ~68% (VERIFIED via Zep's analysis of Mem0's published numbers). If the state fits in
   context, structured memory is a net loss.
2. **Anthropic's own guidance: under ~200k tokens, skip retrieval entirely** — "just
   include the entire knowledge base in the prompt, with no need for RAG or similar
   methods," made cheap by prompt caching (VERIFIED). Foreman's per-task working set —
   a spec, a diff, a report — is usually far under that.
3. **Non-graph retrieval is very strong and very cheap.** Contextual Embeddings +
   Contextual BM25 + reranking: **−67% retrieval failures at $1.02 per million document
   tokens** (VERIFIED). Any graph plane must beat that bar, not just beat naive RAG.
4. **Graph augmentation measurably degrades basic factual retrieval.** HippoRAG 2 states
   plainly that prior KG-augmented RAG drops "considerably below standard RAG" on factual
   memory tasks (VERIFIED).
5. **Retrieval gains don't convert to generation gains.** "Is GraphRAG Needed?" documents
   the retrieval–generation gap and warns that retrieval-oriented metrics **overstate**
   advanced retrieval benefits (VERIFIED). Any "the graph found more edges" success metric
   is suspect by construction.
6. **Refresh cost is brutal at the community-summary layer**: ~14M tokens to regenerate
   community reports on one dataset update (LightRAG measurement), and LazyGraphRAG's claim
   that full GraphRAG indexing is **1000× its own** (VERIFIED both).
7. **A typed store with no graph beat the graph systems.** Memanto: 13 typed categories +
   conflict resolution + temporal versioning, **no KG**, no ingestion cost, sub-90ms —
   89.8% LongMemEval / 87.1% LoCoMo, above the hybrid-graph systems it compared against
   (VERIFIED as published). If this replicates, most of the value we want is in *typing and
   versioning*, and the graph is optional.
8. **A writable shared graph is an exploitable attack surface.** Oracle Poisoning
   (2605.09822, VERIFIED) attacked a **production 42-million-node code knowledge graph**:
   at moderate attacker sophistication **every tested model (9 models, 3 providers) trusted
   poisoned data 100% of the time**, with 269 of 270 valid trials accepting fabricated
   security claims under directed queries. Trust fell to 3–55% only under open-ended
   prompts. Of five defences evaluated, **only read-only access control eliminated the
   direct mutation vector**; the other four were partial and model-dependent. A Foreman
   graph that lanes can write to, and that auditors then reason over, is precisely this
   threat model.
9. **False merges contaminate everything downstream**, and the obvious quality metric
   (compression ratio) actively rewards causing them (Karpathy §IX-G, Table III, VERIFIED).
10. **The audit trail for merges is itself unreliable** — LLM self-explanations for ER are
    unstable and weakly faithful (2606.01210, VERIFIED). You cannot mitigate (9) by asking
    the model to explain itself.
11. **git already answers every lineage question.** `children`, `leaves`, `lineage`,
    `diff` are `git rev-list`, `git log --children`, branch tips, `git diff`. Foreman
    already persists `~/.foreman/runs/<RUN_ID>/` with `FOREMAN_REPORT.json`
    (`foreman.worktree-report.v1`) and `CONSOLIDATED.md`. Re-modelling commit ancestry as
    KG edges buys nothing and adds a sync failure mode. The source note agrees the two
    planes are complementary and "**should not be collapsed**" (§V-A).
12. **The benchmarks in this space are not trustworthy.** The Mem0/Zep dispute shows a
    published SOTA claim resting on a misconfigured competitor and a benchmark with missing
    ground truth, no knowledge-update questions, and 16k–26k-token "long" conversations
    (VERIFIED). Treat every number in §2 and §4 as a vendor claim until replicated.

**The honest summary:** graphs earn their cost for *connected queries over evolving
relations with provenance and shared world state* (the source note's own test, §VIII-C).
They lose to a table, a prompt, or git for everything else. Foreman's graph plane must be
justified query by query, not adopted wholesale.

---

## 9. GAP ANALYSIS — graphify as the mandated extraction substrate

### 9.0 What graphify is, structurally (facts I verified directly)

Read from `/root/foreman/skills/graphify/SKILL.md` and `/root/foreman/graphify-out/graph.json`
on 2026-07-28. (R5 characterises the corpus contents; R7 does package internals — this is
only the schema surface I need for the gap table.)

- Output is a NetworkX node-link JSON: top-level keys `directed`, `multigraph`, `graph`,
  `nodes`, `links`, `hyperedges`, `built_at_commit`.
- **`"directed": false, "multigraph": false`** in the committed graph. Measured: **0
  duplicate `(source, target)` pairs across 3,668 links** — parallel edges are collapsed.
  The skill itself ships a health check for `directed_same_endpoint_collapsed_edges` /
  `undirected_same_endpoint_collapsed_edges`, describing these as "the silent-corruption
  modes of incremental updates."
- Node fields (union over the committed graph): `id`, `label`, `norm_label`, `file_type`,
  `source_file`, `source_location`, `_origin`, `community`, `metadata`, `rationale`,
  `source_url`, `author`, `contributor`, `captured_at`. (`captured_at` populated on 0 nodes
  here — it is for `graphify add <url>` ingestion.)
- Edge fields: `source`, `target`, `relation`, `confidence` (`EXTRACTED` / `INFERRED` /
  `AMBIGUOUS`), `confidence_score`, `source_file`, `source_location`, `context`, `_origin`.
  **No edge `id`.**
- Relation vocabulary is open: `contains` (2835), `calls` (330), `defines` (320),
  `references` (76), `imports` (26), `conceptually_related_to` (21), `implements` (17),
  `rationale_for` (10), `imports_from` (10), `cites` (10), `semantically_similar_to` (7),
  `shares_data_with` (3), `method` (2), `re_exports` (1).
- `hyperedges` is a separate list of `{id, label, nodes[], relation}` — a real n-ary
  grouping primitive.
- AST extraction is **deterministic and LLM-free** (no API key at all for code-only
  corpora); semantic extraction (docs/papers/images) uses Gemini or the host agent.
- `--update` re-extracts only new/changed files, with a per-source-file semantic cache.
- Query surface: `graphify query "<q>"` with BFS/DFS and `--budget N` tokens;
  `graphify path A B`; `graphify explain X`.
- `graph.json` is a single file, rewritten in place, stamped with one `built_at_commit`.

### 9.1 The table

Layer key for the fix: **(a)** upstream graphify extension · **(b)** Foreman-side layer ·
**(c)** delegate to the versioned STORE.
**[STORE-FREE]** marks items a git-like versioned graph database plausibly gives natively
— these materially reduce what we build, and R8's evaluation should confirm each.

| # | Requirement | graphify | Evidence | Owner | Recommendation & tradeoff |
|---|---|---|---|---|---|
| 1 | **Typed node/edge ontology** (Entity, Claim, Source, Artifact, AgentRun, Evaluation, Task, Commit, Metric) | **PARTIAL** | Has `file_type` (code/doc/paper/image/video) + open relation vocab + hyperedges. Has **none** of the work-plane types | **(c)** primary, **(b)** secondary | Define the 9 node / 8 edge types as a **store-enforced ontology**, validated at write (ANCHOR: validation, not prompting, buys conformance). graphify keeps emitting `Entity`/`Source` for code+docs, mapped on ingest. Foreman writes `AgentRun`/`Artifact`/`Evaluation`/`Task`/`Commit`/`Metric` **directly to the store** — they never pass through graphify, because they aren't extracted from files. Tradeoff: two write paths into one store; mitigated because only one (the store) validates |
| 2 | **Per-edge provenance** (source doc, run id, agent id, confidence) | **PARTIAL** | Has `source_file` + `source_location` + `confidence` enum + `confidence_score` + `_origin`. **No `run_id`, no `agent_id`, no model, no timestamp, no policy.** Only a graph-level `built_at_commit` | **(b)** now, **(a)** later, **(c)** partial **[STORE-FREE for run/time]** | Enrich at ingest (Foreman knows `RUN_ID`, lane, vendor, model). Upstream a `--provenance k=v` pass-through so graphify stamps every node/edge it emits. **The store gives run+timestamp for free at commit granularity — but not `agent_id`**, because one Foreman `RUN_ID` fans out to many lanes and they may land in one commit. Keep `agent_id`/`lane` as explicit edge fields regardless of store |
| 3 | **Temporal / bitemporal facts + SUPERSEDES** | **MISSING** | Single current snapshot, rewritten in place. No validity windows. `captured_at` exists but is ingestion-only and unpopulated | **(c)** for transaction time **[STORE-FREE]** + **(b)** for valid time | **Only half of this is free.** A git-like store gives *transaction time* ("what did the graph look like at commit X") natively. It does **not** give *valid time* ("this was true in the world during [t1,t2)") — that is a domain model you must write. Graphiti is the reference: validity windows on edges, facts invalidated not deleted. Recommend `valid_from`/`valid_to`/`invalidated_by` on decision edges (b) + PROV-O `wasRevisionOf`/`wasInvalidatedBy` semantics, riding on store history for the transaction half |
| 4 | **CONTRADICTS / contradiction tracking** | **MISSING** | `AMBIGUOUS` confidence is *extraction* uncertainty, not semantic contradiction. No detection, no edge type | **(b)** — store cannot help | A branch merge conflict is not a semantic contradiction; no store provides this. Foreman's evaluator lane emits `CONTRADICTS` edges when a claim's required evidence path is absent or an opposing edge exists. This is the mechanism behind the source note's structured `{"decision":"revise", "reason":"No supported path…", "required_evidence":[…]}` feedback. Tradeoff: it's an LLM judgement, so it must itself carry provenance and be revisable |
| 5 | **Reversible entity resolution with retained aliases** | **MISSING** | Dedup is by exact node-`id` string plus a `norm_label`. No alias set, no merge record, no rationale, no reversal path | **(b)** primary, **(c)** coarse assist | Build the §5 pipeline Foreman-side: blocking → typed partition → cheap score → LLM only in the uncertain band → `RESOLVED_TO` edge + `aliases[]`, never a destructive collapse. Store revert is the coarse undo, and **requires that every resolution pass be its own commit on its own branch**. Tradeoff: additive resolution grows the node count (surface forms persist) — accept it; the alternative is unrecoverable contamination |
| 6 | **Versioned/immutable artifacts, addressable superseded objects** | **MISSING** | `graph.json` overwritten in place; artifacts not modelled at all | **(c)** **[STORE-FREE]** + **(b)** digests | Strongest single case for the versioned store. Belt-and-braces: content-address artifacts by digest in-toto style so "addressable" survives a store migration. Tradeoff: none worth mentioning — do both |
| 7 | **Incremental update cost per commit** | **PARTIAL — the good news** | `--update` re-extracts only changed files; AST pass is deterministic and **LLM-free**; per-file semantic cache. But clustering + community labelling are **global**, and the single `graph.json` + `built_at_commit` implies a whole-graph rewrite per build | **(b)** policy, **(a)** for incremental relabel | **Per-commit path must be AST-only.** Defer semantic extraction and clustering to a slow cadence (per merge / nightly). This is the Stack Graphs rule — analyse each file in isolation at index time or reanalysis goes quadratic in changed files — and the LightRAG lesson: community regeneration cost ~14M tokens. Upstream ask (a): incremental/partial community relabel. Tradeoff: community labels go stale between cadence runs; acceptable, they are advisory not evidential |
| 8 | **Bounded, token-budgeted subgraph retrieval for per-worker context** | **PARTIAL — closest to done** | `query --budget N` with BFS/DFS, `path`, `explain`. Missing: filter by edge type / confidence / time, per-lane scoping, and **stable edge IDs** (edges have no `id`) | **(b)** primary, **(a)** for edge IDs | Build the context-builder Foreman-side (resolve task entities → expand 1–2 hops over *allowed* edge types → prefer recent verified claims → include known conflicts → serialise within budget → attach citable edge ids). Upstream ask (a): assign stable edge ids. **Also log the traversal, not just the cited edges** — "Why Neighborhoods Matter" shows citations alone are necessary but not sufficient for faithfulness. Tradeoff: none; this is the highest-value Foreman-side component |
| 9 | **Multi-writer concurrency** (many lanes publishing GraphUpdates at once) | **MISSING** | One process rewriting one JSON file. Parallel lanes clobber each other | **(c)** **[STORE-FREE]**, **(b)** interim | Second-strongest case for the store: per-lane branch, merge at consolidate — an exact structural mirror of Foreman's existing worktree model. **Interim that works today without any store**: each lane appends `GraphUpdate` records to `~/.foreman/runs/<RUN_ID>/graph/<lane>.jsonl`; `wt-consolidate` validates and applies them serially. Tradeoff: serial apply is a throughput ceiling, irrelevant at ≤16 lanes. **Semantic** merge conflicts (two lanes assert opposing claims) are *not* solved by branch merge — they become `CONTRADICTS` edges (#4) |
| 10 | **Lineage query surface (children / leaves / lineage / diff)** | **MISSING** for work lineage | graphify queries semantic neighbourhoods; it has no notion of run ancestry | **(b)** thin CLI over git + run dirs | **Do not re-model commit ancestry as KG edges.** git already answers all four; Foreman already has `RUN_ID` dirs and `FOREMAN_REPORT.json`. Store `Commit` nodes as *references* (sha) that other nodes attach to, and let git answer ancestry. The source note is explicit that the commit DAG and knowledge graph "should not be collapsed" (§V-A). If the store is itself git-like, the same four ops come free **for the graph's own history** — a different and also useful thing |
| 11 | **(Found in passing — blocking)** Parallel typed edges between the same node pair | **MISSING / BLOCKING** | `multigraph: false`, `directed: false`; measured 0 duplicate `(source,target)` pairs across 3,668 links; the skill ships a collapsed-edge health check | **(a)** + **(c)** | A claim graph *must* support `SUPPORTS`, `CONTRADICTS`, and `SUPERSEDES` between the same two nodes simultaneously, with different provenance. `--directed` is **mandatory** for us, and multigraph semantics are a **hard requirement** on the store. Verify in R8 that the store is a true property multigraph. Until then, a Foreman-side layer must not round-trip decision edges through an undirected simple-graph `graph.json` — they will be silently collapsed. This is the concrete finding I would escalate first |

### 9.2 Which items the store plausibly gives for free — summary for the architect

**Likely free from a git-like versioned graph store:** transaction-time history and
time-travel (#3 half), versioned/immutable artifacts and addressable superseded objects
(#6), multi-writer concurrency via branch/merge (#9), per-change provenance at commit
granularity (#2 partial), coarse revert for bad resolution passes (#5 partial), and
lineage ops over the graph's *own* history (#10 partial).

**Definitely NOT free, must be built regardless of store:** valid-time/bitemporal
modelling (#3 other half), contradiction detection and `CONTRADICTS` edges (#4), the
entity-resolution pipeline and `RESOLVED_TO`/alias model (#5), per-commit incremental
extraction policy (#7), bounded token-budgeted context construction with traversal logging
(#8), per-lane `agent_id` on edges (#2), and work-lineage answers, which stay in git (#10).

**Must be verified about the store before committing (for R8):** true property-multigraph
semantics with parallel typed edges (#11); whether ontology validation happens at write
time or is advisory (§6/ANCHOR); whether a single commit can carry writes from many lanes
while preserving per-lane attribution; and whether selective revert of one entity's merge
is possible without reverting the whole commit (§5.3 — I expect not, which is why the
`RESOLVED_TO` edge layer is non-negotiable).

---

## 10. Recommendation: minimal viable graph plane for Foreman

Both planes ship, so "minimal viable" now means *the smallest thing that satisfies the
paper's invariants without a per-commit LLM bill*.

### 10.1 Shape

```
  per commit (deterministic, free)      per lane (structured writes)        slow cadence
  ────────────────────────────────      ──────────────────────────────      ────────────
  graphify AST --update --directed  →   GraphUpdate JSONL per lane      →   semantic extract
        │                                 │  (nodes, edges, run_id,          + clustering
        │                                 │   agent_id, evidence)            + community labels
        ▼                                 ▼                                  + ER pass
   knowledge plane  ◄──── validate (schema + provenance + policy) ────►  work plane
                                          │
                          host-side, architect-owned commit to STORE
                                          │
                          agents get READ-ONLY query access
```

Three rules carry most of the value (INFERRED, each grounded above):

1. **No LLM in the per-commit path.** AST only. (LightRAG's ~14M-token refresh; Stack
   Graphs' quadratic-reanalysis warning.)
2. **Agents read the graph; only the host-side consolidate step writes it**, after schema
   + provenance validation. (Oracle Poisoning: read-only access control was the *only*
   defence that eliminated the direct mutation vector; every model tested trusted poisoned
   graph data 100% at moderate attacker sophistication.)
3. **Every write is additive.** Supersede and invalidate; never mutate or delete.
   (Graphiti; PROV-O `wasInvalidatedBy`; §5.3.)

### 10.2 What to store

Work plane (Foreman writes directly, schema enforced):
- `AgentRun` — run_id, lane, role, vendor, model, CLI version, spec digest, started/finished, tokens, cost, exit status
- `Artifact` — path, blob sha, diff sha, worktree, base commit, authoring run
- `Evaluation` — rubric id, verdict, criterion-level defects, auditor identity, cold-diff flag
- `Task`/`Spec` — five-part spec digest, acceptance criteria
- `Commit` — sha **as a reference only**; ancestry stays in git
- `Metric` — name, value, unit, run_id

Knowledge plane (graphify extracts, loose types, hard decision edges):
- `Entity` — code symbols, modules, files (AST, `_origin=ast`)
- `Source` — file+line, or URL + `captured_at`
- `Claim` — assertion text, status, with `SUPPORTS`/`CONTRADICTS` edges to `Source`

Edges with mandatory provenance: `PRODUCED`, `EVALUATES`, `DERIVED_FROM`, `SUPPORTS`,
`CONTRADICTS`, `SUPERSEDES`, `RESOLVED_TO`, `DEPENDS_ON`. Each carries `run_id`,
`agent_id`, `confidence`, `valid_from`, and a source reference or an explicit
`inference=true` marker.

### 10.3 What NOT to store

- **Transcripts and chat logs.** Artifact plane, referenced by digest. ("Store artifacts
  before storing conversations," §VI.)
- **File contents and full diffs.** Store digests + a path into `~/.foreman/runs/<RUN_ID>/`.
- **Commit ancestry edges.** git owns it (§9.1 #10).
- **Per-call token detail.** Aggregate onto `AgentRun`.
- **Semantic entities for generated / vendored / `node_modules` / `skills/superpowers`
  trees.** Extraction noise with negative value; DEG-RAG shows noise costs both quality and
  compute.
- **`INFERRED`/`AMBIGUOUS` edges as first-class evidence.** Keep them, segregate them, and
  exclude them from evaluator grounding by default.
- **LLM prose rationales used as evidence.** Store them flagged non-evidential
  (2606.01210: self-explanations are unstable and weakly faithful).
- **Community summaries as an index-time artifact.** This is the GraphRAG cost trap.

### 10.4 Foreman-side substrate for the layer over graphify (if the store decision slips)

The store choice is R8's. But the Foreman-side layer needs a home *today*, and it should be
designed so the store is swappable:

| Option | Fit | Tradeoff |
|---|---|---|
| **JSONL `GraphUpdate` journal per lane** under `~/.foreman/runs/<RUN_ID>/graph/` | **Recommended as the write path regardless of store.** Append-only, crash-safe, concurrent-safe (one file per lane), trivially diffable, survives any store migration | Not queryable on its own — needs an index |
| **SQLite index built from the journal** | Recommended companion. Single file, zero ops, fast enough at Foreman's scale, ships with Python. AgentHub itself uses SQLite (source note §III-B) | Single-writer; rebuild-from-journal is the recovery story (which is a feature) |
| **Postgres** | Only if multi-host or many concurrent runs | Ops burden Foreman does not currently carry |
| **git-notes** | Tempting for attaching evidence to commits with zero new storage | Poor query surface, merge-conflict-prone, awkward for non-commit-anchored nodes. Use for *pointers*, not as the graph |
| **A versioned graph store (R8)** | The target for everything in §9.2's "free" column | Unknown project health / operational cost — R8's call |

The journal-plus-index design means adopting or dropping the store is a re-materialisation,
not a rewrite. That is worth the small duplication.

### 10.5 Evaluation gates (do not ship the plane without these)

From the source note's Table III and §VII, plus §2.3's warning:
- Extraction: entity/relation F1 on a gold set; schema-valid response rate; cost; latency.
- Resolution: **false-merge rate first**; pairwise P/R; compression ratio *reported, never
  optimised*; component-count delta alarms in both directions.
- Query: answer accuracy **and** cited-path validity — plus the traversal log, since
  citations alone are insufficient (2605.15109).
- Workflow: **task success and wall-clock, not retrieval metrics** — the
  retrieval–generation gap means retrieval metrics will flatter us (2606.25656).
- Ship gate: the plane must beat "put the spec, diff and report in the prompt" on a real
  Foreman task. Given §8.1–8.3, that is a genuinely hard bar and we should expect to fail
  it for single-task context and pass it only for cross-session and cross-lane questions.

---

## 11. Open questions

1. **Does the graph beat prompt-caching + contextual retrieval on any Foreman task?**
   Untested. The evidence in §8 says it will lose on single-task context and can only win
   on cross-session / cross-lane / provenance questions. We should name the three specific
   queries it must win before building, not after.
2. **Is the store a true property multigraph with parallel typed edges?** (§9.1 #11.) If
   not, the whole decision-edge model needs redesign. Highest-priority R8 question.
3. **Can the store attribute a single commit to multiple lanes?** If not, we serialise
   lane commits (fine) or lose per-lane attribution (not fine).
4. **Selective un-merge without reverting a commit** — I assume not possible, hence the
   `RESOLVED_TO` layer. Worth confirming rather than assuming.
5. **Who owns valid-time?** A store gives transaction time. Do we adopt Graphiti-style
   validity windows on every decision edge, or only on `Claim`-bearing edges? Cheaper to
   scope narrowly first.
6. **What is graphify's real per-commit AST update cost on this repo?** I verified the
   design is LLM-free and change-scoped; I did not measure wall-clock. Needs one
   measurement before it goes in a commit hook.
7. **Upstream vs fork for graphify.** Three small asks would remove most Foreman-side glue:
   stable edge IDs, a `--provenance k=v` pass-through, and multigraph/directed defaults.
   Are we willing to upstream and wait, or do we wrap?
8. **Poisoning threat model for a *local* graph.** Oracle Poisoning targets a shared
   production graph. Foreman's is local — but worker lanes are semi-trusted and vendors are
   external. Does read-only-for-agents plus host-side validated commit actually close it,
   or do we also need signed `GraphUpdate` records?
9. **Does Memanto replicate?** If a typed 13-category store with no graph really matches
   graph systems at zero ingestion cost, the honest v0.3 question is whether the knowledge
   plane should be a typed table rather than a graph at all.
10. **Pruning.** The source note flags that a DAG "can also grow without bound and needs
    pruning, archiving, and summarization" (§IX-C). No retention policy is designed. When
    does a `RUN_ID`'s subgraph get archived?
