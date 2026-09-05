/**
 * Compiled entry: skills/foreman/runtime/dist/foreman-launch.js
 */

import { Effect, Layer } from "effect";
import {
  argvWithoutDetach,
  EXIT_LAUNCHER_ERROR,
  formatVersionLine,
  mapSuperviseExit,
  parseArgs,
  stripNodeArgv,
  usage,
} from "./cli.js";
import {
  DETACH_HANDOFF_BOUND_MS,
  firstValidHeartbeatLine,
} from "./heartbeat.js";
import {
  capabilityRecord,
  formatRefusalLine,
  isPidnsInner,
  isStrong,
  type PlatformCapability,
} from "./capability.js";
import {
  planPidnsExecve,
  resolveCapability,
} from "./platform.js";
import { supervise } from "./supervise.js";
import {
  CapabilityWriter,
  DetachSpawner,
  ExecveService,
  HeartbeatWriter,
  LauncherClock,
  StderrLog,
  UnshareProbeService,
} from "./services.js";
import { LiveLauncherLayer } from "./services.js";

export type MainIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
  readonly exit: (code: number) => void;
};

/**
 * Set exitCode and wait for stdout/stderr drain before forcing process.exit.
 * Avoids truncating child bytes still queued in the Node write buffers.
 */
export function exitWhenStreamsFlushed(code: number): void {
  process.exitCode = code;
  const tryExit = (): void => {
    const stdoutBlocked = process.stdout.writableNeedDrain === true;
    const stderrBlocked = process.stderr.writableNeedDrain === true;
    if (!stdoutBlocked && !stderrBlocked) {
      process.exit(code);
      return;
    }
    if (stdoutBlocked) {
      process.stdout.once("drain", tryExit);
    }
    if (stderrBlocked) {
      process.stderr.once("drain", tryExit);
    }
  };
  // Defer one turn so any in-flight write callbacks can mark needDrain.
  setImmediate(tryExit);
}

const defaultIo: MainIo = {
  writeStdout: (t) => {
    process.stdout.write(t);
  },
  writeStderr: (t) => {
    process.stderr.write(t);
  },
  exit: exitWhenStreamsFlushed,
};

function runDetachHandoff(
  rawArgv: readonly string[],
  heartbeatFile: string,
  selfScriptArgv: readonly string[],
): Effect.Effect<
  number,
  never,
  DetachSpawner | HeartbeatWriter | LauncherClock | StderrLog
> {
  return Effect.gen(function* () {
    const hb = yield* HeartbeatWriter;
    const detach = yield* DetachSpawner;
    const clock = yield* LauncherClock;
    const log = yield* StderrLog;

    const reset = yield* Effect.either(hb.reset(heartbeatFile));
    if (reset._tag === "Left") {
      yield* log.write(
        `foreman-launch: --detach: failed to reset --heartbeat-file before handoff: ${reset.left.message}`,
      );
      return EXIT_LAUNCHER_ERROR;
    }

    const childArgv = [...selfScriptArgv, ...argvWithoutDetach(rawArgv)];
    const spawned = yield* Effect.either(detach.spawnDetachedSelf(childArgv));
    if (spawned._tag === "Left") {
      yield* log.write(
        `foreman-launch: --detach: spawn failed: ${spawned.left.message}`,
      );
      return EXIT_LAUNCHER_ERROR;
    }

    const expectedPid = spawned.right.pid;
    const start = yield* clock.nowMs();
    const deadline = start + DETACH_HANDOFF_BOUND_MS;
    for (;;) {
      const now = yield* clock.nowMs();
      if (now >= deadline) break;
      const textE = yield* Effect.either(hb.readText(heartbeatFile));
      if (textE._tag === "Right") {
        const valid = firstValidHeartbeatLine(textE.right);
        // Accept only a post-reset valid line whose launcher_pid is the PID
        // returned by spawnDetachedSelf. Refuse heartbeats from other launchers.
        if (
          valid._tag === "Ok" &&
          valid.line.launcher_pid === expectedPid
        ) {
          return 0;
        }
      }
      yield* clock.sleep(50);
    }
    yield* log.write(
      "foreman-launch: --detach: timed out waiting for detached copy's first heartbeat",
    );
    return EXIT_LAUNCHER_ERROR;
  });
}

/**
 * Resolve argv that re-executes this same entry when spawned as
 * `node <script> ...`. For the compiled bundle, process.argv[1] is the script.
 */
export function selfScriptArgvPrefix(): string[] {
  return buildSelfScriptArgvPrefix(process.execArgv, process.argv[1]);
}

export function buildSelfScriptArgvPrefix(
  execArgv: readonly string[],
  script: string | undefined,
): string[] {
  return script ? [...execArgv, script] : [...execArgv];
}

export function runMain(
  argv: readonly string[] = process.argv,
  io: MainIo = defaultIo,
  layer: Layer.Layer<
    | import("./services.js").ChildSpawner
    | import("./services.js").ProcessGroupTerminator
    | import("./services.js").WindowsTreeTerminator
    | import("./services.js").HeartbeatWriter
    | import("./services.js").ByteSink
    | LauncherClock
    | ExecveService
    | UnshareProbeService
    | CapabilityWriter
    | DetachSpawner
    | StderrLog
  > = LiveLauncherLayer,
): Promise<number> {
  const raw = stripNodeArgv(argv);
  const parsed = parseArgs(raw);

  if (parsed._tag === "Version") {
    io.writeStdout(formatVersionLine() + "\n");
    return Promise.resolve(0);
  }
  if (parsed._tag === "UsageError") {
    io.writeStderr(`foreman-launch: ${parsed.message}\n`);
    io.writeStderr(usage() + "\n");
    return Promise.resolve(EXIT_LAUNCHER_ERROR);
  }

  const args = parsed.value;

  const program = Effect.gen(function* () {
    const log = yield* StderrLog;
    const probeSvc = yield* UnshareProbeService;
    const execve = yield* ExecveService;
    const capabilityWriter = yield* CapabilityWriter;

    if (args.detach) {
      return yield* runDetachHandoff(
        raw,
        args.heartbeatFile as string,
        selfScriptArgvPrefix(),
      );
    }

    const probe =
      process.platform === "win32" || isPidnsInner(process.env)
        ? null
        : yield* probeSvc.probe();

    const { capability, diagnostic, launcherPid } = resolveCapability({
      platform: process.platform,
      env: process.env,
      processPid: process.pid,
      probe,
    });

    // Capability diagnostic always goes to stderr, never child stdout.
    yield* log.write(diagnostic.message);

    const refusedByPolicy =
      args.requireContainment === "strong" && !isStrong(capability);
    const record = capabilityRecord(
      capability,
      args.requireContainment,
      launcherPid,
      refusedByPolicy,
    );
    if (args.capabilityFile !== undefined) {
      yield* capabilityWriter.write(args.capabilityFile, record);
    }

    if (args.probeOnly) {
      if (refusedByPolicy) {
        yield* log.write(formatRefusalLine(record));
        return EXIT_LAUNCHER_ERROR;
      }
      return 0;
    }

    if (refusedByPolicy) {
      yield* log.write(formatRefusalLine(record));
      return EXIT_LAUNCHER_ERROR;
    }

    if (capability._tag === "Strong") {
      const req = planPidnsExecve({
        unsharePath: capability.unsharePath,
        execPath: process.execPath,
        originalArgs: [
          ...selfScriptArgvPrefix(),
          ...raw,
        ],
        hostPid: capability.hostPid,
        baseEnv: process.env,
        flags: capability.flags,
        kind: capability.kind,
      });
      const r = yield* Effect.either(execve.execve(req));
      if (r._tag === "Left") {
        const failedCapability: PlatformCapability = {
          _tag: "Degraded",
          kind: "posix_process_group_degraded",
          reason: r.left.message.includes("unavailable")
            ? "execve_unavailable"
            : "execve_failed",
          detail: `execve: ${r.left.message}`,
          attempts: capability.attempts,
        };
        if (args.requireContainment === "strong") {
          const refusedRecord = capabilityRecord(
            failedCapability,
            "strong",
            launcherPid,
            true,
          );
          if (args.capabilityFile !== undefined) {
            yield* capabilityWriter.write(args.capabilityFile, refusedRecord);
          }
          yield* log.write(formatRefusalLine(refusedRecord));
          return EXIT_LAUNCHER_ERROR;
        }
        if (args.capabilityFile !== undefined) {
          yield* capabilityWriter.write(
            args.capabilityFile,
            capabilityRecord(failedCapability, "any", launcherPid, false),
          );
        }
        yield* log.write(
          `foreman-launch: unshare exec failed (execve: ${r.left.message}) -- DEGRADED: falling back to process-group, no kernel pidns cascade guarantee`,
        );
      }
      // If execve succeeds it never returns; failure falls through to supervise.
    }

    const superviseOpts: import("./supervise.js").SuperviseOptions = {
      cmd: args.cmd,
      graceSecs: args.graceSecs,
      heartbeatIntervalSecs: args.heartbeatIntervalSecs,
      launcherPid,
      platform: process.platform,
      ...(args.timeoutSecs !== undefined
        ? { timeoutSecs: args.timeoutSecs }
        : {}),
      ...(args.heartbeatFile !== undefined
        ? { heartbeatFile: args.heartbeatFile }
        : {}),
    };
    const result = yield* supervise(superviseOpts).pipe(
      Effect.mapError((e) => e),
    );

    return mapSuperviseExit(result);
  }).pipe(
    Effect.catchAll((e) =>
      Effect.gen(function* () {
        const log = yield* StderrLog;
        const msg =
          e && typeof e === "object" && "message" in e
            ? String((e as { message: string }).message)
            : String(e);
        yield* log.write(`foreman-launch: launcher error: ${msg}`);
        return EXIT_LAUNCHER_ERROR;
      }),
    ),
  );

  return Effect.runPromise(program.pipe(Effect.provide(layer)));
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("foreman-launch.js") ||
    process.argv[1].endsWith("main.ts") ||
    process.argv[1].includes("foreman-launch"));

if (isMain) {
  runMain()
    .then((code) => {
      exitWhenStreamsFlushed(code);
    })
    .catch((err) => {
      process.stderr.write(
        `foreman-launch: unhandled launcher error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
      );
      exitWhenStreamsFlushed(EXIT_LAUNCHER_ERROR);
    });
}
