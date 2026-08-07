import { createHash } from "node:crypto";
import { SpecCorrectnessPrimitives } from "@council/application/spec-correctness-primitives";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import * as PlatformRoot from "../src/index.js";
import {
  NodeSpecCorrectnessPrimitives,
  NodeSpecCorrectnessPrimitivesLive,
} from "../src/spec-correctness-primitives.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("NodeSpecCorrectnessPrimitives", () => {
  it("computes SHA-256 matching node:crypto over a snapshot", () => {
    const bytes = encode("spec-correctness-canary");
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(NodeSpecCorrectnessPrimitives.sha256(bytes)).toBe(expected);
  });

  it("does not observe post-call mutation of the caller buffer", () => {
    const bytes = encode("mutable-input");
    const first = NodeSpecCorrectnessPrimitives.sha256(bytes);
    bytes[0] = 0x00;
    const second = NodeSpecCorrectnessPrimitives.sha256(
      encode("mutable-input"),
    );
    expect(first).toBe(second);
  });

  it("decodes valid UTF-8 and returns null for invalid sequences", () => {
    expect(NodeSpecCorrectnessPrimitives.decodeUtf8(encode("ok"))).toBe("ok");
    expect(
      NodeSpecCorrectnessPrimitives.decodeUtf8(Uint8Array.of(0xff, 0xfe)),
    ).toBeNull();
  });

  it("preserves a valid UTF-8 BOM so byte-integrity checks can round-trip it", () => {
    const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, ...encode("日本語 café 🚀"));
    expect(NodeSpecCorrectnessPrimitives.decodeUtf8(bytes)).toBe(
      "\uFEFF日本語 café 🚀",
    );
  });

  it("decodeUtf8 does not throw when the input buffer is later mutated", () => {
    const bytes = encode("still-valid");
    const text = NodeSpecCorrectnessPrimitives.decodeUtf8(bytes);
    bytes[0] = 0xff;
    expect(text).toBe("still-valid");
  });

  it("exports a Layer that provides SpecCorrectnessPrimitives", async () => {
    const program = Effect.gen(function* () {
      const primitives = yield* SpecCorrectnessPrimitives;
      return primitives.sha256(encode("layer"));
    }).pipe(Effect.provide(NodeSpecCorrectnessPrimitivesLive));
    const digest = await Effect.runPromise(program);
    expect(digest).toHaveLength(64);
    // Layer identity check: tag is constructible.
    expect(
      Layer.succeed(SpecCorrectnessPrimitives, NodeSpecCorrectnessPrimitives),
    ).toBeDefined();
  });

  it("exposes NodeSpecCorrectnessPrimitives only on the package subpath, not the root barrel", () => {
    expect(NodeSpecCorrectnessPrimitives).toBeDefined();
    expect(NodeSpecCorrectnessPrimitivesLive).toBeDefined();
    expect(
      Object.prototype.hasOwnProperty.call(
        PlatformRoot,
        "NodeSpecCorrectnessPrimitives",
      ),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(
        PlatformRoot,
        "NodeSpecCorrectnessPrimitivesLive",
      ),
    ).toBe(false);
  });
});
