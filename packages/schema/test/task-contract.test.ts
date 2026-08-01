import { describe, expect, it } from "vitest";
import {
  decodeStrictSync,
  Approval,
  TaskContract,
  TaskContractAmendment,
} from "../src/index.js";

const contract = {
  schemaVersion: 1,
  contractHash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  roles: ["lead", "adviser"],
  allowedOutcomes: ["answer", "insufficient_evidence"],
  toolOperations: ["graph.query"],
  resources: ["graph:council-research"],
  destinations: [],
  dataClasses: ["public"],
  budgets: {
    wallTimeMs: 60_000,
    tokens: 20_000,
    costMicros: 0,
    toolCalls: 10,
    turns: 8,
    retries: 1,
    concurrency: 3,
    events: 1_000,
    artifactBytes: 10_000_000,
  },
  requiredApprovals: [],
  rubricArtifactId:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  policyVersion: "policy-v1",
  expiresAt: "2026-08-01T13:00:00.000Z",
  evidenceScope: [],
} as const;

describe("task contracts", () => {
  it("decodes a complete immutable contract", () => {
    expect(decodeStrictSync(TaskContract, contract).schemaVersion).toBe(1);
  });

  it("rejects an unknown top-level field", () => {
    expect(() =>
      decodeStrictSync(TaskContract, { ...contract, recipient: "outside" }),
    ).toThrow();
  });

  it("rejects an amendment without parent hash and approval", () => {
    expect(() =>
      decodeStrictSync(TaskContractAmendment, {
        schemaVersion: 1,
        contractHash:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        exactDeltaArtifactId:
          "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        reason: "new research domain",
        approvedAt: "2026-08-01T12:30:00.000Z",
      }),
    ).toThrow();
  });

  it("requires an authority class on an approval", () => {
    expect(
      decodeStrictSync(Approval, {
        schemaVersion: 1,
        approvalId: "apr_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        actionHash:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        contractHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        approver: "council-chair",
        approverAuthority: "approved_contract",
        expiresAt: "2026-08-01T13:00:00.000Z",
      }).approverAuthority,
    ).toBe("approved_contract");
  });

  it("rejects an approval without an authority class", () => {
    expect(() =>
      decodeStrictSync(Approval, {
        schemaVersion: 1,
        approvalId: "apr_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        actionHash:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        contractHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        approver: "council-chair",
        expiresAt: "2026-08-01T13:00:00.000Z",
      }),
    ).toThrow(/approverAuthority/);
  });
});
