import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { devNull, tmpdir } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
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
  liveProcessExec,
  liveReleaseCoverageCliServices,
  makeLiveReleaseCoverageCliServices,
  ProcessExec,
  ProcessFailure,
  readFileBoundedSync,
  runReleaseCoverageCli,
  type CapturedProcessResult,
  type ReleaseCoverageCliIo,
  type ReleaseCoverageCliServices,
  type ReleaseCoverageFamilySourceService,
  type ReleaseCoverageFileReadService,
  type ReleaseCoverageGitChangedPathsService,
  type ReleaseCoverageLiveDependencies,
  type ReleaseCoverageOpenSpecListService,
  type RunCapturedOptions,
} from "./index.js";
import { planOpenSpecInvocationV1 } from "./release-coverage-cli.js";

type _ReleaseCoverageLiveDependenciesRequireTrustedFields =
  ReleaseCoverageLiveDependencies extends {
    readonly findWorktreeRoot: (
      path: string,
    ) => Effect.Effect<string, unknown>;
    readonly nodeExecutable: string;
  }
    ? true
    : never;
const _releaseCoverageLiveDependenciesContract: _ReleaseCoverageLiveDependenciesRequireTrustedFields =
  true;
void _releaseCoverageLiveDependenciesContract;

const ONE_MIB = 1_048_576;
const EXIT_OK = 0;
const EXIT_EVALUATED = 1;
const EXIT_USAGE = 64;
const USAGE_DIAGNOSTIC = "release-coverage: invalid invocation\n";

const LIVE_SERVICES_FACTORY_COMPILE_BINDING: (
  dependencies: ReleaseCoverageLiveDependencies,
) => ReleaseCoverageCliServices = makeLiveReleaseCoverageCliServices;
const LIVE_SERVICES_CONSTANT_COMPILE_BINDING: ReleaseCoverageCliServices =
  liveReleaseCoverageCliServices;
void LIVE_SERVICES_FACTORY_COMPILE_BINDING;
void LIVE_SERVICES_CONSTANT_COMPILE_BINDING;

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
const V050_BASELINE = "00c342bd449948ab2ea5ca0b9d0c890614dd81d6";
const V050_OWNER = "v050-release-program";
const V050_ROADMAP_KEY = "roadmap:v050-publication";
const V050_DEFERRED = "graph-store-port";
const V050_DEP = "captured-facts-convergence";

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

const WORKTREE_ROOT = resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);
const FROZEN_V040_COMMIT = "00c342bd449948ab2ea5ca0b9d0c890614dd81d6";
const LIVE_COVERAGE_MAIN = fileURLToPath(
  new URL("./release-coverage-main.ts", import.meta.url),
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

function v050RoadmapBytes(): Uint8Array {
  return utf8(
    [
      "| Coverage key | Scope | Release | Owner |",
      "|---|---|---|---|",
      `| \`${V050_ROADMAP_KEY}\` | Exact-candidate release and publication | \`v0.5\` | \`${V050_OWNER}\` |`,
      "",
    ].join("\n"),
  );
}

function sealV050Register(input: {
  readonly activeNames: readonly string[];
  readonly roadmapBytes: Uint8Array;
  readonly extraEntry?: string;
}): string {
  const inv = inventorySha(input.activeNames);
  const road = sha256Hex(input.roadmapBytes);
  let text = [
    `schema_version = 2`,
    `baseline_commit = "${V050_BASELINE}"`,
    `active_inventory_sha256 = "${inv}"`,
    `roadmap_sha256 = "${road}"`,
    ``,
    `[[entry]]`,
    `key = "change:${V050_OWNER}"`,
    `source_kind = "openspec_change"`,
    `source_path = "openspec/changes/${V050_OWNER}"`,
    `disposition = "v050_owner"`,
    `owner = "${V050_OWNER}"`,
    `target_release = "v0.5"`,
    `reconcile = "complete"`,
    `reason = "governor"`,
    ``,
    `[[entry]]`,
    `key = "${V050_ROADMAP_KEY}"`,
    `source_kind = "roadmap"`,
    `source_path = "ROADMAP.md"`,
    `disposition = "v050_owner"`,
    `owner = "${V050_OWNER}"`,
    `target_release = "v0.5"`,
    `reconcile = "complete"`,
    `reason = "publication"`,
  ].join("\n");
  if (input.extraEntry) text += `\n${input.extraEntry}`;
  return `${text}\n`;
}

const V050_BOOTSTRAP_ARGV = processArgv([
  "check",
  "--program",
  "v050",
  "--phase",
  "bootstrap",
  "--owner",
  V050_OWNER,
  "--register",
  REGISTER,
]);

const V050_LANE_ARGV = processArgv([
  "check",
  "--program",
  "v050",
  "--phase",
  "lane",
  "--owner",
  V050_OWNER,
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

const V050_RELEASE_ARGV = processArgv([
  "check",
  "--program",
  "v050",
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

const V050_CHILD = {
  schema: "foreman.execution-child-brief.v1" as const,
  childId: "v050-release",
  tranche: 8 as const,
  packageId: V050_OWNER,
  dependencyChildIds: [] as const,
  objective: "Ship the v0.5 release program.",
  acceptance: ["Bootstrap coverage passes."],
  allowedPaths: ["packages/policy/**"],
};

const V050_FAMILY_RESULT: FamilyResult = {
  stateRoot: STATE_ROOT,
  contractId: CONTRACT_ID,
  contractSha256: CONTRACT_SHA,
  familySha256: FAMILY_SHA,
  source: {
    schema: "foreman.execution-family-source.v1",
    program: "v050",
    familyId: null,
    children: [V050_CHILD],
  },
};

function v050GovernorBriefAbs(): string {
  return join(REPO, "openspec", "changes", V050_OWNER, "release-brief.json");
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
  readonly fileReads: Array<{
    path: string;
    maxBytes: number;
    containmentRoot?: string | undefined;
  }>;
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
  readonly program: "v040" | "v050";
  readonly familyId: string | null;
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
  readonly tasksMarkdownByOwner?: Readonly<Record<string, string>>;
  readonly evidenceText?: string;
  readonly baselineRegisterText?: string;
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

function extractFrozenV040Repository(destination: string): void {
  mkdirSync(destination, { recursive: true });
  const archived = spawnSync(
    "sh",
    [
      "-c",
      'git archive "$1" | tar -x -C "$2"',
      "extract-frozen-v040",
      FROZEN_V040_COMMIT,
      destination,
    ],
    {
      cwd: WORKTREE_ROOT,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: ONE_MIB,
    },
  );
  assert.equal(archived.error, undefined);
  assert.equal(archived.status, 0, archived.stderr);
  const initialized = spawnSync(
    "git",
    ["init", "--quiet", "--object-format=sha1"],
    {
      cwd: destination,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(initialized.error, undefined);
  assert.equal(initialized.status, 0, initialized.stderr);
  const fetched = spawnSync(
    "git",
    [
      "fetch",
      "--quiet",
      "--no-tags",
      WORKTREE_ROOT,
      FROZEN_V040_COMMIT,
      BASELINE,
    ],
    {
      cwd: destination,
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  assert.equal(fetched.error, undefined);
  assert.equal(fetched.status, 0, fetched.stderr);
  const staged = spawnSync("git", ["add", "-A"], {
    cwd: destination,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(staged.error, undefined);
  assert.equal(staged.status, 0, staged.stderr);
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
  for (const [owner, markdown] of Object.entries(
    options.tasksMarkdownByOwner ?? {},
  )) {
    files.set(
      join(REPO, "openspec", "changes", owner, "tasks.md"),
      utf8(markdown),
    );
  }
  if (options.evidenceText !== undefined) {
    files.set(join(STATE_ROOT, "evidence"), utf8(options.evidenceText));
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
        containmentRoot: input.containmentRoot,
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
    readAtCommit: () => {
      if (options.baselineRegisterText !== undefined) {
        return Effect.succeed(utf8(options.baselineRegisterText));
      }
      return Effect.fail({ _tag: "GitShowUnavailable" as const });
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

test("unknown programs refuse with wrong_program", async () => {
  const { exitCode, capture } = await runCli(
    processArgv([
      "check",
      "--program",
      "v041",
      "--phase",
      "bootstrap",
      "--owner",
      TRACK1,
      "--register",
      REGISTER,
    ]),
  );
  assert.equal(exitCode, EXIT_EVALUATED);
  assertCanonicalResult(capture, invalidResult("wrong_program"));
});

test("v050 bootstrap owner is accepted at parse time", async () => {
  const { exitCode, capture } = await runCli(
    processArgv([
      "check",
      "--program",
      "v050",
      "--phase",
      "bootstrap",
      "--owner",
      "v050-release-program",
      "--register",
      REGISTER,
    ]),
  );
  assert.notEqual(exitCode, EXIT_USAGE);
  assert.equal(capture.stderr, "");
});

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
      assert.equal(
        read.containmentRoot,
        read.path === REGISTER ? undefined : REPO,
      );
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

  await t.test(
    "exact Roadmap table rejects a fifth Markdown cell as invalid_roadmap",
    async () => {
      const bytes = utf8(
        [
          "| Coverage key | Scope | Release | Owner |",
          "|---|---|---|---|",
          `| \`${ROADMAP_KEY}\` | Sprint 6 project registry | injected | \`v0.4\` | \`${PACKAGE}\` |`,
          "",
        ].join("\n"),
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
    },
  );

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
    assert.equal(briefReads[0]!.containmentRoot, REPO);
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

  await t.test(
    "release reads workflow and brief for a declared v0.4 future owner with no entry",
    async () => {
      const applianceChild = FAMILY_SOURCE.children[2]!;
      assert.equal(applianceChild.packageId, "hermetic-foreman-appliance");
      const packageId = applianceChild.packageId;
      const applianceWorkflowAbs = join(
        REPO,
        "openspec",
        "changes",
        packageId,
        ".openspec.yaml",
      );
      const applianceBriefAbs = join(
        REPO,
        "openspec",
        "changes",
        packageId,
        "release-brief.json",
      );
      const base = sealRegister({
        activeNames: SHARED_ACTIVE,
        roadmapBytes: SHARED_ROADMAP_BYTES,
        packageReconcile: "complete",
        track1TargetRelease: "released",
        track1Disposition: "released_reference",
      });
      const registerText = `${base}\n\n[[future_owner]]\nname = "${packageId}"\ntarget_release = "v0.4"\nreason = "Track 4 owns the hermetic Foreman appliance."\n`;
      assert.equal(
        registerText.includes(`owner = "${packageId}"`),
        false,
      );
      const { exitCode, capture } = await runCli(
        RELEASE_ARGV,
        sharedReleaseOptions({
          registerText,
          workflowByOwner: {
            [TRACK1]: "foreman-architectural",
            [PACKAGE]: "foreman-bounded",
            [packageId]: "foreman-bounded",
          },
          briefBytesByAbsPath: new Map([
            [PACKAGE_BRIEF_ABS, briefFileBytes(deriveBrief(FAMILY_CHILD))],
            [
              applianceBriefAbs,
              briefFileBytes(deriveBrief(applianceChild)),
            ],
          ]),
        }),
      );
      assert.equal(exitCode, EXIT_OK);
      assert.equal(capture.log.family.length, 1);
      const authorityReads = capture.log.fileReads
        .filter(
          (read) =>
            read.path.endsWith(".openspec.yaml") ||
            read.path.endsWith("release-brief.json"),
        )
        .map((read) => read.path)
        .sort();
      assert.deepEqual(
        authorityReads,
        [
          PACKAGE_WORKFLOW_ABS,
          applianceWorkflowAbs,
          PACKAGE_BRIEF_ABS,
          applianceBriefAbs,
        ].sort(),
      );
      for (const read of capture.log.fileReads.filter(
        (entry) =>
          entry.path.endsWith(".openspec.yaml") ||
          entry.path.endsWith("release-brief.json"),
      )) {
        assert.equal(read.containmentRoot, REPO);
      }
      assertCanonicalResult(
        capture,
        validResult(SHARED_ACTIVE, SHARED_ROADMAP_BYTES, 2),
      );
      assertNoEscapeReads(capture.log);
      assertUnchangedSnapshot(capture);
    },
  );

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
      name: "tagged Error missing",
      options: sharedLaneOptions({
        briefBytesByAbsPath: new Map(),
        fileErrorByPath: new Map([
          [
            PACKAGE_BRIEF_ABS,
            Object.assign(new Error("file not found"), {
              _tag: "NotFound" as const,
            }),
          ],
        ]),
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

  await t.test(
    "safe dotted owner package..id is Valid when authority surfaces agree",
    async () => {
      const dottedOwner = "package..id";
      const dottedChildId = "v040-t2-package-dotdot";
      const dottedRoadmapKey = "roadmap:package-dotdot";
      const dottedBriefAbs = join(
        REPO,
        "openspec",
        "changes",
        dottedOwner,
        "release-brief.json",
      );
      const dottedChild = {
        schema: "foreman.execution-child-brief.v1" as const,
        childId: dottedChildId,
        tranche: 2 as const,
        packageId: dottedOwner,
        dependencyChildIds: [] as const,
        objective: "Ship the dotted owner lane.",
        acceptance: ["Safe filename segments may contain .. substrings."],
        allowedPaths: ["packages/orchestration/**"] as const,
      };
      const roadmapBytes = utf8(
        [
          "| Coverage key | Scope | Release | Owner |",
          "|---|---|---|---|",
          `| \`${dottedRoadmapKey}\` | Dotted owner package | \`v0.4\` | \`${dottedOwner}\` |`,
          "",
        ].join("\n"),
      );
      const registerText = sealRegister({
        activeNames: SHARED_ACTIVE,
        roadmapBytes,
        packageReconcile: "complete",
        mutate: (text) =>
          text
            .replaceAll(`name = "${PACKAGE}"`, `name = "${dottedOwner}"`)
            .replaceAll(`key = "${ROADMAP_KEY}"`, `key = "${dottedRoadmapKey}"`)
            .replaceAll(`owner = "${PACKAGE}"`, `owner = "${dottedOwner}"`),
      });
      const familyResult: FamilyResult = {
        ...registeredFamilyResult(),
        source: {
          ...FAMILY_SOURCE,
          children: FAMILY_SOURCE.children.map((child) =>
            child.packageId === PACKAGE ? dottedChild : child,
          ),
        },
      };
      const dottedArgv = processArgv([
        "check",
        "--program",
        "v040",
        "--phase",
        "lane",
        "--owner",
        dottedOwner,
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
      const { exitCode, capture } = await runCli(
        dottedArgv,
        sharedLaneOptions({
          roadmapBytes,
          registerText,
          workflowByOwner: {
            [TRACK1]: "foreman-architectural",
            [PACKAGE]: "foreman-bounded",
            [dottedOwner]: "foreman-bounded",
          },
          familyResult,
          briefBytesByAbsPath: new Map([
            [dottedBriefAbs, briefFileBytes(deriveBrief(dottedChild))],
          ]),
        }),
      );
      assert.equal(exitCode, EXIT_OK);
      assertCanonicalResult(
        capture,
        validResult(SHARED_ACTIVE, roadmapBytes, 2),
      );
      assertNoEscapeReads(capture.log);
      assertUnchangedSnapshot(capture);
    },
  );
});

// ---------------------------------------------------------------------------
// 4. Result and dependency tables
// ---------------------------------------------------------------------------

test("every ReleaseCoverageFailureReason value prints one canonical JSON line", async (t) => {
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
    wrong_program: {
      argv: processArgv([
        "check",
        "--program",
        "v041",
        "--phase",
        "bootstrap",
        "--owner",
        TRACK1,
        "--register",
        REGISTER,
      ]),
      options: sharedBootstrapOptions(),
      expectOpenspec: false,
    },
    register_cross_field: {
      argv: V050_BOOTSTRAP_ARGV,
      options: (() => {
        const roadmapBytes = v050RoadmapBytes();
        const extraEntry = [
          ``,
          `[[entry]]`,
          `key = "change:${V050_DEFERRED}"`,
          `source_kind = "openspec_change"`,
          `source_path = "openspec/changes/${V050_DEFERRED}"`,
          `disposition = "v060"`,
          `owner = "${V050_OWNER}"`,
          `target_release = "v0.6"`,
          `reconcile = "not_required"`,
          `reason = "deferred"`,
          ``,
          `[[entry]]`,
          `key = "change:${V050_DEP}"`,
          `source_kind = "openspec_change"`,
          `source_path = "openspec/changes/${V050_DEP}"`,
          `disposition = "v050_dependency"`,
          `owner = "${V050_DEFERRED}"`,
          `target_release = "v0.5"`,
          `reconcile = "required"`,
          `reason = "owner is deferred"`,
        ].join("\n");
        return {
          roadmapBytes,
          activeNames: [V050_OWNER, V050_DEFERRED, V050_DEP],
          workflowByOwner: { [V050_OWNER]: "foreman-architectural" },
          registerText: sealV050Register({
            activeNames: [V050_OWNER, V050_DEFERRED, V050_DEP],
            roadmapBytes,
            extraEntry,
          }),
        };
      })(),
      expectOpenspec: true,
    },
    iron_rule_violation: {
      argv: V050_LANE_ARGV,
      options: (() => {
        const roadmapBytes = v050RoadmapBytes();
        const registerText = sealV050Register({
          activeNames: [V050_OWNER],
          roadmapBytes,
        });
        const brief = deriveBrief(V050_CHILD);
        return {
          roadmapBytes,
          activeNames: [V050_OWNER],
          workflowByOwner: { [V050_OWNER]: "foreman-architectural" },
          registerText,
          familyResult: V050_FAMILY_RESULT,
          briefBytesByAbsPath: new Map([
            [v050GovernorBriefAbs(), briefFileBytes(brief)],
          ]),
          tasksMarkdownByOwner: {
            [V050_OWNER]: [
              "## Allowed file scope",
              "",
              "- `packages/policy/**`",
              "",
              "- [ ] Create `skills/foreman/scripts/spec-triage.sh`",
              "",
            ].join("\n"),
          },
        };
      })(),
      expectOpenspec: true,
    },
    deferred_package_changed: {
      argv: V050_BOOTSTRAP_ARGV,
      options: (() => {
        const roadmapBytes = v050RoadmapBytes();
        const extraEntry = [
          ``,
          `[[entry]]`,
          `key = "change:${V050_DEFERRED}"`,
          `source_kind = "openspec_change"`,
          `source_path = "openspec/changes/${V050_DEFERRED}"`,
          `disposition = "v060"`,
          `owner = "${V050_OWNER}"`,
          `target_release = "v0.6"`,
          `reconcile = "not_required"`,
          `reason = "deferred"`,
        ].join("\n");
        const registerText = sealV050Register({
          activeNames: [V050_OWNER, V050_DEFERRED],
          roadmapBytes,
          extraEntry,
        });
        return {
          roadmapBytes,
          activeNames: [V050_OWNER, V050_DEFERRED],
          workflowByOwner: { [V050_OWNER]: "foreman-architectural" },
          registerText,
          baselineRegisterText: registerText,
          changedPaths: [`openspec/changes/${V050_DEFERRED}/tasks.md`],
        };
      })(),
      expectOpenspec: true,
    },
    vocabulary_mixed: {
      argv: V050_RELEASE_ARGV,
      options: (() => {
        const roadmapBytes = v050RoadmapBytes();
        const registerText = sealV050Register({
          activeNames: [V050_OWNER],
          roadmapBytes,
        });
        const brief = deriveBrief(V050_CHILD);
        return {
          roadmapBytes,
          activeNames: [V050_OWNER],
          workflowByOwner: { [V050_OWNER]: "foreman-architectural" },
          registerText,
          familyResult: V050_FAMILY_RESULT,
          briefBytesByAbsPath: new Map([
            [v050GovernorBriefAbs(), briefFileBytes(brief)],
          ]),
          evidenceText: '{"verdict":"UNVERIFIED"}\n',
        };
      })(),
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
      extractFrozenV040Repository(repository);
      const register = join(
        repository,
        "openspec",
        "changes",
        "v040-release-program",
        "coverage.toml",
      );
      const bootstrapArgv = [
        "--import",
        TSX_LOADER,
        LIVE_COVERAGE_MAIN,
        "check",
        "--program",
        "v040",
        "--phase",
        "bootstrap",
        "--owner",
        TRACK1,
        "--register",
        register,
      ] as const;
      const invoke = (cwd: string) =>
        spawnSync(process.execPath, [...bootstrapArgv], {
          cwd,
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: ONE_MIB,
        });

      const beforeRoot = snapshotPhysicalTree(repository);
      const rootInvoked = invoke(repository);
      const afterRoot = snapshotPhysicalTree(repository);
      assert.equal(rootInvoked.error, undefined);
      assert.equal(
        rootInvoked.status,
        EXIT_OK,
        rootInvoked.stderr || rootInvoked.stdout,
      );
      assert.equal(rootInvoked.stderr, "");
      const rootOutput = JSON.parse(
        rootInvoked.stdout.trim(),
      ) as ReleaseCoverageResultV1;
      assert.equal(rootOutput._tag, "Valid");
      assert.equal(rootInvoked.stdout, `${canonicalize(rootOutput)}\n`);
      assert.deepEqual(afterRoot, beforeRoot);

      const nestedCwd = join(repository, "packages");
      const beforeNested = snapshotPhysicalTree(repository);
      const nestedInvoked = invoke(nestedCwd);
      const afterNested = snapshotPhysicalTree(repository);
      assert.equal(nestedInvoked.error, undefined);
      assert.equal(
        nestedInvoked.status,
        EXIT_OK,
        nestedInvoked.stderr || nestedInvoked.stdout,
      );
      assert.equal(nestedInvoked.stderr, "");
      assert.equal(nestedInvoked.stdout, rootInvoked.stdout);
      assert.deepEqual(afterNested, beforeNested);
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

// ---------------------------------------------------------------------------
// 6. Live Git changed-path discovery and bounded file reader
// ---------------------------------------------------------------------------

const GIT_TEST_TIMEOUT_MS = 30_000;

function gitIn(
  repository: string,
  args: readonly string[],
): SpawnSyncReturns<string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) =>
        value !== undefined && !name.toUpperCase().startsWith("GIT_"),
    ),
  ) as NodeJS.ProcessEnv;
  return spawnSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    timeout: GIT_TEST_TIMEOUT_MS,
    maxBuffer: ONE_MIB,
    env: {
      ...inherited,
      GIT_AUTHOR_NAME: "release-coverage",
      GIT_AUTHOR_EMAIL: "release-coverage@example.com",
      GIT_COMMITTER_NAME: "release-coverage",
      GIT_COMMITTER_EMAIL: "release-coverage@example.com",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: devNull,
    },
  });
}

function assertGitOk(
  result: SpawnSyncReturns<string>,
  label: string,
): void {
  assert.equal(result.error, undefined, label);
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
}

test("live gitChangedPaths.discover returns planning changes without duplicates", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "release-coverage-git-"));
  const repository = join(temporary, "repo");
  try {
    mkdirSync(repository);
    const emptyTemplate = join(temporary, "empty-template");
    const emptyHooks = join(temporary, "empty-hooks");
    mkdirSync(emptyTemplate);
    mkdirSync(emptyHooks);
    assertGitOk(
      gitIn(repository, [
        "init",
        "--object-format=sha1",
        `--template=${emptyTemplate}`,
      ]),
      "git init",
    );
    assertGitOk(
      gitIn(repository, ["config", "user.email", "release-coverage@example.com"]),
      "git config email",
    );
    assertGitOk(
      gitIn(repository, ["config", "user.name", "release-coverage"]),
      "git config name",
    );
    assertGitOk(
      gitIn(repository, ["config", "commit.gpgsign", "false"]),
      "git config gpgsign",
    );
    assertGitOk(
      gitIn(repository, ["config", "core.hooksPath", emptyHooks]),
      "git config hooks",
    );
    assertGitOk(
      gitIn(repository, ["config", "core.excludesFile", devNull]),
      "git config excludes",
    );
    assertGitOk(
      gitIn(repository, ["config", "core.fsmonitor", "false"]),
      "git config fsmonitor",
    );

    const specsRoot = join(repository, "docs", "superpowers", "specs");
    const plansRoot = join(repository, "docs", "superpowers", "plans");
    mkdirSync(specsRoot, { recursive: true });
    mkdirSync(plansRoot, { recursive: true });
    writeFileSync(join(specsRoot, "seed-spec.md"), "seed spec\n");
    writeFileSync(join(plansRoot, "seed-plan.md"), "seed plan\n");
    writeFileSync(join(repository, "README.md"), "seed readme\n");
    writeFileSync(join(specsRoot, "to-delete.md"), "delete me\n");
    writeFileSync(join(plansRoot, "to-rename.md"), "rename me\n");
    writeFileSync(
      join(repository, ".gitignore"),
      "docs/superpowers/plans/untracked.md\n",
    );
    assertGitOk(gitIn(repository, ["add", "-A"]), "git add seed");
    assertGitOk(gitIn(repository, ["commit", "-m", "baseline"]), "git commit baseline");
    const baseline = (gitIn(repository, ["rev-parse", "HEAD"]).stdout ?? "").trim();
    assert.match(baseline, /^[0-9a-f]{40}$/);

    writeFileSync(join(specsRoot, "committed-after.md"), "committed after\n");
    assertGitOk(gitIn(repository, ["add", "docs/superpowers/specs/committed-after.md"]), "git add committed");
    assertGitOk(
      gitIn(repository, ["commit", "-m", "committed after baseline"]),
      "git commit after",
    );

    writeFileSync(join(plansRoot, "staged.md"), "staged\n");
    assertGitOk(gitIn(repository, ["add", "docs/superpowers/plans/staged.md"]), "git add staged");

    writeFileSync(join(specsRoot, "seed-spec.md"), "unstaged edit\n");
    writeFileSync(join(plansRoot, "untracked.md"), "untracked\n");
    assertGitOk(
      gitIn(repository, ["rm", "docs/superpowers/specs/to-delete.md"]),
      "git rm deleted",
    );
    assertGitOk(
      gitIn(repository, [
        "mv",
        "docs/superpowers/plans/to-rename.md",
        "docs/superpowers/plans/renamed.md",
      ]),
      "git mv renamed",
    );
    writeFileSync(join(repository, "README.md"), "outside planning roots\n");

    const discovered = await Effect.runPromise(
      liveReleaseCoverageCliServices.gitChangedPaths.discover({
        repository,
        baselineCommit: baseline,
      }),
    );
    assert.deepEqual(
      discovered,
      [...discovered].sort((a, b) => Buffer.from(a).compare(Buffer.from(b))),
    );
    const unique = new Set(discovered);
    assert.equal(unique.size, discovered.length);

    const expected = [
      "docs/superpowers/specs/committed-after.md",
      "docs/superpowers/plans/staged.md",
      "docs/superpowers/specs/seed-spec.md",
      "docs/superpowers/specs/to-delete.md",
      "docs/superpowers/plans/renamed.md",
      "docs/superpowers/plans/untracked.md",
    ];
    for (const path of expected) {
      assert.equal(
        discovered.includes(path),
        true,
        `missing planning path ${path}: ${JSON.stringify(discovered)}`,
      );
    }
    assert.equal(discovered.includes("README.md"), false);
    assert.equal(
      discovered.some(
        (path) =>
          !path.startsWith("docs/superpowers/specs/") &&
          !path.startsWith("docs/superpowers/plans/") &&
          path !== "docs/superpowers/specs" &&
          path !== "docs/superpowers/plans",
      ),
      false,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("live fileRead.readBounded enforces 1 MiB and rejects non-regular authority", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "release-coverage-read-"));
  try {
    const exactPath = join(temporary, "exact.bin");
    writeFileSync(exactPath, Buffer.alloc(ONE_MIB, 7));
    const exact = await Effect.runPromise(
      liveReleaseCoverageCliServices.fileRead.readBounded({
        path: exactPath,
        maxBytes: ONE_MIB,
      }),
    );
    assert.equal(exact.byteLength, ONE_MIB);

    const overPath = join(temporary, "over.bin");
    writeFileSync(overPath, Buffer.alloc(ONE_MIB + 1, 8));
    const over = await Effect.runPromise(
      liveReleaseCoverageCliServices.fileRead
        .readBounded({ path: overPath, maxBytes: ONE_MIB })
        .pipe(Effect.either),
    );
    assert.equal(over._tag, "Left");

    const directoryPath = join(temporary, "dir-authority");
    mkdirSync(directoryPath);
    const directory = await Effect.runPromise(
      liveReleaseCoverageCliServices.fileRead
        .readBounded({ path: directoryPath, maxBytes: ONE_MIB })
        .pipe(Effect.either),
    );
    assert.equal(directory._tag, "Left");

    await t.test(
      "symlink to a matching external file fails closed",
      async (st) => {
        const outside = mkdtempSync(join(tmpdir(), "release-coverage-ext-"));
        try {
          const outsideFile = join(outside, "external.bin");
          writeFileSync(outsideFile, Buffer.alloc(32, 9));
          const linkPath = join(temporary, "linked.bin");
          try {
            symlinkSync(outsideFile, linkPath);
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code ?? "unknown";
            st.skip(`symlink creation not permitted: ${code}`);
            return;
          }
          const linked = await Effect.runPromise(
            liveReleaseCoverageCliServices.fileRead
              .readBounded({ path: linkPath, maxBytes: ONE_MIB })
              .pipe(Effect.either),
          );
          assert.equal(linked._tag, "Left");
        } finally {
          rmSync(outside, { recursive: true, force: true });
        }
      },
    );

    const repository = join(temporary, "repository");
    const nested = join(repository, "openspec", "changes", "package");
    mkdirSync(nested, { recursive: true });
    const nestedFile = join(nested, "release-brief.json");
    const nestedBytes = utf8("nested authority\n");
    writeFileSync(nestedFile, nestedBytes);
    const nestedRead = await Effect.runPromise(
      liveReleaseCoverageCliServices.fileRead.readBounded({
        path: nestedFile,
        maxBytes: ONE_MIB,
        containmentRoot: repository,
      }),
    );
    assert.deepEqual(nestedRead, nestedBytes);

    const missingOwner = await Effect.runPromise(
      liveReleaseCoverageCliServices.fileRead
        .readBounded({
          path: join(repository, "missing-owner", "release-brief.json"),
          maxBytes: ONE_MIB,
          containmentRoot: repository,
        })
        .pipe(Effect.either),
    );
    assert.equal(missingOwner._tag, "Left");
    if (missingOwner._tag === "Left") {
      assert.equal(typeof missingOwner.left, "object");
      assert.notEqual(missingOwner.left, null);
      assert.ok(
        Object.prototype.hasOwnProperty.call(missingOwner.left, "_tag"),
      );
      assert.equal(
        (missingOwner.left as { readonly _tag: unknown })._tag,
        "NotFound",
      );
    }

    await t.test(
      "containment accepts a repository root reached through an alias",
      async (st) => {
        const repositoryAlias = join(temporary, "repository-alias");
        try {
          symlinkSync(
            repository,
            repositoryAlias,
            process.platform === "win32" ? "junction" : "dir",
          );
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
            st.skip(`symlink creation not permitted: ${code}`);
            return;
          }
          throw error;
        }
        const aliasedRead = await Effect.runPromise(
          liveReleaseCoverageCliServices.fileRead.readBounded({
            path: join(
              repositoryAlias,
              "openspec",
              "changes",
              "package",
              "release-brief.json",
            ),
            maxBytes: ONE_MIB,
            containmentRoot: repositoryAlias,
          }),
        );
        assert.deepEqual(aliasedRead, nestedBytes);
      },
    );

    await t.test(
      "intermediate symlink to an in-repository directory fails closed",
      async (st) => {
        const physicalInside = join(repository, "physical-inside");
        const physicalPackage = join(physicalInside, "package");
        mkdirSync(physicalPackage, { recursive: true });
        writeFileSync(join(physicalPackage, "release-brief.json"), nestedBytes);
        const insideAlias = join(repository, "inside-alias");
        try {
          symlinkSync(
            physicalInside,
            insideAlias,
            process.platform === "win32" ? "junction" : "dir",
          );
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
            st.skip(`symlink creation not permitted: ${code}`);
            return;
          }
          throw error;
        }
        const result = await Effect.runPromise(
          liveReleaseCoverageCliServices.fileRead
            .readBounded({
              path: join(insideAlias, "package", "release-brief.json"),
              maxBytes: ONE_MIB,
              containmentRoot: repository,
            })
            .pipe(Effect.either),
        );
        assert.equal(result._tag, "Left");
      },
    );

    await t.test(
      "post-read containment rejects an intermediate directory swap",
      async (st) => {
        const guardedRoot = join(repository, "swap-guarded");
        const guardedPackage = join(guardedRoot, "package");
        mkdirSync(guardedPackage, { recursive: true });
        const guardedFile = join(guardedPackage, "release-brief.json");
        writeFileSync(guardedFile, utf8("swap authority\n"));

        const swapOutside = join(temporary, "swap-outside");
        mkdirSync(swapOutside);
        try {
          linkSync(guardedFile, join(swapOutside, "release-brief.json"));
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (
            code === "EPERM" ||
            code === "EACCES" ||
            code === "ENOTSUP" ||
            code === "EXDEV"
          ) {
            st.skip(`hard link creation not permitted: ${code}`);
            return;
          }
          throw error;
        }

        const directoryLinkType =
          process.platform === "win32" ? "junction" : "dir";
        const probeTarget = join(temporary, "swap-dir-link-probe-target");
        const probeLink = join(temporary, "swap-dir-link-probe");
        mkdirSync(probeTarget);
        try {
          symlinkSync(probeTarget, probeLink, directoryLinkType);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
            st.skip(`directory link creation not permitted: ${code}`);
            return;
          }
          throw error;
        }

        let coerced = 0;
        let swapped = false;
        const swapAfterOpen = {
          [Symbol.toPrimitive](): number {
            coerced += 1;
            if (coerced === 1) {
              renameSync(
                guardedRoot,
                join(repository, "swap-guarded-original"),
              );
              symlinkSync(swapOutside, guardedRoot, directoryLinkType);
              swapped = true;
            }
            return ONE_MIB;
          },
        };

        const swappedRead = await Effect.runPromise(
          liveReleaseCoverageCliServices.fileRead
            .readBounded({
              path: guardedFile,
              maxBytes: swapAfterOpen as unknown as number,
              containmentRoot: repository,
            })
            .pipe(Effect.either),
        );
        assert.equal(coerced >= 1, true);
        assert.equal(swapped, true);
        assert.equal(swappedRead._tag, "Left");
      },
    );

    await t.test(
      "intermediate directory symlink cannot escape repository containment",
      async (st) => {
        const outside = mkdtempSync(join(tmpdir(), "release-coverage-outside-"));
        try {
          const outsidePackage = join(outside, "package");
          mkdirSync(outsidePackage);
          const outsideBytes = utf8("matching outside authority\n");
          writeFileSync(join(outsidePackage, "release-brief.json"), outsideBytes);
          const changes = join(repository, "linked-changes");
          try {
            symlinkSync(outside, changes, "dir");
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
              st.skip(`symlink creation not permitted: ${code}`);
              return;
            }
            throw error;
          }
          const escaped = await Effect.runPromise(
            liveReleaseCoverageCliServices.fileRead
              .readBounded({
                path: join(changes, "package", "release-brief.json"),
                maxBytes: ONE_MIB,
                containmentRoot: repository,
              })
              .pipe(Effect.either),
          );
          assert.equal(escaped._tag, "Left");
        } finally {
          rmSync(outside, { recursive: true, force: true });
        }
      },
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. Windows OpenSpec invocation plan (future pure helper)
// ---------------------------------------------------------------------------

type OpenSpecInvocationPlanV1 =
  | {
      readonly _tag: "Ok";
      readonly command: string;
      readonly args: readonly string[];
    }
  | { readonly _tag: "Invalid" };

test("planOpenSpecInvocationV1 freezes POSIX and Windows command plans", () => {
  const posixResolved = "/usr/local/bin/openspec";
  const posix = planOpenSpecInvocationV1({
    platform: "linux",
    comSpec: undefined,
    resolvedOpenSpec: posixResolved,
  }) as OpenSpecInvocationPlanV1;
  assert.deepEqual(posix, {
    _tag: "Ok",
    command: posixResolved,
    args: ["list", "--json"],
  });

  const comSpec = "C:\\Windows\\System32\\cmd.exe";
  const resolvedShim = "C:\\Tools\\openspec.cmd";
  const windows = planOpenSpecInvocationV1({
    platform: "win32",
    comSpec,
    resolvedOpenSpec: resolvedShim,
  }) as OpenSpecInvocationPlanV1;
  assert.equal(windows._tag, "Ok");
  if (windows._tag === "Ok") {
    assert.equal(windows.command, comSpec);
    assert.deepEqual(windows.args, [
      "/d",
      "/s",
      "/c",
      `"${resolvedShim}" list --json`,
    ]);
    assert.equal(windows.args.includes("openspec.cmd"), false);
  }

  const invalidCases: ReadonlyArray<{
    readonly platform: NodeJS.Platform;
    readonly comSpec: string | undefined;
    readonly resolvedOpenSpec: string;
  }> = [
    {
      platform: "win32",
      comSpec: "cmd.exe",
      resolvedOpenSpec: resolvedShim,
    },
    {
      platform: "win32",
      comSpec: "C:\\Windows\\System32\\cmd.exe\0evil",
      resolvedOpenSpec: resolvedShim,
    },
    {
      platform: "win32",
      comSpec,
      resolvedOpenSpec: "openspec.cmd",
    },
    {
      platform: "win32",
      comSpec,
      resolvedOpenSpec: "C:\\Tools\\openspec.cmd\0evil",
    },
    {
      platform: "linux",
      comSpec: undefined,
      resolvedOpenSpec: "openspec",
    },
    {
      platform: "linux",
      comSpec: undefined,
      resolvedOpenSpec: "/usr/bin/openspec\0evil",
    },
  ];
  for (const input of invalidCases) {
    const plan = planOpenSpecInvocationV1(input) as OpenSpecInvocationPlanV1;
    assert.deepEqual(plan, { _tag: "Invalid" });
  }
});

test("pure Windows planner rejects CMD expansion and metacharacters", () => {
  const comSpec = "C:\\Windows\\System32\\cmd.exe";
  const validWithSpaces = planOpenSpecInvocationV1({
    platform: "win32",
    comSpec,
    resolvedOpenSpec: "C:\\Program Files\\OpenSpec\\openspec.CMD",
  });
  assert.deepEqual(validWithSpaces, {
    _tag: "Ok",
    command: comSpec,
    args: [
      "/d",
      "/s",
      "/c",
      '"C:\\Program Files\\OpenSpec\\openspec.CMD" list --json',
    ],
  });

  const uppercaseComSpec = "C:\\Windows\\System32\\CMD.EXE";
  assert.deepEqual(
    planOpenSpecInvocationV1({
      platform: "win32",
      comSpec: uppercaseComSpec,
      resolvedOpenSpec: "C:\\Tools\\openspec.cmd",
    }),
    {
      _tag: "Ok",
      command: uppercaseComSpec,
      args: ["/d", "/s", "/c", '"C:\\Tools\\openspec.cmd" list --json'],
    },
  );

  for (const metacharacter of [
    "%",
    "!",
    "^",
    "&",
    "|",
    "<",
    ">",
    "(",
    ")",
    '"',
    "\r",
    "\n",
    "\t",
    "\x7f",
    "\0",
  ]) {
    assert.deepEqual(
      planOpenSpecInvocationV1({
        platform: "win32",
        comSpec,
        resolvedOpenSpec: `C:\\Tools\\unsafe${metacharacter}name.cmd`,
      }),
      { _tag: "Invalid" },
      `shim metacharacter ${JSON.stringify(metacharacter)}`,
    );
    assert.deepEqual(
      planOpenSpecInvocationV1({
        platform: "win32",
        comSpec: `C:\\Windows\\unsafe${metacharacter}cmd.exe`,
        resolvedOpenSpec: "C:\\Tools\\openspec.cmd",
      }),
      { _tag: "Invalid" },
      `ComSpec metacharacter ${JSON.stringify(metacharacter)}`,
    );
  }

  for (const input of [
    { comSpec: "C:\\Windows\\System32\\powershell.exe", shim: "C:\\Tools\\openspec.cmd" },
    { comSpec: "C:\\Windows\\System32\\notcmd.exe", shim: "C:\\Tools\\openspec.cmd" },
    { comSpec: "C:\\Windows\\System32\\cmd.com", shim: "C:\\Tools\\openspec.cmd" },
    { comSpec: "C:\\Windows\\System32\\cmd.exe.bak", shim: "C:\\Tools\\openspec.cmd" },
    { comSpec, shim: "C:\\Tools\\openspec.exe" },
    { comSpec: "cmd.exe", shim: "C:\\Tools\\openspec.cmd" },
    { comSpec, shim: "openspec.cmd" },
  ]) {
    assert.deepEqual(
      planOpenSpecInvocationV1({
        platform: "win32",
        comSpec: input.comSpec,
        resolvedOpenSpec: input.shim,
      }),
      { _tag: "Invalid" },
    );
  }
});

test("live OpenSpec adapter uses the planner and exact raw bytes", async (t) => {
  const cases = [
    {
      name: "posix",
      platform: "linux" as const,
      comSpec: undefined,
      repository: posix.join("/", "work", "repository"),
      resolved: posix.join("/", "opt", "openspec", "bin", "openspec"),
      nodeExecutable: posix.join("/", "usr", "bin", "node"),
      nullDevice: "/dev/null",
    },
    {
      name: "windows",
      platform: "win32" as const,
      comSpec: win32.join("C:\\", "Windows", "System32", "cmd.exe"),
      repository: win32.join("C:\\", "Work", "Repository"),
      resolved: win32.join("C:\\", "Program Files", "OpenSpec", "openspec.cmd"),
      nodeExecutable: win32.join("C:\\", "Program Files", "nodejs", "node.exe"),
      nullDevice: "NUL",
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const calls: RunCapturedOptions[] = [];
      const lookups: string[] = [];
      const expectedNodeDirectory =
        item.platform === "win32"
          ? win32.dirname(item.nodeExecutable)
          : posix.dirname(item.nodeExecutable);
      const dependencies: ReleaseCoverageLiveDependencies = {
        runCaptured: (input) => {
          calls.push(input);
          const result: CapturedProcessResult = {
            exitCode: 0,
            stdout: "\uFFFD",
            stderr: "",
            stdoutBytes: Uint8Array.of(0xff),
            stderrBytes: new Uint8Array(),
          };
          return Effect.succeed(result);
        },
        which: (name) => {
          lookups.push(name);
          if (name === "openspec") return Effect.succeed(item.resolved);
          return Effect.succeed(null);
        },
        realpath: (path) => Effect.succeed(path),
        findWorktreeRoot: (path) => Effect.succeed(item.repository),
        nodeExecutable: item.nodeExecutable,
        platform: item.platform,
        comSpec: item.comSpec,
        cwd: () => item.repository,
        nullDevice: item.nullDevice,
        baseEnvironment: {
          PATH: "/hostile/bin",
          Path: "/hostile/mixed",
          PATHEXT: ".NODE",
          NODE_OPTIONS: "--require=/hostile/preload.js",
          Node_V8_Coverage: "/hostile/v8",
        },
      };
      const services = makeLiveReleaseCoverageCliServices(dependencies);
      const bytes = await Effect.runPromise(
        services.openspecList.listJson({
          repository: item.repository,
          argv: ["list", "--json"],
          maxBytes: ONE_MIB,
        }),
      );
      assert.deepEqual(bytes, Uint8Array.of(0xff));
      assert.deepEqual(lookups, ["openspec"]);
      assert.equal(calls.length, 1);
      const plan = planOpenSpecInvocationV1({
        platform: item.platform,
        comSpec: item.comSpec,
        resolvedOpenSpec: item.resolved,
      });
      assert.equal(plan._tag, "Ok");
      if (plan._tag === "Ok") {
        assert.equal(calls[0]!.command, plan.command);
        assert.deepEqual(calls[0]!.args, plan.args);
      }
      assert.equal(calls[0]!.cwd, item.repository);
      assert.equal(calls[0]!.env?.PATH, expectedNodeDirectory);
      assert.equal(calls[0]!.maxOutputBytes, ONE_MIB);
      assert.equal(calls[0]!.timeoutMs, 30_000);
      const env = calls[0]!.env ?? {};
      assert.equal(env.NODE_OPTIONS, undefined);
      assert.equal(env.Node_V8_Coverage, undefined);
      assert.equal(env.Path, undefined);
      assert.equal(env.path, undefined);
      if (item.platform === "win32") {
        assert.equal(env.PATHEXT, ".EXE");
      } else {
        assert.equal(env.PATHEXT, undefined);
      }
    });
  }

  await t.test("missing stdoutBytes fails closed", async () => {
    let processCalls = 0;
    const repository = posix.join("/", "work", "repository");
    const openspec = posix.join("/", "opt", "openspec", "bin", "openspec");
    const nodeExecutable = posix.join("/", "usr", "bin", "node");
    const services = makeLiveReleaseCoverageCliServices({
      runCaptured: () => {
        processCalls += 1;
        const result: CapturedProcessResult = {
          exitCode: 0,
          stdout: '{"changes":[]}\n',
          stderr: "",
          stderrBytes: new Uint8Array(),
        };
        return Effect.succeed(result);
      },
      which: (name) =>
        name === "openspec" ? Effect.succeed(openspec) : Effect.succeed(null),
      realpath: (path) => Effect.succeed(path),
      findWorktreeRoot: (path) => Effect.succeed(repository),
      nodeExecutable,
      platform: "linux",
      comSpec: undefined,
      cwd: () => repository,
      nullDevice: "/dev/null",
      baseEnvironment: { PATH: "/safe/bin" },
    });
    const result = await Effect.runPromise(
      services.openspecList
        .listJson({
          repository,
          argv: ["list", "--json"],
          maxBytes: ONE_MIB,
        })
        .pipe(Effect.either),
    );
    assert.equal(result._tag, "Left");
    assert.equal(processCalls, 1);
  });
});

test("live repository-root adapter requires one exact LF-terminated raw path", async (t) => {
  const repository = resolve("release-coverage root-frame");
  const physicalGit =
    process.platform === "win32"
      ? win32.join("C:\\", "Program Files", "Git", "cmd", "git.exe")
      : posix.join("/", "usr", "bin", "git");
  const expectedGitDirectory =
    process.platform === "win32"
      ? win32.dirname(physicalGit)
      : posix.dirname(physicalGit);
  const frames: ReadonlyArray<{
    readonly name: string;
    readonly bytes?: Uint8Array;
    readonly valid: boolean;
  }> = [
    { name: "exact", bytes: utf8(`${repository}\n`), valid: true },
    { name: "missing-stdout-bytes", valid: false },
    { name: "missing-lf", bytes: utf8(repository), valid: false },
    { name: "crlf", bytes: utf8(`${repository}\r\n`), valid: false },
    { name: "second-line", bytes: utf8(`${repository}\nother\n`), valid: false },
    { name: "nul", bytes: utf8(`${repository}\0\n`), valid: false },
    { name: "tab", bytes: utf8(`${repository}\t\n`), valid: false },
    { name: "invalid-utf8", bytes: Uint8Array.of(0xff, 0x0a), valid: false },
  ];
  for (const frame of frames) {
    await t.test(frame.name, async () => {
      const calls: RunCapturedOptions[] = [];
      const dependencies: ReleaseCoverageLiveDependencies = {
        runCaptured: (input) => {
          calls.push(input);
          const captured: CapturedProcessResult = {
            exitCode: 0,
            stdout: `${repository}\n`,
            stderr: "",
            stderrBytes: new Uint8Array(),
            ...(frame.bytes === undefined ? {} : { stdoutBytes: frame.bytes }),
          };
          return Effect.succeed(captured);
        },
        which: (name) => {
          if (name === "git") return Effect.succeed(physicalGit);
          return Effect.die("unexpected OpenSpec lookup");
        },
        realpath: (path) => {
          if (path === physicalGit) return Effect.succeed(physicalGit);
          return Effect.succeed(path);
        },
        findWorktreeRoot: (path) => Effect.succeed(repository),
        nodeExecutable: process.execPath,
        platform: process.platform,
        comSpec: undefined,
        cwd: () => repository,
        nullDevice: devNull,
        baseEnvironment: {
          PATH: "/safe/bin",
          Path: "/hostile/mixed",
          PATHEXT: ".GIT",
          Pathext: ".Mixed",
          GIT_DIR: "/hostile/repository",
          git_dir: "/hostile/lower",
        },
      };
      const services = makeLiveReleaseCoverageCliServices(dependencies);
      const result = await Effect.runPromise(
        services.fileRead.resolveRepositoryRoot().pipe(Effect.either),
      );
      assert.equal(result._tag, frame.valid ? "Right" : "Left");
      if (result._tag === "Right") assert.equal(result.right, repository);
      assert.equal(calls.length, 1);
      const call = calls[0]!;
      assert.equal(call.command, physicalGit);
      assert.deepEqual(call.args, [
        "--no-replace-objects",
        "-c",
        "core.fsmonitor=false",
        "-c",
        `core.excludesFile=${devNull}`,
        "-C",
        repository,
        "rev-parse",
        "--show-toplevel",
      ]);
      assert.equal(call.maxOutputBytes, ONE_MIB);
      assert.equal(call.timeoutMs, 30_000);
      assert.equal(call.env?.PATH, expectedGitDirectory);
      assert.equal(call.env?.Path, undefined);
      assert.equal(call.env?.path, undefined);
      assert.equal(call.env?.Pathext, undefined);
      if (process.platform === "win32") {
        assert.equal(call.env?.PATHEXT, ".EXE");
      } else {
        assert.equal(call.env?.PATHEXT, undefined);
      }
      assert.equal(call.env?.GIT_DIR, undefined);
      assert.equal(call.env?.GIT_CONFIG_SYSTEM, undefined);
      assert.equal(call.env?.GIT_CONFIG_NOSYSTEM, "1");
      assert.equal(call.env?.GIT_CONFIG_GLOBAL, devNull);
      assert.equal(call.env?.GIT_NO_REPLACE_OBJECTS, "1");
      assert.equal(call.env?.GIT_TERMINAL_PROMPT, "0");
      assert.equal(call.env?.GIT_OPTIONAL_LOCKS, "0");
    });
  }
});

test("live Git adapter isolates config and inventories ignored planning files", async () => {
  const calls: RunCapturedOptions[] = [];
  const physicalRepository = win32.join("C:\\", "Physical", "Repository");
  const physicalGit = win32.join("C:\\", "Program Files", "Git", "cmd", "git.exe");
  const nullDevice = devNull;
  const hostile: NodeJS.ProcessEnv = {
    PATH: "/safe/bin",
    Path: "/hostile/mixed",
    path: "/hostile/lower",
    PATHEXT: ".GIT",
    Pathext: ".Mixed",
    GIT_DIR: "/hostile/git",
    git_dir: "/hostile/lower-git",
    GIT_WORK_TREE: "/hostile/worktree",
    GiT_WoRk_TrEe: "/hostile/mixed-worktree",
    GIT_INDEX_FILE: "/hostile/index",
    git_index_file: "/hostile/lower-index",
    GIT_CONFIG_GLOBAL: "/hostile/global",
    gIt_CoNfIg_GlObAl: "/hostile/mixed-global",
    GIT_CONFIG_SYSTEM: "/hostile/system",
    git_config_system: "/hostile/lower-system",
    LD_PRELOAD: "/hostile/libpreload.so",
    LD_LIBRARY_PATH: "/hostile/lib",
    DYLD_INSERT_LIBRARIES: "/hostile/inject.dylib",
    DYLD_LIBRARY_PATH: "/hostile/dyld",
    OPENSSL_CONF: "/hostile/openssl.cnf",
    BASH_ENV: "/hostile/bashrc",
    ENV: "/hostile/env",
    SHELLOPTS: "xtrace",
    HOME: "/hostile/home",
    XDG_CONFIG_HOME: "/hostile/xdg",
    USERPROFILE: "C:\\Hostile\\Profile",
    APPDATA: "C:\\Hostile\\AppData",
    LOCALAPPDATA: "C:\\Hostile\\Local",
    TMPDIR: "/hostile/tmp",
    TEMP: "C:\\Hostile\\Temp",
    TMP: "C:\\Hostile\\Tmp",
    COMSPEC: "C:\\Hostile\\cmd.exe",
    SystemRoot: "C:\\Hostile\\Windows",
    HTTP_PROXY: "http://hostile.example:8080",
    HTTPS_PROXY: "https://hostile.example:8443",
    ALL_PROXY: "socks5://hostile.example:1080",
    SSL_CERT_FILE: "/hostile/certs.pem",
    AWS_SECRET_ACCESS_KEY: "hostile-aws-secret",
    GITHUB_TOKEN: "hostile-github-token",
    npm_config_registry: "https://hostile.example/npm",
    FOREMAN_ENV_CANARY: "hostile-canary",
  };
  const hostileBefore = { ...hostile };
  const dependencies: ReleaseCoverageLiveDependencies = {
    runCaptured: (input) => {
      calls.push(input);
      return Effect.succeed({
        exitCode: 0,
        stdout: "",
        stderr: "",
        stdoutBytes: new Uint8Array(),
        stderrBytes: new Uint8Array(),
      });
    },
    which: (name) => {
      if (name === "git") return Effect.succeed(physicalGit);
      return Effect.die("unexpected OpenSpec lookup");
    },
    realpath: (path) => {
      if (path === REPO) return Effect.succeed(physicalRepository);
      if (path === physicalGit) return Effect.succeed(physicalGit);
      return Effect.succeed(path);
    },
    findWorktreeRoot: () => Effect.succeed(physicalRepository),
    nodeExecutable: win32.join("C:\\", "Program Files", "nodejs", "node.exe"),
    platform: "win32",
    comSpec: undefined,
    cwd: () => REPO,
    nullDevice,
    baseEnvironment: hostile,
  };
  const services = makeLiveReleaseCoverageCliServices(dependencies);
  const paths = await Effect.runPromise(
    services.gitChangedPaths.discover({
      repository: REPO,
      baselineCommit: BASELINE,
    }),
  );
  assert.deepEqual(paths, []);
  assert.deepEqual(hostile, hostileBefore);
  assert.equal(calls.length, 2);
  const fixedPrefix = [
    "--no-replace-objects",
    "-c",
    "core.fsmonitor=false",
    "-c",
    `core.excludesFile=${nullDevice}`,
    "-C",
    physicalRepository,
  ] as const;
  assert.deepEqual(calls[0]!.args, [
    ...fixedPrefix,
    "diff",
    "--name-only",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
    BASELINE,
    "--",
    "docs/superpowers/specs",
    "docs/superpowers/plans",
  ]);
  assert.deepEqual(calls[1]!.args, [
    ...fixedPrefix,
    "ls-files",
    "--others",
    "-z",
    "--",
    "docs/superpowers/specs",
    "docs/superpowers/plans",
  ]);
  const expectedEnv = {
    PATH: win32.dirname(physicalGit),
    PATHEXT: ".EXE",
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
  for (const call of calls) {
    assert.equal(call.command, physicalGit);
    assert.equal(call.maxOutputBytes, ONE_MIB);
    assert.equal(call.timeoutMs, 30_000);
    assert.deepEqual(call.env, expectedEnv);
  }
});

test("live Git adapter rejects missing or malformed raw NUL frames", async (t) => {
  const validLegacy = "docs/superpowers/plans/legacy.md\0";
  const physicalGit =
    process.platform === "win32"
      ? win32.join("C:\\", "Program Files", "Git", "cmd", "git.exe")
      : posix.join("/", "usr", "bin", "git");
  const badFrames: ReadonlyArray<{
    readonly name: string;
    readonly bytes?: Uint8Array;
  }> = [
    { name: "missing-stdout-bytes" },
    { name: "invalid-utf8", bytes: Uint8Array.of(0xff, 0x00) },
    {
      name: "missing-terminal-nul",
      bytes: utf8("docs/superpowers/plans/missing-terminal.md"),
    },
    {
      name: "interior-empty-record",
      bytes: utf8("docs/superpowers/plans/empty.md\0\0"),
    },
  ];
  for (const badCall of [0, 1] as const) {
    for (const frame of badFrames) {
      await t.test(
        `${badCall === 0 ? "tracked" : "untracked"}-${frame.name}`,
        async () => {
          let processCalls = 0;
          const services = makeLiveReleaseCoverageCliServices({
            runCaptured: () => {
              const callIndex = processCalls;
              processCalls += 1;
              if (callIndex !== badCall) {
                return Effect.succeed({
                  exitCode: 0,
                  stdout: "",
                  stderr: "",
                  stdoutBytes: new Uint8Array(),
                  stderrBytes: new Uint8Array(),
                });
              }
              const captured: CapturedProcessResult = {
                exitCode: 0,
                stdout: validLegacy,
                stderr: "",
                stderrBytes: new Uint8Array(),
                ...(frame.bytes === undefined ? {} : { stdoutBytes: frame.bytes }),
              };
              return Effect.succeed(captured);
            },
            which: (name) => {
              if (name === "git") return Effect.succeed(physicalGit);
              return Effect.die("unexpected OpenSpec lookup");
            },
            realpath: (path) => {
              if (path === physicalGit) return Effect.succeed(physicalGit);
              return Effect.succeed(path);
            },
            findWorktreeRoot: (path) => Effect.succeed(REPO),
            nodeExecutable: process.execPath,
            platform: process.platform,
            comSpec: undefined,
            cwd: () => REPO,
            nullDevice: devNull,
            baseEnvironment: { PATH: "/safe/bin" },
          });
          const result = await Effect.runPromise(
            services.gitChangedPaths
              .discover({ repository: REPO, baselineCommit: BASELINE })
              .pipe(Effect.either),
          );
          assert.equal(result._tag, "Left");
          assert.equal(
            processCalls >= badCall + 1 && processCalls <= 2,
            true,
          );
        },
      );
    }
  }
});

test("live OpenSpec adapter rejects an outside alias into the repository", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "release-coverage-openspec-alias-"));
  try {
    const repository = join(temporary, "repository");
    const outside = join(temporary, "outside");
    const windows = process.platform === "win32";
    const executableName = windows ? "openspec.cmd" : "openspec";
    const comSpec = windows ? "C:\\Windows\\System32\\cmd.exe" : undefined;
    mkdirSync(join(repository, "tools"), { recursive: true });
    mkdirSync(outside);
    const repositoryTool = join(repository, "tools", executableName);
    writeFileSync(repositoryTool, "repository-selected executable\n");
    const alias = join(outside, executableName);
    try {
      symlinkSync(repositoryTool, alias);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
        t.skip(`symlink creation not permitted: ${code}`);
        return;
      }
      throw error;
    }
    assert.equal(realpathSync(alias), realpathSync(repositoryTool));
    assert.equal(
      planOpenSpecInvocationV1({
        platform: process.platform,
        comSpec,
        resolvedOpenSpec: alias,
      })._tag,
      "Ok",
      "fixture must pass command planning before containment rejects it",
    );
    let processCalls = 0;
    const realpathCalls: string[] = [];
    const services = makeLiveReleaseCoverageCliServices({
      runCaptured: () => {
        processCalls += 1;
        return Effect.die("repository-selected executable ran");
      },
      which: (name) =>
        name === "openspec" ? Effect.succeed(alias) : Effect.succeed(null),
      realpath: (path) =>
        Effect.try({
          try: () => {
            realpathCalls.push(path);
            return realpathSync(path);
          },
          catch: (error) => error,
        }),
      findWorktreeRoot: (path) =>
        Effect.try({
          try: () => realpathSync(path),
          catch: (error) => error,
        }),
      nodeExecutable: process.execPath,
      platform: process.platform,
      comSpec,
      cwd: () => repository,
      nullDevice: devNull,
      baseEnvironment: process.env,
    });
    const result = await Effect.runPromise(
      services.openspecList
        .listJson({ repository, argv: ["list", "--json"], maxBytes: ONE_MIB })
        .pipe(Effect.either),
    );
    assert.equal(result._tag, "Left");
    assert.equal(realpathCalls.includes(repository), true);
    assert.equal(realpathCalls.includes(alias), true);
    assert.equal(processCalls, 0);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("live OpenSpec adapter rejects a physical ComSpec alias into the repository", async () => {
  const repository = win32.join("C:\\", "Work", "Repository");
  const physicalRepository = win32.join("C:\\", "Physical", "Repository");
  const comSpec = win32.join("C:\\", "External", "Windows", "cmd.exe");
  const physicalComSpec = win32.join(
    physicalRepository,
    "tools",
    "cmd.exe",
  );
  const resolved = win32.join("C:\\", "External", "OpenSpec", "openspec.cmd");
  const nodeExecutable = win32.join(
    "C:\\",
    "Program Files",
    "nodejs",
    "node.exe",
  );
  assert.equal(
    planOpenSpecInvocationV1({
      platform: "win32",
      comSpec,
      resolvedOpenSpec: resolved,
    })._tag,
    "Ok",
  );
  let processCalls = 0;
  const realpathCalls: string[] = [];
  const services = makeLiveReleaseCoverageCliServices({
    runCaptured: () => {
      processCalls += 1;
      return Effect.die("repository-selected ComSpec ran");
    },
    which: (name) =>
      name === "openspec" ? Effect.succeed(resolved) : Effect.succeed(null),
    realpath: (path) => {
      realpathCalls.push(path);
      if (path === repository) return Effect.succeed(physicalRepository);
      if (path === comSpec) return Effect.succeed(physicalComSpec);
      if (path === nodeExecutable) return Effect.succeed(nodeExecutable);
      return Effect.succeed(path);
    },
    findWorktreeRoot: () => Effect.succeed(physicalRepository),
    nodeExecutable,
    platform: "win32",
    comSpec,
    cwd: () => repository,
    nullDevice: "NUL",
    baseEnvironment: { PATH: "C:\\External\\OpenSpec" },
  });
  const result = await Effect.runPromise(
    services.openspecList
      .listJson({ repository, argv: ["list", "--json"], maxBytes: ONE_MIB })
      .pipe(Effect.either),
  );
  assert.equal(result._tag, "Left");
  assert.equal(realpathCalls.includes(repository), true);
  assert.equal(realpathCalls.includes(resolved), true);
  assert.equal(realpathCalls.includes(comSpec), true);
  assert.equal(processCalls, 0);
});

test(
  "live OpenSpec adapter executes the native Windows CMD plan",
  { skip: process.platform !== "win32" },
  async () => {
    const temporary = mkdtempSync(join(tmpdir(), "release-coverage-native-cmd-"));
    try {
      const repository = join(temporary, "repository");
      const toolDirectory = join(temporary, "OpenSpec Tool");
      mkdirSync(repository);
      mkdirSync(toolDirectory);
      const shim = join(toolDirectory, "openspec.cmd");
      writeFileSync(
        shim,
        [
          "@echo off",
          'if not "%~1"=="list" exit /b 91',
          'if not "%~2"=="--json" exit /b 92',
          'echo {"changes":[]}',
          "exit /b 0",
          "",
        ].join("\r\n"),
      );
      const comSpec = process.env.ComSpec ?? process.env.COMSPEC;
      if (comSpec === undefined) throw new Error("Windows ComSpec is unavailable");
      const services = makeLiveReleaseCoverageCliServices({
        runCaptured: (input) =>
          Effect.gen(function* () {
            const exec = yield* ProcessExec;
            return yield* exec.runCaptured(input);
          }).pipe(Effect.provide(liveProcessExec)),
        which: (name) =>
          name === "openspec" ? Effect.succeed(shim) : Effect.succeed(null),
        realpath: (path) =>
          Effect.try({
            try: () => realpathSync(path),
            catch: (error) => error,
          }),
        findWorktreeRoot: (path) =>
          Effect.try({
            try: () => realpathSync(path),
            catch: (error) => error,
          }),
        nodeExecutable: process.execPath,
        platform: "win32",
        comSpec,
        cwd: () => repository,
        nullDevice: devNull,
        baseEnvironment: process.env,
      });
      const bytes = await Effect.runPromise(
        services.openspecList.listJson({
          repository,
          argv: ["list", "--json"],
          maxBytes: ONE_MIB,
        }),
      );
      assert.equal(Buffer.from(bytes).toString("utf8"), '{"changes":[]}\r\n');
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Audit-correction RED: trusted Git / OpenSpec / Node live boundaries
// ---------------------------------------------------------------------------

const SCRIPT_TIMEOUT_MS = 5_000;

function emptyCaptured(): CapturedProcessResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    stdoutBytes: new Uint8Array(),
    stderrBytes: new Uint8Array(),
  };
}

function gitTopLevelCaptured(root: string): CapturedProcessResult {
  const bytes = utf8(`${root}\n`);
  return {
    exitCode: 0,
    stdout: `${root}\n`,
    stderr: "",
    stdoutBytes: bytes,
    stderrBytes: new Uint8Array(),
  };
}

function assertNoAlternatePathPathextOrPrefixedKeys(
  env: NodeJS.ProcessEnv,
  prefixes: readonly string[],
  allowedExact: ReadonlySet<string>,
): void {
  for (const name of Object.keys(env)) {
    const upper = name.toUpperCase();
    if (upper === "PATH" || upper === "PATHEXT") {
      assert.equal(
        name === upper,
        true,
        `alternate-case ${upper} survived: ${name}`,
      );
      continue;
    }
    for (const prefix of prefixes) {
      if (upper.startsWith(prefix)) {
        assert.equal(
          allowedExact.has(name),
          true,
          `hostile ${prefix}* variable survived: ${name}`,
        );
      }
    }
  }
}

test("live Git adapter resolves the worktree root before starting Git", async () => {
  const repository = posix.join("/", "work", "repository");
  const physicalRepository = posix.join("/", "physical", "repository");
  const physicalGit = posix.join("/", "usr", "bin", "git");
  const physicalNode = posix.join("/", "usr", "bin", "node");
  const order: string[] = [];
  const findCalls: string[] = [];
  let processCalls = 0;
  const dependencies: ReleaseCoverageLiveDependencies = {
    runCaptured: (input) => {
      processCalls += 1;
      order.push(`runCaptured:${String(input.command)}`);
      return Effect.succeed(gitTopLevelCaptured(physicalRepository));
    },
    which: (name) => {
      order.push(`which:${name}`);
      if (name === "git") return Effect.succeed(physicalGit);
      return Effect.succeed(null);
    },
    realpath: (path) => {
      order.push(`realpath:${path}`);
      if (path === repository) return Effect.succeed(physicalRepository);
      if (path === physicalGit) return Effect.succeed(physicalGit);
      return Effect.succeed(path);
    },
    findWorktreeRoot: (path) => {
      findCalls.push(path);
      order.push(`findWorktreeRoot:${path}`);
      return Effect.succeed(physicalRepository);
    },
    nodeExecutable: physicalNode,
    platform: "linux",
    comSpec: undefined,
    cwd: () => repository,
    nullDevice: "/dev/null",
    baseEnvironment: { PATH: "/safe/bin" },
  };
  const services = makeLiveReleaseCoverageCliServices(dependencies);
  const root = await Effect.runPromise(services.fileRead.resolveRepositoryRoot());
  assert.equal(root, physicalRepository);
  assert.deepEqual(findCalls, [repository]);
  assert.equal(order[0]?.startsWith("findWorktreeRoot:"), true);
  assert.equal(
    order.findIndex((step) => step.startsWith("runCaptured:")) >
      order.findIndex((step) => step.startsWith("findWorktreeRoot:")),
    true,
  );
  assert.equal(processCalls >= 1, true);
});

test("live Git adapter rejects a repository-local Git path before runCaptured", async () => {
  const repository = posix.join("/", "work", "repository");
  const physicalRepository = posix.join("/", "physical", "repository");
  const localGit = posix.join(physicalRepository, "tools", "git");
  const physicalNode = posix.join("/", "usr", "bin", "node");
  let processCalls = 0;
  const dependencies: ReleaseCoverageLiveDependencies = {
    runCaptured: () => {
      processCalls += 1;
      return Effect.die("repository-local Git ran");
    },
    which: (name) =>
      name === "git" ? Effect.succeed(localGit) : Effect.succeed(null),
    realpath: (path) => {
      if (path === repository) return Effect.succeed(physicalRepository);
      if (path === localGit) return Effect.succeed(localGit);
      return Effect.succeed(path);
    },
    findWorktreeRoot: () => Effect.succeed(physicalRepository),
    nodeExecutable: physicalNode,
    platform: "linux",
    comSpec: undefined,
    cwd: () => repository,
    nullDevice: "/dev/null",
    baseEnvironment: { PATH: "/safe/bin" },
  };
  const services = makeLiveReleaseCoverageCliServices(dependencies);
  const result = await Effect.runPromise(
    services.fileRead.resolveRepositoryRoot().pipe(Effect.either),
  );
  assert.equal(result._tag, "Left");
  assert.equal(processCalls, 0);
});

test("live Git adapter rejects an outside Git alias into the repository before runCaptured", async () => {
  const repository = posix.join("/", "work", "repository");
  const physicalRepository = posix.join("/", "physical", "repository");
  const alias = posix.join("/", "outside", "bin", "git");
  const physicalInside = posix.join(physicalRepository, "tools", "git");
  const physicalNode = posix.join("/", "usr", "bin", "node");
  let processCalls = 0;
  const dependencies: ReleaseCoverageLiveDependencies = {
    runCaptured: () => {
      processCalls += 1;
      return Effect.die("aliased repository Git ran");
    },
    which: (name) =>
      name === "git" ? Effect.succeed(alias) : Effect.succeed(null),
    realpath: (path) => {
      if (path === repository) return Effect.succeed(physicalRepository);
      if (path === alias) return Effect.succeed(physicalInside);
      return Effect.succeed(path);
    },
    findWorktreeRoot: () => Effect.succeed(physicalRepository),
    nodeExecutable: physicalNode,
    platform: "linux",
    comSpec: undefined,
    cwd: () => repository,
    nullDevice: "/dev/null",
    baseEnvironment: { PATH: "/safe/bin" },
  };
  const services = makeLiveReleaseCoverageCliServices(dependencies);
  const result = await Effect.runPromise(
    services.fileRead.resolveRepositoryRoot().pipe(Effect.either),
  );
  assert.equal(result._tag, "Left");
  assert.equal(processCalls, 0);
});

test("live Git adapter starts a safe outside physical Git target with a sealed environment", async () => {
  const repository = posix.join("/", "work", "repository");
  const physicalRepository = posix.join("/", "physical", "repository");
  const alias = posix.join("/", "outside", "alias", "git");
  const physicalGit = posix.join("/", "usr", "libexec", "git-core", "git");
  const physicalNode = posix.join("/", "usr", "bin", "node");
  const nullDevice = "/dev/null";
  const hostile: NodeJS.ProcessEnv = {
    PATH: "/hostile/bin",
    Path: "/hostile/mixed-bin",
    path: "/hostile/lower-bin",
    PATHEXT: ".GIT",
    Pathext: ".Mixed",
    GIT_DIR: "/hostile/git",
    git_dir: "/hostile/lower-git",
    GIT_WORK_TREE: "/hostile/worktree",
    GiT_WoRk_TrEe: "/hostile/mixed-worktree",
    LD_PRELOAD: "/hostile/libpreload.so",
    LD_LIBRARY_PATH: "/hostile/lib",
    DYLD_INSERT_LIBRARIES: "/hostile/inject.dylib",
    DYLD_LIBRARY_PATH: "/hostile/dyld",
    OPENSSL_CONF: "/hostile/openssl.cnf",
    BASH_ENV: "/hostile/bashrc",
    ENV: "/hostile/env",
    SHELLOPTS: "xtrace",
    HOME: "/hostile/home",
    XDG_CONFIG_HOME: "/hostile/xdg",
    USERPROFILE: "C:\\Hostile\\Profile",
    APPDATA: "C:\\Hostile\\AppData",
    LOCALAPPDATA: "C:\\Hostile\\Local",
    TMPDIR: "/hostile/tmp",
    TEMP: "C:\\Hostile\\Temp",
    TMP: "C:\\Hostile\\Tmp",
    COMSPEC: "C:\\Hostile\\cmd.exe",
    SystemRoot: "C:\\Hostile\\Windows",
    HTTP_PROXY: "http://hostile.example:8080",
    HTTPS_PROXY: "https://hostile.example:8443",
    ALL_PROXY: "socks5://hostile.example:1080",
    SSL_CERT_FILE: "/hostile/certs.pem",
    AWS_SECRET_ACCESS_KEY: "hostile-aws-secret",
    GITHUB_TOKEN: "hostile-github-token",
    npm_config_registry: "https://hostile.example/npm",
    FOREMAN_ENV_CANARY: "hostile-canary",
  };
  const hostileBefore = { ...hostile };
  const calls: RunCapturedOptions[] = [];
  const dependencies: ReleaseCoverageLiveDependencies = {
    runCaptured: (input) => {
      calls.push(input);
      if (calls.length === 1) {
        return Effect.succeed(gitTopLevelCaptured(physicalRepository));
      }
      return Effect.succeed(emptyCaptured());
    },
    which: (name) =>
      name === "git" ? Effect.succeed(alias) : Effect.succeed(null),
    realpath: (path) => {
      if (path === repository) return Effect.succeed(physicalRepository);
      if (path === alias) return Effect.succeed(physicalGit);
      return Effect.succeed(path);
    },
    findWorktreeRoot: () => Effect.succeed(physicalRepository),
    nodeExecutable: physicalNode,
    platform: "linux",
    comSpec: undefined,
    cwd: () => repository,
    nullDevice,
    baseEnvironment: hostile,
  };
  const services = makeLiveReleaseCoverageCliServices(dependencies);
  const root = await Effect.runPromise(services.fileRead.resolveRepositoryRoot());
  assert.equal(root, physicalRepository);
  const paths = await Effect.runPromise(
    services.gitChangedPaths.discover({
      repository,
      baselineCommit: BASELINE,
    }),
  );
  assert.deepEqual(paths, []);
  assert.deepEqual(hostile, hostileBefore);
  assert.equal(calls.length, 3);
  const expectedEnv = {
    PATH: posix.dirname(physicalGit),
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
  for (const call of calls) {
    assert.equal(call.command, physicalGit);
    assert.equal(call.args.includes("-C"), true);
    const cIndex = call.args.indexOf("-C");
    assert.equal(call.args[cIndex + 1], physicalRepository);
    assert.equal(call.maxOutputBytes, ONE_MIB);
    assert.equal(call.timeoutMs, 30_000);
    assert.deepEqual(call.env, expectedEnv);
  }
});

test("live Git adapter rejects a Git-reported root that differs from the physical root", async () => {
  const repository = posix.join("/", "work", "repository");
  const physicalRepository = posix.join("/", "physical", "repository");
  const reportedRoot = posix.join("/", "other", "repository");
  const physicalGit = posix.join("/", "usr", "bin", "git");
  const physicalNode = posix.join("/", "usr", "bin", "node");
  const dependencies: ReleaseCoverageLiveDependencies = {
    runCaptured: () => Effect.succeed(gitTopLevelCaptured(reportedRoot)),
    which: (name) =>
      name === "git" ? Effect.succeed(physicalGit) : Effect.succeed(null),
    realpath: (path) => {
      if (path === repository) return Effect.succeed(physicalRepository);
      if (path === reportedRoot) return Effect.succeed(reportedRoot);
      if (path === physicalGit) return Effect.succeed(physicalGit);
      return Effect.succeed(path);
    },
    findWorktreeRoot: () => Effect.succeed(physicalRepository),
    nodeExecutable: physicalNode,
    platform: "linux",
    comSpec: undefined,
    cwd: () => repository,
    nullDevice: "/dev/null",
    baseEnvironment: { PATH: "/safe/bin" },
  };
  const services = makeLiveReleaseCoverageCliServices(dependencies);
  const result = await Effect.runPromise(
    services.fileRead.resolveRepositoryRoot().pipe(Effect.either),
  );
  assert.equal(result._tag, "Left");
});

test("live CLI rejects an explicit Lane or Release repository that is not the discovered root before a subprocess starts", async (t) => {
  const temporary = mkdtempSync(
    join(tmpdir(), "release-coverage-repo-mismatch-"),
  );
  try {
    const discovered = join(temporary, "discovered");
    const explicit = join(temporary, "explicit");
    mkdirSync(discovered);
    mkdirSync(explicit);
    const registerPath = join(temporary, "coverage.toml");
    const roadmapBytes = utf8(roadmapText(false));
    writeFileSync(
      registerPath,
      sealRegister({
        activeNames: [TRACK1],
        roadmapBytes,
        packageReconcile: "complete",
      }),
      "utf8",
    );
    for (const phase of ["lane", "release"] as const) {
      await t.test(phase, async () => {
        let processCalls = 0;
        let whichCalls = 0;
        const findCalls: string[] = [];
        let stdout = "";
        let stderr = "";
        const dependencies: ReleaseCoverageLiveDependencies = {
          runCaptured: () => {
            processCalls += 1;
            return Effect.die("subprocess started for mismatched repository");
          },
          which: () => {
            whichCalls += 1;
            return Effect.die("which should not run");
          },
          realpath: (path) => Effect.succeed(path),
          findWorktreeRoot: (path) => {
            findCalls.push(path);
            return Effect.succeed(discovered);
          },
          nodeExecutable: process.execPath,
          platform: process.platform,
          comSpec: undefined,
          cwd: () => discovered,
          nullDevice: devNull,
          baseEnvironment: { PATH: "/safe/bin" },
        };
        const services = makeLiveReleaseCoverageCliServices(dependencies);
        const io: ReleaseCoverageCliIo = {
          writeStdout: (text) => {
            stdout += text;
          },
          writeStderr: (text) => {
            stderr += text;
          },
        };
        const tail =
          phase === "lane"
            ? ([
                "check",
                "--program",
                "v040",
                "--phase",
                "lane",
                "--owner",
                PACKAGE,
                "--repo",
                explicit,
                "--state-root",
                STATE_ROOT,
                "--contract-id",
                CONTRACT_ID,
                "--contract-sha",
                CONTRACT_SHA,
                "--family-sha",
                FAMILY_SHA,
                "--register",
                registerPath,
              ] as const)
            : ([
                "check",
                "--program",
                "v040",
                "--phase",
                "release",
                "--repo",
                explicit,
                "--state-root",
                STATE_ROOT,
                "--contract-id",
                CONTRACT_ID,
                "--contract-sha",
                CONTRACT_SHA,
                "--family-sha",
                FAMILY_SHA,
                "--register",
                registerPath,
              ] as const);
        const code = await Effect.runPromise(
          runReleaseCoverageCli(processArgv(tail), io, services),
        );
        assert.equal(code, EXIT_EVALUATED);
        assert.equal(
          stdout,
          `${canonicalize(invalidResult("dependency_failure"))}\n`,
        );
        assert.equal(stderr, "");
        assert.deepEqual(findCalls, [explicit]);
        assert.equal(whichCalls, 0);
        assert.equal(processCalls, 0);
      });
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("live OpenSpec adapter resolves physical OpenSpec, Node, and ComSpec targets", async (t) => {
  const cases = [
    {
      name: "posix",
      platform: "linux" as const,
      comSpec: undefined as string | undefined,
      repository: posix.join("/", "work", "repository"),
      physicalRepository: posix.join("/", "physical", "repository"),
      lexicalOpenSpec: posix.join("/", "alias", "bin", "openspec"),
      physicalOpenSpec: posix.join("/", "opt", "openspec", "bin", "openspec"),
      lexicalNode: posix.join("/", "alias", "bin", "node"),
      physicalNode: posix.join("/", "usr", "bin", "node"),
      physicalComSpec: undefined as string | undefined,
      nullDevice: "/dev/null",
    },
    {
      name: "windows",
      platform: "win32" as const,
      comSpec: win32.join("C:\\", "Alias", "Windows", "cmd.exe"),
      repository: win32.join("C:\\", "Work", "Repository"),
      physicalRepository: win32.join("C:\\", "Physical", "Repository"),
      lexicalOpenSpec: win32.join("C:\\", "Alias", "OpenSpec", "openspec.cmd"),
      physicalOpenSpec: win32.join("C:\\", "Tools", "OpenSpec", "openspec.cmd"),
      lexicalNode: win32.join("C:\\", "Alias", "Node", "node.exe"),
      physicalNode: win32.join("C:\\", "Program Files", "nodejs", "node.exe"),
      physicalComSpec: win32.join("C:\\", "Windows", "System32", "cmd.exe"),
      nullDevice: "NUL",
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const hostile: NodeJS.ProcessEnv = {
        PATH: "/hostile/bin",
        Path: "/hostile/mixed",
        path: "/hostile/lower",
        PATHEXT: ".NODE",
        Pathext: ".Mixed",
        NODE_OPTIONS: "--require=/hostile/preload.js",
        node_options: "--require=/hostile/lower.js",
        NODE_PATH: "/hostile/node_modules",
        Node_Path: "/hostile/mixed_modules",
        Node_V8_Coverage: "/hostile/v8",
        LD_PRELOAD: "/hostile/libpreload.so",
        LD_LIBRARY_PATH: "/hostile/lib",
        DYLD_INSERT_LIBRARIES: "/hostile/inject.dylib",
        DYLD_LIBRARY_PATH: "/hostile/dyld",
        OPENSSL_CONF: "/hostile/openssl.cnf",
        BASH_ENV: "/hostile/bashrc",
        ENV: "/hostile/env",
        SHELLOPTS: "xtrace",
        HOME: "/hostile/home",
        XDG_CONFIG_HOME: "/hostile/xdg",
        USERPROFILE: "C:\\Hostile\\Profile",
        APPDATA: "C:\\Hostile\\AppData",
        LOCALAPPDATA: "C:\\Hostile\\Local",
        TMPDIR: "/hostile/tmp",
        TEMP: "C:\\Hostile\\Temp",
        TMP: "C:\\Hostile\\Tmp",
        COMSPEC: "C:\\Hostile\\cmd.exe",
        SystemRoot: "C:\\Hostile\\Windows",
        HTTP_PROXY: "http://hostile.example:8080",
        HTTPS_PROXY: "https://hostile.example:8443",
        ALL_PROXY: "socks5://hostile.example:1080",
        SSL_CERT_FILE: "/hostile/certs.pem",
        AWS_SECRET_ACCESS_KEY: "hostile-aws-secret",
        GITHUB_TOKEN: "hostile-github-token",
        npm_config_registry: "https://hostile.example/npm",
        FOREMAN_ENV_CANARY: "hostile-canary",
        OPENSPEC_TELEMETRY: "1",
        OPENSPEC_NO_UPDATE_CHECK: "0",
        OPEN_SPEC_INTERACTIVE: "1",
        NO_COLOR: "0",
        FORCE_COLOR: "1",
      };
      const hostileBefore = { ...hostile };
      const calls: RunCapturedOptions[] = [];
      const realpathCalls: string[] = [];
      const expectedNodeDirectory =
        item.platform === "win32"
          ? win32.dirname(item.physicalNode)
          : posix.dirname(item.physicalNode);
      const dependencies: ReleaseCoverageLiveDependencies = {
        runCaptured: (input) => {
          calls.push(input);
          return Effect.succeed({
            exitCode: 0,
            stdout: "\uFFFD",
            stderr: "",
            stdoutBytes: Uint8Array.of(0xff),
            stderrBytes: new Uint8Array(),
          });
        },
        which: (name) => {
          if (name === "openspec") return Effect.succeed(item.lexicalOpenSpec);
          return Effect.succeed(null);
        },
        realpath: (path) => {
          realpathCalls.push(path);
          if (path === item.repository) {
            return Effect.succeed(item.physicalRepository);
          }
          if (path === item.lexicalOpenSpec) {
            return Effect.succeed(item.physicalOpenSpec);
          }
          if (path === item.lexicalNode || path === item.physicalNode) {
            return Effect.succeed(item.physicalNode);
          }
          if (
            item.platform === "win32" &&
            path === item.comSpec &&
            item.physicalComSpec !== undefined
          ) {
            return Effect.succeed(item.physicalComSpec);
          }
          return Effect.succeed(path);
        },
        findWorktreeRoot: () => Effect.succeed(item.physicalRepository),
        nodeExecutable: item.lexicalNode,
        platform: item.platform,
        comSpec: item.comSpec,
        cwd: () => item.repository,
        nullDevice: item.nullDevice,
        baseEnvironment: hostile,
      };
      const services = makeLiveReleaseCoverageCliServices(dependencies);
      const bytes = await Effect.runPromise(
        services.openspecList.listJson({
          repository: item.repository,
          argv: ["list", "--json"],
          maxBytes: ONE_MIB,
        }),
      );
      assert.deepEqual(bytes, Uint8Array.of(0xff));
      assert.deepEqual(hostile, hostileBefore);
      assert.equal(calls.length, 1);
      assert.equal(realpathCalls.includes(item.repository), true);
      assert.equal(realpathCalls.includes(item.lexicalOpenSpec), true);
      assert.equal(
        realpathCalls.includes(item.lexicalNode) ||
          realpathCalls.includes(item.physicalNode),
        true,
      );
      if (item.platform === "win32") {
        assert.equal(realpathCalls.includes(item.comSpec!), true);
        assert.equal(calls[0]!.command, item.physicalComSpec);
        assert.equal(
          calls[0]!.args.some(
            (arg) =>
              typeof arg === "string" && arg.includes(item.physicalOpenSpec),
          ),
          true,
        );
        assert.equal(calls[0]!.command === item.comSpec, false);
        assert.equal(
          calls[0]!.args.some(
            (arg) =>
              typeof arg === "string" &&
              arg.includes(item.lexicalOpenSpec) &&
              !arg.includes(item.physicalOpenSpec),
          ),
          false,
        );
      } else {
        assert.equal(calls[0]!.command, item.physicalOpenSpec);
        assert.equal(calls[0]!.command === item.lexicalOpenSpec, false);
      }
      assert.equal(calls[0]!.cwd, item.physicalRepository);
      assert.equal(calls[0]!.maxOutputBytes, ONE_MIB);
      assert.equal(calls[0]!.timeoutMs, 30_000);
      assert.deepEqual(calls[0]!.env, {
        PATH: expectedNodeDirectory,
        ...(item.platform === "win32" ? { PATHEXT: ".EXE" } : {}),
        LANG: "C",
        LC_ALL: "C",
        OPENSPEC_TELEMETRY: "0",
        OPENSPEC_NO_UPDATE_CHECK: "1",
        OPEN_SPEC_INTERACTIVE: "0",
        NO_COLOR: "1",
      });
    });
  }
});

test("live OpenSpec adapter replans and rejects unsafe physical Windows targets before spawn", async (t) => {
  const repository = win32.join("C:\\", "Work", "Repository");
  const physicalRepository = win32.join("C:\\", "Physical", "Repository");
  const lexicalOpenSpec = win32.join(
    "C:\\",
    "Tools",
    "OpenSpec",
    "openspec.cmd",
  );
  const safePhysicalOpenSpec = win32.join(
    "C:\\",
    "Program Files",
    "OpenSpec",
    "openspec.cmd",
  );
  const unsafePhysicalOpenSpec = win32.join(
    "C:\\",
    "Tools&Bin",
    "OpenSpec",
    "openspec.cmd",
  );
  const lexicalComSpec = win32.join("C:\\", "Windows", "System32", "cmd.exe");
  const safePhysicalComSpec = win32.join(
    "C:\\",
    "Windows",
    "System32",
    "cmd.exe",
  );
  const unsafePhysicalComSpec = win32.join(
    "C:\\",
    "Windows&System",
    "System32",
    "cmd.exe",
  );
  const lexicalNode = win32.join("C:\\", "Alias", "Node", "node.exe");
  const physicalNode = win32.join(
    "C:\\",
    "Program Files",
    "nodejs",
    "node.exe",
  );
  const cases = [
    {
      name: "physical OpenSpec directory contains &",
      physicalOpenSpec: unsafePhysicalOpenSpec,
      physicalComSpec: safePhysicalComSpec,
    },
    {
      name: "physical ComSpec directory contains &",
      physicalOpenSpec: safePhysicalOpenSpec,
      physicalComSpec: unsafePhysicalComSpec,
    },
  ] as const;

  for (const item of cases) {
    await t.test(item.name, async () => {
      assert.equal(
        planOpenSpecInvocationV1({
          platform: "win32",
          comSpec: lexicalComSpec,
          resolvedOpenSpec: lexicalOpenSpec,
        })._tag,
        "Ok",
      );
      assert.deepEqual(
        planOpenSpecInvocationV1({
          platform: "win32",
          comSpec: item.physicalComSpec,
          resolvedOpenSpec: item.physicalOpenSpec,
        }),
        { _tag: "Invalid" },
      );
      let processCalls = 0;
      const dependencies: ReleaseCoverageLiveDependencies = {
        runCaptured: () => {
          processCalls += 1;
          return Effect.die("unsafe physical Windows target ran");
        },
        which: (name) =>
          name === "openspec"
            ? Effect.succeed(lexicalOpenSpec)
            : Effect.succeed(null),
        realpath: (path) => {
          if (path === repository) return Effect.succeed(physicalRepository);
          if (path === lexicalOpenSpec) {
            return Effect.succeed(item.physicalOpenSpec);
          }
          if (path === lexicalNode || path === physicalNode) {
            return Effect.succeed(physicalNode);
          }
          if (path === lexicalComSpec) {
            return Effect.succeed(item.physicalComSpec);
          }
          return Effect.succeed(path);
        },
        findWorktreeRoot: () => Effect.succeed(physicalRepository),
        nodeExecutable: lexicalNode,
        platform: "win32",
        comSpec: lexicalComSpec,
        cwd: () => repository,
        nullDevice: "NUL",
        baseEnvironment: { PATH: win32.join("C:\\", "safe", "bin") },
      };
      const result = await Effect.runPromise(
        makeLiveReleaseCoverageCliServices(dependencies)
          .openspecList.listJson({
            repository,
            argv: ["list", "--json"],
            maxBytes: ONE_MIB,
          })
          .pipe(Effect.either),
      );
      assert.equal(result._tag, "Left");
      assert.equal(processCalls, 0);
    });
  }
});

test("live OpenSpec adapter rejects a Node executable inside the repository before a subprocess starts", async () => {
  const repository = posix.join("/", "work", "repository");
  const physicalRepository = posix.join("/", "physical", "repository");
  const openspec = posix.join("/", "opt", "openspec", "bin", "openspec");
  const nodeInside = posix.join(physicalRepository, "tools", "node");
  let processCalls = 0;
  const dependencies: ReleaseCoverageLiveDependencies = {
    runCaptured: () => {
      processCalls += 1;
      return Effect.die("repository Node ran");
    },
    which: (name) =>
      name === "openspec" ? Effect.succeed(openspec) : Effect.succeed(null),
    realpath: (path) => {
      if (path === repository) return Effect.succeed(physicalRepository);
      if (path === openspec) return Effect.succeed(openspec);
      if (path === nodeInside) return Effect.succeed(nodeInside);
      return Effect.succeed(path);
    },
    findWorktreeRoot: () => Effect.succeed(physicalRepository),
    nodeExecutable: nodeInside,
    platform: "linux",
    comSpec: undefined,
    cwd: () => repository,
    nullDevice: "/dev/null",
    baseEnvironment: { PATH: "/safe/bin" },
  };
  const services = makeLiveReleaseCoverageCliServices(dependencies);
  const result = await Effect.runPromise(
    services.openspecList
      .listJson({
        repository,
        argv: ["list", "--json"],
        maxBytes: ONE_MIB,
      })
      .pipe(Effect.either),
  );
  assert.equal(result._tag, "Left");
  assert.equal(processCalls, 0);
});

test("live OpenSpec adapter rejects an outside Node alias into the repository before a subprocess starts", async () => {
  const repository = posix.join("/", "work", "repository");
  const physicalRepository = posix.join("/", "physical", "repository");
  const openspec = posix.join("/", "opt", "openspec", "bin", "openspec");
  const nodeAlias = posix.join("/", "outside", "bin", "node");
  const nodeInside = posix.join(physicalRepository, "tools", "node");
  let processCalls = 0;
  const dependencies: ReleaseCoverageLiveDependencies = {
    runCaptured: () => {
      processCalls += 1;
      return Effect.die("aliased repository Node ran");
    },
    which: (name) =>
      name === "openspec" ? Effect.succeed(openspec) : Effect.succeed(null),
    realpath: (path) => {
      if (path === repository) return Effect.succeed(physicalRepository);
      if (path === openspec) return Effect.succeed(openspec);
      if (path === nodeAlias) return Effect.succeed(nodeInside);
      return Effect.succeed(path);
    },
    findWorktreeRoot: () => Effect.succeed(physicalRepository),
    nodeExecutable: nodeAlias,
    platform: "linux",
    comSpec: undefined,
    cwd: () => repository,
    nullDevice: "/dev/null",
    baseEnvironment: { PATH: "/safe/bin" },
  };
  const services = makeLiveReleaseCoverageCliServices(dependencies);
  const result = await Effect.runPromise(
    services.openspecList
      .listJson({
        repository,
        argv: ["list", "--json"],
        maxBytes: ONE_MIB,
      })
      .pipe(Effect.either),
  );
  assert.equal(result._tag, "Left");
  assert.equal(processCalls, 0);
});

test(
  "live OpenSpec adapter ignores repository-first PATH for a POSIX env-node shim",
  { skip: process.platform === "win32" },
  async () => {
    const temporary = mkdtempSync(
      join(tmpdir(), "release-coverage-openspec-env-node-"),
    );
    try {
      const repository = join(temporary, "repository");
      const outside = join(temporary, "outside");
      mkdirSync(repository);
      mkdirSync(outside);
      const sentinel = join(repository, "node-sentinel.txt");
      const maliciousNode = join(repository, "node");
      writeFileSync(
        maliciousNode,
        [
          "#!/bin/sh",
          `printf 'pwned' > ${JSON.stringify(sentinel)}`,
          "exit 0",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      chmodSync(maliciousNode, 0o755);
      const openspec = join(outside, "openspec");
      const payload = '{"changes":[]}\n';
      writeFileSync(
        openspec,
        [
          "#!/usr/bin/env node",
          `process.stdout.write(${JSON.stringify(payload)});`,
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      chmodSync(openspec, 0o755);
      const expected = utf8(payload);
      const dependencies: ReleaseCoverageLiveDependencies = {
        runCaptured: (input) =>
          Effect.gen(function* () {
            const exec = yield* ProcessExec;
            return yield* exec.runCaptured(input);
          }).pipe(Effect.provide(liveProcessExec)),
        which: (name) =>
          name === "openspec" ? Effect.succeed(openspec) : Effect.succeed(null),
        realpath: (path) =>
          Effect.try({
            try: () => realpathSync(path),
            catch: (error) => error,
          }),
        findWorktreeRoot: (path) =>
          Effect.try({
            try: () => realpathSync(path),
            catch: (error) => error,
          }),
        nodeExecutable: process.execPath,
        platform: process.platform,
        comSpec: undefined,
        cwd: () => repository,
        nullDevice: devNull,
        baseEnvironment: {
          PATH: `${repository}${delimiter}${dirname(process.execPath)}`,
          NODE_OPTIONS: "--require=/nonexistent/preload.js",
          LD_DEBUG: "libs",
          LD_DEBUG_OUTPUT: join(repository, "loader-trace"),
        },
      };
      const services = makeLiveReleaseCoverageCliServices(dependencies);
      const bytes = await Effect.runPromise(
        services.openspecList.listJson({
          repository,
          argv: ["list", "--json"],
          maxBytes: ONE_MIB,
        }),
      );
      assert.deepEqual(bytes, expected);
      assert.equal(existsSync(sentinel), false);
      assert.equal(
        readdirSync(repository).some((name) => name.startsWith("loader-trace")),
        false,
      );
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);

test(
  "live OpenSpec adapter ignores hostile PATH and PATHEXT for a native Windows node .cmd shim",
  { skip: process.platform !== "win32" },
  async () => {
    const temporary = mkdtempSync(
      join(tmpdir(), "release-coverage-openspec-win-node-"),
    );
    try {
      const repository = join(temporary, "repository");
      const outside = join(temporary, "outside");
      mkdirSync(repository);
      mkdirSync(outside);
      const sentinel = join(repository, "node-sentinel.txt");
      const maliciousNode = join(repository, "node.cmd");
      writeFileSync(
        maliciousNode,
        [
          "@echo off",
          `echo pwned> "${sentinel}"`,
          "exit /b 0",
          "",
        ].join("\r\n"),
      );
      const openspecJs = join(outside, "openspec.js");
      const openspec = join(outside, "openspec.cmd");
      const payload = '{"changes":[]}\r\n';
      writeFileSync(
        openspecJs,
        [
          "const args = process.argv.slice(2);",
          "if (args.length !== 2 || args[0] !== 'list' || args[1] !== '--json') {",
          "  process.exit(91);",
          "}",
          `process.stdout.write(${JSON.stringify(payload)});`,
          "",
        ].join("\n"),
      );
      writeFileSync(
        openspec,
        [
          "@echo off",
          'node "%~dp0\\openspec.js" %*',
          "exit /b %ERRORLEVEL%",
          "",
        ].join("\r\n"),
      );
      const comSpec = process.env.ComSpec ?? process.env.COMSPEC;
      if (comSpec === undefined) throw new Error("Windows ComSpec is unavailable");
      const expected = utf8(payload);
      const expectedOpenSpecEnv = {
        PATH: win32.dirname(process.execPath),
        PATHEXT: ".EXE",
        LANG: "C",
        LC_ALL: "C",
        OPENSPEC_TELEMETRY: "0",
        OPENSPEC_NO_UPDATE_CHECK: "1",
        OPEN_SPEC_INTERACTIVE: "0",
        NO_COLOR: "1",
      };
      const dependencies: ReleaseCoverageLiveDependencies = {
        runCaptured: (input) =>
          Effect.gen(function* () {
            assert.deepEqual(input.env, expectedOpenSpecEnv);
            const exec = yield* ProcessExec;
            return yield* exec.runCaptured(input);
          }).pipe(Effect.provide(liveProcessExec)),
        which: (name) =>
          name === "openspec" ? Effect.succeed(openspec) : Effect.succeed(null),
        realpath: (path) =>
          Effect.try({
            try: () => realpathSync(path),
            catch: (error) => error,
          }),
        findWorktreeRoot: (path) =>
          Effect.try({
            try: () => realpathSync(path),
            catch: (error) => error,
          }),
        nodeExecutable: process.execPath,
        platform: "win32",
        comSpec,
        cwd: () => repository,
        nullDevice: devNull,
        baseEnvironment: {
          PATH: `${repository}${delimiter}${dirname(process.execPath)}`,
          PATHEXT: `.CMD${delimiter}.EXE`,
          NODE_OPTIONS: "--require=C:\\hostile\\preload.js",
        },
      };
      const services = makeLiveReleaseCoverageCliServices(dependencies);
      const bytes = await Effect.runPromise(
        services.openspecList.listJson({
          repository,
          argv: ["list", "--json"],
          maxBytes: ONE_MIB,
        }),
      );
      assert.deepEqual(bytes, expected);
      assert.equal(existsSync(sentinel), false);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Moved from queue-services.test.ts (Track 1 allowlist relocation)
// ---------------------------------------------------------------------------

function runCaptured(
  opts: RunCapturedOptions,
): Effect.Effect<CapturedProcessResult, ProcessFailure> {
  return Effect.gen(function* () {
    const exec = yield* ProcessExec;
    return yield* exec.runCaptured(opts);
  }).pipe(Effect.provide(liveProcessExec));
}

test("runCaptured preserves UTF-8 stdout and stderr string fields", async () => {
  const result = await Effect.runPromise(
    runCaptured({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('hello'); process.stderr.write('err');",
      ],
      maxOutputBytes: 64,
      timeoutMs: SCRIPT_TIMEOUT_MS,
    }),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello");
  assert.equal(result.stderr, "err");
});

test("runCaptured accepts an exact output bound", async () => {
  const payload = "x".repeat(64);
  const result = await Effect.runPromise(
    runCaptured({
      command: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(payload)})`],
      maxOutputBytes: 64,
      timeoutMs: SCRIPT_TIMEOUT_MS,
    }),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, payload);
});

test("runCaptured fails with output_bound on max-plus-one raw bytes", async () => {
  const either = await Effect.runPromise(
    runCaptured({
      command: process.execPath,
      args: ["-e", "process.stdout.write(Buffer.alloc(65, 1))"],
      maxOutputBytes: 64,
      timeoutMs: SCRIPT_TIMEOUT_MS,
    }).pipe(Effect.either),
  );
  assert.equal(either._tag, "Left");
  if (either._tag === "Left") {
    assert.ok(either.left instanceof ProcessFailure);
    assert.equal(either.left.reason, "output_bound");
  }
});

test("runCaptured preserves exact stdoutBytes for raw 0xff", async () => {
  const result = await Effect.runPromise(
    runCaptured({
      command: process.execPath,
      args: ["-e", "process.stdout.write(Buffer.from([0xff]))"],
      maxOutputBytes: 16,
      timeoutMs: SCRIPT_TIMEOUT_MS,
    }),
  );
  assert.equal(result.exitCode, 0);
  const withBytes = result as CapturedProcessResult & {
    readonly stdoutBytes: Uint8Array;
  };
  assert.deepEqual(Array.from(withBytes.stdoutBytes), [255]);
});

test("general bounded reader accepts a regular file through a symlinked ancestor", (t) => {
  const realRoot = mkdtempSync(join(tmpdir(), "queue-bounded-real-"));
  const aliasRoot = mkdtempSync(join(tmpdir(), "queue-bounded-alias-"));
  try {
    const realDirectory = join(realRoot, "real-directory");
    mkdirSync(realDirectory);
    const expected = "portable authority\n";
    writeFileSync(join(realDirectory, "config.txt"), expected);
    const aliasDirectory = join(aliasRoot, "alias-directory");
    try {
      symlinkSync(
        realDirectory,
        aliasDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
        t.skip(`symlink creation not permitted: ${code}`);
        return;
      }
      throw error;
    }
    assert.deepEqual(
      readFileBoundedSync(join(aliasDirectory, "config.txt"), 1_024),
      { _tag: "Ok", text: expected },
    );
  } finally {
    rmSync(aliasRoot, { recursive: true, force: true });
    rmSync(realRoot, { recursive: true, force: true });
  }
});
