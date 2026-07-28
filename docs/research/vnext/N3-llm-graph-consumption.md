# N3 — LLM Graph Consumption: Serialization, Retrieval, Citation, and Context Budget

**Lane:** N3 (consumption half of the graph plane) · **Sprint:** Foreman v0.2.9 neurosymbolic research
**Date:** 2026-07-28 · **Sibling lanes:** N1 (landscape), N2 (ontology + competency questions), N4 (symbolic verification)
**Scope:** how an LLM actually *reads* a graph. Not extraction, not ontology design, not verification.

Claims are labelled **[VERIFIED]** (a measured number I read in the cited source, or that I measured myself, with the date) or
**[INFERRED]** (my reasoning across sources; not directly measured by anyone).

---

## 0. Executive answer

1. **Serialization:** there is no universal best format, but the *spread* splits into two very different
   things. **Information layout** (which facts sit next to which) is worth **4.8–88.0 accuracy points**.
   **Surface syntax** (JSON vs Markdown vs Turtle of identical content) is worth **~1.5–10 points on
   frontier models** and shrinks as models get better. Spend your effort on layout; pick surface syntax
   for token cost. Recommended: **subject-grouped arrow DSL with explicit edge IDs** — measured cheapest
   of 13 candidates at **13.7 tokens/edge**, vs 50.0 for JSON-LD expanded (**3.64×**).
2. **Retrieval:** **2-hop bounded candidate generation over a role-scoped edge-type allowlist, then
   relevance-ranked top-K edge selection.** Do *not* serve the k-hop closure itself. PageRank/PPR and GNN
   scoring are both measured to *fail to help or actively degrade*. k=1 is insufficient for multi-hop;
   k≥3 buys almost nothing and explodes the candidate set.
3. **Pre-serialize vs query tools:** **pre-serialize by default; expose tools as an escape hatch.** A
   single-call pre-serialized subgraph matches or beats agentic graph traversal at **1/6–1/8 the LLM
   calls**. Tools only win when the relevant subgraph provably cannot fit the budget.
4. **The uncomfortable one:** graph augmentation is measured to **lose** to zero-cost lexical retrieval
   on true/false and single-fact lookup (BM-25 beats **all 9** GraphRAG systems on GraphRAG-Bench
   True/False; 6 of 9 fall below it on reasoning), and to win on open-ended/multi-hop/synthesis. Route by
   question type. And **stop claiming graphs reduce hallucination** — that number does not exist in this
   literature (§4.2). Claim citation recall and multi-hop accuracy, which we can measure.

---

## 1. Sources fetched

All fetched 2026-07-28 via `scrapling extract` in WSL, saved under `/tmp/neurosym-docs/n3/`
(manifest: `/tmp/neurosym-docs/n3/manifest.tsv`).

| URL | Status | Local file |
|---|---|---|
| https://ar5iv.labs.arxiv.org/html/2310.04560 | 200 | talk-like-a-graph-full.md — *Talk like a Graph* (ICLR'24) |
| https://arxiv.org/html/2305.10037v3 | 200 | nlgraph.md — NLGraph benchmark |
| https://arxiv.org/html/2411.10541v1 | 200 | prompt-formatting-impact.md — *Does Prompt Formatting Have Any Impact* |
| https://arxiv.org/html/2305.13062v4 | 200 | table-meets-llm.md — *Table Meets LLM* (WSDM'24) |
| https://ar5iv.labs.arxiv.org/html/2305.09645 | 200 | structgpt.md — StructGPT |
| https://arxiv.org/html/2410.20724v3 | 200 | subgraphrag.md — *Simple is Effective* / SubgraphRAG |
| https://arxiv.org/html/2502.14902v1 | 200 | pathrag.md — PathRAG |
| https://arxiv.org/html/2307.07697v5 | 200 | think-on-graph.md — Think-on-Graph (ToG) |
| https://arxiv.org/html/2407.10805v2 | 200 | tog2.md — ToG-2 |
| https://arxiv.org/html/2402.07630v3 | 200 | g-retriever.md — G-Retriever |
| https://arxiv.org/html/2310.01061v2 | 200 | reasoning-on-graphs.md — RoG |
| https://arxiv.org/html/2404.16130v2 | 200 | graphrag-microsoft.md — *From Local to Global* |
| https://arxiv.org/html/2410.05779v2 | 200 | lightrag.md — LightRAG |
| https://arxiv.org/html/2501.00309v1 | 200 | graphrag-survey.md — RAG-with-Graphs survey |
| https://arxiv.org/html/2308.11730v3 | 200 | kgp.md — Knowledge Graph Prompting |
| https://arxiv.org/html/2308.09729v5 | 200 | mindmap.md — MindMap |
| https://arxiv.org/html/2408.04948v1 | 200 | hybridrag.md — HybridRAG |
| https://arxiv.org/html/2502.11371v1 | 200 | rag-vs-graphrag.md |
| https://arxiv.org/html/2506.02404v1 | 200 | graphrag-bench.md |
| https://arxiv.org/html/2412.10151v1 | 200 | graphrag-costbenefit.md |
| https://arxiv.org/html/2410.11001v1 | 200 | graphrag-negative.md |
| https://arxiv.org/html/2405.20139v1 | 200 | kg-vs-vector.md |
| https://arxiv.org/html/2503.10150v1 | 200 | kg-agent-mcp.md — HiRAG (hierarchical graph RAG) |
| https://ar5iv.labs.arxiv.org/html/2307.03172 | 200 | lost-in-the-middle.md |
| https://arxiv.org/html/2502.05167v1 | 200 | nolima.md |
| https://research.trychroma.com/context-rot | 200 (301→) | context-rot.md — Chroma, 18 models |
| https://ar5iv.labs.arxiv.org/html/2305.14627 | 200 | alce-citations.md — ALCE |
| https://ar5iv.labs.arxiv.org/html/2212.08037 | 200 | attributed-qa.md — AttributedQA |
| https://arxiv.org/html/2311.07914v2 | 200 | kg-hallucination-survey.md |
| https://arxiv.org/html/2407.16833v1 | 200 | longcontext-vs-rag.md |
| https://aclanthology.org/2024.findings-acl.11/ | 200 | graph-cot-acl.md (abstract only) |
| https://raw.githubusercontent.com/PeterGriffinJin/Graph-CoT/main/README.md | 200 | graph-cot-readme.md |

**Failures / partials (recorded explicitly):**

| URL | Status | Note |
|---|---|---|
| https://arxiv.org/html/2310.04560v3 | 404 | Pre-Dec-2023 paper; no arXiv HTML. Recovered via ar5iv. |
| https://arxiv.org/html/2307.03172v3, v4 | 404 | Same; recovered via ar5iv. |
| https://arxiv.org/html/2305.14627v2, v3 | 404 | Same; recovered via ar5iv. |
| https://arxiv.org/html/2305.09645v2, v3 | 404 | Same; recovered via ar5iv. |
| https://arxiv.org/html/2404.07103 (v1/v2/v3) | 200 but **partial** | Graph-CoT LaTeXML render is broken — only the appendix survives; **no results table obtainable**. ACL page gives abstract only. Graph-CoT is therefore cited qualitatively only. |
| https://arxiv.org/html/2503.04338v1 | 404 | Guessed ID, wrong paper. Dropped. |

---

## 2. Serialization format — measured

### 2.1 The finding that reframes the question

The literature does **not** support "format X is best." It supports a split:

- **Information layout** — *which facts are adjacent in the token stream* — is worth enormous swings.
- **Surface syntax** — *the punctuation around identical adjacency* — is worth single digits on frontier models.

**[VERIFIED]** *Talk like a Graph* (arXiv 2310.04560, ICLR'24), PaLM 62B on GraphQA, 9 graph encoders ×
6 tasks × 5 prompting methods. Best-minus-worst encoder spread ranges **4.8 points** (edge count,
zero-shot) to **61.8 points** (node degree, cot-bag) — the paper's own headline is
*"the correct choice of encoders can boost performance on graph reasoning tasks inside LLMs by 4.8% to
61.8%, depending on the task."* Concrete case: zero-shot "connected nodes" — **adjacency encoding 19.8%
vs incident encoding 53.8%** (a 34.0-point gap from serialization alone, same graph, same question).

**[VERIFIED]** The spread *grows* with model scale in that paper, contradicting the common assumption.
Zero-shot "connected nodes" best-minus-worst encoder: PaLM 2-XXS **16.0** → PaLM 2-S **58.2** →
PaLM 2-L **88.0** (Incident 88.0 vs Social Network 0.0). Meanwhile zero-shot cycle check at PaLM 2-L has
a spread of only **0.6** (every encoder saturates ~83). Bigger models exploit a *good* layout harder; they
do not rescue a *bad* one.

**[VERIFIED]** Surface-syntax spread, by contrast, shrinks with scale. *Table Meets LLM* (arXiv
2305.13062, WSDM'24), 5 formats (NL+Sep / Markdown / JSON / XML / HTML) × 7 structural-understanding
tasks: max spread **28.00 points on GPT-3.5** (column retrieval: HTML 63.33 vs Markdown 35.33) →
**10.31 points on GPT-4** (size detection). On the five *downstream* tasks the max spread is only
**4.89 points** — while the GPT-3.5→GPT-4 model jump at fixed format is worth **+9.39** on HybridQA,
roughly 2× the entire format spread.

**[VERIFIED]** *Does Prompt Formatting Have Any Impact* (arXiv 2411.10541, Microsoft) confirms the scale
effect and adds a warning. Coefficient of Mean Deviation across formats: GPT-3.5 series **0.035–0.176**;
GPT-4-1106-preview **<0.036**; GPT-4-32k **≤0.043**. But format *preference inverts by model*: MMLU,
JSON 59.71 vs Markdown 50.02 on GPT-3.5-turbo (**+9.68 for JSON**); Markdown 81.25 vs JSON 73.92 on
GPT-4-1106 (**−7.33 for JSON**). IoU of top-format sets **between model series is often below 0.2**;
within a sub-series **above 0.7**. And robustness-at-scale has catastrophic exceptions: GPT-4-32k on
HumanEval scores **76.2 with plain text and 21.95 with JSON** (the model emitted chain-of-thought prose
instead of code).

**[VERIFIED]** For KG-path serialization specifically, ToG's own ablation (arXiv 2307.07697, Table 4)
compares three renderings of the same retrieved reasoning paths:

| Representation | CWQ | WebQSP |
|---|---|---|
| **Triples** | **58.8** | **76.2** |
| Sequences | 57.2 | 73.2 |
| Sentences (NL) | 58.6 | 73.0 |

Triples beat NL sentences by **+3.2 on WebQSP, −0.2 on CWQ**. Small but consistent, and it is the closest
thing in the literature to a direct triples-vs-verbalization test on a knowledge graph.

**[VERIFIED]** Verbalization does *not* win in general. *Table Meets LLM* §5.2.1: HTML beats NL+Sep by
**6.76%** overall, attributed to code/web pretraining exposure. NLGraph's one verbalization ablation
(cities/roads/distances vs abstract nodes/edges) is **mixed**: +9.44 (CoT easy) to −7.00 (zero-shot hard);
the paper's verdict is *"the results are mixed as to which is easier or harder."*

**[VERIFIED]** *Talk like a Graph* does find one clean rule: **integer node names help arithmetic-output
tasks** (node degree, node count, edge count — "the input and output of the LLM are then in the same
space"), while **real-name encodings help boolean/semantic tasks** (GOT 49.0 on edge existence;
Friendship 82.0 on cycle check vs Adjacency 71.6).

### 2.2 Token cost — my own measurement

Nothing in the five serialization papers reports a single token count per format. So I measured it.

**[VERIFIED 2026-07-28]** Script: `/tmp/neurosym-docs/n3/tokcost.py`. Input: a hand-built, realistic
Foreman task subgraph — **30 edges** spanning the work-DAG plane (spec, agent_run, commit, evaluation)
and the knowledge plane (claim, entity, ADR, source), including a superseded claim and a conflict edge.
Rendered into 13 formats; counted with `tiktoken` `o200k_base` (GPT-4o/5 family) and `cl100k_base`.

| Format | o200k tokens | cl100k | chars | ×cheapest | **tok/edge** |
|---|---|---|---|---|---|
| **Arrow DSL, subject-grouped** | **412** | 413 | 1156 | **1.00** | **13.7** |
| Plain JSON, node-nested | 426 | 428 | 1279 | 1.03 | 14.2 |
| Arrow DSL, flat | 443 | 444 | 1326 | 1.08 | 14.8 |
| YAML w/ edge-id comments | 489 | 492 | 1276 | 1.19 | 16.3 |
| NL verbalization | 495 | 495 | 1626 | 1.20 | 16.5 |
| Plain JSON edge list (minified) | 501 | 474 | 1538 | 1.22 | 16.7 |
| JSON-LD compact | 502 | 503 | 1613 | 1.22 | 16.7 |
| Markdown table | 513 | 515 | 1592 | 1.25 | 17.1 |
| Turtle (prefixed) | 521 | 521 | 1437 | 1.26 | 17.4 |
| N-Triples (full IRIs) | 928 | 932 | 2796 | 2.25 | 30.9 |
| Cypher CREATE | 969 | 975 | 2526 | 2.35 | 32.3 |
| Plain JSON edge list (pretty) | 1192 | 1194 | 2949 | 2.89 | 39.7 |
| JSON-LD expanded | 1500 | 1504 | 4779 | **3.64** | 50.0 |

Ratios that matter for the budget:

- **Full spread 3.64×.** At a 2,000-token graph budget that is **146 edges vs 40 edges** — a 3.6× difference
  in how much of the graph the worker can see, for zero difference in information content.
- **Pretty-printing plain JSON costs 2.8×** (14.2 → 39.7 tok/edge). This is the single cheapest win available.
- **Full IRIs cost 2.25×** vs prefixed Turtle at 1.26×. If we ever emit RDF into a prompt, prefix it.
- **NL verbalization is cheap (1.20×), not expensive.** The common assumption that verbalization blows the
  budget is wrong at this scale — it costs ~20% more than the tersest DSL. Its real cost is elsewhere
  (see §5: verbalized prose is harder to attach stable citable IDs to).
- **Edge IDs are nearly free.** The cheapest format in the table *already carries a per-edge ID*.

**Caveat [INFERRED]:** these ratios come from one 30-edge subgraph with Foreman-shaped identifiers. Long
free-text object values (claim text, defect descriptions) compress the *relative* differences, because
the payload dominates the syntax. Expect the spread to narrow toward ~2× on text-heavy subgraphs. The
ordering is stable; the magnitude is not.

### 2.3 Serialization recommendation

**Use subject-grouped arrow DSL with explicit edge IDs.** Measured cheapest (13.7 tok/edge); carries
citable IDs at no extra cost; groups facts by subject, which is *incident-style layout* — the encoding
that won the structural-lookup tasks in *Talk like a Graph* by up to 34–88 points.

```
spec_7:
  e01 -title-> Add retry policy to UmbraDB sync worker
  e02 -status-> in_progress
  e03 -depends_on-> spec_4
agent_run_183:
  e06 -vendor-> grok-4.5
  e07 -produced-> claim_441
```

**Rejected and why:**

| Format | Reason |
|---|---|
| JSON-LD expanded | 3.64× token cost; no measured accuracy benefit anywhere in the corpus |
| N-Triples with full IRIs | 2.25× cost; flat layout loses the incident-grouping advantage |
| Pretty-printed JSON | 2.8× cost vs the identical nested structure |
| Cypher CREATE | 2.35× cost; a write DSL, not a read format |
| Pure NL verbalization | ToG measured −3.2 vs triples on WebQSP; *Table Meets LLM* measured −6.76 vs HTML; and prose resists stable per-edge IDs |
| Markdown table | Only 1.25× — acceptable fallback, and the flat s/p/o layout is *worse* for structural lookup than subject grouping |

**Do not over-tune this.** Foreman's workers are frontier CLI agents (Grok 4.5, GPT-5.6 Sol, Gemini).
For that class, the measured surface-syntax spread is **~1.5–10 points**, non-transferable across vendors
(IoU < 0.2 between model families), and it *inverts* — GPT-3.5 preferred JSON, GPT-4 preferred Markdown.
Any format we hard-code will be wrong for some vendor. **[INFERRED]** The correct engineering posture is:
pick the cheap layout-correct format, make it a single swappable serializer function, and *measure per
vendor* rather than argue about it. This is exactly the "query serializer as the optimized artifact"
idea in §VII-A of the source paper, and the evidence supports it.

---

## 3. Retrieval strategy — measured

### 3.1 Head-to-head evidence

**[VERIFIED]** SubgraphRAG (arXiv 2410.20724, ICLR'25) is the most directly useful study. It compares
retriever designs on WebQSP and CWQ (Freebase), holding the reasoner fixed:

- **Relevance-scored individual triple selection beats constrained path search.** Against GPT-4o-labelled
  relevant triples, RoG's path-search recall drops **45.6% (WebQSP) / 52.2% (CWQ)** relative to its
  shortest-path recall, while SubgraphRAG moves **−2.0% / +3.6%**. Same training signal; the difference is
  that path search cannot express non-path subgraphs.
- **Personalized PageRank fails.** *"PPR fails to reliably yield improvements."* Seeded from topic
  entities, added on top of an MLP + topic-entity retriever, across the whole K sweep.
- **GNN scoring is worse than an MLP.** *"GNN variants often result in performance degradation compared
  to their MLP counterparts. We suspect that the diffusion of semantic information introduces noise in
  triple selection."*
- **A topic-entity indicator always helps.** *"the topic entity indicator invariably leads to an improvement."*
- **Directional distance encoding (hop distance from each seed, with direction) beats both GNNs and
  one-hot topic encoding.**
- Efficiency: SubgraphRAG is **one to two orders of magnitude faster** than GNN-RAG and other baselines.

**[VERIFIED]** PathRAG (arXiv 2502.14902) states the governing principle explicitly: *"the limitation of
current graph-based RAG methods lies in the **redundancy** of the retrieved information, rather than its
insufficiency."* Its measured ablations, as GPT-4o-mini-judged win rates over six corpora:

| Comparison | Flow-based (relevance-pruned) win rate |
|---|---|
| vs **Random** path selection | 50.81% – 70.16% (median ~55%) |
| vs **Hop-first** ordering | 50.41% – 64.00% (median ~56%) |
| **Path-based** vs **Flat** prompt organization | 50.41% – 62.81% for path-based |

Two separate results there: (a) relevance-scored selection beats hop-distance-ordered selection, and
(b) *keeping paths intact in the prompt* beats decomposing them into an unordered node/edge soup.

**[VERIFIED]** PathRAG's hyperparameter sweep gives the turnover point: average win rate **peaks at
K=15 paths and drops at K=25**. On node count N, *"as N continues to increase, the retrieved nodes are
less relevant to the question and negatively impact the performance."*

**[VERIFIED]** ToG (arXiv 2307.07697) sets search depth and beam width to **3** by default, noting
*"the computational cost increases linearly with the depth"* and *"the performance growth diminishes when
the depth exceeds 3 … only a small part of questions have reasoning depths greater than 3."*

### 3.2 What k actually helps

**[VERIFIED]** k=1 is measurably insufficient for multi-hop. SubgraphRAG's hop breakdown: *"while the
cosine similarity baseline and RoG demonstrate competitive performance for single-hop questions, their
performance degrades significantly for multi-hop questions."* StructGPT's largest gain is exactly at
2 hops: MetaQA-2hop ChatGPT **31.0 → 93.9 Hits@1 (+62.9)**.

**[VERIFIED]** But 2 hops is already where the *model* starts struggling, independent of retrieval.
NoLiMa (arXiv 2502.05167), Llama 3.3 70B, one-hop vs two-hop association at matched context length:

| Context | one-hop | two-hop |
|---|---|---|
| 4K | 90.3 | 70.7 |
| 8K | 84.1 | 57.4 |
| 16K | 73.2 | 42.7 |
| 32K | 56.2 | 25.9 |

With chain-of-thought, *"two-hop examples with CoT prompting barely achieve the scores of one-hop
examples without CoT."* **[INFERRED]** Implication for us: the retriever should do the hop, not the
worker. If a fact is 2 hops from the task's entities, *pull it into the served subgraph as a direct
edge list* rather than making the worker chain it — the worker's 2-hop reliability is ~60–70% of its
1-hop reliability even in a short context.

**[VERIFIED]** ToG: >3 hops is rarely needed and cost grows linearly with depth.

**Verdict on k [INFERRED, from the above]:** **k=2 as the candidate-generation bound; never as the
serving set.** k=1 misses multi-hop evidence; k=3 multiplies the candidate set by the branching factor
for a measured near-zero return (ToG's diminishing growth past depth 3). The 2-hop closure is then
**relevance-ranked down to a fixed edge budget** — this is where all the measured gain lives, not in
the hop count.

### 3.3 Selection method ranking

Ordered by measured support in this corpus:

| Method | Verdict | Evidence |
|---|---|---|
| **Edge-type allowlist** (filter before expansion) | **Use — first** | Universally applied in the corpus to shrink candidates; SubgraphRAG, ToG, RoG all constrain relation sets. Cheapest possible filter; cuts branching factor before scoring. *(No paper isolates its effect size — **[INFERRED]** priority.)* |
| **Entity linking from task text** | **Use — mandatory** | Step 1 in SubgraphRAG, ToG, StructGPT, RoG. SubgraphRAG: topic entities *"provide valuable inductive bias."* Topic-entity indicator *"invariably"* improves scoring. |
| **Relevance-scored top-K triple selection + directional distance features** | **Use — the core mechanism** | SubgraphRAG: beats path search, GNNs, PPR, and cosine-only, 1–2 orders of magnitude faster than GNN-RAG |
| **Path-based retrieval / path-preserving layout** | **Use for presentation** | PathRAG: path-based prompt organization beats flat organization on 5/5 dimensions across 6 corpora. Note: paths as *layout*, not as the retrieval constraint (SubgraphRAG shows path-*search* is too restrictive) |
| **Hybrid vector + graph** | Use where text is attached | HybridRAG, LightRAG, HiRAG all combine; see §4 |
| **Community-based selection** | Only for global/summary queries | GraphRAG's community summaries target corpus-level "global" questions, not task-specific lookup; see §4 |
| **PageRank / PPR centrality** | **Do not use as primary** | SubgraphRAG: *"PPR fails to reliably yield improvements"* |
| **GNN-based scoring** | **Do not use** | SubgraphRAG: *"GNN variants often result in performance degradation compared to their MLP counterparts"* |
| **Uniform k-hop expansion as the serving set** | **Do not use** | PathRAG: redundancy, not insufficiency, is the binding constraint; flow-based beats hop-first |

---

## 4. KG-augmented generation: effect sizes, including nulls

### 4.1 Where graph grounding measurably helps, and by how much

**[VERIFIED]** StructGPT (arXiv 2305.09645), iterative structured-data reading vs putting the whole
structure in the prompt, gain in points:

| Task | Baseline → +StructGPT | Δ |
|---|---|---|
| MetaQA-2hop (ChatGPT, Hits@1) | 31.0 → 93.9 | **+62.9** |
| MetaQA-1hop (Davinci-003) | 52.1 → 94.4 | +42.3 |
| WebQSP (Davinci-003) | 48.3 → 71.9 | +23.6 |
| WebQSP (ChatGPT) | 61.2 → 72.6 | +11.4 |
| WTQ TableQA (ChatGPT) | 43.3 → 48.4 | +5.1 |
| Spider text-to-SQL (ChatGPT) | 70.1 → 74.8 | +4.7 |
| WikiSQL (Davinci-003) | 49.1 → 51.8 | +2.7 |
| Spider-SYN (Davinci-003) | 60.1 → 60.3 | **+0.2** |
| **TabFact (Davinci-003)** | 80.7 → 76.5 | **−4.2** |

The gradient is the point: **the gain is largest exactly where the full structure cannot fit the prompt,
and collapses to ~0 or negative where it can.** MetaQA-2hop (+62.9) is a knowledge graph too large to
serialize; TabFact (−4.2) is a table that already fits.

**[VERIFIED]** ToG vs a chain-of-thought baseline on the same LLM (Table 3): CWQ **37.6 → 58.8**
(+21.2), WebQSP **62.0 → 76.2** (+14.2) with Freebase. With WikiData instead: CWQ 54.9, WebQSP 68.6 —
i.e. **the same method loses 3.9–7.6 points purely from KG choice.** Graph grounding is only as good as
the graph.

**[VERIFIED]** SubgraphRAG + GPT-4o reaches WebQSP Macro-F1 **76.46** / Hit **89.80** and CWQ
**59.08 / 66.69**, vs a G-Retriever baseline at 53.41 / 73.46 — but note the reasoner is doing much of
that work (SubgraphRAG + Llama3.1-8B on the *same retrieved subgraph* gets CWQ 47.16 F1 vs GPT-4o's
59.08). **[INFERRED]** Retrieval quality and reasoner quality are not additive; a better subgraph does
not rescue a weaker worker.

### 4.2 Hallucination reduction — the number does not exist

**[VERIFIED — as a negative finding about the evidence base]** The *Can Knowledge Graphs Reduce
Hallucinations in LLMs?* survey (arXiv 2311.07914) contains **no measured hallucination-rate reduction
anywhere.** Its Table 1 is a qualitative attribute matrix with **no performance column at all**. The
entire survey contains four percentage figures, all secondhand accuracy numbers, two without a stated
baseline:

- *"enhanced answer correctness by over 80% for question-answering tasks"* — relative, small LLMs, no single dataset named
- RoG: ChatGPT **66.8 → 85.7** on KGQA reasoning (+18.9 pts) — secondhand
- MindMap: **88.2%** on clinical diagnosis — no baseline given

**[INFERRED]** So: when Foreman's design docs claim "the graph reduces hallucination," that claim is
currently **unsupported by measured evidence in the KG-RAG literature**. What *is* measured is
*attribution* — whether the model's statements are supported by the retrieved evidence (§5) — and
*accuracy* on multi-hop QA. Those are the metrics we can actually defend. We should stop saying
"reduces hallucination" and start saying "raises citation recall / multi-hop accuracy," which we can
measure.

### 4.3 Nulls and reversals

- **[VERIFIED]** StructGPT TabFact **−4.2**; Spider-SYN **+0.2** — graph/structure machinery is a net
  loss when the data already fits the prompt.
- **[VERIFIED]** ToG on WikiData underperforms ToG on Freebase by **3.9–7.6 points** on the same
  questions — a graph-quality effect larger than most method deltas in this literature.
- **[VERIFIED]** *Talk like a Graph*: on the **disconnected nodes** task, accuracy is **0.5%
  (zero-shot) and ≈0.0% for zero-CoT, few-shot, CoT and CoT-BaG.** The paper's conclusion:
  *"LLMs lack a global model of a graph."* **[INFERRED]** Directly relevant to us: a worker cannot be
  asked "what is *not* connected to X" or "what is missing" by staring at a serialized subgraph. Absence
  questions must be answered by a **query**, not by the model's reading.
- **[VERIFIED]** NLGraph: on Hamilton path and bipartite matching, **zero-shot beats few-shot**, and
  few-shot *underperforms* zero-shot by **1.00–10.48%**. On topological sort and max flow, *"CoT, CoT+SC,
  and LtM prompting generally underperform few-shot prompting."*
- **[VERIFIED]** NLGraph brittleness: on connectivity, swapping the general graph distribution for a
  chain distribution drops CoT from **85.33 → 40.83 (−44.50)** and CoT+SC from 82.67 → 44.17 (−38.50).
  The paper's diagnosis is that LLMs count node mentions rather than trace paths. **[INFERRED]** Any
  Foreman evaluator that asks a worker to *verify* graph structure (rather than use it) is building on
  sand — that is N4's job, with a symbolic checker.
- **[VERIFIED]** NLGraph GNN-simulation task: zero-shot **0.00**, few-shot **0.00**, zero-CoT **0.00**.

### 4.4 The benchmark that should worry us most

**[VERIFIED]** GraphRAG-Bench (arXiv 2506.02404) evaluates **9 GraphRAG systems** on 1,018 questions over
a 7M-word corpus (20 textbooks, 16 CS disciplines), GPT-4o-mini, top-k=5, chunk 1200. **Important scoping
correction: its baselines are GPT-4o-mini with no retrieval, TF-IDF, and BM-25 — all sparse/lexical.
It never ran a dense retriever, so it is a graph-vs-lexical study, not graph-vs-vector.** That makes the
result *sharper*, since the baselines cost zero LLM tokens to build.

| Question type | Best baseline | Graph systems that LOSE to it |
|---|---|---|
| **True/False** | BM-25 **84.49** | **all 9** (best graph 82.59, −1.90; worst DALK 77.22, **−7.27**) |
| **Multi-choice** | bare LLM **81.11** | **8 of 9** (only MSFT GraphRAG +0.46; worst G-Retriever −3.69) |
| **Fill-in-blank** | bare LLM **74.29** | **7 of 9** (LightRAG 65.24 = **−9.05**) |
| **Multi-select** | bare LLM **76.68** | **6 of 9** |
| **Open-ended** | BM-25 50.00 | **0 of 9** — graph wins here: HippoRAG 56.13 (**+6.13**), RAPTOR 54.83, ToG 54.28. Both sparse baselines *hurt* on this type (TF-IDF −2.05, BM-25 −2.23 vs bare LLM) |
| **Reasoning (AR)** | BM-25 **44.15** | **6 of 9** (DALK 42.12, KGP 42.22, GraphRAG 43.30, G-Retriever 43.66, LightRAG 43.81, ToG 44.01). Best graph method beats BM-25 by **+1.38** (RAPTOR) |

**[VERIFIED]** Cost of that +1.38: RAPTOR spent **10.1M construction tokens and 20,396s of indexing**.
Worse: **LightRAG spent 83.9M tokens + 12,976s and scored 71.22 — below TF-IDF's 71.71.** MSFT GraphRAG
spent **79.9M tokens for +0.79 over TF-IDF ≈ 101M tokens per accuracy point.** *(GraphRAG-Bench reports
no cost column for the baselines, so an exact ratio is not computable — but sparse retrieval has zero
LLM construction cost by construction.)*

**[VERIFIED]** GraphRAG-Bench also measures graph quality directly: KGP's passage graph has only
**46.03% non-isolated nodes (~54% isolated)**, and the *richer* extractors are **worse** connected
(GraphRAG 72.51%, LightRAG 69.71%) than plain KG methods (~90%), because richer extraction *"inevitably
introduces more noise."*

**[VERIFIED]** HybridRAG (arXiv 2408.04948), financial earnings-call transcripts — the one study that
scores GraphRAG against VectorRAG on attribution metrics:

| Metric | VectorRAG | GraphRAG | HybridRAG |
|---|---|---|---|
| Faithfulness | 0.94 | **0.96** | 0.96 |
| Answer relevance | 0.91 | **0.89** ⚠ | **0.96** |
| Context precision | 0.84 | **0.96** | 0.79 ⚠ |
| Context recall | **1.00** | **0.85** ⚠ | 1.00 |

**GraphRAG loses to plain vector RAG on answer relevance (−0.02) and badly on context recall (−0.15).**
It wins on faithfulness (+0.02) and context precision (+0.12). The paper's own split: *"GraphRAG performs
better in extractive questions compared to VectorRAG. And VectorRAG does better in abstractive questions
where information is not explicitly mentioned in the raw data."*

**[VERIFIED]** *RAG or Long-Context LLMs?* (arXiv 2407.16833): **long context consistently beats RAG**
for all three models tested — Gemini-1.5-Pro avg **LC 49.70 vs RAG 37.33 (+12.37)**. Their Self-Route
hybrid recovers **46.41 at 38.39% of the tokens**, and the paper reports cost *"reduced by 65% for
Gemini-1.5-Pro."* The exception is the two longest datasets (∞Bench En.QA/En.MC, ~147k words) where RAG
beats LC for GPT-3.5-Turbo.

**[INFERRED]** The pattern across §4.1–4.4 is consistent and it is the single most important input to
Foreman's design: **graph structure pays on multi-hop, open-ended and synthesis questions, and loses on
single-fact lookup and true/false — at 10M–84M tokens of construction cost.** Foreman's worker tasks are
overwhelmingly the *first* kind (what depends on this, what conflicts with this, what did the previous
run conclude), which is the regime where graph grounding is measured to win. But our *auditor* checks are
often the second kind (does edge e07 say X), and for those the evidence says a lexical lookup beats a
graph pipeline. **Route by question type, not by ideology.**

---

## 5. Citation and grounding mechanics

This section matters most for the source paper's stated goal — an evaluator that finds **missing or
contradictory edges** — because that evaluator is worthless if citations are not faithful.

### 5.1 The single most important measured result

**[VERIFIED]** ALCE (arXiv 2305.14627), ASQA. Compare **inline citation during generation** against
**post-hoc citation attachment** (ClosedBook + PostCite: generate from parametric memory, then find the
best-matching passage among 100 retrieved and attach it):

| System | Correctness (EM Rec.) | Cite Recall | Cite Precision |
|---|---|---|---|
| ChatGPT Vanilla (inline, 5 passages) | 40.4 | **73.6** | **72.5** |
| ChatGPT ClosedBook + **PostCite** | 38.3 | **26.7** | **26.7** |

**Correctness barely moves (−2.1). Citation recall collapses by 46.9 points.** The paper's own diagnosis:
*"ClosedBook often generates texts that are correct but not similar to any retrieved passages, making it
difficult to match a citation post-hoc."*

AttributedQA (arXiv 2212.08037) reproduces this architecturally: retrieve-then-read (the attribution is
the passage the reader actually conditioned on) scores **65.5 AIS**; post-hoc retrieval scores
**55.6 AIS** — a ~10-point gap — and concludes *"attribution is more difficult in a post-hoc setting
than in RTR."*

**[INFERRED]** For Foreman this is decisive: **edge IDs must be present in the worker's context at
generation time and cited inline as the worker writes.** Any design where a worker produces a diff/report
and a later pass tries to attach graph provenance will produce citations that are ~2.7× less faithful
while looking equally correct. This validates step (7) of the source paper's context-builder — and shows
*why* it is not optional.

### 5.2 What raises citation quality — measured knobs

**[VERIFIED]** All ALCE, ASQA, ChatGPT, cite recall / precision:

| Knob | Effect |
|---|---|
| Full citation instruction vs short instruction | 73.6/72.5 vs 69.6/73.2 — **+4.0 recall**, precision flat |
| Number of demonstrations 0 / 1 / 2 | recall **69.3 → 74.6 → 73.6** — *"at least one demonstration ensures high citation recall"*; correctness flat |
| **Best-of-4 rerank by automatic citation recall** | 73.6/72.5 → **84.8/81.6** on ASQA; 51.1/50.0 → **69.3/67.8** on ELI5. Human eval confirms the gain is real (74.7 → 79.3 human recall) |
| **Summarizing/compressing the evidence** | Vanilla 73.6/72.5 → Summ 68.9/61.8 → Snippet 65.3/57.4 — **costs 8–15 points of citation precision** (correctness *rises*) |
| Retrieving mid-generation (InlineSearch) | 73.6/72.5 → **58.3/58.2** — hurts both |
| Base-model instruction tuning | LLaMA-13B **10.6/15.4** → Vicuna-13B 51.1/50.1 → LLaMA-2-Chat-70B 62.9/61.3 |

**[INFERRED]** Two direct design rules: **(a) never summarize the served subgraph — serve edges
verbatim with their IDs** (compression buys correctness and sells the exact property we need);
**(b) include at least one worked citation demonstration** in every worker prompt.

### 5.3 The faithfulness ceiling — and why we must verify

**[VERIFIED]** Even the best configurations do not reach reliable citation:

- ALCE abstract: *"on the ELI5 dataset, even the best models lack complete citation support **50% of the
  time**"*; *"around 50% generations of our ChatGPT and GPT-4 baselines are not fully supported by the
  cited passages."*
- Best ASQA numbers ~73.6/72.5 (ChatGPT), 68.5/75.6 (GPT-4, 5 passages).
- QAMPARI best is **27.4 recall / 28.5 precision** (GPT-4, 20 passages).
- **Human utility scores are flat while citation quality varies hugely** — 3.7–3.9 (ASQA), 3.5–3.6 (ELI5)
  across models whose citation recall spans **13.6 → 83.9**. Fluent, useful-looking output tells you
  nothing about whether the citations are real.

**[VERIFIED]** Citation metrics are trivially gameable: ALCE's control that copies the top-1 retrieved
passage verbatim and cites itself scores **99.4 recall / 99.4 precision** with 20.8 fluency and 35.1
correctness.

**[VERIFIED]** Automatic citation evaluation is only moderately reliable: Cohen's κ vs human,
**0.698 for citation recall (substantial), 0.525 for citation precision (moderate)**; accuracy vs human
gold **85.1% recall / 77.6% precision**. AttributedQA warns that system-level AIS-vs-AutoAIS correlation
is 0.96 but *"instance-level correlation was much lower and more variable … care should be taken against
reading individual AutoAIS scores too closely."*

**[INFERRED]** Consequences for Foreman's "missing or contradictory edge" evaluator:

1. **Never treat a worker's citation as evidence.** At a ~72% precision ceiling, roughly 1 in 4 cited
   edges is wrong.
2. **But we have something ALCE does not: the citation target is a database row, not a paragraph.**
   Verifying "does edge `e07` exist, and does it say what the worker claims" is a **deterministic
   lookup**, not an NLI judgement. We should exploit this hard — it converts the weakest link in the
   attribution literature into a cheap exact check.
3. **Three deterministic checks, all O(1) per citation:** (i) cited ID exists at all → else hallucinated
   ID; (ii) cited ID was in the *served* subgraph → else the worker invented or recalled it;
   (iii) every load-bearing claim carries ≥1 citation → else unsupported.
4. **"Contradictory" and "missing" are graph queries, not model judgements.** *Talk like a Graph*'s
   disconnected-nodes result (≈0.0%) says a model cannot reliably detect absence by reading. Detect
   missing/contradictory edges with a query against the store (N4's territory) and *hand the result to*
   the evaluator model, rather than asking the model to notice.

### 5.4 Mechanics that work

**[VERIFIED]** ALCE's mechanism is simple and well-tested: passages injected as `Document [1](Title: …)`,
model emits sentence-final `[1][2][3]`. Its instruction, verbatim:

> "Write an accurate, engaging, and concise answer for the given question using only the provided search
> results (some of which might be irrelevant) and cite them properly. … Always cite for any factual claim.
> When citing several search results, use [1][2][3]. Cite at least one document and at most three
> documents in each sentence. If multiple documents support the sentence, only cite a minimum sufficient
> subset of the documents."

**[VERIFIED]** AttributedQA uses structured output instead — an `(answer, attribution)` pair — and finds
that **selecting the attribution from the top-50 rather than taking top-1 is consistently better**
(Post-5 49.4 → Post-6 55.6 AIS; RTR-11 51.0 → RTR-12 63.3, p ≪ 10⁻⁷).

**[INFERRED]** For Foreman: use **short opaque edge IDs (`e07`) inline**, plus a **structured
`cited_edges: [...]` field** in the worker's output contract. The inline marker is what makes the
citation faithful (§5.1); the structured field is what makes it machine-checkable. Both, not either.

---

## 6. Context budget discipline

### 6.1 Where more graph stops helping

**[VERIFIED]** SubgraphRAG's K sweep is the cleanest measurement of diminishing returns on subgraph size.
Default is **top-100 triples = 2.3% of candidate triples on average**:

| Reasoner / K | WebQSP F1 | WebQSP Hit | CWQ F1 | CWQ Hit |
|---|---|---|---|---|
| GPT-4o-mini, K=100 | 77.45 | 90.11 | 54.13 | 62.02 |
| GPT-4o-mini, K=200 | 77.82 | 90.54 | 54.69 | 63.49 |
| GPT-4o-mini, K=500 | **77.67** ↓ | 91.22 | 55.41 | 64.97 |
| GPT-4o, K=100 | 76.46 | 89.80 | 59.08 | 66.69 |
| GPT-4o, K=200 | 78.24 | 90.91 | 59.42 | 67.49 |

**5× the tokens (100 → 500 triples) buys +0.22 F1 on WebQSP — and F1 actually *declines* from the K=200
peak — and +1.28 F1 on CWQ.** The knee is between 100 and 200 triples.

**[VERIFIED]** PathRAG: average win rate **peaks at K=15 paths, drops at K=25**.

**[VERIFIED]** Lost in the Middle (arXiv 2307.03172), §5: *"reader model performance saturates long
before retriever performance saturates … using more than 20 retrieved documents only marginally improves
reader performance (~1.5% for GPT-3.5-Turbo and ~1% for Claude-1.3), while significantly increasing the
input context length."* Turnover ≈ **20 documents ≈ 3,000 tokens**.

**[VERIFIED]** ALCE §5.3: *"correctness plateaus at top-1 passage and citation quality plateaus at
top-3."* ChatGPT-16K actually **degrades** with more passages: 5-psg 76.2/76.5 → 10-psg 75.3/75.0 →
20-psg 73.7/73.5, while retrieval recall keeps climbing (GTR ASQA R@5 56.8 → R@20 70.3 → R@100 78.4).
GPT-4 is the exception, improving monotonically 5→20 passages.

### 6.2 Where more context becomes actively harmful

**[VERIFIED]** Lost in the Middle, GPT-3.5-Turbo-16K, 30 documents: accuracy **73.4 (gold at start) →
50.5 (gold at index 9) → 63.7 (gold at end)** — a **22.9-point** positional swing. GPT-3.5-Turbo at 20
documents: 75.8 → 53.8 → 63.2 (**22.0 points**). The paper's headline consequence:

> *"in the worst case, performance in 20- and 30-document settings is lower than performance without any
> input documents"* — closed-book is 56.1; the middle positions score 53.8 and 50.5.

**Serving more graph than the worker can use is measurably worse than serving no graph at all.**

**[VERIFIED]** Bigger context windows do not fix this. GPT-3.5-Turbo vs GPT-3.5-Turbo-16K are *"nearly
superimposed"* (76.8/61.2/62.4 vs 76.9/61.0/62.5); Claude-1.3 and Claude-1.3-100K differ by ≤0.2 points.

**[VERIFIED]** NoLiMa quantifies the gap between claimed and usable context. Effective length = longest
length still ≥85% of the short-context baseline:

| Model | Claimed window | **Effective** | 32K as % of base |
|---|---|---|---|
| GPT-4o | 128K | **8K** | 70.2% |
| Claude 3.5 Sonnet | 200K | 4K | 34.0% |
| Gemini 1.5 Pro | 2M | 2K | 52.1% |
| Llama 3.3 70B | 128K | 2K | 43.9% |
| Command R+ | 128K | <1K | **8.1%** |

**Every model's effective length is ≤8K against claims of 128K–2M; 9 of 12 are ≤2K. At 32K, 10 of 12
models fall below 50% of their short-context baseline.**

**[VERIFIED]** NoLiMa's ablation isolates the cause: with *literal lexical overlap* between question and
needle, Llama 3.3 70B scores **98.3 / 98.5 / 98.5** at 8K/16K/32K — flat. Remove the lexical overlap and
one-hop drops to 84.1/73.2/56.2, two-hop to 57.4/42.7/25.9. **[INFERRED]** Highly relevant to graph
context: a serialized subgraph's node/edge labels are *exactly* the lexical anchors that make retrieval
from long context work. Serve edges whose surface forms match the task text where possible; a subgraph
full of opaque IDs with no lexical bridge to the task is the worst case in NoLiMa's design.

**[VERIFIED]** Context Rot (Chroma, 18 models incl. GPT-4.1, Claude 4, Gemini 2.5, Qwen3):
*"Across all experiments, model performance consistently degrades with increasing input length"*;
*"the impact of distractors and their non-uniformity amplifies as input length grows across models,
including the latest state-of-the-art models."*

### 6.3 Budget recommendation

**[INFERRED, combining §2.2 measurement with §6.1 turnover points]**

| Parameter | Value | Basis |
|---|---|---|
| Serving format | subject-grouped arrow DSL | measured 13.7 tok/edge (§2.2) |
| **Default graph budget** | **2,000 tokens ≈ 145 edges** | SubgraphRAG knee at 100–200 triples; Lost-in-the-Middle turnover ≈3K tokens |
| Floor | 40 edges (~550 tokens) | below this the subgraph is unlikely to cover 2-hop evidence |
| **Hard cap** | **4,000 tokens ≈ 290 edges** | past SubgraphRAG's K=200 peak; approaching the ~3K-token turnover where Lost-in-the-Middle measures net harm |
| Pinned conflicts block | ≤10 edges, outside the K budget | §7 step 5 |
| Pinned artifact-version block | ≤10 edges, outside the K budget | §7 step 3 |

**Note the asymmetry [INFERRED]:** the cost of *under*-serving is a worker that asks a follow-up question;
the cost of *over*-serving is measured accuracy loss that can go below the no-graph baseline. Under-serve.

---

## 7. Validation / refutation of the source paper's 7-step context builder (§V-B)

> "A context builder can: (1) resolve entities mentioned in the task; (2) expand one or two hops over
> allowed edge types; (3) include current artifact versions; (4) prioritize recent verified claims;
> (5) include conflicts and uncertainty; (6) serialize within a token budget; (7) attach stable edge
> identifiers for citation."

The framing sentence — *"the graph should not become a new form of context dumping. Each worker needs a
task-specific subgraph"* — is **strongly supported**. Lost in the Middle measures 20–30-document contexts
scoring *below closed-book*; SubgraphRAG serves 2.3% of candidate triples and beats methods that serve
more. Step by step:

| Step | Verdict | Evidence |
|---|---|---|
| **(1) Resolve entities mentioned in the task** | **SUPPORTED** | Entity linking is step 1 in SubgraphRAG, ToG, StructGPT, RoG. SubgraphRAG: topic entities *"provide valuable inductive bias"*; the topic-entity indicator *"invariably leads to an improvement."* **Caveat (SubgraphRAG, verbatim):** *"KG retrieval goes beyond basic entity linking"* — resolution is necessary, not sufficient. |
| **(2) Expand one or two hops over allowed edge types** | **PARTIALLY SUPPORTED — needs a correction** | The *bound* is right: k=1 measurably fails multi-hop (SubgraphRAG hop breakdown; StructGPT MetaQA-2hop +62.9), and >3 hops is measured to add little (ToG). Edge-type filtering is right and universal. **But "expand" as the selection mechanism is refuted.** PathRAG: *"the limitation … lies in the redundancy of the retrieved information, rather than its insufficiency"*; flow-based relevance pruning beats hop-first ordering (win rates 50.4–64.0%). SubgraphRAG: relevance-scored triple selection beats path search and entity-induced subgraphs. **Correction: expand to 2 hops as *candidates*, then relevance-rank down to a fixed budget.** |
| **(3) Include current artifact versions** | **UNVALIDATED — no evidence either way** | No study in this corpus measures serving "current version" state. **[INFERRED]** Plausible and cheap (a handful of edges), and NoLiMa's lexical-anchor result argues for including file paths / module names verbatim because they bridge task text to subgraph. Keep it, but **flag it as an untested assumption** and pin it to ≤10 edges. |
| **(4) Prioritize recent verified claims** | **PARTIALLY SUPPORTED — the *prioritize* half only** | Relevance-ranked selection beating unranked is measured (PathRAG flow-based vs random, 50.8–70.2% win). **No study measures *recency* as a ranking signal.** Also: the source paper conflates *retrieval ranking* with *prompt position*. PathRAG's measured layout puts the **most reliable path last**, adjacent to the answer (`concat([q; t_P_K; …; t_P_1])`, P₁ most reliable), explicitly *"considering the 'lost in the middle' issue … we position the most critical information at the two ends."* **Correction: rank by relevance (measured) and *verified* status; treat recency as an untested tiebreak; and put the top-ranked material at the END of the block, not the start.** |
| **(5) Include conflicts and uncertainty** | **WEAKLY SUPPORTED — and risky as literally written** | No measured study shows that including contradictory edges improves outcomes. Counter-evidence is direct: Context Rot measures that *"the impact of distractors and their non-uniformity amplifies as input length grows,"* and an unlabelled contradictory edge **is** a distractor. NLGraph measures LLMs latching onto spurious surface correlations (−44.5 points on the chain distribution). **Correction: include conflicts, but in a separately-headed, explicitly-labelled block — never interleaved with the evidence edges.** The framing must tell the worker these are known disputes, not facts. |
| **(6) Serialize within a token budget** | **STRONGLY SUPPORTED, with numbers** | SubgraphRAG K-sweep (5× tokens → +0.22 F1 on WebQSP, with a decline past K=200); PathRAG peak at K=15 and drop at K=25; Lost in the Middle turnover ≈20 docs / ~3K tokens with 20–30-doc settings scoring **below closed-book**; ALCE plateau at top-3 passages with 16K models degrading past 5. See §6.3 for the number. |
| **(7) Attach stable edge identifiers for citation** | **STRONGLY SUPPORTED — and load-bearing** | ALCE PostCite: citation recall **73.6 → 26.7 (−46.9)** while correctness moves −2.1. AttributedQA: RTR 65.5 AIS vs post-hoc 55.6. IDs must be in-context *at generation time*. And it is nearly free — the cheapest of my 13 measured formats already carries a per-edge ID (§2.2). |

### 7.1 Steps the evidence says are MISSING

| Proposed step | Why | Evidence |
|---|---|---|
| **(8) Order the block: task restated first, highest-ranked edges last** | Counteracts the measured 22.9-point positional swing | Lost in the Middle Tables 6–7; PathRAG's `concat([q; t_P_K; …; t_P_1])`; Lost in the Middle's query-aware contextualization (query before *and* after the data) took worst-case key-value retrieval from 45.6% to near-perfect |
| **(9) Never summarize or compress the edges** | Compression buys correctness and sells attribution — the opposite of what we need | ALCE: Vanilla 73.6/72.5 → Summ 68.9/61.8 → Snippet 65.3/57.4 (**−8 to −15 citation precision**) |
| **(10) Include ≥1 worked citation demonstration** | Cheapest measured citation gain | ALCE: 0 demos 69.3 recall → 1 demo 74.6; full instruction vs short **+4.0** |
| **(11) Preserve path/group structure rather than a flat edge soup** | Layout is worth far more than syntax | PathRAG path-based vs flat organization wins on 5/5 dimensions across 6 corpora; *Talk like a Graph* incident-vs-adjacency worth up to 34–88 points |
| **(12) Deterministically verify every citation after generation** | ~72% precision ceiling, and our targets are DB rows, not paragraphs | ALCE ceiling + gameability control (99.4/99.4 by verbatim copying); §5.3 |
| **(13) Answer "missing"/"absent" questions by query, never by model reading** | LLMs have no global model of a graph | *Talk like a Graph* disconnected-nodes: **0.5% zero-shot, ≈0.0% for all other prompting methods** |

---

## 8. Pre-serialized subgraph vs query tools — recommendation for Foreman's CLI workers

### 8.1 The head-to-head

**[VERIFIED]** The cleanest comparison available, same benchmarks, same underlying KG:

| Approach | WebQSP Hit | CWQ Hit | LLM calls / question |
|---|---|---|---|
| **SubgraphRAG + GPT-4o** — pre-serialized top-100 triples | **89.80** | 66.69 | **1** |
| **ToG (GPT-4)** — agentic traversal, depth 3 × width 3 | 82.6 | **67.6** | **6–8** |

SubgraphRAG's own framing, verbatim: *"SubgraphRAG requires only a single call to GPT-4o, whereas ToG
requires 6-8 calls, which increases computational cost."*

**Pre-serialization wins WebQSP by +7.2 Hit and loses CWQ by −0.9, at one-sixth to one-eighth the LLM
calls.** ToG's cost *"increases linearly with the depth"* and each prune step *"requires at most N LLM
calls."*

### 8.2 When tools do win — and it is a sharp condition

**[VERIFIED]** StructGPT's gradient (§4.1) is the decision rule in disguise. Iterative interface reading
beats full serialization by **+62.9** on MetaQA-2hop (a KG far too large to serialize) and by **−4.2** on
TabFact (a table that already fits). Graph-CoT (arXiv 2404.07103) makes the same architectural point at
scale: it operates over graphs of **~8M nodes / ~52M edges**, where pre-serialization is not merely
expensive but impossible. *(Graph-CoT's own result table was unrecoverable — its arXiv HTML render is
broken across v1/v2/v3 and the ACL page carries only the abstract; it is cited here for its architecture
and graph scale, not for a number.)*

**The condition is: does the task-relevant subgraph fit the budget?**

### 8.3 Recommendation

**Pre-serialize by default. Expose query tools as a bounded escape hatch. Do not make traversal the
primary path.**

Rationale, in order of weight:

1. **[VERIFIED]** Accuracy: pre-serialization matches or beats agentic traversal on both benchmarks that
   test it (+7.2 / −0.9).
2. **[VERIFIED]** Cost: 1 call vs 6–8, with ToG's cost linear in depth. Foreman already pays a
   cross-vendor premium per worker; a 6–8× multiplier on every worker's graph access is not affordable.
3. **[INFERRED]** Context rot compounds in tool loops. Every traversal round-trip re-reads a transcript
   that has grown by the previous tool result. Context Rot measures degradation with input length across
   all 18 models tested, and NoLiMa puts effective context at ≤8K for every model measured. A 6–8-call
   traversal is the exact shape that walks a worker into its degraded regime — and it does so *after*
   the worker has committed to a reasoning path.
4. **[INFERRED]** Determinism and auditability. Foreman's value proposition includes a reproducible audit
   trail. A pre-serialized subgraph is a **fixed, hashable artifact** — we can record exactly what the
   worker saw, replay it, and diff it across runs. An agentic traversal is a different subgraph every
   run, which makes "the auditor saw different evidence than the implementer" the default rather than
   the exception. This alone probably decides it for us.
5. **[VERIFIED]** Our subgraphs fit. SubgraphRAG's default is 100 triples = **2.3% of candidates** and it
   is competitive at that size. A Foreman task subgraph at 145 edges / 2,000 tokens (§6.3) is well inside
   the regime where StructGPT measures full serialization to be equal or better.

**Where the escape hatch is justified [INFERRED]:**

| Situation | Why pre-serialization fails | Tool to expose |
|---|---|---|
| Entity resolution returned 0 seeds | Nothing to expand from | `kg.search(text) -> node_ids` |
| Candidate set exceeded the cap and was truncated | The worker may need the truncated tail | `kg.neighbors(node_id, edge_types, limit)` |
| Worker needs an **absence**/count answer | *Talk like a Graph*: ≈0.0% on disconnected-nodes; models cannot read absence | `kg.query(...)` returning a definite answer |
| Auditor verifying a citation | Deterministic check, must not be a model judgement | `kg.get_edge(edge_id)` |

**Design rule [INFERRED]:** tools return **facts, not context**. A tool call should answer a question
(`does edge e07 exist?`, `how many specs depend on spec_4?`), not dump another subgraph into the
transcript. The moment a tool returns 500 more edges, we have rebuilt context dumping with extra steps —
the exact failure the source paper warns about. Cap every tool result at ~40 edges and count it against
the same budget.

---

## 9. DRAFT: Foreman context-builder spec

**Status: draft for review. Numeric defaults are traceable to §6.3; the algorithm follows §3 and §7.**

### 9.1 Signature

```
build_context(task: Task, role: WorkerRole, graph: Graph,
              budget_tokens: int = 2000) -> GraphContextBlock
```

`GraphContextBlock` is an immutable, content-hashed artifact. The hash goes in the run record so the
audit trail can prove what the worker saw.

### 9.2 Algorithm

**Step 1 — Resolve seeds.** Extract surface forms from the task: spec title and body, target module
paths, touched file paths, referenced ADR/claim/spec IDs. Resolve against the alias index → seed set `S`.
**Cap |S| ≤ 8.** If `|S| == 0`, emit an explicit `NO GRAPH CONTEXT` marker and **do not fall back to a
global or random subgraph** — Lost in the Middle measures that irrelevant context scores below no context.

**Step 2 — Role-scoped edge-type allowlist (applied *before* expansion).**

| Role | Allowed edge types |
|---|---|
| implementer | `depends_on, targets_module, touches_file, governed_by, supersedes, conflicts_with, defect, decision` |
| auditor | implementer set + `produced, evaluated_by, verdict, criterion, supported_by, confidence` |
| synthesizer | `about, supported_by, supersedes, conflicts_with, produced, verdict` |
| planner | `depends_on, status, owned_by, governed_by, decision` |

Cheapest available filter; cuts the branching factor before any scoring happens.

**Step 3 — Candidate generation.** 2-hop closure from `S` over allowed edge types. **Hard bound k=2**
(§3.2). Cap candidates at 2,000 edges; on overflow, truncate by hop distance, then by degree ascending
(prefer low-degree, more specific edges), and **set the `truncated` flag** — that flag is what licenses
the tool escape hatch (§8.3).

**Step 4 — Score.** Per candidate edge:

```
score(e) = w1 * cos(embed(task_text), embed(verbalize(e)))
         + w2 * directional_distance_features(e, S)
         + w3 * is_verified(e)
         + w4 * recency_decay(e)          # UNVALIDATED — see §7 step (4)
```

Linear or small MLP. **Explicitly not PageRank/PPR and not a GNN** — both measured to fail or degrade
(§3.1). `directional_distance_features` = hop distance from each seed, with direction, per SubgraphRAG's
DDE, which beat GNNs and one-hot topic encoding.

**Step 5 — Select.** `K = floor(budget_tokens / 14)` using the measured 13.7 tok/edge (§2.2).
Default budget 2,000 → **K ≈ 145**. Clamp `K ∈ [40, 290]` (§6.3).

**Step 6 — Pin (outside the K budget, capped).**
- Current artifact versions for artifacts in `S` — **≤10 edges**. *(Marked UNVALIDATED, §7 step 3.)*
- Open conflicts touching `S` — **≤10 edges**, into a separate labelled block.

**Step 7 — Serialize.** Subject-grouped arrow DSL with edge IDs (§2.3).

**Step 8 — Order.** Task restated first and last; groups ordered **ascending by max member score**, so
the highest-scoring group sits immediately before the closing task restatement (PathRAG's layout,
Lost in the Middle's query-aware contextualization). Conflicts block immediately before the closing
restatement.

**Step 9 — Emit the citation contract** and one worked demonstration (ALCE: ≥1 demo, full instruction).

**Step 10 — Post-generation verification** (deterministic, no model in the loop):
1. every cited ID exists in the store → else `HALLUCINATED_EDGE_ID`
2. every cited ID was in *this* block → else `OUT_OF_CONTEXT_CITATION`
3. every load-bearing claim carries ≥1 citation → else `UNSUPPORTED_CLAIM`
4. missing/contradictory-edge detection runs as a **graph query**, not a model judgement (§7 step 13)

### 9.3 Rendered shape

```
## TASK
Add retry policy to UmbraDB sync worker (spec_7). Fix the idempotency defect from evaluation_92.

## GRAPH CONTEXT  (145 edges, 1,987 tokens, budget 2,000)
Format: `<edge_id> -<relation>-> <target>`. Cite any factual claim by edge id, e.g. [e07].

source_readme:
  e29 -path-> docs/sync.md
  e30 -verified_on-> 2026-07-20
commit_a81f:
  e18 -branch-> feat/retry-policy
  e20 -touches_file-> src/sync/retry.rs
agent_run_183:
  e07 -produced-> claim_441
  e09 -evaluated_by-> evaluation_92
evaluation_92:
  e22 -verdict-> changes_requested
  e24 -defect-> retry loses cursor on reconnect
spec_7:
  e01 -title-> Add retry policy to UmbraDB sync worker
  e04 -owned_by-> agent_run_183

## KNOWN CONFLICTS  (2 edges — these are disputed, not established facts)
  e28 adr_11 -conflicts_with-> claim_238
  e13 claim_441 -supersedes-> claim_238

## CITATION CONTRACT
Cite every factual claim inline with its edge id: "Backoff caps at 30s [e27]."
Cite at least one and at most three edges per claim. If no edge supports a claim,
write it without a citation and list it under `uncited_claims`.
Emit at the end:
  cited_edges: [e27, e13, ...]
  uncited_claims: ["..."]

## TASK (restated)
Add retry policy to UmbraDB sync worker (spec_7). Fix the idempotency defect from evaluation_92.
```

### 9.4 What to measure once it exists

Per §VII-A of the source paper, the serializer is the artifact under optimization. Minimum harness:
(a) citation precision against the deterministic checker — we get this free, unlike ALCE;
(b) task success at K ∈ {40, 100, 145, 200, 290} to locate *our* knee rather than inheriting
SubgraphRAG's; (c) the same sweep per vendor, since format preference is measured to be
non-transferable across model families (IoU < 0.2).

---

## 10. Negative results

Deliberately hunted. Grouped by what they refute.

### 10.1 Against "structured graph context always beats plain text"

- **[VERIFIED]** StructGPT: iterative structured reading is **−4.2** on TabFact (Davinci-003) and
  **+0.2** on Spider-SYN — i.e. ~0 or negative whenever the data already fits the prompt.
- **[VERIFIED]** *Table Meets LLM*: **markup beats natural-language verbalization** — HTML > NL+Sep by
  **6.76%**. The "make it readable prose" instinct is measurably wrong for structured data.
- **[VERIFIED]** *Table Meets LLM*: adding *more* structure hurts. Partition marks cost up to **15.00
  points** on cell lookup; removing the 1-shot example costs **−30.38%** overall (up to −54.00 on
  merged-cell detection); moving external text after the table costs **−6.81%**.
- **[VERIFIED]** Context Rot, across **all 18 models** tested: *"models perform better on shuffled
  haystacks than on logically structured ones."* Imposing narrative/logical coherence on context
  measurably *hurts* retrieval of a specific fact. **[INFERRED]** This is in direct tension with
  PathRAG's path-based-organization result and is the strongest caution against over-engineering our
  layout. Reconciliation attempt: PathRAG measures *judged answer quality on synthesis questions*;
  Context Rot measures *retrieval of one fact*. Grouping probably helps synthesis and hurts lookup. We
  should measure both, and not assume our layout choice is free.

### 10.2 Against "LLMs can reason over graphs"

- **[VERIFIED]** *Talk like a Graph*, disconnected-nodes task: **0.5% zero-shot; ≈0.0% for zero-CoT,
  few-shot, CoT and CoT-BaG.** *"LLMs lack a global model of a graph."*
- **[VERIFIED]** NLGraph GNN-simulation: **0.00** for zero-shot, few-shot, and zero-CoT.
- **[VERIFIED]** NLGraph max flow: near-floor across every prompting method (CoT+SC 9.88).
- **[VERIFIED]** NLGraph spurious correlations: connectivity accuracy on a chain distribution drops
  **−44.50 (CoT)** and **−38.50 (CoT+SC)** vs the general distribution — models count node mentions
  instead of tracing paths.
- **[VERIFIED]** *Talk like a Graph*: graph *structure* dominates. PaLM 62B zero-shot connected-nodes,
  Star **61.7** vs Complete **13.3**; cycle check, Complete **91.7** vs Path **5.9**.

### 10.3 Against "more prompting technique is better"

- **[VERIFIED]** NLGraph: on Hamilton path and bipartite matching, **zero-shot beats few-shot**, with
  few-shot underperforming by **1.00–10.48%**.
- **[VERIFIED]** NLGraph: on topological sort and max flow, *"CoT, CoT+SC, and LtM prompting generally
  underperform few-shot prompting."*
- **[VERIFIED]** NLGraph: Build-a-Graph prompting gains 3.07–16.85% on cycle/shortest-path but **hurts**
  Hamilton path (CoT 24.00 → 22.34).
- **[VERIFIED]** *Talk like a Graph*, PaLM 62B: zero-shot beats CoT on edge existence (44.5 vs 42.8 mean)
  and crushes it on cycle check (**76.0 vs 58.0 mean**).

### 10.4 Against "graph retrieval machinery pays for itself"

- **[VERIFIED]** SubgraphRAG: **PPR** *"fails to reliably yield improvements"*; **GNN** variants *"often
  result in performance degradation compared to their MLP counterparts."* Two of the most-cited graph
  techniques, measured as no-ops or worse, in the paper whose title is *Simple is Effective*.
- **[VERIFIED]** SubgraphRAG cross-dataset generalization collapse: a retriever trained on one dataset
  and applied to the other drops CWQ F1 from **47.16 → 37.96** (Llama3.1-8B) and **54.13 → 44.69**
  (GPT-4o-mini) — ~9 points lost to domain shift in the *retriever*.
- **[VERIFIED]** ToG on WikiData vs Freebase: **−3.9 to −7.6 points** on identical questions. Graph
  quality swamps method choice.
- **[VERIFIED]** SubgraphRAG's own K-sweep: WebQSP F1 **declines** from K=200 (77.82) to K=500 (77.67)
  for GPT-4o-mini. More graph, less accuracy.
- **[VERIFIED — as an evidence-base negative]** The KG-hallucination survey (arXiv 2311.07914) contains
  **no measured hallucination-rate reduction at all**; its Table 1 has no performance column. The
  "knowledge graphs reduce hallucination" claim is, in this corpus, **unmeasured**.
- **[VERIFIED]** GraphRAG-Bench: **BM-25 (84.49) beats all nine GraphRAG systems on True/False**, and
  **6 of 9 fall below BM-25 on the reasoning metric (44.15)**. A zero-LLM-cost lexical retriever
  out-reasons most graph pipelines that spent 10M–84M tokens on construction. **LightRAG: 83.9M tokens
  and 12,976s of indexing to score 71.22, below TF-IDF's 71.71.**
- **[VERIFIED]** GraphRAG-Bench, graph quality: KGP's passage graph is **~54% isolated nodes**; the
  richer extractors are *less* connected (GraphRAG 72.51%, LightRAG 69.71%) than plain KG methods (~90%)
  because richer extraction *"inevitably introduces more noise."* **[INFERRED]** A caution for our own
  graphify pipeline: extraction richness and graph usability are not the same axis, and optimizing the
  first can degrade the second.
- **[VERIFIED]** HybridRAG: GraphRAG **loses to plain VectorRAG on context recall 0.85 vs 1.00** and on
  answer relevance 0.89 vs 0.91.
- **[VERIFIED]** *RAG or Long-Context LLMs?*: long-context stuffing beats RAG on all three models
  tested — Gemini-1.5-Pro **49.70 vs 37.33**. Retrieval's advantage is cost (Self-Route: 65% cheaper at
  comparable quality), not accuracy.
- **[VERIFIED]** *Graph of Records* (arXiv 2410.11001) contradicts its own prose. §3.2 claims GoR *"beats
  sparse retrievers, dense retrievers, and hybrid retrievers in every aspect"*; its appendix Table 5 shows
  GoR **losing GovReport R-2 to Contriever (16.8 vs 17.6)** and **tying Full Context on SQuALITY R-L
  (17.8) and R-1 (34.0)**. Its ablations are worse for the thesis: **an ablated variant beats the full
  model** (`w/o in-batch negatives` R-1 34.7 > 34.5), supervised training is up to **−3.4 R-2** worse than
  self-supervised, and removing training drops WCEP R-L **18.1 → 15.3** — i.e. **the graph structure by
  itself contributes little; nearly all the gain comes from the learned GNN.**
- **[VERIFIED — methodological]** In both graph-RAG papers examined closely, **the prose overstates the
  tables**, and the disagreement is in the same direction each time. **[INFERRED]** Read tables, not
  abstracts, when evaluating graph-RAG claims — including our own.

### 10.5 Against "long context solves the budget problem"

- **[VERIFIED]** Lost in the Middle: 20- and 30-document settings score **below closed-book** (53.8 and
  50.5 vs 56.1). Positional swing up to **22.9 points**.
- **[VERIFIED]** Lost in the Middle: extended-context model variants are *"nearly superimposed"* on their
  base models (GPT-3.5 vs -16K; Claude-1.3 vs -100K differ ≤0.2).
- **[VERIFIED]** NoLiMa: effective context **≤8K for every model measured**, against claims of 128K–2M;
  **10 of 12 models below 50% of baseline at 32K**; Command R+ at **8.1%** of its baseline.
- **[VERIFIED]** Context Rot: degradation with input length across all 18 models, distractor impact
  *amplifying* with length, on current frontier models.

### 10.6 Against "citations mean the model used the evidence"

- **[VERIFIED]** ALCE PostCite: correctness −2.1, citation recall **−46.9**.
- **[VERIFIED]** ALCE gameability control: verbatim-copy-and-self-cite scores **99.4/99.4** citation with
  20.8 fluency.
- **[VERIFIED]** ALCE human eval: utility scores flat at **3.7–3.9** across models whose citation recall
  spans **13.6 → 83.9**.
- **[VERIFIED]** ALCE: mid-generation retrieval (InlineSearch) *hurts* — 73.6/72.5 → **58.3/58.2**.
  **[INFERRED]** A caution for the tool-based design in §8: letting the worker fetch evidence while
  writing is measured to degrade both citation *and* correctness in the one study that tests it.
- **[VERIFIED]** ALCE Interact helps on ASQA (68.9/61.8 → 73.4/66.5) but **hurts on ELI5**
  (51.5/48.2 → 47.8/45.0) — tool-augmented evidence expansion is not reliably positive.
- **[VERIFIED]** AttributedQA: using AutoAIS as a *system component* breaks it as a *metric* — reranked
  variants score *"lower on human evaluation than would be expected."* **[INFERRED]** We must not both
  optimize against and evaluate with the same citation checker.

### 10.7 Against format dogma

- **[VERIFIED]** Format preference **inverts** across model generations: MMLU JSON +9.68 over Markdown on
  GPT-3.5-turbo; JSON −7.33 vs Markdown on GPT-4-1106.
- **[VERIFIED]** GPT-4-32k on HumanEval: plaintext **76.2**, JSON **21.95** — a 54-point catastrophe
  inside a model family described as "robust to format."
- **[VERIFIED]** IoU of best-format sets across model series *"often below 0.2."* Any hard-coded format
  is a bet on one vendor. Foreman is explicitly cross-vendor.

---

## 11. Open questions

1. **Does our knee match SubgraphRAG's?** Their 100–200-triple knee is on Freebase KGQA with short
   triples. Foreman edges carry long free-text objects (claim text, defect descriptions), so tokens/edge
   will be higher and the knee will land at fewer edges. **Must be measured on our own graph** before the
   2,000-token default is trusted.
2. **Does subject-grouping help or hurt us?** PathRAG says path/group structure helps synthesis; Context
   Rot says logical structure hurts single-fact lookup across all 18 models. Foreman workers do both.
   Needs an A/B on our own tasks.
3. **Is recency a useful ranking signal?** Step (4) of §V-B assumes it. Nothing in this corpus measures
   it. Cheap to A/B (`w4 = 0` vs tuned).
4. **What is the right conflict-block dose?** We recommend ≤10 pinned conflict edges in a labelled block,
   but that number is **[INFERRED]**, not measured, and Context Rot says distractor harm amplifies with
   length. Sweep it.
5. **Does the truncation flag actually predict when tools help?** The §8.3 escape hatch assumes
   `truncated == True` correlates with "the worker needed more." Instrument and check; if it does not, the
   tool surface is dead weight.
6. **Cross-vendor format transfer.** IoU < 0.2 across families suggests Grok / GPT-5.6 / Gemini may each
   prefer a different serializer. Cheap to test (one serializer function, three vendors, one eval set) and
   the answer changes whether we ship one format or three.
7. **Does citation faithfulness improve when the target is a DB row rather than a paragraph?** Every
   number in §5 comes from prose attribution. Our IDs are exact and verifiable — plausibly a much higher
   ceiling, but nobody has measured it. This is a genuinely publishable question and we are well placed
   to answer it.
8. **How do multiple workers' subgraphs interact?** All the measured work is single-agent. The source
   paper's synthesizer reads findings from workers who each saw a *different* subgraph. Whether that
   composes or produces contradictory grounding is untested anywhere in this corpus.
9. **Should some Foreman queries bypass the graph entirely?** GraphRAG-Bench says BM-25 beats every graph
   system on true/false and 6 of 9 on reasoning. If a large share of auditor checks are lookup-shaped, a
   lexical index over the same store may outperform the graph plane at a fraction of the cost. Needs a
   question-type census of real Foreman tasks before we size the graph plane.
10. **Does extraction richness hurt us the way it hurt GraphRAG-Bench's systems?** Their richest
    extractors produced the *worst-connected* graphs (~70% non-isolated vs ~90%). graphify should report
    connectivity as a first-class quality metric, not just entity/relation F1 — this also sharpens
    Table III of the source paper, which lists "components, density" but marks the common misreading as
    "one component is not always desirable."
