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
import { describe, expect, it } from "vitest";
import {
  classifyReviewAttempt,
  isQuorumEligibleClassification,
  type ReviewAttemptInput,
} from "../src/review-admission.js";
import { alignSpecCorrectnessWithClassification } from "../src/spec-correctness-admission.js";

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

describe("alignSpecCorrectnessWithClassification — CompletedInvalidResponse", () => {
  it("cannot align CompletedInvalidResponse/schema_invalid with Valid/accept", () => {
    const { response: _omit, ...withoutResponse } = baseInput();
    void _omit;
    const classification = classifyReviewAttempt({
      ...withoutResponse,
      designatedStructuredValid: false,
    });
    expect(classification._tag).toBe("CompletedInvalidResponse");
    if (classification._tag !== "CompletedInvalidResponse") return;
    expect(classification.reason).toBe("schema_invalid");
    expect(isQuorumEligibleClassification(classification)).toBe(false);

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
    expect(alignment._tag).toBe("mismatch");
  });

  it("cannot align CompletedInvalidResponse/findings_invalid with Valid/changes_requested", () => {
    const unrelated = `sha256:${"9".repeat(64)}` as ArtifactId;
    const classification = classifyReviewAttempt({
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
    expect(classification._tag).toBe("CompletedInvalidResponse");
    if (classification._tag !== "CompletedInvalidResponse") return;
    expect(classification.reason).toBe("findings_invalid");

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
    expect(alignment._tag).toBe("mismatch");
  });

  it("cannot align CompletedInvalidResponse/abstention_invalid with Valid/abstain", () => {
    const classification = classifyReviewAttempt({
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
    expect(classification._tag).toBe("CompletedInvalidResponse");
    if (classification._tag !== "CompletedInvalidResponse") return;
    expect(classification.reason).toBe("abstention_invalid");

    const alignment = alignSpecCorrectnessWithClassification(
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
      classification,
    );
    expect(alignment._tag).toBe("mismatch");
  });
});
