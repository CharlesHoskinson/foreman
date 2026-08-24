import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  decodeApplianceLockV1,
  parseAppliancePinsV1,
  renderApplianceLockV1,
  validateApplianceLockProjectionV1,
} from "./appliance-lock.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const MANIFEST_PATH = join(ROOT, "env/reference-manifest.toml");
const LOCK_PATH = join(ROOT, "containers/appliance/lock.json");

test("authored appliance pins render the checked-in canonical lock", () => {
  const manifest = readFileSync(MANIFEST_PATH, "utf8");
  const parsed = parseAppliancePinsV1(manifest);
  assert.equal(parsed._tag, "Valid");
  if (parsed._tag !== "Valid") return;

  const lockBytes = readFileSync(LOCK_PATH);
  assert.equal(renderApplianceLockV1(parsed.value), lockBytes.toString("utf8"));
  assert.deepEqual(
    validateApplianceLockProjectionV1({ manifestText: manifest, lockBytes }),
    { _tag: "Valid" },
  );
  assert.deepEqual(decodeApplianceLockV1(lockBytes), parsed);
});

test("appliance lock decoder accepts only the canonical closed projection", () => {
  const lock = readFileSync(LOCK_PATH);
  const text = lock.toString("utf8");
  for (const mutant of [
    lock.subarray(0, lock.byteLength - 1),
    Buffer.from(` ${text}`),
    Buffer.from(text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')),
    Buffer.from(text.replace('"schemaVersion":1', '"extra":true,"schemaVersion":1')),
  ]) {
    assert.deepEqual(decodeApplianceLockV1(mutant), { _tag: "Invalid" });
  }
});

test("appliance pin parser refuses missing, duplicate, floating, and unsafe pins", () => {
  const manifest = readFileSync(MANIFEST_PATH, "utf8");
  for (const mutant of [
    manifest.replace('node_version = "24.18.1"\n', ""),
    manifest.replace(
      'node_version = "24.18.1"',
      'node_version = "24.18.1"\nnode_version = "24.18.1"',
    ),
    manifest.replace('codex_version = "0.149.1"', 'codex_version = "latest"'),
    manifest.replace(
      "node:24.18.1-bookworm-slim@sha256:",
      "node:24.18.1-bookworm-slim:",
    ),
    manifest.replace(
      'supported_platforms = ["linux/amd64", "linux/arm64"]',
      'supported_platforms = ["linux/amd64"]',
    ),
    manifest.replace('service_endpoint = "127.0.0.1:18443"', 'service_endpoint = "0.0.0.0:18443"'),
  ]) {
    assert.deepEqual(parseAppliancePinsV1(mutant), { _tag: "Invalid" });
  }
});

test("lock validation refuses any projected byte drift", () => {
  const manifest = readFileSync(MANIFEST_PATH, "utf8");
  const lock = readFileSync(LOCK_PATH);
  const changed = Uint8Array.from(lock);
  const changedIndex = changed.byteLength - 2;
  changed[changedIndex] = changed[changedIndex]! ^ 1;
  assert.deepEqual(
    validateApplianceLockProjectionV1({ manifestText: manifest, lockBytes: changed }),
    { _tag: "Invalid" },
  );
});

test("OCI and operator assets preserve the appliance boundary", () => {
  const dockerfile = readFileSync(
    join(ROOT, "containers/appliance/Dockerfile"),
    "utf8",
  );
  for (const target of [
    "foreman-toolchain",
    "foreman-control",
    "foreman-worker",
  ]) {
    assert.match(dockerfile, new RegExp(` AS ${target}\\b`, "i"));
  }
  assert.doesNotMatch(dockerfile, /(?:^|[\s:@])latest(?:$|[\s@])/m);
  assert.match(dockerfile, /USER 10001:10001/);
  assert.match(dockerfile, /groupmod --new-name worker node/);
  assert.match(
    dockerfile,
    /usermod --login worker --home \/home\/worker --move-home node/,
  );
  assert.doesNotMatch(dockerfile, /useradd --create-home --uid 1000/);
  assert.match(
    dockerfile,
    /GROK_HOME=\/opt\/grok node \/opt\/vendor-cli\/node_modules\/@xai-official\/grok\/bin\/postinstall\.js/,
  );
  assert.match(dockerfile, /ln -s \/opt\/grok\/bin\/grok \/usr\/local\/bin\/grok/);
  assert.match(dockerfile, /\/workspace/);
  assert.match(dockerfile, /\/state/);
  assert.match(dockerfile, /\/run\/foreman/);

  const compose = readFileSync(
    join(ROOT, "containers/appliance/compose.yaml"),
    "utf8",
  );
  const devcontainer = readFileSync(
    join(ROOT, "containers/appliance/devcontainer.json"),
    "utf8",
  );
  assert.match(compose, /target: foreman-control/);
  assert.match(compose, /\/workspace/);
  assert.match(compose, /\/state/);
  assert.match(compose, /internal: true/);
  assert.match(compose, /profiles: \["semantic-memory"\]/);
  assert.doesNotMatch(compose, /docker\.sock|podman\.sock/);
  assert.doesNotMatch(compose, /^\s*ports:/m);
  assert.match(devcontainer, /"service": "control"/);
  assert.match(devcontainer, /"workspaceFolder": "\/workspace"/);
});
