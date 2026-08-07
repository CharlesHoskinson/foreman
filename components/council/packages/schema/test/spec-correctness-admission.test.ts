import { describe, expect, it } from "vitest";
import { decodeStrictSync } from "../src/index.js";
import * as SchemaRoot from "../src/index.js";
import {
  BoundSpecCorrectnessEvaluationV1,
  containsUnsafePublicFreeText,
  GitTreeSha,
  SpecCorrectnessAdmissionInputV1,
  SpecCorrectnessAdmissionResultV1,
  SpecCorrectnessArtifactRolesV1,
  SpecCorrectnessCliRequestV1,
  SpecCorrectnessIdentityV1,
  SpecCorrectnessProviderSubmissionV1,
  decodeSpecCorrectnessCliRequestV1,
} from "../src/spec-correctness-admission.js";
import * as AdmissionSubpath from "../src/spec-correctness-admission.js";

const sha40 = (nibble: string): string => nibble.repeat(40);
const sha64 = (nibble: string): string => nibble.repeat(64);
const contentHash = (nibble: string): string => `sha256:${sha64(nibble)}`;
const artifactId = (nibble: string): string => `sha256:${sha64(nibble)}`;

const headSha = sha40("1");
const baseSha = sha40("a");
const treeSha = sha40("2");
const diffDigest = sha64("b");
const matrixDigest = sha64("c");
const ledgerDigest = sha64("d");
const specDigest = sha64("e");
const matrixId = artifactId("c");
const ledgerId = artifactId("d");
const specId = artifactId("e");
const readyTokenHash = contentHash("f");
const contractHash = contentHash("0");
const promptHash = contentHash("1");
const providerReceiptHash = contentHash("2");
const schemaVariantHash = contentHash("3");
const candidateId = "cand_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const reviewerId = "reviewer-a";

const identity = {
  schemaVersion: 1 as const,
  candidateCommitSha: headSha,
  candidateTreeSha: treeSha,
  baseCommitSha: baseSha,
  diffSha256: diffDigest,
  ledgerSha256: ledgerDigest,
  coverageMatrixSha256: matrixDigest,
  specSetSha256: sha64("9"),
  reviewerId,
  providerFamily: "xai" as const,
  providerReceiptHash,
  readyTokenHash,
  contractHash,
  promptHash,
  responseSchemaVariantHash: schemaVariantHash,
};

const completedTerminal = {
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
  stdoutDigest: sha64("8"),
  stderrDigest: sha64("7"),
  errorMessage: null,
};

const expectedBundle = {
  schemaVersion: 1 as const,
  baseSha,
  headSha,
  diffSha256: diffDigest,
};

const approvedResponse = {
  schemaVersion: 1 as const,
  readyTokenHash,
  contractHash,
  promptHash,
  bundle: expectedBundle,
  reviewerId,
  candidateId,
  inspectedArtifactIds: [matrixId, ledgerId, specId],
  advice: { kind: "approved" as const },
};

const reviewAttempt = {
  preflightStageFailed: false,
  terminal: completedTerminal,
  readyTokenCurrent: true,
  expectedReadyTokenHash: readyTokenHash,
  expectedContractHash: contractHash,
  expectedPromptHash: promptHash,
  expectedBundle,
  expectedReviewerId: reviewerId,
  expectedCandidateId: candidateId,
  expectedArtifactIds: [matrixId, ledgerId, specId],
  verifiedArtifactIds: [matrixId, ledgerId, specId],
  bundleVerified: true,
  designatedStructuredValid: true,
  declaredEvidenceNamespace: ["acceptance-criteria"],
  response: approvedResponse,
};

const matrixArtifact = {
  schemaVersion: 1 as const,
  alias: "coverage-matrix",
  mediaType: "text/markdown",
  byteLength: 100,
  digest: matrixDigest,
  artifactId: matrixId,
};

const ledgerArtifact = {
  schemaVersion: 1 as const,
  alias: "ledger",
  mediaType: "text/markdown",
  byteLength: 200,
  digest: ledgerDigest,
  artifactId: ledgerId,
};

const specArtifact = {
  schemaVersion: 1 as const,
  alias: "spec-a",
  mediaType: "text/markdown",
  byteLength: 50,
  digest: specDigest,
  artifactId: specId,
};

const roles = {
  coverageMatrixArtifactId: matrixId,
  ledgerArtifactId: ledgerId,
  specSetArtifactIds: [specId] as const,
};

const admissionInput = {
  schemaVersion: 1 as const,
  reviewAttempt,
  expectedIdentity: identity,
  observedIdentity: identity,
  submission: {
    identity,
    response: { schemaVersion: 1, outcome: "accept" },
  },
  artifacts: [matrixArtifact, ledgerArtifact, specArtifact],
  roles,
};

const cleanMetrics = {
  schemaVersion: 1 as const,
  baselineItemCount: 44 as const,
  mappedItemCount: 44,
  evidencedDeferCount: 0,
  omittedItemCount: 0,
  contradictionCount: 0,
  unevidencedDeferCount: 0,
  inventedCompletionCount: 0,
  coverageRatio: { numerator: 44, denominator: 44 as const },
};

const defectMetrics = {
  ...cleanMetrics,
  mappedItemCount: 43,
  omittedItemCount: 1,
  coverageRatio: { numerator: 43, denominator: 44 as const },
};

const acceptEvaluation = {
  schemaVersion: 1 as const,
  _tag: "Valid" as const,
  outcome: "accept" as const,
  metrics: cleanMetrics,
  findings: [] as const,
};

const changesEvaluation = {
  schemaVersion: 1 as const,
  _tag: "Valid" as const,
  outcome: "changes_requested" as const,
  metrics: defectMetrics,
  findings: [
    {
      location: "coverage-matrix.md",
      summary: "one defect",
      nextAction: "repair",
    },
  ],
};

const abstainEvaluation = {
  schemaVersion: 1 as const,
  _tag: "Valid" as const,
  outcome: "abstain" as const,
  metrics: cleanMetrics,
  evidenceGaps: [
    {
      evidenceRef: "acceptance-criteria",
      unmetCondition: "missing proof",
    },
  ],
  nextAction: "supply evidence",
};

const bound = (evaluation: unknown) => ({
  schemaVersion: 1 as const,
  identity,
  evaluation,
});

const completedVerdict = {
  _tag: "CompletedVerdict" as const,
  response: approvedResponse,
  terminal: completedTerminal,
  quorumEligible: true as const,
  deliberationEligible: true as const,
};

const changesResponse = {
  ...approvedResponse,
  advice: {
    kind: "changes_requested" as const,
    findings: [
      {
        artifactId: matrixId,
        location: "row 1",
        summary: "defect",
        nextAction: "fix",
      },
    ],
  },
};

const completedChangesVerdict = {
  _tag: "CompletedVerdict" as const,
  response: changesResponse,
  terminal: completedTerminal,
  quorumEligible: true as const,
  deliberationEligible: true as const,
};

const abstentionResponse = {
  ...approvedResponse,
  advice: {
    kind: "abstention" as const,
    abstention: {
      kind: "insufficient_evidence" as const,
      evidenceGaps: [
        {
          evidenceRef: "acceptance-criteria",
          unmetCondition: "missing proof",
        },
      ],
      nextAction: "supply evidence",
    },
  },
};

const completedAbstention = {
  _tag: "CompletedAbstention" as const,
  response: abstentionResponse,
  terminal: completedTerminal,
  quorumEligible: false as const,
  deliberationEligible: true as const,
};

describe("GitTreeSha", () => {
  it("accepts lowercase 40-hex and rejects mixed case or wrong length", () => {
    expect(decodeStrictSync(GitTreeSha, treeSha)).toBe(treeSha);
    expect(() => decodeStrictSync(GitTreeSha, "A".repeat(40))).toThrow();
    expect(() => decodeStrictSync(GitTreeSha, "a".repeat(39))).toThrow();
  });
});

describe("SpecCorrectnessIdentityV1", () => {
  it("accepts a complete identity and rejects excess properties", () => {
    expect(decodeStrictSync(SpecCorrectnessIdentityV1, identity)).toEqual(
      identity,
    );
    expect(() =>
      decodeStrictSync(SpecCorrectnessIdentityV1, {
        ...identity,
        extra: true,
      }),
    ).toThrow();
  });

  it("rejects blank reviewerId and uppercase commit sha", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessIdentityV1, {
        ...identity,
        reviewerId: "   ",
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(SpecCorrectnessIdentityV1, {
        ...identity,
        candidateCommitSha: "A".repeat(40),
      }),
    ).toThrow();
  });
});

describe("SpecCorrectnessArtifactRolesV1", () => {
  it("accepts unique role IDs and rejects duplicates", () => {
    expect(decodeStrictSync(SpecCorrectnessArtifactRolesV1, roles)).toEqual(
      roles,
    );
    expect(() =>
      decodeStrictSync(SpecCorrectnessArtifactRolesV1, {
        coverageMatrixArtifactId: matrixId,
        ledgerArtifactId: matrixId,
        specSetArtifactIds: [specId],
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(SpecCorrectnessArtifactRolesV1, {
        coverageMatrixArtifactId: matrixId,
        ledgerArtifactId: ledgerId,
        specSetArtifactIds: [specId, specId],
      }),
    ).toThrow();
  });
});

describe("SpecCorrectnessProviderSubmissionV1", () => {
  it("passes response through without decoding shape", () => {
    const weird = { not: "a provider response", nested: [1, 2, 3] };
    const decoded = decodeStrictSync(SpecCorrectnessProviderSubmissionV1, {
      identity,
      response: weird,
    });
    expect(decoded.response).toEqual(weird);
  });
});

describe("SpecCorrectnessAdmissionInputV1", () => {
  it("accepts unique descriptors equal to the role set", () => {
    expect(
      decodeStrictSync(SpecCorrectnessAdmissionInputV1, admissionInput),
    ).toEqual(admissionInput);
  });

  it("rejects duplicate artifact IDs", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionInputV1, {
        ...admissionInput,
        artifacts: [matrixArtifact, matrixArtifact, ledgerArtifact],
        roles: {
          coverageMatrixArtifactId: matrixId,
          ledgerArtifactId: ledgerId,
          specSetArtifactIds: [matrixId],
        },
      }),
    ).toThrow();
  });

  it("rejects duplicate aliases", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionInputV1, {
        ...admissionInput,
        artifacts: [
          matrixArtifact,
          ledgerArtifact,
          { ...specArtifact, alias: "coverage-matrix" },
        ],
      }),
    ).toThrow();
  });

  it("rejects unrelated descriptors outside the role set", () => {
    const extraDigest = sha64("6");
    const extraId = artifactId("6");
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionInputV1, {
        ...admissionInput,
        artifacts: [
          matrixArtifact,
          ledgerArtifact,
          specArtifact,
          {
            schemaVersion: 1,
            alias: "extra",
            mediaType: "text/plain",
            byteLength: 1,
            digest: extraDigest,
            artifactId: extraId,
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects missing role descriptors", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionInputV1, {
        ...admissionInput,
        artifacts: [matrixArtifact, ledgerArtifact],
      }),
    ).toThrow();
  });

  it("rejects excess properties", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionInputV1, {
        ...admissionInput,
        path: "/secret/path",
      }),
    ).toThrow();
  });

  it("rejects unrelated review-attempt expectedArtifactIds (cold-audit oracle)", () => {
    // Unrelated valid artifact IDs for expected/verified/inspected while
    // admission descriptors and roles remain the real matrix/ledger/spec set.
    const unrelatedA = artifactId("7");
    const unrelatedB = artifactId("8");
    const unrelatedC = artifactId("9");
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionInputV1, {
        ...admissionInput,
        reviewAttempt: {
          ...reviewAttempt,
          expectedArtifactIds: [unrelatedA, unrelatedB, unrelatedC],
          verifiedArtifactIds: [unrelatedA, unrelatedB, unrelatedC],
          response: {
            ...approvedResponse,
            inspectedArtifactIds: [unrelatedA, unrelatedB, unrelatedC],
          },
        },
      }),
    ).toThrow();
  });
});

describe("SpecCorrectnessCliRequestV1", () => {
  const cliRequest = {
    input: admissionInput,
    artifactPaths: [
      { artifactId: matrixId, path: "/tmp/matrix.md" },
      { artifactId: ledgerId, path: "/tmp/ledger.md" },
      { artifactId: specId, path: "/tmp/spec.md" },
    ],
  };

  it("accepts matching path IDs and decodes via public decoder", () => {
    expect(decodeStrictSync(SpecCorrectnessCliRequestV1, cliRequest)).toEqual(
      cliRequest,
    );
    expect(decodeSpecCorrectnessCliRequestV1(cliRequest)).toEqual(cliRequest);
  });

  it("rejects blank path", () => {
    expect(() =>
      decodeSpecCorrectnessCliRequestV1({
        ...cliRequest,
        artifactPaths: [
          { artifactId: matrixId, path: "  " },
          { artifactId: ledgerId, path: "/tmp/ledger.md" },
          { artifactId: specId, path: "/tmp/spec.md" },
        ],
      }),
    ).toThrow();
  });

  it("rejects duplicate path artifact IDs", () => {
    expect(() =>
      decodeSpecCorrectnessCliRequestV1({
        ...cliRequest,
        artifactPaths: [
          { artifactId: matrixId, path: "/tmp/a" },
          { artifactId: matrixId, path: "/tmp/b" },
          { artifactId: ledgerId, path: "/tmp/c" },
        ],
      }),
    ).toThrow();
  });

  it("rejects missing path for a descriptor", () => {
    expect(() =>
      decodeSpecCorrectnessCliRequestV1({
        ...cliRequest,
        artifactPaths: [
          { artifactId: matrixId, path: "/tmp/matrix.md" },
          { artifactId: ledgerId, path: "/tmp/ledger.md" },
        ],
      }),
    ).toThrow();
  });

  it("rejects extra path not in descriptors", () => {
    const extraId = artifactId("6");
    expect(() =>
      decodeSpecCorrectnessCliRequestV1({
        ...cliRequest,
        artifactPaths: [
          ...cliRequest.artifactPaths,
          { artifactId: extraId, path: "/tmp/extra" },
        ],
      }),
    ).toThrow();
  });
});

describe("BoundSpecCorrectnessEvaluationV1 and result union", () => {
  it("accepts bound accept evaluation", () => {
    expect(
      decodeStrictSync(
        BoundSpecCorrectnessEvaluationV1,
        bound(acceptEvaluation),
      ),
    ).toMatchObject({ evaluation: { outcome: "accept" } });
  });

  it("accepts CompletedApproved only with matching pairings", () => {
    const approved = {
      schemaVersion: 1 as const,
      _tag: "CompletedApproved" as const,
      evaluation: bound(acceptEvaluation),
      classification: completedVerdict,
      quorumEligible: true as const,
      candidateDisposition: "approved" as const,
    };
    expect(
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, approved),
    ).toEqual(approved);

    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        ...approved,
        evaluation: bound(changesEvaluation),
      }),
    ).toThrow();

    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        ...approved,
        classification: completedChangesVerdict,
      }),
    ).toThrow();
  });

  it("accepts CompletedChangesRequested only with matching pairings", () => {
    const changes = {
      schemaVersion: 1 as const,
      _tag: "CompletedChangesRequested" as const,
      evaluation: bound(changesEvaluation),
      classification: completedChangesVerdict,
      quorumEligible: true as const,
      candidateDisposition: "changes_requested" as const,
    };
    expect(decodeStrictSync(SpecCorrectnessAdmissionResultV1, changes)).toEqual(
      changes,
    );
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        ...changes,
        evaluation: bound(acceptEvaluation),
      }),
    ).toThrow();
  });

  it("accepts CompletedAbstention only with Valid/abstain and non-quorum", () => {
    const abstention = {
      schemaVersion: 1 as const,
      _tag: "CompletedAbstention" as const,
      evaluation: bound(abstainEvaluation),
      classification: completedAbstention,
      quorumEligible: false as const,
      candidateDisposition: "abstention" as const,
    };
    expect(
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, abstention),
    ).toEqual(abstention);
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        ...abstention,
        quorumEligible: true,
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        ...abstention,
        evaluation: bound(acceptEvaluation),
      }),
    ).toThrow();
  });

  it("accepts Rejected with secret-safe failure and optional evaluation", () => {
    const rejected = {
      schemaVersion: 1 as const,
      _tag: "Rejected" as const,
      failure: {
        stage: "parse" as const,
        reason: "identity mismatch",
        retry: "new_contract" as const,
      },
      evaluation: null,
      quorumEligible: false as const,
      candidateDisposition: "changes_requested" as const,
    };
    expect(
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, rejected),
    ).toEqual(rejected);

    const withEval = {
      ...rejected,
      evaluation: bound({
        schemaVersion: 1,
        _tag: "Invalid",
        reason: "provider_response_invalid",
      }),
    };
    expect(
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, withEval),
    ).toEqual(withEval);
  });

  it("accepts ResponseRejected with CompletedInvalidResponse, null evaluation, and never quorum", () => {
    const responseRejected = {
      schemaVersion: 1 as const,
      _tag: "ResponseRejected" as const,
      evaluation: null,
      classification: {
        _tag: "CompletedInvalidResponse" as const,
        reason: "schema_invalid" as const,
        terminal: completedTerminal,
        quorumEligible: false as const,
        deliberationEligible: false as const,
      },
      quorumEligible: false as const,
      candidateDisposition: "changes_requested" as const,
    };
    expect(
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, responseRejected),
    ).toEqual(responseRejected);

    const findingsInvalid = {
      ...responseRejected,
      classification: {
        ...responseRejected.classification,
        reason: "findings_invalid" as const,
      },
    };
    expect(
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, findingsInvalid),
    ).toEqual(findingsInvalid);

    // Bound accept evaluation beside a rejected provider response is closed out.
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        ...responseRejected,
        evaluation: bound(acceptEvaluation),
      }),
    ).toThrow();

    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        ...responseRejected,
        quorumEligible: true,
      }),
    ).toThrow();

    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        ...responseRejected,
        classification: completedVerdict,
      }),
    ).toThrow();

    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        ...responseRejected,
        failure: {
          stage: "parse",
          reason: "should not appear",
          retry: "same_contract",
        },
      }),
    ).toThrow();
  });

  it("rejects result shapes that carry path or raw response fields", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        schemaVersion: 1,
        _tag: "Rejected",
        failure: {
          stage: "parse",
          reason: "x",
          retry: "same_contract",
        },
        evaluation: null,
        quorumEligible: false,
        candidateDisposition: "changes_requested",
        path: "/tmp/secret",
      }),
    ).toThrow();
  });

  it("rejects mixed evaluation/classification identities on every completed branch", () => {
    const otherHead = sha40("9");
    const otherIdentity = {
      ...identity,
      candidateCommitSha: otherHead,
    };
    const otherBundle = {
      ...expectedBundle,
      headSha: otherHead,
    };
    const otherApprovedResponse = {
      ...approvedResponse,
      bundle: otherBundle,
    };
    const otherVerdict = {
      ...completedVerdict,
      response: otherApprovedResponse,
    };

    // Evaluation identity for commit 1..., classification for commit 9...
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        schemaVersion: 1,
        _tag: "CompletedApproved",
        evaluation: {
          schemaVersion: 1,
          identity,
          evaluation: acceptEvaluation,
        },
        classification: otherVerdict,
        quorumEligible: true,
        candidateDisposition: "approved",
      }),
    ).toThrow();

    const otherChangesResponse = {
      ...changesResponse,
      bundle: otherBundle,
    };
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        schemaVersion: 1,
        _tag: "CompletedChangesRequested",
        evaluation: {
          schemaVersion: 1,
          identity,
          evaluation: changesEvaluation,
        },
        classification: {
          ...completedChangesVerdict,
          response: otherChangesResponse,
        },
        quorumEligible: true,
        candidateDisposition: "changes_requested",
      }),
    ).toThrow();

    const otherAbstentionResponse = {
      ...abstentionResponse,
      bundle: otherBundle,
    };
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        schemaVersion: 1,
        _tag: "CompletedAbstention",
        evaluation: {
          schemaVersion: 1,
          identity,
          evaluation: abstainEvaluation,
        },
        classification: {
          ...completedAbstention,
          response: otherAbstentionResponse,
        },
        quorumEligible: false,
        candidateDisposition: "abstention",
      }),
    ).toThrow();

    // Same commit SHAs but mismatched ready/contract/prompt/reviewer also fail.
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        schemaVersion: 1,
        _tag: "CompletedApproved",
        evaluation: {
          schemaVersion: 1,
          identity: { ...identity, reviewerId: "reviewer-b" },
          evaluation: acceptEvaluation,
        },
        classification: completedVerdict,
        quorumEligible: true,
        candidateDisposition: "approved",
      }),
    ).toThrow();

    // Hostile pairing with otherwise-valid otherIdentity on evaluation only.
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
        schemaVersion: 1,
        _tag: "CompletedApproved",
        evaluation: {
          schemaVersion: 1,
          identity: otherIdentity,
          evaluation: acceptEvaluation,
        },
        classification: completedVerdict,
        quorumEligible: true,
        candidateDisposition: "approved",
      }),
    ).toThrow();
  });

  it("rejects operational path and secret free text on every public result branch", () => {
    expect(containsUnsafePublicFreeText("sha256:" + sha64("a"))).toBe(false);
    expect(containsUnsafePublicFreeText(sha64("a"))).toBe(false);
    expect(containsUnsafePublicFreeText("acceptance-criteria")).toBe(false);
    expect(containsUnsafePublicFreeText("coverage-matrix")).toBe(false);
    expect(containsUnsafePublicFreeText("row 1")).toBe(false);
    expect(containsUnsafePublicFreeText(candidateId)).toBe(false);
    expect(containsUnsafePublicFreeText("see /tmp/secret.md")).toBe(true);
    expect(containsUnsafePublicFreeText("HOME=/home/evil")).toBe(true);
    expect(containsUnsafePublicFreeText("process.env.API_KEY")).toBe(true);
    expect(
      containsUnsafePublicFreeText(
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      ),
    ).toBe(true);
    expect(containsUnsafePublicFreeText("token sk-SECRET-KEY-99xxxx")).toBe(
      true,
    );

    // Cold-audit and extended operational secret shapes (table-driven).
    const githubClassicPat = `ghp_${"A".repeat(36)}`;
    const secretForms: readonly string[] = [
      githubClassicPat,
      `github_pat_${"A".repeat(22)}_${"B".repeat(59)}`,
      `glpat-${"A".repeat(20)}`,
      `npm_${"A".repeat(36)}`,
      `pypi-AgEI${"A".repeat(40)}`,
      "AKIAIOSFODNN7EXAMPLE",
      `AIza${"A".repeat(35)}`,
      `sk_live_${"A".repeat(24)}`,
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature",
      "password=super-secret-value",
      "secret=super-secret-value",
      "token=super-secret-value",
      "api_key=super-secret-value",
      "api-key=super-secret-value",
    ];
    for (const form of secretForms) {
      expect(containsUnsafePublicFreeText(form)).toBe(true);
      expect(containsUnsafePublicFreeText(`finding mentions ${form}`)).toBe(
        true,
      );
      const rejectedWithForm = {
        schemaVersion: 1 as const,
        _tag: "Rejected" as const,
        failure: {
          stage: "parse" as const,
          reason: `failed with ${form}`,
          retry: "new_contract" as const,
        },
        evaluation: null,
        quorumEligible: false as const,
        candidateDisposition: "changes_requested" as const,
      };
      expect(() =>
        decodeStrictSync(SpecCorrectnessAdmissionResultV1, rejectedWithForm),
      ).toThrow();
    }

    const approvedUnsafe = {
      schemaVersion: 1 as const,
      _tag: "CompletedApproved" as const,
      evaluation: bound(acceptEvaluation),
      classification: {
        ...completedVerdict,
        response: {
          ...approvedResponse,
          reviewerId: "reviewer /tmp/secret",
        },
      },
      quorumEligible: true as const,
      candidateDisposition: "approved" as const,
    };
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, approvedUnsafe),
    ).toThrow();

    const changesUnsafe = {
      schemaVersion: 1 as const,
      _tag: "CompletedChangesRequested" as const,
      evaluation: bound(changesEvaluation),
      classification: {
        ...completedChangesVerdict,
        response: {
          ...changesResponse,
          advice: {
            kind: "changes_requested" as const,
            findings: [
              {
                artifactId: matrixId,
                location: "row 1",
                summary: "defect at /home/secret/path",
                nextAction: "fix",
              },
            ],
          },
        },
      },
      quorumEligible: true as const,
      candidateDisposition: "changes_requested" as const,
    };
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, changesUnsafe),
    ).toThrow();

    const abstentionUnsafe = {
      schemaVersion: 1 as const,
      _tag: "CompletedAbstention" as const,
      evaluation: bound(abstainEvaluation),
      classification: {
        ...completedAbstention,
        response: {
          ...abstentionResponse,
          advice: {
            kind: "abstention" as const,
            abstention: {
              kind: "insufficient_evidence" as const,
              evidenceGaps: [
                {
                  evidenceRef: "acceptance-criteria",
                  unmetCondition: "missing proof HOME=/tmp",
                },
              ],
              nextAction: "supply evidence",
            },
          },
        },
      },
      quorumEligible: false as const,
      candidateDisposition: "abstention" as const,
    };
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, abstentionUnsafe),
    ).toThrow();

    const rejectedUnsafe = {
      schemaVersion: 1 as const,
      _tag: "Rejected" as const,
      failure: {
        stage: "parse" as const,
        reason: "failed at /tmp/secret sk-SECRET-KEY-99xxxx",
        retry: "new_contract" as const,
      },
      evaluation: null,
      quorumEligible: false as const,
      candidateDisposition: "changes_requested" as const,
    };
    expect(() =>
      decodeStrictSync(SpecCorrectnessAdmissionResultV1, rejectedUnsafe),
    ).toThrow();

    // Evaluation findings with secrets also fail closed when bound into Rejected.
    const rejectedWithUnsafeEval = {
      schemaVersion: 1 as const,
      _tag: "Rejected" as const,
      failure: {
        stage: "parse" as const,
        reason: "identity mismatch",
        retry: "new_contract" as const,
      },
      evaluation: bound({
        ...changesEvaluation,
        findings: [
          {
            location: "/var/secrets/key",
            summary: "leak",
            nextAction: "repair",
          },
        ],
      }),
      quorumEligible: false as const,
      candidateDisposition: "changes_requested" as const,
    };
    expect(() =>
      decodeStrictSync(
        SpecCorrectnessAdmissionResultV1,
        rejectedWithUnsafeEval,
      ),
    ).toThrow();
  });
});

describe("schema admission export boundary", () => {
  it("exports admission schemas only from the explicit subpath", () => {
    expect(AdmissionSubpath.GitTreeSha).toBeDefined();
    expect(AdmissionSubpath.SpecCorrectnessIdentityV1).toBeDefined();
    expect(AdmissionSubpath.SpecCorrectnessArtifactRolesV1).toBeDefined();
    expect(AdmissionSubpath.SpecCorrectnessProviderSubmissionV1).toBeDefined();
    expect(AdmissionSubpath.SpecCorrectnessAdmissionInputV1).toBeDefined();
    expect(AdmissionSubpath.SpecCorrectnessCliArtifactPathV1).toBeDefined();
    expect(AdmissionSubpath.SpecCorrectnessCliRequestV1).toBeDefined();
    expect(AdmissionSubpath.BoundSpecCorrectnessEvaluationV1).toBeDefined();
    expect(AdmissionSubpath.SpecCorrectnessAdmissionResultV1).toBeDefined();
    expect(typeof AdmissionSubpath.decodeSpecCorrectnessCliRequestV1).toBe(
      "function",
    );
    expect(typeof AdmissionSubpath.containsUnsafePublicFreeText).toBe(
      "function",
    );

    // Root barrel must not re-export admission symbols.
    expect(
      (SchemaRoot as Record<string, unknown>).SpecCorrectnessAdmissionResultV1,
    ).toBeUndefined();
    expect(
      (SchemaRoot as Record<string, unknown>).SpecCorrectnessIdentityV1,
    ).toBeUndefined();
    expect(
      (SchemaRoot as Record<string, unknown>).decodeSpecCorrectnessCliRequestV1,
    ).toBeUndefined();
    expect((SchemaRoot as Record<string, unknown>).GitTreeSha).toBeUndefined();
  });
});
