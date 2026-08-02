import type {
  Approval,
  AuthorityClass,
  ContractHash,
  RequestedAction,
  UtcTimestamp,
  ValidationStatus,
} from "@council/schema";

type Check = "valid" | "invalid" | "unknown";
type InvalidValidationStatus = Exclude<ValidationStatus, "valid">;

export const authorityBearingApprovalClasses = [
  "trusted_instruction",
  "approved_contract",
] as const satisfies ReadonlyArray<AuthorityClass>;
export type AuthorityBearingApprovalClass =
  (typeof authorityBearingApprovalClasses)[number];

export type CommitmentDenialReason =
  | "approval_missing"
  | `approval_${InvalidValidationStatus}`
  | "approval_expired"
  | "approval_authority_invalid"
  | "approval_mismatch"
  | "contract_missing"
  | `contract_${InvalidValidationStatus}`
  | "contract_mismatch"
  | "policy_unknown"
  | "policy_denied"
  | "capability_unknown"
  | "capability_invalid"
  | "destination_unknown"
  | "destination_invalid"
  | "provenance_unknown"
  | "provenance_invalid"
  | "citation_unknown"
  | "citation_invalid"
  | "secretScan_unknown"
  | "secretScan_blocked";

export type ValidatedApproval =
  | { readonly _tag: "Missing" }
  | {
      readonly _tag: "Present";
      readonly value: Approval;
      readonly validation: ValidationStatus;
    };

export type CurrentContract =
  | { readonly _tag: "Missing" }
  | {
      readonly _tag: "Present";
      readonly contractHash: ContractHash;
      readonly policyVersion: string;
      readonly validation: ValidationStatus;
    };

export type CommitmentContext = {
  readonly requestedAction: RequestedAction;
  readonly approval: ValidatedApproval;
  readonly currentContract: CurrentContract;
  readonly now: UtcTimestamp;
  readonly policy: "allow" | "deny" | "unknown";
  readonly capability: Check;
  readonly destination: Check;
  readonly provenance: Check;
  readonly citation: Check;
  readonly secretScan: "clear" | "blocked" | "unknown";
};

export type CommitmentDecision =
  | { readonly _tag: "Allowed" }
  | { readonly _tag: "Denied"; readonly reason: CommitmentDenialReason };

const approvalValidationReason = (
  status: InvalidValidationStatus,
): CommitmentDenialReason => `approval_${status}`;

const contractValidationReason = (
  status: InvalidValidationStatus,
): CommitmentDenialReason => `contract_${status}`;

const isAuthorityBearing = (
  authorityClass: AuthorityClass,
): authorityClass is AuthorityBearingApprovalClass =>
  authorityClass === "trusted_instruction" ||
  authorityClass === "approved_contract";

export const authorizeCommitment = (
  context: CommitmentContext,
): CommitmentDecision => {
  if (context.approval._tag === "Missing") {
    return { _tag: "Denied", reason: "approval_missing" };
  }
  if (context.approval.validation !== "valid") {
    return {
      _tag: "Denied",
      reason: approvalValidationReason(context.approval.validation),
    };
  }

  if (context.currentContract._tag === "Missing") {
    return { _tag: "Denied", reason: "contract_missing" };
  }
  if (context.currentContract.validation !== "valid") {
    return {
      _tag: "Denied",
      reason: contractValidationReason(context.currentContract.validation),
    };
  }

  const action = context.requestedAction;
  const approval = context.approval.value;
  if (
    approval.contractHash !== action.contractHash ||
    approval.actionHash !== action.actionHash
  ) {
    return { _tag: "Denied", reason: "approval_mismatch" };
  }
  if (approval.expiresAt < context.now) {
    return { _tag: "Denied", reason: "approval_expired" };
  }
  if (!isAuthorityBearing(approval.approverAuthority)) {
    return { _tag: "Denied", reason: "approval_authority_invalid" };
  }
  if (
    context.currentContract.contractHash !== action.contractHash ||
    context.currentContract.policyVersion !== action.policyVersion
  ) {
    return { _tag: "Denied", reason: "contract_mismatch" };
  }
  if (context.policy !== "allow") {
    return {
      _tag: "Denied",
      reason: context.policy === "unknown" ? "policy_unknown" : "policy_denied",
    };
  }

  if (context.capability !== "valid") {
    return {
      _tag: "Denied",
      reason:
        context.capability === "unknown"
          ? "capability_unknown"
          : "capability_invalid",
    };
  }
  if (context.destination !== "valid") {
    return {
      _tag: "Denied",
      reason:
        context.destination === "unknown"
          ? "destination_unknown"
          : "destination_invalid",
    };
  }
  if (context.provenance !== "valid") {
    return {
      _tag: "Denied",
      reason:
        context.provenance === "unknown"
          ? "provenance_unknown"
          : "provenance_invalid",
    };
  }
  if (context.citation !== "valid") {
    return {
      _tag: "Denied",
      reason:
        context.citation === "unknown"
          ? "citation_unknown"
          : "citation_invalid",
    };
  }
  if (context.secretScan !== "clear") {
    return {
      _tag: "Denied",
      reason:
        context.secretScan === "unknown"
          ? "secretScan_unknown"
          : "secretScan_blocked",
    };
  }
  return { _tag: "Allowed" };
};
