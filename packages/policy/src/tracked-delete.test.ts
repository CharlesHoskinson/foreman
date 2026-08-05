import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { Effect, Layer } from "effect";
import { canonicalize, sha256Hex } from "@foreman/core";
import { admitCheck, validateTrackedRelPath } from "./admit.js";
import { validateApprovalDelta } from "./approval-delta.js";
import { BEGIN_SENTINEL, END_SENTINEL } from "./register.js";
import { relocateArtifact } from "./relocate.js";
import { deleteTracked, gitBlobSha1 } from "./tracked-delete.js";
import {
  Clock,
  FileSystem,
  GitIdentity,
  PolicyFsError,
  PolicyGitError,
  makeMemoryMutationProbe,
  type FileStat,
  type HeadTrackedBlob,
} from "./services.js";
import {
  CANONICAL_REGISTER_ID,
  CANONICAL_REGISTER_RELPATH,
  MAX_TRACKED_BATCH_BYTES,
  MAX_TRACKED_PATH_BYTES,
  type CurrentEntry,
  type Register,
  type TrackedDeleteTarget,
} from "./schema.js";

const P = "a".repeat(40);
const PT = "b".repeat(40);
const C = "c".repeat(40);
const CT = "d".repeat(40);
const NOW = Date.parse("2026-08-01T12:00:00Z");

function mdFor(entries: CurrentEntry[]): Uint8Array {
  const register: Register = {
    schemaVersion: 1,
    registerId: CANONICAL_REGISTER_ID,
    currentEntries: entries,
    historicalIncidents: [],
  };
  return new TextEncoder().encode(
    [BEGIN_SENTINEL, canonicalize(register), END_SENTINEL, ""].join("\n"),
  );
}

function seedTracked(targets: TrackedDeleteTarget[]): CurrentEntry {
  return {
    id: "DST-9998",
    targetOrAction: "exact tracked files",
    state: "blocked",
    requiredCondition: "ok",
    owner: "pending",
    evidence: "pending",
    recordedAt: "pending",
    recoveryStatus: "pending",
    actionKind: "tracked_delete",
    trackedDelete: { targets },
  };
}

function approvedTracked(
  targets: TrackedDeleteTarget[],
  overrides?: Partial<CurrentEntry>,
): CurrentEntry {
  return {
    ...seedTracked(targets),
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
    ...overrides,
  };
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

describe("validateTrackedRelPath", () => {
  it("accepts canonical relative paths", () => {
    assert.equal(validateTrackedRelPath("docs/a.md"), null);
    assert.equal(validateTrackedRelPath("a"), null);
  });

  it("rejects absolute, traversal, dot, empty, .git, register, glob, group, overlong", () => {
    assert.equal(validateTrackedRelPath("/abs"), "invalid_path");
    assert.equal(validateTrackedRelPath("../x"), "invalid_path");
    assert.equal(validateTrackedRelPath("a/../b"), "invalid_path");
    assert.equal(validateTrackedRelPath("./x"), "invalid_path");
    assert.equal(validateTrackedRelPath(""), "invalid_path");
    assert.equal(validateTrackedRelPath(".git/config"), "invalid_path");
    assert.equal(
      validateTrackedRelPath(CANONICAL_REGISTER_RELPATH),
      "register_self_target",
    );
    assert.equal(validateTrackedRelPath("a*.md"), "glob_target");
    assert.equal(validateTrackedRelPath("a,b"), "group_target");
    assert.equal(validateTrackedRelPath("a\\b"), "invalid_path");
    const over = "x".repeat(MAX_TRACKED_PATH_BYTES + 1);
    assert.equal(validateTrackedRelPath(over), "invalid_path");
  });
});

describe("admitCheck tracked_delete", () => {
  it("authorizes exact tracked_delete with parent delta", () => {
    const content = new TextEncoder().encode("hi\n");
    const targets: TrackedDeleteTarget[] = [
      {
        path: "docs/a.md",
        blobSha1: gitBlobSha1(content),
        byteLength: content.byteLength,
        mode: "100644",
      },
    ];
    const seed = seedTracked(targets);
    const approved = approvedTracked(targets);
    const parentBytes = mdFor([seed]);
    const result = admitCheck(
      {
        schemaVersion: 1,
        registerId: CANONICAL_REGISTER_ID,
        currentEntries: [approved],
        historicalIncidents: [],
      },
      "e".repeat(64),
      { schemaVersion: 1, entryId: "DST-9998" },
      NOW,
      {
        commitC: C,
        treeC: CT,
        parentP: P,
        treeP: PT,
        approvalCommitEligible: true,
        parentBlobBytes: parentBytes,
      },
    );
    assert.equal(result._tag, "Authorized");
    if (result._tag === "Authorized") {
      assert.equal(result.actionKind, "tracked_delete");
    }
  });

  it("denies expired approval", () => {
    const targets: TrackedDeleteTarget[] = [
      {
        path: "docs/a.md",
        blobSha1: "f".repeat(40),
        byteLength: 1,
        mode: "100644",
      },
    ];
    const seed = seedTracked(targets);
    const approved = approvedTracked(targets, {
      recordedAt: "2020-01-01T00:00:00Z",
      approval: {
        approver: "Release architect",
        approvedAt: "2020-01-01T00:00:00Z",
        expiresAt: "2020-06-01T00:00:00Z",
        evidence: "ticket",
        actionKind: "tracked_delete",
        candidateCommitSha: P,
        candidateTreeSha: PT,
      },
    });
    const r = admitCheck(
      {
        schemaVersion: 1,
        registerId: CANONICAL_REGISTER_ID,
        currentEntries: [approved],
        historicalIncidents: [],
      },
      "e".repeat(64),
      { schemaVersion: 1, entryId: "DST-9998" },
      NOW,
      {
        commitC: C,
        treeC: CT,
        parentP: P,
        treeP: PT,
        approvalCommitEligible: true,
        parentBlobBytes: mdFor([seed]),
      },
    );
    assert.equal((r as { reason: string }).reason, "expired_approval");
  });

  it("denies register self-target at admit time", () => {
    const targets: TrackedDeleteTarget[] = [
      {
        path: CANONICAL_REGISTER_RELPATH,
        blobSha1: "f".repeat(40),
        byteLength: 1,
        mode: "100644",
      },
    ];
    const seed = seedTracked(targets);
    const approved = approvedTracked(targets);
    const r = admitCheck(
      {
        schemaVersion: 1,
        registerId: CANONICAL_REGISTER_ID,
        currentEntries: [approved],
        historicalIncidents: [],
      },
      "e".repeat(64),
      { schemaVersion: 1, entryId: "DST-9998" },
      NOW,
      {
        commitC: C,
        treeC: CT,
        parentP: P,
        treeP: PT,
        approvalCommitEligible: true,
        parentBlobBytes: mdFor([seed]),
      },
    );
    assert.equal((r as { reason: string }).reason, "register_self_target");
  });

  it("denies unsupported action kinds", () => {
    const entry: CurrentEntry = {
      id: "DST-0002",
      targetOrAction: "wt",
      state: "approved",
      requiredCondition: "ok",
      owner: "architect",
      evidence: "e",
      recordedAt: "2026-08-01T00:00:00Z",
      recoveryStatus: "recovery_ready",
      actionKind: "worktree_remove",
      approval: {
        approver: "a",
        approvedAt: "2026-08-01T00:00:00Z",
        expiresAt: "2027-01-01T00:00:00Z",
        evidence: "e",
        actionKind: "artifact_relocate",
        candidateCommitSha: P,
        candidateTreeSha: PT,
      },
    };
    const r = admitCheck(
      {
        schemaVersion: 1,
        registerId: CANONICAL_REGISTER_ID,
        currentEntries: [entry],
        historicalIncidents: [],
      },
      "e".repeat(64),
      { schemaVersion: 1, entryId: "DST-0002" },
      NOW,
      {
        commitC: C,
        treeC: CT,
        parentP: P,
        treeP: PT,
        approvalCommitEligible: true,
        parentBlobBytes: new Uint8Array(0),
      },
    );
    assert.equal((r as { reason: string }).reason, "unsupported_action");
  });

  it("exports one named total-batch byte bound", () => {
    assert.equal(MAX_TRACKED_BATCH_BYTES, 1_048_576);
  });
});

describe("approval-delta tracked_delete widening", () => {
  it("rejects target list widening in C", () => {
    const t1: TrackedDeleteTarget = {
      path: "a.txt",
      blobSha1: "1".repeat(40),
      byteLength: 1,
      mode: "100644",
    };
    const t2: TrackedDeleteTarget = {
      path: "b.txt",
      blobSha1: "2".repeat(40),
      byteLength: 1,
      mode: "100644",
    };
    const parent: Register = {
      schemaVersion: 1,
      registerId: CANONICAL_REGISTER_ID,
      currentEntries: [seedTracked([t1])],
      historicalIncidents: [],
    };
    const current: Register = {
      schemaVersion: 1,
      registerId: CANONICAL_REGISTER_ID,
      currentEntries: [approvedTracked([t1, t2])],
      historicalIncidents: [],
    };
    assert.equal(
      validateApprovalDelta(parent, current, "DST-9998"),
      "approval_delta_mismatch",
    );
  });

  it("accepts exact single-row tracked_delete approval", () => {
    const t1: TrackedDeleteTarget = {
      path: "a.txt",
      blobSha1: "1".repeat(40),
      byteLength: 1,
      mode: "100644",
    };
    const parent: Register = {
      schemaVersion: 1,
      registerId: CANONICAL_REGISTER_ID,
      currentEntries: [seedTracked([t1])],
      historicalIncidents: [],
    };
    const current: Register = {
      schemaVersion: 1,
      registerId: CANONICAL_REGISTER_ID,
      currentEntries: [approvedTracked([t1])],
      historicalIncidents: [],
    };
    assert.equal(validateApprovalDelta(parent, current, "DST-9998"), null);
  });
});

describe("deleteTracked preflight and mutation (mocked)", () => {
  const content = new TextEncoder().encode("data");
  const blob = gitBlobSha1(content);
  const targets: TrackedDeleteTarget[] = [
    {
      path: "pkg/a.txt",
      blobSha1: blob,
      byteLength: content.byteLength,
      mode: "100644",
    },
    {
      path: "pkg/b.txt",
      blobSha1: blob,
      byteLength: content.byteLength,
      mode: "100644",
    },
  ];

  function authLayers(opts: {
    head?: (
      path: string,
    ) => Effect.Effect<HeadTrackedBlob, PolicyGitError>;
    fs?: Partial<{
      lstat: (p: string) => Effect.Effect<FileStat, PolicyFsError>;
      readFileNoFollow: (
        p: string,
        max: number,
      ) => Effect.Effect<
        { bytes: Uint8Array; stat: FileStat },
        PolicyFsError
      >;
      exists: (p: string) => Effect.Effect<boolean>;
      unlink: (p: string) => Effect.Effect<void, PolicyFsError>;
      rename: (from: string, to: string) => Effect.Effect<void, PolicyFsError>;
      createFile: (
        p: string,
        d: Uint8Array,
        m: number,
      ) => Effect.Effect<void, PolicyFsError>;
    }>;
    /** Fail the Nth rename (1-based) via FileSystem seam — not MutationProbe. */
    failRenameAfter?: number;
    /** Die with a defect on the Nth rename. */
    dieRenameAfter?: number;
    assertHead?: () => Effect.Effect<void, PolicyGitError>;
    assertIndex?: () => Effect.Effect<void, PolicyGitError>;
    /** Register entry override for mutation-boundary action-kind tests. */
    entryOverride?: CurrentEntry;
    parentOverride?: CurrentEntry;
  }) {
    const seed = opts.parentOverride ?? seedTracked(targets);
    const approved = opts.entryOverride ?? approvedTracked(targets);
    const bytes = mdFor([approved]);
    const parentBytes = mdFor([seed]);
    const probe = makeMemoryMutationProbe();
    const removed = new Set<string>();
    const store = new Map<string, { bytes: Uint8Array; mode: number; ino: string }>();
    let inoSeq = 10;
    for (const t of targets) {
      store.set(`/repo/${t.path}`, {
        bytes: content,
        mode: 0o100644,
        ino: String(inoSeq++),
      });
    }
    // Directory chain identities
    const dirs = new Map<string, FileStat>([
      ["/repo", fileStat({ size: 0, isFile: false, isDirectory: true, ino: "d1", mode: 0o040755 })],
      ["/repo/pkg", fileStat({ size: 0, isFile: false, isDirectory: true, ino: "d2", mode: 0o040755 })],
    ]);

    let renameCount = 0;

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
      inspectTrackedAtCommit: (_repo, _commit, path) =>
        opts.head
          ? opts.head(path)
          : Effect.succeed({
              mode: "100644",
              blobSha1: blob,
              size: content.byteLength,
            }),
      assertHeadCommit: () =>
        opts.assertHead
          ? opts.assertHead()
          : Effect.void,
      assertTrackedIndexClean: () =>
        opts.assertIndex
          ? opts.assertIndex()
          : Effect.void,
    });

    const defaultLstat = (p: string): Effect.Effect<FileStat, PolicyFsError> => {
      if (dirs.has(p)) return Effect.succeed(dirs.get(p)!);
      const f = store.get(p);
      if (!f) return Effect.fail(new PolicyFsError("target_missing"));
      return Effect.succeed(
        fileStat({
          size: f.bytes.byteLength,
          mode: f.mode,
          ino: f.ino,
          nlink: 1,
        }),
      );
    };

    const defaultReadNoFollow = (
      p: string,
    ): Effect.Effect<{ bytes: Uint8Array; stat: FileStat }, PolicyFsError> => {
      const f = store.get(p);
      if (!f) return Effect.fail(new PolicyFsError("target_missing"));
      return Effect.succeed({
        bytes: f.bytes,
        stat: fileStat({
          size: f.bytes.byteLength,
          mode: f.mode,
          ino: f.ino,
        }),
      });
    };

    const fsLayer = Layer.succeed(FileSystem, {
      readFile: (p) => {
        const f = store.get(p);
        return f
          ? Effect.succeed(f.bytes)
          : Effect.fail(new PolicyFsError("target_missing"));
      },
      readFileNoFollow: (p, max) =>
        opts.fs?.readFileNoFollow
          ? opts.fs.readFileNoFollow(p, max)
          : defaultReadNoFollow(p),
      writeExclusive: () => Effect.void,
      createFile: (p, d, m) =>
        opts.fs?.createFile
          ? opts.fs.createFile(p, d, m)
          : Effect.gen(function* () {
              if (store.has(p)) {
                return yield* Effect.fail(new PolicyFsError("mutation_rejected"));
              }
              store.set(p, {
                bytes: d,
                mode: 0o100000 | (m & 0o777),
                ino: String(inoSeq++),
              });
              removed.delete(p);
            }),
      lstat: (p) => (opts.fs?.lstat ? opts.fs.lstat(p) : defaultLstat(p)),
      stat: (p) => (opts.fs?.lstat ? opts.fs.lstat(p) : defaultLstat(p)),
      exists: (p) =>
        opts.fs?.exists
          ? opts.fs.exists(p)
          : Effect.sync(() => store.has(p) || dirs.has(p)),
      unlink: (p) =>
        opts.fs?.unlink
          ? opts.fs.unlink(p)
          : Effect.sync(() => {
              store.delete(p);
              removed.add(p);
            }),
      rename: (from, to) => {
        if (opts.fs?.rename) return opts.fs.rename(from, to);
        return Effect.gen(function* () {
          // Count only outbound quarantines (not restore renames) for injection.
          const isRestore = from.includes(".foreman-td-q-");
          if (!isRestore) {
            renameCount += 1;
            if (
              opts.dieRenameAfter !== undefined &&
              renameCount >= opts.dieRenameAfter
            ) {
              return yield* Effect.die(new Error("injected_defect"));
            }
            if (
              opts.failRenameAfter !== undefined &&
              renameCount >= opts.failRenameAfter
            ) {
              return yield* Effect.fail(new PolicyFsError("mutation_rejected"));
            }
          }
          const f = store.get(from);
          if (!f) {
            return yield* Effect.fail(new PolicyFsError("mutation_rejected"));
          }
          if (store.has(to)) {
            return yield* Effect.fail(new PolicyFsError("mutation_rejected"));
          }
          store.delete(from);
          store.set(to, f);
          removed.add(from);
          removed.delete(to);
        });
      },
      copyFile: () => Effect.void,
      fsyncPath: () => Effect.void,
      parentDirExists: () => Effect.succeed(true),
    });
    const clockLayer = Layer.succeed(Clock, {
      nowMs: () => Effect.succeed(NOW),
    });
    return {
      layer: Layer.mergeAll(gitLayer, fsLayer, clockLayer, probe.layer),
      probe,
      removed,
      store,
    };
  }

  it("completes exact batch deletion with closed receipt", () => {
    const { layer, probe, store } = authLayers({});
    const result = Effect.runSync(
      deleteTracked({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-9998" },
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Completed");
    if (result._tag === "Completed") {
      assert.equal(result.actionKind, "tracked_delete");
      assert.equal(result.recoveryCommitSha, P);
      assert.equal(result.targets.length, 2);
      assert.equal(result.targets[0]?.path, "pkg/a.txt");
      assert.ok(!JSON.stringify(result).includes("/repo"));
    }
    assert.equal(store.has("/repo/pkg/a.txt"), false);
    assert.equal(store.has("/repo/pkg/b.txt"), false);
    assert.equal(probe.counts.get("unlink"), 2);
    assert.ok((probe.counts.get("preflight_ok") ?? 0) >= 2);
  });

  it("preflights all targets before any mutation (second fails)", () => {
    const { layer, probe, store } = authLayers({
      head: (path) =>
        path.endsWith("b.txt")
          ? Effect.fail(new PolicyGitError("source_digest_mismatch"))
          : Effect.succeed({
              mode: "100644",
              blobSha1: blob,
              size: content.byteLength,
            }),
    });
    const result = Effect.runSync(
      deleteTracked({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-9998" },
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Denied");
    if (result._tag === "Denied") {
      assert.equal(result.reason, "source_digest_mismatch");
    }
    assert.equal(store.has("/repo/pkg/a.txt"), true);
    assert.equal(probe.counts.get("unlink") ?? 0, 0);
  });

  it("rolls back mid-batch host rename failure via FileSystem seam", () => {
    const { layer, probe, store } = authLayers({
      failRenameAfter: 2,
    });
    const result = Effect.runSync(
      deleteTracked({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-9998" },
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Failed");
    if (result._tag === "Failed") {
      assert.equal(result.reason, "mutation_rejected");
    }
    // First target restored with exact bytes
    assert.equal(store.has("/repo/pkg/a.txt"), true);
    assert.equal(store.has("/repo/pkg/b.txt"), true);
    const a = store.get("/repo/pkg/a.txt")!;
    assert.equal(gitBlobSha1(a.bytes), blob);
    assert.ok((probe.counts.get("restore") ?? 0) >= 1);
  });

  it("rolls back on defect after partial quarantine", () => {
    const { layer, store } = authLayers({
      dieRenameAfter: 2,
    });
    const result = Effect.runSync(
      deleteTracked({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-9998" },
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Failed");
    assert.equal(store.has("/repo/pkg/a.txt"), true);
    assert.equal(store.has("/repo/pkg/b.txt"), true);
  });

  it("never treats concurrent replacement as successful restore", () => {
    let renames = 0;
    const { layer, probe, store } = authLayers({
      fs: {
        rename: (from, to) =>
          Effect.gen(function* () {
            renames += 1;
            if (renames === 1) {
              // Quarantine first file, then plant a concurrent replacement
              const f = store.get(from);
              if (!f) {
                return yield* Effect.fail(new PolicyFsError("mutation_rejected"));
              }
              store.delete(from);
              store.set(to, f);
              // Concurrent replacement at original path
              store.set(from, {
                bytes: new TextEncoder().encode("EVIL"),
                mode: 0o100644,
                ino: "evil",
              });
              return;
            }
            return yield* Effect.fail(new PolicyFsError("mutation_rejected"));
          }),
      },
    });
    const result = Effect.runSync(
      deleteTracked({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-9998" },
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Failed");
    // Evil replacement must remain; original must not be overwritten
    const a = store.get("/repo/pkg/a.txt");
    assert.ok(a);
    assert.equal(new TextDecoder().decode(a!.bytes), "EVIL");
    assert.ok((probe.counts.get("restore_retained") ?? 0) >= 1);
  });

  it("denies symlink, hardlink, wrong mode, wrong size, working tree mismatch", () => {
    const cases: Array<{
      name: string;
      fs?: Parameters<typeof authLayers>[0]["fs"];
      head?: Parameters<typeof authLayers>[0]["head"];
      reason: string;
    }> = [
      {
        name: "symlink",
        fs: {
          readFileNoFollow: () =>
            Effect.fail(new PolicyFsError("source_is_symlink")),
        },
        reason: "source_is_symlink",
      },
      {
        name: "hardlink",
        fs: {
          readFileNoFollow: () =>
            Effect.succeed({
              bytes: content,
              stat: fileStat({ size: content.byteLength, nlink: 2 }),
            }),
        },
        reason: "source_is_hardlink",
      },
      {
        name: "mode",
        head: () =>
          Effect.succeed({
            mode: "100755",
            blobSha1: blob,
            size: content.byteLength,
          }),
        reason: "mode_mismatch",
      },
      {
        name: "size",
        head: () =>
          Effect.succeed({
            mode: "100644",
            blobSha1: blob,
            size: 99,
          }),
        reason: "source_size_mismatch",
      },
      {
        name: "working tree",
        fs: {
          readFileNoFollow: () =>
            Effect.succeed({
              bytes: new TextEncoder().encode("nope"),
              stat: fileStat({ size: 4, ino: "9" }),
            }),
        },
        reason: "working_tree_mismatch",
      },
      {
        name: "submodule",
        head: () => Effect.fail(new PolicyGitError("target_is_submodule")),
        reason: "target_is_submodule",
      },
    ];
    for (const c of cases) {
      const opts: Parameters<typeof authLayers>[0] = {};
      if (c.fs !== undefined) opts.fs = c.fs;
      if (c.head !== undefined) opts.head = c.head;
      const { layer, probe } = authLayers(opts);
      const result = Effect.runSync(
        deleteTracked({
          repoRoot: "/repo",
          request: { schemaVersion: 1, entryId: "DST-9998" },
        }).pipe(Effect.provide(layer)),
      );
      assert.equal(result._tag, "Denied", c.name);
      if (result._tag === "Denied") {
        assert.equal(result.reason, c.reason, c.name);
      }
      assert.equal(probe.counts.get("unlink") ?? 0, 0, c.name);
    }
  });

  it("denies moving HEAD before mutation", () => {
    let calls = 0;
    const { layer, probe } = authLayers({
      assertHead: () => {
        calls += 1;
        if (calls >= 2) {
          return Effect.fail(new PolicyGitError("authority_dirty"));
        }
        return Effect.void;
      },
    });
    const result = Effect.runSync(
      deleteTracked({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-9998" },
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Denied");
    if (result._tag === "Denied") {
      assert.equal(result.reason, "authority_dirty");
    }
    assert.equal(probe.counts.get("unlink") ?? 0, 0);
  });

  it("denies staged/index change before mutation", () => {
    const { layer, probe } = authLayers({
      assertIndex: () =>
        Effect.fail(new PolicyGitError("working_tree_mismatch")),
    });
    const result = Effect.runSync(
      deleteTracked({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-9998" },
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Denied");
    if (result._tag === "Denied") {
      assert.equal(result.reason, "working_tree_mismatch");
    }
    assert.equal(probe.counts.get("unlink") ?? 0, 0);
  });

  it("denies chmod-only live mode drift", () => {
    const { layer, probe } = authLayers({
      fs: {
        readFileNoFollow: () =>
          Effect.succeed({
            bytes: content,
            // execute bit set while approved is 100644
            stat: fileStat({ size: content.byteLength, mode: 0o100755, ino: "m1" }),
          }),
      },
    });
    const result = Effect.runSync(
      deleteTracked({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-9998" },
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Denied");
    if (result._tag === "Denied") {
      assert.equal(result.reason, "mode_mismatch");
    }
    assert.equal(probe.counts.get("unlink") ?? 0, 0);
  });

  it("denies ancestor symlink on path chain", () => {
    const { layer, probe } = authLayers({
      fs: {
        lstat: (p) => {
          if (p === "/repo/pkg") {
            return Effect.succeed(
              fileStat({
                size: 0,
                isFile: false,
                isDirectory: false,
                isSymbolicLink: true,
                mode: 0o120777,
                ino: "sym",
              }),
            );
          }
          if (p === "/repo") {
            return Effect.succeed(
              fileStat({
                size: 0,
                isFile: false,
                isDirectory: true,
                mode: 0o040755,
                ino: "d1",
              }),
            );
          }
          return Effect.succeed(fileStat({ size: content.byteLength }));
        },
      },
    });
    const result = Effect.runSync(
      deleteTracked({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-9998" },
      }).pipe(Effect.provide(layer)),
    );
    assert.equal(result._tag, "Denied");
    if (result._tag === "Denied") {
      assert.equal(result.reason, "source_is_symlink");
    }
    assert.equal(probe.counts.get("unlink") ?? 0, 0);
  });

  it("closed errors never leak absolute paths", () => {
    const { layer } = authLayers({
      head: () => Effect.fail(new PolicyGitError("target_missing")),
    });
    const result = Effect.runSync(
      deleteTracked({
        repoRoot: "/secret/repo",
        request: { schemaVersion: 1, entryId: "DST-9998" },
      }).pipe(Effect.provide(layer)),
    );
    const text = JSON.stringify(result);
    assert.ok(!text.includes("/secret"));
    assert.ok(!text.includes("Error"));
  });
});

describe("mutation-boundary unsupported_action", () => {
  const content = new TextEncoder().encode("data");
  const blob = gitBlobSha1(content);

  it("deleteTracked denies artifact_relocate-authorized entry with zero mutation", () => {
    const relocateEntry: CurrentEntry = {
      id: "DST-8888",
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
        sha256: sha256Hex("test"),
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
    const seed: CurrentEntry = {
      id: "DST-8888",
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
        sha256: sha256Hex("test"),
      },
    };
    const bytes = mdFor([relocateEntry]);
    const parentBytes = mdFor([seed]);
    const probe = makeMemoryMutationProbe();
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
        Effect.fail(new PolicyGitError("internal_failed")),
      assertHeadCommit: () => Effect.void,
      assertTrackedIndexClean: () => Effect.void,
    });
    const fsLayer = Layer.succeed(FileSystem, {
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
    const clockLayer = Layer.succeed(Clock, {
      nowMs: () => Effect.succeed(NOW),
    });
    const result = Effect.runSync(
      deleteTracked({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-8888" },
      }).pipe(
        Effect.provide(
          Layer.mergeAll(gitLayer, fsLayer, clockLayer, probe.layer),
        ),
      ),
    );
    assert.equal(result._tag, "Denied");
    if (result._tag === "Denied") {
      assert.equal(result.reason, "unsupported_action");
    }
    assert.equal(probe.counts.get("unlink") ?? 0, 0);
    assert.equal(probe.counts.get("unlink_attempt") ?? 0, 0);
  });

  it("relocateArtifact denies tracked_delete-authorized entry with zero mutation", () => {
    const targets: TrackedDeleteTarget[] = [
      {
        path: "pkg/a.txt",
        blobSha1: blob,
        byteLength: content.byteLength,
        mode: "100644",
      },
    ];
    const approved = approvedTracked(targets);
    const seed = seedTracked(targets);
    const bytes = mdFor([approved]);
    const parentBytes = mdFor([seed]);
    const probe = makeMemoryMutationProbe();
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
        Effect.fail(new PolicyGitError("internal_failed")),
      assertHeadCommit: () => Effect.void,
      assertTrackedIndexClean: () => Effect.void,
    });
    const clockLayer = Layer.succeed(Clock, {
      nowMs: () => Effect.succeed(NOW),
    });
    const result = Effect.runSync(
      relocateArtifact({
        repoRoot: "/repo",
        request: { schemaVersion: 1, entryId: "DST-9998" },
      }).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, clockLayer, probe.layer)),
      ),
    );
    assert.equal(result._tag, "Denied");
    if (result._tag === "Denied") {
      assert.equal(result.reason, "unsupported_action");
    }
    assert.equal(probe.counts.get("live_relocate_refused") ?? 0, 0);
  });
});

// --- Live temporary-Git integration ---

function git(repo: string, args: string[]): string {
  const r = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  }
  return (r.stdout || "").trim();
}

function sha40(s: string): string {
  const t = s.trim().toLowerCase();
  assert.match(t, /^[0-9a-f]{40}$/);
  return t;
}

function writeRegisterMd(repo: string, bodyJson: string): void {
  const abs = join(repo, CANONICAL_REGISTER_RELPATH);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    ["# log", "", BEGIN_SENTINEL, bodyJson, END_SENTINEL, ""].join("\n"),
    "utf8",
  );
}

type SeededRepo = {
  readonly tmp: string;
  readonly p: string;
  readonly targets: TrackedDeleteTarget[];
  readonly bodyA: string;
  readonly bodyB: string;
};

function seedTwoFileRepo(opts?: {
  modeA?: "100644" | "100755";
}): SeededRepo {
  const tmp = mkdtempSync(join(tmpdir(), "foreman-td-live-"));
  git(tmp, ["init"]);
  git(tmp, ["config", "user.email", "t@t"]);
  git(tmp, ["config", "user.name", "t"]);
  git(tmp, ["config", "commit.gpgsign", "false"]);
  mkdirSync(join(tmp, "pkg"), { recursive: true });
  const bodyA = "alpha\n";
  const bodyB = "beta!\n";
  writeFileSync(join(tmp, "pkg", "a.txt"), bodyA);
  writeFileSync(join(tmp, "pkg", "b.txt"), bodyB);
  writeFileSync(join(tmp, "pkg", "stay.txt"), "stay\n");
  if (opts?.modeA === "100755") {
    chmodSync(join(tmp, "pkg", "a.txt"), 0o755);
  }
  const blobA = sha40(
    spawnSync("git", ["hash-object", "pkg/a.txt"], {
      cwd: tmp,
      encoding: "utf8",
    }).stdout!.trim(),
  );
  const blobB = sha40(
    spawnSync("git", ["hash-object", "pkg/b.txt"], {
      cwd: tmp,
      encoding: "utf8",
    }).stdout!.trim(),
  );
  const modeA = opts?.modeA ?? "100644";
  const targets: TrackedDeleteTarget[] = [
    {
      path: "pkg/a.txt",
      blobSha1: blobA,
      byteLength: Buffer.byteLength(bodyA),
      mode: modeA,
    },
    {
      path: "pkg/b.txt",
      blobSha1: blobB,
      byteLength: Buffer.byteLength(bodyB),
      mode: "100644",
    },
  ];
  const seedJson = canonicalize({
    currentEntries: [
      {
        actionKind: "tracked_delete",
        evidence: "pending",
        id: "DST-9998",
        owner: "pending",
        recordedAt: "pending",
        recoveryStatus: "pending",
        requiredCondition: "ok",
        state: "blocked",
        targetOrAction: "exact tracked files",
        trackedDelete: { targets },
      },
    ],
    historicalIncidents: [],
    registerId: CANONICAL_REGISTER_ID,
    schemaVersion: 1,
  });
  writeRegisterMd(tmp, seedJson);
  if (modeA === "100755") {
    git(tmp, ["add", "pkg/a.txt"]);
    // ensure index records executable
    spawnSync("git", ["update-index", "--chmod=+x", "pkg/a.txt"], {
      cwd: tmp,
    });
  }
  git(tmp, [
    "add",
    "pkg/a.txt",
    "pkg/b.txt",
    "pkg/stay.txt",
    CANONICAL_REGISTER_RELPATH,
  ]);
  git(tmp, ["commit", "-m", "P"]);
  const p = sha40(git(tmp, ["rev-parse", "HEAD"]));
  const pt = sha40(git(tmp, ["rev-parse", "HEAD^{tree}"]));
  const approvedJson = canonicalize({
    currentEntries: [
      {
        actionKind: "tracked_delete",
        approval: {
          actionKind: "tracked_delete",
          approvedAt: "2020-01-01T00:00:00Z",
          approver: "Release architect",
          candidateCommitSha: p,
          candidateTreeSha: pt,
          evidence: "review",
          expiresAt: "2099-01-01T00:00:00Z",
        },
        evidence: "complete",
        id: "DST-9998",
        owner: "architect",
        recordedAt: "2020-01-01T00:00:00Z",
        recoveryStatus: "recovery_ready",
        requiredCondition: "ok",
        state: "approved",
        targetOrAction: "exact tracked files",
        trackedDelete: { targets },
      },
    ],
    historicalIncidents: [],
    registerId: CANONICAL_REGISTER_ID,
    schemaVersion: 1,
  });
  writeRegisterMd(tmp, approvedJson);
  git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
  git(tmp, ["commit", "-m", "C"]);
  return { tmp, p, targets, bodyA, bodyB };
}

describe("deleteTracked live git integration", () => {
  it("live: completes deletion via Effect.runPromise", async () => {
    const { tmp, p } = seedTwoFileRepo();
    try {
      const { liveServices } = await import("./live-services.js");
      const result = await Effect.runPromise(
        deleteTracked({
          repoRoot: tmp,
          request: { schemaVersion: 1, entryId: "DST-9998" },
        }).pipe(Effect.provide(liveServices)),
      );
      assert.equal(result._tag, "Completed", JSON.stringify(result));
      if (result._tag === "Completed") {
        assert.equal(result.recoveryCommitSha, p);
        assert.equal(result.targets.length, 2);
      }
      assert.equal(existsSync(join(tmp, "pkg", "a.txt")), false);
      assert.equal(existsSync(join(tmp, "pkg", "b.txt")), false);
      assert.equal(existsSync(join(tmp, "pkg", "stay.txt")), true);
      assert.equal(existsSync(join(tmp, "pkg")), true);
      assert.equal(readFileSync(join(tmp, "pkg", "stay.txt"), "utf8"), "stay\n");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("live: second-target quarantine failure restores first with exact bytes and mode", async () => {
    const { tmp, bodyA } = seedTwoFileRepo();
    try {
      const { liveGitIdentity } = await import("./live-services.js");
      const { FileSystem: FS, liveClock, noopMutationProbe } = await import(
        "./services.js"
      );
      // Real host FS seam with fail-on-2nd-rename (no MutationProbe control).
      let renames = 0;
      const {
        closeSync,
        constants: fsConstants,
        existsSync: ex,
        fchmodSync,
        fstatSync,
        fsyncSync,
        lstatSync: lst,
        openSync,
        readSync,
        renameSync,
        statSync: st,
        unlinkSync,
        writeSync,
      } = await import("node:fs");
      const { dirname: dn } = await import("node:path");

      function toStat(s: {
        isFile: () => boolean;
        isDirectory: () => boolean;
        isSymbolicLink: () => boolean;
        size: number | bigint;
        nlink: number | bigint;
        mode: number | bigint;
        dev: number | bigint;
        ino: number | bigint;
      }): FileStat {
        return {
          isFile: s.isFile(),
          isDirectory: s.isDirectory(),
          isSymbolicLink: s.isSymbolicLink(),
          size: Number(s.size),
          nlink: Number(s.nlink),
          mode: Number(s.mode),
          dev: String(s.dev),
          ino: String(s.ino),
        };
      }

      const wrappingFs = Layer.succeed(FS, {
        readFile: (path, maxBytes) =>
          Effect.try({
            try: () => {
              const fd = openSync(path, fsConstants.O_RDONLY);
              try {
                const cap = maxBytes + 1;
                const buf = Buffer.allocUnsafe(cap);
                let offset = 0;
                while (offset < cap) {
                  const n = readSync(fd, buf, offset, cap - offset, offset);
                  if (n === 0) break;
                  offset += n;
                }
                if (offset > maxBytes) throw new PolicyFsError("oversize_input");
                return new Uint8Array(buf.buffer, buf.byteOffset, offset);
              } finally {
                closeSync(fd);
              }
            },
            catch: (e) =>
              e instanceof PolicyFsError
                ? e
                : new PolicyFsError("internal_failed"),
          }),
        readFileNoFollow: (path, maxBytes) =>
          Effect.try({
            try: () => {
              const fd = openSync(
                path,
                fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
              );
              try {
                const stv = toStat(fstatSync(fd));
                if (!stv.isFile) throw new PolicyFsError("source_not_regular_file");
                const cap = maxBytes + 1;
                const buf = Buffer.allocUnsafe(cap);
                let offset = 0;
                while (offset < cap) {
                  const n = readSync(fd, buf, offset, cap - offset, offset);
                  if (n === 0) break;
                  offset += n;
                }
                if (offset > maxBytes) throw new PolicyFsError("oversize_input");
                return {
                  bytes: new Uint8Array(buf.buffer, buf.byteOffset, offset),
                  stat: { ...stv, size: offset },
                };
              } finally {
                closeSync(fd);
              }
            },
            catch: (e) =>
              e instanceof PolicyFsError
                ? e
                : new PolicyFsError("internal_failed"),
          }),
        writeExclusive: () => Effect.fail(new PolicyFsError("mutation_rejected")),
        createFile: (path, data, mode) =>
          Effect.try({
            try: () => {
              const fd = openSync(
                path,
                fsConstants.O_WRONLY |
                  fsConstants.O_CREAT |
                  fsConstants.O_EXCL,
                mode,
              );
              try {
                let offset = 0;
                while (offset < data.byteLength) {
                  offset += writeSync(
                    fd,
                    data,
                    offset,
                    data.byteLength - offset,
                    offset,
                  );
                }
                fchmodSync(fd, mode);
                fsyncSync(fd);
              } finally {
                closeSync(fd);
              }
            },
            catch: () => new PolicyFsError("mutation_rejected"),
          }),
        lstat: (path) =>
          Effect.try({
            try: () => toStat(lst(path)),
            catch: () => new PolicyFsError("target_missing"),
          }),
        stat: (path) =>
          Effect.try({
            try: () => toStat(st(path)),
            catch: () => new PolicyFsError("internal_failed"),
          }),
        exists: (path) => Effect.sync(() => ex(path)),
        unlink: (path) =>
          Effect.try({
            try: () => unlinkSync(path),
            catch: () => new PolicyFsError("mutation_rejected"),
          }),
        rename: (from, to) =>
          Effect.try({
            try: () => {
              renames += 1;
              if (renames >= 2) {
                throw new PolicyFsError("mutation_rejected");
              }
              renameSync(from, to);
            },
            catch: (e) =>
              e instanceof PolicyFsError
                ? e
                : new PolicyFsError("mutation_rejected"),
          }),
        copyFile: () => Effect.fail(new PolicyFsError("mutation_rejected")),
        fsyncPath: () => Effect.void,
        parentDirExists: (path) =>
          Effect.sync(() => {
            try {
              return st(dn(path)).isDirectory();
            } catch {
              return false;
            }
          }),
      });

      const layer = Layer.mergeAll(
        wrappingFs,
        liveGitIdentity,
        liveClock,
        noopMutationProbe,
      );
      const result = await Effect.runPromise(
        deleteTracked({
          repoRoot: tmp,
          request: { schemaVersion: 1, entryId: "DST-9998" },
        }).pipe(Effect.provide(layer)),
      );
      assert.equal(result._tag, "Failed", JSON.stringify(result));
      assert.equal(existsSync(join(tmp, "pkg", "a.txt")), true);
      assert.equal(existsSync(join(tmp, "pkg", "b.txt")), true);
      assert.equal(readFileSync(join(tmp, "pkg", "a.txt"), "utf8"), bodyA);
      const mode = lstatSync(join(tmp, "pkg", "a.txt")).mode & 0o777;
      assert.equal(mode, 0o644);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("live: restrictive umask still restores exact mode 100755", async () => {
    const { tmp, bodyA } = seedTwoFileRepo({ modeA: "100755" });
    const prev = process.umask(0o077);
    try {
      const { liveGitIdentity } = await import("./live-services.js");
      const { FileSystem: FS, liveClock, noopMutationProbe } = await import(
        "./services.js"
      );
      let renames = 0;
      const {
        closeSync,
        constants: fsConstants,
        existsSync: ex,
        fchmodSync,
        fstatSync,
        fsyncSync,
        lstatSync: lst,
        openSync,
        readSync,
        renameSync,
        statSync: st,
        unlinkSync,
        writeSync,
      } = await import("node:fs");
      const { dirname: dn } = await import("node:path");
      function toStat(s: {
        isFile: () => boolean;
        isDirectory: () => boolean;
        isSymbolicLink: () => boolean;
        size: number | bigint;
        nlink: number | bigint;
        mode: number | bigint;
        dev: number | bigint;
        ino: number | bigint;
      }): FileStat {
        return {
          isFile: s.isFile(),
          isDirectory: s.isDirectory(),
          isSymbolicLink: s.isSymbolicLink(),
          size: Number(s.size),
          nlink: Number(s.nlink),
          mode: Number(s.mode),
          dev: String(s.dev),
          ino: String(s.ino),
        };
      }
      const wrappingFs = Layer.succeed(FS, {
        readFile: (path, maxBytes) =>
          Effect.try({
            try: () => {
              const fd = openSync(path, fsConstants.O_RDONLY);
              try {
                const cap = maxBytes + 1;
                const buf = Buffer.allocUnsafe(cap);
                let offset = 0;
                while (offset < cap) {
                  const n = readSync(fd, buf, offset, cap - offset, offset);
                  if (n === 0) break;
                  offset += n;
                }
                if (offset > maxBytes) throw new PolicyFsError("oversize_input");
                return new Uint8Array(buf.buffer, buf.byteOffset, offset);
              } finally {
                closeSync(fd);
              }
            },
            catch: (e) =>
              e instanceof PolicyFsError
                ? e
                : new PolicyFsError("internal_failed"),
          }),
        readFileNoFollow: (path, maxBytes) =>
          Effect.try({
            try: () => {
              const fd = openSync(
                path,
                fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
              );
              try {
                const stv = toStat(fstatSync(fd));
                if (!stv.isFile) throw new PolicyFsError("source_not_regular_file");
                const cap = maxBytes + 1;
                const buf = Buffer.allocUnsafe(cap);
                let offset = 0;
                while (offset < cap) {
                  const n = readSync(fd, buf, offset, cap - offset, offset);
                  if (n === 0) break;
                  offset += n;
                }
                if (offset > maxBytes) throw new PolicyFsError("oversize_input");
                return {
                  bytes: new Uint8Array(buf.buffer, buf.byteOffset, offset),
                  stat: { ...stv, size: offset },
                };
              } finally {
                closeSync(fd);
              }
            },
            catch: (e) =>
              e instanceof PolicyFsError
                ? e
                : new PolicyFsError("internal_failed"),
          }),
        writeExclusive: () => Effect.fail(new PolicyFsError("mutation_rejected")),
        createFile: (path, data, mode) =>
          Effect.try({
            try: () => {
              const fd = openSync(
                path,
                fsConstants.O_WRONLY |
                  fsConstants.O_CREAT |
                  fsConstants.O_EXCL,
                mode,
              );
              try {
                let offset = 0;
                while (offset < data.byteLength) {
                  offset += writeSync(
                    fd,
                    data,
                    offset,
                    data.byteLength - offset,
                    offset,
                  );
                }
                fchmodSync(fd, mode);
                fsyncSync(fd);
              } finally {
                closeSync(fd);
              }
            },
            catch: () => new PolicyFsError("mutation_rejected"),
          }),
        lstat: (path) =>
          Effect.try({
            try: () => toStat(lst(path)),
            catch: () => new PolicyFsError("target_missing"),
          }),
        stat: (path) =>
          Effect.try({
            try: () => toStat(st(path)),
            catch: () => new PolicyFsError("internal_failed"),
          }),
        exists: (path) => Effect.sync(() => ex(path)),
        unlink: (path) =>
          Effect.try({
            try: () => unlinkSync(path),
            catch: () => new PolicyFsError("mutation_rejected"),
          }),
        rename: (from, to) =>
          Effect.try({
            try: () => {
              renames += 1;
              if (renames >= 2) throw new PolicyFsError("mutation_rejected");
              renameSync(from, to);
            },
            catch: (e) =>
              e instanceof PolicyFsError
                ? e
                : new PolicyFsError("mutation_rejected"),
          }),
        copyFile: () => Effect.fail(new PolicyFsError("mutation_rejected")),
        fsyncPath: () => Effect.void,
        parentDirExists: (path) =>
          Effect.sync(() => {
            try {
              return st(dn(path)).isDirectory();
            } catch {
              return false;
            }
          }),
      });
      const result = await Effect.runPromise(
        deleteTracked({
          repoRoot: tmp,
          request: { schemaVersion: 1, entryId: "DST-9998" },
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              wrappingFs,
              liveGitIdentity,
              liveClock,
              noopMutationProbe,
            ),
          ),
        ),
      );
      assert.equal(result._tag, "Failed", JSON.stringify(result));
      assert.equal(readFileSync(join(tmp, "pkg", "a.txt"), "utf8"), bodyA);
      const mode = lstatSync(join(tmp, "pkg", "a.txt")).mode & 0o777;
      assert.equal(mode, 0o755);
    } finally {
      process.umask(prev);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("live: denies moving HEAD without mutation", async () => {
    const { tmp } = seedTwoFileRepo();
    try {
      // Move HEAD to a new commit after approval C
      writeFileSync(join(tmp, "pkg", "stay.txt"), "stay2\n");
      git(tmp, ["add", "pkg/stay.txt"]);
      git(tmp, ["commit", "-m", "move-head"]);
      const { liveServices } = await import("./live-services.js");
      const result = await Effect.runPromise(
        deleteTracked({
          repoRoot: tmp,
          request: { schemaVersion: 1, entryId: "DST-9998" },
        }).pipe(Effect.provide(liveServices)),
      );
      // Authority load may fail (register dirty) or head pin fails
      assert.ok(result._tag === "Denied" || result._tag === "Failed");
      assert.equal(existsSync(join(tmp, "pkg", "a.txt")), true);
      assert.equal(existsSync(join(tmp, "pkg", "b.txt")), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("live: denies staged target change without mutation", async () => {
    const { tmp } = seedTwoFileRepo();
    try {
      writeFileSync(join(tmp, "pkg", "a.txt"), "staged!\n");
      git(tmp, ["add", "pkg/a.txt"]);
      const { liveServices } = await import("./live-services.js");
      const result = await Effect.runPromise(
        deleteTracked({
          repoRoot: tmp,
          request: { schemaVersion: 1, entryId: "DST-9998" },
        }).pipe(Effect.provide(liveServices)),
      );
      assert.equal(result._tag, "Denied");
      assert.equal(existsSync(join(tmp, "pkg", "a.txt")), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("live: denies chmod-only change without mutation", async () => {
    const { tmp } = seedTwoFileRepo();
    try {
      chmodSync(join(tmp, "pkg", "a.txt"), 0o755);
      const { liveServices } = await import("./live-services.js");
      const result = await Effect.runPromise(
        deleteTracked({
          repoRoot: tmp,
          request: { schemaVersion: 1, entryId: "DST-9998" },
        }).pipe(Effect.provide(liveServices)),
      );
      assert.equal(result._tag, "Denied");
      if (result._tag === "Denied") {
        assert.ok(
          result.reason === "mode_mismatch" ||
            result.reason === "working_tree_mismatch",
          result.reason,
        );
      }
      assert.equal(existsSync(join(tmp, "pkg", "a.txt")), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("live: denies ancestor symlink without mutation", async () => {
    const { tmp } = seedTwoFileRepo();
    try {
      // Replace pkg with a symlink to /tmp (after C is committed)
      rmSync(join(tmp, "pkg"), { recursive: true, force: true });
      const outside = mkdtempSync(join(tmpdir(), "foreman-td-out-"));
      writeFileSync(join(outside, "a.txt"), "alpha\n");
      writeFileSync(join(outside, "b.txt"), "beta!\n");
      writeFileSync(join(outside, "stay.txt"), "stay\n");
      symlinkSync(outside, join(tmp, "pkg"));
      const { liveServices } = await import("./live-services.js");
      const result = await Effect.runPromise(
        deleteTracked({
          repoRoot: tmp,
          request: { schemaVersion: 1, entryId: "DST-9998" },
        }).pipe(Effect.provide(liveServices)),
      );
      assert.equal(result._tag, "Denied");
      if (result._tag === "Denied") {
        assert.equal(result.reason, "source_is_symlink");
      }
      // Outside files must remain
      assert.equal(existsSync(join(outside, "a.txt")), true);
      rmSync(outside, { recursive: true, force: true });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("live: denies untracked and dirty working tree without mutation", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "foreman-td-untracked-"));
    try {
      git(tmp, ["init"]);
      git(tmp, ["config", "user.email", "t@t"]);
      git(tmp, ["config", "user.name", "t"]);
      git(tmp, ["config", "commit.gpgsign", "false"]);
      mkdirSync(join(tmp, "pkg"), { recursive: true });
      writeFileSync(join(tmp, "pkg", "a.txt"), "x\n");
      const blobA = sha40(
        spawnSync("git", ["hash-object", "pkg/a.txt"], {
          cwd: tmp,
          encoding: "utf8",
        }).stdout!.trim(),
      );
      const targets: TrackedDeleteTarget[] = [
        {
          path: "pkg/a.txt",
          blobSha1: blobA,
          byteLength: 2,
          mode: "100644",
        },
      ];
      const seedJson = canonicalize({
        currentEntries: [
          {
            actionKind: "tracked_delete",
            evidence: "pending",
            id: "DST-9998",
            owner: "pending",
            recordedAt: "pending",
            recoveryStatus: "pending",
            requiredCondition: "ok",
            state: "blocked",
            targetOrAction: "x",
            trackedDelete: { targets },
          },
        ],
        historicalIncidents: [],
        registerId: CANONICAL_REGISTER_ID,
        schemaVersion: 1,
      });
      writeRegisterMd(tmp, seedJson);
      git(tmp, ["add", "pkg/a.txt", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "P"]);
      const p = sha40(git(tmp, ["rev-parse", "HEAD"]));
      const pt = sha40(git(tmp, ["rev-parse", "HEAD^{tree}"]));
      const approvedJson = canonicalize({
        currentEntries: [
          {
            actionKind: "tracked_delete",
            approval: {
              actionKind: "tracked_delete",
              approvedAt: "2020-01-01T00:00:00Z",
              approver: "Release architect",
              candidateCommitSha: p,
              candidateTreeSha: pt,
              evidence: "review",
              expiresAt: "2099-01-01T00:00:00Z",
            },
            evidence: "complete",
            id: "DST-9998",
            owner: "architect",
            recordedAt: "2020-01-01T00:00:00Z",
            recoveryStatus: "recovery_ready",
            requiredCondition: "ok",
            state: "approved",
            targetOrAction: "x",
            trackedDelete: { targets },
          },
        ],
        historicalIncidents: [],
        registerId: CANONICAL_REGISTER_ID,
        schemaVersion: 1,
      });
      writeRegisterMd(tmp, approvedJson);
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "C"]);
      writeFileSync(join(tmp, "pkg", "a.txt"), "y\n");
      const { liveServices } = await import("./live-services.js");
      const result = await Effect.runPromise(
        deleteTracked({
          repoRoot: tmp,
          request: { schemaVersion: 1, entryId: "DST-9998" },
        }).pipe(Effect.provide(liveServices)),
      );
      assert.equal(result._tag, "Denied");
      if (result._tag === "Denied") {
        assert.ok(
          result.reason === "working_tree_mismatch" ||
            result.reason === "source_digest_mismatch",
          result.reason,
        );
      }
      assert.equal(existsSync(join(tmp, "pkg", "a.txt")), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("live: denies hardlink without mutation", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "foreman-td-hl-"));
    try {
      git(tmp, ["init"]);
      git(tmp, ["config", "user.email", "t@t"]);
      git(tmp, ["config", "user.name", "t"]);
      git(tmp, ["config", "commit.gpgsign", "false"]);
      mkdirSync(join(tmp, "pkg"), { recursive: true });
      writeFileSync(join(tmp, "pkg", "a.txt"), "x\n");
      linkSync(join(tmp, "pkg", "a.txt"), join(tmp, "pkg", "alink.txt"));
      const blobA = sha40(
        spawnSync("git", ["hash-object", "pkg/a.txt"], {
          cwd: tmp,
          encoding: "utf8",
        }).stdout!.trim(),
      );
      const targets: TrackedDeleteTarget[] = [
        {
          path: "pkg/a.txt",
          blobSha1: blobA,
          byteLength: 2,
          mode: "100644",
        },
      ];
      const seedJson = canonicalize({
        currentEntries: [
          {
            actionKind: "tracked_delete",
            evidence: "pending",
            id: "DST-9998",
            owner: "pending",
            recordedAt: "pending",
            recoveryStatus: "pending",
            requiredCondition: "ok",
            state: "blocked",
            targetOrAction: "x",
            trackedDelete: { targets },
          },
        ],
        historicalIncidents: [],
        registerId: CANONICAL_REGISTER_ID,
        schemaVersion: 1,
      });
      writeRegisterMd(tmp, seedJson);
      git(tmp, ["add", "pkg/a.txt", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "P"]);
      const p = sha40(git(tmp, ["rev-parse", "HEAD"]));
      const pt = sha40(git(tmp, ["rev-parse", "HEAD^{tree}"]));
      const approvedJson = canonicalize({
        currentEntries: [
          {
            actionKind: "tracked_delete",
            approval: {
              actionKind: "tracked_delete",
              approvedAt: "2020-01-01T00:00:00Z",
              approver: "Release architect",
              candidateCommitSha: p,
              candidateTreeSha: pt,
              evidence: "review",
              expiresAt: "2099-01-01T00:00:00Z",
            },
            evidence: "complete",
            id: "DST-9998",
            owner: "architect",
            recordedAt: "2020-01-01T00:00:00Z",
            recoveryStatus: "recovery_ready",
            requiredCondition: "ok",
            state: "approved",
            targetOrAction: "x",
            trackedDelete: { targets },
          },
        ],
        historicalIncidents: [],
        registerId: CANONICAL_REGISTER_ID,
        schemaVersion: 1,
      });
      writeRegisterMd(tmp, approvedJson);
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "C"]);
      const { liveServices } = await import("./live-services.js");
      const result = await Effect.runPromise(
        deleteTracked({
          repoRoot: tmp,
          request: { schemaVersion: 1, entryId: "DST-9998" },
        }).pipe(Effect.provide(liveServices)),
      );
      assert.equal(result._tag, "Denied");
      if (result._tag === "Denied") {
        assert.equal(result.reason, "source_is_hardlink");
      }
      assert.equal(existsSync(join(tmp, "pkg", "a.txt")), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("live: denies symlink without mutation", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "foreman-td-sym-"));
    try {
      git(tmp, ["init"]);
      git(tmp, ["config", "user.email", "t@t"]);
      git(tmp, ["config", "user.name", "t"]);
      git(tmp, ["config", "commit.gpgsign", "false"]);
      mkdirSync(join(tmp, "pkg"), { recursive: true });
      writeFileSync(join(tmp, "pkg", "real.txt"), "x\n");
      symlinkSync("real.txt", join(tmp, "pkg", "a.txt"));
      git(tmp, ["add", "pkg/real.txt", "pkg/a.txt"]);
      const ls = git(tmp, ["ls-files", "-s", "--", "pkg/a.txt"]);
      assert.ok(ls.startsWith("120000"), ls);
      const parts = ls.split(/\s+/);
      const symBlob = sha40(parts[1]!);
      const targets: TrackedDeleteTarget[] = [
        {
          path: "pkg/a.txt",
          blobSha1: symBlob,
          byteLength: Buffer.byteLength("real.txt"),
          mode: "100644",
        },
      ];
      const seedJson = canonicalize({
        currentEntries: [
          {
            actionKind: "tracked_delete",
            evidence: "pending",
            id: "DST-9998",
            owner: "pending",
            recordedAt: "pending",
            recoveryStatus: "pending",
            requiredCondition: "ok",
            state: "blocked",
            targetOrAction: "x",
            trackedDelete: { targets },
          },
        ],
        historicalIncidents: [],
        registerId: CANONICAL_REGISTER_ID,
        schemaVersion: 1,
      });
      writeRegisterMd(tmp, seedJson);
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "P"]);
      const p = sha40(git(tmp, ["rev-parse", "HEAD"]));
      const pt = sha40(git(tmp, ["rev-parse", "HEAD^{tree}"]));
      const approvedJson = canonicalize({
        currentEntries: [
          {
            actionKind: "tracked_delete",
            approval: {
              actionKind: "tracked_delete",
              approvedAt: "2020-01-01T00:00:00Z",
              approver: "Release architect",
              candidateCommitSha: p,
              candidateTreeSha: pt,
              evidence: "review",
              expiresAt: "2099-01-01T00:00:00Z",
            },
            evidence: "complete",
            id: "DST-9998",
            owner: "architect",
            recordedAt: "2020-01-01T00:00:00Z",
            recoveryStatus: "recovery_ready",
            requiredCondition: "ok",
            state: "approved",
            targetOrAction: "x",
            trackedDelete: { targets },
          },
        ],
        historicalIncidents: [],
        registerId: CANONICAL_REGISTER_ID,
        schemaVersion: 1,
      });
      writeRegisterMd(tmp, approvedJson);
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "C"]);
      const { liveServices } = await import("./live-services.js");
      const result = await Effect.runPromise(
        deleteTracked({
          repoRoot: tmp,
          request: { schemaVersion: 1, entryId: "DST-9998" },
        }).pipe(Effect.provide(liveServices)),
      );
      assert.equal(result._tag, "Denied");
      if (result._tag === "Denied") {
        assert.ok(
          result.reason === "source_is_symlink" ||
            result.reason === "mode_mismatch",
          result.reason,
        );
      }
      assert.equal(existsSync(join(tmp, "pkg", "a.txt")), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("compiled runtime: delete-tracked without repository node_modules", async () => {
    const { tmp, p } = seedTwoFileRepo();
    const copyRoot = mkdtempSync(join(tmpdir(), "foreman-td-rt-"));
    try {
      // Ensure bundle exists
      const bundleSrc = join(
        process.cwd(),
        "skills/foreman/runtime/dist/destruction-guard.js",
      );
      assert.ok(existsSync(bundleSrc), "destruction-guard bundle missing");
      const rt = join(copyRoot, "runtime");
      mkdirSync(join(rt, "dist"), { recursive: true });
      cpSync(bundleSrc, join(rt, "dist", "destruction-guard.js"));
      const stdin = canonicalize({
        schemaVersion: 1,
        entryId: "DST-9998",
      });
      const r = spawnSync(
        process.execPath,
        [
          join(rt, "dist", "destruction-guard.js"),
          "delete-tracked",
          "--repo-root",
          tmp,
        ],
        {
          cwd: copyRoot,
          input: stdin,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            // No NODE_PATH into repository node_modules
            HOME: copyRoot,
          },
        },
      );
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const line = (r.stdout || "").trim().split("\n").pop()!;
      const parsed = JSON.parse(line) as {
        _tag: string;
        actionKind?: string;
        recoveryCommitSha?: string;
      };
      assert.equal(parsed._tag, "Completed");
      assert.equal(parsed.actionKind, "tracked_delete");
      assert.equal(parsed.recoveryCommitSha, p);
      assert.ok(!line.includes(tmp));
      assert.equal(existsSync(join(tmp, "pkg", "a.txt")), false);
      assert.equal(existsSync(join(tmp, "pkg", "b.txt")), false);
      assert.equal(existsSync(join(tmp, "pkg", "stay.txt")), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(copyRoot, { recursive: true, force: true });
    }
  });
});
