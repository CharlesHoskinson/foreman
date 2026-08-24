import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  canonicalize,
  isCommitSha40,
  isSha256Hex,
  sha256Hex,
} from "@foreman/core";
import type {
  RegisteredReleaseAuthorityV1,
  ReleaseActionV1,
  ReleaseAuthorityReceiptV1,
  ReleaseCandidateIdentityV1,
} from "@foreman/policy";
import {
  decodeRunId,
  isUtcSecondTimestamp,
  makeLiveRunJournalLayer,
  RunJournal,
  type RunId,
  type StoredEvent,
} from "@foreman/event-log";
import { Context, Effect, Layer } from "effect";
import {
  decodeExecutionContractV1,
  decodeExecutionContractFamilyV2,
  executionContractFamilySha256,
  executionContractSha256,
  isExecutionContractFailure,
  isExecutionFamilyFailure,
  type ExecutionContractFamilyV2,
  type ExecutionContractV1,
  type ExecutionMilestone,
} from "./execution-contract.js";
import {
  decideExecutionCommand,
  decideExecutionChildOperationV2,
  evolveExecutionFamilyV2,
  initialExecutionFamilyStateV2,
  recordExecutionEvaluationPassV2,
  registerExecutionEvaluationVerdictV2,
  evolveExecution,
  executionActionKinds,
  initialExecutionState,
  isExecutionTerminal,
  type ExecutionActionKind,
  type ExecutionCommand,
  type ExecutionDecision,
  type ExecutionEvent,
  type ExecutionFamilyStateV2,
  type ExecutionV2ChildOperationV1,
  type ExecutionV2Decision,
  type ExecutionV2Event,
  type ExecutionState,
  type ExecutionTerminalTag,
} from "./execution-terminal-policy.js";

const ENDSTOP_LANE = "endstop";
const CONTRACT_EVENT = "endstop_contract";
const DECISION_EVENT = "endstop_decision";
const V2_EVENT = "endstop_v2";

const ENDSTOP_LEDGER_FAILURE_BRAND = Symbol(
  "@foreman/orchestration/EndstopLedgerFailure",
);

export type EndstopLedgerFailureReason =
  | "invalid_contract"
  | "invalid_contract_id"
  | "missing_contract"
  | "contract_mismatch"
  | "dependency_incomplete"
  | "replacement_unauthorized"
  | "family_missing"
  | "family_mismatch"
  | "family_authority_mismatch"
  | "child_authority_mismatch"
  | "family_already_activated"
  | "family_active"
  | "corrupt_history"
  | "journal_failure";

export type EndstopLedgerFailure = {
  readonly [ENDSTOP_LEDGER_FAILURE_BRAND]: true;
  readonly _tag: "EndstopLedgerFailure";
  readonly reason: EndstopLedgerFailureReason;
};

function ledgerFailure(reason: EndstopLedgerFailureReason): EndstopLedgerFailure {
  return {
    [ENDSTOP_LEDGER_FAILURE_BRAND]: true,
    _tag: "EndstopLedgerFailure",
    reason,
  };
}

export function isEndstopLedgerFailure(
  value: unknown,
): value is EndstopLedgerFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [ENDSTOP_LEDGER_FAILURE_BRAND]?: unknown })[
      ENDSTOP_LEDGER_FAILURE_BRAND
    ] === true
  );
}

export type EndstopExecutionResult = {
  readonly decision: ExecutionDecision;
  readonly state: ExecutionState;
};

export type ExecutionFamilyAuthorityRegistrationV1 = {
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly manifest: ExecutionContractFamilyV2;
  readonly familySha256: string;
  readonly sourceSha256: string;
  readonly auditReceiptSha256: string;
  readonly userReceiptSha256: string;
  readonly registeredAt: string;
};

export type ExecutionFamilyAuthorityStateV1 = Omit<
  ExecutionFamilyAuthorityRegistrationV1,
  "manifest"
>;

export type ExecutionFamilyActivationV1 = {
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly sourceSha256: string;
  readonly auditReceiptSha256: string;
  readonly userReceiptSha256: string;
  readonly activatedAt: string;
};

export type ExecutionFamilyLedgerStatusV2 = {
  readonly root: ExecutionState;
  readonly authority: ExecutionFamilyAuthorityStateV1;
  readonly family: ExecutionFamilyStateV2;
  readonly childAuthorities: readonly RegisteredReleaseAuthorityV1[];
  readonly childOutcomes: readonly RegisteredReleaseOutcomeV1[];
  readonly evaluationVerdicts: readonly RegisteredEvaluationVerdictV1[];
};

export type RegisteredReleaseOutcomeV1 = {
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: string;
  readonly reservationId: string;
  readonly originReservationId: string;
  readonly reservationAction: ReleaseActionV1;
  readonly effectiveAction: ReleaseActionV1;
  readonly candidateSha256: string;
  readonly outcomeSha256: string;
  readonly outcomeSchema:
    | "foreman.action-outcome.v1"
    | "foreman.council-outcome.v1";
  readonly registeredAt: string;
};

export type RegisteredEvaluationVerdictV1 = {
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: "v040-t8-evaluation";
  readonly candidateSha256: string;
  readonly result:
    | "PROMOTE"
    | "GRAPH_OFF_FAILED"
    | "GRAPH_OFF_INCONCLUSIVE"
    | "GRAPH_OFF_UNCOMPUTABLE";
  readonly completedRuns: number;
  readonly unavailableRuns: number;
  readonly notRunRuns: number;
  readonly runSetSha256: string;
  readonly evaluationAuthorityReceiptSha256: string;
  readonly verdictSha256: string;
  readonly registeredAt: string;
};

export type EndstopChildExecutionResultV2 = {
  readonly decision: ExecutionV2Decision;
  readonly state: ExecutionFamilyStateV2;
};

export class EndstopLedger extends Context.Tag("EndstopLedger")<
  EndstopLedger,
  {
    readonly create: (
      contract: ExecutionContractV1,
    ) => Effect.Effect<ExecutionState, EndstopLedgerFailure>;
    readonly status: (
      contractId: string,
    ) => Effect.Effect<ExecutionState, EndstopLedgerFailure>;
    readonly execute: (
      contractId: string,
      expectedContractSha256: string,
      command: ExecutionCommand,
    ) => Effect.Effect<EndstopExecutionResult, EndstopLedgerFailure>;
    readonly registerFamilyAuthority: (
      registration: ExecutionFamilyAuthorityRegistrationV1,
    ) => Effect.Effect<ExecutionFamilyAuthorityStateV1, EndstopLedgerFailure>;
    readonly activateFamily: (
      activation: ExecutionFamilyActivationV1,
    ) => Effect.Effect<ExecutionFamilyLedgerStatusV2, EndstopLedgerFailure>;
    readonly familyStatus: (
      input: Pick<
        ExecutionFamilyActivationV1,
        "rootContractId" | "rootContractSha256" | "familySha256"
      >,
    ) => Effect.Effect<ExecutionFamilyLedgerStatusV2, EndstopLedgerFailure>;
    readonly registerChildAuthority: (
      registration: RegisteredReleaseAuthorityV1,
    ) => Effect.Effect<RegisteredReleaseAuthorityV1, EndstopLedgerFailure>;
    readonly registerChildOutcome: (
      registration: RegisteredReleaseOutcomeV1,
    ) => Effect.Effect<RegisteredReleaseOutcomeV1, EndstopLedgerFailure>;
    readonly registerEvaluationVerdict: (
      registration: RegisteredEvaluationVerdictV1,
    ) => Effect.Effect<ExecutionFamilyLedgerStatusV2, EndstopLedgerFailure>;
    readonly executeChild: (input: {
      readonly rootContractId: string;
      readonly rootContractSha256: string;
      readonly familySha256: string;
      readonly childId: string;
      readonly operation: ExecutionV2ChildOperationV1;
      readonly at: string;
    }) => Effect.Effect<EndstopChildExecutionResultV2, EndstopLedgerFailure>;
  }
>() {}

type ReplayedHistoryV2 = {
  readonly root: ExecutionState;
  readonly authority: ExecutionFamilyAuthorityStateV1 | null;
  readonly family: ExecutionFamilyStateV2 | null;
  readonly childAuthorities: readonly RegisteredReleaseAuthorityV1[];
  readonly childOutcomes: readonly RegisteredReleaseOutcomeV1[];
  readonly evaluationVerdicts: readonly RegisteredEvaluationVerdictV1[];
};

type HistoryResult =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Ok"; readonly state: ReplayedHistoryV2 }
  | { readonly _tag: "Failure"; readonly failure: EndstopLedgerFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

const releaseActionsV2: readonly ReleaseActionV1[] = [
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

const receiptSchemasV1: readonly ReleaseAuthorityReceiptV1["schema"][] = [
  "foreman.design-approval.v1",
  "foreman.checks-evidence.v1",
  "foreman.release-audit.v1",
  "foreman.council-request.v1",
  "foreman.evaluation-authority.v1",
];

function candidateFromUnknown(value: unknown): ReleaseCandidateIdentityV1 | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["commit", "tree", "candidateSha256"]) ||
    typeof value.commit !== "string" ||
    typeof value.tree !== "string" ||
    typeof value.candidateSha256 !== "string" ||
    !isCommitSha40(value.commit) ||
    !isCommitSha40(value.tree) ||
    !isSha256Hex(value.candidateSha256) ||
    value.candidateSha256 !== sha256Hex(value.commit)
  ) {
    return null;
  }
  return {
    commit: value.commit,
    tree: value.tree,
    candidateSha256: value.candidateSha256,
  };
}

function childAuthorityFromUnknown(
  value: unknown,
): RegisteredReleaseAuthorityV1 | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "rootContractId",
      "rootContractSha256",
      "familySha256",
      "childId",
      "action",
      "effectiveAction",
      "priorReservationId",
      "originReservationId",
      "candidate",
      "taskPlanSha256",
      "bundleSha256",
      "receiptSchemas",
      "receiptSha256s",
      "evaluationManifestSha256",
      "registeredAt",
    ]) ||
    typeof value.rootContractId !== "string" ||
    typeof decodeRunId(value.rootContractId) !== "string" ||
    typeof value.rootContractSha256 !== "string" ||
    !isSha256Hex(value.rootContractSha256) ||
    typeof value.familySha256 !== "string" ||
    !isSha256Hex(value.familySha256) ||
    typeof value.childId !== "string" ||
    typeof decodeRunId(value.childId) !== "string" ||
    typeof value.action !== "string" ||
    !releaseActionsV2.includes(value.action as ReleaseActionV1) ||
    typeof value.effectiveAction !== "string" ||
    !releaseActionsV2.includes(value.effectiveAction as ReleaseActionV1) ||
    typeof value.taskPlanSha256 !== "string" ||
    !isSha256Hex(value.taskPlanSha256) ||
    typeof value.bundleSha256 !== "string" ||
    !isSha256Hex(value.bundleSha256) ||
    typeof value.registeredAt !== "string" ||
    !isUtcSecondTimestamp(value.registeredAt) ||
    !Array.isArray(value.receiptSchemas) ||
    value.receiptSchemas.length === 0 ||
    !value.receiptSchemas.every(
      (schema) =>
        typeof schema === "string" &&
        receiptSchemasV1.includes(schema as ReleaseAuthorityReceiptV1["schema"]),
    ) ||
    !Array.isArray(value.receiptSha256s) ||
    value.receiptSha256s.length !== value.receiptSchemas.length ||
    !value.receiptSha256s.every(
      (digest) => typeof digest === "string" && isSha256Hex(digest),
    ) ||
    !(
      value.evaluationManifestSha256 === null ||
      (typeof value.evaluationManifestSha256 === "string" &&
        isSha256Hex(value.evaluationManifestSha256))
    )
  ) {
    return null;
  }
  const candidate = candidateFromUnknown(value.candidate);
  if (candidate === null) return null;
  const action = value.action as ReleaseActionV1;
  const effectiveAction = value.effectiveAction as ReleaseActionV1;
  const meta = action === "provider_retry" || action === "resume";
  if (
    meta
      ? effectiveAction === "provider_retry" ||
        effectiveAction === "resume" ||
        typeof value.priorReservationId !== "string" ||
        typeof decodeRunId(value.priorReservationId) !== "string" ||
        typeof value.originReservationId !== "string" ||
        typeof decodeRunId(value.originReservationId) !== "string"
      : effectiveAction !== action ||
        value.priorReservationId !== null ||
        value.originReservationId !== null
  ) {
    return null;
  }
  if (
    effectiveAction === "evaluate"
      ? typeof value.evaluationManifestSha256 !== "string"
      : value.evaluationManifestSha256 !== null
  ) {
    return null;
  }
  return {
    rootContractId: value.rootContractId,
    rootContractSha256: value.rootContractSha256,
    familySha256: value.familySha256,
    childId: value.childId,
    action,
    effectiveAction,
    priorReservationId: value.priorReservationId as string | null,
    originReservationId: value.originReservationId as string | null,
    candidate,
    taskPlanSha256: value.taskPlanSha256,
    bundleSha256: value.bundleSha256,
    receiptSchemas: [...value.receiptSchemas] as ReleaseAuthorityReceiptV1["schema"][],
    receiptSha256s: [...value.receiptSha256s] as string[],
    evaluationManifestSha256: value.evaluationManifestSha256 as string | null,
    registeredAt: value.registeredAt,
  };
}

function childOutcomeFromUnknown(
  value: unknown,
): RegisteredReleaseOutcomeV1 | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "rootContractId",
      "rootContractSha256",
      "familySha256",
      "childId",
      "reservationId",
      "originReservationId",
      "reservationAction",
      "effectiveAction",
      "candidateSha256",
      "outcomeSha256",
      "outcomeSchema",
      "registeredAt",
    ]) ||
    typeof value.rootContractId !== "string" ||
    typeof decodeRunId(value.rootContractId) !== "string" ||
    typeof value.rootContractSha256 !== "string" ||
    !isSha256Hex(value.rootContractSha256) ||
    typeof value.familySha256 !== "string" ||
    !isSha256Hex(value.familySha256) ||
    typeof value.childId !== "string" ||
    typeof decodeRunId(value.childId) !== "string" ||
    typeof value.reservationId !== "string" ||
    typeof decodeRunId(value.reservationId) !== "string" ||
    typeof value.originReservationId !== "string" ||
    typeof decodeRunId(value.originReservationId) !== "string" ||
    typeof value.reservationAction !== "string" ||
    !releaseActionsV2.includes(value.reservationAction as ReleaseActionV1) ||
    typeof value.effectiveAction !== "string" ||
    !releaseActionsV2.includes(value.effectiveAction as ReleaseActionV1) ||
    typeof value.candidateSha256 !== "string" ||
    !isSha256Hex(value.candidateSha256) ||
    typeof value.outcomeSha256 !== "string" ||
    !isSha256Hex(value.outcomeSha256) ||
    (value.outcomeSchema !== "foreman.action-outcome.v1" &&
      value.outcomeSchema !== "foreman.council-outcome.v1") ||
    typeof value.registeredAt !== "string" ||
    !isUtcSecondTimestamp(value.registeredAt)
  ) {
    return null;
  }
  return {
    rootContractId: value.rootContractId,
    rootContractSha256: value.rootContractSha256,
    familySha256: value.familySha256,
    childId: value.childId,
    reservationId: value.reservationId,
    originReservationId: value.originReservationId,
    reservationAction: value.reservationAction as ReleaseActionV1,
    effectiveAction: value.effectiveAction as ReleaseActionV1,
    candidateSha256: value.candidateSha256,
    outcomeSha256: value.outcomeSha256,
    outcomeSchema: value.outcomeSchema,
    registeredAt: value.registeredAt,
  };
}

function evaluationVerdictFromUnknown(
  value: unknown,
): RegisteredEvaluationVerdictV1 | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "rootContractId",
      "rootContractSha256",
      "familySha256",
      "childId",
      "candidateSha256",
      "result",
      "completedRuns",
      "unavailableRuns",
      "notRunRuns",
      "runSetSha256",
      "evaluationAuthorityReceiptSha256",
      "verdictSha256",
      "registeredAt",
    ]) ||
    typeof value.rootContractId !== "string" ||
    typeof decodeRunId(value.rootContractId) !== "string" ||
    typeof value.rootContractSha256 !== "string" ||
    !isSha256Hex(value.rootContractSha256) ||
    typeof value.familySha256 !== "string" ||
    !isSha256Hex(value.familySha256) ||
    value.childId !== "v040-t8-evaluation" ||
    typeof value.candidateSha256 !== "string" ||
    !isSha256Hex(value.candidateSha256) ||
    ![
      "PROMOTE",
      "GRAPH_OFF_FAILED",
      "GRAPH_OFF_INCONCLUSIVE",
      "GRAPH_OFF_UNCOMPUTABLE",
    ].includes(value.result as string) ||
    ![value.completedRuns, value.unavailableRuns, value.notRunRuns].every(
      (count) =>
        Number.isSafeInteger(count) &&
        (count as number) >= 0 &&
        (count as number) <= 2000,
    ) ||
    (value.completedRuns as number) +
        (value.unavailableRuns as number) +
        (value.notRunRuns as number) !==
      2000 ||
    typeof value.runSetSha256 !== "string" ||
    !isSha256Hex(value.runSetSha256) ||
    typeof value.evaluationAuthorityReceiptSha256 !== "string" ||
    !isSha256Hex(value.evaluationAuthorityReceiptSha256) ||
    typeof value.verdictSha256 !== "string" ||
    !isSha256Hex(value.verdictSha256) ||
    typeof value.registeredAt !== "string" ||
    !isUtcSecondTimestamp(value.registeredAt)
  ) {
    return null;
  }
  return value as RegisteredEvaluationVerdictV1;
}

function executionEventFromUnknown(value: unknown): ExecutionEvent | null {
  if (!isRecord(value) || typeof value._tag !== "string") return null;
  const at = value.at;
  if (typeof at !== "string" || !isUtcSecondTimestamp(at)) return null;

  switch (value._tag) {
    case "ActionReserved": {
      const allowed = value.commandSha256 === undefined
        ? ["_tag", "action", "candidateSha256", "reservationId", "at"]
        : ["_tag", "action", "candidateSha256", "commandSha256", "reservationId", "at"];
      if (
        !exactKeys(value, allowed) ||
        typeof value.action !== "string" ||
        !executionActionKinds.includes(value.action as ExecutionActionKind) ||
        typeof value.candidateSha256 !== "string" ||
        !isSha256Hex(value.candidateSha256) ||
        typeof value.reservationId !== "string" ||
        value.reservationId.length === 0 ||
        (value.commandSha256 !== undefined &&
          (typeof value.commandSha256 !== "string" ||
            !isSha256Hex(value.commandSha256)))
      ) {
        return null;
      }
      return {
        _tag: "ActionReserved",
        action: value.action as ExecutionActionKind,
        candidateSha256: value.candidateSha256,
        ...(value.commandSha256 === undefined
          ? {}
          : { commandSha256: value.commandSha256 }),
        reservationId: value.reservationId,
        at,
      };
    }
    case "ProductChanged":
      if (
        !exactKeys(value, ["_tag", "candidateSha256", "allowedPathsSha256", "at"]) ||
        typeof value.candidateSha256 !== "string" ||
        !isSha256Hex(value.candidateSha256) ||
        typeof value.allowedPathsSha256 !== "string" ||
        !isSha256Hex(value.allowedPathsSha256)
      ) return null;
      return {
        _tag: "ProductChanged",
        candidateSha256: value.candidateSha256,
        allowedPathsSha256: value.allowedPathsSha256,
        at,
      };
    case "MilestoneRecorded": {
      const milestones = ["checks", "audit", "integrated", "published"] as const;
      if (
        !exactKeys(value, ["_tag", "milestone", "candidateSha256", "evidenceSha256", "at"]) ||
        typeof value.milestone !== "string" ||
        !milestones.includes(value.milestone as ExecutionMilestone) ||
        typeof value.candidateSha256 !== "string" ||
        !isSha256Hex(value.candidateSha256) ||
        typeof value.evidenceSha256 !== "string" ||
        !isSha256Hex(value.evidenceSha256)
      ) return null;
      return {
        _tag: "MilestoneRecorded",
        milestone: value.milestone as ExecutionMilestone,
        candidateSha256: value.candidateSha256,
        evidenceSha256: value.evidenceSha256,
        at,
      };
    }
    case "TerminalDecided": {
      const terminals: readonly ExecutionTerminalTag[] = [
        "Completed", "Escalated", "Stalled", "BudgetExhausted",
        "Cancelled", "Invalidated", "BlockedExternal",
      ];
      if (
        !exactKeys(value, ["_tag", "terminal", "reason", "at"]) ||
        typeof value.terminal !== "string" ||
        !terminals.includes(value.terminal as ExecutionTerminalTag) ||
        typeof value.reason !== "string" ||
        value.reason.length === 0
      ) return null;
      return {
        _tag: "TerminalDecided",
        terminal: value.terminal as ExecutionTerminalTag,
        reason: value.reason,
        at,
      };
    }
    default:
      return null;
  }
}

function executionV2EventFromUnknown(value: unknown): ExecutionV2Event | null {
  if (!isRecord(value) || value._tag !== "ActionReserved") {
    return executionEventFromUnknown(value);
  }
  const allowed = value.commandSha256 === undefined
    ? ["_tag", "action", "candidateSha256", "reservationId", "at"]
    : [
        "_tag",
        "action",
        "candidateSha256",
        "commandSha256",
        "reservationId",
        "at",
      ];
  if (
    !exactKeys(value, allowed) ||
    typeof value.action !== "string" ||
    !releaseActionsV2.includes(value.action as ReleaseActionV1) ||
    typeof value.candidateSha256 !== "string" ||
    !isSha256Hex(value.candidateSha256) ||
    typeof value.reservationId !== "string" ||
    typeof decodeRunId(value.reservationId) !== "string" ||
    typeof value.at !== "string" ||
    !isUtcSecondTimestamp(value.at) ||
    (value.commandSha256 !== undefined &&
      (typeof value.commandSha256 !== "string" ||
        !isSha256Hex(value.commandSha256)))
  ) {
    return null;
  }
  return {
    _tag: "ActionReserved",
    action: value.action as ReleaseActionV1,
    candidateSha256: value.candidateSha256,
    ...(value.commandSha256 === undefined
      ? {}
      : { commandSha256: value.commandSha256 }),
    reservationId: value.reservationId,
    at: value.at,
  };
}

function executionV2OperationFromUnknown(
  value: unknown,
): ExecutionV2ChildOperationV1 | null {
  if (!isRecord(value) || typeof value._tag !== "string") return null;
  const runId = (item: unknown): item is string =>
    typeof item === "string" && typeof decodeRunId(item) === "string";
  const digest = (item: unknown): item is string =>
    typeof item === "string" && isSha256Hex(item);
  switch (value._tag) {
    case "ReserveAction": {
      if (
        !exactKeys(value, [
          "_tag",
          "reservationId",
          "reservationAction",
          "effectiveAction",
          "originReservationId",
          "candidate",
          "taskPlanSha256",
          "authorityBundleSha256",
        ]) ||
        !runId(value.reservationId) ||
        typeof value.reservationAction !== "string" ||
        !releaseActionsV2.includes(value.reservationAction as ReleaseActionV1) ||
        typeof value.effectiveAction !== "string" ||
        !releaseActionsV2.includes(value.effectiveAction as ReleaseActionV1) ||
        !runId(value.originReservationId) ||
        !digest(value.taskPlanSha256) ||
        !digest(value.authorityBundleSha256)
      ) {
        return null;
      }
      const candidate = candidateFromUnknown(value.candidate);
      if (candidate === null) return null;
      return {
        _tag: "ReserveAction",
        reservationId: value.reservationId,
        reservationAction: value.reservationAction as ReleaseActionV1,
        effectiveAction: value.effectiveAction as ReleaseActionV1,
        originReservationId: value.originReservationId,
        candidate,
        taskPlanSha256: value.taskPlanSha256,
        authorityBundleSha256: value.authorityBundleSha256,
      };
    }
    case "RecordProductChange": {
      if (
        !exactKeys(value, [
          "_tag",
          "reservationId",
          "originReservationId",
          "baseCandidate",
          "candidate",
          "allowedPathsSha256",
        ]) ||
        !runId(value.reservationId) ||
        !runId(value.originReservationId) ||
        !digest(value.allowedPathsSha256)
      ) {
        return null;
      }
      const baseCandidate = candidateFromUnknown(value.baseCandidate);
      const candidate = candidateFromUnknown(value.candidate);
      if (baseCandidate === null || candidate === null) return null;
      return {
        _tag: "RecordProductChange",
        reservationId: value.reservationId,
        originReservationId: value.originReservationId,
        baseCandidate,
        candidate,
        allowedPathsSha256: value.allowedPathsSha256,
      };
    }
    case "RecordMilestone":
      if (
        !exactKeys(value, [
          "_tag",
          "milestone",
          "outcomeSha256",
          "reservationId",
          "originReservationId",
          "candidateSha256",
        ]) ||
        typeof value.milestone !== "string" ||
        !["checks", "audit", "integrated", "published"].includes(
          value.milestone,
        ) ||
        !digest(value.outcomeSha256) ||
        !runId(value.reservationId) ||
        !runId(value.originReservationId) ||
        !digest(value.candidateSha256)
      ) {
        return null;
      }
      return {
        _tag: "RecordMilestone",
        milestone: value.milestone as ExecutionMilestone,
        outcomeSha256: value.outcomeSha256,
        reservationId: value.reservationId,
        originReservationId: value.originReservationId,
        candidateSha256: value.candidateSha256,
      };
    case "RecordBlockingOutcome":
    case "RecordExternalFailure":
      if (
        !exactKeys(value, [
          "_tag",
          "outcomeSha256",
          "reservationId",
          "originReservationId",
          "candidateSha256",
        ]) ||
        !digest(value.outcomeSha256) ||
        !runId(value.reservationId) ||
        !runId(value.originReservationId) ||
        !digest(value.candidateSha256)
      ) {
        return null;
      }
      return {
        _tag: value._tag,
        outcomeSha256: value.outcomeSha256,
        reservationId: value.reservationId,
        originReservationId: value.originReservationId,
        candidateSha256: value.candidateSha256,
      };
    case "Cancel":
      return exactKeys(value, ["_tag", "approvalSha256", "reasonSha256"]) &&
        digest(value.approvalSha256) &&
        digest(value.reasonSha256)
        ? {
            _tag: "Cancel",
            approvalSha256: value.approvalSha256,
            reasonSha256: value.reasonSha256,
          }
        : null;
    case "Invalidate":
      return exactKeys(value, [
        "_tag",
        "approvalSha256",
        "observedFamilySha256",
        "reasonSha256",
      ]) &&
        digest(value.approvalSha256) &&
        digest(value.observedFamilySha256) &&
        digest(value.reasonSha256)
        ? {
            _tag: "Invalidate",
            approvalSha256: value.approvalSha256,
            observedFamilySha256: value.observedFamilySha256,
            reasonSha256: value.reasonSha256,
          }
        : null;
    default:
      return null;
  }
}

type FamilyJournalPayloadV2 =
  | ({ readonly _tag: "ExecutionFamilyAuthorityRegistered" } &
      ExecutionFamilyAuthorityStateV1)
  | (Omit<ExecutionFamilyActivationV1, "rootContractId" | "rootContractSha256"> & {
      readonly _tag: "EndstopFamilyActivated";
    })
  | ({ readonly _tag: "ExecutionChildAuthorityRegistered" } &
      RegisteredReleaseAuthorityV1)
  | ({ readonly _tag: "ExecutionChildOutcomeRegistered" } &
      RegisteredReleaseOutcomeV1)
  | ({ readonly _tag: "ExecutionEvaluationVerdictRegistered" } &
      RegisteredEvaluationVerdictV1)
  | {
      readonly _tag: "EndstopChildDecision";
      readonly familySha256: string;
      readonly childId: string;
      readonly operation: ExecutionV2ChildOperationV1;
      readonly events: readonly ExecutionV2Event[];
    };

function familyJournalPayloadFromUnknown(
  value: unknown,
): FamilyJournalPayloadV2 | null {
  if (!isRecord(value) || typeof value._tag !== "string") return null;
  if (value._tag === "ExecutionFamilyAuthorityRegistered") {
    if (
      !exactKeys(value, [
        "_tag",
        "rootContractId",
        "rootContractSha256",
        "familySha256",
        "sourceSha256",
        "auditReceiptSha256",
        "userReceiptSha256",
        "registeredAt",
      ]) ||
      typeof value.rootContractId !== "string" ||
      typeof decodeRunId(value.rootContractId) !== "string" ||
      typeof value.rootContractSha256 !== "string" ||
      typeof value.familySha256 !== "string" ||
      typeof value.sourceSha256 !== "string" ||
      typeof value.auditReceiptSha256 !== "string" ||
      typeof value.userReceiptSha256 !== "string" ||
      !isSha256Hex(value.rootContractSha256) ||
      !isSha256Hex(value.familySha256) ||
      !isSha256Hex(value.sourceSha256) ||
      !isSha256Hex(value.auditReceiptSha256) ||
      !isSha256Hex(value.userReceiptSha256) ||
      typeof value.registeredAt !== "string" ||
      !isUtcSecondTimestamp(value.registeredAt)
    ) {
      return null;
    }
    return {
      _tag: "ExecutionFamilyAuthorityRegistered",
      rootContractId: value.rootContractId,
      rootContractSha256: value.rootContractSha256,
      familySha256: value.familySha256,
      sourceSha256: value.sourceSha256,
      auditReceiptSha256: value.auditReceiptSha256,
      userReceiptSha256: value.userReceiptSha256,
      registeredAt: value.registeredAt,
    };
  }
  if (value._tag === "EndstopFamilyActivated") {
    if (
      !exactKeys(value, [
        "_tag",
        "familySha256",
        "sourceSha256",
        "auditReceiptSha256",
        "userReceiptSha256",
        "activatedAt",
      ]) ||
      typeof value.familySha256 !== "string" ||
      typeof value.sourceSha256 !== "string" ||
      typeof value.auditReceiptSha256 !== "string" ||
      typeof value.userReceiptSha256 !== "string" ||
      !isSha256Hex(value.familySha256) ||
      !isSha256Hex(value.sourceSha256) ||
      !isSha256Hex(value.auditReceiptSha256) ||
      !isSha256Hex(value.userReceiptSha256) ||
      typeof value.activatedAt !== "string" ||
      !isUtcSecondTimestamp(value.activatedAt)
    ) {
      return null;
    }
    return {
      _tag: "EndstopFamilyActivated",
      familySha256: value.familySha256,
      sourceSha256: value.sourceSha256,
      auditReceiptSha256: value.auditReceiptSha256,
      userReceiptSha256: value.userReceiptSha256,
      activatedAt: value.activatedAt,
    };
  }
  if (value._tag === "ExecutionChildAuthorityRegistered") {
    const { _tag: ignored, ...raw } = value;
    void ignored;
    const authority = childAuthorityFromUnknown(raw);
    return authority === null
      ? null
      : { _tag: "ExecutionChildAuthorityRegistered", ...authority };
  }
  if (value._tag === "ExecutionChildOutcomeRegistered") {
    const { _tag: ignored, ...raw } = value;
    void ignored;
    const outcome = childOutcomeFromUnknown(raw);
    return outcome === null
      ? null
      : { _tag: "ExecutionChildOutcomeRegistered", ...outcome };
  }
  if (value._tag === "ExecutionEvaluationVerdictRegistered") {
    const { _tag: ignored, ...raw } = value;
    void ignored;
    const verdict = evaluationVerdictFromUnknown(raw);
    return verdict === null
      ? null
      : { _tag: "ExecutionEvaluationVerdictRegistered", ...verdict };
  }
  if (value._tag === "EndstopChildDecision") {
    if (
      !exactKeys(value, [
        "_tag",
        "familySha256",
        "childId",
        "operation",
        "events",
      ]) ||
      typeof value.familySha256 !== "string" ||
      !isSha256Hex(value.familySha256) ||
      typeof value.childId !== "string" ||
      typeof decodeRunId(value.childId) !== "string" ||
      !Array.isArray(value.events) ||
      value.events.length === 0
    ) {
      return null;
    }
    const operation = executionV2OperationFromUnknown(value.operation);
    if (operation === null) return null;
    const events: ExecutionV2Event[] = [];
    for (const item of value.events) {
      const event = executionV2EventFromUnknown(item);
      if (event === null || (events[0] !== undefined && event.at !== events[0].at)) {
        return null;
      }
      events.push(event);
    }
    return {
      _tag: "EndstopChildDecision",
      familySha256: value.familySha256,
      childId: value.childId,
      operation,
      events,
    };
  }
  return null;
}

function sameCandidate(
  left: ReleaseCandidateIdentityV1,
  right: ReleaseCandidateIdentityV1,
): boolean {
  return (
    left.commit === right.commit &&
    left.tree === right.tree &&
    left.candidateSha256 === right.candidateSha256
  );
}

function childAuthorityIdentity(
  authority: RegisteredReleaseAuthorityV1,
): string {
  return canonicalize({
    familySha256: authority.familySha256,
    childId: authority.childId,
    action: authority.action,
    candidateSha256: authority.candidate.candidateSha256,
    priorReservationId: authority.priorReservationId,
  });
}

function authorityMatchesReservation(
  authority: RegisteredReleaseAuthorityV1,
  operation: Extract<
    ExecutionV2ChildOperationV1,
    { readonly _tag: "ReserveAction" }
  >,
): boolean {
  const wrapper =
    operation.reservationAction === "provider_retry" ||
    operation.reservationAction === "resume";
  return (
    authority.action === operation.reservationAction &&
    authority.effectiveAction === operation.effectiveAction &&
    sameCandidate(authority.candidate, operation.candidate) &&
    authority.taskPlanSha256 === operation.taskPlanSha256 &&
    authority.bundleSha256 === operation.authorityBundleSha256 &&
    (wrapper
      ? authority.priorReservationId !== null &&
        authority.originReservationId === operation.originReservationId
      : authority.priorReservationId === null &&
        authority.originReservationId === null &&
        operation.originReservationId === operation.reservationId)
  );
}

function hasAvailableChildAuthority(
  authorities: readonly RegisteredReleaseAuthorityV1[],
  family: ExecutionFamilyStateV2,
  childId: string,
  operation: Extract<
    ExecutionV2ChildOperationV1,
    { readonly _tag: "ReserveAction" }
  >,
  at: string,
): boolean {
  const child = family.children[childId];
  if (child === undefined) return false;
  return authorities.some(
    (item) =>
      item.familySha256 === family.familySha256 &&
      item.childId === childId &&
      Date.parse(item.registeredAt) <= Date.parse(at) &&
      authorityMatchesReservation(item, operation),
  );
}

function outcomeMatchesReservation(
  outcome: RegisteredReleaseOutcomeV1,
  family: ExecutionFamilyStateV2,
): boolean {
  const reservation =
    family.children[outcome.childId]?.reservations[outcome.reservationId];
  return (
    reservation !== undefined &&
    reservation.originReservationId === outcome.originReservationId &&
    reservation.reservationAction === outcome.reservationAction &&
    reservation.effectiveAction === outcome.effectiveAction &&
    reservation.candidate.candidateSha256 === outcome.candidateSha256
  );
}

function operationOutcome(
  operation: ExecutionV2ChildOperationV1,
): {
  readonly reservationId: string;
  readonly originReservationId: string;
  readonly candidateSha256: string;
  readonly outcomeSha256: string;
} | null {
  return operation._tag === "RecordMilestone" ||
      operation._tag === "RecordBlockingOutcome" ||
      operation._tag === "RecordExternalFailure"
    ? operation
    : null;
}

function evaluationRunSetSha256(family: ExecutionFamilyStateV2): string | null {
  const child = family.children["v040-t8-evaluation"];
  if (child === undefined) return null;
  const encoder = new TextEncoder();
  const rows = Object.entries(child.evaluationPassOrigins)
    .map(([originReservationId, outcomeSha256]) => ({
      originReservationId,
      outcomeSha256,
    }))
    .sort((left, right) =>
      Buffer.from(encoder.encode(left.originReservationId)).compare(
        Buffer.from(encoder.encode(right.originReservationId)),
      ),
    );
  return sha256Hex(canonicalize(rows));
}

function replayHistory(
  events: readonly StoredEvent[],
  loadManifest: (familySha256: string) => ExecutionContractFamilyV2 | null,
): HistoryResult {
  const relevant = events.filter(
    (event) =>
      event.type === CONTRACT_EVENT ||
      event.type === DECISION_EVENT ||
      event.type === V2_EVENT,
  );
  const contracts = relevant.filter((event) => event.type === CONTRACT_EVENT);
  if (contracts.length === 0) {
    return relevant.length === 0
      ? { _tag: "Missing" }
      : { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
  }
  if (contracts.length !== 1 || relevant[0]?.type !== CONTRACT_EVENT) {
    return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
  }

  const contractStored = contracts[0]!;
  if (
    contractStored.lane !== ENDSTOP_LANE ||
    !exactKeys(contractStored.payload as Record<string, unknown>, [
      "contract",
      "contractSha256",
    ])
  ) {
    return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
  }
  const decoded = decodeExecutionContractV1(contractStored.payload.contract);
  const hash = contractStored.payload.contractSha256;
  if (
    isExecutionContractFailure(decoded) ||
    typeof hash !== "string" ||
    !isSha256Hex(hash) ||
    executionContractSha256(decoded) !== hash
  ) {
    return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
  }

  let root: ExecutionState = initialExecutionState(decoded);
  let authority: ExecutionFamilyAuthorityStateV1 | null = null;
  let family: ExecutionFamilyStateV2 | null = null;
  const childAuthorities: RegisteredReleaseAuthorityV1[] = [];
  const childOutcomes: RegisteredReleaseOutcomeV1[] = [];
  const evaluationVerdicts: RegisteredEvaluationVerdictV1[] = [];
  for (const stored of relevant.slice(1)) {
    if (stored.type === DECISION_EVENT) {
      if (
        authority !== null ||
        stored.lane !== ENDSTOP_LANE ||
        !exactKeys(stored.payload as Record<string, unknown>, [
          "contractSha256",
          "events",
        ]) ||
        stored.payload.contractSha256 !== hash ||
        !Array.isArray(stored.payload.events) ||
        stored.payload.events.length === 0 ||
        isExecutionTerminal(root)
      ) {
        return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
      }
      for (const raw of stored.payload.events) {
        const event = executionEventFromUnknown(raw);
        if (
          event === null ||
          Date.parse(event.at) < Date.parse(root.lastEventAt) ||
          (event._tag === "ProductChanged" &&
            event.allowedPathsSha256 !== root.contract.allowedPathsSha256)
        ) {
          return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
        }
        root = evolveExecution(root, event);
      }
      continue;
    }
    if (stored.type !== V2_EVENT || stored.lane !== ENDSTOP_LANE) {
      return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
    }
    const payload = familyJournalPayloadFromUnknown(stored.payload);
    if (payload === null || isExecutionTerminal(root)) {
      return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
    }
    if (payload._tag === "ExecutionFamilyAuthorityRegistered") {
      if (
        authority !== null ||
        family !== null ||
        payload.rootContractId !== decoded.contractId ||
        payload.rootContractSha256 !== hash ||
        Date.parse(payload.registeredAt) < Date.parse(root.lastEventAt)
      ) {
        return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
      }
      authority = {
        rootContractId: payload.rootContractId,
        rootContractSha256: payload.rootContractSha256,
        familySha256: payload.familySha256,
        sourceSha256: payload.sourceSha256,
        auditReceiptSha256: payload.auditReceiptSha256,
        userReceiptSha256: payload.userReceiptSha256,
        registeredAt: payload.registeredAt,
      };
      continue;
    }
    if (payload._tag === "EndstopFamilyActivated") {
      if (
        authority === null ||
        family !== null ||
        payload.familySha256 !== authority.familySha256 ||
        payload.sourceSha256 !== authority.sourceSha256 ||
        payload.auditReceiptSha256 !== authority.auditReceiptSha256 ||
        payload.userReceiptSha256 !== authority.userReceiptSha256 ||
        Date.parse(payload.activatedAt) < Date.parse(authority.registeredAt)
      ) {
        return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
      }
      const manifest = loadManifest(payload.familySha256);
      if (
        manifest === null ||
        manifest.rootContractId !== decoded.contractId ||
        manifest.rootContractSha256 !== hash ||
        manifest.sourceSha256 !== authority.sourceSha256 ||
        executionContractFamilySha256(manifest) !== payload.familySha256
      ) {
        return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
      }
      const activated = initialExecutionFamilyStateV2({
        manifest,
        familySha256: payload.familySha256,
        activatedAt: payload.activatedAt,
        priorRootActions: root.counts.totalActions,
      });
      if (isExecutionFamilyFailure(activated)) {
        return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
      }
      family = activated;
      continue;
    }
    if (payload._tag === "ExecutionChildAuthorityRegistered") {
      const { _tag: ignored, ...item } = payload;
      void ignored;
      if (
        authority === null ||
        family === null ||
        item.rootContractId !== decoded.contractId ||
        item.rootContractSha256 !== hash ||
        item.familySha256 !== family.familySha256 ||
        family.children[item.childId] === undefined ||
        Date.parse(item.registeredAt) < Date.parse(family.activatedAt) ||
        childAuthorities.some(
          (existing) => childAuthorityIdentity(existing) === childAuthorityIdentity(item),
        )
      ) {
        return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
      }
      childAuthorities.push(item);
      continue;
    }
    if (payload._tag === "ExecutionChildOutcomeRegistered") {
      const { _tag: ignored, ...item } = payload;
      void ignored;
      if (
        family === null ||
        item.rootContractId !== decoded.contractId ||
        item.rootContractSha256 !== hash ||
        item.familySha256 !== family.familySha256 ||
        !outcomeMatchesReservation(item, family) ||
        Date.parse(item.registeredAt) <
          Date.parse(family.children[item.childId]!.lastEventAt) ||
        childOutcomes.some(
          (existing) => existing.reservationId === item.reservationId,
        )
      ) {
        return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
      }
      childOutcomes.push(item);
      if (item.effectiveAction === "evaluate") {
        family = recordExecutionEvaluationPassV2({
          state: family,
          childId: item.childId,
          originReservationId: item.originReservationId,
          outcomeSha256: item.outcomeSha256,
          at: item.registeredAt,
        });
      }
      continue;
    }
    if (payload._tag === "ExecutionEvaluationVerdictRegistered") {
      const { _tag: ignored, ...item } = payload;
      void ignored;
      if (
        family === null ||
        item.rootContractId !== decoded.contractId ||
        item.rootContractSha256 !== hash ||
        item.familySha256 !== family.familySha256 ||
        evaluationVerdicts.some(
          (existing) => existing.childId === item.childId,
        ) ||
        Date.parse(item.registeredAt) <
          Date.parse(family.children[item.childId]!.lastEventAt) ||
        childAuthorities.every(
          (registered) =>
            registered.childId !== item.childId ||
            registered.effectiveAction !== "evaluate" ||
            registered.candidate.candidateSha256 !== item.candidateSha256 ||
            registered.evaluationManifestSha256 !==
              item.evaluationAuthorityReceiptSha256,
        ) ||
        evaluationRunSetSha256(family) !== item.runSetSha256
      ) {
        return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
      }
      const verdict = registerExecutionEvaluationVerdictV2({
        state: family,
        childId: item.childId,
        verdict: {
          candidateSha256: item.candidateSha256,
          result: item.result,
          completedRuns: item.completedRuns,
          unavailableRuns: item.unavailableRuns,
          notRunRuns: item.notRunRuns,
          runSetSha256: item.runSetSha256,
          verdictSha256: item.verdictSha256,
        },
      });
      if (verdict._tag !== "Accepted") {
        return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
      }
      evaluationVerdicts.push(item);
      const verdictChild = verdict.state.children[item.childId]!;
      family = {
        ...verdict.state,
        children: {
          ...verdict.state.children,
          [item.childId]: {
            ...verdictChild,
            lastEventAt: item.registeredAt,
            lastProgressAt: item.registeredAt,
          },
        },
      };
      continue;
    }
    if (family === null || payload.familySha256 !== family.familySha256) {
      return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
    }
    const at = payload.events[0]!.at;
    if (
      payload.operation._tag === "ReserveAction" &&
      !hasAvailableChildAuthority(
        childAuthorities,
        family,
        payload.childId,
        payload.operation,
        at,
      )
    ) {
      return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
    }
    const requiredOutcome = operationOutcome(payload.operation);
    if (
      requiredOutcome !== null &&
      !childOutcomes.some(
        (item) =>
          item.childId === payload.childId &&
          item.reservationId === requiredOutcome.reservationId &&
          item.originReservationId === requiredOutcome.originReservationId &&
          item.candidateSha256 === requiredOutcome.candidateSha256 &&
          item.outcomeSha256 === requiredOutcome.outcomeSha256,
      )
    ) {
      return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
    }
    const replayed = decideExecutionChildOperationV2({
      state: family,
      childId: payload.childId,
      operation: payload.operation,
      at,
    });
    if (
      (replayed._tag !== "Accepted" && replayed._tag !== "Terminated") ||
      canonicalize(replayed.events) !== canonicalize(payload.events)
    ) {
      return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
    }
    family = evolveExecutionFamilyV2(
      family,
      payload.childId,
      payload.operation,
      replayed,
    );
  }
  return {
    _tag: "Ok",
    state: {
      root,
      authority,
      family,
      childAuthorities,
      childOutcomes,
      evaluationVerdicts,
    },
  };
}

type TransactionResult<A> =
  | { readonly _tag: "Ok"; readonly value: A }
  | { readonly _tag: "Failure"; readonly failure: EndstopLedgerFailure };

function unwrap<A>(result: TransactionResult<A>): Effect.Effect<A, EndstopLedgerFailure> {
  return result._tag === "Ok" ? Effect.succeed(result.value) : Effect.fail(result.failure);
}

function withJournalFailure<A>(
  effect: Effect.Effect<TransactionResult<A>, unknown>,
): Effect.Effect<A, EndstopLedgerFailure> {
  return effect.pipe(
    Effect.catchAll(() => Effect.fail(ledgerFailure("journal_failure"))),
    Effect.flatMap(unwrap),
  );
}

const familyManifestEncoder = new TextEncoder();

function familyManifestPath(stateRoot: string, familySha256: string): string {
  return join(stateRoot, "release-families", familySha256, "manifest.json");
}

function loadFamilyManifestLive(
  stateRoot: string,
  familySha256: string,
): ExecutionContractFamilyV2 | null {
  try {
    if (!isSha256Hex(familySha256)) return null;
    const bytes = readFileSync(familyManifestPath(stateRoot, familySha256));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.endsWith("\n") || text.endsWith("\r\n")) return null;
    const body = text.slice(0, -1);
    const raw = JSON.parse(body) as unknown;
    if (canonicalize(raw) !== body) return null;
    const manifest = decodeExecutionContractFamilyV2(raw);
    if (
      isExecutionFamilyFailure(manifest) ||
      executionContractFamilySha256(manifest) !== familySha256
    ) {
      return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

function publishFamilyManifestLive(
  stateRoot: string,
  manifest: ExecutionContractFamilyV2,
  familySha256: string,
): void {
  const decoded = decodeExecutionContractFamilyV2(manifest);
  if (
    isExecutionFamilyFailure(decoded) ||
    executionContractFamilySha256(decoded) !== familySha256
  ) {
    throw new Error("invalid family manifest");
  }
  const bytes = familyManifestEncoder.encode(`${canonicalize(decoded)}\n`);
  const path = familyManifestPath(stateRoot, familySha256);
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    const current = readFileSync(path);
    if (current.equals(Buffer.from(bytes))) return;
    throw new Error("conflicting family manifest");
  }
  const temporary = join(parent, `.manifest-${randomUUID()}.tmp`);
  let fd: number | null = null;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temporary, path);
    const parentFd = openSync(parent, "r");
    try {
      fsyncSync(parentFd);
    } finally {
      closeSync(parentFd);
    }
  } catch (error) {
    if (fd !== null) closeSync(fd);
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may already have been renamed.
    }
    throw error;
  }
}

export function makeLiveEndstopLedgerLayer(
  stateRoot: string,
): Layer.Layer<EndstopLedger> {
  const journalLayer = makeLiveRunJournalLayer(stateRoot);
  const loadManifest = (familySha256: string): ExecutionContractFamilyV2 | null =>
    loadFamilyManifestLive(stateRoot, familySha256);
  const readHistory = (
    contractId: string,
  ): Effect.Effect<ReplayedHistoryV2, EndstopLedgerFailure> => {
    const runId = decodeRunId(contractId);
    if (typeof runId !== "string") {
      return Effect.fail(ledgerFailure("invalid_contract_id"));
    }
    const transaction = Effect.gen(function* () {
      const journal = yield* RunJournal;
      return yield* journal.transact<TransactionResult<ReplayedHistoryV2>>(
        runId as RunId,
        (events) => {
          const history = replayHistory(events, loadManifest);
          if (history._tag === "Ok") {
            return {
              _tag: "Return",
              value: { _tag: "Ok", value: history.state } as const,
            };
          }
          return {
            _tag: "Return",
            value: {
              _tag: "Failure",
              failure:
                history._tag === "Missing"
                  ? ledgerFailure("missing_contract")
                  : history.failure,
            } as const,
          };
        },
      );
    }).pipe(Effect.provide(journalLayer));
    return withJournalFailure(transaction);
  };
  const readState = (
    contractId: string,
  ): Effect.Effect<ExecutionState, EndstopLedgerFailure> =>
    readHistory(contractId).pipe(Effect.map((history) => history.root));

  return Layer.succeed(EndstopLedger, {
    create: (contract) => {
      const decoded = decodeExecutionContractV1(contract);
      if (isExecutionContractFailure(decoded)) {
        return Effect.fail(ledgerFailure("invalid_contract"));
      }
      const runId = decodeRunId(decoded.contractId);
      if (typeof runId !== "string") {
        return Effect.fail(ledgerFailure("invalid_contract_id"));
      }
      const contractSha256 = executionContractSha256(decoded);
      const transaction = Effect.gen(function* () {
        const journal = yield* RunJournal;
        return yield* journal.transact<TransactionResult<ExecutionState>>(
          runId as RunId,
          (events) => {
          const history = replayHistory(events, loadManifest);
          if (history._tag === "Failure") {
            return { _tag: "Return", value: history };
          }
          if (history._tag === "Ok") {
            return history.state.root.contractSha256 === contractSha256
              ? { _tag: "Return", value: { _tag: "Ok", value: history.state.root } as const }
              : {
                  _tag: "Return",
                  value: { _tag: "Failure", failure: ledgerFailure("contract_mismatch") } as const,
                };
          }
          const state = initialExecutionState(decoded);
          return {
            _tag: "Append",
            draft: {
              type: CONTRACT_EVENT,
              lane: ENDSTOP_LANE,
              payload: { contract: decoded, contractSha256 },
            },
            result: () => ({ _tag: "Ok", value: state }) as const,
          };
          },
        );
      }).pipe(Effect.provide(journalLayer));
      const createContract = withJournalFailure(transaction);
      if (decoded.supersedesContractId === undefined) return createContract;

      return Effect.gen(function* () {
        const predecessor = yield* readState(decoded.supersedesContractId!).pipe(
          Effect.catchAll(() =>
            Effect.fail(ledgerFailure("replacement_unauthorized")),
          ),
        );
        if (
          !isExecutionTerminal(predecessor) ||
          predecessor.contract.packageId !== decoded.packageId ||
          predecessor.contract.authorizationSha256 === decoded.authorizationSha256
        ) {
          return yield* Effect.fail(ledgerFailure("replacement_unauthorized"));
        }
        return yield* createContract;
      });
    },
    status: readState,
    execute: (contractId, expectedContractSha256, command) => {
      const runId = decodeRunId(contractId);
      if (typeof runId !== "string") {
        return Effect.fail(ledgerFailure("invalid_contract_id"));
      }
      if (!isSha256Hex(expectedContractSha256)) {
        return Effect.fail(ledgerFailure("contract_mismatch"));
      }
      const transaction = Effect.gen(function* () {
        const journal = yield* RunJournal;
        return yield* journal.transact<TransactionResult<EndstopExecutionResult>>(
          runId as RunId,
          (events) => {
          const history = replayHistory(events, loadManifest);
          if (history._tag !== "Ok") {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure:
                  history._tag === "Missing"
                    ? ledgerFailure("missing_contract")
                    : history.failure,
              } as const,
            };
          }
          if (history.state.root.contractSha256 !== expectedContractSha256) {
            return {
              _tag: "Return",
              value: { _tag: "Failure", failure: ledgerFailure("contract_mismatch") } as const,
            };
          }
          if (history.state.family !== null) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("family_active"),
              } as const,
            };
          }
          const decision = decideExecutionCommand(history.state.root, command);
          if (
            decision._tag === "Refused" ||
            decision._tag === "ReusedVerification" ||
            decision.events.length === 0
          ) {
            return {
              _tag: "Return",
              value: {
                _tag: "Ok",
                value: { decision, state: history.state.root },
              } as const,
            };
          }
          const nextState = decision.events.reduce(
            evolveExecution,
            history.state.root,
          );
          return {
            _tag: "Append",
            draft: {
              type: DECISION_EVENT,
              lane: ENDSTOP_LANE,
              payload: {
                contractSha256: expectedContractSha256,
                events: decision.events,
              },
            },
            result: () => ({
              _tag: "Ok",
              value: { decision, state: nextState },
            }) as const,
          };
          },
        );
      }).pipe(Effect.provide(journalLayer));
      return Effect.gen(function* () {
        const current = yield* readHistory(contractId);
        if (current.root.contractSha256 !== expectedContractSha256) {
          return yield* Effect.fail(ledgerFailure("contract_mismatch"));
        }
        if (current.family !== null) {
          return yield* Effect.fail(ledgerFailure("family_active"));
        }
        for (const dependencyId of current.root.contract.dependencyContractIds) {
          const dependency = yield* readState(dependencyId).pipe(
            Effect.catchAll(() =>
              Effect.fail(ledgerFailure("dependency_incomplete")),
            ),
          );
          if (dependency._tag !== "Completed") {
            return yield* Effect.fail(ledgerFailure("dependency_incomplete"));
          }
        }
        return yield* withJournalFailure(transaction);
      });
    },
    registerFamilyAuthority: (registration) => {
      const decodedManifest = decodeExecutionContractFamilyV2(
        registration.manifest,
      );
      if (
        isExecutionFamilyFailure(decodedManifest) ||
        typeof decodeRunId(registration.rootContractId) !== "string" ||
        !isSha256Hex(registration.rootContractSha256) ||
        !isSha256Hex(registration.familySha256) ||
        !isSha256Hex(registration.sourceSha256) ||
        !isSha256Hex(registration.auditReceiptSha256) ||
        !isSha256Hex(registration.userReceiptSha256) ||
        !isUtcSecondTimestamp(registration.registeredAt) ||
        decodedManifest.rootContractId !== registration.rootContractId ||
        decodedManifest.rootContractSha256 !== registration.rootContractSha256 ||
        decodedManifest.sourceSha256 !== registration.sourceSha256 ||
        executionContractFamilySha256(decodedManifest) !== registration.familySha256
      ) {
        return Effect.fail(ledgerFailure("family_mismatch"));
      }
      const authority: ExecutionFamilyAuthorityStateV1 = {
        rootContractId: registration.rootContractId,
        rootContractSha256: registration.rootContractSha256,
        familySha256: registration.familySha256,
        sourceSha256: registration.sourceSha256,
        auditReceiptSha256: registration.auditReceiptSha256,
        userReceiptSha256: registration.userReceiptSha256,
        registeredAt: registration.registeredAt,
      };
      const runId = decodeRunId(registration.rootContractId) as RunId;
      return Effect.gen(function* () {
        const before = yield* readHistory(registration.rootContractId);
        if (before.root.contractSha256 !== registration.rootContractSha256) {
          return yield* Effect.fail(ledgerFailure("contract_mismatch"));
        }
        if (isExecutionTerminal(before.root)) {
          return yield* Effect.fail(ledgerFailure("family_mismatch"));
        }
        yield* Effect.try({
          try: () =>
            publishFamilyManifestLive(
              stateRoot,
              decodedManifest,
              registration.familySha256,
            ),
          catch: () => ledgerFailure("journal_failure"),
        });
        const transaction = Effect.gen(function* () {
          const journal = yield* RunJournal;
          return yield* journal.transact<
            TransactionResult<ExecutionFamilyAuthorityStateV1>
          >(runId, (events) => {
            const history = replayHistory(events, loadManifest);
            if (history._tag !== "Ok") {
              return {
                _tag: "Return",
                value: {
                  _tag: "Failure",
                  failure:
                    history._tag === "Missing"
                      ? ledgerFailure("missing_contract")
                      : history.failure,
                } as const,
              };
            }
            if (
              history.state.root.contractSha256 !==
              registration.rootContractSha256
            ) {
              return {
                _tag: "Return",
                value: {
                  _tag: "Failure",
                  failure: ledgerFailure("contract_mismatch"),
                } as const,
              };
            }
            if (history.state.authority !== null) {
              return canonicalize(history.state.authority) === canonicalize(authority)
                ? {
                    _tag: "Return",
                    value: { _tag: "Ok", value: history.state.authority } as const,
                  }
                : {
                    _tag: "Return",
                    value: {
                      _tag: "Failure",
                      failure: ledgerFailure("family_authority_mismatch"),
                    } as const,
                  };
            }
            if (isExecutionTerminal(history.state.root)) {
              return {
                _tag: "Return",
                value: {
                  _tag: "Failure",
                  failure: ledgerFailure("family_mismatch"),
                } as const,
              };
            }
            return {
              _tag: "Append",
              draft: {
                type: V2_EVENT,
                lane: ENDSTOP_LANE,
                payload: {
                  _tag: "ExecutionFamilyAuthorityRegistered",
                  ...authority,
                },
              },
              result: () => ({ _tag: "Ok", value: authority }) as const,
            };
          });
        }).pipe(Effect.provide(journalLayer));
        return yield* withJournalFailure(transaction);
      });
    },
    activateFamily: (activation) => {
      const runId = decodeRunId(activation.rootContractId);
      if (
        typeof runId !== "string" ||
        !isSha256Hex(activation.rootContractSha256) ||
        !isSha256Hex(activation.familySha256) ||
        !isSha256Hex(activation.sourceSha256) ||
        !isSha256Hex(activation.auditReceiptSha256) ||
        !isSha256Hex(activation.userReceiptSha256) ||
        !isUtcSecondTimestamp(activation.activatedAt)
      ) {
        return Effect.fail(ledgerFailure("family_mismatch"));
      }
      const transaction = Effect.gen(function* () {
        const journal = yield* RunJournal;
        return yield* journal.transact<
          TransactionResult<ExecutionFamilyLedgerStatusV2>
        >(runId as RunId, (events) => {
          const history = replayHistory(events, loadManifest);
          if (history._tag !== "Ok") {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure:
                  history._tag === "Missing"
                    ? ledgerFailure("missing_contract")
                    : history.failure,
              } as const,
            };
          }
          if (history.state.root.contractSha256 !== activation.rootContractSha256) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("contract_mismatch"),
              } as const,
            };
          }
          const authority = history.state.authority;
          if (authority === null) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("family_missing"),
              } as const,
            };
          }
          if (history.state.family !== null) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("family_already_activated"),
              } as const,
            };
          }
          if (
            authority.rootContractId !== activation.rootContractId ||
            authority.familySha256 !== activation.familySha256 ||
            authority.sourceSha256 !== activation.sourceSha256 ||
            authority.auditReceiptSha256 !== activation.auditReceiptSha256 ||
            authority.userReceiptSha256 !== activation.userReceiptSha256
          ) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("family_authority_mismatch"),
              } as const,
            };
          }
          const manifest = loadManifest(activation.familySha256);
          if (manifest === null) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("family_mismatch"),
              } as const,
            };
          }
          const family = initialExecutionFamilyStateV2({
            manifest,
            familySha256: activation.familySha256,
            activatedAt: activation.activatedAt,
            priorRootActions: history.state.root.counts.totalActions,
          });
          if (isExecutionFamilyFailure(family)) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("family_mismatch"),
              } as const,
            };
          }
          const value: ExecutionFamilyLedgerStatusV2 = {
            root: history.state.root,
            authority,
            family,
            childAuthorities: history.state.childAuthorities,
            childOutcomes: history.state.childOutcomes,
            evaluationVerdicts: history.state.evaluationVerdicts,
          };
          return {
            _tag: "Append",
            draft: {
              type: V2_EVENT,
              lane: ENDSTOP_LANE,
              payload: {
                _tag: "EndstopFamilyActivated",
                familySha256: activation.familySha256,
                sourceSha256: activation.sourceSha256,
                auditReceiptSha256: activation.auditReceiptSha256,
                userReceiptSha256: activation.userReceiptSha256,
                activatedAt: activation.activatedAt,
              },
            },
            result: () => ({ _tag: "Ok", value }) as const,
          };
        });
      }).pipe(Effect.provide(journalLayer));
      return withJournalFailure(transaction);
    },
    registerChildAuthority: (registration) => {
      const decoded = childAuthorityFromUnknown(registration);
      if (decoded === null) {
        return Effect.fail(ledgerFailure("child_authority_mismatch"));
      }
      const runId = decodeRunId(decoded.rootContractId) as RunId;
      const transaction = Effect.gen(function* () {
        const journal = yield* RunJournal;
        return yield* journal.transact<
          TransactionResult<RegisteredReleaseAuthorityV1>
        >(runId, (events) => {
          const history = replayHistory(events, loadManifest);
          if (history._tag !== "Ok") {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure:
                  history._tag === "Missing"
                    ? ledgerFailure("missing_contract")
                    : history.failure,
              } as const,
            };
          }
          const family = history.state.family;
          if (
            history.state.root.contractSha256 !== decoded.rootContractSha256
          ) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("contract_mismatch"),
              } as const,
            };
          }
          if (
            family === null ||
            family.familySha256 !== decoded.familySha256 ||
            family.children[decoded.childId] === undefined ||
            Date.parse(decoded.registeredAt) < Date.parse(family.activatedAt)
          ) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("family_mismatch"),
              } as const,
            };
          }
          const identity = childAuthorityIdentity(decoded);
          const existing = history.state.childAuthorities.find(
            (item) => childAuthorityIdentity(item) === identity,
          );
          if (existing !== undefined) {
            return canonicalize(existing) === canonicalize(decoded)
              ? {
                  _tag: "Return",
                  value: { _tag: "Ok", value: existing } as const,
                }
              : {
                  _tag: "Return",
                  value: {
                    _tag: "Failure",
                    failure: ledgerFailure("child_authority_mismatch"),
                  } as const,
                };
          }
          return {
            _tag: "Append",
            draft: {
              type: V2_EVENT,
              lane: ENDSTOP_LANE,
              payload: {
                _tag: "ExecutionChildAuthorityRegistered",
                ...decoded,
              },
            },
            result: () => ({ _tag: "Ok", value: decoded }) as const,
          };
        });
      }).pipe(Effect.provide(journalLayer));
      return withJournalFailure(transaction);
    },
    registerChildOutcome: (registration) => {
      const decoded = childOutcomeFromUnknown(registration);
      if (decoded === null) {
        return Effect.fail(ledgerFailure("child_authority_mismatch"));
      }
      const runId = decodeRunId(decoded.rootContractId) as RunId;
      const transaction = Effect.gen(function* () {
        const journal = yield* RunJournal;
        return yield* journal.transact<
          TransactionResult<RegisteredReleaseOutcomeV1>
        >(runId, (events) => {
          const history = replayHistory(events, loadManifest);
          if (history._tag !== "Ok") {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure:
                  history._tag === "Missing"
                    ? ledgerFailure("missing_contract")
                    : history.failure,
              } as const,
            };
          }
          if (history.state.root.contractSha256 !== decoded.rootContractSha256) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("contract_mismatch"),
              } as const,
            };
          }
          const family = history.state.family;
          const child = family?.children[decoded.childId];
          if (
            family === null ||
            family === undefined ||
            child === undefined ||
            family.familySha256 !== decoded.familySha256 ||
            !outcomeMatchesReservation(decoded, family) ||
            Date.parse(decoded.registeredAt) < Date.parse(child.lastEventAt) ||
            (decoded.effectiveAction === "council") !==
              (decoded.outcomeSchema === "foreman.council-outcome.v1")
          ) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("child_authority_mismatch"),
              } as const,
            };
          }
          const existing = history.state.childOutcomes.find(
            (item) => item.reservationId === decoded.reservationId,
          );
          if (existing !== undefined) {
            return canonicalize(existing) === canonicalize(decoded)
              ? {
                  _tag: "Return",
                  value: { _tag: "Ok", value: existing } as const,
                }
              : {
                  _tag: "Return",
                  value: {
                    _tag: "Failure",
                    failure: ledgerFailure("child_authority_mismatch"),
                  } as const,
                };
          }
          return {
            _tag: "Append",
            draft: {
              type: V2_EVENT,
              lane: ENDSTOP_LANE,
              payload: {
                _tag: "ExecutionChildOutcomeRegistered",
                ...decoded,
              },
            },
            result: () => ({ _tag: "Ok", value: decoded }) as const,
          };
        });
      }).pipe(Effect.provide(journalLayer));
      return withJournalFailure(transaction);
    },
    registerEvaluationVerdict: (registration) => {
      const decoded = evaluationVerdictFromUnknown(registration);
      if (decoded === null) {
        return Effect.fail(ledgerFailure("child_authority_mismatch"));
      }
      const runId = decodeRunId(decoded.rootContractId) as RunId;
      const transaction = Effect.gen(function* () {
        const journal = yield* RunJournal;
        return yield* journal.transact<
          TransactionResult<ExecutionFamilyLedgerStatusV2>
        >(runId, (events) => {
          const history = replayHistory(events, loadManifest);
          if (history._tag !== "Ok") {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure:
                  history._tag === "Missing"
                    ? ledgerFailure("missing_contract")
                    : history.failure,
              } as const,
            };
          }
          if (history.state.root.contractSha256 !== decoded.rootContractSha256) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("contract_mismatch"),
              } as const,
            };
          }
          const family = history.state.family;
          const child = family?.children[decoded.childId];
          if (
            family === null ||
            family === undefined ||
            child === undefined ||
            family.familySha256 !== decoded.familySha256 ||
            Date.parse(decoded.registeredAt) < Date.parse(child.lastEventAt) ||
            evaluationRunSetSha256(family) !== decoded.runSetSha256 ||
            history.state.childAuthorities.every(
              (authority) =>
                authority.childId !== decoded.childId ||
                authority.effectiveAction !== "evaluate" ||
                authority.candidate.candidateSha256 !== decoded.candidateSha256 ||
                authority.evaluationManifestSha256 !==
                  decoded.evaluationAuthorityReceiptSha256,
            )
          ) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("child_authority_mismatch"),
              } as const,
            };
          }
          const existing = history.state.evaluationVerdicts.find(
            (item) => item.childId === decoded.childId,
          );
          if (existing !== undefined) {
            return canonicalize(existing) === canonicalize(decoded)
              ? {
                  _tag: "Return",
                  value: {
                    _tag: "Ok",
                    value: {
                      root: history.state.root,
                      authority: history.state.authority!,
                      family,
                      childAuthorities: history.state.childAuthorities,
                      childOutcomes: history.state.childOutcomes,
                      evaluationVerdicts: history.state.evaluationVerdicts,
                    },
                  } as const,
                }
              : {
                  _tag: "Return",
                  value: {
                    _tag: "Failure",
                    failure: ledgerFailure("child_authority_mismatch"),
                  } as const,
                };
          }
          const verdict = registerExecutionEvaluationVerdictV2({
            state: family,
            childId: decoded.childId,
            verdict: {
              candidateSha256: decoded.candidateSha256,
              result: decoded.result,
              completedRuns: decoded.completedRuns,
              unavailableRuns: decoded.unavailableRuns,
              notRunRuns: decoded.notRunRuns,
              runSetSha256: decoded.runSetSha256,
              verdictSha256: decoded.verdictSha256,
            },
          });
          if (verdict._tag !== "Accepted") {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("child_authority_mismatch"),
              } as const,
            };
          }
          const value: ExecutionFamilyLedgerStatusV2 = {
            root: history.state.root,
            authority: history.state.authority!,
            family: {
              ...verdict.state,
              children: {
                ...verdict.state.children,
                [decoded.childId]: {
                  ...verdict.state.children[decoded.childId]!,
                  lastEventAt: decoded.registeredAt,
                  lastProgressAt: decoded.registeredAt,
                },
              },
            },
            childAuthorities: history.state.childAuthorities,
            childOutcomes: history.state.childOutcomes,
            evaluationVerdicts: [
              ...history.state.evaluationVerdicts,
              decoded,
            ],
          };
          return {
            _tag: "Append",
            draft: {
              type: V2_EVENT,
              lane: ENDSTOP_LANE,
              payload: {
                _tag: "ExecutionEvaluationVerdictRegistered",
                ...decoded,
              },
            },
            result: () => ({ _tag: "Ok", value }) as const,
          };
        });
      }).pipe(Effect.provide(journalLayer));
      return withJournalFailure(transaction);
    },
    executeChild: (input) => {
      const runId = decodeRunId(input.rootContractId);
      const operation = executionV2OperationFromUnknown(input.operation);
      if (
        typeof runId !== "string" ||
        !isSha256Hex(input.rootContractSha256) ||
        !isSha256Hex(input.familySha256) ||
        typeof decodeRunId(input.childId) !== "string" ||
        operation === null ||
        !isUtcSecondTimestamp(input.at)
      ) {
        return Effect.fail(ledgerFailure("family_mismatch"));
      }
      const transaction = Effect.gen(function* () {
        const journal = yield* RunJournal;
        return yield* journal.transact<
          TransactionResult<EndstopChildExecutionResultV2>
        >(runId as RunId, (events) => {
          const history = replayHistory(events, loadManifest);
          if (history._tag !== "Ok") {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure:
                  history._tag === "Missing"
                    ? ledgerFailure("missing_contract")
                    : history.failure,
              } as const,
            };
          }
          if (history.state.root.contractSha256 !== input.rootContractSha256) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("contract_mismatch"),
              } as const,
            };
          }
          const family = history.state.family;
          if (
            family === null ||
            family.familySha256 !== input.familySha256 ||
            family.children[input.childId] === undefined
          ) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("family_missing"),
              } as const,
            };
          }
          if (
            operation._tag === "ReserveAction" &&
            !hasAvailableChildAuthority(
              history.state.childAuthorities,
              family,
              input.childId,
              operation,
              input.at,
            )
          ) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("child_authority_mismatch"),
              } as const,
            };
          }
          const requiredOutcome = operationOutcome(operation);
          if (
            requiredOutcome !== null &&
            !history.state.childOutcomes.some(
              (item) =>
                item.childId === input.childId &&
                item.reservationId === requiredOutcome.reservationId &&
                item.originReservationId ===
                  requiredOutcome.originReservationId &&
                item.candidateSha256 === requiredOutcome.candidateSha256 &&
                item.outcomeSha256 === requiredOutcome.outcomeSha256,
            )
          ) {
            return {
              _tag: "Return",
              value: {
                _tag: "Failure",
                failure: ledgerFailure("child_authority_mismatch"),
              } as const,
            };
          }
          const decision = decideExecutionChildOperationV2({
            state: family,
            childId: input.childId,
            operation,
            at: input.at,
          });
          if (
            decision._tag === "Refused" ||
            decision._tag === "ReusedVerification" ||
            decision.events.length === 0
          ) {
            return {
              _tag: "Return",
              value: {
                _tag: "Ok",
                value: { decision, state: family },
              } as const,
            };
          }
          const state = evolveExecutionFamilyV2(
            family,
            input.childId,
            operation,
            decision,
          );
          return {
            _tag: "Append",
            draft: {
              type: V2_EVENT,
              lane: ENDSTOP_LANE,
              payload: {
                _tag: "EndstopChildDecision",
                familySha256: input.familySha256,
                childId: input.childId,
                operation,
                events: decision.events,
              },
            },
            result: () => ({
              _tag: "Ok",
              value: { decision, state },
            }) as const,
          };
        });
      }).pipe(Effect.provide(journalLayer));
      return withJournalFailure(transaction);
    },
    familyStatus: (input) =>
      Effect.gen(function* () {
        if (
          typeof decodeRunId(input.rootContractId) !== "string" ||
          !isSha256Hex(input.rootContractSha256) ||
          !isSha256Hex(input.familySha256)
        ) {
          return yield* Effect.fail(ledgerFailure("family_mismatch"));
        }
        const history = yield* readHistory(input.rootContractId);
        if (history.root.contractSha256 !== input.rootContractSha256) {
          return yield* Effect.fail(ledgerFailure("contract_mismatch"));
        }
        if (
          history.authority === null ||
          history.family === null ||
          history.authority.familySha256 !== input.familySha256 ||
          history.family.familySha256 !== input.familySha256
        ) {
          return yield* Effect.fail(ledgerFailure("family_missing"));
        }
        return {
          root: history.root,
          authority: history.authority,
          family: history.family,
          childAuthorities: history.childAuthorities,
          childOutcomes: history.childOutcomes,
          evaluationVerdicts: history.evaluationVerdicts,
        };
      }),
  });
}
