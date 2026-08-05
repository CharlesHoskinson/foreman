import type {
  CalibrationRecord,
  EpochMilliseconds,
  FailureDomainId,
} from "@council/schema";
import type { ReviewAttemptClassification } from "./review-admission.js";

export type QuorumParticipant = {
  readonly admissible: boolean;
  readonly failureDomain: FailureDomainId | null;
};

export type QuorumDecision =
  | {
      readonly _tag: "QuorumMet";
      readonly admissibleProposals: number;
      readonly independentDomains: number;
    }
  | {
      readonly _tag: "QuorumNotMet";
      readonly admissibleProposals: number;
      readonly independentDomains: number;
    }
  | {
      readonly _tag: "InvalidQuorumPolicy";
      readonly field: "minimumProposals" | "minimumDomains";
      readonly actual: number;
    };

/**
 * Completed-review participant. Eligibility is derived from the classification
 * tag only. Caller-supplied admissible/quorumEligible booleans are ignored.
 */
export type CompletedReviewQuorumParticipant = {
  readonly classification: ReviewAttemptClassification;
  readonly failureDomain: FailureDomainId | null;
};

export type CompletedReviewQuorumDecision =
  | {
      readonly _tag: "QuorumMet";
      readonly completedVerdicts: number;
      readonly independentDomains: number;
    }
  | {
      readonly _tag: "QuorumNotMet";
      readonly completedVerdicts: number;
      readonly independentDomains: number;
    }
  | {
      readonly _tag: "InvalidQuorumPolicy";
      readonly field: "minimumVerdicts" | "minimumDomains";
      readonly actual: number;
    };

const isValidQuorumThreshold = (threshold: number): boolean =>
  Number.isSafeInteger(threshold) && threshold > 0;

/**
 * Proposal quorum. Counts caller-marked admissible proposals across failure
 * domains. Default threshold is three proposals from two domains.
 */
export const evaluateAutomaticQuorum = (
  participants: ReadonlyArray<QuorumParticipant>,
  minimumProposals = 3,
  minimumDomains = 2,
): QuorumDecision => {
  if (!isValidQuorumThreshold(minimumProposals)) {
    return {
      _tag: "InvalidQuorumPolicy",
      field: "minimumProposals",
      actual: minimumProposals,
    };
  }
  if (!isValidQuorumThreshold(minimumDomains)) {
    return {
      _tag: "InvalidQuorumPolicy",
      field: "minimumDomains",
      actual: minimumDomains,
    };
  }

  const admissible = participants.filter(
    (participant) => participant.admissible,
  );
  const domains = new Set(
    admissible.map((participant) =>
      participant.failureDomain === null
        ? "__unknown_common_domain__"
        : participant.failureDomain,
    ),
  );
  const result = {
    admissibleProposals: admissible.length,
    independentDomains: domains.size,
  };

  return admissible.length >= minimumProposals && domains.size >= minimumDomains
    ? { _tag: "QuorumMet", ...result }
    : { _tag: "QuorumNotMet", ...result };
};

/**
 * Completed-review quorum. Counts only **distinct, identity-bound**
 * `CompletedVerdict` classifications.
 *
 * Identity keys (both must be unique among counted verdicts):
 * - `response.reviewerId`
 * - `response.readyTokenHash`
 *
 * A duplicate of either identity does not add a verdict and does not add
 * domain diversity, even when the caller supplies conflicting domains.
 * Completed abstentions, both infrastructure failure tags, and
 * `CompletedInvalidResponse` count as zero — they never contribute a verdict
 * or domain. Unknown domains collapse to one common domain.
 *
 * Counters report **distinct counted** verdicts and domains after
 * de-duplication, not raw array positions.
 *
 * Default closure: at least three distinct completed substantive verdicts from
 * at least two independent failure domains.
 */
export const evaluateCompletedReviewQuorum = (
  participants: ReadonlyArray<CompletedReviewQuorumParticipant>,
  minimumVerdicts = 3,
  minimumDomains = 2,
): CompletedReviewQuorumDecision => {
  if (!isValidQuorumThreshold(minimumVerdicts)) {
    return {
      _tag: "InvalidQuorumPolicy",
      field: "minimumVerdicts",
      actual: minimumVerdicts,
    };
  }
  if (!isValidQuorumThreshold(minimumDomains)) {
    return {
      _tag: "InvalidQuorumPolicy",
      field: "minimumDomains",
      actual: minimumDomains,
    };
  }

  const seenReviewers = new Set<string>();
  const seenReadyTokens = new Set<string>();
  const distinctVerdicts: CompletedReviewQuorumParticipant[] = [];

  for (const participant of participants) {
    if (participant.classification._tag !== "CompletedVerdict") {
      continue;
    }
    const { reviewerId, readyTokenHash } = participant.classification.response;
    if (seenReviewers.has(reviewerId) || seenReadyTokens.has(readyTokenHash)) {
      // Duplicate identity: ignore verdict and domain contribution entirely.
      continue;
    }
    seenReviewers.add(reviewerId);
    seenReadyTokens.add(readyTokenHash);
    distinctVerdicts.push(participant);
  }

  const domains = new Set(
    distinctVerdicts.map((participant) =>
      participant.failureDomain === null
        ? "__unknown_common_domain__"
        : participant.failureDomain,
    ),
  );
  const result = {
    completedVerdicts: distinctVerdicts.length,
    independentDomains: domains.size,
  };

  return distinctVerdicts.length >= minimumVerdicts &&
    domains.size >= minimumDomains
    ? { _tag: "QuorumMet", ...result }
    : { _tag: "QuorumNotMet", ...result };
};

export const confidenceWeightEligible = (
  calibration: CalibrationRecord | null,
  modelTaskKey: string,
  nowEpochMs: EpochMilliseconds,
): boolean =>
  calibration !== null &&
  calibration.modelTaskKey === modelTaskKey &&
  calibration.validUntilEpochMs >= nowEpochMs;
