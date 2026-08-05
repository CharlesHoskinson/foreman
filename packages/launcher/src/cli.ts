/**
 * Frozen foreman-launch CLI parse and exit mapping.
 * Pure decode only — no process effects.
 */

export const FOREMAN_LAUNCH_VERSION = "0.3.0";

export const EXIT_TIMEOUT = 124;
export const EXIT_LAUNCHER_ERROR = 125;

export type ParsedLaunchArgs = {
  readonly timeoutSecs: number | undefined;
  readonly graceSecs: number;
  readonly heartbeatFile: string | undefined;
  readonly heartbeatIntervalSecs: number;
  readonly detach: boolean;
  readonly cmd: readonly string[];
};

export type CliParseResult =
  | { readonly _tag: "Ok"; readonly value: ParsedLaunchArgs }
  | { readonly _tag: "Version" }
  | { readonly _tag: "UsageError"; readonly message: string };

export function usage(): string {
  return [
    "usage: foreman-launch [--timeout SECS] [--grace SECS=10]",
    "                       [--heartbeat-file F] [--heartbeat-interval SECS=15]",
    "                       [--detach] -- CMD [ARGS...]",
    "       foreman-launch --version",
    "",
    "stdout/stderr of CMD pass through unmodified. CMD's stdin is the null",
    "device (the launcher forwards it; it never inherits the caller's stdin).",
    "Heartbeat JSON lines go ONLY to --heartbeat-file, one per",
    "--heartbeat-interval seconds (plus one immediately at spawn).",
    "Exit codes: child's own code; 124 = timeout kill; 125 = launcher error.",
  ].join("\n");
}

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
      args[0]!.includes("foreman-launch") ||
      args[0]!.includes("main"))
  ) {
    args = args.slice(1);
  }
  return args;
}

export function formatVersionLine(
  nodeVersion: string = process.version,
): string {
  const v = nodeVersion.startsWith("v") ? nodeVersion.slice(1) : nodeVersion;
  return `foreman-launch ${FOREMAN_LAUNCH_VERSION} (node ${v})`;
}

export function parseArgs(argv: readonly string[]): CliParseResult {
  const sepIdx = argv.indexOf("--");
  const flagSlice =
    sepIdx === -1 ? argv : argv.slice(0, sepIdx);
  if (flagSlice.includes("--version")) {
    return { _tag: "Version" };
  }
  if (sepIdx === -1) {
    return { _tag: "UsageError", message: "missing '--' separator before CMD" };
  }
  const flagArgs = argv.slice(0, sepIdx);
  const cmd = argv.slice(sepIdx + 1);
  if (cmd.length === 0) {
    return { _tag: "UsageError", message: "no CMD given after '--'" };
  }

  let timeoutSecs: number | undefined;
  let graceSecs = 10;
  let heartbeatFile: string | undefined;
  let heartbeatIntervalSecs = 15;
  let detach = false;

  for (let i = 0; i < flagArgs.length; i++) {
    const a = flagArgs[i]!;
    switch (a) {
      case "--timeout": {
        const raw = flagArgs[++i];
        const v = Number(raw);
        if (raw === undefined || !Number.isFinite(v) || v <= 0) {
          return {
            _tag: "UsageError",
            message: "--timeout requires a positive number",
          };
        }
        timeoutSecs = v;
        break;
      }
      case "--grace": {
        const raw = flagArgs[++i];
        const v = Number(raw);
        if (raw === undefined || !Number.isFinite(v) || v < 0) {
          return {
            _tag: "UsageError",
            message: "--grace requires a non-negative number",
          };
        }
        graceSecs = v;
        break;
      }
      case "--heartbeat-file": {
        const v = flagArgs[++i];
        if (!v) {
          return {
            _tag: "UsageError",
            message: "--heartbeat-file requires a path",
          };
        }
        heartbeatFile = v;
        break;
      }
      case "--heartbeat-interval": {
        const raw = flagArgs[++i];
        const v = Number(raw);
        if (raw === undefined || !Number.isFinite(v) || v <= 0) {
          return {
            _tag: "UsageError",
            message: "--heartbeat-interval requires a positive number",
          };
        }
        heartbeatIntervalSecs = v;
        break;
      }
      case "--detach":
        detach = true;
        break;
      default:
        return { _tag: "UsageError", message: `unrecognized flag: ${a}` };
    }
  }

  if (detach && !heartbeatFile) {
    return {
      _tag: "UsageError",
      message: "--detach requires --heartbeat-file",
    };
  }

  return {
    _tag: "Ok",
    value: {
      timeoutSecs,
      graceSecs,
      heartbeatFile,
      heartbeatIntervalSecs,
      detach,
      cmd,
    },
  };
}

/** Map supervise outcome to process exit code. */
export function mapSuperviseExit(result: {
  readonly timedOut: boolean;
  readonly exitCode: number;
}): number {
  if (result.timedOut) return EXIT_TIMEOUT;
  return result.exitCode;
}

/** Build argv for a detached self-re-exec without --detach. */
export function argvWithoutDetach(rawArgv: readonly string[]): string[] {
  const sepIdx = rawArgv.indexOf("--");
  if (sepIdx === -1) return rawArgv.filter((a) => a !== "--detach");
  const flagsPart = rawArgv.slice(0, sepIdx).filter((a) => a !== "--detach");
  const cmdPart = rawArgv.slice(sepIdx);
  return [...flagsPart, ...cmdPart];
}
