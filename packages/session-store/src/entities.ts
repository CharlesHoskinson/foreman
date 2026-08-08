/**
 * Canonical session-state entity model.
 *
 * This module is the contract. It is declared here in TypeScript, not derived
 * from any backend's introspection surface. The SQLite implementation is
 * checked *against* this model; it does not define it.
 *
 * Two rules make round-trip fidelity decidable:
 *
 * 1. Nullability — an absent value is always `null`, never an absent key.
 *    Every field declared in an entity spec is present on every row.
 *
 * 2. Identity — ids are minted by the port from a persisted counter, never by
 *    the backend. `nextIds` is part of the snapshot, so importing a snapshot
 *    restores allocation state and two stores that imported the same snapshot
 *    mint the same next id.
 */

/** Version of the entity model in this file. Bump on ANY field, nullability,
 *  enum, ordering, or canonical-encoding change. */
export const SESSION_MODEL_VERSION = 1;

export const ENTITY_KINDS = [
  "session",
  "fact",
  "measurement",
  "obligation",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Kinds that carry a port-minted integer id. `session` is keyed by its own id. */
export const COUNTED_KINDS = ["fact", "measurement", "obligation"] as const;
export type CountedKind = (typeof COUNTED_KINDS)[number];

export function isCountedKind(kind: EntityKind): kind is CountedKind {
  return kind !== "session";
}

export type FieldType = "string" | "integer" | "real" | "timestamp" | "enum";

export type FieldSpec = {
  readonly name: string;
  readonly type: FieldType;
  readonly nullable: boolean;
  /** Present iff type === "enum"; the closed set of accepted values. */
  readonly enumValues?: readonly string[];
};

export type EntitySpec = {
  readonly kind: EntityKind;
  /** Field names forming the entity identity, in canonical order. */
  readonly identity: readonly string[];
  /**
   * Ordering key for deterministic enumeration. A backend MUST return rows in
   * ascending order of these fields so that encoding is byte-stable.
   */
  readonly ordering: readonly string[];
  readonly fields: readonly FieldSpec[];
  /** Whether rows of this kind carry the set-once supersession columns. */
  readonly supersedable: boolean;
};

export const OBLIGATION_STATUSES = ["open", "done", "dropped"] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

/**
 * Supersession columns.
 *
 * NOT append-only: recording a successor UPDATEs the predecessor row. These
 * three columns are the ONLY mutable fields on a supersedable entity. They are
 * set-once, all-or-none, and must be written in the same transaction as the
 * insert of the superseding row.
 */
export const SUPERSESSION_FIELD_NAMES = [
  "superseded_by",
  "superseded_at",
  "supersede_reason",
] as const;

const SUPERSESSION_FIELDS: readonly FieldSpec[] = [
  { name: "superseded_by", type: "integer", nullable: true },
  { name: "superseded_at", type: "timestamp", nullable: true },
  { name: "supersede_reason", type: "string", nullable: true },
];

export const SESSION_SPEC: EntitySpec = {
  kind: "session",
  identity: ["session_id"],
  ordering: ["session_id"],
  supersedable: false,
  fields: [
    { name: "session_id", type: "string", nullable: false },
    { name: "started_ts", type: "timestamp", nullable: false },
    { name: "start_sha", type: "string", nullable: true },
    { name: "ended_ts", type: "timestamp", nullable: true },
    { name: "note", type: "string", nullable: true },
  ],
};

export const FACT_SPEC: EntitySpec = {
  kind: "fact",
  identity: ["id"],
  ordering: ["id"],
  supersedable: true,
  fields: [
    { name: "id", type: "integer", nullable: false },
    { name: "statement", type: "string", nullable: false },
    { name: "evidence", type: "string", nullable: true },
    { name: "established_ts", type: "timestamp", nullable: false },
    { name: "session_id", type: "string", nullable: true },
    ...SUPERSESSION_FIELDS,
  ],
};

export const MEASUREMENT_SPEC: EntitySpec = {
  kind: "measurement",
  identity: ["id"],
  ordering: ["id"],
  supersedable: true,
  fields: [
    { name: "id", type: "integer", nullable: false },
    { name: "metric", type: "string", nullable: false },
    { name: "value", type: "string", nullable: false },
    { name: "value_num", type: "real", nullable: true },
    { name: "command", type: "string", nullable: true },
    { name: "measured_ts", type: "timestamp", nullable: false },
    { name: "measured_sha", type: "string", nullable: true },
    { name: "scope_paths", type: "string", nullable: true },
    { name: "session_id", type: "string", nullable: true },
    ...SUPERSESSION_FIELDS,
  ],
};

export const OBLIGATION_SPEC: EntitySpec = {
  kind: "obligation",
  identity: ["id"],
  ordering: ["id"],
  supersedable: false,
  fields: [
    { name: "id", type: "integer", nullable: false },
    { name: "statement", type: "string", nullable: false },
    {
      name: "status",
      type: "enum",
      nullable: false,
      enumValues: OBLIGATION_STATUSES,
    },
    { name: "blocker", type: "string", nullable: true },
    { name: "opened_ts", type: "timestamp", nullable: false },
    { name: "closed_ts", type: "timestamp", nullable: true },
    { name: "session_id", type: "string", nullable: true },
  ],
};

export const ENTITY_SPECS: Readonly<Record<EntityKind, EntitySpec>> = {
  session: SESSION_SPEC,
  fact: FACT_SPEC,
  measurement: MEASUREMENT_SPEC,
  obligation: OBLIGATION_SPEC,
};

/** Canonical kind order; fixes enumeration order when encoding. */
export const ENTITY_ORDER: readonly EntityKind[] = ENTITY_KINDS;

export function specFor(kind: EntityKind): EntitySpec {
  return ENTITY_SPECS[kind];
}

export type SessionRow = {
  readonly session_id: string;
  readonly started_ts: string;
  readonly start_sha: string | null;
  readonly ended_ts: string | null;
  readonly note: string | null;
};

export type FactRow = {
  readonly id: number;
  readonly statement: string;
  readonly evidence: string | null;
  readonly established_ts: string;
  readonly session_id: string | null;
  readonly superseded_by: number | null;
  readonly superseded_at: string | null;
  readonly supersede_reason: string | null;
};

export type MeasurementRow = {
  readonly id: number;
  readonly metric: string;
  readonly value: string;
  readonly value_num: number | null;
  readonly command: string | null;
  readonly measured_ts: string;
  readonly measured_sha: string | null;
  readonly scope_paths: string | null;
  readonly session_id: string | null;
  readonly superseded_by: number | null;
  readonly superseded_at: string | null;
  readonly supersede_reason: string | null;
};

export type ObligationRow = {
  readonly id: number;
  readonly statement: string;
  readonly status: ObligationStatus;
  readonly blocker: string | null;
  readonly opened_ts: string;
  readonly closed_ts: string | null;
  readonly session_id: string | null;
};

/** Next id to mint per counted kind. Part of the snapshot: allocation state is
 *  observable behaviour, so it must round-trip. */
export type NextIds = Readonly<Record<CountedKind, number>>;

export function initialNextIds(): NextIds {
  return { fact: 1, measurement: 1, obligation: 1 };
}

/**
 * A complete, backend-independent picture of session state.
 *
 * This is the unit of round-trip. It deliberately EXCLUDES the memory outbox:
 * the outbox is derived projection bookkeeping, not session content, and is
 * rebuildable. Nothing outside the projector may read it.
 */
export type SessionSnapshot = {
  readonly modelVersion: number;
  readonly nextIds: NextIds;
  readonly sessions: readonly SessionRow[];
  readonly facts: readonly FactRow[];
  readonly measurements: readonly MeasurementRow[];
  readonly obligations: readonly ObligationRow[];
};

export function emptySnapshot(): SessionSnapshot {
  return {
    modelVersion: SESSION_MODEL_VERSION,
    nextIds: initialNextIds(),
    sessions: [],
    facts: [],
    measurements: [],
    obligations: [],
  };
}

export function rowsOfKind(
  snapshot: SessionSnapshot,
  kind: EntityKind,
): readonly Record<string, unknown>[] {
  const pick =
    kind === "session"
      ? snapshot.sessions
      : kind === "fact"
        ? snapshot.facts
        : kind === "measurement"
          ? snapshot.measurements
          : snapshot.obligations;
  return pick as readonly unknown[] as readonly Record<string, unknown>[];
}

export function countRows(snapshot: SessionSnapshot): number {
  let total = 0;
  for (const kind of ENTITY_ORDER) total += rowsOfKind(snapshot, kind).length;
  return total;
}

/** Structural equality over the declared model. Used by round-trip tests. */
export function snapshotsEqual(
  a: SessionSnapshot,
  b: SessionSnapshot,
): boolean {
  if (a.modelVersion !== b.modelVersion) return false;
  for (const kind of COUNTED_KINDS) {
    if (a.nextIds[kind] !== b.nextIds[kind]) return false;
  }
  for (const kind of ENTITY_ORDER) {
    const ra = rowsOfKind(a, kind);
    const rb = rowsOfKind(b, kind);
    if (ra.length !== rb.length) return false;
    const fields = specFor(kind).fields;
    for (let i = 0; i < ra.length; i++) {
      const x = ra[i] as Record<string, unknown>;
      const y = rb[i] as Record<string, unknown>;
      for (const f of fields) {
        if (!Object.is(normaliseValue(x[f.name]), normaliseValue(y[f.name]))) {
          return false;
        }
      }
    }
  }
  return true;
}

/** -0 and 0 are the same value in this model; see sidecar canonical encoding. */
function normaliseValue(v: unknown): unknown {
  return typeof v === "number" && Object.is(v, -0) ? 0 : v;
}
