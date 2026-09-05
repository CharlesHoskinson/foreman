/**
 * Effect services for child lifetime, timers, streams, heartbeat, and host
 * boundaries. Tests inject fakes; live code provides Node implementations.
 * process.execve is only used through ExecveService — never in tests.
 */

import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  accessSync,
  constants as fsConstants,
} from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import {
  formatHeartbeatLine,
  type HeartbeatLine,
} from "./heartbeat.js";
import {
  UNSHARE_PROBE_LADDER,
  classifyProbeFailure,
  formatAttempts,
  type ExecveRequest,
  type TaskkillRequest,
  type UnshareProbeResult,
} from "./platform.js";
import type { CapabilityRecord, ProbeAttempt } from "./capability.js";


export type StreamChunk = Uint8Array;

export type SpawnedChild = {
  readonly pid: number;
  /**
   * Wait for child exit. Asynchronous Node spawn failures surface as
   * SpawnError (not a fake child exit code).
   */
  readonly wait: () => Effect.Effect<number, SpawnError>;
  readonly stdout: AsyncIterable<StreamChunk> | null;
  readonly stderr: AsyncIterable<StreamChunk> | null;
  /** Best-effort direct kill of the root child only (not the tree). */
  readonly killSelf: (signal?: NodeJS.Signals) => Effect.Effect<void>;
};

export type SpawnRequest = {
  readonly file: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly detachedProcessGroup: boolean;
  readonly windowsHide: boolean;
};

export class ChildSpawner extends Context.Tag("ChildSpawner")<
  ChildSpawner,
  {
    readonly spawn: (req: SpawnRequest) => Effect.Effect<SpawnedChild, SpawnError>;
  }
>() {}

export type SpawnError = {
  readonly _tag: "SpawnError";
  readonly message: string;
};

export class ProcessGroupTerminator extends Context.Tag("ProcessGroupTerminator")<
  ProcessGroupTerminator,
  {
    /** Signal the process group by negative PID on POSIX. */
    readonly killGroup: (
      leaderPid: number,
      signal: NodeJS.Signals,
    ) => Effect.Effect<void>;
  }
>() {}

export class WindowsTreeTerminator extends Context.Tag("WindowsTreeTerminator")<
  WindowsTreeTerminator,
  {
    readonly terminateTree: (req: TaskkillRequest) => Effect.Effect<void>;
  }
>() {}

export class ExecveService extends Context.Tag("ExecveService")<
  ExecveService,
  {
    /**
     * Replace the current process image. On success this never returns.
     * Tests must record the request and return a failure instead of replacing
     * the test runner.
     */
    readonly execve: (
      req: ExecveRequest,
    ) => Effect.Effect<never, { readonly _tag: "ExecveFailed"; readonly message: string }>;
  }
>() {}

export class UnshareProbeService extends Context.Tag("UnshareProbeService")<
  UnshareProbeService,
  {
    readonly probe: () => Effect.Effect<UnshareProbeResult>;
  }
>() {}

export class HeartbeatWriter extends Context.Tag("HeartbeatWriter")<
  HeartbeatWriter,
  {
    readonly reset: (path: string) => Effect.Effect<void, HeartbeatWriteError>;
    readonly appendLine: (
      path: string,
      line: HeartbeatLine,
    ) => Effect.Effect<void, HeartbeatWriteError>;
    readonly readText: (path: string) => Effect.Effect<string, HeartbeatWriteError>;
  }
>() {}

export class CapabilityWriter extends Context.Tag("CapabilityWriter")<
  CapabilityWriter,
  {
    readonly write: (
      path: string,
      record: CapabilityRecord,
    ) => Effect.Effect<void, CapabilityWriteError>;
  }
>() {}

export type CapabilityWriteError = {
  readonly _tag: "CapabilityWriteError";
  readonly message: string;
};

export type HeartbeatWriteError = {
  readonly _tag: "HeartbeatWriteError";
  readonly message: string;
};

export class ByteSink extends Context.Tag("ByteSink")<
  ByteSink,
  {
    readonly writeStdout: (chunk: StreamChunk) => Effect.Effect<void>;
    readonly writeStderr: (chunk: StreamChunk) => Effect.Effect<void>;
  }
>() {}

export class LauncherClock extends Context.Tag("LauncherClock")<
  LauncherClock,
  {
    readonly nowMs: () => Effect.Effect<number>;
    /**
     * Sleep for ms, interruptible. Tests may use a controllable scheduler.
     */
    readonly sleep: (ms: number) => Effect.Effect<void>;
  }
>() {}

export class DetachSpawner extends Context.Tag("DetachSpawner")<
  DetachSpawner,
  {
    /** Spawn a detached self-copy for --detach handoff. */
    readonly spawnDetachedSelf: (
      argv: readonly string[],
    ) => Effect.Effect<{ readonly pid: number }, SpawnError>;
  }
>() {}

export class StderrLog extends Context.Tag("StderrLog")<
  StderrLog,
  {
    readonly write: (line: string) => Effect.Effect<void>;
  }
>() {}

/** Live wall-clock implementation. */
export const liveClock: Context.Tag.Service<typeof LauncherClock> = {
  nowMs: () => Effect.sync(() => Date.now()),
  sleep: (ms) =>
    Effect.async<void>((resume) => {
      const t = setTimeout(() => resume(Effect.void), ms);
      return Effect.sync(() => {
        clearTimeout(t);
      });
    }),
};

export const LiveClockLayer = Layer.succeed(LauncherClock, liveClock);

// --- Live Node implementations ---

function whichAbsolute(name: string, pathEnv: string | undefined): string | null {
  if (!pathEnv) return null;
  const parts = pathEnv.split(process.platform === "win32" ? ";" : ":");
  for (const dir of parts) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      /* continue */
    }
  }
  return null;
}

async function* nodeReadableToAsync(
  stream: NodeJS.ReadableStream | null,
): AsyncIterable<StreamChunk> {
  if (!stream) return;
  for await (const chunk of stream) {
    if (typeof chunk === "string") {
      yield Buffer.from(chunk);
    } else {
      yield chunk as Uint8Array;
    }
  }
}

function wrapChild(child: ChildProcess): SpawnedChild {
  const pid = child.pid ?? 0;
  return {
    pid,
    wait: () =>
      Effect.async<number, SpawnError>((resume) => {
        let settled = false;
        const onError = (err: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          resume(
            Effect.fail({
              _tag: "SpawnError",
              message: err.message || "spawn error",
            }),
          );
        };
        const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (signal) {
            resume(Effect.succeed(1));
          } else {
            resume(Effect.succeed(code ?? 0));
          }
        };
        const cleanup = () => {
          child.off("error", onError);
          child.off("exit", onExit);
        };
        child.once("error", onError);
        child.once("exit", onExit);
        return Effect.sync(cleanup);
      }),
    stdout: nodeReadableToAsync(child.stdout),
    stderr: nodeReadableToAsync(child.stderr),
    killSelf: (signal = "SIGKILL") =>
      Effect.sync(() => {
        try {
          child.kill(signal);
        } catch {
          /* best-effort */
        }
      }),
  };
}

export const liveChildSpawner: Context.Tag.Service<typeof ChildSpawner> = {
  spawn: (req) =>
    Effect.try({
      try: () => {
        const child = spawn(req.file, [...req.args], {
          stdio: ["ignore", "pipe", "pipe"],
          detached: req.detachedProcessGroup,
          windowsHide: req.windowsHide,
          env: req.env ? { ...process.env, ...req.env } : process.env,
        });
        return wrapChild(child);
      },
      catch: (e): SpawnError => ({
        _tag: "SpawnError",
        message: e instanceof Error ? e.message : String(e),
      }),
    }),
};

export const liveProcessGroupTerminator: Context.Tag.Service<
  typeof ProcessGroupTerminator
> = {
  killGroup: (leaderPid, signal) =>
    Effect.sync(() => {
      try {
        process.kill(-leaderPid, signal);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== "ESRCH") {
          /* best-effort */
        }
      }
    }),
};

export const liveWindowsTreeTerminator: Context.Tag.Service<
  typeof WindowsTreeTerminator
> = {
  terminateTree: (req: TaskkillRequest) =>
    Effect.sync(() => {
      const child = spawn(req.executable, [...req.argv.slice(1)], {
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
    }),
};

export const liveExecve: Context.Tag.Service<typeof ExecveService> = {
  execve: (req: ExecveRequest) =>
    Effect.suspend(() => {
      const execve = (
        process as NodeJS.Process & {
          execve?: (
            path: string,
            args?: readonly string[],
            env?: NodeJS.ProcessEnv,
          ) => never;
        }
      ).execve;
      if (typeof execve !== "function") {
        return Effect.fail({
          _tag: "ExecveFailed" as const,
          message: "process.execve unavailable",
        });
      }
      try {
        execve(req.path, [...req.argv], { ...req.env });
        return Effect.fail({
          _tag: "ExecveFailed" as const,
          message: "execve returned unexpectedly",
        });
      } catch (e) {
        return Effect.fail({
          _tag: "ExecveFailed" as const,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }) as Effect.Effect<
      never,
      { readonly _tag: "ExecveFailed"; readonly message: string }
    >,
};

export const liveUnshareProbe: Context.Tag.Service<typeof UnshareProbeService> = {
  probe: () =>
    Effect.sync((): UnshareProbeResult => {
      const unsharePath = whichAbsolute("unshare", process.env.PATH);
      if (!unsharePath) {
        return {
          _tag: "Failed",
          unsharePath: null,
          reason: "unshare_missing",
          detail: "unshare not found on PATH",
          attempts: [],
        };
      }
      const attempts: ProbeAttempt[] = [];
      for (const entry of UNSHARE_PROBE_LADDER) {
        const probe = spawnSync(
          unsharePath,
          [...entry.flags, "--", "true"],
          {
          stdio: ["ignore", "ignore", "pipe"],
          env: process.env,
          encoding: "utf8",
            timeout: 10_000,
          },
        );
        const rawStderr = String(probe.stderr || probe.error?.message || "")
          .replace(/[\r\n]+/g, " ")
          .trim();
        const truncated = Buffer.from(rawStderr)
          .subarray(0, 200)
          .toString("utf8")
          .replace(/\uFFFD$/u, "")
          .trim();
        attempts.push({
          flags: entry.flags,
          status: probe.status,
          signal: probe.signal,
          stderr: truncated,
        });
        if (probe.status === 0) {
          return {
            _tag: "Ok",
            unsharePath,
            kind: entry.kind,
            flags: entry.flags,
            attempts,
          };
        }
      }
      return {
        _tag: "Failed",
        unsharePath,
        reason: classifyProbeFailure(attempts),
        detail: formatAttempts(attempts) || "unshare probe failed",
        attempts,
      };
    }),
};

export const liveCapabilityWriter: Context.Tag.Service<typeof CapabilityWriter> = {
  write: (path, record) =>
    Effect.try({
      try: () => {
        writeFileSync(path, JSON.stringify(record) + "\n");
      },
      catch: (e): CapabilityWriteError => ({
        _tag: "CapabilityWriteError",
        message: e instanceof Error ? e.message : String(e),
      }),
    }),
};

export const liveHeartbeatWriter: Context.Tag.Service<typeof HeartbeatWriter> = {
  reset: (path) =>
    Effect.try({
      try: () => {
        writeFileSync(path, "");
      },
      catch: (e) => ({
        _tag: "HeartbeatWriteError" as const,
        message: e instanceof Error ? e.message : String(e),
      }),
    }),
  appendLine: (path, line: HeartbeatLine) =>
    Effect.try({
      try: () => {
        appendFileSync(path, formatHeartbeatLine(line));
      },
      catch: (e) => ({
        _tag: "HeartbeatWriteError" as const,
        message: e instanceof Error ? e.message : String(e),
      }),
    }),
  readText: (path) =>
    Effect.try({
      try: () => readFileSync(path, "utf8"),
      catch: (e) => ({
        _tag: "HeartbeatWriteError" as const,
        message: e instanceof Error ? e.message : String(e),
      }),
    }),
};

/**
 * Await Node stream write completion. When write() returns false (buffer full),
 * also wait for the drain event so the next sequential write is not issued under
 * backpressure. Callers must not process.exit while these Effects may still run.
 */
function writeStream(
  stream: NodeJS.WriteStream,
  chunk: StreamChunk,
): Effect.Effect<void> {
  return Effect.async<void>((resume) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      stream.off("drain", finish);
      resume(Effect.void);
    };
    let accepted = false;
    accepted = stream.write(chunk, () => {
      // Chunk fully handed to the kernel. If the buffer was full we still wait
      // for drain so backpressure is observed before this Effect completes.
      if (accepted) finish();
    });
    if (!accepted) {
      stream.once("drain", finish);
    }
    return Effect.sync(() => {
      stream.off("drain", finish);
    });
  });
}

export const liveByteSink: Context.Tag.Service<typeof ByteSink> = {
  writeStdout: (chunk) => writeStream(process.stdout, chunk),
  writeStderr: (chunk) => writeStream(process.stderr, chunk),
};

export const liveStderrLog: Context.Tag.Service<typeof StderrLog> = {
  write: (line) =>
    Effect.sync(() => {
      process.stderr.write(line.endsWith("\n") ? line : line + "\n");
    }),
};

export const liveDetachSpawner: Context.Tag.Service<typeof DetachSpawner> = {
  spawnDetachedSelf: (argv) =>
    Effect.try({
      try: () => {
        const child = spawn(process.execPath, [...argv], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          env: process.env,
        });
        child.unref();
        return { pid: child.pid ?? 0 };
      },
      catch: (e): SpawnError => ({
        _tag: "SpawnError",
        message: e instanceof Error ? e.message : String(e),
      }),
    }),
};

export const LiveLauncherLayer = Layer.mergeAll(
  Layer.succeed(ChildSpawner, liveChildSpawner),
  Layer.succeed(ProcessGroupTerminator, liveProcessGroupTerminator),
  Layer.succeed(WindowsTreeTerminator, liveWindowsTreeTerminator),
  Layer.succeed(ExecveService, liveExecve),
  Layer.succeed(UnshareProbeService, liveUnshareProbe),
  Layer.succeed(CapabilityWriter, liveCapabilityWriter),
  Layer.succeed(HeartbeatWriter, liveHeartbeatWriter),
  Layer.succeed(ByteSink, liveByteSink),
  Layer.succeed(StderrLog, liveStderrLog),
  Layer.succeed(DetachSpawner, liveDetachSpawner),
  LiveClockLayer,
);
