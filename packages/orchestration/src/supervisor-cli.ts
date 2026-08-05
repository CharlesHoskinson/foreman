/**
 * lane-supervise CLI: exact grammar
 *   lane-supervise.js --state-root ROOT [--dry-run] (--once RUN | --all)
 *
 * Public exit classes: 0, 1, 2.
 */

import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Effect } from "effect";
import { decodeRunId } from "@foreman/event-log";
import {
  formatRunResultLines,
  runSupervisor,
  type SupervisorConfig,
  type SupervisorRunResultV1,
} from "./supervisor.js";
import {
  defaultSupervisorPaths,
  makeLiveSupervisorServices,
} from "./supervisor-live-services.js";

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_CONFIG = 2;

export const MSG_INVALID_ARGUMENTS = "lane-supervise: invalid arguments";
export const MSG_INTERNAL_FAILURE = "lane-supervise: internal failure";

export const USAGE =
  "Usage: lane-supervise.js --state-root ROOT [--dry-run] (--once RUN | --all)";

export type SupervisorCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type SupervisorModeArgv =
  | { readonly _tag: "Once"; readonly runId: string }
  | { readonly _tag: "All" };

export type ParsedSupervisorArgv =
  | {
      readonly _tag: "Ok";
      readonly stateRoot: string;
      readonly dryRun: boolean;
      readonly mode: SupervisorModeArgv;
    }
  | { readonly _tag: "Invalid" };

/**
 * Strip node binary and script path from process.argv-style input.
 */
export function stripSupervisorNodeArgv(
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
      args[0]!.includes("lane-supervise") ||
      args[0]!.includes("supervisor-main") ||
      args[0]!.includes("supervisor-cli"))
  ) {
    args = args.slice(1);
  }
  return args;
}

/**
 * Pure argv parse for the fixed supervisor grammar.
 */
export function parseSupervisorArgv(
  argv: readonly string[],
): ParsedSupervisorArgv {
  const args = stripSupervisorNodeArgv(argv);
  let i = 0;
  let stateRoot: string | null = null;
  let dryRun = false;
  let mode: SupervisorModeArgv | null = null;

  while (i < args.length) {
    const tok = args[i]!;
    if (tok === "--dry-run") {
      if (dryRun) return { _tag: "Invalid" };
      dryRun = true;
      i += 1;
      continue;
    }
    if (tok === "--state-root") {
      if (stateRoot !== null) return { _tag: "Invalid" };
      i += 1;
      if (i >= args.length) return { _tag: "Invalid" };
      stateRoot = args[i]!;
      i += 1;
      continue;
    }
    if (tok === "--once") {
      if (mode !== null) return { _tag: "Invalid" };
      i += 1;
      if (i >= args.length) return { _tag: "Invalid" };
      const runId = args[i]!;
      if (runId.length === 0) return { _tag: "Invalid" };
      mode = { _tag: "Once", runId };
      i += 1;
      continue;
    }
    if (tok === "--all") {
      if (mode !== null) return { _tag: "Invalid" };
      mode = { _tag: "All" };
      i += 1;
      continue;
    }
    return { _tag: "Invalid" };
  }

  if (stateRoot === null || mode === null) {
    return { _tag: "Invalid" };
  }
  // --once run id charset (legacy + typed)
  if (mode._tag === "Once") {
    const decoded = decodeRunId(mode.runId);
    if (typeof decoded !== "string") return { _tag: "Invalid" };
  }

  return {
    _tag: "Ok",
    stateRoot,
    dryRun,
    mode,
  };
}

function resolveStateRoot(path: string): string | null {
  if (typeof path !== "string" || path.length === 0) return null;
  if (!isAbsolute(path) || path.includes("\0")) return null;
  try {
    const st = statSync(path);
    if (!st.isDirectory()) return null;
    return realpathSync(path);
  } catch {
    return null;
  }
}

function resumeMaxAttemptsFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env["RESUME_MAX_ATTEMPTS"];
  if (raw === undefined || raw === "") return 2;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > 100) return 2;
  return n;
}

export type SupervisorCliEnv = {
  readonly env?: NodeJS.ProcessEnv;
  readonly skillRoot?: string;
  readonly shellBinary?: string;
  readonly laneRunScript?: string;
  /**
   * Optional test injection: provide SupervisorServices instead of live.
   * When set, stateRoot still must resolve on disk, but live layers are not
   * composed.
   */
  readonly provideServices?: (
    effect: Effect.Effect<
      readonly import("./supervisor.js").SupervisorRunResultV1[],
      never,
      import("./supervisor.js").SupervisorServices
    >,
  ) => Effect.Effect<
    readonly import("./supervisor.js").SupervisorRunResultV1[]
  >;
};

/**
 * Run the supervisor CLI. Sets no process.exit; returns exit class 0/1/2.
 */
export function runSupervisorCli(
  argv: readonly string[],
  io: SupervisorCliIo,
  cliEnv: SupervisorCliEnv = {},
): Effect.Effect<number> {
  return Effect.gen(function* () {
    const parsed = parseSupervisorArgv(argv);
    if (parsed._tag === "Invalid") {
      io.writeStderr(USAGE + "\n");
      return EXIT_CONFIG;
    }

    const stateRoot = resolveStateRoot(parsed.stateRoot);
    if (stateRoot === null) {
      io.writeStderr(MSG_INVALID_ARGUMENTS + "\n");
      return EXIT_CONFIG;
    }

    const env = cliEnv.env ?? process.env;
    const skillRoot = cliEnv.skillRoot ?? stateRoot;
    const defaults = defaultSupervisorPaths(skillRoot);
    const config: SupervisorConfig = {
      resumeMaxAttempts: resumeMaxAttemptsFromEnv(env),
      shellBinary: cliEnv.shellBinary ?? defaults.shellBinary,
      laneRunScript: cliEnv.laneRunScript ?? defaults.laneRunScript,
      dryRun: parsed.dryRun,
    };

    const baseProgram = runSupervisor({
      mode: parsed.mode,
      config,
    });

    const program =
      cliEnv.provideServices !== undefined
        ? cliEnv.provideServices(baseProgram)
        : baseProgram.pipe(
            Effect.provide(
              makeLiveSupervisorServices({
                stateRoot,
                env,
                shellBinary: config.shellBinary,
                laneRunScript: config.laneRunScript,
              }),
            ),
          );

    const exitEither = yield* Effect.either(program);
    if (exitEither._tag === "Left") {
      io.writeStderr(MSG_INTERNAL_FAILURE + "\n");
      return EXIT_FAIL;
    }
    const results: readonly SupervisorRunResultV1[] = exitEither.right;

    let overall: number = EXIT_OK;
    for (const r of results) {
      if (r._tag === "Busy" || r._tag === "Corrupt") {
        overall = EXIT_FAIL;
      }
      for (const line of formatRunResultLines(r)) {
        io.writeStderr(line + "\n");
      }
      // Ready command vectors go to stdout (machine-readable).
      if (r._tag === "Swept") {
        for (const a of r.actions) {
          if (a._tag === "Executed" && a.result.submission._tag === "Ready") {
            const argvReady = a.result.submission.commandArgv;
            // Print as a single JSON array line for exact argv fidelity.
            io.writeStdout(JSON.stringify(argvReady) + "\n");
          }
        }
      }
    }
    return overall;
  }).pipe(
    Effect.catchAllDefect(() => {
      io.writeStderr(MSG_INTERNAL_FAILURE + "\n");
      return Effect.succeed(EXIT_FAIL);
    }),
  );
}
