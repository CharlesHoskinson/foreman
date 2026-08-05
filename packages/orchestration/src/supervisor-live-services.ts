/**
 * Live Node.js bindings for the one-shot resume supervisor (R5D).
 *
 * Directory operations bind to stable identities via no-follow directory
 * descriptors and `/proc/self/fd/<fd>` anchors. Pathnames are never reused
 * after validation without an open identity. When the host cannot provide
 * that primitive, operations fail closed (no unbound pathname fallback).
 */

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmdirSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import {
  decodeRunId,
  makeLiveRunJournalLayer,
  MAX_REPLAY_INPUT_BYTES,
  replayNdjsonBytes,
  type RunId,
  type ReplayRecord,
  RunJournal,
} from "@foreman/event-log";
import {
  RunDiscovery,
  RunLease,
  TypedJournalReader,
} from "./supervisor.js";
import {
  makeLiveWorktreeRestore,
  WorktreeRestore,
} from "./resume-worktree-restore.js";
import {
  makeLiveQueueSubmitter,
  QueueSubmitter,
} from "./resume-queue-execution.js";
import {
  liveProcessExec,
  liveQueueServices,
} from "./queue-services.js";
import {
  liveResumeSafetyServices,
  ResumeLockProbe,
  ResumeProcessProbe,
} from "./resume-safety-services.js";

export type LiveSupervisorContext = {
  /** Preflighted absolute state root (FOREMAN_HOME equivalent). */
  readonly stateRoot: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly shellBinary?: string;
  readonly laneRunScript?: string;
};

// ---------------------------------------------------------------------------
// Errors / path helpers
// ---------------------------------------------------------------------------

function isEnoent(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "ENOENT"
  );
}

function isEexist(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "EEXIST"
  );
}

function isSafeSingleSegment(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0")
  );
}

// ---------------------------------------------------------------------------
// Directory identity + descriptor anchors
// ---------------------------------------------------------------------------

type DirIdentity = {
  readonly dev: number;
  readonly ino: number;
};

type BoundDir = {
  readonly fd: number;
  readonly identity: DirIdentity;
};

function closeQuiet(fd: number | undefined): void {
  if (fd === undefined) return;
  try {
    closeSync(fd);
  } catch {
    /* ignore */
  }
}

function identityOf(st: Stats): DirIdentity {
  return { dev: st.dev, ino: st.ino };
}

function identitiesEqual(a: DirIdentity, b: DirIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/**
 * Open flags for a no-follow directory descriptor. Null when the host
 * cannot express the required primitive.
 */
function dirOpenFlags(): number | null {
  const c = fsConstants as Record<string, number | undefined>;
  if (typeof c.O_DIRECTORY !== "number" || typeof c.O_NOFOLLOW !== "number") {
    return null;
  }
  return fsConstants.O_RDONLY | c.O_DIRECTORY | c.O_NOFOLLOW;
}

function fileOpenFlags(): number | null {
  const c = fsConstants as Record<string, number | undefined>;
  if (typeof c.O_NOFOLLOW !== "number") return null;
  return fsConstants.O_RDONLY | c.O_NOFOLLOW;
}

let anchorSupportCache: boolean | undefined;

/**
 * True when this process can open no-follow directory descriptors and
 * address them through a verified `/proc/self/fd/<fd>` anchor.
 */
export function directoryIdentityAnchorSupported(): boolean {
  if (anchorSupportCache !== undefined) return anchorSupportCache;
  if (process.platform === "win32") {
    anchorSupportCache = false;
    return false;
  }
  if (dirOpenFlags() === null || fileOpenFlags() === null) {
    anchorSupportCache = false;
    return false;
  }
  try {
    const st = lstatSync("/proc/self/fd");
    // On Linux this is a directory (procfs). Require a directory entry.
    anchorSupportCache = st.isDirectory();
  } catch {
    anchorSupportCache = false;
  }
  return anchorSupportCache;
}

/**
 * Return a pathname that names the open directory descriptor without
 * re-walking an untrusted parent. Null when the anchor is unavailable.
 */
function procFdPath(fd: number): string | null {
  if (!directoryIdentityAnchorSupported()) return null;
  if (!Number.isInteger(fd) || fd < 0) return null;
  return `/proc/self/fd/${fd}`;
}

/**
 * Observe a path with lstat (no follow).
 */
function observeDirComponent(
  path: string,
): "missing" | "directory" | "symlink" | "other" {
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch (e) {
    if (isEnoent(e)) return "missing";
    return "other";
  }
  if (st.isSymbolicLink()) return "symlink";
  if (st.isDirectory()) return "directory";
  return "other";
}

function recheckBoundDir(dir: BoundDir): boolean {
  try {
    const st = fstatSync(dir.fd);
    return st.isDirectory() && identitiesEqual(identityOf(st), dir.identity);
  } catch {
    return false;
  }
}

type OpenDirResult =
  | { readonly _tag: "ok"; readonly dir: BoundDir }
  | { readonly _tag: "missing" }
  | { readonly _tag: "bad" };

/**
 * Open a directory by pathname with O_DIRECTORY|O_NOFOLLOW. Does not
 * follow a symlink at the final component. Captures dev/ino from the
 * opened descriptor.
 */
function openBoundDirAtPath(path: string): OpenDirResult {
  const flags = dirOpenFlags();
  if (flags === null || !directoryIdentityAnchorSupported()) {
    return { _tag: "bad" };
  }
  const kind = observeDirComponent(path);
  if (kind === "missing") return { _tag: "missing" };
  if (kind !== "directory") return { _tag: "bad" };
  let fd: number | undefined;
  try {
    fd = openSync(path, flags);
    const st = fstatSync(fd);
    if (!st.isDirectory()) {
      closeQuiet(fd);
      return { _tag: "bad" };
    }
    // Prove the anchor path is usable before returning the binding.
    const anchor = procFdPath(fd);
    if (anchor === null) {
      closeQuiet(fd);
      return { _tag: "bad" };
    }
    try {
      readdirSync(anchor);
    } catch {
      closeQuiet(fd);
      return { _tag: "bad" };
    }
    const dir: BoundDir = { fd, identity: identityOf(st) };
    fd = undefined; // ownership transferred
    return { _tag: "ok", dir };
  } catch {
    closeQuiet(fd);
    return { _tag: "bad" };
  }
}

/**
 * Open a single-segment child directory under an already-bound parent,
 * addressed only through the parent's fd anchor.
 */
function openBoundChildDir(parent: BoundDir, name: string): OpenDirResult {
  const flags = dirOpenFlags();
  if (flags === null || !isSafeSingleSegment(name)) return { _tag: "bad" };
  if (!recheckBoundDir(parent)) return { _tag: "bad" };
  const parentAnchor = procFdPath(parent.fd);
  if (parentAnchor === null) return { _tag: "bad" };
  const childPath = join(parentAnchor, name);
  const kind = observeDirComponent(childPath);
  if (kind === "missing") return { _tag: "missing" };
  if (kind !== "directory") return { _tag: "bad" };
  let fd: number | undefined;
  try {
    fd = openSync(childPath, flags);
    const st = fstatSync(fd);
    if (!st.isDirectory()) {
      closeQuiet(fd);
      return { _tag: "bad" };
    }
    // Parent must still be the same identity (no silent retarget).
    if (!recheckBoundDir(parent)) {
      closeQuiet(fd);
      return { _tag: "bad" };
    }
    const dir: BoundDir = { fd, identity: identityOf(st) };
    fd = undefined;
    return { _tag: "ok", dir };
  } catch {
    closeQuiet(fd);
    return { _tag: "bad" };
  }
}

/**
 * Create a missing single-segment child directory under a bound parent
 * via the fd anchor, then open it. Never creates through a symlink.
 */
function ensureBoundChildDir(parent: BoundDir, name: string): OpenDirResult {
  if (!isSafeSingleSegment(name)) return { _tag: "bad" };
  if (!recheckBoundDir(parent)) return { _tag: "bad" };
  const parentAnchor = procFdPath(parent.fd);
  if (parentAnchor === null) return { _tag: "bad" };
  const childPath = join(parentAnchor, name);
  let kind = observeDirComponent(childPath);
  if (kind === "symlink" || kind === "other") return { _tag: "bad" };
  if (kind === "missing") {
    try {
      mkdirSync(childPath, { recursive: false });
    } catch (e) {
      if (!isEexist(e)) return { _tag: "bad" };
    }
    kind = observeDirComponent(childPath);
    if (kind !== "directory") return { _tag: "bad" };
  }
  return openBoundChildDir(parent, name);
}

/**
 * Ensure `runs/` exists as a real directory and return a bound descriptor.
 * Creates the directory only when missing; refuses symlinks.
 */
function ensureBoundRunsDir(stateRoot: string): OpenDirResult {
  if (!directoryIdentityAnchorSupported()) return { _tag: "bad" };
  const runsPath = join(stateRoot, "runs");
  let kind = observeDirComponent(runsPath);
  if (kind === "symlink" || kind === "other") return { _tag: "bad" };
  if (kind === "missing") {
    try {
      mkdirSync(runsPath, { recursive: false });
    } catch (e) {
      if (!isEexist(e)) return { _tag: "bad" };
    }
    kind = observeDirComponent(runsPath);
    if (kind !== "directory") return { _tag: "bad" };
  }
  return openBoundDirAtPath(runsPath);
}

// ---------------------------------------------------------------------------
// Deterministic race seams (test-only)
// ---------------------------------------------------------------------------

/**
 * Hooks invoked after a directory identity is bound and before the next
 * use of that binding. Production never installs a hook. Tests swap
 * pathnames here to prove descriptor-anchored operations do not follow
 * a parent alias replaced after validation.
 */
export type DirectoryIdentityRaceHook = {
  /** After `runs/` is open-bound; before listing or opening a child. */
  readonly afterBindRunsDir?: () => void;
  /** After `runs/<runId>` is open-bound; before journal/lock use. */
  readonly afterBindRunDir?: () => void;
};

let raceHook: DirectoryIdentityRaceHook | undefined;

/**
 * Install or clear the directory-identity race seam. Tests only.
 */
export function setDirectoryIdentityRaceHook(
  hook: DirectoryIdentityRaceHook | undefined,
): void {
  raceHook = hook;
}

function fireAfterBindRunsDir(): void {
  const h = raceHook?.afterBindRunsDir;
  if (h !== undefined) h();
}

function fireAfterBindRunDir(): void {
  const h = raceHook?.afterBindRunDir;
  if (h !== undefined) h();
}

// ---------------------------------------------------------------------------
// Anchored child path helpers
// ---------------------------------------------------------------------------

function childPathUnder(dir: BoundDir, name: string): string | null {
  if (!isSafeSingleSegment(name)) return null;
  if (!recheckBoundDir(dir)) return null;
  const anchor = procFdPath(dir.fd);
  if (anchor === null) return null;
  return join(anchor, name);
}

// ---------------------------------------------------------------------------
// Live TypedJournalReader
// ---------------------------------------------------------------------------

/**
 * Live TypedJournalReader: bounded no-follow NDJSON read of events.ndjson.
 * Any NDJSON replay terminal other than CleanEof is Corrupt.
 * Directory walk is descriptor-anchored; a swapped parent yields no data.
 */
export function makeLiveTypedJournalReader(
  stateRoot: string,
): Layer.Layer<TypedJournalReader> {
  return Layer.succeed(TypedJournalReader, {
    readRun: (runId) =>
      Effect.sync(() => {
        if (!directoryIdentityAnchorSupported()) {
          // Fail closed: no unbound pathname read.
          return { _tag: "Corrupt" as const };
        }

        const runsOpen = openBoundDirAtPath(join(stateRoot, "runs"));
        if (runsOpen._tag === "missing") {
          return { _tag: "Missing" as const };
        }
        if (runsOpen._tag !== "ok") {
          return { _tag: "Corrupt" as const };
        }
        const runsDir = runsOpen.dir;
        try {
          fireAfterBindRunsDir();
          if (!recheckBoundDir(runsDir)) {
            return { _tag: "Corrupt" as const };
          }

          const runOpen = openBoundChildDir(runsDir, String(runId));
          if (runOpen._tag === "missing") {
            return { _tag: "Missing" as const };
          }
          if (runOpen._tag !== "ok") {
            return { _tag: "Corrupt" as const };
          }
          const runDir = runOpen.dir;
          try {
            fireAfterBindRunDir();
            if (!recheckBoundDir(runDir)) {
              return { _tag: "Corrupt" as const };
            }

            const eventsName = "events.ndjson";
            const eventsPath = childPathUnder(runDir, eventsName);
            if (eventsPath === null) {
              return { _tag: "Corrupt" as const };
            }

            let st: Stats;
            try {
              st = lstatSync(eventsPath);
            } catch (e) {
              if (isEnoent(e)) return { _tag: "Missing" as const };
              return { _tag: "Corrupt" as const };
            }
            if (st.isSymbolicLink()) return { _tag: "Corrupt" as const };
            if (!st.isFile()) return { _tag: "Corrupt" as const };
            if (st.size > MAX_REPLAY_INPUT_BYTES) {
              return { _tag: "Corrupt" as const };
            }
            if (st.size === 0) {
              return { _tag: "Ok" as const, records: [] as const };
            }

            const flags = fileOpenFlags();
            if (flags === null) return { _tag: "Corrupt" as const };

            let fd: number | undefined;
            try {
              // Open through the run-dir anchor only.
              fd = openSync(eventsPath, flags);
              const opened = fstatSync(fd);
              if (
                opened.ino !== st.ino ||
                opened.dev !== st.dev ||
                opened.size !== st.size ||
                !opened.isFile()
              ) {
                return { _tag: "Corrupt" as const };
              }
              // Parent run dir must still match the bound identity.
              if (!recheckBoundDir(runDir)) {
                return { _tag: "Corrupt" as const };
              }
              const buf = Buffer.allocUnsafe(st.size);
              let offset = 0;
              while (offset < st.size) {
                const n = readSync(fd, buf, offset, st.size - offset, offset);
                if (n === 0) break;
                offset += n;
              }
              const replay = replayNdjsonBytes(buf.subarray(0, offset), {
                fromLine: 0,
              });
              // Fail closed: any terminal other than CleanEof is Corrupt.
              if (replay.terminal._tag !== "CleanEof") {
                return { _tag: "Corrupt" as const };
              }
              return {
                _tag: "Ok" as const,
                records: replay.records as readonly ReplayRecord[],
              };
            } catch {
              return { _tag: "Corrupt" as const };
            } finally {
              closeQuiet(fd);
            }
          } finally {
            closeQuiet(runDir.fd);
          }
        } finally {
          closeQuiet(runsDir.fd);
        }
      }),
  });
}

// ---------------------------------------------------------------------------
// Live RunDiscovery
// ---------------------------------------------------------------------------

/**
 * Live RunDiscovery: list child directories of runs/ as run ids.
 * Never follows a symlinked runs/ directory or a symlinked child.
 * Listing is descriptor-anchored to the opened runs/ identity.
 */
export function makeLiveRunDiscovery(
  stateRoot: string,
): Layer.Layer<RunDiscovery> {
  return Layer.succeed(RunDiscovery, {
    listRuns: () =>
      Effect.sync(() => {
        if (!directoryIdentityAnchorSupported()) {
          // Fail closed: expose no names from an unbound walk.
          return [];
        }
        const runsOpen = openBoundDirAtPath(join(stateRoot, "runs"));
        if (runsOpen._tag !== "ok") {
          return [];
        }
        const runsDir = runsOpen.dir;
        try {
          fireAfterBindRunsDir();
          if (!recheckBoundDir(runsDir)) {
            return [];
          }
          const anchor = procFdPath(runsDir.fd);
          if (anchor === null) return [];

          let entries: string[];
          try {
            entries = readdirSync(anchor);
          } catch {
            return [];
          }

          const out: RunId[] = [];
          for (const name of entries.sort()) {
            if (!isSafeSingleSegment(name)) continue;
            // Open each candidate through the runs/ anchor only.
            const child = openBoundChildDir(runsDir, name);
            if (child._tag !== "ok") continue;
            closeQuiet(child.dir.fd);
            const id = decodeRunId(name);
            if (typeof id === "string") out.push(id);
          }
          return out;
        } finally {
          closeQuiet(runsDir.fd);
        }
      }),
  });
}

// ---------------------------------------------------------------------------
// Live RunLease
// ---------------------------------------------------------------------------

/**
 * Live per-run lease via exclusive mkdir of `.supervise.lock`.
 * No stale reclaim — busy fails closed.
 * Create and release bind to the opened run-directory identity so a
 * concurrent rename+symlink of runs/ or runs/<runId> cannot redirect
 * the lock outside the validated directory.
 */
export function makeLiveRunLease(stateRoot: string): Layer.Layer<RunLease> {
  return Layer.succeed(RunLease, {
    acquire: (runId) =>
      Effect.sync(() => {
        if (!directoryIdentityAnchorSupported()) {
          return { _tag: "Busy" as const };
        }

        // Establish real runs/ and bind its identity.
        const runsOpen = ensureBoundRunsDir(stateRoot);
        if (runsOpen._tag !== "ok") {
          return { _tag: "Busy" as const };
        }
        const runsDir = runsOpen.dir;
        let runDir: BoundDir | undefined;
        try {
          fireAfterBindRunsDir();
          if (!recheckBoundDir(runsDir)) {
            return { _tag: "Busy" as const };
          }

          const childOpen = ensureBoundChildDir(runsDir, String(runId));
          if (childOpen._tag !== "ok") {
            return { _tag: "Busy" as const };
          }
          runDir = childOpen.dir;
          fireAfterBindRunDir();
          if (!recheckBoundDir(runDir)) {
            return { _tag: "Busy" as const };
          }

          const lockName = ".supervise.lock";
          const lockPath = childPathUnder(runDir, lockName);
          if (lockPath === null) {
            return { _tag: "Busy" as const };
          }

          const lockKind = observeDirComponent(lockPath);
          if (lockKind === "symlink" || lockKind === "other") {
            return { _tag: "Busy" as const };
          }
          if (lockKind === "directory") {
            return { _tag: "Busy" as const };
          }

          try {
            mkdirSync(lockPath, { recursive: false });
          } catch {
            return { _tag: "Busy" as const };
          }

          // Confirm lock is a real directory under the still-bound run dir.
          if (observeDirComponent(lockPath) !== "directory") {
            try {
              rmdirSync(lockPath);
            } catch {
              /* ignore */
            }
            return { _tag: "Busy" as const };
          }
          if (!recheckBoundDir(runDir)) {
            try {
              rmdirSync(lockPath);
            } catch {
              /* ignore */
            }
            return { _tag: "Busy" as const };
          }

          // Transfer runDir ownership to the Held handle for release.
          const heldRun = runDir;
          runDir = undefined;
          let owned = true;
          return {
            _tag: "Held" as const,
            release: () =>
              Effect.sync(() => {
                if (!owned) return;
                owned = false;
                try {
                  if (recheckBoundDir(heldRun)) {
                    const releasePath = childPathUnder(
                      heldRun,
                      ".supervise.lock",
                    );
                    if (releasePath !== null) {
                      // Only remove if still a real directory under the
                      // original run identity — never a swapped parent.
                      if (observeDirComponent(releasePath) === "directory") {
                        rmdirSync(releasePath);
                      }
                    }
                  }
                } catch {
                  /* ignore */
                } finally {
                  closeQuiet(heldRun.fd);
                }
              }),
          };
        } finally {
          closeQuiet(runDir?.fd);
          closeQuiet(runsDir.fd);
        }
      }),
  });
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export type SupervisorLiveLayer = Layer.Layer<
  | RunDiscovery
  | TypedJournalReader
  | RunLease
  | WorktreeRestore
  | RunJournal
  | QueueSubmitter
  | ResumeProcessProbe
  | ResumeLockProbe
>;

/**
 * Compose all live supervisor services for one preflighted state root.
 */
export function makeLiveSupervisorServices(
  ctx: LiveSupervisorContext,
): SupervisorLiveLayer {
  const stateRoot = (() => {
    try {
      return realpathSync(ctx.stateRoot);
    } catch {
      return ctx.stateRoot;
    }
  })();

  const discovery = makeLiveRunDiscovery(stateRoot);
  const journalReader = makeLiveTypedJournalReader(stateRoot);
  const lease = makeLiveRunLease(stateRoot);
  const journal = makeLiveRunJournalLayer(stateRoot);
  const safety = liveResumeSafetyServices;

  const restore = makeLiveWorktreeRestore({
    env: ctx.env ?? process.env,
  }).pipe(Layer.provide(liveProcessExec));

  const queue = makeLiveQueueSubmitter().pipe(
    Layer.provide(liveQueueServices),
  );

  return Layer.mergeAll(
    discovery,
    journalReader,
    lease,
    journal,
    safety,
    restore,
    queue,
  ) as SupervisorLiveLayer;
}

/** Default shell and lane-run paths for the installed skill layout. */
export function defaultSupervisorPaths(skillRoot: string): {
  readonly shellBinary: string;
  readonly laneRunScript: string;
} {
  return {
    shellBinary: process.platform === "win32" ? "bash" : "/bin/bash",
    laneRunScript: join(skillRoot, "scripts", "lane-run.sh"),
  };
}
