/**
 * Ready-review token issuance — deterministic Effect tests.
 * No live provider, no Node process spawn, no network, no clock port.
 */
import type {
  ArtifactId,
  CanaryReceiptV1,
  CandidateId,
  CanonicalCompiledPromptV1,
  ContentHash,
  ContractHash,
  GitCommitSha,
  Sha256Digest,
  UtcTimestamp,
} from "@council/schema";
import { hashCanaryChallenge } from "@council/schema";
import type { Cause, Exit } from "effect";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ReadyTokenIssuanceError } from "../src/index.js";
import { issueReadyReviewToken } from "../src/index.js";

const digest = (hexPair: string): Sha256Digest =>
  hexPair.repeat(32) as Sha256Digest;

const contentHash = (hexPair: string): ContentHash =>
  `sha256:${hexPair.repeat(32)}` as ContentHash;

const contractHash = (hexPair: string): ContractHash =>
  `sha256:${hexPair.repeat(32)}` as ContractHash;

const candidateId = "cand_01ARZ3NDEKTSV4RRFFQ69G5FAV" as CandidateId;
const artifactDigest = "cc".repeat(32);
const artifactId = `sha256:${artifactDigest}` as ArtifactId;

const challenge = {
  schemaVersion: 1 as const,
  nonce: "ready-token-nonce-fixed-001",
  checkExpression: "1+1" as const,
  expectedCheckResult: "2" as const,
};

const promptHash = contentHash("11");
const reviewSchemaHash = contentHash("22");
const canarySchemaHash = contentHash("33");
const fixedContractHash = contractHash("44");

const observedAt = "2026-08-03T12:00:00.000Z" as UtcTimestamp;
const canaryExpiresAt = "2026-08-03T12:10:00.000Z" as UtcTimestamp;
const issuedAt = "2026-08-03T12:01:00.000Z" as UtcTimestamp;
const tokenExpiresAt = "2026-08-03T12:05:00.000Z" as UtcTimestamp;

const terminalCompleted = {
  schemaVersion: 1 as const,
  modelTurnStarted: true,
  terminalRecordObserved: true,
  terminalState: "completed" as const,
  exitCode: 0,
  stopReason: "end_turn",
  pendingToolCalls: 0,
  failedToolCalls: 0,
  parserComplete: true,
  structuredOutputPresent: true,
  structuredOutputError: null,
  stdoutDigest: digest("aa"),
  stderrDigest: digest("bb"),
  errorMessage: null,
};

const basePrompt = (): CanonicalCompiledPromptV1 => ({
  schemaVersion: 1,
  profile: "council-ace-1",
  contractHash: fixedContractHash,
  promptHash,
  schemaVariantHash: reviewSchemaHash,
  canonicalAceText: "Every reviewer must verify the bundle-identity.",
  promptByteLength: 48,
  candidateId,
  bundle: {
    schemaVersion: 1,
    baseSha: "a".repeat(40) as GitCommitSha,
    headSha: "1".repeat(40) as GitCommitSha,
    diffSha256: "b".repeat(64) as Sha256Digest,
  },
  artifactIds: [artifactId],
  responseSchemaArtifactId: artifactId,
});

const baseCanary = (): CanaryReceiptV1 => ({
  schemaVersion: 1,
  providerFamily: "xai",
  model: "grok-4",
  cliVersion: "0.2.118",
  contractClass: "council-ace-1",
  promptHash,
  schemaVariantHash: reviewSchemaHash,
  canarySchemaVariantHash: canarySchemaHash,
  challengeHash: hashCanaryChallenge(challenge),
  challenge,
  response: {
    schemaVersion: 1,
    nonce: challenge.nonce,
    checkResult: "2",
    status: "ready",
  },
  terminal: terminalCompleted,
  observedAt,
  expiresAt: canaryExpiresAt,
});

const runIssue = (input: {
  readonly prompt: CanonicalCompiledPromptV1;
  readonly canary: CanaryReceiptV1;
  readonly issuedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
}) => Effect.runPromiseExit(issueReadyReviewToken(input));

const firstFail = (cause: Cause.Cause<unknown>): unknown => {
  if (cause._tag === "Fail") return cause.error;
  if (cause._tag === "Parallel" || cause._tag === "Sequential") {
    return firstFail(cause.left) ?? firstFail(cause.right);
  }
  return undefined;
};

const expectIssuanceFailure = (
  exit: Exit.Exit<unknown, ReadyTokenIssuanceError>,
): ReadyTokenIssuanceError => {
  expect(exit._tag).toBe("Failure");
  if (exit._tag !== "Failure") {
    throw new Error("expected failure");
  }
  const error = firstFail(exit.cause);
  expect(error).toBeDefined();
  const issuance = error as ReadyTokenIssuanceError;
  expect(issuance._tag).toBe("ReadyTokenIssuanceError");
  // Typed Effect failure, not a defect: must carry closed category + reason.
  expect(typeof issuance.category).toBe("string");
  expect(typeof issuance.reason).toBe("string");
  expect(issuance.reason.length).toBeGreaterThan(0);
  // Secret-safe shape: only category and reason beyond the tag.
  expect(issuance).not.toHaveProperty("prompt");
  expect(issuance).not.toHaveProperty("canary");
  expect(issuance).not.toHaveProperty("token");
  expect(issuance).not.toHaveProperty("stdout");
  expect(issuance).not.toHaveProperty("stderr");
  expect(issuance).not.toHaveProperty("environment");
  expect(issuance).not.toHaveProperty("cwd");
  expect(issuance).not.toHaveProperty("path");
  expect(issuance).not.toHaveProperty("schemaBytes");
  expect(issuance).not.toHaveProperty("promptBytes");
  expect(issuance).not.toHaveProperty("rawOutput");
  return issuance;
};

describe("issueReadyReviewToken", () => {
  it("produces the exact strict ready triple from a valid prompt and canary", async () => {
    const prompt = basePrompt();
    const canary = baseCanary();
    const exit = await runIssue({
      prompt,
      canary,
      issuedAt,
      expiresAt: tokenExpiresAt,
    });
    expect(exit._tag).toBe("Success");
    if (exit._tag !== "Success") {
      throw new Error("expected success");
    }
    const ready = exit.value;
    expect(ready._tag).toBe("ready");
    expect(ready.schemaVersion).toBe(1);
    expect(ready.prompt).toEqual(prompt);
    expect(ready.canary).toEqual(canary);
    expect(ready.token).toEqual({
      schemaVersion: 1,
      providerFamily: canary.providerFamily,
      model: canary.model,
      cliVersion: canary.cliVersion,
      contractHash: prompt.contractHash,
      promptHash: prompt.promptHash,
      schemaVariantHash: prompt.schemaVariantHash,
      nonce: canary.challenge.nonce,
      issuedAt,
      expiresAt: tokenExpiresAt,
    });
  });

  it("derives token identity fields from the correct trusted sources", async () => {
    const prompt = basePrompt();
    const canary = baseCanary();
    const exit = await runIssue({
      prompt,
      canary,
      issuedAt,
      expiresAt: tokenExpiresAt,
    });
    expect(exit._tag).toBe("Success");
    if (exit._tag !== "Success") {
      throw new Error("expected success");
    }
    const { token } = exit.value;
    // From canary:
    expect(token.providerFamily).toBe(canary.providerFamily);
    expect(token.model).toBe(canary.model);
    expect(token.cliVersion).toBe(canary.cliVersion);
    expect(token.nonce).toBe(canary.challenge.nonce);
    // From prompt:
    expect(token.contractHash).toBe(prompt.contractHash);
    expect(token.promptHash).toBe(prompt.promptHash);
    expect(token.schemaVariantHash).toBe(prompt.schemaVariantHash);
    // Only timestamps from function input:
    expect(token.issuedAt).toBe(issuedAt);
    expect(token.expiresAt).toBe(tokenExpiresAt);
    // Not the canary-response schema hash:
    expect(token.schemaVariantHash).not.toBe(canary.canarySchemaVariantHash);
  });

  it("fails with prompt_invalid on a malformed compiled prompt (typed Effect failure)", async () => {
    const malformed = {
      ...basePrompt(),
      profile: "not-a-valid-profile",
      // Marker payload that must never appear on the error.
      canonicalAceText:
        "SECRET_PROMPT_TEXT /home/secret/path HOME=/tmp schema-bytes-XYZ",
    } as unknown as CanonicalCompiledPromptV1;
    const exit = await runIssue({
      prompt: malformed,
      canary: baseCanary(),
      issuedAt,
      expiresAt: tokenExpiresAt,
    });
    const error = expectIssuanceFailure(exit);
    expect(error.category).toBe("prompt_invalid");
    const json = JSON.stringify(error);
    expect(json).not.toContain("SECRET_PROMPT_TEXT");
    expect(json).not.toContain("/home/secret/path");
    expect(json).not.toContain("HOME=");
    expect(json).not.toContain("schema-bytes-XYZ");
  });

  it("fails with canary_invalid on a malformed or internally inconsistent canary", async () => {
    // Nonce mismatch between challenge and response is internally inconsistent.
    const inconsistent = {
      ...baseCanary(),
      response: {
        schemaVersion: 1 as const,
        nonce: "other-nonce-not-matching",
        checkResult: "2" as const,
        status: "ready" as const,
      },
    } as CanaryReceiptV1;
    const exit = await runIssue({
      prompt: basePrompt(),
      canary: inconsistent,
      issuedAt,
      expiresAt: tokenExpiresAt,
    });
    const error = expectIssuanceFailure(exit);
    expect(error.category).toBe("canary_invalid");
  });

  it("fails with identity_mismatch when prompt hash does not match canary", async () => {
    const canary = {
      ...baseCanary(),
      promptHash: contentHash("99"),
    } as CanaryReceiptV1;
    const exit = await runIssue({
      prompt: basePrompt(),
      canary,
      issuedAt,
      expiresAt: tokenExpiresAt,
    });
    const error = expectIssuanceFailure(exit);
    expect(error.category).toBe("identity_mismatch");
  });

  it("fails with identity_mismatch when review-schema-variant hashes differ", async () => {
    const canary = {
      ...baseCanary(),
      schemaVariantHash: contentHash("77"),
    } as CanaryReceiptV1;
    const exit = await runIssue({
      prompt: basePrompt(),
      canary,
      issuedAt,
      expiresAt: tokenExpiresAt,
    });
    const error = expectIssuanceFailure(exit);
    expect(error.category).toBe("identity_mismatch");
  });

  it("fails with identity_mismatch when prompt profile and canary contract class differ", async () => {
    const canary = {
      ...baseCanary(),
      contractClass: "other-contract-class",
    } as CanaryReceiptV1;
    const exit = await runIssue({
      prompt: basePrompt(),
      canary,
      issuedAt,
      expiresAt: tokenExpiresAt,
    });
    const error = expectIssuanceFailure(exit);
    expect(error.category).toBe("identity_mismatch");
  });

  it("fails with chronology_invalid when issue time is before canary observation", async () => {
    const exit = await runIssue({
      prompt: basePrompt(),
      canary: baseCanary(),
      issuedAt: "2026-08-03T11:59:59.999Z" as UtcTimestamp,
      expiresAt: tokenExpiresAt,
    });
    const error = expectIssuanceFailure(exit);
    expect(error.category).toBe("chronology_invalid");
  });

  it("fails with chronology_invalid when issue time equals token expiry", async () => {
    const same = "2026-08-03T12:02:00.000Z" as UtcTimestamp;
    const exit = await runIssue({
      prompt: basePrompt(),
      canary: baseCanary(),
      issuedAt: same,
      expiresAt: same,
    });
    const error = expectIssuanceFailure(exit);
    expect(error.category).toBe("chronology_invalid");
  });

  it("fails with chronology_invalid when token expiry is after canary expiry", async () => {
    const exit = await runIssue({
      prompt: basePrompt(),
      canary: baseCanary(),
      issuedAt,
      expiresAt: "2026-08-03T12:10:00.001Z" as UtcTimestamp,
    });
    const error = expectIssuanceFailure(exit);
    expect(error.category).toBe("chronology_invalid");
  });

  it("accepts equal canary observation and token issue times", async () => {
    const exit = await runIssue({
      prompt: basePrompt(),
      canary: baseCanary(),
      issuedAt: observedAt,
      expiresAt: tokenExpiresAt,
    });
    expect(exit._tag).toBe("Success");
    if (exit._tag !== "Success") {
      throw new Error("expected success");
    }
    expect(exit.value.token.issuedAt).toBe(observedAt);
    expect(exit.value.canary.observedAt).toBe(observedAt);
  });

  it("accepts equal token and canary expiry times", async () => {
    const exit = await runIssue({
      prompt: basePrompt(),
      canary: baseCanary(),
      issuedAt,
      expiresAt: canaryExpiresAt,
    });
    expect(exit._tag).toBe("Success");
    if (exit._tag !== "Success") {
      throw new Error("expected success");
    }
    expect(exit.value.token.expiresAt).toBe(canaryExpiresAt);
    expect(exit.value.canary.expiresAt).toBe(canaryExpiresAt);
  });

  it("errors do not serialize prompt text, paths, environment data, raw output, or schema bytes", async () => {
    const secretPrompt =
      "PROMPT_BODY_LEAK sk-SECRET-KEY-99 /var/secrets/key HOME=/home/evil";
    const secretEnv = 'PATH=/evil ENV=raw-output-STDOUT-BYTES schema:{"x":1}';
    const malformedPrompt = {
      schemaVersion: 1,
      profile: secretPrompt,
      contractHash: fixedContractHash,
      promptHash,
      schemaVariantHash: reviewSchemaHash,
      canonicalAceText: secretPrompt,
      promptByteLength: 48,
      candidateId,
      bundle: {
        schemaVersion: 1,
        baseSha: "a".repeat(40),
        headSha: "1".repeat(40),
        diffSha256: "b".repeat(64),
      },
      artifactIds: [artifactId],
      responseSchemaArtifactId: artifactId,
      environment: secretEnv,
      path: "/tmp/prompt.ace",
      rawOutput: "STDOUT_LEAK_PAYLOAD",
      schemaBytes: new Uint8Array([1, 2, 3]),
    } as unknown as CanonicalCompiledPromptV1;

    const exit = await runIssue({
      prompt: malformedPrompt,
      canary: baseCanary(),
      issuedAt,
      expiresAt: tokenExpiresAt,
    });
    const error = expectIssuanceFailure(exit);
    expect(error.category).toBe("prompt_invalid");

    const json = JSON.stringify(error);
    expect(json).not.toContain("PROMPT_BODY_LEAK");
    expect(json).not.toContain("sk-SECRET-KEY-99");
    expect(json).not.toContain("/var/secrets/key");
    expect(json).not.toContain("HOME=");
    expect(json).not.toContain("/home/evil");
    expect(json).not.toContain("PATH=");
    expect(json).not.toContain("STDOUT_LEAK");
    expect(json).not.toContain("schema:");
    expect(json).not.toContain("/tmp/prompt.ace");
    expect(json).not.toContain("raw-output");
    // Own enumerable keys stay within the closed secret-safe surface.
    const keys = Object.keys(error).sort();
    for (const key of keys) {
      expect([
        "_tag",
        "category",
        "reason",
        "name",
        "message",
        "stack",
      ]).toContain(key);
    }
  });
});
