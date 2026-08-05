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
  isResumeAttemptFailure,
  isRunJournalFailure,
  makeLiveRunJournalLayer,
  RunJournal,
  type LiveRunJournalOptions,
  type StoredEventDraftV1,
} from "./run-journal.js";
import { isAttemptFailure } from "./failures.js";
import { replayNdjsonBytes } from "./replay.js";

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
  /** Child startup bound: both ready files must appear within this window. */
  const CHILD_STARTUP_BOUND_MS = 15_000;
  /** Child barrier wait bound after reporting ready. */
  const BARRIER_WAIT_BOUND_MS = 15_000;
  /** Parent wait for both children to exit after barrier release. */
  const CHILD_COMPLETION_BOUND_MS = 20_000;

  type ChildCapture = {
    readonly code: number | null;
    readonly out: string;
    readonly err: string;
    readonly pid: number | undefined;
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
   * Barrier-synced reserve worker.
   * argv: root runId laneId attempt limit readyPath goPath barrierWaitMs
   * Reports ready, waits for go, then reserveResumeAttempt.
   */
  function reserveBarrierWorkerEval(): string {
    return `
import { existsSync, writeFileSync } from "node:fs";
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

writeFileSync(
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

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
  ): {
    readonly child: import("node:child_process").ChildProcess;
    readonly done: Promise<ChildCapture>;
  } {
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
    const done = new Promise<ChildCapture>((resolveP) => {
      child.on("close", (code) =>
        resolveP({ code, out, err, pid: child.pid }),
      );
    });
    return { child, done };
  }

  function killChild(child: import("node:child_process").ChildProcess): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.kill("SIGKILL");
    } catch {
      /* already reaped */
    }
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
          const { child, done } = spawnCaptured(spawn, args);
          try {
            await waitUntil(
              () => existsSync(readyPath),
              CHILD_STARTUP_BOUND_MS,
              `serial ready-${String(index)}`,
            );
            writeFileSync(goPath, "go\n");
            const timed = await Promise.race([
              done,
              sleep(CHILD_COMPLETION_BOUND_MS).then(() => null),
            ]);
            if (timed === null) {
              killChild(child);
              const late = await done;
              assert.fail(
                `serial child ${String(index)} completion timeout; code=${String(late.code)} err=${late.err} out=${late.out}`,
              );
            }
            return timed;
          } catch (e) {
            killChild(child);
            throw e;
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
   * GREEN concurrency acceptance: two OS processes report ready, parent
   * releases one shared start barrier, then both call reserveResumeAttempt
   * with limit 1. In-process runFork is not acceptance evidence.
   */
  it("two separate processes wait at one start barrier then race limit one", async () => {
    await withStateRoot(async (root) => {
      await seedPrompt(root, 1);
      const { spawn } = await import("node:child_process");
      const barrierDir = mkdtempSync(join(tmpdir(), "rj-race-"));
      const ready0 = join(barrierDir, "ready-0");
      const ready1 = join(barrierDir, "ready-1");
      const goPath = join(barrierDir, "go");
      const children: import("node:child_process").ChildProcess[] = [];
      try {
        const argsFor = (readyPath: string) => [
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

        const c0 = spawnCaptured(spawn, argsFor(ready0));
        const c1 = spawnCaptured(spawn, argsFor(ready1));
        children.push(c0.child, c1.child);

        await waitUntil(
          () => existsSync(ready0) && existsSync(ready1),
          CHILD_STARTUP_BOUND_MS,
          "both ready files",
        );
        // Both children reported ready before the single start barrier release.
        assert.equal(existsSync(goPath), false, "go must not exist before release");
        const readyAtRelease = {
          ready0: readFileSync(ready0, "utf8").trim(),
          ready1: readFileSync(ready1, "utf8").trim(),
          releasedAt: Date.now(),
        };
        writeFileSync(goPath, JSON.stringify(readyAtRelease) + "\n");

        const timed = await Promise.race([
          Promise.all([c0.done, c1.done]),
          sleep(CHILD_COMPLETION_BOUND_MS).then(() => null),
        ]);
        if (timed === null) {
          for (const ch of children) killChild(ch);
          const late = await Promise.all([c0.done, c1.done]);
          assert.fail(
            `barrier race completion timeout; captures=${JSON.stringify(late)}`,
          );
        }
        const [r0, r1] = timed;

        // Capture child stderr and exit codes in assertion evidence.
        const evidence = {
          readyAtRelease,
          children: [
            { code: r0.code, err: r0.err, out: r0.out, pid: r0.pid },
            { code: r1.code, err: r1.err, out: r1.out, pid: r1.pid },
          ],
        };

        const results = [parseReserveResult(r0), parseReserveResult(r1)];
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

        // Exit codes: success child 0, limit child 1; stderr should not show
        // barrier timeout or defects under a healthy lock.
        const paired = [
          { capture: r0, result: results[0]! },
          { capture: r1, result: results[1]! },
        ];
        const successPair = paired.find((p) => p.result.status === "ok");
        const failPair = paired.find((p) => p.result.status === "fail");
        assert.ok(successPair !== undefined && failPair !== undefined);
        assert.equal(
          successPair.capture.code,
          0,
          `success child exit: ${JSON.stringify(evidence)}`,
        );
        assert.equal(
          failPair.capture.code,
          1,
          `limit child exit: ${JSON.stringify(evidence)}`,
        );
        assert.equal(
          successPair.capture.err.includes("barrier_wait_timeout"),
          false,
          successPair.capture.err,
        );
        assert.equal(
          failPair.capture.err.includes("barrier_wait_timeout"),
          false,
          failPair.capture.err,
        );
        assert.equal(
          successPair.capture.err.includes("defect_or_empty_failure"),
          false,
          successPair.capture.err,
        );
        assert.equal(
          failPair.capture.err.includes("defect_or_empty_failure"),
          false,
          failPair.capture.err,
        );

        assert.equal(journalResumeAttemptCount(root), 1, JSON.stringify(evidence));
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
        for (const ch of children) killChild(ch);
        rmSync(barrierDir, { recursive: true, force: true });
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
