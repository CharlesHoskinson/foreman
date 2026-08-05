import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { MAX_INPUT_BYTES } from "@foreman/core";
import { admitCheck } from "./admit.js";
import { loadCommittedAuthority, mapAuthorityError } from "./authority.js";
import {
  Clock,
  FileSystem,
  GitIdentity,
  MutationProbe,
  sameFileIdentity,
  type FileStat,
  type PolicyFsError,
} from "./services.js";
import type {
  DenialReason,
  TrackedDeleteResult,
  TrackedDeleteTarget,
  TrackedFileMode,
} from "./schema.js";

export type DeleteTrackedArgs = {
  readonly repoRoot: string;
  readonly request: AdmissionRequestLike;
};

type AdmissionRequestLike = {
  readonly schemaVersion: 1;
  readonly entryId: string;
};

type ChainEntry = {
  readonly path: string;
  readonly stat: FileStat;
};

type CapturedTarget = {
  readonly target: TrackedDeleteTarget;
  readonly absPath: string;
  readonly bytes: Uint8Array;
  readonly posixMode: number;
  readonly identity: FileStat;
  readonly chain: readonly ChainEntry[];
};

type QuarantinedTarget = CapturedTarget & {
  readonly quarantinePath: string;
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

/** Map live st_mode execute bits to the approved git file mode. */
function liveMatchesApprovedMode(
  stat: FileStat,
  approved: TrackedFileMode,
): boolean {
  if (!stat.isFile || stat.isDirectory || stat.isSymbolicLink) return false;
  const exec = (stat.mode & 0o111) !== 0;
  return approved === "100755" ? exec : !exec;
}

function mapFsPreflight(stat: FileStat): DenialReason | null {
  if (stat.isSymbolicLink) return "source_is_symlink";
  if (stat.isDirectory) return "source_not_regular_file";
  if (!stat.isFile) return "source_not_regular_file";
  if (stat.nlink > 1) return "source_is_hardlink";
  return null;
}

function mapGitDenial(r: DenialReason): "denied" | "failed" {
  if (
    r === "target_missing" ||
    r === "target_untracked" ||
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
    r === "group_target" ||
    r === "authority_dirty"
  ) {
    return "denied";
  }
  return "failed";
}

type BoundChain =
  | { readonly ok: true; readonly absPath: string; readonly chain: ChainEntry[] }
  | { readonly ok: false; readonly reason: DenialReason };

/**
 * Bind repository root and every parent directory of relativePath. Reject
 * ancestor symlinks and non-directory parents. Returns the absolute target
 * path and the chain (root + intermediate dirs) for later identity recheck.
 */
function bindPathChain(
  fs: {
    readonly lstat: (path: string) => Effect.Effect<FileStat, PolicyFsError>;
  },
  repoRoot: string,
  relativePath: string,
): Effect.Effect<BoundChain> {
  return Effect.gen(function* () {
    const chain: ChainEntry[] = [];
    const rootE = yield* Effect.either(fs.lstat(repoRoot));
    if (rootE._tag === "Left") {
      return { ok: false as const, reason: "invalid_path" as DenialReason };
    }
    const rootStat = rootE.right;
    if (rootStat.isSymbolicLink) {
      return { ok: false as const, reason: "source_is_symlink" as DenialReason };
    }
    if (!rootStat.isDirectory) {
      return { ok: false as const, reason: "invalid_path" as DenialReason };
    }
    chain.push({ path: repoRoot, stat: rootStat });

    const segments = relativePath.split("/");
    let cur = repoRoot;
    for (let i = 0; i < segments.length - 1; i += 1) {
      cur = join(cur, segments[i]!);
      const stE = yield* Effect.either(fs.lstat(cur));
      if (stE._tag === "Left") {
        return { ok: false as const, reason: "target_missing" as DenialReason };
      }
      const st = stE.right;
      if (st.isSymbolicLink) {
        return {
          ok: false as const,
          reason: "source_is_symlink" as DenialReason,
        };
      }
      if (!st.isDirectory) {
        return {
          ok: false as const,
          reason: "source_not_regular_file" as DenialReason,
        };
      }
      chain.push({ path: cur, stat: st });
    }
    return {
      ok: true as const,
      absPath: join(repoRoot, relativePath),
      chain,
    };
  });
}

function recheckPathChain(
  fs: {
    readonly lstat: (path: string) => Effect.Effect<FileStat, PolicyFsError>;
  },
  chain: readonly ChainEntry[],
): Effect.Effect<DenialReason | null> {
  return Effect.gen(function* () {
    for (const entry of chain) {
      const stE = yield* Effect.either(fs.lstat(entry.path));
      if (stE._tag === "Left") return "working_tree_mismatch";
      const st = stE.right;
      if (st.isSymbolicLink) return "source_is_symlink";
      if (!sameFileIdentity(entry.stat, st)) return "working_tree_mismatch";
    }
    return null;
  });
}

/**
 * Live tracked_delete executor: admit → pin-commit preflight entire batch →
 * revalidate → quarantine via rename → unlink quarantine only after full
 * success → all-or-rollback on typed failure, defect, or interruption.
 * Never shells out with caller-selected commands. Host failures are injected
 * only through the FileSystem seam (no production MutationProbe control).
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
    const pinCommit = auth.snapshot.commitC;

    // --- Preflight: pin HEAD, verify every target before any mutation ---
    const headPin = yield* Effect.either(
      git.assertHeadCommit(args.repoRoot, pinCommit),
    );
    if (headPin._tag === "Left") {
      return denied(check.entryId, headPin.left.reason);
    }

    const captured: CapturedTarget[] = [];
    for (const target of approvedTargets) {
      const headE = yield* Effect.either(
        git.inspectTrackedAtCommit(args.repoRoot, pinCommit, target.path),
      );
      if (headE._tag === "Left") {
        const r = headE.left.reason;
        if (r === "target_untracked") {
          const absProbe = join(args.repoRoot, target.path);
          const exists = yield* fs.exists(absProbe);
          return denied(
            check.entryId,
            exists ? "target_untracked" : "target_missing",
          );
        }
        if (mapGitDenial(r) === "denied") {
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

      // Bind path chain before index/porcelain checks so ancestor symlinks
      // surface as source_is_symlink rather than a generic dirty-tree denial.
      const bound = yield* bindPathChain(fs, args.repoRoot, target.path);
      if (!bound.ok) {
        return denied(check.entryId, bound.reason);
      }
      const { absPath, chain } = bound;

      const idxE = yield* Effect.either(
        git.assertTrackedIndexClean(args.repoRoot, pinCommit, target.path, {
          blobSha1: target.blobSha1,
          mode: target.mode,
        }),
      );
      if (idxE._tag === "Left") {
        const r = idxE.left.reason;
        if (mapGitDenial(r) === "denied") {
          return denied(check.entryId, r);
        }
        return failed(r);
      }

      const capE = yield* Effect.either(
        fs.readFileNoFollow(absPath, MAX_INPUT_BYTES),
      );
      if (capE._tag === "Left") {
        const r = capE.left.reason;
        if (
          r === "source_is_symlink" ||
          r === "source_not_regular_file" ||
          r === "oversize_input" ||
          r === "target_missing"
        ) {
          return denied(check.entryId, r);
        }
        return denied(check.entryId, "target_missing");
      }
      const { bytes, stat } = capE.right;
      const pre = mapFsPreflight(stat);
      if (pre !== null) {
        return denied(check.entryId, pre);
      }
      if (!liveMatchesApprovedMode(stat, target.mode)) {
        return denied(check.entryId, "mode_mismatch");
      }
      if (bytes.byteLength !== target.byteLength || stat.size !== target.byteLength) {
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
        identity: stat,
        chain,
      });
    }

    // --- Final pin + live identity recheck immediately before mutation ---
    const headPin2 = yield* Effect.either(
      git.assertHeadCommit(args.repoRoot, pinCommit),
    );
    if (headPin2._tag === "Left") {
      return denied(check.entryId, headPin2.left.reason);
    }

    for (const item of captured) {
      const chainBad = yield* recheckPathChain(fs, item.chain);
      if (chainBad !== null) {
        return denied(check.entryId, chainBad);
      }
      const idxE = yield* Effect.either(
        git.assertTrackedIndexClean(
          args.repoRoot,
          pinCommit,
          item.target.path,
          {
            blobSha1: item.target.blobSha1,
            mode: item.target.mode,
          },
        ),
      );
      if (idxE._tag === "Left") {
        const r = idxE.left.reason;
        if (mapGitDenial(r) === "denied") {
          return denied(check.entryId, r);
        }
        return failed(r);
      }
      const recapE = yield* Effect.either(
        fs.readFileNoFollow(item.absPath, MAX_INPUT_BYTES),
      );
      if (recapE._tag === "Left") {
        return denied(check.entryId, "working_tree_mismatch");
      }
      const recap = recapE.right;
      if (!sameFileIdentity(item.identity, recap.stat)) {
        return denied(check.entryId, "working_tree_mismatch");
      }
      if (gitBlobSha1(recap.bytes) !== item.target.blobSha1) {
        return denied(check.entryId, "working_tree_mismatch");
      }
      if (!liveMatchesApprovedMode(recap.stat, item.target.mode)) {
        return denied(check.entryId, "mode_mismatch");
      }
    }

    // --- Mutation: uninterruptible quarantine + finalizer rollback ---
    const mutResult = yield* runMutationUninterruptible({
      fs,
      probe,
      captured,
      entryId: check.entryId,
      registerSha256: auth.registerSha256,
      recoveryCommitSha,
      approvedTargets,
    });
    return mutResult;
  }).pipe(
    Effect.catchAllDefect(() => Effect.succeed(failed("internal_failed"))),
  );
}

function runMutationUninterruptible(args: {
  readonly fs: {
    readonly readFileNoFollow: (
      path: string,
      maxBytes: number,
    ) => Effect.Effect<
      { readonly bytes: Uint8Array; readonly stat: FileStat },
      PolicyFsError
    >;
    readonly rename: (
      from: string,
      to: string,
    ) => Effect.Effect<void, PolicyFsError>;
    readonly unlink: (path: string) => Effect.Effect<void, PolicyFsError>;
    readonly exists: (path: string) => Effect.Effect<boolean>;
    readonly parentDirExists: (path: string) => Effect.Effect<boolean>;
    readonly createFile: (
      path: string,
      data: Uint8Array,
      mode: number,
    ) => Effect.Effect<void, PolicyFsError>;
    readonly lstat: (path: string) => Effect.Effect<FileStat, PolicyFsError>;
  };
  readonly probe: {
    readonly record: (op: string) => Effect.Effect<void>;
  };
  readonly captured: readonly CapturedTarget[];
  readonly entryId: string;
  readonly registerSha256: string;
  readonly recoveryCommitSha: string;
  readonly approvedTargets: readonly TrackedDeleteTarget[];
}): Effect.Effect<TrackedDeleteResult> {
  const state: {
    quarantined: QuarantinedTarget[];
    completed: boolean;
    retainedRecovery: boolean;
  } = {
    quarantined: [],
    completed: false,
    retainedRecovery: false,
  };

  const body = Effect.gen(function* () {
    for (let i = 0; i < args.captured.length; i += 1) {
      const item = args.captured[i]!;
      yield* args.probe.record("unlink_attempt");

      // Recheck chain + identity at the irreversible boundary.
      const chainBad = yield* recheckPathChain(args.fs, item.chain);
      if (chainBad !== null) {
        const restore = yield* restoreQuarantines(
          args.fs,
          args.probe,
          state.quarantined,
        );
        if (restore === "retained") state.retainedRecovery = true;
        if (restore === "failed" || restore === "retained") {
          return failed("interrupted");
        }
        return failed(chainBad === "source_is_symlink" ? chainBad : "mutation_rejected");
      }
      const liveE = yield* Effect.either(
        args.fs.readFileNoFollow(item.absPath, MAX_INPUT_BYTES),
      );
      if (liveE._tag === "Left" || !sameFileIdentity(item.identity, liveE.right.stat)) {
        const restore = yield* restoreQuarantines(
          args.fs,
          args.probe,
          state.quarantined,
        );
        if (restore === "retained") state.retainedRecovery = true;
        if (restore === "failed" || restore === "retained") {
          return failed("interrupted");
        }
        return failed("mutation_rejected");
      }

      const qName = `.foreman-td-q-${args.entryId}-${i}-${randomBytes(8).toString("hex")}`;
      const quarantinePath = join(dirname(item.absPath), qName);
      const renE = yield* Effect.either(
        args.fs.rename(item.absPath, quarantinePath),
      );
      if (renE._tag === "Left") {
        const restore = yield* restoreQuarantines(
          args.fs,
          args.probe,
          state.quarantined,
        );
        if (restore === "retained") state.retainedRecovery = true;
        if (restore === "failed" || restore === "retained") {
          return failed("interrupted");
        }
        return failed(renE.left.reason);
      }

      // Post-rename identity: same inode must now live at quarantine path.
      const qE = yield* Effect.either(
        args.fs.readFileNoFollow(quarantinePath, MAX_INPUT_BYTES),
      );
      if (
        qE._tag === "Left" ||
        !sameFileIdentity(item.identity, qE.right.stat) ||
        gitBlobSha1(qE.right.bytes) !== item.target.blobSha1
      ) {
        // Best-effort: try to put it back if original path free.
        const back = yield* Effect.either(
          args.fs.rename(quarantinePath, item.absPath),
        );
        if (back._tag === "Left") {
          state.retainedRecovery = true;
          const restore = yield* restoreQuarantines(
            args.fs,
            args.probe,
            state.quarantined,
          );
          if (restore === "retained") state.retainedRecovery = true;
          return failed("interrupted");
        }
        const restore = yield* restoreQuarantines(
          args.fs,
          args.probe,
          state.quarantined,
        );
        if (restore === "retained") state.retainedRecovery = true;
        if (restore === "failed" || restore === "retained") {
          return failed("interrupted");
        }
        return failed("mutation_rejected");
      }

      const chainAfter = yield* recheckPathChain(args.fs, item.chain);
      if (chainAfter !== null) {
        const back = yield* Effect.either(
          args.fs.rename(quarantinePath, item.absPath),
        );
        if (back._tag === "Left") state.retainedRecovery = true;
        const restore = yield* restoreQuarantines(
          args.fs,
          args.probe,
          state.quarantined,
        );
        if (restore === "retained") state.retainedRecovery = true;
        if (restore === "failed" || restore === "retained" || back._tag === "Left") {
          return failed("interrupted");
        }
        return failed("mutation_rejected");
      }

      yield* args.probe.record("unlink");
      state.quarantined.push({ ...item, quarantinePath });
    }

    // All targets quarantined: permanently drop quarantine files.
    for (const item of state.quarantined) {
      const unE = yield* Effect.either(args.fs.unlink(item.quarantinePath));
      if (unE._tag === "Left") {
        // Quarantine retained as recovery artifact; originals already absent.
        state.retainedRecovery = true;
        return failed("interrupted");
      }
      const still = yield* args.fs.exists(item.absPath);
      if (still) {
        state.retainedRecovery = true;
        return failed("mutation_rejected");
      }
      const parentOk = yield* args.fs.parentDirExists(item.absPath);
      if (!parentOk) {
        state.retainedRecovery = true;
        return failed("internal_failed");
      }
    }

    state.completed = true;
    yield* args.probe.record("tracked_delete_completed");
    return {
      schemaVersion: 1 as const,
      _tag: "Completed" as const,
      entryId: args.entryId,
      actionKind: "tracked_delete" as const,
      registerSha256: args.registerSha256,
      recoveryCommitSha: args.recoveryCommitSha,
      targets: args.approvedTargets.map((t) => ({
        path: t.path,
        blobSha1: t.blobSha1,
        byteLength: t.byteLength,
        mode: t.mode,
      })),
    } satisfies TrackedDeleteResult;
  });

  // Uninterruptible acquisition/finalization: after first quarantine, every
  // exit path (typed return already restores; defect/interrupt use onExit).
  return Effect.uninterruptible(
    body.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          if (state.completed || state.quarantined.length === 0) {
            return;
          }
          // Defect or fiber interruption after partial quarantine.
          if (exit._tag === "Failure") {
            const restore = yield* restoreQuarantines(
              args.fs,
              args.probe,
              state.quarantined,
            );
            if (restore === "retained" || restore === "failed") {
              state.retainedRecovery = true;
            }
            // Clear so we do not double-restore if catchAllDefect also fires.
            state.quarantined = [];
          }
        }),
      ),
      Effect.catchAllDefect(() => {
        // If onExit already restored, quarantined is empty.
        return Effect.gen(function* () {
          if (state.quarantined.length > 0 && !state.completed) {
            const restore = yield* restoreQuarantines(
              args.fs,
              args.probe,
              state.quarantined,
            );
            if (restore === "retained" || restore === "failed") {
              return failed("interrupted");
            }
            state.quarantined = [];
          }
          return failed("internal_failed");
        });
      }),
    ),
  );
}

/**
 * Restore quarantined files to original paths. Never overwrites an existing
 * concurrent replacement — retains the quarantine as a recovery artifact.
 * Returns null on full success, "failed" on restore error, "retained" when a
 * concurrent replacement blocked restore of at least one target.
 */
function restoreQuarantines(
  fs: {
    readonly exists: (path: string) => Effect.Effect<boolean>;
    readonly rename: (
      from: string,
      to: string,
    ) => Effect.Effect<void, PolicyFsError>;
    readonly createFile: (
      path: string,
      data: Uint8Array,
      mode: number,
    ) => Effect.Effect<void, PolicyFsError>;
    readonly readFileNoFollow: (
      path: string,
      maxBytes: number,
    ) => Effect.Effect<
      { readonly bytes: Uint8Array; readonly stat: FileStat },
      PolicyFsError
    >;
    readonly unlink: (path: string) => Effect.Effect<void, PolicyFsError>;
  },
  probe: {
    readonly record: (op: string) => Effect.Effect<void>;
  },
  quarantined: readonly QuarantinedTarget[],
): Effect.Effect<"ok" | "failed" | "retained"> {
  return Effect.gen(function* () {
    let retained = false;
    for (let i = quarantined.length - 1; i >= 0; i -= 1) {
      const item = quarantined[i]!;
      const origExists = yield* fs.exists(item.absPath);
      if (origExists) {
        // Concurrent replacement — never overwrite; keep quarantine.
        yield* probe.record("restore_retained");
        retained = true;
        continue;
      }
      const qExists = yield* fs.exists(item.quarantinePath);
      if (qExists) {
        const ren = yield* Effect.either(
          fs.rename(item.quarantinePath, item.absPath),
        );
        if (ren._tag === "Left") {
          // Fallback: exclusive create from captured bytes (still no overwrite).
          const cr = yield* Effect.either(
            fs.createFile(item.absPath, item.bytes, item.posixMode),
          );
          if (cr._tag === "Left") {
            yield* probe.record("restore_failed");
            return "failed" as const;
          }
          // Drop quarantine after successful byte restore.
          yield* Effect.either(fs.unlink(item.quarantinePath));
        }
      } else {
        const cr = yield* Effect.either(
          fs.createFile(item.absPath, item.bytes, item.posixMode),
        );
        if (cr._tag === "Left") {
          yield* probe.record("restore_failed");
          return "failed" as const;
        }
      }
      // Verify exact bytes and mode independent of umask.
      const verE = yield* Effect.either(
        fs.readFileNoFollow(item.absPath, MAX_INPUT_BYTES),
      );
      if (verE._tag === "Left") {
        yield* probe.record("restore_failed");
        return "failed" as const;
      }
      const ver = verE.right;
      if (
        ver.bytes.byteLength !== item.bytes.byteLength ||
        gitBlobSha1(ver.bytes) !== item.target.blobSha1 ||
        (ver.stat.mode & 0o777) !== (item.posixMode & 0o777)
      ) {
        yield* probe.record("restore_failed");
        return "failed" as const;
      }
      yield* probe.record("restore");
    }
    return retained ? ("retained" as const) : ("ok" as const);
  });
}
