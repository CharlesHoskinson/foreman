# N1 — Neurosymbolic Foundations and the Current Landscape (through 2026-07)

**Lane:** N1 of the Foreman v0.2.9 neurosymbolic research sprint
**Scope:** foundations, taxonomy, landscape, measured integration patterns, grounding, negative results.
**Out of scope (sibling lanes):** N2 ontology engineering methodology, N3 how LLMs consume graphs (serialization/retrieval), N4 symbolic verification of LLM output.
**Date compiled:** 2026-07-28
**Evidence convention:** every claim below is tagged `VERIFIED` (page fetched into `/tmp/neurosym-docs/N1/`, abstract read directly) or `INFERRED` (my synthesis across fetched sources, not a quoted result). Numbers are quoted from the abstracts of the primary papers. Where a paper is a position paper with no measured number, it is labelled as such.

**One-line summary of what the evidence supports:** the symbolic layer reliably earns its keep as a *sound external checker over an explicit, auditable specification* — and reliably fails to earn it as a general accuracy booster bolted onto an unreliable extraction interface.

---

## 1. Sources fetched

All fetched via `scrapling extract get ... --ai-targeted` in WSL on 2026-07-28. Raw pages under `/tmp/neurosym-docs/N1/`, manifest at `/tmp/neurosym-docs/N1/MANIFEST.txt`. Discovery used the arXiv Atom API (`https://export.arxiv.org/api/query`) sorted by submission date descending, which is why coverage runs to 2026-07-25.

### 1.1 Taxonomy and framing

| URL | Status | Paper date | Notes |
|---|---|---|---|
| https://en.wikipedia.org/wiki/Neuro-symbolic_AI | VERIFIED | live, fetched 2026-07-28 | Reproduces Kautz's six-type taxonomy with representative examples; cites Sarker 2021 |
| https://arxiv.org/abs/2105.05330 | VERIFIED | 2021-05-11 | Sarker et al., *Neuro-Symbolic AI: Current Trends*; compares Kautz vs Bader/Hitzler categorisations |
| https://arxiv.org/abs/2012.05876 | VERIFIED | 2020-12-10 | Garcez & Lamb, *Neurosymbolic AI: The 3rd Wave* |
| https://arxiv.org/abs/2305.00813 | VERIFIED | 2023-05-01 | Sheth, Roy, Gaur, *Neurosymbolic AI — Why, What, and How* (IEEE Intelligent Systems) |
| https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/19122 | **FAIL** (empty body, 181 bytes) | 2022 | Kautz, *The Third AI Summer* (AI Magazine 43(1)) — primary source for the taxonomy |
| https://onlinelibrary.wiley.com/doi/10.1002/aaai.12036 | **FAIL** (0 bytes, publisher block) | 2022 | Same paper via Wiley |
| `api.semanticscholar.org` DOI:10.1002/aaai.12036 | **FAIL** (`paper not found`) | — | Attempted third route to the Kautz primary |

> **Recorded failure:** the Kautz primary could not be fetched by any of three routes. The taxonomy below is therefore sourced from Wikipedia + Sarker 2021, both of which cite it. Treat the six-type list as VERIFIED-via-secondary, not VERIFIED-primary.

### 1.2 Surveys and reviews

| URL | Status | Paper date | Paper |
|---|---|---|---|
| https://arxiv.org/abs/2202.12205 | VERIFIED | 2022-02-24 | Hamilton et al., *Is Neuro-Symbolic AI Meeting its Promise in NLP? A Structured Review* (Semantic Web journal) |
| https://arxiv.org/abs/2501.05435 | VERIFIED | 2025-01-09 | *Neuro-Symbolic AI in 2024: A Systematic Review* (PRISMA) |
| https://arxiv.org/abs/2306.08302 | VERIFIED | 2023-06-14 | *Unifying LLMs and Knowledge Graphs: A Roadmap* |
| https://arxiv.org/abs/2308.06374 | VERIFIED | 2023-08-11 | *LLMs and KGs: Opportunities and Challenges* |
| https://arxiv.org/abs/2510.20345 | VERIFIED | 2025-10-23 | *LLM-empowered Knowledge Graph Construction: A Survey* |
| https://arxiv.org/abs/2412.10390 | VERIFIED | 2024-11-30 | *Neural-Symbolic Reasoning over KGs: A Survey from a Query Perspective* |
| https://arxiv.org/abs/2606.08728 | VERIFIED | 2026-06-07 | *AI for Mathematical Reasoning: An Integrated Survey of LMs, Neuro-symbolic Systems, and ...* (47pp, under review) |
| https://arxiv.org/abs/2607.22811 | VERIFIED | 2026-07-24 | *From Hybrid Mechanistic–Data-Driven Modeling Toward Neuro-Symbolic AI: What, Why, and How* |
| https://arxiv.org/abs/2510.14538 | VERIFIED | 2025-10-16 | *Symbol Grounding in Neuro-Symbolic AI: A Gentle Introduction to Reasoning Shortcuts* |

### 1.3 Integration patterns (LLM → solver)

| URL | Status | Paper date | Paper |
|---|---|---|---|
| https://arxiv.org/abs/2305.12295 | VERIFIED | 2023-05-20 | Logic-LM (EMNLP 2023 Findings) |
| https://arxiv.org/abs/2305.09656 | VERIFIED | 2023-05-16 | SatLM (NeurIPS 2023) |
| https://arxiv.org/abs/2310.15164 | VERIFIED | 2023-10-23 | LINC (EMNLP 2023, Outstanding Paper) |
| https://arxiv.org/abs/2307.07696 | VERIFIED | 2023-07-15 | Yang/Ishay/Lee, *Coupling LLMs with Logic Programming* |
| https://arxiv.org/abs/2307.07699 | VERIFIED | 2023-07-15 | *Leveraging LLMs to Generate Answer Set Programs* |
| https://arxiv.org/abs/2407.11373 | VERIFIED | 2024-07-16 | *Reliable Reasoning Beyond Natural Language* (LLM→Prolog, NLR dataset) |
| https://arxiv.org/abs/2406.17663 | VERIFIED | 2024-06-25 | LLM-ARC (ASP actor–critic) |
| https://arxiv.org/abs/2407.18723 | VERIFIED | 2024-07-26 | LLASP (fine-tuning for ASP) |
| https://arxiv.org/abs/2604.27960 | VERIFIED | 2026-04-30 | *LLMs as ASP Programmers: Self-Correction Enables Task-Agnostic Nonmonotonic Reasoning* |
| https://arxiv.org/abs/2606.14935 | VERIFIED | 2026-06-12 | PrologMCP (Prolog as an MCP tool) |
| https://arxiv.org/abs/2607.21412 | VERIFIED | 2026-07-23 | Euclid-MCP (SWI-Prolog MCP server, Euclid-IR) |
| https://arxiv.org/abs/2607.19365 | VERIFIED | 2026-06-08 | *Logic-Guided Data Extraction with ASP and LLMs* |
| https://arxiv.org/abs/2508.12611 | VERIFIED | 2025-08-18 | *An LLM + ASP Workflow for Joint Entity-Relation Extraction* |
| https://arxiv.org/abs/2607.04096 | VERIFIED | 2026-07-05 | Forethought (neurosymbolic reasoning programs over tool primitives) |
| https://arxiv.org/abs/2606.16603 | VERIFIED | 2026-06-15 | VeriGraph (evidence DAG for data-analytic agents) |
| https://arxiv.org/abs/2607.16727 | VERIFIED | 2026-07-18 | CART (constraint-anchored reasoning traces) |
| https://arxiv.org/abs/2606.16886 | VERIFIED | 2026-06-15 | VerIbmc (loop-invariant synthesis, local open-weight models + ESBMC) |
| https://arxiv.org/abs/2607.01595 | VERIFIED | 2026-07-02 | PASE (cloud self-healing, neural-symbolic world model verifier) |
| https://arxiv.org/abs/2606.32004 | VERIFIED | 2026-06-30 | PolicyGuard (policy → typed relational rules + atom-level extraction) |
| https://arxiv.org/abs/2607.15776 | VERIFIED | 2026-07-17 | NeurOWL (OWL subsumption verification + abduction) |
| https://arxiv.org/abs/2605.27014 | VERIFIED | 2026-05-26 | ReasonOps (operational paradigm; position, no headline number) |
| https://arxiv.org/abs/2605.26942 | VERIFIED | 2026-05-26 | *Neuro-Symbolic Verification of LLM Outputs for Data-Sensitive Domains* (HAIMEDA) |

### 1.4 Grounding, canonicalisation, entity resolution

| URL | Status | Paper date | Paper |
|---|---|---|---|
| https://arxiv.org/abs/2305.19951 | VERIFIED | 2023-05-31 | *Not All Neuro-Symbolic Concepts Are Created Equal* (reasoning shortcuts, NeurIPS 2023) |
| https://arxiv.org/abs/2402.12240 | VERIFIED | 2024-02-19 | BEARS |
| https://arxiv.org/abs/2406.10368 | VERIFIED | 2024-06-14 | rsbench |
| https://arxiv.org/abs/2510.25497 | VERIFIED | 2025-10-29 | Prototypical Neurosymbolic architectures |
| https://arxiv.org/abs/2604.23377 | VERIFIED | 2026-04-25 | *Constraint-Based Analysis of Reasoning Shortcuts* (complexity results) |
| https://arxiv.org/abs/2607.21185 | VERIFIED | 2026-07-23 | *Differentiable Logic Programming to Mitigate Reasoning Shortcuts* |
| https://arxiv.org/abs/2404.03868 | VERIFIED | 2024-04-05 | EDC: Extract–Define–Canonicalize |
| https://arxiv.org/abs/2302.03905 | VERIFIED | 2023-02-08 | COMBO (open-KG canonicalisation benchmark) |
| https://arxiv.org/abs/2510.14271 | VERIFIED | 2025-10-16 | DEG-RAG (entity resolution over LLM-generated KGs) |
| https://arxiv.org/abs/2607.14149 | VERIFIED | 2026-07-14 | *Enhancing SLM Reasoning through KG Grounding* (CLUTRR, RGCN hints) |
| https://arxiv.org/abs/2606.16541 | VERIFIED | 2026-06-15 | *The Faithfulness Gap* (BPF, DriftBench) |
| https://arxiv.org/abs/2606.28013 | VERIFIED | 2026-06-26 | *The Signal-Coverage Matrix* (autoformalisation error stratification) |

### 1.5 Negative results and critiques

| URL | Status | Paper date | Paper |
|---|---|---|---|
| https://arxiv.org/abs/2607.15647 | VERIFIED | 2026-07-17 | LEED compliance — *and When Multimodal Hurts* (**NeSy underperforms baseline**) |
| https://arxiv.org/abs/2607.23386 | VERIFIED | 2026-07-25 | *Confidently Wrong: Exception Chain Collapse in Frontier LLM Rule Evaluation* |
| https://arxiv.org/abs/2606.17223 | VERIFIED | 2026-06-15 | *Safety, Security, and Cognitive Risks in Neuro-Symbolic AI* |
| https://arxiv.org/abs/2606.20208 | VERIFIED | 2026-06-18 | *Beyond Accuracy: Measuring Logical Compliance* (Rule Violation Score) |
| https://arxiv.org/abs/2507.19749 | VERIFIED | 2025-07-26 | ASPBench — *Can LLMs Solve ASP Problems?* |
| https://arxiv.org/abs/2604.22306 | VERIFIED | 2026-04-24 | BLAST (ASP code-gen benchmark) |
| https://arxiv.org/abs/2410.05229 | VERIFIED | 2024-10-07 | GSM-Symbolic |
| https://arxiv.org/abs/2305.18654 | VERIFIED | 2023-05-29 | Faith and Fate |
| https://arxiv.org/abs/2506.06941 | VERIFIED | 2025-06-07 | *The Illusion of Thinking* |
| https://arxiv.org/abs/2506.09250 | VERIFIED | 2025-06-10 | *The Illusion of the Illusion of Thinking* (rebuttal) |
| https://arxiv.org/abs/2402.01817 | VERIFIED | 2024-02-02 | LLM-Modulo (ICML 2024 position paper) |
| https://arxiv.org/abs/2402.08115 | VERIFIED | 2024-02-12 | *Self-Verification Limitations of LLMs* |
| https://arxiv.org/abs/2310.08118 | VERIFIED | 2023-10-12 | *Can LLMs Really Improve by Self-critiquing Their Own Plans?* |
| https://arxiv.org/abs/2310.01798 | VERIFIED | 2023-10-03 | *LLMs Cannot Self-Correct Reasoning Yet* |
| https://arxiv.org/abs/2405.04776 | VERIFIED | 2024-05-08 | *Chain of Thoughtlessness* |
| https://arxiv.org/abs/2206.10498 | VERIFIED | 2022-06-21 | PlanBench |
| https://arxiv.org/abs/2409.13373 | VERIFIED | 2024-09-20 | *LLMs Still Can't Plan; Can LRMs?* (o1 on PlanBench) |
| https://arxiv.org/abs/2403.04121 | VERIFIED | 2024-03-06 | Kambhampati, *Can LLMs Reason and Plan?* |
| https://arxiv.org/abs/2305.04388 | VERIFIED | 2023-05-07 | *LMs Don't Always Say What They Think* (CoT unfaithfulness) |
| https://arxiv.org/abs/2402.16837 | VERIFIED | 2024-02-26 | *Do LLMs Latently Perform Multi-Hop Reasoning?* |
| https://arxiv.org/abs/2606.13925 | VERIFIED | 2026-06-11 | *Sorries Are Not the Hard Part* |

**Totals: 69 pages fetched successfully, 2 failures (both routes to the Kautz primary).** No source was silently skipped.

---

## 2. Taxonomy and framing, mapped to implementable patterns

### 2.1 Kautz's six types

Source: Wikipedia *Neuro-symbolic AI* (VERIFIED, fetched 2026-07-28), which reproduces the taxonomy and its canonical examples and attributes the comparison to Sarker et al. 2021 (arXiv:2105.05330, VERIFIED). Primary (Kautz, *The Third AI Summer*, AI Magazine 43(1), 2022) **FAILED to fetch** — see §1.1.

| # | Kautz name | What it means | Canonical example | Implementable pattern (concrete) | Applies to a delivery orchestrator? |
|---|---|---|---|---|---|
| 1 | **Symbolic Neuro symbolic** | Symbols in, neural core, symbols out | BERT, GPT-3 | A bare LLM call. Tokens are the symbols; nothing is enforced. | This is the *status quo*, not a design. Baseline only. |
| 2 | **Symbolic[Neuro]** | A symbolic algorithm invokes a neural subroutine | AlphaGo (MCTS calling policy/value nets) | A deterministic driver (state machine, planner, scheduler) that calls an LLM as a scoring/proposal oracle at chosen decision points. | **Yes.** This is what a Foreman round-scheduler already is if the DAG walk is deterministic and the LLM only proposes. |
| 3 | **Neuro \| Symbolic** | Neural interprets raw input into symbols; symbolic reasons over them | Neuro-Symbolic Concept Learner; AlphaProof/Nexus | Two-stage pipeline: LLM extraction → typed symbolic store → solver/validator. `graphify` → TerminusDB → Datalog/ASP query is exactly this. | **Yes — the primary candidate.** Nearly all measured LLM+solver wins in §4 are Type 3. |
| 4 | **Neuro: Symbolic → Neuro** | Symbolic system generates or labels training data that a neural model then learns | Training a net on Macsyma-generated symbolic-math examples | Use the solver/gate outcomes as a training or few-shot corpus: harvest verdicts, failed gates, and repairs into prompt exemplars or fine-tuning data. | **Partially.** Cheap version = curated exemplar bank keyed by gate failure class. Fine-tuning is out of scope for an orchestrator. |
| 5 | **Neuro_Symbolic (NeuralSymbolic)** | A neural network is *generated from* symbolic rules; end-to-end differentiable | Neural Theorem Prover, Logic Tensor Networks, DeepProbLog | Compile the ontology into a differentiable loss / network structure and train. | **No.** Foreman has no gradient plane. This is where the reasoning-shortcut pathology lives (§6.2). Refuse. |
| 6 | **Neuro[Symbolic]** | Symbolic reasoning engine embedded *inside* the neural engine | Connectionist modal/temporal logics (Garcez, Lamb, Gabbay) | Combinatorial reasoning inside the network; in the LLM era, sometimes read as "solver invoked mid-generation". | **Only in the weak reading** — i.e. tool-calling a solver during generation (PrologMCP, Euclid-MCP). The strong reading is a research programme, not an engineering option. |

### 2.2 The standard three framings, and how they map

- **Symbolic-in-neural** (knowledge compiled into weights/architecture) ≈ Types 4, 5, 6. Hamilton et al. (VERIFIED, arXiv:2202.12205) found this family "leads to the most NeSy goals being satisfied" in their structured review — but see §6.1 for why that finding does not transfer to an LLM-era orchestrator.
- **Neural-in-symbolic** (symbolic control loop calling a neural oracle) ≈ Type 2. This is the LLM-Modulo shape (VERIFIED, arXiv:2402.01817).
- **Hybrid pipeline** (neural front-end, symbolic back-end) ≈ Type 3. This is where essentially all reproducible LLM-era gains sit.

**INFERRED:** the Kautz taxonomy was designed pre-LLM and is now load-bearing mostly as vocabulary. The operationally meaningful modern distinction is narrower: *does a sound, deterministic checker sit on the critical path, and does it own the final verdict?* Types 2 and 3 answer yes; Types 1, 4, 5, 6 answer no or "only in expectation". Every reliable measured result in §4 is Type 2 or Type 3.

### 2.3 Later refinements

- **Bader & Hitzler (2005)**, per Sarker et al. (VERIFIED): a finer categorisation asking whether the symbols carry non-trivial logic, and if so whether propositional or first-order. This distinction matters more than Kautz's for us: a "graph plane" that only enforces types and cardinalities is propositional-ish; one that enforces recursive rules over the work-DAG is genuinely first-order/Datalog.
- **Sheth, Roy, Gaur (2023)** (VERIFIED, arXiv:2305.00813) reframe along a *perception vs cognition* axis: neural for perception (raw → symbols), knowledge-guided symbolic for cognition (abstraction, reasoning, planning), with explicit retention of the perception→knowledge mapping as the requirement for control and explanation. **This is the most useful framing for Foreman**, because it names the interface (the perception→symbol mapping) as the thing that must be retained and audited — which is precisely where the failures cluster (§5, §6).
- **Hochreiter's claim** (via Wikipedia, VERIFIED) that GNNs "are the predominant models of neural-symbolic computing" is a stretch that we should not repeat; it conflates operating on graph-structured data with symbolic reasoning.

---

## 3. Survey consensus and stated open problems

### 3.1 What the surveys agree on

1. **The field is large, active, and evidentially thin in proportion to its size.** *Neuro-Symbolic AI in 2024: A Systematic Review* (VERIFIED, arXiv:2501.05435, PRISMA method, 2020–2024 peer-reviewed only, further filtered to papers with an available codebase) screened **1,428 papers and included 167**. Topic coverage: learning and inference 63%, knowledge representation 44%, logic and reasoning 35%, explainability/trustworthiness 28%, **meta-cognition 5%**.
   → **The 28% figure is the important one.** Trustworthiness and explainability are the two properties most often *claimed* as neurosymbolic's differentiator, and they are the least studied.
2. **The claimed benefits are not uniformly delivered, and the reason is methodological.** Hamilton et al. (VERIFIED, arXiv:2202.12205) reviewed NeSy-for-NLP against five promises — reasoning, OOD generalisation, interpretability, small-data learning, domain transfer — and report: systems that compile logic into the network satisfy the most goals; **knowledge-representation choice and neural architecture show no clear correlation with goals being met**; and there are "many discrepancies in how reasoning is defined", which "impact decisions about model architectures and drive conclusions which are not always consistent across studies". They call for better benchmarks before further architecture work.
3. **LLM+KG is framed as complementary, not competitive.** The roadmap survey (VERIFIED, arXiv:2306.08302) partitions the space into KG-enhanced LLMs, LLM-augmented KGs, and synergised LLMs+KGs. The 2025 construction survey (VERIFIED, arXiv:2510.20345) frames the live tension as **schema-based (structure, normalisation, consistency) vs schema-free (flexibility, open discovery)** paradigms across ontology engineering / extraction / fusion — the exact decision Foreman faces with TerminusDB.
4. **Evaluation is the bottleneck, not modelling.** The 2026 integrated maths-reasoning survey (VERIFIED, arXiv:2606.08728, 47pp) explicitly catalogues "benchmark saturation, contamination, reporting mismatches, and the distinction between pass@1, majority voting, and verifier-assisted pass@k" and names the failure modes as "brittleness under perturbation, reward hacking, multimodal grounding failures, fragile formalization, and the energy cost of reasoning-scale inference."

### 3.2 Open problems the surveys themselves state

- **Concept/symbol grounding without concept supervision** — named as unsolved by the reasoning-shortcuts overview (VERIFIED, arXiv:2510.14538) and empirically confirmed by rsbench (VERIFIED, arXiv:2406.10368): "obtaining high quality concepts in both purely neural and neuro-symbolic models is a far-from-solved problem."
- **Benchmarks that separate "got the right answer" from "reasoned correctly"** — Hamilton et al.; rsbench; and the Rule Violation Score paper (VERIFIED, arXiv:2606.20208), which shows two models with comparable predictive accuracy can differ substantially in logical compliance.
- **Meta-cognition / knowing when the symbolic layer should be trusted** — 5% coverage per arXiv:2501.05435.
- **Fragile formalisation** — arXiv:2606.08728; quantified by the Faithfulness Gap and Signal-Coverage papers (§5.3).
- **Scaling KG construction beyond a schema that fits in a context window** — EDC (VERIFIED, arXiv:2404.03868) names this as the principal issue in prior LLM-KGC work.

---

## 4. Integration patterns that demonstrably work, with measured deltas

Every number here is from the paper's own abstract (VERIFIED). Read §4.6 before trusting any of them for a software-delivery setting.

### 4.1 LLM → FOL / SMT / symbolic solver ("semantic parser + prover")

| System | Benchmark | Measured delta | Source |
|---|---|---|---|
| **Logic-LM** (LLM → FOL/CSP/SAT solvers, with solver-error self-refinement) | ProofWriter, PrOntoQA, FOLIO, LogicalDeduction, AR-LSAT | **+39.2%** avg over standard prompting; **+18.4%** over CoT | arXiv:2305.12295 (EMNLP 2023 Findings) |
| **SatLM** (LLM emits a *declarative spec*, SMT solver derives the answer) | 8 datasets | **+23%** over program-aided LMs on a challenging GSM subset; new SoTA on LSAT and BoardgameQA | arXiv:2305.09656 (NeurIPS 2023) |
| **LINC** (LLM as semantic parser → FOL theorem prover) | ProofWriter, FOLIO | StarCoder+ (15.5B) + LINC beats **GPT-3.5 CoT by +38 points absolute** and **GPT-4 CoT by +10 points absolute** on ProofWriter; GPT-4+LINC **+26%** over CoT on ProofWriter, comparable on FOLIO | arXiv:2310.15164 (EMNLP 2023 Outstanding Paper) |

**Task class it helps on:** closed-world deductive entailment where the premises are fully stated in the prompt and the target is a truth value or a unique model.

**Failure modes (VERIFIED):**
- LINC's own analysis is the most honest datapoint in this group: on FOLIO, LINC and CoT "succeed roughly equally often" but "exhibit distinct and complementary failure modes." Translation: the gain is *not* uniform improvement, it is trading one error distribution for another. On some datasets that trade is worth ~0.
- Logic-LM's gain depends on a self-refinement loop fed by solver error messages. The solver's contribution is inseparable from the *feedback channel* — see §4.4.
- Both are parse-limited: if the LLM mis-parses a premise, the prover proves the wrong thing with full confidence. This is the faithfulness gap (§5.3).

### 4.2 LLM → ASP (Answer Set Programming) — the non-monotonic case

| System | Result | Source |
|---|---|---|
| **Yang/Ishay/Lee** (LLM as few-shot semantic parser → reusable ASP knowledge modules) | SoTA on bAbI, StepGame, CLUTRR, gSCAN; solves robot-planning tasks "that an LLM alone fails to solve" | arXiv:2307.07696 |
| **LLM-ARC** (LLM Actor writes ASP + tests; Automated Reasoning Critic runs them and feeds back) | **88.32% on FOLIO** (SoTA at time of publication); best result from a fully automated self-supervised loop on dialog traces with critic feedback | arXiv:2406.17663 |
| **LLM+ASP, task-agnostic** (2026) | Across six benchmarks: stable-model semantics **outperforms SMT-based alternatives by significant margins on non-monotonic tasks**; **iterative self-correction is the primary driver of performance**, replacing hand-authored domain knowledge; compact in-context reference guides beat verbose docs — a **"context rot"** effect where excess context hinders constraint adherence | arXiv:2604.27960 |
| **LLM + ASP for joint entity-relation extraction** | **2.5× improvement (35% vs 15%)** on SciERC relation extraction using **only 10% of training data**; ASP's elaboration tolerance means adding domain type specifications requires *no change to the core program* | arXiv:2508.12611 |
| **Logic-guided extraction with ASP** (2026) | ASP decides which predicates are logically admissible at each stage, guiding extraction; **provably equivalent to the baseline w.r.t. final extracted facts while requiring fewer LLM calls**; detects inconsistencies early | arXiv:2607.19365 |

**Why ASP specifically:** it is non-monotonic. Defaults with exceptions ("required UNLESS ... UNLESS ...") are natural in stable-model semantics and awkward in SMT. arXiv:2604.27960 measures exactly this advantage.

**Failure modes (VERIFIED, and these are severe):**
- **LLMs are bad at ASP.** LLASP (arXiv:2407.18723): "empirical results demonstrate inadequate performances in generating correct ASP programs" from SOTA LLMs despite their scale; a small fine-tuned model beats most of them.
- **ASPBench** (arXiv:2507.19749): 14 SOTA models incl. deepseek-r1, o4-mini, gemini-2.5-flash-thinking do "relatively well" on ASP entailment and answer-set *verification* but **struggle with answer set computation, the core of ASP solving**. The asymmetry is the point: LLMs can check a candidate model far better than they can produce one.
- **BLAST** (arXiv:2604.22306) exists because no dedicated ASP code-generation benchmark did before 2026. The measurement infrastructure is one year old. Treat all pre-2026 ASP-generation claims as under-measured.

### 4.3 LLM → Prolog / Datalog, and tool-calling a reasoner

| System | Result | Source |
|---|---|---|
| **LLM → Prolog** (NLR dataset: 55 hand-designed problems needing iterative updates, backtracking, parallel chains) | "Large and robust" gains on GSM8k and BIG-bench Navigate; **near-perfect accuracy on NLR**, robust as variable interdependence increases | arXiv:2407.11373 |
| **PrologMCP** (Prolog exposed as a stateful MCP tool; translate–run–inspect–repair loop) | On PARARULE-Plus general sample: formalizer **1.00** vs reasoning LLMs 1.00 / 0.998, vs standard GPT-4.1 **0.762**. On the challenging subset: formalizer **1.00 / 0.99** while reasoning LLMs **drop to 0.95 / 0.94** | arXiv:2606.14935 |
| **Euclid-MCP** (SWI-Prolog MCP server, engine-agnostic Horn-clause IR, proof traces exposed) | IT-security/compliance use case: **LLMs alone are sufficient on small knowledge bases but hallucinate systematically on larger ones**; Euclid-MCP gives exact answers with lower latency and more compact output. Explicit claim: **"semantic RAG is fundamentally unsuited for rule enforcement"** | arXiv:2607.21412 |

**This is the pattern with the best cost/benefit for an orchestrator.** It requires no training, no differentiable anything, and the integration surface is a tool call. Both 2026 MCP papers independently converge on the same primitive: **translate → run → inspect → repair**, with structured solver errors as the feedback channel and proof traces as the audit artefact.

**Failure modes:** the Euclid-MCP result cuts both ways — on *small* rule bases the LLM alone was sufficient, meaning the symbolic layer bought nothing. The gain appears only past a KB-size threshold the paper does not generalise. **INFERRED:** there is a break-even size below which the symbolic layer is pure overhead, and no paper in this corpus characterises it.

### 4.4 The external-verifier loop (LLM-Modulo shape) — where the strongest *negative-derived* evidence lives

This is the single most decision-relevant finding for Foreman, and it comes from the critique literature, not the advocacy literature.

- **Stechly, Valmeekam, Kambhampati** (VERIFIED, arXiv:2402.08115), GPT-4 on Game of 24, Graph Colouring, and STRIPS planning: **"significant performance collapse with self-critique and significant performance gains with sound external verification."** And critically: **"merely re-prompting with a sound verifier maintains most of the benefits of more involved setups."**
- **Valmeekam et al.** (VERIFIED, arXiv:2310.08118), GPT-4 as both planner and verifier: self-critiquing **diminishes** plan generation performance vs a system with an external sound verifier; the LLM verifier produces **"a notable number of false positives, compromising the system's reliability"**; binary vs detailed feedback made **minimal difference**.
- **Huang et al.** (VERIFIED, arXiv:2310.01798): LLMs "struggle to self-correct their responses without external feedback, and at times, their performance even degrades after self-correction."
- **LLM-Modulo** (VERIFIED, arXiv:2402.01817, ICML 2024) is the constructive proposal: LLMs as "universal approximate knowledge sources" inside a bi-directional loop with external model-based verifiers, with the verifiers' models themselves partly LLM-acquired. **This is a position paper. It reports no headline number.** Cite it for the architecture, never for a measured claim.

**INFERRED but well-supported:** the ordering is (external sound verifier + simple re-prompt) > (elaborate agentic self-critique scaffolding) > (bare LLM). The scaffolding is where teams spend engineering effort and where the evidence says the return is smallest.

### 4.5 Applied 2026 systems with measured numbers

| System | Domain | Measured result | Source |
|---|---|---|---|
| **Aethis Eligibility Module** | Regulated eligibility rules | 225-scenario benchmark / 4 domains; 20-scenario adversarial: **engine 20/20**, only 1 of 4 frontier configs matched, 3 failed incl. "Anthropic's strongest model at evaluation time"; LegalBench 9 tasks / 949 held-out cases: engine **significantly more accurate than all three frontier models, combined McNemar p ≤ 0.003, margins up to +41 points** | arXiv:2607.23386 |
| **VerIbmc** | Loop-invariant synthesis (formal software verification) | Best config (GPT-OSS-120B, local) solves **431/499 = 86.4%**; **symbolic invariant synthesis alone solves 75 problems with zero LLM calls**, and adds **up to +35** for the weakest model; competitive with cloud-API tools on a single local machine | arXiv:2606.16886 |
| **PASE** | Cloud fault self-healing (LLM plan synthesis + neural-symbolic world model verifier + DRL meta-prompt optimiser) | **>40% reduction in average system recovery time**; improved fault detection on unknown faults | arXiv:2607.01595 |
| **VeriGraph** | Verifiable data-analytic agents; explicit heterogeneous evidence DAG; traceability = graph reachability from raw sources to terminal claims | VeriGraph-8B highest overall score across 4 benchmarks; **87.61% claim-level Grounding Rate** | arXiv:2606.16603 |
| **HAIMEDA** | Medical-device damage assessment; formal logic for input verification + embedding similarity for output validation, actor-based parallel pipeline | **>83%** hallucination detection for structured entities, **72%** for semantic fabrications, **30% reduction in report creation time** | arXiv:2605.26942 |
| **CART** | Multimodal CoT with machine-checkable constraint assertions + backtracking | **Snowball rate 0.65 → 0.14**; **+4.6pp** GQA; 89.1 F1 POPE-all; **≤18% inference overhead** | arXiv:2607.16727 |
| **Forethought** | Agentic tool-calling as explicit verifiable reasoning programs over a DSL of symbolic+neural primitives | **~30% relative** accuracy improvement over base model across 5 benchmarks; beats prompting, RL scaffolds, prompt-evolution; a non-reasoning model + Forethought competes with a dedicated reasoning model at **~3 orders of magnitude less post-training investment**; model-agnostic and auditable | arXiv:2607.04096 |

### 4.6 The caveat that governs all of §4

**INFERRED, and I consider it the most important qualification in this document:** with the exception of VerIbmc, PASE, VeriGraph and the Aethis LegalBench evaluation, essentially every headline number above was measured on *closed-world, synthetically-generated or curated logical benchmarks* — ProofWriter, PrOntoQA, PARARULE-Plus, bAbI, CLUTRR, gSCAN, FOLIO, logic puzzles. These share three properties that software delivery does not have: (a) the premises are complete and stated, (b) there is a unique ground-truth answer, (c) the vocabulary is small and closed. **Nothing in this corpus measures LLM→solver gains on open-domain, incompletely-specified, evolving engineering artefacts.** Any transfer to Foreman is extrapolation and must be labelled as such.

---

## 5. Where the symbolic layer earns its keep — and where the evidence is weak

Graded honestly. "Strong" means multiple independent measured results; "moderate" means one good measured result; "weak" means asserted more than measured.

### 5.1 Consistency and constraint checking over an explicit rule set — **STRONG**

- Aethis/Confidently Wrong (arXiv:2607.23386): +41 points over frontier models on curated multi-prong LegalBench tasks, p ≤ 0.003. The mechanism is explicit: LLMs *author* rules from authoritative sources, an SMT layer *executes* them deterministically. The paper's own framing is the best sentence in the corpus: it **"relocates uncertainty from the inference boundary, where it is silent, to the specification boundary, where it is deliberate and audited."**
- Rule Violation Score (arXiv:2606.20208): the reason you need this layer at all — two models at comparable predictive accuracy can exhibit substantially different logical compliance, and no standard metric captures it. RVS is computable as auto-generated SQL over Horn rules, i.e. cheap.
- PolicyGuard (arXiv:2606.32004): converts policy into typed relational rules + atom-level extraction questions; LLMs answer the *local* questions, the symbolic evaluator applies the rules. Qualitative claims only (explicit, maintainable, testable) — **no accuracy number reported**, so do not cite it as measured evidence.

### 5.2 Planning — **STRONG NEGATIVE for LLM-alone; MODERATE POSITIVE for LLM-in-a-verified-loop**

- PlanBench (arXiv:2206.10498) and its o1 follow-up (arXiv:2409.13373): o1's performance is "a quantum improvement... still far from saturating it", with explicit open questions on "accuracy, efficiency, and guarantees which must be considered before deploying such systems." Note the qualitative phrasing — the abstract gives no percentage.
- Chain of Thoughtlessness (arXiv:2405.04776): in Blocksworld, CoT helps **only when prompts are "exceedingly specific to their problem class"**, and gains "quickly deteriorate as the size n of the query-specified stack grows past the size of stacks shown in the examples." The authors call out "the sharp tradeoff between possible performance gains and the amount of human labor necessary to generate examples with correct reasoning traces."
- Positive side: §4.4's external-verifier results, plus PASE's >40% recovery-time reduction (arXiv:2607.01595).

### 5.3 Verification of generated claims / faithfulness of the neural→symbolic translation — **MODERATE, and the numbers are alarming**

- **The Faithfulness Gap** (arXiv:2606.16541): "translating natural-language mathematics into formal proof assistants is bottlenecked not by translation fluency but by *faithfulness*: a formal statement can typecheck and be provable, yet still encode a different theorem than the source intended." On DriftBench (2,183 NL/Lean4 pairs with controlled drift labels), Bidirectional Provability Fingerprinting + Counterfactual Probe Generation detects **89.6% of drifted formalisations at a 3.0% false-positive rate — against 41.2% for typecheck and 63.3% for an LLM-judge baseline.** Faithfulness-guided decoding cuts a SoTA autoformalizer's drift-emission rate by **47%**.
  → **Read the baseline numbers again. Typecheck catches 41.2% of semantic drift. An LLM judge catches 63.3%.** If your pipeline's only defence against "the LLM formalised the wrong thing" is that the formal artefact validates, you are catching under half of it.
- **The Signal-Coverage Matrix** (arXiv:2606.28013): headline autoformalisation type-correctness rose from **~53% to ~76% in two years**, but crossing the elaborator with a semantic-equivalence judgment shows the +34 to +36 true-success gain from elaborator-feedback methods is **~64% type-stratum recovery, with the semantic-only stratum flat on net** (87.5% of original semantic errors rescued, **8 newly created**). Two judges disagree by **26–37 percentage points** on elab-feedback outputs (vs 7pp on vanilla). Conclusion: "TC% gains should be credited by which cell moved, not by the scalar alone."
- **Sorries Are Not the Hard Part** (arXiv:2606.13925): expert review of a semi-autonomous formalisation found "serious problems in definitions, theorem generality, file organization, and the API" despite compiling with no sorries. Before/after refactor shows a sharp split: **agents adapt well to local, mechanically-checkable feedback, but remain weak at choosing definitions and designing APIs.**
- Positive: VeriGraph's 87.61% grounding rate and HAIMEDA's 83%/72% detection rates (§4.5). Both single-paper, unreplicated.

### 5.4 Multi-hop reasoning — **MIXED, weaker than the marketing**

- Positive: Logic-LM / LINC / LLM+ASP results (§4.1–4.2) are largely multi-hop entailment tasks.
- Negative: *Do LLMs Latently Perform Multi-Hop Reasoning?* (arXiv:2402.16837) finds strong evidence of a latent pathway for **certain relation types** (used in >80% of those prompts), but "the evidence for the second hop and the full multi-hop traversal is rather moderate and only substantial for the first hop", and there is **a clear scaling trend for the first hop but not the second.** Scale does not fix hop 2.
- Negative-in-the-hybrid: *Enhancing SLM Reasoning through KG Grounding* (arXiv:2607.14149) on CLUTRR — RGCN-derived hints give a **1.5–2× gain over story-only baselines**, but the system is "constrained by the extraction bottleneck and sequential deductive fragility, where early extraction errors compound over multi-hop chains", and they identify a **"distraction effect" in specific architectures where noisy self-generated facts degrade performance despite the presence of expert hints.**
  → **That last clause is a direct warning for Foreman:** a graph plane populated by imperfect LLM extraction can make downstream reasoning *worse* than no graph, even when a correct oracle signal is also available.

### 5.5 Interpretability and trust — **WEAK. This is the field's biggest credibility gap.**

- Only 28% of the 167 included studies in arXiv:2501.05435 touch explainability/trustworthiness at all; meta-cognition is 5%.
- The reasoning-shortcut literature (§6.2) shows symbolic conformance can *coexist with* wrong concept semantics, which directly undermines "the symbolic layer makes it interpretable."
- The NeSy safety paper (arXiv:2606.17223) goes further and argues NeSy's explicit logical explanations **structurally amplify** automation bias, authority bias and sycophantic reinforcement relative to black-box neural outputs. A rule trace is more persuasive than a probability, whether or not it is right.

### 5.6 Where it does NOT earn its keep

- **When the extraction interface is the weak link.** See §6.1 (LEED).
- **When the rule base is small.** Euclid-MCP: "LLMs alone are sufficient on small knowledge bases."
- **As a generic accuracy booster on open-ended generation.** No paper in this corpus demonstrates that.

---

## 6. Negative results and critiques

This section is deliberately the longest. A lane that returned only supportive evidence would have failed.

### 6.1 A neurosymbolic pipeline that *lost* to its own text-only baseline

**arXiv:2607.15647** (VERIFIED, 2026-07-17), LEED v4.1 BD+C compliance screening — 4 university buildings, 484 PDFs, 153 credit-level decisions:

- Best **text-only** core verifier (gemma3:4b): **67.3%** accuracy.
- **Full neuro-symbolic configuration: 61.6%** — **5.7 points worse than the text-only baseline.** The authors attribute it to "extraction failures and conservative behavior on qualitative categories."
- The deterministic numeric checker *did* work where it applied: EA-p2 went **50% → 100%**.
- A 4B model **outperformed** an 8B model on this task.
- Ablations: adding low-resolution drawing images (150–300 dpi) **consistently reduces accuracy**.
- Prompt strategy interacts with ground-truth base rate: rubric prompts win on documentation-rich projects, CoT prompts win on documentation-lean ones.

**Why this matters more than any single positive result:** it is a well-instrumented, honestly-reported case where the symbolic component helped *locally* (arithmetic) and the assembled neurosymbolic system lost *globally*. The composition was net-negative because the symbolic layer's inputs came through a lossy extractor and its conservatism cost more than its precision gained. **This is the default failure mode of the architecture Foreman is considering.**

### 6.2 Reasoning shortcuts: the symbolic layer can be fully satisfied by wrong symbols

This is the deepest theoretical critique of NeSy and it is now well-established.

- **Marconato et al.** (arXiv:2305.19951, NeurIPS 2023): NeSy predictors "can attain high accuracy but by leveraging concepts with unintended semantics." They characterise RSs as *unintended optima of the learning objective*, identify **four key conditions**, derive mitigations, and conclude: **"reasoning shortcuts are difficult to deal with, casting doubts on the trustworthiness and interpretability of existing NeSy solutions."**
- **rsbench** (arXiv:2406.10368): benchmark suite plus formal verification procedures for detecting RSs; finding: high-quality concepts are far from solved in **both** purely neural and neurosymbolic models.
- **BEARS** (arXiv:2402.12240): RSs are linked to NeSy models being **overconfident** about predicted concepts; the only trustworthy mitigation requires costly dense concept supervision, so BEARS instead calibrates concept-level confidence so users can *distrust* low-quality concepts.
- **Complexity results** (arXiv:2604.23377, 2026-04): deciding shortcut-freeness is **coNP-complete**, counting shortcuts is **#P-complete**, finding minimal repairs is **NP-hard**. A "discrimination property" is **necessary but demonstrably insufficient** for shortcut-freeness even when the constraint graph is connected. On the constructive side: logarithmically many label queries suffice for disambiguation in favourable cases.
- **Mitigation is architectural, not incidental** (arXiv:2607.21185, 2026-07): **one-to-one grounding of neural outputs to logical atoms significantly reduces both constraint-satisfaction shortcuts and cognition shortcuts, compared to methods relying on soft probability distributions.** Architectural coupling choices are decisive.
- **Overview**: arXiv:2510.14538 (2025-10) — the literature is "scattered"; RSs are "difficult to detect and prevent unless concept supervision is available, which is typically not the case."

**Scope caveat (INFERRED, important):** the RS literature is about *end-to-end trained* NeSy predictors (Kautz Type 5) where concepts are learned under weak label supervision. Foreman has no such training loop. **The RS results do not transfer literally.** What transfers is the *shape* of the pathology: a downstream symbolic check that passes does not certify that the upstream symbols mean what you think. Foreman's analogue is the faithfulness gap (§5.3) — the LLM extracts a triple that validates against the ontology and is still about the wrong entity. Same lesson, different mechanism.

### 6.3 The symbolic/graph layer is an attack surface, and its own consistency checks do not defend it

**arXiv:2606.17223** (VERIFIED, 2026-06-15), *Safety, Security, and Cognitive Risks in Neuro-Symbolic AI*. NeSy adds an attack surface across five layers (neural perception, symbolic KBs, reasoning engines, agentic orchestration, data stores), "each exploitable in ways absent from purely neural systems." Three empirical benchmarks:

- **E1:** targeted KG poisoning reaches break-even Symbolic Integrity Violation at an injection budget of **B = 5** on a **205-entity** medical KG.
- **E2:** PGD-10 at ε=0.01 on a DistilBERT+ProbLog pipeline yields a Cross-Layer Amplification Ratio **X = 5.884** (95% CI [4.64, 8.00], p < 0.0001), confirmed adversarially specific by a matched-random baseline (X_rand = 0).
- **E3:** **single-axiom OWL edits achieve 93.3% SIV success with 100% Pellet-consistency stealth** — and held-out detection **fails at 50%, i.e. random guessing**, which the authors flag as an open problem.

**Read E3 carefully.** A single axiom edit subverts inference 93.3% of the time while the ontology reasoner reports it perfectly consistent, and detection is at chance. **Ontology consistency is not integrity.** Any design that treats "TerminusDB accepted the commit" as a trust signal is relying on a check that has been measured to be blind to this attack.

### 6.4 The LLM side does not do what the hybrid architecture assumes

- **Faith and Fate** (arXiv:2305.18654): across multi-digit multiplication, logic grid puzzles, and dynamic programming, transformers "solve compositional tasks by reducing multi-step compositional reasoning into **linearized subgraph matching**, without necessarily developing systematic problem-solving skills", with theoretical arguments that autoregressive performance "can rapidly decay with increased task complexity."
- **GSM-Symbolic** (arXiv:2410.05229, ICLR): performance of **all** models declines when only the numerical values change; degrades sharply as clause count grows; **adding a single seemingly-relevant but logically irrelevant clause causes drops of up to 65% across all SoTA models.** Their hypothesis: models "replicate reasoning steps from their training data" rather than reasoning.
- **CoT is not a faithful account of the computation** (arXiv:2305.04388): biasing features (e.g. reordering multiple-choice options so the answer is always "(A)") systematically change CoT explanations while models fail to mention them; accuracy drops **up to 36%** across 13 BIG-Bench Hard tasks (GPT-3.5, Claude 1.0). "CoT explanations can be plausible yet misleading."
- **Self-correction does not work intrinsically** — arXiv:2310.01798, arXiv:2310.08118, arXiv:2402.08115 (§4.4).
- **Frontier rule evaluation drifts silently** (arXiv:2607.23386): between March and April 2026, **"several failure cells closed silently under the same model alias, with no version bump (GPT-5.4 on construction insurance moved from 96.6% to 100%, same prompt and harness)."** The authors' conclusion is the one that matters for anyone building on hosted models: **"frontier-model accuracy is a moving compliance boundary that shifts without notice."**

### 6.5 The contested case: *Illusion of Thinking* and its rebuttal

Included because it is the highest-profile "LLMs can't reason" result of the period and because **the rebuttal largely holds.**

- **arXiv:2506.06941** (Shojaee et al.): LRMs show "complete accuracy collapse beyond certain complexities" and a counterintuitive scaling limit where reasoning effort *declines* past a complexity point despite remaining token budget; three regimes (standard LLMs win at low complexity, LRMs win at medium, both collapse at high).
- **arXiv:2506.09250** (rebuttal): the findings "primarily reflect experimental design limitations rather than fundamental reasoning failures" — (1) Tower of Hanoi runs risk exceeding output token limits, with models explicitly saying so; (2) the automated evaluator conflates reasoning failure with practical constraints; (3) **River Crossing instances for N > 5 are mathematically impossible given the stated boat capacity, yet models were scored as failures for not solving unsolvable problems.** Controlling for these (asking for generating functions rather than exhaustive move lists) yields high accuracy on instances previously reported as total failures.

**Verdict (INFERRED):** cite *Illusion of Thinking* only alongside its rebuttal. The methodological lesson — that a benchmark can manufacture "collapse" through output-format and instance-validity artefacts — is more durable than either paper's headline, and it applies directly to how Foreman would evaluate its own graph plane.

### 6.6 Critiques of the field's engineering economics

- Hamilton et al. (arXiv:2202.12205): after a structured review, KR choice and neural architecture show **no clear correlation** with NeSy goals being met — i.e. much of the architectural variety in the literature is not buying measurable outcomes. They call for methodological discipline and better benchmarks first.
- arXiv:2501.05435: only 167 of 1,428 screened papers survived filtering to peer-reviewed with an available codebase — an **~88% attrition rate** on basic reproducibility grounds.
- Euclid-MCP (arXiv:2607.21412): "most integrations are bespoke and lack a standardized interface" — the field's integration cost is re-paid per project. Both 2026 MCP papers exist specifically to amortise it.
- Chain of Thoughtlessness (arXiv:2405.04776) names the labour cost directly: gains require "carefully engineering highly problem specific prompts", with "a sharp tradeoff between possible performance gains and the amount of human labor necessary."
- **INFERRED:** no paper in this corpus reports engineering hours, maintenance burden, or total cost of ownership for a neurosymbolic pipeline versus its neural baseline. Given the LEED result shows the composition can be net-negative on accuracy alone, **the absence of cost accounting in this literature is itself a finding.**

---

## 7. The grounding / unification problem

**The problem:** the neural side produces surface forms ("the auth refactor", "PR #412", "that flaky test"); the symbolic side needs canonical entities with stable identity. Every downstream guarantee — consistency, provenance, multi-hop query — is conditional on that mapping being right, and the mapping is exactly the part no solver can check.

### 7.1 What the KG / entity-resolution literature contributes

- **COMBO** (arXiv:2302.03905): open KG triples "have severe redundancy and ambiguity and need to be canonicalized." COMBO adds gold canonicalisation for **relation phrases** and **ontology-level** canonicalisation for noun phrases, plus source sentences. Finding: properly encoding phrases in context with pretrained LMs improves relation and ontology-level canonicalisation. **Note the two-level structure — entity-level canonicalisation alone is insufficient.**
- **EDC** (arXiv:2404.03868): three phases — open extraction, schema definition, **post-hoc canonicalisation** — deliberately decoupling extraction from schema conformance so the schema need not fit in the prompt. Works with or without a predefined schema (self-canonicalisation in the latter case), plus a trained schema-element retriever.
- **DEG-RAG** (arXiv:2510.14271): LLM-built KGs are "noisy... with redundant entities and unreliable relationships"; entity resolution plus "triple reflection" yields compact, higher-quality KGs that "significantly outperform their unprocessed counterparts" across diverse Graph-RAG variants, while reducing graph size and compute. They claim the **first comprehensive exploration of entity resolution for LLM-generated KGs**, systematically varying blocking strategies, embeddings, similarity metrics and merging techniques.

### 7.2 What the *neurosymbolic* literature adds that entity resolution does not

This is the part worth extracting, because it is genuinely different:

1. **A formal account of why a passing symbolic check does not certify grounding.** Reasoning shortcuts (arXiv:2305.19951) prove that a model can satisfy the constraints *because* the concept mapping is wrong, not despite it. Entity-resolution literature measures mapping accuracy against gold labels; NeSy literature asks what happens **when no gold labels exist** — which is Foreman's situation for most extracted entities.
2. **Complexity bounds on when a constraint set even *determines* the grounding.** arXiv:2604.23377: shortcut-freeness is coNP-complete; a "discrimination property" is necessary but insufficient; and there is a **constructive repair procedure** — a greedy algorithm that eliminates shortcuts by *augmenting the constraint set*, converging in at most k iterations where k is the number of alternative valid mappings, with an ASP-based sound-and-complete verifier for "does this constraint set uniquely determine the intended mapping?" **This is a genuinely actionable idea an ER pipeline would never produce: treat ambiguity in the grounding as a deficiency of the ontology's constraints, and repair the ontology rather than the data.**
3. **Sample-complexity for disambiguation by asking.** Same paper: logarithmically many label queries suffice in favourable cases, all ambiguous positions in the worst case. That converts "grounding is uncertain" into a budgeted human-in-the-loop question.
4. **Architectural determinants of grounding quality.** arXiv:2607.21185: one-to-one grounding of outputs to logical atoms beats soft probability distributions for shortcut avoidance. Translated out of the differentiable setting: **commit to a single canonical entity at the write boundary; do not carry distributions of candidate identities into the graph.**
5. **Calibrated distrust as a first-class output.** BEARS (arXiv:2402.12240): when you cannot fix the grounding, make the model *aware* of which concepts are ambiguous, so consumers can distrust them selectively. The graph-plane analogue is a per-node grounding-confidence field that queries can filter on.
6. **Grounding failure is contagious and can be net-negative.** arXiv:2607.14149's "distraction effect": noisy self-extracted facts degrade performance **even when a correct expert signal is also present**. Adding a low-quality graph is not a no-op.
7. **Faithfulness ≠ well-formedness, quantified.** The Faithfulness Gap (arXiv:2606.16541): typecheck catches 41.2% of semantic drift, an LLM judge 63.3%, and a purpose-built bidirectional-consequence probe 89.6% at 3% FPR. The generalisable insight is the *method*: check the formal artefact by **probing its consequence neighbourhood** against probes derived from the source text, rather than by checking that it is well-formed. **INFERRED:** the graph-plane analogue is to verify an extracted subgraph by generating entailed and non-entailed queries from it, and checking those against the source document — not by validating it against the schema.

### 7.3 Honest gap

**INFERRED:** nobody in this corpus solves grounding. The state of the art is (a) canonicalise as an explicit post-hoc phase rather than inline (EDC), (b) run real entity resolution before writing (DEG-RAG), (c) measure ambiguity and expose it (BEARS, rsbench), (d) repair the constraint set when it fails to determine the mapping (arXiv:2604.23377), and (e) probe consequences rather than trust well-formedness (arXiv:2606.16541). All five are compatible and none is sufficient.

---

## 8. Relevance to Foreman — adopt, defer, refuse

Blunt, as requested.

### 8.1 Adopt

1. **Kautz Type 3 pipeline as the default shape, with a Type 2 outer loop.** `graphify` (neural) → typed store → deterministic checker (symbolic), with a deterministic scheduler calling the LLM only at designated proposal points. Every reproducible measured win in §4 is Type 2 or Type 3. This is not a research bet.
2. **Sound external verifier owns the verdict; LLM critics are evidence, not proof.** arXiv:2402.08115 measures self-critique collapse and external-verifier gains, and — crucially — that "merely re-prompting with a sound verifier maintains most of the benefits of more involved setups." **Direct consequence: `codex-auditor` is another LLM. It is not a sound verifier.** Its output belongs in the evidence graph as a claim with provenance, never as a gate. The gate must be tests, typecheck, lints, build, and graph invariants. arXiv:2310.08118 further shows LLM verifiers produce a notable false-positive rate — for a merge gate that is the expensive direction of error.
3. **The translate → run → inspect → repair loop, with structured solver errors as the feedback channel.** Converged on independently by Logic-LM, LLM-ARC, PrologMCP, Euclid-MCP and VerIbmc. arXiv:2604.27960 measures that **iterative self-correction is the primary performance driver**, not hand-authored domain knowledge. Foreman already has this shape (attempt → gate → verdict → retry); the change is to make the gate output *structured and machine-consumable* rather than a log blob.
4. **Datalog/ASP invariants over the work-DAG, not LLM inspection of it.** Round/attempt/verdict/commit consistency is a closed-world relational question with a small vocabulary — the exact regime where solvers win and LLMs are unnecessary. Euclid-MCP's finding that LLMs "hallucinate systematically on larger" knowledge bases is the argument against ever asking the model to reason over the whole graph. Adopt a **Rule Violation Score** (arXiv:2606.20208) over the work-DAG: it is computable as auto-generated SQL over Horn rules and it measures the thing accuracy metrics miss.
5. **An explicit evidence DAG with reachability-as-traceability.** VeriGraph (arXiv:2606.16603) reduces structural traceability to **graph reachability from raw data sources to terminal claims** and reports an 87.61% claim-level grounding rate. This is the closest published analogue to Foreman's knowledge plane and the pattern is directly liftable: every claim node must be reachable from a source node, and unreachable claims are rejected at write time. Cheap, deterministic, high-value.
6. **Canonicalisation as a separate post-hoc phase, with real entity resolution before the write.** EDC (arXiv:2404.03868) + DEG-RAG (arXiv:2510.14271). Do not ask the extractor to conform to the schema inline; extract openly, then define, then canonicalise. This also solves the "schema does not fit in the context window" problem that EDC names as the principal blocker.
7. **Commit to one canonical entity at the write boundary.** arXiv:2607.21185's one-to-one-grounding result, translated out of the differentiable setting. Do not persist candidate-identity distributions into the graph; resolve or reject.
8. **Non-monotonic semantics if the rules have exceptions.** If Foreman's policies look like "gate X required UNLESS Y UNLESS Z" — and delivery policies always do — ASP is measurably the right formalism over SMT (arXiv:2604.27960), and arXiv:2607.23386 documents exception-chain collapse as a *frontier-model* failure class specifically on that rule shape.

### 8.2 Defer / conditional

9. **Solver-guided extraction** (arXiv:2607.19365): ASP decides which predicates are admissible next, provably preserving the extracted fact set while cutting LLM calls. Attractive for cost, but it presumes a mature predicate schema. Revisit after N2's ontology stabilises.
10. **Consequence-probing for extraction faithfulness** (arXiv:2606.16541 method, not its Lean instantiation). High value, non-trivial to build. Prototype on one entity type before generalising.
11. **Reasoning-as-explicit-program** (Forethought, arXiv:2607.04096): ~30% relative gain, model-agnostic, auditable, ~3 orders of magnitude less post-training than a reasoning model. Conceptually close to Foreman's skill/agent composition. Single paper, July 2026, unreplicated — watch it, do not bet the architecture on it.

### 8.3 Refuse

12. **End-to-end differentiable neurosymbolic (Kautz Type 5).** LTNs, DeepProbLog, semantic loss, compiling the ontology into a network. Foreman has no gradient plane, no labelled training set, and no reason to acquire one. This is also precisely the family the reasoning-shortcut critique targets, with coNP-complete verification (arXiv:2604.23377). **Research toy for our purposes. Refuse.**
13. **Autoformalising Foreman specs into a proof assistant.** The faithfulness gap is the bottleneck, not the proving: typecheck catches **41.2%** of semantic drift (arXiv:2606.16541), and *Sorries Are Not the Hard Part* (arXiv:2606.13925) shows agents are weak at exactly what a spec is — choosing definitions and designing APIs. We would buy a formal artefact that is well-formed and means the wrong thing, then trust it more because it is formal. **Refuse.**
14. **Treating ontology validation as a trust or security boundary.** arXiv:2606.17223 E3: single-axiom OWL edits, **93.3% SIV success, 100% consistency-checker stealth, held-out detection at chance.** "TerminusDB accepted it" must never imply "it is safe." Ontology and rule changes are **code** — they go through review, signed commits, and the same gate as source. This is a concrete design constraint on the graph plane, not a nice-to-have.
15. **LLM as the reasoner over the graph.** Euclid-MCP: fine on small KBs, systematic hallucination on large ones, and the authors' blunt claim that "semantic RAG is fundamentally unsuited for rule enforcement." Retrieval for *context* is N3's business; **rule enforcement goes to a solver.**
16. **"Neurosymbolic" as an architectural goal in itself.** The LEED result (arXiv:2607.15647) — full NeSy **61.6%** vs text-only **67.3%** — is the honest cautionary case: local symbolic wins (EA-p2 50%→100%) and a global net loss, caused by extraction failure and conservatism. **If the graph plane cannot beat "just ask the model with good context" on a measured task, it should not ship.** Foreman must define that baseline before building, or it will not be able to tell.
17. **Elaborate agentic self-critique scaffolding as a quality mechanism.** Three independent measured results (arXiv:2310.01798, arXiv:2310.08118, arXiv:2402.08115) say it is flat-to-negative, and that a sound verifier plus simple re-prompting captures most of the available gain. Spend the engineering on the verifier.

### 8.4 One operational warning that is not architectural

**Frontier model behaviour on rule evaluation drifts silently under a fixed alias.** arXiv:2607.23386 documents GPT-5.4 moving 96.6% → 100% on the same prompt and harness with no version bump, between March and April 2026, and concludes that "frontier-model accuracy is a moving compliance boundary that shifts without notice." Foreman is a cross-vendor orchestrator whose routing decisions and gate thresholds are implicitly calibrated to model behaviour. **Pin what can be pinned, and run a small fixed regression suite against every vendor lane on a schedule** — otherwise Foreman's own quality gates drift underneath it and nothing in the system will report it.

---

## 9. Open questions

1. **What is the break-even rule-base size?** Euclid-MCP shows the LLM alone suffices on small KBs. Nobody characterises the threshold. Foreman's work-DAG invariants may sit below it, in which case the solver is overhead. **This is measurable and should be measured before building.**
2. **What is the honest baseline?** Per §8.3.16: what is "just prompt the model with well-chosen context" worth on Foreman's actual tasks? Without this number the graph plane cannot be justified or falsified.
3. **Does §4's closed-world benchmark evidence transfer at all** to open-domain, incompletely-specified engineering artefacts? Nothing in this corpus tests it (§4.6).
4. **Can the constraint-repair result (arXiv:2604.23377) be lifted out of the differentiable setting?** "When the grounding is ambiguous, repair the ontology rather than the data" is the most novel actionable idea I found. Whether the ASP-based uniqueness verifier is usable against a TerminusDB schema is unknown and worth a spike.
5. **Where does grounding confidence live?** BEARS argues for calibrated concept-level distrust. Does that become a per-node field, a per-edge field, or a separate provenance layer? Interacts with N2's ontology design and N3's retrieval.
6. **What is the maintenance cost?** No paper reports it (§6.6). Foreman will be the experiment. Instrument it from day one — hours spent on ontology/rule maintenance versus gate escapes prevented.
7. **How do we detect a poisoned or drifted ontology** when consistency checking is measured at chance (arXiv:2606.17223 E3)? Probably signed commits, review, and diff-level review of axiom changes — but that is engineering judgement, not a result.
8. **Does adding the graph plane ever make Foreman worse?** The distraction effect (arXiv:2607.14149) says a noisy graph can degrade performance even alongside a correct signal. There must be an off-switch and an A/B path, not a one-way migration.

---

## 10. Bottom line

The evidence supports a narrow, boring, valuable claim: **put a deterministic checker on the critical path, give it an explicit specification someone can read and version, feed it structured errors, and let it own the verdict.** That configuration has repeated measured wins across logic benchmarks (Logic-LM +39.2%/+18.4%; LINC +38/+10 absolute; LLM-ARC 88.32% FOLIO), regulated rule evaluation (+41 points, p ≤ 0.003), formal verification (86.4% on 499 problems, 75 solved with zero LLM calls), and agent traceability (87.61% grounding rate) — and it is the configuration the critique literature independently endorses (external sound verifier beats self-critique, which collapses).

The evidence does **not** support "neurosymbolic makes things better." Assembled neurosymbolic pipelines lose to their own text-only baselines when the extraction interface is weak (61.6% vs 67.3%), noisy graphs degrade reasoning that a correct oracle signal would otherwise help, symbolic conformance does not certify symbol semantics, ontology consistency does not detect a 93.3%-effective single-axiom attack, and the field's own systematic review discards ~88% of its literature on basic reproducibility grounds while covering trustworthiness in 28% of what remains.

Foreman should build the checker and the evidence DAG. It should not build a neurosymbolic architecture.
