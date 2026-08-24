import assert from "node:assert/strict";
import { fork, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  ALL_CASES,
  formatReport,
  runSuite,
  seedFixture,
} from "./contract-suite.js";
import { emptySnapshot, snapshotsEqual } from "./entities.js";
import { SessionStoreError } from "./failures.js";
import { openFilesOnlyStore } from "./files-only.js";
import { encodeSnapshot } from "./sidecar.js";
import { openMemoryStore } from "./sqlite-store.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "fm-files-only-"));
}

/** Run `fn` with a scratch directory that is always removed. */
function withDir<T>(fn: (dir: string) => T): T {
  const d = tempDir();
  try {
    return fn(d);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

/** Async variant: cleanup waits until `fn` settles. */
async function withDirAsync<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const d = tempDir();
  try {
    return await fn(d);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

describe("SessionStore contract suite (files-only)", () => {
  it("passes every conformance case, suite unchanged", () => {
    const dirs: string[] = [];
    try {
      const report = runSuite(() => {
        const d = tempDir();
        dirs.push(d);
        return openFilesOnlyStore({ dir: d });
      });
      if (!report.ok) assert.fail(formatReport(report));
      assert.equal(report.failed, 0);
      assert.equal(report.results.length, ALL_CASES.length);
    } finally {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("the two implementations agree", () => {
  it("produces a byte-identical sidecar from the same operations", () => {
    withDir((d) => {
      const files = openFilesOnlyStore({ dir: d });
      const sqlite = openMemoryStore();
      try {
        seedFixture(files);
        seedFixture(sqlite);
        assert.equal(
          encodeSnapshot(files.snapshot()),
          encodeSnapshot(sqlite.snapshot()),
          "the two backends diverged on an identical operation sequence",
        );
        assert.ok(snapshotsEqual(files.snapshot(), sqlite.snapshot()));
      } finally {
        files.close();
        sqlite.close();
      }
    });
  });

  it("agrees on which operations are refused, and on the reason", () => {
    // A backend that accepts what the reference refuses is not a second
    // implementation of the same contract. Compare the failure reason, not
    // merely that both threw.
    const probes: ReadonlyArray<{
      readonly name: string;
      readonly run: (s: ReturnType<typeof openMemoryStore>) => void;
    }> = [
      {
        name: "close a non-existent obligation",
        run: (s) => s.closeObligation(9999, "done", "2026-01-01T00:00:00Z"),
      },
      {
        name: "end a non-existent session",
        run: (s) => s.endSession("nope", "2026-01-01T00:00:00Z"),
      },
      {
        name: "retire a measurement onto itself",
        run: (s) => s.retireMeasurement(1, 1, null, "2026-01-01T00:00:00Z"),
      },
      {
        name: "supersede a non-existent fact",
        run: (s) =>
          s.supersedeFact(
            9999,
            {
              statement: "x",
              evidence: null,
              established_ts: "2026-01-01T00:00:00Z",
              session_id: null,
            },
            null,
            "2026-01-01T00:00:00Z",
          ),
      },
      {
        name: "write a non-finite value_num",
        run: (s) =>
          s.addMeasurement({
            metric: "m",
            value: "NaN",
            value_num: Number.NaN,
            command: null,
            measured_ts: "2026-01-01T00:00:00Z",
            measured_sha: null,
            scope_paths: null,
            session_id: null,
          }),
      },
    ];

    for (const probe of probes) {
      const reasons: (string | null)[] = [];
      withDir((d) => {
        const stores = [
          openFilesOnlyStore({ dir: d }),
          openMemoryStore(),
        ] as const;
        try {
          for (const s of stores) {
            seedFixture(s);
            try {
              probe.run(s as never);
              reasons.push(null);
            } catch (e) {
              reasons.push(
                (e as { failure?: { reason?: string } }).failure?.reason ??
                  (e as Error).name,
              );
            }
          }
        } finally {
          for (const s of stores) s.close();
        }
      });
      assert.notEqual(
        reasons[0],
        null,
        `files-only accepted "${probe.name}", which SQLite refuses`,
      );
      assert.equal(
        reasons[0],
        reasons[1],
        `"${probe.name}": files-only refused with ${reasons[0]}, SQLite with ${reasons[1]}`,
      );
    }
  });

  it("does not consume an identity on a refused write", () => {
    withDir((d) => {
      const store = openFilesOnlyStore({ dir: d });
      try {
        const before = store.peekNextId("measurement");
        assert.throws(() =>
          store.addMeasurement({
            metric: "m",
            value: "inf",
            value_num: Number.POSITIVE_INFINITY,
            command: null,
            measured_ts: "2026-01-01T00:00:00Z",
            measured_sha: null,
            scope_paths: null,
            session_id: null,
          }),
        );
        assert.equal(
          store.peekNextId("measurement"),
          before,
          "a refused write minted an id",
        );
      } finally {
        store.close();
      }
    });
  });
});

describe("read-only open", () => {
  it("serves reads, refuses mutations, and leaves store bytes unchanged", () => {
    withDir((d) => {
      const writable = openFilesOnlyStore({ dir: d });
      seedFixture(writable);
      writable.close();

      const currentBefore = readFileSync(join(d, "CURRENT"));
      const genName = currentBefore.toString("utf8").trim();
      const genPath = join(d, "generations", genName);
      const genBodyBefore = readFileSync(genPath);
      const rootListingBefore = readdirSync(d).sort();
      const genListingBefore = readdirSync(join(d, "generations")).sort();

      const ro = openFilesOnlyStore({ dir: d, readOnly: true });
      try {
        assert.equal(encodeSnapshot(ro.snapshot()), genBodyBefore.toString("utf8"));
        assert.ok(ro.listFacts().length > 0);
        assert.throws(
          () =>
            ro.beginSession({
              session_id: "ro-mutation",
              started_ts: "2026-01-01T00:00:00Z",
              start_sha: null,
              note: null,
            }),
          (error: unknown) => {
            assert.ok(error instanceof SessionStoreError);
            assert.equal(error.failure.reason, "invalid_argument");
            assert.match(error.message, /read-only/);
            return true;
          },
        );
      } finally {
        ro.close();
      }

      assert.deepEqual(readFileSync(join(d, "CURRENT")), currentBefore);
      assert.deepEqual(readFileSync(genPath), genBodyBefore);
      assert.deepEqual(readdirSync(d).sort(), rootListingBefore);
      assert.deepEqual(
        readdirSync(join(d, "generations")).sort(),
        genListingBefore,
      );
    });
  });
});

describe("durability", () => {
  it("survives reopening: state is on disk, not in the process", () => {
    withDir((d) => {
      const first = openFilesOnlyStore({ dir: d });
      seedFixture(first);
      const before = encodeSnapshot(first.snapshot());
      first.close();

      const second = openFilesOnlyStore({ dir: d });
      try {
        assert.equal(encodeSnapshot(second.snapshot()), before);
      } finally {
        second.close();
      }
    });
  });

  it("leaves the previous generation live when a write is refused", () => {
    withDir((d) => {
      const store = openFilesOnlyStore({ dir: d });
      try {
        seedFixture(store);
        const before = encodeSnapshot(store.snapshot());
        const currentBefore = readFileSync(join(d, "CURRENT"), "utf8");

        assert.throws(() =>
          store.endSession("does-not-exist", "2026-01-01T00:00:00Z"),
        );

        assert.equal(encodeSnapshot(store.snapshot()), before);
        assert.equal(readFileSync(join(d, "CURRENT"), "utf8"), currentBefore);
      } finally {
        store.close();
      }
    });
  });

  it("names a generation that exists, and CURRENT is what a reopen reads", () => {
    withDir((d) => {
      const store = openFilesOnlyStore({ dir: d });
      seedFixture(store);
      const name = readFileSync(join(d, "CURRENT"), "utf8").trim();
      store.close();

      const body = readFileSync(join(d, "generations", name), "utf8");
      const reopened = openFilesOnlyStore({ dir: d });
      try {
        assert.equal(encodeSnapshot(reopened.snapshot()), body);
      } finally {
        reopened.close();
      }
    });
  });

  it("publishes paired snapshot and outbox generations under the same token", () => {
    withDir((d) => {
      const store = openFilesOnlyStore({ dir: d });
      try {
        store.addFact({
          statement: "paired",
          evidence: null,
          established_ts: "2026-08-08T10:00:00Z",
          session_id: null,
        });
        const name = readFileSync(join(d, "CURRENT"), "utf8").trim();
        assert.match(name, /^v2-\d{8}\.ndjson$/);
        assert.ok(readdirSync(join(d, "generations")).includes(name));
        assert.ok(readdirSync(join(d, "outbox-generations")).includes(name));
        const outbox = JSON.parse(
          readFileSync(join(d, "outbox-generations", name), "utf8"),
        ) as { entries: unknown[] };
        assert.ok(Array.isArray(outbox.entries));
        assert.ok(outbox.entries.length >= 1);
      } finally {
        store.close();
      }
    });
  });

  it("keeps the previous paired generation live when CURRENT has not moved", () => {
    withDir((d) => {
      const store = openFilesOnlyStore({ dir: d });
      store.addFact({
        statement: "live-old",
        evidence: null,
        established_ts: "2026-08-08T10:00:00Z",
        session_id: null,
      });
      const oldName = readFileSync(join(d, "CURRENT"), "utf8").trim();
      const oldSnap = readFileSync(join(d, "generations", oldName), "utf8");
      const oldOutbox = readFileSync(
        join(d, "outbox-generations", oldName),
        "utf8",
      );
      const oldReceipts = store.listOutbox(100).map((e) => e.receipt);
      store.close();

      // Simulate crash after both generation files were written but before
      // CURRENT advanced: new pair exists, old pair remains live.
      const orphan = "v2-99999999.ndjson";
      writeFileSync(join(d, "generations", orphan), encodeSnapshot(emptySnapshot()));
      writeFileSync(
        join(d, "outbox-generations", orphan),
        `${JSON.stringify({ version: 1, nextReceipt: 1, entries: [] })}\n`,
      );

      const reopened = openFilesOnlyStore({ dir: d });
      try {
        assert.equal(readFileSync(join(d, "CURRENT"), "utf8").trim(), oldName);
        assert.equal(encodeSnapshot(reopened.snapshot()), oldSnap);
        assert.deepEqual(
          reopened.listOutbox(100).map((e) => e.receipt),
          oldReceipts,
        );
        assert.equal(
          readFileSync(join(d, "outbox-generations", oldName), "utf8"),
          oldOutbox,
        );
      } finally {
        reopened.close();
      }
    });
  });
});

describe("legacy generation synthesis", () => {
  it("refuses read-only migration and publishes versioned upserts on writable open", () => {
    withDir((d) => {
      const writable = openFilesOnlyStore({ dir: d });
      writable.addFact({
        statement: "legacy-live",
        evidence: "/secret",
        established_ts: "2026-08-08T10:00:00Z",
        session_id: null,
      });
      const snap = encodeSnapshot(writable.snapshot());
      writable.close();

      // Rewrite as a legacy numeric generation with no outbox sidecar.
      const legacy = "00000007.ndjson";
      mkdirSync(join(d, "generations"), { recursive: true });
      writeFileSync(join(d, "generations", legacy), snap);
      writeFileSync(join(d, "CURRENT"), `${legacy}\n`);
      rmSync(join(d, "outbox-generations"), { recursive: true, force: true });

      assert.throws(
        () => openFilesOnlyStore({ dir: d, readOnly: true }),
        /writable migration/,
      );
      assert.equal(
        readdirSync(d).includes("outbox-generations"),
        false,
        "read-only legacy refusal must not create outbox-generations",
      );

      const next = openFilesOnlyStore({ dir: d });
      try {
        const entries = next.listOutbox(100);
        assert.equal(entries.length, 1);
        assert.equal(entries[0]!.record.mutation, "upsert");
        assert.equal(entries[0]!.record.kind, "fact");
        if (entries[0]!.record.mutation === "upsert") {
          assert.equal(entries[0]!.record.text, "legacy-live");
          assert.ok(!entries[0]!.record.text.includes("/secret"));
        }
        next.addFact({
          statement: "makes-paired-durable",
          evidence: null,
          established_ts: "2026-08-08T11:00:00Z",
          session_id: null,
        });
        const name = readFileSync(join(d, "CURRENT"), "utf8").trim();
        assert.match(name, /^v2-\d{8}\.ndjson$/);
        assert.ok(readdirSync(join(d, "outbox-generations")).includes(name));
      } finally {
        next.close();
      }
    });
  });
});

function writePairedOutbox(
  dir: string,
  token: string,
  body: unknown,
): void {
  writeFileSync(
    join(dir, "outbox-generations", token),
    `${JSON.stringify(body)}\n`,
  );
}

describe("paired outbox malformation", () => {
  it("refuses a paired token whose outbox generation is missing", () => {
    withDir((d) => {
      const store = openFilesOnlyStore({ dir: d });
      store.addFact({
        statement: "x",
        evidence: null,
        established_ts: "2026-08-08T10:00:00Z",
        session_id: null,
      });
      const name = readFileSync(join(d, "CURRENT"), "utf8").trim();
      store.close();
      rmSync(join(d, "outbox-generations", name));

      assert.throws(
        () => openFilesOnlyStore({ dir: d, readOnly: true }),
        (error: unknown) => {
          assert.ok(error instanceof SessionStoreError);
          assert.equal(error.failure.reason, "sidecar_malformed");
          return true;
        },
      );
    });
  });

  it("refuses a paired token whose outbox generation is malformed", () => {
    withDir((d) => {
      const store = openFilesOnlyStore({ dir: d });
      store.addFact({
        statement: "x",
        evidence: null,
        established_ts: "2026-08-08T10:00:00Z",
        session_id: null,
      });
      const name = readFileSync(join(d, "CURRENT"), "utf8").trim();
      store.close();
      writeFileSync(join(d, "outbox-generations", name), "not-json\n");

      assert.throws(
        () => openFilesOnlyStore({ dir: d }),
        (error: unknown) => {
          assert.ok(error instanceof SessionStoreError);
          assert.equal(error.failure.reason, "sidecar_malformed");
          return true;
        },
      );
    });
  });

  it("refuses stale nextReceipt equal to a persisted numeric receipt", () => {
    withDir((d) => {
      const store = openFilesOnlyStore({ dir: d });
      store.addFact({
        statement: "x",
        evidence: null,
        established_ts: "2026-08-08T10:00:00Z",
        session_id: null,
      });
      const name = readFileSync(join(d, "CURRENT"), "utf8").trim();
      store.close();
      writePairedOutbox(d, name, {
        version: 1,
        nextReceipt: 1,
        entries: [
          {
            receipt: "r1",
            record: {
              key: "fact:1",
              kind: "fact",
              id: 1,
              mutation: "upsert",
              text: "x",
            },
          },
        ],
      });
      assert.throws(
        () => openFilesOnlyStore({ dir: d }),
        (error: unknown) => {
          assert.ok(error instanceof SessionStoreError);
          assert.equal(error.failure.reason, "sidecar_malformed");
          assert.match(error.message, /nextReceipt/);
          return true;
        },
      );
    });
  });

  it("refuses missing nextReceipt as sidecar_malformed", () => {
    withDir((d) => {
      const store = openFilesOnlyStore({ dir: d });
      store.addFact({
        statement: "x",
        evidence: null,
        established_ts: "2026-08-08T10:00:00Z",
        session_id: null,
      });
      const name = readFileSync(join(d, "CURRENT"), "utf8").trim();
      store.close();
      writePairedOutbox(d, name, {
        version: 1,
        entries: [],
      });
      assert.throws(
        () => openFilesOnlyStore({ dir: d }),
        (error: unknown) => {
          assert.ok(error instanceof SessionStoreError);
          assert.equal(error.failure.reason, "sidecar_malformed");
          return true;
        },
      );
    });
  });

  it("refuses duplicate desired-state identities as sidecar_malformed", () => {
    withDir((d) => {
      const store = openFilesOnlyStore({ dir: d });
      store.addFact({
        statement: "x",
        evidence: null,
        established_ts: "2026-08-08T10:00:00Z",
        session_id: null,
      });
      const name = readFileSync(join(d, "CURRENT"), "utf8").trim();
      store.close();
      writePairedOutbox(d, name, {
        version: 1,
        nextReceipt: 3,
        entries: [
          {
            receipt: "r1",
            record: {
              key: "fact:1",
              kind: "fact",
              id: 1,
              mutation: "upsert",
              text: "a",
            },
          },
          {
            receipt: "r2",
            record: {
              key: "fact:1",
              kind: "fact",
              id: 1,
              mutation: "retract",
            },
          },
        ],
      });
      assert.throws(
        () => openFilesOnlyStore({ dir: d }),
        (error: unknown) => {
          assert.ok(error instanceof SessionStoreError);
          assert.equal(error.failure.reason, "sidecar_malformed");
          assert.match(error.message, /identit/);
          return true;
        },
      );
    });
  });

  it("mints the last safe receipt then refuses further minting without mutating state", () => {
    withDir((d) => {
      const seed = openFilesOnlyStore({ dir: d });
      seed.close();
      const name = readFileSync(join(d, "CURRENT"), "utf8").trim();
      const lastMintable = Number.MAX_SAFE_INTEGER - 1;
      const lastReceipt = `r${lastMintable}`;
      writePairedOutbox(d, name, {
        version: 1,
        nextReceipt: lastMintable,
        entries: [],
      });

      const writer = openFilesOnlyStore({ dir: d });
      try {
        const fact = writer.addFact({
          statement: "last-mint",
          evidence: null,
          established_ts: "2026-08-08T10:00:00Z",
          session_id: null,
        });
        const listed = writer.listOutbox(10);
        assert.equal(listed.length, 1);
        assert.equal(listed[0]?.receipt, lastReceipt);
        assert.equal(listed[0]?.record.id, fact.id);

        const liveName = readFileSync(join(d, "CURRENT"), "utf8").trim();
        const liveOutbox = JSON.parse(
          readFileSync(join(d, "outbox-generations", liveName), "utf8"),
        ) as { nextReceipt: number; entries: Array<{ receipt: string }> };
        assert.equal(liveOutbox.nextReceipt, Number.MAX_SAFE_INTEGER);
        assert.equal(liveOutbox.entries[0]?.receipt, lastReceipt);
      } finally {
        writer.close();
      }

      const reopened = openFilesOnlyStore({ dir: d });
      try {
        const pending = reopened.listOutbox(10);
        assert.equal(pending.length, 1);
        assert.equal(pending[0]?.receipt, lastReceipt);
        assert.equal(reopened.ackOutbox([lastReceipt]), 1);
        assert.equal(reopened.listOutbox(10).length, 0);

        const currentBefore = readFileSync(join(d, "CURRENT"), "utf8");
        const snapBefore = encodeSnapshot(reopened.snapshot());
        const outboxName = currentBefore.trim();
        const outboxBefore = readFileSync(
          join(d, "outbox-generations", outboxName),
        );

        assert.throws(
          () =>
            reopened.addFact({
              statement: "past-exhaustion",
              evidence: null,
              established_ts: "2026-08-08T11:00:00Z",
              session_id: null,
            }),
          (error: unknown) => {
            assert.ok(error instanceof SessionStoreError);
            assert.equal(error.failure.reason, "invalid_argument");
            assert.match(error.message, /exhausted/);
            return true;
          },
        );

        assert.equal(readFileSync(join(d, "CURRENT"), "utf8"), currentBefore);
        assert.equal(encodeSnapshot(reopened.snapshot()), snapBefore);
        assert.deepEqual(
          readFileSync(join(d, "outbox-generations", outboxName)),
          outboxBefore,
        );
        assert.equal(reopened.listOutbox(10).length, 0);
        assert.equal(
          reopened.listFacts().some((f) => f.statement === "past-exhaustion"),
          false,
        );
      } finally {
        reopened.close();
      }
    });
  });
});

describe("writable writer exclusion", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const contenderPath = join(here, "files-only-lock-contender.ts");

  function attachContender(child: ChildProcess): {
    waitFor: (type: string) => Promise<void>;
    stdout: () => string;
    waitForExit: () => Promise<number | null>;
  } {
    const seen = new Set<string>();
    const waiters = new Map<
      string,
      { resolve: () => void; timer: NodeJS.Timeout }
    >();
    let stdout = "";
    let exitCode: number | null | undefined;
    const exitWaiters: Array<(code: number | null) => void> = [];

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("message", (msg: unknown) => {
      const type = (msg as { type?: string } | null)?.type;
      if (!type) return;
      seen.add(type);
      const waiter = waiters.get(type);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiters.delete(type);
        waiter.resolve();
      }
    });
    child.on("exit", (code) => {
      exitCode = code ?? null;
      for (const w of exitWaiters) w(exitCode);
      exitWaiters.length = 0;
    });

    return {
      waitFor(type: string) {
        if (seen.has(type)) return Promise.resolve();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`contender did not report ${type}`)),
            10_000,
          );
          waiters.set(type, {
            resolve: () => {
              clearTimeout(timer);
              resolve();
            },
            timer,
          });
        });
      },
      stdout: () => stdout,
      waitForExit() {
        if (exitCode !== undefined) return Promise.resolve(exitCode);
        return new Promise((resolve) => {
          exitWaiters.push(resolve);
        });
      },
    };
  }

  it("refuses a second live writable open while the first owns the directory", () => {
    withDir((d) => {
      const first = openFilesOnlyStore({ dir: d });
      try {
        assert.throws(
          () => openFilesOnlyStore({ dir: d }),
          (error: unknown) => {
            assert.ok(error instanceof SessionStoreError);
            assert.equal(error.failure.reason, "invalid_argument");
            assert.match(error.message, /owned by another live writable handle/);
            assert.match(error.message, /not a network filesystem lease/);
            return true;
          },
        );
        // Read-only opens remain lock-free.
        const ro = openFilesOnlyStore({ dir: d, readOnly: true });
        try {
          assert.ok(ro.snapshot());
        } finally {
          ro.close();
        }
      } finally {
        first.close();
      }
    });
  });

  it("reclaims a stale writer claim whose owner pid is dead", () => {
    withDir((d) => {
      const first = openFilesOnlyStore({ dir: d });
      first.close();
      // Plant a claim naming a pid that has already exited.
      const dead = spawnSync("/bin/sh", ["-c", "echo $$"], { encoding: "utf8" });
      assert.equal(dead.status, 0);
      const deadPid = Number.parseInt(dead.stdout.trim(), 10);
      assert.ok(Number.isFinite(deadPid));
      const claims = join(d, ".writer-claims");
      mkdirSync(claims, { recursive: true });
      writeFileSync(
        join(claims, "claim-000000000000001-stale.json"),
        `${JSON.stringify({
          pid: deadPid,
          startIdentity: null,
          ownerToken: "stale-token",
        })}\n`,
      );
      const second = openFilesOnlyStore({ dir: d });
      try {
        second.addFact({
          statement: "after-reclaim",
          evidence: null,
          established_ts: "2026-08-08T10:00:00Z",
          session_id: null,
        });
        assert.equal(second.listOutbox(10).length, 1);
      } finally {
        second.close();
      }
    });
  });

  it("two contenders reclaiming a stale owner: exactly one wins", async () => {
    await withDirAsync(async (d) => {
      openFilesOnlyStore({ dir: d }).close();
      const dead = spawnSync("/bin/sh", ["-c", "echo $$"], { encoding: "utf8" });
      assert.equal(dead.status, 0);
      const deadPid = Number.parseInt(dead.stdout.trim(), 10);
      const claims = join(d, ".writer-claims");
      mkdirSync(claims, { recursive: true });
      writeFileSync(
        join(claims, "claim-000000000000001-stale.json"),
        `${JSON.stringify({
          pid: deadPid,
          startIdentity: null,
          ownerToken: "stale-race",
        })}\n`,
      );

      const goPath = join(d, "GO");
      const c1 = fork(contenderPath, [d, goPath], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "inherit", "ipc"],
      });
      const c2 = fork(contenderPath, [d, goPath], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "inherit", "ipc"],
      });
      const a1 = attachContender(c1);
      const a2 = attachContender(c2);
      try {
        await Promise.all([a1.waitFor("ready"), a2.waitFor("ready")]);
        writeFileSync(goPath, "1\n");

        // Exactly one contender must acquire and hold; the other must lose
        // while the winner still owns the claim.
        const firstExit = await Promise.race([
          a1.waitForExit().then((code) => ({ which: "c1" as const, code })),
          a2.waitForExit().then((code) => ({ which: "c2" as const, code })),
        ]);
        assert.equal(firstExit.code, 1, "loser must exit 1");
        const holder = firstExit.which === "c1" ? c2 : c1;
        const holderAttach = firstExit.which === "c1" ? a2 : a1;
        const loserAttach = firstExit.which === "c1" ? a1 : a2;
        assert.equal(loserAttach.stdout().trim(), "LOSE");
        await holderAttach.waitFor("holding");
        assert.equal(holderAttach.stdout().trim(), "WIN");
        holder.send({ type: "release" });
        assert.equal(await holderAttach.waitForExit(), 0);
      } finally {
        c1.kill("SIGKILL");
        c2.kill("SIGKILL");
      }
    });
  });

  it("close deletes only the owned claim, never a foreign claim file", () => {
    withDir((d) => {
      const store = openFilesOnlyStore({ dir: d });
      const claims = join(d, ".writer-claims");
      assert.ok(existsSync(claims));
      const owned = readdirSync(claims).filter((n) => n.startsWith("claim-"));
      assert.equal(owned.length, 1);
      const foreign = "claim-foreign-must-remain.json";
      writeFileSync(
        join(claims, foreign),
        `${JSON.stringify({
          pid: 1,
          startIdentity: "0",
          ownerToken: "foreign",
        })}\n`,
      );
      store.close();
      const after = readdirSync(claims);
      assert.equal(after.includes(owned[0]!), false, "owned claim must be released");
      assert.equal(
        after.includes(foreign),
        true,
        "foreign claim must survive another handle's cleanup",
      );
      // Leave no live foreign claim behind for later opens in this dir.
      rmSync(join(claims, foreign));
    });
  });

  it("releases the writer lock on close so a later open can acquire it", () => {
    withDir((d) => {
      const first = openFilesOnlyStore({ dir: d });
      first.close();
      const second = openFilesOnlyStore({ dir: d });
      try {
        assert.ok(second.snapshot());
      } finally {
        second.close();
      }
    });
  });

  it("releases the writer lock when open fails after acquisition", () => {
    withDir((d) => {
      const ok = openFilesOnlyStore({ dir: d });
      ok.close();
      // Corrupt CURRENT after a valid store exists; open acquires the lock,
      // then fails validation and must release ownership.
      writeFileSync(join(d, "CURRENT"), "\n");
      assert.throws(
        () => openFilesOnlyStore({ dir: d }),
        (error: unknown) => {
          assert.ok(error instanceof SessionStoreError);
          assert.equal(error.failure.reason, "sidecar_malformed");
          return true;
        },
      );
      // Restore a usable CURRENT from the still-present generation files so a
      // subsequent open can prove the lock was released.
      const gens = readdirSync(join(d, "generations"))
        .filter((n) => /^v2-\d{8}\.ndjson$/.test(n))
        .sort();
      assert.ok(gens.length > 0);
      writeFileSync(join(d, "CURRENT"), `${gens[gens.length - 1]!}\n`);
      const recovered = openFilesOnlyStore({ dir: d });
      try {
        assert.ok(recovered.snapshot());
      } finally {
        recovered.close();
      }
    });
  });
});

describe("outbox ack publish", () => {
  it("publishes a reduced outbox generation without changing the snapshot", () => {
    withDir((d) => {
      const store = openFilesOnlyStore({ dir: d });
      try {
        const a = store.addFact({
          statement: "a",
          evidence: null,
          established_ts: "2026-08-08T10:00:00Z",
          session_id: null,
        });
        store.addFact({
          statement: "b",
          evidence: null,
          established_ts: "2026-08-08T10:01:00Z",
          session_id: null,
        });
        const beforeSnap = encodeSnapshot(store.snapshot());
        const beforeName = readFileSync(join(d, "CURRENT"), "utf8").trim();
        const aReceipt = store
          .listOutbox(100)
          .find((e) => e.record.kind === "fact" && e.record.id === a.id)!.receipt;
        assert.equal(store.ackOutbox([aReceipt]), 1);
        const afterName = readFileSync(join(d, "CURRENT"), "utf8").trim();
        assert.notEqual(afterName, beforeName);
        assert.equal(encodeSnapshot(store.snapshot()), beforeSnap);
        assert.equal(
          store.listOutbox(100).some((e) => e.receipt === aReceipt),
          false,
        );
      } finally {
        store.close();
      }
    });
  });
});
