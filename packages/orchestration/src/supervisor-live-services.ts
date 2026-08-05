/**
 * Live Node.js bindings for the one-shot resume supervisor (R5D).
 */

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmdirSync,
  statSync,
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

function runDir(stateRoot: string, runId: RunId): string {
  return join(stateRoot, "runs", runId);
}

function eventsPath(stateRoot: string, runId: RunId): string {
  return join(runDir(stateRoot, runId), "events.ndjson");
}

function leasePath(stateRoot: string, runId: RunId): string {
  return join(runDir(stateRoot, runId), ".supervise.lock");
}

/**
 * Live TypedJournalReader: bounded no-follow NDJSON read of events.ndjson.
 */
export function makeLiveTypedJournalReader(
  stateRoot: string,
): Layer.Layer<TypedJournalReader> {
  return Layer.succeed(TypedJournalReader, {
    readRun: (runId) =>
      Effect.sync(() => {
        const path = eventsPath(stateRoot, runId);
        let fd: number | undefined;
        try {
          let st;
          try {
            st = statSync(path);
          } catch (e) {
            if (isEnoent(e)) return { _tag: "Missing" as const };
            return { _tag: "Corrupt" as const };
          }
          if (!st.isFile()) return { _tag: "Corrupt" as const };
          if (st.size > MAX_REPLAY_INPUT_BYTES) {
            return { _tag: "Corrupt" as const };
          }
          if (st.size === 0) {
            return { _tag: "Ok" as const, records: [] as const };
          }

          const flags =
            fsConstants.O_RDONLY |
            ("O_NOFOLLOW" in fsConstants
              ? (fsConstants as { O_NOFOLLOW: number }).O_NOFOLLOW
              : 0);
          fd = openSync(path, flags);
          const opened = fstatSync(fd);
          if (
            opened.ino !== st.ino ||
            opened.dev !== st.dev ||
            opened.size !== st.size
          ) {
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
          if (replay.terminal._tag !== "CleanEof") {
            // Tolerant: proceed with valid prefix only (matches shell).
            return {
              _tag: "Ok" as const,
              records: replay.records,
            };
          }
          return {
            _tag: "Ok" as const,
            records: replay.records as readonly ReplayRecord[],
          };
        } catch {
          return { _tag: "Corrupt" as const };
        } finally {
          if (fd !== undefined) {
            try {
              closeSync(fd);
            } catch {
              /* ignore */
            }
          }
        }
      }),
  });
}

/**
 * Live RunDiscovery: list child directories of runs/ as run ids.
 */
export function makeLiveRunDiscovery(
  stateRoot: string,
): Layer.Layer<RunDiscovery> {
  return Layer.succeed(RunDiscovery, {
    listRuns: () =>
      Effect.sync(() => {
        const runsDir = join(stateRoot, "runs");
        let entries: string[];
        try {
          entries = readdirSync(runsDir);
        } catch {
          return [];
        }
        const out: RunId[] = [];
        for (const name of entries.sort()) {
          const full = join(runsDir, name);
          try {
            if (!statSync(full).isDirectory()) continue;
          } catch {
            continue;
          }
          const id = decodeRunId(name);
          if (typeof id === "string") out.push(id);
        }
        return out;
      }),
  });
}

/**
 * Live per-run lease via exclusive mkdir of `.supervise.lock`.
 * No stale reclaim — busy fails closed.
 */
export function makeLiveRunLease(stateRoot: string): Layer.Layer<RunLease> {
  return Layer.succeed(RunLease, {
    acquire: (runId) =>
      Effect.sync(() => {
        const rd = runDir(stateRoot, runId);
        try {
          mkdirSync(rd, { recursive: true });
        } catch {
          return { _tag: "Busy" as const };
        }
        const lock = leasePath(stateRoot, runId);
        try {
          mkdirSync(lock, { recursive: false });
        } catch (e) {
          if (isEexist(e)) return { _tag: "Busy" as const };
          return { _tag: "Busy" as const };
        }
        let owned = true;
        return {
          _tag: "Held" as const,
          release: () =>
            Effect.sync(() => {
              if (!owned) return;
              owned = false;
              try {
                rmdirSync(lock);
              } catch {
                /* ignore */
              }
            }),
        };
      }),
  });
}

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
