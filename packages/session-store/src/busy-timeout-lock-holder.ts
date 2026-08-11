/**
 * Child-process helper for busy-timeout.test.ts.
 *
 * node:sqlite's DatabaseSync is synchronous, so a transaction held open by
 * one DatabaseSync handle can never be interleaved with a write attempt from
 * a second handle in the *same* process: opening two stores and writing
 * through each sequentially never contends for the write lock, because the
 * first write's implicit (or explicit) transaction always finishes before
 * the second one starts. There is nothing to be busy about. Genuinely
 * exercising SQLITE_BUSY / busy_timeout requires a second OS process holding
 * the lock while this one tries to write, so that a write is genuinely in
 * flight against the write lock at the same wall-clock moment.
 *
 * Protocol, driven by the parent over the IPC channel `fork()` provides:
 *   argv[2] — path to the SQLite file to lock.
 *   argv[3] — how long to hold the write lock, in milliseconds.
 * Sequence: open the db, acquire the write lock with BEGIN IMMEDIATE (this
 * takes the lock the instant the statement runs, not lazily on first write),
 * send { type: "locked" } once it is held, hold it for the given duration,
 * then COMMIT and exit. Never runs as a test itself — it has no `.test.ts`
 * suffix so the test glob in scripts/run-tests.ts does not pick it up.
 */
import { DatabaseSync } from "node:sqlite";

const path = process.argv[2];
const holdMs = Number(process.argv[3]);

if (!path || !Number.isFinite(holdMs)) {
  throw new Error("usage: busy-timeout-lock-holder.ts <db-path> <hold-ms>");
}
if (typeof process.send !== "function") {
  throw new Error("busy-timeout-lock-holder.ts must be run via child_process.fork (no IPC channel)");
}
const send = process.send.bind(process);

const db = new DatabaseSync(path);
db.exec("BEGIN IMMEDIATE");
send({ type: "locked" });

setTimeout(() => {
  db.exec("COMMIT");
  db.close();
  process.exit(0);
}, holdMs);
