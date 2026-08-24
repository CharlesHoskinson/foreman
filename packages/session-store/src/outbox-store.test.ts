import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

import { emptySnapshot } from "./entities.js";
import { SessionStoreError } from "./failures.js";
import { openFilesOnlyStore } from "./files-only.js";
import type { OutboxEntry, SessionStore } from "./port.js";
import { projectionKey } from "./projection.js";
import { openMemoryStore, SqliteSessionStore } from "./sqlite-store.js";

type BackendHarness = {
  readonly name: string;
  readonly withStore: <T>(
    fn: (store: SessionStore, reopen: () => SessionStore) => T,
  ) => T;
  readonly withReadOnly: <T>(
    seed: (store: SessionStore) => void,
    fn: (store: SessionStore) => T,
  ) => T;
};

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function assertInvalidArgument(fn: () => unknown): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof SessionStoreError);
    assert.equal(error.failure.reason, "invalid_argument");
    return true;
  });
}

function addFact(store: SessionStore, statement: string, ts: string) {
  return store.addFact({
    statement,
    evidence: "/secret/path",
    established_ts: ts,
    session_id: null,
  });
}

const sqliteHarness: BackendHarness = {
  name: "sqlite",
  withStore: (fn) => {
    const dir = tempDir("fm-outbox-sqlite-");
    const path = join(dir, "s.db");
    const store = SqliteSessionStore.open(path);
    try {
      return fn(store, () => {
        store.close();
        return SqliteSessionStore.open(path);
      });
    } finally {
      try {
        store.close();
      } catch {
        // already closed by reopen path
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
  withReadOnly: (seed, fn) => {
    const dir = tempDir("fm-outbox-sqlite-ro-");
    const path = join(dir, "s.db");
    const writable = SqliteSessionStore.open(path);
    try {
      seed(writable);
    } finally {
      writable.close();
    }
    const ro = SqliteSessionStore.open(path, { readOnly: true });
    try {
      return fn(ro);
    } finally {
      ro.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

const filesHarness: BackendHarness = {
  name: "files-only",
  withStore: (fn) => {
    const dir = tempDir("fm-outbox-files-");
    const store = openFilesOnlyStore({ dir });
    try {
      return fn(store, () => {
        store.close();
        return openFilesOnlyStore({ dir });
      });
    } finally {
      try {
        store.close();
      } catch {
        // already closed by reopen path
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
  withReadOnly: (seed, fn) => {
    const dir = tempDir("fm-outbox-files-ro-");
    const writable = openFilesOnlyStore({ dir });
    try {
      seed(writable);
    } finally {
      writable.close();
    }
    const ro = openFilesOnlyStore({ dir, readOnly: true });
    try {
      return fn(ro);
    } finally {
      ro.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

const HARNESSES: readonly BackendHarness[] = [sqliteHarness, filesHarness];

for (const harness of HARNESSES) {
  describe(`outbox store (${harness.name})`, () => {
    it("reopen persistence of outbox", () => {
      harness.withStore((store, reopen) => {
        const fact = addFact(store, "persisted", "2026-08-08T10:00:00Z");
        const before = store.listOutbox(100);
        const hit = before.find(
          (e) => e.record.kind === "fact" && e.record.id === fact.id,
        );
        assert.ok(hit, "write must queue outbox work");
        const again = reopen();
        try {
          const after = again.listOutbox(100);
          assert.ok(
            after.some((e) => e.receipt === hit.receipt),
            "outbox must survive reopen",
          );
          assert.equal(
            after.find((e) => e.receipt === hit.receipt)?.record.key,
            `fact:${fact.id}`,
          );
        } finally {
          again.close();
        }
      });
    });

    it("coalescing keeps stable order and issues a fresh receipt", () => {
      harness.withStore((store) => {
        const first = store.addObligation({
          statement: "open work",
          blocker: null,
          opened_ts: "2026-08-08T10:00:00Z",
          session_id: null,
        });
        const second = addFact(store, "other", "2026-08-08T10:01:00Z");
        const before = store.listOutbox(100);
        const firstIdx = before.findIndex(
          (e) => e.record.kind === "obligation" && e.record.id === first.id,
        );
        const secondIdx = before.findIndex(
          (e) => e.record.kind === "fact" && e.record.id === second.id,
        );
        assert.ok(firstIdx >= 0 && secondIdx >= 0);
        assert.ok(firstIdx < secondIdx, "earlier entity keeps earlier queue place");
        const oldReceipt = before[firstIdx]!.receipt;

        store.closeObligation(first.id, "done", "2026-08-08T10:02:00Z");
        const after = store.listOutbox(100);
        const firstAfterIdx = after.findIndex(
          (e) => e.record.kind === "obligation" && e.record.id === first.id,
        );
        const secondAfterIdx = after.findIndex(
          (e) => e.record.kind === "fact" && e.record.id === second.id,
        );
        assert.equal(firstAfterIdx, firstIdx, "coalesce must preserve position");
        assert.equal(secondAfterIdx, secondIdx);
        assert.notEqual(after[firstAfterIdx]!.receipt, oldReceipt, "fresh receipt");
        assert.equal(after[firstAfterIdx]!.record.mutation, "upsert");
      });
    });

    it("projection versions are monotonic, retained, and survive acknowledgement", () => {
      harness.withStore((store, reopen) => {
        const obligation = store.addObligation({
          statement: "versioned",
          blocker: null,
          opened_ts: "2026-08-08T10:00:00Z",
          session_id: null,
        });
        const first = store.listOutbox(100).find(
          (entry) =>
            entry.record.kind === "obligation" &&
            entry.record.id === obligation.id,
        );
        assert.ok(first);
        assert.equal(Number.isSafeInteger(first.record.projection_version), true);
        assert.equal(first.record.projection_version > 0, true);

        store.closeObligation(
          obligation.id,
          "done",
          "2026-08-08T10:01:00Z",
        );
        const second = store.listOutbox(100).find(
          (entry) =>
            entry.record.kind === "obligation" &&
            entry.record.id === obligation.id,
        );
        assert.ok(second);
        assert.equal(
          second.record.projection_version > first.record.projection_version,
          true,
          "coalescing must keep only the newer desired-state version",
        );
        assert.equal(store.ackOutbox([second.receipt]), 1);

        const again = reopen();
        try {
          const fact = addFact(again, "after ack", "2026-08-08T10:02:00Z");
          const third = again.listOutbox(100).find(
            (entry) => entry.record.kind === "fact" && entry.record.id === fact.id,
          );
          assert.ok(third);
          assert.equal(
            third.record.projection_version > second.record.projection_version,
            true,
            "acknowledgement and reopen must not reuse a version",
          );
        } finally {
          again.close();
        }
      });
    });

    it("supersede queues retract then upsert; retire queues retract", () => {
      harness.withStore((store) => {
        const fact = addFact(store, "old", "2026-08-08T10:00:00Z");
        const { replacement } = store.supersedeFact(
          fact.id,
          {
            statement: "new",
            evidence: null,
            established_ts: "2026-08-08T10:01:00Z",
            session_id: null,
          },
          "sharpened",
          "2026-08-08T10:01:00Z",
        );
        const afterSuper = store.listOutbox(100);
        const retract = afterSuper.find(
          (e) =>
            e.record.kind === "fact" &&
            e.record.id === fact.id &&
            e.record.mutation === "retract",
        );
        const upsert = afterSuper.find(
          (e) =>
            e.record.kind === "fact" &&
            e.record.id === replacement.id &&
            e.record.mutation === "upsert",
        );
        assert.ok(retract, "supersede must queue retract for the old id");
        assert.ok(upsert, "supersede must queue upsert for the replacement");
        assert.equal(retract.record.key, `fact:${fact.id}`);
        assert.equal(upsert.record.key, `fact:${replacement.id}`);

        const m1 = store.addMeasurement({
          metric: "m",
          value: "1",
          value_num: 1,
          command: null,
          measured_ts: "2026-08-08T10:02:00Z",
          measured_sha: null,
          scope_paths: null,
          session_id: null,
        });
        const m2 = store.addMeasurement({
          metric: "m",
          value: "2",
          value_num: 2,
          command: null,
          measured_ts: "2026-08-08T10:03:00Z",
          measured_sha: null,
          scope_paths: null,
          session_id: null,
        });
        store.retireMeasurement(m1.id, m2.id, "retired", "2026-08-08T10:04:00Z");
        const afterRetire = store.listOutbox(100);
        const retired = afterRetire.find(
          (e) =>
            e.record.kind === "measurement" &&
            e.record.id === m1.id &&
            e.record.mutation === "retract",
        );
        assert.ok(retired, "retire must queue retract for the retired measurement");
        assert.equal(retired.record.key, `measurement:${m1.id}`);
      });
    });

    it("stale-receipt CAS safety", () => {
      harness.withStore((store) => {
        const o = store.addObligation({
          statement: "cas",
          blocker: null,
          opened_ts: "2026-08-08T10:00:00Z",
          session_id: null,
        });
        const before = store.listOutbox(100);
        const entry = before.find(
          (e) => e.record.kind === "obligation" && e.record.id === o.id,
        );
        assert.ok(entry);
        const stale = entry.receipt;
        store.closeObligation(o.id, "done", "2026-08-08T10:01:00Z");
        const fresh = store
          .listOutbox(100)
          .find((e) => e.record.kind === "obligation" && e.record.id === o.id);
        assert.ok(fresh);
        assert.notEqual(fresh.receipt, stale);
        assert.equal(store.ackOutbox([stale]), 0, "stale receipt must delete 0");
        const still = store.listOutbox(100);
        assert.ok(
          still.some((e) => e.receipt === fresh.receipt),
          "fresh coalesced receipt must survive stale ack",
        );
      });
    });

    it("import delta overlay preserves unchanged pending work", () => {
      harness.withStore((store) => {
        const keep = addFact(store, "keep-me", "2026-08-08T10:00:00Z");
        const drop = addFact(store, "drop-me", "2026-08-08T10:01:00Z");
        const pendingBefore = store.listOutbox(100);
        const keepReceipt = pendingBefore.find(
          (e) => e.record.kind === "fact" && e.record.id === keep.id,
        )?.receipt;
        assert.ok(keepReceipt);

        // Import a snapshot that keeps `keep` unchanged and removes `drop`.
        const snap = store.snapshot();
        const imported = {
          ...emptySnapshot(),
          modelVersion: snap.modelVersion,
          nextIds: snap.nextIds,
          facts: snap.facts.filter((f) => f.id === keep.id),
        };
        store.importSnapshot(imported, { force: true });

        const after = store.listOutbox(100);
        assert.ok(
          after.some((e) => e.receipt === keepReceipt),
          "unchanged pending upsert must survive import overlay",
        );
        assert.ok(
          after.some(
            (e) =>
              e.record.kind === "fact" &&
              e.record.id === drop.id &&
              e.record.mutation === "retract",
          ),
          "removed live entity must queue a retract",
        );
      });
    });

    it("read-only ack refusal", () => {
      harness.withReadOnly(
        (store) => {
          addFact(store, "ro", "2026-08-08T10:00:00Z");
        },
        (ro) => {
          const pending = ro.listOutbox(100);
          assert.ok(pending.length > 0);
          assertInvalidArgument(() => ro.ackOutbox([pending[0]!.receipt]));
        },
      );
    });

    it("limit validation", () => {
      harness.withStore((store) => {
        for (const limit of [0, -1, 1001, 1.5, NaN]) {
          assertInvalidArgument(() => store.listOutbox(limit as number));
        }
        // Bound edges are accepted.
        assert.equal(Array.isArray(store.listOutbox(1)), true);
        assert.equal(Array.isArray(store.listOutbox(1000)), true);
      });
    });

    it("defensive returned values", () => {
      harness.withStore((store) => {
        addFact(store, "defensive", "2026-08-08T10:00:00Z");
        const listed = store.listOutbox(100) as OutboxEntry[];
        assert.ok(listed.length > 0);
        const original = listed[0]!;
        const receipt = original.receipt;
        const key = original.record.key;
        // Mutating the returned object must not corrupt store state.
        (original as { receipt: string }).receipt = "mutated-receipt";
        if (original.record.mutation === "upsert") {
          (original.record as { text: string }).text = "mutated-text";
          (original.record as { key: string }).key = "mutated:key";
        }
        const again = store.listOutbox(100);
        const still = again.find((e) => e.receipt === receipt);
        assert.ok(still, "store entry must be unaffected by caller mutation");
        assert.equal(still.record.key, key);
        if (still.record.mutation === "upsert") {
          assert.notEqual(still.record.text, "mutated-text");
        }
      });
    });
  });
}

describe("outbox store (in-memory sqlite smoke)", () => {
  it("openMemoryStore queues and acks", () => {
    const store = openMemoryStore();
    try {
      const fact = addFact(store, "mem", "2026-08-08T10:00:00Z");
      const entries = store.listOutbox(10);
      assert.ok(entries.some((e) => e.record.id === fact.id));
      const n = store.ackOutbox(entries.map((e) => e.receipt));
      assert.equal(n, entries.length);
      assert.equal(store.listOutbox(10).length, 0);
    } finally {
      store.close();
    }
  });
});

describe("sqlite pre-release outbox migration", () => {
  function installLegacyOutbox(path: string): void {
    const db = new DatabaseSync(path);
    try {
      db.exec("DROP TABLE IF EXISTS memory_outbox");
      db.exec(`
CREATE TABLE memory_outbox (
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  mutation TEXT NOT NULL,
  queued_ts TEXT NOT NULL
);`);
      db.prepare(
        "INSERT INTO memory_outbox (key, kind, entity_id, mutation, queued_ts) VALUES (?, ?, ?, ?, ?)",
      ).run("fact:999", "fact", 999, "upsert", "2026-01-01T00:00:00Z");
    } finally {
      db.close();
    }
  }

  it("read-only core access does not migrate; listOutbox refuses safely", () => {
    const dir = tempDir("fm-outbox-mig-ro-");
    const path = join(dir, "s.db");
    try {
      const seed = SqliteSessionStore.open(path);
      const live = addFact(seed, "live-mig", "2026-08-08T10:00:00Z");
      seed.supersedeFact(
        live.id,
        {
          statement: "replacement",
          evidence: null,
          established_ts: "2026-08-08T10:01:00Z",
          session_id: null,
        },
        "replace",
        "2026-08-08T10:01:00Z",
      );
      seed.close();
      installLegacyOutbox(path);

      const ro = SqliteSessionStore.open(path, { readOnly: true });
      try {
        assert.ok(ro.listFacts().length >= 1);
        assert.throws(
          () => ro.listOutbox(10),
          (error: unknown) => {
            assert.ok(error instanceof SessionStoreError);
            assert.equal(error.failure.reason, "backend_mismatch");
            assert.match(error.message, /pre-release schema|reopen writable/);
            return true;
          },
        );
        const raw = new DatabaseSync(path, { readOnly: true });
        try {
          const cols = (
            raw.prepare("PRAGMA table_info(memory_outbox)").all() as {
              name: string;
            }[]
          ).map((c) => c.name);
          assert.ok(cols.includes("queued_ts"), "read-only must not migrate");
          assert.equal(cols.includes("receipt"), false);
        } finally {
          raw.close();
        }
      } finally {
        ro.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writable open migrates transactionally to live sanitized upserts only", () => {
    const dir = tempDir("fm-outbox-mig-rw-");
    const path = join(dir, "s.db");
    try {
      const seed = SqliteSessionStore.open(path);
      const keep = addFact(seed, "keep-live", "2026-08-08T10:00:00Z");
      const empty = seed.addFact({
        statement: "",
        evidence: "/secret",
        established_ts: "2026-08-08T10:00:30Z",
        session_id: null,
      });
      const old = addFact(seed, "will-supersede", "2026-08-08T10:01:00Z");
      seed.supersedeFact(
        old.id,
        {
          statement: "replacement-live",
          evidence: null,
          established_ts: "2026-08-08T10:02:00Z",
          session_id: null,
        },
        "replace",
        "2026-08-08T10:02:00Z",
      );
      const liveIds = new Set(
        seed
          .listFacts()
          .filter((f) => f.superseded_by === null)
          .map((f) => f.id),
      );
      assert.ok(liveIds.has(keep.id));
      assert.ok(liveIds.has(empty.id));
      assert.equal(liveIds.has(old.id), false);
      seed.close();
      installLegacyOutbox(path);

      const migrated = SqliteSessionStore.open(path);
      try {
        const entries = migrated.listOutbox(1000);
        const receipts = entries.map((e) => e.receipt);
        assert.equal(new Set(receipts).size, receipts.length, "receipts unique");
        assert.ok(
          entries.every((e) => e.record.mutation === "upsert"),
          "migration seeds upserts only",
        );
        const keys = entries.map((e) => e.record.key);
        assert.ok(keys.includes(projectionKey("fact", keep.id)));
        assert.ok(keys.includes(projectionKey("fact", empty.id)));
        assert.equal(
          keys.includes(projectionKey("fact", old.id)),
          false,
          "superseded rows must be absent",
        );
        assert.equal(
          entries.some((e) => e.record.id === 999),
          false,
          "legacy junk rows must not survive",
        );
        const emptyEntry = entries.find((e) => e.record.id === empty.id);
        assert.ok(emptyEntry);
        if (emptyEntry.record.mutation === "upsert") {
          assert.equal(emptyEntry.record.text, "");
        }

        // Queue order is stable across reopen.
        const firstOrder = entries.map((e) => e.receipt);
        migrated.close();
        const again = SqliteSessionStore.open(path);
        try {
          const second = again.listOutbox(1000);
          assert.deepEqual(
            second.map((e) => e.receipt),
            firstOrder,
            "second writable reopen must be idempotent",
          );
          assert.equal(second.length, entries.length);
        } finally {
          again.close();
        }
      } finally {
        try {
          migrated.close();
        } catch {
          // closed by idempotent reopen path
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writable open refuses an unrecognized outbox schema", () => {
    const dir = tempDir("fm-outbox-mig-bad-");
    const path = join(dir, "s.db");
    try {
      SqliteSessionStore.open(path).close();
      const db = new DatabaseSync(path);
      try {
        db.exec("DROP TABLE IF EXISTS memory_outbox");
        db.exec("CREATE TABLE memory_outbox (weird TEXT PRIMARY KEY)");
      } finally {
        db.close();
      }
      assert.throws(
        () => SqliteSessionStore.open(path),
        (error: unknown) => {
          assert.ok(error instanceof SessionStoreError);
          assert.equal(error.failure.reason, "backend_mismatch");
          assert.match(error.message, /not recognized/);
          return true;
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("listOutbox rejects a persisted mutation other than upsert or retract", () => {
    const dir = tempDir("fm-outbox-bad-mut-");
    const path = join(dir, "s.db");
    try {
      const store = SqliteSessionStore.open(path);
      addFact(store, "mut", "2026-08-08T10:00:00Z");
      store.close();
      const db = new DatabaseSync(path);
      try {
        db.prepare("UPDATE memory_outbox SET mutation = ?").run("merge");
      } finally {
        db.close();
      }
      const reopened = SqliteSessionStore.open(path);
      try {
        assert.throws(
          () => reopened.listOutbox(10),
          (error: unknown) => {
            assert.ok(error instanceof SessionStoreError);
            assert.equal(error.failure.reason, "backend_mismatch");
            assert.match(error.message, /mutation/);
            return true;
          },
        );
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sqlite next_receipt counter validation", () => {
  function setNextReceipt(path: string, value: string | null): void {
    const db = new DatabaseSync(path);
    try {
      db.prepare("DELETE FROM store_meta WHERE key = ?").run("next_receipt");
      if (value !== null) {
        db.prepare("INSERT INTO store_meta (key, value) VALUES (?, ?)").run(
          "next_receipt",
          value,
        );
      }
    } finally {
      db.close();
    }
  }

  function metaValue(path: string, key: string): string | undefined {
    const db = new DatabaseSync(path);
    try {
      const row = db
        .prepare("SELECT value FROM store_meta WHERE key = ?")
        .get(key) as { value: string } | undefined;
      return row?.value;
    } finally {
      db.close();
    }
  }

  function assertBackendMismatchOpen(path: string, messagePat: RegExp): void {
    assert.throws(
      () => SqliteSessionStore.open(path),
      (error: unknown) => {
        assert.ok(error instanceof SessionStoreError);
        assert.equal(error.failure.reason, "backend_mismatch");
        assert.match(error.message, messagePat);
        return true;
      },
    );
  }

  it("refuses a stale next_receipt equal to a pending numeric receipt", () => {
    const dir = tempDir("fm-nr-stale-");
    const path = join(dir, "s.db");
    try {
      const store = SqliteSessionStore.open(path);
      addFact(store, "stale-counter", "2026-08-08T10:00:00Z");
      store.close();
      setNextReceipt(path, "1");
      assertBackendMismatchOpen(path, /strictly greater|next_receipt/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses missing next_receipt when the outbox is nonempty", () => {
    const dir = tempDir("fm-nr-missing-pending-");
    const path = join(dir, "s.db");
    try {
      const store = SqliteSessionStore.open(path);
      addFact(store, "pending", "2026-08-08T10:00:00Z");
      store.close();
      setNextReceipt(path, null);
      assertBackendMismatchOpen(path, /missing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("initializes missing next_receipt to 1 when the outbox is empty", () => {
    const dir = tempDir("fm-nr-missing-empty-");
    const path = join(dir, "s.db");
    try {
      SqliteSessionStore.open(path).close();
      setNextReceipt(path, null);
      const store = SqliteSessionStore.open(path);
      try {
        assert.equal(metaValue(path, "next_receipt"), "1");
        const fact = addFact(store, "after-init", "2026-08-08T10:00:00Z");
        const entries = store.listOutbox(10);
        assert.equal(entries[0]?.receipt, "r1");
        assert.equal(entries[0]?.record.id, fact.id);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses malformed and unsafe next_receipt strings", () => {
    const cases: ReadonlyArray<{ value: string; label: string }> = [
      { value: "01", label: "leading-zero" },
      { value: "0", label: "zero" },
      { value: "-1", label: "negative" },
      { value: "1.5", label: "fraction" },
      { value: "1e2", label: "exponent" },
      { value: " 1", label: "whitespace" },
      { value: "9007199254740992", label: "above-max-safe" },
      { value: "not-a-number", label: "garbage" },
    ];
    for (const c of cases) {
      const dir = tempDir(`fm-nr-bad-${c.label}-`);
      const path = join(dir, "s.db");
      try {
        SqliteSessionStore.open(path).close();
        setNextReceipt(path, c.value);
        assertBackendMismatchOpen(path, /canonical|next_receipt|safe integer/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("opens an exhausted counter for list/ack and refuses writes atomically", () => {
    const dir = tempDir("fm-nr-exhausted-");
    const path = join(dir, "s.db");
    try {
      const seed = SqliteSessionStore.open(path);
      const fact = addFact(seed, "keep", "2026-08-08T10:00:00Z");
      const receipt = seed.listOutbox(10)[0]?.receipt;
      assert.ok(receipt);
      seed.close();

      setNextReceipt(path, String(Number.MAX_SAFE_INTEGER));
      const store = SqliteSessionStore.open(path);
      try {
        const listed = store.listOutbox(10);
        assert.equal(listed.length, 1);
        assert.equal(listed[0]?.receipt, receipt);
        assert.equal(store.ackOutbox([receipt]), 1);
        assert.equal(store.listOutbox(10).length, 0);

        const factsBefore = store.listFacts().map((f) => f.id);
        assert.throws(
          () => addFact(store, "past-exhaustion", "2026-08-08T11:00:00Z"),
          (error: unknown) => {
            assert.ok(error instanceof SessionStoreError);
            assert.equal(error.failure.reason, "invalid_argument");
            assert.match(error.message, /exhausted/);
            return true;
          },
        );
        assert.deepEqual(
          store.listFacts().map((f) => f.id),
          factsBefore,
        );
        assert.equal(store.listOutbox(10).length, 0);
        assert.equal(metaValue(path, "next_receipt"), String(Number.MAX_SAFE_INTEGER));
        assert.ok(factsBefore.includes(fact.id));
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("legacy migration resets garbage or stale next_receipt before seeding", () => {
    for (const stale of ["garbage", "1", "999999"] as const) {
      const dir = tempDir(`fm-nr-mig-${stale}-`);
      const path = join(dir, "s.db");
      try {
        const seed = SqliteSessionStore.open(path);
        const live = addFact(seed, "live-mig-counter", "2026-08-08T10:00:00Z");
        seed.close();

        const db = new DatabaseSync(path);
        try {
          db.exec("DROP TABLE IF EXISTS memory_outbox");
          db.exec(`
CREATE TABLE memory_outbox (
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  mutation TEXT NOT NULL,
  queued_ts TEXT NOT NULL
);`);
          db.prepare(
            "INSERT INTO memory_outbox (key, kind, entity_id, mutation, queued_ts) VALUES (?, ?, ?, ?, ?)",
          ).run("fact:999", "fact", 999, "upsert", "2026-01-01T00:00:00Z");
          db.prepare("DELETE FROM store_meta WHERE key = ?").run("next_receipt");
          db.prepare("INSERT INTO store_meta (key, value) VALUES (?, ?)").run(
            "next_receipt",
            stale,
          );
        } finally {
          db.close();
        }

        const migrated = SqliteSessionStore.open(path);
        try {
          assert.equal(metaValue(path, "next_receipt"), "2");
          const entries = migrated.listOutbox(100);
          assert.equal(entries.length, 1);
          assert.equal(entries[0]?.receipt, "r1");
          assert.equal(entries[0]?.record.id, live.id);
          assert.equal(migrated.ackOutbox(["r1"]), 1);
          assert.equal(migrated.ackOutbox(["r1"]), 0, "stale ack deletes 0");
          assert.equal(migrated.listOutbox(10).length, 0);
        } finally {
          migrated.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
