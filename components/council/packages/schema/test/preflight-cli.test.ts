import { describe, expect, it } from "vitest";
import {
  PreflightCliRequestV1,
  decodePreflightCliRequestV1,
  decodeStrictSync,
} from "../src/index.js";

const sha40 = "a".repeat(40);
const sha64 = "b".repeat(64);
const artifactDigest = "c".repeat(64);
const artifactId = `sha256:${artifactDigest}`;
const candidateId = "cand_01ARZ3NDEKTSV4RRFFQ69G5FAV";

const lexicon = {
  schemaVersion: 1 as const,
  nouns: ["reviewer", "candidate", "bundle-identity"],
  verbs: [
    { base: "verify", thirdPerson: "verifies" },
    { base: "detect", thirdPerson: "detects" },
  ],
};

const bundle = {
  schemaVersion: 1 as const,
  baseSha: sha40,
  headSha: sha40.replace(/a/g, "1"),
  diffSha256: sha64,
};

const artifact = {
  schemaVersion: 1 as const,
  alias: "diff-patch",
  mediaType: "text/plain",
  byteLength: 12,
  digest: artifactDigest,
  artifactId,
};

const validCouncilPromptContract = {
  schemaVersion: 1 as const,
  profile: "council-ace-1" as const,
  aceSource: "Every reviewer must verify the bundle-identity.",
  lexicon,
  candidateId,
  bundle,
  artifacts: [artifact],
  responseSchemaArtifactId: artifactId,
  limits: {
    maxPromptBytes: 10_000,
    maxArtifactBytes: 1_000_000,
    maxTurns: 1,
    maxWallTimeMs: 60_000,
    maxRetries: 1,
  },
};

const valid = {
  schemaVersion: 1 as const,
  contract: validCouncilPromptContract,
  provider: {
    family: "anthropic" as const,
    executable: "claude",
    model: "claude-opus-4-1",
  },
  observedBundle: {
    baseSha: validCouncilPromptContract.bundle.baseSha,
    headSha: validCouncilPromptContract.bundle.headSha,
    diffPath: "/tmp/council.diff",
  },
  artifactPaths: validCouncilPromptContract.artifacts.map((item) => ({
    artifactId: item.artifactId,
    path: `/tmp/${item.alias}`,
  })),
  cwd: "/tmp/review",
};

describe("PreflightCliRequestV1", () => {
  it("accepts a closed valid request", () => {
    expect(decodeStrictSync(PreflightCliRequestV1, valid)).toEqual(valid);
    expect(decodePreflightCliRequestV1(valid)).toEqual(valid);
  });

  it("rejects unknown top-level fields", () => {
    expect(() =>
      decodeStrictSync(PreflightCliRequestV1, { ...valid, extra: true }),
    ).toThrow();
  });

  it("rejects duplicate artifact path identifiers", () => {
    expect(() =>
      decodeStrictSync(PreflightCliRequestV1, {
        ...valid,
        artifactPaths: [valid.artifactPaths[0], valid.artifactPaths[0]],
      }),
    ).toThrow();
  });

  it("rejects empty paths, model names, executables, and cwd", () => {
    expect(() =>
      decodeStrictSync(PreflightCliRequestV1, {
        ...valid,
        cwd: "",
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(PreflightCliRequestV1, {
        ...valid,
        provider: { ...valid.provider, model: "" },
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(PreflightCliRequestV1, {
        ...valid,
        provider: { ...valid.provider, executable: "   " },
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(PreflightCliRequestV1, {
        ...valid,
        observedBundle: { ...valid.observedBundle, diffPath: "" },
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(PreflightCliRequestV1, {
        ...valid,
        artifactPaths: [{ artifactId, path: "" }],
      }),
    ).toThrow();
  });

  it("rejects unknown nested provider fields", () => {
    expect(() =>
      decodeStrictSync(PreflightCliRequestV1, {
        ...valid,
        provider: { ...valid.provider, extra: "x" },
      }),
    ).toThrow();
  });

  it("accepts google at the request boundary for fail-closed runtime handling", () => {
    const googleRequest = {
      ...valid,
      provider: {
        family: "google" as const,
        executable: "gemini",
        model: "gemini-2.5-pro",
      },
    };
    expect(decodeStrictSync(PreflightCliRequestV1, googleRequest)).toEqual(
      googleRequest,
    );
  });

  it("rejects invalid git commit shapes in observedBundle", () => {
    expect(() =>
      decodeStrictSync(PreflightCliRequestV1, {
        ...valid,
        observedBundle: {
          ...valid.observedBundle,
          baseSha: "not-a-sha",
        },
      }),
    ).toThrow();
  });
});
