import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SqliteSessionStore,
  classifySqliteStore,
  decodeSnapshot,
  encodeSnapshot,
} from "@foreman/session-store";
import { sidecarPathFor } from "./session-paths.js";
import {
  LegacyMigrationRefusal,
  allocateCorruptBackupPath,
  bootstrapStore,
  compactUtcTimestamp,
  repairStore,
} from "./session-sqlite-bootstrap.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "fm-session-main.ts");
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function writeHalfMigratedStore(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT)");
    db.exec("INSERT INTO schema_meta VALUES('version','3')");
    db.exec("CREATE TABLE facts(id INTEGER PRIMARY KEY, statement TEXT)");
    db.exec("INSERT INTO facts VALUES(36,'live fact')");
    db.exec("CREATE TABLE store_meta(key TEXT PRIMARY KEY, value TEXT)");
    db.exec("INSERT INTO store_meta VALUES('next_id.fact','1')");
  } finally {
    db.close();
  }
}

function writeFactSidecar(sidecarPath: string, statement: string): void {
  const tmp = join(dirname(sidecarPath), `encode-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const store = SqliteSessionStore.open(tmp);
  try {
    store.addFact({
      statement,
      evidence: null,
      established_ts: "2026-08-01T00:00:00Z",
      session_id: null,
    });
    writeFileSync(sidecarPath, encodeSnapshot(store.snapshot()));
  } finally {
    store.close();
    for (const suffix of ["", "-wal", "-shm"] as const) {
      rmSync(tmp + suffix, { force: true });
    }
  }
}

function factStatements(dbPath: string): string[] {
  const store = SqliteSessionStore.open(dbPath, { readOnly: true });
  try {
    return store.listFacts().map((f) => f.statement);
  } finally {
    store.close();
  }
}

function spawnSession(dir: string, dbPath: string, args: readonly string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["FOREMAN_SESSION_BACKEND"];
  delete env["FOREMAN_SESSION_DIR"];
  return spawnSync(process.execPath, ["--import", TSX_LOADER, ENTRY, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...env, FOREMAN_SESSION_DB: dbPath },
  });
}

function directoryModesAreEnforced(): boolean {
  return (
    process.platform !== "win32" &&
    !(typeof process.getuid === "function" && process.getuid() === 0)
  );
}

function listingOf(dir: string): readonly { name: string; size: number }[] {
  return readdirSync(dir)
    .map((name) => ({ name, size: lstatSync(join(dir, name)).size }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Canonical sidecar plus two trailing spaces on the header line. Still valid. */
function sidecarWithTrailingSpacesOnHeader(canonical: string): Buffer {
  const lines = canonical.split("\n");
  lines[0] = `${lines[0]}  `;
  return Buffer.from(lines.join("\n"));
}

function captureStderr(body: () => void): string {
  let text = "";
  const orig = process.stderr.write;
  process.stderr.write = ((
    chunk: string | Uint8Array,
    ...rest: unknown[]
  ) => {
    text += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return Reflect.apply(orig, process.stderr, [chunk, ...rest]);
  }) as typeof process.stderr.write;
  try {
    body();
    return text;
  } finally {
    process.stderr.write = orig;
  }
}

test("compactUtcTimestamp is YYYYMMDDTHHMMSSZ", () => {
  assert.equal(
    compactUtcTimestamp(new Date("2026-09-05T14:30:22.999Z")),
    "20260905T143022Z",
  );
});

test("allocateCorruptBackupPath appends -1, -2 until free and overwrites nothing", () => {
  const taken = new Set([
    "/tmp/session.db.corrupt-20260905T000000Z",
    "/tmp/session.db.corrupt-20260905T000000Z-1",
  ]);
  assert.deepEqual(
    allocateCorruptBackupPath("/tmp/session.db", "20260905T000000Z", 0, (p) => taken.has(p)),
    { path: "/tmp/session.db.corrupt-20260905T000000Z-2", suffix: 2 },
  );
  assert.deepEqual(
    allocateCorruptBackupPath("/tmp/session.db", "20260905T000000Z", 0, () => false),
    { path: "/tmp/session.db.corrupt-20260905T000000Z", suffix: 0 },
  );
});

test("allocateCorruptBackupPath treats -wal or -shm occupancy as a collision", () => {
  const walTaken = new Set(["/tmp/session.db.corrupt-20260905T000000Z-wal"]);
  assert.deepEqual(
    allocateCorruptBackupPath("/tmp/session.db", "20260905T000000Z", 0, (p) => walTaken.has(p)),
    { path: "/tmp/session.db.corrupt-20260905T000000Z-1", suffix: 1 },
  );
  const shmTaken = new Set(["/tmp/session.db.corrupt-20260905T000000Z-shm"]);
  assert.deepEqual(
    allocateCorruptBackupPath("/tmp/session.db", "20260905T000000Z", 0, (p) => shmTaken.has(p)),
    { path: "/tmp/session.db.corrupt-20260905T000000Z-1", suffix: 1 },
  );
  const suffixWalTaken = new Set(["/tmp/session.db.corrupt-20260905T000000Z-1-wal"]);
  assert.deepEqual(
    allocateCorruptBackupPath("/tmp/session.db", "20260905T000000Z", 0, (p) => suffixWalTaken.has(p)),
    { path: "/tmp/session.db.corrupt-20260905T000000Z", suffix: 0 },
  );
});

test("allocateCorruptBackupPath startSuffix skips lower suffixes even when they are free", () => {
  assert.deepEqual(
    allocateCorruptBackupPath("/tmp/session.db", "20260905T000000Z", 2, () => false),
    { path: "/tmp/session.db.corrupt-20260905T000000Z-2", suffix: 2 },
  );
});

test("fresh clone: recover rebuilds from the sidecar when the store is absent", () => {
  const dir = makeTempDir("ss-fresh-clone-");
  const p = join(dir, "session.db");
  writeFactSidecar(sidecarPathFor(p), "canonical fact");
  const res = spawnSession(dir, p, ["recover"]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(classifySqliteStore(p), "port");
  assert.ok(factStatements(p).includes("canonical fact"));
});

test("repair moves a half-migrated store aside and recover then succeeds", () => {
  const dir = makeTempDir("ss-repair-hybrid-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  writeFactSidecar(sidecarPathFor(p), "sidecar fact");
  assert.equal(classifySqliteStore(p), "corrupt");

  const frozen = new Date("2026-09-05T12:00:00Z");
  const result = repairStore(p, { now: () => frozen });
  assert.equal(result.status, "repaired");
  if (result.status !== "repaired") return;
  assert.equal(result.renamedPath, `${p}.corrupt-20260905T120000Z`);
  assert.equal(existsSync(result.renamedPath), true, "renamed file must not be deleted");
  assert.equal(classifySqliteStore(p), "port");
  assert.ok(factStatements(p).includes("sidecar fact"));

  const recovered = spawnSession(dir, p, ["recover"]);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(recovered.stdout, /sidecar fact/);
});

test("repair on a healthy store with a sidecar changes no directory entry and leaves sidecar bytes unchanged", () => {
  const dir = makeTempDir("ss-repair-healthy-sidecar-");
  const p = join(dir, "session.db");
  const store = SqliteSessionStore.open(p);
  store.addFact({
    statement: "keep me",
    evidence: null,
    established_ts: "2026-08-01T00:00:00Z",
    session_id: null,
  });
  const canonicalSidecar = encodeSnapshot(store.snapshot());
  store.close();
  const sidecar = sidecarPathFor(p);
  const sidecarBytes = sidecarWithTrailingSpacesOnHeader(canonicalSidecar);
  decodeSnapshot(sidecarBytes.toString("utf8"));
  writeFileSync(sidecar, sidecarBytes);
  classifySqliteStore(p);
  const listingBefore = listingOf(dir);
  const dbBefore = readFileSync(p);
  const res = spawnSession(dir, p, ["repair"]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "repair: store is healthy, nothing to do\n");
  assert.ok(
    Buffer.compare(sidecarBytes, readFileSync(sidecar)) === 0,
    "existing sidecar bytes must be unchanged; this assertion fails if repair is removed from NO_SIDECAR_REFRESH_CMDS",
  );
  assert.ok(Buffer.compare(dbBefore, readFileSync(p)) === 0);
  assert.deepEqual(listingOf(dir), listingBefore);
  assert.equal(classifySqliteStore(p), "port");
  assert.ok(factStatements(p).includes("keep me"));
});

test("repair on a healthy store without a sidecar creates none and changes no directory entry", () => {
  const dir = makeTempDir("ss-repair-healthy-nosidecar-");
  const p = join(dir, "session.db");
  const store = SqliteSessionStore.open(p);
  store.addFact({
    statement: "keep me",
    evidence: null,
    established_ts: "2026-08-01T00:00:00Z",
    session_id: null,
  });
  store.close();
  const sidecar = sidecarPathFor(p);
  rmSync(sidecar, { force: true });
  assert.equal(existsSync(sidecar), false);
  classifySqliteStore(p);
  const listingBefore = listingOf(dir);
  const dbBefore = readFileSync(p);
  const res = spawnSession(dir, p, ["repair"]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "repair: store is healthy, nothing to do\n");
  assert.deepEqual(listingOf(dir), listingBefore);
  assert.ok(Buffer.compare(dbBefore, readFileSync(p)) === 0);
  assert.equal(
    existsSync(sidecar),
    false,
    "repair must not create a sidecar; this assertion fails if repair is removed from NO_SIDECAR_REFRESH_CMDS",
  );
  assert.equal(classifySqliteStore(p), "port");
  assert.ok(factStatements(p).includes("keep me"));
});

test("repair backup name collision appends a numeric suffix and overwrites nothing", () => {
  const dir = makeTempDir("ss-repair-collide-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  writeFactSidecar(sidecarPathFor(p), "after repair");
  const frozen = new Date("2026-09-05T12:00:00Z");
  const intended = `${p}.corrupt-20260905T120000Z`;
  const occupant = "do-not-overwrite";
  writeFileSync(intended, occupant);

  const result = repairStore(p, { now: () => frozen });
  assert.equal(result.status, "repaired");
  if (result.status !== "repaired") return;
  assert.equal(result.renamedPath, `${intended}-1`);
  assert.equal(existsSync(result.renamedPath), true);
  assert.equal(readFileSync(intended, "utf8"), occupant);
  assert.equal(classifySqliteStore(p), "port");
});

test("repair allocates the next suffix when a dangling symlink occupies the intended backup name", () => {
  const dir = makeTempDir("ss-repair-dangle-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  writeFactSidecar(sidecarPathFor(p), "after repair");
  const frozen = new Date("2026-09-05T12:00:00Z");
  const intended = `${p}.corrupt-20260905T120000Z`;
  const missingTarget = join(dir, "missing-target");
  symlinkSync(missingTarget, intended);
  assert.equal(lstatSync(intended).isSymbolicLink(), true);
  assert.equal(existsSync(intended), false, "control: existsSync must not see a dangling symlink");

  const result = repairStore(p, { now: () => frozen });
  assert.equal(result.status, "repaired", result.status === "failed" ? result.detail : "");
  if (result.status !== "repaired") return;
  assert.equal(result.renamedPath, `${intended}-1`);
  assert.equal(lstatSync(intended).isSymbolicLink(), true);
  assert.equal(readlinkSync(intended), missingTarget);
  assert.equal(existsSync(result.renamedPath), true);
  assert.equal(classifySqliteStore(p), "port");
});

test("repair allocates the next suffix when the intended backup -wal exists and the base is free", () => {
  const dir = makeTempDir("ss-repair-wal-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  writeFactSidecar(sidecarPathFor(p), "after repair");
  const frozen = new Date("2026-09-05T12:00:00Z");
  const intended = `${p}.corrupt-20260905T120000Z`;
  const occupant = Buffer.from("pre-existing-wal-bytes");
  writeFileSync(`${intended}-wal`, occupant);

  const result = repairStore(p, { now: () => frozen });
  assert.equal(result.status, "repaired", result.status === "failed" ? result.detail : "");
  if (result.status !== "repaired") return;
  assert.equal(result.renamedPath, `${intended}-1`);
  assert.equal(existsSync(intended), false);
  assert.ok(Buffer.compare(occupant, readFileSync(`${intended}-wal`)) === 0);
  assert.equal(existsSync(result.renamedPath), true);
  assert.equal(classifySqliteStore(p), "port");
});

test("repair allocates the next suffix when the intended backup -shm exists", () => {
  const dir = makeTempDir("ss-repair-shm-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  writeFactSidecar(sidecarPathFor(p), "after repair");
  const frozen = new Date("2026-09-05T12:00:00Z");
  const intended = `${p}.corrupt-20260905T120000Z`;
  const occupant = Buffer.from("pre-existing-shm-bytes");
  writeFileSync(`${intended}-shm`, occupant);

  const result = repairStore(p, { now: () => frozen });
  assert.equal(result.status, "repaired", result.status === "failed" ? result.detail : "");
  if (result.status !== "repaired") return;
  assert.equal(result.renamedPath, `${intended}-1`);
  assert.equal(existsSync(intended), false);
  assert.ok(Buffer.compare(occupant, readFileSync(`${intended}-shm`)) === 0);
  assert.equal(existsSync(result.renamedPath), true);
  assert.equal(classifySqliteStore(p), "port");
});

test("repair reserves dest-wal and dest-shm and retries when dest-wal appears after allocation", () => {
  const dir = makeTempDir("ss-repair-reserve-wal-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  rmSync(`${p}-wal`, { force: true });
  rmSync(`${p}-shm`, { force: true });
  writeFactSidecar(sidecarPathFor(p), "after repair");
  const frozen = new Date("2026-09-05T12:00:00Z");
  const intended = `${p}.corrupt-20260905T120000Z`;
  const occupant = Buffer.from("injected-dest-wal-bytes");

  const result = repairStore(p, {
    now: () => frozen,
    beforeMove: (dest) => {
      if (dest === intended) {
        writeFileSync(`${dest}-wal`, occupant);
      }
    },
  });
  assert.equal(result.status, "repaired", result.status === "failed" ? result.detail : "");
  if (result.status !== "repaired") return;
  assert.equal(result.renamedPath, `${intended}-1`);
  assert.ok(Buffer.compare(occupant, readFileSync(`${intended}-wal`)) === 0);
  assert.equal(existsSync(`${result.renamedPath}-wal`), false);
  assert.equal(existsSync(`${result.renamedPath}-shm`), false);
  assert.equal(classifySqliteStore(p), "port");
});

test("repair retries advance the suffix after dest then dest-shm collisions", () => {
  const dir = makeTempDir("ss-repair-retry-suffix-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  writeFactSidecar(sidecarPathFor(p), "after repair");
  const frozen = new Date("2026-09-05T12:00:00Z");
  const intended = `${p}.corrupt-20260905T120000Z`;
  let attempts = 0;

  const result = repairStore(p, {
    now: () => frozen,
    beforeMove: (dest) => {
      attempts += 1;
      if (attempts === 1) {
        writeFileSync(dest, "occupy-dest");
      } else if (attempts === 2) {
        writeFileSync(`${dest}-shm`, "occupy-shm");
      }
    },
  });
  assert.equal(result.status, "repaired", result.status === "failed" ? result.detail : "");
  if (result.status !== "repaired") return;
  assert.equal(result.renamedPath, `${intended}-2`);
  assert.ok(result.renamedPath.endsWith("-2"));
  assert.equal(attempts, 3);
  assert.equal(classifySqliteStore(p), "port");
});

test("repair fails when a linked source WAL is replaced before unlink and leaves the replacement intact", () => {
  const dir = makeTempDir("ss-repair-replace-wal-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  writeFactSidecar(sidecarPathFor(p), "after repair");
  const holder = new DatabaseSync(p);
  let sqliteWal: Buffer;
  try {
    holder.exec("PRAGMA busy_timeout=5000");
    holder.exec("PRAGMA journal_mode=WAL");
    holder.exec("INSERT INTO facts VALUES(37,'wal-live')");
    assert.equal(existsSync(`${p}-wal`), true, "precondition: store must have a real WAL");
    sqliteWal = readFileSync(`${p}-wal`);
  } finally {
    holder.close();
  }
  if (!existsSync(`${p}-wal`)) {
    writeFileSync(`${p}-wal`, sqliteWal);
  }
  assert.equal(existsSync(`${p}-wal`), true, "precondition: WAL must exist at link time");
  const originalDb = readFileSync(p);
  const replacement = Buffer.from("replacement-wal-bytes");
  const frozen = new Date("2026-09-05T12:00:00Z");
  const intended = `${p}.corrupt-20260905T120000Z`;

  const result = repairStore(p, {
    now: () => frozen,
    beforeUnlink: () => {
      unlinkSync(`${p}-wal`);
      writeFileSync(`${p}-wal`, replacement);
    },
  });
  assert.equal(result.status, "failed", result.status === "failed" ? result.detail : "");
  if (result.status !== "failed") return;
  assert.equal(result.renamedPath, p);
  assert.equal(result.detail, "source store changed during move");
  assert.ok(Buffer.compare(originalDb, readFileSync(p)) === 0);
  assert.ok(Buffer.compare(replacement, readFileSync(`${p}-wal`)) === 0);
  assert.equal(existsSync(intended), false);
  assert.equal(existsSync(`${intended}-wal`), false);
  assert.equal(existsSync(`${intended}-shm`), false);
  assert.deepEqual(
    readdirSync(dir).filter((name) => name.includes(".corrupt-")),
    [],
  );
});

test("repair fails when a source WAL appears after reservation and leaves the store untouched", () => {
  const dir = makeTempDir("ss-repair-src-wal-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  rmSync(`${p}-wal`, { force: true });
  rmSync(`${p}-shm`, { force: true });
  writeFactSidecar(sidecarPathFor(p), "after repair");
  const original = readFileSync(p);
  const walBytes = Buffer.from("injected-source-wal-bytes");
  const frozen = new Date("2026-09-05T12:00:00Z");
  const intended = `${p}.corrupt-20260905T120000Z`;

  const result = repairStore(p, {
    now: () => frozen,
    beforeUnlink: () => {
      writeFileSync(`${p}-wal`, walBytes);
    },
  });
  assert.equal(result.status, "failed", result.status === "failed" ? result.detail : "");
  if (result.status !== "failed") return;
  assert.equal(result.renamedPath, p);
  assert.equal(result.detail, "source store changed during move");
  assert.ok(Buffer.compare(original, readFileSync(p)) === 0);
  assert.ok(Buffer.compare(walBytes, readFileSync(`${p}-wal`)) === 0);
  assert.equal(existsSync(intended), false);
  assert.equal(existsSync(`${intended}-wal`), false);
  assert.equal(existsSync(`${intended}-shm`), false);
  assert.deepEqual(
    readdirSync(dir).filter((name) => name.includes(".corrupt-")),
    [],
  );
});

test("repair fails and keeps the backup when reservation cleanup cannot unlink", (t) => {
  if (!directoryModesAreEnforced()) {
    t.skip("chmod 0o500 does not produce EACCES for root or on win32");
    return;
  }
  const dir = makeTempDir("ss-repair-cleanup-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  rmSync(`${p}-wal`, { force: true });
  rmSync(`${p}-shm`, { force: true });
  writeFactSidecar(sidecarPathFor(p), "after repair");
  const frozen = new Date("2026-09-05T12:00:00Z");
  const intended = `${p}.corrupt-20260905T120000Z`;
  try {
    const result = repairStore(p, {
      now: () => frozen,
      beforeCleanup: () => {
        chmodSync(dir, 0o500);
      },
    });
    assert.equal(result.status, "failed", result.status === "failed" ? result.detail : "");
    if (result.status !== "failed") return;
    assert.equal(result.renamedPath, intended);
    assert.ok(result.detail.startsWith("backup cleanup failed at"));
    assert.equal(existsSync(intended), true);
    assert.equal(existsSync(p), false);
  } finally {
    chmodSync(dir, 0o700);
  }
});

test("repair_failed leaves the renamed file in place when the sidecar cannot be parsed", () => {
  const dir = makeTempDir("ss-repair-failed-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  const original = readFileSync(p);
  writeFileSync(sidecarPathFor(p), "this is not a sidecar\njunk\n");
  const frozen = new Date("2026-09-05T12:00:00Z");
  const result = repairStore(p, { now: () => frozen });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.renamedPath, `${p}.corrupt-20260905T120000Z`);
  assert.equal(existsSync(result.renamedPath), true);
  assert.ok(Buffer.compare(original, readFileSync(result.renamedPath)) === 0);
  assert.equal(existsSync(p), false);
});

test("CLI repair_failed names the renamed file and keeps it", () => {
  const dir = makeTempDir("ss-repair-failed-cli-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  writeFileSync(sidecarPathFor(p), "this is not a sidecar\njunk\n");
  const failed = spawnSession(dir, p, ["repair"]);
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /repair_failed/);
  assert.match(failed.stderr, /\.corrupt-/);
  assert.equal(existsSync(p), false);
  const match = failed.stderr.match(/repair_failed (\S+):/);
  assert.ok(match, `repair_failed must name the renamed file; stderr=${failed.stderr}`);
  const renamed = match[1]!;
  assert.equal(existsSync(renamed), true, `renamed file missing: ${renamed}`);
});

test("recover refusal on a half-migrated store names the repair command", () => {
  const dir = makeTempDir("ss-refuse-repair-");
  const p = join(dir, "session.db");
  writeHalfMigratedStore(p);
  const res = spawnSession(dir, p, ["recover"]);
  assert.equal(res.status, 2, res.stderr);
  assert.match(
    res.stderr,
    /run: node skills\/foreman\/runtime\/dist\/fm-session\.js repair/,
  );
  assert.match(res.stderr, /corrupt/i);
  assert.equal(classifySqliteStore(p), "corrupt");
});

test("recover exits 2 with no_session_source when neither file exists", () => {
  const dir = makeTempDir("ss-no-source-");
  const p = join(dir, "session.db");
  const stderr = captureStderr(() => {
    assert.throws(
      () =>
        bootstrapStore(p, {
          allowMigration: false,
          readOnly: true,
          requireSessionSource: true,
        }),
      (e: unknown) => e instanceof LegacyMigrationRefusal && e.message === "no_session_source",
    );
  });
  assert.match(stderr, /no_session_source/);
  assert.equal(existsSync(p), false);

  const res = spawnSession(dir, p, ["recover"]);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /no_session_source/);
  assert.equal(existsSync(p), false);
});

test("recover exits 2 with no_session_source when the parent is chmod 0o500 and neither file exists", (t) => {
  if (!directoryModesAreEnforced()) {
    t.skip("chmod 0o500 does not produce EACCES for root or on win32");
    return;
  }
  const dir = makeTempDir("ss-no-source-500-");
  const parent = join(dir, "locked");
  mkdirSync(parent);
  const p = join(parent, "session.db");
  chmodSync(parent, 0o500);
  try {
    const res = spawnSession(dir, p, ["recover"]);
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /no_session_source/);
    assert.equal(existsSync(p), false);
  } finally {
    chmodSync(parent, 0o700);
  }
});
