/**
 * Live bindings for the six R2 round transaction services.
 * Sprint 3 R3 — filesystem and process boundaries only.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { Effect, Layer } from "effect";
import { isCommitSha40 } from "@foreman/core";
import {
  makeLiveRunJournalLayer,
  RunJournal,
  type RunId,
  type StoredEventDraftV1,
} from "@foreman/event-log";
import {
  MAX_REPORT_CONTENT_BYTES,
  absentReportSnapshot,
  isRoundContractFailure,
  presentReportSnapshot,
} from "./round-contract.js";
import type { ReportReadResult } from "./report-freshness.js";
import {
  AttemptAllocator,
  CheckpointCapture,
  GateCommand,
  ImplementationCommand,
  ReportSnapshotReader,
  RoundBoundaryFailure,
  RoundEventSink,
  type RoundEventDraft,
  type RoundTransactionServices,
} from "./round-transaction.js";
import {
  liveProcessExec,
  ProcessExec,
  type ProcessFailure,
} from "./queue-services.js";

/** Checkpoint capture combined stdout+stderr bound. */
export const CHECKPOINT_OUTPUT_BOUND_BYTES = 4_096;

/**
 * Pure gate process vector. Production gate service and tests MUST use this
 * function; do not duplicate the vector in test-only code.
 */
export type GateProcessVector =
  | {
      readonly _tag: "Ok";
      readonly command: string;
      readonly args: readonly string[];
    }
  | { readonly _tag: "Invalid" };

/**
 * Build the POSIX or Windows gate process vector from the gate command and
 * host parameters. Invalid ComSpec paths fail closed before process start.
 */
export function buildGateProcessVector(
  gateCommand: string,
  options: {
    readonly platform: NodeJS.Platform;
    readonly comSpec: string | undefined;
  },
): GateProcessVector {
  if (options.platform === "win32") {
    const comSpec = options.comSpec;
    if (
      typeof comSpec !== "string" ||
      comSpec.length === 0 ||
      comSpec.includes("\0") ||
      !isWindowsAbsolute(comSpec)
    ) {
      return { _tag: "Invalid" };
    }
    return {
      _tag: "Ok",
      command: comSpec,
      args: ["/d", "/s", "/c", gateCommand],
    };
  }
  return {
    _tag: "Ok",
    command: "/bin/sh",
    args: ["-c", gateCommand],
  };
}

/** Optional test seam for deterministic report path swap after open/read. */
export type ReportReadSeams = {
  readonly afterReportRead?: (ctx: {
    readonly path: string;
    readonly fd: number;
  }) => void;
};

export type LiveRoundContext = {
  /** Preflighted absolute resolved state root. */
  readonly stateRoot: string;
  /** Preflighted absolute resolved worktree. */
  readonly worktree: string;
  /** Decoded run id for journal appends after allocate. */
  readonly runId: RunId;
  /** Host environment snapshot for child processes. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Process platform override for tests. Defaults to process.platform.
   * Use "win32" to exercise the Windows gate vector without a Windows host.
   */
  readonly platform?: NodeJS.Platform;
  /**
   * ComSpec override for Windows gate tests. Defaults to process.env.ComSpec.
   */
  readonly comSpec?: string;
  /** Optional report-reader seam for path-swap tests. */
  readonly reportSeams?: ReportReadSeams;
};

function isEnoent(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "ENOENT"
  );
}

function isWindowsAbsolute(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/**
 * Strip every inherited environment entry whose case-insensitive name starts
 * with GIT_, then set GIT_TERMINAL_PROMPT=0 and GIT_OPTIONAL_LOCKS=0.
 */
export function sanitizedCheckpointEnv(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (k.length >= 4 && k.slice(0, 4).toLowerCase() === "git_") {
      continue;
    }
    out[k] = v;
  }
  out["GIT_TERMINAL_PROMPT"] = "0";
  out["GIT_OPTIONAL_LOCKS"] = "0";
  return out;
}

/**
 * Parse git rev-parse HEAD output: exactly one lowercase 40-hex commit
 * followed by at most one line terminator.
 */
export function parseCheckpointCommit(text: string): string | null {
  if (typeof text !== "string") return null;
  let body = text;
  if (body.endsWith("\r\n")) {
    body = body.slice(0, -2);
  } else if (body.endsWith("\n") || body.endsWith("\r")) {
    body = body.slice(0, -1);
  }
  if (body.includes("\n") || body.includes("\r")) return null;
  if (!isCommitSha40(body)) return null;
  return body;
}

function draftToStored(event: RoundEventDraft): StoredEventDraftV1 {
  if (event.type === "checkpoint") {
    return {
      type: event.type,
      lane: event.lane,
      commit: event.commit,
      payload: event.payload,
    };
  }
  return {
    type: event.type,
    lane: event.lane,
    payload: event.payload,
  };
}

function mapProcessTo(
  reason:
    | "implementation_transport_failed"
    | "checkpoint_failed"
    | "gate_transport_failed",
  _err: ProcessFailure,
): RoundBoundaryFailure {
  return new RoundBoundaryFailure(reason);
}

function readReportSnapshotSync(
  reportPath: string,
  seams?: ReportReadSeams,
): ReportReadResult {
  let before;
  try {
    before = lstatSync(reportPath);
  } catch (e) {
    if (isEnoent(e)) {
      return { _tag: "Snapshot", snapshot: absentReportSnapshot() };
    }
    return { _tag: "Failure", reason: "report_read_failed" };
  }

  if (before.isSymbolicLink()) {
    return { _tag: "Failure", reason: "report_read_failed" };
  }
  if (!before.isFile()) {
    return { _tag: "Failure", reason: "report_read_failed" };
  }

  if (before.size > MAX_REPORT_CONTENT_BYTES) {
    return { _tag: "Failure", reason: "report_too_large" };
  }

  let fd: number | undefined;
  try {
    const flags =
      fsConstants.O_RDONLY |
      ("O_NOFOLLOW" in fsConstants
        ? (fsConstants as { O_NOFOLLOW: number }).O_NOFOLLOW
        : 0);
    fd = openSync(reportPath, flags);
    const opened = fstatSync(fd);
    if (
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      opened.size !== before.size
    ) {
      return { _tag: "Failure", reason: "report_read_failed" };
    }
    if (!opened.isFile()) {
      return { _tag: "Failure", reason: "report_read_failed" };
    }
    if (opened.size > MAX_REPORT_CONTENT_BYTES) {
      return { _tag: "Failure", reason: "report_too_large" };
    }

    const buf = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < opened.size) {
      const n = readSync(fd, buf, offset, opened.size - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    if (offset !== opened.size) {
      return { _tag: "Failure", reason: "report_read_failed" };
    }

    if (seams?.afterReportRead !== undefined) {
      seams.afterReportRead({ path: reportPath, fd });
    }

    // Re-observe REPORT pathname and compare with the opened descriptor.
    let pathAfter;
    try {
      pathAfter = lstatSync(reportPath);
    } catch (e) {
      if (isEnoent(e)) {
        return { _tag: "Failure", reason: "report_read_failed" };
      }
      return { _tag: "Failure", reason: "report_read_failed" };
    }
    if (pathAfter.isSymbolicLink() || !pathAfter.isFile()) {
      return { _tag: "Failure", reason: "report_read_failed" };
    }

    let after;
    try {
      after = fstatSync(fd);
    } catch {
      return { _tag: "Failure", reason: "report_read_failed" };
    }
    if (
      after.ino !== opened.ino ||
      after.dev !== opened.dev ||
      after.size !== opened.size ||
      pathAfter.ino !== after.ino ||
      pathAfter.dev !== after.dev
    ) {
      return { _tag: "Failure", reason: "report_read_failed" };
    }

    const bytes = buf.subarray(0, offset);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const snap = presentReportSnapshot(digest, bytes.byteLength);
    if (isRoundContractFailure(snap)) {
      return { _tag: "Failure", reason: "report_read_failed" };
    }
    return { _tag: "Snapshot", snapshot: snap };
  } catch (e) {
    if (isEnoent(e)) {
      return { _tag: "Failure", reason: "report_read_failed" };
    }
    return { _tag: "Failure", reason: "report_read_failed" };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Build the six live R2 service bindings for one preflighted context.
 * Does not require a caller-supplied live dependency beyond the context.
 */
export function makeLiveRoundServices(
  ctx: LiveRoundContext,
): Layer.Layer<RoundTransactionServices> {
  const env = ctx.env ?? process.env;
  const platform = ctx.platform ?? process.platform;
  const journalLayer = makeLiveRunJournalLayer(ctx.stateRoot);

  const allocatorLayer = Layer.effect(
    AttemptAllocator,
    Effect.gen(function* () {
      const journal = yield* RunJournal;
      return {
        allocate: (runId, laneId) =>
          journal.allocate(runId, laneId).pipe(
            Effect.mapError(
              () => new RoundBoundaryFailure("allocation_failed"),
            ),
          ),
      };
    }),
  );

  const sinkLayer = Layer.effect(
    RoundEventSink,
    Effect.gen(function* () {
      const journal = yield* RunJournal;
      return {
        append: (event: RoundEventDraft) =>
          journal.append(ctx.runId, draftToStored(event)).pipe(
            Effect.mapError(
              () => new RoundBoundaryFailure("append_failed"),
            ),
            Effect.asVoid,
          ),
      };
    }),
  );

  const reportLayer = Layer.succeed(ReportSnapshotReader, {
    read: (reportPath) =>
      Effect.sync(() =>
        readReportSnapshotSync(reportPath, ctx.reportSeams),
      ),
  });

  const implLayer = Layer.effect(
    ImplementationCommand,
    Effect.gen(function* () {
      const proc = yield* ProcessExec;
      return {
        run: (commandArgv: readonly string[]) =>
          Effect.gen(function* () {
            if (commandArgv.length === 0) {
              return yield* Effect.fail(
                new RoundBoundaryFailure("implementation_transport_failed"),
              );
            }
            return yield* proc
              .runForeground({
                command: commandArgv[0]!,
                args: commandArgv.slice(1),
                cwd: ctx.worktree,
                env,
              })
              .pipe(
                Effect.mapError((e) =>
                  mapProcessTo("implementation_transport_failed", e),
                ),
              );
          }),
      };
    }),
  );

  const checkpointLayer = Layer.effect(
    CheckpointCapture,
    Effect.gen(function* () {
      const proc = yield* ProcessExec;
      return {
        capture: () =>
          Effect.gen(function* () {
            const result = yield* proc
              .runCaptured({
                command: "git",
                args: ["rev-parse", "HEAD"],
                cwd: ctx.worktree,
                env: sanitizedCheckpointEnv(env),
                maxOutputBytes: CHECKPOINT_OUTPUT_BOUND_BYTES,
              })
              .pipe(
                Effect.mapError((e) => mapProcessTo("checkpoint_failed", e)),
              );
            if (result.exitCode !== 0) {
              return yield* Effect.fail(
                new RoundBoundaryFailure("checkpoint_failed"),
              );
            }
            const commit = parseCheckpointCommit(
              result.stdout + result.stderr,
            );
            if (commit === null) {
              return yield* Effect.fail(
                new RoundBoundaryFailure("checkpoint_failed"),
              );
            }
            return commit;
          }),
      };
    }),
  );

  const gateLayer = Layer.effect(
    GateCommand,
    Effect.gen(function* () {
      const proc = yield* ProcessExec;
      return {
        run: (gateCommand: string) =>
          Effect.gen(function* () {
            const comSpec =
              ctx.comSpec ?? env["ComSpec"] ?? env["COMSPEC"];
            const vector = buildGateProcessVector(gateCommand, {
              platform,
              comSpec:
                typeof comSpec === "string" ? comSpec : undefined,
            });
            if (vector._tag === "Invalid") {
              return yield* Effect.fail(
                new RoundBoundaryFailure("gate_transport_failed"),
              );
            }
            return yield* proc
              .runForeground({
                command: vector.command,
                args: vector.args,
                cwd: ctx.worktree,
                env,
              })
              .pipe(
                Effect.mapError((e) =>
                  mapProcessTo("gate_transport_failed", e),
                ),
              );
          }),
      };
    }),
  );

  return Layer.provideMerge(
    Layer.mergeAll(
      allocatorLayer,
      sinkLayer,
      reportLayer,
      implLayer,
      checkpointLayer,
      gateLayer,
    ),
    Layer.mergeAll(journalLayer, liveProcessExec),
  );
}

/** Exposed for focused report-reader tests without the full service stack. */
export function liveReportRead(
  reportPath: string,
  seams?: ReportReadSeams,
): ReportReadResult {
  return readReportSnapshotSync(reportPath, seams);
}
