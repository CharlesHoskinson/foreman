// Foreman lane lifecycle and round-ownership model.
//
// Reproduction recipes (Quint 0.32.0):
//
//   quint typecheck specs/lane_lifecycle.qnt
//
//   # Deterministic pre-fix background-and-stop counterexample:
//   quint run specs/lane_lifecycle.qnt \
//     --init=init_prefix --step=step_prefix_bug \
//     --invariant=inv_round_done_requires_fresh_report \
//     --max-steps=4 --max-samples=1 --verbosity=3
//
//   # Symbolic post-fix safety checks:
//   quint verify specs/lane_lifecycle.qnt \
//     --init=init_postfix --step=step_postfix \
//     --invariant=inv_round_done_requires_fresh_report \
//     --max-steps=20
//
//   # Witnesses are negated goals: a violation is the expected/good result.
//   quint run specs/lane_lifecycle.qnt \
//     --init=init_postfix --step=step_postfix \
//     --invariant=witness_round_done \
//     --max-steps=30 --max-samples=500 --backend=rust
//
//   # Deterministic H3 live-child limbo:
//   quint run specs/lane_lifecycle.qnt \
//     --init=init_prefix --step=step_prefix_live \
//     --invariant=inv_no_silent_limbo \
//     --max-steps=35 --max-samples=1 --verbosity=3 --seed=0x1
//
//   # Shipped supervisor integration (successful resume loses --round):
//   quint verify specs/lane_lifecycle.qnt \
//     --init=init_postfix --step=step_shipped \
//     --invariant=inv_round_done_requires_fresh_report \
//     --max-steps=12
//
// Time is WATCH_VTICK-style logical time. Production thresholds
// 10 < 90 < 300 < 600 < 900 are proportionally represented by
// 1 < 3 < 10 < 20 < 30. Boundary comparisons match watch.sh exactly.
module lane_lifecycle {
  type RoundOwner =
    | AGENT_WRAPPER
    | DAEMON_ROUND
    | PLAIN_RESUME

  type Lifecycle =
    | NOT_DISPATCHED
    | DISPATCHED
    | IMPLEMENTING
    | GATING
    | REPORTING
    | ROUND_INCOMPLETE
    | ROUND_DONE_PHASE
    | TERMINAL_FAILED

  // Exactly the ten labels named by watch.sh's v2 classifier.
  type WatchState =
    | QUEUED
    | STARTING
    | RUNNING_IMPL
    | VERIFYING
    | WAITING_CHILD
    | AGENT_ABANDONED
    | STALLED
    | DEAD
    | SUCCEEDED
    | FAILED

  type GateResult = GATE_ABSENT | GATE_GREEN | GATE_RED
  type WrapperExit = EXIT_ABSENT | EXIT_ZERO | EXIT_NONZERO

  type LaneState = {
    // lane-queue.sh admission and lane-run.sh phase.
    lifecycle: Lifecycle,
    queued: bool,
    dispatched: bool,
    dispatchAt: int,

    // lane-run.sh --round versus the pre-fix agent wrapper.
    owner: RoundOwner,
    durableEnabled: bool,

    // eventlog.sh el_attempt_new and the current prompt's attempt.
    round: int,
    attemptCounter: int,
    attempt: int,
    attemptAllocationFailed: bool,

    // launcher ownership heartbeat plus watch.sh phase-entry bookkeeping.
    pidAlive: bool,
    heartbeatSeen: bool,
    lastActivity: int,
    phaseEntered: int,
    verifying: bool,
    previousWatch: WatchState,

    // The known agent-turn failure signal, distinct from process liveness.
    agentStopped: bool,
    wrapperExit: WrapperExit,

    // lane-run.sh's opaque gate and attempt-fresh report artifacts.
    gateResult: GateResult,
    reportExists: bool,
    reportMtime: int,
    reportAttempt: int,
    roundDone: bool,
    waitingChild: bool,
    waitingAt: int,
    roundIncompleteAlert: bool,

    // lib/checkpoint.sh / resume.sh abstraction: 0 means no checkpoint.
    checkpoint: int,
    dirty: bool,

    // lane-supervise.sh run-wide event count and round-local ghost count.
    resumeCountRun: int,
    resumeCountRound: int,
    // Ghost snapshot: structural round when a successful resume was queued.
    resumeQueuedFromRound: int,
    // Shipped re-enqueue is plain, but ownership changes only when it starts.
    resumeWillBePlain: bool,
    resumeSucceeded: bool,
    retrySweeps: int,
    dirtyAlert: bool,
    abandonedAlert: bool,
  }

  val STARTING_STALE = 3
  val IMPL_STALE = 10
  val VERIFY_STALE = 20
  val STALL_DEAD = 30
  val GRACE = 1
  val MAX_TIME = 34
  val RESUME_MAX = 2
  val MAX_ROUNDS = 3
  val MAX_ATTEMPTS = 8

  // WATCH_VTICK's logical clock; no wall-clock behavior is represented.
  var now: int

  // All per-lane artifacts abstracted from lane-run/watch/supervise/resume.
  var lane: LaneState

  pure def initialLane(theOwner: RoundOwner): LaneState = {
    lifecycle: NOT_DISPATCHED,
    queued: false,
    dispatched: false,
    dispatchAt: 0,
    owner: theOwner,
    durableEnabled: true,
    round: 0,
    attemptCounter: 0,
    attempt: 0,
    attemptAllocationFailed: false,
    pidAlive: false,
    heartbeatSeen: false,
    lastActivity: 0,
    phaseEntered: 0,
    verifying: false,
    previousWatch: QUEUED,
    agentStopped: false,
    wrapperExit: EXIT_ABSENT,
    gateResult: GATE_ABSENT,
    reportExists: false,
    reportMtime: 0,
    reportAttempt: 0,
    roundDone: false,
    waitingChild: false,
    waitingAt: 0,
    roundIncompleteAlert: false,
    checkpoint: 0,
    dirty: false,
    resumeCountRun: 0,
    resumeCountRound: 0,
    resumeQueuedFromRound: 0,
    resumeWillBePlain: false,
    resumeSucceeded: false,
    retrySweeps: 0,
    dirtyAlert: false,
    abandonedAlert: false,
  }

  pure def reportIsFresh(l: LaneState): bool =
    l.reportExists and (
      l.reportMtime > l.dispatchAt or
      l.reportAttempt == l.attempt
    )

  pure def watchBucket(
    age: int,
    warn: int,
    healthy: WatchState
  ): WatchState =
    if (age >= STALL_DEAD) {
      DEAD
    } else if (age >= warn) {
      STALLED
    } else {
      healthy
    }

  pure def unEscalatedPhase(l: LaneState): WatchState =
    if (not(l.heartbeatSeen) and not(l.verifying)) {
      STARTING
    } else if (l.verifying) {
      VERIFYING
    } else {
      RUNNING_IMPL
    }

  // watch.sh wd_classify_v2's first-match-wins priority cascade.
  pure def rawWatchState(l: LaneState, t: int): WatchState =
    if (l.roundDone and (
      l.gateResult == GATE_ABSENT or l.gateResult == GATE_GREEN
    )) {
      SUCCEEDED
    } else if (l.abandonedAlert) {
      FAILED
    } else if (l.queued) {
      QUEUED
    } else if (not(l.heartbeatSeen) and not(l.verifying)) {
      watchBucket(t - l.dispatchAt, STARTING_STALE, STARTING)
    } else if (
      l.waitingChild and l.waitingAt > l.lastActivity
    ) {
      WAITING_CHILD
    } else if (not(l.pidAlive) and not(l.roundDone)) {
      AGENT_ABANDONED
    } else if (l.verifying) {
      watchBucket(t - l.lastActivity, VERIFY_STALE, VERIFYING)
    } else {
      watchBucket(t - l.lastActivity, IMPL_STALE, RUNNING_IMPL)
    }

  // Loop-mode grace clamp plus the v2 PHASE -> STALLED -> DEAD bridge.
  // --once corresponds to rawWatchState and intentionally skips both.
  pure def watchState(l: LaneState, t: int): WatchState = {
    val raw = rawWatchState(l, t)
    val clamped =
      if (
        (raw == STALLED or raw == DEAD) and
        t - l.phaseEntered < GRACE
      ) {
        unEscalatedPhase(l)
      } else {
        raw
      }
    if (clamped == DEAD and l.previousWatch != STALLED) {
      STALLED
    } else {
      clamped
    }
  }

  pure def isAlerting(w: WatchState): bool =
    w == STALLED or
    w == DEAD or
    w == AGENT_ABANDONED or
    w == WAITING_CHILD or
    w == FAILED

  pure def isTerminal(l: LaneState): bool =
    l.roundDone or l.abandonedAlert

  // lane-supervise.sh's reduced latest-round ABANDONED predicate.
  pure def supervisorAbandoned(l: LaneState): bool =
    l.dispatched and not(l.roundDone) and not(l.pidAlive)

  action init_prefix = all {
    now' = 0,
    lane' = initialLane(AGENT_WRAPPER),
  }

  action init_postfix = all {
    now' = 0,
    lane' = initialLane(DAEMON_ROUND),
  }

  // Duplicate assignments (rather than aliasing init_postfix) keep the TLC
  // converter from treating one action declaration as both init and step.
  action init = all {
    now' = 0,
    lane' = initialLane(DAEMON_ROUND),
  }

  action enqueueRound = all {
    (not(lane.dispatched) or isTerminal(lane)),
    lane.round < MAX_ROUNDS,
    now' = now,
    lane' = lane
      .with("lifecycle", DISPATCHED)
      .with("queued", true)
      .with("dispatched", true)
      .with("dispatchAt", now)
      .with("round", lane.round + 1)
      .with("pidAlive", false)
      .with("heartbeatSeen", false)
      .with("lastActivity", now)
      .with("phaseEntered", now)
      .with("verifying", false)
      .with("previousWatch", QUEUED)
      .with("agentStopped", false)
      .with("wrapperExit", EXIT_ABSENT)
      .with("gateResult", GATE_ABSENT)
      .with("reportExists", false)
      .with("reportMtime", 0)
      .with("reportAttempt", 0)
      .with("roundDone", false)
      .with("waitingChild", false)
      .with("waitingAt", 0)
      .with("roundIncompleteAlert", false)
      .with("checkpoint", 0)
      .with("dirty", false)
      .with("resumeCountRound", 0)
      .with("resumeQueuedFromRound", 0)
      .with("resumeWillBePlain", false)
      .with("resumeSucceeded", false)
      .with("retrySweeps", 0)
      .with("dirtyAlert", false)
      .with("abandonedAlert", false),
  }

  action dispatchAttemptOk = all {
    lane.queued,
    lane.attemptCounter < MAX_ATTEMPTS,
    not(lane.resumeSucceeded) or lane.round < MAX_ROUNDS,
    now' = now,
    lane' = lane
      .with("lifecycle", IMPLEMENTING)
      .with("queued", false)
      .with("dispatchAt", now)
      .with(
        "round",
        if (lane.resumeSucceeded) { lane.round + 1 } else { lane.round }
      )
      .with(
        "owner",
        if (lane.resumeSucceeded and lane.resumeWillBePlain) {
          PLAIN_RESUME
        } else {
          lane.owner
        }
      )
      .with("attemptCounter", lane.attemptCounter + 1)
      .with("attempt", lane.attemptCounter + 1)
      .with("attemptAllocationFailed", false)
      .with(
        "resumeCountRound",
        if (lane.resumeSucceeded) { 0 } else { lane.resumeCountRound }
      )
      .with("pidAlive", true)
      .with("phaseEntered", now),
  }

  // el_attempt_new failure degrades the current id to 1.
  action dispatchAttemptDegraded = all {
    lane.queued,
    not(lane.resumeSucceeded) or lane.round < MAX_ROUNDS,
    now' = now,
    lane' = lane
      .with("lifecycle", IMPLEMENTING)
      .with("queued", false)
      .with("dispatchAt", now)
      .with(
        "round",
        if (lane.resumeSucceeded) { lane.round + 1 } else { lane.round }
      )
      .with(
        "owner",
        if (lane.resumeSucceeded and lane.resumeWillBePlain) {
          PLAIN_RESUME
        } else {
          lane.owner
        }
      )
      .with("attempt", 1)
      .with("attemptAllocationFailed", true)
      .with(
        "resumeCountRound",
        if (lane.resumeSucceeded) { 0 } else { lane.resumeCountRound }
      )
      .with("pidAlive", true)
      .with("phaseEntered", now),
  }

  action implementationHeartbeat = all {
    lane.lifecycle == IMPLEMENTING,
    lane.pidAlive,
    not(lane.agentStopped),
    now' = now,
    lane' = lane
      .with("heartbeatSeen", true)
      .with("lastActivity", now),
  }

  action logicalTick = all {
    now < MAX_TIME,
    now' = now + 1,
    lane' = lane,
  }

  action sampleWatch = all {
    now' = now,
    lane' = lane.with("previousWatch", watchState(lane, now)),
  }

  action takeCheckpoint = all {
    lane.lifecycle == IMPLEMENTING,
    lane.attempt > 0,
    now' = now,
    lane' = lane.with("checkpoint", lane.attempt),
  }

  action makeWorktreeDirty = all {
    lane.lifecycle == IMPLEMENTING,
    now' = now,
    lane' = lane.with("dirty", true),
  }

  action crashOwner = all {
    lane.dispatched,
    not(lane.roundDone),
    lane.pidAlive,
    now' = now,
    lane' = lane
      .with("pidAlive", false)
      .with("agentStopped", true),
  }

  action beginGate = all {
    lane.owner == DAEMON_ROUND,
    lane.lifecycle == IMPLEMENTING,
    lane.pidAlive,
    now' = now,
    lane' = lane
      .with("lifecycle", GATING)
      .with("verifying", true)
      .with("phaseEntered", now)
      .with("heartbeatSeen", true)
      .with("lastActivity", now),
  }

  action gateGreen = all {
    lane.owner == DAEMON_ROUND,
    lane.lifecycle == GATING,
    now' = now,
    lane' = lane
      .with("lifecycle", REPORTING)
      .with("gateResult", GATE_GREEN),
  }

  action gateRed = all {
    lane.owner == DAEMON_ROUND,
    lane.lifecycle == GATING,
    now' = now,
    lane' = lane
      .with("lifecycle", REPORTING)
      .with("gateResult", GATE_RED),
  }

  action writeReportByMtime = all {
    lane.lifecycle == REPORTING,
    now < MAX_TIME,
    now' = now + 1,
    lane' = lane
      .with("reportExists", true)
      .with("reportMtime", now + 1),
  }

  action writeReportByAttempt = all {
    lane.lifecycle == REPORTING,
    lane.attempt > 0,
    now' = now,
    lane' = lane
      .with("reportExists", true)
      .with("reportAttempt", lane.attempt),
  }

  // The only daemon-owned transition allowed to emit round_done.
  action daemonComplete = all {
    lane.owner == DAEMON_ROUND,
    lane.lifecycle == REPORTING,
    lane.gateResult == GATE_GREEN,
    reportIsFresh(lane),
    now' = now,
    lane' = lane
      .with("lifecycle", ROUND_DONE_PHASE)
      .with("roundDone", true)
      .with("pidAlive", false),
  }

  // A resumed attempt may traverse the same green gate/report path. This
  // compressed safe transition keeps the multi-round H1 witness tractable.
  action resumedRoundCompletesSafely = all {
    lane.owner == DAEMON_ROUND,
    lane.lifecycle == IMPLEMENTING,
    lane.resumeSucceeded,
    lane.attempt > 0,
    now' = now,
    lane' = lane
      .with("lifecycle", ROUND_DONE_PHASE)
      .with("wrapperExit", EXIT_ZERO)
      .with("gateResult", GATE_GREEN)
      .with("reportExists", true)
      .with("reportAttempt", lane.attempt)
      .with("roundDone", true)
      .with("pidAlive", false),
  }

  action daemonIncomplete = all {
    lane.owner == DAEMON_ROUND,
    lane.lifecycle == REPORTING,
    not(
      lane.gateResult == GATE_GREEN and
      reportIsFresh(lane)
    ),
    now < MAX_TIME,
    now' = now + 1,
    lane' = lane
      .with("lifecycle", ROUND_INCOMPLETE)
      .with("waitingChild", true)
      .with("waitingAt", now + 1)
      .with("roundIncompleteAlert", true)
      .with("pidAlive", false),
  }

  // Post-fix rendering of an agent turn that backgrounds work and exits 0:
  // the daemon continues through gate/report assertion and makes it loud.
  action daemonBackgroundAndStop = all {
    lane.owner == DAEMON_ROUND,
    lane.lifecycle == IMPLEMENTING,
    not(lane.reportExists),
    now < MAX_TIME,
    now' = now + 1,
    lane' = lane
      .with("lifecycle", ROUND_INCOMPLETE)
      .with("agentStopped", true)
      .with("wrapperExit", EXIT_ZERO)
      .with("gateResult", GATE_GREEN)
      .with("verifying", true)
      .with("waitingChild", true)
      .with("waitingAt", now + 1)
      .with("roundIncompleteAlert", true)
      .with("pidAlive", false),
  }

  // The pre-fix bug: wrapper exit 0 is treated as round completion even
  // though neither gate evidence nor a fresh report exists.
  action agentBackgroundsAndStops = all {
    lane.owner == AGENT_WRAPPER or lane.owner == PLAIN_RESUME,
    lane.lifecycle == IMPLEMENTING,
    not(lane.reportExists),
    now' = now,
    lane' = lane
      .with("lifecycle", ROUND_DONE_PHASE)
      .with("agentStopped", true)
      .with("wrapperExit", EXIT_ZERO)
      .with("pidAlive", false)
      .with("roundDone", true),
  }

  // H3: detached work outlives the agent and refreshes the observed heartbeat.
  action agentStopsButChildLives = all {
    lane.owner == AGENT_WRAPPER,
    lane.lifecycle == IMPLEMENTING,
    not(lane.agentStopped),
    now' = now,
    lane' = lane
      .with("agentStopped", true)
      .with("wrapperExit", EXIT_ZERO)
      .with("pidAlive", true)
      .with("heartbeatSeen", true)
      .with("lastActivity", now),
  }

  action liveChildTick = all {
    lane.owner == AGENT_WRAPPER,
    lane.agentStopped,
    lane.pidAlive,
    now < MAX_TIME,
    now' = now + 1,
    lane' = lane
      .with("heartbeatSeen", true)
      .with("lastActivity", now + 1),
  }

  // H4: no transition consults this configuration bit.
  action disableDurable = all {
    lane.durableEnabled,
    now' = now,
    lane' = lane.with("durableEnabled", false),
  }

  // resume.sh succeeds from an integer checkpoint; the core model preserves
  // --round ownership while queued, and resumed dispatch starts the next
  // structural prompt round.
  action successfulResumeCore = all {
    lane.owner == DAEMON_ROUND,
    supervisorAbandoned(lane),
    lane.round < MAX_ROUNDS,
    lane.resumeCountRun < RESUME_MAX,
    lane.checkpoint > 0,
    not(lane.dirty),
    lane.attemptCounter < MAX_ATTEMPTS,
    now' = now,
    lane' = lane
      .with("lifecycle", DISPATCHED)
      .with("queued", true)
      .with("resumeCountRun", lane.resumeCountRun + 1)
      .with("resumeCountRound", lane.resumeCountRound + 1)
      .with("resumeQueuedFromRound", lane.round)
      .with("resumeWillBePlain", false)
      .with("resumeSucceeded", true)
      .with("pidAlive", false)
      .with("heartbeatSeen", false)
      .with("lastActivity", now)
      .with("phaseEntered", now)
      .with("verifying", false)
      .with("agentStopped", false)
      .with("wrapperExit", EXIT_ABSENT)
      .with("gateResult", GATE_ABSENT)
      .with("reportExists", false)
      .with("reportMtime", 0)
      .with("reportAttempt", 0)
      .with("waitingChild", false)
      .with("waitingAt", 0)
      .with("roundIncompleteAlert", false),
  }

  // H2: exit 5 is retried, alert-deduped, and never consumes the cap.
  action resumeRefusedDirty = all {
    supervisorAbandoned(lane),
    lane.resumeCountRun < RESUME_MAX,
    lane.dirty,
    lane.retrySweeps < 3,
    now' = now,
    lane' = lane
      .with("retrySweeps", lane.retrySweeps + 1)
      .with("dirtyAlert", true),
  }

  // H1: the cap is based on resumeCountRun, not resumeCountRound.
  action emitTerminalAbandoned = all {
    supervisorAbandoned(lane),
    lane.resumeCountRun >= RESUME_MAX,
    now' = now,
    lane' = lane
      .with("lifecycle", TERMINAL_FAILED)
      .with("abandonedAlert", true),
  }

  // Actual lane-supervise.sh integration: success re-enqueues plain mode.
  // The old daemon owner remains the latest recorded owner until that pueue
  // task starts and emits its prompt, so another sweep may resume it again.
  action successfulResumePlain = all {
    lane.owner == DAEMON_ROUND,
    supervisorAbandoned(lane),
    lane.round < MAX_ROUNDS,
    lane.resumeCountRun < RESUME_MAX,
    lane.checkpoint > 0,
    not(lane.dirty),
    now' = now,
    lane' = lane
      .with("lifecycle", DISPATCHED)
      .with("queued", true)
      .with("resumeCountRun", lane.resumeCountRun + 1)
      .with("resumeCountRound", lane.resumeCountRound + 1)
      .with("resumeQueuedFromRound", lane.round)
      .with("resumeWillBePlain", true)
      .with("resumeSucceeded", true)
      .with("pidAlive", false)
      .with("heartbeatSeen", false)
      .with("lastActivity", now)
      .with("phaseEntered", now)
      .with("verifying", false)
      .with("agentStopped", false)
      .with("wrapperExit", EXIT_ABSENT)
      .with("gateResult", GATE_ABSENT)
      .with("reportExists", false)
      .with("reportMtime", 0)
      .with("reportAttempt", 0)
      .with("waitingChild", false)
      .with("waitingAt", 0)
      .with("roundIncompleteAlert", false),
  }

  action terminalStutter = all {
    isTerminal(lane),
    now' = now,
    lane' = lane,
  }

  action commonStep = any {
    enqueueRound,
    dispatchAttemptOk,
    dispatchAttemptDegraded,
    implementationHeartbeat,
    logicalTick,
    sampleWatch,
    takeCheckpoint,
    makeWorktreeDirty,
    crashOwner,
    disableDurable,
    terminalStutter,
  }

  action step_prefix = any {
    commonStep,
    agentBackgroundsAndStops,
    agentStopsButChildLives,
    liveChildTick,
  }

  action step_postfix_without_resume = any {
    commonStep,
    beginGate,
    gateGreen,
    gateRed,
    writeReportByMtime,
    writeReportByAttempt,
    daemonComplete,
    resumedRoundCompletesSafely,
    daemonIncomplete,
    daemonBackgroundAndStop,
    resumeRefusedDirty,
    emitTerminalAbandoned,
  }

  action step_postfix = any {
    step_postfix_without_resume,
    successfulResumeCore,
  }

  action step_shipped = any {
    step_postfix_without_resume,
    successfulResumePlain,
    agentBackgroundsAndStops,
  }

  // The deterministic three-transition pre-fix trace documented above.
  action step_prefix_bug = any {
    enqueueRound,
    dispatchAttemptOk,
    agentBackgroundsAndStops,
  }

  action step_prefix_live = any {
    enqueueRound,
    dispatchAttemptOk,
    agentStopsButChildLives,
    liveChildTick,
  }

  action step_postfix_success = any {
    enqueueRound,
    dispatchAttemptOk,
    beginGate,
    gateGreen,
    writeReportByAttempt,
    daemonComplete,
  }

  action step_postfix_incomplete = any {
    enqueueRound,
    dispatchAttemptOk,
    daemonBackgroundAndStop,
  }

  action step_postfix_abandoned = any {
    enqueueRound,
    dispatchAttemptOk,
    implementationHeartbeat,
    crashOwner,
  }

  action step_postfix_resume = any {
    enqueueRound,
    dispatchAttemptOk,
    takeCheckpoint,
    crashOwner,
    successfulResumeCore,
  }

  action step_h1_budget = any {
    enqueueRound,
    dispatchAttemptOk,
    takeCheckpoint,
    crashOwner,
    successfulResumeCore,
    resumedRoundCompletesSafely,
  }

  action step_h2_dirty = any {
    enqueueRound,
    dispatchAttemptOk,
    takeCheckpoint,
    makeWorktreeDirty,
    crashOwner,
    resumeRefusedDirty,
  }

  action step_h4_disabled_bug = any {
    disableDurable,
    enqueueRound,
    dispatchAttemptOk,
    agentBackgroundsAndStops,
  }

  action step_shipped_resume_bug = any {
    enqueueRound,
    dispatchAttemptOk,
    takeCheckpoint,
    crashOwner,
    successfulResumePlain,
    agentBackgroundsAndStops,
  }

  action step = step_postfix

  // SAFETY: round_done is an artifact predicate, never a conversational one.
  val inv_round_done_requires_fresh_report =
    not(lane.roundDone) or (
      lane.gateResult == GATE_GREEN and reportIsFresh(lane)
    )

  // SAFETY: exit 0 alone cannot produce the watcher's terminal-success label.
  val inv_no_completion_from_exit_code =
    not(
      lane.wrapperExit == EXIT_ZERO and
      not(reportIsFresh(lane)) and
      watchState(lane, now) == SUCCEEDED
    )

  // Bounded liveness surrogate: total nonterminal limbo beyond the shared
  // dead bound plus grace must be represented by an alerting typed label.
  val inv_no_silent_limbo =
    not(
      lane.dispatched and
      not(isTerminal(lane)) and
      now - lane.dispatchAt > STALL_DEAD + GRACE
    ) or isAlerting(watchState(lane, now))

  // Auxiliary bounds make the symbolic state space explicitly finite.
  val inv_model_bounds =
    now >= 0 and now <= MAX_TIME and
    lane.round >= 0 and lane.round <= MAX_ROUNDS and
    lane.attemptCounter >= 0 and lane.attemptCounter <= MAX_ATTEMPTS and
    lane.resumeCountRun >= 0 and lane.resumeCountRun <= RESUME_MAX and
    lane.resumeCountRound >= 0 and
    lane.resumeQueuedFromRound >= 0 and
    lane.resumeQueuedFromRound <= MAX_ROUNDS and
    lane.retrySweeps >= 0 and lane.retrySweeps <= 3

  // A successful resume is still part of the old structural round while its
  // pueue task is merely queued. Once that task dispatches, lane-run.sh emits
  // a new prompt, so the new structural round must have started.
  val inv_redispatched_resume_starts_new_round =
    not(
      lane.resumeSucceeded and
      not(lane.queued) and
      lane.lifecycle == IMPLEMENTING
    ) or (
      lane.round > lane.resumeQueuedFromRound and
      lane.resumeCountRound == 0
    )

  // WARNING: this unqualified temporal property is stuttering-falsifiable.
  // It must not be cited as evidence for a liveness defect unless the trace is
  // non-vacuous or the relevant enabled actions have explicit fairness.
  temporal eventually_terminal = eventually(isTerminal(lane))

  // Quint 0.32.0 supports action fairness. Fairness on the whole disjunctive
  // step excludes global stuttering while a changing step stays enabled, but
  // it does NOT prevent another branch from starving a completion branch.
  // These are anti-global-stutter experiments, not adequate terminal-liveness
  // specifications, and must not be cited as such without branch fairness.
  temporal eventually_terminal_postfix_fair =
    step_postfix.weakFair((now, lane)) implies eventually(isTerminal(lane))

  temporal eventually_terminal_shipped_fair =
    step_shipped.weakFair((now, lane)) implies eventually(isTerminal(lane))

  // WITNESSES: each is a negated reachability goal (violation = reachable).
  val witness_round_done = not(lane.roundDone)

  val witness_waiting_child =
    watchState(lane, now) != WAITING_CHILD

  val witness_agent_abandoned =
    watchState(lane, now) != AGENT_ABANDONED

  val witness_successful_resume =
    not(lane.resumeSucceeded)

  val witness_h1_later_round_budget_exhausted =
    not(
      lane.round >= 3 and
      lane.resumeCountRun >= RESUME_MAX and
      lane.resumeCountRound == 0 and
      supervisorAbandoned(lane)
    )

  val witness_h2_dirty_retry_uncapped =
    not(
      lane.dirtyAlert and
      lane.retrySweeps >= 3 and
      lane.resumeCountRun < RESUME_MAX and
      not(isTerminal(lane))
    )

  val witness_h3_live_unproductive_limbo =
    not(
      lane.agentStopped and
      lane.pidAlive and
      now - lane.dispatchAt > STALL_DEAD + GRACE and
      not(isAlerting(watchState(lane, now)))
    )

  val witness_h4_disabled_prefix_attractor =
    not(
      not(lane.durableEnabled) and
      lane.roundDone and
      not(reportIsFresh(lane))
    )

  val witness_shipped_resume_loses_round_ownership =
    lane.owner != PLAIN_RESUME
}
