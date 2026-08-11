import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, test } from "node:test";

import {
  ALL_CASES,
  formatReport,
  runSuite,
  seedFixture,
} from "./contract-suite.js";
import { encodeSnapshot } from "./sidecar.js";
import { openMemoryStore, SqliteSessionStore } from "./sqlite-store.js";
import { buildProjection, faultInjectionIndexes } from "./memory-index.js";
import { PROJECTABLE_FIELDS } from "./port.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("SessionStore contract suite (SQLite)", () => {
  it("passes every conformance case", () => {
    const report = runSuite(() => openMemoryStore());
    if (!report.ok) assert.fail(formatReport(report));
    assert.equal(report.failed, 0);
    assert.equal(report.results.length, ALL_CASES.length);
  });
});

describe("invariant I2 — correctness independence", () => {
  // The store takes no MemoryIndex at all: independence is structural, not
  // merely tested. These cases assert it stays that way.

  it("produces an identical snapshot regardless of MemoryIndex behaviour", async () => {
    const baselines: string[] = [];
    for (const index of faultInjectionIndexes()) {
      const store = openMemoryStore();
      try {
        seedFixture(store);
        baselines.push(encodeSnapshot(store.snapshot()));
      } finally {
        store.close();
      }
      // Touching the index must not be required for the store to be correct.
      assert.equal(typeof index.name, "string");
    }
    const first = baselines[0];
    for (const b of baselines) {
      assert.equal(b, first, "store output varied with MemoryIndex implementation");
    }
  });

  it("completes core operations without awaiting a hanging index", async () => {
    // If any store path awaited the MemoryIndex, this would never resolve.
    const done = await Promise.race([
      (async () => {
        const store = openMemoryStore();
        try {
          seedFixture(store);
          return "completed";
        } finally {
          store.close();
        }
      })(),
      new Promise<string>((r) => setTimeout(() => r("timed-out"), 2000)),
    ]);
    assert.equal(done, "completed");
  });

  it("keeps the system of record free of MemoryIndex imports", () => {
    for (const file of [
      "sqlite-store.ts",
      "entities.ts",
      "integrity.ts",
      "sidecar.ts",
      "sidecar-v1.ts",
    ]) {
      const src = readFileSync(join(here, file), "utf8");
      assert.ok(
        !src.includes("memory-index.js"),
        `${file} imports memory-index; the system of record must not depend on the projection`,
      );
      assert.ok(
        !/\bMemoryIndex\b/.test(src),
        `${file} references MemoryIndex; the system of record must not depend on the projection`,
      );
    }
  });
});

describe("projection", () => {
  it("emits only projectable fields", () => {
    const store = openMemoryStore();
    try {
      seedFixture(store);
      const records = buildProjection(store.snapshot());
      assert.ok(records.length > 0, "expected at least one projection record");

      // evidence/command/scope_paths carry paths and credentials; they must not
      // appear in anything destined for a third-party endpoint.
      const blob = records.map((r) => r.text).join("\n");
      assert.ok(
        !blob.includes("packages/session-store/src/entities.ts"),
        "evidence leaked into the projection",
      );
      assert.ok(
        !blob.includes("npm run typecheck"),
        "command leaked into the projection",
      );
      assert.ok(!blob.includes("abc123"), "sha leaked into the projection");
    } finally {
      store.close();
    }
  });

  it("does not project superseded rows", () => {
    const store = openMemoryStore();
    try {
      seedFixture(store);
      const superseded = store.listFacts().filter((f) => f.superseded_by !== null);
      assert.ok(superseded.length > 0, "fixture should contain a superseded fact");
      const ids = new Set(buildProjection(store.snapshot()).map((r) => `${r.kind}:${r.id}`));
      for (const row of superseded) {
        assert.ok(
          !ids.has(`fact:${row.id}`),
          `superseded fact ${row.id} was projected; stale recall poisons consumers`,
        );
      }
    } finally {
      store.close();
    }
  });

  it("declares no high-risk field as projectable", () => {
    const risky = ["evidence", "command", "scope_paths", "note", "start_sha"];
    for (const [kind, fields] of Object.entries(PROJECTABLE_FIELDS)) {
      for (const f of fields) {
        assert.ok(
          !risky.includes(f),
          `${kind}.${f} is declared projectable but carries paths or credentials`,
        );
      }
    }
  });
});

describe("schema drift", () => {
  it("rejects a SQLite schema that does not match the model", () => {
    const store = openMemoryStore();
    try {
      // Reach past the port deliberately to simulate a stray migration.
      const db = (store as unknown as { db: { exec(sql: string): void } }).db;
      db.exec("ALTER TABLE facts ADD COLUMN rogue TEXT");
      assert.throws(
        () => {
          const Ctor = store.constructor as new (
            db: unknown,
          ) => unknown;
          new Ctor(db);
        },
        /does not match the model/,
      );
    } finally {
      store.close();
    }
  });
});

test("sqlite store opens in WAL with a busy timeout", () => {
  const dir = mkdtempSync(join(tmpdir(), "pragma-"));
  const path = join(dir, "s.db");
  const store = SqliteSessionStore.open(path);
  // busy_timeout and synchronous are per-connection SQLite settings: unlike
  // journal_mode they are never persisted into the database file, so a fresh
  // DatabaseSync opened after store.close() would always read back the
  // connection defaults (timeout 0, synchronous FULL) no matter what the
  // store set. Read back through the store's own connection instead — that
  // is the only place the pragmas actually took effect.
  const db = (
    store as unknown as { db: { prepare(sql: string): { get(): unknown } } }
  ).db;
  const journal = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
  const busy = db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
  const sync = db.prepare("PRAGMA synchronous").get() as { synchronous: number };
  store.close();
  assert.equal(journal.journal_mode, "wal");
  assert.ok(busy.timeout >= 5000, `busy_timeout was ${busy.timeout}`);
  assert.equal(sync.synchronous, 1); // NORMAL
});
