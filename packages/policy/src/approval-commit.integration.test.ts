/**
 * Real temporary-Git integration: non-self-referential approval commit C
 * with sole parent P, register-only path change, and single-row delta.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { canonicalize } from "@foreman/core";
import { CANONICAL_REGISTER_ID, CANONICAL_REGISTER_RELPATH } from "./schema.js";
import { BEGIN_SENTINEL, END_SENTINEL } from "./register.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const bundlePath = join(
  root,
  "skills/foreman/runtime/dist/destruction-guard.js",
);

const ARTIFACT = {
  byteLength: 0,
  recoveryPath: "/recovery/out.bin",
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  sourcePath: "/source/in.bin",
} as const;

function git(repo: string, args: string[]) {
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
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
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
    [
      "# destruction log",
      "",
      BEGIN_SENTINEL,
      bodyJson,
      END_SENTINEL,
      "",
      "Explanatory prose only.",
      "",
    ].join("\n"),
    "utf8",
  );
}

/** Parent seed: one blocked action row (DST-9999) with fixed identity. */
function parentSeedJson(): string {
  return canonicalize({
    currentEntries: [
      {
        actionKind: "artifact_relocate",
        artifactRelocate: ARTIFACT,
        evidence: "pending",
        id: "DST-9999",
        owner: "pending",
        recordedAt: "pending",
        recoveryStatus: "pending",
        requiredCondition: "ok",
        state: "blocked",
        targetOrAction: "file",
      },
    ],
    historicalIncidents: [],
    registerId: CANONICAL_REGISTER_ID,
    schemaVersion: 1,
  });
}

/** C: same identity row, approved + recovery_ready + approval binding P/PT. */
function approvedSingleJson(p: string, pt: string): string {
  return canonicalize({
    currentEntries: [
      {
        actionKind: "artifact_relocate",
        approval: {
          actionKind: "artifact_relocate",
          approvedAt: "2020-01-01T00:00:00Z",
          approver: "Release architect",
          candidateCommitSha: p,
          candidateTreeSha: pt,
          evidence: "review-1",
          expiresAt: "2099-01-01T00:00:00Z",
        },
        artifactRelocate: ARTIFACT,
        evidence: "complete evidence",
        id: "DST-9999",
        owner: "architect",
        recordedAt: "2020-01-01T00:00:00Z",
        recoveryStatus: "recovery_ready",
        requiredCondition: "ok",
        state: "approved",
        targetOrAction: "file",
      },
    ],
    historicalIncidents: [],
    registerId: CANONICAL_REGISTER_ID,
    schemaVersion: 1,
  });
}

/** Smuggle a second approved row that was blocked in P. */
function smuggledSecondApprovalJson(p: string, pt: string): string {
  return canonicalize({
    currentEntries: [
      {
        actionKind: "artifact_relocate",
        approval: {
          actionKind: "artifact_relocate",
          approvedAt: "2020-01-01T00:00:00Z",
          approver: "Release architect",
          candidateCommitSha: p,
          candidateTreeSha: pt,
          evidence: "review-1",
          expiresAt: "2099-01-01T00:00:00Z",
        },
        artifactRelocate: ARTIFACT,
        evidence: "complete evidence",
        id: "DST-9999",
        owner: "architect",
        recordedAt: "2020-01-01T00:00:00Z",
        recoveryStatus: "recovery_ready",
        requiredCondition: "ok",
        state: "approved",
        targetOrAction: "file",
      },
      {
        actionKind: "artifact_relocate",
        approval: {
          actionKind: "artifact_relocate",
          approvedAt: "2020-01-01T00:00:00Z",
          approver: "Release architect",
          candidateCommitSha: p,
          candidateTreeSha: pt,
          evidence: "smuggle",
          expiresAt: "2099-01-01T00:00:00Z",
        },
        artifactRelocate: {
          ...ARTIFACT,
          sourcePath: "/source/other.bin",
        },
        evidence: "smuggled",
        id: "DST-0001",
        owner: "architect",
        recordedAt: "2020-01-01T00:00:00Z",
        recoveryStatus: "recovery_ready",
        requiredCondition: "ok",
        state: "approved",
        targetOrAction: "other",
      },
    ],
    historicalIncidents: [],
    registerId: CANONICAL_REGISTER_ID,
    schemaVersion: 1,
  });
}

function parentTwoRowSeedJson(): string {
  return canonicalize({
    currentEntries: [
      {
        actionKind: "artifact_relocate",
        artifactRelocate: ARTIFACT,
        evidence: "pending",
        id: "DST-9999",
        owner: "pending",
        recordedAt: "pending",
        recoveryStatus: "pending",
        requiredCondition: "ok",
        state: "blocked",
        targetOrAction: "file",
      },
      {
        actionKind: "artifact_relocate",
        artifactRelocate: {
          ...ARTIFACT,
          sourcePath: "/source/other.bin",
        },
        evidence: "pending",
        id: "DST-0001",
        owner: "pending",
        recordedAt: "pending",
        recoveryStatus: "pending",
        requiredCondition: "ok",
        state: "blocked",
        targetOrAction: "other",
      },
    ],
    historicalIncidents: [],
    registerId: CANONICAL_REGISTER_ID,
    schemaVersion: 1,
  });
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_PATH: "" };
  delete env["FORCE_COLOR"];
  delete env["NO_COLOR"];
  return env;
}

function runCheck(repo: string, entryId: string) {
  return spawnSync(
    process.execPath,
    [bundlePath, "check", "--repo-root", repo],
    {
      cwd: repo,
      encoding: "utf8",
      input: canonicalize({ entryId, schemaVersion: 1 }),
      env: childEnv(),
    },
  );
}

describe("approval-commit integration", () => {
  it("Authorizes check for exact single-row P→C approval", () => {
    assert.ok(readFileSync(bundlePath).byteLength > 0);
    const tmp = mkdtempSync(join(tmpdir(), "foreman-appr-"));
    try {
      git(tmp, ["init"]);
      git(tmp, ["config", "user.email", "t@t"]);
      git(tmp, ["config", "user.name", "t"]);
      git(tmp, ["config", "commit.gpgsign", "false"]);

      writeRegisterMd(tmp, parentSeedJson());
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "P seed"]);
      const p = sha40(git(tmp, ["rev-parse", "HEAD"]));
      const pt = sha40(git(tmp, ["rev-parse", "HEAD^{tree}"]));

      writeRegisterMd(tmp, approvedSingleJson(p, pt));
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "C approval"]);
      assert.notEqual(sha40(git(tmp, ["rev-parse", "HEAD"])), p);

      const run = runCheck(tmp, "DST-9999");
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.equal((run.stderr || "").length, 0);
      const parsed = JSON.parse((run.stdout || "").trim()) as {
        _tag: string;
        entryId?: string;
        actionKind?: string;
      };
      assert.equal(parsed._tag, "Authorized");
      assert.equal(parsed.entryId, "DST-9999");
      assert.equal(parsed.actionKind, "artifact_relocate");

      const rel = spawnSync(
        process.execPath,
        [bundlePath, "relocate-artifact", "--repo-root", tmp],
        {
          cwd: tmp,
          encoding: "utf8",
          input: canonicalize({ entryId: "DST-9999", schemaVersion: 1 }),
          env: childEnv(),
        },
      );
      assert.equal(rel.status, 1);
      const relOut = JSON.parse((rel.stdout || "").trim()) as {
        _tag: string;
        reason?: string;
      };
      assert.equal(relOut._tag, "Failed");
      assert.equal(relOut.reason, "platform_invariant_unproven");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("denies smuggled second approval in C", () => {
    const tmp = mkdtempSync(join(tmpdir(), "foreman-appr-smuggle-"));
    try {
      git(tmp, ["init"]);
      git(tmp, ["config", "user.email", "t@t"]);
      git(tmp, ["config", "user.name", "t"]);
      git(tmp, ["config", "commit.gpgsign", "false"]);
      writeRegisterMd(tmp, parentTwoRowSeedJson());
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "P"]);
      const p = sha40(git(tmp, ["rev-parse", "HEAD"]));
      const pt = sha40(git(tmp, ["rev-parse", "HEAD^{tree}"]));
      writeRegisterMd(tmp, smuggledSecondApprovalJson(p, pt));
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "C smuggle"]);
      const run = runCheck(tmp, "DST-9999");
      assert.equal(run.status, 1);
      const parsed = JSON.parse((run.stdout || "").trim()) as {
        reason?: string;
      };
      assert.equal(parsed.reason, "approval_delta_mismatch");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("denies when C changes an extra path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "foreman-appr-extra-"));
    try {
      git(tmp, ["init"]);
      git(tmp, ["config", "user.email", "t@t"]);
      git(tmp, ["config", "user.name", "t"]);
      git(tmp, ["config", "commit.gpgsign", "false"]);
      writeRegisterMd(tmp, parentSeedJson());
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "P"]);
      const p = sha40(git(tmp, ["rev-parse", "HEAD"]));
      const pt = sha40(git(tmp, ["rev-parse", "HEAD^{tree}"]));
      writeRegisterMd(tmp, approvedSingleJson(p, pt));
      writeFileSync(join(tmp, "extra.txt"), "x");
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH, "extra.txt"]);
      git(tmp, ["commit", "-m", "C dirty extra"]);
      const run = runCheck(tmp, "DST-9999");
      assert.equal(run.status, 1);
      const parsed = JSON.parse((run.stdout || "").trim()) as {
        reason?: string;
      };
      assert.equal(parsed.reason, "approval_commit_ineligible");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("denies wrong P binding", () => {
    const tmp = mkdtempSync(join(tmpdir(), "foreman-appr-wrong-"));
    try {
      git(tmp, ["init"]);
      git(tmp, ["config", "user.email", "t@t"]);
      git(tmp, ["config", "user.name", "t"]);
      git(tmp, ["config", "commit.gpgsign", "false"]);
      writeRegisterMd(tmp, parentSeedJson());
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "P"]);
      const pt = sha40(git(tmp, ["rev-parse", "HEAD^{tree}"]));
      writeRegisterMd(tmp, approvedSingleJson("e".repeat(40), pt));
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "C"]);
      const run = runCheck(tmp, "DST-9999");
      assert.equal(run.status, 1);
      const parsed = JSON.parse((run.stdout || "").trim()) as {
        reason?: string;
      };
      assert.equal(parsed.reason, "candidate_mismatch");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails closed on dirty worktree register", () => {
    const tmp = mkdtempSync(join(tmpdir(), "foreman-appr-dirty-"));
    try {
      git(tmp, ["init"]);
      git(tmp, ["config", "user.email", "t@t"]);
      git(tmp, ["config", "user.name", "t"]);
      git(tmp, ["config", "commit.gpgsign", "false"]);
      writeRegisterMd(tmp, parentSeedJson());
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "P"]);
      writeRegisterMd(tmp, parentSeedJson() + "\n");
      const run = runCheck(tmp, "DST-9999");
      assert.equal(run.status, 1);
      const parsed = JSON.parse((run.stdout || "").trim()) as {
        reason?: string;
      };
      assert.equal(parsed.reason, "authority_dirty");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

void root;
