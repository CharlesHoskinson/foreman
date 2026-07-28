# N2 — Ontology Engineering for an LLM-Populated, LLM-Consumed Graph

**Lane:** N2 of the Foreman v0.2.9 neurosymbolic research sprint
**Scope:** how to actually *design* an ontology that an LLM population pipeline can fill and an LLM
consumer can reason over — methodology, LLM-assisted construction, formalism choice, size,
upper-ontology reuse, SE-domain prior art, anti-patterns, competency questions, draft ontology.
**Out of scope (sibling lanes):** N1 neurosymbolic landscape, N3 graph serialization/retrieval for
LLM consumption, N4 symbolic verification of LLM output.
**Date compiled:** 2026-07-28
**Evidence convention:** every claim tagged `VERIFIED` (I fetched the page into
`/tmp/neurosym-docs/N2/` and read the number/quote directly) or `INFERRED` (my synthesis across
verified inputs). Numbers without a tag are quoted from the immediately cited source.

---

## 0. Bottom line up front

Three findings drive everything below.

1. **[INFERRED, from §3 evidence] Do not let an LLM author or write the work-DAG plane at all.**
   Measured LLM competence collapses as you move up the "ontology learning layer cake": term
   typing F1 0.94–0.99 on familiar vocabularies, taxonomy discovery 0.02–0.66, non-taxonomic
   relation extraction 0.03–0.08, axiom identification 0.03–0.36. Foreman's work-DAG (rounds,
   attempts, verdicts, agent runs, commits) is *already* fully determined by the v0.2.0 append-only
   event log. Materialise it deterministically as a projection of that log. Reserve the LLM for the
   knowledge plane (Entity/Claim/Source), where extraction error is recoverable and auditable.

2. **[INFERRED] Formalism: a closed-world, document/property-graph schema (TerminusDB's schema
   language) with SHACL-style validation semantics. Not OWL-DL.** The decisive argument is not
   expressiveness or tooling — it is that roughly a third of the competency questions in §9 are
   *negation and aggregation* questions ("which specs have **no** passing evaluation?", "which
   artifacts were produced by an **unverified** agent run?"). OWL's open-world assumption cannot
   answer those; absence of a triple is not negation. SHACL and TerminusDB both close the world.
   Keep an OWL 2 RL/QL-shaped *subset* discipline for the axioms you do write, but do not adopt
   OWL-DL semantics.

3. **[VERIFIED] Name classes with well-known English words, not coined jargon.** LLMs do not reason
   over ontologies; they pattern-match lexical priors. Bakker et al. 2025 measured axiom-ID F1 of
   0.221 on FOAF (general, ubiquitous in training data) versus 0.055 on ERA (specialist rail
   ontology with concepts like `Siding`, `PhaseInfo`) — a 4× spread driven purely by domain
   familiarity. Chatel/Bosch et al. 2024 confirmed the mechanism causally with a gibberish-corpus
   ablation. "Attempt", "Round", "Commit", "Verdict", "Artifact" are good names. Anything Foreman
   invented is a tax.

---

## 1. Sources fetched

All fetched via `scrapling extract get … --ai-targeted` in WSL on **2026-07-28**. Raw pages under
`/tmp/neurosym-docs/N2/`, listing at `/tmp/neurosym-docs/N2/MANIFEST.txt`. Discovery used the arXiv
Atom API (`https://export.arxiv.org/api/query`) — note it 301-redirects from `http`, so `-L` and
`https` are required.

### 1.1 LLM-assisted ontology learning / population

| URL | Status | Date | Paper |
|---|---|---|---|
| https://arxiv.org/abs/2307.16648 + ar5iv full text | VERIFIED (93 KB) | 2023-07-31 | Babaei Giglou et al., *LLMs4OL: Large Language Models for Ontology Learning* |
| https://arxiv.org/html/2409.10146v1 | VERIFIED (54 KB) | 2024-09-16 | *LLMs4OL 2024 Overview: 1st LLMs4OL Challenge* (ISWC) — full leaderboards |
| https://arxiv.org/abs/2503.10143 | VERIFIED (abs) | 2025-03-13 | LLMs4OL 2025 task description |
| https://arxiv.org/html/2512.05594v1 | VERIFIED (96 KB) | 2025-12-05 | Bakker et al., *Ontology Learning with LLMs: A Benchmark Study on Axiom Identification* (OntoAxiom) |
| https://ar5iv.labs.arxiv.org/html/2410.23584 | VERIFIED (113 KB) | 2024-10-30 | Lo et al., *End-to-End Ontology Learning with LLMs* (OLLM) |
| https://arxiv.org/html/2407.19998v1 | VERIFIED (71 KB) | 2024-07-29 | *Do LLMs Really Adapt to Domains? An Ontology Learning Perspective* (gibberish ablation) |
| https://arxiv.org/html/2503.05388v1 | VERIFIED (74 KB) | 2025-03-07 | Lippolis et al., *Ontology Generation using LLMs* (Ontogenia / Memoryless CQbyCQ) |
| https://arxiv.org/html/2607.17963v1 | VERIFIED (81 KB) | 2026-07 | *OntoExtend: Requirement-driven and Scalable Ontology Extension with LLMs* |
| https://arxiv.org/html/2511.05991v1 | VERIFIED (48 KB) | 2025-11 | *Ontology Learning and KG Construction: Comparison of Approaches and Impact on RAG* |
| https://arxiv.org/html/2510.20345v1 | VERIFIED (62 KB) | 2025-10-23 | *LLM-empowered Knowledge Graph Construction: A Survey* |
| https://arxiv.org/abs/2404.14837 + ar5iv | VERIFIED (49 KB) | 2024-04 | Ontology-learning-with-LLM survey |
| https://arxiv.org/html/2412.20942v1 | VERIFIED (69 KB) | 2024-12-30 | *Ontology-grounded Automatic KG Construction by LLM under Wikidata schema* |
| https://arxiv.org/html/2505.23628v3 | VERIFIED (148 KB) | 2025-05 | *AutoSchemaKG: Dynamic Schema Induction from Web-Scale Corpora* |
| https://arxiv.org/abs/2307.01128 | VERIFIED (abs) | 2023-07 | *Text2KGBench* (ontology-conformance benchmark) |
| https://arxiv.org/html/2404.10317v2 | VERIFIED (56 KB) | 2024-04-16 | *LLMs4OM: Matching Ontologies with LLMs* |
| https://ar5iv.labs.arxiv.org/html/2409.14038 | VERIFIED (17 KB) | 2024-09 | *OAEI-LLM: benchmark for LLM hallucination in ontology matching* |
| https://arxiv.org/abs/2412.17592 | VERIFIED (abs) | 2024-12 | Ontology matching with LLMs |
| https://arxiv.org/html/2404.17524v4 | **FAIL** (1.7 KB, no arXiv HTML) | 2024-04 | *On the Use of LLMs to Generate Capability Ontologies* — abstract only |
| https://arxiv.org/html/2604.20795v1 | **FAIL** (1.7 KB, no HTML build) | 2026-04 | *Automatic Ontology Construction Using LLMs as an External Layer of Memory…* |

### 1.2 Competency questions

| URL | Status | Date | Paper |
|---|---|---|---|
| https://arxiv.org/html/2412.13688v1 | VERIFIED (71 KB) | 2024-12-18 | Keet & Khan, *Discerning and Characterising Types of Competency Questions for Ontologies* |
| https://arxiv.org/html/2505.24554v3 | VERIFIED (52 KB) | 2025-05-30 | *Bench4KE: Benchmarking Automated Competency Question Generation* |
| https://arxiv.org/html/2604.16258v1 | VERIFIED (81 KB) | 2026-04 | *Characterising LLM-Generated Competency Questions: Cross-Domain Empirical Study* |
| https://arxiv.org/abs/2409.08820 | VERIFIED (abs) | 2024-09 | *A RAG Approach for Generating Competency Questions in Ontology Engineering* |
| https://arxiv.org/abs/2604.01344 | VERIFIED (via API listing) | 2026-04 | *IDEA2: Expert-in-the-loop CQ elicitation* |
| https://arxiv.org/abs/2507.02989 | VERIFIED (via API listing) | 2025-07 | *Comparative Study of CQ Elicitation Methods from Ontology Requirements* |

### 1.3 Methodology and formalism

| URL | Status | Date | Resource |
|---|---|---|---|
| https://lot.linkeddata.es/ | VERIFIED (17 KB) | live | Linked Open Terms (LOT) methodology |
| https://oa.upm.es/5480/1/INVE_MEM_2010_74078.pdf | VERIFIED (6.9 KB) | 2010 | NeOn methodology paper |
| https://arxiv.org/abs/1602.00453 | VERIFIED (abs) | 2016 | Peroni, *SAMOD: Simplified Agile Methodology for Ontology Development* |
| http://www.ontologydesignpatterns.org/wiki/Main_Page | VERIFIED (10 KB) | live | ODP portal |
| https://protege.stanford.edu/publications/ontology_development/ontology101.pdf | VERIFIED (725 KB) | 2001 | Noy & McGuinness, *Ontology Development 101* |
| https://www.w3.org/TR/shacl/ | VERIFIED (222 KB) | 2017 REC | SHACL Shapes Constraint Language |
| https://www.w3.org/TR/owl2-profiles/ | VERIFIED (102 KB) | 2012 REC | OWL 2 Profiles (EL/QL/RL) |
| https://terminusdb.org/docs/schema-reference-guide/ | VERIFIED (67 KB) | live | TerminusDB schema reference |
| https://terminusdb.com/docs/schema-reference-guide/ | **FAIL** (403 Forbidden, k8s anonymous-user block) | — | same doc on `.com` — use `.org` |

### 1.4 Provenance / SE-domain ontologies

| URL | Status | Date | Resource |
|---|---|---|---|
| https://www.w3.org/TR/prov-o/ | VERIFIED (265 KB) | 2013 REC | PROV-O: The PROV Ontology |
| http://www.se-on.org/ | VERIFIED (25 KB) | live | SEON — Software Evolution ONtologies (U. Zurich) |
| https://slsa.dev/spec/v1.0/provenance | VERIFIED (28 KB) | v1.0 | SLSA Provenance predicate |
| https://slsa.dev/spec/v1.0/levels | VERIFIED (10 KB) | v1.0 | SLSA build levels |
| https://in-toto.io/docs/specs/ | VERIFIED (3.3 KB, index only) | live | in-toto attestation specs |
| https://codemeta.github.io/terms/ | VERIFIED (13 KB) | live | CodeMeta crosswalk |
| https://spdx.github.io/spdx-spec/v2.3/ | PARTIAL (4 KB, nav only) | v2.3 | SPDX 2.3 — landing page has no body text |
| https://arxiv.org/html/2405.19877v1 | VERIFIED (22 KB) | 2024-05-30 | *KNOW: A Real-World Ontology for Knowledge Capture with LLMs* |

### 1.5 Anti-patterns

| URL | Status | Date | Resource |
|---|---|---|---|
| https://oops.linkeddata.es/catalogue.jsp | VERIFIED (20 KB) | live | OOPS! Pitfall catalogue — all 41 pitfalls P01–P41 with severity |
| https://oa.upm.es/id/eprint/54049/1/INVE_MEM_2018_291364.pdf | **FAIL** (404, wrong eprint ID) | — | Poveda-Villalón *Common Pitfalls in Ontology Development* — superseded by the OOPS! catalogue above, which is the same content |
| In-repo: `/root/foreman/skills/graphify/references/extraction-spec.md` | VERIFIED | live | Contains a *measured* in-house anti-pattern (see §8.3) |

---

## 2. Methodology worth adopting

### 2.1 What the classical methods actually offer

**[VERIFIED]** The field's methods split into heavyweight waterfall (METHONTOLOGY, 1997),
scenario-driven networked (NeOn, 2010), and agile/test-driven (SAMOD 2016, eXtreme Design,
LOT ~2019). LOT is the current practitioner default and is structured as four repeating phases:
**Requirements specification → Implementation → Publication → Maintenance**, where the
requirements phase produces "ontological requirements written in … competency questions or
statements" validated with domain experts before any modelling (`lot-methodology.md` L33–54).

**[INFERRED]** Almost nothing in METHONTOLOGY/NeOn survives contact with an LLM pipeline —
they assume weeks of expert elicitation and a stable domain. Three things do survive, and they are
exactly the things that constrain the machine:

- **Competency questions as the requirements artefact.** They are executable (each becomes a
  query), they scope the ontology, and they give you a pass/fail acceptance test. Lippolis et al.
  operationalised this as "proportion of modelled CQs" and it is the only ontology-quality metric in
  the literature that a non-ontologist can interpret.
- **Ontology Design Patterns (ODP) reuse.** Lippolis et al. found that supplying ODPs in the prompt
  produced "richer pattern-based ontology formalizations" — patterns are the unit of reuse an LLM
  can actually apply.
- **Minimal ontology modules.** Lippolis et al.'s benchmark defines, per CQ, a *minimal ontology
  module*: "if we remove all superfluous elements of O with respect to CQ_i". This is the right
  granularity discipline (see §5).

### 2.2 The concrete method I would follow for Foreman

1. **Write the competency questions first, by hand.** §9 is the draft. Do **not** generate them
   with an LLM: Bench4KE measured six LLM-based CQ generators against gold CQs from 17 real
   ontology projects and got cosine similarity **0.16–0.32** and BERTScore **0.57–0.60**
   (`bench4ke.md` L297–302) — weak agreement with what experts actually ask. **[VERIFIED]**
   Use an LLM only to *critique* and *diversify* a human-authored set.
2. **Classify each CQ** using Keet & Khan's five types — Scoping (SCQ), Validating (VCQ),
   Foundational (FCQ), Relationship (RCQ), Metaproperty (MpCQ) **[VERIFIED,
   `cq-types.md`]**. In practice Foreman needs mostly VCQ and RCQ; if a question is an SCQ it
   belongs in the roadmap, not the schema.
3. **Derive the minimal type set.** For each CQ, list the minimum node types, edge types and
   attributes needed to write the query. Union them. Anything not in the union is over-modelling —
   delete it. This is the single mechanical control against the anti-patterns in §8.
4. **Write the schema by hand in TerminusDB's schema language** (§4). One human author, reviewed.
   Never LLM-authored — §3.3 shows why.
5. **Freeze the schema, then let the LLM populate against it.** Ontology-grounded extraction beats
   unconstrained extraction (§3.2).
6. **Validate every CQ as an executable query** before shipping the schema. A CQ that cannot be
   expressed is a schema defect; a CQ that returns wrong answers on seeded data is a population
   defect. Keep them as a permanent regression suite, alongside Foreman's existing 245-test bats
   suite.
7. **Run a pitfall scan in CI.** OOPS!-equivalent checks (§8.1) as a gate, plus the structural
   invariants (acyclicity of `DEPENDS_ON`, functionality of `RESOLVED_TO`). N4 owns the checker
   design; this lane owns the constraint list.
8. **Version the schema as a first-class artefact.** TerminusDB is versioned; treat schema changes
   like migrations, with the CQ suite as the compatibility test.

---

## 3. LLM-assisted ontology construction: what works, what the numbers are, where it fails

### 3.1 The layer cake, quantified

The canonical framing (Buitelaar et al. 2005, reproduced in `axiom-identification.md`) stacks
ontology learning as terms → synonyms → concepts → taxonomy → relations → axioms, increasing in
difficulty. The 2024–2026 measurements confirm the stack cleanly. All **[VERIFIED]**:

| Layer | Benchmark | Best measured F1 | Source |
|---|---|---|---|
| Term typing, familiar vocabulary | LLMs4OL 2024 A.1 WordNet | **0.9938** (BERT + rules) | `llms4ol2024-overview2.md` |
| Term typing, biomedical | A.3 UMLS SNOMEDCT_US | **0.8829** (fine-tuned GPT-3.5) | ” |
| Term typing, geographic | A.2 GeoNames | **0.5906** | ” |
| Term typing, deep bio-ontology | A.4 Gene Ontology (3 branches) | **0.2691–0.2970** | ” |
| Taxonomy discovery | B.2 Schema.org | **0.6157** | ” |
| Taxonomy discovery | B.1 GeoNames | **0.6557** | ” |
| Taxonomy discovery | B.5 DBpedia Ontology | **0.2109** | ” |
| Taxonomy discovery | B.4 Gene Ontology | **0.0164** | ” |
| Taxonomy discovery (zero-shot) | B.6 FoodOn | **0.0308** | ” |
| Non-taxonomic relation extraction | C.1 UMLS | **0.0783** | ” |
| Non-taxonomic relation extraction | C.2/C.3 | only 2 teams entered at all | ” |

Axiom identification (OntoAxiom, 9 ontologies / 17,118 triples / 2,771 axioms, 12 LLMs × 3 shot
settings × 2 prompting strategies, `axiom-identification.md` Tables 5–9) — **mean F1 across all
configurations**:

| Axiom type | Precision | Recall | **F1** |
|---|---|---|---|
| `rdfs:subClassOf` | 0.399 | 0.326 | **0.359** |
| `rdfs:subPropertyOf` | 0.109 | 0.102 | **0.106** |
| `owl:disjointWith` | 0.114 | 0.082 | **0.095** |
| `rdfs:domain` | 0.034 | 0.043 | **0.038** |
| `rdfs:range` | 0.050 | 0.021 | **0.030** |

Best single model: **o1 at F1 0.197**; o4-mini 0.190; GPT-4.1 0.176; GPT-4o 0.156; best open model
Llama 3.3 at 0.121. Best single ontology/axiom cell in the whole study: **0.642** (subclass on
FOAF). Robustness across 3 runs was tight (F1 0.125/0.125/0.130), so these are stable numbers, not
sampling noise.

### 3.2 What works

- **[VERIFIED] Fix the schema first, then extract.** The Wikidata-grounded pipeline
  (`ontogrounded-wikidata.md` Table 1) scored partial-F1 **0.66/0.60** (Mistral) and **0.71/–**
  (GPT-4o) *with target-schema constraint* vs *without* on Wiki-NRE — constrained beat unconstrained
  everywhere. Their own conclusion: "our pipeline performs best on a large set of documents with a
  limited scope of knowledge, **requiring a concise schema**."
- **[VERIFIED] Decompose by competency question, and drop the accumulated context.** Lippolis et
  al.'s *Memoryless CQbyCQ* models one CQ at a time with no access to the ontology built so far,
  "which reduces the input context size of the LLM by ~60%", motivated by Saeedizade & Blomqvist's
  finding that "long context can result in distraction of the LLM." o1-preview + Memoryless CQbyCQ
  produced the *fewest* OOPS! critical pitfalls of any configuration tested.
- **[VERIFIED] Retrieve, don't dump.** LLMs4OM replaced O(n²) all-pairs prompting with
  retrieve-top-k-then-judge, cutting complexity to O(kn); retrieval recall was 82.09% @ k=5,
  84.66% @ k=10, 86.82% @ k=20 (best retriever `text-embedding-ada` at 90.88% @ k=5). Their stated
  reason for the redesign: "providing all ontologies at once to the model … results in mixed
  outputs, … increasing the risk of high hallucination, **especially with larger ontologies**."
- **[VERIFIED] Rules beat pure LLM at the top of the stack.** The winning WordNet system went from
  F1 0.9264 (GPT-4 alone) to **0.9938** by combining BERT with rule-based strategies — a 7-point gain
  from symbolic augmentation on an already-easy task.
- **[VERIFIED] Fine-tuning fixes structure, prompting does not.** OLLM's Motif Distance (a global
  structural-integrity metric, lower is better) was **0.314–0.354** for zero/one/three-shot
  prompting versus **0.050** finetuned and **0.080** for OLLM. Semantic metrics barely moved
  (Fuzzy F1 0.871→0.915). Read: **prompted LLMs produce locally plausible edges that assemble into
  a globally malformed graph.** This is the most Foreman-relevant single result in the corpus.

### 3.3 Where LLMs systematically fail

**[VERIFIED] 1. Axioms — categorically.** Domain (F1 0.038) and range (0.030) are at noise level;
disjointness at 0.095. The authors' explanation is that domain/range are context-sensitive —
their correct value depends on how the ontology is *used*, information that is not in the text.
**Implication for Foreman: never ask an LLM to decide an edge's domain, range, cardinality or
disjointness.** Those are exactly the constraints the schema must pin down by hand.

**[VERIFIED] 2. They match lexemes, not structure.** The gibberish ablation
(`llm-adapt-domains.md`) synthesised parallel WordNet corpora with real and nonsense terms:
"LLMs are unable to consistently retrieve the same taxonomic relationships between analogous
concepts, which highlights their clear reliance on priorly learned semantics, lexical senses, and
the frame of the tokens." Fine-tuning recovered the ability; prompting did not.
**Implication: any Foreman-invented identifier (round IDs, lane names, attempt hashes) is an
adversarial input to LLM extraction. Never make the LLM infer relations between opaque IDs.**

**[VERIFIED] 3. Performance tracks training-data familiarity, not ontology quality.** OntoAxiom
per-ontology F1: FOAF **0.221**, Pizza 0.172, gUFO 0.170, GoodRelations 0.119, Music 0.117, Time
0.101, NordStream 0.100, SAREF 0.065, ERA **0.055**. The authors attribute FOAF's lead to it being
"an often-used ontology" that LLMs saw in training. Note that gUFO — a *foundational* ontology,
formally the most rigorous in the set — sat mid-pack. Formal rigour buys nothing with an LLM.

**[VERIFIED] 4. Zero-shot generalisation to unseen ontologies degrades sharply.** LLMs4OL 2024:
"the zero-shot testing phase exposed limitations in the generalization capabilities of LLMs …
notable drops when transitioning from few-shot to zero-shot."

**[VERIFIED] 5. The specific OWL mistake LLMs make most.** Running OOPS! over LLM-generated
ontologies, Lippolis et al. found "the most common flaw is **having multiple domains or ranges**"
(OOPS! P19) — an LLM writes several `rdfs:domain` axioms on one property intending a disjunction,
but OWL reads them as a conjunction, "which could generate many unwanted inferences or even
inconsistencies." Also frequent: broken inverse relations, missing namespace declarations.

**[VERIFIED] 6. Prompt engineering does not rescue the hard tasks.** OntoAxiom found "only a modest
effect of prompting approach and shot settings" (F1 range 0.122–0.130 across six approach × shot
combinations), concluding "model performance is more constrained by task difficulty than by prompt
design."

**[INFERRED] 7. Consequence for Foreman.** The competent LLM operating range is: *assign an
instance to a class from a small, closed, well-named list*, and *extract a relation from an
explicitly-stated sentence*. That is precisely the knowledge-plane job (Claim/Source/Entity) and
precisely not the work-DAG job.

---

## 4. Formalism comparison and recommendation

### 4.1 The four candidates

| | **OWL 2 / RDFS** | **SHACL** | **Property-graph schema** (Neo4j/LPG) | **TerminusDB document schema** |
|---|---|---|---|---|
| World assumption | Open (OWA), no UNA | Closed for validation | Closed | Closed |
| Primary job | Entailment / inference | Validation of a data graph against shapes | Storage + typing | Validation + versioned storage |
| Expressiveness | Highest: subsumption, disjointness, cardinality, property chains, equivalence | Constraint language: cardinality, datatype, value-range, node-kind, SPARQL-backed custom constraints | Weakest: labels + property types + (in some engines) uniqueness/existence constraints | Classes, Enums, TaggedUnions (`@oneOf`), `Optional`/`Set`/`List`/`Array`/`Cardinality`, `@key`, `@inherits`, `@abstract`, `@subdocument`, `@unfoldable`, `Foreign` refs **[VERIFIED, terminusdb-schema2.md]** |
| Can express "has no X" | **No** (OWA — absence ≠ negation) | **Yes** (`sh:minCount`, `sh:not`) | Yes (query-level) | **Yes** (schema `Optional` + closed-world query) |
| Validation story | Reasoner returns *consistent/inconsistent*; unhelpful error localisation | Validation report with focus node, path, and message — designed for actionable feedback | Ad hoc / engine-specific | Schema enforced on write; commit rejected |
| Reasoning profiles | OWL 2 EL (PTIME, large class counts, basis of SNOMED CT), QL (LOGSPACE data complexity, query rewriting to SQL), RL (PTIME, rule-engine implementable) **[VERIFIED, owl2-profiles.md §1]** | none (not a reasoner) | none | none (WOQL has recursive path queries) |
| Tooling | Protégé, HermiT/ELK, OOPS!, OAEI ecosystem — richest by far | pySHACL, TopBraid, Apache Jena | Cypher/GQL ecosystem | TerminusDB CLI/WOQL, JSON-native |
| Token cost when shown to an LLM | High. Turtle/OWL-FS is verbose; class + property + domain + range + restriction axioms are ~4–8 lines each | High. Shapes are more verbose than the schema they constrain | Low. A label + property list is compact | Medium. JSON is verbose per character but the *concept count* is minimal (one object per class) |
| How well LLMs write it | Poorly, and in a specific way: P19 multiple-domain/range is the dominant critical pitfall; domain/range F1 0.03–0.04 **[VERIFIED]** | Untested at scale in this corpus; xpSHACL (2507.08432) uses LLMs to *explain* violations, not author shapes | Well (it is close to JSON/TypeScript, heavily represented in training data) **[INFERRED]** | Well — it is plain JSON with a small keyword vocabulary **[INFERRED]** |
| How well LLMs read it | Adequate but expensive | Adequate | Best | Good |

### 4.2 Recommendation

**Adopt TerminusDB's document schema language as the authoring and enforcement formalism, with
closed-world (SHACL-style) validation semantics. Do not adopt OWL-DL. Do not build a SHACL layer on
top.** **[INFERRED]**

Reasoning, in priority order:

1. **The competency questions demand closed-world semantics.** Count them in §9: CQ-3, 7, 9, 14, 15,
   16, 19, 20, 21, 24 are all "which X has *no* Y" or "which X is *not* covered by Y". Under OWA
   these are unanswerable in principle — a missing `EVALUATES` edge means "we don't know", not "no
   evaluation exists". This is not a tooling inconvenience; it is a semantic mismatch with the
   domain. Foreman's graph is a *record of a bounded, fully-observed process*, and the event log is
   complete by construction. Closed-world is the correct model of that world.
2. **We need validation, not entailment.** The value proposition of the graph plane is "reject
   malformed work-DAG writes, and flag knowledge-plane claims that lack provenance". That is
   `sh:minCount`-shaped work. We do not need to *derive* new classes; we need to *refuse* bad ones.
   TerminusDB gives schema enforcement on write, which is stronger than post-hoc validation —
   the bad data never lands.
3. **TerminusDB is already the candidate store**, and its schema language is expressive enough for
   everything §10 needs: `Enum` for verdict values, `TaggedUnion`/`@oneOf` for the
   Evaluation-target disjunction, `Cardinality`/`Optional`/`Set` for the arities, `@key` for
   deterministic IDs, `@inherits` for the Artifact hierarchy, `Foreign` for references to objects
   that live in git rather than the graph (commits, worktrees). Adding a second formalism (RDF+SHACL)
   would mean maintaining two schemas and a mapping.
4. **Token cost favours the compact form.** The whole §10 sketch is ~10 classes and ~11 edge types.
   As TerminusDB JSON that is roughly 1.5–2 KB; as OWL Turtle with domains, ranges, disjointness and
   cardinality restrictions it is 4–6× that, and every one of those extra axioms is a thing the LLM
   can get wrong at F1 0.03. **Fewer axioms shown to the LLM is strictly better** given §3.3.
5. **LLMs write JSON far better than Turtle.** This is the pipeline's most-executed code path.

**The tradeoff, stated honestly.** By choosing TerminusDB over OWL we give up:
(a) the reasoner ecosystem — no HermiT/ELK subsumption checking, no automatic classification;
(b) interoperability with the semantic-web tool chain — no OOPS!, no OAEI matchers, no
`owl:sameAs` federation with external KGs;
(c) formal entailment as a correctness argument — we can validate but not *prove* consistency.
I judge (a) and (c) cheap: Foreman's hierarchy is two levels deep and needs no classification, and
N4 is building a purpose-built checker anyway. (b) is the real cost — if Foreman ever wants to
publish its graph for external consumption or align with an external KG, an RDF export becomes
necessary. **Mitigation: keep the schema OWL 2 RL-*shaped*** — no property chains, no complex class
expressions, no nominals beyond enums — **so a mechanical RDF/OWL export stays possible later.**
That costs nothing now and preserves the option.

**One dissent worth recording.** If Foreman's graph were to become a multi-tenant, federated,
cross-organisation artefact, the calculus flips: OWL + SHACL is the interoperable answer and the
verbosity is worth it. For a single-repo orchestrator's internal memory, it is not.

---

## 5. Size and granularity: does a bigger ontology make the LLM worse?

**Yes — and the mechanism is type-count and context length, not depth per se.** Evidence:

- **[VERIFIED] Type count is the dominant driver.** LLMs4OL 2024's own conclusion: "even smaller
  models like Flan-T5-Small with 80M parameters can perform well **when there are fewer types**.
  However, **as the number of types increases**, larger models, such as those with 7B parameters,
  tend to perform better." The leaderboard bears it out: WordNet (few types) 0.99 → GeoNames 0.59 →
  Gene Ontology (tens of thousands of terms, deep DAG) 0.27. The winning WordNet team explicitly
  noted "the WordNet dataset is being considered as a low number of types and having a higher number
  of types makes it challenging to obtain highly accurate rules."
- **[VERIFIED] Relation-count degrades extraction the same way.** The Wikidata-grounded pipeline was
  evaluated on SciERC (7 relation types), Wiki-NRE (45), WebNLG (159); the paper's discussion notes
  the pipeline "performs best on a large set of documents with a limited scope of knowledge,
  requiring a concise schema", and that richer discovered schemas "hinder extraction performance".
- **[VERIFIED] Whole-ontology-in-prompt is a hallucination generator.** LLMs4OM: the naive
  ChatGPT-4 approach of "ontologies … fully inputted into the LLM" hit two failures — "the limited
  context length LLMs can process, which may be exceeded by larger ontologies", and "the increased
  likelihood of erroneous or 'hallucinated' responses **due to the volume of information provided**."
- **[VERIFIED] Removing accumulated context improved ontology quality.** Memoryless CQbyCQ cut
  context ~60% relative to CQbyCQ *and* produced fewer critical pitfalls, on the explicit rationale
  that "long context can result in distraction of the LLM."
- **[VERIFIED] Long context is a known problem independent of ontologies.** The Wikidata paper's own
  future-work note: "long input context may pose challenge to LLMs even if such long context length
  is technically supported."

**[INFERRED] The practitioner's rule I would adopt:** the schema *shown to an LLM in a single
prompt* should be on the order of **10 node types and 10 edge types**, with every type name a
common English word and every enum closed and short. Foreman's proposed 9 node types / 11 edge
types is right at that budget — which is a point in its favour, and a reason to resist the
temptation to add more (§10.4 argues for a net +3/−1).

**How practitioners keep ontologies small:**

1. **Modularisation + minimal modules.** One module per CQ cluster; the minimal-module definition
   from Lippolis et al. gives an objective delete criterion. **[VERIFIED]**
2. **Profiles.** OWL 2 EL for very large class counts (PTIME subsumption; it is what makes SNOMED CT
   tractable), OWL 2 QL when instance volume dominates and query answering is the only reasoning
   task (LOGSPACE in data size, rewrites to SQL), OWL 2 RL when you want rule-engine reasoning at
   polynomial cost. **[VERIFIED, owl2-profiles.md §1]** Even without adopting OWL, the *discipline*
   of "pick a profile and stay inside it" is worth importing — see §4.2's RL-shaped constraint.
3. **Views for consumers.** Retrieval-shaped subsets rather than the whole schema (this is N3's
   territory — I note only that the size evidence *requires* it).
4. **Layered abstraction.** SEON's five-layer pyramid (general → domain-spanning → domain-specific →
   system-specific → natural-language) with an explicit promotion rule: "whenever we devise an
   analysis where we encounter … a potentially system-specific concept that is not yet generalized …
   we add it first to a system-specific ontology. Later, when our understanding … has been
   consolidated, we review … and decide whether they rather belong to … the domain-specific layer."
   **[VERIFIED]** This is a *deferred-abstraction* rule and it is the direct antidote to premature
   abstraction (§8.2). Foreman should adopt it verbatim.

---

## 6. Upper ontologies: reuse verdict

**Verdict: do not align Foreman to BFO, DOLCE, UFO/gUFO, Cyc, or schema.org. Do reuse PROV-O — but
as a design pattern and a naming source, not as an imported upper ontology.** **[INFERRED]**

Evidence for the negative half:

- **[VERIFIED]** gUFO — the OWL-ised Unified Foundational Ontology, formally the most rigorous
  ontology in OntoAxiom's set — scored F1 **0.170**, mid-pack, behind FOAF (0.221) and Pizza
  (0.172). Foundational rigour did not help LLMs at all. If the point of alignment is to help the
  machine, the measurement says it does not.
- **[VERIFIED]** KNOW, the only ontology in this corpus *designed specifically for LLM consumption*,
  explicitly refuses upper-ontology status: "we don't aspire to be an upper ontology; … the
  expressiveness of our ontology is merely the description logics of OWL, not the undecidable
  higher-order logic used in Cyc." Its stated inclusion criteria are "pragmatic, beginning with
  universality and utility", and it "emphasize[s] simplicity and developer experience". Its authors
  further observe that "LLMs already encode internally much of the commonsense tacit knowledge that
  took decades to capture in the Cyc project" — i.e. the upper ontology's main historical job is
  partly done by the model.
- **[INFERRED]** Foreman's domain is bounded, engineered, and fully observed. Upper ontologies earn
  their keep when you must merge ontologies you did not write, across organisations, over decades.
  None of that applies.

Evidence for the positive half (PROV-O):

- **[VERIFIED]** PROV-O's entire core is three classes and about eight properties:
  `prov:Entity`, `prov:Activity`, `prov:Agent`; `wasGeneratedBy`, `used`, `wasDerivedFrom`,
  `wasAttributedTo`, `wasAssociatedWith`, `actedOnBehalfOf`, `wasInformedBy`, `wasRevisionOf`, plus
  `startedAtTime`/`endedAtTime` and the qualified pattern (`qualifiedAssociation` + `hadRole`).
  It is a W3C Recommendation (2013), ubiquitous, and — critically for §3.3 point 3 — heavily
  represented in training data.
- **[INFERRED]** Every one of Foreman's provenance edges maps onto it (§7.1). Borrowing PROV's
  *names and shapes* gets us (a) a design that has survived 13 years of adversarial use,
  (b) LLM familiarity, and (c) a trivial RDF export path if §4.2's option is ever exercised —
  without importing an ontology, a reasoner, or the OWA.

**schema.org** deserves a separate note: it is the one "upper-ish" vocabulary LLMs genuinely know
well (LLMs4OL 2024 taxonomy discovery on Schema.org scored **0.6157**, second-highest of any
taxonomy subtask, versus 0.0164 on Gene Ontology). If Foreman ever needs to describe generic things
— people, organisations, software applications — schema.org terms are the cheapest possible choice
for an LLM to get right. It is still wrong as a *backbone* for the work-DAG.

---

## 7. Reusable software-engineering domain ontologies

### 7.1 PROV-O — **reuse directly, as the provenance backbone** [VERIFIED]

| Foreman type | PROV-O counterpart | Notes |
|---|---|---|
| `AgentRun` | `prov:Activity` | with `startedAtTime`/`endedAtTime` |
| `Artifact`, `Commit`, `Source` | `prov:Entity` | |
| `Agent` (vendor/model/lane role) | `prov:Agent` (`prov:SoftwareAgent`) | missing from the proposed type list — see §10.4 |
| `PRODUCED` | `prov:wasGeneratedBy` (inverse `prov:generated`) | |
| `DERIVED_FROM` | `prov:wasDerivedFrom` | |
| `REVISES` | `prov:wasRevisionOf` | PROV distinguishes revision from generic derivation — adopt that distinction |
| (agent attribution) | `prov:wasAttributedTo`, `prov:wasAssociatedWith` | |
| (orchestrator delegation) | `prov:actedOnBehalfOf` | exactly models "worker lane acting for the architect" |
| (lane role: implementer / auditor / advisor) | `prov:qualifiedAssociation` + `prov:hadRole` | the qualified pattern is how PROV attaches role to an association — reuse it rather than inventing role edges |
| (round → round causality) | `prov:wasInformedBy` | activity-to-activity |
| `SUPERSEDES` | `prov:wasInvalidatedBy` (partial) | not a clean fit; keep bespoke |

### 7.2 SLSA Provenance v1.0 — **reuse the field schema for `AgentRun`** [VERIFIED]

The SLSA v1.0 provenance predicate is, structurally, exactly "what a build run must record to be
trustworthy", and its field set transfers to an agent run one-for-one:

| SLSA field | Foreman `AgentRun` meaning |
|---|---|
| `subject` | the artifacts/commits the run produced |
| `buildDefinition.buildType` | lane type (implement / audit / advise / plan / search) |
| `buildDefinition.externalParameters` | the five-part spec, model, temperature, tool allowlist |
| `buildDefinition.internalParameters` | orchestrator-controlled settings the caller did not set |
| `buildDefinition.resolvedDependencies` | pinned inputs: base commit SHA, worktree ref, context artifacts |
| `runDetails.builder` | vendor + model + version (the `prov:Agent`) |
| `runDetails.metadata.invocationId` | Foreman's round/attempt/lane identifier |
| `runDetails.metadata.startedOn` / `finishedOn` | timestamps |
| `runDetails.byproducts` | logs, transcripts, token counts |

**[INFERRED]** This is the single best off-the-shelf fit in the corpus, and it directly answers
CQ-7 ("artifacts produced by an unverified agent run"): "unverified" becomes a well-defined
predicate — an `AgentRun` missing required provenance fields, in exactly SLSA's sense.

### 7.3 in-toto attestations — **reuse the envelope only, later** [VERIFIED, index page]

in-toto's `subject` + `predicateType` statement envelope gives signed, tamper-evident provenance.
Not needed for v0.2.9 (single-machine, single-user), but it is the natural upgrade if Foreman's
graph ever needs to be trusted by a third party. Design so it can be wrapped later — i.e. keep
`AgentRun` provenance as a self-contained, serialisable object.

### 7.4 SEON — **reuse the measurement pattern and the layering discipline; do not import** [VERIFIED]

SEON (U. Zurich, OWL, ~2012) is the most complete SE ontology I found. Directly relevant pieces:

- **Measurement pattern:** `Measurement` (the act) / `Measure` (the metric) / `Unit` / `Scale`,
  with derived measures aggregating primitives across subdomains. This is a better model for
  Foreman's `Metric` node than a bare key-value pair — it separates *the metric definition* from
  *the measurement event*, which is what CQ-23 needs.
- **Issue/History/Code layer:** `Issue` → {`Bug`, `FeatureRequest`, `Improvement`}, `reportedBy`,
  `Revision`, `Branch`, `Release`, `Committer` ⊂ `Developer` ⊂ `Stakeholder`. Usable as a naming
  source; the classes themselves are Java/Jira/Bugzilla-era and carry baggage.
- **The `dependsOn` generalisation:** SEON defines one abstract `dependsOn` object property that all
  specific dependency relations specialise. That is the right treatment of Foreman's `DEPENDS_ON`.
- **Caveats:** 2012-vintage, some ontologies listed as "currently not available — being cleaned up",
  and the natural-language layer is "currently incomplete". Treat as a design reference, not a
  dependency.

### 7.5 CodeMeta and SPDX — **skip** [VERIFIED / PARTIAL]

CodeMeta is repository-level software *metadata* (authors, licence, citation) — orthogonal to
Foreman's process graph. SPDX models packages, files, licences and relationships for SBOM purposes;
relevant only if Foreman starts reasoning about dependency provenance, which is not in v0.2.9's
scope. (Note: the SPDX 2.3 landing page returned navigation only — 4 KB, no body text — so this
judgement is from the clause titles, not the normative text.)

### 7.6 The gap

**[INFERRED]** Nothing off the shelf models *multi-agent orchestration*: rounds, attempts, lanes,
cross-vendor verdicts, supersession of one agent's work by another's. PROV-O gets closest and stops
at activity/agent/entity. Foreman's Round/Attempt/Evaluation core has to be bespoke — which is fine,
because it is exactly the part that is fully determined by the event log and therefore needs no
learning.

---

## 8. Anti-patterns to avoid

### 8.1 The documented catalogue [VERIFIED, oops-catalogue.md — all 41 pitfalls fetched]

The ones that will actually bite Foreman, with OOPS! severity:

| ID | Pitfall | Foreman-specific risk |
|---|---|---|
| **P07** (Important) | Merging different concepts in the same class | `PARENT_OF` conflates three unrelated relations — see §10.4 |
| **P17** (Important) | Overspecialising a hierarchy | inventing `AuditAgentRun`/`ImplementAgentRun` subclasses instead of a `role` enum |
| **P18** (Important) | Overspecialising the domain or range | pinning `EVALUATES` to `Attempt` when it must also target `Artifact` |
| **P19** (Important) | Defining multiple domains or ranges | **the #1 measured LLM failure mode** (§3.3.5) |
| **P16** (Critical) | Using a primitive class in place of a defined one | |
| **P01** (Critical) | Creating polysemous elements | `Source` meaning both "cited document" and "source file" |
| **P04** | Unconnected ontology elements | a node type no CQ touches — delete it |
| **P06** | Cycles in a class hierarchy | |
| **P10** | Missing disjointness | Foreman's work-DAG and knowledge-plane types must be disjoint or everything collapses into `Entity` |
| **P11** | Missing domain or range in properties | |
| **P21** | Using a miscellaneous class | `Entity` as a catch-all is precisely this |
| **P22** | Different naming conventions in the same ontology | |
| **P02** | Creating synonyms as classes | `DERIVED_FROM`/`REVISES`/`SUPERSEDES` are near-synonyms — §10.4 |
| **P32** | Several classes with the same label | |

### 8.2 The methodological failure modes

- **[INFERRED] Over-modelling.** The cure is mechanical: build the type set as the union of what the
  CQs need (§2.2 step 3), then delete the remainder. Anything you cannot attach to a CQ is
  speculative.
- **[VERIFIED] Premature abstraction.** SEON's explicit counter-rule: put a new concept in the
  *most specific* layer first, and promote it only after "our understanding of the domain has been
  consolidated". Foreman should mirror this — new node types start as an enum value on an existing
  type, and graduate to a class only after they earn a CQ.
- **[VERIFIED] Class-vs-instance confusion.** SEON handles this well and shows the shape of the
  decision: it defines `Severity` as a *class* at the domain-specific layer but its levels as
  *individuals* in the system-specific layer, because the levels vary by tracker. Foreman's
  equivalent: verdict *kinds* are enum values (instances), not classes.
- **[VERIFIED] Unmaintainable hierarchies.** The empirical signature is in the numbers: Gene
  Ontology — deep, huge, heavily axiomatised — is the ontology every LLM method fails on (taxonomy
  F1 0.0164). Depth plus breadth is where both humans and machines lose the thread.
- **[VERIFIED] Axiom-writing by a model that cannot write axioms.** Bühmann & Lehmann's 2013
  pattern-mining over 1,300+ ontologies had experts accept only **48.2%** of proposed axioms as
  useful — and that was a *pattern-mining* method, more reliable than an LLM at this task. Treat any
  machine-proposed axiom as a candidate for human review, never as an accepted fact.

### 8.3 An in-house post-mortem worth citing [VERIFIED, in-repo]

Foreman's own `skills/graphify/references/extraction-spec.md` records a measured failure of
continuous-valued guidance to an LLM:

> "Models follow discrete rubrics better than continuous ranges; the bimodal distribution observed
> in production (**>50% at 0.5, >40% at 0.85+**) shows the range guidance is being collapsed to a
> binary."

The fix already applied there — replace the continuous 0.0–1.0 range with a five-value discrete
rubric (0.95/0.85/0.75/0.65/0.55) and an explicit "if none fits, mark AMBIGUOUS" escape — is the
right pattern and should be a schema-wide rule: **every LLM-populated field is an enum or a
reference; never a free float, never an open string.**

Two further observations on the current graphify schema, as design input rather than criticism:

- Its `relation` vocabulary (`calls|implements|references|cites|conceptually_related_to|
  shares_data_with|semantically_similar_to|rationale_for`) mixes structural edges (`calls`) with
  soft-similarity edges (`semantically_similar_to`) in one enum. Under §9's CQs these have
  completely different trust levels and should not share a namespace.
- Its node-ID scheme is a derived string (`{path}_{entity}`), and the spec itself documents that
  getting it slightly wrong produces "orphan ghost-duplicate nodes". That is an argument for
  TerminusDB `@key` (schema-enforced deterministic IDs) over convention-enforced ones.

---

## 9. DRAFT: competency questions for Foreman's graph

24 questions. Marked **[W]** work-DAG plane, **[K]** knowledge plane, **[X]** cross-plane.
Marked **¬** where the query requires negation-as-failure (closed-world), **Σ** where it requires
aggregation, **↝** where it requires a recursive/transitive path query. These annotations are the
formalism argument of §4.2 made concrete.

**Work-DAG plane**

1. **[W]** Which attempts descend from round X, in creation order, and which lane and vendor ran
   each? *(basic traversal)*
2. **[W ↝]** For task T, which attempt produced the commit currently reachable from the release
   tag? *(transitive `PRODUCED`/`REVISES` chain from tag back to attempt)*
3. **[W ¬]** Which lanes in round X have no terminal verdict, and have exceeded the stall threshold?
   *(this is the graph version of the existing watchdog — negation over `EVALUATES`)*
4. **[W ↝]** Given a failing gate, what is the shortest path from the failing `Evaluation` back to
   the clause of the five-part `Spec` it violates? *(shortest-path over a mixed edge set)*
5. **[W]** Which attempts were superseded by a later attempt, and which spec revision triggered
   each supersession?
6. **[W ¬]** Which agent runs used a vendor/model that differs from the one the routing policy
   prescribed for that task type? *(policy-conformance audit — requires `Agent` as a node, §10.4)*
7. **[W ¬]** Which artifacts were produced by an agent run that is missing required provenance
   fields (SLSA-incomplete), i.e. which artifacts are unverified?
8. **[W ↝]** Do any `DEPENDS_ON` cycles exist among tasks? *(structural invariant, not a
   question a human asks — but the graph must be able to answer it)*
9. **[W ¬]** For a merge candidate, which commits landed on the base branch after its worktree was
   created? *(the merge-freshness gate, expressed as a graph query)*
10. **[W]** Which attempts consumed an artifact that had already been superseded at the time the
    attempt started — i.e. which agents worked from stale inputs?
11. **[W Σ]** How many attempts did task T require before a PASS verdict, and how did the passing
    attempt's input set differ from the last failing one?
12. **[W Σ ¬]** Which agent runs consumed more than N tokens and produced no artifact that survived
    to a passing evaluation? *(cost attribution / waste detection)*
13. **[W]** For a given commit, which agent run produced it, under which spec, in which round, on
    behalf of which architect decision? *(the full attribution chain — PROV `actedOnBehalfOf`)*

**Knowledge plane**

14. **[K ¬]** Which claims in the design docs are supported by no source at all?
15. **[K ¬ ↝]** Which claims are supported only by sources that were themselves produced by an agent
    run — i.e. which of our beliefs rest on self-generated evidence with no human or external
    anchor? *(recursive over `PRODUCED`/`SUPPORTS`)*
16. **[K ¬]** Which entities are mentioned by two or more sources but have never been `RESOLVED_TO`
    a canonical entity? *(unresolved duplicates — the entity-resolution backlog)*
17. **[K]** Which claims does audit verdict V contradict, and what sources back each side of each
    contradiction?
18. **[K ↝]** For claim C, what is the full provenance chain back to a human-authored source?
19. **[K ¬]** Which pairs of claims about the same entity contradict each other with neither marked
    as superseded? *(live, unresolved contradictions)*
20. **[K]** Which claims were superseded, when, by what, and does any live artifact still depend on
    a superseded claim?

**Cross-plane**

21. **[X ¬]** Which specs have no passing evaluation? And within a spec, which acceptance criteria
    are covered by no evaluation at all? *(the canonical closed-world question)*
22. **[X]** Which failed evaluation's feedback contradicts a claim that the implementing agent run
    had in its context? *(did we hand the worker a belief that the auditor then refuted)*
23. **[X ↝ Σ]** Which `bugeventlog` failure events led to a roadmap claim, and which of those claims
    are now supported by a passing evaluation? *(does the enhancement loop actually close)*
24. **[X Σ]** Which metrics regressed between commits A and B, and which agent run introduced the
    regressing change? *(needs SEON's Measurement/Measure split — §7.4)*

**Observations on this set** **[INFERRED]:**
- **10 of 24 require negation.** OWL cannot answer any of them. This is the formalism decision.
- **7 require recursive path queries.** TerminusDB WOQL has them; plain SHACL does not (it needs
  SPARQL-based constraints). Confirms schema-language + query-language must be chosen together.
- **4 require aggregation** — pushes toward a query language with grouping, not a reasoner.
- **CQ 3, 8, 9 are invariants Foreman already enforces imperatively** (stall watchdog, dependency
  ordering, merge-freshness gate). Expressing them as graph queries is a *consolidation* win, not
  new capability — and a good first migration target because the answers are already known and can
  be diffed against the existing implementation. That is the cheapest possible validation of the
  whole graph plane.

---

## 10. DRAFT ontology sketch

### 10.1 Design rules this sketch obeys

1. Work-DAG nodes are **materialised deterministically from the event log**; no LLM writes them.
2. Knowledge-plane nodes are **LLM-populated against a frozen schema**; every one carries provenance.
3. Every LLM-written field is an **enum or a reference**. No free floats, no open strings (§8.3).
4. Class names are **common English words** (§0.3).
5. The schema stays **OWL 2 RL-shaped** so an RDF export remains possible (§4.2).

### 10.2 Node types

Notation: `field: Type` — `?` optional, `[]` set, `!` required-and-immutable.
`P` = provenance block, defined once in §10.5.

| Type | Plane | Key fields | Cardinality constraints | CQs served |
|---|---|---|---|---|
| **`Task`** | W | `id!`, `title`, `state: TaskState`, `spec: Spec?` | ≤1 `Spec`; `DEPENDS_ON` must be acyclic | 2, 8, 11, 12 |
| **`Round`** | W | `id!`, `task!`, `index: int!`, `opened_at!`, `closed_at?` | exactly 1 `Task`; `(task,index)` unique | 1, 3, 5, 13 |
| **`Attempt`** | W | `id!`, `round!`, `lane: LaneRole!`, `index: int!`, `state: AttemptState` | exactly 1 `Round`; exactly 1 `AgentRun` | 1, 5, 10, 11 |
| **`AgentRun`** | W | `id!`, `attempt!`, `agent!`, `started_at!`, `ended_at?`, `tokens_in`, `tokens_out`, `invocation_id!`, `resolved_deps[]!`, `external_params!` | exactly 1 `Agent`; exactly 1 `Attempt`; **all SLSA fields required or the run is `unverified`** | 6, 7, 12, 13 |
| **`Agent`** | W | `id!`, `vendor: Vendor!`, `model!`, `version?` | — | 6, 13 |
| **`Artifact`** | W/K | `id!`, `kind: ArtifactKind!`, `digest!`, `path?` | abstract parent of `Spec`, `Commit`, `Source` | 7, 9, 10, 20 |
| ⌞ **`Spec`** | W | + `version!`, `criteria[]!` | ≥1 acceptance criterion | 4, 5, 21 |
| ⌞ **`Commit`** | W | + `sha!`, `branch`, `parents[]` | `Foreign` ref to git — the graph does not restate git | 2, 9, 24 |
| ⌞ **`Source`** | K | + `origin: SourceOrigin!` (`human`\|`external`\|`agent_run`), `uri?`, `captured_at` | `origin=agent_run` ⇒ exactly 1 `PRODUCED` from an `AgentRun` | 14, 15, 18 |
| **`Evaluation`** | W/X | `id!`, `target!`, `verdict: Verdict!`, `evaluator!`, `at!`, `feedback?` | exactly 1 target (`TaggedUnion` of `Attempt`\|`Artifact`\|`Claim`); exactly 1 `Agent`\|human evaluator | 3, 4, 7, 21, 22 |
| **`Claim`** | K | `id!`, `text!`, `status: ClaimStatus!` (`live`\|`superseded`\|`retracted`), `P!` | ≥1 `MENTIONS`-source or it is unsourced (CQ-14) | 14–20, 22, 23 |
| **`Entity`** | K | `id!`, `label!`, `kind: EntityKind!` (**closed enum**), `canonical: bool`, `P!` | `RESOLVED_TO` is functional and acyclic | 16, 19 |
| **`Metric`** | W | `id!`, `measure!`, `unit!`, `scale!` | SEON split: `Metric` = the *definition* | 24 |
| **`Measurement`** | W | `id!`, `metric!`, `subject: Commit!`, `value!`, `at!` | exactly 1 `Metric`, exactly 1 subject | 12, 24 |

Enums (all closed): `TaskState`, `AttemptState`, `LaneRole` = {implement, audit, advise, plan,
search}, `Vendor` = {anthropic, openai, xai, google, human}, `Verdict` = {pass, fail, blocked,
inconclusive}, `ArtifactKind`, `ClaimStatus`, `EntityKind`, `SourceOrigin`.

### 10.3 Edge types

| Edge | Domain → Range | Cardinality | PROV analogue | CQs |
|---|---|---|---|---|
| `PARENT_OF` | **split — see §10.4** | | | |
| ⌞ `HAS_ATTEMPT` | `Round` → `Attempt` | 1 → 0..n | — | 1, 5 |
| ⌞ `SUBTASK_OF` | `Task` → `Task` | 0..n → 0..1, acyclic | — | 8 |
| ⌞ `BROADER_THAN` | `Entity` → `Entity` | acyclic, knowledge plane only | `skos:broader` | 16 |
| `PRODUCED` | `AgentRun` → `Artifact` | 1 → 0..n | `prov:generated` | 2, 7, 12, 15, 13 |
| `EVALUATES` | `Evaluation` → `Attempt`\|`Artifact`\|`Claim` | 1 → **exactly 1** | — | 3, 4, 7, 21, 22 |
| `DEPENDS_ON` | `Task`→`Task`, `Artifact`→`Artifact` | **acyclic (enforced)** | `prov:used` | 8, 9, 20 |
| `DERIVED_FROM` | `Artifact` → `Artifact` | 0..n → 0..n | `prov:wasDerivedFrom` | 10, 18 |
| `REVISES` | `Artifact` → `Artifact` | 0..n → 0..1, **same identity lineage** | `prov:wasRevisionOf` | 2, 5 |
| `SUPERSEDES` | `Attempt`→`Attempt`, `Claim`→`Claim` | 0..n → 0..1, `+at!`, `+reason!` | — | 5, 10, 19, 20 |
| `SUPPORTS` | `Source`\|`Claim` → `Claim` | 0..n → 0..n, `+strength: enum` | — | 14, 15, 17, 18, 23 |
| `CONTRADICTS` | `Claim`\|`Evaluation` → `Claim` | 0..n → 0..n, symmetric-by-materialisation | — | 17, 19, 22 |
| `MENTIONS` | `Source` → `Entity` | 0..n → 0..n | — | 16 (weakly) |
| `RESOLVED_TO` | `Entity` → `Entity` | **functional** (≤1), acyclic, `+reviewed_by?` | `owl:sameAs`-like but closed | 16 |
| `RAN_AS` *(new)* | `AgentRun` → `Agent` | 1 → 1 | `prov:wasAssociatedWith` + `hadRole` | 6, 13 |
| `ON_BEHALF_OF` *(new)* | `AgentRun` → `AgentRun`\|`Agent` | 0..1 | `prov:actedOnBehalfOf` | 13 |

### 10.4 What I think is wrong, missing, or over-modelled in the proposed type set

**Missing — and these are blocking:**

- **`Round` and `Attempt`.** The brief describes the work-DAG as "rounds, attempts, verdicts, agent
  runs, commits" but the node-type list has none of the first three. Without `Round`/`Attempt`,
  CQ-1, 3, 5, 10, 11 are all unanswerable and `AgentRun` has nowhere to hang. **Highest-priority
  addition.**
- **`Agent`.** `AgentRun` with no `prov:Agent` cannot answer CQ-6 (routing-policy conformance) or
  CQ-13 (attribution). Cross-vendor orchestration is Foreman's whole thesis; the vendor must be a
  node, not a string field, or you cannot query across it.
- **`Spec`.** The five-part spec is Foreman's central artefact and CQ-4 and CQ-21 both anchor on it.
  Modelling it as `Artifact{kind:spec}` technically works but forces a kind-filter into every query
  and prevents `criteria[]` from being schema-required. Make it a subtype.
- **`Measurement` alongside `Metric`.** SEON's split. `Metric` alone conflates "the definition of
  p95 latency" with "p95 latency was 412 ms at commit abc123". CQ-24 needs both.

**Over-modelled — cut or demote:**

- **`Verdict` as a node.** If it appears in a future draft, resist it: a verdict is the *outcome* of
  an `Evaluation`, not a thing with independent identity. Make it an enum field. Promoting it is
  textbook OOPS! P17 (overspecialising a hierarchy) and adds a join to every query in §9.
- **`MENTIONS`.** In graphify's production output this is the highest-volume edge and it serves
  exactly one CQ (16), weakly. It is a co-occurrence index, not a semantic relation. **Recommend:
  demote to a derived index rather than a first-class stored edge**, or keep it but exclude it from
  everything the LLM is shown (it will dominate the token budget and teach the model that edges are
  cheap). Revisit only if a CQ demands it.
- **`Entity` as currently specified.** Unconstrained, this is OOPS! P21 ("using a miscellaneous
  class") — every extraction failure becomes an `Entity`. It needs (a) a **closed** `kind` enum, and
  (b) an explicit **disjointness constraint against every work-DAG type**, or the two planes merge
  and CQ-15's "self-generated evidence" question becomes meaningless.

**Ambiguous / wrong as specified:**

- **`PARENT_OF` is three relations wearing one name** (Round→Attempt, Task→Subtask, Entity
  taxonomy). OOPS! P07, "merging different concepts in the same class". An LLM asked to choose
  between overloaded relations performs at the domain/range level, F1 ≈ 0.03. **Split into three.**
- **`DERIVED_FROM` / `REVISES` / `SUPERSEDES` are near-synonyms** (OOPS! P02). PROV already
  distinguishes the first two; supersession is a *validity status change*, not a derivation. Keep
  all three but make them **mutually exclusive on any given pair**, and require `SUPERSEDES` to
  carry `at` and `reason`. Otherwise an LLM will pick among them at chance.
- **`EVALUATES` needs an exactly-one target.** If it can point at both an `Attempt` and an
  `Artifact` in the same instance, CQ-21 becomes a union query and CQ-7's "unverified" predicate
  becomes ambiguous. Model as a `TaggedUnion`.
- **`RESOLVED_TO` is the only identity-changing edge** and needs the strictest treatment:
  functional, acyclic, its own provenance, and a `reviewed_by` field. Entity resolution errors are
  the one class of extraction error that corrupts *other* answers rather than just being wrong
  locally.
- **`SUPPORTS` needs a strength enum**, not a float (§8.3), and should be forbidden from `Claim`
  self-loops.

### 10.5 Required provenance block `P` — on every LLM-written node and edge

```
P = {
  extractor:    Agent | "human"        // required — never inferred
  extracted_at: timestamp              // required
  confidence:   EXTRACTED | INFERRED | AMBIGUOUS   // discrete, per §8.3
  source_ref:   { artifact: Artifact, locator: string }   // required, non-empty
  event_offset: int?                   // work-DAG nodes only: offset into the append-only log
}
```

**[INFERRED]** `event_offset` is the load-bearing field. v0.2.0 made the append-only event log the
single source of truth; if every work-DAG node carries its offset, the entire work-DAG plane is
**reconstructible and diffable against the log** — which turns "is the graph correct?" from a
judgement call into a deterministic check. That check is also the cheapest possible answer to the
§3.3 reliability problem: the plane the LLM cannot do well is the plane no LLM writes.

---

## 11. Open questions

1. **Where is the plane boundary enforced?** I recommend a hard disjointness constraint between
   work-DAG and knowledge-plane types, but `Source{origin: agent_run}` deliberately straddles it
   (an agent-produced artifact later cited as evidence). Is that the only permitted bridge? N4 may
   want an opinion, since it is the one place a knowledge-plane claim can inherit work-DAG trust.
2. **Do we need `Round` at all, or is `(Task, attempt_index)` enough?** `Round` earns its place only
   if multiple lanes run in parallel under one round with a shared verdict. Foreman v0.2.5's
   `lane-run --round` says yes; confirm against the event schema v2 before committing.
3. **Materialisation timing.** Is the work-DAG projection built synchronously on each event, or
   batch-rebuilt? Synchronous gives live queries (CQ-3's stall detection needs it); batch is simpler
   and idempotent. Not resolved here.
4. **How is `SUPERSEDES` decided for claims?** For attempts it falls out of the event log. For
   claims it is a judgement — human, LLM, or a rule? If LLM, §3.3 says expect poor precision, and
   CQ-19 (live unresolved contradictions) becomes the human review queue rather than an error.
5. **Schema evolution policy.** TerminusDB is versioned, but the CQ suite is the real compatibility
   contract. Do CQ changes require a schema version bump? I would say yes — a CQ *is* a requirement.
6. **Whether to invest in an RDF/OWL export now or keep it as an option.** §4.2 argues option; if
   Foreman's graph is intended to be published (the `site/` directory suggests a public surface),
   that changes the answer and should be decided before the schema freezes.
7. **`MENTIONS` demotion needs a measurement.** I recommend it on volume/value grounds but did not
   measure it against Foreman's actual `graphify-out/graph.json`. That is a cheap experiment: count
   `MENTIONS` share of edges, then check how many of the 24 CQs degrade if it is removed.

---

*Lane N2. Sources under `/tmp/neurosym-docs/N2/` (48 files, manifest at `MANIFEST.txt`).
Recorded fetch failures: 4 (terminusdb `.com` 403 → use `.org`; Poveda pitfalls PDF 404 →
superseded by OOPS! catalogue; arXiv 2404.17524 and 2604.20795 have no HTML build → abstract only;
SPDX 2.3 landing page returns navigation only).*
