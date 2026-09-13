import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHostRegistry,
  createPelEnvironment,
  parsePel,
  startPel,
  validateDataSchema,
  type PelDataSchemaV1,
} from "@foreman/pel";
import type { ProviderFailure } from "./errors.js";
const tags = [
  "ModelUnavailable",
  "ModelMismatch",
  "UnsupportedCapability",
  "CapabilityUnverified",
  "PromptChannelUnsupported",
  "AuthenticationRequired",
  "ProbeUnknown",
  "OutputInvalid",
  "OutputIncomplete",
  "MalformedEvent",
  "ContinuationMismatch",
  "ResumeUnavailable",
  "OutcomeUnknown",
  "RateLimited",
  "TransportDisconnected",
] as const;
function classify(failure: ProviderFailure): "never" | "transient" {
  switch (failure._tag) {
    case "ModelUnavailable":
    case "ModelMismatch":
    case "UnsupportedCapability":
    case "CapabilityUnverified":
    case "PromptChannelUnsupported":
    case "AuthenticationRequired":
    case "ProbeUnknown":
    case "OutputInvalid":
    case "OutputIncomplete":
    case "MalformedEvent":
    case "ContinuationMismatch":
    case "ResumeUnavailable":
    case "OutcomeUnknown":
      return "never";
    case "RateLimited":
    case "TransportDisconnected":
      return "transient";
    default: {
      const unreachable: never = failure;
      return unreachable;
    }
  }
}
test("T-M3-025/R-M3-025 the shared 15-tag failure union retains safe context and exactly two transient tags", () => {
  const failures: ProviderFailure[] = tags.map((_tag) =>
    _tag === "RateLimited" || _tag === "TransportDisconnected"
      ? { _tag, message: "safe", retryClass: "transient", retryAfterMs: 20 }
      : { _tag, message: "safe", retryClass: "never" },
  );
  assert.equal(failures.length, 15);
  assert.deepEqual(
    failures.filter((f) => classify(f) === "transient").map((f) => f._tag),
    ["RateLimited", "TransportDisconnected"],
  );
  for (const failure of failures) {
    assert.equal(failure.retryClass, classify(failure));
    const contextual: ProviderFailure = {
      ...failure,
      requestId: "request",
      fieldPath: "controls.effort",
      usage: { providerCounters: {}, outputTokens: 1 },
      providerIdentity: {
        kind: "api",
        provider: "openai",
        profileId: "gpt-6-astra",
        transportId: "openai-responses",
        credentialProfileRef: "account:opaque",
        endpointRevision: "v1",
        responseId: "r",
      },
    };
    assert.equal(contextual.usage?.outputTokens, 1);
    assert.equal(
      contextual.providerIdentity?.credentialProfileRef,
      "account:opaque",
    );
  }
});
test("T-M3-025/R-M3-025 quoted retry data keys validate; syntax and nil-pair lists reject before a captured body executes", () => {
  const registry = createHostRegistry([
    {
      id: "fixture/retry",
      name: "fixture/retry",
      argSpec: {
        kind: "fixed",
        parameters: [
          { name: "on", required: true, evaluation: "strict" },
          { name: "body", required: true, evaluation: "strict" },
        ],
      },
      resultSchemaId: "schema:pel-data-v1",
      failureSchemaId: "schema:pel-host-failure-v1",
      effectKind: "control",
      capabilities: [],
      resources: { reads: [], writes: [], unknown: false },
      resourceResolverId: "static",
      resourceEnvelope: {},
    },
  ]);
  assert(registry.ok);
  const schema: PelDataSchemaV1 = {
    type: "list",
    items: { type: "key", enum: ["rate-limited", "transport-disconnected"] },
    minItems: 1,
    maxItems: 2,
  };
  for (const [selectors, valid] of [
    ["[':rate-limited ':transport-disconnected]", true],
    ["'[:rate-limited :transport-disconnected]", false],
    ["[:rate-limited :transport-disconnected]", false],
    ["[':output-invalid]", false],
  ] as const) {
    const parsed = parsePel(
      Buffer.from(
        `(fixture/retry :on ${selectors} :body (lambda [] (print "must not run")))`,
      ),
    );
    assert(parsed.ok);
    const step = startPel(parsed.value, createPelEnvironment(registry.value));
    assert.equal(step.tag, "suspend");
    if (step.tag !== "suspend") continue;
    assert.equal(step.ready.length, 1);
    assert.equal(step.ready[0]!.registryId, "fixture/retry");
    assert.equal(step.ready[0]!.boundArguments.body?.tag, "closure");
    assert.equal(
      validateDataSchema(step.ready[0]!.boundArguments.on, schema),
      valid,
    );
    assert(!step.ready.some((request) => request.registryId === "print"));
  }
});
