/**
 * Bounded overlay worktree restore for R5D resume.
 *
 * Two stages: inspect (no mutation, no budget) then restore (exact
 * checkpoint checkout after reservation). Overlay only — never reset,
 * clean, force, recursive delete, or shell command strings.
 */

import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve as pathResolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { isCommitSha40 } from "@foreman/core";
import {
  type AttemptIdentity,
  type ResumeAttemptReservationV1,
} from "@foreman/event-log";
import {
  attemptIdentitiesEqual,
  type CheckpointIdentityV1,
} from "./round-contract.js";
import {
  ProcessExec,
  type ProcessFailure,
} from "./queue-services.js";
import { sanitizedCheckpointEnv } from "./round-live-services.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const WORKTREE_RESTORE_FAILURE_BRAND = Symbol(
  "@foreman/orchestration/WorktreeRestoreFailure",
);

type Branded = { readonly [WORKTREE_RESTORE_FAILURE_BRAND]: true };

export type WorktreeRestoreFailureReason =
  | "invalid_worktree"
  | "dirty_worktree"
  | "invalid_checkpoint"
  | "identity_mismatch"
  | "worktree_changed"
  | "checkout_failed"
  | "transport_failed";

export type WorktreeRestoreFailure = Branded & {
  readonly _tag: "WorktreeRestoreFailure";
  readonly reason: WorktreeRestoreFailureReason;
};

export function worktreeRestoreFailure(
  reason: WorktreeRestoreFailureReason,
): WorktreeRestoreFailure {
  return {
    [WORKTREE_RESTORE_FAILURE_BRAND]: true,
    _tag: "WorktreeRestoreFailure",
    reason,
  };
}

export function isWorktreeRestoreFailure(
  v: unknown,
): v is WorktreeRestoreFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [WORKTREE_RESTORE_FAILURE_BRAND]?: unknown })[
      WORKTREE_RESTORE_FAILURE_BRAND
    ] === true &&
    (v as { _tag?: unknown })._tag === "WorktreeRestoreFailure"
  );
}

/**
 * Permit binding the canonical absolute worktree root to one exact
 * checkpoint identity. Issued only after clean + commit validation.
 */
export type WorktreeRestorePermitV1 = {
  readonly worktreeRoot: string;
  readonly rootIdentityKey: string;
  readonly checkpointIdentity: CheckpointIdentityV1;
};

export type WorktreeRestoreResultV1 = {
  readonly worktreeRoot: string;
  readonly checkpointIdentity: CheckpointIdentityV1;
};

/** Combined stdout+stderr bound for Git observation commands. */
export const RESTORE_GIT_OUTPUT_BOUND_BYTES = 65_536;

/** Wall-clock bound for each Git observation or checkout call. */
export const RESTORE_GIT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export class WorktreeRestore extends Context.Tag("WorktreeRestore")<
  WorktreeRestore,
  {
    readonly inspect: (input: {
      readonly worktree: string;
      readonly checkpointIdentity: CheckpointIdentityV1;
    }) => Effect.Effect<WorktreeRestorePermitV1, WorktreeRestoreFailure>;
    readonly restore: (input: {
      readonly permit: WorktreeRestorePermitV1;
      readonly reservation: ResumeAttemptReservationV1;
    }) => Effect.Effect<WorktreeRestoreResultV1, WorktreeRestoreFailure>;
  }
>() {}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isValidAbsoluteWorktreePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("\0")) return false;
  return isAbsolute(path);
}

function isValidCheckpointCommit(commit: string): boolean {
  return typeof commit === "string" && isCommitSha40(commit);
}

/**
 * Build the exact Git argument vector for overlay checkout.
 * Production and tests MUST use this function; never reconstruct argv.
 */
export function buildOverlayCheckoutArgs(
  commit: string,
): readonly string[] {
  return [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "advice.detachedHead=false",
    "checkout",
    commit,
    "--",
    ".",
  ];
}

/**
 * Build the exact Git argument vector for porcelain dirty observation.
 */
export function buildStatusPorcelainArgs(): readonly string[] {
  return [
    "-c",
    "core.hooksPath=/dev/null",
    "status",
    "--porcelain=v1",
    "--untracked-files=normal",
  ];
}

/**
 * Build the exact Git argument vector that proves a commit object exists.
 */
export function buildCommitExistsArgs(commit: string): readonly string[] {
  return [
    "-c",
    "core.hooksPath=/dev/null",
    "cat-file",
    "-e",
    `${commit}^{commit}`,
  ];
}

/**
 * True when porcelain status output indicates a clean worktree (no
 * tracked changes and no untracked files reported).
 */
export function isPorcelainClean(stdout: string, stderr: string): boolean {
  const text = `${stdout}${stderr}`;
  // Accept empty or only trailing newlines.
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 0) return false;
  }
  return true;
}

/**
 * Canonical root identity key for recheck: realpath + device/ino when
 * available. Opaque; compared only for equality.
 */
export function rootIdentityKey(
  realPath: string,
  dev: number,
  ino: number,
): string {
  return `${realPath}\0${String(dev)}\0${String(ino)}`;
}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export type WorktreeRestoreSeams = {
  readonly env?: NodeJS.ProcessEnv;
  readonly gitCommand?: string;
};

function mapTransport(_err: ProcessFailure): WorktreeRestoreFailure {
  return worktreeRestoreFailure("transport_failed");
}

/**
 * Normalize an absolute path for identity comparison: resolve `.`/`..`. Does
 * not follow symlinks.
 *
 * Strips no separator of its own. `resolveWorktreeRoot` compares this value
 * against the same function applied to the realpath and then returns it, so
 * collapsing a legal trailing `\` on POSIX let one directory pass the identity
 * check while another was returned to the caller.
 */
export function normalizeAbsoluteWorktreeInput(worktree: string): string {
  return pathResolve(worktree);
}

function resolveWorktreeRoot(
  worktree: string,
):
  | { readonly _tag: "Ok"; readonly realPath: string; readonly key: string }
  | { readonly _tag: "Fail"; readonly reason: WorktreeRestoreFailureReason } {
  if (!isValidAbsoluteWorktreePath(worktree)) {
    return { _tag: "Fail", reason: "invalid_worktree" };
  }
  try {
    const st = statSync(worktree);
    if (!st.isDirectory()) {
      return { _tag: "Fail", reason: "invalid_worktree" };
    }
    const realPath = realpathSync(worktree);
    const realSt = statSync(realPath);
    if (!realSt.isDirectory()) {
      return { _tag: "Fail", reason: "invalid_worktree" };
    }
    // Reject symlink/alias inputs: normalized absolute input must equal the
    // canonical real path before any checkout.
    const inputNorm = normalizeAbsoluteWorktreeInput(worktree);
    const realNorm = normalizeAbsoluteWorktreeInput(realPath);
    if (inputNorm !== realNorm) {
      return { _tag: "Fail", reason: "invalid_worktree" };
    }
    return {
      _tag: "Ok",
      realPath: realNorm,
      key: rootIdentityKey(realNorm, realSt.dev, realSt.ino),
    };
  } catch {
    return { _tag: "Fail", reason: "invalid_worktree" };
  }
}

/**
 * Live WorktreeRestore layer. Uses ProcessExec with argument arrays and a
 * sanitized Git environment. Optional seams replace env and git binary.
 */
export function makeLiveWorktreeRestore(
  seams?: WorktreeRestoreSeams,
): Layer.Layer<WorktreeRestore, never, ProcessExec> {
  const envBase = seams?.env ?? process.env;
  const gitCommand = seams?.gitCommand ?? "git";

  return Layer.effect(
    WorktreeRestore,
    Effect.gen(function* () {
      const proc = yield* ProcessExec;
      const env = sanitizedCheckpointEnv(envBase);

      const runGit = (
        args: readonly string[],
        cwd: string,
      ): Effect.Effect<
        { readonly exitCode: number; readonly stdout: string; readonly stderr: string },
        WorktreeRestoreFailure
      > =>
        proc
          .runCaptured({
            command: gitCommand,
            args: [...args],
            cwd,
            env,
            maxOutputBytes: RESTORE_GIT_OUTPUT_BOUND_BYTES,
            timeoutMs: RESTORE_GIT_TIMEOUT_MS,
          })
          .pipe(Effect.mapError(mapTransport));

      const inspectImpl = (input: {
        readonly worktree: string;
        readonly checkpointIdentity: CheckpointIdentityV1;
      }): Effect.Effect<WorktreeRestorePermitV1, WorktreeRestoreFailure> =>
        Effect.gen(function* () {
          const resolved = resolveWorktreeRoot(input.worktree);
          if (resolved._tag === "Fail") {
            return yield* Effect.fail(worktreeRestoreFailure(resolved.reason));
          }
          const commit = input.checkpointIdentity.commit;
          if (!isValidCheckpointCommit(commit)) {
            return yield* Effect.fail(
              worktreeRestoreFailure("invalid_checkpoint"),
            );
          }

          const exists = yield* runGit(
            buildCommitExistsArgs(commit),
            resolved.realPath,
          );
          if (exists.exitCode !== 0) {
            return yield* Effect.fail(
              worktreeRestoreFailure("invalid_checkpoint"),
            );
          }

          const status = yield* runGit(
            buildStatusPorcelainArgs(),
            resolved.realPath,
          );
          if (status.exitCode !== 0) {
            return yield* Effect.fail(
              worktreeRestoreFailure("invalid_worktree"),
            );
          }
          if (!isPorcelainClean(status.stdout, status.stderr)) {
            return yield* Effect.fail(worktreeRestoreFailure("dirty_worktree"));
          }

          return {
            worktreeRoot: resolved.realPath,
            rootIdentityKey: resolved.key,
            checkpointIdentity: input.checkpointIdentity,
          };
        });

      const restoreImpl = (input: {
        readonly permit: WorktreeRestorePermitV1;
        readonly reservation: ResumeAttemptReservationV1;
      }): Effect.Effect<WorktreeRestoreResultV1, WorktreeRestoreFailure> =>
        Effect.gen(function* () {
          const { permit, reservation } = input;

          // Reject mismatched attempt identities before any write.
          if (
            !attemptIdentitiesEqual(
              permit.checkpointIdentity.attemptIdentity,
              reservation.attemptIdentity,
            )
          ) {
            return yield* Effect.fail(
              worktreeRestoreFailure("identity_mismatch"),
            );
          }

          const commit = permit.checkpointIdentity.commit;
          if (!isValidCheckpointCommit(commit)) {
            return yield* Effect.fail(
              worktreeRestoreFailure("invalid_checkpoint"),
            );
          }

          // Recheck worktree identity and cleanliness before checkout.
          const resolved = resolveWorktreeRoot(permit.worktreeRoot);
          if (resolved._tag === "Fail") {
            return yield* Effect.fail(worktreeRestoreFailure(resolved.reason));
          }
          if (resolved.key !== permit.rootIdentityKey) {
            return yield* Effect.fail(worktreeRestoreFailure("worktree_changed"));
          }
          if (resolved.realPath !== permit.worktreeRoot) {
            return yield* Effect.fail(worktreeRestoreFailure("worktree_changed"));
          }

          const status = yield* runGit(
            buildStatusPorcelainArgs(),
            resolved.realPath,
          );
          if (status.exitCode !== 0) {
            return yield* Effect.fail(
              worktreeRestoreFailure("invalid_worktree"),
            );
          }
          if (!isPorcelainClean(status.stdout, status.stderr)) {
            return yield* Effect.fail(worktreeRestoreFailure("dirty_worktree"));
          }

          const exists = yield* runGit(
            buildCommitExistsArgs(commit),
            resolved.realPath,
          );
          if (exists.exitCode !== 0) {
            return yield* Effect.fail(
              worktreeRestoreFailure("invalid_checkpoint"),
            );
          }

          const checkout = yield* runGit(
            buildOverlayCheckoutArgs(commit),
            resolved.realPath,
          );
          if (checkout.exitCode !== 0) {
            return yield* Effect.fail(worktreeRestoreFailure("checkout_failed"));
          }

          return {
            worktreeRoot: resolved.realPath,
            checkpointIdentity: permit.checkpointIdentity,
          };
        });

      return {
        inspect: inspectImpl,
        restore: restoreImpl,
      };
    }),
  );
}

/**
 * Test-only WorktreeRestore from injectable pure functions.
 */
export function makeStubWorktreeRestore(impl: {
  readonly inspect: (input: {
    readonly worktree: string;
    readonly checkpointIdentity: CheckpointIdentityV1;
  }) => Effect.Effect<WorktreeRestorePermitV1, WorktreeRestoreFailure>;
  readonly restore: (input: {
    readonly permit: WorktreeRestorePermitV1;
    readonly reservation: ResumeAttemptReservationV1;
  }) => Effect.Effect<WorktreeRestoreResultV1, WorktreeRestoreFailure>;
}): Layer.Layer<WorktreeRestore> {
  return Layer.succeed(WorktreeRestore, impl);
}
