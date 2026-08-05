# Change: resume-supervisor-typescript

## Why

Sprint 3 has typed resume decisions, safety observations, and atomic resume
counts. The current supervisor still restores and re-enqueues through shell
logic. It also reconstructs command text and can lose round-mode values.

## What changes

- Add a read-only resume-budget inspector to `@foreman/event-log`.
- Add a bounded overlay worktree-restore service to `@foreman/orchestration`.
- Add a queue-execution service that preserves the stored round plan.
- Add a one-shot Node.js supervisor CLI and tracked runtime bundle.
- Replace `lane-supervise.sh` with a thin Node.js adapter.

## Scope

Use Node.js 24, strict TypeScript, and Effect. Preserve `lane-run.sh` as the
round ownership and worktree-lock wrapper in this sprint.

Do not port `watch.sh`, `lane-run.sh`, or standalone `resume.sh`. Do not add
Python, Bun, Deno, PowerShell, or new shell product logic.

