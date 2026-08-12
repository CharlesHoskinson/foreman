// @ts-nocheck
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, openSync, closeSync, fsyncSync } from "node:fs";
import {
  ENTITY_ORDER,
  SIDECAR_FORMAT,
  SqliteSessionStore,
  countRows,
  decodeSnapshot,
  encodeSnapshot,
  specFor,
} from "@foreman/session-store";
import { rebuildFromSidecar } from "./session-rebuild.js";

const READ_ONLY_CMDS = new Set(["recover", "freshness", "sidecar"]);

/**
 * v1 sidecar table names by entity kind.
 *
 * Nothing writes v1 any more. This map exists only so a legacy-shaped
 * database can be dumped in the one format the v1 reader understands, on the
 * way to being rebuilt as a port-shaped file.
 */
const V1_TABLE: Record<string, string> = {
  session: "sessions",
  fact: "facts",
  measurement: "measurements",
  obligation: "obligations",
};

function jsonDumps(obj: any, sortKeys = false): string {
  if (obj === null) return "null";
  if (typeof obj === "boolean") return obj ? "true" : "false";
  if (typeof obj === "number") return JSON.stringify(obj);
  if (typeof obj === "string") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(v => jsonDumps(v, sortKeys)).join(", ") + "]";
  }
  if (typeof obj === "object") {
    const keys = sortKeys ? Object.keys(obj).sort() : Object.keys(obj);
    return "{" + keys.map(k => JSON.stringify(k) + ": " + jsonDumps(obj[k], sortKeys)).join(", ") + "}";
  }
  return "null";
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function repoRoot() {
  try {
    const out = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
    return dirname(resolve(out));
  } catch (e) {
    return process.cwd();
  }
}

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch (e) {
    return null;
  }
}

function warnOrphanStore(chosen: string) {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    if (!top) return;
    const orphan = resolve(top, ".foreman", "session.db");
    if (orphan === resolve(chosen) || !existsSync(orphan)) return;
    process.stderr.write(`WARNING: an orphaned session store sits at ${orphan}. Nothing reads it. The store in use is ${chosen}.\n`);
  } catch (e) {}
}

function dbPath(): string {
  if (process.env.FOREMAN_SESSION_DB) return process.env.FOREMAN_SESSION_DB;
  const d = join(repoRoot(), ".foreman");
  mkdirSync(d, { recursive: true });
  const chosen = join(d, "session.db");
  warnOrphanStore(chosen);
  return chosen;
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
export function classifyStore(p: string): "absent" | "legacy" | "port" | "corrupt" {
  if (!existsSync(p)) return "absent";
  const db = new DatabaseSync(p);
  try {
    const names = new Set((db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as any[]).map(r => r.name));
    const hasPort = names.has("store_meta");
    const hasLegacy = names.has("schema_meta");
    if (hasPort && hasLegacy) return "corrupt";
    if (hasPort) {
      // A watermark at or below its table's max(id) means the next mint
      // collides. Cross-check before declaring the file healthy.
      for (const [kind, table] of [["fact", "facts"], ["measurement", "measurements"], ["obligation", "obligations"]] as const) {
        if (!names.has(table)) continue;
        const row = db.prepare(`SELECT MAX(id) AS m FROM ${quoteIdentifier(table)}`).get() as any;
        const max = row && row.m !== null ? Number(row.m) : 0;
        const wm = db.prepare("SELECT value FROM store_meta WHERE key = ?").get(`next_id.${kind}`) as any;
        const next = wm ? Number(wm.value) : 0;
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
 * byte-identical to what it found.
 */
function legacyDumpV1(p: string): string {
  const db = new DatabaseSync(p);
  try {
    db.exec("PRAGMA foreign_keys=OFF");
    const present = new Set((db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as any[]).map(r => r.name));
    const documents = [jsonDumps({ format: SIDECAR_FORMAT, format_version: 1 }, true)];
    for (const kind of ENTITY_ORDER) {
      const table = V1_TABLE[kind] as string;
      if (!present.has(table)) continue;
      const spec = specFor(kind as any);
      const have = new Set((db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as any[]).map(r => r.name));
      const columns = spec.fields.map((f: any) => f.name as string);
      const selected = columns.map(c => have.has(c) ? quoteIdentifier(c) : `NULL AS ${quoteIdentifier(c)}`).join(", ");
      const ordering = spec.ordering.map((c: any) => quoteIdentifier(c)).join(", ");
      const query = `SELECT ${selected} FROM ${quoteIdentifier(table)} ORDER BY ${ordering}`;
      for (const record of db.prepare(query).all() as any[]) {
        const row: any = {};
        for (const c of columns) row[c] = record[c] ?? null;
        documents.push(jsonDumps({ row, table }, true));
      }
    }
    return documents.join("\n") + "\n";
  } finally {
    db.close();
  }
}

function sidecarPathFor(p: string): string {
  return p.replace(/\.db$/, ".ndjson");
}

function storeIsEmpty(p: string): boolean {
  const db = new DatabaseSync(p);
  try {
    const row = db.prepare("SELECT (SELECT COUNT(*) FROM facts) + (SELECT COUNT(*) FROM measurements) + (SELECT COUNT(*) FROM obligations) + (SELECT COUNT(*) FROM sessions) AS n").get() as any;
    return !!row && row.n === 0;
  } finally {
    db.close();
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
 */
function bootstrapStore(p: string, opts: { readonly allowMigration: boolean }) {
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
    } catch (e: any) {
      process.stderr.write(`refusing: the legacy session store at ${p} could not be migrated to the port schema: ${e.message}\n`);
      throw e;
    } finally {
      rmSync(carrier, { force: true });
    }
  } else if (shape === "absent") {
    SqliteSessionStore.open(p).close();
  }
  rehydrateFromSidecarIfEmpty(p);
}

function rehydrateFromSidecarIfEmpty(p: string) {
  const sidecar = sidecarPathFor(p);
  if (pathsAlias(sidecar, p) || !existsSync(sidecar)) return;
  try {
    if (!storeIsEmpty(p)) return;
  } catch (e) {
    return;
  }
  try {
    const res = rebuildFromSidecar({ sidecarPath: sidecar, dbPath: p, force: true });
    process.stderr.write(`rehydrated ${res.rowsWritten} row(s) from ${sidecar} (the .db is a derived cache; the sidecar is what git tracks)\n`);
  } catch (e: any) {
    // The sidecar is the tracked record of truth. If it cannot be read, coming
    // up empty is worse than failing: the next write would produce a "correct"
    // store with none of the history in it.
    process.stderr.write(`refusing: the session store is empty and the tracked sidecar at ${sidecar} could not be read: ${e.message}\n`);
    throw e;
  }
}

export function connect(path?: string, cmd?: string): DatabaseSync {
  const p = path ?? dbPath();
  mkdirSync(dirname(p), { recursive: true });
  bootstrapStore(p, { allowMigration: !READ_ONLY_CMDS.has(cmd ?? "") });
  const db = new DatabaseSync(p);
  // Foreign keys stay OFF on this connection, matching what the commands
  // still served by raw SQL here have always seen. The port's own connection
  // turns them ON, and Task 6 moves those commands onto it.
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}

function scalarOf(text: string): number | null {
  const match = text.match(/^\s*(-?\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}

function mintSessionId(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const hex = randomBytes(3).toString("hex");
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z-${hex}`;
}

function measurementValidity(measuredSha: string | null, scopePaths: string | null): [string, string] {
  if (!measuredSha) return ["unknown", "no measured_sha recorded"];
  const paths = (scopePaths || "").split("\n").map(s => s.trim()).filter(Boolean);
  if (paths.length === 0) return ["unknown", "no scope_paths recorded; cannot bound what invalidates it"];
  
  try {
    const out = execFileSync("git", ["rev-list", `${measuredSha}..HEAD`, "--", ...paths], { encoding: "utf8" });
    const commits = out.split("\n").map(s => s.trim()).filter(Boolean);
    if (commits.length > 0) {
      return ["stale", `${commits.length} commit(s) touched its scope since measurement`];
    }
    return ["fresh", "no commit has touched its scope since measurement"];
  } catch (e: any) {
    const errStr = String(e.stderr || e.message).trim().substring(0, 80);
    if (e.stderr) {
       return ["unknown", `git rev-list failed: ${errStr}`];
    }
    return ["unknown", `${e.name || "Error"}: ${e.message}`];
  }
}

/**
 * `blocked` is DERIVED state, never stored.
 *
 * The entity model declares status as open|done|dropped and carries the
 * blocker in its own column, so a blocked obligation IS an open one with a
 * non-null blocker. The v1 reader rewrites the old stored "blocked" to that
 * pair on the way in, so without this derivation the five blocked obligations
 * would silently read as open and the count would move.
 */
function displayStatus(o: { status: string; blocker: string | null }): string {
  return o.status === "open" && o.blocker ? "blocked" : o.status;
}

function buildRecovery(conn: DatabaseSync) {
  const head = gitSha();
  const sess = conn.prepare("SELECT * FROM sessions ORDER BY session_id DESC LIMIT 1").get() as any;
  
  const facts = (conn.prepare("SELECT * FROM facts WHERE superseded_by IS NULL ORDER BY id DESC").all() as any[]).map(r => ({
    kind: "fact", id: r.id, statement: r.statement, evidence: r.evidence, established_ts: r.established_ts
  }));
  
  const measurements: any[] = [];
  for (const r of conn.prepare("SELECT * FROM measurements WHERE superseded_by IS NULL ORDER BY id DESC").all() as any[]) {
    const [validity, why] = measurementValidity(r.measured_sha, r.scope_paths);
    measurements.push({
      kind: "measurement", id: r.id, metric: r.metric, value: r.value, command: r.command,
      measured_ts: r.measured_ts, measured_sha: (r.measured_sha || "").substring(0, 12),
      scope_paths: (r.scope_paths || "").split("\n").filter(Boolean),
      validity, validity_reason: why
    });
  }
  
  const obligations = (conn.prepare("SELECT * FROM obligations WHERE status != 'done' ORDER BY id DESC").all() as any[]).map(r => ({
    kind: "obligation", id: r.id, statement: r.statement, status: displayStatus(r), blocker: r.blocker, opened_ts: r.opened_ts
  }));
  // Actionability ordering: what survives truncation should be the part
  // worth keeping. An open obligation with no blocker is the most
  // actionable; one that is blocked (or, if this path ever sees it, open
  // with a blocker attached) ranks below that; anything else -- a status
  // this query should never surface, since 'done' is already excluded
  // above -- sorts last. Explicit, total comparator: it never relies on the
  // SQL/array order being merely stable, so re-recording the goldens stays
  // reproducible. Recency (id DESC) is the tiebreaker within a rank.
  const obligationRank = (o: { status: string; blocker: string | null }): number => {
    if (o.status === "open" && !o.blocker) return 0;
    if (o.status === "open" || o.status === "blocked") return 1;
    return 2;
  };
  obligations.sort((a, b) => {
    const ra = obligationRank(a);
    const rb = obligationRank(b);
    if (ra !== rb) return ra - rb;
    return b.id - a.id;
  });
  
  return {
    recovered_at: nowIso(),
    head_sha: ((head as string) || "").substring(0, 12),
    last_session: sess || null,
    facts,
    measurements,
    obligations,
    counts: {
      facts: facts.length,
      measurements_fresh: measurements.filter(m => m.validity === "fresh").length,
      measurements_stale: measurements.filter(m => m.validity === "stale").length,
      measurements_unknown: measurements.filter(m => m.validity === "unknown").length,
      obligations_open: obligations.filter(o => o.status === "open").length,
      obligations_blocked: obligations.filter(o => o.status === "blocked").length,
    }
  };
}

function buildFreshness(conn: DatabaseSync, staleOnly: boolean) {
  const measurements: any[] = [];
  const rows = conn.prepare("SELECT * FROM measurements WHERE superseded_by IS NULL ORDER BY id DESC").all() as any[];
  for (const row of rows) {
    const [validity, why] = measurementValidity(row.measured_sha, row.scope_paths);
    if (staleOnly && validity === "fresh") continue;
    measurements.push({
      id: row.id,
      metric: row.metric,
      value: row.value,
      verdict: validity === "stale" ? "STALE" : validity,
      reason: why,
      command: row.command || "(no command recorded)",
      scope: (row.scope_paths || "").split("\n").filter(Boolean).join(","),
      sha: row.measured_sha || "",
      timestamp: row.measured_ts,
    });
  }
  return measurements;
}

function renderFreshness(measurements: any[], outputFormat: string) {
  const columns = ["id", "metric", "value", "verdict", "reason", "command", "scope", "sha", "timestamp"];
  if (outputFormat === "tsv") {
    const lines = [columns.join("\t")];
    for (const m of measurements) {
      lines.push(columns.map(c => String(m[c])).join("\t"));
    }
    return lines.join("\n");
  }
  
  return measurements.map(m => 
    `[${m.id}] ${m.metric} = ${m.value}  verdict=${m.verdict}  reason=${m.reason}  command=${m.command}  scope=${m.scope}  sha=${m.sha}  timestamp=${m.timestamp}`
  ).join("\n");
}

function render(rec: any) {
  const A = (s: string) => lines.push(s);
  const lines: string[] = [];
  
  A(`FOREMAN RECOVERY  head=${rec.head_sha}  at=${rec.recovered_at}`);
  const ls = rec.last_session;
  if (ls) {
    A(`last session: ${ls.session_id}  started=${ls.started_ts}  start_sha=${(ls.start_sha || "").substring(0, 12)}  ${ls.ended_ts ? 'ENDED ' + ls.ended_ts : 'NOT ENDED'}`);
    if (ls.note) {
      A(`  note: ${ls.note}`);
    }
  } else {
    A("last session: (none \u2014 this is the first)");
  }
  
  const c = rec.counts;
  A("");
  A(`FACTS (${c.facts}) \u2014 durable, true by construction`);
  const FACT_LIMIT = 20;
  const factsShown = rec.facts.slice(0, FACT_LIMIT);
  for (const f of factsShown) {
    A(`  [${f.id}] ${f.statement}`);
    if (f.evidence) A(`       evidence: ${f.evidence}`);
  }
  const factsHidden = rec.facts.length - factsShown.length;
  if (factsHidden > 0) {
    A(`  ... ${factsHidden} more fact(s) not shown. Run: fm-session recover --json`);
  }
  
  A("");
  A(`MEASUREMENTS \u2014 fresh=${c.measurements_fresh} STALE=${c.measurements_stale} unknown=${c.measurements_unknown}`);
  const MEASUREMENT_LIMIT = 20;
  const measurementsShown = rec.measurements.slice(0, MEASUREMENT_LIMIT);
  for (const m of measurementsShown) {
    const mark = { "fresh": "OK   ", "stale": "STALE", "unknown": "?    " }[m.validity as string];
    A(`  ${mark} [${m.id}] ${m.metric} = ${m.value}`);
    A(`       ${m.validity_reason}  (measured ${m.measured_ts} @ ${m.measured_sha})`);
    if (m.validity !== "fresh" && m.command) {
      A(`       re-run: ${m.command}`);
    }
  }
  const measurementsHidden = rec.measurements.length - measurementsShown.length;
  if (measurementsHidden > 0) {
    A(`  ... ${measurementsHidden} more measurement(s) not shown. Run: fm-session recover --json`);
  }
  
  A("");
  A(`OBLIGATIONS \u2014 open=${c.obligations_open} blocked=${c.obligations_blocked}`);
  const OBLIGATION_LIMIT = 20;
  const obligationsShown = rec.obligations.slice(0, OBLIGATION_LIMIT);
  for (const o of obligationsShown) {
    A(`  [${o.id}] (${o.status}) ${o.statement}`);
    if (o.blocker) A(`       blocked by: ${o.blocker}`);
  }
  const obligationsHidden = rec.obligations.length - obligationsShown.length;
  if (obligationsHidden > 0) {
    A(`  ... ${obligationsHidden} more obligation(s) not shown. Run: fm-session recover --json`);
  }
  
  A("");
  const stale = c.measurements_stale + c.measurements_unknown;
  const live = rec.measurements.length;
  if (stale > 0) {
    A(`LAUNCH POINT: ${stale} measurement(s) are not fresh \u2014 re-run them before quoting any of their numbers. Then work the open obligations above.`);
  } else if (live === 0) {
    A("LAUNCH POINT: no measurement is recorded, so nothing here is measured. Measure before you quote a number. Then work the open obligations above.");
  } else {
    A("LAUNCH POINT: every measurement is fresh. Work the open obligations above.");
  }
  
  return lines.join("\n");
}

function quoteIdentifier(name: string) {
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * The tracked record, encoded by the port from a declared snapshot.
 *
 * This used to walk `sqlite_schema` and dump whatever tables it found, which
 * made the backend's table list the contract. Against a port-shaped store that
 * walk writes `store_meta` and `memory_outbox` into the tracked NDJSON, and
 * `decodeSnapshot` then refuses the file the CLI itself just wrote with
 * `unknown v1 table "store_meta"`. encodeSnapshot emits declared entity kinds
 * only, so an undeclared table cannot reach the record at all.
 *
 * Takes a PATH, not a connection: the snapshot must come from the port, and
 * the port owns its own connection.
 */
export function sidecarNdjson(dbFile: string): [string, number] {
  const store = SqliteSessionStore.open(dbFile);
  try {
    const snapshot = store.snapshot();
    return [encodeSnapshot(snapshot), countRows(snapshot)];
  } finally {
    store.close();
  }
}

function pathsAlias(left: string, right: string) {
  try {
    return resolve(left) === resolve(right);
  } catch(e) {
    return false;
  }
}

function writeAtomic(path: string, text: string) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, text, { encoding: "utf8" });
  // The sidecar is the tracked, canonical record. Without this flush the
  // rename can land before the bytes do, and the record of truth is the one
  // artefact that must not be able to tear.
  const fd = openSync(tmp, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

/**
 * Restore a sidecar into the store at `dbFile`.
 *
 * decodeSnapshot accepts both sidecar formats -- v1 by its header version,
 * v2 otherwise -- and validates the whole snapshot against the declared model
 * before importSnapshot opens a transaction, so a bad file cannot half-apply.
 */
export function importSidecar(dbFile: string, path: string, force = false): number {
  const snapshot = decodeSnapshot(readFileSync(path, "utf8"));
  const store = SqliteSessionStore.open(dbFile);
  try {
    return store.importSnapshot(snapshot, { force });
  } finally {
    store.close();
  }
}

/**
 * Mint the next id for `kind` from the port's persisted watermark.
 *
 * The port mints identity from store_meta; its tables are plain INTEGER
 * PRIMARY KEY with no AUTOINCREMENT. A raw INSERT that let SQLite choose would
 * take max(id)+1 and leave the watermark sitting behind it, so the next
 * port-minted id would collide -- and a snapshot whose row id sits at or above
 * its watermark fails integrity, which makes the tracked record unreadable.
 * Bump first: a crash between the two leaves a gap, never a clash.
 */
function mintId(conn: DatabaseSync, kind: string): number {
  const row = conn.prepare("SELECT value FROM store_meta WHERE key = ?").get(`next_id.${kind}`) as any;
  const id = row ? Number(row.value) : 1;
  conn.prepare("INSERT OR REPLACE INTO store_meta(key,value) VALUES(?,?)").run(`next_id.${kind}`, String(id + 1));
  return id;
}

/**
 * Run `body` with the write lock held from the first read to the last write.
 *
 * mintId reads a watermark and the caller then inserts a row against it. Split
 * across autocommit transactions those are two independent reads of the same
 * counter, and busy_timeout never fires because neither writer is ever blocked.
 * BEGIN IMMEDIATE takes the write lock up front, which is what makes the
 * read-modify-write atomic.
 */
function inWriteTx<T>(conn: DatabaseSync, body: () => T): T {
  conn.exec("BEGIN IMMEDIATE");
  try {
    const out = body();
    conn.exec("COMMIT");
    return out;
  } catch (e) {
    try { conn.exec("ROLLBACK"); } catch (_) {}
    throw e;
  }
}

function currentSession(cur: DatabaseSync): string | null {
  const r = cur.prepare("SELECT session_id FROM sessions WHERE ended_ts IS NULL ORDER BY session_id DESC LIMIT 1").get() as any;
  return r ? r.session_id : null;
}

export function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) process.exit(2);
  const cmd = args[0];
  
  const booleanArgs = new Set(["--json", "--stale-only", "--force"]);
  const stringArgs = new Set(["--note", "--format", "--evidence", "--command", "--scope", "--num", "--blocker", "--status", "--out", "--into", "--by", "--reason"]);
  
  const parsed: any = { args: [], options: { scope: [], format: "text", status: "done" } };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg.startsWith("--")) {
      if (booleanArgs.has(arg)) {
        parsed.options[arg.slice(2)] = true;
      } else if (stringArgs.has(arg)) {
        if (i + 1 >= args.length) {
          process.stderr.write(`error: option ${arg} requires an argument\n`);
          process.exit(2);
        }
        if (arg === "--scope") {
          parsed.options.scope.push(args[++i]);
        } else {
          parsed.options[arg.slice(2)] = args[++i];
        }
      } else {
        process.stderr.write(`error: unrecognized option: ${arg}\n`);
        process.exit(2);
      }
    } else {
      parsed.args.push(arg);
    }
  }
  
  let conn: DatabaseSync;
  let importTarget: string;
  if (cmd === "import-sidecar") {
    importTarget = (parsed.options.into as string) || dbPath();
    try {
      conn = connect(importTarget, cmd);
    } catch(e: any) {
      const msg = e.message.includes("unable to open database file") ? "sqlite3.OperationalError" : e.message;
      process.stderr.write(`refusing: cannot open target store: ${msg}\n`);
      process.exit(2);
    }
  } else {
    try { conn = connect(undefined, cmd); } catch (e: any) { process.stderr.write(`sqlite3.OperationalError\n`); process.exit(1); }
  }

  if (cmd === "begin") {
    const rec = buildRecovery(conn);
    const sid = mintSessionId();
    conn.prepare("INSERT INTO sessions(session_id,started_ts,start_sha,note) VALUES(?,?,?,?)").run(sid, nowIso(), gitSha(), parsed.options.note || null);
    process.stdout.write(render(rec) + "\n\n");
    process.stdout.write(`SESSION BEGUN: ${sid}\n`);
    return 0;
  }
  
  if (cmd === "recover") {
    const rec = buildRecovery(conn);
    if (parsed.options.json) {
      process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
    } else {
      process.stdout.write(render(rec) + "\n");
    }
    return 0;
  }
  
  if (cmd === "freshness") {
    const measurements = buildFreshness(conn, !!parsed.options["stale-only"]);
    process.stdout.write(renderFreshness(measurements, parsed.options.format) + "\n");
    return 0;
  }
  
  if (cmd === "end") {
    const sid = parsed.args[0] || currentSession(conn);
    if (!sid) {
      process.stderr.write("no open session\n");
      process.exit(2);
    }
    conn.prepare("UPDATE sessions SET ended_ts=? WHERE session_id=?").run(nowIso(), sid);
    process.stdout.write(`session ended: ${sid}\n`);
    return 0;
  }
  
  if (cmd === "fact") {
    const statement = parsed.args[0];
    const evidence = parsed.options.evidence || null;
    const id = inWriteTx(conn, () => {
      const id = mintId(conn, "fact");
      conn.prepare("INSERT INTO facts(id,statement,evidence,established_ts,session_id) VALUES(?,?,?,?,?)").run(id, statement, evidence, nowIso(), currentSession(conn));
      return id;
    });
    process.stdout.write(`fact ${id}\n`);
    return 0;
  }
  
  if (cmd === "measure") {
    if (parsed.options.scope.length === 0) {
      process.stderr.write("refusing: --scope is required. A measurement with no path scope can never be shown stale, which is the entire point.\n");
      process.exit(2);
    }
    const metric = parsed.args[0];
    const value = parsed.args[1];
    const command = parsed.options.command || null;
    let vnum = null;
    if (parsed.options.num !== undefined) vnum = parseFloat(parsed.options.num);
    else vnum = scalarOf(value);
    
    const id = inWriteTx(conn, () => {
      const id = mintId(conn, "measurement");
      conn.prepare("INSERT INTO measurements(id,metric,value,command,measured_ts,measured_sha,scope_paths,session_id,value_num) VALUES(?,?,?,?,?,?,?,?,?)").run(
        id, metric, value, command, nowIso(), gitSha(), parsed.options.scope.join("\n"), currentSession(conn), vnum
      );
      return id;
    });
    process.stdout.write(`measurement ${id}\n`);
    return 0;
  }
  
  if (cmd === "obligation") {
    const statement = parsed.args[0];
    const blocker = parsed.options.blocker || null;
    // Status stays "open": blocked is derived from the blocker column, and the
    // declared enum has no "blocked" member. Storing it would put a value
    // outside the model into the tracked record, which the next read refuses.
    const id = inWriteTx(conn, () => {
      const id = mintId(conn, "obligation");
      conn.prepare("INSERT INTO obligations(id,statement,status,blocker,opened_ts,session_id) VALUES(?,?,?,?,?,?)").run(
        id, statement, "open", blocker, nowIso(), currentSession(conn)
      );
      return id;
    });
    process.stdout.write(`obligation ${id}\n`);
    return 0;
  }
  
  if (cmd === "close") {
    const obligationId = parseInt(parsed.args[0], 10);
    const status = parsed.options.status;
    const blocker = parsed.options.blocker || null;
    conn.prepare("UPDATE obligations SET status=?, blocker=?, closed_ts=? WHERE id=?").run(
      status, blocker, status === "done" ? nowIso() : null, obligationId
    );
    process.stdout.write(`obligation ${obligationId} -> ${status}\n`);
    return 0;
  }
  
  if (cmd === "sidecar") {
    const outPath = parsed.options.out || join(dirname(dbPath()), "session.ndjson");
    let storeName = null;
    for (const r of conn.prepare("PRAGMA database_list").all() as any[]) {
      if (r.name === "main") storeName = r.file;
    }
    const store = storeName || dbPath();
    if (pathsAlias(outPath, store)) {
      process.stderr.write(`refusing: sidecar output ${outPath} aliases the session store ${store}\n`);
      process.exit(2);
    }
    try {
      const [lines, rowCount] = sidecarNdjson(store);
      writeAtomic(outPath, lines);
      process.stdout.write(`dumped ${rowCount} row(s) -> ${outPath}\n`);
      return 0;
    } catch (e: any) {
      process.stderr.write(`refusing: cannot write sidecar ${outPath}: ${e.message}\n`);
      process.exit(2);
    }
  }
  
  if (cmd === "import-sidecar") {
    const path = parsed.args[0];
    try {
      const count = importSidecar(importTarget, path, !!parsed.options.force);
      process.stdout.write(`imported ${count} document(s) -> ${importTarget}\n`);
      return 0;
    } catch (e: any) {
      process.stderr.write(`refusing: ${e.message}\n`);
      process.exit(2);
    }
  }
  
  if (cmd === "supersede") {
    const factId = parseInt(parsed.args[0], 10);
    const statement = parsed.args[1];
    const evidence = parsed.options.evidence || null;
    const reason = parsed.options.reason;
    if (!reason) {
       process.stderr.write("error: option --reason requires an argument\n"); process.exit(2);
    }
    const newId = inWriteTx(conn, () => {
      const newId = mintId(conn, "fact");
      conn.prepare("INSERT INTO facts(id,statement,evidence,established_ts,session_id) VALUES(?,?,?,?,?)").run(newId, statement, evidence, nowIso(), currentSession(conn));
      conn.prepare("UPDATE facts SET superseded_by=?, superseded_at=?, supersede_reason=? WHERE id=?").run(newId, nowIso(), reason, factId);
      return newId;
    });
    process.stdout.write(`fact ${factId} superseded by ${newId}\n`);
    return 0;
  }
  
  if (cmd === "retire") {
    const measurementId = parseInt(parsed.args[0], 10);
    const byId = parseInt(parsed.options.by, 10);
    const reason = parsed.options.reason;
    if (isNaN(byId)) {
       process.stderr.write("error: option --by requires an argument\n"); process.exit(2);
    }
    if (!reason) {
       process.stderr.write("error: option --reason requires an argument\n"); process.exit(2);
    }
    if (byId === measurementId) {
      process.stderr.write("refusing: a measurement cannot supersede itself\n");
      process.exit(2);
    }
    const target = conn.prepare("SELECT id FROM measurements WHERE id=?").get(measurementId);
    if (!target) {
      process.stderr.write(`refusing: no measurement ${measurementId} to retire\n`);
      process.exit(2);
    }
    const row: any = conn.prepare("SELECT id, superseded_by FROM measurements WHERE id=?").get(byId);
    if (!row) {
      process.stderr.write(`refusing: no measurement ${byId} to supersede it\n`);
      process.exit(2);
    }
    if (row.superseded_by !== null) {
      process.stderr.write(`refusing: measurement ${byId} is itself superseded by ${row.superseded_by}. A retired measurement cannot supersede another one.\n`);
      process.exit(2);
    }
    conn.prepare("UPDATE measurements SET superseded_by=?, superseded_at=?, supersede_reason=? WHERE id=?").run(byId, nowIso(), reason as string, measurementId);
    process.stdout.write(`measurement ${measurementId} retired, superseded by ${byId}\n`);
    return 0;
  }
  
  process.exit(2);
}

function mainWithSidecar() {
  let rc = 0;
  try {
    rc = main() || 0;
  } catch (e: any) {
    if (e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || e.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      process.stderr.write(`error: ${e.message}\n`);
      rc = 2;
    } else {
      throw e;
    }
  }
  if (rc !== 0 || process.argv.length < 3 || READ_ONLY_CMDS.has(process.argv[2])) {
    process.exit(rc);
  }
  
  try {
    const store = dbPath();
    const out = sidecarPathFor(store);
    if (pathsAlias(out, store)) {
      process.exit(rc);
    }
    const [lines, rowCount] = sidecarNdjson(store);
    writeAtomic(out, lines);
    process.stderr.write(`sidecar refreshed: ${rowCount} row(s) -> ${out}\n`);
  } catch (e: any) {
    process.stderr.write(`WARNING: the store was written but its sidecar could not be refreshed (${e}). The tracked record is now BEHIND the database; run \`fm-session.py sidecar\` before committing.\n`);
  }
  process.exit(rc);
}
// Run the CLI only when this module IS the program, not when it is imported.
// The previous guard keyed on NODE_ENV, which node:test does not set — so the
// test file ran the CLI on import and died at process.exit before a single
// test executed. It also made production behaviour depend on an environment
// variable: anything setting NODE_ENV=test would silently get a no-op CLI.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  mainWithSidecar();
}
