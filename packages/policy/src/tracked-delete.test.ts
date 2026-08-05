import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  existsSync,
  linkSync,
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
import { canonicalize } from "@foreman/core";
import { admitCheck, validateTrackedRelPath } from "./admit.js";
import { validateApprovalDelta } from "./approval-delta.js";
import { BEGIN_SENTINEL, END_SENTINEL } from "./register.js";
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

describe("validateTrackedRelPath", () => {
  it("accepts canonical relative paths", () => {
    assert.equal(validateTrackedRelPath("docs/a.md"), null);
    assert.equal(validateTrackedRelPath("a"), null);
  });

  it("rejects absolute, traversal, dot, empty, .git, register, glob, group", () => {
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
        // Parent blob unused: unsupported action is denied before delta parse
        parentBlobBytes: new Uint8Array(0),
      },
    );
    assert.equal((r as { reason: string }).reason, "unsupported_action");
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

function fileStat(partial: Partial<FileStat> & { size: number }): FileStat {
  return {
    isFile: partial.isFile ?? true,
    isDirectory: partial.isDirectory ?? false,
    isSymbolicLink: partial.isSymbolicLink ?? false,
    size: partial.size,
    nlink: partial.nlink ?? 1,
  };
}

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
    head?: (path: string) => Effect.Effect<HeadTrackedBlob, PolicyGitError>;
    fs?: Partial<{
      lstat: (p: string) => Effect.Effect<FileStat, PolicyFsError>;
      readFile: (
        p: string,
        max: number,
      ) => Effect.Effect<Uint8Array, PolicyFsError>;
      exists: (p: string) => Effect.Effect<boolean>;
      unlink: (p: string) => Effect.Effect<void, PolicyFsError>;
      createFile: (
        p: string,
        d: Uint8Array,
        m: number,
      ) => Effect.Effect<void, PolicyFsError>;
    }>;
    injectFailAfter?: number;
  }) {
    const seed = seedTracked(targets);
    const approved = approvedTracked(targets);
    const bytes = mdFor([approved]);
    const parentBytes = mdFor([seed]);
    const probe = makeMemoryMutationProbe();
    if (opts.injectFailAfter !== undefined) {
      probe.counts.set("inject_fail_after", opts.injectFailAfter);
    }
    const removed = new Set<string>();
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
      inspectTrackedAtHead: (repo, path) =>
        opts.head
          ? opts.head(path)
          : Effect.succeed({
              mode: "100644",
              blobSha1: blob,
              size: content.byteLength,
            }),
    });
    const fsLayer = Layer.succeed(FileSystem, {
      readFile: (p, max) =>
        opts.fs?.readFile
          ? opts.fs.readFile(p, max)
          : Effect.succeed(content),
      writeExclusive: () => Effect.void,
      createFile: (p, d, m) =>
        opts.fs?.createFile
          ? opts.fs.createFile(p, d, m)
          : Effect.sync(() => {
              removed.delete(p);
            }),
      lstat: (p) =>
        opts.fs?.lstat
          ? opts.fs.lstat(p)
          : Effect.succeed(fileStat({ size: content.byteLength })),
      stat: (p) =>
        opts.fs?.lstat
          ? opts.fs.lstat(p)
          : Effect.succeed(fileStat({ size: content.byteLength })),
      exists: (p) =>
        opts.fs?.exists
          ? opts.fs.exists(p)
          : Effect.sync(() => !removed.has(p)),
      unlink: (p) =>
        opts.fs?.unlink
          ? opts.fs.unlink(p)
          : Effect.sync(() => {
              removed.add(p);
            }),
      rename: () => Effect.void,
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
    };
  }

  it("completes exact batch deletion with closed receipt", () => {
    const { layer, probe, removed } = authLayers({});
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
    assert.equal(removed.size, 2);
    assert.equal(probe.counts.get("unlink"), 2);
    assert.ok((probe.counts.get("preflight_ok") ?? 0) >= 2);
  });

  it("preflights all targets before any mutation (second fails)", () => {
    const { layer, probe, removed } = authLayers({
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
    assert.equal(removed.size, 0);
    assert.equal(probe.counts.get("unlink") ?? 0, 0);
  });

  it("rolls back mid-batch injected failure", () => {
    const restored: string[] = [];
    const { layer, probe } = authLayers({
      injectFailAfter: 2,
      fs: {
        createFile: (p) =>
          Effect.sync(() => {
            restored.push(p);
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
    if (result._tag === "Failed") {
      assert.equal(result.reason, "mutation_rejected");
    }
    assert.equal(probe.counts.get("inject_fail_fired"), 1);
    assert.equal(probe.counts.get("restore"), 1);
    assert.equal(restored.length, 1);
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
          lstat: () =>
            Effect.succeed(
              fileStat({
                size: content.byteLength,
                isSymbolicLink: true,
                isFile: false,
              }),
            ),
        },
        reason: "source_is_symlink",
      },
      {
        name: "hardlink",
        fs: {
          lstat: () =>
            Effect.succeed(
              fileStat({ size: content.byteLength, nlink: 2 }),
            ),
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
          readFile: () => Effect.succeed(new TextEncoder().encode("nope")),
          lstat: () =>
            Effect.succeed(fileStat({ size: 4 })),
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

describe("deleteTracked live git integration", () => {
  it("live: completes deletion via Effect.runPromise", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "foreman-td-live-"));
    try {
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
      const targets: TrackedDeleteTarget[] = [
        {
          path: "pkg/a.txt",
          blobSha1: blobA,
          byteLength: Buffer.byteLength(bodyA),
          mode: "100644",
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
        {
          path: "pkg/ghost.txt",
          blobSha1: "e".repeat(40),
          byteLength: 1,
          mode: "100644",
        },
      ];
      // Only a.txt tracked; ghost untracked/missing in seed identity wrongly
      // For untracked test: both claimed but ghost never added
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
            trackedDelete: { targets: [targets[0]!] },
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
            trackedDelete: { targets: [targets[0]!] },
          },
        ],
        historicalIncidents: [],
        registerId: CANONICAL_REGISTER_ID,
        schemaVersion: 1,
      });
      writeRegisterMd(tmp, approvedJson);
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "C"]);
      // Same byte length, different content → working_tree_mismatch
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
        assert.equal(result.reason, "working_tree_mismatch");
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
      // Do not add hardlink twin as tracked path we delete; only a.txt
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
      // ls-files -s: <mode> <sha> <stage>\t<path>
      const parts = ls.split(/\s+/);
      const symBlob = sha40(parts[1]!);
      // Register claims regular-file mode while HEAD is a symlink.
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
});
