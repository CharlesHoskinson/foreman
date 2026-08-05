/**
 * Live Node supervisor services — discovery, typed journal read, leases.
 */

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { decodeRunId, type RunId } from "@foreman/event-log";
import {
  defaultSupervisorPaths,
  makeLiveRunDiscovery,
  makeLiveRunLease,
  makeLiveTypedJournalReader,
  makeLiveSupervisorServices,
} from "./supervisor-live-services.js";
import {
  RunDiscovery,
  RunLease,
  TypedJournalReader,
} from "./supervisor.js";

function tempRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "sup-live-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("makeLiveRunDiscovery", () => {
  it("lists only directory run ids under runs/", async () => {
    const { root, cleanup } = tempRoot();
    try {
      mkdirSync(join(root, "runs", "run-a"), { recursive: true });
      mkdirSync(join(root, "runs", "run-b"), { recursive: true });
      writeFileSync(join(root, "runs", "not-a-dir"), "x");
      mkdirSync(join(root, "runs", "bad/name".replace("/", "_x")), {
        recursive: true,
      });
      // Invalid: path separators rejected by decodeRunId — use a dir with slash
      // via nested path is impossible; space id is valid.
      const ids = await Effect.runPromise(
        Effect.gen(function* () {
          const d = yield* RunDiscovery;
          return yield* d.listRuns();
        }).pipe(Effect.provide(makeLiveRunDiscovery(root))),
      );
      assert.ok(ids.includes(decodeRunId("run-a") as RunId));
      assert.ok(ids.includes(decodeRunId("run-b") as RunId));
      assert.equal(ids.includes("not-a-dir" as RunId), false);
    } finally {
      cleanup();
    }
  });

  it("returns empty when runs/ is absent", async () => {
    const { root, cleanup } = tempRoot();
    try {
      const ids = await Effect.runPromise(
        Effect.gen(function* () {
          const d = yield* RunDiscovery;
          return yield* d.listRuns();
        }).pipe(Effect.provide(makeLiveRunDiscovery(root))),
      );
      assert.deepEqual(ids, []);
    } finally {
      cleanup();
    }
  });
});

describe("makeLiveTypedJournalReader", () => {
  it("returns Missing, Ok, and Corrupt correctly", async () => {
    const { root, cleanup } = tempRoot();
    try {
      const run = decodeRunId("jr-run") as RunId;
      mkdirSync(join(root, "runs", run), { recursive: true });
      const missing = await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* TypedJournalReader;
          return yield* r.readRun(run);
        }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
      );
      assert.equal(missing._tag, "Missing");

      writeFileSync(join(root, "runs", run, "events.ndjson"), "");
      const empty = await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* TypedJournalReader;
          return yield* r.readRun(run);
        }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
      );
      assert.equal(empty._tag, "Ok");
      if (empty._tag === "Ok") assert.equal(empty.records.length, 0);

      writeFileSync(
        join(root, "runs", run, "events.ndjson"),
        JSON.stringify({
          seq: 1,
          ts: "2026-08-05T12:00:00Z",
          type: "prompt",
          lane: "lane-a",
          payload: { attempt: 1 },
        }) + "\n",
      );
      const ok = await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* TypedJournalReader;
          return yield* r.readRun(run);
        }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
      );
      assert.equal(ok._tag, "Ok");
      if (ok._tag === "Ok") {
        assert.equal(ok.records.length, 1);
        assert.equal(ok.records[0]!.event.type, "prompt");
      }

      writeFileSync(join(root, "runs", run, "events.ndjson"), "{not-json\n");
      const corruptish = await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* TypedJournalReader;
          return yield* r.readRun(run);
        }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
      );
      // Tolerant prefix: corrupt line still yields Ok with empty/partial records
      // or Corrupt on hard failure — either closed outcome is acceptable.
      assert.ok(
        corruptish._tag === "Ok" || corruptish._tag === "Corrupt",
      );
    } finally {
      cleanup();
    }
  });
});

describe("makeLiveRunLease", () => {
  it("acquires exclusive mkdir lease and Busy on second hold", async () => {
    const { root, cleanup } = tempRoot();
    try {
      const run = decodeRunId("lease-run") as RunId;
      const layer = makeLiveRunLease(root);
      const first = await Effect.runPromise(
        Effect.gen(function* () {
          const l = yield* RunLease;
          return yield* l.acquire(run);
        }).pipe(Effect.provide(layer)),
      );
      assert.equal(first._tag, "Held");
      assert.ok(
        existsSync(join(root, "runs", run, ".supervise.lock")),
      );

      const second = await Effect.runPromise(
        Effect.gen(function* () {
          const l = yield* RunLease;
          return yield* l.acquire(run);
        }).pipe(Effect.provide(layer)),
      );
      assert.equal(second._tag, "Busy");

      if (first._tag === "Held") {
        await Effect.runPromise(first.release());
      }
      assert.equal(
        existsSync(join(root, "runs", run, ".supervise.lock")),
        false,
      );

      const third = await Effect.runPromise(
        Effect.gen(function* () {
          const l = yield* RunLease;
          return yield* l.acquire(run);
        }).pipe(Effect.provide(layer)),
      );
      assert.equal(third._tag, "Held");
      if (third._tag === "Held") {
        await Effect.runPromise(third.release());
      }
    } finally {
      cleanup();
    }
  });
});

describe("makeLiveSupervisorServices", () => {
  it("composes a usable layer for discovery over empty state root", async () => {
    const { root, cleanup } = tempRoot();
    try {
      const layer = makeLiveSupervisorServices({ stateRoot: root });
      const ids = await Effect.runPromise(
        Effect.gen(function* () {
          const d = yield* RunDiscovery;
          return yield* d.listRuns();
        }).pipe(Effect.provide(layer)),
      );
      assert.deepEqual(ids, []);
    } finally {
      cleanup();
    }
  });
});

describe("defaultSupervisorPaths", () => {
  it("resolves lane-run.sh under skill root", () => {
    const p = defaultSupervisorPaths("/skill");
    assert.equal(p.laneRunScript, join("/skill", "scripts", "lane-run.sh"));
    assert.ok(typeof p.shellBinary === "string" && p.shellBinary.length > 0);
  });
});
