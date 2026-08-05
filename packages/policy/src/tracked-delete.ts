import { createHash } from "node:crypto";
import { join } from "node:path";
import { Effect } from "effect";
import { MAX_INPUT_BYTES } from "@foreman/core";
import { admitCheck } from "./admit.js";
import { loadCommittedAuthority, mapAuthorityError } from "./authority.js";
import {
  Clock,
  FileSystem,
  GitIdentity,
  MutationProbe,
  PolicyFsError,
  PolicyGitError,
  type FileStat,
} from "./services.js";
import type {
  AdmissionRequest,
  DenialReason,
  TrackedDeleteResult,
  TrackedDeleteTarget,
  TrackedFileMode,
} from "./schema.js";

export type DeleteTrackedArgs = {
  readonly repoRoot: string;
  readonly request: AdmissionRequest;
};

type CapturedTarget = {
  readonly target: TrackedDeleteTarget;
  readonly absPath: string;
  readonly bytes: Uint8Array;
  readonly posixMode: number;
};

function denied(
  entryId: string | null,
  reason: DenialReason,
): TrackedDeleteResult {
  return { schemaVersion: 1, _tag: "Denied", entryId, reason };
}

function failed(reason: DenialReason): TrackedDeleteResult {
  return { schemaVersion: 1, _tag: "Failed", reason };
}

/** Git blob SHA-1 of file bytes (header + content). */
export function gitBlobSha1(bytes: Uint8Array): string {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const h = createHash("sha1");
  h.update(header);
  h.update(bytes);
  return h.digest("hex");
}

function modeToPosix(mode: TrackedFileMode): number {
  return mode === "100755" ? 0o755 : 0o644;
}

function asTrackedMode(mode: string): TrackedFileMode | null {
  if (mode === "100644" || mode === "100755") return mode;
  return null;
}

function mapFsPreflight(stat: FileStat): DenialReason | null {
  if (stat.isSymbolicLink) return "source_is_symlink";
  if (stat.isDirectory) return "source_not_regular_file";
  if (!stat.isFile) return "source_not_regular_file";
  if (stat.nlink > 1) return "source_is_hardlink";
  return null;
}

/**
 * Live tracked_delete executor: admit → preflight entire batch → capture →
 * delete only after full pass → all-or-rollback restore on host/injected
 * failure → closed receipt. Never shells out with caller-selected commands.
 */
export function deleteTracked(
  args: DeleteTrackedArgs,
): Effect.Effect<
  TrackedDeleteResult,
  never,
  GitIdentity | Clock | MutationProbe | FileSystem
> {
  return Effect.gen(function* () {
    const clock = yield* Clock;
    const probe = yield* MutationProbe;
    const fs = yield* FileSystem;
    const git = yield* GitIdentity;

    const authE = yield* Effect.either(loadCommittedAuthority(args.repoRoot));
    if (authE._tag === "Left") {
      return failed(mapAuthorityError(authE.left));
    }
    const auth = authE.right;
    const nowMs = yield* clock.nowMs();
    const check = admitCheck(
      auth.register,
      auth.registerSha256,
      args.request,
      nowMs,
      auth.snapshot,
    );
    if (check._tag === "Denied") {
      return denied(check.entryId, check.reason);
    }
    if (check._tag === "Failed") {
      return failed(check.reason);
    }
    if (check.actionKind !== "tracked_delete") {
      return denied(check.entryId, "unsupported_action");
    }

    const entry = auth.register.currentEntries.find(
      (e) => e.id === check.entryId,
    );
    if (!entry?.trackedDelete || !entry.approval) {
      return failed("schema_mismatch");
    }
    const recoveryCommitSha = entry.approval.candidateCommitSha;
    const approvedTargets = entry.trackedDelete.targets;

    // --- Preflight: verify every target before any mutation ---
    const captured: CapturedTarget[] = [];
    for (const target of approvedTargets) {
      const headE = yield* Effect.either(
        git.inspectTrackedAtHead(args.repoRoot, target.path),
      );
      if (headE._tag === "Left") {
        const r = headE.left.reason;
        // Distinguish missing worktree vs untracked when HEAD lacks path
        if (r === "target_untracked") {
          const absProbe = join(args.repoRoot, target.path);
          const exists = yield* fs.exists(absProbe);
          return denied(
            check.entryId,
            exists ? "target_untracked" : "target_missing",
          );
        }
        if (
          r === "target_missing" ||
          r === "target_is_submodule" ||
          r === "source_is_symlink" ||
          r === "source_not_regular_file" ||
          r === "source_digest_mismatch" ||
          r === "source_size_mismatch" ||
          r === "mode_mismatch" ||
          r === "invalid_path" ||
          r === "oversize_input" ||
          r === "working_tree_mismatch" ||
          r === "source_is_hardlink" ||
          r === "register_self_target" ||
          r === "duplicate_target" ||
          r === "batch_limit_exceeded" ||
          r === "glob_target" ||
          r === "group_target"
        ) {
          return denied(check.entryId, r);
        }
        return failed(r);
      }
      const head = headE.right;
      const headMode = asTrackedMode(head.mode);
      if (headMode === null) {
        if (head.mode === "160000") {
          return denied(check.entryId, "target_is_submodule");
        }
        if (head.mode === "120000") {
          return denied(check.entryId, "source_is_symlink");
        }
        return denied(check.entryId, "mode_mismatch");
      }
      if (headMode !== target.mode) {
        return denied(check.entryId, "mode_mismatch");
      }
      if (head.blobSha1 !== target.blobSha1) {
        return denied(check.entryId, "source_digest_mismatch");
      }
      if (head.size !== target.byteLength) {
        return denied(check.entryId, "source_size_mismatch");
      }

      const absPath = join(args.repoRoot, target.path);
      const lstE = yield* Effect.either(fs.lstat(absPath));
      if (lstE._tag === "Left") {
        return denied(check.entryId, "target_missing");
      }
      const pre = mapFsPreflight(lstE.right);
      if (pre !== null) {
        return denied(check.entryId, pre);
      }
      if (lstE.right.size !== target.byteLength) {
        return denied(check.entryId, "source_size_mismatch");
      }

      const readE = yield* Effect.either(
        fs.readFile(absPath, MAX_INPUT_BYTES),
      );
      if (readE._tag === "Left") {
        if (readE.left.reason === "oversize_input") {
          return denied(check.entryId, "oversize_input");
        }
        return denied(check.entryId, "target_missing");
      }
      const bytes = readE.right;
      if (bytes.byteLength !== target.byteLength) {
        return denied(check.entryId, "source_size_mismatch");
      }
      const liveSha = gitBlobSha1(bytes);
      if (liveSha !== target.blobSha1) {
        return denied(check.entryId, "working_tree_mismatch");
      }

      yield* probe.record("preflight_ok");
      captured.push({
        target,
        absPath,
        bytes,
        posixMode: modeToPosix(target.mode),
      });
    }

    // --- Mutation: delete only after complete batch passed ---
    const removed: CapturedTarget[] = [];
    for (let i = 0; i < captured.length; i += 1) {
      const item = captured[i]!;
      yield* probe.record("unlink_attempt");
      const failInject = yield* probe.count("inject_fail_after");
      if (failInject > 0 && removed.length + 1 >= failInject) {
        yield* probe.record("inject_fail_fired");
        // Restore anything already removed, then fail closed
        const restore = yield* restoreAll(fs, probe, removed);
        if (restore !== null) return failed(restore);
        return failed("mutation_rejected");
      }
      const unE = yield* Effect.either(fs.unlink(item.absPath));
      if (unE._tag === "Left") {
        const restore = yield* restoreAll(fs, probe, removed);
        if (restore !== null) return failed(restore);
        return failed(unE.left.reason);
      }
      yield* probe.record("unlink");
      removed.push(item);
    }

    // Verify exact approved files are absent; do not remove parents
    for (const item of removed) {
      const still = yield* fs.exists(item.absPath);
      if (still) {
        const restore = yield* restoreAll(fs, probe, removed);
        if (restore !== null) return failed(restore);
        return failed("mutation_rejected");
      }
      // Parent directory must remain
      const parentOk = yield* fs.parentDirExists(item.absPath);
      if (!parentOk) {
        const restore = yield* restoreAll(fs, probe, removed);
        if (restore !== null) return failed(restore);
        return failed("internal_failed");
      }
    }

    yield* probe.record("tracked_delete_completed");
    return {
      schemaVersion: 1 as const,
      _tag: "Completed" as const,
      entryId: check.entryId,
      actionKind: "tracked_delete" as const,
      registerSha256: auth.registerSha256,
      recoveryCommitSha,
      targets: approvedTargets.map((t) => ({
        path: t.path,
        blobSha1: t.blobSha1,
        byteLength: t.byteLength,
        mode: t.mode,
      })),
    };
  }).pipe(
    Effect.catchAllDefect(() => Effect.succeed(failed("internal_failed"))),
  );
}

function restoreAll(
  fs: {
    readonly exists: (path: string) => Effect.Effect<boolean>;
    readonly createFile: (
      path: string,
      data: Uint8Array,
      mode: number,
    ) => Effect.Effect<void, PolicyFsError>;
  },
  probe: {
    readonly record: (op: string) => Effect.Effect<void>;
  },
  removed: readonly CapturedTarget[],
): Effect.Effect<DenialReason | null> {
  return Effect.gen(function* () {
    // Restore in reverse removal order
    for (let i = removed.length - 1; i >= 0; i -= 1) {
      const item = removed[i]!;
      const exists = yield* fs.exists(item.absPath);
      if (!exists) {
        const w = yield* Effect.either(
          fs.createFile(item.absPath, item.bytes, item.posixMode),
        );
        if (w._tag === "Left") {
          yield* probe.record("restore_failed");
          return "interrupted" as DenialReason;
        }
        yield* probe.record("restore");
      }
    }
    return null;
  });
}

/** Exported for unit tests that assert PolicyGitError tagging. */
export function policyGit(reason: DenialReason): PolicyGitError {
  return new PolicyGitError(reason);
}
