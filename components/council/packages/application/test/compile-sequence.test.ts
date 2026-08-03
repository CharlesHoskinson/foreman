import { CanonicalCompiledPromptV1, decodeStrictSync } from "@council/schema";
import { Deferred, Effect, Exit, Fiber } from "effect";
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
  ArtifactReader,
  BundleVerificationError,
  BundleVerifier,
  CanonicalSchemaInvalid,
  compileReviewPrompt,
  Digest,
  DiffArtifactError,
  DigestError,
  lowerProviderSchema,
  PromptMaterializer,
  ProviderSchemaLowerer,
} from "../src/index.js";
import {
  binaryId,
  buildLayer,
  bytesById,
  defaultArtifacts,
  diffId,
  emptyLog,
  encodeUtf8Text,
  extractFail,
  makeArtifact,
  makeContract,
  materializePromptBytesLocal,
  notesId,
  responseSchemaId,
  runCompile,
  runCompileExit,
  sha256Hex,
} from "./test-helpers.js";

const utf8Decode = (bytes: Uint8Array): string => {
  let result = "";
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index] ?? 0;
    if (byte <= 0x7f) {
      result += String.fromCharCode(byte);
      index += 1;
    } else if ((byte & 0xe0) === 0xc0) {
      const b2 = bytes[index + 1] ?? 0;
      result += String.fromCharCode(((byte & 0x1f) << 6) | (b2 & 0x3f));
      index += 2;
    } else if ((byte & 0xf0) === 0xe0) {
      const b2 = bytes[index + 1] ?? 0;
      const b3 = bytes[index + 2] ?? 0;
      result += String.fromCharCode(
        ((byte & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f),
      );
      index += 3;
    } else {
      const b2 = bytes[index + 1] ?? 0;
      const b3 = bytes[index + 2] ?? 0;
      const b4 = bytes[index + 3] ?? 0;
      const code =
        ((byte & 0x07) << 18) |
        ((b2 & 0x3f) << 12) |
        ((b3 & 0x3f) << 6) |
        (b4 & 0x3f);
      const offset = code - 0x10000;
      result += String.fromCharCode(
        0xd800 + (offset >> 10),
        0xdc00 + (offset & 0x3ff),
      );
      index += 4;
    }
  }
  return result;
};

describe("exact compilation sequence", () => {
  it("invalid provider family fails before bundle verification", async () => {
    const log = emptyLog();
    const exit = await runCompileExit(
      makeContract(),
      "evil",
      buildLayer({ log }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(log.bundle).toBe(0);
    expect(log.reader).toEqual([]);
    expect(log.lowerer).toBe(0);
    expect(log.materializer).toBe(0);
  });

  it("bundle failure wins when diff is also missing", async () => {
    const log = emptyLog();
    const noDiff = defaultArtifacts.filter((a) => a.artifactId !== diffId);
    const exit = await runCompileExit(
      makeContract({ artifacts: noDiff }),
      "openai",
      buildLayer({ log, bundleField: "baseSha" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const err = extractFail(exit);
    expect(err).toBeInstanceOf(BundleVerificationError);
    expect(log.bundle).toBe(1);
    expect(log.reader).toEqual([]);
  });

  it("zero exact diff matches returns DiffArtifactError after successful bundle", async () => {
    const log = emptyLog();
    const noDiff = defaultArtifacts.filter((a) => a.artifactId !== diffId);
    const exit = await runCompileExit(
      makeContract({ artifacts: noDiff }),
      "openai",
      buildLayer({ log }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(extractFail(exit)).toBeInstanceOf(DiffArtifactError);
    expect(log.bundle).toBe(1);
  });

  it("invalid digest output cannot enter a descriptor", async () => {
    const log = emptyLog();
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({
        log,
        digestOverride: () => "zz",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const err = extractFail(exit) as { _tag: string };
    expect(err._tag === "DigestError" || err instanceof DigestError).toBe(true);
  });

  it("declared artifact limit violation fails before reader runs", async () => {
    const log = emptyLog();
    const oversized = {
      ...requireEntry(defaultArtifacts, 0, "artifact"),
      byteLength: 10_000,
    };
    const artifacts = [
      oversized,
      requireEntry(defaultArtifacts, 1, "artifact"),
      requireEntry(defaultArtifacts, 2, "artifact"),
      requireEntry(defaultArtifacts, 3, "artifact"),
    ];
    const exit = await runCompileExit(
      makeContract({
        artifacts,
        limits: {
          maxPromptBytes: 200_000,
          maxArtifactBytes: 100,
          maxTurns: 1,
          maxWallTimeMs: 60_000,
          maxRetries: 1,
        },
      }),
      "openai",
      buildLayer({ log }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const err = extractFail(exit) as {
      _tag: string;
      stage?: string;
    };
    expect(err._tag).toBe("ArtifactLimitExceeded");
    expect(err.stage).toBe("artifact_limit");
    expect(log.reader).toEqual([]);
    expect(log.lowerer).toBe(0);
    expect(log.materializer).toBe(0);
  });

  it("invalid ordinary-text UTF-8 returns ArtifactEncodingInvalid not CanonicalSchemaInvalid", async () => {
    const log = emptyLog();
    const invalidUtf8 = Uint8Array.from([0xff, 0xfe, 0xfd]);
    const digest = sha256Hex(invalidUtf8);
    const notesArtifact = makeArtifact(
      "reviewer-notes",
      "text/plain",
      invalidUtf8,
      digest,
      `sha256:${digest}`,
    );
    const artifacts = [
      requireEntry(defaultArtifacts, 0, "artifact"),
      notesArtifact,
      requireEntry(defaultArtifacts, 2, "artifact"),
      requireEntry(defaultArtifacts, 3, "artifact"),
    ];
    const store = bytesById();
    store.set(notesArtifact.artifactId, invalidUtf8);
    const exit = await runCompileExit(
      makeContract({ artifacts }),
      "openai",
      buildLayer({ log, bytes: store }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const err = extractFail(exit) as { _tag: string; stage?: string };
    expect(err._tag).toBe("ArtifactEncodingInvalid");
    expect(err.stage).toBe("artifact_encoding");
    expect(err).not.toBeInstanceOf(CanonicalSchemaInvalid);
    expect(log.materializer).toBe(0);
  });

  it("returned descriptor passes internal strict decode", async () => {
    const result = await runCompile(
      makeContract(),
      "anthropic",
      buildLayer({ log: emptyLog() }),
    );
    const decoded = decodeStrictSync(
      CanonicalCompiledPromptV1,
      result.descriptor,
    );
    expect(decoded).toEqual(result.descriptor);
  });

  it("materializer mismatch fails before hashing", async () => {
    const log = emptyLog();
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({
        log,
        materializerOverride: () => encodeUtf8Text('{"format":"tampered"}'),
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const err = extractFail(exit) as { _tag: string };
    expect(err._tag).toBe("PromptMaterializationError");
  });
});

describe("reverse-completion determinism", () => {
  it("prompt evidence order follows contract when reads complete in reverse", async () => {
    const log = emptyLog();
    const store = bytesById();
    const order = defaultArtifacts.map((a) => a.artifactId);
    const deferreds = new Map<string, Deferred.Deferred<Uint8Array>>();
    for (const id of order) {
      deferreds.set(id, Effect.runSync(Deferred.make<Uint8Array>()));
    }
    const allStarted = Effect.runSync(Deferred.make<undefined>());
    let started = 0;

    const program = compileReviewPrompt({
      contract: makeContract(),
      providerFamily: "openai",
    }).pipe(
      Effect.provideService(ArtifactReader, {
        read: (request) =>
          Effect.gen(function* () {
            log.reader.push(request.descriptor.artifactId);
            started += 1;
            if (started === order.length) {
              yield* Deferred.succeed(allStarted, undefined);
            }
            const deferred = deferreds.get(request.descriptor.artifactId);
            if (deferred === undefined) {
              return yield* Effect.die("missing deferred");
            }
            return yield* Deferred.await(deferred);
          }),
      }),
      Effect.provideService(BundleVerifier, {
        verify: () =>
          Effect.sync(() => {
            log.bundle += 1;
          }),
      }),
      Effect.provideService(Digest, {
        sha256: (bytes) => Effect.succeed(sha256Hex(bytes) as never),
      }),
      Effect.provideService(PromptMaterializer, {
        materialize: (input) =>
          Effect.sync(() => {
            log.materializer += 1;
            return materializePromptBytesLocal(input);
          }),
      }),
      Effect.provideService(ProviderSchemaLowerer, {
        lower: (input) => {
          log.lowerer += 1;
          return lowerProviderSchema(
            input.providerFamily,
            input.canonicalSchema,
          );
        },
      }),
    );

    const fiber = Effect.runFork(program);

    // Deterministic barrier: all reads must start before any completes.
    // Sequential production code deadlocks here (never reaches allStarted).
    await Effect.runPromise(Deferred.await(allStarted));
    expect(log.reader.length).toBe(order.length);

    for (const id of [...order].reverse()) {
      const bytes = store.get(id);
      const deferred = deferreds.get(id);
      if (bytes === undefined || deferred === undefined) {
        throw new Error("fixture missing");
      }
      Effect.runSync(Deferred.succeed(deferred, bytes.slice()));
    }

    const exit = await Effect.runPromiseExit(Fiber.join(fiber));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const result = exit.value;
      const envelope = JSON.parse(utf8Decode(result.promptBytes)) as {
        untrustedEvidence: Array<{ artifactId: string }>;
      };
      expect(envelope.untrustedEvidence.map((e) => e.artifactId)).toEqual([
        diffId,
        notesId,
        binaryId,
      ]);
      expect(result.descriptor.artifactIds).toEqual(
        defaultArtifacts.map((a) => a.artifactId),
      );
    }
  });
});

void responseSchemaId;
