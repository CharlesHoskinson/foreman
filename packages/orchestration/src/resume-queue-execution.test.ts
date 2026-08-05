/**
 * runResumeQueueExecution — exact round-vector preservation and strict
 * inspect → reserve → restore → submit ordering (R5D).
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
  type ResumeAttemptReservationV1,
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
  worktreeRestoreFailure,
  type WorktreeRestorePermitV1,
  type WorktreeRestoreResultV1,
} from "./resume-worktree-restore.js";
import {
  buildLaneRunRoundVector,
  makeLiveQueueSubmitter,
  makeStubQueueSubmitter,
  QueueSubmitter,
  queueSubmitFailure,
  runResumeQueueExecution,
  type QueueSubmissionV1,
} from "./resume-queue-execution.js";
import {
  BoundedFs,
  EnvVars,
  PathLookup,
  ProcessExec,
  ProcessFailure,
  Sleeper,
} from "./queue-services.js";

const runId = decodeRunId("r5d-queue-run") as RunId;
const laneId = decodeLaneId("grok-q") as LaneId;
const attemptId = decodeAttemptId(4) as AttemptId;
const identity = makeAttemptIdentity(runId, laneId, attemptId);
const commit = "c".repeat(40);

function plan(opts?: {
  readonly commandArgv?: readonly string[];
  readonly gate?: string;
  readonly report?: string;
}): RoundPlanV1 {
  return {
    schemaVersion: 1,
    runId,
    laneId,
    attemptId,
    mode: "round",
    commandArgv: opts?.commandArgv ?? ["impl", "a b", "", "x;y"],
    gateCommand: opts?.gate ?? "npm test",
    reportPath: opts?.report ?? "/abs/FOREMAN_REPORT.md",
    reportBaseline: absentReportSnapshot(),
  };
}

function checkpoint(): CheckpointIdentityV1 {
  return { attemptIdentity: identity, commit };
}

function event(): StoredEvent {
  return {
    seq: 5,
    ts: "2026-08-05T12:00:00Z",
    type: "resume_attempt",
    lane: String(laneId),
    payload: { attempt: attemptId, resumeCount: 1 },
  };
}

function reservation(count = 1): ResumeAttemptReservationV1 {
  return {
    attemptIdentity: identity,
    event: event(),
    resumeCount: count,
  };
}

describe("buildLaneRunRoundVector", () => {
  it("preserves empty args, spaces, and metacharacters without reconstruction", () => {
    const p = plan({
      commandArgv: ["cmd", "", "a b", "x;y", "$HOME", "unicode-✓"],
    });
    const v = buildLaneRunRoundVector({
      shellBinary: "/bin/bash",
      laneRunScript: "/skill/scripts/lane-run.sh",
      plan: p,
      worktree: "/abs/wt",
    });
    assert.deepEqual(v, [
      "/bin/bash",
      "/skill/scripts/lane-run.sh",
      "--round",
      "npm test",
      "/abs/FOREMAN_REPORT.md",
      String(runId),
      String(laneId),
      "/abs/wt",
      "--",
      "cmd",
      "",
      "a b",
      "x;y",
      "$HOME",
      "unicode-✓",
    ]);
  });
});

describe("runResumeQueueExecution ordering", () => {
  it("runs inspect → reserve → restore → submit in that order", async () => {
    const order: string[] = [];
    let capturedVector: readonly string[] | null = null;

    const restoreLayer = makeStubWorktreeRestore({
      inspect: () => {
        order.push("inspect");
        return Effect.succeed({
          worktreeRoot: "/abs/wt",
          rootIdentityKey: "k",
          checkpointIdentity: checkpoint(),
        } satisfies WorktreeRestorePermitV1);
      },
      restore: () => {
        order.push("restore");
        return Effect.succeed({
          worktreeRoot: "/abs/wt",
          checkpointIdentity: checkpoint(),
        } satisfies WorktreeRestoreResultV1);
      },
    });

    const journalLayer = Layer.succeed(RunJournal, {
      allocate: () => Effect.die("unused"),
      append: () => Effect.die("unused"),
      reserveResumeAttempt: () => {
        order.push("reserve");
        return Effect.succeed(reservation(1));
      },
    });

    const queueLayer = makeStubQueueSubmitter({
      submit: (_group, commandArgv) => {
        order.push("submit");
        capturedVector = commandArgv;
        return Effect.succeed({
          _tag: "Queued",
          taskId: "99",
        } satisfies QueueSubmissionV1);
      },
    });

    const layer = Layer.mergeAll(restoreLayer, journalLayer, queueLayer);
    const p = plan();
    const result = await Effect.runPromise(
      runResumeQueueExecution({
        plan: p,
        checkpointIdentity: checkpoint(),
        worktree: "/abs/wt",
        resumeMaxAttempts: 2,
        shellBinary: "bash",
        laneRunScript: "/scripts/lane-run.sh",
      }).pipe(Effect.provide(layer)),
    );

    assert.deepEqual(order, ["inspect", "reserve", "restore", "submit"]);
    assert.equal(result.submission._tag, "Queued");
    assert.deepEqual(
      capturedVector,
      buildLaneRunRoundVector({
        shellBinary: "bash",
        laneRunScript: "/scripts/lane-run.sh",
        plan: p,
        worktree: "/abs/wt",
      }),
    );
  });

  it("dirty inspect fails before reserve and submit", async () => {
    const order: string[] = [];
    const restoreLayer = makeStubWorktreeRestore({
      inspect: () => {
        order.push("inspect");
        return Effect.fail(worktreeRestoreFailure("dirty_worktree"));
      },
      restore: () => {
        order.push("restore");
        return Effect.die("should not restore");
      },
    });
    const journalLayer = Layer.succeed(RunJournal, {
      allocate: () => Effect.die("unused"),
      append: () => Effect.die("unused"),
      reserveResumeAttempt: () => {
        order.push("reserve");
        return Effect.succeed(reservation());
      },
    });
    const queueLayer = makeStubQueueSubmitter({
      submit: () => {
        order.push("submit");
        return Effect.succeed({ _tag: "Ready", commandArgv: ["x"] });
      },
    });
    const either = await Effect.runPromise(
      Effect.either(
        runResumeQueueExecution({
          plan: plan(),
          checkpointIdentity: checkpoint(),
          worktree: "/abs/wt",
          resumeMaxAttempts: 2,
          shellBinary: "bash",
          laneRunScript: "/scripts/lane-run.sh",
        }).pipe(
          Effect.provide(
            Layer.mergeAll(restoreLayer, journalLayer, queueLayer),
          ),
        ),
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "inspect_failed");
    }
    assert.deepEqual(order, ["inspect"]);
  });

  it("terminal race at reserve fails before restore and submit", async () => {
    const order: string[] = [];
    const restoreLayer = makeStubWorktreeRestore({
      inspect: () => {
        order.push("inspect");
        return Effect.succeed({
          worktreeRoot: "/abs/wt",
          rootIdentityKey: "k",
          checkpointIdentity: checkpoint(),
        });
      },
      restore: () => {
        order.push("restore");
        return Effect.die("no restore after terminal reserve");
      },
    });
    const journalLayer = Layer.succeed(RunJournal, {
      allocate: () => Effect.die("unused"),
      append: () => Effect.die("unused"),
      reserveResumeAttempt: () => {
        order.push("reserve");
        // Concurrent round_done observed under the journal lock.
        return Effect.fail(resumeAttemptFailure("attempt_not_current"));
      },
    });
    const either = await Effect.runPromise(
      Effect.either(
        runResumeQueueExecution({
          plan: plan(),
          checkpointIdentity: checkpoint(),
          worktree: "/abs/wt",
          resumeMaxAttempts: 2,
          shellBinary: "bash",
          laneRunScript: "/s/lane-run.sh",
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              restoreLayer,
              journalLayer,
              makeStubQueueSubmitter({
                submit: () => {
                  order.push("submit");
                  return Effect.die("no submit after terminal reserve");
                },
              }),
            ),
          ),
        ),
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "reserve_failed");
    }
    assert.deepEqual(order, ["inspect", "reserve"]);
  });

  it("lost reserve race fails before restore and submit; inspect already ran", async () => {
    const order: string[] = [];
    const restoreLayer = makeStubWorktreeRestore({
      inspect: () => {
        order.push("inspect");
        return Effect.succeed({
          worktreeRoot: "/abs/wt",
          rootIdentityKey: "k",
          checkpointIdentity: checkpoint(),
        });
      },
      restore: () => {
        order.push("restore");
        return Effect.die("no");
      },
    });
    const journalLayer = Layer.succeed(RunJournal, {
      allocate: () => Effect.die("unused"),
      append: () => Effect.die("unused"),
      reserveResumeAttempt: () => {
        order.push("reserve");
        return Effect.fail(resumeAttemptFailure("resume_limit_reached"));
      },
    });
    const either = await Effect.runPromise(
      Effect.either(
        runResumeQueueExecution({
          plan: plan(),
          checkpointIdentity: checkpoint(),
          worktree: "/abs/wt",
          resumeMaxAttempts: 1,
          shellBinary: "bash",
          laneRunScript: "/s/lane-run.sh",
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              restoreLayer,
              journalLayer,
              makeStubQueueSubmitter({
                submit: () => {
                  order.push("submit");
                  return Effect.succeed({
                    _tag: "Ready",
                    commandArgv: [],
                  });
                },
              }),
            ),
          ),
        ),
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "reserve_failed");
    }
    assert.deepEqual(order, ["inspect", "reserve"]);
  });

  it("restore failure after reserve leaves reservation durable (caller observes count)", async () => {
    const order: string[] = [];
    let reserved = false;
    const restoreLayer = makeStubWorktreeRestore({
      inspect: () => {
        order.push("inspect");
        return Effect.succeed({
          worktreeRoot: "/abs/wt",
          rootIdentityKey: "k",
          checkpointIdentity: checkpoint(),
        });
      },
      restore: () => {
        order.push("restore");
        return Effect.fail(worktreeRestoreFailure("checkout_failed"));
      },
    });
    const journalLayer = Layer.succeed(RunJournal, {
      allocate: () => Effect.die("unused"),
      append: () => Effect.die("unused"),
      reserveResumeAttempt: () => {
        order.push("reserve");
        reserved = true;
        return Effect.succeed(reservation(1));
      },
    });
    const either = await Effect.runPromise(
      Effect.either(
        runResumeQueueExecution({
          plan: plan(),
          checkpointIdentity: checkpoint(),
          worktree: "/abs/wt",
          resumeMaxAttempts: 2,
          shellBinary: "bash",
          laneRunScript: "/s/lane-run.sh",
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              restoreLayer,
              journalLayer,
              makeStubQueueSubmitter({
                submit: () => {
                  order.push("submit");
                  return Effect.succeed({
                    _tag: "Queued",
                    taskId: "1",
                  });
                },
              }),
            ),
          ),
        ),
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "restore_failed");
    }
    assert.equal(reserved, true);
    assert.deepEqual(order, ["inspect", "reserve", "restore"]);
  });

  it("pueue unavailable returns Ready and never requires runForeground", async () => {
    const restoreLayer = makeStubWorktreeRestore({
      inspect: () =>
        Effect.succeed({
          worktreeRoot: "/abs/wt",
          rootIdentityKey: "k",
          checkpointIdentity: checkpoint(),
        }),
      restore: () =>
        Effect.succeed({
          worktreeRoot: "/abs/wt",
          checkpointIdentity: checkpoint(),
        }),
    });
    const journalLayer = Layer.succeed(RunJournal, {
      allocate: () => Effect.die("unused"),
      append: () => Effect.die("unused"),
      reserveResumeAttempt: () => Effect.succeed(reservation()),
    });
    const p = plan();
    const queueLayer = makeStubQueueSubmitter({
      submit: (_g, commandArgv) =>
        Effect.succeed({
          _tag: "Ready",
          commandArgv,
        }),
    });
    const result = await Effect.runPromise(
      runResumeQueueExecution({
        plan: p,
        checkpointIdentity: checkpoint(),
        worktree: "/abs/wt",
        resumeMaxAttempts: 2,
        shellBinary: "bash",
        laneRunScript: "/s/lane-run.sh",
      }).pipe(
        Effect.provide(Layer.mergeAll(restoreLayer, journalLayer, queueLayer)),
      ),
    );
    assert.equal(result.submission._tag, "Ready");
    if (result.submission._tag === "Ready") {
      assert.equal(result.submission.commandArgv[2], "--round");
      assert.ok(result.submission.commandArgv.includes(""));
    }
  });

  it("submit failure after successful reserve/restore still reports durable reservation via result path", async () => {
    const restoreLayer = makeStubWorktreeRestore({
      inspect: () =>
        Effect.succeed({
          worktreeRoot: "/abs/wt",
          rootIdentityKey: "k",
          checkpointIdentity: checkpoint(),
        }),
      restore: () =>
        Effect.succeed({
          worktreeRoot: "/abs/wt",
          checkpointIdentity: checkpoint(),
        }),
    });
    const journalLayer = Layer.succeed(RunJournal, {
      allocate: () => Effect.die("unused"),
      append: () => Effect.die("unused"),
      reserveResumeAttempt: () => Effect.succeed(reservation(2)),
    });
    const either = await Effect.runPromise(
      Effect.either(
        runResumeQueueExecution({
          plan: plan(),
          checkpointIdentity: checkpoint(),
          worktree: "/abs/wt",
          resumeMaxAttempts: 3,
          shellBinary: "bash",
          laneRunScript: "/s/lane-run.sh",
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              restoreLayer,
              journalLayer,
              makeStubQueueSubmitter({
                submit: () =>
                  Effect.fail(queueSubmitFailure("queue_failed")),
              }),
            ),
          ),
        ),
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "submit_failed");
    }
  });
});

describe("makeLiveQueueSubmitter — never direct-spawns", () => {
  type Call = {
    readonly kind: "captured" | "ignored" | "foreground";
    readonly cmd: string;
    readonly args: readonly string[];
  };

  function queueServiceLayer(opts: {
    readonly forceMissing?: boolean;
    readonly pueuePresent?: boolean;
    readonly ensureStatusOk?: boolean;
    readonly vanishAfterEnsure?: boolean;
    readonly addExit?: number;
    readonly addStdout?: string;
    readonly callLog: Call[];
  }) {
    let ensureSeen = false;
    return Layer.mergeAll(
      Layer.succeed(ProcessExec, {
        runCaptured: (o) =>
          Effect.sync(() => {
            opts.callLog.push({
              kind: "captured",
              cmd: o.command,
              args: o.args,
            });
            // status probe during ensure
            if (o.args[0] === "status") {
              return {
                exitCode: opts.ensureStatusOk === false ? 1 : 0,
                stdout: opts.ensureStatusOk === false ? "" : "{}",
                stderr: "",
              };
            }
            if (o.args[0] === "group") {
              return { exitCode: 0, stdout: "", stderr: "" };
            }
            if (o.args[0] === "add") {
              return {
                exitCode: opts.addExit ?? 0,
                stdout: opts.addStdout ?? "99\n",
                stderr: "",
              };
            }
            return { exitCode: 0, stdout: "", stderr: "" };
          }),
        runIgnoredStdio: (o) =>
          Effect.sync(() => {
            opts.callLog.push({
              kind: "ignored",
              cmd: o.command,
              args: o.args,
            });
            ensureSeen = true;
            return { exitCode: 0, stdout: "", stderr: "" };
          }),
        runForeground: (o) =>
          Effect.sync(() => {
            opts.callLog.push({
              kind: "foreground",
              cmd: o.command,
              args: o.args,
            });
            return 0;
          }),
      }),
      Layer.succeed(Sleeper, {
        sleep: () => Effect.void,
      }),
      Layer.succeed(PathLookup, {
        which: (name) =>
          Effect.sync(() => {
            if (opts.forceMissing) return null;
            if (name === "pueue") {
              if (opts.vanishAfterEnsure && ensureSeen) return null;
              return opts.pueuePresent === false ? null : "/bin/pueue";
            }
            if (name === "pueued") return "/bin/pueued";
            return null;
          }),
        fileExists: () => Effect.succeed(false),
        isExecutable: () => Effect.succeed(false),
      }),
      Layer.succeed(BoundedFs, {
        readFileBounded: () =>
          Effect.succeed({ _tag: "Absent" as const }),
      }),
      Layer.succeed(EnvVars, {
        get: (name) =>
          Effect.succeed(
            name === "LANE_QUEUE_FORCE_MISSING" && opts.forceMissing
              ? "1"
              : name === "PUEUE_CONFIG_PATH"
                ? "/tmp/no-pueue-config.yml"
                : undefined,
          ),
        home: () => Effect.succeed("/home/test"),
      }),
    );
  }

  it("returns Ready and never calls runForeground when pueue is absent", async () => {
    const callLog: Call[] = [];
    const layer = makeLiveQueueSubmitter().pipe(
      Layer.provide(
        queueServiceLayer({
          forceMissing: true,
          callLog,
        }),
      ),
    );
    const argv = ["bash", "/s/lane-run.sh", "--round", "true", "/r", "r", "l", "/w", "--", "cmd"];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const q = yield* QueueSubmitter;
        return yield* q.submit("misc", argv);
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Ready");
    if (result._tag === "Ready") {
      assert.deepEqual(result.commandArgv, argv);
    }
    assert.equal(
      callLog.filter((c) => c.kind === "foreground").length,
      0,
    );
    // Missing client: no ensure/add admission attempt.
    assert.equal(
      callLog.filter((c) => c.args[0] === "status" || c.args[0] === "add")
        .length,
      0,
    );
  });

  it("missing-client observation (pueuePresent false) returns Ready without ensure", async () => {
    const callLog: Call[] = [];
    const layer = makeLiveQueueSubmitter().pipe(
      Layer.provide(
        queueServiceLayer({
          pueuePresent: false,
          callLog,
        }),
      ),
    );
    const argv = ["bash", "lane-run.sh", "--round", "g", "r", "run", "lane", "/w", "--", "x"];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const q = yield* QueueSubmitter;
        return yield* q.submit("misc", argv);
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Ready");
    if (result._tag === "Ready") {
      assert.deepEqual(result.commandArgv, argv);
    }
    assert.equal(callLog.length, 0);
  });

  it("present client with unhealthy ensure fails as QueueSubmitFailure not Ready", async () => {
    const callLog: Call[] = [];
    const layer = makeLiveQueueSubmitter().pipe(
      Layer.provide(
        queueServiceLayer({
          pueuePresent: true,
          ensureStatusOk: false,
          callLog,
        }),
      ),
    );
    const argv = ["bash", "lane-run.sh", "--round", "g", "r", "run", "lane", "/w", "--", "x"];
    const either = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const q = yield* QueueSubmitter;
          return yield* q.submit("misc", argv);
        }).pipe(Effect.provide(layer)),
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left._tag, "QueueSubmitFailure");
      assert.equal(either.left.reason, "queue_failed");
    }
    // Ensure may probe status / start daemon, but must never admit add or
    // fall back to a Ready direct-spawn path.
    assert.equal(
      callLog.filter((c) => c.args[0] === "add").length,
      0,
    );
    assert.equal(
      callLog.filter((c) => c.kind === "foreground").length,
      0,
    );
  });

  it("returns Ready and never runForeground when pueue vanishes between ensure and add", async () => {
    const callLog: Call[] = [];
    // resolvePueueClient sees pueue first; after ensure re-resolve returns null.
    // We simulate vanish by: first which returns path, after any process call
    // (status probe) subsequent which returns null.
    let probes = 0;
    const services = Layer.mergeAll(
      Layer.succeed(ProcessExec, {
        runCaptured: (o) =>
          Effect.sync(() => {
            callLog.push({ kind: "captured", cmd: o.command, args: o.args });
            probes += 1;
            if (o.args[0] === "status") {
              return { exitCode: 0, stdout: "{}", stderr: "" };
            }
            if (o.args[0] === "group") {
              return { exitCode: 0, stdout: "", stderr: "" };
            }
            return { exitCode: 0, stdout: "1\n", stderr: "" };
          }),
        runIgnoredStdio: (o) =>
          Effect.sync(() => {
            callLog.push({ kind: "ignored", cmd: o.command, args: o.args });
            return { exitCode: 0, stdout: "", stderr: "" };
          }),
        runForeground: (o) =>
          Effect.sync(() => {
            callLog.push({
              kind: "foreground",
              cmd: o.command,
              args: o.args,
            });
            return 0;
          }),
      }),
      Layer.succeed(Sleeper, { sleep: () => Effect.void }),
      Layer.succeed(PathLookup, {
        which: (name) =>
          Effect.sync(() => {
            if (name === "pueue") {
              // After status probes start (ensure reached), vanish.
              return probes > 0 ? null : "/bin/pueue";
            }
            if (name === "pueued") return "/bin/pueued";
            return null;
          }),
        fileExists: () => Effect.succeed(false),
        isExecutable: () => Effect.succeed(false),
      }),
      Layer.succeed(BoundedFs, {
        readFileBounded: () =>
          Effect.succeed({ _tag: "Absent" as const }),
      }),
      Layer.succeed(EnvVars, {
        get: (name) =>
          Effect.succeed(
            name === "PUEUE_CONFIG_PATH"
              ? "/tmp/no-pueue-config.yml"
              : undefined,
          ),
        home: () => Effect.succeed("/home/test"),
      }),
    );

    const layer = makeLiveQueueSubmitter().pipe(Layer.provide(services));
    const argv = ["bash", "lane-run.sh", "--round", "g", "r", "run", "lane", "/w", "--", "x"];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const q = yield* QueueSubmitter;
        return yield* q.submit("misc", argv);
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Ready");
    assert.equal(
      callLog.filter((c) => c.kind === "foreground").length,
      0,
    );
    assert.equal(
      callLog.filter((c) => c.args[0] === "add").length,
      0,
    );
  });

  it("queued path uses runCaptured add only, never runForeground", async () => {
    const callLog: Call[] = [];
    const layer = makeLiveQueueSubmitter().pipe(
      Layer.provide(
        queueServiceLayer({
          pueuePresent: true,
          ensureStatusOk: true,
          addExit: 0,
          addStdout: "42\n",
          callLog,
        }),
      ),
    );
    const argv = ["bash", "lane-run.sh", "--round", "g", "r", "run", "lane", "/w", "--", "x"];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const q = yield* QueueSubmitter;
        return yield* q.submit("misc", argv);
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Queued");
    if (result._tag === "Queued") assert.equal(result.taskId, "42");
    assert.equal(
      callLog.filter((c) => c.kind === "foreground").length,
      0,
    );
    assert.ok(callLog.some((c) => c.args[0] === "add"));
  });

  it("after add is attempted, nonzero exit fails closed as QueueSubmitFailure not Ready", async () => {
    const callLog: Call[] = [];
    const layer = makeLiveQueueSubmitter().pipe(
      Layer.provide(
        queueServiceLayer({
          pueuePresent: true,
          ensureStatusOk: true,
          addExit: 1,
          addStdout: "",
          callLog,
        }),
      ),
    );
    const argv = ["bash", "lane-run.sh", "--round", "g", "r", "run", "lane", "/w", "--", "x"];
    const either = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const q = yield* QueueSubmitter;
          return yield* q.submit("misc", argv);
        }).pipe(Effect.provide(layer)),
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "queue_failed");
    }
    assert.ok(callLog.some((c) => c.args[0] === "add"));
    assert.equal(
      callLog.filter((c) => c.kind === "foreground").length,
      0,
    );
  });

  it("after add is attempted, malformed task id fails closed not Ready", async () => {
    const callLog: Call[] = [];
    const layer = makeLiveQueueSubmitter().pipe(
      Layer.provide(
        queueServiceLayer({
          pueuePresent: true,
          ensureStatusOk: true,
          addExit: 0,
          addStdout: "not-a-task-id\n",
          callLog,
        }),
      ),
    );
    const argv = ["bash", "lane-run.sh", "--round", "g", "r", "run", "lane", "/w", "--", "x"];
    const either = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const q = yield* QueueSubmitter;
          return yield* q.submit("misc", argv);
        }).pipe(Effect.provide(layer)),
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "queue_failed");
    }
    assert.equal(
      callLog.filter((c) => c.kind === "foreground").length,
      0,
    );
  });

  it("transport error during add fails closed as QueueSubmitFailure", async () => {
    const callLog: Call[] = [];
    const services = Layer.mergeAll(
      Layer.succeed(ProcessExec, {
        runCaptured: (o) =>
          Effect.gen(function* () {
            callLog.push({ kind: "captured", cmd: o.command, args: o.args });
            if (o.args[0] === "status") {
              return { exitCode: 0, stdout: "{}", stderr: "" };
            }
            if (o.args[0] === "group") {
              return { exitCode: 0, stdout: "", stderr: "" };
            }
            if (o.args[0] === "add") {
              return yield* Effect.fail(new ProcessFailure("spawn_failed"));
            }
            return { exitCode: 0, stdout: "", stderr: "" };
          }),
        runIgnoredStdio: (o) =>
          Effect.sync(() => {
            callLog.push({ kind: "ignored", cmd: o.command, args: o.args });
            return { exitCode: 0, stdout: "", stderr: "" };
          }),
        runForeground: (o) =>
          Effect.sync(() => {
            callLog.push({
              kind: "foreground",
              cmd: o.command,
              args: o.args,
            });
            return 0;
          }),
      }),
      Layer.succeed(Sleeper, { sleep: () => Effect.void }),
      Layer.succeed(PathLookup, {
        which: (name) =>
          Effect.succeed(
            name === "pueue"
              ? "/bin/pueue"
              : name === "pueued"
                ? "/bin/pueued"
                : null,
          ),
        fileExists: () => Effect.succeed(false),
        isExecutable: () => Effect.succeed(false),
      }),
      Layer.succeed(BoundedFs, {
        readFileBounded: () => Effect.succeed({ _tag: "Absent" as const }),
      }),
      Layer.succeed(EnvVars, {
        get: (name) =>
          Effect.succeed(
            name === "PUEUE_CONFIG_PATH" ? "/tmp/no-pueue-config.yml" : undefined,
          ),
        home: () => Effect.succeed("/home/test"),
      }),
    );
    const layer = makeLiveQueueSubmitter().pipe(Layer.provide(services));
    const either = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const q = yield* QueueSubmitter;
          return yield* q.submit("misc", ["bash", "x"]);
        }).pipe(Effect.provide(layer)),
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "queue_failed");
    }
    assert.equal(
      callLog.filter((c) => c.kind === "foreground").length,
      0,
    );
  });
});
