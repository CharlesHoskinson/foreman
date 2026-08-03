import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  ConstraintWeakeningError,
  SchemaLoweringError,
  CanonicalSchemaInvalid,
  lowerProviderSchema,
  verifyLoweringIndependently,
  canonicalJsonBytes,
  type SchemaTransformation,
} from "../src/index.js";
import {
  encodeUtf8Text,
  extractFail,
  responseSchemaObject,
} from "./test-helpers.js";

const isTyped = (error: unknown): boolean =>
  error instanceof ConstraintWeakeningError ||
  error instanceof SchemaLoweringError ||
  error instanceof CanonicalSchemaInvalid ||
  (error as { _tag?: string })._tag === "ConstraintWeakeningError" ||
  (error as { _tag?: string })._tag === "SchemaLoweringError" ||
  (error as { _tag?: string })._tag === "CanonicalSchemaInvalid";

const requireFail = <A, E>(effect: Effect.Effect<A, E>): E => {
  const exit = Effect.runSyncExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(exit.cause._tag).toBe("Fail");
    const error = extractFail(exit);
    expect(isTyped(error)).toBe(true);
    return error;
  }
  throw new Error("expected Fail");
};

const maliciousLower = (
  loweredSchema: unknown,
  loweredSchemaBytes: Uint8Array,
  options: {
    readonly transformations?: readonly SchemaTransformation[];
    readonly constraintReceipts?: readonly unknown[];
  } = {},
) =>
  Effect.succeed({
    loweredSchema,
    loweredSchemaBytes,
    transformations: options.transformations ?? [],
    constraintReceipts: (options.constraintReceipts ?? []) as never,
  });

const trustedLowered = (family: "openai" | "anthropic" | "xai" | "google") =>
  Effect.runSync(lowerProviderSchema(family, responseSchemaObject));

const titleFixture = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "GuaranteedTitle",
  description: "GuaranteedDescription",
  properties: {},
  additionalProperties: false,
};

describe("exact provider-lowering boundary", () => {
  it("rejects a transformation at a nonexistent path", () => {
    const trusted = trustedLowered("openai");
    requireFail(
      verifyLoweringIndependently("openai", responseSchemaObject, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: [
          {
            path: "/ghost",
            kind: "annotation_removed",
            keyword: "title",
            detail: "annotation 'title' removed; not a semantic constraint",
          },
        ],
        constraintReceipts: [],
      }),
    );
  });

  it("rejects duplicate accurate-looking transformations", () => {
    const trusted = Effect.runSync(lowerProviderSchema("openai", titleFixture));
    const titleRemoval = trusted.transformations.find(
      (entry) =>
        entry.kind === "annotation_removed" && entry.keyword === "title",
    );
    expect(titleRemoval).toBeDefined();
    if (titleRemoval === undefined) throw new Error("title removal is missing");
    requireFail(
      verifyLoweringIndependently("openai", titleFixture, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: [titleRemoval, titleRemoval],
        constraintReceipts: [],
      }),
    );
  });

  it("rejects an extra key-order transformation", () => {
    const trusted = trustedLowered("openai");
    requireFail(
      verifyLoweringIndependently("openai", responseSchemaObject, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: [
          ...trusted.transformations,
          {
            path: "",
            kind: "key_order_canonicalized",
            keyword: "(order)",
            detail: "object key order canonicalized for stable bytes",
          },
        ],
        constraintReceipts: [],
      }),
    );
  });

  it("rejects annotation-removal when the annotation remains", () => {
    const canonical = {
      type: "object",
      title: "KeepMe",
      properties: {},
      additionalProperties: false,
    };
    const lowered = {
      type: "object",
      title: "KeepMe",
      properties: {},
      additionalProperties: false,
    };
    requireFail(
      verifyLoweringIndependently("openai", canonical, {
        loweredSchema: lowered,
        loweredSchemaBytes: canonicalJsonBytes(lowered),
        transformations: [
          {
            path: "",
            kind: "annotation_removed",
            keyword: "title",
            detail: "annotation 'title' removed; not a semantic constraint",
          },
        ],
        constraintReceipts: [],
      }),
    );
  });

  it("rejects transformation with wrong keyword", () => {
    const canonical = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { status: { type: "string", const: "ready" } },
      additionalProperties: false,
    };
    const trusted = Effect.runSync(lowerProviderSchema("anthropic", canonical));
    const bad = trusted.transformations.map((entry) =>
      entry.kind === "const_to_enum"
        ? {
            ...entry,
            keyword: "enum",
          }
        : entry,
    );
    requireFail(
      verifyLoweringIndependently("anthropic", canonical, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: bad,
        constraintReceipts: [],
      }),
    );
  });

  it("rejects transformation with wrong detail", () => {
    const canonical = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { status: { type: "string", const: "ready" } },
      additionalProperties: false,
    };
    const trusted = Effect.runSync(lowerProviderSchema("anthropic", canonical));
    const bad = trusted.transformations.map((entry) =>
      entry.kind === "const_to_enum"
        ? {
            ...entry,
            detail: "wrong detail text",
          }
        : entry,
    );
    requireFail(
      verifyLoweringIndependently("anthropic", canonical, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: bad,
        constraintReceipts: [],
      }),
    );
  });

  it("uses exact RFC 6901 escaped path for property names with ~ and /", () => {
    const propName = "a~/b";
    const escaped = "a~0~1b";
    const canonical = {
      type: "object",
      title: "root",
      properties: {
        [propName]: { type: "string", title: "child" },
      },
      additionalProperties: false,
    };
    const trusted = Effect.runSync(lowerProviderSchema("openai", canonical));
    const childRemoval = trusted.transformations.find(
      (entry) =>
        entry.kind === "annotation_removed" &&
        entry.keyword === "title" &&
        entry.path.includes(escaped),
    );
    expect(childRemoval).toBeDefined();
    if (childRemoval === undefined) throw new Error("child removal is missing");
    expect(childRemoval.path).toBe(`/properties/${escaped}`);
  });

  it("rejects fabricated additionalProperties", () => {
    const openCanon = {
      type: "object",
      properties: { a: { type: "string" } },
    };
    const closed = {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    };
    requireFail(
      verifyLoweringIndependently("openai", openCanon, {
        loweredSchema: closed,
        loweredSchemaBytes: canonicalJsonBytes(closed),
        transformations: [],
        constraintReceipts: [],
      }),
    );
  });

  it("rejects fabricated const", () => {
    const canonical = { type: "string" };
    const withConst = { type: "string", const: "x" };
    requireFail(
      verifyLoweringIndependently("openai", canonical, {
        loweredSchema: withConst,
        loweredSchemaBytes: canonicalJsonBytes(withConst),
        transformations: [],
        constraintReceipts: [],
      }),
    );
  });

  it("rejects fabricated enum", () => {
    const canonical = { type: "string" };
    const withEnum = { type: "string", enum: ["a"] };
    requireFail(
      verifyLoweringIndependently("openai", canonical, {
        loweredSchema: withEnum,
        loweredSchemaBytes: canonicalJsonBytes(withEnum),
        transformations: [],
        constraintReceipts: [],
      }),
    );
  });

  it("rejects non-array constraint receipts without TypeError defect", () => {
    const trusted = trustedLowered("openai");
    requireFail(
      verifyLoweringIndependently("openai", responseSchemaObject, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: trusted.transformations,
        constraintReceipts: { not: "array" } as never,
      }),
    );
  });

  it("rejects string non-array transformations without TypeError defect", () => {
    const trusted = trustedLowered("openai");
    requireFail(
      verifyLoweringIndependently("openai", responseSchemaObject, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: "nope" as never,
        constraintReceipts: [],
      }),
    );
  });

  it("rejects object non-array transformations without TypeError defect", () => {
    const trusted = trustedLowered("openai");
    requireFail(
      verifyLoweringIndependently("openai", responseSchemaObject, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: { path: "", kind: "annotation_removed" } as never,
        constraintReceipts: [],
      }),
    );
  });

  it("rejects null non-array transformations without TypeError defect", () => {
    const trusted = trustedLowered("openai");
    requireFail(
      verifyLoweringIndependently("openai", responseSchemaObject, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: null as never,
        constraintReceipts: [],
      }),
    );
  });

  it("rejects null transformation entry without TypeError defect", () => {
    const trusted = trustedLowered("openai");
    requireFail(
      verifyLoweringIndependently("openai", responseSchemaObject, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: [null] as never,
        constraintReceipts: [],
      }),
    );
  });

  it("rejects sparse transformations array", () => {
    const trusted = trustedLowered("openai");
    const sparse: unknown[] = [];
    sparse[0] = {
      path: "",
      kind: "key_order_canonicalized",
      keyword: "(order)",
      detail: "object key order canonicalized for stable bytes",
    };
    sparse[2] = sparse[0];
    Object.defineProperty(sparse, "length", { value: 3 });
    requireFail(
      verifyLoweringIndependently("openai", responseSchemaObject, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: sparse as never,
        constraintReceipts: [],
      }),
    );
  });

  it("rejects transformation record with extra field on guaranteed annotation removal", () => {
    const trusted = Effect.runSync(lowerProviderSchema("openai", titleFixture));
    const titleRemoval = trusted.transformations.find(
      (entry) =>
        entry.kind === "annotation_removed" && entry.keyword === "title",
    );
    expect(titleRemoval).toBeDefined();
    const withExtra = trusted.transformations.map((entry) =>
      entry === titleRemoval ? { ...entry, extra: "nope" } : entry,
    );
    requireFail(
      verifyLoweringIndependently("openai", titleFixture, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: withExtra as never,
        constraintReceipts: [],
      }),
    );
  });

  it("rejects byte-container impostor (indexed object matching genuine length)", () => {
    const trusted = trustedLowered("openai");
    const genuine = trusted.loweredSchemaBytes;
    const impostor: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (let i = 0; i < genuine.byteLength; i += 1) {
      impostor[String(i)] = genuine[i];
    }
    Object.defineProperty(impostor, "byteLength", {
      value: genuine.byteLength,
      enumerable: false,
    });
    Object.defineProperty(impostor, "length", {
      value: genuine.byteLength,
      enumerable: false,
    });
    requireFail(
      verifyLoweringIndependently("openai", responseSchemaObject, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: impostor as never,
        transformations: trusted.transformations,
        constraintReceipts: [],
      }),
    );
  });

  it("rejects genuine Uint8Array with one wrong byte", () => {
    const trusted = trustedLowered("openai");
    const bad = new Uint8Array(trusted.loweredSchemaBytes);
    bad[0] = (bad[0] ?? 0) ^ 0xff;
    requireFail(
      verifyLoweringIndependently("openai", responseSchemaObject, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: bad,
        transformations: trusted.transformations,
        constraintReceipts: [],
      }),
    );
  });

  it("rejects correct transformations in the wrong order", () => {
    const trusted = Effect.runSync(lowerProviderSchema("openai", titleFixture));
    expect(trusted.transformations.length).toBeGreaterThan(1);
    const reversed = [...trusted.transformations].reverse();
    requireFail(
      verifyLoweringIndependently("openai", titleFixture, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: reversed,
        constraintReceipts: [],
      }),
    );
  });

  it("rejects reordered required arrays from a replacement lowerer", () => {
    const canonical = {
      type: "object",
      required: ["b", "a"],
      properties: {
        a: { type: "string" },
        b: { type: "string" },
      },
      additionalProperties: false,
    };
    const reordered = {
      additionalProperties: false,
      properties: {
        a: { type: "string" },
        b: { type: "string" },
      },
      required: ["a", "b"],
      type: "object",
    };
    requireFail(
      verifyLoweringIndependently("openai", canonical, {
        loweredSchema: reordered,
        loweredSchemaBytes: canonicalJsonBytes(reordered),
        transformations: [],
        constraintReceipts: [],
      }),
    );
  });

  it("rejects reordered enum arrays from a replacement lowerer", () => {
    const canonical = { type: "string", enum: ["z", "a", "m"] };
    const reordered = { type: "string", enum: ["a", "m", "z"] };
    requireFail(
      verifyLoweringIndependently("openai", canonical, {
        loweredSchema: reordered,
        loweredSchemaBytes: canonicalJsonBytes(reordered),
        transformations: [],
        constraintReceipts: [],
      }),
    );
  });

  it("built-in lowerer preserves required array order", () => {
    const result = Effect.runSync(
      lowerProviderSchema("openai", {
        type: "object",
        required: ["b", "a"],
        properties: {
          a: { type: "string" },
          b: { type: "string" },
        },
        additionalProperties: false,
      }),
    );
    expect((result.loweredSchema as { required: string[] }).required).toEqual([
      "b",
      "a",
    ]);
  });

  it("rejects Date as non-plain lowered schema", () => {
    requireFail(
      verifyLoweringIndependently("openai", responseSchemaObject, {
        loweredSchema: new Date(),
        loweredSchemaBytes: encodeUtf8Text("{}"),
        transformations: [],
        constraintReceipts: [],
      }),
    );
  });

  it("requires both annotation_removed and key_order_canonicalized when both apply", () => {
    // Canonical keys intentionally non-canonical order so both title removal
    // and key-order canonicalization records are required.
    const canonical = {
      title: "T",
      type: "object",
      additionalProperties: false,
      properties: {},
    };
    const trusted = Effect.runSync(lowerProviderSchema("openai", canonical));
    const kinds = trusted.transformations.map((t) => t.kind);
    expect(kinds).toContain("annotation_removed");
    // When retained keys match but enumeration order differs, key-order record
    // must also be present independently of the annotation removal.
    expect(kinds).toContain("key_order_canonicalized");
    // Order: local annotation then key-order (or as specified by production).
    const annIdx = kinds.indexOf("annotation_removed");
    const orderIdx = kinds.indexOf("key_order_canonicalized");
    expect(annIdx).toBeGreaterThanOrEqual(0);
    expect(orderIdx).toBeGreaterThanOrEqual(0);

    // Dropping the key-order record while keeping annotation removal must fail.
    const withoutOrder = trusted.transformations.filter(
      (t) => t.kind !== "key_order_canonicalized",
    );
    if (
      trusted.transformations.some((t) => t.kind === "key_order_canonicalized")
    ) {
      requireFail(
        verifyLoweringIndependently("openai", canonical, {
          loweredSchema: trusted.loweredSchema,
          loweredSchemaBytes: trusted.loweredSchemaBytes,
          transformations: withoutOrder,
          constraintReceipts: [],
        }),
      );
    }
  });

  it("requires both const_to_enum and key_order_canonicalized when both apply for anthropic", () => {
    const canonical = {
      type: "object",
      properties: {
        status: { type: "string", const: "ready" },
      },
      // Non-canonical key order at root
      additionalProperties: false,
      required: ["status"],
    };
    const trusted = Effect.runSync(lowerProviderSchema("anthropic", canonical));
    const kinds = trusted.transformations.map((t) => t.kind);
    expect(kinds).toContain("const_to_enum");
    // Independent key-order when retained key values match but order differs.
    if (kinds.includes("key_order_canonicalized")) {
      const withoutOrder = trusted.transformations.filter(
        (t) => t.kind !== "key_order_canonicalized",
      );
      requireFail(
        verifyLoweringIndependently("anthropic", canonical, {
          loweredSchema: trusted.loweredSchema,
          loweredSchemaBytes: trusted.loweredSchemaBytes,
          transformations: withoutOrder,
          constraintReceipts: [],
        }),
      );
    } else {
      // B production may suppress key_order when another local transform exists.
      // That is a release blocker: require the independent key-order record.
      expect(kinds).toContain("key_order_canonicalized");
    }
  });

  it("rejects inaccurate transformation record path for existing annotation", () => {
    const trusted = Effect.runSync(lowerProviderSchema("openai", titleFixture));
    const titleRemoval = trusted.transformations.find(
      (entry) =>
        entry.kind === "annotation_removed" && entry.keyword === "title",
    );
    expect(titleRemoval).toBeDefined();
    const inaccurate = trusted.transformations.map((entry) =>
      entry === titleRemoval ? { ...entry, path: "/properties/nope" } : entry,
    );
    requireFail(
      verifyLoweringIndependently("openai", titleFixture, {
        loweredSchema: trusted.loweredSchema,
        loweredSchemaBytes: trusted.loweredSchemaBytes,
        transformations: inaccurate,
        constraintReceipts: [],
      }),
    );
  });

  // Keep maliciousLower referenced for compile-sequence layering parity.
  void maliciousLower;
});
