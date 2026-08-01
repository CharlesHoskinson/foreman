# Change: foreman-discover-lane

## Why

Operator feedback from a real run (reverse-engineering a live ZK SDK +
indexer) showed that foreman's binary route (grok, or keep with the
architect) has no lane for exploratory work — work where the spec can't be
finished because the required knowledge does not exist yet (an undocumented
API's real behavior, discoverable only against a live system). Today that
work falls into "keep with architect," which does BOTH the empirical
discovery AND the implementation in the expensive lane.
`docs/superpowers/specs/2026-07-19-empirical-workloads-design.md` (C2) names
the missing lane: `foreman-search` (read-only recon) and `foreman-plan`
(codebase planning) already exist, but neither MAY execute empirical probes
against a live system, and neither is spec-producing.

## What changes

- New `agents/foreman-discover.md`: a first-class, bounded, empirical
  investigation lane, top-Claude tier (Fable/Opus) — discovery is
  high-judgment; grok is explicitly NOT eligible for it. Worktree-isolated
  like `foreman-search`/`foreman-plan`, but unlike read-only search it MAY
  execute empirical probes (Bash/network) against the live system; it NEVER
  writes product code — its writes are `captured-facts.md` + determined
  sub-specs into the worktree report.
- Budgeted: a declared discovery budget (max probe iterations / token cap /
  wall-clock), self-reported by the agent, not coded-enforced — a Claude
  agent cannot hard-enforce its own turn budget the way `lane-run.sh`'s coded
  timeout/kill can. On budget exhaustion WITHOUT convergence, the agent is
  instructed to stop and report `verdict: partial` with the captured facts so
  far + the remaining unknowns; this is an advisory self-report, not a
  coded guarantee against looping.
- Convergence exit criterion: the unknowns are resolved into concrete,
  testable facts sufficient to write a `determined` implementation spec (the
  spec-triage gate would now pass). Verdict: `converged | partial`.
- New `skills/foreman/references/discovery.md`: the doctrine — when to route
  to discovery (spec-triage refused), the budget contract, the convergence
  criterion, that discovery output feeds the C4 re-triage, and that
  discovery is the EXPENSIVE lane BY DESIGN.
- `SKILL.md`'s routing table gains an Exploratory row (Producer: top Claude ·
  Invoke: `foreman-discover` · Route when: spec-triage refuses), and the
  deciding rule is updated to distinguish "judgment the spec can't capture
  YET (discover it)" from "irreducible judgment (keep with architect)".

## Impact

- Affected: new `agents/foreman-discover.md`, new
  `skills/foreman/references/discovery.md`, `skills/foreman/SKILL.md`
  (routing table + deciding rule).
- No change to grok-multiround / the empty-burst detector, or to
  `foreman-search`/`foreman-plan`'s existing read-only contracts.
