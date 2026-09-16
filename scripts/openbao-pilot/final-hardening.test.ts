import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createHook } from "node:async_hooks";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Cause, Effect, Fiber } from "effect";
import * as pilot from "../openbao-pilot.js";
import { snapshotBinary } from "./binary-receipt.js";
import { observeChild } from "./lifecycle.js";
import { hash } from "./provenance.js";

test("completion requires exactly eleven unique passed outcomes with matching flags", () => {
  const complete = (pilot as any).pilotOutcomesComplete;
  assert.equal(typeof complete, "function");
  const all = Array.from({ length: 11 }, (_, i) => ({ id: `P${String(i + 1).padStart(2, "0")}`, status: "passed", passed: true }));
  assert.equal(complete(all), true);
  assert.equal(complete([...all].reverse()), true);
  for (const invalid of [[], all.slice(1), [...all, all[0]], [...all.slice(1), all[1]], [...all.slice(1), { ...all[0], id: "P12" }], [...all.slice(1), { ...all[0], status: "failed" }], [...all.slice(1), { ...all[0], status: "not-run" }], [...all.slice(1), { ...all[0], passed: false }], [...all.slice(1), { ...all[0], passed: "true" }]]) assert.equal(complete(invalid), false);
});

test("snapshot write collision is sanitized as SnapshotIOFailed and preserves existing bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "foreman-snapshot-io-"));
  try {
    const binary = join(root, "input"); const bytes = "synthetic executable";
    await writeFile(binary, bytes, { mode: 0o700 });
    await writeFile(join(root, "verified-bao"), "owned-collision-canary");
    const exit = await Effect.runPromiseExit(snapshotBinary(binary, hash(bytes), root));
    assert.equal(exit._tag, "Failure");
    if (exit._tag === "Failure") assert.deepEqual(exit.cause, Cause.fail({ _tag: "PilotRunFailure", code: "SnapshotIOFailed" }));
    assert.equal(await readFile(join(root, "verified-bao"), "utf8"), "owned-collision-canary");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("snapshot interruption after filesystem request submission remains interruption", { timeout: 5000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "foreman-snapshot-interrupt-"));
  const bytes = await readFile(process.execPath);
  let entered!: () => void;
  const submitted = new Promise<void>(resolve => { entered = resolve; });
  let ioStarted = false;
  // No other filesystem operation runs between enabling this hook and submission.
  // This observes stat submission, not a partially completed read or write.
  const hook = createHook({ init(_id, type) {
    if (type === "FSREQPROMISE") { ioStarted = true; hook.disable(); entered(); }
  } });
  try {
    hook.enable();
    const fiber = Effect.runFork(snapshotBinary(process.execPath, hash(bytes), root));
    await submitted;
    assert.equal(ioStarted, true);
    const exit = await Effect.runPromise(Fiber.interrupt(fiber));
    assert.equal(exit._tag, "Failure");
    if (exit._tag === "Failure") assert.equal(Cause.isInterruptedOnly(exit.cause), true);
  } finally { hook.disable(); await rm(root, { recursive: true, force: true }); }
});

test("actual missing executable produces spawnFailed and bounded owned cleanup", { timeout: 5000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "foreman-spawn-error-"));
  const owned = observeChild(spawn(join(root, "missing"), [], { stdio: "ignore" }));
  try {
    assert.deepEqual(await owned.exited, { code: null, signal: null, spawnFailed: true });
    await owned.stop();
    assert.equal(owned.child.pid, undefined);
  } finally { await owned.stop(); await rm(root, { recursive: true, force: true }); }
});
