/**
 * Closed CLI for architecture policy: check --base <ref> [--repo-root <path>]
 * Rejects unknown flags, duplicate flags, missing values, and extra operands.
 */

import { Effect } from "effect";
import { canonicalize } from "@foreman/core";
import {
  failedResult,
  type ArchitectureCheckResult,
} from "./architecture-schema.js";
import {
  ArchitectureGit,
  runArchitectureCheck,
} from "./architecture-git.js";

export type ArchCliIo = {
  readonly writeStdout: (line: string) => void;
  readonly writeStderr: (line: string) => void;
};

export type ParsedArchArgs =
  | {
      readonly command: "check";
      readonly base: string;
      readonly repoRoot: string;
    }
  | { readonly error: true };

/**
 * Parse argv after optional node + script path strip.
 */
export function parseArchitectureArgv(
  argv: readonly string[],
  defaultCwd: string,
): ParsedArchArgs {
  let args = [...argv];
  if (
    args.length > 0 &&
    (args[0]!.endsWith("node") ||
      args[0]!.includes("node.exe") ||
      args[0]!.endsWith("nodejs"))
  ) {
    args = args.slice(1);
  }
  if (
    args.length > 0 &&
    (args[0]!.endsWith(".js") ||
      args[0]!.endsWith(".ts") ||
      args[0]!.includes("architecture-policy"))
  ) {
    args = args.slice(1);
  }

  if (args.length === 0) return { error: true };
  const command = args[0];
  if (command !== "check") return { error: true };

  let base: string | null = null;
  let repoRoot: string | null = null;
  const seen = new Set<string>();

  for (let i = 1; i < args.length; i += 1) {
    const a = args[i]!;
    if (!a.startsWith("--")) {
      return { error: true };
    }
    if (a === "--base") {
      if (seen.has("base")) return { error: true };
      seen.add("base");
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) return { error: true };
      if (v.length === 0) return { error: true };
      base = v;
      i += 1;
      continue;
    }
    if (a === "--repo-root") {
      if (seen.has("repo-root")) return { error: true };
      seen.add("repo-root");
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) return { error: true };
      if (v.length === 0) return { error: true };
      repoRoot = v;
      i += 1;
      continue;
    }
    // unknown flag or --flag=value form
    return { error: true };
  }

  if (base === null) return { error: true };
  return {
    command: "check",
    base,
    repoRoot: repoRoot ?? defaultCwd,
  };
}

function emit(io: ArchCliIo, result: ArchitectureCheckResult): void {
  io.writeStdout(canonicalize(result) + "\n");
}

/**
 * Run architecture policy CLI. Exit 0 only on Pass.
 * Exit 64 on invalid invocation. Exit 1 on Fail or Failed.
 */
export function runArchitectureCli(
  argv: readonly string[],
  io: ArchCliIo,
  defaultCwd: string,
): Effect.Effect<number, never, ArchitectureGit> {
  return Effect.gen(function* () {
    const parsed = parseArchitectureArgv(argv, defaultCwd);
    if ("error" in parsed) {
      emit(io, failedResult("schema_mismatch"));
      return 64;
    }
    const result = yield* runArchitectureCheck(parsed.repoRoot, parsed.base);
    emit(io, result);
    if (result._tag === "Pass") return 0;
    return 1;
  });
}
