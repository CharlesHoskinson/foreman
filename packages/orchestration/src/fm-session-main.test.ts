import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, readFileSync, rmSync, mkdtempSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { SqliteSessionStore } from "@foreman/session-store";
import { connect, sidecarNdjson, importSidecar, classifyStore, main } from "./fm-session-main.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "fm-session-main.ts");
// `--import tsx` resolves the bare specifier "tsx" against the child's cwd;
// resolve it from this file's own location instead, same as
// fm-session-golden.test.ts's TSX_LOADER.
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");

/**
 * Both cases below now arm their probe on DatabaseSync.prototype rather than on
 * a connection the test owns. The sidecar is written by the port, which opens
 * its own connection, so a probe attached to a caller-held instance would sit
 * beside the code under test instead of on it and pass vacuously.
 */
function recordAndRestore<T>(
  onSql: (sql: string) => void,
  body: () => T,
): T {
  const origExec = DatabaseSync.prototype.exec;
  const origPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.exec = function (sql: string) {
    onSql(sql);
    return origExec.call(this, sql);
  };
  DatabaseSync.prototype.prepare = function (sql: string) {
    onSql(sql);
    return origPrepare.call(this, sql);
  };
  try {
    return body();
  } finally {
    DatabaseSync.prototype.exec = origExec;
    DatabaseSync.prototype.prepare = origPrepare;
  }
}

function scrub(...paths: string[]): void {
  for (const p of paths) {
    for (const suffix of ["", "-shm", "-wal"]) {
      try {
        rmSync(p + suffix);
      } catch {
        // absent is the normal case for the WAL sidecars
      }
    }
  }
}

describe("fm-session-main atomicity and locks", () => {
  it("(b) sidecar reads every table from one SQLite snapshot", () => {
    const dbPath = join(tmpdir(), `test-b-${Date.now()}.db`);
    try {
      connect(dbPath).close();

      // Fires once, between the facts read and the measurements read of the
      // same snapshot. If those two reads are not inside one transaction the
      // dump shows zero facts and one measurement -- a picture of the store
      // that never existed at any instant.
      let committed = false;
      const interleave = (sql: string) => {
        if (committed || !sql.includes('FROM "measurements"')) return;
        committed = true;
        const writer = new DatabaseSync(dbPath);
        writer.exec(
          "INSERT INTO facts(id,statement,established_ts) VALUES(1,'concurrent fact','now')",
        );
        writer.exec(
          "INSERT INTO measurements(id,metric,value,measured_ts) VALUES(1,'concurrent metric','1','now')",
        );
        writer.close();
      };

      const [ndjson] = recordAndRestore(interleave, () => sidecarNdjson(dbPath));
      assert.ok(committed, "writer did not commit between table reads");

      const lines = ndjson.split("\n").filter(Boolean);
      const facts = lines.filter((l) => l.includes('"kind":"fact"'));
      const measurements = lines.filter((l) => l.includes('"kind":"measurement"'));

      assert.equal(
        facts.length,
        measurements.length,
        "snapshot must be consistent: length of facts should match measurements",
      );
      assert.equal(facts.length, 0, "concurrently inserted facts should not be visible");
    } finally {
      scrub(dbPath);
    }
  });

  it("(c) import-sidecar checks for rows after acquiring the write lock", () => {
    const stamp = Date.now();
    const dbPath = join(tmpdir(), `test-c-${stamp}.db`);
    const targetDbPath = join(tmpdir(), `test-c-target-${stamp}.db`);
    const sidecarPath = join(tmpdir(), `test-c-${stamp}.ndjson`);
    try {
      const setupDb = connect(dbPath);
      setupDb.exec(
        "INSERT INTO facts(id,statement,established_ts) VALUES(1,'source fact','now')",
      );
      // The id watermark travels in the snapshot and must stay ahead of every
      // live id, exactly as mintId keeps it in the CLI. Writing the row without
      // it produces a sidecar the reader refuses.
      setupDb.exec(
        "INSERT OR REPLACE INTO store_meta(key,value) VALUES('next_id.fact','2')",
      );
      setupDb.close();
      const [ndjson] = sidecarNdjson(dbPath);
      writeFileSync(sidecarPath, ndjson);

      const statements: string[] = [];
      recordAndRestore(
        (sql) => statements.push(sql),
        () => importSidecar(targetDbPath, sidecarPath),
      );

      const beginIdx = statements.findIndex((s) => s === "BEGIN IMMEDIATE");
      const checkIdx = statements.findIndex((s) => s.startsWith("SELECT 1 FROM "));

      assert.ok(beginIdx !== -1, "must execute BEGIN IMMEDIATE");
      assert.ok(checkIdx !== -1, "must execute a row existence check (SELECT 1 FROM...)");
      assert.ok(
        beginIdx < checkIdx,
        `write lock must be acquired before row check. BEGIN at ${beginIdx}, SELECT at ${checkIdx}`,
      );
    } finally {
      scrub(dbPath, targetDbPath);
      try {
        rmSync(sidecarPath);
      } catch {
        // the sidecar is written before any assertion, so absence means failure
      }
    }
  });

  it("(d) a legacy-shaped store is rebuilt, never opened by the port", () => {
    const dbPath = join(tmpdir(), `test-d-${Date.now()}.db`);
    try {
      // The shape of every session.db in the wild: schema_meta present,
      // store_meta absent, live ids far above 1. Opening the port straight
      // onto this returns cleanly and seeds every watermark to 1, so the next
      // write collides -- which is the whole reason this bootstrap exists. A
      // golden cannot see any of that, so it is asserted here directly.
      const legacy = new DatabaseSync(dbPath);
      legacy.exec(
        [
          "CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
          "CREATE TABLE sessions (session_id TEXT PRIMARY KEY, started_ts TEXT NOT NULL, start_sha TEXT, ended_ts TEXT, note TEXT);",
          "CREATE TABLE facts (id INTEGER PRIMARY KEY AUTOINCREMENT, statement TEXT NOT NULL, evidence TEXT, established_ts TEXT NOT NULL, session_id TEXT, superseded_by INTEGER, superseded_at TEXT, supersede_reason TEXT);",
          "CREATE TABLE measurements (id INTEGER PRIMARY KEY AUTOINCREMENT, metric TEXT NOT NULL, value TEXT NOT NULL, command TEXT, measured_ts TEXT NOT NULL, measured_sha TEXT, scope_paths TEXT, session_id TEXT, value_num REAL, superseded_by INTEGER, superseded_at TEXT, supersede_reason TEXT);",
          "CREATE TABLE obligations (id INTEGER PRIMARY KEY AUTOINCREMENT, statement TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', blocker TEXT, opened_ts TEXT NOT NULL, closed_ts TEXT, session_id TEXT);",
        ].join("\n"),
      );
      legacy.exec("INSERT INTO schema_meta(key,value) VALUES('version','3')");
      legacy.exec(
        "INSERT INTO facts(id,statement,established_ts) VALUES(36,'live fact','2026-08-01T00:00:00Z')",
      );
      legacy.exec(
        "INSERT INTO measurements(id,metric,value,measured_ts) VALUES(19,'m','1','2026-08-01T00:00:00Z')",
      );
      legacy.exec(
        "INSERT INTO obligations(id,statement,status,blocker,opened_ts) VALUES(34,'live obligation','blocked','a blocker','2026-08-01T00:00:00Z')",
      );
      legacy.close();

      const db = connect(dbPath);
      const tables = new Set(
        (db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as {
          name: string;
        }[]).map((r) => r.name),
      );
      const watermark = (kind: string): number =>
        Number(
          (db.prepare("SELECT value FROM store_meta WHERE key = ?").get(
            `next_id.${kind}`,
          ) as { value: string }).value,
        );
      const blocked = db
        .prepare("SELECT status, blocker FROM obligations WHERE id = 34")
        .get() as { status: string; blocker: string | null };
      const marks = {
        fact: watermark("fact"),
        measurement: watermark("measurement"),
        obligation: watermark("obligation"),
      };
      db.close();

      assert.ok(tables.has("store_meta"), "the store was not rebuilt into the port schema");
      assert.ok(!tables.has("schema_meta"), "the legacy schema survived the rebuild");
      assert.equal(marks.fact, 37, "fact watermark must clear the live max id, not seed to 1");
      assert.equal(marks.measurement, 20, "measurement watermark must clear the live max id");
      assert.equal(marks.obligation, 35, "obligation watermark must clear the live max id");
      // "blocked" is not a declared status; it survives the migration as the
      // pair the model does declare, and nothing about the row is lost.
      assert.equal(blocked.status, "open");
      assert.equal(blocked.blocker, "a blocker");
    } finally {
      scrub(dbPath);
    }
  });
});

test("classifyStore rejects a legacy+port hybrid instead of calling it port-shaped", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-hybrid-"));
  try {
    const p = join(dir, "session.db");
    const db = new DatabaseSync(p);
    try {
      // The shape the pre-fix code produced: legacy schema still present, the
      // port's tables created beside it, watermarks at 1 against live ids.
      db.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT)");
      db.exec("INSERT INTO schema_meta VALUES('version','3')");
      db.exec("CREATE TABLE facts(id INTEGER PRIMARY KEY, statement TEXT)");
      db.exec("INSERT INTO facts VALUES(36,'live fact')");
      db.exec("CREATE TABLE store_meta(key TEXT PRIMARY KEY, value TEXT)");
      db.exec("INSERT INTO store_meta VALUES('next_id.fact','1')");
    } finally {
      db.close();
    }
    assert.equal(classifyStore(p), "corrupt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a read-only command refuses to migrate a legacy store", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-roguard-"));
  try {
    const p = join(dir, "session.db");
    const db = new DatabaseSync(p);
    try {
      db.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT)");
      db.exec("INSERT INTO schema_meta VALUES('version','3')");
      db.exec("CREATE TABLE facts(id INTEGER PRIMARY KEY, statement TEXT)");
    } finally {
      db.close();
    }
    const before = statSync(p).mtimeMs;
    const res = spawnSync(process.execPath, ["--import", TSX_LOADER, ENTRY, "recover"], {
      cwd: dir, encoding: "utf8",
      env: { ...process.env, FOREMAN_SESSION_DB: p },
    });
    assert.notEqual(res.status, 0, "recover migrated a legacy store instead of refusing");
    assert.match(res.stderr, /read-only command/);
    assert.equal(statSync(p).mtimeMs, before, "a read-only command modified the store");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read-only commands do not write to a healthy, existing port store", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-rohealthy-"));
  try {
    const p = join(dir, "session.db");
    const spawn = (cmd: string, args: readonly string[] = []) =>
      spawnSync(process.execPath, ["--import", TSX_LOADER, ENTRY, cmd, ...args], {
        cwd: dir, encoding: "utf8",
        env: { ...process.env, FOREMAN_SESSION_DB: p },
      });

    // A real write command, exactly as the CLI runs it: connect()'s own
    // conn is never explicitly closed (a separate, deferred finding), so
    // this leaves the WAL un-checkpointed on disk when the process exits --
    // the exact precondition finding A's own reproduction needs. Without it,
    // a subsequent plain (non-readonly) open+close would find nothing left
    // to checkpoint and the defect would pass unnoticed.
    const w = spawn("fact", ["seed fact"]);
    assert.equal(w.status, 0, w.stderr);

    const beforeBytes = readFileSync(p);
    const beforeMtime = statSync(p).mtimeMs;

    const r1 = spawn("recover");
    assert.equal(r1.status, 0, r1.stderr);
    const r2 = spawn("freshness");
    assert.equal(r2.status, 0, r2.stderr);
    // "sidecar" is the third READ_ONLY_CMDS member, and reaches the store
    // through a completely separate path (sidecarNdjson -> SqliteSessionStore
    // .open) that connect()'s own read-only guard does not cover by itself.
    const r3 = spawn("sidecar", ["--out", join(dir, "out.ndjson")]);
    assert.equal(r3.status, 0, r3.stderr);

    const afterBytes = readFileSync(p);
    const afterMtime = statSync(p).mtimeMs;
    assert.ok(Buffer.compare(beforeBytes, afterBytes) === 0, "a read-only command rewrote the store's bytes");
    assert.equal(afterMtime, beforeMtime, "a read-only command changed the store's mtime");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mintId and the row insert commit as one transaction", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-mint-"));
  try {
    const p = join(dir, "session.db");
    connect(p).close();

    const statements: string[] = [];
    const savedArgv = process.argv;
    const savedEnv = process.env.FOREMAN_SESSION_DB;
    let rc: number | undefined;
    try {
      // Drive the real command dispatch, not a hand-rolled simulation of it:
      // main() is exported precisely so a test can do this. A test that
      // issues BEGIN IMMEDIATE itself on two raw connections (the previous
      // version of this test) proves the SQLite mechanism inWriteTx depends
      // on, but never calls mintId or inWriteTx, so it cannot discriminate
      // whether fm-session-main.ts's own command handlers are wired through
      // either one.
      process.argv = [process.argv[0]!, process.argv[1]!, "fact", "concurrent fact"];
      process.env.FOREMAN_SESSION_DB = p;
      recordAndRestore(
        (sql) => statements.push(sql),
        () => { rc = main(); },
      );
    } finally {
      process.argv = savedArgv;
      if (savedEnv === undefined) delete process.env.FOREMAN_SESSION_DB;
      else process.env.FOREMAN_SESSION_DB = savedEnv;
    }
    assert.equal(rc, 0, "main() did not report success for a plain fact command");

    // classifyStore's own read-only cross-check issues an identically-worded
    // "SELECT value FROM store_meta WHERE key = ?" before the mint even
    // starts, so each search below is scoped to start after the previous
    // match rather than taking the first occurrence in the whole trace.
    const beginIdx = statements.indexOf("BEGIN IMMEDIATE");
    assert.ok(beginIdx !== -1, "mint must open BEGIN IMMEDIATE before reading the watermark");
    const selectIdx = statements.findIndex((s, i) => i > beginIdx && s.includes("SELECT value FROM store_meta"));
    assert.ok(selectIdx !== -1, "mint must read the watermark inside the transaction");
    const insertIdx = statements.findIndex((s, i) => i > selectIdx && s.includes("INSERT INTO facts"));
    assert.ok(insertIdx !== -1, "the row insert must happen inside the same transaction");
    const commitIdx = statements.findIndex((s, i) => i > insertIdx && s === "COMMIT");
    assert.ok(commitIdx !== -1, "the transaction must commit after the insert");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("classifyStore rejects a port file whose watermark sits behind its rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-behind-"));
  try {
    const p = join(dir, "session.db");
    const store = SqliteSessionStore.open(p);
    store.addFact({
      statement: "one", evidence: null,
      established_ts: "2026-08-08T10:00:00Z", session_id: null,
    });
    store.close();
    const db = new DatabaseSync(p);
    try {
      // Drive the watermark back behind the row it already minted.
      db.exec("UPDATE store_meta SET value='1' WHERE key='next_id.fact'");
    } finally {
      db.close();
    }
    assert.equal(classifyStore(p), "corrupt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
