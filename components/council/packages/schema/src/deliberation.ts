import * as Schema from "effect/Schema";
import {
  ArtifactId,
  CandidateId,
  EpochMilliseconds,
  FailureDomainId,
  UtcTimestamp,
} from "./identifiers.js";

/**
 * String that is not empty and not whitespace-only after trim.
 * Operational text (locations, summaries, evidence refs, ids) uses this.
 */
export const NonBlankString = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0, {
    message: () => "must be nonblank (not empty or whitespace-only)",
  }),
);
export type NonBlankString = typeof NonBlankString.Type;

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
  modelTaskKey: NonBlankString,
  validUntilEpochMs: EpochMilliseconds,
  calibrationArtifactId: ArtifactId,
});
export type CalibrationRecord = typeof CalibrationRecord.Type;

export const ReviewVerdict = Schema.Literal("approved", "changes_requested");
export type ReviewVerdict = typeof ReviewVerdict.Type;

export const EvidenceGap = Schema.Struct({
  evidenceRef: NonBlankString,
  unmetCondition: NonBlankString,
});
export type EvidenceGap = typeof EvidenceGap.Type;

export const ReviewAbstention = Schema.Struct({
  kind: Schema.Literal("insufficient_evidence"),
  evidenceGaps: Schema.NonEmptyArray(EvidenceGap),
  nextAction: NonBlankString,
});
export type ReviewAbstention = typeof ReviewAbstention.Type;

export const ReviewInfrastructureFailure = Schema.Struct({
  stage: Schema.Literal("prompt", "dispatch", "provider", "transport", "parse"),
  reason: NonBlankString,
  retry: Schema.Literal("same_contract", "changed_preflight", "new_contract"),
});
export type ReviewInfrastructureFailure =
  typeof ReviewInfrastructureFailure.Type;

export const CouncilClosureOutcome = Schema.Literal(
  "quorum_not_met",
  "judge_unstable",
  "policy_blocked",
  "budget_exhausted",
  "unsupported_claims",
  "outcome_unknown",
);
export type CouncilClosureOutcome = typeof CouncilClosureOutcome.Type;
