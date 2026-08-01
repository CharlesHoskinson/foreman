import * as Schema from "effect/Schema";

const ulid = "[0-9A-HJKMNP-TV-Z]{26}";
const sha256 = "[a-f0-9]{64}";

export const RunId = Schema.String.pipe(
  Schema.pattern(new RegExp("^run_" + ulid + "$")),
  Schema.brand("RunId"),
);
export type RunId = typeof RunId.Type;

export const BranchId = Schema.String.pipe(
  Schema.pattern(new RegExp("^brn_" + ulid + "$")),
  Schema.brand("BranchId"),
);
export type BranchId = typeof BranchId.Type;

export const StepId = Schema.String.pipe(
  Schema.pattern(new RegExp("^stp_" + ulid + "$")),
  Schema.brand("StepId"),
);
export type StepId = typeof StepId.Type;

export const AttemptId = Schema.String.pipe(
  Schema.pattern(new RegExp("^att_" + ulid + "$")),
  Schema.brand("AttemptId"),
);
export type AttemptId = typeof AttemptId.Type;

export const CommandId = Schema.String.pipe(
  Schema.pattern(new RegExp("^cmd_" + ulid + "$")),
  Schema.brand("CommandId"),
);
export type CommandId = typeof CommandId.Type;

export const EventId = Schema.String.pipe(
  Schema.pattern(new RegExp("^evt_" + ulid + "$")),
  Schema.brand("EventId"),
);
export type EventId = typeof EventId.Type;

export const ProviderSessionId = Schema.String.pipe(
  Schema.pattern(new RegExp("^psn_" + ulid + "$")),
  Schema.brand("ProviderSessionId"),
);
export type ProviderSessionId = typeof ProviderSessionId.Type;

export const ArtifactId = Schema.String.pipe(
  Schema.pattern(new RegExp("^sha256:" + sha256 + "$")),
  Schema.brand("ArtifactId"),
);
export type ArtifactId = typeof ArtifactId.Type;

export const ContentHash = Schema.String.pipe(
  Schema.pattern(new RegExp("^sha256:" + sha256 + "$")),
  Schema.brand("ContentHash"),
);
export type ContentHash = typeof ContentHash.Type;

export const ContractHash = Schema.String.pipe(
  Schema.pattern(new RegExp("^sha256:" + sha256 + "$")),
  Schema.brand("ContractHash"),
);
export type ContractHash = typeof ContractHash.Type;

export const ActionHash = Schema.String.pipe(
  Schema.pattern(new RegExp("^sha256:" + sha256 + "$")),
  Schema.brand("ActionHash"),
);
export type ActionHash = typeof ActionHash.Type;

export const ApprovalId = Schema.String.pipe(
  Schema.pattern(new RegExp("^apr_" + ulid + "$")),
  Schema.brand("ApprovalId"),
);
export type ApprovalId = typeof ApprovalId.Type;

export const CapabilityId = Schema.String.pipe(
  Schema.pattern(new RegExp("^cap_" + ulid + "$")),
  Schema.brand("CapabilityId"),
);
export type CapabilityId = typeof CapabilityId.Type;

export const ClaimId = Schema.String.pipe(
  Schema.pattern(new RegExp("^clm_" + ulid + "$")),
  Schema.brand("ClaimId"),
);
export type ClaimId = typeof ClaimId.Type;

export const CandidateId = Schema.String.pipe(
  Schema.pattern(new RegExp("^cand_" + ulid + "$")),
  Schema.brand("CandidateId"),
);
export type CandidateId = typeof CandidateId.Type;

export const BallotId = Schema.String.pipe(
  Schema.pattern(new RegExp("^bal_" + ulid + "$")),
  Schema.brand("BallotId"),
);
export type BallotId = typeof BallotId.Type;

export const PolicyId = Schema.String.pipe(
  Schema.pattern(new RegExp("^pol_" + ulid + "$")),
  Schema.brand("PolicyId"),
);
export type PolicyId = typeof PolicyId.Type;

export const CorrelationId = Schema.String.pipe(
  Schema.pattern(new RegExp("^cor_" + ulid + "$")),
  Schema.brand("CorrelationId"),
);
export type CorrelationId = typeof CorrelationId.Type;

export const CausationId = Schema.String.pipe(
  Schema.pattern(new RegExp("^cau_" + ulid + "$")),
  Schema.brand("CausationId"),
);
export type CausationId = typeof CausationId.Type;

export const ActorId = Schema.String.pipe(
  Schema.pattern(new RegExp("^act_" + ulid + "$")),
  Schema.brand("ActorId"),
);
export type ActorId = typeof ActorId.Type;

export const FailureDomainId = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9-]{0,62}$/),
  Schema.brand("FailureDomainId"),
);
export type FailureDomainId = typeof FailureDomainId.Type;

export const UtcTimestamp = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  Schema.brand("UtcTimestamp"),
);
export type UtcTimestamp = typeof UtcTimestamp.Type;
