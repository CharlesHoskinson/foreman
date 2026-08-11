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

export type RebuildResult = {
  readonly rowsWritten: number;
  readonly nextIds: NextIds;
};

export type RebuildOptions = {
  readonly sidecarPath: string;
  readonly dbPath: string;
  /** Replace an existing database. Without this an existing file is refused. */
  readonly force?: boolean;
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

  const store = SqliteSessionStore.open(tmpPath);
  let rowsWritten: number;
  try {
    rowsWritten = store.importSnapshot(snapshot);
  } finally {
    store.close();
  }

  renameSync(tmpPath, opts.dbPath);
  return { rowsWritten, nextIds: snapshot.nextIds };
}
