import { Context, Effect, Layer } from "effect";
import type { DenialReason } from "./schema.js";

export type FileStat = {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly size: number;
  readonly nlink: number;
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

export class FileSystem extends Context.Tag("FileSystem")<
  FileSystem,
  {
    readonly readFile: (
      path: string,
      maxBytes: number,
    ) => Effect.Effect<Uint8Array, PolicyFsError>;
    readonly writeExclusive: (
      path: string,
      data: Uint8Array,
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
