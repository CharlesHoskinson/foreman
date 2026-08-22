import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fork, type ChildProcess } from "node:child_process";
import { test } from "node:test";

import { SqliteSessionStore } from "./sqlite-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const holderPath = join(here, "busy-timeout-lock-holder.ts");

// How long the child process holds the write lock for. Long enough that IPC
// latency between "the child has the lock" and "this process starts its
// write" (typically low single-digit milliseconds, even loaded) can never
// plausibly eat the whole window, short enough that the suite stays fast.
const HOLD_MS = 600;

function waitForLocked(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("lock holder did not report locked within 5s")),
      5000,
    );
    child.once("message", (msg: unknown) => {
      clearTimeout(timer);
      if ((msg as { type?: string } | null)?.type === "locked") resolve();
      else reject(new Error(`unexpected message from lock holder: ${JSON.stringify(msg)}`));
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`lock holder exited early with code ${code}`));
    });
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => child.once("exit", () => resolve()));
}

test(
  "a write blocks and then succeeds instead of failing while another " +
    "connection holds the write lock",
  async () => {
    // node:sqlite's DatabaseSync is synchronous, so a transaction held open
    // by a second store in the *same* process can never overlap a write
    // attempt from a first one — whichever write runs first always finishes,
    // lock and all, before the second one starts. That shape (open two
    // stores, write through each in turn) cannot exercise SQLITE_BUSY /
    // busy_timeout no matter what the pragma is set to, which is exactly why
    // it must not be used to claim this pragma is proven. A second OS
    // process is the only way to have a write attempt genuinely in flight
    // against a lock that another connection is holding at the same instant.
    const dir = mkdtempSync(join(tmpdir(), "busy-timeout-"));
    const path = join(dir, "s.db");

    // Create the schema up front so the two connections below only ever
    // contend over the write lock, never over first-run schema creation.
    // journal_mode=WAL is persisted into the file itself (unlike
    // busy_timeout/synchronous, which are per-connection), so the holder
    // process inherits WAL from this without setting it again.
    const setup = SqliteSessionStore.open(path);
    setup.close();

    const child = fork(holderPath, [path, String(HOLD_MS)], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });

    try {
      await waitForLocked(child);

      const start = Date.now();
      const store = SqliteSessionStore.open(path);
      let fact: { id: number };
      try {
        // If busy_timeout were not in effect, node:sqlite raises SQLITE_BUSY
        // synchronously the instant it tries to acquire the write lock — this
        // call would throw here, well under HOLD_MS, instead of returning.
        fact = store.addFact({
          statement: "written while a second connection held the write lock",
          evidence: null,
          established_ts: "2026-08-11T00:00:00Z",
          session_id: null,
        });
      } finally {
        store.close();
      }
      const elapsed = Date.now() - start;

      // Not throwing is most of the proof. The timing check is the rest of
      // it: it rules out the write having gotten lucky because the lock
      // happened to already be free (e.g. because busy_timeout silently
      // wasn't the reason this call didn't throw).
      assert.ok(
        elapsed >= HOLD_MS / 2,
        `write returned after only ${elapsed}ms against a lock held for ` +
          `${HOLD_MS}ms — it did not actually wait for the lock`,
      );
      assert.equal(fact.id, 1, "the write should have gone through once the lock was released");
    } finally {
      await waitForExit(child);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
