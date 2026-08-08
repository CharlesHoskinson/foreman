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

/** Behaviour when an imported id already exists in a non-empty store. */
export type IdCollisionPolicy = "refuse" | "remap";

export type ImportOptions = {
  /** Replace existing rows. Without this an import into a non-empty store is refused. */
  readonly force?: boolean;
  /** Default "refuse". "remap" mints fresh ids and rewrites superseded_by pointers. */
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

  // -- snapshot transfer ---------------------------------------------------
  /**
   * Replace store contents with `snapshot`. All-or-nothing: on any validation
   * or integrity failure the store is left exactly as it was.
   * Returns the number of rows written.
   */
  importSnapshot(snapshot: SessionSnapshot, opts?: ImportOptions): number;

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
  readonly kind: CountedKind;
  readonly id: number;
  /** Opaque relevance score from the backend; advisory only. */
  readonly score: number;
};

export type ProjectionRecord = {
  /** Stable idempotency key: `${kind}:${id}:${mutation}`. */
  readonly key: string;
  readonly kind: CountedKind;
  readonly id: number;
  /** Projectable text only. Redaction happens before this point. */
  readonly text: string;
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
