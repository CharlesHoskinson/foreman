import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { SqliteSessionStore } from "./sqlite-store.js";

const here = dirname(fileURLToPath(import.meta.url));

test("W3.7: ensureCounters uses INSERT OR IGNORE", () => {
  const src = readFileSync(join(here, "sqlite-store.ts"), "utf8");
  assert.match(src, /INSERT OR IGNORE INTO store_meta/);
});

test("W3.7: first open seeds counters; a later open does not reset them", () => {
  const dir = mkdtempSync(join(tmpdir(), "w37-counters-"));
  const p = join(dir, "session.db");
  try {
    const first = SqliteSessionStore.open(p);
    try {
      assert.equal(first.peekNextId("fact"), 1);
      assert.equal(first.peekNextId("measurement"), 1);
      assert.equal(first.peekNextId("obligation"), 1);
      first.addFact({
        statement: "seed",
        evidence: null,
        established_ts: "2026-08-08T10:00:00Z",
        session_id: null,
      });
      assert.equal(first.peekNextId("fact"), 2);
    } finally {
      first.close();
    }
    const second = SqliteSessionStore.open(p);
    try {
      assert.equal(second.peekNextId("fact"), 2, "re-open must not re-seed next_id.fact to 1");
    } finally {
      second.close();
    }
    const raw = new DatabaseSync(p);
    try {
      const rows = raw
        .prepare("SELECT key, value FROM store_meta WHERE key LIKE 'next_id.%' ORDER BY key")
        .all() as { key: string; value: string }[];
      assert.deepEqual(
        rows.map((r) => [r.key, r.value]),
        [
          ["next_id.fact", "2"],
          ["next_id.measurement", "1"],
          ["next_id.obligation", "1"],
        ],
      );
    } finally {
      raw.close();
    }
    const ro = SqliteSessionStore.open(p, { readOnly: true });
    try {
      assert.equal(ro.peekNextId("fact"), 2, "read-only open must not write or reset counters");
    } finally {
      ro.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
