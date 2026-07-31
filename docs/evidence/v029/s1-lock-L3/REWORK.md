# REWORK — lock-primitive-hardening L3, round 2

Read `AGENT_TRAPS.md` IN FULL first.

Your round-1 work was audited cold by GPT-5.6 Sol: **BLOCKED**, two HIGH and
two lesser findings. The audit confirmed your scope was correct — the range
touches exactly five tracked files, does not modify `lib/lock.sh`, and does not
write `tests/lock.bats`. Keep that discipline.

You own `lib/eventlog.sh`, `lib/nats-bridge.sh`, `wt-new.sh`,
`references/durable-lanes.md` and the package `design.md`. Do NOT touch
`lib/lock.sh` or anything under `env/` — a sibling round owns those and is
running concurrently. Do NOT `git commit`. No graphify.

## A PARTITION CORRECTION YOU NEED TO KNOW ABOUT

Round 1's brief told you to use `fm_lock_reclaim` but forbade you from editing
`lib/lock.sh`, where that function has to live. **That was an error in the
brief, not in your work** — the function did not exist, so all four of your
call sites were inert.

It is now being implemented in the sibling round, against this fixed contract.
Code against it. Do **not** guard it away with `declare -F` and do **not**
re-implement it locally:

```
fm_lock_reclaim <lock_path>
  exit 0  — reclaimed; emits a record naming the lock and the dead holder
  exit 1  — refused;  emits a record naming the lock and the reason
```

It reclaims exactly the named lock, never sweeps, is safe to call while a run
is live, refuses when liveness cannot be determined, and is a no-op you must
not invoke on the `flock` path.

## H1 — HIGH, the blocker. `el_init` can delete a live holder's lock

`lib/eventlog.sh:68-82`. `fm_lock__select_mechanism` failures are coerced to
`mech=""`, and **every value other than the literal `flock`** then runs an
unconditional `rmdir` on `.seq.lock` and `.attempt.lock`.

Two consequences, both wrong:

- An **absent or untrusted verdict** becomes permission to delete. Failure to
  determine the mechanism must never authorise destroying a lock.
- On a genuinely selected `mkdir` fallback, the lock is deleted **before**
  `fm_lock_reclaim` can inspect the owner token — so the later reclaim calls
  cannot repair it, the directories are already gone, and a **live holder's
  mutex can be removed**.

**Fix:** delete the unconditional `rmdir` entirely. Reclamation happens only
through `fm_lock_reclaim`, only when the mechanism is positively determined to
be the `mkdir` fallback, and only when that call decides the holder is provably
dead. An indeterminate mechanism means: do nothing and say so.

## H2 — HIGH. Reclamation evidence and refusals are discarded

`lib/eventlog.sh:79-82`, `lib/nats-bridge.sh:89-93`, `wt-new.sh:198-201`.

Every `fm_lock_reclaim` call redirects stderr to `/dev/null` and ignores the
exit status. That suppresses **both** records the spec requires: the successful
reclamation naming the lock and the dead holder, and the refusal when liveness
is undeterminable.

**Fix:** capture stderr and surface it. A refusal (exit 1) is information the
operator needs, not noise — it means a lock is wedged and could not be safely
reclaimed. Propagate or log it; never swallow it. The spec's words are "never
reclaim silently", and a discarded record is silence.

## H3 — MEDIUM, round-introduced. A refused index lock strands the worktree

`wt-new.sh:97-175, 198-211`. Your fail-closed acquisition happens **after**
`git worktree add`, the vendor directory and report creation, and the metadata
files. When acquisition refuses you correctly leave `index.json`
byte-identical and exit 1 — but the worktree and branch already exist, so
re-running the same invocation dies at line 98 with "worktree path already
exists" and can **never** complete the missing index update without manual
repair.

Making refusal fail-closed at a point after irreversible setup converted a
recoverable failure into an unrecoverable one.

**Fix:** acquire the index lock **before** any irreversible operation, or make
the failure path clean up what it created so a retry can succeed. Prefer
acquiring first — it is simpler and it is what the lock is for. If you keep the
current ordering for a defensible reason, you must implement rollback and prove
a retry succeeds.

## L1 — LOW. The design note overstates the compaction defence

`openspec/changes/lock-primitive-hardening/design.md:221-228` claims a unique
temporary name and a stronger defence than the code implements. The formal
model states explicitly that a unique tmp name does **not** fix the compaction
race. Make the note describe what the code actually does, and keep the
statement of why renaming is insufficient so the next reader does not retry it.

## Verification — mandatory

Extend `scratch-L3-harness.sh`. **Make sure the harness exits non-zero when any
case fails** — the sibling round's harness was found printing failures while
exiting success, which is the exact defect class this release exists to remove.

Capture real output for:

1. `el_init` with an **indeterminate** mechanism: no `rmdir` occurs, nothing is
   deleted, and the condition is reported.
2. `el_init` on the `flock` path: no reclamation attempted at all.
3. `el_init` on a determined `mkdir` fallback with a **live** holder: the lock
   is NOT removed.
4. Same, with a **provably dead** holder: reclaimed, and the record naming the
   lock and dead holder is visible on stderr — not swallowed.
5. A reclaim **refusal**: exit 1, reason surfaced to the caller, lock left
   alone.
6. `wt-new.sh` with a refused index lock: `index.json` byte-identical AND a
   re-run of the same invocation either succeeds or fails cleanly — show the
   actual second invocation, not an argument that it would work.
7. Confirm zero inline `mkdir` spin-loops remain; `.seq.lock` and
   `.attempt.lock` still separate; `el_emit`'s signature unchanged.
8. `shellcheck` clean on every modified file.

Rewrite `REPORT.md` with each fix, the command, and the ACTUAL observed output.
A stated blocker is a good outcome; a fabricated pass is the failure this
release exists to eliminate.
