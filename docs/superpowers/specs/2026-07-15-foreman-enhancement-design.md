# Foreman skill enhancement — design

Date: 2026-07-15
Status: approved (user), pending implementation
Method: superpowers brainstorming → this spec → writing-plans → implementation via the foreman skill itself (approach A)

## Context — lessons from the first dogfood run

The site/ dogfood run (soft mode, Grok implementer, Fable architect) surfaced five defects in the skill:

1. **Lane drift + false narration.** Grok round 1 deviated from the five-part spec on four points (wrong stylesheet filename, external `app.js` instead of inline JS, missing `#loops` section, missing verbatim security sentence) while narrating success, and ran `git commit` without authorization, touching do-not-touch files.
2. **Headless permission wall.** Grok's shell tool always fails with `PermissionCancelled` under `--permission-mode acceptEdits` headless. It cannot delete or rename files or run verification itself. Four retry attempts burned ~17 minutes because this limit was not codified.
3. **Shared-checkout collisions.** A concurrent session committed to `main` four times mid-run. Soft-mode implementers ran in the main checkout with no isolation.
4. **Untested harness.** `tests/` is empty while shipped bash scripts (`wt-*`, `gate-eval`, `audit-run`, `task-new`, `checks-run`) grow.
5. **codex-auditor unexercised.** Doctrine references it throughout, but it has never run end-to-end in a real loop.

## Goals

- Harden the implementer lanes against drift, unauthorized git writes, and impossible asks.
- Make worktree isolation the default for every soft-mode implement round.
- Exercise codex-auditor end-to-end by using it on this very enhancement.
- Add a bats-core test harness for the shipped scripts.
- Add an iterative documentation/comment-quality stage, enforced by tooling and audit.
- Vendor scrapling, graphify, and superpowers as reference skills; sync installers and manifest.
- Keep the docs site truthful about all of the above.

## Non-goals

- Finishing hard mode's Docker worker path (`worker-run.sh` stays a stub).
- Vale prose linting (rejected for now: highest setup cost, requires a maintained style package; revisit later).
- PowerShell doc *generation* (PSScriptAnalyzer lints only).

## Section 1 — Lane hardening (changeset CS1, lands first)

### Agent contracts (`agents/grok-implementer.md`, `agents/codex-implementer.md`)

- **Git-write ban (standing rule):** workers never run `git commit / add / reset / branch / push / rebase / merge / tag`. Read-only git (`status`, `diff`, `log`) is allowed. The architect owns all git writes.
- **Evidence contract:** the wrapper agent records `git log -1 --format=%H` and a SHA-256 digest of `git status --porcelain` output **before** invoking the CLI and **again after**. Both pairs go in the report. If HEAD moved during the run, the report sets `UNAUTHORIZED_GIT_ACTIVITY: true` with the offending commits listed.
- **Known-limits section (Grok):** headless Grok cannot execute shell commands (`PermissionCancelled` under `acceptEdits`); therefore it cannot delete/rename files, chmod, or run verification commands. The wrapper runs verification. Specs must never ask Grok for deletions/renames.
- **New report field `ARCHITECT_ACTIONS`:** mechanical operations the lane cannot perform (deletions, renames, permission changes) are listed here for the architect to execute, instead of retrying.

Report contract becomes:

```
GROK REPORT (unchanged fields) +
EVIDENCE:
  head_before: <sha>  head_after: <sha>
  status_digest_before: <sha256>  status_digest_after: <sha256>
  unauthorized_git_activity: true|false
ARCHITECT_ACTIONS: [delete path, rename a→b, …] | none
```

### Spec template (`references/five-part-spec.md`)

Add a **standing constraints block** included verbatim in every generated spec:

- Never run git write commands; never create commits. Changes stay in the working tree.
- Do not delete or rename files; list them under ARCHITECT_ACTIONS in your report.
- Work only inside the provided worktree path (see Section 2).
- Run nothing that needs network unless the spec says so.

### Lanes reference (`references/lanes.md`)

Add a per-CLI **known-limits table**: Grok headless (no shell exec, no deletes, wrapper verifies), Codex (`workspace-write` sandbox scope, stdin prompt), plus preflight notes.

## Section 2 — Worktree-by-default, merge-back, tests (CS2)

### Doctrine (SKILL.md, `references/parallel-worktrees.md`)

- Every soft-mode implement round runs in its own worktree: `wt-new <RUN_ID> implement <slug>`; the implementer's cwd is that worktree. The main checkout is never an implementer target.
- Single-file trivial edits get the same treatment — the cost is one script call; the collision class disappears.

### New script `scripts/wt-merge.sh RUN_ID ROLE [SLUG] [--commit]`

- Squash-applies the worktree branch onto its base ref as **staged changes without committing** (default). `--commit` creates the commit (message from FOREMAN_REPORT summary).
- **Overlap refusal:** before applying, compute the incoming file set (`git diff --name-only base..branch`) and refuse (exit nonzero, list conflicts) if the target tree has uncommitted modifications to any of those files.
- Fail-closed: missing worktree metadata, dirty index in target, or diverged base → error out with a clear message; never partial-apply.
- Shares `lib/common.sh` / `lib/worktree.sh` conventions (`git_nohooks`, `flock` locking, run-dir metadata update: mark the worktree entry `merged`).

### Test harness (`tests/`, bats-core)

- `tests/*.bats` suites: `wt-new` (creation, report scaffold, bad-id rejection, duplicate-path refusal), `wt-merge` (clean apply staged-only, `--commit`, overlap refusal, diverged-base refusal), `wt-cleanup`, `wt-consolidate`, `gate-eval` (forbidden paths, hash drift, fail-closed on missing audit), `task-new`, `docs-check` (Section 5).
- Each test creates a throwaway git repo under `$BATS_TEST_TMPDIR`; no test touches the real repo.
- `tests/run.sh`: locates bats (PATH, `~/.foreman/tools/bats`), runs the suite, TAP output.
- bats-core added to `env/reference-manifest.toml` and both bootstrap scripts (WSL: git clone + install.sh; Windows: via WSL only — bats does not run under PowerShell; tool-check reports it in the WSL profile).

## Section 3 — Vendored reference skills + installer sync (CS3)

- Copy from `~/.claude/skills/` into repo `skills/`: `scrapling/` (~184K), `graphify/` (~101K), `superpowers/` (~2.4M). Strip any embedded `.git`; preserve upstream LICENSE files; add `skills/VENDORED.md` recording upstream URL, vendored date, and local-modification policy (none — update by re-vendoring).
- Exclude local-overlay files from vendoring (`*.local.md`, cookie vaults): scrapling's `references/cookie-vault.local.md` and `site-patterns.local.md` must never enter the repo.
- `install.ps1` / `install.sh`: link **every** directory under `skills/*` (not just foreman) into `~/.claude/skills/`, `~/.agents/skills/`, `~/.grok/skills/`; idempotent (skip existing correct links, replace stale ones); agents copy unchanged.
- `env/reference-manifest.toml`: new `[skills]` section listing the four vendored skills; `tool-check` verifies each is linked and reports MISSING otherwise.

## Section 4 — Docs site update (CS4)

- `site/index.html`: soft pipeline diagram gains the audit stage (Decompose → Route *worktree* → Verify → **Codex audit** → Advisor → Done); lanes section gains the evidence contract + known-limits summary; loops section notes the docs-check stage; roles/nav consistency maintained; security wording untouched (verbatim sentence stays).
- `site/README.md` files table stays accurate.

## Section 5 — Documentation & comment-quality stage (folded into CS1/CS2/CS4)

### Toolset (researched via scrapling, 2026-07-15; sources: vale.sh, markdownlint-cli2, lychee, codespell, shdoc READMEs)

| Tool | Enforces | Install (Win / WSL) | Config |
|---|---|---|---|
| markdownlint-cli2 | Markdown structure/style | npm -g (both) | `.markdownlint-cli2.jsonc` at root |
| codespell | Spelling in docs+code+comments | pip (both) | `.codespellrc` with jargon allowlist (grok, codex, worktree, …) |
| lychee | Link integrity (md + site html) | winget / cargo-binstall | `lychee.toml`; `--offline` for local gate |
| shdoc convention | Bash function doc-comments | convention + optional WSL renderer (gawk) | annotation style: `@description @arg @exitcode @stdout @set @see` |
| PSScriptAnalyzer | PowerShell script lint | `Install-Module` (Win) | default rules |

Vale: rejected for now (see Non-goals).

### `scripts/docs-check.sh` (new, CS2)

Runs, fail-closed, from repo root:

1. markdownlint-cli2 over `**/*.md` (excluding vendored `skills/scrapling|graphify|superpowers` — upstream style is theirs)
2. codespell over tracked text files (same vendored exclusion)
3. lychee `--offline` over repo md + `site/*.html` (an `--online` flag enables full link checking when network access is allowed)
4. Comment-coverage check (awk/grep): every function in `scripts/**/*.sh` has an shdoc-style header (`# @description` at minimum); every script has a top-of-file purpose block. Exit nonzero listing uncovered functions.

Output: human summary + `docs-check.json` (per-tool pass/fail + finding counts) for gate consumption.

### Loop integration (iterative)

- **Implement rounds:** docs-check runs as part of round verification. Failures loop back to the implementer as a corrected spec — the same rework path as failing tests. Iterate ≤ `max_rework_rounds`.
- **Audit:** `references/audit-checklist.md` gains a **Documentation & comments** dimension for codex-auditor: comments explain *why* not *what*; doctrine readable cold; docs not stale relative to the diff; shdoc headers present and truthful. Verdict schema unchanged (findings carry the dimension tag).
- **Hard mode:** `gate-eval.sh` consumes `docs-check.json`; red docs-check fails the gate.
- **Preflight:** `tool-check` gains a `docs` tool group (the three linters + PSScriptAnalyzer on Windows); a multi-step implement must not start while the docs group fails. Bootstrap scripts install the group.

## Execution plan (approach A — the enhancement ships via the enhanced loop)

1. **CS1 doctrine/lane hardening** first — Grok implements in an `implement` worktree, wrapper evidence rules applied manually this round (they're what CS1 writes); codex-auditor cold-audits the diff; architect merges (manual `git merge --squash`, since `wt-merge` ships in CS2).
2. **CS2, CS3, CS4 in parallel worktrees** (one `RUN_ID`, three implement trees + audit trees) — spawned in one turn; each audited by codex-auditor; `wt-consolidate`; merge in order CS2 → CS3 → CS4 using the freshly tested `wt-merge.sh`.
3. Docs-check runs inside each round from CS2 onward; the advisor is consulted before the final ship decision.

### Definition of done

- bats suite green (`tests/run.sh` under WSL/Git Bash)
- `tool-check` reports the docs group and the four vendored skills present
- Four codex-auditor verdicts recorded (no unresolved BLOCKED)
- `docs-check.sh` green on the whole repo
- Site reflects final doctrine; installers link all vendored skills
- All merges staged/committed cleanly with no overlap-refusal overrides

### Risks

- **Uncommitted concurrent-session edits** in the main tree overlap CS1 targets (SKILL.md, roles.md, CLAUDE.md, README.md). Those must be committed or stashed before CS1 merges; the architect surfaces the exact overlap at merge time. `wt-merge` overlap refusal makes this mechanical from CS2 on.
- **Grok drift recurrence:** mitigated by worktrees (blast radius = one tree) + evidence contract + audit.
- **Vendored-skill staleness:** accepted; `VENDORED.md` records provenance and re-vendor procedure.
- **bats on Windows:** WSL-only; Git Bash may run it too but the contract is WSL. tool-check states this.

## Section 6 — CS5: graph dogfood, OpenSpec+EARS, Maintenance and Updates (approved 2026-07-15, second wave)

Researched via scrapling (OpenSpec GitHub, alistairmavin.com/ears, Microsoft GraphRAG docs, Neo4j KG+LLM); token experiments run against the live graph (45–77% savings vs raw reads, budget-capped queries).

- **CS5a — graph doctrine:** commit `graphify-out/graph.json` + `GRAPH_REPORT.md`; .gitignore volatile graphify artifacts (caches, html, cost.json); CLAUDE.md + SKILL.md rule: repo questions go to `graphify query` (budget ≤1500) before file exploration, hop to sources via `source_location` only as needed; graphify (python module) added to manifest.
- **CS5b — OpenSpec + EARS:** adopt OpenSpec folder conventions (`openspec/changes/<name>/{proposal.md, specs/, design.md, tasks.md}`, dated archive under `openspec/changes/archive/`) as the on-disk home for foreman change specs; CLI optional (manifest note only). Five-part-spec Constraints/Verification written in EARS patterns (Ubiquitous / WHEN / WHILE / WHERE / IF-THEN / Complex), templates + worked example in `references/five-part-spec.md`; Grok-bound specs MUST use EARS phrasing.
- **CS5c — Maintenance and Updates:** `skills/foreman/scripts/maintenance.sh` with stages: upstream check (vendored-skill content hash + upstream URL recorded in VENDORED.md at vendor time; `--apply` re-vendors), graph refresh (`graphify --update` + health check), compat check (CLI versions + model availability vs manifest floors); report mode default, JSON output. GitHub Actions `.github/workflows/maintenance.yml`: on release published + monthly cron + workflow_dispatch, report-only, opens an issue with findings.
- Execution: after CS2–CS4 merge train lands (file overlap with SKILL.md, five-part-spec.md, VENDORED.md, manifest). Codex implements, Grok audits (lane substitution doctrine unchanged).

## Decisions log

- Approach A (parallel worktree fan-out, staged dependencies) over sequential waves or hard-mode dogfood — user choice.
- Comprehensive scope — user choice.
- Worktree-by-default for all soft implement rounds — user choice.
- bats-core over plain-bash runner — user choice.
- Vendor full skill copies — user choice.
- Docs stage toolset: markdownlint-cli2 + codespell + lychee + shdoc convention + PSScriptAnalyzer; Vale deferred — architect recommendation, user approved.
