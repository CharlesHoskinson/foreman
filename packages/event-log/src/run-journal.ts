/**
 * Live run journal: attempt allocation and canonical event append below one
 * external state root. Sprint 3 R3.
 *
 * Does not import @foreman/orchestration.
 */

import { Context, Effect, Layer } from "effect";
import { canonicalize } from "@foreman/core";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  decodeAttemptId,
  decodeAttemptIdText,
  extractPayloadAttempt,
  makeAttemptIdentity,
  nextAttempt,
  type AttemptId,
  type AttemptIdentity,
  type LaneId,
  type RunId,
} from "./attempt.js";
import { MAX_REPLAY_INPUT_BYTES } from "./bounds.js";
import { type AttemptFailure } from "./failures.js";
import { replayNdjsonBytes, type ReplayRecord } from "./replay.js";
import {
  decodeStoredEvent,
  type StoredEvent,
} from "./stored-event.js";

// ---------------------------------------------------------------------------
// Public draft and failure surface
// ---------------------------------------------------------------------------

/**
 * Generic event draft for the run journal. Independent of orchestration
 * RoundEventDraft so @foreman/event-log never imports orchestration.
 */
export type StoredEventDraftV1 = {
  readonly type: string;
  readonly lane: string;
  readonly commit?: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

export type RunJournalTransactionDecision<A> =
  | {
      readonly _tag: "Append";
      readonly draft: StoredEventDraftV1;
      readonly result: (stored: StoredEvent) => A;
    }
  | { readonly _tag: "Return"; readonly value: A };

export const RUN_JOURNAL_FAILURE_BRAND = Symbol(
  "@foreman/event-log/RunJournalFailure",
);

type Branded = { readonly [RUN_JOURNAL_FAILURE_BRAND]: true };

/** Closed non-leaking journal failure reasons. */
export type RunJournalFailureReason =
  | "journal_busy"
  | "invalid_path"
  | "corrupt_state"
  | "read_failed"
  | "write_failed"
  | "identity_changed"
  | "limit_exceeded"
  | "invalid_event";

export type RunJournalFailure = Branded & {
  readonly _tag: "RunJournalFailure";
  readonly reason: RunJournalFailureReason;
};

export function runJournalFailure(
  reason: RunJournalFailureReason,
): RunJournalFailure {
  return {
    [RUN_JOURNAL_FAILURE_BRAND]: true,
    _tag: "RunJournalFailure",
    reason,
  };
}

export function isRunJournalFailure(v: unknown): v is RunJournalFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [RUN_JOURNAL_FAILURE_BRAND]?: unknown })[
      RUN_JOURNAL_FAILURE_BRAND
    ] === true &&
    (v as { _tag?: unknown })._tag === "RunJournalFailure"
  );
}

// ---------------------------------------------------------------------------
// Resume-attempt reservation surface
// ---------------------------------------------------------------------------

export const RESUME_ATTEMPT_FAILURE_BRAND = Symbol(
  "@foreman/event-log/ResumeAttemptFailure",
);

type ResumeBranded = { readonly [RESUME_ATTEMPT_FAILURE_BRAND]: true };

/** Closed non-leaking resume reservation failure reasons. */
export type ResumeAttemptFailureReason =
  | "invalid_limit"
  | "attempt_not_current"
  | "legacy_unbound"
  | "invalid_resume_history"
  | "resume_limit_reached";

export type ResumeAttemptFailure = ResumeBranded & {
  readonly _tag: "ResumeAttemptFailure";
  readonly reason: ResumeAttemptFailureReason;
};

export function resumeAttemptFailure(
  reason: ResumeAttemptFailureReason,
): ResumeAttemptFailure {
  return {
    [RESUME_ATTEMPT_FAILURE_BRAND]: true,
    _tag: "ResumeAttemptFailure",
    reason,
  };
}

export function isResumeAttemptFailure(v: unknown): v is ResumeAttemptFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [RESUME_ATTEMPT_FAILURE_BRAND]?: unknown })[
      RESUME_ATTEMPT_FAILURE_BRAND
    ] === true &&
    (v as { _tag?: unknown })._tag === "ResumeAttemptFailure"
  );
}

/**
 * Successful atomic reservation of one lane-wide resume count bound to the
 * exact current source attempt.
 */
export type ResumeAttemptReservationV1 = {
  readonly attemptIdentity: AttemptIdentity;
  readonly event: StoredEvent;
  readonly resumeCount: number;
};

/**
 * Read-only resume-budget inspection result. Includes an exhausted budget so
 * callers can observe the current count without appending an event.
 */
export type ResumeAttemptBudgetV1 = {
  readonly attemptIdentity: AttemptIdentity;
  readonly resumeCount: number;
  readonly resumeMaxAttempts: number;
  readonly exhausted: boolean;
};

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export class RunJournal extends Context.Tag("RunJournal")<
  RunJournal,
  {
    readonly allocate: (
      runId: RunId,
      laneId: LaneId,
    ) => Effect.Effect<AttemptIdentity, AttemptFailure | RunJournalFailure>;

    readonly append: (
      runId: RunId,
      event: StoredEventDraftV1,
    ) => Effect.Effect<StoredEvent, RunJournalFailure>;

    readonly transact: <A>(
      runId: RunId,
      decide: (
        events: readonly StoredEvent[],
      ) => RunJournalTransactionDecision<A>,
    ) => Effect.Effect<A, RunJournalFailure>;

    readonly reserveResumeAttempt: (
      attemptIdentity: AttemptIdentity,
      resumeMaxAttempts: number,
    ) => Effect.Effect<
      ResumeAttemptReservationV1,
      ResumeAttemptFailure | RunJournalFailure
    >;
  }
>() {}

/** Exclusive lock acquisition bound (milliseconds). */
export const JOURNAL_LOCK_BOUND_MS = 10_000;

/** Maximum attempt-counter read size (16 decimal digits + one LF). */
export const MAX_ATTEMPT_COUNTER_BYTES = 17;

/**
 * Optional seams for deterministic tests (lock timing, path-swap hooks).
 * Production callers omit this; behavior does not require them.
 */
export type LiveRunJournalOptions = {
  readonly lockBoundMs?: number;
  readonly lockSpinMs?: number;
  readonly nowMs?: () => number;
  readonly waitMs?: (ms: number) => void;
  /**
   * After an existing counter is opened and bytes are read, before pathname
   * re-observation and replacement. Tests may swap or unlink the path.
   */
  readonly afterCounterRead?: (ctx: {
    readonly path: string;
    readonly fd: number;
  }) => void;
  /**
   * When the journal path was missing, before exclusive create. Tests may
   * create a competing file.
   */
  readonly beforeJournalCreate?: (path: string) => void;
  /**
   * After journal write + fsync, before pathname re-observation. Tests may
   * replace or unlink the path.
   */
  readonly afterJournalWriteSync?: (ctx: {
    readonly path: string;
    readonly fd: number;
  }) => void;
};

// ---------------------------------------------------------------------------
// Path layout
// ---------------------------------------------------------------------------

function runDir(stateRoot: string, runId: RunId): string {
  return join(stateRoot, "runs", runId);
}

function eventsPath(stateRoot: string, runId: RunId): string {
  return join(runDir(stateRoot, runId), "events.ndjson");
}

function attemptPath(stateRoot: string, runId: RunId, laneId: LaneId): string {
  return join(runDir(stateRoot, runId), "attempts", `${laneId}.txt`);
}

function attemptLockPath(
  stateRoot: string,
  runId: RunId,
  laneId: LaneId,
): string {
  return join(runDir(stateRoot, runId), "locks", `attempt-${laneId}.lock`);
}

function eventsLockPath(stateRoot: string, runId: RunId): string {
  return join(runDir(stateRoot, runId), "locks", "events.lock");
}

// ---------------------------------------------------------------------------
// Filesystem helpers (sync; never leak paths through typed failures)
// ---------------------------------------------------------------------------

type FileIdentity = {
  readonly dev: number;
  readonly ino: number;
};

function identityOf(st: Stats): FileIdentity {
  return { dev: st.dev, ino: st.ino };
}

function identitiesEqual(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

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

function observePathKind(
  path: string,
): "missing" | "regular" | "symlink" | "directory" | "other" {
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch (e) {
    if (isEnoent(e)) return "missing";
    return "other";
  }
  if (st.isSymbolicLink()) return "symlink";
  if (st.isFile()) return "regular";
  if (st.isDirectory()) return "directory";
  return "other";
}

function observeDirComponent(
  path: string,
): "missing" | "directory" | "symlink" | "other" {
  const kind = observePathKind(path);
  if (kind === "missing") return "missing";
  if (kind === "directory") return "directory";
  if (kind === "symlink") return "symlink";
  return "other";
}

/**
 * Validate each directory component below the resolved state root without
 * following a symbolic link or junction. Create one missing directory at a
 * time and revalidate it as an unlinked directory.
 */
function ensureLayoutDirs(
  stateRoot: string,
  segments: readonly string[],
): RunJournalFailure | null {
  let current = stateRoot;
  for (const seg of segments) {
    if (
      typeof seg !== "string" ||
      seg.length === 0 ||
      seg === "." ||
      seg === ".." ||
      seg.includes("/") ||
      seg.includes("\\") ||
      seg.includes("\0")
    ) {
      return runJournalFailure("invalid_path");
    }
    current = join(current, seg);
    const kind = observeDirComponent(current);
    if (kind === "symlink" || kind === "other") {
      return runJournalFailure("invalid_path");
    }
    if (kind === "missing") {
      try {
        mkdirSync(current, { recursive: false });
      } catch (e) {
        if (isEexist(e)) {
          // Concurrent create — revalidate below.
        } else if (isEnoent(e)) {
          return runJournalFailure("write_failed");
        } else {
          // ENOTDIR, EACCES, etc. — closed, non-leaking.
          return runJournalFailure("invalid_path");
        }
      }
      const after = observeDirComponent(current);
      if (after !== "directory") {
        return runJournalFailure("invalid_path");
      }
    }
  }
  return null;
}

/**
 * Compare a required pathname (via lstat, no follow) with an opened
 * descriptor. Disappearance or replacement fails closed.
 */
function pathMatchesOpenedFd(
  path: string,
  fd: number,
): "ok" | "identity_changed" | "invalid_path" | "read_failed" {
  let pathSt: Stats;
  try {
    pathSt = lstatSync(path);
  } catch (e) {
    if (isEnoent(e)) return "identity_changed";
    return "read_failed";
  }
  if (pathSt.isSymbolicLink()) return "invalid_path";
  if (!pathSt.isFile()) return "invalid_path";
  let fdSt: Stats;
  try {
    fdSt = fstatSync(fd);
  } catch {
    return "identity_changed";
  }
  if (!fdSt.isFile()) return "invalid_path";
  if (!identitiesEqual(identityOf(pathSt), identityOf(fdSt))) {
    return "identity_changed";
  }
  return "ok";
}

type HeldLock = {
  readonly fd: number;
  readonly path: string;
  readonly identity: FileIdentity;
};

type LockTiming = {
  readonly boundMs: number;
  readonly spinMs: number;
  readonly nowMs: () => number;
  readonly waitMs: (ms: number) => void;
};

function defaultWaitMs(ms: number): void {
  if (ms <= 0) return;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy spin — production lock retries are short */
  }
}

/**
 * Acquire exclusive-create lock. Retries until deadline.
 * Caller must ensure parent layout directories already exist.
 */
function acquireLockSync(
  lockPath: string,
  timing: LockTiming,
): HeldLock | RunJournalFailure {
  const kind = observePathKind(lockPath);
  if (kind === "symlink" || kind === "directory" || kind === "other") {
    return runJournalFailure("invalid_path");
  }
  const start = timing.nowMs();
  const deadline = start + timing.boundMs;
  while (true) {
    try {
      const fd = openSync(
        lockPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o600,
      );
      let st: Stats;
      try {
        st = fstatSync(fd);
      } catch {
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
        return runJournalFailure("write_failed");
      }
      if (!st.isFile()) {
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
        return runJournalFailure("invalid_path");
      }
      // Pathname must still identify the opened lock file.
      const match = pathMatchesOpenedFd(lockPath, fd);
      if (match !== "ok") {
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
        return runJournalFailure(
          match === "identity_changed" ? "identity_changed" : "invalid_path",
        );
      }
      return { fd, path: lockPath, identity: identityOf(st) };
    } catch (e) {
      if (isEexist(e)) {
        if (timing.nowMs() >= deadline) {
          return runJournalFailure("journal_busy");
        }
        timing.waitMs(timing.spinMs);
        continue;
      }
      return runJournalFailure("write_failed");
    }
  }
}

function releaseLockSync(lock: HeldLock): void {
  try {
    closeSync(lock.fd);
  } catch {
    /* ignore */
  }
  try {
    const st = lstatSync(lock.path);
    if (st.isFile() && identitiesEqual(identityOf(st), lock.identity)) {
      unlinkSync(lock.path);
    }
  } catch {
    /* do not remove a changed lock path */
  }
}

function withLockSync<A>(
  lockPath: string,
  timing: LockTiming,
  body: () => A | RunJournalFailure | AttemptFailure | ResumeAttemptFailure,
): A | RunJournalFailure | AttemptFailure | ResumeAttemptFailure {
  const lock = acquireLockSync(lockPath, timing);
  if (isRunJournalFailure(lock)) {
    return lock;
  }
  try {
    return body();
  } finally {
    releaseLockSync(lock);
  }
}

function posixDirSync(dirPath: string): void {
  if (process.platform === "win32") {
    return;
  }
  let fd: number | undefined;
  try {
    fd = openSync(dirPath, fsConstants.O_RDONLY);
    fsyncSync(fd);
  } catch {
    throw new Error("dir_sync_failed");
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
 * Same-directory temporary replacement: write temp, fsync file, rename,
 * POSIX directory sync. Parent directories must already exist.
 */
function durableReplaceFile(
  targetPath: string,
  content: Uint8Array,
): RunJournalFailure | null {
  const dir = dirname(targetPath);
  let tmpName: string;
  try {
    tmpName = `.tmp-${randomBytes(16).toString("hex")}`;
  } catch {
    return runJournalFailure("write_failed");
  }
  const tmpPath = join(dir, tmpName);
  let fd: number | undefined;
  try {
    fd = openSync(
      tmpPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    let offset = 0;
    while (offset < content.byteLength) {
      const n = writeSync(fd, content, offset, content.byteLength - offset);
      offset += n;
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, targetPath);
    try {
      posixDirSync(dir);
    } catch {
      return runJournalFailure("write_failed");
    }
    return null;
  } catch {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    return runJournalFailure("write_failed");
  }
}

function noFollowReadFlags(): number {
  return (
    fsConstants.O_RDONLY |
    ("O_NOFOLLOW" in fsConstants
      ? (fsConstants as { O_NOFOLLOW: number }).O_NOFOLLOW
      : 0)
  );
}

function noFollowWriteFlags(extra: number): number {
  return (
    extra |
    ("O_NOFOLLOW" in fsConstants
      ? (fsConstants as { O_NOFOLLOW: number }).O_NOFOLLOW
      : 0)
  );
}

// ---------------------------------------------------------------------------
// Attempt allocation
// ---------------------------------------------------------------------------

function allocateSync(
  stateRoot: string,
  runId: RunId,
  laneId: LaneId,
  options: LiveRunJournalOptions,
): AttemptIdentity | AttemptFailure | RunJournalFailure {
  const locksErr = ensureLayoutDirs(stateRoot, ["runs", runId, "locks"]);
  if (locksErr !== null) return locksErr;
  const attemptsErr = ensureLayoutDirs(stateRoot, ["runs", runId, "attempts"]);
  if (attemptsErr !== null) return attemptsErr;

  const lockPath = attemptLockPath(stateRoot, runId, laneId);
  const counterPath = attemptPath(stateRoot, runId, laneId);
  const timing: LockTiming = {
    boundMs: options.lockBoundMs ?? JOURNAL_LOCK_BOUND_MS,
    spinMs: options.lockSpinMs ?? 5,
    nowMs: options.nowMs ?? (() => Date.now()),
    waitMs: options.waitMs ?? defaultWaitMs,
  };

  return withLockSync(lockPath, timing, () => {
    const kind = observePathKind(counterPath);
    if (kind === "symlink" || kind === "directory" || kind === "other") {
      return runJournalFailure("invalid_path");
    }

    let selectedId: ReturnType<typeof nextAttempt>;
    if (kind === "missing") {
      selectedId = nextAttempt(undefined);
    } else {
      let fd: number | undefined;
      try {
        fd = openSync(counterPath, noFollowReadFlags());
        const st = fstatSync(fd);
        if (!st.isFile()) {
          return runJournalFailure("invalid_path");
        }
        if (st.size > MAX_ATTEMPT_COUNTER_BYTES) {
          return runJournalFailure("corrupt_state");
        }
        // Bound the read hard at 17 bytes even during a size race.
        const buf = Buffer.allocUnsafe(MAX_ATTEMPT_COUNTER_BYTES);
        const n = readSync(fd, buf, 0, MAX_ATTEMPT_COUNTER_BYTES, 0);
        if (n > MAX_ATTEMPT_COUNTER_BYTES) {
          return runJournalFailure("corrupt_state");
        }

        if (options.afterCounterRead !== undefined) {
          options.afterCounterRead({ path: counterPath, fd });
        }

        // Re-observe pathname and compare with the opened descriptor.
        const match = pathMatchesOpenedFd(counterPath, fd);
        if (match === "identity_changed") {
          return runJournalFailure("identity_changed");
        }
        if (match !== "ok") {
          return runJournalFailure("invalid_path");
        }
        let after: Stats;
        try {
          after = fstatSync(fd);
        } catch {
          return runJournalFailure("identity_changed");
        }
        if (after.ino !== st.ino || after.dev !== st.dev) {
          return runJournalFailure("identity_changed");
        }
        if (after.size > MAX_ATTEMPT_COUNTER_BYTES) {
          return runJournalFailure("corrupt_state");
        }
        // Size must still match the bounded read view.
        if (after.size !== n) {
          return runJournalFailure("identity_changed");
        }

        const bytes = buf.subarray(0, n);
        if (n === 0) {
          return runJournalFailure("corrupt_state");
        }
        if (bytes[n - 1] !== 0x0a) {
          return runJournalFailure("corrupt_state");
        }
        const body = bytes.subarray(0, n - 1);
        for (let i = 0; i < body.byteLength; i += 1) {
          const b = body[i]!;
          if (b === 0x0a || b === 0x0d || b === 0x20 || b === 0x09) {
            return runJournalFailure("corrupt_state");
          }
        }
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(body);
        } catch {
          return runJournalFailure("corrupt_state");
        }
        const decoded = decodeAttemptIdText(text);
        if (typeof decoded !== "number") {
          return runJournalFailure("corrupt_state");
        }
        selectedId = decoded;
      } catch (e) {
        if (isEnoent(e)) {
          return runJournalFailure("identity_changed");
        }
        return runJournalFailure("read_failed");
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

    if (typeof selectedId !== "number") {
      return selectedId;
    }

    const next = nextAttempt(selectedId);
    if (typeof next !== "number") {
      // overflow: typed AttemptFailure without writing
      return next;
    }

    const content = Buffer.from(`${String(next)}\n`, "utf8");
    const writeErr = durableReplaceFile(counterPath, content);
    if (writeErr !== null) {
      return writeErr;
    }
    return makeAttemptIdentity(runId, laneId, selectedId);
  }) as AttemptIdentity | AttemptFailure | RunJournalFailure;
}

// ---------------------------------------------------------------------------
// Event append
// ---------------------------------------------------------------------------

function formatUtcSecondTimestamp(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}:${s}Z`;
}

/**
 * R3 journal contract: first durable sequence must be 1; each later sequence
 * must equal the previous plus one. Generic replay may accept zero and gaps;
 * the R3 journal must not.
 */
function validateR3SequenceChain(
  records: readonly { readonly event: { readonly seq: number } }[],
): RunJournalFailure | null {
  if (records.length === 0) return null;
  if (records[0]!.event.seq !== 1) {
    return runJournalFailure("corrupt_state");
  }
  for (let i = 1; i < records.length; i += 1) {
    const prev = records[i - 1]!.event.seq;
    const cur = records[i]!.event.seq;
    if (cur !== prev + 1) {
      return runJournalFailure("corrupt_state");
    }
  }
  return null;
}

function validateDraftShape(
  draft: StoredEventDraftV1,
): RunJournalFailure | null {
  if (
    typeof draft.type !== "string" ||
    draft.type.length === 0 ||
    typeof draft.lane !== "string" ||
    draft.lane.length === 0 ||
    draft.payload === null ||
    typeof draft.payload !== "object" ||
    Array.isArray(draft.payload)
  ) {
    return runJournalFailure("invalid_event");
  }
  if (draft.commit !== undefined) {
    if (typeof draft.commit !== "string" || draft.commit.length === 0) {
      return runJournalFailure("invalid_event");
    }
  }
  return null;
}

type JournalReadView = {
  readonly existing: Uint8Array;
  readonly beforeIdentity: FileIdentity | null;
  readonly records: readonly ReplayRecord[];
};

/**
 * Read the events journal under an already-held exclusive lock. No-follow,
 * size-bound, identity, complete replay, and consecutive sequence checks.
 */
function readJournalLocked(
  journalPath: string,
): JournalReadView | RunJournalFailure {
  const kind = observePathKind(journalPath);
  if (kind === "symlink" || kind === "directory" || kind === "other") {
    return runJournalFailure("invalid_path");
  }

  let existing = new Uint8Array(0);
  let beforeIdentity: FileIdentity | null = null;
  if (kind === "regular") {
    let fd: number | undefined;
    try {
      fd = openSync(journalPath, noFollowReadFlags());
      const st = fstatSync(fd);
      if (!st.isFile()) {
        return runJournalFailure("invalid_path");
      }
      // Reject oversized journal before allocating a buffer of that size.
      if (st.size > MAX_REPLAY_INPUT_BYTES) {
        return runJournalFailure("limit_exceeded");
      }
      beforeIdentity = identityOf(st);
      if (st.size > 0) {
        const buf = Buffer.allocUnsafe(st.size);
        let offset = 0;
        while (offset < st.size) {
          const n = readSync(fd, buf, offset, st.size - offset, offset);
          if (n === 0) break;
          offset += n;
        }
        existing = buf.subarray(0, offset);
      }
      const match = pathMatchesOpenedFd(journalPath, fd);
      if (match === "identity_changed") {
        return runJournalFailure("identity_changed");
      }
      if (match !== "ok") {
        return runJournalFailure("invalid_path");
      }
      let after: Stats;
      try {
        after = fstatSync(fd);
      } catch {
        return runJournalFailure("identity_changed");
      }
      if (
        after.ino !== st.ino ||
        after.dev !== st.dev ||
        after.size !== st.size
      ) {
        return runJournalFailure("identity_changed");
      }
    } catch (e) {
      if (isEnoent(e)) {
        return runJournalFailure("identity_changed");
      }
      return runJournalFailure("read_failed");
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

  // Validate existing journal completely before write.
  const replay = replayNdjsonBytes(existing, { fromLine: 0 });
  if (replay.terminal._tag !== "CleanEof") {
    return runJournalFailure("corrupt_state");
  }

  const seqErr = validateR3SequenceChain(replay.records);
  if (seqErr !== null) return seqErr;

  return {
    existing,
    beforeIdentity,
    records: replay.records,
  };
}

/**
 * Encode and durable-append one draft against a journal already read under
 * the exclusive events lock.
 */
function writeAppendLocked(
  journalPath: string,
  view: JournalReadView,
  draft: StoredEventDraftV1,
  options: LiveRunJournalOptions,
): StoredEvent | RunJournalFailure {
  const shapeErr = validateDraftShape(draft);
  if (shapeErr !== null) return shapeErr;

  let lastSeq = 0;
  if (view.records.length === 0) {
    lastSeq = 0;
  } else {
    lastSeq = view.records[view.records.length - 1]!.event.seq;
  }

  if (lastSeq >= Number.MAX_SAFE_INTEGER) {
    return runJournalFailure("limit_exceeded");
  }
  const nextSeq = lastSeq === 0 ? 1 : lastSeq + 1;
  if (!Number.isSafeInteger(nextSeq) || nextSeq < 1) {
    return runJournalFailure("limit_exceeded");
  }

  const ts = formatUtcSecondTimestamp(new Date());
  const candidate: Record<string, unknown> = {
    seq: nextSeq,
    ts,
    type: draft.type,
    lane: draft.lane,
    payload: { ...draft.payload },
  };
  if (draft.commit !== undefined) {
    candidate["commit"] = draft.commit;
  }

  const decoded = decodeStoredEvent(candidate);
  if (typeof decoded === "object" && "_tag" in decoded) {
    return runJournalFailure("invalid_event");
  }
  const stored = decoded as StoredEvent;

  let lineText: string;
  try {
    lineText = canonicalize({
      seq: stored.seq,
      ts: stored.ts,
      type: stored.type,
      lane: stored.lane,
      ...(stored.commit !== undefined ? { commit: stored.commit } : {}),
      payload: stored.payload,
    });
  } catch {
    return runJournalFailure("invalid_event");
  }
  const lineBytes = Buffer.from(lineText + "\n", "utf8");

  // Candidate complete size bound before building the buffer for replay.
  if (view.existing.byteLength + lineBytes.byteLength > MAX_REPLAY_INPUT_BYTES) {
    return runJournalFailure("limit_exceeded");
  }

  const candidateBytes = Buffer.concat([
    Buffer.from(view.existing),
    lineBytes,
  ]);
  const candidateReplay = replayNdjsonBytes(candidateBytes, { fromLine: 0 });
  if (candidateReplay.terminal._tag !== "CleanEof") {
    const reason = candidateReplay.terminal.reason;
    if (
      reason === "line_too_large" ||
      reason === "input_too_large" ||
      reason === "too_many_lines"
    ) {
      return runJournalFailure("limit_exceeded");
    }
    return runJournalFailure("invalid_event");
  }
  const candSeqErr = validateR3SequenceChain(candidateReplay.records);
  if (candSeqErr !== null) return candSeqErr;

  // Open journal for append. Missing path uses exclusive create so a
  // competing create is not silently accepted.
  let wfd: number | undefined;
  try {
    if (view.beforeIdentity === null) {
      if (options.beforeJournalCreate !== undefined) {
        options.beforeJournalCreate(journalPath);
      }
      try {
        wfd = openSync(
          journalPath,
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
          0o600,
        );
      } catch (e) {
        if (isEexist(e)) {
          return runJournalFailure("identity_changed");
        }
        return runJournalFailure("write_failed");
      }
    } else {
      wfd = openSync(
        journalPath,
        noFollowWriteFlags(fsConstants.O_WRONLY | fsConstants.O_APPEND),
        0o600,
      );
    }

    const opened = fstatSync(wfd);
    if (!opened.isFile()) {
      return runJournalFailure("invalid_path");
    }
    if (view.beforeIdentity !== null) {
      if (!identitiesEqual(identityOf(opened), view.beforeIdentity)) {
        return runJournalFailure("identity_changed");
      }
      if (opened.size !== view.existing.byteLength) {
        return runJournalFailure("identity_changed");
      }
    } else if (opened.size !== 0) {
      return runJournalFailure("identity_changed");
    }

    // Pathname must identify the write descriptor before write.
    {
      const match = pathMatchesOpenedFd(journalPath, wfd);
      if (match === "identity_changed") {
        return runJournalFailure("identity_changed");
      }
      if (match !== "ok") {
        return runJournalFailure("invalid_path");
      }
    }

    let offset = 0;
    while (offset < lineBytes.byteLength) {
      const n = writeSync(
        wfd,
        lineBytes,
        offset,
        lineBytes.byteLength - offset,
      );
      offset += n;
    }
    fsyncSync(wfd);

    if (options.afterJournalWriteSync !== undefined) {
      options.afterJournalWriteSync({ path: journalPath, fd: wfd });
    }

    // Re-observe events.ndjson and compare with the write descriptor.
    {
      const match = pathMatchesOpenedFd(journalPath, wfd);
      if (match === "identity_changed") {
        return runJournalFailure("identity_changed");
      }
      if (match !== "ok") {
        return runJournalFailure("invalid_path");
      }
    }

    const after = fstatSync(wfd);
    if (after.ino !== opened.ino || after.dev !== opened.dev) {
      return runJournalFailure("identity_changed");
    }
    return stored;
  } catch (e) {
    if (isEnoent(e)) {
      return runJournalFailure("identity_changed");
    }
    return runJournalFailure("write_failed");
  } finally {
    if (wfd !== undefined) {
      try {
        closeSync(wfd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * One exclusive events-lock transaction: read, decide, optional append.
 * Ordinary append and resume reservation share this path.
 */
function lockedJournalTransaction<E>(
  stateRoot: string,
  runId: RunId,
  options: LiveRunJournalOptions,
  decide: (
    records: readonly ReplayRecord[],
  ) =>
    | { readonly _tag: "append"; readonly draft: StoredEventDraftV1 }
    | { readonly _tag: "fail"; readonly error: E | RunJournalFailure },
): StoredEvent | E | RunJournalFailure {
  const layoutErr = ensureLayoutDirs(stateRoot, ["runs", runId, "locks"]);
  if (layoutErr !== null) return layoutErr;

  const lockPath = eventsLockPath(stateRoot, runId);
  const journalPath = eventsPath(stateRoot, runId);
  const timing: LockTiming = {
    boundMs: options.lockBoundMs ?? JOURNAL_LOCK_BOUND_MS,
    spinMs: options.lockSpinMs ?? 5,
    nowMs: options.nowMs ?? (() => Date.now()),
    waitMs: options.waitMs ?? defaultWaitMs,
  };

  return withLockSync(lockPath, timing, () => {
    const view = readJournalLocked(journalPath);
    if (isRunJournalFailure(view)) {
      return view;
    }

    const decision = decide(view.records);
    if (decision._tag === "fail") {
      return decision.error;
    }

    return writeAppendLocked(journalPath, view, decision.draft, options);
  }) as StoredEvent | E | RunJournalFailure;
}

function appendSync(
  stateRoot: string,
  runId: RunId,
  draft: StoredEventDraftV1,
  options: LiveRunJournalOptions,
): StoredEvent | RunJournalFailure {
  const shapeErr = validateDraftShape(draft);
  if (shapeErr !== null) return shapeErr;

  return lockedJournalTransaction(stateRoot, runId, options, () => ({
    _tag: "append" as const,
    draft,
  }));
}

function transactSync<A>(
  stateRoot: string,
  runId: RunId,
  decide: (
    events: readonly StoredEvent[],
  ) => RunJournalTransactionDecision<A>,
  options: LiveRunJournalOptions,
): A | RunJournalFailure {
  const layoutErr = ensureLayoutDirs(stateRoot, ["runs", runId, "locks"]);
  if (layoutErr !== null) return layoutErr;

  const lockPath = eventsLockPath(stateRoot, runId);
  const journalPath = eventsPath(stateRoot, runId);
  const timing: LockTiming = {
    boundMs: options.lockBoundMs ?? JOURNAL_LOCK_BOUND_MS,
    spinMs: options.lockSpinMs ?? 5,
    nowMs: options.nowMs ?? (() => Date.now()),
    waitMs: options.waitMs ?? defaultWaitMs,
  };

  return withLockSync(lockPath, timing, () => {
    const view = readJournalLocked(journalPath);
    if (isRunJournalFailure(view)) return view;

    let decision: RunJournalTransactionDecision<A>;
    try {
      decision = decide(view.records.map((record) => record.event));
    } catch {
      return runJournalFailure("read_failed");
    }
    if (decision._tag === "Return") return decision.value;

    const stored = writeAppendLocked(journalPath, view, decision.draft, options);
    if (isRunJournalFailure(stored)) return stored;
    try {
      return decision.result(stored);
    } catch {
      return runJournalFailure("write_failed");
    }
  }) as A | RunJournalFailure;
}

// ---------------------------------------------------------------------------
// Resume-attempt reservation (atomic under the events lock)
// ---------------------------------------------------------------------------

const RESUME_COUNT_MAX = 100;

function isPositiveSafeInteger(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 1;
}

function isValidResumeLimit(limit: number): boolean {
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= RESUME_COUNT_MAX;
}

/**
 * Parse one resume_attempt payload: exactly { attempt, resumeCount }, both
 * positive safe integers with resumeCount in 1..100.
 */
function parseResumeAttemptPayload(
  payload: Readonly<Record<string, unknown>>,
):
  | { readonly attempt: AttemptId; readonly resumeCount: number }
  | "invalid" {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return "invalid";
  }
  const keys = Object.keys(payload);
  if (keys.length !== 2) {
    return "invalid";
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "attempt")) {
    return "invalid";
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "resumeCount")) {
    return "invalid";
  }
  const attemptRaw = payload["attempt"];
  const countRaw = payload["resumeCount"];
  if (typeof attemptRaw !== "number" || !isPositiveSafeInteger(attemptRaw)) {
    return "invalid";
  }
  if (
    typeof countRaw !== "number" ||
    !Number.isSafeInteger(countRaw) ||
    countRaw < 1 ||
    countRaw > RESUME_COUNT_MAX
  ) {
    return "invalid";
  }
  const attempt = decodeAttemptId(attemptRaw);
  if (typeof attempt !== "number") {
    return "invalid";
  }
  return { attempt, resumeCount: countRaw };
}

/**
 * Read-only resume-budget inspection. Validates the same lane history as
 * atomic reservation and returns the current valid count, including when the
 * budget is already exhausted. Never appends an event.
 */
export function inspectResumeAttemptBudget(
  records: readonly ReplayRecord[],
  attemptIdentity: AttemptIdentity,
  resumeMaxAttempts: number,
): ResumeAttemptBudgetV1 | ResumeAttemptFailure {
  if (!isValidResumeLimit(resumeMaxAttempts)) {
    return resumeAttemptFailure("invalid_limit");
  }

  const lane = attemptIdentity.laneId;
  let latestPromptAttempt: AttemptId | null | "malformed" = null;
  let expectedCount = 1;

  for (const rec of records) {
    const event = rec.event;
    if (event.lane !== lane) {
      continue;
    }
    if (event.type === "prompt") {
      const extracted = extractPayloadAttempt(event.payload);
      if (extracted === undefined) {
        latestPromptAttempt = "malformed";
      } else if (typeof extracted !== "number") {
        latestPromptAttempt = "malformed";
      } else {
        latestPromptAttempt = extracted;
      }
      continue;
    }
    if (event.type === "resume") {
      return resumeAttemptFailure("legacy_unbound");
    }
    if (event.type === "resume_attempt") {
      const parsed = parseResumeAttemptPayload(event.payload);
      if (parsed === "invalid") {
        return resumeAttemptFailure("invalid_resume_history");
      }
      if (parsed.resumeCount !== expectedCount) {
        return resumeAttemptFailure("invalid_resume_history");
      }
      expectedCount += 1;
      continue;
    }
    // Unknown types remain opaque.
  }

  if (
    latestPromptAttempt === null ||
    latestPromptAttempt === "malformed" ||
    latestPromptAttempt !== attemptIdentity.attemptId
  ) {
    return resumeAttemptFailure("attempt_not_current");
  }

  const resumeCount = expectedCount - 1;
  const exhausted =
    resumeCount >= resumeMaxAttempts || expectedCount > RESUME_COUNT_MAX;
  return {
    attemptIdentity,
    resumeCount,
    resumeMaxAttempts,
    exhausted,
  };
}

/**
 * True when the journal already holds a durable terminal for the selected
 * attempt (`round_done` or incomplete alert). Used only under the events lock
 * so a concurrent terminal between decision and reservation fails closed
 * before append, restore, or queue.
 */
function attemptHasDurableTerminal(
  records: readonly ReplayRecord[],
  attemptIdentity: AttemptIdentity,
): boolean {
  const lane = attemptIdentity.laneId;
  const attempt = attemptIdentity.attemptId;
  for (const rec of records) {
    const event = rec.event;
    if (event.lane !== lane) continue;
    if (event.type === "round_done") {
      const extracted = extractPayloadAttempt(event.payload);
      if (typeof extracted === "number" && extracted === attempt) {
        return true;
      }
      continue;
    }
    if (event.type === "alert") {
      if (event.payload["kind"] !== "round_incomplete") continue;
      const extracted = extractPayloadAttempt(event.payload);
      if (typeof extracted === "number" && extracted === attempt) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Derive the next resume count under the events lock from the shared
 * inspector. Exhausted, terminal, or invalid budgets fail closed without
 * append. Reuses inspectResumeAttemptBudget rather than a second unlocked
 * decision path.
 */
function deriveNextResumeCount(
  records: readonly ReplayRecord[],
  attemptIdentity: AttemptIdentity,
  resumeMaxAttempts: number,
):
  | { readonly _tag: "ok"; readonly nextCount: number }
  | { readonly _tag: "fail"; readonly error: ResumeAttemptFailure } {
  const budget = inspectResumeAttemptBudget(
    records,
    attemptIdentity,
    resumeMaxAttempts,
  );
  if (isResumeAttemptFailure(budget)) {
    return { _tag: "fail", error: budget };
  }
  // Terminal for the selected attempt under the lock → not currently
  // resumable. Fail closed with attempt_not_current (closed reason set).
  if (attemptHasDurableTerminal(records, attemptIdentity)) {
    return {
      _tag: "fail",
      error: resumeAttemptFailure("attempt_not_current"),
    };
  }
  if (budget.exhausted) {
    return {
      _tag: "fail",
      error: resumeAttemptFailure("resume_limit_reached"),
    };
  }
  const nextCount = budget.resumeCount + 1;
  if (nextCount > resumeMaxAttempts || nextCount > RESUME_COUNT_MAX) {
    return {
      _tag: "fail",
      error: resumeAttemptFailure("resume_limit_reached"),
    };
  }
  return { _tag: "ok", nextCount };
}

function reserveResumeAttemptSync(
  stateRoot: string,
  attemptIdentity: AttemptIdentity,
  resumeMaxAttempts: number,
  options: LiveRunJournalOptions,
):
  | ResumeAttemptReservationV1
  | ResumeAttemptFailure
  | RunJournalFailure {
  // Validate limit before touching the journal so invalid_limit is cheap.
  if (!isValidResumeLimit(resumeMaxAttempts)) {
    return resumeAttemptFailure("invalid_limit");
  }

  let reservedCount = 0;
  const result = lockedJournalTransaction(
    stateRoot,
    attemptIdentity.runId,
    options,
    (records) => {
      const derived = deriveNextResumeCount(
        records,
        attemptIdentity,
        resumeMaxAttempts,
      );
      if (derived._tag === "fail") {
        return { _tag: "fail" as const, error: derived.error };
      }
      reservedCount = derived.nextCount;
      return {
        _tag: "append" as const,
        draft: {
          type: "resume_attempt",
          lane: attemptIdentity.laneId,
          payload: {
            attempt: attemptIdentity.attemptId,
            resumeCount: derived.nextCount,
          },
        },
      };
    },
  );

  if (isRunJournalFailure(result) || isResumeAttemptFailure(result)) {
    return result;
  }

  const stored = result as StoredEvent;
  return {
    attemptIdentity,
    event: stored,
    resumeCount: reservedCount,
  };
}

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

function isAttemptFailureValue(v: unknown): v is AttemptFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { _tag?: unknown })._tag === "AttemptFailure"
  );
}

/**
 * Construct a live RunJournal layer bound to one preflighted absolute state
 * root. The root must already exist as a directory; this constructor does not
 * create it. Optional seams make lock timing and path-swap races deterministic
 * in tests; production callers omit them.
 */
export function makeLiveRunJournalLayer(
  stateRoot: string,
  options: LiveRunJournalOptions = {},
): Layer.Layer<RunJournal> {
  return Layer.succeed(RunJournal, {
    allocate: (
      runId,
      laneId,
    ): Effect.Effect<AttemptIdentity, AttemptFailure | RunJournalFailure> => {
      // Map every synchronous filesystem/crypto exception to a closed failure.
      try {
        const r = allocateSync(stateRoot, runId, laneId, options);
        if (isRunJournalFailure(r)) {
          return Effect.fail(r);
        }
        if (isAttemptFailureValue(r)) {
          return Effect.fail(r);
        }
        return Effect.succeed(r);
      } catch {
        return Effect.fail(runJournalFailure("write_failed"));
      }
    },
    append: (
      runId,
      event,
    ): Effect.Effect<StoredEvent, RunJournalFailure> => {
      try {
        const r = appendSync(stateRoot, runId, event, options);
        if (isRunJournalFailure(r)) {
          return Effect.fail(r);
        }
        return Effect.succeed(r);
      } catch {
        return Effect.fail(runJournalFailure("write_failed"));
      }
    },
    transact: <A>(
      runId: RunId,
      decide: (
        events: readonly StoredEvent[],
      ) => RunJournalTransactionDecision<A>,
    ): Effect.Effect<A, RunJournalFailure> => {
      try {
        const result = transactSync(stateRoot, runId, decide, options);
        if (isRunJournalFailure(result)) return Effect.fail(result);
        return Effect.succeed(result);
      } catch {
        return Effect.fail(runJournalFailure("write_failed"));
      }
    },
    reserveResumeAttempt: (
      attemptIdentity,
      resumeMaxAttempts,
    ): Effect.Effect<
      ResumeAttemptReservationV1,
      ResumeAttemptFailure | RunJournalFailure
    > => {
      try {
        const r = reserveResumeAttemptSync(
          stateRoot,
          attemptIdentity,
          resumeMaxAttempts,
          options,
        );
        if (isRunJournalFailure(r)) {
          return Effect.fail(r);
        }
        if (isResumeAttemptFailure(r)) {
          return Effect.fail(r);
        }
        return Effect.succeed(r);
      } catch {
        return Effect.fail(runJournalFailure("write_failed"));
      }
    },
  });
}
