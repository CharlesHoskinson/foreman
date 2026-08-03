import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  CanonicalSchemaInvalid,
  ConstraintWeakeningError,
  SchemaLoweringError,
  lowerProviderSchema,
  stringifyCanonicalJson,
  verifyCombinedConstraints,
} from "../src/index.js";

const isSchemaReject = (error: unknown): boolean =>
  error instanceof SchemaLoweringError ||
  error instanceof CanonicalSchemaInvalid ||
  (error as { _tag?: string })._tag === "SchemaLoweringError" ||
  (error as { _tag?: string })._tag === "CanonicalSchemaInvalid";

const run = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);

const runFail = <A, E>(effect: Effect.Effect<A, E>): E => {
  const exit = Effect.runSyncExit(effect);
  if (exit._tag === "Failure") {
    const error = exit.cause;
    if (error._tag === "Fail") {
      return error.error;
    }
    throw new Error(`unexpected cause: ${error._tag}`);
  }
  throw new Error("expected failure");
};

describe("provider schema lowering", () => {
  it("rejects unknown structural keywords fail-closed", () => {
    const error = runFail(
      lowerProviderSchema("openai", {
        type: "object",
        properties: {},
        fooBar: true,
      }),
    );
    expect(isSchemaReject(error)).toBe(true);
    expect((error as { reason?: string }).reason ?? "").toContain(
      "unknown structural",
    );
  });

  it("rejects $ref, oneOf, allOf, and not", () => {
    for (const keyword of ["$ref", "oneOf", "allOf", "not"] as const) {
      const schema =
        keyword === "$ref"
          ? { $ref: "#/definitions/x" }
          : { [keyword]: [{ type: "string" }] };
      const error = runFail(lowerProviderSchema("xai", schema));
      expect(isSchemaReject(error)).toBe(true);
      expect((error as { reason?: string }).reason ?? "").toContain(keyword);
    }
  });

  it("anthropic removes root $schema and converts const to enum with receipts", () => {
    const canonical = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: {
        status: { const: "ready", type: "string" },
      },
    };
    const result = run(lowerProviderSchema("anthropic", canonical));
    expect(result.loweredSchema).toEqual({
      additionalProperties: false,
      properties: {
        status: {
          enum: ["ready"],
          type: "string",
        },
      },
      required: ["status"],
      type: "object",
    });
    expect(
      result.transformations.some(
        (entry) =>
          entry.kind === "annotation_removed" && entry.keyword === "$schema",
      ),
    ).toBe(true);
    expect(
      result.transformations.some(
        (entry) => entry.kind === "const_to_enum" && entry.keyword === "const",
      ),
    ).toBe(true);
    expect(result.constraintReceipts).toEqual([]);
    expect(
      stringifyCanonicalJson(
        (result.loweredSchema as { properties: { status: unknown } }).properties
          .status,
      ),
    ).toContain("ready");
  });

  it("xai/google/openai preserve semantic keywords and required array order", () => {
    const canonical = {
      type: "object",
      required: ["b", "a"],
      properties: {
        b: { type: "number", minimum: 1 },
        a: { type: "string", const: "x" },
      },
      additionalProperties: false,
    };
    for (const family of ["xai", "google", "openai"] as const) {
      const result = run(lowerProviderSchema(family, canonical));
      const lowered = result.loweredSchema as {
        properties: { a: { const: string } };
        required: string[];
      };
      expect(lowered.properties.a.const).toBe("x");
      // Canonical JSON sorts object keys only; required array order is preserved.
      expect(lowered.required).toEqual(["b", "a"]);
      expect(result.constraintReceipts).toEqual([]);
    }
  });

  it("rejects inline anthropic variants larger than 32768 UTF-8 bytes", () => {
    const huge = "x".repeat(33_000);
    const error = runFail(
      lowerProviderSchema("anthropic", {
        type: "object",
        properties: {
          blob: { type: "string", const: huge },
        },
      }),
    );
    expect(error).toBeInstanceOf(SchemaLoweringError);
    expect((error as SchemaLoweringError).reason).toContain("32768");
  });

  it("rejects constraint weakening without a host receipt", () => {
    const error = runFail(
      verifyCombinedConstraints(
        {
          type: "object",
          required: ["status"],
          properties: { status: { type: "string" } },
        },
        {
          type: "object",
          required: [],
          properties: { status: { type: "string" } },
        },
        [],
      ),
    );
    expect(error).toBeInstanceOf(ConstraintWeakeningError);
  });

  it("rejects type: dragon and type: 42", () => {
    for (const schema of [{ type: "dragon" }, { type: 42 }]) {
      const error = runFail(lowerProviderSchema("openai", schema));
      expect(isSchemaReject(error)).toBe(true);
    }
  });

  it("rejects required coercion and duplicate required entries", () => {
    const coerced = runFail(
      lowerProviderSchema("openai", {
        type: "object",
        required: [null, 3],
        properties: {},
      }),
    );
    expect(isSchemaReject(coerced)).toBe(true);
    const dup = runFail(
      lowerProviderSchema("openai", {
        type: "object",
        required: ["x", "x"],
        properties: { x: { type: "string" } },
      }),
    );
    expect(isSchemaReject(dup)).toBe(true);
  });

  it("rejects invalid pattern and negative bounds", () => {
    expect(
      isSchemaReject(
        runFail(
          lowerProviderSchema("openai", { type: "string", pattern: "[" }),
        ),
      ),
    ).toBe(true);
    expect(
      isSchemaReject(
        runFail(
          lowerProviderSchema("openai", { type: "string", minLength: -1 }),
        ),
      ),
    ).toBe(true);
    expect(
      isSchemaReject(
        runFail(
          lowerProviderSchema("openai", {
            type: "number",
            minimum: 10,
            maximum: 1,
          }),
        ),
      ),
    ).toBe(true);
  });
});
