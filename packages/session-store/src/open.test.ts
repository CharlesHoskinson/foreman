import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, describe, it } from "node:test";
import { openSessionStore, openSqliteSessionStore } from "./open.js";
import type { SessionStoreSelection } from "./open.js";
import { SqliteSessionStore } from "./sqlite-store.js";
import { FilesOnlySessionStore } from "./files-only.js";
import { SessionStoreError } from "./failures.js";

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

describe("openSessionStore", () => {
  it("returns SqliteSessionStore when FOREMAN_SESSION_BACKEND is absent and FOREMAN_SESSION_DB is set", () => {
    const root = makeTempDir("ss-open-sqlite-default-");
    const dbPath = join(root, "session.db");
    const store = openSessionStore({
      env: { FOREMAN_SESSION_DB: dbPath },
      prepareSqlite: () => {
        mkdirSync(dirname(dbPath), { recursive: true });
      },
    });
    try {
      assert.ok(store instanceof SqliteSessionStore);
    } finally {
      store.close();
    }
  });

  it("runs the SQLite preparation callback exactly once before open with path and writable access", () => {
    const root = makeTempDir("ss-open-prepare-");
    const dbPath = join(root, "nested", "session.db");
    const calls: Array<{ path: string; access: { readOnly: boolean; allowMigration: boolean } }> =
      [];

    const store = openSessionStore({
      env: { FOREMAN_SESSION_DB: dbPath },
      prepareSqlite: (path, access) => {
        calls.push({ path, access: { ...access } });
        mkdirSync(dirname(path), { recursive: true });
      },
    });
    try {
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.path, dbPath);
      assert.deepEqual(calls[0]?.access, { readOnly: false, allowMigration: true });
      assert.ok(store instanceof SqliteSessionStore);
    } finally {
      store.close();
    }
  });

  it("propagates a thrown prepareSqlite error unchanged and does not open or create the database", () => {
    const root = makeTempDir("ss-open-prepare-fail-");
    const dbPath = join(root, "session.db");
    assert.equal(existsSync(dbPath), false);

    const sentinel = new Error("prepareSqlite refused");
    let prepareCalls = 0;

    assert.throws(
      () =>
        openSessionStore({
          env: { FOREMAN_SESSION_DB: dbPath },
          prepareSqlite: () => {
            prepareCalls += 1;
            throw sentinel;
          },
        }),
      (error: unknown) => error === sentinel,
    );

    assert.equal(prepareCalls, 1);
    assert.equal(existsSync(dbPath), false);
    assert.equal(existsSync(`${dbPath}-journal`), false);
    assert.equal(existsSync(`${dbPath}-wal`), false);
    assert.equal(existsSync(`${dbPath}-shm`), false);
  });

  it("returns FilesOnlySessionStore for files_only and never calls prepareSqlite", () => {
    const root = makeTempDir("ss-open-files-only-");
    let prepareCalls = 0;
    const store = openSessionStore({
      env: {
        FOREMAN_SESSION_BACKEND: "files_only",
        FOREMAN_SESSION_DIR: root,
      },
      prepareSqlite: () => {
        prepareCalls += 1;
      },
    });
    try {
      assert.ok(store instanceof FilesOnlySessionStore);
      assert.equal(prepareCalls, 0);
    } finally {
      store.close();
    }
  });

  it("accepts files and file as trimmed case-insensitive aliases for files_only", () => {
    for (const backend of ["files", "FILE", " Files ", "file", " File "]) {
      const root = makeTempDir("ss-open-alias-");
      let prepareCalls = 0;
      const store = openSessionStore({
        env: {
          FOREMAN_SESSION_BACKEND: backend,
          FOREMAN_SESSION_DIR: root,
        },
        prepareSqlite: () => {
          prepareCalls += 1;
        },
      });
      try {
        assert.ok(
          store instanceof FilesOnlySessionStore,
          `expected FilesOnlySessionStore for backend ${JSON.stringify(backend)}`,
        );
        assert.equal(prepareCalls, 0);
      } finally {
        store.close();
      }
    }
  });

  it("throws backend_misconfiguration for an unknown backend and names accepted values", () => {
    const root = makeTempDir("ss-open-unknown-");
    assert.throws(
      () =>
        openSessionStore({
          env: {
            FOREMAN_SESSION_BACKEND: "postgres",
            FOREMAN_SESSION_DB: join(root, "session.db"),
            FOREMAN_SESSION_DIR: root,
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof SessionStoreError);
        assert.equal(error.failure.reason, "backend_misconfiguration");
        assert.match(error.message, /postgres/);
        assert.match(error.message, /sqlite/);
        assert.match(error.message, /files_only/);
        return true;
      },
    );
  });

  it("throws backend_misconfiguration when selected SQLite backend lacks FOREMAN_SESSION_DB", () => {
    assert.throws(
      () =>
        openSessionStore({
          env: { FOREMAN_SESSION_BACKEND: "sqlite" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof SessionStoreError);
        assert.equal(error.failure.reason, "backend_misconfiguration");
        assert.match(error.message, /FOREMAN_SESSION_DB/);
        return true;
      },
    );
  });

  it("evaluates defaultSqlitePath once for SQLite when FOREMAN_SESSION_DB is missing and notifies onSelected", () => {
    const root = makeTempDir("ss-open-lazy-default-");
    const suppliedPath = join(root, "lazy-session.db");
    let defaultCalls = 0;
    const selections: SessionStoreSelection[] = [];

    const store = openSessionStore({
      env: { FOREMAN_SESSION_BACKEND: "sqlite" },
      defaultSqlitePath: () => {
        defaultCalls += 1;
        return suppliedPath;
      },
      onSelected: (selection) => {
        selections.push(selection);
      },
      prepareSqlite: (path) => {
        mkdirSync(dirname(path), { recursive: true });
      },
    });
    try {
      assert.equal(defaultCalls, 1);
      assert.equal(selections.length, 1);
      assert.deepEqual(selections[0], {
        location: suppliedPath,
        locationKind: "file",
      });
      assert.ok(store instanceof SqliteSessionStore);
    } finally {
      store.close();
    }
  });

  it("never evaluates defaultSqlitePath for files-only and notifies onSelected with the configured directory", () => {
    const root = makeTempDir("ss-open-files-selected-");
    let defaultCalls = 0;
    const selections: SessionStoreSelection[] = [];

    const store = openSessionStore({
      env: {
        FOREMAN_SESSION_BACKEND: "files_only",
        FOREMAN_SESSION_DIR: root,
      },
      defaultSqlitePath: () => {
        defaultCalls += 1;
        return join(root, "must-not-run.db");
      },
      onSelected: (selection) => {
        selections.push(selection);
      },
    });
    try {
      assert.equal(defaultCalls, 0);
      assert.equal(selections.length, 1);
      assert.deepEqual(selections[0], {
        location: root,
        locationKind: "directory",
      });
      assert.ok(store instanceof FilesOnlySessionStore);
    } finally {
      store.close();
    }
  });

  it("still refuses missing FOREMAN_SESSION_DB when neither env nor defaultSqlitePath supplies a nonempty path", () => {
    assert.throws(
      () =>
        openSessionStore({
          env: { FOREMAN_SESSION_BACKEND: "sqlite" },
          defaultSqlitePath: () => "   ",
        }),
      (error: unknown) => {
        assert.ok(error instanceof SessionStoreError);
        assert.equal(error.failure.reason, "backend_misconfiguration");
        assert.match(error.message, /FOREMAN_SESSION_DB/);
        return true;
      },
    );
  });

  it("invokes onSelected before prepareSqlite and open; a thrown notification propagates without creating the path", () => {
    const root = makeTempDir("ss-open-onselected-order-");
    const dbPath = join(root, "nested", "session.db");
    assert.equal(existsSync(dbPath), false);

    const sentinel = new Error("onSelected refused");
    let prepareCalls = 0;
    let selectedCalls = 0;

    assert.throws(
      () =>
        openSessionStore({
          env: { FOREMAN_SESSION_DB: dbPath },
          onSelected: () => {
            selectedCalls += 1;
            throw sentinel;
          },
          prepareSqlite: (path) => {
            prepareCalls += 1;
            mkdirSync(dirname(path), { recursive: true });
          },
        }),
      (error: unknown) => error === sentinel,
    );

    assert.equal(selectedCalls, 1);
    assert.equal(prepareCalls, 0);
    assert.equal(existsSync(dbPath), false);
    assert.equal(existsSync(dirname(dbPath)), false);
    assert.equal(existsSync(`${dbPath}-journal`), false);
    assert.equal(existsSync(`${dbPath}-wal`), false);
    assert.equal(existsSync(`${dbPath}-shm`), false);
  });

  it("throws backend_misconfiguration when selected files-only backend lacks FOREMAN_SESSION_DIR", () => {
    assert.throws(
      () =>
        openSessionStore({
          env: { FOREMAN_SESSION_BACKEND: "files_only" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof SessionStoreError);
        assert.equal(error.failure.reason, "backend_misconfiguration");
        assert.match(error.message, /FOREMAN_SESSION_DIR/);
        return true;
      },
    );
  });

  it("read-only SQLite open fails without creating a nonexistent parent directory", () => {
    const root = makeTempDir("ss-open-ro-sqlite-");
    const missingParent = join(root, "does-not-exist");
    const dbPath = join(missingParent, "session.db");
    assert.equal(existsSync(missingParent), false);
    assert.throws(() =>
      openSessionStore({
        env: { FOREMAN_SESSION_DB: dbPath },
        readOnly: true,
      }),
    );
    assert.equal(existsSync(missingParent), false);
  });

  it("read-only files-only open fails without creating a nonexistent directory", () => {
    const root = makeTempDir("ss-open-ro-files-");
    const missingDir = join(root, "does-not-exist");
    assert.equal(existsSync(missingDir), false);
    assert.throws(() =>
      openSessionStore({
        env: {
          FOREMAN_SESSION_BACKEND: "files_only",
          FOREMAN_SESSION_DIR: missingDir,
        },
        readOnly: true,
      }),
    );
    assert.equal(existsSync(missingDir), false);
  });

  it("passes read-only access flags through the shared SQLite open path", () => {
    const root = makeTempDir("ss-open-ro-access-");
    const dbPath = join(root, "session.db");
    mkdirSync(root, { recursive: true });
    SqliteSessionStore.open(dbPath).close();
    const calls: Array<{ readOnly: boolean; allowMigration: boolean }> = [];
    const store = openSessionStore({
      env: { FOREMAN_SESSION_DB: dbPath },
      readOnly: true,
      prepareSqlite: (_path, access) => {
        calls.push({ ...access });
      },
    });
    try {
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], { readOnly: true, allowMigration: false });
      assert.ok(store instanceof SqliteSessionStore);
    } finally {
      store.close();
    }
  });
});

describe("openSqliteSessionStore", () => {
  it("opens SQLite when both supplied context and process.env select FilesOnly", () => {
    const root = makeTempDir("ss-forced-sqlite-");
    const dbPath = join(root, "forced.db");
    const filesDir = join(root, "files-store");
    mkdirSync(filesDir, { recursive: true });
    const savedBackend = process.env.FOREMAN_SESSION_BACKEND;
    const savedDir = process.env.FOREMAN_SESSION_DIR;
    const savedDb = process.env.FOREMAN_SESSION_DB;
    process.env.FOREMAN_SESSION_BACKEND = "files_only";
    process.env.FOREMAN_SESSION_DIR = filesDir;
    delete process.env.FOREMAN_SESSION_DB;
    try {
      // Context that would select files-only through openSessionStore.
      const filesOnly = openSessionStore({
        env: {
          FOREMAN_SESSION_BACKEND: "files_only",
          FOREMAN_SESSION_DIR: filesDir,
        },
      });
      try {
        assert.ok(filesOnly instanceof FilesOnlySessionStore);
      } finally {
        filesOnly.close();
      }
      const store = openSqliteSessionStore({ path: dbPath });
      try {
        assert.ok(store instanceof SqliteSessionStore);
        assert.equal(existsSync(dbPath), true);
        // Forced SQLite must not create FilesOnly layout beside the SQLite path.
        assert.equal(existsSync(join(dirname(dbPath), "CURRENT")), false);
      } finally {
        store.close();
      }
    } finally {
      if (savedBackend === undefined) delete process.env.FOREMAN_SESSION_BACKEND;
      else process.env.FOREMAN_SESSION_BACKEND = savedBackend;
      if (savedDir === undefined) delete process.env.FOREMAN_SESSION_DIR;
      else process.env.FOREMAN_SESSION_DIR = savedDir;
      if (savedDb === undefined) delete process.env.FOREMAN_SESSION_DB;
      else process.env.FOREMAN_SESSION_DB = savedDb;
    }
  });

  it("calls prepare exactly once before open with both access combinations", () => {
    const root = makeTempDir("ss-forced-prepare-");
    const writablePath = join(root, "writable.db");
    const readablePath = join(root, "readable.db");
    mkdirSync(root, { recursive: true });
    SqliteSessionStore.open(readablePath).close();

    const writableCalls: Array<{ path: string; access: { readOnly: boolean; allowMigration: boolean } }> =
      [];
    const writable = openSqliteSessionStore({
      path: writablePath,
      prepareSqlite: (path, access) => {
        writableCalls.push({ path, access: { ...access } });
        mkdirSync(dirname(path), { recursive: true });
      },
    });
    try {
      assert.equal(writableCalls.length, 1);
      assert.equal(writableCalls[0]?.path, writablePath);
      assert.deepEqual(writableCalls[0]?.access, {
        readOnly: false,
        allowMigration: true,
      });
      assert.ok(writable instanceof SqliteSessionStore);
    } finally {
      writable.close();
    }

    const readonlyCalls: Array<{ path: string; access: { readOnly: boolean; allowMigration: boolean } }> =
      [];
    const readable = openSqliteSessionStore({
      path: readablePath,
      readOnly: true,
      prepareSqlite: (path, access) => {
        readonlyCalls.push({ path, access: { ...access } });
      },
    });
    try {
      assert.equal(readonlyCalls.length, 1);
      assert.equal(readonlyCalls[0]?.path, readablePath);
      assert.deepEqual(readonlyCalls[0]?.access, {
        readOnly: true,
        allowMigration: false,
      });
      assert.ok(readable instanceof SqliteSessionStore);
    } finally {
      readable.close();
    }
  });

  it("leaves no database when prepare throws", () => {
    const root = makeTempDir("ss-forced-prepare-fail-");
    const dbPath = join(root, "session.db");
    assert.equal(existsSync(dbPath), false);
    const sentinel = new Error("forced prepare refused");
    let prepareCalls = 0;
    assert.throws(
      () =>
        openSqliteSessionStore({
          path: dbPath,
          prepareSqlite: () => {
            prepareCalls += 1;
            throw sentinel;
          },
        }),
      (error: unknown) => error === sentinel,
    );
    assert.equal(prepareCalls, 1);
    assert.equal(existsSync(dbPath), false);
    assert.equal(existsSync(`${dbPath}-wal`), false);
    assert.equal(existsSync(`${dbPath}-shm`), false);
  });
});
