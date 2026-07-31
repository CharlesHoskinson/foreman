# SPEC — lock-primitive-hardening, Round L3: migrate the callers

Read `AGENT_TRAPS.md` at the worktree root IN FULL as your first action. All of
it, including section 6 on suspended vendor rounds.

Work ONLY in this worktree. Do NOT `git commit`. Do NOT run graphify. Use
`/usr/local/bin/openspec`, never `npx openspec`.

## 0. Scope

You are implementing tasks **T2, T3, T9, T10 and T11** of
`lock-primitive-hardening`. You are NOT:

- writing `lib/lock.sh` itself — round L1 owns it, it already exists, and its
  public contract is fixed. **Consume it; do not modify it.**
- writing the atomicity probe in `env/tool-check.sh` or the pinned register in
  `env/reference-manifest.toml` — round L2.
- writing `tests/lock.bats` — round L4. You may write a scratch harness.

The helper's API is `fm_lock_acquire`, `fm_lock_release`, `fm_with_lock`, and it
exposes the selected mechanism to callers. Read its header before using it.

**Important:** at the time you start, the helper's trust seam may still refuse
every acquisition (`FM_LOCK_PROBE_UNTRUSTED`) because round L2 has not landed.
That is expected and correct. Your migration must be correct *against the
contract*, and your scratch tests may stub the seam to exercise the paths. Do
not "fix" the refusal by weakening the helper.

## 1. T2 — migrate the durable core off inline mkdir spin-loops

Replace each inline spin-loop with the helper:

- `lib/eventlog.sh:76` — `.seq.lock`
- `lib/eventlog.sh:221` — `.attempt.lock`
- `lib/eventlog.sh:351` — `el_compact`, reuses `.seq.lock`
- `lib/nats-bridge.sh` — the sibling mutex

Constraints:

- `el_init`'s stale-lock reclamation at `eventlog.sh:52-57` must become
  **conditional on the fallback mechanism**. Do NOT delete it — it is still
  correct for `mkdir`, and unnecessary for `flock`, which releases on process
  death. Use the mechanism the helper exposes.
- Keep `.seq.lock` and `.attempt.lock` **separate**. The rationale at
  `eventlog.sh:195-205` still holds. Do not collapse them.
- `el_emit`'s 5-positional signature and critical-section shape are unchanged.

## 2. T3 — correct the false doctrine that caused this defect

The in-code claim *"mkdir is atomic on Git Bash and WSL"* is the reason this
survived to now. It is false on Ubuntu 26.04, which ships a hybrid coreutils
where `mkdir` is uutils and does a userspace `statx` check instead of issuing
`mkdir(2)`. Measured: 8 racers on one lock, **uutils 57 mutual-exclusion
violations / 15 rounds, GNU 0, flock 0**.

Replace it with the real contract plus a pointer to this change at:

- `lib/eventlog.sh:70`
- `lib/eventlog.sh:195-205` (same claim repeated)
- `wt-new.sh:186` (same claim repeated)
- `skills/foreman/references/durable-lanes.md` — update the locking section.
  State the **flat rule**; do NOT state a lock ordering. A stated ordering is
  standing permission to nest, and a deliberately-nesting configuration
  deadlocks at 5 steps under the formal model.

## 3. T9 — remove the fail-open path (this is a blocker in its own right)

`wt-new.sh:203` currently **proceeds unsynchronised** after a 30s timeout. The
formal model (`eventlog_concurrency.qnt`, module `index_fail_open_atomic`,
Apalache 0.56.1) violates `mutual_exclusion` at 8 steps and
`no_lost_index_entry` at 12 steps **even with an atomic primitive** — because
the defect is the *timeout policy*, not the mechanism. L1's primitive swap does
not reach this call site.

- Delete the "proceeding unsynchronized" branch. A timed-out acquisition exits
  non-zero with a named error.
- Audit **every other call site** for the same pattern. The helper's timeout
  contract must have no fail-open caller anywhere.
- The refusal must leave `index.json` **byte-identical** — assert this. The
  per-PID tmp name converts a torn write into a *silent lost update*, which is
  worse than the torn write.
- Make the index-lock timeout configurable. A caller needing longer raises the
  timeout; it never bypasses the lock.

## 4. T10 — the compaction race

`el_compact` can overwrite `events.jsonl` with a snapshot taken **before** a
concurrent `el_emit` append, silently losing a committed event from the
documented source of truth. Violated under `toctou` simulation, 5,000 x 25.

- Make compaction's snapshot and write-back a single serialized section with
  respect to appends, under the helper.
- IF the log cannot be shown unchanged between snapshot and write-back, ABANDON
  the compaction and leave `events.jsonl` alone.
- **A unique compaction tmp name does NOT fix this.** The formal model says so
  explicitly. Record in `design.md` why renaming is insufficient, so the next
  reader does not retry it.

## 5. T11 — per-lock, owner-aware reclamation

`el_init` reclaims `.seq.lock` and `.attempt.lock` but **not**
`.nats-bridge.lock` — a crash wedges it with no reclamation path. And
`worktrees/.index.lock` (`wt-new.sh:192`) survives `SIGKILL` under the `mkdir`
fallback with no reclamation task at all.

- Add `fm_lock_reclaim <lock>` usage: reclaims exactly the named lock, never a
  sweep, usable while a run is live. (If the helper does not expose this, report
  it as a blocker rather than sweeping.)
- Enumerate locks and their reclaiming process: `.seq.lock`/`.attempt.lock` at
  `el_init`; `.nats-bridge.lock` at bridge start; `worktrees/.index.lock` at
  `wt-new.sh` start.
- The owner token records the holder's PID **and its process start time**, so a
  reused PID cannot be mistaken for a live holder.
- Reclaim only when the holder is **provably dead**. If liveness cannot be
  determined, refuse and record the refusal — deleting a live holder's lock is
  worse than a wedged lock.
- Under check-then-act both racers "acquire" and both write `$lock/owner`, so
  the loser's token lands on disk: the true holder can no longer release and the
  non-holder can. Write the owner token **only from the process that actually
  won**.
- Record a reclamation event naming the lock and the dead holder. Never reclaim
  silently.
- Keep reclamation conditional on the selected mechanism; never apply it to a
  `flock` descriptor.

## 6. T13 — operational

No lane may `pkill -f` by pattern. `pkill -f "quint verify"` once matched its
own command line, killed its shell, and would have killed a sibling lane sharing
an Apalache server. Kill by recorded PID or process group.

## 7. Verification — mandatory

> **Every checker must be demonstrated to FAIL against a known-bad input before
> it is trusted. A check never observed failing is not evidence.**

In a scratch harness (not `tests/lock.bats`), capture real output showing:

1. Each migrated call site acquires through the helper — prove no inline
   `mkdir` spin-loop remains (grep and show the result).
2. `wt-new.sh` timeout now **refuses** and `index.json` is byte-identical.
   Show the hash before and after.
3. Compaction with a concurrent append: the appended event **survives**. Then
   prove the test goes red against an implementation that only renames the tmp
   file.
4. Reclamation: kill a token holder, run the owning reclaimer, assert the next
   acquisition succeeds; assert a losing racer cannot release; assert a LIVE
   holder's lock is never reclaimed; assert reclaiming one lock leaves the other
   three untouched.
5. `el_init` reclamation is skipped on the `flock` path and taken on `mkdir`.
6. `shellcheck` clean on every modified file — quote the output.

Write `REPORT.md` with each change, the command exercising it, and the ACTUAL
observed output. State plainly anything you could not satisfy. A stated blocker
is a good outcome; a fabricated pass is the failure this release exists to
eliminate.
