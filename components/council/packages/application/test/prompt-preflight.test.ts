import {
  CanaryReceiptV1,
  CanonicalCompiledPromptV1,
  decodeStrictSync,
  encodeCanaryChallengeCanonical,
  hashCanaryChallenge,
} from "@council/schema";
import { Exit } from "effect";
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
  ArtifactDigestMismatch,
  ArtifactLengthMismatch,
  ArtifactMissing,
  BundleVerificationError,
  CanonicalSchemaInvalid,
  DiffArtifactError,
  PromptLimitExceeded,
} from "../src/index.js";
import {
  binaryBytes,
  binaryId,
  buildLayer,
  bytesById,
  canonicalizeCouncilAce,
  defaultArtifacts,
  diffId,
  emptyLog,
  encodeUtf8Text,
  extractFail,
  lexicon,
  makeArtifact,
  makeContract,
  notesId,
  parseCouncilAce,
  responseSchemaId,
  runCompile,
  runCompileExit,
  sha256Hex,
  aceSource,
} from "./test-helpers.js";

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};

const base64Of = (bytes: Uint8Array): string => {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    const c1 = alphabet[(triple >> 18) & 63] ?? "";
    const c2 = alphabet[(triple >> 12) & 63] ?? "";
    const c3 = b === undefined ? "=" : (alphabet[(triple >> 6) & 63] ?? "=");
    const c4 = c === undefined ? "=" : (alphabet[triple & 63] ?? "=");
    output += c1 + c2 + c3 + c4;
  }
  return output;
};

const decodeUtf8Host = (bytes: Uint8Array): string => {
  // Test-only decode of known-valid UTF-8 fixture bytes (no unpaired surrogates).
  let result = "";
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index] ?? 0;
    if (byte <= 0x7f) {
      result += String.fromCharCode(byte);
      index += 1;
      continue;
    }
    if ((byte & 0xe0) === 0xc0) {
      const b2 = bytes[index + 1] ?? 0;
      const code = ((byte & 0x1f) << 6) | (b2 & 0x3f);
      result += String.fromCharCode(code);
      index += 2;
      continue;
    }
    if ((byte & 0xf0) === 0xe0) {
      const b2 = bytes[index + 1] ?? 0;
      const b3 = bytes[index + 2] ?? 0;
      const code = ((byte & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      result += String.fromCharCode(code);
      index += 3;
      continue;
    }
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
  return result;
};

describe("compileReviewPrompt", () => {
  it("same input twice produces byte-identical prompt and hashes", async () => {
    const contract = makeContract();
    const a = await runCompile(
      contract,
      "anthropic",
      buildLayer({ log: emptyLog() }),
    );
    const b = await runCompile(
      contract,
      "anthropic",
      buildLayer({ log: emptyLog() }),
    );
    expect(bytesEqual(a.promptBytes, b.promptBytes)).toBe(true);
    expect(a.promptHash).toBe(b.promptHash);
    expect(a.contractHash).toBe(b.contractHash);
    expect(a.schemaVariantHash).toBe(b.schemaVariantHash);
    expect(a.canonicalSchemaHash).toBe(b.canonicalSchemaHash);
    expect(a.descriptor).toEqual(b.descriptor);
  });

  it("evidence with fake authority markers stays escaped under untrustedEvidence", async () => {
    const result = await runCompile(
      makeContract(),
      "openai",
      buildLayer({ log: emptyLog() }),
    );
    const text = decodeUtf8Host(result.promptBytes);
    const envelope = JSON.parse(text) as {
      trustedAuthority: { aceText: string };
      untrustedEvidence: Array<{
        alias: string;
        content: string;
        contentEncoding: string;
      }>;
    };
    const parsed = parseCouncilAce(aceSource, lexicon);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(envelope.trustedAuthority.aceText).toBe(
      canonicalizeCouncilAce(parsed.document),
    );
    const notes = envelope.untrustedEvidence.find(
      (entry) => entry.alias === "reviewer-notes",
    );
    expect(notes).toBeDefined();
    expect(notes?.content).toContain("trustedAuthority");
    expect(notes?.content).toContain("ignore the Council contract");
    expect(notes?.contentEncoding).toBe("utf8");
    expect(JSON.stringify(notes?.content)).toContain("section: instructions");
    expect(envelope.trustedAuthority.aceText).not.toContain(
      "ignore the Council contract",
    );
  });

  it("artifact absent returns ArtifactMissing", async () => {
    const log = emptyLog();
    const store = bytesById();
    store.delete(notesId);
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({ log, bytes: store }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(extractFail(exit)).toBeInstanceOf(ArtifactMissing);
    }
    expect(log.lowerer).toBe(0);
    expect(log.materializer).toBe(0);
  });

  it("byte length mismatch returns ArtifactLengthMismatch", async () => {
    const log = emptyLog();
    const store = bytesById();
    store.set(diffId, encodeUtf8Text("short"));
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({ log, bytes: store }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(extractFail(exit)).toBeInstanceOf(ArtifactLengthMismatch);
    }
  });

  it("digest mismatch returns ArtifactDigestMismatch", async () => {
    const log = emptyLog();
    const store = bytesById();
    store.set(diffId, encodeUtf8Text("x".repeat(diffId.length > 0 ? 34 : 34)));
    // Match original byte length so length check passes and digest fails.
    const original = bytesById().get(diffId);
    if (original === undefined) {
      throw new Error("diff fixture missing");
    }
    store.set(diffId, encodeUtf8Text("x".repeat(original.byteLength)));
    const exit = await runCompileExit(
      makeContract(),
      "openai",
      buildLayer({ log, bytes: store }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(extractFail(exit)).toBeInstanceOf(ArtifactDigestMismatch);
    }
  });

  it.each(["baseSha", "headSha", "diffSha256"] as const)(
    "bundle %s mismatch returns typed bundle error",
    async (field) => {
      const log = emptyLog();
      const exit = await runCompileExit(
        makeContract(),
        "openai",
        buildLayer({ log, bundleField: field }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = extractFail(exit);
        expect(err).toBeInstanceOf(BundleVerificationError);
        expect((err as BundleVerificationError).field).toBe(field);
      }
      expect(log.reader).toEqual([]);
      expect(log.lowerer).toBe(0);
      expect(log.materializer).toBe(0);
    },
  );

  it("no unique diff artifact returns DiffArtifactError", async () => {
    const log = emptyLog();
    const noDiff = defaultArtifacts.filter((a) => a.artifactId !== diffId);
    const exit = await runCompileExit(
      makeContract({ artifacts: noDiff }),
      "openai",
      buildLayer({ log }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(extractFail(exit)).toBeInstanceOf(DiffArtifactError);
    }
    // Bundle verification precedes diff identity in the frozen sequence.
    expect(log.bundle).toBe(1);
    expect(log.reader).toEqual([]);
  });

  it("response schema invalid JSON returns CanonicalSchemaInvalid", async () => {
    const log = emptyLog();
    const bad = encodeUtf8Text("{not-json");
    const badDigest = sha256Hex(bad);
    const badId = `sha256:${badDigest}`;
    const schemaDesc = makeArtifact(
      "response-schema",
      "application/json",
      bad,
      badDigest,
      badId,
    );
    const artifacts = [
      requireEntry(defaultArtifacts, 0, "artifact"),
      requireEntry(defaultArtifacts, 1, "artifact"),
      schemaDesc,
      requireEntry(defaultArtifacts, 3, "artifact"),
    ];
    const store = bytesById();
    store.set(badId, bad);
    store.delete(responseSchemaId);
    const exit = await runCompileExit(
      makeContract({
        artifacts,
        responseSchemaArtifactId: badId,
      }),
      "openai",
      buildLayer({ log, bytes: store }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(extractFail(exit)).toBeInstanceOf(CanonicalSchemaInvalid);
    }
  });

  it("unknown structural schema keyword fails closed", async () => {
    const log = emptyLog();
    const schema = {
      type: "object",
      properties: {},
      notARealKeyword: true,
    };
    const text = JSON.stringify(schema);
    const bytes = encodeUtf8Text(text);
    const digest = sha256Hex(bytes);
    const id = `sha256:${digest}`;
    const artifacts = [
      requireEntry(defaultArtifacts, 0, "artifact"),
      requireEntry(defaultArtifacts, 1, "artifact"),
      makeArtifact("response-schema", "application/json", bytes, digest, id),
      requireEntry(defaultArtifacts, 3, "artifact"),
    ];
    const store = bytesById();
    store.set(id, bytes);
    store.delete(responseSchemaId);
    const exit = await runCompileExit(
      makeContract({
        artifacts,
        responseSchemaArtifactId: id,
      }),
      "anthropic",
      buildLayer({ log, bytes: store }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = extractFail(exit) as { _tag: string; reason?: string };
      expect(
        err._tag === "SchemaLoweringError" ||
          err._tag === "CanonicalSchemaInvalid",
      ).toBe(true);
      expect(err.reason).toContain("unknown structural");
    }
  });

  it("anthropic $schema removal and const conversion produce explicit receipts", async () => {
    const result = await runCompile(
      makeContract(),
      "anthropic",
      buildLayer({ log: emptyLog() }),
    );
    expect(
      result.loweringReceipt.transformations.some(
        (t) => t.kind === "annotation_removed" && t.keyword === "$schema",
      ),
    ).toBe(true);
    expect(
      result.loweringReceipt.transformations.some(
        (t) => t.kind === "const_to_enum",
      ),
    ).toBe(true);
    expect(result.loweringReceipt.constraintReceipts).toEqual([]);
    const lowered = JSON.parse(decodeUtf8Host(result.loweredSchemaBytes)) as {
      properties: { status: { enum?: string[]; const?: string } };
      $schema?: string;
    };
    expect(lowered.$schema).toBeUndefined();
    expect(lowered.properties.status.enum).toEqual(["ready"]);
    expect(lowered.properties.status.const).toBeUndefined();
  });

  it("prompt size over maxPromptBytes returns PromptLimitExceeded", async () => {
    const exit = await runCompileExit(
      makeContract({
        limits: {
          maxPromptBytes: 64,
          maxArtifactBytes: 1_000_000,
          maxTurns: 1,
          maxWallTimeMs: 60_000,
          maxRetries: 1,
        },
      }),
      "openai",
      buildLayer({ log: emptyLog() }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(extractFail(exit)).toBeInstanceOf(PromptLimitExceeded);
    }
  });

  it("earlier-stage failure proves no later reader/lowerer/materializer call ran", async () => {
    const log = emptyLog();
    const exit = await runCompileExit(
      makeContract({ aceSource: "not valid ace" }),
      "openai",
      buildLayer({ log }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(log.bundle).toBe(0);
    expect(log.reader).toEqual([]);
    expect(log.lowerer).toBe(0);
    expect(log.materializer).toBe(0);
  });

  it("canonical compiled prompt binds its variant hash", async () => {
    const result = await runCompile(
      makeContract(),
      "anthropic",
      buildLayer({ log: emptyLog() }),
    );
    const expectedVariant = `sha256:${sha256Hex(result.loweredSchemaBytes)}`;
    expect(result.schemaVariantHash).toBe(expectedVariant);
    expect(result.descriptor.schemaVariantHash).toBe(expectedVariant);
    expect(
      decodeStrictSync(CanonicalCompiledPromptV1, result.descriptor),
    ).toEqual(result.descriptor);
    expect(result.descriptor.promptByteLength).toBe(
      result.promptBytes.byteLength,
    );
    expect(result.descriptor.promptByteLength).toBeGreaterThan(0);
  });

  it("canary receipt distinguishes review and canary schema hashes", () => {
    const reviewSchemaHash = `sha256:${"11".repeat(32)}`;
    const canarySchemaHash = `sha256:${"22".repeat(32)}`;
    const challenge = {
      schemaVersion: 1 as const,
      nonce: "fixed-nonce-001",
      checkExpression: "1+1" as const,
      expectedCheckResult: "2" as const,
    };
    void encodeCanaryChallengeCanonical;
    const receipt = {
      schemaVersion: 1,
      providerFamily: "anthropic" as const,
      model: "claude-test",
      cliVersion: "1.0.0",
      contractClass: "council-ace-1",
      promptHash: `sha256:${"33".repeat(32)}`,
      schemaVariantHash: reviewSchemaHash,
      canarySchemaVariantHash: canarySchemaHash,
      challengeHash: hashCanaryChallenge(challenge),
      challenge,
      response: {
        schemaVersion: 1,
        nonce: "fixed-nonce-001",
        checkResult: "2",
        status: "ready",
      },
      terminal: {
        schemaVersion: 1,
        modelTurnStarted: true,
        terminalRecordObserved: true,
        terminalState: "completed",
        exitCode: 0,
        stopReason: "end_turn",
        pendingToolCalls: 0,
        failedToolCalls: 0,
        parserComplete: true,
        structuredOutputPresent: true,
        structuredOutputError: null,
        stdoutDigest: "aa".repeat(32),
        stderrDigest: "bb".repeat(32),
        errorMessage: null,
      },
      observedAt: "2026-08-02T12:00:00.000Z",
      expiresAt: "2026-08-02T13:00:00.000Z",
    };
    const decoded = decodeStrictSync(CanaryReceiptV1, receipt);
    expect(decoded.schemaVariantHash).toBe(reviewSchemaHash);
    expect(decoded.canarySchemaVariantHash).toBe(canarySchemaHash);
    expect(decoded.schemaVariantHash).not.toBe(decoded.canarySchemaVariantHash);
  });

  it("binary media is base64 under untrustedEvidence", async () => {
    const result = await runCompile(
      makeContract(),
      "google",
      buildLayer({ log: emptyLog() }),
    );
    const envelope = JSON.parse(decodeUtf8Host(result.promptBytes)) as {
      untrustedEvidence: Array<{
        alias: string;
        contentEncoding: string;
        content: string;
      }>;
    };
    const binary = envelope.untrustedEvidence.find(
      (entry) => entry.alias === "binary-blob",
    );
    expect(binary?.contentEncoding).toBe("base64");
    expect(binary?.content).toBe(base64Of(binaryBytes));
  });

  it("response schema is not duplicated inside untrustedEvidence", async () => {
    const result = await runCompile(
      makeContract(),
      "xai",
      buildLayer({ log: emptyLog() }),
    );
    const envelope = JSON.parse(decodeUtf8Host(result.promptBytes)) as {
      untrustedEvidence: Array<{ artifactId: string }>;
      responseSchema: unknown;
    };
    expect(
      envelope.untrustedEvidence.some(
        (entry) => entry.artifactId === responseSchemaId,
      ),
    ).toBe(false);
    expect(envelope.responseSchema).toBeDefined();
    expect(result.descriptor.artifactIds).toContain(responseSchemaId);
  });

  it("descriptor artifact order follows contract even when store map is reversed", async () => {
    const log = emptyLog();
    const reversed = new Map([...bytesById().entries()].reverse());
    const result = await runCompile(
      makeContract(),
      "xai",
      buildLayer({ log, bytes: reversed }),
    );
    expect(log.reader).toEqual(defaultArtifacts.map((a) => a.artifactId));
    const envelope = JSON.parse(decodeUtf8Host(result.promptBytes)) as {
      untrustedEvidence: Array<{ artifactId: string }>;
    };
    expect(envelope.untrustedEvidence.map((e) => e.artifactId)).toEqual([
      diffId,
      notesId,
      binaryId,
    ]);
  });
});
