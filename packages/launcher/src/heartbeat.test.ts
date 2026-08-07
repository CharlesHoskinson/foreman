import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DETACH_HANDOFF_BOUND_MS,
  HEARTBEAT_KEYS,
  buildHeartbeatLine,
  firstValidHeartbeatLine,
  formatHeartbeatLine,
  validateHeartbeatLineText,
} from "./heartbeat.js";

describe("heartbeat frozen schema", () => {
  it("emits exact frozen key set as single line with trailing newline", () => {
    const line = buildHeartbeatLine({
      nowMs: Date.parse("2026-08-05T00:00:01.000Z"),
      startedAtMs: Date.parse("2026-08-05T00:00:00.000Z"),
      launcherPid: 42,
      childPid: 99,
      jobId: "99",
      alive: true,
      stdoutBytes: 3,
      stderrBytes: 1,
    });
    const text = formatHeartbeatLine(line);
    assert.equal(text.endsWith("\n"), true);
    assert.equal(text.split("\n").filter((l) => l.length > 0).length, 1);
    const obj = JSON.parse(text) as Record<string, unknown>;
    assert.deepEqual(Object.keys(obj).sort(), [...HEARTBEAT_KEYS].sort());
    assert.equal(obj["launcher_pid"], 42);
    assert.equal(obj["pid"], 99);
    assert.equal(obj["alive"], true);
    assert.equal(obj["stdout_bytes"], 3);
    assert.equal(obj["stderr_bytes"], 1);
    assert.equal(obj["elapsed_s"], 1);
  });

  it("validates final dead line", () => {
    const dead = buildHeartbeatLine({
      nowMs: 2000,
      startedAtMs: 0,
      launcherPid: 1,
      childPid: 2,
      jobId: "2",
      alive: false,
      stdoutBytes: 0,
      stderrBytes: 0,
    });
    const v = validateHeartbeatLineText(formatHeartbeatLine(dead));
    assert.equal(v._tag, "Ok");
    if (v._tag === "Ok") assert.equal(v.line.alive, false);
  });

  it("rejects wrong keys and non-json", () => {
    assert.equal(validateHeartbeatLineText("not-json")._tag, "Invalid");
    assert.equal(validateHeartbeatLineText("{}")._tag, "Invalid");
    assert.equal(validateHeartbeatLineText("")._tag, "Invalid");
  });

  it("firstValidHeartbeatLine finds first complete line", () => {
    const live = formatHeartbeatLine(
      buildHeartbeatLine({
        nowMs: 1000,
        startedAtMs: 0,
        launcherPid: 1,
        childPid: 2,
        jobId: "2",
        alive: true,
        stdoutBytes: 0,
        stderrBytes: 0,
      }),
    );
    const v = firstValidHeartbeatLine("\n" + live);
    assert.equal(v._tag, "Ok");
    assert.equal(firstValidHeartbeatLine("")._tag, "Invalid");
  });

  it("detach handoff bound is five seconds", () => {
    assert.equal(DETACH_HANDOFF_BOUND_MS, 5000);
  });
});
