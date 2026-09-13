import { test } from "node:test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { probeReadiness, qualifyIdentity } from "./readiness.js";
import type { ProbeInputV1 } from "./contract.js";
const input: ProbeInputV1 = {
  profileId: "gpt-6-astra",
  transportId: "codex-app-server",
  credentialProfileRef: "account",
  mode: "metadata-only",
};
test("T-M3-013/T-M3-014 metadata facts remain independent; uncertainty never prompts login", async () => {
  let workloads = 0;
  const ports = {
    metadata: () =>
      Effect.succeed({
        discovery: { state: "available" as const, installedVersion: "old" },
        authentication: { state: "authenticated" as const },
        currency: { state: "stale" as const },
        identity: { state: "unknown" as const },
      }),
    workload: () =>
      Effect.sync(() => {
        workloads++;
        return [];
      }),
    now: () => 123,
  };
  const r = await Effect.runPromise(probeReadiness(input, ports));
  assert.equal(r.discovery.installedVersion, "old");
  assert.equal(r.authentication.state, "authenticated");
  assert.equal(r.currency.state, "stale");
  assert.equal(workloads, 0);
  const timeout = await Effect.runPromise(
    probeReadiness(input, {
      ...ports,
      metadata: () =>
        Effect.fail({
          _tag: "ProbeUnknown",
          retryClass: "never",
          message: "raw secret never emitted",
        } as const),
    }),
  );
  assert.equal(timeout.authentication.state, "unknown");
  assert.equal(timeout.authentication.remediation, undefined);
  assert(!JSON.stringify(timeout).includes("secret"));
  const signedOut = await Effect.runPromise(
    probeReadiness(input, {
      ...ports,
      metadata: () =>
        Effect.succeed({
          authentication: {
            state: "signed-out" as const,
            remediation: "secret",
          },
        }),
    }),
  );
  assert.equal(
    signedOut.authentication.remediation,
    "Authenticate the selected credential profile.",
  );
});
test("T-M3-015 only protocol identity can qualify an exact model", () => {
  assert.equal(qualifyIdentity(input, undefined).ok, false);
  const id = {
    kind: "native" as const,
    provider: "openai",
    profileId: "gpt-5.6-sol",
    transportId: "codex-app-server",
    credentialProfileRef: "account",
    protocolVersion: "1",
    sessionId: "s",
  };
  const mismatch = qualifyIdentity(input, id);
  assert(!mismatch.ok);
  assert.equal(mismatch.error._tag, "ModelMismatch");
  assert(qualifyIdentity(input, { ...id, profileId: "gpt-6-astra" }).ok);
});
test("T-M3-013 each readiness fact carries its independent time and safe evidence type", async () => {
  const r = await Effect.runPromise(
    probeReadiness(input, {
      metadata: () =>
        Effect.succeed({
          discovery: { state: "available", installedVersion: "1" },
        }),
      workload: () => Effect.succeed([]),
      now: () => 321,
    }),
  );
  for (const fact of [r.discovery, r.authentication, r.currency, r.identity]) {
    assert.equal(fact.observedAt, 321);
    assert.equal(fact.evidenceKind, "metadata");
    assert.equal(typeof fact.diagnostic, "string");
  }
});
