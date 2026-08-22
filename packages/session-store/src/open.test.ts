import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, describe, it } from "node:test";
import { openSessionStore } from "./open.js";
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
});
