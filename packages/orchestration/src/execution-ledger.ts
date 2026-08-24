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
import { canonicalize, isSha256Hex } from "@foreman/core";
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
  initialExecutionFamilyStateV2,
  evolveExecution,
  executionActionKinds,
  initialExecutionState,
  isExecutionTerminal,
  type ExecutionActionKind,
  type ExecutionCommand,
  type ExecutionDecision,
  type ExecutionEvent,
  type ExecutionFamilyStateV2,
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
  }
>() {}

type ReplayedHistoryV2 = {
  readonly root: ExecutionState;
  readonly authority: ExecutionFamilyAuthorityStateV1 | null;
  readonly family: ExecutionFamilyStateV2 | null;
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

type FamilyJournalPayloadV2 =
  | ({ readonly _tag: "ExecutionFamilyAuthorityRegistered" } &
      ExecutionFamilyAuthorityStateV1)
  | (Omit<ExecutionFamilyActivationV1, "rootContractId" | "rootContractSha256"> & {
      readonly _tag: "EndstopFamilyActivated";
    });

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
  return null;
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
  }
  return { _tag: "Ok", state: { root, authority, family } };
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
        };
      }),
  });
}
