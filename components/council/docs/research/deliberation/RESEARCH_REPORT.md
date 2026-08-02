# Evidence report: Cross-CLI Council deliberation

## Bottom line

Council should be an **independent-propose, selectively-deliberate, bias-checked aggregate** protocol. It should not be a free-form chat followed by a chairman's intuition. The strongest evidence supports heterogeneous initial proposals and calibrated aggregation. It does not support mandatory long debate. Recent results show that a round-zero vote often explains most apparent debate gains, while correlated errors can make a confident majority wrong.

The evidence base contains 12 primary sources: 9 peer-reviewed papers and 3 primary preprints. Exact metadata and local artifact paths are in `SOURCES.json`.

## Findings and contradictions

### 1. Diversity helps, but model-family diversity matters more than role-play

[ReConcile](https://aclanthology.org/2024.acl-long.381/) found its multi-model component to be its largest ablated contributor: StrategyQA fell from 79.0% to 72.2% when three distinct backbones were replaced by ChatGPT instances. Distinct models also produced less-similar initial responses than same-model samples, even when the same model used high temperature. The newer [Demystifying MAD](https://aclanthology.org/2026.findings-acl.1694/) likewise identifies diverse initial hypotheses as a necessary mechanism.

This supports cross-vendor CLIs. It does not imply that three wrappers around closely related models are three independent votes. Council must track model provider, family, version, and likely training lineage as failure-domain metadata.

### 2. Debate can help, but its marginal value is conditional and often overstated

Positive papers include [Du et al.](https://proceedings.mlr.press/v235/du24e.html), [ReConcile](https://aclanthology.org/2024.acl-long.381/), and [Liang et al.](https://aclanthology.org/2024.emnlp-main.992/). They report gains from cross-agent critique, corrective explanations, and divergent adversarial roles.

The contradiction is important. [More Agents Is All You Need](https://arxiv.org/abs/2402.05120) shows that independent sampling and voting alone scales performance. [Debate or Vote](https://arxiv.org/abs/2508.17536) reports that majority voting explains most gains across seven benchmarks and models symmetric debate as a martingale: without a mechanism that favors correct evidence, discussion has no reason to drift toward truth. [Demystifying MAD](https://aclanthology.org/2026.findings-acl.1694/) reaches a compatible conclusion and improves results only after diversity-aware initialization and calibrated confidence-modulated updates.

Council must therefore log a round-zero aggregate and treat it as the baseline. Deliberation is justified only for disagreement, low confidence, high consequence, missing evidence, or a material expected gain over that baseline.

### 3. Long debate is unsafe as a default

In [Liang et al.](https://aclanthology.org/2024.emnlp-main.992/), forced continuation harmed translation quality; an adaptive judge stop was better, and excessive adversarial intensity caused polarization. In ReConcile, team accuracy peaked after two discussion rounds (79.0%) and slipped at round three (78.7%). Debate or Vote also reports degradation in several three- and five-round settings.

Set a default maximum of two critique rounds. Stop earlier when no agent introduces new evidence, the decision is stable under a fresh secret ballot, or an external verifier resolves the dispute. Never use "everyone now agrees" as the sole stopping test because conformity can create false consensus.

### 4. A chairman or judge is a biased sensor, not ground truth

[Judging LLM-as-a-Judge](https://proceedings.neurips.cc/paper_files/paper/2023/hash/91f18a1287b398d378ef22505bf41832-Abstract-Datasets_and_Benchmarks.html) found strong judges useful and often human-aligned, but position, verbosity, self-enhancement, and reasoning failures persisted. GPT-4 was order-consistent on only 65% of a difficult paired set. [Large Language Models are not Fair Evaluators](https://aclanthology.org/2024.acl-long.511/) showed that swapping response order could drastically invert rankings even when the prompt told the judge to ignore order. [Panickssery et al.](https://proceedings.neurips.cc/paper_files/paper/2024/hash/7f1f0218e45f5414c79c0679633e47bc-Abstract-Conference.html) establishes self-preference and shows that self-recognition strength correlates with it. Liang et al. independently found that a heterogeneous debate judge preferred the debater sharing its backbone.

Consequences for Council:

- Blind candidate authorship, vendor, model, and CLI identity before evaluation.
- Separate proposing, judging, and synthesizing roles. A model must not score its own proposal.
- For pairwise comparisons, run both A/B and B/A orderings. An order-reversal becomes a tie or escalation, not a chairman tiebreak.
- Require evidence and rubric scores before the verdict. For verifiable tasks, the judge must first solve independently or use references/tests.
- Rotate the chairman and audit per-chair win rates for provider affinity.

### 5. Rank before fusion

[LLM-Blender](https://aclanthology.org/2023.acl-long.792/) shows that the best source model varies by input and that pairwise ranking followed by fusion of only top candidates outperforms indiscriminate ensembling. Council should not concatenate all transcripts into a large prompt and ask for a polished compromise. It should first identify admissible candidates, eliminate invalid ones with tools or rubric failures, conduct bias-checked pairwise ranking, then synthesize from the top set while preserving source attribution and dissent.

### 6. Confidence is useful only after calibration

[Just Ask for Calibration](https://aclanthology.org/2023.emnlp-main.330/) found verbalized probabilities often better calibrated than token probabilities for RLHF models; generating several plausible answer choices before confidence and applying temperature scaling often cut expected calibration error by more than half. ReConcile also found confidence weighting useful, but explicitly rescaled raw scores because models were overconfident. Its confidence ablation was smaller than its model-diversity ablation.

Council must collect confidence with the initial secret answer, before peer exposure. Calibrate each model-task pair against historical outcomes and use the calibrated value only as a bounded weight. Track both calibration and discrimination; ECE alone is inadequate because a constant 50% forecast can have perfect ECE while carrying no useful ranking signal.

### 7. Majority is not quorum when errors are correlated

The recent [Minority Sentinel](https://arxiv.org/abs/2606.29270) preprint reports that the minority was correct in 25.5% of divergent three-model cases. A behavioral, non-LLM override classifier produced positive net gain, whereas a GPT-4o judge produced negative gain. These rates need independent replication, but the direction matches the broader judge-bias and correlated-error evidence.

Council quorum must count independent failure domains, not raw agent processes. A practical default is at least three initial proposals from at least two materially different model families. A high-confidence minority with unique evidence blocks automatic closure and triggers external verification, a fresh orthogonal model, or human review. A majority formed by same-family replicas never overrides a cross-family evidence-backed dissent by count alone.

## Required Council protocol

1. **Independent phase:** Every member receives the same task and rubric. It returns a structured answer, evidence/assumptions, key failure mode, and confidence without seeing peers. Persist this immutable round-zero record.
2. **Normalize and blind:** Remove vendor/model identifiers, normalize length and formatting, randomize display order, and preserve a hidden provenance map.
3. **Verify before debate:** Run deterministic tests, retrieval checks, policy constraints, or schema validation. Invalid candidates are excluded with machine-readable reasons.
4. **Round-zero aggregation:** Record majority/plurality, confidence-weighted result, disagreement entropy, and distinct failure-domain count. This is the baseline that discussion must beat.
5. **Selective deliberation:** Continue only for material disagreement, low calibrated confidence, unresolved evidence, or high-impact tasks. Allow at most two rounds by default. Each critique must introduce a falsifiable objection or new evidence; pure restatement does not extend the debate.
6. **Private re-vote:** After each round, members vote and state confidence privately. Do not expose running tallies before all ballots arrive.
7. **Bias-checked adjudication:** Use a non-author judge where possible. Pairwise judge both orders. Evidence and rubric scores precede verdict. Order reversal, self-authorship, unresolved conflict, or suspected correlated error causes tie/escalation.
8. **Rank, then synthesize:** Fuse only the top admissible candidates. The synthesis must cite which candidate supplied each material claim and retain a dissent section when quorum is not robust.
9. **Quorum and minority guard:** Require multiple model families. A unique, evidence-backed, high-confidence minority blocks automatic consensus until verified. Do not equate unanimity after cross-talk with independent agreement.
10. **Adaptive stop and audit:** Stop on verified resolution, stable private ballots with no new evidence, or the round cap. Log model versions, prompts, ordering, raw and calibrated confidence, initial and final ballots, revisions, tool results, costs, latency, stop reason, and chairman identity.

## Evaluation gates before release

Council should not ship based on benchmark averages alone. Compare these arms under equal token/call budgets: best single model; independent majority vote; calibrated weighted vote; pairwise rank-then-fuse; one-round Council; two-round Council. Report accuracy or human preference, abstention quality, Brier score/ECE plus AUC, order-reversal rate, self/provider-affinity, minority recovery versus wrong-overturn rate, decision latency, and cost. Promotion requires a statistically credible gain over round-zero voting without worse calibration or bias metrics.

## Visual pass

PixelRAG 0.4.0 `pixelshot` rendered the 20-page ReConcile paper to one image tile per page. Inspecting the diagram and tables added three details that abstract/text-only review obscures: the actual three-stage data flow exposes every peer answer and confidence before revision; weighted voting occurs at every round; and the round-wise table shows a peak at round two followed by a slight decline. The ablation table also made the relative effect sizes immediately comparable: model diversity (+6.8 points versus the homogeneous variant) mattered substantially more than confidence estimation (+1.3 points). These observations directly motivated independent first ballots, bounded rounds, and treating confidence as a secondary calibrated weight.

Visual artifacts: `visuals/reconcile/reconcile-acl-2024.png.tiles/` (notably `tile_0003.jpg`, `tile_0006.jpg`, and `tile_0008.jpg`). Sanitized Scrapling `--ai-targeted` extracts are in `extracts/`. Dependency directories are deliberately excluded from `SOURCES.json`.
