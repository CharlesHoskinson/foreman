import {
  canonicalize,
  isCoreFailure,
  parseJsonRejectDuplicateKeys,
} from "@foreman/core";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Effect } from "effect";
import {
  decodeExecutionContractV1,
  isExecutionContractFailure,
} from "./execution-contract.js";
import {
  EndstopLedger,
  isEndstopLedgerFailure,
  makeLiveEndstopLedgerLayer,
} from "./execution-ledger.js";
import type { ExecutionState } from "./execution-terminal-policy.js";

export const ENDSTOP_EXIT_OK = 0;
export const ENDSTOP_EXIT_FAIL = 1;
export const ENDSTOP_EXIT_CONFIG = 2;

export type EndstopCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type ParsedEndstopArgv =
  | {
      readonly _tag: "Create";
      readonly stateRoot: string;
      readonly contractFile: string;
    }
  | {
      readonly _tag: "Status";
      readonly stateRoot: string;
      readonly contractId: string;
    }
  | { readonly _tag: "Invalid" };

function stripNodeArgv(argv: readonly string[]): readonly string[] {
  let args = [...argv];
  if (args[0]?.match(/(?:^|[\\/])node(?:\.exe)?$/u)) args = args.slice(1);
  if (args[0]?.includes("execution-guard")) args = args.slice(1);
  return args;
}

export function parseEndstopArgv(argv: readonly string[]): ParsedEndstopArgv {
  const args = stripNodeArgv(argv);
  if (
    args.length === 5 &&
    args[0] === "create" &&
    args[1] === "--state-root" &&
    args[3] === "--contract-file" &&
    typeof args[2] === "string" &&
    isAbsolute(args[2]) &&
    typeof args[4] === "string" &&
    isAbsolute(args[4])
  ) {
    return { _tag: "Create", stateRoot: args[2], contractFile: args[4] };
  }
  if (
    args.length === 5 &&
    args[0] === "status" &&
    args[1] === "--state-root" &&
    args[3] === "--contract-id" &&
    typeof args[2] === "string" &&
    isAbsolute(args[2]) &&
    typeof args[4] === "string" &&
    args[4].length > 0
  ) {
    return { _tag: "Status", stateRoot: args[2], contractId: args[4] };
  }
  return { _tag: "Invalid" };
}

function publicSnapshot(state: ExecutionState): Record<string, unknown> {
  return {
    contractId: state.contract.contractId,
    contractSha256: state.contractSha256,
    counts: state.counts,
    state: state._tag,
    ...(state._tag === "Running"
      ? {}
      : { terminalAt: state.terminalAt, terminalReason: state.terminalReason }),
  };
}

function emitFailure(io: EndstopCliIo, reason: string): number {
  io.writeStderr(`Foreman Endstop: ${reason}\n`);
  return ENDSTOP_EXIT_FAIL;
}

export function runEndstopCli(
  argv: readonly string[],
  io: EndstopCliIo,
): Effect.Effect<number> {
  const parsed = parseEndstopArgv(argv);
  if (parsed._tag === "Invalid") {
    io.writeStderr("Foreman Endstop: invalid arguments\n");
    return Effect.succeed(ENDSTOP_EXIT_CONFIG);
  }

  const layer = makeLiveEndstopLedgerLayer(parsed.stateRoot);
  const program = Effect.gen(function* () {
    const ledger = yield* EndstopLedger;
    if (parsed._tag === "Status") {
      return yield* ledger.status(parsed.contractId);
    }

    const text = yield* Effect.try({
      try: () => readFileSync(parsed.contractFile, "utf8"),
      catch: () => new Error("contract_read_failed"),
    });
    const raw = parseJsonRejectDuplicateKeys(text);
    if (isCoreFailure(raw)) {
      return yield* Effect.fail(new Error("invalid_contract"));
    }
    const contract = decodeExecutionContractV1(raw);
    if (isExecutionContractFailure(contract)) {
      return yield* Effect.fail(new Error("invalid_contract"));
    }
    return yield* ledger.create(contract);
  }).pipe(Effect.provide(layer));

  return program.pipe(
    Effect.match({
      onFailure: (error) => {
        if (isEndstopLedgerFailure(error)) return emitFailure(io, error.reason);
        const reason = error instanceof Error && error.message === "invalid_contract"
          ? "invalid_contract"
          : "contract_read_failed";
        return emitFailure(io, reason);
      },
      onSuccess: (state) => {
        io.writeStdout(canonicalize(publicSnapshot(state)) + "\n");
        return ENDSTOP_EXIT_OK;
      },
    }),
  );
}
