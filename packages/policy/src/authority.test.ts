import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { canonicalize } from "@foreman/core";
import { loadCommittedAuthority } from "./authority.js";
import { BEGIN_SENTINEL, END_SENTINEL } from "./register.js";
import { GitIdentity, PolicyGitError } from "./services.js";
import { CANONICAL_REGISTER_ID, type Register } from "./schema.js";

const C = "a".repeat(40);
const CT = "b".repeat(40);
const P = "c".repeat(40);
const PT = "d".repeat(40);

function md(): Uint8Array {
  const register: Register = {
    schemaVersion: 1,
    registerId: CANONICAL_REGISTER_ID,
    currentEntries: [
      {
        id: "DST-0060",
        targetOrAction: "spec",
        state: "blocked",
        requiredCondition: "g",
        owner: "o",
        evidence: "e",
        recordedAt: "2026-08-04T00:00:41-06:00",
        recoveryStatus: "external_path_pending_guard",
        actionKind: "none",
      },
    ],
    historicalIncidents: [],
  };
  return new TextEncoder().encode(
    [BEGIN_SENTINEL, canonicalize(register), END_SENTINEL, ""].join("\n"),
  );
}

describe("loadCommittedAuthority", () => {
  it("accepts clean matching C blob and worktree", () => {
    const bytes = md();
    const layer = Layer.succeed(GitIdentity, {
      snapshotAuthority: () =>
        Effect.succeed({
          snapshot: {
            commitC: C,
            treeC: CT,
            parentP: P,
            treeP: PT,
            approvalCommitEligible: false,
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
    const auth = Effect.runSync(
      loadCommittedAuthority("/repo").pipe(Effect.provide(layer)),
    );
    assert.equal(auth.snapshot.commitC, C);
    assert.equal(auth.register.currentEntries[0]?.id, "DST-0060");
  });

  it("rejects dirty authority from service", () => {
    const layer = Layer.succeed(GitIdentity, {
      snapshotAuthority: () =>
        Effect.fail(new PolicyGitError("authority_dirty")),
      inspectTrackedAtCommit: () =>
        Effect.fail(new PolicyGitError("internal_failed")),
      assertHeadCommit: () => Effect.void,
      assertTrackedIndexClean: () => Effect.void,
    });
    const either = Effect.runSync(
      Effect.either(
        loadCommittedAuthority("/repo").pipe(Effect.provide(layer)),
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "authority_dirty");
    }
  });
});
