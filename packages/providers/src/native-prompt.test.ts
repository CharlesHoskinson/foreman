import { test } from "node:test";
import assert from "node:assert/strict";
import { Effect, Stream } from "effect";
import { sha256Hex } from "@foreman/core";
import { PROVIDER_PROFILES } from "./profiles.js";
import { createTransportCellFixture } from "./fixtures/transport-test-fixture.js";
const prefix =
  'A quoted "line"\n$HOME $(never-execute) `literal` \\ UTF-8 🧪 café\n';
const prompt = prefix + "x".repeat(128 * 1024 - Buffer.byteLength(prefix));
function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function json(text: unknown): Record<string, unknown> {
  assert.equal(typeof text, "string");
  const value: unknown = JSON.parse(text as string);
  return object(value);
}
for (const profile of PROVIDER_PROFILES) {
  const transportId = profile.transports[1]!;
  test(`T-M3-005/R-M3-005 ${profile.id}/${transportId} preserves 128 KiB native prompt bytes`, async () => {
    const fixture = await createTransportCellFixture(profile.id, transportId, {
      artifactText: prompt,
    });
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.flatMap(
            fixture.transport.start(fixture.request),
            Stream.runCollect,
          ),
        ),
      );
      assert.equal(Buffer.byteLength(prompt), 128 * 1024);
      const launch = fixture.launches[0]!;
      let artifacts: unknown;
      if (transportId === "grok-acp") {
        const request = object(
          fixture.sent.find((frame) => frame.method === "session/prompt"),
        );
        const parts = object(request.params).prompt;
        assert(Array.isArray(parts));
        artifacts = json(object(parts[0]).text).artifacts;
      } else if (transportId === "codex-app-server") {
        const request = object(
          fixture.sent.find((frame) => frame.method === "turn/start"),
        );
        const parts = object(request.params).input;
        assert(Array.isArray(parts));
        artifacts = json(object(parts[0]).text).artifacts;
      } else if (transportId === "claude-code") {
        artifacts = json(
          object(
            json(Buffer.from(launch.initialInput!).toString("utf8")).message,
          ).content,
        ).artifacts;
      } else {
        const text = Buffer.from(launch.initialInput!).toString("utf8");
        const marker = "\n\nInput artifacts:\n";
        const index = text.indexOf(marker);
        assert(index >= 0);
        artifacts = JSON.parse(text.slice(index + marker.length)) as unknown;
      }
      assert(Array.isArray(artifacts));
      const received = object(artifacts[0]).content;
      assert.equal(received, prompt);
      assert.equal(sha256Hex(received as string), sha256Hex(prompt));
      assert(!launch.cmd.some((arg) => arg === prompt));
      assert.equal(launch.cwd, fixture.directory);
    } finally {
      await fixture.dispose();
    }
  });
  test(`T-M3-006/R-M3-006 ${transportId} rejects an unenforced no-tools boundary before native input`, async () => {
    const fixture = await createTransportCellFixture(profile.id, transportId, {
      hostEnforced: false,
    });
    try {
      const result = await Effect.runPromise(
        Effect.either(Effect.scoped(fixture.transport.start(fixture.request))),
      );
      assert.equal(result._tag, "Left");
      assert.equal(fixture.launches.length, 0);
      assert.equal(fixture.credentialRefs.length, 0);
    } finally {
      await fixture.dispose();
    }
  });
}
