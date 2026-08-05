/**
 * Run journal — live external state root for attempt allocation and event append.
 * Sprint 3 R3 (correction round 2).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Fiber } from "effect";
import {
  decodeLaneId,
  decodeRunId,
  makeAttemptIdentity,
  type AttemptIdentity,
  type AttemptId,
  type LaneId,
  type RunId,
} from "./attempt.js";
import { MAX_REPLAY_INPUT_BYTES } from "./bounds.js";
import {
  inspectResumeAttemptBudget,
  isResumeAttemptFailure,
  isRunJournalFailure,
  makeLiveRunJournalLayer,
  RunJournal,
  type LiveRunJournalOptions,
  type StoredEventDraftV1,
} from "./run-journal.js";
import { isAttemptFailure } from "./failures.js";
import { replayNdjsonBytes, type ReplayRecord } from "./replay.js";
import type { StoredEvent } from "./stored-event.js";

const runId = decodeRunId("r3-run-a") as RunId;
const laneId = decodeLaneId("grok-r3") as LaneId;
const otherLaneId = decodeLaneId("codex-r3") as LaneId;

function identity(attempt: number): AttemptIdentity {
  return makeAttemptIdentity(runId, laneId, attempt as AttemptId);
}

function draft(
  partial: Partial<StoredEventDraftV1> & { readonly type: string },
): StoredEventDraftV1 {
  return {
    type: partial.type,
    lane: partial.lane ?? "grok-r3",
    ...(partial.commit !== undefined ? { commit: partial.commit } : {}),
    payload: partial.payload ?? { attempt: 1 },
  };
}

function withStateRoot<A>(body: (root: string) => Promise<A>): Promise<A> {
  const root = mkdtempSync(join(tmpdir(), "rj-"));
  return body(root).finally(() => {
    rmSync(root, { recursive: true, force: true });
  });
}

function allocateEffect(root: string, options?: LiveRunJournalOptions) {
  return Effect.gen(function* () {
    const j = yield* RunJournal;
    return yield* j.allocate(runId, laneId);
  }).pipe(Effect.provide(makeLiveRunJournalLayer(root, options)));
}

function appendEffect(
  root: string,
  event: StoredEventDraftV1,
  options?: LiveRunJournalOptions,
) {
  return Effect.gen(function* () {
    const j = yield* RunJournal;
    return yield* j.append(runId, event);
  }).pipe(Effect.provide(makeLiveRunJournalLayer(root, options)));
}

function reserveEffect(
  root: string,
  attemptIdentity: AttemptIdentity,
  resumeMaxAttempts: number,
  options?: LiveRunJournalOptions,
) {
  return Effect.gen(function* () {
    const j = yield* RunJournal;
    return yield* j.reserveResumeAttempt(attemptIdentity, resumeMaxAttempts);
  }).pipe(Effect.provide(makeLiveRunJournalLayer(root, options)));
}

function assertClosedFailure(
  left: unknown,
  reason: string,
): void {
  assert.ok(isRunJournalFailure(left));
  assert.equal(left.reason, reason);
  assert.equal(Object.keys(left).sort().join(","), "_tag,reason");
  const text = JSON.stringify(left);
  assert.equal(text.includes("/"), false, "failure must not leak path");
}

function assertResumeFailure(
  left: unknown,
  reason: string,
): void {
  assert.ok(isResumeAttemptFailure(left));
  assert.equal(left.reason, reason);
  assert.equal(Object.keys(left).sort().join(","), "_tag,reason");
  const text = JSON.stringify(left);
  assert.equal(text.includes("/"), false, "failure must not leak path");
  assert.equal(/Error|errno|EACCES|ENOENT/.test(text), false);
}

async function seedPrompt(
  root: string,
  attempt: number,
  lane: string = String(laneId),
): Promise<void> {
  await Effect.runPromise(
    appendEffect(root, draft({ type: "prompt", lane, payload: { attempt } })),
  );
}

function journalResumeAttemptCount(root: string, lane: string = String(laneId)): number {
  const journalPath = join(root, "runs", runId, "events.ndjson");
  if (!existsSync(journalPath)) return 0;
  const bytes = readFileSync(journalPath);
  const replay = replayNdjsonBytes(bytes, { fromLine: 0 });
  assert.equal(replay.terminal._tag, "CleanEof");
  return replay.records.filter(
    (r) => r.event.type === "resume_attempt" && r.event.lane === lane,
  ).length;
}

function dirnameSafe(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : ".";
}

function eventLine(seq: number): string {
  return (
    JSON.stringify({
      seq,
      ts: "2026-08-04T00:00:00Z",
      type: "prompt",
      lane: "grok-r3",
      payload: { attempt: 1 },
    }) + "\n"
  );
}

describe("RunJournal allocate", () => {
  it("missing counter allocates attempt 1 and stores next 2 with LF", async () => {
    await withStateRoot(async (root) => {
      const exit = await Effect.runPromiseExit(allocateEffect(root));
      assert.equal(Exit.isSuccess(exit), true);
      if (Exit.isSuccess(exit)) {
        assert.equal(exit.value.attemptId, 1);
        assert.equal(exit.value.runId, runId);
        assert.equal(exit.value.laneId, laneId);
      }
      const path = join(root, "runs", runId, "attempts", `${laneId}.txt`);
      assert.equal(readFileSync(path, "utf8"), "2\n");
    });
  });

  it("sequential allocates 1 then 2 then 3 without gaps", async () => {
    await withStateRoot(async (root) => {
      const a = await Effect.runPromise(allocateEffect(root));
      const b = await Effect.runPromise(allocateEffect(root));
      const c = await Effect.runPromise(allocateEffect(root));
      assert.deepEqual(
        [a.attemptId, b.attemptId, c.attemptId],
        [1, 2, 3],
      );
      const path = join(root, "runs", runId, "attempts", `${laneId}.txt`);
      assert.equal(readFileSync(path, "utf8"), "4\n");
    });
  });

  it("concurrent allocation returns consecutive distinct attempts", async () => {
    await withStateRoot(async (root) => {
      const fibers = [0, 1, 2].map(() =>
        Effect.runFork(allocateEffect(root)),
      );
      const results = await Promise.all(
        fibers.map((f) => Effect.runPromise(Fiber.join(f))),
      );
      const ids = results.map((r) => r.attemptId).sort((x, y) => x - y);
      assert.deepEqual(ids, [1, 2, 3]);
      const path = join(root, "runs", runId, "attempts", `${laneId}.txt`);
      assert.equal(readFileSync(path, "utf8"), "4\n");
    });
  });

  const corruptBodies: readonly { name: string; body: string | Buffer }[] = [
    { name: "empty", body: "" },
    { name: "missing LF", body: "1" },
    { name: "CRLF", body: "1\r\n" },
    { name: "extra LF", body: "1\n\n" },
    { name: "whitespace", body: " 1\n" },
    { name: "leading zero", body: "01\n" },
    { name: "malformed text", body: "abc\n" },
    { name: "oversize", body: "1".repeat(20) + "\n" },
  ];

  for (const c of corruptBodies) {
    it(`corrupt counter (${c.name}) fails without reset`, async () => {
      await withStateRoot(async (root) => {
        const path = join(root, "runs", runId, "attempts", `${laneId}.txt`);
        mkdirSync(dirnameSafe(path), { recursive: true });
        writeFileSync(path, c.body);
        const before = readFileSync(path);
        const either = await Effect.runPromise(
          Effect.either(allocateEffect(root)),
        );
        assert.equal(either._tag, "Left");
        if (either._tag === "Left") {
          assertClosedFailure(either.left, "corrupt_state");
        }
        const after = readFileSync(path);
        assert.ok(before.equals(after), "counter must not be reset");
        const events = join(root, "runs", runId, "events.ndjson");
        assert.equal(existsSync(events), false);
      });
    });
  }

  it("linked counter path fails closed without following", async () => {
    await withStateRoot(async (root) => {
      const attempts = join(root, "runs", runId, "attempts");
      mkdirSync(attempts, { recursive: true });
      const real = join(root, "outside-counter.txt");
      writeFileSync(real, "9\n");
      symlinkSync(real, join(attempts, `${laneId}.txt`));
      const either = await Effect.runPromise(
        Effect.either(allocateEffect(root)),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertClosedFailure(either.left, "invalid_path");
      }
      assert.equal(readFileSync(real, "utf8"), "9\n");
    });
  });

  it("preexisting linked runs directory fails closed before create", async () => {
    await withStateRoot(async (root) => {
      const outside = mkdtempSync(join(tmpdir(), "rj-out-"));
      try {
        symlinkSync(outside, join(root, "runs"));
        const either = await Effect.runPromise(
          Effect.either(allocateEffect(root)),
        );
        assert.equal(either._tag, "Left");
        if (either._tag === "Left") {
          assertClosedFailure(either.left, "invalid_path");
        }
        assert.equal(readdirSync(outside).length, 0);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it("preexisting linked run-id directory fails closed", async () => {
    await withStateRoot(async (root) => {
      const outside = mkdtempSync(join(tmpdir(), "rj-run-out-"));
      try {
        mkdirSync(join(root, "runs"));
        symlinkSync(outside, join(root, "runs", runId));
        const either = await Effect.runPromise(
          Effect.either(allocateEffect(root)),
        );
        assert.equal(either._tag, "Left");
        if (either._tag === "Left") {
          assertClosedFailure(either.left, "invalid_path");
        }
        assert.equal(readdirSync(outside).length, 0);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it("preexisting linked attempts directory fails closed", async () => {
    await withStateRoot(async (root) => {
      const outside = mkdtempSync(join(tmpdir(), "rj-att-out-"));
      try {
        mkdirSync(join(root, "runs", runId), { recursive: true });
        symlinkSync(outside, join(root, "runs", runId, "attempts"));
        const either = await Effect.runPromise(
          Effect.either(allocateEffect(root)),
        );
        assert.equal(either._tag, "Left");
        if (either._tag === "Left") {
          assertClosedFailure(either.left, "invalid_path");
        }
        assert.equal(readdirSync(outside).length, 0);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it("preexisting linked locks directory fails closed", async () => {
    await withStateRoot(async (root) => {
      const outside = mkdtempSync(join(tmpdir(), "rj-lock-out-"));
      try {
        mkdirSync(join(root, "runs", runId), { recursive: true });
        symlinkSync(outside, join(root, "runs", runId, "locks"));
        const either = await Effect.runPromise(
          Effect.either(allocateEffect(root)),
        );
        assert.equal(either._tag, "Left");
        if (either._tag === "Left") {
          assertClosedFailure(either.left, "invalid_path");
        }
        assert.equal(readdirSync(outside).length, 0);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it("regular file at ROOT/runs is typed failure not Effect defect", async () => {
    await withStateRoot(async (root) => {
      writeFileSync(join(root, "runs"), "not-a-dir");
      const exit = await Effect.runPromiseExit(allocateEffect(root));
      assert.equal(Exit.isFailure(exit), true);
      if (Exit.isFailure(exit)) {
        assert.equal(Cause.isDie(exit.cause), false);
        const failures = [...Cause.failures(exit.cause)];
        assert.equal(failures.length, 1);
        assertClosedFailure(failures[0], "invalid_path");
        const pretty = Cause.pretty(exit.cause);
        assert.equal(pretty.includes(root), false);
        assert.equal(/ENOTDIR|mkdirSync|errno/.test(pretty), false);
        assert.equal(Cause.defects(exit.cause).length, 0);
      }
    });
  });

  it("counter path replacement after open returns identity_changed", async () => {
    await withStateRoot(async (root) => {
      const path = join(root, "runs", runId, "attempts", `${laneId}.txt`);
      mkdirSync(dirnameSafe(path), { recursive: true });
      writeFileSync(path, "2\n");
      const either = await Effect.runPromise(
        Effect.either(
          allocateEffect(root, {
            afterCounterRead: ({ path: p }) => {
              unlinkSync(p);
              writeFileSync(p, "9\n");
            },
          }),
        ),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertClosedFailure(either.left, "identity_changed");
      }
    });
  });

  it("counter path disappearance after open returns identity_changed", async () => {
    await withStateRoot(async (root) => {
      const path = join(root, "runs", runId, "attempts", `${laneId}.txt`);
      mkdirSync(dirnameSafe(path), { recursive: true });
      writeFileSync(path, "2\n");
      const either = await Effect.runPromise(
        Effect.either(
          allocateEffect(root, {
            afterCounterRead: ({ path: p }) => {
              unlinkSync(p);
            },
          }),
        ),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertClosedFailure(either.left, "identity_changed");
      }
    });
  });

  it("maximum-attempt overflow fails without counter mutation", async () => {
    await withStateRoot(async (root) => {
      const path = join(root, "runs", runId, "attempts", `${laneId}.txt`);
      mkdirSync(dirnameSafe(path), { recursive: true });
      const body = `${String(Number.MAX_SAFE_INTEGER)}\n`;
      writeFileSync(path, body);
      const before = readFileSync(path);
      const either = await Effect.runPromise(
        Effect.either(allocateEffect(root)),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assert.ok(isAttemptFailure(either.left));
        assert.equal(either.left.reason, "attempt_overflow");
      }
      assert.ok(before.equals(readFileSync(path)));
    });
  });

  it("held lock returns journal_busy at the bound (clock seam)", async () => {
    await withStateRoot(async (root) => {
      // Create layout and hold the attempt lock exclusively.
      mkdirSync(join(root, "runs", runId, "locks"), { recursive: true });
      mkdirSync(join(root, "runs", runId, "attempts"), { recursive: true });
      const lockPath = join(
        root,
        "runs",
        runId,
        "locks",
        `attempt-${laneId}.lock`,
      );
      const held = openSync(lockPath, "wx");
      try {
        let now = 1_000;
        const either = await Effect.runPromise(
          Effect.either(
            allocateEffect(root, {
              lockBoundMs: 20,
              lockSpinMs: 5,
              nowMs: () => now,
              waitMs: () => {
                now += 10;
              },
            }),
          ),
        );
        assert.equal(either._tag, "Left");
        if (either._tag === "Left") {
          assertClosedFailure(either.left, "journal_busy");
        }
      } finally {
        closeSync(held);
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    });
  });
});

describe("RunJournal append", () => {
  it("first event uses sequence 1; concurrent appends get 1,2,3 and replay", async () => {
    await withStateRoot(async (root) => {
      const fibers = [0, 1, 2].map((i) =>
        Effect.runFork(
          appendEffect(
            root,
            draft({ type: "prompt", payload: { attempt: i + 1, n: i } }),
          ),
        ),
      );
      const stored = await Promise.all(
        fibers.map((f) => Effect.runPromise(Fiber.join(f))),
      );
      const seqs = stored.map((s) => s.seq).sort((a, b) => a - b);
      assert.deepEqual(seqs, [1, 2, 3]);

      const journalPath = join(root, "runs", runId, "events.ndjson");
      const bytes = readFileSync(journalPath);
      const lines = bytes.toString("utf8").split("\n").filter((l) => l.length > 0);
      assert.equal(lines.length, 3);
      for (const line of lines) {
        assert.ok(!line.includes("\n"));
      }
      const replay = replayNdjsonBytes(bytes, { fromLine: 0 });
      assert.equal(replay.terminal._tag, "CleanEof");
      assert.equal(replay.records.length, 3);
      assert.deepEqual(
        replay.records.map((r) => r.event.seq),
        [1, 2, 3],
      );
    });
  });

  it("torn journal fails append and remains byte-identical", async () => {
    await withStateRoot(async (root) => {
      const journalPath = join(root, "runs", runId, "events.ndjson");
      mkdirSync(dirnameSafe(journalPath), { recursive: true });
      const good = eventLine(1);
      const torn = good + '{"lane":"x","payload":{},"seq":2';
      writeFileSync(journalPath, torn);
      const before = readFileSync(journalPath);
      const either = await Effect.runPromise(
        Effect.either(
          appendEffect(
            root,
            draft({ type: "checkpoint", commit: "a".repeat(40) }),
          ),
        ),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertClosedFailure(either.left, "corrupt_state");
      }
      const after = readFileSync(journalPath);
      assert.ok(before.equals(after), "journal bytes must be unchanged");
    });
  });

  it("linked journal path fails closed", async () => {
    await withStateRoot(async (root) => {
      const dir = join(root, "runs", runId);
      mkdirSync(dir, { recursive: true });
      const real = join(root, "outside.ndjson");
      writeFileSync(real, "");
      symlinkSync(real, join(dir, "events.ndjson"));
      const either = await Effect.runPromise(
        Effect.either(appendEffect(root, draft({ type: "prompt" }))),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertClosedFailure(either.left, "invalid_path");
      }
    });
  });

  it("sequence zero is corrupt_state with byte-identical journal", async () => {
    await withStateRoot(async (root) => {
      const journalPath = join(root, "runs", runId, "events.ndjson");
      mkdirSync(dirnameSafe(journalPath), { recursive: true });
      const body = eventLine(0);
      writeFileSync(journalPath, body);
      const before = readFileSync(journalPath);
      // Generic replay accepts seq 0.
      assert.equal(
        replayNdjsonBytes(before, { fromLine: 0 }).terminal._tag,
        "CleanEof",
      );
      const either = await Effect.runPromise(
        Effect.either(appendEffect(root, draft({ type: "prompt" }))),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertClosedFailure(either.left, "corrupt_state");
      }
      assert.ok(before.equals(readFileSync(journalPath)));
    });
  });

  it("sequence gap is corrupt_state with byte-identical journal", async () => {
    await withStateRoot(async (root) => {
      const journalPath = join(root, "runs", runId, "events.ndjson");
      mkdirSync(dirnameSafe(journalPath), { recursive: true });
      const body = eventLine(1) + eventLine(3);
      writeFileSync(journalPath, body);
      const before = readFileSync(journalPath);
      assert.equal(
        replayNdjsonBytes(before, { fromLine: 0 }).terminal._tag,
        "CleanEof",
      );
      const either = await Effect.runPromise(
        Effect.either(appendEffect(root, draft({ type: "prompt" }))),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertClosedFailure(either.left, "corrupt_state");
      }
      assert.ok(before.equals(readFileSync(journalPath)));
    });
  });

  it("oversized sparse journal rejects before retention", async () => {
    await withStateRoot(async (root) => {
      const journalPath = join(root, "runs", runId, "events.ndjson");
      mkdirSync(dirnameSafe(journalPath), { recursive: true });
      // Sparse file: logical size past the replay bound without writing that many bytes.
      const fd = openSync(journalPath, "w");
      try {
        writeSync(fd, Buffer.from("x"), 0, 1, MAX_REPLAY_INPUT_BYTES);
      } finally {
        closeSync(fd);
      }
      const either = await Effect.runPromise(
        Effect.either(appendEffect(root, draft({ type: "prompt" }))),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertClosedFailure(either.left, "limit_exceeded");
      }
    });
  });

  it("journal path replacement after write sync returns identity_changed", async () => {
    await withStateRoot(async (root) => {
      const journalPath = join(root, "runs", runId, "events.ndjson");
      mkdirSync(dirnameSafe(journalPath), { recursive: true });
      writeFileSync(journalPath, eventLine(1));
      const either = await Effect.runPromise(
        Effect.either(
          appendEffect(root, draft({ type: "prompt" }), {
            afterJournalWriteSync: ({ path, fd }) => {
              closeSync(fd);
              const tmp = path + ".swap";
              writeFileSync(tmp, eventLine(1));
              renameSync(tmp, path);
            },
          }),
        ),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertClosedFailure(either.left, "identity_changed");
      }
    });
  });

  it("journal path disappearance after write sync returns identity_changed", async () => {
    await withStateRoot(async (root) => {
      const journalPath = join(root, "runs", runId, "events.ndjson");
      mkdirSync(dirnameSafe(journalPath), { recursive: true });
      writeFileSync(journalPath, eventLine(1));
      const either = await Effect.runPromise(
        Effect.either(
          appendEffect(root, draft({ type: "prompt" }), {
            afterJournalWriteSync: ({ path, fd }) => {
              closeSync(fd);
              unlinkSync(path);
            },
          }),
        ),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertClosedFailure(either.left, "identity_changed");
      }
    });
  });

  it("competing create when journal was missing returns identity_changed", async () => {
    await withStateRoot(async (root) => {
      mkdirSync(join(root, "runs", runId), { recursive: true });
      const either = await Effect.runPromise(
        Effect.either(
          appendEffect(root, draft({ type: "prompt" }), {
            beforeJournalCreate: (path) => {
              writeFileSync(path, eventLine(1));
            },
          }),
        ),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertClosedFailure(either.left, "identity_changed");
      }
    });
  });
});

describe("RunJournal layout", () => {
  it("stores only under runs/<runId>/ layout; no .harness", async () => {
    await withStateRoot(async (root) => {
      await Effect.runPromise(allocateEffect(root));
      await Effect.runPromise(appendEffect(root, draft({ type: "prompt" })));
      const top = readdirSync(root);
      assert.deepEqual(top, ["runs"]);
      assert.equal(existsSync(join(root, ".harness")), false);
    });
  });
});

describe("RunJournal multi-process", () => {
  /** Child startup bound: ready / hold markers must appear within this window. */
  const CHILD_STARTUP_BOUND_MS = 15_000;
  /** Child barrier wait bound after reporting ready (serial witness only). */
  const BARRIER_WAIT_BOUND_MS = 15_000;
  /** Holder internal wait for parent release while journal lock remains held. */
  const HOLDER_HOLD_WAIT_MS = 20_000;
  /** Parent wait for contender lock-retry seam marker before releasing holder. */
  const CONTENTION_OBSERVE_BOUND_MS = 15_000;
  /** Contender exclusive-lock acquire bound while holder holds the journal lock. */
  const CONTENDER_LOCK_BOUND_MS = 15_000;
  /** Parent wait for both children to exit after holder release. */
  const CHILD_COMPLETION_BOUND_MS = 20_000;
  /** Bound on waiting for child close after SIGKILL (never unbounded). */
  const POST_KILL_REAP_BOUND_MS = 5_000;

  type ChildCapture = {
    readonly code: number | null;
    readonly out: string;
    readonly err: string;
    readonly pid: number | undefined;
  };

  type SpawnHandle = {
    readonly child: import("node:child_process").ChildProcess;
    readonly done: Promise<ChildCapture>;
    readonly snapshot: () => ChildCapture;
  };

  type ReserveChildResult =
    | { readonly status: "ok"; readonly resumeCount: number; readonly pid: number }
    | { readonly status: "fail"; readonly reason: string; readonly pid: number };

  /**
   * Inline worker evaluated from the repo root so package imports resolve.
   * Each invocation is a separate OS process.
   */
  function workerEval(op: "allocate" | "append"): string {
    return `
import { Effect } from "effect";
import { makeLiveRunJournalLayer, RunJournal } from "./packages/event-log/src/run-journal.ts";
import { decodeRunId, decodeLaneId } from "./packages/event-log/src/attempt.ts";
const root = process.argv[1];
const runId = decodeRunId(process.argv[2]);
const laneId = decodeLaneId(process.argv[3]);
const op = process.argv[4];
const exit = await Effect.runPromiseExit(
  Effect.gen(function* () {
    const j = yield* RunJournal;
    if (op === "allocate") return yield* j.allocate(runId, laneId);
    return yield* j.append(runId, {
      type: "prompt",
      lane: String(laneId),
      payload: { attempt: 1, pid: process.pid },
    });
  }).pipe(Effect.provide(makeLiveRunJournalLayer(root)))
);
if (exit._tag === "Success") {
  if (op === "allocate") process.stdout.write(String(exit.value.attemptId) + "\\n");
  else process.stdout.write(String(exit.value.seq) + "\\n");
  process.exitCode = 0;
} else {
  process.stderr.write("worker_failed\\n");
  process.exitCode = 1;
}
`;
  }

  /**
   * Barrier-synced reserve worker (serial witness only).
   * argv: root runId laneId attempt limit readyPath goPath barrierWaitMs
   * Reports ready, waits for go, then reserveResumeAttempt.
   */
  function reserveBarrierWorkerEval(): string {
    return `
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Cause, Effect, Exit } from "effect";
import {
  isResumeAttemptFailure,
  makeLiveRunJournalLayer,
  RunJournal,
} from "./packages/event-log/src/run-journal.ts";
import {
  decodeAttemptId,
  decodeLaneId,
  decodeRunId,
  makeAttemptIdentity,
} from "./packages/event-log/src/attempt.ts";

const root = process.argv[1];
const runIdRaw = decodeRunId(process.argv[2]);
const laneIdRaw = decodeLaneId(process.argv[3]);
const attemptRaw = decodeAttemptId(Number(process.argv[4]));
const limit = Number(process.argv[5]);
const readyPath = process.argv[6];
const goPath = process.argv[7];
const barrierWaitMs = Number(process.argv[8]);

if (typeof runIdRaw !== "string" || typeof laneIdRaw !== "string" || typeof attemptRaw !== "number") {
  process.stderr.write("worker_decode_failed\\n");
  process.exit(3);
}

function publishMarker(finalPath, body) {
  const tmpPath = finalPath + ".tmp." + String(process.pid);
  writeFileSync(tmpPath, body);
  renameSync(tmpPath, finalPath);
}

publishMarker(
  readyPath,
  JSON.stringify({ pid: process.pid, at: Date.now() }) + "\\n",
);

const goDeadline = Date.now() + barrierWaitMs;
while (!existsSync(goPath)) {
  if (Date.now() > goDeadline) {
    process.stderr.write("barrier_wait_timeout\\n");
    process.exit(2);
  }
  await delay(5);
}

const identity = makeAttemptIdentity(runIdRaw, laneIdRaw, attemptRaw);
const exit = await Effect.runPromiseExit(
  Effect.gen(function* () {
    const j = yield* RunJournal;
    return yield* j.reserveResumeAttempt(identity, limit);
  }).pipe(Effect.provide(makeLiveRunJournalLayer(root))),
);

if (Exit.isSuccess(exit)) {
  process.stdout.write(
    JSON.stringify({
      status: "ok",
      resumeCount: exit.value.resumeCount,
      pid: process.pid,
    }) + "\\n",
  );
  process.exitCode = 0;
} else {
  const fails = [...Cause.failures(exit.cause)];
  const first = fails[0];
  const reason =
    first !== undefined && isResumeAttemptFailure(first)
      ? first.reason
      : "unknown";
  process.stdout.write(
    JSON.stringify({ status: "fail", reason, pid: process.pid }) + "\\n",
  );
  if (fails.length === 0) {
    process.stderr.write("defect_or_empty_failure\\n");
  }
  process.exitCode = 1;
}
`;
  }

  /**
   * Holder process: reserveResumeAttempt with afterJournalWriteSync that marks
   * and waits while the exclusive events lock remains held.
   * argv: root runId laneId attempt limit holdMarkerPath releasePath holdWaitMs
   */
  function reserveHolderWorkerEval(): string {
    return `
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { Cause, Effect, Exit } from "effect";
import {
  isResumeAttemptFailure,
  makeLiveRunJournalLayer,
  RunJournal,
} from "./packages/event-log/src/run-journal.ts";
import {
  decodeAttemptId,
  decodeLaneId,
  decodeRunId,
  makeAttemptIdentity,
} from "./packages/event-log/src/attempt.ts";

const root = process.argv[1];
const runIdRaw = decodeRunId(process.argv[2]);
const laneIdRaw = decodeLaneId(process.argv[3]);
const attemptRaw = decodeAttemptId(Number(process.argv[4]));
const limit = Number(process.argv[5]);
const holdMarkerPath = process.argv[6];
const releasePath = process.argv[7];
const holdWaitMs = Number(process.argv[8]);

if (typeof runIdRaw !== "string" || typeof laneIdRaw !== "string" || typeof attemptRaw !== "number") {
  process.stderr.write("worker_decode_failed\\n");
  process.exit(3);
}

function publishMarker(finalPath, body) {
  const tmpPath = finalPath + ".tmp." + String(process.pid);
  writeFileSync(tmpPath, body);
  renameSync(tmpPath, finalPath);
}

const identity = makeAttemptIdentity(runIdRaw, laneIdRaw, attemptRaw);
const exit = await Effect.runPromiseExit(
  Effect.gen(function* () {
    const j = yield* RunJournal;
    return yield* j.reserveResumeAttempt(identity, limit);
  }).pipe(
    Effect.provide(
      makeLiveRunJournalLayer(root, {
        afterJournalWriteSync: () => {
          publishMarker(
            holdMarkerPath,
            JSON.stringify({
              role: "holder",
              pid: process.pid,
              at: Date.now(),
            }) + "\\n",
          );
          const deadline = Date.now() + holdWaitMs;
          while (!existsSync(releasePath)) {
            if (Date.now() > deadline) {
              process.stderr.write("holder_release_timeout\\n");
              process.exit(2);
            }
          }
        },
      }),
    ),
  ),
);

if (Exit.isSuccess(exit)) {
  process.stdout.write(
    JSON.stringify({
      status: "ok",
      resumeCount: exit.value.resumeCount,
      pid: process.pid,
    }) + "\\n",
  );
  process.exitCode = 0;
} else {
  const fails = [...Cause.failures(exit.cause)];
  const first = fails[0];
  const reason =
    first !== undefined && isResumeAttemptFailure(first)
      ? first.reason
      : "unknown";
  process.stdout.write(
    JSON.stringify({ status: "fail", reason, pid: process.pid }) + "\\n",
  );
  if (fails.length === 0) {
    process.stderr.write("defect_or_empty_failure\\n");
  }
  process.exitCode = 1;
}
`;
  }

  /**
   * Contender process: reserveResumeAttempt with waitMs lock-retry seam that
   * marks when exclusive lock create observes the held lock (EEXIST path).
   * argv: root runId laneId attempt limit contentionMarkerPath lockBoundMs
   */
  function reserveContenderWorkerEval(): string {
    return `
import { renameSync, writeFileSync } from "node:fs";
import { Cause, Effect, Exit } from "effect";
import {
  isResumeAttemptFailure,
  isRunJournalFailure,
  makeLiveRunJournalLayer,
  RunJournal,
} from "./packages/event-log/src/run-journal.ts";
import {
  decodeAttemptId,
  decodeLaneId,
  decodeRunId,
  makeAttemptIdentity,
} from "./packages/event-log/src/attempt.ts";

const root = process.argv[1];
const runIdRaw = decodeRunId(process.argv[2]);
const laneIdRaw = decodeLaneId(process.argv[3]);
const attemptRaw = decodeAttemptId(Number(process.argv[4]));
const limit = Number(process.argv[5]);
const contentionMarkerPath = process.argv[6];
const lockBoundMs = Number(process.argv[7]);

if (typeof runIdRaw !== "string" || typeof laneIdRaw !== "string" || typeof attemptRaw !== "number") {
  process.stderr.write("worker_decode_failed\\n");
  process.exit(3);
}

function publishMarker(finalPath, body) {
  const tmpPath = finalPath + ".tmp." + String(process.pid);
  writeFileSync(tmpPath, body);
  renameSync(tmpPath, finalPath);
}

let contentionWritten = false;
const identity = makeAttemptIdentity(runIdRaw, laneIdRaw, attemptRaw);
const exit = await Effect.runPromiseExit(
  Effect.gen(function* () {
    const j = yield* RunJournal;
    return yield* j.reserveResumeAttempt(identity, limit);
  }).pipe(
    Effect.provide(
      makeLiveRunJournalLayer(root, {
        lockBoundMs,
        lockSpinMs: 20,
        waitMs: (ms) => {
          // waitMs runs only on the held-lock EEXIST retry path.
          if (!contentionWritten) {
            contentionWritten = true;
            publishMarker(
              contentionMarkerPath,
              JSON.stringify({
                role: "contender",
                pid: process.pid,
                at: Date.now(),
                spinMs: ms,
              }) + "\\n",
            );
          }
          const end = Date.now() + Math.max(ms, 1);
          while (Date.now() < end) {
            /* short spin between lock retries */
          }
        },
      }),
    ),
  ),
);

if (Exit.isSuccess(exit)) {
  process.stdout.write(
    JSON.stringify({
      status: "ok",
      resumeCount: exit.value.resumeCount,
      pid: process.pid,
    }) + "\\n",
  );
  process.exitCode = 0;
} else {
  const fails = [...Cause.failures(exit.cause)];
  const first = fails[0];
  let reason = "unknown";
  if (first !== undefined && isResumeAttemptFailure(first)) {
    reason = first.reason;
  } else if (first !== undefined && isRunJournalFailure(first)) {
    reason = first.reason;
  }
  process.stdout.write(
    JSON.stringify({ status: "fail", reason, pid: process.pid }) + "\\n",
  );
  if (fails.length === 0) {
    process.stderr.write("defect_or_empty_failure\\n");
  }
  process.exitCode = 1;
}
`;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Race a promise against a cancelable wall-clock deadline.
   * Clears the timer on settle so a successful path leaves no long timer
   * that would delay Node process exit.
   */
  function withDeadline<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout waiting for ${label} (${timeoutMs}ms)`));
      }, timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  async function waitUntil(
    predicate: () => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await sleep(10);
    }
    throw new Error(`timeout waiting for ${label} (${timeoutMs}ms)`);
  }

  function spawnCaptured(
    spawn: typeof import("node:child_process").spawn,
    args: readonly string[],
  ): SpawnHandle {
    const child = spawn(process.execPath, [...args], {
      cwd: process.cwd(),
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    child.stderr?.on("data", (c: Buffer) => {
      err += c.toString("utf8");
    });
    const snapshot = (): ChildCapture => ({
      code: child.exitCode,
      out,
      err,
      pid: child.pid,
    });
    const done = new Promise<ChildCapture>((resolveP) => {
      child.on("close", (code) =>
        resolveP({ code, out, err, pid: child.pid }),
      );
    });
    return { child, done, snapshot };
  }

  function killChild(child: import("node:child_process").ChildProcess): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.kill("SIGKILL");
    } catch {
      /* already reaped */
    }
  }

  /** Best-effort release of stdio/handles so a hung child cannot pin Node open. */
  function releaseChildHandles(
    child: import("node:child_process").ChildProcess,
  ): void {
    try {
      child.stdout?.destroy();
    } catch {
      /* ignore */
    }
    try {
      child.stderr?.destroy();
    } catch {
      /* ignore */
    }
    try {
      child.stdin?.destroy();
    } catch {
      /* ignore */
    }
    try {
      child.unref();
    } catch {
      /* ignore */
    }
  }

  /**
   * SIGKILL children, then wait for close under a second bound.
   * On a second deadline, destroy/unref remaining handles and return
   * snapshots available at that point (never hang indefinitely).
   */
  async function killAndReap(
    handles: readonly SpawnHandle[],
    reapBoundMs: number = POST_KILL_REAP_BOUND_MS,
  ): Promise<ChildCapture[]> {
    for (const h of handles) killChild(h.child);
    try {
      return await withDeadline(
        Promise.all(handles.map((h) => h.done)),
        reapBoundMs,
        "post-kill child reaping",
      );
    } catch {
      for (const h of handles) releaseChildHandles(h.child);
      return handles.map((h) => h.snapshot());
    }
  }

  /**
   * Format a multi-process timeout failure so the original error and any
   * post-kill child capture (exit code, stdout, stderr) remain in the message.
   * Startup-timeout paths must not discard killAndReap results.
   */
  function formatChildTimeoutDiagnostic(
    label: string,
    err: unknown,
    capture: ChildCapture,
  ): string {
    return `${label}: ${String(err)}; code=${String(capture.code)} err=${capture.err} out=${capture.out}`;
  }

  function parseReserveResult(capture: ChildCapture): ReserveChildResult {
    const line = capture.out
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.startsWith("{"));
    assert.ok(
      line !== undefined,
      `child stdout missing JSON result; code=${String(capture.code)} err=${capture.err} out=${capture.out}`,
    );
    const parsed = JSON.parse(line) as ReserveChildResult;
    assert.ok(
      parsed.status === "ok" || parsed.status === "fail",
      `unexpected status in ${line}`,
    );
    return parsed;
  }

  it("two separate OS processes allocate one lane concurrently", async () => {
    await withStateRoot(async (root) => {
      const { spawn } = await import("node:child_process");
      const args = (op: string) => [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        workerEval("allocate"),
        root,
        String(runId),
        String(laneId),
        op,
      ];
      const runOne = () =>
        new Promise<{ code: number | null; out: string; err: string }>(
          (resolveP) => {
            const child = spawn(process.execPath, args("allocate"), {
              cwd: process.cwd(),
            });
            let out = "";
            let err = "";
            child.stdout.on("data", (c: Buffer) => {
              out += c.toString("utf8");
            });
            child.stderr.on("data", (c: Buffer) => {
              err += c.toString("utf8");
            });
            child.on("close", (code) => resolveP({ code, out, err }));
          },
        );
      const [r1, r2] = await Promise.all([runOne(), runOne()]);
      assert.equal(r1.code, 0, r1.err + r1.out);
      assert.equal(r2.code, 0, r2.err + r2.out);
      const ids = [Number(r1.out.trim()), Number(r2.out.trim())].sort(
        (x, y) => x - y,
      );
      assert.deepEqual(ids, [1, 2]);
      const path = join(root, "runs", runId, "attempts", `${laneId}.txt`);
      assert.equal(readFileSync(path, "utf8"), "3\n");
    });
  });

  it("two separate OS processes append one run concurrently", async () => {
    await withStateRoot(async (root) => {
      const { spawn } = await import("node:child_process");
      const args = [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        workerEval("append"),
        root,
        String(runId),
        String(laneId),
        "append",
      ];
      const runOne = () =>
        new Promise<{ code: number | null; out: string; err: string }>(
          (resolveP) => {
            const child = spawn(process.execPath, args, {
              cwd: process.cwd(),
            });
            let out = "";
            let err = "";
            child.stdout.on("data", (c: Buffer) => {
              out += c.toString("utf8");
            });
            child.stderr.on("data", (c: Buffer) => {
              err += c.toString("utf8");
            });
            child.on("close", (code) => resolveP({ code, out, err }));
          },
        );
      const [r1, r2] = await Promise.all([runOne(), runOne()]);
      assert.equal(r1.code, 0, r1.err + r1.out);
      assert.equal(r2.code, 0, r2.err + r2.out);
      const seqs = [Number(r1.out.trim()), Number(r2.out.trim())].sort(
        (x, y) => x - y,
      );
      assert.deepEqual(seqs, [1, 2]);
      const journalPath = join(root, "runs", runId, "events.ndjson");
      const bytes = readFileSync(journalPath);
      const replay = replayNdjsonBytes(bytes, { fromLine: 0 });
      assert.equal(replay.terminal._tag, "CleanEof");
      assert.deepEqual(
        replay.records.map((r) => r.event.seq),
        [1, 2],
      );
    });
  });

  /**
   * RED witness: two multi-process reservations run strictly one after the
   * other. Outcomes match limit-one exhaustion, but this is sequential and
   * is not concurrency acceptance evidence (no shared start barrier).
   */
  it("serialized multi-process limit-one witness exhausts without concurrent start", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      // Diagnostic contract for startup-timeout paths: post-kill capture fields
      // must appear in the failure message (no discarded killAndReap result).
      const sampleStartupDiag = formatChildTimeoutDiagnostic(
        "serial child 0 startup timeout",
        new Error("waitUntil timed out: serial ready-0"),
        {
          code: 137,
          out: "stdout-sample",
          err: "stderr-sample",
          pid: 4242,
        },
      );
      assert.match(
        sampleStartupDiag,
        /code=137/,
        `startup diagnostic must include exit code; got: ${sampleStartupDiag}`,
      );
      assert.match(
        sampleStartupDiag,
        /err=stderr-sample/,
        `startup diagnostic must include stderr; got: ${sampleStartupDiag}`,
      );
      assert.match(
        sampleStartupDiag,
        /out=stdout-sample/,
        `startup diagnostic must include stdout; got: ${sampleStartupDiag}`,
      );
      const { spawn } = await import("node:child_process");
      const barrierDir = mkdtempSync(join(tmpdir(), "rj-serial-"));
      try {
        const runSerialChild = async (index: number): Promise<ChildCapture> => {
          const readyPath = join(barrierDir, `ready-${String(index)}`);
          const goPath = join(barrierDir, `go-${String(index)}`);
          const args = [
            "--import",
            "tsx",
            "--input-type=module",
            "-e",
            reserveBarrierWorkerEval(),
            root,
            String(runId),
            String(laneId),
            "1",
            "1",
            readyPath,
            goPath,
            String(BARRIER_WAIT_BOUND_MS),
          ];
          const handle = spawnCaptured(spawn, args);
          try {
            await waitUntil(
              () => existsSync(readyPath),
              CHILD_STARTUP_BOUND_MS,
              `serial ready-${String(index)}`,
            );
            writeFileSync(goPath, "go\n");
            try {
              return await withDeadline(
                handle.done,
                CHILD_COMPLETION_BOUND_MS,
                `serial child ${String(index)} completion`,
              );
            } catch (completionErr) {
              const late = await killAndReap([handle]);
              assert.fail(
                formatChildTimeoutDiagnostic(
                  `serial child ${String(index)} completion timeout`,
                  completionErr,
                  late[0]!,
                ),
              );
            }
          } catch (e) {
            // Inner completion-timeout already reaped and produced a diagnostic.
            if (e instanceof assert.AssertionError) throw e;
            const late = await killAndReap([handle]);
            assert.fail(
              formatChildTimeoutDiagnostic(
                `serial child ${String(index)} startup timeout`,
                e,
                late[0]!,
              ),
            );
          }
        };

        const first = await runSerialChild(0);
        const second = await runSerialChild(1);
        const results = [parseReserveResult(first), parseReserveResult(second)];
        const oks = results.filter((r) => r.status === "ok");
        const fails = results.filter((r) => r.status === "fail");
        assert.equal(oks.length, 1, JSON.stringify({ first, second, results }));
        assert.equal(fails.length, 1, JSON.stringify({ first, second, results }));
        assert.equal(oks[0]!.resumeCount, 1);
        assert.equal(fails[0]!.reason, "resume_limit_reached");
        assert.equal(journalResumeAttemptCount(root), 1);
        // Evidence that this witness was sequential: second ready file cannot
        // exist before the first child has already exited.
        assert.ok(first.code === 0 || first.code === 1, `first exit ${String(first.code)} err=${first.err}`);
        assert.ok(second.code === 0 || second.code === 1, `second exit ${String(second.code)} err=${second.err}`);
      } finally {
        rmSync(barrierDir, { recursive: true, force: true });
      }
    });
  });

  /**
   * GREEN concurrency acceptance: holder pauses inside afterJournalWriteSync
   * while the events lock remains held; contender waitMs lock-retry seam
   * records that exclusive lock create observed the held path. Parent
   * releases the holder only after that contention marker exists.
   */
  it("cross-process contender observes holder journal lock before limit one exhaustion", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      const { spawn } = await import("node:child_process");
      const markerDir = mkdtempSync(join(tmpdir(), "rj-contention-"));
      const holdMarkerPath = join(markerDir, "holder-hold");
      const releasePath = join(markerDir, "holder-release");
      const contentionMarkerPath = join(markerDir, "contender-contention");
      const handles: SpawnHandle[] = [];
      try {
        const holderArgs = [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          reserveHolderWorkerEval(),
          root,
          String(runId),
          String(laneId),
          "1",
          "1",
          holdMarkerPath,
          releasePath,
          String(HOLDER_HOLD_WAIT_MS),
        ];
        const contenderArgs = [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          reserveContenderWorkerEval(),
          root,
          String(runId),
          String(laneId),
          "1",
          "1",
          contentionMarkerPath,
          String(CONTENDER_LOCK_BOUND_MS),
        ];

        const holder = spawnCaptured(spawn, holderArgs);
        handles.push(holder);

        try {
          await waitUntil(
            () => existsSync(holdMarkerPath),
            CHILD_STARTUP_BOUND_MS,
            "holder afterJournalWriteSync hold marker",
          );
        } catch (e) {
          const late = await killAndReap([holder]);
          assert.fail(
            `holder hold marker timeout: ${String(e)}; code=${String(late[0]!.code)} err=${late[0]!.err} out=${late[0]!.out}`,
          );
        }

        assert.equal(
          existsSync(contentionMarkerPath),
          false,
          "contention marker must not exist before contender starts",
        );
        assert.equal(
          existsSync(releasePath),
          false,
          "holder must still hold the journal lock before release",
        );

        const contender = spawnCaptured(spawn, contenderArgs);
        handles.push(contender);

        try {
          await waitUntil(
            () => existsSync(contentionMarkerPath),
            CONTENTION_OBSERVE_BOUND_MS,
            "contender waitMs lock-retry contention marker",
          );
        } catch (e) {
          const late = await killAndReap([holder, contender]);
          assert.fail(
            `contender contention marker timeout: ${String(e)}; captures=${JSON.stringify(late)}`,
          );
        }

        // Contender observed the held exclusive lock while the holder still
        // paused inside afterJournalWriteSync (journal lock not released).
        // Markers are published via temp+rename, so path existence implies
        // complete content is visible.
        const holdMarker = readFileSync(holdMarkerPath, "utf8").trim();
        const contentionMarker = readFileSync(
          contentionMarkerPath,
          "utf8",
        ).trim();
        const observedAt = Date.now();
        assert.equal(existsSync(releasePath), false, "must release only after contention");
        writeFileSync(
          releasePath,
          JSON.stringify({
            holdMarker,
            contentionMarker,
            releasedAt: observedAt,
          }) + "\n",
        );

        let holderCapture: ChildCapture;
        let contenderCapture: ChildCapture;
        try {
          const timed = await withDeadline(
            Promise.all([holder.done, contender.done]),
            CHILD_COMPLETION_BOUND_MS,
            "holder/contender completion",
          );
          holderCapture = timed[0]!;
          contenderCapture = timed[1]!;
        } catch (completionErr) {
          const late = await killAndReap([holder, contender]);
          assert.fail(
            `holder/contender completion timeout: ${String(completionErr)}; captures=${JSON.stringify(late)}`,
          );
        }

        const evidence = {
          holdMarker,
          contentionMarker,
          releasedAt: observedAt,
          holder: {
            code: holderCapture.code,
            err: holderCapture.err,
            out: holderCapture.out,
            pid: holderCapture.pid,
          },
          contender: {
            code: contenderCapture.code,
            err: contenderCapture.err,
            out: contenderCapture.out,
            pid: contenderCapture.pid,
          },
        };

        const holderResult = parseReserveResult(holderCapture);
        const contenderResult = parseReserveResult(contenderCapture);
        const results = [holderResult, contenderResult];
        const oks = results.filter((r) => r.status === "ok");
        const fails = results.filter((r) => r.status === "fail");
        assert.equal(
          oks.length,
          1,
          `exactly one success expected: ${JSON.stringify(evidence)}`,
        );
        assert.equal(
          fails.length,
          1,
          `exactly one failure expected: ${JSON.stringify(evidence)}`,
        );
        assert.equal(oks[0]!.resumeCount, 1, JSON.stringify(evidence));
        assert.equal(
          fails[0]!.reason,
          "resume_limit_reached",
          JSON.stringify(evidence),
        );

        // Holder must be the success (count 1) and contender the limit failure.
        assert.equal(
          holderResult.status,
          "ok",
          `holder must succeed under lock: ${JSON.stringify(evidence)}`,
        );
        assert.equal(
          holderResult.status === "ok" ? holderResult.resumeCount : -1,
          1,
          JSON.stringify(evidence),
        );
        assert.equal(
          contenderResult.status,
          "fail",
          `contender must hit limit after observing lock: ${JSON.stringify(evidence)}`,
        );
        assert.equal(
          contenderResult.status === "fail" ? contenderResult.reason : "",
          "resume_limit_reached",
          JSON.stringify(evidence),
        );
        assert.equal(
          holderCapture.code,
          0,
          `holder exit: ${JSON.stringify(evidence)}`,
        );
        assert.equal(
          contenderCapture.code,
          1,
          `contender exit: ${JSON.stringify(evidence)}`,
        );
        assert.equal(
          holderCapture.err.includes("holder_release_timeout"),
          false,
          holderCapture.err,
        );
        assert.equal(
          holderCapture.err.includes("defect_or_empty_failure"),
          false,
          holderCapture.err,
        );
        assert.equal(
          contenderCapture.err.includes("defect_or_empty_failure"),
          false,
          contenderCapture.err,
        );

        // Lock-contention evidence: contender marker was written before release.
        const holdParsed = JSON.parse(holdMarker) as {
          role: string;
          pid: number;
          at: number;
        };
        const contentionParsed = JSON.parse(contentionMarker) as {
          role: string;
          pid: number;
          at: number;
          spinMs: number;
        };
        assert.equal(holdParsed.role, "holder", JSON.stringify(evidence));
        assert.equal(
          contentionParsed.role,
          "contender",
          JSON.stringify(evidence),
        );
        assert.ok(
          contentionParsed.at >= holdParsed.at,
          `contention must follow hold: ${JSON.stringify(evidence)}`,
        );
        assert.ok(
          observedAt >= contentionParsed.at,
          `release must follow contention: ${JSON.stringify(evidence)}`,
        );

        assert.equal(
          journalResumeAttemptCount(root),
          1,
          JSON.stringify(evidence),
        );
        const journalPath = join(root, "runs", runId, "events.ndjson");
        const bytes = readFileSync(journalPath);
        const replay = replayNdjsonBytes(bytes, { fromLine: 0 });
        assert.equal(replay.terminal._tag, "CleanEof");
        const resumeEvents = replay.records.filter(
          (r) => r.event.type === "resume_attempt",
        );
        assert.equal(resumeEvents.length, 1, JSON.stringify(evidence));
        const payload = resumeEvents[0]!.event.payload;
        assert.equal(payload["attempt"], 1);
        assert.equal(payload["resumeCount"], 1);
        assert.equal(
          Object.keys(payload).sort().join(","),
          "attempt,resumeCount",
        );
      } finally {
        if (handles.length > 0) {
          await killAndReap(handles);
        }
        rmSync(markerDir, { recursive: true, force: true });
      }
    });
  });
});

describe("RunJournal reserveResumeAttempt", () => {
  it("first reservation binds attempt and returns count 1 with exact payload", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 3);
      const id = identity(3);
      const exit = await Effect.runPromiseExit(reserveEffect(root, id, 3));
      assert.equal(Exit.isSuccess(exit), true);
      if (Exit.isSuccess(exit)) {
        const r = exit.value;
        assert.deepEqual(r.attemptIdentity, id);
        assert.equal(r.resumeCount, 1);
        assert.equal(r.event.type, "resume_attempt");
        assert.equal(r.event.lane, String(laneId));
        assert.equal(r.event.payload["attempt"], 3);
        assert.equal(r.event.payload["resumeCount"], 1);
        assert.equal(Object.keys(r.event.payload).sort().join(","), "attempt,resumeCount");
      }
      assert.equal(journalResumeAttemptCount(root), 1);
    });
  });

  it("lane-wide consecutive counts continue across attempts", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      const a = await Effect.runPromise(reserveEffect(root, identity(1), 5));
      assert.equal(a.resumeCount, 1);
      await Effect.runPromise(
        appendEffect(
          root,
          draft({ type: "prompt", payload: { attempt: 2 } }),
        ),
      );
      const b = await Effect.runPromise(reserveEffect(root, identity(2), 5));
      assert.equal(b.resumeCount, 2);
      assert.equal(b.event.payload["attempt"], 2);
      assert.equal(b.event.payload["resumeCount"], 2);
      assert.equal(Object.keys(b.event.payload).sort().join(","), "attempt,resumeCount");
      assert.equal(journalResumeAttemptCount(root), 2);
    });
  });

  it("opaque unknown event types do not affect the count", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      await Effect.runPromise(
        appendEffect(
          root,
          draft({ type: "checkpoint", commit: "a".repeat(40), payload: {} }),
        ),
      );
      await Effect.runPromise(
        appendEffect(
          root,
          draft({ type: "alert", payload: { kind: "stall" } }),
        ),
      );
      const r = await Effect.runPromise(reserveEffect(root, identity(1), 3));
      assert.equal(r.resumeCount, 1);
    });
  });

  it("other-lane resume_attempt and resume do not affect this lane", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1, String(otherLaneId));
      await Effect.runPromise(
        appendEffect(
          root,
          draft({
            type: "resume_attempt",
            lane: String(otherLaneId),
            payload: { attempt: 1, resumeCount: 1 },
          }),
        ),
      );
      await Effect.runPromise(
        appendEffect(
          root,
          draft({
            type: "resume",
            lane: String(otherLaneId),
            payload: { note: "legacy" },
          }),
        ),
      );
      await seedPrompt(root, 2);
      const r = await Effect.runPromise(reserveEffect(root, identity(2), 3));
      assert.equal(r.resumeCount, 1);
      assert.equal(journalResumeAttemptCount(root, String(laneId)), 1);
    });
  });

  it("non-current attempt fails with attempt_not_current and no append", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 4);
      const before = readFileSync(join(root, "runs", runId, "events.ndjson"));
      const either = await Effect.runPromise(
        Effect.either(reserveEffect(root, identity(3), 3)),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertResumeFailure(either.left, "attempt_not_current");
      }
      assert.ok(before.equals(readFileSync(join(root, "runs", runId, "events.ndjson"))));
      assert.equal(journalResumeAttemptCount(root), 0);
    });
  });

  it("durable round_done for selected attempt fails reserve before append", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      await Effect.runPromise(
        appendEffect(
          root,
          draft({
            type: "round_done",
            payload: {
              attempt: 1,
              outcome: { _tag: "completed" },
            },
          }),
        ),
      );
      const before = readFileSync(join(root, "runs", runId, "events.ndjson"));
      const either = await Effect.runPromise(
        Effect.either(reserveEffect(root, identity(1), 3)),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertResumeFailure(either.left, "attempt_not_current");
      }
      assert.ok(
        before.equals(readFileSync(join(root, "runs", runId, "events.ndjson"))),
      );
      assert.equal(journalResumeAttemptCount(root), 0);
    });
  });

  it("absent latest prompt fails with attempt_not_current", async () => {
    await withStateRoot(async (root) => {
      await Effect.runPromise(
        appendEffect(
          root,
          draft({ type: "checkpoint", commit: "b".repeat(40), payload: {} }),
        ),
      );
      const either = await Effect.runPromise(
        Effect.either(reserveEffect(root, identity(1), 3)),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertResumeFailure(either.left, "attempt_not_current");
      }
      assert.equal(journalResumeAttemptCount(root), 0);
    });
  });

  it("malformed latest prompt attempt fails with attempt_not_current", async () => {
    await withStateRoot(async (root) => {
      await Effect.runPromise(
        appendEffect(
          root,
          draft({ type: "prompt", payload: { attempt: 0 } }),
        ),
      );
      const either = await Effect.runPromise(
        Effect.either(reserveEffect(root, identity(1), 3)),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertResumeFailure(either.left, "attempt_not_current");
      }
    });
  });

  it("legacy lane resume fails with legacy_unbound and no append", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      await Effect.runPromise(
        appendEffect(
          root,
          draft({ type: "resume", payload: { reason: "legacy" } }),
        ),
      );
      const before = readFileSync(join(root, "runs", runId, "events.ndjson"));
      const either = await Effect.runPromise(
        Effect.either(reserveEffect(root, identity(1), 3)),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertResumeFailure(either.left, "legacy_unbound");
      }
      assert.ok(before.equals(readFileSync(join(root, "runs", runId, "events.ndjson"))));
    });
  });

  it("count gap fails with invalid_resume_history and does not repair", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      await Effect.runPromise(
        appendEffect(
          root,
          draft({
            type: "resume_attempt",
            payload: { attempt: 1, resumeCount: 1 },
          }),
        ),
      );
      await Effect.runPromise(
        appendEffect(
          root,
          draft({
            type: "resume_attempt",
            payload: { attempt: 1, resumeCount: 3 },
          }),
        ),
      );
      const before = readFileSync(join(root, "runs", runId, "events.ndjson"));
      const either = await Effect.runPromise(
        Effect.either(reserveEffect(root, identity(1), 10)),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertResumeFailure(either.left, "invalid_resume_history");
      }
      assert.ok(before.equals(readFileSync(join(root, "runs", runId, "events.ndjson"))));
      assert.equal(journalResumeAttemptCount(root), 2);
    });
  });

  const malformedPayloads: readonly {
    name: string;
    payload: Readonly<Record<string, unknown>>;
  }[] = [
    { name: "extra key", payload: { attempt: 1, resumeCount: 1, x: true } },
    { name: "missing resumeCount", payload: { attempt: 1 } },
    { name: "missing attempt", payload: { resumeCount: 1 } },
    { name: "zero resumeCount", payload: { attempt: 1, resumeCount: 0 } },
    { name: "negative resumeCount", payload: { attempt: 1, resumeCount: -1 } },
    { name: "string resumeCount", payload: { attempt: 1, resumeCount: "1" } },
    { name: "zero attempt", payload: { attempt: 0, resumeCount: 1 } },
    { name: "float resumeCount", payload: { attempt: 1, resumeCount: 1.5 } },
    { name: "count above 100", payload: { attempt: 1, resumeCount: 101 } },
  ];

  for (const c of malformedPayloads) {
    it(`malformed resume_attempt (${c.name}) is invalid_resume_history`, async () => {
      await withStateRoot(async (root) => {
        await seedPrompt(root, 1);
        await Effect.runPromise(
          appendEffect(
            root,
            draft({ type: "resume_attempt", payload: c.payload }),
          ),
        );
        const either = await Effect.runPromise(
          Effect.either(reserveEffect(root, identity(1), 10)),
        );
        assert.equal(either._tag, "Left");
        if (either._tag === "Left") {
          assertResumeFailure(either.left, "invalid_resume_history");
        }
        assert.equal(journalResumeAttemptCount(root), 1);
      });
    });
  }

  it("duplicate count fails with invalid_resume_history", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      await Effect.runPromise(
        appendEffect(
          root,
          draft({
            type: "resume_attempt",
            payload: { attempt: 1, resumeCount: 1 },
          }),
        ),
      );
      await Effect.runPromise(
        appendEffect(
          root,
          draft({
            type: "resume_attempt",
            payload: { attempt: 1, resumeCount: 1 },
          }),
        ),
      );
      const either = await Effect.runPromise(
        Effect.either(reserveEffect(root, identity(1), 10)),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertResumeFailure(either.left, "invalid_resume_history");
      }
    });
  });

  const invalidLimits: readonly number[] = [
    0,
    -1,
    1.5,
    101,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ];

  for (const limit of invalidLimits) {
    it(`invalid limit ${String(limit)} fails with invalid_limit`, async () => {
      await withStateRoot(async (root) => {
        await seedPrompt(root, 1);
        const either = await Effect.runPromise(
          Effect.either(reserveEffect(root, identity(1), limit)),
        );
        assert.equal(either._tag, "Left");
        if (either._tag === "Left") {
          assertResumeFailure(either.left, "invalid_limit");
        }
        assert.equal(journalResumeAttemptCount(root), 0);
      });
    });
  }

  it("exhausted limit fails with resume_limit_reached and no second event", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      const first = await Effect.runPromise(reserveEffect(root, identity(1), 1));
      assert.equal(first.resumeCount, 1);
      const either = await Effect.runPromise(
        Effect.either(reserveEffect(root, identity(1), 1)),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertResumeFailure(either.left, "resume_limit_reached");
      }
      assert.equal(journalResumeAttemptCount(root), 1);
    });
  });

  // Limit-one concurrency acceptance lives in "RunJournal multi-process":
  // two OS processes share one start barrier. In-process runFork is not evidence.

  it("concurrent successful reservations get distinct consecutive counts", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 2);
      const fibers = [0, 1, 2].map(() =>
        Effect.runFork(reserveEffect(root, identity(2), 5)),
      );
      const results = await Promise.all(
        fibers.map((f) => Effect.runPromise(Fiber.join(f))),
      );
      const counts = results.map((r) => r.resumeCount).sort((a, b) => a - b);
      assert.deepEqual(counts, [1, 2, 3]);
      assert.equal(journalResumeAttemptCount(root), 3);
    });
  });

  it("filesystem seam throw maps to closed typed failure without path leak", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      // Linked journal after seed is not possible via normal append; swap path.
      const journalPath = join(root, "runs", runId, "events.ndjson");
      const real = join(root, "outside-events.ndjson");
      const body = readFileSync(journalPath);
      writeFileSync(real, body);
      unlinkSync(journalPath);
      symlinkSync(real, journalPath);
      const exit = await Effect.runPromiseExit(
        reserveEffect(root, identity(1), 3),
      );
      assert.equal(Exit.isFailure(exit), true);
      if (Exit.isFailure(exit)) {
        assert.equal(Cause.isDie(exit.cause), false);
        const fails = [...Cause.failures(exit.cause)];
        assert.equal(fails.length, 1);
        assertClosedFailure(fails[0], "invalid_path");
        const pretty = Cause.pretty(exit.cause);
        assert.equal(pretty.includes(root), false);
        assert.equal(/ENOENT|EACCES|errno|ELOOP|symlink/.test(pretty), false);
        assert.equal(Cause.defects(exit.cause).length, 0);
        const text = JSON.stringify(fails[0]);
        assert.equal(/Error|ENOENT|EACCES|errno|ELOOP/.test(text), false);
      }
    });
  });

  it("empty journal fails attempt_not_current without creating resume event", async () => {
    await withStateRoot(async (root) => {
      const either = await Effect.runPromise(
        Effect.either(reserveEffect(root, identity(1), 3)),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertResumeFailure(either.left, "attempt_not_current");
      }
      const journalPath = join(root, "runs", runId, "events.ndjson");
      assert.equal(existsSync(journalPath), false);
    });
  });
});

// ---------------------------------------------------------------------------
// inspectResumeAttemptBudget (R5D read-only inspector)
// ---------------------------------------------------------------------------

function record(
  physicalLine: number,
  event: Omit<StoredEvent, "seq" | "ts"> & {
    readonly seq?: number;
    readonly ts?: string;
  },
): ReplayRecord {
  return {
    physicalLine,
    event: {
      seq: event.seq ?? physicalLine,
      ts: event.ts ?? "2026-08-05T12:00:00Z",
      type: event.type,
      lane: event.lane,
      ...(event.commit !== undefined ? { commit: event.commit } : {}),
      payload: event.payload,
    },
  };
}

function readRecords(root: string): readonly ReplayRecord[] {
  const journalPath = join(root, "runs", runId, "events.ndjson");
  if (!existsSync(journalPath)) return [];
  const bytes = readFileSync(journalPath);
  const replay = replayNdjsonBytes(bytes, { fromLine: 0 });
  assert.equal(replay.terminal._tag, "CleanEof");
  return replay.records;
}

describe("inspectResumeAttemptBudget", () => {
  it("returns zero count for a current attempt with no prior reservations", () => {
    const records = [
      record(1, {
        type: "prompt",
        lane: String(laneId),
        payload: { attempt: 1 },
      }),
    ];
    const budget = inspectResumeAttemptBudget(records, identity(1), 2);
    assert.equal(isResumeAttemptFailure(budget), false);
    if (!isResumeAttemptFailure(budget)) {
      assert.equal(budget.resumeCount, 0);
      assert.equal(budget.resumeMaxAttempts, 2);
      assert.equal(budget.exhausted, false);
      assert.deepEqual(budget.attemptIdentity, identity(1));
    }
  });

  it("returns the current valid count after consecutive reservations", () => {
    const records = [
      record(1, {
        type: "prompt",
        lane: String(laneId),
        payload: { attempt: 1 },
      }),
      record(2, {
        type: "resume_attempt",
        lane: String(laneId),
        payload: { attempt: 1, resumeCount: 1 },
      }),
      record(3, {
        type: "prompt",
        lane: String(laneId),
        payload: { attempt: 2 },
      }),
      record(4, {
        type: "resume_attempt",
        lane: String(laneId),
        payload: { attempt: 2, resumeCount: 2 },
      }),
    ];
    const budget = inspectResumeAttemptBudget(records, identity(2), 5);
    assert.equal(isResumeAttemptFailure(budget), false);
    if (!isResumeAttemptFailure(budget)) {
      assert.equal(budget.resumeCount, 2);
      assert.equal(budget.exhausted, false);
    }
  });

  it("reports exhausted=true when count meets the limit without appending", () => {
    const records = [
      record(1, {
        type: "prompt",
        lane: String(laneId),
        payload: { attempt: 1 },
      }),
      record(2, {
        type: "resume_attempt",
        lane: String(laneId),
        payload: { attempt: 1, resumeCount: 1 },
      }),
      record(3, {
        type: "resume_attempt",
        lane: String(laneId),
        payload: { attempt: 1, resumeCount: 2 },
      }),
    ];
    const budget = inspectResumeAttemptBudget(records, identity(1), 2);
    assert.equal(isResumeAttemptFailure(budget), false);
    if (!isResumeAttemptFailure(budget)) {
      assert.equal(budget.resumeCount, 2);
      assert.equal(budget.exhausted, true);
    }
  });

  it("rejects the same invalid histories as reservation", () => {
    const legacy = inspectResumeAttemptBudget(
      [
        record(1, {
          type: "prompt",
          lane: String(laneId),
          payload: { attempt: 1 },
        }),
        record(2, {
          type: "resume",
          lane: String(laneId),
          payload: { note: "legacy" },
        }),
      ],
      identity(1),
      3,
    );
    assertResumeFailure(legacy, "legacy_unbound");

    const notCurrent = inspectResumeAttemptBudget(
      [
        record(1, {
          type: "prompt",
          lane: String(laneId),
          payload: { attempt: 2 },
        }),
      ],
      identity(1),
      3,
    );
    assertResumeFailure(notCurrent, "attempt_not_current");

    const invalidHistory = inspectResumeAttemptBudget(
      [
        record(1, {
          type: "prompt",
          lane: String(laneId),
          payload: { attempt: 1 },
        }),
        record(2, {
          type: "resume_attempt",
          lane: String(laneId),
          payload: { attempt: 1, resumeCount: 2 },
        }),
      ],
      identity(1),
      3,
    );
    assertResumeFailure(invalidHistory, "invalid_resume_history");

    const badLimit = inspectResumeAttemptBudget(
      [
        record(1, {
          type: "prompt",
          lane: String(laneId),
          payload: { attempt: 1 },
        }),
      ],
      identity(1),
      0,
    );
    assertResumeFailure(badLimit, "invalid_limit");
  });

  it("does not mutate journal bytes when only inspecting", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      const before = readFileSync(join(root, "runs", runId, "events.ndjson"));
      const records = readRecords(root);
      const budget = inspectResumeAttemptBudget(records, identity(1), 2);
      assert.equal(isResumeAttemptFailure(budget), false);
      if (!isResumeAttemptFailure(budget)) {
        assert.equal(budget.resumeCount, 0);
        assert.equal(budget.exhausted, false);
      }
      const after = readFileSync(join(root, "runs", runId, "events.ndjson"));
      assert.ok(before.equals(after));
    });
  });

  it("inspection can become stale: later reservation fails after concurrent consume", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      const first = await Effect.runPromise(
        reserveEffect(root, identity(1), 1),
      );
      assert.equal(first.resumeCount, 1);

      const records = readRecords(root);
      // Stale inspector view if someone only counted before the reservation
      // would report available; after consume, inspection is exhausted.
      const budget = inspectResumeAttemptBudget(records, identity(1), 1);
      assert.equal(isResumeAttemptFailure(budget), false);
      if (!isResumeAttemptFailure(budget)) {
        assert.equal(budget.resumeCount, 1);
        assert.equal(budget.exhausted, true);
      }

      const either = await Effect.runPromise(
        Effect.either(reserveEffect(root, identity(1), 1)),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assertResumeFailure(either.left, "resume_limit_reached");
      }
      // Exactly one resume_attempt remains durable.
      assert.equal(journalResumeAttemptCount(root), 1);
    });
  });

  it("reserve reuses inspector: second concurrent-style reserve after inspect fails closed", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      // Snapshot inspection while budget is available.
      const pre = inspectResumeAttemptBudget(
        readRecords(root),
        identity(1),
        1,
      );
      assert.equal(isResumeAttemptFailure(pre), false);
      if (!isResumeAttemptFailure(pre)) {
        assert.equal(pre.exhausted, false);
        assert.equal(pre.resumeCount, 0);
      }

      // Another process consumes the budget.
      await Effect.runPromise(reserveEffect(root, identity(1), 1));

      // Lost race: reservation fails closed; restore/queue must not run
      // (asserted at orchestration layer; here the durable count stays 1).
      const lost = await Effect.runPromise(
        Effect.either(reserveEffect(root, identity(1), 1)),
      );
      assert.equal(lost._tag, "Left");
      if (lost._tag === "Left") {
        assertResumeFailure(lost.left, "resume_limit_reached");
      }
      assert.equal(journalResumeAttemptCount(root), 1);
    });
  });
});
