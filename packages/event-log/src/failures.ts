/**
 * Closed, non-leaking failure surfaces for @foreman/event-log.
 * Public results never carry absolute paths, input text, parser messages,
 * stacks, or system errors.
 */

export const EVENT_LOG_FAILURE_BRAND = Symbol("@foreman/event-log/Failure");

type Branded = { readonly [EVENT_LOG_FAILURE_BRAND]: true };

/** Closed decode reasons for one stored event (text or already-parsed value). */
export type EventDecodeReason =
  | "malformed_utf8"
  | "invalid_json"
  | "duplicate_key"
  | "event_schema"
  | "event_structure_limit";

export type EventDecodeFailure = Branded & {
  readonly _tag: "EventDecodeFailure";
  readonly reason: EventDecodeReason;
};

/** Closed reasons for physical-line cursor decode / advance. */
export type CursorFailureReason =
  | "invalid_cursor"
  | "cursor_regression"
  | "cursor_overflow";

export type CursorFailure = Branded & {
  readonly _tag: "CursorFailure";
  readonly reason: CursorFailureReason;
};

/** Closed reasons for attempt identity and counter primitives. */
export type AttemptFailureReason =
  | "invalid_run_id"
  | "invalid_lane_id"
  | "invalid_attempt_id"
  | "attempt_overflow"
  | "invalid_attempt_text"
  | "invalid_payload_attempt";

export type AttemptFailure = Branded & {
  readonly _tag: "AttemptFailure";
  readonly reason: AttemptFailureReason;
};

export function eventDecodeFailure(reason: EventDecodeReason): EventDecodeFailure {
  return {
    [EVENT_LOG_FAILURE_BRAND]: true,
    _tag: "EventDecodeFailure",
    reason,
  };
}

export function cursorFailure(reason: CursorFailureReason): CursorFailure {
  return {
    [EVENT_LOG_FAILURE_BRAND]: true,
    _tag: "CursorFailure",
    reason,
  };
}

export function attemptFailure(reason: AttemptFailureReason): AttemptFailure {
  return {
    [EVENT_LOG_FAILURE_BRAND]: true,
    _tag: "AttemptFailure",
    reason,
  };
}

export function isEventDecodeFailure(v: unknown): v is EventDecodeFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [EVENT_LOG_FAILURE_BRAND]?: unknown })[EVENT_LOG_FAILURE_BRAND] ===
      true &&
    (v as { _tag?: unknown })._tag === "EventDecodeFailure"
  );
}

export function isCursorFailure(v: unknown): v is CursorFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [EVENT_LOG_FAILURE_BRAND]?: unknown })[EVENT_LOG_FAILURE_BRAND] ===
      true &&
    (v as { _tag?: unknown })._tag === "CursorFailure"
  );
}

export function isAttemptFailure(v: unknown): v is AttemptFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [EVENT_LOG_FAILURE_BRAND]?: unknown })[EVENT_LOG_FAILURE_BRAND] ===
      true &&
    (v as { _tag?: unknown })._tag === "AttemptFailure"
  );
}

/** Closed terminal stop reasons for bounded NDJSON replay. */
export type ReplayStopReason =
  | "torn_tail"
  | "malformed_utf8"
  | "invalid_json"
  | "duplicate_key"
  | "event_schema"
  | "event_structure_limit"
  | "line_too_large"
  | "input_too_large"
  | "too_many_lines"
  | "sequence_not_monotonic"
  | "sequence_duplicate"
  | "cursor_beyond_eof";
