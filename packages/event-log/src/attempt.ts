import {
  attemptFailure,
  type AttemptFailure,
} from "./failures.js";
import { MAX_RUN_ID_LENGTH } from "./bounds.js";

/**
 * Run identifier: bounded non-empty string with no path separators or NUL.
 * Path separators are `/` and `\` (and the NUL byte).
 */
export type RunId = string & { readonly __brand: "RunId" };

/**
 * Allocation lane ID using legacy grammar `^[A-Za-z0-9._-]+$`.
 * Distinct from the opaque non-empty `lane` field on StoredEvent.
 */
export type LaneId = string & { readonly __brand: "LaneId" };

/** Positive safe integer attempt counter. */
export type AttemptId = number & { readonly __brand: "AttemptId" };

/** Scoped attempt identity tuple. */
export type AttemptIdentity = {
  readonly runId: RunId;
  readonly laneId: LaneId;
  readonly attemptId: AttemptId;
};

const LANE_GRAMMAR = /^[A-Za-z0-9._-]+$/;
const DIGITS_ONLY = /^[0-9]+$/;

function isPositiveSafeInteger(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 1;
}

/**
 * Decode a run ID: non-empty, bounded, no `/`, `\`, or NUL.
 */
export function decodeRunId(value: string): RunId | AttemptFailure {
  if (typeof value !== "string" || value.length === 0) {
    return attemptFailure("invalid_run_id");
  }
  if (value.length > MAX_RUN_ID_LENGTH) {
    return attemptFailure("invalid_run_id");
  }
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) {
    return attemptFailure("invalid_run_id");
  }
  return value as RunId;
}

/**
 * Decode an allocation lane ID with legacy grammar.
 */
export function decodeLaneId(value: string): LaneId | AttemptFailure {
  if (typeof value !== "string" || value.length === 0) {
    return attemptFailure("invalid_lane_id");
  }
  if (!LANE_GRAMMAR.test(value)) {
    return attemptFailure("invalid_lane_id");
  }
  return value as LaneId;
}

/**
 * Decode a positive safe-integer attempt ID.
 */
export function decodeAttemptId(value: number): AttemptId | AttemptFailure {
  if (typeof value !== "number" || !isPositiveSafeInteger(value)) {
    return attemptFailure("invalid_attempt_id");
  }
  return value as AttemptId;
}

/**
 * Build a scoped attempt identity from validated parts.
 */
export function makeAttemptIdentity(
  runId: RunId,
  laneId: LaneId,
  attemptId: AttemptId,
): AttemptIdentity {
  return { runId, laneId, attemptId };
}

/**
 * Decode and build identity from raw strings / number.
 */
export function decodeAttemptIdentity(
  runId: string,
  laneId: string,
  attemptId: number,
): AttemptIdentity | AttemptFailure {
  const r = decodeRunId(runId);
  if (typeof r !== "string") return r;
  const l = decodeLaneId(laneId);
  if (typeof l !== "string") return l;
  const a = decodeAttemptId(attemptId);
  if (typeof a !== "number") return a;
  return makeAttemptIdentity(r, l, a);
}

/**
 * Strict decimal stored attempt text: digits only, value >= 1, same rules as
 * cursor text (no sign, whitespace, CR, LF, exponent, leading plus, or
 * leading zeros). Corrupt text fails closed and is never reset to zero.
 */
export function decodeAttemptIdText(text: string): AttemptId | AttemptFailure {
  if (typeof text !== "string" || text.length === 0) {
    return attemptFailure("invalid_attempt_text");
  }
  if (!DIGITS_ONLY.test(text)) {
    return attemptFailure("invalid_attempt_text");
  }
  if (text.length > 1 && text[0] === "0") {
    return attemptFailure("invalid_attempt_text");
  }
  if (text.length > 16) {
    return attemptFailure("invalid_attempt_text");
  }
  const n = Number(text);
  if (!isPositiveSafeInteger(n)) {
    return attemptFailure("invalid_attempt_text");
  }
  if (String(n) !== text) {
    return attemptFailure("invalid_attempt_text");
  }
  return n as AttemptId;
}

/**
 * Pure next-attempt counter: missing maps to 1; otherwise increments by 1.
 * Returns a typed overflow result at Number.MAX_SAFE_INTEGER.
 */
export function nextAttempt(
  current: AttemptId | null | undefined,
): AttemptId | AttemptFailure {
  if (current === null || current === undefined) {
    return 1 as AttemptId;
  }
  if (typeof current !== "number" || !isPositiveSafeInteger(current)) {
    return attemptFailure("invalid_attempt_id");
  }
  if (current >= Number.MAX_SAFE_INTEGER) {
    return attemptFailure("attempt_overflow");
  }
  return (current + 1) as AttemptId;
}

/**
 * Optional strict extractor for top-level `payload.attempt`.
 * Does not require every event to carry an attempt.
 * Does not interpret nested `payload.evidence.attempt`.
 */
export function extractPayloadAttempt(
  payload: Readonly<Record<string, unknown>>,
): AttemptId | AttemptFailure | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return attemptFailure("invalid_payload_attempt");
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "attempt")) {
    return undefined;
  }
  const v = payload["attempt"];
  if (typeof v !== "number" || !isPositiveSafeInteger(v)) {
    return attemptFailure("invalid_payload_attempt");
  }
  return v as AttemptId;
}
