import { isCommitSha40, isSha256Hex, sha256Hex } from "@foreman/core";
import { decodeRunId, isUtcSecondTimestamp } from "@foreman/event-log";
import type {
  ReleaseActionV1,
  ReleaseCandidateIdentityV1,
  ReleaseEvaluationVerdictV1,
} from "@foreman/policy";
import {
  executionContractFamilySha256,
  executionContractSha256,
  type ExecutionChildContractV2,
  type ExecutionContractFamilyV2,
  type ExecutionFamilyFailure,
  type ExecutionContractV1,
  type ExecutionMilestone,
} from "./execution-contract.js";

export const executionActionKinds = [
  "implement",
  "verify",
  "audit",
  "correct",
  "council",
  "provider_retry",
  "resume",
  "integrate",
  "publish",
] as const;

export type ExecutionActionKind = (typeof executionActionKinds)[number];

export type ExecutionTerminalTag =
  | "Completed"
  | "Escalated"
  | "Stalled"
  | "BudgetExhausted"
  | "Cancelled"
  | "Invalidated"
  | "BlockedExternal";

export type ExecutionCounts = Readonly<
  Record<ExecutionActionKind, number> & { readonly totalActions: number }
>;

type ExecutionStateBase = {
  readonly contract: ExecutionContractV1;
  readonly contractSha256: string;
  readonly counts: ExecutionCounts;
  readonly lastEventAt: string;
  readonly lastProductChangeAt: string;
  readonly currentCandidateSha256: string | null;
  readonly milestoneCandidateSha256: string | null;
  readonly milestones: Readonly<Partial<Record<ExecutionMilestone, string>>>;
  readonly verificationReservations: Readonly<Record<string, string>>;
};

export type RunningExecutionState = ExecutionStateBase & {
  readonly _tag: "Running";
};

export type TerminalExecutionState = ExecutionStateBase & {
  readonly _tag: ExecutionTerminalTag;
  readonly terminalAt: string;
  readonly terminalReason: string;
};

export type ExecutionState = RunningExecutionState | TerminalExecutionState;

export type ExecutionCommand =
  | {
      readonly _tag: "ReserveAction";
      readonly action: ExecutionActionKind;
      readonly candidateSha256: string;
      readonly commandSha256?: string;
      readonly reservationId: string;
      readonly at: string;
    }
  | {
      readonly _tag: "RecordProductChange";
      readonly candidateSha256: string;
      readonly allowedPathsSha256: string;
      readonly at: string;
    }
  | {
      readonly _tag: "RecordMilestone";
      readonly milestone: ExecutionMilestone;
      readonly candidateSha256: string;
      readonly evidenceSha256: string;
      readonly at: string;
    }
  | {
      readonly _tag: "Cancel";
      readonly authorizationSha256: string;
      readonly at: string;
    }
  | {
      readonly _tag: "Invalidate";
      readonly observedContractSha256: string;
      readonly at: string;
    }
  | {
      readonly _tag: "RecordBlockingOutcome";
      readonly source: "audit" | "council" | "verify";
      readonly at: string;
    }
  | {
      readonly _tag: "RecordExternalFailure";
      readonly at: string;
    };

export type ExecutionEvent =
  | {
      readonly _tag: "ActionReserved";
      readonly action: ExecutionActionKind;
      readonly candidateSha256: string;
      readonly commandSha256?: string;
      readonly reservationId: string;
      readonly at: string;
    }
  | {
      readonly _tag: "ProductChanged";
      readonly candidateSha256: string;
      readonly allowedPathsSha256: string;
      readonly at: string;
    }
  | {
      readonly _tag: "MilestoneRecorded";
      readonly milestone: ExecutionMilestone;
      readonly candidateSha256: string;
      readonly evidenceSha256: string;
      readonly at: string;
    }
  | {
      readonly _tag: "TerminalDecided";
      readonly terminal: ExecutionTerminalTag;
      readonly reason: string;
      readonly at: string;
    };

export type ExecutionDecision =
  | { readonly _tag: "Accepted"; readonly events: readonly ExecutionEvent[] }
  | { readonly _tag: "Terminated"; readonly events: readonly ExecutionEvent[] }
  | {
      readonly _tag: "ReusedVerification";
      readonly reservationId: string;
    }
  | {
      readonly _tag: "Refused";
      readonly reason:
        | "terminal"
        | "invalid_command"
        | "time_regression"
        | "authorization_mismatch";
      readonly terminal?: ExecutionTerminalTag;
    };

const zeroCounts: ExecutionCounts = {
  totalActions: 0,
  implement: 0,
  verify: 0,
  audit: 0,
  correct: 0,
  council: 0,
  provider_retry: 0,
  resume: 0,
  integrate: 0,
  publish: 0,
};

export function initialExecutionState(
  contract: ExecutionContractV1,
): RunningExecutionState {
  return {
    _tag: "Running",
    contract,
    contractSha256: executionContractSha256(contract),
    counts: zeroCounts,
    lastEventAt: contract.createdAt,
    lastProductChangeAt: contract.createdAt,
    currentCandidateSha256: null,
    milestoneCandidateSha256: null,
    milestones: {},
    verificationReservations: {},
  };
}

export function isExecutionTerminal(
  state: ExecutionState,
): state is TerminalExecutionState {
  return state._tag !== "Running";
}

function terminalEvent(
  terminal: ExecutionTerminalTag,
  reason: string,
  at: string,
): ExecutionDecision {
  return {
    _tag: "Terminated",
    events: [{ _tag: "TerminalDecided", terminal, reason, at }],
  };
}

function validAt(state: ExecutionState, at: string): boolean {
  return isUtcSecondTimestamp(at) && Date.parse(at) >= Date.parse(state.lastEventAt);
}

function actionLimit(state: RunningExecutionState, action: ExecutionActionKind): number {
  switch (action) {
    case "implement":
      return state.contract.limits.implementationRounds;
    case "verify":
      return state.contract.limits.totalActions;
    case "audit":
      return state.contract.limits.auditRounds;
    case "correct":
      return state.contract.limits.correctionRounds;
    case "council":
      return state.contract.limits.councilRounds;
    case "provider_retry":
      return state.contract.limits.providerRetries;
    case "resume":
      return state.contract.limits.resumeAttempts;
    case "integrate":
    case "publish":
      return 1;
  }
}

function reserveDecision(
  state: RunningExecutionState,
  command: Extract<ExecutionCommand, { readonly _tag: "ReserveAction" }>,
): ExecutionDecision {
  if (
    !executionActionKinds.includes(command.action) ||
    !isSha256Hex(command.candidateSha256) ||
    command.reservationId.length === 0 ||
    command.reservationId.length > 128 ||
    (command.action === "verify" &&
      (typeof command.commandSha256 !== "string" ||
        !isSha256Hex(command.commandSha256))) ||
    (command.commandSha256 !== undefined && !isSha256Hex(command.commandSha256))
  ) {
    return { _tag: "Refused", reason: "invalid_command" };
  }

  const atMs = Date.parse(command.at);
  if (atMs >= Date.parse(state.contract.deadlineAt)) {
    return terminalEvent("BudgetExhausted", "wall_time_limit", command.at);
  }
  if (
    atMs - Date.parse(state.lastProductChangeAt) >=
    state.contract.limits.noProductChangeMs
  ) {
    return terminalEvent("Stalled", "no_product_change_limit", command.at);
  }
  if (state.counts.totalActions >= state.contract.limits.totalActions) {
    return terminalEvent("BudgetExhausted", "total_action_limit", command.at);
  }

  const used = state.counts[command.action];
  if (used >= actionLimit(state, command.action)) {
    return terminalEvent(
      command.action === "provider_retry" ? "BlockedExternal" : "BudgetExhausted",
      `${command.action}_limit`,
      command.at,
    );
  }

  if (command.action === "verify") {
    const key = `${command.candidateSha256}:${command.commandSha256!}`;
    const existing = state.verificationReservations[key];
    if (existing !== undefined) {
      return { _tag: "ReusedVerification", reservationId: existing };
    }
  }

  return {
    _tag: "Accepted",
    events: [
      {
        _tag: "ActionReserved",
        action: command.action,
        candidateSha256: command.candidateSha256,
        ...(command.commandSha256 === undefined
          ? {}
          : { commandSha256: command.commandSha256 }),
        reservationId: command.reservationId,
        at: command.at,
      },
    ],
  };
}

export function decideExecutionCommand(
  state: ExecutionState,
  command: ExecutionCommand,
): ExecutionDecision {
  if (isExecutionTerminal(state)) {
    return { _tag: "Refused", reason: "terminal", terminal: state._tag };
  }
  if (!validAt(state, command.at)) {
    return { _tag: "Refused", reason: "time_regression" };
  }

  switch (command._tag) {
    case "ReserveAction":
      return reserveDecision(state, command);
    case "RecordProductChange":
      if (
        !isSha256Hex(command.candidateSha256) ||
        command.allowedPathsSha256 !== state.contract.allowedPathsSha256
      ) {
        return { _tag: "Refused", reason: "invalid_command" };
      }
      return {
        _tag: "Accepted",
        events: [
          {
            _tag: "ProductChanged",
            candidateSha256: command.candidateSha256,
            allowedPathsSha256: command.allowedPathsSha256,
            at: command.at,
          },
        ],
      };
    case "RecordMilestone": {
      if (
        !state.contract.requiredMilestones.includes(command.milestone) ||
        !isSha256Hex(command.candidateSha256) ||
        !isSha256Hex(command.evidenceSha256)
      ) {
        return { _tag: "Refused", reason: "invalid_command" };
      }
      if (
        state.milestoneCandidateSha256 !== null &&
        state.milestoneCandidateSha256 !== command.candidateSha256
      ) {
        return terminalEvent("Invalidated", "milestone_candidate_mismatch", command.at);
      }
      const milestoneEvent: ExecutionEvent = {
        _tag: "MilestoneRecorded",
        milestone: command.milestone,
        candidateSha256: command.candidateSha256,
        evidenceSha256: command.evidenceSha256,
        at: command.at,
      };
      const complete = state.contract.requiredMilestones.every(
        (milestone) =>
          milestone === command.milestone || state.milestones[milestone] !== undefined,
      );
      if (complete) {
        return {
          _tag: "Terminated",
          events: [
            milestoneEvent,
            {
              _tag: "TerminalDecided",
              terminal: "Completed",
              reason: "required_milestones_complete",
              at: command.at,
            },
          ],
        };
      }
      return { _tag: "Accepted", events: [milestoneEvent] };
    }
    case "Cancel":
      if (command.authorizationSha256 !== state.contract.authorizationSha256) {
        return { _tag: "Refused", reason: "authorization_mismatch" };
      }
      return terminalEvent("Cancelled", "user_cancelled", command.at);
    case "Invalidate":
      if (!isSha256Hex(command.observedContractSha256)) {
        return { _tag: "Refused", reason: "invalid_command" };
      }
      return command.observedContractSha256 === state.contractSha256
        ? { _tag: "Accepted", events: [] }
        : terminalEvent("Invalidated", "contract_identity_changed", command.at);
    case "RecordBlockingOutcome":
      return state.counts.correct >= state.contract.limits.correctionRounds
        ? terminalEvent("Escalated", `${command.source}_blocking_after_correction`, command.at)
        : { _tag: "Accepted", events: [] };
    case "RecordExternalFailure":
      return state.counts.provider_retry >= state.contract.limits.providerRetries
        ? terminalEvent("BlockedExternal", "external_retry_limit", command.at)
        : { _tag: "Accepted", events: [] };
  }
}

export function evolveExecution(
  state: ExecutionState,
  event: ExecutionEvent,
): ExecutionState {
  if (isExecutionTerminal(state)) return state;

  switch (event._tag) {
    case "ActionReserved": {
      const verificationReservations = { ...state.verificationReservations };
      if (event.action === "verify" && event.commandSha256 !== undefined) {
        verificationReservations[
          `${event.candidateSha256}:${event.commandSha256}`
        ] = event.reservationId;
      }
      return {
        ...state,
        counts: {
          ...state.counts,
          totalActions: state.counts.totalActions + 1,
          [event.action]: state.counts[event.action] + 1,
        },
        currentCandidateSha256: event.candidateSha256,
        verificationReservations,
        lastEventAt: event.at,
      };
    }
    case "ProductChanged":
      return {
        ...state,
        currentCandidateSha256: event.candidateSha256,
        lastProductChangeAt:
          event.candidateSha256 === state.currentCandidateSha256
            ? state.lastProductChangeAt
            : event.at,
        lastEventAt: event.at,
      };
    case "MilestoneRecorded":
      return {
        ...state,
        milestoneCandidateSha256:
          state.milestoneCandidateSha256 ?? event.candidateSha256,
        milestones: {
          ...state.milestones,
          [event.milestone]: event.evidenceSha256,
        },
        lastEventAt: event.at,
      };
    case "TerminalDecided":
      return {
        ...state,
        _tag: event.terminal,
        terminalAt: event.at,
        terminalReason: event.reason,
        lastEventAt: event.at,
      };
  }
}

export type ExecutionV2ChildOperationV1 =
  | {
      readonly _tag: "ReserveAction";
      readonly reservationId: string;
      readonly reservationAction: ReleaseActionV1;
      readonly effectiveAction: ReleaseActionV1;
      readonly originReservationId: string;
      readonly candidate: ReleaseCandidateIdentityV1;
      readonly taskPlanSha256: string;
      readonly authorityBundleSha256: string;
    }
  | {
      readonly _tag: "RecordProductChange";
      readonly reservationId: string;
      readonly originReservationId: string;
      readonly baseCandidate: ReleaseCandidateIdentityV1;
      readonly candidate: ReleaseCandidateIdentityV1;
      readonly allowedPathsSha256: string;
    }
  | {
      readonly _tag: "RecordMilestone";
      readonly milestone: ExecutionMilestone;
      readonly outcomeSha256: string;
      readonly reservationId: string;
      readonly originReservationId: string;
      readonly candidateSha256: string;
    }
  | {
      readonly _tag: "RecordBlockingOutcome" | "RecordExternalFailure";
      readonly outcomeSha256: string;
      readonly reservationId: string;
      readonly originReservationId: string;
      readonly candidateSha256: string;
    }
  | {
      readonly _tag: "Cancel";
      readonly approvalSha256: string;
      readonly reasonSha256: string;
    }
  | {
      readonly _tag: "Invalidate";
      readonly approvalSha256: string;
      readonly observedFamilySha256: string;
      readonly reasonSha256: string;
    };

export type ExecutionV2Event =
  | (Omit<
      Extract<ExecutionEvent, { readonly _tag: "ActionReserved" }>,
      "action"
    > & { readonly action: ReleaseActionV1 })
  | Exclude<ExecutionEvent, { readonly _tag: "ActionReserved" }>;

export type ExecutionV2Counts = Readonly<
  Record<ReleaseActionV1, number> & { readonly totalActions: number }
>;

export type ExecutionChildReservationV2 = {
  readonly reservationId: string;
  readonly reservationAction: ReleaseActionV1;
  readonly effectiveAction: ReleaseActionV1;
  readonly originReservationId: string;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly taskPlanSha256: string;
  readonly authorityBundleSha256: string;
};

export type ExecutionEvaluationVerdictStateV1 = {
  readonly candidateSha256: string;
  readonly result: ReleaseEvaluationVerdictV1["result"];
  readonly completedRuns: number;
  readonly unavailableRuns: number;
  readonly notRunRuns: number;
  readonly runSetSha256: string;
  readonly verdictSha256: string;
};

export type ExecutionChildStateV2 = {
  readonly _tag: "Running" | ExecutionTerminalTag;
  readonly contract: ExecutionChildContractV2;
  readonly counts: ExecutionV2Counts;
  readonly firstActionAt: string | null;
  readonly lastEventAt: string;
  readonly lastProductChangeAt: string | null;
  readonly lastProgressAt: string | null;
  readonly currentCandidate: ReleaseCandidateIdentityV1 | null;
  readonly productChangeCount: number;
  readonly milestoneCandidateSha256: string | null;
  readonly milestones: Readonly<Partial<Record<ExecutionMilestone, string>>>;
  readonly verificationReservations: Readonly<Record<string, string>>;
  readonly reservations: Readonly<Record<string, ExecutionChildReservationV2>>;
  readonly evaluationPassOrigins: Readonly<Record<string, string>>;
  readonly evaluationVerdict: ExecutionEvaluationVerdictStateV1 | null;
  readonly graphContextEnabled: boolean | null;
  readonly terminalAt: string | null;
  readonly terminalReason: string | null;
};

export type ExecutionFamilyStateV2 = {
  readonly _tag: "Running" | ExecutionTerminalTag;
  readonly manifest: ExecutionContractFamilyV2;
  readonly familySha256: string;
  readonly activatedAt: string;
  readonly totalActions: number;
  readonly children: Readonly<Record<string, ExecutionChildStateV2>>;
  readonly terminalAt: string | null;
  readonly terminalReason: string | null;
};

export type ExecutionV2Decision =
  | { readonly _tag: "Accepted"; readonly events: readonly ExecutionV2Event[] }
  | { readonly _tag: "Terminated"; readonly events: readonly ExecutionV2Event[] }
  | { readonly _tag: "ReusedVerification"; readonly reservationId: string }
  | {
      readonly _tag: "Refused";
      readonly reason:
        | "family_terminal"
        | "child_terminal"
        | "unknown_child"
        | "dependency_incomplete"
        | "invalid_time"
        | "invalid_operation"
        | "invalid_retry"
        | "candidate_mismatch"
        | "reservation_mismatch";
    };

export type ExecutionEvaluationVerdictRegistrationV2 =
  | { readonly _tag: "Accepted"; readonly state: ExecutionFamilyStateV2 }
  | {
      readonly _tag: "Refused";
      readonly reason:
        | "unknown_child"
        | "invalid_verdict"
        | "candidate_mismatch"
        | "run_count_mismatch";
    };

const releaseActionKindsV2: readonly ReleaseActionV1[] = [
  "implement",
  "verify",
  "audit",
  "correct",
  "council",
  "provider_retry",
  "resume",
  "integrate",
  "publish",
  "evaluate",
];

const zeroV2Counts: ExecutionV2Counts = {
  totalActions: 0,
  implement: 0,
  verify: 0,
  audit: 0,
  correct: 0,
  council: 0,
  provider_retry: 0,
  resume: 0,
  integrate: 0,
  publish: 0,
  evaluate: 0,
};

function executionFamilyFailure(
  reason: ExecutionFamilyFailure["reason"],
): ExecutionFamilyFailure {
  return { _tag: "ExecutionFamilyFailure", reason };
}

function validCandidateV2(value: ReleaseCandidateIdentityV1): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    isCommitSha40(value.commit) &&
    isCommitSha40(value.tree) &&
    isSha256Hex(value.candidateSha256) &&
    value.candidateSha256 === sha256Hex(value.commit)
  );
}

function sameCandidateV2(
  left: ReleaseCandidateIdentityV1 | null,
  right: ReleaseCandidateIdentityV1,
): boolean {
  return (
    left !== null &&
    left.commit === right.commit &&
    left.tree === right.tree &&
    left.candidateSha256 === right.candidateSha256
  );
}

export function initialExecutionFamilyStateV2(input: {
  readonly manifest: ExecutionContractFamilyV2;
  readonly familySha256: string;
  readonly activatedAt: string;
  readonly priorRootActions?: number;
}): ExecutionFamilyStateV2 | ExecutionFamilyFailure {
  if (
    !isSha256Hex(input.familySha256) ||
    input.familySha256 !== executionContractFamilySha256(input.manifest) ||
    !isUtcSecondTimestamp(input.activatedAt) ||
    Date.parse(input.activatedAt) < Date.parse(input.manifest.createdAt) ||
    Date.parse(input.activatedAt) >= Date.parse(input.manifest.deadlineAt) ||
    !Number.isSafeInteger(input.priorRootActions ?? 0) ||
    (input.priorRootActions ?? 0) < 0 ||
    (input.priorRootActions ?? 0) > input.manifest.totalActions
  ) {
    return executionFamilyFailure("invalid_timestamp");
  }
  const children: Record<string, ExecutionChildStateV2> = {};
  for (const contract of input.manifest.children) {
    children[contract.childId] = {
      _tag: "Running",
      contract,
      counts: zeroV2Counts,
      firstActionAt: null,
      lastEventAt: input.activatedAt,
      lastProductChangeAt: null,
      lastProgressAt: null,
      currentCandidate: null,
      productChangeCount: 0,
      milestoneCandidateSha256: null,
      milestones: {},
      verificationReservations: {},
      reservations: {},
      evaluationPassOrigins: {},
      evaluationVerdict: null,
      graphContextEnabled: null,
      terminalAt: null,
      terminalReason: null,
    };
  }
  return {
    _tag: "Running",
    manifest: input.manifest,
    familySha256: input.familySha256,
    activatedAt: input.activatedAt,
    totalActions: input.priorRootActions ?? 0,
    children,
    terminalAt: null,
    terminalReason: null,
  };
}

function v2TerminalDecision(
  terminal: ExecutionTerminalTag,
  reason: string,
  at: string,
): ExecutionV2Decision {
  return {
    _tag: "Terminated",
    events: [{ _tag: "TerminalDecided", terminal, reason, at }],
  };
}

function childTimeDecision(
  state: ExecutionFamilyStateV2,
  child: ExecutionChildStateV2,
  at: string,
): ExecutionV2Decision | null {
  if (
    !isUtcSecondTimestamp(at) ||
    Date.parse(at) < Date.parse(child.lastEventAt)
  ) {
    return { _tag: "Refused", reason: "invalid_time" };
  }
  const atMs = Date.parse(at);
  if (atMs >= Date.parse(state.manifest.deadlineAt)) {
    return v2TerminalDecision("BudgetExhausted", "family_wall_time_limit", at);
  }
  if (child.firstActionAt === null) return null;
  if (
    atMs >=
    Math.min(
      Date.parse(child.firstActionAt) + child.contract.limits.wallTimeMs,
      Date.parse(child.contract.deadlineAt),
    )
  ) {
    return v2TerminalDecision("BudgetExhausted", "child_wall_time_limit", at);
  }
  if (
    child.contract.limits.kind === "standard" &&
    child.lastProductChangeAt !== null &&
    atMs >=
      Date.parse(child.lastProductChangeAt) +
        child.contract.limits.noProductChangeMs
  ) {
    return v2TerminalDecision("BudgetExhausted", "no_product_change_limit", at);
  }
  if (
    child.contract.limits.kind === "evaluation" &&
    child.lastProgressAt !== null &&
    atMs >=
      Date.parse(child.lastProgressAt) + child.contract.limits.noProgressMs
  ) {
    return v2TerminalDecision("BudgetExhausted", "no_progress_limit", at);
  }
  return null;
}

function v2ActionLimit(
  child: ExecutionChildStateV2,
  action: ReleaseActionV1,
  candidateSha256: string,
): number {
  switch (action) {
    case "implement":
      return child.contract.limits.implementationRounds;
    case "verify":
      return child.contract.limits.verificationRunsPerCandidate;
    case "audit":
      return child.contract.limits.auditRounds;
    case "correct":
      return child.contract.limits.correctionRounds;
    case "council":
      return child.contract.limits.councilRounds;
    case "provider_retry":
      return child.contract.limits.providerRetries;
    case "resume":
      return child.contract.limits.resumeAttempts;
    case "integrate":
    case "publish":
      return 1;
    case "evaluate":
      return child.contract.limits.kind === "evaluation"
        ? child.contract.limits.evaluationRuns
        : 0;
  }
  void candidateSha256;
}

function usedV2Actions(
  child: ExecutionChildStateV2,
  action: ReleaseActionV1,
  candidateSha256: string,
): number {
  if (action !== "verify") return child.counts[action];
  return Object.values(child.reservations).filter(
    (reservation) =>
      reservation.reservationAction === "verify" &&
      reservation.candidate.candidateSha256 === candidateSha256,
  ).length;
}

function dependenciesComplete(
  state: ExecutionFamilyStateV2,
  child: ExecutionChildStateV2,
): boolean {
  return child.contract.dependencyChildIds.every(
    (dependency) => state.children[dependency]?._tag === "Completed",
  );
}

function validReservationOperation(
  child: ExecutionChildStateV2,
  operation: Extract<ExecutionV2ChildOperationV1, { readonly _tag: "ReserveAction" }>,
): "valid" | "invalid" | "retry" | "candidate" {
  if (
    typeof decodeRunId(operation.reservationId) !== "string" ||
    typeof decodeRunId(operation.originReservationId) !== "string" ||
    !releaseActionKindsV2.includes(operation.reservationAction) ||
    !releaseActionKindsV2.includes(operation.effectiveAction) ||
    !validCandidateV2(operation.candidate) ||
    !isSha256Hex(operation.taskPlanSha256) ||
    !isSha256Hex(operation.authorityBundleSha256) ||
    (child.contract.tranche !== 8 && operation.effectiveAction === "evaluate")
  ) {
    return "invalid";
  }
  if (
    child.currentCandidate !== null &&
    !sameCandidateV2(child.currentCandidate, operation.candidate)
  ) {
    return "candidate";
  }
  if (
    operation.reservationAction !== "provider_retry" &&
    operation.reservationAction !== "resume"
  ) {
    return operation.reservationAction === operation.effectiveAction &&
      operation.originReservationId === operation.reservationId
      ? "valid"
      : "invalid";
  }
  if (
    operation.effectiveAction === "provider_retry" ||
    operation.effectiveAction === "resume"
  ) {
    return "retry";
  }
  const origin = child.reservations[operation.originReservationId];
  if (
    origin === undefined ||
    origin.originReservationId !== operation.originReservationId ||
    origin.effectiveAction !== operation.effectiveAction ||
    !sameCandidateV2(origin.candidate, operation.candidate)
  ) {
    return "retry";
  }
  return "valid";
}

function reservationForOperation(
  child: ExecutionChildStateV2,
  operation: Exclude<ExecutionV2ChildOperationV1, { readonly _tag: "ReserveAction" | "Cancel" | "Invalidate" }>,
): ExecutionChildReservationV2 | null {
  const reservation = child.reservations[operation.reservationId];
  if (
    reservation === undefined ||
    reservation.originReservationId !== operation.originReservationId
  ) {
    return null;
  }
  return reservation;
}

function milestoneForAction(
  action: ReleaseActionV1,
): ExecutionMilestone | null {
  switch (action) {
    case "verify":
      return "checks";
    case "audit":
      return "audit";
    case "integrate":
      return "integrated";
    case "publish":
      return "published";
    default:
      return null;
  }
}

export function decideExecutionChildOperationV2(input: {
  readonly state: ExecutionFamilyStateV2;
  readonly childId: string;
  readonly operation: ExecutionV2ChildOperationV1;
  readonly at: string;
}): ExecutionV2Decision {
  const { state, operation, at } = input;
  if (state._tag !== "Running") {
    return { _tag: "Refused", reason: "family_terminal" };
  }
  const child = state.children[input.childId];
  if (child === undefined) return { _tag: "Refused", reason: "unknown_child" };
  if (child._tag !== "Running") {
    return { _tag: "Refused", reason: "child_terminal" };
  }
  const timeDecision = childTimeDecision(state, child, at);
  if (timeDecision !== null) return timeDecision;

  switch (operation._tag) {
    case "ReserveAction": {
      if (!dependenciesComplete(state, child)) {
        return { _tag: "Refused", reason: "dependency_incomplete" };
      }
      const validity = validReservationOperation(child, operation);
      if (validity === "retry") return { _tag: "Refused", reason: "invalid_retry" };
      if (validity === "candidate") {
        return { _tag: "Refused", reason: "candidate_mismatch" };
      }
      if (validity !== "valid" || child.reservations[operation.reservationId] !== undefined) {
        return { _tag: "Refused", reason: "invalid_operation" };
      }
      if (state.totalActions >= state.manifest.totalActions) {
        return v2TerminalDecision("BudgetExhausted", "family_action_limit", at);
      }
      if (child.counts.totalActions >= child.contract.limits.totalActions) {
        return v2TerminalDecision("BudgetExhausted", "child_action_limit", at);
      }
      const used = usedV2Actions(
        child,
        operation.reservationAction,
        operation.candidate.candidateSha256,
      );
      if (
        used >=
        v2ActionLimit(
          child,
          operation.reservationAction,
          operation.candidate.candidateSha256,
        )
      ) {
        return v2TerminalDecision(
          operation.reservationAction === "provider_retry"
            ? "BlockedExternal"
            : "BudgetExhausted",
          `${operation.reservationAction}_limit`,
          at,
        );
      }
      if (operation.reservationAction === "verify") {
        const key = `${operation.candidate.candidateSha256}:${operation.authorityBundleSha256}`;
        const existing = child.verificationReservations[key];
        if (existing !== undefined) {
          return { _tag: "ReusedVerification", reservationId: existing };
        }
      }
      return {
        _tag: "Accepted",
        events: [
          {
            _tag: "ActionReserved",
            action: operation.reservationAction,
            candidateSha256: operation.candidate.candidateSha256,
            ...(operation.reservationAction === "verify"
              ? { commandSha256: operation.authorityBundleSha256 }
              : {}),
            reservationId: operation.reservationId,
            at,
          },
        ],
      };
    }
    case "RecordProductChange": {
      const reservation = reservationForOperation(child, operation);
      if (
        reservation === null ||
        (reservation.effectiveAction !== "implement" &&
          reservation.effectiveAction !== "correct")
      ) {
        return { _tag: "Refused", reason: "reservation_mismatch" };
      }
      if (
        !sameCandidateV2(child.currentCandidate, operation.baseCandidate) ||
        !sameCandidateV2(reservation.candidate, operation.baseCandidate) ||
        !validCandidateV2(operation.candidate) ||
        sameCandidateV2(operation.baseCandidate, operation.candidate) ||
        operation.allowedPathsSha256 !== child.contract.allowedPathsSha256
      ) {
        return { _tag: "Refused", reason: "candidate_mismatch" };
      }
      return {
        _tag: "Accepted",
        events: [
          {
            _tag: "ProductChanged",
            candidateSha256: operation.candidate.candidateSha256,
            allowedPathsSha256: operation.allowedPathsSha256,
            at,
          },
        ],
      };
    }
    case "RecordMilestone": {
      const reservation = reservationForOperation(child, operation);
      if (
        reservation === null ||
        milestoneForAction(reservation.effectiveAction) !== operation.milestone ||
        !child.contract.requiredMilestones.includes(operation.milestone) ||
        !isSha256Hex(operation.outcomeSha256) ||
        child.currentCandidate?.candidateSha256 !== operation.candidateSha256
      ) {
        return { _tag: "Refused", reason: "reservation_mismatch" };
      }
      if (child.productChangeCount === 0) {
        return { _tag: "Refused", reason: "invalid_operation" };
      }
      const existing = child.milestones[operation.milestone];
      if (existing !== undefined) {
        return existing === operation.outcomeSha256
          ? { _tag: "Accepted", events: [] }
          : { _tag: "Refused", reason: "invalid_operation" };
      }
      const nextMilestone = child.contract.requiredMilestones.find(
        (milestone) => child.milestones[milestone] === undefined,
      );
      if (nextMilestone !== operation.milestone) {
        return { _tag: "Refused", reason: "invalid_operation" };
      }
      const event: ExecutionV2Event = {
        _tag: "MilestoneRecorded",
        milestone: operation.milestone,
        candidateSha256: operation.candidateSha256,
        evidenceSha256: operation.outcomeSha256,
        at,
      };
      const completeMilestones = child.contract.requiredMilestones.every(
        (milestone) =>
          milestone === operation.milestone || child.milestones[milestone] !== undefined,
      );
      const evaluationComplete =
        child.contract.tranche !== 8 || child.evaluationVerdict !== null;
      if (completeMilestones && !evaluationComplete) {
        return { _tag: "Refused", reason: "invalid_operation" };
      }
      if (completeMilestones && evaluationComplete) {
        return {
          _tag: "Terminated",
          events: [
            event,
            {
              _tag: "TerminalDecided",
              terminal: "Completed",
              reason: "required_milestones_complete",
              at,
            },
          ],
        };
      }
      return { _tag: "Accepted", events: [event] };
    }
    case "RecordBlockingOutcome": {
      const reservation = reservationForOperation(child, operation);
      if (
        reservation === null ||
        !["verify", "audit", "council", "evaluate"].includes(
          reservation.effectiveAction,
        ) ||
        !isSha256Hex(operation.outcomeSha256) ||
        child.currentCandidate?.candidateSha256 !== operation.candidateSha256
      ) {
        return { _tag: "Refused", reason: "reservation_mismatch" };
      }
      return child.counts.correct >= child.contract.limits.correctionRounds
        ? v2TerminalDecision(
            "Escalated",
            `${reservation.effectiveAction}_blocking_after_correction`,
            at,
          )
        : { _tag: "Accepted", events: [] };
    }
    case "RecordExternalFailure": {
      const reservation = reservationForOperation(child, operation);
      if (
        reservation === null ||
        !isSha256Hex(operation.outcomeSha256) ||
        child.currentCandidate?.candidateSha256 !== operation.candidateSha256
      ) {
        return { _tag: "Refused", reason: "reservation_mismatch" };
      }
      return child.counts.provider_retry >= child.contract.limits.providerRetries
        ? v2TerminalDecision("BlockedExternal", "external_retry_limit", at)
        : { _tag: "Accepted", events: [] };
    }
    case "Cancel":
      return isSha256Hex(operation.approvalSha256) &&
        isSha256Hex(operation.reasonSha256)
        ? v2TerminalDecision("Cancelled", "user_cancelled", at)
        : { _tag: "Refused", reason: "invalid_operation" };
    case "Invalidate":
      if (
        !isSha256Hex(operation.approvalSha256) ||
        !isSha256Hex(operation.observedFamilySha256) ||
        !isSha256Hex(operation.reasonSha256)
      ) {
        return { _tag: "Refused", reason: "invalid_operation" };
      }
      return operation.observedFamilySha256 === state.familySha256
        ? { _tag: "Accepted", events: [] }
        : v2TerminalDecision("Invalidated", "family_identity_changed", at);
  }
}

function evolveChildV2(
  child: ExecutionChildStateV2,
  operation: ExecutionV2ChildOperationV1,
  events: readonly ExecutionV2Event[],
): ExecutionChildStateV2 {
  if (child._tag !== "Running") return child;
  let next = child;
  for (const event of events) {
    switch (event._tag) {
      case "ActionReserved": {
        if (operation._tag !== "ReserveAction") return child;
        const firstActionAt = next.firstActionAt ?? event.at;
        const verificationReservations = { ...next.verificationReservations };
        if (event.action === "verify" && event.commandSha256 !== undefined) {
          verificationReservations[
            `${operation.candidate.candidateSha256}:${event.commandSha256}`
          ] = event.reservationId;
        }
        next = {
          ...next,
          counts: {
            ...next.counts,
            totalActions: next.counts.totalActions + 1,
            [event.action]: next.counts[event.action] + 1,
          },
          firstActionAt,
          lastProductChangeAt: next.lastProductChangeAt ?? firstActionAt,
          lastProgressAt:
            next.contract.limits.kind === "evaluation"
              ? next.lastProgressAt ?? firstActionAt
              : next.lastProgressAt,
          currentCandidate: next.currentCandidate ?? operation.candidate,
          verificationReservations,
          reservations: {
            ...next.reservations,
            [operation.reservationId]: { ...operation },
          },
          lastEventAt: event.at,
        };
        break;
      }
      case "ProductChanged":
        if (operation._tag !== "RecordProductChange") return child;
        next = {
          ...next,
          currentCandidate: operation.candidate,
          productChangeCount: next.productChangeCount + 1,
          milestoneCandidateSha256: null,
          milestones: {},
          evaluationPassOrigins: {},
          evaluationVerdict: null,
          graphContextEnabled: null,
          lastProductChangeAt: event.at,
          lastProgressAt:
            next.contract.limits.kind === "evaluation"
              ? event.at
              : next.lastProgressAt,
          lastEventAt: event.at,
        };
        break;
      case "MilestoneRecorded":
        next = {
          ...next,
          milestoneCandidateSha256:
            next.milestoneCandidateSha256 ?? event.candidateSha256,
          milestones: { ...next.milestones, [event.milestone]: event.evidenceSha256 },
          lastProgressAt:
            next.contract.limits.kind === "evaluation"
              ? event.at
              : next.lastProgressAt,
          lastEventAt: event.at,
        };
        break;
      case "TerminalDecided":
        next = {
          ...next,
          _tag: event.terminal,
          terminalAt: event.at,
          terminalReason: event.reason,
          lastEventAt: event.at,
        };
        break;
    }
  }
  return next;
}

export function evolveExecutionFamilyV2(
  state: ExecutionFamilyStateV2,
  childId: string,
  operation: ExecutionV2ChildOperationV1,
  decision: ExecutionV2Decision,
): ExecutionFamilyStateV2 {
  if (
    state._tag !== "Running" ||
    (decision._tag !== "Accepted" && decision._tag !== "Terminated")
  ) {
    return state;
  }
  const child = state.children[childId];
  if (child === undefined) return state;
  const evolved = evolveChildV2(child, operation, decision.events);
  const children = { ...state.children, [childId]: evolved };
  const actionEvents = decision.events.filter(
    (event) => event._tag === "ActionReserved",
  ).length;
  let tag: ExecutionFamilyStateV2["_tag"] = state._tag;
  let terminalAt = state.terminalAt;
  let terminalReason = state.terminalReason;
  if (evolved._tag !== "Running" && evolved._tag !== "Completed") {
    tag = evolved._tag;
    terminalAt = evolved.terminalAt;
    terminalReason = evolved.terminalReason;
  } else if (Object.values(children).every((item) => item._tag === "Completed")) {
    tag = "Completed";
    terminalAt = evolved.terminalAt;
    terminalReason = "all_children_complete";
  }
  return {
    ...state,
    _tag: tag,
    totalActions: state.totalActions + actionEvents,
    children,
    terminalAt,
    terminalReason,
  };
}

export function recordExecutionEvaluationPassV2(input: {
  readonly state: ExecutionFamilyStateV2;
  readonly childId: string;
  readonly originReservationId: string;
  readonly outcomeSha256: string;
  readonly at: string;
}): ExecutionFamilyStateV2 {
  const child = input.state.children[input.childId];
  const reservation = child?.reservations[input.originReservationId];
  if (
    input.state._tag !== "Running" ||
    child === undefined ||
    child._tag !== "Running" ||
    child.contract.tranche !== 8 ||
    reservation === undefined ||
    reservation.effectiveAction !== "evaluate" ||
    reservation.originReservationId !== input.originReservationId ||
    !isSha256Hex(input.outcomeSha256) ||
    !isUtcSecondTimestamp(input.at) ||
    Date.parse(input.at) < Date.parse(child.lastEventAt)
  ) {
    return input.state;
  }
  const existing = child.evaluationPassOrigins[input.originReservationId];
  if (existing !== undefined && existing !== input.outcomeSha256) return input.state;
  const evolved: ExecutionChildStateV2 = {
    ...child,
    evaluationPassOrigins: {
      ...child.evaluationPassOrigins,
      [input.originReservationId]: input.outcomeSha256,
    },
    lastProgressAt: input.at,
    lastEventAt: input.at,
  };
  return {
    ...input.state,
    children: { ...input.state.children, [input.childId]: evolved },
  };
}

export function registerExecutionEvaluationVerdictV2(input: {
  readonly state: ExecutionFamilyStateV2;
  readonly childId: string;
  readonly verdict: ExecutionEvaluationVerdictStateV1;
}): ExecutionEvaluationVerdictRegistrationV2 {
  const child = input.state.children[input.childId];
  if (child === undefined || child.contract.tranche !== 8) {
    return { _tag: "Refused", reason: "unknown_child" };
  }
  if (input.state._tag !== "Running" || child._tag !== "Running") {
    return { _tag: "Refused", reason: "invalid_verdict" };
  }
  const verdict = input.verdict;
  if (
    !isSha256Hex(verdict.candidateSha256) ||
    !isSha256Hex(verdict.runSetSha256) ||
    !isSha256Hex(verdict.verdictSha256) ||
    !["PROMOTE", "GRAPH_OFF_FAILED", "GRAPH_OFF_INCONCLUSIVE", "GRAPH_OFF_UNCOMPUTABLE"].includes(
      verdict.result,
    ) ||
    ![verdict.completedRuns, verdict.unavailableRuns, verdict.notRunRuns].every(
      (count) => Number.isSafeInteger(count) && count >= 0 && count <= 2000,
    ) ||
    verdict.completedRuns + verdict.unavailableRuns + verdict.notRunRuns !== 2000
  ) {
    return { _tag: "Refused", reason: "invalid_verdict" };
  }
  if (child.currentCandidate?.candidateSha256 !== verdict.candidateSha256) {
    return { _tag: "Refused", reason: "candidate_mismatch" };
  }
  const passOrigins = Object.entries(child.evaluationPassOrigins);
  if (
    !passOrigins.every(([originReservationId, outcomeSha256]) => {
      const reservation = child.reservations[originReservationId];
      return (
        reservation !== undefined &&
        reservation.reservationAction === "evaluate" &&
        reservation.effectiveAction === "evaluate" &&
        reservation.originReservationId === originReservationId &&
        reservation.candidate.candidateSha256 === verdict.candidateSha256 &&
        isSha256Hex(outcomeSha256)
      );
    })
  ) {
    return { _tag: "Refused", reason: "run_count_mismatch" };
  }
  const passed = passOrigins.length;
  if (
    verdict.completedRuns !== passed ||
    (verdict.result !== "GRAPH_OFF_UNCOMPUTABLE" &&
      (verdict.completedRuns !== 2000 ||
        verdict.unavailableRuns !== 0 ||
        verdict.notRunRuns !== 0))
  ) {
    return { _tag: "Refused", reason: "run_count_mismatch" };
  }
  const evolved: ExecutionChildStateV2 = {
    ...child,
    evaluationVerdict: verdict,
    graphContextEnabled: verdict.result === "PROMOTE",
  };
  return {
    _tag: "Accepted",
    state: {
      ...input.state,
      children: { ...input.state.children, [input.childId]: evolved },
    },
  };
}
