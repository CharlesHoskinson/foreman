# Spec delta — lock primitive

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Note on format: this delta uses the header shape the OpenSpec CLI actually
parses (`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`).
The repo's sixteen existing change packages use `## ADDED Requirement: <title>`
and consequently **none of them validate**. See this change's `tasks.md` T8.

## ADDED Requirements

### Requirement: one shared lock helper selects a provably atomic mechanism

The durable core SHALL acquire every lock through a single shared helper
(`skills/foreman/scripts/lib/lock.sh`) rather than through an inline `mkdir`
spin-loop.

WHERE `flock` is available on the host, the helper SHALL use `flock`.
IF `flock` is unavailable (MSYS2 / Git-Bash), THEN the helper SHALL fall back
to the `mkdir` mutex.
WHILE running on the `mkdir` fallback, the helper SHALL treat the mutex as
trustworthy only after the host's `mkdir` has passed the atomicity probe.
The helper SHALL preserve the existing release discipline: exactly one
unconditional release on every exit path from the critical section.
The helper SHALL preserve the separation of `.seq.lock` and `.attempt.lock`
documented at `eventlog.sh:195-205`, and SHALL NOT collapse them into one lock.

#### Scenario: WSL and Linux hosts take the flock path

- WHEN a lane acquires an event-log lock on a host where `command -v flock`
  succeeds
- THEN the helper acquires the lock via `flock`
- AND no `.seq.lock` or `.attempt.lock` directory is created for that
  acquisition.

#### Scenario: Git-Bash falls back to the mkdir mutex

- WHEN a lane acquires an event-log lock on MSYS2 / Git-Bash where `flock` is
  absent
- THEN the helper acquires the lock via the `mkdir` mutex
- AND the lock directory is released exactly once on every exit path.

#### Scenario: the two locks stay independent

- WHEN `el_attempt_new` holds the attempt lock for a run
- THEN `el_emit` for the same run is able to acquire the sequence lock
  concurrently
- AND neither call blocks on the other's lock.

### Requirement: a non-atomic mkdir is detected, never assumed away

The host inventory SHALL determine whether the resolved `mkdir` takes
`EEXIST` from the kernel rather than performing a userspace check-then-act.

WHEN `env/tool-check.sh` runs, it SHALL probe the resolved `mkdir` and report
its coreutils flavour and atomicity verdict as an inventory row.
IF the resolved `mkdir` fails the probe AND `flock` is available, THEN foreman
SHALL proceed on the `flock` path and record the finding as INFO rather than a
failure, because the hazard is mitigated.
IF the resolved `mkdir` fails the probe AND `flock` is unavailable, THEN
foreman SHALL report NOT-READY and SHALL refuse to start a durable lane,
citing the absence of any atomic lock primitive on the host.
The probe SHALL be deterministic and SHALL NOT depend on winning a race: it
SHALL assert that creating an existing directory issues the `mkdir(2)` syscall
and surfaces `EEXIST`, rather than sampling contention outcomes.

#### Scenario: Ubuntu 26.04 hybrid coreutils is detected and mitigated

- WHEN `tool-check.sh` runs on a host whose `mkdir` resolves to uutils
  coreutils 0.8.0 AND `flock` is present
- THEN the inventory reports the `mkdir` flavour as non-atomic
- AND the verdict is INFO with the mitigation named
- AND the host remains READY.

#### Scenario: no atomic primitive at all is a hard refusal

- WHEN a durable lane starts on a host whose `mkdir` fails the probe AND
  `flock` is unavailable
- THEN foreman refuses to start the lane
- AND the refusal names the absent atomic lock primitive as the reason
- AND no timestamped event is written to the event log for that attempt.

### Requirement: mutual exclusion is regression-tested by occupancy

The suite SHALL contain a test that measures occupancy of the critical section
under release-contention.

The test SHALL run at least eight concurrent acquirers whose losers spin and
retry, SHALL record entry to and exit from the critical section, and SHALL
assert that entries and exits strictly alternate.
IF any acquirer enters the critical section while another holds the lock,
THEN the test SHALL fail, even when the observable outcome happens to be
correct.
The existing "el_attempt_new under concurrent contention" test SHALL be
retained as a symptom test and SHALL NOT be treated as proof of mutual
exclusion.

#### Scenario: an occupancy violation fails the suite

- WHEN the mutual-exclusion test runs against a lock helper whose primitive
  permits two simultaneous holders
- THEN the test fails and names the observed overlap
- AND it does so regardless of whether the allocated ids formed a correct set.


### Requirement: no lock acquisition may fail open

No caller SHALL enter a critical section without holding the lock that protects
it.

WHEN a bounded acquisition spin expires, THEN the helper and every caller SHALL
treat the acquisition as failed, SHALL refuse the operation with a named error
and a non-zero exit, and SHALL NOT proceed unsynchronized.
Refusal SHALL be the only permitted outcome of a timed-out acquisition; a
warning followed by the unprotected operation SHALL NOT appear at any call
site.
WHERE a caller today logs contention and proceeds -- `wt-new.sh:203`, `"WARN:
index.json lock contention exceeded 30s -- proceeding unsynchronized"` -- that
call site SHALL be converted to a refusal by this change. Replacing the lock
primitive does not reach it, because the defect is the policy, not the
mechanism.
The timeout SHALL be configurable, and a caller that cannot tolerate a refusal
SHALL raise its timeout rather than be granted a fail-open path.
A refused acquisition SHALL leave the protected file byte-identical, so that a
failed acquisition can never produce a partial write or a silent lost update.

#### Scenario: a timed-out index lock refuses rather than proceeding

- WHEN `wt-new.sh` cannot acquire the `index.json` lock within its bounded spin
- THEN it exits non-zero with an error naming the lock it could not acquire
- AND `index.json` is byte-identical to its contents before the attempt
- AND no lane entry is added or removed.

#### Scenario: a lane never silently disappears from the index

- WHEN two concurrent `wt-new.sh` invocations contend for the index lock and
  one exceeds its bound
- THEN the invocation that exceeded its bound refuses
- AND every lane entry present before the contention is still present after it
- AND no lane entry is lost without an error being reported.

#### Scenario: fail-open is absent from the codebase and stays absent

- WHEN the scripts are searched for a lock acquisition whose timeout branch
  continues into the critical section
- THEN no such branch exists
- AND the suite fails if one is reintroduced.

### Requirement: compaction never discards a concurrently appended event

`el_compact` SHALL NOT replace `events.jsonl` with a snapshot that omits an
event appended after that snapshot was taken.

WHILE compaction holds the sequence lock, every append SHALL be excluded for
the duration, so that the snapshot compaction writes back is taken from the
same serialized state it replaces.
A unique per-process temporary file name SHALL NOT be treated as a fix for this
race: the hazard is a read-modify-write spanning a concurrent append, not a
collision between temporary files.
IF compaction cannot establish that the log is unchanged between snapshot and
write-back, THEN it SHALL abandon the compaction and leave `events.jsonl`
unchanged rather than write a possibly-lossy replacement.
The event log is the documented source of truth for lane completion, so losing
a committed event from it SHALL be treated as a correctness defect and SHALL
NOT be reported as a tidiness or housekeeping failure.

#### Scenario: an append during compaction is not lost

- WHEN `el_compact` takes a snapshot of `events.jsonl` and an `el_emit` append
  commits before compaction writes its replacement
- THEN the appended event is present in `events.jsonl` after compaction returns
- OR compaction abandoned its write and `events.jsonl` retains both the
  pre-existing events and the append.

#### Scenario: renaming the temp file alone does not pass the test

- WHEN the compaction race test runs against an implementation whose only
  change is a unique temporary file name
- THEN the test fails and names the lost event.

### Requirement: every foreman lock has a reclamation path

Every lock the durable core takes SHALL have a documented and implemented
reclamation path for a holder that died without releasing.

WHEN `el_init` runs, it SHALL reclaim every stale foreman lock under the run
directory, including `.nats-bridge.lock`, and SHALL NOT reclaim only
`.seq.lock` (`eventlog.sh:52`) and `.attempt.lock` (`:57`).
Reclamation SHALL remain conditional on the fallback mechanism selected by the
shared lock helper, and SHALL NOT be applied to a `flock` descriptor that the
kernel already releases on process exit.
WHERE a lock records an owner token, the token SHALL be written only by the
process that actually acquired the lock, so that the true holder can release it
and a non-holder cannot.
IF a stale lock is reclaimed, THEN the reclamation SHALL be recorded naming the
lock, rather than performed silently.

#### Scenario: a crashed NATS bridge does not wedge the lock forever

- WHEN a process holding `.nats-bridge.lock` is killed without releasing it
- AND `el_init` subsequently runs for that run directory
- THEN the stale lock is reclaimed
- AND a subsequent bridge acquisition succeeds
- AND the reclamation is recorded.

#### Scenario: the owner token belongs to the holder

- WHEN two processes contend for the NATS bridge lock and one acquires it
- THEN the owner token on disk names the acquiring process
- AND the losing process is unable to release the lock.

### Requirement: lock acquisitions are not nested, and any pairing has a fixed order

The durable core SHALL NOT hold one foreman lock while acquiring another.

`el_emit` SHALL take only `.seq.lock`; `el_attempt_new` SHALL take only
`.attempt.lock`; `el_compact` SHALL reuse `.seq.lock` and SHALL call only
read-only helpers inside it; callers SHALL invoke these sequentially and never
nested. This is the discipline today's code already follows, and this
requirement exists to keep it deliberate rather than accidental.
WHERE a future change genuinely requires both locks, it SHALL acquire
`.seq.lock` first and `.attempt.lock` second, and SHALL release them in the
reverse order.
The ordering SHALL be stated in `lib/lock.sh` and in
`references/durable-lanes.md`, because a deliberately-nesting configuration
deadlocks.

#### Scenario: nesting is rejected

- WHEN a code path holds `.seq.lock` and attempts to acquire `.attempt.lock`
  inside the same critical section
- THEN the change is rejected
- AND the documented ordering is cited as the reason.

#### Scenario: today's call graph stays flat

- WHEN the durable core's lock acquisitions are enumerated
- THEN no acquisition occurs inside another acquisition's critical section
- AND `el_compact` calls only read-only helpers while holding `.seq.lock`.

## MODIFIED Requirements

### Requirement: the append-failure test is valid under a root user

`tests/eventlog.bats` "append failure leaves a gap, never a duplicate seq"
forces a write failure with `chmod 000`. Root bypasses permission bits, so
under this repo's root WSL default user the write succeeds and the assertion
inverts.

IF the test runs while `EUID` is 0, THEN it SHALL either skip with an explicit
stated reason, or force the append failure by a means root cannot bypass.
The test SHALL NOT report a pass in any environment where the intended failure
was not actually induced.

#### Scenario: running as root does not silently invert the assertion

- WHEN the suite runs as root
- THEN the append-failure test either skips with a stated reason, or induces a
  real append failure
- AND it never passes on the strength of an append that actually succeeded.
