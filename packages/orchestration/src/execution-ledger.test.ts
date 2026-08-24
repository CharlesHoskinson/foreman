import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import { Effect, Exit } from "effect";
import {
  EndstopLedger,
  isEndstopLedgerFailure,
  makeLiveEndstopLedgerLayer,
} from "./execution-ledger.js";
import {
  executionContractFamilySha256,
  executionContractSha256,
  strictEndstopLimits,
  type EvaluationChildLimitsV2,
  type ExecutionChildContractV2,
  type ExecutionContractFamilyV2,
  type ExecutionContractV1,
  type StandardChildLimitsV2,
} from "./execution-contract.js";
import type { ExecutionCommand } from "./execution-terminal-policy.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const CANDIDATE = {
  commit: "2".repeat(40),
  tree: "3".repeat(40),
  candidateSha256: sha256Hex("2".repeat(40)),
};
const OUTPUT_CANDIDATE = {
  commit: "4".repeat(40),
  tree: "5".repeat(40),
  candidateSha256: sha256Hex("4".repeat(40)),
};

const FAMILY_CREATED = "2026-08-24T12:00:00Z";
const FAMILY_DEADLINE = "2026-10-23T12:00:00Z";
const STANDARD_LIMITS: StandardChildLimitsV2 = {
  kind: "standard",
  implementationRounds: 30,
  correctionRounds: 20,
  auditRounds: 20,
  councilRounds: 10,
  providerRetries: 10,
  resumeAttempts: 10,
  verificationRunsPerCandidate: 5,
  totalActions: 100,
  wallTimeMs: 1_209_600_000,
  noProductChangeMs: 259_200_000,
};
const EVALUATION_LIMITS: EvaluationChildLimitsV2 = {
  kind: "evaluation",
  implementationRounds: 10,
  correctionRounds: 5,
  auditRounds: 10,
  councilRounds: 5,
  providerRetries: 8,
  resumeAttempts: 5,
  verificationRunsPerCandidate: 3,
  evaluationRuns: 2000,
  totalActions: 2048,
  wallTimeMs: 3_888_000_000,
  noProgressMs: 3_600_000,
};
const FAMILY_ROWS = [
  [2, "v040-t2-project-registry", "project-registry", []],
  [3, "v040-t3-memory-index", "external-memory-index", ["v040-t2-project-registry"]],
  [4, "v040-t4-appliance", "hermetic-foreman-appliance", []],
  [5, "v040-t5-graphify", "knowledge-plane-refresh", []],
  [6, "v040-t6-work-dag", "work-dag-projection", ["v040-t5-graphify"]],
  [7, "v040-t7-context", "graph-context-builder", ["v040-t6-work-dag"]],
  [
    8,
    "v040-t8-evaluation",
    "graph-eval-falsification",
    ["v040-t3-memory-index", "v040-t4-appliance", "v040-t7-context"],
  ],
  [
    9,
    "v040-t9-release",
    "v040-release-program",
    [
      "v040-t2-project-registry",
      "v040-t3-memory-index",
      "v040-t4-appliance",
      "v040-t5-graphify",
      "v040-t6-work-dag",
      "v040-t7-context",
      "v040-t8-evaluation",
    ],
  ],
] as const;

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

function familyManifest(root: ExecutionContractV1): ExecutionContractFamilyV2 {
  const children: ExecutionChildContractV2[] = FAMILY_ROWS.map(
    ([tranche, childId, packageId, dependencyChildIds]) => ({
      childId,
      tranche,
      packageId,
      objectiveSha256: A,
      acceptanceSha256: B,
      allowedPathsSha256: C,
      dependencyChildIds,
      deadlineAt: FAMILY_DEADLINE,
      limits: tranche === 8 ? EVALUATION_LIMITS : STANDARD_LIMITS,
      requiredMilestones:
        tranche === 9
          ? ["checks", "audit", "integrated", "published"]
          : ["checks", "audit", "integrated"],
    }),
  );
  return {
    schemaVersion: 2,
    familyId: "v040-release-20260822-f1",
    rootContractId: root.contractId,
    rootContractSha256: executionContractSha256(root),
    track1Commit: "6".repeat(40),
    track1Tree: "7".repeat(40),
    sourceSha256: D,
    createdAt: FAMILY_CREATED,
    deadlineAt: FAMILY_DEADLINE,
    wallTimeMs: 5_184_000_000,
    totalActions: 4096,
    children,
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

  it("registers and activates one durable family with V1 carryover", async () => {
    await withRoot(async (root) => {
      const value = contract({
        createdAt: FAMILY_CREATED,
        deadlineAt: "2026-08-24T14:00:00Z",
      });
      const manifest = familyManifest(value);
      const familySha256 = executionContractFamilySha256(manifest);
      const rootContractSha256 = executionContractSha256(value);
      await Effect.runPromise(create(root, value));
      await Effect.runPromise(
        executeCommand(root, value, {
          _tag: "ReserveAction",
          action: "implement",
          candidateSha256: B,
          reservationId: "root-before-family",
          at: "2026-08-24T12:01:00Z",
        }),
      );

      const register = () =>
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.registerFamilyAuthority({
            rootContractId: value.contractId,
            rootContractSha256,
            manifest,
            familySha256,
            sourceSha256: manifest.sourceSha256,
            auditReceiptSha256: A,
            userReceiptSha256: B,
            registeredAt: "2026-08-24T12:02:00Z",
          });
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root)));
      const first = await Effect.runPromise(register());
      assert.equal(first.familySha256, familySha256);
      assert.deepEqual(await Effect.runPromise(register()), first);

      const activate = () =>
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.activateFamily({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256,
            sourceSha256: manifest.sourceSha256,
            auditReceiptSha256: A,
            userReceiptSha256: B,
            activatedAt: "2026-08-24T12:03:00Z",
          });
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root)));
      const activated = await Effect.runPromise(activate());
      assert.equal(activated.family._tag, "Running");
      assert.equal(activated.family.totalActions, 1);

      const recovered = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.familyStatus({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256,
          });
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
      );
      assert.deepEqual(recovered, activated);

      const repeated = await Effect.runPromise(activate().pipe(Effect.either));
      assert.equal(repeated._tag, "Left");
      if (repeated._tag === "Left") {
        assert.equal(repeated.left.reason, "family_already_activated");
      }
      const unscoped = await Effect.runPromise(
        executeCommand(root, value, {
          _tag: "ReserveAction",
          action: "verify",
          candidateSha256: B,
          commandSha256: C,
          reservationId: "root-after-family",
          at: "2026-08-24T12:04:00Z",
        }).pipe(Effect.either),
      );
      assert.equal(unscoped._tag, "Left");
      if (unscoped._tag === "Left") {
        assert.equal(unscoped.left.reason, "family_active");
      }
      const stored = readFileSync(
        join(root, "runs", value.contractId, "events.ndjson"),
        "utf8",
      )
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as { readonly payload: { readonly _tag?: string } });
      assert.deepEqual(
        stored.flatMap((event) =>
          event.payload._tag === undefined ? [] : [event.payload._tag],
        ),
        ["ExecutionFamilyAuthorityRegistered", "EndstopFamilyActivated"],
      );
    });
  });

  it("registers child authority before one atomic reservation", async () => {
    await withRoot(async (root) => {
      const value = contract({
        createdAt: FAMILY_CREATED,
        deadlineAt: "2026-08-24T14:00:00Z",
      });
      const manifest = familyManifest(value);
      const familySha256 = executionContractFamilySha256(manifest);
      const rootContractSha256 = executionContractSha256(value);
      const layer = makeLiveEndstopLedgerLayer(root);
      await Effect.runPromise(create(root, value));
      await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          yield* ledger.registerFamilyAuthority({
            rootContractId: value.contractId,
            rootContractSha256,
            manifest,
            familySha256,
            sourceSha256: manifest.sourceSha256,
            auditReceiptSha256: A,
            userReceiptSha256: B,
            registeredAt: "2026-08-24T12:01:00Z",
          });
          yield* ledger.activateFamily({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256,
            sourceSha256: manifest.sourceSha256,
            auditReceiptSha256: A,
            userReceiptSha256: B,
            activatedAt: "2026-08-24T12:02:00Z",
          });
          return yield* ledger.registerChildAuthority({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256,
            childId: "v040-t4-appliance",
            action: "implement",
            effectiveAction: "implement",
            priorReservationId: null,
            originReservationId: null,
            candidate: CANDIDATE,
            taskPlanSha256: C,
            bundleSha256: D,
            receiptSchemas: ["foreman.design-approval.v1"],
            receiptSha256s: [A],
            evaluationManifestSha256: null,
            registeredAt: "2026-08-24T12:03:00Z",
          });
        }).pipe(Effect.provide(layer)),
      );

      const reserved = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.executeChild({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256,
            childId: "v040-t4-appliance",
            operation: {
              _tag: "ReserveAction",
              reservationId: "child-reservation-1",
              reservationAction: "implement",
              effectiveAction: "implement",
              originReservationId: "child-reservation-1",
              candidate: CANDIDATE,
              taskPlanSha256: C,
              authorityBundleSha256: D,
            },
            at: "2026-08-24T12:04:00Z",
          });
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
      );
      assert.equal(reserved.decision._tag, "Accepted");
      assert.equal(reserved.state.totalActions, 1);
      assert.equal(
        reserved.state.children["v040-t4-appliance"]?.counts.totalActions,
        1,
      );

      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.registerChildOutcome({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256,
            childId: "v040-t4-appliance",
            reservationId: "child-reservation-1",
            originReservationId: "child-reservation-1",
            reservationAction: "implement",
            effectiveAction: "implement",
            candidateSha256: CANDIDATE.candidateSha256,
            outcomeSha256: A,
            outcomeSchema: "foreman.action-outcome.v1",
            registeredAt: "2026-08-24T12:05:00Z",
          });
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
      );
      assert.equal(outcome.outcomeSha256, A);

      const recovered = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.familyStatus({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256,
          });
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
      );
      assert.equal(recovered.childAuthorities.length, 1);
      assert.equal(recovered.childOutcomes.length, 1);
      assert.equal(recovered.family.totalActions, 1);
      assert.equal(
        recovered.family.children["v040-t4-appliance"]?.counts.implement,
        1,
      );
      const payloads = readFileSync(
        join(root, "runs", value.contractId, "events.ndjson"),
        "utf8",
      )
        .trimEnd()
        .split("\n")
        .map(
          (line) =>
            (JSON.parse(line) as { readonly payload: Record<string, unknown> })
              .payload,
        );
      const childAuthority = payloads.find(
        (payload) => payload._tag === "ExecutionChildAuthorityRegistered",
      );
      assert.equal(childAuthority?.rootContractId, value.contractId);
      assert.equal("authority" in (childAuthority ?? {}), false);
      const childDecision = payloads.find(
        (payload) => payload._tag === "EndstopChildDecision",
      );
      assert.equal("at" in (childDecision ?? {}), false);
    });
  });

  it("registers and replays an uncomputable evaluation verdict", async () => {
    await withRoot(async (root) => {
      const value = contract({
        createdAt: FAMILY_CREATED,
        deadlineAt: "2026-08-24T14:00:00Z",
      });
      const manifest = familyManifest(value);
      const familySha256 = executionContractFamilySha256(manifest);
      const rootContractSha256 = executionContractSha256(value);
      const layer = makeLiveEndstopLedgerLayer(root);
      await Effect.runPromise(create(root, value));
      await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          yield* ledger.registerFamilyAuthority({
            rootContractId: value.contractId,
            rootContractSha256,
            manifest,
            familySha256,
            sourceSha256: manifest.sourceSha256,
            auditReceiptSha256: A,
            userReceiptSha256: B,
            registeredAt: "2026-08-24T12:01:00Z",
          });
          yield* ledger.activateFamily({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256,
            sourceSha256: manifest.sourceSha256,
            auditReceiptSha256: A,
            userReceiptSha256: B,
            activatedAt: "2026-08-24T12:02:00Z",
          });
          let second = 123;
          const at = (): string => {
            const value = new Date(
              Date.parse("2026-08-24T12:00:00Z") + second * 1000,
            ).toISOString().replace(".000Z", "Z");
            second += 1;
            return value;
          };
          for (const childId of [
            "v040-t2-project-registry",
            "v040-t3-memory-index",
            "v040-t4-appliance",
            "v040-t5-graphify",
            "v040-t6-work-dag",
            "v040-t7-context",
          ]) {
            yield* ledger.registerChildAuthority({
              rootContractId: value.contractId,
              rootContractSha256,
              familySha256,
              childId,
              action: "implement",
              effectiveAction: "implement",
              priorReservationId: null,
              originReservationId: null,
              candidate: CANDIDATE,
              taskPlanSha256: C,
              bundleSha256: D,
              receiptSchemas: ["foreman.design-approval.v1"],
              receiptSha256s: [A],
              evaluationManifestSha256: null,
              registeredAt: at(),
            });
            const implementReservation = `${childId}-implement`;
            yield* ledger.executeChild({
              rootContractId: value.contractId,
              rootContractSha256,
              familySha256,
              childId,
              operation: {
                _tag: "ReserveAction",
                reservationId: implementReservation,
                reservationAction: "implement",
                effectiveAction: "implement",
                originReservationId: implementReservation,
                candidate: CANDIDATE,
                taskPlanSha256: C,
                authorityBundleSha256: D,
              },
              at: at(),
            });
            yield* ledger.executeChild({
              rootContractId: value.contractId,
              rootContractSha256,
              familySha256,
              childId,
              operation: {
                _tag: "RecordProductChange",
                reservationId: implementReservation,
                originReservationId: implementReservation,
                baseCandidate: CANDIDATE,
                candidate: OUTPUT_CANDIDATE,
                allowedPathsSha256: C,
              },
              at: at(),
            });
            for (const [action, milestone] of [
              ["verify", "checks"],
              ["audit", "audit"],
              ["integrate", "integrated"],
            ] as const) {
              const reservationId = `${childId}-${action}`;
              yield* ledger.registerChildAuthority({
                rootContractId: value.contractId,
                rootContractSha256,
                familySha256,
                childId,
                action,
                effectiveAction: action,
                priorReservationId: null,
                originReservationId: null,
                candidate: OUTPUT_CANDIDATE,
                taskPlanSha256: C,
                bundleSha256: D,
                receiptSchemas: ["foreman.design-approval.v1"],
                receiptSha256s: [A],
                evaluationManifestSha256: null,
                registeredAt: at(),
              });
              yield* ledger.executeChild({
                rootContractId: value.contractId,
                rootContractSha256,
                familySha256,
                childId,
                operation: {
                  _tag: "ReserveAction",
                  reservationId,
                  reservationAction: action,
                  effectiveAction: action,
                  originReservationId: reservationId,
                  candidate: OUTPUT_CANDIDATE,
                  taskPlanSha256: C,
                  authorityBundleSha256: D,
                },
                at: at(),
              });
              yield* ledger.registerChildOutcome({
                rootContractId: value.contractId,
                rootContractSha256,
                familySha256,
                childId,
                reservationId,
                originReservationId: reservationId,
                reservationAction: action,
                effectiveAction: action,
                candidateSha256: OUTPUT_CANDIDATE.candidateSha256,
                outcomeSha256: A,
                outcomeSchema: "foreman.action-outcome.v1",
                registeredAt: at(),
              });
              yield* ledger.executeChild({
                rootContractId: value.contractId,
                rootContractSha256,
                familySha256,
                childId,
                operation: {
                  _tag: "RecordMilestone",
                  milestone,
                  outcomeSha256: A,
                  reservationId,
                  originReservationId: reservationId,
                  candidateSha256: OUTPUT_CANDIDATE.candidateSha256,
                },
                at: at(),
              });
            }
          }
          yield* ledger.registerChildAuthority({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256,
            childId: "v040-t8-evaluation",
            action: "evaluate",
            effectiveAction: "evaluate",
            priorReservationId: null,
            originReservationId: null,
            candidate: CANDIDATE,
            taskPlanSha256: C,
            bundleSha256: D,
            receiptSchemas: ["foreman.evaluation-authority.v1"],
            receiptSha256s: [A],
            evaluationManifestSha256: A,
            registeredAt: at(),
          });
          yield* ledger.executeChild({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256,
            childId: "v040-t8-evaluation",
            operation: {
              _tag: "ReserveAction",
              reservationId: "evaluation-run-1",
              reservationAction: "evaluate",
              effectiveAction: "evaluate",
              originReservationId: "evaluation-run-1",
              candidate: CANDIDATE,
              taskPlanSha256: C,
              authorityBundleSha256: D,
            },
            at: at(),
          });
          return yield* ledger.registerEvaluationVerdict({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256,
            childId: "v040-t8-evaluation",
            candidateSha256: CANDIDATE.candidateSha256,
            result: "GRAPH_OFF_UNCOMPUTABLE",
            completedRuns: 0,
            unavailableRuns: 0,
            notRunRuns: 2000,
            runSetSha256: sha256Hex(canonicalize([])),
            evaluationAuthorityReceiptSha256: A,
            verdictSha256: B,
            registeredAt: at(),
          });
        }).pipe(Effect.provide(layer)),
      );

      const recovered = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.familyStatus({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256,
          });
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
      );
      assert.equal(recovered.evaluationVerdicts.length, 1);
      assert.equal(
        recovered.family.children["v040-t8-evaluation"]?.graphContextEnabled,
        false,
      );
    });
  });
});
