import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalize } from "@foreman/core";
import { parseAppliancePinsV1 } from "./appliance-lock.js";
import {
  evaluateApplianceDoctorV1,
  runApplianceDoctorCli,
  type ApplianceDoctorObservationV1,
} from "./appliance-doctor.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const parsed = parseAppliancePinsV1(
  readFileSync(join(ROOT, "env/reference-manifest.toml"), "utf8"),
);
assert.equal(parsed._tag, "Valid");
if (parsed._tag !== "Valid") throw new Error("invalid authored appliance pins");
const PINS = parsed.value;

const READY: ApplianceDoctorObservationV1 = {
  uid: 10001,
  nodeVersion: "24.18.1",
  toolVersions: {
    npm: "11.16.0",
    codex: "0.149.1",
    grok: "1.0.5",
    graphify: "0.9.48",
  },
  directories: {
    workspace: { directory: true, writable: true },
    state: { directory: true, writable: true },
    runtime: { directory: true, writable: true },
  },
  runtimeManifestValid: true,
  skills: ["foreman", "graphify", "superpowers"],
};

test("appliance doctor reports exact nonroot runtime and skill identity", () => {
  assert.deepEqual(evaluateApplianceDoctorV1(PINS, READY), {
    schemaVersion: 1,
    _tag: "Ready",
    uid: 10001,
    tools: {
      node: "24.18.1",
      npm: "11.16.0",
      codex: "0.149.1",
      grok: "1.0.5",
      graphify: "0.9.48",
    },
    skills: ["foreman", "graphify", "superpowers"],
  });
});

test("appliance doctor fails closed for every runtime boundary", () => {
  const cases: ReadonlyArray<{
    readonly reason: string;
    readonly observation: ApplianceDoctorObservationV1;
  }> = [
    { reason: "root_user", observation: { ...READY, uid: 0 } },
    {
      reason: "tool_mismatch",
      observation: { ...READY, nodeVersion: "24.18.0" },
    },
    {
      reason: "tool_mismatch",
      observation: {
        ...READY,
        toolVersions: { ...READY.toolVersions, graphify: "0.9.47" },
      },
    },
    {
      reason: "mount_mismatch",
      observation: {
        ...READY,
        directories: {
          ...READY.directories,
          state: { directory: true, writable: false },
        },
      },
    },
    {
      reason: "runtime_mismatch",
      observation: { ...READY, runtimeManifestValid: false },
    },
    {
      reason: "skill_mismatch",
      observation: { ...READY, skills: ["foreman", "graphify"] },
    },
    {
      reason: "skill_mismatch",
      observation: {
        ...READY,
        skills: ["foreman", "graphify", "superpowers", "unknown"],
      },
    },
  ];

  for (const item of cases) {
    assert.deepEqual(evaluateApplianceDoctorV1(PINS, item.observation), {
      schemaVersion: 1,
      _tag: "Refused",
      reason: item.reason,
    });
  }
});

test("appliance doctor is total over hostile observations", () => {
  for (const value of [
    null,
    [],
    {},
    { ...READY, uid: Number.NaN },
    { ...READY, toolVersions: null },
    Object.create({ ...READY }),
  ]) {
    assert.deepEqual(
      evaluateApplianceDoctorV1(PINS, value as ApplianceDoctorObservationV1),
      { schemaVersion: 1, _tag: "Refused", reason: "invalid_observation" },
    );
  }
});

test("appliance doctor CLI emits one canonical result line", () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = runApplianceDoctorCli(
    ["node", "appliance-doctor.js", "doctor"],
    {
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    },
    { loadPins: () => PINS, observe: () => READY },
  );
  const result = evaluateApplianceDoctorV1(PINS, READY);
  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [`${canonicalize(result)}\n`]);
  assert.deepEqual(stderr, []);
});

test("appliance doctor CLI refuses bad argv before touching services", () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let calls = 0;
  const exitCode = runApplianceDoctorCli(
    ["node", "appliance-doctor.js", "--help"],
    {
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    },
    {
      loadPins: () => {
        calls += 1;
        return PINS;
      },
      observe: () => {
        calls += 1;
        return READY;
      },
    },
  );
  assert.equal(exitCode, 64);
  assert.equal(calls, 0);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ["usage: appliance-doctor doctor\n"]);
});

test("appliance doctor CLI sanitizes live dependency failures", () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = runApplianceDoctorCli(
    ["node", "appliance-doctor.js", "doctor"],
    {
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    },
    {
      loadPins: () => {
        throw new Error("secret /host/path");
      },
      observe: () => READY,
    },
  );
  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, [
    `${canonicalize({
      schemaVersion: 1,
      _tag: "Refused",
      reason: "invalid_observation",
    })}\n`,
  ]);
  assert.deepEqual(stderr, []);
  assert.doesNotMatch(stdout.join(""), /secret|host|path/);
});
