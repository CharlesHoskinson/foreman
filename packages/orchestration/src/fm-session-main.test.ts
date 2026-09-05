import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import {
  writeFileSync,
  readFileSync,
  rmSync,
  mkdtempSync,
  mkdirSync,
  statSync,
  lstatSync,
  existsSync,
  renameSync,
  chmodSync,
  symlinkSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import {
  SqliteSessionStore,
  classifySqliteStore,
  encodeSnapshot,
  countRows,
  decodeSnapshot,
  outboxDrainFailure,
  SessionStoreError,
  sessionStoreFailure,
  type DrainResult,
  type MemoryIndex,
  type SessionStore,
} from "@foreman/session-store";
import {
  sidecarNdjson,
  importSidecar,
  main,
  assessSidecarReplace,
  writeAtomic,
  CliRefusal,
  setSyncTestDeps,
} from "./fm-session-main.js";
import { sidecarPathFor } from "./session-paths.js";
import {
  bootstrapStore,
  LegacyMigrationRefusal,
} from "./session-sqlite-bootstrap.js";

/** Local alias so existing CLI characterization keeps reading as classifyStore. */
const classifyStore = classifySqliteStore;

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "fm-session-main.ts");
// `--import tsx` resolves the bare specifier "tsx" against the child's cwd;
// resolve it from this file's own location instead, same as
// fm-session-golden.test.ts's TSX_LOADER.
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");

/**
 * Both cases below now arm their probe on DatabaseSync.prototype rather than on
 * a connection the test owns. The sidecar is written by the port, which opens
 * its own connection, so a probe attached to a caller-held instance would sit
 * beside the code under test instead of on it and pass vacuously.
 */
function recordAndRestore<T>(
  onSql: (sql: string) => void,
  body: () => T,
): T {
  const origExec = DatabaseSync.prototype.exec;
  const origPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.exec = function (sql: string) {
    onSql(sql);
    return origExec.call(this, sql);
  };
  DatabaseSync.prototype.prepare = function (sql: string) {
    onSql(sql);
    return origPrepare.call(this, sql);
  };
  try {
    return body();
  } finally {
    DatabaseSync.prototype.exec = origExec;
    DatabaseSync.prototype.prepare = origPrepare;
  }
}

function scrub(...paths: string[]): void {
  for (const p of paths) {
    for (const suffix of ["", "-shm", "-wal"]) {
      try {
        rmSync(p + suffix);
      } catch {
        // absent is the normal case for the WAL sidecars
      }
    }
  }
}

describe("fm-session-main atomicity and locks", () => {
  it("(b) sidecar reads every table from one SQLite snapshot", () => {
    const dbPath = join(tmpdir(), `test-b-${Date.now()}.db`);
    try {
      SqliteSessionStore.open(dbPath).close();

      // Fires once, between the facts read and the measurements read of the
      // same snapshot. If those two reads are not inside one transaction the
      // dump shows zero facts and one measurement -- a picture of the store
      // that never existed at any instant.
      let committed = false;
      const interleave = (sql: string) => {
        if (committed || !sql.includes('FROM "measurements"')) return;
        committed = true;
        const writer = new DatabaseSync(dbPath);
        writer.exec(
          "INSERT INTO facts(id,statement,established_ts) VALUES(1,'concurrent fact','now')",
        );
        writer.exec(
          "INSERT INTO measurements(id,metric,value,measured_ts) VALUES(1,'concurrent metric','1','now')",
        );
        writer.close();
      };

      const reader = SqliteSessionStore.open(dbPath);
      try {
        const [ndjson] = recordAndRestore(interleave, () => sidecarNdjson(reader));
        assert.ok(committed, "writer did not commit between table reads");

        const lines = ndjson.split("\n").filter(Boolean);
        const facts = lines.filter((l) => l.includes('"kind":"fact"'));
        const measurements = lines.filter((l) => l.includes('"kind":"measurement"'));

        assert.equal(
          facts.length,
          measurements.length,
          "snapshot must be consistent: length of facts should match measurements",
        );
        assert.equal(facts.length, 0, "concurrently inserted facts should not be visible");
      } finally {
        reader.close();
      }
    } finally {
      scrub(dbPath);
    }
  });

  it("(c) import-sidecar checks for rows after acquiring the write lock", () => {
    const stamp = Date.now();
    const dbPath = join(tmpdir(), `test-c-${stamp}.db`);
    const targetDbPath = join(tmpdir(), `test-c-target-${stamp}.db`);
    const sidecarPath = join(tmpdir(), `test-c-${stamp}.ndjson`);
    try {
      const setupDb = SqliteSessionStore.open(dbPath);
      setupDb.addFact({
        statement: "source fact",
        evidence: null,
        established_ts: "now",
        session_id: null,
      });
      const [ndjson] = sidecarNdjson(setupDb);
      setupDb.close();
      writeFileSync(sidecarPath, ndjson);

      const target = SqliteSessionStore.open(targetDbPath);
      try {
        const statements: string[] = [];
        recordAndRestore(
          (sql) => statements.push(sql),
          () => importSidecar(target, sidecarPath),
        );

        const beginIdx = statements.findIndex((s) => s === "BEGIN IMMEDIATE");
        // Occupancy is decided by reading the target snapshot inside the
        // write transaction (full table SELECTs), not a SELECT 1 probe.
        const checkIdx = statements.findIndex(
          (s, i) =>
            i > beginIdx &&
            (s.includes('FROM "facts"') ||
              s.includes('FROM "sessions"') ||
              s.includes('FROM "measurements"') ||
              s.includes('FROM "obligations"')),
        );

        assert.ok(beginIdx !== -1, "must execute BEGIN IMMEDIATE");
        assert.ok(checkIdx !== -1, "must read target rows for the occupancy check");
        assert.ok(
          beginIdx < checkIdx,
          `write lock must be acquired before row check. BEGIN at ${beginIdx}, SELECT at ${checkIdx}`,
        );
      } finally {
        target.close();
      }
    } finally {
      scrub(dbPath, targetDbPath);
      try {
        rmSync(sidecarPath);
      } catch {
        // the sidecar is written before any assertion, so absence means failure
      }
    }
  });

  it("(d) a legacy-shaped store is rebuilt, never opened by the port", () => {
    const dbPath = join(tmpdir(), `test-d-${Date.now()}.db`);
    try {
      // The shape of every session.db in the wild: schema_meta present,
      // store_meta absent, live ids far above 1. Opening the port straight
      // onto this returns cleanly and seeds every watermark to 1, so the next
      // write collides -- which is the whole reason this bootstrap exists. A
      // golden cannot see any of that, so it is asserted here directly.
      const legacy = new DatabaseSync(dbPath);
      legacy.exec(
        [
          "CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
          "CREATE TABLE sessions (session_id TEXT PRIMARY KEY, started_ts TEXT NOT NULL, start_sha TEXT, ended_ts TEXT, note TEXT);",
          "CREATE TABLE facts (id INTEGER PRIMARY KEY AUTOINCREMENT, statement TEXT NOT NULL, evidence TEXT, established_ts TEXT NOT NULL, session_id TEXT, superseded_by INTEGER, superseded_at TEXT, supersede_reason TEXT);",
          "CREATE TABLE measurements (id INTEGER PRIMARY KEY AUTOINCREMENT, metric TEXT NOT NULL, value TEXT NOT NULL, command TEXT, measured_ts TEXT NOT NULL, measured_sha TEXT, scope_paths TEXT, session_id TEXT, value_num REAL, superseded_by INTEGER, superseded_at TEXT, supersede_reason TEXT);",
          "CREATE TABLE obligations (id INTEGER PRIMARY KEY AUTOINCREMENT, statement TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', blocker TEXT, opened_ts TEXT NOT NULL, closed_ts TEXT, session_id TEXT);",
        ].join("\n"),
      );
      legacy.exec("INSERT INTO schema_meta(key,value) VALUES('version','3')");
      legacy.exec(
        "INSERT INTO facts(id,statement,established_ts) VALUES(36,'live fact','2026-08-01T00:00:00Z')",
      );
      legacy.exec(
        "INSERT INTO measurements(id,metric,value,measured_ts) VALUES(19,'m','1','2026-08-01T00:00:00Z')",
      );
      legacy.exec(
        "INSERT INTO obligations(id,statement,status,blocker,opened_ts) VALUES(34,'live obligation','blocked','a blocker','2026-08-01T00:00:00Z')",
      );
      legacy.close();

      bootstrapStore(dbPath, { allowMigration: true, readOnly: false });
      const db = new DatabaseSync(dbPath);
      const tables = new Set(
        (db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as {
          name: string;
        }[]).map((r) => r.name),
      );
      const watermark = (kind: string): number =>
        Number(
          (db.prepare("SELECT value FROM store_meta WHERE key = ?").get(
            `next_id.${kind}`,
          ) as { value: string }).value,
        );
      const blocked = db
        .prepare("SELECT status, blocker FROM obligations WHERE id = 34")
        .get() as { status: string; blocker: string | null };
      const marks = {
        fact: watermark("fact"),
        measurement: watermark("measurement"),
        obligation: watermark("obligation"),
      };
      db.close();

      assert.ok(tables.has("store_meta"), "the store was not rebuilt into the port schema");
      assert.ok(!tables.has("schema_meta"), "the legacy schema survived the rebuild");
      assert.equal(marks.fact, 37, "fact watermark must clear the live max id, not seed to 1");
      assert.equal(marks.measurement, 20, "measurement watermark must clear the live max id");
      assert.equal(marks.obligation, 35, "obligation watermark must clear the live max id");
      // "blocked" is not a declared status; it survives the migration as the
      // pair the model does declare, and nothing about the row is lost.
      assert.equal(blocked.status, "open");
      assert.equal(blocked.blocker, "a blocker");
    } finally {
      scrub(dbPath);
    }
  });
});

test("a read-only command refuses to migrate a legacy store", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-roguard-"));
  try {
    const p = join(dir, "session.db");
    const db = new DatabaseSync(p);
    try {
      db.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT)");
      db.exec("INSERT INTO schema_meta VALUES('version','3')");
      db.exec("CREATE TABLE facts(id INTEGER PRIMARY KEY, statement TEXT)");
    } finally {
      db.close();
    }
    const before = statSync(p).mtimeMs;
    const res = spawnSync(process.execPath, ["--import", TSX_LOADER, ENTRY, "recover"], {
      cwd: dir, encoding: "utf8",
      env: { ...process.env, FOREMAN_SESSION_DB: p },
    });
    assert.notEqual(res.status, 0, "recover migrated a legacy store instead of refusing");
    assert.match(res.stderr, /read-only command/);
    assert.equal(statSync(p).mtimeMs, before, "a read-only command modified the store");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read-only commands do not write to a healthy, existing port store", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-rohealthy-"));
  try {
    const p = join(dir, "session.db");
    const spawn = (cmd: string, args: readonly string[] = []) =>
      spawnSync(process.execPath, ["--import", TSX_LOADER, ENTRY, cmd, ...args], {
        cwd: dir, encoding: "utf8",
        env: { ...process.env, FOREMAN_SESSION_DB: p },
      });

    // A real write command, exactly as the CLI runs it. The process may
    // leave the WAL un-checkpointed on disk when it exits -- the exact
    // precondition a later read-only open must not rewrite. Without it,
    // a subsequent plain (non-readonly) open+close would find nothing left
    // to checkpoint and the defect would pass unnoticed.
    const w = spawn("fact", ["seed fact"]);
    assert.equal(w.status, 0, w.stderr);

    const beforeBytes = readFileSync(p);
    const beforeMtime = statSync(p).mtimeMs;

    const r1 = spawn("recover");
    assert.equal(r1.status, 0, r1.stderr);
    const r2 = spawn("freshness");
    assert.equal(r2.status, 0, r2.stderr);
    // "sidecar" is the third READ_ONLY_CMDS member, and reaches the store
    // through a completely separate path (sidecarNdjson -> SqliteSessionStore
    // .open) that bootstrapStore's own read-only guard does not cover by itself.
    const r3 = spawn("sidecar", ["--out", join(dir, "out.ndjson")]);
    assert.equal(r3.status, 0, r3.stderr);

    const afterBytes = readFileSync(p);
    const afterMtime = statSync(p).mtimeMs;
    assert.ok(Buffer.compare(beforeBytes, afterBytes) === 0, "a read-only command rewrote the store's bytes");
    assert.equal(afterMtime, beforeMtime, "a read-only command changed the store's mtime");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("addFact mints and inserts in one transaction", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-mint-"));
  try {
    const p = join(dir, "session.db");
    SqliteSessionStore.open(p).close();

    const statements: string[] = [];
    const savedArgv = process.argv;
    const savedEnv = process.env["FOREMAN_SESSION_DB"];
    let rc: number | undefined;
    try {
      // Drive the real command dispatch, not a hand-rolled simulation of it:
      // main() is exported precisely so a test can do this. The port's tx()
      // must hold BEGIN IMMEDIATE across the watermark read and the row
      // insert. The search is scoped after BEGIN so classifyStore's earlier
      // store_meta SELECT cannot satisfy the assertion.
      process.argv = [process.argv[0]!, process.argv[1]!, "fact", "concurrent fact"];
      process.env["FOREMAN_SESSION_DB"] = p;
      recordAndRestore(
        (sql) => statements.push(sql),
        () => {
          const result = main();
          assert.equal(typeof result, "number", "fact command must complete synchronously");
          rc = result as number;
        },
      );
    } finally {
      process.argv = savedArgv;
      if (savedEnv === undefined) delete process.env["FOREMAN_SESSION_DB"];
      else process.env["FOREMAN_SESSION_DB"] = savedEnv;
    }
    assert.equal(rc, 0, "main() did not report success for a plain fact command");

    const beginIdx = statements.indexOf("BEGIN IMMEDIATE");
    assert.ok(beginIdx !== -1, "mint must open BEGIN IMMEDIATE before reading the watermark");
    const selectIdx = statements.findIndex((s, i) => i > beginIdx && s.includes("SELECT value FROM store_meta"));
    assert.ok(selectIdx !== -1, "mint must read the watermark inside the transaction");
    const insertIdx = statements.findIndex((s, i) => i > selectIdx && s.includes("INSERT INTO facts"));
    assert.ok(insertIdx !== -1, "the row insert must happen inside the same transaction");
    const commitIdx = statements.findIndex((s, i) => i > insertIdx && s === "COMMIT");
    assert.ok(commitIdx !== -1, "the transaction must commit after the insert");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retire refuses an already-retired measurement", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-retire-"));
  try {
    const db = join(dir, "session.db");
    const store = SqliteSessionStore.open(db);
    try {
      const mk = (v: string, ts: string) =>
        store.addMeasurement({
          metric: "m", value: v, value_num: Number(v), command: null,
          measured_ts: ts, measured_sha: null, scope_paths: "x", session_id: null,
        });
      const a = mk("1", "2026-08-08T11:00:00Z");
      const b = mk("2", "2026-08-08T11:01:00Z");
      const c = mk("3", "2026-08-08T11:02:00Z");
      store.retireMeasurement(a.id, b.id, "first", "2026-08-08T11:03:00Z");
      assert.throws(
        () => store.retireMeasurement(a.id, c.id, "second", "2026-08-08T11:04:00Z"),
        /already superseded/,
      );
      // The legacy path overwrote the pointer instead of refusing.
      const after = store.listMeasurements().find((r) => r.id === a.id);
      assert.equal(after?.superseded_by, b.id, "the original pointer was overwritten");
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeLegacyStore(
  dbPath: string,
  opts: { readonly omitTables?: readonly string[] } = {},
): void {
  const omit = new Set(opts.omitTables ?? []);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(
      "CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    );
    db.exec("INSERT INTO schema_meta(key,value) VALUES('version','3')");
    if (!omit.has("sessions")) {
      db.exec(
        "CREATE TABLE sessions (session_id TEXT PRIMARY KEY, started_ts TEXT NOT NULL, start_sha TEXT, ended_ts TEXT, note TEXT);",
      );
    }
    if (!omit.has("facts")) {
      db.exec(
        "CREATE TABLE facts (id INTEGER PRIMARY KEY AUTOINCREMENT, statement TEXT NOT NULL, evidence TEXT, established_ts TEXT NOT NULL, session_id TEXT, superseded_by INTEGER, superseded_at TEXT, supersede_reason TEXT);",
      );
      db.exec(
        "INSERT INTO facts(id,statement,established_ts) VALUES(36,'live fact','2026-08-01T00:00:00Z')",
      );
    }
    if (!omit.has("measurements")) {
      db.exec(
        "CREATE TABLE measurements (id INTEGER PRIMARY KEY AUTOINCREMENT, metric TEXT NOT NULL, value TEXT NOT NULL, command TEXT, measured_ts TEXT NOT NULL, measured_sha TEXT, scope_paths TEXT, session_id TEXT, value_num REAL, superseded_by INTEGER, superseded_at TEXT, supersede_reason TEXT);",
      );
      db.exec(
        "INSERT INTO measurements(id,metric,value,measured_ts) VALUES(19,'m','1','2026-08-01T00:00:00Z')",
      );
    }
    if (!omit.has("obligations")) {
      db.exec(
        "CREATE TABLE obligations (id INTEGER PRIMARY KEY AUTOINCREMENT, statement TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', blocker TEXT, opened_ts TEXT NOT NULL, closed_ts TEXT, session_id TEXT);",
      );
      db.exec(
        "INSERT INTO obligations(id,statement,status,blocker,opened_ts) VALUES(34,'live obligation','blocked','a blocker','2026-08-01T00:00:00Z')",
      );
    }
  } finally {
    db.close();
  }
}

function spawnSession(
  dir: string,
  dbPath: string,
  args: readonly string[],
  extraEnv: NodeJS.ProcessEnv = {},
) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Ambient shell selection must not leak into focused SQLite cases. Drop the
  // factory selectors before merging the test's explicit environment.
  delete env["FOREMAN_SESSION_BACKEND"];
  delete env["FOREMAN_SESSION_DIR"];
  return spawnSync(process.execPath, ["--import", TSX_LOADER, ENTRY, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...env, FOREMAN_SESSION_DB: dbPath, ...extraEnv },
  });
}

function directoryModesAreEnforced(): boolean {
  return (
    process.platform !== "win32" &&
    !(typeof process.getuid === "function" && process.getuid() === 0)
  );
}

function captureStderr(body: () => void): string {
  let text = "";
  const orig = process.stderr.write;
  process.stderr.write = ((
    chunk: string | Uint8Array,
    ...args: unknown[]
  ) => {
    text += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return Reflect.apply(orig, process.stderr, [chunk, ...args]);
  }) as typeof process.stderr.write;
  try {
    body();
    return text;
  } finally {
    process.stderr.write = orig;
  }
}

test("CRITICAL 1a: a legacy store missing a declared table is refused, not dumped empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-c1a-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    writeLegacyStore(p, { omitTables: ["facts"] });
    writeFileSync(
      sidecar,
      [
        `{"format":"foreman-session-sidecar","format_version":1}`,
        `{"table":"facts","row":{"id":1,"statement":"canonical fact","evidence":null,"established_ts":"2026-08-01T00:00:00Z","session_id":null,"superseded_by":null,"superseded_at":null,"supersede_reason":null}}`,
        "",
      ].join("\n"),
    );
    const before = readFileSync(sidecar, "utf8");
    assert.throws(
      () => bootstrapStore(p, { allowMigration: true, readOnly: false }),
      /facts/,
    );
    assert.equal(classifyStore(p), "legacy", "a lossy dump must not rebuild the store");
    assert.equal(readFileSync(sidecar, "utf8"), before, "the canonical sidecar must stay untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CRITICAL 1b: a successful write refuses to replace a sidecar with fewer rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-c1b-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    const rich = SqliteSessionStore.open(join(dir, "rich.db"));
    try {
      for (const statement of ["fact-a", "fact-b", "fact-c"]) {
        rich.addFact({
          statement,
          evidence: null,
          established_ts: "2026-08-01T00:00:00Z",
          session_id: null,
        });
      }
      writeFileSync(sidecar, encodeSnapshot(rich.snapshot()));
    } finally {
      rich.close();
    }
    const existingRows = countRows(decodeSnapshot(readFileSync(sidecar, "utf8")));
    assert.equal(existingRows, 3);

    const thin = SqliteSessionStore.open(p);
    try {
      thin.addFact({
        statement: "only-one",
        evidence: null,
        established_ts: "2026-08-01T00:00:00Z",
        session_id: null,
      });
    } finally {
      thin.close();
    }

    const res = spawnSession(dir, p, ["begin", "--note", "shrink-probe"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /BEHIND the database/);
    assert.match(res.stderr, /3 row/);
    assert.match(res.stderr, /2 row|1 row/);
    const after = decodeSnapshot(readFileSync(sidecar, "utf8"));
    assert.equal(countRows(after), 3, "the richer sidecar must not be replaced");
    assert.ok(
      after.facts.some((f) => f.statement === "fact-a"),
      "canonical facts must survive a thinner store dump",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CRITICAL 1b: import-sidecar --force is the explicit shrink opt-in", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-c1b-force-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    const incoming = join(dir, "incoming.ndjson");
    const rich = SqliteSessionStore.open(p);
    try {
      for (const statement of ["keep-a", "keep-b", "keep-c"]) {
        rich.addFact({
          statement,
          evidence: null,
          established_ts: "2026-08-01T00:00:00Z",
          session_id: null,
        });
      }
      writeFileSync(sidecar, encodeSnapshot(rich.snapshot()));
    } finally {
      rich.close();
    }
    const small = SqliteSessionStore.open(join(dir, "small.db"));
    try {
      small.addFact({
        statement: "forced-one",
        evidence: null,
        established_ts: "2026-08-01T00:00:00Z",
        session_id: null,
      });
      writeFileSync(incoming, encodeSnapshot(small.snapshot()));
    } finally {
      small.close();
    }
    const res = spawnSession(dir, p, ["import-sidecar", incoming, "--force"]);
    assert.equal(res.status, 0, res.stderr);
    const after = decodeSnapshot(readFileSync(sidecar, "utf8"));
    assert.equal(countRows(after), 1);
    assert.equal(after.facts[0]?.statement, "forced-one");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CRITICAL 2: a refused write after migration still leaves a tracked sidecar", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-c2-"));
  try {
    const p = join(dir, "session.db");
    writeLegacyStore(p);
    assert.equal(existsSync(sidecarPathFor(p)), false);
    const res = spawnSession(dir, p, ["supersede", "999", "nope", "--reason", "r"]);
    assert.notEqual(res.status, 0, "supersede 999 must still refuse");
    assert.match(res.stderr, /migrated 3 row/);
    const sidecar = sidecarPathFor(p);
    assert.equal(existsSync(sidecar), true, "migration must not leave the tracked record missing");
    const snap = decodeSnapshot(readFileSync(sidecar, "utf8"));
    assert.equal(countRows(snap), 3);
    assert.ok(snap.facts.some((f) => f.statement === "live fact"));
    assert.equal(classifyStore(p), "port");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CRITICAL 3: --help and unknown commands must not migrate a legacy store", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-c3-"));
  try {
    const p = join(dir, "session.db");
    writeLegacyStore(p);
    const before = readFileSync(p);
    for (const args of [["--help"], ["nosuchcmd"]] as const) {
      const res = spawnSession(dir, p, args);
      assert.notEqual(res.status, 0, `${args.join(" ")} must stay a refusal`);
      assert.doesNotMatch(
        res.stderr,
        /migrated /,
        `${args.join(" ")} migrated a store it does not need`,
      );
      assert.equal(classifyStore(p), "legacy", `${args.join(" ")} rewrote the schema`);
      assert.ok(Buffer.compare(before, readFileSync(p)) === 0, `${args.join(" ")} changed the store bytes`);
      assert.equal(existsSync(sidecarPathFor(p)), false, `${args.join(" ")} wrote a sidecar`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedFacts(dbPath: string, statements: readonly string[]): void {
  const store = SqliteSessionStore.open(dbPath);
  try {
    for (const statement of statements) {
      store.addFact({
        statement,
        evidence: null,
        established_ts: "2026-08-01T00:00:00Z",
        session_id: null,
      });
    }
  } finally {
    store.close();
  }
}

function factStatements(dbPath: string): string[] {
  const store = SqliteSessionStore.open(dbPath);
  try {
    return store.listFacts().map((f) => f.statement);
  } finally {
    store.close();
  }
}

function writeSidecarFrom(dbPath: string, sidecar: string): void {
  const store = SqliteSessionStore.open(dbPath);
  try {
    writeFileSync(sidecar, encodeSnapshot(store.snapshot()));
  } finally {
    store.close();
  }
}

function seedFactsWithIds(
  dbPath: string,
  rows: readonly { readonly id: number; readonly statement: string }[],
): void {
  const tmp = `${dbPath}.seed.ndjson`;
  writeFileSync(
    tmp,
    [
      `{"format":"foreman-session-sidecar","format_version":1}`,
      ...rows.map((r) =>
        JSON.stringify({
          table: "facts",
          row: {
            id: r.id,
            statement: r.statement,
            evidence: null,
            established_ts: "2026-08-01T00:00:00Z",
            session_id: null,
            superseded_by: null,
            superseded_at: null,
            supersede_reason: null,
          },
        }),
      ),
      "",
    ].join("\n"),
  );
  const store = SqliteSessionStore.open(dbPath);
  try {
    importSidecar(store, tmp, true);
  } finally {
    store.close();
  }
  rmSync(tmp, { force: true });
}

test("FIX 1: a committed write must not exit 2 when sidecar refresh is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-fix1-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    seedFacts(p, ["existing"]);
    seedFactsWithIds(join(dir, "rich.db"), [
      { id: 1, statement: "existing" },
      { id: 10, statement: "CANONICAL-1" },
      { id: 11, statement: "CANONICAL-2" },
      { id: 12, statement: "CANONICAL-3" },
    ]);
    writeSidecarFrom(join(dir, "rich.db"), sidecar);

    const first = spawnSession(dir, p, ["fact", "retry-attempt-1"]);
    assert.equal(first.status, 0, "a richer-sidecar refusal after a committed write must stay exit 0");
    assert.match(first.stderr, /BEHIND the database/);
    assert.deepEqual(factStatements(p), ["existing", "retry-attempt-1"]);
    const afterFirst = decodeSnapshot(readFileSync(sidecar, "utf8"));
    assert.equal(countRows(afterFirst), 4);
    assert.ok(afterFirst.facts.some((f) => f.statement === "CANONICAL-1"));

    const second = spawnSession(dir, p, ["fact", "retry-attempt-2"]);
    assert.equal(second.status, 0, "a second attempt must not be classified as a refusal of the first write");
    assert.match(second.stderr, /BEHIND the database/);
    const statements = factStatements(p);
    assert.equal(
      statements.filter((s) => s === "retry-attempt-1").length,
      1,
      "retry-attempt-1 must appear once; exit 2 made the operator retry duplicate it",
    );
    assert.ok(statements.includes("retry-attempt-2"));
    const afterSecond = decodeSnapshot(readFileSync(sidecar, "utf8"));
    assert.equal(countRows(afterSecond), 4, "the richer sidecar must still not be replaced");
    assert.ok(afterSecond.facts.some((f) => f.statement === "CANONICAL-3"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FIX 2: same-count different identities must not replace the sidecar", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-fix2-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    seedFactsWithIds(join(dir, "canonical.db"), [
      { id: 1, statement: "CANONICAL-1" },
      { id: 2, statement: "CANONICAL-2" },
      { id: 3, statement: "CANONICAL-3" },
    ]);
    writeSidecarFrom(join(dir, "canonical.db"), sidecar);
    assert.equal(countRows(decodeSnapshot(readFileSync(sidecar, "utf8"))), 3);

    seedFactsWithIds(p, [
      { id: 10, statement: "JUNK-1" },
      { id: 11, statement: "JUNK-2" },
      { id: 12, statement: "JUNK-3" },
    ]);
    const dump = spawnSession(dir, p, ["sidecar"]);
    assert.notEqual(dump.status, 0, "replacing three canonical fact ids with three other ids must be refused");
    const afterDump = decodeSnapshot(readFileSync(sidecar, "utf8"));
    assert.deepEqual(
      afterDump.facts.map((f) => f.statement),
      ["CANONICAL-1", "CANONICAL-2", "CANONICAL-3"],
    );

    rmSync(p, { force: true });
    seedFacts(p, ["JUNK-1", "JUNK-2"]);
    const begin = spawnSession(dir, p, ["begin", "--note", "same-count-probe"]);
    assert.match(begin.stderr, /BEHIND the database|refusing/);
    const afterBegin = decodeSnapshot(readFileSync(sidecar, "utf8"));
    assert.deepEqual(
      afterBegin.facts.map((f) => f.statement),
      ["CANONICAL-1", "CANONICAL-2", "CANONICAL-3"],
      "canonical facts must survive a same-count dump of junk facts plus a new session",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FIX 3: the shrink refuse must name a command that honours --force", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-fix3-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    seedFacts(join(dir, "rich.db"), ["keep-a", "keep-b", "keep-c"]);
    writeSidecarFrom(join(dir, "rich.db"), sidecar);
    seedFacts(p, ["only-one"]);

    const res = spawnSession(dir, p, ["fact", "ignored-force", "--force"]);
    assert.match(res.stderr, /import-sidecar/);
    assert.doesNotMatch(
      res.stderr,
      /Pass --force to allow a shrink/,
      "the message must not advise --force on a command that ignores it",
    );
    const forced = spawnSession(dir, p, ["import-sidecar", sidecar, "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FIX 4 and 5: C1a refusal is exit 2 and the stated remedy restores the store", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-fix45-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    writeLegacyStore(p, { omitTables: ["facts"] });
    writeFileSync(
      sidecar,
      [
        `{"format":"foreman-session-sidecar","format_version":1}`,
        `{"table":"facts","row":{"id":1,"statement":"canonical fact","evidence":null,"established_ts":"2026-08-01T00:00:00Z","session_id":null,"superseded_by":null,"superseded_at":null,"supersede_reason":null}}`,
        "",
      ].join("\n"),
    );

    const refused = spawnSession(dir, p, ["fact", "must-not-land"]);
    assert.equal(refused.status, 2, `C1a must use the exit-2 refusal class, got ${refused.status}`);
    assert.doesNotMatch(refused.stderr, /OperationalError/);
    assert.match(refused.stderr, /refusing/);
    const mv = refused.stderr.match(/mv (\S+) (\S+)/);
    assert.ok(mv, `C1a refuse must name an mv remedy, stderr was: ${refused.stderr}`);
    const src = mv[1]!;
    const dest = mv[2]!;
    assert.equal(src, p);
    renameSync(src, dest);
    assert.equal(existsSync(p), false);

    const recovered = spawnSession(dir, p, ["recover"]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(classifyStore(p), "port");
    assert.ok(
      factStatements(p).includes("canonical fact"),
      "recover after mv must rehydrate the tracked sidecar",
    );

    const write = spawnSession(dir, p, ["fact", "after-remedy"]);
    assert.equal(write.status, 0, write.stderr);
    assert.ok(factStatements(p).includes("after-remedy"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FIX 2 bound: same-count identity loss is refused; payload mutation is not", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-fix2-bound-"));
  try {
    const canonicalPath = join(dir, "canonical.db");
    const junkPath = join(dir, "junk.db");
    const grownPath = join(dir, "grown.db");
    seedFactsWithIds(canonicalPath, [
      { id: 1, statement: "CANONICAL-1" },
      { id: 2, statement: "CANONICAL-2" },
      { id: 3, statement: "CANONICAL-3" },
    ]);
    seedFactsWithIds(junkPath, [
      { id: 10, statement: "JUNK-1" },
      { id: 11, statement: "JUNK-2" },
      { id: 12, statement: "JUNK-3" },
    ]);
    seedFactsWithIds(grownPath, [
      { id: 1, statement: "CANONICAL-1" },
      { id: 2, statement: "CANONICAL-2" },
      { id: 3, statement: "CANONICAL-3" },
      { id: 4, statement: "NEW" },
    ]);
    const snap = (p: string) => {
      const store = SqliteSessionStore.open(p);
      try {
        return store.snapshot();
      } finally {
        store.close();
      }
    };
    const canonical = snap(canonicalPath);
    const lost = assessSidecarReplace(canonical, snap(junkPath));
    assert.equal(lost.ok, false, "three different fact ids at the same count must be a replace");
    if (!lost.ok) {
      assert.equal(lost.oldCount, lost.newCount);
      assert.ok(lost.lostIdentities.length > 0);
    }
    const grown = assessSidecarReplace(canonical, snap(grownPath));
    assert.equal(grown.ok, true, "a strict identity superset must be allowed");

    const db = new DatabaseSync(canonicalPath);
    try {
      db.exec("UPDATE facts SET statement='MUTATED' WHERE id=1");
    } finally {
      db.close();
    }
    const mutated = assessSidecarReplace(canonical, snap(canonicalPath));
    assert.equal(
      mutated.ok,
      true,
      "same identities with a mutated statement are outside this bound",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R3 FIX 1: a hard sidecar write failure after a committed write must exit non-zero", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-r3-fix1-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    seedFacts(p, ["seed"]);
    writeSidecarFrom(p, sidecar);
    rmSync(sidecar);
    mkdirSync(sidecar);

    const res = spawnSession(dir, p, ["fact", "hard-fail-row"]);
    assert.equal(res.status, 1, `hard sidecar failure exited ${res.status}; expected 1`);
    assert.match(res.stderr, /already committed/, "operator text must say the store write committed");
    assert.match(res.stderr, /duplicate/, "operator text must warn that a retry duplicates the row");
    assert.match(res.stderr, /Clear the sidecar fault/, "operator text must name the sidecar fault first");
    assert.match(res.stderr, /sidecar --force/, "operator text must name fm-session sidecar --force");
    assert.ok(factStatements(p).includes("hard-fail-row"), "the store write must have committed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W2.3: writeAtomic emits no durability warning on the happy path", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w23-happy-"));
  try {
    const dest = join(dir, "session.ndjson");
    const stderr = captureStderr(() => {
      writeAtomic(dest, "published\n");
    });
    assert.equal(readFileSync(dest, "utf8"), "published\n");
    assert.doesNotMatch(
      stderr,
      /sidecar published, durability flush failed/,
      "a live parent-directory fsync must stay silent",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W2.3: chmod 0o300 on the parent directory warns and still publishes", (t) => {
  if (!directoryModesAreEnforced()) {
    t.skip("chmod 0o300 does not produce EACCES for root or on win32");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "fm-w23-chmod-"));
  try {
    const dest = join(dir, "session.ndjson");
    chmodSync(dir, 0o300);
    const stderr = captureStderr(() => {
      writeAtomic(dest, "published\n");
    });
    chmodSync(dir, 0o700);
    assert.equal(readFileSync(dest, "utf8"), "published\n");
    assert.match(stderr, /sidecar published, durability flush failed/);
    assert.match(stderr, /EACCES/);
  } finally {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // restore so cleanup can list the directory
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W2.3: a published CLI write emits no durability warning", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w23-cli-happy-"));
  try {
    const storeDir = join(dir, "store");
    mkdirSync(storeDir);
    const p = join(storeDir, "session.db");
    const sidecar = sidecarPathFor(p);
    seedFacts(p, ["first-row"]);
    writeSidecarFrom(p, sidecar);

    const res = spawnSession(dir, p, ["fact", "second-row"]);
    assert.equal(res.status, 0, `happy-path fact write failed: ${res.stderr}`);
    assert.match(res.stdout, /fact /);
    assert.doesNotMatch(res.stderr, /sidecar published, durability flush failed/);
    assert.doesNotMatch(res.stderr, /could not be refreshed/);
    assert.doesNotMatch(res.stderr, /BEHIND/);
    assert.doesNotMatch(res.stderr, /duplicate the row/);
    assert.ok(factStatements(p).includes("first-row"));
    assert.ok(factStatements(p).includes("second-row"));
    const body = readFileSync(sidecar, "utf8");
    assert.match(body, /"statement":"first-row"/);
    assert.match(body, /"statement":"second-row"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W2.3: a real parent-directory EACCES does not fail a published CLI write", (t) => {
  if (!directoryModesAreEnforced()) {
    t.skip("chmod 0o300 does not produce EACCES for root or on win32");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "fm-w23-cli-chmod-"));
  const storeDir = join(dir, "store");
  mkdirSync(storeDir);
  try {
    const p = join(storeDir, "session.db");
    const sidecar = sidecarPathFor(p);
    seedFacts(p, ["first-row"]);
    writeSidecarFrom(p, sidecar);

    chmodSync(storeDir, 0o300);
    const res = spawnSession(dir, p, ["fact", "second-row"]);
    chmodSync(storeDir, 0o700);

    assert.equal(
      res.status,
      0,
      `published write failed after real dir EACCES: exit ${res.status}\n${res.stderr}`,
    );
    assert.match(res.stdout, /fact /);
    assert.match(res.stderr, /sidecar published, durability flush failed/);
    assert.match(res.stderr, /EACCES/);
    assert.doesNotMatch(res.stderr, /could not be refreshed/);
    assert.doesNotMatch(res.stderr, /BEHIND/);
    assert.doesNotMatch(res.stderr, /duplicate the row/);
    assert.ok(factStatements(p).includes("first-row"));
    assert.ok(factStatements(p).includes("second-row"));
    const body = readFileSync(sidecar, "utf8");
    assert.match(body, /"statement":"first-row"/);
    assert.match(body, /"statement":"second-row"/);
  } finally {
    try {
      chmodSync(storeDir, 0o700);
    } catch {
      // restore so cleanup can list the directory
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R5 FIX B: a leftover sidecar.tmp directory cannot block a unique-tmp writer", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-r5-fixb-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    seedFacts(p, ["seed"]);
    writeSidecarFrom(p, sidecar);
    mkdirSync(`${sidecar}.tmp`);

    const res = spawnSession(dir, p, ["fact", "eisdir-row"]);
    assert.equal(res.status, 0, `leftover .tmp directory blocked the write: ${res.stderr}`);
    assert.ok(factStatements(p).includes("eisdir-row"), "the store write must have committed");
    assert.equal(existsSync(`${sidecar}.tmp`), true, "the leftover directory must stay unused");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R3 FIX 3: a failed sidecar rename must not leave the temp file", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-r3-fix3-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    seedFacts(p, ["seed"]);
    writeSidecarFrom(p, sidecar);
    rmSync(sidecar);
    mkdirSync(sidecar);

    spawnSession(dir, p, ["fact", "tmp-leak-row"]);
    assert.equal(
      existsSync(`${sidecar}.tmp`),
      false,
      "writeAtomic left <sidecar>.tmp after rename failed",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R3 FIX 4: the refuse line must name the identity-scoped bound", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-r3-fix4-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    seedFactsWithIds(join(dir, "canonical.db"), [
      { id: 1, statement: "CANONICAL-1" },
      { id: 2, statement: "CANONICAL-2" },
      { id: 3, statement: "CANONICAL-3" },
    ]);
    writeSidecarFrom(join(dir, "canonical.db"), sidecar);
    seedFactsWithIds(p, [
      { id: 10, statement: "JUNK-1" },
      { id: 11, statement: "JUNK-2" },
      { id: 12, statement: "JUNK-3" },
    ]);

    const res = spawnSession(dir, p, ["sidecar"]);
    assert.notEqual(res.status, 0, "same-count identity loss must still refuse");
    assert.match(
      res.stderr,
      /identity-scoped/,
      "operator text must say the guard is identity-scoped",
    );
    const after = decodeSnapshot(readFileSync(sidecar, "utf8"));
    assert.deepEqual(
      after.facts.map((f) => f.statement),
      ["CANONICAL-1", "CANONICAL-2", "CANONICAL-3"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W2.5: a non-numeric watermark classifies the store as corrupt", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w25-"));
  try {
    const p = join(dir, "session.db");
    const store = SqliteSessionStore.open(p);
    store.addFact({
      statement: "one",
      evidence: null,
      established_ts: "2026-08-08T10:00:00Z",
      session_id: null,
    });
    store.close();
    const db = new DatabaseSync(p);
    try {
      db.exec("UPDATE store_meta SET value='abc' WHERE key='next_id.fact'");
    } finally {
      db.close();
    }
    assert.equal(classifyStore(p), "corrupt");

    const res = spawnSession(dir, p, ["fact", "must-not-land"]);
    assert.equal(res.status, 2, `corrupt watermark must refuse with exit 2, got ${res.status}`);
    assert.match(res.stderr, /refusing/);
    assert.match(res.stderr, /mv /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("regression: a missing watermark classifies the store as corrupt via 0 <= max", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w25-miss-"));
  try {
    const p = join(dir, "session.db");
    const store = SqliteSessionStore.open(p);
    store.addFact({
      statement: "one",
      evidence: null,
      established_ts: "2026-08-08T10:00:00Z",
      session_id: null,
    });
    store.close();
    const db = new DatabaseSync(p);
    try {
      db.exec("DELETE FROM store_meta WHERE key='next_id.fact'");
    } finally {
      db.close();
    }
    assert.equal(classifyStore(p), "corrupt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W2.6: a refuseFromPort refusal leaves no -wal or -shm", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w26-"));
  try {
    const p = join(dir, "session.db");
    SqliteSessionStore.open(p).close();
    const res = spawnSession(dir, p, ["close", "999"]);
    assert.equal(res.status, 2, `close 999 must refuse with exit 2, got ${res.status}`);
    assert.match(res.stderr, /not open/);
    assert.equal(existsSync(`${p}-wal`), false, "refusal left a -wal file");
    assert.equal(existsSync(`${p}-shm`), false, "refusal left a -shm file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.1/W3.5: an integrity-refused legacy migration is exit 2, not sqlite3.OperationalError", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w35-integrity-"));
  try {
    const p = join(dir, "session.db");
    writeLegacyStore(p, { omitTables: ["facts"] });
    const db = new DatabaseSync(p);
    try {
      db.exec(
        "CREATE TABLE facts (id INTEGER PRIMARY KEY AUTOINCREMENT, statement TEXT, evidence TEXT, established_ts TEXT NOT NULL, session_id TEXT, superseded_by INTEGER, superseded_at TEXT, supersede_reason TEXT);",
      );
      db.exec("INSERT INTO facts(id,statement,established_ts) VALUES(7, NULL, '2026-08-01T00:00:00Z')");
    } finally {
      db.close();
    }
    const res = spawnSession(dir, p, ["fact", "must-not-land"]);
    assert.equal(res.status, 2, `integrity-refused migration exited ${res.status}; expected 2`);
    assert.match(res.stderr, /could not be migrated/);
    assert.match(res.stderr, /null in a non-null field/);
    assert.match(res.stderr, /id=7/);
    assert.doesNotMatch(res.stderr, /OperationalError/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.1/W3.5: a directory-as-db open still prints sqlite3.OperationalError", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w35-dir-"));
  try {
    const p = join(dir, "session.db");
    mkdirSync(p);
    const res = spawnSession(dir, p, ["recover"]);
    assert.equal(res.status, 1, `directory-as-db exited ${res.status}; expected 1`);
    assert.match(res.stderr, /sqlite3\.OperationalError/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.1/W3.5: a parent-path ENOTDIR is not reported as sqlite3.OperationalError", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w35-enotdir-"));
  try {
    const blocker = join(dir, "notadir");
    writeFileSync(blocker, "x");
    const p = join(blocker, "session.db");
    const res = spawnSession(dir, p, ["recover"]);
    assert.equal(res.status, 1, `unrelated parent-path failure exited ${res.status}; expected 1`);
    assert.doesNotMatch(res.stderr, /OperationalError/);
    assert.match(res.stderr, /EEXIST|ENOTDIR|not a directory|file already exists/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.2: close refuses --blocker", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w32-"));
  try {
    const p = join(dir, "session.db");
    spawnSession(dir, p, ["begin", "--note", "w32"]);
    spawnSession(dir, p, ["obligation", "close-me"]);
    const res = spawnSession(dir, p, ["close", "1", "--status", "done", "--blocker", "ignored"]);
    assert.equal(res.status, 2, `close --blocker exited ${res.status}; expected 2`);
    assert.match(res.stderr, /--blocker is not valid with close/);
    assert.doesNotMatch(res.stdout, /obligation 1 -> done/);
    const store = SqliteSessionStore.open(p, { readOnly: true });
    try {
      const row = store.listObligations().find((o) => o.id === 1);
      assert.equal(row?.status, "open", "refused close must leave the obligation open");
      assert.equal(row?.blocker, null);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.3: a second end refuses and leaves ended_ts unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w33-"));
  try {
    const p = join(dir, "session.db");
    const begun = spawnSession(dir, p, ["begin", "--note", "w33"]);
    const sidMatch = begun.stdout.match(/SESSION BEGUN: (\S+)/);
    assert.ok(sidMatch, `begin must print a session id, stdout was: ${begun.stdout}`);
    const sid = sidMatch[1]!;
    const first = spawnSession(dir, p, ["end", sid]);
    assert.equal(first.status, 0, first.stderr);
    const store = SqliteSessionStore.open(p, { readOnly: true });
    let firstEnded: string | null;
    try {
      firstEnded = store.listSessions().find((s) => s.session_id === sid)?.ended_ts ?? null;
    } finally {
      store.close();
    }
    assert.ok(firstEnded, "first end must stamp ended_ts");
    const second = spawnSession(dir, p, ["end", sid]);
    assert.equal(second.status, 2, `second end exited ${second.status}; expected 2`);
    assert.match(second.stderr, /already ended/);
    assert.match(second.stderr, /set-once/);
    assert.doesNotMatch(second.stdout, /session ended:/);
    const after = SqliteSessionStore.open(p, { readOnly: true });
    try {
      const row = after.listSessions().find((s) => s.session_id === sid);
      assert.equal(row?.ended_ts, firstEnded, "second end must not rewrite ended_ts");
    } finally {
      after.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.6: an unrelated port failure on retire is not reported as supersession", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w36-retire-"));
  const orig = SqliteSessionStore.prototype.retireMeasurement;
  const savedArgv = process.argv;
  const savedEnv = process.env["FOREMAN_SESSION_DB"];
  try {
    const p = join(dir, "session.db");
    const store = SqliteSessionStore.open(p);
    try {
      store.addMeasurement({
        metric: "m",
        value: "1",
        value_num: 1,
        command: null,
        measured_ts: "2026-08-08T11:00:00Z",
        measured_sha: null,
        scope_paths: "x",
        session_id: null,
      });
      store.addMeasurement({
        metric: "m",
        value: "2",
        value_num: 2,
        command: null,
        measured_ts: "2026-08-08T11:01:00Z",
        measured_sha: null,
        scope_paths: "x",
        session_id: null,
      });
    } finally {
      store.close();
    }
    SqliteSessionStore.prototype.retireMeasurement = function () {
      throw new SessionStoreError(
        sessionStoreFailure("field_type", "value_num must be finite, got NaN"),
      );
    };
    process.argv = [process.argv[0]!, process.argv[1]!, "retire", "1", "--by", "2", "--reason", "r"];
    process.env["FOREMAN_SESSION_DB"] = p;
    const text = captureStderr(() => {
      assert.throws(
        () => main(),
        (e: unknown) => e instanceof CliRefusal && e.exitCode === 2,
      );
    });
    assert.match(text, /value_num must be finite/);
    assert.doesNotMatch(text, /already superseded/);
  } finally {
    SqliteSessionStore.prototype.retireMeasurement = orig;
    process.argv = savedArgv;
    if (savedEnv === undefined) delete process.env["FOREMAN_SESSION_DB"];
    else process.env["FOREMAN_SESSION_DB"] = savedEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.6: an unrelated port failure on supersede is not reported as a missing-or-superseded fact", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w36-super-"));
  const orig = SqliteSessionStore.prototype.supersedeFact;
  const savedArgv = process.argv;
  const savedEnv = process.env["FOREMAN_SESSION_DB"];
  try {
    const p = join(dir, "session.db");
    const store = SqliteSessionStore.open(p);
    try {
      store.addFact({
        statement: "live",
        evidence: null,
        established_ts: "2026-08-08T11:00:00Z",
        session_id: null,
      });
    } finally {
      store.close();
    }
    SqliteSessionStore.prototype.supersedeFact = function () {
      throw new SessionStoreError(
        sessionStoreFailure("field_type", "value_num must be finite, got NaN"),
      );
    };
    process.argv = [
      process.argv[0]!,
      process.argv[1]!,
      "supersede",
      "1",
      "replacement",
      "--reason",
      "r",
    ];
    process.env["FOREMAN_SESSION_DB"] = p;
    const text = captureStderr(() => {
      assert.throws(
        () => main(),
        (e: unknown) => e instanceof CliRefusal && e.exitCode === 2,
      );
    });
    assert.match(text, /value_num must be finite/);
    assert.doesNotMatch(text, /does not exist or is already superseded/);
  } finally {
    SqliteSessionStore.prototype.supersedeFact = orig;
    process.argv = savedArgv;
    if (savedEnv === undefined) delete process.env["FOREMAN_SESSION_DB"];
    else process.env["FOREMAN_SESSION_DB"] = savedEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

function threeLineSidecarText(): string {
  return [
    `{"format":"foreman-session-sidecar","format_version":1}`,
    `{"table":"facts","row":{"id":1,"statement":"keep-a","evidence":null,"established_ts":"2026-08-01T00:00:00Z","session_id":null,"superseded_by":null,"superseded_at":null,"supersede_reason":null}}`,
    `{"table":"facts","row":{"id":2,"statement":"keep-b","evidence":null,"established_ts":"2026-08-01T00:00:00Z","session_id":null,"superseded_by":null,"superseded_at":null,"supersede_reason":null}}`,
    "",
  ].join("\n");
}

test("W3.4: sidecar A/B preserves the file when readable, unreadable, or corrupt", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w34-ab-"));
  try {
    const readableText = threeLineSidecarText();
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    SqliteSessionStore.open(p).close();

    writeFileSync(sidecar, readableText);
    const readable = spawnSession(dir, p, ["sidecar"]);
    assert.equal(readable.status, 2, `readable sidecar exited ${readable.status}; expected 2`);
    assert.match(readable.stderr, /has 2 row\(s\).*0 row\(s\)/);
    assert.equal(readFileSync(sidecar, "utf8"), readableText, "readable sidecar must be preserved");

    if (!directoryModesAreEnforced()) {
      t.skip("chmod 000 does not block the owner on root or win32; corrupt arm still runs below");
    } else {
      writeFileSync(sidecar, readableText);
      chmodSync(sidecar, 0o000);
      const unreadable = spawnSession(dir, p, ["sidecar"]);
      chmodSync(sidecar, 0o644);
      assert.equal(
        unreadable.status,
        2,
        `unreadable sidecar exited ${unreadable.status}; expected 2. stdout=${unreadable.stdout}`,
      );
      assert.match(unreadable.stderr, /could not be read/);
      assert.match(unreadable.stderr, /EACCES|permission denied/);
      assert.doesNotMatch(unreadable.stdout, /dumped 0/);
      assert.equal(
        readFileSync(sidecar, "utf8"),
        readableText,
        "unreadable sidecar must be preserved, not replaced with a 0-row dump",
      );
    }

    const corruptText = "this is not a sidecar\nline-two\nline-three\n";
    writeFileSync(sidecar, corruptText);
    const corrupt = spawnSession(dir, p, ["sidecar"]);
    assert.equal(
      corrupt.status,
      2,
      `corrupt sidecar exited ${corrupt.status}; expected 2. stdout=${corrupt.stdout}`,
    );
    assert.match(corrupt.stderr, /could not be parsed/);
    assert.doesNotMatch(corrupt.stdout, /dumped 0/);
    assert.equal(
      readFileSync(sidecar, "utf8"),
      corruptText,
      "corrupt-but-readable sidecar must be preserved, not replaced with a 0-row dump",
    );
  } finally {
    try {
      chmodSync(join(dir, "session.ndjson"), 0o644);
    } catch {
      // restore so cleanup can unlink
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.4: a recover refusal against a missing db must not leave an empty port-shaped db", (t) => {
  if (!directoryModesAreEnforced()) {
    t.skip("chmod 000 does not block the owner on root or win32");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "fm-w34-reach-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    writeFileSync(sidecar, threeLineSidecarText());
    chmodSync(sidecar, 0o000);
    const res = spawnSession(dir, p, ["recover"]);
    chmodSync(sidecar, 0o644);
    assert.equal(res.status, 2, `recover exited ${res.status}; expected 2`);
    assert.match(res.stderr, /could not be read/);
    assert.equal(existsSync(p), false, "refusal left an empty port-shaped .db that the next invocation would treat as healthy");
    assert.equal(classifyStore(p), "absent");
    assert.equal(existsSync(`${p}-wal`), false);
    assert.equal(existsSync(`${p}-shm`), false);
  } finally {
    try {
      chmodSync(join(dir, "session.ndjson"), 0o644);
    } catch {
      // restore so cleanup can unlink
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r3 FIX 6: chmod 000 on the db file prints EACCES, not sqlite3.OperationalError", (t) => {
  if (!directoryModesAreEnforced()) {
    t.skip("chmod 000 does not block the owner on root or win32");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r3-chmod000-"));
  try {
    const p = join(dir, "session.db");
    SqliteSessionStore.open(p).close();
    chmodSync(p, 0o000);
    const res = spawnSession(dir, p, ["recover"]);
    chmodSync(p, 0o644);
    assert.equal(res.status, 1, `chmod 000 db exited ${res.status}; expected 1`);
    assert.doesNotMatch(res.stderr, /OperationalError/);
    assert.match(res.stderr, /EACCES|permission denied/);
  } finally {
    try {
      chmodSync(join(dir, "session.db"), 0o644);
    } catch {
      // restore so cleanup can unlink
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.1/W3.5: a parent-directory chmod 500 is not reported as sqlite3.OperationalError", (t) => {
  if (!directoryModesAreEnforced()) {
    t.skip("chmod 500 does not block the owner on root or win32");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "fm-w35-parent500-"));
  const parent = join(dir, "locked");
  mkdirSync(parent);
  try {
    const p = join(parent, "session.db");
    writeFileSync(sidecarPathFor(p), threeLineSidecarText());
    chmodSync(parent, 0o500);
    const res = spawnSession(dir, p, ["recover"]);
    chmodSync(parent, 0o700);
    assert.equal(res.status, 1, `parent chmod 500 exited ${res.status}; expected 1`);
    assert.doesNotMatch(res.stderr, /OperationalError/);
    assert.match(res.stderr, /EACCES|permission denied/);
  } finally {
    try {
      chmodSync(parent, 0o700);
    } catch {
      // restore so cleanup can rmdir
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.6: an already-superseded fact is not reported as missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w36-split-"));
  try {
    const p = join(dir, "session.db");
    const added = spawnSession(dir, p, ["fact", "live"]);
    assert.equal(added.status, 0, added.stderr);
    const first = spawnSession(dir, p, ["supersede", "1", "replacement", "--reason", "r"]);
    assert.equal(first.status, 0, first.stderr);
    const second = spawnSession(dir, p, ["supersede", "1", "again", "--reason", "r"]);
    assert.equal(second.status, 2, `second supersede exited ${second.status}; expected 2`);
    assert.match(second.stderr, /fact 1 is already superseded/);
    assert.match(second.stderr, /set-once/);
    assert.doesNotMatch(second.stderr, /does not exist or is already superseded/);
    const missing = spawnSession(dir, p, ["supersede", "9999", "x", "--reason", "r"]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /does not exist or is already superseded/);
    assert.doesNotMatch(missing.stderr, /set-once/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r2: measure without VALUE refuses instead of throwing a SQLite bind TypeError", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r2-measure-"));
  try {
    const p = join(dir, "session.db");
    const res = spawnSession(dir, p, ["measure", "m1", "--num", "1", "--scope", "x"]);
    assert.equal(res.status, 2, `measure missing VALUE exited ${res.status}; expected 2`);
    assert.match(res.stderr, /METRIC and VALUE|requires.*VALUE/i);
    assert.doesNotMatch(res.stderr, /TypeError/);
    assert.doesNotMatch(res.stderr, /SQLite parameter/);
    assert.doesNotMatch(res.stderr, /at SqliteSessionStore/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W2.6: an in-command process.exit refusal leaves no -wal or -shm", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w26-end-"));
  try {
    const p = join(dir, "session.db");
    SqliteSessionStore.open(p).close();
    const res = spawnSession(dir, p, ["end"]);
    assert.equal(res.status, 2, `end with no session must refuse with exit 2, got ${res.status}`);
    assert.match(res.stderr, /no open session/);
    assert.equal(existsSync(`${p}-wal`), false, "refusal left a -wal file");
    assert.equal(existsSync(`${p}-shm`), false, "refusal left a -shm file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeForeignNotesDb(p: string, bodies: readonly string[]): void {
  const db = new DatabaseSync(p);
  try {
    db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
    const ins = db.prepare("INSERT INTO notes(body) VALUES (?)");
    for (const body of bodies) ins.run(body);
  } finally {
    db.close();
  }
}

function countNotes(p: string): number {
  const db = new DatabaseSync(p);
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number };
    return Number(row.n);
  } finally {
    db.close();
  }
}

test("Task 6 correction: import-sidecar --into preserves wrapper stderr for foreign/incomplete/missing-table", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-t6-into-"));
  try {
    const incoming = join(dir, "incoming.ndjson");
    writeFileSync(
      incoming,
      [
        `{"format":"foreman-session-sidecar","format_version":1}`,
        `{"table":"facts","row":{"id":1,"statement":"imported","evidence":null,"established_ts":"2026-08-01T00:00:00Z","session_id":null,"superseded_by":null,"superseded_at":null,"supersede_reason":null}}`,
        "",
      ].join("\n"),
    );

    const foreign = join(dir, "foreign.db");
    writeForeignNotesDb(foreign, ["keep-foreign"]);
    const foreignBefore = readFileSync(foreign);
    const foreignRes = spawnSession(dir, join(dir, "ambient.db"), [
      "import-sidecar",
      incoming,
      "--into",
      foreign,
      "--force",
    ]);
    assert.equal(foreignRes.status, 2, `foreign --into exited ${foreignRes.status}`);
    assert.match(
      foreignRes.stderr,
      /refusing: the session store at .*foreign\.db exists but is not a Foreman session database/,
    );
    assert.match(
      foreignRes.stderr,
      /refusing: cannot open target store: unrecognised session store at .*foreign\.db/,
    );
    assert.equal(countNotes(foreign), 1);
    assert.ok(Buffer.compare(foreignBefore, readFileSync(foreign)) === 0);

    const incomplete = join(dir, "incomplete.db");
    {
      const db = new DatabaseSync(incomplete);
      try {
        db.exec("CREATE TABLE store_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.exec("INSERT INTO store_meta(key,value) VALUES('next_id.fact','1')");
        db.exec(
          "CREATE TABLE foreign_sentinel(id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
        );
        db.exec("INSERT INTO foreign_sentinel(id,body) VALUES(1,'do-not-touch')");
      } finally {
        db.close();
      }
    }
    assert.equal(classifyStore(incomplete), "corrupt");
    const incompleteBefore = readFileSync(incomplete);
    const incompleteRes = spawnSession(dir, join(dir, "ambient.db"), [
      "import-sidecar",
      incoming,
      "--into",
      incomplete,
      "--force",
    ]);
    assert.equal(incompleteRes.status, 2, `incomplete --into exited ${incompleteRes.status}`);
    assert.match(incompleteRes.stderr, /refusing: the session store at .*incomplete\.db/);
    assert.ok(
      Buffer.compare(incompleteBefore, readFileSync(incomplete)) === 0,
      "incomplete --into must not mutate the target",
    );
    {
      const probe = new DatabaseSync(incomplete, { readOnly: true });
      try {
        const names = new Set(
          (probe.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as {
            name: string;
          }[]).map((r) => r.name),
        );
        for (const table of [
          "sessions",
          "facts",
          "measurements",
          "obligations",
          "memory_outbox",
        ] as const) {
          assert.equal(names.has(table), false, `incomplete must still lack ${table}`);
        }
        const sentinel = probe
          .prepare("SELECT body FROM foreign_sentinel WHERE id = 1")
          .get() as { body: string } | undefined;
        assert.equal(sentinel?.body, "do-not-touch");
      } finally {
        probe.close();
      }
    }

    const missing = join(dir, "missing-table.db");
    writeLegacyStore(missing, { omitTables: ["facts"] });
    const missingBefore = readFileSync(missing);
    const missingRes = spawnSession(dir, join(dir, "ambient.db"), [
      "import-sidecar",
      incoming,
      "--into",
      missing,
      "--force",
    ]);
    assert.equal(missingRes.status, 2, `missing-table --into exited ${missingRes.status}`);
    assert.match(
      missingRes.stderr,
      /refusing: the legacy session store at .*missing-table\.db could not be migrated to the port schema:/,
    );
    assert.match(
      missingRes.stderr,
      /refusing: cannot open target store: legacy store is missing declared table facts;/,
    );
    assert.equal(classifyStore(missing), "legacy");
    assert.ok(Buffer.compare(missingBefore, readFileSync(missing)) === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r3 FIX 1: recover refuses a foreign SQLite db and does not delete it", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r3-foreign-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    writeForeignNotesDb(p, ["keep-1", "keep-2"]);
    const before = readFileSync(p);

    writeFileSync(sidecar, "this is not a sidecar\njunk\n");
    const corrupt = spawnSession(dir, p, ["recover"]);
    assert.equal(corrupt.status, 2, `foreign+corrupt sidecar exited ${corrupt.status}`);
    assert.match(corrupt.stderr, /not a Foreman session database|does not recognise/);
    assert.equal(existsSync(p), true, "foreign db must still exist after corrupt-sidecar recover");
    assert.equal(countNotes(p), 2, "notes rows must survive a corrupt sidecar");
    assert.ok(Buffer.compare(before, readFileSync(p)) === 0, "foreign db bytes must not change");

    writeFileSync(sidecar, threeLineSidecarText());
    const readable = spawnSession(dir, p, ["recover"]);
    assert.equal(readable.status, 2, `foreign+readable sidecar exited ${readable.status}`);
    assert.match(readable.stderr, /not a Foreman session database|does not recognise/);
    assert.equal(countNotes(p), 2, "notes rows must survive a readable sidecar");

    rmSync(sidecar);
    const none = spawnSession(dir, p, ["recover"]);
    assert.equal(none.status, 2, `foreign+no sidecar exited ${none.status}`);
    assert.match(none.stderr, /not a Foreman session database|does not recognise/);
    assert.equal(countNotes(p), 2, "notes rows must survive a missing sidecar");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r3 FIX 1: recover refuses a non-SQLite file at the store path", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r3-nonsql-"));
  try {
    const p = join(dir, "session.db");
    writeFileSync(p, "hello world not sqlite\n");
    const before = readFileSync(p);
    const res = spawnSession(dir, p, ["recover"]);
    assert.equal(res.status, 2, `non-SQLite store exited ${res.status}`);
    assert.match(res.stderr, /not a Foreman session database|does not recognise/);
    assert.equal(readFileSync(p, "utf8"), before.toString("utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r3 FIX 2: unread sidecar refusal names sidecar --out and that command works", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r3-out-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    SqliteSessionStore.open(p).close();
    const corruptText = "this is not a sidecar\nline-two\n";
    writeFileSync(sidecar, corruptText);
    const refused = spawnSession(dir, p, ["sidecar"]);
    assert.equal(refused.status, 2, `corrupt sidecar exited ${refused.status}`);
    assert.match(refused.stderr, /could not be parsed/);
    assert.match(refused.stderr, /sidecar --out/);
    assert.doesNotMatch(refused.stderr, /sidecar --force/);
    assert.equal(readFileSync(sidecar, "utf8"), corruptText);

    const fresh = join(dir, "fresh.ndjson");
    const dumped = spawnSession(dir, p, ["sidecar", "--out", fresh]);
    assert.equal(dumped.status, 0, `sidecar --out exited ${dumped.status}: ${dumped.stderr}`);
    assert.match(dumped.stdout, /dumped 0 row/);
    assert.equal(existsSync(fresh), true);
    assert.equal(readFileSync(sidecar, "utf8"), corruptText, "--out must not touch the unread sidecar");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r3 FIX 2: post-write unread warning names sidecar --out, not --force", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r3-warn-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    seedFacts(p, ["already-there"]);
    writeFileSync(sidecar, "not-json\n");
    const res = spawnSession(dir, p, ["fact", "landed"]);
    assert.equal(res.status, 0, `fact with unread sidecar exited ${res.status}: ${res.stderr}`);
    assert.match(res.stderr, /BEHIND the database/);
    assert.match(res.stderr, /sidecar --out/);
    assert.doesNotMatch(res.stderr, /sidecar --force/);
    const fresh = join(dir, "fresh.ndjson");
    const dumped = spawnSession(dir, p, ["sidecar", "--out", fresh]);
    assert.equal(dumped.status, 0, dumped.stderr);
    assert.match(dumped.stdout, /dumped 2 row/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r3 FIX 3: store commands refuse missing positionals without a stack trace", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r3-pos-"));
  try {
    const p = join(dir, "session.db");
    spawnSession(dir, p, ["begin", "--note", "pos"]);
    const cases: ReadonlyArray<{ args: readonly string[]; missing: RegExp }> = [
      { args: ["fact"], missing: /missing STATEMENT/ },
      { args: ["obligation"], missing: /missing STATEMENT/ },
      { args: ["close"], missing: /missing OBLIGATION_ID/ },
      { args: ["import-sidecar"], missing: /missing PATH/ },
      { args: ["supersede"], missing: /missing FACT_ID/ },
      { args: ["supersede", "1"], missing: /missing STATEMENT/ },
      { args: ["retire"], missing: /missing MEASUREMENT_ID/ },
      { args: ["note"], missing: /unknown command note/ },
    ];
    for (const c of cases) {
      const res = spawnSession(dir, p, c.args);
      assert.equal(res.status, 2, `${c.args.join(" ") || "(empty)"} exited ${res.status}`);
      assert.match(res.stderr, c.missing, `${c.args.join(" ")} stderr: ${res.stderr}`);
      assert.doesNotMatch(res.stderr, /TypeError/);
      assert.doesNotMatch(res.stderr, /SQLite parameter/);
      assert.doesNotMatch(res.stderr, /at SqliteSessionStore/);
      assert.doesNotMatch(res.stderr, /\/home\/charl\//);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r3 FIX 4: FIFO and dangling symlink sidecars are refused, not replaced", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r3-fifo-"));
  try {
    const p = join(dir, "session.db");
    SqliteSessionStore.open(p).close();

    const fifo = sidecarPathFor(p);
    execFileSync("mkfifo", [fifo]);
    const fifoRes = spawnSession(dir, p, ["sidecar"]);
    assert.equal(fifoRes.status, 2, `FIFO sidecar exited ${fifoRes.status}: ${fifoRes.stderr}`);
    assert.match(fifoRes.stderr, /could not be read|not a regular file/);
    assert.equal(statSync(fifo).isFIFO(), true, "FIFO must not be replaced by a regular file");

    rmSync(fifo);
    const link = sidecarPathFor(p);
    symlinkSync(join(dir, "missing-target.ndjson"), link);
    const dang = spawnSession(dir, p, ["sidecar"]);
    assert.equal(dang.status, 2, `dangling symlink exited ${dang.status}: ${dang.stderr}`);
    assert.match(dang.stderr, /could not be read|not a regular file/);
    assert.equal(lstatSync(link).isSymbolicLink(), true, "dangling symlink must not be replaced");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r3 FIX 5: sidecar --force through a symlink writes the target", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r3-sym-"));
  try {
    const p = join(dir, "session.db");
    const target = join(dir, "tracked.ndjson");
    const link = sidecarPathFor(p);
    seedFacts(p, ["only-one"]);
    writeSidecarFrom(p, target);
    symlinkSync(target, link);

    const richer = join(dir, "rich.db");
    seedFactsWithIds(richer, [
      { id: 1, statement: "only-one" },
      { id: 2, statement: "extra" },
    ]);
    writeSidecarFrom(richer, target);
    rmSync(link);
    symlinkSync(target, link);

    const forced = spawnSession(dir, p, ["sidecar", "--force"]);
    assert.equal(forced.status, 0, `sidecar --force through symlink exited ${forced.status}: ${forced.stderr}`);
    assert.equal(lstatSync(link).isSymbolicLink(), true, "the symlink itself must remain");
    assert.equal(readFileSync(link, "utf8"), readFileSync(target, "utf8"));
    const snap = decodeSnapshot(readFileSync(target, "utf8"));
    assert.equal(countRows(snap), 1, "force must write the store dump into the target");
    assert.deepEqual(
      snap.facts.map((f) => f.statement),
      ["only-one"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r3 FIX 8: a read-only command must not rehydrate an existing empty port-shaped store", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r3-ro-rehy-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    SqliteSessionStore.open(p).close();
    writeFileSync(sidecar, threeLineSidecarText());
    const res = spawnSession(dir, p, ["recover"]);
    assert.equal(res.status, 0, `recover exited ${res.status}: ${res.stderr}`);
    const store = SqliteSessionStore.open(p, { readOnly: true });
    try {
      assert.equal(store.listFacts().length, 0, "read-only recover must not write sidecar rows into an existing empty store");
    } finally {
      store.close();
    }
    assert.equal(readFileSync(sidecar, "utf8"), threeLineSidecarText());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sqliteErrcodeOf(e: unknown): number | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const code = (e as { errcode?: unknown }).errcode;
  return typeof code === "number" ? code : undefined;
}

function unlinkWalSidecars(p: string): void {
  for (const suffix of ["-wal", "-shm"] as const) {
    try {
      rmSync(p + suffix);
    } catch {
      // absent is the usual case after a checkpointing close
    }
  }
}

test("W3.r4 FIX A: a healthy port store under a chmod 500 parent is EACCES, not unrecognised", (t) => {
  if (!directoryModesAreEnforced()) {
    t.skip("chmod 500 does not block the owner on root or win32");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r4-a-500-"));
  const parent = join(dir, "locked");
  mkdirSync(parent);
  try {
    const p = join(parent, "session.db");
    seedFacts(p, ["keep-readonly-dir"]);
    unlinkWalSidecars(p);
    chmodSync(parent, 0o500);
    assert.throws(
      () => classifyStore(p),
      (e: unknown) => sqliteErrcodeOf(e) === 1544,
      "SQLITE_READONLY_DIRECTORY must not collapse to unrecognised",
    );
    const rec = spawnSession(dir, p, ["recover"]);
    const fresh = spawnSession(dir, p, ["freshness"]);
    chmodSync(parent, 0o755);
    assert.equal(rec.status, 1, `recover exited ${rec.status}; expected 1. stderr=${rec.stderr}`);
    assert.match(rec.stderr, /EACCES|permission denied/);
    assert.doesNotMatch(rec.stderr, /not a Foreman session database/);
    assert.doesNotMatch(rec.stderr, /\.unrecognised/);
    assert.equal(fresh.status, 1, `freshness exited ${fresh.status}; expected 1`);
    assert.doesNotMatch(fresh.stderr, /not a Foreman session database/);
    const restored = spawnSession(dir, p, ["recover"]);
    assert.equal(restored.status, 0, `after chmod 755 recover exited ${restored.status}: ${restored.stderr}`);
    assert.deepEqual(factStatements(p), ["keep-readonly-dir"]);
  } finally {
    try {
      chmodSync(parent, 0o700);
    } catch {
      // restore so cleanup can rmdir
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r4 FIX A: SQLITE_BUSY is transient, not unrecognised", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r4-a-busy-"));
  const locker = { db: undefined as DatabaseSync | undefined };
  try {
    const p = join(dir, "session.db");
    seedFacts(p, ["busy-fact"]);
    locker.db = new DatabaseSync(p);
    locker.db.exec("PRAGMA journal_mode=DELETE");
    locker.db.exec("BEGIN EXCLUSIVE");
    assert.throws(
      () => classifyStore(p),
      (e: unknown) => sqliteErrcodeOf(e) === 5,
      "SQLITE_BUSY must be rethrown, not classified unrecognised",
    );
    const res = spawnSession(dir, p, ["recover"]);
    assert.notEqual(res.status, 0, "a locked store must not look healthy");
    assert.doesNotMatch(res.stderr, /not a Foreman session database/);
    assert.doesNotMatch(res.stderr, /\.unrecognised/);
  } finally {
    try {
      locker.db?.exec("ROLLBACK");
    } catch {
      // lock already dropped
    }
    try {
      locker.db?.close();
    } catch {
      // already closed
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r4 FIX A: SQLITE_CORRUPT classifies corrupt, not unrecognised", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r4-a-corrupt-"));
  try {
    const p = join(dir, "session.db");
    seedFacts(p, ["will-corrupt"]);
    const buf = readFileSync(p);
    for (let i = 100; i < Math.min(buf.length, 800); i++) buf[i] = 0xff;
    writeFileSync(p, buf);
    assert.equal(classifyStore(p), "corrupt");
    const before = readFileSync(p);
    const res = spawnSession(dir, p, ["recover"]);
    assert.equal(res.status, 2, `corrupt recover exited ${res.status}`);
    assert.match(res.stderr, /corrupt/i);
    assert.doesNotMatch(res.stderr, /not a Foreman session database/);
    assert.ok(Buffer.compare(before, readFileSync(p)) === 0, "damaged store must be left in place");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r4 FIX A: SQLITE_NOTADB stays unrecognised", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r4-a-notadb-"));
  try {
    const p = join(dir, "session.db");
    writeFileSync(p, "this is not sqlite\n");
    assert.equal(classifyStore(p), "unrecognised");
    const res = spawnSession(dir, p, ["recover"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /not a Foreman session database/);
    assert.equal(readFileSync(p, "utf8"), "this is not sqlite\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r4 FIX B: unrecognised refusal names recover only when that recover works", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r4-b-ok-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    writeForeignNotesDb(p, ["keep-1", "keep-2"]);
    writeFileSync(sidecar, threeLineSidecarText());
    const refused = spawnSession(dir, p, ["recover"]);
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /not a Foreman session database/);
    assert.match(refused.stderr, /mv \S+ \S+\.unrecognised && fm-session recover/);
    assert.doesNotMatch(refused.stderr, /Clear the sidecar fault/);
    renameSync(p, `${p}.unrecognised`);
    const recovered = spawnSession(dir, p, ["recover"]);
    assert.equal(recovered.status, 0, `named recover exited ${recovered.status}: ${recovered.stderr}`);
    assert.deepEqual(factStatements(p), ["keep-a", "keep-b"]);
    assert.equal(countNotes(`${p}.unrecognised`), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r4 FIX B: an unreadable sidecar must not name a recover that exits 2", (t) => {
  if (!directoryModesAreEnforced()) {
    t.skip("chmod 000 does not block the owner on root or win32");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r4-b-eacces-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    writeForeignNotesDb(p, ["keep-1", "keep-2"]);
    writeFileSync(sidecar, threeLineSidecarText());
    chmodSync(sidecar, 0o000);
    const refused = spawnSession(dir, p, ["recover"]);
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /Clear the sidecar fault/);
    const again = spawnSession(dir, p, ["recover"]);
    assert.equal(again.status, 2, `recover in the printed state exited ${again.status}`);
    renameSync(p, `${p}.unrecognised`);
    const stillBroken = spawnSession(dir, p, ["recover"]);
    assert.equal(stillBroken.status, 2, `mv && recover with chmod 000 sidecar exited ${stillBroken.status}`);
    assert.match(stillBroken.stderr, /could not be read/);
    chmodSync(sidecar, 0o644);
    const recovered = spawnSession(dir, p, ["recover"]);
    assert.equal(recovered.status, 0, `after clearing the fault recover exited ${recovered.status}: ${recovered.stderr}`);
    assert.deepEqual(factStatements(p), ["keep-a", "keep-b"]);
  } finally {
    try {
      chmodSync(join(dir, "session.ndjson"), 0o644);
    } catch {
      // restore so cleanup can unlink
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r4 FIX B: a corrupt sidecar must not name a recover that exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r4-b-parse-"));
  try {
    const p = join(dir, "session.db");
    const sidecar = sidecarPathFor(p);
    writeForeignNotesDb(p, ["keep-1", "keep-2"]);
    writeFileSync(sidecar, "this is not a sidecar\njunk\n");
    const refused = spawnSession(dir, p, ["recover"]);
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /Clear the sidecar fault/);
    renameSync(p, `${p}.unrecognised`);
    const named = spawnSession(dir, p, ["recover"]);
    assert.equal(named.status, 2, `mv && recover with a corrupt sidecar exited ${named.status}`);
    assert.equal(countNotes(`${p}.unrecognised`), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W3.r4 FIX C: the absent-path TOCTOU re-check refuses a file classifyStore missed", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-w3r4-c-toctou-"));
  const origLstat = fs.lstatSync;
  try {
    const p = join(dir, "session.db");
    writeForeignNotesDb(p, ["keep-1", "keep-2"]);
    const before = readFileSync(p);
    fs.lstatSync = ((path: Parameters<typeof origLstat>[0], opts?: Parameters<typeof origLstat>[1]) => {
      if (String(path) === p) {
        throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
      }
      return origLstat.call(fs, path, opts as never);
    }) as typeof origLstat;
    assert.equal(classifyStore(p), "absent", "lstat patch must hide the file from classifyStore");
    assert.equal(existsSync(p), true, "existsSync must still see the file the re-check reads");
    assert.throws(
      () => bootstrapStore(p, { allowMigration: true, readOnly: false }),
      (e: unknown) => e instanceof LegacyMigrationRefusal,
    );
    assert.equal(countNotes(p), 2, "TOCTOU refuse must not adopt the foreign file");
    assert.ok(Buffer.compare(before, readFileSync(p)) === 0, "TOCTOU refuse must not mutate the file");
  } finally {
    fs.lstatSync = origLstat;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("default import-sidecar names the selected SQLite file exactly", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-import-sqlite-name-"));
  try {
    const p = join(dir, "session.db");
    const incoming = join(dir, "incoming.ndjson");
    writeFileSync(
      incoming,
      [
        `{"format":"foreman-session-sidecar","format_version":1}`,
        `{"table":"facts","row":{"id":1,"statement":"named-sqlite-import","evidence":null,"established_ts":"2026-08-01T00:00:00Z","session_id":null,"superseded_by":null,"superseded_at":null,"supersede_reason":null}}`,
        "",
      ].join("\n"),
    );
    const res = spawnSession(dir, p, ["import-sidecar", incoming, "--force"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, `imported 1 document(s) -> ${p}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("files-only CLI routes every ordinary command through the selected SessionStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-files-only-cli-"));
  try {
    const filesDir = join(dir, "files-store");
    mkdirSync(filesDir, { recursive: true });
    const sentinel = join(dir, "sentinel.db");
    mkdirSync(sentinel, { recursive: true });
    const sentinelMarker = join(sentinel, "DO-NOT-TOUCH");
    writeFileSync(sentinelMarker, "sentinel-unchanged\n");
    const sentinelListingBefore = fs.readdirSync(sentinel).sort().join("\n");

    const filesEnv: NodeJS.ProcessEnv = {
      FOREMAN_SESSION_BACKEND: "files_only",
      FOREMAN_SESSION_DIR: filesDir,
      FOREMAN_SESSION_DB: sentinel,
    };

    const write = spawnSession(dir, sentinel, ["fact", "files-only-live-fact"], filesEnv);
    assert.equal(write.status, 0, write.stderr);
    assert.match(write.stdout, /fact \d+/);
    assert.match(write.stderr, /sidecar refreshed:/);
    assert.match(write.stderr, /files-store[/\\]session\.ndjson/);
    const autoSidecar = join(filesDir, "session.ndjson");
    assert.equal(existsSync(autoSidecar), true, "automatic refresh must publish session.ndjson");
    assert.match(readFileSync(autoSidecar, "utf8"), /files-only-live-fact/);

    const recover = spawnSession(dir, sentinel, ["recover"], filesEnv);
    assert.equal(recover.status, 0, recover.stderr);
    assert.match(recover.stdout, /FOREMAN RECOVERY|files-only-live-fact|FACT/);

    const freshness = spawnSession(dir, sentinel, ["freshness"], filesEnv);
    assert.equal(freshness.status, 0, freshness.stderr);

    const outPath = join(dir, "explicit-out.ndjson");
    const dump = spawnSession(dir, sentinel, ["sidecar", "--out", outPath], filesEnv);
    assert.equal(dump.status, 0, dump.stderr);
    const dumped = readFileSync(outPath, "utf8");
    assert.match(dumped, /files-only-live-fact/);
    assert.equal(dumped, readFileSync(autoSidecar, "utf8"));

    const incoming = join(dir, "replacement.ndjson");
    writeFileSync(
      incoming,
      [
        `{"format":"foreman-session-sidecar","format_version":1}`,
        `{"table":"facts","row":{"id":1,"statement":"imported-replacement-fact","evidence":null,"established_ts":"2026-08-01T00:00:00Z","session_id":null,"superseded_by":null,"superseded_at":null,"supersede_reason":null}}`,
        `{"table":"facts","row":{"id":2,"statement":"second-imported-fact","evidence":null,"established_ts":"2026-08-01T00:00:01Z","session_id":null,"superseded_by":null,"superseded_at":null,"supersede_reason":null}}`,
        "",
      ].join("\n"),
    );
    const imported = spawnSession(dir, sentinel, ["import-sidecar", incoming, "--force"], filesEnv);
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, `imported 2 document(s) -> ${filesDir}\n`);
    const afterImport = readFileSync(autoSidecar, "utf8");
    assert.match(afterImport, /imported-replacement-fact/);
    assert.match(afterImport, /second-imported-fact/);
    assert.equal(afterImport.includes("files-only-live-fact"), false);

    assert.equal(readFileSync(sentinelMarker, "utf8"), "sentinel-unchanged\n");
    assert.equal(fs.readdirSync(sentinel).sort().join("\n"), sentinelListingBefore);
    assert.equal(existsSync(`${sentinel}-wal`), false);
    assert.equal(existsSync(`${sentinel}-shm`), false);
    assert.equal(existsSync(`${sentinel}-journal`), false);

    const explicitDb = join(dir, "EXPLICIT.db");
    const intoImport = spawnSession(
      dir,
      sentinel,
      ["import-sidecar", incoming, "--into", explicitDb, "--force"],
      filesEnv,
    );
    assert.equal(intoImport.status, 0, intoImport.stderr);
    assert.equal(intoImport.stdout, `imported 2 document(s) -> ${explicitDb}\n`);
    assert.equal(existsSync(explicitDb), true);
    const sqliteProbe = SqliteSessionStore.open(explicitDb, { readOnly: true });
    try {
      assert.equal(sqliteProbe.listFacts().length, 2);
      assert.ok(sqliteProbe.listFacts().some((f) => f.statement === "imported-replacement-fact"));
    } finally {
      sqliteProbe.close();
    }
    // Explicit --into must create the SQLite target and must not create
    // FilesOnly CURRENT/generation state beside that target.
    assert.equal(existsSync(join(dir, "CURRENT")), false);
    assert.equal(
      fs.readdirSync(dir).some((name) => /^\d{16}$/.test(name)),
      false,
      "explicit --into must not mint a files-only generation directory",
    );
    // Explicit --into must not replace the files-only store with the SQLite path.
    const stillFiles = spawnSession(dir, sentinel, ["sidecar", "--out", join(dir, "after-into.ndjson")], filesEnv);
    assert.equal(stillFiles.status, 0, stillFiles.stderr);
    assert.match(readFileSync(join(dir, "after-into.ndjson"), "utf8"), /imported-replacement-fact/);
    assert.equal(existsSync(join(filesDir, "CURRENT")), true);
    assert.equal(readFileSync(sentinelMarker, "utf8"), "sentinel-unchanged\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Task 3B correction: recognized-command validation migrates before refusal", () => {
  const cases: ReadonlyArray<{
    name: string;
    args: readonly string[];
    refusal: RegExp;
    /** When set, assert migration/sidecar against this path instead of the ambient store. */
    migrateTarget?: "ambient" | "explicit";
    explicitDbName?: string;
  }> = [
    {
      name: "fact missing STATEMENT",
      args: ["fact"],
      refusal: /missing STATEMENT/,
    },
    {
      name: "measure missing VALUE",
      args: ["measure", "m1", "--num", "1", "--scope", "x"],
      refusal: /METRIC and VALUE|requires.*VALUE/i,
    },
    {
      name: "obligation missing STATEMENT",
      args: ["obligation"],
      refusal: /missing STATEMENT/,
    },
    {
      name: "close with invalid --blocker",
      args: ["close", "1", "--status", "done", "--blocker", "ignored"],
      refusal: /--blocker is not valid with close/,
    },
    {
      name: "import-sidecar missing PATH",
      args: ["import-sidecar"],
      refusal: /missing PATH/,
    },
    {
      name: "import-sidecar --into EXPLICIT.db missing PATH",
      args: ["import-sidecar", "--into", "EXPLICIT.db"],
      refusal: /missing PATH/,
      migrateTarget: "explicit",
      explicitDbName: "EXPLICIT.db",
    },
    {
      name: "supersede missing STATEMENT",
      args: ["supersede", "1"],
      refusal: /missing STATEMENT/,
    },
    {
      name: "retire missing MEASUREMENT_ID",
      args: ["retire"],
      refusal: /missing MEASUREMENT_ID/,
    },
  ];

  for (const c of cases) {
    const dir = mkdtempSync(join(tmpdir(), `fm-t3b-mig-before-refuse-${c.name.replace(/\W+/g, "-")}-`));
    try {
      const ambient = join(dir, "session.db");
      const explicit = c.explicitDbName ? join(dir, c.explicitDbName) : null;
      const target = c.migrateTarget === "explicit" && explicit ? explicit : ambient;

      writeLegacyStore(ambient);
      if (explicit) writeLegacyStore(explicit);

      assert.equal(existsSync(sidecarPathFor(ambient)), false, `${c.name}: ambient sidecar present before run`);
      if (explicit) {
        assert.equal(existsSync(sidecarPathFor(explicit)), false, `${c.name}: explicit sidecar present before run`);
      }

      // Rewrite --into to an absolute path so cwd-relative resolution is unambiguous.
      const args = c.args.map((a) => (a === "EXPLICIT.db" && explicit ? explicit : a));
      const res = spawnSession(dir, ambient, args);

      assert.notEqual(res.status, 0, `${c.name}: expected nonzero refusal, got ${res.status}`);
      assert.doesNotMatch(res.stderr, /TypeError/);
      assert.doesNotMatch(res.stderr, /at Object\./);
      assert.doesNotMatch(res.stderr, /\/home\/charl\//);
      assert.match(res.stderr, c.refusal, `${c.name}: refusal text missing; stderr=${res.stderr}`);
      assert.match(
        res.stderr,
        /migrated 3 row\(s\)/,
        `${c.name}: expected migration before refusal; stderr=${res.stderr}`,
      );

      assert.equal(classifyStore(target), "port", `${c.name}: target store must classify as port`);
      const sidecar = sidecarPathFor(target);
      assert.equal(existsSync(sidecar), true, `${c.name}: tracked sidecar must exist after migration`);
      const snap = decodeSnapshot(readFileSync(sidecar, "utf8"));
      assert.equal(countRows(snap), 3, `${c.name}: sidecar must decode to the three migrated rows`);
      assert.ok(snap.facts.some((f) => f.statement === "live fact"), `${c.name}: migrated fact missing`);

      if (c.migrateTarget === "explicit" && explicit) {
        assert.equal(classifyStore(ambient), "legacy", `${c.name}: ambient default must stay legacy`);
        assert.equal(
          existsSync(sidecarPathFor(ambient)),
          false,
          `${c.name}: ambient default must not receive a sidecar`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("fm-session sync", () => {
  it("selects the SQLite store via FOREMAN_SESSION_DB", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-sync-sqlite-"));
    try {
      const p = join(dir, "session.db");
      const seeded = spawnSession(dir, p, ["fact", "sync-sqlite-seed"]);
      assert.equal(seeded.status, 0, seeded.stderr);
      const res = spawnSession(dir, p, ["sync"]);
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /^synced \d+ record\(s\) to null in \d+ attempt\(s\)\n$/);
      assert.ok(
        Number(res.stdout.match(/^synced (\d+)/)?.[1] ?? "0") >= 1,
        "seeded sqlite store must drain at least one record",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("selects the files-only store via FOREMAN_SESSION_BACKEND", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-sync-files-"));
    try {
      const filesDir = join(dir, "files-store");
      mkdirSync(filesDir, { recursive: true });
      const sentinel = join(dir, "sentinel.db");
      const filesEnv: NodeJS.ProcessEnv = {
        FOREMAN_SESSION_BACKEND: "files_only",
        FOREMAN_SESSION_DIR: filesDir,
        FOREMAN_SESSION_DB: sentinel,
      };
      const seeded = spawnSession(dir, sentinel, ["fact", "sync-files-seed"], filesEnv);
      assert.equal(seeded.status, 0, seeded.stderr);
      const res = spawnSession(dir, sentinel, ["sync"], filesEnv);
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /^synced \d+ record\(s\) to null in \d+ attempt\(s\)\n$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints the exact empty sync line", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-sync-empty-"));
    try {
      const p = join(dir, "session.db");
      SqliteSessionStore.open(p).close();
      const res = spawnSession(dir, p, ["sync"]);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, "synced 0 record(s) to null in 0 attempt(s)\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints a non-empty sync output shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-sync-nonempty-"));
    try {
      const p = join(dir, "session.db");
      const seeded = spawnSession(dir, p, ["fact", "shape-seed"]);
      assert.equal(seeded.status, 0, seeded.stderr);
      const res = spawnSession(dir, p, [
        "sync",
        "--batch",
        "100",
        "--max-attempts",
        "3",
        "--timeout-ms",
        "5000",
        "--max-batches",
        "100",
      ]);
      assert.equal(res.status, 0, res.stderr);
      assert.match(
        res.stdout,
        /^synced ([1-9]\d*) record\(s\) to null in ([1-9]\d*) attempt\(s\)\n$/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("invalid flags and positionals exit 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-sync-invalid-"));
    try {
      const p = join(dir, "session.db");
      SqliteSessionStore.open(p).close();
      const cases: ReadonlyArray<{ args: readonly string[]; stderr: RegExp }> = [
        { args: ["sync", "positional"], stderr: /accepts no positional/ },
        { args: ["sync", "--batch", "0"], stderr: /--batch/ },
        { args: ["sync", "--batch", "1001"], stderr: /--batch/ },
        { args: ["sync", "--batch", "1.5"], stderr: /--batch/ },
        { args: ["sync", "--max-attempts", "0"], stderr: /--max-attempts/ },
        { args: ["sync", "--max-attempts", "11"], stderr: /--max-attempts/ },
        { args: ["sync", "--timeout-ms", "0"], stderr: /--timeout-ms/ },
        { args: ["sync", "--timeout-ms", "300001"], stderr: /--timeout-ms/ },
        { args: ["sync", "--max-batches", "0"], stderr: /--max-batches/ },
        { args: ["sync", "--max-batches", "10001"], stderr: /--max-batches/ },
        { args: ["sync", "--force"], stderr: /does not accept --force/ },
        { args: ["sync", "--json"], stderr: /does not accept --json/ },
        { args: ["sync", "--format", "text"], stderr: /does not accept --format/ },
        { args: ["sync", "--out", "x"], stderr: /does not accept --out/ },
        { args: ["sync", "--into", "x"], stderr: /does not accept --into/ },
        { args: ["sync", "--note", "n"], stderr: /does not accept --note/ },
        { args: ["sync", "--evidence", "e"], stderr: /does not accept --evidence/ },
        { args: ["sync", "--status", "done"], stderr: /does not accept --status/ },
      ];
      for (const c of cases) {
        const res = spawnSession(dir, p, c.args);
        assert.equal(res.status, 2, `${c.args.join(" ")} exited ${res.status}`);
        assert.match(res.stderr, c.stderr, `${c.args.join(" ")}: ${res.stderr}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("typed drain failure exits 1 via the injectable test seam", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-sync-typed-"));
    const p = join(dir, "session.db");
    SqliteSessionStore.open(p).close();
    const savedArgv = process.argv;
    const savedEnv = process.env["FOREMAN_SESSION_DB"];
    try {
      setSyncTestDeps({
        drain: () =>
          Effect.fail(
            outboxDrainFailure(
              "project_failed",
              "injected failure with secret adapter text",
              {
                projected: 0,
                attempts: 1,
                batches: 0,
              },
            ),
          ),
      });
      process.argv = [process.argv[0]!, process.argv[1]!, "sync"];
      process.env["FOREMAN_SESSION_DB"] = p;
      const stderr = await (async () => {
        let text = "";
        const orig = process.stderr.write;
        process.stderr.write = ((
          chunk: string | Uint8Array,
          ...args: unknown[]
        ) => {
          text +=
            typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
          return Reflect.apply(orig, process.stderr, [chunk, ...args]);
        }) as typeof process.stderr.write;
        try {
          const rc = await Promise.resolve(main());
          assert.equal(rc, 1);
          return text;
        } finally {
          process.stderr.write = orig;
        }
      })();
      assert.match(
        stderr,
        /refusing: sync failed \(project_failed; projected=0 attempts=1 batches=0\)/,
      );
      assert.equal(stderr.includes("secret adapter text"), false);
      assert.equal(stderr.includes("injected failure"), false);
    } finally {
      setSyncTestDeps(undefined);
      process.argv = savedArgv;
      if (savedEnv === undefined) delete process.env["FOREMAN_SESSION_DB"];
      else process.env["FOREMAN_SESSION_DB"] = savedEnv;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("closes the store after sync", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-sync-close-"));
    const p = join(dir, "session.db");
    SqliteSessionStore.open(p).close();
    const savedArgv = process.argv;
    const savedEnv = process.env["FOREMAN_SESSION_DB"];
    let seen: SessionStore | undefined;
    try {
      setSyncTestDeps({
        drain: (store: SessionStore, _index: MemoryIndex) => {
          seen = store;
          return Effect.succeed({
            projected: 0,
            attempts: 0,
            batches: 0,
          } satisfies DrainResult);
        },
      });
      process.argv = [process.argv[0]!, process.argv[1]!, "sync"];
      process.env["FOREMAN_SESSION_DB"] = p;
      const rc = await Promise.resolve(main());
      assert.equal(rc, 0);
      assert.ok(seen, "drain must receive the opened store");
      assert.throws(() => seen!.listOutbox(1));
    } finally {
      setSyncTestDeps(undefined);
      process.argv = savedArgv;
      if (savedEnv === undefined) delete process.env["FOREMAN_SESSION_DB"];
      else process.env["FOREMAN_SESSION_DB"] = savedEnv;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not trigger automatic sidecar refresh on sync", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-sync-norefresh-"));
    try {
      const p = join(dir, "session.db");
      const seeded = spawnSession(dir, p, ["fact", "refresh-seed"]);
      assert.equal(seeded.status, 0, seeded.stderr);
      const sidecar = sidecarPathFor(p);
      assert.equal(existsSync(sidecar), true);
      const before = readFileSync(sidecar);
      const beforeMtime = statSync(sidecar).mtimeMs;
      const res = spawnSession(dir, p, ["sync"]);
      assert.equal(res.status, 0, res.stderr);
      assert.doesNotMatch(res.stderr, /sidecar refreshed/);
      assert.deepEqual(readFileSync(sidecar), before);
      assert.equal(statSync(sidecar).mtimeMs, beforeMtime);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("project commands register one identity across linked worktrees", () => {
  const root = mkdtempSync(join(tmpdir(), "fm-project-cli-"));
  try {
    const repo = join(root, "repo");
    const linked = join(root, "linked");
    const home = join(root, "foreman-home");
    mkdirSync(repo);
    mkdirSync(home, { mode: 0o700 });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Foreman Test"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "foreman@example.invalid"], {
      cwd: repo,
    });
    writeFileSync(join(repo, "marker"), "one\n");
    execFileSync("git", ["add", "marker"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "seed"], { cwd: repo });
    execFileSync("git", ["worktree", "add", "-b", "linked", linked], {
      cwd: repo,
    });
    const db = join(repo, ".foreman", "session.db");
    const env = { FOREMAN_HOME: home };

    const registered = spawnSession(repo, db, ["project", "register"], env);
    assert.equal(registered.status, 0, registered.stderr);
    assert.equal(registered.stderr, "");
    const first = JSON.parse(registered.stdout) as {
      readonly _tag: string;
      readonly project: {
        readonly project_id: string;
        readonly worktree_paths: readonly string[];
      };
    };
    assert.equal(first._tag, "Registered");
    assert.deepEqual(first.project.worktree_paths, [repo]);
    const boundStore = SqliteSessionStore.open(db, { readOnly: true });
    try {
      assert.equal(boundStore.projectId(), first.project.project_id);
    } finally {
      boundStore.close();
    }

    const fromLinked = spawnSession(linked, db, ["project", "register"], env);
    assert.equal(fromLinked.status, 0, fromLinked.stderr);
    const second = JSON.parse(fromLinked.stdout) as typeof first;
    assert.equal(second.project.project_id, first.project.project_id);
    assert.deepEqual(second.project.worktree_paths, [linked, repo].sort());

    const status = spawnSession(linked, db, ["project", "status"], env);
    assert.equal(status.status, 0, status.stderr);
    const statusValue = JSON.parse(status.stdout) as typeof first;
    assert.equal(statusValue.project.project_id, first.project.project_id);

    const listed = spawnSession(repo, db, ["project", "list"], env);
    assert.equal(listed.status, 0, listed.stderr);
    const listValue = JSON.parse(listed.stdout) as {
      readonly projects: readonly unknown[];
    };
    assert.equal(listValue.projects.length, 1);
    assert.equal(existsSync(join(home, "projects.json")), true);
    assert.deepEqual(
      fs.readdirSync(home).sort(),
      ["projects.json"],
      "registration must not create key material",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project command rejects invalid forms without creating registry state", () => {
  const root = mkdtempSync(join(tmpdir(), "fm-project-cli-invalid-"));
  try {
    const repo = join(root, "repo");
    const home = join(root, "foreman-home");
    mkdirSync(repo);
    mkdirSync(home, { mode: 0o700 });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: repo });
    const db = join(repo, ".foreman", "session.db");
    for (const args of [
      ["project"],
      ["project", "unknown"],
      ["project", "register", "extra"],
      ["project", "status", "extra"],
      ["project", "list", "extra"],
    ]) {
      const result = spawnSession(repo, db, args, { FOREMAN_HOME: home });
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
    }
    assert.equal(existsSync(join(home, "projects.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recovery evaluates a registered store in its project, never the caller cwd", () => {
  const root = mkdtempSync(join(tmpdir(), "fm-project-recovery-"));
  try {
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");
    const home = join(root, "foreman-home");
    const storePath = join(root, "stores", "project-a.db");
    mkdirSync(projectA);
    mkdirSync(home, { mode: 0o700 });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: projectA });
    execFileSync("git", ["config", "user.name", "Foreman Test"], {
      cwd: projectA,
    });
    execFileSync("git", ["config", "user.email", "foreman@example.invalid"], {
      cwd: projectA,
    });
    writeFileSync(join(projectA, "tracked.txt"), "base\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: projectA });
    execFileSync("git", ["commit", "-m", "base"], { cwd: projectA });
    execFileSync("git", ["clone", "--quiet", projectA, projectB], { cwd: root });

    const env = { FOREMAN_HOME: home };
    const measured = spawnSession(
      projectA,
      storePath,
      ["measure", "project-a-check", "1", "--scope", "tracked.txt"],
      env,
    );
    assert.equal(measured.status, 0, measured.stderr);
    const registered = spawnSession(projectA, storePath, ["project", "register"], env);
    assert.equal(registered.status, 0, registered.stderr);

    writeFileSync(join(projectA, "tracked.txt"), "changed\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: projectA });
    execFileSync("git", ["commit", "-m", "change measured scope"], {
      cwd: projectA,
    });

    const fromOtherProject = spawnSession(
      projectB,
      storePath,
      ["recover", "--json"],
      env,
    );
    assert.equal(fromOtherProject.status, 0, fromOtherProject.stderr);
    const stale = JSON.parse(fromOtherProject.stdout) as {
      readonly measurements: readonly { readonly validity: string }[];
    };
    assert.equal(stale.measurements[0]?.validity, "stale");

    rmSync(projectA, { recursive: true, force: true });
    const afterDeletion = spawnSession(
      projectB,
      storePath,
      ["recover", "--json"],
      env,
    );
    assert.equal(afterDeletion.status, 0, afterDeletion.stderr);
    const unknown = JSON.parse(afterDeletion.stdout) as {
      readonly measurements: readonly { readonly validity: string }[];
    };
    assert.equal(unknown.measurements[0]?.validity, "unknown");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
