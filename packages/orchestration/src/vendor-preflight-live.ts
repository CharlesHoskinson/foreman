/**
 * Effect VendorPreflight service and live adapter.
 * Reuses ProcessExec and PathLookup; never mutates the toolchain.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import { Context, Effect, Layer } from "effect";
import {
  MAX_CAPTURE_BYTES,
  PathLookup,
  ProcessExec,
  ProcessFailure,
  type CapturedProcessResult,
} from "./queue-services.js";
import type { VendorCapabilityV1 } from "./vendor-preflight-manifest.js";
import { argvContainsMutatingUpdate } from "./vendor-preflight-manifest.js";
import {
  buildDiscoveredRecord,
  buildMissingRecord,
  classifyAuthForVendor,
  classifyCurrency,
  processFailureToProbeOutcome,
} from "./vendor-preflight.js";
import {
  MAX_PATH_BYTES,
  validateProbeArgv,
  type ProbeOutcome,
  type ProbeRecordV1,
  type VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";

/** Wall-clock bound for every auth or version probe (milliseconds). */
export const PREFLIGHT_PROBE_TIMEOUT_MS = 10_000;

/**
 * The Grok CLI has no reliable non-inference authentication-status contract.
 * Allow the same upper bound as the operator canary documented in the
 * repository trap table. A timeout remains unknown; it is never evidence that
 * the account is signed out.
 */
export const GROK_READINESS_PROBE_TIMEOUT_MS = 90_000;

/** Prefix for the private, one-probe Grok working directory. */
export const GROK_READINESS_CWD_PREFIX = "foreman-grok-ready-";

/** Combined stdout+stderr capture bound (bytes). */
export const PREFLIGHT_PROBE_OUTPUT_BOUND_BYTES = MAX_CAPTURE_BYTES;

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

export type VendorPreflightFailureReason =
  | "internal"
  | "capability_invalid"
  | "mutating_argv_refused";

export class VendorPreflightFailure {
  readonly _tag = "VendorPreflightFailure" as const;
  constructor(
    readonly reason: VendorPreflightFailureReason,
    readonly detail?: string,
  ) {}
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export class PreflightClock extends Context.Tag("PreflightClock")<
  PreflightClock,
  {
    /** Strict UTC RFC 3339 timestamp. */
    readonly nowUtcRfc3339: () => Effect.Effect<string>;
  }
>() {}

export const livePreflightClock = Layer.succeed(PreflightClock, {
  nowUtcRfc3339: () =>
    Effect.sync(() => {
      const d = new Date();
      // Strict: always emit milliseconds and Z.
      return d.toISOString();
    }),
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Optional inspect options. An explicit `env` is passed to both probes. */
export type InspectVendorOptions = {
  /**
   * Complete child environment for version and auth probe processes.
   * When omitted, the process executor inherits ambient environment
   * (current behavior). Callers that isolate vendor homes must copy
   * processEnv and set only the matching GROK_HOME or CODEX_HOME.
   */
  readonly env?: NodeJS.ProcessEnv;
};

export class VendorPreflight extends Context.Tag("VendorPreflight")<
  VendorPreflight,
  {
    readonly inspect: (
      capability: VendorCapabilityV1,
      options?: InspectVendorOptions,
    ) => Effect.Effect<
      VendorPreflightRecordV1,
      VendorPreflightFailure,
      ProcessExec | PathLookup | PreflightClock
    >;
  }
>() {}

type ProbeCapture =
  | {
      readonly _tag: "ok";
      readonly result: CapturedProcessResult;
      readonly outcome: ProbeOutcome;
    }
  | {
      readonly _tag: "failed";
      readonly outcome: ProbeOutcome;
      readonly exitCode: null;
    };

function runProbe(
  executable: string,
  tailArgv: readonly string[],
  vendorBinding: VendorCapabilityV1["vendor"],
  env?: NodeJS.ProcessEnv,
  cwd?: string,
  timeoutMs = PREFLIGHT_PROBE_TIMEOUT_MS,
): Effect.Effect<ProbeCapture, never, ProcessExec> {
  return Effect.gen(function* () {
    const fullArgv = [executable, ...tailArgv];
    if (argvContainsMutatingUpdate(fullArgv, vendorBinding)) {
      // Defensive: never spawn a mutating update.
      return {
        _tag: "failed" as const,
        outcome: "spawn_failed" as const,
        exitCode: null,
      };
    }
    const exec = yield* ProcessExec;
    const either = yield* exec
      .runCaptured({
        command: executable,
        args: [...tailArgv],
        timeoutMs,
        maxOutputBytes: PREFLIGHT_PROBE_OUTPUT_BOUND_BYTES,
        ...(env !== undefined ? { env } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
      })
      .pipe(Effect.either);

    if (either._tag === "Left") {
      const fail = either.left;
      if (fail instanceof ProcessFailure) {
        return {
          _tag: "failed" as const,
          outcome: processFailureToProbeOutcome(fail.reason),
          exitCode: null,
        };
      }
      return {
        _tag: "failed" as const,
        outcome: "spawn_failed" as const,
        exitCode: null,
      };
    }
    const result = either.right;
    const combined = `${result.stdout}${result.stderr}`;
    if (combined.length === 0) {
      return {
        _tag: "ok" as const,
        result,
        outcome: "empty_output" as const,
      };
    }
    return {
      _tag: "ok" as const,
      result,
      outcome: "completed" as const,
    };
  });
}

function probeRecord(
  kind: "version" | "auth",
  executable: string,
  tailArgv: readonly string[],
  capture: ProbeCapture,
): ProbeRecordV1 {
  const argv = [executable, ...tailArgv] as const;
  if (capture._tag === "failed") {
    return {
      kind,
      argv,
      outcome: capture.outcome,
      exitCode: null,
    };
  }
  return {
    kind,
    argv,
    outcome: capture.outcome,
    exitCode: capture.result.exitCode,
  };
}

/**
 * Core inspect implementation (also usable directly in tests with layers).
 * Optional `options.env` is passed to both version and auth probe executions.
 * Existing callers without an explicit environment preserve current behavior.
 */
export const inspectVendor = (
  capability: VendorCapabilityV1,
  options?: InspectVendorOptions,
): Effect.Effect<
  VendorPreflightRecordV1,
  VendorPreflightFailure,
  ProcessExec | PathLookup | PreflightClock
> =>
  Effect.gen(function* () {
    // Refuse capabilities that embed mutating update in probe vectors.
    // Authorization is bound to capability.vendor, never to path/CLI name.
    const authFull = [capability.cliName, ...capability.authArgv];
    const verFull = [capability.cliName, ...capability.versionArgv];
    if (
      argvContainsMutatingUpdate(authFull, capability.vendor) ||
      argvContainsMutatingUpdate(verFull, capability.vendor)
    ) {
      return yield* Effect.fail(
        new VendorPreflightFailure(
          "mutating_argv_refused",
          "capability probe argv contains a mutating update command",
        ),
      );
    }

    const probeEnv = options?.env;

    const clock = yield* PreflightClock;
    const timestamp = yield* clock.nowUtcRfc3339();
    const paths = yield* PathLookup;
    const resolved = yield* paths.which(capability.cliName);

    if (resolved === null) {
      return buildMissingRecord({
        vendor: capability.vendor,
        timestamp,
        capability,
      });
    }

    // Absolute-path contract before any probe.
    // Use trim() only to detect an all-whitespace value; do not execute or
    // record a trimmed path. Resolve the exact relative string (including
    // legal leading/trailing whitespace) or fail closed before probing.
    if (resolved.trim().length === 0 || resolved.includes("\0")) {
      return yield* Effect.fail(
        new VendorPreflightFailure(
          "internal",
          "PathLookup returned an unusable resolved path",
        ),
      );
    }
    const absoluteResolved = isAbsolute(resolved)
      ? resolved
      : resolvePath(resolved);
    if (!isAbsolute(absoluteResolved)) {
      return yield* Effect.fail(
        new VendorPreflightFailure(
          "internal",
          "resolved path could not be made absolute before probe execution",
        ),
      );
    }

    // Enforce public MAX_PATH_BYTES on the exact absolute resolved executable
    // before full-argv validation or any process start.
    if (Buffer.byteLength(absoluteResolved, "utf8") > MAX_PATH_BYTES) {
      return yield* Effect.fail(
        new VendorPreflightFailure(
          "capability_invalid",
          "resolved executable path exceeds MAX_PATH_BYTES",
        ),
      );
    }
    const executable = absoluteResolved;

    // Validate complete probe argv (resolved executable + capability tail)
    // against public entry-count and UTF-8 byte bounds before any process.
    // Invalid full vectors never construct a record the public decoder would
    // reject and never start a child process.
    const versionFull = [executable, ...capability.versionArgv];
    const authFullResolved = [executable, ...capability.authArgv];
    const versionArgvCheck = validateProbeArgv(versionFull);
    const authArgvCheck = validateProbeArgv(authFullResolved);
    if (versionArgvCheck !== null || authArgvCheck !== null) {
      return yield* Effect.fail(
        new VendorPreflightFailure(
          "capability_invalid",
          "full probe argv exceeds public entry or UTF-8 byte bounds",
        ),
      );
    }

    // Version probe first (currency independent of auth).
    const versionCap = yield* runProbe(
      executable,
      capability.versionArgv,
      capability.vendor,
      probeEnv,
    );
    const versionProbe = probeRecord(
      "version",
      executable,
      capability.versionArgv,
      versionCap,
    );

    let versionOutput: string | null = null;
    let versionOutcome: ProbeOutcome = versionProbe.outcome;
    if (versionCap._tag === "ok" && versionCap.outcome === "completed") {
      versionOutput = `${versionCap.result.stdout}${versionCap.result.stderr}`;
    } else if (versionCap._tag === "ok") {
      versionOutcome = versionCap.outcome;
    } else {
      versionOutcome = versionCap.outcome;
    }

    const currency = classifyCurrency(
      versionOutput,
      capability.versionFloor,
      versionOutcome,
    );

    // Auth probe. Grok's readiness contract is a minimal read-only workload,
    // not its historically unreliable `models` presentation. Keep that probe
    // outside the caller's repository so local instructions cannot influence
    // the exact-token response.
    const authEffect =
      capability.vendor === "grok"
        ? Effect.acquireUseRelease(
            Effect.try({
              try: () =>
                mkdtempSync(join(tmpdir(), GROK_READINESS_CWD_PREFIX)),
              catch: () =>
                new VendorPreflightFailure(
                  "internal",
                  "could not create private Grok readiness directory",
                ),
            }),
            (privateCwd) =>
              runProbe(
                executable,
                capability.authArgv,
                capability.vendor,
                probeEnv,
                privateCwd,
                GROK_READINESS_PROBE_TIMEOUT_MS,
              ),
            (privateCwd) =>
              Effect.sync(() => {
                rmSync(privateCwd, { recursive: true });
              }),
          )
        : runProbe(
            executable,
            capability.authArgv,
            capability.vendor,
            probeEnv,
          );
    const authCap = yield* authEffect;
    const authProbe = probeRecord(
      "auth",
      executable,
      capability.authArgv,
      authCap,
    );

    let authStdout = "";
    let authStderr = "";
    let authExit: number | null = null;
    let authOutcome: ProbeOutcome = authProbe.outcome;
    if (authCap._tag === "ok") {
      authStdout = authCap.result.stdout;
      authStderr = authCap.result.stderr;
      authExit = authCap.result.exitCode;
      authOutcome = authCap.outcome;
      // For Claude, empty_output / completed with malformed is handled in classifier.
      // Map empty_output explicitly for auth classification path.
      if (authOutcome === "empty_output") {
        // keep
      } else if (authOutcome === "completed") {
        // Claude may need malformed detection inside classifier
      }
    }

    // If outcome is empty_output, classifier still gets empty strings.
    // For malformed JSON (claude), classifier returns unknown with malformed reason;
    // we may upgrade probe outcome to malformed_output when applicable.
    let auth = classifyAuthForVendor(
      capability.vendor,
      authStdout,
      authStderr,
      authExit,
      authOutcome === "empty_output" ? "empty_output" : authOutcome,
      capability,
    );

    // Refine probe outcome for claude malformed JSON when process completed.
    let finalAuthProbe = authProbe;
    if (
      capability.vendor === "claude" &&
      authProbe.outcome === "completed" &&
      auth.value === "unknown" &&
      auth.reason.includes("malformed JSON")
    ) {
      finalAuthProbe = {
        ...authProbe,
        outcome: "malformed_output",
      };
      auth = {
        value: "unknown",
        reason: "claude auth status returned malformed JSON",
      };
    }
    if (
      capability.vendor === "grok" &&
      authProbe.outcome === "completed" &&
      auth.value === "unknown" &&
      auth.reason.includes("did not match")
    ) {
      finalAuthProbe = {
        ...authProbe,
        outcome: "unmatched_output",
      };
    }

    const probes: ProbeRecordV1[] = [versionProbe, finalAuthProbe];

    return buildDiscoveredRecord({
      vendor: capability.vendor,
      timestamp,
      resolvedPath: absoluteResolved,
      capability,
      auth,
      currency,
      probes,
    });
  });

export const liveVendorPreflight = Layer.succeed(VendorPreflight, {
  inspect: (capability, options) => inspectVendor(capability, options),
});

export const liveVendorPreflightLayer = Layer.mergeAll(
  liveVendorPreflight,
  livePreflightClock,
);
