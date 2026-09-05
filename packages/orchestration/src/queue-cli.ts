/**
 * CLI argv parse and dispatch for lane-queue.
 */

import { canonicalize, isSha256Hex, sha256Hex } from "@foreman/core";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { Effect } from "effect";
import { decodeRunId } from "@foreman/event-log";
import type { ReleaseActionV1 } from "@foreman/policy";
import {
  cmdAdd,
  cmdEnsure,
  cmdKill,
  cmdStatus,
  EXIT_CONFIG,
  EXIT_OK,
  ADD_USAGE,
} from "./queue-admission.js";
import type {
  BoundedFs,
  EnvVars,
  PathLookup,
  ProcessExec,
  QueueIo,
  Sleeper,
} from "./queue-services.js";
import {
  EndstopLedger,
  makeLiveEndstopLedgerLayer,
} from "./execution-ledger.js";
import {
  executionActionKinds,
  type ExecutionActionKind,
} from "./execution-terminal-policy.js";
import {
  liveReleasePolicyServices,
  parseReleasePolicyArgv,
  releasePolicyBlockArgv,
  runReleasePolicyCli,
  type ReleasePolicyBlockV1,
} from "./release-policy.js";

// Single source of truth for the `add` usage string lives in
// queue-admission.ts (ADD_USAGE) so this copy cannot go stale again.
const USAGE = ADD_USAGE;

export type QueueEndstopAdmission = {
  readonly stateRoot: string;
  readonly contractId: string;
  readonly contractSha256: string;
  readonly action: ReleaseActionV1;
  readonly candidateSha256: string;
};

export type ParsedCommand =
  | { readonly kind: "ensure" }
  | {
      readonly kind: "add";
      readonly group: string;
      readonly endstop: QueueEndstopAdmission;
      readonly version?: "v2";
      readonly release?: ReleasePolicyBlockV1;
      readonly priorReservationId?: string;
      readonly containmentApproval?: string;
      readonly cmd: readonly string[];
    }
  | { readonly kind: "status"; readonly taskId: string | undefined }
  | { readonly kind: "kill"; readonly taskId: string }
  | { readonly kind: "usage"; readonly message: string };

/**
 * Strip node binary and script path from process.argv-style input.
 */
export function stripNodeArgv(argv: readonly string[]): readonly string[] {
  let args = [...argv];
  if (
    args.length > 0 &&
    (args[0]!.endsWith("node") ||
      args[0]!.endsWith("node.exe") ||
      args[0]!.includes("/node") ||
      args[0]!.includes("\\node"))
  ) {
    args = args.slice(1);
  }
  if (
    args.length > 0 &&
    (args[0]!.endsWith(".js") ||
      args[0]!.endsWith(".ts") ||
      args[0]!.includes("lane-queue"))
  ) {
    args = args.slice(1);
  }
  return args;
}

export function parseQueueArgv(argv: readonly string[]): ParsedCommand {
  const args = [...stripNodeArgv(argv)];
  if (args.length === 0) {
    return { kind: "usage", message: USAGE };
  }
  const sub = args[0]!;
  switch (sub) {
    case "ensure":
      return { kind: "ensure" };
    case "add": {
      let containmentApproval: string | undefined;
      const separatorIndex = args.indexOf("--", 2);
      const releaseEnd = separatorIndex === -1 ? args.length : separatorIndex;
      const approvalIndexes: number[] = [];
      for (let i = 2; i < releaseEnd; i += 1) {
        if (args[i] === "--containment-approval") approvalIndexes.push(i);
      }
      if (approvalIndexes.length > 1) {
        return {
          kind: "usage",
          message: "lane-queue: --containment-approval must appear at most once",
        };
      }
      if (approvalIndexes.length === 1) {
        const approvalIndex = approvalIndexes[0]!;
        const reason = args[approvalIndex + 1];
        if (reason === undefined || approvalIndex + 1 >= releaseEnd) {
          return {
            kind: "usage",
            message: "lane-queue: --containment-approval requires a reason",
          };
        }
        if (reason.length === 0) {
          return {
            kind: "usage",
            message: "lane-queue: --containment-approval reason must be non-empty",
          };
        }
        if (reason.length > 200) {
          return {
            kind: "usage",
            message: "lane-queue: --containment-approval reason must be at most 200 characters",
          };
        }
        if (/[\x00-\x1f\x7f]/.test(reason)) {
          return {
            kind: "usage",
            message: "lane-queue: --containment-approval reason must not contain control characters",
          };
        }
        containmentApproval = reason;
        args.splice(approvalIndex, 2);
      }
      const group = args[1];
      if (group !== undefined) {
        const hasPrior = args[2] === "--endstop-prior-reservation-id";
        const priorReservationId = hasPrior ? args[3] : undefined;
        const blockStart = hasPrior ? 4 : 2;
        const separator = blockStart + 28;
        if (
          (!hasPrior ||
            (typeof priorReservationId === "string" &&
              typeof decodeRunId(priorReservationId) === "string")) &&
          args[separator] === "--"
        ) {
          const release = parseReleasePolicyArgv([
            "check",
            ...args.slice(blockStart, separator),
          ]);
          const cmd = args.slice(separator + 1);
          if (release._tag === "Check" && cmd.length > 0) {
            return {
              kind: "add",
              group,
              version: "v2",
              release: release.block,
              endstop: {
                stateRoot: release.block.stateRoot,
                contractId: release.block.contractId,
                contractSha256: release.block.contractSha256,
                action: release.block.action,
                candidateSha256: release.block.candidateSha256,
              },
              ...(priorReservationId === undefined
                ? {}
                : { priorReservationId }),
              ...(containmentApproval === undefined
                ? {}
                : { containmentApproval }),
              cmd,
            };
          }
        }
      }
      const stateRoot = args[3];
      const contractId = args[5];
      const contractSha256 = args[7];
      const action = args[9];
      const candidateSha256 = args[11];
      const valid =
        group !== undefined &&
        args[2] === "--endstop-state-root" &&
        typeof stateRoot === "string" &&
        isAbsolute(stateRoot) &&
        args[4] === "--endstop-contract-id" &&
        typeof contractId === "string" &&
        contractId.length > 0 &&
        args[6] === "--endstop-contract-sha" &&
        typeof contractSha256 === "string" &&
        isSha256Hex(contractSha256) &&
        args[8] === "--endstop-action" &&
        typeof action === "string" &&
        executionActionKinds.includes(action as ExecutionActionKind) &&
        args[10] === "--endstop-candidate-sha" &&
        typeof candidateSha256 === "string" &&
        isSha256Hex(candidateSha256) &&
        args[12] === "--";
      const cmd = args.slice(13);
      if (!valid || cmd.length === 0) {
        return { kind: "usage", message: USAGE };
      }
      return {
        kind: "add",
        group,
        endstop: {
          stateRoot,
          contractId,
          contractSha256,
          action: action as ExecutionActionKind,
          candidateSha256,
        },
        ...(containmentApproval === undefined
          ? {}
          : { containmentApproval }),
        cmd,
      };
    }
    case "status":
      return { kind: "status", taskId: args[1] };
    case "kill": {
      const taskId = args[1];
      if (taskId === undefined || taskId.length === 0) {
        return { kind: "usage", message: "usage: lane-queue.sh kill TASK_ID" };
      }
      return { kind: "kill", taskId };
    }
    default:
      return { kind: "usage", message: USAGE };
  }
}

export type QueueServices = ProcessExec | Sleeper | PathLookup | BoundedFs | EnvVars;

export type QueueEndstopOptions = {
  readonly now?: () => Date;
  readonly reservationId?: () => string;
  readonly releasePolicy?: (
    block: ReleasePolicyBlockV1,
  ) => Effect.Effect<boolean, unknown>;
};

function utcSecond(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

const cmdAddGuarded = (
  io: QueueIo,
  parsed: Extract<ParsedCommand, { readonly kind: "add" }>,
  options: QueueEndstopOptions,
): Effect.Effect<number, never, QueueServices> => {
  const layer = makeLiveEndstopLedgerLayer(parsed.endstop.stateRoot);
  if (parsed.version === "v2" && parsed.release !== undefined) {
    const checkPolicy = options.releasePolicy ?? ((block) => {
      let stdout = "";
      let stderr = "";
      return runReleasePolicyCli(
        ["check", ...releasePolicyBlockArgv(block)],
        {
          writeStdout: (text) => { stdout += text; },
          writeStderr: (text) => { stderr += text; },
        },
        liveReleasePolicyServices,
      ).pipe(
        Effect.map((code) =>
          code === 0 &&
          stderr === "" &&
          stdout === '{"_tag":"Admitted","schemaVersion":1}\n',
        ),
      );
    });
    const reserveV2 = Effect.gen(function* () {
      const admitted = yield* checkPolicy(parsed.release!);
      if (!admitted) {
        return yield* Effect.fail(new Error("release_policy_refused"));
      }
      const ledger = yield* EndstopLedger;
      const status = yield* ledger.familyStatus({
        rootContractId: parsed.release!.contractId,
        rootContractSha256: parsed.release!.contractSha256,
        familySha256: parsed.release!.familySha256,
      });
      const child = status.family.children[parsed.release!.childId];
      if (child === undefined) {
        return yield* Effect.fail(new Error("unknown_child"));
      }
      const authority = status.childAuthorities.find((item) =>
        item.childId === parsed.release!.childId &&
        item.action === parsed.release!.action &&
        item.candidate.candidateSha256 === parsed.release!.candidateSha256 &&
        (parsed.release!.action === "provider_retry" ||
          parsed.release!.action === "resume"
          ? item.priorReservationId === parsed.priorReservationId
          : item.priorReservationId === null &&
            parsed.priorReservationId === undefined)
      );
      if (authority === undefined) {
        return yield* Effect.fail(new Error("missing_authority"));
      }
      const reservationId = (options.reservationId ?? randomUUID)();
      const originReservationId = authority.originReservationId ?? reservationId;
      return yield* ledger.executeChild({
        rootContractId: parsed.release!.contractId,
        rootContractSha256: parsed.release!.contractSha256,
        familySha256: parsed.release!.familySha256,
        childId: parsed.release!.childId,
        operation: {
          _tag: "ReserveAction",
          reservationId,
          reservationAction: authority.action,
          effectiveAction: authority.effectiveAction,
          originReservationId,
          candidate: authority.candidate,
          taskPlanSha256: authority.taskPlanSha256,
          authorityBundleSha256: authority.bundleSha256,
        },
        at: utcSecond((options.now ?? (() => new Date()))()),
      });
    }).pipe(Effect.provide(layer));
    return reserveV2.pipe(
      Effect.matchEffect({
        onFailure: () => Effect.sync(() => {
          io.writeStderr("Foreman release policy refused queue admission\n");
          return EXIT_CONFIG;
        }),
        onSuccess: (result) => {
          if (result.decision._tag !== "Accepted") {
            return Effect.sync(() => {
              io.writeStderr("Foreman Endstop refused child reservation\n");
              return EXIT_CONFIG;
            });
          }
          return cmdAdd(
            io,
            parsed.group,
            parsed.cmd,
            parsed.containmentApproval,
          );
        },
      }),
    );
  }
  const reserve = Effect.gen(function* () {
    const ledger = yield* EndstopLedger;
    return yield* ledger.execute(
      parsed.endstop.contractId,
      parsed.endstop.contractSha256,
      {
        _tag: "ReserveAction",
        action: parsed.endstop.action as ExecutionActionKind,
        candidateSha256: parsed.endstop.candidateSha256,
        commandSha256: sha256Hex(canonicalize(parsed.cmd)),
        reservationId: (options.reservationId ?? randomUUID)(),
        at: utcSecond((options.now ?? (() => new Date()))()),
      },
    );
  }).pipe(Effect.provide(layer));

  return reserve.pipe(
    Effect.matchEffect({
      onFailure: () =>
        Effect.sync(() => {
          io.writeStderr("Foreman Endstop refused queue admission (ledger failure)\n");
          return EXIT_CONFIG;
        }),
      onSuccess: (result) => {
        if (result.decision._tag !== "Accepted") {
          return Effect.sync(() => {
            io.writeStderr(
              `Foreman Endstop refused queue admission (${result.state._tag})\n`,
            );
            return EXIT_CONFIG;
          });
        }
        return cmdAdd(
          io,
          parsed.group,
          parsed.cmd,
          parsed.containmentApproval,
        );
      },
    }),
  );
};

/**
 * Run the queue CLI. Returns process exit code.
 */
export const runQueueCli = (
  argv: readonly string[],
  io: QueueIo,
  endstopOptions: QueueEndstopOptions = {},
): Effect.Effect<number, never, QueueServices> =>
  Effect.gen(function* () {
    const parsed = parseQueueArgv(argv);
    switch (parsed.kind) {
      case "usage":
        io.writeStderr(parsed.message + "\n");
        return EXIT_CONFIG;
      case "ensure":
        return yield* cmdEnsure(io);
      case "add":
        return yield* cmdAddGuarded(io, parsed, endstopOptions);
      case "status":
        return yield* cmdStatus(io, parsed.taskId);
      case "kill":
        return yield* cmdKill(io, parsed.taskId);
      default: {
        const _exhaustive: never = parsed;
        void _exhaustive;
        return EXIT_CONFIG;
      }
    }
  });

export { EXIT_OK, EXIT_CONFIG };
