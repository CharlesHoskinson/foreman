import * as Schema from "effect/Schema";
import {
  ArtifactId,
  CandidateId,
  EpochMilliseconds,
  FailureDomainId,
  UtcTimestamp,
} from "./identifiers.js";

export const ProposalEligibility = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  candidateId: CandidateId,
  admissible: Schema.Boolean,
  failureDomain: Schema.NullOr(FailureDomainId),
  sealedAt: UtcTimestamp,
});
export type ProposalEligibility = typeof ProposalEligibility.Type;

export const CalibrationRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  modelTaskKey: Schema.String,
  validUntilEpochMs: EpochMilliseconds,
  calibrationArtifactId: ArtifactId,
});
export type CalibrationRecord = typeof CalibrationRecord.Type;

export const CouncilOutcome = Schema.Literal(
  "insufficient_evidence",
  "quorum_not_met",
  "judge_unstable",
  "policy_blocked",
  "budget_exhausted",
  "unsupported_claims",
  "schema_invalid",
  "outcome_unknown",
);
export type CouncilOutcome = typeof CouncilOutcome.Type;
