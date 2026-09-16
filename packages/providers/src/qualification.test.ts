import { test } from "node:test";
import assert from "node:assert/strict";
import { Deferred, Effect, Stream } from "effect";
import { canonicalize, sha256Hex } from "@foreman/core";
import { runQualification, qualificationBounds } from "./qualification.js";
import { PROVIDER_PROFILES } from "./profiles.js";
import { createGrokAcpTransport } from "./transports/grok-acp.js";
import type {
  ProviderRequestV1,
  ProviderTransport,
  ProviderIdentityV1,
  ProviderEventV1,
} from "./contract.js";
const p = PROVIDER_PROFILES.find((p) => p.id === "gpt-6-astra")!;
const identity: ProviderIdentityV1 = {
  kind: "api",
  provider: "openai",
  profileId: p.id,
  transportId: "openai-responses",
  credentialProfileRef: "fake",
  endpointRevision: "v1",
  responseId: "r",
};
const request: ProviderRequestV1 = {
  schemaVersion: 1,
  effectId: "qualify",
  profileId: p.id,
  transportId: "openai-responses",
  trustedInstructions: "Return a harmless boolean.",
  artifacts: [],
  toolPolicy: { mode: "none" },
  outputSchema: { id: "schema:pel-boolean-v1", content: { type: "boolean" } },
  controls: p.defaults,
  credentialProfileRef: "fake",
  profileHash: p.profileHash,
  sourceManifestHash: p.sourceManifestHash,
  transportVersion: "1",
  limits: {
    deadline: 999999,
    maxInputTokens: 50000,
    maxOutputTokens: 50000,
    maxToolCalls: 20,
    maxCostUsd: 20,
    maxOutputBytes: 1024,
    spendReservationRef: "reservation",
  },
};
test('qualification awaits the bounded host tool callback and never approves without one', async () => {
  for (const scenario of ['allowed', 'missing', 'none', 'exhausted', 'after-terminal'] as const) {
    const gate = await Effect.runPromise(Deferred.make<void>());
    let acknowledged = 0;
    const codingRequest: ProviderRequestV1 = {...request, toolPolicy: scenario === 'none' ? {mode:'none'} : {mode:'native-coding',workspaceGrantId:'disposable',permissionGrantIds:['grant'],hostPermissionPortRef:'host'}, limits:{...request.limits,deadline:1000,maxToolCalls:scenario==='exhausted'?0:1}};
    const tool: ProviderEventV1 = {schemaVersion:1,effectId:request.effectId,providerIdentity:identity,payload:{type:'tool-request',request:{callId:'one',name:'edit',arguments:{path:'src/value.txt'},authorizationBinding:'grant'}}};
    const complete: ProviderEventV1 = {schemaVersion:1,effectId:request.effectId,providerIdentity:identity,payload:{type:'completed',result:{value:{tag:'boolean',value:true},json:true,schemaId:request.outputSchema.id,schemaSha256:sha256Hex(canonicalize(request.outputSchema.content)),byteLength:4}}};
    const transport: ProviderTransport = {
      id:request.transportId,version:'1',
      probe:()=>Effect.fail({_tag:'ProbeUnknown',retryClass:'never',message:'unused'}),
      start:()=>Effect.succeed(scenario==='after-terminal'?Stream.make(complete,tool):Stream.concat(Stream.succeed(tool),Stream.fromEffect(Deferred.await(gate).pipe(Effect.as(complete))))),
      sendToolResult:()=>Effect.void,
      cancel:()=>Effect.succeed({requested:true,acknowledged:true,localCleanup:'complete',remoteOutcome:'cancelled'}),
      observe:()=>Effect.succeed({status:'unsupported',providerIdentity:identity,reason:'unused'}),
      resume:()=>Effect.fail({_tag:'ResumeUnavailable',retryClass:'never',message:'unused'}),
    };
    const report=await Effect.runPromise(runQualification({request:codingRequest,requiredCapabilities:['generation'],binding:{kind:'qualification-fixture',fixtureManifestHash:'manifest',endpointIdentity:'fake://tools',evidenceRef:'fixture:tools',expiresAt:1000000}},
      {transport,now:()=>100,...(scenario==='missing'?{}:{onToolRequest:()=>Effect.sync(()=>{acknowledged++;}).pipe(Effect.zipRight(Deferred.succeed(gate,undefined)),Effect.asVoid)})}));
    assert.equal(acknowledged,scenario==='allowed'?1:0);
    assert.equal(report.outcome,scenario==='allowed'?'success':'cancelled');
    if(scenario!=='allowed')assert.equal(report.failure?._tag,scenario==='exhausted'?'OutputIncomplete':scenario==='after-terminal'?'MalformedEvent':'UnsupportedCapability');
    assert.equal(report.evidence.length,scenario==='allowed'?1:0);
  }
});
test("T-M3-017 bounded injected qualification retains fixture provenance and never invents optional evidence", async () => {
  let calls = 0;
  let observed: ProviderRequestV1 | undefined;
  const transport: ProviderTransport = {
    id: "openai-responses",
    version: "1",
    probe: () =>
      Effect.fail({
        _tag: "ProbeUnknown",
        retryClass: "never",
        message: "unused",
      }),
    start: (r) =>
      Effect.sync(() => {
        calls++;
        observed = r;
        return Stream.make({
          schemaVersion: 1 as const,
          effectId: r.effectId,
          providerIdentity: identity,
          sourceEventId: "done",
          payload: {
            type: "completed" as const,
            result: {
              value: { tag: "boolean" as const, value: true },
              json: true,
              schemaId: r.outputSchema.id,
              schemaSha256: sha256Hex(canonicalize(r.outputSchema.content)),
              byteLength: 4,
            },
          },
        });
      }),
    sendToolResult: () => Effect.void,
    cancel: () =>
      Effect.succeed({
        requested: true,
        acknowledged: false,
        localCleanup: "not-required",
        remoteOutcome: "unsupported",
      }),
    observe: () =>
      Effect.succeed({
        status: "unsupported",
        providerIdentity: identity,
        reason: "unsupported",
      }),
    resume: () =>
      Effect.fail({
        _tag: "ResumeUnavailable",
        retryClass: "never",
        message: "unused",
      }),
  };
  const result = await Effect.runPromise(
    runQualification(
      {
        request,
        requiredCapabilities: ["generation"],
        binding: {
          kind: "qualification-fixture",
          fixtureManifestHash: "manifest",
          endpointIdentity: "fake://endpoint",
          evidenceRef: "fixture:report",
          expiresAt: 1000000,
        },
      },
      { transport, now: () => 100 },
    ),
  );
  assert.equal(calls, 1);
  assert.equal(result.outcome, "success");
  assert.equal(result.evidence[0]?.state, "fixture-tested");
  assert.equal(result.evidence[0]?.fixtureManifestHash, "manifest");
  assert.equal(result.evidence.length, 1);
  assert.equal(observed?.limits.maxToolCalls, 2);
  assert.equal(observed?.limits.maxCostUsd, 5);
  assert(
    (observed?.limits.maxInputTokens ?? 0) +
      (observed?.limits.maxOutputTokens ?? 0) <=
      30000,
  );
  assert.equal(observed?.limits.deadline, 180100);
  const unsupported = await Effect.runPromise(
    runQualification(
      {
        request,
        requiredCapabilities: ["permissionBoundary"],
        binding: {
          kind: "qualification-fixture",
          fixtureManifestHash: "manifest",
          endpointIdentity: "fake://endpoint",
          evidenceRef: "fixture:report",
          expiresAt: 1000000,
        },
      },
      { transport, now: () => 100 },
    ),
  );
  assert.equal(unsupported.outcome, "failed");
  assert.equal(unsupported.evidence.length, 0);
});
test("qualification bounds reject invalid values and smaller host limits win", () => {
  assert.equal(
    qualificationBounds({ ...request.limits, maxCostUsd: -1 }, 100).ok,
    false,
  );
  const r = qualificationBounds(
    {
      ...request.limits,
      maxInputTokens: 10,
      maxOutputTokens: 20,
      maxToolCalls: 0,
      maxCostUsd: 0.01,
      deadline: 200,
    },
    100,
  );
  assert(r.ok);
  assert.equal(r.value.maxCostUsd, 0.01);
  assert.equal(r.value.maxToolCalls, 0);
  assert.equal(r.value.deadline, 200);
});
test("qualification rejects a forged completed result and keeps uncertain remote cleanup needs-action", async () => {
  const bad: ProviderTransport = {
    id: "openai-responses",
    version: "1",
    probe: () =>
      Effect.fail({
        _tag: "ProbeUnknown",
        retryClass: "never",
        message: "unused",
      }),
    start: () =>
      Effect.succeed(
        Stream.make<[import("./contract.js").ProviderEventV1]>({
          schemaVersion: 1,
          effectId: request.effectId,
          providerIdentity: identity,
          payload: {
            type: "completed",
            result: {
              value: { tag: "string", value: "wrong" },
              json: "wrong",
              schemaId: request.outputSchema.id,
              schemaSha256: "wrong",
              byteLength: 5,
            },
          },
        }),
      ),
    sendToolResult: () => Effect.void,
    cancel: () =>
      Effect.succeed({
        requested: true,
        acknowledged: false,
        localCleanup: "not-required",
        remoteOutcome: "unsupported",
      }),
    observe: () =>
      Effect.succeed({
        status: "unsupported",
        providerIdentity: identity,
        reason: "unsupported",
      }),
    resume: () =>
      Effect.fail({
        _tag: "ResumeUnavailable",
        retryClass: "never",
        message: "unused",
      }),
  };
  const result = await Effect.runPromise(
    runQualification(
      {
        request,
        requiredCapabilities: ["generation"],
        binding: {
          kind: "qualification-fixture",
          fixtureManifestHash: "manifest",
          endpointIdentity: "fake://endpoint",
          evidenceRef: "fixture:report",
          expiresAt: 1000000,
        },
      },
      { transport: bad, now: () => 100 },
    ),
  );
  assert.equal(result.evidence.length, 0);
  assert.equal(result.failure?._tag, "OutputInvalid");
  assert.equal(result.outcome, "needs-action");
});
test("qualification bounds terminal usage and preserves full identity before scoped cleanup", async () => {
  for (const scenario of ["usage", "identity"] as const) {
    let closed = false;
    let cancelledWhileOpen = false;
    const resultEvent: import("./contract.js").ProviderEventV1 = {
      schemaVersion: 1,
      effectId: request.effectId,
      providerIdentity:
        scenario === "identity"
          ? { ...identity, responseId: "different-response" }
          : identity,
      payload: {
        type: "completed",
        result: {
          value: { tag: "boolean", value: true },
          json: { value: true },
          schemaId: request.outputSchema.id,
          schemaSha256: sha256Hex(canonicalize(request.outputSchema.content)),
          byteLength: 14,
        },
        usage: { providerCounters: {}, inputTokens: 1000000, costUsd: "100" },
      },
    };
    const transport: ProviderTransport = {
      id: "openai-responses",
      version: "1",
      probe: () =>
        Effect.fail({
          _tag: "ProbeUnknown",
          retryClass: "never",
          message: "unused",
        }),
      start: () =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              closed = true;
            }),
          );
          return Stream.make<import("./contract.js").ProviderEventV1[]>(
            {
              schemaVersion: 1,
              effectId: request.effectId,
              providerIdentity: identity,
              payload: { type: "started" },
            },
            resultEvent,
          );
        }),
      sendToolResult: () => Effect.void,
      cancel: () =>
        Effect.sync(() => {
          cancelledWhileOpen = !closed;
          return {
            requested: true,
            acknowledged: false,
            localCleanup: "pending",
            remoteOutcome: "unknown",
          } as const;
        }),
      observe: () =>
        Effect.succeed({
          status: "unsupported",
          providerIdentity: identity,
          reason: "unsupported",
        }),
      resume: () =>
        Effect.fail({
          _tag: "ResumeUnavailable",
          retryClass: "never",
          message: "unused",
        }),
    };
    const report = await Effect.runPromise(
      runQualification(
        {
          request,
          requiredCapabilities: ["generation"],
          binding: {
            kind: "qualification-fixture",
            fixtureManifestHash: "manifest",
            endpointIdentity: "fake://endpoint",
            evidenceRef: "fixture:report",
            expiresAt: 1000000,
          },
        },
        { transport, now: () => 100 },
      ),
    );
    assert.equal(report.evidence.length, 0);
    assert.equal(
      report.failure?._tag,
      scenario === "usage" ? "OutputIncomplete" : "ModelMismatch",
    );
    if (scenario === "usage") assert.equal(report.usage?.inputTokens, 1000000);
    assert(cancelledWhileOpen);
    assert(closed);
  }
});
test("internal protocol qualification fixture distinguishes installed CLI, ACP protocol, and transport implementation versions", async () => {
  const { createTransportCellFixture } =
    await import("./fixtures/transport-test-fixture.js");
  const fixture = await createTransportCellFixture("grok-4.6", "grok-acp");
  try {
    const report = await Effect.runPromise(
      runQualification(
        {
          request: fixture.request,
          requiredCapabilities: ["generation"],
          binding: {
            kind: "qualification-fixture",
            fixtureManifestHash: "manifest",
            endpointIdentity: "fake://grok",
            evidenceRef: "fixture:versions",
            expiresAt: Date.now() + 60000,
          },
        },
        { transport: fixture.transport, now: Date.now },
      ),
    );
    assert.equal(report.outcome, "success");
    assert.equal(report.protocolVersion, "1");
    assert.equal(report.installedVersion, "1.0.30");
    assert.equal(report.transportVersion, "1");
  } finally {
    await fixture.dispose();
  }
});
test("public Grok qualification fails unsupported hard budgets before credential or process acquisition", async () => {
  const grok = PROVIDER_PROFILES.find(profile => profile.id === "grok-4.6")!;
  let resolutions = 0;
  let launches = 0;
  const transport = createGrokAcpTransport({
    credentials: {
      resolve: () => Effect.sync(() => { resolutions++; return {}; }),
    },
    process: {
      open: () => Effect.suspend(() => {
        launches++;
        return Effect.die("Public Grok qualification must not acquire a process");
      }),
    },
    now: () => 100,
  });
  const report = await Effect.runPromise(runQualification({
    request: {
      ...request,
      profileId: grok.id,
      transportId: "grok-acp",
      controls: { ...grok.defaults, toolChoice: "none" },
      profileHash: grok.profileHash,
      sourceManifestHash: grok.sourceManifestHash,
    },
    requiredCapabilities: ["generation"],
    binding: {
      kind: "qualification-fixture",
      fixtureManifestHash: "manifest",
      endpointIdentity: "fake://grok-public-admission",
      evidenceRef: "fixture:grok-budget-denial",
      expiresAt: 1000000,
    },
  }, { transport, now: () => 100 }));
  assert.equal(report.outcome, "failed");
  assert.equal(report.failure?._tag, "UnsupportedCapability");
  assert.equal(report.failure?.fieldPath, "limits.hardBudgetEnforcement");
  assert.equal(report.evidence.length, 0);
  assert.equal(resolutions, 0);
  assert.equal(launches, 0);
});
