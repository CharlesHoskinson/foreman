import { Context, Effect, Layer } from "effect";
import type { DenialReason } from "./schema.js";

/**
 * No-follow file metadata. `mode` is the full st_mode value from fstat/lstat.
 * `dev`/`ino` are stringified so bigint device ids survive JSON-free equality.
 */
export type FileStat = {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly size: number;
  readonly nlink: number;
  readonly mode: number;
  readonly dev: string;
  readonly ino: string;
};

/** Bytes plus identity captured through a no-follow open. */
export type CapturedFile = {
  readonly bytes: Uint8Array;
  readonly stat: FileStat;
};

export class PolicyFsError {
  readonly _tag = "PolicyFsError" as const;
  constructor(readonly reason: DenialReason) {}
}

export class PolicyGitError {
  readonly _tag = "PolicyGitError" as const;
  constructor(readonly reason: DenialReason) {}
}

/** Immutable snapshot of C (HEAD) for non-self-referential approval. */
export type GitCommitSnapshot = {
  /** Approval commit C (resolved HEAD at start). */
  readonly commitC: string;
  readonly treeC: string;
  /** Sole parent P, or null if C does not have exactly one parent. */
  readonly parentP: string | null;
  /** Tree of P, or null. */
  readonly treeP: string | null;
  /**
   * True iff C has exactly one parent and the only path changed P..C is the
   * canonical register path.
   */
  readonly approvalCommitEligible: boolean;
  /**
   * Raw markdown bytes of P:canonical path when readable; null when missing
   * or not applicable. Used only when evaluating approved actions.
   */
  readonly parentBlobBytes: Uint8Array | null;
};

export type HeadTrackedBlob = {
  readonly mode: string;
  readonly blobSha1: string;
  readonly size: number;
};

export class FileSystem extends Context.Tag("FileSystem")<
  FileSystem,
  {
    readonly readFile: (
      path: string,
      maxBytes: number,
    ) => Effect.Effect<Uint8Array, PolicyFsError>;
    /**
     * Open path with O_NOFOLLOW, fstat, and read exact bytes via the descriptor.
     * Rejects symlinks at the final component.
     */
    readonly readFileNoFollow: (
      path: string,
      maxBytes: number,
    ) => Effect.Effect<CapturedFile, PolicyFsError>;
    readonly writeExclusive: (
      path: string,
      data: Uint8Array,
    ) => Effect.Effect<void, PolicyFsError>;
    /**
     * Create a new file exclusively with explicit mode (fchmod after write so
     * umask cannot strip bits), full write loop, fsync, and identity verify.
     * Fails if the path already exists — never overwrites.
     */
    readonly createFile: (
      path: string,
      data: Uint8Array,
      mode: number,
    ) => Effect.Effect<void, PolicyFsError>;
    readonly lstat: (path: string) => Effect.Effect<FileStat, PolicyFsError>;
    readonly stat: (path: string) => Effect.Effect<FileStat, PolicyFsError>;
    readonly exists: (path: string) => Effect.Effect<boolean>;
    readonly unlink: (path: string) => Effect.Effect<void, PolicyFsError>;
    readonly rename: (
      from: string,
      to: string,
    ) => Effect.Effect<void, PolicyFsError>;
    readonly copyFile: (
      from: string,
      to: string,
    ) => Effect.Effect<void, PolicyFsError>;
    readonly fsyncPath: (path: string) => Effect.Effect<void, PolicyFsError>;
    readonly parentDirExists: (path: string) => Effect.Effect<boolean>;
  }
>() {}

export class GitIdentity extends Context.Tag("GitIdentity")<
  GitIdentity,
  {
    /**
     * Resolve HEAD once as C, parents, trees, path cleanliness, blob bytes,
     * and approval-commit eligibility. Re-check HEAD is still C at end.
     */
    readonly snapshotAuthority: (
      repoRoot: string,
      relativePath: string,
    ) => Effect.Effect<
      {
        readonly snapshot: GitCommitSnapshot;
        readonly commitBlobBytes: Uint8Array;
        readonly worktreeBytes: Uint8Array;
      },
      PolicyGitError
    >;
    /**
     * Resolve one path at a pinned commit (not symbolic HEAD): mode, blob
     * SHA-1, and blob size. Fails with target_untracked when absent.
     */
    readonly inspectTrackedAtCommit: (
      repoRoot: string,
      commitSha: string,
      relativePath: string,
    ) => Effect.Effect<HeadTrackedBlob, PolicyGitError>;
    /**
     * Require that symbolic HEAD still equals the captured approval commit.
     */
    readonly assertHeadCommit: (
      repoRoot: string,
      commitSha: string,
    ) => Effect.Effect<void, PolicyGitError>;
    /**
     * Require index and porcelain cleanliness for one path against the pinned
     * commit identity (rejects staged changes and dirty worktree entries).
     */
    readonly assertTrackedIndexClean: (
      repoRoot: string,
      commitSha: string,
      relativePath: string,
      expected: { readonly blobSha1: string; readonly mode: string },
    ) => Effect.Effect<void, PolicyGitError>;
  }
>() {}

export class Clock extends Context.Tag("Clock")<
  Clock,
  {
    readonly nowMs: () => Effect.Effect<number>;
  }
>() {}

export class MutationProbe extends Context.Tag("MutationProbe")<
  MutationProbe,
  {
    readonly record: (op: string) => Effect.Effect<void>;
    readonly count: (op: string) => Effect.Effect<number>;
  }
>() {}

export const liveClock = Layer.succeed(Clock, {
  nowMs: () => Effect.sync(() => Date.now()),
});

export const noopMutationProbe = Layer.succeed(MutationProbe, {
  record: () => Effect.void,
  count: () => Effect.succeed(0),
});

export function makeMemoryMutationProbe(): {
  layer: Layer.Layer<MutationProbe>;
  counts: Map<string, number>;
} {
  const counts = new Map<string, number>();
  return {
    counts,
    layer: Layer.succeed(MutationProbe, {
      record: (op) =>
        Effect.sync(() => {
          counts.set(op, (counts.get(op) ?? 0) + 1);
        }),
      count: (op) => Effect.sync(() => counts.get(op) ?? 0),
    }),
  };
}

/**
 * True when two FileStat values name the same directory entry identity.
 * Directory parents compare only device+inode (size changes as children move).
 * Regular files also compare size, nlink, and permission bits.
 */
export function sameFileIdentity(a: FileStat, b: FileStat): boolean {
  if (a.isSymbolicLink || b.isSymbolicLink) return false;
  if (a.isDirectory && b.isDirectory) {
    return a.dev === b.dev && a.ino === b.ino;
  }
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.nlink === b.nlink &&
    (a.mode & 0o777) === (b.mode & 0o777) &&
    a.isFile === b.isFile &&
    a.isDirectory === b.isDirectory
  );
}
