# Design — graph-context-builder

## The pipeline

```
task text + role + budget
        │
   (1) resolve seeds from the task            cap |S| ≤ 8
        │                                     |S| == 0 → NO GRAPH CONTEXT, stop
   (2) role-scoped edge-type allowlist        applied BEFORE expansion
        │
   (3) 2-hop candidate generation             hard bound k=2, cap 2,000 candidates
        │                                     overflow → truncate + set `truncated`
   (4) score and rank                         linear; no PPR, no GNN
        │
   (5) select top-K                           K = floor(budget/14), clamp [40, 290]
        │
   (6) pin, outside K                         conflicts ≤10 (labelled), versions ≤10
        │
   (7) serialize                              subject-grouped arrow DSL + edge IDs
        │
   (8) order                                  task first; best group last; task last
        │
   (9) citation contract + one worked demo
        │
  (10) hash, record, dispatch
        │
  (11) post-generation verification           deterministic, no model in the loop
```

Steps 1–10 run host-side, before the lane starts. Step 11 runs host-side, after
it finishes. The worker never traverses.

## Edge identity — the gap that has to be closed first

`graph.json` edges carry `{source, target, relation, confidence,
confidence_score, source_file, source_location, context, _origin}`. There is no
`id`. Every downstream property this package promises — inline citation,
deterministic verification, replay, K-sweeps — keys on edge identity, so the
builder mints two levels of it:

- **`edge_key`** — a truncated `sha256(source ‖ target ‖ relation ‖ source_file ‖
  source_location)`. Durable across rebuilds for the same underlying fact, and
  computable by anyone reading `graph.json` without the builder.
- **the in-block alias** — `e01`, `e02`, … , short because the worker types them
  and short opaque IDs are what the citation literature actually uses. The alias
  is meaningful only inside one block.

The block carries the alias-to-`edge_key` table, and the table is inside the
content hash. That is what makes `OUT_OF_CONTEXT_CITATION` decidable: a cited
alias resolves against *this* block's table, and the resulting `edge_key`
resolves against `graph.json`. Two lookups, both exact, no model.

Including `source_file` and `source_location` in the key is deliberate. Two
edges that differ only in where they were extracted from are different evidence
and must be separately citable — which is also why `--directed` is mandated
upstream in GP-3, since an undirected simple graph cannot hold them both.

## Why layout is specified and syntax is not

The measured split is stark. **Information layout** — which facts sit adjacent
in the token stream — is worth **4.8 to 88.0 accuracy points** on the same graph
and the same question (zero-shot connected-nodes: adjacency 19.8% versus
incident 53.8%, and the spread *widens* with model scale: 16.0 → 58.2 → 88.0
across three model sizes). **Surface syntax** — the punctuation around identical
adjacency — is worth ~1.5–10 points on frontier models, shrinks with scale, and
*inverts by vendor*: JSON beat Markdown by 9.68 on one model generation and lost
by 7.33 on the next, with the IoU of best-format sets across model families
often below 0.2.

So the spec pins the layout normatively (subject grouping, ordering, the
separately-headed conflicts block, task restated at both ends) and pins the
surface syntax only as a default chosen for token cost — 13.7 tok/edge for the
subject-grouped arrow DSL against 50.0 for JSON-LD expanded, a 3.64× spread that
at a 2,000-token budget is the difference between 146 edges and 40. The
serializer is one swappable function measured per vendor in GP-7, not a dogma.

The one caution recorded rather than hidden: PathRAG measures path/group
structure helping synthesis, while Context Rot measures that across all 18
models tested, *"models perform better on shuffled haystacks than on logically
structured ones"* for single-fact lookup. Our workers do both. The layout
default follows the synthesis evidence; the A/B belongs to GP-7 and the spec
says so.

## Alternatives REJECTED

**Give workers graph tools and let them traverse.** Rejected as the primary
path. Pre-serialization measures 89.80 WebQSP Hit in one call against agentic
traversal's 82.6 in 6–8; traversal cost grows linearly with depth; every
round-trip re-reads a transcript that has grown, walking the worker into the
degraded regime that Context Rot and NoLiMa both measure — and doing so *after*
it has committed to a reasoning path. Decisively, a traversal is unhashable: it
sees a different subgraph every run, so the audit trail cannot state what the
worker saw. It survives only as the bounded escape hatch of §"the escape hatch"
below.

**Use the graphify MCP server as the machine interface.** Rejected as primary,
retained behind a wrapper. All ten tools return prose strings, so a lane would
be parsing English. `query_graph` matches by case-folded substring plus IDF with
no stemming, no synonyms and no cross-language match; graphify's own
documentation mandates a `.vocab.txt` expansion pre-step and warns that without
it the matcher returns zero hits and *"the answer collapses to noise."* That
obligation is per-query and belongs to the caller. Foreman's wrapper performs the
expansion, logs it for auditability, returns JSON, and fails loudly on zero
expansion rather than letting the caller answer from memory.

**Serve the k-hop closure.** Rejected. The binding constraint is measured to be
*"the redundancy of the retrieved information, rather than its insufficiency."*
Flow-based relevance pruning beats hop-first ordering on win rate across six
corpora, and relevance-scored triple selection beats path search. 2 hops is the
candidate bound, not the serving set.

**Rank by Personalized PageRank.** Rejected: *"PPR fails to reliably yield
improvements"*, measured across a full K sweep on top of a working retriever.

**Score candidates with a GNN.** Rejected: *"GNN variants often result in
performance degradation compared to their MLP counterparts,"* attributed to
semantic diffusion introducing noise — measured in the paper titled *Simple is
Effective*. Directional distance features (hop distance from each seed, with
direction) beat both GNNs and one-hot topic encoding and cost nothing.

**k=1 candidates.** Rejected: single-hop retrieval degrades significantly on
multi-hop questions, and the largest measured structured-reading gain in the
corpus is exactly at two hops (MetaQA-2hop 31.0 → 93.9). **k=3** is also
rejected: it multiplies the candidate set by the branching factor for a measured
near-zero return past depth 3.

**Let the worker do the hop.** Rejected. At matched context length, two-hop
association scores 70.7 against one-hop's 90.3 at 4K, and 25.9 against 56.2 at
32K; with chain-of-thought, *"two-hop examples with CoT prompting barely achieve
the scores of one-hop examples without CoT."* If a fact is two hops from the
task's entities, the retriever pulls it in as a direct edge rather than making
the worker chain it.

**Summarise or compress the served edges to fit more in.** Rejected. Measured:
vanilla 73.6/72.5 → summarised 68.9/61.8 → snippet 65.3/57.4. Compression *buys
correctness and sells attribution* — precisely the wrong trade for a package
whose claim is citation precision.

**Attach graph provenance after the worker writes.** Rejected, and this is the
single largest measured effect in the package's evidence base: 73.6 → 26.7
citation recall, while correctness moves −2.1. A post-hoc pipeline produces
citations that are ~2.7× less faithful while looking equally correct.

**Ask the model which edges are missing or contradictory.** Rejected.
Disconnected-node accuracy is 0.5% zero-shot and ≈0.0% under every other
prompting method tested. Absence is a query.

**Fall back to a global or random subgraph when seed resolution finds nothing.**
Rejected. Irrelevant context is measured to score below no context at all. Zero
seeds emits `NO GRAPH CONTEXT` and stops.

**Trust the worker's citations.** Rejected. The measured precision ceiling is
~72%, roughly one cited edge in four is wrong, and the metric is trivially
gameable — a control that copies the top passage verbatim and cites itself
scores 99.4/99.4 with 20.8 fluency. Every citation is verified.

**Depend on the graph store.** Rejected as a dependency. The builder reads
`graph.json`, `worklog.jsonl` and run-dir JSON. This is a hard boundary: if
GP-6 is deferred behind the query census, or if the store proves fragile, the
context builder and the gate keep working and lose only cross-run query
ergonomics.

**Make recency a load-bearing ranking signal.** Rejected as a default, retained
as an experiment. Nothing in the corpus measures recency as a ranking signal;
it is an assumption inherited from the source design. Its weight defaults to
zero and GP-7 sweeps it.

## The escape hatch, and its exact boundary

Tools return **facts, not context**. A tool call answers a question — does edge
`e07` exist; how many specs depend on `spec_4`; what are the neighbours of this
node under these relations — and does not dump another subgraph into the
transcript. The moment a tool returns 500 edges we have rebuilt context dumping
with extra steps. Four justified situations, and no others:

| Situation | Why the block cannot serve it |
|---|---|
| Seed resolution returned zero seeds | there is nothing to expand from |
| The candidate set overflowed and `truncated` is set | the worker may need the tail |
| The question is about absence or a count | models cannot read absence |
| An auditor is verifying a citation | it must be a lookup, not a judgement |

Two cautions attached to the hatch. Mid-generation retrieval is measured to hurt
both citation and correctness (73.6/72.5 → 58.3/58.2), so the hatch is for
bounded factual lookups, not for evidence expansion while writing. And the
assumption that `truncated == true` predicts "the worker needed more" is
untested; GP-7 instruments it, and if it does not hold, the hatch is dead weight
and should be removed.

## Risks

- **Our knee is not their knee.** The 100–200-triple knee was measured on
  Freebase KGQA with short triples. Foreman edges carry longer free-text objects,
  so tokens/edge will be higher and the knee will land at fewer edges. The
  2,000-token default is a starting point with a sweep attached, and the spec
  says so rather than presenting it as tuned.
- **Over-serving is the asymmetric failure.** Under-serving costs a follow-up
  question; over-serving is measured to go below the no-graph baseline. Every
  default in this package errs low, and the hard cap exists to make the error
  bounded even when someone raises the budget.
- **Subject grouping may hurt lookup-shaped questions.** Recorded above;
  A/B in GP-7.
- **Format preference does not transfer across vendors.** IoU below 0.2 between
  model families, and one measured 54-point catastrophe inside a family described
  as format-robust. Foreman is explicitly cross-vendor, so any hard-coded format
  is a bet on one vendor. Mitigated by the swappable serializer plus a per-vendor
  sweep.
- **Entity linking is necessary and not sufficient.** Seed quality bounds
  everything downstream, and graphify's own matcher has no stemming or synonyms.
  The vocabulary-expansion step is therefore in the builder's seed resolution as
  well as in the MCP wrapper.
- **We must not both optimise against and evaluate with the same checker.**
  Using the citation verifier as a training/selection signal breaks it as a
  metric. GP-7 keeps the evaluation arm separate from any reranking arm.
- **Multi-worker composition is untested anywhere.** Every measurement in this
  corpus is single-agent; whether a synthesizer reading findings from workers who
  each saw a *different* block composes or produces contradictory grounding is
  unknown. Recorded as an open question, not designed around.
- **The whole plane may not pay for itself.** Assembled neurosymbolic pipelines
  are measured to lose to their own text-only baselines by default. The block is
  therefore built behind a switch, the prompt-only baseline arm is preserved, and
  GP-7 owns the kill criteria.
