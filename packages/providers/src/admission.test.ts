import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AdmissionBindingV1,
  CapabilityEvidenceV1,
  Capability,
  ProviderIdentityV1,
} from "./contract.js";
import { PROVIDER_PROFILES, controlsHash } from "./profiles.js";
import { admitCell, isNativeTransport, listProviderCells } from "./registry.js";
test("T-M3-023/R-M3-023 each declared cell isolates fixture evidence from product admission", () => {
  for (const p of PROVIDER_PROFILES)
    for (const transportId of p.transports) {
      const identity: ProviderIdentityV1 = isNativeTransport(transportId)
        ? {
            kind: "native",
            provider: p.provider,
            profileId: p.id,
            transportId,
            credentialProfileRef: "fixture-account",
            protocolVersion: "v1",
            sessionId: "s",
          }
        : {
            kind: "api",
            provider: p.provider,
            profileId: p.id,
            transportId,
            credentialProfileRef: "fixture-account",
            endpointRevision: "v1",
            responseId: "r",
          };
      const binding: AdmissionBindingV1 = {
        kind: "test-fixture",
        expectedIdentityRevision: "v1",
        now: 100,
        transportVersion: "1",
        controls: p.defaults,
        credentialProfileRef: "fixture-account",
        fixtureManifestHash: "manifest",
        endpointIdentity: "fake://peer",
      };
      const required: readonly Capability[] = [
        "generation",
        "structuredOutput",
      ];
      const records: readonly CapabilityEvidenceV1[] = required.map(
        (capability) => ({
          capability,
          state: "fixture-tested",
          profileId: p.id,
          transportId,
          profileHash: p.profileHash,
          sourceManifestHash: p.sourceManifestHash,
          transportVersion: "1",
          controlsHash: controlsHash(p.defaults),
          observedAt: 90,
          expiresAt: 110,
          observedIdentity: identity,
          evidenceRef: "fixture:report",
          fixtureManifestHash: "manifest",
          endpointIdentity: "fake://peer",
        }),
      );
      assert(admitCell(p.id, transportId, required, records, binding).ok);
      const product: AdmissionBindingV1 = {
        kind: "product",
        expectedIdentityRevision: "v1",
        now: 100,
        transportVersion: "1",
        controls: p.defaults,
        credentialProfileRef: "fixture-account",
      };
      const denied = admitCell(p.id, transportId, required, records, product);
      assert(!denied.ok);
      assert.equal(denied.error._tag, "CapabilityUnverified");
      const partial = admitCell(
        p.id,
        transportId,
        required,
        records.slice(0, 1),
        binding,
      );
      assert(!partial.ok);
      assert.equal(partial.error.fieldPath, "structuredOutput");
      const wrongManifest = admitCell(p.id, transportId, required, records, {
        ...binding,
        fixtureManifestHash: "different",
      });
      assert(!wrongManifest.ok);
      assert.equal(
        listProviderCells(records, 100).find(
          (row) => row.profileId === p.id && row.transportId === transportId,
        )?.status,
        "test-fixture",
      );
    }
});
test("T-M3-023/R-M3-023 unused optional unknown capability does not block an exact execution assertion", () => {
  const p = PROVIDER_PROFILES[0]!;
  const binding: AdmissionBindingV1 = {
    kind: "product",
    expectedIdentityRevision: "v1",
    now: 100,
    transportVersion: "1",
    controls: p.defaults,
    credentialProfileRef: "account",
  };
  const base: CapabilityEvidenceV1 = {
    capability: "generation",
    state: "live-qualified",
    profileId: p.id,
    transportId: "xai-responses",
    profileHash: p.profileHash,
    sourceManifestHash: p.sourceManifestHash,
    transportVersion: "1",
    controlsHash: controlsHash(p.defaults),
    observedAt: 90,
    expiresAt: 110,
    observedIdentity: {
      kind: "api",
      provider: "xai",
      profileId: p.id,
      transportId: "xai-responses",
      credentialProfileRef: "account",
      endpointRevision: "v1",
      responseId: "response",
    },
    evidenceRef: "report:live",
  };
  const records = [
    base,
    {
      ...base,
      capability: "remoteCancellation" as const,
      state: "unknown" as const,
    },
  ];
  assert(admitCell(p.id, "xai-responses", ["generation"], records, binding).ok);
  const cancelled = admitCell(
    p.id,
    "xai-responses",
    ["generation", "remoteCancellation"],
    records,
    binding,
  );
  assert(!cancelled.ok);
  assert.equal(cancelled.error.fieldPath, "remoteCancellation");
});
