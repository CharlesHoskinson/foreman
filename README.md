# Foreman

Cross-vendor architect/worker orchestration for coding agents. An architect
session routes self-contained five-part specs to implementer and auditor lanes,
re-runs verification on the real tree, and ships only after an independent cold
diff review. Soft mode is the path that works today. Hard mode adds scripted
gates; parts of that path are still stubs (called out below).

A short flag table also lives in [`docs/USAGE.md`](docs/USAGE.md). This README
is the teaching document: install, run one task end to end, and understand why
each subsystem exists.

## 1. What Foreman is and the problem it solves

A single model session that plans, types, tests, and declares "done" fails in
predictable ways. The expensive session model burns tokens on boilerplate while
you still need it for architecture decisions. Same-family self-review shares
blind spots: the model that wrote a subtle bug often fails to see it. Ungoverned
edits land on the main checkout where a concurrent session can collide, or where
a narrated "I fixed it" leaves the tree unchanged. Unverifiable success reports
look green until someone re-runs the command and finds nothing changed.

Foreman answers with a split. The **architect** (session model, typically Claude
Fable or Opus) owns judgment: inventory, specs, routing, independent
verification, ship-or-rework. **Workers** type code under a cold five-part
spec with no chat history. An **auditor** on a different vendor family reviews
only the diff and the acceptance criteria. An **advisor** is consulted only at
commitment boundaries and never implements. Reports are claims. Digests of HEAD
and `git status` before and after a worker run make silent no-ops visible.

The default soft pairing is deliberate: Grok 4.5 implements, the architect
re-runs checks, Codex GPT-5.6 Sol audits read-only, then the architect ships.
Cross-vendor review is the point. Same-vendor audit of a same-family worker is
forbidden because it reintroduces the blind spot the split was built to kill.

## 2. The mental model

Four roles, four producers, one host-side run directory that never lives inside
a worktree:

```text
                         ┌──────────────────────────────┐
                         │   ARCHITECT  (session model)  │
                         │   Claude Fable / Opus         │
                         │   owns: specs · routing ·     │
                         │   verification · ship call    │
                         └───────────────┬──────────────┘
                        writes five-part specs, reads diffs
          ┌──────────────────┬───────────┴───────┬──────────────────┐
          ▼                  ▼                   ▼                  ▼
  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
  │ grok-         │  │ codex-        │  │ codex-        │  │ foreman-      │
  │ implementer   │  │ implementer   │  │ auditor       │  │ advisor       │
  │ Grok 4.5      │  │ GPT-5.6 Sol   │  │ GPT-5.6 Sol   │  │ Claude        │
  │ (types code)  │  │ (types code)  │  │ (read-only)   │  │ (judgment)    │
  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘
          │                  │                   │                  │
          └──────────────────┴─────────┬─────────┴──────────────────┘
                                        ▼
                        ~/.foreman/runs/<id>/   (host run-state,
                        reports + evidence — never inside a worktree)
```

The architect keeps context lean: emit specs, routing decisions, and short
verdicts; do not re-type implementation bodies on the session model while a
worker CLI is available. Workers receive only the five-part spec. They never
run git write commands (`commit`, `add`, `reset`, `branch`, `push`, `rebase`,
`merge`, `tag`). Deletions and renames go in `ARCHITECT_ACTIONS` for the
architect to apply. That rule prevents a worker from rewriting history or
landing a half-finished commit the architect never reviewed.

The auditor is paid to disagree. It gets a cold unified diff and the acceptance
criteria, not the worker's transcript. If the worker was already Codex/OpenAI,
`codex-auditor` stops with `STATUS: blocked_same_vendor` so the architect picks
another review path. The advisor answers architecture, migration, API shape,
or "failed twice" questions in under ~300 words and does not edit files. Decorrelated
failure modes beat one model grading its own homework.

## 3. The soft loop

Soft mode is the default. Config `mode = "hard"` in `.foreman/config.toml` or
an explicit user request switches to hard mode. Soft is the interactive loop:

```text
   inventory ──► recon ──► implement ──► verify + audit ──► land
   tool-check   wt-new     five-part     architect re-runs   wt-merge
                search/    spec ──►       checks; codex-      wt-cleanup
                plan       grok or        auditor cold diff
                           codex in         │
                           a worktree        │ WARNING / BLOCKED
                              ▲               │
                              └───── rework ──┘   (corrected spec,
                                                   cheaper lane)
```

**Inventory** — Before multi-step work, run `env/tool-check.sh` (or
`env/tool-check.ps1` on Windows) for profile `soft`. Exit `0` means READY; exit
`1` means missing or outdated must-tools. Bootstrap gaps with
`env/bootstrap-windows.ps1` or `env/bootstrap-wsl.sh`, then re-check. Auth is
never automated: after install, run `grok login` and `codex login` when those
CLIs are new. Starting implement while must-tools fail is how you get
`STATUS: unavailable` mid-task and a silent temptation to fake the lane on
Claude.

**Recon** — One `RUN_ID` for the session. `wt-new` for `search` and `plan`
(and later `audit` / `implement`). Spawn `foreman-search` and `foreman-plan` in
parallel, each with cwd set to its worktree. Each writes `FOREMAN_REPORT.md`
and `FOREMAN_REPORT.json`. `wt-consolidate` copies reports into
`~/.foreman/runs/<RUN_ID>/` and writes `CONSOLIDATED.md`. Do not ship on one
partial report.

**Implement** — Write a five-part spec. Route to `grok-implementer` by default
(or race `codex-implementer`) inside an implement worktree. The main checkout
is never the implementer target in soft multi-step work.

**Verify + audit** — Architect reads the real diff, re-runs the Verification
command, then sends a cold diff to `codex-auditor` when the work is non-trivial.
`APPROVED` with green checks may ship. `WARNING` ships only if the architect
accepts the findings. `BLOCKED` means rework: corrected spec back to the
implementer lane, not hand-patching on the architect model.

**Land** — `wt-merge` squash-applies the implement branch as staged changes
(optional `--commit`). `wt-cleanup` removes worktrees and keeps reports under
`~/.foreman/runs/`.

## 4. Lanes and routing

| Lane | Producer | Agent | Role |
|---|---|---|---|
| Routine implementer | Grok 4.5 | `grok-implementer` | Default typing lane when the spec fully determines the outcome |
| Cross-vendor implementer | GPT-5.6 Sol (high) | `codex-implementer` | Race / second implementation, or Grok unavailable |
| Audit (default) | GPT-5.6 Sol (high), read-only | `codex-auditor` | Cold diff + acceptance criteria; vendor must differ from the worker |
| Judgment | Claude Fable / Opus | `foreman-advisor` | Commitment boundaries only; never implements |

**grok-implementer** drives the xAI Grok CLI headless (`-m grok-4.5`). It is
the cheap typing lane for fully determined specs. Preflight requires `grok` on
PATH; missing CLI returns `STATUS: unavailable` and never implements as Claude
under that lane name.

**codex-implementer** drives `codex exec` with `--model gpt-5.6-sol`,
`-c model_reasoning_effort=high`, and `--sandbox workspace-write`. Use it to
race Grok when mistakes are costly, or when Grok is unavailable. Same no-silent-fallback
rule.

**codex-auditor** drives Codex read-only (`--sandbox read-only`) with schema-forced
verdict JSON (`skills/foreman/scripts/adapters/verdict.schema.json`). It never
implements product code. After the run, `git status --porcelain` must show no
auditor mutations.

**foreman-advisor** is read-only judgment at commitment boundaries. If `model: fable`
is unavailable, the host may pin Opus with the same contract.

```text
              how much does the outcome depend on judgment
                      the spec cannot capture?
                                │
             ┌──────────────────┼───────────────────┐
           little             some                  a lot / costly
             │                  │                        │
             ▼                  ▼                        ▼
     grok-implementer   race grok +             keep with architect,
     (default lane)     codex-implementer       or consult
                        pick stronger diff       foreman-advisor
             │                  │                        │
             └──────────────────┴────────────────────────┘
                                │
                                ▼
             worker diff ─► architect re-runs checks
                          ─► cold-diff audit by a vendor ≠ the winning
                             diff's vendor:
                               Grok won  ─► codex-auditor (GPT-5.6 Sol)
                               Codex won ─► architect review or a
                                            non-OpenAI auditor (never
                                            codex-auditor on a Codex diff)
```

If a lane returns `unavailable` or `timeout`, re-route and say so in the
session. Never absorb a vendor substitution under the original lane's name.
Never use the implementer lane to audit itself. If Codex implemented, do not
audit with codex-auditor — pick a non-OpenAI auditor or the architect instead.
Default pairing:

```text
Grok implements → architect re-runs checks → Codex Sol audits → architect ships
```

## 5. The five-part spec

Implementers share none of the architect's conversation. Every handoff carries
exactly five parts. A weak part produces a predictable failure mode.

1. **Objective** — What to build or change and why (one paragraph). Vague
   objectives produce drive-by scope expansion.
2. **Files** — Exact create / modify / do-not-touch paths. Missing paths let
   the worker invent locations or edit protected trees.
3. **Interfaces** — Signatures, types, HTML IDs, CSS tokens, CLI flags, exit
   codes the code must match. Empty interfaces mean the decision is unfinished;
   finish architect work before delegating.
4. **Constraints** — Conventions, forbidden zones, standing rules. Weak
   constraints invite new dependencies, refactors, and git writes.
5. **Verification** — Exact command(s) the architect will re-run. Without this,
   "should work" is not a completion criterion.

Template: `skills/foreman/references/five-part-spec.md`.

**Standing constraints** (paste into every Constraints section):

- NEVER run git write commands. Changes stay uncommitted in the working tree.
- Do not delete or rename files. List needed deletions/renames under
  `ARCHITECT_ACTIONS`.
- Work only inside the provided worktree path. Never write outside it.
- No network access unless the spec explicitly grants it.
- Documentation and comments are part of the deliverable: markdown passes
  markdownlint-cli2; bash functions carry shdoc headers (`# @description`
  minimum); scripts carry a top-of-file purpose comment.

### EARS phrasing (required for Grok-bound specs)

EARS (Easy Approach to Requirements Syntax) uses a closed keyword set so
requirements stay testable:

| Pattern | Template |
|---|---|
| Ubiquitous | The implementer SHALL \<response\>. |
| Event-driven | WHEN \<trigger\>, the implementer SHALL \<response\>. |
| State-driven | WHILE \<precondition\>, the implementer SHALL \<response\>. |
| Optional feature | WHERE \<feature is included\>, the implementer SHALL \<response\>. |
| Unwanted behavior | IF \<unwanted condition\>, THEN the implementer SHALL \<response\>. |
| Complex | WHILE \<precondition\>, WHEN \<trigger\>, the implementer SHALL \<response\>. |

Worked example:

> WHEN computing the dirty file set, the script SHALL build it as the sorted
> union of `git diff --name-only`, `git diff --name-only --cached`, and
> `git ls-files --others --exclude-standard`.
> IF a fix would require changing unrelated logic, THEN the implementer SHALL
> stop and report the gap instead of expanding scope.

## 6. Worktree isolation

Parallel agents on one shared checkout collide. A concurrent session can commit
to main mid-run; two agents can overwrite the same file; a dirty index can
absorb foreign edits. Soft multi-step work therefore fans out under one
`RUN_ID` into sibling worktrees. Scripts live under `skills/foreman/scripts/`.

```text
  RUN_ID ─┬─ wt-new search  ─► [worktree] search agent  ─► FOREMAN_REPORT.md
          ├─ wt-new plan    ─► [worktree] plan agent    ─► FOREMAN_REPORT.md
          └─ wt-new implement ► [worktree] grok/codex    ─► code + report
                                        │
                       wt-consolidate ──┘  copies reports ─► ~/.foreman/runs/<id>/
                                        │
                        architect reads, decides
                                        │
                       wt-merge ────────┘  squash-applies branch as STAGED
                                           changes (refuses on overlap/dirty/
                                           conflict); architect commits
                                        │
                       wt-cleanup ──────┘  removes worktrees, keeps reports
```

### Script contracts

**`wt-new.sh RUN_ID ROLE [SLUG] [BASE_REF]`** — Roles:
`search | plan | audit | implement | advisor | misc`. Creates a sibling
worktree, branch `foreman/<RUN_ID>/<role>[/<slug>]`, report scaffolds, and
metadata under `~/.foreman/runs/<RUN_ID>/worktrees/`. Prints the worktree path.
Exit `2` on bad id/role/slug or if the path already exists. Requires `git` and
`jq` or `python3`.

**`wt-consolidate.sh RUN_ID`** — Copies each tree's `FOREMAN_REPORT.*` into
`~/.foreman/runs/<RUN_ID>/reports/` and writes `CONSOLIDATED.md`. Does not
remove worktrees. Exit `2` if no worktrees index.

**`wt-merge.sh RUN_ID ROLE [SLUG] [--commit]`** — Squash-applies the worktree
branch onto the current branch. Default is **staged only**; `--commit` creates
one merge commit. Before merge analysis, the script commits pending worker
changes onto the worktree's own branch (architect-side only; workers still never
git-write). Exit codes:

| Code | Meaning |
|---|---|
| 0 | Merged (staged or committed) |
| 2 | `jq` / Python required for metadata update missing |
| 3 | No metadata for that role/slug |
| 4 | Target index already has staged changes |
| 5 | Uncommitted target changes overlap incoming files |
| 7 | Squash merge conflict |

Those refusals exist so a merge never silently interleaves with uncommitted
work on the target branch.

**`wt-cleanup.sh RUN_ID [--force] [--keep-branches]`** — Runs consolidate if
`CONSOLIDATED.md` is missing, removes worktrees, deletes branches unless
`--keep-branches`, skips dirty trees unless `--force`, keeps reports under
`~/.foreman/runs/<RUN_ID>/`.

Layout of worktrees (siblings of the repo root):

```text
<parent>/<repo>-wt-<RUN_ID>-search/
<parent>/<repo>-wt-<RUN_ID>-plan/
<parent>/<repo>-wt-<RUN_ID>-implement[-slug]/
```

Serialize create/remove through the scripts (`flock` when available). Do not
mount `~/.foreman/runs` into untrusted workers.

## 7. The evidence contract

Lane reports are claims, not proof. The failure mode is familiar: the model
narrates a full edit pass, the report says complete, and `git status` is empty.
The evidence contract makes that visible.

```text
   before:  HEAD_B = git log -1            after:  HEAD_A = git log -1
            DIG_B  = sha256(status)                DIG_A  = sha256(status)
                        │                              │
                        └──────────► run CLI ◄─────────┘
                                       │
              ┌────────────────────────┴─────────────────────────┐
        HEAD_B == HEAD_A                                 HEAD_B != HEAD_A
        DIG changed = real edits                         unauthorized commit:
        (expected)                                       flag it, do not trust
                                                         the "success" report
```

Wrappers record, before and after the CLI:

```bash
HEAD_B=$(git log -1 --format=%H 2>/dev/null || echo none)
DIG_B=$(git status --porcelain | sha256sum | cut -d' ' -f1)
# ... run grok or codex ...
HEAD_A=$(git log -1 --format=%H 2>/dev/null || echo none)
DIG_A=$(git status --porcelain | sha256sum | cut -d' ' -f1)
```

If `HEAD_B != HEAD_A`, set `unauthorized_git_activity: true` and list
`git log --oneline HEAD_B..HEAD_A`. Workers must not commit; a HEAD move is a
contract break.

### Motivating bug: Grok headless write cancellation

The Grok CLI's `--permission-mode` flag only honors `bypassPermissions` and
`default`. Passing `--permission-mode acceptEdits` is accepted on the command
line but **silently ignored**. In headless runs, tool calls that would prompt
are auto-cancelled. Symptom: Grok narrates edits while writing nothing;
`DIG_B == DIG_A`. Fix used by `grok-implementer`:

```bash
grok --prompt-file "$SPEC" \
  -m grok-4.5 \
  --allow "Write" --allow "Edit" \
  --output-format plain \
  --cwd "$(pwd)"
```

Capitalized rule prefixes auto-approve file writes and edits only. Shell stays
gated: Grok still cannot delete/rename files, chmod, or run verification for
you. The wrapper re-runs verification; deletions stay in `ARCHITECT_ACTIONS`.

## 8. Verification and the audit lane

Reports are claims. Before accepting worker output the architect:

1. Reads the actual diff (`git status`, `git diff`)
2. Re-runs the Verification command and records the real output
3. Confirms evidence digests moved when the model claimed edits
4. Runs the docs stage when docs or scripts changed (section 9)
5. Invokes `codex-auditor` on non-trivial work with cold diff + criteria

Wrong code goes back to the implementer as a corrected five-part spec. Do not
hand-patch large bodies on the architect model while the lane is up. Do not ask
the auditor to fix code.

### When to audit (soft)

Required after independent verification when any of:

- Multi-file or multi-step deliverable
- Security-sensitive paths (auth, crypto, network, secrets, shell)
- Before declaring a multi-step task done
- After a race between implementers (audit the chosen diff)

Trivial single-file mechanical edits may skip audit if the architect states why.

### Verdicts

Schema: `skills/foreman/scripts/adapters/verdict.schema.json`.

| Verdict | Soft mode | Hard gate |
|---|---|---|
| APPROVED | Ship if independent checks green | May pass if hashes + forbidden paths clean |
| WARNING | Ship only after architect acknowledges findings | May pass; findings attach to PR body |
| BLOCKED | Rework via implementer with corrected spec | Gate fails |

**BLOCKED** operationally means: do not ship; write a corrected five-part spec;
send it back to the implementer; re-verify; re-audit if still non-trivial. Hard
mode: `gate-eval.sh` fails and `pr-open.sh` refuses. Auditor JSON is input to
the architect's ship decision, not a rubber stamp.

### Worked example: dot-name `rm -rf`

A real audit-caught case involved cleanup that globbed **dot-named** entries
under a directory and passed them to `rm -rf`. In bash, a pattern like
`somedir/.*` expands to include `somedir/.` and `somedir/..`. Recursive remove
on that expansion can walk upward and delete far more than the intended
`.git` or overlay file. Codex returned **BLOCKED** with the expansion risk
cited. The fix was named targets only (for example
`rm -rf skills/<name>/.git`), never a bare dot-glob. That is why shell-touching
diffs need cold audit even when the "happy path" looks fine in the worker
transcript.

Hard-mode `audit-run.sh TASK_ID` enforces `audit.vendor != worker.vendor`
(config defaults: worker `grok`, audit `codex` / `gpt-5.6-sol`), builds a cold
prompt from `task.md` / `plan.md` and the patch, runs Codex with the verdict
schema, and fails if the auditor mutates the worktree.

## 9. The documentation stage

After implementation and product checks, run:

```bash
bash skills/foreman/scripts/docs-check.sh
bash skills/foreman/scripts/docs-check.sh --json docs-check.json
bash skills/foreman/scripts/docs-check.sh --online   # full link check (network)
```

| Tool | Config | Default mode |
|---|---|---|
| markdownlint-cli2 | `.markdownlint-cli2.jsonc` | All `**/*.md` except vendored ignores |
| codespell | `.codespellrc` | Repo spell check with skip list |
| lychee | (CLI flags) | Offline local paths unless `--online` |
| comment coverage | (script) | Purpose headers + `@description` on bash functions |

Exit codes: `0` all pass, `1` findings, `2` required tool missing (fail closed).

Missing tools fail closed on purpose. A missing linter that "passes" is how
broken docs ship. On failure, feed the summary (and `docs-check.json` if
present) back to the implementer as a corrected five-part spec. Cap loops with
`[limits] max_rework_rounds` (default `3` in `config/foreman.toml.example`).

Hard-mode `checks-run.sh` always runs this stage. Soft mode runs it from the
architect session. Product checks in hard mode run from a pristine commit
archive; the docs-check sub-stage runs from the **caller cwd**, not the
archive. That mismatch is intentional for local config discovery and is called
out so you do not assume archive isolation for docs tools.

## 10. Hard mode

Opt in with `.foreman/config.toml` `mode = "hard"` or by asking for hard mode.
Loop:

```text
  INIT ─► PLAN ─► IMPLEMENT ─► CHECK ─► EVIDENCE ─► AUDIT ─► GATE ─► PR
  task-   plan    worker-run   checks-  evidence-   audit-   gate-   pr-open
  new.sh  file    (STUB)       run.sh   collect.sh  run.sh   eval.sh (stub)
                     ▲                                          │
                     │                                          │ GATE fails if:
                     └──────────── rework ──────────────────────┤  · forbidden path
                        (≤ max_rework_rounds)                    │  · hash drift
                                                                 │  · checks not green
                                                                 │  · audit BLOCKED
                                                                 ▼
                                                        fail closed → no PR
```

| Stage | Script / action | Status |
|---|---|---|
| **INIT** | `skills/foreman/scripts/task-new.sh TASK_ID [BASE]` | **Shipped** — worktree + envelope + hash snapshot of protected paths |
| **PLAN** | Architect writes `plan.md` into the run dir | Process — file handoff only |
| **IMPLEMENT** | `skills/foreman/scripts/worker-run.sh` | **Stub** — containerized Docker worker not shipped; use soft agents |
| **CHECK** | `skills/foreman/scripts/checks-run.sh TASK_ID` | **Shipped** — product checks from a pristine commit archive, not the dirty tree |
| **EVIDENCE** | `skills/foreman/scripts/evidence-collect.sh TASK_ID` | **Shipped** — host-side bundle under `~/.foreman/runs/` |
| **AUDIT** | `skills/foreman/scripts/audit-run.sh TASK_ID` (host Codex Sol) | **Shipped** — cold diff; Docker worker audit path still expanding |
| **GATE** | `skills/foreman/scripts/gate-eval.sh TASK_ID` | **Shipped** — forbidden paths + hash drift + checks green + not BLOCKED |
| **PR** | `skills/foreman/scripts/pr-open.sh TASK_ID` | **Partial stub** — refuses without gate pass; full `gh pr create` not shipped |

### Honest limits

- `worker-run.sh` exits with missing-CLI status and prints that containerized
  workers are not implemented; soft mode uses `grok-implementer` /
  `codex-implementer` instead.
- `pr-open.sh` requires a passed gate, then exits missing-CLI: automation stops
  short of `gh pr create`. Push and open the PR manually with the evidence
  summary.
- There is no shipped orchestrator-vendor equality check because `worker-run.sh`
  is a stub. Shipped hard-mode tooling enforces **audit vendor ≠ worker vendor**
  in `audit-run.sh`.
- Docs-check inside `checks-run.sh` runs from caller cwd (see section 9).

Run state lives in `$FOREMAN_HOME/runs/<task-id>/` (default `~/.foreman/runs/`),
outside every worktree. `task-new.sh` creates a worktree at
`<parent>/<repo>-<TASK_ID>` on branch `ai/<TASK_ID>`, writes `meta.json`,
`task.md`, and `hashes.txt` for configured `gate.hash_paths`.

`gate-eval.sh` fails closed when any of: forbidden paths touched, protected
hash drift since INIT, checks status not `pass`, audit verdict missing/invalid
or `BLOCKED`, or `docs-check.json` missing/not pass. Default forbidden globs
include `tests/**`, `.github/**`, `.foreman/**`, `*.lock`, `package-lock.json`.

## 11. Repo understanding (knowledge graph)

This repo commits a knowledge graph at `graphify-out/graph.json`. For concepts,
architecture, or file relationships, query first:

```bash
graphify query "<question>" --budget 1500
```

Follow `source_location` pointers into files only for the facts you need.
Measured saving versus raw file reads: **45–77%** of tokens on budget-capped
queries against the live graph (token experiments recorded in the enhancement
design notes). The budget flag caps answer size so a broad question does not
dump the whole graph into context.

If the graph is stale relative to HEAD, check `graphify-out/GRAPH_REPORT.md`
and refresh with `graphify --update`, or note the staleness in your answer.
Stale graphs send you to wrong `source_location` lines; treating them as current
is how "truth-audited" claims drift from the tree.

Project doctrine (`CLAUDE.md`, skill body) pins this query-first rule for
architect sessions so recon does not open half the tree by default.

## 12. Maintenance and updates

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

Exit codes: `0` report completed (findings informational unless `--strict`),
`2` invalid arguments or unavailable JSON serialization, `3` `--strict` found
upstream drift, a stale graph, or compatibility drift.

### Content hashes and the CRLF lesson

`skills/VENDORED.md` records provenance, license pointer, and content hash for
scrapling, graphify, and superpowers. Hash command (matches `maintenance.sh`):

```bash
find skills/NAME -type f -print0 | sort -z | while IFS= read -r -d '' f; do
  printf '%s\0' "$f"
  tr -d '\r' < "$f"
done | sha256sum | cut -d' ' -f1
```

`tr -d '\r'` strips carriage returns before hashing. Without that strip, a
Windows checkout that rewrites line endings to CRLF reports false **drift**
against a Linux-recorded hash even when the logical content matches. The lesson:
normalize line endings in the hash pipeline, or maintenance becomes noise.

`--apply` re-vendors listed skills from `~/.claude/skills/<name>`, drops
nested `.git`, and refreshes recorded hashes. Local overlays (`*.local.md`,
cookie vaults) must never be committed.

### Release workflow

`.github/workflows/maintenance.yml` ("Maintenance and Updates") runs on release
publish, monthly cron (`0 6 1 * *`), and `workflow_dispatch`. **CI runs only
`--stage upstream`**: Graphify and developer CLIs are not assumed present on
`ubuntu-latest`, so graph and compat stages are not meaningful there. Local or
full-profile hosts run `--stage all`. The workflow opens an issue when the
JSON summary contains `drift` or `stale`. **It has not been exercised by a real
release yet**; validate with `workflow_dispatch` first.

### Tests

**27** bats tests across `tests/docs-check.bats`, `gate-eval.bats`,
`maintenance.bats`, `wt-merge.bats`, `wt-new.bats`. Runner:

```bash
bash tests/run.sh
```

`tests/run.sh` finds `bats` on PATH or `~/.foreman/tools/bats-core`. Contract
is WSL (or Git Bash with bats); PowerShell does not run the suite.

## 13. A full worked walkthrough

Example multi-step task: document a small behavior under `site/`, land it with
worktree isolation, verification, and cross-vendor audit.

### 13.1 Inventory

Windows:

```powershell
.\env\tool-check.ps1 -Profile soft -Json -Out $env:USERPROFILE\.foreman\last-tool-check.json
# if READY: no
.\env\bootstrap-windows.ps1 -Profile soft -Yes
.\env\tool-check.ps1 -Profile soft
```

WSL / macOS / Linux:

```bash
bash env/tool-check.sh --profile soft --json --out ~/.foreman/last-tool-check.json
bash env/bootstrap-wsl.sh --profile soft --yes
bash env/tool-check.sh --profile soft
```

### 13.2 Boot the architect

```powershell
cd path\to\foreman
claude
```

Inside the session:

```text
/model fable
/foreman
```

Restate goal and mode. Soft unless config or user says hard. Project
`CLAUDE.md` pins architect doctrine.

Example first prompt:

```text
Soft mode. Add a small feature under site/ that documents the docs-check stage.
Write a five-part spec, route implementation to grok-implementer,
verify independently, audit with codex-auditor (GPT-5.6 Sol),
consult foreman-advisor only if the information architecture is ambiguous.
```

### 13.3 Recon worktrees

```bash
RUN=run-$(date +%Y%m%d-%H%M%S)
bash skills/foreman/scripts/wt-new.sh "$RUN" search
bash skills/foreman/scripts/wt-new.sh "$RUN" plan
```

Spawn `foreman-search` and `foreman-plan` in parallel with cwd set to each
worktree. Each must write `FOREMAN_REPORT.md` and `FOREMAN_REPORT.json`
(schema `foreman.worktree-report.v1`).

```bash
bash skills/foreman/scripts/wt-consolidate.sh "$RUN"
```

Read `~/.foreman/runs/$RUN/CONSOLIDATED.md`. Synthesize the five-part spec.

### 13.4 Implement

```bash
bash skills/foreman/scripts/wt-new.sh "$RUN" implement docs-stage
```

Route the full five-part spec to `grok-implementer` with that worktree as cwd.
Standing rule: implementers never git-write; changes stay uncommitted until
merge.

### 13.5 Architect verify

1. `git -C <implement-wt> status` and `git diff`
2. Re-run the Verification command from the spec
3. Confirm evidence digests moved when the model claimed edits
4. Run `bash skills/foreman/scripts/docs-check.sh` when docs changed

### 13.6 Audit

```bash
bash skills/foreman/scripts/wt-new.sh "$RUN" audit
```

Pass to `codex-auditor` (or `foreman-audit` wrapper): worker vendor, acceptance
criteria from the five-part spec, cold unified diff. After the run,
`git status --porcelain` in the audit tree must show no auditor mutations.

### 13.7 Land

```bash
bash skills/foreman/scripts/wt-consolidate.sh "$RUN"
bash skills/foreman/scripts/wt-merge.sh "$RUN" implement docs-stage
# optional: --commit for a single merge commit; default is staged only
# architect commits when ready
bash skills/foreman/scripts/wt-cleanup.sh "$RUN" --force
# --force is required: report files are intentionally never merged, so
# these worktrees are always "dirty"; reports are already archived under
# ~/.foreman/runs/$RUN/ by wt-consolidate
```

Consult `foreman-advisor` only at commitment boundaries.

## 14. Install, quickstart, troubleshooting

### Install (Windows / PowerShell)

```powershell
cd path\to\foreman
.\install.ps1
```

### Install (WSL / macOS / Linux)

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

**Honest-link behavior** — If a destination already exists as a real directory
(not a junction/symlink), install **skips it with a warning** and never replaces
it. That protects local overlays such as `*.local.md`. Existing links that
already point at this checkout (or a shared common-skills tree) are left as-is.

Soft mode uses Claude Code as the typical architect host, but Claude Code is
not required by the harness itself. Orchestration works from Grok or Codex
instead. Authenticated `grok` (default implementer) and authenticated `codex`
(default auditor, GPT-5.6 Sol) remain required for their lanes. Missing lanes
report `STATUS: unavailable`; they never silently become Claude.

### Quickstart

```powershell
cd path\to\foreman
claude
```

```text
/model fable
/foreman
```

Then inventory tools (section 13.1) and run the soft loop.

### Troubleshooting

#### Grok headless writes nothing (required gotcha)

**Symptom:** model narrates edits; tree unchanged; evidence digests identical.

**Cause:** `--permission-mode acceptEdits` is accepted but **silently ignored**
in headless mode. Tool calls that would prompt are auto-cancelled.

**Fix:** always pass allow rules (capitalized prefixes):

```bash
grok --prompt-file "$SPEC" \
  -m grok-4.5 \
  --allow "Write" --allow "Edit" \
  --output-format plain \
  --cwd "$(pwd)"
```

#### Codex timeout (~600s wall clock)

Implementer and auditor wrappers use `timeout`/`gtimeout` **600** seconds when
present. On `STATUS: timeout`, split into smaller five-part specs or a narrower
audit diff and re-route. Do not silently lengthen a hung call or substitute
Claude under the Codex lane name.

#### jq on Windows

Hard-mode scripts and some metadata paths prefer `jq`. When `jq` is missing,
only `wt-merge.sh` accepts `python3` or `python`; `wt-new.sh`,
`wt-consolidate.sh`, and `wt-cleanup.sh` require `python3` specifically. On a
Windows-only host with only `python` on PATH, those three fail even though
Python is installed. Use a `python3` alias/shim or WSL. Install Python ≥ 3.11
for the fallback, or install `jq` in WSL for hard mode.

#### bats location

```bash
bash tests/run.sh
```

Looks for `bats` on PATH, then `~/.foreman/tools/bats-core/bin/bats`. Install
hint:

```bash
git clone https://github.com/bats-core/bats-core ~/.foreman/tools/bats-core
```

#### lychee PATH on fresh shells

`docs-check.sh` resolves `lychee` from PATH, then
`%LOCALAPPDATA%/Microsoft/WinGet/Links/lychee.exe`, then WinGet package folders.
After a winget install, open a **new** shell so PATH updates are visible;
otherwise lychee is `missing` and docs-check exits `2`.

#### Other frequent failures

| Symptom | Action |
|---|---|
| `STATUS: unavailable` from a lane | Install/auth the CLI; re-route; never fake the lane as Claude |
| `blocked_same_vendor` from codex-auditor | Worker was OpenAI family; pick another auditor |
| wt-merge exit 5 | Overlap with dirty target files; commit, stash, or partition ownership |
| wt-merge exit 3 | Missing metadata; wrong RUN_ID / role / slug |
| wt-merge exit 4 | Target index already staged; commit or reset first |
| wt-merge exit 7 | Squash conflict; resolve or rework the branch |
| wt-cleanup skips tree | Dirty worktree; merge first or pass `--force` |
| Gate fail closed | Missing audit CLI, checks, or docs-check; fix inventory, do not skip gate |

## 15. Security model, layout, license, lineage

### Security model

Soft mode runs implementer CLIs on the host with their native sandboxes only.
Hard mode adds Docker worker constraints when that path is used, host-side
evidence that is never mounted into the worker, forbidden-path and hash gates,
and cold-diff audit.

Containers (hard mode) share the host/WSL2 kernel — defense-in-depth, not a hard boundary.

Full map: `skills/foreman/references/security-model.md`.

### Layout

```text
foreman/
├── skills/foreman/          # skill: SKILL.md, references/, scripts/
├── skills/graphify/         # vendored: knowledge graph
├── skills/scrapling/        # vendored: fetch / scrape helpers
├── skills/superpowers/      # vendored: planning, TDD, debugging, code-review, git-worktree skills
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

### License

Apache License 2.0. See [LICENSE](LICENSE).

The vendored superpowers skill keeps its own upstream MIT license as recorded
in `skills/VENDORED.md` (see also `skills/superpowers/LICENSE`). Scrapling and
graphify license pointers are listed in the same table.

### Lineage

- Soft routing doctrine inspired by [DannyMac180/fable-advisor](https://github.com/DannyMac180/fable-advisor)
- Hard harness design from the original Foreman orchestrator/worker spec
- Change-folder conventions follow [OpenSpec](https://github.com/Fission-AI/OpenSpec) (see `openspec/README.md`)
