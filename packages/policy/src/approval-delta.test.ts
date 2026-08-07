import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalize } from "@foreman/core";
import { validateApprovalDelta } from "./approval-delta.js";
import {
  CANONICAL_REGISTER_ID,
  type CurrentEntry,
  type Register,
} from "./schema.js";

const P = "a".repeat(40);
const PT = "b".repeat(40);

function seedEntry(overrides?: Partial<CurrentEntry>): CurrentEntry {
  return {
    id: "DST-9999",
    targetOrAction: "file",
    state: "blocked",
    requiredCondition: "ok",
    owner: "pending",
    evidence: "pending",
    recordedAt: "pending",
    recoveryStatus: "pending",
    actionKind: "artifact_relocate",
    artifactRelocate: {
      sourcePath: "/tmp/src",
      recoveryPath: "/tmp/dst",
      byteLength: 10,
      sha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    ...overrides,
  };
}

function approvedFromSeed(seed: CurrentEntry): CurrentEntry {
  return {
    ...seed,
    state: "approved",
    owner: "architect",
    evidence: "complete",
    recordedAt: "2026-08-01T00:00:00Z",
    recoveryStatus: "recovery_ready",
    approval: {
      approver: "Release architect",
      approvedAt: "2026-08-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      evidence: "ticket",
      actionKind: "artifact_relocate",
      candidateCommitSha: P,
      candidateTreeSha: PT,
    },
  };
}

function reg(entries: CurrentEntry[]): Register {
  return {
    schemaVersion: 1,
    registerId: CANONICAL_REGISTER_ID,
    currentEntries: entries,
    historicalIncidents: [],
  };
}

describe("validateApprovalDelta", () => {
  it("accepts exact single-row blocked→approved transition", () => {
    const seed = seedEntry();
    const parent = reg([seed]);
    const current = reg([approvedFromSeed(seed)]);
    assert.equal(validateApprovalDelta(parent, current, "DST-9999"), null);
  });

  it("rejects second approved row", () => {
    const seed = seedEntry();
    const other = seedEntry({ id: "DST-0001", targetOrAction: "other" });
    const parent = reg([seed, other]);
    const current = reg([
      approvedFromSeed(seed),
      approvedFromSeed(other),
    ]);
    assert.equal(
      validateApprovalDelta(parent, current, "DST-9999"),
      "approval_delta_mismatch",
    );
  });

  it("rejects edit of another row", () => {
    const seed = seedEntry();
    const other = seedEntry({ id: "DST-0001", owner: "a" });
    const parent = reg([seed, other]);
    const current = reg([
      approvedFromSeed(seed),
      { ...other, owner: "changed" },
    ]);
    assert.equal(
      validateApprovalDelta(parent, current, "DST-9999"),
      "approval_delta_mismatch",
    );
  });

  it("rejects removal of a row", () => {
    const seed = seedEntry();
    const other = seedEntry({ id: "DST-0001" });
    const parent = reg([seed, other]);
    const current = reg([approvedFromSeed(seed)]);
    assert.equal(
      validateApprovalDelta(parent, current, "DST-9999"),
      "approval_delta_mismatch",
    );
  });

  it("rejects historical edit", () => {
    const seed = seedEntry();
    const parent: Register = {
      ...reg([seed]),
      historicalIncidents: [
        {
          id: "DST-0052",
          targetOrAction: "old",
          state: "late_register_replaced_recoverable",
          requiredCondition: "n/a",
          owner: "architect",
          evidence: "hist",
          recordedAt: "2026-01-01T00:00:00Z",
        },
      ],
    };
    const current: Register = {
      ...reg([approvedFromSeed(seed)]),
      historicalIncidents: [
        {
          id: "DST-0052",
          targetOrAction: "changed",
          state: "late_register_replaced_recoverable",
          requiredCondition: "n/a",
          owner: "architect",
          evidence: "hist",
          recordedAt: "2026-01-01T00:00:00Z",
        },
      ],
    };
    assert.equal(
      validateApprovalDelta(parent, current, "DST-9999"),
      "approval_delta_mismatch",
    );
  });

  it("rejects action path/hash/size change", () => {
    const seed = seedEntry();
    const parent = reg([seed]);
    const bad = approvedFromSeed(seed);
    const mutated: CurrentEntry = {
      ...bad,
      artifactRelocate: {
        ...bad.artifactRelocate!,
        byteLength: 99,
      },
    };
    assert.equal(
      validateApprovalDelta(parent, reg([mutated]), "DST-9999"),
      "approval_delta_mismatch",
    );
  });

  it("rejects newly introduced request row", () => {
    const other = seedEntry({ id: "DST-0001" });
    const parent = reg([other]);
    const introduced = approvedFromSeed(seedEntry());
    assert.equal(
      validateApprovalDelta(parent, reg([other, introduced]), "DST-9999"),
      "approval_delta_mismatch",
    );
  });

  it("rejects parent already approved", () => {
    const seed = approvedFromSeed(seedEntry());
    // strip to approved parent with approval — invalid
    const parent = reg([seed]);
    const current = reg([seed]);
    assert.equal(
      validateApprovalDelta(parent, current, "DST-9999"),
      "approval_delta_mismatch",
    );
  });

  it("canonical equality of non-requested rows is order-sensitive", () => {
    const a = seedEntry({ id: "DST-0001" });
    const b = seedEntry({ id: "DST-0002" });
    const seed = seedEntry();
    const parent = reg([a, b, seed]);
    const current = reg([b, a, approvedFromSeed(seed)]);
    assert.equal(
      validateApprovalDelta(parent, current, "DST-9999"),
      "approval_delta_mismatch",
    );
    void canonicalize;
  });
});
