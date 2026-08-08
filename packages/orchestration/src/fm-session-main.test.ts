import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connect, sidecarNdjson, importSidecar } from "./fm-session-main.js";

describe("fm-session-main atomicity and locks", () => {
  it("(b) sidecar reads every table from one SQLite snapshot", () => {
    const dbPath = join(tmpdir(), `test-b-${Date.now()}.db`);
    try {
      const db = connect(dbPath);
      db.exec("PRAGMA journal_mode=WAL");
      
      const origPrepare = db.prepare;
      let committed = false;
      db.prepare = function (sql: string) {
        if (!committed && sql.includes('"measurements"')) {
          const writer = new DatabaseSync(dbPath);
          writer.exec("PRAGMA journal_mode=WAL");
          writer.exec("INSERT INTO facts(statement,established_ts) VALUES('concurrent fact','now')");
          writer.exec("INSERT INTO measurements(metric,value,measured_ts) VALUES('concurrent metric','1','now')");
          writer.close();
          committed = true;
        }
        return origPrepare.call(this, sql);
      };
      
      const [ndjson] = sidecarNdjson(db);
      assert.ok(committed, "writer did not commit between table reads");
      
      const lines = ndjson.split("\n").filter(Boolean);
      const facts = lines.filter(l => l.includes('"table": "facts"'));
      const measurements = lines.filter(l => l.includes('"table": "measurements"'));
      
      assert.equal(facts.length, measurements.length, "snapshot must be consistent: length of facts should match measurements");
      assert.equal(facts.length, 0, "concurrently inserted facts should not be visible");
    } finally {
      try { rmSync(dbPath); rmSync(dbPath + "-shm"); rmSync(dbPath + "-wal"); } catch {}
    }
  });

  it("(c) import-sidecar checks for rows after acquiring the write lock", () => {
    const dbPath = join(tmpdir(), `test-c-${Date.now()}.db`);
    const targetDbPath = join(tmpdir(), `test-c-target-${Date.now()}.db`);
    const sidecarPath = join(tmpdir(), `test-c-${Date.now()}.ndjson`);
    try {
      const setupDb = connect(dbPath);
      setupDb.exec("INSERT INTO facts(statement,established_ts) VALUES('source fact','now')");
      const [ndjson] = sidecarNdjson(setupDb);
      writeFileSync(sidecarPath, ndjson);
      setupDb.close();
      
      const targetDb = connect(targetDbPath);
      
      const statements: string[] = [];
      const origExec = targetDb.exec;
      targetDb.exec = function (sql: string) {
        statements.push(sql);
        return origExec.call(this, sql);
      };
      
      const origPrepare = targetDb.prepare;
      targetDb.prepare = function (sql: string) {
        statements.push(sql);
        return origPrepare.call(this, sql);
      };
      
      importSidecar(targetDb, sidecarPath);
      targetDb.close();
      
      const beginIdx = statements.findIndex(s => s === "BEGIN IMMEDIATE");
      const checkIdx = statements.findIndex(s => s.startsWith('SELECT 1 FROM '));
      
      assert.ok(beginIdx !== -1, "must execute BEGIN IMMEDIATE");
      assert.ok(checkIdx !== -1, "must execute a row existence check (SELECT 1 FROM...)");
      assert.ok(beginIdx < checkIdx, `write lock must be acquired before row check. BEGIN at ${beginIdx}, SELECT at ${checkIdx}`);
    } finally {
      try { rmSync(dbPath); rmSync(targetDbPath); rmSync(sidecarPath); } catch {}
      try { rmSync(dbPath + "-shm"); rmSync(dbPath + "-wal"); } catch {}
      try { rmSync(targetDbPath + "-shm"); rmSync(targetDbPath + "-wal"); } catch {}
    }
  });
});
