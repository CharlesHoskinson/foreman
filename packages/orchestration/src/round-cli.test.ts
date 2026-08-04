/**
 * lane-round CLI parse, preflight, and live transaction tests.
 * Sprint 3 R3.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Effect, Fiber } from "effect";
import { sha256Hex } from "@foreman/core";
import {
  decodeLaneId,
  decodeRunId,
  replayNdjsonBytes,
  type LaneId,
  type RunId,
} from "@foreman/event-log";
import {
  EXIT_BOUNDARY_FAILURE,
  EXIT_COMPLETED,
  EXIT_INCOMPLETE_OR_DEFECT,
  EXIT_INVALID_ARGUMENTS,
  MSG_BOUNDARY_FAILURE,
  MSG_INVALID_ARGUMENTS,
  isEqualOrDescendant,
  parseRoundArgv,
  preflightRoundParsed,
  runRoundCli,
} from "./round-cli.js";
import { recoverRoundAttempt } from "./round-reducer.js";
import type { StoredEvent } from "@foreman/event-log";

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      writeStdout: (t: string) => {
        stdout += t;
      },
      writeStderr: (t: string) => {
        stderr += t;
      },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

function makeDirs() {
  const base = mkdtempSync(join(tmpdir(), "round-cli-"));
  const stateRoot = join(base, "state");
  const worktree = join(base, "wt");
  mkdirSync(stateRoot);
  mkdirSync(worktree);
  // Minimal git repo for checkpoint
  spawnSync("git", ["init"], { cwd: worktree, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@t"], { cwd: worktree });
  spawnSync("git", ["config", "user.name", "t"], { cwd: worktree });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: worktree });
  writeFileSync(join(worktree, "f.txt"), "x\n");
  spawnSync("git", ["add", "f.txt"], { cwd: worktree });
  spawnSync("git", ["commit", "-m", "i"], { cwd: worktree });
  const report = join(worktree, "FOREMAN_REPORT.md");
  return {
    base,
    stateRoot: resolve(stateRoot),
    worktree: resolve(worktree),
    report,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

function baseArgv(
  d: ReturnType<typeof makeDirs>,
  cmd: readonly string[],
  gate = "true",
): string[] {
  return [
    "node",
    "lane-round.js",
    "--state-root",
    d.stateRoot,
    "--worktree",
    d.worktree,
    "--run",
    "r3-cli-run",
    "--lane",
    "grok-r3",
    "--report",
    d.report,
    "--gate",
    gate,
    "--",
    ...cmd,
  ];
}

describe("parseRoundArgv", () => {
  it("accepts fixed-order options and preserves later empty command arg", () => {
    const p = parseRoundArgv([
      "node",
      "lane-round.js",
      "--state-root",
      "/s",
      "--worktree",
      "/w",
      "--run",
      "r",
      "--lane",
      "l",
      "--report",
      "/r",
      "--gate",
      "g",
      "--",
      "cmd",
      "",
      "tail",
    ]);
    assert.equal(p._tag, "Ok");
    if (p._tag === "Ok") {
      assert.deepEqual(p.commandArgv, ["cmd", "", "tail"]);
      assert.equal(p.stateRoot, "/s");
      assert.equal(p.worktree, "/w");
      assert.equal(p.run, "r");
      assert.equal(p.lane, "l");
      assert.equal(p.report, "/r");
      assert.equal(p.gate, "g");
    }
  });

  it("rejects duplicate options (wrong order)", () => {
    const p = parseRoundArgv([
      "--state-root",
      "/s",
      "--state-root",
      "/s2",
      "--worktree",
      "/w",
      "--run",
      "r",
      "--lane",
      "l",
      "--report",
      "/r",
      "--gate",
      "g",
      "--",
      "cmd",
    ]);
    assert.equal(p._tag, "Invalid");
  });

  it("rejects unknown option", () => {
    const p = parseRoundArgv([
      "--state-root",
      "/s",
      "--worktree",
      "/w",
      "--run",
      "r",
      "--lane",
      "l",
      "--report",
      "/r",
      "--extra",
      "x",
      "--gate",
      "g",
      "--",
      "cmd",
    ]);
    assert.equal(p._tag, "Invalid");
  });

  it("rejects missing -- and empty command", () => {
    assert.equal(
      parseRoundArgv([
        "--state-root",
        "/s",
        "--worktree",
        "/w",
        "--run",
        "r",
        "--lane",
        "l",
        "--report",
        "/r",
        "--gate",
        "g",
      ])._tag,
      "Invalid",
    );
    assert.equal(
      parseRoundArgv([
        "--state-root",
        "/s",
        "--worktree",
        "/w",
        "--run",
        "r",
        "--lane",
        "l",
        "--report",
        "/r",
        "--gate",
        "g",
        "--",
      ])._tag,
      "Invalid",
    );
  });

  it("rejects wrong option order", () => {
    const p = parseRoundArgv([
      "--worktree",
      "/w",
      "--state-root",
      "/s",
      "--run",
      "r",
      "--lane",
      "l",
      "--report",
      "/r",
      "--gate",
      "g",
      "--",
      "cmd",
    ]);
    assert.equal(p._tag, "Invalid");
  });
});

describe("isEqualOrDescendant / state-root rejection", () => {
  it("uses segment-aware relative path, not string prefix", () => {
    // /tmp/work is NOT a prefix-descendant of /tmp/work-extra
    assert.equal(isEqualOrDescendant("/tmp/work", "/tmp/work-extra"), false);
    assert.equal(isEqualOrDescendant("/tmp/work/sub", "/tmp/work"), true);
    assert.equal(isEqualOrDescendant("/tmp/work", "/tmp/work"), true);
  });

  it("rejects state root equal or below worktree before state writes", () => {
    const d = makeDirs();
    try {
      // state root = worktree
      const parsed = parseRoundArgv(
        baseArgv({ ...d, stateRoot: d.worktree }, ["true"]),
      );
      assert.equal(parsed._tag, "Ok");
      if (parsed._tag === "Ok") {
        const pre = preflightRoundParsed(parsed);
        assert.equal(pre._tag, "Invalid");
      }
      // state root below worktree
      const nested = join(d.worktree, "nested-state");
      mkdirSync(nested);
      const parsed2 = parseRoundArgv(
        baseArgv({ ...d, stateRoot: nested }, ["true"]),
      );
      assert.equal(parsed2._tag, "Ok");
      if (parsed2._tag === "Ok") {
        assert.equal(preflightRoundParsed(parsed2)._tag, "Invalid");
      }
      // No state under worktree
      assert.equal(existsSync(join(d.worktree, "runs")), false);
      assert.equal(existsSync(join(d.worktree, ".harness")), false);
    } finally {
      d.cleanup();
    }
  });
});

describe("runRoundCli live transaction", () => {
  it("completed live round: journal order, outcome line, exit 0", async () => {
    const d = makeDirs();
    try {
      // Implementation writes a fresh report
      const impl = process.execPath;
      const writeReport = `
        const fs = require("node:fs");
        fs.writeFileSync(${JSON.stringify(d.report)}, "fresh-report-body\\n");
      `;
      const cap = captureIo();
      const code = await Effect.runPromise(
        runRoundCli(
          baseArgv(d, [impl, "-e", writeReport], "true"),
          cap.io,
        ),
      );
      assert.equal(code, EXIT_COMPLETED);
      assert.equal(cap.stderr, "");
      const line = cap.stdout.trimEnd();
      assert.ok(line.endsWith("}") || line.includes('"completed"'));
      const outcome = JSON.parse(cap.stdout.trim());
      assert.equal(outcome._tag, "completed");

      const journal = join(
        d.stateRoot,
        "runs",
        "r3-cli-run",
        "events.ndjson",
      );
      const bytes = readFileSync(journal);
      const replay = replayNdjsonBytes(bytes, { fromLine: 0 });
      assert.equal(replay.terminal._tag, "CleanEof");
      const types = replay.records.map((r) => r.event.type);
      assert.deepEqual(types, [
        "prompt",
        "checkpoint",
        "state",
        "round_done",
      ]);
      // No runtime state under worktree
      assert.equal(existsSync(join(d.worktree, "runs")), false);
      assert.equal(existsSync(join(d.worktree, ".harness")), false);
      const wtTop = readdirSync(d.worktree);
      assert.ok(!wtTop.includes("runs"));
    } finally {
      d.cleanup();
    }
  });

  it("incomplete live round: waiting_child + alert, exit 1", async () => {
    const d = makeDirs();
    try {
      // Gate fails
      const cap = captureIo();
      const code = await Effect.runPromise(
        runRoundCli(
          baseArgv(d, [process.execPath, "-e", "process.exit(0)"], "false"),
          cap.io,
        ),
      );
      assert.equal(code, EXIT_INCOMPLETE_OR_DEFECT);
      const outcome = JSON.parse(cap.stdout.trim());
      assert.equal(outcome._tag, "incomplete");
      assert.equal(outcome.reason, "gate_failed");

      const journal = join(
        d.stateRoot,
        "runs",
        "r3-cli-run",
        "events.ndjson",
      );
      const bytes = readFileSync(journal);
      const replay = replayNdjsonBytes(bytes, { fromLine: 0 });
      const types = replay.records.map((r) => r.event.type);
      assert.deepEqual(types, [
        "prompt",
        "checkpoint",
        "state",
        "waiting_child",
        "alert",
      ]);
      assert.equal(
        replay.records[4]!.event.payload["kind"],
        "round_incomplete",
      );
    } finally {
      d.cleanup();
    }
  });

  it("nonzero implementation still captures checkpoint and runs gate", async () => {
    const d = makeDirs();
    try {
      const writeReport = `
        const fs = require("node:fs");
        fs.writeFileSync(${JSON.stringify(d.report)}, "after-nonzero\\n");
      `;
      // exit 7 after writing report
      const script = writeReport + "; process.exit(7);";
      const cap = captureIo();
      const code = await Effect.runPromise(
        runRoundCli(
          baseArgv(d, [process.execPath, "-e", script], "true"),
          cap.io,
        ),
      );
      assert.equal(code, EXIT_COMPLETED);
      const outcome = JSON.parse(cap.stdout.trim());
      assert.equal(outcome.implementationExitCode, 7);
      assert.equal(outcome.gateExitCode, 0);
    } finally {
      d.cleanup();
    }
  });

  it("invalid arguments write fixed diagnostic and exit 2", async () => {
    const cap = captureIo();
    const code = await Effect.runPromise(
      runRoundCli(["node", "lane-round.js", "--nope"], cap.io),
    );
    assert.equal(code, EXIT_INVALID_ARGUMENTS);
    assert.equal(cap.stderr, MSG_INVALID_ARGUMENTS + "\n");
    assert.equal(cap.stdout, "");
  });

  it("preserves empty command argument into implementation", async () => {
    const d = makeDirs();
    try {
      const marker = join(d.worktree, "argv.json");
      const script = `
        const fs = require("node:fs");
        fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(1)));
        fs.writeFileSync(${JSON.stringify(d.report)}, "ok\\n");
      `;
      const cap = captureIo();
      const code = await Effect.runPromise(
        runRoundCli(
          baseArgv(d, [process.execPath, "-e", script, ""], "true"),
          cap.io,
        ),
      );
      assert.equal(code, EXIT_COMPLETED);
      const argv = JSON.parse(readFileSync(marker, "utf8")) as string[];
      // node -e script "" → argv includes empty string
      assert.ok(argv.includes(""), "empty arg must be preserved: " + JSON.stringify(argv));
    } finally {
      d.cleanup();
    }
  });

  it("interruption after durable verifying replays Recoverable without terminal", async () => {
    const d = makeDirs();
    try {
      // Slow implementation so we can interrupt after verifying is hard —
      // verifying is AFTER implementation. So: fast impl, slow gate.
      const writeReport = `
        const fs = require("node:fs");
        fs.writeFileSync(${JSON.stringify(d.report)}, "recover-body\\n");
      `;
      const slowGate = "sleep 30";
      const cap = captureIo();
      const fiber = Effect.runFork(
        runRoundCli(
          baseArgv(d, [process.execPath, "-e", writeReport], slowGate),
          cap.io,
        ),
      );

      // Wait until verifying is durable (state event in journal)
      const journal = join(
        d.stateRoot,
        "runs",
        "r3-cli-run",
        "events.ndjson",
      );
      const deadline = Date.now() + 15_000;
      let sawVerifying = false;
      while (Date.now() < deadline) {
        try {
          const text = readFileSync(journal, "utf8");
          if (text.includes('"verifying"') && text.includes('"state"')) {
            sawVerifying = true;
            break;
          }
        } catch {
          /* not yet */
        }
        await new Promise((r) => setTimeout(r, 30));
      }
      assert.equal(sawVerifying, true, "verifying must be durable");

      await Effect.runPromise(Fiber.interrupt(fiber));

      // Journal must not have terminal event
      const bytes = readFileSync(journal);
      const before = Buffer.from(bytes);
      const replay = replayNdjsonBytes(bytes, { fromLine: 0 });
      assert.equal(replay.terminal._tag, "CleanEof");
      const types = replay.records.map((r) => r.event.type);
      assert.ok(types.includes("state"));
      assert.ok(!types.includes("round_done"));
      assert.ok(!types.includes("waiting_child"));
      assert.ok(!types.includes("alert"));

      const events = replay.records.map((r) => r.event) as StoredEvent[];
      const runId = decodeRunId("r3-cli-run") as RunId;
      const laneId = decodeLaneId("grok-r3") as LaneId;
      // attempt 1
      const identity = {
        runId,
        laneId,
        attemptId: 1 as import("@foreman/event-log").AttemptId,
      };
      const recovery = recoverRoundAttempt(events, identity);
      assert.equal(recovery._tag, "Recoverable");
      if (recovery._tag === "Recoverable") {
        assert.ok(recovery.roundPlan !== null);
        assert.ok(recovery.checkpointIdentity.commit.length === 40);
      }

      // Journal unchanged by recovery (pure)
      const after = readFileSync(journal);
      assert.ok(before.equals(after));
    } finally {
      d.cleanup();
    }
  });
});

describe("journal failure hygiene and CLI exit 3", () => {
  it("regular file at ROOT/runs maps to boundary failure exit 3", async () => {
    const d = makeDirs();
    try {
      writeFileSync(join(d.stateRoot, "runs"), "not-a-dir");
      const cap = captureIo();
      const code = await Effect.runPromise(
        runRoundCli(
          baseArgv(d, [process.execPath, "-e", "process.exit(0)"], "true"),
          cap.io,
        ),
      );
      assert.equal(code, EXIT_BOUNDARY_FAILURE);
      assert.equal(cap.stderr, MSG_BOUNDARY_FAILURE + "\n");
      assert.equal(cap.stdout, "");
      // Failure hygiene: no absolute path leak on diagnostic
      assert.equal(cap.stderr.includes(d.stateRoot), false);
    } finally {
      d.cleanup();
    }
  });
});

describe("bundled lane-round output drain without process.exit", () => {
  function stripNodeWarnings(text: string): string {
    return text
      .split("\n")
      .filter(
        (line) =>
          !line.includes("NO_COLOR") &&
          !line.includes("FORCE_COLOR") &&
          !line.includes("trace-warnings") &&
          !line.startsWith("(node:"),
      )
      .join("\n");
  }

  it("preserves complete final diagnostic line under backpressured stderr", async () => {
    // TypeScript entry under tsx exercises the same exitCode/drain path.
    const entry = resolve("packages/orchestration/src/round-main.ts");
    const d = makeDirs();
    try {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          entry,
          "--state-root",
          // missing required options → invalid arguments
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            NODE_NO_WARNINGS: "1",
          },
        },
      );
      // Attach close listener immediately so a fast exit cannot be missed.
      const closeResult: Promise<number | null> = new Promise((resolveP) => {
        child.on("close", (c) => resolveP(c));
      });
      // Backpressure: pause streams so the final line must wait for drain.
      child.stdout?.pause();
      child.stderr?.pause();
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (c: Buffer) => {
        stdout += c.toString("utf8");
      });
      child.stderr?.on("data", (c: Buffer) => {
        stderr += c.toString("utf8");
      });
      await new Promise((r) => setTimeout(r, 50));
      child.stdout?.resume();
      child.stderr?.resume();
      const code: number | null = await closeResult;
      assert.equal(code, EXIT_INVALID_ARGUMENTS);
      assert.equal(
        stripNodeWarnings(stderr),
        MSG_INVALID_ARGUMENTS + "\n",
      );
      assert.equal(stripNodeWarnings(stdout), "");
    } finally {
      d.cleanup();
    }
  });

  it("bundled runtime preserves complete outcome line without process.exit", async () => {
    const bundle = resolve("skills/foreman/runtime/dist/lane-round.js");
    assert.equal(existsSync(bundle), true, "tracked bundle must exist");
    // Static check on source: sets exitCode; no process.exit( call.
    const mainSrc = readFileSync(
      resolve("packages/orchestration/src/round-main.ts"),
      "utf8",
    );
    assert.equal(/\bprocess\.exit\s*\(/.test(mainSrc), false);
    assert.ok(mainSrc.includes("process.exitCode"));

    const d = makeDirs();
    try {
      const writeReport = `
        const fs = require("node:fs");
        fs.writeFileSync(${JSON.stringify(d.report)}, "bundle-fresh\\n");
      `;
      const child = spawn(
        process.execPath,
        [
          bundle,
          "--state-root",
          d.stateRoot,
          "--worktree",
          d.worktree,
          "--run",
          "r3-cli-run",
          "--lane",
          "grok-r3",
          "--report",
          d.report,
          "--gate",
          "true",
          "--",
          process.execPath,
          "-e",
          writeReport,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        },
      );
      // Attach close listener immediately so a fast exit cannot be missed.
      const closeResult: Promise<number | null> = new Promise((resolveP) => {
        child.on("close", (c) => resolveP(c));
      });
      child.stdout?.pause();
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (c: Buffer) => {
        stdout += c.toString("utf8");
      });
      child.stderr?.on("data", (c: Buffer) => {
        stderr += c.toString("utf8");
      });
      await new Promise((r) => setTimeout(r, 100));
      child.stdout?.resume();
      const code: number | null = await closeResult;
      assert.equal(code, EXIT_COMPLETED, `code=${code} stderr=${stderr}`);
      assert.ok(stdout.endsWith("\n"), "outcome must end with LF");
      const outcome = JSON.parse(stdout.trim());
      assert.equal(outcome._tag, "completed");
      assert.equal(stripNodeWarnings(stderr), "");
    } finally {
      d.cleanup();
    }
  });
});

// Ensure sha256Hex import is used if needed for digest checks
void sha256Hex;
void symlinkSync;
