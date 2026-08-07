# Design: resume-supervisor-typescript

## Decision

R5D uses composed Effect services. The Node supervisor reads one run, makes a
typed decision, reserves resume budget, restores the selected checkpoint, and
queues the exact stored round.

The queue command invokes `lane-run.sh --round`. This preserves its current
ownership event, lane lock, launcher, checkpoint, gate, and report behavior.
Direct `lane-round.js` invocation is not permitted because it does not record
ownership. A full `lane-run.sh` port stays in its later work package.

## Resume budget

Export `inspectResumeAttemptBudget` from `@foreman/event-log`. It validates the
same lane history as `reserveResumeAttempt` and returns the current valid count.
The reservation implementation uses the same function. The supervisor does not
duplicate resume-history parsing.

The inspection can become stale after it returns. The later atomic reservation
is authoritative. A lost reservation race stops before restore and queue.

## Worktree restore

`WorktreeRestore.inspect` validates the canonical absolute worktree, its clean
status, and the exact checkpoint commit before budget is consumed.

`WorktreeRestore.restore` binds the permit to the reservation attempt. It
revalidates the worktree identity and clean status immediately before checkout.
It runs Git with argument arrays, disabled hooks, bounded output, and a bounded
deadline. It performs overlay checkout only. It preserves untracked extras,
`.harness`, and `FOREMAN_REPORT*` paths.

R5D does not force a dirty restore. It does not run reset, clean, or recursive
deletion. Standalone `resume.sh --force` and `--exact` remain unchanged.

## Queue execution

`QueueSubmitter.submit` returns either a queued task identifier or a ready
command vector. It never direct-spawns when pueue is unavailable.

The queued vector is:

```text
bash lane-run.sh --round GATE REPORT RUN LANE WORKTREE -- COMMAND_ARGV...
```

The executor preserves every stored argument. It does not join, split, quote,
or reconstruct `commandArgv`, `gateCommand`, or `reportPath`.

The fixed mutation order is:

1. Inspect the worktree and checkpoint.
2. Reserve one atomic resume count.
3. Restore the exact checkpoint.
4. Submit the exact round vector.

A restore or queue failure does not remove the durable reservation. The next
sweep observes the consumed budget and makes a new explicit decision.

## Supervisor

The CLI grammar is:

```text
lane-supervise.js --state-root ROOT [--dry-run] (--once RUN | --all)
```

The supervisor acquires one bounded per-run lease. It reads a bounded event
history, selects current lane attempts, and derives worktree ownership only from
typed ownership events. It does not infer a worktree from a report path.

The supervisor uses `observeResumeSafety` and `decideRoundResume`. `Wait`,
`Completed`, `NoRound`, invalid history, legacy history, and exhausted budget
cause no mutation. Dry-run causes no reservation, restore, or queue call.

Unknown process or lock state remains a fail-safe wait. A stale lane lock can
therefore prevent automatic resume. R5D does not reclaim that lock.

## Runtime boundary

Build `skills/foreman/runtime/dist/lane-supervise.js` deterministically. Add it
to the runtime manifest and verification suite.

Replace `skills/foreman/scripts/lane-supervise.sh` with an adapter that resolves
Node.js, the runtime bundle, and the state root. The adapter then uses `exec`.

## Alternatives rejected

Direct `lane-round.js` execution is smaller but loses ownership and lane-lock
behavior. It is unsafe for later supervision.

A complete `lane-run.sh` port removes more shell but combines supervision,
launcher ownership, transcript capture, secrets, signals, gates, and cleanup.
That scope belongs to a later sprint.

