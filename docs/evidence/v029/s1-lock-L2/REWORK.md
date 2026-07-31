# REWORK — lock-primitive-hardening L2, round 2

Read `AGENT_TRAPS.md` IN FULL first.

Your round-1 work was audited cold by GPT-5.6 Sol: **BLOCKED**, six HIGH and six
MEDIUM. You own `skills/foreman/scripts/lib/lock.sh`, `env/tool-check.sh`,
`env/tool-check.ps1` and `env/reference-manifest.toml`. Do NOT touch
`lib/eventlog.sh`, `lib/nats-bridge.sh` or `wt-new.sh` — a sibling round owns
those. Do NOT `git commit`. No graphify.

**One thing you got right and must not lose:** the pinned register ships empty
with the reason recorded, rather than a fabricated digest. Keep that.

---

## PART A — the twelve audit findings

### F1 — HIGH, the blocker. `pinned-mechanism` trust is forged from the inventory row

`lib/lock.sh:517`. The inventory branch accepts `evidence_class ==
"pinned-mechanism"` with an `atomic` row as trusted after only the six currency
comparisons, and returns at :521. **It never checks the register.** So the
deliberately-empty register provides no protection at all — any inventory row
claiming `pinned-mechanism` is believed.

`pinned-mechanism` SHALL require, in addition to currency: the current SHA-256
matches an entry in `env/reference-manifest.toml`; that entry cites a committed
`syscall` trace artifact; the trace was taken on a Foreman-controlled host of
the **same class**; and the lock path's filesystem class is one that entry
names. With the register empty, `pinned-mechanism` must be unreachable.

### F9 — HIGH. Direct pin validation accepts a fake trace and ignores host class

The pin path accepts a trace artifact without validating it, and ignores the
host class the trace was taken on. A pin must be checkable, not asserted.

### F3 — HIGH. flock syscall evidence does not require `LOCK_EX|LOCK_NB`

The predicate accepts a `flock(2)` call without requiring the non-blocking
exclusive flags. Evidence weaker than the mechanism-relative contract licenses
nothing.

### F12 — HIGH-adjacent. flock evidence never proves the holder proceeded

The contract is: the loser received `EWOULDBLOCK` **while the holder
proceeded**. A trace showing only a refusal does not demonstrate mutual
exclusion.

### F4 — HIGH. mkdir syscall evidence is not bound to the probed lock target

The `EEXIST` observation must be bound to the directory the probe actually
contended on. An unbound `EEXIST` anywhere in a trace is not evidence about
this lock.

### F2 — HIGH. Aggregation inherits an atomic verdict across filesystem classes

Probe aggregation lets local-volume evidence cover an unknown network class. A
verdict earned on one class is NEVER inherited by another — compute coverage
per class and intersect it with the class the lock path resolves to now.

### F5 — HIGH. The Git-Bash path stays locked out even after a real pin

The opposite failure to F1, and both must be fixed together: once a genuine pin
exists, the fallback must become reachable. Round 1 made it permanently
unreachable, which is what the previous specification round was blocked for.
There must exist a state — real pinned digest, matching host class, covered
filesystem class — in which the `mkdir` fallback is selected.

### F10 — MEDIUM. Licensed `non-atomic` contention evidence is discarded

`contention` may license `non-atomic` (it just cannot license `atomic`).
Discarding it throws away a valid falsification.

### F11 — MEDIUM. Unknown probe evidence is serialized under the wrong class

### F6 — MEDIUM. An untrusted fallback refusal states no consequence or remedy

The spec requires an untrusted mechanism be "a stated platform consequence, not
a silent lockout". Name the host class, say durable lanes are unavailable on it,
and name the route back — the pinning procedure.

### F7 — MEDIUM. Process-local probe results are not cached in the process

One bounded probe per process, cached in memory. The helper never writes the
inventory record; `tool-check.sh` owns it.

### F8 — MEDIUM, and read this one carefully

**Your scratch harness prints failures and still exits success.** The evidence
you produced to prove your fixes could not itself fail. That is precisely the
defect class this entire release exists to eliminate, occurring inside the
apparatus meant to demonstrate its absence. Fix the harness to exit non-zero on
any failed case, and re-run everything through it.

---

## PART B — new scope moved into this round: `fm_lock_reclaim`

This was mis-assigned to the caller round: the function belongs in `lock.sh`,
which that round is forbidden to edit, so the callers currently invoke a
function that does not exist. **You implement it. The contract is fixed and
the caller round is coding against exactly this:**

```
fm_lock_reclaim <lock_path>
  exit 0  — reclaimed; emits a record naming the lock and the dead holder
  exit 1  — refused;  emits a record naming the lock and the reason
```

Requirements:

- Reclaims **exactly the named lock**. Never a sweep. Usable while a run is
  live, so it must not touch any other lock.
- The owner token records the holder's **PID and its process start time**, so a
  reused PID cannot be mistaken for a live holder.
- Reclaim **only when the holder is provably dead**. If liveness cannot be
  determined, REFUSE and record the refusal. Deleting a live holder's lock is
  worse than a wedged lock.
- Under check-then-act both racers can "acquire" and both write `$lock/owner`,
  so the loser's token lands on disk — the true holder can then no longer
  release and the non-holder can. Write the owner token **only from the process
  that actually won** the acquisition.
- Never applied to a `flock` descriptor — `flock` releases on process death, so
  reclamation is meaningless there. Condition on the selected mechanism.
- Emit the record on **stderr and non-silently**. Callers must be able to
  surface it. Never reclaim silently.

## Verification — mandatory

Fix F8 first, so the harness can actually fail; everything after depends on it.

Capture real output for: F1 (an inventory row claiming `pinned-mechanism`
against the empty register is REFUSED); F9 (a fake trace artifact is rejected,
and a wrong host class is rejected); F3/F12 (a flock trace lacking
`LOCK_EX|LOCK_NB`, and one showing refusal without the holder proceeding, both
license nothing); F4 (an `EEXIST` not bound to the probed target licenses
nothing); F2 (local evidence does not cover a network class); F5 (**with a
synthetic but structurally valid register entry**, the `mkdir` fallback IS
selected — this is the reachability proof, and it must not be faked into the
real register: use a temporary manifest); F6 (refusal names host class,
consequence and remedy); F7 (second acquisition in the same process does not
re-probe); F10/F11 (evidence classes serialize correctly).

Then: `fm_lock_reclaim` — reclaims a provably-dead holder; REFUSES when
liveness is undeterminable; refuses on a reused PID with a different process
start time; leaves the other three locks untouched; is never applied on the
flock path; and a losing racer never wrote the token.

Finally re-run the whole harness including L1's six codes, the ordered chain,
flat rule, and the N1/N2/N3 fixes. Report the pass/fail counts and confirm the
harness exits non-zero if any case fails.

Rewrite `REPORT.md` with each fix, the command, and the ACTUAL observed output.
A stated blocker is a good outcome; a fabricated pass is the failure this
release exists to eliminate.
