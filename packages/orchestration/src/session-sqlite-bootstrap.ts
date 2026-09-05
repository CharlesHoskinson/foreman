/**
 * CLI policy for recognizing and migrating a pre-port session database.
 *
 * Raw SQLite classification/dump/empty queries live in @foreman/session-store.
 * This module owns exact CLI strings, process.exit, and rebuild remedies.
 */

import fs from "node:fs";
import {
  classifySqliteStore,
  decodeSnapshot,
  dumpLegacySqliteAsV1,
  openSqliteSessionStore,
  rebuildSqliteFromSidecar,
  sqliteStoreIsEmpty,
} from "@foreman/session-store";
import { pathsAlias, sidecarPathFor } from "./session-paths.js";

/** Refused legacy dump. Callers map this to the exit-2 refusal class. */
export class LegacyMigrationRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyMigrationRefusal";
  }
}

export type BootstrapOpts = {
  readonly allowMigration: boolean;
  readonly readOnly: boolean;
  /** When true, `absent` with no sidecar is `no_session_source` rather than an empty store. */
  readonly requireSessionSource?: boolean;
};

export type RepairStoreOpts = {
  /** Test seam. Production callers omit it and use wall-clock UTC. */
  readonly now?: () => Date;
  /** Test seam. Called after backup allocation and before the first dest link. */
  readonly beforeMove?: (dest: string) => void;
  /** Test seam. Called after dest reservation and before the source-triplet re-check. */
  readonly beforeUnlink?: () => void;
  /** Test seam. Called after source unlink and before reservation cleanup. */
  readonly beforeCleanup?: (reservations: readonly string[]) => void;
};

export type RepairStoreResult =
  | { readonly status: "healthy" }
  | {
      readonly status: "repaired";
      readonly renamedPath: string;
      readonly rowsWritten: number;
    }
  | {
      readonly status: "failed";
      readonly renamedPath: string;
      readonly detail: string;
    };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Whether `fm-session recover` can rebuild from the tracked sidecar after
 * the store file is moved aside. A missing sidecar still lets recover
 * create an empty port store. An unreadable sidecar, or one that cannot
 * be parsed, makes
 * recover exit 2, so it must not be named as the immediate next step.
 */
function trackedSidecarCanRebuild(dbPath: string): boolean {
  const sidecar = sidecarPathFor(dbPath);
  try {
    if (!fs.existsSync(sidecar)) return true;
    decodeSnapshot(fs.readFileSync(sidecar, "utf8"));
    return true;
  } catch {
    return false;
  }
}

function sidecarRebuildRemedy(dbPath: string, asideSuffix: string): string {
  const move = `mv ${dbPath} ${dbPath}.${asideSuffix} && fm-session recover`;
  if (trackedSidecarCanRebuild(dbPath)) {
    return `Move it aside and rebuild from the tracked sidecar: ${move}`;
  }
  return `The tracked sidecar cannot be used to rebuild this store. Clear the sidecar fault, then: ${move}`;
}

/** UTC compact stamp `YYYYMMDDTHHMMSSZ` used in `.corrupt-<stamp>` backup names. */
export function compactUtcTimestamp(date: Date): string {
  const pad = (n: number, width: number): string => n.toString().padStart(width, "0");
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}` +
    `T${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}Z`
  );
}

const BACKUP_SIDECARS = ["-wal", "-shm"] as const;
const MAX_BACKUP_MOVE_ATTEMPTS = 100;

function fsErrorCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function pathOccupied(path: string): boolean {
  try {
    fs.lstatSync(path);
    return true;
  } catch (e) {
    if (fsErrorCode(e) === "ENOENT") return false;
    throw e;
  }
}

function backupTripletOccupied(
  dest: string,
  occupied: (path: string) => boolean = pathOccupied,
): boolean {
  if (occupied(dest)) return true;
  for (const suffix of BACKUP_SIDECARS) {
    if (occupied(dest + suffix)) return true;
  }
  return false;
}

/**
 * First free `.corrupt-<stamp>` path from `startSuffix` onward.
 * Suffix 0 is the unsuffixed base. Collision suffixes are `-1`, `-2`, ...
 * A candidate is free only when none of `<base>`, `<base>-wal`, and
 * `<base>-shm` exist by `lstat` (a dangling symlink counts as occupied).
 * The `occupied` seam is for tests; production uses `fs.lstatSync`.
 */
export function allocateCorruptBackupPath(
  dbPath: string,
  stamp: string,
  startSuffix = 0,
  occupied: (path: string) => boolean = pathOccupied,
): { path: string; suffix: number } {
  const base = `${dbPath}.corrupt-${stamp}`;
  let n = startSuffix;
  for (;;) {
    const candidate = n === 0 ? base : `${base}-${n}`;
    if (!backupTripletOccupied(candidate, occupied)) {
      return { path: candidate, suffix: n };
    }
    n += 1;
  }
}

function unlinkCreated(paths: readonly string[]): void {
  for (const p of paths) {
    try {
      fs.unlinkSync(p);
    } catch {
      // best-effort rollback of links and reservations this attempt created
    }
  }
}

const BACKUP_TRIPLET_SUFFIXES = ["", ...BACKUP_SIDECARS] as const;

/**
 * Move the database and any existing `-wal`/`-shm` files without replacing
 * an occupied destination. Reserve all three destination names for the whole
 * move: `link` when the source exists, `openSync(wx)` when it does not.
 * `wx` and `link` fail with `EEXIST` when the destination is taken.
 * After reservation, abort if the source triplet changed. Unlink only the
 * sources that were linked. Reservation cleanup uses checked `unlinkSync`.
 */
function renameStoreAside(dbPath: string, dest: string, opts: RepairStoreOpts = {}): void {
  const created: string[] = [];
  const reservations: string[] = [];
  const linkedSources: string[] = [];
  try {
    for (const suffix of BACKUP_TRIPLET_SUFFIXES) {
      const src = dbPath + suffix;
      const dst = dest + suffix;
      if (pathOccupied(src)) {
        fs.linkSync(src, dst);
        created.push(dst);
        linkedSources.push(src);
      } else {
        const fd = fs.openSync(dst, "wx");
        created.push(dst);
        reservations.push(dst);
        fs.closeSync(fd);
      }
    }
  } catch (e) {
    unlinkCreated(created);
    throw e;
  }
  opts.beforeUnlink?.();
  for (const suffix of BACKUP_TRIPLET_SUFFIXES) {
    const src = dbPath + suffix;
    if (pathOccupied(src) !== linkedSources.includes(src)) {
      unlinkCreated(created);
      throw new Error("source store changed during move");
    }
  }
  for (const src of linkedSources) {
    fs.unlinkSync(src);
  }
  opts.beforeCleanup?.(reservations);
  for (const reservation of reservations) {
    try {
      fs.unlinkSync(reservation);
    } catch (e) {
      throw new Error(
        `backup cleanup failed at ${reservation}: ${fsErrorCode(e) ?? "unknown"}`,
      );
    }
  }
}

/**
 * Move a half-migrated store aside and rebuild from the tracked sidecar.
 *
 * Healthy (`port` or any non-`corrupt` shape) is a no-op. After a rename,
 * a rebuild failure leaves the renamed file in place. If a destination
 * appears between allocation and move, allocation retries with the next
 * suffix, at most 100 times, then fails with the store left untouched.
 */
export function repairStore(dbPath: string, opts: RepairStoreOpts = {}): RepairStoreResult {
  const shape = classifySqliteStore(dbPath);
  if (shape !== "corrupt") {
    return { status: "healthy" };
  }
  const stamp = compactUtcTimestamp((opts.now ?? (() => new Date()))());
  let renamedPath: string | undefined;
  let lastSuffix = -1;
  for (let attempt = 0; attempt < MAX_BACKUP_MOVE_ATTEMPTS; attempt++) {
    const allocated = allocateCorruptBackupPath(dbPath, stamp, lastSuffix + 1);
    lastSuffix = allocated.suffix;
    const dest = allocated.path;
    try {
      opts.beforeMove?.(dest);
      renameStoreAside(dbPath, dest, opts);
      renamedPath = dest;
      break;
    } catch (e) {
      const detail = errorMessage(e);
      if (detail === "source store changed during move") {
        return { status: "failed", renamedPath: dbPath, detail };
      }
      if (detail.startsWith("backup cleanup failed at ")) {
        return { status: "failed", renamedPath: dest, detail };
      }
      if (fsErrorCode(e) !== "EEXIST") throw e;
    }
  }
  if (renamedPath === undefined) {
    return {
      status: "failed",
      renamedPath: dbPath,
      detail: "could not allocate a free backup path without replacing an existing file",
    };
  }
  const sidecar = sidecarPathFor(dbPath);
  try {
    const res = rebuildSqliteFromSidecar({
      sidecarPath: sidecar,
      dbPath,
      force: true,
    });
    return { status: "repaired", renamedPath, rowsWritten: res.rowsWritten };
  } catch (e) {
    return { status: "failed", renamedPath, detail: errorMessage(e) };
  }
}

function rehydrateFromSidecarIfEmpty(p: string): void {
  const sidecar = sidecarPathFor(p);
  if (pathsAlias(sidecar, p) || !fs.existsSync(sidecar)) return;
  try {
    if (!sqliteStoreIsEmpty(p)) return;
  } catch {
    return;
  }
  try {
    const res = rebuildSqliteFromSidecar({ sidecarPath: sidecar, dbPath: p, force: true });
    process.stderr.write(
      `rehydrated ${res.rowsWritten} row(s) from ${sidecar} (the .db is a derived cache; the sidecar is what git tracks)\n`,
    );
  } catch (e) {
    // The sidecar is the tracked record of truth. If it cannot be read, coming
    // up empty is worse than failing: the next write would produce a "correct"
    // store with none of the history in it.
    process.stderr.write(
      `refusing: the session store is empty and the tracked sidecar at ${sidecar} could not be read: ${errorMessage(e)}\n`,
    );
    throw new LegacyMigrationRefusal(errorMessage(e));
  }
}

/**
 * Guarantee the file at `p` is port-shaped BEFORE anything opens it.
 *
 * The port creates its tables with CREATE TABLE IF NOT EXISTS, so opening it
 * straight onto a legacy file returns cleanly while leaving the old schema in
 * place and seeding every id watermark to 1 against live ids in the thirties.
 * The next write then collides on the primary key. The only safe migration is
 * a rebuild into a FRESH file, which is what rebuildSqliteFromSidecar does.
 *
 * A legacy file is migrated from ITS OWN contents rather than from the tracked
 * sidecar. It is the artefact being replaced, so nothing it holds may be lost
 * to a sidecar that is stale, or missing entirely.
 *
 * Returns true only when this call migrated a legacy-shaped file. Callers that
 * have already rewritten the store must persist a tracked sidecar even if the
 * command later refuses.
 */
export function bootstrapStore(p: string, opts: BootstrapOpts): boolean {
  const shape = classifySqliteStore(p);
  if (shape === "corrupt") {
    process.stderr.write(
      `refusing: the session store at ${p} is corrupt: it carries both the legacy and port schemas, or identity counters behind its own rows. ` +
        `It is the half-migrated state a pre-fix open produced. ` +
        `run: node skills/foreman/runtime/dist/fm-session.js repair. ` +
        `${sidecarRebuildRemedy(p, "corrupt")}\n`,
    );
    process.exit(2);
  }
  if (shape === "unrecognised") {
    process.stderr.write(
      `refusing: the session store at ${p} exists but is not a Foreman session database. ` +
        `This tool will not write into a file it does not recognise. ` +
        `${sidecarRebuildRemedy(p, "unrecognised")}\n`,
    );
    throw new LegacyMigrationRefusal(`unrecognised session store at ${p}`);
  }
  if (shape === "legacy") {
    if (!opts.allowMigration) {
      process.stderr.write(
        `refusing: the session store at ${p} is in the pre-port schema and this is a read-only command. ` +
          `Run a write command, or \`fm-session import-sidecar\`, to migrate it.\n`,
      );
      process.exit(2);
    }
    const carrier = `${p}.legacy.ndjson`;
    try {
      const dumped = dumpLegacySqliteAsV1(p);
      if (!dumped.ok) {
        throw new LegacyMigrationRefusal(
          `legacy store is missing declared table ${dumped.table}; ` +
            `refusing a lossy dump that would recreate it empty. ` +
            `Move it aside and rebuild from the tracked sidecar: ` +
            `mv ${p} ${p}.unmigratable && fm-session recover`,
        );
      }
      fs.writeFileSync(carrier, dumped.text, { encoding: "utf8" });
      const res = rebuildSqliteFromSidecar({ sidecarPath: carrier, dbPath: p, force: true });
      process.stderr.write(`migrated ${res.rowsWritten} row(s) out of the legacy session schema into ${p}\n`);
    } catch (e) {
      process.stderr.write(
        `refusing: the legacy session store at ${p} could not be migrated to the port schema: ${errorMessage(e)}\n`,
      );
      throw new LegacyMigrationRefusal(errorMessage(e));
    } finally {
      fs.rmSync(carrier, { force: true });
    }
    rehydrateFromSidecarIfEmpty(p);
    return true;
  }
  if (shape === "absent") {
    // Nothing exists yet to mutate: creating the schema and, below,
    // rehydrating from the tracked sidecar is CREATING a missing derived
    // cache, not writing to a store that already exists. Legitimate
    // regardless of whether the command itself is read-only -- the goldens
    // depend on exactly this path.
    //
    // recover is the exception: with neither store nor sidecar there is
    // nothing to recover, so refuse rather than mint an empty cache.
    if (opts.requireSessionSource === true) {
      const sidecar = sidecarPathFor(p);
      if (!fs.existsSync(sidecar)) {
        process.stderr.write(
          `refusing: no_session_source (neither ${p} nor ${sidecar} exists)\n`,
        );
        throw new LegacyMigrationRefusal("no_session_source");
      }
    }
    //
    // "absent" now means the path has no file. If a file appeared between
    // classify and here, refuse rather than write into it.
    if (fs.existsSync(p)) {
      process.stderr.write(
        `refusing: the session store at ${p} exists but is not a Foreman session database. ` +
          `This tool will not write into a file it does not recognise. ` +
          `${sidecarRebuildRemedy(p, "unrecognised")}\n`,
      );
      throw new LegacyMigrationRefusal(`unrecognised session store at ${p}`);
    }
    openSqliteSessionStore({ path: p }).close();
    try {
      rehydrateFromSidecarIfEmpty(p);
    } catch (e) {
      // Delete only the empty file this invocation just created. A cleanup
      // throw must not replace the refusal it was cleaning up after.
      try {
        for (const suffix of ["", "-wal", "-shm"] as const) {
          fs.rmSync(p + suffix, { force: true });
        }
      } catch {
        // keep `e`
      }
      throw e;
    }
    return false;
  }
  // shape === "port": the file already exists and is already the derived
  // cache. A read-only command must not write to a store that already
  // exists, so it may not rehydrate one here even if the store happens to be
  // empty right now -- that would still be a write to something present on
  // disk, not the creation of something missing.
  if (!opts.readOnly) {
    rehydrateFromSidecarIfEmpty(p);
  }
  return false;
}
