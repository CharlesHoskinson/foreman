// @ts-nocheck
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync } from "node:fs";

const SCHEMA_VERSION = 3;
const READ_ONLY_CMDS = new Set(["recover", "freshness", "sidecar"]);
const SIDECAR_FORMAT = "foreman-session-sidecar";
const SIDECAR_FORMAT_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id  TEXT PRIMARY KEY,
  started_ts  TEXT NOT NULL,
  start_sha   TEXT,
  ended_ts    TEXT,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS facts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  statement      TEXT NOT NULL,
  evidence       TEXT,
  established_ts TEXT NOT NULL,
  session_id     TEXT,
  superseded_by  INTEGER REFERENCES facts(id),
  superseded_at   TEXT,
  supersede_reason TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  metric       TEXT NOT NULL,
  value        TEXT NOT NULL,
  command      TEXT,
  measured_ts  TEXT NOT NULL,
  measured_sha TEXT,
  scope_paths  TEXT,
  session_id   TEXT,
  value_num    REAL,
  superseded_by    INTEGER REFERENCES measurements(id),
  superseded_at    TEXT,
  supersede_reason TEXT
);

CREATE TABLE IF NOT EXISTS obligations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  statement  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  blocker    TEXT,
  opened_ts  TEXT NOT NULL,
  closed_ts  TEXT,
  session_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_meas_metric ON measurements(metric);
CREATE INDEX IF NOT EXISTS idx_oblig_status ON obligations(status);
CREATE INDEX IF NOT EXISTS idx_facts_superseded ON facts(superseded_by);
`;

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

function connectReadonly(path?: string): DatabaseSync {
  const p = path ?? dbPath();
  if (!existsSync(p)) return connect(p);
  try {
    const db = new DatabaseSync(p);
    db.exec("PRAGMA foreign_keys=OFF");
    const have = new Set((db.prepare("PRAGMA table_info(measurements)").all() as any[]).map(r => r.name));
    if (!have.has("value_num") || !have.has("superseded_by")) {
      db.close();
      return connect(p);
    }
    return db;
  } catch (e) {
    return connect(p);
  }
}

export function connect(path?: string): DatabaseSync {
  const p = path ?? dbPath();
  mkdirSync(dirname(p), { recursive: true });
  const db = new DatabaseSync(p);
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec(SCHEMA);
  
  const cols = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(r => r.name));
  const migrations = [
    ["facts", "superseded_at", "TEXT"],
    ["facts", "supersede_reason", "TEXT"],
    ["measurements", "value_num", "REAL"],
    ["measurements", "superseded_by", "INTEGER"],
    ["measurements", "superseded_at", "TEXT"],
    ["measurements", "supersede_reason", "TEXT"],
  ];
  for (const [table, col, decl] of migrations) {
    if (!cols(table).has(col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
    }
  }
  db.prepare("INSERT OR REPLACE INTO schema_meta(key,value) VALUES('version',?)").run(String(SCHEMA_VERSION));
  rebuildFromSidecarIfEmpty(db, p);
  return db;
}

function rebuildFromSidecarIfEmpty(conn: DatabaseSync, p: string) {
  try {
    const row = conn.prepare("SELECT (SELECT COUNT(*) FROM facts) + (SELECT COUNT(*) FROM measurements) + (SELECT COUNT(*) FROM obligations) + (SELECT COUNT(*) FROM sessions) AS n").get() as any;
    if (!row || row.n > 0) return;
  } catch (e) {
    return;
  }
  
  const sidecar = p.replace(/\.db$/, ".ndjson");
  if (!existsSync(sidecar)) return;
  
  try {
    const n = importSidecar(conn, sidecar);
    process.stderr.write(`rehydrated ${n} row(s) from ${sidecar} (the .db is a derived cache; the sidecar is what git tracks)\n`);
  } catch (e: any) {
    process.stderr.write(`WARNING: session store is empty and the sidecar at ${sidecar} could not be imported: ${e.message}\n`);
  }
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
    kind: "obligation", id: r.id, statement: r.statement, status: r.status, blocker: r.blocker, opened_ts: r.opened_ts
  }));
  
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
  for (const f of rec.facts.slice(0, 20)) {
    A(`  [${f.id}] ${f.statement}`);
    if (f.evidence) A(`       evidence: ${f.evidence}`);
  }
  
  A("");
  A(`MEASUREMENTS \u2014 fresh=${c.measurements_fresh} STALE=${c.measurements_stale} unknown=${c.measurements_unknown}`);
  for (const m of rec.measurements.slice(0, 20)) {
    const mark = { "fresh": "OK   ", "stale": "STALE", "unknown": "?    " }[m.validity as string];
    A(`  ${mark} [${m.id}] ${m.metric} = ${m.value}`);
    A(`       ${m.validity_reason}  (measured ${m.measured_ts} @ ${m.measured_sha})`);
    if (m.validity !== "fresh" && m.command) {
      A(`       re-run: ${m.command}`);
    }
  }
  
  A("");
  A(`OBLIGATIONS \u2014 open=${c.obligations_open} blocked=${c.obligations_blocked}`);
  for (const o of rec.obligations.slice(0, 20)) {
    A(`  [${o.id}] (${o.status}) ${o.statement}`);
    if (o.blocker) A(`       blocked by: ${o.blocker}`);
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

function storeSchema(conn: DatabaseSync): Record<string, any> {
  const tables = (conn.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[]).map(r => r.name);
  const schema: Record<string, any> = {};
  for (const table of tables) {
    const info = conn.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as any[];
    const columns = info.map(r => r.name);
    const primaryKey = info.filter(r => r.pk).sort((x, y) => x.pk - y.pk).map(r => r.name);
    if (primaryKey.length === 0) throw new Error(`cannot serialize table ${table}: table has no primary key`);
    schema[table] = { columns, primary_key: primaryKey };
  }
  return schema;
}

export function sidecarNdjson(conn: DatabaseSync): [string, number] {
  conn.exec("BEGIN");
  try {
    const documents: any[] = [{ format: SIDECAR_FORMAT, format_version: SIDECAR_FORMAT_VERSION }];
    let rowCount = 0;
    const schema = storeSchema(conn);
    for (const table of Object.keys(schema)) {
      const columns = schema[table].columns as string[];
      const selected = columns.map(quoteIdentifier).join(", ");
      const ordering = (schema[table].primary_key as string[]).map(quoteIdentifier).join(", ");
      const query = `SELECT ${selected} FROM ${quoteIdentifier(table)} ORDER BY ${ordering}`;
      for (const record of conn.prepare(query).all() as any[]) {
        const row: any = {};
        for (const col of columns) row[col] = record[col];
        documents.push({ table, row });
        rowCount++;
      }
    }
    const lines = documents.map(d => jsonDumps(d, true)).join("\n");
    conn.exec("COMMIT");
    return [lines + "\n", rowCount];
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
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

function readSidecar(path: string) {
  const documents: any[] = [];
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (!line.trim()) continue;
    try {
      const doc = JSON.parse(line as string);
      if (typeof doc !== "object" || doc === null) throw new Error("expected object");
      documents.push(doc);
    } catch (e: any) {
      throw new Error(`invalid NDJSON at line ${i + 1}: ${e.message}`);
    }
  }
  return documents;
}

function describeRow(row: any) {
  return jsonDumps(row, true);
}

function validateSidecar(conn: DatabaseSync, path: string): [Record<string, any>, [string, any][]] {
  const documents = readSidecar(path);
  if (documents.length === 0) throw new Error("missing sidecar format record");
  
  const header = documents[0];
  if (header.format !== SIDECAR_FORMAT) throw new Error(`unsupported sidecar format: '${header.format}'`);
  if (header.format_version !== SIDECAR_FORMAT_VERSION) throw new Error(`unsupported sidecar format version: ${header.format_version}`);
  if (Object.keys(header).sort().join(",") !== "format,format_version") throw new Error("invalid sidecar format record");
  
  const schema = storeSchema(conn);
  const rows: [string, any][] = [];
  for (let i = 1; i < documents.length; i++) {
    const doc = documents[i];
    if ("format" in doc || "format_version" in doc) throw new Error("sidecar must contain exactly one format record");
    const table = doc.table;
    const row = doc.row;
    if (typeof table !== "string" || typeof row !== "object" || row === null) throw new Error(`invalid sidecar row record: ${jsonDumps(doc)}`);
    if (Object.keys(doc).sort().join(",") !== "row,table") throw new Error(`cannot restore table ${table}, row ${describeRow(row)}: record must contain only table and row`);
    if (!(table in schema)) throw new Error(`cannot restore table ${table}, row ${describeRow(row)}: table is not present in the target schema`);
    
    const expected = new Set(schema[table].columns as string[]);
    const actual = new Set(Object.keys(row));
    let missing = [...expected].filter(x => !actual.has(x)).sort();
    let extra = [...actual].filter(x => !expected.has(x)).sort();
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(`cannot restore table ${table}, row ${describeRow(row)}: columns differ (missing=[${missing.map(x=>`'${x}'`).join(", ")}], extra=[${extra.map(x=>`'${x}'`).join(", ")}])`);
    }
    rows.push([table, row]);
  }
  return [schema, rows];
}

export function importSidecar(conn: DatabaseSync, path: string, force = false): number {
  const [schema, rows] = validateSidecar(conn, path);
  const dataTables = Object.keys(schema).filter(t => t !== "schema_meta");
  conn.exec("BEGIN IMMEDIATE");
  try {
    let hasRows = false;
    for (const table of dataTables) {
      if (conn.prepare(`SELECT 1 FROM ${quoteIdentifier(table)} LIMIT 1`).get()) {
        hasRows = true; break;
      }
    }
    if (hasRows && !force) throw new Error("target store already has rows; use --force to replace it");
    
    for (const table of Object.keys(schema).reverse()) {
      conn.exec(`DELETE FROM ${quoteIdentifier(table)}`);
    }
    if (conn.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sqlite_sequence'").get()) {
      const qms = Object.keys(schema).map(()=>"?").join(",");
      conn.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${qms})`).run(...Object.keys(schema));
    }
    for (const [table, row] of rows) {
      const columns = schema[table].columns as string[];
      const names = columns.map(quoteIdentifier).join(", ");
      const placeholders = columns.map(()=>"?").join(", ");
      try {
        conn.prepare(`INSERT INTO ${quoteIdentifier(table)} (${names}) VALUES (${placeholders})`).run(...columns.map(c => row[c]));
      } catch (e: any) {
        throw new Error(`cannot restore table ${table}, row ${describeRow(row)}: ${e.message}`);
      }
    }
    conn.exec("COMMIT");
    return rows.length;
  } catch (e) {
    conn.exec("ROLLBACK");
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
  if (cmd === "import-sidecar") {
    try {
      conn = connect(parsed.options.into as string);
    } catch(e: any) {
      const msg = e.message.includes("unable to open database file") ? "sqlite3.OperationalError" : e.message;
      process.stderr.write(`refusing: cannot open target store: ${msg}\n`);
      process.exit(2);
    }
  } else if (READ_ONLY_CMDS.has(cmd)) {
    try { conn = connectReadonly(); } catch (e: any) { process.stderr.write(`sqlite3.OperationalError\n`); process.exit(1); }
  } else {
    try { conn = connect(); } catch (e: any) { process.stderr.write(`sqlite3.OperationalError\n`); process.exit(1); }
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
    const res = conn.prepare("INSERT INTO facts(statement,evidence,established_ts,session_id) VALUES(?,?,?,?)").run(statement, evidence, nowIso(), currentSession(conn));
    process.stdout.write(`fact ${res.lastInsertRowid}\n`);
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
    
    const res = conn.prepare("INSERT INTO measurements(metric,value,command,measured_ts,measured_sha,scope_paths,session_id,value_num) VALUES(?,?,?,?,?,?,?,?)").run(
      metric, value, command, nowIso(), gitSha(), parsed.options.scope.join("\n"), currentSession(conn), vnum
    );
    process.stdout.write(`measurement ${res.lastInsertRowid}\n`);
    return 0;
  }
  
  if (cmd === "obligation") {
    const statement = parsed.args[0];
    const blocker = parsed.options.blocker || null;
    const res = conn.prepare("INSERT INTO obligations(statement,status,blocker,opened_ts,session_id) VALUES(?,?,?,?,?)").run(
      statement, blocker ? "blocked" : "open", blocker, nowIso(), currentSession(conn)
    );
    process.stdout.write(`obligation ${res.lastInsertRowid}\n`);
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
      const [lines, rowCount] = sidecarNdjson(conn);
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
      const count = importSidecar(conn, path, !!parsed.options.force);
      const target = parsed.options.into || dbPath();
      process.stdout.write(`imported ${count} document(s) -> ${target}\n`);
      return 0;
    } catch (e: any) {
      let msg = String(e.message);
      if (e.message.includes("NOT NULL constraint failed")) {
         msg = e.message;
      }
      process.stderr.write(`refusing: ${msg}\n`);
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
    const res = conn.prepare("INSERT INTO facts(statement,evidence,established_ts,session_id) VALUES(?,?,?,?)").run(statement, evidence, nowIso(), currentSession(conn));
    const newId = res.lastInsertRowid;
    conn.prepare("UPDATE facts SET superseded_by=?, superseded_at=?, supersede_reason=? WHERE id=?").run(newId, nowIso(), reason, factId);
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
    const out = store.replace(/\.db$/, ".ndjson");
    if (pathsAlias(out, store)) {
      process.exit(rc);
    }
    const conn = connectReadonly();
    const [lines, rowCount] = sidecarNdjson(conn);
    writeAtomic(out, lines);
    conn.close();
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
