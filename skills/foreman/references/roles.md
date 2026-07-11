# Roles — Orchestrator and Worker

Foreman is a two-role, cross-vendor pattern (design spec §6). Every stage of the task
loop belongs to exactly one role. The scripts enforce the boundary; this document
describes the contract each role must honor.

## Orchestrator (you)

The orchestrator is whichever coding CLI the user invoked the skill from — Claude Code,
OpenAI Codex, or xAI Grok Build. It is also the **audit owner**: the CLI that reviews the
worker's diff must be a different vendor from the worker, but it is still driven by the
orchestrator's stage flow.

The orchestrator owns:

- **The task envelope** — `task.md` (goal, constraints, done-when criteria), created by
  `task-new.sh` and filled in by you.
- **The plan** — `plan.md`: approach, files to touch, acceptance criteria, optionally
  grounded in a Graphify knowledge graph of the repo.
- **Evidence** — the diff, diff-stat, git status, HEAD sha, and commit log collected by
  `evidence-collect.sh` from the worker's committed state, never from chat claims.
- **The audit** — invoking a different-vendor CLI read-only against the cold diff and
  acceptance criteria (no worker chat history), and treating its verdict as untrusted
  triage input rather than ground truth.
- **The gate** — the deterministic pass/fail decision in `gate-eval.sh`: forbidden-path
  check, hash-drift check, checks-green check, verdict-not-BLOCKED check.
- **The PR** — pushing the branch and opening the PR with the evidence summary via
  `pr-open.sh`. CI remains the final merge authority; the gate is a pre-condition for
  opening a PR, not a substitute for CI.

**The orchestrator never edits the worktree.** All handoff to the worker happens through
files (`task.md`, `plan.md`, `rework-N.md`) and git — never through chat context injected
into the worker's prompt, and never by the orchestrator directly writing into the
worker's git worktree. If the orchestrator needs a change made, it goes back through
`worker-run.sh` as a fresh (or rework) round.

## Worker

The worker is a *different vendor's* CLI from the orchestrator, launched headlessly by
`worker-run.sh` inside the hardened container defined by `sandbox/docker-run.sh`. Only
the task's git worktree is mounted read-write; the run directory
(`~/.foreman/runs/<task-id>/`) is never mounted into the container.

The worker's contract:

- **Implements only.** It receives the task, the plan, and any prior rework findings —
  concatenated into a single prompt file — and nothing else. It has no access to the
  orchestrator's chat history, no access to other repos, and no ability to see or
  influence the audit.
- **Must commit its work.** `worker-run.sh` inspects `HEAD` before and after the run and
  the worktree's `git status --porcelain`. A round only counts as `ok` if the worker
  committed (`HEAD` moved) and left a clean tree. Uncommitted changes are not eligible
  for CHECK or AUDIT — they are simply discarded from the harness's perspective on the
  next round.
- **Never touches forbidden paths.** `gate.forbidden_paths` in `.foreman/config.toml`
  (default: `tests/**`, `.github/**`, `.foreman/**`, `*.lock`, `package-lock.json`,
  `scripts/run_checks*`) are off-limits. The worker is not told this is enforced by a
  separate deterministic check — the gate catches it regardless of whether the worker
  respects the instruction in `task.md`.
- **Has no network.** The container is launched with `--network none` (for CHECK) and
  hardened flags for IMPLEMENT (`--cap-drop ALL`, `--security-opt no-new-privileges`,
  read-only root + tmpfs, pids/memory limits). There is no exfiltration path and no way
  to fetch additional instructions or payloads mid-run.
- **Gets task + plan + rework files as its whole context.** Nothing else. No system
  prompt describing the orchestrator's internal reasoning, no access to previous rounds'
  raw event logs, no visibility into the audit verdict format beyond what the task
  envelope says. This is deliberate: it keeps the worker's context minimal and
  keeps the orchestrator's evidence trail (the diff) the only channel that matters.

## Why the split matters

Cross-vendor role separation is retained because decorrelated failure modes are the one
defensible multi-agent review pattern available today: a same-vendor worker and auditor
share training data, RLHF incentives, and blind spots, so an auditor from the same vendor
is more likely to rubber-stamp the worker's own reasoning. Splitting vendors, combined
with the worker never seeing the audit and the orchestrator never touching the worktree,
means each role can only affect the outcome through the channel the harness scripts
actually check (commits, diffs, hashes, verdicts) — not through shared context or mutual
trust.
