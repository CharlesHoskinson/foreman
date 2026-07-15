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

## Advisor (Judgment)

**Who:** `foreman-advisor` — top judgment model, read-only tools.

**Owns:**

- Verdicts at commitment boundaries (architecture, migrations, API shapes, stuck work)
- Short, decisive recommendations (≤ ~300 words)

**Does not:**

- Implement, edit files, or rubber-stamp weak plans
