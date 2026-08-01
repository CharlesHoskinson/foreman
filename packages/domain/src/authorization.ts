import type { ActionHash, ContractHash } from "@council/schema";

type Check = "valid" | "invalid" | "unknown";

export type CommitmentDenialReason =
  | "approval_missing"
  | "approval_mismatch"
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

export type CommitmentContext = {
  readonly contractHash: ContractHash;
  readonly actionHash: ActionHash;
  readonly approval:
    | {
        readonly _tag: "Approved";
        readonly contractHash: ContractHash;
        readonly actionHash: ActionHash;
      }
    | { readonly _tag: "Missing" };
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

export const authorizeCommitment = (
  context: CommitmentContext,
): CommitmentDecision => {
  if (context.approval._tag === "Missing") {
    return { _tag: "Denied", reason: "approval_missing" };
  }
  if (
    context.approval.contractHash !== context.contractHash ||
    context.approval.actionHash !== context.actionHash
  ) {
    return { _tag: "Denied", reason: "approval_mismatch" };
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
        context.citation === "unknown" ? "citation_unknown" : "citation_invalid",
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
