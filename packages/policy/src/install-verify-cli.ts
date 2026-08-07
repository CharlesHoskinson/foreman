/**
 * CLI for verify-install and runtime plugin-drift on architecture-policy.
 * One canonical JSON line on stdout. No domain data on stderr.
 * Exit 0 success, 1 verification/drift failure, 64 bad argv.
 */

import { Effect } from "effect";
import { canonicalize } from "@foreman/core";
import { compareRuntimePluginDrift } from "./install-plugin-drift.js";
import { InstallFs } from "./install-verify-fs.js";
import { verifyInstalledSkillRoot } from "./install-verify.js";
import {
  installFailed,
  pluginDriftFailed,
  type InstallVerifyResult,
  type PluginDriftResult,
} from "./install-verify-schema.js";

export type InstallCliIo = {
  readonly writeStdout: (line: string) => void;
  readonly writeStderr: (line: string) => void;
};

export type ParsedInstallArgs =
  | { readonly command: "verify-install"; readonly skillRoot: string }
  | {
      readonly command: "plugin-drift";
      readonly sourceRoot: string;
      readonly installedRoot: string;
    }
  | { readonly error: true };

/**
 * Strip optional node + script path, then parse verify-install / plugin-drift.
 */
export function parseInstallArgv(argv: readonly string[]): ParsedInstallArgs {
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
  if (command !== "verify-install" && command !== "plugin-drift") {
    return { error: true };
  }

  if (command === "verify-install") {
    let skillRoot: string | null = null;
    const seen = new Set<string>();
    for (let i = 1; i < args.length; i += 1) {
      const a = args[i]!;
      if (!a.startsWith("--")) return { error: true };
      if (a === "--skill-root") {
        if (seen.has("skill-root")) return { error: true };
        seen.add("skill-root");
        const v = args[i + 1];
        if (v === undefined || v.startsWith("--") || v.length === 0) {
          return { error: true };
        }
        skillRoot = v;
        i += 1;
        continue;
      }
      return { error: true };
    }
    if (skillRoot === null) return { error: true };
    return { command: "verify-install", skillRoot };
  }

  let sourceRoot: string | null = null;
  let installedRoot: string | null = null;
  const seen = new Set<string>();
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i]!;
    if (!a.startsWith("--")) return { error: true };
    if (a === "--source-root") {
      if (seen.has("source-root")) return { error: true };
      seen.add("source-root");
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--") || v.length === 0) {
        return { error: true };
      }
      sourceRoot = v;
      i += 1;
      continue;
    }
    if (a === "--installed-root") {
      if (seen.has("installed-root")) return { error: true };
      seen.add("installed-root");
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--") || v.length === 0) {
        return { error: true };
      }
      installedRoot = v;
      i += 1;
      continue;
    }
    return { error: true };
  }
  if (sourceRoot === null || installedRoot === null) return { error: true };
  return { command: "plugin-drift", sourceRoot, installedRoot };
}

function emit(io: InstallCliIo, value: unknown): void {
  io.writeStdout(canonicalize(value) + "\n");
}

/**
 * Run verify-install or plugin-drift. Domain failures write JSON to stdout
 * only (stderr empty). Exit 64 on bad argv, 1 on Fail/Failed domain, 0 on Pass.
 */
export function runInstallCli(
  argv: readonly string[],
  io: InstallCliIo,
): Effect.Effect<number, never, InstallFs> {
  return Effect.gen(function* () {
    const parsed = parseInstallArgv(argv);
    if ("error" in parsed) {
      // Choose Failed shape based on attempted command when possible.
      const raw = argv.join(" ");
      if (raw.includes("plugin-drift")) {
        emit(io, pluginDriftFailed("schema_mismatch"));
      } else {
        emit(io, installFailed("schema_mismatch"));
      }
      return 64;
    }

    if (parsed.command === "verify-install") {
      const result: InstallVerifyResult = yield* verifyInstalledSkillRoot(
        parsed.skillRoot,
      );
      emit(io, result);
      return result._tag === "Pass" ? 0 : 1;
    }

    const result: PluginDriftResult = yield* compareRuntimePluginDrift(
      parsed.sourceRoot,
      parsed.installedRoot,
    );
    emit(io, result);
    return result._tag === "Pass" ? 0 : 1;
  });
}

/** True when argv (after strip) starts with an install subcommand. */
export function isInstallCommand(argv: readonly string[]): boolean {
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
  const c = args[0];
  return c === "verify-install" || c === "plugin-drift";
}
