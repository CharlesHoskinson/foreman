# README deepening — design

Date: 2026-07-15
Status: approved (user), pending implementation
Method: superpowers brainstorming → this spec → writing-plans → implementation via the foreman skill (Grok implement, humanizer pass, codex-auditor truth+slop audit)

## Goal

Turn the README from a 1172-word reference card into a self-contained teaching
document (well beyond 1500 words; target ~4000–6000 words / ~700–900 lines)
that explains the mental model of the Foreman skill, not just its commands. Cut
AI-slop phrasing, add six ASCII diagrams, and add many paragraphs of genuine
explanation of how the skill works and how to use it.

## Voice and anti-slop rules (enforced by humanizer pass + audit)

- Cut hedges and filler: "high-judgment", "robust", "seamless", "leverage",
  "streamline", "comprehensive", "it's worth noting", "in order to", rule-of-
  three padding, negative parallelisms ("not X, but Y" as a formula), essay
  intro/conclusion filler.
- Every sentence states a fact or a reason. Explain why a rule exists by naming
  the bug it prevents (this session produced real examples — use them).
- Concrete over abstract: name the file, exit code, or failure. Active voice.
- Em dashes only as `**Term** — definition` separators; ≤1 em dash per ~200
  words of prose otherwise. Vary sentence length.
- Where something is a stub or unexercised, say so plainly.
- Accuracy is non-negotiable: every command, path, flag, exit code, and number
  must match the tree. This will be truth-audited.

## Self-contained scope

The README becomes fully self-contained — narrative, diagrams, and enough
operational detail that a reader who opens only the README can install, run a
task end to end, and understand every subsystem. `docs/USAGE.md` is retained as
the terse quick-reference (NOT deleted); the README may link to it for the
exhaustive per-flag tables but must not depend on it for comprehension.

## Structure (15 sections, in order)

1. **What Foreman is and the problem it solves** — 3–4 paragraphs. The failure
   modes of one model doing everything: expensive-lane token volume, same-family
   blind spots, ungoverned edits, unverifiable "done" claims. The architect/
   worker split as the answer.
2. **The mental model** — architect owns judgment; workers type; auditor is paid
   to disagree; advisor rules at commitment boundaries. Why cross-vendor is the
   whole point (decorrelated failure modes).
3. **The soft loop** — narrated prose + ASCII **loop diagram** (inventory →
   recon → implement → verify+audit → land, with the rework arrow).
4. **Lanes and routing** — a paragraph of real explanation per lane
   (grok-implementer, codex-implementer, codex-auditor, foreman-advisor), the
   deciding rule, the never-silently-substitute rule, plus ASCII **routing
   decision tree**. Keep the existing lane table.
5. **The five-part spec** — why context-free handoff; each of the five parts
   explained with what goes wrong if it is weak; EARS phrasing with one worked
   IF/THEN + WHEN example; standing constraints.
6. **Worktree isolation** — the shared-checkout collision it prevents (a real
   session example: a concurrent session committing to main mid-run); ASCII
   **worktree lifecycle diagram** (wt-new → parallel role agents → FOREMAN_REPORT
   → wt-consolidate → wt-merge → wt-cleanup); wt-merge refusal modes and exit
   codes.
7. **The evidence contract** — the "narrated success, unchanged tree" failure;
   ASCII **evidence-contract diagram** (HEAD + status digest before/after);
   the Grok write-cancellation bug as the motivating real example, and the
   `--allow "Write" --allow "Edit"` fix.
8. **Verification and the audit lane** — reports are claims not proof; the
   architect re-runs; codex-auditor cold diff; what APPROVED/WARNING/BLOCKED
   mean operationally; the real dot-name `rm -rf` exploit the audit caught as a
   worked example.
9. **The documentation stage** — docs-check (markdownlint-cli2, codespell,
   lychee, bash comment coverage), fail-closed, iterative rework loop, wired
   into checks and the hard-mode gate.
10. **Hard mode** — ASCII **INIT→PR gate pipeline**; the shipped-vs-stub table
    (verbatim statuses from the current README); honest limits (worker-run and
    pr-open are stubs; audit-vendor≠worker-vendor is the only enforced vendor
    check; docs-check sub-stage runs from caller cwd).
11. **Repo understanding (knowledge graph)** — query-first doctrine; the 45–77%
    measured saving and how it was measured (graph query vs raw file reads);
    staleness handling.
12. **Maintenance and updates** — the three stages; the release-triggered
    workflow (scoped to --stage upstream in CI, why); the CRLF/LF hash lesson;
    27 bats tests.
13. **A full worked walkthrough** — one real task from first prompt to merged
    commit, command by command: tool-check → wt-new → five-part spec → route →
    architect verify → codex audit → wt-merge → wt-cleanup. Absorbs USAGE's
    operational value into the README.
14. **Install, quickstart, troubleshooting** — install (Windows + WSL/macOS/
    Linux), honest-link behavior, quickstart boot, and a troubleshooting list
    that MUST include: grok headless needs `--allow "Write" --allow "Edit"`
    (acceptEdits silently ignored; symptom is narrated edits with an unchanged
    tree); codex ~600s wall clock and splitting large specs; jq on Windows;
    bats location; lychee PATH on fresh shells.
15. **Security model, layout, license, lineage** — keep the verbatim security
    sentence "Containers (hard mode) share the host/WSL2 kernel — defense-in-
    depth, not a hard boundary." Keep the layout tree and lineage
    (fable-advisor, original harness, OpenSpec). License section states
    **Apache License 2.0** (see `LICENSE`); the vendored superpowers skill keeps
    its own upstream MIT license as recorded in `skills/VENDORED.md` — that row
    is not changed.

## Six ASCII diagrams (required, each labeled)

1. **Architecture** — architect ↔ four lanes ↔ host run-state, showing the
   vendor of each lane and that run-state lives outside worktrees.
2. **Soft loop** — the five stages with the rework arrow back to implement.
3. **Lane routing tree** — a decision tree from "how much judgment can the spec
   not capture?" to the chosen lane.
4. **Worktree lifecycle** — one RUN_ID fanning out to role worktrees, each
   writing a report, consolidating, merging, cleaning up.
5. **Evidence contract** — the before/after HEAD + status-digest capture around
   a worker run, and the branch that detects a mismatch.
6. **Hard-mode gate pipeline** — INIT→PLAN→IMPLEMENT→CHECK→EVIDENCE→AUDIT→GATE→PR
   with the gate's fail-closed conditions and the rework loop.

Diagrams are plain ASCII/box-drawing inside fenced code blocks, must render in a
monospace terminal, and must not use external images.

## Files

- rewrite: `README.md`
- keep: `docs/USAGE.md` (unchanged)
- do not touch: anything else.

## Verification

- Word count > 1500 (target 4000–6000).
- Six labeled ASCII diagrams present, each in a fenced code block.
- Zero slop-word hits: `grep -ciE 'seamless|leverage|robust|cutting-edge|delve|
  streamline|high-judgment'` returns 0 in prose (allowed only where quoting a
  banned-word list itself).
- Verbatim security sentence present exactly once.
- Every command/path/flag/exit-code/number matches the tree (truth audit).
- `docs-check` passes.

## Execution

Through Foreman: architect five-part spec → `grok-implementer` in a worktree →
dedicated humanizer editing pass over the draft → `codex-auditor` truth + slop
audit (cross-vendor) → rework to APPROVED → `wt-merge` → `wt-cleanup`.

## Decisions log

- Self-contained README (user choice, over teacher/manual split or folding USAGE
  in). USAGE.md retained, not deleted.
- Depth: well beyond 1500 words, deep-and-complete (user choice).
- Six ASCII diagrams, 15 sections (architect proposal, user approved).
