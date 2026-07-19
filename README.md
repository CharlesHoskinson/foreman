<p align="center">
  <img src="assets/foreman-banner.png" alt="Foreman — cross-vendor orchestration for coding agents" width="100%">
</p>

# Foreman

Cross-vendor architect/worker orchestration for coding agents. An architect
session routes self-contained five-part specs to implementer and auditor
lanes, re-runs verification on the real tree, and ships only after an
independent cold diff review. Every run — on Windows or on WSL/Linux — moves
through three ordered stages: **Setup & Environment**, **Use**, **Cleanup**.
Soft mode is the path that works today. Hard mode ships the CHECK/EVIDENCE/
AUDIT/GATE stages; its IMPLEMENT stage is still a stub with an approved
design for the next release (section 6).

This README is the teaching document: what Foreman is, how the lifecycle
works, and an honest account of what is shipped versus planned. For the full
operating guide (every command, every flag, troubleshooting) see
[`docs/USAGE.md`](docs/USAGE.md). For the install/setup story on Windows and
WSL/Linux side by side, see [`docs/INSTALL.md`](docs/INSTALL.md).

## 1. What Foreman is and the problem it solves

A single model session that plans, types, tests, and declares "done" fails in
predictable ways. The expensive session model burns tokens on boilerplate
while you still need it for architecture decisions. Same-family self-review
shares blind spots: the model that wrote a subtle bug often fails to see it.
Ungoverned edits land on the main checkout where a concurrent session can
collide, or where a narrated "I fixed it" leaves the tree unchanged.
Unverifiable success reports look green until someone re-runs the command and
finds nothing changed.

Foreman answers with a split. The **architect** (session model, typically
Claude Fable or Opus) owns judgment: inventory, specs, routing, independent
verification, ship-or-rework. **Workers** type code under a cold five-part
spec with no chat history. An **auditor** on a different vendor family
reviews only the diff and the acceptance criteria. An **advisor** is
consulted only at commitment boundaries and never implements. Reports are
claims. Digests of HEAD and `git status` before and after a worker run make
silent no-ops visible.

The default soft pairing is deliberate: Grok 4.5 implements, the architect
re-runs checks, Codex GPT-5.6 Sol audits read-only, then the architect ships.
Cross-vendor review is the point. Same-vendor audit of a same-family worker
is forbidden because it reintroduces the blind spot the split was built to
kill.

## 2. The mental model

Four roles, four producers, one host-side run directory that never lives
inside a worktree:

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
architect to apply — that rule prevents a worker from rewriting history or
landing a half-finished commit the architect never reviewed.

The auditor is paid to disagree. It gets a cold unified diff and the
acceptance criteria, not the worker's transcript. If the worker was already
Codex/OpenAI, `codex-auditor` stops with `STATUS: blocked_same_vendor` so the
architect picks another review path. The advisor answers architecture,
migration, API shape, or "failed twice" questions in under ~300 words and
does not edit files. Decorrelated failure modes beat one model grading its
own homework.

## 3. The three-stage lifecycle: Setup & Environment → Use → Cleanup

This is the operating frame the rest of the doc set hangs off. It runs
identically on Windows and on WSL/Linux (full-WSL setup, section 7) — Use
never starts until Setup has reported READY for the lanes it needs, and
Cleanup closes every run that Setup opened.

### Setup & Environment

Setup owns tool inventory, bootstrap, and **all** vendor authentication
(grok, codex, claude). Run the composed wrapper (bash — Git Bash on Windows,
native on WSL/Linux; see section 7 for why):

```bash
bash skills/foreman/scripts/foreman-setup.sh --profile soft   # or hard | full
bash skills/foreman/scripts/foreman-setup.sh --profile soft --lane grok
```

`foreman-setup.sh` composes `env/tool-check.sh` rather than reimplementing
it, prints one `<vendor>: NOT-READY -- run <instruction>` line per
unauthenticated vendor (`grok login --device-code`, `codex login`,
`claude auth login`), and **never authenticates anything itself** —
device/interactive auth is always an operator action Setup only instructs.
Exit `0` = READY, `1` = NOT-READY. `--lane <vendor>` scopes the check to
that one vendor's own readiness signal, so an unrelated tool gap elsewhere
never blocks a lane whose vendor is already authenticated. Idempotent: a
second run against an unchanged, already-ready host changes nothing and
re-reports READY.

Full Windows/WSL inventory and bootstrap detail — what each profile
installs, `.wslconfig` tuning, clock-sync protection —
lives in [`skills/foreman/references/reference-environment.md`](skills/foreman/references/reference-environment.md).

### Use

Use assumes an authenticated, provisioned environment and never
authenticates. This is a real gate, not just a report: when a lane sets
`LANE_VENDOR`, `lane-run.sh` refuses to spawn that lane's command for a
not-ready vendor — citing Setup, before touching the worktree lock or
emitting any event — so "grok wasn't signed in" is always a Setup-stage
finding, never a mid-round Use-stage failure. Use is the soft loop (recon,
implement, verify, audit — sections 5, 9-11) or the hard-mode task loop
(section 6).

### Cleanup

Cleanup closes every run, in a fixed order:

```bash
bash skills/foreman/scripts/foreman-cleanup.sh RUN_ID [--force]
```

1. Best-effort SIGINT of any lane subprocess this run's event log still
   shows alive, before any worktree is touched.
2. Delegate to `wt-cleanup.sh`'s existing dirty-worktree guard (refuses to
   delete a worktree with uncommitted/untracked work unless `--force`,
   archives reports first) — composed, not reimplemented.
3. Stop a foreman-owned `pueued` only if this run started it (never a blind
   `pueue shutdown` — the daemon is shared, host-wide state other runs may
   depend on).
4. Sweep this run's own stale lock directories — never the host-wide
   `~/.foreman/gate.lock`.

Idempotent and dirty-safe: an uncommitted worktree survives Cleanup (its
reports are archived first, never discarded), and a re-run after
interruption finishes the remaining teardown without error.

## 4. Lanes and vendor routing

| Lane | Producer | Agent | Role |
|---|---|---|---|
| Routine implementer | Grok 4.5 | `grok-implementer` | Default typing lane when the spec fully determines the outcome |
| Cross-vendor implementer | GPT-5.6 Sol (high) | `codex-implementer` | Race / second implementation, or Grok unavailable |
| Audit (default) | GPT-5.6 Sol (high), read-only | `codex-auditor` | Cold diff + acceptance criteria; vendor must differ from the worker |
| Judgment | Claude Fable / Opus | `foreman-advisor` | Commitment boundaries only; never implements |

**Grok is live.** Grok Build (0.2.103) is installed on the reference host,
signed in via `grok login --device-code`, and wired into the lane machinery
(`lane-run.sh`'s `LANE_VENDOR=grok` → `GROK_HOME` isolation per lane). A
worktree-secrets preflight refuses to spawn a grok lane over a tree
containing `.env` files or private-key material, since the CLI's
whole-repo-upload behavior is unrefuted. Grok stays the routine implementer
by doctrine, but its concurrency is **capped, not promoted** — see section 6.

**codex-implementer** drives `codex exec` with `--model gpt-5.6-sol`,
`-c model_reasoning_effort=medium` (escalate to `high` only for
correctness-critical work), and `--sandbox workspace-write`. Use it to race
Grok when mistakes are costly, or when Grok is unavailable.

**codex-auditor** drives Codex read-only (`--sandbox read-only`,
`model_reasoning_effort=high`) with schema-forced verdict JSON
(`skills/foreman/scripts/adapters/verdict.schema.json`). It never implements
product code. After the run, `git status --porcelain` must show no auditor
mutations.

**foreman-advisor** is read-only judgment at commitment boundaries. If
`model: fable` is unavailable, the host may pin Opus with the same contract.

If a lane returns `unavailable` or `timeout`, re-route and say so in the
session. Never absorb a vendor substitution under the original lane's name.
Never use the implementer lane to audit itself — if Codex implemented, do
not audit with `codex-auditor`. Default pairing:

```text
Grok implements → architect re-runs checks → Codex Sol audits → architect ships
```

Full CLI flags, hard-mode adapters, and config keys:
[`skills/foreman/references/lanes.md`](skills/foreman/references/lanes.md).

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

**Implement** — Write a five-part spec (section 8). Route to
`grok-implementer` by default (or race `codex-implementer`) inside an
implement worktree. The main checkout is never the implementer target.

**Verify + audit** — Architect reads the real diff, re-runs the Verification
command, then sends a cold diff to `codex-auditor` when the work is
non-trivial (section 10). `APPROVED` with green checks may ship. `WARNING`
ships only if the architect accepts the findings. `BLOCKED` means rework:
corrected spec back to the implementer lane, not hand-patching on the
architect model.

**Land** — `wt-merge` squash-applies the implement branch as staged changes
(optional `--commit`). Cleanup (section 3) removes worktrees and keeps
reports under `~/.foreman/runs/`.

## 6. Hard mode — as shipped, and the approved upgrade path

Hard mode's loop is `INIT → PLAN → IMPLEMENT → CHECK → EVIDENCE → AUDIT →
GATE → PR`, fail-closed at every stage:

| Stage | Script / action | Status |
|---|---|---|
| **INIT** | `task-new.sh TASK_ID [BASE_BRANCH]` | **Shipped** — worktree + envelope + hash snapshot of protected paths |
| **PLAN** | Architect writes `plan.md` into the run dir | Process — file handoff only |
| **IMPLEMENT** | `worker-run.sh` | **Stub** — exits missing-CLI and points at soft-mode agents; see below |
| **CHECK** | `checks-run.sh TASK_ID` | **Shipped** — product checks from a pristine commit archive, not the dirty tree |
| **EVIDENCE** | `evidence-collect.sh TASK_ID` | **Shipped** — host-side bundle under `~/.foreman/runs/` |
| **AUDIT** | `audit-run.sh TASK_ID` | **Shipped** — cold diff via host Codex Sol; enforces audit vendor ≠ worker vendor |
| **GATE** | `gate-eval.sh TASK_ID` | **Shipped** — forbidden paths + hash drift + checks green + not BLOCKED |
| **PR** | `pr-open.sh TASK_ID` | **Partial stub** — refuses without gate pass; full `gh pr create` not shipped |

`worker-run.sh` today prints that containerized workers are not implemented
and exits; use soft-mode `grok-implementer` / `codex-implementer` instead.
`pr-open.sh` requires a passed gate and then also exits missing-CLI — push
and open the PR by hand with the evidence summary.

**The upgrade path is an approved spec, not shipped functionality.**
`openspec/changes/hard-mode-launcher/` is recorded **"APPROVED SPEC
(executed next release, not in v0.2.7.5)"** — a next-release design, chosen
over inventing hard mode's IMPLEMENT stage here so this release stays
shippable in one cycle. It replaces the old "containerized Docker worker"
framing with two selectable profiles:

- **launcher-only (the planned default)** — `foreman-launch` supervises the
  worker against a per-lane worktree copy, network default none, no Docker
  required. Hard mode would work out of the box on top of what v0.2.5
  already shipped.
- **container (planned opt-in)** — a devcontainer plus a default-deny
  egress-firewall allowlist, for teams that want kernel-level isolation on
  top of the launcher.

Either profile: no in-sandbox commit (evidence is extracted host-side); the
worker never holds push credentials; `pr-open.sh` would push and open a
**draft** PR host-side only after the gate passes, using a fine-grained,
single-repo, expiring token. None of this runs today — read it as the
documented direction, not a capability you can invoke.

## 7. Honest capabilities and limits

- **Grok concurrency is verified to 3 lanes; codex to 2.** The real-vendor
  destructive concurrency test (T5b) was run live on 2026-07-18 under an
  explicit user authorization to use the shared, signed-in account. grok came
  back GREEN at N=2 and N=3 (every lane returned its exact reply, no 429 under
  the shared quota, session state path-isolated, auth intact after); codex
  came back GREEN at N=2 (no port collision in one-shot `exec` mode, auth
  intact, SQLite-serialized state). The `grok` pueue group is therefore raised
  to `parallel=3` and `codex` to `parallel=2` — each only to its proven-green
  N (`docs/research/vendor-concurrency-results.md`). Claude Code is separately
  ruled `REQUIRES-SEPARATE-HOME` from the public issue record (concurrent
  instances race on `.claude.json`) — run one Claude Code architect session
  per host identity, not several sharing a config dir.
- **The POSIX process-tree cascade is closed, with a documented fallback.**
  As of v0.2.7.5 (`posix-cascade-parity`), the POSIX launcher self-re-execs
  under `unshare --pid --mount-proc --fork --kill-child`, becoming PID 1 of
  a fresh PID namespace — killing the launcher for any reason now reaps the
  whole tree, kernel-enforced, including setsid-detached escapees a bare
  `kill(-pgid)` would miss. When `unshare` is unavailable or fails, the
  launcher falls back to the pre-v0.2.7.5 `setsid` + `kill(-pgid)` path and
  logs a **DEGRADED** marker rather than silently claiming the stronger
  guarantee. See `launcher/README.md` "POSIX asymmetry."
- **`wt-cleanup`'s SIGINT-before-remove targets one recorded pid; a
  grandchild process needs the follow-up sweep.** The single-pid signal
  (SIGINT, then bounded-grace SIGKILL) does not reach a grandchild the
  target process spawned and that reparented away — a known MSYS/Git-Bash
  limitation on this host class. A second pass sweeps the whole subtree
  after the single-pid signal settles (`taskkill //T` via winpid
  translation on Windows, a process-group kill on POSIX), but that sweep is
  best-effort defense in depth, never a hard gate on worktree removal.
- **Nested Job Objects are validated one level deep.** The launcher-spawns-
  launcher chain (`foreman-launch(--detach) → lane-run.sh → foreman-launch
  (CMD) → foreman-launch(GATE)`) has one level of nesting proven by test
  (`tests/launcher.bats`); an arbitrarily deep launcher-of-launchers tree is
  not.
- **Windows NTSTATUS exit codes can collide with small legitimate codes.** A
  child dying with an NTSTATUS (e.g. `0xC0000005`) surfaces byte-masked
  through the launcher; no reliable method recovers the real NTSTATUS from
  the masked byte. Documented, not silently absorbed.
- **`jq` vs `python3` on Windows-only hosts.** `wt-merge.sh` accepts either
  `jq`, `python3`, or `python`; `wt-new.sh`, `wt-consolidate.sh`, and
  `wt-cleanup.sh` require `jq` or specifically `python3` — a Windows host
  with only `python` on PATH (no `python3` alias) fails those three. Use a
  `python3` shim, install `jq`, or run them from WSL.
- **`[audit.policy]` config keys are read only by soft-mode architect
  doctrine today.** `gate-eval.sh` (hard mode's deterministic gate) does not
  yet bucket audit findings by resolved/unresolved severity — a stated
  v0.3.0 consumer, not silently assumed.
- **The bats suite needs WSL or Git Bash.** `tests/run.sh` finds `bats` on
  PATH or `~/.foreman/tools/bats-core/bin/bats`; plain PowerShell does not
  run it.

## 8. Quickstart: Windows and WSL/Linux side by side

Both platforms run the same three stages. The condensed form:

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
./install.sh
bash env/bootstrap-wsl.sh --profile soft --yes
bash skills/foreman/scripts/foreman-setup.sh --profile soft
```

</td></tr>
<tr><td colspan="2">

Authenticate any vendor Setup reports `NOT-READY` (`grok login
--device-code`, `codex login`, `claude auth login`), then re-run the Setup
command above until it reports `SETUP: READY` / `READY: yes`.

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

`skills/foreman/scripts/*.sh` are bash scripts on both platforms — Git Bash
on Windows, the native shell on WSL/Linux; only `env/tool-check.ps1` and
`env/bootstrap-windows.ps1` are PowerShell-native. WSL is a co-equal,
fully-provisioned target as of v0.2.7.5 (`wsl-reliability-env-refresh`):
`bootstrap-wsl.sh` installs every tool WSL-native (bats-core, shellcheck,
bun, pueue, codex, grok, jq, node/npm via fnm), not a subset, and
`/etc/wsl.conf`'s `appendWindowsPath=false` stops WSL from picking up a
leaked Windows npm shim.

The full command-by-command walkthrough (recon, implement, audit, land, the
five-part spec template, every script's exit codes, troubleshooting) lives
in [`docs/USAGE.md`](docs/USAGE.md); the fuller install/bootstrap story is
in [`docs/INSTALL.md`](docs/INSTALL.md).

## 9. The five-part spec

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

## 10. Worktree isolation

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
                                           changes (refuses on overlap/dirty/
                                           conflict); architect commits
                                        │
                       wt-cleanup ──────┘  removes worktrees, keeps reports
```

**`wt-new.sh RUN_ID ROLE [SLUG] [BASE_REF]`** — Roles:
`search | plan | audit | implement | advisor | misc`. Creates a sibling
worktree, branch `foreman/<RUN_ID>/<role>[/<slug>]`, report scaffolds, and
metadata under `~/.foreman/runs/<RUN_ID>/worktrees/`. Exit `2` on bad
id/role/slug or if the path already exists.

**`wt-consolidate.sh RUN_ID`** — Copies each tree's `FOREMAN_REPORT.*` into
`~/.foreman/runs/<RUN_ID>/reports/` and writes `CONSOLIDATED.md`. Does not
remove worktrees. Exit `2` if no worktrees index.

**`wt-merge.sh RUN_ID ROLE [SLUG] [--commit]`** — Squash-applies the
worktree branch onto the current branch. Default is **staged only**;
`--commit` creates one merge commit.

| Code | Meaning |
|---|---|
| 0 | Merged (staged or committed) |
| 2 | `jq` / Python required for metadata update missing |
| 3 | No metadata for that role/slug |
| 4 | Target index already has staged changes |
| 5 | Uncommitted target changes overlap incoming files |
| 7 | Squash merge conflict |

**`wt-cleanup.sh RUN_ID [--force] [--keep-branches]`** — Runs consolidate if
`CONSOLIDATED.md` is missing, removes worktrees, deletes branches unless
`--keep-branches`, skips dirty trees unless `--force`, keeps reports under
`~/.foreman/runs/<RUN_ID>/`. As of v0.2.7.5 (`worktree-hardening`), it also
SIGINTs a still-alive lane subprocess for that worktree before calling `git
worktree remove` (see section 7's grandchild-orphan note), and the whole
concurrent-worktree path carries a `git-guards.sh` config bootstrap
(`maintenance.auto=false`, `core.fsmonitor`, `core.longpaths`,
`safe.bareRepository=explicit`) plus a bounded-retry wrapper around shared
git-lock operations.

The repo layout puts worktrees as siblings of the repo root:

```text
<parent>/<repo>-wt-<RUN_ID>-search/
<parent>/<repo>-wt-<RUN_ID>-plan/
<parent>/<repo>-wt-<RUN_ID>-implement[-slug]/
```

Serialize create/remove through the scripts (`flock` when available). Do not
mount `~/.foreman/runs` into untrusted workers. Full doctrine:
[`skills/foreman/references/parallel-worktrees.md`](skills/foreman/references/parallel-worktrees.md).

## 11. The evidence contract

Lane reports are claims, not proof. The evidence contract makes a silent
no-op visible:

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

**Motivating bug: Grok headless write cancellation.** The Grok CLI's
`--permission-mode` flag only honors `bypassPermissions` and `default`. The
CLI accepts `--permission-mode acceptEdits` on the command line but
**silently ignores** it. In headless runs, tool calls that would prompt are
auto-cancelled — the model narrates edits while writing nothing;
`DIG_B == DIG_A`. Fix used by `grok-implementer`:

```bash
grok --prompt-file "$SPEC" \
  -m grok-4.5 \
  --allow "Write" --allow "Edit" \
  --output-format plain \
  --cwd "$(pwd)"
```

Capitalized rule prefixes auto-approve file writes and edits only. Shell
stays gated: Grok still cannot delete/rename files, chmod, or run
verification for you.

## 12. Verification and the audit lane

Reports are claims. Before accepting worker output the architect:

1. Reads the actual diff (`git status`, `git diff`)
2. Re-runs the Verification command and records the real output
3. Confirms evidence digests moved when the model claimed edits
4. Runs the docs stage when docs or scripts changed (section 13)
5. Invokes `codex-auditor` on non-trivial work with cold diff + criteria

Wrong code goes back to the implementer as a corrected five-part spec.
Required when any of: multi-file/multi-step deliverable, security-sensitive
paths (auth, crypto, network, secrets, shell), before declaring a multi-step
task done, or after a race between implementers. Trivial single-file
mechanical edits may skip audit if the architect states why.

| Verdict | Soft mode | Hard gate |
|---|---|---|
| APPROVED | Ship if independent checks green | May pass if hashes + forbidden paths clean |
| WARNING | Ship only after architect acknowledges findings | May pass; findings attach to PR body |
| BLOCKED | Rework via implementer with corrected spec | Gate fails |

Schema: `skills/foreman/scripts/adapters/verdict.schema.json`.

## 13. The documentation stage

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

Exit codes: `0` all pass, `1` findings, `2` required tool missing (fail
closed) — a missing linter never silently "passes." **This stage checks
markdown lint, spelling, links, and bash comment coverage only; it has no
AI-slop or prose-naturalness detector.** Prose quality is a human/architect
judgment call (see section 15), not something `docs-check.sh` measures.

## 14. Repo understanding (knowledge graph) and maintenance

This repo commits a knowledge graph at `graphify-out/graph.json`. For
concepts, architecture, or file relationships, query first:

```bash
graphify query "<question>" --budget 1500
```

Follow `source_location` pointers into files only for the facts you need.
Measured saving versus raw file reads: 45-77% of tokens on budget-capped
queries. If the graph is stale relative to HEAD, check
`graphify-out/GRAPH_REPORT.md` and refresh with `graphify --update`.

`skills/foreman/scripts/maintenance.sh --stage upstream|graph|compat|all
[--json PATH] [--strict] [--apply]` reports vendored-skill hash drift
(`skills/VENDORED.md`), graph freshness, and soft-profile tool inventory
drift. `.github/workflows/maintenance.yml` runs `--stage upstream` on
release/monthly cron/dispatch; it has not been exercised by a real release
yet.

## 15. Further reading, security, layout, license, lineage

- Full operating guide: [`docs/USAGE.md`](docs/USAGE.md)
- Install / Setup on Windows and WSL side by side: [`docs/INSTALL.md`](docs/INSTALL.md)
- Reference set index: [`skills/foreman/references/index.md`](skills/foreman/references/index.md)
- Architect doctrine: [`CLAUDE.md`](CLAUDE.md)

### Security model

Soft mode runs implementer CLIs on the host with their native sandboxes
only. Hard mode's shipped stages (CHECK/EVIDENCE/AUDIT/GATE) add host-side
evidence that is never mounted into a worker, forbidden-path and hash gates,
and cold-diff audit; its planned IMPLEMENT upgrade (section 6) would add
Docker worker constraints as an opt-in profile. Containers share the
host/WSL2 kernel — defense-in-depth, not a hard boundary. Full map:
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
├── config/foreman.toml.example
├── install.ps1 · install.sh
├── openspec/                # OpenSpec change-folder conventions
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
- Change-folder conventions follow [OpenSpec](https://github.com/Fission-AI/OpenSpec) (see `openspec/README.md`)
