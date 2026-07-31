# REPORT — lock-primitive-hardening L3, round 2 (rework)

**Scope (unchanged):** `lib/eventlog.sh`, `lib/nats-bridge.sh`, `wt-new.sh`,
`references/durable-lanes.md`, package `design.md`.  
**Not touched:** `lib/lock.sh`, anything under `env/`, `tests/lock.bats`.  
**No git commit. No graphify.**

Cold audit of round 1: **BLOCKED** (H1, H2, H3, L1). This report records the
fixes and the live harness evidence.

## Partition note (not a defect in round-1 work)

Round 1's brief required `fm_lock_reclaim` while forbidding edits to
`lib/lock.sh`, where that function must live. The function is still absent in
this worktree's `lib/lock.sh` (sibling round). Production call sites now invoke
it **directly** (no `declare -F` gate, no local reimplementation) against the
fixed contract:

```
fm_lock_reclaim <lock_path>
  exit 0  — reclaimed; emits a record naming the lock and the dead holder
  exit 1  — refused;  emits a record naming the lock and the reason
```

The scratch harness installs a **contract-faithful double only when the real
helper is missing**, so caller wiring can be proven without inventing reclaim
inside production files. `HARNESS_USING_RECLAIM_DOUBLE=1` on this host.

---

## Fixes

### H1 — HIGH. `el_init` can delete a live holder's lock

**Was:** `fm_lock__select_mechanism` failures coerced to `mech=""`, then every
non-`flock` value ran unconditional `rmdir` on `.seq.lock` / `.attempt.lock`.

**Now:** no `rmdir` in `el_init` at all. Branching:

| Mechanism result | Action |
|---|---|
| select fails / empty | report indeterminate on stderr; leave locks untouched; no reclaim |
| `flock` | return; no reclaim, no rmdir |
| `mkdir` | call `fm_lock_reclaim` per lock; surface records |
| anything else | report unexpected; leave locks untouched |

### H2 — HIGH. Reclamation evidence and refusals discarded

**Was:** `fm_lock_reclaim … 2>/dev/null || true` at eventlog, nats-bridge, wt-new.

**Now:** capture stderr to a temp file, replay it to the caller's stderr, and
log refusals (`rc` + "lock left in place"). Never swallow. No `declare -F` gate.

### H3 — MEDIUM. Refused index lock stranded the worktree

**Was:** `git worktree add` + reports + metadata, **then** acquire; refuse left
a worktree that made retries die at "worktree path already exists".

**Now:** reclaim + `fm_lock_acquire` on `.index.lock` **before** any irreversible
operation. Refuse path never creates a worktree; a re-run can succeed.

### L1 — LOW. Design note overstated compaction defence

**Was:** claimed a unique tmp name is still used and implied a stronger
fingerprint defence than implemented.

**Now:** note states fixed staging path `events.jsonl.tmp`, that a unique tmp
does **not** fix the RMW race (M2), and that the fingerprint is belt-and-braces
under the held lock — not a substitute and not a closed check-to-rename window
if the lock were dropped.

---

## Verification

Command:

```bash
bash scratch-L3-harness.sh
# full capture: scratch-L3-harness.out
```

Harness contract: `FAILS` counter; SUMMARY exits **1** when `FAILS > 0`, **0**
only when all cases pass. Self-check proves `fail()` increments before any
real case runs. Mini proof of the exit path:

```text
FAIL: synthetic
FAILS=1
SOME_FAILED
mini_exit=1
```

Live full run: `full_harness_exit=0`, `FAILS=0`.

### 1. Indeterminate mechanism — no rmdir, nothing deleted, condition reported

```text
CMD: force_indeterminate; leftover empty lock dirs; el_init indet-run
CMD: el_init rc=0
CMD: el_init stderr/stdout:
el_init: lock mechanism indeterminate for …/runs/indet-run (select_rc=1; FM_LOCK_PROBE_UNTRUSTED); skipping reclamation (locks left untouched)
CMD: after el_init seq.lock=1 attempt.lock=1 reclaim_calls=0
  PASS: indeterminate: no rmdir, no reclaim, condition reported, locks untouched
  PASS: indeterminate: run dir not swept
```

### 2. flock path — no reclamation attempted

```text
CMD: force_flock; leftover dirs; el_init flock-run
CMD: el_init rc=0 out=[]
CMD: reclaim_calls=0
  PASS: flock path: no fm_lock_reclaim call; dirs left alone
```

### 3. mkdir + live holder — lock NOT removed; refusal on stderr

```text
CMD: force_mkdir; live-holder reclaim mode; el_init live-run
CMD: el_init rc=0
CMD: el_init output:
fm_lock_reclaim: refused …/live-run/.seq.lock reason=holder_alive pid=99999 start=stub
el_init: fm_lock_reclaim refused for …/live-run/.seq.lock (rc=1); lock left in place
fm_lock_reclaim: refused …/live-run/.attempt.lock reason=holder_alive pid=99999 start=stub
el_init: fm_lock_reclaim refused for …/live-run/.attempt.lock (rc=1); lock left in place
  PASS: live holder: locks NOT removed; refusal record visible on stderr
```

### 4. mkdir + dead holder — reclaimed; record naming lock + dead holder

```text
CMD: force_mkdir; dead-holder reclaim mode; el_init dead-run
CMD: el_init output:
fm_lock_reclaim: reclaimed …/dead-run/.seq.lock dead_holder_pid=4242 dead_holder_start=stub
fm_lock_reclaim: reclaimed …/dead-run/.attempt.lock dead_holder_pid=4242 dead_holder_start=stub
  PASS: dead holder: locks reclaimed; record naming lock+dead holder on stderr
```

### 5. Reclaim refusal — exit 1, reason surfaced, lock left alone

```text
CMD: fm_lock_reclaim rc=1 stderr:
fm_lock_reclaim: refused …/refuse-run/.seq.lock reason=liveness_undetermined
  PASS: reclaim refusal: exit 1, reason surfaced, lock left alone
CMD: el_init under refuse mode:
fm_lock_reclaim: refused … reason=liveness_undetermined
el_init: fm_lock_reclaim refused for … (rc=1); lock left in place
  PASS: el_init surfaces reclaim refusal (not swallowed to /dev/null)
  PASS: no fm_lock_reclaim ... /dev/null at call sites
```

### 6. wt-new refused index lock — index byte-identical AND retry succeeds

```text
CMD: hash_before=8d3d05caf9a5762ff61a40831c95975166a4e22d38c0d08af0a5142ab3bc466b
CMD: first wt-new.sh while lock held (should refuse BEFORE worktree create)
CMD: first wt-new rc=1
… fm_lock_reclaim: refused …/.index.lock reason=holder_or_present
… WARN: fm_lock_reclaim refused for … (rc=1); lock left in place
… ERROR: index.json lock acquisition refused for run …: FM_LOCK_TIMEOUT …
CMD: hash_after=8d3d05caf9a5762ff61a40831c95975166a4e22d38c0d08af0a5142ab3bc466b
CMD: expected_wt exists=n
  PASS: first invoke: refuse, index byte-identical, no worktree created

CMD: second wt-new.sh after lock free
CMD: second wt-new rc=0
… worktree ready: …-wt-wt-refuse-…-search
  PASS: second invoke succeeded after lock released (retry works)
CMD: fm_lock_acquire line=137 worktree add line=163
  PASS: source order: index lock acquired before worktree add
```

### 7. No inline spin-loops; separate locks; `el_emit` signature unchanged

```text
  PASS: …/eventlog.sh has no 'while ! mkdir'
  PASS: …/nats-bridge.sh has no 'while ! mkdir'
  PASS: …/wt-new.sh has no 'while ! mkdir'
  PASS: no declare -F guard on fm_lock_reclaim call sites
  PASS: el_init has no unconditional rmdir of .seq.lock/.attempt.lock
  PASS: .seq.lock and .attempt.lock remain separate paths
  PASS: el_emit signature still has optional commit (5-arg form)
  PASS: el_emit seq=1 / seq=2; el_attempt_new=1
  PASS: structural event survives el_compact
```

### 8. shellcheck clean on every modified file

```text
CMD: shellcheck -S warning -x skills/foreman/scripts/lib/eventlog.sh
CMD: shellcheck -S warning -x skills/foreman/scripts/lib/nats-bridge.sh
CMD: shellcheck -S warning -x skills/foreman/scripts/wt-new.sh
shellcheck exit codes: eventlog=0 nats=0 wt-new=0
  PASS: shellcheck clean
```

Also: `bash -n` clean on all three scripts.

### L1 design note

```text
  PASS: design.md no longer claims unique tmp is used
  PASS: design.md states fixed staging path and why unique rename is insufficient
```

---

## Harness summary (actual)

```text
FAILS=0
HARNESS_USING_RECLAIM_DOUBLE=1
ALL SCRATCH CHECKS PASSED
full_harness_exit=0
```

---

## Files touched

| Path | Change |
|---|---|
| `skills/foreman/scripts/lib/eventlog.sh` | H1+H2: safe `el_init` reclamation |
| `skills/foreman/scripts/lib/nats-bridge.sh` | H2: surface reclaim records |
| `skills/foreman/scripts/wt-new.sh` | H2+H3: reclaim+acquire before irreversible ops |
| `openspec/changes/lock-primitive-hardening/design.md` | L1: accurate compaction note |
| `skills/foreman/references/durable-lanes.md` | reclaim doctrine aligned with non-silent policy |
| `scratch-L3-harness.sh` | extended cases; fail-closed SUMMARY |
| `scratch-L3-harness.out` | full live capture |
| `REPORT.md` | this file |

`skills/foreman/scripts/lib/lock.sh` — **not modified**.

---

## Stated remaining dependency (not a fabricated pass)

`fm_lock_reclaim` is **not yet exported** by this worktree's `lib/lock.sh`.
Call sites are wired to the fixed contract and proven via a harness double.
Until the sibling lands the real helper (owner token + liveness), production
invocations will see `command not found` (rc 127) at reclaim, surface that as
a refusal/warning, and continue to `fm_lock_acquire` (which still fail-closes
on untrusted probe until L2 trust is present). That is an honest dependency on
the sibling round, not a silent reclaim.
