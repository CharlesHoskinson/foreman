import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalize } from "@foreman/core";
import { admitCheck } from "./admit.js";
import { BEGIN_SENTINEL, END_SENTINEL } from "./register.js";
import {
  CANONICAL_REGISTER_ID,
  type AdmissionRequest,
  type Approval,
  type CurrentEntry,
  type Register,
} from "./schema.js";
import type { GitCommitSnapshot } from "./services.js";

const P = "a".repeat(40);
const PT = "b".repeat(40);
const C = "c".repeat(40);
const CT = "d".repeat(40);
const REG_SHA = "e".repeat(64);
const NOW = Date.parse("2026-08-01T12:00:00Z");
const FUTURE = "2027-01-01T00:00:00Z";

function seedEntry(): CurrentEntry {
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
  };
}

function approval(overrides?: Partial<Approval>): Approval {
  return {
    approver: "Release architect",
    approvedAt: "2026-08-01T00:00:00Z",
    expiresAt: FUTURE,
    evidence: "ticket-1",
    actionKind: "artifact_relocate",
    candidateCommitSha: P,
    candidateTreeSha: PT,
    ...overrides,
  };
}

function approvedFromSeed(seed: CurrentEntry): CurrentEntry {
  return {
    ...seed,
    state: "approved",
    owner: "architect",
    evidence: "sha known",
    recordedAt: "2026-08-01T00:00:00Z",
    recoveryStatus: "recovery_ready",
    approval: approval(),
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

function parentBlob(entries: CurrentEntry[]): Uint8Array {
  const r = reg(entries);
  const json = canonicalize(r);
  return new TextEncoder().encode(
    [BEGIN_SENTINEL, json, END_SENTINEL, ""].join("\n"),
  );
}

function req(entryId: string): AdmissionRequest {
  return { schemaVersion: 1, entryId };
}

function snap(
  parentEntries: CurrentEntry[],
  overrides?: Partial<GitCommitSnapshot>,
): GitCommitSnapshot {
  return {
    commitC: C,
    treeC: CT,
    parentP: P,
    treeP: PT,
    approvalCommitEligible: true,
    parentBlobBytes: parentBlob(parentEntries),
    ...overrides,
  };
}

describe("admitCheck", () => {
  it("authorizes single-row P→C approval with parent delta", () => {
    const seed = seedEntry();
    const result = admitCheck(
      reg([approvedFromSeed(seed)]),
      REG_SHA,
      req("DST-9999"),
      NOW,
      snap([seed]),
    );
    assert.equal(result._tag, "Authorized");
  });

  it("denies blocked without needing parent register", () => {
    const blocked: CurrentEntry = {
      id: "DST-0060",
      targetOrAction: "spec",
      state: "blocked",
      requiredCondition: "guard",
      owner: "Sprint 0 architect",
      evidence: "bytes",
      recordedAt: "2026-08-04T00:00:41-06:00",
      recoveryStatus: "external_path_pending_guard",
      actionKind: "artifact_relocate",
      artifactRelocate: {
        sourcePath: "/s",
        recoveryPath: "/r",
        byteLength: 5359,
        sha256:
          "90b74c67fcafccb4c04b1402ba6b275e6809debd4aa096efdc7b23b7c97275db",
      },
    };
    const r = admitCheck(
      reg([blocked]),
      REG_SHA,
      req("DST-0060"),
      NOW,
      {
        commitC: C,
        treeC: CT,
        parentP: null,
        treeP: null,
        approvalCommitEligible: false,
        parentBlobBytes: null,
      },
    );
    assert.equal(r._tag, "Denied");
    if (r._tag === "Denied") assert.equal(r.reason, "state_blocked");
  });

  it("denies smuggled second-row change via approval_delta_mismatch", () => {
    const seed = seedEntry();
    const other = seedEntry();
    const other2: CurrentEntry = {
      ...other,
      id: "DST-0001",
      targetOrAction: "other",
    };
    const r = admitCheck(
      reg([
        approvedFromSeed(seed),
        { ...other2, owner: "changed" },
      ]),
      REG_SHA,
      req("DST-9999"),
      NOW,
      snap([seed, other2]),
    );
    assert.equal(r._tag, "Denied");
    if (r._tag === "Denied") assert.equal(r.reason, "approval_delta_mismatch");
  });

  it("denies when parent blob missing for approved", () => {
    const seed = seedEntry();
    const r = admitCheck(
      reg([approvedFromSeed(seed)]),
      REG_SHA,
      req("DST-9999"),
      NOW,
      snap([seed], { parentBlobBytes: null }),
    );
    assert.equal(r._tag, "Denied");
    if (r._tag === "Denied")
      assert.equal(r.reason, "approval_commit_ineligible");
  });

  it("denies approval commit ineligible", () => {
    const seed = seedEntry();
    const r = admitCheck(
      reg([approvedFromSeed(seed)]),
      REG_SHA,
      req("DST-9999"),
      NOW,
      snap([seed], { approvalCommitEligible: false }),
    );
    assert.equal((r as { reason: string }).reason, "approval_commit_ineligible");
  });

  it("denies when approval binds C instead of P", () => {
    const seed = seedEntry();
    const approved = approvedFromSeed(seed);
    const bad: CurrentEntry = {
      ...approved,
      approval: approval({
        candidateCommitSha: C,
        candidateTreeSha: CT,
      }),
    };
    const r = admitCheck(reg([bad]), REG_SHA, req("DST-9999"), NOW, snap([seed]));
    assert.equal((r as { reason: string }).reason, "candidate_mismatch");
  });

  it("denies future recordedAt and recordedAt after approvedAt", () => {
    const seed = seedEntry();
    const base = approvedFromSeed(seed);
    const futureRec: CurrentEntry = {
      ...base,
      recordedAt: "2099-01-01T00:00:00Z",
      approval: approval({
        approvedAt: "2026-01-01T00:00:00Z",
        expiresAt: "2027-01-01T00:00:00Z",
      }),
    };
    const r1 = admitCheck(
      reg([futureRec]),
      REG_SHA,
      req("DST-9999"),
      Date.parse("2026-06-01T00:00:00Z"),
      snap([seed]),
    );
    assert.equal((r1 as { reason: string }).reason, "invalid_recorded_at");

    const afterAppr: CurrentEntry = {
      ...base,
      recordedAt: "2026-05-01T00:00:00Z",
      approval: approval({
        approvedAt: "2026-01-01T00:00:00Z",
        expiresAt: "2027-01-01T00:00:00Z",
      }),
    };
    const r2 = admitCheck(
      reg([afterAppr]),
      REG_SHA,
      req("DST-9999"),
      Date.parse("2026-06-01T00:00:00Z"),
      snap([seed]),
    );
    assert.equal((r2 as { reason: string }).reason, "invalid_recorded_at");
  });

  it("accepts recordedAt == approvedAt and fractional boundary", () => {
    const seed = seedEntry();
    const eq: CurrentEntry = {
      ...approvedFromSeed(seed),
      recordedAt: "2026-01-01T12:00:00.500Z",
      approval: approval({
        approvedAt: "2026-01-01T12:00:00.500Z",
        expiresAt: "2027-01-01T00:00:00Z",
      }),
    };
    const now500 = Date.parse("2026-01-01T12:00:00.500Z");
    // Date.parse may not preserve .500 the same on all engines — use explicit ms
    const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0, 500);
    assert.equal(
      admitCheck(reg([eq]), REG_SHA, req("DST-9999"), nowMs, snap([seed]))._tag,
      "Authorized",
    );
    void now500;

    // approvedAt .999 not yet at .000
    const frac: CurrentEntry = {
      ...approvedFromSeed(seed),
      recordedAt: "2026-01-01T12:00:00.000Z",
      approval: approval({
        approvedAt: "2026-01-01T12:00:00.999Z",
        expiresAt: "2027-01-01T00:00:00Z",
      }),
    };
    const rEarly = admitCheck(
      reg([frac]),
      REG_SHA,
      req("DST-9999"),
      Date.UTC(2026, 0, 1, 12, 0, 0, 0),
      snap([seed]),
    );
    assert.equal((rEarly as { reason: string }).reason, "invalid_approval");
    const rOk = admitCheck(
      reg([frac]),
      REG_SHA,
      req("DST-9999"),
      Date.UTC(2026, 0, 1, 12, 0, 0, 999),
      snap([seed]),
    );
    assert.equal(rOk._tag, "Authorized");
  });
});
