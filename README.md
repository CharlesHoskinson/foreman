# Foreman

Cross-vendor architect/worker orchestration for coding agents: a high-judgment
architect routes five-part specs to implementer and auditor lanes, then ships
only after independent verification.

## How it works

Soft mode (default) is a short loop:

1. **Inventory** — run `env/tool-check.sh` (or `env/tool-check.ps1` on Windows) for profile `soft` (bootstrap gaps, re-check).
2. **Recon** — `wt-new` for search and plan under one `RUN_ID`; spawn agents in
   parallel; each writes `FOREMAN_REPORT.md` in its worktree; `wt-consolidate`.
3. **Implement** — write a five-part spec; route to `grok-implementer` (or race
   `codex-implementer`) in a worktree.
4. **Verify + audit** — architect re-runs checks on the real diff; cold-diff
   audit via `codex-auditor` (cross-vendor).
5. **Land** — ship or rework; `wt-merge` for implement trees; `wt-cleanup`.

| Lane | Producer | Agent | Role |
|---|---|---|---|
| Routine implementer | Grok 4.5 | `grok-implementer` | Default typing lane when the spec fully determines the outcome |
| Cross-vendor implementer | GPT-5.6 Sol (high) | `codex-implementer` | Race / second implementation, or Grok unavailable |
| Audit (default) | GPT-5.6 Sol (high), read-only | `codex-auditor` | Cold diff + acceptance criteria; vendor must differ from the worker |
| Judgment | Claude Fable / Opus | `foreman-advisor` | Commitment boundaries only; never implements |

**Evidence contract.** Lane reports are claims, not proof: the architect reads
the diff and re-runs the verification command. Implementer wrappers record HEAD
and a SHA-256 digest of `git status --porcelain` before and after the CLI so a
narrated success with an unchanged tree is visible.

## Install

### Windows (PowerShell)

```powershell
cd path\to\foreman
.\install.ps1
```

### WSL / macOS / Linux

```bash
cd /path/to/foreman
chmod +x install.sh
./install.sh
```

Install links every directory under `skills/` into:

- `~/.claude/skills/<name>`
- `~/.agents/skills/<name>` (portable Agent Skills home)
- `~/.grok/skills/<name>`

and copies `agents/*.md` into `~/.claude/agents/`. It also creates
`~/.foreman/runs` for host run state.

**Honest-link behavior.** If a destination already exists as a real directory
(not a junction/symlink), install **skips it with a warning** and never replaces
it. That protects local overlays such as `*.local.md`. Existing links that
already point at this checkout (or a shared common-skills tree) are left as-is.

Before multi-step work, inventory tools:

```powershell
.\env\tool-check.ps1 -Profile soft -Json -Out $env:USERPROFILE\.foreman\last-tool-check.json
# if READY: no
.\env\bootstrap-windows.ps1 -Profile soft -Yes
.\env\tool-check.ps1 -Profile soft
```

```bash
bash env/tool-check.sh --profile soft --json
bash env/bootstrap-wsl.sh --profile soft --yes   # or hard/full on WSL
```

Soft mode uses Claude Code as the typical/default architect host, but Claude
Code is not required by the harness itself — orchestration works from Grok or
Codex instead. Authenticated `grok` CLI (default implementer) and authenticated
`codex` CLI (default auditor, GPT-5.6 Sol) remain required for their lanes.
Missing lanes report `STATUS: unavailable`; they never silently become Claude.

## Quickstart

```powershell
cd path\to\foreman
claude
```

Inside the session:

```text
/model fable
/foreman
```

Project `CLAUDE.md` pins architect doctrine. Example first prompt:

```text
Soft mode. Add a small feature under site/ that documents the docs-check stage.

Write a five-part spec, route implementation to grok-implementer,
verify independently, audit with codex-auditor (GPT-5.6 Sol),
consult foreman-advisor only if the information architecture is ambiguous.
```

A **five-part spec** is the only context an implementer receives (no chat history):

1. **Objective** — what to build or change
2. **Files** — exact create / modify / do-not-touch paths
3. **Interfaces** — signatures, types, shapes the code must match
4. **Constraints** — conventions and forbidden zones (include standing constraints)
5. **Verification** — command(s) the architect will re-run

For Grok-bound specs, phrase Interfaces/Constraints/Verification in **EARS**
(Easy Approach to Requirements Syntax: SHALL / WHEN / WHILE / IF…THEN). Template:
`skills/foreman/references/five-part-spec.md`.

## Hard mode

Opt in with `.foreman/config.toml` `mode = "hard"` or by asking for hard mode.
Loop:

```text
INIT → PLAN → IMPLEMENT → CHECK → AUDIT → GATE → PR
```

| Stage | Script / action | Status |
|---|---|---|
| **INIT** | `skills/foreman/scripts/task-new.sh TASK_ID [BASE]` | **Shipped** — worktree + envelope + hash snapshot of protected paths |
| **PLAN** | Architect writes `plan.md` into the run dir | Process — file handoff only |
| **IMPLEMENT** | `skills/foreman/scripts/worker-run.sh` | **Stub** — containerized Docker worker not shipped; use soft agents |
| **CHECK** | `skills/foreman/scripts/checks-run.sh TASK_ID` | **Shipped** — product checks from a pristine commit archive, not the dirty tree |
| **EVIDENCE** | `skills/foreman/scripts/evidence-collect.sh TASK_ID` | **Shipped** — host-side bundle under `~/.foreman/runs/` |
| **AUDIT** | `skills/foreman/scripts/audit-run.sh` (host Codex Sol) | **Shipped** — cold diff; Docker worker audit path still expanding |
| **GATE** | `skills/foreman/scripts/gate-eval.sh TASK_ID` | **Shipped** — forbidden paths + hash drift + checks green + not BLOCKED |
| **PR** | `skills/foreman/scripts/pr-open.sh TASK_ID` | **Partial stub** — refuses without gate pass; full `gh pr create` not shipped |

Product checks run from the pristine archive; the docs-check sub-stage runs from the caller's cwd, not the archive.

Run state lives in `$FOREMAN_HOME/runs/<task-id>/` (default `~/.foreman/runs/`),
outside every worktree. There is no shipped orchestrator-vendor check because
`worker-run.sh` is a stub. Shipped hard-mode tooling enforces audit vendor ≠
worker vendor (`audit-run.sh`).

## Repo understanding

This repo commits a knowledge graph at `graphify-out/graph.json`. For concepts,
architecture, or file relationships, query first:

```bash
graphify query "<question>" --budget 1500
```

Follow `source_location` pointers into files only for the facts you need.
Measured saving vs raw reads: **45–77%** of tokens. If the graph is stale relative
to HEAD (see `graphify-out/GRAPH_REPORT.md`), refresh with `graphify --update` or
note the staleness.

## Maintenance

`skills/foreman/scripts/maintenance.sh` reports three stages:

| Stage | What it checks |
|---|---|
| `upstream` | Vendored skill content hashes vs `skills/VENDORED.md` |
| `graph` | Graphify incremental update / freshness of `graphify-out/` |
| `compat` | Soft-profile tool inventory against `env/reference-manifest.toml` |

```bash
bash skills/foreman/scripts/maintenance.sh --stage all
bash skills/foreman/scripts/maintenance.sh --stage upstream --json out.json
bash skills/foreman/scripts/maintenance.sh --stage all --strict   # exit 3 on drift
bash skills/foreman/scripts/maintenance.sh --stage upstream --apply  # re-vendor from ~/.claude/skills
```

`.github/workflows/maintenance.yml` runs on release publish, monthly schedule,
and `workflow_dispatch`. **It has not been exercised by a real release yet**;
validate on the first tagged release (or dispatch manually first).

Tests: **27** bats tests across `tests/docs-check.bats`, `gate-eval.bats`,
`maintenance.bats`, `wt-merge.bats`, `wt-new.bats`. Runner:

```bash
bash tests/run.sh
```

(`tests/run.sh` finds `bats` on PATH or `~/.foreman/tools/bats-core`.)

## Security model

Soft mode runs implementer CLIs on the host with their native sandboxes only.
Hard mode adds Docker worker constraints when that path is used, host-side
evidence that is never mounted into the worker, forbidden-path and hash gates,
and cold-diff audit.

Honest limit, verbatim: Containers (hard mode) share the host/WSL2 kernel —
defense-in-depth, not a hard boundary.

Full map: `skills/foreman/references/security-model.md`.

## Layout

```text
foreman/
├── skills/foreman/          # skill: SKILL.md, references/, scripts/
├── skills/graphify/         # vendored: knowledge graph
├── skills/scrapling/        # vendored: fetch / scrape helpers
├── skills/superpowers/      # vendored: planning, TDD, debugging, code-review, and git-worktree workflow skills
├── skills/VENDORED.md       # provenance + content hashes
├── agents/                  # Claude Code subagents (implement, audit, advisor, …)
├── env/                     # reference-manifest, tool-check, bootstrap
├── config/foreman.toml.example
├── install.ps1 · install.sh
├── openspec/                # OpenSpec change-folder conventions
├── site/                    # static documentation website (dogfood target)
├── tests/                   # bats suite + run.sh
├── graphify-out/            # committed knowledge graph
├── docs/                    # USAGE.md + research / design notes
└── CLAUDE.md                # project architect doctrine
```

## License

MIT. See [LICENSE](LICENSE).

## Lineage

- Soft routing doctrine inspired by [DannyMac180/fable-advisor](https://github.com/DannyMac180/fable-advisor)
- Hard harness design from the original Foreman orchestrator/worker spec
- Change-folder conventions follow [OpenSpec](https://github.com/Fission-AI/OpenSpec) (see `openspec/README.md`)
