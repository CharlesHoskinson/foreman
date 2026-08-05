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
  planPidnsExecve,
  resolveCapability,
} from "./platform.js";
import { supervise } from "./supervise.js";
import {
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

const defaultIo: MainIo = {
  writeStdout: (t) => {
    process.stdout.write(t);
  },
  writeStderr: (t) => {
    process.stderr.write(t);
  },
  exit: (code) => {
    process.exit(code);
  },
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

    const start = yield* clock.nowMs();
    const deadline = start + DETACH_HANDOFF_BOUND_MS;
    for (;;) {
      const now = yield* clock.nowMs();
      if (now >= deadline) break;
      const textE = yield* Effect.either(hb.readText(heartbeatFile));
      if (textE._tag === "Right") {
        const valid = firstValidHeartbeatLine(textE.right);
        if (valid._tag === "Ok") {
          // Refuse stale: reset ensures first valid line is from new copy.
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
  const script = process.argv[1];
  if (script) return [script];
  return [];
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

    if (args.detach) {
      return yield* runDetachHandoff(
        raw,
        args.heartbeatFile as string,
        selfScriptArgvPrefix(),
      );
    }

    const probe =
      process.platform === "win32"
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
      });
      const r = yield* Effect.either(execve.execve(req));
      if (r._tag === "Left") {
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
      process.exit(code);
    })
    .catch((err) => {
      process.stderr.write(
        `foreman-launch: unhandled launcher error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
      );
      process.exit(EXIT_LAUNCHER_ERROR);
    });
}


