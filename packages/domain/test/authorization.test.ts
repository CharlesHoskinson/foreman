import type { ActionHash, ContractHash } from "@council/schema";
import { describe, expect, it } from "vitest";
import { authorizeCommitment } from "../src/index.js";

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
      authorizeCommitment({ ...approvedContext, approval: { _tag: "Missing" } }),
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
});
