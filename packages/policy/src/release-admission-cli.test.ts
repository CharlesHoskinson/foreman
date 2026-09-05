import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { canonicalize, sha256Hex } from "@foreman/core";
import { Effect } from "effect";

import {
  buildApprovedOpenSpecManifestV1,
  liveReleaseAdmissionCliServices,
  runReleaseAdmissionCli,
  type ReleaseAdmissionCliServices,
  type ReleaseCandidateIdentityV1,
  type ReleaseEvidenceBundleV1,
} from "./index.js";

const encoder = new TextEncoder();
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;
const RELEASE_ADMISSION_MAIN = fileURLToPath(
  new URL("./release-admission-main.ts", import.meta.url),
);
const utf8 = (text: string): Uint8Array => encoder.encode(text);
const canonicalFile = (value: unknown): Uint8Array =>
  utf8(`${canonicalize(value)}\n`);

const REPO = "/repo";
const EVIDENCE = "/authority/evidence.json";
const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const ROOT_SHA = "c".repeat(64);
const FAMILY_SHA = "d".repeat(64);
const TASK_BYTES = utf8("# Tasks\n");
const OPEN_SPEC_BYTES = {
  "design.md": utf8("# Design\n"),
  "proposal.md": utf8("# Proposal\n"),
  "specs/release/spec.md": utf8("# Requirements\n"),
} as const;

const CANDIDATE: ReleaseCandidateIdentityV1 = {
  commit: COMMIT,
  tree: TREE,
  candidateSha256: sha256Hex(COMMIT),
};

const DESIGN = {
  schema: "foreman.design-approval.v1" as const,
  program: "v040" as const,
  packageId: "project-registry",
  designCommit: COMMIT,
  designTree: TREE,
  approvedOpenSpecSha256: sha256Hex(
    utf8(
      canonicalize({
        schema: "foreman.approved-openspec.v1",
        files: [
          { path: "design.md", sha256: sha256Hex(OPEN_SPEC_BYTES["design.md"]) },
          {
            path: "proposal.md",
            sha256: sha256Hex(OPEN_SPEC_BYTES["proposal.md"]),
          },
          {
            path: "specs/release/spec.md",
            sha256: sha256Hex(OPEN_SPEC_BYTES["specs/release/spec.md"]),
          },
        ],
      }),
    ),
  ),
  taskPlanSha256: sha256Hex(TASK_BYTES),
  approvalStatementSha256: "e".repeat(64),
  issuedAt: "2026-08-24T12:00:00Z",
};

const BUNDLE: ReleaseEvidenceBundleV1 = {
  schema: "foreman.release-evidence-bundle.v1",
  program: "v040",
  rootContractId: "v040-release-root",
  rootContractSha256: ROOT_SHA,
  familySha256: FAMILY_SHA,
  childId: "v040-t2-project-registry",
  packageId: "project-registry",
  action: "implement",
  candidate: CANDIDATE,
  taskPlanSha256: sha256Hex(TASK_BYTES),
  receipts: [DESIGN],
  issuedAt: "2026-08-24T12:01:00Z",
};

const VALID_ARGV = [
  "node",
  "release-admission-main.js",
  "check",
  "--program",
  "v040",
  "--action",
  "implement",
  "--package",
  "project-registry",
  "--repo",
  REPO,
  "--candidate-commit",
  COMMIT,
  "--evidence",
  EVIDENCE,
] as const;

type Capture = {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly calls: string[];
};

function services(
  capture: Capture,
  options: {
    readonly gitFailure?: boolean;
    readonly designTree?: string;
    readonly approvedOpenSpecBytes?: Readonly<Record<string, Uint8Array>>;
    readonly taskPlanBytes?: Uint8Array;
  } = {},
): ReleaseAdmissionCliServices {
  return {
    readEvidence: (input) => {
      capture.calls.push(`read:${input.path}:${input.maxBytes}`);
      return Effect.succeed(canonicalFile(BUNDLE));
    },
    loadGitAuthority: (input) => {
      capture.calls.push(
        `git:${input.repository}:${input.candidateCommit}:${input.designCommit}:${input.packageId}`,
      );
      if (options.gitFailure) return Effect.fail({ _tag: "GitFailure" });
      return Effect.succeed({
        candidate: CANDIDATE,
        designTree: options.designTree ?? TREE,
        designLineageValid: true,
        approvedOpenSpecBytes:
          options.approvedOpenSpecBytes ?? OPEN_SPEC_BYTES,
        taskPlanBytes: options.taskPlanBytes ?? TASK_BYTES,
      });
    },
  };
}

async function run(
  argv: readonly string[],
  options?: Parameters<typeof services>[1],
): Promise<{ readonly code: number; readonly capture: Capture }> {
  const capture: Capture = { stdout: [], stderr: [], calls: [] };
  const code = await Effect.runPromise(
    runReleaseAdmissionCli(
      argv,
      {
        writeStdout: (line) => capture.stdout.push(line),
        writeStderr: (line) => capture.stderr.push(line),
      },
      services(capture, options),
    ),
  );
  return { code, capture };
}

test("release-admission CLI verifies one bounded historical authority", async () => {
  const { code, capture } = await run(VALID_ARGV);
  assert.equal(code, 0);
  assert.deepEqual(capture.stderr, []);
  assert.deepEqual(capture.stdout, [
    `${canonicalize({ schemaVersion: 1, _tag: "EvidenceValid" })}\n`,
  ]);
  assert.deepEqual(capture.calls, [
    `read:${EVIDENCE}:1048576`,
    `git:${REPO}:${COMMIT}:${COMMIT}:project-registry`,
  ]);
});

test("v050 is accepted at the CLI and v041 is wrong_program", async () => {
  const v041 = [
    ...VALID_ARGV.slice(0, 4),
    "v041",
    ...VALID_ARGV.slice(5),
  ];
  const unknown = await run(v041);
  assert.equal(unknown.code, 1);
  assert.deepEqual(unknown.capture.calls, []);
  assert.deepEqual(unknown.capture.stderr, []);
  assert.deepEqual(unknown.capture.stdout, [
    `${canonicalize({
      schemaVersion: 1,
      _tag: "EvidenceInvalid",
      reason: "wrong_program",
    })}\n`,
  ]);

  const v050Argv = [
    ...VALID_ARGV.slice(0, 4),
    "v050",
    ...VALID_ARGV.slice(5),
  ];
  const v050Design = { ...DESIGN, program: "v050" as const };
  const v050Bundle = { ...BUNDLE, program: "v050" as const, receipts: [v050Design] };
  const capture: Capture = { stdout: [], stderr: [], calls: [] };
  const code = await Effect.runPromise(
    runReleaseAdmissionCli(
      v050Argv,
      {
        writeStdout: (line) => capture.stdout.push(line),
        writeStderr: (line) => capture.stderr.push(line),
      },
      {
        readEvidence: (input) => {
          capture.calls.push(`read:${input.path}:${input.maxBytes}`);
          return Effect.succeed(canonicalFile(v050Bundle));
        },
        loadGitAuthority: (input) => {
          capture.calls.push(
            `git:${input.repository}:${input.candidateCommit}:${input.designCommit}:${input.packageId}`,
          );
          return Effect.succeed({
            candidate: CANDIDATE,
            designTree: TREE,
            designLineageValid: true,
            approvedOpenSpecBytes: OPEN_SPEC_BYTES,
            taskPlanBytes: TASK_BYTES,
          });
        },
      },
    ),
  );
  assert.equal(code, 0);
  assert.deepEqual(capture.stderr, []);
  assert.deepEqual(capture.stdout, [
    `${canonicalize({ schemaVersion: 1, _tag: "EvidenceValid" })}\n`,
  ]);
});

test("invalid invocation is exit 64 with no service call", async () => {
  const { code, capture } = await run(VALID_ARGV.slice(0, -2));
  assert.equal(code, 64);
  assert.deepEqual(capture.stdout, []);
  assert.equal(capture.stderr.length, 1);
  assert.match(capture.stderr[0]!, /^Usage: release-admission check /);
  assert.deepEqual(capture.calls, []);
});

test("Git dependency failure is one canonical refusal", async () => {
  const { code, capture } = await run(VALID_ARGV, { gitFailure: true });
  assert.equal(code, 1);
  assert.deepEqual(capture.stderr, []);
  assert.deepEqual(capture.stdout, [
    `${canonicalize({
      schemaVersion: 1,
      _tag: "EvidenceInvalid",
      reason: "git_resolution_failure",
    })}\n`,
  ]);
});

test("historical design tree mismatch refuses before pure validation", async () => {
  const { code, capture } = await run(VALID_ARGV, {
    designTree: "1".repeat(40),
  });
  assert.equal(code, 1);
  assert.deepEqual(capture.stderr, []);
  assert.deepEqual(capture.stdout, [
    `${canonicalize({
      schemaVersion: 1,
      _tag: "EvidenceInvalid",
      reason: "wrong_design_base",
    })}\n`,
  ]);
});

test("an extra historical specification changes approved authority", async () => {
  const { code, capture } = await run(VALID_ARGV, {
    approvedOpenSpecBytes: {
      ...OPEN_SPEC_BYTES,
      "specs/release/extra.md": utf8("# Unapproved\n"),
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(capture.stderr, []);
  assert.deepEqual(capture.stdout, [
    `${canonicalize({
      schemaVersion: 1,
      _tag: "EvidenceInvalid",
      reason: "approved_openspec_mismatch",
    })}\n`,
  ]);
});

test("live evidence reads accept exactly one MiB and refuse max-plus-one", async () => {
  const root = mkdtempSync(join(tmpdir(), "release-admission-read-"));
  const path = join(root, "evidence.json");
  try {
    writeFileSync(path, new Uint8Array(1_048_576));
    const exact = await Effect.runPromise(
      Effect.either(
        liveReleaseAdmissionCliServices.readEvidence({
          path,
          maxBytes: 1_048_576,
        }),
      ),
    );
    assert.equal(exact._tag, "Right");
    if (exact._tag === "Right") {
      assert.equal(exact.right.byteLength, 1_048_576);
    }

    writeFileSync(path, new Uint8Array(1_048_577));
    const oversized = await Effect.runPromise(
      Effect.either(
        liveReleaseAdmissionCliServices.readEvidence({
          path,
          maxBytes: 1_048_576,
        }),
      ),
    );
    assert.equal(oversized._tag, "Left");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function git(repository: string, args: readonly string[]): SpawnSyncReturns<string> {
  const result = spawnSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_AUTHOR_NAME: "Release Test",
      GIT_AUTHOR_EMAIL: "release@example.invalid",
      GIT_COMMITTER_NAME: "Release Test",
      GIT_COMMITTER_EMAIL: "release@example.invalid",
    },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

async function loadLiveAuthority(
  repository: string,
  commit: string,
) {
  return Effect.runPromise(
    Effect.either(
      liveReleaseAdmissionCliServices.loadGitAuthority({
        repository,
        candidateCommit: commit,
        designCommit: commit,
        packageId: "project-registry",
        maxBlobBytes: 1_048_576,
        maxSpecFiles: 256,
        maxRetainedBytes: 16 * 1_048_576,
      }),
    ),
  );
}

test("live historical loader refuses oversized, missing, and excessive blobs", async () => {
  const root = mkdtempSync(join(tmpdir(), "release-admission-bounds-"));
  const repository = join(root, "repo");
  const emptyTemplate = join(root, "empty-template");
  try {
    mkdirSync(repository, { recursive: true });
    mkdirSync(emptyTemplate, { recursive: true });
    git(repository, [
      "-c",
      "init.defaultObjectFormat=sha1",
      "init",
      "--quiet",
      `--template=${emptyTemplate}`,
    ]);
    const packageRoot = join(
      repository,
      "openspec",
      "changes",
      "project-registry",
    );
    mkdirSync(join(packageRoot, "specs", "release"), { recursive: true });
    writeFileSync(join(packageRoot, "proposal.md"), new Uint8Array(1_048_577));
    writeFileSync(join(packageRoot, "design.md"), "# Design\n");
    writeFileSync(join(packageRoot, "specs", "release", "spec.md"), "# Spec\n");
    writeFileSync(join(packageRoot, "tasks.md"), "# Tasks\n");
    git(repository, ["add", "."]);
    git(repository, ["commit", "--quiet", "-m", "oversized authority"]);
    const oversizedCommit = git(repository, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal((await loadLiveAuthority(repository, oversizedCommit))._tag, "Left");

    writeFileSync(join(packageRoot, "proposal.md"), "# Proposal\n");
    git(repository, ["rm", "--quiet", "openspec/changes/project-registry/tasks.md"]);
    git(repository, ["add", "."]);
    git(repository, ["commit", "--quiet", "-m", "missing task plan"]);
    const missingCommit = git(repository, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal((await loadLiveAuthority(repository, missingCommit))._tag, "Left");

    writeFileSync(join(packageRoot, "tasks.md"), "# Tasks\n");
    for (let index = 0; index < 257; index += 1) {
      writeFileSync(
        join(packageRoot, "specs", "release", `extra-${index}.md`),
        "# Spec\n",
      );
    }
    git(repository, ["add", "."]);
    git(repository, ["commit", "--quiet", "-m", "too many specs"]);
    const excessiveCommit = git(repository, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal((await loadLiveAuthority(repository, excessiveCommit))._tag, "Left");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "live CLI never executes repository-selected Git",
  { skip: process.platform === "win32" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "release-admission-git-path-"));
    const repository = join(root, "repo");
    const emptyTemplate = join(root, "empty-template");
    const maliciousBin = join(repository, "tools");
    const sentinel = join(root, "repository-git-ran");
    try {
      mkdirSync(repository, { recursive: true });
      mkdirSync(emptyTemplate, { recursive: true });
      git(repository, [
        "-c",
        "init.defaultObjectFormat=sha1",
        "init",
        "--quiet",
        `--template=${emptyTemplate}`,
      ]);
      const packageRoot = join(
        repository,
        "openspec",
        "changes",
        "project-registry",
      );
      mkdirSync(join(packageRoot, "specs", "release"), { recursive: true });
      for (const [path, bytes] of Object.entries(OPEN_SPEC_BYTES)) {
        writeFileSync(join(packageRoot, ...path.split("/")), bytes);
      }
      writeFileSync(join(packageRoot, "tasks.md"), TASK_BYTES);
      git(repository, ["add", "."]);
      git(repository, ["commit", "--quiet", "-m", "approved design"]);
      const commit = git(repository, ["rev-parse", "HEAD"]).stdout.trim();
      const tree = git(repository, [
        "rev-parse",
        `${commit}^{tree}`,
      ]).stdout.trim();
      const manifest = buildApprovedOpenSpecManifestV1({
        workflow: "foreman-architectural",
        files: Object.entries(OPEN_SPEC_BYTES).map(([path, bytes]) => ({
          path,
          bytes,
        })),
      });
      assert.equal(manifest._tag, "Valid");
      if (manifest._tag !== "Valid") throw new Error("manifest fixture");
      const candidate: ReleaseCandidateIdentityV1 = {
        commit,
        tree,
        candidateSha256: sha256Hex(commit),
      };
      const evidencePath = join(root, "evidence.json");
      writeFileSync(
        evidencePath,
        canonicalFile({
          ...BUNDLE,
          candidate,
          receipts: [
            {
              ...DESIGN,
              designCommit: commit,
              designTree: tree,
              approvedOpenSpecSha256: manifest.sha256,
            },
          ],
        }),
      );

      mkdirSync(maliciousBin, { recursive: true });
      const maliciousGit = join(maliciousBin, "git");
      writeFileSync(
        maliciousGit,
        `#!/bin/sh\nprintf ran > '${sentinel}'\nexit 1\n`,
      );
      chmodSync(maliciousGit, 0o755);

      const invoked = spawnSync(
        process.execPath,
        [
          "--import",
          TSX_LOADER,
          RELEASE_ADMISSION_MAIN,
          "check",
          "--program",
          "v040",
          "--action",
          "implement",
          "--package",
          "project-registry",
          "--repo",
          repository,
          "--candidate-commit",
          commit,
          "--evidence",
          evidencePath,
        ],
        {
          cwd: repository,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${maliciousBin}:${process.env.PATH ?? ""}`,
          },
          timeout: 30_000,
        },
      );
      assert.equal(invoked.error, undefined);
      assert.equal(invoked.status, 1, invoked.stderr);
      assert.equal(invoked.stderr, "");
      assert.equal(
        invoked.stdout,
        `${canonicalize({
          schemaVersion: 1,
          _tag: "EvidenceInvalid",
          reason: "git_resolution_failure",
        })}\n`,
      );
      assert.equal(existsSync(sentinel), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("live CLI loads approved bytes from the pinned design commit", async () => {
  const root = mkdtempSync(join(tmpdir(), "release-admission-live-"));
  const repository = join(root, "repo");
  const emptyTemplate = join(root, "empty-template");
  try {
    mkdirSync(repository, { recursive: true });
    mkdirSync(emptyTemplate, { recursive: true });
    git(repository, [
      "-c",
      "init.defaultObjectFormat=sha1",
      "init",
      "--quiet",
      `--template=${emptyTemplate}`,
    ]);
    const packageRoot = join(
      repository,
      "openspec",
      "changes",
      "project-registry",
    );
    mkdirSync(join(packageRoot, "specs", "release"), { recursive: true });
    for (const [path, bytes] of Object.entries(OPEN_SPEC_BYTES)) {
      writeFileSync(join(packageRoot, ...path.split("/")), bytes);
    }
    writeFileSync(join(packageRoot, "tasks.md"), TASK_BYTES);
    git(repository, ["add", "."]);
    git(repository, ["commit", "--quiet", "-m", "approved design"]);
    const commit = git(repository, ["rev-parse", "HEAD"]).stdout.trim();
    const tree = git(repository, ["rev-parse", `${commit}^{tree}`]).stdout.trim();
    assert.match(commit, /^[0-9a-f]{40}$/);
    assert.match(tree, /^[0-9a-f]{40}$/);

    const manifest = buildApprovedOpenSpecManifestV1({
      workflow: "foreman-architectural",
      files: Object.entries(OPEN_SPEC_BYTES).map(([path, bytes]) => ({
        path,
        bytes,
      })),
    });
    assert.equal(manifest._tag, "Valid");
    if (manifest._tag !== "Valid") throw new Error("manifest fixture");
    const candidate: ReleaseCandidateIdentityV1 = {
      commit,
      tree,
      candidateSha256: sha256Hex(commit),
    };
    const design = {
      ...DESIGN,
      designCommit: commit,
      designTree: tree,
      approvedOpenSpecSha256: manifest.sha256,
    };
    const bundle: ReleaseEvidenceBundleV1 = {
      ...BUNDLE,
      candidate,
      receipts: [design],
    };
    const evidencePath = join(root, "evidence.json");
    writeFileSync(evidencePath, canonicalFile(bundle));

    // The live loader must ignore these mutable worktree bytes.
    writeFileSync(join(packageRoot, "proposal.md"), "changed after approval\n");
    writeFileSync(join(packageRoot, "tasks.md"), "changed after approval\n");

    const loaded = await Effect.runPromise(
      Effect.either(
        liveReleaseAdmissionCliServices.loadGitAuthority({
          repository,
          candidateCommit: commit,
          designCommit: commit,
          packageId: "project-registry",
          maxBlobBytes: 1_048_576,
          maxSpecFiles: 256,
          maxRetainedBytes: 16 * 1_048_576,
        }),
      ),
    );
    assert.equal(
      loaded._tag,
      "Right",
      loaded._tag === "Left" ? String(loaded.left) : "expected Git authority",
    );

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await Effect.runPromise(
      runReleaseAdmissionCli(
        [
          "check",
          "--program",
          "v040",
          "--action",
          "implement",
          "--package",
          "project-registry",
          "--repo",
          repository,
          "--candidate-commit",
          commit,
          "--evidence",
          evidencePath,
        ],
        {
          writeStdout: (line) => stdout.push(line),
          writeStderr: (line) => stderr.push(line),
        },
        liveReleaseAdmissionCliServices,
      ),
    );
    assert.equal(code, 0, JSON.stringify({ stdout, stderr }));
    assert.deepEqual(stderr, []);
    assert.deepEqual(stdout, [
      `${canonicalize({ schemaVersion: 1, _tag: "EvidenceValid" })}\n`,
    ]);

    const runLive = async (
      action: string,
      evidence: unknown,
    ): Promise<{
      readonly code: number;
      readonly stdout: readonly string[];
      readonly stderr: readonly string[];
    }> => {
      writeFileSync(evidencePath, canonicalFile(evidence));
      const localStdout: string[] = [];
      const localStderr: string[] = [];
      const localCode = await Effect.runPromise(
        runReleaseAdmissionCli(
          [
            "check",
            "--program",
            "v040",
            "--action",
            action,
            "--package",
            "project-registry",
            "--repo",
            repository,
            "--candidate-commit",
            commit,
            "--evidence",
            evidencePath,
          ],
          {
            writeStdout: (line) => localStdout.push(line),
            writeStderr: (line) => localStderr.push(line),
          },
          liveReleaseAdmissionCliServices,
        ),
      );
      return { code: localCode, stdout: localStdout, stderr: localStderr };
    };
    const expectLiveReason = async (
      action: string,
      evidence: unknown,
      reason: string,
    ): Promise<void> => {
      const result = await runLive(action, evidence);
      assert.equal(result.code, 1);
      assert.deepEqual(result.stderr, []);
      assert.deepEqual(result.stdout, [
        `${canonicalize({
          schemaVersion: 1,
          _tag: "EvidenceInvalid",
          reason,
        })}\n`,
      ]);
    };

    await expectLiveReason("verify", bundle, "wrong_action");
    await expectLiveReason(
      "implement",
      {
        ...bundle,
        candidate: {
          commit: "1".repeat(40),
          tree,
          candidateSha256: sha256Hex("1".repeat(40)),
        },
      },
      "wrong_candidate",
    );
    await expectLiveReason(
      "implement",
      { ...bundle, candidate: { ...candidate, tree: "2".repeat(40) } },
      "wrong_candidate",
    );
    await expectLiveReason(
      "implement",
      { ...bundle, candidate: { ...candidate, candidateSha256: "f".repeat(64) } },
      "invalid_evidence",
    );
    await expectLiveReason(
      "implement",
      {
        ...bundle,
        receipts: [
          { ...design, approvedOpenSpecSha256: "f".repeat(64) },
        ],
      },
      "approved_openspec_mismatch",
    );
    const audit = {
      schema: "foreman.release-audit.v1" as const,
      program: "v040" as const,
      packageId: "project-registry",
      candidate,
      verdict: "APPROVED" as const,
      findings: [],
      evidenceSha256: "f".repeat(64),
      issuedAt: "2026-08-24T12:02:00Z",
    };
    await expectLiveReason(
      "integrate",
      {
        ...bundle,
        action: "integrate",
        receipts: [design, { ...audit, verdict: "WARNING" }],
      },
      "invalid_evidence",
    );
    await expectLiveReason(
      "integrate",
      {
        ...bundle,
        action: "integrate",
        receipts: [
          design,
          {
            ...audit,
            findings: [
              {
                severity: "high",
                file: "src/release.ts",
                line: 1,
                summary: "blocking finding",
                evidence: "the release cannot proceed",
              },
            ],
          },
        ],
      },
      "invalid_evidence",
    );

    mkdirSync(join(repository, ".foreman"), { recursive: true });
    writeFileSync(
      join(repository, ".foreman", "config.toml"),
      "[audit.policy]\nwarning_low_resolved = \"merge\"\n",
    );
    const policyBait = await runLive("implement", bundle);
    assert.equal(policyBait.code, 0);
    assert.deepEqual(policyBait.stderr, []);
    assert.deepEqual(policyBait.stdout, [
      `${canonicalize({ schemaVersion: 1, _tag: "EvidenceValid" })}\n`,
    ]);
    writeFileSync(evidencePath, canonicalFile(bundle));

    const invoked = spawnSync(
      process.execPath,
      [
        "--import",
        TSX_LOADER,
        RELEASE_ADMISSION_MAIN,
        "check",
        "--program",
        "v040",
        "--action",
        "implement",
        "--package",
        "project-registry",
        "--repo",
        repository,
        "--candidate-commit",
        commit,
        "--evidence",
        evidencePath,
      ],
      {
        cwd: repository,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    assert.equal(invoked.error, undefined);
    assert.equal(invoked.status, 0, invoked.stderr);
    assert.equal(invoked.stderr, "");
    assert.equal(
      invoked.stdout,
      `${canonicalize({ schemaVersion: 1, _tag: "EvidenceValid" })}\n`,
    );

    git(repository, ["add", "."]);
    git(repository, ["commit", "--quiet", "-m", "first task result"]);
    const descendantCommit = git(repository, ["rev-parse", "HEAD"]).stdout.trim();
    const descendantTree = git(
      repository,
      ["rev-parse", `${descendantCommit}^{tree}`],
    ).stdout.trim();
    const descendantCandidate: ReleaseCandidateIdentityV1 = {
      commit: descendantCommit,
      tree: descendantTree,
      candidateSha256: sha256Hex(descendantCommit),
    };
    writeFileSync(
      evidencePath,
      canonicalFile({ ...bundle, candidate: descendantCandidate }),
    );
    const descendant = spawnSync(
      process.execPath,
      [
        "--import",
        TSX_LOADER,
        RELEASE_ADMISSION_MAIN,
        "check",
        "--program",
        "v040",
        "--action",
        "implement",
        "--package",
        "project-registry",
        "--repo",
        repository,
        "--candidate-commit",
        descendantCommit,
        "--evidence",
        evidencePath,
      ],
      {
        cwd: repository,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    assert.equal(descendant.error, undefined);
    assert.equal(descendant.status, 0, descendant.stderr);
    assert.equal(descendant.stderr, "");
    assert.equal(
      descendant.stdout,
      `${canonicalize({ schemaVersion: 1, _tag: "EvidenceValid" })}\n`,
    );

    git(repository, ["branch", "side", commit]);
    git(repository, ["checkout", "--quiet", "side"]);
    writeFileSync(join(repository, "side.txt"), "side\n");
    git(repository, ["add", "."]);
    git(repository, ["commit", "--quiet", "-m", "sibling"]);
    const siblingCommit = git(repository, ["rev-parse", "HEAD"]).stdout.trim();
    const siblingTree = git(
      repository,
      ["rev-parse", `${siblingCommit}^{tree}`],
    ).stdout.trim();
    writeFileSync(
      evidencePath,
      canonicalFile({
        ...bundle,
        candidate: {
          commit: siblingCommit,
          tree: siblingTree,
          candidateSha256: sha256Hex(siblingCommit),
        },
      }),
    );
    const sibling = spawnSync(
      process.execPath,
      [
        "--import",
        TSX_LOADER,
        RELEASE_ADMISSION_MAIN,
        "check",
        "--program",
        "v040",
        "--action",
        "implement",
        "--package",
        "project-registry",
        "--repo",
        repository,
        "--candidate-commit",
        siblingCommit,
        "--evidence",
        evidencePath,
      ],
      {
        cwd: repository,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    assert.equal(sibling.error, undefined);
    assert.equal(sibling.status, 0, sibling.stderr);
    assert.equal(sibling.stderr, "");
    assert.equal(
      sibling.stdout,
      `${canonicalize({ schemaVersion: 1, _tag: "EvidenceValid" })}\n`,
    );
    git(repository, ["checkout", "--quiet", "--detach", descendantCommit]);
    git(repository, ["merge", "--quiet", "--no-ff", "side", "-m", "merge"]);
    const mergeCommit = git(repository, ["rev-parse", "HEAD"]).stdout.trim();
    const mergeTree = git(
      repository,
      ["rev-parse", `${mergeCommit}^{tree}`],
    ).stdout.trim();
    writeFileSync(
      evidencePath,
      canonicalFile({
        ...bundle,
        candidate: {
          commit: mergeCommit,
          tree: mergeTree,
          candidateSha256: sha256Hex(mergeCommit),
        },
      }),
    );
    const merge = spawnSync(
      process.execPath,
      [
        "--import",
        TSX_LOADER,
        RELEASE_ADMISSION_MAIN,
        "check",
        "--program",
        "v040",
        "--action",
        "implement",
        "--package",
        "project-registry",
        "--repo",
        repository,
        "--candidate-commit",
        mergeCommit,
        "--evidence",
        evidencePath,
      ],
      {
        cwd: repository,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    assert.equal(merge.error, undefined);
    assert.equal(merge.status, 1, merge.stderr);
    assert.equal(merge.stderr, "");
    assert.equal(
      merge.stdout,
      `${canonicalize({
        schemaVersion: 1,
        _tag: "EvidenceInvalid",
        reason: "wrong_design_base",
      })}\n`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
