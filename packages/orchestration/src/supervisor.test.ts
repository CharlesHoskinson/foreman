/**
 * One-shot resume supervisor core — decision routing, dry-run, ownership,
 * and no-mutation paths (R5D).
 */

import assert from "node:assert/strict";
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
import {
  absentReportSnapshot,
  type CheckpointIdentityV1,
  type RoundPlanV1,
} from "./round-contract.js";
import {
  makeStubWorktreeRestore,
  type WorktreeRestorePermitV1,
} from "./resume-worktree-restore.js";
import { makeStubQueueSubmitter } from "./resume-queue-execution.js";
import {
  ResumeLockProbe,
  ResumeProcessProbe,
} from "./resume-safety-services.js";
import {
  deriveOwnershipWorktree,
  formatLaneActionLine,
  formatRunResultLines,
  RunDiscovery,
  RunLease,
  runSupervisor,
  sweepOneRun,
  TypedJournalReader,
  type SupervisorConfig,
} from "./supervisor.js";

const runId = decodeRunId("r5d-sup-run") as RunId;
const laneId = decodeLaneId("grok-sup") as LaneId;
const attemptId = decodeAttemptId(3) as AttemptId;
const identity = makeAttemptIdentity(runId, laneId, attemptId);
const commit = "a".repeat(40);

function plan(): RoundPlanV1 {
  return {
    schemaVersion: 1,
    runId,
    laneId,
    attemptId,
    mode: "round",
    commandArgv: ["impl", "", "a b"],
    gateCommand: "true",
    reportPath: "/abs/FOREMAN_REPORT.md",
    reportBaseline: absentReportSnapshot(),
  };
}

function checkpoint(): CheckpointIdentityV1 {
  return { attemptIdentity: identity, commit };
}

function rec(event: StoredEvent, line = event.seq): ReplayRecord {
  return {
    event,
    physicalLine: line,
  };
}

function promptAndCheckpoint(worktree?: string): readonly ReplayRecord[] {
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
  ];
  if (worktree !== undefined) {
    events.push({
      seq: 3,
      ts: "2026-08-05T12:00:02Z",
      type: "ownership",
      lane: String(laneId),
      payload: {
        attempt: attemptId,
        launcher_pid: null,
        pid: null,
        worktree,
        launcher: true,
      },
    });
  }
  return events.map((e) => rec(e));
}

function completedRecords(): readonly ReplayRecord[] {
  const p = plan();
  return [
    rec({
      seq: 1,
      ts: "2026-08-05T12:00:00Z",
      type: "prompt",
      lane: String(laneId),
      payload: { attempt: attemptId, roundPlan: p },
    }),
    rec({
      seq: 2,
      ts: "2026-08-05T12:00:01Z",
      type: "checkpoint",
      lane: String(laneId),
      commit,
      payload: { attempt: attemptId },
    }),
    rec({
      seq: 3,
      ts: "2026-08-05T12:00:02Z",
      type: "state",
      lane: String(laneId),
      payload: { attempt: attemptId, state: "verifying" },
    }),
    rec({
      seq: 4,
      ts: "2026-08-05T12:00:03Z",
      type: "round_done",
      lane: String(laneId),
      payload: {
        attempt: attemptId,
        outcome: {
          _tag: "completed",
          attemptIdentity: identity,
          implementationExitCode: 0,
          gateExitCode: 0,
          reportFresh: true,
          reportBaseline: absentReportSnapshot(),
          report: {
            _tag: "Present",
            digest: "b".repeat(64),
            byteLength: 4,
          },
        },
      },
    }),
  ];
}

function baseConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    resumeMaxAttempts: 2,
    shellBinary: "/bin/bash",
    laneRunScript: "/skill/scripts/lane-run.sh",
    dryRun: false,
    ...overrides,
  };
}

function makeHarness(opts: {
  readonly records?: readonly ReplayRecord[] | "missing" | "corrupt";
  readonly processExists?: boolean;
  readonly lockKind?: "missing" | "directory";
  readonly journalReserve?: () => Effect.Effect<unknown, unknown>;
  readonly inspectCalls?: string[];
  readonly reserveCalls?: string[];
  readonly restoreCalls?: string[];
  readonly submitCalls?: string[];
  readonly leaseBusy?: boolean;
  readonly runs?: readonly RunId[];
}) {
  const order: string[] = [];
  const records = opts.records ?? promptAndCheckpoint("/abs/wt");
  const journalReader = Layer.succeed(TypedJournalReader, {
    readRun: () =>
      Effect.sync(() => {
        if (opts.records === "missing") return { _tag: "Missing" as const };
        if (opts.records === "corrupt") return { _tag: "Corrupt" as const };
        return {
          _tag: "Ok" as const,
          records: records as readonly ReplayRecord[],
        };
      }),
  });
  const lease = Layer.succeed(RunLease, {
    acquire: () =>
      Effect.succeed(
        opts.leaseBusy
          ? { _tag: "Busy" as const }
          : {
              _tag: "Held" as const,
              release: () => Effect.void,
            },
      ),
  });
  const discovery = Layer.succeed(RunDiscovery, {
    listRuns: () => Effect.succeed(opts.runs ?? [runId]),
  });
  const processProbe = Layer.succeed(ResumeProcessProbe, {
    observe: (pid) =>
      Effect.succeed(
        pid === null
          ? ("inactive" as const)
          : opts.processExists === true
            ? ("active" as const)
            : ("inactive" as const),
      ),
  });
  const lockProbe = Layer.succeed(ResumeLockProbe, {
    observe: () =>
      Effect.succeed(
        opts.lockKind === "directory" ? ("held" as const) : ("free" as const),
      ),
  });
  const restore = makeStubWorktreeRestore({
    inspect: () => {
      order.push("inspect");
      opts.inspectCalls?.push("inspect");
      const permit: WorktreeRestorePermitV1 = {
        worktreeRoot: "/abs/wt",
        rootIdentityKey: "k",
        checkpointIdentity: checkpoint(),
      };
      return Effect.succeed(permit);
    },
    restore: () => {
      order.push("restore");
      opts.restoreCalls?.push("restore");
      return Effect.succeed({
        worktreeRoot: "/abs/wt",
        checkpointIdentity: checkpoint(),
      });
    },
  });
  const journal = Layer.succeed(RunJournal, {
    allocate: () => Effect.die("unused"),
    append: () => Effect.die("unused"),
    reserveResumeAttempt: () => {
      order.push("reserve");
      opts.reserveCalls?.push("reserve");
      if (opts.journalReserve) {
        return opts.journalReserve() as never;
      }
      return Effect.succeed({
        attemptIdentity: identity,
        event: {
          seq: 10,
          ts: "2026-08-05T12:00:10Z",
          type: "resume_attempt",
          lane: String(laneId),
          payload: { attempt: attemptId, resumeCount: 1 },
        },
        resumeCount: 1,
      });
    },
  });
  const queue = makeStubQueueSubmitter({
    submit: (_g, commandArgv) => {
      order.push("submit");
      opts.submitCalls?.push("submit");
      return Effect.succeed({ _tag: "Ready", commandArgv });
    },
  });
  const layer = Layer.mergeAll(
    discovery,
    journalReader,
    lease,
    processProbe,
    lockProbe,
    restore,
    journal,
    queue,
  );
  return { layer, order };
}

describe("deriveOwnershipWorktree", () => {
  it("prefers ownership in the latest round and never uses report paths", () => {
    const attempt2 = decodeAttemptId(2) as AttemptId;
    const events: StoredEvent[] = [
      {
        seq: 1,
        ts: "2026-08-05T12:00:00Z",
        type: "prompt",
        lane: String(laneId),
        payload: { attempt: 1 },
      },
      {
        seq: 2,
        ts: "2026-08-05T12:00:01Z",
        type: "ownership",
        lane: String(laneId),
        payload: { attempt: 1, worktree: "/old", launcher_pid: 1 },
      },
      {
        seq: 5,
        ts: "2026-08-05T12:00:02Z",
        type: "prompt",
        lane: String(laneId),
        payload: { attempt: 2, reportPath: "/report-only" },
      },
      {
        seq: 6,
        ts: "2026-08-05T12:00:03Z",
        type: "ownership",
        lane: String(laneId),
        payload: { attempt: 2, worktree: "/new-round", launcher_pid: 99 },
      },
    ];
    const found = deriveOwnershipWorktree(events, laneId, 5, attempt2);
    assert.equal(found._tag, "Found");
    if (found._tag === "Found") {
      assert.equal(found.worktree, "/new-round");
      assert.equal(found.processId, 99);
    }
  });

  it("never falls back to prior-attempt ownership", () => {
    const attempt2 = decodeAttemptId(2) as AttemptId;
    const events: StoredEvent[] = [
      {
        seq: 1,
        ts: "2026-08-05T12:00:00Z",
        type: "prompt",
        lane: String(laneId),
        payload: { attempt: 1 },
      },
      {
        seq: 2,
        ts: "2026-08-05T12:00:01Z",
        type: "ownership",
        lane: String(laneId),
        payload: { attempt: 1, worktree: "/prior-only", launcher_pid: 7 },
      },
      {
        seq: 5,
        ts: "2026-08-05T12:00:02Z",
        type: "prompt",
        lane: String(laneId),
        payload: { attempt: 2 },
      },
      // ownership after new prompt but still bound to prior attempt
      {
        seq: 6,
        ts: "2026-08-05T12:00:03Z",
        type: "ownership",
        lane: String(laneId),
        payload: { attempt: 1, worktree: "/stale-attempt", launcher_pid: 8 },
      },
    ];
    assert.equal(
      deriveOwnershipWorktree(events, laneId, 5, attempt2)._tag,
      "Missing",
    );
  });

  it("returns Missing when no ownership exists", () => {
    const events: StoredEvent[] = [
      {
        seq: 1,
        ts: "2026-08-05T12:00:00Z",
        type: "prompt",
        lane: String(laneId),
        payload: { attempt: 1, reportPath: "/r" },
      },
    ];
    assert.equal(
      deriveOwnershipWorktree(events, laneId, 1, decodeAttemptId(1) as AttemptId)
        ._tag,
      "Missing",
    );
  });
});

describe("sweepOneRun", () => {
  it("returns Busy when lease is held", async () => {
    const { layer } = makeHarness({ leaseBusy: true });
    const result = await Effect.runPromise(
      sweepOneRun(runId, baseConfig()).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Busy");
  });

  it("returns Missing / Corrupt from journal reader", async () => {
    const missing = await Effect.runPromise(
      sweepOneRun(runId, baseConfig()).pipe(
        Effect.provide(makeHarness({ records: "missing" }).layer),
      ),
    );
    assert.equal(missing._tag, "Missing");
    const corrupt = await Effect.runPromise(
      sweepOneRun(runId, baseConfig()).pipe(
        Effect.provide(makeHarness({ records: "corrupt" }).layer),
      ),
    );
    assert.equal(corrupt._tag, "Corrupt");
  });

  it("Completed decision causes no mutation", async () => {
    const inspectCalls: string[] = [];
    const reserveCalls: string[] = [];
    const { layer } = makeHarness({
      records: completedRecords(),
      inspectCalls,
      reserveCalls,
    });
    const result = await Effect.runPromise(
      sweepOneRun(runId, baseConfig()).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Swept");
    if (result._tag === "Swept") {
      assert.equal(result.actions[0]?._tag, "NoMutation");
      const line = formatLaneActionLine(result.actions[0]!);
      assert.match(line, /COMPLETED/);
    }
    assert.deepEqual(inspectCalls, []);
    assert.deepEqual(reserveCalls, []);
  });

  it("active process causes Wait and no mutation", async () => {
    const reserveCalls: string[] = [];
    const { layer } = makeHarness({
      records: promptAndCheckpoint("/abs/wt"),
      processExists: true,
      reserveCalls,
    });
    // ownership has null pid — inject ownership with live pid via custom records
    const p = plan();
    const records = [
      rec({
        seq: 1,
        ts: "2026-08-05T12:00:00Z",
        type: "prompt",
        lane: String(laneId),
        payload: { attempt: attemptId, roundPlan: p },
      }),
      rec({
        seq: 2,
        ts: "2026-08-05T12:00:01Z",
        type: "checkpoint",
        lane: String(laneId),
        commit,
        payload: { attempt: attemptId },
      }),
      rec({
        seq: 3,
        ts: "2026-08-05T12:00:02Z",
        type: "ownership",
        lane: String(laneId),
        payload: {
          attempt: attemptId,
          launcher_pid: 12345,
          worktree: "/abs/wt",
        },
      }),
    ];
    const h = makeHarness({
      records,
      processExists: true,
      reserveCalls,
    });
    const result = await Effect.runPromise(
      sweepOneRun(runId, baseConfig()).pipe(Effect.provide(h.layer)),
    );
    assert.equal(result._tag, "Swept");
    if (result._tag === "Swept") {
      assert.equal(result.actions[0]?._tag, "NoMutation");
      assert.match(formatLaneActionLine(result.actions[0]!), /WAIT prior_attempt_active/);
    }
    assert.deepEqual(reserveCalls, []);
  });

  it("held lock causes Wait and no mutation", async () => {
    const reserveCalls: string[] = [];
    const { layer } = makeHarness({
      records: promptAndCheckpoint("/abs/wt"),
      lockKind: "directory",
      reserveCalls,
    });
    const result = await Effect.runPromise(
      sweepOneRun(runId, baseConfig()).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Swept");
    if (result._tag === "Swept") {
      assert.match(formatLaneActionLine(result.actions[0]!), /WAIT lock_held/);
    }
    assert.deepEqual(reserveCalls, []);
  });

  it("missing ownership after Resume decision is NoOwnership without mutation", async () => {
    const reserveCalls: string[] = [];
    const { layer } = makeHarness({
      records: promptAndCheckpoint(undefined),
      reserveCalls,
    });
    const result = await Effect.runPromise(
      sweepOneRun(runId, baseConfig()).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Swept");
    if (result._tag === "Swept") {
      assert.equal(result.actions[0]?._tag, "NoMutation");
      assert.match(formatLaneActionLine(result.actions[0]!), /no ownership/);
    }
    assert.deepEqual(reserveCalls, []);
  });

  it("dry-run plans resume without inspect/reserve/restore/submit", async () => {
    const order: string[] = [];
    const h = makeHarness({
      records: promptAndCheckpoint("/abs/wt"),
      inspectCalls: order,
      reserveCalls: order,
      restoreCalls: order,
      submitCalls: order,
    });
    const result = await Effect.runPromise(
      sweepOneRun(runId, baseConfig({ dryRun: true })).pipe(
        Effect.provide(h.layer),
      ),
    );
    assert.equal(result._tag, "Swept");
    if (result._tag === "Swept") {
      assert.equal(result.actions[0]?._tag, "Planned");
      assert.match(formatLaneActionLine(result.actions[0]!), /\[dry-run\]/);
    }
    assert.deepEqual(order, []);
  });

  it("executes inspect→reserve→restore→submit for Resume", async () => {
    const h = makeHarness({
      records: promptAndCheckpoint("/abs/wt"),
    });
    const result = await Effect.runPromise(
      sweepOneRun(runId, baseConfig()).pipe(Effect.provide(h.layer)),
    );
    assert.equal(result._tag, "Swept");
    if (result._tag === "Swept") {
      assert.equal(result.actions[0]?._tag, "Executed");
      if (result.actions[0]?._tag === "Executed") {
        assert.equal(result.actions[0].result.submission._tag, "Ready");
        assert.ok(
          result.actions[0].result.commandArgv.includes("--round"),
        );
        assert.ok(result.actions[0].result.commandArgv.includes(""));
      }
    }
    assert.deepEqual(h.order, ["inspect", "reserve", "restore", "submit"]);
  });

  it("exhausted valid budget returns resume_limit_reached without mutation", async () => {
    // Full journal includes resume_attempt for budget inspection; round
    // selection must not treat that event as unknown_event_type.
    const base = promptAndCheckpoint("/abs/wt");
    const records: readonly ReplayRecord[] = [
      ...base,
      rec({
        seq: 4,
        ts: "2026-08-05T12:00:03Z",
        type: "resume_attempt",
        lane: String(laneId),
        payload: { attempt: attemptId, resumeCount: 1 },
      }),
    ];
    const inspectCalls: string[] = [];
    const reserveCalls: string[] = [];
    const restoreCalls: string[] = [];
    const submitCalls: string[] = [];
    const { layer } = makeHarness({
      records,
      inspectCalls,
      reserveCalls,
      restoreCalls,
      submitCalls,
    });
    const result = await Effect.runPromise(
      sweepOneRun(runId, baseConfig({ resumeMaxAttempts: 1 })).pipe(
        Effect.provide(layer),
      ),
    );
    assert.equal(result._tag, "Swept");
    if (result._tag === "Swept") {
      assert.equal(result.actions[0]?._tag, "NoMutation");
      assert.match(
        formatLaneActionLine(result.actions[0]!),
        /REFUSED resume_limit_reached/,
      );
    }
    assert.deepEqual(inspectCalls, []);
    assert.deepEqual(reserveCalls, []);
    assert.deepEqual(restoreCalls, []);
    assert.deepEqual(submitCalls, []);
  });

  it("prior-attempt ownership alone yields NoOwnership without mutation", async () => {
    const p = plan();
    const prior = decodeAttemptId(1) as AttemptId;
    const records = [
      rec({
        seq: 1,
        ts: "2026-08-05T12:00:00Z",
        type: "prompt",
        lane: String(laneId),
        payload: { attempt: prior },
      }),
      rec({
        seq: 2,
        ts: "2026-08-05T12:00:01Z",
        type: "ownership",
        lane: String(laneId),
        payload: {
          attempt: prior,
          worktree: "/prior-wt",
          launcher_pid: null,
        },
      }),
      rec({
        seq: 3,
        ts: "2026-08-05T12:00:02Z",
        type: "prompt",
        lane: String(laneId),
        payload: { attempt: attemptId, roundPlan: p },
      }),
      rec({
        seq: 4,
        ts: "2026-08-05T12:00:03Z",
        type: "checkpoint",
        lane: String(laneId),
        commit,
        payload: { attempt: attemptId },
      }),
    ];
    const reserveCalls: string[] = [];
    const { layer } = makeHarness({ records, reserveCalls });
    const result = await Effect.runPromise(
      sweepOneRun(runId, baseConfig()).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Swept");
    if (result._tag === "Swept") {
      assert.equal(result.actions[0]?._tag, "NoMutation");
      assert.match(formatLaneActionLine(result.actions[0]!), /no ownership/);
    }
    assert.deepEqual(reserveCalls, []);
  });

  it("invalid resume budget history refuses with invalid_history and no mutation", async () => {
    const base = promptAndCheckpoint("/abs/wt");
    // Gap in resume counts → inspectResumeAttemptBudget fails closed.
    const records: readonly ReplayRecord[] = [
      ...base,
      rec({
        seq: 4,
        ts: "2026-08-05T12:00:03Z",
        type: "resume_attempt",
        lane: String(laneId),
        payload: { attempt: attemptId, resumeCount: 2 },
      }),
    ];
    const inspectCalls: string[] = [];
    const reserveCalls: string[] = [];
    const restoreCalls: string[] = [];
    const submitCalls: string[] = [];
    const { layer } = makeHarness({
      records,
      inspectCalls,
      reserveCalls,
      restoreCalls,
      submitCalls,
    });
    const result = await Effect.runPromise(
      sweepOneRun(runId, baseConfig()).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Swept");
    if (result._tag === "Swept") {
      assert.equal(result.actions[0]?._tag, "NoMutation");
      assert.match(
        formatLaneActionLine(result.actions[0]!),
        /REFUSED invalid_history/,
      );
    }
    assert.deepEqual(inspectCalls, []);
    assert.deepEqual(reserveCalls, []);
    assert.deepEqual(restoreCalls, []);
    assert.deepEqual(submitCalls, []);
  });

  it("round_done between decision and reserve fails before restore and submit", async () => {
    const inspectCalls: string[] = [];
    const reserveCalls: string[] = [];
    const restoreCalls: string[] = [];
    const submitCalls: string[] = [];
    // Initial read has no terminal (decision → Resume). Reservation under
    // the lock simulates concurrent round_done by failing closed.
    const { layer } = makeHarness({
      records: promptAndCheckpoint("/abs/wt"),
      inspectCalls,
      reserveCalls,
      restoreCalls,
      submitCalls,
      journalReserve: () =>
        Effect.fail(resumeAttemptFailure("attempt_not_current")),
    });
    const result = await Effect.runPromise(
      sweepOneRun(runId, baseConfig()).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Swept");
    if (result._tag === "Swept") {
      assert.equal(result.actions[0]?._tag, "ExecutionFailed");
      if (result.actions[0]?._tag === "ExecutionFailed") {
        assert.equal(result.actions[0].reason, "reserve_failed");
      }
    }
    assert.deepEqual(inspectCalls, ["inspect"]);
    assert.deepEqual(reserveCalls, ["reserve"]);
    assert.deepEqual(restoreCalls, []);
    assert.deepEqual(submitCalls, []);
  });
});

describe("runSupervisor", () => {
  it("--once with invalid run id yields Missing", async () => {
    const { layer } = makeHarness({});
    const results = await Effect.runPromise(
      runSupervisor({
        mode: { _tag: "Once", runId: "bad/run" },
        config: baseConfig(),
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(results.length, 1);
    assert.equal(results[0]!._tag, "Missing");
  });

  it("--all sweeps every discovered run", async () => {
    const r2 = decodeRunId("r5d-sup-run-2") as RunId;
    const { layer } = makeHarness({
      records: "missing",
      runs: [runId, r2],
    });
    const results = await Effect.runPromise(
      runSupervisor({
        mode: { _tag: "All" },
        config: baseConfig(),
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r._tag === "Missing"));
  });
});

describe("formatRunResultLines", () => {
  it("formats busy and empty sweep", () => {
    assert.match(
      formatRunResultLines({ _tag: "Busy", runId })[0]!,
      /\.supervise\.lock held/,
    );
    assert.match(
      formatRunResultLines({ _tag: "Swept", runId, actions: [] })[0]!,
      /no events/,
    );
  });
});
