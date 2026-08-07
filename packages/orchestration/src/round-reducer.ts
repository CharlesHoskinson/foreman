/**
 * Closed round reducer and pure recovery for one attempt identity.
 *
 * Terminal events: round_done, alert{kind:"round_incomplete"}.
 * waiting_child is nonterminal (stores pending, stays Verifying).
 * Nonterminal annotations: ownership, heartbeat, checkpoint.
 */

import {
  extractPayloadAttempt,
  isAttemptFailure,
  type AttemptIdentity,
  type StoredEvent,
} from "@foreman/event-log";
import {
  attemptIdentitiesEqual,
  decodeRoundOutcomeV1,
  decodeRoundPlanV1,
  isRoundContractFailure,
  makeCheckpointIdentity,
  roundOutcomesEqual,
  snapshotsEqual,
  type CheckpointIdentityV1,
  type RoundOutcomeV1,
  type RoundPlanV1,
} from "./round-contract.js";

// ---------------------------------------------------------------------------
// Closed reducer state
// ---------------------------------------------------------------------------

export type RoundReducerPhase =
  | "Unstarted"
  | "Implementing"
  | "Verifying"
  | "Completed"
  | "Incomplete";

export type RoundReducerState = {
  readonly phase: RoundReducerPhase;
  readonly roundPlan: RoundPlanV1 | null;
  readonly checkpointIdentity: CheckpointIdentityV1 | null;
  readonly pendingIncomplete: RoundOutcomeV1 | null;
  readonly terminalOutcome: RoundOutcomeV1 | null;
  /** Set when a matching prompt had no roundPlan (legacy). */
  readonly legacyUnbound: boolean;
};

export function initialRoundReducerState(): RoundReducerState {
  return {
    phase: "Unstarted",
    roundPlan: null,
    checkpointIdentity: null,
    pendingIncomplete: null,
    terminalOutcome: null,
    legacyUnbound: false,
  };
}

export type RoundTransitionRejectionReason =
  | "invalid_transition"
  | "missing_attempt"
  | "invalid_payload"
  | "conflicting_outcome"
  | "unknown_event_type";

export type RoundTransitionResult =
  | { readonly _tag: "Advanced"; readonly state: RoundReducerState }
  | { readonly _tag: "Unchanged"; readonly state: RoundReducerState }
  | { readonly _tag: "Ignored"; readonly state: RoundReducerState }
  | {
      readonly _tag: "Rejected";
      readonly reason: RoundTransitionRejectionReason;
      readonly state: RoundReducerState;
    };

const STRUCTURAL_TYPES = new Set([
  "prompt",
  "checkpoint",
  "state",
  "waiting_child",
  "round_done",
  "alert",
  "ownership",
  "heartbeat",
]);

const ANNOTATION_TYPES = new Set(["ownership", "heartbeat"]);

function eventMatchesAttempt(
  event: StoredEvent,
  attemptIdentity: AttemptIdentity,
): "match" | "other" | "missing" | "invalid" | "unbound" {
  if (event.lane !== attemptIdentity.laneId) {
    return "other";
  }
  const extracted = extractPayloadAttempt(event.payload);
  if (extracted === undefined) {
    // Same-lane non-structural event without attempt is unbound to the round.
    if (!STRUCTURAL_TYPES.has(event.type)) {
      return "unbound";
    }
    return "missing";
  }
  if (isAttemptFailure(extracted)) {
    return "invalid";
  }
  if (extracted !== attemptIdentity.attemptId) {
    return "other";
  }
  return "match";
}

function reject(
  state: RoundReducerState,
  reason: RoundTransitionRejectionReason,
): RoundTransitionResult {
  return { _tag: "Rejected", reason, state };
}

function advanced(state: RoundReducerState): RoundTransitionResult {
  return { _tag: "Advanced", state };
}

function unchanged(state: RoundReducerState): RoundTransitionResult {
  return { _tag: "Unchanged", state };
}

/**
 * Apply one stored event to the reducer for the selected attempt.
 *
 * - Different lane ID or attempt ID → Rejected invalid_transition.
 * - Same-lane non-structural without payload.attempt → Ignored (unbound).
 * - Bound unknown type → Rejected unknown_event_type (including after terminal).
 * Recovery prefilters other valid attempts before calling this public reducer.
 */
export function reduceRoundEvent(
  state: RoundReducerState,
  event: StoredEvent,
  attemptIdentity: AttemptIdentity,
): RoundTransitionResult {
  const match = eventMatchesAttempt(event, attemptIdentity);
  if (match === "unbound") {
    return { _tag: "Ignored", state };
  }
  if (match === "other") {
    return reject(state, "invalid_transition");
  }
  if (match === "missing") {
    return reject(state, "missing_attempt");
  }
  if (match === "invalid") {
    return reject(state, "invalid_payload");
  }

  // Bound unknown event type: reject even after terminal (not Unchanged).
  if (!STRUCTURAL_TYPES.has(event.type)) {
    return reject(state, "unknown_event_type");
  }

  // Terminal states accept nothing further for known structural events.
  if (state.phase === "Completed" || state.phase === "Incomplete") {
    return reject(state, "invalid_transition");
  }

  if (ANNOTATION_TYPES.has(event.type)) {
    // ownership / heartbeat only while Implementing (before or after checkpoint).
    if (state.phase !== "Implementing") {
      return reject(state, "invalid_transition");
    }
    return unchanged(state);
  }

  switch (event.type) {
    case "prompt":
      return reducePrompt(state, event, attemptIdentity);
    case "checkpoint":
      return reduceCheckpoint(state, event, attemptIdentity);
    case "state":
      return reduceStateVerifying(state, event);
    case "waiting_child":
      return reduceWaitingChild(state, event, attemptIdentity);
    case "round_done":
      return reduceRoundDone(state, event, attemptIdentity);
    case "alert":
      return reduceAlert(state, event, attemptIdentity);
    default:
      // Unknown type bound to the selected attempt.
      return reject(state, "unknown_event_type");
  }
}

/**
 * True when the event is a valid event for a different lane or attempt and
 * must be prefiltered out of recovery before calling the public reducer.
 *
 * Same-lane structural events with missing or malformed attempt stay invalid.
 */
function isValidOtherLaneOrAttempt(
  event: StoredEvent,
  attemptIdentity: AttemptIdentity,
): boolean {
  if (event.lane !== attemptIdentity.laneId) {
    return true;
  }
  const extracted = extractPayloadAttempt(event.payload);
  if (extracted === undefined || isAttemptFailure(extracted)) {
    return false;
  }
  return extracted !== attemptIdentity.attemptId;
}

function reducePrompt(
  state: RoundReducerState,
  event: StoredEvent,
  attemptIdentity: AttemptIdentity,
): RoundTransitionResult {
  if (state.phase !== "Unstarted") {
    return reject(state, "invalid_transition");
  }
  if (!("roundPlan" in event.payload)) {
    return advanced({
      ...state,
      phase: "Implementing",
      legacyUnbound: true,
      roundPlan: null,
    });
  }
  const plan = decodeRoundPlanV1(event.payload["roundPlan"]);
  if (isRoundContractFailure(plan)) {
    return reject(state, "invalid_payload");
  }
  const planIdentity = {
    runId: plan.runId,
    laneId: plan.laneId,
    attemptId: plan.attemptId,
  };
  if (!attemptIdentitiesEqual(planIdentity, attemptIdentity)) {
    return reject(state, "invalid_transition");
  }
  if (plan.attemptId !== event.payload["attempt"]) {
    return reject(state, "invalid_payload");
  }
  return advanced({
    ...state,
    phase: "Implementing",
    roundPlan: plan,
    legacyUnbound: false,
  });
}

function reduceCheckpoint(
  state: RoundReducerState,
  event: StoredEvent,
  attemptIdentity: AttemptIdentity,
): RoundTransitionResult {
  if (state.phase !== "Implementing") {
    return reject(state, "invalid_transition");
  }
  if (state.checkpointIdentity !== null) {
    return reject(state, "invalid_transition");
  }
  if (typeof event.commit !== "string" || event.commit.length === 0) {
    return reject(state, "invalid_payload");
  }
  const ckpt = makeCheckpointIdentity(attemptIdentity, event.commit);
  if (isRoundContractFailure(ckpt)) {
    return reject(state, "invalid_payload");
  }
  return advanced({
    ...state,
    checkpointIdentity: ckpt,
  });
}

function reduceStateVerifying(
  state: RoundReducerState,
  event: StoredEvent,
): RoundTransitionResult {
  if (state.phase !== "Implementing") {
    return reject(state, "invalid_transition");
  }
  if (event.payload["state"] !== "verifying") {
    return reject(state, "invalid_payload");
  }
  if (state.checkpointIdentity === null) {
    // verifying before a valid checkpoint
    return reject(state, "invalid_transition");
  }
  return advanced({
    ...state,
    phase: "Verifying",
  });
}

/**
 * For a bound round plan, the durable outcome baseline must equal the sole
 * plan baseline exactly (snapshot equality). Legacy unbound prompts have no
 * plan and skip this check.
 */
function rejectIfBaselineConflictsPlan(
  state: RoundReducerState,
  outcome: RoundOutcomeV1,
): RoundTransitionResult | null {
  if (state.roundPlan === null) {
    return null;
  }
  if (
    !snapshotsEqual(outcome.reportBaseline, state.roundPlan.reportBaseline)
  ) {
    return reject(state, "conflicting_outcome");
  }
  return null;
}

function reduceWaitingChild(
  state: RoundReducerState,
  event: StoredEvent,
  attemptIdentity: AttemptIdentity,
): RoundTransitionResult {
  if (state.phase !== "Verifying") {
    return reject(state, "invalid_transition");
  }
  if (state.pendingIncomplete !== null) {
    return reject(state, "invalid_transition");
  }
  if (!("outcome" in event.payload)) {
    return reject(state, "invalid_payload");
  }
  const outcome = decodeRoundOutcomeV1(event.payload["outcome"]);
  if (isRoundContractFailure(outcome)) {
    return reject(state, "invalid_payload");
  }
  if (outcome._tag !== "incomplete") {
    return reject(state, "invalid_payload");
  }
  if (!attemptIdentitiesEqual(outcome.attemptIdentity, attemptIdentity)) {
    return reject(state, "conflicting_outcome");
  }
  const baselineConflict = rejectIfBaselineConflictsPlan(state, outcome);
  if (baselineConflict !== null) {
    return baselineConflict;
  }
  // Nonterminal: store pending, remain Verifying.
  return advanced({
    ...state,
    pendingIncomplete: outcome,
  });
}

function reduceRoundDone(
  state: RoundReducerState,
  event: StoredEvent,
  attemptIdentity: AttemptIdentity,
): RoundTransitionResult {
  if (state.phase !== "Verifying") {
    return reject(state, "invalid_transition");
  }
  if (!("outcome" in event.payload)) {
    return reject(state, "invalid_payload");
  }
  const outcome = decodeRoundOutcomeV1(event.payload["outcome"]);
  if (isRoundContractFailure(outcome)) {
    return reject(state, "invalid_payload");
  }
  if (outcome._tag !== "completed") {
    return reject(state, "invalid_payload");
  }
  if (!attemptIdentitiesEqual(outcome.attemptIdentity, attemptIdentity)) {
    return reject(state, "conflicting_outcome");
  }
  const baselineConflict = rejectIfBaselineConflictsPlan(state, outcome);
  if (baselineConflict !== null) {
    return baselineConflict;
  }
  if (
    state.pendingIncomplete !== null &&
    !roundOutcomesEqual(state.pendingIncomplete, outcome)
  ) {
    // pending incomplete then completed is conflicting
    return reject(state, "conflicting_outcome");
  }
  return advanced({
    ...state,
    phase: "Completed",
    terminalOutcome: outcome,
  });
}

function reduceAlert(
  state: RoundReducerState,
  event: StoredEvent,
  attemptIdentity: AttemptIdentity,
): RoundTransitionResult {
  if (event.payload["kind"] !== "round_incomplete") {
    // Other alert kinds bound to this attempt are not round terminals.
    return reject(state, "unknown_event_type");
  }
  if (state.phase !== "Verifying") {
    return reject(state, "invalid_transition");
  }
  if (state.pendingIncomplete === null) {
    // terminal alert requires pending from waiting_child
    return reject(state, "invalid_transition");
  }
  if (!("outcome" in event.payload)) {
    return reject(state, "invalid_payload");
  }
  const outcome = decodeRoundOutcomeV1(event.payload["outcome"]);
  if (isRoundContractFailure(outcome)) {
    return reject(state, "invalid_payload");
  }
  if (outcome._tag !== "incomplete") {
    return reject(state, "invalid_payload");
  }
  if (!attemptIdentitiesEqual(outcome.attemptIdentity, attemptIdentity)) {
    return reject(state, "conflicting_outcome");
  }
  const baselineConflict = rejectIfBaselineConflictsPlan(state, outcome);
  if (baselineConflict !== null) {
    return baselineConflict;
  }
  if (!roundOutcomesEqual(outcome, state.pendingIncomplete)) {
    return reject(state, "conflicting_outcome");
  }
  return advanced({
    ...state,
    phase: "Incomplete",
    terminalOutcome: outcome,
  });
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export type RecoveryInvalidReason =
  | "invalid_transition"
  | "checkpoint_missing"
  | "conflicting_outcome"
  | "invalid_payload";

export type RoundRecoveryResult =
  | {
      readonly _tag: "Recoverable";
      readonly roundPlan: RoundPlanV1;
      readonly checkpointIdentity: CheckpointIdentityV1;
    }
  | {
      readonly _tag: "Completed";
      readonly attemptIdentity: AttemptIdentity;
      readonly outcome: RoundOutcomeV1;
    }
  | {
      readonly _tag: "LegacyUnbound";
      readonly attemptIdentity: AttemptIdentity;
    }
  | {
      readonly _tag: "Invalid";
      readonly attemptIdentity: AttemptIdentity;
      readonly reason: RecoveryInvalidReason;
    };

/**
 * Pure recovery over replayed stored events for one exact AttemptIdentity.
 * Does not read process state, filesystem, or credentials.
 *
 * Completed means a durable terminal event was found; outcome may be
 * completed or incomplete.
 */
export function recoverRoundAttempt(
  events: readonly StoredEvent[],
  attemptIdentity: AttemptIdentity,
): RoundRecoveryResult {
  let state = initialRoundReducerState();
  let sawMatchingPrompt = false;

  for (const event of events) {
    // Prefilter valid other-lane / other-attempt events; do not call the
    // public reducer (which would Reject them as invalid_transition).
    if (isValidOtherLaneOrAttempt(event, attemptIdentity)) {
      continue;
    }
    const result = reduceRoundEvent(state, event, attemptIdentity);
    if (result._tag === "Ignored") {
      continue;
    }
    if (result._tag === "Rejected") {
      return mapRejection(result.reason, attemptIdentity, state, event);
    }
    state = result.state;
    if (event.type === "prompt" && eventMatchesAttempt(event, attemptIdentity) === "match") {
      sawMatchingPrompt = true;
    }
  }

  if (state.legacyUnbound) {
    return { _tag: "LegacyUnbound", attemptIdentity };
  }

  if (state.phase === "Completed" || state.phase === "Incomplete") {
    if (state.terminalOutcome === null) {
      return {
        _tag: "Invalid",
        attemptIdentity,
        reason: "invalid_payload",
      };
    }
    // Terminal replay result; outcome may be completed or incomplete.
    return {
      _tag: "Completed",
      attemptIdentity,
      outcome: state.terminalOutcome,
    };
  }

  if (!sawMatchingPrompt && state.roundPlan === null) {
    // No events for this attempt — treat as recoverable-missing? Spec says
    // Recoverable requires plan + checkpoint. Without prompt: Invalid.
    return {
      _tag: "Invalid",
      attemptIdentity,
      reason: "invalid_payload",
    };
  }

  if (state.roundPlan !== null && state.checkpointIdentity === null) {
    return {
      _tag: "Invalid",
      attemptIdentity,
      reason: "checkpoint_missing",
    };
  }

  if (state.roundPlan !== null && state.checkpointIdentity !== null) {
    // Recoverable even with pending waiting_child (nonterminal).
    return {
      _tag: "Recoverable",
      roundPlan: state.roundPlan,
      checkpointIdentity: state.checkpointIdentity,
    };
  }

  return {
    _tag: "Invalid",
    attemptIdentity,
    reason: "invalid_transition",
  };
}

function mapRejection(
  reason: RoundTransitionRejectionReason,
  attemptIdentity: AttemptIdentity,
  state: RoundReducerState,
  event: StoredEvent,
): RoundRecoveryResult {
  if (reason === "conflicting_outcome") {
    return { _tag: "Invalid", attemptIdentity, reason: "conflicting_outcome" };
  }
  if (reason === "invalid_payload" || reason === "missing_attempt") {
    return { _tag: "Invalid", attemptIdentity, reason: "invalid_payload" };
  }
  // checkpoint before prompt already covered by phase checks → invalid_transition
  // verifying before checkpoint → invalid_transition
  if (
    event.type === "state" &&
    state.phase === "Implementing" &&
    state.checkpointIdentity === null
  ) {
    return { _tag: "Invalid", attemptIdentity, reason: "invalid_transition" };
  }
  if (event.type === "checkpoint" && state.phase === "Unstarted") {
    return { _tag: "Invalid", attemptIdentity, reason: "invalid_transition" };
  }
  return { _tag: "Invalid", attemptIdentity, reason: "invalid_transition" };
}
