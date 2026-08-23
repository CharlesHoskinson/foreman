import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect } from "effect";
import { canonicalize } from "@foreman/core";
import type {
  ReleaseCoverageFailureReason,
  ReleaseCoveragePhaseV1,
  ReleaseCoverageResultV1,
  ReleasePackageBriefV1,
  RoadmapAssignmentV1,
} from "@foreman/policy";
import {
  runReleaseCoverageCli,
  type ReleaseCoverageCliIo,
  type ReleaseCoverageCliServices,
  type ReleaseCoverageFamilySourceService,
  type ReleaseCoverageFileReadService,
  type ReleaseCoverageGitChangedPathsService,
  type ReleaseCoverageOpenSpecListService,
} from "./index.js";

const ONE_MIB = 1_048_576;
const EXIT_OK = 0;
const EXIT_EVALUATED = 1;
const EXIT_USAGE = 64;
const USAGE_DIAGNOSTIC = "release-coverage: invalid invocation\n";

const TRACK1 = "openspec-superpowers-convergence";
const PACKAGE = "project-registry";
const CHILD_ID = "v040-t2-project-registry";
const ROADMAP_KEY = "roadmap:sprint-6-project-registry";
const SECOND_PACKAGE = "external-memory-index";
const SECOND_CHILD_ID = "v040-t3-memory-index";
const SECOND_ROADMAP_KEY = "roadmap:v040-external-memory-index";

const FIXTURE_ROOT = resolve("release-coverage-cli-fixtures");
const REPO = join(FIXTURE_ROOT, "repo");
const STATE_ROOT = join(FIXTURE_ROOT, "state");
/** Absolute register path outside the repository root — bootstrap must not infer repo from it. */
const REGISTER = join(FIXTURE_ROOT, "register-host", "coverage.toml");
const SCRIPT = join(FIXTURE_ROOT, "release-coverage.js");

const CONTRACT_ID = "v040-release-20260822-r3";
const CONTRACT_SHA =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FAMILY_SHA =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BASELINE = "bb5c8c2345ac5524ebb9c6a7de0fe16b17242195";

const ROADMAP_ABS = join(REPO, "ROADMAP.md");
const TRACK1_WORKFLOW_ABS = join(
  REPO,
  "openspec",
  "changes",
  TRACK1,
  ".openspec.yaml",
);
const PACKAGE_WORKFLOW_ABS = join(
  REPO,
  "openspec",
  "changes",
  PACKAGE,
  ".openspec.yaml",
);
const SECOND_PACKAGE_WORKFLOW_ABS = join(
  REPO,
  "openspec",
  "changes",
  SECOND_PACKAGE,
  ".openspec.yaml",
);
const PACKAGE_BRIEF_ABS = join(
  REPO,
  "openspec",
  "changes",
  PACKAGE,
  "release-brief.json",
);
const SECOND_PACKAGE_BRIEF_ABS = join(
  REPO,
  "openspec",
  "changes",
  SECOND_PACKAGE,
  "release-brief.json",
);
const TRACK1_BRIEF_ABS = join(
  REPO,
  "openspec",
  "changes",
  TRACK1,
  "release-brief.json",
);
const BRIEF_REL = `openspec/changes/${PACKAGE}/release-brief.json`;

const SECRET = join(FIXTURE_ROOT, "secret", "private", "path");

const SOURCE_REPO = resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

const BOOTSTRAP_TAIL = [
  "check",
  "--program",
  "v040",
  "--phase",
  "bootstrap",
  "--owner",
  TRACK1,
  "--register",
  REGISTER,
] as const;

const LANE_TAIL = [
  "check",
  "--program",
  "v040",
  "--phase",
  "lane",
  "--owner",
  PACKAGE,
  "--repo",
  REPO,
  "--state-root",
  STATE_ROOT,
  "--contract-id",
  CONTRACT_ID,
  "--contract-sha",
  CONTRACT_SHA,
  "--family-sha",
  FAMILY_SHA,
  "--register",
  REGISTER,
] as const;

const RELEASE_TAIL = [
  "check",
  "--program",
  "v040",
  "--phase",
  "release",
  "--repo",
  REPO,
  "--state-root",
  STATE_ROOT,
  "--contract-id",
  CONTRACT_ID,
  "--contract-sha",
  CONTRACT_SHA,
  "--family-sha",
  FAMILY_SHA,
  "--register",
  REGISTER,
] as const;

function processArgv(tail: readonly string[]): string[] {
  return [process.execPath, SCRIPT, ...tail];
}

const BOOTSTRAP_ARGV = processArgv(BOOTSTRAP_TAIL);
const LANE_ARGV = processArgv(LANE_TAIL);
const RELEASE_ARGV = processArgv(RELEASE_TAIL);

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function inventorySha(names: readonly string[]): string {
  const sorted = [...names].sort((a, b) => {
    const ab = utf8(a);
    const bb = utf8(b);
    const n = Math.min(ab.length, bb.length);
    for (let i = 0; i < n; i++) {
      if (ab[i] !== bb[i]) return ab[i]! - bb[i]!;
    }
    return ab.length - bb.length;
  });
  return sha256Hex(utf8(sorted.map((n) => `${n}\n`).join("")));
}

function roadmapRows(): readonly RoadmapAssignmentV1[] {
  return [
    {
      key: ROADMAP_KEY,
      scope: "Sprint 6 project registry",
      release: "v0.4",
      owner: PACKAGE,
    },
  ];
}

function roadmapText(crlf = false): string {
  const nl = crlf ? "\r\n" : "\n";
  const rows = roadmapRows()
    .map(
      (r) =>
        `| \`${r.key}\` | ${r.scope} | \`${r.release}\` | \`${r.owner}\` |`,
    )
    .join(nl);
  return [
    "| Coverage key | Scope | Release | Owner |",
    "|---|---|---|---|",
    rows,
    "",
  ].join(nl);
}

function twoOwnerRoadmapText(): string {
  return [
    "| Coverage key | Scope | Release | Owner |",
    "|---|---|---|---|",
    `| \`${ROADMAP_KEY}\` | Sprint 6 project registry | \`v0.4\` | \`${PACKAGE}\` |`,
    `| \`${SECOND_ROADMAP_KEY}\` | External MemoryIndex, epochs, and live-service tests | \`v0.4\` | \`${SECOND_PACKAGE}\` |`,
    "",
  ].join("\n");
}

function openspecListBytes(names: readonly string[]): Uint8Array {
  return utf8(
    JSON.stringify({
      changes: names.map((name) => ({ name })),
    }),
  );
}

function deriveBrief(
  child: {
    readonly childId: string;
    readonly packageId: string;
    readonly objective: string;
    readonly acceptance: readonly string[];
    readonly allowedPaths: readonly string[];
  },
  familySha256: string = FAMILY_SHA,
): ReleasePackageBriefV1 {
  return {
    schema: "foreman.release-package-brief.v1",
    familySha256,
    childId: child.childId,
    packageId: child.packageId,
    objective: child.objective,
    acceptance: child.acceptance,
    allowedPaths: child.allowedPaths,
  };
}

const FAMILY_CHILDREN = [
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t2-project-registry",
    tranche: 2,
    packageId: "project-registry",
    dependencyChildIds: [],
    objective: "Ship the project registry lane.",
    acceptance: ["Registry resolves stable project identity."],
    allowedPaths: ["packages/orchestration/**", "packages/policy/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t3-memory-index",
    tranche: 3,
    packageId: "external-memory-index",
    dependencyChildIds: ["v040-t2-project-registry"],
    objective: "Ship the external memory index lane.",
    acceptance: ["The memory index uses stable project identity."],
    allowedPaths: ["packages/memory/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t4-appliance",
    tranche: 4,
    packageId: "hermetic-foreman-appliance",
    dependencyChildIds: [],
    objective: "Ship the hermetic Foreman appliance.",
    acceptance: ["The appliance bootstrap is reproducible."],
    allowedPaths: ["containers/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t5-graphify",
    tranche: 5,
    packageId: "knowledge-plane-refresh",
    dependencyChildIds: [],
    objective: "Ship the knowledge-plane refresh.",
    acceptance: ["Graph metadata is immutable."],
    allowedPaths: ["packages/knowledge/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t6-work-dag",
    tranche: 6,
    packageId: "work-dag-projection",
    dependencyChildIds: ["v040-t5-graphify"],
    objective: "Ship the work DAG projection.",
    acceptance: ["Work lineage is deterministic."],
    allowedPaths: ["packages/work-dag/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t7-context",
    tranche: 7,
    packageId: "graph-context-builder",
    dependencyChildIds: ["v040-t6-work-dag"],
    objective: "Ship the graph context builder.",
    acceptance: ["Context packs are bounded and cited."],
    allowedPaths: ["packages/context/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t8-evaluation",
    tranche: 8,
    packageId: "graph-eval-falsification",
    dependencyChildIds: [
      "v040-t3-memory-index",
      "v040-t4-appliance",
      "v040-t7-context",
    ],
    objective: "Ship the graph evaluation lane.",
    acceptance: ["Evaluation uses the locked four-arm design."],
    allowedPaths: ["packages/evaluation/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t9-release",
    tranche: 9,
    packageId: "v040-release-program",
    dependencyChildIds: [
      "v040-t2-project-registry",
      "v040-t3-memory-index",
      "v040-t4-appliance",
      "v040-t5-graphify",
      "v040-t6-work-dag",
      "v040-t7-context",
      "v040-t8-evaluation",
    ],
    objective: "Ship the v0.4 release program.",
    acceptance: ["Publication uses the exact admitted candidate."],
    allowedPaths: ["docs/releases/**"],
  },
] as const satisfies readonly FamilyChild[];

const FAMILY_CHILD = FAMILY_CHILDREN[0]!;
const SECOND_FAMILY_CHILD = FAMILY_CHILDREN[1]!;

const FAMILY_SOURCE = {
  schema: "foreman.execution-family-source.v1",
  program: "v040",
  familyId: "v040-release-20260822-f1",
  children: FAMILY_CHILDREN,
} as const satisfies FamilySource;

function briefFileBytes(brief: ReleasePackageBriefV1): Uint8Array {
  return utf8(`${canonicalize(brief)}\n`);
}

function sealRegister(input: {
  readonly activeNames: readonly string[];
  readonly roadmapBytes: Uint8Array;
  readonly packageReconcile?: "complete" | "required";
  readonly track1TargetRelease?: "v0.4" | "released";
  readonly track1Disposition?: "v040_owner" | "released_reference";
  readonly extraEntry?: string;
  readonly mutate?: (text: string) => string;
}): string {
  const inv = inventorySha(input.activeNames);
  const road = sha256Hex(input.roadmapBytes);
  const packageReconcile = input.packageReconcile ?? "required";
  const track1Target = input.track1TargetRelease ?? "v0.4";
  const track1Disposition = input.track1Disposition ?? "v040_owner";
  let text = [
    `schema_version = 1`,
    `baseline_commit = "${BASELINE}"`,
    `active_inventory_sha256 = "${inv}"`,
    `roadmap_sha256 = "${road}"`,
    ``,
    `[[future_owner]]`,
    `name = "${PACKAGE}"`,
    `target_release = "v0.4"`,
    `reason = "Track 2 owns stable project identity and store resolution."`,
    ``,
    `[[entry]]`,
    `key = "change:${TRACK1}"`,
    `source_kind = "openspec_change"`,
    `source_path = "openspec/changes/${TRACK1}"`,
    `disposition = "${track1Disposition}"`,
    `owner = "${TRACK1}"`,
    `target_release = "${track1Target}"`,
    `reconcile = "complete"`,
    `reason = "track1 complete"`,
    ``,
    `[[entry]]`,
    `key = "${ROADMAP_KEY}"`,
    `source_kind = "roadmap"`,
    `source_path = "ROADMAP.md"`,
    `disposition = "v040_owner"`,
    `owner = "${PACKAGE}"`,
    `target_release = "v0.4"`,
    `reconcile = "${packageReconcile}"`,
    `reason = "Sprint 6 project identity moves to focused Track 2."`,
  ].join("\n");
  if (input.extraEntry) text += `\n${input.extraEntry}`;
  if (input.mutate) text = input.mutate(text);
  return text;
}

type CallLog = {
  readonly openspec: Array<{
    repository: string;
    argv: readonly ["list", "--json"];
    maxBytes: number;
  }>;
  readonly git: Array<{ repository: string; baselineCommit: string }>;
  readonly family: Array<{
    stateRoot: string;
    contractId: string;
    contractSha256: string;
    familySha256: string;
  }>;
  readonly fileReads: Array<{ path: string; maxBytes: number }>;
  repositoryRootResolves: number;
};

type ByteSnapshot = ReadonlyMap<string, Uint8Array>;

type Capture = {
  stdout: string;
  stderr: string;
  log: CallLog;
  snapshotBefore: ByteSnapshot;
  snapshotAfter: ByteSnapshot;
  repoStateBytes: Map<string, Uint8Array>;
};

type FamilyChild = {
  readonly schema: "foreman.execution-child-brief.v1";
  readonly childId: string;
  readonly tranche: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly packageId: string;
  readonly dependencyChildIds: readonly string[];
  readonly objective: string;
  readonly acceptance: readonly string[];
  readonly allowedPaths: readonly string[];
};

type FamilySource = {
  readonly schema: "foreman.execution-family-source.v1";
  readonly program: "v040";
  readonly familyId: "v040-release-20260822-f1";
  readonly children: readonly FamilyChild[];
};

type FamilyResult = {
  readonly stateRoot: string;
  readonly contractId: string;
  readonly contractSha256: string;
  readonly familySha256: string;
  readonly source: FamilySource;
};

type HarnessOptions = {
  readonly registerText?: string;
  readonly roadmapBytes?: Uint8Array;
  readonly activeNames?: readonly string[];
  readonly changedPaths?: readonly string[];
  readonly workflowByOwner?: Readonly<Record<string, string>>;
  readonly briefBytesByAbsPath?: ReadonlyMap<string, Uint8Array>;
  readonly familyResult?: FamilyResult;
  readonly familyError?: Error;
  readonly familyThrow?: boolean;
  readonly openspecBytes?: Uint8Array;
  readonly openspecError?: Error;
  readonly openspecThrow?: boolean;
  readonly gitError?: Error;
  readonly gitThrow?: boolean;
  readonly fileErrorByPath?: ReadonlyMap<string, Error>;
  readonly fileNotFoundPath?: string;
  readonly fileThrowPath?: string;
  readonly repositoryRoot?: string;
  readonly repositoryRootError?: Error;
  readonly repositoryRootThrow?: boolean;
  readonly packageReconcile?: "complete" | "required";
  readonly releaseTrack1Settled?: boolean;
};

function cloneBytes(map: Map<string, Uint8Array>): ByteSnapshot {
  const out = new Map<string, Uint8Array>();
  for (const [key, value] of map) {
    out.set(key, Uint8Array.from(value));
  }
  return out;
}

function snapshotsEqual(a: ByteSnapshot, b: ByteSnapshot): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (other === undefined || other.byteLength !== value.byteLength) {
      return false;
    }
    for (let i = 0; i < value.byteLength; i++) {
      if (value[i] !== other[i]) return false;
    }
  }
  return true;
}

function snapshotPhysicalTree(root: string): ReadonlyMap<string, string> {
  const snapshot = new Map<string, string>();
  const visit = (directory: string, relativeDirectory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      Buffer.from(a.name).compare(Buffer.from(b.name)),
    );
    for (const entry of entries) {
      if (relativeDirectory.length === 0 && entry.name === ".git") continue;
      const absolute = join(directory, entry.name);
      const relativePath = relativeDirectory.length === 0
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        snapshot.set(
          `symlink:${relativePath}`,
          `${stat.mode}:${readlinkSync(absolute)}`,
        );
      } else if (stat.isDirectory()) {
        snapshot.set(`directory:${relativePath}`, `${stat.mode}`);
        visit(absolute, relativePath);
      } else if (stat.isFile()) {
        const bytes = readFileSync(absolute);
        snapshot.set(
          `file:${relativePath}`,
          `${stat.mode}:${bytes.byteLength}:${sha256Hex(bytes)}`,
        );
      } else {
        snapshot.set(`other:${relativePath}`, `${stat.mode}`);
      }
    }
  };
  visit(root, "");
  return snapshot;
}

function emptyLog(): CallLog {
  return {
    openspec: [],
    git: [],
    family: [],
    fileReads: [],
    repositoryRootResolves: 0,
  };
}

function makeIo(capture: Capture): ReleaseCoverageCliIo {
  return {
    writeStdout: (text: string) => {
      capture.stdout += text;
    },
    writeStderr: (text: string) => {
      capture.stderr += text;
    },
  };
}

function makeServices(
  capture: Capture,
  options: HarnessOptions = {},
): ReleaseCoverageCliServices {
  const roadmapBytes = options.roadmapBytes ?? utf8(roadmapText(false));
  const activeNames = options.activeNames ?? [TRACK1];
  const releaseTrack1Settled = options.releaseTrack1Settled === true;
  const registerText =
    options.registerText ??
    sealRegister({
      activeNames,
      roadmapBytes,
      packageReconcile: options.packageReconcile ?? "required",
      track1TargetRelease: releaseTrack1Settled ? "released" : "v0.4",
      track1Disposition: releaseTrack1Settled
        ? "released_reference"
        : "v040_owner",
    });
  const brief = deriveBrief(FAMILY_CHILD);
  const briefBytes = briefFileBytes(brief);
  const workflowByOwner = options.workflowByOwner ?? {
    [TRACK1]: "foreman-architectural",
    [PACKAGE]: "foreman-bounded",
  };
  const briefBytesByAbsPath =
    options.briefBytesByAbsPath ??
    new Map<string, Uint8Array>([[PACKAGE_BRIEF_ABS, briefBytes]]);
  const familyResult: FamilyResult = options.familyResult ?? {
    stateRoot: STATE_ROOT,
    contractId: CONTRACT_ID,
    contractSha256: CONTRACT_SHA,
    familySha256: FAMILY_SHA,
    source: FAMILY_SOURCE,
  };

  const files = new Map<string, Uint8Array>([
    [REGISTER, utf8(registerText)],
    [ROADMAP_ABS, roadmapBytes],
    [TRACK1_WORKFLOW_ABS, utf8(`schema: ${workflowByOwner[TRACK1]}\n`)],
    [PACKAGE_WORKFLOW_ABS, utf8(`schema: ${workflowByOwner[PACKAGE]}\n`)],
    ...briefBytesByAbsPath.entries(),
  ]);
  for (const [owner, schema] of Object.entries(workflowByOwner)) {
    files.set(
      join(REPO, "openspec", "changes", owner, ".openspec.yaml"),
      utf8(`schema: ${schema}\n`),
    );
  }

  // Durable byte image of repository + state material the CLI may touch.
  capture.repoStateBytes = new Map([
    ...files.entries(),
    [join(STATE_ROOT, ".keep"), utf8("state")],
  ]);
  capture.snapshotBefore = cloneBytes(capture.repoStateBytes);

  const fileErrors = options.fileErrorByPath ?? new Map<string, Error>();

  const fileRead: ReleaseCoverageFileReadService = {
    resolveRepositoryRoot: () => {
      capture.log.repositoryRootResolves += 1;
      if (options.repositoryRootThrow) {
        throw new Error(`root boom at ${SECRET}/root`);
      }
      if (options.repositoryRootError) {
        return Effect.fail(options.repositoryRootError);
      }
      return Effect.succeed(options.repositoryRoot ?? REPO);
    },
    readBounded: (input) => {
      capture.log.fileReads.push({
        path: input.path,
        maxBytes: input.maxBytes,
      });
      assert.equal(input.maxBytes, ONE_MIB);
      if (options.fileThrowPath === input.path) {
        throw new Error(`ENOENT: ${SECRET}/${input.path}`);
      }
      if (options.fileNotFoundPath === input.path) {
        return Effect.fail({ _tag: "NotFound" as const });
      }
      const mapped = fileErrors.get(input.path);
      if (mapped) return Effect.fail(mapped);
      const bytes = capture.repoStateBytes.get(input.path);
      if (bytes === undefined) {
        return Effect.fail(new Error(`missing:${input.path}`));
      }
      if (bytes.byteLength > input.maxBytes) {
        return Effect.fail(new Error("oversize"));
      }
      return Effect.succeed(Uint8Array.from(bytes));
    },
  };

  const openspecList: ReleaseCoverageOpenSpecListService = {
    listJson: (input) => {
      capture.log.openspec.push({
        repository: input.repository,
        argv: input.argv,
        maxBytes: input.maxBytes,
      });
      assert.deepEqual(input.argv, ["list", "--json"]);
      if (options.openspecThrow) {
        throw new Error(`openspec boom at ${SECRET}/list`);
      }
      if (options.openspecError) return Effect.fail(options.openspecError);
      assert.equal(input.maxBytes, ONE_MIB);
      return Effect.succeed(
        options.openspecBytes ?? openspecListBytes(activeNames),
      );
    },
  };

  const gitChangedPaths: ReleaseCoverageGitChangedPathsService = {
    discover: (input) => {
      capture.log.git.push({
        repository: input.repository,
        baselineCommit: input.baselineCommit,
      });
      if (options.gitThrow) {
        throw new Error(`git boom at ${SECRET}/git`);
      }
      if (options.gitError) return Effect.fail(options.gitError);
      return Effect.succeed(options.changedPaths ?? []);
    },
  };

  const familySource: ReleaseCoverageFamilySourceService = {
    resolve: (input) => {
      capture.log.family.push({ ...input });
      if (options.familyThrow) {
        throw new Error(`ledger boom at ${SECRET}/family`);
      }
      if (options.familyError) return Effect.fail(options.familyError);
      return Effect.succeed(familyResult);
    },
  };

  const services = {
    fileRead,
    openspecList,
    gitChangedPaths,
    familySource,
  } as const satisfies ReleaseCoverageCliServices;

  return services;
}

async function runCli(
  argv: ReadonlyArray<string>,
  options: HarnessOptions = {},
): Promise<{ exitCode: number; capture: Capture }> {
  const capture: Capture = {
    stdout: "",
    stderr: "",
    log: emptyLog(),
    snapshotBefore: new Map(),
    snapshotAfter: new Map(),
    repoStateBytes: new Map(),
  };
  const services = makeServices(capture, options);
  const program: Effect.Effect<number, never> = runReleaseCoverageCli(
    argv,
    makeIo(capture),
    services,
  );
  const exitCode = await Effect.runPromise(program);
  capture.snapshotAfter = cloneBytes(capture.repoStateBytes);
  return { exitCode, capture };
}

function assertCanonicalResult(
  capture: Capture,
  value: ReleaseCoverageResultV1,
): void {
  assert.equal(capture.stderr, "");
  assert.equal(capture.stdout, `${canonicalize(value)}\n`);
}

function assertUsageFailure(capture: Capture, log: CallLog): void {
  assert.equal(capture.stdout, "");
  assert.equal(capture.stderr, USAGE_DIAGNOSTIC);
  assert.deepEqual(log.openspec, []);
  assert.deepEqual(log.git, []);
  assert.deepEqual(log.family, []);
  assert.deepEqual(log.fileReads, []);
  assert.equal(log.repositoryRootResolves, 0);
}

function assertSanitized(capture: Capture): void {
  const combined = `${capture.stdout}${capture.stderr}`;
  assert.equal(combined.includes(SECRET), false);
  assert.equal(combined.includes("ENOENT"), false);
  assert.equal(combined.includes("boom"), false);
}

function assertNoEscapeReads(log: CallLog): void {
  for (const read of log.fileReads) {
    if (read.path === REGISTER) continue;
    const rel = relative(REPO, read.path);
    assert.equal(isAbsolute(rel), false);
    assert.notEqual(rel, "..");
    assert.equal(rel.startsWith(`..${sep}`), false);
  }
}

function assertUnchangedSnapshot(capture: Capture): void {
  assert.equal(snapshotsEqual(capture.snapshotBefore, capture.snapshotAfter), true);
}

function validResult(
  activeNames: readonly string[],
  roadmapBytes: Uint8Array,
  entryCount: number,
): ReleaseCoverageResultV1 {
  return {
    schemaVersion: 1,
    _tag: "Valid",
    activeInventorySha256: inventorySha(activeNames),
    roadmapSha256: sha256Hex(roadmapBytes),
    entryCount,
  };
}

function invalidResult(
  reason: ReleaseCoverageFailureReason,
): ReleaseCoverageResultV1 {
  return {
    schemaVersion: 1,
    _tag: "Invalid",
    reason,
  };
}

function parseValidStdout(stdout: string): {
  readonly activeInventorySha256: string;
  readonly roadmapSha256: string;
} {
  const parsed = JSON.parse(stdout.trim()) as ReleaseCoverageResultV1;
  assert.equal(parsed._tag, "Valid");
  if (parsed._tag !== "Valid") {
    throw new Error("expected Valid");
  }
  assert.match(parsed.activeInventorySha256, /^[a-f0-9]{64}$/);
  assert.match(parsed.roadmapSha256, /^[a-f0-9]{64}$/);
  assert.equal(parsed.activeInventorySha256 === parsed.activeInventorySha256.toLowerCase(), true);
  assert.equal(parsed.roadmapSha256 === parsed.roadmapSha256.toLowerCase(), true);
  return parsed;
}

function serviceKeys(services: ReleaseCoverageCliServices): string[] {
  return Object.keys(services).sort();
}

// ---------------------------------------------------------------------------
// Shared valid fixture helpers for table groups
// ---------------------------------------------------------------------------

const SHARED_ROADMAP_BYTES = utf8(roadmapText(false));
const SHARED_ACTIVE = [TRACK1] as const;

function sharedBootstrapOptions(
  overrides: HarnessOptions = {},
): HarnessOptions {
  return {
    roadmapBytes: SHARED_ROADMAP_BYTES,
    activeNames: SHARED_ACTIVE,
    packageReconcile: "required",
    ...overrides,
  };
}

function sharedLaneOptions(overrides: HarnessOptions = {}): HarnessOptions {
  return sharedBootstrapOptions({
    packageReconcile: "complete",
    ...overrides,
  });
}

function sharedReleaseOptions(overrides: HarnessOptions = {}): HarnessOptions {
  return sharedLaneOptions({
    releaseTrack1Settled: true,
    ...overrides,
  });
}

function registeredFamilyResult(
  overrides: Partial<Omit<FamilyResult, "source">> = {},
): FamilyResult {
  return {
    stateRoot: STATE_ROOT,
    contractId: CONTRACT_ID,
    contractSha256: CONTRACT_SHA,
    familySha256: FAMILY_SHA,
    source: FAMILY_SOURCE,
    ...overrides,
  };
}

function familyResultWithChild(
  mutate: (child: FamilyChild) => FamilyChild,
): FamilyResult {
  return {
    ...registeredFamilyResult(),
    source: {
      ...FAMILY_SOURCE,
      children: FAMILY_SOURCE.children.map((child) =>
        child.packageId === PACKAGE ? mutate(child) : child,
      ),
    },
  };
}

function normalizedRepositoryRelative(path: string): string {
  return relative(REPO, path).split(sep).join("/");
}

function twoOwnerReleaseOptions(): HarnessOptions {
  const roadmapBytes = utf8(twoOwnerRoadmapText());
  const base = sealRegister({
    activeNames: SHARED_ACTIVE,
    roadmapBytes,
    packageReconcile: "complete",
    track1TargetRelease: "released",
    track1Disposition: "released_reference",
  });
  const registerText = `${base}\n\n[[future_owner]]\nname = "${SECOND_PACKAGE}"\ntarget_release = "v0.4"\nreason = "Track 3 owns the external MemoryIndex."\n\n[[entry]]\nkey = "${SECOND_ROADMAP_KEY}"\nsource_kind = "roadmap"\nsource_path = "ROADMAP.md"\ndisposition = "v040_owner"\nowner = "${SECOND_PACKAGE}"\ntarget_release = "v0.4"\nreconcile = "complete"\nreason = "Track 3 is complete."`;
  return sharedReleaseOptions({
    roadmapBytes,
    registerText,
    workflowByOwner: {
      [TRACK1]: "foreman-architectural",
      [PACKAGE]: "foreman-bounded",
      [SECOND_PACKAGE]: "foreman-bounded",
    },
    briefBytesByAbsPath: new Map([
      [PACKAGE_BRIEF_ABS, briefFileBytes(deriveBrief(FAMILY_CHILD))],
      [
        SECOND_PACKAGE_BRIEF_ABS,
        briefFileBytes(deriveBrief(SECOND_FAMILY_CHILD)),
      ],
    ]),
  });
}

// ---------------------------------------------------------------------------
// 1. Public argv and invocation
// ---------------------------------------------------------------------------

test("public argv tails match design.md and process framing strips to those tails", async (t) => {
  const cases: ReadonlyArray<{
    name: string;
    argv: readonly string[];
    tail: readonly string[];
  }> = [
    { name: "bootstrap", argv: BOOTSTRAP_ARGV, tail: BOOTSTRAP_TAIL },
    { name: "lane", argv: LANE_ARGV, tail: LANE_TAIL },
    { name: "release", argv: RELEASE_ARGV, tail: RELEASE_TAIL },
  ];

  for (const { name, argv, tail } of cases) {
    await t.test(name, () => {
      assert.deepEqual(argv.slice(0, 2), [process.execPath, SCRIPT]);
      assert.deepEqual(argv.slice(2), [...tail]);
      assert.equal(tail[0], "check");
    });
  }
});

const USAGE_CASES: ReadonlyArray<{
  name: string;
  argv: readonly string[];
}> = [
  { name: "missing", argv: processArgv(["check"]) },
  {
    name: "extra",
    argv: processArgv([...BOOTSTRAP_TAIL, "--unexpected", "x"]),
  },
  {
    name: "duplicate-register",
    argv: processArgv([...BOOTSTRAP_TAIL, "--register", REGISTER]),
  },
  {
    name: "reordered-check-after-flags",
    argv: processArgv([
      "--program",
      "v040",
      "check",
      "--phase",
      "bootstrap",
      "--owner",
      TRACK1,
      "--register",
      REGISTER,
    ]),
  },
  {
    name: "phase-forbidden-bootstrap-family-flags",
    argv: processArgv([
      ...BOOTSTRAP_TAIL,
      "--repo",
      REPO,
      "--state-root",
      STATE_ROOT,
      "--contract-id",
      CONTRACT_ID,
      "--contract-sha",
      CONTRACT_SHA,
      "--family-sha",
      FAMILY_SHA,
    ]),
  },
  {
    name: "phase-forbidden-release-owner",
    argv: processArgv([...RELEASE_TAIL, "--owner", PACKAGE]),
  },
  {
    name: "relative-register",
    argv: processArgv([
      "check",
      "--program",
      "v040",
      "--phase",
      "bootstrap",
      "--owner",
      TRACK1,
      "--register",
      "openspec/changes/v040-release-program/coverage.toml",
    ]),
  },
  {
    name: "relative-repo",
    argv: processArgv([
      "check",
      "--program",
      "v040",
      "--phase",
      "lane",
      "--owner",
      PACKAGE,
      "--repo",
      "rel-repo",
      "--state-root",
      STATE_ROOT,
      "--contract-id",
      CONTRACT_ID,
      "--contract-sha",
      CONTRACT_SHA,
      "--family-sha",
      FAMILY_SHA,
      "--register",
      REGISTER,
    ]),
  },
  {
    name: "relative-state-root",
    argv: processArgv([
      "check",
      "--program",
      "v040",
      "--phase",
      "lane",
      "--owner",
      PACKAGE,
      "--repo",
      REPO,
      "--state-root",
      "rel-state",
      "--contract-id",
      CONTRACT_ID,
      "--contract-sha",
      CONTRACT_SHA,
      "--family-sha",
      FAMILY_SHA,
      "--register",
      REGISTER,
    ]),
  },
  {
    name: "malformed-owner",
    argv: processArgv([
      "check",
      "--program",
      "v040",
      "--phase",
      "lane",
      "--owner",
      "bad/owner",
      "--repo",
      REPO,
      "--state-root",
      STATE_ROOT,
      "--contract-id",
      CONTRACT_ID,
      "--contract-sha",
      CONTRACT_SHA,
      "--family-sha",
      FAMILY_SHA,
      "--register",
      REGISTER,
    ]),
  },
  {
    name: "malformed-contract-id",
    argv: processArgv([
      "check",
      "--program",
      "v040",
      "--phase",
      "lane",
      "--owner",
      PACKAGE,
      "--repo",
      REPO,
      "--state-root",
      STATE_ROOT,
      "--contract-id",
      "bad/id",
      "--contract-sha",
      CONTRACT_SHA,
      "--family-sha",
      FAMILY_SHA,
      "--register",
      REGISTER,
    ]),
  },
  {
    name: "uppercase-digest",
    argv: processArgv([
      "check",
      "--program",
      "v040",
      "--phase",
      "lane",
      "--owner",
      PACKAGE,
      "--repo",
      REPO,
      "--state-root",
      STATE_ROOT,
      "--contract-id",
      CONTRACT_ID,
      "--contract-sha",
      CONTRACT_SHA.toUpperCase(),
      "--family-sha",
      FAMILY_SHA,
      "--register",
      REGISTER,
    ]),
  },
  {
    name: "wrong-length-digest",
    argv: processArgv([
      "check",
      "--program",
      "v040",
      "--phase",
      "lane",
      "--owner",
      PACKAGE,
      "--repo",
      REPO,
      "--state-root",
      STATE_ROOT,
      "--contract-id",
      CONTRACT_ID,
      "--contract-sha",
      "abcd",
      "--family-sha",
      FAMILY_SHA,
      "--register",
      REGISTER,
    ]),
  },
  {
    name: "wrong-program",
    argv: processArgv([
      "check",
      "--program",
      "v039",
      "--phase",
      "bootstrap",
      "--owner",
      TRACK1,
      "--register",
      REGISTER,
    ]),
  },
  {
    name: "bootstrap-wrong-owner",
    argv: processArgv([
      "check",
      "--program",
      "v040",
      "--phase",
      "bootstrap",
      "--owner",
      PACKAGE,
      "--register",
      REGISTER,
    ]),
  },
  {
    name: "positional-extra",
    argv: processArgv([...BOOTSTRAP_TAIL, "extra-positional"]),
  },
];

test("invalid invocations exit 64 with fixed diagnostic and zero service calls", async (t) => {
  for (const { name, argv } of USAGE_CASES) {
    await t.test(name, async () => {
      const { exitCode, capture } = await runCli(argv);
      assert.equal(exitCode, EXIT_USAGE);
      assertUsageFailure(capture, capture.log);
      assertSanitized(capture);
    });
  }
});

test("legal flag-value pairs can reorder after check in every phase", async (t) => {
  const cases: ReadonlyArray<{
    name: string;
    argv: readonly string[];
    options: HarnessOptions;
  }> = [
    {
      name: "bootstrap",
      argv: processArgv([
        "check",
        "--register",
        REGISTER,
        "--owner",
        TRACK1,
        "--phase",
        "bootstrap",
        "--program",
        "v040",
      ]),
      options: sharedBootstrapOptions(),
    },
    {
      name: "lane",
      argv: processArgv([
        "check",
        "--family-sha",
        FAMILY_SHA,
        "--register",
        REGISTER,
        "--owner",
        PACKAGE,
        "--contract-id",
        CONTRACT_ID,
        "--repo",
        REPO,
        "--phase",
        "lane",
        "--contract-sha",
        CONTRACT_SHA,
        "--state-root",
        STATE_ROOT,
        "--program",
        "v040",
      ]),
      options: sharedLaneOptions(),
    },
    {
      name: "release",
      argv: processArgv([
        "check",
        "--family-sha",
        FAMILY_SHA,
        "--register",
        REGISTER,
        "--contract-id",
        CONTRACT_ID,
        "--repo",
        REPO,
        "--phase",
        "release",
        "--contract-sha",
        CONTRACT_SHA,
        "--state-root",
        STATE_ROOT,
        "--program",
        "v040",
      ]),
      options: sharedReleaseOptions(),
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const { exitCode, capture } = await runCli(item.argv, item.options);
      assert.equal(exitCode, EXIT_OK);
      assertCanonicalResult(
        capture,
        validResult(SHARED_ACTIVE, SHARED_ROADMAP_BYTES, 2),
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Bootstrap assembly
// ---------------------------------------------------------------------------

test("bootstrap assembly uses sealed Track-1 fixture and injected repository root", async (t) => {
  await t.test("one bounded openspec list --json with raw changes shape", async () => {
    const { exitCode, capture } = await runCli(
      BOOTSTRAP_ARGV,
      sharedBootstrapOptions(),
    );
    assert.equal(exitCode, EXIT_OK);
    assert.equal(capture.log.openspec.length, 1);
    assert.deepEqual(capture.log.openspec[0], {
      repository: REPO,
      argv: ["list", "--json"],
      maxBytes: ONE_MIB,
    });
    assert.equal(capture.log.family.length, 0);
    assert.equal(
      capture.log.fileReads.some((r) => r.path.endsWith("release-brief.json")),
      false,
    );
    assert.ok(capture.log.repositoryRootResolves >= 1);
    assert.equal(
      capture.log.fileReads.some((r) => r.path === REGISTER),
      true,
    );
    assert.equal(
      capture.log.fileReads.some((r) => r.path === ROADMAP_ABS),
      true,
    );
    for (const read of capture.log.fileReads) {
      assert.equal(read.maxBytes, ONE_MIB);
    }
    assertCanonicalResult(
      capture,
      validResult(SHARED_ACTIVE, SHARED_ROADMAP_BYTES, 2),
    );
    parseValidStdout(capture.stdout);
    assertUnchangedSnapshot(capture);
  });

  await t.test("raw CRLF Roadmap bytes are unchanged and hash differs after LF normalization", async () => {
    const crlf = utf8(roadmapText(true));
    assert.ok(crlf.includes(13));
    const lf = utf8(roadmapText(false));
    assert.notEqual(sha256Hex(crlf), sha256Hex(lf));
    const registerText = sealRegister({
      activeNames: SHARED_ACTIVE,
      roadmapBytes: crlf,
    });
    const { exitCode, capture } = await runCli(
      BOOTSTRAP_ARGV,
      sharedBootstrapOptions({
        roadmapBytes: crlf,
        registerText,
      }),
    );
    assert.equal(exitCode, EXIT_OK);
    const roadmapReads = capture.log.fileReads.filter(
      (r) => r.path === ROADMAP_ABS,
    );
    assert.equal(roadmapReads.length, 1);
    assert.deepEqual(capture.repoStateBytes.get(ROADMAP_ABS), crlf);
    assertCanonicalResult(capture, validResult(SHARED_ACTIVE, crlf, 2));
  });

  await t.test("valid UTF-8 with a non-authoritative Roadmap header is invalid_roadmap", async () => {
    const bytes = utf8(
      roadmapText(false).replace(
        "| Coverage key | Scope | Release | Owner |",
        "| Key | Scope | Release | Owner |",
      ),
    );
    const { exitCode, capture } = await runCli(
      BOOTSTRAP_ARGV,
      sharedBootstrapOptions({
        roadmapBytes: bytes,
        registerText: sealRegister({
          activeNames: SHARED_ACTIVE,
          roadmapBytes: bytes,
        }),
      }),
    );
    assert.equal(exitCode, EXIT_EVALUATED);
    assertCanonicalResult(capture, invalidResult("invalid_roadmap"));
  });

  await t.test("malformed OpenSpec JSON and shape are dependency_failure", async (nested) => {
    for (const [name, openspecBytes] of [
      ["malformed-json", utf8("{not-json")],
      ["wrong-shape", utf8('{"changes":[{"id":"wrong-field"}]}')],
    ] as const) {
      await nested.test(name, async () => {
        const { exitCode, capture } = await runCli(
          BOOTSTRAP_ARGV,
          sharedBootstrapOptions({ openspecBytes }),
        );
        assert.equal(exitCode, EXIT_EVALUATED);
        assertCanonicalResult(capture, invalidResult("dependency_failure"));
        assertSanitized(capture);
      });
    }
  });

  await t.test("git receives repository plus baseline commit, never the register path", async () => {
    const { exitCode, capture } = await runCli(
      BOOTSTRAP_ARGV,
      sharedBootstrapOptions(),
    );
    assert.equal(exitCode, EXIT_OK);
    assert.equal(capture.log.git.length, 1);
    assert.deepEqual(capture.log.git[0], {
      repository: REPO,
      baselineCommit: BASELINE,
    });
    assert.equal(
      JSON.stringify(capture.log.git).includes(REGISTER),
      false,
    );
  });

  await t.test("bootstrap does not infer repository authority from the register pathname", async () => {
    const { capture } = await runCli(
      BOOTSTRAP_ARGV,
      sharedBootstrapOptions({ repositoryRoot: REPO }),
    );
    assert.ok(capture.log.repositoryRootResolves >= 1);
    assert.equal(REGISTER.startsWith(REPO), false);
    for (const call of capture.log.openspec) {
      assert.equal(call.repository, REPO);
    }
    for (const call of capture.log.git) {
      assert.equal(call.repository, REPO);
    }
    assert.equal(
      capture.log.fileReads.some((r) => r.path === ROADMAP_ABS),
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Lane and release authority
// ---------------------------------------------------------------------------

test("lane and release authority bind the real family child and absolute brief paths", async (t) => {
  await t.test("registered source has the exact eight sorted children and dependencies", () => {
    assert.equal(FAMILY_SOURCE.schema, "foreman.execution-family-source.v1");
    assert.equal(FAMILY_SOURCE.program, "v040");
    assert.equal(FAMILY_SOURCE.familyId, "v040-release-20260822-f1");
    assert.deepEqual(
      FAMILY_SOURCE.children.map((child) => ({
        tranche: child.tranche,
        childId: child.childId,
        packageId: child.packageId,
        dependencyChildIds: child.dependencyChildIds,
      })),
      [
        { tranche: 2, childId: "v040-t2-project-registry", packageId: "project-registry", dependencyChildIds: [] },
        { tranche: 3, childId: "v040-t3-memory-index", packageId: "external-memory-index", dependencyChildIds: ["v040-t2-project-registry"] },
        { tranche: 4, childId: "v040-t4-appliance", packageId: "hermetic-foreman-appliance", dependencyChildIds: [] },
        { tranche: 5, childId: "v040-t5-graphify", packageId: "knowledge-plane-refresh", dependencyChildIds: [] },
        { tranche: 6, childId: "v040-t6-work-dag", packageId: "work-dag-projection", dependencyChildIds: ["v040-t5-graphify"] },
        { tranche: 7, childId: "v040-t7-context", packageId: "graph-context-builder", dependencyChildIds: ["v040-t6-work-dag"] },
        { tranche: 8, childId: "v040-t8-evaluation", packageId: "graph-eval-falsification", dependencyChildIds: ["v040-t3-memory-index", "v040-t4-appliance", "v040-t7-context"] },
        { tranche: 9, childId: "v040-t9-release", packageId: "v040-release-program", dependencyChildIds: ["v040-t2-project-registry", "v040-t3-memory-index", "v040-t4-appliance", "v040-t5-graphify", "v040-t6-work-dag", "v040-t7-context", "v040-t8-evaluation"] },
      ],
    );
  });

  await t.test("lane selects only project-registry and binds family request identities", async () => {
    const { exitCode, capture } = await runCli(
      LANE_ARGV,
      sharedLaneOptions(),
    );
    assert.equal(exitCode, EXIT_OK);
    assert.equal(capture.log.family.length, 1);
    assert.deepEqual(capture.log.family[0], {
      stateRoot: STATE_ROOT,
      contractId: CONTRACT_ID,
      contractSha256: CONTRACT_SHA,
      familySha256: FAMILY_SHA,
    });
    const briefReads = capture.log.fileReads.filter((r) =>
      r.path.endsWith("release-brief.json"),
    );
    assert.deepEqual(
      briefReads.map((r) => r.path),
      [PACKAGE_BRIEF_ABS],
    );
    assert.equal(
      normalizedRepositoryRelative(briefReads[0]!.path),
      BRIEF_REL,
    );
    assert.equal(
      capture.log.fileReads.some((r) => r.path === TRACK1_BRIEF_ABS),
      false,
    );
    assertNoEscapeReads(capture.log);
    assertCanonicalResult(
      capture,
      validResult(SHARED_ACTIVE, SHARED_ROADMAP_BYTES, 2),
    );
    assertUnchangedSnapshot(capture);
  });

  const contradictoryFamilyIdentities: ReadonlyArray<{
    name: string;
    familyResult: FamilyResult;
  }> = [
    {
      name: "stateRoot",
      familyResult: registeredFamilyResult({
        stateRoot: join(FIXTURE_ROOT, "other-state"),
      }),
    },
    {
      name: "contractId",
      familyResult: registeredFamilyResult({ contractId: "other-contract" }),
    },
    {
      name: "contractSha256",
      familyResult: registeredFamilyResult({
        contractSha256: "c".repeat(64),
      }),
    },
    {
      name: "familySha256",
      familyResult: registeredFamilyResult({
        familySha256: "d".repeat(64),
      }),
    },
  ];

  for (const { name, familyResult } of contradictoryFamilyIdentities) {
    await t.test(`contradictory family ${name} fails closed`, async () => {
      const { exitCode, capture } = await runCli(
        LANE_ARGV,
        sharedLaneOptions({ familyResult }),
      );
      assert.equal(exitCode, EXIT_EVALUATED);
      assertCanonicalResult(capture, invalidResult("dependency_failure"));
      assertSanitized(capture);
    });
  }

  await t.test("release reads both selected complete v0.4 owner briefs", async () => {
    const options = twoOwnerReleaseOptions();
    const { exitCode, capture } = await runCli(RELEASE_ARGV, options);
    assert.equal(exitCode, EXIT_OK);
    assert.equal(capture.log.family.length, 1);
    assert.deepEqual(capture.log.openspec, [
      {
        repository: REPO,
        argv: ["list", "--json"],
        maxBytes: ONE_MIB,
      },
    ]);
    const briefReads = capture.log.fileReads
      .filter((r) => r.path.endsWith("release-brief.json"))
      .map((r) => r.path)
      .sort();
    assert.deepEqual(
      briefReads,
      [PACKAGE_BRIEF_ABS, SECOND_PACKAGE_BRIEF_ABS].sort(),
    );
    assertCanonicalResult(
      capture,
      validResult(SHARED_ACTIVE, options.roadmapBytes!, 3),
    );
    assertNoEscapeReads(capture.log);
    assertUnchangedSnapshot(capture);
  });

  const briefAuthorityCases: ReadonlyArray<{
    name: string;
    options: HarnessOptions;
    reason: ReleaseCoverageFailureReason;
  }> = [
    {
      name: "missing",
      options: sharedLaneOptions({
        briefBytesByAbsPath: new Map(),
        fileNotFoundPath: PACKAGE_BRIEF_ABS,
      }),
      reason: "brief_mismatch",
    },
    {
      name: "changed",
      options: sharedLaneOptions({
        briefBytesByAbsPath: new Map([
          [
            PACKAGE_BRIEF_ABS,
            briefFileBytes({
              ...deriveBrief(FAMILY_CHILD),
              objective: "tampered objective",
            }),
          ],
        ]),
      }),
      reason: "brief_mismatch",
    },
    {
      name: "malformed",
      options: sharedLaneOptions({
        briefBytesByAbsPath: new Map([[PACKAGE_BRIEF_ABS, utf8("{}\n")]]),
      }),
      reason: "brief_mismatch",
    },
  ];

  for (const { name, options, reason } of briefAuthorityCases) {
    await t.test(`brief authority ${name} => ${reason}`, async () => {
      const { exitCode, capture } = await runCli(LANE_ARGV, options);
      assert.equal(exitCode, EXIT_EVALUATED);
      assertCanonicalResult(capture, invalidResult(reason));
      assertNoEscapeReads(capture.log);
      assertSanitized(capture);
    });
  }

  const derivedFieldCases: ReadonlyArray<{
    name: string;
    familyResult: FamilyResult;
    reason: ReleaseCoverageFailureReason;
  }> = [
    {
      name: "childId",
      familyResult: familyResultWithChild((child) => ({
        ...child,
        childId: "substituted-child",
      })),
      reason: "brief_mismatch",
    },
    {
      name: "packageId",
      familyResult: familyResultWithChild((child) => ({
        ...child,
        packageId: "substituted-project-registry",
      })),
      reason: "brief_mismatch",
    },
    {
      name: "objective",
      familyResult: familyResultWithChild((child) => ({
        ...child,
        objective: "substituted objective",
      })),
      reason: "brief_mismatch",
    },
    {
      name: "acceptance",
      familyResult: familyResultWithChild((child) => ({
        ...child,
        acceptance: ["substituted acceptance"],
      })),
      reason: "brief_mismatch",
    },
    {
      name: "allowedPaths",
      familyResult: familyResultWithChild((child) => ({
        ...child,
        allowedPaths: ["packages/substituted/**"],
      })),
      reason: "brief_mismatch",
    },
  ];

  for (const { name, familyResult, reason } of derivedFieldCases) {
    await t.test(`registered source derives ${name}`, async () => {
      const { exitCode, capture } = await runCli(
        LANE_ARGV,
        sharedLaneOptions({
          familyResult,
          briefBytesByAbsPath: new Map([
            [PACKAGE_BRIEF_ABS, briefFileBytes(deriveBrief(FAMILY_CHILD))],
          ]),
        }),
      );
      assert.equal(exitCode, EXIT_EVALUATED);
      assertCanonicalResult(capture, invalidResult(reason));
      assertNoEscapeReads(capture.log);
      assertSanitized(capture);
    });
  }

  await t.test("invalid registered packageId causes no out-of-repository read", async () => {
    const familyResult = familyResultWithChild((child) => ({
      ...child,
      packageId: "../escape",
    }));
    const { exitCode, capture } = await runCli(
      LANE_ARGV,
      sharedLaneOptions({ familyResult }),
    );
    assert.equal(exitCode, EXIT_EVALUATED);
    assertCanonicalResult(capture, invalidResult("dependency_failure"));
    assertNoEscapeReads(capture.log);
    assert.equal(
      capture.log.fileReads.filter((read) =>
        read.path.endsWith("release-brief.json"),
      ).length,
      0,
    );
    assert.equal(
      capture.log.fileReads.some((read) => read.path.includes("escape")),
      false,
    );
    assertSanitized(capture);
  });
});

// ---------------------------------------------------------------------------
// 4. Result and dependency tables
// ---------------------------------------------------------------------------

test("eleven ReleaseCoverageFailureReason values print one canonical JSON line", async (t) => {
  const harness = {
    invalid_register: {
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({
        registerText: "not-toml",
      }),
      expectOpenspec: false,
    },
    invalid_roadmap: {
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({
        roadmapBytes: Uint8Array.of(0xff, 0xfe, 0xfd),
        registerText: sealRegister({
          activeNames: SHARED_ACTIVE,
          roadmapBytes: Uint8Array.of(0xff, 0xfe, 0xfd),
        }),
      }),
      expectOpenspec: true,
    },
    duplicate_identity: {
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({
        registerText: sealRegister({
          activeNames: SHARED_ACTIVE,
          roadmapBytes: SHARED_ROADMAP_BYTES,
          extraEntry: [
            ``,
            `[[entry]]`,
            `key = "change:${TRACK1}"`,
            `source_kind = "openspec_change"`,
            `source_path = "openspec/changes/${TRACK1}"`,
            `disposition = "v040_owner"`,
            `owner = "${TRACK1}"`,
            `target_release = "v0.4"`,
            `reconcile = "complete"`,
            `reason = "duplicate key with coherent source"`,
          ].join("\n"),
        }),
      }),
      expectOpenspec: true,
    },
    unknown_owner: {
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({
        registerText: sealRegister({
          activeNames: SHARED_ACTIVE,
          roadmapBytes: SHARED_ROADMAP_BYTES,
          mutate: (text) =>
            text.replace(
              `name = "${PACKAGE}"`,
              `name = "declared-other-package"`,
            ),
        }),
      }),
      expectOpenspec: true,
    },
    inventory_mismatch: {
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({
        activeNames: [TRACK1, "extra-active"],
      }),
      expectOpenspec: true,
    },
    roadmap_mismatch: {
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({
        registerText: sealRegister({
          activeNames: SHARED_ACTIVE,
          roadmapBytes: utf8("tampered"),
        }),
      }),
      expectOpenspec: true,
    },
    workflow_mismatch: {
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({
        workflowByOwner: { [TRACK1]: "not-a-workflow", [PACKAGE]: "foreman-bounded" },
      }),
      expectOpenspec: true,
    },
    brief_mismatch: {
      argv: LANE_ARGV,
      options: sharedLaneOptions({
        briefBytesByAbsPath: new Map([[PACKAGE_BRIEF_ABS, utf8("{}\n")]]),
      }),
      expectOpenspec: true,
    },
    unreconciled: {
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({
        registerText: sealRegister({
          activeNames: SHARED_ACTIVE,
          roadmapBytes: SHARED_ROADMAP_BYTES,
          mutate: (text) =>
            text.replace(
              `owner = "${TRACK1}"\ntarget_release = "v0.4"\nreconcile = "complete"`,
              `owner = "${TRACK1}"\ntarget_release = "v0.4"\nreconcile = "required"`,
            ),
        }),
      }),
      expectOpenspec: true,
    },
    competing_plan: {
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({
        changedPaths: ["docs/superpowers/plans/stale-plan.md"],
      }),
      expectOpenspec: true,
    },
    dependency_failure: {
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({
        openspecError: new Error(`boom at ${SECRET}/list`),
      }),
      expectOpenspec: true,
    },
  } as const satisfies Record<
    ReleaseCoverageFailureReason,
    {
      argv: readonly string[];
      options: HarnessOptions;
      expectOpenspec: boolean;
    }
  >;

  for (const reason of Object.keys(harness) as ReleaseCoverageFailureReason[]) {
    await t.test(reason, async () => {
      const { argv, options, expectOpenspec } = harness[reason];
      const { exitCode, capture } = await runCli(argv, options);
      assert.equal(exitCode, EXIT_EVALUATED);
      assertCanonicalResult(capture, invalidResult(reason));
      assertSanitized(capture);
      assertUnchangedSnapshot(capture);
      if (reason === "invalid_register") {
        assert.equal(capture.log.openspec.length, 0);
      } else if (expectOpenspec) {
        assert.equal(capture.log.openspec.length, 1);
      }
    });
  }
});

test("opaque Effect failures and synchronous throws become dependency_failure", async (t) => {
  const cases: ReadonlyArray<{
    name: string;
    argv: readonly string[];
    options: HarnessOptions;
  }> = [
    ...[
      ["register", BOOTSTRAP_ARGV, REGISTER, sharedBootstrapOptions()] as const,
      ["roadmap", BOOTSTRAP_ARGV, ROADMAP_ABS, sharedBootstrapOptions()] as const,
      [
        "workflow",
        BOOTSTRAP_ARGV,
        TRACK1_WORKFLOW_ABS,
        sharedBootstrapOptions(),
      ] as const,
      ["brief", LANE_ARGV, PACKAGE_BRIEF_ABS, sharedLaneOptions()] as const,
    ].flatMap(([label, argv, path, base]) => [
      {
        name: `file-${label}-effect-fail`,
        argv,
        options: {
          ...base,
          fileErrorByPath: new Map([
            [path, new Error(`read fail ${SECRET}/${label}`)],
          ]),
        },
      },
      {
        name: `file-${label}-throw`,
        argv,
        options: { ...base, fileThrowPath: path },
      },
    ]),
    {
      name: "repository-root-effect-fail",
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({
        repositoryRootError: new Error(`root fail ${SECRET}/root`),
      }),
    },
    {
      name: "repository-root-throw",
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({ repositoryRootThrow: true }),
    },
    {
      name: "openspec-throw",
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({ openspecThrow: true }),
    },
    {
      name: "git-effect-fail",
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({
        gitError: new Error(`git fail ${SECRET}/diff`),
      }),
    },
    {
      name: "git-throw",
      argv: BOOTSTRAP_ARGV,
      options: sharedBootstrapOptions({ gitThrow: true }),
    },
    {
      name: "family-effect-fail",
      argv: LANE_ARGV,
      options: sharedLaneOptions({
        familyError: new Error(`ledger fail ${SECRET}/family`),
      }),
    },
    {
      name: "family-throw",
      argv: LANE_ARGV,
      options: sharedLaneOptions({ familyThrow: true }),
    },
  ];

  for (const { name, argv, options } of cases) {
    await t.test(name, async () => {
      const { exitCode, capture } = await runCli(argv, options);
      assert.equal(exitCode, EXIT_EVALUATED);
      assertCanonicalResult(capture, invalidResult("dependency_failure"));
      assertSanitized(capture);
      assertUnchangedSnapshot(capture);
    });
  }
});

test("Valid success is stdout-only canonical JSON with lowercase digests and exit 0", async () => {
  const { exitCode, capture } = await runCli(
    BOOTSTRAP_ARGV,
    sharedBootstrapOptions(),
  );
  assert.equal(exitCode, EXIT_OK);
  assert.equal(capture.stderr, "");
  const expected = validResult(SHARED_ACTIVE, SHARED_ROADMAP_BYTES, 2);
  assert.equal(capture.stdout, `${canonicalize(expected)}\n`);
  parseValidStdout(capture.stdout);
  assert.equal(capture.stdout.includes("ABCDEF"), false);
});

// ---------------------------------------------------------------------------
// 5. No writes and public main framing
// ---------------------------------------------------------------------------

test("services expose exactly four read-only ports and leave repo/state bytes unchanged", async (t) => {
  await t.test("exact service keys", () => {
    const capture: Capture = {
      stdout: "",
      stderr: "",
      log: emptyLog(),
      snapshotBefore: new Map(),
      snapshotAfter: new Map(),
      repoStateBytes: new Map(),
    };
    const services = makeServices(capture, sharedBootstrapOptions());
    assert.deepEqual(serviceKeys(services), [
      "familySource",
      "fileRead",
      "gitChangedPaths",
      "openspecList",
    ]);
    assert.equal(
      Object.prototype.hasOwnProperty.call(services, "roadmapRead"),
      false,
    );
    assert.equal(Object.prototype.hasOwnProperty.call(services, "write"), false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(services, "writeFile"),
      false,
    );
  });

  await t.test("byte snapshot unchanged across bootstrap, lane, and release", async () => {
    for (const [argv, options] of [
      [BOOTSTRAP_ARGV, sharedBootstrapOptions()] as const,
      [LANE_ARGV, sharedLaneOptions()] as const,
      [RELEASE_ARGV, sharedReleaseOptions()] as const,
    ]) {
      const { exitCode, capture } = await runCli(argv, options);
      assert.equal(exitCode, EXIT_OK);
      assertUnchangedSnapshot(capture);
    }
  });

  await t.test("physical live main leaves an isolated repository unchanged", () => {
    const temporary = mkdtempSync(join(tmpdir(), "release-coverage-main-"));
    const repository = join(temporary, "repo");
    try {
      const cloned = spawnSync(
        "git",
        ["clone", "--quiet", "--no-hardlinks", SOURCE_REPO, repository],
        { encoding: "utf8", timeout: 60_000, maxBuffer: ONE_MIB },
      );
      assert.equal(cloned.error, undefined);
      assert.equal(cloned.status, 0, cloned.stderr);
      const before = snapshotPhysicalTree(repository);
      const main = join(
        SOURCE_REPO,
        "packages",
        "orchestration",
        "src",
        "release-coverage-main.ts",
      );
      const register = join(
        repository,
        "openspec",
        "changes",
        "v040-release-program",
        "coverage.toml",
      );
      const invoked = spawnSync(
        process.execPath,
        [
          "--import",
          TSX_LOADER,
          main,
          "check",
          "--program",
          "v040",
          "--phase",
          "bootstrap",
          "--owner",
          TRACK1,
          "--register",
          register,
        ],
        {
          cwd: repository,
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: ONE_MIB,
        },
      );
      const after = snapshotPhysicalTree(repository);

      assert.equal(invoked.error, undefined);
      assert.equal(invoked.status, EXIT_OK, invoked.stderr || invoked.stdout);
      assert.equal(invoked.stderr, "");
      const output = JSON.parse(
        invoked.stdout.trim(),
      ) as ReleaseCoverageResultV1;
      assert.equal(output._tag, "Valid");
      assert.equal(invoked.stdout, `${canonicalize(output)}\n`);
      assert.deepEqual(after, before);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  await t.test("full process-argv vector fixes live main framing", () => {
    const framed: ReleaseCoveragePhaseV1[] = [
      { _tag: "Bootstrap", owner: TRACK1 },
      { _tag: "Lane", owner: PACKAGE },
      { _tag: "Release" },
    ];
    assert.equal(framed.length, 3);
    assert.deepEqual(BOOTSTRAP_ARGV, [
      process.execPath,
      SCRIPT,
      "check",
      "--program",
      "v040",
      "--phase",
      "bootstrap",
      "--owner",
      TRACK1,
      "--register",
      REGISTER,
    ]);
    assert.deepEqual(LANE_ARGV, [
      process.execPath,
      SCRIPT,
      "check",
      "--program",
      "v040",
      "--phase",
      "lane",
      "--owner",
      PACKAGE,
      "--repo",
      REPO,
      "--state-root",
      STATE_ROOT,
      "--contract-id",
      CONTRACT_ID,
      "--contract-sha",
      CONTRACT_SHA,
      "--family-sha",
      FAMILY_SHA,
      "--register",
      REGISTER,
    ]);
    assert.deepEqual(RELEASE_ARGV, [
      process.execPath,
      SCRIPT,
      "check",
      "--program",
      "v040",
      "--phase",
      "release",
      "--repo",
      REPO,
      "--state-root",
      STATE_ROOT,
      "--contract-id",
      CONTRACT_ID,
      "--contract-sha",
      CONTRACT_SHA,
      "--family-sha",
      FAMILY_SHA,
      "--register",
      REGISTER,
    ]);
  });
});
