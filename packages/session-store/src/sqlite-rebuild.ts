/**
 * Rebuild the session database from the canonical sidecar.
 *
 * The sidecar is the record that travels: .gitignore ignores session.db while
 * .foreman/session.ndjson is tracked. The database is a cache, so a migration
 * is a rebuild into a fresh file rather than an alter of the old schema.
 *
 * Rebuilding into a FRESH path is load-bearing. sqlite-store.ts creates its
 * tables with CREATE TABLE IF NOT EXISTS, so opening the port against the old
 * database would skip schema creation, find no store_meta, and seed every id
 * watermark to 1 while live ids run far higher.
 */

import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import type { NextIds } from "./entities.js";
import { openSqliteSessionStore } from "./open.js";
import { decodeSnapshot } from "./sidecar.js";

function removeJournalSidecars(dbPath: string): void {
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

export type SqliteRebuildResult = {
  readonly rowsWritten: number;
  readonly nextIds: NextIds;
};

export type SqliteRebuildOptions = {
  readonly sidecarPath: string;
  readonly dbPath: string;
  /** Replace an existing database. Without this an existing file is refused. */
  readonly force?: boolean;
  /** Test hook. Called at the instant after dest rename. Production callers omit it. */
  readonly afterRename?: () => void;
  /**
   * Test hook. Called after a successful dest-WAL aside move and before the
   * dest-SHM aside move. Production callers omit it.
   */
  readonly afterWalAside?: () => void;
};

export function rebuildSqliteFromSidecar(opts: SqliteRebuildOptions): SqliteRebuildResult {
  if (existsSync(opts.dbPath) && opts.force !== true) {
    throw new Error(
      `${opts.dbPath} already exists; pass force to replace it. ` +
        `Rebuilding onto an existing file would skip schema creation.`,
    );
  }

  const snapshot = decodeSnapshot(readFileSync(opts.sidecarPath, "utf8"));

  const tmpPath = `${opts.dbPath}.rebuild`;
  rmSync(tmpPath, { force: true });
  removeJournalSidecars(tmpPath);

  const store = openSqliteSessionStore({ path: tmpPath });
  let rowsWritten: number;
  try {
    rowsWritten = store.importSnapshot(snapshot);
  } finally {
    store.close();
  }

  // close() of the last connection checkpoints the temp file.
  //
  // Move dest journals aside before rename. SQLite does not check that a
  // WAL belongs to the file beside it, so leftover frames replay by page
  // number onto a differently-shaped store. That is silent corruption.
  // Deleting dest journals before rename would close the window and would
  // reopen FIX 6: a failed rename would drop the only uncheckpointed copy.
  // A failed rename restores the aside journals byte-for-byte.
  removeJournalSidecars(tmpPath);
  const asideWal = `${opts.dbPath}-wal.rebuild-aside`;
  const asideShm = `${opts.dbPath}-shm.rebuild-aside`;
  rmSync(asideWal, { force: true });
  rmSync(asideShm, { force: true });
  // One recovery boundary covers every journal aside and the dest rename.
  // Track each successful move separately so a failure on the second journal
  // restores the first instead of stranding it at .rebuild-aside.
  let movedWal = false;
  let movedShm = false;
  try {
    if (existsSync(`${opts.dbPath}-wal`)) {
      renameSync(`${opts.dbPath}-wal`, asideWal);
      movedWal = true;
    }
    opts.afterWalAside?.();
    if (existsSync(`${opts.dbPath}-shm`)) {
      renameSync(`${opts.dbPath}-shm`, asideShm);
      movedShm = true;
    }
    renameSync(tmpPath, opts.dbPath);
  } catch (e) {
    try {
      if (movedWal) renameSync(asideWal, `${opts.dbPath}-wal`);
      if (movedShm) renameSync(asideShm, `${opts.dbPath}-shm`);
    } catch {
      // Restore failure must not replace the initiating error.
    }
    throw e;
  }
  try {
    opts.afterRename?.();
  } finally {
    rmSync(asideWal, { force: true });
    rmSync(asideShm, { force: true });
    removeJournalSidecars(tmpPath);
  }
  return { rowsWritten, nextIds: snapshot.nextIds };
}
