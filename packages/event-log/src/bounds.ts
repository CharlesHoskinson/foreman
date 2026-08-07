/**
 * Frozen schema-version-1 structural and stream bounds for @foreman/event-log.
 * These constants are part of the public contract surface.
 */

/** Maximum nesting depth of a stored-event JSON value (root depth is 1). */
export const MAX_EVENT_NESTING_DEPTH = 64;

/** Maximum aggregate JSON nodes (object keys + array elements) per event. */
export const MAX_EVENT_JSON_NODES = 100_000;

/** Maximum physical line content bytes before the line ending. */
export const MAX_PHYSICAL_LINE_BYTES = 1_048_576;

/** Maximum total input bytes including line endings. */
export const MAX_REPLAY_INPUT_BYTES = 67_108_864;

/** Maximum complete physical lines in one replay. */
export const MAX_PHYSICAL_LINES = 100_000;

/** Maximum run-id string length in UTF-16 code units (JS string length). */
export const MAX_RUN_ID_LENGTH = 255;

/** Schema version for the stored-event and replay result surface. */
export const EVENT_LOG_SCHEMA_VERSION = 1 as const;
