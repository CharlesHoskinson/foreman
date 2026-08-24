import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import {
  liveProcessExec,
  ProcessExec,
  ProcessFailure,
  type CapturedProcessResult,
  type RunCapturedOptions,
} from "./queue-services.js";

const SCRIPT_TIMEOUT_MS = 5_000;

function runCaptured(
  opts: RunCapturedOptions,
): Effect.Effect<CapturedProcessResult, ProcessFailure> {
  return Effect.gen(function* () {
    const exec = yield* ProcessExec;
    return yield* exec.runCaptured(opts);
  }).pipe(Effect.provide(liveProcessExec));
}

test("runCaptured preserves UTF-8 stdout and stderr string fields", async () => {
  const result = await Effect.runPromise(
    runCaptured({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('hello'); process.stderr.write('err');",
      ],
      maxOutputBytes: 64,
      timeoutMs: SCRIPT_TIMEOUT_MS,
    }),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello");
  assert.equal(result.stderr, "err");
});

test("runCaptured accepts an exact output bound", async () => {
  const payload = "x".repeat(64);
  const result = await Effect.runPromise(
    runCaptured({
      command: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(payload)})`],
      maxOutputBytes: 64,
      timeoutMs: SCRIPT_TIMEOUT_MS,
    }),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, payload);
});

test("runCaptured fails with output_bound on max-plus-one raw bytes", async () => {
  const either = await Effect.runPromise(
    runCaptured({
      command: process.execPath,
      args: ["-e", "process.stdout.write(Buffer.alloc(65, 1))"],
      maxOutputBytes: 64,
      timeoutMs: SCRIPT_TIMEOUT_MS,
    }).pipe(Effect.either),
  );
  assert.equal(either._tag, "Left");
  if (either._tag === "Left") {
    assert.ok(either.left instanceof ProcessFailure);
    assert.equal(either.left.reason, "output_bound");
  }
});

test("runCaptured preserves exact stdoutBytes for raw 0xff", async () => {
  const result = await Effect.runPromise(
    runCaptured({
      command: process.execPath,
      args: ["-e", "process.stdout.write(Buffer.from([0xff]))"],
      maxOutputBytes: 16,
      timeoutMs: SCRIPT_TIMEOUT_MS,
    }),
  );
  assert.equal(result.exitCode, 0);
  const withBytes = result as CapturedProcessResult & {
    readonly stdoutBytes: Uint8Array;
  };
  assert.deepEqual(Array.from(withBytes.stdoutBytes), [255]);
});
