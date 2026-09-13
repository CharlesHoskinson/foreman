# Parallel worktrees

Partition writable paths before starting parallel tasks. Each writing task needs a separately admitted worktree at its immutable base. Read-only search and planning can share immutable inputs. Do not place execution state or credentials inside a provider workspace.

Project settings declare worktree grants, the pool root, allowed paths, and concurrency limits. `fm/task` uses those grants. Pel source expresses parallel execution and races. The host retains ownership, budgets, candidate evidence, and cleanup responsibility.

For a race, assign each contender a distinct worktree. Only the durable winner can promote its candidate. Cancellation must reconcile every losing contender. An unknown external outcome remains needs-action and cannot authorize another dispatch.

Inspect host verification and independent review before integration. A worker report does not establish candidate identity or permission to merge. Preserve dirty work and retained evidence until their disposition is explicit. Do not remove ownership locks or expand write scope to bypass a refusal.

## Stateful / live-target profile

A worktree does not reproduce external services or installed dependencies. Supply an admitted, reproducible environment before implementation. If the native boundary cannot contain the required external state, the Pel route is unavailable. Do not bypass isolation by moving a provider into the main checkout.

Existing legacy worktree utilities retain their own configuration and controllers. They do not configure Pel grants or transfer active legacy execution. The standard Pel workflow needs no shell fanout, consolidation, or separate report-file protocol.
