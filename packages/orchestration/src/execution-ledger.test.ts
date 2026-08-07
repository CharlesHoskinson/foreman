import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect, Exit } from "effect";
import {
  EndstopLedger,
  isEndstopLedgerFailure,
  makeLiveEndstopLedgerLayer,
} from "./execution-ledger.js";
import {
  executionContractSha256,
  strictEndstopLimits,
  type ExecutionContractV1,
} from "./execution-contract.js";
import type { ExecutionCommand } from "./execution-terminal-policy.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function contract(
  overrides: Partial<ExecutionContractV1> = {},
): ExecutionContractV1 {
  return {
    schemaVersion: 1,
    contractId: "endstop-ledger-1",
    packageId: "package-ledger",
    objectiveSha256: A,
    acceptanceSha256: B,
    baseCommit: "1".repeat(40),
    allowedPathsSha256: C,
    dependencyContractIds: [],
    authorizationSha256: A,
    createdAt: "2026-08-05T12:00:00Z",
    deadlineAt: "2026-08-05T14:00:00Z",
    limits: strictEndstopLimits,
    requiredMilestones: ["checks"],
    ...overrides,
  };
}

function withRoot<A>(body: (root: string) => Promise<A>): Promise<A> {
  const root = mkdtempSync(join(tmpdir(), "endstop-ledger-"));
  return body(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

function create(root: string, value: ExecutionContractV1) {
  return Effect.gen(function* () {
    const ledger = yield* EndstopLedger;
    return yield* ledger.create(value);
  }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root)));
}

function status(root: string, contractId: string) {
  return Effect.gen(function* () {
    const ledger = yield* EndstopLedger;
    return yield* ledger.status(contractId);
  }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root)));
}

function execute(
  root: string,
  value: ExecutionContractV1,
  action: "implement" | "audit" | "council" | "resume",
  index: number,
) {
  return Effect.gen(function* () {
    const ledger = yield* EndstopLedger;
    return yield* ledger.execute(
      value.contractId,
      executionContractSha256(value),
      {
        _tag: "ReserveAction",
        action,
        candidateSha256: B,
        reservationId: `reservation-${String(index)}`,
        at: `2026-08-05T12:${String(index + 1).padStart(2, "0")}:00Z`,
      },
    );
  }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root)));
}

function executeCommand(
  root: string,
  value: ExecutionContractV1,
  command: ExecutionCommand,
) {
  return Effect.gen(function* () {
    const ledger = yield* EndstopLedger;
    return yield* ledger.execute(
      value.contractId,
      executionContractSha256(value),
      command,
    );
  }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root)));
}

describe("EndstopLedger", () => {
  it("persists a contract outside process and layer lifetime", async () => {
    await withRoot(async (root) => {
      const value = contract();
      const created = await Effect.runPromise(create(root, value));
      assert.equal(created._tag, "Running");

      const recovered = await Effect.runPromise(status(root, value.contractId));
      assert.deepEqual(recovered, created);
    });
  });

  it("rejects changed contract bytes under an existing identifier", async () => {
    await withRoot(async (root) => {
      const value = contract();
      await Effect.runPromise(create(root, value));
      const changed = contract({ objectiveSha256: C });
      const exit = await Effect.runPromiseExit(create(root, changed));
      assert.equal(Exit.isFailure(exit), true);
      if (Exit.isFailure(exit)) {
        const failure = Exit.causeOption(exit);
        assert.equal(failure._tag, "Some");
      }
    });
  });

  it("rebuilds counters after every restart and keeps terminal absorbing", async () => {
    await withRoot(async (root) => {
      const value = contract();
      await Effect.runPromise(create(root, value));
      const first = await Effect.runPromise(execute(root, value, "audit", 0));
      assert.equal(first.state.counts.audit, 1);

      const stopped = await Effect.runPromise(execute(root, value, "audit", 1));
      assert.equal(stopped.state._tag, "BudgetExhausted");

      const late = await Effect.runPromise(execute(root, value, "implement", 2));
      assert.equal(late.decision._tag, "Refused");
      assert.equal(late.state._tag, "BudgetExhausted");

      const recovered = await Effect.runPromise(status(root, value.contractId));
      assert.equal(recovered._tag, "BudgetExhausted");
      assert.equal(recovered.counts.audit, 1);
    });
  });

  it("fails closed for missing and mismatched contracts", async () => {
    await withRoot(async (root) => {
      const missing = await Effect.runPromiseExit(status(root, "missing-contract"));
      assert.equal(Exit.isFailure(missing), true);

      const value = contract();
      await Effect.runPromise(create(root, value));
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.execute(value.contractId, C, {
            _tag: "ReserveAction",
            action: "implement",
            candidateSha256: B,
            reservationId: "wrong-contract",
            at: "2026-08-05T12:01:00Z",
          });
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
      );
      assert.equal(Exit.isFailure(exit), true);
      if (Exit.isFailure(exit)) {
        const failures = Array.from(Exit.causeOption(exit)._tag === "Some" ? [exit] : []);
        assert.equal(failures.length, 1);
      }
    });
  });

  it("publishes closed non-leaking ledger failures", () => {
    assert.equal(isEndstopLedgerFailure({ _tag: "EndstopLedgerFailure", reason: "missing_contract" }), false);
  });

  it("blocks only dependents until every dependency is Completed", async () => {
    await withRoot(async (root) => {
      const prerequisite = contract({
        contractId: "endstop-prerequisite-1",
        packageId: "package-prerequisite",
      });
      const dependent = contract({
        contractId: "endstop-dependent-1",
        packageId: "package-dependent",
        dependencyContractIds: [prerequisite.contractId],
      });
      const independent = contract({
        contractId: "endstop-independent-1",
        packageId: "package-independent",
      });
      await Effect.runPromise(create(root, prerequisite));
      await Effect.runPromise(create(root, dependent));
      await Effect.runPromise(create(root, independent));

      const blocked = await Effect.runPromise(
        execute(root, dependent, "implement", 0).pipe(Effect.either),
      );
      assert.equal(blocked._tag, "Left");
      if (blocked._tag === "Left") assert.equal(blocked.left.reason, "dependency_incomplete");

      const allowed = await Effect.runPromise(execute(root, independent, "implement", 0));
      assert.equal(allowed.decision._tag, "Accepted");

      const completed = await Effect.runPromise(
        executeCommand(root, prerequisite, {
          _tag: "RecordMilestone",
          milestone: "checks",
          candidateSha256: B,
          evidenceSha256: C,
          at: "2026-08-05T12:01:00Z",
        }),
      );
      assert.equal(completed.state._tag, "Completed");

      const admitted = await Effect.runPromise(execute(root, dependent, "implement", 1));
      assert.equal(admitted.decision._tag, "Accepted");
    });
  });

  it("allows replacement only for a terminal predecessor and new authorization", async () => {
    await withRoot(async (root) => {
      const predecessor = contract({
        contractId: "endstop-predecessor-1",
        packageId: "package-replacement",
      });
      await Effect.runPromise(create(root, predecessor));

      const sameAuthorization = contract({
        contractId: "endstop-replacement-same-auth",
        packageId: predecessor.packageId,
        supersedesContractId: predecessor.contractId,
      });
      const beforeTerminal = await Effect.runPromise(
        create(root, sameAuthorization).pipe(Effect.either),
      );
      assert.equal(beforeTerminal._tag, "Left");
      if (beforeTerminal._tag === "Left") {
        assert.equal(beforeTerminal.left.reason, "replacement_unauthorized");
      }

      await Effect.runPromise(
        executeCommand(root, predecessor, {
          _tag: "Cancel",
          authorizationSha256: predecessor.authorizationSha256,
          at: "2026-08-05T12:01:00Z",
        }),
      );
      const stillSame = await Effect.runPromise(
        create(root, sameAuthorization).pipe(Effect.either),
      );
      assert.equal(stillSame._tag, "Left");
      if (stillSame._tag === "Left") {
        assert.equal(stillSame.left.reason, "replacement_unauthorized");
      }

      const authorized = contract({
        contractId: "endstop-replacement-new-auth",
        packageId: predecessor.packageId,
        authorizationSha256: C,
        supersedesContractId: predecessor.contractId,
      });
      const replacement = await Effect.runPromise(create(root, authorized));
      assert.equal(replacement._tag, "Running");
    });
  });
});
