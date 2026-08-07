/**
 * tool-check CLI argument parsing tests (TDD).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MSG_LANE_CLAUDE,
  USAGE,
  parseToolCheckArgv,
  stripToolCheckNodeArgv,
} from "./tool-check-cli.js";

describe("stripToolCheckNodeArgv", () => {
  it("strips node binary and script path", () => {
    assert.deepEqual(
      stripToolCheckNodeArgv([
        "/usr/bin/node",
        "/repo/skills/foreman/runtime/dist/tool-check.js",
        "--profile",
        "soft",
      ]),
      ["--profile", "soft"],
    );
  });

  it("leaves bare flags alone", () => {
    assert.deepEqual(stripToolCheckNodeArgv(["--json"]), ["--json"]);
  });
});

describe("parseToolCheckArgv", () => {
  it("defaults to soft profile with no lane", () => {
    const p = parseToolCheckArgv(["node", "tool-check.js"]);
    assert.equal(p._tag, "Run");
    if (p._tag === "Run") {
      assert.equal(p.profile, "soft");
      assert.equal(p.json, false);
      assert.equal(p.out, null);
      assert.equal(p.lane, null);
    }
  });

  it("accepts --profile hard|full|durable and --json --out --lane", () => {
    const p = parseToolCheckArgv([
      "node",
      "tool-check.js",
      "--profile",
      "full",
      "--json",
      "--out",
      "/tmp/out.json",
      "--lane",
      "grok",
    ]);
    assert.deepEqual(p, {
      _tag: "Run",
      profile: "full",
      json: true,
      out: "/tmp/out.json",
      lane: "grok",
    });
  });

  it("accepts codex lane", () => {
    const p = parseToolCheckArgv(["--lane", "codex"]);
    assert.equal(p._tag, "Run");
    if (p._tag === "Run") assert.equal(p.lane, "codex");
  });

  it("rejects --lane claude with T7 message", () => {
    const p = parseToolCheckArgv(["--lane", "claude"]);
    assert.equal(p._tag, "Invalid");
    if (p._tag === "Invalid") {
      assert.equal(p.message, MSG_LANE_CLAUDE);
    }
  });

  it("rejects bad lane and bad profile", () => {
    const badLane = parseToolCheckArgv(["--lane", "agy"]);
    assert.equal(badLane._tag, "Invalid");
    if (badLane._tag === "Invalid") {
      assert.match(badLane.message, /bad lane/);
    }
    const badProf = parseToolCheckArgv(["--profile", "mega"]);
    assert.equal(badProf._tag, "Invalid");
    if (badProf._tag === "Invalid") {
      assert.match(badProf.message, /bad profile/);
    }
  });

  it("rejects unknown args", () => {
    const p = parseToolCheckArgv(["--nope"]);
    assert.equal(p._tag, "Invalid");
    if (p._tag === "Invalid") {
      assert.match(p.message, /unknown arg/);
    }
  });

  it("returns Help for -h/--help", () => {
    assert.equal(parseToolCheckArgv(["-h"])._tag, "Help");
    assert.equal(parseToolCheckArgv(["--help"])._tag, "Help");
  });

  it("rejects missing values for profile/out/lane", () => {
    assert.equal(parseToolCheckArgv(["--profile"])._tag, "Invalid");
    assert.equal(parseToolCheckArgv(["--out"])._tag, "Invalid");
    assert.equal(parseToolCheckArgv(["--lane"])._tag, "Invalid");
  });

  it("USAGE is stable", () => {
    assert.match(USAGE, /--profile/);
    assert.match(USAGE, /--lane grok\|codex/);
  });
});
