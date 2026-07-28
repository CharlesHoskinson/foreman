// Foreman event-log concurrency model (Quint 0.32.0).
//
// Select a configuration with:
//   --main=toctou       uutils-style check-then-act mkdir
//   --main=atomic       GNU mkdir(2)/flock-style atomic test-and-set
//   --main=nested_atomic deliberately enables opposite-order lock nesting
//   --main=index_fail_open_atomic atomic mkdir plus wt-new fail-open timeout
//   --main=nats_atomic  two-step NATS ownership with atomic mkdir
//   --main=nats_toctou  two-step NATS ownership with check-then-act mkdir
//
// The base module is parameterized so the transition system is identical
// across configurations except for the lock primitive and nesting experiment.
module locking {
  const ATOMIC_LOCK: bool
  const ALLOW_NESTING: bool
  const FAIL_OPEN_INDEX: bool
  const ENABLE_NATS: bool

  type Phase =
    | Idle
    | WantSeq
    | WantAttempt
    | WantCompact
    | WantNestSeq
    | WantNestAttempt
    | CheckedSeq
    | CheckedCompact
    | InSeq
    | InCompact
    | SeqRead
    | SeqBuilt
    | SeqTmpWritten
    | SeqReserved
    | SeqAppended
    | SeqJqFailed
    | SeqAppendFailed
    | SeqRenameFailed
    | CheckedAttempt
    | InAttempt
    | AttemptRead
    | AttemptTmpWritten
    | AttemptReserved
    | AttemptRenameFailed
    | CompactRead
    | CompactTransformed
    | CompactValidated
    | CompactRenamed
    | CompactFailed
    | NeedAttempt
    | NeedSeq
    | BothHeld
    | WantIndex
    | InIndex
    | IndexRead
    | IndexTmpWritten
    | IndexRenamed
    | WantNats
    | CheckedNats
    | NatsTaken
    | NatsOwned
    | NatsCrashed
    | TimedOut
    | Done

  type ModelState = {
    phase: int -> Phase,
    seqLocal: int -> int,
    attemptLocal: int -> int,
    seqRetries: int -> int,
    attemptRetries: int -> int,
    seqLockExists: bool,
    attemptLockExists: bool,
    seqHolders: Set[int],
    attemptHolders: Set[int],
    seqDisk: int,
    attemptDisk: int,
    seqTmpPresent: bool,
    seqTmpValue: int,
    seqTmpWriter: int,
    attemptTmpPresent: bool,
    attemptTmpValue: int,
    attemptTmpWriter: int,
    eventLog: Set[(int, int)],
    everAppended: Set[(int, int)],
    attemptCompleted: Set[(int, int)],
    renameFailures: Set[(int, int)],
    compactSnapshot: int -> Set[(int, int)],
    acquiredAfterSpin: bool,
    indexRetries: int -> int,
    indexLockExists: bool,
    indexOwnsLock: int -> bool,
    indexHolders: Set[int],
    indexLocal: int -> Set[int],
    indexDisk: Set[int],
    indexCommitted: Set[int],
    natsLockExists: bool,
    natsTakers: Set[int],
    natsTrueHolder: int,
    natsOwnerDisk: int,
    natsMemToken: int -> int,
    natsWaited: int -> bool,
    natsReleaseDenied: Set[int],
    natsUnauthorizedReleases: Set[int],
    vendorRunning: int -> int,
    gateRunning: int
  }

  var s: ModelState

  val PROCS: Set[int] = Set(0, 1)
  val GROUPS: Set[int] = Set(0, 1, 2, 3)
  val MAX_RETRIES: int = 2

  // eventlog.sh:45-58: el_init is single-threaded and removes both leftovers.
  action init = s' = {
    phase: Map(0 -> Idle, 1 -> Idle),
    seqLocal: Map(0 -> 0, 1 -> 0),
    attemptLocal: Map(0 -> 0, 1 -> 0),
    seqRetries: Map(0 -> 0, 1 -> 0),
    attemptRetries: Map(0 -> 0, 1 -> 0),
    seqLockExists: false,
    attemptLockExists: false,
    seqHolders: Set(),
    attemptHolders: Set(),
    seqDisk: 0,
    attemptDisk: 0,
    seqTmpPresent: false,
    seqTmpValue: 0,
    seqTmpWriter: -1,
    attemptTmpPresent: false,
    attemptTmpValue: 0,
    attemptTmpWriter: -1,
    eventLog: Set(),
    everAppended: Set(),
    attemptCompleted: Set(),
    renameFailures: Set(),
    compactSnapshot: Map(0 -> Set(), 1 -> Set()),
    acquiredAfterSpin: false,
    indexRetries: Map(0 -> 0, 1 -> 0),
    indexLockExists: false,
    indexOwnsLock: Map(0 -> false, 1 -> false),
    indexHolders: Set(),
    indexLocal: Map(0 -> Set(), 1 -> Set()),
    indexDisk: Set(),
    indexCommitted: Set(),
    natsLockExists: false,
    natsTakers: Set(),
    natsTrueHolder: -1,
    natsOwnerDisk: -1,
    natsMemToken: Map(0 -> -1, 1 -> -1),
    natsWaited: Map(0 -> false, 1 -> false),
    natsReleaseDenied: Set(),
    natsUnauthorizedReleases: Set(),
    vendorRunning: Map(0 -> 0, 1 -> 0, 2 -> 0, 3 -> 0),
    gateRunning: 0,
  }

  def vendorCap(group: int): int =
    if (group == 0) 3       // grok
    else if (group == 1) 2  // codex
    else if (group == 2) 3  // claude
    else 2                  // misc

  // A process chooses one call. This nondeterminism covers emit/attempt/
  // compact combinations without predetermining which operation races.
  action choose_emit(p: int): bool = all {
    PROCS.contains(p),
    s.phase.get(p) == Idle,
    s' = s.with("phase", s.phase.set(p, WantSeq)),
  }

  action choose_attempt(p: int): bool = all {
    PROCS.contains(p),
    s.phase.get(p) == Idle,
    s' = s.with("phase", s.phase.set(p, WantAttempt)),
  }

  action choose_compact(p: int): bool = all {
    PROCS.contains(p),
    s.phase.get(p) == Idle,
    s' = s.with("phase", s.phase.set(p, WantCompact)),
  }

  action choose_nest_seq_first(p: int): bool = all {
    ALLOW_NESTING,
    PROCS.contains(p),
    s.phase.get(p) == Idle,
    s' = s.with("phase", s.phase.set(p, WantNestSeq)),
  }

  action choose_nest_attempt_first(p: int): bool = all {
    ALLOW_NESTING,
    PROCS.contains(p),
    s.phase.get(p) == Idle,
    s' = s.with("phase", s.phase.set(p, WantNestAttempt)),
  }

  // eventlog.sh:75-79 and 350-354. Atomic mode combines observe-free and
  // ownership in this action, matching GNU mkdir(2)/flock test-and-set.
  action atomic_take_seq(p: int): bool = all {
    ATOMIC_LOCK,
    s.phase.get(p) == WantSeq,
    not(s.seqLockExists),
    s' = s
      .with("phase", s.phase.set(p, InSeq))
      .with("seqLockExists", true)
      .with("seqHolders", s.seqHolders.union(Set(p)))
      .with("acquiredAfterSpin",
        s.acquiredAfterSpin or s.seqRetries.get(p) > 0),
  }

  action atomic_take_compact(p: int): bool = all {
    ATOMIC_LOCK,
    s.phase.get(p) == WantCompact,
    not(s.seqLockExists),
    s' = s
      .with("phase", s.phase.set(p, InCompact))
      .with("seqLockExists", true)
      .with("seqHolders", s.seqHolders.union(Set(p)))
      .with("acquiredAfterSpin",
        s.acquiredAfterSpin or s.seqRetries.get(p) > 0),
  }

  // F-uutils-mkdir-blocker.md:35-49. In TOCTOU mode `statx` observes absence
  // here. The later create action deliberately does NOT recheck existence.
  action toctou_check_seq(p: int): bool = all {
    not(ATOMIC_LOCK),
    s.phase.get(p) == WantSeq,
    not(s.seqLockExists),
    s' = s.with("phase", s.phase.set(p, CheckedSeq)),
  }

  action toctou_check_compact(p: int): bool = all {
    not(ATOMIC_LOCK),
    s.phase.get(p) == WantCompact,
    not(s.seqLockExists),
    s' = s.with("phase", s.phase.set(p, CheckedCompact)),
  }

  action toctou_create_seq(p: int): bool = all {
    not(ATOMIC_LOCK),
    s.phase.get(p) == CheckedSeq,
    s' = s
      .with("phase", s.phase.set(p, InSeq))
      .with("seqLockExists", true)
      .with("seqHolders", s.seqHolders.union(Set(p)))
      .with("acquiredAfterSpin",
        s.acquiredAfterSpin or s.seqRetries.get(p) > 0),
  }

  action toctou_create_compact(p: int): bool = all {
    not(ATOMIC_LOCK),
    s.phase.get(p) == CheckedCompact,
    s' = s
      .with("phase", s.phase.set(p, InCompact))
      .with("seqLockExists", true)
      .with("seqHolders", s.seqHolders.union(Set(p)))
      .with("acquiredAfterSpin",
        s.acquiredAfterSpin or s.seqRetries.get(p) > 0),
  }

  // The failed-acquire loser returns to the same spin state and retries.
  // MAX_RETRIES=2 abstracts eventlog.sh's 1500-try bound.
  action spin_seq(p: int): bool = all {
    Set(WantSeq, WantCompact).contains(s.phase.get(p)),
    s.seqLockExists,
    s.seqRetries.get(p) < MAX_RETRIES,
    s' = s.with("seqRetries",
      s.seqRetries.set(p, s.seqRetries.get(p) + 1)),
  }

  action timeout_seq(p: int): bool = all {
    Set(WantSeq, WantCompact).contains(s.phase.get(p)),
    s.seqLockExists,
    s.seqRetries.get(p) == MAX_RETRIES,
    s' = s.with("phase", s.phase.set(p, TimedOut)),
  }

  // eventlog.sh:220-224. `.attempt.lock` is a distinct sibling mutex.
  action atomic_take_attempt(p: int): bool = all {
    ATOMIC_LOCK,
    s.phase.get(p) == WantAttempt,
    not(s.attemptLockExists),
    s' = s
      .with("phase", s.phase.set(p, InAttempt))
      .with("attemptLockExists", true)
      .with("attemptHolders", s.attemptHolders.union(Set(p)))
      .with("acquiredAfterSpin",
        s.acquiredAfterSpin or s.attemptRetries.get(p) > 0),
  }

  action toctou_check_attempt(p: int): bool = all {
    not(ATOMIC_LOCK),
    s.phase.get(p) == WantAttempt,
    not(s.attemptLockExists),
    s' = s.with("phase", s.phase.set(p, CheckedAttempt)),
  }

  action toctou_create_attempt(p: int): bool = all {
    not(ATOMIC_LOCK),
    s.phase.get(p) == CheckedAttempt,
    s' = s
      .with("phase", s.phase.set(p, InAttempt))
      .with("attemptLockExists", true)
      .with("attemptHolders", s.attemptHolders.union(Set(p)))
      .with("acquiredAfterSpin",
        s.acquiredAfterSpin or s.attemptRetries.get(p) > 0),
  }

  action spin_attempt(p: int): bool = all {
    s.phase.get(p) == WantAttempt,
    s.attemptLockExists,
    s.attemptRetries.get(p) < MAX_RETRIES,
    s' = s.with("attemptRetries",
      s.attemptRetries.set(p, s.attemptRetries.get(p) + 1)),
  }

  action timeout_attempt(p: int): bool = all {
    s.phase.get(p) == WantAttempt,
    s.attemptLockExists,
    s.attemptRetries.get(p) == MAX_RETRIES,
    s' = s.with("phase", s.phase.set(p, TimedOut)),
  }

  // A timed-out shell call returns to its caller; model that return explicitly
  // so `process_productive` denotes an actually enabled state-changing action.
  action finish_timeout(p: int): bool = all {
    s.phase.get(p) == TimedOut,
    s' = s.with("phase", s.phase.set(p, Done)),
  }

  // eventlog.sh:80-128. The action boundary after read makes stale equal
  // candidates possible only when the lock primitive admitted two holders.
  action seq_read(p: int): bool = all {
    s.phase.get(p) == InSeq,
    s' = s
      .with("phase", s.phase.set(p, SeqRead))
      .with("seqLocal", s.seqLocal.set(p, s.seqDisk + 1)),
  }

  // jq succeeds before any reservation. Its failure path makes no gap.
  action seq_build_json(p: int): bool = all {
    s.phase.get(p) == SeqRead,
    s' = s.with("phase", s.phase.set(p, SeqBuilt)),
  }

  action seq_jq_failure(p: int): bool = all {
    s.phase.get(p) == SeqRead,
    s' = s.with("phase", s.phase.set(p, SeqJqFailed)),
  }

  // eventlog.sh:118-124. `.seq.tmp` is one shared pathname. A second writer
  // can clobber its value/writer before either process performs mv.
  action seq_write_tmp(p: int): bool = all {
    s.phase.get(p) == SeqBuilt,
    s' = s
      .with("phase", s.phase.set(p, SeqTmpWritten))
      .with("seqTmpPresent", true)
      .with("seqTmpValue", s.seqLocal.get(p))
      .with("seqTmpWriter", p),
  }

  action seq_rename_tmp(p: int): bool = all {
    s.phase.get(p) == SeqTmpWritten,
    s.seqTmpPresent,
    s' = s
      .with("phase", s.phase.set(p, SeqReserved))
      .with("seqDisk", s.seqTmpValue)
      .with("seqTmpPresent", false)
      .with("seqTmpWriter", -1),
  }

  // This is the formal counterpart of `mv: cannot stat ...tmp`: another
  // holder has already consumed the single shared temp pathname.
  action seq_rename_missing(p: int): bool = all {
    s.phase.get(p) == SeqTmpWritten,
    not(s.seqTmpPresent),
    s' = s
      .with("phase", s.phase.set(p, SeqRenameFailed))
      .with("renameFailures", s.renameFailures.union(Set((p, 0)))),
  }

  action seq_append(p: int): bool = all {
    s.phase.get(p) == SeqReserved,
    s' = s
      .with("phase", s.phase.set(p, SeqAppended))
      .with("eventLog",
        s.eventLog.union(Set((p, s.seqLocal.get(p)))))
      .with("everAppended",
        s.everAppended.union(Set((p, s.seqLocal.get(p))))),
  }

  // Append failure occurs after durable reserve: it leaves a gap, not a dup.
  action seq_append_failure(p: int): bool = all {
    s.phase.get(p) == SeqReserved,
    s' = s.with("phase", s.phase.set(p, SeqAppendFailed)),
  }

  // eventlog.sh:129: a bare unconditional rmdir, with no ownership token.
  action release_seq(p: int): bool = all {
    Set(SeqAppended, SeqJqFailed, SeqAppendFailed, SeqRenameFailed)
      .contains(s.phase.get(p)),
    s' = s
      .with("phase", s.phase.set(p, Done))
      .with("seqHolders", s.seqHolders.exclude(Set(p)))
      .with("seqLockExists", false),
  }

  // eventlog.sh:227-239. Attempt allocation uses the same read/write/mv
  // structure but a different lock and a per-lane counter (one lane modeled).
  action attempt_read(p: int): bool = all {
    s.phase.get(p) == InAttempt,
    s' = s
      .with("phase", s.phase.set(p, AttemptRead))
      .with("attemptLocal",
        s.attemptLocal.set(p, s.attemptDisk + 1)),
  }

  action attempt_write_tmp(p: int): bool = all {
    s.phase.get(p) == AttemptRead,
    s' = s
      .with("phase", s.phase.set(p, AttemptTmpWritten))
      .with("attemptTmpPresent", true)
      .with("attemptTmpValue", s.attemptLocal.get(p))
      .with("attemptTmpWriter", p),
  }

  action attempt_rename_tmp(p: int): bool = all {
    s.phase.get(p) == AttemptTmpWritten,
    s.attemptTmpPresent,
    s' = s
      .with("phase", s.phase.set(p, AttemptReserved))
      .with("attemptDisk", s.attemptTmpValue)
      .with("attemptTmpPresent", false)
      .with("attemptTmpWriter", -1),
  }

  action attempt_rename_missing(p: int): bool = all {
    s.phase.get(p) == AttemptTmpWritten,
    not(s.attemptTmpPresent),
    s' = s
      .with("phase", s.phase.set(p, AttemptRenameFailed))
      .with("renameFailures", s.renameFailures.union(Set((p, 1)))),
  }

  // eventlog.sh:239-241: success becomes externally completed at return.
  action release_attempt(p: int): bool = all {
    s.phase.get(p) == AttemptReserved,
    s' = s
      .with("phase", s.phase.set(p, Done))
      .with("attemptHolders", s.attemptHolders.exclude(Set(p)))
      .with("attemptLockExists", false)
      .with("attemptCompleted",
        s.attemptCompleted.union(Set((p, s.attemptLocal.get(p))))),
  }

  action release_failed_attempt(p: int): bool = all {
    s.phase.get(p) == AttemptRenameFailed,
    s' = s
      .with("phase", s.phase.set(p, Done))
      .with("attemptHolders", s.attemptHolders.exclude(Set(p)))
      .with("attemptLockExists", false),
  }

  // eventlog.sh:298-313,356-425. The snapshot is taken while holding the
  // SAME seq lock as emit. All modeled emits are structural/non-collapsible;
  // therefore a successful compaction must retain them byte-for-byte.
  action compact_read(p: int): bool = all {
    s.phase.get(p) == InCompact,
    s' = s
      .with("phase", s.phase.set(p, CompactRead))
      .with("compactSnapshot",
        s.compactSnapshot.set(p, s.eventLog)),
  }

  action compact_transform(p: int): bool = all {
    s.phase.get(p) == CompactRead,
    s' = s.with("phase", s.phase.set(p, CompactTransformed)),
  }

  action compact_validate(p: int): bool = all {
    s.phase.get(p) == CompactTransformed,
    s' = s.with("phase", s.phase.set(p, CompactValidated)),
  }

  action compact_rename(p: int): bool = all {
    s.phase.get(p) == CompactValidated,
    s' = s
      .with("phase", s.phase.set(p, CompactRenamed))
      .with("eventLog", s.compactSnapshot.get(p)),
  }

  // Any read/transform/validation/mv failure preserves the original log.
  action compact_failure(p: int): bool = all {
    Set(CompactRead, CompactTransformed, CompactValidated)
      .contains(s.phase.get(p)),
    s' = s.with("phase", s.phase.set(p, CompactFailed)),
  }

  action release_compact(p: int): bool = all {
    Set(CompactRenamed, CompactFailed).contains(s.phase.get(p)),
    s' = s
      .with("phase", s.phase.set(p, Done))
      .with("seqHolders", s.seqHolders.exclude(Set(p)))
      .with("seqLockExists", false),
  }

  // Deliberate future-code experiment. Current eventlog.sh has no path that
  // nests these locks. Opposite-order holders can reach a circular wait.
  action nested_take_seq_first(p: int): bool = all {
    ALLOW_NESTING,
    s.phase.get(p) == WantNestSeq,
    not(s.seqLockExists),
    s' = s
      .with("phase", s.phase.set(p, NeedAttempt))
      .with("seqLockExists", true)
      .with("seqHolders", s.seqHolders.union(Set(p))),
  }

  action nested_take_attempt_first(p: int): bool = all {
    ALLOW_NESTING,
    s.phase.get(p) == WantNestAttempt,
    not(s.attemptLockExists),
    s' = s
      .with("phase", s.phase.set(p, NeedSeq))
      .with("attemptLockExists", true)
      .with("attemptHolders", s.attemptHolders.union(Set(p))),
  }

  action nested_take_attempt_second(p: int): bool = all {
    s.phase.get(p) == NeedAttempt,
    not(s.attemptLockExists),
    s' = s
      .with("phase", s.phase.set(p, BothHeld))
      .with("attemptLockExists", true)
      .with("attemptHolders", s.attemptHolders.union(Set(p))),
  }

  action nested_take_seq_second(p: int): bool = all {
    s.phase.get(p) == NeedSeq,
    not(s.seqLockExists),
    s' = s
      .with("phase", s.phase.set(p, BothHeld))
      .with("seqLockExists", true)
      .with("seqHolders", s.seqHolders.union(Set(p))),
  }

  action nested_release_both(p: int): bool = all {
    s.phase.get(p) == BothHeld,
    s' = s
      .with("phase", s.phase.set(p, Done))
      .with("seqLockExists", false)
      .with("attemptLockExists", false)
      .with("seqHolders", s.seqHolders.exclude(Set(p)))
      .with("attemptHolders", s.attemptHolders.exclude(Set(p))),
  }

  // wt-new.sh:191-251. The lock-taking writer and a timed-out writer execute
  // the same read/modify/unique-temp/rename critical section. Only the former
  // owns the directory and may remove it in the EXIT trap.
  action choose_index(p: int): bool = all {
    FAIL_OPEN_INDEX,
    PROCS.contains(p),
    s.phase.get(p) == Idle,
    s' = s.with("phase", s.phase.set(p, WantIndex)),
  }

  action atomic_take_index(p: int): bool = all {
    FAIL_OPEN_INDEX,
    s.phase.get(p) == WantIndex,
    not(s.indexLockExists),
    s' = s
      .with("phase", s.phase.set(p, InIndex))
      .with("indexLockExists", true)
      .with("indexOwnsLock", s.indexOwnsLock.set(p, true))
      .with("indexHolders", s.indexHolders.union(Set(p)))
      .with("acquiredAfterSpin",
        s.acquiredAfterSpin or s.indexRetries.get(p) > 0),
  }

  action spin_index(p: int): bool = all {
    FAIL_OPEN_INDEX,
    s.phase.get(p) == WantIndex,
    s.indexLockExists,
    s.indexRetries.get(p) < MAX_RETRIES,
    s' = s.with("indexRetries",
      s.indexRetries.set(p, s.indexRetries.get(p) + 1)),
  }

  // Unlike eventlog.sh's timeout actions, wt-new.sh proceeds into the critical
  // section without ownership after its bounded wait is exhausted.
  action timeout_index_fail_open(p: int): bool = all {
    FAIL_OPEN_INDEX,
    s.phase.get(p) == WantIndex,
    s.indexLockExists,
    s.indexRetries.get(p) == MAX_RETRIES,
    s' = s
      .with("phase", s.phase.set(p, InIndex))
      .with("indexHolders", s.indexHolders.union(Set(p))),
  }

  action index_read(p: int): bool = all {
    s.phase.get(p) == InIndex,
    s' = s
      .with("phase", s.phase.set(p, IndexRead))
      .with("indexLocal", s.indexLocal.set(p, s.indexDisk.union(Set(p)))),
  }

  // `$IDX.tmp.$$` is represented by the process-local snapshot: one writer
  // cannot consume another writer's temp path.
  action index_write_unique_tmp(p: int): bool = all {
    s.phase.get(p) == IndexRead,
    s' = s.with("phase", s.phase.set(p, IndexTmpWritten)),
  }

  action index_rename_unique_tmp(p: int): bool = all {
    s.phase.get(p) == IndexTmpWritten,
    s' = s
      .with("phase", s.phase.set(p, IndexRenamed))
      .with("indexDisk", s.indexLocal.get(p))
      .with("indexCommitted", s.indexCommitted.union(Set(p))),
  }

  action release_index(p: int): bool = all {
    s.phase.get(p) == IndexRenamed,
    s' = s
      .with("phase", s.phase.set(p, Done))
      .with("indexLockExists",
        if (s.indexOwnsLock.get(p)) false else s.indexLockExists)
      .with("indexOwnsLock", s.indexOwnsLock.set(p, false))
      .with("indexHolders", s.indexHolders.exclude(Set(p))),
  }

  // nats-bridge.sh:140-193. Directory creation and durable owner recording
  // are deliberately separate actions, leaving the real crash/interleaving
  // point visible.
  action choose_nats(p: int): bool = all {
    ENABLE_NATS,
    PROCS.contains(p),
    s.phase.get(p) == Idle,
    s' = s.with("phase", s.phase.set(p, WantNats)),
  }

  action atomic_take_nats(p: int): bool = all {
    ENABLE_NATS,
    ATOMIC_LOCK,
    s.phase.get(p) == WantNats,
    not(s.natsLockExists),
    s' = s
      .with("phase", s.phase.set(p, NatsTaken))
      .with("natsLockExists", true)
      .with("natsTakers", s.natsTakers.union(Set(p)))
      .with("natsTrueHolder", p)
      .with("acquiredAfterSpin",
        s.acquiredAfterSpin or s.natsWaited.get(p)),
  }

  action toctou_check_nats(p: int): bool = all {
    ENABLE_NATS,
    not(ATOMIC_LOCK),
    s.phase.get(p) == WantNats,
    not(s.natsLockExists),
    s' = s.with("phase", s.phase.set(p, CheckedNats)),
  }

  // The first create establishes the real directory holder. A second process
  // whose earlier check also observed absence still returns as an apparent
  // acquirer, without replacing that true holder.
  action toctou_create_nats(p: int): bool = all {
    ENABLE_NATS,
    not(ATOMIC_LOCK),
    s.phase.get(p) == CheckedNats,
    s' = s
      .with("phase", s.phase.set(p, NatsTaken))
      .with("natsTrueHolder",
        if (s.natsLockExists) s.natsTrueHolder else p)
      .with("natsLockExists", true)
      .with("natsTakers", s.natsTakers.union(Set(p)))
      .with("acquiredAfterSpin",
        s.acquiredAfterSpin or s.natsWaited.get(p)),
  }

  // `nb_bridge_once` returns 5 on a busy lock; this state change records a
  // contender that the loop may retry after the current holder releases.
  action nats_observe_busy(p: int): bool = all {
    ENABLE_NATS,
    s.phase.get(p) == WantNats,
    s.natsLockExists,
    not(s.natsWaited.get(p)),
    s' = s.with("natsWaited", s.natsWaited.set(p, true)),
  }

  action nats_record_owner(p: int): bool = all {
    s.phase.get(p) == NatsTaken,
    s' = s
      .with("phase", s.phase.set(p, NatsOwned))
      .with("natsMemToken", s.natsMemToken.set(p, p + 1))
      .with("natsOwnerDisk", p + 1),
  }

  // A hard crash is not a catchable TERM. Before owner recording it leaves a
  // directory with neither an on-disk token nor a live process able to prove
  // ownership to `_nb_lock_release`.
  action nats_crash_before_owner(p: int): bool = all {
    s.phase.get(p) == NatsTaken,
    s' = s
      .with("phase", s.phase.set(p, NatsCrashed))
      .with("natsTakers", s.natsTakers.exclude(Set(p))),
  }

  // Token mismatch makes `_nb_lock_release` a silent no-op.
  action nats_release_denied(p: int): bool = all {
    s.phase.get(p) == NatsOwned,
    s.natsOwnerDisk != s.natsMemToken.get(p),
    s' = s
      .with("phase", s.phase.set(p, Done))
      .with("natsTakers", s.natsTakers.exclude(Set(p)))
      .with("natsReleaseDenied", s.natsReleaseDenied.union(Set(p))),
  }

  action nats_release_matching_owner(p: int): bool = all {
    s.phase.get(p) == NatsOwned,
    s.natsOwnerDisk == s.natsMemToken.get(p),
    s' = s
      .with("phase", s.phase.set(p, Done))
      .with("natsLockExists", false)
      .with("natsTakers", s.natsTakers.exclude(Set(p)))
      .with("natsOwnerDisk", -1)
      .with("natsUnauthorizedReleases",
        if (p == s.natsTrueHolder)
          s.natsUnauthorizedReleases
        else s.natsUnauthorizedReleases.union(Set(p)))
      .with("natsTrueHolder", -1),
  }

  // Queue admission from lane-queue.sh:415-424.
  action queue_admit(group: int): bool = all {
    GROUPS.contains(group),
    s.vendorRunning.get(group) < vendorCap(group),
    s' = s.with("vendorRunning",
      s.vendorRunning.set(group, s.vendorRunning.get(group) + 1)),
  }

  action queue_release(group: int): bool = all {
    GROUPS.contains(group),
    s.vendorRunning.get(group) > 0,
    s' = s.with("vendorRunning",
      s.vendorRunning.set(group, s.vendorRunning.get(group) - 1)),
  }

  action gate_admit = all {
    s.gateRunning < 1,
    s' = s.with("gateRunning", s.gateRunning + 1),
  }

  action gate_release = all {
    s.gateRunning > 0,
    s' = s.with("gateRunning", s.gateRunning - 1),
  }

  action terminal_stutter = all {
    PROCS.forall(p =>
      Set(Done, TimedOut).contains(s.phase.get(p))),
    s' = s,
  }

  // Split event-log and queue scheduling so counterexample reports can select
  // `--step=event_step` and avoid irrelevant queue churn. The default `step`
  // still explores both subsystems.
  action event_step = any {
    nondet p = oneOf(PROCS)
    any {
      choose_emit(p),
      choose_attempt(p),
      choose_compact(p),
      choose_nest_seq_first(p),
      choose_nest_attempt_first(p),
      atomic_take_seq(p),
      atomic_take_compact(p),
      toctou_check_seq(p),
      toctou_check_compact(p),
      toctou_create_seq(p),
      toctou_create_compact(p),
      spin_seq(p),
      timeout_seq(p),
      atomic_take_attempt(p),
      toctou_check_attempt(p),
      toctou_create_attempt(p),
      spin_attempt(p),
      timeout_attempt(p),
      finish_timeout(p),
      seq_read(p),
      seq_build_json(p),
      seq_jq_failure(p),
      seq_write_tmp(p),
      seq_rename_tmp(p),
      seq_rename_missing(p),
      seq_append(p),
      seq_append_failure(p),
      release_seq(p),
      attempt_read(p),
      attempt_write_tmp(p),
      attempt_rename_tmp(p),
      attempt_rename_missing(p),
      release_attempt(p),
      release_failed_attempt(p),
      compact_read(p),
      compact_transform(p),
      compact_validate(p),
      compact_rename(p),
      compact_failure(p),
      release_compact(p),
      nested_take_seq_first(p),
      nested_take_attempt_first(p),
      nested_take_attempt_second(p),
      nested_take_seq_second(p),
      nested_release_both(p),
      terminal_stutter,
    }
  }

  action index_step = any {
    nondet p = oneOf(PROCS)
    any {
      choose_index(p),
      atomic_take_index(p),
      spin_index(p),
      timeout_index_fail_open(p),
      index_read(p),
      index_write_unique_tmp(p),
      index_rename_unique_tmp(p),
      release_index(p),
      terminal_stutter,
    }
  }

  action nats_step = any {
    nondet p = oneOf(PROCS)
    any {
      choose_nats(p),
      atomic_take_nats(p),
      toctou_check_nats(p),
      toctou_create_nats(p),
      nats_observe_busy(p),
      nats_record_owner(p),
      nats_crash_before_owner(p),
      nats_release_denied(p),
      nats_release_matching_owner(p),
      terminal_stutter,
    }
  }

  action queue_step = any {
    nondet group = oneOf(GROUPS)
    any {
      queue_admit(group),
      queue_release(group),
      gate_admit,
      gate_release,
    }
  }

  action step = any { event_step, index_step, nats_step, queue_step }

  // At least one event-log process has a state-changing action. Spin-only
  // circular wait does not count as progress. Normal terminal completion is
  // explicitly accepted.
  def process_productive(p: int): bool =
    s.phase.get(p) == Idle
    or Set(CheckedSeq, CheckedCompact, CheckedAttempt, InSeq, InAttempt,
      InCompact, SeqRead, SeqBuilt, SeqTmpWritten, SeqReserved, SeqAppended,
      SeqJqFailed, SeqAppendFailed, SeqRenameFailed, AttemptRead,
      AttemptTmpWritten, AttemptReserved, AttemptRenameFailed, CompactRead,
      CompactTransformed, CompactValidated, CompactRenamed, CompactFailed,
      BothHeld, InIndex, IndexRead, IndexTmpWritten, IndexRenamed,
      CheckedNats, NatsTaken, NatsOwned, TimedOut).contains(s.phase.get(p))
    or (Set(WantSeq, WantCompact).contains(s.phase.get(p))
      and not(s.seqLockExists))
    or (s.phase.get(p) == WantAttempt and not(s.attemptLockExists))
    or (s.phase.get(p) == WantNestSeq and not(s.seqLockExists))
    or (s.phase.get(p) == WantNestAttempt and not(s.attemptLockExists))
    or (s.phase.get(p) == NeedAttempt and not(s.attemptLockExists))
    or (s.phase.get(p) == NeedSeq and not(s.seqLockExists))
    or (s.phase.get(p) == WantIndex and (
      not(s.indexLockExists)
      or s.indexRetries.get(p) <= MAX_RETRIES))
    or (s.phase.get(p) == WantNats and (
      not(s.natsLockExists)
      or not(s.natsWaited.get(p))))

  val terminal =
    PROCS.forall(p => Set(Done, TimedOut).contains(s.phase.get(p)))

  // Required named properties.
  val mutual_exclusion =
    s.seqHolders.size() <= 1
    and s.attemptHolders.size() <= 1
    and s.indexHolders.size() <= 1
    and s.natsTakers.size() <= 1
  val seq_uniqueness =
    s.eventLog.forall(e1 =>
      s.eventLog.forall(e2 => e1._2 != e2._2 or e1._1 == e2._1))
  // Each successful call contributes one distinct (process, value) result;
  // the durable counter must account for all completed calls.
  val no_lost_attempt = s.attemptCompleted.size() <= s.attemptDisk
  val no_deadlock = terminal or PROCS.exists(process_productive)
  // A reachability witness is encoded as a negated goal. VIOLATED is good:
  // some contender first lost/spun, then later acquired.
  val progress_witness = not(s.acquiredAfterSpin)

  // Additional safety properties needed by the modeled scope.
  val no_lost_structural_event = s.everAppended.subseteq(s.eventLog)
  // Both unique-temp renames may succeed, yet a later stale snapshot may
  // silently omit an entry that an earlier writer already committed.
  val no_lost_index_entry = s.indexCommitted.subseteq(s.indexDisk)
  // The token on disk must identify the process that actually created the
  // directory, not merely another process whose split mkdir also returned.
  val nats_owner_token_sound =
    s.natsOwnerDisk == -1
    or s.natsOwnerDisk == s.natsTrueHolder + 1
  val nats_release_authority =
    s.natsUnauthorizedReleases.size() == 0
  // Negated reachability goal: VIOLATED witnesses one token inversion causing
  // both a denied true-holder release and an authorized non-holder release.
  val nats_token_inversion_witness =
    not(
      s.natsReleaseDenied.size() > 0
      and s.natsUnauthorizedReleases.size() > 0)
  // A present directory is recoverable only while a live pre-record process
  // can still write its token, or a live recorded process currently matches.
  val nats_lock_recoverable =
    not(s.natsLockExists)
    or PROCS.exists(p =>
      s.phase.get(p) == NatsTaken
      or (s.phase.get(p) == NatsOwned
        and s.natsOwnerDisk == s.natsMemToken.get(p)))
  val queue_caps_respected =
    GROUPS.forall(g =>
      s.vendorRunning.get(g) >= 0
      and s.vendorRunning.get(g) <= vendorCap(g))
    and s.gateRunning >= 0
    and s.gateRunning <= 1
  val rename_failure_witness = s.renameFailures.size() == 0
}

module toctou {
  import locking(
    ATOMIC_LOCK = false,
    ALLOW_NESTING = false,
    FAIL_OPEN_INDEX = false,
    ENABLE_NATS = false
  ).*
}

module atomic {
  import locking(
    ATOMIC_LOCK = true,
    ALLOW_NESTING = false,
    FAIL_OPEN_INDEX = false,
    ENABLE_NATS = false
  ).*
}

module nested_atomic {
  import locking(
    ATOMIC_LOCK = true,
    ALLOW_NESTING = true,
    FAIL_OPEN_INDEX = false,
    ENABLE_NATS = false
  ).*
}

module index_fail_open_atomic {
  import locking(
    ATOMIC_LOCK = true,
    ALLOW_NESTING = false,
    FAIL_OPEN_INDEX = true,
    ENABLE_NATS = false
  ).*
}

module nats_atomic {
  import locking(
    ATOMIC_LOCK = true,
    ALLOW_NESTING = false,
    FAIL_OPEN_INDEX = false,
    ENABLE_NATS = true
  ).*
}

module nats_toctou {
  import locking(
    ATOMIC_LOCK = false,
    ALLOW_NESTING = false,
    FAIL_OPEN_INDEX = false,
    ENABLE_NATS = true
  ).*
}
