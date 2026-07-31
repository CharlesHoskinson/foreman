# Lock Primitive Hardening Rework Audit

VERDICT: BLOCKED

## H1 — Guard totality and exclusivity

FIXED (original severity: HIGH).

- File: `skills/foreman/scripts/lib/lock.sh:153-245`
- Evidence: I replaced `fm_lock__available_mechanisms` and
  `fm_lock__verdict_for` after sourcing the audited helper and directly ran
  `fm_lock__select_mechanism` over the full verdict cross product. The symbols
  below are `P=atomic`, `N=non-atomic`, `F=fs-unsupported`, and `V=no-verdict`.

| available verdicts | observed outcome |
|---|---|
| one mechanism: `P` | success, selects that mechanism |
| one mechanism: `N` | `FM_LOCK_NO_ATOMIC_PRIMITIVE` |
| one mechanism: `F` | `FM_LOCK_FS_UNSUPPORTED` |
| one mechanism: `V` | `FM_LOCK_PROBE_UNTRUSTED` |
| two mechanisms: `P/P`, `P/N`, `P/F`, `P/V` | success, selects `flock` |
| two mechanisms: `N/P`, `F/P`, `V/P` | success, selects `mkdir` |
| two mechanisms: `N/N` | `FM_LOCK_NO_ATOMIC_PRIMITIVE` |
| two mechanisms: `N/F`, `N/V`, `F/N`, `V/N` | `FM_LOCK_UNAVAILABLE` residual |
| two mechanisms: `F/F`, `F/V`, `V/F` | `FM_LOCK_FS_UNSUPPORTED` |
| two mechanisms: `V/V` | `FM_LOCK_PROBE_UNTRUSTED` |
| zero mechanisms | `FM_LOCK_UNAVAILABLE` residual |

This enumerates all 4 one-mechanism states, all 16 two-mechanism states, and
the defensive zero-mechanism state. Every row returned once with exactly one
outcome. Atomic selection returns before refusal resolution; guard 2 returns
before guard 4; guards 3 and 4 cannot both hold; and every remaining state
reaches the residual at lines 242-244. In particular, the original
`N/V` trigger now emits exactly
`FM_LOCK_UNAVAILABLE no trusted-positive mechanism available (mixed verdicts)`,
not `FM_LOCK_PROBE_UNTRUSTED`. The enum is total and no runtime path reaches
two refusal-emission branches.

## H2 — Aggregate filesystem support

FIXED (original severity: HIGH).

- File: `skills/foreman/scripts/lib/lock.sh:218-244`
- Evidence: guard 2 now requires both `any_fs_unsup` and
  `any_trusted_polarity == 0`. The original trigger (`F/N`, in either
  mechanism order) was reproduced and now emits the residual
  `FM_LOCK_UNAVAILABLE`, because the trusted-negative verdict covers the
  filesystem class even though it cannot license acquisition. `F/P` selects
  the trusted-positive mechanism. The only non-atomic-selection rows that emit
  `FM_LOCK_FS_UNSUPPORTED` are `F`, `F/F`, `F/V`, and `V/F`, where no
  available mechanism has a covering trusted verdict of either polarity.

## H3 — Operation failures versus timeout

FIXED (original severity: HIGH).

- File: `skills/foreman/scripts/lib/lock.sh:256-339`,
  `skills/foreman/scripts/lib/lock.sh:350-396`
- Evidence: I injected a `flock` operation failure with non-empty stderr
  (`Function not implemented`, standing in for the specified ENOLCK /
  EOPNOTSUPP / EINVAL class). The helper returned non-zero immediately with
  `FM_LOCK_UNAVAILABLE flock -n <path>: flock: Function not implemented`.
  Injecting a failing lock-creating `mkdir` with `Read-only file system`
  likewise returned immediately with
  `FM_LOCK_UNAVAILABLE mkdir <path>: mkdir: Read-only file system`.
- Control evidence: a failing `flock -n` with empty stderr, the helper's
  contention representation, returned `FM_LOCK_TIMEOUT` at timeout zero; a
  pre-existing mkdir lock directory did the same. Thus primitive errors no
  longer spin into timeout, while an already-selected mechanism that was
  actually engaged by contention still can.

## H4 — Cleanup traps and exactly-one release

NOT FIXED — HIGH.

- File: `skills/foreman/scripts/lib/lock.sh:543-570`
- Concrete passing evidence: fresh sacrificial shells with a trusted mkdir
  selection called the instrumented release exactly once and left no lock
  directory after normal success (rc 0), ordinary command failure (rc 1),
  `exit 7` (rc 7), a nested subshell returning 7, HUP (rc 129), INT (rc 130),
  and TERM (rc 143). With acquisition refused by the empty L1 trust seam, the
  command did not run, release was called zero times, and no lock existed.
- Blocking evidence: `fm_with_lock PATH 0 -- exec bash -c "exit 23"` exited 23,
  called the instrumented release **zero** times, and left the acquired mkdir
  lock directory at `PATH`. A successful `exec` replaces the shell; it neither
  returns to line 569 nor runs Bash's EXIT trap at line 558. The once-flag
  cannot help when neither cleanup entry point executes. Thus exactly-one
  release still does not hold on every exit path, and the original stranded
  mkdir-mutex defect remains reachable.
- Independent blocking evidence for a command that itself traps: a shell
  function run as the critical-section command installed its own EXIT trap and
  then called `exit 7`. That case exited 7, ran the command's handler, called
  release zero times, and left the mkdir mutex behind. Line 558's cleanup trap
  is mutable process-global state, so the arbitrary command at line 567 can
  replace it before exiting.
- A direct shell-builtin path also bypasses cleanup:
  `fm_with_lock PATH 0 -- return 17` returned 17 to its caller with
  `_FM_LOCK_HELD_PATH=PATH` and the mkdir directory still present. Invoking
  the `return` special builtin at line 567 returns from `fm_with_lock` itself,
  so neither line 569 nor EXIT cleanup runs at that point.
- There is an acquisition-to-trap race at lines 541-558. I wrapped the real
  successful mkdir acquisition only to deliver TERM immediately after it
  returned, before `fm_with_lock` installed traps. The shell exited 143 and the
  lock directory remained. Signal cleanup therefore does not cover every
  acquired-lock state.

## H5 — Re-source state preservation

FIXED (original severity: HIGH).

- File: `skills/foreman/scripts/lib/lock.sh:35-47`
- Evidence, mkdir: after a trusted mkdir acquisition, sourcing `lock.sh` again
  preserved `_FM_LOCK_HELD_PATH`, `_FM_LOCK_MECHANISM`, and
  `FM_LOCK_MECHANISM`; the outer directory still existed. An inner acquisition
  returned exactly `FM_LOCK_NESTED`, created no inner lock, and left the outer
  directory in place. The owner release removed it; a second release was a
  no-op.
- Evidence, flock: after a trusted flock acquisition, a competing
  `flock -n PATH -c true` failed with rc 1. Re-sourcing preserved the held
  path, mechanism, and the same dynamic FD (`11` in the run); the competitor
  still failed and a nested request returned `FM_LOCK_NESTED`. After the owner
  release, the competing flock succeeded with rc 0. The re-source therefore
  no longer loses either the ownership record or the underlying live resource.

## M1 — Nested refusal precedence

FIXED (original severity: MEDIUM).

- File: `skills/foreman/scripts/lib/lock.sh:414-434`,
  `skills/foreman/scripts/lib/lock.sh:511-541`
- Evidence: with `_FM_LOCK_HELD_PATH=/outer` and the outer mechanism record set
  to `mkdir`, `fm_lock_acquire ""` returned non-zero with exactly
  `FM_LOCK_NESTED`, not the former empty-path `FM_LOCK_UNAVAILABLE`. The held
  path and mechanism remained `/outer` and `mkdir`. The wrapper's analogous
  nested-plus-missing-command state also returned exactly `FM_LOCK_NESTED` and
  preserved the outer record. With no outer lock, the same empty acquire still
  returns the residual detail
  `FM_LOCK_UNAVAILABLE fm_lock_acquire: empty lock_path`, confirming the
  validation was reordered rather than removed.

## Rework-introduced defects

### HIGH — flock acquisition destroys caller-owned file descriptor 3

- File: `skills/foreman/scripts/lib/lock.sh:289-293`
- Evidence: in a fresh shell I opened FD 3 to a marker file, wrote `before`,
  then performed a successful trusted flock acquisition. A second write to
  FD 3 failed with `Bad file descriptor` (rc 1), and the marker contained only
  `before`. The new open-error capture unconditionally uses `exec 3>&2` and
  later `exec 3>&-`; it overwrites and closes any descriptor 3 the sourcing
  process already owns. This state corruption was introduced by the H3 rework
  and occurs on the successful flock path, not just on an error path.

### HIGH — wrapper overwrites caller/command traps instead of composing or restoring them

- File: `skills/foreman/scripts/lib/lock.sh:547-570`
- Evidence: a caller EXIT trap installed before a normal `fm_with_lock`
  invocation never ran. The wrapper overwrote it at line 558 and cleared all
  four traps at line 570 rather than restoring their previous definitions.
  Conversely, the critical-section command can overwrite line 558's cleanup
  trap; the command-owned EXIT-trap/`exit 7` reproduction in H4 then stranded
  the mutex. The new process-global trap state is therefore destructive in
  both directions.

### MEDIUM — first source trusts inherited private hold state

- File: `skills/foreman/scripts/lib/lock.sh:35-44`
- Evidence: a fresh process launched with exported
  `_FM_LOCK_HELD_PATH=/not/held`, `_FM_LOCK_MECHANISM=mkdir`, and
  `FM_LOCK_MECHANISM=mkdir` sourced the library and immediately refused a
  first acquisition as `FM_LOCK_NESTED`, although it held no lock and no lock
  artifact existed. `${var:=}` distinguishes neither a legitimate re-source
  from a first source nor live ownership from inherited/stale private
  variables. H5's live-state preservation works, but the idempotent-init
  rework introduced a false-ownership state unless initialization is gated by
  a process-local sentinel or equivalent ownership validation.

## Previously-sound claims regression check

NO REGRESSION FOUND.

- Fail-closed empty L2 seam:
  `fm_with_lock <new-lock-path> 0 -- <mutating-command>` returned 1 with exactly
  `FM_LOCK_PROBE_UNTRUSTED`. The mutating command did not run, the lock path
  did not exist, the protected file remained `stable-content`, and its
  before/after SHA-256 was identically
  `ffeaa978e47553fb1351a88017ac46f866968cfa3b50576b8bd67c1cd3db9444`.
- No lock ordering stated: the full helper still states at lines 6-12 that
  nesting is refused and that it does not state or imply a lock ordering.
  Searches of the reworked file found no contrary lock-order rule; other
  occurrences of “ordering” concern refusal/trust evaluation order.
- Lock separation and mechanism exposure: under a forced trusted mkdir verdict,
  acquiring `.seq.lock` printed `mkdir`, set `FM_LOCK_MECHANISM=mkdir`, and
  created only the `.seq.lock` directory. After release, acquiring
  `.attempt.lock` created only that distinct directory. Under a forced trusted
  flock verdict, acquisition printed `flock`, set
  `FM_LOCK_MECHANISM=flock`, and produced a regular lock file rather than a
  directory. The helper remains parameterized by the caller's path and contains
  no collapse of the two names.

## Verification notes

- The audited commit range changes only
  `skills/foreman/scripts/lib/lock.sh`.
- Fresh final runs of `bash -n`, ShellCheck, and
  `git diff --check 8d47420..c81e623` all exited 0.
- The final blocker rerun again produced rc 23 with a residual mkdir lock after
  direct `exec`, and rc 1 writing to a caller-open FD 3 after successful flock
  acquisition.
- I did not run Graphify, the implementer's scratch harness, or `REPORT.md`.
  No repository file other than this audit report was intentionally modified.

## Final disposition

The rework genuinely closes H1, H2, H3, H5, and M1. It does not close H4:
direct `exec`, command-owned EXIT traps, the `return` special builtin, and the
post-acquire/pre-trap signal window can still strand a mkdir mutex. The rework
also introduces deterministic FD 3 destruction, destructive trap-state
replacement, and inherited-private-state poisoning.

What would change the verdict to APPROVED:

1. Supervise the critical-section command from a shell context it cannot
   replace or return out of, so a command that calls `exec`, invokes `return`,
   or changes its own traps still leaves a parent cleanup path that releases
   exactly once.
2. Cover the acquisition-to-cleanup-handler window while retaining an
   acquisition flag, so a signal after successful acquisition releases once
   but a refused acquisition releases zero times.
3. Preserve and restore pre-existing EXIT/HUP/INT/TERM handlers rather than
   overwriting and clearing them.
4. Capture redirect errors without taking over any fixed caller descriptor
   (in particular FD 3).
5. Gate idempotent initialization with process-local first-source state (or an
   equivalent ownership check), resetting inherited private variables on the
   first source while preserving a genuinely live record on re-source.
6. Re-run the full H4 matrix and the three introduced-defect reproductions,
   with one release and no residual lock on every acquired path, zero releases
   on refusal, preserved caller traps/descriptors, and no false nested state.

VERDICT: BLOCKED
