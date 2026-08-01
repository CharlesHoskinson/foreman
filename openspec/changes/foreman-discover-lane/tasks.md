# Tasks — foreman-discover-lane

Implementer: Sonnet 5 · Audit: Opus 4.8.

- [ ] **1. `agents/foreman-discover.md`** — frontmatter (`name:
  foreman-discover`; `model: opus`; `tools: Read, Grep, Glob, Bash`;
  `isolation: worktree`; `effort: high`); body documents the DISCOVERY BRIEF
  contract, the empirical-probe-but-never-product-code boundary (enforceable,
  by role/tools), the budget (max probe iterations/token cap/wall-clock) and
  `partial` behavior on exhaustion — stated plainly as an **advisory
  self-report**, not a coded kill (a Claude agent cannot hard-enforce its own
  turn budget the way `lane-run.sh`'s coded timeout/kill can) — the
  convergence exit criterion (enforceable: emitted sub-specs must pass
  `spec-triage.sh`), and the `DISCOVERY REPORT / VERDICT: converged|partial /
  CAPTURED_FACTS: <path> / SUB_SPECS: <n> / REMAINING: ...` report shape.
- [ ] **2. `skills/foreman/references/discovery.md`** — doctrine: route to
  discovery only when spec-triage refuses; the budget contract; the
  convergence criterion; discovery output feeds the C4 re-triage; discovery
  is the expensive lane by design.
- [ ] **3. `SKILL.md` routing table** — add the **Exploratory** row
  (Producer: top Claude · Invoke: `foreman-discover` · Route when: spec is
  under-determined / spec-triage refuses); update the deciding rule to
  distinguish "judgment the spec can't capture YET (discover it)" from
  "irreducible judgment (keep with architect)".
- [ ] **4. Consistency check** — verify the agent def loads (frontmatter
  parses) and the routing/doctrine update does not contradict
  `grok-implementer.md`/`roles.md` (grok still never eligible for
  discovery); docs-check green.
- [ ] **5. Verify** — docs-check green; review for internal consistency
  across `SKILL.md`, `discovery.md`, `foreman-discover.md`; commit per the
  plan (`feat(discover): foreman-discover lane (bounded empirical discovery
  -> facts + determined sub-specs)`).

Acceptance: `agents/foreman-discover.md` exists, top-Claude tier,
worktree-isolated, MAY probe (Bash/network) but never writes product code
(enforceable, by role/tools); a self-reported, advisory budget + `partial`
verdict on exhaustion (not a coded kill); convergence criterion (enforceable:
emitted sub-specs must pass `spec-triage.sh` before any grok dispatch)
documented and consistent with the spec-triage gate; `SKILL.md` routing
table and deciding rule updated; docs-check green.
