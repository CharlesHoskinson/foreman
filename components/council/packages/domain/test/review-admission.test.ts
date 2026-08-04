import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ArtifactId,
  CandidateId,
  ContentHash,
  ContractHash,
  FinalReviewResponseV1,
  GitCommitSha,
  Sha256Digest,
  TerminalObservationV1,
} from "@council/schema";
import {
  decodeStrictSync,
  ReviewAttemptInputV1 as ReviewAttemptInputSchema,
} from "@council/schema";
import { describe, expect, it } from "vitest";
import {
  classifyReviewAttempt,
  isQuorumEligibleClassification,
  type ReviewAttemptInput,
} from "../src/review-admission.js";
import { alignSpecCorrectnessWithClassification } from "../src/spec-correctness-admission.js";
import * as DomainRoot from "../src/index.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const loadFixture = (name: string): ReviewAttemptInput => {
  const raw: unknown = JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
  return decodeStrictSync(ReviewAttemptInputSchema, raw) as ReviewAttemptInput;
};

const sha40 = "a".repeat(40) as GitCommitSha;
const headSha = "1".repeat(40) as GitCommitSha;
const sha64 = "b".repeat(64) as Sha256Digest;
const artifactId = `sha256:${"c".repeat(64)}` as ArtifactId;
const contractHash = `sha256:${"d".repeat(64)}` as ContractHash;
const promptHash = `sha256:${"e".repeat(64)}` as ContentHash;
const readyTokenHash = `sha256:${"f".repeat(64)}` as ContentHash;

const completedTerminal: TerminalObservationV1 = {
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
  stdoutDigest: sha64,
  stderrDigest: sha64,
  errorMessage: null,
};

const expectedBundle = {
  schemaVersion: 1 as const,
  baseSha: sha40,
  headSha,
  diffSha256: sha64,
};

const baseResponse: FinalReviewResponseV1 = {
  schemaVersion: 1,
  readyTokenHash,
  contractHash,
  promptHash,
  bundle: expectedBundle,
  reviewerId: "reviewer-a",
  candidateId: "cand_01ARZ3NDEKTSV4RRFFQ69G5FAV" as CandidateId,
  inspectedArtifactIds: [artifactId],
  advice: {
    kind: "approved",
  },
};

const baseInput = (): ReviewAttemptInput => ({
  preflightStageFailed: false,
  terminal: completedTerminal,
  readyTokenCurrent: true,
  expectedReadyTokenHash: readyTokenHash,
  expectedContractHash: contractHash,
  expectedPromptHash: promptHash,
  expectedBundle,
  expectedReviewerId: "reviewer-a",
  expectedCandidateId: "cand_01ARZ3NDEKTSV4RRFFQ69G5FAV" as CandidateId,
  expectedArtifactIds: [artifactId],
  verifiedArtifactIds: [artifactId],
  bundleVerified: true,
  designatedStructuredValid: true,
  declaredEvidenceNamespace: ["acceptance-criteria", "diff-patch"],
  response: baseResponse,
});

const baseInputWithoutResponse = (): ReviewAttemptInput => {
  const input = baseInput();
  const { response, ...rest } = input;
  void response;
  return rest;
};

describe("classifyReviewAttempt fixtures", () => {
  it("classifies Anthropic $schema rejection as ProviderPreflightFailed", () => {
    const input = loadFixture("anthropic-schema-rejected.json");
    const result = classifyReviewAttempt(input);
    expect(result._tag).toBe("ProviderPreflightFailed");
    if (result._tag !== "ProviderPreflightFailed") return;
    expect(result.failure.reason).toContain(
      'no schema with key or ref "https://json-schema.org/draft/2020-12/schema"',
    );
    expect(result.quorumEligible).toBe(false);
    expect(result.deliberationEligible).toBe(false);
    expect(isQuorumEligibleClassification(result)).toBe(false);
  });

  it("classifies xAI cancelled interim abstention text as ReviewAttemptFailed", () => {
    const input = loadFixture("xai-interim-then-cancelled.json");
    const result = classifyReviewAttempt(input);
    expect(result._tag).toBe("ReviewAttemptFailed");
    if (result._tag !== "ReviewAttemptFailed") return;
    expect(result.quorumEligible).toBe(false);
    expect(result.deliberationEligible).toBe(false);
    expect(input.ordinaryText).toContain("insufficient_evidence");
    expect(result).not.toMatchObject({ _tag: "CompletedAbstention" });
    expect(result).not.toMatchObject({ _tag: "CompletedVerdict" });
  });

  it("classifies a completed abstention without quorum eligibility", () => {
    const input = loadFixture("completed-insufficient-evidence.json");
    const result = classifyReviewAttempt(input);
    expect(result._tag).toBe("CompletedAbstention");
    if (result._tag !== "CompletedAbstention") return;
    expect(result.response.advice.kind).toBe("abstention");
    expect(result.response.advice.abstention.kind).toBe(
      "insufficient_evidence",
    );
    expect(result.response.advice.abstention.evidenceGaps[0].evidenceRef).toBe(
      "acceptance-criteria",
    );
    expect(result.response.advice.abstention.nextAction.length).toBeGreaterThan(
      0,
    );
    expect(result).not.toHaveProperty("abstention");
    expect(result.quorumEligible).toBe(false);
    expect(result.deliberationEligible).toBe(true);
    expect(isQuorumEligibleClassification(result)).toBe(false);
  });
});

describe("classifyReviewAttempt completion gates", () => {
  it("returns CompletedVerdict only for identity-bound completed advice", () => {
    const input = baseInput();
    const result = classifyReviewAttempt(input);
    expect(result).toEqual({
      _tag: "CompletedVerdict",
      response: baseResponse,
      terminal: completedTerminal,
      quorumEligible: true,
      deliberationEligible: true,
    });
    expect(isQuorumEligibleClassification(result)).toBe(true);
  });

  it("rejects nonzero process exit code", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      terminal: { ...completedTerminal, exitCode: 1 },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
    if (result._tag !== "ReviewAttemptFailed") return;
    expect(result.failure.reason).toContain("exit code");
  });

  it("rejects failed tool calls", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      terminal: { ...completedTerminal, failedToolCalls: 1 },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
    if (result._tag !== "ReviewAttemptFailed") return;
    expect(result.failure.reason).toContain("failed tool");
  });

  it("rejects unknown tool state", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      terminal: {
        ...completedTerminal,
        pendingToolCalls: null,
        failedToolCalls: null,
      },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
    if (result._tag !== "ReviewAttemptFailed") return;
    expect(result.failure.reason).toContain("tool state is unknown");
  });

  it("rejects terminal cancellation even with structured output present", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      terminal: {
        ...completedTerminal,
        terminalState: "cancelled",
        stopReason: "Cancelled",
        structuredOutputPresent: true,
        structuredOutputError: null,
      },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("rejects completed state without structured output", () => {
    const result = classifyReviewAttempt({
      ...baseInputWithoutResponse(),
      terminal: {
        ...completedTerminal,
        structuredOutputPresent: false,
        structuredOutputError: "missing designated structured output",
      },
      designatedStructuredValid: false,
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("rejects mismatched ready token hash", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      expectedReadyTokenHash: `sha256:${"1".repeat(64)}` as ContentHash,
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
    if (result._tag !== "ReviewAttemptFailed") return;
    expect(result.failure.reason).toContain("identity");
  });

  it("rejects mismatched contract hash", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      expectedContractHash: `sha256:${"2".repeat(64)}` as ContractHash,
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("rejects mismatched prompt hash", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      expectedPromptHash: `sha256:${"3".repeat(64)}` as ContentHash,
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("rejects mismatched bundle triple", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      expectedBundle: {
        ...expectedBundle,
        headSha: "2".repeat(40) as GitCommitSha,
      },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("rejects mismatched reviewer id", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      expectedReviewerId: "reviewer-b",
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("rejects mismatched candidate id", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      expectedCandidateId: "cand_01ARZ3NDEKTSV4RRFFQ69G5FAW" as CandidateId,
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("rejects missing artifact receipt", () => {
    const extra = `sha256:${"9".repeat(64)}` as ArtifactId;
    const result = classifyReviewAttempt({
      ...baseInput(),
      expectedArtifactIds: [artifactId, extra],
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("rejects extra artifact receipt", () => {
    const extra = `sha256:${"9".repeat(64)}` as ArtifactId;
    const result = classifyReviewAttempt({
      ...baseInput(),
      response: {
        ...baseResponse,
        inspectedArtifactIds: [artifactId, extra],
      },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("rejects reordered artifact receipts", () => {
    const second = `sha256:${"9".repeat(64)}` as ArtifactId;
    const result = classifyReviewAttempt({
      ...baseInput(),
      expectedArtifactIds: [artifactId, second],
      verifiedArtifactIds: [artifactId, second],
      response: {
        ...baseResponse,
        inspectedArtifactIds: [second, artifactId],
      },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("rejects duplicate artifact receipts", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      expectedArtifactIds: [artifactId, artifactId],
      verifiedArtifactIds: [artifactId, artifactId],
      response: {
        ...baseResponse,
        inspectedArtifactIds: [artifactId, artifactId],
      },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("rejects undeclared evidence gap references", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      response: {
        ...baseResponse,
        advice: {
          kind: "abstention",
          abstention: {
            kind: "insufficient_evidence",
            evidenceGaps: [
              {
                evidenceRef: "not-in-namespace",
                unmetCondition: "missing",
              },
            ],
            nextAction: "supply evidence",
          },
        },
      },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
    if (result._tag !== "ReviewAttemptFailed") return;
    expect(result.failure.reason).toContain("evidence");
  });

  it("rejects exit-zero cancellation even when ordinary text looks valid", () => {
    const result = classifyReviewAttempt({
      ...baseInputWithoutResponse(),
      terminal: {
        ...completedTerminal,
        terminalState: "cancelled",
        stopReason: "Cancelled",
        structuredOutputPresent: false,
        structuredOutputError: "model did not produce structured output",
        failedToolCalls: 1,
      },
      designatedStructuredValid: false,
      ordinaryText: JSON.stringify({
        kind: "insufficient_evidence",
        evidenceGaps: [
          {
            evidenceRef: "diff",
            unmetCondition: "not inspected",
          },
        ],
        nextAction: "retry",
      }),
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("rejects a process that never started a model turn", () => {
    const result = classifyReviewAttempt({
      ...baseInputWithoutResponse(),
      terminal: {
        ...completedTerminal,
        modelTurnStarted: false,
        terminalState: "error",
        exitCode: 0,
        errorMessage: "process launched but no model turn",
      },
      readyTokenCurrent: false,
      designatedStructuredValid: false,
    });
    expect(result._tag).toBe("ProviderPreflightFailed");
  });

  it("counts only completed verdicts as quorum eligible", () => {
    const verdict = classifyReviewAttempt({
      ...baseInput(),
      response: {
        ...baseResponse,
        advice: {
          kind: "changes_requested",
          findings: [
            {
              artifactId,
              location: "packages/domain/src/ace.ts:1",
              summary: "material defect",
              nextAction: "fix the rule direction",
            },
          ],
        },
      },
    });
    const abstention = classifyReviewAttempt(
      loadFixture("completed-insufficient-evidence.json"),
    );
    const failed = classifyReviewAttempt(
      loadFixture("xai-interim-then-cancelled.json"),
    );
    expect(isQuorumEligibleClassification(verdict)).toBe(true);
    expect(isQuorumEligibleClassification(abstention)).toBe(false);
    expect(isQuorumEligibleClassification(failed)).toBe(false);
  });

  it("does not start a review when verified artifacts are outside the expected set", () => {
    const unrelated = `sha256:${"9".repeat(64)}` as ArtifactId;
    const result = classifyReviewAttempt({
      ...baseInput(),
      verifiedArtifactIds: [unrelated],
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
    if (result._tag !== "ReviewAttemptFailed") return;
    expect(result.failure.reason).toContain("review did not start");
  });

  it("rejects completed response when verified artifacts are a proper subset of expected", () => {
    const second = `sha256:${"9".repeat(64)}` as ArtifactId;
    const result = classifyReviewAttempt({
      ...baseInput(),
      expectedArtifactIds: [artifactId, second],
      verifiedArtifactIds: [artifactId],
      response: {
        ...baseResponse,
        inspectedArtifactIds: [artifactId, second],
      },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
    if (result._tag !== "ReviewAttemptFailed") return;
    expect(result.failure.reason).toContain("identity");
  });

  it("rejects changes-requested findings that cite an artifact outside the expected set", () => {
    const unrelated = `sha256:${"9".repeat(64)}` as ArtifactId;
    const result = classifyReviewAttempt({
      ...baseInput(),
      response: {
        ...baseResponse,
        advice: {
          kind: "changes_requested",
          findings: [
            {
              artifactId: unrelated,
              location: "file.ts:1",
              summary: "defect",
              nextAction: "fix it",
            },
          ],
        },
      },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
    if (result._tag !== "ReviewAttemptFailed") return;
    expect(result.failure.reason).toContain("findings");
  });

  it("rejects changes-requested findings with whitespace-only operational text", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      response: {
        ...baseResponse,
        advice: {
          kind: "changes_requested",
          findings: [
            {
              artifactId,
              location: "   ",
              summary: "defect",
              nextAction: "fix it",
            },
          ],
        },
      },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
  });

  it("finding 3: completed terminal with stopReason Cancelled is ReviewAttemptFailed", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      terminal: {
        ...completedTerminal,
        terminalState: "completed",
        stopReason: "Cancelled",
      },
    });
    expect(result._tag).toBe("ReviewAttemptFailed");
    if (result._tag !== "ReviewAttemptFailed") return;
    expect(result.quorumEligible).toBe(false);
    expect(result.deliberationEligible).toBe(false);
  });

  it("finding 4: contradictory false-plus-failure is ProviderPreflightFailed", () => {
    const result = classifyReviewAttempt({
      ...baseInput(),
      preflightStageFailed: false,
      preflightFailure: {
        stage: "provider",
        reason: "schema rejected",
        retry: "changed_preflight",
      },
    });
    expect(result._tag).toBe("ProviderPreflightFailed");
    expect(result.quorumEligible).toBe(false);
    expect(result.deliberationEligible).toBe(false);
  });

  it("finding 4: preflightFailure alone is ProviderPreflightFailed", () => {
    const result = classifyReviewAttempt({
      ...baseInputWithoutResponse(),
      preflightStageFailed: false,
      preflightFailure: {
        stage: "provider",
        reason: "auth failed",
        retry: "changed_preflight",
      },
      designatedStructuredValid: false,
    });
    expect(result._tag).toBe("ProviderPreflightFailed");
  });
});

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

describe("alignSpecCorrectnessWithClassification", () => {
  it("is not exported from the domain root barrel", () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        DomainRoot,
        "alignSpecCorrectnessWithClassification",
      ),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(
        DomainRoot,
        "SpecCorrectnessClassificationAlignment",
      ),
    ).toBe(false);
  });

  it("aligns Valid/accept with CompletedVerdict approved", () => {
    const classification = classifyReviewAttempt(baseInput());
    const alignment = alignSpecCorrectnessWithClassification(
      {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "accept",
        metrics: cleanMetrics,
        findings: [],
      },
      classification,
    );
    expect(alignment).toEqual({ _tag: "approved" });
  });

  it("aligns Valid/changes_requested with CompletedVerdict changes", () => {
    const response: FinalReviewResponseV1 = {
      ...baseResponse,
      advice: {
        kind: "changes_requested",
        findings: [
          {
            artifactId,
            location: "row 1",
            summary: "defect",
            nextAction: "fix",
          },
        ],
      },
    };
    const classification = classifyReviewAttempt({
      ...baseInput(),
      response,
    });
    const alignment = alignSpecCorrectnessWithClassification(
      {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "changes_requested",
        metrics: {
          ...cleanMetrics,
          mappedItemCount: 43,
          omittedItemCount: 1,
          coverageRatio: { numerator: 43, denominator: 44 },
        },
        findings: [
          {
            location: "coverage",
            summary: "omission",
            nextAction: "map it",
          },
        ],
      },
      classification,
    );
    expect(alignment).toEqual({ _tag: "changes_requested" });
  });

  it("aligns Valid/abstain with CompletedAbstention and never quorum", () => {
    const response: FinalReviewResponseV1 = {
      ...baseResponse,
      advice: {
        kind: "abstention",
        abstention: {
          kind: "insufficient_evidence",
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
    const classification = classifyReviewAttempt({
      ...baseInput(),
      response,
    });
    expect(isQuorumEligibleClassification(classification)).toBe(false);
    const alignment = alignSpecCorrectnessWithClassification(
      {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "abstain",
        metrics: cleanMetrics,
        evidenceGaps: [
          {
            evidenceRef: "acceptance-criteria",
            unmetCondition: "missing proof",
          },
        ],
        nextAction: "supply evidence",
      },
      classification,
    );
    expect(alignment).toEqual({ _tag: "abstention" });
  });

  it("rejects Invalid evaluation and advice mismatches", () => {
    const approved = classifyReviewAttempt(baseInput());
    expect(
      alignSpecCorrectnessWithClassification(
        {
          schemaVersion: 1,
          _tag: "Invalid",
          reason: "provider_response_invalid",
        },
        approved,
      )._tag,
    ).toBe("mismatch");

    expect(
      alignSpecCorrectnessWithClassification(
        {
          schemaVersion: 1,
          _tag: "Valid",
          outcome: "accept",
          metrics: cleanMetrics,
          findings: [],
        },
        classifyReviewAttempt({
          ...baseInput(),
          response: {
            ...baseResponse,
            advice: {
              kind: "changes_requested",
              findings: [
                {
                  artifactId,
                  location: "x",
                  summary: "y",
                  nextAction: "z",
                },
              ],
            },
          },
        }),
      )._tag,
    ).toBe("mismatch");

    expect(
      alignSpecCorrectnessWithClassification(
        {
          schemaVersion: 1,
          _tag: "Valid",
          outcome: "abstain",
          metrics: cleanMetrics,
          evidenceGaps: [
            {
              evidenceRef: "acceptance-criteria",
              unmetCondition: "missing",
            },
          ],
          nextAction: "act",
        },
        approved,
      )._tag,
    ).toBe("mismatch");
  });
});
