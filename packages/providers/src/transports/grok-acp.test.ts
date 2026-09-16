import { canonicalize, sha256Hex } from "@foreman/core";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Effect, Queue, Redacted, Stream } from "effect";
import { createGrokAcpTransport } from "./grok-acp.js";
// Protocol fixtures exercise internal mechanics. Only the public factory admits work.
import { createGrokAcpProtocol } from "./grok-acp-protocol.js";
import { validateNativeHost, type NativeHostPort } from "./native-host.js";
import type { NativeProcessPort, NativeLaunchV1 } from "./native-process.js";
import type {
  ProviderRequestV1,
  CredentialPort,
  ProviderEventV1,
} from "../contract.js";
import { PROVIDER_PROFILES } from "../profiles.js";
const profile = PROVIDER_PROFILES.find((p) => p.id === "grok-4.6")!;
const request: ProviderRequestV1 = {
  schemaVersion: 1,
  effectId: "grok-test",
  profileId: "grok-4.6",
  transportId: "grok-acp",
  trustedInstructions: "Return the requested structured boolean.",
  artifacts: [
    {
      id: "prompt",
      contentRef: "artifact:prompt",
      sha256: "a".repeat(64),
      content: 'quotes " $HOME\n🧪' + "x".repeat(128 * 1024),
    },
  ],
  toolPolicy: { mode: "none" },
  outputSchema: { id: "schema:pel-boolean-v1", content: { type: "boolean" } },
  controls: { ...profile.defaults, toolChoice: "none" },
  limits: {
    deadline: 100000,
    maxInputTokens: 10000,
    maxOutputTokens: 1000,
    maxToolCalls: 2,
    maxCostUsd: 1,
    maxOutputBytes: 1048576,
    spendReservationRef: "r",
  },
  credentialProfileRef: "fake:grok",
  profileHash: profile.profileHash,
  sourceManifestHash: profile.sourceManifestHash,
  transportVersion: "1",
};
const host: NativeHostPort = {
  cwd: "/tmp/disposable-grok-fixture",
  environment: { PATH: "/usr/bin" },
  toolPolicyNoneEnforced: true,
  workspaceBoundaryEnforced: false,
  permissionBoundaryEnforced: false,
};
for (const maxCostUsd of [0, 1]) {
  test(`Grok ACP rejects unsupported hard budgets before credential or process acquisition (maxCostUsd=${maxCostUsd})`, async () => {
    const f = fixture();
    const result = await Effect.runPromise(
      Effect.either(
        Effect.scoped(
          createGrokAcpTransport({
            credentials: f.credentials,
            process: f.process,
            host,
            installedVersion: "1.0.30",
            now: () => 100,
          }).start({ ...request, limits: { ...request.limits, maxCostUsd } }),
        ),
      ),
    );
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") {
      assert.equal(result.left._tag, "UnsupportedCapability");
      assert.equal(result.left.fieldPath, "limits.hardBudgetEnforcement");
      assert.match(result.left.message, /maxInputTokens.*maxOutputTokens.*maxCostUsd/);
    }
    assert.equal(f.resolutions, 0);
    assert.equal(f.launches.length, 0);
    assert.equal(f.sent.length, 0);
  });
}
function fixture(
  model: string | undefined = "grok-4.6",
  stopReason = "end_turn",
  permission = false,
  earlyUpdates: readonly Readonly<Record<string, unknown>>[] = [],
  progressDuringPermissionSend = false,
  permissionCall: Readonly<Record<string, unknown>> = { kind: "read", rawInput: { path: "safe.txt" } },
  finalReply?: { readonly text: string; readonly meta?: unknown },
) {
  const sent: Readonly<Record<string, unknown>>[] = [];
  const launches: NativeLaunchV1[] = [];
  let releases = 0;
  let resolutions = 0;
  let promptId: unknown;
  const credentials: typeof CredentialPort.Service = {
    resolve: () =>
      Effect.acquireRelease(
        Effect.sync(() => {
          resolutions++;
          return {
            environment: { XAI_API_KEY: Redacted.make("fixture-secret") },
          };
        }),
        () =>
          Effect.sync(() => {
            releases++;
          }),
      ),
  };
  const process: NativeProcessPort = {
    open: (launch) =>
      Effect.gen(function* () {
        launches.push(launch);
        const q = yield* Queue.unbounded<Readonly<Record<string, unknown>>>();
        yield* Effect.addFinalizer(() => Queue.shutdown(q));
        const done = (id: unknown) =>
          Effect.gen(function* () {
            yield* Queue.offer(q, {
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: "session-1",
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: finalReply?.text ?? '{"value":true}' },
                },
              },
            });
            yield* Queue.offer(q, {
              jsonrpc: "2.0",
              id,
              result: {
                stopReason,
                ...(finalReply
                  ? finalReply.meta === undefined ? {} : { _meta: finalReply.meta }
                  : { _meta: { sessionId: "session-1", modelId: "grok-4.6", structuredOutput: { value: true } } }),
              },
            });
          });
        return {
          events: Stream.fromQueue(q),
          close: () => Effect.void,
          send: (message) =>
            Effect.gen(function* () {
              sent.push(message);
              if (message.method === "initialize")
                yield* Queue.offer(q, {
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {
                    protocolVersion: 1,
                    agentInfo: { name: "grok", version: "1.0.30" },
                    authMethods: [{ id: "xai.api_key" }],
                  },
                });
              else if (message.method === "authenticate")
                yield* Queue.offer(q, {
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {},
                });
              else if (message.method === "session/new") {
                for (const params of earlyUpdates)
                  yield* Queue.offer(q, { jsonrpc: "2.0", method: "session/update", params });
                yield* Queue.offer(q, {
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {
                    sessionId: "session-1",
                    ...(model
                      ? {
                          configOptions: [
                            {
                              id: "model",
                              category: "model",
                              type: "select",
                              currentValue: model,
                            },
                          ],
                        }
                      : {}),
                  },
                });
              }
              else if (message.method === "session/prompt") {
                promptId = message.id;
                if (permission)
                  yield* Queue.offer(q, {
                    jsonrpc: "2.0",
                    id: 99,
                    method: "session/request_permission",
                    params: {
                      sessionId: "session-1",
                      toolCall: {
                        toolCallId: "call-1",
                        title: "Read file",
                        ...permissionCall,
                      },
                      options: [
                        { optionId: "yes", kind: "allow_once" },
                        { optionId: "always", kind: "allow_always" },
                        { optionId: "no", kind: "reject_once" },
                      ],
                    },
                  });
                else if (stopReason !== "wait") yield* done(message.id);
              } else if (message.id === 99) {
                if (progressDuringPermissionSend) {
                  yield* Queue.offer(q, {
                    jsonrpc: "2.0", method: "session/update",
                    params: { sessionId: "session-1", update: {
                      sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "in_progress",
                    } },
                  });
                  // Model a peer response arriving before the write callback resolves.
                  yield* Effect.sleep("10 millis");
                }
                yield* done(promptId);
              }
              else if (message.method === "session/cancel")
                yield* Queue.offer(q, {
                  jsonrpc: "2.0",
                  id: promptId,
                  result: { stopReason: "cancelled" },
                });
            }),
        };
      }),
  };
  return {
    process,
    credentials,
    sent,
    launches,
    get releases() {
      return releases;
    },
    get resolutions() {
      return resolutions;
    },
  };
}
test("Grok ACP rejects JSON-shaped progress without structured terminal metadata", async () => {
  for (const meta of [undefined, null, {}, [], "invalid", { sessionId: "session-1", modelId: "grok-4.6" }]) {
    const f = fixture("grok-4.6", "end_turn", false, [], false, undefined, {
      text: '{"value":true}',
      meta,
    });
    const events: ProviderEventV1[] = [];
    const result = await Effect.runPromise(Effect.either(Effect.scoped(Effect.flatMap(
      createGrokAcpProtocol({ credentials: f.credentials, process: f.process, host, now: () => 100 }).start(request),
      stream => Stream.runForEach(stream, event => Effect.sync(() => { events.push(event); })),
    ))));
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") {
      assert.equal(result.left._tag, "MalformedEvent");
      assert.equal(result.left.fieldPath, "prompt.structuredOutput");
    }
    assert.equal(events.some(event => event.payload.type === "completed"), false);
  }
});

test("Grok ACP validates the bound structured result independently of progress text", async () => {
  const f = fixture("grok-4.6", "end_turn", false, [], false, undefined, {
    text: "I will edit the file. Done.",
    meta: { sessionId: "session-1", modelId: "grok-4.6", structuredOutput: { value: true } },
  });
  const events = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    createGrokAcpProtocol({ credentials: f.credentials, process: f.process, host, now: () => 100 }).start(request), Stream.runCollect,
  )));
  const final = Array.from(events).at(-1)?.payload;
  assert.equal(final?.type, "completed");
  if (final?.type === "completed") assert.equal(canonicalize(final.result.json), '{"value":true}');
});

test("Grok ACP never falls back from invalid or unbound structured metadata to valid text", async () => {
  for (const meta of [
    { sessionId: "other", modelId: "grok-4.6", structuredOutput: { value: true } },
    { sessionId: "session-1", modelId: "other", structuredOutput: { value: true } },
    { structuredOutput: { value: true } },
    { sessionId: "session-1", modelId: "grok-4.6", structuredOutput: { value: "wrong-type" } },
    { sessionId: "session-1", modelId: "grok-4.6", structuredOutput: undefined },
    { sessionId: "session-1", modelId: "grok-4.6", structuredOutput: { value: Number.NaN } },
    { sessionId: "session-1", modelId: "grok-4.6", structuredOutput: { value: Number.POSITIVE_INFINITY } },
    { sessionId: "session-1", modelId: "grok-4.6", structuredOutputError: "private-provider-error" },
    { sessionId: "session-1", modelId: "grok-4.6", structuredOutput: { value: true }, structuredOutputError: "private-provider-error" },
  ]) {
    const f = fixture("grok-4.6", "end_turn", false, [], false, undefined, { text: '{"value":true}', meta });
    const result = await Effect.runPromise(Effect.either(Effect.scoped(Effect.flatMap(
      createGrokAcpProtocol({ credentials: f.credentials, process: f.process, host, now: () => 100 }).start(request), Stream.runCollect,
    ))));
    assert.equal(result._tag, "Left");
    assert.equal(JSON.stringify(result).includes("private-provider-error"), false);
  }
});

test("Grok ACP counts UTF-8 progress and structured terminal output against one byte ceiling", async () => {
  const text = "🧪";
  const structuredOutput = { value: true };
  const totalBytes = Buffer.byteLength(text) + Buffer.byteLength(canonicalize(structuredOutput));
  for (const maxOutputBytes of [totalBytes - 1, totalBytes]) {
    const f = fixture("grok-4.6", "end_turn", false, [], false, undefined, {
      text,
      meta: { sessionId: "session-1", modelId: "grok-4.6", structuredOutput },
    });
    const result = await Effect.runPromise(Effect.either(Effect.scoped(Effect.flatMap(
      createGrokAcpProtocol({ credentials: f.credentials, process: f.process, host, now: () => 100 })
        .start({ ...request, limits: { ...request.limits, maxOutputBytes } }),
      Stream.runCollect,
    ))));
    assert.equal(result._tag, maxOutputBytes === totalBytes ? "Right" : "Left");
    if (result._tag === "Left") {
      assert.equal(result.left._tag, "OutputIncomplete");
      assert.equal(result.left.fieldPath, "limits.maxOutputBytes");
    } else {
      assert.equal(Array.from(result.right).at(-1)?.payload.type, "completed");
    }
  }
});

test("Grok ACP binds command metadata received before the session/new response", async () => {
  const f = fixture("grok-4.6", "end_turn", false, [
    { sessionId: "session-1", update: { sessionUpdate: "available_commands_update", availableCommands: [] } },
    { sessionId: "session-1", update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "help", description: "Help" }] } },
  ]);
  const events = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    createGrokAcpProtocol({ credentials: f.credentials, process: f.process, host, now: () => 100 }).start(request),
    Stream.runCollect,
  )));
  assert.equal(Array.from(events).at(-1)?.payload.type, "completed");
  assert.equal(f.sent.filter(m => m.method === "session/prompt").length, 1);
});

test("Grok ACP rejects unbound, active, malformed, or excessive early updates before prompting", async () => {
  const metadata = { sessionId: "session-1", update: { sessionUpdate: "available_commands_update", availableCommands: [] } };
  for (const early of [
    [{ ...metadata, sessionId: "other-session" }],
    [{ sessionId: "session-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "unbound" } } }],
    [{ sessionId: "session-1", update: { sessionUpdate: "tool_call", toolCallId: "early", status: "in_progress" } }],
    [{ sessionId: "session-1", update: { sessionUpdate: "available_commands_update" } }],
    Array.from({ length: 65 }, () => metadata),
    [{ ...metadata, update: { ...metadata.update, availableCommands: [{ name: "x".repeat(65536) }] } }],
  ]) {
    const f = fixture("grok-4.6", "end_turn", false, early);
    const result = await Effect.runPromise(Effect.either(Effect.scoped(
      createGrokAcpProtocol({ credentials: f.credentials, process: f.process, host, now: () => 100 }).start(request),
    )));
    assert.equal(result._tag, "Left");
    assert.equal(f.sent.some(m => m.method === "session/prompt"), false);
  }
});

test("T-M3-004/T-M3-005 Grok ACP observes exact model and preserves protocol prompt bytes under scoped credentials", async () => {
  const f = fixture();
  const transport = createGrokAcpProtocol({
    credentials: f.credentials,
    process: f.process,
    host,
    now: () => 100,
  });
  const events = await Effect.runPromise(
    Effect.scoped(Effect.flatMap(transport.start(request), Stream.runCollect)),
  );
  assert.equal(Array.from(events).at(0)?.providerIdentity.kind, "native");
  assert.equal(Array.from(events).at(-1)?.payload.type, "completed");
  assert.equal(f.resolutions, 1);
  assert.equal(f.releases, 1);
  assert(f.launches[0]?.cmd.includes("agent"));
  assert(f.launches[0]?.cmd.includes("--no-auto-update"));
  assert(!f.launches[0]?.cmd.includes("--always-approve"));
  const prompt = f.sent.find((m) => m.method === "session/prompt");
  assert.equal(
    (f.sent.find((m) => m.method === "session/new")?.params as { _meta?: { systemPromptOverride?: string } })._meta?.systemPromptOverride,
    request.trustedInstructions,
  );
  assert.deepEqual(prompt?.params, {
    sessionId: "session-1",
    _meta: { outputSchema: JSON.parse(f.launches[0]!.cmd[f.launches[0]!.cmd.indexOf("--json-schema") + 1]!) },
    prompt: [
      {
        type: "text",
        text: canonicalize({
          artifacts: request.artifacts,
          outputSchema: request.outputSchema,
        }),
      },
    ],
  });
  assert(!JSON.stringify(f.sent).includes("fixture-secret"));
  assert.equal(f.launches[0]?.environment.XAI_API_KEY, "fixture-secret");
});
test("T-M3-006/T-M3-015 unknown identity, mismatched model and unenforced tool policies never prompt", async () => {
  for (const model of [undefined, "other-model"]) {
    const f = fixture(model === undefined ? "" : model);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.scoped(
          createGrokAcpProtocol({
            credentials: f.credentials,
            process: f.process,
            host,
            now: () => 100,
          }).start(request),
        ),
      ),
    );
    assert.equal(result._tag, "Left");
    assert(!f.sent.some((m) => m.method === "session/prompt"));
  }
  const f = fixture();
  const result = await Effect.runPromise(
    Effect.either(
      Effect.scoped(
        createGrokAcpProtocol({
          credentials: f.credentials,
          process: f.process,
          host: { ...host, toolPolicyNoneEnforced: false },
          now: () => 100,
        }).start(request),
      ),
    ),
  );
  assert.equal(result._tag, "Left");
  assert.equal(f.resolutions, 0);
  assert.equal(f.launches.length, 0);
  const coding = {
    ...request,
    toolPolicy: {
      mode: "native-coding",
      workspaceGrantId: "",
      permissionGrantIds: [],
      hostPermissionPortRef: "",
    },
  } as const;
  assert.equal(
    validateNativeHost(coding, {
      ...host,
      workspaceBoundaryEnforced: true,
      permissionBoundaryEnforced: true,
      workspaceGrantId: "",
      permissionGrantIds: [],
      hostPermissionPortRef: "",
    }).ok,
    false,
  );
});
test("Grok ACP denies native permission requests for toolPolicy none and preserves refusal/truncation", async () => {
  const f = fixture("grok-4.6", "end_turn", true);
  await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(
        createGrokAcpProtocol({
          credentials: f.credentials,
          process: f.process,
          host,
          now: () => 100,
        }).start(request),
        Stream.runCollect,
      ),
    ),
  );
  const permission = f.sent.find((m) => m.id === 99);
  assert.deepEqual(permission?.result, {
    outcome: { outcome: "selected", optionId: "no" },
  });
  for (const [stop, type] of [
    ["refusal", "refused"],
    ["max_tokens", "failed"],
  ] as const) {
    const f = fixture("grok-4.6", stop);
    const events = await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(
          createGrokAcpProtocol({
            credentials: f.credentials,
            process: f.process,
            host,
            now: () => 100,
          }).start(request),
          Stream.runCollect,
        ),
      ),
    );
    assert.equal(Array.from(events).at(-1)?.payload.type, type);
  }
});
test("Grok ACP reports host permission rejection without silently becoming cancellation", async () => {
  const f = fixture("grok-4.6", "end_turn", true);
  const codingHost: NativeHostPort = { ...host, workspaceGrantId: "workspace", permissionGrantIds: ["grant"],
    hostPermissionPortRef: "permissions", workspaceBoundaryEnforced: true, permissionBoundaryEnforced: true,
    permissions: { authorize: () => Effect.fail({ _tag: "UnsupportedCapability", retryClass: "never", message: "private-host-detail" }), submit: (_identity, _result, send) => send() },
  };
  const result = await Effect.runPromise(Effect.either(Effect.scoped(Effect.flatMap(
    createGrokAcpProtocol({ credentials: f.credentials, process: f.process, host: codingHost, now: () => 100 }).start({
      ...request, controls: profile.defaults, toolPolicy: { mode: "native-coding", workspaceGrantId: "workspace", permissionGrantIds: ["grant"], hostPermissionPortRef: "permissions" },
    }), Stream.runCollect,
  ))));
  assert.equal(result._tag, "Left");
  if (result._tag === "Left") {
    assert.match(result.left.message, /reason=authorization, kind=read/);
    assert.match(result.left.message, /variant=unknown/);
    assert.equal(JSON.stringify(result.left).includes("private-host-detail"), false);
  }
  assert.deepEqual(f.sent.find(m => m.id === 99)?.result, { outcome: { outcome: "selected", optionId: "no" } });
});

test("Grok ACP diagnoses premature progress without recording tool contents", async () => {
  const f = fixture("grok-4.6", "end_turn", true);
  const process: NativeProcessPort = { open: launch => f.process.open(launch).pipe(Effect.map(connection => ({
    ...connection,
    events: connection.events.pipe(Stream.flatMap(message => message.method === "session/request_permission"
      ? Stream.make(message, { jsonrpc: "2.0", method: "session/update", params: {
          sessionId: "session-1", update: { sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "in_progress", rawInput: "private-argument" },
        } })
      : Stream.make(message))),
  }))) };
  const codingHost: NativeHostPort = { ...host, workspaceGrantId: "workspace", permissionGrantIds: ["grant"],
    hostPermissionPortRef: "permissions", workspaceBoundaryEnforced: true, permissionBoundaryEnforced: true,
    permissions: { authorize: () => Effect.succeed("receipt:grant"), submit: (_identity, _result, send) => send() },
  };
  const result = await Effect.runPromise(Effect.either(Effect.scoped(Effect.flatMap(
    createGrokAcpProtocol({ credentials: f.credentials, process, host: codingHost, now: () => 100 }).start({
      ...request, controls: profile.defaults, toolPolicy: { mode: "native-coding", workspaceGrantId: "workspace", permissionGrantIds: ["grant"], hostPermissionPortRef: "permissions" },
    }), Stream.runCollect,
  ))));
  assert.equal(result._tag, "Left");
  if (result._tag === "Left") {
    assert.equal(result.left.fieldPath, "toolPolicy.permissionBoundary");
    assert.match(result.left.message, /permission=pending/);
    assert.match(result.left.message, /status=in_progress/);
    assert.equal(JSON.stringify(result.left).includes("private-argument"), false);
  }
});

for (const permissionCall of [
  { kind: "read", rawInput: { path: "safe.txt" } },
  { kind: "other", rawInput: { variant: "ListDir", target_directory: "src" } },
])
for (const progressDuringSend of [false, true])
test(`Grok ACP coding permission uses one durable authorization, progress during send=${progressDuringSend}, display kind=${permissionCall.kind}`, async () => {
  const f = fixture("grok-4.6", "end_turn", true, [], progressDuringSend, permissionCall);
  let authorizations = 0;
  let observedTool: import("../contract.js").ToolRequestV1 | undefined;
  const permissions: import("../contract.js").HostPermissionPort = {
    authorize: (_identity, tool) =>
      Effect.sync(() => {
        observedTool = tool;
        authorizations++;
        return "receipt:grant";
      }),
    submit: (_identity, _result, send) => send(),
  };
  const codingHost: NativeHostPort = {
    ...host,
    workspaceGrantId: "workspace",
    permissionGrantIds: ["grant"],
    hostPermissionPortRef: "host:permissions",
    permissions,
    workspaceBoundaryEnforced: true,
    permissionBoundaryEnforced: true,
  };
  const coding: ProviderRequestV1 = {
    ...request,
    controls: profile.defaults,
    toolPolicy: {
      mode: "native-coding",
      workspaceGrantId: "workspace",
      permissionGrantIds: ["grant"],
      hostPermissionPortRef: "host:permissions",
    },
  };
  const transport=createGrokAcpProtocol({credentials:f.credentials,process:f.process,host:codingHost,now:()=>100});
  const events = await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
    const stream=yield* transport.start(coding);
    return yield* Stream.runCollect(stream.pipe(Stream.tap(event=>Effect.gen(function*(){
      if(event.payload.type!=='tool-request')return;
      assert.equal(f.sent.filter(message=>message.id===99).length,0,'allow_once must wait for the durable result');
      const result={effectId:coding.effectId,providerIdentity:event.providerIdentity,callId:event.payload.request.callId,authorizationBinding:event.payload.request.authorizationBinding,receiptRef:'durable:fixture',content:{kind:'json' as const,value:{decision:'accept'}},contentSha256:sha256Hex(canonicalize({decision:'accept'})),isError:false,maxBytes:1024};
      yield* transport.sendToolResult(event.providerIdentity,result);
      yield* transport.sendToolResult(event.providerIdentity,result);
    }))));
  })));
  assert.equal(f.sent.filter(message=>message.id===99).length,1,'repeated durable acknowledgement sends once');
  assert.equal(authorizations, 1);
  assert.equal(observedTool?.name, "read");
  assert.deepEqual(observedTool?.arguments, permissionCall.rawInput);
  assert.equal(f.launches[0]?.cmd[f.launches[0]!.cmd.indexOf("--permission-mode") + 1], "default");
  assert.equal(
    Array.from(events).filter((e) => e.payload.type === "tool-request").length,
    1,
  );
  assert.deepEqual(f.sent.find((m) => m.id === 99)?.result, {
    outcome: { outcome: "selected", optionId: "yes" },
  });
  assert.equal(
    validateNativeHost(
      {
        ...coding,
        toolPolicy: {
          ...coding.toolPolicy,
          mode: "native-coding",
          workspaceGrantId: "workspace",
          permissionGrantIds: ["different"],
          hostPermissionPortRef: "host:permissions",
        },
      },
      codingHost,
    ).ok,
    false,
  );
});
test("Grok ACP completed observation is bound to active session; resume never creates another request", async () => {
  const f = fixture();
  const transport = createGrokAcpProtocol({
    credentials: f.credentials,
    process: f.process,
    host,
    now: () => 100,
  });
  let id: import("../contract.js").ProviderIdentityV1 | undefined;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const stream = yield* transport.start(request);
        const events = yield* Stream.runCollect(stream);
        id = Array.from(events)[0]!.providerIdentity;
        const observation = yield* transport.observe(id);
        assert.equal(observation.status, "completed");
        const resume = yield* Effect.either(
          transport.resume(request, id, "cursor"),
        );
        assert.equal(resume._tag, "Left");
      }),
    ),
  );
  assert.equal(f.sent.filter((m) => m.method === "session/prompt").length, 1);
  assert.equal(
    (await Effect.runPromise(transport.observe(id!))).status,
    "unsupported",
  );
});
test("Grok ACP cancellation acknowledgement waits for provider terminal stopReason", async () => {
  const f = fixture("grok-4.6", "wait");
  const transport = createGrokAcpProtocol({
    credentials: f.credentials,
    process: f.process,
    host,
    now: () => 100,
  });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const stream = yield* transport.start(request);
        let requested = false;
        const events = yield* Stream.runCollect(
          stream.pipe(
            Stream.tap((event) =>
              Effect.gen(function* () {
                if (event.payload.type === "started") {
                  const result = yield* transport.cancel(
                    event.providerIdentity,
                  );
                  assert.equal(result.remoteOutcome, "pending");
                  assert.equal(result.acknowledged, false);
                  assert.equal(result.localCleanup, "pending");
                  requested = true;
                }
              }),
            ),
          ),
        );
        assert(requested);
        const cancelled = Array.from(events).find(
          (e) => e.payload.type === "cancelled",
        );
        assert(cancelled);
        assert.equal(
          (yield* transport.observe(cancelled.providerIdentity)).status,
          "cancelled",
        );
      }),
    ),
  );
});
test("Grok ACP rejects supplied continuation before credentials or process dispatch", async () => {
  const f = fixture();
  const continuation: import("../contract.js").ContinuationV1 = {
    schemaVersion: 1,
    providerIdentity: {
      kind: "native",
      provider: "xai",
      model: "grok-4.6",
      profileId: "grok-4.6",
      transportId: "grok-acp",
      credentialProfileRef: request.credentialProfileRef,
      protocolVersion: "1",
      sessionId: "old",
    },
    transportVersion: "1",
    formatVersion: "1",
    bytes: new Uint8Array(),
    sha256: "0".repeat(64),
    prefixHash: "0".repeat(64),
    retention: { createdAt: 1, policy: "fixture" },
  };
  const result = await Effect.runPromise(
    Effect.either(
      Effect.scoped(
        createGrokAcpProtocol({
          credentials: f.credentials,
          process: f.process,
          host,
          now: () => 100,
        }).start({ ...request, continuation }),
      ),
    ),
  );
  assert.equal(result._tag, "Left");
  assert.equal(f.resolutions, 0);
  assert.equal(f.launches.length, 0);
});
test("Grok ACP cancellation racing host authorization responds once and grants no permission", async () => {
  const { Deferred, Fiber } = await import("effect");
  const f = fixture("grok-4.6", "end_turn", true);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const identified =
          yield* Deferred.make<import("../contract.js").ProviderIdentityV1>();
        const permissions: import("../contract.js").HostPermissionPort = {
          authorize: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
              return "receipt:grant";
            }),
          submit: (_id, _result, send) => send(),
        };
        const codingHost: NativeHostPort = {
          ...host,
          workspaceGrantId: "workspace",
          permissionGrantIds: ["grant"],
          hostPermissionPortRef: "host:permissions",
          permissions,
          workspaceBoundaryEnforced: true,
          permissionBoundaryEnforced: true,
        };
        const coding: ProviderRequestV1 = {
          ...request,
          controls: profile.defaults,
          toolPolicy: {
            mode: "native-coding",
            workspaceGrantId: "workspace",
            permissionGrantIds: ["grant"],
            hostPermissionPortRef: "host:permissions",
          },
        };
        const transport = createGrokAcpProtocol({
          credentials: f.credentials,
          process: f.process,
          host: codingHost,
          now: () => 100,
        });
        const stream = yield* transport.start(coding);
        const fiber = yield* Effect.forkScoped(
          Stream.runCollect(
            stream.pipe(
              Stream.tap((event) =>
                event.payload.type === "started"
                  ? Deferred.succeed(identified, event.providerIdentity)
                  : Effect.void,
              ),
            ),
          ),
        );
        yield* Deferred.await(entered);
        const id = yield* Deferred.await(identified);
        yield* transport.cancel(id);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(fiber);
      }),
    ),
  );
  assert.equal(f.sent.filter((m) => m.id === 99).length, 1);
  assert.deepEqual(f.sent.find((m) => m.id === 99)?.result, {
    outcome: { outcome: "cancelled" },
  });
});
test('Grok ACP sends host login only through the private launch field and selects cached_token', async () => {
  const f = fixture();
  const base = f.process;
  const process: NativeProcessPort = { open: launch => Effect.map(base.open(launch), connection => ({
    ...connection, events: connection.events.pipe(Stream.map(frame => frame.id === 1 ? {
      ...frame, result: { protocolVersion: 1, authMethods: [{ id: 'cached_token' }] },
    } : frame)),
  })) };
  const snapshot = Redacted.make('{"fixture":"private-access-token"}');
  await Effect.runPromise(Effect.scoped(Effect.flatMap(createGrokAcpProtocol({
    credentials: { resolve: () => Effect.succeed({ grokLogin: { snapshot: ({ deadline }) => {
      assert.equal(deadline, request.limits.deadline); return Effect.succeed(snapshot);
    } } }) }, process, host: { ...host, environment: { ...host.environment, HOME: '/worker-home' } }, now: () => 100,
  }).start(request), Stream.runCollect)));
  assert.equal(f.launches[0]?.grokAuthJson, snapshot);
  assert.equal(f.launches[0]?.environment.GROK_HOME, '/worker-home/.grok');
  assert.ok(!JSON.stringify({ commands: f.launches.map(x => x.cmd), environment: f.launches.map(x => x.environment), sent: f.sent }).includes('private-access-token'));
  assert.equal((f.sent.find(m => m.method === 'authenticate')?.params as { methodId: string }).methodId, 'cached_token');
});
for (const directory of ["/isolated/account/.grok", "/isolated/homes/grok"]) {
  test(`Grok ACP cached authentication binds the exact admitted directory ${directory} to GROK_HOME`, async () => {
    const f = fixture();
    const base = f.process;
    const process: NativeProcessPort = {
      open: (launch) =>
        Effect.map(base.open(launch), (connection) => ({
          ...connection,
          events: connection.events.pipe(
            Stream.map((frame) =>
              frame.id === 1
                ? {
                    ...frame,
                    result: {
                      protocolVersion: 1,
                      authMethods: [{ id: "cached_token" }],
                    },
                  }
                : frame,
            ),
          ),
        })),
    };
    let released = false;
    const credentials: typeof CredentialPort.Service = {
      resolve: (ref) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            assert.equal(ref, request.credentialProfileRef);
            return { nativeProfileDirectory: directory };
          }),
          () =>
            Effect.sync(() => {
              released = true;
            }),
        ),
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(
          createGrokAcpProtocol({
            credentials,
            process,
            host: {
              ...host,
              environment: {
                ...host.environment,
                HOME: "/ambient",
                GROK_HOME: "/ambient/other",
                XAI_API_KEY: "ambient-key",
              },
            },
            now: () => 100,
          }).start(request),
          Stream.runCollect,
        ),
      ),
    );
    assert.equal(released, true);
    assert.equal(f.launches[0]?.environment.HOME, "/ambient");
    assert.equal(f.launches[0]?.environment.GROK_HOME, directory);
    assert.equal(f.launches[0]?.environment.XAI_API_KEY, undefined);
    assert.deepEqual(f.sent.find((m) => m.method === "authenticate")?.params, {
      methodId: "cached_token",
      _meta: { headless: true },
    });
  });
}
test("Grok ACP rejects noncanonical credential directories before launch", async () => {
  for (const directory of [
    "",
    "relative/.grok",
    "/isolated/../other/.grok",
    "/isolated/homes/grok/",
  ]) {
    const bad = fixture();
    const result = await Effect.runPromise(
      Effect.either(
        Effect.scoped(
          createGrokAcpProtocol({
            credentials: {
              resolve: () =>
                Effect.succeed({ nativeProfileDirectory: directory }),
            },
            process: bad.process,
            host,
            now: () => 100,
          }).start(request),
        ),
      ),
    );
    assert.equal(result._tag, "Left");
    assert.equal(bad.launches.length, 0);
  }
});
test("Grok ACP cannot authenticate cached tokens from ambient directories without an admitted credential reference", async () => {
  const f = fixture();
  let released = false;
  const result = await Effect.runPromise(
    Effect.either(
      Effect.scoped(
        createGrokAcpProtocol({
          credentials: {
            resolve: (ref) =>
              Effect.acquireRelease(
                Effect.sync(() => {
                  assert.equal(ref, request.credentialProfileRef);
                  return {};
                }),
                () =>
                  Effect.sync(() => {
                    released = true;
                  }),
              ),
          },
          process: {
            open: (launch) =>
              Effect.map(f.process.open(launch), (connection) => ({
                ...connection,
                events: connection.events.pipe(
                  Stream.map((frame) =>
                    frame.id === 1
                      ? {
                          ...frame,
                          result: {
                            protocolVersion: 1,
                            authMethods: [{ id: "cached_token" }],
                          },
                        }
                      : frame,
                  ),
                ),
              })),
          },
          host: {
            ...host,
            environment: {
              HOME: "/ambient",
              GROK_HOME: "/ambient/.grok",
              XAI_API_KEY: "ambient-key",
            },
          },
          now: () => 100,
        }).start(request),
      ),
    ),
  );
  assert.equal(result._tag, "Left");
  if (result._tag === "Left")
    assert.equal(result.left._tag, "AuthenticationRequired");
  assert.equal(released, true);
  assert.equal(f.launches[0]?.environment.GROK_HOME, undefined);
  assert.equal(f.launches[0]?.environment.XAI_API_KEY, undefined);
  assert.equal(
    f.sent.some((frame) =>
      ["authenticate", "session/new", "session/prompt"].includes(
        String(frame.method),
      ),
    ),
    false,
  );
});
test("Grok ACP rejects a protocol prompt above its channel bound before launching", async () => {
  const f = fixture();
  const oversized = {
    ...request,
    artifacts: [{ ...request.artifacts[0]!, content: "x".repeat(2 * 1048576) }],
  };
  const result = await Effect.runPromise(
    Effect.either(
      Effect.scoped(
        createGrokAcpProtocol({
          credentials: f.credentials,
          process: f.process,
          host,
          now: () => 100,
        }).start(oversized),
      ),
    ),
  );
  assert.equal(result._tag, "Left");
  assert.equal(f.launches.length, 0);
});
