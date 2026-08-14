import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { DatabaseSync } from "node:sqlite";

import { SqliteSessionStore } from "./sqlite-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const holderPath = join(here, "busy-timeout-lock-holder.ts");

// BEGIN EXCLUSIVE held for 1500 ms against a DELETE-journal file.
// Measured 2026-08-14 on this host, 3/3 each polarity:
//   known-good (busy_timeout then journal_mode): 1504-1507 ms, mode=wal
//   known-bad (journal_mode first): 0 ms, "database is locked"
// The previous 20x20 sample was not a discriminator. A silent 0 against
// known-bad is possible. Elapsed time is the predicate. The round-2 claim
// that PRAGMA journal_mode=WAL does not wait was false: with busy_timeout
// live the conversion waited out the holder.
const HOLD_MS = 1500;
const GOOD_MIN_MS = 750;
const BAD_MAX_MS = 100;

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

function seedDeleteJournal(path: string): void {
  const seed = new DatabaseSync(path);
  seed.exec("CREATE TABLE IF NOT EXISTS t(x INTEGER)");
  seed.close();
}

async function withExclusiveHolder<T>(path: string, body: () => T): Promise<T> {
  const child = fork(holderPath, [path, String(HOLD_MS), "EXCLUSIVE"], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  try {
    await waitForLocked(child);
    return body();
  } finally {
    await waitForExit(child);
  }
}

test(
  "W2.2: open waits out an exclusive holder once busy_timeout is first",
  { timeout: 30_000 },
  async () => {
    const goodDir = mkdtempSync(join(tmpdir(), "open-race-good-"));
    const goodPath = join(goodDir, "s.db");
    try {
      seedDeleteJournal(goodPath);
      const good = await withExclusiveHolder(goodPath, () => {
        const start = Date.now();
        try {
          const store = SqliteSessionStore.open(goodPath);
          store.close();
          return { elapsed: Date.now() - start, err: null as string | null };
        } catch (e) {
          return { elapsed: Date.now() - start, err: String(e) };
        }
      });
      assert.equal(
        good.err,
        null,
        `known-good open failed after ${good.elapsed}ms: ${good.err}`,
      );
      assert.ok(
        good.elapsed >= GOOD_MIN_MS,
        `known-good returned after only ${good.elapsed}ms against a ` +
          `${HOLD_MS}ms exclusive hold — it did not wait`,
      );
    } finally {
      rmSync(goodDir, { recursive: true, force: true });
    }

    const badDir = mkdtempSync(join(tmpdir(), "open-race-bad-"));
    const badPath = join(badDir, "s.db");
    try {
      seedDeleteJournal(badPath);
      const bad = await withExclusiveHolder(badPath, () => {
        const db = new DatabaseSync(badPath);
        const start = Date.now();
        try {
          db.exec("PRAGMA journal_mode=WAL");
          db.exec("PRAGMA busy_timeout=5000");
          return { elapsed: Date.now() - start, err: null as string | null };
        } catch (e) {
          return { elapsed: Date.now() - start, err: String(e) };
        } finally {
          try {
            db.close();
          } catch {
            // the inverted order throws before WAL conversion finishes
          }
        }
      });
      assert.match(
        String(bad.err),
        /database is locked/,
        `known-bad must fail immediately, got ${String(bad.err)} after ${bad.elapsed}ms`,
      );
      assert.ok(
        bad.elapsed <= BAD_MAX_MS,
        `known-bad waited ${bad.elapsed}ms; inverted pragma order must fail immediately`,
      );
    } finally {
      rmSync(badDir, { recursive: true, force: true });
    }
  },
);
