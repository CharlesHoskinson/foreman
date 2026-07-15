# Foreman use guide

End-to-end operation for cross-vendor orchestration running today. Claude Code
is the typical/default architect host but is not required by the harness itself
— orchestration works from Grok or Codex instead. Soft mode is the default path.
Hard mode is called out where scripts differ. Claims below match the tree under
`skills/foreman/`, `agents/`, `env/`, and `tests/`.

## 1. Session walkthrough

Example multi-step task: document a small behavior change and land it with
worktree isolation, verification, and cross-vendor audit.

### 1.1 Inventory

From the repo root on Windows:

```powershell
.\env\tool-check.ps1 -Profile soft -Json -Out $env:USERPROFILE\.foreman\last-tool-check.json
```

On WSL or macOS/Linux:

```bash
bash env/tool-check.sh --profile soft --json --out ~/.foreman/last-tool-check.json
```

Exit `0` means READY; exit `1` means missing or outdated must-tools. If not
ready:

```powershell
.\env\bootstrap-windows.ps1 -Profile soft -Yes
.\env\tool-check.ps1 -Profile soft
```

```bash
bash env/bootstrap-wsl.sh --profile soft --yes
bash env/tool-check.sh --profile soft
```

Auth is never automated: after install, run `grok login` and `codex login` if
those CLIs are new.

### 1.2 Boot the architect

```powershell
cd path\to\foreman
claude
```

```text
/model fable
/foreman
```

Restate the goal and mode in one short paragraph. Soft unless you set
`mode = "hard"` in `.foreman/config.toml` or ask for hard mode.

### 1.3 Create parallel recon worktrees

Pick one `RUN_ID` for the whole session (letters, digits, `.`, `_`, `-` only):

```bash
RUN=run-$(date +%Y%m%d-%H%M%S)
bash skills/foreman/scripts/wt-new.sh "$RUN" search
bash skills/foreman/scripts/wt-new.sh "$RUN" plan
```

Each call prints the worktree path. Layout (sibling of the repo root):

```text
<parent>/<repo>-wt-<RUN_ID>-search/
<parent>/<repo>-wt-<RUN_ID>-plan/
```

Branches: `foreman/<RUN_ID>/<role>[/<slug>]`. Metadata and reports archive under
`~/.foreman/runs/<RUN_ID>/`.

### 1.4 Spawn search and plan

In Claude, spawn `foreman-search` and `foreman-plan` in parallel (one turn), each
with cwd set to its worktree (or `isolation: worktree`). Both are read-only for
product code. Each **must** write:

- `FOREMAN_REPORT.md`
- `FOREMAN_REPORT.json` (schema `foreman.worktree-report.v1`)

### 1.5 Consolidate recon

```bash
bash skills/foreman/scripts/wt-consolidate.sh "$RUN"
```

Read `~/.foreman/runs/$RUN/CONSOLIDATED.md`. Synthesize; do not ship on a single
partial report.

### 1.6 Write the five-part spec and implement

Create an implement worktree (default for soft implement rounds):

```bash
bash skills/foreman/scripts/wt-new.sh "$RUN" implement docs-stage
```

Route the full five-part spec to `grok-implementer` with that worktree as cwd.
Standing rule: implementers never run git write commands; changes stay
uncommitted until the architect merges.

### 1.7 Verify (architect)

Reports are claims. You:

1. `git -C <implement-wt> status` and `git diff`
2. Re-run the Verification command from the spec yourself
3. Confirm evidence digests moved when the model claimed edits

Wrong code → corrected five-part spec back to the cheap implementer lane, not
hand-patching on the architect model.

### 1.8 Audit

```bash
bash skills/foreman/scripts/wt-new.sh "$RUN" audit
```

Pass to `codex-auditor` (or `foreman-audit` wrapper): worker vendor, acceptance
criteria from the five-part spec, and a cold unified diff. After the run,
`git status --porcelain` in the audit tree must show no auditor mutations.

### 1.9 Consolidate, merge, cleanup

```bash
bash skills/foreman/scripts/wt-consolidate.sh "$RUN"
# if implement tree is ready and checks + audit are green:
bash skills/foreman/scripts/wt-merge.sh "$RUN" implement docs-stage
# optional: --commit to create a single merge commit; default is staged only
bash skills/foreman/scripts/wt-cleanup.sh "$RUN"
# dirty trees: --force to discard; keep branch tips: --keep-branches
```

Consult `foreman-advisor` only at commitment boundaries (architecture, migration,
API shape, or a problem that failed twice).

## 2. Writing five-part specs

Copy from `skills/foreman/references/five-part-spec.md`:

```text
## Objective
[One paragraph: what to build or change and why.]

## Files
- create: path/to/new.file
- modify: path/to/existing.file
- do not touch: path/to/protected/**

## Interfaces
[Signatures, types, API shapes, HTML section IDs, CSS tokens.]

## Constraints
- Project conventions: …
- Stack / libraries: …
- Forbidden: no new dependencies without asking; no drive-by refactors
- Mode notes: soft | hard

## Verification
# Exact command(s) the orchestrator will re-run
test -f path && grep -q "marker" path
```

### Standing constraints (every spec)

Paste into Constraints:

- NEVER run git write commands (`commit`, `add`, `reset`, `branch`, `push`,
  `rebase`, `merge`, `tag`). Changes stay uncommitted in the working tree.
- Do not delete or rename files. List needed deletions/renames under
  `ARCHITECT_ACTIONS` in the report.
- Work only inside the provided worktree path.
- No network access unless the spec explicitly grants it.
- Documentation and comments are part of the deliverable: markdown passes
  markdownlint-cli2; bash functions carry shdoc headers (`# @description`
  minimum); scripts carry a top-of-file purpose comment.

If you cannot fill Interfaces or Verification, you are not ready to delegate.

### EARS patterns (required for Grok-bound specs)

| Pattern | Template |
|---|---|
| Ubiquitous | The implementer SHALL \<response\>. |
| Event-driven | WHEN \<trigger\>, the implementer SHALL \<response\>. |
| State-driven | WHILE \<precondition\>, the implementer SHALL \<response\>. |
| Optional feature | WHERE \<feature is included\>, the implementer SHALL \<response\>. |
| Unwanted behavior | IF \<unwanted condition\>, THEN the implementer SHALL \<response\>. |
| Complex | WHILE \<precondition\>, WHEN \<trigger\>, the implementer SHALL \<response\>. |

#### Worked example 1: dirty file set

> WHEN computing the dirty file set, the script SHALL build it as the sorted
> union of `git diff --name-only`, `git diff --name-only --cached`, and
> `git ls-files --others --exclude-standard`.
> IF a fix would require changing unrelated logic, THEN the implementer SHALL
> stop and report the gap instead of expanding scope.

#### Worked example 2: docs gate

> The implementer SHALL leave `README.md` section order as listed in the Interfaces
> section.
> WHEN adding a security sentence, the implementer SHALL include the verbatim
> string `defense-in-depth, not a hard boundary`.
> IF a required fact cannot be confirmed in the tree, THEN the implementer SHALL
> omit the claim rather than invent it.

## 3. Routing decisions

| Situation | Route |
|---|---|
| Spec fully determines the outcome | `grok-implementer` (default) |
| Costly mistakes / judgment-heavy implementation | Race Grok + `codex-implementer`, or keep with architect |
| Grok CLI missing or timed out | Re-route to `codex-implementer` and **say so** |
| After independent checks on a non-trivial diff | `codex-auditor` (default when worker ≠ OpenAI) |
| Worker was already Codex / OpenAI | **Do not** call `codex-auditor`; architect review or non-OpenAI audit; state the substitution |
| Architecture, migration, API shape, stuck twice | `foreman-advisor` (≤ ~300 words, read-only) |
| Implementer CLIs both unavailable | Architect types only after stating the same-family downgrade |

**Unavailable / timeout.** If a lane returns `STATUS: unavailable` or `timeout`,
re-route and say so in the session. Never silently absorb a vendor substitution
under the original lane's name. Never use the implementer lane to "audit itself."

Default pairing:

```text
Grok implements → architect re-runs checks → Codex Sol audits → architect ships
```

## 4. Worktree lifecycle

Scripts live under `skills/foreman/scripts/`. Shared exit codes from
`lib/common.sh`: `0` OK, `1` fail, `2` config, `3` missing CLI (scripts may add
more).

### `wt-new.sh RUN_ID ROLE [SLUG] [BASE_REF]`

- Roles: `search | plan | audit | implement | advisor | misc`
- Creates sibling worktree, branch `foreman/<RUN_ID>/<role>[/<slug>]`, report
  scaffolds, and metadata under `~/.foreman/runs/<RUN_ID>/worktrees/`
- Prints the worktree path on stdout
- Exit `2` on bad run id / role / slug or if the path already exists
- Exit `3` if `git` (or `jq`/`python3` fallback) is missing

### `wt-consolidate.sh RUN_ID`

- Copies each tree's `FOREMAN_REPORT.*` into
  `~/.foreman/runs/<RUN_ID>/reports/`
- Writes `CONSOLIDATED.md`
- Does **not** remove worktrees
- Exit `2` if no worktrees index (run `wt-new` first)

### `wt-merge.sh RUN_ID ROLE [SLUG] [--commit]`

- Squash-applies the worktree branch onto the current branch
- Default: **staged only** (no commit); `--commit` creates one merge commit
- Commits pending worker changes onto the worktree branch first (architect-side;
  workers still never git-write themselves)
- Exit codes (from the script and `tests/wt-merge.bats`):

| Code | Meaning |
|---|---|
| 0 | Merged (staged or committed) |
| 2 | `jq` / Python required for metadata update missing |
| 3 | No metadata for that role/slug |
| 4 | Target index already has staged changes |
| 5 | Uncommitted target changes overlap incoming files |
| 7 | Squash merge conflict |

### `wt-cleanup.sh RUN_ID [--force] [--keep-branches]`

- Runs consolidate if `CONSOLIDATED.md` is missing
- Removes worktrees; deletes branches unless `--keep-branches`
- Skips dirty worktrees unless `--force`
- Keeps reports under `~/.foreman/runs/<RUN_ID>/`

Serialize create/remove via the scripts (`flock` when available). Do not mount
`~/.foreman/runs` secrets into untrusted workers.

## 5. The docs stage

After implementation and independent product checks, run:

```bash
bash skills/foreman/scripts/docs-check.sh
bash skills/foreman/scripts/docs-check.sh --json docs-check.json
bash skills/foreman/scripts/docs-check.sh --online   # full link check (network)
```

Tools (fail closed if missing; exit `2`):

| Tool | Config | Default mode |
|---|---|---|
| markdownlint-cli2 | `.markdownlint-cli2.jsonc` | All `**/*.md` except vendored ignores |
| codespell | `.codespellrc` | Repo spell check with skip list |
| lychee | (CLI flags) | Offline local paths unless `--online` |
| comment coverage | (script) | Purpose headers + `@description` on bash functions |

Exit codes: `0` all pass, `1` findings, `2` required tool missing.

**Iterative rework.** On failure, feed the summary (and `docs-check.json` if
present) back to the implementer as a corrected five-part spec. Cap loops with
`[limits] max_rework_rounds` (default `3` in `config/foreman.toml.example`).
Do not hand-fix prose on the architect model while the implementer lane is up.

Hard-mode `checks-run.sh` always runs this stage (unconditionally); soft mode
runs it from the architect session.

## 6. Audits

### Cross-vendor rule

Auditor vendor **must differ** from worker vendor. Default: Grok implements →
Codex GPT-5.6 Sol audits via `codex-auditor` (`--sandbox read-only`, high
reasoning). If Codex implemented, stop with `blocked_same_vendor` and pick another
review path.

### When to audit (soft)

Required after independent verification when any of:

- Multi-file or multi-step deliverable
- Security-sensitive paths (auth, crypto, network, secrets, shell)
- Before declaring a multi-step task done
- After a race between implementers (audit the chosen diff)

Trivial single-file mechanical edits may skip audit if the architect states why.

### Verdict schema

Schema file: `skills/foreman/scripts/adapters/verdict.schema.json`.

```json
{
  "verdict": "APPROVED | WARNING | BLOCKED",
  "findings": [
    {
      "severity": "critical | high | medium | low",
      "file": "path",
      "line": 0,
      "summary": "one line",
      "evidence": "quote or rationale"
    }
  ],
  "summary": "one or two sentences for the architect"
}
```

| Verdict | Soft mode | Hard gate |
|---|---|---|
| APPROVED | Ship if independent checks green | May pass if hashes + forbidden paths clean |
| WARNING | Ship only after architect acknowledges findings | May pass; findings attach to PR body |
| BLOCKED | Rework via implementer with corrected spec | Gate fails |

### What BLOCKED means operationally

- Soft: do not ship; write a corrected five-part spec; send it back to the
  implementer lane; re-verify; re-audit if still non-trivial
- Hard: `gate-eval.sh` fails; no PR
- Architect still owns the ship decision: auditor JSON is gate input, not a
  rubber stamp. Do not ask the auditor to fix code.

## 7. Maintenance and updates

### `maintenance.sh` flags

```bash
# usage: maintenance.sh [--stage upstream|graph|compat|all] [--json PATH] [--strict] [--apply]

bash skills/foreman/scripts/maintenance.sh --stage all
bash skills/foreman/scripts/maintenance.sh --stage upstream
bash skills/foreman/scripts/maintenance.sh --stage graph
bash skills/foreman/scripts/maintenance.sh --stage compat
bash skills/foreman/scripts/maintenance.sh --stage all --json maintenance.json
bash skills/foreman/scripts/maintenance.sh --stage all --strict
bash skills/foreman/scripts/maintenance.sh --stage upstream --apply
```

| Flag | Effect |
|---|---|
| `--stage` | `upstream` (VENDORED hashes), `graph` (graphify update), `compat` (tool-check soft profile), `all` |
| `--json PATH` | Write machine report |
| `--strict` | Exit `3` when upstream drift, stale graph, or compat drift is found |
| `--apply` | Re-vendor listed skills from `~/.claude/skills/<name>` and refresh hashes |

Exit codes: `0` report completed (findings informational unless `--strict`),
`2` bad args / JSON serialization unavailable, `3` strict findings.

### VENDORED.md hash provenance

`skills/VENDORED.md` lists each vendored skill with its origin (an upstream URL,
or local-skill provenance for skills authored in-repo), vendored date, license
pointer, and **content hash**. Hash command (matches `maintenance.sh`):

```bash
find skills/NAME -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
```

Current rows (hashes change when you re-vendor; re-read the file after apply):
scrapling, graphify, superpowers. Local overlays (`*.local.md`, cookie vaults)
are excluded at vendor time and must never be committed.

### Re-vendor procedure

Manual:

```bash
cp -r ~/.claude/skills/<name> skills/ && rm -rf skills/<name>/.git
find skills/<name> -name '*.local.md' -delete
# recompute hash; update skills/VENDORED.md table
```

Or:

```bash
bash skills/foreman/scripts/maintenance.sh --stage upstream --apply
```

### GitHub workflow

`.github/workflows/maintenance.yml` name: "Maintenance and Updates". Triggers:
`release` (published), monthly cron (`0 6 1 * *`), and `workflow_dispatch`. Job
runs `maintenance.sh --stage all --json` and opens an issue when the summary
contains `drift` or `stale`. **Known limit: unexercised until the first real
release**; validate with `workflow_dispatch` first.

## 8. Troubleshooting

### Grok headless writes nothing

**Symptom:** model narrates edits; tree unchanged; evidence digests identical.

**Cause:** the Grok CLI accepts `--permission-mode acceptEdits` but **silently
ignores** that value in headless mode. Tool calls that would prompt are
auto-cancelled.

**Fix:** always pass allow rules (capitalized prefixes):

```bash
grok --prompt-file "$SPEC" \
  -m grok-4.5 \
  --allow "Write" --allow "Edit" \
  --output-format plain \
  --cwd "$(pwd)"
```

Shell stays gated: Grok still cannot delete/rename, chmod, or run verification.
The wrapper agent runs verification; deletions go to `ARCHITECT_ACTIONS`.

### Codex timeout (~600s wall clock)

Implementer and auditor wrappers use `timeout`/`gtimeout` **600** seconds when
present (`agents/codex-*.md`, `references/lanes.md`). On timeout (`STATUS:
timeout`), split the work into smaller five-part specs or a narrower audit diff
and re-route. Do not silently lengthen a single hung call or substitute Claude
under the Codex lane name. As a rule of thumb, if a task is still growing past
most of that ~600s wall clock, stop and split before the hard 600s kill.

### jq on Windows

Hard-mode scripts and some metadata paths prefer `jq`. When `jq` is missing,
only `wt-merge.sh` accepts `python3` or `python`; `wt-new.sh`,
`wt-consolidate.sh`, and `wt-cleanup.sh` require `python3` specifically.
On a Windows-only host where only a `python` command is on PATH (no `python3`
alias/shim), those three scripts fail with a missing-command error even though
Python is installed — use a `python3` alias/symlink (or WSL) for them;
`wt-merge.sh` alone works with plain `python`. Install Python ≥ 3.11 for the
fallback, or install `jq` in WSL for hard mode.
`env/reference-manifest.toml` marks `jq` required for hard/full on WSL.

### bats location

```bash
bash tests/run.sh
```

Looks for `bats` on PATH, then `~/.foreman/tools/bats-core/bin/bats`. Install
hint from the runner:

```bash
git clone https://github.com/bats-core/bats-core ~/.foreman/tools/bats-core
```

Contract is WSL (or Git Bash with bats); PowerShell does not run the suite.

### lychee PATH on fresh shells

`docs-check.sh` resolves `lychee` from PATH, then
`%LOCALAPPDATA%/Microsoft/WinGet/Links/lychee.exe`, then WinGet package folders.
After a winget install, open a **new** shell so PATH and those locations are
visible; otherwise lychee is recorded `missing` and docs-check exits `2`.

### Other frequent failures

| Symptom | Action |
|---|---|
| `STATUS: unavailable` from a lane | Install/auth the CLI; re-route; never fake the lane as Claude |
| `blocked_same_vendor` from codex-auditor | Worker was OpenAI family; pick another auditor |
| wt-merge exit 5 | Overlap with dirty target files; commit, stash, or partition ownership |
| wt-cleanup skips tree | Dirty worktree; commit/merge first or pass `--force` |
| Gate fail closed | Missing audit CLI or checks infra; fix inventory, do not skip gate |

## 9. FAQ

**Why the cost discipline?**  
The session architect model is the expensive lane. It should emit judgment
(specs, routing, verdicts), not implementation volume. Graph-query-first and
cheap implementers keep most tokens off Fable/Opus.

**Why cross-vendor audit?**  
Same-family self-review shares blind spots. Default pairing (Grok implements,
Codex Sol audits, Claude architects) decorrelates review. Same-vendor audit of a
Codex worker via `codex-auditor` is forbidden.

**Can I use only Claude?**  
You can orchestrate without Grok/Codex, but implementer and auditor agents will
report `unavailable` rather than silently typing as Claude. Typing on the host
model is an explicit downgrade the architect must state.

**How do I add a lane?**  
Add an agent under `agents/` with preflight (no silent fallback), evidence
contract, and report format; document routing in
`skills/foreman/references/lanes.md` and `SKILL.md`; install copies agents into
`~/.claude/agents/`. Prefer a vendor CLI that differs from the architect for
implement and from the worker for audit.

**Where does run state live?**  
`$FOREMAN_HOME/runs/<run-or-task-id>/` (default `~/.foreman/runs/`), including
worktree metadata, reports, `CONSOLIDATED.md`, and hard-mode evidence. Worktrees
themselves sit as siblings of the repo root:
`<parent>/<repo>-wt-<RUN_ID>-<role>[-slug]/`.

**Soft vs hard: which should I use?**  
Soft for interactive Claude sessions with Grok/Codex CLIs. Hard when you need
scripted INIT→GATE enforcement, host evidence, and forbidden-path gates. Hard
IMPLEMENT (`worker-run.sh`) is still a stub; use soft agents for typing.

**What is OpenSpec in this repo?**  
`openspec/README.md` defines change folders under `openspec/changes/<name>/`
(proposal, specs, design, tasks). Workflow: propose → approve → implement via
Foreman lanes → archive. Legacy specs remain in `docs/superpowers/specs/`.

**How do I preview the docs site?**  
See `site/README.md`: `python -m http.server 8080 --directory site` or open
`site/index.html` directly.
