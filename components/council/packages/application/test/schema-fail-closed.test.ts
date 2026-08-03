import { describe, expect, it } from "vitest";
import {
  CanonicalSchemaInvalid,
  SchemaLoweringError,
  lowerProviderSchema,
  stringifyCanonicalJson,
  encodeUtf8,
  canonicalJsonBytes,
} from "../src/index.js";
import { runSyncFail, runSync } from "./test-helpers.js";

/**
 * RED probes for fail-closed canonical schema grammar (version 1).
 * Every case below must reject before provider lowering succeeds.
 */

const expectSchemaReject = (schema: unknown, reasonFragment?: string) => {
  const error = runSyncFail(lowerProviderSchema("openai", schema));
  expect(
    error instanceof SchemaLoweringError ||
      error instanceof CanonicalSchemaInvalid ||
      (error as { _tag?: string })._tag === "CanonicalSchemaInvalid" ||
      (error as { _tag?: string })._tag === "SchemaLoweringError",
  ).toBe(true);
  if (reasonFragment !== undefined) {
    const reason = (error as { reason?: string }).reason ?? "";
    expect(reason).toMatch(new RegExp(reasonFragment, "i"));
  }
};

describe("fail-closed schema grammar", () => {
  it.each([
    ["type dragon", { type: "dragon" }],
    ["type number 42", { type: 42 }],
    ["required null and number", { type: "object", required: [null, 3] }],
    ["required duplicate", { type: "object", required: ["x", "x"] }],
    ["items null", { type: "array", items: null }],
    ["items number", { type: "array", items: 3 }],
    [
      "additionalProperties null",
      { type: "object", additionalProperties: null },
    ],
    [
      "additionalProperties string",
      { type: "object", additionalProperties: "yes" },
    ],
    ["enum string", { enum: "x" }],
    ["enum empty", { enum: [] }],
    ["anyOf empty", { anyOf: [] }],
    ["pattern unclosed", { type: "string", pattern: "[" }],
    ["minLength string", { type: "string", minLength: "1" }],
    ["minLength negative", { type: "string", minLength: -1 }],
    ["minItems negative", { type: "array", minItems: -1 }],
    ["maxItems negative", { type: "array", maxItems: -1 }],
    ["minimum Infinity", { type: "number", minimum: Number.POSITIVE_INFINITY }],
    [
      "minimum greater than maximum",
      { type: "number", minimum: 5, maximum: 1 },
    ],
    [
      "minItems greater than maxItems",
      { type: "array", minItems: 3, maxItems: 1 },
    ],
  ] as const)("rejects %s", (_label, schema) => {
    expectSchemaReject(schema);
  });

  it("rejects scalar schemas nested under properties", () => {
    expectSchemaReject({
      type: "object",
      properties: { a: true },
    });
  });

  it("rejects scalar schemas nested under items", () => {
    expectSchemaReject({
      type: "array",
      items: false,
    });
  });

  it("rejects scalar schemas nested under anyOf", () => {
    expectSchemaReject({
      anyOf: [true],
    });
  });

  it("rejects scalar schemas nested under additionalProperties", () => {
    // Nested non-object under properties of an additionalProperties schema.
    expectSchemaReject({
      type: "object",
      additionalProperties: { type: "object", properties: { x: 3 } },
    });
  });

  it("rejects boolean schema at root", () => {
    expectSchemaReject(true);
    expectSchemaReject(false);
  });

  it("rejects array schema at root", () => {
    expectSchemaReject([{ type: "string" }]);
  });

  it("rejects nested $schema", () => {
    expectSchemaReject({
      type: "object",
      properties: {
        nested: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "string",
        },
      },
    });
  });

  it("rejects unsupported root $schema dialect", () => {
    expectSchemaReject({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
    });
  });

  it("does not coerce required entries to strings", () => {
    // Production currently String(null) => "null" and accepts. Must reject.
    const error = runSyncFail(
      lowerProviderSchema("openai", {
        type: "object",
        properties: { null: { type: "string" } },
        required: [null],
      }),
    );
    expect((error as { _tag: string })._tag).not.toBeUndefined();
    // If it incorrectly succeeded, fail the assertion via tag check below.
    expect(
      error instanceof SchemaLoweringError ||
        (error as { _tag?: string })._tag === "SchemaLoweringError" ||
        (error as { _tag?: string })._tag === "CanonicalSchemaInvalid",
    ).toBe(true);
  });
});

describe("safe canonical JSON and UTF-8", () => {
  it("preserves own properties.__proto__ through application canonicalizer", () => {
    const schema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"ok":{"type":"number"}},"required":["__proto__","ok"],"additionalProperties":false}',
    ) as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    expect(Object.hasOwn(properties, "__proto__")).toBe(true);

    const bytes = canonicalJsonBytes(schema);
    const text = Array.from(bytes)
      .map((byte) => String.fromCharCode(byte))
      .join("");
    const reparsed = JSON.parse(text) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.hasOwn(reparsed.properties, "__proto__")).toBe(true);
    expect(reparsed.properties.__proto__).toEqual({ type: "string" });
    expect(reparsed.required).toContain("__proto__");
    expect(stringifyCanonicalJson(schema)).toContain('"__proto__"');
  });

  it("preserves constructor and prototype own keys", () => {
    const schema = {
      type: "object",
      properties: {
        constructor: { type: "string" },
        prototype: { type: "number" },
      },
      required: ["constructor", "prototype"],
      additionalProperties: false,
    };
    const text = stringifyCanonicalJson(schema);
    expect(text).toContain('"constructor"');
    expect(text).toContain('"prototype"');
    const reparsed = JSON.parse(text) as {
      properties: Record<string, unknown>;
    };
    expect(Object.hasOwn(reparsed.properties, "constructor")).toBe(true);
    expect(Object.hasOwn(reparsed.properties, "prototype")).toBe(true);
  });

  it("UTF-8 encoder matches fixed BMP and astral plane vectors", () => {
    // Fixed vectors (UTF-8 encodings of the sample strings).
    const vectors: ReadonlyArray<{ sample: string; hex: string }> = [
      { sample: "ascii", hex: "6173636969" },
      // café
      { sample: "caf\u00e9", hex: "636166c3a9" },
      // 日本語
      { sample: "\u65e5\u672c\u8a9e", hex: "e697a5e69cace8aa9e" },
      // musical symbol G clef U+1D11E
      { sample: "\uD834\uDD1E", hex: "f09d849e" },
      // grinning face U+1F600
      { sample: "\uD83D\uDE00", hex: "f09f9880" },
    ];
    for (const vector of vectors) {
      const portable = encodeUtf8(vector.sample);
      const asHex = Array.from(portable)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      expect(asHex).toBe(vector.hex);
    }
  });

  it("UTF-8 encoder does not emit surrogate code-point encodings for lone high", () => {
    const loneHigh = "\uD800";
    const encoded = encodeUtf8(loneHigh);
    // Must not emit the UTF-8 for U+D800 (ed a0 80). U+FFFD is efbfbd.
    const asHex = Array.from(encoded)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(asHex).not.toBe("eda080");
    expect(asHex).toBe("efbfbd");
  });

  it("UTF-8 encoder does not emit surrogate code-point encodings for lone low", () => {
    const loneLow = "\uDC00";
    const encoded = encodeUtf8(loneLow);
    const asHex = Array.from(encoded)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(asHex).not.toBe("edb080");
    expect(asHex).toBe("efbfbd");
  });
});

describe("proto-safe lowering path", () => {
  it("retains properties.__proto__ through lowering and required consistency", () => {
    const schema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"ok":{"type":"number"}},"required":["__proto__","ok"],"additionalProperties":false}',
    ) as unknown;
    const result = runSync(lowerProviderSchema("openai", schema));
    const lowered = result.loweredSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.hasOwn(lowered.properties, "__proto__")).toBe(true);
    expect(lowered.required).toEqual(
      expect.arrayContaining(["__proto__", "ok"]),
    );
    const text = Array.from(result.loweredSchemaBytes)
      .map((byte) => String.fromCharCode(byte))
      .join("");
    expect(text).toContain('"__proto__"');
  });
});
