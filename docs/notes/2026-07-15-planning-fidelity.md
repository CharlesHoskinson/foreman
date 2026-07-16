# Planning fidelity — thoughts + a prompt to run after the next release

Status: notes / not a spec yet. Run the prompt at the bottom through Foreman
(soft mode) once durable-lanes ships, to turn these into a real design + plan.

## Why (grounded in the durable-lanes build, 2026-07-15)

Nearly all the time lost building durable-lanes went to one failure mode: **the
plan's code blocks were wrong, and we only discovered it at implementation time,
one expensive task at a time.** `el_emit` took five cross-vendor audit rounds to
converge; the plan I wrote had real defects in three of three components. The
audit loop caught them — but late, and per-task. The lesson: the plan is a
template copied verbatim by workers, so a bug in the plan is a bug multiplied
across every task that copies it. Move discovery earlier and make the plan
itself less bug-prone.

## Stubbed ideas (ranked by leverage)

1. **Plan-time audit (biggest lever).** Before any worker touches a task,
   cross-vendor cold-audit the plan's code blocks and test contracts against the
   bug-class checklist. Catch each bug once, at the plan, not N times during
   implementation. We already proved the mechanism (the reactive deep-audit of
   the durable-lanes plan) — formalize it as a stage / a `foreman-plan-auditor`
   lane.

2. **Interfaces-and-tests-first plans.** Stop authoring full implementations in
   the plan (that is the architect doing implementation work at plan time and
   getting it wrong, then propagating it). Specify exact interface signatures +
   the failing tests that define correctness + constraints; let the worker write
   code to pass the tests. The tests become the audited contract. Keep
   architect-authored code only for high-variance artifacts (e.g. diagrams).

3. **Risk-tagged tasks + adaptive audit depth.** Tag each task
   (mechanical / spec-determined / correctness-critical / security-sensitive);
   scale routing and adversarial audit rounds to the risk. Concurrency /
   crash-safety / crypto get prototype-first + multi-vote audit; a config edit
   gets a single pass. Sets honest expectations up front.

4. **Decomposition-completeness critic.** A judge that reviews the decomposition
   itself before the plan locks — "what task is implied but absent, what
   dependency is unstated, what boundary is wrong?" (Task 0, the environment
   step, only existed because the user caught it.)

Hold off for now (speculative): graph-informed planning (derive file sets/risk
from the knowledge graph); a full N-way decomposition judge panel — revisit once
decomposition itself has visibly failed more than once.

Single highest-value combo for a first cut: **#1 married to #2** — audit the
plan's test contracts before implementation, and make those contracts (not
architect-written code) the thing workers implement against. Attacks the root
cause: the plan as a vector for the architect's own mistakes.

## The prompt (paste into a Foreman soft-mode session)

```text
Soft mode. Design and plan an enhancement to Foreman's PLANNING fidelity and
capabilities. Goal: make plans catch their own defects before implementation and
stop propagating architect mistakes to workers. Do not implement yet — produce a
design doc and an implementation plan.

Grounding: read docs/notes/2026-07-15-planning-fidelity.md (the thoughts above)
and the current planning surface — skills/foreman/references/five-part-spec.md,
the writing-plans doctrine, and docs/superpowers/plans/2026-07-15-durable-lanes.md
(note its "Portability & correctness checklist" and the pass-count/back-ported
fixes — evidence of what plan-time bugs cost).

Research (comprehensive; use scrapling + parallel research agents, synthesize,
keep conclusions not dumps):
- State of the art in planning for AI coding agents (2025-2026): plan-then-execute
  vs ReAct, plan verification/critique, self-refine/reflexion on plans, tree/graph
  planning, LLM-as-judge for plan quality.
- Spec-driven development frameworks and what they do for plan fidelity: OpenSpec
  (already vendored conventions), GitHub spec-kit, Kiro, Amazon/Anthropic agent
  planning guidance, EARS requirements. Extract concrete mechanisms, not marketing.
- Test-first / contract-first planning: tests as the executable spec; property-based
  and adversarial test generation; how to make a plan's tests the audited artifact.
- Decomposition quality: task-boundary heuristics, dependency inference,
  completeness/"what's missing" critics, risk classification and routing.

Examine the vendored superpowers skill in depth (skills/superpowers/): its
planning-related skills — brainstorming, writing-plans, executing-plans,
subagent-driven-development, writing-skills, verification-before-completion.
For each: what it does well, what it lacks for high-fidelity planning, and what
Foreman should adopt, adapt, or deliberately diverge from. Be specific and cite
the skill files.

Deliverables:
1. A design doc (docs/superpowers/specs/) proposing the planning enhancements —
   at minimum evaluate: plan-time cross-vendor audit as a first-class stage;
   interfaces-and-tests-first plans (contracts over architect-authored code);
   risk-tagged tasks with adaptive audit depth; a decomposition-completeness
   critic. For each, the mechanism, how it wires into the existing soft/hard
   loop and the five-part spec, cost, and honest limits.
2. A ranked recommendation with the single highest-value combination to build
   first, and the crossover points that would justify the ones you defer.
3. An implementation plan (docs/superpowers/plans/) built from the design,
   following the durable-lanes plan's own hardened conventions (bug-class
   checklist, tests-first, exact interfaces).

Process: consult foreman-advisor before locking the information architecture of
the enhancement and before declaring the design done. Route research to parallel
agents; route any implementation specs to grok-implementer / codex-implementer;
cross-vendor audit every changeset (codex-auditor for Grok work, Grok for Codex
work). This effort should DOGFOOD the very planning improvements it designs where
possible — if plan-time audit is the recommendation, run this plan through a
plan-time audit before building it.
```
