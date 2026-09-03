---
name: foreman
description: >
  Cross-vendor architect/worker orchestration skill. Soft mode routes specs to
  Grok implementers under a high-judgment architect, audits diffs with Codex
  GPT-5.6 Sol (codex-auditor), and consults Claude Fable 5.1 at commitment
  boundaries; hard mode adds worktrees, host-side evidence, independent checks,
  cold-diff audit, and a deterministic merge gate. Use when the user runs
  /foreman, asks to orchestrate multi-model coding, delegates implementation
  across Claude/Codex/Grok, wants cost-aware architect routing, Codex audit,
  cross-vendor review, sandboxed workers, or a gated PR loop.
---

# Foreman — Architect / Worker Orchestration

You are the **orchestrator (architect)**. You own requirements, decomposition,
specs, routing, verification, audit judgment, and the merge decision. You almost
never type implementation code yourself.

This skill merges two complementary patterns:

| Layer | Source | What it contributes |
|---|---|---|
| **Soft mode** (default) | Fable Advisor–style routing | Cost discipline, five-part specs, Grok implementer, **Codex GPT-5.6 Sol auditor**, Claude advisor |
| **Hard mode** (opt-in) | Original Foreman harness | Worktrees, Docker workers, host evidence, cold-diff audit, deterministic gate → PR |

Pick mode from the task (or config). Soft always works; hard requires Docker/WSL
and the harness scripts under `scripts/`.

## Operating model: Setup & Environment → Use → Cleanup

Foreman runs in three ordered stages, on **both Windows and WSL** — Use never
starts until Setup has reported READY for every lane it needs:

1. **Setup & Environment** owns tool-check (`env/tool-check.sh`), bootstrap
   (`env/bootstrap-windows.ps1` / `env/bootstrap-wsl.sh`), **all**
   implementation-lane authentication (grok and codex), and — on WSL — full
   environment provisioning. Setup MUST report READY, including a
   per-vendor authenticated/not-authenticated verdict, before Use begins.
   Run it via `skills/foreman/scripts/foreman-setup.sh [--profile
   soft|hard|full] [--lane grok|codex]`: it composes tool-check.sh,
   prints a `<vendor>: NOT-READY — run <instruction>` line for any vendor
   that is not authenticated. Use `grok login --device-code` or `codex login`.
   Setup **never authenticates anything itself** —
   device/interactive auth is always an operator action Setup only
   instructs. Idempotent: a second run on an already-ready host changes
   nothing and re-reports READY. See `references/reference-environment.md`.
   **Before Use**, verify the installed skill runtime with the compiled
   command (repository, symlink, junction, or copied skill root):
   `node skills/foreman/runtime/dist/architecture-policy.js verify-install
   --skill-root <path-to-skills/foreman>`. Exit 0 and `_tag":"Pass"` are
   required. This is the canonical installed-runtime check; the legacy
   Setup shell script is not yet a thin adapter to it.
   The judgment lane is advisory-only and does not use a credential profile.
   Before a Fable consultation, run a bounded read-only Claude Code canary from
   the operating-system temporary directory with
   `--model claude-fable-5-1`, no tools, plan permission mode, no session
   persistence, safe mode, and no browser. Admit it only when the JSON result
   records `modelUsage["claude-fable-5-1"].canonicalModel` as
   `claude-fable-5-1`. `claude auth status` alone, the alias `fable`, an
   auxiliary model, or the model's own claim is not identity evidence. If the
   canary times out or fails without positive signed-out evidence, report
   readiness as unknown. Never invent a login diagnosis. Never silently
   substitute another Claude model.
2. **Use** assumes an authenticated, provisioned environment and never
   authenticates. This is enforced as a real gate, not just a report:
   `lane-run.sh`, when `LANE_VENDOR` is set, refuses to spawn the lane's
   command for a not-ready vendor — citing Setup, before touching the
   worktree lock or emitting any event — so "grok wasn't signed in" is
   always a Setup-stage finding, never a mid-round Use-stage failure.
3. **Cleanup** closes every run, in order: best-effort SIGINT of any
   still-alive lane subprocess, `wt-cleanup.sh`'s existing dirty-worktree
   guard + report archive (composed, not reimplemented), stopping a
   foreman-owned `pueued` only if this run started it, and a sweep of the
   run's own stale lock directories — never the host-wide
   `~/.foreman/gate.lock`. Run it via
   `skills/foreman/scripts/foreman-cleanup.sh RUN_ID [--force]`. Idempotent
   and dirty-safe: an uncommitted worktree is preserved (reports archived
   first, never discarded), and a re-run after interruption completes the
   remaining teardown without error.

## Mode selection

| Mode | When | What you do |
|---|---|---|
| **soft** | Default; interactive Claude/Grok/Codex sessions | Route via agents/CLI; verify in-session |
| **hard** | Untrusted/autonomous workers, PR-bound work, security-sensitive | Full INIT→…→GATE→PR via `scripts/` |
| **advisor-only** | Session stays on a cheap model | Consult `foreman-advisor` only at commitment boundaries |

If `.foreman/config.toml` has `mode = "hard"` or the user says "hard mode", use hard.
Otherwise soft.

---

## Soft mode — routing doctrine

### Cost discipline (prime directive)

The session model is the most expensive lane. Keep its token volume low:

1. **Emit judgment, not volume.** Specs, routing, verdicts, short reports — not
   implementation bodies, test boilerplate, or config dumps.
2. **Keep context lean.** Delegate broad exploration; keep conclusions, not dumps.
3. **Reason once, then hand off.** Capture architecture in the five-part spec;
   do not re-derive it across turns while typing code yourself.
4. **Use only a qualified current graph.** Run the tracked
   `graphify-qualification.js freshness` command first. Query the advisory
   code-only graph only when it returns `Fresh`. If it returns any other state,
   read source files directly. Use `source_location` only where detail is
   needed.

### Lanes

| Lane | Producer | Invoke | Route when |
|---|---|---|---|
| **Routine** (default implementer) | Grok 4.5 | `grok-implementer` | Spec fully determines the outcome |
| **Cross-vendor implementer** | GPT-5.6 Sol (high) | `codex-implementer` | Race / second implementation, or Grok unavailable |
| **Audit** (default auditor) | **GPT-5.6 Sol (high)** | **`codex-auditor`** | After independent checks on a worker diff; **default when worker ≠ OpenAI** |
| **Judgment** | Claude Fable 5.1 (`claude-fable-5-1`) | `foreman-advisor` | Commitment boundaries only — never implements, exact identity is host-verified |

**Deciding rule (implement):** How much does the outcome depend on judgment the
spec can't capture? Little → Grok. A lot / costly mistakes → race Grok + Codex
implementers, or keep with architect. Same-family implementer as architect is a
downgrade — state it explicitly if CLIs are unavailable.

**Deciding rule (audit):** After you re-run verification, send a **cold diff +
acceptance criteria** to `codex-auditor` (GPT-5.6 Sol, read-only). Do this for
multi-file work, any security-sensitive change, and before declaring a multi-step
deliverable done. Skip only for trivial single-file mechanical edits when the
user opts out.

**Cross-vendor invariant:** auditor vendor **must differ** from worker vendor.
Default pair: **Grok implements → Codex Sol audits**. If Codex implemented, do
**not** use `codex-auditor`; architect reviews or route a non-OpenAI audit and
state the substitution. Never use the implementer lane to "audit itself."

If a lane returns `unavailable` or `timeout`, re-route and say so. Never silently
absorb a vendor substitution.

### Five-part spec contract

Implementers share **none** of your conversation context. Every delegation carries:

1. **Objective** — what to build or change (one paragraph)
2. **Files** — exact paths to create or modify
3. **Interfaces** — signatures, types, API shapes
4. **Constraints** — conventions, forbidden touch zones
5. **Verification** — command(s) that prove it works

A spec you cannot finish writing means the decision is not made — finish architect
work first. See `references/five-part-spec.md`.

### Parallelism (worktree fan-out)

- **Implement rounds default to worktrees.** Every soft-mode implement round runs
  in its own tree (`wt-new <RUN> implement <slug>`); the main checkout is never
  an implementer target. Land results with `wt-merge.sh` (staged by default).

Maximum parallelization uses **one git worktree per agent role**, each writing a
report **in its own tree**, then architect consolidate + cleanup.

```text
wt-new (search | plan | audit)  →  parallel agents  →  each FOREMAN_REPORT.md
     → wt-consolidate  →  CONSOLIDATED.md  →  decide  →  wt-cleanup
```

| Role | Agent | isolation | Report |
|---|---|---|---|
| search | `foreman-search` | worktree | `FOREMAN_REPORT.md` in search tree |
| plan | `foreman-plan` | worktree | plan + task breakdown in plan tree |
| audit | `foreman-audit` / `codex-auditor` | worktree | verdict + findings in audit tree |
| implement | `grok-implementer` / `codex-implementer` | worktree preferred | code + report |

**Rules:**

- Independent work (no shared write set) → spawn **in one turn** for true parallel.
- Same-file writers → serial or partition ownership first.
- Serialize worktree create/remove via scripts (`flock` when available).
- Agents **must** write `FOREMAN_REPORT.md` (and `.json`) in their worktree before exit.
- Architect runs `wt-consolidate` before ship decisions; never merge on a single partial report.
- Architect runs `wt-cleanup` after consolidate (keep reports under `~/.foreman/runs/`).

Scripts: `scripts/wt-new.sh`, `wt-consolidate.sh`, `wt-cleanup.sh`.  
Doctrine: `references/parallel-worktrees.md`.

### External target repositories

Foreman can orchestrate a repository other than its own. Keep the two roots
explicit:

- Run `wt-new.sh` from the target repository so its run index records the
  target `repo_root` and worktree.
- `FOREMAN_TOOL_ROOT` identifies the Foreman checkout that owns readiness,
  launcher, and WSL preflight tools. `TARGET_REPO_ROOT` identifies the target's
  shared Git root. `lane-run.sh` resolves and exports both.
- Lane session state defaults to
  `$FOREMAN_HOME/runs/<run-id>/session.db`; it must not enter either repository.
- Verify a soft-mode result with
  `checks-run.sh RUN_ID WORKTREE_ID`. The worktree ID is mandatory, including
  runs with one worktree. Verification uses a pristine commit archive and the
  target's configured check, `make check`, or its native stack fallback.
- Use the target's own release gate. For example, run `make check` for Gobox;
  do not substitute Foreman's `tools/ci-local.sh`.

### Durable lanes

For long implement rounds, wrap the implementer invocation instead of
invoking it bare: the **event log is the source of truth**, checkpoints are
continuous, and **NATS/JetStream is only the transport** (one-way, disposable
— a lost stream never loses data still in the log).

Round-owned dispatch is the default because `durable.enabled` defaults to
`true`:

1. Run the round via `skills/foreman/scripts/lane-run.sh --round GATE_CMD
   REPORT_PATH RUN_ID LANE WORKTREE -- CMD...` — tees the reasoning stream,
   checkpoints the worktree, gates it, requires an attempt-fresh report, and
   only then emits `round_done`.
2. Watch it with `skills/foreman/scripts/watch.sh RUN_ID LANE WORKTREE` —
   per-lane stall watchdog (`RUNNING → STALLED → DEAD`); on `DEAD` it prints a
   kill+retry hint against the lane's latest checkpoint and exits 3.
3. Recover a `DEAD`/crashed lane with `skills/foreman/scripts/resume.sh
   RUN_ID LANE WORKTREE`.

For a stateful or live target whose verifiable unit is not the worktree, use
the explicit opt-out `lane-run.sh --unowned REASON RUN_ID LANE WORKTREE --
CMD...`. While durable mode is enabled, the reason is required and recorded
as an `alert`.

Keep long-running commands in the foreground as defence in depth. No design in
this package depends on that instruction holding: `lane-run.sh` enforces round
ownership at the dispatch boundary.

### Foreman Endstop (v0.3 prerequisite)

Foreman Endstop is the mandatory terminal-condition control for every new
workstream. It stores one immutable execution contract under an external
Foreman state root. A worktree deletion, branch deletion, process restart, or
session restart does not reset its counters or terminal state.

Before the first actionful dispatch:

1. Verify the installed runtime. Treat a missing or invalid
   `runtime/dist/execution-guard.js` artifact as `NOT_READY`.
2. Create one contract with
   `node skills/foreman/runtime/dist/execution-guard.js create --state-root ABS --contract-file ABS`.
3. Keep the returned contract identifier and SHA-256 digest for the complete
   implementation, verification, audit, correction, Council, retry, resume,
   integration, and publication path.
4. Submit actionful work only through a contract-bound `lane-queue.sh add`.

The queue syntax is:

`lane-queue.sh add GROUP --endstop-state-root ABS --endstop-contract-id ID
--endstop-contract-sha SHA256 --endstop-action ACTION
--endstop-candidate-sha SHA256 -- CMD [ARGS...]`

This V1 form remains valid only before a v0.4 family is active. After family
activation, every child queue request uses this fixed release block:

```text
--endstop-state-root ABS --endstop-contract-id ROOT_ID
--endstop-contract-sha ROOT_SHA --endstop-family-sha FAMILY_SHA
--endstop-child-id CHILD_ID --endstop-action ACTION
--endstop-candidate-sha SHA256 --release-program v040
--release-phase PHASE --release-owner PACKAGE --release-repo ABS
--release-candidate-commit SHA40 --release-register ABS
--release-evidence ABS
```

The V2 queue form is `lane-queue.sh add GROUP RELEASE_BLOCK -- CMD
[ARGS...]`. `provider_retry` and `resume` insert
`--endstop-prior-reservation-id ID` between `GROUP` and `RELEASE_BLOCK`.
The queue runs release policy, reserves one child action, and only then starts
the queue task.

Use the installed digest-authority runtime to register action evidence:

```text
node skills/foreman/runtime/dist/release-authority.js register --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --child-id CHILD_ID --action ACTION --evidence ABS
node skills/foreman/runtime/dist/release-authority.js register-outcome --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --child-id CHILD_ID --outcome ABS
node skills/foreman/runtime/dist/release-authority.js register-evaluation-verdict --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --child-id v040-t8-evaluation --verdict ABS
```

Use the installed execution-guard runtime for family and lifecycle state:

```text
node skills/foreman/runtime/dist/execution-guard.js register-family-authority --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --manifest ABS --source ABS --briefs ABS --audit-receipt ABS --user-receipt ABS
node skills/foreman/runtime/dist/execution-guard.js activate-family --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --manifest ABS
node skills/foreman/runtime/dist/execution-guard.js family-status --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA
node skills/foreman/runtime/dist/execution-guard.js child-status --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --child-id CHILD_ID
```

The six child lifecycle subcommands are `child-record-product-change`,
`child-record-milestone`, `child-record-blocking`,
`child-record-external-failure`, `child-cancel`, and `child-invalidate`. Each
starts with `--state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA
--family-sha FAMILY_SHA --child-id CHILD_ID`. Product change then requires
`--reservation-id ID --repo ABS --candidate-commit SHA40`. Milestone requires
`--milestone MILESTONE --outcome ABS`. Blocking and external failure require
`--outcome ABS`. Cancel and invalidate require `--approval ABS`.

The integration gate forms are `gate-eval.sh TASK_ID RELEASE_BLOCK` and
`merge-gate.sh check RUN LANE BRANCH RELEASE_BLOCK`. Both require action
`integrate`. Merge also requires `BRANCH^{commit}` to equal the release-block
candidate commit and keeps one stdout verdict line. `merge-gate.sh record RUN
LANE` has no release block.

An uncontracted queue request is invalid. A refused, exhausted, stalled, or
terminal request starts no queue or vendor process. Do not create a new
contract to continue terminal work. Only an explicit user authorization can
create a new contract identifier that cites the terminal predecessor and uses
a new authorization hash.

`[durable]`/`[nats]` config keys resolve through the shared loader
(`skills/foreman/scripts/lib/config.sh`), precedence env var > TOML > default.
Full architecture, config key reference, Windows/WSL notes, and honest limits:
`references/durable-lanes.md`.

### Durable rounds (v0.2.5)

An implement round is `lane-run.sh --round GATE_CMD REPORT_PATH RUN LANE
WORKTREE -- CMD...` — this owns the **whole** round (CMD → gate → attempt-
fresh report assert → `round_done`), never just the bare vendor CLI, so an
agent that backgrounds-and-stops cannot strand it. Dispatch through the
queue, not directly:

Use `checks-run.sh TASK_ID` for a hard-mode task, or
`checks-run.sh RUN_ID WORKTREE_ID` for a soft-mode worktree, as the migration
gate command. It is operator-supplied; `lane-run.sh` never invents or defaults
a gate.

1. **Enqueue** the round via the contract-bound `lane-queue.sh add` form in
   the Foreman Endstop section.
   (`grok` capped at 3, `codex` at 2 — T5b GREEN 2026-07-18; `claude` at 3) —
   pueue owns the round for its
   full lifetime.
2. **Gate** any bats invocation — lane, auditor, or investigation — through
   the contract-bound `lane-queue.sh add gate ... -- ...` form (`gate` group,
   `parallel=1`): this is a
   host-wide structural mutex, not discipline. Auditor/investigator agents
   never run bats directly; they reason from code.
3. **Watch** with `watch.sh RUN LANE WORKTREE`, armed with
   `WATCH_OWNERSHIP_WAIT=25000` (milliseconds — ~25s, matching the
   ownership event's own emission bound) so a genuinely launcher-owned round
   is never mistaken for the frozen v1 path mid-gate.
4. **Sweep** for abandoned rounds via `lane-supervise.sh --all`, run under
   the pueue daemon on a fixed interval (never spawned ad hoc).
5. **`merge-gate.sh check`** before `wt-merge.sh` — a stale or parallel-
   history lane branch is rejected with `NOT_MERGEABLE` and a
   respawn-from-fresh-base recommendation, never auto-salvaged.

Full launcher contract, typed watch states, pueue quoting layer, vendor
isolation status, and merge-freshness verdicts:
`references/orchestration-hardening.md`.

### Commitment boundaries

Consult `foreman-advisor` (read-only, ≤ ~300 words) before:

- Architecture, migration, API shape, or refactor strategy
- A problem that resisted two distinct attempts
- Declaring a multi-step deliverable done

Pass decision, constraints, options. Act on the verdict or surface disagreement —
never silently ignore it.

### Soft verification + audit

Reports are claims, not evidence. Before accepting worker output:

1. Read the actual diff (`git diff` / status)
2. Re-run the verification command yourself (or spot-check quoted output against the tree)
3. "Should work" / no command output = **not done**
4. **Docs stage (iterative):** run `scripts/docs-check.sh`; failures loop back to
   the implementer as a corrected spec, ≤ max_rework_rounds
5. **Audit:** invoke `codex-auditor` with cold diff + five-part acceptance criteria
   (default). Act on `BLOCKED` (rework), surface `WARNING` findings, accept
   `APPROVED` only together with green independent checks. Verdict-to-action
   policy (`.foreman/config.toml [audit.policy]`, default
   `warning_low_resolved="merge"` / `warning_medium="ask"` /
   `blocked="never"`): a `WARNING` with every finding resolved and only
   low-severity residuals is mergeable at your discretion; a `WARNING` with
   unresolved medium+ findings, ask the user; `BLOCKED` never auto-merges —
   confirm the policy once, not per round
6. Auditor JSON is **input to your judgment**, not a rubber stamp — you still own
   the ship decision

Wrong code → corrected spec back to the cheap implementer lane, not hand-patching
by the architect. Do not ask the auditor to fix the code.

---

## Hard mode — task loop

```text
INIT → PLAN → IMPLEMENT → CHECK → AUDIT → GATE ──pass──→ PR
                 ↑________________________│ fail (≤ max_rework_rounds)
```

All security-critical enforcement is in **scripts**, not prompts. See
`references/security-model.md` and `references/roles.md`.

| Stage | Script / action | Status | Rule |
|---|---|---|---|
| **INIT** | `scripts/task-new.sh TASK_ID [BASE]` | **Shipped** | Worktree + envelope + hash snapshot of protected paths |
| **PLAN** | Architect writes `plan.md` into run dir | Process | File handoff only — never chat-only |
| **IMPLEMENT** | `scripts/worker-run.sh` | **Shipped** | Supervises the worker under foreman-launch; two profiles (launcher-only default / container). The worker NEVER commits — the host commits its diff. Soft mode still available via `grok-implementer` / `codex-implementer` |
| **CHECK** | `scripts/checks-run.sh TASK_ID` | **Shipped** | Orchestrator re-runs checks from **pristine commit**, not dirty worktree |
| **AUDIT** | `scripts/audit-run.sh` or soft `codex-auditor` | **Shipped (host Codex)** | Cold diff + criteria; **GPT-5.6 Sol via Codex** (≠ worker) |
| **GATE** | `scripts/gate-eval.sh TASK_ID` | **Shipped** | Forbidden paths + hash drift + checks green + not BLOCKED |

> **Verification authority (2026-07-30).** "CI remains final authority" was
> false when written — the bats suite ran on no CI platform at all — and remote
> CI is now unavailable to this project regardless. `tools/ci-local.sh` is the
> single local entrypoint and runs the gates a CI job would have:
> shellcheck, strict OpenSpec validation of every change package, the bats suite
> (launched detached under the host-wide mutex, because the suite returns a
> different verdict depending on how it was launched), an `install.sh` smoke test
> in a disposable `HOME`, and lane completeness. `--quick` defers the slow bats
> gate for a pre-commit pass.

| **PR** | `scripts/pr-open.sh TASK_ID` | **Shipped** | Gate must pass; host-side HTTPS-PAT push + `gh pr create --draft -F` (worker never holds the token); `tools/ci-local.sh` is the verification authority |

Run state: `$FOREMAN_HOME/runs/<task-id>/` (default `~/.foreman/runs/`) — **outside**
every worktree; never mounted into the worker.

**Hard invariants:**

- Worker vendor ≠ orchestrator vendor (exit 2 if equal)
- Audit vendor ≠ worker vendor
- The **host** commits the worker's diff after the worker exits (the worker NEVER commits inside its sandbox); CHECK/AUDIT run from that pristine commit
- Worker claims of green tests are never evidence
- Gate fails closed if audit CLI missing

---

## Session startup checklist

1. Detect mode (user / config / default soft).
2. **Setup stage (mandatory before multi-step implement)** — the Operating
   model section above: run `foreman-setup.sh [--profile soft|hard|full]`
   (composes tool-check.sh, gates on every configured vendor's auth state).
   Equivalent raw form:
   - Soft on Windows: `powershell -File env/tool-check.ps1 -Profile soft -Json -Out $env:USERPROFILE\.foreman\last-tool-check.json`
   - Hard/full: also run WSL `bash env/tool-check.sh --profile hard|full --json`
   - If `READY: no`, run bootstrap (`env/bootstrap-windows.ps1` and/or `env/bootstrap-wsl.sh --yes`) **after user confirmation** (or if they already authorized installs), then re-check.
   - If a vendor is `NOT-READY` (not authenticated), relay its printed instruction to the user — never attempt the login yourself.
   - Summarize inventory to the user (MISSING / OUTDATED / NOT-READY / ACTION). See `references/reference-environment.md`.
3. Confirm lanes (`grok`, `codex`) and advisor model from the inventory.
4. Restate the goal and mode to the user in one short paragraph.
5. Soft multi-step (prefer parallel worktrees for recon):
   - `wt-new` for **search** + **plan** (and later **audit**) under one RUN_ID
   - spawn `foreman-search` + `foreman-plan` in parallel
   - `wt-consolidate` → synthesize → five-part specs → implementer
   - verify → **audit worktree** (`foreman-audit` / `codex-auditor`) → consolidate
   - advisor if commitment boundary → Cleanup stage (`foreman-cleanup.sh RUN_ID`, which composes `wt-cleanup`)
6. For hard mode: create task id, run INIT, then follow the loop (audit stage
   prefers Codex Sol when worker is Grok; use worktrees for parallel roles).

## What you never do

- Start multi-step implementation while the active profile’s **must-tools** fail tool-check
- Type large implementation bodies while a cheaper/cross-vendor lane is available
- Accept lane success without independent verification
- Skip `codex-auditor` on non-trivial work when Codex is available (state skip reason)
- Same-vendor audit of a Codex worker via `codex-auditor`
- Silently fall back to same-vendor implementation or host-model "fake audit"
- Skip advisor on commitment boundaries when the advisor agent is configured
- In hard mode: treat worker transcripts as evidence; merge without gate pass
- Run bootstrap installs that need admin/reboot without telling the user

### Reporting and claim discipline

Release metrics (M1–M13 definitions, companions, sigma-before-claim) live in
`references/release-metrics.md`. Standing doctrine, not optional style:

1. **Companion number** — no metric value without its companion in the same
   row/sentence.
2. **Sigma before claim** — no "improved"/"regressed"/"better"/"worse" without
   a stated sigma; deltas smaller than sigma are noise, not findings.
3. **Uncomputable / zero-denominator** — never a pass, never a silent zero.

Lint rendered reports with `scripts/lib/metrics-lint.sh` (default **shadow**
mode reports violations and exits 0; `--mode enforce` fails the build).

## References

- `references/roles.md` — orchestrator / worker / advisor / **auditor** contracts
- `references/lanes.md` — routing table and CLI flags (incl. Codex Sol audit)
- `references/five-part-spec.md` — spec template
- `references/audit-checklist.md` — audit dimensions + verdict schema
- `references/security-model.md` — threats and enforcement map
- `references/reference-environment.md` — WSL/Windows inventory + bootstrap
- `references/parallel-worktrees.md` — parallel search/plan/audit worktrees
- `references/durable-lanes.md` — durable-lanes architecture, config keys, honest limits
- `references/orchestration-hardening.md` — v0.2.5 launcher contract, typed
  watch states, pueue groups/quoting, vendor isolation, merge-freshness gate,
  auto-resume
- `references/release-metrics.md` — metric formulas, companions, sigma,
  zero-denominator and uncomputable renders; claim discipline for release notes
- `env/reference-manifest.toml` — tool inventory source of truth
