# Spec delta — foreman-discover lane

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirements

### Requirement: foreman-discover is a bounded top-model empirical lane that emits facts + determined sub-specs, never product code

`agents/foreman-discover.md` SHALL define a top-Claude-tier (Fable/Opus),
worktree-isolated agent that, given a DISCOVERY BRIEF (the unknowns, the
live system to probe, the convergence goal), MAY execute empirical probes
(Bash/network) against the live system, and SHALL NEVER write product
code — its only writes SHALL be `captured-facts.md` and determined
five-part sub-specs into its worktree report. This "never writes product
code" bound IS enforceable (by the agent's role/tools), unlike the budget
below.

- The agent SHALL be bounded by a declared discovery budget (max probe
  iterations / token cap / wall-clock), stated in the DISCOVERY BRIEF. This
  budget is an ADVISORY SELF-REPORT, not a coded enforcement: a Claude agent
  cannot hard-enforce its own turn budget the way `lane-run.sh`'s coded
  timeout/kill can for a coded lane. `agents/foreman-discover.md` SHALL state
  this plainly rather than presenting the budget as a guarantee.
- The agent's report SHALL follow the shape `DISCOVERY REPORT / VERDICT:
  converged|partial / CAPTURED_FACTS: <path> / SUB_SPECS: <n determined
  five-part specs> / REMAINING: ...`.

#### Scenario: discovery converges and emits facts + sub-specs, no product code

- WHEN `foreman-discover` is given a DISCOVERY BRIEF naming the unresolved
  live-API unknowns
- AND it probes the live system within budget and resolves the unknowns to
  concrete, testable facts
- THEN it emits `captured-facts.md` and one or more determined five-part
  sub-specs into its worktree report
- AND no product code file is created or modified by the discovery lane.

### Requirement: on budget exhaustion, foreman-discover self-reports partial with remaining unknowns (advisory, not coded enforcement)

IF the declared discovery budget (probe iterations / token cap /
wall-clock) is exhausted BEFORE convergence, THEN `foreman-discover` is
instructed to report `verdict: partial` with the facts captured so far and
the remaining unknowns, and to stop probing beyond the budget. This is an
ADVISORY SELF-REPORT: the agent-def instructs the stop-on-exhaustion
behavior, but nothing coded hard-kills the agent the way `lane-run.sh`'s
coded timeout/kill does for a coded lane — a Claude agent cannot
hard-enforce its own turn budget. The doctrine (`discovery.md`) SHALL state
this limit plainly rather than claiming the budget "never loops forever."

- The convergence exit criterion IS enforceable and SHALL be: the unknowns
  are resolved into concrete, testable facts sufficient to write a
  `determined` implementation spec — operationalized as the emitted
  sub-specs must pass the `spec-triage-gate` package's gate. Nothing reaches
  grok until that gate admits it, regardless of the budget's advisory
  nature.

#### Scenario: budget exhausts before convergence

- WHEN `foreman-discover`'s declared budget (e.g. max probe iterations) is
  reached and the unknowns are not yet resolved to concrete testable facts
- THEN it reports `DISCOVERY REPORT / VERDICT: partial` naming the facts
  captured so far and the remaining unknowns
- AND this stop-on-exhaustion behavior is the agent's self-report per its
  instructions, not a coded kill enforced against it.

### Requirement: grok is not eligible for discovery

Discovery SHALL run only on a top-Claude-tier model (Fable/Opus). Grok (and
any non-top-Claude vendor) SHALL NOT be an eligible discovery-lane
implementer.

- This SHALL be stated explicitly in `agents/foreman-discover.md`'s
  frontmatter (`model: opus`) and in `skills/foreman/references/
  discovery.md`'s doctrine, consistent with foreman's existing judgment-lane
  doctrine (`SKILL.md`'s Judgment lane is top Claude only, never
  implements).

#### Scenario: a discovery brief is never routed to grok

- WHEN an architect has a spec-triage refusal (an under-determined spec) to
  resolve
- THEN the architect routes the DISCOVERY BRIEF to `foreman-discover`
  (top-Claude tier)
- AND grok is never dispatched to perform the discovery itself.
