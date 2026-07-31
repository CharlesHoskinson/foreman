VERDICT: BLOCKED
STATUS: complete

## Findings

### HIGH — `FM_LOCK_PROBE_UNTRUSTED` is overbroad in mixed-verdict states

- File: `skills/foreman/scripts/lib/lock.sh:216`
- Evidence: the final branch emits `FM_LOCK_PROBE_UNTRUSTED` without testing
  `any_trusted_polarity == 0`. With available mechanisms `flock` and `mkdir`,
  a trusted `non-atomic` verdict for `flock` plus no verdict for `mkdir` leaves
  `all_trusted_negative=0` but `any_trusted_polarity=1`; the code nevertheless
  reaches lines 216-219 and reports `FM_LOCK_PROBE_UNTRUSTED`. A synthetic
  branch check reproduced exactly that result. The specified guard requires
  **no** trusted verdict of either polarity for any available mechanism. This
  mixed state matches neither guard 3 nor guard 4 and therefore belongs to the
  residual `FM_LOCK_UNAVAILABLE` guard. The named NO_ATOMIC-vs-PROBE ambiguity
  is therefore not fully eliminated.

### HIGH — `FM_LOCK_FS_UNSUPPORTED` tests “any unsupported” instead of “no mechanism covers this filesystem”

- File: `skills/foreman/scripts/lib/lock.sh:204`
- Evidence: `any_fs_unsup` makes guard 2 fire when even one mechanism reports
  `fs-unsupported`. If `flock` reports `fs-unsupported` while `mkdir` has a
  trusted `non-atomic` verdict for this lock path/filesystem, the filesystem is
  covered by a trusted verdict for an available mechanism, so guard 2 is false
  under the specification. The implementation reports
  `FM_LOCK_FS_UNSUPPORTED` anyway; a synthetic branch check reproduced this.
  The guard must be evaluated over coverage across all available mechanisms,
  not as an `any` flag.

### HIGH — acquisition-operation failures are misreported as timeouts, and `UNAVAILABLE` details do not reliably name errno

- File: `skills/foreman/scripts/lib/lock.sh:264`
- Evidence: every non-zero result from `flock -n` has stderr discarded and is
  treated as contention until `FM_LOCK_TIMEOUT` at line 270. The code cannot
  distinguish `EWOULDBLOCK` from `ENOLCK`, `EOPNOTSUPP`, or `EINVAL`.
  Likewise, every failure of the lock-creating `mkdir` at line 305 is treated
  as contention until timeout, including read-only and permission failures.
  Synthetic `flock` and `mkdir` operation-error checks both produced
  `FM_LOCK_TIMEOUT`. These states must be the earlier residual
  `FM_LOCK_UNAVAILABLE`, with a detail naming the failing operation and errno.
  Even pre-spin failures such as the FD-open branch at lines 254-257 emit only
  `failed`, not an errno. Thus cause 5/6 ordering and the required detail shape
  are not implemented.

### HIGH — `fm_with_lock` does not release on every exit path

- File: `skills/foreman/scripts/lib/lock.sh:452`
- Evidence: release exists only as normal fall-through at line 455; there is no
  cleanup trap around the critical section. A command that terminates the
  current shell, for example `fm_with_lock PATH -- exit 7`, exits directly from
  line 452 and never reaches `fm_lock_release`. A synthetic wrapper check exited
  with status 7 and emitted no release marker. Shell termination by a signal has
  the same missing cleanup path. This violates exactly one unconditional
  release on every exit path and can strand a trusted `mkdir` mutex.

### HIGH — re-sourcing the library erases a live outer-lock record

- File: `skills/foreman/scripts/lib/lock.sh:25`
- Evidence: sourcing the documented source-only library unconditionally resets
  `_FM_LOCK_HELD_PATH`, `_FM_LOCK_MECHANISM`, and `_FM_LOCK_FD` at lines 25-27.
  If the same process sources the library again while holding a lock, the
  underlying lock remains held but guard 1 can no longer see it; a second
  acquisition may proceed and `fm_lock_release` can no longer release the
  original `mkdir` lock or explicitly unlock/close the original flock FD.
  This both permits nesting and alters/invalidates the outer lock's ownership
  state, contrary to the flat-lock and nested-refusal requirements.

### MEDIUM — nested is not always the first evaluated refusal cause

- File: `skills/foreman/scripts/lib/lock.sh:337`
- Evidence: empty-path validation emits `FM_LOCK_UNAVAILABLE` before the
  nested check at lines 342-346. With `_FM_LOCK_HELD_PATH` set, calling
  `fm_lock_acquire ""` reproduced `FM_LOCK_UNAVAILABLE` while the nested guard
  was simultaneously true. The required ordered chain says
  `FM_LOCK_NESTED` is decided first when acquisition is requested. The analogous
  missing-command validation in `fm_with_lock` also occurs before it asks
  `fm_lock_acquire` to evaluate nesting.

## Claim-by-claim audit summary

- **(a) Ordered/disjoint causes — disagree.** The all-negative case correctly
  reaches `FM_LOCK_NO_ATOMIC_PRIMITIVE`, and the all-absent case reaches
  `FM_LOCK_PROBE_UNTRUSTED`, but mixed verdicts, filesystem coverage, and
  empty-path nesting violate the exact ordered guards.
- **(b) Fail closed — agree for the trust seam.** With the L1 seam returning no
  verdict, selection refuses with `FM_LOCK_PROBE_UNTRUSTED` before any parent,
  lock file, or lock directory operation. No environment-variable or
  mechanism-selection branch bypasses that default.
- **(c) One refusal shape/scoping — partially agree.** On the normal nested
  branch, no inner critical section runs and the recorded outer lock state is
  untouched. Normal refusals also do not touch protected data. Re-sourcing,
  however, invalidates the outer ownership record, and operation errors do not
  receive the required ordered cause/detail.
- **(d) Timeout ordering — partially agree.** Trust selection is structurally
  before both spin loops, so an untrusted mechanism cannot reach timeout.
  However, the loops make timeout reachable for mechanisms that were never
  successfully engaged because their primitive call failed.
- **(e) Release discipline — disagree.** Normal success and ordinary non-zero
  command return fall through to one release, and a losing racer does not call
  owner release. Abrupt shell exit/signal paths skip release entirely.
- **(f) No lock ordering — agree.** The file states the flat rule and explicitly
  refuses to define a lock ordering; refusal-cause ordering is not confused
  with lock ordering.
- **(g) Separation/mechanism exposure — agree.** The helper accepts the lock
  path as an argument, does not collapse `.seq.lock` and `.attempt.lock`, and
  exposes a successful selection through both stdout and
  `FM_LOCK_MECHANISM`.

## Verification notes

- Confirmed the audited range changes only
  `skills/foreman/scripts/lib/lock.sh` (457 added lines).
- Read the three in-scope requirements and the entire line-numbered helper.
- Treated `REPORT.md`, `scratch-lock-harness.sh`, and its captured output as
  claims. Their cases omit mixed verdicts, primitive-call errors, abrupt
  critical-section exit, and re-sourcing while held.
- `bash -n skills/foreman/scripts/lib/lock.sh` and `git diff --check` succeed;
  these syntax/whitespace checks do not address the semantic failures above.
- No graphify operation was run. No file other than this audit report was
  created, modified, or deleted by the auditor.
