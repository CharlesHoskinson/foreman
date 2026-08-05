/**
 * Effect-scoped child supervision: streams, heartbeats, graded stop, one
 * termination, timer cleanup, no double completion. Child lifetime is bound to
 * Effect interruption via finalizers and injectable host kill services.
 */

import { Effect, Fiber, Ref } from "effect";
import {
  buildHeartbeatLine,
  formatHeartbeatLine,
  type HeartbeatLine,
} from "./heartbeat.js";
import { planTaskkill, processGroupKillTarget } from "./platform.js";
import {
  ByteSink,
  ChildSpawner,
  HeartbeatWriter,
  LauncherClock,
  ProcessGroupTerminator,
  WindowsTreeTerminator,
  type SpawnedChild,
} from "./services.js";

export type LaunchEventType =
  | "spawned"
  | "heartbeat"
  | "grace"
  | "killed"
  | "exited";

export type LaunchEvent = {
  readonly ts: string;
  readonly type: LaunchEventType;
  readonly pid?: number;
  readonly stdoutBytes?: number;
  readonly stderrBytes?: number;
};

export type SuperviseOptions = {
  readonly cmd: readonly string[];
  readonly timeoutSecs?: number;
  readonly graceSecs: number;
  readonly heartbeatFile?: string;
  readonly heartbeatIntervalSecs: number;
  readonly launcherPid: number;
  readonly platform: NodeJS.Platform;
  readonly onEvent?: (e: LaunchEvent) => void;
  readonly onHeartbeatWriteError?: (err: string) => void;
};

export type SuperviseResult = {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly childPid: number;
  readonly terminationCount: number;
  readonly timersCleared: boolean;
};

async function* emptyStream(): AsyncIterable<Uint8Array> {
  // no chunks
}

async function collectPump(
  src: AsyncIterable<Uint8Array> | null,
  onChunk: (chunk: Uint8Array) => Promise<void>,
): Promise<void> {
  if (!src) return;
  for await (const chunk of src) {
    await onChunk(chunk);
  }
}

function emitEvent(
  opts: SuperviseOptions,
  nowMs: number,
  e: Omit<LaunchEvent, "ts">,
): void {
  opts.onEvent?.({ ts: new Date(nowMs).toISOString(), ...e });
}

/**
 * Supervise one child. Uses Effect services for spawn, kill, clock, streams,
 * and heartbeat I/O. Guarantees single completion, timer cleanup, and exactly
 * one tree termination on timeout or Effect interruption after spawn.
 */
export function supervise(
  opts: SuperviseOptions,
): Effect.Effect<
  SuperviseResult,
  { readonly _tag: "SuperviseError"; readonly message: string },
  | ChildSpawner
  | ProcessGroupTerminator
  | WindowsTreeTerminator
  | HeartbeatWriter
  | ByteSink
  | LauncherClock
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildSpawner;
      const pgKill = yield* ProcessGroupTerminator;
      const winKill = yield* WindowsTreeTerminator;
      const hb = yield* HeartbeatWriter;
      const sink = yield* ByteSink;
      const clock = yield* LauncherClock;

      const startedAt = yield* clock.nowMs();
      const stdoutBytesRef = yield* Ref.make(0);
      const stderrBytesRef = yield* Ref.make(0);
      const exitedRef = yield* Ref.make(false);
      const timedOutRef = yield* Ref.make(false);
      const terminationCountRef = yield* Ref.make(0);
      const completedRef = yield* Ref.make(false);
      const timersClearedRef = yield* Ref.make(false);

      if (opts.cmd.length === 0) {
        return yield* Effect.fail({
          _tag: "SuperviseError" as const,
          message: "empty command",
        });
      }

      const file = opts.cmd[0]!;
      const args = opts.cmd.slice(1);
      const detachedProcessGroup = opts.platform !== "win32";

      const child: SpawnedChild = yield* spawner
        .spawn({
          file,
          args,
          detachedProcessGroup,
          windowsHide: opts.platform === "win32",
        })
        .pipe(
          Effect.mapError((e) => ({
            _tag: "SuperviseError" as const,
            message: e.message,
          })),
        );

      const jobId = String(child.pid);
      emitEvent(opts, startedAt, { type: "spawned", pid: child.pid });

      const terminateTree = Effect.gen(function* () {
        const already = yield* Ref.get(exitedRef);
        if (already) return;
        // Never signal PID 0 / negative: kill(0)/kill(-0) targets the caller's
        // whole process group (catastrophic in tests and live).
        if (!Number.isFinite(child.pid) || child.pid <= 0) {
          yield* Ref.set(exitedRef, true);
          return;
        }
        const count = yield* Ref.updateAndGet(terminationCountRef, (n) => n + 1);
        // Only the first terminateTree call performs the host kill.
        if (count > 1) return;
        const now = yield* clock.nowMs();
        emitEvent(opts, now, { type: "killed", pid: child.pid });
        if (opts.platform === "win32") {
          yield* winKill.terminateTree(planTaskkill(child.pid));
        } else {
          // Negative PID targets the process group.
          void processGroupKillTarget(child.pid);
          yield* pgKill.killGroup(child.pid, "SIGKILL");
        }
      });

      // Bind child lifetime to this scope: interruption or unexpected exit of
      // the scope performs exactly one platform tree termination when the child
      // has not already exited. Uses injectable kill services only.
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const exited = yield* Ref.get(exitedRef);
          if (!exited) {
            yield* terminateTree;
          }
        }).pipe(Effect.ignore),
      );

      const writeHb = (alive: boolean) =>
        Effect.gen(function* () {
          if (!opts.heartbeatFile) return;
          const now = yield* clock.nowMs();
          const stdout_bytes = yield* Ref.get(stdoutBytesRef);
          const stderr_bytes = yield* Ref.get(stderrBytesRef);
          const line: HeartbeatLine = buildHeartbeatLine({
            nowMs: now,
            startedAtMs: startedAt,
            launcherPid: opts.launcherPid,
            childPid: child.pid,
            jobId,
            alive,
            stdoutBytes: stdout_bytes,
            stderrBytes: stderr_bytes,
          });
          // formatHeartbeatLine is pure; write isolates failures
          void formatHeartbeatLine(line);
          const r = yield* Effect.either(hb.appendLine(opts.heartbeatFile, line));
          if (r._tag === "Left") {
            opts.onHeartbeatWriteError?.(r.left.message);
          } else {
            emitEvent(opts, now, {
              type: "heartbeat",
              pid: child.pid,
              stdoutBytes: stdout_bytes,
              stderrBytes: stderr_bytes,
            });
          }
        });

      // Immediate live heartbeat
      yield* writeHb(true);

      const pumpStdout = Effect.tryPromise({
        try: () =>
          collectPump(child.stdout ?? emptyStream(), async (chunk) => {
            await Effect.runPromise(
              Effect.gen(function* () {
                yield* Ref.update(stdoutBytesRef, (n) => n + chunk.byteLength);
                yield* sink.writeStdout(chunk);
              }),
            );
          }),
        catch: (e) => ({
          _tag: "SuperviseError" as const,
          message: e instanceof Error ? e.message : String(e),
        }),
      }).pipe(Effect.ignore);

      const pumpStderr = Effect.tryPromise({
        try: () =>
          collectPump(child.stderr ?? emptyStream(), async (chunk) => {
            await Effect.runPromise(
              Effect.gen(function* () {
                yield* Ref.update(stderrBytesRef, (n) => n + chunk.byteLength);
                yield* sink.writeStderr(chunk);
              }),
            );
          }),
        catch: (e) => ({
          _tag: "SuperviseError" as const,
          message: e instanceof Error ? e.message : String(e),
        }),
      }).pipe(Effect.ignore);

      const stdoutFiber = yield* Effect.fork(pumpStdout);
      const stderrFiber = yield* Effect.fork(pumpStderr);

      const intervalMs = Math.max(1, opts.heartbeatIntervalSecs) * 1000;
      const hbLoop = Effect.gen(function* () {
        for (;;) {
          yield* clock.sleep(intervalMs);
          const exited = yield* Ref.get(exitedRef);
          if (exited) break;
          yield* writeHb(true);
        }
      }).pipe(Effect.interruptible);

      const hbFiber = yield* Effect.fork(hbLoop);

      let timeoutFiber: Fiber.RuntimeFiber<void, never> | undefined;
      if (opts.timeoutSecs !== undefined) {
        const timeoutMs = opts.timeoutSecs * 1000;
        const graceMs = opts.graceSecs * 1000;
        timeoutFiber = yield* Effect.fork(
          Effect.gen(function* () {
            yield* clock.sleep(timeoutMs);
            const exited = yield* Ref.get(exitedRef);
            if (exited) return;
            yield* Ref.set(timedOutRef, true);
            const now = yield* clock.nowMs();
            emitEvent(opts, now, { type: "grace", pid: child.pid });
            yield* clock.sleep(graceMs);
            const exited2 = yield* Ref.get(exitedRef);
            if (exited2) return;
            yield* terminateTree;
          }).pipe(Effect.interruptible),
        );
      }

      // Finalizer: interrupt timer/stream fibers on any scope close.
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* Fiber.interrupt(hbFiber).pipe(Effect.ignore);
          if (timeoutFiber) {
            yield* Fiber.interrupt(timeoutFiber).pipe(Effect.ignore);
          }
          yield* Fiber.interrupt(stdoutFiber).pipe(Effect.ignore);
          yield* Fiber.interrupt(stderrFiber).pipe(Effect.ignore);
          yield* Ref.set(timersClearedRef, true);
        }).pipe(Effect.ignore),
      );

      const exitCode = yield* child.wait().pipe(
        Effect.mapError((e) => ({
          _tag: "SuperviseError" as const,
          message: e.message,
        })),
        // On spawn/wait failure there is no live child to reap; mark exited so
        // the scope finalizer does not attempt a host kill.
        Effect.tapError(() => Ref.set(exitedRef, true)),
      );

      // Single completion gate
      const wasCompleted = yield* Ref.get(completedRef);
      if (wasCompleted) {
        return yield* Effect.fail({
          _tag: "SuperviseError" as const,
          message: "double_completion",
        });
      }
      yield* Ref.set(completedRef, true);
      yield* Ref.set(exitedRef, true);

      // Clear timers / loops on the success path (finalizer is also idempotent).
      yield* Fiber.interrupt(hbFiber).pipe(Effect.ignore);
      if (timeoutFiber) {
        yield* Fiber.interrupt(timeoutFiber).pipe(Effect.ignore);
      }
      yield* Fiber.join(stdoutFiber).pipe(Effect.ignore);
      yield* Fiber.join(stderrFiber).pipe(Effect.ignore);
      yield* Ref.set(timersClearedRef, true);

      yield* writeHb(false);
      const now = yield* clock.nowMs();
      emitEvent(opts, now, { type: "exited", pid: child.pid });

      const timedOut = yield* Ref.get(timedOutRef);
      const terminationCount = yield* Ref.get(terminationCountRef);
      const timersCleared = yield* Ref.get(timersClearedRef);

      return {
        exitCode: exitCode ?? 0,
        timedOut,
        childPid: child.pid,
        terminationCount,
        timersCleared,
      };
    }),
  );
}
