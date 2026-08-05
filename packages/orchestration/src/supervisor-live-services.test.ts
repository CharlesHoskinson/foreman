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
  symlinkSync,
  readdirSync,
  readFileSync,
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

function eventLine(seq: number): string {
  return (
    JSON.stringify({
      seq,
      ts: "2026-08-05T12:00:00Z",
      type: "prompt",
      lane: "lane-a",
      payload: { attempt: 1 },
    }) + "\n"
  );
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

  it("does not follow a symlinked runs/ directory", async () => {
    const { root, cleanup } = tempRoot();
    const outside = mkdtempSync(join(tmpdir(), "sup-runs-out-"));
    try {
      mkdirSync(join(outside, "escaped-run"), { recursive: true });
      symlinkSync(outside, join(root, "runs"));
      const ids = await Effect.runPromise(
        Effect.gen(function* () {
          const d = yield* RunDiscovery;
          return yield* d.listRuns();
        }).pipe(Effect.provide(makeLiveRunDiscovery(root))),
      );
      assert.deepEqual(ids, []);
      // Outside target must not be mutated.
      assert.deepEqual(readdirSync(outside), ["escaped-run"]);
    } finally {
      cleanup();
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("skips a symlinked runs/<runId> child without following", async () => {
    const { root, cleanup } = tempRoot();
    const outside = mkdtempSync(join(tmpdir(), "sup-run-out-"));
    try {
      mkdirSync(join(root, "runs", "real-run"), { recursive: true });
      symlinkSync(outside, join(root, "runs", "link-run"));
      writeFileSync(join(outside, "marker"), "x");
      const ids = await Effect.runPromise(
        Effect.gen(function* () {
          const d = yield* RunDiscovery;
          return yield* d.listRuns();
        }).pipe(Effect.provide(makeLiveRunDiscovery(root))),
      );
      assert.ok(ids.includes(decodeRunId("real-run") as RunId));
      assert.equal(ids.includes(decodeRunId("link-run") as RunId), false);
      assert.equal(readFileSync(join(outside, "marker"), "utf8"), "x");
    } finally {
      cleanup();
      rmSync(outside, { recursive: true, force: true });
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
        eventLine(1),
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
      // Non-CleanEof terminal must be Corrupt (no valid-prefix acceptance).
      assert.equal(corruptish._tag, "Corrupt");
    } finally {
      cleanup();
    }
  });

  it("accepts a valid clean NDJSON log as Ok", async () => {
    const { root, cleanup } = tempRoot();
    try {
      const run = decodeRunId("clean-log") as RunId;
      mkdirSync(join(root, "runs", run), { recursive: true });
      writeFileSync(
        join(root, "runs", run, "events.ndjson"),
        eventLine(1) + eventLine(2) + eventLine(3),
      );
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* TypedJournalReader;
          return yield* r.readRun(run);
        }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
      );
      assert.equal(result._tag, "Ok");
      if (result._tag === "Ok") {
        assert.equal(result.records.length, 3);
        assert.equal(result.records[0]!.event.seq, 1);
        assert.equal(result.records[2]!.event.seq, 3);
      }
    } finally {
      cleanup();
    }
  });

  it("returns Corrupt for torn tail (valid prefix not accepted)", async () => {
    const { root, cleanup } = tempRoot();
    try {
      const run = decodeRunId("torn-tail") as RunId;
      mkdirSync(join(root, "runs", run), { recursive: true });
      // One complete line + torn final JSON without trailing LF.
      const complete = eventLine(1);
      const torn = JSON.stringify({
        seq: 2,
        ts: "2026-08-05T12:00:00Z",
        type: "prompt",
        lane: "lane-a",
        payload: { attempt: 1 },
      }); // no trailing LF
      writeFileSync(
        join(root, "runs", run, "events.ndjson"),
        complete + torn,
      );
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* TypedJournalReader;
          return yield* r.readRun(run);
        }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
      );
      assert.equal(result._tag, "Corrupt");
    } finally {
      cleanup();
    }
  });

  it("returns Corrupt for malformed JSON mid-log", async () => {
    const { root, cleanup } = tempRoot();
    try {
      const run = decodeRunId("bad-json") as RunId;
      mkdirSync(join(root, "runs", run), { recursive: true });
      writeFileSync(
        join(root, "runs", run, "events.ndjson"),
        eventLine(1) + "{not-json\n" + eventLine(3),
      );
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* TypedJournalReader;
          return yield* r.readRun(run);
        }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
      );
      assert.equal(result._tag, "Corrupt");
    } finally {
      cleanup();
    }
  });

  it("returns Corrupt for invalid sequence (duplicate seq)", async () => {
    const { root, cleanup } = tempRoot();
    try {
      const run = decodeRunId("dup-seq") as RunId;
      mkdirSync(join(root, "runs", run), { recursive: true });
      writeFileSync(
        join(root, "runs", run, "events.ndjson"),
        eventLine(1) + eventLine(1),
      );
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* TypedJournalReader;
          return yield* r.readRun(run);
        }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
      );
      assert.equal(result._tag, "Corrupt");
    } finally {
      cleanup();
    }
  });

  it("returns Corrupt for invalid event structure", async () => {
    const { root, cleanup } = tempRoot();
    try {
      const run = decodeRunId("bad-struct") as RunId;
      mkdirSync(join(root, "runs", run), { recursive: true });
      // Valid JSON object but not a StoredEvent (missing required fields).
      writeFileSync(
        join(root, "runs", run, "events.ndjson"),
        JSON.stringify({ seq: 1, hello: "world" }) + "\n",
      );
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* TypedJournalReader;
          return yield* r.readRun(run);
        }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
      );
      assert.equal(result._tag, "Corrupt");
    } finally {
      cleanup();
    }
  });

  it("does not follow a symlinked runs/<runId> for journal reads", async () => {
    const { root, cleanup } = tempRoot();
    const outside = mkdtempSync(join(tmpdir(), "sup-jr-out-"));
    try {
      mkdirSync(join(root, "runs"), { recursive: true });
      writeFileSync(join(outside, "events.ndjson"), eventLine(1));
      const run = decodeRunId("escape-run") as RunId;
      symlinkSync(outside, join(root, "runs", run));
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* TypedJournalReader;
          return yield* r.readRun(run);
        }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
      );
      assert.equal(result._tag, "Corrupt");
      // Outside content untouched.
      assert.equal(
        readFileSync(join(outside, "events.ndjson"), "utf8"),
        eventLine(1),
      );
    } finally {
      cleanup();
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("returns Missing for a missing run without creating paths", async () => {
    const { root, cleanup } = tempRoot();
    try {
      mkdirSync(join(root, "runs"), { recursive: true });
      const run = decodeRunId("absent-run") as RunId;
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* TypedJournalReader;
          return yield* r.readRun(run);
        }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
      );
      assert.equal(result._tag, "Missing");
      assert.equal(existsSync(join(root, "runs", run)), false);
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

  it("does not create .supervise.lock through a symlinked runs/", async () => {
    const { root, cleanup } = tempRoot();
    const outside = mkdtempSync(join(tmpdir(), "sup-lease-runs-"));
    try {
      symlinkSync(outside, join(root, "runs"));
      const run = decodeRunId("lease-escape") as RunId;
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const l = yield* RunLease;
          return yield* l.acquire(run);
        }).pipe(Effect.provide(makeLiveRunLease(root))),
      );
      assert.equal(result._tag, "Busy");
      assert.equal(readdirSync(outside).length, 0);
      assert.equal(
        existsSync(join(outside, String(run), ".supervise.lock")),
        false,
      );
    } finally {
      cleanup();
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("does not create .supervise.lock through a symlinked runs/<runId>", async () => {
    const { root, cleanup } = tempRoot();
    const outside = mkdtempSync(join(tmpdir(), "sup-lease-run-"));
    try {
      mkdirSync(join(root, "runs"), { recursive: true });
      const run = decodeRunId("lease-link") as RunId;
      symlinkSync(outside, join(root, "runs", run));
      writeFileSync(join(outside, "sentinel"), "keep");
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const l = yield* RunLease;
          return yield* l.acquire(run);
        }).pipe(Effect.provide(makeLiveRunLease(root))),
      );
      assert.equal(result._tag, "Busy");
      assert.equal(readFileSync(join(outside, "sentinel"), "utf8"), "keep");
      assert.equal(existsSync(join(outside, ".supervise.lock")), false);
      assert.deepEqual(readdirSync(outside).sort(), ["sentinel"]);
    } finally {
      cleanup();
      rmSync(outside, { recursive: true, force: true });
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
