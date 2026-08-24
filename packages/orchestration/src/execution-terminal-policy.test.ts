import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Hex } from "@foreman/core";
import {
  decodeExecutionContractV1,
  executionContractFamilySha256,
  executionContractSha256,
  isExecutionContractFailure,
  isExecutionFamilyFailure,
  strictEndstopLimits,
  type EvaluationChildLimitsV2,
  type ExecutionChildContractV2,
  type ExecutionContractFamilyV2,
  type ExecutionContractV1,
  type StandardChildLimitsV2,
} from "./execution-contract.js";
import {
  decideExecutionChildOperationV2,
  decideExecutionCommand,
  evolveExecutionFamilyV2,
  evolveExecution,
  initialExecutionFamilyStateV2,
  initialExecutionState,
  isExecutionTerminal,
  recordExecutionEvaluationPassV2,
  registerExecutionEvaluationVerdictV2,
  type ExecutionFamilyStateV2,
  type ExecutionV2ChildOperationV1,
  type ExecutionV2Decision,
  type ExecutionCommand,
  type ExecutionEvent,
  type ExecutionState,
  type ExecutionTerminalTag,
} from "./execution-terminal-policy.js";

const H = "a".repeat(64);
const H2 = "b".repeat(64);
const H3 = "c".repeat(64);
const BASE = "1".repeat(40);

function contract(
  overrides: Partial<ExecutionContractV1> = {},
): ExecutionContractV1 {
  return {
    schemaVersion: 1,
    contractId: "endstop-test-1",
    packageId: "package-a",
    objectiveSha256: H,
    acceptanceSha256: H2,
    baseCommit: BASE,
    allowedPathsSha256: H3,
    dependencyContractIds: [],
    authorizationSha256: H,
    createdAt: "2026-08-05T12:00:00Z",
    deadlineAt: "2026-08-05T14:00:00Z",
    limits: strictEndstopLimits,
    requiredMilestones: ["checks", "audit", "integrated", "published"],
    ...overrides,
  };
}

function reserve(
  action: Extract<ExecutionCommand, { readonly _tag: "ReserveAction" }>["action"],
  index: number,
  at = "2026-08-05T12:01:00Z",
): ExecutionCommand {
  return {
    _tag: "ReserveAction",
    action,
    candidateSha256: H2,
    ...(action === "verify" ? { commandSha256: H3 } : {}),
    reservationId: `reservation-${String(index)}`,
    at,
  };
}

function assertContractFailure(value: unknown): void {
  const decoded = decodeExecutionContractV1(value);
  assert.equal(isExecutionContractFailure(decoded), true);
}

function apply(state: ExecutionState, command: ExecutionCommand): ExecutionState {
  const decision = decideExecutionCommand(state, command);
  if (decision._tag === "Accepted" || decision._tag === "Terminated") {
    return decision.events.reduce(evolveExecution, state);
  }
  return state;
}

describe("ExecutionContractV1", () => {
  it("decodes the strict default contract and has stable canonical identity", () => {
    const value = contract();
    assert.deepEqual(decodeExecutionContractV1(value), value);
    assert.equal(executionContractSha256(value), executionContractSha256({ ...value }));
  });

  it("rejects unknown keys, mutable limit values, duplicate dependencies, and reversed time", () => {
    assertContractFailure({ ...contract(), extra: true });
    assertContractFailure({
      ...contract(),
      limits: { ...strictEndstopLimits, totalActions: 0 },
    });
    assertContractFailure({
      ...contract(),
      dependencyContractIds: ["dep-1", "dep-1"],
    });
    assertContractFailure({
      ...contract(),
      deadlineAt: "2026-08-05T11:59:59Z",
    });
    assertContractFailure({ ...contract(), objectiveSha256: 7 });
  });
});

const V2_CREATED = "2026-08-24T12:00:00Z";
const V2_DEADLINE = "2026-10-23T12:00:00Z";
const V2_TASK_SHA = "e".repeat(64);
const V2_BUNDLE_SHA = "f".repeat(64);
const C0 = {
  commit: "2".repeat(40),
  tree: "3".repeat(40),
  candidateSha256: sha256Hex("2".repeat(40)),
};
const C1 = {
  commit: "4".repeat(40),
  tree: "5".repeat(40),
  candidateSha256: sha256Hex("4".repeat(40)),
};
const C2 = {
  commit: "8".repeat(40),
  tree: "9".repeat(40),
  candidateSha256: sha256Hex("8".repeat(40)),
};

const STANDARD_V2_LIMITS: StandardChildLimitsV2 = {
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

const EVALUATION_V2_LIMITS: EvaluationChildLimitsV2 = {
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

const V2_CHILD_ROWS = [
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

function familyV2(): ExecutionContractFamilyV2 {
  const children: ExecutionChildContractV2[] = V2_CHILD_ROWS.map(
    ([tranche, childId, packageId, dependencyChildIds]) => ({
      childId,
      tranche,
      packageId,
      objectiveSha256: H,
      acceptanceSha256: H2,
      allowedPathsSha256: H3,
      dependencyChildIds,
      deadlineAt: V2_DEADLINE,
      limits: tranche === 8 ? EVALUATION_V2_LIMITS : STANDARD_V2_LIMITS,
      requiredMilestones:
        tranche === 9
          ? ["checks", "audit", "integrated", "published"]
          : ["checks", "audit", "integrated"],
    }),
  );
  return {
    schemaVersion: 2,
    familyId: "v040-release-20260822-f1",
    rootContractId: "v040-release-20260822-r5",
    rootContractSha256: H,
    track1Commit: "6".repeat(40),
    track1Tree: "7".repeat(40),
    sourceSha256: H2,
    createdAt: V2_CREATED,
    deadlineAt: V2_DEADLINE,
    wallTimeMs: 5_184_000_000,
    totalActions: 4096,
    children,
  };
}

function initialFamily(priorRootActions = 0): ExecutionFamilyStateV2 {
  const manifest = familyV2();
  const initialized = initialExecutionFamilyStateV2({
    manifest,
    familySha256: executionContractFamilySha256(manifest),
    activatedAt: V2_CREATED,
    priorRootActions,
  });
  assert.equal(isExecutionFamilyFailure(initialized), false);
  if (isExecutionFamilyFailure(initialized)) assert.fail(initialized.reason);
  return initialized;
}

function reservation(
  reservationId: string,
  reservationAction: Extract<
    ExecutionV2ChildOperationV1,
    { readonly _tag: "ReserveAction" }
  >["reservationAction"],
  candidate = C0,
  effectiveAction = reservationAction,
  originReservationId = reservationId,
): Extract<ExecutionV2ChildOperationV1, { readonly _tag: "ReserveAction" }> {
  return {
    _tag: "ReserveAction",
    reservationId,
    reservationAction,
    effectiveAction,
    originReservationId,
    candidate,
    taskPlanSha256: V2_TASK_SHA,
    authorityBundleSha256: V2_BUNDLE_SHA,
  };
}

function decideAndApply(
  state: ExecutionFamilyStateV2,
  childId: string,
  operation: ExecutionV2ChildOperationV1,
  at: string,
): { readonly decision: ExecutionV2Decision; readonly state: ExecutionFamilyStateV2 } {
  const decision = decideExecutionChildOperationV2({
    state,
    childId,
    operation,
    at,
  });
  return {
    decision,
    state: evolveExecutionFamilyV2(state, childId, operation, decision),
  };
}

function withCompletedDependencies(
  state: ExecutionFamilyStateV2,
  childId: string,
): ExecutionFamilyStateV2 {
  const child = state.children[childId]!;
  const children = { ...state.children };
  for (const dependency of child.contract.dependencyChildIds) {
    children[dependency] = {
      ...children[dependency]!,
      _tag: "Completed",
      terminalAt: V2_CREATED,
      terminalReason: "fixture_dependency_complete",
    };
  }
  return { ...state, children };
}

function withEvaluationPasses(
  state: ExecutionFamilyStateV2,
  count: number,
): ExecutionFamilyStateV2 {
  const childId = "v040-t8-evaluation";
  const child = state.children[childId]!;
  if (child.currentCandidate === null) assert.fail("evaluation candidate missing");
  const reservations = { ...child.reservations };
  const origins = Object.values(reservations)
    .filter(
      (item) =>
        item.reservationAction === "evaluate" &&
        item.originReservationId === item.reservationId,
    )
    .map((item) => item.reservationId)
    .sort();
  for (let index = origins.length; index < count; index += 1) {
    const reservationId = `evaluation-pass-${String(index).padStart(4, "0")}`;
    reservations[reservationId] = {
      reservationId,
      reservationAction: "evaluate",
      effectiveAction: "evaluate",
      originReservationId: reservationId,
      candidate: child.currentCandidate,
      taskPlanSha256: V2_TASK_SHA,
      authorityBundleSha256: V2_BUNDLE_SHA,
    };
    origins.push(reservationId);
  }
  const added = count - child.counts.evaluate;
  assert.equal(added >= 0, true);
  return {
    ...state,
    totalActions: state.totalActions + added,
    children: {
      ...state.children,
      [childId]: {
        ...child,
        counts: {
          ...child.counts,
          totalActions: child.counts.totalActions + added,
          evaluate: count,
        },
        reservations,
        evaluationPassOrigins: Object.fromEntries(
          origins.slice(0, count).map((origin) => [origin, H]),
        ),
      },
    },
  };
}

function requireAccepted(decision: ExecutionV2Decision): void {
  if (decision._tag !== "Accepted" && decision._tag !== "Terminated") {
    assert.fail(JSON.stringify(decision));
  }
}

describe("ExecutionContractV2 child policy", () => {
  it("activates only within the manifest time window", () => {
    const manifest = familyV2();
    for (const activatedAt of [
      "2026-08-24T11:59:59Z",
      V2_DEADLINE,
      "2026-08-24T12:00:00.1Z",
    ]) {
      assert.equal(
        isExecutionFamilyFailure(
          initialExecutionFamilyStateV2({
            manifest,
            familySha256: executionContractFamilySha256(manifest),
            activatedAt,
          }),
        ),
        true,
      );
    }
  });

  it("preserves dependency wait and counts V1 carryover in the family budget", () => {
    const waiting = decideExecutionChildOperationV2({
      state: initialFamily(),
      childId: "v040-t3-memory-index",
      operation: reservation("r3", "implement"),
      at: "2026-10-23T11:59:59Z",
    });
    assert.deepEqual(waiting, { _tag: "Refused", reason: "dependency_incomplete" });

    const exhausted = decideExecutionChildOperationV2({
      state: initialFamily(4096),
      childId: "v040-t4-appliance",
      operation: reservation("r4", "implement"),
      at: "2026-08-24T12:00:01Z",
    });
    assert.equal(exhausted._tag, "Terminated");
    if (exhausted._tag === "Terminated") {
      const terminal = exhausted.events.at(-1);
      assert.equal(terminal?._tag, "TerminalDecided");
      if (terminal?._tag !== "TerminalDecided") assert.fail("missing terminal event");
      assert.equal(terminal.terminal, "BudgetExhausted");
    }
  });

  it("keeps evaluate exclusive to tranche eight and reuses verification", () => {
    const standard = decideExecutionChildOperationV2({
      state: initialFamily(),
      childId: "v040-t4-appliance",
      operation: reservation("evaluate-standard", "evaluate"),
      at: "2026-08-24T12:00:01Z",
    });
    assert.deepEqual(standard, { _tag: "Refused", reason: "invalid_operation" });

    let state = initialFamily();
    const first = decideAndApply(
      state,
      "v040-t4-appliance",
      reservation("verify-1", "verify"),
      "2026-08-24T12:00:01Z",
    );
    requireAccepted(first.decision);
    state = first.state;
    const reused = decideExecutionChildOperationV2({
      state,
      childId: "v040-t4-appliance",
      operation: reservation("verify-2", "verify"),
      at: "2026-08-24T12:00:02Z",
    });
    assert.deepEqual(reused, {
      _tag: "ReusedVerification",
      reservationId: "verify-1",
    });
  });

  it("spends one reservation once and enforces standard and evaluation caps", () => {
    const first = decideAndApply(
      initialFamily(),
      "v040-t4-appliance",
      reservation("spent-once", "implement"),
      "2026-08-24T12:00:01Z",
    );
    assert.equal(first.decision._tag, "Accepted");
    if (first.decision._tag !== "Accepted") assert.fail("reservation refused");
    assert.equal(first.decision.events.length, 1);
    assert.equal(first.decision.events[0]?._tag, "ActionReserved");
    assert.equal(first.state.totalActions, 1);
    assert.equal(
      first.state.children["v040-t4-appliance"]?.counts.totalActions,
      1,
    );
    assert.deepEqual(
      decideExecutionChildOperationV2({
        state: first.state,
        childId: "v040-t4-appliance",
        operation: reservation("spent-once", "implement"),
        at: "2026-08-24T12:00:02Z",
      }),
      { _tag: "Refused", reason: "invalid_operation" },
    );

    const standard = initialFamily();
    const standardChild = standard.children["v040-t4-appliance"]!;
    const standardAtLimit: ExecutionFamilyStateV2 = {
      ...standard,
      totalActions: 30,
      children: {
        ...standard.children,
        "v040-t4-appliance": {
          ...standardChild,
          counts: {
            ...standardChild.counts,
            totalActions: 30,
            implement: 30,
          },
        },
      },
    };
    const standardLimit = decideExecutionChildOperationV2({
      state: standardAtLimit,
      childId: "v040-t4-appliance",
      operation: reservation("standard-limit", "implement"),
      at: "2026-08-24T12:00:01Z",
    });
    assert.equal(standardLimit._tag, "Terminated");
    if (standardLimit._tag !== "Terminated") assert.fail("limit not enforced");
    assert.equal(standardLimit.events.at(-1)?._tag, "TerminalDecided");

    const evaluation = withCompletedDependencies(
      initialFamily(),
      "v040-t8-evaluation",
    );
    const evaluationChild = evaluation.children["v040-t8-evaluation"]!;
    const evaluationAtLimit: ExecutionFamilyStateV2 = {
      ...evaluation,
      totalActions: 2000,
      children: {
        ...evaluation.children,
        "v040-t8-evaluation": {
          ...evaluationChild,
          counts: {
            ...evaluationChild.counts,
            totalActions: 2000,
            evaluate: 2000,
          },
        },
      },
    };
    const evaluationLimit = decideExecutionChildOperationV2({
      state: evaluationAtLimit,
      childId: "v040-t8-evaluation",
      operation: reservation("evaluation-2001", "evaluate"),
      at: "2026-08-24T12:00:01Z",
    });
    assert.equal(evaluationLimit._tag, "Terminated");
    if (evaluationLimit._tag !== "Terminated") {
      assert.fail("evaluation limit not enforced");
    }
    const terminal = evaluationLimit.events.at(-1);
    assert.equal(terminal?._tag, "TerminalDecided");
    if (terminal?._tag !== "TerminalDecided") assert.fail("missing terminal");
    assert.equal(terminal.reason, "evaluate_limit");
  });

  it("uses exact child wall and evaluation progress boundaries", () => {
    let standard = decideAndApply(
      initialFamily(),
      "v040-t4-appliance",
      reservation("standard-1", "implement"),
      "2026-08-24T12:00:00Z",
    ).state;
    const wall = decideExecutionChildOperationV2({
      state: standard,
      childId: "v040-t4-appliance",
      operation: reservation("standard-2", "verify"),
      at: "2026-09-07T12:00:00Z",
    });
    assert.equal(wall._tag, "Terminated");
    if (wall._tag !== "Terminated") assert.fail("wall limit not enforced");
    const wallTerminal = wall.events.at(-1);
    assert.equal(wallTerminal?._tag, "TerminalDecided");
    if (wallTerminal?._tag !== "TerminalDecided") {
      assert.fail("missing wall terminal event");
    }
    assert.equal(wallTerminal.reason, "child_wall_time_limit");

    const noProduct = decideExecutionChildOperationV2({
      state: standard,
      childId: "v040-t4-appliance",
      operation: reservation("standard-no-product", "verify"),
      at: "2026-08-27T12:00:00Z",
    });
    assert.equal(noProduct._tag, "Terminated");
    if (noProduct._tag !== "Terminated") {
      assert.fail("no-product limit not enforced");
    }
    const noProductTerminal = noProduct.events.at(-1);
    assert.equal(noProductTerminal?._tag, "TerminalDecided");
    if (noProductTerminal?._tag !== "TerminalDecided") {
      assert.fail("missing no-product terminal event");
    }
    assert.equal(noProductTerminal.reason, "no_product_change_limit");

    let evaluation = decideAndApply(
      withCompletedDependencies(initialFamily(), "v040-t8-evaluation"),
      "v040-t8-evaluation",
      reservation("eval-1", "evaluate"),
      "2026-08-24T12:00:00Z",
    ).state;
    const stalled = decideExecutionChildOperationV2({
      state: evaluation,
      childId: "v040-t8-evaluation",
      operation: reservation("eval-2", "evaluate"),
      at: "2026-08-24T13:00:00Z",
    });
    assert.equal(stalled._tag, "Terminated");
    if (stalled._tag !== "Terminated") assert.fail("progress limit not enforced");
    const progressTerminal = stalled.events.at(-1);
    assert.equal(progressTerminal?._tag, "TerminalDecided");
    if (progressTerminal?._tag !== "TerminalDecided") {
      assert.fail("missing progress terminal event");
    }
    assert.equal(progressTerminal.reason, "no_progress_limit");

    evaluation = recordExecutionEvaluationPassV2({
      state: evaluation,
      childId: "v040-t8-evaluation",
      originReservationId: "eval-1",
      outcomeSha256: H,
      at: "2026-08-24T12:59:59Z",
    });
    const afterProgress = decideExecutionChildOperationV2({
      state: evaluation,
      childId: "v040-t8-evaluation",
      operation: reservation("eval-2", "evaluate"),
      at: "2026-08-24T13:00:00Z",
    });
    assert.equal(afterProgress._tag, "Accepted");

    let preEvaluation = decideAndApply(
      withCompletedDependencies(initialFamily(), "v040-t8-evaluation"),
      "v040-t8-evaluation",
      reservation("pre-evaluation-implement", "implement"),
      "2026-08-24T12:00:00Z",
    ).state;
    preEvaluation = decideAndApply(
      preEvaluation,
      "v040-t8-evaluation",
      reservation("pre-evaluation-verify", "verify"),
      "2026-08-24T12:59:59Z",
    ).state;
    const preEvaluationStalled = decideExecutionChildOperationV2({
      state: preEvaluation,
      childId: "v040-t8-evaluation",
      operation: reservation("pre-evaluation-run", "evaluate"),
      at: "2026-08-24T13:00:00Z",
    });
    assert.equal(preEvaluationStalled._tag, "Terminated");
    if (preEvaluationStalled._tag !== "Terminated") {
      assert.fail("pre-evaluation progress limit not enforced");
    }
    const preEvaluationTerminal = preEvaluationStalled.events.at(-1);
    assert.equal(preEvaluationTerminal?._tag, "TerminalDecided");
    if (preEvaluationTerminal?._tag !== "TerminalDecided") {
      assert.fail("missing pre-evaluation terminal event");
    }
    assert.equal(preEvaluationTerminal.reason, "no_progress_limit");
  });

  it("binds product changes, retry origins, milestones, and completion", () => {
    let state = initialFamily();
    state = decideAndApply(
      state,
      "v040-t4-appliance",
      reservation("implement-1", "implement"),
      "2026-08-24T12:00:01Z",
    ).state;
    const product: ExecutionV2ChildOperationV1 = {
      _tag: "RecordProductChange",
      reservationId: "implement-1",
      originReservationId: "implement-1",
      baseCandidate: C0,
      candidate: C1,
      allowedPathsSha256: H3,
    };
    const changed = decideAndApply(
      state,
      "v040-t4-appliance",
      product,
      "2026-08-24T12:00:02Z",
    );
    requireAccepted(changed.decision);
    state = changed.state;

    state = decideAndApply(
      state,
      "v040-t4-appliance",
      reservation("verify-origin", "verify", C1),
      "2026-08-24T12:00:03Z",
    ).state;
    const retry = reservation(
      "verify-retry",
      "provider_retry",
      C1,
      "verify",
      "verify-origin",
    );
    const retried = decideAndApply(
      state,
      "v040-t4-appliance",
      retry,
      "2026-08-24T12:00:04Z",
    );
    requireAccepted(retried.decision);
    state = retried.state;
    assert.deepEqual(
      decideExecutionChildOperationV2({
        state,
        childId: "v040-t4-appliance",
        operation: { ...retry, reservationId: "bad-retry", originReservationId: "other" },
        at: "2026-08-24T12:00:05Z",
      }),
      { _tag: "Refused", reason: "invalid_retry" },
    );

    const milestones = [
      ["checks", "verify-retry", "verify-origin", null, "2026-08-24T12:00:05Z"],
      ["audit", "audit-1", "audit-1", "2026-08-24T12:00:06Z", "2026-08-24T12:00:07Z"],
      ["integrated", "integrate-1", "integrate-1", "2026-08-24T12:00:08Z", "2026-08-24T12:00:09Z"],
    ] as const;
    for (const [milestone, reservationId, originReservationId, reservationAt, milestoneAt] of milestones) {
      if (reservationAt !== null) {
        const action = milestone === "audit" ? "audit" : "integrate";
        state = decideAndApply(
          state,
          "v040-t4-appliance",
          reservation(reservationId, action, C1),
          reservationAt,
        ).state;
      }
      const recorded = decideAndApply(
        state,
        "v040-t4-appliance",
        {
          _tag: "RecordMilestone",
          milestone,
          outcomeSha256: H2,
          reservationId,
          originReservationId,
          candidateSha256: C1.candidateSha256,
        },
        milestoneAt,
      );
      requireAccepted(recorded.decision);
      state = recorded.state;
    }
    assert.equal(state.children["v040-t4-appliance"]?._tag, "Completed");
  });

  it("requires a product change and records milestones in contract order", () => {
    let state = decideAndApply(
      initialFamily(),
      "v040-t4-appliance",
      reservation("implement-order", "implement"),
      "2026-08-24T12:00:01Z",
    ).state;
    state = decideAndApply(
      state,
      "v040-t4-appliance",
      reservation("verify-before-product", "verify"),
      "2026-08-24T12:00:02Z",
    ).state;
    assert.deepEqual(
      decideExecutionChildOperationV2({
        state,
        childId: "v040-t4-appliance",
        operation: {
          _tag: "RecordMilestone",
          milestone: "checks",
          outcomeSha256: H,
          reservationId: "verify-before-product",
          originReservationId: "verify-before-product",
          candidateSha256: C0.candidateSha256,
        },
        at: "2026-08-24T12:00:03Z",
      }),
      { _tag: "Refused", reason: "invalid_operation" },
    );

    state = decideAndApply(
      state,
      "v040-t4-appliance",
      {
        _tag: "RecordProductChange",
        reservationId: "implement-order",
        originReservationId: "implement-order",
        baseCandidate: C0,
        candidate: C1,
        allowedPathsSha256: H3,
      },
      "2026-08-24T12:00:04Z",
    ).state;
    state = decideAndApply(
      state,
      "v040-t4-appliance",
      reservation("audit-before-checks", "audit", C1),
      "2026-08-24T12:00:05Z",
    ).state;
    assert.deepEqual(
      decideExecutionChildOperationV2({
        state,
        childId: "v040-t4-appliance",
        operation: {
          _tag: "RecordMilestone",
          milestone: "audit",
          outcomeSha256: H2,
          reservationId: "audit-before-checks",
          originReservationId: "audit-before-checks",
          candidateSha256: C1.candidateSha256,
        },
        at: "2026-08-24T12:00:06Z",
      }),
      { _tag: "Refused", reason: "invalid_operation" },
    );
  });

  it("advances product changes from the current base and clears milestones", () => {
    let state = decideAndApply(
      initialFamily(),
      "v040-t4-appliance",
      reservation("implement-first", "implement"),
      "2026-08-24T12:00:01Z",
    ).state;
    state = decideAndApply(
      state,
      "v040-t4-appliance",
      {
        _tag: "RecordProductChange",
        reservationId: "implement-first",
        originReservationId: "implement-first",
        baseCandidate: C0,
        candidate: C1,
        allowedPathsSha256: H3,
      },
      "2026-08-24T12:00:02Z",
    ).state;
    state = decideAndApply(
      state,
      "v040-t4-appliance",
      reservation("verify-first", "verify", C1),
      "2026-08-24T12:00:03Z",
    ).state;
    state = decideAndApply(
      state,
      "v040-t4-appliance",
      {
        _tag: "RecordMilestone",
        milestone: "checks",
        outcomeSha256: H,
        reservationId: "verify-first",
        originReservationId: "verify-first",
        candidateSha256: C1.candidateSha256,
      },
      "2026-08-24T12:00:04Z",
    ).state;
    state = decideAndApply(
      state,
      "v040-t4-appliance",
      reservation("correct-second", "correct", C1),
      "2026-08-24T12:00:05Z",
    ).state;
    const advanced = decideAndApply(
      state,
      "v040-t4-appliance",
      {
        _tag: "RecordProductChange",
        reservationId: "correct-second",
        originReservationId: "correct-second",
        baseCandidate: C1,
        candidate: C2,
        allowedPathsSha256: H3,
      },
      "2026-08-24T12:00:06Z",
    );
    requireAccepted(advanced.decision);
    const child = advanced.state.children["v040-t4-appliance"]!;
    assert.deepEqual(child.currentCandidate, C2);
    assert.equal(child.productChangeCount, 2);
    assert.deepEqual(child.milestones, {});
    assert.equal(child.milestoneCandidateSha256, null);
    assert.deepEqual(
      decideExecutionChildOperationV2({
        state: advanced.state,
        childId: "v040-t4-appliance",
        operation: {
          _tag: "RecordProductChange",
          reservationId: "correct-second",
          originReservationId: "correct-second",
          baseCandidate: C0,
          candidate: C1,
          allowedPathsSha256: H3,
        },
        at: "2026-08-24T12:00:07Z",
      }),
      { _tag: "Refused", reason: "candidate_mismatch" },
    );
  });

  it("preserves effective actions and origins across retries and resumes", () => {
    let state = initialFamily();
    for (const [operation, at] of [
      [reservation("verify-origin-chain", "verify"), "2026-08-24T12:00:01Z"],
      [
        reservation(
          "verify-retry-chain",
          "provider_retry",
          C0,
          "verify",
          "verify-origin-chain",
        ),
        "2026-08-24T12:00:02Z",
      ],
      [
        reservation(
          "verify-resume-chain",
          "resume",
          C0,
          "verify",
          "verify-origin-chain",
        ),
        "2026-08-24T12:00:03Z",
      ],
      [reservation("audit-origin-chain", "audit"), "2026-08-24T12:00:04Z"],
      [
        reservation(
          "audit-retry-chain",
          "provider_retry",
          C0,
          "audit",
          "audit-origin-chain",
        ),
        "2026-08-24T12:00:05Z",
      ],
    ] as const) {
      const applied = decideAndApply(
        state,
        "v040-t4-appliance",
        operation,
        at,
      );
      requireAccepted(applied.decision);
      state = applied.state;
    }
    const child = state.children["v040-t4-appliance"]!;
    assert.equal(child.counts.verify, 1);
    assert.equal(child.counts.audit, 1);
    assert.equal(child.counts.provider_retry, 2);
    assert.equal(child.counts.resume, 1);
    assert.equal(
      child.reservations["audit-retry-chain"]?.effectiveAction,
      "audit",
    );
    assert.equal(
      child.reservations["verify-resume-chain"]?.originReservationId,
      "verify-origin-chain",
    );
  });

  it("requires the evaluation verdict and preserves graph-off completion", () => {
    let state = decideAndApply(
      withCompletedDependencies(initialFamily(), "v040-t8-evaluation"),
      "v040-t8-evaluation",
      reservation("eval-origin", "evaluate"),
      "2026-08-24T12:00:01Z",
    ).state;
    state = withEvaluationPasses(state, 2000);
    const registered = registerExecutionEvaluationVerdictV2({
      state,
      childId: "v040-t8-evaluation",
      verdict: {
        candidateSha256: C0.candidateSha256,
        result: "GRAPH_OFF_INCONCLUSIVE",
        completedRuns: 2000,
        unavailableRuns: 0,
        notRunRuns: 0,
        runSetSha256: H2,
        verdictSha256: H3,
      },
    });
    if (registered._tag !== "Accepted") assert.fail(registered.reason);
    assert.equal(
      registered.state.children["v040-t8-evaluation"]?.graphContextEnabled,
      false,
    );
  });

  it("accepts every bounded evaluation result before terminal state only", () => {
    const running = decideAndApply(
      withCompletedDependencies(initialFamily(), "v040-t8-evaluation"),
      "v040-t8-evaluation",
      reservation("eval-result-origin", "evaluate"),
      "2026-08-24T12:00:01Z",
    ).state;
    for (const result of [
      "PROMOTE",
      "GRAPH_OFF_FAILED",
      "GRAPH_OFF_INCONCLUSIVE",
      "GRAPH_OFF_UNCOMPUTABLE",
    ] as const) {
      const completedRuns = result === "GRAPH_OFF_UNCOMPUTABLE" ? 1 : 2000;
      const state = withEvaluationPasses(running, completedRuns);
      const verdict = {
        candidateSha256: C0.candidateSha256,
        result,
        completedRuns,
        unavailableRuns: result === "GRAPH_OFF_UNCOMPUTABLE" ? 999 : 0,
        notRunRuns: result === "GRAPH_OFF_UNCOMPUTABLE" ? 1000 : 0,
        runSetSha256: H2,
        verdictSha256: H3,
      };
      const registered = registerExecutionEvaluationVerdictV2({
        state,
        childId: "v040-t8-evaluation",
        verdict,
      });
      if (registered._tag !== "Accepted") assert.fail(registered.reason);
      assert.equal(
        registered.state.children["v040-t8-evaluation"]?.graphContextEnabled,
        result === "PROMOTE",
      );

      const terminalState: ExecutionFamilyStateV2 = {
        ...state,
        _tag: "Cancelled",
        terminalAt: "2026-08-24T12:00:02Z",
        terminalReason: "fixture_terminal",
      };
      assert.deepEqual(
        registerExecutionEvaluationVerdictV2({
          state: terminalState,
          childId: "v040-t8-evaluation",
          verdict,
        }),
        { _tag: "Refused", reason: "invalid_verdict" },
      );
    }
  });

  it("rejects evaluation PASS origins without matching reservations", () => {
    const running = decideAndApply(
      withCompletedDependencies(initialFamily(), "v040-t8-evaluation"),
      "v040-t8-evaluation",
      reservation("real-evaluation-origin", "evaluate"),
      "2026-08-24T12:00:01Z",
    ).state;
    const child = running.children["v040-t8-evaluation"]!;
    const state: ExecutionFamilyStateV2 = {
      ...running,
      children: {
        ...running.children,
        "v040-t8-evaluation": {
          ...child,
          evaluationPassOrigins: { "ghost-evaluation-origin": H },
        },
      },
    };
    assert.deepEqual(
      registerExecutionEvaluationVerdictV2({
        state,
        childId: "v040-t8-evaluation",
        verdict: {
          candidateSha256: C0.candidateSha256,
          result: "GRAPH_OFF_UNCOMPUTABLE",
          completedRuns: 1,
          unavailableRuns: 999,
          notRunRuns: 1000,
          runSetSha256: H2,
          verdictSha256: H3,
        },
      }),
      { _tag: "Refused", reason: "run_count_mismatch" },
    );
  });

  it("requires an evaluation verdict before the final milestone", () => {
    let state = decideAndApply(
      withCompletedDependencies(initialFamily(), "v040-t8-evaluation"),
      "v040-t8-evaluation",
      reservation("evaluation-implement", "implement"),
      "2026-08-24T12:00:01Z",
    ).state;
    state = decideAndApply(
      state,
      "v040-t8-evaluation",
      {
        _tag: "RecordProductChange",
        reservationId: "evaluation-implement",
        originReservationId: "evaluation-implement",
        baseCandidate: C0,
        candidate: C1,
        allowedPathsSha256: H3,
      },
      "2026-08-24T12:00:02Z",
    ).state;
    state = withEvaluationPasses(state, 1);

    for (const [milestone, action, reservationId, at, milestoneAt] of [
      ["checks", "verify", "evaluation-checks", "2026-08-24T12:00:03Z", "2026-08-24T12:00:04Z"],
      ["audit", "audit", "evaluation-audit", "2026-08-24T12:00:05Z", "2026-08-24T12:00:06Z"],
    ] as const) {
      state = decideAndApply(
        state,
        "v040-t8-evaluation",
        reservation(reservationId, action, C1),
        at,
      ).state;
      state = decideAndApply(
        state,
        "v040-t8-evaluation",
        {
          _tag: "RecordMilestone",
          milestone,
          outcomeSha256: H,
          reservationId,
          originReservationId: reservationId,
          candidateSha256: C1.candidateSha256,
        },
        milestoneAt,
      ).state;
    }
    state = decideAndApply(
      state,
      "v040-t8-evaluation",
      reservation("evaluation-integrate", "integrate", C1),
      "2026-08-24T12:00:07Z",
    ).state;
    const finalMilestone: ExecutionV2ChildOperationV1 = {
      _tag: "RecordMilestone",
      milestone: "integrated",
      outcomeSha256: H2,
      reservationId: "evaluation-integrate",
      originReservationId: "evaluation-integrate",
      candidateSha256: C1.candidateSha256,
    };
    assert.deepEqual(
      decideExecutionChildOperationV2({
        state,
        childId: "v040-t8-evaluation",
        operation: finalMilestone,
        at: "2026-08-24T12:00:08Z",
      }),
      { _tag: "Refused", reason: "invalid_operation" },
    );

    const verdict = registerExecutionEvaluationVerdictV2({
      state,
      childId: "v040-t8-evaluation",
      verdict: {
        candidateSha256: C1.candidateSha256,
        result: "GRAPH_OFF_UNCOMPUTABLE",
        completedRuns: 1,
        unavailableRuns: 999,
        notRunRuns: 1000,
        runSetSha256: H2,
        verdictSha256: H3,
      },
    });
    if (verdict._tag !== "Accepted") assert.fail(verdict.reason);
    const completed = decideAndApply(
      verdict.state,
      "v040-t8-evaluation",
      finalMilestone,
      "2026-08-24T12:00:08Z",
    );
    assert.equal(completed.decision._tag, "Terminated");
    assert.equal(completed.state.children["v040-t8-evaluation"]?._tag, "Completed");
    assert.equal(
      completed.state.children["v040-t8-evaluation"]?.graphContextEnabled,
      false,
    );
  });

  it("releases a dependent child only after predecessor completion", () => {
    let state = initialFamily();
    const childId = "v040-t2-project-registry";
    const steps: readonly (readonly [ExecutionV2ChildOperationV1, string])[] = [
      [reservation("dependency-implement", "implement"), "2026-08-24T12:00:01Z"],
      [
        {
          _tag: "RecordProductChange",
          reservationId: "dependency-implement",
          originReservationId: "dependency-implement",
          baseCandidate: C0,
          candidate: C1,
          allowedPathsSha256: H3,
        },
        "2026-08-24T12:00:02Z",
      ],
      [reservation("dependency-verify", "verify", C1), "2026-08-24T12:00:03Z"],
      [
        {
          _tag: "RecordMilestone",
          milestone: "checks",
          outcomeSha256: H,
          reservationId: "dependency-verify",
          originReservationId: "dependency-verify",
          candidateSha256: C1.candidateSha256,
        },
        "2026-08-24T12:00:04Z",
      ],
      [reservation("dependency-audit", "audit", C1), "2026-08-24T12:00:05Z"],
      [
        {
          _tag: "RecordMilestone",
          milestone: "audit",
          outcomeSha256: H2,
          reservationId: "dependency-audit",
          originReservationId: "dependency-audit",
          candidateSha256: C1.candidateSha256,
        },
        "2026-08-24T12:00:06Z",
      ],
      [
        reservation("dependency-integrate", "integrate", C1),
        "2026-08-24T12:00:07Z",
      ],
      [
        {
          _tag: "RecordMilestone",
          milestone: "integrated",
          outcomeSha256: H3,
          reservationId: "dependency-integrate",
          originReservationId: "dependency-integrate",
          candidateSha256: C1.candidateSha256,
        },
        "2026-08-24T12:00:08Z",
      ],
    ];
    for (const [operation, at] of steps) {
      const applied = decideAndApply(state, childId, operation, at);
      requireAccepted(applied.decision);
      state = applied.state;
    }
    assert.equal(state.children[childId]?._tag, "Completed");
    assert.equal(
      decideExecutionChildOperationV2({
        state,
        childId: "v040-t3-memory-index",
        operation: reservation("dependent-start", "implement"),
        at: "2026-08-24T12:00:09Z",
      })._tag,
      "Accepted",
    );
  });

  it("handles blocking, external failure, cancellation, and invalidation", () => {
    let state = decideAndApply(
      initialFamily(),
      "v040-t4-appliance",
      reservation("blocking-verify", "verify"),
      "2026-08-24T12:00:01Z",
    ).state;
    const blocking: ExecutionV2ChildOperationV1 = {
      _tag: "RecordBlockingOutcome",
      outcomeSha256: H,
      reservationId: "blocking-verify",
      originReservationId: "blocking-verify",
      candidateSha256: C0.candidateSha256,
    };
    assert.deepEqual(
      decideExecutionChildOperationV2({
        state,
        childId: "v040-t4-appliance",
        operation: blocking,
        at: "2026-08-24T12:00:02Z",
      }),
      { _tag: "Accepted", events: [] },
    );
    const child = state.children["v040-t4-appliance"]!;
    const external: ExecutionV2ChildOperationV1 = {
      _tag: "RecordExternalFailure",
      outcomeSha256: H2,
      reservationId: "blocking-verify",
      originReservationId: "blocking-verify",
      candidateSha256: C0.candidateSha256,
    };
    assert.deepEqual(
      decideExecutionChildOperationV2({
        state,
        childId: "v040-t4-appliance",
        operation: external,
        at: "2026-08-24T12:00:02Z",
      }),
      { _tag: "Accepted", events: [] },
    );
    const retryExhausted: ExecutionFamilyStateV2 = {
      ...state,
      children: {
        ...state.children,
        "v040-t4-appliance": {
          ...child,
          counts: {
            ...child.counts,
            provider_retry: child.contract.limits.providerRetries,
          },
        },
      },
    };
    assert.equal(
      decideExecutionChildOperationV2({
        state: retryExhausted,
        childId: "v040-t4-appliance",
        operation: external,
        at: "2026-08-24T12:00:03Z",
      })._tag,
      "Terminated",
    );
    state = {
      ...state,
      children: {
        ...state.children,
        "v040-t4-appliance": {
          ...child,
          counts: {
            ...child.counts,
            correct: child.contract.limits.correctionRounds,
          },
        },
      },
    };
    assert.equal(
      decideExecutionChildOperationV2({
        state,
        childId: "v040-t4-appliance",
        operation: blocking,
        at: "2026-08-24T12:00:03Z",
      })._tag,
      "Terminated",
    );

    assert.deepEqual(
      decideExecutionChildOperationV2({
        state: initialFamily(),
        childId: "v040-t4-appliance",
        operation: {
          _tag: "Cancel",
          approvalSha256: "bad",
          reasonSha256: H,
        },
        at: "2026-08-24T12:00:01Z",
      }),
      { _tag: "Refused", reason: "invalid_operation" },
    );
    assert.deepEqual(
      decideExecutionChildOperationV2({
        state: initialFamily(),
        childId: "v040-t4-appliance",
        operation: {
          _tag: "Invalidate",
          approvalSha256: H,
          observedFamilySha256: initialFamily().familySha256,
          reasonSha256: H2,
        },
        at: "2026-08-24T12:00:01Z",
      }),
      { _tag: "Accepted", events: [] },
    );
  });

  it("propagates a child terminal without resetting sibling state", () => {
    let state = decideAndApply(
      initialFamily(),
      "v040-t2-project-registry",
      reservation("sibling-work", "implement"),
      "2026-08-24T12:00:01Z",
    ).state;
    const sibling = state.children["v040-t2-project-registry"];
    const cancelled = decideAndApply(
      state,
      "v040-t4-appliance",
      { _tag: "Cancel", approvalSha256: H, reasonSha256: H2 },
      "2026-08-24T12:00:02Z",
    );
    assert.equal(cancelled.state._tag, "Cancelled");
    assert.deepEqual(
      cancelled.state.children["v040-t2-project-registry"],
      sibling,
    );
    assert.deepEqual(
      decideExecutionChildOperationV2({
        state: cancelled.state,
        childId: "v040-t2-project-registry",
        operation: reservation("late", "verify"),
        at: "2026-08-24T12:00:03Z",
      }),
      { _tag: "Refused", reason: "family_terminal" },
    );
  });
});

describe("Endstop terminal policy", () => {
  it("keeps every terminal state absorbing", () => {
    const terminalTags: readonly ExecutionTerminalTag[] = [
      "Completed",
      "Escalated",
      "Stalled",
      "BudgetExhausted",
      "Cancelled",
      "Invalidated",
      "BlockedExternal",
    ];
    for (const tag of terminalTags) {
      const running = initialExecutionState(contract());
      const terminal: ExecutionState = {
        ...running,
        _tag: tag,
        terminalAt: "2026-08-05T12:05:00Z",
        terminalReason: "test_terminal",
      };
      const event: ExecutionEvent = {
        _tag: "ActionReserved",
        action: "implement",
        candidateSha256: H2,
        reservationId: "late-reservation",
        at: "2026-08-05T12:06:00Z",
      };
      assert.deepEqual(evolveExecution(terminal, event), terminal, tag);
      assert.equal(decideExecutionCommand(terminal, reserve("implement", 9))._tag, "Refused");
    }
  });

  it("reaches a terminal within the shared total action bound", () => {
    let state: ExecutionState = initialExecutionState(
      contract({
        limits: {
          ...strictEndstopLimits,
          implementationRounds: 12,
          correctionRounds: 12,
          auditRounds: 12,
          councilRounds: 12,
          providerRetries: 12,
          resumeAttempts: 12,
        },
      }),
    );
    const cycle = [
      "implement",
      "verify",
      "audit",
      "correct",
      "council",
      "provider_retry",
      "resume",
    ] as const;
    for (let index = 0; index < 40 && !isExecutionTerminal(state); index += 1) {
      state = apply(state, reserve(cycle[index % cycle.length]!, index));
    }
    assert.equal(state._tag, "BudgetExhausted");
    assert.equal(state.counts.totalActions, 12);
    assert.equal(decideExecutionCommand(state, reserve("implement", 99))._tag, "Refused");
  });

  it("uses one audit, one correction, one Council round, and two resumes", () => {
    const limits: readonly [
      Extract<ExecutionCommand, { readonly _tag: "ReserveAction" }>["action"],
      number,
      ExecutionTerminalTag,
    ][] = [
      ["audit", 1, "BudgetExhausted"],
      ["correct", 1, "BudgetExhausted"],
      ["council", 1, "BudgetExhausted"],
      ["resume", 2, "BudgetExhausted"],
    ];
    for (const [action, allowed, terminal] of limits) {
      let state: ExecutionState = initialExecutionState(contract());
      for (let index = 0; index < allowed; index += 1) {
        state = apply(state, reserve(action, index));
        assert.equal(state._tag, "Running", action);
      }
      state = apply(state, reserve(action, allowed));
      assert.equal(state._tag, terminal, action);
    }
  });

  it("refuses verification without a command hash", () => {
    const decision = decideExecutionCommand(initialExecutionState(contract()), {
      _tag: "ReserveAction",
      action: "verify",
      candidateSha256: H2,
      reservationId: "missing-command-hash",
      at: "2026-08-05T12:01:00Z",
    });
    assert.deepEqual(decision, { _tag: "Refused", reason: "invalid_command" });
  });

  it("stalls on review activity without product change", () => {
    const state = initialExecutionState(contract());
    const decision = decideExecutionCommand(
      state,
      reserve("council", 1, "2026-08-05T12:30:00Z"),
    );
    assert.equal(decision._tag, "Terminated");
    if (decision._tag === "Terminated") {
      assert.equal(decision.events[0]?._tag, "TerminalDecided");
      assert.equal(decision.events[0]?.terminal, "Stalled");
    }
  });

  it("counts product progress only under the contract allowed-path identity", () => {
    const value = contract();
    let state: ExecutionState = initialExecutionState(value);
    state = apply(state, {
      _tag: "ReserveAction",
      action: "implement",
      candidateSha256: H2,
      reservationId: "implement-1",
      at: "2026-08-05T12:01:00Z",
    });

    const wrong = decideExecutionCommand(state, {
      _tag: "RecordProductChange",
      candidateSha256: H3,
      allowedPathsSha256: H,
      at: "2026-08-05T12:02:00Z",
    });
    assert.deepEqual(wrong, { _tag: "Refused", reason: "invalid_command" });

    const valid: ExecutionCommand = {
      _tag: "RecordProductChange",
      candidateSha256: H3,
      allowedPathsSha256: value.allowedPathsSha256,
      at: "2026-08-05T12:02:00Z",
    };
    assert.equal(decideExecutionCommand(state, valid)._tag, "Accepted");
    state = apply(state, valid);
    assert.equal(state.lastProductChangeAt, "2026-08-05T12:02:00Z");
    assert.equal(state.currentCandidateSha256, H3);
  });

  it("invalidates identity changes and keeps cancellation ahead of late success", () => {
    let state: ExecutionState = initialExecutionState(contract());
    state = apply(state, {
      _tag: "Invalidate",
      observedContractSha256: H3,
      at: "2026-08-05T12:02:00Z",
    });
    assert.equal(state._tag, "Invalidated");

    let cancelled: ExecutionState = initialExecutionState(contract());
    cancelled = apply(cancelled, {
      _tag: "Cancel",
      authorizationSha256: H,
      at: "2026-08-05T12:02:00Z",
    });
    assert.equal(cancelled._tag, "Cancelled");
    const after = evolveExecution(cancelled, {
      _tag: "MilestoneRecorded",
      milestone: "published",
      candidateSha256: H2,
      evidenceSha256: H3,
      at: "2026-08-05T12:03:00Z",
    });
    assert.deepEqual(after, cancelled);
  });

  it("completes only when all milestones bind one exact candidate", () => {
    let state: ExecutionState = initialExecutionState(contract());
    for (const milestone of ["checks", "audit", "integrated"] as const) {
      state = apply(state, {
        _tag: "RecordMilestone",
        milestone,
        candidateSha256: H2,
        evidenceSha256: H3,
        at: "2026-08-05T12:05:00Z",
      });
      assert.equal(state._tag, "Running");
    }
    state = apply(state, {
      _tag: "RecordMilestone",
      milestone: "published",
      candidateSha256: H2,
      evidenceSha256: H3,
      at: "2026-08-05T12:06:00Z",
    });
    assert.equal(state._tag, "Completed");
  });
});
