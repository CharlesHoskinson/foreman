/**
 * Structural bounds for @foreman/graph-store files-only backend.
 * Part of the public contract surface.
 */

/** Maximum UTF-8 bytes for a single generation or input JSON file. */
export const MAX_FILE_BYTES = 1_048_576;

/** Maximum regular files under one store root (excluding the lock). */
export const MAX_ROOT_FILES = 4_096;

/** Maximum nesting depth of a generation JSON value (root depth is 1). */
export const MAX_JSON_DEPTH = 64;

/** Maximum aggregate JSON nodes (object keys + array elements) per document. */
export const MAX_JSON_NODES = 100_000;

/** Maximum documents returned by one lineage query. */
export const MAX_QUERY_RESULTS = 10_000;

/** Maximum cycle-walk steps for depends_on / resolved_to / derived_from. */
export const MAX_TRAVERSAL_STEPS = 10_000;

/** Exclusive lock acquisition bound (milliseconds). */
export const STORE_LOCK_BOUND_MS = 10_000;

/** Spin interval while waiting for an exclusive store lock (milliseconds). */
export const STORE_LOCK_SPIN_MS = 5;

/** Maximum lock-retry attempts for concurrent open/publish of one root. */
export const MAX_LOCK_RETRIES = 2_000;

/** Generation id decimal width (zero-padded). */
export const GENERATION_ID_WIDTH = 16;

/** Schema version for the files-only generation snapshot. */
export const GRAPH_STORE_SCHEMA_VERSION = 1 as const;
