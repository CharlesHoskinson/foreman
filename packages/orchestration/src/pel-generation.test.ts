import assert from "node:assert/strict";
import test from "node:test";
import { Deferred, Effect, Fiber, TestClock, TestContext } from "effect";
import { ProviderGenerationPort } from "../../providers/src/contract.js";
import type {
  GenerationRequest,
  GenerationResponse,
} from "../../providers/src/contract.js";
import type { ProviderFailure } from "../../providers/src/errors.js";
import {
  createAuthoringSnapshotV1,
  createHostRegistry,
  type AuthoringSnapshotV1,
} from "@foreman/pel";
import { makeForemanCli } from "./pel-authoring-cli.js";
import {
  decodeProviderControls,
  defaultProviderControls,
} from "../../providers/src/controls.js";
import {
  makeGenerationBudget,
  generationEffectId,
  generationId,
  decodeGenerationEnvelope,
  makeGenerationRequest,
  generatePelPlan,
  GenerationBudgetPort,
} from "./pel-generation.js";

async function generationFixture(selectedSnapshot?: AuthoringSnapshotV1) {
  const { createDefaultAuthoringSnapshotV1 } =
    await import("./pel-host-descriptors.js");
  const snapshot = selectedSnapshot ?? createDefaultAuthoringSnapshotV1();
  const profile = snapshot.providerProfiles.find(
    (item) =>
      item.profileId === "gpt-6-astra" &&
      item.transportId === "openai-responses",
  )!;
  const request = makeGenerationRequest({
    prompt: "Add one and two",
    snapshot,
    modelProfileId: profile.profileId,
    transportId: profile.transportId,
    controls: { ...profile.applicationDefaults, toolChoice: "none" },
    credentialProfileRef: "account:test",
    sessionNonce: "fixture",
  });
  const calls: GenerationRequest[] = [];
  const response = (
    pelSource: string,
    call: GenerationRequest,
  ): GenerationResponse => ({
    pelSource,
    providerIdentity: {
      kind: "api",
      provider: "openai",
      profileId: call.modelProfileId,
      transportId: call.transportId,
      credentialProfileRef: call.credentialProfileRef,
      endpointRevision: "fixture-v1",
      responseId: `response-${call.attempt}`,
    },
    providerRequestId: `request-${call.attempt}`,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      providerCounters: { costUnits: 1 },
    },
  });
  const run = (
    generate: (
      call: GenerationRequest,
    ) => Effect.Effect<GenerationResponse, ProviderFailure>,
    override = request,
    budget = makeGenerationBudget(snapshot.generationLimits),
  ) =>
    generatePelPlan(override, snapshot).pipe(
      Effect.provideService(ProviderGenerationPort, {
        generate: (call) => {
          calls.push(call);
          return generate(call);
        },
      }),
      Effect.provideService(GenerationBudgetPort, budget),
    );
  return { snapshot, request, calls, response, run };
}

test("generation accepts first locally checked source and reserves exact lowering identity", async () => {
  const fixture = await generationFixture();
  const result = await Effect.runPromise(
    fixture.run((call) => Effect.succeed(fixture.response("(+ 1 2)", call))),
  );
  assert.equal(result.pelSource, "(+ 1 2)");
  assert.equal(result.attemptCount, 1);
  assert.equal(fixture.calls[0]!.resolvedGrammarMode, "envelope");
  assert.equal(
    fixture.calls[0]!.generationBudgetReservationRef,
    `${fixture.request.generationId}/attempt/0/budget`,
  );
  assert.equal(fixture.calls[0]!.limits.timeoutMs, 60_000);
  assert.equal(Object.isFrozen(fixture.request.outputSchema.content), true);
});

test("local repair retains immutable request selection and all usage", async () => {
  const fixture = await generationFixture();
  const result = await Effect.runPromise(
    fixture.run((call) =>
      Effect.succeed(
        fixture.response(call.attempt === 0 ? "(+" : "(+ 1 2)", call),
      ),
    ),
  );
  assert.equal(result.attemptCount, 2);
  const repair = fixture.calls[1]!;
  assert.equal(repair.effectId, `${fixture.request.generationId}/attempt/1`);
  assert.deepEqual(repair.controls, fixture.request.controls);
  assert.equal(
    repair.credentialProfileRef,
    fixture.request.credentialProfileRef,
  );
  assert.equal(repair.repair!.previousSource, "(+");
  assert.equal(repair.repair!.snapshotDigest, fixture.snapshot.snapshotDigest);
  assert.equal(repair.trustedTemplateId, "foreman:pel-generation-v1");
  assert.equal(repair.credentialProfileRef, "account:test");
  assert.deepEqual(repair.artifacts, fixture.request.artifacts);
  assert.deepEqual(repair.outputSchema, fixture.request.outputSchema);
  assert.ok(repair.limits.deadline > 0);
  assert.ok(repair.limits.maxInputTokens > 0);
  assert.ok(repair.limits.maxOutputTokens > 0);
  assert.deepEqual(repair.capabilitySnapshot, fixture.snapshot.policy);
  assert.equal(Object.isFrozen(repair.capabilitySnapshot), true);
  assert.ok(repair.repair!.diagnostics.length > 0);
  assert.equal(result.cumulativeUsage.inputTokens, 2);
});

test("three locally invalid responses exhaust generation with bounded source samples", async () => {
  const fixture = await generationFixture();
  const exit = await Effect.runPromise(
    Effect.either(
      fixture.run((call) => Effect.succeed(fixture.response("(+", call))),
    ),
  );
  assert.equal(exit._tag, "Left");
  if (exit._tag === "Left") {
    assert.equal(exit.left.code, "PEL_GENERATION_EXHAUSTED");
    assert.equal(exit.left.attemptDiagnostics.length, 3);
    assert.equal(exit.left.cumulativeUsage.inputTokens, 3);
  }
  assert.equal(fixture.calls.length, 3);
});

test("T-M2-009 parse, capability and unbounded-call failures retain all three diagnostic sets", async () => {
  const base = await generationFixture();
  const registry = createHostRegistry(
    [
      ...structuredClone(base.snapshot.registry.descriptors).filter(
        (descriptor) => !["print", "pel/nl-condition"].includes(descriptor.id),
      ),
      {
        id: "fixture/data",
        name: "fixture/data",
        argSpec: { kind: "fixed", parameters: [] },
        resultSchemaId: "schema:pel-data-v1",
        failureSchemaId: "schema:pel-host-failure-v1",
        effectKind: "read",
        capabilities: [],
        resources: { reads: [], writes: [], unknown: false },
        resourceResolverId: "static",
        resourceEnvelope: {},
      },
    ],
    Object.fromEntries(
      Object.entries(base.snapshot.registry.dataSchemas).filter(
        ([key]) =>
          !["schema:pel-data-v1", "schema:pel-boolean-v1"].includes(key),
      ),
    ),
    Object.fromEntries(
      Object.entries(base.snapshot.registry.failureSchemas).filter(
        ([key]) => key !== "schema:pel-host-failure-v1",
      ),
    ),
    base.snapshot.registry.resolverCatalog,
  );
  assert.equal(registry.ok, true, JSON.stringify(registry));
  if (!registry.ok) return;
  const created = createAuthoringSnapshotV1({
    ...base.snapshot,
    registry: registry.value,
    policy: {
      ...base.snapshot.policy,
      allowedEffectKinds: [...base.snapshot.policy.allowedEffectKinds, "read"],
      allowedCapabilities: base.snapshot.policy.allowedCapabilities.filter(
        (capability) => capability !== "publication.write",
      ),
    },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const fixture = await generationFixture(created.value);
  const sources = [
    "(+",
    '(fm/publish :id "p" :input "artifact:approved-spec" :destination "destination:local")',
    "((fixture/data) 1)",
  ];
  const result = await Effect.runPromise(
    Effect.either(
      fixture.run((call) =>
        Effect.succeed(fixture.response(sources[call.attempt]!, call)),
      ),
    ),
  );
  assert.equal(result._tag, "Left");
  if (result._tag === "Left") {
    assert.equal(result.left.code, "PEL_GENERATION_EXHAUSTED");
    assert.deepEqual(
      result.left.attemptDiagnostics.map((row) => row.attempt),
      [0, 1, 2],
    );
    for (const [index, code] of [
      "PEL_PARSE",
      "PEL_CAPABILITY_DENIED",
      "PEL_DYNAMIC_EFFECT_UNBOUNDED",
    ].entries())
      assert.ok(
        result.left.attemptDiagnostics[index]!.diagnostics.some(
          (diagnostic) => diagnostic.code === code,
        ),
      );
    assert.equal(result.left.cumulativeUsage.inputTokens, 3);
  }
  assert.equal(fixture.calls.length, 3);
});

test("T-M2-010 CLI maps fatal failure, cancellation and local selection to exits 1, 4 and 2", async () => {
  for (const scenario of ["fatal", "cancel", "selection"] as const) {
    const fixture = await generationFixture();
    const out: string[] = [],
      err: string[] = [];
    const cli = makeForemanCli({
      context: { defaultSnapshotPath: "snapshot" },
      input: {
        read: () =>
          Effect.succeed(Buffer.from(JSON.stringify(fixture.snapshot))),
      },
      output: {
        stdout: (text) =>
          Effect.sync(() => {
            out.push(text);
          }),
        stderr: (text) =>
          Effect.sync(() => {
            err.push(text);
          }),
      },
      generate: (input) =>
        fixture.run(
          () =>
            scenario === "cancel"
              ? Effect.interrupt
              : Effect.fail({
                  _tag: "ModelUnavailable",
                  retryClass: "never",
                  message: "Fixture unavailable",
                  usage: { inputTokens: 5, providerCounters: {} },
                }),
          makeGenerationRequest(input),
        ),
    });
    const result = await Effect.runPromise(
      cli.run([
        "plan",
        "--prompt",
        "One",
        "--model",
        scenario === "selection" ? "missing-profile" : "gpt-6-astra",
        "--transport",
        "openai-responses",
        "--json",
      ]),
    );
    assert.equal(
      result.exitCode,
      scenario === "fatal" ? 1 : scenario === "cancel" ? 4 : 2,
    );
    assert.equal(out.length, 1);
    assert.equal(err.length, 0);
    assert.equal(fixture.calls.length, scenario === "selection" ? 0 : 1);
    if (scenario === "fatal")
      assert.equal(JSON.parse(out[0]!).cumulativeUsage.inputTokens, 5);
  }
});

test("every provider failure is fatal even transient and invalid-output categories", async () => {
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
  for (const tag of tags) {
    const fixture = await generationFixture();
    const failure = {
      _tag: tag,
      retryClass:
        tag === "RateLimited" || tag === "TransportDisconnected"
          ? "transient"
          : "never",
      message: tag,
      usage: { inputTokens: 1, providerCounters: {} },
    } as ProviderFailure;
    const exit = await Effect.runPromise(
      Effect.either(fixture.run(() => Effect.fail(failure))),
    );
    assert.equal(exit._tag, "Left");
    if (exit._tag === "Left") assert.equal(exit.left.providerCause?._tag, tag);
    assert.equal(fixture.calls.length, 1);
  }
});

test("mandatory unqualified grammar and incompatible controls cause zero calls", async () => {
  for (const override of ["grammar", "tools", "identity"] as const) {
    const fixture = await generationFixture();
    const request =
      override === "grammar"
        ? { ...fixture.request, grammarMode: "grammar-required" as const }
        : override === "tools"
          ? {
              ...fixture.request,
              controls: {
                ...fixture.request.controls,
                toolChoice: "auto" as const,
              },
            }
          : { ...fixture.request, modelProfileId: "substitute-model" };
    const exit = await Effect.runPromise(
      Effect.either(
        fixture.run(
          (call) => Effect.succeed(fixture.response("1", call)),
          request,
        ),
      ),
    );
    assert.equal(exit._tag, "Left");
    assert.equal(fixture.calls.length, 0);
  }
});

test("identity mismatch and refusal observations stop without syntax repair", async () => {
  for (const kind of ["identity", "refusal"] as const) {
    const fixture = await generationFixture();
    const exit = await Effect.runPromise(
      Effect.either(
        fixture.run((call) => {
          const response = fixture.response("(+", call);
          return Effect.succeed(
            kind === "identity"
              ? {
                  ...response,
                  providerIdentity: {
                    ...response.providerIdentity,
                    profileId: "substitution",
                  },
                }
              : { ...response, refusal: { message: "Cannot fulfill" } },
          );
        }),
      ),
    );
    assert.equal(exit._tag, "Left");
    if (exit._tag === "Left")
      assert.equal(
        exit.left.code,
        kind === "identity"
          ? "PEL_GENERATION_PROVIDER_FAILED"
          : "PEL_GENERATION_REFUSED",
      );
    assert.equal(fixture.calls.length, 1);
  }
});

test("mutating the caller request after dispatch cannot change admitted identity", async () => {
  const fixture = await generationFixture();
  const request = structuredClone(fixture.request) as {
    -readonly [Key in keyof GenerationRequest]: GenerationRequest[Key];
  };
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      const fiber = yield* Effect.fork(
        Effect.either(
          fixture.run(
            (call) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
                return {
                  ...fixture.response("1", call),
                  providerIdentity: {
                    ...fixture.response("1", call).providerIdentity,
                    profileId: "gpt-5.6-sol",
                  },
                };
              }),
            request,
          ),
        ),
      );
      yield* Deferred.await(started);
      request.modelProfileId = "gpt-5.6-sol";
      yield* Deferred.succeed(release, undefined);
      return yield* Fiber.join(fiber);
    }),
  );
  assert.equal(result._tag, "Left");
  if (result._tag === "Left")
    assert.equal(result.left.providerCause?._tag, "ModelMismatch");
});

test("the operation deadline includes synchronous snapshot validation", async () => {
  const base = await generationFixture();
  const created = createAuthoringSnapshotV1({
    ...base.snapshot,
    generationLimits: { ...base.snapshot.generationLimits, maxElapsedMs: 1 },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const fixture = await generationFixture(created.value);
  const result = await Effect.runPromise(
    Effect.either(
      fixture.run((call) => Effect.succeed(fixture.response("1", call))),
    ),
  );
  assert.equal(result._tag, "Left");
  if (result._tag === "Left")
    assert.equal(result.left.code, "PEL_GENERATION_TIMEOUT");
});

test("invalid external reservation references and identities never reach the provider", async () => {
  for (const field of [
    "reference",
    "operationId",
    "attempt",
    "maxInputTokens",
    "deadline",
  ] as const) {
    const fixture = await generationFixture();
    const result = await Effect.runPromise(
      Effect.either(
        fixture.run(
          (call) => Effect.succeed(fixture.response("1", call)),
          fixture.request,
          {
            reserve: (input) =>
              Effect.succeed({
                ...input,
                reference: "budget",
                ...(field === "reference"
                  ? { reference: "" }
                  : field === "operationId"
                    ? { operationId: "different-operation" }
                    : field === "attempt"
                      ? { attempt: 2 as const }
                      : field === "maxInputTokens"
                        ? { maxInputTokens: input.maxInputTokens + 1 }
                        : { deadline: input.deadline + 1 }),
              }),
            settle: () => Effect.void,
          },
        ),
      ),
    );
    assert.equal(result._tag, "Left");
    assert.equal(fixture.calls.length, 0);
  }
});

test("60-second attempt timeout closes provider scope without a repair", async () => {
  const fixture = await generationFixture();
  let closed = false;
  const program = Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const fiber = yield* Effect.fork(
      Effect.either(
        fixture.run(() =>
          Effect.zipRight(
            Deferred.succeed(started, undefined),
            Effect.never,
          ).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                closed = true;
              }),
            ),
          ),
        ),
      ),
    );
    yield* Deferred.await(started);
    yield* TestClock.adjust("60 seconds");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestContext.TestContext));
  const exit = await Effect.runPromise(program);
  assert.equal(exit._tag, "Left");
  if (exit._tag === "Left")
    assert.equal(exit.left.code, "PEL_GENERATION_TIMEOUT");
  assert.equal(fixture.calls.length, 1);
  assert.equal(closed, true);
});

test("180-second whole-operation deadline includes budget service waiting", async () => {
  const fixture = await generationFixture();
  const program = Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const fiber = yield* Effect.fork(
      Effect.either(
        fixture.run(
          (call) => Effect.succeed(fixture.response("1", call)),
          fixture.request,
          {
            reserve: () =>
              Effect.zipRight(
                Deferred.succeed(started, undefined),
                Effect.never,
              ),
            settle: () => Effect.void,
          },
        ),
      ),
    );
    yield* Deferred.await(started);
    yield* TestClock.adjust("180 seconds");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestContext.TestContext));
  const result = await Effect.runPromise(program);
  assert.equal(result._tag, "Left");
  if (result._tag === "Left")
    assert.deepEqual(result.left.cause, {
      _tag: "DeadlineExceeded",
      scope: "operation",
    });
  assert.equal(fixture.calls.length, 0);
});

test("auto grammar uses only exact endpoint qualification and envelope remains explicit", async () => {
  const fixture = await generationFixture();
  const created = createAuthoringSnapshotV1({
    ...fixture.snapshot,
    providerProfiles: fixture.snapshot.providerProfiles.map((profile) => ({
      ...profile,
      evidenceKind: "qualified" as const,
      grammarSupport: "qualified" as const,
    })),
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  for (const grammarMode of ["auto", "grammar-required", "envelope"] as const) {
    let observed: GenerationRequest | undefined;
    const request = makeGenerationRequest({
      prompt: "One",
      snapshot: created.value,
      modelProfileId: fixture.request.modelProfileId,
      transportId: fixture.request.transportId,
      controls: fixture.request.controls,
      credentialProfileRef: fixture.request.credentialProfileRef,
      grammarMode,
    });
    await Effect.runPromise(
      generatePelPlan(request, created.value).pipe(
        Effect.provideService(ProviderGenerationPort, {
          generate: (call) => {
            observed = call;
            return Effect.succeed(fixture.response("1", call));
          },
        }),
        Effect.provideService(
          GenerationBudgetPort,
          makeGenerationBudget(created.value.generationLimits),
        ),
      ),
    );
    assert.equal(
      observed!.resolvedGrammarMode,
      grammarMode === "envelope" ? "envelope" : "grammar",
    );
  }
});

test("external cancellation releases provider resources and settles reservation", async () => {
  const fixture = await generationFixture();
  let settled = 0,
    closed = false;
  const program = Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const fiber = yield* Effect.fork(
      fixture.run(
        () =>
          Effect.zipRight(
            Deferred.succeed(started, undefined),
            Effect.never,
          ).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                closed = true;
              }),
            ),
          ),
        fixture.request,
        {
          reserve: (input) =>
            Effect.succeed({ ...input, reference: "reservation" }),
          settle: () =>
            Effect.sync(() => {
              settled++;
            }),
        },
      ),
    );
    yield* Deferred.await(started);
    return yield* Fiber.interrupt(fiber);
  });
  await Effect.runPromise(program);
  assert.equal(fixture.calls.length, 1);
  assert.equal(closed, true);
  assert.equal(settled, 1);
});

test("provider cancellation is a typed terminal generation cause", async () => {
  const fixture = await generationFixture();
  const result = await Effect.runPromise(
    Effect.either(fixture.run(() => Effect.interrupt)),
  );
  assert.equal(result._tag, "Left");
  if (result._tag === "Left")
    assert.equal(result.left.code, "PEL_GENERATION_CANCELLED");
  assert.equal(fixture.calls.length, 1);
});

test("aggregate unknown usage cannot start a repair above the operation allowance", async () => {
  const fixture = await generationFixture();
  const request = {
    ...fixture.request,
    limits: {
      ...fixture.request.limits,
      maxInputTokens: fixture.snapshot.generationLimits.maxInputTokens,
    },
  };
  const result = await Effect.runPromise(
    Effect.either(
      fixture.run(
        (call) =>
          Effect.succeed({
            ...fixture.response("(+", call),
            usage: { providerCounters: {} },
          }),
        request,
      ),
    ),
  );
  assert.equal(result._tag, "Left");
  if (result._tag === "Left") {
    assert.equal(result.left.code, "PEL_GENERATION_BUDGET_EXHAUSTED");
    assert.equal(result.left.cumulativeUsage.inputTokens, undefined);
  }
  assert.equal(fixture.calls.length, 1);
});

test("unknown later accounting preserves earlier observed token and cost usage", async () => {
  const fixture = await generationFixture();
  const result = await Effect.runPromise(
    fixture.run((call) =>
      Effect.succeed({
        ...fixture.response(call.attempt === 0 ? "(+" : "1", call),
        usage:
          call.attempt === 0
            ? {
                inputTokens: 7,
                outputTokens: 3,
                costUsd: "0.125",
                providerCounters: { cached: 2 },
              }
            : { providerCounters: {} },
      }),
    ),
  );
  assert.equal(result.cumulativeUsage.inputTokens, undefined);
  assert.equal(
    result.cumulativeUsage.providerCounters["attempt/0/usage/inputTokens"],
    7,
  );
  assert.equal(
    result.cumulativeUsage.providerCounters["attempt/0/usage/outputTokens"],
    3,
  );
  assert.equal(
    result.cumulativeUsage.providerCounters["attempt/0/usage/costUsd"],
    "0.125",
  );
});

test("a reservation that consumes the request deadline never starts a provider call", async () => {
  const fixture = await generationFixture();
  let settled = 0;
  const program = Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const fiber = yield* Effect.fork(
      Effect.either(
        fixture.run(
          (call) => Effect.succeed(fixture.response("1", call)),
          {
            ...fixture.request,
            limits: { ...fixture.request.limits, deadline: 10_000 },
          },
          {
            reserve: (input) =>
              Effect.zipRight(
                Deferred.succeed(started, undefined),
                Effect.as(Effect.sleep("20 seconds"), {
                  ...input,
                  reference: "slow-reservation",
                }),
              ),
            settle: () =>
              Effect.sync(() => {
                settled++;
              }),
          },
        ),
      ),
    );
    yield* Deferred.await(started);
    yield* TestClock.adjust("20 seconds");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestContext.TestContext));
  const result = await Effect.runPromise(program);
  assert.equal(result._tag, "Left");
  if (result._tag === "Left")
    assert.equal(result.left.code, "PEL_GENERATION_TIMEOUT");
  assert.equal(fixture.calls.length, 0);
  assert.equal(settled, 0);
});

test("budget settlement cannot hold the operation beyond its deadline", async () => {
  const fixture = await generationFixture();
  let released = false;
  const program = Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const fiber = yield* Effect.fork(
      Effect.either(
        fixture.run(
          (call) => Effect.succeed(fixture.response("1", call)),
          fixture.request,
          {
            reserve: (input) =>
              Effect.succeed({ ...input, reference: "slow-settle" }),
            settle: () =>
              Effect.zipRight(
                Deferred.succeed(started, undefined),
                Effect.sleep("240 seconds"),
              ).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    released = true;
                  }),
                ),
              ),
          },
        ),
      ),
    );
    yield* Deferred.await(started);
    yield* TestClock.adjust("180 seconds");
    const atDeadline = yield* Fiber.poll(fiber);
    yield* TestClock.adjust("60 seconds");
    yield* Fiber.join(fiber);
    return atDeadline;
  }).pipe(Effect.provide(TestContext.TestContext));
  const result = await Effect.runPromise(program);
  assert.equal(result._tag, "Some");
  assert.equal(released, true);
});

test("invalid finite limits, artifacts and templates fail before reserving or generating", async () => {
  for (const kind of [
    "infinite",
    "negative",
    "template",
    "artifact",
  ] as const) {
    const fixture = await generationFixture();
    let reservations = 0;
    const request =
      kind === "infinite"
        ? {
            ...fixture.request,
            limits: { ...fixture.request.limits, maxCostUnits: Infinity },
          }
        : kind === "negative"
          ? {
              ...fixture.request,
              limits: { ...fixture.request.limits, timeoutMs: -1 },
            }
          : kind === "template"
            ? { ...fixture.request, trustedTemplateId: "untrusted" }
            : {
                ...fixture.request,
                artifacts: [
                  {
                    id: "artifact:forged",
                    sourceDigest: "bad",
                    content: "untrusted",
                  },
                ],
              };
    const result = await Effect.runPromise(
      Effect.either(
        fixture.run(
          (call) => Effect.succeed(fixture.response("1", call)),
          request,
          {
            reserve: (input) => {
              reservations++;
              return Effect.succeed({ ...input, reference: "bad" });
            },
            settle: () => Effect.void,
          },
        ),
      ),
    );
    assert.equal(result._tag, "Left");
    assert.equal(fixture.calls.length, 0);
    assert.equal(reservations, 0);
  }
});

test("usage overrun still settles the external reservation and stops the loop", async () => {
  const fixture = await generationFixture();
  let settled = 0;
  const result = await Effect.runPromise(
    Effect.either(
      fixture.run(
        (call) =>
          Effect.succeed({
            ...fixture.response("1", call),
            usage: {
              inputTokens: call.limits.maxInputTokens + 1,
              providerCounters: {},
            },
          }),
        fixture.request,
        {
          reserve: (input) =>
            Effect.succeed({ ...input, reference: "overrun" }),
          settle: () =>
            Effect.sync(() => {
              settled++;
            }),
        },
      ),
    ),
  );
  assert.equal(result._tag, "Left");
  if (result._tag === "Left")
    assert.equal(result.left.code, "PEL_GENERATION_BUDGET_EXHAUSTED");
  assert.equal(settled, 1);
  assert.equal(fixture.calls.length, 1);
});

test("generation IDs bind exact identity, snapshot and session, and preserve attempt", () => {
  const input = {
    promptDigest: "p",
    snapshotDigest: "s",
    modelProfileId: "model",
    transportId: "api",
    sessionNonce: "one",
  };
  assert.equal(generationId(input), generationId(input));
  assert.notEqual(
    generationId(input),
    generationId({ ...input, sessionNonce: "two" }),
  );
  assert.equal(
    generationEffectId(generationId(input), 1),
    `${generationId(input)}/attempt/1`,
  );
});

test("complete source envelopes reject extra fields, absent source and oversized UTF-8", () => {
  assert.deepEqual(decodeGenerationEnvelope({ pelSource: "(+ 1 2)" }), {
    ok: true,
    pelSource: "(+ 1 2)",
  });
  for (const value of [
    { pelSource: "1", execute: true },
    {},
    { pelSource: 1 },
    { pelSource: "é".repeat(524_289) },
  ]) {
    assert.equal(decodeGenerationEnvelope(value).ok, false);
  }
});

test("repair source prefixes preserve UTF-8 boundaries inside a narrowed byte limit", async () => {
  const fixture = await generationFixture();
  const request = {
    ...fixture.request,
    limits: { ...fixture.request.limits, maxSourceBytes: 2 },
  };
  await Effect.runPromise(
    fixture.run(
      (call) =>
        Effect.succeed(fixture.response(call.attempt === 0 ? "😀" : "1", call)),
      request,
    ),
  );
  assert.ok(Buffer.byteLength(fixture.calls[1]!.repair!.previousSource) <= 2);
  assert.equal(fixture.calls[1]!.repair!.previousSource, "");
});

test("controls decoder rejects unknown nested keys and preserves explicit controls", () => {
  const controls = defaultProviderControls("gpt-5.6-sol", "openai");
  assert.equal(controls.effort, "medium");
  assert.deepEqual(decodeProviderControls(controls), {
    ok: true,
    value: controls,
  });
  const bad = decodeProviderControls({
    ...controls,
    thinking: { mode: "enabled", surprise: true },
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error.fieldPath, "thinking.surprise");
  assert.equal(
    decodeProviderControls({ ...controls, effort: ["medium"] }).ok,
    false,
  );
});

test("generation budget retains unknown usage and does not reset between repairs", async () => {
  const budget = makeGenerationBudget({
    maxInputTokens: 20,
    maxOutputTokens: 10,
    maxCostUnits: 6,
  });
  const first = await Effect.runPromise(
    budget.reserve({
      operationId: "op",
      attempt: 0,
      maxInputTokens: 10,
      maxOutputTokens: 5,
      conservativeSpendUnits: 3,
      deadline: 100,
    }),
  );
  await Effect.runPromise(budget.settle(first, { providerCounters: {} }));
  await Effect.runPromise(
    budget.reserve({
      operationId: "op",
      attempt: 1,
      maxInputTokens: 10,
      maxOutputTokens: 5,
      conservativeSpendUnits: 3,
      deadline: 100,
    }),
  );
  const denied = await Effect.runPromise(
    Effect.either(
      budget.reserve({
        operationId: "op",
        attempt: 2,
        maxInputTokens: 1,
        maxOutputTokens: 1,
        conservativeSpendUnits: 1,
        deadline: 100,
      }),
    ),
  );
  assert.equal(denied._tag, "Left");
});
