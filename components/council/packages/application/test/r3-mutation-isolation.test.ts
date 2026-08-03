import { describe, expect, it } from "vitest";
import { Effect, Exit, Layer } from "effect";
import type { Sha256Digest } from "@council/schema";
import {
  ArtifactMissing,
  ArtifactReader,
  BundleVerifier,
  compileReviewPrompt,
  Digest,
  lowerProviderSchema,
  PromptMaterializer,
  type PromptMaterializerInput,
  ProviderSchemaLowerer,
  SchemaLoweringError,
  ConstraintWeakeningError,
  CanonicalSchemaInvalid,
  ArtifactReadError,
  PromptMaterializationError,
} from "../src/index.js";
import {
  bytesById,
  emptyLog,
  encodeUtf8Text,
  extractFail,
  makeContract,
  materializePromptBytesLocal,
  responseSchemaObject,
  sha256Hex,
} from "./test-helpers.js";

const isTypedBoundary = (error: unknown): boolean => {
  const tag = (error as { _tag?: string } | null)?._tag;
  return (
    error instanceof SchemaLoweringError ||
    error instanceof ConstraintWeakeningError ||
    error instanceof CanonicalSchemaInvalid ||
    error instanceof ArtifactReadError ||
    error instanceof ArtifactMissing ||
    error instanceof PromptMaterializationError ||
    tag === "SchemaLoweringError" ||
    tag === "ConstraintWeakeningError" ||
    tag === "CanonicalSchemaInvalid" ||
    tag === "ArtifactReadError" ||
    tag === "ArtifactMissing" ||
    tag === "PromptMaterializationError" ||
    tag === "ArtifactLengthMismatch" ||
    tag === "ArtifactDigestMismatch" ||
    tag === "DigestError"
  );
};

/** Dense indexed object with genuine length and matching byte values. */
const denseByteImpostor = (source: Uint8Array): Record<string, unknown> => {
  const impostor: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (let i = 0; i < source.byteLength; i += 1) {
    impostor[String(i)] = source[i];
  }
  Object.defineProperty(impostor, "byteLength", {
    value: source.byteLength,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(impostor, "length", {
    value: source.byteLength,
    enumerable: false,
    configurable: true,
  });
  return impostor;
};

describe("mutable-reference isolation", () => {
  it("bundle mutation cannot change later diff identity", async () => {
    const contract = makeContract();
    const originalDiff = (contract.bundle as { diffSha256: string }).diffSha256;
    let sawMutated = false;
    const log = emptyLog();
    const layer = Layer.mergeAll(
      Layer.succeed(ArtifactReader, {
        read: (request) => {
          log.reader.push(request.descriptor.artifactId);
          return Effect.succeed(
            (
              bytesById().get(request.descriptor.artifactId) ?? new Uint8Array()
            ).slice(),
          );
        },
      }),
      Layer.succeed(BundleVerifier, {
        verify: (bundle) =>
          Effect.sync(() => {
            log.bundle += 1;
            (bundle as { diffSha256: string }).diffSha256 = "ff".repeat(32);
            sawMutated = true;
          }),
      }),
      Layer.succeed(Digest, {
        sha256: (bytes) => Effect.succeed(sha256Hex(bytes) as Sha256Digest),
      }),
      Layer.succeed(PromptMaterializer, {
        materialize: (input) => {
          log.materializer += 1;
          return Effect.succeed(materializePromptBytesLocal(input));
        },
      }),
      Layer.succeed(ProviderSchemaLowerer, {
        lower: (input) => {
          log.lowerer += 1;
          return lowerProviderSchema(
            input.providerFamily,
            input.canonicalSchema,
          );
        },
      }),
    );
    const exit = await Effect.runPromiseExit(
      compileReviewPrompt({ contract, providerFamily: "openai" }).pipe(
        Effect.provide(layer),
      ),
    );
    expect(sawMutated).toBe(true);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect((contract.bundle as { diffSha256: string }).diffSha256).toBe(
      originalDiff,
    );
    expect(log.materializer).toBe(1);
  });

  it("reader mutation of descriptor cannot change trusted descriptor fields", async () => {
    let mutatedAlias = "";
    const layer = Layer.mergeAll(
      Layer.succeed(ArtifactReader, {
        read: (request) =>
          Effect.sync(() => {
            const desc = request.descriptor as {
              alias: string;
              artifactId: string;
            };
            mutatedAlias = desc.alias;
            desc.alias = "MUTATED_ALIAS";
            const bytes = bytesById().get(desc.artifactId);
            if (bytes === undefined) {
              throw new ArtifactMissing({
                stage: "artifact_read",
                reason: "missing",
                artifactId: desc.artifactId,
              });
            }
            return bytes.slice();
          }),
      }),
      Layer.succeed(BundleVerifier, {
        verify: () => Effect.void,
      }),
      Layer.succeed(Digest, {
        sha256: (bytes) => Effect.succeed(sha256Hex(bytes) as Sha256Digest),
      }),
      Layer.succeed(PromptMaterializer, {
        materialize: (input) => {
          for (const item of input.untrustedEvidence) {
            expect(item.alias).not.toBe("MUTATED_ALIAS");
          }
          return Effect.succeed(materializePromptBytesLocal(input));
        },
      }),
      Layer.succeed(ProviderSchemaLowerer, {
        lower: (input) =>
          lowerProviderSchema(input.providerFamily, input.canonicalSchema),
      }),
    );
    const exit = await Effect.runPromiseExit(
      compileReviewPrompt({
        contract: makeContract(),
        providerFamily: "openai",
      }).pipe(Effect.provide(layer)),
    );
    expect(mutatedAlias.length).toBeGreaterThan(0);
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("digest mutation of input bytes cannot change retained artifact bytes or later evidence", async () => {
    const log = emptyLog();
    const retainedSnapshots: Uint8Array[] = [];
    const layer = Layer.mergeAll(
      Layer.succeed(ArtifactReader, {
        read: (request) =>
          Effect.sync(() => {
            log.reader.push(request.descriptor.artifactId);
            const source =
              bytesById().get(request.descriptor.artifactId) ??
              new Uint8Array();
            const copy = source.slice();
            retainedSnapshots.push(copy);
            return copy;
          }),
      }),
      Layer.succeed(BundleVerifier, {
        verify: () => {
          log.bundle += 1;
          return Effect.void;
        },
      }),
      Layer.succeed(Digest, {
        sha256: (bytes) =>
          Effect.sync(() => {
            // Compute the correct digest from the supplied buffer first.
            const honest = sha256Hex(bytes) as Sha256Digest;
            // Mutate only the byte copy supplied to the digest port.
            for (let i = 0; i < bytes.byteLength; i += 1) {
              bytes[i] = 0;
            }
            // Return the pre-mutation digest so isolation succeeds when the
            // application retains independent copies for later evidence.
            return honest;
          }),
      }),
      Layer.succeed(PromptMaterializer, {
        materialize: (input) => {
          log.materializer += 1;
          // Retained evidence content must not be all zeros after digest mutation.
          for (const item of input.untrustedEvidence) {
            if (item.contentEncoding === "utf8") {
              expect(item.content.length).toBeGreaterThan(0);
              expect(item.content).not.toBe(
                "\u0000".repeat(item.content.length),
              );
            }
          }
          return Effect.succeed(materializePromptBytesLocal(input));
        },
      }),
      Layer.succeed(ProviderSchemaLowerer, {
        lower: (input) => {
          log.lowerer += 1;
          return lowerProviderSchema(
            input.providerFamily,
            input.canonicalSchema,
          );
        },
      }),
    );
    const exit = await Effect.runPromiseExit(
      compileReviewPrompt({
        contract: makeContract(),
        providerFamily: "openai",
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(log.materializer).toBe(1);
    expect(log.lowerer).toBe(1);
    expect(log.reader.length).toBeGreaterThan(0);
    // Snapshots taken at read time remain non-zero (reader returned real bytes).
    for (const snap of retainedSnapshots) {
      const allZero = snap.every((b) => b === 0);
      expect(allZero).toBe(false);
    }
  });

  it("lowerer mutation of a private copy still returns honest pre-mutation lowering", async () => {
    let mutated = false;
    const log = emptyLog();
    const layer = Layer.mergeAll(
      Layer.succeed(ArtifactReader, {
        read: (request) => {
          log.reader.push(request.descriptor.artifactId);
          return Effect.succeed(
            (
              bytesById().get(request.descriptor.artifactId) ?? new Uint8Array()
            ).slice(),
          );
        },
      }),
      Layer.succeed(BundleVerifier, {
        verify: () => {
          log.bundle += 1;
          return Effect.void;
        },
      }),
      Layer.succeed(Digest, {
        sha256: (bytes) => Effect.succeed(sha256Hex(bytes) as Sha256Digest),
      }),
      Layer.succeed(PromptMaterializer, {
        materialize: (input) => {
          log.materializer += 1;
          return Effect.succeed(materializePromptBytesLocal(input));
        },
      }),
      Layer.succeed(ProviderSchemaLowerer, {
        lower: (input) =>
          Effect.gen(function* () {
            log.lowerer += 1;
            // Compute honest lowering from the supplied pre-mutation value.
            const honest = yield* lowerProviderSchema(
              input.providerFamily,
              input.canonicalSchema,
            );
            const schema = input.canonicalSchema as {
              type?: string;
              properties?: Record<string, unknown>;
            };
            if (schema.properties !== undefined) {
              schema.properties.__injected = { type: "string" };
              mutated = true;
            }
            if (input.canonicalSchemaBytes.byteLength > 0) {
              input.canonicalSchemaBytes[0] = 0;
            }
            // Return the honest pre-mutation result (isolation proof).
            return honest;
          }),
      }),
    );
    const exit = await Effect.runPromiseExit(
      compileReviewPrompt({
        contract: makeContract(),
        providerFamily: "openai",
      }).pipe(Effect.provide(layer)),
    );
    expect(mutated).toBe(true);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const bytes = exit.value.canonicalSchemaBytes;
      let text = "";
      for (let i = 0; i < bytes.byteLength; i += 1) {
        text += String.fromCharCode(bytes[i] ?? 0);
      }
      expect(text).not.toContain("__injected");
      expect(Object.hasOwn(responseSchemaObject.properties, "__injected")).toBe(
        false,
      );
      // Original canonical hash retained.
      expect(exit.value.canonicalSchemaHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(log.materializer).toBe(1);
  });

  it("lowerer that returns a lowering of the mutated input fails typed before materialization", async () => {
    const log = emptyLog();
    const layer = Layer.mergeAll(
      Layer.succeed(ArtifactReader, {
        read: (request) => {
          log.reader.push(request.descriptor.artifactId);
          return Effect.succeed(
            (
              bytesById().get(request.descriptor.artifactId) ?? new Uint8Array()
            ).slice(),
          );
        },
      }),
      Layer.succeed(BundleVerifier, {
        verify: () => {
          log.bundle += 1;
          return Effect.void;
        },
      }),
      Layer.succeed(Digest, {
        sha256: (bytes) => Effect.succeed(sha256Hex(bytes) as Sha256Digest),
      }),
      Layer.succeed(PromptMaterializer, {
        materialize: (input) => {
          log.materializer += 1;
          return Effect.succeed(materializePromptBytesLocal(input));
        },
      }),
      Layer.succeed(ProviderSchemaLowerer, {
        lower: (input) =>
          Effect.gen(function* () {
            log.lowerer += 1;
            const schema = input.canonicalSchema as {
              properties?: Record<string, unknown>;
            };
            if (schema.properties !== undefined) {
              schema.properties.__injected = { type: "string" };
            }
            // Dishonest: lower from the mutated schema so independent verify fails.
            return yield* lowerProviderSchema(
              input.providerFamily,
              input.canonicalSchema,
            );
          }),
      }),
    );
    const exit = await Effect.runPromiseExit(
      compileReviewPrompt({
        contract: makeContract(),
        providerFamily: "openai",
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe("Fail");
      expect(isTypedBoundary(extractFail(exit))).toBe(true);
    }
    expect(log.materializer).toBe(0);
  });

  it("materializer mutation cannot change expected prompt bytes", async () => {
    const log = emptyLog();
    const layer = Layer.mergeAll(
      Layer.succeed(ArtifactReader, {
        read: (request) => {
          log.reader.push(request.descriptor.artifactId);
          return Effect.succeed(
            (
              bytesById().get(request.descriptor.artifactId) ?? new Uint8Array()
            ).slice(),
          );
        },
      }),
      Layer.succeed(BundleVerifier, {
        verify: () => Effect.void,
      }),
      Layer.succeed(Digest, {
        sha256: (bytes) => Effect.succeed(sha256Hex(bytes) as Sha256Digest),
      }),
      Layer.succeed(PromptMaterializer, {
        materialize: (input: PromptMaterializerInput) =>
          Effect.sync(() => {
            log.materializer += 1;
            const before = materializePromptBytesLocal(input);
            (input.taskData as { candidateId: string }).candidateId =
              "cand_MUTATED000000000000000000000";
            (input.untrustedEvidence as { content: string }[])[0] = {
              ...(input.untrustedEvidence[0] as object),
              content: "MUTATED_EVIDENCE",
            };
            return before;
          }),
      }),
      Layer.succeed(ProviderSchemaLowerer, {
        lower: (input) =>
          lowerProviderSchema(input.providerFamily, input.canonicalSchema),
      }),
    );
    const exit = await Effect.runPromiseExit(
      compileReviewPrompt({
        contract: makeContract(),
        providerFamily: "openai",
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("rejects reader byte-container impostor with boundary-tagged failure and no later ports", async () => {
    const log = emptyLog();
    const genuine = encodeUtf8Text("x");
    const impostor = denseByteImpostor(genuine);
    const layer = Layer.mergeAll(
      Layer.succeed(ArtifactReader, {
        read: () => {
          log.reader.push("impostor");
          return Effect.succeed(impostor as never);
        },
      }),
      Layer.succeed(BundleVerifier, {
        verify: () => {
          log.bundle += 1;
          return Effect.void;
        },
      }),
      Layer.succeed(Digest, {
        sha256: (bytes) => {
          log.reader.push("digest-called");
          return Effect.succeed(sha256Hex(bytes) as Sha256Digest);
        },
      }),
      Layer.succeed(PromptMaterializer, {
        materialize: (input) => {
          log.materializer += 1;
          return Effect.succeed(materializePromptBytesLocal(input));
        },
      }),
      Layer.succeed(ProviderSchemaLowerer, {
        lower: (input) => {
          log.lowerer += 1;
          return lowerProviderSchema(
            input.providerFamily,
            input.canonicalSchema,
          );
        },
      }),
    );
    const exit = await Effect.runPromiseExit(
      compileReviewPrompt({
        contract: makeContract(),
        providerFamily: "openai",
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe("Fail");
      const error = extractFail(exit);
      expect(isTypedBoundary(error)).toBe(true);
    }
    expect(log.materializer).toBe(0);
    // Digest must not run on an impostor that failed the ordinary-byte boundary.
    expect(log.reader.includes("digest-called")).toBe(false);
  });

  it("rejects materializer byte-container impostor with boundary-tagged failure", async () => {
    const log = emptyLog();
    const genuine = encodeUtf8Text("{}");
    const impostor = denseByteImpostor(genuine);
    const layer = Layer.mergeAll(
      Layer.succeed(ArtifactReader, {
        read: (request) =>
          Effect.succeed(
            (
              bytesById().get(request.descriptor.artifactId) ?? new Uint8Array()
            ).slice(),
          ),
      }),
      Layer.succeed(BundleVerifier, {
        verify: () => Effect.void,
      }),
      Layer.succeed(Digest, {
        sha256: (bytes) => Effect.succeed(sha256Hex(bytes) as Sha256Digest),
      }),
      Layer.succeed(PromptMaterializer, {
        materialize: () => {
          log.materializer += 1;
          return Effect.succeed(impostor as never);
        },
      }),
      Layer.succeed(ProviderSchemaLowerer, {
        lower: (input) =>
          lowerProviderSchema(input.providerFamily, input.canonicalSchema),
      }),
    );
    const exit = await Effect.runPromiseExit(
      compileReviewPrompt({
        contract: makeContract(),
        providerFamily: "openai",
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe("Fail");
      expect(isTypedBoundary(extractFail(exit))).toBe(true);
    }
    expect(log.materializer).toBe(1);
  });
});
