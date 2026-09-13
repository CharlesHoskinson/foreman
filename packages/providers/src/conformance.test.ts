import { test } from "node:test";
import assert from "node:assert/strict";
import { Effect, Stream } from "effect";
import { PROVIDER_PROFILES } from "./profiles.js";
import { createTransportCellFixture } from "./fixtures/transport-test-fixture.js";
for (const profile of PROVIDER_PROFILES)
  for (const transportId of profile.transports) {
    test(`T-M3-016/R-M3-016 exact cell ${profile.id}/${transportId} completes a bounded boolean`, async () => {
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
        assert(events.some((e) => e.payload.type === "started"));
        const terminal = events.at(-1);
        assert.equal(terminal?.payload.type, "completed");
        if (terminal?.payload.type === "completed") {
          assert.deepEqual(terminal.payload.result.value, {
            tag: "boolean",
            value: true,
          });
          assert.equal(
            terminal.payload.result.schemaId,
            "schema:pel-boolean-v1",
          );
          assert.equal(terminal.providerIdentity.profileId, profile.id);
          assert.equal(terminal.providerIdentity.transportId, transportId);
        }
        assert.equal(fixture.credentialRefs.length, 1);
        assert.equal(
          fixture.httpCalls.filter((c) => c.method === "POST").length +
            fixture.launches.length,
          1,
        );
      } finally {
        await fixture.dispose();
      }
    });
    test(`T-M3-016/R-M3-016 exact cell ${profile.id}/${transportId} rejects invalid output without fallback`, async () => {
      const fixture = await createTransportCellFixture(
        profile.id,
        transportId,
        { outcome: "malformed-output" },
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
          assert.equal(result.left._tag, "OutputInvalid");
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
