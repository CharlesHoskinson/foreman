/**
 * GraphStore CLI: contract | capabilities | smoke | version-ref
 * Closed JSON stdout for machine-readable commands; stable nonzero exits.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalize } from "@foreman/core";
import { runContractMain } from "./contract-suite.js";
import {
  CapabilityUnavailableError,
  GraphStoreError,
  VersionReferenceError,
  isGraphStoreFailure,
} from "./failures.js";
import { openFilesOnly, openFromEnv } from "./files-only.js";
import {
  OPTIONAL_CAPABILITIES,
  normaliseVersionRef,
} from "./port.js";

export type CliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
  readonly env?: NodeJS.ProcessEnv;
};

const defaultIo: CliIo = {
  writeStdout: (t) => {
    process.stdout.write(t);
  },
  writeStderr: (t) => {
    process.stderr.write(t);
  },
};

function printJson(io: CliIo, value: unknown): void {
  io.writeStdout(canonicalize(value) + "\n");
}

/** Closed failure serialization — never emit raw OS messages or absolute paths. */
export function serializeCliFailure(e: unknown): {
  readonly _tag: "Failed";
  readonly reason: string;
  readonly message: string;
} {
  if (isGraphStoreFailure(e)) {
    return {
      _tag: "Failed",
      reason: e.reason,
      message: redactPaths(e.message),
    };
  }
  if (e instanceof GraphStoreError) {
    return {
      _tag: "Failed",
      reason: e.failure.reason,
      message: redactPaths(e.failure.message),
    };
  }
  if (e instanceof VersionReferenceError) {
    return {
      _tag: "Failed",
      reason: "version_reference",
      message: redactPaths(e.message),
    };
  }
  if (e instanceof Error && e.name === "AssertionError") {
    return {
      _tag: "Failed",
      reason: "internal_failed",
      message: "assertion failed",
    };
  }
  return {
    _tag: "Failed",
    reason: "internal_failed",
    message: "operation failed",
  };
}

function redactPaths(message: string): string {
  // Strip absolute POSIX/Windows paths from any accidental leakage.
  return message
    .replace(/\/(?:home|tmp|var|usr|etc|Users)\/[^\s"']+/g, "<path>")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "<path>");
}

export function cmdContract(argv: readonly string[]): number {
  return runContractMain(argv);
}

export function cmdCapabilities(
  argv: readonly string[],
  io: CliIo = defaultIo,
): number {
  void argv;
  try {
    const store = openFromEnv(io.env ?? process.env);
    const caps = store.capabilities();
    const available = [...caps].sort();
    const all = [...OPTIONAL_CAPABILITIES].sort();
    const unavailable = all.filter((c) => !caps.has(c));
    printJson(io, {
      backend: "FilesOnlyGraphStore",
      optional_available: available,
      optional_unavailable: unavailable,
      all_optional: all,
    });
    return 0;
  } catch (e) {
    printJson(io, serializeCliFailure(e));
    return 1;
  }
}

export function cmdSmoke(
  argv: readonly string[],
  io: CliIo = defaultIo,
): number {
  void argv;
  // Deterministic relative label — never emit the absolute temp path.
  const root = mkdtempSync(join(tmpdir(), "foreman-gs-smoke-"));
  try {
    const store = openFilesOnly({ root, autoSchema: true });
    if (store.capabilities().size !== 0) {
      io.writeStderr("FAIL: files-only must report no optional capabilities\n");
      return 1;
    }
    for (const cap of OPTIONAL_CAPABILITIES) {
      if (store.hasCapability(cap)) {
        io.writeStderr(`FAIL: unexpected capability ${cap}\n`);
        return 1;
      }
    }
    store.upsertDocument({
      "@type": "Task",
      task_key: "smoke",
      title: "no-store smoke",
    });
    store.upsertDocument({
      "@type": "Round",
      task_key: "smoke",
      index: 1,
      has_attempt: ["Attempt/S1"],
    });
    store.upsertDocument({
      "@type": "Attempt",
      attempt_key: "S1",
      lane: "smoke-lane",
      round: "Round/smoke+1",
    });
    const result = store.query("attempts_from_round", {
      expectEmpty: false,
      params: { round_id: "Round/smoke+1" },
    });
    if (!result.rows.includes("Attempt/S1")) {
      io.writeStderr("FAIL: attempts_from_round missing Attempt/S1\n");
      return 1;
    }
    try {
      store.asOf("main");
      io.writeStderr("FAIL: as_of should be unavailable\n");
      return 1;
    } catch (e) {
      if (!(e instanceof CapabilityUnavailableError)) {
        io.writeStderr("FAIL: expected CapabilityUnavailableError\n");
        return 1;
      }
    }
    printJson(io, {
      ok: true,
      backend: "FilesOnlyGraphStore",
      root: "<ephemeral>",
      store_configured: false,
      capabilities: [],
      attempts_from_round: [...result.rows],
    });
    return 0;
  } catch (e) {
    printJson(io, serializeCliFailure(e));
    return 1;
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

export function cmdVersionRef(
  argv: readonly string[],
  io: CliIo = defaultIo,
): number {
  if (argv.length === 0) {
    io.writeStderr("usage: version-ref <ref>\n");
    return 2;
  }
  const ref = argv[0]!;
  try {
    const norm = normaliseVersionRef(ref);
    printJson(io, { _tag: "Ok", ref: norm });
    return 0;
  } catch (e) {
    if (e instanceof VersionReferenceError) {
      printJson(io, {
        _tag: "Rejected",
        ref,
        reason: redactPaths(e.message),
      });
      return 1;
    }
    printJson(io, serializeCliFailure(e));
    return 1;
  }
}

export function runGraphStoreCli(
  argv: readonly string[],
  io: CliIo = defaultIo,
): number {
  // argv[0] is node, argv[1] is script — callers pass process.argv
  const args =
    argv[0]?.endsWith("node") || argv[0]?.includes("node")
      ? argv.slice(2)
      : argv[0]?.includes("graph-store")
        ? argv.slice(1)
        : [...argv];

  let cmdArgs = args;
  if (
    args.length > 0 &&
    (args[0]!.endsWith("graph-store.js") ||
      args[0]!.endsWith("graph-store.ts") ||
      args[0]!.includes("graph-store"))
  ) {
    cmdArgs = args.slice(1);
  }

  if (cmdArgs.length === 0 || cmdArgs[0] === "-h" || cmdArgs[0] === "--help") {
    io.writeStdout(
      "GraphStore CLI\nCommands: contract | capabilities | smoke | version-ref\n",
    );
    return 0;
  }
  const cmd = cmdArgs[0]!;
  const rest = cmdArgs.slice(1);
  try {
    if (cmd === "contract") return cmdContract(rest);
    if (cmd === "capabilities") return cmdCapabilities(rest, io);
    if (cmd === "smoke") return cmdSmoke(rest, io);
    if (cmd === "version-ref") return cmdVersionRef(rest, io);
    io.writeStderr(`unknown command: ${cmd}\n`);
    return 2;
  } catch (e) {
    printJson(io, serializeCliFailure(e));
    return 1;
  }
}
