/**
 * Live Node supervisor services — discovery, typed journal read, leases.
 * Includes deterministic race seams that swap stateRoot, runs/, and
 * runs/<runId> between validation and use to prove descriptor-anchored
 * identity binding.
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
  renameSync,
  lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, afterEach } from "node:test";
import { Effect } from "effect";
import { decodeRunId, type RunId } from "@foreman/event-log";
import {
  defaultSupervisorPaths,
  directoryIdentityAnchorSupported,
  makeLiveRunDiscovery,
  makeLiveRunLease,
  makeLiveTypedJournalReader,
  makeLiveSupervisorServices,
  setDirectoryIdentityRaceHook,
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

const anchorOk = directoryIdentityAnchorSupported();

afterEach(() => {
  setDirectoryIdentityRaceHook(undefined);
});

/**
 * Swap a directory pathname for a symlink to `outside` while the live
 * service still holds a descriptor on the original identity.
 */
function swapPathForSymlink(path: string, outside: string): void {
  const parked = `${path}.parked-identity`;
  renameSync(path, parked);
  symlinkSync(outside, path);
}

describe("makeLiveRunDiscovery", () => {
  it(
    "lists only directory run ids under runs/",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      try {
        mkdirSync(join(root, "runs", "run-a"), { recursive: true });
        mkdirSync(join(root, "runs", "run-b"), { recursive: true });
        writeFileSync(join(root, "runs", "not-a-dir"), "x");
        mkdirSync(join(root, "runs", "bad/name".replace("/", "_x")), {
          recursive: true,
        });
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
    },
  );

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

  it(
    "does not follow a symlinked runs/ directory",
    { skip: !anchorOk },
    async () => {
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
    },
  );

  it(
    "skips a symlinked runs/<runId> child without following",
    { skip: !anchorOk },
    async () => {
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
    },
  );

  it(
    "race seam: swapped runs/ after bind exposes no outside names",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      const outside = mkdtempSync(join(tmpdir(), "sup-race-runs-"));
      try {
        mkdirSync(join(root, "runs", "inside-run"), { recursive: true });
        mkdirSync(join(outside, "escaped-run"), { recursive: true });
        writeFileSync(join(outside, "escaped-run", "marker"), "out");

        setDirectoryIdentityRaceHook({
          afterBindRunsDir: () => {
            swapPathForSymlink(join(root, "runs"), outside);
          },
        });

        const ids = await Effect.runPromise(
          Effect.gen(function* () {
            const d = yield* RunDiscovery;
            return yield* d.listRuns();
          }).pipe(Effect.provide(makeLiveRunDiscovery(root))),
        );

        // Must list only the originally bound runs/ identity.
        assert.ok(ids.includes(decodeRunId("inside-run") as RunId));
        assert.equal(
          ids.includes(decodeRunId("escaped-run") as RunId),
          false,
        );
        // Pathname now points at outside; outside must be untouched.
        assert.ok(lstatSync(join(root, "runs")).isSymbolicLink());
        assert.deepEqual(readdirSync(outside).sort(), ["escaped-run"]);
        assert.equal(
          readFileSync(join(outside, "escaped-run", "marker"), "utf8"),
          "out",
        );
      } finally {
        setDirectoryIdentityRaceHook(undefined);
        cleanup();
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it(
    "race seam: swapped stateRoot before runs open exposes no outside names",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      const outside = mkdtempSync(join(tmpdir(), "sup-race-sr-disc-"));
      const parkedRoot = `${root}.parked-identity`;
      try {
        mkdirSync(join(root, "runs", "inside-run"), { recursive: true });
        mkdirSync(join(outside, "runs", "escaped-run"), { recursive: true });
        writeFileSync(join(outside, "runs", "escaped-run", "marker"), "out");

        setDirectoryIdentityRaceHook({
          afterBindStateRoot: () => {
            swapPathForSymlink(root, outside);
          },
        });

        const ids = await Effect.runPromise(
          Effect.gen(function* () {
            const d = yield* RunDiscovery;
            return yield* d.listRuns();
          }).pipe(Effect.provide(makeLiveRunDiscovery(root))),
        );

        assert.ok(ids.includes(decodeRunId("inside-run") as RunId));
        assert.equal(
          ids.includes(decodeRunId("escaped-run") as RunId),
          false,
        );
        assert.ok(lstatSync(root).isSymbolicLink());
        assert.equal(
          readFileSync(join(outside, "runs", "escaped-run", "marker"), "utf8"),
          "out",
        );
        assert.ok(existsSync(join(parkedRoot, "runs", "inside-run")));
      } finally {
        setDirectoryIdentityRaceHook(undefined);
        cleanup();
        rmSync(parkedRoot, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it(
    "fail-closed when directory anchor is unsupported",
    { skip: anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      try {
        mkdirSync(join(root, "runs", "run-a"), { recursive: true });
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
    },
  );
});

describe("makeLiveTypedJournalReader", () => {
  it(
    "returns Missing, Ok, and Corrupt correctly",
    { skip: !anchorOk },
    async () => {
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
    },
  );

  it(
    "accepts a valid clean NDJSON log as Ok",
    { skip: !anchorOk },
    async () => {
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
    },
  );

  it(
    "returns Corrupt for torn tail (valid prefix not accepted)",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      try {
        const run = decodeRunId("torn-tail") as RunId;
        mkdirSync(join(root, "runs", run), { recursive: true });
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
    },
  );

  it(
    "returns Corrupt for malformed JSON mid-log",
    { skip: !anchorOk },
    async () => {
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
    },
  );

  it(
    "returns Corrupt for invalid sequence (duplicate seq)",
    { skip: !anchorOk },
    async () => {
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
    },
  );

  it(
    "returns Corrupt for invalid event structure",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      try {
        const run = decodeRunId("bad-struct") as RunId;
        mkdirSync(join(root, "runs", run), { recursive: true });
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
    },
  );

  it(
    "does not follow a symlinked runs/<runId> for journal reads",
    { skip: !anchorOk },
    async () => {
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
    },
  );

  it(
    "returns Missing for a missing run without creating paths",
    { skip: !anchorOk },
    async () => {
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
    },
  );

  it(
    "race seam: swapped runs/<runId> after bind returns no outside records",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      const outside = mkdtempSync(join(tmpdir(), "sup-race-jr-"));
      try {
        const run = decodeRunId("race-jr") as RunId;
        mkdirSync(join(root, "runs", run), { recursive: true });
        writeFileSync(
          join(root, "runs", run, "events.ndjson"),
          eventLine(1),
        );
        // Outside journal the attack would want us to read.
        writeFileSync(
          join(outside, "events.ndjson"),
          eventLine(99) + eventLine(100),
        );

        setDirectoryIdentityRaceHook({
          afterBindRunDir: () => {
            swapPathForSymlink(join(root, "runs", String(run)), outside);
          },
        });

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* TypedJournalReader;
            return yield* r.readRun(run);
          }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
        );

        // Still reads the originally bound run directory (seq 1 only).
        assert.equal(result._tag, "Ok");
        if (result._tag === "Ok") {
          assert.equal(result.records.length, 1);
          assert.equal(result.records[0]!.event.seq, 1);
        }
        // Outside journal untouched; pathname is now the symlink.
        assert.ok(lstatSync(join(root, "runs", String(run))).isSymbolicLink());
        assert.equal(
          readFileSync(join(outside, "events.ndjson"), "utf8"),
          eventLine(99) + eventLine(100),
        );
      } finally {
        setDirectoryIdentityRaceHook(undefined);
        cleanup();
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it(
    "race seam: swapped runs/ after bind returns no outside records",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      const outside = mkdtempSync(join(tmpdir(), "sup-race-jr-runs-"));
      try {
        const run = decodeRunId("race-jr-runs") as RunId;
        mkdirSync(join(root, "runs", run), { recursive: true });
        writeFileSync(
          join(root, "runs", run, "events.ndjson"),
          eventLine(7),
        );
        mkdirSync(join(outside, String(run)), { recursive: true });
        writeFileSync(
          join(outside, String(run), "events.ndjson"),
          eventLine(88),
        );

        setDirectoryIdentityRaceHook({
          afterBindRunsDir: () => {
            swapPathForSymlink(join(root, "runs"), outside);
          },
        });

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* TypedJournalReader;
            return yield* r.readRun(run);
          }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
        );

        assert.equal(result._tag, "Ok");
        if (result._tag === "Ok") {
          assert.equal(result.records.length, 1);
          assert.equal(result.records[0]!.event.seq, 7);
        }
        assert.equal(
          readFileSync(join(outside, String(run), "events.ndjson"), "utf8"),
          eventLine(88),
        );
      } finally {
        setDirectoryIdentityRaceHook(undefined);
        cleanup();
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it(
    "race seam: swapped stateRoot before runs open returns no outside records",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      const outside = mkdtempSync(join(tmpdir(), "sup-race-sr-jr-"));
      const parkedRoot = `${root}.parked-identity`;
      try {
        const run = decodeRunId("race-sr-jr") as RunId;
        mkdirSync(join(root, "runs", run), { recursive: true });
        writeFileSync(
          join(root, "runs", run, "events.ndjson"),
          eventLine(3),
        );
        mkdirSync(join(outside, "runs", String(run)), { recursive: true });
        writeFileSync(
          join(outside, "runs", String(run), "events.ndjson"),
          eventLine(77) + eventLine(78),
        );

        setDirectoryIdentityRaceHook({
          afterBindStateRoot: () => {
            swapPathForSymlink(root, outside);
          },
        });

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const r = yield* TypedJournalReader;
            return yield* r.readRun(run);
          }).pipe(Effect.provide(makeLiveTypedJournalReader(root))),
        );

        assert.equal(result._tag, "Ok");
        if (result._tag === "Ok") {
          assert.equal(result.records.length, 1);
          assert.equal(result.records[0]!.event.seq, 3);
        }
        assert.ok(lstatSync(root).isSymbolicLink());
        assert.equal(
          readFileSync(
            join(outside, "runs", String(run), "events.ndjson"),
            "utf8",
          ),
          eventLine(77) + eventLine(78),
        );
      } finally {
        setDirectoryIdentityRaceHook(undefined);
        cleanup();
        rmSync(parkedRoot, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it(
    "fail-closed Corrupt when directory anchor is unsupported",
    { skip: anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      try {
        const run = decodeRunId("no-anchor") as RunId;
        mkdirSync(join(root, "runs", run), { recursive: true });
        writeFileSync(
          join(root, "runs", run, "events.ndjson"),
          eventLine(1),
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
    },
  );
});

describe("makeLiveRunLease", () => {
  it(
    "acquires exclusive mkdir lease and Busy on second hold",
    { skip: !anchorOk },
    async () => {
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
    },
  );

  it(
    "does not create .supervise.lock through a symlinked runs/",
    { skip: !anchorOk },
    async () => {
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
    },
  );

  it(
    "does not create .supervise.lock through a symlinked runs/<runId>",
    { skip: !anchorOk },
    async () => {
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
    },
  );

  it(
    "race seam: swapped runs/<runId> after bind creates no outside lock",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      const outside = mkdtempSync(join(tmpdir(), "sup-race-lease-"));
      try {
        const run = decodeRunId("race-lease") as RunId;
        mkdirSync(join(root, "runs", run), { recursive: true });
        writeFileSync(join(outside, "sentinel"), "keep");

        setDirectoryIdentityRaceHook({
          afterBindRunDir: () => {
            swapPathForSymlink(join(root, "runs", String(run)), outside);
          },
        });

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const l = yield* RunLease;
            return yield* l.acquire(run);
          }).pipe(Effect.provide(makeLiveRunLease(root))),
        );

        assert.equal(result._tag, "Held");
        // Lock lives under the original (parked) identity, not outside.
        assert.equal(existsSync(join(outside, ".supervise.lock")), false);
        assert.equal(readFileSync(join(outside, "sentinel"), "utf8"), "keep");
        assert.deepEqual(readdirSync(outside).sort(), ["sentinel"]);
        // Original directory (renamed aside) holds the lock.
        const parked = join(root, "runs", `${String(run)}.parked-identity`);
        assert.ok(existsSync(join(parked, ".supervise.lock")));

        if (result._tag === "Held") {
          await Effect.runPromise(result.release());
        }
        // Release removes only the original lock, never outside.
        assert.equal(existsSync(join(parked, ".supervise.lock")), false);
        assert.equal(existsSync(join(outside, ".supervise.lock")), false);
        assert.deepEqual(readdirSync(outside).sort(), ["sentinel"]);
      } finally {
        setDirectoryIdentityRaceHook(undefined);
        cleanup();
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it(
    "race seam: swapped runs/ after bind creates no outside lock",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      const outside = mkdtempSync(join(tmpdir(), "sup-race-lease-runs-"));
      try {
        const run = decodeRunId("race-lease-runs") as RunId;
        mkdirSync(join(root, "runs", run), { recursive: true });

        setDirectoryIdentityRaceHook({
          afterBindRunsDir: () => {
            swapPathForSymlink(join(root, "runs"), outside);
          },
        });

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const l = yield* RunLease;
            return yield* l.acquire(run);
          }).pipe(Effect.provide(makeLiveRunLease(root))),
        );

        assert.equal(result._tag, "Held");
        assert.equal(
          existsSync(join(outside, String(run), ".supervise.lock")),
          false,
        );
        // Lock under parked original runs/.
        const parkedRuns = join(root, "runs.parked-identity");
        assert.ok(
          existsSync(join(parkedRuns, String(run), ".supervise.lock")),
        );

        if (result._tag === "Held") {
          await Effect.runPromise(result.release());
        }
        assert.equal(
          existsSync(join(parkedRuns, String(run), ".supervise.lock")),
          false,
        );
        assert.equal(
          existsSync(join(outside, String(run), ".supervise.lock")),
          false,
        );
      } finally {
        setDirectoryIdentityRaceHook(undefined);
        cleanup();
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it(
    "race seam: release after run-dir swap removes no outside directory",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      const outside = mkdtempSync(join(tmpdir(), "sup-race-rel-"));
      try {
        const run = decodeRunId("race-rel") as RunId;
        mkdirSync(join(root, "runs", run), { recursive: true });

        // Acquire without race.
        const held = await Effect.runPromise(
          Effect.gen(function* () {
            const l = yield* RunLease;
            return yield* l.acquire(run);
          }).pipe(Effect.provide(makeLiveRunLease(root))),
        );
        assert.equal(held._tag, "Held");
        assert.ok(
          existsSync(join(root, "runs", run, ".supervise.lock")),
        );

        // Plant a fake lock outside, then swap the run path to outside.
        mkdirSync(join(outside, ".supervise.lock"), { recursive: true });
        writeFileSync(join(outside, "keep-me"), "x");
        swapPathForSymlink(join(root, "runs", String(run)), outside);

        if (held._tag === "Held") {
          await Effect.runPromise(held.release());
        }

        // Outside fake lock and payload must remain.
        assert.ok(existsSync(join(outside, ".supervise.lock")));
        assert.equal(readFileSync(join(outside, "keep-me"), "utf8"), "x");
        // Original lock under parked identity is gone.
        const parked = join(root, "runs", `${String(run)}.parked-identity`);
        assert.equal(existsSync(join(parked, ".supervise.lock")), false);
      } finally {
        cleanup();
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it(
    "race seam: swapped stateRoot before runs open creates no outside lock",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      const outside = mkdtempSync(join(tmpdir(), "sup-race-sr-lease-"));
      const parkedRoot = `${root}.parked-identity`;
      try {
        const run = decodeRunId("race-sr-lease") as RunId;
        mkdirSync(join(root, "runs", run), { recursive: true });
        mkdirSync(join(outside, "runs", String(run)), { recursive: true });
        writeFileSync(join(outside, "runs", String(run), "sentinel"), "keep");

        setDirectoryIdentityRaceHook({
          afterBindStateRoot: () => {
            swapPathForSymlink(root, outside);
          },
        });

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const l = yield* RunLease;
            return yield* l.acquire(run);
          }).pipe(Effect.provide(makeLiveRunLease(root))),
        );

        assert.equal(result._tag, "Held");
        assert.equal(
          existsSync(join(outside, "runs", String(run), ".supervise.lock")),
          false,
        );
        assert.equal(
          readFileSync(
            join(outside, "runs", String(run), "sentinel"),
            "utf8",
          ),
          "keep",
        );
        assert.ok(
          existsSync(join(parkedRoot, "runs", String(run), ".supervise.lock")),
        );

        if (result._tag === "Held") {
          await Effect.runPromise(result.release());
        }
        assert.equal(
          existsSync(join(parkedRoot, "runs", String(run), ".supervise.lock")),
          false,
        );
        assert.equal(
          existsSync(join(outside, "runs", String(run), ".supervise.lock")),
          false,
        );
      } finally {
        setDirectoryIdentityRaceHook(undefined);
        cleanup();
        rmSync(parkedRoot, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it(
    "race seam: swapped stateRoot before runs create creates no outside runs/",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      const outside = mkdtempSync(join(tmpdir(), "sup-race-sr-mk-"));
      const parkedRoot = `${root}.parked-identity`;
      try {
        // No runs/ under stateRoot yet. Outside stays empty of runs/.
        writeFileSync(join(outside, "outside-marker"), "keep");
        const run = decodeRunId("race-sr-mk") as RunId;

        setDirectoryIdentityRaceHook({
          afterBindStateRoot: () => {
            swapPathForSymlink(root, outside);
          },
        });

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const l = yield* RunLease;
            return yield* l.acquire(run);
          }).pipe(Effect.provide(makeLiveRunLease(root))),
        );

        assert.equal(result._tag, "Held");
        // Outside must not gain runs/ or a lock.
        assert.equal(existsSync(join(outside, "runs")), false);
        assert.equal(existsSync(join(outside, "outside-marker")), true);
        assert.deepEqual(readdirSync(outside).sort(), ["outside-marker"]);
        // runs/ and lock created under the originally bound identity.
        assert.ok(
          existsSync(join(parkedRoot, "runs", String(run), ".supervise.lock")),
        );

        if (result._tag === "Held") {
          await Effect.runPromise(result.release());
        }
        assert.equal(
          existsSync(join(parkedRoot, "runs", String(run), ".supervise.lock")),
          false,
        );
        assert.equal(existsSync(join(outside, "runs")), false);
      } finally {
        setDirectoryIdentityRaceHook(undefined);
        cleanup();
        rmSync(parkedRoot, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it(
    "race seam: release after stateRoot swap removes no outside directory",
    { skip: !anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      const outside = mkdtempSync(join(tmpdir(), "sup-race-sr-rel-"));
      const parkedRoot = `${root}.parked-identity`;
      try {
        const run = decodeRunId("race-sr-rel") as RunId;
        mkdirSync(join(root, "runs", run), { recursive: true });

        const held = await Effect.runPromise(
          Effect.gen(function* () {
            const l = yield* RunLease;
            return yield* l.acquire(run);
          }).pipe(Effect.provide(makeLiveRunLease(root))),
        );
        assert.equal(held._tag, "Held");
        assert.ok(
          existsSync(join(root, "runs", run, ".supervise.lock")),
        );

        // Fake lock tree outside; swap entire stateRoot alias.
        mkdirSync(join(outside, "runs", String(run), ".supervise.lock"), {
          recursive: true,
        });
        writeFileSync(join(outside, "runs", String(run), "keep-me"), "x");
        swapPathForSymlink(root, outside);

        if (held._tag === "Held") {
          await Effect.runPromise(held.release());
        }

        assert.ok(
          existsSync(join(outside, "runs", String(run), ".supervise.lock")),
        );
        assert.equal(
          readFileSync(join(outside, "runs", String(run), "keep-me"), "utf8"),
          "x",
        );
        assert.equal(
          existsSync(join(parkedRoot, "runs", String(run), ".supervise.lock")),
          false,
        );
      } finally {
        cleanup();
        rmSync(parkedRoot, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it(
    "fail-closed Busy when directory anchor is unsupported",
    { skip: anchorOk },
    async () => {
      const { root, cleanup } = tempRoot();
      try {
        const run = decodeRunId("no-anchor-lease") as RunId;
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const l = yield* RunLease;
            return yield* l.acquire(run);
          }).pipe(Effect.provide(makeLiveRunLease(root))),
        );
        assert.equal(result._tag, "Busy");
        assert.equal(existsSync(join(root, "runs")), false);
      } finally {
        cleanup();
      }
    },
  );
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

describe("directoryIdentityAnchorSupported", () => {
  it("reports a boolean without throwing", () => {
    assert.equal(typeof directoryIdentityAnchorSupported(), "boolean");
  });
});
