import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
