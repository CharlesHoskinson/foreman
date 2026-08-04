import {
  cursorFailure,
  type CursorFailure,
} from "./failures.js";

/**
 * Physical-line cursor: count of physical lines already consumed.
 * Not an event sequence. Missing storage is represented by the caller as 0.
 *
 * Consumers commit a cursor only after the side effect for the advanced
 * lines is acknowledged. That gives at-least-once replay on crash.
 */
export type PhysicalLineCursor = number & {
  readonly __brand: "PhysicalLineCursor";
};

const DIGITS_ONLY = /^[0-9]+$/;

function isNonNegativeSafeInteger(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

/**
 * Decode a physical-line cursor from a number.
 * Rejects negatives, non-integers, and non-finite values.
 */
export function decodePhysicalLineCursor(
  value: number,
): PhysicalLineCursor | CursorFailure {
  if (typeof value !== "number" || !isNonNegativeSafeInteger(value)) {
    return cursorFailure("invalid_cursor");
  }
  return value as PhysicalLineCursor;
}

/**
 * Decode strict decimal cursor text: digits only, no sign, whitespace, CR,
 * LF, exponent, or leading plus. Corrupt text fails closed (never becomes 0).
 * Leading zeros are rejected except for the single digit "0".
 */
export function decodePhysicalLineCursorText(
  text: string,
): PhysicalLineCursor | CursorFailure {
  if (typeof text !== "string" || text.length === 0) {
    return cursorFailure("invalid_cursor");
  }
  if (!DIGITS_ONLY.test(text)) {
    return cursorFailure("invalid_cursor");
  }
  if (text.length > 1 && text[0] === "0") {
    return cursorFailure("invalid_cursor");
  }
  // Reject values that cannot be exact safe integers (too many digits).
  if (text.length > 16) {
    return cursorFailure("invalid_cursor");
  }
  const n = Number(text);
  if (!isNonNegativeSafeInteger(n)) {
    return cursorFailure("invalid_cursor");
  }
  // Reject text that is not the canonical decimal form of n.
  if (String(n) !== text) {
    return cursorFailure("invalid_cursor");
  }
  return n as PhysicalLineCursor;
}

/**
 * Pure acknowledgement / advance: move from a committed cursor to a later
 * observed cursor. Rejects regression and overflow past MAX_SAFE_INTEGER
 * (the destination must already be a valid PhysicalLineCursor).
 *
 * Consumers must call this only after the side effect for lines
 * (committed, observed] is acknowledged — at-least-once replay.
 */
export function advancePhysicalLineCursor(
  committed: PhysicalLineCursor,
  observed: PhysicalLineCursor,
): PhysicalLineCursor | CursorFailure {
  if (typeof committed !== "number" || !isNonNegativeSafeInteger(committed)) {
    return cursorFailure("invalid_cursor");
  }
  if (typeof observed !== "number" || !isNonNegativeSafeInteger(observed)) {
    return cursorFailure("invalid_cursor");
  }
  if (observed < committed) {
    return cursorFailure("cursor_regression");
  }
  // observed is already a safe integer; overflow of the cursor value itself
  // is impossible for a valid PhysicalLineCursor destination. Guard the
  // edge where a programmer passes Number.MAX_SAFE_INTEGER + 1 via cast.
  if (observed > Number.MAX_SAFE_INTEGER) {
    return cursorFailure("cursor_overflow");
  }
  return observed as PhysicalLineCursor;
}

/** Cursor zero — missing storage / start of log. */
export const CURSOR_ZERO = 0 as PhysicalLineCursor;
