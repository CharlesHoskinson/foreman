import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Effect, Redacted, Stream } from "effect";
import type {
  ProviderTransport,
  ProviderRequestV1,
  ProfileId,
  TransportId,
  ProviderIdentityV1,
  ProviderEventV1,
} from "../contract.js";
import type { ApiHttpPort, ApiHttpRequest } from "./api-http.js";
import { createOpenaiResponsesTransport } from "./openai-responses.js";
import { createXaiResponsesTransport } from "./xai-responses.js";
import { createAnthropicMessagesTransport } from "./anthropic-messages.js";
import { createGoogleInteractionsTransport } from "./google-interactions.js";
import { defaultProviderControls } from "../controls.js";
import { resolveProfile, SOURCE_MANIFEST_HASH } from "../profiles.js";
import type { ApiTransportOptions } from "./api-transport.js";
import { createApiTransport } from "./api-transport.js";
import { openaiResponsesDialect } from "./openai-responses.js";
const cells: [
  ProfileId,
  TransportId,
  string,
  (o: ApiTransportOptions) => ProviderTransport,
][] = [
  ["grok-4.6", "xai-responses", "xai", createXaiResponsesTransport],
  [
    "claude-opus-5",
    "anthropic-messages",
    "anthropic",
    createAnthropicMessagesTransport,
  ],
  [
    "claude-fable-5-1",
    "anthropic-messages",
    "anthropic",
    createAnthropicMessagesTransport,
  ],
  ["gpt-6-astra", "openai-responses", "openai", createOpenaiResponsesTransport],
  ["gpt-5.6-sol", "openai-responses", "openai", createOpenaiResponsesTransport],
  [
    "gemini-3.8-flash",
    "google-interactions",
    "google",
    createGoogleInteractionsTransport,
  ],
];
function request(cell = cells[3]!): ProviderRequestV1 {
  const p = resolveProfile(cell[0]);
  assert.ok(p.ok);
  return {
    schemaVersion: 1,
    effectId: "e",
    profileId: cell[0],
    transportId: cell[1],
    trustedInstructions: "Exact\nλ `$(literal)`",
    artifacts: [],
    toolPolicy: { mode: "none" },
    outputSchema: {
      id: "schema:test",
      content: {
        type: "association",
        additionalKeys: false,
        fields: [
          {
            key: "answer",
            required: true,
            schema: { type: "string", maxBytes: 64 },
          },
        ],
      },
    },
    controls: {
      ...defaultProviderControls(cell[0], cell[2]),
      toolChoice: "none",
    },
    limits: {
      deadline: Date.now() + 60000,
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
      maxToolCalls: 0,
      maxCostUsd: 1,
      maxOutputBytes: 4096,
      spendReservationRef: "reservation",
    },
    credentialProfileRef: "account:one",
    profileHash: p.value.profileHash,
    sourceManifestHash: SOURCE_MANIFEST_HASH,
    transportVersion: "1",
  };
}
const schemaRegistry = { "schema:test": request().outputSchema.content };
const credentials = {
  resolve: (_ref: string) =>
    Effect.succeed({
      headers: { authorization: Redacted.make("fixture-secret") },
    }),
};
function peer(events: unknown[], json = false) {
  const calls: ApiHttpRequest[] = [];
  const http: ApiHttpPort = {
    request: (r) => {
      calls.push(r);
      const content = json
        ? JSON.stringify(events[0])
        : events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("");
      const bytes = Buffer.from(content);
      return Effect.succeed({
        status: 200,
        headers: {
          "content-type": json ? "application/json" : "text/event-stream",
        },
        body: Stream.fromIterable([...bytes].map((b) => Uint8Array.of(b))),
      });
    },
  };
  return { calls, http };
}
function frames(model: string, id: string) {
  if (id === "anthropic-messages")
    return [
      {
        type: "message_start",
        message: { id: "r1", model, usage: { input_tokens: 4 } },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "PRIVATE-THOUGHT" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "OPAQUE-SIGNATURE" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: '{"answer":"λ"}' },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 5 },
      },
      { type: "message_stop" },
    ];
  if (id === "google-interactions")
    return [
      {
        event_type: "interaction.created",
        event_id: "c0",
        interaction: { id: "r1", model },
      },
      {
        event_type: "step.start",
        event_id: "c1",
        index: 0,
        step: { type: "thought" },
      },
      {
        event_type: "step.delta",
        event_id: "c2",
        index: 0,
        delta: { type: "thought_signature", signature: "OPAQUE-SIGNATURE" },
      },
      { event_type: "step.stop", event_id: "c3", index: 0 },
      {
        event_type: "step.start",
        event_id: "c4",
        index: 1,
        step: { type: "model_output" },
      },
      {
        event_type: "step.delta",
        event_id: "c5",
        index: 1,
        delta: { type: "text", text: '{"answer":"λ"}' },
      },
      { event_type: "step.stop", event_id: "c6", index: 1 },
      {
        event_type: "interaction.completed",
        event_id: "c7",
        interaction: {
          id: "r1",
          model,
          status: "completed",
          usage: { total_input_tokens: 4, total_output_tokens: 5 },
        },
      },
    ];
  return [
    {
      type: "response.created",
      sequence_number: 0,
      response: { id: "r1", model },
    },
    {
      type: "response.output_item.added",
      sequence_number: 1,
      item: {
        id: "rs1",
        type: "reasoning",
        encrypted_content: "OPAQUE-SIGNATURE",
      },
    },
    {
      type: "response.output_text.delta",
      sequence_number: 2,
      delta: '{"answer":"λ"}',
    },
    {
      type: "response.completed",
      sequence_number: 3,
      response: {
        id: "r1",
        model,
        status: "completed",
        output: [
          { type: "reasoning", encrypted_content: "OPAQUE-SIGNATURE" },
          {
            type: "message",
            content: [{ type: "output_text", text: '{"answer":"λ"}' }],
          },
        ],
        usage: { input_tokens: 4, output_tokens: 5 },
      },
    },
  ];
}
const collect = (t: ProviderTransport, r: ProviderRequestV1) =>
  Effect.runPromise(
    Effect.scoped(
      t.start(r).pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.map((c) => Array.from(c)),
      ),
    ),
  );
const identity = (
  r: ProviderRequestV1,
  provider = "openai",
): ProviderIdentityV1 => ({
  kind: "api",
  provider,
  profileId: r.profileId,
  model: r.profileId,
  transportId: r.transportId,
  credentialProfileRef: r.credentialProfileRef,
  endpointRevision:
    provider === "google"
      ? "v1beta"
      : provider === "anthropic"
        ? "2023-06-01"
        : "v1",
  responseId: "r1",
});
for (const cell of cells) {
  test(`${cell[0]} ${cell[1]} exact wire identity, schema and private opaque state`, async () => {
    const r = request(cell);
    const fake = peer(frames(r.profileId, r.transportId));
    let released = 0;
    const t = cell[3]({
      schemaRegistry,
      http: fake.http,
      credentials: {
        resolve: (ref) => {
          assert.equal(ref, "account:one");
          return Effect.acquireRelease(credentials.resolve(ref), () =>
            Effect.sync(() => {
              released++;
            }),
          );
        },
      },
    });
    const events = await collect(t, r);
    assert.equal(fake.calls.length, 1);
    assert.equal(released, 1);
    const body = JSON.parse(fake.calls[0]!.body!);
    assert.equal(body.model, r.profileId);
    assert.equal(body.stream, true);
    assert.equal(
      body.instructions ??
        body.system ??
        body.system_instruction ??
        body.input[0].content,
      r.trustedInstructions,
    );
    const result = events.find((e) => e.payload.type === "completed");
    assert.ok(result && result.payload.type === "completed");
    assert.equal(
      JSON.stringify(result.payload.result.json),
      JSON.stringify({ answer: "λ" }),
    );
    assert.equal(result.providerIdentity.profileId, r.profileId);
    assert.equal(result.payload.usage?.inputTokens, 4);
    assert.equal(result.payload.usage?.outputTokens, 5);
    const checkpoint = events
      .filter((e) => e.payload.type === "checkpoint")
      .at(-1);
    assert.ok(checkpoint?.payload.type === "checkpoint");
    const opaque = Buffer.from(checkpoint.payload.checkpoint.bytes).toString();
    assert.match(opaque, /OPAQUE-SIGNATURE/);
    assert.doesNotMatch(
      JSON.stringify(events.filter((e) => e.payload.type !== "checkpoint")),
      /PRIVATE-THOUGHT|OPAQUE-SIGNATURE|fixture-secret/,
    );
    if (r.transportId === "google-interactions") {
      assert.ok(body.response_format.schema);
      assert.equal(body.generation_config.thinking_level, "high");
      assert.equal(result.cursor, "c7");
    }
    if (r.transportId === "anthropic-messages") {
      assert.equal(body.thinking.type, "adaptive");
      assert.ok(body.output_config.format.schema);
      assert.equal(body.background, undefined);
    }
  });
  test(`${cell[0]} rejects native coding before credentials or HTTP`, async () => {
    const r = request(cell);
    let touched = 0;
    const t = cell[3]({
      credentials: {
        resolve: () => {
          touched++;
          return credentials.resolve("x");
        },
      },
      http: peer([]).http,
    });
    const result: { readonly _tag: "Left" | "Right" } = await Effect.runPromise(
      Effect.scoped(
        Effect.either(
          t.start({
            ...r,
            toolPolicy: {
              mode: "native-coding",
              workspaceGrantId: "g",
              permissionGrantIds: [],
              hostPermissionPortRef: "p",
            },
          }),
        ),
      ),
    );
    assert.equal(result._tag, "Left");
    assert.equal(touched, 0);
  });
}
test("different observed exact model fails without output or fallback", async () => {
  const r = request();
  const fake = peer(frames("wrong-model", r.transportId));
  await assert.rejects(
    collect(
      createOpenaiResponsesTransport({
        credentials,
        schemaRegistry,
        http: fake.http,
      }),
      r,
    ),
    /ModelMismatch|different exact model/,
  );
  assert.equal(fake.calls.length, 1);
});
test("disconnect has OutcomeUnknown and creates no replacement request", async () => {
  const r = request();
  const fake = peer(frames(r.profileId, r.transportId).slice(0, 2));
  const t = createOpenaiResponsesTransport({
    credentials,
    schemaRegistry,
    http: fake.http,
  });
  await assert.rejects(collect(t, r), /terminal outcome/);
  assert.equal(fake.calls.length, 1);
});
test("xAI cancellation never posts to an OpenAI-compatible endpoint and replay never redispatches", async () => {
  const r = request(cells[0]);
  const fake = peer([]);
  const t = createXaiResponsesTransport({
    credentials,
    schemaRegistry,
    http: fake.http,
  });
  assert.equal(
    (await Effect.runPromise(t.cancel(identity(r, "xai")))).remoteOutcome,
    "unknown",
  );
  const resume = await Effect.runPromise(
    Effect.scoped(Effect.either(t.resume(r, identity(r, "xai"), "2"))),
  );
  assert.equal(resume._tag, "Left");
  assert.equal(fake.calls.length, 0);
});
test("Google resume restores thought steps and prior output before GET cursor replay", async () => {
  const r = request(cells[5]);
  const all = frames(r.profileId, r.transportId);
  const fake = peer(all);
  const t = createGoogleInteractionsTransport({
    credentials,
    schemaRegistry,
    http: fake.http,
  });
  const events = await collect(t, r);
  const checkpoint = events.find(
    (e) => e.cursor === "c5" && e.payload.type === "checkpoint",
  );
  assert.ok(checkpoint?.payload.type === "checkpoint");
  const next = peer(all.slice(6));
  const replay = createGoogleInteractionsTransport({
    credentials,
    schemaRegistry,
    http: next.http,
  });
  const result = await Effect.runPromise(
    Effect.scoped(
      replay
        .resume(
          { ...r, continuation: checkpoint.payload.checkpoint },
          checkpoint.providerIdentity,
          "c5",
        )
        .pipe(Effect.flatMap(Stream.runCollect)),
    ),
  );
  assert.ok(Array.from(result).some((e) => e.payload.type === "completed"));
  assert.equal(next.calls.length, 1);
  assert.equal(next.calls[0]!.method, "GET");
  assert.match(next.calls[0]!.url, /last_event_id=c5/);
});
test("OpenAI background replay uses GET starting_after and cancellation distinguishes pending", async () => {
  const r = request();
  const bg = {
    ...r,
    controls: {
      ...r.controls,
      execution: { mode: "background" as const, store: true as const },
    },
  };
  const fake = peer(frames(r.profileId, r.transportId).slice(3));
  const t = createOpenaiResponsesTransport({
    credentials,
    schemaRegistry,
    http: fake.http,
    requestForIdentity: () => Effect.succeed(bg),
  });
  await Effect.runPromise(
    Effect.scoped(
      t.resume(bg, identity(r), "2").pipe(Effect.flatMap(Stream.runCollect)),
    ),
  );
  assert.match(fake.calls[0]!.url, /starting_after=2/);
  assert.equal(fake.calls[0]!.method, "GET");
  const pending = peer(
    [{ id: "r1", model: r.profileId, status: "in_progress" }],
    true,
  );
  const t2 = createOpenaiResponsesTransport({
    credentials,
    schemaRegistry,
    http: pending.http,
    requestForIdentity: () => Effect.succeed(bg),
  });
  const outcome = await Effect.runPromise(t2.cancel(identity(r)));
  assert.equal(outcome.acknowledged, true);
  assert.equal(outcome.remoteOutcome, "pending");
  assert.match(pending.calls[0]!.url, /r1\/cancel$/);
});
test("observe validates remote output against host schema and 404 does not imply non-dispatch", async () => {
  const r = request();
  const fake = peer(
    [
      {
        id: "r1",
        model: r.profileId,
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: '{"answer":"ok"}' }],
          },
        ],
      },
    ],
    true,
  );
  const t = createOpenaiResponsesTransport({
    credentials,
    schemaRegistry,
    http: fake.http,
    requestForIdentity: () => Effect.succeed(r),
  });
  assert.equal(
    (await Effect.runPromise(t.observe(identity(r)))).status,
    "completed",
  );
  const bad = peer(
    [
      {
        id: "r1",
        model: r.profileId,
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: '{"unknown":true}' }],
          },
        ],
      },
    ],
    true,
  );
  await assert.rejects(
    Effect.runPromise(
      createOpenaiResponsesTransport({
        credentials,
        schemaRegistry,
        http: bad.http,
        requestForIdentity: () => Effect.succeed(r),
      }).observe(identity(r)),
    ),
  );
});
test("metadata probe never generates output and preserves signed-out versus unknown", async () => {
  const r = request();
  const fake = peer([{ id: r.profileId }], true);
  const t = createOpenaiResponsesTransport({
    credentials,
    schemaRegistry,
    http: fake.http,
  });
  const result = await Effect.runPromise(
    t.probe({
      profileId: r.profileId,
      transportId: r.transportId,
      credentialProfileRef: r.credentialProfileRef,
      mode: "metadata-only",
    }),
  );
  assert.equal(result.identity.state, "exact");
  assert.equal(result.capabilities.length, 0);
  assert.equal(fake.calls[0]!.method, "GET");
  assert.match(fake.calls[0]!.url, /models\/gpt-6-astra$/);
});
test("HTTP 403 is permission uncertainty rather than signed-out evidence", async () => {
  const r = request();
  const http: ApiHttpPort = {
    request: () =>
      Effect.succeed({ status: 403, headers: {}, body: Stream.empty }),
  };
  const result = await Effect.runPromise(
    createOpenaiResponsesTransport({ credentials, schemaRegistry, http }).probe(
      {
        profileId: r.profileId,
        transportId: r.transportId,
        credentialProfileRef: r.credentialProfileRef,
        mode: "metadata-only",
      },
    ),
  );
  assert.equal(result.authentication.state, "unknown");
  assert.equal(result.authentication.remediation, undefined);
});
test("coding tool request under no-tools policy fails without executing or dispatching another call", async () => {
  const r = request();
  const fake = peer([
    { type: "response.created", response: { id: "r1", model: r.profileId } },
    {
      type: "response.output_item.added",
      item: { type: "function_call", call_id: "c1", name: "shell" },
    },
  ]);
  await assert.rejects(
    collect(
      createOpenaiResponsesTransport({
        credentials,
        schemaRegistry,
        http: fake.http,
      }),
      r,
    ),
    /toolPolicy none/,
  );
  assert.equal(fake.calls.length, 1);
});
test("refusal and truncation remain distinct from completed schema output", async () => {
  const r = request();
  const refused = peer([
    { type: "response.created", response: { id: "r1", model: r.profileId } },
    {
      type: "response.completed",
      response: {
        id: "r1",
        model: r.profileId,
        status: "completed",
        output: [
          { type: "message", content: [{ type: "refusal", refusal: "no" }] },
        ],
      },
    },
  ]);
  const events = await collect(
    createOpenaiResponsesTransport({
      credentials,
      schemaRegistry,
      http: refused.http,
    }),
    r,
  );
  assert.equal(events.at(-1)!.payload.type, "refused");
  assert.equal(
    events.some((e) => e.payload.type === "completed"),
    false,
  );
  const truncated = peer([
    { type: "response.created", response: { id: "r1", model: r.profileId } },
    {
      type: "response.incomplete",
      response: { id: "r1", model: r.profileId, status: "incomplete" },
    },
  ]);
  await assert.rejects(
    collect(
      createOpenaiResponsesTransport({
        credentials,
        schemaRegistry,
        http: truncated.http,
      }),
      r,
    ),
    /OutputIncomplete/,
  );
});
test("unknown remote state and missing original schema cannot produce completed evidence", async () => {
  const r = request();
  const http: ApiHttpPort = {
    request: () =>
      Effect.succeed({ status: 404, headers: {}, body: Stream.empty }),
  };
  const result = await Effect.runPromise(
    createOpenaiResponsesTransport({
      credentials,
      schemaRegistry,
      http,
    }).observe(identity(r)),
  );
  assert.equal(result.status, "not-found");
  if (result.status === "not-found")
    assert.match(result.evidence, /does not prove/);
  const fake = peer(
    [{ id: "r1", model: r.profileId, status: "completed" }],
    true,
  );
  await assert.rejects(
    Effect.runPromise(
      createOpenaiResponsesTransport({
        credentials,
        schemaRegistry,
        http: fake.http,
      }).observe(identity(r)),
    ),
    /Original admitted request/,
  );
});
test("invalid or expired checkpoints perform zero HTTP calls", async () => {
  const r = request(cells[5]);
  const fake = peer(frames(r.profileId, r.transportId));
  const initial = await collect(
    createGoogleInteractionsTransport({
      credentials,
      schemaRegistry,
      http: fake.http,
    }),
    r,
  );
  const event = initial.find(
    (e) => e.cursor === "c5" && e.payload.type === "checkpoint",
  );
  assert.ok(event?.payload.type === "checkpoint");
  const cp = event.payload.checkpoint;
  const oversized = Buffer.alloc(4 * 1024 * 1024 + 1);
  for (const continuation of [
    { ...cp, prefixHash: "wrong" },
    { ...cp, transportVersion: "wrong" },
    { ...cp, formatVersion: "wrong" },
    {
      ...cp,
      bytes: oversized,
      sha256: createHash("sha256").update(oversized).digest("hex"),
    },
    { ...cp, retention: { ...cp.retention, expiresAt: 0 } },
  ]) {
    const empty = peer([]);
    const t = createGoogleInteractionsTransport({
      credentials,
      schemaRegistry,
      http: empty.http,
    });
    const result: { readonly _tag: "Left" | "Right" } = await Effect.runPromise(
      Effect.scoped(
        Effect.either(
          t.resume({ ...r, continuation }, event.providerIdentity, "c5"),
        ),
      ),
    );
    assert.equal(result._tag, "Left");
    assert.equal(empty.calls.length, 0);
  }
});
test("Google token truncation reports OutputIncomplete", async () => {
  const r = request(cells[5]);
  const fake = peer([
    {
      event_type: "interaction.created",
      interaction: { id: "r1", model: r.profileId },
    },
    {
      event_type: "interaction.completed",
      interaction: { id: "r1", model: r.profileId, status: "incomplete" },
    },
  ]);
  await assert.rejects(
    collect(
      createGoogleInteractionsTransport({
        credentials,
        schemaRegistry,
        http: fake.http,
      }),
      r,
    ),
    /OutputIncomplete/,
  );
});
test("API dispatch rejects stale profile/source/version bindings before credentials", async () => {
  const r = request();
  let calls = 0;
  const t = createOpenaiResponsesTransport({
    schemaRegistry,
    credentials: {
      resolve: () => {
        calls++;
        return credentials.resolve("account:one");
      },
    },
    http: peer([]).http,
  });
  for (const changed of [
    { ...r, profileHash: "stale" },
    { ...r, sourceManifestHash: "stale" },
    { ...r, transportVersion: "old" },
  ]) {
    const result: { readonly _tag: "Left" | "Right" } = await Effect.runPromise(
      Effect.scoped(Effect.either(t.start(changed))),
    );
    assert.equal(result._tag, "Left");
  }
  assert.equal(calls, 0);
});
for (const cell of cells) {
  test(`API ${cell[0]} rejects response identity replacement within a stream`, async () => {
    const r = request(cell);
    const initial =
      cell[1] === "anthropic-messages"
        ? (id: string) => ({
            type: "message_start",
            message: { id, model: cell[0] },
          })
        : cell[1] === "google-interactions"
          ? (id: string) => ({
              event_type: "interaction.created",
              interaction: { id, model: cell[0] },
            })
          : (id: string) => ({
              type: "response.created",
              response: { id, model: cell[0] },
            });
    const f = peer([initial("A"), initial("B"), ...frames(cell[0], cell[1])]);
    const t = cell[3]({ credentials, http: f.http, schemaRegistry });
    const result = await Effect.runPromise(
      Effect.either(
        Effect.scoped(Effect.flatMap(t.start(r), Stream.runCollect)),
      ),
    );
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") assert.equal(result.left._tag, "ModelMismatch");
    assert.equal(f.calls.length, 1);
  });
  test(`API ${cell[0]} rejects observed token usage above its admitted bound`, async () => {
    const base = request(cell);
    const r = {
      ...base,
      limits: { ...base.limits, maxInputTokens: 1, maxOutputTokens: 1 },
    };
    const f = peer(frames(cell[0], cell[1]));
    const result = await Effect.runPromise(
      Effect.either(
        Effect.scoped(
          Effect.flatMap(
            cell[3]({ credentials, http: f.http, schemaRegistry }).start(r),
            Stream.runCollect,
          ),
        ),
      ),
    );
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") {
      assert.equal(result.left._tag, "OutputIncomplete");
      assert.ok(result.left.usage);
    }
    assert.equal(f.calls.length, 1);
  });
}
test("API observed USD cost fails its bound while absent cost remains unknown", async () => {
  for (const cost of [undefined, "2"] as const) {
    const r = request();
    const f = peer(frames(r.profileId, r.transportId));
    const t = createApiTransport(
      {
        ...openaiResponsesDialect,
        consume: (state, event) => {
          const delta = openaiResponsesDialect.consume(state, event);
          if (cost !== undefined)
            state.usage = { ...state.usage, costUsd: cost };
          return delta;
        },
      },
      { credentials, http: f.http, schemaRegistry },
    );
    const result = await Effect.runPromise(
      Effect.either(
        Effect.scoped(Effect.flatMap(t.start(r), Stream.runCollect)),
      ),
    );
    assert.equal(result._tag, cost === undefined ? "Right" : "Left");
    if (result._tag === "Left") {
      assert.equal(result.left._tag, "OutputIncomplete");
      assert.equal(result.left.usage?.costUsd, "2");
    } else {
      const completed = Array.from(result.right).find(
        (e) => e.payload.type === "completed",
      );
      assert.ok(completed?.payload.type === "completed");
      assert.equal(completed.payload.usage?.costUsd, undefined);
    }
  }
});
for (const blocked of ["credentials", "http"] as const) {
  test(`API metadata probe times out ${blocked} as ProbeUnknown and releases its scope`, async () => {
    let released = false;
    const r = request();
    const t = createOpenaiResponsesTransport({
      credentials: {
        resolve: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                released = true;
              }),
            );
            if (blocked === "credentials") return yield* Effect.never;
            return yield* credentials.resolve(r.credentialProfileRef);
          }),
      },
      http: { request: () => Effect.never },
    });
    const outcome = await Effect.runPromise(
      t
        .probe({
          profileId: r.profileId,
          transportId: r.transportId,
          credentialProfileRef: r.credentialProfileRef,
          mode: "metadata-only",
          limits: { ...r.limits, deadline: Date.now() + 10 },
        })
        .pipe(Effect.either, Effect.timeoutOption("100 millis")),
    );
    assert.equal(outcome._tag, "Some");
    if (outcome._tag === "Some") {
      assert.equal(outcome.value._tag, "Left");
      if (outcome.value._tag === "Left")
        assert.equal(outcome.value.left._tag, "ProbeUnknown");
    }
    assert.equal(released, true);
  });
}
