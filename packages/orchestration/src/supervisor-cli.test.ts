/**
 * lane-supervise CLI parse, exit classes, dry-run injection (R5D).
 */

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import {
  decodeAttemptId,
  decodeLaneId,
  decodeRunId,
  makeAttemptIdentity,
  resumeAttemptFailure,
  RunJournal,
  type AttemptId,
  type LaneId,
  type ReplayRecord,
  type RunId,
  type StoredEvent,
} from "@foreman/event-log";
import { absentReportSnapshot, type RoundPlanV1 } from "./round-contract.js";
import { makeStubWorktreeRestore } from "./resume-worktree-restore.js";
import { makeStubQueueSubmitter } from "./resume-queue-execution.js";
import {
  ResumeLockProbe,
  ResumeProcessProbe,
} from "./resume-safety-services.js";
import {
  RunDiscovery,
  RunLease,
  TypedJournalReader,
} from "./supervisor.js";
import {
  EXIT_CONFIG,
  EXIT_FAIL,
  EXIT_OK,
  MSG_INVALID_ARGUMENTS,
  parseSupervisorArgv,
  runSupervisorCli,
  stripSupervisorNodeArgv,
  USAGE,
} from "./supervisor-cli.js";

const runId = decodeRunId("cli-run") as RunId;
const laneId = decodeLaneId("cli-lane") as LaneId;
const attemptId = decodeAttemptId(1) as AttemptId;
const identity = makeAttemptIdentity(runId, laneId, attemptId);
const commit = "c".repeat(40);

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      writeStdout: (t: string) => {
        stdout += t;
      },
      writeStderr: (t: string) => {
        stderr += t;
      },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

function plan(): RoundPlanV1 {
  return {
    schemaVersion: 1,
    runId,
    laneId,
    attemptId,
    mode: "round",
    commandArgv: ["impl"],
    gateCommand: "true",
    reportPath: "/r.md",
    reportBaseline: absentReportSnapshot(),
  };
}

function recoverableRecords(worktree: string): readonly ReplayRecord[] {
  const p = plan();
  const events: StoredEvent[] = [
    {
      seq: 1,
      ts: "2026-08-05T12:00:00Z",
      type: "prompt",
      lane: String(laneId),
      payload: { attempt: attemptId, roundPlan: p },
    },
    {
      seq: 2,
      ts: "2026-08-05T12:00:01Z",
      type: "checkpoint",
      lane: String(laneId),
      commit,
      payload: { attempt: attemptId },
    },
    {
      seq: 3,
      ts: "2026-08-05T12:00:02Z",
      type: "ownership",
      lane: String(laneId),
      payload: {
        attempt: attemptId,
        launcher_pid: null,
        worktree,
      },
    },
  ];
  return events.map((event) => ({
    event,
    physicalLine: event.seq,
  }));
}

function stubServices(opts: {
  readonly records?: readonly ReplayRecord[];
  readonly busy?: boolean;
  readonly reserveCalls?: string[];
  readonly failReserve?: boolean;
}) {
  const records = opts.records ?? [];
  return Layer.mergeAll(
    Layer.succeed(RunDiscovery, {
      listRuns: () => Effect.succeed([runId]),
    }),
    Layer.succeed(TypedJournalReader, {
      readRun: () =>
        Effect.succeed({
          _tag: "Ok" as const,
          records,
        }),
    }),
    Layer.succeed(RunLease, {
      acquire: () =>
        Effect.succeed(
          opts.busy
            ? { _tag: "Busy" as const }
            : {
                _tag: "Held" as const,
                release: () => Effect.void,
              },
        ),
    }),
    Layer.succeed(ResumeProcessProbe, {
      observe: () => Effect.succeed("inactive" as const),
    }),
    Layer.succeed(ResumeLockProbe, {
      observe: () => Effect.succeed("free" as const),
    }),
    makeStubWorktreeRestore({
      inspect: () =>
        Effect.succeed({
          worktreeRoot: "/abs/wt",
          rootIdentityKey: "k",
          checkpointIdentity: {
            attemptIdentity: identity,
            commit,
          },
        }),
      restore: () =>
        Effect.succeed({
          worktreeRoot: "/abs/wt",
          checkpointIdentity: {
            attemptIdentity: identity,
            commit,
          },
        }),
    }),
    Layer.succeed(RunJournal, {
      allocate: () => Effect.die("unused"),
      append: () => Effect.die("unused"),
      reserveResumeAttempt: () => {
        opts.reserveCalls?.push("reserve");
        if (opts.failReserve === true) {
          return Effect.fail(resumeAttemptFailure("attempt_not_current"));
        }
        return Effect.succeed({
          attemptIdentity: identity,
          event: {
            seq: 9,
            ts: "2026-08-05T12:00:09Z",
            type: "resume_attempt",
            lane: String(laneId),
            payload: { attempt: attemptId, resumeCount: 1 },
          },
          resumeCount: 1,
        });
      },
    }),
    makeStubQueueSubmitter({
      submit: (_g, commandArgv) =>
        Effect.succeed({ _tag: "Ready", commandArgv }),
    }),
  );
}

describe("stripSupervisorNodeArgv / parseSupervisorArgv", () => {
  it("strips node and script path", () => {
    assert.deepEqual(
      stripSupervisorNodeArgv([
        "/usr/bin/node",
        "lane-supervise.js",
        "--all",
      ]),
      ["--all"],
    );
  });

  it("accepts fixed grammar with dry-run and once/all", () => {
    const once = parseSupervisorArgv([
      "node",
      "lane-supervise.js",
      "--state-root",
      "/s",
      "--dry-run",
      "--once",
      "run1",
    ]);
    assert.equal(once._tag, "Ok");
    if (once._tag === "Ok") {
      assert.equal(once.stateRoot, "/s");
      assert.equal(once.dryRun, true);
      assert.equal(once.mode._tag, "Once");
      if (once.mode._tag === "Once") assert.equal(once.mode.runId, "run1");
    }

    const all = parseSupervisorArgv([
      "--state-root",
      "/s",
      "--all",
    ]);
    assert.equal(all._tag, "Ok");
    if (all._tag === "Ok") {
      assert.equal(all.mode._tag, "All");
      assert.equal(all.dryRun, false);
    }
  });

  it("rejects missing mode, missing root, unknown flags, and path-separator run ids", () => {
    assert.equal(parseSupervisorArgv([])._tag, "Invalid");
    assert.equal(parseSupervisorArgv(["--all"])._tag, "Invalid");
    assert.equal(
      parseSupervisorArgv(["--state-root", "/s"])._tag,
      "Invalid",
    );
    assert.equal(
      parseSupervisorArgv(["--state-root", "/s", "--bogus"])._tag,
      "Invalid",
    );
    assert.equal(
      parseSupervisorArgv(["--state-root", "/s", "--once"])._tag,
      "Invalid",
    );
    assert.equal(
      parseSupervisorArgv([
        "--state-root",
        "/s",
        "--once",
        "bad/run",
      ])._tag,
      "Invalid",
    );
    assert.equal(
      parseSupervisorArgv([
        "--state-root",
        "/s",
        "--once",
        "a",
        "--all",
      ])._tag,
      "Invalid",
    );
  });
});

describe("runSupervisorCli", () => {
  it("usage errors exit 2 with USAGE on stderr", async () => {
    const cap = captureIo();
    const code = await Effect.runPromise(
      runSupervisorCli([], cap.io),
    );
    assert.equal(code, EXIT_CONFIG);
    assert.match(cap.stderr, new RegExp(USAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("rejects non-directory state root with exit 2", async () => {
    const { root, cleanup } = (() => {
      const r = mkdtempSync(join(tmpdir(), "cli-sr-"));
      return { root: r, cleanup: () => rmSync(r, { recursive: true, force: true }) };
    })();
    try {
      const file = join(root, "notdir");
      writeFileSync(file, "x");
      const cap = captureIo();
      const code = await Effect.runPromise(
        runSupervisorCli(
          ["--state-root", file, "--all"],
          cap.io,
        ),
      );
      assert.equal(code, EXIT_CONFIG);
      assert.match(cap.stderr, new RegExp(MSG_INVALID_ARGUMENTS));
    } finally {
      cleanup();
    }
  });

  it("busy lease exits 1", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "cli-busy-"));
    try {
      const cap = captureIo();
      const layer = stubServices({ busy: true });
      const code = await Effect.runPromise(
        runSupervisorCli(
          ["--state-root", stateRoot, "--once", String(runId)],
          cap.io,
          {
            provideServices: (e) =>
              e.pipe(Effect.provide(layer)) as Effect.Effect<
                readonly import("./supervisor.js").SupervisorRunResultV1[]
              >,
          },
        ),
      );
      assert.equal(code, EXIT_FAIL);
      assert.match(cap.stderr, /\.supervise\.lock held/);
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it("dry-run plans without reservation", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "cli-dry-"));
    try {
      const reserveCalls: string[] = [];
      const layer = stubServices({
        records: recoverableRecords("/abs/wt"),
        reserveCalls,
      });
      const cap = captureIo();
      const code = await Effect.runPromise(
        runSupervisorCli(
          [
            "--state-root",
            stateRoot,
            "--dry-run",
            "--once",
            String(runId),
          ],
          cap.io,
          {
            shellBinary: "bash",
            laneRunScript: "/s/lane-run.sh",
            provideServices: (e) =>
              e.pipe(Effect.provide(layer)) as Effect.Effect<
                readonly import("./supervisor.js").SupervisorRunResultV1[]
              >,
          },
        ),
      );
      assert.equal(code, EXIT_OK);
      assert.match(cap.stderr, /\[dry-run\]/);
      assert.deepEqual(reserveCalls, []);
      assert.equal(cap.stdout, "");
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it("Ready submission prints JSON argv on stdout", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "cli-ready-"));
    try {
      const layer = stubServices({
        records: recoverableRecords("/abs/wt"),
      });
      const cap = captureIo();
      const code = await Effect.runPromise(
        runSupervisorCli(
          ["--state-root", stateRoot, "--once", String(runId)],
          cap.io,
          {
            shellBinary: "bash",
            laneRunScript: "/s/lane-run.sh",
            provideServices: (e) =>
              e.pipe(Effect.provide(layer)) as Effect.Effect<
                readonly import("./supervisor.js").SupervisorRunResultV1[]
              >,
          },
        ),
      );
      assert.equal(code, EXIT_OK);
      assert.match(cap.stderr, /ready-to-run|resumed/);
      const line = cap.stdout.trim();
      assert.ok(line.length > 0);
      const parsed = JSON.parse(line) as string[];
      assert.ok(Array.isArray(parsed));
      assert.ok(parsed.includes("--round"));
      assert.ok(parsed.includes("impl"));
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it("live path: empty runs dir --all exits 0", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "cli-live-"));
    try {
      mkdirSync(join(stateRoot, "runs"), { recursive: true });
      const cap = captureIo();
      const code = await Effect.runPromise(
        runSupervisorCli(
          ["--state-root", stateRoot, "--all"],
          cap.io,
          {
            skillRoot: stateRoot,
            shellBinary: "bash",
            laneRunScript: join(stateRoot, "lane-run.sh"),
          },
        ),
      );
      assert.equal(code, EXIT_OK);
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it("ExecutionFailed lane action exits EXIT_FAIL with diagnostics", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "cli-execfail-"));
    try {
      const reserveCalls: string[] = [];
      const layer = stubServices({
        records: recoverableRecords("/abs/wt"),
        reserveCalls,
        failReserve: true,
      });
      const cap = captureIo();
      const code = await Effect.runPromise(
        runSupervisorCli(
          ["--state-root", stateRoot, "--once", String(runId)],
          cap.io,
          {
            shellBinary: "bash",
            laneRunScript: "/s/lane-run.sh",
            provideServices: (e) =>
              e.pipe(Effect.provide(layer)) as Effect.Effect<
                readonly import("./supervisor.js").SupervisorRunResultV1[]
              >,
          },
        ),
      );
      assert.equal(code, EXIT_FAIL);
      assert.match(cap.stderr, /execution failed/);
      assert.deepEqual(reserveCalls, ["reserve"]);
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });
});
