import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, test } from "node:test";

import {
  ALL_CASES,
  MIN_INDEPENDENT_STUB_CATEGORIES,
  STORE_CASES,
  failedCategories,
  formatReport,
  runSuite,
  seedFixture,
  stubFactory,
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
      "files-only.ts",
      "entities.ts",
      "integrity.ts",
      "sidecar.ts",
      "sidecar-v1.ts",
      "projection.ts",
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
      const ids = new Set(buildProjection(store.snapshot()).map((r) => r.key));
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

  it("uses kind:id keys with mutation as a field, not part of the key", () => {
    const store = openMemoryStore();
    try {
      seedFixture(store);
      const records = buildProjection(store.snapshot());
      assert.ok(records.length > 0);
      for (const r of records) {
        assert.equal(r.key, `${r.kind}:${r.id}`);
        assert.equal(r.mutation, "upsert");
        assert.equal(r.key.includes("upsert"), false);
        assert.equal(typeof r.text, "string");
      }
    } finally {
      store.close();
    }
  });

  it("emits an upsert for every live entity even when projectable text is empty", () => {
    const store = openMemoryStore();
    try {
      const row = store.addFact({
        statement: "",
        evidence: "/secret",
        established_ts: "2026-08-08T10:00:00Z",
        session_id: null,
      });
      const projected = buildProjection(store.snapshot());
      const empty = projected.find((r) => r.key === `fact:${row.id}`);
      assert.ok(empty, "buildProjection must emit the empty-text live fact");
      assert.equal(empty.mutation, "upsert");
      assert.equal(empty.text, "");

      const queued = store.listOutbox(100);
      const q = queued.find(
        (e) => e.record.kind === "fact" && e.record.id === row.id,
      );
      assert.ok(q, "commit queueing must use the same empty-text upsert semantics");
      assert.equal(q.record.mutation, "upsert");
      if (q.record.mutation === "upsert") assert.equal(q.record.text, "");
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


describe("conformance suite soundness (negative control)", () => {
  // A suite that cannot fail a broken store is not evidence about a good one.
  // graph-store has had this control since v0.2.9 (stubFactory, StubEmptyBackend,
  // MIN_INDEPENDENT_STUB_CATEGORIES); session-store shipped without one.

  it("records how many cases actually exercise the store factory", () => {
    // Most of ALL_CASES never constructs a store: every hostile/* case and both
    // supersession/fan-in-* cases read SessionSnapshot literals through
    // findViolations. Only the rest can discriminate a backend. These counts are
    // pinned so that a case added without a factory parameter shows up here
    // rather than silently diluting the control below.
    assert.equal(ALL_CASES.length, 40);
    assert.equal(STORE_CASES.length, 23);
  });

  it("fails a do-nothing backend across at least three independent categories", () => {
    const report = runSuite(stubFactory);
    assert.equal(report.ok, false, "a do-nothing backend passed the conformance suite");
    const cats = failedCategories(report);
    assert.ok(
      cats.size >= MIN_INDEPENDENT_STUB_CATEGORIES,
      `stub failed only ${cats.size} categor${cats.size === 1 ? "y" : "ies"} ` +
        `(${[...cats].sort().join(", ") || "none"}); expected at least ` +
        `${MIN_INDEPENDENT_STUB_CATEGORIES}`,
    );
  });

  it("pins the store cases that a do-nothing backend still passes", () => {
    // Measured 2026-08-17. These seven take the factory yet survive a backend
    // that persists nothing, so they are not testing what their names claim.
    // roundtrip/populated-store is the starkest: a roundtrip case that a
    // do-nothing store passes is not exercising a roundtrip.
    //
    // This is pinned rather than fixed here because strengthening a conformance
    // case changes what the contract means, and that belongs with the second
    // implementation, where a cross-backend byte comparison can show which
    // behaviour is the correct one. Until then the weakness is visible instead
    // of silent: strengthen a case and this list fails, so it gets updated
    // deliberately.
    const report = runSuite(stubFactory);
    const storeCaseNames = new Set(STORE_CASES.map((c) => c.name));
    const blindStoreCases = report.results
      .filter((r) => r.passed && storeCaseNames.has(r.name))
      .map((r) => r.name)
      .sort();
    assert.deepEqual(blindStoreCases, [
      "encoding/byte-stable-across-repeated-encodes",
      "encoding/ends-with-exactly-one-newline",
      "identity/allocation-state-round-trips",
      "retire/points-one-existing-measurement-at-another",
      "roundtrip/empty-store",
      "roundtrip/import-of-export-is-equal",
      "roundtrip/populated-store",
    ]);
  });

  it("passes the stub on every case that does not take the factory", () => {
    // The point of the control, stated as an assertion: these cases are blind to
    // the backend, so a green result from them proves nothing about a store.
    const report = runSuite(stubFactory);
    const storeCaseNames = new Set(STORE_CASES.map((c) => c.name));
    const blind = report.results.filter((r) => !storeCaseNames.has(r.name));
    assert.equal(blind.length, ALL_CASES.length - STORE_CASES.length);
    assert.ok(
      blind.every((r) => r.passed),
      "a non-factory case failed against the stub, so it is not backend-blind after all",
    );
  });
});
