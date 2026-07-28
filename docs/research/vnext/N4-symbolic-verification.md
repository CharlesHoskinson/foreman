# N4 — Symbolic Verification: constraint checking, contradiction detection, and a deterministic gate for Foreman v0.2.9

Lane N4 of the NEUROSYMBOLIC research sprint. Owner concern: **using the ontology and a
reasoner to CHECK what the LLMs produce.** Sibling lanes: N1 (landscape), N2 (ontology
engineering + competency questions), N3 (serialization/retrieval). This lane deliberately
does not restate their material.

Research date: **2026-07-28**. Claims are tagged **VERIFIED** (primary source read and
quoted) or **INFERRED** (my reasoning over verified inputs). Numbers are quoted from the
cited source unless marked otherwise.

Source-paper anchor: `SOURCE-karpathy-graph-engineering.txt` §V — *"Grounding layer. An
evaluator checks claims against evidence… When an edge is missing, the evaluator returns
structured feedback… `required_evidence`… This is more actionable than a free-form
critique."* — §VII (evaluation), and the Appendix's four graph-write invariants.

---

## 0. The one-paragraph answer

Symbolic validation over a knowledge graph is **cheap, mature, and genuinely actionable**
for the class of errors that are *structural*: missing provenance edges, unsourced claims,
uncited findings, dangling supersedes chains, schema violations. SHACL already emits
exactly the shape of feedback §V asks for — `sh:focusNode` + `sh:resultPath` +
`sh:sourceConstraintComponent` maps 1:1 onto `claim` + offending edge + `reason` — and at
Foreman's scale (10^4–10^6 triples) a competent engine validates in **single-digit
seconds** (measured: 0.192 s on a run-subgraph; 10.6 s on 1.24M triples with 215 shapes).
What symbolic validation **cannot** do is decide whether a diff is *correct*, and the
measured literature is unambiguous that open-world "is this claim supported by the graph?"
checks run at **~88–94% precision / 44–73% recall**. A 6–12% false-positive rate is ruinous
for a *blocking* gate. The design conclusion is a **two-speed gate**: closed-world
structural checks BLOCK; open-world evidence checks WARN and never block; model judgment is
confined to a bounded, named residual.

**The three findings I would put in front of the architect first:**

1. **Complementarity has a precise shape, and it is not "different bugs".** A Datalog
   verifier run over an LLM agent's own reasoning had **perfect precision and low recall**
   (arXiv:2509.26546, §3.5.6/§5.4), and the recall loss was entirely the *model's*
   formalisation step — a step Foreman does not have, because our facts come from
   `git diff` and `events.jsonl`, not from a model asked to formalise prose. Meanwhile a
   cross-family panel of four AI reviewers scored **0/20** on a domain-convention defect
   that a written specification caught every time (arXiv:2603.25773, §5.1). *Symbolic is
   never wrong and often silent; the model is usually right and never silent.*
2. **Foreman's gate is already 5/6 deterministic — the gap is that nothing checks the
   auditor.** Nothing verifies that a finding cites a file that is in the diff, that the
   verdict is consistent with its own findings, that every acceptance criterion was
   covered, or that the cross-vendor invariant held. All four are closed-world set
   membership tests with a **0% false-positive rate**, and the first three need **no
   knowledge graph at all** (§7.3, §7.7).
3. **A SHACL gate can silently become a no-op — and this, not slowness, is the dominant
   failure mode.** Executed, first try, reference implementation: the same shapes and the
   same violating data reported `Conforms: True`, no warning, exit 0 (§6.6). Then found
   **four more independent instances** across five tools — AllegroGraph's own manual
   demonstrating it, the SHACL Play author raising it at the W3C WG, Zazuko's engine author
   stating it outright, and RDF4J's default truncation silently corrupting a *peer-reviewed
   benchmark's* published numbers (§8.6). **A validator that fails open is worse than no
   validator, because the agents trust its verdict.** Any validation gate needs a
   known-violating canary asserted before it is believed.

**And one architectural constraint that must be honoured at design time:** SHACL-on-write
**serialises writers**. RDF4J's ShaclSail *"uses locking to run transactions
one-after-the-other"* because two individually-valid transactions can be jointly invalid.
For an orchestrator whose entire premise is N concurrent isolated lanes, a naive write-time
validator is a **global mutex across all lanes**. The fix is cheap now and expensive later:
keep every write-path invariant **lane-local**, validate per-lane in isolation, and never
put a cross-lane invariant on the write path (§7.2b).

---

## 1. Sources fetched

Saved under `/tmp/neurosym-docs/N4/` (session-local). PDFs pulled with `curl` +
`pdftotext -layout`; HTML with `scrapling extract get … --ai-targeted`. Note: scrapling's
`--ai-targeted` markdown conversion **corrupts PDF byte streams** — PDFs must be fetched
with `curl` and converted separately. That cost me one wasted fetch round; recorded here
so sibling lanes do not repeat it.

| URL | Status | Date | What it gives us |
|---|---|---|---|
| `semantic-web-journal.net/system/files/swj3972.pdf` — ERA-SHACL-Benchmark | OK | 2026-07-28 | Best real-world SHACL cost table: 8 engines × 3 sizes (1.24M / 11.3M / 55.8M triples) × 3 shape sets; load, validation, cumulative time, RAM |
| `arxiv.org/pdf/2605.10540` — SHACL-DS on ERA RINF | OK | 2026-07-28 | 33.6M-triple validation at 566–591 s; named-graph-scoped shapes enforce triple provenance via `GRAPH` clauses |
| `arxiv.org/pdf/2603.25773` — Zietsman, *The Specification as Quality Gate* | OK | 2026-07-28 | **Load-bearing complementarity source.** Cross-family AI-reviewer panel vs BDD; 0/20 result; five-category residual defect taxonomy |
| `arxiv.org/pdf/2409.07507` — Adam & Kliegr, *Traceable LLM-based validation of statements in KGs* (IP&M 2025) | OK | 2026-07-28 | Measured precision / recall / FP for verifying KG statements against retrieved evidence |
| `aclanthology.org/2025.winlp-main.19.pdf` — Kolli et al., hybrid KG+LLM fact-checking | OK | 2026-07-28 | KG-alone vs web vs hybrid precision/recall on FEVER, FEVER 2.0, FactKG |
| `arxiv.org/abs/2601.18844` — Du et al., *Reducing False Positives in Static Bug Detection with LLMs* (Tencent) | OK (abs) | 2026-07-28 | Industrial static-analysis FP rates + LLM triage, with per-alarm cost |
| `arxiv.org/html/2505.12118v1` — *Do Code LLMs Do Static Analysis?* | OK | 2026-07-28 | Measured evidence LLMs cannot reproduce call-graph / data-flow analysis |
| `arxiv.org/abs/2501.12862` — *Mutation-Guided LLM-based Test Generation at Meta* (ACH) | OK (abs) | 2026-07-28 | Industrial mutation-testing scale; equivalent-mutant detector precision/recall |
| `arxiv.org/abs/2510.25297` — LLM-generated PBT vs EBT on edge cases | OK (abs) | 2026-07-28 | Direct complementarity number: 68.75% each, 81.25% combined |
| `arxiv.org/html/2506.18315v1` — *Property-Generated Solver* | OK | 2026-07-28 | PBT-as-feedback converts silent wrong answers into actionable violations |
| `arxiv.org/html/2504.19023v1` — GLaMoR (OWL consistency via graph LMs) | OK | 2026-07-28 | HermiT reasoner runtime (122 h) vs ML approximation; accuracy-vs-determinism trade |
| `w3.org/TR/shacl/` | OK | 2026-07-28 | Validation Report vocabulary — the actionability primitive |
| `w3.org/TR/shacl-af/` | OK | 2026-07-28 | SHACL-AF: rules, node expressions, SPARQL-based targets and constraints |
| `w3.org/TR/owl2-profiles/` | OK | 2026-07-28 | Table 10 — exact complexity classes per OWL 2 profile |
| `w3.org/TR/prov-o/`, `w3.org/TR/prov-constraints/` | OK | 2026-07-28 | PROV-O vocabulary; PROV constraints are specified *separately and procedurally*, not as shapes |
| `shex.io/shex-primer/` | OK | 2026-07-28 | ShEx expressiveness and failure-reporting model |
| `terminusdb.org/docs/schema-reference-guide/` | OK | 2026-07-28 | What TerminusDB's schema layer can and cannot enforce at write time |
| `vldb.org/pvldb/vol15/p2284-ahmetaj.pdf` — Magic Shapes for SHACL Validation (VLDB'22) | OK | 2026-07-28 | Optimisation for targeted (non-whole-graph) validation |
| `arxiv.org/abs/2507.08432` — xpSHACL | OK (abs) | 2026-07-28 | Raw SHACL reports are machine-actionable but human-terse; RAG/LLM explanation layer on top |
| `arxiv.org/html/2603.05399v1` — Judge Reliability Harness (RAND) | OK | 2026-07-28 | "No judge that we evaluated is uniformly reliable across benchmarks" |
| `arxiv.org/pdf/2606.15246` — Provenance-Enhanced Statements in KGs | OK | 2026-07-28 | Reification / provenance modelling options |
| `arxiv.org/abs/2604.04190` — SHARP, KG triple verification | OK (abs) | 2026-07-28 | Agentic triple verification: +4.2% / +12.9% accuracy over SOTA baselines |
| `journals.sagepub.com/doi/10.1177/30504554251353512` — Detecting & Fixing Inconsistencies in Large KGs | **FAIL** (SAGE bot-block) | 2026-07-28 | Only the search-index summary obtainable; used as INFERRED only |
| `journals.sagepub.com/doi/10.1177/29498732251320043` — Logic & Reasoning in Neurosymbolic Systems w/ OWL KGs | **FAIL** (SAGE bot-block) | 2026-07-28 | Same |
| `dl.acm.org/doi/10.1145/3731443.3771340` — *Lessons Learned from the Combined Development of OWL and SHACL* (K-CAP 2025) | **FAIL** (ACM block) | 2026-07-28 | Abstract-level summary only; flagged inline where used |

**Additional primary sources via the Datalog/ASP sub-lane** (that sub-lane holds the full
table; the load-bearing entries are):

| URL | Status | Date | What it gives us |
|---|---|---|---|
| `arxiv.org/html/2509.26546` — *Towards Verified Code Reasoning by LLMs* | OK | 2026-07-28 | **The most on-point prior work in the lane.** Soufflé Datalog verifying an LLM agent's reasoning; "perfect precision and low recall" |
| `cs.ox.ac.uk/boris.motik/pubs/npmhwb15RDFox-scalable.pdf` — RDFox, ISWC 2015 | OK | 2026-07-28 | 6.1M triples/s; 9.2G triples; incremental deletion 0.49 s avg |
| `ar5iv.labs.arxiv.org/html/1711.03987` — Hu/Motik/Horrocks, optimised Datalog maintenance | OK | 2026-07-28 | Incremental-maintenance tables; the Claros-LE 95-minute landmine |
| `ar5iv.labs.arxiv.org/html/2308.15897` — Nemo, ICLP 2023 | OK | 2026-07-28 | 186.7M inferred facts in 163.3 s **on a laptop** |
| `souffle-lang.github.io/provenance` + `arxiv.org/pdf/1907.05045` | OK | 2026-07-28 | Proof-tree interface; 1.27× runtime / 1.45× memory overhead; exponential proof-tree blow-up caveat |
| `docs.oxfordsemantic.tech/reasoning.html` | OK | 2026-07-28 | RDFox `explain` / `explain shortest`; stratification requirements |
| `link.springer.com/chapter/10.1007/978-3-030-00671-6_19` — Corman/Reutter/Savković, ISWC 2018 | OK | 2026-07-28 | Recursive SHACL semantics; NP-hardness even with stratified negation |
| `arxiv.org/html/2605.02787` — *Static Analysis of Recursive SHACL*, KR 2026 | OK | 2026-07-28 | Implication undecidable under supported/stable; single-exponential under well-founded |
| `link.springer.com/chapter/10.1007/978-3-031-19433-7_22` — Ahmetaj et al., ISWC 2022 | OK | 2026-07-28 | ASP repair generation for SHACL violations |
| `arxiv.org/html/2508.08633` — *Diminution* | OK | 2026-07-28 | ASP grounding blow-up, measured mitigation |
| `potassco.org/clingo/python-api/.../solving.html` | OK | 2026-07-28 | `SolveHandle.core()` — the unsat-core API |
| `cposkitt.github.io/.../agentspec_llm_enforcement_icse26.pdf` — AgentSpec, ICSE 2026 | OK | 2026-07-28 | Runtime rule enforcement for LLM agents, millisecond overhead; **not** Datalog/ASP |

Sub-lane FAILs worth recording: the `iswc2015.semanticweb.org` RDFox PDF (substituted with
the Oxford copy), two CEUR-WS PDFs, the `bartbogaerts.eu` SHACL-features PDF, and the
Dagstuhl LIPIcs Nemo KR2024 PDF (redirect stub).

**Additional primary sources via the SHACL-brittleness sub-lane** (load-bearing entries;
that sub-lane holds the full 30-row table):

| URL | Status | Date | What it gives us |
|---|---|---|---|
| `rdf4j.org/documentation/programming/shacl/` | OK | 2026-07-28 | `ValidationApproach.Disabled`; JVM-crash warning; 500k auto-failover; **write serialization via locking** |
| `github.com/eclipse-xfsc/federated-catalogue/pull/73` | OK | 2026-07-28 | **The one deployed system found flipping SHACL off by default in the write path** |
| `github.com/oeg-upm/ERA-SHACL-Benchmark/issues/2,3,4` | OK | 2026-07-28 | RDF4J author on transactional overhead; **silent report truncation that corrupted a peer-reviewed benchmark** |
| `graphdb.ontotext.com/documentation/11.4/shacl-validation.html` | OK | 2026-07-28 | Deadlock warning; SPARQL-target perf warning; cannot enable SHACL on an existing repository |
| `franz.com/agraph/support/documentation/current/shacl.html` | OK | 2026-07-28 | **The documented silent-conforms typo trap**; SPARQL constraints "a lot slower" |
| `docs.stardog.com/inference-engine/` + database-configuration | OK | 2026-07-28 | The clearest vendor argument against materialization; **silent RDFS downgrade on schema timeout**; DL removed in v9.0 |
| `github.com/terminusdb/terminusdb` RELEASE_NOTES + discussions/1039 + issues/123 | OK | 2026-07-28 | *"no longer supports OWL schema validation"*; maintainer's turn-it-off workaround; founders' on-record rejection of SHACL |
| `terminusdb.org/docs/schema-reference-guide/`, `/troubleshooting-schema/` | OK | 2026-07-28 | Exactly what the write-time checker enforces, and the `sys:JSON` escape hatch |
| `github.com/Sveino/Inst4CIM-KG` shacl-improved README (Alexiev) | OK | 2026-07-28 | *"shapes are brittle in face of change"*; no known incremental validation over SPARQL |
| `graphwise.ai/blog/improving-era-shacl-shapes-and-data-flows/` | OK | 2026-07-28 | Real shape-maintenance story; 8.3M-result query; shapes cut by a third |
| `github.com/w3c/data-shapes/issues/321, 325` | OK | 2026-07-28 | W3C WG deferring complexity past SHACL 1.2; empty-report-because-no-targets |
| Apache Jena `users@` msg17318/19049/20635 (Seaborne) | OK | 2026-07-28 | The taxonomy of what can and cannot leave the write path |
| `arxiv.org/pdf/2508.00137` (SHACL Validation under Graph Updates, ISWC'25) | OK | 2026-07-28 | Static validation under updates **exponential in #shapes**; undecidable in general |
| `bergnet.org/2023/03/2023/shacl-engine/` | OK | 2026-07-28 | 15× benchmark; *"a failing SHACL target generates a report where everything is fine"* |
| ELK JAR paper; ORE 2015 report (CEUR Vol-1457) | OK | 2026-07-28 | SNOMED/GALEN classification tables; per-reasoner timeout/error counts |

Sub-lane **FAIL**s that matter: **Ontotext's "SHACL-ing the Data Quality Dragon" I/II/III**
(Cloudflare + Wayback 429 after ~9 attempts) — Part II's *"SHACL-SPARQL performance"*
section is **unread and is the single biggest known gap in §8**; GraphDB 11.x
`reasoning.html` (Sucuri rate-limit, so all GraphDB *reasoning* numbers come from the 10.2
tree); Oracle RDF inferencing docs (JS stubs).

**Locally executed:** pySHACL 0.40.1 was installed in WSL and run against the §6 shapes —
see **§6.6**. That section is the only part of this report verified by *execution* rather
than by reading, and it produced two findings that reading the spec would not have given.

---

## 2. Validation technology comparison

The criterion that matters for us is not expressiveness. It is **actionability**: does the
validator hand back a pointer to the offending node and edge, or just a boolean? The
source paper's `required_evidence` example is a *structured, addressed* rejection. Anything
that returns "invalid" is useless to a worker agent that must fix it.

### 2.1 The comparison

| Technology | Catches | Complexity / cost | Tooling maturity | Actionable error? |
|---|---|---|---|---|
| **SHACL Core** (non-recursive) | Missing/extra properties, cardinality, datatype, value ranges, class membership, `sh:in` enums, node kind, string patterns, `sh:closed` (no undeclared predicates), pairwise property comparison | PTIME data complexity; in practice near-linear in targeted nodes. **Measured:** 1.24M triples / 215 shapes = **10.6 s** cumulative (Apache Jena) | **Highest.** W3C Rec; ≥8 independent engines; Jena, TopBraid, rdf4j, pySHACL, maplib, Corese, dotNetRDF, RDFUnit | **Yes, best in class.** `sh:ValidationResult` carries `sh:focusNode`, `sh:resultPath`, `sh:value`, `sh:sourceShape`, `sh:sourceConstraintComponent`, `sh:resultMessage`, `sh:resultSeverity`. This *is* `required_evidence`. |
| **SHACL-SPARQL / SHACL-AF** | Everything above plus multi-hop path constraints, transitive closure (`p+`), cross-node joins, aggregates, custom targets | Unbounded — you inherit SPARQL's cost. **Measured:** adding **60 SPARQL constraints** to 215 core shapes took pySHACL from 481 s to **133,153 s (37 h)** on 1.24M triples; TopBraid 11.4 s → 25.5 s; Jena 2.1 s → 15.6 s | High for TopBraid/Jena; **poor across engines** — ERA benchmark: "SHACL-SPARQL shapes are generally less well covered by existing engines than SHACL-core shapes" | **Yes**, same report vocabulary, and `sh:message` templates can interpolate `{?this}` and bound variables |
| **SHACL with recursion** | Reachability/closure constraints expressed natively | **NP-hard in graph size**, and the bound holds even for a stratified-negation fragment (Corman/Reutter/Savković, ISWC 2018). Shape *implication* is **undecidable** under supported and stable semantics; decidable in single-exponential time only under well-founded semantics (KR 2026) | **Semantics explicitly left undefined by the W3C Rec** — engines "may support recursion scenarios or produce a failure when they detect recursion". Tractable approximations exist in papers, not in shipping engines | Yes in principle; **inconsistent across engines in practice**. See §3.5 — this is the row where Datalog strictly dominates |
| **ShEx** | Same structural family as SHACL Core, with a stronger regex-like *triple expression* algebra (ordered/grouped/repeated patterns) | Comparable to SHACL Core for the non-recursive fragment | Lower than SHACL. Fewer engines, thinner enterprise adoption | **Yes** — ShEx returns a failure structure identifying the failed triple constraint, but the report vocabulary is not a W3C Recommendation, so cross-engine shape is not guaranteed |
| **OWL 2 QL** | Subsumption/domain/range/disjointness at the schema level; query rewriting | Consistency: **NLogSpace-complete** taxonomic; **AC0** data complexity | Mature (Ontop, Stardog) | **Weak.** A reasoner says "the ontology is inconsistent". Getting the *justification* (minimal offending axiom set) is a separate, more expensive computation |
| **OWL 2 EL** | Large class hierarchies, existential restrictions | **PTIME-complete** all measures | Mature (ELK — very fast) | Weak, same reason |
| **OWL 2 RL** | Rule-expressible entailments incl. `owl:disjointWith`, `owl:FunctionalProperty`, `owl:maxCardinality` violations | Consistency **PTIME-complete**; implementable on a rule engine, so materialisation is incremental-friendly | Mature (RDFox, GraphDB, Stardog) | **Medium.** A rule engine that tracks derivations can point at the antecedent facts; plain materialisation cannot |
| **OWL 2 DL (full)** | Everything | **N2EXPTIME-complete** combined; data complexity decidable but open (NP-hard) | HermiT, Pellet | Weak and slow. **Measured:** HermiT took **122 h 24 m** to consistency-check the BioPortal module test set in GLaMoR |
| **Datalog** (RDFox, Soufflé, Nemo, CozoDB, DDlog) | Recursive derivation + integrity constraints; derived (IDB) predicates; anything expressible as a fixpoint | **P-complete** data complexity, EXPTIME-complete program complexity, guaranteed termination. **Measured:** Nemo, on a *laptop*, 186.7M inferred facts in 163.3 s (≈1.14M facts/s); RDFox 6.1M triples/s materialisation, 9.2G triples stored | Mature and fast. RDFox commercial; Soufflé (C++ codegen), Nemo (Rust), CozoDB (embeddable) open | **Yes — two ways, both ≥ SHACL.** (a) a reified `violation(Rule,Node,Path)` rule head gives the same pointer at zero cost; (b) Soufflé `-t explain` / RDFox `explain` return a **proof tree**, a strict superset. Soufflé also has `explainnegation` — why a fact is *absent* |
| **ASP** (clingo/Potassco) | Integrity constraints (`:- body.`), defaults, preferences, **repair search** (minimal edit restoring validity) | **NP-complete** normal, **Σ2P** disjunctive. **Grounding blow-up is the practical hazard** — exponential in the worst case | Mature research tooling; thin bash/TS ecosystem | **No by default** — a violated `:- body.` yields only `UNSATISFIABLE`. Actionable only via a deliberate idiom: reify to `violation/N`, or solve under per-rule assumptions and read `SolveHandle.core()` (the minimal unsat core) |

**VERIFIED** — the SHACL timings, the OWL complexity classes, and the HermiT 122 h figure
are quoted directly from the ERA benchmark, W3C OWL 2 Profiles Table 10, and GLaMoR
Table IV respectively.

### 2.2 Why SHACL wins for us specifically

**VERIFIED (W3C SHACL §3.6.2).** A validation result is a first-class RDF node carrying:

```
[ a sh:ValidationResult ;
  sh:resultSeverity            sh:Violation ;
  sh:focusNode                 ex:Alice ;          # WHICH node
  sh:resultPath                ex:ssn ;            # WHICH edge
  sh:value                     "987-65-432A" ;     # WHICH value
  sh:sourceConstraintComponent sh:RegexConstraintComponent ;   # WHICH rule
  sh:sourceShape               _:b1 ]              # WHICH shape declared it
```

The spec makes this mandatory: *"Only SHACL implementations that can produce all of the
mandatory properties of the Validation Report Vocabulary are standards-compliant."*

That maps mechanically onto the paper's grounding-layer contract:

| §V `required_evidence` JSON | SHACL source |
|---|---|
| `"claim"` | `sh:focusNode` (resolved to its label / claim text) |
| `"reason"` | `sh:sourceConstraintComponent` + `sh:resultMessage` |
| `"required_evidence": [...]` | one entry per failing property shape, generated from `sh:message` on that shape |
| `"decision": "revise"` | `sh:resultSeverity sh:Violation` → revise; `sh:Warning` → note; `sh:Info` → log |

**INFERRED.** This means the §V grounding layer does not need to be written — it needs to
be *configured*. The transform from a SHACL report to the paper's JSON is roughly 40 lines
of code, and it is deterministic. This is the highest-leverage, lowest-risk piece of the
whole neurosymbolic programme.

One caveat, **VERIFIED** from xpSHACL (arXiv:2507.08432): *"traditional SHACL validation
engines often provide terse reports in English that are difficult for non-technical users
to interpret and act upon."* The report is machine-actionable but not human-readable.
xpSHACL's answer — rule-based justification trees plus a RAG/LLM explanation layer, with a
"Violation KG" caching explanations for reuse — is a reasonable pattern for us: the
*decision* stays symbolic, the *prose* is generated. Never the other way round.

### 2.3 Where SHACL Core runs out

**VERIFIED.** SHACL Core cannot express transitive closure, so "the supersedes chain is
acyclic" and "every claim is reachable from some Source in ≤ k hops" require SHACL-SPARQL
(`sh:sparql` with a `p+` property path) or SHACL-AF. That is where the cost cliff is (see
§9): the ERA benchmark's SPARQL shape set is what produced the 37-hour pySHACL run.

**INFERRED, design rule:** keep the write-time shape set in **SHACL Core only**, and push
closure/reachability checks into a separate, asynchronous, non-blocking audit pass. This
is a straightforward tiering and it maps cleanly onto Foreman's existing distinction
between the merge gate (fast, blocking) and the audit lane (slow, advisory).

---

## 3. Contradiction detection: what is cheap and decidable, what needs a model

### 3.1 The three-tier reality

| Tier | Example in Foreman terms | Mechanism | Cost | Decidable? |
|---|---|---|---|---|
| **T-A. Structural contradiction** | Two `Evaluation` nodes assert different `verdict` values for the same (artifact-version, rubric-version) pair | `sh:maxCount 1` on a functional property, or a `sh:sparql` uniqueness shape | Linear in the targeted nodes; **milliseconds** at our scale | **Yes, trivially.** Closed-world, single-hop |
| **T-B. Logical contradiction** | A `Claim` is both `fm:Verified` and `fm:Refuted`; an `Artifact` is in two disjoint lifecycle states; a `PRODUCED` edge has two distinct `AgentRun` sources when it is declared functional | `owl:disjointWith` + `owl:FunctionalProperty` + cardinality, evaluated by an OWL 2 RL rule engine — or, equivalently and more cheaply, by SHACL `sh:not`/`sh:xone`/`sh:maxCount` | OWL 2 RL consistency is **PTIME-complete**; SHACL encoding of the same is cheaper still | **Yes.** But *explaining* it is the expensive part |
| **T-C. Semantic / soft contradiction** | "The retry logic is now idempotent" vs an existing claim "retries can double-charge"; a doc claim that contradicts a code comment; a finding that contradicts a passing test | No decision procedure exists. Requires NLI, entailment scoring, or a model in the loop | Model call per candidate pair; quadratic if naive | **No.** Needs a model, and the model is unreliable — see §4 |

**VERIFIED (W3C OWL 2 Profiles Table 10).** OWL 2 RL ontology consistency is
PTIME-complete in taxonomic, data, *and* combined complexity. OWL 2 QL is
NLogSpace-complete taxonomic and **AC0** in data complexity. OWL 2 EL is PTIME-complete.
Full OWL 2 Direct Semantics is N2EXPTIME-complete combined. **INFERRED:** for Foreman there
is no reason ever to leave the RL/QL band; the expressive power we need (disjointness,
functional properties, cardinality) sits entirely inside RL.

### 3.2 Detection is cheap; explanation is not

This is the load-bearing asymmetry and it is under-appreciated.

**VERIFIED (GLaMoR, arXiv:2504.19023).** *"While HermiT took 122 hours, the slowest
machine-learning model took 11 hours to train."* HermiT — one of the better-optimised
classical reasoners — needed **122 h 24 m 32 s** to consistency-check the BioPortal module
test set. The paper's ML surrogate reached **95.13% accuracy** (best precision 96.10%,
recall 94.17%) about 20× faster.

**INFERRED — and this is important for us.** GLaMoR is often cited as "ML beats reasoners".
For a *gate*, it is the wrong trade. The reason to use a reasoner in an audit gate is that
it is **sound**: when it says "contradiction", there is a contradiction, and there is a
derivation to show you. A 95%-accurate surrogate has a ~4–5% error rate in both directions,
which puts it in the same reliability band as the LLM auditor it was supposed to
discipline. **Never replace the reasoner with a learned approximation inside a gate.** Use
the surrogate, if at all, as a *pre-filter* that decides which subgraphs to send to the
real reasoner.

The corresponding cheap alternative: **do not run a DL reasoner at all.** Encode the
disjointness and functionality axioms you actually care about as SHACL constraints
directly. You lose entailment (SHACL will not infer that `A rdfs:subClassOf B` makes an
`A`-instance also a `B`-instance, so you must materialise that separately or state it) but
you gain PTIME evaluation and a `sh:focusNode`-addressed report instead of a global
"inconsistent" boolean. **INFERRED**, but it follows directly from the two verified
complexity/actionability facts above.

### 3.3 Detecting that a *new* assertion contradicts existing state

The specific operation the source paper needs ("contradiction tracking", §V) is: given a
candidate `GraphUpdate`, decide whether committing it introduces an inconsistency.

Three implementable strategies, in increasing cost:

1. **Shape-scoped revalidation (recommended).** Compute the set of focus nodes touched by
   the update, plus their 1-hop neighbourhood, and revalidate only those against the shape
   set. **INFERRED**, but directly supported by the *Magic Shapes* result (VLDB'22,
   Ahmetaj et al.) — magic-set rewriting restricts SHACL validation to the part of the
   graph relevant to a target, which is exactly this operation formalised. Cost is
   proportional to the update, not the graph.
2. **Full revalidation in a transaction.** Apply the update in an uncommitted transaction,
   validate the whole graph, roll back on violation. Correct, simple, and at our scale
   still affordable — **VERIFIED:** 1.24M triples / 215 SHACL-Core shapes = **10.60 s
   cumulative (Jena)**, of which only 2.10 s is validation. Below ~10^6 triples this is a
   perfectly reasonable per-merge cost; above it, it is not.
3. **Delta-based rule maintenance.** A Datalog engine with incremental maintenance
   (RDFox, differential dataflow) recomputes only affected derivations. Highest
   engineering cost, best asymptotics. **INFERRED:** overkill for Foreman until the graph
   exceeds ~10^7 facts.

### 3.4 What genuinely needs a model

**VERIFIED (source paper §V):** the grounding-layer example is *not* a logical
contradiction. "Vendor X supplied the component involved in Incident Y" fails because *no
supported path exists* — an absence, not a conflict. Absence-of-path is decidable and
cheap (a bounded traversal). But deciding whether a natural-language claim *is* the
statement that a graph path expresses — the alignment step — is exactly the part with no
decision procedure.

**INFERRED, stated plainly:** the symbolic layer can verify that a claim node is *linked*
to evidence. It cannot verify that the evidence *supports* the claim. Every design below
respects that boundary. Conflating the two is the single most likely way this programme
produces a gate that is confidently wrong.

### 3.5 Datalog / ASP as validators — the sub-lane findings

A parallel sub-lane investigated Datalog and ASP as constraint validators. The findings
materially change the §2 comparison and are worth stating in full, because on two axes
Datalog **beats** SHACL rather than merely complementing it.

#### 3.5.1 The structural insight

**VERIFIED — Corman, Reutter, Savković (ISWC 2018).** The SHACL specification itself
punts on recursion:

> *"…the validation with recursive shapes is not defined in SHACL and is left to SHACL
> processor implementations. For example, SHACL processors may support recursion scenarios
> or produce a failure when they detect recursion."*

and

> *"recursion may be viewed as one of the distinctive features of SHACL: without recursion,
> one ends up with a constraint language whose expressive power is essentially the same as
> SPARQL."*

The three research lineages that gave recursive SHACL a semantics are: **supported models**
(Corman et al., ISWC 2018), **stable models** (Andresel et al., WWW 2020), and
**well-founded models** (Bogaerts, Jakubowski et al.). Those are, precisely, the three
standard semantics of logic programming with negation.

**INFERRED, and this reframes the whole comparison:** recursive SHACL and stratified
Datalog are not competitors. Recursive SHACL is a *syntax* that had to be given a
Datalog/ASP *semantics* in order to mean anything. SHACL-AF's answer to "we need derived
predicates" is `sh:rule` — i.e. bolt a rule engine onto the front of the validator.

#### 3.5.2 The complexity table that decides it

| Problem | Result | Source |
|---|---|---|
| SHACL validation, recursive, supported-model semantics | **NP-hard in graph size — and the bound holds even for stratified negation** | Corman et al., ISWC 2018 (VERIFIED) |
| SHACL implication/containment, recursive, supported or stable semantics | **UNDECIDABLE**, even for the `ALCIO` fragment | *Static Analysis of Recursive SHACL*, KR 2026 (VERIFIED) |
| Same, well-founded semantics | **Decidable in single-exponential time** (via full hybrid μ-calculus) | ibid. (VERIFIED) |
| Datalog validation, data complexity | **P-complete** | standard (VERIFIED) |
| Datalog, program complexity | **EXPTIME-complete**; always terminates, not Turing-complete | standard (VERIFIED) |
| ASP consistency, normal programs | **NP-complete** | Potassco (VERIFIED) |
| ASP, disjunctive | **Σ2P-complete** | standard (INFERRED — not read in primary) |

**INFERRED:** for recursive constraints, **stratified Datalog is both cheaper and more
expressive than recursive SHACL** — P-complete vs NP-hard, with derived predicates SHACL
lacks. That is an unusual and decisive combination, and it inverts the naive assumption
that SHACL is the "lightweight" option.

#### 3.5.3 Measured cost

**VERIFIED — RDFox (ISWC 2015, Nenov/Piro/Motik/Horrocks/Wu/Banerjee).**

> *"…achieving speedups of up to 87 times, storage of up to 9.2 billion triples, memory
> usage as low as 36.9 bytes per triple, importation rates of up to 1 million triples per
> second, and reasoning rates of up to 6.1 million triples per second."*

Incremental deletion, LUBM-50K (9.2 G triples materialised), deleting 5,000 explicit
triples:

> *"On average, RDFox could update the materialisation in 0.49 s while removing 8525.8
> triples in total; the fastest update took 0.42 s… the longest one took 0.6 s."*

**VERIFIED — Nemo (ICLP 2023, TU Dresden; Rust).** On a **laptop** (i7-1165G7, 16 GB):
LUBM-01k → **186,742,694 inferred facts in 163.3 s** (≈1.14M facts/s); SNOMED CT 24.1M
facts in 62.1 s (VLog ran out of memory); Deep200 in 5.1 s (VLog timed out at 60 min).

**VERIFIED — Soufflé provenance overhead (Zhao, Subotić, Scholz, 2019).** Enabling proof
tracking costs **1.27× runtime and 1.45× memory** (geometric means 1.24×/1.44× to
1.31×/1.46× depending on analysis), with **sub-millisecond per proof-tree node** query
time, on Doop/DaCapo workloads producing ~26M output tuples from 300 relations and 850
rules.

**INFERRED, the number that matters for us:** nobody publishes benchmarks at 10^4–10^6
facts because it is uninterestingly small for these engines. Linear extrapolation from
Nemo's laptop figure puts **full re-materialisation of a 10^6-fact graph at sub-second to
low-single-digit seconds on commodity hardware**. The practical consequence is important:
**at Foreman's scale, incremental maintenance is probably not worth building.** Full
re-evaluation per commit is cheaper than the engineering cost of DRed/Backward-Forward.

#### 3.5.4 The landmine: incremental cost is rule-shaped, not delta-shaped

**VERIFIED — Hu, Motik, Horrocks, *Optimised Maintenance of Datalog Materialisations*.**
Average seconds to delete **1,000 facts**:

| Dataset | Facts | DRed | Backward/Forward (best variant) |
|---|---|---|---|
| Reactome-U | 12.5 M | 1.03 | **0.05** |
| Uniprot-R | 123.1 M | 8.71 | 4.13 |
| UOBM-U | 254.8 M | 1,185.87 | **1.18** |
| SSPE | 3.0 M | 1,684.97 | 247.00 (DRedc: 10.53) |
| **Claros-LE** | **18.8 M** | **5,759.92** | **2,802.86** |

Claros-LE — a graph with a **symmetric + transitive** predicate that produces cliques —
takes up to **95 minutes to delete 1,000 facts from an 18.8M-fact graph**, while
Reactome-U takes **0.05 s on 12.5M facts**. Three orders of magnitude apart, at comparable
scale.

**INFERRED, and it belongs in whatever ontology N2 lands:** if the Foreman graph contains
any symmetric-transitive relation (`fm:relatedTo`, `fm:equivalentTo`, an unconstrained
`fm:dependsOn` with symmetry), incremental maintenance becomes unpredictable. Either
forbid such relations in the ontology, or do not build incremental maintenance at all.

#### 3.5.5 Actionability — Datalog and ASP versus `sh:focusNode`

The sub-lane's headline result: **the Datalog/ASP equivalent of a SHACL ValidationResult
is not one thing but three, in increasing power.**

1. **Reified violation atoms.** Write `violation(RuleId, Node, Path) :- <body>.` instead of
   an integrity constraint. The answer set / materialisation then *contains* the offending
   tuples. This is a direct structural analogue of `sh:focusNode` + `sh:resultPath`,
   available in **every** engine listed, at **zero** extra cost — it is an ordinary rule
   head. **This alone matches SHACL's actionability.**
2. **Proof trees / why-provenance** (Soufflé `-t explain`, RDFox `explain`). A **strict
   superset** of SHACL: the full derivation chain, not just the terminal node.
   **VERIFIED — Soufflé:**
   ```
   explain path(1, 3)
            edge(2, 3)
            -------(R1)
   edge(1, 2) path(2, 3)
   -------------------(R2)
       path(1, 3)
   ```
   Soufflé also has `explainnegation`, which explains *why a fact is absent* — the exact
   operation the §V grounding layer performs ("No supported path from Vendor X to Y").
   **VERIFIED — RDFox** produces the same nested form with `EXPLICIT` leaf markers, and
   `explain shortest` returns a minimal proof rather than all proofs.
3. **Unsat cores** (clingo). **VERIFIED** from the Python API:
   `SolveHandle.core() -> List[int]` — *"The subset of assumptions that made the problem
   unsatisfiable."* A *different* shape of answer: not "which node", but "which minimal set
   of rules is jointly inconsistent". Useful for contradictory **policies**, not
   contradictory **data**.

**VERIFIED, and a necessary caution — full proof trees do not scale.** From the Soufflé
provenance paper:

> *"Even for 20 levels, these proof trees contain over 15,000 nodes. Considering that full
> proof trees may have heights over 200, the corresponding full proof trees would be
> intractable to compute and understand due to exponential growth."*

> *"a naïve direct encoding approach, where each tuple is annotated with its full
> subproof… resulted in excessive memory usage (up to 100×) on a simple transitive closure
> experiment with 2000 tuples."*

**INFERRED:** ship the **depth-bounded** explanation (Soufflé's `setdepth`, default 4;
RDFox's `explain shortest`). A "show me the full derivation" button is a trap.

**VERIFIED — a bare ASP integrity constraint is NOT actionable.** `:- L1,…,Ln.` filters
solution candidates; a violated program returns `UNSATISFIABLE` and nothing else. You must
either reify (option 1) or solve under per-rule assumption atoms and read the core
(option 3). **INFERRED:** this is a strong argument against ASP as the default validator —
the actionable form requires a deliberate idiom, whereas SHACL and reified Datalog are
actionable by default.

**VERIFIED — ASP's grounding bottleneck.** From *Diminution* (arXiv:2508.08633):
*"Grounding a program P over HU(P) can result in an exponential blow-up in the size of the
grounded program"*; their mitigation *"cuts ground size by one to two orders of magnitude…
drops grounding time from more than a minute to a few seconds, and reduces the timeout rate
from 62% to under 5%."* **INFERRED:** the failure mode is a cliff, not a slope.

**Where ASP genuinely wins: repair generation.** **VERIFIED — Ahmetaj, David, Polleres,
Šimkus, ISWC 2022:** *"We propose an algorithm to compute repairs by encoding the
explanation problem — using Answer Set Programming (ASP) — into a logic program, the answer
sets of which correspond to (minimal) repairs… Our implementation in Clingo is — to the
best of our knowledge — the first implementation of a repair generator for SHACL."*
(Restricted to non-recursive SHACL.) **INFERRED:** "here is the minimal set of edges you
must add to make this valid" is a genuinely better `required_evidence` than "this edge is
missing", and it is a search problem, which is what ASP is for. Worth remembering as a
future upgrade, not a v0.2.9 dependency.

#### 3.5.6 The most relevant prior work in the entire lane

**VERIFIED — *Towards Verified Code Reasoning by LLMs* (arXiv:2509.26546).** This is
Datalog used to check an LLM *agent's reasoning*, which is our exact problem.

Method, quoted: *"Datalog facts can be used to represent the claims made by the agent…
Datalog rules can be used to capture the inferences made by the agent's output based on
other facts."* The agent's claims become facts, its inferences become rules, the property
becomes a verification condition, and Soufflé decides.

Measured:

- 20 uninitialised-variable errors: formal verification **validated the agent's reasoning
  on 13/20**
- 20 program-equivalence queries: **caught 6/8 incorrect judgments**
- **Proved 18/88 valid explanations**

And the authors' own characterisation, which is the single most useful sentence for our
gate design:

> *"Note that the verifier has perfect precision and low recall, because if the verifier
> says 'YES', then it is indeed verified but if the output is 'DON'T KNOW', then we are
> unsure of the agent's output. As we can observe, the verification step is only able to
> prove the validity of 18 out of 88 valid explanations. **Manual investigation of the
> results showed that the problem was due to inconsistent outputs from the model during the
> formalization steps.**"*

and the honesty note:

> *"we inherit the limitations of static analysis via Datalog. Thus, we cannot circumvent
> the undecidability of program equivalence, just because we are using LLMs!… what we are
> doing in this work is to simply act as a post facto check to what an LLM says in its
> reasoning."*

**INFERRED, and this is the finding I would put in front of the architect first:**

- The symbolic layer had **perfect precision**. Not 88%, not 94% — perfect. That is the
  signature of a closed-world check and it validates the §7 two-speed rule from a
  completely independent direction.
- The recall loss (18/88) was **entirely attributable to the LLM failing to emit facts
  consistently** during formalisation. The bottleneck was the natural-language→facts
  translation, not the solver.
- **Foreman does not have that bottleneck.** Our facts come from `git diff`, `events.jsonl`,
  `checks-result.json`, and the run record — instrumented tooling we own, not a model asked
  to formalise prose. **The published recall figure is therefore a floor for us, not a
  ceiling**, and it is the strongest available argument that the symbolic gate will behave
  better in Foreman than it does in the literature.

#### 3.5.7 Negative results (recorded because they are load-bearing)

The sub-lane searched for and did **not** find:

- Any published work using Datalog or ASP to validate a **multi-agent orchestrator's**
  knowledge graph. The nearest neighbour is AgentSpec (ICSE'26), which uses a bespoke
  trigger/predicate/enforce DSL at runtime with *"millisecond-level overhead"* — not
  Datalog, not ASP.
- Any work validating agent **plans** with Datalog/ASP (that literature is PDDL/VAL-based).
- Any direct **Datalog-vs-SHACL expressiveness comparison** paper with a separating
  example. The nearest works unify SHACL/ShEx/PG-Schema with each other, or import Datalog
  optimisations (magic sets) into SHACL.
- Any measured **ASP validation throughput** on a KG at 10^5–10^6 facts.
- Published Datalog benchmarks **at our scale** — everything is 10^6–10^9.

**INFERRED:** we are not late to this. There is no established practice to copy, and the
design space is open.

#### 3.5.8 Engine assessment (INFERRED, from the verified numbers above)

| Engine | Recursion | Negation | Incremental | Explanation | Fit for Foreman |
|---|---|---|---|---|---|
| **RDFox** | yes, parallel | stratified | **best in class** (0.49 s / 8.5k triples on 9.2G) | proof trees, `explain shortest` | Powerful; **commercial**; incremental machinery we do not need at 10^6 |
| **Soufflé** | yes (C++ codegen) | stratified | none — full re-eval | **best in class**: proof trees, `explainnegation`, JSON output, 1.27× overhead | Best explanations; C++ toolchain is a real dependency |
| **Nemo** | yes | stratified + existentials | none | **none** | Rust, laptop-class speed, no explain subsystem |
| **CozoDB** | yes | stratified, with an explicit pass that **aborts on unstratifiable programs** | none | none | Embeddable; loud failure on bad programs is a virtue |
| **DDlog / differential-dataflow** | yes | stratified | yes, by construction | none | Streaming deltas; no published throughput on the README |
| **Datomic rules** | not documented on the query reference | `not` / `not-join`, no documented stratification or termination semantics | query-time only | none | Weakest as a validator |
| **clingo (ASP)** | yes | full (stable models) | n/a | unsat cores; **boolean by default** | Right tool only for **repair generation** |

**INFERRED, my recommendation for Foreman specifically, and it differs from the sub-lane's:**
the sub-lane recommends stratified Datalog with reified violation predicates over SHACL
Core, and on the technical merits it is right — P-complete beats NP-hard, proof trees beat
pointers, derived predicates beat none. But every Datalog engine listed is a **new
non-trivial runtime dependency** (C++ codegen, a Rust library, or a commercial licence) for
a project that is currently bash + jq + git, and none of the checks in §7.7 items 1–5
*need* recursion. My recommendation is therefore:

- **v0.2.9: no engine at all.** Implement G1–G6, G9 as deterministic scripts over JSON.
  The reified-violation-predicate *shape* of the output — one addressed record per
  violation — is the part worth copying, and it is free.
- **When the graph plane lands:** SHACL Core (+ SPARQL targets) for the write-time
  invariants, because the shapes are declarative, the report vocabulary is standardised,
  and it is one `pip install`.
- **Revisit Datalog only when a real constraint needs recursion** — the most likely
  candidate being "every claim traces to a Source within k hops" or a cyclic-dependency
  check over the work DAG. Design constraints declaratively and side-effect-free now so
  that migration stays possible.


---

## 4. Grounding LLM claims in graph evidence — measured numbers

This is the section that should most change our plans, because the numbers are worse than
the enthusiasm around KG-grounded verification suggests.

### 4.1 Verifying KG statements against retrieved evidence

**VERIFIED — Adam & Kliegr, *Traceable LLM-based validation of statements in knowledge
graphs*, Information Processing & Management 62(4), 2025, art. 104128 (arXiv:2409.07507).**

Method: deliberately avoids the LLM's internal knowledge; compares each RDF statement
against retrieved document chunks (web search or Wikipedia), so every verdict carries a
citation. Evaluated on **1,719 positive statements from BioRED + 1,719 generated negative
statements**.

| Metric | Value |
|---|---|
| Precision (micro-avg across both predicates) | **87.7%** |
| Recall | **44.4%** |
| F1 | **59.0%** |
| **False-positive rate** | **~12%** |
| Best-case per-concept-pair precision | ~90%+ (two combinations reached 100%) |
| Worst-case per-concept-pair precision | 76% |
| Recall range per concept pair | mostly 50–60%, best 84% |

Authors' own conclusion, quoted: *"the 12% false positive rate still implies the need for
human oversight."* And: *"The resulting precision is 88%, and recall is 44%. This indicates
that the method requires human oversight."*

Context number, also quoted from the same paper: *"between 50% to 90% of LLM responses are
not fully supported by the sources provided (Wu et al, 2024)."*

Baselines they compared against on SNLI-style contradiction detection: a "loose" approach
reached **F1 11%**, a "strict" approach **F1 1%** — i.e. naive entailment heuristics are
useless here. Their own SNLI accuracy: **65.8% (Llama 3 8B)**, **86.7% (Llama 3 70B)**.

### 4.2 KG-grounded fact-checking: the precision/recall shape

**VERIFIED — Kolli et al., *Hybrid Fact-Checking that Integrates Knowledge Graphs, Large
Language Models, and Search-Based Retrieval Agents*, WiNLP 2025.** FEVER
Supported/Refuted split:

| Configuration | Precision | Recall | F1 |
|---|---|---|---|
| Random | 0.500 | 0.500 | 0.500 |
| BERT-Base, no retrieval | 0.649 | 0.594 | 0.620 |
| Zero-shot GPT-4o-mini (no evidence) | 0.826 | 0.790 | 0.801 |
| **KG alone + LLM** | **0.944** | **0.734** | **0.826** |
| KG alone + DeBERTa | 0.882 | 0.620 | 0.714 |
| Web only + LLM | 0.912 | 0.908 | 0.909 |
| Full hybrid (LLM → DeBERTa) | 0.930 | 0.926 | 0.927 |
| Full hybrid, GPT-4.1-mini | **0.932** | **0.931** | **0.931** |

Cross-dataset transfer without fine-tuning: **FEVER 2.0 P 0.797 / R 0.769 / F1 0.783**;
**FactKG P 0.791 / R 0.757 / F1 0.774**.

Three things matter here:

1. **The KG-only check is the highest-precision, lowest-recall configuration** (0.944 /
   0.734). The authors state the design intent explicitly: *"We adopt a KG-first approach
   to prioritize precision and interpretability"* — noting it *"results in high precision
   (0.944) but lower recall (0.734), reflecting reliable yet sparse coverage."* The graph
   fallback (web search) fired on **~23% of test cases**.
2. **The three-way split collapses.** Binary S/R accuracy **0.931**; adding the
   Not-Enough-Information class drops it to **0.702**. **INFERRED:** "I cannot tell" is the
   hardest label, and it is *exactly the label a gate needs to emit* when evidence is
   missing. Systems that are excellent at S/R are mediocre at knowing when they do not
   know.
3. **Even humans disagree on evidence sufficiency.** In their reannotation of 150
   NEI-labelled claims: **Fleiss' κ = 0.385** among human annotators, unanimous agreement
   in only **70.7%** of instances. **INFERRED:** if humans achieve moderate agreement on
   "is this evidence sufficient", an automated sufficiency gate cannot be held to a higher
   standard, and must therefore not be terminal.

### 4.3 Triple verification with an agentic loop

**VERIFIED — SHARP (arXiv:2604.04190, HIT + Huawei, April 2026).** Training-free agent
combining schema-aware planning with a hybrid KG-structure + external-text toolset;
accuracy gains of **+4.2%** on FB15K-237 and **+12.9%** on Wikidata5M-Ind over prior SOTA,
with *"transparent, fact-based evidence chains for each judgment"*. Notable for us as the
"model + graph, with the evidence chain as the output artifact" pattern — the evidence
chain is what makes a verdict auditable.

### 4.4 What this means for a Foreman gate

**INFERRED, and this is the central risk finding of the lane.**

Take the best measured open-world grounding numbers — call it 93% precision. Foreman
merges, say, 40 lanes a week. A blocking evidence-sufficiency check at 93% precision
false-blocks roughly **3 correct merges per week**. Every one of those costs a respawn
cycle, and worse, it *teaches the operator to bypass the gate*. That is the exact
mechanism by which constraint enforcement gets disabled in practice (§9).

Contrast with a closed-world structural check — "this finding cites `src/foo.ts:120`;
`src/foo.ts` is not in the diff" — which has a **0% false-positive rate by construction**,
because it is a set-membership test over data we own, not an inference about the world.

**The design rule that follows: only closed-world checks may block.**

---

## 5. Symbolic verification of code — the complementarity evidence

The lane brief asks for measurable evidence that symbolic checks catch defects an LLM
reviewer misses, and vice versa. There is a good and a recent answer.

### 5.1 The primary result: specification vs AI review

**VERIFIED — Zietsman, *The Specification as Quality Gate: Three Hypotheses on AI-Assisted
Code Review*, arXiv:2603.25773, March 2026.**

The structural argument first, because it applies to Foreman directly:

> *"When an AI coding agent generates code and a separate AI reviewer examines it without
> an external specification, both agents reason from the same artefact: the code. The
> reviewer has no ground truth to compare against. It checks the code against itself, not
> against intent."*

And on the cross-vendor mitigation Foreman already implements:

> *"A cross-family pipeline, Grok reviewing Claude-generated code for instance, has more
> independence than a same-family pipeline… But model diversity does not supply ground
> truth. A cross-family reviewer without an external specification is still checking code
> against code, not code against intent… **Diversity reduces correlation. Specification
> eliminates circularity. Both are required.**"*

**This is a direct hit on Foreman's current design.** Our cross-vendor invariant (auditor
vendor ≠ worker vendor) buys the *diversity* half. The five-part spec is meant to buy the
*specification* half, but it is prose, evaluated by a model — so it does not currently
eliminate circularity. Only `checks-result.json` (the independent test run) does.

**Experiment 2 — domain-convention violations, neutral docstrings, Claude reviewer, 5 runs
per function:**

| Function | BDD | AI review | Detection rate |
|---|---|---|---|
| `prorate_premium` | caught | 5/5 | 100% |
| `apply_tiered_tax` | caught | 5/5 | 100% |
| `schedule_maintenance` | caught | 5/5 | 100% |
| `calculate_dilution` | caught | 4/5 | 80% |
| `interpolate_rate` | caught | **0/5** | **0%** |

**Experiment 3 — cross-family panel, four models, three families, five runs each:**

| Function | Domain | BDD | Claude | Codex | Gemini | Amazon Q |
|---|---|---|---|---|---|---|
| `calculate_final_reserve_fuel` | Aviation (ICAO) | caught | 0/5 | 0/5 | 5/5 | 0/5 |
| `get_gas_day` | Energy (NAESB) | caught | 5/5 | 5/5 | 5/5 | 2/5 |
| `validate_diagnosis_sequence` | Healthcare (ICD-10-CM) | caught | **0/5** | **0/5** | **0/5** | **0/5** |
| `validate_imo_number` | Maritime (IMO) | caught | 5/5 | 5/5 | 5/5 | 0/5 |
| `electricity_cost` | Utility billing | caught | 5/5 | 5/5 | 5/5 | 5/5 |

Three findings worth carrying forward verbatim:

- **The 0/20 result.** *"The ICD-10-CM external cause code rule (V00-Y99 codes cannot be
  the principal diagnosis) was missed by all four models at 0/5… No model even approximated
  the rule."* Cross-vendor diversity bought **nothing** on this defect.
- **Confident wrong answers.** On the ICAO fuel reserve bug: *"Claude did not merely miss
  the bug. In all five runs, it confidently asserted the swapped values as the correct
  ICAO rules and declared the implementation correct. The model filled in the wrong
  convention and defended it."*
- **Detection is contaminated by incidental code signals.** Removing an unused `timedelta`
  import dropped Amazon Q's detection from 5/5 to 2/5 — *"demonstrating the sensitivity of
  detection to incidental code signals."*

Limitations, stated by the author and repeated here in good faith: planted-bug corpus, not
a natural defect sample; the BDD scenarios were optimally targeted at the planted defects;
two of the four "cross-family" models share an Anthropic base; results are *"directional,
not statistically significant."*

### 5.2 The residual defect taxonomy — what survives the symbolic layer

**VERIFIED**, same paper. This is the most directly reusable artifact in the whole lane,
because it tells us precisely what must stay model-judged.

| Category | Definition | Right tool | Foreman mapping |
|---|---|---|---|
| **A. Theoretically specifiable, not yet specified** | Boundary conditions, error paths, unexercised state transitions. *"The gap is a process failure, not a theoretical limitation."* | Specification discipline + coverage analysis | Five-part spec's *verification* section; `checks-result.json` |
| **B. Specifiable in principle, economically impractical** | Combinatorial input spaces, full interaction matrices | Property-based testing; *"a legitimate target for AI review that brings genuine sampling diversity, provided the reviewer draws from a different prior than the generator"* | Cross-vendor auditor **earns its keep here** |
| **C. Inherently unspecifiable pre-execution** | Race conditions, partial network failure, hardware-dependent performance | Runtime verification, observability, chaos/load testing. *"Neither pre-deployment specifications nor AI review agents are the right tool here."* | Out of gate scope. Do not pretend the gate covers it |
| **D. Structural / architectural** | Coupling, layer-boundary violations, design drift, half-completed migrations, dead abstractions | Deterministic architecture tooling *first* (ArchUnit, Dependency Cruiser, Pact); AI review only for *"the unarticulated architectural intent that has not yet been expressed as an enforceable rule"* | **The legitimate home of the Codex Sol audit lane.** Also the least empirically grounded category — *"no controlled study has yet isolated this residual as a distinct defect class"* |
| **E. Specification defects** | The spec itself is wrong. *"If the specification is wrong, the pipeline confirms the wrong thing."* | Human: user testing, requirements validation, design thinking | **Cannot be automated. Ever.** Grounded in Barr et al. (2015) oracle-problem result: complete oracles are theoretically impossible for most real software |

### 5.3 Complementarity, measured from the other direction

**VERIFIED — Tanaka et al., AIware 2025 (arXiv:2510.25297).** 16 HumanEval problems where
standard solutions failed on extended tests; PBT and example-based tests generated by
Claude-4-sonnet:

- PBT alone: **68.75%** bug detection
- EBT alone: **68.75%**
- **Both combined: 81.25%**

*"PBT effectively detects performance issues and edge cases through extensive input space
exploration, while EBT effectively detects specific boundary conditions and special
patterns."* Two symbolic-ish techniques with **identical headline rates and
non-overlapping catches** — a clean complementarity result and a caution against
single-technique gates.

**VERIFIED — *Do Code LLMs Do Static Analysis?* (arXiv:2505.12118).** LLMs asked to perform
the analyses static tools perform exactly:

- Call-graph generation, Java: GPT-base Jaccard **0.121**, GPT-in-context **0.122**,
  Gemini-base **0.186**, Gemini-in-context **0.191**
- *"Overall, we found that LLMs do a poor job on callgraph generation and data flow graph
  generation and in-context learning does not help."*
- *"finetuning improves pair accuracy and Jaccard similarity although we do not observe
  significant improvement on chain accuracy. This result shows that LLMs struggle with more
  complex reasoning."*

**INFERRED:** this is the clean converse. A static analyser produces a sound call graph in
milliseconds; a frontier LLM reproduces ~12–19% of its edges. Any Foreman check that
depends on reachability, taint flow, or dependency structure should be a tool call, never
a model question.

**VERIFIED — Du et al., Tencent (arXiv:2601.18844), Jan 2026.** Industrial dataset of
**433 static-analysis alarms (328 false positives, 105 true positives)** from Tencent's
Advertising and Marketing Services codebase:

- Baseline FP rate: **75.8%** of alarms are false — *"10-20 minutes of manual inspection
  per alarm"*
- *"hybrid techniques of LLM and static analysis eliminate 94-98% of false positives with
  high recall"*
- Cost: **2.1–109.5 s and $0.0011–$0.12 per alarm** — *"orders-of-magnitude savings
  compared to manual review"*

**INFERRED:** this is the *canonical* complementarity architecture and it is the inverse of
the usual framing. The symbolic tool provides **recall** (it flags everything structurally
suspicious, soundly); the model provides **precision** (it triages). Foreman's current gate
uses the model for both, which is why its verdict is load-bearing.

**VERIFIED — Meta ACH (arXiv:2501.12862).** Mutation-guided LLM test generation across
**10,795 Android Kotlin classes / 7 platforms**, generating **9,095 mutants** and **571
privacy-hardening tests**. The LLM-based equivalent-mutant detector: **precision 0.79,
recall 0.47** raw; **0.95 / 0.96** with simple pre-processing. Engineers accepted **73%** of
generated tests, judging **36%** privacy-relevant.

**VERIFIED — Property-Generated Solver (arXiv:2506.18315).** PBT-derived feedback moved
*"Wrong Answer"* outcomes from **25.3% → 10.5%** while *"Runtime Errors" (including PBT
assertion failures) increase from 4.6% to 11.8%, this reflects PGS converting latent
logical flaws into explicit, actionable property violations.* Relative pass@1 gains of
**23.1%–37.3%** over TDD baselines.

**INFERRED:** that trade — silent wrong answers converted into loud, addressed violations —
is precisely what a symbolic gate is *for*. It is the same value proposition as
`sh:focusNode`, at the code layer.

### 5.4 Symbolic verification of an agent's *reasoning*, not just its code

**VERIFIED — *Towards Verified Code Reasoning by LLMs* (arXiv:2509.26546).** Detailed in
§3.5.6; repeated here because it belongs in the complementarity story. The agent's claims
are extracted into Soufflé Datalog facts, its inferences into rules, and the property into
a verification condition; the solver then adjudicates the agent's own reasoning.

- 20 uninitialised-variable errors → agent reasoning **validated on 13/20**
- 20 program-equivalence queries → **6/8 incorrect judgments caught**
- **18/88** valid explanations proved

> *"the verifier has perfect precision and low recall… **the problem was due to
> inconsistent outputs from the model during the formalization steps.**"*

**INFERRED:** perfect precision with limited recall is the canonical shape of a sound
closed-world check, and it is the exact profile a merge gate wants: *never wrong when it
speaks, silent when unsure.* The complementarity is therefore not "symbolic finds different
bugs than the model" — it is **"symbolic is never wrong and often silent; the model is
usually right and never silent."** Compose them accordingly: symbolic decides where it can
speak, the model covers the silence, and the gate never lets the model's coverage be
mistaken for the symbolic layer's certainty.

### 5.5 And the reliability of the model half

**VERIFIED — Judge Reliability Harness, RAND, arXiv:2603.05399, March 2026.** Stress-tests
LLM judges for label-flip discrimination, format invariance, paraphrase invariance,
verbosity bias, stochastic stability, and ordinal calibration. Headline conclusion:

> *"No judge that we evaluated is uniformly reliable across benchmarks using our harness."*

and

> *"Point estimates of agreement with human raters on small validation sets provide limited
> assurance about how a judge will respond to realistic variations in inputs, such as
> changes in formatting, paraphrasing, verbosity, or sampling parameters."*

**INFERRED, applied to Foreman:** our audit verdict is a single sample from one judge on
one formatting of one diff. The harness result says that sample is not stable under
perturbations that carry no semantic content. That is an argument for (a) never letting the
verdict be the *only* blocking signal, and (b) adding cheap determinism around it — which
is exactly what §7 proposes.

---

## 6. The four provenance invariants as concrete constraints

The source paper's Appendix states: *"Every graph write satisfies four invariants: (1)
every claim has a source or is marked inference; (2) every artifact has an authoring run
and version; (3) every evaluation identifies a rubric; (4) every superseded object remains
addressable."*

Below: real SHACL for each, plus the TerminusDB schema equivalent, plus an honest verdict
on static enforceability. Namespace `fm:` = Foreman ontology.

**Summary verdict table** (details follow):

| # | Invariant | Statically enforceable? | Enforceable by what | The part that is NOT static |
|---|---|---|---|---|
| 1 | Claim has source or is marked inference | **Yes, fully** | SHACL Core `sh:xone` | That the source *actually supports* the claim |
| 2 | Artifact has authoring run + version | **Yes, fully** | SHACL Core `sh:minCount`/`sh:maxCount`/`sh:pattern` | That `contentHash` matches the actual bytes |
| 3 | Evaluation identifies a rubric | **Yes for the link; No for the findings** | SHACL Core for the rubric edge; SHACL-SPARQL or a script for finding-groundedness | That every finding cites a real location in the reviewed diff |
| 4 | Superseded object remains addressable | **No — this is the one that cannot be a shape** | Requires a procedural/storage guarantee | Absence of deletion. SHACL validates what *is present*; it cannot see what was removed |

### 6.1 Invariant 1 — every claim has a source or is marked inference

> **Correction, see §6.6.** The `sh:xone` formulation below was executed against pySHACL
> and *detects* the violation correctly but reports it **unactionably** — the inner
> `sh:message` strings are swallowed by the combinator. §6.6 gives the corrected,
> executed-and-verified formulation using SPARQL-targeted shapes. The version below is
> retained because it is the obvious first attempt and the failure is instructive.

```turtle
fm:ClaimShape a sh:NodeShape ;
  sh:targetClass fm:Claim ;
  sh:severity sh:Violation ;

  # exactly one epistemic status, from a closed vocabulary
  sh:property [
    sh:path fm:epistemicStatus ;
    sh:in ( fm:Sourced fm:Inference ) ;
    sh:minCount 1 ; sh:maxCount 1 ;
    sh:message "claim has no epistemicStatus; must be fm:Sourced or fm:Inference" ;
  ] ;

  # ...and the status must be backed by the corresponding edge
  sh:xone (
    [ sh:property [ sh:path fm:epistemicStatus ; sh:hasValue fm:Sourced ] ;
      sh:property [ sh:path fm:supportedBy ;
                    sh:class fm:Source ; sh:minCount 1 ;
                    sh:message "required_evidence: at least one fm:supportedBy edge to an fm:Source" ] ]
    [ sh:property [ sh:path fm:epistemicStatus ; sh:hasValue fm:Inference ] ;
      sh:property [ sh:path fm:derivedFrom ;
                    sh:class fm:Claim ; sh:minCount 1 ;
                    sh:message "required_evidence: an fm:derivedFrom edge to the premise claim(s)" ] ;
      sh:property [ sh:path fm:inferredBy ;
                    sh:class fm:AgentRun ; sh:minCount 1 ; sh:maxCount 1 ;
                    sh:message "required_evidence: the AgentRun that performed the inference" ] ] ) .
```

TerminusDB equivalent:

```json
{ "@type": "Enum", "@id": "EpistemicStatus", "@value": ["Sourced", "Inference"] }

{ "@type": "Class", "@id": "Claim",
  "@key": { "@type": "ValueHash" },
  "text":            "xsd:string",
  "epistemicStatus": "EpistemicStatus",
  "supportedBy":     { "@type": "Set", "@class": "Source" },
  "derivedFrom":     { "@type": "Set", "@class": "Claim"  },
  "inferredBy":      { "@type": "Optional", "@class": "AgentRun" } }
```

**Statically enforceable: YES, fully, in SHACL Core.** No SPARQL, no recursion, no
reasoner. Cost is one pass over `fm:Claim` instances.

**Important limitation, stated honestly.** TerminusDB's schema layer can enforce the types
and the cardinalities, but **it has no conditional/disjunctive constraint equivalent to
`sh:xone`** — `@oneOf`/`TaggedUnion` gives *mutually disjoint property sets*, not "if
status=Sourced then supportedBy ≥ 1". Encoding invariant 1 in TerminusDB alone requires
either modelling `Claim` as a `TaggedUnion` of `SourcedClaim | InferredClaim` (clean, but
changes the class identity of a claim if its status ever changes) or a procedural check at
write time. **INFERRED** from the schema reference; verify against a live instance before
committing to a modelling choice.

**What this does NOT enforce, and cannot:** that the `fm:Source` actually supports the
claim. That is the §4 problem, measured at 88% precision / 44% recall. The shape enforces
*citation discipline*, not *citation correctness* — a distinction worth writing into the
doctrine so nobody later mistakes a green validation for a verified claim.

### 6.2 Invariant 2 — every artifact has an authoring run and version

```turtle
fm:ArtifactShape a sh:NodeShape ;
  sh:targetClass fm:Artifact ;
  sh:severity sh:Violation ;

  sh:property [ sh:path fm:producedBy ;
                sh:class fm:AgentRun ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:message "required_evidence: exactly one fm:producedBy edge to the authoring AgentRun" ] ;

  sh:property [ sh:path fm:version ;
                sh:datatype xsd:integer ; sh:minInclusive 1 ;
                sh:minCount 1 ; sh:maxCount 1 ;
                sh:message "required_evidence: a monotonic integer fm:version" ] ;

  sh:property [ sh:path fm:contentHash ;
                sh:datatype xsd:string ; sh:pattern "^sha256:[0-9a-f]{64}$" ;
                sh:minCount 1 ; sh:maxCount 1 ;
                sh:message "required_evidence: fm:contentHash as sha256:<64 hex>" ] ;

  sh:property [ sh:path fm:createdAt ;
                sh:datatype xsd:dateTime ; sh:minCount 1 ; sh:maxCount 1 ] .

# The AgentRun on the other end must itself be complete — otherwise invariant 2
# is satisfied by pointing at an empty node.
fm:AgentRunShape a sh:NodeShape ;
  sh:targetClass fm:AgentRun ;
  sh:property [ sh:path fm:vendor ;    sh:in ( fm:grok fm:codex fm:gemini fm:claude ) ;
                sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path fm:model ;     sh:datatype xsd:string ; sh:minCount 1 ] ;
  sh:property [ sh:path fm:startedAt ; sh:datatype xsd:dateTime ; sh:minCount 1 ] ;
  sh:property [ sh:path fm:baseSha ;   sh:pattern "^[0-9a-f]{40}$" ; sh:minCount 1 ] ;
  sh:property [ sh:path fm:worktree ;  sh:datatype xsd:string ; sh:minCount 1 ] .
```

TerminusDB:

```json
{ "@type": "Class", "@id": "Artifact",
  "@key": { "@type": "Lexical", "@fields": ["path", "version"] },
  "path":        "xsd:string",
  "version":     "xsd:positiveInteger",
  "contentHash": "xsd:string",
  "createdAt":   "xsd:dateTime",
  "producedBy":  "AgentRun" }
```

**Statically enforceable: YES for structure and format.** `sh:pattern` gives us the
sha256 shape check for free; TerminusDB does **not** have a regex/pattern constraint, so
the hash-format check must be a shape or a script there.

**NOT statically enforceable:** that `contentHash` is the hash of the bytes at `path` at
`version`. No schema language can compute a digest. This is a **procedural check** — a
one-line `sha256sum` comparison in the gate script. Note this is already the same shape as
Foreman's existing `hash_snapshot` / `hashes.txt` drift check in `gate-eval.sh`; the
graph invariant is a generalisation of a mechanism we already ship.

**INFERRED, recommended:** make the `AgentRun` node's `@key` a `Lexical` key over
`(runId, laneId)` so that the graph write is idempotent under lane retry. Idempotent writes
are what let you revalidate cheaply.

### 6.3 Invariant 3 — every evaluation identifies a rubric

This is the invariant that maps most directly onto Foreman's `audit-verdict.json`, and the
one with the most room to convert model judgment into determinism.

```turtle
fm:EvaluationShape a sh:NodeShape ;
  sh:targetClass fm:Evaluation ;
  sh:severity sh:Violation ;

  sh:property [ sh:path fm:appliesRubric ;
                sh:class fm:Rubric ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:message "required_evidence: exactly one fm:appliesRubric edge naming the rubric used" ] ;
  sh:property [ sh:path fm:rubricVersion ;
                sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:message "required_evidence: the rubric version pinned at evaluation time" ] ;
  sh:property [ sh:path fm:evaluates ;
                sh:class fm:Artifact ; sh:minCount 1 ;
                sh:message "required_evidence: the artifact version(s) evaluated" ] ;
  sh:property [ sh:path fm:evaluatorRun ;
                sh:class fm:AgentRun ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path fm:verdict ;
                sh:in ( fm:APPROVED fm:WARNING fm:BLOCKED ) ;
                sh:minCount 1 ; sh:maxCount 1 ] ;

  # Cross-vendor invariant, expressed as a shape rather than as prose doctrine.
  sh:sparql [
    sh:message "cross-vendor violation: evaluator vendor {?v} equals worker vendor for {?art}" ;
    sh:prefixes fm: ;
    sh:select """
      SELECT $this ?v ?art WHERE {
        $this fm:evaluatorRun/fm:vendor ?v ;
              fm:evaluates          ?art .
        ?art  fm:producedBy/fm:vendor ?v .
      }""" ] .

# A finding must be addressed: severity, a real file, a rubric criterion.
fm:FindingShape a sh:NodeShape ;
  sh:targetClass fm:Finding ;
  sh:property [ sh:path fm:severity ;
                sh:in ( fm:critical fm:high fm:medium fm:low ) ;
                sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path fm:citesFile ;
                sh:class fm:ChangedFile ; sh:minCount 1 ;
                sh:message "required_evidence: fm:citesFile must resolve to a file present in the reviewed diff" ] ;
  sh:property [ sh:path fm:againstCriterion ;
                sh:class fm:Criterion ; sh:minCount 1 ;
                sh:message "required_evidence: the acceptance criterion this finding is measured against" ] .

# Every acceptance criterion must be discharged by something.
fm:CriterionCoverageShape a sh:NodeShape ;
  sh:targetClass fm:Criterion ;
  sh:property [ sh:path [ sh:alternativePath ( fm:dischargedByCheck fm:dischargedByFinding fm:waivedBy ) ] ;
                sh:minCount 1 ;
                sh:message "required_evidence: criterion is neither covered by a check, nor by a finding, nor explicitly waived" ] .
```

**Statically enforceable:**

- The rubric link, rubric version, verdict enum, evaluated-artifact link, severity enum:
  **YES, SHACL Core.**
- The cross-vendor invariant: **YES**, but needs SHACL-SPARQL (it is a 2-hop join). It is
  currently prose doctrine in `references/audit-checklist.md` ("**Invariant:** auditor
  vendor ≠ worker vendor"). Making it a shape makes it enforced rather than remembered.
- Criterion coverage: **YES** in SHACL Core via `sh:alternativePath`.
- **Finding groundedness** — that `fm:citesFile` points at a file actually in the diff —
  is only static *if you materialise the diff into the graph*. **INFERRED, and this is the
  single highest-value new check in the whole lane:** emit one `fm:ChangedFile` node per
  path in `git diff --name-only BASE...HEAD`, and one `fm:ChangedHunk` per hunk with its
  line range. Then "the auditor cited a file that is not in the diff" and "the auditor
  cited a line outside any changed hunk" become **closed-world set-membership tests with a
  0% false-positive rate**. That directly catches hallucinated findings, which is a real
  and currently undetected failure mode of the audit lane.

**NOT enforceable:** whether the finding is *right*. Groundedness is necessary, not
sufficient.

### 6.4 Invariant 4 — every superseded object remains addressable

**This is the one that is not a shape, and it is worth being blunt about why.**

SHACL, ShEx, and TerminusDB schemas are all constraint languages over *the graph as it
is*. Invariant 4 is a constraint over *the difference between two graph states*: nothing
that was addressable is now unaddressable. A validator handed the post-write graph has no
access to the pre-write graph and therefore **cannot observe a deletion**. Any shape you
write here is checking a proxy, not the invariant.

What you *can* express statically, and should:

```turtle
# Anything on the receiving end of fm:supersedes must be a proper tombstone, not a hole.
fm:SupersededShape a sh:NodeShape ;
  sh:targetObjectsOf fm:supersedes ;
  sh:property [ sh:path fm:lifecycleState ; sh:hasValue fm:Superseded ;
                sh:minCount 1 ; sh:maxCount 1 ;
                sh:message "required_evidence: superseded object must carry lifecycleState=Superseded" ] ;
  sh:property [ sh:path fm:supersededBy ; sh:minCount 1 ;
                sh:message "required_evidence: back-edge to the superseding object" ] ;
  sh:property [ sh:path fm:retiredAt ; sh:datatype xsd:dateTime ; sh:minCount 1 ] ;
  sh:property [ sh:path fm:contentHash ; sh:minCount 1 ;
                sh:message "required_evidence: superseded object must retain its contentHash so the old bytes stay identifiable" ] .

# supersedes must be acyclic. SHACL Core cannot express transitive closure;
# this needs SHACL-SPARQL and a property path.
fm:SupersedesAcyclicShape a sh:NodeShape ;
  sh:targetClass fm:Artifact ;
  sh:sparql [
    sh:message "supersedes chain contains a cycle at {?this}" ;
    sh:prefixes fm: ;
    sh:select """SELECT $this WHERE { $this fm:supersedes+ $this . }""" ] .

# No live object may point at a node that has no type — the cheap dangling-reference proxy.
fm:NoDanglingRefShape a sh:NodeShape ;
  sh:targetClass fm:Claim ;
  sh:property [ sh:path fm:supersedes ;
                sh:nodeKind sh:IRI ;
                sh:node [ sh:property [ sh:path rdf:type ; sh:minCount 1 ] ] ;
                sh:message "supersedes points at an object with no type — likely deleted" ] .
```

**Verdict: NOT statically enforceable.** The real guarantee has to come from the storage
layer:

- **TerminusDB** is the right substrate here precisely because it is an immutable,
  commit-versioned store — every prior state remains addressable by commit id by
  construction. **But note a specific hazard, VERIFIED from the schema reference:**
  TerminusDB **cascade-deletes subdocuments when the last reference is removed**
  ("Deleting `Article/appendix` afterwards removes the last reference, and
  `Footnote/fn1` is cascade-deleted automatically"). **INFERRED consequence: never model a
  Claim, Evaluation, Finding, or Source as a `@subdocument`.** Model them as top-level
  document classes with their own `@id`, or invariant 4 is violated silently by garbage
  collection. This is a concrete, checkable modelling rule for lane N2.
- The procedural check that belongs in the gate: **re-resolve every IRI referenced by a
  `fm:supersedes` / `fm:supersededBy` edge and assert HTTP/graph 200**. Cheap, exact, and
  it tests the actual invariant rather than a proxy.

**INFERRED, general principle worth carrying:** invariants 1–3 are *shape* invariants
(properties of a single state); invariant 4 is a *history* invariant (a property of a state
transition). Shape languages enforce the first kind. The second kind needs either an
append-only store or an explicit diff check. Do not attempt to bully SHACL into doing it —
that is precisely the kind of over-reach that produces the brittleness stories in §9.

### 6.4b What TerminusDB's schema layer actually enforces at write time

Because TerminusDB is the candidate store, the invariant-enforceability question turns on
what its schema checker really does. **VERIFIED** by the brittleness sub-lane reading the
schema reference, troubleshooting guide, and release notes.

**Enforced at write time, in-transaction, closed-world:** document class membership;
property datatypes (`xsd:*`); required vs `Optional`; cardinality via `Set`/`List`/`Array`
(`@cardinality`, `@min_cardinality`, `@max_cardinality`); enum membership (as URIs —
`Status/Active`, not `"Active"`); `@key` strategies; `@oneOf` / `TaggedUnion` disjointness;
class-hierarchy acyclicity; multiple inheritance only where inherited same-named properties
share a range (*"If range classes conflict, the schema check fails"*); referential integrity
of links; `@shared` cascade-delete liveness at commit. Documents *"must be directed acyclic
graphs, they cannot be cyclic."* The store's own framing: *"every commit is atomic,
consistent, isolated, and durable, **with schema validation enforced on every write**."*

**NOT enforceable, and this is the list that matters:**

| Missing | Consequence for our invariants |
|---|---|
| **No regex / pattern constraint** | Invariant 2's `sha256:[0-9a-f]{64}` format check **cannot** be a TerminusDB schema constraint. Needs SHACL or a script |
| **No min/max value ranges** | `version ≥ 1` cannot be schema-enforced |
| **No uniqueness constraints** | "one Evaluation per (artifact, rubric)" cannot be schema-enforced |
| **No cross-document invariants** | The cross-vendor rule (G4) and criterion coverage (G3) are out of reach; they must be WOQL queries or scripts, *not* write-path checks |
| **No conditional constraints** | Invariant 1 (`sh:xone`-equivalent) has no native form — confirms §6.1 |
| **`Foreign` types have "no referential integrity checking"** | Any `Foreign` reference is an unchecked hole |
| **`sys:JSON` / `sys:JSONDocument`** = *"a subdocument that is not schema checked"* | A total escape hatch. **INFERRED: forbid it in the Foreman schema, or the invariants are optional** |
| **OWL validation removed in v10.0.0** | No disjointness/functional-property reasoning at all |

The only extension point is a **pre-commit hook** (*"to allow implementation of custom
schema validations"*, per the release notes).

**INFERRED, and it revises §6's earlier optimism:** TerminusDB gives us **structure**
(types, cardinality, links, immutability, per-branch isolation) and gives us **nothing
declarative** for format, range, uniqueness, or conditionality. The clean division of
labour is therefore:

- **TerminusDB schema** — invariant 2's *structural* half, invariant 3's rubric link,
  and the immutability that makes invariant 4 true by construction.
- **SHACL (or scripts) in the pre-commit hook / at the gate** — formats, conditionals,
  cross-document checks, and all nine Tier-2 checks.

Do not expect one layer to carry both.

**Historical note worth knowing before we commit.** TerminusDB's founders evaluated and
rejected SHACL, on record (issue #123, 2020). Gavin Mendel-Gleason: *"We evaluated SHACL
but ultimately felt that **it was not sufficiently well defined (negation with cardinalities
led to non-monotonic functors which can not be the basis of an inductive definition)** and
**did not add much extra over the constraint interpretation of OWL** and had the downside of
**requiring two languages rather than one**."* Kevin Feeney: *"we came to the conclusion that
it was far inferior to just using OWL in a closed world regime — OWL has the benefit of
having a really well thought out logical underpinning, well defined complexities and so on —
**SHACL not so much**."*

**INFERRED:** the technical objection is the same one the academic literature later
formalised (§3.5.1 — recursive SHACL needed three competing logic-programming semantics
before it meant anything). It is a real criticism. It does not change our recommendation,
because we are using the **non-recursive Core fragment**, which is exactly the part that
*is* well defined. But it does mean **running SHACL and TerminusDB together means running
two constraint languages**, which is precisely the cost they objected to — and that trade
should be made deliberately.

### 6.5 The SHACL report → `required_evidence` transform

Concretely, for a claim node that fails `fm:ClaimShape`:

```json
{
  "decision": "revise",
  "claim": "claim_441: retry path is idempotent",
  "reason": "No supported path from claim_441 to any fm:Source",
  "required_evidence": [
    "at least one fm:supportedBy edge to an fm:Source",
    "the AgentRun that performed the inference"
  ],
  "_provenance": {
    "focusNode": "fm:claim_441",
    "resultPath": "fm:supportedBy",
    "sourceShape": "fm:ClaimShape",
    "sourceConstraintComponent": "sh:MinCountConstraintComponent",
    "severity": "sh:Violation"
  }
}
```

Every field on the right comes mechanically from `sh:ValidationResult`; the
`required_evidence` array is the list of `sh:message` strings on the failing property
shapes. **INFERRED:** this is ~40 lines of `jq`-equivalent transform. Write the `sh:message`
strings *as* the required-evidence sentences and the transform is a projection, not a
translation.

### 6.6 Executed validation — the sketches above were run, not just written

**VERIFIED BY EXECUTION, 2026-07-28.** All shapes in §6.1–6.4 were run against a
hand-built data graph containing one conforming baseline plus five planted violations,
using **pySHACL 0.40.1** (installed in WSL for this test). This upgrades the sketches from
"plausible SHACL" to "SHACL that an engine accepts and evaluates correctly", and it turned
up two findings I would not have got from reading the spec.

**Setup.** Data graph (abridged): a conforming `fm:Claim` + `fm:Artifact`, plus —
(1) `fm:claim_441` declared `fm:Sourced` with no `fm:supportedBy` edge; (2)
`fm:artifact_bad` with no `fm:producedBy` and `contentHash "deadbeef"`; (3) `fm:finding_7`
citing `fm:file_not_in_diff`, which is not typed `fm:ChangedFile`; (4) `fm:eval_92` with a
verdict but no rubric; (5) `fm:claim_new fm:supersedes fm:claim_238` where `claim_238`
carries no tombstone.

**Result: all five caught, zero false positives on the baseline, in 0.192 s wall clock.**
Representative output:

```
Constraint Violation in ClassConstraintComponent:
    Severity:     sh:Violation
    Focus Node:   fm:finding_7
    Value Node:   fm:file_not_in_diff
    Result Path:  fm:citesFile
    Message:      fm:citesFile must resolve to a file present in the reviewed diff

Constraint Violation in PatternConstraintComponent:
    Focus Node:   fm:artifact_bad
    Value Node:   Literal("deadbeef")
    Result Path:  fm:contentHash
    Message:      fm:contentHash as sha256:<64 hex>

Constraint Violation in MinCountConstraintComponent:
    Focus Node:   fm:eval_92
    Result Path:  fm:appliesRubric
    Message:      exactly one fm:appliesRubric edge naming the rubric used
```

Note that G1 (finding groundedness) works exactly as designed: because
`fm:file_not_in_diff` is untyped, `sh:class fm:ChangedFile` fails and the report names the
finding, the path, *and* the bogus value. That is the hallucinated-citation detector, in
five lines of shape.

**Finding A — `sh:xone` destroys actionability. My §6.1 sketch was wrong.**

The `sh:xone` formulation of invariant 1 *detects* the violation but reports it uselessly:

```
Constraint Violation in XoneConstraintComponent:
    Focus Node: fm:claim_441
    Message: Node fm:claim_441 must conform to exactly one shape in
             [ sh:property [ sh:class fm:Source ; sh:message Literal("at least one
             fm:supportedBy edge to an fm:Source") ; sh:minCount ... ] ] , [ sh:property
             [ sh:class fm:AgentRun ; ... ] , [ sh:hasValue fm:Inference ; ... ] ]
```

The inner `sh:message` strings — the ones that *are* the `required_evidence` — are **not
surfaced as results**. They appear only as serialised shape text inside a generated
message. A `required_evidence` extractor gets nothing usable. Any logical combinator
(`sh:xone`, `sh:or`, `sh:not`) has this property: the combinator reports at its own level,
not at the level of the inner failures.

**Fix, also executed and VERIFIED.** Replace the combinator with two SPARQL-targeted node
shapes, one per epistemic status:

```turtle
fm:SourcedClaimShape a sh:NodeShape ;
  sh:target [ a sh:SPARQLTarget ;
    sh:select """SELECT ?this WHERE {
      ?this a fm:Claim ; fm:epistemicStatus fm:Sourced . }""" ] ;
  sh:property [ sh:path fm:supportedBy ; sh:class fm:Source ; sh:minCount 1 ;
                sh:message "required_evidence: at least one fm:supportedBy edge to an fm:Source" ] .

fm:InferredClaimShape a sh:NodeShape ;
  sh:target [ a sh:SPARQLTarget ;
    sh:select """SELECT ?this WHERE {
      ?this a fm:Claim ; fm:epistemicStatus fm:Inference . }""" ] ;
  sh:property [ sh:path fm:derivedFrom ; sh:class fm:Claim ; sh:minCount 1 ;
                sh:message "required_evidence: an fm:derivedFrom edge to the premise claim(s)" ] ;
  sh:property [ sh:path fm:inferredBy ; sh:class fm:AgentRun ; sh:minCount 1 ; sh:maxCount 1 ;
                sh:message "required_evidence: the AgentRun that performed the inference" ] .
```

Executed output (0.349 s), now perfectly actionable — one addressed result per missing
piece of evidence:

```
Focus Node: fm:claim_441  Result Path: fm:supportedBy
  Message: required_evidence: at least one fm:supportedBy edge to an fm:Source
Focus Node: fm:claim_500  Result Path: fm:derivedFrom
  Message: required_evidence: an fm:derivedFrom edge to the premise claim(s)
Focus Node: fm:claim_500  Result Path: fm:inferredBy
  Message: required_evidence: the AgentRun that performed the inference
```

**Design rule that follows (INFERRED from executed evidence): express conditional
obligations as targeted shapes, never as `sh:xone`/`sh:or`.** Note that a SPARQL *target*
is not a SPARQL *constraint* — it is a node-selection query evaluated once, not a
constraint evaluated per focus node, so it does not incur the §8.1 cost cliff. The
"Core-only in the blocking path" rule from §2.3 should be refined to: **Core constraint
components only; SPARQL permitted for target selection.**

**Finding B — the fail-open footgun. This is the most important executed result.**

Running the *same* shapes file against the *same* violating data, without pySHACL's
advanced-mode flag:

```
$ pyshacl -s shapes2.ttl -f human data2.ttl
Validation Report
Conforms: True
```

**The engine silently ignored every SPARQL-targeted shape and reported conformance.** No
warning, no error, exit code 0. A gate wired this way would pass a graph that violates
every provenance invariant, and would look green while doing it.

**INFERRED, and it belongs in the gate doctrine:** a SHACL-based gate must **assert on the
shape set, not just on the data**. Concretely, before trusting any validation run, assert
that a known-violating fixture produces the expected number of results. This is a
canary/self-test, and it is the same discipline `gate-eval.sh` already applies elsewhere
("docs-check missing (fail closed)"). Without it, a flag change, an engine upgrade, or an
unsupported constraint component converts the gate into a no-op — which is a much worse
outcome than the gate being slow, and it is precisely the silent-degradation class of
failure Foreman's existing fail-closed posture exists to prevent.

This also puts a number on §8.4's engine-maturity concern: it is not hypothetical that an
engine will quietly not evaluate a constraint you wrote. I hit it on the first try, with
the reference Python implementation, on a five-shape file.

**And it is not specific to pySHACL.** §8.6 documents **four further independent
instances** of the same fail-open class — AllegroGraph's own manual demonstrating a
one-character IRI typo yielding `Conforms`, the SHACL Play author raising it at the W3C WG,
Zazuko's engine author stating *"a failing SHACL target generates a report where everything
is fine"*, and RDF4J's default result truncation silently corrupting a **peer-reviewed
benchmark's** published numbers. Five instances across five tools is not a bug pattern; it
is a property of the contract. Plan for it.

**Finding C — measured cost on synthetic Foreman-shaped graphs.**

**VERIFIED BY EXECUTION, 2026-07-28.** I generated synthetic run subgraphs matching the
§7.3 node inventory (per run: 1 `AgentRun`, 1 `Source`, 1 `Rubric`, 4 `ChangedFile`,
6 `Claim`, 3 `Artifact`, 5 `Finding`, 1 `Evaluation` ≈ **56 triples per run**), with one
planted violation appended at the very end so the timing reflects a *full* scan. Validated
with the complete shape set (both files, advanced mode) using **pySHACL 0.40.1** in WSL2 —
deliberately the **slowest** engine in the ERA benchmark, so these are upper bounds.

| Synthetic runs | Triples | Wall clock | Violation found? |
|---|---|---|---|
| 20 | ~1,100 | **0.60 s** | yes |
| 200 | 11,202 | **1.68 s** | yes |
| 2,000 | 112,002 | **14.03 s** | yes |
| 10,000 | 560,002 | **67.72 s** | yes |

Roughly linear at **~8,000 triples/s** on the worst engine available.

**INFERRED, and this settles the feasibility question:**

- A **single run's subgraph is ~56 triples**. Tier 0 write-time validation of one run is
  **sub-second even with pySHACL** — small enough that the "validate in an uncommitted
  transaction, roll back on violation" strategy (§3.3 option 2) is simply free.
- The whole graph after **10,000 accumulated runs** — more than Foreman will produce in a
  long time — validates end-to-end in **68 s** on the slowest engine. A nightly full
  revalidation is comfortably affordable; on Jena it would be seconds.
- Tier 2's targeted validation never touches the accumulated graph at all, so its cost is
  **constant in graph size**.

The cost objection to write-time symbolic validation, at Foreman's scale, does not survive
measurement. The objections that *do* survive are engine maturity (§8.4) and the fail-open
footgun (Finding B) — both correctness concerns, not performance ones.

**Finding D — the report→`required_evidence` transform is real and small.**

Executed: `pyshacl -f json-ld` output piped through ~20 lines of Python produces exactly
the §V contract:

```json
[
  {
    "decision": "revise",
    "claim": "http://foreman.dev/ns#claim_441",
    "reason": "http://www.w3.org/ns/shacl#MinCountConstraintComponent",
    "required_evidence": [
      "required_evidence: at least one fm:supportedBy edge to an fm:Source"
    ],
    "_provenance": {
      "resultPath": "http://foreman.dev/ns#supportedBy",
      "severity": "http://www.w3.org/ns/shacl#Violation"
    }
  }
]
```

The §V grounding layer's output format is therefore **not new work** — it is a projection
of a standards-mandated report. Write the `sh:message` strings as the required-evidence
sentences and the transform is 20 lines.

---

## 7. Proposed gate design for Foreman

### 7.1 What the gate does today

Read from `skills/foreman/scripts/gate-eval.sh` and `merge-gate.sh` (v0.2.7 tree,
2026-07-28). `gate-eval.sh` accumulates `REASONS[]` and fails closed:

| # | Check | Kind | Blocking |
|---|---|---|---|
| 1 | forbidden path modified (`gate.forbidden_paths` globs vs `git diff --name-only BASE...HEAD`) | **deterministic** | yes |
| 2 | hash drift in protected files (`hash_snapshot` vs `hashes.txt`) | **deterministic** | yes |
| 3 | `checks-result.json.status == "pass"` (independent verification run) | **deterministic** | yes |
| 4 | `audit-verdict.json` schema-valid **and** verdict ≠ `BLOCKED` | **model judgment**, schema-wrapped | yes |
| 5 | `docs-check.json.status == "pass"` (fail closed if missing) | **deterministic** (linter) | yes |
| 6 | `merge-gate.sh check`: recorded merge-base resolves, is an ancestor of BRANCH, and is ≤ `durable.merge_base_max_commits` behind `origin/main` | **deterministic** | yes |

**This is already a good gate.** Five of six signals are deterministic. The honest
assessment is that Foreman's problem is *not* "the gate is all model judgment" — it is that
**check 4 is the only signal that reads the diff semantically, and it is entirely
unverified**. Nothing checks that the auditor looked at the right thing, cited real
locations, covered the acceptance criteria, or used the rubric it claims.

### 7.2 The proposal: five tiers, strict escalation, one blocking rule

The design rule from §4: **only closed-world checks may block.** A closed-world check is a
set-membership or structural test over data Foreman itself produced (the diff, the run
record, the spec, the shape set). An open-world check asks whether evidence *supports* a
claim, and by the measured numbers runs at 88–94% precision — good enough to advise, never
good enough to block.

| Tier | Name | Runs when | Nature | Verdict power | Cost |
|---|---|---|---|---|---|
| **0** | **Write-time schema** | on every graph write (`publish()`) | closed-world, SHACL Core / TerminusDB schema | **reject the write** | ms |
| **1** | **Repo determinism** | pre-merge | closed-world, existing `gate-eval.sh` checks 1,2,3,5,6 | **BLOCK** | seconds |
| **2** | **Audit groundedness** | pre-merge, after audit returns | closed-world, SHACL over the run subgraph | **BLOCK** | seconds |
| **3** | **Evidence sufficiency** | pre-merge, advisory | open-world, graph traversal + model | **WARN only, never block** | seconds–minutes |
| **4** | **Model judgment (residual)** | pre-merge | cross-vendor auditor, scoped to Categories B and D | **BLOCK on `BLOCKED`, as today** | minutes, $ |
| **5** | **Human** | on Tier-4 `BLOCKED`, or on any Tier-3 WARN the architect elects to escalate | Category E | final | — |

Escalation is **strictly ordered and short-circuiting**: a Tier-N failure means Tier-N+1
does not run. That matters for cost — there is no reason to spend a Codex Sol audit on a
diff that already fails hash drift, and no reason to run an audit whose findings will be
rejected at Tier 2 for citing files that are not in the diff.

### 7.2b Tier 0 has a concurrency problem, and Foreman is exactly the shape that hits it

**VERIFIED — RDF4J official documentation.** This is the finding that most constrains the
design, and it is specific to multi-agent orchestrators:

> *"Typically, in order to handle this scenario a user would need to use SERIALIZABLE
> transactions, **which are slow and prone to failure. The ShaclSail instead uses locking to
> run transactions one-after-the-other**"*

The reason is unavoidable rather than an implementation defect. Jeen Broekstra (RDF4J
project lead) on the design: *"It assumes the underlying store is fully valid, and aborts
any transaction that tries to change the data in a way that makes it non-compliant."*
Two transactions can each be individually valid and jointly invalid — worker A adds a
`Claim`, worker B removes its last `Source` — so a validator that guarantees "the committed
graph always conforms" must serialise writers.

**INFERRED, and it is a direct hit on Foreman's core architecture.** Foreman's whole point
is N isolated worktrees running concurrently. A naive Tier 0 that validates every graph
write against the *global* graph converts the graph plane into a **global mutex across all
lanes** — the single worst thing you can add to a parallel orchestrator.

**Three mitigations, in order of preference:**

1. **Validate per-lane, in isolation.** Each lane writes to its own named graph / branch,
   validated only against itself plus a read-only snapshot of the shared reference nodes.
   Lanes never contend. This is the same isolation discipline the worktrees already
   implement, applied to the graph plane — and it is what TerminusDB's branch model and
   SHACL-DS's named-graph targeting (§8.1) are both built for. **This is the recommended
   design.**
2. **Make the invariants lane-local by construction.** §6.1–6.3 are all
   single-node-plus-one-hop over nodes a single lane wrote. None of them is a cross-lane
   invariant. **INFERRED:** if the shape set stays lane-local, per-lane validation is not an
   approximation — it is complete. Cross-lane invariants (if any are ever added) belong to
   the nightly full pass, not the write path.
3. **Accept eventual validity.** Write unvalidated, validate at merge time (Tier 2), reject
   the merge rather than the write. Weaker guarantee, zero contention, and it composes
   naturally with the existing gate.

**The rule that follows: no cross-lane invariant may ever be placed on the write path.**
Worth stating in doctrine now, because it is the kind of constraint that is free to honour
at design time and extremely expensive to retrofit.

### 7.3 Tier 2 in detail — the new work

Tier 2 is the tier that converts part of the current model-judgment surface into
determinism. It runs **after** the auditor returns and **before** the verdict is consulted.
It validates the *audit artifact*, not the code.

Inputs materialised into the run subgraph (all from data Foreman already has):

- one `fm:ChangedFile` per path in `git diff --name-only BASE...HEAD`
- one `fm:ChangedHunk` per hunk, with `fm:startLine` / `fm:endLine`
- one `fm:Criterion` per acceptance criterion in the five-part spec
- one `fm:Finding` per element of `audit-verdict.json.findings`
- one `fm:Evaluation` for the audit itself, with `fm:evaluatorRun`, `fm:appliesRubric`,
  `fm:rubricVersion`
- one `fm:AgentRun` per lane, carrying `fm:vendor`, `fm:model`, `fm:baseSha`

Checks (all closed-world, all with `sh:focusNode`-addressed output):

| Tier-2 check | Catches | FP rate |
|---|---|---|
| **G1 finding-file groundedness** — every `fm:Finding fm:citesFile` resolves to an `fm:ChangedFile` | Hallucinated findings; audit of the wrong tree; stale path names | 0% by construction |
| **G2 finding-line groundedness** — `fm:citesLine` falls inside some `fm:ChangedHunk` range for that file | Findings attached to unchanged code — usually a sign the auditor reviewed the file rather than the diff | 0%; needs a documented allowance for "line 0 = file-level finding", which the existing schema already uses |
| **G3 criterion coverage** — every `fm:Criterion` is discharged by a check, a finding, or an explicit waiver | The failure mode the source paper's §V is about: silent non-coverage. A green audit that never looked at criterion 4 | 0% |
| **G4 cross-vendor invariant** — `evaluatorRun.vendor ≠ producedBy.vendor` for every evaluated artifact | Same-family audit slipping through. Currently prose doctrine only | 0% |
| **G5 rubric identification** — `fm:appliesRubric` + `fm:rubricVersion` present and the rubric version exists in the repo at `BASE_SHA` | Audits scored against a rubric that has since changed — the audit-side analogue of the existing hash-drift check | 0% |
| **G6 scope containment** — every `fm:ChangedFile` is inside the spec's declared `files in scope` | Drive-by scope expansion. Today this is audit dimension 5 ("Quality — drive-by scope expansion") and is model-judged; it is a glob test | 0%, given a declared scope |
| **G7 provenance invariants 1–3** — §6.1–6.3 shapes over every node the run wrote | Unsourced claims, artifacts with no run, evaluations with no rubric | 0% |
| **G8 supersedes integrity** — §6.4 shapes + procedural re-resolution of superseded IRIs | Silent loss of a prior artifact version | 0%; procedural half |
| **G9 verdict/finding consistency** — `verdict == APPROVED` implies no `fm:Finding` of severity `critical` or `high`; `verdict == BLOCKED` implies at least one `critical`/`high` finding **or** an explicit criterion miss | Self-inconsistent verdicts. The audit-checklist already states the rule in prose ("APPROVED: criteria met; no critical/high issues"); nothing enforces it | 0% |

G9 deserves a note. It is a pure **integrity constraint over the model's own output** —
the archetypal cheap symbolic win. The model is free to have any opinion; it is not free
to have an internally contradictory one. A `BLOCKED` with no findings, or an `APPROVED`
alongside a `critical`, is currently accepted by `gate-eval.sh` without comment.

### 7.4 Tier 3 in detail — advisory only, and why

Tier 3 is the §V grounding layer proper: for each substantive claim the run makes ("the
retry path is now idempotent", "criterion 3 is satisfied"), search the graph for a
supporting path and return `required_evidence` when none exists.

**It must not block.** Justification, from §4:

- Best measured KG-grounded claim verification: **P 0.944 / R 0.734** (KG-only) or
  **P 0.932 / R 0.931** (full hybrid, with web fallback firing on 23% of cases).
- Best measured traceable statement validation: **P 87.7% / R 44.4%**, authors' own
  verdict: *"requires human oversight."*
- Three-way accuracy including "not enough information": **0.702**, versus 0.931 binary.
- Human inter-annotator agreement on evidence sufficiency: **Fleiss' κ 0.385**.

**INFERRED:** at 40 merges/week and 93% precision, a blocking Tier 3 false-blocks ~3
correct merges per week. The cost is not the three respawns; it is that the operator learns
to route around the gate. §9 documents that this is the actual mechanism by which
constraint enforcement dies in production systems.

Tier 3's output goes into the PR body and into `gate-decision.json` as
`warnings[]` — visible, addressed, non-terminal. **INFERRED, and recommended as a measured
programme:** log Tier 3's verdicts alongside the eventual human/merge outcome for ~100
runs. If measured precision on *our* data clears some threshold we set in advance, promote
specific Tier-3 checks to Tier 2. Do not promote on vibes; the whole point of this lane is
that the promotion criterion should be a number.

### 7.5 What stays model-judged — and what CANNOT be made symbolic

Mapping the residual taxonomy (§5.2) onto Foreman's six audit dimensions:

| Foreman audit dimension | Becomes symbolic? | Where it lands |
|---|---|---|
| 1. **Acceptance** — diff matches objective and interfaces | **Partly.** Coverage (G3) and scope (G6) become deterministic. Whether the code *satisfies* the criterion does not | Tier 2 for coverage; Tier 4 for satisfaction |
| 2. **Regressions** | **No.** This is Category A/B — the right tool is tests and PBT, not review | Tier 1 (`checks-result.json`); strengthen with PBT |
| 3. **Tampering** — tests/CI/lockfiles/harness altered | **Already fully symbolic.** Checks 1+2 today | Tier 1. Remove from the auditor's remit entirely; it is wasted model attention |
| 4. **Security** | **Partly.** Pattern-matchable sinks → a linter/SAST call. Semantic security → model. Note the Tencent result: SAST gives recall, model gives precision | Tier 1 (SAST) + Tier 4 (triage) |
| 5. **Quality** — clarity, dead code, drive-by scope | **Scope: yes (G6). Clarity: no.** | Tier 2 for scope; Tier 4 for clarity |
| 6. **Prompt injection** — diff and repo text as untrusted | **No.** Detectors exist but are themselves models. Keep it as an auditor instruction | Tier 4 |
| **Docs & comments** | **Partly.** `docs-check.json` is already a deterministic linter (Tier 1). Whether a doc *misstates behaviour* is model judgment | Tier 1 + Tier 4 |

**Stated plainly, the things that CANNOT be made symbolic:**

1. **Whether a natural-language acceptance criterion is met by a diff.** This is the oracle
   problem (Barr et al. 2015: *"complete oracles are theoretically impossible for most
   real-world software"*). A symbolic check can verify that a criterion is *addressed*; it
   cannot verify that it is *satisfied*. The only way to close this gap is to make the
   criterion executable — which is exactly the specification-first argument, and it is a
   change to how specs are written, not a change to the gate.
2. **Whether evidence supports a claim.** §4. Best-in-class is 88–94% precision.
3. **Domain-convention correctness.** The ICD-10-CM result — **0/20 across four models from
   three families** — shows that neither symbolic (no rule was written) nor model (no
   training coverage) catches a convention that lives only in a document nobody encoded.
   Symbolic verification does not fix this; *writing the rule down* fixes it, and then it
   becomes symbolic.
4. **Category D architectural residual.** *"the unarticulated architectural intent that has
   not yet been expressed as an enforceable rule."* Definitionally not symbolic — the
   moment you can express it, it stops being residual. This is the legitimate, permanent
   home of the cross-vendor audit lane.
5. **Category C runtime properties.** Races, partial failure, load behaviour. Out of gate
   scope; do not let the gate imply coverage it does not have.
6. **Category E specification defects.** Human loop, permanently.

### 7.6 A caution worth writing into doctrine

**INFERRED, but I consider it the most important sentence in this report:**

> A green symbolic validation means *the claims about the work are well-formed, sourced,
> and internally consistent*. It does not mean the work is correct. The graph gate is a
> **provenance and citation gate**, not a correctness gate. Correctness remains the job of
> `checks-result.json`.

The failure mode this guards against is real and predictable: a run that produces
beautifully-provenanced, fully-cited, shape-valid claims about a diff that does not work.
Every measured result in §4 and §5 says the symbolic layer will happily pass that diff. If
the gate's UI or the PR body implies otherwise, operators will trust it, and the first time
it is wrong will be expensive.

### 7.7 Implementation sequencing (v0.2.9-shaped, smallest useful first)

**INFERRED.** Ordered by value-per-unit-of-risk:

1. **G9 (verdict/finding consistency)** — pure `jq` over `audit-verdict.json`. No graph, no
   new dependency, ~15 lines added to `gate-eval.sh`. Catches a real class of incoherent
   audit output today.
2. **G1/G2 (finding groundedness)** — needs `git diff --name-only` and hunk ranges, both
   already available at gate time. Still no graph store required; a JSON side-file is
   enough. This is the hallucinated-finding detector and it is cheap.
3. **G4 (cross-vendor)** and **G5 (rubric identification)** — requires `audit-verdict.json`
   to carry `evaluator_vendor`, `worker_vendor`, `rubric`, `rubric_version`. A schema
   extension to the verdict contract, then a trivial comparison. Converts two prose
   invariants into enforced ones.
4. **G6 (scope containment)** — requires the five-part spec to declare files in scope in a
   machine-readable form. That is a spec-format change; worth doing, but it is the first
   step here that touches something outside the gate.
5. **G3 (criterion coverage)** — requires criteria to be individually addressable
   (identifiers, not prose bullets). Same class of change as (4).
6. **G7/G8 (provenance invariants over a real graph)** — only now does a graph store earn
   its place. Everything above is deliverable without TerminusDB.
7. **Tier 3 advisory grounding** — last, measured, non-blocking, with the promotion
   criterion defined before it ships.

**INFERRED, worth saying explicitly:** items 1–5 deliver most of the value of this lane and
require **no knowledge graph at all**. They are the same *kind* of check — closed-world,
addressed, deterministic — expressed over JSON instead of RDF. If the graph plane slips,
the gate improvements should not slip with it.

---

## 8. Cost and failure modes

### 8.1 Measured SHACL cost at and above our scale

**VERIFIED — ERA-SHACL-Benchmark (Martínez-Sarmiento, Ruckhaus, Toledo, Doña, Corcho;
Semantic Web Journal, 2025).** Real data and real shapes from the European Union Agency for
Railways RINF register. Hardware: 124 GB RAM, 120 GB SSD. Timeout: two days (172,800 s).
Memory ceiling: ~120 GB.

Datasets and shape sets:

| Dataset | Triples | Size | Shape sets |
|---|---|---|---|
| ES | 1,243,635 (~1M) | 0.24 GB | tds (27 core + 2 SPARQL), core (215 + 0), era (215 + 60) |
| FR | 11,339,591 (~10M) | 2.68 GB | same |
| ERA | 55,785,091 (~55M) | 12.69 GB | same |

**Cumulative (load + validate) time in seconds — this is the table that matters for us:**

| Dataset | Engine | tds | core (215 shapes) | era (215 + 60 SPARQL) |
|---|---|---|---|---|
| **ES (~1.24M triples)** | maplib | 6.10 | 9.73 | 12.08 |
| | **jena** | **10.15** | **10.60** | **23.99** |
| | topbraid | 12.03 | 20.63 | 34.32 |
| | rdf4j | 25.92 | 24.35 | 29.23 |
| | rdfunit | 33.00 | 209.10 | 211.34 |
| | dotNetRDF | 64.56 | 226.71 | **27,151.20** |
| | pySHACL | 358.80 | 579.93 | **133,253.22** |
| | Corese | 1,970.77 | 148.68 | 9,769.31 |
| **FR (~11.3M triples)** | maplib | 63.63 | 86.77 | 156.55 |
| | jena | 81.77 | 88.82 | 144.01 |
| | topbraid | 95.91 | 157.56 | 218.24 |
| | pySHACL | 3,592.19 | 3,399.00 | TO |
| | Corese | **138,510.08** | 1,308.63 | TO |
| **ERA (~55.8M triples)** | maplib | 321.34 | 473.35 | 1,061.66 |
| | jena | 354.52 | 388.24 | 827.58 |
| | topbraid | 418.57 | 920.48 | 1,506.87 |
| | pySHACL | ML | ML | ML |
| | Corese | TO | TO | TO |

(`TO` = did not finish within 172,800 s. `ML` = exceeded the ~120 GB memory limit during
loading. `MV` = exceeded it during validation.)

Memory, GB, ES dataset: maplib 0.83–1.06, jena 1.58–2.64, topbraid 1.70–3.00, pySHACL 3.29,
rdf4j 6.59–6.68, Corese 2.58–9.54.

**Read for Foreman (INFERRED from the verified table):**

- At **10^6 triples with SHACL-Core-only shapes, Apache Jena costs ~10.6 s cumulative, of
  which only 2.10 s is validation** (the rest is loading, which a persistent store amortises
  away). **That is entirely affordable as a per-merge blocking check.**
- The cost cliff is **not** the graph size. It is **SPARQL-based constraints**. On the same
  1.24M-triple dataset, adding 60 SPARQL shapes took Jena 2.10 s → 15.63 s (7×), TopBraid
  11.40 s → 25.49 s, dotNetRDF 189 s → **27,114 s (7.5 h)**, pySHACL 481 s → **133,153 s
  (37 h)**. **Design consequence: SHACL Core in the blocking path; SPARQL shapes async.**
- **Engine choice is worth more than any optimisation we could write.** Same dataset, same
  shapes: *"the Jena library surpassed both engines, using for the validation task only
  around two thirds of the time used by Topbraid, and one-8500th of the time used by
  PySHACL."* pySHACL — the obvious default for a Python codebase — is the worst realistic
  choice by three to four orders of magnitude.
- Authors' own summary of the state of the art: *"engines require more than five minutes to
  load and validate a 55 million triples dataset using only a small collection of shapes
  that have only two SPARQL constraints. The total amount of time required is not
  neglectable, especially for use cases in which systems require low latency in their data
  validation tasks."*

**VERIFIED — SHACL-DS on ERA RINF (arXiv:2605.10540, May 2026).** 33.6M triples across 56
named graphs, TopBraid-based implementation: dataset load 91 s (excluded from timings),
validation **566 s (Target Strategy) / 568 s (Combination) vs 591 s (SHACL baseline)**;
peak JVM heap ~32 GB; 1.2M–2.8M reported violations depending on configuration. Also
notable for us: SHACL-DS *"enforces triple provenance through GRAPH clauses, enriches
validation reports with per-graph annotations"* — i.e. named-graph-scoped shapes are a
first-class way to express "this constraint applies only to what lane L wrote", which is
exactly the write-scoping a multi-agent orchestrator needs.

### 8.2 Incremental vs full validation

**VERIFIED — Magic Shapes for SHACL Validation (Ahmetaj et al., PVLDB 15, 2022).**
Magic-set style rewriting restricts validation to the fragment of the graph relevant to a
given target, rather than evaluating shapes over the whole graph.

**INFERRED, applied:** for Foreman, "validate only what this run wrote, plus its 1-hop
neighbourhood" is the natural unit. Because each lane writes a bounded subgraph
(`AgentRun`, its `Artifact`s, `Claim`s, `Finding`s, `Evaluation`), the targeted set is
small and roughly constant regardless of total graph size. This makes Tier 0 (write-time)
validation **O(update)**, not **O(graph)** — which is the only way the write-time check
stays viable as the graph grows.

Full-graph revalidation should still be run, but on a schedule (nightly), not on the merge
path.

### 8.3 Reasoner cost

**VERIFIED — GLaMoR (arXiv:2504.19023).** HermiT consistency-checking the BioPortal module
test set: **122 h 24 m 32 s**. The ML surrogates: 6–11 h training, seconds of inference,
94–95% accuracy.

**VERIFIED — W3C OWL 2 Profiles Table 10.** OWL 2 RL and EL consistency: PTIME-complete.
OWL 2 QL: NLogSpace-complete taxonomic, AC0 data. Full OWL 2 Direct Semantics:
N2EXPTIME-complete combined.

**INFERRED:** there is no scenario in which Foreman should run a full DL reasoner in a
merge gate. Everything we need (disjointness, functional properties, cardinality) is in
OWL 2 RL, and all of it can be expressed more cheaply and far more actionably as SHACL
constraints.

### 8.4 Brittleness: engines disagree on real data

This is the failure mode I did not expect to find, and it is the strongest argument for
keeping the shape set small.

**VERIFIED — ERA-SHACL-Benchmark, §5.1.** Engines that **pass the official W3C SHACL Test
Suite on synthetic data** fail on real data:

> *"dotNetRDF failed in disjoint and SPARQL select constraints property checking (while
> with the W3C synthetic dataset it Passed), RDFUnit failed in constraint components and
> SPARQL constraint checking (while the results were No data and Passed…), Corese failed
> all SPARQL related constraints (while No data is reported in the test suite). Indeed,
> during this process, multiple bugs were found, reported, and processed by the engine's
> maintainers."*

And on completeness:

> *"despite pySHACL, Maplib, and dotNetRDF passing the test suite for Patterns, there are
> mismatching results in the completeness evaluation results, i.e. these engines reported
> less violations compared to the rest of the engines."*

And the prior-work figure they cite:

> *"They found that validating a larger-scale dataset affected the correctness of the
> validation results of one of the engines that was evaluated, where **41.1% of valid
> results were classified as invalid**."*

**INFERRED, and this is a hard constraint on the design:** a "deterministic" gate that
depends on a specific SHACL engine's implementation of a specific constraint component is
only as deterministic as that implementation. **Mitigations:** (a) restrict the blocking
shape set to the most heavily-exercised SHACL Core components — `sh:minCount`,
`sh:maxCount`, `sh:datatype`, `sh:class`, `sh:in`, `sh:pattern`, `sh:nodeKind`; (b) pin the
engine and its version; (c) keep a golden corpus of known-violating and known-conforming
run subgraphs and assert the expected report on every engine upgrade — the same
`hashes.txt` discipline the gate already applies to tests.

### 8.5 The "we turned it off" evidence

The brittleness sub-lane found the off-switches. All quotes **VERIFIED** by that sub-lane
reading the source.

**The one deployed system that flipped it off.** Eclipse XFSC / Gaia-X Federated Catalogue,
PR #73, 2026-03-02:

> *"**The default value of `federated-catalogue.verification.schema` has been changed from
> `true` to `false`.** This means SHACL schema validation is now disabled by default during
> Self-Description/Asset upload. Previously, all uploaded assets were validated against
> stored SHACL shape graphs, and non-conforming assets were rejected. **With this change,
> assets are accepted regardless of SHACL conformance in the default configuration.**"*

with *"enabling on-demand SHACL validation independent of the upload flow."* **Honest
caveat, and the sub-lane flagged it:** the PR cites a requirement (CAT-FR-SF-04), not a
performance postmortem. The *disabling* is verified; the *motive* is not. This is exactly
the §7 tiering move — validation leaves the write path and becomes on-demand — but we
cannot claim it was forced by cost.

**The engine maintainers document the off-switch as normal practice.** Håvard Ottestad,
author of RDF4J's ShaclSail, ERA-SHACL-Benchmark issue #3, 2025-06-16:

> *"The SHACL Sail builds on the transactional properties of RDF4J, **which have a
> significant overhead. The transactional isolation needs to be disabled when a transaction
> is started.** … **During the data loading phase the validation should also be
> disabled.**"*

RDF4J's own documentation ships `ValidationApproach.Disabled`, warns that *"Very large
transactions could exceed the amount of memory available and **cause the JVM to crash**"*,
and auto-downgrades to bulk validation past a **500,000**-statement default.

**A vendor that removed the feature outright.** TerminusDB `RELEASE_NOTES.md`, v10.0.0,
under Backwards-Incompatible Changes:

> *"**TerminusDB no longer supports OWL schema validation.**"*

**A maintainer recommending "turn it off" as the supported workaround.** Gavin
Mendel-Gleason (TerminusDB CTO), discussion #1039, 2022-03-21, on schema strengthening:

> *"**The work around we employ at the minute is to temporarily turn-off schema checking**,
> update the schema to an inconsistent schema, update the documents according to this new
> schema state and turn the schema checking back on."*

**A vendor that silently downgrades rather than failing.** Stardog's
`reasoning.schema.timeout` (default `1m`):

> *"**If schema reasoning cannot be completed in the specified time then only RDFS reasoning
> will be performed for the schema which might yield incomplete answers**"*

and *"Support for DL reasoning type has been **removed in version 9.0** and cannot be used
anymore."* **INFERRED:** a *silent* downgrade under time pressure is the worst possible
behaviour for a gate — it is the fail-open of §6.6 with a timer attached.

**GraphDB 11.4, in its own SHACL documentation:**

> *"**Run parallel validation: Runs validation in parallel. May cause deadlock, especially
> when using NativeStore.** Default value is `true`."*
> *"Log every execution step of the SHACL validation … **This is fairly costly and should
> not be used in production.**"*
> *"SHACL support in a given repository must be enabled when that repository is created.
> **You cannot modify an already existing repository by enabling the validation
> afterwards.**"*
> *"If using `sh:targetClass` instead of a SPARQL target, GraphDB would execute a SPARQL
> request for each instance of the class, **impacting performance severely on a dataset of
> realistic sizes.**"*

**The unmaintainability story, from a real large-shape deployment.** Vladimir Alexiev, on
the CIM/CGMES SHACL shapes:

> *"**The shapes are brittle in face of change: if a subclass is added, all inherited props
> need to be attached to that class**"*
> *"a lot of them came from **the need to make shapes work on at least one validation
> engine**: **Complex constructs were used instead of simpler or more standard constructs,
> because the particular engine had performance issues.**"*
> *"Then **for each target node** a separate query is run … **hundreds or thousands of
> SPARQL queries may be run for a single shape.** If those nodes have `sh:node` constraints
> … **potentially leading to millions of queries.**"*
> *"**Making the change and revalidating the complete model will be very inefficient and
> cannot be made on every update (transaction).**"*

and, decisively for our incremental-validation hopes:

> *"**SHACL SPARQL doesn't work well for incremental validation, since it's hard to
> 'understand' SPARQL and figure out what triples may be involved.** … **We are not aware of
> any implementation of incremental validation over SPARQL.**"*

**And the W3C Working Group knows.** Alexiev, `w3c/data-shapes#321` ("consider computational
complexity"): *"**SPARQL opens up a 'door' towards 'unknown' complexity** … If you need to
run say 1M queries coming from `SPARQLConstraint` … **that will ruin all efficiency**"* and
*"**`sh:node` adds in unpredictable ways because it can veer off (cascade) into more and
more node checks.**"* WG status as of 2026-03-05: *"Our current feeling is that this is a
**post-1.2 topic**"* — **SHACL 1.2 ships with no complexity analysis.**

**INFERRED — the mechanism by which a validation gate dies**, now corroborated rather than
speculative:

1. Shapes are written to be thorough rather than minimal.
2. Thorough shapes need SPARQL. SPARQL shapes hit the cost cliff (§8.1) **and cannot be
   validated incrementally at all**.
3. Slow validation gets moved off the write path "temporarily" — and every major engine
   ships a documented switch for exactly this.
4. Off the write path, invalid data accumulates.
5. Re-enabling fails on the backlog, so it stays off. In GraphDB's case you cannot even
   re-enable it on an existing repository.

The counter-design is §7: a **small, Core-only, closed-world, lane-local** blocking shape
set that cannot get slow, plus a separate advisory tier where thoroughness is safe because
it is non-terminal.

### 8.6 Silent no-op is the dominant failure mode — corroborated five times

My executed §6.6 Finding B was not a fluke. The sub-lane found **four independent
confirmations of the same failure class**, from vendors, tool authors, and the W3C WG.
This is the most important brittleness finding in the report, and it has nothing to do
with performance.

**AllegroGraph documents the trap in its own manual** — a one-character case difference
between the shapes graph IRI and the CLI argument:

> *"`Validation report: Conforms … Number of NodeShapes: 0 … Number of focus nodes checked:
> 0`"*
> *"This call was made on the original example with several violations … but here it says
> the data conforms. Sharp-eyed readers will see the problem: **the SHACL shapes graph is
> `http://franz.com#Shapes` but is specified in the command line as `http://franz.com#shapes`**
> … so the system found no triples with that graph and so had no validation triples to test
> and **concluded the data conformed.**"*

**Thomas Francart (SHACL Play author), `w3c/data-shapes#325`, 2025-03-17:**

> *"**This can lead to (very) misleading situations where the validation report is empty,
> not because the data is valid, but because no targets were matched** (e.g. a wrong
> identifier used in a `sh:targetClass`)"*

**Thomas Bergwinkl (Zazuko), 2023-03-03:**

> *"**a failing SHACL target generates a report where everything is fine.**"*

**And the one that broke a peer-reviewed benchmark.** Håvard Ottestad, ERA-SHACL-Benchmark
issue #4, 2025-06-17 — RDF4J's *default* result truncation silently corrupted the published
numbers:

> *"**The number of validation results is very low in the paper since RDF4J defaults to
> truncating the results if they are very large.** … Adding this produces **1,096,771
> validation results. Which is identical to Jena.**"*

**Plus my own, executed (§6.6):** pySHACL 0.40.1, `Conforms: True`, exit 0, on data that
violates every provenance invariant, because SPARQL targets are not evaluated outside
advanced mode.

**INFERRED, and this should be the single most-repeated sentence from this lane:**

> **A validator that fails open is worse than no validator, because the agents trust its
> verdict.** Foreman's existing posture already understands this — `gate-eval.sh` fails
> closed when `docs-check.json` is *missing*. The same discipline must extend to "the
> validator ran but checked nothing", which is a state no exit code distinguishes from
> success. The §6.6 canary — a known-violating fixture that must produce a known result
> count — is the only mechanism that detects it.

Note the pattern across all five: **none of them is a bug.** Each is documented, intended
behaviour of a mature tool. The failure is in the contract, not the implementation, which
is why it recurs across every engine.

### 8.7 Two more findings that bite a multi-agent orchestrator specifically

**1. SHACL-SPARQL is the trapdoor, and it forecloses incremental validation.** Covered in
§8.5; restated here because it is a design boundary, not a performance note. Everything
expressive enough to encode a cross-node business rule (`sh:sparql`, cascading `sh:node`)
is (a) evaluated per target node — 10^5–10^7 query executions on a real graph, (b) **opaque
to incremental analysis**, with *no known implementation* doing incremental validation over
SPARQL constraints, and (c) unevenly supported across engines. Andy Seaborne (Jena PMC) on
where validation can live relative to a transaction:

> *"the validation is only on the triple added (e.g. `sh:datatype`) — and does not need
> access to the database so **it can be done in parallel outside the transaction** … the
> validation needs local changes (e.g. `minCount`) … **global — needs access to the whole
> database. Not much can be done except execute inline at the end of the transaction.**"*
> *"**Some need all the data (SPARQL ones — they are opaque to analysis so the general way
> is they need all the data).**"*

**INFERRED:** Seaborne's taxonomy is the design spec for our tiering. §6.1–6.3 are all in
his first two categories (triple-local and entity-local) and can therefore run **outside
the transaction, in parallel, per lane** — which is exactly what §7.2b needs.

**2. Nobody is complaining, and that is not reassurance.** The sub-lane's Stack Overflow
sweep — `shacl slow`, `shacl performance`, `pyshacl slow`, `shacl timeout`,
`shacl out of memory`, plus the top 60 questions by score on the `shacl` tag — returned
**zero** questions about slow validation, OOM, or timeouts. There are also no open
performance issues on TopQuadrant/shacl, rdf-ext/shacl-engine, w3c/shacl, or apache/jena.
**INFERRED:** this is a signal about ecosystem size, not about maturity. The user base is
small and vendor/academic-mediated, which means **we will not find our problems by
searching for them — we will find them by running the canary.**

### 8.8 What the sub-lane could not obtain

Recorded so nobody assumes the search was exhaustive:

- **Ontotext's "SHACL-ing the Data Quality Dragon" I/II/III — UNREAD.** ~9 attempts
  (scrapling get/fetch/impersonate, curl with UA, WebFetch, r.jina.ai, Wayback ×5 → HTTP
  429). Part II contains a section titled *"SHACL-SPARQL performance"*, cited as a reference
  by the Graphwise post we did read. **This is the single biggest known gap in §8.**
- **GraphDB 11.x `reasoning.html` / `rules-optimisations.html`** — the host rate-limits to a
  Sucuri captcha after ~10 fetches. All GraphDB *reasoning* numbers in §8 are from the
  **10.2.5** docs; the *SHACL* quotes are 11.4.
- Oracle RDF inferencing docs (JS stubs), two CEUR-WS PDFs, and the ACM K-CAP 2025
  lessons-learned paper (paywall) — the latter still quoted at abstract level only in §8.5.
- **No published TerminusDB schema-check throughput number exists.** The only public figure
  is a relative delta with no baseline (*"Most large inserts with schema will be 40%
  faster"*). If we adopt TerminusDB, **we must measure this ourselves**; there is nothing
  to cite.
- No case study on choosing nightly-batch over on-write SHACL. Searched explicitly; nothing.

---

## 9. Open questions

1. **What is Tier 3's precision on *our* data?** Every number in §4 is from FEVER, BioRED,
   FactKG, Wikidata — open-domain natural-language claims. Foreman's claims are narrow,
   templated, and about a diff we control. Precision could be much higher. It could also be
   lower, because our graph is sparse and young and "no supporting path" will often mean
   "we have not ingested it yet" rather than "it is false". **This is measurable and should
   be measured before Tier 3 ships.** Proposed protocol: run Tier 3 in shadow mode for 100
   merges, record verdict vs eventual outcome, publish precision/recall/FP.
2. **Does G3 (criterion coverage) require changing the five-part spec format?** Criteria
   need stable identifiers to be individually addressable. That is a change to how the
   architect writes specs, which is a larger blast radius than a gate change. Is there a
   cheaper encoding — e.g. deriving criterion ids from a stable hash of the criterion text?
3. **Where does the graph actually live at gate time?** Tier 2's checks are cheap only if
   the run subgraph is already materialised. Does the gate build it from `events.jsonl` on
   demand (simple, no new dependency, recomputed every time), or does the lane write it as
   it goes (faster, but introduces a write path that can itself fail)? The `events.jsonl`
   route is more consistent with Foreman's existing degrade-and-continue posture.
4. **How do we prevent the shape set from growing?** Every brittleness story starts with a
   shape set that seemed reasonable. Proposal: a hard cap in `config.toml` on the number of
   blocking shapes, plus a required cost budget (ms) per shape measured on a golden corpus.
   Untested idea.
5. **Is a SHACL engine the right dependency at all, given §7.7?** Items 1–5 of the
   sequencing need no RDF. A JSON-Schema-plus-scripts implementation of the same checks
   would have zero new runtime dependencies and zero engine-disagreement risk. The counter
   is that shapes are declarative and composable in a way ad-hoc scripts are not, and that
   the graph plane needs a validator anyway. **This is a genuine fork in the road and
   should be decided explicitly, not by drift.** Note that §3.5 adds a *third* option —
   stratified Datalog with reified violation predicates, which is cheaper (P-complete vs
   NP-hard) and more expressive than recursive SHACL, and whose proof trees strictly
   dominate SHACL's pointers. The reason not to pick it today is dependency weight, not
   technical merit; that trade may change.
5b. **Do we need recursion at all?** This decides question 5. The candidate recursive
   constraints are "every claim traces to a Source within k hops" and "the work DAG has no
   cycles". Both may be expressible with a bounded property path (SHACL) rather than true
   recursion. If neither needs unbounded recursion, SHACL Core wins outright and the
   Datalog question closes.
5c. **Can we get a TerminusDB schema-check throughput number?** None exists publicly — the
   only figure is *"Most large inserts with schema will be 40% faster"*, a relative delta
   with no baseline (§8.8). If TerminusDB lands, this must be measured on our own workload
   before Tier 0 is designed around it. Cheap experiment; blocking for the write-path
   decision.
5d. **Does per-lane graph isolation (§7.2b) compose with TerminusDB's branch model?** The
   store's branching looks like the right primitive, but the merge semantics for concurrent
   lane branches — and whether schema validation re-runs on merge — are unverified.
6. **What is the interaction between Tier 2 and lane retry?** If a lane is respawned, its
   graph writes must be idempotent or the shape set will report spurious cardinality
   violations. §6.2 proposes `Lexical` keys over `(runId, laneId)`; that needs validating
   against TerminusDB's actual key semantics.
7. **Can the Category D residual be shrunk with architecture tooling?** The residual paper
   argues ArchUnit/Dependency-Cruiser/Pact-style rules move defects out of the AI-review
   residual and into determinism. Foreman is bash and TypeScript; what is the equivalent?
   Concretely: is there a dependency-direction rule over `skills/foreman/scripts/lib/*`
   that could be enforced, and would enforcing it catch anything real?
8. **Should the auditor be *shown* the Tier-2 results?** Argument for: it stops wasting
   attention on tampering and scope, which are now deterministic. Argument against: telling
   a model what has already been checked biases it toward not looking. This is testable and
   currently unmeasured.
9. **Unresolved from §6.1:** does TerminusDB have any conditional-constraint mechanism that
   would let invariant 1 be enforced natively without a `TaggedUnion` remodelling? The
   schema reference does not show one, but the reference is not exhaustive.

---

## 10. What N4 recommends, in one place

1. **Adopt the two-speed rule.** Closed-world checks block; open-world evidence checks warn.
   Write it into gate doctrine before writing any code.
2. **Ship G9, G1, G2 in v0.2.9.** Verdict/finding consistency and finding groundedness.
   No graph store, no new dependency, ~100 lines of `jq` and `git diff`. These catch
   hallucinated and incoherent audit output, which nothing catches today.
3. **Promote two prose invariants to enforced ones** (G4 cross-vendor, G5 rubric pinning)
   by extending the `audit-verdict.json` contract.
4. **Keep the blocking constraint set to SHACL Core constraint components; permit SPARQL
   only for target selection.** Pin the engine. Apache Jena if a JVM is acceptable;
   explicitly *not* pySHACL for anything large (8,500× slower than Jena on the ERA
   SPARQL shape set) — though pySHACL is perfectly adequate for a run-subgraph of a few
   hundred triples, as §6.6 demonstrates at 0.192 s.
5. **Express conditional obligations as targeted shapes, never as `sh:xone`/`sh:or`.**
   Executed evidence (§6.6): logical combinators report at their own level and swallow the
   inner `sh:message` strings, destroying `required_evidence` extraction.
6. **Ship a validator canary and fail closed on it.** Executed evidence (§6.6): the same
   shapes file, same violating data, silently reported `Conforms: True` when advanced mode
   was off. Assert a known-violating fixture produces the expected result count before
   trusting any run. A silently no-op gate is worse than no gate.
6b. **Keep every write-path invariant lane-local, and validate per-lane in isolation.**
   SHACL-on-write serialises writers by construction (§7.2b) — a global mutex is the worst
   thing to add to a parallel orchestrator. All of §6.1–6.3 are already lane-local; keep
   them that way, and put cross-lane invariants in the nightly pass only.
7. **Model Claim/Evaluation/Finding/Source as top-level documents, never subdocuments,** in
   whatever store lands — otherwise cascade-delete silently violates invariant 4. **And
   forbid `sys:JSON` / `sys:JSONDocument`** in the Foreman schema: TerminusDB documents it
   as *"a subdocument that is not schema checked"*, i.e. a total escape hatch around every
   invariant (§6.4b).
7b. **Expect to run two constraint languages, and decide that deliberately.** TerminusDB's
   schema layer has no regex, no value ranges, no uniqueness, no conditionals, and no
   cross-document constraints; it dropped OWL validation entirely in v10.0.0 (§6.4b). It
   gives structure and immutability; SHACL or scripts must give everything else. Note that
   TerminusDB's founders rejected SHACL on record partly to avoid exactly this two-language
   cost — the objection is real, and applies to the recursive fragment we are not using.
8. **Forbid symmetric-transitive relations in the ontology** (a note for N2). Measured
   evidence (§3.5.4): they turn incremental maintenance cost from 0.05 s into 95 minutes at
   comparable graph size.
9. **Never replace the reasoner with a learned surrogate inside a gate.** 95% accuracy is
   the same reliability band as the thing being disciplined.
10. **Say out loud, in the PR body, that the symbolic layer checks provenance and not
   correctness.** The most expensive failure available here is a gate that people trust
   for something it does not do.

**The shape of the whole answer, in one line:** *symbolic is never wrong and often silent;
the model is usually right and never silent.* Build the gate so that the first clause is
load-bearing and the second is advisory.

---

## 11. Handoffs to sibling lanes

Concrete, checkable asks that came out of this lane and belong to someone else.

**To N2 (ontology engineering).** These are modelling constraints derived from measured
validator behaviour, not aesthetics:

1. **No symmetric-transitive relations.** §3.5.4: they make incremental maintenance cost
   vary by three orders of magnitude at comparable graph size (0.05 s vs 95 min).
2. **`Claim`, `Evaluation`, `Finding`, `Source` must be top-level document classes, never
   subdocuments.** §6.4: TerminusDB cascade-deletes subdocuments when the last reference
   goes, which silently violates invariant 4.
2b. **Ban `sys:JSON` / `sys:JSONDocument` and `Foreign` from the Foreman schema.** §6.4b:
   the former is documented as *"a subdocument that is not schema checked"*; the latter has
   *"no referential integrity checking"*. Either one makes every invariant optional at the
   point of use.
2c. **Every write-path invariant must be lane-local** (single node + ≤1 hop over nodes one
   lane wrote). §7.2b: cross-lane invariants force writer serialisation, which is fatal for
   a parallel orchestrator. This is an ontology constraint as much as a gate constraint.
3. **Every class that participates in a provenance invariant needs a stable, reproducible
   key** — `Lexical` over natural fields, not `Random` — so that lane retry produces
   idempotent writes and revalidation stays cheap (§6.2).
4. **Decide whether any constraint genuinely needs unbounded recursion** (§9 item 5b). That
   single answer decides SHACL-vs-Datalog for the whole programme.
5. **Model epistemic status as a property with SPARQL-targeted shapes, or as a
   `TaggedUnion`** — but know that the `TaggedUnion` choice makes a claim's class change
   when its status changes, which interacts badly with invariant 4 (§6.1).

**To N3 (serialization / retrieval).** The SHACL `ValidationResult` → `required_evidence`
transform in §6.5/§6.6 is a *serialization* concern as much as a validation one; the
`sh:message` strings are the payload and should be authored as the required-evidence
sentences directly. Also: whatever subgraph serializer N3 lands should be able to emit the
run subgraph in a form a validator can consume without a round-trip, since §7.3's Tier 2
runs on exactly that subgraph.

**To N1 (landscape).** Two negative results worth carrying into the landscape picture:
there is **no published work** applying Datalog or ASP to validate a multi-agent
orchestrator's knowledge graph, and **no direct Datalog-vs-SHACL expressiveness comparison
paper**. The design space here is genuinely open; we are not behind.
