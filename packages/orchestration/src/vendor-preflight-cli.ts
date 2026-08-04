/**
 * vendor-preflight CLI: inspect <vendor> | tool-check-row <grok|codex>
 */

import { Effect, Layer } from "effect";
import { canonicalize } from "@foreman/core";
import {
  livePathLookup,
  liveProcessExec,
  type PathLookup,
  type ProcessExec,
} from "./queue-services.js";
import {
  VENDOR_IDS,
  decodeVendorPreflightRecordV1,
  isVendorPreflightContractFailure,
  recordIsFullyReady,
  type VendorId,
  type VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";
import {
  findCapability,
  type VendorCapabilityTableV1,
  type VendorCapabilityV1,
} from "./vendor-preflight-manifest.js";
import {
  PreflightClock,
  VendorPreflightFailure,
  inspectVendor,
  livePreflightClock,
} from "./vendor-preflight-live.js";
import {
  formatToolCheckRowTsv,
  isToolCheckRowVendorId,
  projectVendorPreflightToToolCheckRow,
} from "./vendor-preflight-tool-check.js";

export const EXIT_READY = 0;
export const EXIT_NOT_READY = 1;
export const EXIT_INVALID_ARGUMENTS = 2;
export const EXIT_BOUNDARY_FAILURE = 3;

export const MSG_INVALID_ARGUMENTS = "vendor-preflight: invalid arguments";
export const MSG_UNCONFIGURED_VENDOR =
  "vendor-preflight: vendor is not configured";
export const MSG_BOUNDARY_FAILURE = "vendor-preflight: boundary failure";
export const MSG_INTERNAL_FAILURE = "vendor-preflight: internal failure";

export type PreflightCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type ParsedPreflightArgv =
  | { readonly _tag: "Inspect"; readonly vendor: string }
  | { readonly _tag: "ToolCheckRow"; readonly vendor: string }
  | { readonly _tag: "Invalid" };

/**
 * Strip node binary and script path from process.argv-style input.
 */
export function stripPreflightNodeArgv(
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
      args[0]!.includes("vendor-preflight") ||
      args[0]!.includes("vendor-preflight-main") ||
      args[0]!.includes("vendor-preflight-cli"))
  ) {
    args = args.slice(1);
  }
  return args;
}

export function parsePreflightArgv(
  argv: readonly string[],
): ParsedPreflightArgv {
  const args = stripPreflightNodeArgv(argv);
  if (args.length !== 2) return { _tag: "Invalid" };
  const command = args[0];
  const vendor = args[1];
  if (vendor === undefined || vendor.trim().length === 0) {
    return { _tag: "Invalid" };
  }
  if (command === "inspect") {
    return { _tag: "Inspect", vendor };
  }
  if (command === "tool-check-row") {
    // Adapter command accepts only the advertised Setup lanes.
    if (!isToolCheckRowVendorId(vendor)) {
      return { _tag: "Invalid" };
    }
    return { _tag: "ToolCheckRow", vendor };
  }
  return { _tag: "Invalid" };
}

function isVendorId(v: string): v is VendorId {
  return (VENDOR_IDS as readonly string[]).includes(v);
}

/**
 * Runtime requirements for the default inspect path (`inspectVendor`).
 * The CLI calls `inspectVendor` directly and does not require the
 * `VendorPreflight` service tag; injectable test layers therefore provide
 * only ProcessExec | PathLookup | PreflightClock.
 */
export type PreflightCliRuntime = ProcessExec | PathLookup | PreflightClock;

export type PreflightCliEnv = {
  readonly capabilityTable: VendorCapabilityTableV1;
  /**
   * Optional injectable inspect. Defaults to `inspectVendor` under the
   * provided runtime layer.
   */
  readonly inspect?: (
    capability: VendorCapabilityV1,
  ) => Effect.Effect<
    VendorPreflightRecordV1,
    VendorPreflightFailure,
    PreflightCliRuntime
  >;
  readonly layer?: Layer.Layer<PreflightCliRuntime>;
};

/**
 * Run the vendor-preflight CLI once. Returns process exit code.
 */
export function runVendorPreflightCli(
  argv: readonly string[],
  io: PreflightCliIo,
  env: PreflightCliEnv,
): Effect.Effect<number> {
  return Effect.gen(function* () {
    const parsed = parsePreflightArgv(argv);
    if (parsed._tag === "Invalid") {
      io.writeStderr(MSG_INVALID_ARGUMENTS + "\n");
      return EXIT_INVALID_ARGUMENTS;
    }

    if (!isVendorId(parsed.vendor)) {
      io.writeStderr(MSG_INVALID_ARGUMENTS + "\n");
      return EXIT_INVALID_ARGUMENTS;
    }

    const capability = findCapability(env.capabilityTable, parsed.vendor);
    if (capability === null) {
      // agy is a valid contract id but has no live capability in this slice.
      io.writeStderr(MSG_UNCONFIGURED_VENDOR + "\n");
      return EXIT_INVALID_ARGUMENTS;
    }

    const inspectFn = env.inspect ?? inspectVendor;
    const baseLayer =
      env.layer ??
      Layer.mergeAll(liveProcessExec, livePathLookup, livePreflightClock);

    const either = yield* inspectFn(capability).pipe(
      Effect.provide(baseLayer),
      Effect.either,
    );

    if (either._tag === "Left") {
      const err = either.left;
      if (err instanceof VendorPreflightFailure) {
        io.writeStderr(MSG_BOUNDARY_FAILURE + "\n");
        return EXIT_BOUNDARY_FAILURE;
      }
      io.writeStderr(MSG_INTERNAL_FAILURE + "\n");
      return EXIT_BOUNDARY_FAILURE;
    }

    const record = either.right;
    // Validate before emit
    const decoded = decodeVendorPreflightRecordV1(record);
    if (isVendorPreflightContractFailure(decoded)) {
      io.writeStderr(MSG_INTERNAL_FAILURE + "\n");
      return EXIT_BOUNDARY_FAILURE;
    }
    // Bind every successful inspect result to the requested vendor before
    // JSON or TSV emission. An injected or corrupted record for a different
    // vendor is a typed internal/boundary failure with no stdout.
    if (decoded.vendor !== parsed.vendor) {
      io.writeStderr(MSG_INTERNAL_FAILURE + "\n");
      return EXIT_BOUNDARY_FAILURE;
    }

    if (parsed._tag === "ToolCheckRow") {
      // Adapter path: one TSV row for shell tool-check. Exit 0 whenever a
      // valid row is produced so set -e shell callers can parse status from
      // the row rather than the process exit code.
      const row = projectVendorPreflightToToolCheckRow(decoded);
      io.writeStdout(formatToolCheckRowTsv(row) + "\n");
      return EXIT_READY;
    }

    let line: string;
    try {
      line = canonicalize(decoded as unknown);
    } catch {
      io.writeStderr(MSG_INTERNAL_FAILURE + "\n");
      return EXIT_BOUNDARY_FAILURE;
    }
    io.writeStdout(line + "\n");

    if (recordIsFullyReady(decoded)) {
      return EXIT_READY;
    }
    return EXIT_NOT_READY;
  }).pipe(
    Effect.catchAllDefect(() =>
      Effect.sync(() => {
        io.writeStderr(MSG_INTERNAL_FAILURE + "\n");
        return EXIT_BOUNDARY_FAILURE;
      }),
    ),
  );
}
