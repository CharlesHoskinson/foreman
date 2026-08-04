import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect, Fiber, Layer } from "effect";
import {
  cmdAdd,
  cmdEnsure,
  cmdKill,
  cmdStatus,
  EXIT_CONFIG,
  EXIT_FAIL,
  EXIT_MISSING_CLI,
  EXIT_OK,
  FIXED_GROUPS,
  isEmptyAdmissionStdout,
  isPreAcceptRefusal,
  isRetryablePreAcceptFailure,
  isWindowsPueuePath,
  parseShellCommandOverride,
  parseTaskId,
  posixQuote,
  pwshQuote,
  quoteForShell,
} from "./queue-admission.js";
import {
  BoundedFs,
  EnvVars,
  liveProcessExec,
  MAX_CAPTURE_BYTES,
  PathLookup,
  ProcessExec,
  ProcessFailure,
  Sleeper,
  TIMEOUT_QUEUE_OP_MS,
  TIMEOUT_STATUS_PROBE_MS,
  type BoundedReadResult,
  type CapturedProcessResult,
  type QueueIo,
  type RunCapturedOptions,
} from "./queue-services.js";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("quoting", () => {
  it("PowerShell doubles embedded single quotes", () => {
    assert.equal(pwshQuote("it's"), "'it''s'");
    assert.equal(pwshQuote("a b"), "'a b'");
    assert.equal(pwshQuote(""), "''");
  });

  it("POSIX uses close/escape/reopen for embedded quotes", () => {
    assert.equal(posixQuote("it's"), "'it'\\''s'");
    assert.equal(posixQuote("a b"), "'a b'");
    assert.notEqual(posixQuote("it's"), pwshQuote("it's"));
  });

  it("handles spaces, metacharacters, Unicode, empty", () => {
    assert.equal(posixQuote("hello world; rm -rf /"), "'hello world; rm -rf /'");
    assert.equal(posixQuote("$HOME"), "'$HOME'");
    assert.equal(posixQuote("&&x"), "'&&x'");
    assert.equal(posixQuote("café"), "'café'");
    assert.equal(pwshQuote("café"), "'café'");
  });

  it("Windows dialect prepends &; POSIX does not", () => {
    const win = quoteForShell(
      "C:/pueue.exe",
      ["echo", "hi"],
      null,
      () => false,
    );
    assert.equal(win.ok, true);
    if (win.ok) {
      assert.equal(win.dialect, "powershell");
      assert.deepEqual(win.argv, ["&", "'echo'", "'hi'"]);
    }
    const posix = quoteForShell("/usr/bin/pueue", ["echo", "hi"], null, () => false);
    assert.equal(posix.ok, true);
    if (posix.ok) {
      assert.equal(posix.dialect, "posix");
      assert.deepEqual(posix.argv, ["'echo'", "'hi'"]);
    }
  });

  it("MSYS .exe sibling forces Windows dialect", () => {
    const q = quoteForShell("/msys/pueue", ["x"], null, (p) => p === "/msys/pueue.exe");
    assert.equal(q.ok, true);
    if (q.ok) assert.equal(q.dialect, "powershell");
  });

  it("unclassifiable shell_command override fails before dialect", () => {
    const q = quoteForShell("pueue", ["echo"], "fish -c", () => false);
    assert.equal(q.ok, false);
  });
});

describe("isWindowsPueuePath", () => {
  it("detects .exe suffix and sibling", () => {
    assert.equal(isWindowsPueuePath("pueue.exe", () => false), true);
    assert.equal(isWindowsPueuePath("PUEUE.EXE", () => false), true);
    assert.equal(
      isWindowsPueuePath("/bin/pueue", (p) => p === "/bin/pueue.exe"),
      true,
    );
    assert.equal(isWindowsPueuePath("/bin/pueue", () => false), false);
  });
});

describe("parseShellCommandOverride", () => {
  it("treats absent and null as default", () => {
    assert.equal(parseShellCommandOverride("")._tag, "Default");
    assert.equal(
      parseShellCommandOverride("daemon:\n  shell_command: null\n")._tag,
      "Default",
    );
    assert.equal(
      parseShellCommandOverride("daemon:\n  shell_command:\n")._tag,
      "Default",
    );
  });

  it("returns non-null override values under daemon only", () => {
    const a = parseShellCommandOverride('daemon:\n  shell_command: "fish -c"\n');
    assert.equal(a._tag, "Override");
    if (a._tag === "Override") assert.equal(a.value, "fish -c");
    const b = parseShellCommandOverride("daemon:\n  shell_command: 'bash -c'\n");
    assert.equal(b._tag, "Override");
    if (b._tag === "Override") assert.equal(b.value, "bash -c");
  });

  it("ignores same-named key outside daemon for authorization", () => {
    const p = parseShellCommandOverride(
      "other:\n  shell_command: fish -c\ndaemon:\n  shell_command: null\n",
    );
    assert.equal(p._tag, "Default");
    const onlyOther = parseShellCommandOverride(
      "client:\n  shell_command: fish -c\n",
    );
    assert.equal(onlyOther._tag, "Default");
  });

  it("fails closed on duplicate daemon shell_command keys", () => {
    const p = parseShellCommandOverride(
      "daemon:\n  shell_command: null\n  shell_command: fish -c\n",
    );
    assert.equal(p._tag, "Uncertain");
  });

  it("fails closed on inline flow daemon mapping (cold witness)", () => {
    assert.equal(
      parseShellCommandOverride('daemon: { shell_command: "fish -c" }\n')._tag,
      "Uncertain",
    );
  });

  it("fails closed on anchored flow daemon mapping (cold witness)", () => {
    assert.equal(
      parseShellCommandOverride('daemon: &d { shell_command: "fish -c" }\n')
        ._tag,
      "Uncertain",
    );
  });

  it("fails closed on aliases, merge keys, duplicate daemon sections", () => {
    assert.equal(
      parseShellCommandOverride("daemon:\n  shell_command: *shell\n")._tag,
      "Uncertain",
    );
    assert.equal(
      parseShellCommandOverride("daemon:\n  <<: *other\n")._tag,
      "Uncertain",
    );
    assert.equal(
      parseShellCommandOverride(
        "daemon:\n  shell_command: null\ndaemon:\n  shell_command: fish -c\n",
      )._tag,
      "Uncertain",
    );
  });
});

describe("isPreAcceptRefusal", () => {
  it("accepts known English pre-accept refusals", () => {
    assert.equal(
      isPreAcceptRefusal(
        "Failed to connect to the daemon on 127.0.0.1:9261. Did you start it?",
      ),
      true,
    );
    assert.equal(
      isPreAcceptRefusal(
        "Couldn't find a configuration file. Did you start the daemon yet?",
      ),
      true,
    );
  });

  it("rejects unknown, empty, and near-miss messages", () => {
    assert.equal(isPreAcceptRefusal(""), false);
    assert.equal(isPreAcceptRefusal("Error: no daemon"), false);
    assert.equal(isPreAcceptRefusal("Failed to connect"), false);
    assert.equal(isPreAcceptRefusal("group already exists"), false);
    assert.equal(isPreAcceptRefusal("任务失败"), false);
  });
});

describe("parseTaskId", () => {
  it("accepts decimal digits with no terminator or one final LF", () => {
    assert.equal(parseTaskId("0\n"), "0");
    assert.equal(parseTaskId("7"), "7");
    assert.equal(parseTaskId("12\n"), "12");
  });

  it("accepts one final CRLF for Windows compatibility", () => {
    assert.equal(parseTaskId("12\r\n"), "12");
    assert.equal(parseTaskId("42\r\n"), "42");
  });

  it("rejects embedded CR, multiple newlines, empty, non-decimal, mixed", () => {
    assert.equal(parseTaskId("1\r2\n"), null);
    assert.equal(parseTaskId("1\n\n"), null);
    assert.equal(parseTaskId(""), null);
    assert.equal(parseTaskId("\n"), null);
    assert.equal(parseTaskId("1\n2\n"), null);
    assert.equal(parseTaskId("abc"), null);
    assert.equal(parseTaskId("12x"), null);
    assert.equal(parseTaskId(" 7"), null);
    assert.equal(parseTaskId("7 "), null);
    assert.equal(parseTaskId("12\r"), null);
    assert.equal(parseTaskId("12\r\n\n"), null);
  });
});

describe("isEmptyAdmissionStdout / isRetryablePreAcceptFailure", () => {
  it("allows empty stdout with at most one ordinary terminator", () => {
    assert.equal(isEmptyAdmissionStdout(""), true);
    assert.equal(isEmptyAdmissionStdout("\n"), true);
    assert.equal(isEmptyAdmissionStdout("\r\n"), true);
    assert.equal(isEmptyAdmissionStdout("17\n"), false);
    assert.equal(isEmptyAdmissionStdout(" "), false);
  });

  it("does not retry when stdout is non-empty even if stderr is pre-accept", () => {
    assert.equal(
      isRetryablePreAcceptFailure({
        exitCode: 1,
        stdout: "17\n",
        stderr: "Failed to connect to the daemon on 127.0.0.1:9261",
      }),
      false,
    );
    assert.equal(
      isRetryablePreAcceptFailure({
        exitCode: 1,
        stdout: "",
        stderr: "Failed to connect to the daemon on 127.0.0.1:9261",
      }),
      true,
    );
  });
});

describe("FIXED_GROUPS", () => {
  it("has exact topology without claude", () => {
    assert.deepEqual(
      FIXED_GROUPS.map((g) => `${g.name}:${g.parallel}`),
      ["grok:3", "codex:2", "misc:2", "gate:1", "agy:1"],
    );
  });
});

// ---------------------------------------------------------------------------
// Injected integration tests
// ---------------------------------------------------------------------------

type Call = {
  cmd: string;
  args: readonly string[];
  timeoutMs: number | undefined;
};

function makeIo(): QueueIo & { stdout: string; stderr: string } {
  const state = { stdout: "", stderr: "" };
  return {
    get stdout() {
      return state.stdout;
    },
    get stderr() {
      return state.stderr;
    },
    writeStdout: (t) => {
      state.stdout += t;
    },
    writeStderr: (t) => {
      state.stderr += t;
    },
  };
}

function testLayer(opts: {
  forceMissing?: boolean;
  pueuePath?: string | null;
  pueuedPath?: string | null;
  fileExists?: (p: string) => boolean;
  isExecutable?: (p: string) => boolean;
  configRead?: BoundedReadResult;
  configPath?: string;
  handler: (
    cmd: string,
    args: readonly string[],
    runOpts: RunCapturedOptions,
  ) => CapturedProcessResult | ProcessFailure;
  foreground?: (cmd: string, args: readonly string[]) => number | ProcessFailure;
  sleepLog?: number[];
  callLog?: Call[];
}): Layer.Layer<ProcessExec | Sleeper | PathLookup | BoundedFs | EnvVars> {
  const envMap: Record<string, string | undefined> = {
    LANE_QUEUE_FORCE_MISSING: opts.forceMissing ? "1" : undefined,
    PUEUE_CONFIG_PATH: opts.configPath ?? "/tmp/no-pueue-config.yml",
    HOME: "/home/test",
  };

  return Layer.mergeAll(
    Layer.succeed(ProcessExec, {
      runCaptured: (o) =>
        Effect.gen(function* () {
          opts.callLog?.push({
            cmd: o.command,
            args: o.args,
            timeoutMs: o.timeoutMs,
          });
          const r = opts.handler(o.command, o.args, o);
          if (r instanceof ProcessFailure) return yield* Effect.fail(r);
          return r;
        }),
      runForeground: (o) =>
        Effect.gen(function* () {
          const fn = opts.foreground ?? (() => 0);
          const r = fn(o.command, o.args);
          if (r instanceof ProcessFailure) return yield* Effect.fail(r);
          return r;
        }),
    }),
    Layer.succeed(Sleeper, {
      sleep: (ms) =>
        Effect.sync(() => {
          opts.sleepLog?.push(ms);
        }),
    }),
    Layer.succeed(PathLookup, {
      which: (name) =>
        Effect.sync(() => {
          if (opts.forceMissing) return null;
          if (name === "pueue") {
            return opts.pueuePath === undefined
              ? "/bin/pueue"
              : opts.pueuePath;
          }
          if (name === "pueued") {
            return opts.pueuedPath === undefined
              ? "/bin/pueued"
              : opts.pueuedPath;
          }
          return null;
        }),
      fileExists: (p) => Effect.sync(() => (opts.fileExists ?? (() => false))(p)),
      isExecutable: (p) =>
        Effect.sync(() => (opts.isExecutable ?? (() => false))(p)),
    }),
    Layer.succeed(BoundedFs, {
      readFileBounded: (path) =>
        Effect.sync(() => {
          if (opts.configRead !== undefined) {
            if (opts.configPath && path === opts.configPath) {
              return opts.configRead;
            }
            if (!opts.configPath) return opts.configRead;
          }
          return { _tag: "Absent" as const };
        }),
    }),
    Layer.succeed(EnvVars, {
      get: (name) => Effect.sync(() => envMap[name]),
      home: () => Effect.sync(() => envMap.HOME),
    }),
  );
}

function run<A>(
  effect: Effect.Effect<
    A,
    never,
    ProcessExec | Sleeper | PathLookup | BoundedFs | EnvVars
  >,
  layer: Layer.Layer<ProcessExec | Sleeper | PathLookup | BoundedFs | EnvVars>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

function readyHandler(
  extra?: (
    cmd: string,
    args: readonly string[],
  ) => CapturedProcessResult | ProcessFailure | undefined,
): (
  cmd: string,
  args: readonly string[],
  runOpts: RunCapturedOptions,
) => CapturedProcessResult | ProcessFailure {
  return (cmd, args, _o) => {
    const hit = extra?.(cmd, args);
    if (hit !== undefined) return hit;
    if (args[0] === "status") {
      return { exitCode: 0, stdout: "ok", stderr: "" };
    }
    if (args[0] === "group" || args[0] === "parallel") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
}

describe("cmdEnsure", () => {
  it("returns 3 when client absent / force missing", async () => {
    const io = makeIo();
    const code = await run(
      cmdEnsure(io),
      testLayer({
        forceMissing: true,
        handler: () => {
          throw new Error("must not run");
        },
      }),
    );
    assert.equal(code, EXIT_MISSING_CLI);
  });

  it("does not require or spawn pueued when status probe is already reachable", async () => {
    const io = makeIo();
    const calls: Call[] = [];
    const code = await run(
      cmdEnsure(io),
      testLayer({
        callLog: calls,
        // Would fail if ensure tried to start a missing daemon.
        pueuedPath: null,
        handler: readyHandler(),
      }),
    );
    assert.equal(code, EXIT_OK);
    assert.ok(calls.every((c) => !String(c.cmd).includes("pueued")));
    assert.ok(calls.every((c) => c.args[0] !== "-d"));
  });

  it("reachable ensure uses status-probe timeout then group-op timeout", async () => {
    const io = makeIo();
    const calls: Call[] = [];
    const code = await run(
      cmdEnsure(io),
      testLayer({
        callLog: calls,
        handler: readyHandler(),
      }),
    );
    assert.equal(code, EXIT_OK);
    const statusCalls = calls.filter((c) => c.args[0] === "status");
    assert.ok(statusCalls.length >= 1);
    for (const c of statusCalls) {
      assert.equal(c.timeoutMs, TIMEOUT_STATUS_PROBE_MS);
    }
    const groupCalls = calls.filter(
      (c) => c.args[0] === "group" || c.args[0] === "parallel",
    );
    assert.ok(groupCalls.length > 0);
    for (const c of groupCalls) {
      assert.equal(c.timeoutMs, TIMEOUT_QUEUE_OP_MS);
    }
  });

  it("spawns daemon only when unreachable, creates fixed topology, prints ready", async () => {
    const io = makeIo();
    let daemonUp = false;
    const groups = new Set<string>();
    const parallels: string[] = [];
    const code = await run(
      cmdEnsure(io),
      testLayer({
        handler: (cmd, args) => {
          if (cmd === "/bin/pueued" && args[0] === "-d") {
            daemonUp = true;
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (args[0] === "status") {
            return daemonUp
              ? { exitCode: 0, stdout: "ok", stderr: "" }
              : { exitCode: 1, stdout: "", stderr: "no daemon" };
          }
          if (args[0] === "group" && args[1] === "add") {
            groups.add(args[2]!);
            return { exitCode: 0, stdout: "created", stderr: "" };
          }
          if (args[0] === "parallel") {
            parallels.push(`${args[3]}=${args[1]}`);
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected" };
        },
      }),
    );
    assert.equal(code, EXIT_OK);
    assert.match(io.stderr, /ready \(groups: grok codex misc gate agy\)/);
    for (const g of FIXED_GROUPS) {
      assert.ok(groups.has(g.name), g.name);
      assert.ok(parallels.includes(`${g.name}=${g.parallel}`));
    }
    assert.ok(!groups.has("claude"));
  });

  it("returns 1 when unreachable and pueued binary is missing (not exit 3)", async () => {
    const io = makeIo();
    const code = await run(
      cmdEnsure(io),
      testLayer({
        pueuedPath: null,
        handler: (_cmd, args) => {
          if (args[0] === "status") {
            return { exitCode: 1, stdout: "", stderr: "down" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_FAIL);
    assert.match(io.stderr, /pueued daemon binary missing/);
    assert.ok(!io.stderr.includes("exit 3"));
  });

  it("treats already exists as success", async () => {
    const io = makeIo();
    const code = await run(
      cmdEnsure(io),
      testLayer({
        handler: (_cmd, args) => {
          if (args[0] === "status") {
            return { exitCode: 0, stdout: "ok", stderr: "" };
          }
          if (args[0] === "group") {
            return {
              exitCode: 1,
              stdout: "",
              stderr: 'Group "grok" already exists',
            };
          }
          if (args[0] === "parallel") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          return { exitCode: 1, stdout: "", stderr: "bad" };
        },
      }),
    );
    assert.equal(code, EXIT_OK);
  });

  it("fails closed when group add fails non-idempotently", async () => {
    const io = makeIo();
    const code = await run(
      cmdEnsure(io),
      testLayer({
        handler: (_cmd, args) => {
          if (args[0] === "status") {
            return { exitCode: 0, stdout: "ok", stderr: "" };
          }
          if (args[0] === "group") {
            return { exitCode: 1, stdout: "", stderr: "permission denied" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_FAIL);
    assert.match(io.stderr, /group configuration failed/);
    assert.ok(!io.stderr.includes("permission denied"));
  });

  it("fails closed when parallel fails", async () => {
    const io = makeIo();
    const code = await run(
      cmdEnsure(io),
      testLayer({
        handler: (_cmd, args) => {
          if (args[0] === "status") {
            return { exitCode: 0, stdout: "ok", stderr: "" };
          }
          if (args[0] === "group") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (args[0] === "parallel") {
            return { exitCode: 1, stdout: "", stderr: "nope" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_FAIL);
  });

  it("returns 1 when daemon never becomes reachable", async () => {
    const io = makeIo();
    const sleeps: number[] = [];
    const code = await run(
      cmdEnsure(io),
      testLayer({
        sleepLog: sleeps,
        handler: (cmd, args) => {
          if (cmd === "/bin/pueued") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (args[0] === "status") {
            return { exitCode: 1, stdout: "", stderr: "down" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_FAIL);
    assert.equal(sleeps.length, 5);
  });
});

describe("cmdAdd reliable admission", () => {
  it("validates group before any process", async () => {
    const io = makeIo();
    let calls = 0;
    const code = await run(
      cmdAdd(io, "Bad_Group", ["echo", "hi"]),
      testLayer({
        handler: () => {
          calls += 1;
          return { exitCode: 0, stdout: "0", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_CONFIG);
    assert.equal(calls, 0);
  });

  it("force-missing: one marker, direct, child exit code, exact argv", async () => {
    const io = makeIo();
    let fg: { cmd: string; args: readonly string[] } | null = null;
    const code = await run(
      cmdAdd(io, "misc", ["bash", "-c", "exit 9"]),
      testLayer({
        forceMissing: true,
        handler: () => {
          throw new Error("no captured");
        },
        foreground: (cmd, args) => {
          fg = { cmd, args };
          return 9;
        },
      }),
    );
    assert.equal(code, 9);
    assert.equal(io.stdout.trim(), "direct");
    assert.match(io.stderr, /degraded direct-spawn \(pueue absent\)/);
    assert.equal(
      io.stderr.split("degraded direct-spawn (pueue absent)").length - 1,
      1,
    );
    assert.deepEqual(fg, { cmd: "bash", args: ["-c", "exit 9"] });
  });

  it("establishes readiness then one admission; stdout is only task id", async () => {
    const io = makeIo();
    let daemonUp = true;
    const addArgs: string[][] = [];
    const calls: Call[] = [];
    const code = await run(
      cmdAdd(io, "grok", ["echo", "hello world"]),
      testLayer({
        callLog: calls,
        handler: (_cmd, args) => {
          if (args[0] === "status") {
            return daemonUp
              ? { exitCode: 0, stdout: "ok", stderr: "" }
              : { exitCode: 1, stdout: "", stderr: "down" };
          }
          if (args[0] === "group" || args[0] === "parallel") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (args[0] === "add") {
            addArgs.push([...args]);
            return { exitCode: 0, stdout: "12\n", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_OK);
    assert.equal(io.stdout.trim(), "12");
    assert.equal(addArgs.length, 1);
    assert.ok(!io.stdout.includes("ready"));
    assert.ok(addArgs[0]!.includes("'echo'"));
    assert.ok(addArgs[0]!.includes("'hello world'"));
    const addCall = calls.find((c) => c.args[0] === "add");
    assert.ok(addCall);
    assert.equal(addCall!.timeoutMs, TIMEOUT_QUEUE_OP_MS);
  });

  it("refuses shell override before any pueue call", async () => {
    const io = makeIo();
    let calls = 0;
    const code = await run(
      cmdAdd(io, "misc", ["echo", "hi"]),
      testLayer({
        configPath: "/tmp/override.yml",
        configRead: {
          _tag: "Ok",
          text: "daemon:\n  shell_command: fish -c\n",
        },
        handler: () => {
          calls += 1;
          return { exitCode: 0, stdout: "0", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_CONFIG);
    assert.equal(calls, 0);
    assert.match(io.stderr, /shell_command/);
  });

  it("inline flow daemon YAML exits 2 with zero pueue calls (cold witness)", async () => {
    const io = makeIo();
    let calls = 0;
    const code = await run(
      cmdAdd(io, "misc", ["echo", "hi"]),
      testLayer({
        configPath: "/tmp/flow.yml",
        configRead: {
          _tag: "Ok",
          text: 'daemon: { shell_command: "fish -c" }\n',
        },
        handler: () => {
          calls += 1;
          return { exitCode: 0, stdout: "0", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_CONFIG);
    assert.equal(calls, 0);
    assert.match(io.stderr, /configuration unreadable or uncertain/);
  });

  it("anchored flow daemon YAML exits 2 with zero pueue calls (cold witness)", async () => {
    const io = makeIo();
    let calls = 0;
    const code = await run(
      cmdAdd(io, "misc", ["echo", "hi"]),
      testLayer({
        configPath: "/tmp/anchor.yml",
        configRead: {
          _tag: "Ok",
          text: 'daemon: &d { shell_command: "fish -c" }\n',
        },
        handler: () => {
          calls += 1;
          return { exitCode: 0, stdout: "0", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_CONFIG);
    assert.equal(calls, 0);
    assert.match(io.stderr, /configuration unreadable or uncertain/);
  });

  it("oversized config exits 2 with zero pueue calls (cold witness)", async () => {
    const io = makeIo();
    let calls = 0;
    const code = await run(
      cmdAdd(io, "misc", ["echo", "hi"]),
      testLayer({
        configPath: "/tmp/huge.yml",
        configRead: { _tag: "Oversized" },
        handler: () => {
          calls += 1;
          return { exitCode: 0, stdout: "0", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_CONFIG);
    assert.equal(calls, 0);
    assert.match(io.stderr, /configuration unreadable or uncertain/);
  });

  it("null shell_command proceeds", async () => {
    const io = makeIo();
    const code = await run(
      cmdAdd(io, "misc", ["echo", "hi"]),
      testLayer({
        configPath: "/tmp/null.yml",
        configRead: {
          _tag: "Ok",
          text: "daemon:\n  shell_command: null\n",
        },
        handler: (_cmd, args) => {
          if (args[0] === "status") {
            return { exitCode: 0, stdout: "ok", stderr: "" };
          }
          if (args[0] === "group" || args[0] === "parallel") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (args[0] === "add") {
            return { exitCode: 0, stdout: "3\n", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_OK);
    assert.equal(io.stdout.trim(), "3");
  });

  it("pre-accept retry: reconnect once then one accepted id", async () => {
    const io = makeIo();
    let daemonUp = false;
    let addAttempts = 0;
    const code = await run(
      cmdAdd(io, "misc", ["true"]),
      testLayer({
        handler: (cmd, args) => {
          if (cmd === "/bin/pueued") {
            daemonUp = true;
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (args[0] === "status") {
            return daemonUp
              ? { exitCode: 0, stdout: "ok", stderr: "" }
              : {
                  exitCode: 1,
                  stdout: "",
                  stderr: "Failed to connect to the daemon on 127.0.0.1:1",
                };
          }
          if (args[0] === "group" || args[0] === "parallel") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (args[0] === "add") {
            addAttempts += 1;
            if (addAttempts === 1) {
              daemonUp = false;
              return {
                exitCode: 1,
                stdout: "",
                stderr:
                  "Failed to connect to the daemon on 127.0.0.1:9261. Did you start it?",
              };
            }
            return { exitCode: 0, stdout: "99\n", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_OK);
    assert.equal(io.stdout.trim(), "99");
    assert.equal(addAttempts, 2);
  });

  it("ambiguous task id never retries", async () => {
    const io = makeIo();
    let addAttempts = 0;
    const code = await run(
      cmdAdd(io, "misc", ["true"]),
      testLayer({
        handler: (_cmd, args) => {
          if (args[0] === "status") {
            return { exitCode: 0, stdout: "ok", stderr: "" };
          }
          if (args[0] === "group" || args[0] === "parallel") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (args[0] === "add") {
            addAttempts += 1;
            return { exitCode: 0, stdout: "not-an-id\n", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_FAIL);
    assert.equal(addAttempts, 1);
    assert.match(io.stderr, /ambiguous/);
  });

  it("ambiguous failed admission with task id on stdout never retries and prints neither stream", async () => {
    const io = makeIo();
    let addAttempts = 0;
    const secret =
      "Failed to connect to the daemon: /home/alice/tool --api-key=SECRET";
    const code = await run(
      cmdAdd(io, "misc", ["true"]),
      testLayer({
        handler: (_cmd, args) => {
          if (args[0] === "status") {
            return { exitCode: 0, stdout: "ok", stderr: "" };
          }
          if (args[0] === "group" || args[0] === "parallel") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (args[0] === "add") {
            addAttempts += 1;
            return {
              exitCode: 1,
              stdout: "17\n",
              stderr: secret,
            };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_FAIL);
    assert.equal(addAttempts, 1);
    assert.equal(io.stdout, "");
    assert.ok(!io.stderr.includes("17"));
    assert.ok(!io.stderr.includes(secret));
    assert.ok(!io.stderr.includes("/home/alice"));
    assert.ok(!io.stderr.includes("SECRET"));
    assert.ok(!io.stdout.includes("/home/alice"));
    assert.ok(!io.stdout.includes("SECRET"));
    assert.match(io.stderr, /pueue add failed for group misc/);
  });

  it("sanitizes vendor failure text from add/status/kill", async () => {
    const leak = "/home/alice/tool --api-key=SECRET";
    const ioAdd = makeIo();
    assert.equal(
      await run(
        cmdAdd(ioAdd, "gate", ["true"]),
        testLayer({
          handler: readyHandler((_c, a) => {
            if (a[0] === "add") {
              return { exitCode: 1, stdout: "", stderr: leak };
            }
            return undefined;
          }),
        }),
      ),
      EXIT_FAIL,
    );
    assert.ok(!ioAdd.stderr.includes(leak));
    assert.ok(!ioAdd.stderr.includes("SECRET"));
    assert.ok(!ioAdd.stdout.includes("SECRET"));
    assert.match(ioAdd.stderr, /pueue add failed for group gate/);

    const ioSt = makeIo();
    assert.equal(
      await run(
        cmdStatus(ioSt, undefined),
        testLayer({
          handler: () => ({
            exitCode: 1,
            stdout: leak,
            stderr: leak,
          }),
        }),
      ),
      EXIT_FAIL,
    );
    assert.ok(!ioSt.stderr.includes("SECRET"));
    assert.ok(!ioSt.stdout.includes("SECRET"));
    assert.ok(!ioSt.stderr.includes("/home/alice"));
    assert.match(ioSt.stderr, /pueue status failed/);

    const ioKill = makeIo();
    assert.equal(
      await run(
        cmdKill(ioKill, "9"),
        testLayer({
          handler: () => ({
            exitCode: 1,
            stdout: leak,
            stderr: leak,
          }),
        }),
      ),
      EXIT_FAIL,
    );
    assert.ok(!ioKill.stderr.includes("SECRET"));
    assert.ok(!ioKill.stdout.includes("SECRET"));
    assert.match(ioKill.stderr, /pueue kill failed for task 9/);
  });

  it("non-classified add failure never retries and never direct-spawns", async () => {
    const io = makeIo();
    let addAttempts = 0;
    let fg = 0;
    const code = await run(
      cmdAdd(io, "misc", ["true"]),
      testLayer({
        handler: (_cmd, args) => {
          if (args[0] === "status") {
            return { exitCode: 0, stdout: "ok", stderr: "" };
          }
          if (args[0] === "group" || args[0] === "parallel") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (args[0] === "add") {
            addAttempts += 1;
            return { exitCode: 1, stdout: "", stderr: "group not found" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
        foreground: () => {
          fg += 1;
          return 0;
        },
      }),
    );
    assert.equal(code, EXIT_FAIL);
    assert.equal(addAttempts, 1);
    assert.equal(fg, 0);
    assert.ok(!io.stderr.includes("group not found"));
  });

  it("Windows .exe client uses PowerShell argv shape", async () => {
    const io = makeIo();
    let addLine: readonly string[] = [];
    const code = await run(
      cmdAdd(io, "grok", ["echo", "it's a test"]),
      testLayer({
        pueuePath: "/shim/pueue.exe",
        handler: (_cmd, args) => {
          if (args[0] === "status") {
            return { exitCode: 0, stdout: "ok", stderr: "" };
          }
          if (args[0] === "group" || args[0] === "parallel") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (args[0] === "add") {
            addLine = args;
            return { exitCode: 0, stdout: "1\n", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    );
    assert.equal(code, EXIT_OK);
    const dash = addLine.indexOf("--");
    assert.ok(dash >= 0);
    assert.equal(addLine[dash + 1], "&");
    assert.equal(addLine[dash + 2], "'echo'");
    assert.equal(addLine[dash + 3], "'it''s a test'");
  });
});

describe("cmdStatus / cmdKill", () => {
  it("status degraded when no client", async () => {
    const io = makeIo();
    const code = await run(
      cmdStatus(io, undefined),
      testLayer({
        forceMissing: true,
        handler: () => {
          throw new Error("no");
        },
      }),
    );
    assert.equal(code, EXIT_OK);
    assert.equal(io.stdout.trim(), '{"degraded":true}');
  });

  it("status full / single / missing / bad JSON for both modes", async () => {
    const json =
      '{"tasks":{"7":{"id":7,"status":{"Running":{}}}},"groups":{}}';
    const io1 = makeIo();
    assert.equal(
      await run(
        cmdStatus(io1, undefined),
        testLayer({
          handler: (_c, a) =>
            a[0] === "status"
              ? { exitCode: 0, stdout: json, stderr: "" }
              : { exitCode: 1, stdout: "", stderr: "" },
        }),
      ),
      EXIT_OK,
    );
    assert.ok(io1.stdout.includes('"7"'));
    assert.ok(!io1.stdout.includes("\r"));
    // compact re-serialized
    assert.equal(io1.stdout.trim(), JSON.stringify(JSON.parse(json)));

    const io2 = makeIo();
    assert.equal(
      await run(
        cmdStatus(io2, "7"),
        testLayer({
          handler: (_c, a) =>
            a[0] === "status"
              ? { exitCode: 0, stdout: json, stderr: "" }
              : { exitCode: 1, stdout: "", stderr: "" },
        }),
      ),
      EXIT_OK,
    );
    assert.ok(io2.stdout.includes('"id":7'));

    const io3 = makeIo();
    assert.equal(
      await run(
        cmdStatus(io3, "999"),
        testLayer({
          handler: (_c, a) =>
            a[0] === "status"
              ? { exitCode: 0, stdout: json, stderr: "" }
              : { exitCode: 1, stdout: "", stderr: "" },
        }),
      ),
      EXIT_OK,
    );
    assert.equal(io3.stdout.trim(), "{}");

    const bad = "{not valid";
    for (const taskId of [undefined, "7"] as const) {
      const io4 = makeIo();
      assert.equal(
        await run(
          cmdStatus(io4, taskId),
          testLayer({
            handler: (_c, a) =>
              a[0] === "status"
                ? { exitCode: 0, stdout: bad, stderr: "" }
                : { exitCode: 1, stdout: "", stderr: "" },
          }),
        ),
        EXIT_FAIL,
      );
      assert.ok(!io4.stdout.includes(bad));
      assert.ok(!io4.stderr.includes(bad));
      assert.match(io4.stderr, /invalid status JSON/);
    }
  });

  it("does not repair malformed status JSON with embedded CR (cold witness)", async () => {
    // Exact invalid witness: CR inside a JSON string is not legal JSON.
    // Stripping CR before parse would falsely accept this body.
    const invalid = '{"x":"a\rb"}';
    const io = makeIo();
    assert.equal(
      await run(
        cmdStatus(io, undefined),
        testLayer({
          handler: (_c, a) =>
            a[0] === "status"
              ? { exitCode: 0, stdout: invalid, stderr: "" }
              : { exitCode: 1, stdout: "", stderr: "" },
        }),
      ),
      EXIT_FAIL,
    );
    assert.equal(io.stdout, "");
    assert.ok(!io.stdout.includes(invalid));
    assert.ok(!io.stderr.includes(invalid));
    assert.ok(!io.stderr.includes("\r"));
    assert.match(io.stderr, /invalid status JSON/);
  });

  it("accepts valid CRLF-terminated status JSON and emits compact CR-free", async () => {
    const payload = '{"tasks":{"1":{"id":1}},"groups":{}}';
    const crlf = payload + "\r\n";
    const io = makeIo();
    assert.equal(
      await run(
        cmdStatus(io, undefined),
        testLayer({
          handler: (_c, a) =>
            a[0] === "status"
              ? { exitCode: 0, stdout: crlf, stderr: "" }
              : { exitCode: 1, stdout: "", stderr: "" },
        }),
      ),
      EXIT_OK,
    );
    assert.ok(!io.stdout.includes("\r"));
    assert.equal(io.stdout.trim(), JSON.stringify(JSON.parse(payload)));
  });

  it("kill validates id and fallback mode; success is fixed diagnostic", async () => {
    const io = makeIo();
    assert.equal(
      await run(
        cmdKill(io, "7abc"),
        testLayer({
          handler: () => {
            throw new Error("no");
          },
        }),
      ),
      EXIT_CONFIG,
    );

    const io2 = makeIo();
    assert.equal(
      await run(
        cmdKill(io2, "3"),
        testLayer({
          forceMissing: true,
          handler: () => {
            throw new Error("no");
          },
        }),
      ),
      EXIT_CONFIG,
    );

    const io3 = makeIo();
    assert.equal(
      await run(
        cmdKill(io3, "7"),
        testLayer({
          handler: (_c, a) => {
            if (a[0] === "kill" && a[1] === "7") {
              return {
                exitCode: 0,
                stdout: "Tasks are being killed: 7\n",
                stderr: "",
              };
            }
            return { exitCode: 1, stdout: "", stderr: "bad" };
          },
        }),
      ),
      EXIT_OK,
    );
    assert.match(io3.stdout, /killed: 7/);
    // Success text is fixed from the validated id, not a vendor stream echo.
    assert.equal(io3.stdout.trim(), "Tasks are being killed: 7");
  });
});

describe("process bounds and cancellation", () => {
  it("output_bound and cancelled are closed ProcessFailure reasons", () => {
    assert.equal(new ProcessFailure("output_bound").reason, "output_bound");
    assert.equal(new ProcessFailure("cancelled").reason, "cancelled");
    assert.equal(new ProcessFailure("timeout").reason, "timeout");
    assert.equal(new ProcessFailure("spawn_failed").reason, "spawn_failed");
  });

  it("cmdAdd surfaces process failure without direct-spawn when client present", async () => {
    const io = makeIo();
    let fg = 0;
    let phase = 0;
    const code = await run(
      cmdAdd(io, "misc", ["true"]),
      testLayer({
        handler: (_c, a) => {
          if (a[0] === "status") {
            return { exitCode: 0, stdout: "ok", stderr: "" };
          }
          if (a[0] === "group" || a[0] === "parallel") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (a[0] === "add") {
            phase += 1;
            return new ProcessFailure("output_bound");
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
        foreground: () => {
          fg += 1;
          return 0;
        },
      }),
    );
    assert.equal(code, EXIT_FAIL);
    assert.equal(fg, 0);
    assert.equal(phase, 1);
  });

  it("live: interruption terminates owned long-lived child within bound", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lq-int-"));
    const pidFile = join(dir, "pid");
    try {
      const script = `
        const fs = require("node:fs");
        fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
        setInterval(() => {}, 1000);
      `;
      const effect = Effect.gen(function* () {
        const proc = yield* ProcessExec;
        return yield* proc.runCaptured({
          command: process.execPath,
          args: ["-e", script],
          maxOutputBytes: MAX_CAPTURE_BYTES,
          timeoutMs: 60_000,
        });
      }).pipe(Effect.provide(liveProcessExec));

      const fiber = Effect.runFork(effect);

      // Wait for child to publish its pid.
      let pid: number | undefined;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try {
          const text = readFileSync(pidFile, "utf8").trim();
          if (text.length > 0) {
            pid = Number(text);
            break;
          }
        } catch {
          /* not yet */
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(pid !== undefined && Number.isFinite(pid), "child pid published");

      await Effect.runPromise(Fiber.interrupt(fiber));

      // Child must not remain alive within a bounded poll.
      const deadDeadline = Date.now() + 3_000;
      let alive = true;
      while (Date.now() < deadDeadline) {
        try {
          process.kill(pid!, 0);
          await new Promise((r) => setTimeout(r, 20));
        } catch {
          alive = false;
          break;
        }
      }
      assert.equal(alive, false, "owned child must be dead after interrupt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("live: timeout terminates child and fails with timeout", async () => {
    const effect = Effect.gen(function* () {
      const proc = yield* ProcessExec;
      return yield* proc.runCaptured({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 30000)"],
        maxOutputBytes: MAX_CAPTURE_BYTES,
        timeoutMs: 200,
      });
    }).pipe(Effect.provide(liveProcessExec));

    const exit = await Effect.runPromise(Effect.either(effect));
    assert.equal(exit._tag, "Left");
    if (exit._tag === "Left") {
      assert.ok(exit.left instanceof ProcessFailure);
      assert.equal(exit.left.reason, "timeout");
    }
  });

  it("live: output bound terminates child and fails with output_bound", async () => {
    const effect = Effect.gen(function* () {
      const proc = yield* ProcessExec;
      return yield* proc.runCaptured({
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write('x'.repeat(4096)); setInterval(()=>{}, 1000)",
        ],
        maxOutputBytes: 64,
        timeoutMs: 5_000,
      });
    }).pipe(Effect.provide(liveProcessExec));

    const exit = await Effect.runPromise(Effect.either(effect));
    assert.equal(exit._tag, "Left");
    if (exit._tag === "Left") {
      assert.ok(exit.left instanceof ProcessFailure);
      assert.equal(exit.left.reason, "output_bound");
    }
  });

  it("live: NUL command returns typed spawn_failed (no defect)", async () => {
    const effect = Effect.gen(function* () {
      const proc = yield* ProcessExec;
      return yield* proc.runCaptured({
        command: "\0",
        args: [],
        maxOutputBytes: MAX_CAPTURE_BYTES,
      });
    }).pipe(Effect.provide(liveProcessExec));

    // Must resolve on the failure channel, not throw a TDZ/ReferenceError defect.
    const exit = await Effect.runPromise(Effect.either(effect));
    assert.equal(exit._tag, "Left");
    if (exit._tag === "Left") {
      assert.ok(exit.left instanceof ProcessFailure);
      assert.equal(exit.left.reason, "spawn_failed");
      // Failure value carries only the closed reason — not command or stack.
      assert.equal(Object.keys(exit.left).sort().join(","), "_tag,reason");
      assert.equal(String(exit.left.reason), "spawn_failed");
      assert.ok(!("stack" in exit.left));
      assert.ok(!("message" in exit.left));
    }
  });
});
