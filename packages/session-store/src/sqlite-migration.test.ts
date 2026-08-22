import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, test } from "node:test";
import {
  classifySqliteStore,
  dumpLegacySqliteAsV1,
  sqliteStoreIsEmpty,
} from "./sqlite-migration.js";
import { SqliteSessionStore } from "./sqlite-store.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      try {
        chmodSync(dir, 0o700);
      } catch {
        // best-effort so cleanup can remove locked parents
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function directoryModesAreEnforced(): boolean {
  return (
    process.platform !== "win32" &&
    !(typeof process.getuid === "function" && process.getuid() === 0)
  );
}

function sqliteError(errcode: number, message: string): Error {
  const e = new Error(message) as Error & { code: string; errcode: number; errstr: string };
  e.code = "ERR_SQLITE_ERROR";
  e.errcode = errcode;
  e.errstr = message;
  return e;
}

function sqliteErrcodeOf(e: unknown): number | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const code = (e as { errcode?: unknown }).errcode;
  return typeof code === "number" ? code : undefined;
}

function writeLegacyStore(
  dbPath: string,
  opts: {
    readonly omitTables?: readonly string[];
    readonly omitColumns?: Readonly<Record<string, readonly string[]>>;
  } = {},
): void {
  const omit = new Set(opts.omitTables ?? []);
  const omitColumns = opts.omitColumns ?? {};
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(
      "CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    );
    db.exec("INSERT INTO schema_meta(key,value) VALUES('version','3')");
    if (!omit.has("sessions")) {
      db.exec(
        "CREATE TABLE sessions (session_id TEXT PRIMARY KEY, started_ts TEXT NOT NULL, start_sha TEXT, ended_ts TEXT, note TEXT);",
      );
    }
    if (!omit.has("facts")) {
      const drop = new Set(omitColumns.facts ?? []);
      const cols = [
        "id INTEGER PRIMARY KEY AUTOINCREMENT",
        "statement TEXT NOT NULL",
        "evidence TEXT",
        "established_ts TEXT NOT NULL",
        "session_id TEXT",
        ...(!drop.has("superseded_by") ? ["superseded_by INTEGER"] : []),
        ...(!drop.has("superseded_at") ? ["superseded_at TEXT"] : []),
        ...(!drop.has("supersede_reason") ? ["supersede_reason TEXT"] : []),
      ];
      db.exec(`CREATE TABLE facts (${cols.join(", ")});`);
      db.exec(
        "INSERT INTO facts(id,statement,established_ts) VALUES(36,'live fact','2026-08-01T00:00:00Z')",
      );
    }
    if (!omit.has("measurements")) {
      db.exec(
        "CREATE TABLE measurements (id INTEGER PRIMARY KEY AUTOINCREMENT, metric TEXT NOT NULL, value TEXT NOT NULL, command TEXT, measured_ts TEXT NOT NULL, measured_sha TEXT, scope_paths TEXT, session_id TEXT, value_num REAL, superseded_by INTEGER, superseded_at TEXT, supersede_reason TEXT);",
      );
      db.exec(
        "INSERT INTO measurements(id,metric,value,measured_ts) VALUES(19,'m','1','2026-08-01T00:00:00Z')",
      );
    }
    if (!omit.has("obligations")) {
      db.exec(
        "CREATE TABLE obligations (id INTEGER PRIMARY KEY AUTOINCREMENT, statement TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', blocker TEXT, opened_ts TEXT NOT NULL, closed_ts TEXT, session_id TEXT);",
      );
      db.exec(
        "INSERT INTO obligations(id,statement,status,blocker,opened_ts) VALUES(34,'live obligation','blocked','a blocker','2026-08-01T00:00:00Z')",
      );
    }
  } finally {
    db.close();
  }
}

function writeForeignNotesDb(path: string, notes: readonly string[]): void {
  const db = new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO notes(body) VALUES(?)");
    for (const body of notes) insert.run(body);
  } finally {
    db.close();
  }
}

describe("classifySqliteStore shape matrix", () => {
  it("returns absent for a missing path", () => {
    const dir = makeTempDir("ss-cls-absent-");
    assert.equal(classifySqliteStore(join(dir, "missing.db")), "absent");
  });

  it("returns unrecognised for a non-SQLite regular file and a foreign schema", () => {
    const dir = makeTempDir("ss-cls-unrec-");
    const plain = join(dir, "plain.db");
    writeFileSync(plain, "this is not sqlite");
    assert.equal(classifySqliteStore(plain), "unrecognised");

    const notes = join(dir, "notes.db");
    writeForeignNotesDb(notes, ["keep-1", "keep-2"]);
    assert.equal(classifySqliteStore(notes), "unrecognised");
  });

  it("returns unrecognised for a dangling symlink without opening a database", () => {
    const dir = makeTempDir("ss-cls-dangle-");
    const link = join(dir, "session.db");
    symlinkSync(join(dir, "missing-target.db"), link);
    assert.equal(classifySqliteStore(link), "unrecognised");
  });

  it("returns unrecognised for a FIFO without blocking on DatabaseSync open", () => {
    const dir = makeTempDir("ss-cls-fifo-");
    const fifo = join(dir, "session.db");
    execFileSync("mkfifo", [fifo]);
    assert.equal(classifySqliteStore(fifo), "unrecognised");
  });

  it("returns legacy for a schema_meta store and port for a healthy store_meta store", () => {
    const dir = makeTempDir("ss-cls-shapes-");
    const legacy = join(dir, "legacy.db");
    writeLegacyStore(legacy);
    assert.equal(classifySqliteStore(legacy), "legacy");

    const port = join(dir, "port.db");
    SqliteSessionStore.open(port).close();
    assert.equal(classifySqliteStore(port), "port");
  });

  it("returns corrupt for a legacy+port hybrid", () => {
    const dir = makeTempDir("ss-cls-hybrid-");
    const p = join(dir, "session.db");
    const db = new DatabaseSync(p);
    try {
      db.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT)");
      db.exec("INSERT INTO schema_meta VALUES('version','3')");
      db.exec("CREATE TABLE facts(id INTEGER PRIMARY KEY, statement TEXT)");
      db.exec("INSERT INTO facts VALUES(36,'live fact')");
      db.exec("CREATE TABLE store_meta(key TEXT PRIMARY KEY, value TEXT)");
      db.exec("INSERT INTO store_meta VALUES('next_id.fact','1')");
    } finally {
      db.close();
    }
    assert.equal(classifySqliteStore(p), "corrupt");
  });

  it("returns corrupt when a watermark sits behind its rows", () => {
    const dir = makeTempDir("ss-cls-behind-");
    const p = join(dir, "session.db");
    const store = SqliteSessionStore.open(p);
    store.addFact({
      statement: "one",
      evidence: null,
      established_ts: "2026-08-08T10:00:00Z",
      session_id: null,
    });
    store.close();
    const db = new DatabaseSync(p);
    try {
      db.exec("UPDATE store_meta SET value='1' WHERE key='next_id.fact'");
    } finally {
      db.close();
    }
    assert.equal(classifySqliteStore(p), "corrupt");
  });

  it("returns corrupt for a non-numeric or missing watermark", () => {
    const dir = makeTempDir("ss-cls-wm-");
    const broken = join(dir, "broken.db");
    const store = SqliteSessionStore.open(broken);
    store.addFact({
      statement: "one",
      evidence: null,
      established_ts: "2026-08-08T10:00:00Z",
      session_id: null,
    });
    store.close();
    const db = new DatabaseSync(broken);
    try {
      db.exec("UPDATE store_meta SET value='abc' WHERE key='next_id.fact'");
    } finally {
      db.close();
    }
    assert.equal(classifySqliteStore(broken), "corrupt");

    const missing = join(dir, "missing.db");
    const store2 = SqliteSessionStore.open(missing);
    store2.addFact({
      statement: "one",
      evidence: null,
      established_ts: "2026-08-08T10:00:00Z",
      session_id: null,
    });
    store2.close();
    const db2 = new DatabaseSync(missing);
    try {
      db2.exec("DELETE FROM store_meta WHERE key='next_id.fact'");
    } finally {
      db2.close();
    }
    assert.equal(classifySqliteStore(missing), "corrupt");
  });

  it("is read-only: does not checkpoint or create WAL state on a healthy port store", () => {
    const dir = makeTempDir("ss-cls-ro-");
    const p = join(dir, "session.db");
    const holder = SqliteSessionStore.open(p);
    holder.addFact({
      statement: "held-open",
      evidence: null,
      established_ts: "2026-08-01T00:00:00Z",
      session_id: null,
    });
    assert.equal(existsSync(`${p}-wal`), true, "precondition: holder must leave a WAL");
    const beforeDb = readFileSync(p);
    const beforeWal = readFileSync(`${p}-wal`);
    assert.equal(classifySqliteStore(p), "port");
    assert.ok(Buffer.compare(beforeDb, readFileSync(p)) === 0, "classify must not rewrite the db");
    assert.equal(existsSync(`${p}-wal`), true, "classify must not checkpoint the WAL away");
    assert.ok(
      Buffer.compare(beforeWal, readFileSync(`${p}-wal`)) === 0,
      "classify must not mutate WAL frames",
    );
    holder.close();
  });

  it("returns corrupt for store_meta with an incomplete declared port schema", () => {
    const dir = makeTempDir("ss-cls-incomplete-");
    const p = join(dir, "session.db");
    const db = new DatabaseSync(p);
    try {
      db.exec("CREATE TABLE store_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      db.exec("INSERT INTO store_meta(key,value) VALUES('next_id.fact','1')");
      db.exec(
        "CREATE TABLE foreign_sentinel(id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
      );
      db.exec("INSERT INTO foreign_sentinel(id,body) VALUES(1,'do-not-touch')");
    } finally {
      db.close();
    }
    const before = readFileSync(p);
    assert.equal(
      classifySqliteStore(p),
      "corrupt",
      "partial Foreman marker must not classify as a healthy port store",
    );
    assert.ok(
      Buffer.compare(before, readFileSync(p)) === 0,
      "classification must not mutate an incomplete database",
    );

    const probe = new DatabaseSync(p, { readOnly: true });
    try {
      const names = new Set(
        (probe.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as {
          name: string;
        }[]).map((r) => r.name),
      );
      for (const table of [
        "sessions",
        "facts",
        "measurements",
        "obligations",
        "memory_outbox",
      ] as const) {
        assert.equal(
          names.has(table),
          false,
          `incomplete store must still lack ${table} after classify`,
        );
      }
      const indexes = new Set(
        (probe.prepare("SELECT name FROM sqlite_schema WHERE type='index'").all() as {
          name: string;
        }[]).map((r) => r.name),
      );
      for (const index of [
        "idx_meas_metric",
        "idx_oblig_status",
        "idx_facts_superseded",
      ] as const) {
        assert.equal(
          indexes.has(index),
          false,
          `incomplete store must still lack ${index} after classify`,
        );
      }
      const sentinel = probe
        .prepare("SELECT body FROM foreign_sentinel WHERE id = 1")
        .get() as { body: string } | undefined;
      assert.equal(sentinel?.body, "do-not-touch");
    } finally {
      probe.close();
    }
  });

  it("still classifies a complete schema with legacy memory_outbox as port", () => {
    const dir = makeTempDir("ss-cls-legacy-outbox-");
    const p = join(dir, "session.db");
    const db = new DatabaseSync(p);
    try {
      db.exec("CREATE TABLE store_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      db.exec("INSERT INTO store_meta(key,value) VALUES('next_id.session','1')");
      db.exec("INSERT INTO store_meta(key,value) VALUES('next_id.fact','1')");
      db.exec("INSERT INTO store_meta(key,value) VALUES('next_id.measurement','1')");
      db.exec("INSERT INTO store_meta(key,value) VALUES('next_id.obligation','1')");
      db.exec(
        "CREATE TABLE sessions (session_id TEXT PRIMARY KEY, started_ts TEXT NOT NULL, start_sha TEXT, ended_ts TEXT, note TEXT)",
      );
      db.exec(
        "CREATE TABLE facts (id INTEGER PRIMARY KEY, statement TEXT NOT NULL, evidence TEXT, established_ts TEXT NOT NULL, session_id TEXT, superseded_by INTEGER, superseded_at TEXT, supersede_reason TEXT)",
      );
      db.exec(
        "CREATE TABLE measurements (id INTEGER PRIMARY KEY, metric TEXT NOT NULL, value TEXT NOT NULL, value_num REAL, command TEXT, measured_ts TEXT NOT NULL, measured_sha TEXT, scope_paths TEXT, session_id TEXT, superseded_by INTEGER, superseded_at TEXT, supersede_reason TEXT)",
      );
      db.exec(
        "CREATE TABLE obligations (id INTEGER PRIMARY KEY, statement TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', blocker TEXT, opened_ts TEXT NOT NULL, closed_ts TEXT, session_id TEXT)",
      );
      db.exec(
        "CREATE TABLE memory_outbox (key TEXT PRIMARY KEY, kind TEXT NOT NULL, entity_id INTEGER NOT NULL, mutation TEXT NOT NULL, queued_ts TEXT NOT NULL)",
      );
    } finally {
      db.close();
    }
    assert.equal(classifySqliteStore(p), "port");
  });
});

describe("classifySqliteStore raw error preservation", () => {
  it("switches on sqlite_schema errcode", () => {
    const dir = makeTempDir("ss-cls-errcode-");
    const p = join(dir, "session.db");
    SqliteSessionStore.open(p).close();
    const origPrepare = DatabaseSync.prototype.prepare;
    const cases: ReadonlyArray<{ errcode: number; expect: "throw" | "corrupt" | "unrecognised" }> =
      [
        { errcode: 5, expect: "throw" },
        { errcode: 8, expect: "throw" },
        { errcode: 1544, expect: "throw" },
        { errcode: 14, expect: "throw" },
        { errcode: 11, expect: "corrupt" },
        { errcode: 26, expect: "unrecognised" },
      ];
    try {
      for (const c of cases) {
        DatabaseSync.prototype.prepare = function (sql: string) {
          if (String(sql).includes("sqlite_schema")) {
            throw sqliteError(c.errcode, `injected ${c.errcode}`);
          }
          return origPrepare.call(this, sql);
        };
        if (c.expect === "throw") {
          assert.throws(
            () => classifySqliteStore(p),
            (e: unknown) => sqliteErrcodeOf(e) === c.errcode,
            `errcode ${c.errcode} must be rethrown, not classified`,
          );
        } else {
          assert.equal(
            classifySqliteStore(p),
            c.expect,
            `errcode ${c.errcode} must classify ${c.expect}`,
          );
        }
      }
    } finally {
      DatabaseSync.prototype.prepare = origPrepare;
    }
  });

  it("rethrows SQLITE_READONLY_DIRECTORY from a chmod 500 parent", (t) => {
    if (!directoryModesAreEnforced()) {
      t.skip("chmod 500 does not block the owner on root or win32");
      return;
    }
    const dir = makeTempDir("ss-cls-500-");
    const parent = join(dir, "locked");
    mkdirSync(parent);
    const p = join(parent, "session.db");
    const store = SqliteSessionStore.open(p);
    store.addFact({
      statement: "keep-readonly-dir",
      evidence: null,
      established_ts: "2026-08-01T00:00:00Z",
      session_id: null,
    });
    store.close();
    for (const suffix of ["-wal", "-shm"] as const) {
      try {
        rmSync(p + suffix);
      } catch {
        // absent is normal after checkpointing close
      }
    }
    chmodSync(parent, 0o500);
    try {
      assert.throws(
        () => classifySqliteStore(p),
        (e: unknown) => sqliteErrcodeOf(e) === 1544,
        "SQLITE_READONLY_DIRECTORY must not collapse to unrecognised",
      );
    } finally {
      chmodSync(parent, 0o700);
    }
  });

  it("rethrows SQLITE_BUSY unchanged", () => {
    const dir = makeTempDir("ss-cls-busy-");
    const p = join(dir, "session.db");
    const seed = SqliteSessionStore.open(p);
    seed.addFact({
      statement: "busy-fact",
      evidence: null,
      established_ts: "2026-08-01T00:00:00Z",
      session_id: null,
    });
    seed.close();
    const locker = new DatabaseSync(p);
    try {
      locker.exec("PRAGMA journal_mode=DELETE");
      locker.exec("BEGIN EXCLUSIVE");
      assert.throws(
        () => classifySqliteStore(p),
        (e: unknown) => sqliteErrcodeOf(e) === 5,
        "SQLITE_BUSY must be rethrown, not classified unrecognised",
      );
    } finally {
      try {
        locker.exec("ROLLBACK");
      } catch {
        // lock already dropped
      }
      locker.close();
    }
  });

  it("classifies SQLITE_CORRUPT as corrupt and leaves bytes unchanged", () => {
    const dir = makeTempDir("ss-cls-corrupt-");
    const p = join(dir, "session.db");
    const seed = SqliteSessionStore.open(p);
    seed.addFact({
      statement: "will-corrupt",
      evidence: null,
      established_ts: "2026-08-01T00:00:00Z",
      session_id: null,
    });
    seed.close();
    const buf = readFileSync(p);
    for (let i = 100; i < Math.min(buf.length, 800); i++) buf[i] = 0xff;
    writeFileSync(p, buf);
    const before = readFileSync(p);
    assert.equal(classifySqliteStore(p), "corrupt");
    assert.ok(Buffer.compare(before, readFileSync(p)) === 0);
  });

  it("classifies SQLITE_NOTADB as unrecognised", () => {
    const dir = makeTempDir("ss-cls-notadb-");
    const p = join(dir, "session.db");
    writeFileSync(p, "this is not sqlite\n");
    assert.equal(classifySqliteStore(p), "unrecognised");
  });
});

describe("dumpLegacySqliteAsV1", () => {
  it("returns missing_declared_table without altering the source database", () => {
    const dir = makeTempDir("ss-dump-miss-");
    const p = join(dir, "session.db");
    writeLegacyStore(p, { omitTables: ["facts"] });
    const before = readFileSync(p);
    const dumped = dumpLegacySqliteAsV1(p);
    assert.equal(dumped.ok, false);
    if (dumped.ok) return;
    assert.equal(dumped.reason, "missing_declared_table");
    assert.equal(dumped.table, "facts");
    assert.ok(Buffer.compare(before, readFileSync(p)) === 0);
    assert.equal(classifySqliteStore(p), "legacy");
  });

  it("preserves canonical ordering and fills historically absent nullable columns as null", () => {
    const dir = makeTempDir("ss-dump-null-");
    const p = join(dir, "session.db");
    writeLegacyStore(p, { omitColumns: { facts: ["supersede_reason"] } });
    // Seed a session so ENTITY_ORDER includes every table in the dump text.
    const seed = new DatabaseSync(p);
    try {
      seed.exec(
        "INSERT INTO sessions(session_id,started_ts) VALUES('s1','2026-08-01T00:00:00Z')",
      );
    } finally {
      seed.close();
    }
    const before = readFileSync(p);
    const dumped = dumpLegacySqliteAsV1(p);
    assert.equal(dumped.ok, true);
    if (!dumped.ok) return;
    assert.ok(Buffer.compare(before, readFileSync(p)) === 0, "dump must not alter the source");
    const lines = dumped.text.trimEnd().split("\n");
    assert.match(lines[0]!, /"format": "foreman-session-sidecar"/);
    const factLine = lines.find((l) => l.includes('"table": "facts"'));
    assert.ok(factLine, "facts row must be present");
    const parsed = JSON.parse(factLine!) as {
      table: string;
      row: { statement: string; supersede_reason: null };
    };
    assert.equal(parsed.table, "facts");
    assert.equal(parsed.row.statement, "live fact");
    assert.equal(parsed.row.supersede_reason, null);
    const tables = lines
      .slice(1)
      .map((l) => (JSON.parse(l) as { table: string }).table);
    assert.deepEqual(
      [...new Set(tables)],
      ["sessions", "facts", "measurements", "obligations"],
    );
  });

  it("preserves source bytes on a successful dump", () => {
    const dir = makeTempDir("ss-dump-bytes-");
    const p = join(dir, "session.db");
    writeLegacyStore(p);
    const before = readFileSync(p);
    const dumped = dumpLegacySqliteAsV1(p);
    assert.equal(dumped.ok, true);
    assert.ok(Buffer.compare(before, readFileSync(p)) === 0);
  });

  it("is read-only against a live WAL legacy database", () => {
    const dir = makeTempDir("ss-dump-wal-");
    const p = join(dir, "session.db");
    writeLegacyStore(p);
    const holder = new DatabaseSync(p);
    try {
      const mode = holder.prepare("PRAGMA journal_mode=WAL").get() as { journal_mode: string };
      assert.equal(String(mode.journal_mode).toLowerCase(), "wal");
      holder.exec(
        "INSERT INTO facts(id,statement,established_ts) VALUES(99,'wal-committed-fact','2026-08-01T00:00:00Z')",
      );
      assert.equal(
        existsSync(`${p}-wal`),
        true,
        "precondition: holder must leave a committed WAL",
      );
      assert.equal(
        existsSync(`${p}-shm`),
        true,
        "precondition: holder must leave a SHM",
      );
      const beforeDb = readFileSync(p);
      const beforeWal = readFileSync(`${p}-wal`);
      const beforeShm = readFileSync(`${p}-shm`);

      const dumped = dumpLegacySqliteAsV1(p);
      assert.equal(dumped.ok, true);
      if (!dumped.ok) return;
      assert.match(dumped.text, /wal-committed-fact/);

      assert.equal(existsSync(p), true);
      assert.equal(existsSync(`${p}-wal`), true);
      assert.equal(existsSync(`${p}-shm`), true);
      assert.ok(Buffer.compare(beforeDb, readFileSync(p)) === 0, "dump must not rewrite the db");
      assert.ok(
        Buffer.compare(beforeWal, readFileSync(`${p}-wal`)) === 0,
        "dump must not mutate WAL bytes",
      );
      assert.ok(
        Buffer.compare(beforeShm, readFileSync(`${p}-shm`)) === 0,
        "dump must not mutate SHM bytes",
      );
    } finally {
      holder.close();
    }
  });
});

describe("sqliteStoreIsEmpty", () => {
  it("returns true for an empty port store and false once a row exists", () => {
    const dir = makeTempDir("ss-empty-");
    const p = join(dir, "session.db");
    SqliteSessionStore.open(p).close();
    assert.equal(sqliteStoreIsEmpty(p), true);
    const store = SqliteSessionStore.open(p);
    store.addFact({
      statement: "present",
      evidence: null,
      established_ts: "2026-08-01T00:00:00Z",
      session_id: null,
    });
    store.close();
    assert.equal(sqliteStoreIsEmpty(p), false);
  });
});

test("classifySqliteStore rejects a legacy+port hybrid instead of calling it port-shaped", () => {
  const dir = makeTempDir("ss-hybrid-alias-");
  const p = join(dir, "session.db");
  const db = new DatabaseSync(p);
  try {
    db.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT)");
    db.exec("INSERT INTO schema_meta VALUES('version','3')");
    db.exec("CREATE TABLE facts(id INTEGER PRIMARY KEY, statement TEXT)");
    db.exec("INSERT INTO facts VALUES(36,'live fact')");
    db.exec("CREATE TABLE store_meta(key TEXT PRIMARY KEY, value TEXT)");
    db.exec("INSERT INTO store_meta VALUES('next_id.fact','1')");
  } finally {
    db.close();
  }
  assert.equal(classifySqliteStore(p), "corrupt");
});
