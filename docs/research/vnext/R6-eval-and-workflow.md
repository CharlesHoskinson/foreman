# R6 — Evaluation, Measurement, and Workflow Improvement

Research lane R6 for Foreman vNext. Compiled 2026-07-28.
Background read: `SOURCE-karpathy-graph-engineering.txt` §VII (Evaluation and Quality),
§VIII (Decision Framework), Table III (evaluation metrics by layer + common
misreadings), Table VI (production checklist); `ROADMAP.md` through v0.4.0.

Evidence discipline used here: every claim carries a URL, a status
(**VERIFIED** = I fetched the page/abstract this session; **INFERRED** = the claim
comes only from a search-engine synthesis and the primary source was not fetched),
and a date. Numbers are preferred over adjectives. Disconfirming evidence is
collected in its own section and is **not** hedged.

---

## 1. Sources fetched

| URL | Status | Source date | Notes |
|---|---|---|---|
| https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ | **VERIFIED** (scrapling; WebFetch got HTTP 403 first) | 2026-02-23 | Primary; full text captured |
| https://arxiv.org/abs/2512.10218 | **VERIFIED** (abs) | 2025-12 (v2) | SWE-bench-V ability vs memory |
| https://scale.com/blog/swe-bench-pro | **VERIFIED** | 2025-09-19 | SWE-bench Pro composition + release scores |
| https://arxiv.org/abs/2603.00520 | **VERIFIED** (abs) | 2026-02-28 | SWE-ABS adversarial test strengthening |
| https://arxiv.org/abs/2510.11977 | **VERIFIED** (abs) | 2025-10 | Holistic Agent Leaderboard (HAL) |
| https://arxiv.org/abs/2606.13003 | **VERIFIED** (abs + pdf) | 2026-06-11 (v2 06-16) | The Illusion of Multi-Agent Advantage |
| https://www.anthropic.com/engineering/multi-agent-research-system | **VERIFIED** | 2025-06 | 15× tokens, 90.2% delta, coding caveat |
| https://cognition.com/blog/dont-build-multi-agents | **VERIFIED** (301 from cognition.ai) | 2025-06-12 | Don't Build Multi-Agents |
| https://arxiv.org/abs/2503.13657 | **VERIFIED** (abs) | 2025-03-17 (v3 2025-10-26) | MAST failure taxonomy |
| https://arxiv.org/html/2604.16790v1 | **VERIFIED** | 2026-04-18 | Bias in the Loop: LLM-as-judge for SE |
| https://arxiv.org/html/2604.23178v1 | **VERIFIED** | 2026-04 | Judging the Judges: bias-mitigation ablation |
| https://arxiv.org/abs/2605.29800 | **VERIFIED** (abs) | 2026-05 | Nine Judges, Two Effective Votes |
| https://arxiv.org/abs/2604.07650 | **VERIFIED** (abs) | 2026-04-08 | Behavioral entanglement across vendors |
| https://arxiv.org/abs/2606.11686 | **VERIFIED** (abs) | 2026-06 | Layer-Isolated Evaluation (no-LLM scaffold harness) |
| https://arxiv.org/abs/2607.06906 | **VERIFIED** (abs) | 2026-07 | The Harness Effect (orchestration token economics) |
| https://arxiv.org/abs/2604.25850 | **VERIFIED** (abs) | 2026-04 | Agentic Harness Engineering (autoresearch for harnesses) |
| https://arxiv.org/abs/2607.12790 | **VERIFIED** (abs) | 2026-07 | Who Grades the Grader (Double Ratchet) |
| https://arxiv.org/abs/2602.07900 | **VERIFIED** (abs) | 2026-02 | Rethinking value of agent-generated tests |
| https://arxiv.org/abs/2605.15229 | **VERIFIED** (abs) | 2026-05-13 (rev 05-30) | PBT-Bench |
| https://arxiv.org/abs/2607.00053 | **VERIFIED** (abs) | 2026-06-30 | SWE-Router (trajectory-conditioned routing) |
| https://github.com/cameronsjo/spec-compare (raw README) | **VERIFIED** | 2026 | SDD tool comparison + worktree analysis |
| https://arxiv.org/pdf/2501.12862 (Meta ACH / mutation-guided test gen) | **INFERRED** (search synthesis only) | 2025-01 | Not fetched |
| SWE-bench Verified Mini cost ($259.20, SWE-Agent + o4-mini Low) | **INFERRED** (search synthesis of HAL paper) | 2025-10 | Number not re-verified in the HAL abstract |
| Terminal-Bench 2.0 / Harbor (tbench.ai, snorkel.ai) | **INFERRED** | 2025-11 → 2026-07 | 89 tasks, 16 categories, frontier <65%; SWE-1.7 81.5% on TB 2.1 — vendor-reported |
| Aider polyglot (225 Exercism tasks, pass_rate_2 + well-formed-edits) | **INFERRED** | 2024-12 → 2026 | Leaderboard not fetched |
| OpenTelemetry GenAI semconv v1.41 (agent/workflow/tool/model spans) | **INFERRED** | 2026 | Spec page not fetched |
| GraphRAG vs vector RAG cost/benefit, LazyGraphRAG 0.1% index cost | **INFERRED** | 2024–2026 | Vendor/blog synthesis |
| Sandbox escalation practice (egress default-deny, ephemeral containers) | **INFERRED** | 2026-04 | CSA/SANS/OWASP briefing not fetched directly |
| SWE-Lancer, Commit0 | **NOT FOUND** in 2026 search results | — | Both appear to have fallen out of active use; treat as dormant |

**Failed / degraded sources (not skipped, recorded):**
- `openai.com` returns 403 to WebFetch; scrapling `fetch --network-idle` succeeded. Use scrapling for openai.com.
- `arxiv.org/pdf/*` fetches return PDF-derived text where the *abstract* is reliable but body tables/numbers frequently are not extractable (hit on 2606.13003 and 2607.00053). Use `arxiv.org/abs/` for the abstract, and treat body numbers as unverified unless the HTML (`arxiv.org/html/...`) renders.
- SWE-Router's headline cost-saving percentages are **not in the abstract** and were not extractable from the PDF body. The *mechanism* is verified; the *magnitude* is not.

---

## 2. Half A — how do we know it's working?

### 2.1 Benchmarks that actually measure agentic SE

**SWE-bench Verified is dead as a progress signal, by its own author-of-record.**
OpenAI (2026-02-23, VERIFIED): they audited a 27.6% subset of the dataset that models
often failed and found **"at least 59.4% of the audited problems have flawed test cases
that reject functionally correct submissions."** They also found **all frontier models
tested could reproduce the gold patch or verbatim problem-statement specifics**, and
"models that have seen the problems during training are more likely to succeed, because
they have additional information needed to pass the underspecified tests." State of the
art moved only 74.9% → 80.9% in six months. Their conclusion: *"we have stopped reporting
SWE-bench Verified scores, and we recommend that other model developers do so too,"* and
*"OpenAI recommends reporting results for SWE-bench Pro."*

Two independent corroborations:
- **Ability vs memory** (arXiv 2512.10218, VERIFIED): models scored ~**3× better** on
  SWE-bench Verified than on BeetleBox/SWE-rebench, and ~**6× better** at locating the
  edited file with no project context — a localization signal that memorization explains
  and capability does not.
- **SWE-ABS** (arXiv 2603.00520, 2026-02-28, VERIFIED): strengthening tests on 50.2% of
  the 500 Verified instances **rejects 19.71% of previously passing patches**; the top
  agent falls **78.80% → 62.20% (−16.6 pp)** and drops to fifth place. *"One in five
  'solved' patches from the top-30 agents are semantically incorrect."*

**SWE-bench Pro** (Scale, 2025-09-19, VERIFIED): 1,865 instances / 41 repos —
731 public, 858 held-out, 276 commercial-private. Contamination resistance is
*structural*: copyleft (GPL) public repos that training pipelines exclude for legal
reasons, plus proprietary code that was never public. Release scores were brutal:
Claude Opus 4.1 23.1% public / 17.8% commercial; GPT-5 23.3% / 14.9%. Mid-2026
leaderboards put the frontier in the 57–69% band (INFERRED, vendor-submitted).

**Terminal-Bench 2.0 / Harbor** (INFERRED): 89 tasks, 16 categories, Docker-isolated,
frontier <65%. Harbor is notable for Foreman because it is *a harness for running agent
evals*, i.e. the closest public analogue to what Foreman would need.

**Aider polyglot** (INFERRED): 225 Exercism tasks across ~6 languages; two metrics —
`pass_rate_2` and a **"well-formed edits" rate**. The second metric is the interesting
one for an orchestration layer: it measures whether the model obeyed the harness's diff
contract, which is exactly a scaffold-integrity metric, not a capability metric.

**SWE-Lancer and Commit0 did not surface in any 2026 search result.** Treat as dormant;
do not build on them.

**Usability as a regression harness for an orchestration layer — verdict: NO for all of
the above.** Reasons, in order of weight:
1. They measure the *model*, and hold the scaffold implicit. Foreman needs the inverse:
   hold model fixed, vary the orchestration layer. The only work found that does this
   explicitly is the Harness Effect study, which *"hold[s] both the models and judges
   fixed while varying only the orchestration layer"* (INFERRED phrasing from search;
   paper VERIFIED, see §2.4).
2. Cost. HAL (VERIFIED) spent **~$40,000** for 21,730 rollouts across 9 models × 9
   benchmarks. Even SWE-bench Verified *Mini* (50 tasks) was **$259.20** with SWE-Agent
   + o4-mini Low (INFERRED). A per-release regression gate cannot cost that.
3. Signal-to-noise. Contamination (above) means a Foreman change and a model-vendor
   training-data change are confounded in the same number.
4. Variance. Reported run-to-run σ on agent benchmarks lands roughly 1.5–2.7 pp,
   with worst-case sample σ ≈ 0.065 on some pass-rate slices (INFERRED). A 3-run design
   gives CI half-widths of ~2.7–4.9 pp. Most orchestration changes Foreman ships would
   be inside that noise band.

The one legitimate external use: **an annual sanity anchor**, ~50 tasks of SWE-bench Pro
public split, run once per major release, reported with CIs, and explicitly *not* used as
a merge gate.

### 2.2 Multi-agent vs single-agent: cost/quality, including the strongest counter-evidence

**The strongest counter-evidence found** — *The Illusion of Multi-Agent Advantage*
(arXiv 2606.13003, 2026-06-11, VERIFIED abstract):

> "Across traditional reasoning datasets and tasks with interactive multi-step workflows
> (e.g., BrowseComp-Plus), we demonstrate that automatic MAS consistently underperform
> CoT-SC despite being **up to 10x more expensive**. … systematic deconstruction of the
> generated MAS architectures reveals that current automated design paradigms produce
> **architectural bloat that prioritizes superficial complexity which does not translate
> into functional utility**."

Two load-bearing qualifications that Foreman should not paper over *and* should not
concede more than is warranted: (a) the target is **automatically generated** MAS
(DyLAN/AFlow/ADAS-class), and (b) the paper's own control finding is that
**"expert-architected MAS consistently outperforms automatically generated architectures
in both raw performance and cost-efficiency."** Foreman is hand-architected, so the
paper's indictment lands on auto-MAS. But its *methodological* indictment lands squarely
on Foreman too: existing evaluations "mask critical architectural gaps … by failing to
account for the marginal utility of increased computational cost." **Foreman has no
cost-matched baseline today.** That is the finding to act on.

**Anthropic's own numbers** (VERIFIED) are simultaneously the best pro- and
anti-multi-agent data point:
- "agents typically use about **4× more tokens** than chat interactions, and multi-agent
  systems use about **15× more tokens** than chats."
- "token usage by itself explains **80% of the variance**" in performance.
- A lead-Opus/subagent-Sonnet system **"outperformed single-agent Claude Opus 4 by 90.2%"**
  on their research eval.
- And the caveat that matters most to Foreman: **"most coding tasks involve fewer truly
  parallelizable tasks than research, and LLM agents are not yet great at coordinating and
  delegating to other agents in real time."**
- "multi-agent systems require tasks where the value of the task is high enough to pay for
  the increased performance."

Read together: the 90.2% is on *research*, which is embarrassingly parallel; the token
finding means most of the 90.2% may be bought with the 15×, not with the topology.

**Cognition, "Don't Build Multi-Agents"** (2025-06-12, VERIFIED). Two principles, verbatim:
1. *"Share context, and share full agent traces, not just individual messages"*
2. *"Actions carry implicit decisions, and conflicting decisions carry bad results"*
Failure mode given: a Flappy Bird clone split across two subagents produces a Super Mario
background and a non-game bird, and the joining agent must reconcile incompatible implicit
decisions. Foreman's one-spec-one-worker-one-worktree topology largely dodges this (there
is no fan-out *within* a change), but the audit lane does receive a cold diff — i.e. by
design it does *not* share the full trace. That is a deliberate bias/independence
trade-off and should be named as one.

**MAST** (arXiv 2503.13657, VERIFIED): **14 failure modes in 3 categories** (system design,
inter-agent misalignment, task verification), from 1,600+ annotated traces across 7 MAS
frameworks, inter-annotator κ = 0.88. Headline: *"Despite enthusiasm for Multi-Agent LLM
Systems (MAS), their performance gains on popular benchmarks are often minimal."* The
paper reports **no measured fix efficacy** — it establishes the taxonomy, not remedies.

Also found and worth noting as an *equal-budget* result: a 2026-05 result reporting
single-agent LLMs matching or beating multi-agent systems on multi-hop reasoning **under
equal thinking-token budgets** (INFERRED, blog-level, primary not located). Directionally
consistent with 2606.13003; do not cite as measured.

### 2.3 LLM-as-judge reliability for code review

**Measured bias magnitudes on code specifically** — *Bias in the Loop: Auditing
LLM-as-a-Judge for Software Engineering* (arXiv 2604.16790, 2026-04-18, VERIFIED). Twelve
prompt-injected biases (position, authority, bandwagon, CoT, distraction, diversity,
final-only, model-name, refined, self-enhancement, sentiment, verbosity), scored against
**execution-based gold labels** from CodeJudgeBench (pass/fail unit tests), not human
raters. Selected magnitudes:
- Qwen2.5-Coder-3B, A-correct: verbosity cue collapses accuracy **60.99% → 30.36%**;
  a "refined version" label inflates it to **86.93%**; a confident tone to **92.56%**.
- Same model, B-correct: the *same* cues invert — verbosity **44.27% → 72.07%**, refined
  **→ 16.79%**. i.e. the cue is not tracking quality, it is tracking position interaction.
- GPT, TestGen: a distraction cue costs **−14.95 pp** (77.46% → 62.51%).
- Test–retest consistency: Qwen3-4B 70–92%; Qwen2.5-Coder-3B baseline TestGen consistency
  was **near-random at 50.36%** — and a *sentiment* cue raised consistency to 80.56%,
  i.e. linguistic cues act as an anchor and *manufacture* stability without correctness.
The paper proposes A/B order swapping, prompt perturbation controls, reporting bias
sensitivity alongside accuracy, and **"trigger verification, such as compilation, static
analysis, or lightweight tests"** — but **does not empirically validate** any of them.

**Which mitigations actually work** — *Judging the Judges* (arXiv 2604.23178, 2026-04,
VERIFIED): nine strategies × five models × four providers.
- **Chain-of-thought (S5) is the only universally positive strategy**: +7.2 pp for Claude
  (p=0.004), and the only one that helped *all* models on adversarial data (+1.5 to +13.0 pp).
- **Calibrated 5-criteria rubric (S4)**: neutral to +2.8 pp; measurably reduces verbosity
  bias (−0.11 avg).
- **Position swap (S1) backfires**: +4.6 pp for Gemini Pro (p=0.012) but **−2.4 pp for
  GPT-4o**, and **consistently hurts on curated/adversarial benchmarks (−2.5 to −7.0 pp)**.
- **Combined budget (S8 = swap + CoT + rubric, 2× cost)** is the best configuration:
  +11.2 pp for Claude (p<0.0001), **70.0% agreement** overall.
- Overall: 18 of 20 non-baseline configurations improved (sign test p<0.001), but
  significance was model-dependent.

Note the ceiling: the *best* debiased judge configuration reaches **70% agreement**. The
widely repeated "80% agreement, matches human-human consistency, 500–5000× cheaper" figure
(INFERRED, blog-level, traceable to MT-Bench-era work) is optimistic for code review and
should not be Foreman's planning assumption.

**Cross-vendor judging is a weaker mitigation than assumed** — see §5 (steelman). Summary:
self-preference is real (GPT-4 ~+10% win rate on its own outputs, INFERRED), and
cross-family judging reduces it — but the *independence* it is assumed to buy largely does
not exist.

### 2.4 Cost/latency telemetry practice — the "evaluation plane"

**The Harness Effect** (arXiv 2607.06906, 2026-07, VERIFIED abstract) is the single most
directly applicable paper found. Six foundation models × 22 locked evaluation tasks,
varying only the orchestration layer:
- blended cost per task **−41% ($0.21 → $0.12)**
- tokens per task **−38% (14.2k → 8.8k)**
- median wall clock **−44% (48s → 27s)**
- task-completion quality **at parity, 0.78 → 0.81**
- quality per dollar **+82%**; task-completions per million tokens **54.9 → 92.0**
- efficiency gains model-invariant, **33–61%** across all six models
- headline: **"the orchestration layer moved cost per task more than the full spread of the
  model menu did."**

Its per-run recording set — cost/task, tokens/task, wall clock, quality score,
quality-per-dollar, completions-per-Mtoken — is a reasonable minimum and is folded into
the proposal in §4. The **22 locked evaluation tasks** design is the load-bearing idea:
a small, frozen, in-house task set is what makes an orchestration delta attributable.

**Agentic Harness Engineering** (arXiv 2604.25850, 2026-04, VERIFIED abstract) is Karpathy's
autoresearch ratchet applied to a coding *harness*, with three "observability pillars":
- **Component observability** — "every editable harness component a file-level
  representation so the action space is explicit and revertible"
- **Experience observability** — millions of raw trajectory tokens distilled into a
  layered, drill-down evidence corpus
- **Decision observability** — **"pairs every edit with a self-declared prediction, later
  verified against the next round's task-level outcomes"** (edits as falsifiable contracts)
Measured: Terminal-Bench 2 pass@1 **69.7% → 77.0%** over ten iterations, beating
human-designed Codex-CLI (71.9%); SWE-bench-verified top performance with **12% fewer
tokens**; cross-model transfer **+5.1 to +10.1 pp** across three other model families.
Ablations: gains came from **tools, middleware and memory — not system prompts.**

**OpenTelemetry GenAI semantic conventions** (INFERRED): as of v1.41 the spec defines
agent / workflow / tool / model spans plus required latency and token-usage metrics, with
vendor support (Datadog, Honeycomb, New Relic) and native emission from LangChain, CrewAI,
AutoGen. Relevant to Foreman only as a *naming* convention — Foreman already has a
better-than-OTel substrate in its append-only per-run `events.jsonl` (schema v2, atomic
O_APPEND, cursors, replay, compaction). The gap is not the transport, it is that **nothing
in the current event vocabulary records cost, tokens, or model identity.** Verified by
inspection: the emitted types are `alert`, `heartbeat`, `round_done`, `state`,
`checkpoint`, `ownership`, `merge_base`, `prompt`, `resume` — and grep for
`token|cost_usd|usage` in `skills/foreman/scripts/` returns only incidental matches, no
accounting.

**Replayability** (INFERRED): the 2026 consensus for agent debugging is record-replay
adapted from `rr`-style debuggers — record every nondeterministic input, treat the model
call as the one irreducible nondeterministic input and record its output, then re-execute
the deterministic glue. Both OpenAI's `seed` and temperature=0 are documented as *not*
guaranteeing determinism. Foreman's event log is already an event-sourced substrate; it
records decisions but **not model I/O**, so it cannot replay today.

---

## 3. Half B — workflow improvement SOTA

### 3.1 Spec-driven development tooling

From the `spec-compare` study (VERIFIED) and 2026 landscape surveys (INFERRED), the field
has stratified into three maturity levels:
- **Spec-First** — specs are scaffolding, discarded after use (Spec-Kit's greenfield mode)
- **Spec-Anchored** — specs persist and evolve alongside code (**where Foreman + OpenSpec sit**)
- **Spec-as-Source** — only specs are edited, code is a regenerable artifact never hand-edited
  (Tessl; $125M-funded, Framework + Registry now public)

What the mature ones do that Foreman's five-part spec + OpenSpec/EARS does not:
1. **A constitution / standing-invariant layer** (Spec-Kit): project-level rules that every
   spec inherits and every review checks, separate from per-change requirements. Foreman
   has this *culturally* (CLAUDE.md, references/) but not as a machine-checked artifact the
   gate can evaluate against.
2. **Built-in per-feature worktree orchestration** as a first-class SDD primitive (Spec
   Kitty pioneered it; Superpowers, Conductor, Zencoder/Zenflow followed). **Foreman is
   already ahead here** — `wt-new`/`wt-merge`/`wt-cleanup` plus admission control and a
   merge-freshness gate is a stronger implementation than anything in the comparison.
3. **Delta markers (ADDED / MODIFIED / REMOVED)** for brownfield modification — OpenSpec's
   differentiator, and the study's finding is that *"OpenSpec alone is purpose-built for
   modifications,"* which is a systemic industry gap. Foreman already inherits this.
4. **Role decomposition at enterprise scale** (BMad: 21 specialized agents). Given §2.2 and
   §5, this is a *cost* to imitate, not a capability.
5. **Regeneration equivalence** (Tessl): the ability to regenerate an implementation from
   the spec and diff it against the current code. This is the genuinely novel primitive
   Foreman lacks. It is also a *verification* mechanism, not just authoring: a spec that
   cannot regenerate to a behaviorally equivalent implementation is an underspecified spec,
   and that is measurable.

Bottom line: Foreman's spec layer is at or above the median of the mature tools. The
missing pieces are the **machine-checked constitution** and **spec→regeneration
equivalence as a spec-quality metric**, not more spec ceremony.

### 3.2 Ratchet / evaluator-optimizer loops applied to code

The pattern is now well documented in production form (AWS Prescriptive Guidance,
Icepick/Hatchet, INFERRED) and, more importantly, has been applied to *harnesses*
themselves (2604.25850, VERIFIED, §2.4). Three findings matter for Foreman:

1. **Edits-as-falsifiable-contracts.** 2604.25850's decision observability: every harness
   edit carries a self-declared prediction, checked against the next round's outcomes.
   The generalized form seen in 2026 work (INFERRED): each edit attaches a manifest with
   failure evidence, inferred root cause, targeted fix, and predicted impact; the next
   round intersects predicted-fix and predicted-regression sets with observed deltas to
   produce a per-edit verdict. This is a near-free addition to Foreman's spec format —
   a **predicted-effect field** — and it converts "the audit approved it" into "the
   prediction held."
2. **Revert discipline.** The autoresearch rule as applied to code (INFERRED synthesis):
   test failure → immediate revert; improvement → snapshot update; **lateral moves are
   kept** to allow exploration. That third clause is not obvious and is the difference
   between a ratchet and a local-minimum trap.
3. **Ratchets get gamed, and the fix is anchors + an independent auditor.**
   *Who Grades the Grader* (arXiv 2607.12790, 2026-07, VERIFIED) runs a "Double Ratchet":
   metric evolution and skill evolution as parallel lifecycles. Results: retains
   **88–110% of the held-out lift** achievable with ground-truth-driven skill evolution,
   across code generation, SQL generation and report generation. Safeguards, all three of
   which are directly portable: **anchor discipline** (*"removing anchor guards collapses
   the metric into a vacuous detector"*), **independent auditing** (evolved skills *did*
   game the report rubric, and an independent judge caught it), and iterative detector
   repair (77% preference over baseline). Their stated position — a
   **"failure-expecting architecture is the right default"** where no reliable automatic
   verifier exists — should be Foreman's stance on its own metrics.

This is exactly Karpathy §VIII-B ("A ratchet improves the metric it can see") with
measured backing.

### 3.3 Verification-first practices

**Mutation-guided strengthening is the highest-yield verification primitive found.**
STING (INFERRED, via search synthesis of the mutation-guided line of work): **77% of
instances contain at least one surviving variant**; 1,014 validated tests across 211
instances; patch-region line/branch coverage **+10.8% / +9.5%**; and re-assessing the
top-10 repair agents with strengthened suites **lowers resolved rates by 4.2–9.0 pp**.
SWE-ABS (VERIFIED) is the same lesson at benchmark scale: **19.71% of passing patches
rejected**, top agent −16.6 pp. Meta's ACH (INFERRED) generates *few, targeted* mutants
aimed at a specific concern rather than blanket mutation — the practical shape.
Implication for Foreman: **"the tests pass" is a weak evidence contract.** A mutation
probe scoped to the diff's changed lines is a cheap, deterministic upgrade to the gate.

**Property-based testing is a distinct, partially-present capability.** PBT-Bench (arXiv
2605.15229, 2026-05, VERIFIED): 100 problems over 40 real Python libraries, 365 injected
bugs (3.65/problem), three difficulty tiers. Bug recall **42.1–83.4%** with structured
prompting vs **31.4–76.7%** open-ended. Explicit Hypothesis scaffolding lifted mid-tier
models **>20 pp**, but strong models gained little and **two cases degraded** — the
structured prompt can interfere. Key framing: PBT isolates "reading documentation to
identify semantic invariants, then crafting input-generation strategies" — and *bug
exposure and repair are distinct skills*. For Foreman: PBT is a good **auditor** tool
(expose), not necessarily an implementer tool.

**Countervailing evidence — do not just add more test ceremony.** *Rethinking the Value of
Agent-Generated Tests* (arXiv 2602.07900, 2026-02, VERIFIED): across six strong models on
SWE-bench Verified, **resolved and unresolved tasks show similar test-writing
frequencies**; agent-written tests function mostly as observational feedback (print
statements substantially outnumber assertions); and **prompt interventions that encouraged
or discouraged test writing across four models produced minimal effect on outcomes**.
Conclusion: current agent test-writing "primarily alter[s] the development workflow and
increase[s] computational expense rather than meaningfully enhanc[ing] the ultimate
success rate." So: verification value comes from **externally-imposed, adversarial
verification** (mutation, PBT, deterministic host-side checks), not from asking the worker
to write more tests. Foreman's host-side `checks-run.sh` + cold-diff audit is on the right
side of this line; a "worker must write tests" spec clause would be on the wrong side.

**Deterministic replay** (INFERRED, §2.4): record model outputs as the irreducible
nondeterministic input; re-execute deterministic glue. Recorded runs convert directly into
regression tests. This is the enabling primitive for the harness in §5 below.

**Sandbox escalation** (INFERRED): 2026 baseline is non-root container + default-deny
egress with a narrow allowlist + read-only mounts + hard timeouts + ephemeral containers,
with agent-config files (`~/.bashrc`, `~/.gitconfig`, agent config) made read-only inside
the sandbox to block the most common persistence mechanism. **Foreman v0.2.8's container
profile already implements essentially all of this** (root-applied default-deny v4+v6
firewall a `gosu`-dropped worker cannot flush, `--read-only` + tmpfs, no docker.sock, no
host secrets). The gap versus SOTA is *escalation*: the profile is chosen statically
(`hard_mode.profile`), not raised per risk class.

### 3.4 Routing work across heterogeneous models by task class

**SWE-Router** (arXiv 2607.00053, 2026-06-30, VERIFIED abstract) is the most relevant
result and it contains a warning aimed directly at Foreman's planned routing table:

> "Existing LLM routers operate on the task description alone, which inherits an
> **information-theoretic Bayes-error floor** in agentic settings: a similar issue can hide
> either a localized typo or a multi-module refactor, and the prompt does not separate the
> two."

Their answer is **value-based temporal routing**: let a cheap model run a few exploratory
turns, read the resulting *partial trajectory*, then decide whether to continue cheap or
escalate. They prove a Bayes-optimality theorem that conditioning on the partial trajectory
**never harms** routing and is strictly better whenever exploration is informative, and
report that this "greatly improves the cost efficiency of SWE tasks, while maintaining the
majority of the performances of the stronger model." **The magnitude is not in the abstract
and was not extractable from the PDF — treat the direction as verified, the size as
unknown.** They also release a multi-LLM trajectory dataset.

This is a direct critique of v0.4.0's planned "config-driven risk-class → (model, effort,
scope) routing table," which routes on a *static description of the change*. The evidence
says a static prior-based router has a hard error floor that no amount of table tuning
removes. The fix is cheap and fits Foreman's existing shape: route the *first* attempt to
the cheap lane, and let the **event log's first-N-events trajectory** (files touched, test
outcomes, empty-burst signal, diff size) drive an **escalation decision** rather than an
up-front assignment. Foreman already has the trajectory substrate; it just doesn't read it
as a routing signal.

Supporting (INFERRED, search synthesis): RouteLLM-class results of ~85% cost savings at
95% of GPT-4 quality; 40% fewer strong-model calls at <5% quality degradation; ~430ms
difficulty classification with 40–70% cost savings and <2% quality loss on hard coding
tasks. These are consistent in direction but I could not verify the numbers; the
RouteJudge (arXiv 2606.18774) and LLMRouter (ulab-uiuc) projects exist as reproducible
platforms if the team wants to verify.

**And the counterweight from HAL** (VERIFIED): *"higher reasoning effort reduc[es] accuracy
in the majority of runs."* This independently supports v0.4.0's "effort xhigh→high" lever
being the largest single win — the effort dial is not monotone in quality, so cutting it
is not a pure cost-for-quality trade.

---

## 4. Proposed Foreman metrics set

Design rules, taken from Table III and Table VI:
- Every metric ships with **its own common misreading** and **the companion number that
  detects the misread**. A metric without a companion is a metric that will be gamed.
- Nothing is reported as a bare average. Tail (p90) and catastrophic-case counts are
  mandatory — Table III, Operations row: *"Average success hides catastrophic cases."*
- Metrics are recorded to the **existing `events.jsonl` schema v2 payload** (additive, no
  signature migration) plus one `metrics.json` rollup per run — the "evaluation plane"
  stays separate from the workflow plane, per §VI of the source.
- **Every release declares a budget before the round starts** (max model calls, max
  sub-agents, max concurrent workers, max tool calls, max wall clock, max tokens, max USD,
  max retries, minimum evidence) and records consumed-vs-declared — Karpathy §VIII-B.

### 4.1 Core eight (record every round; report every release)

| # | Metric | Definition | Common misreading | Companion number that detects it |
|---|---|---|---|---|
| M1 | **First-pass gate rate (FPGR)** | fraction of specs whose *first* worker attempt closes the merge gate green with zero architect edits | "workers got better" — when in fact specs got smaller or the architect pre-solved the problem | median spec diff size (LOC + files touched) and **architect-authored share of merged lines** |
| M2 | **Rounds-to-green** | attempts per spec until gate green; report **p50 and p90 and the abandoned-spec count** | p50 improves while the tail explodes | p90 / p50 ratio; count of specs closed by architect takeover |
| M3 | **Cost per merged change (USD and tokens)** | all lanes, *including failed attempts, audits, advisor calls and re-audits*, divided by merged changes | falls because the architect quietly did the work outside the lanes | M1's architect-authored share; tokens-per-merged-line |
| M4 | **Wall clock per round, split by phase** | queue-wait / implement / audit / gate / merge; p50 and p90 | median improves via parallelism while cost per round rises | M3 recorded on the same rounds; concurrent-lane count |
| M5 | **Unique-catch rate of the cross-vendor auditor** | fraction of gate-blocking findings that **only** the cross-vendor auditor produced (not found by `checks-run.sh`, not found by the architect) | reads as "the auditor is valuable" when the auditor is merely verbose | count of BLOCKED verdicts overturned by the architect (blocking-verdict precision); deterministic-check catch rate on the same diffs |
| M6 | **Escaped-defect rate** | defects discovered *after* merge, per 1,000 merged diff lines, within a fixed 14-day detection window | falls because nobody was looking | detection-window compliance; `bugeventlog.md` entries per release; count of rounds with zero post-merge exercise |
| M7 | **Lane mortality per 100 lane-starts** | stalls + watchdog kills + empty bursts + `launcher_absent` degrades + ownership timeouts | falls because lanes got shorter | mean lane duration; M2 (work displaced into more, shorter attempts) |
| M8 | **Evidence completeness** | fraction of merged changes whose run dir has *all* of `meta.json`, `hashes.txt`, `checks-result.json`, `audit-verdict.json`, spec ref, cost record, and predicted-effect record | 100% because the gate only checks presence, not content | schema-validity rate of each artifact; spot-audit of 3 random runs per release |

M5 is the metric that decides whether multi-vendor pays for itself. It is the single most
important number in this document (see §5). Today Foreman cannot compute it.

### 4.2 Extended set (record; report when investigating)

| # | Metric | Misreading | Companion |
|---|---|---|---|
| M9 | **Audit verdict distribution** (APPROVED / WARNING / BLOCKED) | a high APPROVED share means workers are good — it usually means the judge is lenient or self-preferring | mutation-probe survival rate on APPROVED diffs (§4.3) |
| M10 | **Auditor↔architect agreement (Cohen's κ)** on a sampled subset | agreement = correctness | disagreement resolution outcomes; the r≈0.77 correlation caveat (§5) |
| M11 | **Deterministic-check flake rate** — same commit, `checks-run.sh` disagreeing across runs | zero flake means the checks are good — may mean the checks are trivial | check coverage of the diff's changed lines |
| M12 | **Budget consumed / declared**, and budget-exhaustion rate | under-budget looks efficient; it can mean the round stopped early and hid partial failure | count of rounds returning a partial artifact with a stated stop reason (§VIII-B requires this) |
| M13 | **Resume success rate** — interrupted rounds resumed from checkpoint without restart | high because interruptions were rare | interruption count; time-to-resume |
| M14 | **Prediction-hold rate** — fraction of spec/edit predicted-effect claims that held next round (from 2604.25850's decision observability) | high because predictions were vacuous | predicted-regression set size; count of non-trivial predictions |
| M15 | **Spec-regeneration divergence** (optional, Tessl-inspired) — behavioral delta when a spec is re-implemented from scratch | low divergence = good spec; can mean the spec leaked the implementation | spec length vs diff size |

### 4.3 New signals Foreman must start emitting to make the above computable

All additive to the existing `events.jsonl` schema v2 payload (top-level shape stays
frozen, per `lib/eventlog.sh`):
- `payload.usage = {model, input_tokens, output_tokens, cached_tokens, cost_usd, effort}`
  on every lane-completion and audit-completion event. **This does not exist today** and is
  the single biggest telemetry gap — M3, M4, M12 and every cost-matched comparison in §5
  are uncomputable without it.
- `payload.spec = {id, five_part_hash, diff_loc, files_touched, risk_class}` at round start.
- `payload.finding = {id, source: checks|audit|architect, severity, upheld: bool}` — one
  event per gate-blocking finding. This is what makes M5 and M9 computable.
- `payload.prediction = {predicted_fix[], predicted_regression[]}` at spec authoring, and
  `payload.prediction_outcome` at the following round (M14).
- A per-run `metrics.json` rollup written by `gate-eval.sh`, and a per-release
  `docs/metrics/<tag>.json` aggregate committed with the tag.
- A **mutation probe** in `checks-run.sh`: generate a small number of targeted mutants
  restricted to the diff's changed lines (Meta-ACH style: few, targeted, not blanket) and
  record `mutants_killed / mutants_generated`. Justified by SWE-ABS's 19.71% patch-rejection
  rate (VERIFIED) — "tests pass" is not evidence.

---

## 5. Proposed regression harness for the orchestration layer

The design target is the inverse of every benchmark in §2.1: **hold the models fixed, vary
Foreman, and attribute the delta to Foreman.** Four tiers, cheapest first. Tiers 0 and 1
are the actual proposal; 2 and 3 are periodic.

### Tier 0 — no-LLM, per-slice, baseline-locked scaffold suite (CI, every commit)

Directly modeled on *Layer-Isolated Evaluation* (arXiv 2606.11686, VERIFIED), which is the
closest published analogue: **238 deterministic cases across 23 assertion slices, 225 of
which run in 2.39 s (~10 ms/case), with no LLM call**, gated in CI against **locked
per-slice baselines**.

Foreman already has most of the raw material — **35 bats files / 359 tests** covering
eventlog, checkpoint, resume, watch, lane-queue, lane-run, launcher, gate-eval, merge-gate,
git-guards, worktree lifecycle, vendor isolation, worker-cmd, pr-open. Three additions
convert it from a test suite into a regression harness:

1. **Slice the suite and lock a per-slice baseline.** Proposed slices, one per orchestration
   layer: `spec-parse`, `worktree`, `admission/queue`, `launcher/cascade`, `eventlog/replay`,
   `checkpoint/resume`, `watchdog-state-machine`, `evidence-collect`, `audit-call
   vendor≠worker invariant`, `gate-eval verdict truth table`, `merge-freshness`,
   `cleanup/reap`, `config-resolution`, `vendor-isolation`. Store the locked baseline in
   the repo; CI fails on any slice dropping below its lock, not on the aggregate.
   The measured justification: in 2606.11686, six injected local regressions moved the
   **aggregate pass rate by only −1.7 to −5.9 pp** while **the owning slice dropped
   −25 to −91 pp**. An aggregate gate would have missed all six.
2. **Coverage-honesty rule**: refuse to score any slice with zero exercised assertions.
   (2606.11686's criterion, VERIFIED.) This is the guard against a slice silently going
   dark when a script is refactored — a live risk in Foreman given the CRLF/exec-bit class
   of failures already logged for v0.2.9.
3. **Regression-injection self-test**, run once per release: mutate one scaffold file,
   assert the owning slice ranks worst. 2606.11686's harness achieved **mean rank 1.29,
   worst-of-19 in 5 of 7 injections, top-3 in all seven**. That is the number Foreman
   should target and report — it is a measurement of *the harness's own* diagnostic power.

Cost: seconds, $0, deterministic. This is the merge gate.

### Tier 1 — recorded-vendor replay corpus (per release, deterministic, ~$0)

The missing capability today is that Foreman cannot run a full round without spending
vendor money and accepting nondeterminism. Fix with record-replay discipline (§3.3):

- Add a `FOREMAN_VENDOR_REPLAY=<dir>` mode to `lib/worker-cmd.sh` / `adapters/*` that
  replays recorded stdout/exit-code/file-writes for a lane instead of calling the vendor
  CLI. The model call is treated as the one irreducible nondeterministic input and is
  recorded; all Foreman glue re-executes deterministically.
- Freeze a **golden-round corpus** of 10–12 rounds against a small fixture repo, captured
  from real runs, and *deliberately including the pathological ones*: an empty grok burst,
  a BLOCKED audit that the architect overturns, a stalled lane the watchdog kills, a
  merge-freshness conflict, a dirty-resume refusal, a live-target worktree refusal, a
  worker that writes outside the worktree. Each of Foreman's own logged field failures
  (F1–F6, plus the four v0.2.8.1 external-run failures) becomes one frozen round.
- Assert on the **decision trace**, not the prose: the sequence of event types, the gate
  verdict, the artifacts produced, the state-machine path. This is the orchestration
  layer's actual contract.
- **Every new `bugeventlog.md` entry must add a replay round.** That makes the corpus grow
  with the failure surface rather than with the feature surface.

This is the tier that makes M5/M9-style questions answerable offline: swap the recorded
auditor transcript for a different vendor's recorded transcript on the same diff, and the
unique-catch rate falls out with zero new spend.

### Tier 2 — live canary, N=3, cost-capped (per release)

Locked task set, following the Harness Effect design (**22 locked evaluation tasks**,
models and judges fixed, only the orchestration layer varies — VERIFIED). Foreman's version:

- **8–12 locked specs** against a fixture repo, with **seeded defect classes** in the
  "audit should catch this" set: off-by-one, missing null/error check, swallowed exception,
  wrong error type, API contract break, resource leak, injection-shaped string handling,
  and one perf regression. These are the ground truth for auditor precision/recall.
- **Pinned model versions**, recorded in the release metrics file. A model version change
  invalidates the baseline and must be re-baselined, not compared across.
- **N=3 repeats**, report mean with a **percentile bootstrap CI**. Do not claim an
  improvement smaller than the run-to-run σ. Published agent-benchmark σ lands ~1.5–2.7 pp
  with 3-run CI half-widths ~2.7–4.9 pp (INFERRED) — measure Foreman's own σ on the first
  release and use that, not the literature's.
- **Declared budget** before the run (Karpathy §VIII-B): max USD, max wall clock, max
  retries. Report consumed/declared (M12).

### Tier 3 — external sanity anchor (per major release, optional)

~50 tasks of **SWE-bench Pro public split** once per major release, reported with CIs and
explicitly *not* a gate. Rationale for Pro over Verified is OpenAI's own (VERIFIED,
2026-02-23). Do **not** adopt SWE-bench Verified: 59.4% flawed tests in the audited failing
subset, universal gold-patch reproducibility, and a 19.71% patch-rejection rate under
adversarial strengthening. Budget expectation: even the 50-task Verified *Mini* cost
$259.20 with a cheap model (INFERRED) — assume low-hundreds-of-dollars per anchor run and
schedule accordingly.

### The ratchet rule that binds it together

Adopt the autoresearch discipline explicitly, in `ROADMAP.md` and in the merge gate:

> An orchestration change is kept only if the Tier-0/Tier-1 harness improves or holds at
> equal-or-lower cost, measured on the locked baseline. A regression reverts. A lateral
> move at lower cost is kept. A lateral move at higher cost reverts.

With three anti-gaming guards, all with measured backing (2607.12790, VERIFIED):
- **Anchor discipline** — a frozen anchor set the metric is validated against; removing
  anchors "collapses the metric into a vacuous detector."
- **An independent auditor of the metric itself** — in their study, evolved skills *did*
  game the rubric and an independent judge caught it.
- **Failure-expecting by default** — assume the metric is being gamed and design to catch
  it, rather than assuming metric stability.

Plus Karpathy §VIII-B's own warning: a ratchet improves the metric it can see, so retain
explicit constraints on the things it cannot see — here, cost per merged change (M3),
escaped defects (M6), and evidence completeness (M8) are the constraint set that must not
degrade while FPGR (M1) is being optimized.

---

## 6. Evidence AGAINST the planned direction (steelman)

I was asked to actively seek disconfirming evidence. This is the strongest case against
Foreman's multi-vendor + graph direction that the literature supports. It is stated
without hedging.

### 6.1 The cross-vendor independence premise is substantially false

This is the sharpest finding in the lane and it attacks Foreman's core design claim.

- **"Nine Judges, Two Effective Votes"** (arXiv 2605.29800, 2026-05, VERIFIED): a panel of
  **9 frontier LLMs across 7 model families behaves as ~2 genuinely independent votes.**
  *"Roughly three-quarters of the panel's nominal independence is lost because the models
  make the same mistakes on the same items."* **Individual top models matched or exceeded
  the full panel's accuracy.** The gap between actual panel performance and the
  independent-voting ideal was **8–22 pp**, and scaling to more judges or using
  sophisticated aggregation closed **at most 11%** of that deficit.
- **Behavioral entanglement** (arXiv 2604.07650, 2026-04-08, VERIFIED): 18 LLMs across six
  families show "correlated reasoning patterns and synchronized failures" that
  "undermine systems relying on model independence, such as ensemble verification
  pipelines." Their Cumulative Information Gain correlates with judge-precision
  degradation at Spearman **0.64–0.71** — i.e. the more entangled the models, the more the
  judge over-endorses. De-entangled reweighting buys at most **+4.5%** over majority voting.
- Corroborating (INFERRED, not verified): pairwise error correlation between top frontier
  models around **r = 0.77** (~60% of error variance shared), such that **three models from
  three different providers behave as ~1.3 independent models**; 3- and 5-version ensembles
  realize only **0.43 and 0.44** of the reliability gain independence would predict. Causes
  named: shared Common Crawl-derived pretraining data, benchmark contamination, shared
  architecture and alignment paradigms.
- Karpathy's own text says the same thing without numbers (§VIII-D): *"Parallel workers
  also create correlated errors. A verification wave helps only if reviewers have a
  different prompt, evidence set, or role."*

**The honest reading for Foreman.** "Cross-vendor" is not the property that buys
independence — *different evidence set and different role* is, and Foreman's cold-diff
audit does deliver both (the auditor sees the diff and the spec, not the implementer's
trace and reasoning). That is a real and defensible decorrelation mechanism, and it is
notably *stronger* than the judge-panel setups these papers audited, which all judged the
same artifact from the same vantage point. But the *marginal* value of adding a **fourth
vendor** on top of an existing cross-vendor pair is, on this evidence, close to zero unless
it is bought for capability or cost reasons rather than for independence. Foreman is about
to have 4 vendors; the independence argument justifies roughly 2.

**Actionable consequence:** M5 (unique-catch rate) must be measured per vendor pair before
the 4-vendor expansion is justified on quality grounds. If vendor D's unique-catch rate
over the existing pair is below ~5%, it is a cost/capability/availability lane, not a
quality lane, and should be documented as such.

### 6.2 The multi-agent premise itself is under sustained attack

- **10× cost, no gain** for automatically-designed MAS vs CoT-SC (2606.13003, VERIFIED).
  Mitigating: expert-architected MAS *did* beat auto-MAS on both performance and
  cost-efficiency in the same paper. Foreman is expert-architected. But the paper's
  methodological charge — that evaluations *"mask critical architectural gaps … by failing
  to account for the marginal utility of increased computational cost"* — applies to
  Foreman verbatim, because Foreman has never run a cost-matched single-agent baseline.
- **Anthropic** (VERIFIED): 15× tokens; token usage alone explains 80% of performance
  variance; and coding specifically has "fewer truly parallelizable tasks than research."
  The 90.2% multi-agent win was on research, not code.
- **Cognition** (VERIFIED): don't do it for coding; share full traces. Foreman's cold-diff
  audit deliberately violates the "share full traces" principle. That is a defensible
  trade (independence vs context) but it is a trade, and Cognition's failure mode —
  conflicting implicit decisions — is exactly what a cold auditor cannot see.
- **MAST** (VERIFIED): 14 failure modes, κ=0.88, 1,600+ traces, and *"performance gains on
  popular benchmarks are often minimal."* No measured fixes.

**The strongest form of the objection:** the honest null hypothesis for vNext is *"one
strong model, one long-context session, host-side deterministic checks, and a merge gate"*
— and Foreman has never measured itself against it. Tier 2 of the harness (§5) should
include that baseline as a locked arm.

### 6.3 The knowledge-graph direction is the weakest-supported part of the plan

- Karpathy §VIII-C is himself the primary skeptic: *"Do not introduce a knowledge graph
  merely because the system has agents"* — unnecessary when tasks are independent, no
  cross-session state is required, answers depend on one document, or relations are fixed
  and simple. Foreman rounds are largely independent, and a round's answer usually depends
  on one spec plus one diff.
- Table III's graph row: *"One component is not always desirable"*; resolution: *"Compression
  alone rewards over-merging."* A graph metric that looks like it is improving can be a
  false-merge machine.
- Market evidence (INFERRED): GraphRAG carries a real one-time construction cost plus
  ongoing maintenance and "earns its place only when a measurable fraction of your actual
  query traffic is asking questions a similarity search structurally cannot answer";
  Microsoft GraphRAG cost ~$33K to index large corpora in 2024, with LazyGraphRAG cutting
  index cost to ~0.1% and query cost ~700× for global queries. The advice is uniformly:
  **audit your query distribution before building graph infrastructure.**
- Foreman already has `graphify-out/` in the repo — so the cheap experiment is available:
  **census the architect's actual queries over one release** and classify them into
  (a) point lookup, (b) single-document, (c) genuine multi-hop across runs/specs/defects.
  If (c) is a small share, the graph is Table VI's "activity without progress."

Where a graph *does* have a defensible case for Foreman: cross-session, cross-release
provenance — linking Spec → AgentRun → Artifact → Evaluation → Commit → Metric → bugevent,
so that "which spec pattern produces the most escaped defects" is a query rather than an
archaeology project. That is the §VIII-A question 5 case ("must facts survive the run"),
and it is the *only* one I would fund on this evidence.

### 6.4 Two more inconvenient results

- **HAL** (VERIFIED): *"higher reasoning effort reduc[es] accuracy in the majority of
  runs."* Foreman's audit lane defaults toward high/xhigh effort. This says the default is
  possibly *both* slower and worse. It supports v0.4.0's effort-reduction lever — but it
  also means effort should be a measured dial with a locked baseline, not a doctrine.
- **Agent-generated tests don't move outcomes** (2602.07900, VERIFIED). Any vNext proposal
  that adds process ceremony to the worker's job ("write tests first", "explain your
  reasoning", "self-review") should be assumed ineffective until measured. The measured
  wins in this literature come from *external* adversarial verification (mutation, PBT,
  host-side checks) and from *harness* changes (2604.25850's ablation: gains came from
  tools, middleware and memory — **not system prompts**).

---

## 7. Open questions

1. **What is Foreman's own run-to-run σ?** Every claim of improvement is meaningless until
   this is measured on the Tier-2 canary. First release should spend its budget measuring
   σ rather than measuring an improvement.
2. **What is the unique-catch rate of the cross-vendor auditor today?** Nothing in the
   current gate records findings as first-class objects, so this is unknown. It is the
   number the whole cross-vendor thesis rests on.
3. **Cost-matched single-agent baseline:** does Foreman beat "one strong model + host-side
   checks + merge gate" at equal dollars on the locked spec set? Unmeasured. 2606.13003
   says most systems that never ask this question are wrong.
4. **Does vendor #4 add independent signal, or only capacity?** Measure pairwise
   unique-catch before expanding, not after.
5. **Trajectory-conditioned escalation vs static risk-class routing:** SWE-Router's
   Bayes-error-floor argument says v0.4.0's static routing table has a ceiling. Is the
   first-N-events escalation trigger cheap enough to be worth the plumbing? The magnitude
   of the win is unverified.
6. **Does the cold-diff audit's information deficit cost more than its independence buys?**
   Cognition says share full traces; the entanglement literature says don't. A/B this on
   the replay corpus by giving the auditor the full trace on half the rounds.
7. **Mutation probe scope and budget:** how many targeted mutants per diff before the gate
   latency becomes unacceptable? Meta's ACH suggests "few and targeted," not blanket.
8. **Spec-regeneration equivalence (Tessl-style):** is it computable cheaply enough to serve
   as a spec-quality metric, or is it a second full implementation per spec?
9. **Graph query census:** what fraction of architect queries are genuinely multi-hop
   across runs? Do the census before funding the graph.
10. **Who audits the metric?** Per 2607.12790, the metrics in §4 will be gamed. Which
    independent lane owns checking that FPGR is not rising because specs are shrinking?
11. **Model-version invalidation policy:** every pinned model bump invalidates every locked
    baseline. What is the re-baseline procedure, and who pays for it?
12. **What does Foreman do when the budget is exhausted mid-round?** §VIII-B requires
    returning the best current artifact, completed work, unresolved issues, and a reason —
    "do not hide partial failure behind a fluent final answer." Foreman has `round_done` but
    no partial-artifact contract.
