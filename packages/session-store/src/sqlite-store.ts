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
import type {
  ImportOptions,
  NewFact,
  NewMeasurement,
  NewObligation,
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
CREATE TABLE IF NOT EXISTS memory_outbox (
  key       TEXT PRIMARY KEY,
  kind      TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  mutation  TEXT NOT NULL,
  queued_ts TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meas_metric ON measurements(metric);
CREATE INDEX IF NOT EXISTS idx_oblig_status ON obligations(status);
CREATE INDEX IF NOT EXISTS idx_facts_superseded ON facts(superseded_by);
`;

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
  private closed = false;

  constructor(db: DatabaseSync, opts: SqliteStoreOptions = {}) {
    this.db = db;
    if (!opts.skipSchemaCheck) this.assertSchemaMatchesModel();
    this.ensureCounters();
  }

  // -- construction --------------------------------------------------------

  static open(path: string, opts: SqliteStoreOptions = {}): SqliteSessionStore {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    if (opts.readOnly) {
      // No pragma or DDL that could write: a plain connection here would
      // checkpoint an outstanding WAL as a side effect of merely being
      // opened and closed, which is exactly the write a read-only caller
      // must not cause.
      const db = new DatabaseSync(path, { readOnly: true });
      db.exec("PRAGMA busy_timeout=5000");
      return new SqliteSessionStore(db, opts);
    }
    const db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys=ON");
    // WAL lets readers run while a writer holds the write lock. AGENT_TRAPS.md:22
    // documents concurrent writers as normal operation, so the rollback-journal
    // default is a live hazard, not a theoretical one.
    db.exec("PRAGMA journal_mode=WAL");
    // NORMAL is durable across process crashes, which is the failure mode that
    // actually happens here. It trades only the last transaction on power loss.
    db.exec("PRAGMA synchronous=NORMAL");
    // Without this a second writer fails instantly with SQLITE_BUSY.
    db.exec("PRAGMA busy_timeout=5000");
    db.exec(SCHEMA);
    return new SqliteSessionStore(db, opts);
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
          .prepare("INSERT INTO store_meta (key, value) VALUES (?, ?)")
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

  private queueProjection(
    kind: CountedKind,
    id: number,
    mutation: string,
    ts: string,
  ): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO memory_outbox " +
          "(key, kind, entity_id, mutation, queued_ts) VALUES (?, ?, ?, ?, ?)",
      )
      .run(`${kind}:${id}:${mutation}`, kind, id, mutation, ts);
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
        .prepare("SELECT session_id FROM sessions WHERE session_id = ?")
        .get(sessionId);
      if (!existing) {
        raise("invalid_argument", `no such session ${JSON.stringify(sessionId)}`);
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
    this.queueProjection("fact", id, "upsert", fact.established_ts);
    return {
      id,
      statement: fact.statement,
      evidence: fact.evidence,
      established_ts: fact.established_ts,
      session_id: fact.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null,
    };
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
    this.queueProjection("measurement", id, "upsert", m.measured_ts);
    return {
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
      this.queueProjection("obligation", id, "upsert", o.opened_ts);
      return {
        id,
        statement: o.statement,
        status: "open" as ObligationStatus,
        blocker: o.blocker,
        opened_ts: o.opened_ts,
        closed_ts: null,
        session_id: o.session_id,
      };
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
      this.queueProjection("obligation", id, "upsert", closedTs);
      const r = this.db
        .prepare(
          "SELECT id, statement, status, blocker, opened_ts, closed_ts, session_id FROM obligations WHERE id = ?",
        )
        .get(id) as Record<string, unknown>;
      return {
        id: r["id"] as number,
        statement: r["statement"] as string,
        status: r["status"] as ObligationStatus,
        blocker: (r["blocker"] ?? null) as string | null,
        opened_ts: r["opened_ts"] as string,
        closed_ts: (r["closed_ts"] ?? null) as string | null,
        session_id: (r["session_id"] ?? null) as string | null,
      };
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
      this.queueProjection("fact", id, "retract", at);
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
      this.queueProjection("measurement", id, "retract", at);
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
      this.queueProjection("measurement", id, "retract", at);
      return this.db
        .prepare(
          "SELECT id, metric, value, value_num, command, measured_ts, measured_sha, scope_paths, session_id, superseded_by, superseded_at, supersede_reason FROM measurements WHERE id = ?",
        )
        .get(id) as unknown as MeasurementRow;
    });
  }

  // -- snapshot transfer ---------------------------------------------------

  importSnapshot(snapshot: SessionSnapshot, opts: ImportOptions = {}): number {
    // Validate BEFORE opening a transaction so a bad snapshot cannot touch the store.
    assertIntegrity(snapshot);
    if (snapshot.modelVersion !== this.modelVersion) {
      raise(
        "model_version_unsupported",
        `snapshot model version ${snapshot.modelVersion} != store ${this.modelVersion}`,
      );
    }

    const force = opts.force ?? false;
    const policy = opts.onIdCollision ?? "refuse";

    return this.tx(() => {
      this.db.exec("PRAGMA defer_foreign_keys=ON");

      const occupied = ENTITY_ORDER.some(
        (k) =>
          this.db.prepare(`SELECT 1 FROM ${quoteIdent(TABLE[k])} LIMIT 1`).get() !==
          undefined,
      );
      if (occupied && !force) {
        raise(
          "store_not_empty",
          "target store already has rows; pass force to replace it",
        );
      }
      if (occupied && policy === "remap") {
        raise(
          "invalid_argument",
          "remap id-collision policy is not implemented; import into an empty store",
        );
      }

      for (const kind of [...ENTITY_ORDER].reverse()) {
        this.db.exec(`DELETE FROM ${quoteIdent(TABLE[kind])}`);
      }
      this.db.exec("DELETE FROM memory_outbox");

      let written = 0;
      for (const kind of ENTITY_ORDER) {
        const spec = specFor(kind);
        const names = spec.fields.map((f) => f.name);
        const cols = names.map(quoteIdent).join(", ");
        const qs = names.map(() => "?").join(", ");
        const stmt = this.db.prepare(
          `INSERT INTO ${quoteIdent(TABLE[kind])} (${cols}) VALUES (${qs})`,
        );
        for (const row of rowsOfKind(snapshot, kind)) {
          const r = row as Record<string, unknown>;
          stmt.run(...names.map((n) => (r[n] ?? null) as never));
          written++;
        }
      }

      this.setNextIds(snapshot.nextIds);
      return written;
    });
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
