import type { ActionHash, ContractHash } from "@council/schema";

type Check = "valid" | "invalid" | "unknown";

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
  | { readonly _tag: "Denied"; readonly reason: string };

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

  const checks = [
    ["capability", context.capability],
    ["destination", context.destination],
    ["provenance", context.provenance],
    ["citation", context.citation],
  ] as const;
  for (const [name, value] of checks) {
    if (value !== "valid") {
      return {
        _tag: "Denied",
        reason: name + "_" + (value === "unknown" ? "unknown" : "invalid"),
      };
    }
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
