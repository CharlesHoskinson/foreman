import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCoreFailure } from "@foreman/core";
import {
  CANONICAL_REGISTER_ID,
  decodeCurrentEntry,
  decodeRegister,
  MAX_TRACKED_DELETE_TARGETS,
  type CurrentEntry,
} from "./schema.js";

const BLOB = "a".repeat(40);

function target(overrides?: Partial<{
  path: string;
  blobSha1: string;
  byteLength: number;
  mode: string;
}>) {
  return {
    path: "docs/sample.md",
    blobSha1: BLOB,
    byteLength: 4,
    mode: "100644",
    ...overrides,
  };
}

function entry(overrides?: Record<string, unknown>): unknown {
  return {
    id: "DST-9998",
    targetOrAction: "delete samples",
    state: "blocked",
    requiredCondition: "guard shipped",
    owner: "pending",
    evidence: "pending",
    recordedAt: "pending",
    recoveryStatus: "pending",
    actionKind: "tracked_delete",
    trackedDelete: { targets: [target()] },
    ...overrides,
  };
}

describe("tracked_delete schema decode", () => {
  it("accepts valid non-empty target list", () => {
    const r = decodeCurrentEntry(entry());
    assert.ok(!isCoreFailure(r));
    const e = r as CurrentEntry;
    assert.equal(e.actionKind, "tracked_delete");
    assert.equal(e.trackedDelete?.targets.length, 1);
    assert.equal(e.trackedDelete?.targets[0]?.mode, "100644");
  });

  it("rejects empty targets", () => {
    const r = decodeCurrentEntry(
      entry({ trackedDelete: { targets: [] } }),
    );
    assert.ok(isCoreFailure(r));
  });

  it("rejects duplicate target paths in payload", () => {
    const r = decodeCurrentEntry(
      entry({
        trackedDelete: {
          targets: [target(), target()],
        },
      }),
    );
    assert.ok(isCoreFailure(r));
  });

  it("rejects oversized target count", () => {
    const targets = Array.from(
      { length: MAX_TRACKED_DELETE_TARGETS + 1 },
      (_, i) => target({ path: `f${i}.txt` }),
    );
    const r = decodeCurrentEntry(
      entry({ trackedDelete: { targets } }),
    );
    assert.ok(isCoreFailure(r));
  });

  it("rejects malformed blob, mode, and absolute path fields", () => {
    assert.ok(
      isCoreFailure(
        decodeCurrentEntry(
          entry({
            trackedDelete: {
              targets: [target({ blobSha1: "not-a-sha" })],
            },
          }),
        ),
      ),
    );
    assert.ok(
      isCoreFailure(
        decodeCurrentEntry(
          entry({
            trackedDelete: {
              targets: [target({ mode: "100777" })],
            },
          }),
        ),
      ),
    );
    assert.ok(
      isCoreFailure(
        decodeCurrentEntry(
          entry({
            trackedDelete: {
              targets: [target({ byteLength: -1 })],
            },
          }),
        ),
      ),
    );
  });

  it("rejects trackedDelete on non-tracked action kind", () => {
    const r = decodeCurrentEntry({
      id: "DST-0001",
      targetOrAction: "x",
      state: "blocked",
      requiredCondition: "c",
      owner: "o",
      evidence: "e",
      recordedAt: "2026-01-01T00:00:00Z",
      recoveryStatus: "pending",
      actionKind: "none",
      trackedDelete: { targets: [target()] },
    });
    assert.ok(isCoreFailure(r));
  });

  it("rejects missing trackedDelete for tracked_delete action", () => {
    const r = decodeCurrentEntry({
      id: "DST-0001",
      targetOrAction: "x",
      state: "blocked",
      requiredCondition: "c",
      owner: "o",
      evidence: "e",
      recordedAt: "2026-01-01T00:00:00Z",
      recoveryStatus: "pending",
      actionKind: "tracked_delete",
    });
    assert.ok(isCoreFailure(r));
  });

  it("rejects oversized total batch bytes", () => {
    const r = decodeCurrentEntry(
      entry({
        trackedDelete: {
          targets: [
            target({ path: "a.txt", byteLength: 700_000 }),
            target({ path: "b.txt", byteLength: 700_000 }),
          ],
        },
      }),
    );
    assert.ok(isCoreFailure(r));
  });

  it("decodeRegister accepts approved tracked_delete with matching approval", () => {
    const r = decodeRegister({
      schemaVersion: 1,
      registerId: CANONICAL_REGISTER_ID,
      currentEntries: [
        {
          id: "DST-9998",
          targetOrAction: "delete samples",
          state: "approved",
          requiredCondition: "guard shipped",
          owner: "architect",
          evidence: "complete",
          recordedAt: "2026-08-01T00:00:00Z",
          recoveryStatus: "recovery_ready",
          actionKind: "tracked_delete",
          trackedDelete: { targets: [target()] },
          approval: {
            approver: "Release architect",
            approvedAt: "2026-08-01T00:00:00Z",
            expiresAt: "2027-01-01T00:00:00Z",
            evidence: "ticket",
            actionKind: "tracked_delete",
            candidateCommitSha: "b".repeat(40),
            candidateTreeSha: "c".repeat(40),
          },
        },
      ],
      historicalIncidents: [],
    });
    assert.ok(!isCoreFailure(r));
  });
});
