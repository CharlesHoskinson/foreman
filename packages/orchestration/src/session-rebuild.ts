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
import { decodeSnapshot, SqliteSessionStore } from "@foreman/session-store";
import type { NextIds } from "@foreman/session-store";

function removeJournalSidecars(dbPath: string): void {
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

export type RebuildResult = {
  readonly rowsWritten: number;
  readonly nextIds: NextIds;
};

export type RebuildOptions = {
  readonly sidecarPath: string;
  readonly dbPath: string;
  /** Replace an existing database. Without this an existing file is refused. */
  readonly force?: boolean;
  /** Test hook. Called at the instant after dest rename. Production callers omit it. */
  readonly afterRename?: () => void;
};

export function rebuildFromSidecar(opts: RebuildOptions): RebuildResult {
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

  const store = SqliteSessionStore.open(tmpPath);
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
  const movedWal = existsSync(`${opts.dbPath}-wal`);
  if (movedWal) renameSync(`${opts.dbPath}-wal`, asideWal);
  const movedShm = existsSync(`${opts.dbPath}-shm`);
  if (movedShm) renameSync(`${opts.dbPath}-shm`, asideShm);
  try {
    renameSync(tmpPath, opts.dbPath);
  } catch (e) {
    try {
      if (movedWal) renameSync(asideWal, `${opts.dbPath}-wal`);
      if (movedShm) renameSync(asideShm, `${opts.dbPath}-shm`);
    } catch {
      // Restore failure must not replace the rename error.
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
