import type { CalibrationRecord, FailureDomainId } from "@council/schema";

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

const isValidQuorumThreshold = (threshold: number): boolean =>
  Number.isSafeInteger(threshold) && threshold > 0;

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

export const confidenceWeightEligible = (
  calibration: CalibrationRecord | null,
  modelTaskKey: string,
  nowEpochMs: number,
): boolean =>
  calibration !== null &&
  calibration.modelTaskKey === modelTaskKey &&
  calibration.validUntilEpochMs >= nowEpochMs;
