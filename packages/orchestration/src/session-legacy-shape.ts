/**
 * Recognize and migrate a pre-port session database.
 *
 * The port cannot open a legacy-shaped file safely: CREATE TABLE IF NOT EXISTS
 * leaves schema_meta in place and seeds every watermark to 1 against live
 * ids. Classification and the v1 dump therefore use raw SQLite. This is the
 * one non-test, non-port backend import in packages/, and it is deliberate:
 * a legacy-shape reader that may not read the legacy shape cannot do its job.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ENTITY_ORDER,
  SIDECAR_FORMAT,
  SqliteSessionStore,
  specFor,
  type EntityKind,
} from "@foreman/session-store";
import { rebuildFromSidecar } from "./session-rebuild.js";

export type StoreShape = "absent" | "legacy" | "port" | "corrupt";

/** Refused legacy dump. Callers map this to the exit-2 refusal class. */
export class LegacyMigrationRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyMigrationRefusal";
  }
}

export type BootstrapOpts = {
  readonly allowMigration: boolean;
  readonly readOnly: boolean;
};

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

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

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * How the file at `p` is shaped, decided STRUCTURALLY.
 *
 * Four shapes, not three. "corrupt" is the one this classifier previously
 * could not say: the port opened straight onto a legacy file CREATES
 * store_meta while leaving schema_meta in place and every watermark at 1, so
 * "has store_meta" classified that exact wreckage as healthy and the next
 * write minted id 1 beside live id 36. The presence of store_meta is
 * untrustworthy in the same way a version number is.
 */
export function classifyStore(p: string): StoreShape {
  if (!existsSync(p)) return "absent";
  // read-only: this is a pure inspection, called from every bootstrap —
  // including read-only commands against a healthy store — and a plain
  // connection's close() checkpoints an outstanding WAL as a side effect of
  // becoming the last connection, which writes to the very file a read-only
  // command must not touch.
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const names = new Set(
      (db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as {
        name: string;
      }[]).map((r) => r.name),
    );
    const hasPort = names.has("store_meta");
    const hasLegacy = names.has("schema_meta");
    if (hasPort && hasLegacy) return "corrupt";
    if (hasPort) {
      // A watermark at or below its table's max(id) means the next mint
      // collides. Cross-check before declaring the file healthy.
      for (const [kind, table] of [
        ["fact", "facts"],
        ["measurement", "measurements"],
        ["obligation", "obligations"],
      ] as const) {
        if (!names.has(table)) continue;
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
    return "absent";
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
function legacyDumpV1(p: string): string {
  const db = new DatabaseSync(p);
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
        throw new LegacyMigrationRefusal(
          `legacy store is missing declared table ${table}; ` +
            `refusing a lossy dump that would recreate it empty. ` +
            `Move it aside and rebuild from the tracked sidecar: ` +
            `mv ${p} ${p}.unmigratable && fm-session recover`,
        );
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
    return documents.join("\n") + "\n";
  } finally {
    db.close();
  }
}

export function sidecarPathFor(p: string): string {
  return p.replace(/\.db$/, ".ndjson");
}

export function pathsAlias(left: string, right: string): boolean {
  try {
    return resolve(left) === resolve(right);
  } catch {
    return false;
  }
}

function storeIsEmpty(p: string): boolean {
  const db = new DatabaseSync(p);
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

function rehydrateFromSidecarIfEmpty(p: string): void {
  const sidecar = sidecarPathFor(p);
  if (pathsAlias(sidecar, p) || !existsSync(sidecar)) return;
  try {
    if (!storeIsEmpty(p)) return;
  } catch {
    return;
  }
  try {
    const res = rebuildFromSidecar({ sidecarPath: sidecar, dbPath: p, force: true });
    process.stderr.write(
      `rehydrated ${res.rowsWritten} row(s) from ${sidecar} (the .db is a derived cache; the sidecar is what git tracks)\n`,
    );
  } catch (e) {
    // The sidecar is the tracked record of truth. If it cannot be read, coming
    // up empty is worse than failing: the next write would produce a "correct"
    // store with none of the history in it.
    process.stderr.write(
      `refusing: the session store is empty and the tracked sidecar at ${sidecar} could not be read: ${errorMessage(e)}\n`,
    );
    throw e;
  }
}

/**
 * Guarantee the file at `p` is port-shaped BEFORE anything opens it.
 *
 * The port creates its tables with CREATE TABLE IF NOT EXISTS, so opening it
 * straight onto a legacy file returns cleanly while leaving the old schema in
 * place and seeding every id watermark to 1 against live ids in the thirties.
 * The next write then collides on the primary key. The only safe migration is
 * a rebuild into a FRESH file, which is what rebuildFromSidecar does.
 *
 * A legacy file is migrated from ITS OWN contents rather than from the tracked
 * sidecar. It is the artefact being replaced, so nothing it holds may be lost
 * to a sidecar that is stale, or missing entirely.
 *
 * Returns true only when this call migrated a legacy-shaped file. Callers that
 * have already rewritten the store must persist a tracked sidecar even if the
 * command later refuses.
 */
export function bootstrapStore(p: string, opts: BootstrapOpts): boolean {
  const shape = classifyStore(p);
  if (shape === "corrupt") {
    process.stderr.write(
      `refusing: the session store at ${p} carries both the legacy and port schemas, or identity counters behind its own rows. ` +
        `It is the half-migrated state a pre-fix open produced. Move it aside and let the tracked sidecar rebuild it: ` +
        `mv ${p} ${p}.corrupt && fm-session recover\n`,
    );
    process.exit(2);
  }
  if (shape === "legacy") {
    if (!opts.allowMigration) {
      process.stderr.write(
        `refusing: the session store at ${p} is in the pre-port schema and this is a read-only command. ` +
          `Run a write command, or \`fm-session import-sidecar\`, to migrate it.\n`,
      );
      process.exit(2);
    }
    const carrier = `${p}.legacy.ndjson`;
    try {
      writeFileSync(carrier, legacyDumpV1(p), { encoding: "utf8" });
      const res = rebuildFromSidecar({ sidecarPath: carrier, dbPath: p, force: true });
      process.stderr.write(`migrated ${res.rowsWritten} row(s) out of the legacy session schema into ${p}\n`);
    } catch (e) {
      process.stderr.write(
        `refusing: the legacy session store at ${p} could not be migrated to the port schema: ${errorMessage(e)}\n`,
      );
      throw e;
    } finally {
      rmSync(carrier, { force: true });
    }
    rehydrateFromSidecarIfEmpty(p);
    return true;
  }
  if (shape === "absent") {
    // Nothing exists yet to mutate: creating the schema and, below,
    // rehydrating from the tracked sidecar is CREATING a missing derived
    // cache, not writing to a store that already exists. Legitimate
    // regardless of whether the command itself is read-only -- the goldens
    // depend on exactly this path.
    SqliteSessionStore.open(p).close();
    rehydrateFromSidecarIfEmpty(p);
    return false;
  }
  // shape === "port": the file already exists and is already the derived
  // cache. A read-only command must not write to a store that already
  // exists, so it may not rehydrate one here even if the store happens to be
  // empty right now -- that would still be a write to something present on
  // disk, not the creation of something missing.
  if (!opts.readOnly) {
    rehydrateFromSidecarIfEmpty(p);
  }
  return false;
}
