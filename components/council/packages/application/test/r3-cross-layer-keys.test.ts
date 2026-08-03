import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  compileReviewPrompt,
  lowerProviderSchema,
  sortJsonKeys,
  stringifyCanonicalJson,
} from "../src/index.js";
import {
  buildLayer,
  encodeUtf8Text,
  emptyLog,
  makeArtifact,
  makeContract,
  defaultArtifacts,
  sha256Hex,
  bytesById,
} from "./test-helpers.js";

const requireAt = <T>(items: readonly T[], index: number): T => {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`missing fixture at ${String(index)}`);
  }
  return value;
};

describe("cross-layer key vectors", () => {
  it("preserves __proto__, constructor, and prototype through application canonicalizer", () => {
    const text =
      '{"type":"object","additionalProperties":false,"required":["__proto__","constructor","prototype"],"properties":{"__proto__":{"type":"string"},"constructor":{"type":"string"},"prototype":{"type":"string"}}}';
    const schema = JSON.parse(text) as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    expect(Object.hasOwn(properties, "__proto__")).toBe(true);
    expect(Object.hasOwn(properties, "constructor")).toBe(true);
    expect(Object.hasOwn(properties, "prototype")).toBe(true);
    const sorted = sortJsonKeys(schema) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.hasOwn(sorted.properties, "__proto__")).toBe(true);
    expect(Object.hasOwn(sorted.properties, "constructor")).toBe(true);
    expect(Object.hasOwn(sorted.properties, "prototype")).toBe(true);
    expect(sorted.required).toEqual(["__proto__", "constructor", "prototype"]);
    const encoded = stringifyCanonicalJson(schema);
    expect(encoded).toContain('"__proto__"');
    expect(encoded).toContain('"constructor"');
    expect(encoded).toContain('"prototype"');
    const reparsed = JSON.parse(encoded) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.hasOwn(reparsed.properties, "__proto__")).toBe(true);
    expect(Object.hasOwn(reparsed.properties, "constructor")).toBe(true);
    expect(Object.hasOwn(reparsed.properties, "prototype")).toBe(true);
    expect(reparsed.required).toEqual([
      "__proto__",
      "constructor",
      "prototype",
    ]);
  });

  it("preserves the three keys through provider lowering", () => {
    const text =
      '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["__proto__","constructor","prototype"],"properties":{"__proto__":{"type":"string"},"constructor":{"type":"string"},"prototype":{"type":"string"}}}';
    const schema = JSON.parse(text) as unknown;
    const result = Effect.runSync(lowerProviderSchema("openai", schema));
    const lowered = result.loweredSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.hasOwn(lowered.properties, "__proto__")).toBe(true);
    expect(Object.hasOwn(lowered.properties, "constructor")).toBe(true);
    expect(Object.hasOwn(lowered.properties, "prototype")).toBe(true);
    expect(lowered.required).toEqual(["__proto__", "constructor", "prototype"]);
    // Must not use prototype-chain membership as evidence
    expect(
      Object.prototype.hasOwnProperty.call(lowered.properties, "__proto__"),
    ).toBe(true);
  });

  it("preserves the three keys through final prompt materialization and parse-back", async () => {
    const text =
      '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["__proto__","constructor","prototype"],"properties":{"__proto__":{"type":"string"},"constructor":{"type":"string"},"prototype":{"type":"string"}}}';
    const schemaBytes = encodeUtf8Text(text);
    const digest = sha256Hex(schemaBytes);
    const schemaId = `sha256:${digest}`;
    const artifacts = [
      requireAt(defaultArtifacts, 0),
      requireAt(defaultArtifacts, 1),
      makeArtifact(
        "response-schema",
        "application/json",
        schemaBytes,
        digest,
        schemaId,
      ),
      requireAt(defaultArtifacts, 3),
    ];
    const store = bytesById();
    store.set(schemaId, schemaBytes);
    const log = emptyLog();
    const exit = await Effect.runPromiseExit(
      compileReviewPrompt({
        contract: makeContract({
          artifacts,
          responseSchemaArtifactId: schemaId,
        }),
        providerFamily: "openai",
      }).pipe(Effect.provide(buildLayer({ log, bytes: store }))),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      // Portable UTF-8 decode for BMP-heavy fixture text (no TextDecoder).
      const bytes = exit.value.promptBytes;
      let promptText = "";
      for (let i = 0; i < bytes.byteLength; i += 1) {
        promptText += String.fromCharCode(bytes[i] ?? 0);
      }
      const parsed = JSON.parse(promptText) as {
        responseSchema: {
          properties: Record<string, unknown>;
          required: string[];
        };
      };
      expect(Object.hasOwn(parsed.responseSchema.properties, "__proto__")).toBe(
        true,
      );
      expect(
        Object.hasOwn(parsed.responseSchema.properties, "constructor"),
      ).toBe(true);
      expect(Object.hasOwn(parsed.responseSchema.properties, "prototype")).toBe(
        true,
      );
      expect(parsed.responseSchema.required).toEqual([
        "__proto__",
        "constructor",
        "prototype",
      ]);
    }
  });
});
