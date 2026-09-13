import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Stream } from "effect";
import {
  resolveProfile,
  controlsHash,
  decodeProviderResult,
  type CapabilityEvidenceV1,
  type ProviderTransport,
  type ProviderRequestV1,
} from "@foreman/providers";
import {
  makeLiveAuthoringGenerate,
  authoringUsdLimit,
  readProviderEvidence,
  decodeProviderEvidence,
} from "./pel-provider-generation-live.js";
import { createDefaultAuthoringSnapshotV1 } from "./pel-host-descriptors.js";
import type { LiveProviderContext } from "./pel-provider-live.js";
const context: LiveProviderContext = {
  stateRoot: "/no-provider-state",
  worktreeRoot: "/tmp",
  userHome: "/no-provider-home",
  environment: {},
};
function fixture() {
  const snapshot = createDefaultAuthoringSnapshotV1();
  const selected = snapshot.providerProfiles.find(
    (p) =>
      p.profileId === "gpt-6-astra" && p.transportId === "openai-responses",
  )!;
  const controls = {
    ...selected.applicationDefaults,
    toolChoice: "none" as const,
  };
  const p = resolveProfile("gpt-6-astra");
  assert.ok(p.ok);
  const now = Date.now();
  const identity = {
    kind: "api" as const,
    provider: "openai",
    profileId: p.value.id,
    model: p.value.id,
    transportId: "openai-responses",
    credentialProfileRef: "account:test",
    endpointRevision: "v1",
    responseId: "r1",
  };
  const evidence: CapabilityEvidenceV1[] = (
    ["generation", "structuredOutput"] as const
  ).map((capability) => ({
    capability,
    state: "live-qualified",
    profileId: p.value.id,
    transportId: "openai-responses",
    profileHash: p.value.profileHash,
    sourceManifestHash: p.value.sourceManifestHash,
    transportVersion: "1",
    controlsHash: controlsHash(controls),
    observedAt: now - 100,
    expiresAt: now + 60000,
    observedIdentity: identity,
    evidenceRef: "qualification:real-receipt",
  }));
  const input = {
    prompt: "Add one and two",
    snapshot,
    modelProfileId: p.value.id,
    transportId: "openai-responses",
    controls,
    credentialProfileRef: "account:test",
    grammarMode: "envelope" as const,
  };
  return { input, evidence, identity, now };
}
function peer(f: ReturnType<typeof fixture>, sources = ["(+ 1 2)"]) {
  const calls: ProviderRequestV1[] = [];
  let cleanup = 0;
  const transport: ProviderTransport = {
    id: "openai-responses",
    version: "1",
    probe: () =>
      Effect.fail({
        _tag: "ProbeUnknown",
        retryClass: "never",
        message: "unexpected probe",
      }),
    start: (r) =>
      Effect.gen(function* () {
        calls.push(r);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            cleanup++;
          }),
        );
        const decoded = decodeProviderResult(
          JSON.stringify({ pelSource: sources[calls.length - 1] }),
          r.outputSchema,
        );
        if (!decoded.ok) return yield* Effect.fail(decoded.error);
        return Stream.make({
          schemaVersion: 1 as const,
          effectId: r.effectId,
          providerIdentity: { ...f.identity, responseId: "r" + calls.length },
          payload: {
            type: "completed" as const,
            result: decoded.value,
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              providerCounters: { costUnits: 0 },
            },
          },
        });
      }),
    cancel: () =>
      Effect.succeed({
        requested: true,
        acknowledged: false,
        localCleanup: "complete",
        remoteOutcome: "unknown",
      }),
    observe: () =>
      Effect.succeed({
        status: "unsupported",
        providerIdentity: f.identity,
        reason: "unused",
      }),
    resume: () =>
      Effect.fail({
        _tag: "ResumeUnavailable",
        retryClass: "never",
        message: "unused",
      }),
    sendToolResult: () =>
      Effect.fail({
        _tag: "UnsupportedCapability",
        retryClass: "never",
        message: "unused",
      }),
  };
  return {
    calls,
    transport,
    get cleanup() {
      return cleanup;
    },
  };
}
test("live authoring missing evidence fails through canonical M2 provider cause before transport setup", async () => {
  const f = fixture();
  let prepared = 0;
  const generate = makeLiveAuthoringGenerate(context, {
    makeTransport: () => {
      prepared++;
      return Effect.die("must not construct transport");
    },
  });
  const result = await Effect.runPromise(Effect.either(generate(f.input)));
  assert.equal(result._tag, "Left");
  if (result._tag === "Left")
    assert.equal(result.left.providerCause?._tag, "CapabilityUnverified");
  assert.equal(prepared, 0);
});
test("live authoring admits exact evidence, preserves account and lets M2 own repair attempts", async () => {
  const f = fixture();
  const p = peer(f, ["(", "(+ 1 2)"]);
  const seeds: ProviderRequestV1[] = [];
  const generate = makeLiveAuthoringGenerate(
    { ...context, environment: { FOREMAN_PROVIDER_MAX_COST_USD: "3" } },
    {
      readEvidence: () => Effect.succeed(f.evidence),
      makeTransport: (seed) => {
        seeds.push(seed);
        return Effect.succeed(p.transport);
      },
    },
  );
  const result = await Effect.runPromise(generate(f.input));
  assert.equal(result.pelSource, "(+ 1 2)");
  assert.equal(result.attemptCount, 2);
  assert.equal(p.calls.length, 2);
  assert.equal(p.cleanup, 2);
  assert.ok(
    seeds.every(
      (r) =>
        r.credentialProfileRef === "account:test" &&
        r.limits.maxCostUsd === 1 &&
        r.limits.spendReservationRef.length > 0,
    ),
  );
  assert.equal(seeds[1]!.generation?.attempt, 1);
  assert.equal(seeds[0]!.controls.toolChoice, "none");
});
test("fixture, expired, account, controls and endpoint-mismatch evidence never prepares a live transport", async () => {
  const f = fixture();
  for (const altered of [
    f.evidence.map((e) => ({
      ...e,
      state: "fixture-tested" as const,
      fixtureManifestHash: "0".repeat(64),
      endpointIdentity: "fake://endpoint",
    })),
    f.evidence.map((e) => ({ ...e, expiresAt: f.now - 1 })),
    f.evidence.map((e) => ({
      ...e,
      observedIdentity: { ...f.identity, credentialProfileRef: "other" },
    })),
    f.evidence.map((e) => ({ ...e, controlsHash: "0".repeat(64) })),
    f.evidence.map((e) => ({
      ...e,
      observedIdentity: { ...f.identity, endpointRevision: "wrong" },
    })),
  ]) {
    let prepared = 0;
    const generate = makeLiveAuthoringGenerate(context, {
      readEvidence: () => Effect.succeed(altered),
      makeTransport: () => {
        prepared++;
        return Effect.die("must not prepare");
      },
    });
    const result = await Effect.runPromise(Effect.either(generate(f.input)));
    assert.equal(result._tag, "Left");
    if (result._tag === "Left")
      assert.equal(result.left.providerCause?._tag, "CapabilityUnverified");
    assert.equal(prepared, 0);
  }
});
test("installed transport version mismatch fails final admission without model dispatch", async () => {
  const f = fixture();
  const p = peer(f);
  const generate = makeLiveAuthoringGenerate(context, {
    readEvidence: () => Effect.succeed(f.evidence),
    makeTransport: () => Effect.succeed({ ...p.transport, version: "changed" }),
  });
  const result = await Effect.runPromise(Effect.either(generate(f.input)));
  assert.equal(result._tag, "Left");
  assert.equal(p.calls.length, 0);
});
test("evidence reader bounds closed JSON and rejects symlink, unknown secret fields and relative override", async () => {
  const f = fixture();
  const root = await mkdtemp(join(tmpdir(), "fm-evidence-"));
  try {
    await mkdir(join(root, "providers"));
    const path = join(root, "providers", "evidence.json");
    await writeFile(
      path,
      JSON.stringify({ schemaVersion: 1, evidence: f.evidence }),
    );
    assert.equal(
      (
        await Effect.runPromise(
          readProviderEvidence({ ...context, stateRoot: root }),
        )
      ).length,
      2,
    );
    for (const value of [
      { schemaVersion: 1, evidence: f.evidence, secret: "DO-NOT-PRINT" },
      {
        schemaVersion: 1,
        evidence: [{ ...f.evidence[0], secret: "DO-NOT-PRINT" }],
      },
    ]) {
      const result = await Effect.runPromise(
        Effect.either(
          decodeProviderEvidence(Buffer.from(JSON.stringify(value))),
        ),
      );
      assert.equal(result._tag, "Left");
      assert.doesNotMatch(JSON.stringify(result), /DO-NOT-PRINT/);
    }
    const relative = await Effect.runPromise(
      Effect.either(
        readProviderEvidence({
          ...context,
          environment: { FOREMAN_PROVIDER_EVIDENCE: "relative.json" },
        }),
      ),
    );
    assert.equal(relative._tag, "Left");
    await symlink(path, join(root, "link.json"));
    assert.equal(
      (
        await Effect.runPromise(
          Effect.either(
            readProviderEvidence({
              ...context,
              environment: {
                FOREMAN_PROVIDER_EVIDENCE: join(root, "link.json"),
              },
            }),
          ),
        )
      )._tag,
      "Left",
    );
    assert.equal(
      (
        await Effect.runPromise(
          Effect.either(decodeProviderEvidence(Buffer.alloc(1024 * 1024 + 1))),
        )
      )._tag,
      "Left",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("USD ceiling is explicit and independent of abstract cost units", async () => {
  assert.equal(await Effect.runPromise(authoringUsdLimit(context)), 5);
  for (const value of ["0", "-1", "NaN", "Infinity", "6", "1e2", ""])
    assert.equal(
      (
        await Effect.runPromise(
          Effect.either(
            authoringUsdLimit({
              ...context,
              environment: { FOREMAN_PROVIDER_MAX_COST_USD: value },
            }),
          ),
        )
      )._tag,
      "Left",
    );
});
test("mixed live and fixture endpoint evidence cannot qualify structured output", async () => {
  const f = fixture();
  let prepared = 0;
  const mixed = f.evidence.map((e) =>
    e.capability === "structuredOutput"
      ? { ...e, endpointIdentity: "fake://output" }
      : e,
  );
  const generate = makeLiveAuthoringGenerate(context, {
    readEvidence: () => Effect.succeed(mixed),
    makeTransport: () => {
      prepared++;
      return Effect.succeed(peer(f).transport);
    },
  });
  const result = await Effect.runPromise(Effect.either(generate(f.input)));
  assert.equal(result._tag, "Left");
  assert.equal(prepared, 0);
});
