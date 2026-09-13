import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import {
  resolveProfile,
  controlsHash,
  type CapabilityEvidenceV1,
} from "@foreman/providers";
import { makeLiveProviderList } from "./pel-provider-list-live.js";
import type { LiveProviderContext } from "./pel-provider-live.js";
import { decodeProviderEvidence } from "./pel-provider-evidence.js";
const context = (
  stateRoot: string,
  environment: LiveProviderContext["environment"] = {},
): LiveProviderContext => ({
  stateRoot,
  worktreeRoot: "/tmp",
  userHome: "/no-credential-home",
  environment,
});
function evidence(): CapabilityEvidenceV1 {
  const p = resolveProfile("gpt-6-astra");
  assert.ok(p.ok);
  return {
    capability: "generation",
    state: "live-qualified",
    profileId: p.value.id,
    transportId: "openai-responses",
    profileHash: p.value.profileHash,
    sourceManifestHash: p.value.sourceManifestHash,
    transportVersion: "1",
    controlsHash: controlsHash({ ...p.value.defaults, toolChoice: "none" }),
    observedAt: Date.now() - 1000,
    expiresAt: Date.now() + 60000,
    observedIdentity: {
      kind: "api",
      provider: "openai",
      profileId: p.value.id,
      model: p.value.id,
      transportId: "openai-responses",
      credentialProfileRef: "env:OPENAI_API_KEY",
      endpointRevision: "v1",
      responseId: "r1",
    },
    evidenceRef: "qualification:existing",
  };
}
test("evidence rejects invalid UTF-8 prefixes and bytes inside otherwise valid strings", async () => {
  const json = Buffer.from(
    JSON.stringify({ schemaVersion: 1, evidence: [evidence()] }),
  );
  const inString = Buffer.from(json);
  inString[inString.indexOf("qualification:existing")] = 0xff;
  for (const bytes of [Buffer.concat([Buffer.from([0xff]), json]), inString]) {
    const result = await Effect.runPromise(
      Effect.either(decodeProviderEvidence(bytes)),
    );
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") {
      assert.equal(result.left._tag, "CapabilityUnverified");
      assert.equal(result.left.fieldPath, "evidence");
    }
  }
});
async function fixture(records: readonly CapabilityEvidenceV1[]) {
  const root = await mkdtemp(join(tmpdir(), "fm-list-live-"));
  await mkdir(join(root, "providers"));
  const path = join(root, "providers", "evidence.json");
  await writeFile(
    path,
    JSON.stringify({ schemaVersion: 1, evidence: records }),
  );
  return {
    root,
    path,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}
test("live list without default evidence returns all twelve documented cells", async () => {
  const root = await mkdtemp(join(tmpdir(), "fm-list-absent-"));
  try {
    const cells = await Effect.runPromise(
      makeLiveProviderList(context(root))(),
    );
    assert.equal(cells.length, 12);
    assert.equal(
      cells.some((c) => c.status === "live-qualified"),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("live list binds known API version/revision/account and current no-tool defaults", async () => {
  const f = await fixture([evidence()]);
  try {
    const cells = await Effect.runPromise(
      makeLiveProviderList(context(f.root))(),
    );
    assert.equal(
      cells.find(
        (c) =>
          c.profileId === "gpt-6-astra" && c.transportId === "openai-responses",
      )?.status,
      "live-qualified",
    );
  } finally {
    await f.dispose();
  }
});
test("live list keeps wrong versions, controls, account and source hashes stale", async () => {
  const base = evidence();
  assert.ok(base.observedIdentity);
  for (const record of [
    { ...base, transportVersion: "invented" },
    { ...base, controlsHash: "0".repeat(64) },
    { ...base, sourceManifestHash: "0".repeat(64) },
    {
      ...base,
      observedIdentity: {
        ...base.observedIdentity,
        credentialProfileRef: "different-account",
      },
    },
    {
      ...base,
      observedIdentity: {
        ...base.observedIdentity,
        endpointRevision: "future",
      },
    },
    { ...base, endpointIdentity: "fake://forged" },
  ]) {
    const f = await fixture([record]);
    try {
      const cells = await Effect.runPromise(
        makeLiveProviderList(context(f.root))(),
      );
      assert.equal(
        cells.find(
          (c) =>
            c.profileId === base.profileId &&
            c.transportId === base.transportId,
        )?.status,
        "stale",
      );
    } finally {
      await f.dispose();
    }
  }
});
test("native evidence stays stale until installed protocol metadata is independently verified", async () => {
  const p = resolveProfile("gemini-3.8-flash");
  assert.ok(p.ok);
  const base = evidence();
  const record: CapabilityEvidenceV1 = {
    ...base,
    profileId: p.value.id,
    transportId: "gemini-cli",
    profileHash: p.value.profileHash,
    sourceManifestHash: p.value.sourceManifestHash,
    controlsHash: controlsHash({ ...p.value.defaults, toolChoice: "none" }),
    observedIdentity: {
      kind: "native",
      provider: "google",
      profileId: p.value.id,
      model: p.value.id,
      transportId: "gemini-cli",
      credentialProfileRef: "native:gemini:default",
      protocolVersion: "0.59.0",
      sessionId: "s1",
    },
  };
  const f = await fixture([record]);
  try {
    assert.equal(
      (await Effect.runPromise(makeLiveProviderList(context(f.root))())).find(
        (c) => c.transportId === "gemini-cli",
      )?.status,
      "stale",
    );
  } finally {
    await f.dispose();
  }
});
test("selected invalid evidence is admission failure and read I/O failure is ProbeUnknown", async () => {
  const f = await fixture([]);
  try {
    await writeFile(
      f.path,
      '{"schemaVersion":1,"evidence":[],"secret":"DO-NOT-PRINT"}',
    );
    const malformed = await Effect.runPromise(
      Effect.either(
        makeLiveProviderList(
          context(f.root, { FOREMAN_PROVIDER_EVIDENCE: f.path }),
        )(),
      ),
    );
    assert.equal(malformed._tag, "Left");
    if (malformed._tag === "Left")
      assert.equal(malformed.left._tag, "CapabilityUnverified");
    assert.doesNotMatch(JSON.stringify(malformed), /DO-NOT-PRINT/);
    const missing = await Effect.runPromise(
      Effect.either(
        makeLiveProviderList(
          context(f.root, {
            FOREMAN_PROVIDER_EVIDENCE: join(f.root, "missing.json"),
          }),
        )(),
      ),
    );
    assert.equal(missing._tag, "Left");
    if (missing._tag === "Left")
      assert.equal(missing.left._tag, "ProbeUnknown");
  } finally {
    await f.dispose();
  }
});
