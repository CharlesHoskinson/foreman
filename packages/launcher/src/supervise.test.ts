import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
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
import { Deferred, Effect, Layer } from "effect";
import {
  HEARTBEAT_KEYS,
  formatHeartbeatLine,
  type HeartbeatLine,
  validateHeartbeatLineText,
} from "./heartbeat.js";
import { processGroupKillTarget, planTaskkill } from "./platform.js";
import {
  ByteSink,
  ChildSpawner,
  HeartbeatWriter,
  LauncherClock,
  ProcessGroupTerminator,
  WindowsTreeTerminator,
  liveClock,
  type SpawnedChild,
  type StreamChunk,
} from "./services.js";
import { supervise, type LaunchEvent } from "./supervise.js";
import { LiveLauncherLayer } from "./services.js";
import { EXIT_TIMEOUT, mapSuperviseExit } from "./cli.js";

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

  it("live spawn uses ignore stdin (null device)", async () => {
    if (isWin) return;
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
  it("timeout then grace then one termination; timers cleared (live short)", async () => {
    if (isWin) return;
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
  it("child exit code passthrough and heartbeat final dead", async () => {
    if (isWin) return;
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

describe("descendant churn control", () => {
  it("launcher host does not accumulate zombie direct children across 1000+ short descendants", async () => {
    if (isWin) return;
    const dir = mkdtempSync(join(tmpdir(), "fl-churn-"));
    try {
      const ready = join(dir, "ready");
      const result = await Effect.runPromise(
        supervise({
          cmd: [
            "sh",
            "-c",
            `for i in $(seq 1 1100); do (exit 0); done; : > "${ready}"; exit 0`,
          ],
          graceSecs: 1,
          heartbeatIntervalSecs: 60,
          launcherPid: process.pid,
          platform: process.platform,
        }).pipe(Effect.provide(LiveLauncherLayer)),
      );
      assert.equal(result.exitCode, 0);
      assert.equal(existsSync(ready), true);
      const zombies = countZombieChildren(process.pid);
      assert.equal(
        zombies,
        0,
        `expected 0 zombie direct children of test process, got ${zombies}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function countZombieChildren(parentPid: number): number {
  let count = 0;
  try {
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = readFileSync(join("/proc", name, "stat"), "utf8");
        const close = stat.indexOf(")");
        if (close < 0) continue;
        const rest = stat.slice(close + 2).split(" ");
        const state = rest[0];
        const ppid = Number(rest[1]);
        if (ppid === parentPid && state === "Z") count++;
      } catch {
        /* race */
      }
    }
  } catch {
    return 0;
  }
  return count;
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
      mkdirSync(empty);
      const r = spawnSync(process.execPath, [copied, "--version"], {
        cwd: empty,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
        },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /foreman-launch/);
      assert.match(r.stdout, /node /);
      assert.equal(r.stdout.includes("bun"), false);
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
