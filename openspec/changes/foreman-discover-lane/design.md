# Design — foreman-discover-lane

Parent design:
`docs/superpowers/specs/2026-07-19-empirical-workloads-design.md` (C2).
Parent plan: `docs/superpowers/plans/2026-07-19-empirical-workloads.md`
(Package B).

## Approach

1. **Agent def.** `agents/foreman-discover.md` frontmatter follows the
   established shape (`agents/foreman-search.md:1-13`): `name:
   foreman-discover`, `model: opus` (top tier), `tools: Read, Grep, Glob,
   Bash`, `isolation: worktree`, `effort: high`. Body: takes a DISCOVERY
   BRIEF (the unknowns, the live system to probe, the convergence goal); MAY
   run empirical probes (Bash/network) but NEVER writes product code. Report
   shape: `DISCOVERY REPORT / VERDICT: converged|partial / CAPTURED_FACTS:
   <path> / SUB_SPECS: <n determined five-part specs> / REMAINING: ...`.
2. **Budget (advisory).** A declared max probe-iterations / token cap /
   wall-clock is part of the DISCOVERY BRIEF; on exhaustion without
   convergence the agent is instructed to emit `verdict: partial` with
   captured facts so far and the remaining unknowns. This is a **self-report,
   not a coded kill**: a Claude agent cannot hard-enforce its own turn budget
   the way `lane-run.sh`'s coded timeout/kill can. The doctrine states this
   plainly so the operator is not misled into treating the budget as a
   guarantee against an unbounded loop.
3. **Convergence.** Exit criterion is "the unknowns are concrete testable
   facts sufficient for a `determined` spec" — i.e. the spec-triage gate
   (`spec-triage-gate` package) would now pass on the resulting sub-spec.
   This is the seam between C2 and C1/C4.
4. **Doctrine.** `skills/foreman/references/discovery.md` documents: route to
   discovery only after spec-triage refuses (never bypass the gate); the
   budget contract; the convergence criterion; that discovery's output feeds
   the re-triage; and that discovery is deliberately the expensive lane —
   its cost is the price of empirical work, and the cost-premise win is
   offloading the implementation slice afterward, not discovery itself.
5. **Routing table.** `SKILL.md:95-105`'s Lanes table gains an
   **Exploratory** row (Producer: top Claude, Invoke: `foreman-discover`,
   Route when: spec-triage refuses / spec is under-determined); the deciding
   rule (`SKILL.md:102-105`) is extended to distinguish "judgment the spec
   can't capture YET (discover it)" from "irreducible judgment (keep with
   architect)".

## Key decisions

- **grok is not eligible for discovery.** Discovery is high-judgment
  empirical work (reverse-engineering a live system from narration) — the
  same category foreman already keeps with the architect for irreducible
  judgment. `agents/foreman-discover.md` is top-Claude tier only; there is no
  grok/codex discovery lane.
- **Deliverable is never product code.** `foreman-discover` writes
  `captured-facts.md` and determined sub-specs into its worktree report — it
  does not touch product files. This preserves the boundary between the
  empirical lane and the implementation lane the rest of the pipeline
  depends on.
- **Bounded, not exploratory-forever — but by self-report, not a coded
  kill.** The budget + `partial` verdict is the parent design's answer to
  "discovery that never converges" (an open question in the parent design's
  Risks section) — foreman surfaces "did not converge" honestly rather than
  looping, and the fit report (`workload-fit-accounting` package) shows an
  all-discovery run as poor fit. This bound is advisory: the agent
  self-reports on exhaustion; nothing coded hard-kills it the way
  `lane-run.sh`'s timeout/kill does for a coded lane.

## Verification

Agent-def frontmatter parses and loads; the routing table / deciding-rule
update is checked for internal consistency against
`grok-implementer.md`/`roles.md` (no contradiction — grok still never
eligible for discovery); docs-check green. Implementer: Sonnet 5. Audit:
Opus 4.8.
