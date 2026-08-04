/**
 * Effect filesystem seam for installed-runtime verification.
 * Live layer uses descriptor-bound reads and identity rechecks.
 * Tests inject deterministic identity-change, retarget, and open-count seams.
 */

import { Context, Effect, Layer } from "effect";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
} from "node:fs";
import type { Stats } from "node:fs";

/**
 * Stable identity for files and directories. Includes mtime/ctime (not atime)
 * so Windows and inode-weak filesystems can still detect replacement.
 */
export type InstallFileIdentity = {
  readonly dev: string;
  readonly ino: string;
  readonly size: number;
  readonly nlink: number;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
};

export type InstallOpenFile = {
  readonly identity: InstallFileIdentity;
  readonly readBounded: (
    maxBytes: number,
  ) => Effect.Effect<Uint8Array, InstallFsError>;
  readonly recheckIdentity: () => Effect.Effect<
    InstallFileIdentity,
    InstallFsError
  >;
};

export class InstallFsError {
  readonly _tag = "InstallFsError" as const;
  constructor(
    readonly kind:
      | "missing"
      | "unreadable"
      | "oversize"
      | "not_resolved"
      | "identity_changed"
      | "hard_linked"
      | "internal",
  ) {}
}

export class InstallFs extends Context.Tag("InstallFs")<
  InstallFs,
  {
    /** Resolve once (root symlink/junction allowed). */
    readonly resolvePath: (
      path: string,
    ) => Effect.Effect<string, InstallFsError>;
    readonly lstat: (
      path: string,
    ) => Effect.Effect<InstallFileIdentity, InstallFsError>;
    /**
     * Open a path for bounded descriptor-bound read without retaining an
     * unscoped handle outside the callback.
     */
    readonly withOpenFile: <A, E>(
      path: string,
      use: (file: InstallOpenFile) => Effect.Effect<A, E | InstallFsError>,
    ) => Effect.Effect<A, E | InstallFsError>;
    readonly readdirNames: (
      path: string,
    ) => Effect.Effect<readonly string[], InstallFsError>;
  }
>() {}

function identityFromStats(s: Stats): InstallFileIdentity {
  return {
    dev: String(s.dev),
    ino: String(s.ino),
    size: s.size,
    nlink: s.nlink,
    mode: s.mode,
    mtimeMs: s.mtimeMs,
    ctimeMs: s.ctimeMs,
    isFile: s.isFile(),
    isDirectory: s.isDirectory(),
    isSymbolicLink: s.isSymbolicLink(),
  };
}

export function identitiesEqual(
  a: InstallFileIdentity,
  b: InstallFileIdentity,
): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.nlink === b.nlink &&
    a.mode === b.mode &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs &&
    a.isFile === b.isFile &&
    a.isDirectory === b.isDirectory &&
    a.isSymbolicLink === b.isSymbolicLink
  );
}

function openFlags(): number {
  const nofollow =
    typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
  return fsConstants.O_RDONLY | nofollow;
}

function readFdBoundedSync(fd: number, maxBytes: number): Uint8Array {
  const cap = maxBytes + 1;
  const buf = Buffer.allocUnsafe(cap);
  let offset = 0;
  while (offset < cap) {
    const n = readSync(fd, buf, offset, cap - offset, offset);
    if (n === 0) break;
    offset += n;
  }
  if (offset > maxBytes) {
    throw new InstallFsError("oversize");
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, offset);
}

export const liveInstallFs: Layer.Layer<InstallFs> = Layer.succeed(InstallFs, {
  resolvePath: (path) =>
    Effect.try({
      try: () => realpathSync(path),
      catch: () => new InstallFsError("not_resolved"),
    }),
  lstat: (path) =>
    Effect.try({
      try: () => identityFromStats(lstatSync(path)),
      catch: (e) => {
        const err = e as NodeJS.ErrnoException;
        if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
          return new InstallFsError("missing");
        }
        return new InstallFsError("unreadable");
      },
    }),
  withOpenFile: (path, use) =>
    Effect.acquireUseRelease(
      Effect.try({
        try: () => {
          const fd = openSync(path, openFlags());
          try {
            const st = fstatSync(fd);
            return { fd, identity: identityFromStats(st) };
          } catch (e) {
            closeSync(fd);
            throw e;
          }
        },
        catch: (e) => {
          if (e instanceof InstallFsError) return e;
          const err = e as NodeJS.ErrnoException;
          if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
            return new InstallFsError("missing");
          }
          return new InstallFsError("unreadable");
        },
      }),
      ({ fd, identity }) =>
        use({
          identity,
          readBounded: (maxBytes) =>
            Effect.try({
              try: () => readFdBoundedSync(fd, maxBytes),
              catch: (e) =>
                e instanceof InstallFsError
                  ? e
                  : new InstallFsError("unreadable"),
            }),
          recheckIdentity: () =>
            Effect.try({
              try: () => identityFromStats(fstatSync(fd)),
              catch: () => new InstallFsError("unreadable"),
            }),
        }),
      ({ fd }) =>
        Effect.sync(() => {
          try {
            closeSync(fd);
          } catch {
            // ignore close errors
          }
        }),
    ),
  readdirNames: (path) =>
    Effect.try({
      try: () => readdirSync(path),
      catch: (e) => {
        const err = e as NodeJS.ErrnoException;
        if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
          return new InstallFsError("missing");
        }
        return new InstallFsError("unreadable");
      },
    }),
});

/**
 * Build a memory/test InstallFs. Maps and counters may be mutated by tests
 * during verification to inject retarget and second-open seams.
 */
export type MemoryNode =
  | {
      readonly kind: "file";
      /** Bytes for open index 0 (and later if no alternate). */
      readonly bytes: Uint8Array;
      /**
       * When set, the Nth open (0-based) of this path returns this sequence
       * entry when present; otherwise falls back to `bytes`.
       */
      readonly bytesByOpen?: readonly Uint8Array[];
      readonly identity: InstallFileIdentity;
      readonly recheckIdentity?: InstallFileIdentity;
      readonly unreadable?: boolean;
      /** Mutable open counter for seam proofs. */
      readonly openCount?: { count: number };
    }
  | {
      readonly kind: "dir";
      readonly identity: InstallFileIdentity;
      /** Optional alternate identity after first lstat (identity-change seam). */
      readonly identityAfterLstats?: number;
      readonly identityChanged?: InstallFileIdentity;
      readonly names: readonly string[];
      readonly unreadable?: boolean;
      readonly lstatCount?: { count: number };
    }
  | {
      readonly kind: "symlink";
      readonly identity: InstallFileIdentity;
      readonly target: string;
    };

export type MemoryInstallFsHooks = {
  /**
   * Called after each successful resolvePath with the 1-based call count for
   * that path. Tests may retarget resolveMap here.
   */
  readonly afterResolve?: (path: string, callCount: number) => void;
};

/**
 * Canonical key for synthetic memory-map lookup only.
 * Treats `\` and `/` as equivalent separators so Windows path.join results
 * match slash-form test seeds. Preserves drive letters, Unicode, spaces, and
 * ordinary characters. Does not call the live filesystem.
 */
function memoryPathKey(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * Look up a synthetic map entry under either separator form of `path`.
 *
 * Collision rule (deterministic): among all stored keys that share the same
 * canonical form as `path`, return the **last insertion-order** entry.
 * `Map` preserves insertion order; `set` of a new separator form appends, so a
 * hook mutation with either `\` or `/` wins over an earlier seed with the other
 * form. Same-key `set` updates in place and is still observed.
 */
function memoryMapGet<V>(map: Map<string, V>, path: string): V | undefined {
  const key = memoryPathKey(path);
  let found: V | undefined;
  let hit = false;
  for (const [stored, value] of map) {
    if (memoryPathKey(stored) === key) {
      found = value;
      hit = true;
    }
  }
  return hit ? found : undefined;
}

function memoryMapHas(map: Map<string, unknown>, path: string): boolean {
  return memoryMapGet(map, path) !== undefined;
}

export function makeMemoryInstallFs(args: {
  readonly resolveMap?: Map<string, string>;
  readonly nodes: Map<string, MemoryNode>;
  readonly hooks?: MemoryInstallFsHooks;
}): Layer.Layer<InstallFs> {
  const resolveMap = args.resolveMap ?? new Map<string, string>();
  const nodes = args.nodes;
  const resolveCounts = new Map<string, number>();
  const hooks = args.hooks;

  return Layer.succeed(InstallFs, {
    resolvePath: (path) =>
      Effect.gen(function* () {
        const key = memoryPathKey(path);
        let target: string | undefined;
        if (memoryMapHas(resolveMap, path)) {
          // Return the stored synthetic target string as seeded (not rewritten).
          target = memoryMapGet(resolveMap, path);
        } else if (memoryMapHas(nodes, path)) {
          target = path;
        }
        if (target === undefined) {
          return yield* Effect.fail(new InstallFsError("not_resolved"));
        }
        // Count under the canonical key so mixed-separator calls stay deterministic.
        const n = (resolveCounts.get(key) ?? 0) + 1;
        resolveCounts.set(key, n);
        // Return the pre-hook target so call N is stable; hooks may retarget
        // the map for call N+1 (end re-resolve / retarget control).
        const resolved = target;
        if (hooks?.afterResolve) {
          hooks.afterResolve(path, n);
        }
        return resolved;
      }),
    lstat: (path) =>
      Effect.gen(function* () {
        const n = memoryMapGet(nodes, path);
        if (!n) return yield* Effect.fail(new InstallFsError("missing"));
        if (n.kind === "dir") {
          if (n.unreadable) {
            return yield* Effect.fail(new InstallFsError("unreadable"));
          }
          if (n.lstatCount) {
            n.lstatCount.count += 1;
            if (
              n.identityAfterLstats !== undefined &&
              n.identityChanged &&
              n.lstatCount.count > n.identityAfterLstats
            ) {
              return n.identityChanged;
            }
          }
          return n.identity;
        }
        if (n.kind === "file" && n.unreadable) {
          return yield* Effect.fail(new InstallFsError("unreadable"));
        }
        return n.identity;
      }),
    withOpenFile: (path, use) =>
      Effect.gen(function* () {
        const n = memoryMapGet(nodes, path);
        if (!n) return yield* Effect.fail(new InstallFsError("missing"));
        if (n.kind !== "file") {
          return yield* Effect.fail(new InstallFsError("unreadable"));
        }
        if (n.unreadable) {
          return yield* Effect.fail(new InstallFsError("unreadable"));
        }
        const openIndex = n.openCount ? n.openCount.count : 0;
        if (n.openCount) {
          n.openCount.count += 1;
        }
        let payload = n.bytes;
        if (n.bytesByOpen && n.bytesByOpen[openIndex] !== undefined) {
          payload = n.bytesByOpen[openIndex]!;
        }
        const file: InstallOpenFile = {
          identity: n.identity,
          readBounded: (maxBytes) =>
            Effect.gen(function* () {
              if (payload.byteLength > maxBytes) {
                return yield* Effect.fail(new InstallFsError("oversize"));
              }
              return payload;
            }),
          recheckIdentity: () =>
            Effect.succeed(n.recheckIdentity ?? n.identity),
        };
        return yield* use(file);
      }),
    readdirNames: (path) =>
      Effect.gen(function* () {
        const n = memoryMapGet(nodes, path);
        if (!n) return yield* Effect.fail(new InstallFsError("missing"));
        if (n.kind !== "dir") {
          return yield* Effect.fail(new InstallFsError("unreadable"));
        }
        if (n.unreadable) {
          return yield* Effect.fail(new InstallFsError("unreadable"));
        }
        return n.names;
      }),
  });
}

export function fileIdentity(partial?: {
  readonly dev?: string;
  readonly ino?: string;
  readonly size?: number;
  readonly nlink?: number;
  readonly mode?: number;
  readonly mtimeMs?: number;
  readonly ctimeMs?: number;
}): InstallFileIdentity {
  return {
    dev: partial?.dev ?? "1",
    ino: partial?.ino ?? "1",
    size: partial?.size ?? 0,
    nlink: partial?.nlink ?? 1,
    mode: partial?.mode ?? 0o100644,
    mtimeMs: partial?.mtimeMs ?? 1_000,
    ctimeMs: partial?.ctimeMs ?? 1_000,
    isFile: true,
    isDirectory: false,
    isSymbolicLink: false,
  };
}

export function dirIdentity(partial?: {
  readonly dev?: string;
  readonly ino?: string;
  readonly mtimeMs?: number;
  readonly ctimeMs?: number;
  readonly nlink?: number;
}): InstallFileIdentity {
  return {
    dev: partial?.dev ?? "1",
    ino: partial?.ino ?? "2",
    size: 0,
    nlink: partial?.nlink ?? 2,
    mode: 0o040755,
    mtimeMs: partial?.mtimeMs ?? 1_000,
    ctimeMs: partial?.ctimeMs ?? 1_000,
    isFile: false,
    isDirectory: true,
    isSymbolicLink: false,
  };
}

export function linkIdentity(partial?: {
  readonly dev?: string;
  readonly ino?: string;
  readonly mtimeMs?: number;
  readonly ctimeMs?: number;
}): InstallFileIdentity {
  return {
    dev: partial?.dev ?? "1",
    ino: partial?.ino ?? "3",
    size: 0,
    nlink: 1,
    mode: 0o120777,
    mtimeMs: partial?.mtimeMs ?? 1_000,
    ctimeMs: partial?.ctimeMs ?? 1_000,
    isFile: false,
    isDirectory: false,
    isSymbolicLink: true,
  };
}
