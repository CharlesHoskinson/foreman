import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import { Effect, Layer } from "effect";
import { parseQueueArgv, runQueueCli, stripNodeArgv } from "./queue-cli.js";
import {
  ADD_USAGE,
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
  deriveExecutionContractFamilyV2,
  executionContractSha256,
  strictEndstopLimits,
  type ExecutionFamilySourceV1,
  type ExecutionContractV1,
} from "./execution-contract.js";
import {
  EndstopLedger,
  makeLiveEndstopLedgerLayer,
} from "./execution-ledger.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function familySource(): ExecutionFamilySourceV1 {
  const rows = [
    [2, "v040-t2-project-registry", "project-registry", []],
    [3, "v040-t3-memory-index", "external-memory-index", ["v040-t2-project-registry"]],
    [4, "v040-t4-appliance", "hermetic-foreman-appliance", []],
    [5, "v040-t5-graphify", "knowledge-plane-refresh", []],
    [6, "v040-t6-work-dag", "work-dag-projection", ["v040-t5-graphify"]],
    [7, "v040-t7-context", "graph-context-builder", ["v040-t6-work-dag"]],
    [8, "v040-t8-evaluation", "graph-eval-falsification", [
      "v040-t3-memory-index",
      "v040-t4-appliance",
      "v040-t7-context",
    ]],
    [9, "v040-t9-release", "v040-release-program", [
      "v040-t2-project-registry",
      "v040-t3-memory-index",
      "v040-t4-appliance",
      "v040-t5-graphify",
      "v040-t6-work-dag",
      "v040-t7-context",
      "v040-t8-evaluation",
    ]],
  ] as const;
  return {
    schema: "foreman.execution-family-source.v1",
    program: "v040",
    familyId: "v040-release-20260822-f1",
    children: rows.map(([tranche, childId, packageId, dependencyChildIds]) => ({
      schema: "foreman.execution-child-brief.v1",
      childId,
      tranche,
      packageId,
      objective: `Complete ${packageId}.`,
      acceptance: [`${packageId} passes release checks.`],
      allowedPaths: [`packages/${packageId}/**`],
      dependencyChildIds,
    })),
  };
}

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

const guardedV2Add = (root: string, contractId: string, contractSha256: string) => [
  "add", "grok",
  "--endstop-state-root", root,
  "--endstop-contract-id", contractId,
  "--endstop-contract-sha", contractSha256,
  "--endstop-family-sha", C,
  "--endstop-child-id", "v040-t2-project-registry",
  "--endstop-action", "implement",
  "--endstop-candidate-sha", sha256Hex("1".repeat(40)),
  "--release-program", "v040",
  "--release-phase", "lane",
  "--release-owner", "project-registry",
  "--release-repo", "/repo",
  "--release-candidate-commit", "1".repeat(40),
  "--release-register", "/register/coverage.toml",
  "--release-evidence", "/authority/evidence.json",
  "--", "echo", "hi",
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
    const v2 = parseQueueArgv(guardedV2Add("/state", "contract-1", A));
    assert.equal(v2.kind, "add");
    if (v2.kind === "add") {
      assert.equal(v2.version, "v2");
      assert.equal(v2.release?.childId, "v040-t2-project-registry");
      assert.equal(v2.release?.owner, "project-registry");
      assert.deepEqual(v2.cmd, ["echo", "hi"]);
    }
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

  it("parses containment approval anywhere in V1 and V2 release blocks", () => {
    const v1 = [...guardedAdd("/state", "contract-1", A)];
    v1.splice(8, 0, "--containment-approval", "accepted for this lane");
    const parsedV1 = parseQueueArgv(v1);
    assert.equal(parsedV1.kind, "add");
    if (parsedV1.kind === "add") {
      assert.equal(parsedV1.containmentApproval, "accepted for this lane");
      assert.deepEqual(parsedV1.cmd, ["echo", "hi"]);
    }

    const v2 = [...guardedV2Add("/state", "contract-1", A)];
    const separator = v2.indexOf("--");
    v2.splice(separator, 0, "--containment-approval", "approved V2");
    const parsedV2 = parseQueueArgv(v2);
    assert.equal(parsedV2.kind, "add");
    if (parsedV2.kind === "add") {
      assert.equal(parsedV2.version, "v2");
      assert.equal(parsedV2.containmentApproval, "approved V2");
      assert.deepEqual(parsedV2.cmd, ["echo", "hi"]);
    }
  });

  it("rejects invalid containment approval values without echoing controls", () => {
    const invalidCases: readonly (readonly string[])[] = [
      ["--containment-approval"],
      ["--containment-approval", ""],
      ["--containment-approval", "x".repeat(201)],
      ["--containment-approval", "unsafe\nreason"],
      [
        "--containment-approval",
        "first",
        "--containment-approval",
        "second",
      ],
    ];
    for (const injected of invalidCases) {
      const argv = [...guardedAdd("/state", "contract-1", A)];
      argv.splice(argv.indexOf("--"), 0, ...injected);
      const parsed = parseQueueArgv(argv);
      assert.equal(parsed.kind, "usage");
      if (parsed.kind === "usage") {
        assert.match(parsed.message, /^lane-queue: --containment-approval /);
        assert.ok(!parsed.message.includes("unsafe\nreason"));
        assert.ok(!parsed.message.includes("\n"));
      }
    }
  });

  it("documents containment approval in the canonical add usage", () => {
    assert.match(
      ADD_USAGE,
      /--endstop-candidate-sha SHA256 \[--containment-approval REASON\] \[--release-program/,
    );
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

  it("runs V2 release policy before any ledger or queue admission", async () => {
    const root = mkdtempSync(join(tmpdir(), "endstop-v2-policy-first-"));
    try {
      let policyCalls = 0;
      const io = makeIo();
      const code = await Effect.runPromise(
        runQueueCli(guardedV2Add(root, "missing-root", A), io, {
          releasePolicy: () => {
            policyCalls += 1;
            return Effect.succeed(false);
          },
        }).pipe(Effect.provide(forceLayer)),
      );
      assert.equal(code, EXIT_CONFIG);
      assert.equal(policyCalls, 1);
      assert.equal(io.stderr, "Foreman release policy refused queue admission\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reserves one admitted V2 child action before starting one queue task", async () => {
    const root = mkdtempSync(join(tmpdir(), "endstop-v2-queue-"));
    try {
      const rootContract: ExecutionContractV1 = {
        schemaVersion: 1,
        contractId: "queue-v2-root",
        packageId: "foreman-v040-release",
        objectiveSha256: A,
        acceptanceSha256: B,
        baseCommit: "0".repeat(40),
        allowedPathsSha256: C,
        dependencyContractIds: [],
        authorizationSha256: A,
        createdAt: "2026-08-24T12:00:00Z",
        deadlineAt: "2026-08-24T14:00:00Z",
        limits: strictEndstopLimits,
        requiredMilestones: ["checks"],
      };
      const rootContractSha256 = executionContractSha256(rootContract);
      const sourceBytes = new TextEncoder().encode(
        `${canonicalize(familySource())}\n`,
      );
      const derived = deriveExecutionContractFamilyV2({
        rootContractId: rootContract.contractId,
        rootContractSha256,
        track1Commit: "6".repeat(40),
        track1Tree: "7".repeat(40),
        sourceBytes,
        createdAt: "2026-08-24T12:00:00Z",
      });
      assert.equal(derived._tag, "Valid");
      if (derived._tag !== "Valid") return;
      const candidateCommit = "1".repeat(40);
      const candidate = {
        commit: candidateCommit,
        tree: "2".repeat(40),
        candidateSha256: sha256Hex(candidateCommit),
      };
      const ledgerLayer = makeLiveEndstopLedgerLayer(root);
      await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          yield* ledger.create(rootContract);
          yield* ledger.registerFamilyAuthority({
            rootContractId: rootContract.contractId,
            rootContractSha256,
            manifest: derived.manifest,
            familySha256: derived.familySha256,
            sourceSha256: derived.manifest.sourceSha256,
            auditReceiptSha256: A,
            userReceiptSha256: B,
            registeredAt: "2026-08-24T12:01:00Z",
          });
          yield* ledger.activateFamily({
            rootContractId: rootContract.contractId,
            rootContractSha256,
            familySha256: derived.familySha256,
            sourceSha256: derived.manifest.sourceSha256,
            auditReceiptSha256: A,
            userReceiptSha256: B,
            activatedAt: "2026-08-24T12:02:00Z",
          });
          yield* ledger.registerChildAuthority({
            rootContractId: rootContract.contractId,
            rootContractSha256,
            familySha256: derived.familySha256,
            childId: "v040-t2-project-registry",
            action: "implement",
            effectiveAction: "implement",
            priorReservationId: null,
            originReservationId: null,
            candidate,
            taskPlanSha256: A,
            bundleSha256: B,
            receiptSchemas: ["foreman.design-approval.v1"],
            receiptSha256s: [A],
            evaluationManifestSha256: null,
            registeredAt: "2026-08-24T12:03:00Z",
          });
        }).pipe(Effect.provide(ledgerLayer)),
      );

      let pueueAdds = 0;
      const queueLayer = Layer.mergeAll(
        Layer.succeed(ProcessExec, {
          runCaptured: (input) => {
            const subcommand = input.args[0];
            if (subcommand === "add") {
              pueueAdds += 1;
              return Effect.succeed({ exitCode: 0, stdout: "77\n", stderr: "" });
            }
            return Effect.succeed({ exitCode: 0, stdout: "ok", stderr: "" });
          },
          runIgnoredStdio: () =>
            Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
          runForeground: () => Effect.succeed(0),
        }),
        Layer.succeed(Sleeper, { sleep: () => Effect.void }),
        Layer.succeed(PathLookup, {
          which: (name) => Effect.succeed(`/bin/${name}`),
          fileExists: () => Effect.succeed(false),
          isExecutable: () => Effect.succeed(true),
        }),
        Layer.succeed(BoundedFs, {
          readFileBounded: () => Effect.succeed({ _tag: "Absent" as const }),
        }),
        Layer.succeed(EnvVars, {
          get: (name) => Effect.succeed(
            name === "PUEUE_CONFIG_PATH" ? "/tmp/no-pueue-config.yml" : undefined,
          ),
          home: () => Effect.succeed("/home/test"),
        }),
      );
      const args = guardedV2Add(
        root,
        rootContract.contractId,
        rootContractSha256,
      ).map((value) => value === C ? derived.familySha256 : value);
      const io = makeIo();
      const code = await Effect.runPromise(
        runQueueCli(args, io, {
          releasePolicy: () => Effect.succeed(true),
          reservationId: () => "queue-v2-reservation",
          now: () => new Date("2026-08-24T12:04:00Z"),
        }).pipe(Effect.provide(queueLayer)),
      );
      assert.equal(code, EXIT_OK, io.stderr);
      assert.equal(io.stdout, "77\n");
      assert.equal(pueueAdds, 1);
      const status = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.familyStatus({
            rootContractId: rootContract.contractId,
            rootContractSha256,
            familySha256: derived.familySha256,
          });
        }).pipe(Effect.provide(ledgerLayer)),
      );
      const child = status.family.children["v040-t2-project-registry"];
      assert.equal(child?.counts.totalActions, 1);
      assert.equal(
        child?.reservations["queue-v2-reservation"]?.effectiveAction,
        "implement",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
