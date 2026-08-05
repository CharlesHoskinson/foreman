import { canonicalize, sha256Hex } from "@foreman/core";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { runQueueCli } from "./queue-cli.js";
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
import type { ExecutionActionKind } from "./execution-terminal-policy.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function atMinute(minute: number): string {
  return `2026-08-05T12:${String(minute).padStart(2, "0")}:00Z`;
}

function silentIo(): QueueIo {
  return { writeStdout: () => undefined, writeStderr: () => undefined };
}

describe("Foreman Endstop hostile loop closure", () => {
  it("absorbs changing feedback identities after at most 12 reservations", async () => {
    const root = mkdtempSync(join(tmpdir(), "endstop-loop-"));
    try {
      const contract: ExecutionContractV1 = {
        schemaVersion: 1,
        contractId: "hostile-loop-contract-1",
        packageId: "hostile-loop-package",
        objectiveSha256: A,
        acceptanceSha256: B,
        baseCommit: "1".repeat(40),
        allowedPathsSha256: C,
        dependencyContractIds: [],
        authorizationSha256: A,
        createdAt: "2026-08-05T12:00:00Z",
        deadlineAt: "2026-08-05T14:00:00Z",
        limits: {
          ...strictEndstopLimits,
          implementationRounds: 12,
          correctionRounds: 12,
          auditRounds: 12,
          councilRounds: 12,
          providerRetries: 12,
          resumeAttempts: 12,
          verificationRunsPerCandidate: 12,
        },
        requiredMilestones: ["checks"],
      };
      const contractSha256 = executionContractSha256(contract);
      await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.create(contract);
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
      );

      const feedback: readonly ExecutionActionKind[] = [
        "implement",
        "verify",
        "audit",
        "correct",
        "council",
        "provider_retry",
        "resume",
      ];
      for (let index = 0; index < 12; index += 1) {
        const metadata = {
          lane: `lane-${String(index % 3)}`,
          round: index + 1,
          session: `session-${String(index)}`,
          attempt: index + 100,
        };
        const candidateSha256 = sha256Hex(canonicalize(metadata));
        const action = feedback[index % feedback.length]!;
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const ledger = yield* EndstopLedger;
            return yield* ledger.execute(contract.contractId, contractSha256, {
              _tag: "ReserveAction",
              action,
              candidateSha256,
              ...(action === "verify"
                ? { commandSha256: sha256Hex(canonicalize(["verify", metadata])) }
                : {}),
              reservationId: canonicalize(metadata),
              at: atMinute(index + 1),
            });
          }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
        );
        assert.equal(result.decision._tag, "Accepted");
        assert.equal(result.state.counts.totalActions, index + 1);
      }

      const stopped = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.execute(contract.contractId, contractSha256, {
            _tag: "ReserveAction",
            action: "implement",
            candidateSha256: B,
            reservationId: "new-lane-new-round-new-session-new-attempt",
            at: atMinute(13),
          });
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
      );
      assert.equal(stopped.decision._tag, "Terminated");
      assert.equal(stopped.state._tag, "BudgetExhausted");
      assert.equal(stopped.state.counts.totalActions, 12);

      let externalCalls = 0;
      const noExternalWork = Layer.mergeAll(
        Layer.succeed(ProcessExec, {
          runCaptured: () => { externalCalls += 1; return Effect.die("unexpected"); },
          runIgnoredStdio: () => { externalCalls += 1; return Effect.die("unexpected"); },
          runForeground: () => { externalCalls += 1; return Effect.die("unexpected"); },
        }),
        Layer.succeed(Sleeper, {
          sleep: () => { externalCalls += 1; return Effect.void; },
        }),
        Layer.succeed(PathLookup, {
          which: () => { externalCalls += 1; return Effect.succeed(null); },
          fileExists: () => { externalCalls += 1; return Effect.succeed(false); },
          isExecutable: () => { externalCalls += 1; return Effect.succeed(false); },
        }),
        Layer.succeed(BoundedFs, {
          readFileBounded: () => {
            externalCalls += 1;
            return Effect.succeed({ _tag: "Absent" as const });
          },
        }),
        Layer.succeed(EnvVars, {
          get: () => { externalCalls += 1; return Effect.succeed(undefined); },
          home: () => { externalCalls += 1; return Effect.succeed(undefined); },
        }),
      );

      for (let index = 0; index < 5; index += 1) {
        const candidate = sha256Hex(`late-${String(index)}`);
        const code = await Effect.runPromise(
          runQueueCli(
            [
              "add", "grok",
              "--endstop-state-root", root,
              "--endstop-contract-id", contract.contractId,
              "--endstop-contract-sha", contractSha256,
              "--endstop-action", feedback[index]!,
              "--endstop-candidate-sha", candidate,
              "--", "echo", `late-${String(index)}`,
            ],
            silentIo(),
            {
              now: () => new Date(atMinute(14 + index)),
              reservationId: () => `late-${String(index)}`,
            },
          ).pipe(Effect.provide(noExternalWork)),
        );
        assert.equal(code, 2);
      }
      assert.equal(externalCalls, 0);

      const recovered = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.status(contract.contractId);
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
      );
      assert.equal(recovered._tag, "BudgetExhausted");
      assert.equal(recovered.counts.totalActions, 12);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
