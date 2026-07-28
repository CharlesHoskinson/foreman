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

WHERE `flock` is available on the host AND a trusted, current verdict covers
both `flock` and the filesystem class the lock path resolves to, the helper
SHALL use `flock`.
IF `flock` is unavailable (MSYS2 / Git-Bash), THEN the helper SHALL fall back
to the `mkdir` mutex, under the same trust rule and no weaker one.
WHILE running on either mechanism, the helper SHALL treat that mechanism as
trustworthy only WHILE a trusted, current verdict for the mechanism **and** for
that filesystem class is available to it, as the mechanism-trust requirement
below defines; absent that verdict the helper SHALL refuse rather than acquire.
The helper SHALL preserve the existing release discipline: exactly one
unconditional release on every exit path from the critical section.
The helper SHALL preserve the separation of `.seq.lock` and `.attempt.lock`
documented at `eventlog.sh:195-205`, and SHALL NOT collapse them into one lock.

#### Scenario: WSL and Linux hosts take the flock path

- WHEN a lane acquires an event-log lock on a host where `command -v flock`
  succeeds AND the lock path resolves to a filesystem class the trusted `flock`
  verdict covers
- THEN the helper acquires the lock via `flock`
- AND no `.seq.lock` or `.attempt.lock` directory is created for that
  acquisition.

#### Scenario: Git-Bash falls back to the mkdir mutex

- WHEN a lane acquires an event-log lock on MSYS2 / Git-Bash where `flock` is
  absent, AND the resolved `mkdir` binary's SHA-256 digest matches an entry in
  the release's pinned atomicity register, AND the lock path resolves to a
  filesystem class that entry covers
- THEN the helper acquires the lock via the `mkdir` mutex
- AND the lock directory is released exactly once on every exit path
- AND the evidence class recorded for that acquisition is `pinned-mechanism`,
  which is evidence this host can produce, rather than `syscall`, which it
  cannot.

#### Scenario: the two locks stay independent

- WHEN `el_attempt_new` holds the attempt lock for a run
- THEN `el_emit` for the same run is able to acquire the sequence lock
  concurrently
- AND neither call blocks on the other's lock.

### Requirement: a non-atomic mkdir is detected, never assumed away

The host inventory SHALL determine whether the resolved `mkdir` takes
`EEXIST` from the kernel rather than performing a userspace check-then-act.

WHEN `env/tool-check.sh` runs, it SHALL probe the resolved `mkdir` and report
its coreutils flavour, its SHA-256 digest and its atomicity verdict as an
inventory row.
IF the resolved `mkdir` fails the probe AND `flock` is available, THEN foreman
SHALL proceed on the `flock` path and record the finding as INFO rather than a
failure, because the hazard is mitigated.
IF the resolved `mkdir` fails the probe AND `flock` is unavailable, THEN
foreman SHALL report NOT-READY and SHALL refuse to start a durable lane,
citing the absence of any atomic lock primitive on the host.
The probe SHALL be deterministic and SHALL NOT depend on winning a race: it
SHALL assert that creating an existing directory issues the `mkdir(2)` syscall
and surfaces `EEXIST`, rather than sampling contention outcomes.

Evidence is asymmetric, and the probe SHALL report it as such. The evidence
classes SHALL be exactly `syscall`, `pinned-mechanism`, `contention` and
`flavour`, and each SHALL license only the verdicts it can carry:
`syscall` and `pinned-mechanism` MAY license `atomic` or `non-atomic`;
`contention` MAY license `non-atomic` only, because one observed double-entry
falsifies atomicity while a finite clean sample is bounded satisfaction and
demonstrates nothing; `flavour` MAY license no verdict at all and SHALL be
recorded as corroboration.
IF the strongest evidence class the host can produce cannot license `atomic`,
THEN the probe SHALL report `unknown` and SHALL NOT report `atomic`.

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

#### Scenario: a clean contention sample does not buy an atomic verdict

- WHEN the probe runs on a host with no tracer, observes no violation across
  its whole contention sample, and matches a version string it recognises
- THEN the reported verdict is `unknown`, with the evidence class recorded as
  `contention`
- AND the row is not reported as `atomic`, because a check-then-act `mkdir` that
  simply did not lose the race in this sample would produce the same
  observation.

### Requirement: a mechanism is selected only on a trusted, current verdict for that mechanism and that filesystem class

The shared lock helper SHALL select a locking mechanism only WHILE a trusted,
current verdict for that mechanism, and for the filesystem class the lock path
resolves to, is available to it, and SHALL refuse every acquisition otherwise.

A verdict is **trusted** only WHERE it states `atomic` on one of exactly two
evidence classes:

- `syscall` — a trace taken on this host observed **the kernel itself
  arbitrating the exclusion**, as recorded by `env/tool-check.sh` or
  `env/tool-check.ps1`. What satisfies this is **mechanism-relative**, and a
  trace SHALL be interpreted against the mechanism it was taken for:
  - for the `mkdir` mutex, the create issued to the kernel and the kernel
    returning `EEXIST` (or `ERROR_ALREADY_EXISTS`) to the loser;
  - for `flock`, the `flock(2)` call issued with `LOCK_EX|LOCK_NB` and the
    kernel returning `EWOULDBLOCK` to the loser while the holder proceeds.
  IF a trace is evaluated against a mechanism it was not taken for, THEN it
  SHALL NOT license any verdict. A definition written in one mechanism's terms
  and applied to another is not evidence — it is the failure this requirement
  exists to prevent, and it produced a refusal on every reference host when
  `flock` was measured against `EEXIST`; or
- `pinned-mechanism` — the resolved primitive is byte-identical, by SHA-256, to
  an entry in the release's pinned atomicity register in
  `env/reference-manifest.toml`; that entry cites a committed `syscall` trace
  taken on a Foreman-controlled host of the same class; and the filesystem class
  the lock path resolves to is one that entry names.

A `non-atomic` verdict, an `unknown` verdict produced by the flavour or
contention classes, an absent verdict, and a resolved primitive whose digest
matches no register entry SHALL all be treated as untrusted, and no caller SHALL
promote any of them to a trusted verdict.

The second evidence class exists because atomicity **cannot** be established on
a host that has no tracer: contention sampling can falsify atomicity but can
never demonstrate it, and MSYS2 / Git-Bash — the only host the `mkdir` fallback
exists for — has no `strace`. Requiring host-produced `syscall` evidence there
would refuse every acquisition and make the fallback unreachable. The syscall
observation is therefore made once, off-host, on a Foreman-controlled host of
that class, and committed as an artifact; the host's own obligation is reduced
to evidence it can produce — a SHA-256 digest of the resolved primitive and the
filesystem class of the lock path. This relocates the observation; it does not
weaken it, and it SHALL NOT be read as licence to accept a version string in
place of a digest.

The verdict SHALL be read from the host inventory record at
`${FOREMAN_TOOL_CHECK_JSON:-${HOME}/.foreman/last-tool-check.json}` — the file
`env/bootstrap-wsl.sh:411` already writes — and that record SHALL carry, for
each probed mechanism: the absolute resolved path of the primitive, its version
string, its SHA-256 digest, the verdict, the evidence class, the filesystem
classes the verdict covers, and a UTC timestamp.

A verdict is **current** only WHILE all of the following hold: the record names
the same absolute resolved path the helper resolves now; it names the same
version string observed now; it names the same SHA-256 digest computed now; its
covered filesystem classes include the class the lock path resolves to now; its
timestamp is not earlier than the mtime of that binary; and it is not more than
24 hours old.

The filesystem class SHALL be determined for the directory that will contain the
lock, not for the working directory and not for `FOREMAN_HOME`, and the classes
SHALL be distinguished at least as: local fixed volume; `/mnt` DrvFs or another
Windows-hosted mount; network mount, including NFS, CIFS/SMB and any
`//server/share` UNC path; and FUSE or another userspace filesystem. Only a
class the trusted verdict names SHALL be treated as covered. A verdict earned on
one class SHALL NOT be inherited by another, because advisory locking and
directory-create atomicity are properties of the filesystem as much as of the
binary.

IF the record is absent, unreadable, unparsable, older than its bound, or names
a different primitive, THEN the helper SHALL run one bounded local probe per
process before its first acquisition and SHALL hold that result in process
memory only.
IF no trusted verdict of either polarity can be obtained for any available
mechanism, THEN the helper SHALL refuse the acquisition with
`FM_LOCK_PROBE_UNTRUSTED` and a non-zero exit, and SHALL NOT acquire any lock.
IF a trusted verdict exists for every available mechanism and states
`non-atomic`, THEN the helper SHALL refuse with `FM_LOCK_NO_ATOMIC_PRIMITIVE`,
naming the absent atomic lock primitive.
IF the lock path's filesystem class is covered by no trusted verdict for any
available mechanism, THEN the helper SHALL refuse with `FM_LOCK_FS_UNSUPPORTED`,
naming the path, the detected class, and the classes that are covered.
The helper SHALL NOT write to the host inventory record; `env/tool-check.sh`
owns that file, and a second writer would make staleness undetectable.
Mechanism selection and verdict trust SHALL be resolved once, at helper
initialization, before any bounded acquisition spin begins.

#### Scenario: the fallback is refused on a host the probe already failed

- WHEN the `mkdir` fallback is forced on a host whose `mkdir` carries a trusted
  `non-atomic` verdict and where `flock` is unavailable
- THEN the helper refuses to acquire and names the absent atomic primitive as
  `FM_LOCK_NO_ATOMIC_PRIMITIVE`
- AND no lock directory is created for that acquisition
- AND the caller exits non-zero without entering the critical section.

#### Scenario: an absent or stale verdict is not an implicit pass

- WHEN the helper initializes with no readable inventory record, or with a
  record naming a different primitive path, version or digest than the one
  resolved now
- THEN the helper runs one bounded local probe rather than assuming atomicity
- AND IF that probe cannot produce a trusted `atomic` verdict on `syscall` or
  `pinned-mechanism` evidence, the helper refuses with `FM_LOCK_PROBE_UNTRUSTED`
- AND it never selects a mechanism on an unproven primitive.

#### Scenario: a trusted verdict yields exactly one acquisition and one release

- WHEN the helper selects a mechanism on a host whose current inventory record
  states `atomic` on `syscall` or `pinned-mechanism` evidence for the resolved
  primitive and covers the lock path's filesystem class
- THEN exactly one lock is created for that acquisition
- AND it is released exactly once on every exit path, including the error path
  and the path where the critical section itself fails.

#### Scenario: an available flock on an uncovered filesystem refuses rather than not locking

- WHEN `command -v flock` succeeds but the lock path resolves to a network mount
  or a `/mnt` DrvFs path that no trusted verdict covers
- THEN the helper refuses with `FM_LOCK_FS_UNSUPPORTED` before any acquisition
  is attempted
- AND it does not select `flock` and proceed on a lock that would not have
  coordinated the writers
- AND the refusal names the detected filesystem class.

#### Scenario: an unpinned Git-Bash mkdir is untrusted even though it looks right

- WHEN the helper initializes on MSYS2 / Git-Bash where `flock` is absent and
  the resolved `mkdir` reports a version string the register recognises but a
  SHA-256 digest that matches no register entry
- THEN the helper refuses with `FM_LOCK_PROBE_UNTRUSTED`
- AND the version match alone does not select the fallback, because a rebuilt,
  substituted or uutils-shimmed binary can carry a recognised version string.

### Requirement: an untrusted mechanism is a stated platform consequence, not a silent lockout

WHERE no mechanism on a host can earn a trusted, current verdict, foreman SHALL
report that durable lanes are unavailable on that host, naming the mechanism it
could not trust, the evidence it lacked, and the remedy — rather than degrading
to an unproven primitive or refusing without explanation.

The release documentation SHALL state, for each supported host class, whether
durable lanes are available and on what evidence: WSL and Linux hosts on
host-produced `syscall` evidence for `flock` **in its `flock(2)`/`EWOULDBLOCK`
form**; MSYS2 / Git-Bash hosts on
`pinned-mechanism` evidence for the `mkdir` mutex; and any host whose resolved
primitive is absent from the pinned atomicity register as unavailable until a
digest is pinned.
Pinning a digest SHALL be a documented, repeatable procedure — run the tracing
probe on a Foreman-controlled host of that class, commit the trace artifact, and
add the digest with the filesystem classes it covers to
`env/reference-manifest.toml` — so that an unavailable host has a named route
back to availability rather than a permanent exclusion.
A host that cannot run durable lanes SHALL still run every lane that takes no
foreman lock, so the consequence is scoped to the durable core rather than to
foreman as a whole, and the scope SHALL be stated wherever the unavailability is.
No release SHALL ship a host class whose only documented outcome is refusal
without that class being named in this statement, because an unreachable
scenario is a defect and a documented refusal is not.

#### Scenario: an unpinned host class is refused, and told why and how

- WHEN a durable lane starts on MSYS2 / Git-Bash whose resolved `mkdir` digest
  matches no entry in the pinned atomicity register
- THEN the helper refuses with `FM_LOCK_PROBE_UNTRUSTED`
- AND the refusal names the resolved binary, its digest, and the pinning
  procedure
- AND the release documentation already states that this host class is
  unavailable for durable lanes until a digest is pinned
- AND non-durable lanes on that host are unaffected.

#### Scenario: a pinned Git-Bash host runs durable lanes

- WHEN the same host's `mkdir` digest is present in the register with a
  committed `syscall` trace, and the lock path is on a filesystem class that
  entry covers
- THEN durable lanes start and the `mkdir` fallback is selected
- AND the platform-availability statement for that host class reads available
  on `pinned-mechanism` evidence.

### Requirement: every lock refusal has one shape and one ordered cause

WHEN the shared lock helper refuses an acquisition, THEN it SHALL refuse in one
shape regardless of cause: the refused acquisition holds no lock and enters no
critical section, a named error code is written to stderr, the exit status is
non-zero, and every file that acquisition would have protected is byte-identical
to its pre-attempt contents.

The shape is scoped to the refused acquisition, not to the process. A refusal
SHALL NOT release, invalidate or alter any lock the process already holds, and
SHALL NOT be required to leave the files of an *outer* critical section
unchanged: `FM_LOCK_NESTED` arises only while an outer lock is held, that outer
lock remains held by its owner and is released exactly once by its owner, and
the outer section's files are mid-flight by definition. Scoping the invariant to
the refused acquisition is what makes it hold for all causes at once.

The refusal causes SHALL be exactly `FM_LOCK_NESTED`, `FM_LOCK_FS_UNSUPPORTED`,
`FM_LOCK_NO_ATOMIC_PRIMITIVE`, `FM_LOCK_PROBE_UNTRUSTED`, `FM_LOCK_UNAVAILABLE`
and `FM_LOCK_TIMEOUT`, and each refusal SHALL name exactly one of them.

The causes SHALL be evaluated in exactly the order below, and the first cause
whose guard holds SHALL be the one named, so the codes are disjoint by
construction rather than by argument:

1. `FM_LOCK_NESTED` — this process already holds a foreman lock. Decided when
   the acquisition is requested.
2. `FM_LOCK_FS_UNSUPPORTED` — the lock path's filesystem class is covered by no
   trusted verdict for any available mechanism. Decided at initialization, on
   the filesystem rather than on the primitive.
3. `FM_LOCK_NO_ATOMIC_PRIMITIVE` — a trusted verdict **exists** for every
   available mechanism and every such verdict states `non-atomic`: atomicity is
   positively disproved. Decided at initialization.
4. `FM_LOCK_PROBE_UNTRUSTED` — **no** trusted verdict of either polarity exists
   for any available mechanism: atomicity is unproven rather than disproved.
   Decided at initialization.
5. `FM_LOCK_UNAVAILABLE` — a mechanism was selected and trusted, but the
   acquisition could not be attempted or could not be relied on: the lock path
   could not be created or opened, the filesystem is read-only, permission was
   denied, no file descriptor was available, or the locking call itself reported
   the operation unsupported or unimplemented (`ENOLCK`, `EOPNOTSUPP`,
   `EINVAL`). This is the **residual** cause and SHALL carry a detail string
   naming the failing operation and its errno.
6. `FM_LOCK_TIMEOUT` — a bounded spin expired on a mechanism already selected,
   trusted, and engaged at least once.

Causes 3 and 4 are mutually exclusive on their guards — one requires a trusted
verdict to be present and negative, the other requires no trusted verdict to be
present — so the state in which the local probe returns a definitive
`non-atomic` names cause 3 and only cause 3, and no implementer is left to
choose between them.
The enum SHALL be total: any refusal whose cause matches no guard in 1–4 or 6 is
cause 5, so a state such as an available but unusable `flock`, a lock path that
cannot be opened, or descriptor exhaustion has a code rather than falling
through. A refusal SHALL NOT be emitted without one of the six codes, and the
suite SHALL fail if an unnamed refusal path exists.
A timeout refusal SHALL therefore never arise on an untrusted mechanism, and a
trust refusal SHALL never arise after a spin, so the fail-open requirement and
the probe-trust requirement in this spec cannot both fire for one acquisition
and cannot prescribe different outcomes for one state.
No caller SHALL distinguish between the causes by continuing into the critical
section for any of them; a refusal is a refusal at every call site.

#### Scenario: exactly one cause is named, and trust is decided before the spin

- WHEN any acquisition is refused
- THEN the refusal names exactly one of the six codes
- AND IF the code is `FM_LOCK_TIMEOUT`, the helper had already resolved a
  trusted mechanism at initialization for that process.

#### Scenario: every caller treats every cause identically

- WHEN a caller receives any of the six refusal codes from the helper
- THEN it exits non-zero without performing the protected operation
- AND the protected file is byte-identical to its contents before the attempt.

#### Scenario: a definitive non-atomic probe names one code, not either of two

- WHEN the inventory record is absent and the helper's local probe returns a
  definitive `non-atomic` verdict on syscall evidence with no `flock` available
- THEN the refusal names `FM_LOCK_NO_ATOMIC_PRIMITIVE`
- AND it does not name `FM_LOCK_PROBE_UNTRUSTED`, because a trusted verdict was
  obtained and it was negative.

#### Scenario: an available but unusable flock is a named refusal

- WHEN `flock` is available and trusted for the lock path's filesystem class but
  the acquisition cannot be attempted — the lock file cannot be created, the
  filesystem is read-only, or the call returns `ENOLCK`
- THEN the helper refuses with `FM_LOCK_UNAVAILABLE` and a detail string naming
  the failing operation and its errno
- AND it does not select the mechanism and continue as if the lock were held.

#### Scenario: a nested refusal leaves the outer critical section alone

- WHEN a nested acquisition is refused with `FM_LOCK_NESTED`
- THEN the outer lock is still held by its owner and is released exactly once by
  its owner
- AND the refusal shape is asserted against the files the *refused* acquisition
  would have protected, not against the outer section's files.

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

### Requirement: every foreman lock has a named, owner-aware reclamation path

Every lock the durable core takes SHALL have a documented and implemented
reclamation path for a holder that died without releasing, and reclamation SHALL
be performed one named lock at a time rather than as a sweep.

The locks in scope SHALL be exactly `.seq.lock`, `.attempt.lock`,
`.nats-bridge.lock` and `worktrees/.index.lock` (`wt-new.sh:192`), and each
SHALL name the process that reclaims it.
The helper SHALL expose a single-lock operation, `fm_lock_reclaim <lock>`, that
reclaims exactly the named lock and no other, so that recovering one lock never
requires re-running global initialization while a run is live.
Reclamation SHALL be owner-aware: the owner token SHALL record the holder's PID
together with a value that distinguishes a reused PID — the holder's process
start time — and a lock SHALL be reclaimed only WHERE that holder is provably no
longer alive.
IF the holder's liveness cannot be determined, THEN reclamation SHALL be refused
and the lock left in place, because deleting a live holder's lock is a worse
outcome than a wedged lock.
Reclamation SHALL remain conditional on the mechanism selected by the shared
lock helper, and SHALL NOT be applied to a `flock` descriptor that the kernel
already releases on process exit.
WHEN `el_init` runs for a run directory, it SHALL reclaim the run-scoped locks
`.seq.lock` (`eventlog.sh:52`) and `.attempt.lock` (`:57`) under the conditions
above, and it SHALL NOT be the recovery path for `.nats-bridge.lock` or
`worktrees/.index.lock`.
WHEN the NATS bridge starts, it SHALL reclaim `.nats-bridge.lock` through
`fm_lock_reclaim`; WHEN `wt-new.sh` starts, it SHALL reclaim
`worktrees/.index.lock` through the same operation.
The owner token SHALL be written only by the process that actually acquired the
lock, so that the true holder can release it and a non-holder cannot.
IF a stale lock is reclaimed, THEN the reclamation SHALL be recorded naming the
lock and the dead holder, rather than performed silently.

#### Scenario: a crashed NATS bridge recovers without global re-initialization

- WHEN a process holding `.nats-bridge.lock` is killed without releasing it
- AND the bridge subsequently starts while the run is still live
- THEN the bridge reclaims `.nats-bridge.lock` alone through `fm_lock_reclaim`
- AND `.seq.lock`, `.attempt.lock` and `worktrees/.index.lock` are untouched
- AND the reclamation is recorded naming the lock and the dead holder.

#### Scenario: a live holder's lock is never reclaimed

- WHEN a reclamation runs against a lock whose owner token names a process that
  is still alive, or whose liveness cannot be determined
- THEN the lock is left in place and no reclamation is performed
- AND the refusal to reclaim is recorded.

#### Scenario: the worktree index lock has a reclamation path of its own

- WHEN a process holding `worktrees/.index.lock` is killed under the `mkdir`
  fallback
- AND `wt-new.sh` subsequently starts
- THEN `wt-new.sh` reclaims that lock through `fm_lock_reclaim` before its own
  acquisition
- AND the next acquisition succeeds without a wedged worktree index.

#### Scenario: the owner token belongs to the holder

- WHEN two processes contend for the NATS bridge lock and one acquires it
- THEN the owner token on disk names the acquiring process and its start time
- AND the losing process is unable to release the lock.

### Requirement: lock acquisitions are flat, and nesting is refused rather than ordered

The durable core SHALL NOT hold one foreman lock while acquiring another, and
the shared lock helper SHALL refuse a nested acquisition at runtime.

`el_emit` SHALL take only `.seq.lock`; `el_attempt_new` SHALL take only
`.attempt.lock`; `el_compact` SHALL reuse `.seq.lock` and SHALL call only
read-only helpers inside it; callers SHALL invoke these sequentially and never
nested. This is the discipline today's code already follows, and this
requirement exists to keep it deliberate rather than accidental.
WHEN a process that already holds a foreman lock requests another through the
helper, THEN the helper SHALL refuse with `FM_LOCK_NESTED` and a non-zero exit
rather than acquire it in a documented order.
This spec SHALL NOT define a lock ordering, because a stated ordering is a
standing permission to nest and the two policies cannot both be in force; a
deliberately-nesting configuration deadlocks at five steps under the formal
model, which is a reason to forbid nesting rather than to schedule it.
WHERE a future change genuinely requires two foreman locks, it SHALL amend this
requirement in its own change package, carrying its own deadlock argument and
its own ordering; it SHALL NOT be introduced by an implementer working to this
spec.
`lib/lock.sh` and `references/durable-lanes.md` SHALL state the flat rule and
SHALL NOT state an ordering.

#### Scenario: nesting is refused at runtime, not merely discouraged

- WHEN a code path holds `.seq.lock` and attempts to acquire `.attempt.lock`
  inside the same critical section
- THEN the helper refuses with `FM_LOCK_NESTED` and a non-zero exit
- AND the outer lock is still held and is released exactly once by its owner.

#### Scenario: today's call graph stays flat

- WHEN the durable core's lock acquisitions are enumerated
- THEN no acquisition occurs inside another acquisition's critical section
- AND `el_compact` calls only read-only helpers while holding `.seq.lock`
- AND neither `lib/lock.sh` nor `references/durable-lanes.md` states a lock
  ordering.

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
