import type {
  ArtifactId,
  CandidateId,
  ContentHash,
  ContractHash,
  EpochMilliseconds,
  FailureDomainId,
  GitCommitSha,
  Sha256Digest,
  TerminalObservationV1,
} from "@council/schema";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  confidenceWeightEligible,
  evaluateAutomaticQuorum,
  evaluateCompletedReviewQuorum,
  type ReviewAttemptClassification,
} from "../src/index.js";

const baseSha = "a".repeat(40) as GitCommitSha;
const headSha = "1".repeat(40) as GitCommitSha;
const sha64 = "b".repeat(64) as Sha256Digest;
const artifactId =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as ArtifactId;
const contractHash =
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as ContractHash;
const promptHash =
  "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as ContentHash;
const readyTokenHash =
  "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as ContentHash;
const candidateId = "cand_01ARZ3NDEKTSV4RRFFQ69G5FAV" as CandidateId;

const terminal: TerminalObservationV1 = {
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

const completedVerdict = (
  reviewerId = "reviewer-a",
  tokenHash: ContentHash = readyTokenHash,
): ReviewAttemptClassification => ({
  _tag: "CompletedVerdict",
  response: {
    schemaVersion: 1,
    readyTokenHash: tokenHash,
    contractHash,
    promptHash,
    bundle: {
      schemaVersion: 1,
      baseSha,
      headSha,
      diffSha256: sha64,
    },
    reviewerId,
    candidateId,
    inspectedArtifactIds: [artifactId],
    advice: { kind: "approved" },
  },
  terminal,
  deliberationEligible: true,
  quorumEligible: true,
});

const completedAbstention: ReviewAttemptClassification = {
  _tag: "CompletedAbstention",
  response: {
    schemaVersion: 1,
    readyTokenHash,
    contractHash,
    promptHash,
    bundle: {
      schemaVersion: 1,
      baseSha,
      headSha,
      diffSha256: sha64,
    },
    reviewerId: "reviewer-a",
    candidateId,
    inspectedArtifactIds: [artifactId],
    advice: {
      kind: "abstention",
      abstention: {
        kind: "insufficient_evidence",
        evidenceGaps: [
          {
            evidenceRef: "diff-patch",
            unmetCondition: "missing",
          },
        ],
        nextAction: "attach evidence",
      },
    },
  },
  terminal,
  quorumEligible: false,
  deliberationEligible: true,
};

const attemptFailed: ReviewAttemptClassification = {
  _tag: "ReviewAttemptFailed",
  failure: {
    stage: "transport",
    reason: "cancelled",
    retry: "same_contract",
  },
  terminal: { ...terminal, terminalState: "cancelled" },
  quorumEligible: false,
  deliberationEligible: false,
};

const preflightFailed: ReviewAttemptClassification = {
  _tag: "ProviderPreflightFailed",
  failure: {
    stage: "provider",
    reason: "schema rejected",
    retry: "changed_preflight",
  },
  terminal: {
    ...terminal,
    modelTurnStarted: false,
    terminalState: "preflight_failed",
  },
  quorumEligible: false,
  deliberationEligible: false,
};

describe("automatic quorum", () => {
  it("rejects three aliases from one failure domain", () => {
    expect(
      evaluateAutomaticQuorum([
        { admissible: true, failureDomain: "family-a" as FailureDomainId },
        { admissible: true, failureDomain: "family-a" as FailureDomainId },
        { admissible: true, failureDomain: "family-a" as FailureDomainId },
      ]),
    ).toEqual({
      _tag: "QuorumNotMet",
      admissibleProposals: 3,
      independentDomains: 1,
    });
  });

  it("accepts three proposals from two domains", () => {
    expect(
      evaluateAutomaticQuorum([
        { admissible: true, failureDomain: "family-a" as FailureDomainId },
        { admissible: true, failureDomain: "family-a" as FailureDomainId },
        { admissible: true, failureDomain: "family-b" as FailureDomainId },
      ]),
    ).toEqual({
      _tag: "QuorumMet",
      admissibleProposals: 3,
      independentDomains: 2,
    });
  });

  it("groups every unknown lineage into one common domain", () => {
    expect(
      evaluateAutomaticQuorum([
        { admissible: true, failureDomain: null },
        { admissible: true, failureDomain: null },
        { admissible: true, failureDomain: null },
      ]),
    ).toMatchObject({ independentDomains: 1 });
  });

  it("excludes inadmissible proposals from quorum counts", () => {
    expect(
      evaluateAutomaticQuorum([
        { admissible: true, failureDomain: "family-a" as FailureDomainId },
        { admissible: true, failureDomain: "family-b" as FailureDomainId },
        { admissible: false, failureDomain: "family-c" as FailureDomainId },
      ]),
    ).toEqual({
      _tag: "QuorumNotMet",
      admissibleProposals: 2,
      independentDomains: 2,
    });
  });

  it("honors explicit proposal and domain thresholds", () => {
    expect(
      evaluateAutomaticQuorum(
        [
          { admissible: true, failureDomain: "family-a" as FailureDomainId },
          { admissible: true, failureDomain: "family-b" as FailureDomainId },
        ],
        2,
        2,
      ),
    ).toEqual({
      _tag: "QuorumMet",
      admissibleProposals: 2,
      independentDomains: 2,
    });
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects invalid minimum proposal threshold %p", (minimumProposals) => {
    expect(evaluateAutomaticQuorum([], minimumProposals, 2)).toEqual({
      _tag: "InvalidQuorumPolicy",
      field: "minimumProposals",
      actual: minimumProposals,
    });
  });

  it("accepts the maximum safe minimum proposal threshold as a valid policy", () => {
    expect(evaluateAutomaticQuorum([], Number.MAX_SAFE_INTEGER, 2)).toEqual({
      _tag: "QuorumNotMet",
      admissibleProposals: 0,
      independentDomains: 0,
    });
  });

  it("rejects a minimum proposal threshold above the safe integer limit", () => {
    expect(evaluateAutomaticQuorum([], Number.MAX_SAFE_INTEGER + 1, 2)).toEqual(
      {
        _tag: "InvalidQuorumPolicy",
        field: "minimumProposals",
        actual: Number.MAX_SAFE_INTEGER + 1,
      },
    );
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects invalid minimum domain threshold %p", (minimumDomains) => {
    expect(evaluateAutomaticQuorum([], 3, minimumDomains)).toEqual({
      _tag: "InvalidQuorumPolicy",
      field: "minimumDomains",
      actual: minimumDomains,
    });
  });

  it("accepts the maximum safe minimum domain threshold as a valid policy", () => {
    expect(evaluateAutomaticQuorum([], 3, Number.MAX_SAFE_INTEGER)).toEqual({
      _tag: "QuorumNotMet",
      admissibleProposals: 0,
      independentDomains: 0,
    });
  });

  it("rejects a minimum domain threshold above the safe integer limit", () => {
    expect(evaluateAutomaticQuorum([], 3, Number.MAX_SAFE_INTEGER + 1)).toEqual(
      {
        _tag: "InvalidQuorumPolicy",
        field: "minimumDomains",
        actual: Number.MAX_SAFE_INTEGER + 1,
      },
    );
  });

  it("rejects zero thresholds before an empty participant list can meet quorum", () => {
    expect(evaluateAutomaticQuorum([], 0, 0)).toEqual({
      _tag: "InvalidQuorumPolicy",
      field: "minimumProposals",
      actual: 0,
    });
  });
});

const tokenHash = (hexChar: string): ContentHash =>
  `sha256:${hexChar.repeat(64)}` as ContentHash;

describe("completed review quorum", () => {
  it("meets default three-verdict two-domain closure", () => {
    expect(
      evaluateCompletedReviewQuorum([
        {
          classification: completedVerdict("reviewer-a", tokenHash("a")),
          failureDomain: "family-a" as FailureDomainId,
        },
        {
          classification: completedVerdict("reviewer-b", tokenHash("b")),
          failureDomain: "family-a" as FailureDomainId,
        },
        {
          classification: completedVerdict("reviewer-c", tokenHash("c")),
          failureDomain: "family-b" as FailureDomainId,
        },
      ]),
    ).toEqual({
      _tag: "QuorumMet",
      completedVerdicts: 3,
      independentDomains: 2,
    });
  });

  it("counts only CompletedVerdict among mixed classification tags", () => {
    expect(
      evaluateCompletedReviewQuorum([
        {
          classification: completedVerdict("reviewer-a", tokenHash("a")),
          failureDomain: "family-a" as FailureDomainId,
        },
        {
          classification: completedVerdict("reviewer-b", tokenHash("b")),
          failureDomain: "family-b" as FailureDomainId,
        },
        {
          classification: completedAbstention,
          failureDomain: "family-c" as FailureDomainId,
        },
        {
          classification: attemptFailed,
          failureDomain: "family-d" as FailureDomainId,
        },
        {
          classification: preflightFailed,
          failureDomain: "family-e" as FailureDomainId,
        },
      ]),
    ).toEqual({
      _tag: "QuorumNotMet",
      completedVerdicts: 2,
      independentDomains: 2,
    });
  });

  it("never trusts a forged quorumEligible boolean on non-verdicts", () => {
    // Even if a caller tampers with eligibility flags, only the tag matters.
    // Well-typed classifications fix quorumEligible by tag, so deliberate
    // forgery must enter as unknown and reassert at the call boundary.
    const forgeParticipant = (
      classification: ReviewAttemptClassification,
      failureDomain: FailureDomainId,
    ): Parameters<typeof evaluateCompletedReviewQuorum>[0][number] => {
      const forged: unknown = {
        classification: { ...classification, quorumEligible: true },
        failureDomain,
      };
      return forged as Parameters<
        typeof evaluateCompletedReviewQuorum
      >[0][number];
    };

    expect(
      evaluateCompletedReviewQuorum([
        forgeParticipant(completedAbstention, "family-a" as FailureDomainId),
        forgeParticipant(attemptFailed, "family-b" as FailureDomainId),
        forgeParticipant(preflightFailed, "family-c" as FailureDomainId),
      ]),
    ).toEqual({
      _tag: "QuorumNotMet",
      completedVerdicts: 0,
      independentDomains: 0,
    });
  });

  it("collapses unknown domains into one common domain", () => {
    expect(
      evaluateCompletedReviewQuorum([
        {
          classification: completedVerdict("reviewer-a", tokenHash("a")),
          failureDomain: null,
        },
        {
          classification: completedVerdict("reviewer-b", tokenHash("b")),
          failureDomain: null,
        },
        {
          classification: completedVerdict("reviewer-c", tokenHash("c")),
          failureDomain: null,
        },
      ]),
    ).toEqual({
      _tag: "QuorumNotMet",
      completedVerdicts: 3,
      independentDomains: 1,
    });
  });

  it("rejects invalid review quorum thresholds", () => {
    expect(evaluateCompletedReviewQuorum([], 0, 2)).toEqual({
      _tag: "InvalidQuorumPolicy",
      field: "minimumVerdicts",
      actual: 0,
    });
    expect(evaluateCompletedReviewQuorum([], 3, 0)).toEqual({
      _tag: "InvalidQuorumPolicy",
      field: "minimumDomains",
      actual: 0,
    });
  });

  it("finding 2: repeated identical CompletedVerdict under A,A,B does not manufacture quorum", () => {
    const same = completedVerdict();
    expect(
      evaluateCompletedReviewQuorum([
        { classification: same, failureDomain: "family-a" as FailureDomainId },
        { classification: same, failureDomain: "family-a" as FailureDomainId },
        { classification: same, failureDomain: "family-b" as FailureDomainId },
      ]),
    ).toEqual({
      _tag: "QuorumNotMet",
      completedVerdicts: 1,
      independentDomains: 1,
    });
  });

  it("finding 2: three distinct reviewer and ready-token identities meet quorum across two domains", () => {
    expect(
      evaluateCompletedReviewQuorum([
        {
          classification: completedVerdict("reviewer-a", tokenHash("1")),
          failureDomain: "family-a" as FailureDomainId,
        },
        {
          classification: completedVerdict("reviewer-b", tokenHash("2")),
          failureDomain: "family-a" as FailureDomainId,
        },
        {
          classification: completedVerdict("reviewer-c", tokenHash("3")),
          failureDomain: "family-b" as FailureDomainId,
        },
      ]),
    ).toEqual({
      _tag: "QuorumMet",
      completedVerdicts: 3,
      independentDomains: 2,
    });
  });

  it("finding 2: duplicate reviewer id cannot add a verdict or domain", () => {
    expect(
      evaluateCompletedReviewQuorum([
        {
          classification: completedVerdict("reviewer-a", tokenHash("1")),
          failureDomain: "family-a" as FailureDomainId,
        },
        {
          // same reviewer, different token
          classification: completedVerdict("reviewer-a", tokenHash("2")),
          failureDomain: "family-b" as FailureDomainId,
        },
        {
          classification: completedVerdict("reviewer-b", tokenHash("3")),
          failureDomain: "family-b" as FailureDomainId,
        },
      ]),
    ).toEqual({
      _tag: "QuorumNotMet",
      completedVerdicts: 2,
      independentDomains: 2,
    });
  });

  it("finding 2: duplicate ready-token hash cannot add a verdict or domain", () => {
    const sharedToken = tokenHash("1");
    expect(
      evaluateCompletedReviewQuorum([
        {
          classification: completedVerdict("reviewer-a", sharedToken),
          failureDomain: "family-a" as FailureDomainId,
        },
        {
          // different reviewer, same token
          classification: completedVerdict("reviewer-b", sharedToken),
          failureDomain: "family-b" as FailureDomainId,
        },
        {
          classification: completedVerdict("reviewer-c", tokenHash("2")),
          failureDomain: "family-b" as FailureDomainId,
        },
      ]),
    ).toEqual({
      _tag: "QuorumNotMet",
      completedVerdicts: 2,
      independentDomains: 2,
    });
  });
});

describe("confidence weighting", () => {
  const calibration = {
    schemaVersion: 1 as const,
    modelTaskKey: "model-a:research",
    validUntilEpochMs: 2_000 as EpochMilliseconds,
    calibrationArtifactId:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as ArtifactId,
  };

  it("requires an applicable unexpired calibration record", () => {
    expect(
      confidenceWeightEligible(
        calibration,
        "model-a:research",
        1_000 as EpochMilliseconds,
      ),
    ).toBe(true);
    expect(
      confidenceWeightEligible(
        null,
        "model-a:research",
        1_000 as EpochMilliseconds,
      ),
    ).toBe(false);
  });

  it("rejects a calibration for a different model-task key", () => {
    expect(
      confidenceWeightEligible(
        calibration,
        "model-b:research",
        1_000 as EpochMilliseconds,
      ),
    ).toBe(false);
  });

  it("rejects an expired calibration and accepts its exact expiry", () => {
    expect(
      confidenceWeightEligible(
        calibration,
        "model-a:research",
        2_001 as EpochMilliseconds,
      ),
    ).toBe(false);
    expect(
      confidenceWeightEligible(
        calibration,
        "model-a:research",
        2_000 as EpochMilliseconds,
      ),
    ).toBe(true);
  });

  it("accepts the validated epoch millisecond boundaries", () => {
    expect(
      confidenceWeightEligible(
        { ...calibration, validUntilEpochMs: 0 as EpochMilliseconds },
        "model-a:research",
        0 as EpochMilliseconds,
      ),
    ).toBe(true);
    expect(
      confidenceWeightEligible(
        {
          ...calibration,
          validUntilEpochMs: Number.MAX_SAFE_INTEGER as EpochMilliseconds,
        },
        "model-a:research",
        Number.MAX_SAFE_INTEGER as EpochMilliseconds,
      ),
    ).toBe(true);
    expectTypeOf(confidenceWeightEligible)
      .parameter(2)
      .toEqualTypeOf<EpochMilliseconds>();
  });
});
