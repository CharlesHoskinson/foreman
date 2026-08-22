/**
 * Child-process helper for the FilesOnly two-contender stale-owner race test.
 *
 * Waits until `goPath` exists, then attempts a writable open. On success,
 * prints WIN, notifies the parent via IPC `{ type: "holding" }`, and holds the
 * writer claim until the parent sends `{ type: "release" }`. On failure,
 * prints LOSE and exits. Must be launched via child_process.fork with IPC.
 *
 * Not a test file — no `.test.ts` suffix.
 */
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { openFilesOnlyStore } from "./files-only.js";

const dirArg = process.argv[2];
const goArg = process.argv[3];
if (dirArg === undefined || goArg === undefined) {
  process.stderr.write("usage: files-only-lock-contender.ts <dir> <go-path>\n");
  process.exit(2);
}
const dir: string = dirArg;
const goPath: string = goArg;
if (typeof process.send !== "function") {
  process.stderr.write("files-only-lock-contender.ts must be run via fork\n");
  process.exit(2);
}

const send = process.send.bind(process);

function waitForRelease(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("release not received within 15s")),
      15_000,
    );
    process.on("message", (msg: unknown) => {
      if ((msg as { type?: string } | null)?.type === "release") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

async function main(): Promise<void> {
  send({ type: "ready" });

  const deadline = Date.now() + 15_000;
  while (!existsSync(goPath)) {
    if (Date.now() > deadline) {
      process.stdout.write("TIMEOUT\n");
      process.exit(3);
    }
    await sleep(5);
  }

  try {
    const store = openFilesOnlyStore({ dir });
    process.stdout.write("WIN\n");
    send({ type: "holding" });
    try {
      await waitForRelease();
    } finally {
      store.close();
    }
    process.exit(0);
  } catch {
    process.stdout.write("LOSE\n");
    process.exit(1);
  }
}

void main();
