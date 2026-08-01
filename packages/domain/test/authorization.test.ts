import type { ActionHash, ContractHash } from "@council/schema";
import { describe, expect, it } from "vitest";
import {
  authorizeCommitment,
  type CommitmentDenialReason,
} from "../src/index.js";

const denialReasons: readonly CommitmentDenialReason[] = [
  "approval_missing",
  "approval_mismatch",
  "policy_unknown",
  "policy_denied",
  "capability_unknown",
  "capability_invalid",
  "destination_unknown",
  "destination_invalid",
  "provenance_unknown",
  "provenance_invalid",
  "citation_unknown",
  "citation_invalid",
  "secretScan_unknown",
  "secretScan_blocked",
];

const matching = {
  contractHash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as ContractHash,
  actionHash:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as ActionHash,
} as const;

const approvedContext = {
  ...matching,
  approval: {
    _tag: "Approved" as const,
    contractHash: matching.contractHash,
    actionHash: matching.actionHash,
  },
  policy: "allow" as const,
  capability: "valid" as const,
  destination: "valid" as const,
  provenance: "valid" as const,
  citation: "valid" as const,
  secretScan: "clear" as const,
};

describe("commitment authorization", () => {
  it("allows only an exact approved action with all checks valid", () => {
    expect(authorizeCommitment(approvedContext)).toEqual({ _tag: "Allowed" });
  });

  it("denies a missing approval", () => {
    expect(
      authorizeCommitment({
        ...approvedContext,
        approval: { _tag: "Missing" },
      }),
    ).toEqual({ _tag: "Denied", reason: "approval_missing" });
  });

  it("denies an approval for a different action", () => {
    expect(
      authorizeCommitment({
        ...approvedContext,
        approval: {
          ...approvedContext.approval,
          actionHash:
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as ActionHash,
        },
      }),
    ).toEqual({ _tag: "Denied", reason: "approval_mismatch" });
  });

  it("denies an approval for a different contract", () => {
    expect(
      authorizeCommitment({
        ...approvedContext,
        approval: {
          ...approvedContext.approval,
          contractHash:
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as ContractHash,
        },
      }),
    ).toEqual({ _tag: "Denied", reason: "approval_mismatch" });
  });

  it("denies an explicit policy rejection", () => {
    expect(authorizeCommitment({ ...approvedContext, policy: "deny" })).toEqual(
      {
        _tag: "Denied",
        reason: "policy_denied",
      },
    );
  });

  it.each([
    "policy",
    "capability",
    "destination",
    "provenance",
    "citation",
    "secretScan",
  ] as const)("fails closed when %s is unknown", (field) => {
    const context = { ...approvedContext, [field]: "unknown" } as const;
    expect(authorizeCommitment(context)).toEqual({
      _tag: "Denied",
      reason: field + "_unknown",
    });
  });

  it.each(["capability", "destination", "provenance", "citation"] as const)(
    "fails closed when %s is invalid",
    (field) => {
      expect(
        authorizeCommitment({
          ...approvedContext,
          [field]: "invalid",
        } as const),
      ).toEqual({
        _tag: "Denied",
        reason: field + "_invalid",
      });
    },
  );

  it("fails closed when the secret scan is blocked", () => {
    expect(
      authorizeCommitment({ ...approvedContext, secretScan: "blocked" }),
    ).toEqual({ _tag: "Denied", reason: "secretScan_blocked" });
  });

  it("enumerates every commitment denial reason", () => {
    expect(denialReasons).toHaveLength(14);
  });
});
