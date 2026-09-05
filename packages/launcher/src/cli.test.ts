import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXIT_LAUNCHER_ERROR,
  EXIT_TIMEOUT,
  FOREMAN_LAUNCH_VERSION,
  argvWithoutDetach,
  formatVersionLine,
  mapSuperviseExit,
  parseArgs,
  stripNodeArgv,
  usage,
} from "./cli.js";

describe("cli parse and exit mapping", () => {
  it("parses frozen flags after strip", () => {
    const r = parseArgs([
      "--timeout",
      "5",
      "--grace",
      "2",
      "--heartbeat-file",
      "/tmp/hb",
      "--heartbeat-interval",
      "3",
      "--require-containment",
      "strong",
      "--capability-file",
      "/tmp/cap",
      "--",
      "echo",
      "hi",
    ]);
    assert.equal(r._tag, "Ok");
    if (r._tag !== "Ok") return;
    assert.equal(r.value.timeoutSecs, 5);
    assert.equal(r.value.graceSecs, 2);
    assert.equal(r.value.heartbeatFile, "/tmp/hb");
    assert.equal(r.value.heartbeatIntervalSecs, 3);
    assert.equal(r.value.detach, false);
    assert.equal(r.value.requireContainment, "strong");
    assert.equal(r.value.capabilityFile, "/tmp/cap");
    assert.equal(r.value.probeOnly, false);
    assert.deepEqual(r.value.cmd, ["echo", "hi"]);
  });

  it("defaults grace 10 and heartbeat interval 15", () => {
    const r = parseArgs(["--", "true"]);
    assert.equal(r._tag, "Ok");
    if (r._tag !== "Ok") return;
    assert.equal(r.value.graceSecs, 10);
    assert.equal(r.value.heartbeatIntervalSecs, 15);
    assert.equal(r.value.timeoutSecs, undefined);
    assert.equal(r.value.requireContainment, "any");
    assert.equal(r.value.capabilityFile, undefined);
    assert.equal(r.value.probeOnly, false);
  });

  it("allows probe-only without a separator or command", () => {
    const r = parseArgs([
      "--probe-only",
      "--require-containment",
      "strong",
      "--capability-file",
      "/tmp/cap.json",
    ]);
    assert.equal(r._tag, "Ok");
    if (r._tag !== "Ok") return;
    assert.equal(r.value.probeOnly, true);
    assert.deepEqual(r.value.cmd, []);
  });

  it("maps --version without requiring --", () => {
    assert.equal(parseArgs(["--version"])._tag, "Version");
    assert.equal(parseArgs(["--version", "--timeout", "1"])._tag, "Version");
  });

  it("rejects missing separator, empty cmd, bad numbers, unknown flags", () => {
    assert.equal(parseArgs(["true"])._tag, "UsageError");
    assert.equal(parseArgs(["--"])._tag, "UsageError");
    assert.equal(parseArgs(["--timeout", "0", "--", "true"])._tag, "UsageError");
    assert.equal(parseArgs(["--timeout", "x", "--", "true"])._tag, "UsageError");
    assert.equal(parseArgs(["--grace", "-1", "--", "true"])._tag, "UsageError");
    assert.equal(
      parseArgs(["--heartbeat-interval", "0", "--", "true"])._tag,
      "UsageError",
    );
    assert.equal(parseArgs(["--nope", "--", "true"])._tag, "UsageError");
    assert.equal(parseArgs(["--detach", "--", "true"])._tag, "UsageError");
    assert.equal(
      parseArgs(["--require-containment", "weak", "--", "true"])._tag,
      "UsageError",
    );
    assert.equal(
      parseArgs(["--capability-file", "--", "true"])._tag,
      "UsageError",
    );
    assert.equal(
      parseArgs(["--probe-only", "--detach", "--heartbeat-file", "f"])._tag,
      "UsageError",
    );
  });

  it("requires --heartbeat-file with --detach", () => {
    const r = parseArgs(["--detach", "--heartbeat-file", "f", "--", "true"]);
    assert.equal(r._tag, "Ok");
    if (r._tag !== "Ok") return;
    assert.equal(r.value.detach, true);
  });

  it("strips node and script path", () => {
    assert.deepEqual(
      stripNodeArgv(["node", "foreman-launch.js", "--", "true"]),
      ["--", "true"],
    );
    assert.deepEqual(stripNodeArgv(["--", "true"]), ["--", "true"]);
  });

  it("version line names node not bun", () => {
    const line = formatVersionLine("v24.18.1");
    assert.match(line, /foreman-launch/);
    assert.match(line, /node 24\.18\.1/);
    assert.equal(line.includes("bun"), false);
    assert.equal(line.includes(FOREMAN_LAUNCH_VERSION), true);
  });

  it("maps timeout and child exit codes", () => {
    assert.equal(mapSuperviseExit({ timedOut: true, exitCode: 0 }), EXIT_TIMEOUT);
    assert.equal(mapSuperviseExit({ timedOut: false, exitCode: 7 }), 7);
    assert.equal(mapSuperviseExit({ timedOut: false, exitCode: 0 }), 0);
    assert.equal(EXIT_LAUNCHER_ERROR, 125);
  });

  it("usage mentions frozen flags", () => {
    const u = usage();
    assert.match(u, /--timeout/);
    assert.match(u, /--grace/);
    assert.match(u, /--heartbeat-file/);
    assert.match(u, /--detach/);
    assert.match(u, /--require-containment strong\|any/);
    assert.match(u, /--capability-file/);
    assert.match(u, /--probe-only/);
    assert.match(u, /124/);
    assert.match(u, /125/);
  });

  it("argvWithoutDetach drops only --detach", () => {
    assert.deepEqual(
      argvWithoutDetach([
        "--detach",
        "--heartbeat-file",
        "f",
        "--require-containment",
        "strong",
        "--capability-file",
        "/tmp/cap",
        "--probe-only",
        "--",
        "sleep",
        "1",
      ]),
      [
        "--heartbeat-file",
        "f",
        "--require-containment",
        "strong",
        "--capability-file",
        "/tmp/cap",
        "--probe-only",
        "--",
        "sleep",
        "1",
      ],
    );
  });

  it("argvWithoutDetach preserves --detach when it is a value", () => {
    assert.deepEqual(
      argvWithoutDetach([
        "--detach",
        "--heartbeat-file",
        "--detach",
        "--",
        "echo",
        "--detach"
      ]),
      ["--heartbeat-file", "--detach", "--", "echo", "--detach"]
    );
  });
});
