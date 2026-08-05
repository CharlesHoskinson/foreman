/**
 * @foreman/event-log — schema-version-1 stored-event decoder, bounded NDJSON
 * replay, physical-line cursor primitives, attempt identity, and the live
 * external run journal (Sprint 3 R3).
 *
 * Deferred (not in this package yet):
 * - cursor filesystem storage
 * - consumer migration (SessionDB, release, knowledge)
 * - thin-adapter migration of skills/foreman/scripts/lib/eventlog.sh
 * - closed per-type payload schemas / all-event payload typing
 * - durable ownership, compaction, resume protocol executor
 *   (R5C owns attempt-bound resume_attempt reservation only)
 */

export {
  EVENT_LOG_SCHEMA_VERSION,
  MAX_EVENT_JSON_NODES,
  MAX_EVENT_NESTING_DEPTH,
  MAX_PHYSICAL_LINE_BYTES,
  MAX_PHYSICAL_LINES,
  MAX_REPLAY_INPUT_BYTES,
  MAX_RUN_ID_LENGTH,
} from "./bounds.js";

export {
  EVENT_LOG_FAILURE_BRAND,
  eventDecodeFailure,
  cursorFailure,
  attemptFailure,
  isEventDecodeFailure,
  isCursorFailure,
  isAttemptFailure,
  type EventDecodeReason,
  type EventDecodeFailure,
  type CursorFailureReason,
  type CursorFailure,
  type AttemptFailureReason,
  type AttemptFailure,
  type ReplayStopReason,
} from "./failures.js";

export {
  decodeStoredEvent,
  decodeStoredEventFromBytes,
  decodeStoredEventFromText,
  type StoredEvent,
} from "./stored-event.js";

export {
  replayNdjson,
  replayNdjsonBytes,
  replayNdjsonText,
  type ReplayRecord,
  type ReplayTerminal,
  type ReplayResult,
  type ReplayOptions,
} from "./replay.js";

export {
  decodePhysicalLineCursor,
  decodePhysicalLineCursorText,
  advancePhysicalLineCursor,
  CURSOR_ZERO,
  type PhysicalLineCursor,
} from "./cursor.js";

export {
  decodeRunId,
  decodeLaneId,
  decodeAttemptId,
  decodeAttemptIdText,
  decodeAttemptIdentity,
  makeAttemptIdentity,
  nextAttempt,
  extractPayloadAttempt,
  type RunId,
  type LaneId,
  type AttemptId,
  type AttemptIdentity,
} from "./attempt.js";

export { isUtcSecondTimestamp } from "./timestamp.js";
export {
  checkEventStructure,
  checkJsonNestingText,
} from "./structure.js";

export {
  RunJournal,
  makeLiveRunJournalLayer,
  runJournalFailure,
  isRunJournalFailure,
  RUN_JOURNAL_FAILURE_BRAND,
  resumeAttemptFailure,
  isResumeAttemptFailure,
  RESUME_ATTEMPT_FAILURE_BRAND,
  inspectResumeAttemptBudget,
  JOURNAL_LOCK_BOUND_MS,
  MAX_ATTEMPT_COUNTER_BYTES,
  type StoredEventDraftV1,
  type RunJournalFailure,
  type RunJournalFailureReason,
  type ResumeAttemptFailure,
  type ResumeAttemptFailureReason,
  type ResumeAttemptReservationV1,
  type ResumeAttemptBudgetV1,
  type LiveRunJournalOptions,
} from "./run-journal.js";
