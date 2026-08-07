import { isSha256Hex } from "@foreman/core";
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
  executionContractSha256,
  isExecutionContractFailure,
  type ExecutionContractV1,
  type ExecutionMilestone,
} from "./execution-contract.js";
import {
  decideExecutionCommand,
  evolveExecution,
  executionActionKinds,
  initialExecutionState,
  isExecutionTerminal,
  type ExecutionActionKind,
  type ExecutionCommand,
  type ExecutionDecision,
  type ExecutionEvent,
  type ExecutionState,
  type ExecutionTerminalTag,
} from "./execution-terminal-policy.js";

const ENDSTOP_LANE = "endstop";
const CONTRACT_EVENT = "endstop_contract";
const DECISION_EVENT = "endstop_decision";

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
  }
>() {}

type HistoryResult =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Ok"; readonly state: ExecutionState }
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

function replayHistory(events: readonly StoredEvent[]): HistoryResult {
  const relevant = events.filter(
    (event) => event.type === CONTRACT_EVENT || event.type === DECISION_EVENT,
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

  let state: ExecutionState = initialExecutionState(decoded);
  for (const stored of relevant.slice(1)) {
    if (
      stored.type !== DECISION_EVENT ||
      stored.lane !== ENDSTOP_LANE ||
      !exactKeys(stored.payload as Record<string, unknown>, [
        "contractSha256",
        "events",
      ]) ||
      stored.payload.contractSha256 !== hash ||
      !Array.isArray(stored.payload.events) ||
      stored.payload.events.length === 0 ||
      isExecutionTerminal(state)
    ) {
      return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
    }
    for (const raw of stored.payload.events) {
      const event = executionEventFromUnknown(raw);
      if (
        event === null ||
        Date.parse(event.at) < Date.parse(state.lastEventAt) ||
        (event._tag === "ProductChanged" &&
          event.allowedPathsSha256 !== state.contract.allowedPathsSha256)
      ) {
        return { _tag: "Failure", failure: ledgerFailure("corrupt_history") };
      }
      state = evolveExecution(state, event);
    }
  }
  return { _tag: "Ok", state };
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

export function makeLiveEndstopLedgerLayer(
  stateRoot: string,
): Layer.Layer<EndstopLedger> {
  const journalLayer = makeLiveRunJournalLayer(stateRoot);
  const readState = (
    contractId: string,
  ): Effect.Effect<ExecutionState, EndstopLedgerFailure> => {
    const runId = decodeRunId(contractId);
    if (typeof runId !== "string") {
      return Effect.fail(ledgerFailure("invalid_contract_id"));
    }
    const transaction = Effect.gen(function* () {
      const journal = yield* RunJournal;
      return yield* journal.transact<TransactionResult<ExecutionState>>(
        runId as RunId,
        (events) => {
          const history = replayHistory(events);
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
          const history = replayHistory(events);
          if (history._tag === "Failure") {
            return { _tag: "Return", value: history };
          }
          if (history._tag === "Ok") {
            return history.state.contractSha256 === contractSha256
              ? { _tag: "Return", value: { _tag: "Ok", value: history.state } as const }
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
          const history = replayHistory(events);
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
          if (history.state.contractSha256 !== expectedContractSha256) {
            return {
              _tag: "Return",
              value: { _tag: "Failure", failure: ledgerFailure("contract_mismatch") } as const,
            };
          }
          const decision = decideExecutionCommand(history.state, command);
          if (
            decision._tag === "Refused" ||
            decision._tag === "ReusedVerification" ||
            decision.events.length === 0
          ) {
            return {
              _tag: "Return",
              value: {
                _tag: "Ok",
                value: { decision, state: history.state },
              } as const,
            };
          }
          const nextState = decision.events.reduce(evolveExecution, history.state);
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
        const current = yield* readState(contractId);
        if (current.contractSha256 !== expectedContractSha256) {
          return yield* Effect.fail(ledgerFailure("contract_mismatch"));
        }
        for (const dependencyId of current.contract.dependencyContractIds) {
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
  });
}
