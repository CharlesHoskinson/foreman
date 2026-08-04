/**
 * CLI argv parse and dispatch for lane-queue.
 */

import { Effect } from "effect";
import {
  cmdAdd,
  cmdEnsure,
  cmdKill,
  cmdStatus,
  EXIT_CONFIG,
  EXIT_OK,
} from "./queue-admission.js";
import type {
  BoundedFs,
  EnvVars,
  PathLookup,
  ProcessExec,
  QueueIo,
  Sleeper,
} from "./queue-services.js";

const USAGE =
  "usage: lane-queue.sh ensure|add GROUP -- CMD [ARGS...]|status [TASK_ID]|kill TASK_ID";

export type ParsedCommand =
  | { readonly kind: "ensure" }
  | { readonly kind: "add"; readonly group: string; readonly cmd: readonly string[] }
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
  const args = stripNodeArgv(argv);
  if (args.length === 0) {
    return { kind: "usage", message: USAGE };
  }
  const sub = args[0]!;
  switch (sub) {
    case "ensure":
      return { kind: "ensure" };
    case "add": {
      const group = args[1];
      const dash = args[2];
      if (group === undefined || dash !== "--") {
        return {
          kind: "usage",
          message: "usage: lane-queue.sh add GROUP -- CMD [ARGS...]",
        };
      }
      const cmd = args.slice(3);
      if (cmd.length === 0) {
        return {
          kind: "usage",
          message: "usage: lane-queue.sh add GROUP -- CMD [ARGS...]",
        };
      }
      return { kind: "add", group, cmd };
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

/**
 * Run the queue CLI. Returns process exit code.
 */
export const runQueueCli = (
  argv: readonly string[],
  io: QueueIo,
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
        return yield* cmdAdd(io, parsed.group, parsed.cmd);
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
