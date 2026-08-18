import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  ALL_CASES,
  formatReport,
  runSuite,
  seedFixture,
} from "./contract-suite.js";
import { snapshotsEqual } from "./entities.js";
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
});
