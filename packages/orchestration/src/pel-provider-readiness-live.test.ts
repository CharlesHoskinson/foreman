import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  makeCredentialProfileRecord,
  renderCredentialProfileRecordFile,
  profileIdentityOf,
} from "./credential-profile.js";
import {
  makeCredentialProfilePreflight,
  renderCredentialProfilePreflightFile,
} from "./credential-profile-preflight.js";
import { Effect } from "effect";
import type {
  ProviderTransport,
  ProbeInputV1,
  ReadinessV1,
} from "@foreman/providers";
import type { VendorPreflightRecordV1 } from "./vendor-preflight-contract.js";
import type { VendorCapabilityV1 } from "./vendor-preflight-manifest.js";
import {
  withLiveProviderReadiness,
  PREFLIGHT_READINESS_MAX_AGE_MS,
} from "./pel-provider-readiness-live.js";
const now = Date.parse("2026-09-13T12:00:00Z");
const capability: VendorCapabilityV1 = {
  vendor: "grok",
  cliName: "grok",
  evidenceClass: "probed",
  authArgv: ["auth", "status"],
  versionArgv: ["--version"],
  versionFloor: "1.0.0",
  authPositiveMarkers: ["yes"],
  authNegativeMarkers: ["no"],
  updateMutates: true,
  updateCheckArgv: null,
  loginInstruction: "do not emit",
  installInstruction: "do not emit",
  updateInstruction: "do not emit",
  diagnoseInstruction: "do not emit",
};
const record: VendorPreflightRecordV1 = {
  schemaVersion: 1,
  vendor: "grok",
  timestamp: new Date(now - 1000).toISOString(),
  resolvedPath: "/bin/grok",
  reportedVersion: "1.0.0",
  versionFloor: "1.0.0",
  facts: {
    discoverable: {
      value: "discoverable",
      evidenceClass: "probed",
      reason: "private-do-not-emit",
    },
    authenticated: {
      value: "authenticated",
      evidenceClass: "probed",
      reason: "private-do-not-emit",
    },
    current: {
      value: "current",
      evidenceClass: "probed",
      reason: "private-do-not-emit",
    },
  },
  probes: [
    {
      kind: "version",
      argv: ["/bin/grok", "--version"],
      outcome: "completed",
      exitCode: 0,
    },
    {
      kind: "auth",
      argv: ["/bin/grok", "auth", "status"],
      outcome: "completed",
      exitCode: 0,
    },
  ],
  remediation: { kind: "none", instruction: null },
};
const input: ProbeInputV1 = {
  profileId: "grok-4.6",
  transportId: "grok-acp",
  credentialProfileRef: "profile:grok:work",
  mode: "metadata-only",
};
const context = {
  stateRoot: "/unused",
  userHome: "/unused",
  worktreeRoot: "/unused",
  environment: {},
};
function fake() {
  let probes = 0;
  const transport = {
    id: "grok-acp",
    version: "1.0.0",
    installedVersion: "1.0.0",
    probe: (i: ProbeInputV1) => {
      probes++;
      return Effect.succeed({
        schemaVersion: 1,
        profileId: i.profileId,
        transportId: i.transportId,
        checkedAt: now,
        mode: i.mode,
        discovery: { state: "unknown" },
        authentication: { state: "unknown" },
        currency: { state: "unknown" },
        identity: { state: "unknown" },
        capabilities: [],
      } as ReadinessV1);
    },
    start: () => Effect.die("workload forbidden"),
  } as unknown as ProviderTransport;
  return {
    transport,
    get probes() {
      return probes;
    },
  };
}
test("T-M3-013 stored current profile-bound metadata remains independent from model and capability evidence", async () => {
  const f = fake();
  const wrapped = withLiveProviderReadiness(f.transport, input, context, {
    now: () => now,
    capability: () => capability,
    executable: () => Effect.succeed("/bin/grok"),
    record: () =>
      Effect.succeed({
        record,
        credentialProfileRef: input.credentialProfileRef,
      }),
  });
  const result = await Effect.runPromise(wrapped.probe(input));
  assert.equal(result.discovery.state, "available");
  assert.equal(result.authentication.state, "authenticated");
  assert.equal(result.currency.state, "current");
  assert.equal(result.currency.sourceManifestHash, undefined);
  assert.equal(result.identity.state, "unknown");
  assert.deepEqual(result.capabilities, []);
  assert.equal(result.authentication.evidenceKind, "metadata");
  assert.equal(result.authentication.observedAt, now - 1000);
  assert.doesNotMatch(JSON.stringify(result), /private-do-not-emit/);
});
test("legacy account absence and changed account preserve unknown authentication", async () => {
  for (const credentialProfileRef of [undefined, "profile:grok:other"]) {
    const f = fake();
    const result = await Effect.runPromise(
      withLiveProviderReadiness(f.transport, input, context, {
        now: () => now,
        capability: () => capability,
        executable: () => Effect.succeed("/bin/grok"),
        record: () =>
          Effect.succeed({
            record,
            ...(credentialProfileRef ? { credentialProfileRef } : {}),
          }),
      }).probe(input),
    );
    assert.equal(result.discovery.state, "available");
    assert.equal(result.authentication.state, "unknown");
    assert.equal(result.authentication.remediation, undefined);
  }
});
test("expired, future, changed source, installed version and path records cannot supply readiness facts", async () => {
  for (const changed of [
    {
      ...record,
      timestamp: new Date(
        now - PREFLIGHT_READINESS_MAX_AGE_MS - 1,
      ).toISOString(),
    },
    { ...record, timestamp: new Date(now + 1).toISOString() },
    { ...record, versionFloor: "0.1.0" },
    { ...record, reportedVersion: "0.9.0" },
    { ...record, resolvedPath: "/different/grok" },
  ]) {
    const f = fake();
    const result = await Effect.runPromise(
      withLiveProviderReadiness(f.transport, input, context, {
        now: () => now,
        capability: () => capability,
        executable: () => Effect.succeed("/bin/grok"),
        record: () =>
          Effect.succeed({
            record: changed,
            credentialProfileRef: input.credentialProfileRef,
          }),
      }).probe(input),
    );
    assert.equal(result.authentication.state, "unknown");
    assert.equal(result.currency.state, "unknown");
  }
});
test("bounded-workload probe is explicitly rejected before metadata reads or underlying probes", async () => {
  const f = fake();
  let reads = 0;
  const wrapper = withLiveProviderReadiness(f.transport, input, context, {
    record: () => {
      reads++;
      return Effect.succeed(undefined);
    },
  });
  const result = await Effect.runPromise(
    Effect.either(wrapper.probe({ ...input, mode: "bounded-workload" })),
  );
  assert.equal(result._tag, "Left");
  if (result._tag === "Left")
    assert.equal(result.left._tag, "UnsupportedCapability");
  assert.equal(reads, 0);
  assert.equal(f.probes, 0);
});
test("default adapter reuses bounded legacy store and never interprets legacy authentication as selected-account evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "fm-readiness-"));
  try {
    await mkdir(join(root, "preflight"));
    await writeFile(
      join(root, "preflight", "grok.json"),
      JSON.stringify(record),
    );
    const f = fake();
    const selected = { ...input, credentialProfileRef: "native:grok:default" };
    const wrapped = withLiveProviderReadiness(
      f.transport,
      selected,
      { ...context, stateRoot: root, worktreeRoot: process.cwd() },
      {
        now: () => now,
        capability: () => capability,
        executable: () => Effect.succeed("/bin/grok"),
      },
    );
    const result = await Effect.runPromise(wrapped.probe(selected));
    assert.equal(result.discovery.state, "available");
    assert.equal(result.authentication.state, "unknown");
    await writeFile(
      join(root, "preflight", "grok.json"),
      "invalid private-do-not-emit",
    );
    const malformed = await Effect.runPromise(wrapped.probe(selected));
    assert.equal(malformed.currency.state, "unknown");
    assert.doesNotMatch(JSON.stringify(malformed), /private-do-not-emit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("T-M3-014 only explicit profile-bound signed-out evidence has login remediation", async () => {
  for (const state of ["not-authenticated", "unknown"] as const) {
    const f = fake();
    const changed: VendorPreflightRecordV1 = {
      ...record,
      facts: {
        ...record.facts,
        authenticated: { ...record.facts.authenticated, value: state },
      },
      probes: record.probes.map((p) =>
        p.kind === "auth"
          ? {
              ...p,
              outcome: state === "unknown" ? "timeout" : "completed",
              exitCode: state === "unknown" ? null : 1,
            }
          : p,
      ),
      remediation:
        state === "not-authenticated"
          ? { kind: "login", instruction: "private-do-not-emit" }
          : { kind: "diagnose", instruction: "private-do-not-emit" },
    };
    const result = await Effect.runPromise(
      withLiveProviderReadiness(f.transport, input, context, {
        now: () => now,
        capability: () => capability,
        executable: () => Effect.succeed("/bin/grok"),
        record: () =>
          Effect.succeed({
            record: changed,
            credentialProfileRef: input.credentialProfileRef,
          }),
      }).probe(input),
    );
    assert.equal(
      result.authentication.state,
      state === "not-authenticated" ? "signed-out" : "unknown",
    );
    assert.equal(
      result.authentication.remediation !== undefined,
      state === "not-authenticated",
    );
    assert.doesNotMatch(JSON.stringify(result), /private-do-not-emit/);
  }
});
test("default profile wrapper reader requires current authority identity and never reads credential content", async () => {
  const root = await mkdtemp(join(tmpdir(), "fm-profile-readiness-"));
  const authority = join(root, "credential-profiles", "work");
  try {
    for (const path of [
      join(root, "credential-profiles"),
      authority,
      join(authority, "homes"),
      join(authority, "homes", "grok"),
      join(authority, "preflight"),
    ])
      await mkdir(path, { mode: 0o700 });
    const profile = makeCredentialProfileRecord("work", "grok");
    await writeFile(
      join(authority, "profile.json"),
      renderCredentialProfileRecordFile(profile),
      { mode: 0o600 },
    );
    const path = join(authority, "preflight", "grok.json");
    const wrapper = makeCredentialProfilePreflight(
      "work",
      profileIdentityOf(profile),
      "grok",
      record,
    );
    await writeFile(path, renderCredentialProfilePreflightFile(wrapper), {
      mode: 0o600,
    });
    const f = fake();
    const wrapped = withLiveProviderReadiness(
      f.transport,
      input,
      { ...context, stateRoot: root, worktreeRoot: process.cwd() },
      {
        now: () => now,
        capability: () => capability,
        executable: () => Effect.succeed("/bin/grok"),
      },
    );
    assert.equal(
      (await Effect.runPromise(wrapped.probe(input))).authentication.state,
      "authenticated",
    );
    await writeFile(
      path,
      renderCredentialProfilePreflightFile({
        ...wrapper,
        profileIdentity: "0".repeat(64),
      }),
      { mode: 0o600 },
    );
    assert.equal(
      (await Effect.runPromise(wrapped.probe(input))).authentication.state,
      "unknown",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
