import { test } from "node:test";
import assert from "node:assert/strict";
import { Effect, Stream } from "effect";
import { canonicalize } from "@foreman/core";
import { PROVIDER_PROFILES } from "./profiles.js";
import {
  createTransportCellFixture,
  SHARED_REMOTE_ID,
} from "./fixtures/transport-test-fixture.js";
for (const profile of PROVIDER_PROFILES) {
  test(`T-M3-004/R-M3-004 ${profile.id} API response and native session have distinct protocol identities`, async () => {
    const identities = [];
    for (const transportId of profile.transports) {
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
        identities.push(identity);
        assert.equal(identity.profileId, profile.id);
        assert.equal(identity.provider, profile.provider);
        assert.equal(identity.transportId, transportId);
        assert.equal(
          identity.credentialProfileRef,
          fixture.request.credentialProfileRef,
        );
        if (identity.kind === "api") {
          assert.equal(identity.responseId, SHARED_REMOTE_ID);
          assert(identity.endpointRevision);
        } else {
          assert.equal(identity.sessionId, SHARED_REMOTE_ID);
          assert(identity.protocolVersion);
        }
      } finally {
        await fixture.dispose();
      }
    }
    assert.equal(identities[0]?.kind, "api");
    assert.equal(identities[1]?.kind, "native");
    assert.notEqual(canonicalize(identities[0]), canonicalize(identities[1]));
  });
}
for (const profile of PROVIDER_PROFILES)
  for (const transportId of profile.transports)
    test(`T-M3-006/R-M3-006 ${profile.id}/${transportId} cannot silently replace required grammar`, async () => {
      const fixture = await createTransportCellFixture(profile.id, transportId);
      try {
        const result = await Effect.runPromise(
          Effect.either(
            Effect.scoped(
              fixture.transport.start({
                ...fixture.request,
                generation: {
                  grammarMode: "grammar-required",
                  resolvedGrammarMode: "grammar",
                  attempt: 0,
                  trustedTemplateId: "foreman:pel-generation-v1",
                },
              }),
            ),
          ),
        );
        assert.equal(result._tag, "Left");
        if (result._tag === "Left")
          assert.equal(result.left._tag, "UnsupportedCapability");
        assert.equal(fixture.credentialRefs.length, 0);
        assert.equal(fixture.launches.length, 0);
        assert.equal(fixture.httpCalls.length, 0);
      } finally {
        await fixture.dispose();
      }
    });
for (const profile of PROVIDER_PROFILES) {
  const transportId = profile.transports[1]!;
  test(`T-M3-006/R-M3-006 ${profile.id}/${transportId} unrequested tool activity violates the no-tools contract`, async () => {
    const fixture = await createTransportCellFixture(profile.id, transportId, {
      outcome: "tool-without-permission",
    });
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
        assert.equal(result.left._tag, "UnsupportedCapability");
      assert.equal(fixture.launches.length, 1);
    } finally {
      await fixture.dispose();
    }
  });
}
