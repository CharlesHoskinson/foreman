# Parallel worktrees — search, plan, audit

## Why

Industry practice (Claude Code, Codex, Cursor Parallel Agents) treats **git
worktrees** as the isolation primitive for multi-agent work:

- One repo object store, many checkouts
- Each agent gets its own directory + branch → **no file collisions**
- Architect consolidates reports, then cleans up empty/finished trees

Foreman standardizes that for **search**, **plan**, and **audit** (and optional
implement) so Fable can fan out maximum parallel workload.

## Sources (best practices)

| Practice | Source |
|---|---|
| Isolate parallel agents with worktrees | [Claude Code: Run agents in parallel](https://code.claude.com/docs/en/agents) |
| `isolation: worktree` on subagents | Claude Code subagent frontmatter |
| One task note + owned file set per tree | Community parallel-agent guides |
| Plan first, partition ownership, merge in dependency order | Parallel agent workflow guides (2026) |
| Serialize `git worktree add` (lock races) | Git worktree known race; Foreman `flock` |
| Reports written in isolation, synthesis at the end | Subagent parallel research pattern |
| Clean up worktrees after merge/discard | Claude worktree lifecycle docs |

## Lifecycle

```text
tool-check
  → RUN_ID = ...
  → wt-new  (search | plan | audit)   [parallel-safe via flock]
  → spawn agents in each worktree (parallel)
  → each agent writes FOREMAN_REPORT.md (+ .json) in ITS tree
  → wt-consolidate   → ~/.foreman/runs/<RUN_ID>/CONSOLIDATED.md
  → architect decides (merge / rework / discard)
  → wt-merge (implement trees)
  → wt-cleanup       → remove worktrees; keep reports
```

### Scripts

| Script | Action |
|---|---|
| `scripts/wt-new.sh RUN_ID ROLE [SLUG] [BASE]` | Create worktree + report scaffold |
| `scripts/wt-consolidate.sh RUN_ID` | Copy reports → run dir + CONSOLIDATED.md |
| `scripts/wt-merge.sh RUN_ID ROLE [SLUG] [--commit]` | Squash-apply branch as staged changes (overlap-refusal) |
| `scripts/wt-cleanup.sh RUN_ID [--force] [--keep-branches]` | Remove worktrees after archive |

### Layout

```text
# Sibling worktrees (default)
<parent>/<repo>-wt-<RUN_ID>-search/
  FOREMAN_REPORT.md
  FOREMAN_REPORT.json
<parent>/<repo>-wt-<RUN_ID>-plan/
...
# Host run dir (never inside a worker-only tree for secrets)
~/.foreman/runs/<RUN_ID>/
  worktrees/*.json
  reports/*.md
  CONSOLIDATED.md
```

### Branches

`foreman/<RUN_ID>/<role>[/<slug>]` — short-lived; deleted on cleanup unless
`--keep-branches`.

## Agent roles

| Role | Agent | isolation | Writes code? | Report focus |
|---|---|---|---|---|
| **search** | `foreman-search` | worktree | No | Codebase map, file hits, citations |
| **plan** | `foreman-plan` | worktree | No | Decomposition, risks, ordered tasks |
| **audit** | `codex-auditor` (in tree) or `foreman-audit` wrapper | worktree | No | Cold-diff verdict JSON |
| **implement** | `grok-implementer` / `codex-implementer` | worktree (default) | Yes | Diff + verification |

## Architect rules (Fable)

1. **Partition first.** If two agents would edit the same files, do not parallelize
   writers; still may parallelize search/plan.
2. **Spawn in one turn** when independent (max parallelization).
3. **Each agent cwd = its worktree** (or Claude `isolation: worktree`).
4. **Mandatory report path:** `FOREMAN_REPORT.md` in worktree root before exit.
5. **Consolidate before trusting any single report** for ship decisions.
6. **Cleanup** after consolidate; never leave dirty trees without `--force` intent.
7. **Do not** mount `~/.foreman/runs` secrets into untrusted workers.

## Report schema (JSON)

```json
{
  "schema": "foreman.worktree-report.v1",
  "run_id": "...",
  "role": "search|plan|audit|implement",
  "slug": "",
  "status": "complete|partial|blocked|in_progress",
  "summary": "one paragraph",
  "findings": [],
  "evidence": [],
  "open_questions": []
}
```

Audit role may embed standard `verdict` / `findings` from the audit schema inside
`findings` or as a nested `audit` object.

## Parallel recipe (soft)

```bash
RUN=run-$(date +%Y%m%d-%H%M%S)
# from repo root
bash skills/foreman/scripts/wt-new.sh "$RUN" search
bash skills/foreman/scripts/wt-new.sh "$RUN" plan
# after implementers produce a diff on main or implement worktree:
bash skills/foreman/scripts/wt-new.sh "$RUN" audit
# spawn foreman-search, foreman-plan, codex-auditor in parallel (each in its WT)
bash skills/foreman/scripts/wt-consolidate.sh "$RUN"
# ... architect synthesis ...
bash skills/foreman/scripts/wt-cleanup.sh "$RUN"
```

## Claude Code note

Prefer agent frontmatter:

```yaml
isolation: worktree
```

for search/plan/audit agents so Claude creates isolation automatically. Still
run **wt-consolidate** so reports land in `~/.foreman/runs/` for durable audit
trail independent of worktree lifetime.

## Stateful / live-target profile

**What it is.** A target whose runtime state — installed dependencies, running
services, live endpoints — lives **outside the git checkout**, so a fresh
`git worktree add` produces a tree that cannot actually run the target. Examples:
a vendored sub-repo's `node_modules` installed once into the primary checkout
and never reproduced per-worktree, a proof-server container bound to the
primary checkout's paths, a live testnet node the target code talks to over a
fixed local endpoint.

**When worktree fan-out is inapplicable.** Foreman's whole isolation model
(above) assumes each parallel tree is self-sufficient — checkout + branch is
enough to search, plan, implement, or audit. A stateful/live target breaks
that assumption: a new worktree has none of the external state, so an
implementer spawned into it either fails immediately or, worse, silently
drifts against a target it cannot actually exercise. Search/plan/audit
(read-only roles) are usually still fine in a worktree; **implement is not**
whenever the work must run against the live external state.

**Config key + guard.** Set `soft_mode.target = "live"` in
`.foreman/config.toml`'s `[soft_mode]` table to declare a repo as a live
target:

```toml
[soft_mode]
target = "live"   # worktree (default) | live
```

`wt-new.sh` reads this key (`toml_get ... soft_mode.target worktree`) right
after its own arg parsing, before any worktree is created, and refuses
(`EXIT_CONFIG`, live-target message) whenever it resolves to `live` — see
`skills/foreman/scripts/wt-new.sh` and `tests/soft-mode-target.bats`. The
default (key absent, or any value other than `live`) is unaffected: `wt-new`
behaves exactly as documented above.

**No-worktree recipe.** Run soft mode directly in the working checkout instead
of fanning out:

```bash
# from the primary checkout (soft_mode.target=live) -- no wt-new
# 1. spec + spawn grok-implementer / codex-implementer in THIS checkout
#    (the grok-implementer lane, not a worktree-isolated agent)
# 2. the implementer edits the working tree directly, against the real
#    installed deps / running services / live endpoints
# 3. architect verifies the diff against the live services (real checks,
#    not a worktree-only re-run) before accepting
```

**Trade-off (explicit).** This buys correctness against real external state at
the cost of Foreman's usual parallel-lane isolation and durable worktree
checkpoints: no sibling trees, no per-lane branch, no `wt-cleanup` recovery
point — one lane at a time, changes land straight in the working checkout.
Treat it as soft mode only; it is not a substitute for hard mode's containment
when the work is high-stakes (see `references/security-model.md`).
