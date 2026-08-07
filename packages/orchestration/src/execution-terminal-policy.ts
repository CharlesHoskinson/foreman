import { isSha256Hex } from "@foreman/core";
import { isUtcSecondTimestamp } from "@foreman/event-log";
import {
  executionContractSha256,
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
