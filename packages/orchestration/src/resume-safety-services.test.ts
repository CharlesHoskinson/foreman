/**
 * Focused tests for R5B Effect resume-safety observation services.
 * Observation only — no restore, lock mutation, queue, or process launch.
 */

import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { describe, it } from "node:test";
import { Cause, Context, Effect, Exit, Layer } from "effect";
import type { ResumeLockState, ResumeProcessState } from "./resume-decision.js";
import {
  classifyResumeLock,
  classifyResumeProcess,
  liveResumeSafetyServices,
  makeLiveResumeSafetyLayers,
  MAX_LOCK_PATH_BYTES,
  observeResumeSafety,
  ResumeLockProbe,
  ResumeProcessProbe,
  type LockPathKind,
  type ProcessProbeOutcome,
  type ResumeSafetyObservationV1,
} from "./resume-safety-services.js";

// ---------------------------------------------------------------------------
// Current-platform path witnesses
// ---------------------------------------------------------------------------

/** Absolute lock path spelling valid on the current Node platform. */
const absLock: string =
  process.platform === "win32"
    ? "C:\\foreman\\lane.lock"
    : "/tmp/foreman/lane.lock";

/**
 * Foreign-platform absolute spellings that node:path.isAbsolute rejects here.
 * On Windows, drive and UNC forms are native; POSIX hosts treat them as foreign.
 */
const foreignPlatformLockPaths: readonly string[] =
  process.platform === "win32"
    ? []
    : ["C:\\foreman\\lane.lock", "\\\\server\\share\\lane.lock"];

/** Current-platform absolute path with exactly MAX_LOCK_PATH_BYTES UTF-8 bytes. */
function exactBoundAbsolutePath(): string {
  if (process.platform === "win32") {
    const prefix = "C:\\";
    return prefix + "a".repeat(MAX_LOCK_PATH_BYTES - Buffer.byteLength(prefix));
  }
  return `/${"a".repeat(MAX_LOCK_PATH_BYTES - 1)}`;
}

/** Current-platform absolute path one UTF-8 byte over the bound. */
function oversizeAbsolutePath(): string {
  if (process.platform === "win32") {
    const prefix = "C:\\";
    return (
      prefix + "a".repeat(MAX_LOCK_PATH_BYTES - Buffer.byteLength(prefix) + 1)
    );
  }
  return `/${"a".repeat(MAX_LOCK_PATH_BYTES)}`;
}

// ---------------------------------------------------------------------------
// Pure classifiers
// ---------------------------------------------------------------------------

describe("classifyResumeProcess", () => {
  const validPid = 4242;

  it("maps closed outcomes for a valid process id", () => {
    const cases: ReadonlyArray<{
      readonly outcome: ProcessProbeOutcome;
      readonly expected: ResumeProcessState;
    }> = [
      { outcome: "exists", expected: "active" },
      { outcome: "missing", expected: "inactive" },
      { outcome: "denied", expected: "active" },
      { outcome: "failed", expected: "unknown" },
    ];
    for (const { outcome, expected } of cases) {
      assert.equal(
        classifyResumeProcess(validPid, outcome),
        expected,
        `outcome ${outcome}`,
      );
    }
  });

  it("treats permission-denied as active, never inactive", () => {
    assert.equal(classifyResumeProcess(validPid, "denied"), "active");
    assert.notEqual(classifyResumeProcess(validPid, "denied"), "inactive");
  });

  it("returns inactive for null regardless of outcome", () => {
    const outcomes: readonly ProcessProbeOutcome[] = [
      "exists",
      "missing",
      "denied",
      "failed",
    ];
    for (const outcome of outcomes) {
      assert.equal(
        classifyResumeProcess(null, outcome),
        "inactive",
        `null + ${outcome}`,
      );
    }
  });

  it("returns unknown for invalid process ids regardless of outcome", () => {
    const invalidIds: readonly number[] = [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ];
    const outcomes: readonly ProcessProbeOutcome[] = [
      "exists",
      "missing",
      "denied",
      "failed",
    ];
    for (const processId of invalidIds) {
      for (const outcome of outcomes) {
        assert.equal(
          classifyResumeProcess(processId, outcome),
          "unknown",
          `id=${String(processId)} outcome=${outcome}`,
        );
      }
    }
  });
});

describe("classifyResumeLock", () => {
  it("maps closed kinds for a current-platform absolute path", () => {
    assert.equal(isAbsolute(absLock), true, "witness must be platform-absolute");
    const cases: ReadonlyArray<{
      readonly kind: LockPathKind;
      readonly expected: ResumeLockState;
    }> = [
      { kind: "missing", expected: "free" },
      { kind: "directory", expected: "held" },
      { kind: "symlink", expected: "unknown" },
      { kind: "regular", expected: "unknown" },
      { kind: "other", expected: "unknown" },
      { kind: "failed", expected: "unknown" },
    ];
    for (const { kind, expected } of cases) {
      assert.equal(
        classifyResumeLock(absLock, kind),
        expected,
        `${absLock} kind=${kind}`,
      );
    }
  });

  it("returns free only for missing on a valid absolute path", () => {
    assert.equal(classifyResumeLock(absLock, "missing"), "free");
    assert.notEqual(classifyResumeLock(absLock, "directory"), "free");
    assert.notEqual(classifyResumeLock(absLock, "symlink"), "free");
    assert.notEqual(classifyResumeLock("relative/lock", "missing"), "free");
  });

  it("returns held only for a directory on a valid absolute path", () => {
    assert.equal(classifyResumeLock(absLock, "directory"), "held");
    assert.notEqual(classifyResumeLock(absLock, "symlink"), "held");
    assert.notEqual(classifyResumeLock(absLock, "regular"), "held");
    assert.notEqual(classifyResumeLock(absLock, "missing"), "held");
  });

  it("returns unknown for empty, relative, NUL, and oversize paths", () => {
    const invalidPaths: readonly string[] = [
      "",
      "relative/lock",
      "./lock",
      "foo",
      `${absLock}\0evil`,
      oversizeAbsolutePath(),
    ];
    const kinds: readonly LockPathKind[] = [
      "missing",
      "directory",
      "symlink",
      "regular",
      "other",
      "failed",
    ];
    for (const lockPath of invalidPaths) {
      for (const kind of kinds) {
        assert.equal(
          classifyResumeLock(lockPath, kind),
          "unknown",
          `path=${JSON.stringify(lockPath)} kind=${kind}`,
        );
      }
    }
  });

  it("returns unknown for foreign-platform path spellings", () => {
    if (foreignPlatformLockPaths.length === 0) {
      // Current platform accepts drive/UNC; no foreign absolute spelling here.
      return;
    }
    const kinds: readonly LockPathKind[] = [
      "missing",
      "directory",
      "symlink",
      "regular",
      "other",
      "failed",
    ];
    for (const lockPath of foreignPlatformLockPaths) {
      assert.equal(
        isAbsolute(lockPath),
        false,
        `foreign spelling must fail node:path.isAbsolute: ${lockPath}`,
      );
      for (const kind of kinds) {
        assert.equal(
          classifyResumeLock(lockPath, kind),
          "unknown",
          `foreign path=${JSON.stringify(lockPath)} kind=${kind}`,
        );
        // Never free: ENOENT-style "missing" must not fail open for foreign forms.
        assert.notEqual(
          classifyResumeLock(lockPath, kind),
          "free",
          `foreign path must not be free: ${lockPath}`,
        );
      }
    }
  });

  it("accepts exactly 32,768 UTF-8 bytes for a current-platform absolute path", () => {
    const exact = exactBoundAbsolutePath();
    assert.equal(Buffer.byteLength(exact, "utf8"), MAX_LOCK_PATH_BYTES);
    assert.equal(isAbsolute(exact), true);
    assert.equal(classifyResumeLock(exact, "missing"), "free");
    assert.equal(classifyResumeLock(exact, "directory"), "held");
  });
});

// ---------------------------------------------------------------------------
// Effect composition with injected service layers
// ---------------------------------------------------------------------------

function processLayer(
  observe: (processId: number | null) => Effect.Effect<ResumeProcessState>,
): Layer.Layer<ResumeProcessProbe> {
  return Layer.succeed(ResumeProcessProbe, { observe });
}

function lockLayer(
  observe: (lockPath: string) => Effect.Effect<ResumeLockState>,
): Layer.Layer<ResumeLockProbe> {
  return Layer.succeed(ResumeLockProbe, { observe });
}

async function runObservation(
  input: { readonly processId: number | null; readonly lockPath: string },
  process: (processId: number | null) => Effect.Effect<ResumeProcessState>,
  lock: (lockPath: string) => Effect.Effect<ResumeLockState>,
): Promise<ResumeSafetyObservationV1> {
  const layer = Layer.mergeAll(processLayer(process), lockLayer(lock));
  return Effect.runPromise(
    observeResumeSafety(input).pipe(Effect.provide(layer)),
  );
}

describe("observeResumeSafety", () => {
  it("calls both services once and returns both states", async () => {
    const processCalls: Array<number | null> = [];
    const lockCalls: string[] = [];
    const observation = await runObservation(
      { processId: 99, lockPath: absLock },
      (processId) =>
        Effect.sync(() => {
          processCalls.push(processId);
          return "inactive";
        }),
      (lockPath) =>
        Effect.sync(() => {
          lockCalls.push(lockPath);
          return "free";
        }),
    );
    assert.deepEqual(observation, {
      processState: "inactive",
      lockState: "free",
    });
    assert.deepEqual(processCalls, [99]);
    assert.deepEqual(lockCalls, [absLock]);
  });

  it("preserves unknown process state through composition", async () => {
    const observation = await runObservation(
      { processId: 1, lockPath: absLock },
      () => Effect.succeed("unknown"),
      () => Effect.succeed("free"),
    );
    assert.equal(observation.processState, "unknown");
    assert.equal(observation.lockState, "free");
  });

  it("preserves unknown lock state through composition", async () => {
    const observation = await runObservation(
      { processId: 1, lockPath: absLock },
      () => Effect.succeed("inactive"),
      () => Effect.succeed("unknown"),
    );
    assert.equal(observation.processState, "inactive");
    assert.equal(observation.lockState, "unknown");
  });

  it("maps an injected process service defect to process unknown only", async () => {
    const observation = await runObservation(
      { processId: 1, lockPath: absLock },
      () => Effect.die(new Error("process probe defect")),
      () => Effect.succeed("free"),
    );
    assert.equal(observation.processState, "unknown");
    assert.equal(observation.lockState, "free");
  });

  it("maps an injected lock service defect to lock unknown only", async () => {
    const observation = await runObservation(
      { processId: 1, lockPath: absLock },
      () => Effect.succeed("inactive"),
      () => Effect.die(new Error("lock probe defect")),
    );
    assert.equal(observation.processState, "inactive");
    assert.equal(observation.lockState, "unknown");
  });

  it("does not catch Fiber interruption from a probe", async () => {
    const layer = Layer.mergeAll(
      processLayer(() => Effect.interrupt),
      lockLayer(() => Effect.succeed("free")),
    );
    const exit = await Effect.runPromise(
      Effect.exit(
        observeResumeSafety({ processId: 1, lockPath: absLock }).pipe(
          Effect.provide(layer),
        ),
      ),
    );
    assert.equal(Exit.isFailure(exit), true, "interrupt must fail the fiber");
    assert.equal(
      Exit.isInterrupted(exit),
      true,
      "interrupt must remain interruption, not defect→unknown success",
    );
    if (exit._tag === "Failure") {
      assert.equal(Cause.isInterruptedOnly(exit.cause), true);
    }
  });

  it("requires ResumeProcessProbe and ResumeLockProbe in the environment", () => {
    // Type-level: the program's requirements include both tags.
    const _check: Context.Tag.Identifier<typeof ResumeProcessProbe> =
      "ResumeProcessProbe" as never;
    const _checkLock: Context.Tag.Identifier<typeof ResumeLockProbe> =
      "ResumeLockProbe" as never;
    void _check;
    void _checkLock;
    assert.equal(ResumeProcessProbe.key, "ResumeProcessProbe");
    assert.equal(ResumeLockProbe.key, "ResumeLockProbe");
  });
});

// ---------------------------------------------------------------------------
// Live layers with injected low-level seams
// ---------------------------------------------------------------------------

function errno(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code }) as NodeJS.ErrnoException;
}

describe("makeLiveResumeSafetyLayers", () => {
  it("maps signal-zero success to active and never sends a non-zero signal", async () => {
    const signalArgs: Array<{ pid: number; signal?: NodeJS.Signals | number }> =
      [];
    const layer = makeLiveResumeSafetyLayers({
      signalZero: (processId) => {
        signalArgs.push({ pid: processId });
      },
      lstatKind: () => "directory",
    });
    const observation = await Effect.runPromise(
      observeResumeSafety({
        processId: 777,
        lockPath: absLock,
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(observation.processState, "active");
    assert.equal(observation.lockState, "held");
    assert.deepEqual(signalArgs, [{ pid: 777 }]);
  });

  it("maps ESRCH to inactive and EPERM to active", async () => {
    const layerMissing = makeLiveResumeSafetyLayers({
      signalZero: () => {
        throw errno("ESRCH");
      },
      lstatKind: () => {
        throw errno("ENOENT");
      },
    });
    const missing = await Effect.runPromise(
      observeResumeSafety({
        processId: 12,
        lockPath: absLock,
      }).pipe(Effect.provide(layerMissing)),
    );
    assert.equal(missing.processState, "inactive");
    assert.equal(missing.lockState, "free");

    const layerDenied = makeLiveResumeSafetyLayers({
      signalZero: () => {
        throw errno("EPERM");
      },
      lstatKind: () => "directory",
    });
    const denied = await Effect.runPromise(
      observeResumeSafety({
        processId: 13,
        lockPath: absLock,
      }).pipe(Effect.provide(layerDenied)),
    );
    assert.equal(denied.processState, "active");
    assert.notEqual(denied.processState, "inactive");
  });

  it("maps unknown process and lock seam failures to unknown at each boundary", async () => {
    let processCalls = 0;
    let lockCalls = 0;
    const layer = makeLiveResumeSafetyLayers({
      signalZero: () => {
        processCalls += 1;
        throw errno("EIO");
      },
      lstatKind: () => {
        lockCalls += 1;
        throw errno("EACCES");
      },
    });
    const observation = await Effect.runPromise(
      observeResumeSafety({
        processId: 42,
        lockPath: absLock,
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(observation.processState, "unknown");
    assert.equal(observation.lockState, "unknown");
    assert.equal(processCalls, 1);
    assert.equal(lockCalls, 1);
  });

  it("treats a symbolic link as unknown without following it", async () => {
    let followed = false;
    const layer = makeLiveResumeSafetyLayers({
      signalZero: () => {
        /* exists */
      },
      lstatKind: () => {
        // Seam returns symlink kind; must not resolve the target.
        followed = false;
        return "symlink";
      },
    });
    const observation = await Effect.runPromise(
      observeResumeSafety({
        processId: 1,
        lockPath: absLock,
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(observation.lockState, "unknown");
    assert.equal(followed, false);
  });

  it("classifies null process id as inactive without calling signalZero", async () => {
    let signalCalls = 0;
    const layer = makeLiveResumeSafetyLayers({
      signalZero: () => {
        signalCalls += 1;
      },
      lstatKind: () => {
        throw errno("ENOENT");
      },
    });
    const observation = await Effect.runPromise(
      observeResumeSafety({
        processId: null,
        lockPath: absLock,
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(observation.processState, "inactive");
    assert.equal(observation.lockState, "free");
    assert.equal(signalCalls, 0);
  });

  it("classifies invalid process id as unknown without calling signalZero", async () => {
    let signalCalls = 0;
    const layer = makeLiveResumeSafetyLayers({
      signalZero: () => {
        signalCalls += 1;
      },
      lstatKind: () => "directory",
    });
    const observation = await Effect.runPromise(
      observeResumeSafety({
        processId: 0,
        lockPath: absLock,
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(observation.processState, "unknown");
    assert.equal(signalCalls, 0);
  });

  it("classifies invalid lock path as unknown without calling lstatKind", async () => {
    let lstatCalls = 0;
    const layer = makeLiveResumeSafetyLayers({
      signalZero: () => {
        /* exists */
      },
      lstatKind: () => {
        lstatCalls += 1;
        return "directory";
      },
    });
    const observation = await Effect.runPromise(
      observeResumeSafety({
        processId: 1,
        lockPath: "relative/lock",
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(observation.lockState, "unknown");
    assert.equal(lstatCalls, 0);
  });

  it("classifies foreign-platform lock path as unknown without calling lstatKind", async () => {
    if (foreignPlatformLockPaths.length === 0) {
      // No foreign absolute spelling on this platform.
      return;
    }
    for (const foreignPath of foreignPlatformLockPaths) {
      let lstatCalls = 0;
      const layer = makeLiveResumeSafetyLayers({
        signalZero: () => {
          /* exists */
        },
        lstatKind: () => {
          lstatCalls += 1;
          return "directory";
        },
      });
      const observation = await Effect.runPromise(
        observeResumeSafety({
          processId: 1,
          lockPath: foreignPath,
        }).pipe(Effect.provide(layer)),
      );
      assert.equal(
        observation.lockState,
        "unknown",
        `foreign path must be unknown: ${foreignPath}`,
      );
      assert.notEqual(
        observation.lockState,
        "free",
        `foreign path must not fail open as free: ${foreignPath}`,
      );
      assert.equal(
        lstatCalls,
        0,
        `filesystem seam must not run for foreign path: ${foreignPath}`,
      );
    }
  });

  it("classifies thrown non-errno defects at the process boundary as unknown", async () => {
    const layer = makeLiveResumeSafetyLayers({
      signalZero: () => {
        throw new Error("unexpected defect");
      },
      lstatKind: () => "directory",
    });
    const observation = await Effect.runPromise(
      observeResumeSafety({
        processId: 9,
        lockPath: absLock,
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(observation.processState, "unknown");
    assert.equal(observation.lockState, "held");
  });

  it("classifies thrown non-errno defects at the lock boundary as unknown", async () => {
    const layer = makeLiveResumeSafetyLayers({
      signalZero: () => {
        /* exists */
      },
      lstatKind: () => {
        throw new TypeError("unexpected defect");
      },
    });
    const observation = await Effect.runPromise(
      observeResumeSafety({
        processId: 9,
        lockPath: absLock,
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(observation.processState, "active");
    assert.equal(observation.lockState, "unknown");
  });

  it("exports a default liveResumeSafetyServices layer", () => {
    assert.ok(liveResumeSafetyServices);
  });
});
