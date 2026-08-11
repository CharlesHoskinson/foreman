import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connect, sidecarNdjson, importSidecar } from "./fm-session-main.js";

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
