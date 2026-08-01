import * as Schema from "effect/Schema";
import { CandidateId, FailureDomainId, UtcTimestamp } from "./identifiers.js";

export const ProposalEligibility = Schema.Struct({
  candidateId: CandidateId,
  admissible: Schema.Boolean,
  failureDomain: Schema.NullOr(FailureDomainId),
  sealedAt: UtcTimestamp,
});
export type ProposalEligibility = typeof ProposalEligibility.Type;

export const CalibrationRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  modelTaskKey: Schema.String,
  validUntilEpochMs: Schema.Number,
  calibrationArtifactId: Schema.String,
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
