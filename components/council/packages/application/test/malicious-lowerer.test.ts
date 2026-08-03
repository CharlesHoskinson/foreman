import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

const requireEntry = <T>(
  items: readonly T[],
  index: number,
  label: string,
): T => {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`missing fixture ${label} at ${String(index)}`);
  }
  return value;
};

import {
  ConstraintWeakeningError,
  lowerProviderSchema,
  type ConstraintReceipt,
  type SchemaTransformation,
} from "../src/index.js";
import {
  buildLayer,
  bytesById,
  defaultArtifacts,
  emptyLog,
  encodeUtf8Text,
  extractFail,
  makeArtifact,
  makeContract,
  runCompileExit,
  sha256Hex,
} from "./test-helpers.js";

const emptyReceipts: readonly ConstraintReceipt[] = [];
const emptyTransforms: readonly SchemaTransformation[] = [];

const maliciousLower = (
  loweredSchema: unknown,
  loweredSchemaBytes: Uint8Array,
  options: {
    readonly transformations?: readonly SchemaTransformation[];
    readonly constraintReceipts?: readonly ConstraintReceipt[];
  } = {},
) =>
  Effect.succeed({
    loweredSchema,
    loweredSchemaBytes,
    transformations: options.transformations ?? emptyTransforms,
    constraintReceipts: options.constraintReceipts ?? emptyReceipts,
  });

describe("independent lowering verification", () => {
  it("rejects const value change from approved to rejected", async () => {
    const log = emptyLog();
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({
        log,
        lowerer: () => {
          const schema = {
            type: "object",
            additionalProperties: false,
            required: ["status", "nonce"],
            properties: {
              status: { type: "string", const: "rejected" },
              nonce: { type: "string", minLength: 1 },
            },
          };
          return maliciousLower(schema, encodeUtf8Text(JSON.stringify(schema)));
        },
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(log.materializer).toBe(0);
  });

  it("rejects additionalProperties false changed to true", async () => {
    const log = emptyLog();
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({
        log,
        lowerer: () => {
          const schema = {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            additionalProperties: true,
            required: ["status", "nonce"],
            properties: {
              status: { type: "string", const: "ready" },
              nonce: { type: "string", minLength: 1 },
            },
          };
          return maliciousLower(schema, encodeUtf8Text(JSON.stringify(schema)));
        },
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(log.materializer).toBe(0);
    expect(extractFail(exit)).toBeInstanceOf(ConstraintWeakeningError);
  });

  it("rejects schema-valued additionalProperties changed to true", async () => {
    const log = emptyLog();
    const schemaObject = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: { type: "string" },
      required: ["status"],
      properties: {
        status: { type: "string", const: "ready" },
      },
    };
    const schemaBytes = encodeUtf8Text(JSON.stringify(schemaObject));
    const digest = sha256Hex(schemaBytes);
    const schemaId = `sha256:${digest}`;
    const artifacts = [
      requireEntry(defaultArtifacts, 0, "artifact"),
      requireEntry(defaultArtifacts, 1, "artifact"),
      makeArtifact(
        "response-schema",
        "application/json",
        schemaBytes,
        digest,
        schemaId,
      ),
      requireEntry(defaultArtifacts, 3, "artifact"),
    ];
    const store = bytesById();
    store.set(schemaId, schemaBytes);
    const exit = await runCompileExit(
      makeContract({
        artifacts,
        responseSchemaArtifactId: schemaId,
      }),
      "openai",
      buildLayer({
        log,
        bytes: store,
        lowerer: () => {
          const weakened = {
            ...schemaObject,
            additionalProperties: true,
          };
          return maliciousLower(
            weakened,
            encodeUtf8Text(JSON.stringify(weakened)),
          );
        },
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(log.materializer).toBe(0);
  });

  it("rejects extra property under a closed object", async () => {
    const log = emptyLog();
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({
        log,
        lowerer: () => {
          const schema = {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            additionalProperties: false,
            required: ["status", "nonce"],
            properties: {
              status: { type: "string", const: "ready" },
              nonce: { type: "string", minLength: 1 },
              injected: { type: "string" },
            },
          };
          return maliciousLower(schema, encodeUtf8Text(JSON.stringify(schema)));
        },
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(log.materializer).toBe(0);
  });

  it("rejects missing __proto__ property", async () => {
    const log = emptyLog();
    const artifactText =
      '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["__proto__","status"],"properties":{"__proto__":{"type":"string"},"status":{"type":"string","const":"ready"}}}';
    const schemaBytes = encodeUtf8Text(artifactText);
    const digest = sha256Hex(schemaBytes);
    const schemaId = `sha256:${digest}`;
    const artifacts = [
      requireEntry(defaultArtifacts, 0, "artifact"),
      requireEntry(defaultArtifacts, 1, "artifact"),
      makeArtifact(
        "response-schema",
        "application/json",
        schemaBytes,
        digest,
        schemaId,
      ),
      requireEntry(defaultArtifacts, 3, "artifact"),
    ];
    const store = bytesById();
    store.set(schemaId, schemaBytes);
    const exit = await runCompileExit(
      makeContract({
        artifacts,
        responseSchemaArtifactId: schemaId,
      }),
      "openai",
      buildLayer({
        log,
        bytes: store,
        lowerer: () => {
          const weakened = {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            additionalProperties: false,
            required: ["__proto__", "status"],
            properties: {
              status: { type: "string", const: "ready" },
            },
          };
          return maliciousLower(
            weakened,
            encodeUtf8Text(JSON.stringify(weakened)),
          );
        },
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(log.materializer).toBe(0);
  });

  it("rejects fabricated host-validation receipt", async () => {
    const log = emptyLog();
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({
        log,
        lowerer: () => {
          const schema = {
            type: "object",
            additionalProperties: true,
            required: ["status", "nonce"],
            properties: {
              status: { type: "string", const: "ready" },
              nonce: { type: "string", minLength: 1 },
            },
          };
          return maliciousLower(
            schema,
            encodeUtf8Text(JSON.stringify(schema)),
            {
              constraintReceipts: [
                {
                  path: "",
                  weakenedConstraint: "additionalProperties",
                  hostValidation: "trust me",
                },
              ],
            },
          );
        },
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(log.materializer).toBe(0);
  });

  it("rejects blank host-validation receipt authorizing weakening", async () => {
    const log = emptyLog();
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({
        log,
        lowerer: () => {
          const schema = {
            type: "object",
            additionalProperties: true,
            required: [],
            properties: {},
          };
          return maliciousLower(
            schema,
            encodeUtf8Text(JSON.stringify(schema)),
            {
              constraintReceipts: [
                {
                  path: "",
                  weakenedConstraint: "additionalProperties",
                  hostValidation: "",
                },
              ],
            },
          );
        },
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(log.materializer).toBe(0);
  });

  it("rejects weakened schema object with unrelated bytes", async () => {
    const log = emptyLog();
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({
        log,
        lowerer: () => maliciousLower({ type: "object" }, encodeUtf8Text("{}")),
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(log.materializer).toBe(0);
  });

  it("rejects correct schema with incorrect bytes", async () => {
    const log = emptyLog();
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({
        log,
        lowerer: (input) =>
          Effect.gen(function* () {
            const real = yield* lowerProviderSchema(
              input.providerFamily,
              input.canonicalSchema,
            );
            return {
              loweredSchema: real.loweredSchema,
              loweredSchemaBytes: encodeUtf8Text('{"tampered":true}'),
              transformations: real.transformations,
              constraintReceipts: real.constraintReceipts,
            };
          }),
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(log.materializer).toBe(0);
  });

  it("rejects unsupported lowered keyword", async () => {
    const log = emptyLog();
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({
        log,
        lowerer: () => {
          const schema = {
            type: "object",
            additionalProperties: false,
            required: ["status", "nonce"],
            properties: {
              status: { type: "string", const: "ready" },
              nonce: { type: "string", minLength: 1 },
            },
            oneOf: [{ type: "object" }],
          };
          return maliciousLower(schema, encodeUtf8Text(JSON.stringify(schema)));
        },
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(log.materializer).toBe(0);
  });
});
