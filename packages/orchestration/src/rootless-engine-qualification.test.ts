import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseAppliancePinsV1 } from "./appliance-lock.js";
import {
  qualifyRootlessEngineV1,
  type RootlessEngineObservationV1,
} from "./rootless-engine-qualification.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const parsed = parseAppliancePinsV1(
  readFileSync(join(ROOT, "env/reference-manifest.toml"), "utf8"),
);
assert.equal(parsed._tag, "Valid");
if (parsed._tag !== "Valid") throw new Error("invalid authored appliance pins");
const PINS = parsed.value;

const READY: RootlessEngineObservationV1 = {
  platform: "linux",
  architecture: "amd64",
  kernelVersion: "6.8.0",
  podmanVersion: "5.7.0",
  dockerCompatApi: "1.40",
  serviceEndpoint: "127.0.0.1:18443",
  packages: PINS.rootlessEngine.packages,
  account: {
    name: "foreman-engine",
    uid: 61001,
    gid: 61001,
    shell: "/usr/sbin/nologin",
  },
  subuid: { start: 200000, count: 65536, overlapsProtectedIds: false },
  subgid: { start: 200000, count: 65536, overlapsProtectedIds: false },
  runtimeDirectory: {
    ownerUid: 61001,
    ownerGid: 61001,
    mode: 0o700,
    symbolicLink: false,
  },
  dataDirectory: {
    ownerUid: 61001,
    ownerGid: 61001,
    mode: 0o700,
    symbolicLink: false,
  },
  tls: {
    serverKeyMode: 0o600,
    mutualTlsProbePassed: true,
    workerHasClientCredentials: false,
  },
  protectedProbes: {
    workspaceRead: false,
    workspaceWrite: false,
    workspaceTraverse: false,
    stateRead: false,
    stateWrite: false,
    stateTraverse: false,
  },
  fallbackSocketFound: false,
};

test("rootless engine qualification accepts only the pinned isolated host", () => {
  assert.deepEqual(qualifyRootlessEngineV1(PINS, READY), {
    schemaVersion: 1,
    _tag: "Qualified",
    engine: "podman",
    version: "5.7.0",
    endpoint: "127.0.0.1:18443",
    architecture: "amd64",
  });
});

test("rootless engine qualification fails closed for each authority boundary", () => {
  const cases: ReadonlyArray<{
    readonly reason: string;
    readonly observation: RootlessEngineObservationV1;
  }> = [
    { reason: "unsupported_host", observation: { ...READY, platform: "win32" } },
    { reason: "unsupported_host", observation: { ...READY, architecture: "s390x" } },
    { reason: "kernel_mismatch", observation: { ...READY, kernelVersion: "6.7.9" } },
    { reason: "version_mismatch", observation: { ...READY, podmanVersion: "5.7.1" } },
    { reason: "version_mismatch", observation: { ...READY, dockerCompatApi: "1.41" } },
    { reason: "version_mismatch", observation: { ...READY, packages: { ...READY.packages, crun: "latest" } } },
    { reason: "endpoint_mismatch", observation: { ...READY, serviceEndpoint: "0.0.0.0:18443" } },
    { reason: "account_mismatch", observation: { ...READY, account: { ...READY.account, shell: "/bin/bash" } } },
    { reason: "subid_mismatch", observation: { ...READY, subuid: { ...READY.subuid, count: 65535 } } },
    { reason: "subid_mismatch", observation: { ...READY, subgid: { ...READY.subgid, overlapsProtectedIds: true } } },
    { reason: "path_mismatch", observation: { ...READY, dataDirectory: { ...READY.dataDirectory, symbolicLink: true } } },
    { reason: "tls_mismatch", observation: { ...READY, tls: { ...READY.tls, serverKeyMode: 0o640 } } },
    { reason: "tls_mismatch", observation: { ...READY, tls: { ...READY.tls, mutualTlsProbePassed: false } } },
    { reason: "worker_authority", observation: { ...READY, tls: { ...READY.tls, workerHasClientCredentials: true } } },
    { reason: "protected_path_access", observation: { ...READY, protectedProbes: { ...READY.protectedProbes, workspaceRead: true } } },
    { reason: "fallback_socket", observation: { ...READY, fallbackSocketFound: true } },
  ];
  for (const item of cases) {
    assert.deepEqual(qualifyRootlessEngineV1(PINS, item.observation), {
      schemaVersion: 1,
      _tag: "Refused",
      reason: item.reason,
    });
  }
});

test("rootless engine qualification is total over hostile observations", () => {
  for (const value of [null, [], {}, Object.create({ ...READY })]) {
    assert.deepEqual(
      qualifyRootlessEngineV1(PINS, value as RootlessEngineObservationV1),
      { schemaVersion: 1, _tag: "Refused", reason: "invalid_observation" },
    );
  }
});

test("host templates bind a rootless local mutual-TLS service", () => {
  const host = join(ROOT, "containers/appliance/host");
  const sysusers = readFileSync(join(host, "foreman-engine.sysusers"), "utf8");
  const tmpfiles = readFileSync(join(host, "foreman-engine.tmpfiles"), "utf8");
  const unit = readFileSync(join(host, "foreman-engine.service"), "utf8");
  const containers = readFileSync(join(host, "containers.conf"), "utf8");
  const storage = readFileSync(join(host, "storage.conf"), "utf8");
  const subids = readFileSync(join(host, "foreman-engine.subid"), "utf8");

  assert.match(sysusers, /^u foreman-engine 61001:/m);
  assert.match(tmpfiles, /\/run\/foreman-engine 0700 foreman-engine foreman-engine/);
  assert.match(tmpfiles, /\/var\/lib\/foreman-engine 0700 foreman-engine foreman-engine/);
  assert.match(subids, /^foreman-engine:200000:65536$/m);
  assert.match(unit, /^User=foreman-engine$/m);
  assert.match(unit, /^Group=foreman-engine$/m);
  assert.match(unit, /podman system service --time=0/);
  assert.match(unit, /--tls-cert=\/run\/foreman-engine\/tls\/server\.crt/);
  assert.match(unit, /--tls-key=\/run\/foreman-engine\/tls\/server\.key/);
  assert.match(unit, /--tls-client-ca=\/run\/foreman-engine\/tls\/client-ca\.crt/);
  assert.match(unit, /tcp:\/\/127\.0\.0\.1:18443/);
  assert.match(unit, /^NoNewPrivileges=true$/m);
  assert.doesNotMatch(unit, /docker\.sock|podman\.sock|0\.0\.0\.0/);
  assert.match(containers, /runtime = "crun"/);
  assert.match(containers, /network_backend = "netavark"/);
  assert.match(storage, /graphroot = "\/var\/lib\/foreman-engine\/storage"/);
});
