<p align="center">
  <img src="assets/foreman-banner.png" alt="Foreman — cross-vendor orchestration for coding agents" width="100%">
</p>

# Foreman

Cross-vendor architect/worker orchestration for coding agents. An architect
session routes five-part specs to implementer and auditor lanes, re-runs
verification on the real tree, and for non-trivial soft-mode work is
instructed to obtain an independent cold-diff review before shipping; trivial
mechanical edits may skip audit with a stated reason. Hard mode records a cold
audit, but its verdict is not yet bound to the current diff. Every run — on
Windows or on WSL/Linux — moves through three ordered stages: **Setup &
Environment**, **Use**, **Cleanup**. Soft mode is the path that works today.
Hard mode includes IMPLEMENT, CHECK, EVIDENCE, AUDIT, GATE, and draft-PR
scripts; IMPLEMENT needs a built or supplied `foreman-launch` before it can
run (see [Hard mode](#10-hard-mode--status)).

This README is the teaching document: what Foreman is, how the lifecycle
works, and what is shipped versus planned. For a soft-mode operating
walkthrough, selected command and exit-code reference, and troubleshooting,
see [`docs/USAGE.md`](docs/USAGE.md). For the install/setup story on Windows
and WSL/Linux side by side, see [`docs/INSTALL.md`](docs/INSTALL.md).

## 1. What Foreman is and the problem it solves

A single model session that plans, types, tests, and declares "done" fails in
predictable ways. The expensive session model burns tokens on boilerplate
while architecture decisions still need that budget. Same-family self-review
shares blind spots: the model that wrote a subtle bug often fails to see it.
Ungoverned edits land on the main checkout where a concurrent session can
collide, or where a narrated "I fixed it" leaves the tree unchanged.
Unverifiable success reports look green until someone re-runs the command and
finds nothing changed.

Foreman splits the work. The **architect** (session model, typically Claude
Fable or Opus) owns judgment: inventory, specs, routing, independent
verification, ship-or-rework. **Workers** type code under a cold five-part
spec with no chat history. An **auditor** on a different **model family** is
supposed to review only the diff and the acceptance criteria. An **advisor**
is consulted only at commitment boundaries and does not implement. Reports are
claims. Digests of HEAD and `git status` before and after a worker run expose
silent no-ops.

The default soft pairing: Grok 4.5 implements, the architect re-runs checks,
Codex GPT-5.6 Sol audits read-only, then the architect ships. Cross-vendor
review is the point. Foreman's routing doctrine requires a different model
family for audit. Soft mode relies on the architect to enforce this. Hard
mode's present check compares configured `[worker].vendor` with
`[audit].vendor` and is not bound to the vendor the hard IMPLEMENT stage
actually ran — do not treat it as reliable enforcement.

## 2. The mental model

Roles and producers are keyed by **model family**, not by CLI name. A gateway
CLI that serves another vendor's models counts as that family for audit
routing. Live soft-mode producers today are Grok (xAI), Codex/GPT (OpenAI),
and Claude (Anthropic, advisor/architect). A fourth gateway lane (`agy`,
Antigravity CLI) is specified for this release as routing coverage — not as a
fourth independent vote — with isolation still unsolved (see
[Honest capabilities and limits](#11-honest-capabilities-and-limits)).

One host-side run directory defaults to `~/.foreman/runs/<id>/`; operators
must keep any `FOREMAN_HOME` override outside worktrees:

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
                        reports + evidence — keep FOREMAN_HOME outside worktrees)
```

The architect keeps context lean: emit specs, routing decisions, and short
verdicts; do not re-type implementation on the session model while a worker
CLI is available. Workers are instructed not to run git write commands
(`commit`, `add`, `reset`, `branch`, `push`, `rebase`, `merge`, `tag`) and to
request deletions or renames through `ARCHITECT_ACTIONS`. Soft mode does not
technically prevent those actions, so the architect must verify the diff and
HEAD.

When told that the worker was Codex/OpenAI, the `codex-auditor` prompt
instructs the lane to return `STATUS: blocked_same_vendor`; the architect
must supply and verify that provenance. The advisor answers architecture,
migration, API shape, or "failed twice" questions under a ~300-word prompt
contract (not enforced by a length checker). Decorrelated failure modes beat
one model grading its own homework — a design claim, not a shipped benchmark.

## 3. The five-part spec

Implementers share none of the architect's conversation. Every handoff
carries exactly five parts. A weak part produces a predictable failure mode.

1. **Objective** — What to build or change and why (one paragraph). Vague
   objectives produce drive-by scope expansion.
2. **Files** — Exact create / modify / do-not-touch paths. Missing paths let
   the worker invent locations or edit protected trees.
3. **Interfaces** — Signatures, types, HTML IDs, CSS tokens, CLI flags, exit
   codes the code must match. Empty interfaces mean the decision is
   unfinished; finish architect work before delegating.
4. **Constraints** — Conventions, forbidden zones, standing rules. Weak
   constraints invite new dependencies, refactors, and git writes.
5. **Verification** — Exact command(s) the architect will re-run. Without
   this, "should work" is not a completion criterion.

Template: [`skills/foreman/references/five-part-spec.md`](skills/foreman/references/five-part-spec.md).

**Standing constraints** (paste into every Constraints section):

- NEVER run git write commands. Changes stay uncommitted in the working tree.
- Do not delete or rename files. List needed deletions/renames under
  `ARCHITECT_ACTIONS`.
- Work only inside the provided worktree path. Never write outside it.
- No network access unless the spec explicitly grants it.
- Documentation and comments are part of the deliverable: markdown passes
  markdownlint-cli2; bash functions carry shdoc headers (`# @description`
  minimum); scripts carry a top-of-file purpose comment.

## 4. Lanes and vendor routing

| Lane | Producer | Agent | Role |
|---|---|---|---|
| Routine implementer | Grok 4.5 | `grok-implementer` | Default typing lane when the spec fully determines the outcome |
| Cross-vendor implementer | GPT-5.6 Sol (medium; high for correctness-critical work) | `codex-implementer` | Race / second implementation, or Grok unavailable |
| Audit (default) | GPT-5.6 Sol (high), read-only | `codex-auditor` | Cold diff + acceptance criteria; model family must differ from the worker |
| Judgment | Claude Fable / Opus | `foreman-advisor` | Commitment boundaries only; never implements |

**Grok is live.** Grok Build is installed on the reference host; the bootstrap
installs the current npm release rather than pinning a README version. It is
wired into the lane machinery (`lane-run.sh`'s `LANE_VENDOR=grok` →
`GROK_HOME` isolation per lane). A worktree-secrets preflight refuses to spawn
a grok lane over a tree containing `.env` files or private-key material,
because the CLI's whole-repo-upload behavior is unrefuted. Grok stays the
routine implementer by doctrine, but its concurrency is **capped, not
promoted** — see [Honest capabilities and limits](#11-honest-capabilities-and-limits).

**codex-implementer** and **codex-auditor** drive Codex CLI with
workspace-write/medium and read-only/high respectively; the auditor uses
schema-forced verdict JSON
(`skills/foreman/scripts/adapters/verdict.schema.json`). After an audit run,
`git status --porcelain` must show no auditor mutations. Full CLI flags,
hard-mode adapters, and config keys:
[`skills/foreman/references/lanes.md`](skills/foreman/references/lanes.md).

If a lane returns `unavailable` or `timeout`, re-route and say so in the
session. Never hide a vendor substitution under the original lane's name.
Never use the implementer lane to audit itself — if Codex implemented, do not
audit with `codex-auditor`. Default pairing:

```text
Grok implements → architect re-runs checks → Codex Sol audits → architect ships
```

## 5. Soft mode — the loop that runs today

```text
   Setup ──► recon ──► implement ──► verify + audit ──► land ──► Cleanup
   foreman-  wt-new     five-part     architect re-runs   wt-merge  foreman-
   setup.sh  search/    spec ──►      checks; codex-      wt-      cleanup.sh
             plan       grok or       auditor cold diff   cleanup
                        codex in         │
                        a worktree        │ WARNING / BLOCKED
                           ▲               │
                           └───── rework ──┘   (corrected spec,
                                                cheaper lane)
```

**Recon** — One `RUN_ID` for the session. `wt-new` for `search` and `plan`
(and later `audit` / `implement`). Spawn `foreman-search` and `foreman-plan`
in parallel, each with cwd set to its worktree. Each writes
`FOREMAN_REPORT.md` and `FOREMAN_REPORT.json`. `wt-consolidate` copies
reports into `~/.foreman/runs/<RUN_ID>/` and writes `CONSOLIDATED.md`. Do not
ship on one partial report.

**Implement** — Write a five-part spec (see [The five-part spec](#3-the-five-part-spec)).
Route to `grok-implementer` by default (or race `codex-implementer`) inside
an implement worktree. The default implementer target is a worktree. For
stateful targets configured with `soft_mode.target=live`, soft mode
deliberately uses the working checkout instead.

**Verify + audit** — Architect reads the real diff, re-runs the Verification
command, then sends a cold diff to `codex-auditor` when the work is
non-trivial (see [Reports are claims](#8-reports-are-claims-evidence-verification-audit-checker-soundness)).
`APPROVED` with green checks may ship. `WARNING` ships only if the architect
accepts the findings. `BLOCKED` means rework: send a corrected spec back to
the implementer lane; do not hand-patch on the architect model.

**Land** — `wt-merge` squash-applies the implement branch as staged changes
(optional `--commit`). Cleanup attempts to remove worktrees, archives their
reports, and leaves dirty worktrees in place unless `--force` is supplied.
Reports stay under `~/.foreman/runs/`.

## 6. Setup → Use → Cleanup, and the quickstart

Use the same three-stage operating discipline on Windows and WSL/Linux: run
Setup before vendor-routed lanes, perform the work, then run Cleanup for each
run ID created during Use. The scripts do not enforce a global lifecycle state
machine.

### Setup & Environment

Setup owns tool inventory, bootstrap, and **all** vendor authentication
(grok, codex, claude). Run the composed wrapper (bash — Git Bash on Windows,
native on WSL/Linux):

```bash
bash skills/foreman/scripts/foreman-setup.sh --profile soft   # or hard | full
bash skills/foreman/scripts/foreman-setup.sh --profile soft --lane grok
```

`foreman-setup.sh` composes `env/tool-check.sh` rather than reimplementing
it, prints one `<vendor>: NOT-READY -- run <instruction>` line per
unauthenticated vendor (`grok login --device-code`, `codex login`,
`claude auth login`), and **never authenticates** — device/interactive auth
stays the operator's job; Setup only prints the instruction. Exit `0` =
READY, `1` = NOT-READY. `--lane <vendor>` scopes the check to that one
vendor's own readiness signal. Idempotent: a second run against an
already-ready host changes nothing and re-reports READY.

Full Windows/WSL inventory and bootstrap detail lives in
[`skills/foreman/references/reference-environment.md`](skills/foreman/references/reference-environment.md).

### Use

Use assumes an authenticated, provisioned environment and never authenticates.
When a command is launched through `lane-run.sh` with `LANE_VENDOR` set, it is
refused before spawn if that vendor is not ready — citing Setup, before
touching the worktree lock or emitting any event. Commands launched without
that variable or outside the wrapper are not covered by this gate. Use is the
soft loop (recon, implement, verify, audit) or the hard-mode task loop.

### Cleanup

```bash
bash skills/foreman/scripts/foreman-cleanup.sh RUN_ID [--force]
```

1. Best-effort SIGINT of any lane subprocess this run's event log still
   shows alive — before any worktree is touched.
2. Delegate to `wt-cleanup.sh`'s existing dirty-worktree guard (refuses to
   delete a worktree with uncommitted/untracked work unless `--force`,
   archives reports first) — composed, not reimplemented.
3. Cleanup honors a `.pueued-owned` marker if one was supplied, but shipped
   code does not create that marker — so the daemon-stop branch is inert
   until something else creates it. Never issue a blind `pueue shutdown`.
4. Attempts to remove three named run-local lock directories
   (`.seq.lock`, `.attempt.lock`, `.supervise.lock`) without determining
   staleness or ownership — never the host-wide `~/.foreman/gate.lock`. Do
   not run Cleanup concurrently with live lanes for the same run.

Cleanup archives reports first and leaves an uncommitted worktree intact; a
re-run after interruption finishes the remaining teardown without error.
Note: on a clone used as its own dogfood target, `install.sh` chmods tracked
scripts that the index records as `100644`, leaving the tree permanently dirty
— dirty-tree guards then refuse removal unless `--force`.

### Quickstart: Windows and WSL/Linux side by side

Both platforms run the same three stages:

<table>
<tr><th>Windows (PowerShell)</th><th>WSL / Linux (bash)</th></tr>
<tr><td>

```powershell
cd path\to\foreman
.\install.ps1
.\env\tool-check.ps1 -Profile soft -Json `
  -Out $env:USERPROFILE\.foreman\last-tool-check.json
# if not ready:
.\env\bootstrap-windows.ps1 -Profile soft -Yes
.\env\tool-check.ps1 -Profile soft
```

</td><td>

```bash
cd /path/to/foreman
bash install.sh
bash env/bootstrap-wsl.sh --profile soft --yes
bash skills/foreman/scripts/foreman-setup.sh --profile soft
```

</td></tr>
<tr><td colspan="2">

Authenticate any vendor Setup reports `NOT-READY` (`grok login
--device-code`, `codex login`, `claude auth login`), then re-run the Setup
command above until it reports `SETUP: READY` / `READY: yes`.

`install.sh` is tracked as mode `100644` (not executable). Always invoke it
with `bash install.sh`. The script chmods matched scripts under
`skills/foreman/scripts/`, which permanently dirties an installed clone on
this repo.

Root `mode = "hard"` in config is session/skill doctrine read by the skill,
not a key the shell config loader consumes — arbitrary script entry points
do not auto-switch mode from that key alone.

</td></tr>
<tr><td colspan="2">

```bash
cd path/to/foreman   # Git Bash on Windows, native shell on WSL/Linux
claude
```

```text
/model fable
/foreman
```

Restate the goal and mode. Soft unless `.foreman/config.toml` or the user
says hard. Then a trivial Use round:

```bash
RUN=run-$(date +%Y%m%d-%H%M%S)
bash skills/foreman/scripts/wt-new.sh "$RUN" implement smoke-test
# architect routes a small five-part spec to grok-implementer or
# codex-implementer with that worktree as cwd, verifies, ships or reworks
bash skills/foreman/scripts/wt-cleanup.sh "$RUN" --force
```

</td></tr>
</table>

The repo's PowerShell-native entry points are `install.ps1`,
`env/tool-check.ps1`, `env/bootstrap-windows.ps1`, and `launcher/build.ps1`;
`skills/foreman/scripts/*.sh` remain bash scripts (Git Bash on Windows, native
shell on WSL/Linux).

`bootstrap-wsl.sh --profile soft` installs the soft-profile WSL toolset,
including bats fallback, jq, node/npm, Codex, Grok, and documentation tools.
Shellcheck is hard/full; Bun and pueue are full-only. Configure
`appendWindowsPath=false` in `/etc/wsl.conf` separately if desired; this
bootstrap does not edit that file.

The command-by-command walkthrough lives in [`docs/USAGE.md`](docs/USAGE.md);
the install/bootstrap story is in [`docs/INSTALL.md`](docs/INSTALL.md).

## 7. Worktree isolation

Parallel agents on one shared checkout collide. Soft multi-step work fans
out under one `RUN_ID` into sibling worktrees:

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
                                           changes (refuses a staged target
                                           index, overlapping target changes,
                                           or squash-merge conflict; unrelated
                                           unstaged/untracked target changes
                                           may remain); architect commits
                                        │
                       wt-cleanup ──────┘  removes worktrees, keeps reports
```

**`wt-new.sh RUN_ID ROLE [SLUG] [BASE_REF]`** — Roles:
`search | plan | audit | implement | advisor | misc`. Creates a sibling
worktree, branch `foreman/<RUN_ID>/<role>[/<slug>]`, report scaffolds, and
metadata under `~/.foreman/runs/<RUN_ID>/worktrees/`.

**`wt-consolidate.sh RUN_ID`** — Copies each tree's `FOREMAN_REPORT.*` into
`~/.foreman/runs/<RUN_ID>/reports/` and writes `CONSOLIDATED.md`. Does not
remove worktrees.

**`wt-merge.sh RUN_ID ROLE [SLUG] [--commit]`** — Squash-applies the
worktree branch onto the current branch. Default is **staged only**.
`--commit` creates one ordinary commit on the target from the squash result;
when the worktree has pending changes, the script first commits those on the
worktree branch. Exit codes and edge cases: [`docs/USAGE.md`](docs/USAGE.md).

**`wt-cleanup.sh RUN_ID [--force] [--keep-branches]`** — Runs consolidate if
`CONSOLIDATED.md` is missing, removes worktrees, deletes branches unless
`--keep-branches`, skips dirty trees unless `--force`, keeps reports under
`~/.foreman/runs/<RUN_ID>/`. It also SIGINTs a still-alive lane subprocess
for that worktree before calling `git worktree remove` (see the
grandchild-orphan note under limits), and the concurrent-worktree path
carries a `git-guards.sh` config bootstrap plus a bounded-retry wrapper
around shared git-lock operations.

The repo layout puts worktrees as siblings of the repo root:

```text
<parent>/<repo>-wt-<RUN_ID>-search/
<parent>/<repo>-wt-<RUN_ID>-plan/
<parent>/<repo>-wt-<RUN_ID>-implement[-slug]/
```

The scripts use `flock` for worktree add/remove when available; otherwise they
warn and retry unlocked. `wt-new.sh`'s separate index mutex currently fails
open after about 30 seconds, so concurrent creation is not a safety
guarantee. On Ubuntu 26.04 with uutils coreutils, the `mkdir` mutex used
elsewhere in the durable core is not atomic (measured mutual-exclusion
violations — see `docs/research/vnext/F-uutils-mkdir-blocker.md`). Do not
mount `~/.foreman/runs` into untrusted workers. Full doctrine:
[`skills/foreman/references/parallel-worktrees.md`](skills/foreman/references/parallel-worktrees.md).

## 8. Reports are claims: evidence, verification, audit, checker soundness

Lane reports are claims, not proof. The evidence contract exposes a silent
no-op:

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

If `HEAD_B != HEAD_A`, set `unauthorized_git_activity: true` and list
`git log --oneline HEAD_B..HEAD_A`. Workers must not commit; a HEAD move is a
contract break.

The motivating case: a headless vendor run that narrates edits while writing
nothing leaves `DIG_B == DIG_A`. Bind success to digests and the tree, not to
the model's account of itself. Per-CLI workarounds live in the agent prompts
(for example `agents/grok-implementer.md`), not in this teaching document.

### Verification and the audit lane

Before accepting worker output the architect:

1. Reads the actual diff (`git status`, `git diff`)
2. Re-runs the Verification command and records the real output
3. Confirms evidence digests moved when the model claimed edits
4. Runs the docs stage when docs or scripts changed (below)
5. Invokes `codex-auditor` on non-trivial work with cold diff + criteria

Wrong code goes back to the implementer as a corrected five-part spec.
Required for a multi-file or multi-step deliverable; for security-sensitive
paths (auth, crypto, network, secrets, shell); before declaring a multi-step
task done; or after a race between implementers. Trivial single-file
mechanical edits may skip audit if the architect states why.

| Verdict | Soft mode | Hard gate (current) |
|---|---|---|
| APPROVED | Ship if independent checks green | May pass if hashes + forbidden paths clean and verdict enum is valid |
| WARNING | Ship only after architect acknowledges findings | May pass the current hard gate; `pr-open.sh` does not auto-attach audit findings — put acknowledged findings in `pr-body.md` |
| BLOCKED | Rework via implementer with corrected spec | Gate fails |

Schema: `skills/foreman/scripts/adapters/verdict.schema.json`.

### Checker soundness

A test that never fires is silent; a checker whose predicate does not match
its claim passes loudly, and a loud pass is trusted. Every gate, probe, and
assertion this project introduces must:

1. Be demonstrated to **fail against a known-bad input** before it is trusted
2. Bind success to **artifacts and their content** — never to exit codes alone,
   substring matches, or an agent's own account of its state
3. Report **vacuous** invariants as vacuous, not as passes
4. Corroborate any result that would change a release decision with an
   **independent check using a different predicate**

### Documentation stage

After implementation and product checks, run:

```bash
bash skills/foreman/scripts/docs-check.sh
bash skills/foreman/scripts/docs-check.sh --json docs-check.json
bash skills/foreman/scripts/docs-check.sh --online   # full link check (network)
```

This stage checks markdown lint, spelling, links, and bash comment coverage
only (exit `0` pass, `1` findings, `2` required tool missing — fail closed).
Tool configs and comment-coverage rules: [`docs/USAGE.md`](docs/USAGE.md).
Prose quality is a human/architect judgment call, not something
`docs-check.sh` measures.

## 9. The record: event log, work-DAG, knowledge plane, store

Where claims, evidence, and verdicts live — and what can be asked of them
later.

- **Event log** (`events.jsonl` under the run dir) is the source of truth for
  lane lifecycle. Sequence allocation and locks are part of the durable core;
  see limits for the uutils `mkdir` defect that affects that path.
- **Work-DAG** is a deterministic projection of the event log. No LLM ever
  writes it, and it never passes through graphify.
- **Knowledge plane** is graphify's, on two cadences: AST-only per merge
  (measured zero tokens) and slower semantic extraction/clustering. Sold as
  cross-session provenance and deterministic gate checks — **not** as
  retrieval accuracy (BM-25 beat GraphRAG systems on the research bench; the
  falsification package carries pre-registered kill criteria).
- **TerminusDB** is a regenerable materialisation behind a `GraphStore` port
  with a files-only fallback — never the system of record. If the store is
  deferred or unavailable, the plane loses time-travel ergonomics, not the
  gate or the record.
- **Consumption** for workers is a pre-serialized, content-hashed,
  token-budgeted context block — the design where the audit trail can prove
  what the worker saw — not open-ended agentic graph traversal.

This repo commits a knowledge graph at `graphify-out/graph.json`. For
concepts, architecture, or file relationships, query first:

```bash
graphify query "<question>" --budget 1500
```

Follow `source_location` pointers into files only for the facts you need.
If the graph is stale relative to HEAD, check
`graphify-out/GRAPH_REPORT.md` and refresh with `graphify --update`.

Without `--apply`, `maintenance.sh` reports vendored-skill hash drift, graph
freshness, and soft-profile tool inventory drift. With `--apply`, the
upstream stage replaces vendored skill directories from `~/.claude/skills`
and updates their recorded hashes — review the source before using it.
`.github/workflows/maintenance.yml` runs `--stage upstream` on
release/monthly cron/dispatch.

## 10. Hard mode — status

Hard mode exposes the ordered
`INIT → PLAN → IMPLEMENT → CHECK → EVIDENCE → AUDIT → GATE → PR` loop, but
the audit-to-gate handoff is **not fail-closed across rounds**: verdict files
are not freshness- or diff-bound, and a failed re-audit can leave a prior
verdict eligible.

| Stage | Script / action | Status |
|---|---|---|
| **INIT** | `task-new.sh TASK_ID [BASE_BRANCH]` | **Shipped** — worktree + envelope + hash snapshot of protected paths |
| **PLAN** | Architect writes `plan.md` into the run dir | Process — file handoff only |
| **IMPLEMENT** | `worker-run.sh` | **Implemented** for launcher-only and container profiles; requires a built or externally supplied `foreman-launch` and a supported Grok or Codex CLI. Fresh clones do not ship a tracked `launcher/dist` binary; bootstrap does not build it. |
| **CHECK** | `checks-run.sh TASK_ID` | **Shipped** — product checks from a pristine commit archive, not the dirty tree |
| **EVIDENCE** | `evidence-collect.sh TASK_ID` | **Shipped** — host-side bundle under `~/.foreman/runs/` |
| **AUDIT** | `audit-run.sh TASK_ID` | **Shipped** — cold diff via host Codex Sol; checks that configured `[audit].vendor` differs from configured `[worker].vendor` (not bound to the actual hard-mode worker vendor, which defaults via `hard_mode.vendor`) |
| **GATE** | `gate-eval.sh TASK_ID` | **Shipped but incomplete** — forbidden paths + hash drift + checks green + verdict enum present and not BLOCKED. No audit freshness/diff binding; WARNING may pass; delete the previous `audit-verdict.json` before every re-audit until fixed |
| **PR** | `pr-open.sh TASK_ID` | **Shipped** — after a recorded gate pass, requires HTTPS GitHub origin and `FOREMAN_GH_PAT`, pushes host-side, opens a draft PR. Does not auto-attach audit findings |

These profiles are implemented in the scripts. They are not out-of-box
operational from a fresh clone until `foreman-launch` is built or supplied;
container mode additionally requires its documented container/network
prerequisites. Either profile forbids in-sandbox commits (evidence is
extracted host-side); the worker never holds push credentials; `pr-open.sh`
opens a **draft** PR host-side only after the gate passes, using a
fine-grained, single-repo, expiring token.

## 11. Honest capabilities and limits

- **Grok concurrency is verified to 3 lanes; codex to 2.** Live destructive
  test T5b (2026-07-18, shared signed-in account, user-authorized) returned
  GREEN for grok at N=2 and N=3 and for codex at N=2. Pueue caps follow those
  proven N values only: `grok` `parallel=3`, `codex` `parallel=2`
  (`docs/research/vendor-concurrency-results.md`). Reproducing live account
  behavior requires authorization, credentials, and external services.
- **Claude Code needs a separate home.** Public issue record: concurrent
  instances race on `.claude.json` (`REQUIRES-SEPARATE-HOME`). Run one Claude
  Code architect session per host config home; do not share a config dir
  across sessions. Claude is half-wired as a worker vendor: worktrees and
  pueue groups exist, but the hard worker command builder accepts only Grok
  and Codex.
- **agy (fourth lane) is routing coverage, not a fourth vote.** Nine frontier
  LLMs collapse to roughly two effective independent votes in research; the
  fourth lane closes the hole where Codex-implemented work had no
  cross-vendor auditor. Cap 1, shared home, isolation unsolved
  (`GEMINI_CLI_HOME` is a no-op for `agy`; an isolated `HOME` is
  credential-less). Spec: `openspec/changes/agy-lane-activation/`.
- **POSIX process-tree cascade.** The POSIX launcher self-re-execs under
  `unshare --pid --mount-proc --fork --kill-child` when available; otherwise
  it falls back to `setsid` + `kill(-pgid)` and logs **DEGRADED**. See
  `launcher/README.md`. Local Bats cover the design; full platform matrix is
  not claimed here.
- **`wt-cleanup`'s SIGINT-before-remove targets one recorded pid; a
  grandchild process needs the follow-up sweep.** Best-effort defense in
  depth, never a hard gate on worktree removal.
- **`[audit.policy]` config keys are doctrine-only today.** `gate-eval.sh`
  does not yet bucket audit findings by severity.
- **`durable.enabled` is inert.** It is parsed into `DURABLE_ENABLED`, but no
  runtime consumer reads that flag — `true` and `false` do not switch durable
  lanes.
- **Lock soundness.** The durable core's `mkdir` mutex is unsafe on Ubuntu
  26.04 with uutils coreutils 0.8.0 (measured violations); `flock` measured
  clean. `wt-new` fails open after ~30s. Package:
  `openspec/changes/lock-primitive-hardening/`.
- **Telemetry gap.** Foreman today records no tokens, no cost, and no model
  identity in the lineage store; hard-mode audit/gate scripts do not emit
  verdicts into the event log. Comparative claims that need those signals are
  not yet computable.
- **Formal models.** Four Quint models under `formal/specs/`
  (`lane_lifecycle`, `eventlog_concurrency`, `audit_gate`,
  `evidence_contract`) report reachability and absence-within-depth at bounded
  depths — not unbounded correctness.
- **Audit latency** (often tens of minutes) is measured and bounded in process,
  not solved.
- **TerminusDB longevity** is accepted with guardrails: bus-factor risk, prior
  dormancy, files-only fallback retained.
- **The Bats suite needs Bash plus `bats`** (PATH or
  `~/.foreman/tools/bats-core/bin/bats`). Plain PowerShell does not run it
  directly; native Linux, WSL, and Git Bash can. There is no CI workflow that
  runs the Bats suite; `maintenance.yml` is reporting only;
  `windows-smoke.yml` exercises `install.ps1` only.
- **Nested Job Objects, Windows NTSTATUS masking, and jq-vs-python3 PATH
  quirks** are documented in `launcher/README.md` and
  `skills/foreman/references/reference-environment.md` — component limits with
  proper homes there, not repeated as README trivia.

## 12. Further reading, security, layout, license, lineage

- Full operating guide: [`docs/USAGE.md`](docs/USAGE.md)
- Install / Setup on Windows and WSL side by side: [`docs/INSTALL.md`](docs/INSTALL.md)
- Reference set index: [`skills/foreman/references/index.md`](skills/foreman/references/index.md)
- Architect doctrine: [`CLAUDE.md`](CLAUDE.md)
- Maintenance: `skills/foreman/scripts/maintenance.sh` (see
  [The record](#9-the-record-event-log-work-dag-knowledge-plane-store))

### Security model

Soft mode runs implementer CLIs on the host with their native sandboxes only.
Hard mode ships IMPLEMENT, CHECK, EVIDENCE, AUDIT, GATE, and draft-PR
scripts, but a fresh clone needs a built launcher and the audit verdict is
not yet freshness-bound to the diff. Treat the deterministic gate as
incomplete until that defect is fixed. Containers share the host/WSL2 kernel —
defense in depth, not a hard boundary. Full map:
[`skills/foreman/references/security-model.md`](skills/foreman/references/security-model.md).

### Layout

```text
foreman/
├── skills/foreman/          # skill: SKILL.md, references/, scripts/
├── skills/graphify/         # vendored: knowledge graph
├── skills/scrapling/        # vendored: fetch / scrape helpers
├── skills/superpowers/      # vendored: planning, TDD, debugging, code-review, git-worktree skills
├── skills/VENDORED.md       # provenance + content hashes
├── agents/                  # Claude Code subagents (implement, audit, advisor, …)
├── launcher/                # foreman-launch: process-tree-owning supervisor (Bun/TypeScript)
├── env/                     # reference-manifest, tool-check, bootstrap (Windows + WSL)
├── formal/                  # Quint models + verification reports
├── config/foreman.toml.example
├── install.ps1 · install.sh
├── openspec/                # OpenSpec-like change-folder layout
├── site/                    # static documentation website (dogfood target)
├── tests/                   # bats suite + run.sh
├── graphify-out/            # committed knowledge graph
├── docs/                    # USAGE.md, INSTALL.md, research / design notes
└── CLAUDE.md                # project architect doctrine
```

### License

Apache License 2.0. See [LICENSE](LICENSE).

The vendored superpowers skill keeps its own upstream MIT license as
recorded in `skills/VENDORED.md` (see also `skills/superpowers/LICENSE`).
Scrapling and graphify license pointers are listed in the same table.

### Lineage

- Soft routing doctrine inspired by [DannyMac180/fable-advisor](https://github.com/DannyMac180/fable-advisor)
- Hard harness design from the original Foreman orchestrator/worker spec
- The repo uses an OpenSpec-like change-folder layout under `openspec/`;
  some active packages currently fail `openspec validate` (observed: five
  WSL packages invalid while others validate). See `openspec/README.md` for
  the intended workflow — do not treat the tree as fully OpenSpec-conformant
  until invalid packages are repaired.
