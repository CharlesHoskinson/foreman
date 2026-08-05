import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { canonicalize, sha256Hex } from "@foreman/core";
import { BEGIN_SENTINEL, END_SENTINEL } from "./register.js";
import { relocateArtifact } from "./relocate.js";
import {
  Clock,
  GitIdentity,
  PolicyGitError,
  makeMemoryMutationProbe,
} from "./services.js";
import {
  CANONICAL_REGISTER_ID,
  type CurrentEntry,
  type Register,
} from "./schema.js";

const P = "a".repeat(40);
const PT = "b".repeat(40);
const C = "c".repeat(40);
const CT = "d".repeat(40);
const CONTENT_SHA = sha256Hex("test");

function blockedEntry(): CurrentEntry {
  return {
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
      sourcePath: "/probe/source.bin",
      recoveryPath: "/probe/recovery.bin",
      byteLength: 4,
      sha256: CONTENT_SHA,
    },
  };
}

function approvedEntry(): CurrentEntry {
  return {
    id: "DST-9999",
    targetOrAction: "file",
    state: "approved",
    requiredCondition: "ok",
    owner: "architect",
    evidence: "complete",
    recordedAt: "2026-08-01T00:00:00Z",
    recoveryStatus: "recovery_ready",
    actionKind: "artifact_relocate",
    artifactRelocate: {
      sourcePath: "/probe/source.bin",
      recoveryPath: "/probe/recovery.bin",
      byteLength: 4,
      sha256: CONTENT_SHA,
    },
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

function mdFor(entry: CurrentEntry): Uint8Array {
  const register: Register = {
    schemaVersion: 1,
    registerId: CANONICAL_REGISTER_ID,
    currentEntries: [entry],
    historicalIncidents: [],
  };
  const json = canonicalize(register);
  return new TextEncoder().encode(
    [BEGIN_SENTINEL, json, END_SENTINEL, ""].join("\n"),
  );
}

function gitLayer(
  bytes: Uint8Array,
  opts?: { dirty?: boolean; eligible?: boolean },
) {
  return Layer.succeed(GitIdentity, {
    snapshotAuthority: () =>
      opts?.dirty
        ? Effect.fail(new PolicyGitError("authority_dirty"))
        : Effect.succeed({
            snapshot: {
              commitC: C,
              treeC: CT,
              parentP: opts?.eligible === false ? null : P,
              treeP: opts?.eligible === false ? null : PT,
              approvalCommitEligible: opts?.eligible !== false,
              parentBlobBytes: null,
            },
            commitBlobBytes: bytes,
            worktreeBytes: bytes.slice(),
          }),
    inspectTrackedAtCommit: () =>
      Effect.fail(new PolicyGitError("internal_failed")),
    assertHeadCommit: () => Effect.void,
    assertTrackedIndexClean: () => Effect.void,
  });
}

const clockLayer = Layer.succeed(Clock, {
  nowMs: () => Effect.succeed(Date.parse("2026-08-01T12:00:00Z")),
});

function parentBlobForApproved(): Uint8Array {
  // Parent seed with same action identity, not approved
  const seed: CurrentEntry = {
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
      sourcePath: "/probe/source.bin",
      recoveryPath: "/probe/recovery.bin",
      byteLength: 4,
      sha256: CONTENT_SHA,
    },
  };
  return mdFor(seed);
}

describe("relocateArtifact R2 fail-closed", () => {
  it("never mutates; returns platform_invariant_unproven when authorized", () => {
    const bytes = mdFor(approvedEntry());
    const parentBytes = parentBlobForApproved();
    const probe = makeMemoryMutationProbe();
    const layer = Layer.succeed(GitIdentity, {
      snapshotAuthority: () =>
        Effect.succeed({
          snapshot: {
            commitC: C,
            treeC: CT,
            parentP: P,
            treeP: PT,
            approvalCommitEligible: true,
            parentBlobBytes: parentBytes,
          },
          commitBlobBytes: bytes,
          worktreeBytes: bytes.slice(),
        }),
      inspectTrackedAtCommit: () =>
        Effect.fail(new PolicyGitError("internal_failed")),
      assertHeadCommit: () => Effect.void,
      assertTrackedIndexClean: () => Effect.void,
    });
    const result = Effect.runSync(
      relocateArtifact({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-9999" },
      }).pipe(Effect.provide(Layer.mergeAll(layer, clockLayer, probe.layer))),
    );
    assert.equal(result._tag, "Failed");
    if (result._tag === "Failed") {
      assert.equal(result.reason, "platform_invariant_unproven");
    }
    assert.equal(probe.counts.get("writeExclusive") ?? 0, 0);
    assert.equal(probe.counts.get("live_relocate_refused"), 1);
  });

  it("denies blocked without mutation", () => {
    const bytes = mdFor(blockedEntry());
    const probe = makeMemoryMutationProbe();
    const result = Effect.runSync(
      relocateArtifact({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-0060" },
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            gitLayer(bytes, { eligible: false }),
            clockLayer,
            probe.layer,
          ),
        ),
      ),
    );
    assert.equal(result._tag, "Denied");
    if (result._tag === "Denied") assert.equal(result.reason, "state_blocked");
  });
});
