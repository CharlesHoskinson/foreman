# Foreman use guide

End-to-end operation for cross-vendor orchestration running today. Claude
Code is the typical/default architect host but is not required by the
harness itself — orchestration works from Grok or Codex instead. Every run
moves through three ordered stages — **Setup & Environment → Use →
Cleanup** — identically on Windows and WSL/Linux. Soft mode is the default
Use path; hard mode is called out where it differs. Claims below match the
tree under `skills/foreman/`, `agents/`, `env/`, `launcher/`, and `tests/`,
and are consistent with
[`references/orchestration-hardening.md`](../skills/foreman/references/orchestration-hardening.md)
and
[`references/reference-environment.md`](../skills/foreman/references/reference-environment.md).

## 1. Running Setup

Setup owns tool inventory, bootstrap, and **all** vendor authentication. It
never runs during Use.

### 1.1 Windows

```powershell
cd path\to\foreman
.\env\tool-check.ps1 -Profile soft -Json -Out $env:USERPROFILE\.foreman\last-tool-check.json
```

If not ready:

```powershell
.\env\bootstrap-windows.ps1 -Profile soft -Yes
.\env\tool-check.ps1 -Profile soft
```

### 1.2 WSL / Linux

```bash
cd /path/to/foreman
bash env/bootstrap-wsl.sh --profile soft --yes   # full WSL-native provisioning
bash skills/foreman/scripts/foreman-setup.sh --profile soft
```

`foreman-setup.sh` (`skills/foreman/scripts/foreman-setup.sh [--profile
soft|hard|full] [--lane grok|codex|claude]`) composes `env/tool-check.sh`
rather than reimplementing it, and is bash-only — run it under Git Bash on
Windows, natively on WSL/Linux. It prints one `<vendor>: NOT-READY -- run
<instruction>` line for every unauthenticated vendor and never authenticates
anything itself:

| Vendor | Instruction Setup prints |
|---|---|
| grok | `grok login --device-code` |
| codex | `codex login` |
| claude | `claude auth login` |

Run the printed instruction yourself, then re-run the Setup command — it is
idempotent, so re-running against an already-ready host changes nothing and
re-reports READY. `--lane <vendor>` scopes the check to that vendor's own
readiness signal only, so a gap in an unrelated tool never blocks a lane
whose own vendor is already authenticated. Exit `0` = READY, `1` =
NOT-READY (whole-profile mode) or that lane not ready (`--lane` mode).

WSL is a co-equal, fully-provisioned target as of v0.2.7.5
(`wsl-reliability-env-refresh`): `bootstrap-wsl.sh` installs every tool
WSL-native — bats-core, shellcheck, bun (pinned 1.3.14), pueue (GitHub
release binary, no apt package), codex/grok (npm, forced `@latest` so the
platform-specific optional dependency re-resolves), jq, node/npm via fnm,
`hwclock` — and symlinks each into `/usr/local/bin` ahead of `/usr/bin`, so
resolution is identical under a login or non-login shell. `/etc/wsl.conf`'s
`[interop] appendWindowsPath=false` stops a leaked Windows npm shim from
shadowing the WSL-native `codex`/`grok` binaries.

### 1.3 Boot the architect

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

## 2. Driving a Use round

Use assumes an authenticated, provisioned environment and never
authenticates — `lane-run.sh` refuses to spawn a lane for a not-ready vendor
(citing Setup) before it ever touches the worktree lock, so a missing login
is always caught at Setup, never mid-round.

### 2.1 Create parallel recon worktrees

Pick one `RUN_ID` for the whole session (letters, digits, `.`, `_`, `-`
only):

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

Branches: `foreman/<RUN_ID>/<role>[/<slug>]`. Metadata and reports archive
under `~/.foreman/runs/<RUN_ID>/`.

### 2.2 Spawn search and plan

In Claude, spawn `foreman-search` and `foreman-plan` in parallel (one turn),
each with cwd set to its worktree (or `isolation: worktree`). Both are
read-only for product code. Each **must** write:

- `FOREMAN_REPORT.md`
- `FOREMAN_REPORT.json` (schema `foreman.worktree-report.v1`)

### 2.3 Consolidate recon

```bash
bash skills/foreman/scripts/wt-consolidate.sh "$RUN"
```

Read `~/.foreman/runs/$RUN/CONSOLIDATED.md`. Synthesize; do not ship on a
single partial report.

### 2.4 Write the five-part spec and implement

Create an implement worktree (default for soft implement rounds):

```bash
bash skills/foreman/scripts/wt-new.sh "$RUN" implement docs-stage
```

Route the full five-part spec to `grok-implementer` (or `codex-implementer`)
with that worktree as cwd. Standing rule: implementers never run git write
commands; changes stay uncommitted until the architect merges. Spec
template and vendor lane recipes: section 5 below and
[`../skills/foreman/references/five-part-spec.md`](../skills/foreman/references/five-part-spec.md).

### 2.5 Verify (architect)

Reports are claims. You:

1. `git -C <implement-wt> status` and `git diff`
2. Re-run the Verification command from the spec yourself
3. Confirm evidence digests moved when the model claimed edits

Wrong code → corrected five-part spec back to the cheap implementer lane,
not hand-patching on the architect model.

### 2.6 Audit

```bash
bash skills/foreman/scripts/wt-new.sh "$RUN" audit
```

Pass to `codex-auditor` (or `foreman-audit` wrapper): worker vendor,
acceptance criteria from the five-part spec, and a cold unified diff. After
the run, `git status --porcelain` in the audit tree must show no auditor
mutations.

### 2.7 Consolidate and land

```bash
bash skills/foreman/scripts/wt-consolidate.sh "$RUN"
# if implement tree is ready and checks + audit are green:
bash skills/foreman/scripts/wt-merge.sh "$RUN" implement docs-stage
# optional: --commit to create a single merge commit; default is staged only
```

Consult `foreman-advisor` only at commitment boundaries (architecture,
migration, API shape, or a problem that failed twice). Then run Cleanup
(section 3) to close the run.

## 3. Running Cleanup

```bash
bash skills/foreman/scripts/foreman-cleanup.sh "$RUN" [--force]
```

Deterministic, idempotent teardown, in order:

1. Best-effort SIGINT of any lane subprocess this run's event log still
   shows alive — before any worktree is touched.
2. Delegates to `wt-cleanup.sh` (`wt-cleanup.sh RUN_ID [--force]
   [--keep-branches]`): runs consolidate if `CONSOLIDATED.md` is missing,
   removes worktrees, deletes branches unless `--keep-branches`, skips dirty
   worktrees unless `--force`, keeps reports under
   `~/.foreman/runs/<RUN_ID>/`. Refuses to delete a worktree with
   uncommitted/untracked changes unless forced — reports are archived first
   either way.
3. Stops a foreman-owned `pueued` only if this run's own `.pueued-owned`
   marker says this run started it — never a blind `pueue shutdown`.
4. Sweeps this run's own stale `.seq.lock` / `.attempt.lock` /
   `.supervise.lock` directories — never the host-wide `~/.foreman/gate.lock`
   (section 4 owns that one) and never a worktree's own live
   `.harness/lane.lock`.

Safe to run more than once: re-running against an already-cleaned-up run is
a no-op. `--force` is typically required in practice — report files are
intentionally never merged, so an implement worktree that only ever wrote
`FOREMAN_REPORT.*` is still "dirty" from git's point of view even after a
successful `wt-merge`; those reports are already archived under
`~/.foreman/runs/$RUN/` by `wt-consolidate` before Cleanup runs.

## 4. Vendor lane recipes and the pueue/gate mutex doctrine

### 4.1 Direct CLI flags

| Lane | Producer | Direct CLI (headless) |
|---|---|---|
| Routine implementer | Grok 4.5 | `grok --prompt-file … -m grok-4.5 --allow "Write" --allow "Edit" --output-format plain --cwd <dir>` |
| Cross-vendor implementer | GPT-5.6 Sol (medium) | `codex exec --model gpt-5.6-sol -c model_reasoning_effort=medium --sandbox workspace-write` |
| Audit (default) | GPT-5.6 Sol (high) | `codex exec --model gpt-5.6-sol -c model_reasoning_effort=high --sandbox read-only` |
| Judgment | Fable / Opus | Session model or `model: fable` agent |

**Grok is live on the reference host**: Grok Build (0.2.103) installed via
`npm i -g @xai-official/grok`, signed in via `grok login --device-code`, and
one-shot headless completions return rc 0. The CLI accepts
`--permission-mode acceptEdits` but **silently ignores** it in headless
mode — always pass `--allow "Write" --allow "Edit"` (capitalized prefixes
auto-approve writes/edits only; shell stays gated, so Grok still cannot
delete, rename, chmod, or run verification). Treat a zero-change evidence
digest after a "successful" run as a cancelled-writes signal, not proof of
nothing to do.

**Durable-lane (non-interactive) recipe**, distinct from the
architect-dispatched `grok-implementer` agent above:

```bash
grok -p "<spec>" --cwd <worktree> --output-format json --always-approve \
  --session-id <uuid> --no-auto-update
# resume:
grok -r <session-id> --cwd <worktree> --output-format json --always-approve \
  --no-auto-update
```

`GROK_HOME` is set per lane by `lane-run.sh`'s `LANE_VENDOR=grok` plumbing —
never shared across concurrent lanes. Before spawning grok, `lane-run.sh`
scans the worktree for `.env` files (any depth, excluding `.env.example`)
and private-key material and refuses the lane
(`alert{kind:"grok_secrets_refused"}`) if either is found, since Grok
Build's whole-repo-upload behavior is unrefuted.

**Grok's concurrency is capped, not promoted.** It remains the routine
implementer by doctrine, but the destructive real-vendor concurrency test
(T5b) has not recorded an authenticated green row for either grok or codex
(`docs/research/vendor-concurrency-results.md`) — see section 4.2's `gate`
group and the honest-limits section in the README for the full account.
Do not raise the `grok`/`codex` pueue caps above 1 on the strength of the
unauthenticated auxiliary evidence in that file.

### 4.2 The pueue/`gate` mutex doctrine

`lane-queue.sh ensure|add GROUP -- CMD [ARGS...]|status [TASK_ID]|kill
TASK_ID` wraps pueue (staged at `~/.foreman/tools/pueue/`, v4.0.4 — no
Windows package-manager route) with a fixed group topology, created
idempotently by `ensure`:

| Group | Parallelism | Purpose |
|---|---|---|
| `grok` | 1 | Grok CLI concurrency cap (T5b UNVERIFIED) |
| `codex` | 1 | Codex CLI concurrency cap (ditto) |
| `claude` | 3 | Claude lane concurrency |
| `misc` | 2 | Catch-all |
| `gate` | 1 | **Host-wide bats mutex — every bats invocation, lane/auditor/investigation, enqueues here** |

The `gate` group exists because concurrent bats suites on one host is the
single most frequent failure class recorded in `bugeventlog.md` (corrupted
wall-clock tests, an orphaned auditor-run suite blocking the release gate
for roughly an hour). Standing rule: a lane round runs only its own
`.bats` file in its inner loop; the architect runs the full suite once at
merge, as sole gate holder; auditor and investigation agents never run bats
at all — they reason from code, never from a live test invocation.

Enqueue an implement round through the queue rather than dispatching the
vendor CLI directly:

```bash
bash skills/foreman/scripts/lane-queue.sh add grok -- <grok invocation>
bash skills/foreman/scripts/lane-queue.sh add gate -- bash tests/run.sh
bash skills/foreman/scripts/lane-queue.sh status <TASK_ID>
```

If pueue is absent (or `LANE_QUEUE_FORCE_MISSING=1`), `add` degrades to a
direct foreground spawn with a "degraded" stderr marker; `ensure`/`status`/
`kill` fail loudly rather than silently no-op.

### 4.3 Durable rounds: `lane-run.sh --round`, `watch.sh`, `resume.sh`

An implement round that must survive the dispatching agent backgrounding
and stopping is `lane-run.sh --round GATE_CMD REPORT_PATH RUN LANE WORKTREE
-- CMD...` — this owns the **whole** round (CMD → gate → attempt-fresh
report assert → `round_done`), not just the bare vendor CLI:

```bash
bash skills/foreman/scripts/watch.sh "$RUN" "$LANE" "$WORKTREE"
```

is the per-lane stall watchdog. Arm real watchers with
`WATCH_OWNERSHIP_WAIT=25000` (**milliseconds** — 25 seconds, matching the
ownership event's own ~20s emission bound; the shipped default `3000` is a
bats-test-scale compromise, not the deployment recommendation). On `DEAD` it
prints a kill+retry hint and exits `3`. Recover a `DEAD`/crashed lane with:

```bash
bash skills/foreman/scripts/resume.sh [--force] [--exact] RUN LANE WORKTREE
```

Full launcher contract, the typed watch-state machine, vendor config
isolation, and the merge-freshness gate:
[`../skills/foreman/references/orchestration-hardening.md`](../skills/foreman/references/orchestration-hardening.md).

## 5. Writing five-part specs

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

- NEVER run git write commands (`commit`, `add`, `reset`, `branch`, `push`,
  `rebase`, `merge`, `tag`). Changes stay uncommitted in the working tree.
- Do not delete or rename files. List needed deletions/renames under
  `ARCHITECT_ACTIONS` in the report.
- Work only inside the provided worktree path.
- No network access unless the spec explicitly grants it.
- Documentation and comments are part of the deliverable: markdown passes
  markdownlint-cli2; bash functions carry shdoc headers (`# @description`
  minimum); scripts carry a top-of-file purpose comment.

If you cannot fill Interfaces or Verification, you are not ready to
delegate.

### Routing decisions

| Situation | Route |
|---|---|
| Spec fully determines the outcome | `grok-implementer` (default) |
| Costly mistakes / judgment-heavy implementation | Race Grok + `codex-implementer`, or keep with architect |
| Grok CLI missing or timed out | Re-route to `codex-implementer` and **say so** |
| After independent checks on a non-trivial diff | `codex-auditor` (default when worker ≠ OpenAI) |
| Worker was already Codex / OpenAI | **Do not** call `codex-auditor`; architect review or non-OpenAI audit; state the substitution |
| Architecture, migration, API shape, stuck twice | `foreman-advisor` (≤ ~300 words, read-only) |
| Implementer CLIs both unavailable | Architect types only after stating the same-family downgrade |

## 6. The docs stage

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
**`docs-check.sh` runs exactly these four checks — markdownlint, codespell,
lychee, and comment coverage — and nothing else.** It has no AI-slop or
prose-naturalness detector; do not treat a green run as a signal about
writing quality, only about lint/spelling/links/comment hygiene.

**Iterative rework.** On failure, feed the summary (and `docs-check.json` if
present) back to the implementer as a corrected five-part spec. Cap loops
with `[limits] max_rework_rounds` (default `3` in
`config/foreman.toml.example`).

## 7. Audits

### Cross-vendor rule

Auditor vendor **must differ** from worker vendor. Default: Grok implements
→ Codex GPT-5.6 Sol audits via `codex-auditor` (`--sandbox read-only`, high
reasoning). If Codex implemented, stop with `blocked_same_vendor` and pick
another review path.

### When to audit (soft)

Required after independent verification when any of: multi-file or
multi-step deliverable; security-sensitive paths (auth, crypto, network,
secrets, shell); before declaring a multi-step task done; after a race
between implementers (audit the chosen diff). Trivial single-file
mechanical edits may skip audit if the architect states why.

### Verdict schema

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

`[audit.policy]` (`warning_low_resolved`/`warning_medium`/`blocked` in
`.foreman/config.toml`) is soft-mode architect doctrine only —
`gate-eval.sh` does not yet bucket findings by resolved/unresolved severity;
that is a stated v0.3.0 consumer, not silently assumed today.

## 8. Troubleshooting

### Grok headless writes nothing

**Symptom:** model narrates edits; tree unchanged; evidence digests
identical.

**Cause:** the Grok CLI accepts `--permission-mode acceptEdits` but
**silently ignores** that value in headless mode.

**Fix:** always pass allow rules (capitalized prefixes):

```bash
grok --prompt-file "$SPEC" -m grok-4.5 \
  --allow "Write" --allow "Edit" \
  --output-format plain --cwd "$(pwd)"
```

### Concurrent-worktree git guards (worktree-hardening, v0.2.7.5)

Heavy concurrent worktree use produces specific, documented failure classes.
The guard bundle:

- **`git-guards.sh REPO`** — idempotent bootstrap: `maintenance.auto=false`
  (stops the reactive `gc.autoDetach` fork that competes for the object-DB
  lock mid-commit), `core.fsmonitor=true` + `core.untrackedCache=true`
  (faster status without a filesystem watcher), `core.longpaths=true`
  (Windows `MAX_PATH`), `safe.bareRepository=explicit`. It also runs `git
  maintenance run --auto` directly (throttled via a marker file, default
  interval 3600s) as the foreman-owned maintenance tick — it deliberately
  does **not** call `git maintenance register`/`start`, since `start`
  installs real, host-wide Windows Scheduled Tasks this script cannot itself
  undo. Re-invoke it periodically (a Setup step, or before a work session)
  to keep the tick current.
- **`git_retry`** (`lib/worktree.sh`) — bounded exponential backoff (5
  attempts, 200→400→800→1600ms) around shared-lock-touching worktree
  operations, riding out a transient `Unable to create '.git/index.lock'`
  instead of aborting on the first failure.
- **`wt_sweep_stale_locks REPO [THRESHOLD_S]`** — removes 0-byte `*.lock`
  files older than ~30s (default) at lane start, in both `wt-new.sh` and
  `lane-run.sh`, so a crashed prior process's lock never blocks a fresh lane
  indefinitely. Never touches a non-empty or fresh lock a live process may
  hold.
- **`GIT_OPTIONAL_LOCKS=0`** on read-only git polling (status/diff/log) and
  **`GIT_ASK_YESNO=false`** lane-wide, so a Windows "Unlink failed. Try
  again?" prompt auto-declines instead of hanging with no TTY to answer.
- **`wt-cleanup.sh` SIGINT-before-remove** — before `git worktree remove`,
  reads the run's event log for the worktree's last `ownership` event and,
  if that pid is still alive, SIGINTs it, waits a bounded grace period, and
  escalates to SIGKILL if needed — order is load-bearing, always before
  removal. This targets the single recorded pid only; a grandchild process
  (e.g. a git subprocess it spawned) is swept in a best-effort follow-up
  pass (`taskkill //T` via winpid translation on Windows, a process-group
  kill on POSIX) — see the README's honest-limits section for why that
  second pass exists and what it does not guarantee.
- **Windows Defender exclusions** (operator doctrine, not automated): add
  path exclusions for the repo and every sibling `*-wt-*` worktree
  directory — real-time scanning of `.git` internals is a measured
  stall/unlink-failure cause on this host class.

### The POSIX launcher cascade (pidns)

As of v0.2.7.5 (`posix-cascade-parity`), the POSIX `foreman-launch` build
self-re-execs under `unshare --pid --mount-proc --fork --kill-child`,
becoming PID 1 of a fresh PID namespace — killing the launcher for any
reason now reaps the whole process tree, kernel-enforced. When `unshare` is
unavailable or fails (checked via a disposable probe before the
irreversible self-replacement), the launcher falls back to the pre-v0.2.7.5
`setsid` + `kill(-pgid)` path and logs a **DEGRADED** marker — check for that
marker before assuming the stronger guarantee held. Full mechanism:
`launcher/README.md` "POSIX asymmetry."

### Codex timeout (~600s wall clock)

Implementer and auditor wrappers use `timeout`/`gtimeout` **600** seconds
when present. On `STATUS: timeout`, split into smaller five-part specs or a
narrower audit diff and re-route. Do not silently lengthen a hung call or
substitute Claude under the Codex lane name.

### jq on Windows

Hard-mode scripts and some metadata paths prefer `jq`. When `jq` is missing,
only `wt-merge.sh` accepts `python3` or `python`; `wt-new.sh`,
`wt-consolidate.sh`, and `wt-cleanup.sh` require `python3` specifically. On
a Windows-only host where only a `python` command is on PATH (no `python3`
alias/shim), those three scripts fail with a missing-command error even
though Python is installed — use a `python3` alias/symlink (or WSL) for
them; `wt-merge.sh` alone works with plain `python`. Install Python ≥ 3.11
for the fallback, or install `jq` in WSL for hard mode.
`env/reference-manifest.toml` marks `jq` required for hard/full on WSL.

### bats location

```bash
bash tests/run.sh
```

Looks for `bats` on PATH, then `~/.foreman/tools/bats-core/bin/bats`.
Install hint from the runner:

```bash
git clone https://github.com/bats-core/bats-core ~/.foreman/tools/bats-core
```

Contract is WSL (or Git Bash with bats); PowerShell does not run the suite.

### lychee PATH on fresh shells

`docs-check.sh` resolves `lychee` from PATH, then
`%LOCALAPPDATA%/Microsoft/WinGet/Links/lychee.exe`, then WinGet package
folders. After a winget install, open a **new** shell so PATH and those
locations are visible; otherwise lychee is recorded `missing` and
docs-check exits `2`.

### Other frequent failures

| Symptom | Action |
|---|---|
| `STATUS: unavailable` from a lane | Install/auth the CLI; re-route; never fake the lane as Claude |
| `blocked_same_vendor` from codex-auditor | Worker was OpenAI family; pick another auditor |
| wt-merge exit 5 | Overlap with dirty target files; commit, stash, or partition ownership |
| wt-cleanup skips tree | Dirty worktree; commit/merge first or pass `--force` |
| Gate fail closed | Missing audit CLI or checks infra; fix inventory, do not skip gate |
| Setup reports a vendor NOT-READY | Run the printed auth instruction; a Use request to that vendor is refused at the door, never mid-round |

## 9. FAQ

**Why the cost discipline?**
The session architect model is the expensive lane. It should emit judgment
(specs, routing, verdicts), not implementation volume. Graph-query-first and
cheap implementers keep most tokens off Fable/Opus.

**Why cross-vendor audit?**
Same-family self-review shares blind spots. Default pairing (Grok
implements, Codex Sol audits, Claude architects) decorrelates review.
Same-vendor audit of a Codex worker via `codex-auditor` is forbidden.

**Is grok mandatory?**
No. You can orchestrate without Grok/Codex, but implementer and auditor
agents will report `unavailable` rather than silently typing as Claude.
Grok is live and wired into the lane machinery on the reference host, but
its concurrency beyond one lane is UNVERIFIED (T5b) — see the README's
honest-limits section — so nothing in this doc treats it as mandatory or
as concurrency-safe.

**Where does run state live?**
`$FOREMAN_HOME/runs/<run-or-task-id>/` (default `~/.foreman/runs/`),
including worktree metadata, reports, `CONSOLIDATED.md`, and hard-mode
evidence. Worktrees themselves sit as siblings of the repo root:
`<parent>/<repo>-wt-<RUN_ID>-<role>[-slug]/`.

**Soft vs hard: which should I use?**
Soft for interactive Claude sessions with Grok/Codex CLIs. Hard when you
need scripted INIT→GATE enforcement, host evidence, and forbidden-path
gates. Hard mode's IMPLEMENT stage (`worker-run.sh`) is still a stub in this
release — see the README's hard-mode section for the approved next-release
design (launcher-only default, container opt-in) — use soft agents for
typing today.

**What is OpenSpec in this repo?**
`openspec/README.md` defines change folders under
`openspec/changes/<name>/` (proposal, specs, design, tasks). Workflow:
propose → approve → implement via Foreman lanes → archive. Legacy specs
remain in `docs/superpowers/specs/`.

**How do I preview the docs site?**
See `site/README.md`: `python -m http.server 8080 --directory site` or open
`site/index.html` directly.
