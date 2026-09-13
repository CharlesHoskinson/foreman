import { test } from "node:test";
import assert from "node:assert/strict";
import {
  admitCell,
  resolveTransport,
  validateToolPolicy,
  listProviderCells,
} from "./registry.js";
import { PROVIDER_PROFILES, controlsHash } from "./profiles.js";
import type { CapabilityEvidenceV1, AdmissionBindingV1 } from "./contract.js";
const p = PROVIDER_PROFILES.find((p) => p.id === "gpt-6-astra")!;
const binding: AdmissionBindingV1 = {
  kind: "product",
  expectedIdentityRevision: "v1",
  now: 100,
  transportVersion: "1",
  controls: p.defaults,
  credentialProfileRef: "account:one",
};
const evidence: CapabilityEvidenceV1 = {
  capability: "generation",
  state: "live-qualified",
  profileId: p.id,
  transportId: "openai-responses",
  profileHash: p.profileHash,
  sourceManifestHash: p.sourceManifestHash,
  transportVersion: "1",
  controlsHash: controlsHash(p.defaults),
  observedAt: 50,
  expiresAt: 150,
  observedIdentity: {
    kind: "api",
    provider: "openai",
    profileId: p.id,
    transportId: "openai-responses",
    credentialProfileRef: "account:one",
    endpointRevision: "v1",
    responseId: "r1",
  },
  evidenceRef: "evidence:one",
};
test("T-M3-003/T-M3-023 exact per-capability evidence gates product admission", () => {
  assert(
    admitCell(p.id, "openai-responses", ["generation"], [evidence], binding).ok,
  );
  for (const change of [
    { state: "documented" },
    { state: "fixture-tested" },
    { expiresAt: 100 },
    { observedAt: 101 },
    { profileHash: "bad" },
    { sourceManifestHash: "bad" },
    { transportVersion: "2" },
    { controlsHash: "bad" },
    {
      observedIdentity: {
        ...evidence.observedIdentity!,
        profileId: "gpt-5.6-sol",
      },
    },
    {
      observedIdentity: {
        ...evidence.observedIdentity!,
        credentialProfileRef: "other",
      },
    },
  ] as const) {
    const r = admitCell(
      p.id,
      "openai-responses",
      ["generation"],
      [{ ...evidence, ...change }],
      binding,
    );
    assert(!r.ok);
    assert.equal(r.error._tag, "CapabilityUnverified");
  }
  assert(
    !admitCell(
      p.id,
      "openai-responses",
      ["generation", "reconcile"],
      [evidence],
      binding,
    ).ok,
  );
  const fixture = {
    ...evidence,
    state: "fixture-tested",
    fixtureManifestHash: "fixture",
    endpointIdentity: "fake://openai",
  } as const;
  const testBinding = {
    ...binding,
    kind: "test-fixture",
    fixtureManifestHash: "fixture",
    endpointIdentity: "fake://openai",
  } as const;
  assert(
    admitCell(p.id, "openai-responses", ["generation"], [fixture], testBinding)
      .ok,
  );
  assert(
    !admitCell(
      p.id,
      "openai-responses",
      ["generation"],
      [evidence],
      testBinding,
    ).ok,
  );
  assert(
    !admitCell(p.id, "openai-responses", ["generation"], [fixture], binding).ok,
  );
});
test("T-M3-024 transport selection and host policy have no fallback", () => {
  assert.equal(resolveTransport(p.id, undefined, []).ok, false);
  assert.equal(
    resolveTransport(p.id, undefined, ["openai-responses", "codex-app-server"])
      .ok,
    false,
  );
  assert.deepEqual(
    resolveTransport(p.id, "codex-app-server", [
      "openai-responses",
      "codex-app-server",
    ]),
    { ok: true, value: "codex-app-server" },
  );
  assert.equal(
    validateToolPolicy(
      "openai-responses",
      {
        mode: "native-coding",
        workspaceGrantId: "w",
        permissionGrantIds: ["p"],
        hostPermissionPortRef: "host",
      },
      "codingTask",
    ).ok,
    false,
  );
  assert.equal(
    validateToolPolicy("codex-app-server", { mode: "none" }, "codingTask").ok,
    false,
  );
  const rows = listProviderCells([], 100);
  assert.equal(rows.length, 12);
  assert(!rows.some((r) => r.status === "live-qualified"));
});
test("T-M3-023 native coding requires both boundaries and listing needs current binding", () => {
  const nativeIdentity = {
    kind: "native",
    provider: "openai",
    profileId: p.id,
    transportId: "codex-app-server",
    credentialProfileRef: "account:one",
    protocolVersion: "1",
    sessionId: "s",
  } as const;
  const coding = {
    ...evidence,
    transportId: "codex-app-server",
    observedIdentity: nativeIdentity,
    capability: "codingTask",
  } as const;
  assert.equal(
    admitCell(p.id, "codex-app-server", ["codingTask"], [coding], binding).ok,
    false,
  );
  const records = [
    coding,
    { ...coding, capability: "permissionBoundary" as const },
    { ...coding, capability: "workspaceBoundary" as const },
  ];
  assert(
    admitCell(p.id, "codex-app-server", ["codingTask"], records, {...binding,expectedIdentityRevision:"1"}).ok,
  );
  assert.equal(
    listProviderCells([evidence], 100).find(
      (r) => r.profileId === p.id && r.transportId === "openai-responses",
    )?.status,
    "stale",
  );
  assert.equal(
    listProviderCells([evidence], 100, [
      { profileId: p.id, transportId: "openai-responses", binding },
    ]).find((r) => r.profileId === p.id && r.transportId === "openai-responses")
      ?.status,
    "live-qualified",
  );
  assert.equal(
    listProviderCells([evidence], 100, [
      {
        profileId: p.id,
        transportId: "openai-responses",
        binding: { ...binding, transportVersion: "2" },
      },
    ]).find((r) => r.profileId === p.id && r.transportId === "openai-responses")
      ?.status,
    "stale",
  );
});
test('T-M3-023 API and native revision changes invalidate otherwise matching evidence',()=>{
 const changed=admitCell(p.id,'openai-responses',['generation'],[evidence],{...binding,expectedIdentityRevision:'v2'});assert.equal(changed.ok,false);if(!changed.ok)assert.equal(changed.error._tag,'CapabilityUnverified');
 const identity={kind:'native',provider:'openai',profileId:p.id,transportId:'codex-app-server',credentialProfileRef:'account:one',protocolVersion:'v2',sessionId:'s'} as const;
 const native={...evidence,transportId:'codex-app-server',observedIdentity:identity} as const;
 assert.equal(admitCell(p.id,'codex-app-server',['generation'],[native],{...binding,expectedIdentityRevision:'v2'}).ok,true);
 assert.equal(admitCell(p.id,'codex-app-server',['generation'],[native],{...binding,expectedIdentityRevision:'v3'}).ok,false);
 const fixture={...evidence,state:'fixture-tested',fixtureManifestHash:'f',endpointIdentity:'fake://openai'} as const;
 assert.equal(admitCell(p.id,'openai-responses',['generation'],[fixture],{...binding,kind:'test-fixture',fixtureManifestHash:'f',endpointIdentity:'fake://openai',expectedIdentityRevision:'v2'}).ok,false);
});
