/**
 * The two storage ports, with disjoint responsibilities.
 *
 *   SessionStore  — system of record.   Synchronous, transactional, exact.
 *   MemoryIndex   — derived projection. Asynchronous, semantic, optional.
 *
 * GOVERNING INVARIANT
 * -------------------
 * The MemoryIndex is a projection of the SessionStore. It is stated as two
 * separately testable clauses, because "fully rebuilt" is not falsifiable on
 * its own: a MemoryIndex backed by an LLM-mediated service is non-deterministic,
 * so no equality test over rebuilt content can exist.
 *
 *   (I1) Re-projection completeness — every row of a snapshot can be projected
 *        without error. Rebuild restores query AVAILABILITY, not identical
 *        semantic output.
 *
 *   (I2) Correctness independence — no SessionStore operation and no core CLI
 *        command reads the MemoryIndex. The observable behaviour of the system
 *        of record is byte-identical under a MemoryIndex that is absent,
 *        throwing, hanging, or returning plausible garbage.
 *
 * I2 is the one that matters and the one that rots. The conformance suite
 * enforces it by fault injection; an import-boundary test enforces that core
 * modules do not even import this port's MemoryIndex half.
 */

import type {
  CountedKind,
  FactRow,
  MeasurementRow,
  ObligationRow,
  ObligationStatus,
  SessionRow,
  SessionSnapshot,
} from "./entities.js";

// ---------------------------------------------------------------------------
// Port 1 — SessionStore (system of record)
// ---------------------------------------------------------------------------

export type NewFact = {
  readonly statement: string;
  readonly evidence: string | null;
  readonly established_ts: string;
  readonly session_id: string | null;
};

export type NewMeasurement = {
  readonly metric: string;
  readonly value: string;
  readonly value_num: number | null;
  readonly command: string | null;
  readonly measured_ts: string;
  readonly measured_sha: string | null;
  readonly scope_paths: string | null;
  readonly session_id: string | null;
};

export type NewObligation = {
  readonly statement: string;
  readonly blocker: string | null;
  readonly opened_ts: string;
  readonly session_id: string | null;
};

/**
 * Collision policy for import into a non-empty store when `force` is set.
 *
 * - `refuse` (default): destructive exact replacement of all rows.
 * - `remap`: additive merge — target rows are preserved; donor counted ids are
 *   remapped from the target's `nextIds`, and colliding donor sessions are
 *   renamed. Empty targets ignore this and always do exact import.
 */
export type IdCollisionPolicy = "refuse" | "remap";

export type ImportOptions = {
  /**
   * Required to import into a non-empty store. Without it the import refuses
   * with `store_not_empty`. With `force` and default/`refuse`, contents are
   * replaced. With `force` and `remap`, contents are merged additively.
   */
  readonly force?: boolean;
  /**
   * Default `"refuse"`. Unknown runtime values refuse with `invalid_argument`.
   * On an empty target both policies preserve donor ids and `nextIds` exactly.
   */
  readonly onIdCollision?: IdCollisionPolicy;
};

export type SupersedeResult<Row> = {
  readonly superseded: Row;
  readonly replacement: Row;
};

/**
 * The authoritative store. Every method is synchronous and either completes or
 * leaves the store unchanged — there are no partially applied operations.
 */
export interface SessionStore {
  /** Model version this store was opened against. */
  readonly modelVersion: number;

  /** Set-once project identity. Legacy unregistered stores return null. */
  projectId(): string | null;
  /** Bind project identity without changing entity rows or id counters. */
  bindProject(projectId: string): void;

  // -- reads ---------------------------------------------------------------
  snapshot(): SessionSnapshot;
  listSessions(): readonly SessionRow[];
  currentSession(): SessionRow | null;
  listFacts(): readonly FactRow[];
  listMeasurements(): readonly MeasurementRow[];
  listObligations(): readonly ObligationRow[];
  /** Next id this store would mint for `kind`, without minting it. */
  peekNextId(kind: CountedKind): number;

  // -- writes --------------------------------------------------------------
  beginSession(args: {
    readonly session_id: string;
    readonly started_ts: string;
    readonly start_sha: string | null;
    readonly note: string | null;
  }): SessionRow;
  /** Rejects if the session is already ended (`ended_ts` is set-once). */
  endSession(sessionId: string, endedTs: string): SessionRow;

  addFact(fact: NewFact): FactRow;
  addMeasurement(m: NewMeasurement): MeasurementRow;
  addObligation(o: NewObligation): ObligationRow;
  closeObligation(
    id: number,
    status: Exclude<ObligationStatus, "open">,
    closedTs: string,
  ): ObligationRow;

  /**
   * Insert `replacement` and mark `id` superseded by it, atomically.
   * Rejects if `id` is already superseded (supersession columns are set-once).
   */
  supersedeFact(
    id: number,
    replacement: NewFact,
    reason: string | null,
    at: string,
  ): SupersedeResult<FactRow>;
  supersedeMeasurement(
    id: number,
    replacement: NewMeasurement,
    reason: string | null,
    at: string,
  ): SupersedeResult<MeasurementRow>;

  /**
   * Mark `id` superseded by the ALREADY EXISTING measurement `byId`.
   *
   * Distinct from supersedeMeasurement, which inserts a replacement. One fresh
   * full-suite reading retires several stale ones, so fan-in onto `byId` is
   * legal: N rows may name the same successor. Only the inverse question
   * ("what did Y supersede") is one-to-many; each row still carries a single
   * superseded_by.
   *
   * Returns the retired row, not a SupersedeResult: no replacement is created,
   * and a `replacement` field holding an untouched pre-existing row would be
   * false.
   */
  retireMeasurement(
    id: number,
    byId: number,
    reason: string | null,
    at: string,
  ): MeasurementRow;

  // -- snapshot transfer ---------------------------------------------------
  /**
   * Import `snapshot` under the ImportOptions policy matrix.
   *
   * Empty target: exact replacement for both collision policies (donor ids and
   * `nextIds` preserved). Non-empty without `force`: `store_not_empty`.
   * Non-empty with `force`+`refuse`: destructive exact replacement.
   * Non-empty with `force`+`remap`: additive merge; returns `countRows(donor)`.
   * All-or-nothing: any validation or integrity failure leaves the store as it
   * was.
   */
  importSnapshot(snapshot: SessionSnapshot, opts?: ImportOptions): number;

  // -- projection outbox ---------------------------------------------------
  /**
   * Oldest pending projection work, up to `limit`.
   * `limit` must be a positive safe integer in 1..1000.
   * Returned entries are defensive copies; receipts are opaque versions.
   */
  listOutbox(limit: number): readonly OutboxEntry[];

  /**
   * Atomically acknowledge exact receipt versions. Deduplicates receipts,
   * ignores unknown and stale versions, and returns the number deleted.
   * A receipt identifies one version only: a newer coalesced replacement
   * survives a stale ack (compare-and-delete).
   */
  ackOutbox(receipts: readonly string[]): number;

  // -- lifecycle -----------------------------------------------------------
  close(): void;
}

// ---------------------------------------------------------------------------
// Port 2 — MemoryIndex (derived projection)
// ---------------------------------------------------------------------------

/**
 * A reference to an entity in the system of record.
 *
 * The MemoryIndex returns references, never authoritative content. Consumers
 * rehydrate current truth from the SessionStore. This is what prevents
 * stale-recall poisoning: a superseded fact still sitting in the index cannot
 * be acted on, because its content is not what the index hands back.
 */
export type EntityRef = {
  readonly project_id: string;
  readonly kind: CountedKind;
  readonly id: number;
  /** Opaque relevance score from the backend; advisory only. */
  readonly score: number;
};

export type ProjectionMutation = "upsert" | "retract";

/**
 * Desired-state projection unit.
 *
 * `key` is the stable adapter identity `${kind}:${id}`. Mutation is a field,
 * not part of the key — so a timeout after a remote apply and before local ack
 * retries the same desired-state identity (durable at-least-once).
 */
export type ProjectionRecord =
  | {
      /** Absent only for a legacy projection created before registration. */
      readonly project_id?: string;
      readonly key: string;
      readonly kind: CountedKind;
      readonly id: number;
      readonly projection_version: number;
      readonly mutation: "upsert";
      readonly text: string;
    }
  | {
      /** Absent only for a legacy projection created before registration. */
      readonly project_id?: string;
      readonly key: string;
      readonly kind: CountedKind;
      readonly id: number;
      readonly projection_version: number;
      readonly mutation: "retract";
    };

/**
 * One pending outbox version.
 *
 * `receipt` is an opaque compare-and-delete version for local ack. It is not
 * the adapter idempotency key — that role belongs to `record.key`.
 */
export type OutboxEntry = {
  readonly receipt: string;
  readonly record: ProjectionRecord;
};

/**
 * The semantic recall surface. Every method is asynchronous and may fail.
 *
 * NOTHING in the system of record may call these. Foreman must be fully
 * functional with `NullMemoryIndex`, offline, and without credentials.
 */
export interface MemoryIndex {
  readonly name: string;
  project(records: readonly ProjectionRecord[]): Promise<void>;
  recall(query: string, limit: number): Promise<readonly EntityRef[]>;
  /** Begin a fresh projection epoch; queries must exclude abandoned epochs. */
  beginEpoch(): Promise<string>;
  activateEpoch(epoch: string): Promise<void>;
}

/**
 * Fields that may leave the machine.
 *
 * `evidence`, `command`, `scope_paths`, `start_sha` and `note` routinely carry
 * absolute paths, hostnames and pasted credentials. Projecting them verbatim to
 * a third-party LLM endpoint is a confidentiality regression against a local
 * SQLite file, so they are excluded by default.
 */
export const PROJECTABLE_FIELDS: Readonly<Record<CountedKind, readonly string[]>> =
  {
    fact: ["statement"],
    measurement: ["metric", "value"],
    obligation: ["statement", "status"],
  };
