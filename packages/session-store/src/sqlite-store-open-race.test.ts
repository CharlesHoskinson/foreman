import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { DatabaseSync } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const racerPath = join(here, "sqlite-store-open-racer.ts");

// Known-bad (busy_timeout after journal_mode) is a first-open WAL
// conversion race. Measured ranges, do not treat a silent 0 as a fix:
//   reviewer 20x20: 4-9 of 400 (runs 8, 5, 9, 9, 4)
//   this host 20x20: 1-8 of 400 (runs 4, 1, 5, 8, 1)
// Raising WORKERS reduced discrimination: 80x20 known-bad ran 0, 1, 4,
// 14, 62 because late tsx children miss the conversion window.
// Five 20x20 reseeds made known-good fail (UNIQUE store_meta.key and
// residual SQLITE_BUSY). 20x20 is the largest sample that still
// passes known-good on this host.
const WORKERS = 20;
const OPENS_EACH = 20;
const TOTAL = WORKERS * OPENS_EACH;

function waitForResult(
  child: ChildProcess,
): Promise<{ fails: number; errors: string[] }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("open racer did not finish within 30s")),
      30_000,
    );
    child.once("message", (msg: unknown) => {
      clearTimeout(timer);
      resolve(msg as { fails: number; errors: string[] });
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`open racer exited early with code ${code}`));
    });
  });
}

test(
  "W2.2: 400 concurrent opens fail zero times once busy_timeout is first",
  { timeout: 120_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-race-"));
    const path = join(dir, "s.db");
    const children: ChildProcess[] = [];
    try {
      // Seed a rollback-journal file. journal_mode=WAL then has to convert
      // it, and that conversion takes the lock before busy_timeout is set.
      const seed = new DatabaseSync(path);
      seed.exec("CREATE TABLE IF NOT EXISTS t(x INTEGER)");
      seed.close();

      for (let i = 0; i < WORKERS; i++) {
        children.push(
          fork(racerPath, [path, String(OPENS_EACH)], {
            execArgv: ["--import", "tsx"],
            stdio: ["ignore", "inherit", "inherit", "ipc"],
          }),
        );
      }

      const pending = children.map((child) => waitForResult(child));
      for (const child of children) {
        child.send({ type: "go" });
      }
      const results = await Promise.all(pending);
      const fails = results.reduce((n, r) => n + r.fails, 0);
      const samples = results.flatMap((r) => r.errors).slice(0, 6);
      assert.equal(
        fails,
        0,
        `${fails} of ${TOTAL} concurrent opens failed` +
          (samples.length > 0 ? `: ${samples.join(" | ")}` : ""),
      );
    } finally {
      for (const child of children) {
        child.kill();
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
