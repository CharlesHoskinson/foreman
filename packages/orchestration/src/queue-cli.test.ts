import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { parseQueueArgv, runQueueCli, stripNodeArgv } from "./queue-cli.js";
import {
  EXIT_CONFIG,
  EXIT_MISSING_CLI,
  EXIT_OK,
} from "./queue-admission.js";
import {
  BoundedFs,
  EnvVars,
  PathLookup,
  ProcessExec,
  Sleeper,
  type QueueIo,
} from "./queue-services.js";

describe("parseQueueArgv", () => {
  it("parses ensure / add / status / kill matrix", () => {
    assert.deepEqual(parseQueueArgv(["ensure"]), { kind: "ensure" });
    assert.deepEqual(parseQueueArgv(["node", "lane-queue.js", "ensure"]), {
      kind: "ensure",
    });
    assert.deepEqual(
      parseQueueArgv(["add", "grok", "--", "echo", "hi"]),
      { kind: "add", group: "grok", cmd: ["echo", "hi"] },
    );
    assert.deepEqual(parseQueueArgv(["status"]), {
      kind: "status",
      taskId: undefined,
    });
    assert.deepEqual(parseQueueArgv(["status", "7"]), {
      kind: "status",
      taskId: "7",
    });
    assert.deepEqual(parseQueueArgv(["kill", "3"]), {
      kind: "kill",
      taskId: "3",
    });
  });

  it("usage errors for missing args and unknown subcommand", () => {
    assert.equal(parseQueueArgv([]).kind, "usage");
    assert.equal(parseQueueArgv(["bogus"]).kind, "usage");
    assert.equal(parseQueueArgv(["add", "g"]).kind, "usage");
    assert.equal(parseQueueArgv(["add", "g", "echo"]).kind, "usage");
    assert.equal(parseQueueArgv(["add", "g", "--"]).kind, "usage");
    assert.equal(parseQueueArgv(["kill"]).kind, "usage");
  });

  it("stripNodeArgv removes node and script path", () => {
    assert.deepEqual(
      stripNodeArgv(["/usr/bin/node", "/path/lane-queue.js", "ensure"]),
      ["ensure"],
    );
  });
});

function makeIo(): QueueIo & { stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    writeStdout: (t) => {
      stdout += t;
    },
    writeStderr: (t) => {
      stderr += t;
    },
  };
}

describe("runQueueCli exit matrix", () => {
  const forceLayer = Layer.mergeAll(
    Layer.succeed(ProcessExec, {
      runCaptured: () => Effect.die("no"),
      runIgnoredStdio: () => Effect.die("no"),
      runForeground: () => Effect.succeed(0),
    }),
    Layer.succeed(Sleeper, { sleep: () => Effect.void }),
    Layer.succeed(PathLookup, {
      which: () => Effect.succeed(null),
      fileExists: () => Effect.succeed(false),
      isExecutable: () => Effect.succeed(false),
    }),
    Layer.succeed(BoundedFs, {
      readFileBounded: () => Effect.succeed({ _tag: "Absent" as const }),
    }),
    Layer.succeed(EnvVars, {
      get: (n) =>
        Effect.succeed(n === "LANE_QUEUE_FORCE_MISSING" ? "1" : undefined),
      home: () => Effect.succeed("/home/t"),
    }),
  );

  it("usage returns 2", async () => {
    const io = makeIo();
    const code = await Effect.runPromise(
      runQueueCli([], io).pipe(Effect.provide(forceLayer)),
    );
    assert.equal(code, EXIT_CONFIG);
  });

  it("ensure force-missing returns 3", async () => {
    const io = makeIo();
    const code = await Effect.runPromise(
      runQueueCli(["ensure"], io).pipe(Effect.provide(forceLayer)),
    );
    assert.equal(code, EXIT_MISSING_CLI);
  });

  it("status force-missing returns 0 degraded", async () => {
    const io = makeIo();
    const code = await Effect.runPromise(
      runQueueCli(["status"], io).pipe(Effect.provide(forceLayer)),
    );
    assert.equal(code, EXIT_OK);
    assert.equal(io.stdout.trim(), '{"degraded":true}');
  });
});
