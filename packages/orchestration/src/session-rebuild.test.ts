import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteSessionStore } from "@foreman/session-store";
import { rebuildFromSidecar } from "./session-rebuild.js";

const V1 = [
  `{"format": "foreman-session-sidecar", "format_version": 1}`,
  `{"table": "schema_meta", "row": {"key": "version", "value": "3"}}`,
  `{"table": "obligations", "row": {"id": 4, "statement": "s", "status": "blocked", "blocker": "why", "opened_ts": "2026-01-01T00:00:00Z", "closed_ts": null, "session_id": null}}`,
  "",
].join("\n");

function fixture(): { sidecarPath: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "rebuild-"));
  const sidecarPath = join(dir, "session.ndjson");
  writeFileSync(sidecarPath, V1, "utf8");
  return { sidecarPath, dbPath: join(dir, "session.db") };
}

test("rebuilds a fresh database from a v1 sidecar", () => {
  const paths = fixture();
  const res = rebuildFromSidecar(paths);
  assert.equal(existsSync(paths.dbPath), true);
  assert.equal(res.rowsWritten, 1);
});

test("watermarks exceed the highest live id", () => {
  const paths = fixture();
  const res = rebuildFromSidecar(paths);
  assert.equal(res.nextIds.obligation, 5);
});

test("normalizes blocked to open through the rebuild", () => {
  const paths = fixture();
  rebuildFromSidecar(paths);
  const db = new DatabaseSync(paths.dbPath);
  const row = db.prepare("SELECT status, blocker FROM obligations WHERE id = 4").get() as
    | { status: string; blocker: string | null }
    | undefined;
  db.close();
  assert.equal(row?.status, "open");
  assert.equal(row?.blocker, "why");
});

test("refuses to overwrite an existing database without force", () => {
  const paths = fixture();
  rebuildFromSidecar(paths);
  assert.throws(() => rebuildFromSidecar(paths));
});

test("CRITICAL 4: leftover destination WAL must not resurrect discarded rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "rebuild-wal-"));
  try {
    const dbPath = join(dir, "session.db");
    const sidecarPath = join(dir, "session.ndjson");
    const holder = SqliteSessionStore.open(dbPath);
    holder.addFact({
      statement: "POISON-SHOULD-NOT-SURVIVE",
      evidence: null,
      established_ts: "2026-08-01T00:00:00Z",
      session_id: null,
    });
    holder.addFact({
      statement: "WAL-LEFTOVER",
      evidence: null,
      established_ts: "2026-08-01T00:00:01Z",
      session_id: null,
    });
    assert.ok(
      existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`),
      "precondition: the holder must leave a journal file",
    );

    writeFileSync(
      sidecarPath,
      [
        `{"format": "foreman-session-sidecar", "format_version": 1}`,
        `{"table": "facts", "row": {"id": 1, "statement": "original-fact", "evidence": null, "established_ts": "2026-01-01T00:00:00Z", "session_id": null, "superseded_by": null, "superseded_at": null, "supersede_reason": null}}`,
        "",
      ].join("\n"),
    );

    const res = rebuildFromSidecar({ sidecarPath, dbPath, force: true });
    assert.equal(res.rowsWritten, 1);
    holder.close();

    assert.equal(existsSync(`${dbPath}-wal`), false, "destination -wal survived the rename");
    assert.equal(existsSync(`${dbPath}-shm`), false, "destination -shm survived the rename");
    assert.equal(existsSync(`${dbPath}.rebuild-wal`), false, "temp -wal was left behind");
    assert.equal(existsSync(`${dbPath}.rebuild-shm`), false, "temp -shm was left behind");

    const after = SqliteSessionStore.open(dbPath);
    try {
      const statements = after.listFacts().map((f) => f.statement);
      assert.deepEqual(statements, ["original-fact"]);
      assert.ok(!statements.includes("POISON-SHOULD-NOT-SURVIVE"));
      assert.ok(!statements.includes("WAL-LEFTOVER"));
    } finally {
      after.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FIX 6: a failed rename must leave the destination WAL in place", () => {
  const dir = mkdtempSync(join(tmpdir(), "rebuild-rename-fail-"));
  try {
    const dbPath = join(dir, "session.db");
    const sidecarPath = join(dir, "session.ndjson");
    mkdirSync(dbPath);
    writeFileSync(`${dbPath}-wal`, "pre-existing-wal-bytes");
    writeFileSync(
      sidecarPath,
      [
        `{"format": "foreman-session-sidecar", "format_version": 1}`,
        `{"table": "facts", "row": {"id": 1, "statement": "original-fact", "evidence": null, "established_ts": "2026-01-01T00:00:00Z", "session_id": null, "superseded_by": null, "superseded_at": null, "supersede_reason": null}}`,
        "",
      ].join("\n"),
    );

    assert.throws(() => rebuildFromSidecar({ sidecarPath, dbPath, force: true }));
    assert.equal(
      existsSync(`${dbPath}-wal`),
      true,
      "destination -wal was removed before a rename that then failed",
    );
    assert.equal(readFileSync(`${dbPath}-wal`, "utf8"), "pre-existing-wal-bytes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R3 FIX 2: dest journal must be gone even if work after rename throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "rebuild-window-"));
  try {
    const dbPath = join(dir, "session.db");
    const sidecarPath = join(dir, "session.ndjson");
    const holder = SqliteSessionStore.open(dbPath);
    holder.addFact({
      statement: "POISON-SHOULD-NOT-SURVIVE",
      evidence: null,
      established_ts: "2026-08-01T00:00:00Z",
      session_id: null,
    });
    assert.equal(
      existsSync(`${dbPath}-wal`),
      true,
      "precondition: the holder must leave dest-wal so the aside construction has a file to move",
    );
    writeFileSync(
      sidecarPath,
      [
        `{"format": "foreman-session-sidecar", "format_version": 1}`,
        `{"table": "facts", "row": {"id": 1, "statement": "original-fact", "evidence": null, "established_ts": "2026-01-01T00:00:00Z", "session_id": null, "superseded_by": null, "superseded_at": null, "supersede_reason": null}}`,
        "",
      ].join("\n"),
    );

    let destJournalAfterRename = true;
    let asideWalAfterRename = false;
    assert.throws(
      () =>
        rebuildFromSidecar({
          sidecarPath,
          dbPath,
          force: true,
          afterRename: () => {
            destJournalAfterRename =
              existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`);
            asideWalAfterRename = existsSync(`${dbPath}-wal.rebuild-aside`);
            throw new Error("stop-after-rename");
          },
        }),
      /stop-after-rename/,
    );
    holder.close();
    assert.equal(
      destJournalAfterRename,
      false,
      "destination journal still existed after rename; a crash here resurrects discarded rows",
    );
    assert.equal(
      asideWalAfterRename,
      true,
      "dest-wal must sit at .rebuild-aside at the hook; pre-fix rename-then-remove never creates that path",
    );
    assert.equal(existsSync(`${dbPath}-wal`), false, "destination -wal survived the throw");
    assert.equal(existsSync(`${dbPath}-shm`), false, "destination -shm survived the throw");
    assert.equal(
      existsSync(`${dbPath}-wal.rebuild-aside`),
      false,
      "aside -wal was left beside the replacement",
    );
    assert.equal(
      existsSync(`${dbPath}-shm.rebuild-aside`),
      false,
      "aside -shm was left beside the replacement",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
