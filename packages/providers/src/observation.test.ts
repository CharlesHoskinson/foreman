import { test } from "node:test";
import assert from "node:assert/strict";
import { Effect, Stream } from "effect";
import { PROVIDER_PROFILES } from "./profiles.js";
import { admitCell } from "./registry.js";
import { createTransportCellFixture } from "./fixtures/transport-test-fixture.js";
for (const profileId of [
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gemini-3.8-flash",
] as const) {
  const transportId =
    profileId === "gemini-3.8-flash"
      ? "google-interactions"
      : "openai-responses";
  test(`T-M3-022/R-M3-022 ${profileId} observes bounded terminal and nonterminal identities without dispatch`, async () => {
    const fixture = await createTransportCellFixture(profileId, transportId, {
      background: true,
    });
    try {
      const events = Array.from(
        await Effect.runPromise(
          Effect.scoped(
            Effect.flatMap(
              fixture.transport.start(fixture.request),
              Stream.runCollect,
            ),
          ),
        ),
      );
      const identity = events[0]!.providerIdentity;
      const dispatches = fixture.httpCalls.filter(
        (call) => call.method === "POST",
      ).length;
      for (const [remote, expected] of [
        ["in_progress", "pending"],
        ["completed", "completed"],
        ["cancelled", "cancelled"],
        ["not-found", "not-found"],
      ] as const) {
        fixture.setRemote(remote);
        const result = await Effect.runPromise(
          fixture.transport.observe(identity),
        );
        assert.equal(result.status, expected);
        assert.deepEqual(result.providerIdentity, identity);
        if (result.status === "completed") {
          assert(result.cursor);
          assert.deepEqual(result.result.value, {
            tag: "boolean",
            value: true,
          });
          assert.equal(result.result.schemaId, fixture.request.outputSchema.id);
          assert(
            result.result.byteLength <= fixture.request.limits.maxOutputBytes,
          );
        }
        if (result.status === "not-found")
          assert.match(result.evidence, /does not prove non-dispatch/);
        assert.equal(
          fixture.httpCalls.filter((call) => call.method === "POST").length,
          dispatches,
        );
        assert.equal(fixture.httpCalls.at(-1)?.method, "GET");
      }
    } finally {
      await fixture.dispose();
    }
  });
}
for (const profile of PROVIDER_PROFILES) {
  const transportId = profile.transports[1]!;
  test(`T-M3-022/R-M3-022 ${profile.id}/${transportId} observes only the existing scoped completion`, async () => {
    const fixture = await createTransportCellFixture(profile.id, transportId);
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const events = Array.from(
              yield* Stream.runCollect(
                yield* fixture.transport.start(fixture.request),
              ),
            );
            const identity = events[0]!.providerIdentity;
            const before = [fixture.launches.length, fixture.sent.length];
            const observed = yield* fixture.transport.observe(identity);
            assert.equal(observed.status, "completed");
            if (observed.status === "completed") {
              assert.deepEqual(observed.result.value, {
                tag: "boolean",
                value: true,
              });
              assert(observed.cursor);
            }
            assert.deepEqual(
              [fixture.launches.length, fixture.sent.length],
              before,
            );
            const absent = yield* fixture.transport.observe({
              ...identity,
              ...(identity.kind === "native"
                ? { sessionId: "absent-session" }
                : { responseId: "absent-response" }),
            });
            assert.equal(absent.status, "unsupported");
            assert.deepEqual(
              [fixture.launches.length, fixture.sent.length],
              before,
            );
          }),
        ),
      );
    } finally {
      await fixture.dispose();
    }
  });
}
test("T-M3-022/R-M3-022 Messages lacks per-message observation; unqualified xAI reconcile cannot enter product execution", async () => {
  const messages = await createTransportCellFixture(
    "claude-opus-5",
    "anthropic-messages",
  );
  try {
    const events = Array.from(
      await Effect.runPromise(
        Effect.scoped(
          Effect.flatMap(
            messages.transport.start(messages.request),
            Stream.runCollect,
          ),
        ),
      ),
    );
    const before = messages.httpCalls.length;
    assert.equal(
      (
        await Effect.runPromise(
          messages.transport.observe(events[0]!.providerIdentity),
        )
      ).status,
      "unsupported",
    );
    assert.equal(messages.httpCalls.length, before);
  } finally {
    await messages.dispose();
  }
  const grok = await createTransportCellFixture("grok-4.6", "xai-responses");
  try {
    const admitted = admitCell("grok-4.6", "xai-responses", ["reconcile"], [], {
      kind: "product",
      expectedIdentityRevision: "v1",
      now: Date.now(),
      transportVersion: "1",
      controls: grok.request.controls,
      credentialProfileRef: grok.request.credentialProfileRef,
    });
    assert(!admitted.ok);
    assert.equal(admitted.error._tag, "CapabilityUnverified");
    assert.equal(grok.httpCalls.length, 0);
  } finally {
    await grok.dispose();
  }
});
test("T-M3-022/R-M3-022 asynchronous cancellation acknowledgement is followed by independent cancelled observation", async () => {
  const fixture = await createTransportCellFixture(
    "gemini-3.8-flash",
    "google-interactions",
    { background: true },
  );
  try {
    const events = Array.from(
      await Effect.runPromise(
        Effect.scoped(
          Effect.flatMap(
            fixture.transport.start(fixture.request),
            Stream.runCollect,
          ),
        ),
      ),
    );
    const identity = events[0]!.providerIdentity;
    fixture.setRemote("in_progress");
    const cancelled = await Effect.runPromise(
      fixture.transport.cancel(identity),
    );
    assert.equal(cancelled.acknowledged, true);
    assert.equal(cancelled.remoteOutcome, "pending");
    fixture.setRemote("cancelled");
    assert.equal(
      (await Effect.runPromise(fixture.transport.observe(identity))).status,
      "cancelled",
    );
    assert.equal(
      fixture.httpCalls.filter(
        (call) => call.method === "POST" && !call.url.endsWith("/cancel"),
      ).length,
      1,
    );
  } finally {
    await fixture.dispose();
  }
});
