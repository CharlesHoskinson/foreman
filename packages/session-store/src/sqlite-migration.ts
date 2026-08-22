/**
 * Raw SQLite inspection and legacy-dump helpers for session databases.
 *
 * Classification and the v1 dump use node:sqlite because recognizing a
 * pre-port file (and dumping it without ALTER TABLE) requires raw access.
 * Callers own CLI messaging and process.exit; this module does not.
 */

import { DatabaseSync } from "node:sqlite";
import fs, { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENTITY_ORDER,
  specFor,
  type EntityKind,
} from "./entities.js";
import { SIDECAR_FORMAT } from "./sidecar.js";

const SQLITE_BUSY = 5;
const SQLITE_READONLY = 8;
const SQLITE_CORRUPT = 11;
const SQLITE_CANTOPEN = 14;
const SQLITE_READONLY_DIRECTORY = 1544;

export type SqliteStoreShape =
  | "absent"
  | "legacy"
  | "port"
  | "corrupt"
  | "unrecognised";

export type DumpLegacySqliteAsV1Result =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly reason: "missing_declared_table";
      readonly table: string;
    };

/**
 * v1 sidecar table names by entity kind.
 *
 * Nothing writes v1 any more. This map exists only so a legacy-shaped
 * database can be dumped in the one format the v1 reader understands, on the
 * way to being rebuilt as a port-shaped file.
 */
const V1_TABLE: Readonly<Record<EntityKind, string>> = {
  session: "sessions",
  fact: "facts",
  measurement: "measurements",
  obligation: "obligations",
};

function quoteIdentifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

function asJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(asJsonValue);
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) out[k] = asJsonValue(v);
    return out;
  }
  return String(value);
}

function jsonDumps(obj: JsonValue, sortKeys = false): string {
  if (obj === null) return "null";
  if (typeof obj === "boolean") return obj ? "true" : "false";
  if (typeof obj === "number") return JSON.stringify(obj);
  if (typeof obj === "string") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map((v) => jsonDumps(v, sortKeys)).join(", ") + "]";
  }
  const keys = sortKeys ? Object.keys(obj).sort() : Object.keys(obj);
  return (
    "{" +
    keys
      .map((k) => {
        const value = obj[k];
        return JSON.stringify(k) + ": " + jsonDumps(value === undefined ? null : value, sortKeys);
      })
      .join(", ") +
    "}"
  );
}

function sqliteErrcode(e: unknown): number | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const code = (e as { errcode?: unknown }).errcode;
  return typeof code === "number" ? code : undefined;
}

/**
 * How the file at `path` is shaped, decided STRUCTURALLY.
 *
 * Five shapes, not four. "absent" means no file at the path. "unrecognised"
 * means a file exists that is neither legacy-shaped nor port-shaped: a
 * stranger SQLite database, a non-database regular file, or a schema this
 * tool cannot read. Collapsing those into "absent" made bootstrap write
 * port tables into the stranger and then delete it.
 *
 * "corrupt" is the half-migrated wreckage: the port opened straight onto a
 * legacy file CREATES store_meta while leaving schema_meta in place and
 * every watermark at 1, so "has store_meta" classified that exact wreckage
 * as healthy and the next write minted id 1 beside live id 36.
 */
export function classifySqliteStore(path: string): SqliteStoreShape {
  let st;
  try {
    st = fs.lstatSync(path);
  } catch (e) {
    const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
    if (code === "ENOENT") return "absent";
    throw e;
  }
  if (st.isSymbolicLink()) {
    try {
      st = fs.statSync(path);
    } catch {
      // Dangling symlink: a path entry exists. It is not a missing file.
      return "unrecognised";
    }
  }
  if (!st.isFile() && !st.isDirectory()) {
    // FIFO/socket/device: do not block on a DatabaseSync open.
    return "unrecognised";
  }
  // read-only: this is a pure inspection, called from every bootstrap —
  // including read-only commands against a healthy store — and a plain
  // connection's close() checkpoints an outstanding WAL as a side effect of
  // becoming the last connection, which writes to the very file a read-only
  // command must not touch.
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    let names: Set<string>;
    try {
      names = new Set(
        (db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as {
          name: string;
        }[]).map((r) => r.name),
      );
    } catch (e) {
      // File exists. Collapse only the cases this shape was created for:
      // SQLITE_NOTADB and any other schema we cannot interpret. A healthy
      // store that SQLite cannot open because the parent is not writable,
      // a lock, or a damaged image is not "unrecognised".
      const errcode = sqliteErrcode(e);
      if (errcode === SQLITE_CORRUPT) return "corrupt";
      if (
        errcode === SQLITE_BUSY ||
        errcode === SQLITE_READONLY ||
        errcode === SQLITE_READONLY_DIRECTORY ||
        errcode === SQLITE_CANTOPEN
      ) {
        throw e;
      }
      return "unrecognised";
    }
    const hasPort = names.has("store_meta");
    const hasLegacy = names.has("schema_meta");
    if (hasPort && hasLegacy) return "corrupt";
    if (hasPort) {
      // store_meta alone is only a Foreman marker. A foreign or half-written
      // file that carries it must not be called port-shaped: SqliteSessionStore
      // open runs CREATE TABLE IF NOT EXISTS and would otherwise mutate it
      // before schema validation.
      for (const table of [
        "store_meta",
        "sessions",
        "facts",
        "measurements",
        "obligations",
        "memory_outbox",
      ] as const) {
        if (!names.has(table)) return "corrupt";
      }
      // A watermark at or below its table's max(id) means the next mint
      // collides. Cross-check before declaring the file healthy. A legacy
      // memory_outbox schema is still a valid port shape so writable open can
      // migrate it; current outbox columns are not required here.
      for (const [kind, table] of [
        ["fact", "facts"],
        ["measurement", "measurements"],
        ["obligation", "obligations"],
      ] as const) {
        const row = db.prepare(`SELECT MAX(id) AS m FROM ${quoteIdentifier(table)}`).get() as
          | { m: number | bigint | null }
          | undefined;
        const max = row && row.m !== null ? Number(row.m) : 0;
        const wm = db.prepare("SELECT value FROM store_meta WHERE key = ?").get(`next_id.${kind}`) as
          | { value: string }
          | undefined;
        // Number('abc') is NaN, and NaN <= max is false, so a wrecked
        // watermark would otherwise classify as healthy port-shaped.
        if (wm === undefined || typeof wm.value !== "string") return "corrupt";
        const next = Number(wm.value);
        if (!Number.isFinite(next)) return "corrupt";
        if (next <= max) return "corrupt";
      }
      return "port";
    }
    if (hasLegacy) return "legacy";
    return "unrecognised";
  } finally {
    db.close();
  }
}

/**
 * Dump a legacy-shaped database as v1 sidecar text.
 *
 * Reads the file it is about to replace; never writes to it. A column the old
 * schema never grew is selected as NULL rather than added with ALTER TABLE,
 * so a migration that is refused downstream leaves the legacy file
 * byte-identical to what it found. A declared entity table that is absent is
 * not skipped: that dump would rebuild the table empty and later overwrite
 * the tracked sidecar with zero facts.
 */
export function dumpLegacySqliteAsV1(path: string): DumpLegacySqliteAsV1Result {
  // A read-only SQLite connection can still update the shared-memory WAL
  // index. Read a private copy so this inspection does not touch any byte of
  // the source database, WAL, or SHM while it constructs the carrier.
  const snapshotDir = mkdtempSync(join(tmpdir(), "foreman-legacy-dump-"));
  const snapshotPath = join(snapshotDir, "session.db");
  try {
    copyFileSync(path, snapshotPath);
    if (fs.existsSync(`${path}-wal`)) {
      copyFileSync(`${path}-wal`, `${snapshotPath}-wal`);
    }
    const db = new DatabaseSync(snapshotPath, { readOnly: true });
    try {
      db.exec("PRAGMA foreign_keys=OFF");
      const present = new Set(
        (db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as {
          name: string;
        }[]).map((r) => r.name),
      );
      const documents = [jsonDumps({ format: SIDECAR_FORMAT, format_version: 1 }, true)];
      for (const kind of ENTITY_ORDER) {
        const table = V1_TABLE[kind];
        if (!present.has(table)) {
          return { ok: false, reason: "missing_declared_table", table };
        }
        const spec = specFor(kind);
        const have = new Set(
          (db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as {
            name: string;
          }[]).map((r) => r.name),
        );
        const columns = spec.fields.map((f) => f.name);
        const selected = columns
          .map((c) => (have.has(c) ? quoteIdentifier(c) : `NULL AS ${quoteIdentifier(c)}`))
          .join(", ");
        const ordering = spec.ordering.map((c) => quoteIdentifier(c)).join(", ");
        const query = `SELECT ${selected} FROM ${quoteIdentifier(table)} ORDER BY ${ordering}`;
        for (const record of db.prepare(query).all() as Record<string, unknown>[]) {
          const row: { [key: string]: JsonValue } = {};
          for (const c of columns) row[c] = asJsonValue(record[c] ?? null);
          documents.push(jsonDumps({ row, table }, true));
        }
      }
      return { ok: true, text: documents.join("\n") + "\n" };
    } finally {
      db.close();
    }
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}

/** True when a port-shaped store has zero entity rows. */
export function sqliteStoreIsEmpty(path: string): boolean {
  const db = new DatabaseSync(path);
  try {
    const row = db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM facts) + (SELECT COUNT(*) FROM measurements) + (SELECT COUNT(*) FROM obligations) + (SELECT COUNT(*) FROM sessions) AS n",
      )
      .get() as { n: number } | undefined;
    return row !== undefined && row.n === 0;
  } finally {
    db.close();
  }
}
