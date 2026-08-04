/**
 * lane-round CLI: fixed-order parse, path preflight, live R2 transaction.
 * Sprint 3 R3.
 */

import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Effect } from "effect";
import { canonicalize } from "@foreman/core";
import {
  decodeLaneId,
  decodeRunId,
  isAttemptFailure,
  type LaneId,
  type RunId,
} from "@foreman/event-log";
import {
  decodeRoundRequestV1,
  isRoundContractFailure,
  type RoundOutcomeV1,
  type RoundRequestV1,
} from "./round-contract.js";
import {
  makeLiveRoundServices,
  type LiveRoundContext,
} from "./round-live-services.js";
import {
  RoundBoundaryFailure,
  runRoundTransaction,
} from "./round-transaction.js";

export const EXIT_COMPLETED = 0;
export const EXIT_INCOMPLETE_OR_DEFECT = 1;
export const EXIT_INVALID_ARGUMENTS = 2;
export const EXIT_BOUNDARY_FAILURE = 3;

export const MSG_INVALID_ARGUMENTS = "lane-round: invalid arguments";
export const MSG_BOUNDARY_FAILURE = "lane-round: boundary failure";
export const MSG_INTERNAL_FAILURE = "lane-round: internal failure";

export type RoundCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type ParsedRoundArgv =
  | {
      readonly _tag: "Ok";
      readonly stateRoot: string;
      readonly worktree: string;
      readonly run: string;
      readonly lane: string;
      readonly report: string;
      readonly gate: string;
      readonly commandArgv: readonly string[];
    }
  | { readonly _tag: "Invalid" };

export type RoundPreflightResult =
  | {
      readonly _tag: "Ok";
      readonly stateRoot: string;
      readonly worktree: string;
      readonly runId: RunId;
      readonly laneId: LaneId;
      readonly reportPath: string;
      readonly gateCommand: string;
      readonly commandArgv: readonly string[];
      readonly request: RoundRequestV1;
    }
  | { readonly _tag: "Invalid" };

/**
 * Strip node binary and script path from process.argv-style input.
 */
export function stripRoundNodeArgv(
  argv: readonly string[],
): readonly string[] {
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
      args[0]!.includes("lane-round") ||
      args[0]!.includes("round-main") ||
      args[0]!.includes("round-cli"))
  ) {
    args = args.slice(1);
  }
  return args;
}

const OPTIONS = [
  "--state-root",
  "--worktree",
  "--run",
  "--lane",
  "--report",
  "--gate",
] as const;

/**
 * Pure fixed-order argv parse. Preserves command vector entries including
 * later empty strings. Rejects duplicates, unknowns, missing values, missing
 * `--`, empty command, and trailing grammar violations.
 */
export function parseRoundArgv(argv: readonly string[]): ParsedRoundArgv {
  const args = stripRoundNodeArgv(argv);
  let i = 0;
  const values: string[] = [];

  for (const opt of OPTIONS) {
    if (i >= args.length || args[i] !== opt) {
      return { _tag: "Invalid" };
    }
    i += 1;
    if (i >= args.length) {
      return { _tag: "Invalid" };
    }
    const v = args[i]!;
    // Option values must be present; empty string for path options is invalid
    // for state-root/worktree/report but run/lane/gate empty also fails later.
    // Grammar: missing option value — empty is a value (preserved). Reject
    // only when the next token is another option or `--` without a value slot.
    // Spec: "reject a missing option value" — no token after flag.
    // An empty string token is a present (empty) value.
    values.push(v);
    i += 1;
  }

  if (i >= args.length || args[i] !== "--") {
    return { _tag: "Invalid" };
  }
  i += 1;
  const commandArgv = args.slice(i);
  if (commandArgv.length === 0) {
    return { _tag: "Invalid" };
  }

  // Reject unknown options before `--` already handled by fixed order.
  // Reject duplicate options: fixed order with exact match cannot see
  // duplicates of the six named options unless one appears as a value.
  // Unknown option where a named option is required → Invalid above.

  // Reject if any option value is itself a reused flag in wrong place —
  // not required. Trailing data is part of command after `--`.

  return {
    _tag: "Ok",
    stateRoot: values[0]!,
    worktree: values[1]!,
    run: values[2]!,
    lane: values[3]!,
    report: values[4]!,
    gate: values[5]!,
    commandArgv,
  };
}

/**
 * Segment-aware test: is `candidate` equal to `root` or a descendant of it?
 * Uses path.relative; rejects when relative is empty, `..`, or starts with
 * `..` + separator. Never uses string-prefix containment.
 */
export function isEqualOrDescendant(
  candidate: string,
  root: string,
): boolean {
  if (candidate === root) return true;
  const rel = relative(root, candidate);
  if (rel === "") return true;
  if (rel === "..") return false;
  if (rel.startsWith(".." + sep)) return false;
  // On Windows, relative may use backslash; also check posix form.
  if (rel.startsWith("../")) return false;
  // If relative is absolute, paths are on different roots.
  if (isAbsolute(rel)) return false;
  return true;
}

function resolveExistingDir(path: string): string | null {
  if (typeof path !== "string" || path.length === 0) return null;
  if (!isAbsolute(path)) return null;
  if (path.includes("\0")) return null;
  try {
    const st = statSync(path);
    if (!st.isDirectory()) return null;
    return realpathSync(path);
  } catch {
    return null;
  }
}

function resolveAbsolutePath(path: string): string | null {
  if (typeof path !== "string" || path.length === 0) return null;
  if (!isAbsolute(path)) return null;
  if (path.includes("\0")) return null;
  try {
    // Report may not exist yet — resolve parent if needed via path.resolve
    // of the absolute path (already absolute).
    return resolve(path);
  } catch {
    return null;
  }
}

/**
 * Decode identifiers, resolve paths, enforce state-root separation, and
 * admit RoundRequestV1. Performs no run-state writes.
 */
export function preflightRoundParsed(
  parsed: Extract<ParsedRoundArgv, { _tag: "Ok" }>,
): RoundPreflightResult {
  const runId = decodeRunId(parsed.run);
  if (isAttemptFailure(runId)) return { _tag: "Invalid" };
  const laneId = decodeLaneId(parsed.lane);
  if (isAttemptFailure(laneId)) return { _tag: "Invalid" };

  const stateRoot = resolveExistingDir(parsed.stateRoot);
  if (stateRoot === null) return { _tag: "Invalid" };
  const worktree = resolveExistingDir(parsed.worktree);
  if (worktree === null) return { _tag: "Invalid" };

  // Reject ROOT when equal to WORKTREE or below WORKTREE.
  if (isEqualOrDescendant(stateRoot, worktree)) {
    return { _tag: "Invalid" };
  }

  const reportPath = resolveAbsolutePath(parsed.report);
  if (reportPath === null) return { _tag: "Invalid" };

  if (typeof parsed.gate !== "string") return { _tag: "Invalid" };

  const requestCandidate: RoundRequestV1 = {
    runId,
    laneId,
    commandArgv: parsed.commandArgv,
    gateCommand: parsed.gate,
    reportPath,
  };
  const request = decodeRoundRequestV1(requestCandidate);
  if (isRoundContractFailure(request)) return { _tag: "Invalid" };

  return {
    _tag: "Ok",
    stateRoot,
    worktree,
    runId: request.runId,
    laneId: request.laneId,
    reportPath: request.reportPath,
    gateCommand: request.gateCommand,
    commandArgv: request.commandArgv,
    request,
  };
}

export type RoundCliEnv = {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly comSpec?: string;
  /**
   * Optional injectable live-layer factory for tests. Defaults to
   * makeLiveRoundServices.
   */
  readonly makeServices?: (
    ctx: LiveRoundContext,
  ) => ReturnType<typeof makeLiveRoundServices>;
};

/**
 * Run the lane-round CLI once. Returns process exit code.
 * Injectable io and env seams for tests.
 */
export function runRoundCli(
  argv: readonly string[],
  io: RoundCliIo,
  cliEnv: RoundCliEnv = {},
): Effect.Effect<number> {
  return Effect.gen(function* () {
    const parsed = parseRoundArgv(argv);
    if (parsed._tag === "Invalid") {
      io.writeStderr(MSG_INVALID_ARGUMENTS + "\n");
      return EXIT_INVALID_ARGUMENTS;
    }
    const pre = preflightRoundParsed(parsed);
    if (pre._tag === "Invalid") {
      io.writeStderr(MSG_INVALID_ARGUMENTS + "\n");
      return EXIT_INVALID_ARGUMENTS;
    }

    const ctx: LiveRoundContext = {
      stateRoot: pre.stateRoot,
      worktree: pre.worktree,
      runId: pre.runId,
      ...(cliEnv.env !== undefined ? { env: cliEnv.env } : {}),
      ...(cliEnv.platform !== undefined ? { platform: cliEnv.platform } : {}),
      ...(cliEnv.comSpec !== undefined ? { comSpec: cliEnv.comSpec } : {}),
    };

    const makeServices = cliEnv.makeServices ?? makeLiveRoundServices;
    const layer = makeServices(ctx);

    const outcome = yield* runRoundTransaction(pre.request).pipe(
      Effect.provide(layer),
      Effect.either,
    );

    if (outcome._tag === "Left") {
      const err = outcome.left;
      if (err instanceof RoundBoundaryFailure) {
        io.writeStderr(MSG_BOUNDARY_FAILURE + "\n");
        return EXIT_BOUNDARY_FAILURE;
      }
      io.writeStderr(MSG_INTERNAL_FAILURE + "\n");
      return EXIT_INCOMPLETE_OR_DEFECT;
    }

    const result: RoundOutcomeV1 = outcome.right;
    // Exactly one final canonical JSON outcome plus LF on stdout.
    let line: string;
    try {
      line = canonicalize(result as unknown);
    } catch {
      io.writeStderr(MSG_INTERNAL_FAILURE + "\n");
      return EXIT_INCOMPLETE_OR_DEFECT;
    }
    io.writeStdout(line + "\n");

    if (result._tag === "completed") {
      return EXIT_COMPLETED;
    }
    return EXIT_INCOMPLETE_OR_DEFECT;
  }).pipe(
    Effect.catchAllDefect(() =>
      Effect.sync(() => {
        io.writeStderr(MSG_INTERNAL_FAILURE + "\n");
        return EXIT_INCOMPLETE_OR_DEFECT;
      }),
    ),
  );
}
