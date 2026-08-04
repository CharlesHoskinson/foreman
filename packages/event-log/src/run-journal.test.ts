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
  type LaneId,
  type RunId,
} from "./attempt.js";
import { MAX_REPLAY_INPUT_BYTES } from "./bounds.js";
import {
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
            afterJournalWriteSync: ({ path }) => {
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
            afterJournalWriteSync: ({ path }) => {
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
});
