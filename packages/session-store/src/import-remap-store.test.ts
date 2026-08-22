import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

import {
  countRows,
  emptySnapshot,
  type SessionSnapshot,
} from "./entities.js";
import { SessionStoreError } from "./failures.js";
import { openFilesOnlyStore } from "./files-only.js";
import {
  additiveImportProjectionUpserts,
  planAdditiveRemapImport,
} from "./import-remap.js";
import type { OutboxEntry, SessionStore } from "./port.js";
import { encodeSnapshot } from "./sidecar.js";
import { SqliteSessionStore } from "./sqlite-store.js";

const LAST_MINTABLE_RECEIPT = Number.MAX_SAFE_INTEGER - 1;

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function ended(session_id: string): SessionSnapshot["sessions"][number] {
  return {
    session_id,
    started_ts: "2026-08-08T10:00:00Z",
    start_sha: null,
    ended_ts: "2026-08-08T11:00:00Z",
    note: null,
  };
}

function donorWithLiveAndSuperseded(): SessionSnapshot {
  return {
    ...emptySnapshot(),
    nextIds: { fact: 3, measurement: 1, obligation: 2 },
    sessions: [ended("D1")],
    facts: [
      {
        id: 1,
        statement: "pred",
        evidence: "/secret/path",
        established_ts: "2026-08-09T10:00:00Z",
        session_id: "D1",
        superseded_by: 2,
        superseded_at: "2026-08-09T10:01:00Z",
        supersede_reason: "rewritten",
      },
      {
        id: 2,
        statement: "live-import",
        evidence: "/secret/path",
        established_ts: "2026-08-09T10:01:00Z",
        session_id: "D1",
        superseded_by: null,
        superseded_at: null,
        supersede_reason: null,
      },
    ],
    obligations: [
      {
        id: 1,
        statement: "ob-live",
        status: "open",
        blocker: null,
        opened_ts: "2026-08-09T10:02:00Z",
        closed_ts: null,
        session_id: "D1",
      },
    ],
  };
}

function seedTarget(store: SessionStore): void {
  store.beginSession({
    session_id: "T1",
    started_ts: "2026-08-08T09:00:00Z",
    start_sha: null,
    note: null,
  });
  store.endSession("T1", "2026-08-08T09:30:00Z");
  store.addFact({
    statement: "target-keep",
    evidence: "/target/secret",
    established_ts: "2026-08-08T09:01:00Z",
    session_id: "T1",
  });
}

function assertInvalidArgument(fn: () => unknown, match?: RegExp): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof SessionStoreError);
    assert.equal(error.failure.reason, "invalid_argument");
    if (match) assert.match(error.message, match);
    return true;
  });
}

function metaValue(path: string, key: string): string | null {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db
      .prepare("SELECT value FROM store_meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } finally {
    db.close();
  }
}

function setNextReceipt(path: string, value: string): void {
  const db = new DatabaseSync(path);
  try {
    db.prepare(
      "INSERT INTO store_meta (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run("next_receipt", value);
  } finally {
    db.close();
  }
}

type Harness = {
  readonly name: string;
  readonly withStore: <T>(
    fn: (store: SessionStore, reopen: () => SessionStore, root: string) => T,
  ) => T;
};

const sqliteHarness: Harness = {
  name: "sqlite",
  withStore: (fn) => {
    const dir = tempDir("fm-remap-sqlite-");
    const path = join(dir, "s.db");
    const store = SqliteSessionStore.open(path);
    try {
      return fn(
        store,
        () => {
          store.close();
          return SqliteSessionStore.open(path);
        },
        path,
      );
    } finally {
      try {
        store.close();
      } catch {
        // reopened path may already have closed
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

const filesHarness: Harness = {
  name: "files-only",
  withStore: (fn) => {
    const dir = tempDir("fm-remap-files-");
    const store = openFilesOnlyStore({ dir });
    try {
      return fn(
        store,
        () => {
          store.close();
          return openFilesOnlyStore({ dir });
        },
        dir,
      );
    } finally {
      try {
        store.close();
      } catch {
        // reopened
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

for (const harness of [sqliteHarness, filesHarness]) {
  describe(`import remap store (${harness.name})`, () => {
    it("preserves target outbox receipts/order and queues only imported live upserts", () => {
      harness.withStore((store) => {
        seedTarget(store);
        const pendingBefore = store.listOutbox(100);
        assert.ok(pendingBefore.length >= 1);
        const beforeReceipts = pendingBefore.map((e) => e.receipt);
        const beforeKeys = pendingBefore.map((e) => e.record.key);

        const donor = donorWithLiveAndSuperseded();
        const written = store.importSnapshot(donor, {
          force: true,
          onIdCollision: "remap",
        });
        assert.equal(written, countRows(donor));

        const after = store.listOutbox(100);
        // Existing receipts and relative order of prior entries are preserved.
        const head = after.slice(0, pendingBefore.length);
        assert.deepEqual(
          head.map((e) => e.receipt),
          beforeReceipts,
        );
        assert.deepEqual(
          head.map((e) => e.record.key),
          beforeKeys,
        );

        const appended = after.slice(pendingBefore.length);
        assert.ok(appended.length >= 1);
        for (const e of appended) {
          assert.equal(e.record.mutation, "upsert");
          assert.ok(
            e.record.kind === "fact" || e.record.kind === "obligation",
            "only counted kinds",
          );
          if (e.record.mutation === "upsert") {
            assert.ok(
              !e.record.text.includes("/secret/"),
              "imported upserts must be sanitized",
            );
          }
        }
        assert.ok(
          appended.some(
            (e) =>
              e.record.kind === "fact" &&
              e.record.mutation === "upsert" &&
              e.record.text === "live-import",
          ),
          "live imported fact must upsert",
        );
        assert.ok(
          !appended.some(
            (e) => e.record.kind === "fact" && e.record.text === "pred",
          ),
          "superseded imported predecessor must not upsert",
        );
        assert.ok(
          !after.some((e) => e.record.mutation === "retract"),
          "fresh imported ids must not enqueue retracts",
        );
        assert.ok(
          !after.some((e) => String((e.record as { key: string }).key).startsWith("session:")),
          "sessions must not appear in outbox",
        );
      });
    });

    it("persists additive remap across close/reopen", () => {
      harness.withStore((store, reopen) => {
        seedTarget(store);
        const donor = donorWithLiveAndSuperseded();
        const written = store.importSnapshot(donor, {
          force: true,
          onIdCollision: "remap",
        });
        const before = encodeSnapshot(store.snapshot());
        const outboxBefore = store.listOutbox(100).map((e) => e.receipt);
        const reopened = reopen();
        try {
          assert.equal(encodeSnapshot(reopened.snapshot()), before);
          assert.deepEqual(
            reopened.listOutbox(100).map((e) => e.receipt),
            outboxBefore,
          );
          assert.equal(written, countRows(donor));
        } finally {
          reopened.close();
        }
      });
    });

    it("refuses malformed donor and unknown policy without mutation", () => {
      harness.withStore((store) => {
        seedTarget(store);
        const before = encodeSnapshot(store.snapshot());
        const outboxBefore = store.listOutbox(100) as OutboxEntry[];
        const bad: SessionSnapshot = {
          ...emptySnapshot(),
          nextIds: { fact: 0, measurement: 1, obligation: 1 },
          facts: [
            {
              id: 1,
              statement: "x",
              evidence: null,
              established_ts: "2026-08-09T10:00:00Z",
              session_id: null,
              superseded_by: null,
              superseded_at: null,
              supersede_reason: null,
            },
          ],
        };
        assert.throws(() =>
          store.importSnapshot(bad, { force: true, onIdCollision: "remap" }),
        );
        assertInvalidArgument(() =>
          store.importSnapshot(emptySnapshot(), {
            force: true,
            onIdCollision: "merge" as "remap",
          }),
        );
        assert.equal(encodeSnapshot(store.snapshot()), before);
        assert.deepEqual(
          store.listOutbox(100).map((e) => e.receipt),
          outboxBefore.map((e) => e.receipt),
        );
      });
    });

    it("refuses donor with duplicate session_id without state or outbox change", () => {
      harness.withStore((store) => {
        seedTarget(store);
        const before = encodeSnapshot(store.snapshot());
        const outboxBefore = store.listOutbox(100);
        const dup = ended("D-dup");
        const badDonor: SessionSnapshot = {
          ...emptySnapshot(),
          nextIds: { fact: 2, measurement: 1, obligation: 1 },
          sessions: [dup, { ...dup }],
          facts: [
            {
              id: 1,
              statement: "should-not-land",
              evidence: null,
              established_ts: "2026-08-09T10:00:00Z",
              session_id: "D-dup",
              superseded_by: null,
              superseded_at: null,
              supersede_reason: null,
            },
          ],
        };
        assert.throws(
          () =>
            store.importSnapshot(badDonor, {
              force: true,
              onIdCollision: "remap",
            }),
          (error: unknown) => {
            assert.ok(error instanceof SessionStoreError);
            assert.match(error.message, /duplicate session_id/);
            return true;
          },
        );
        assert.equal(encodeSnapshot(store.snapshot()), before);
        assert.deepEqual(store.listOutbox(100), outboxBefore);
      });
    });

    it("refuses read-only import", () => {
      if (harness.name === "sqlite") {
        const dir = tempDir("fm-remap-ro-sqlite-");
        const path = join(dir, "s.db");
        try {
          const w = SqliteSessionStore.open(path);
          seedTarget(w);
          w.close();
          const ro = SqliteSessionStore.open(path, { readOnly: true });
          try {
            assertInvalidArgument(
              () =>
                ro.importSnapshot(donorWithLiveAndSuperseded(), {
                  force: true,
                  onIdCollision: "remap",
                }),
              /read-only/,
            );
          } finally {
            ro.close();
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
        return;
      }
      const dir = tempDir("fm-remap-ro-files-");
      try {
        const w = openFilesOnlyStore({ dir });
        seedTarget(w);
        w.close();
        const ro = openFilesOnlyStore({ dir, readOnly: true });
        try {
          assertInvalidArgument(
            () =>
              ro.importSnapshot(donorWithLiveAndSuperseded(), {
                force: true,
                onIdCollision: "remap",
              }),
            /read-only/,
          );
        } finally {
          ro.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

describe("import remap atomicity (sqlite)", () => {
  it("rolls back after the second outbox mint fails on partial-progress receipt exhaustion", () => {
    const dir = tempDir("fm-remap-exhaust-");
    const path = join(dir, "s.db");
    try {
      const store = SqliteSessionStore.open(path);
      seedTarget(store);
      const donor = donorWithLiveAndSuperseded();
      const planned = planAdditiveRemapImport(store.snapshot(), donor);
      const liveUpserts = additiveImportProjectionUpserts(
        store.snapshot(),
        planned.merged,
      );
      assert.equal(
        liveUpserts.length,
        2,
        "donor helper must produce two live projection upserts",
      );

      const beforeSnap = encodeSnapshot(store.snapshot());
      const beforeNext = {
        fact: store.peekNextId("fact"),
        measurement: store.peekNextId("measurement"),
        obligation: store.peekNextId("obligation"),
      };
      const beforeOutbox = store.listOutbox(100);

      // First mint uses the last mintable receipt; the second mint must fail.
      setNextReceipt(path, String(LAST_MINTABLE_RECEIPT));
      assert.equal(metaValue(path, "next_receipt"), String(LAST_MINTABLE_RECEIPT));

      assertInvalidArgument(
        () =>
          store.importSnapshot(donor, {
            force: true,
            onIdCollision: "remap",
          }),
        /outbox nextReceipt is exhausted/,
      );

      assert.equal(encodeSnapshot(store.snapshot()), beforeSnap);
      assert.ok(
        !store.snapshot().sessions.some((s) => s.session_id === "D1"),
        "imported donor session must roll back",
      );
      assert.equal(store.peekNextId("fact"), beforeNext.fact);
      assert.equal(store.peekNextId("measurement"), beforeNext.measurement);
      assert.equal(store.peekNextId("obligation"), beforeNext.obligation);
      assert.deepEqual(store.listOutbox(100), beforeOutbox);
      assert.equal(
        metaValue(path, "next_receipt"),
        String(LAST_MINTABLE_RECEIPT),
      );
      // Prove the boundary: the first mintable id is exactly this receipt string.
      assert.equal(`r${LAST_MINTABLE_RECEIPT}`, "r9007199254740990");
      store.close();

      const reopened = SqliteSessionStore.open(path);
      try {
        assert.equal(encodeSnapshot(reopened.snapshot()), beforeSnap);
        assert.equal(reopened.peekNextId("fact"), beforeNext.fact);
        assert.equal(reopened.peekNextId("measurement"), beforeNext.measurement);
        assert.equal(reopened.peekNextId("obligation"), beforeNext.obligation);
        assert.deepEqual(reopened.listOutbox(100), beforeOutbox);
        assert.equal(
          metaValue(path, "next_receipt"),
          String(LAST_MINTABLE_RECEIPT),
        );
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mints the last safe receipt, reopens, lists, and acks", () => {
    const dir = tempDir("fm-remap-last-receipt-");
    const path = join(dir, "s.db");
    try {
      const seed = SqliteSessionStore.open(path);
      seed.addFact({
        statement: "pre",
        evidence: null,
        established_ts: "2026-08-08T10:00:00Z",
        session_id: null,
      });
      seed.ackOutbox(seed.listOutbox(100).map((e) => e.receipt));
      seed.close();

      const lastMintable = Number.MAX_SAFE_INTEGER - 1;
      setNextReceipt(path, String(lastMintable));
      const store = SqliteSessionStore.open(path);
      const fact = store.addFact({
        statement: "last-receipt",
        evidence: null,
        established_ts: "2026-08-08T11:00:00Z",
        session_id: null,
      });
      const listed = store.listOutbox(10);
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.receipt, `r${lastMintable}`);
      assert.equal(listed[0]?.record.id, fact.id);
      assert.equal(metaValue(path, "next_receipt"), String(Number.MAX_SAFE_INTEGER));
      store.close();

      const reopened = SqliteSessionStore.open(path);
      try {
        const again = reopened.listOutbox(10);
        assert.equal(again.length, 1);
        assert.equal(again[0]?.receipt, `r${lastMintable}`);
        assert.equal(reopened.ackOutbox([again[0]!.receipt]), 1);
        assert.equal(reopened.listOutbox(10).length, 0);
        assert.equal(metaValue(path, "next_receipt"), String(Number.MAX_SAFE_INTEGER));
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("import remap atomicity (files-only)", () => {
  it("leaves CURRENT, snapshot, and outbox unchanged when remap planning fails", () => {
    const dir = tempDir("fm-remap-files-refuse-");
    try {
      const store = openFilesOnlyStore({ dir });
      seedTarget(store);
      const currentBefore = readFileSync(join(dir, "CURRENT"));
      const genName = currentBefore.toString("utf8").trim();
      const snapBefore = readFileSync(join(dir, "generations", genName));
      const outboxBefore = readFileSync(join(dir, "outbox-generations", genName));
      const memoryBefore = encodeSnapshot(store.snapshot());
      const pendingBefore = store.listOutbox(100);

      const overflowDonor: SessionSnapshot = {
        ...emptySnapshot(),
        nextIds: { fact: 2, measurement: 1, obligation: 1 },
        facts: [
          {
            id: 1,
            statement: "x",
            evidence: null,
            established_ts: "2026-08-09T10:00:00Z",
            session_id: null,
            superseded_by: null,
            superseded_at: null,
            supersede_reason: null,
          },
        ],
      };
      // Force overflow by raising target nextIds via a crafted publish path:
      // import a replacement that sets fact nextIds near the limit, then remap.
      store.importSnapshot(
        {
          ...emptySnapshot(),
          nextIds: {
            fact: Number.MAX_SAFE_INTEGER,
            measurement: 1,
            obligation: 1,
          },
          sessions: [ended("T1")],
          facts: [
            {
              id: 1,
              statement: "target-keep",
              evidence: "/target/secret",
              established_ts: "2026-08-08T09:01:00Z",
              session_id: "T1",
              superseded_by: null,
              superseded_at: null,
              supersede_reason: null,
            },
          ],
        },
        { force: true },
      );
      const currentMid = readFileSync(join(dir, "CURRENT"));
      const midName = currentMid.toString("utf8").trim();
      const snapMid = readFileSync(join(dir, "generations", midName));
      const outboxMid = readFileSync(join(dir, "outbox-generations", midName));

      assertInvalidArgument(() =>
        store.importSnapshot(overflowDonor, {
          force: true,
          onIdCollision: "remap",
        }),
      );

      assert.deepEqual(readFileSync(join(dir, "CURRENT")), currentMid);
      assert.deepEqual(readFileSync(join(dir, "generations", midName)), snapMid);
      assert.deepEqual(
        readFileSync(join(dir, "outbox-generations", midName)),
        outboxMid,
      );
      assert.equal(
        store.peekNextId("fact"),
        Number.MAX_SAFE_INTEGER,
      );
      // Prior generation artefacts from the first seed remain on disk; CURRENT unchanged.
      assert.ok(snapBefore.length > 0);
      assert.ok(outboxBefore.length > 0);
      assert.ok(memoryBefore.length > 0);
      assert.ok(pendingBefore.length > 0);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not publish when the second outbox mint fails on partial-progress receipt exhaustion", () => {
    const dir = tempDir("fm-remap-files-exhaust-");
    try {
      const store = openFilesOnlyStore({ dir });
      seedTarget(store);
      const donor = donorWithLiveAndSuperseded();
      const planned = planAdditiveRemapImport(store.snapshot(), donor);
      const liveUpserts = additiveImportProjectionUpserts(
        store.snapshot(),
        planned.merged,
      );
      assert.equal(
        liveUpserts.length,
        2,
        "donor helper must produce two live projection upserts",
      );
      store.close();

      // First mint uses the last mintable receipt; the second mint must fail
      // before any paired generation publish.
      const current = readFileSync(join(dir, "CURRENT")).toString("utf8").trim();
      const outboxPath = join(dir, "outbox-generations", current);
      const parsed = JSON.parse(readFileSync(outboxPath, "utf8")) as {
        version: number;
        nextReceipt: number;
        entries: OutboxEntry[];
      };
      parsed.nextReceipt = LAST_MINTABLE_RECEIPT;
      writeFileSync(outboxPath, `${JSON.stringify(parsed)}\n`);

      const reopened = openFilesOnlyStore({ dir });
      const beforeCurrent = readFileSync(join(dir, "CURRENT"));
      const beforeGen = beforeCurrent.toString("utf8").trim();
      const beforeSnapBytes = readFileSync(join(dir, "generations", beforeGen));
      const beforeOutboxBytes = readFileSync(
        join(dir, "outbox-generations", beforeGen),
      );
      const beforeSnap = encodeSnapshot(reopened.snapshot());
      const beforeOutbox = reopened.listOutbox(100);
      assert.equal(`r${LAST_MINTABLE_RECEIPT}`, "r9007199254740990");

      assertInvalidArgument(
        () =>
          reopened.importSnapshot(donor, {
            force: true,
            onIdCollision: "remap",
          }),
        /outbox nextReceipt is exhausted/,
      );

      assert.deepEqual(readFileSync(join(dir, "CURRENT")), beforeCurrent);
      assert.equal(encodeSnapshot(reopened.snapshot()), beforeSnap);
      assert.deepEqual(reopened.listOutbox(100), beforeOutbox);
      assert.deepEqual(
        readFileSync(join(dir, "generations", beforeGen)),
        beforeSnapBytes,
      );
      assert.deepEqual(
        readFileSync(join(dir, "outbox-generations", beforeGen)),
        beforeOutboxBytes,
      );
      const persisted = JSON.parse(
        readFileSync(join(dir, "outbox-generations", beforeGen), "utf8"),
      ) as { nextReceipt: number };
      assert.equal(persisted.nextReceipt, LAST_MINTABLE_RECEIPT);
      reopened.close();

      const again = openFilesOnlyStore({ dir });
      try {
        assert.deepEqual(readFileSync(join(dir, "CURRENT")), beforeCurrent);
        assert.equal(encodeSnapshot(again.snapshot()), beforeSnap);
        assert.deepEqual(again.listOutbox(100), beforeOutbox);
        const againOutbox = JSON.parse(
          readFileSync(join(dir, "outbox-generations", beforeGen), "utf8"),
        ) as { nextReceipt: number };
        assert.equal(againOutbox.nextReceipt, LAST_MINTABLE_RECEIPT);
      } finally {
        again.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
