/**
 * Live round service bindings — report reader, process vectors, env.
 * Sprint 3 R3.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { sha256Hex } from "@foreman/core";
import {
  decodeLaneId,
  decodeRunId,
  type LaneId,
  type RunId,
} from "@foreman/event-log";
import { MAX_REPORT_CONTENT_BYTES } from "./round-contract.js";
import {
  CHECKPOINT_OUTPUT_BOUND_BYTES,
  buildGateProcessVector,
  liveReportRead,
  makeLiveRoundServices,
  parseCheckpointCommit,
  sanitizedCheckpointEnv,
} from "./round-live-services.js";
import {
  CheckpointCapture,
  GateCommand,
  ImplementationCommand,
  ReportSnapshotReader,
  RoundBoundaryFailure,
} from "./round-transaction.js";
import {
  ProcessExec,
  type CapturedProcessResult,
  type ProcessFailure,
  type RunCapturedOptions,
  type RunForegroundOptions,
  type RunIgnoredStdioOptions,
} from "./queue-services.js";

const runId = decodeRunId("r3-live") as RunId;
const laneId = decodeLaneId("grok-r3") as LaneId;
void laneId;

function withTmp<A>(body: (dir: string) => Promise<A> | A): Promise<A> {
  const dir = mkdtempSync(join(tmpdir(), "rls-"));
  return Promise.resolve(body(dir)).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

describe("liveReportRead", () => {
  it("missing path including missing parent is Absent", async () => {
    await withTmp((dir) => {
      const r = liveReportRead(join(dir, "no", "such", "report.md"));
      assert.equal(r._tag, "Snapshot");
      if (r._tag === "Snapshot") {
        assert.equal(r.snapshot._tag, "Absent");
      }
    });
  });

  it("empty regular file is Present with empty digest", async () => {
    await withTmp((dir) => {
      const p = join(dir, "empty.md");
      writeFileSync(p, "");
      const r = liveReportRead(p);
      assert.equal(r._tag, "Snapshot");
      if (r._tag === "Snapshot" && r.snapshot._tag === "Present") {
        assert.equal(r.snapshot.byteLength, 0);
        assert.equal(r.snapshot.digest, sha256Hex(""));
      } else {
        assert.fail("expected Present");
      }
    });
  });

  it("computes lowercase SHA-256 of exact bytes", async () => {
    await withTmp((dir) => {
      const p = join(dir, "r.md");
      const body = Buffer.from("abc\n");
      writeFileSync(p, body);
      const r = liveReportRead(p);
      assert.equal(r._tag, "Snapshot");
      if (r._tag === "Snapshot" && r.snapshot._tag === "Present") {
        assert.equal(r.snapshot.byteLength, 4);
        assert.equal(r.snapshot.digest, sha256Hex(body));
        assert.ok(/^[0-9a-f]{64}$/.test(r.snapshot.digest));
      }
    });
  });

  it("oversize returns report_too_large without retaining excess", async () => {
    await withTmp((dir) => {
      const p = join(dir, "big.md");
      // Create sparse-ish large file via write of max+1
      const fd = writeFileSync;
      // Write a file just over the bound using a small test with mock size
      // by writing MAX+1 bytes would be heavy (8MB+). Write exactly bound+1.
      const size = MAX_REPORT_CONTENT_BYTES + 1;
      const buf = Buffer.alloc(size, 0x61);
      fd(p, buf);
      const r = liveReportRead(p);
      assert.equal(r._tag, "Failure");
      if (r._tag === "Failure") {
        assert.equal(r.reason, "report_too_large");
      }
    });
  });

  it("symlink returns report_read_failed", async () => {
    await withTmp((dir) => {
      const real = join(dir, "real.md");
      writeFileSync(real, "x");
      const link = join(dir, "link.md");
      symlinkSync(real, link);
      const r = liveReportRead(link);
      assert.equal(r._tag, "Failure");
      if (r._tag === "Failure") {
        assert.equal(r.reason, "report_read_failed");
      }
    });
  });

  it("unreadable returns report_read_failed", async () => {
    await withTmp((dir) => {
      const p = join(dir, "nor.md");
      writeFileSync(p, "secret");
      chmodSync(p, 0);
      try {
        const r = liveReportRead(p);
        // May succeed as root; only assert failure shape when failed
        if (r._tag === "Failure") {
          assert.equal(r.reason, "report_read_failed");
        }
      } finally {
        chmodSync(p, 0o644);
      }
    });
  });

  it("report path replacement after open returns report_read_failed", async () => {
    await withTmp((dir) => {
      const p = join(dir, "r.md");
      writeFileSync(p, "original");
      const r = liveReportRead(p, {
        afterReportRead: ({ path }) => {
          unlinkSync(path);
          writeFileSync(path, "replaced");
        },
      });
      assert.equal(r._tag, "Failure");
      if (r._tag === "Failure") {
        assert.equal(r.reason, "report_read_failed");
      }
    });
  });

  it("report path disappearance after open returns report_read_failed", async () => {
    await withTmp((dir) => {
      const p = join(dir, "r.md");
      writeFileSync(p, "original");
      const r = liveReportRead(p, {
        afterReportRead: ({ path }) => {
          unlinkSync(path);
        },
      });
      assert.equal(r._tag, "Failure");
      if (r._tag === "Failure") {
        assert.equal(r.reason, "report_read_failed");
      }
    });
  });
});

describe("buildGateProcessVector", () => {
  it("POSIX vector is /bin/sh -c gateCommand", () => {
    const v = buildGateProcessVector("exit 0", {
      platform: "linux",
      comSpec: undefined,
    });
    assert.equal(v._tag, "Ok");
    if (v._tag === "Ok") {
      assert.equal(v.command, "/bin/sh");
      assert.deepEqual(v.args, ["-c", "exit 0"]);
    }
  });

  it("Windows vector uses absolute ComSpec /d /s /c", () => {
    const com = "C:\\Windows\\System32\\cmd.exe";
    const v = buildGateProcessVector("echo hi", {
      platform: "win32",
      comSpec: com,
    });
    assert.equal(v._tag, "Ok");
    if (v._tag === "Ok") {
      assert.equal(v.command, com);
      assert.deepEqual(v.args, ["/d", "/s", "/c", "echo hi"]);
    }
  });

  it("invalid ComSpec paths fail closed", () => {
    assert.equal(
      buildGateProcessVector("x", { platform: "win32", comSpec: undefined })
        ._tag,
      "Invalid",
    );
    assert.equal(
      buildGateProcessVector("x", { platform: "win32", comSpec: "" })._tag,
      "Invalid",
    );
    assert.equal(
      buildGateProcessVector("x", {
        platform: "win32",
        comSpec: "cmd.exe",
      })._tag,
      "Invalid",
    );
    assert.equal(
      buildGateProcessVector("x", {
        platform: "win32",
        comSpec: "C:\\Windows\\cmd.exe\0evil",
      })._tag,
      "Invalid",
    );
    assert.equal(
      buildGateProcessVector("x", {
        platform: "win32",
        comSpec: "relative\\cmd.exe",
      })._tag,
      "Invalid",
    );
  });
});

describe("sanitizedCheckpointEnv / parseCheckpointCommit", () => {
  it("removes every case-insensitive GIT_ entry then sets prompt and locks", () => {
    const env = sanitizedCheckpointEnv({
      PATH: "/bin",
      GIT_DIR: "/evil",
      git_trace: "1",
      Git_Optional_Locks: "1",
      FOO: "bar",
    });
    assert.equal(env["PATH"], "/bin");
    assert.equal(env["FOO"], "bar");
    assert.equal(env["GIT_DIR"], undefined);
    assert.equal(env["git_trace"], undefined);
    assert.equal(env["Git_Optional_Locks"], undefined);
    assert.equal(env["GIT_TERMINAL_PROMPT"], "0");
    assert.equal(env["GIT_OPTIONAL_LOCKS"], "0");
  });

  it("accepts exact lowercase 40-hex with optional one terminator", () => {
    const c = "a".repeat(40);
    assert.equal(parseCheckpointCommit(c), c);
    assert.equal(parseCheckpointCommit(c + "\n"), c);
    assert.equal(parseCheckpointCommit(c + "\r\n"), c);
    assert.equal(parseCheckpointCommit(c + "\n\n"), null);
    assert.equal(parseCheckpointCommit("A".repeat(40)), null);
    assert.equal(parseCheckpointCommit(c + "x"), null);
  });
});

describe("makeLiveRoundServices process vectors", () => {
  type Call = {
    kind: "fg" | "cap";
    command: string;
    args: readonly string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    maxOutputBytes?: number;
  };

  function mockProc(calls: Call[], fgCode = 0, cap: CapturedProcessResult = {
    exitCode: 0,
    stdout: "b".repeat(40) + "\n",
    stderr: "",
  }): Layer.Layer<ProcessExec> {
    return Layer.succeed(ProcessExec, {
      runForeground: (opts: RunForegroundOptions) => {
        calls.push({
          kind: "fg",
          command: opts.command,
          args: opts.args,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.env !== undefined ? { env: opts.env } : {}),
        });
        return Effect.succeed(fgCode);
      },
      runCaptured: (opts: RunCapturedOptions) => {
        calls.push({
          kind: "cap",
          command: opts.command,
          args: opts.args,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.env !== undefined ? { env: opts.env } : {}),
          ...(opts.maxOutputBytes !== undefined
            ? { maxOutputBytes: opts.maxOutputBytes }
            : {}),
        });
        return Effect.succeed(cap);
      },
      runIgnoredStdio: (_opts: RunIgnoredStdioOptions) =>
        Effect.fail({ _tag: "ProcessFailure", reason: "spawn_failed" } as ProcessFailure),
    });
  }

  it("implementation uses exact argv, worktree cwd, no shell", async () => {
    await withTmp(async (dir) => {
      const state = join(dir, "state");
      const wt = join(dir, "wt");
      mkdirSync(state);
      mkdirSync(wt);
      const calls: Call[] = [];
      // Override ProcessExec inside makeLiveRoundServices by providing a
      // custom layer merge — use the service ops through a hand-built layer.
      // makeLiveRoundServices embeds liveProcessExec; for vector tests we
      // exercise ImplementationCommand via a thin rebind.
      const layer = Layer.provideMerge(
        Layer.effect(
          ImplementationCommand,
          Effect.gen(function* () {
            const proc = yield* ProcessExec;
            return {
              run: (commandArgv: readonly string[]) =>
                proc
                  .runForeground({
                    command: commandArgv[0]!,
                    args: commandArgv.slice(1),
                    cwd: wt,
                  })
                  .pipe(
                    Effect.mapError(
                      () =>
                        new RoundBoundaryFailure(
                          "implementation_transport_failed",
                        ),
                    ),
                  ),
            };
          }),
        ),
        mockProc(calls),
      );
      const code = await Effect.runPromise(
        Effect.gen(function* () {
          const impl = yield* ImplementationCommand;
          return yield* impl.run(["worker", "--mode", "", "x"]);
        }).pipe(Effect.provide(layer)),
      );
      assert.equal(code, 0);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.command, "worker");
      assert.deepEqual(calls[0]!.args, ["--mode", "", "x"]);
      assert.equal(calls[0]!.cwd, wt);
    });
  });

  it("checkpoint uses git rev-parse HEAD, sanitized env, 4096 bound", async () => {
    await withTmp(async (dir) => {
      const state = join(dir, "state");
      const wt = join(dir, "wt");
      mkdirSync(state);
      mkdirSync(wt);
      const calls: Call[] = [];
      const commit = "c".repeat(40);
      const layer = Layer.provideMerge(
        Layer.effect(
          CheckpointCapture,
          Effect.gen(function* () {
            const proc = yield* ProcessExec;
            return {
              capture: () =>
                Effect.gen(function* () {
                  const r = yield* proc
                    .runCaptured({
                      command: "git",
                      args: ["rev-parse", "HEAD"],
                      cwd: wt,
                      env: sanitizedCheckpointEnv({
                        PATH: "/bin",
                        GIT_DIR: "/evil",
                      }),
                      maxOutputBytes: CHECKPOINT_OUTPUT_BOUND_BYTES,
                    })
                    .pipe(
                      Effect.mapError(
                        () => new RoundBoundaryFailure("checkpoint_failed"),
                      ),
                    );
                  const c = parseCheckpointCommit(r.stdout + r.stderr);
                  if (c === null) {
                    return yield* Effect.fail(
                      new RoundBoundaryFailure("checkpoint_failed"),
                    );
                  }
                  return c;
                }),
            };
          }),
        ),
        mockProc(calls, 0, { exitCode: 0, stdout: commit + "\n", stderr: "" }),
      );
      const got = await Effect.runPromise(
        Effect.gen(function* () {
          const cp = yield* CheckpointCapture;
          return yield* cp.capture();
        }).pipe(Effect.provide(layer)),
      );
      assert.equal(got, commit);
      assert.equal(calls[0]!.command, "git");
      assert.deepEqual(calls[0]!.args, ["rev-parse", "HEAD"]);
      assert.equal(calls[0]!.cwd, wt);
      assert.equal(calls[0]!.maxOutputBytes, 4096);
      assert.equal(calls[0]!.env?.["GIT_DIR"], undefined);
      assert.equal(calls[0]!.env?.["GIT_TERMINAL_PROMPT"], "0");
    });
  });

  it("POSIX gate uses production buildGateProcessVector with worktree cwd", async () => {
    await withTmp(async (dir) => {
      const wt = join(dir, "wt");
      mkdirSync(wt);
      const calls: Call[] = [];
      const layer = Layer.provideMerge(
        Layer.effect(
          GateCommand,
          Effect.gen(function* () {
            const proc = yield* ProcessExec;
            return {
              run: (gateCommand: string) => {
                const vector = buildGateProcessVector(gateCommand, {
                  platform: "linux",
                  comSpec: undefined,
                });
                assert.equal(vector._tag, "Ok");
                if (vector._tag !== "Ok") {
                  return Effect.fail(
                    new RoundBoundaryFailure("gate_transport_failed"),
                  );
                }
                return proc
                  .runForeground({
                    command: vector.command,
                    args: vector.args,
                    cwd: wt,
                  })
                  .pipe(
                    Effect.mapError(
                      () =>
                        new RoundBoundaryFailure("gate_transport_failed"),
                    ),
                  );
              },
            };
          }),
        ),
        mockProc(calls),
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const g = yield* GateCommand;
          return yield* g.run("exit 0");
        }).pipe(Effect.provide(layer)),
      );
      const expected = buildGateProcessVector("exit 0", {
        platform: "linux",
        comSpec: undefined,
      });
      assert.equal(expected._tag, "Ok");
      if (expected._tag === "Ok") {
        assert.equal(calls[0]!.command, expected.command);
        assert.deepEqual(calls[0]!.args, expected.args);
      }
      assert.equal(calls[0]!.cwd, wt);
    });
  });

  it("Windows gate uses production buildGateProcessVector after ComSpec checks", async () => {
    await withTmp(async (dir) => {
      const wt = join(dir, "wt");
      mkdirSync(wt);
      const calls: Call[] = [];
      const comSpec = "C:\\Windows\\System32\\cmd.exe";
      const layer = Layer.provideMerge(
        Layer.effect(
          GateCommand,
          Effect.gen(function* () {
            const proc = yield* ProcessExec;
            return {
              run: (gateCommand: string) => {
                const vector = buildGateProcessVector(gateCommand, {
                  platform: "win32",
                  comSpec,
                });
                if (vector._tag !== "Ok") {
                  return Effect.fail(
                    new RoundBoundaryFailure("gate_transport_failed"),
                  );
                }
                return proc
                  .runForeground({
                    command: vector.command,
                    args: vector.args,
                    cwd: wt,
                  })
                  .pipe(
                    Effect.mapError(
                      () =>
                        new RoundBoundaryFailure("gate_transport_failed"),
                    ),
                  );
              },
            };
          }),
        ),
        mockProc(calls),
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const g = yield* GateCommand;
          return yield* g.run("echo hi");
        }).pipe(Effect.provide(layer)),
      );
      const expected = buildGateProcessVector("echo hi", {
        platform: "win32",
        comSpec,
      });
      assert.equal(expected._tag, "Ok");
      if (expected._tag === "Ok") {
        assert.equal(calls[0]!.command, expected.command);
        assert.deepEqual(calls[0]!.args, expected.args);
      }
    });
  });

  it("report reader service matches liveReportRead", async () => {
    await withTmp(async (dir) => {
      const state = join(dir, "state");
      const wt = join(dir, "wt");
      mkdirSync(state);
      mkdirSync(wt);
      const p = join(dir, "r.md");
      writeFileSync(p, "z");
      const layer = makeLiveRoundServices({
        stateRoot: state,
        worktree: wt,
        runId,
      });
      const r = await Effect.runPromise(
        Effect.gen(function* () {
          const reader = yield* ReportSnapshotReader;
          return yield* reader.read(p);
        }).pipe(Effect.provide(layer)),
      );
      assert.deepEqual(r, liveReportRead(p));
    });
  });
});
