/**
 * SQLite implementation of the SessionStore port.
 *
 * Three things differ from the pre-port code this replaces:
 *
 * 1. Ids are minted by the port from persisted counters in `store_meta`.
 *    The columns are plain `INTEGER PRIMARY KEY` — no AUTOINCREMENT — so the
 *    backend never assigns identity and allocation state round-trips.
 *
 * 2. The schema is validated AGAINST entities.ts at open. Previously the
 *    portable contract was whatever `sqlite_schema` happened to say; now drift
 *    is an error at startup rather than a silent redefinition of the contract.
 *
 * 3. Foreign keys are ON, with `defer_foreign_keys` inside the import
 *    transaction so a forward `superseded_by` pointer can be satisfied by a row
 *    written later in the same transaction.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  COUNTED_KINDS,
  ENTITY_ORDER,
  SESSION_MODEL_VERSION,
  countRows,
  emptySnapshot,
  initialNextIds,
  rowsOfKind,
  specFor,
  type CountedKind,
  type EntityKind,
  type FactRow,
  type MeasurementRow,
  type NextIds,
  type ObligationRow,
  type ObligationStatus,
  type SessionRow,
  type SessionSnapshot,
} from "./entities.js";
import { assertIntegrity } from "./integrity.js";
import { raise } from "./failures.js";
import {
  additiveImportProjectionUpserts,
  planAdditiveRemapImport,
  resolveIdCollisionPolicy,
  snapshotIsOccupied,
} from "./import-remap.js";
import {
  buildProjection,
  isProjectIdV1,
  liveProjectionMap,
  projectionKey,
  retractRecord,
  upsertRecord,
} from "./projection.js";
import type {
  ImportOptions,
  NewFact,
  NewMeasurement,
  NewObligation,
  OutboxEntry,
  ProjectionRecord,
  SessionStore,
  SupersedeResult,
} from "./port.js";

/** Model kind -> SQLite table. Column names match field names exactly. */
const TABLE: Readonly<Record<EntityKind, string>> = {
  session: "sessions",
  fact: "facts",
  measurement: "measurements",
  obligation: "obligations",
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS store_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  started_ts TEXT NOT NULL,
  start_sha  TEXT,
  ended_ts   TEXT,
  note       TEXT
);

CREATE TABLE IF NOT EXISTS facts (
  id               INTEGER PRIMARY KEY,
  statement        TEXT NOT NULL,
  evidence         TEXT,
  established_ts   TEXT NOT NULL,
  session_id       TEXT REFERENCES sessions(session_id),
  superseded_by    INTEGER REFERENCES facts(id),
  superseded_at    TEXT,
  supersede_reason TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id               INTEGER PRIMARY KEY,
  metric           TEXT NOT NULL,
  value            TEXT NOT NULL,
  value_num        REAL,
  command          TEXT,
  measured_ts      TEXT NOT NULL,
  measured_sha     TEXT,
  scope_paths      TEXT,
  session_id       TEXT REFERENCES sessions(session_id),
  superseded_by    INTEGER REFERENCES measurements(id),
  superseded_at    TEXT,
  supersede_reason TEXT
);

CREATE TABLE IF NOT EXISTS obligations (
  id         INTEGER PRIMARY KEY,
  statement  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  blocker    TEXT,
  opened_ts  TEXT NOT NULL,
  closed_ts  TEXT,
  session_id TEXT REFERENCES sessions(session_id)
);

-- Derived projection bookkeeping. Written in the same transaction as the row
-- it describes. Deliberately NOT part of SessionSnapshot: it is rebuildable and
-- nothing outside the projector may read it.
--
-- position is stable across coalescing (hot entities keep their queue place).
-- receipt is a fresh compare-and-delete version per desired-state change.
-- UNIQUE(kind, entity_id) coalesces pending work by desired-state identity.
CREATE TABLE IF NOT EXISTS memory_outbox (
  position  INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt   TEXT NOT NULL UNIQUE,
  kind      TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  mutation  TEXT NOT NULL,
  text      TEXT,
  UNIQUE(kind, entity_id)
);

CREATE TABLE IF NOT EXISTS memory_projection_versions (
  kind      TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  version   INTEGER NOT NULL,
  PRIMARY KEY(kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_meas_metric ON measurements(metric);
CREATE INDEX IF NOT EXISTS idx_oblig_status ON obligations(status);
CREATE INDEX IF NOT EXISTS idx_facts_superseded ON facts(superseded_by);
`;

const OUTBOX_LIMIT_MIN = 1;
const OUTBOX_LIMIT_MAX = 1000;

type OutboxColumnInfo = { readonly name: string };

function outboxColumnNames(db: DatabaseSync): Set<string> {
  const info = db.prepare("PRAGMA table_info(memory_outbox)").all() as OutboxColumnInfo[];
  return new Set(info.map((c) => c.name));
}

function isLegacyOutboxSchema(cols: Set<string>): boolean {
  return cols.has("key") && cols.has("queued_ts") && !cols.has("receipt");
}

function isCurrentOutboxSchema(cols: Set<string>): boolean {
  return (
    cols.has("position") &&
    cols.has("receipt") &&
    cols.has("kind") &&
    cols.has("entity_id") &&
    cols.has("mutation") &&
    cols.has("text")
  );
}

/** Internal numeric receipt form: r followed by a positive decimal (no leading zeros). */
const INTERNAL_NUMERIC_RECEIPT = /^r([1-9][0-9]*)$/;

/**
 * Canonical positive base-10 safe-integer string for store_meta next_receipt.
 * Rejects whitespace, signs, fractions, exponents, leading zeros, zero, and
 * values outside 1..Number.MAX_SAFE_INTEGER.
 */
function parseCanonicalNextReceipt(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  // Reject non-canonical Number parsing (precision loss on over-long digit runs).
  if (String(n) !== raw) return null;
  return n;
}

function maxInternalNumericReceipt(receipts: readonly string[]): number {
  let max = 0;
  for (const receipt of receipts) {
    const m = INTERNAL_NUMERIC_RECEIPT.exec(receipt);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isSafeInteger(n) && n > max) max = n;
  }
  return max;
}

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

export type SqliteStoreOptions = {
  /** Skip the open-time schema drift check. Tests only. */
  readonly skipSchemaCheck?: boolean;
  /**
   * Open the underlying connection read-only. The caller is asserting the
   * store already exists and is already schema-correct: the WAL/synchronous
   * pragmas and the CREATE-TABLE-IF-NOT-EXISTS schema exec, which write when
   * a plain connection is merely opened and closed against a store with
   * un-checkpointed WAL frames, are skipped rather than attempted and failed.
   */
  readonly readOnly?: boolean;
};

export class SqliteSessionStore implements SessionStore {
  readonly modelVersion = SESSION_MODEL_VERSION;
  private readonly db: DatabaseSync;
  private readonly readOnly: boolean;
  private closed = false;

  constructor(db: DatabaseSync, opts: SqliteStoreOptions = {}) {
    this.db = db;
    this.readOnly = opts.readOnly === true;
    if (!opts.skipSchemaCheck) this.assertSchemaMatchesModel();
    if (!this.readOnly) {
      this.ensureCounters();
      this.migrateOutboxIfNeeded();
      this.migrateProjectionVersionsIfNeeded();
    } else {
      // Read-only opens must not mutate. Counters are only needed for writes.
      // Legacy outbox is tolerated until listOutbox is called.
      this.projectionVersions();
    }
  }

  // -- construction --------------------------------------------------------

  static open(path: string, opts: SqliteStoreOptions = {}): SqliteSessionStore {
    if (opts.readOnly) {
      // No parent-directory creation and no pragma/DDL that could write: a
      // plain connection here would checkpoint an outstanding WAL as a side
      // effect of merely being opened and closed, which is exactly the write
      // a read-only caller must not cause.
      const db = new DatabaseSync(path, { readOnly: true });
      db.exec("PRAGMA busy_timeout=5000");
      return new SqliteSessionStore(db, opts);
    }
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    // journal_mode=WAL takes a lock. busy_timeout must be live before that
    // lock is requested, or a concurrent open fails instantly with
    // SQLITE_BUSY. The existing busy-timeout test never enters this window.
    db.exec("PRAGMA busy_timeout=5000");
    db.exec("PRAGMA foreign_keys=ON");
    // WAL lets readers run while a writer holds the write lock. AGENT_TRAPS.md:22
    // documents concurrent writers as normal operation, so the rollback-journal
    // default is a live hazard, not a theoretical one.
    db.exec("PRAGMA journal_mode=WAL");
    // NORMAL is durable across process crashes, which is the failure mode that
    // actually happens here. It trades only the last transaction on power loss.
    db.exec("PRAGMA synchronous=NORMAL");
    db.exec(SCHEMA);
    return new SqliteSessionStore(db, opts);
  }

  /**
   * Migrate pre-release memory_outbox(key, kind, entity_id, mutation, queued_ts)
   * to the durable receipt/position schema. Idempotent. Prefer seeding from
   * live entities because no external adapter shipped before sync.
   */
  private migrateOutboxIfNeeded(): void {
    const cols = outboxColumnNames(this.db);
    if (cols.size === 0) {
      raise(
        "backend_mismatch",
        "memory_outbox table is missing; cannot open writable store",
      );
    }
    if (isCurrentOutboxSchema(cols)) {
      this.ensureReceiptCounter();
      return;
    }
    if (!isLegacyOutboxSchema(cols)) {
      raise(
        "backend_mismatch",
        "memory_outbox schema is not recognized; refusing writable open",
      );
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DROP TABLE IF EXISTS memory_outbox");
      this.db.exec("DELETE FROM memory_projection_versions");
      this.db.exec(`
CREATE TABLE memory_outbox (
  position  INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt   TEXT NOT NULL UNIQUE,
  kind      TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  mutation  TEXT NOT NULL,
  text      TEXT,
  UNIQUE(kind, entity_id)
);`);
      // Reset any legacy/stale/malformed counter before seeding projections.
      this.db
        .prepare(
          "INSERT INTO store_meta (key, value) VALUES (?, ?) " +
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run("next_receipt", "1");
      // Seed one active upsert per current live entity.
      const snap = this.readSnapshot();
      for (const rec of buildProjection(snap, this.projectId())) {
        this.queueRecord(rec);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw e;
    }
  }

  private projectionVersions(): Map<string, number> {
    const table = this.db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?",
      )
      .get("memory_projection_versions");
    if (table === undefined) {
      raise(
        "backend_mismatch",
        "projection versions are missing; reopen writable to migrate",
      );
    }
    const rows = this.db
      .prepare(
        "SELECT kind, entity_id, version FROM memory_projection_versions " +
          "ORDER BY CASE kind WHEN 'fact' THEN 1 WHEN 'measurement' THEN 2 ELSE 3 END, entity_id",
      )
      .all() as Array<Record<string, unknown>>;
    const versions = new Map<string, number>();
    for (const row of rows) {
      const kind = row["kind"];
      const entityId = Number(row["entity_id"]);
      const version = Number(row["version"]);
      if (
        (kind !== "fact" && kind !== "measurement" && kind !== "obligation") ||
        !Number.isSafeInteger(entityId) ||
        entityId < 1 ||
        !Number.isSafeInteger(version) ||
        version < 1
      ) {
        raise("backend_mismatch", "projection version state is malformed");
      }
      versions.set(projectionKey(kind, entityId), version);
    }
    return versions;
  }

  /** Assign retained versions to legacy live rows in canonical projection order. */
  private migrateProjectionVersionsIfNeeded(): void {
    const live = buildProjection(this.readSnapshot(), this.projectId());
    const versions = this.projectionVersions();
    const missing = live.filter(
      (record) => !versions.has(projectionKey(record.kind, record.id)),
    );
    if (missing.length === 0) return;
    this.tx(() => {
      for (const record of missing) this.queueRecord(record);
    });
  }

  /**
   * Validate store_meta.next_receipt for the current outbox schema.
   * Missing + empty outbox → initialize to 1. Missing + pending → refuse.
   * MAX_SAFE_INTEGER is a valid readable exhausted state.
   */
  private ensureReceiptCounter(): void {
    const row = this.db
      .prepare("SELECT value FROM store_meta WHERE key = ?")
      .get("next_receipt") as { value: string } | undefined;
    const pending = this.db
      .prepare("SELECT receipt FROM memory_outbox")
      .all() as { receipt: string }[];

    if (row === undefined) {
      if (pending.length > 0) {
        raise(
          "backend_mismatch",
          "next_receipt is missing while memory_outbox has pending entries",
        );
      }
      this.db
        .prepare("INSERT INTO store_meta (key, value) VALUES (?, ?)")
        .run("next_receipt", "1");
      return;
    }

    if (typeof row.value !== "string") {
      raise("backend_mismatch", "next_receipt must be a canonical integer string");
    }
    const n = parseCanonicalNextReceipt(row.value);
    if (n === null) {
      raise(
        "backend_mismatch",
        "next_receipt must be a canonical positive safe integer string",
      );
    }
    const maxReceipt = maxInternalNumericReceipt(pending.map((r) => r.receipt));
    if (n <= maxReceipt) {
      raise(
        "backend_mismatch",
        "next_receipt must be strictly greater than every numeric receipt",
      );
    }
  }

  /**
   * Compare the live SQLite schema to the declared model and fail on drift.
   * This is the check whose absence let the old code treat `sqlite_schema` as
   * the contract.
   */
  private assertSchemaMatchesModel(): void {
    for (const kind of ENTITY_ORDER) {
      const table = TABLE[kind];
      const info = this.db
        .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
        .all() as { name: string }[];
      const actual = new Set(info.map((r) => r.name));
      const declared = specFor(kind).fields.map((f) => f.name);
      const missing = declared.filter((f) => !actual.has(f));
      const extra = [...actual].filter((c) => !declared.includes(c));
      if (missing.length > 0 || extra.length > 0) {
        raise(
          "backend_mismatch",
          `table ${table} does not match the model ` +
            `(missing=[${missing.join(", ")}], extra=[${extra.join(", ")}])`,
          { kind },
        );
      }
    }
  }

  private ensureCounters(): void {
    const init = initialNextIds();
    for (const kind of COUNTED_KINDS) {
      const key = `next_id.${kind}`;
      const row = this.db
        .prepare("SELECT value FROM store_meta WHERE key = ?")
        .get(key) as { value: string } | undefined;
      if (row === undefined) {
        this.db
          .prepare("INSERT OR IGNORE INTO store_meta (key, value) VALUES (?, ?)")
          .run(key, String(init[kind]));
      }
    }
  }

  // -- transaction helper --------------------------------------------------

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // rollback of an already-aborted transaction is not itself an error
      }
      throw e;
    }
  }

  // -- identity ------------------------------------------------------------

  projectId(): string | null {
    const row = this.db
      .prepare("SELECT value FROM store_meta WHERE key = ?")
      .get("project_id") as { value: unknown } | undefined;
    if (row === undefined) return null;
    if (!isProjectIdV1(row.value)) {
      raise("backend_mismatch", "store project_id is malformed");
    }
    return row.value;
  }

  bindProject(projectId: string): void {
    if (this.readOnly) raise("invalid_argument", "store is read-only");
    if (!isProjectIdV1(projectId)) {
      raise("invalid_argument", "project id must be a lowercase UUID");
    }
    this.tx(() => {
      const current = this.projectId();
      if (current !== null && current !== projectId) {
        raise("identity_conflict", "store is already bound to another project");
      }
      if (current === projectId) return;
      this.db
        .prepare("INSERT INTO store_meta (key, value) VALUES (?, ?)")
        .run("project_id", projectId);
      for (const record of buildProjection(this.readSnapshot(), projectId)) {
        this.queueRecord(record);
      }
    });
  }

  peekNextId(kind: CountedKind): number {
    const row = this.db
      .prepare("SELECT value FROM store_meta WHERE key = ?")
      .get(`next_id.${kind}`) as { value: string } | undefined;
    return row ? Number(row.value) : 1;
  }

  /** Mint the next id for `kind`. Must be called inside a transaction. */
  private mintId(kind: CountedKind): number {
    const id = this.peekNextId(kind);
    this.db
      .prepare("UPDATE store_meta SET value = ? WHERE key = ?")
      .run(String(id + 1), `next_id.${kind}`);
    return id;
  }

  private setNextIds(next: NextIds): void {
    for (const kind of COUNTED_KINDS) {
      this.db
        .prepare("UPDATE store_meta SET value = ? WHERE key = ?")
        .run(String(next[kind]), `next_id.${kind}`);
    }
  }

  /** Mint a fresh receipt version. Must run inside a write transaction. */
  private mintReceipt(): { readonly receipt: string; readonly version: number } {
    const row = this.db
      .prepare("SELECT value FROM store_meta WHERE key = ?")
      .get("next_receipt") as { value: string } | undefined;
    if (row === undefined || typeof row.value !== "string") {
      raise("backend_mismatch", "next_receipt is missing or malformed");
    }
    const n = parseCanonicalNextReceipt(row.value);
    if (n === null) {
      raise(
        "backend_mismatch",
        "next_receipt must be a canonical positive safe integer string",
      );
    }
    if (n >= Number.MAX_SAFE_INTEGER) {
      raise("invalid_argument", "outbox nextReceipt is exhausted");
    }
    const receipt = `r${n}`;
    this.db
      .prepare(
        "INSERT INTO store_meta (key, value) VALUES (?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run("next_receipt", String(n + 1));
    return { receipt, version: n };
  }

  /**
   * Coalesce pending desired state by (kind, id). A replacement gets a fresh
   * receipt but keeps the original queue position so hot entities cannot starve.
   * Must run inside the same transaction as the authoritative entity mutation.
   */
  private queueRecord(record: ProjectionRecord): void {
    const existing = this.db
      .prepare(
        "SELECT position FROM memory_outbox WHERE kind = ? AND entity_id = ?",
      )
      .get(record.kind, record.id) as { position: number } | undefined;
    const minted = this.mintReceipt();
    const receipt = minted.receipt;
    const text = record.mutation === "upsert" ? record.text : null;
    this.db
      .prepare(
        "INSERT INTO memory_projection_versions (kind, entity_id, version) " +
          "VALUES (?, ?, ?) ON CONFLICT(kind, entity_id) DO UPDATE SET version = excluded.version",
      )
      .run(record.kind, record.id, minted.version);
    if (existing) {
      this.db
        .prepare(
          "UPDATE memory_outbox SET receipt = ?, mutation = ?, text = ? " +
            "WHERE kind = ? AND entity_id = ?",
        )
        .run(receipt, record.mutation, text, record.kind, record.id);
      return;
    }
    this.db
      .prepare(
        "INSERT INTO memory_outbox (receipt, kind, entity_id, mutation, text) " +
          "VALUES (?, ?, ?, ?, ?)",
      )
      .run(receipt, record.kind, record.id, record.mutation, text);
  }

  private queueUpsert(
    kind: CountedKind,
    id: number,
    row: Readonly<Record<string, unknown>>,
  ): void {
    this.queueRecord(upsertRecord(kind, id, row, this.projectId()));
  }

  private queueRetract(kind: CountedKind, id: number): void {
    this.queueRecord(retractRecord(kind, id, this.projectId()));
  }

  private assertOutboxReadable(): void {
    const cols = outboxColumnNames(this.db);
    if (cols.size === 0) {
      raise(
        "backend_mismatch",
        "memory_outbox table is missing; cannot list projection work",
      );
    }
    if (isLegacyOutboxSchema(cols)) {
      raise(
        "backend_mismatch",
        "memory_outbox is the pre-release schema; reopen writable to migrate before listing",
      );
    }
    if (!isCurrentOutboxSchema(cols)) {
      raise(
        "backend_mismatch",
        "memory_outbox schema is not recognized; cannot list projection work",
      );
    }
  }

  private decodeOutboxRow(r: Record<string, unknown>): OutboxEntry {
    const kindRaw = r["kind"];
    if (
      kindRaw !== "fact" &&
      kindRaw !== "measurement" &&
      kindRaw !== "obligation"
    ) {
      raise("backend_mismatch", "outbox row kind is invalid");
    }
    const kind = kindRaw;
    const idRaw = r["entity_id"];
    const id =
      typeof idRaw === "number"
        ? idRaw
        : typeof idRaw === "bigint"
          ? Number(idRaw)
          : Number(idRaw);
    if (!Number.isSafeInteger(id)) {
      raise("backend_mismatch", "outbox row entity_id must be a safe integer");
    }
    const receipt = r["receipt"];
    if (typeof receipt !== "string" || receipt.length === 0) {
      raise("backend_mismatch", "outbox row receipt must be a non-empty string");
    }
    const projectionVersion = Number(r["projection_version"]);
    if (
      projectionVersion === null ||
      !Number.isSafeInteger(projectionVersion) ||
      projectionVersion < 1
    ) {
      raise(
        "backend_mismatch",
        "outbox projection version is invalid",
      );
    }
    const projectId = this.projectId();
    const key = projectionKey(kind, id, projectId);
    const project = projectId === null ? {} : { project_id: projectId };
    const mutation = r["mutation"];
    if (mutation === "retract") {
      return {
        receipt,
        record: {
          ...project,
          key,
          kind,
          id,
          projection_version: projectionVersion,
          mutation: "retract",
        },
      };
    }
    if (mutation === "upsert") {
      if (typeof r["text"] !== "string") {
        raise("backend_mismatch", "outbox upsert text must be a string");
      }
      return {
        receipt,
        record: {
          ...project,
          key,
          kind,
          id,
          projection_version: projectionVersion,
          mutation: "upsert",
          text: r["text"],
        },
      };
    }
    raise(
      "backend_mismatch",
      `outbox mutation ${String(mutation)} is not upsert or retract`,
    );
  }

  listOutbox(limit: number): readonly OutboxEntry[] {
    if (
      typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit < OUTBOX_LIMIT_MIN ||
      limit > OUTBOX_LIMIT_MAX
    ) {
      raise(
        "invalid_argument",
        `listOutbox limit must be an integer in ${OUTBOX_LIMIT_MIN}..${OUTBOX_LIMIT_MAX}`,
      );
    }
    this.assertOutboxReadable();
    const rows = this.db
      .prepare(
        "SELECT o.receipt, o.kind, o.entity_id, o.mutation, o.text, " +
          "v.version AS projection_version FROM memory_outbox o " +
          "JOIN memory_projection_versions v " +
          "ON v.kind = o.kind AND v.entity_id = o.entity_id " +
          "ORDER BY position ASC LIMIT ?",
      )
      .all(limit) as Record<string, unknown>[];
    // Defensive copies: callers must not be able to mutate store state via the
    // returned objects.
    return rows.map((r) => this.decodeOutboxRow(r));
  }

  projectionSnapshot(): readonly ProjectionRecord[] {
    const versions = this.projectionVersions();
    return buildProjection(this.readSnapshot(), this.projectId()).map((record) => {
      const version = versions.get(projectionKey(record.kind, record.id));
      if (version === undefined) {
        raise("backend_mismatch", "a live projection version is missing");
      }
      return { ...record, projection_version: version };
    });
  }

  ackOutbox(receipts: readonly string[]): number {
    if (this.readOnly) {
      raise("invalid_argument", "store is read-only");
    }
    if (receipts.length === 0) return 0;
    const unique = [...new Set(receipts)];
    return this.tx(() => {
      let deleted = 0;
      const stmt = this.db.prepare(
        "DELETE FROM memory_outbox WHERE receipt = ?",
      );
      for (const receipt of unique) {
        const info = stmt.run(receipt) as { changes: number };
        deleted += info.changes;
      }
      return deleted;
    });
  }

  // -- reads ---------------------------------------------------------------

  private selectRows(kind: EntityKind): Record<string, unknown>[] {
    const spec = specFor(kind);
    const cols = spec.fields.map((f) => quoteIdent(f.name)).join(", ");
    const order = spec.ordering.map((f) => quoteIdent(f)).join(", ");
    const sql = `SELECT ${cols} FROM ${quoteIdent(TABLE[kind])} ORDER BY ${order}`;
    const raw = this.db.prepare(sql).all() as Record<string, unknown>[];
    // Normalise: SQLite returns absent values as null already, but be explicit
    // so every declared field is present on every row.
    return raw.map((r) => {
      const out: Record<string, unknown> = {};
      for (const f of spec.fields) out[f.name] = r[f.name] ?? null;
      return out;
    });
  }

  /**
   * A whole-store picture, read inside ONE deferred read transaction.
   *
   * The transaction is load-bearing, not decoration. Without it each table's
   * SELECT is its own read transaction, so a writer committing between two of
   * them yields a torn picture -- facts from before the write and measurements
   * from after. The canonical sidecar is encoded from this value, so a torn
   * snapshot is a torn record of truth. BEGIN (deferred), not BEGIN IMMEDIATE:
   * this takes no write lock and does not block a concurrent writer.
   */
  snapshot(): SessionSnapshot {
    this.db.exec("BEGIN");
    try {
      const out = this.readSnapshot();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // rollback of an already-aborted transaction is not itself an error
      }
      throw e;
    }
  }

  private readSnapshot(): SessionSnapshot {
    const nextIds: Record<string, number> = {};
    for (const kind of COUNTED_KINDS) nextIds[kind] = this.peekNextId(kind);
    return {
      modelVersion: this.modelVersion,
      nextIds: nextIds as unknown as NextIds,
      sessions: this.selectRows("session") as unknown as readonly SessionRow[],
      facts: this.selectRows("fact") as unknown as readonly FactRow[],
      measurements: this.selectRows(
        "measurement",
      ) as unknown as readonly MeasurementRow[],
      obligations: this.selectRows(
        "obligation",
      ) as unknown as readonly ObligationRow[],
    };
  }

  listSessions(): readonly SessionRow[] {
    return this.selectRows("session") as unknown as readonly SessionRow[];
  }

  listFacts(): readonly FactRow[] {
    return this.selectRows("fact") as unknown as readonly FactRow[];
  }

  listMeasurements(): readonly MeasurementRow[] {
    return this.selectRows("measurement") as unknown as readonly MeasurementRow[];
  }

  listObligations(): readonly ObligationRow[] {
    return this.selectRows("obligation") as unknown as readonly ObligationRow[];
  }

  currentSession(): SessionRow | null {
    const r = this.db
      .prepare(
        "SELECT session_id, started_ts, start_sha, ended_ts, note FROM sessions " +
          "WHERE ended_ts IS NULL ORDER BY session_id DESC LIMIT 1",
      )
      .get() as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      session_id: r["session_id"] as string,
      started_ts: r["started_ts"] as string,
      start_sha: (r["start_sha"] ?? null) as string | null,
      ended_ts: (r["ended_ts"] ?? null) as string | null,
      note: (r["note"] ?? null) as string | null,
    };
  }

  // -- writes --------------------------------------------------------------

  beginSession(args: {
    readonly session_id: string;
    readonly started_ts: string;
    readonly start_sha: string | null;
    readonly note: string | null;
  }): SessionRow {
    return this.tx(() => {
      this.db
        .prepare(
          "INSERT INTO sessions (session_id, started_ts, start_sha, ended_ts, note) " +
            "VALUES (?, ?, ?, NULL, ?)",
        )
        .run(args.session_id, args.started_ts, args.start_sha, args.note);
      return {
        session_id: args.session_id,
        started_ts: args.started_ts,
        start_sha: args.start_sha,
        ended_ts: null,
        note: args.note,
      };
    });
  }

  endSession(sessionId: string, endedTs: string): SessionRow {
    return this.tx(() => {
      const existing = this.db
        .prepare("SELECT session_id, ended_ts FROM sessions WHERE session_id = ?")
        .get(sessionId) as { session_id: string; ended_ts: string | null } | undefined;
      if (!existing) {
        raise("invalid_argument", `no such session ${JSON.stringify(sessionId)}`);
      }
      if (existing.ended_ts !== null) {
        raise(
          "supersession_incomplete",
          `session ${JSON.stringify(sessionId)} is already ended; ended_ts is set-once`,
        );
      }
      this.db
        .prepare("UPDATE sessions SET ended_ts = ? WHERE session_id = ?")
        .run(endedTs, sessionId);
      const r = this.db
        .prepare(
          "SELECT session_id, started_ts, start_sha, ended_ts, note FROM sessions WHERE session_id = ?",
        )
        .get(sessionId) as Record<string, unknown>;
      return {
        session_id: r["session_id"] as string,
        started_ts: r["started_ts"] as string,
        start_sha: (r["start_sha"] ?? null) as string | null,
        ended_ts: (r["ended_ts"] ?? null) as string | null,
        note: (r["note"] ?? null) as string | null,
      };
    });
  }

  addFact(fact: NewFact): FactRow {
    return this.tx(() => this.insertFact(fact));
  }

  private insertFact(fact: NewFact): FactRow {
    const id = this.mintId("fact");
    this.db
      .prepare(
        "INSERT INTO facts (id, statement, evidence, established_ts, session_id, " +
          "superseded_by, superseded_at, supersede_reason) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)",
      )
      .run(id, fact.statement, fact.evidence, fact.established_ts, fact.session_id);
    const row: FactRow = {
      id,
      statement: fact.statement,
      evidence: fact.evidence,
      established_ts: fact.established_ts,
      session_id: fact.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null,
    };
    this.queueUpsert("fact", id, row as unknown as Record<string, unknown>);
    return row;
  }

  addMeasurement(m: NewMeasurement): MeasurementRow {
    return this.tx(() => this.insertMeasurement(m));
  }

  private insertMeasurement(m: NewMeasurement): MeasurementRow {
    if (m.value_num !== null && !Number.isFinite(m.value_num)) {
      raise("field_type", `value_num must be finite, got ${String(m.value_num)}`);
    }
    const id = this.mintId("measurement");
    this.db
      .prepare(
        "INSERT INTO measurements (id, metric, value, value_num, command, measured_ts, " +
          "measured_sha, scope_paths, session_id, superseded_by, superseded_at, supersede_reason) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
      )
      .run(
        id,
        m.metric,
        m.value,
        m.value_num,
        m.command,
        m.measured_ts,
        m.measured_sha,
        m.scope_paths,
        m.session_id,
      );
    const row: MeasurementRow = {
      id,
      metric: m.metric,
      value: m.value,
      value_num: m.value_num,
      command: m.command,
      measured_ts: m.measured_ts,
      measured_sha: m.measured_sha,
      scope_paths: m.scope_paths,
      session_id: m.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null,
    };
    this.queueUpsert("measurement", id, row as unknown as Record<string, unknown>);
    return row;
  }

  addObligation(o: NewObligation): ObligationRow {
    return this.tx(() => {
      const id = this.mintId("obligation");
      this.db
        .prepare(
          "INSERT INTO obligations (id, statement, status, blocker, opened_ts, closed_ts, session_id) " +
            "VALUES (?, ?, 'open', ?, ?, NULL, ?)",
        )
        .run(id, o.statement, o.blocker, o.opened_ts, o.session_id);
      const row: ObligationRow = {
        id,
        statement: o.statement,
        status: "open" as ObligationStatus,
        blocker: o.blocker,
        opened_ts: o.opened_ts,
        closed_ts: null,
        session_id: o.session_id,
      };
      this.queueUpsert("obligation", id, row as unknown as Record<string, unknown>);
      return row;
    });
  }

  closeObligation(
    id: number,
    status: Exclude<ObligationStatus, "open">,
    closedTs: string,
  ): ObligationRow {
    return this.tx(() => {
      const cur = this.db
        .prepare("SELECT status FROM obligations WHERE id = ?")
        .get(id) as { status: string } | undefined;
      if (!cur) raise("invalid_argument", `no such obligation ${id}`);
      if (cur.status !== "open") {
        raise(
          "invalid_argument",
          `obligation ${id} is already ${cur.status}; only an open obligation may be closed`,
        );
      }
      this.db
        .prepare("UPDATE obligations SET status = ?, closed_ts = ? WHERE id = ?")
        .run(status, closedTs, id);
      const r = this.db
        .prepare(
          "SELECT id, statement, status, blocker, opened_ts, closed_ts, session_id FROM obligations WHERE id = ?",
        )
        .get(id) as Record<string, unknown>;
      const row: ObligationRow = {
        id: r["id"] as number,
        statement: r["statement"] as string,
        status: r["status"] as ObligationStatus,
        blocker: (r["blocker"] ?? null) as string | null,
        opened_ts: r["opened_ts"] as string,
        closed_ts: (r["closed_ts"] ?? null) as string | null,
        session_id: (r["session_id"] ?? null) as string | null,
      };
      this.queueUpsert("obligation", id, row as unknown as Record<string, unknown>);
      return row;
    });
  }

  supersedeFact(
    id: number,
    replacement: NewFact,
    reason: string | null,
    at: string,
  ): SupersedeResult<FactRow> {
    return this.tx(() => {
      const cur = this.db
        .prepare("SELECT superseded_by FROM facts WHERE id = ?")
        .get(id) as { superseded_by: number | null } | undefined;
      if (!cur) raise("invalid_argument", `no such fact ${id}`);
      if (cur.superseded_by !== null) {
        raise(
          "supersession_incomplete",
          `fact ${id} is already superseded; supersession columns are set-once`,
        );
      }
      const next = this.insertFact(replacement);
      this.db
        .prepare(
          "UPDATE facts SET superseded_by = ?, superseded_at = ?, supersede_reason = ? WHERE id = ?",
        )
        .run(next.id, at, reason, id);
      this.queueRetract("fact", id);
      const old = this.db
        .prepare(
          "SELECT id, statement, evidence, established_ts, session_id, superseded_by, superseded_at, supersede_reason FROM facts WHERE id = ?",
        )
        .get(id) as unknown as FactRow;
      return { superseded: old, replacement: next };
    });
  }

  supersedeMeasurement(
    id: number,
    replacement: NewMeasurement,
    reason: string | null,
    at: string,
  ): SupersedeResult<MeasurementRow> {
    return this.tx(() => {
      const cur = this.db
        .prepare("SELECT superseded_by FROM measurements WHERE id = ?")
        .get(id) as { superseded_by: number | null } | undefined;
      if (!cur) raise("invalid_argument", `no such measurement ${id}`);
      if (cur.superseded_by !== null) {
        raise(
          "supersession_incomplete",
          `measurement ${id} is already superseded; supersession columns are set-once`,
        );
      }
      const next = this.insertMeasurement(replacement);
      this.db
        .prepare(
          "UPDATE measurements SET superseded_by = ?, superseded_at = ?, supersede_reason = ? WHERE id = ?",
        )
        .run(next.id, at, reason, id);
      this.queueRetract("measurement", id);
      const old = this.db
        .prepare(
          "SELECT id, metric, value, value_num, command, measured_ts, measured_sha, scope_paths, session_id, superseded_by, superseded_at, supersede_reason FROM measurements WHERE id = ?",
        )
        .get(id) as unknown as MeasurementRow;
      return { superseded: old, replacement: next };
    });
  }

  retireMeasurement(
    id: number,
    byId: number,
    reason: string | null,
    at: string,
  ): MeasurementRow {
    return this.tx(() => {
      if (byId === id) {
        raise("invalid_argument", `measurement ${id} cannot supersede itself`);
      }
      const cur = this.db
        .prepare("SELECT superseded_by FROM measurements WHERE id = ?")
        .get(id) as { superseded_by: number | null } | undefined;
      if (!cur) raise("invalid_argument", `no such measurement ${id}`);
      if (cur.superseded_by !== null) {
        raise(
          "supersession_incomplete",
          `measurement ${id} is already superseded; supersession columns are set-once`,
        );
      }
      const by = this.db
        .prepare("SELECT superseded_by FROM measurements WHERE id = ?")
        .get(byId) as { superseded_by: number | null } | undefined;
      if (!by) raise("invalid_argument", `no such measurement ${byId}`);
      if (by.superseded_by !== null) {
        raise(
          "invalid_argument",
          `measurement ${byId} is itself superseded by ${by.superseded_by}; a retired measurement cannot supersede another`,
        );
      }
      this.db
        .prepare(
          "UPDATE measurements SET superseded_by = ?, superseded_at = ?, supersede_reason = ? WHERE id = ?",
        )
        .run(byId, at, reason, id);
      this.queueRetract("measurement", id);
      return this.db
        .prepare(
          "SELECT id, metric, value, value_num, command, measured_ts, measured_sha, scope_paths, session_id, superseded_by, superseded_at, supersede_reason FROM measurements WHERE id = ?",
        )
        .get(id) as unknown as MeasurementRow;
    });
  }

  // -- snapshot transfer ---------------------------------------------------

  importSnapshot(snapshot: SessionSnapshot, opts: ImportOptions = {}): number {
    if (this.readOnly) {
      raise("invalid_argument", "store is read-only");
    }
    // Validate BEFORE opening a transaction so a bad snapshot cannot touch the store.
    assertIntegrity(snapshot);
    if (snapshot.modelVersion !== this.modelVersion) {
      raise(
        "model_version_unsupported",
        `snapshot model version ${snapshot.modelVersion} != store ${this.modelVersion}`,
      );
    }

    const force = opts.force ?? false;
    const policy = resolveIdCollisionPolicy(opts.onIdCollision);

    return this.tx(() => {
      this.db.exec("PRAGMA defer_foreign_keys=ON");

      const target = this.readSnapshot();
      const occupied = snapshotIsOccupied(target);
      if (occupied && !force) {
        raise(
          "store_not_empty",
          "target store already has rows; pass force to replace it",
        );
      }

      if (occupied && policy === "remap") {
        if (countRows(snapshot) === 0) return 0;
        const plan = planAdditiveRemapImport(target, snapshot);
        this.insertSnapshotRows(plan.insert.sessions, "session");
        this.insertSnapshotRows(plan.insert.facts, "fact");
        this.insertSnapshotRows(plan.insert.measurements, "measurement");
        this.insertSnapshotRows(plan.insert.obligations, "obligation");
        this.setNextIds(plan.merged.nextIds);
        for (const rec of additiveImportProjectionUpserts(
          target,
          plan.merged,
          this.projectId(),
        )) {
          this.queueRecord(rec);
        }
        return plan.written;
      }

      // Exact replacement (empty target, or force + refuse).
      const projectId = this.projectId();
      const oldLive = liveProjectionMap(target, projectId);
      const newLive = liveProjectionMap(snapshot, projectId);

      for (const kind of [...ENTITY_ORDER].reverse()) {
        this.db.exec(`DELETE FROM ${quoteIdent(TABLE[kind])}`);
      }

      let written = 0;
      for (const kind of ENTITY_ORDER) {
        written += this.insertSnapshotRows(rowsOfKind(snapshot, kind), kind);
      }

      this.setNextIds(snapshot.nextIds);

      for (const [key, oldRec] of oldLive) {
        if (!newLive.has(key)) {
          this.queueRetract(oldRec.kind, oldRec.id);
        }
      }
      for (const [key, newRec] of newLive) {
        const oldRec = oldLive.get(key);
        if (!oldRec || oldRec.text !== newRec.text) {
          this.queueRecord(newRec);
        }
      }

      return written;
    });
  }

  /** Insert rows of one kind. Returns the number inserted. Must run in a tx. */
  private insertSnapshotRows(
    rows: readonly Record<string, unknown>[] | readonly SessionRow[] | readonly FactRow[] | readonly MeasurementRow[] | readonly ObligationRow[],
    kind: EntityKind,
  ): number {
    const spec = specFor(kind);
    const names = spec.fields.map((f) => f.name);
    const cols = names.map(quoteIdent).join(", ");
    const qs = names.map(() => "?").join(", ");
    const stmt = this.db.prepare(
      `INSERT INTO ${quoteIdent(TABLE[kind])} (${cols}) VALUES (${qs})`,
    );
    let written = 0;
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      stmt.run(...names.map((n) => (r[n] ?? null) as never));
      written++;
    }
    return written;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

/** Convenience: an in-memory store seeded empty. Used heavily by the suite. */
export function openMemoryStore(): SqliteSessionStore {
  return SqliteSessionStore.open(":memory:");
}

export function emptyStoreSnapshot(): SessionSnapshot {
  return emptySnapshot();
}
