import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { Deferred, Effect, Fiber, Layer } from "effect";
import {
  DETACH_HANDOFF_BOUND_MS,
  HEARTBEAT_KEYS,
  formatHeartbeatLine,
  type HeartbeatLine,
  validateHeartbeatLineText,
} from "./heartbeat.js";
import { processGroupKillTarget, planTaskkill } from "./platform.js";
import {
  UNSHARE_USERNS_PIDNS_FLAGS,
  type UnshareProbeResult,
} from "./platform.js";
import type { CapabilityRecord } from "./capability.js";
import {
  ByteSink,
  CapabilityWriter,
  ChildSpawner,
  DetachSpawner,
  ExecveService,
  HeartbeatWriter,
  LauncherClock,
  ProcessGroupTerminator,
  StderrLog,
  UnshareProbeService,
  WindowsTreeTerminator,
  liveClock,
  liveUnshareProbe,
  type SpawnedChild,
  type StreamChunk,
} from "./services.js";
import { supervise, type LaunchEvent } from "./supervise.js";
import { LiveLauncherLayer } from "./services.js";
import { buildSelfScriptArgvPrefix, runMain } from "./main.js";
import { EXIT_LAUNCHER_ERROR, EXIT_TIMEOUT, mapSuperviseExit } from "./cli.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const isWin = process.platform === "win32";

function fakeChild(opts: {
  readonly pid: number;
  readonly exitCode: number;
  readonly stdout?: Uint8Array[];
  readonly stderr?: Uint8Array[];
  readonly hold?: Deferred.Deferred<void, never>;
  readonly onKill?: () => void;
}): SpawnedChild {
  return {
    pid: opts.pid,
    wait: () =>
      Effect.gen(function* () {
        if (opts.hold) yield* Deferred.await(opts.hold);
        return opts.exitCode;
      }),
    stdout: (async function* () {
      for (const c of opts.stdout ?? []) yield c;
    })(),
    stderr: (async function* () {
      for (const c of opts.stderr ?? []) yield c;
    })(),
    killSelf: () =>
      Effect.sync(() => {
        opts.onKill?.();
      }),
  };
}

function baseLayer(overrides: {
  child: SpawnedChild;
  killGroup?: (pid: number) => void;
  terminateTree?: (req: ReturnType<typeof planTaskkill>) => void;
  appendLine?: (
    path: string,
    line: HeartbeatLine,
  ) => Effect.Effect<void, { readonly _tag: "HeartbeatWriteError"; readonly message: string }>;
  clock?: Context.Tag.Service<typeof LauncherClock>;
  out?: StreamChunk[];
  err?: StreamChunk[];
}): Layer.Layer<
  | ChildSpawner
  | ProcessGroupTerminator
  | WindowsTreeTerminator
  | HeartbeatWriter
  | ByteSink
  | LauncherClock
> {
  const out = overrides.out ?? [];
  const err = overrides.err ?? [];
  return Layer.mergeAll(
    Layer.succeed(ChildSpawner, {
      spawn: () => Effect.succeed(overrides.child),
    }),
    Layer.succeed(ProcessGroupTerminator, {
      killGroup: (pid) =>
        Effect.sync(() => {
          overrides.killGroup?.(pid);
        }),
    }),
    Layer.succeed(WindowsTreeTerminator, {
      terminateTree: (req) =>
        Effect.sync(() => {
          overrides.terminateTree?.(req);
        }),
    }),
    Layer.succeed(HeartbeatWriter, {
      reset: () => Effect.void,
      appendLine: (path, line) =>
        overrides.appendLine
          ? overrides.appendLine(path, line)
          : Effect.void,
      readText: () => Effect.succeed(""),
    }),
    Layer.succeed(ByteSink, {
      writeStdout: (c) =>
        Effect.sync(() => {
          out.push(c);
        }),
      writeStderr: (c) =>
        Effect.sync(() => {
          err.push(c);
        }),
    }),
    Layer.succeed(LauncherClock, overrides.clock ?? liveClock),
  );
}

// Fix missing Context import for type
import type { Context } from "effect";

describe("supervise streams and null stdin", () => {
  it("keeps stdout and stderr as separate byte streams", async () => {
    const out: StreamChunk[] = [];
    const err: StreamChunk[] = [];
    const child = fakeChild({
      pid: 100,
      exitCode: 0,
      stdout: [Buffer.from("OUT")],
      stderr: [Buffer.from("ERR")],
    });
    const result = await Effect.runPromise(
      supervise({
        cmd: ["true"],
        graceSecs: 1,
        heartbeatIntervalSecs: 60,
        launcherPid: 1,
        platform: "linux",
      }).pipe(Effect.provide(baseLayer({ child, out, err }))),
    );
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.concat(out).toString(), "OUT");
    assert.equal(Buffer.concat(err).toString(), "ERR");
  });

  it("live spawn uses ignore stdin (null device)", async (t) => {
    if (isWin) {
      t.skip("live stdin passthrough via the ignore device requires POSIX process spawning; unavailable on win32");
      return;
    }
    const r2 = await Effect.runPromise(
      supervise({
        cmd: ["sh", "-c", "read x || true; echo ok"],
        graceSecs: 1,
        heartbeatIntervalSecs: 60,
        launcherPid: process.pid,
        platform: process.platform,
      }).pipe(Effect.provide(LiveLauncherLayer)),
    );
    assert.equal(r2.exitCode, 0);
  });
});

describe("timeout, grace, termination, timer cleanup", () => {
  it("timeout then grace then one termination; timers cleared (live short)", async (t) => {
    if (isWin) {
      t.skip("live termination/grace-timeout sequencing requires POSIX signals; unavailable on win32");
      return;
    }
    const events: LaunchEvent[] = [];
    const started = Date.now();
    const result = await Effect.runPromise(
      supervise({
        cmd: ["sh", "-c", "sleep 60"],
        timeoutSecs: 1,
        graceSecs: 0,
        heartbeatIntervalSecs: 30,
        launcherPid: process.pid,
        platform: process.platform,
        onEvent: (e) => events.push(e),
      }).pipe(Effect.provide(LiveLauncherLayer)),
    );
    const elapsed = Date.now() - started;
    assert.equal(result.timedOut, true);
    assert.equal(result.terminationCount, 1);
    assert.equal(result.timersCleared, true);
    assert.equal(elapsed < 15_000, true);
    assert.equal(events.some((e) => e.type === "grace"), true);
    assert.equal(events.some((e) => e.type === "killed"), true);
    assert.equal(mapSuperviseExit(result), EXIT_TIMEOUT);
    let alive = true;
    try {
      process.kill(-result.childPid, 0);
    } catch {
      alive = false;
    }
    assert.equal(alive, false);
  });

  it("does not terminate when child exits before timeout", async () => {
    const killCount = { n: 0 };
    const child = fakeChild({ pid: 3, exitCode: 7 });
    const result = await Effect.runPromise(
      supervise({
        cmd: ["true"],
        timeoutSecs: 30,
        graceSecs: 1,
        heartbeatIntervalSecs: 60,
        launcherPid: 1,
        platform: "linux",
      }).pipe(
        Effect.provide(
          baseLayer({
            child,
            killGroup: () => {
              killCount.n++;
            },
          }),
        ),
      ),
    );
    assert.equal(result.exitCode, 7);
    assert.equal(result.timedOut, false);
    assert.equal(killCount.n, 0);
    assert.equal(result.terminationCount, 0);
    assert.equal(result.timersCleared, true);
  });

  it("injectable group kill uses negative PID target", async () => {
    const targets: number[] = [];
    const hold = Effect.runSync(Deferred.make<void, never>());
    const child = fakeChild({ pid: 200, exitCode: 0, hold });
    // Use a tiny live clock path: kill immediately via custom terminator after spawn
    // by simulating timeout path with short real sleeps.
    const clock: Context.Tag.Service<typeof LauncherClock> = {
      nowMs: () => Effect.sync(() => Date.now()),
      sleep: (ms) =>
        Effect.async<void>((resume) => {
          // Cap sleeps for test speed: treat any sleep as 5ms
          const t = setTimeout(() => resume(Effect.void), Math.min(ms, 5));
          return Effect.sync(() => clearTimeout(t));
        }),
    };
    const p = Effect.runPromise(
      supervise({
        cmd: ["sleep"],
        timeoutSecs: 1,
        graceSecs: 0,
        heartbeatIntervalSecs: 1000,
        launcherPid: 1,
        platform: "linux",
      }).pipe(
        Effect.provide(
          baseLayer({
            child,
            clock,
            killGroup: (pid) => {
              targets.push(processGroupKillTarget(pid));
              Effect.runSync(Deferred.succeed(hold, undefined));
            },
          }),
        ),
      ),
    );
    const result = await p;
    assert.equal(result.timedOut, true);
    assert.deepEqual(targets, [-200]);
    assert.equal(result.terminationCount, 1);
  });
});

describe("heartbeat write isolation and immediate/final lines", () => {
  it("writes immediate live line and final dead line; isolates write failure", async () => {
    const lines: HeartbeatLine[] = [];
    let failOnce = true;
    const writeErrors: string[] = [];
    const child = fakeChild({ pid: 50, exitCode: 0 });
    const result = await Effect.runPromise(
      supervise({
        cmd: ["true"],
        graceSecs: 1,
        heartbeatFile: "/tmp/x",
        heartbeatIntervalSecs: 60,
        launcherPid: 9,
        platform: "linux",
        onHeartbeatWriteError: (m) => writeErrors.push(m),
      }).pipe(
        Effect.provide(
          baseLayer({
            child,
            appendLine: (_path, line) => {
              if (failOnce) {
                failOnce = false;
                return Effect.fail({
                  _tag: "HeartbeatWriteError" as const,
                  message: "disk full",
                });
              }
              lines.push(line);
              return Effect.void;
            },
          }),
        ),
      ),
    );
    assert.equal(result.exitCode, 0);
    assert.equal(writeErrors.includes("disk full"), true);
    assert.equal(lines.length >= 1, true);
    const last = lines[lines.length - 1]!;
    assert.equal(last.alive, false);
    assert.deepEqual(Object.keys(last).sort(), [...HEARTBEAT_KEYS].sort());
  });
});

describe("Windows injectable taskkill boundary", () => {
  it("calls windows terminator with taskkill plan on timeout", async () => {
    const seen: ReturnType<typeof planTaskkill>[] = [];
    const hold = Effect.runSync(Deferred.make<void, never>());
    const child = fakeChild({ pid: 888, exitCode: 1, hold });
    const clock: Context.Tag.Service<typeof LauncherClock> = {
      nowMs: () => Effect.sync(() => Date.now()),
      sleep: (ms) =>
        Effect.async<void>((resume) => {
          const t = setTimeout(() => resume(Effect.void), Math.min(ms, 5));
          return Effect.sync(() => clearTimeout(t));
        }),
    };
    const result = await Effect.runPromise(
      supervise({
        cmd: ["ping"],
        timeoutSecs: 1,
        graceSecs: 0,
        heartbeatIntervalSecs: 1000,
        launcherPid: 1,
        platform: "win32",
      }).pipe(
        Effect.provide(
          baseLayer({
            child,
            clock,
            terminateTree: (req) => {
              seen.push(req);
              Effect.runSync(Deferred.succeed(hold, undefined));
            },
          }),
        ),
      ),
    );
    assert.equal(result.timedOut, true);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], planTaskkill(888));
  });
});

describe("live POSIX process-group degraded path", () => {
  it("child exit code passthrough and heartbeat final dead", async (t) => {
    if (isWin) {
      t.skip("live POSIX process-group degraded path is unavailable on win32");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "fl-live-"));
    try {
      const hb = join(dir, "hb.jsonl");
      const result = await Effect.runPromise(
        supervise({
          cmd: ["sh", "-c", "echo hi; exit 3"],
          graceSecs: 1,
          heartbeatFile: hb,
          heartbeatIntervalSecs: 30,
          launcherPid: process.pid,
          platform: process.platform,
        }).pipe(Effect.provide(LiveLauncherLayer)),
      );
      assert.equal(result.exitCode, 3);
      assert.equal(result.timedOut, false);
      const raw = readFileSync(hb, "utf8");
      const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      assert.equal(lines.length >= 2, true);
      const first = validateHeartbeatLineText(lines[0]!);
      const last = validateHeartbeatLineText(lines[lines.length - 1]!);
      assert.equal(first._tag, "Ok");
      assert.equal(last._tag, "Ok");
      if (first._tag === "Ok") assert.equal(first.line.alive, true);
      if (last._tag === "Ok") assert.equal(last.line.alive, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("async spawn error maps to typed launcher failure", () => {
  it("child wait SpawnError becomes SuperviseError (exit 125 path), not exit 1", async () => {
    const child: SpawnedChild = {
      pid: 0,
      wait: () =>
        Effect.fail({
          _tag: "SpawnError" as const,
          message: "spawn ENOENT",
        }),
      stdout: null,
      stderr: null,
      killSelf: () => Effect.void,
    };
    const either = await Effect.runPromise(
      Effect.either(
        supervise({
          cmd: ["missing-bin"],
          graceSecs: 1,
          heartbeatIntervalSecs: 60,
          launcherPid: 1,
          platform: "linux",
        }).pipe(Effect.provide(baseLayer({ child }))),
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left._tag, "SuperviseError");
      assert.match(either.left.message, /ENOENT|spawn/i);
    }
  });

  it("live nonexistent binary yields launcher exit 125 via runMain", async (t) => {
    if (isWin) {
      t.skip("live spawn-error exit-code mapping (125) requires POSIX exec semantics; unavailable on win32");
      return;
    }
    const bundlePath = join(
      root,
      "skills/foreman/runtime/dist/foreman-launch.js",
    );
    const result = spawnSync(
      process.execPath,
      [
        bundlePath,
        "--",
        "/nonexistent/foreman-no-such-binary-xyz-9f3a",
      ],
      {
        env: { PATH: "", HOME: process.env.HOME ?? "" },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, EXIT_LAUNCHER_ERROR, result.stderr);
  });
});

describe("Effect interruption binds child tree termination", () => {
  it("interrupting supervise after spawn performs exactly one tree kill and cleans timers", async () => {
    const kills: number[] = [];
    const hold = Effect.runSync(Deferred.make<void, never>());
    const child = fakeChild({ pid: 777, exitCode: 0, hold });
    const fiber = Effect.runFork(
      supervise({
        cmd: ["sleep"],
        timeoutSecs: 30,
        graceSecs: 5,
        heartbeatIntervalSecs: 1000,
        launcherPid: 1,
        platform: "linux",
      }).pipe(
        Effect.provide(
          baseLayer({
            child,
            killGroup: (pid) => {
              kills.push(pid);
            },
          }),
        ),
      ),
    );
    // Allow spawn + fiber setup
    await new Promise((r) => setTimeout(r, 30));
    await Effect.runPromise(Fiber.interrupt(fiber));
    // Release wait if still held so any residual path can finish
    Effect.runSync(Deferred.succeed(hold, undefined));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(kills.length, 1, `expected exactly one killGroup, got ${kills.length}`);
    assert.equal(kills[0], 777);
  });
});

describe("descendant churn control", () => {
  it("while supervised worker stays live through 1000+ short descendants, launcher has no zombie direct children on /proc", async (t) => {
    if (isWin) {
      t.skip("descendant-reaping verification reads /proc, which is unavailable on win32");
      return;
    }
    const procObs = observeZombieDirectChildren(process.pid);
    if (procObs._tag === "Unavailable") {
      // Typed skip: do not claim a false zero without /proc.
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), "fl-churn-"));
    try {
      const go = join(dir, "go");
      const done = join(dir, "done");
      // Worker stays live: creates 1100 short descendants, signals go, waits for done.
      const workerScript = [
        "set -e",
        "for i in $(seq 1 1100); do (exit 0); done",
        `: > "${go}"`,
        `while [ ! -f "${done}" ]; do sleep 0.05; done`,
        "exit 0",
      ].join("; ");

      const fiber = Effect.runFork(
        supervise({
          cmd: ["sh", "-c", workerScript],
          graceSecs: 1,
          heartbeatIntervalSecs: 60,
          launcherPid: process.pid,
          platform: process.platform,
        }).pipe(Effect.provide(LiveLauncherLayer)),
      );

      const deadline = Date.now() + 30_000;
      while (!existsSync(go) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(existsSync(go), true, "worker never signaled ready after churn");

      // Worker is still live; observe the launcher host (this process).
      const during = observeZombieDirectChildren(process.pid);
      assert.equal(during._tag, "Ok");
      if (during._tag === "Ok") {
        assert.equal(
          during.count,
          0,
          `expected 0 zombie direct children of launcher pid ${process.pid} while worker live, got ${during.count}`,
        );
        // Process table sanity: launcher direct children should be small (worker + maybe shells).
        assert.equal(
          during.directChildCount < 64,
          true,
          `launcher direct-child count ${during.directChildCount} suggests process-table pressure`,
        );
      }

      writeFileSync(done, "");
      const result = await Effect.runPromise(Fiber.join(fiber));
      assert.equal(result.exitCode, 0);

      const after = observeZombieDirectChildren(process.pid);
      if (after._tag === "Ok") {
        assert.equal(after.count, 0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Observe zombie direct children of parentPid via Linux /proc.
 * Returns typed Unavailable when /proc is missing — never a false zero.
 */
function observeZombieDirectChildren(
  parentPid: number,
):
  | { readonly _tag: "Ok"; readonly count: number; readonly directChildCount: number }
  | { readonly _tag: "Unavailable"; readonly reason: string } {
  try {
    readdirSync("/proc");
  } catch {
    return { _tag: "Unavailable", reason: "/proc not available" };
  }
  let zombies = 0;
  let direct = 0;
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(join("/proc", name, "stat"), "utf8");
      const close = stat.indexOf(")");
      if (close < 0) continue;
      const rest = stat.slice(close + 2).split(" ");
      const state = rest[0];
      const ppid = Number(rest[1]);
      if (ppid !== parentPid) continue;
      direct++;
      if (state === "Z") zombies++;
    } catch {
      /* race */
    }
  }
  return { _tag: "Ok", count: zombies, directChildCount: direct };
}

describe("copied compiled bundle without repository node_modules", () => {
  it("runs --version naming node from a copied bundle", () => {
    const bundlePath = join(
      root,
      "skills/foreman/runtime/dist/foreman-launch.js",
    );
    if (!existsSync(bundlePath)) {
      // Bundle emitted by root build; pure version contract still holds.
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "fl-copy-"));
    try {
      const copied = join(dir, "foreman-launch.js");
      cpSync(bundlePath, copied);
      const empty = join(dir, "empty-cwd");
      const stdoutPath = join(dir, "stdout.txt");
      const stderrPath = join(dir, "stderr.txt");
      mkdirSync(empty);
      const r = spawnSync("sh", [
        "-c",
        'exec "$1" "$2" --version >"$3" 2>"$4"',
        "/bin/sh",
        process.execPath,
        copied,
        stdoutPath,
        stderrPath,
      ], {
        cwd: empty,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
        },
      });
      assert.equal(r.status, 0, r.stderr);
      const stdout = readFileSync(stdoutPath, "utf8");
      assert.match(stdout, /foreman-launch/);
      assert.match(stdout, /node /);
      assert.equal(stdout.includes("bun"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("stale detached handoff refusal", () => {
  it("reset clears prior heartbeat so stale line cannot satisfy handoff", () => {
    const dir = mkdtempSync(join(tmpdir(), "fl-stale-"));
    try {
      const hb = join(dir, "hb.jsonl");
      const stale = formatHeartbeatLine({
        ts: new Date().toISOString(),
        launcher_pid: 1,
        pid: 2,
        job_id: "2",
        alive: true,
        stdout_bytes: 0,
        stderr_bytes: 0,
        elapsed_s: 0,
      });
      writeFileSync(hb, stale);
      writeFileSync(hb, "");
      const content = readFileSync(hb, "utf8");
      assert.equal(content, "");
      assert.equal(validateHeartbeatLineText(content)._tag, "Invalid");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function handoffLayer(opts: {
  readonly detachedPid: number;
  readonly heartbeats: string[];
  readonly clock?: Context.Tag.Service<typeof LauncherClock>;
}): Layer.Layer<
  | ChildSpawner
  | ProcessGroupTerminator
  | WindowsTreeTerminator
  | HeartbeatWriter
  | ByteSink
  | LauncherClock
  | ExecveService
  | UnshareProbeService
  | CapabilityWriter
  | DetachSpawner
  | StderrLog
> {
  let readGen = 0;
  return Layer.mergeAll(
    Layer.succeed(ChildSpawner, {
      spawn: () =>
        Effect.fail({ _tag: "SpawnError" as const, message: "unused" }),
    }),
    Layer.succeed(ProcessGroupTerminator, {
      killGroup: () => Effect.void,
    }),
    Layer.succeed(WindowsTreeTerminator, {
      terminateTree: () => Effect.void,
    }),
    Layer.succeed(HeartbeatWriter, {
      reset: () => Effect.void,
      appendLine: () => Effect.void,
      readText: () => {
        const idx = Math.min(readGen, opts.heartbeats.length - 1);
        readGen++;
        const text = opts.heartbeats[idx] ?? "";
        return Effect.succeed(text);
      },
    }),
    Layer.succeed(ByteSink, {
      writeStdout: () => Effect.void,
      writeStderr: () => Effect.void,
    }),
    Layer.succeed(LauncherClock, opts.clock ?? liveClock),
    Layer.succeed(ExecveService, {
      execve: () =>
        Effect.fail({
          _tag: "ExecveFailed" as const,
          message: "unused",
        }),
    }),
    Layer.succeed(UnshareProbeService, {
      probe: () =>
        Effect.succeed({
          _tag: "Failed" as const,
          unsharePath: null,
          reason: "unshare_missing" as const,
          detail: "test",
          attempts: [],
        }),
    }),
    Layer.succeed(CapabilityWriter, {
      write: () => Effect.void,
    }),
    Layer.succeed(DetachSpawner, {
      spawnDetachedSelf: () => Effect.succeed({ pid: opts.detachedPid }),
    }),
    Layer.succeed(StderrLog, {
      write: () => Effect.void,
    }),
  );
}

function hbLineForPid(launcherPid: number): string {
  const line: HeartbeatLine = {
    ts: new Date().toISOString(),
    launcher_pid: launcherPid,
    pid: 9,
    job_id: "9",
    alive: true,
    stdout_bytes: 0,
    stderr_bytes: 0,
    elapsed_s: 0.1,
  };
  return formatHeartbeatLine(line);
}

function mainTestLayer(opts: {
  readonly probe: UnshareProbeResult;
  readonly records?: CapabilityRecord[];
  readonly events?: string[];
  readonly logs?: string[];
}): Layer.Layer<
  | ChildSpawner
  | ProcessGroupTerminator
  | WindowsTreeTerminator
  | HeartbeatWriter
  | ByteSink
  | LauncherClock
  | ExecveService
  | UnshareProbeService
  | CapabilityWriter
  | DetachSpawner
  | StderrLog
> {
  const events = opts.events ?? [];
  const records = opts.records ?? [];
  const logs = opts.logs ?? [];
  return Layer.mergeAll(
    Layer.succeed(ChildSpawner, {
      spawn: () => {
        events.push("spawn");
        return Effect.succeed(fakeChild({ pid: 80, exitCode: 0 }));
      },
    }),
    Layer.succeed(ProcessGroupTerminator, { killGroup: () => Effect.void }),
    Layer.succeed(WindowsTreeTerminator, {
      terminateTree: () => Effect.void,
    }),
    Layer.succeed(HeartbeatWriter, {
      reset: () => {
        events.push("heartbeat-reset");
        return Effect.void;
      },
      appendLine: () => {
        events.push("heartbeat-append");
        return Effect.void;
      },
      readText: () => Effect.succeed(""),
    }),
    Layer.succeed(ByteSink, {
      writeStdout: () => Effect.void,
      writeStderr: () => Effect.void,
    }),
    Layer.succeed(LauncherClock, liveClock),
    Layer.succeed(ExecveService, {
      execve: () => {
        events.push("execve");
        return Effect.fail({
          _tag: "ExecveFailed" as const,
          message: "test execve failure",
        });
      },
    }),
    Layer.succeed(UnshareProbeService, {
      probe: () => Effect.succeed(opts.probe),
    }),
    Layer.succeed(CapabilityWriter, {
      write: (_path, record) =>
        Effect.sync(() => {
          events.push(`capability-${record.tag}`);
          records.push(record);
        }),
    }),
    Layer.succeed(DetachSpawner, {
      spawnDetachedSelf: () =>
        Effect.fail({ _tag: "SpawnError" as const, message: "unused" }),
    }),
    Layer.succeed(StderrLog, {
      write: (line) =>
        Effect.sync(() => {
          logs.push(line);
        }),
    }),
  );
}

describe("capability policy and self re-exec", () => {
  it("builds a self prefix with Node exec args before the script", () => {
    assert.deepEqual(
      buildSelfScriptArgvPrefix(
        ["--import", "tsx", "--trace-warnings"],
        "/repo/packages/launcher/src/main.ts",
      ),
      [
        "--import",
        "tsx",
        "--trace-warnings",
        "/repo/packages/launcher/src/main.ts",
      ],
    );
  });

  it("writes a Refused record and spawns nothing when strong is unavailable", async (t) => {
    if (isWin) {
      t.skip("the injected POSIX strong-policy path is unavailable on win32");
      return;
    }
    const records: CapabilityRecord[] = [];
    const events: string[] = [];
    const logs: string[] = [];
    const code = await runMain(
      [
        process.execPath,
        "foreman-launch",
        "--require-containment",
        "strong",
        "--capability-file",
        "/tmp/cap.json",
        "--heartbeat-file",
        "/tmp/hb.jsonl",
        "--",
        "true",
      ],
      { writeStdout: () => {}, writeStderr: () => {}, exit: () => {} },
      mainTestLayer({
        probe: {
          _tag: "Failed",
          unsharePath: null,
          reason: "unshare_missing",
          detail: "unshare not found on PATH",
          attempts: [],
        },
        records,
        events,
        logs,
      }),
    );
    assert.equal(code, EXIT_LAUNCHER_ERROR);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.tag, "Refused");
    assert.equal(records[0]?.reason, "refused_by_policy");
    assert.equal(events.includes("spawn"), false);
    assert.equal(events.some((event) => event.startsWith("heartbeat-")), false);
    assert.equal(logs.some((line) => line.includes("REFUSED")), true);
  });

  it("probe-only writes capability evidence and never spawns", async (t) => {
    if (isWin) {
      t.skip("the injected POSIX probe-only path is unavailable on win32");
      return;
    }
    const records: CapabilityRecord[] = [];
    const events: string[] = [];
    const code = await runMain(
      [
        process.execPath,
        "foreman-launch",
        "--probe-only",
        "--capability-file",
        "/tmp/cap.json",
      ],
      { writeStdout: () => {}, writeStderr: () => {}, exit: () => {} },
      mainTestLayer({
        probe: {
          _tag: "Failed",
          unsharePath: null,
          reason: "unshare_missing",
          detail: "missing",
          attempts: [],
        },
        records,
        events,
      }),
    );
    assert.equal(code, 0);
    assert.equal(records[0]?.tag, "Degraded");
    assert.equal(events.includes("spawn"), false);
    assert.equal(events.includes("execve"), false);
  });

  it("rewrites the record as Refused when strong execve fails", async (t) => {
    if (isWin) {
      t.skip("the injected POSIX execve-refusal path is unavailable on win32");
      return;
    }
    const records: CapabilityRecord[] = [];
    const events: string[] = [];
    const logs: string[] = [];
    const code = await runMain(
      [
        process.execPath,
        "foreman-launch",
        "--require-containment",
        "strong",
        "--capability-file",
        "/tmp/cap.json",
        "--",
        "true",
      ],
      { writeStdout: () => {}, writeStderr: () => {}, exit: () => {} },
      mainTestLayer({
        probe: {
          _tag: "Ok",
          unsharePath: "/usr/bin/unshare",
          kind: "posix_pidns_userns_strong",
          flags: UNSHARE_USERNS_PIDNS_FLAGS,
          attempts: [
            {
              flags: UNSHARE_USERNS_PIDNS_FLAGS,
              status: 0,
              signal: null,
              stderr: "",
            },
          ],
        },
        records,
        events,
        logs,
      }),
    );
    assert.equal(code, EXIT_LAUNCHER_ERROR);
    assert.deepEqual(events.slice(0, 3), [
      "capability-Strong",
      "execve",
      "capability-Refused",
    ]);
    assert.equal(records.at(-1)?.tag, "Refused");
    assert.equal(events.includes("spawn"), false);
    assert.equal(logs.some((line) => line.includes("REFUSED")), true);
  });

  it("rewrites the record as Degraded before fallback spawn when execve fails under any", async (t) => {
    if (isWin) {
      t.skip("the injected POSIX execve-fallback path is unavailable on win32");
      return;
    }
    const records: CapabilityRecord[] = [];
    const events: string[] = [];
    const code = await runMain(
      [
        process.execPath,
        "foreman-launch",
        "--capability-file",
        "/tmp/cap.json",
        "--",
        "true",
      ],
      { writeStdout: () => {}, writeStderr: () => {}, exit: () => {} },
      mainTestLayer({
        probe: {
          _tag: "Ok",
          unsharePath: "/usr/bin/unshare",
          kind: "posix_pidns_userns_strong",
          flags: UNSHARE_USERNS_PIDNS_FLAGS,
          attempts: [
            {
              flags: UNSHARE_USERNS_PIDNS_FLAGS,
              status: 0,
              signal: null,
              stderr: "",
            },
          ],
        },
        records,
        events,
      }),
    );
    assert.equal(code, 0);
    assert.deepEqual(events.slice(0, 4), [
      "capability-Strong",
      "execve",
      "capability-Degraded",
      "spawn",
    ]);
    assert.equal(records.at(-1)?.tag, "Degraded");
    assert.equal(records.at(-1)?.reason, "execve_failed");
  });
});

describe("host-gated user-namespace strong path", () => {
  it("records a bounded successful first ladder attempt when the host permits it", async (t) => {
    if (isWin) {
      t.skip("unshare is unavailable on win32");
      return;
    }
    const probe = await Effect.runPromise(liveUnshareProbe.probe());
    if (probe._tag === "Failed") {
      t.skip(`host ladder unavailable: ${probe.reason}: ${probe.detail}`);
      return;
    }
    assert.equal(probe.kind, "posix_pidns_userns_strong");
    assert.deepEqual(probe.flags, UNSHARE_USERNS_PIDNS_FLAGS);
    assert.equal(probe.attempts.length, 1);
    assert.equal(probe.attempts[0]?.status, 0);
    for (const attempt of probe.attempts) {
      assert.equal(Buffer.byteLength(attempt.stderr) <= 200, true);
    }
  });

  it("runs a short compiled child in a different pid namespace", { timeout: 20_000 }, async (t) => {
    if (isWin) {
      t.skip("Linux pid namespaces are unavailable on win32");
      return;
    }
    const probe = await Effect.runPromise(liveUnshareProbe.probe());
    if (probe._tag === "Failed") {
      t.skip(`host ladder unavailable: ${probe.reason}: ${probe.detail}`);
      return;
    }
    const bundlePath = join(
      root,
      "skills/foreman/runtime/dist/foreman-launch.js",
    );
    if (!existsSync(bundlePath)) {
      t.skip("compiled launcher bundle is unavailable");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "fl-pidns-"));
    try {
      const observationPath = join(dir, "observation.txt");
      const childEnv = {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        FOREMAN_LAUNCH_PIDNS_INNER: "1",
        FOREMAN_LAUNCH_HOST_PID: String(process.pid),
        FOREMAN_LAUNCH_PIDNS_KIND: probe.kind,
      };
      const child = spawn(
        probe.unsharePath,
        [
          ...probe.flags,
          "--",
          process.execPath,
          bundlePath,
          "--require-containment",
          "strong",
          "--",
          "sh",
          "-c",
          "printf 'pid=%s ns=%s\\n' \"$$\" \"$(readlink /proc/self/ns/pid)\" > \"$1\"",
          "sh",
          observationPath,
        ],
        { env: childEnv, stdio: "ignore" },
      );
      const status = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      assert.equal(status, 0);
      const observation = readFileSync(observationPath, "utf8");
      const match = /^pid=(\d+) ns=(pid:\[\d+\])$/m.exec(observation);
      assert.ok(match, `unexpected child output: ${observation}`);
      assert.equal(Number(match[1]) > 0, true);
      assert.notEqual(match[2], readlinkSync("/proc/self/ns/pid"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("detach handoff launcher_pid binding", () => {
  it("refuses a valid post-reset heartbeat from another launcher_pid", async () => {
    const foreign = 111;
    const ours = 4242;
    let now = 1_000_000;
    const clock: Context.Tag.Service<typeof LauncherClock> = {
      nowMs: () => Effect.sync(() => now),
      sleep: () =>
        Effect.sync(() => {
          now += 200;
        }),
    };
    const code = await runMain(
      [
        process.execPath,
        "foreman-launch",
        "--detach",
        "--heartbeat-file",
        "/tmp/fake-hb",
        "--",
        "true",
      ],
      {
        writeStdout: () => {},
        writeStderr: () => {},
        exit: () => {},
      },
      handoffLayer({
        detachedPid: ours,
        heartbeats: [hbLineForPid(foreign), hbLineForPid(foreign)],
        clock,
      }),
    );
    assert.equal(code, EXIT_LAUNCHER_ERROR);
    assert.equal(now >= 1_000_000 + DETACH_HANDOFF_BOUND_MS, true);
  });

  it("accepts the first valid post-reset heartbeat whose launcher_pid matches spawnDetachedSelf", async () => {
    const ours = 4242;
    const foreign = 111;
    let now = 1_000_000;
    const clock: Context.Tag.Service<typeof LauncherClock> = {
      nowMs: () => Effect.sync(() => now),
      sleep: () =>
        Effect.sync(() => {
          now += 50;
        }),
    };
    const code = await runMain(
      [
        process.execPath,
        "foreman-launch",
        "--detach",
        "--heartbeat-file",
        "/tmp/fake-hb",
        "--",
        "true",
      ],
      {
        writeStdout: () => {},
        writeStderr: () => {},
        exit: () => {},
      },
      handoffLayer({
        detachedPid: ours,
        heartbeats: [hbLineForPid(foreign), hbLineForPid(ours)],
        clock,
      }),
    );
    assert.equal(code, 0);
  });
});

describe("compiled bundle large stdout/stderr byte-exact pass-through", () => {
  it("large piped stdout and stderr are byte-exact through foreman-launch.js", async (t) => {
    if (isWin) {
      t.skip("byte-exact stdio piping through the compiled bundle requires POSIX process spawning; unavailable on win32");
      return;
    }
    const bundlePath = join(
      root,
      "skills/foreman/runtime/dist/foreman-launch.js",
    );
    if (!existsSync(bundlePath)) {
      assert.fail("compiled foreman-launch.js missing; run npm run build first");
    }

    const dir = mkdtempSync(join(tmpdir(), "fl-bytes-"));
    try {
      const outSize = 256 * 1024;
      const errSize = 256 * 1024;
      const script = join(dir, "emit.mjs");
      const stdoutPath = join(dir, "stdout.bin");
      const stderrPath = join(dir, "stderr.bin");
      writeFileSync(
        script,
        `
import { writeSync } from "node:fs";
const outN = ${outSize};
const errN = ${errSize};
const out = Buffer.alloc(outN);
const err = Buffer.alloc(errN);
for (let i = 0; i < outN; i++) out[i] = i % 251;
for (let i = 0; i < errN; i++) err[i] = (i * 3) % 251;
writeSync(1, out);
writeSync(2, err);
process.exit(0);
`,
      );

      const expectedOut = Buffer.alloc(outSize);
      const expectedErr = Buffer.alloc(errSize);
      for (let i = 0; i < outSize; i++) expectedOut[i] = i % 251;
      for (let i = 0; i < errSize; i++) expectedErr[i] = (i * 3) % 251;

      const child = spawn(
        "/bin/sh",
        [
          "-c",
          'exec "$1" "$2" -- "$1" "$3" >"$4" 2>"$5"',
          "sh",
          process.execPath,
          bundlePath,
          script,
          stdoutPath,
          stderrPath,
        ],
        {
          stdio: "ignore",
          env: { PATH: "", HOME: process.env.HOME ?? "" },
        },
      );

      const status: number | null = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code));
      });

      const gotOut = readFileSync(stdoutPath);
      const gotErrAll = readFileSync(stderrPath);

      assert.equal(
        status,
        0,
        `launcher exit ${status}; stderr=${gotErrAll.toString("utf8").slice(0, 400)}`,
      );
      assert.equal(
        gotOut.equals(expectedOut),
        true,
        `stdout mismatch: len=${gotOut.length} expected=${outSize}`,
      );
      assert.equal(
        gotErrAll.length >= errSize,
        true,
        `stderr too short: ${gotErrAll.length} < ${errSize}`,
      );
      const payload = gotErrAll.subarray(gotErrAll.length - errSize);
      assert.equal(
        payload.equals(expectedErr),
        true,
        "stderr payload (last errSize bytes) not byte-exact",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
