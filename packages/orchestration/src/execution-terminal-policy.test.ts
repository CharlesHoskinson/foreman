import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeExecutionContractV1,
  executionContractSha256,
  isExecutionContractFailure,
  strictEndstopLimits,
  type ExecutionContractV1,
} from "./execution-contract.js";
import {
  decideExecutionCommand,
  evolveExecution,
  initialExecutionState,
  isExecutionTerminal,
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
