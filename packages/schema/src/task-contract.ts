import * as Schema from "effect/Schema";
import {
  ActionHash,
  ApprovalId,
  ArtifactId,
  ContractHash,
  UtcTimestamp,
} from "./identifiers.js";

const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
);

export const BudgetVector = Schema.Struct({
  wallTimeMs: NonNegativeInteger,
  tokens: NonNegativeInteger,
  costMicros: NonNegativeInteger,
  toolCalls: NonNegativeInteger,
  turns: NonNegativeInteger,
  retries: NonNegativeInteger,
  concurrency: NonNegativeInteger,
  events: NonNegativeInteger,
  artifactBytes: NonNegativeInteger,
});
export type BudgetVector = typeof BudgetVector.Type;

export const SideEffectState = Schema.Literal(
  "not_started",
  "in_flight",
  "committed",
  "compensated",
  "outcome_unknown",
);
export type SideEffectState = typeof SideEffectState.Type;

export const TaskContract = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  contractHash: ContractHash,
  parentContractHash: Schema.optional(ContractHash),
  roles: Schema.Array(Schema.String),
  allowedOutcomes: Schema.Array(Schema.String),
  toolOperations: Schema.Array(Schema.String),
  resources: Schema.Array(Schema.String),
  destinations: Schema.Array(Schema.String),
  dataClasses: Schema.Array(Schema.String),
  budgets: BudgetVector,
  requiredApprovals: Schema.Array(Schema.String),
  rubricArtifactId: ArtifactId,
  policyVersion: Schema.String,
  expiresAt: UtcTimestamp,
  evidenceScope: Schema.Array(ArtifactId),
});
export type TaskContract = typeof TaskContract.Type;

export const TaskContractAmendment = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  contractHash: ContractHash,
  parentContractHash: ContractHash,
  exactDeltaArtifactId: ArtifactId,
  reason: Schema.String,
  approvalId: ApprovalId,
  approvedAt: UtcTimestamp,
});
export type TaskContractAmendment = typeof TaskContractAmendment.Type;

export const RequestedAction = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  actionHash: ActionHash,
  normalizedOperation: Schema.String,
  normalizedArgumentsArtifactId: ArtifactId,
  destination: Schema.String,
  policyVersion: Schema.String,
  contractHash: ContractHash,
});
export type RequestedAction = typeof RequestedAction.Type;

export const Approval = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  approvalId: ApprovalId,
  actionHash: ActionHash,
  contractHash: ContractHash,
  approver: Schema.String,
  expiresAt: UtcTimestamp,
});
export type Approval = typeof Approval.Type;
