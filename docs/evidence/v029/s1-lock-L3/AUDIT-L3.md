# L3 Cold Audit

## VERDICT

**BLOCKED**

## Scope and evidence

Audited commit range: `94eb08d..70c8d54` on branch
`s1/lock-L3-callers`.

The range changes exactly five tracked files: the OpenSpec design note,
`durable-lanes.md`, `eventlog.sh`, `nats-bridge.sh`, and `wt-new.sh`.
It does **not** modify `skills/foreman/scripts/lib/lock.sh` or
`tests/lock.bats`, as required for the L3 caller-migration round.

`git diff --check 94eb08d..70c8d54` reports no whitespace errors.
Per the read-only constraint, I did not execute the supplied scratch harness
or Bats suites (both create files/processes); behavioral conclusions below are
independent control-flow/data-flow audit, supplemented by read-only syntax,
ShellCheck, diff, and search commands.

## Findings

### HIGH — `el_init` can delete a live or unclassifiable holder's lock

**`skills/foreman/scripts/lib/eventlog.sh:68-82`**

`fm_lock__select_mechanism` failures are coerced to `mech=""`; every value
other than literal `flock` then executes unconditional `rmdir` on
`.seq.lock` and `.attempt.lock`. Thus an absent/untrusted verdict is treated
as permission to delete, and on a selected `mkdir` fallback the lock is
deleted before `fm_lock_reclaim` can inspect an owner token. This is not
owner-aware, is not “reclaim only when provably dead,” and can remove a live
holder's mutex. The two later reclaim calls cannot repair the loss because
the directories have already been removed.

### HIGH — reclamation evidence and refusals are discarded

**`skills/foreman/scripts/lib/eventlog.sh:79-82`,
`skills/foreman/scripts/lib/nats-bridge.sh:89-93`,
`skills/foreman/scripts/wt-new.sh:198-201`,
`skills/foreman/scripts/lib/lock.sh:353-407`**

Every conditional `fm_lock_reclaim` call redirects stderr to `/dev/null` and
ignores non-zero status. That suppresses both required records: successful
reclamation naming the lock/dead holder and refusal when liveness is
undeterminable. In this checkout `lib/lock.sh` does not define
`fm_lock_reclaim` at all, and its mkdir winner returns immediately at
`:388-390` without writing a PID/process-start-time owner token. All four
named paths are therefore currently inert rather than usable; L3 correctly
did not edit that L1/L2-owned file, but these caller hooks would still erase
the required evidence after the L2 implementation is integrated.

### MEDIUM — index-lock refusal leaves an unindexed, non-retryable worktree

**`skills/foreman/scripts/wt-new.sh:97-175,198-211`**

The new fail-closed acquisition occurs only after `git worktree add`, vendor
directory/report creation, and metadata-file creation. If acquisition refuses,
the script correctly leaves `index.json` byte-identical and exits 1, but the
worktree and branch already exist. Retrying the same invocation then stops at
line 98 (`worktree path already exists`) and can never complete the missing
index update without manual repair. This is a round-introduced partial-operation
failure caused by moving refusal policy onto an acquisition placed after the
irreversible setup.

### LOW — compaction design note claims a unique tmp and stronger defense than implemented

**`openspec/changes/lock-primitive-hardening/design.md:221-228`;
`skills/foreman/scripts/lib/eventlog.sh:404,457-464`**

The added design note says compaction “still” uses a unique tmp, but the code
uses the fixed path `events.jsonl.tmp`. It also says the fingerprint would make
a future regression that drops the shared lock fail closed; the check occurs
before `mv`, leaving a check-to-rename window in which an unlocked append could
still be lost. This does not invalidate the present primary control—the shared
`.seq.lock` excludes helper-mediated appends throughout—but the stated
defense-in-depth evidence is not true.

## Passed conclusions

- **Fail-closed callers:** the five production acquisitions are
  `eventlog.sh:105,251,383`, `nats-bridge.sh:98`, and `wt-new.sh:207`.
  Each returns/exits non-zero before its protected mutation on refusal.
  The helper's exact `FM_LOCK_*` stderr is preserved at the event-log/NATS
  sites; `wt-new.sh` captures it and includes it in `die`. No helper refusal
  branch continues into a protected section.
- **Index byte identity:** `wt-new.sh:207-211` refuses before the first command
  that reads or writes `IDX` (`:225-242`). The old “proceeding unsynchronized”
  branch is absent, and `WT_INDEX_LOCK_TIMEOUT_SEC` is configurable.
- **Migration shape:** no inline `mkdir` spin-loop remains in `eventlog.sh` or
  `nats-bridge.sh`. `.seq.lock` (`eventlog.sh:93`) and `.attempt.lock`
  (`:248`) remain distinct. `el_emit` retains the same five positional values
  at `:90`, and its data critical section remains the same sequence/JSON/
  reserve/append body (`:114-157`) bracketed by helper acquire/release.
- **Compaction serialization:** `el_compact` acquires `.seq.lock` at
  `eventlog.sh:383` before snapshot/fingerprint/read and releases only at
  `:474`, after validation and rename. `el_emit` uses the same lock at `:93-105`.
  A detected pre/post fingerprint mismatch abandons at `:460-463`.
- **Doctrine:** both former eventlog claims and the `wt-new.sh` claim now name
  the historical assertion as false. `durable-lanes.md:121-134` states the
  trust rule and hard FLAT rule and explicitly states there is no ordering.
  `:150-154` records why a unique tmp does not cure the compaction RMW race.
- **Operational search:** no `pkill -f` invocation appears in the changed
  executable files (or `lib/lock.sh`). Repository-wide textual hits are
  historical/explanatory documentation, including statements banning it;
  none is introduced by `94eb08d..70c8d54`.
- **Static checks:** `bash -n` passes all three changed shell scripts.
  ShellCheck reports informational dynamic-source/filter/read-loop notices,
  but no warning-or-higher diagnostic. `git diff --check` is clean.

## Criteria

- [x] Scope exclusions (`lib/lock.sh`, `tests/lock.bats`)
- [x] Fail-closed acquisition and byte-identical refusal behavior
- [ ] Caller migration completeness — acquisition migration passes; fallback
      reclamation condition fails
- [x] Compaction serialization and unchanged-log proof
- [x] Owner-aware per-lock reclamation — **FAIL**
- [x] Lock doctrine documentation
- [x] No `pkill -f` in the changed executable scope
- [x] Round-introduced regressions — found and reported
