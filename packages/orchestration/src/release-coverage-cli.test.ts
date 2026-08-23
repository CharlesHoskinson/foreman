import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
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

const REPO = "/abs/repo";
const STATE_ROOT = "/abs/state";
/** Absolute register path outside the repository root — bootstrap must not infer repo from it. */
const REGISTER = "/abs/register-host/coverage.toml";
const SCRIPT = "/abs/release-coverage.js";

const CONTRACT_ID = "v040-release-20260822-r3";
const CONTRACT_SHA =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FAMILY_SHA =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BASELINE = "bb5c8c2345ac5524ebb9c6a7de0fe16b17242195";

const ROADMAP_ABS = `${REPO}/ROADMAP.md`;
const TRACK1_WORKFLOW_ABS = `${REPO}/openspec/changes/${TRACK1}/.openspec.yaml`;
const PACKAGE_WORKFLOW_ABS = `${REPO}/openspec/changes/${PACKAGE}/.openspec.yaml`;
const PACKAGE_BRIEF_ABS = `${REPO}/openspec/changes/${PACKAGE}/release-brief.json`;
const TRACK1_BRIEF_ABS = `${REPO}/openspec/changes/${TRACK1}/release-brief.json`;
const BRIEF_REL = `openspec/changes/${PACKAGE}/release-brief.json`;

const SECRET = "/secret/private/path";

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

const FAMILY_CHILD = {
  childId: CHILD_ID,
  packageId: PACKAGE,
  objective: "Ship the project registry lane.",
  acceptance: ["Registry resolves stable project identity."],
  allowedPaths: ["packages/orchestration/**", "packages/policy/**"],
} as const;

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
  readonly childId: string;
  readonly packageId: string;
  readonly objective: string;
  readonly acceptance: readonly string[];
  readonly allowedPaths: readonly string[];
};

type FamilyResult = {
  readonly stateRoot: string;
  readonly contractId: string;
  readonly contractSha256: string;
  readonly familySha256: string;
  readonly children: readonly FamilyChild[];
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
  readonly openspecError?: Error;
  readonly openspecThrow?: boolean;
  readonly gitError?: Error;
  readonly gitThrow?: boolean;
  readonly fileErrorByPath?: ReadonlyMap<string, Error>;
  readonly fileThrowPath?: string;
  readonly repositoryRoot?: string;
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
    children: [FAMILY_CHILD],
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
      `${REPO}/openspec/changes/${owner}/.openspec.yaml`,
      utf8(`schema: ${schema}\n`),
    );
  }

  // Durable byte image of repository + state material the CLI may touch.
  capture.repoStateBytes = new Map([
    ...files.entries(),
    [`${STATE_ROOT}/.keep`, utf8("state")],
  ]);
  capture.snapshotBefore = cloneBytes(capture.repoStateBytes);

  const fileErrors = options.fileErrorByPath ?? new Map<string, Error>();

  const fileRead: ReleaseCoverageFileReadService = {
    resolveRepositoryRoot: () => {
      capture.log.repositoryRootResolves += 1;
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
        maxBytes: input.maxBytes,
      });
      if (options.openspecThrow) {
        throw new Error(`openspec boom at ${SECRET}/list`);
      }
      if (options.openspecError) return Effect.fail(options.openspecError);
      assert.equal(input.maxBytes, ONE_MIB);
      return Effect.succeed(openspecListBytes(activeNames));
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
  const exitCode = await Effect.runPromise(
    runReleaseCoverageCli(argv, makeIo(capture), services),
  );
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
    assert.equal(read.path.includes(".."), false);
    assert.equal(read.path.includes("escape"), false);
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
      briefReads[0]!.path.slice(REPO.length + 1),
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

  await t.test("contradictory family identity fails closed", async () => {
    const { exitCode, capture } = await runCli(
      LANE_ARGV,
      sharedLaneOptions({
        familyResult: {
          stateRoot: STATE_ROOT,
          contractId: CONTRACT_ID,
          contractSha256: "c".repeat(64),
          familySha256: FAMILY_SHA,
          children: [FAMILY_CHILD],
        },
      }),
    );
    assert.equal(exitCode, EXIT_EVALUATED);
    assertCanonicalResult(capture, invalidResult("dependency_failure"));
    assertSanitized(capture);
  });

  await t.test("release reads every selected complete v0.4 owner brief", async () => {
    const { exitCode, capture } = await runCli(
      RELEASE_ARGV,
      sharedReleaseOptions(),
    );
    assert.equal(exitCode, EXIT_OK);
    assert.equal(capture.log.family.length, 1);
    const briefReads = capture.log.fileReads.filter((r) =>
      r.path.endsWith("release-brief.json"),
    );
    assert.deepEqual(
      briefReads.map((r) => r.path),
      [PACKAGE_BRIEF_ABS],
    );
    assertCanonicalResult(
      capture,
      validResult(SHARED_ACTIVE, SHARED_ROADMAP_BYTES, 2),
    );
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
        // Successful empty read: absent brief authority, not an opaque I/O failure.
        briefBytesByAbsPath: new Map([[PACKAGE_BRIEF_ABS, utf8("")]]),
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
    {
      name: "substituted",
      options: sharedLaneOptions({
        familyResult: {
          stateRoot: STATE_ROOT,
          contractId: CONTRACT_ID,
          contractSha256: CONTRACT_SHA,
          familySha256: FAMILY_SHA,
          children: [
            {
              ...FAMILY_CHILD,
              objective: "family expects this objective",
            },
          ],
        },
        briefBytesByAbsPath: new Map([
          [PACKAGE_BRIEF_ABS, briefFileBytes(deriveBrief(FAMILY_CHILD))],
        ]),
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
            `source_path = "openspec/changes/${TRACK1}-dup"`,
            `disposition = "v040_owner"`,
            `owner = "${TRACK1}"`,
            `target_release = "v0.4"`,
            `reconcile = "complete"`,
            `reason = "duplicate key"`,
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
            text.replace(`owner = "${TRACK1}"`, `owner = "not-a-known-owner"`),
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
    {
      name: "file-effect-fail",
      argv: LANE_ARGV,
      options: sharedLaneOptions({
        fileErrorByPath: new Map([
          [PACKAGE_BRIEF_ABS, new Error(`read fail ${SECRET}/brief`)],
        ]),
      }),
    },
    {
      name: "file-throw",
      argv: LANE_ARGV,
      options: sharedLaneOptions({ fileThrowPath: PACKAGE_BRIEF_ABS }),
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
