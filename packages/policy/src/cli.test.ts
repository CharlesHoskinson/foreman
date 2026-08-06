import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { canonicalize } from "@foreman/core";
import { runCli } from "./cli.js";
import { BEGIN_SENTINEL, END_SENTINEL } from "./register.js";
import { gitBlobSha1 } from "./tracked-delete.js";
import {
  Clock,
  FileSystem,
  GitIdentity,
  PolicyFsError,
  PolicyGitError,
  makeMemoryMutationProbe,
  type FileStat,
} from "./services.js";
import {
  CANONICAL_REGISTER_ID,
  type CurrentEntry,
  type Register,
  type TrackedDeleteTarget,
} from "./schema.js";
import { join, resolve } from "node:path";

// Platform-native fixture root. The code under test builds absolute paths with
// path.join(), which yields backslashes on Windows; keying the in-memory
// filesystem with POSIX literals made every lookup miss there, so delete-tracked
// denied instead of completing and the CLI exited 1. Same correction as
// packages/policy/src/tracked-delete.test.ts.
const REPO_ROOT = resolve("/repo");
const PKG_DIR = join(REPO_ROOT, "pkg");
const A_TXT = join(PKG_DIR, "a.txt");

/** The way `value` appears inside JSON output, without the quotes. */
function jsonEscaped(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

const C = "a".repeat(40);
const CT = "b".repeat(40);
const P = "c".repeat(40);
const PT = "d".repeat(40);
const NOW = Date.parse("2026-08-01T12:00:00Z");

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

function fileStat(partial: Partial<FileStat> & { size: number }): FileStat {
  return {
    isFile: partial.isFile ?? true,
    isDirectory: partial.isDirectory ?? false,
    isSymbolicLink: partial.isSymbolicLink ?? false,
    size: partial.size,
    nlink: partial.nlink ?? 1,
    mode: partial.mode ?? 0o100644,
    dev: partial.dev ?? "1",
    ino: partial.ino ?? "1",
  };
}

const stubFs = Layer.succeed(FileSystem, {
  readFile: () => Effect.fail(new PolicyFsError("internal_failed")),
  readFileNoFollow: () => Effect.fail(new PolicyFsError("internal_failed")),
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
    inspectTrackedAtCommit: () =>
      Effect.fail(new PolicyGitError("internal_failed")),
    assertHeadCommit: () => Effect.void,
    assertTrackedIndexClean: () => Effect.void,
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
        ["node", "destruction-guard.js", "check", "--repo-root", REPO_ROOT],
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
        ["check", "--register", "/tmp/forged.md", "--repo-root", REPO_ROOT],
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

  it("delete-tracked Completed with exit 0 and canonical closed receipt", () => {
    const content = new TextEncoder().encode("data");
    const blob = gitBlobSha1(content);
    const targets: TrackedDeleteTarget[] = [
      {
        path: "pkg/a.txt",
        blobSha1: blob,
        byteLength: content.byteLength,
        mode: "100644",
      },
    ];
    const seed: CurrentEntry = {
      id: "DST-9998",
      targetOrAction: "exact",
      state: "blocked",
      requiredCondition: "ok",
      owner: "pending",
      evidence: "pending",
      recordedAt: "pending",
      recoveryStatus: "pending",
      actionKind: "tracked_delete",
      trackedDelete: { targets },
    };
    const approved: CurrentEntry = {
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
        actionKind: "tracked_delete",
        candidateCommitSha: P,
        candidateTreeSha: PT,
      },
    };
    const bytes = new TextEncoder().encode(
      [
        BEGIN_SENTINEL,
        canonicalize({
          schemaVersion: 1,
          registerId: CANONICAL_REGISTER_ID,
          currentEntries: [approved],
          historicalIncidents: [],
        }),
        END_SENTINEL,
        "",
      ].join("\n"),
    );
    const parentBytes = new TextEncoder().encode(
      [
        BEGIN_SENTINEL,
        canonicalize({
          schemaVersion: 1,
          registerId: CANONICAL_REGISTER_ID,
          currentEntries: [seed],
          historicalIncidents: [],
        }),
        END_SENTINEL,
        "",
      ].join("\n"),
    );
    const probe = makeMemoryMutationProbe();
    const store = new Map<string, { bytes: Uint8Array; mode: number; ino: string }>([
      [A_TXT, { bytes: content, mode: 0o100644, ino: "1" }],
    ]);
    const dirs = new Set([REPO_ROOT, PKG_DIR]);
    const gitLayer = Layer.succeed(GitIdentity, {
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
        Effect.succeed({
          mode: "100644",
          blobSha1: blob,
          size: content.byteLength,
        }),
      assertHeadCommit: () => Effect.void,
      assertTrackedIndexClean: () => Effect.void,
    });
    const fsLayer = Layer.succeed(FileSystem, {
      readFile: (p) => {
        const f = store.get(p);
        return f
          ? Effect.succeed(f.bytes)
          : Effect.fail(new PolicyFsError("target_missing"));
      },
      readFileNoFollow: (p) => {
        const f = store.get(p);
        if (!f) return Effect.fail(new PolicyFsError("target_missing"));
        return Effect.succeed({
          bytes: f.bytes,
          stat: fileStat({ size: f.bytes.byteLength, mode: f.mode, ino: f.ino }),
        });
      },
      writeExclusive: () => Effect.void,
      createFile: () => Effect.void,
      lstat: (p) => {
        if (dirs.has(p)) {
          return Effect.succeed(
            fileStat({
              size: 0,
              isFile: false,
              isDirectory: true,
              mode: 0o040755,
              ino: p,
            }),
          );
        }
        const f = store.get(p);
        if (!f) return Effect.fail(new PolicyFsError("target_missing"));
        return Effect.succeed(
          fileStat({ size: f.bytes.byteLength, mode: f.mode, ino: f.ino }),
        );
      },
      stat: (p) => {
        if (dirs.has(p)) {
          return Effect.succeed(
            fileStat({
              size: 0,
              isFile: false,
              isDirectory: true,
              mode: 0o040755,
              ino: p,
            }),
          );
        }
        const f = store.get(p);
        if (!f) return Effect.fail(new PolicyFsError("target_missing"));
        return Effect.succeed(
          fileStat({ size: f.bytes.byteLength, mode: f.mode, ino: f.ino }),
        );
      },
      exists: (p) => Effect.sync(() => store.has(p) || dirs.has(p)),
      unlink: (p) =>
        Effect.sync(() => {
          store.delete(p);
        }),
      rename: (from, to) =>
        Effect.gen(function* () {
          const f = store.get(from);
          if (!f) {
            return yield* Effect.fail(new PolicyFsError("mutation_rejected"));
          }
          store.delete(from);
          store.set(to, f);
        }),
      copyFile: () => Effect.void,
      fsyncPath: () => Effect.void,
      parentDirExists: () => Effect.succeed(true),
    });
    const clockLayer = Layer.succeed(Clock, {
      nowMs: () => Effect.succeed(NOW),
    });
    const lines: string[] = [];
    const code = Effect.runSync(
      runCli(
        [
          "node",
          "destruction-guard.js",
          "delete-tracked",
          "--repo-root",
          REPO_ROOT,
        ],
        new TextEncoder().encode(
          canonicalize({ schemaVersion: 1, entryId: "DST-9998" }),
        ),
        {
          writeStdout: (l) => lines.push(l),
          writeStderr: () => {},
        },
      ).pipe(
        Effect.provide(
          Layer.mergeAll(gitLayer, fsLayer, clockLayer, probe.layer),
        ),
      ),
    );
    assert.equal(code, 0);
    const body = lines[0]!.trimEnd();
    const parsed = JSON.parse(body) as {
      _tag: string;
      actionKind?: string;
      recoveryCommitSha?: string;
    };
    assert.equal(parsed._tag, "Completed");
    assert.equal(parsed.actionKind, "tracked_delete");
    assert.equal(parsed.recoveryCommitSha, P);
    assert.ok(!body.includes(jsonEscaped(REPO_ROOT)));
    assert.equal(store.has(A_TXT), false);
  });

  it("delete-tracked Denied with exit 1 for blocked entry", () => {
    const content = new TextEncoder().encode("data");
    const blob = gitBlobSha1(content);
    const targets: TrackedDeleteTarget[] = [
      {
        path: "pkg/a.txt",
        blobSha1: blob,
        byteLength: content.byteLength,
        mode: "100644",
      },
    ];
    const blocked: CurrentEntry = {
      id: "DST-9998",
      targetOrAction: "exact",
      state: "blocked",
      requiredCondition: "ok",
      owner: "pending",
      evidence: "pending",
      recordedAt: "pending",
      recoveryStatus: "pending",
      actionKind: "tracked_delete",
      trackedDelete: { targets },
    };
    const bytes = new TextEncoder().encode(
      [
        BEGIN_SENTINEL,
        canonicalize({
          schemaVersion: 1,
          registerId: CANONICAL_REGISTER_ID,
          currentEntries: [blocked],
          historicalIncidents: [],
        }),
        END_SENTINEL,
        "",
      ].join("\n"),
    );
    const { layer, probe } = services(bytes);
    const lines: string[] = [];
    const code = Effect.runSync(
      runCli(
        ["delete-tracked", "--repo-root", REPO_ROOT],
        new TextEncoder().encode(
          canonicalize({ schemaVersion: 1, entryId: "DST-9998" }),
        ),
        {
          writeStdout: (l) => lines.push(l),
          writeStderr: () => {},
        },
      ).pipe(Effect.provide(layer)),
    );
    assert.equal(code, 1);
    const parsed = JSON.parse(lines[0]!.trimEnd()) as {
      _tag: string;
      reason?: string;
    };
    assert.equal(parsed._tag, "Denied");
    assert.equal(parsed.reason, "state_blocked");
    assert.equal(probe.counts.get("unlink") ?? 0, 0);
  });

  it("delete-tracked rejects malformed stdin with exit 1", () => {
    const { layer } = services(blockedMd());
    const lines: string[] = [];
    const code = Effect.runSync(
      runCli(
        ["delete-tracked", "--repo-root", REPO_ROOT],
        new TextEncoder().encode("{not-json"),
        {
          writeStdout: (l) => lines.push(l),
          writeStderr: () => {},
        },
      ).pipe(Effect.provide(layer)),
    );
    assert.equal(code, 1);
    const parsed = JSON.parse(lines[0]!.trimEnd()) as {
      _tag: string;
      reason?: string;
    };
    assert.equal(parsed._tag, "Failed");
    assert.ok(parsed.reason === "invalid_json" || parsed.reason === "schema_mismatch");
  });
});
