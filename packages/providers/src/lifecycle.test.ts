import { test } from "node:test";
import assert from "node:assert/strict";
import { Effect, Stream } from "effect";
import { PROVIDER_PROFILES } from "./profiles.js";
import type {
  CancellationObservationV1,
  ProviderIdentityV1,
} from "./contract.js";
import { createTransportCellFixture } from "./fixtures/transport-test-fixture.js";
for (const profile of PROVIDER_PROFILES)
  for (const transportId of profile.transports) {
    test(`T-M3-012/R-M3-012 ${profile.id}/${transportId} uncertain resume creates no replacement request`, async () => {
      const fixture = await createTransportCellFixture(profile.id, transportId);
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
        const before = [
          fixture.httpCalls.length,
          fixture.launches.length,
          fixture.sent.length,
        ];
        const result = await Effect.runPromise(
          Effect.either(
            Effect.scoped(
              fixture.transport.resume(fixture.request, identity, "4"),
            ),
          ),
        );
        assert.equal(result._tag, "Left");
        if (result._tag === "Left")
          assert(
            ["ResumeUnavailable", "OutcomeUnknown"].includes(result.left._tag),
          );
        assert.deepEqual(
          [
            fixture.httpCalls.length,
            fixture.launches.length,
            fixture.sent.length,
          ],
          before,
        );
      } finally {
        await fixture.dispose();
      }
    });
    test(`T-M3-012/R-M3-012 ${profile.id}/${transportId} stream loss preserves an unknown outcome`, async () => {
      const fixture = await createTransportCellFixture(
        profile.id,
        transportId,
        { outcome: "stream-loss" },
      );
      try {
        const result = await Effect.runPromise(
          Effect.either(
            Effect.scoped(
              Effect.flatMap(
                fixture.transport.start(fixture.request),
                Stream.runCollect,
              ),
            ),
          ),
        );
        assert.equal(result._tag, "Left");
        if (result._tag === "Left")
          assert.equal(result.left._tag, "OutcomeUnknown");
        assert.equal(
          fixture.httpCalls.filter((c) => c.method === "POST").length +
            fixture.launches.length,
          1,
        );
      } finally {
        await fixture.dispose();
      }
    });
  }
for (const profile of PROVIDER_PROFILES) {
  const transportId = profile.transports[1]!;
  test(`T-M3-011/R-M3-011 ${profile.id}/${transportId} local cleanup cannot fabricate remote cancellation`, async () => {
    const fixture = await createTransportCellFixture(profile.id, transportId);
    try {
      let cancelled: CancellationObservationV1 | undefined;
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const stream = yield* fixture.transport.start(fixture.request);
            yield* Stream.runCollect(
              stream.pipe(
                Stream.tap((event) =>
                  event.payload.type === "started"
                    ? Effect.gen(function* () {
                        cancelled = yield* fixture.transport.cancel(
                          event.providerIdentity,
                        );
                      })
                    : Effect.void,
                ),
              ),
            );
          }),
        ),
      );
      assert(cancelled);
      const observation = cancelled as CancellationObservationV1;
      assert.equal(observation.acknowledged, false);
      assert(["unknown", "pending"].includes(observation.remoteOutcome));
      assert.notEqual(observation.remoteOutcome, "cancelled");
      assert(fixture.releases.includes("close"));
    } finally {
      await fixture.dispose();
    }
  });
}
test("T-M3-011/R-M3-011 Responses compatibility does not grant xAI remote cancellation", async () => {
  const fixture = await createTransportCellFixture("grok-4.6", "xai-responses");
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
    const before = fixture.httpCalls.length;
    const result = await Effect.runPromise(
      fixture.transport.cancel(events[0]!.providerIdentity),
    );
    assert.equal(result.remoteOutcome, "unknown");
    assert.equal(result.acknowledged, false);
    assert.equal(fixture.httpCalls.length, before);
  } finally {
    await fixture.dispose();
  }
});
test("T-M3-012/R-M3-012 expired response checkpoint fails before reconnection", async () => {
  const fixture = await createTransportCellFixture(
    "gpt-6-astra",
    "openai-responses",
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
    const checkpoint = events.find((e) => e.payload.type === "checkpoint");
    assert(checkpoint?.payload.type === "checkpoint");
    const continuation = {
      ...checkpoint.payload.checkpoint,
      retention: {
        ...checkpoint.payload.checkpoint.retention,
        expiresAt: Date.now() - 1,
      },
    };
    const before = fixture.httpCalls.length;
    const result = await Effect.runPromise(
      Effect.either(
        Effect.scoped(
          fixture.transport.resume(
            { ...fixture.request, continuation },
            checkpoint.providerIdentity,
            "4",
          ),
        ),
      ),
    );
    assert.equal(result._tag, "Left");
    if (result._tag === "Left")
      assert.equal(result.left._tag, "ResumeUnavailable");
    assert.equal(fixture.httpCalls.length, before);
  } finally {
    await fixture.dispose();
  }
});
