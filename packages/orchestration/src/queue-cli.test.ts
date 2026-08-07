import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { parseQueueArgv, runQueueCli, stripNodeArgv } from "./queue-cli.js";
import {
  EXIT_CONFIG,
  EXIT_MISSING_CLI,
  EXIT_OK,
} from "./queue-admission.js";
import {
  BoundedFs,
  EnvVars,
  PathLookup,
  ProcessExec,
  Sleeper,
  type QueueIo,
} from "./queue-services.js";
import {
  executionContractSha256,
  strictEndstopLimits,
  type ExecutionContractV1,
} from "./execution-contract.js";
import {
  EndstopLedger,
  makeLiveEndstopLedgerLayer,
} from "./execution-ledger.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

const guardedAdd = (root: string, contractId: string, contractSha256: string) => [
  "add",
  "grok",
  "--endstop-state-root",
  root,
  "--endstop-contract-id",
  contractId,
  "--endstop-contract-sha",
  contractSha256,
  "--endstop-action",
  "implement",
  "--endstop-candidate-sha",
  B,
  "--",
  "echo",
  "hi",
] as const;

describe("parseQueueArgv", () => {
  it("parses ensure / add / status / kill matrix", () => {
    assert.deepEqual(parseQueueArgv(["ensure"]), { kind: "ensure" });
    assert.deepEqual(parseQueueArgv(["node", "lane-queue.js", "ensure"]), {
      kind: "ensure",
    });
    assert.equal(parseQueueArgv(["add", "grok", "--", "echo", "hi"]).kind, "usage");
    assert.deepEqual(parseQueueArgv(guardedAdd("/state", "contract-1", A)), {
      kind: "add",
      group: "grok",
      endstop: {
        stateRoot: "/state",
        contractId: "contract-1",
        contractSha256: A,
        action: "implement",
        candidateSha256: B,
      },
      cmd: ["echo", "hi"],
    });
    assert.deepEqual(parseQueueArgv(["status"]), {
      kind: "status",
      taskId: undefined,
    });
    assert.deepEqual(parseQueueArgv(["status", "7"]), {
      kind: "status",
      taskId: "7",
    });
    assert.deepEqual(parseQueueArgv(["kill", "3"]), {
      kind: "kill",
      taskId: "3",
    });
  });

  it("usage errors for missing args and unknown subcommand", () => {
    assert.equal(parseQueueArgv([]).kind, "usage");
    assert.equal(parseQueueArgv(["bogus"]).kind, "usage");
    assert.equal(parseQueueArgv(["add", "g"]).kind, "usage");
    assert.equal(parseQueueArgv(["add", "g", "echo"]).kind, "usage");
    assert.equal(parseQueueArgv(["add", "g", "--"]).kind, "usage");
    assert.equal(parseQueueArgv(["kill"]).kind, "usage");
  });

  it("stripNodeArgv removes node and script path", () => {
    assert.deepEqual(
      stripNodeArgv(["/usr/bin/node", "/path/lane-queue.js", "ensure"]),
      ["ensure"],
    );
  });
});

function makeIo(): QueueIo & { stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    writeStdout: (t) => {
      stdout += t;
    },
    writeStderr: (t) => {
      stderr += t;
    },
  };
}

describe("runQueueCli exit matrix", () => {
  const forceLayer = Layer.mergeAll(
    Layer.succeed(ProcessExec, {
      runCaptured: () => Effect.die("no"),
      runIgnoredStdio: () => Effect.die("no"),
      runForeground: () => Effect.succeed(0),
    }),
    Layer.succeed(Sleeper, { sleep: () => Effect.void }),
    Layer.succeed(PathLookup, {
      which: () => Effect.succeed(null),
      fileExists: () => Effect.succeed(false),
      isExecutable: () => Effect.succeed(false),
    }),
    Layer.succeed(BoundedFs, {
      readFileBounded: () => Effect.succeed({ _tag: "Absent" as const }),
    }),
    Layer.succeed(EnvVars, {
      get: (n) =>
        Effect.succeed(n === "LANE_QUEUE_FORCE_MISSING" ? "1" : undefined),
      home: () => Effect.succeed("/home/t"),
    }),
  );

  it("usage returns 2", async () => {
    const io = makeIo();
    const code = await Effect.runPromise(
      runQueueCli([], io).pipe(Effect.provide(forceLayer)),
    );
    assert.equal(code, EXIT_CONFIG);
  });

  it("ensure force-missing returns 3", async () => {
    const io = makeIo();
    const code = await Effect.runPromise(
      runQueueCli(["ensure"], io).pipe(Effect.provide(forceLayer)),
    );
    assert.equal(code, EXIT_MISSING_CLI);
  });

  it("status force-missing returns 0 degraded", async () => {
    const io = makeIo();
    const code = await Effect.runPromise(
      runQueueCli(["status"], io).pipe(Effect.provide(forceLayer)),
    );
    assert.equal(code, EXIT_OK);
    assert.equal(io.stdout.trim(), '{"degraded":true}');
  });

  it("refuses a terminal contract before any queue or process service is called", async () => {
    const root = mkdtempSync(join(tmpdir(), "endstop-queue-"));
    try {
      const createdAt = "2026-08-05T12:00:00Z";
      const contract: ExecutionContractV1 = {
        schemaVersion: 1,
        contractId: "queue-endstop-1",
        packageId: "queue-package-1",
        objectiveSha256: A,
        acceptanceSha256: B,
        baseCommit: "1".repeat(40),
        allowedPathsSha256: C,
        dependencyContractIds: [],
        authorizationSha256: A,
        createdAt,
        deadlineAt: "2026-08-05T14:00:00Z",
        limits: { ...strictEndstopLimits, implementationRounds: 1 },
        requiredMilestones: ["checks"],
      };
      const hash = executionContractSha256(contract);
      await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          yield* ledger.create(contract);
          yield* ledger.execute(contract.contractId, hash, {
            _tag: "ReserveAction",
            action: "implement",
            candidateSha256: B,
            reservationId: "first",
            at: "2026-08-05T12:01:00Z",
          });
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
      );

      let serviceCalls = 0;
      const neverLayer = Layer.mergeAll(
        Layer.succeed(ProcessExec, {
          runCaptured: () => { serviceCalls += 1; return Effect.die("no"); },
          runIgnoredStdio: () => { serviceCalls += 1; return Effect.die("no"); },
          runForeground: () => { serviceCalls += 1; return Effect.die("no"); },
        }),
        Layer.succeed(Sleeper, { sleep: () => { serviceCalls += 1; return Effect.void; } }),
        Layer.succeed(PathLookup, {
          which: () => { serviceCalls += 1; return Effect.succeed(null); },
          fileExists: () => { serviceCalls += 1; return Effect.succeed(false); },
          isExecutable: () => { serviceCalls += 1; return Effect.succeed(false); },
        }),
        Layer.succeed(BoundedFs, {
          readFileBounded: () => { serviceCalls += 1; return Effect.succeed({ _tag: "Absent" as const }); },
        }),
        Layer.succeed(EnvVars, {
          get: () => { serviceCalls += 1; return Effect.succeed(undefined); },
          home: () => { serviceCalls += 1; return Effect.succeed(undefined); },
        }),
      );
      const io = makeIo();
      const code = await Effect.runPromise(
        runQueueCli(guardedAdd(root, contract.contractId, hash), io, {
          now: () => new Date("2026-08-05T12:02:00Z"),
          reservationId: () => "second",
        }).pipe(Effect.provide(neverLayer)),
      );

      assert.equal(code, EXIT_CONFIG);
      assert.equal(serviceCalls, 0);
      assert.match(io.stderr, /Foreman Endstop refused queue admission/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
