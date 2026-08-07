/**
 * Pure typed authority for selecting one current round attempt and deciding
 * a fail-safe resume action (Sprint 3 R5A).
 *
 * No filesystem, process, lock, restore, queue, or network operations.
 * Recovery uses recoverRoundAttempt only — no second event reducer.
 */

import {
  decodeAttemptId,
  isAttemptFailure,
  makeAttemptIdentity,
  type AttemptIdentity,
  type LaneId,
  type RunId,
  type StoredEvent,
} from "@foreman/event-log";
import {
  attemptIdentitiesEqual,
  attemptIdentityFromPlan,
  decodeRoundPlanV1,
  isRoundContractFailure,
  type CheckpointIdentityV1,
  type RoundOutcomeV1,
  type RoundPlanV1,
} from "./round-contract.js";
import { recoverRoundAttempt } from "./round-reducer.js";

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type LatestRoundAttemptV1 =
  | { readonly _tag: "NoRound" }
  | { readonly _tag: "Selected"; readonly attemptIdentity: AttemptIdentity }
  | {
      readonly _tag: "LegacyUnbound";
      readonly attemptIdentity: AttemptIdentity;
      readonly promptSequence: number;
    }
  | {
      readonly _tag: "Invalid";
      readonly laneId: LaneId;
      readonly promptSequence: number;
      readonly attemptIdentity?: AttemptIdentity;
    };

/**
 * True when every consecutive pair of event sequences is strictly increasing.
 * Does not sort or repair the input.
 */
function sequencesStrictlyIncreasing(events: readonly StoredEvent[]): boolean {
  for (let i = 1; i < events.length; i++) {
    if (events[i]!.seq <= events[i - 1]!.seq) {
      return false;
    }
  }
  return true;
}

/**
 * Select the prompt with the greatest sequence for the requested lane.
 * Validates full history sequences, then run, lane, and attempt identity
 * before returning Selected.
 */
export function selectLatestRoundAttempt(
  events: readonly StoredEvent[],
  runId: RunId,
  laneId: LaneId,
): LatestRoundAttemptV1 {
  // Fail closed on ambiguous history before any prompt selection or recovery.
  if (!sequencesStrictlyIncreasing(events)) {
    return { _tag: "Invalid", laneId, promptSequence: 0 };
  }

  let latest: StoredEvent | null = null;
  for (const event of events) {
    if (event.type !== "prompt") continue;
    if (event.lane !== laneId) continue;
    if (latest === null || event.seq > latest.seq) {
      latest = event;
    }
  }

  if (latest === null) {
    return { _tag: "NoRound" };
  }

  const promptSequence = latest.seq;
  const attemptRaw = latest.payload["attempt"];
  if (typeof attemptRaw !== "number") {
    return { _tag: "Invalid", laneId, promptSequence };
  }
  const attempt = decodeAttemptId(attemptRaw);
  if (isAttemptFailure(attempt)) {
    return { _tag: "Invalid", laneId, promptSequence };
  }

  const selectedIdentity = makeAttemptIdentity(runId, laneId, attempt);

  if (!Object.prototype.hasOwnProperty.call(latest.payload, "roundPlan")) {
    return {
      _tag: "LegacyUnbound",
      attemptIdentity: selectedIdentity,
      promptSequence,
    };
  }

  const plan = decodeRoundPlanV1(latest.payload["roundPlan"]);
  if (isRoundContractFailure(plan)) {
    return {
      _tag: "Invalid",
      laneId,
      promptSequence,
      attemptIdentity: selectedIdentity,
    };
  }

  const planIdentity = attemptIdentityFromPlan(plan);
  if (!attemptIdentitiesEqual(planIdentity, selectedIdentity)) {
    return {
      _tag: "Invalid",
      laneId,
      promptSequence,
      attemptIdentity: selectedIdentity,
    };
  }
  // Enclosing prompt attempt must equal plan attempt (already covered by
  // selectedIdentity, but keep explicit equality with payload attempt).
  if (plan.attemptId !== attempt) {
    return {
      _tag: "Invalid",
      laneId,
      promptSequence,
      attemptIdentity: selectedIdentity,
    };
  }

  return { _tag: "Selected", attemptIdentity: selectedIdentity };
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export type ResumeProcessState = "inactive" | "active" | "unknown";
export type ResumeLockState = "free" | "held" | "unknown";

export type RoundResumeDecisionV1 =
  | { readonly _tag: "NoRound" }
  | {
      readonly _tag: "Completed";
      readonly attemptIdentity: AttemptIdentity;
      readonly outcome: RoundOutcomeV1;
    }
  | {
      readonly _tag: "Wait";
      readonly attemptIdentity: AttemptIdentity;
      readonly reason:
        | "prior_attempt_active"
        | "process_state_unknown"
        | "lock_held"
        | "lock_state_unknown";
    }
  | {
      readonly _tag: "Resume";
      readonly roundPlan: RoundPlanV1;
      readonly checkpointIdentity: CheckpointIdentityV1;
      readonly nextResumeCount: number;
    }
  | {
      readonly _tag: "Refused";
      readonly attemptIdentity?: AttemptIdentity;
      readonly reason:
        | "legacy_unbound"
        | "invalid_history"
        | "checkpoint_missing"
        | "resume_limit_reached"
        | "invalid_observation";
    };

export type DecideRoundResumeInput = {
  readonly events: readonly StoredEvent[];
  readonly runId: RunId;
  readonly laneId: LaneId;
  readonly resumeCount: number;
  readonly resumeMaxAttempts: number;
  readonly processState: ResumeProcessState;
  readonly lockState: ResumeLockState;
};

function isValidResumeCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 100
  );
}

function isValidResumeMaxAttempts(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 100
  );
}

function isValidProcessState(value: unknown): value is ResumeProcessState {
  return value === "inactive" || value === "active" || value === "unknown";
}

function isValidLockState(value: unknown): value is ResumeLockState {
  return value === "free" || value === "held" || value === "unknown";
}

function observationsValid(input: DecideRoundResumeInput): boolean {
  return (
    isValidResumeCount(input.resumeCount) &&
    isValidResumeMaxAttempts(input.resumeMaxAttempts) &&
    isValidProcessState(input.processState) &&
    isValidLockState(input.lockState)
  );
}

/**
 * Decide a closed round-resume action from selection, recovery, and explicit
 * safety observations. First-match order is fixed by the OpenSpec.
 */
export function decideRoundResume(
  input: DecideRoundResumeInput,
): RoundResumeDecisionV1 {
  const selected = selectLatestRoundAttempt(
    input.events,
    input.runId,
    input.laneId,
  );

  if (selected._tag === "NoRound") {
    return { _tag: "NoRound" };
  }

  if (selected._tag === "LegacyUnbound") {
    return {
      _tag: "Refused",
      attemptIdentity: selected.attemptIdentity,
      reason: "legacy_unbound",
    };
  }

  if (selected._tag === "Invalid") {
    if (selected.attemptIdentity !== undefined) {
      return {
        _tag: "Refused",
        attemptIdentity: selected.attemptIdentity,
        reason: "invalid_history",
      };
    }
    return { _tag: "Refused", reason: "invalid_history" };
  }

  const attemptIdentity = selected.attemptIdentity;
  const recovery = recoverRoundAttempt(input.events, attemptIdentity);

  // 1. Durable terminal outcome → Completed
  if (recovery._tag === "Completed") {
    return {
      _tag: "Completed",
      attemptIdentity: recovery.attemptIdentity,
      outcome: recovery.outcome,
    };
  }

  // 2. Invalid or legacy recovery → Refused
  if (recovery._tag === "LegacyUnbound") {
    return {
      _tag: "Refused",
      attemptIdentity: recovery.attemptIdentity,
      reason: "legacy_unbound",
    };
  }

  if (recovery._tag === "Invalid") {
    if (recovery.reason === "checkpoint_missing") {
      return {
        _tag: "Refused",
        attemptIdentity: recovery.attemptIdentity,
        reason: "checkpoint_missing",
      };
    }
    return {
      _tag: "Refused",
      attemptIdentity: recovery.attemptIdentity,
      reason: "invalid_history",
    };
  }

  // recovery._tag === "Recoverable"
  // 3. Invalid observation → Refused
  if (!observationsValid(input)) {
    return {
      _tag: "Refused",
      attemptIdentity,
      reason: "invalid_observation",
    };
  }

  // 4. Reached resume limit → Refused
  if (input.resumeCount >= input.resumeMaxAttempts) {
    return {
      _tag: "Refused",
      attemptIdentity,
      reason: "resume_limit_reached",
    };
  }

  // 5. Active or unknown process state → Wait
  if (input.processState === "active") {
    return {
      _tag: "Wait",
      attemptIdentity,
      reason: "prior_attempt_active",
    };
  }
  if (input.processState === "unknown") {
    return {
      _tag: "Wait",
      attemptIdentity,
      reason: "process_state_unknown",
    };
  }

  // 6. Held or unknown lock state → Wait
  if (input.lockState === "held") {
    return {
      _tag: "Wait",
      attemptIdentity,
      reason: "lock_held",
    };
  }
  if (input.lockState === "unknown") {
    return {
      _tag: "Wait",
      attemptIdentity,
      reason: "lock_state_unknown",
    };
  }

  // 7. Recoverable → Resume with exact stored plan and checkpoint identity
  return {
    _tag: "Resume",
    roundPlan: recovery.roundPlan,
    checkpointIdentity: recovery.checkpointIdentity,
    nextResumeCount: input.resumeCount + 1,
  };
}
