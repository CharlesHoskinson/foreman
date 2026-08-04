/**
 * tool-check CLI argument parsing.
 * Profiles: soft | hard | full | durable. Lanes: grok | codex (not claude).
 */

export const TOOL_CHECK_PROFILES = ["soft", "hard", "full", "durable"] as const;
export type ToolCheckProfile = (typeof TOOL_CHECK_PROFILES)[number];

export const TOOL_CHECK_LANES = ["grok", "codex"] as const;
export type ToolCheckLane = (typeof TOOL_CHECK_LANES)[number];

export const EXIT_READY = 0;
export const EXIT_NOT_READY = 1;
export const EXIT_INVALID_ARGUMENTS = 2;

export const USAGE =
  "usage: tool-check.sh [--profile soft|hard|full|durable] [--json] [--out FILE] [--lane grok|codex]";

export const MSG_LANE_CLAUDE =
  "unsupported --lane claude: T7 removed claude lane advertising because isolated HOME is unverified";

export type ParsedToolCheckArgv =
  | {
      readonly _tag: "Run";
      readonly profile: ToolCheckProfile;
      readonly json: boolean;
      readonly out: string | null;
      readonly lane: ToolCheckLane | null;
    }
  | { readonly _tag: "Help" }
  | { readonly _tag: "Invalid"; readonly message: string };

/**
 * Strip node binary and script path from process.argv-style input.
 */
export function stripToolCheckNodeArgv(
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
      args[0]!.includes("tool-check"))
  ) {
    args = args.slice(1);
  }
  return args;
}

function isProfile(v: string): v is ToolCheckProfile {
  return (TOOL_CHECK_PROFILES as readonly string[]).includes(v);
}

function isLane(v: string): v is ToolCheckLane {
  return (TOOL_CHECK_LANES as readonly string[]).includes(v);
}

/**
 * Parse tool-check argv. Unknown flags and bad values are Invalid (usage).
 */
export function parseToolCheckArgv(
  argv: readonly string[],
): ParsedToolCheckArgv {
  const args = stripToolCheckNodeArgv(argv);
  let profile: ToolCheckProfile = "soft";
  let json = false;
  let out: string | null = null;
  let lane: ToolCheckLane | null = null;

  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === "-h" || a === "--help") {
      return { _tag: "Help" };
    }
    if (a === "--json") {
      json = true;
      i += 1;
      continue;
    }
    if (a === "--profile") {
      const v = args[i + 1];
      if (v === undefined) {
        return { _tag: "Invalid", message: USAGE };
      }
      if (!isProfile(v)) {
        return { _tag: "Invalid", message: `bad profile: ${v}` };
      }
      profile = v;
      i += 2;
      continue;
    }
    if (a === "--out") {
      const v = args[i + 1];
      if (v === undefined || v.length === 0) {
        return { _tag: "Invalid", message: USAGE };
      }
      out = v;
      i += 2;
      continue;
    }
    if (a === "--lane") {
      const v = args[i + 1];
      if (v === undefined) {
        return { _tag: "Invalid", message: USAGE };
      }
      if (v === "claude") {
        return { _tag: "Invalid", message: MSG_LANE_CLAUDE };
      }
      if (!isLane(v)) {
        return { _tag: "Invalid", message: `bad lane: ${v} (grok|codex)` };
      }
      lane = v;
      i += 2;
      continue;
    }
    return { _tag: "Invalid", message: `unknown arg: ${a}` };
  }

  return { _tag: "Run", profile, json, out, lane };
}
