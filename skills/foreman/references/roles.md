# Roles

## Orchestrator (Architect)

**Who:** The CLI session that invoked `/foreman` (Claude Code, Codex, or Grok).

**Owns:**

- Requirements and acceptance criteria
- Decomposition into tasks
- Five-part specs
- Lane routing (soft) or worker vendor selection (hard)
- Independent verification of checks
- Audit judgment (or dispatch of audit)
- Gate decision and PR intent

**Does not:**

- Type routine implementation when a worker lane is available
- Trust worker self-reports as evidence
- Share unredacted secrets with workers beyond the single vendor key hard mode injects

## Worker (Implementer)

**Who:** A *different* vendor’s coding CLI (or agent that shells out to it).

**Soft mode:** `grok-implementer` or `codex-implementer` (Claude agents that drive
external CLIs). Hard mode: containerized CLI via `worker-run.sh`.

**Owns:**

- Implementing exactly the five-part spec
- Committing work in the worktree (hard mode)
- Returning a structured report (soft mode)

**Does not:**

- Change architecture or expand scope without reporting a gap
- Edit tests / CI / lockfiles when forbidden (hard gate enforces)
- Receive orchestrator chat history (context-free handoff only)

## Auditor (Cold-diff review)

**Who:** Default soft/hard auditor is **`codex-auditor`** — GPT-5.6 Sol via Codex
CLI, **read-only** sandbox. Must be a **different vendor** than the worker
(default: Grok worker → Codex auditor).

**Owns:**

- Cold review of unified diff + acceptance criteria only (no worker chat history)
- Schema-forced verdict: `APPROVED` | `WARNING` | `BLOCKED` + findings
- Proving it did not mutate the working tree

**Does not:**

- Implement, patch, or expand scope
- Audit its own family’s implementation (if worker was Codex, pick another auditor)
- Replace the architect’s ship decision (verdict is gate input, not a final order)

## Advisor (Judgment)

**Who:** `foreman-advisor` — top judgment model, read-only tools (Claude Fable/Opus).

**Owns:**

- Verdicts at commitment boundaries (architecture, migrations, API shapes, stuck work)
- Short, decisive recommendations (≤ ~300 words)

**Does not:**

- Implement, edit files, or rubber-stamp weak plans
- Replace the Codex auditor for routine post-diff review (different job: strategy vs. cold-diff QA)

