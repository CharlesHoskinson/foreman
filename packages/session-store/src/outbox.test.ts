import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Cause, Deferred, Effect, Exit } from "effect";

import { seedFixture } from "./contract-suite.js";
import {
  drainOutbox,
  type DrainOptions,
  type DrainResult,
  type OutboxDrainFailure,
} from "./outbox.js";
import type {
  EntityRef,
  MemoryIndex,
  OutboxEntry,
  ProjectionMutation,
  ProjectionRecord,
  SessionStore,
} from "./port.js";
import { openMemoryStore } from "./sqlite-store.js";

const DEFAULT_OPTS: DrainOptions = {
  batch: 10,
  maxAttempts: 3,
  timeoutMs: 5_000,
  maxBatches: 100,
};

function failureOf(exit: Exit.Exit<DrainResult, OutboxDrainFailure>): OutboxDrainFailure {
  assert.equal(Exit.isFailure(exit), true, "expected drain failure");
  assert.ok(Exit.isFailure(exit));
  const squashed = Cause.squash(exit.cause);
  assert.ok(
    squashed !== null &&
      typeof squashed === "object" &&
      "_tag" in squashed &&
      (squashed as OutboxDrainFailure)._tag === "OutboxDrainFailure",
    `unexpected failure ${String(squashed)}`,
  );
  return squashed as OutboxDrainFailure;
}

class RecordingIndex implements MemoryIndex {
  readonly name = "recording";
  readonly seen: ProjectionRecord[] = [];
  projectCalls = 0;
  async project(records: readonly ProjectionRecord[]): Promise<void> {
    this.projectCalls += 1;
    for (const r of records) this.seen.push(r);
  }
  async recall(): Promise<readonly EntityRef[]> {
    return [];
  }
  async beginEpoch(): Promise<string> {
    return "e1";
  }
  async activateEpoch(): Promise<void> {}
}

/** Fails the first `n` project calls, then succeeds. */
class FlakyIndex extends RecordingIndex {
  #left: number;
  constructor(failures: number) {
    super();
    this.#left = failures;
  }
  override async project(records: readonly ProjectionRecord[]): Promise<void> {
    if (this.#left-- > 0) throw new Error("transient");
    await super.project(records);
  }
}

/** Always rejects before applying. */
class RejectingIndex implements MemoryIndex {
  readonly name = "rejecting";
  projectCalls = 0;
  async project(): Promise<void> {
    this.projectCalls += 1;
    throw new Error("hard reject");
  }
  async recall(): Promise<readonly EntityRef[]> {
    return [];
  }
  async beginEpoch(): Promise<string> {
    return "e1";
  }
  async activateEpoch(): Promise<void> {}
}

/**
 * Idempotent by desired-state key: repeated projects overwrite the same Map
 * entry, so double delivery is visible as projectCalls > unique effects.
 */
class IdempotentIndex implements MemoryIndex {
  readonly name = "idempotent";
  readonly effects = new Map<string, ProjectionMutation>();
  projectCalls = 0;
  async project(records: readonly ProjectionRecord[]): Promise<void> {
    this.projectCalls += 1;
    for (const r of records) this.effects.set(r.key, r.mutation);
  }
  async recall(): Promise<readonly EntityRef[]> {
    return [];
  }
  async beginEpoch(): Promise<string> {
    return "e1";
  }
  async activateEpoch(): Promise<void> {}
}

/**
 * Applies the desired-state batch to an idempotent key map, then rejects on
 * the first `rejectAfterApply` calls. Retries observe the prior apply.
 */
class ApplyThenRejectIndex implements MemoryIndex {
  readonly name = "apply-then-reject";
  readonly effects = new Map<string, ProjectionMutation>();
  projectCalls = 0;
  #rejectLeft: number;
  constructor(rejectAfterApply: number) {
    this.#rejectLeft = rejectAfterApply;
  }
  async project(records: readonly ProjectionRecord[]): Promise<void> {
    this.projectCalls += 1;
    for (const r of records) this.effects.set(r.key, r.mutation);
    if (this.#rejectLeft-- > 0) {
      throw new Error("applied then reject");
    }
  }
  async recall(): Promise<readonly EntityRef[]> {
    return [];
  }
  async beginEpoch(): Promise<string> {
    return "e1";
  }
  async activateEpoch(): Promise<void> {}
}

type FakeHooks = {
  readonly onAck?: (receipts: readonly string[]) => number;
  readonly mutateBeforeAck?: (entries: OutboxEntry[]) => void;
};

/** Minimal SessionStore covering the drain's list/ack surface. */
function fakeStore(
  initial: OutboxEntry[],
  hooks: FakeHooks = {},
): SessionStore & { readonly entries: OutboxEntry[] } {
  const entries = initial.map((e) => ({
    receipt: e.receipt,
    record: { ...e.record } as ProjectionRecord,
  }));
  const store = {
    entries,
    modelVersion: 1,
    listOutbox(limit: number): readonly OutboxEntry[] {
      return entries.slice(0, limit).map((e) => ({
        receipt: e.receipt,
        record:
          e.record.mutation === "upsert"
            ? { ...e.record }
            : { ...e.record },
      }));
    },
    ackOutbox(receipts: readonly string[]): number {
      hooks.mutateBeforeAck?.(entries);
      if (hooks.onAck) return hooks.onAck(receipts);
      const set = new Set(receipts);
      const before = entries.length;
      for (let i = entries.length - 1; i >= 0; i--) {
        if (set.has(entries[i]!.receipt)) entries.splice(i, 1);
      }
      return before - entries.length;
    },
    snapshot: () => {
      throw new Error("unused");
    },
    listSessions: () => [],
    currentSession: () => null,
    listFacts: () => [],
    listMeasurements: () => [],
    listObligations: () => [],
    peekNextId: () => 1,
    beginSession: () => {
      throw new Error("unused");
    },
    endSession: () => {
      throw new Error("unused");
    },
    addFact: () => {
      throw new Error("unused");
    },
    addMeasurement: () => {
      throw new Error("unused");
    },
    addObligation: () => {
      throw new Error("unused");
    },
    closeObligation: () => {
      throw new Error("unused");
    },
    supersedeFact: () => {
      throw new Error("unused");
    },
    supersedeMeasurement: () => {
      throw new Error("unused");
    },
    retireMeasurement: () => {
      throw new Error("unused");
    },
    importSnapshot: () => 0,
    close: () => {},
  };
  return store as SessionStore & { readonly entries: OutboxEntry[] };
}

function upsertEntry(
  receipt: string,
  kind: "fact" | "measurement" | "obligation",
  id: number,
  text: string,
): OutboxEntry {
  return {
    receipt,
    record: { key: `${kind}:${id}`, kind, id, mutation: "upsert", text },
  };
}

describe("drainOutbox", () => {
  it("success drain projects and acks every queued row", async () => {
    const store = openMemoryStore();
    try {
      seedFixture(store);
      const before = store.listOutbox(1000);
      assert.ok(before.length > 0, "fixture must queue projection work");
      const index = new RecordingIndex();
      const result = await Effect.runPromise(
        drainOutbox(store, index, DEFAULT_OPTS),
      );
      assert.equal(result.projected, before.length);
      assert.ok(result.attempts >= 1);
      assert.ok(result.batches >= 1);
      assert.equal(store.listOutbox(1000).length, 0);
      assert.equal(index.seen.length, before.length);
    } finally {
      store.close();
    }
  });

  it("empty queue projects 0 with 0 attempts", async () => {
    const store = openMemoryStore();
    try {
      const index = new RecordingIndex();
      const result = await Effect.runPromise(
        drainOutbox(store, index, DEFAULT_OPTS),
      );
      assert.deepEqual(result, { projected: 0, attempts: 0, batches: 0 });
      assert.equal(index.projectCalls, 0);
    } finally {
      store.close();
    }
  });

  it("failure before apply leaves the queue unacked", async () => {
    const store = openMemoryStore();
    try {
      seedFixture(store);
      const before = store.listOutbox(1000).map((e) => e.receipt);
      const index = new RejectingIndex();
      const exit = await Effect.runPromiseExit(
        drainOutbox(store, index, { ...DEFAULT_OPTS, maxAttempts: 1 }),
      );
      const failure = failureOf(exit);
      assert.equal(failure.reason, "attempts_exhausted");
      assert.equal(failure.projected, 0);
      assert.equal(failure.attempts, 1);
      assert.deepEqual(
        store.listOutbox(1000).map((e) => e.receipt),
        before,
      );
    } finally {
      store.close();
    }
  });

  it("apply-then-reject retry eventually drains without duplicating keys in an idempotent index", async () => {
    const store = fakeStore([upsertEntry("r1", "fact", 1, "only")]);
    const index = new ApplyThenRejectIndex(1);
    const result = await Effect.runPromise(
      drainOutbox(store, index, DEFAULT_OPTS),
    );
    assert.equal(result.projected, 1);
    assert.ok(result.attempts >= 2, "expected a retry after the first reject");
    assert.equal(store.listOutbox(1000).length, 0);
    assert.equal(index.effects.size, 1, "one final desired-state effect per key");
    assert.equal(index.effects.get("fact:1"), "upsert");
    assert.ok(
      index.projectCalls > index.effects.size,
      "project calls must exceed unique effects after apply-then-reject retry",
    );
  });

  it("initial listOutbox failure yields OutboxDrainFailure not a defect", async () => {
    const store = fakeStore([upsertEntry("r1", "fact", 1, "a")]);
    store.listOutbox = () => {
      throw new Error("boom-initial-list-secret");
    };
    const index = new RecordingIndex();
    const exit = await Effect.runPromiseExit(
      drainOutbox(store, index, DEFAULT_OPTS),
    );
    const failure = failureOf(exit);
    assert.equal(failure.reason, "list_failed");
    assert.equal(failure.projected, 0);
    assert.equal(failure.attempts, 0);
    assert.equal(failure.batches, 0);
    assert.equal(index.projectCalls, 0);
  });

  it("post-batch listOutbox failure yields OutboxDrainFailure not a defect", async () => {
    const store = fakeStore([
      upsertEntry("r1", "fact", 1, "a"),
      upsertEntry("r2", "fact", 2, "b"),
    ]);
    let listCalls = 0;
    const origList = store.listOutbox.bind(store);
    store.listOutbox = (limit: number) => {
      listCalls += 1;
      if (listCalls === 1) return origList(limit);
      throw new Error("boom-post-batch-list-secret");
    };
    const index = new RecordingIndex();
    const exit = await Effect.runPromiseExit(
      drainOutbox(store, index, {
        batch: 1,
        maxAttempts: 1,
        timeoutMs: 5_000,
        maxBatches: 10,
      }),
    );
    const failure = failureOf(exit);
    assert.equal(failure.reason, "list_failed");
    assert.equal(failure.projected, 1);
    assert.equal(failure.batches, 1);
    assert.equal(index.projectCalls, 1);
  });

  it("timeout with late settlement does not ack", async () => {
    const store = openMemoryStore();
    try {
      seedFixture(store);
      const before = store.listOutbox(1000).map((e) => e.receipt);
      const gate = Effect.runSync(Deferred.make<void, never>());
      let projectStarted = false;
      const index: MemoryIndex = {
        name: "late",
        async project() {
          projectStarted = true;
          await Effect.runPromise(Deferred.await(gate));
        },
        async recall() {
          return [];
        },
        async beginEpoch() {
          return "e";
        },
        async activateEpoch() {},
      };

      const exit = await Effect.runPromiseExit(
        drainOutbox(store, index, {
          batch: 100,
          maxAttempts: 1,
          timeoutMs: 1,
          maxBatches: 1,
        }),
      );
      assert.equal(projectStarted, true);
      const failure = failureOf(exit);
      assert.equal(failure.reason, "timeout");
      assert.equal(failure.projected, 0);
      assert.deepEqual(
        store.listOutbox(1000).map((e) => e.receipt),
        before,
        "timeout must not ack",
      );

      // Late settlement after the drain already failed.
      Effect.runSync(Deferred.succeed(gate, undefined));
      await Promise.resolve();
      assert.deepEqual(
        store.listOutbox(1000).map((e) => e.receipt),
        before,
        "late project settlement must not retroactively ack",
      );
    } finally {
      store.close();
    }
  });

  it("exhausted attempts leave rows unacked", async () => {
    const store = openMemoryStore();
    try {
      seedFixture(store);
      const before = store.listOutbox(1000).length;
      const index = new FlakyIndex(99);
      const exit = await Effect.runPromiseExit(
        drainOutbox(store, index, { ...DEFAULT_OPTS, maxAttempts: 2 }),
      );
      const failure = failureOf(exit);
      assert.equal(failure.reason, "attempts_exhausted");
      assert.equal(failure.attempts, 2);
      assert.equal(failure.projected, 0);
      assert.equal(store.listOutbox(1000).length, before);
    } finally {
      store.close();
    }
  });

  it("ack failure after a successful project stops the drain", async () => {
    const entries = [
      upsertEntry("r1", "fact", 1, "a"),
      upsertEntry("r2", "fact", 2, "b"),
    ];
    const store = fakeStore(entries, {
      onAck: () => {
        throw new Error("ack boom");
      },
    });
    const index = new RecordingIndex();
    const exit = await Effect.runPromiseExit(
      drainOutbox(store, index, { ...DEFAULT_OPTS, batch: 10, maxAttempts: 1 }),
    );
    const failure = failureOf(exit);
    assert.equal(failure.reason, "ack_failed");
    assert.equal(failure.projected, 0);
    assert.equal(index.projectCalls, 1);
    assert.equal(store.listOutbox(10).length, 2);
  });

  it("receipt replaced between list and ack deletes 0 and keeps the entry", async () => {
    let coalesced = false;
    const store = fakeStore([upsertEntry("r-old", "fact", 1, "a")], {
      mutateBeforeAck: (entries) => {
        if (coalesced) return;
        coalesced = true;
        entries[0] = upsertEntry("r-new", "fact", 1, "a-coalesced");
      },
    });
    const index = new RecordingIndex();
    // One batch: list sees r-old, coalesce replaces receipt, stale ack deletes 0.
    const exit = await Effect.runPromiseExit(
      drainOutbox(store, index, {
        batch: 10,
        maxAttempts: 1,
        timeoutMs: 5_000,
        maxBatches: 1,
      }),
    );
    const failure = failureOf(exit);
    assert.equal(failure.reason, "max_batches");
    assert.equal(failure.projected, 0);
    assert.equal(store.listOutbox(10).length, 1);
    assert.equal(store.listOutbox(10)[0]!.receipt, "r-new");
  });

  it("successful early batches stay acked when a later batch fails", async () => {
    const entries = [
      upsertEntry("r1", "fact", 1, "a"),
      upsertEntry("r2", "fact", 2, "b"),
      upsertEntry("r3", "fact", 3, "c"),
    ];
    const store = fakeStore(entries);
    let calls = 0;
    const index: MemoryIndex = {
      name: "later-fail",
      async project(records) {
        calls += 1;
        if (calls >= 2) throw new Error("second batch boom");
        void records;
      },
      async recall() {
        return [];
      },
      async beginEpoch() {
        return "e";
      },
      async activateEpoch() {},
    };
    const exit = await Effect.runPromiseExit(
      drainOutbox(store, index, {
        batch: 1,
        maxAttempts: 1,
        timeoutMs: 5_000,
        maxBatches: 10,
      }),
    );
    const failure = failureOf(exit);
    assert.equal(failure.reason, "attempts_exhausted");
    assert.equal(failure.projected, 1);
    assert.equal(failure.batches, 1);
    assert.equal(store.listOutbox(10).length, 2);
    assert.equal(store.listOutbox(10)[0]!.receipt, "r2");
  });

  it("maxBatches bound fails with pending work remaining", async () => {
    const entries = [
      upsertEntry("r1", "fact", 1, "a"),
      upsertEntry("r2", "fact", 2, "b"),
      upsertEntry("r3", "fact", 3, "c"),
    ];
    const store = fakeStore(entries);
    const index = new RecordingIndex();
    const exit = await Effect.runPromiseExit(
      drainOutbox(store, index, {
        batch: 1,
        maxAttempts: 1,
        timeoutMs: 5_000,
        maxBatches: 2,
      }),
    );
    const failure = failureOf(exit);
    assert.equal(failure.reason, "max_batches");
    assert.equal(failure.projected, 2);
    assert.equal(failure.batches, 2);
    assert.equal(store.listOutbox(10).length, 1);
  });

  it("retries may re-project but an idempotent index records one effect per key", async () => {
    const store = openMemoryStore();
    try {
      seedFixture(store);
      const pending = store.listOutbox(1000);
      const index = new IdempotentIndex();
      let calls = 0;
      const flaky: MemoryIndex = {
        name: "wrap",
        async project(records) {
          calls += 1;
          if (calls === 1) throw new Error("once");
          await index.project(records);
        },
        async recall() {
          return [];
        },
        async beginEpoch() {
          return "e";
        },
        async activateEpoch() {},
      };

      await Effect.runPromise(drainOutbox(store, flaky, DEFAULT_OPTS));
      assert.ok(calls >= 2, "expected repeated project calls");
      assert.equal(index.effects.size, pending.length);
      for (const e of pending) {
        assert.equal(index.effects.get(e.record.key), e.record.mutation);
      }
    } finally {
      store.close();
    }
  });

  it("invalid options fail without contacting the index", async () => {
    const store = openMemoryStore();
    try {
      const index = new RecordingIndex();
      const bad: DrainOptions[] = [
        { batch: 0, maxAttempts: 1, timeoutMs: 1, maxBatches: 1 },
        { batch: 1001, maxAttempts: 1, timeoutMs: 1, maxBatches: 1 },
        { batch: 1, maxAttempts: 0, timeoutMs: 1, maxBatches: 1 },
        { batch: 1, maxAttempts: 11, timeoutMs: 1, maxBatches: 1 },
        { batch: 1, maxAttempts: 1, timeoutMs: 0, maxBatches: 1 },
        { batch: 1, maxAttempts: 1, timeoutMs: 300_001, maxBatches: 1 },
        { batch: 1, maxAttempts: 1, timeoutMs: 1, maxBatches: 0 },
        { batch: 1, maxAttempts: 1, timeoutMs: 1, maxBatches: 10_001 },
        { batch: 1.5, maxAttempts: 1, timeoutMs: 1, maxBatches: 1 },
        { batch: NaN, maxAttempts: 1, timeoutMs: 1, maxBatches: 1 },
      ];
      for (const opts of bad) {
        const exit = await Effect.runPromiseExit(drainOutbox(store, index, opts));
        const failure = failureOf(exit);
        assert.equal(failure.reason, "invalid_options", `opts=${JSON.stringify(opts)}`);
        assert.equal(failure.projected, 0);
        assert.equal(failure.attempts, 0);
      }
      assert.equal(index.projectCalls, 0);
    } finally {
      store.close();
    }
  });
});
