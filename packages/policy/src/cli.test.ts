import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { canonicalize } from "@foreman/core";
import { runCli } from "./cli.js";
import { BEGIN_SENTINEL, END_SENTINEL } from "./register.js";
import {
  Clock,
  FileSystem,
  GitIdentity,
  PolicyFsError,
  PolicyGitError,
  makeMemoryMutationProbe,
} from "./services.js";
import {
  CANONICAL_REGISTER_ID,
  type Register,
} from "./schema.js";

const C = "a".repeat(40);
const CT = "b".repeat(40);

function blockedMd(): Uint8Array {
  const register: Register = {
    schemaVersion: 1,
    registerId: CANONICAL_REGISTER_ID,
    currentEntries: [
      {
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
          byteLength: 5359,
          recoveryPath: "/home/charl/.foreman/recovery.md",
          sha256:
            "90b74c67fcafccb4c04b1402ba6b275e6809debd4aa096efdc7b23b7c97275db",
          sourcePath: "/home/charl/worktree/SPEC.md",
        },
      },
    ],
    historicalIncidents: [],
  };
  const json = canonicalize(register);
  return new TextEncoder().encode(
    [BEGIN_SENTINEL, json, END_SENTINEL, ""].join("\n"),
  );
}

const stubFs = Layer.succeed(FileSystem, {
  readFile: () => Effect.fail(new PolicyFsError("internal_failed")),
  writeExclusive: () => Effect.fail(new PolicyFsError("mutation_rejected")),
  createFile: () => Effect.fail(new PolicyFsError("mutation_rejected")),
  lstat: () => Effect.fail(new PolicyFsError("internal_failed")),
  stat: () => Effect.fail(new PolicyFsError("internal_failed")),
  exists: () => Effect.succeed(false),
  unlink: () => Effect.fail(new PolicyFsError("mutation_rejected")),
  rename: () => Effect.fail(new PolicyFsError("mutation_rejected")),
  copyFile: () => Effect.fail(new PolicyFsError("mutation_rejected")),
  fsyncPath: () => Effect.fail(new PolicyFsError("internal_failed")),
  parentDirExists: () => Effect.succeed(true),
});

function services(bytes: Uint8Array, dirty = false) {
  const probe = makeMemoryMutationProbe();
  const gitLayer = Layer.succeed(GitIdentity, {
    snapshotAuthority: () =>
      dirty
        ? Effect.fail(new PolicyGitError("authority_dirty"))
        : Effect.succeed({
            snapshot: {
              commitC: C,
              treeC: CT,
              parentP: null,
              treeP: null,
              approvalCommitEligible: false,
              parentBlobBytes: null,
            },
            commitBlobBytes: bytes,
            worktreeBytes: bytes.slice(),
          }),
    inspectTrackedAtHead: () =>
      Effect.fail(new PolicyGitError("internal_failed")),
  });
  const clockLayer = Layer.succeed(Clock, {
    nowMs: () => Effect.succeed(Date.now()),
  });
  return {
    layer: Layer.mergeAll(gitLayer, clockLayer, probe.layer, stubFs),
    probe,
  };
}

describe("runCli", () => {
  it("check Denied state_blocked for DST-0060 without mutation", () => {
    const bytes = blockedMd();
    const { layer, probe } = services(bytes);
    const lines: string[] = [];
    const stdin = new TextEncoder().encode(
      canonicalize({ schemaVersion: 1, entryId: "DST-0060" }),
    );
    const code = Effect.runSync(
      runCli(
        ["node", "destruction-guard.js", "check", "--repo-root", "/repo"],
        stdin,
        {
          writeStdout: (l) => lines.push(l),
          writeStderr: () => {},
        },
      ).pipe(Effect.provide(layer)),
    );
    assert.equal(code, 1);
    const body = lines[0]!.trimEnd();
    const parsed = JSON.parse(body) as {
      _tag: string;
      reason?: string;
      entryId?: string;
    };
    assert.equal(parsed._tag, "Denied");
    assert.equal(parsed.reason, "state_blocked");
    assert.ok(!body.includes("/home"));
    assert.equal(probe.counts.get("writeExclusive") ?? 0, 0);
  });

  it("rejects --register", () => {
    const { layer } = services(blockedMd());
    const lines: string[] = [];
    const code = Effect.runSync(
      runCli(
        ["check", "--register", "/tmp/forged.md", "--repo-root", "/repo"],
        new TextEncoder().encode('{"entryId":"DST-0060","schemaVersion":1}'),
        {
          writeStdout: (l) => lines.push(l),
          writeStderr: () => {},
        },
      ).pipe(Effect.provide(layer)),
    );
    assert.equal(code, 64);
    assert.ok(!lines[0]!.includes("/tmp"));
  });
});
