import type {
  ActionHash,
  Approval,
  ApprovalId,
  ArtifactId,
  ContractHash,
  RequestedAction,
  UtcTimestamp,
  ValidationStatus,
} from "@council/schema";
import { describe, expect, it } from "vitest";
import {
  authorizeCommitment,
  type CommitmentDenialReason,
} from "../src/index.js";

const contractHash =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as ContractHash;
const actionHash =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as ActionHash;
const argumentsArtifactId =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as ArtifactId;
const now = "2026-08-01T12:00:00.000Z" as UtcTimestamp;

const requestedAction: RequestedAction = {
  schemaVersion: 1,
  actionHash,
  normalizedOperation: "artifact.publish",
  normalizedArgumentsArtifactId: argumentsArtifactId,
  destination: "user-visible-response",
  policyVersion: "policy-v1",
  contractHash,
};

const approval: Approval = {
  schemaVersion: 1,
  approvalId: "apr_01ARZ3NDEKTSV4RRFFQ69G5FAV" as ApprovalId,
  actionHash,
  contractHash,
  approver: "council-chair",
  approverAuthority: "approved_contract",
  expiresAt: "2026-08-01T13:00:00.000Z" as UtcTimestamp,
};

const approvedContext = {
  requestedAction,
  approval: {
    _tag: "Present" as const,
    value: approval,
    validation: "valid" as const,
  },
  currentContract: {
    _tag: "Present" as const,
    contractHash,
    policyVersion: "policy-v1",
    validation: "valid" as const,
  },
  now,
  policy: "allow" as const,
  capability: "valid" as const,
  destination: "valid" as const,
  provenance: "valid" as const,
  citation: "valid" as const,
  secretScan: "clear" as const,
};

const validationDenialSuffixes = [
  "invalid",
  "unknown",
  "untrusted",
  "inaccessible",
  "incomplete",
] as const satisfies ReadonlyArray<Exclude<ValidationStatus, "valid">>;

const denialReasons: readonly CommitmentDenialReason[] = [
  "approval_missing",
  "approval_invalid",
  "approval_unknown",
  "approval_untrusted",
  "approval_inaccessible",
  "approval_incomplete",
  "approval_expired",
  "approval_authority_invalid",
  "approval_mismatch",
  "contract_missing",
  "contract_invalid",
  "contract_unknown",
  "contract_untrusted",
  "contract_inaccessible",
  "contract_incomplete",
  "contract_mismatch",
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

describe("commitment authorization", () => {
  it("allows the sole valid exact action and approval", () => {
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

  it.each(validationDenialSuffixes)(
    "denies an approval whose validation is %s",
    (validation) => {
      expect(
        authorizeCommitment({
          ...approvedContext,
          approval: { ...approvedContext.approval, validation },
        }),
      ).toEqual({ _tag: "Denied", reason: `approval_${validation}` });
    },
  );

  it("denies an expired approval and accepts its exact expiry", () => {
    expect(
      authorizeCommitment({
        ...approvedContext,
        now: "2026-08-01T13:00:00.001Z" as UtcTimestamp,
      }),
    ).toEqual({ _tag: "Denied", reason: "approval_expired" });
    expect(
      authorizeCommitment({
        ...approvedContext,
        now: approval.expiresAt,
      }),
    ).toEqual({ _tag: "Allowed" });
  });

  it.each(["trusted_instruction", "approved_contract"] as const)(
    "accepts authority-bearing class %s",
    (approverAuthority) => {
      expect(
        authorizeCommitment({
          ...approvedContext,
          approval: {
            ...approvedContext.approval,
            value: { ...approval, approverAuthority },
          },
        }),
      ).toEqual({ _tag: "Allowed" });
    },
  );

  it.each(["user_data", "tool_metadata", "untrusted_evidence"] as const)(
    "denies non-authority-bearing class %s",
    (approverAuthority) => {
      expect(
        authorizeCommitment({
          ...approvedContext,
          approval: {
            ...approvedContext.approval,
            value: { ...approval, approverAuthority },
          },
        }),
      ).toEqual({ _tag: "Denied", reason: "approval_authority_invalid" });
    },
  );

  it("denies an approval for a different action or contract", () => {
    const otherAction =
      "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as ActionHash;
    expect(
      authorizeCommitment({
        ...approvedContext,
        approval: {
          ...approvedContext.approval,
          value: { ...approval, actionHash: otherAction },
        },
      }),
    ).toEqual({ _tag: "Denied", reason: "approval_mismatch" });
    expect(
      authorizeCommitment({
        ...approvedContext,
        approval: {
          ...approvedContext.approval,
          value: {
            ...approval,
            contractHash:
              "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as ContractHash,
          },
        },
      }),
    ).toEqual({ _tag: "Denied", reason: "approval_mismatch" });
  });

  it("denies a missing current contract", () => {
    expect(
      authorizeCommitment({
        ...approvedContext,
        currentContract: { _tag: "Missing" },
      }),
    ).toEqual({ _tag: "Denied", reason: "contract_missing" });
  });

  it.each(validationDenialSuffixes)(
    "denies a current contract whose validation is %s",
    (validation) => {
      expect(
        authorizeCommitment({
          ...approvedContext,
          currentContract: { ...approvedContext.currentContract, validation },
        }),
      ).toEqual({ _tag: "Denied", reason: `contract_${validation}` });
    },
  );

  it("denies a stale contract hash or policy version", () => {
    expect(
      authorizeCommitment({
        ...approvedContext,
        currentContract: {
          ...approvedContext.currentContract,
          contractHash:
            "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as ContractHash,
        },
      }),
    ).toEqual({ _tag: "Denied", reason: "contract_mismatch" });
    expect(
      authorizeCommitment({
        ...approvedContext,
        currentContract: {
          ...approvedContext.currentContract,
          policyVersion: "policy-v2",
        },
      }),
    ).toEqual({ _tag: "Denied", reason: "contract_mismatch" });
  });

  it("denies an explicit policy rejection", () => {
    expect(authorizeCommitment({ ...approvedContext, policy: "deny" })).toEqual(
      { _tag: "Denied", reason: "policy_denied" },
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
    expect(
      authorizeCommitment({ ...approvedContext, [field]: "unknown" }),
    ).toEqual({ _tag: "Denied", reason: `${field}_unknown` });
  });

  it.each(["capability", "destination", "provenance", "citation"] as const)(
    "fails closed when %s is invalid",
    (field) => {
      expect(
        authorizeCommitment({ ...approvedContext, [field]: "invalid" }),
      ).toEqual({ _tag: "Denied", reason: `${field}_invalid` });
    },
  );

  it("fails closed when the secret scan is blocked", () => {
    expect(
      authorizeCommitment({ ...approvedContext, secretScan: "blocked" }),
    ).toEqual({ _tag: "Denied", reason: "secretScan_blocked" });
  });

  it("enumerates every commitment denial reason", () => {
    expect(denialReasons).toHaveLength(28);
  });
});
