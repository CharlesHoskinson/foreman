/**
 * Effect resume-safety observation services (Sprint 3 R5B).
 *
 * Process and lock observation only. No restore, lock mutation, queue,
 * process launch, event-history, or resume-count behavior.
 */

import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Context, Effect, Layer } from "effect";
import type {
  ResumeLockState,
  ResumeProcessState,
} from "./resume-decision.js";
import { utf8ByteLength } from "./round-contract.js";

// ---------------------------------------------------------------------------
// Boundary outcome kinds (pure classifiers)
// ---------------------------------------------------------------------------

export type ProcessProbeOutcome = "exists" | "missing" | "denied" | "failed";

export type LockPathKind =
  | "missing"
  | "directory"
  | "symlink"
  | "regular"
  | "other"
  | "failed";

/** Maximum UTF-8 byte length for an absolute lock path. */
export const MAX_LOCK_PATH_BYTES = 32_768;

// ---------------------------------------------------------------------------
// Path / process-id validation
// ---------------------------------------------------------------------------

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * True only when the path is absolute on the current Node platform.
 * Foreign-platform spellings fail closed before any filesystem call.
 * NUL and size are checked separately.
 */
function isValidAbsoluteLockPath(lockPath: string): boolean {
  if (typeof lockPath !== "string" || lockPath.length === 0) return false;
  if (lockPath.includes("\0")) return false;
  if (utf8ByteLength(lockPath) > MAX_LOCK_PATH_BYTES) return false;
  return isAbsolute(lockPath);
}

function errorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Pure classifiers
// ---------------------------------------------------------------------------

/**
 * Classify a process probe outcome into a ResumeProcessState.
 * Invalid ids and unknown boundary failures fail closed as `unknown`.
 * Permission denied proves existence and is therefore `active`.
 */
export function classifyResumeProcess(
  processId: number | null,
  outcome: ProcessProbeOutcome,
): ResumeProcessState {
  if (processId === null) {
    return "inactive";
  }
  if (typeof processId !== "number" || !isPositiveSafeInteger(processId)) {
    return "unknown";
  }
  switch (outcome) {
    case "exists":
      return "active";
    case "missing":
      return "inactive";
    case "denied":
      return "active";
    case "failed":
      return "unknown";
    default: {
      const _exhaustive: never = outcome;
      void _exhaustive;
      return "unknown";
    }
  }
}

/**
 * Classify a no-follow lock path kind into a ResumeLockState.
 * Only a missing valid absolute path is `free`; only a directory is `held`.
 */
export function classifyResumeLock(
  lockPath: string,
  kind: LockPathKind,
): ResumeLockState {
  if (!isValidAbsoluteLockPath(lockPath)) {
    return "unknown";
  }
  switch (kind) {
    case "missing":
      return "free";
    case "directory":
      return "held";
    case "symlink":
    case "regular":
    case "other":
    case "failed":
      return "unknown";
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return "unknown";
    }
  }
}

// ---------------------------------------------------------------------------
// Effect services
// ---------------------------------------------------------------------------

export class ResumeProcessProbe extends Context.Tag("ResumeProcessProbe")<
  ResumeProcessProbe,
  {
    readonly observe: (
      processId: number | null,
    ) => Effect.Effect<ResumeProcessState>;
  }
>() {}

export class ResumeLockProbe extends Context.Tag("ResumeLockProbe")<
  ResumeLockProbe,
  {
    readonly observe: (lockPath: string) => Effect.Effect<ResumeLockState>;
  }
>() {}

export type ResumeSafetyObservationV1 = {
  readonly processState: ResumeProcessState;
  readonly lockState: ResumeLockState;
};

/**
 * Collect process and lock observations for R5A. Preserves `unknown`.
 * Defects from each probe map to that probe's `unknown` only.
 * Fiber interruption is not caught.
 */
export function observeResumeSafety(input: {
  readonly processId: number | null;
  readonly lockPath: string;
}): Effect.Effect<
  ResumeSafetyObservationV1,
  never,
  ResumeProcessProbe | ResumeLockProbe
> {
  return Effect.gen(function* () {
    const processProbe = yield* ResumeProcessProbe;
    const lockProbe = yield* ResumeLockProbe;
    const [processState, lockState] = yield* Effect.all([
      processProbe.observe(input.processId).pipe(
        Effect.catchAllDefect(() => Effect.succeed("unknown" as const)),
      ),
      lockProbe.observe(input.lockPath).pipe(
        Effect.catchAllDefect(() => Effect.succeed("unknown" as const)),
      ),
    ]);
    return { processState, lockState };
  });
}

// ---------------------------------------------------------------------------
// Live layers (injected low-level seams for deterministic tests)
// ---------------------------------------------------------------------------

export type ResumeSafetyBoundarySeams = {
  /** Signal-zero existence check; may throw Node errno errors. */
  readonly signalZero: (processId: number) => void;
  /**
   * No-follow path kind. Must not follow symbolic links.
   * May throw Node errno errors (e.g. ENOENT).
   */
  readonly lstatKind: (
    lockPath: string,
  ) => "directory" | "symlink" | "regular" | "other";
};

function defaultSignalZero(processId: number): void {
  process.kill(processId, 0);
}

function defaultLstatKind(
  lockPath: string,
): "directory" | "symlink" | "regular" | "other" {
  const st = lstatSync(lockPath);
  if (st.isSymbolicLink()) return "symlink";
  if (st.isDirectory()) return "directory";
  if (st.isFile()) return "regular";
  return "other";
}

/**
 * Build live ResumeProcessProbe and ResumeLockProbe layers.
 * Optional seams replace process.kill(..., 0) and lstatSync for tests.
 * Each live service catches and classifies failures from its own seam.
 */
export function makeLiveResumeSafetyLayers(
  seams?: Partial<ResumeSafetyBoundarySeams>,
): Layer.Layer<ResumeProcessProbe | ResumeLockProbe> {
  const signalZero = seams?.signalZero ?? defaultSignalZero;
  const lstatKind = seams?.lstatKind ?? defaultLstatKind;

  const processLayer = Layer.succeed(ResumeProcessProbe, {
    observe: (processId) =>
      Effect.sync(() => {
        if (processId === null) {
          return classifyResumeProcess(null, "missing");
        }
        if (!isPositiveSafeInteger(processId)) {
          return classifyResumeProcess(processId, "failed");
        }
        try {
          signalZero(processId);
          return classifyResumeProcess(processId, "exists");
        } catch (error) {
          const code = errorCode(error);
          if (code === "ESRCH") {
            return classifyResumeProcess(processId, "missing");
          }
          if (code === "EPERM") {
            return classifyResumeProcess(processId, "denied");
          }
          return classifyResumeProcess(processId, "failed");
        }
      }),
  });

  const lockLayer = Layer.succeed(ResumeLockProbe, {
    observe: (lockPath) =>
      Effect.sync(() => {
        if (!isValidAbsoluteLockPath(lockPath)) {
          return classifyResumeLock(lockPath, "failed");
        }
        try {
          const kind = lstatKind(lockPath);
          return classifyResumeLock(lockPath, kind);
        } catch (error) {
          const code = errorCode(error);
          if (code === "ENOENT") {
            return classifyResumeLock(lockPath, "missing");
          }
          return classifyResumeLock(lockPath, "failed");
        }
      }),
  });

  return Layer.mergeAll(processLayer, lockLayer);
}

/** Default live services bound to process.kill(pid, 0) and lstatSync. */
export const liveResumeSafetyServices: Layer.Layer<
  ResumeProcessProbe | ResumeLockProbe
> = makeLiveResumeSafetyLayers();
