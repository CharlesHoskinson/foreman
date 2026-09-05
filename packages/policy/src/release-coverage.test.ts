import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  inspectReleaseCoverageRegisterV1,
  v050OwnerPackageNames,
  validateReleaseCoverageV1,
  type ReleaseCoverageFailureReason,
  type ReleaseCoveragePhaseV1,
  type ReleasePackageBriefV1,
  type RoadmapAssignmentV1,
} from "./release-coverage.js";
import {
  isReleaseProgram,
  RELEASE_PROGRAMS,
  releaseProgramTable,
} from "./release-program.js";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const isWin32 = process.platform === "win32";

const boundedSchemaPath = join(
  repoRoot,
  "openspec",
  "schemas",
  "foreman-bounded",
  "schema.yaml",
);
const architecturalSchemaPath = join(
  repoRoot,
  "openspec",
  "schemas",
  "foreman-architectural",
  "schema.yaml",
);

type ArtifactDep = {
  id: string;
  generates: string;
  requires: string[];
};

type ApplyDep = {
  requires: string[];
  tracks: string;
};

type SchemaShape = {
  artifacts: ArtifactDep[];
  apply: ApplyDep;
};

type StatusArtifact = {
  id: string;
  status: string;
  requires: string[];
};

type StatusJson = {
  artifacts: StatusArtifact[];
};

const BOUNDED_EXPECTED: SchemaShape = {
  artifacts: [
    { id: "proposal", generates: "proposal.md", requires: [] },
    { id: "specs", generates: "specs/**/*.md", requires: ["proposal"] },
    { id: "tasks", generates: "tasks.md", requires: ["specs"] },
  ],
  apply: { requires: ["tasks"], tracks: "tasks.md" },
};

const ARCHITECTURAL_EXPECTED: SchemaShape = {
  artifacts: [
    { id: "proposal", generates: "proposal.md", requires: [] },
    { id: "specs", generates: "specs/**/*.md", requires: ["proposal"] },
    { id: "design", generates: "design.md", requires: ["specs"] },
    { id: "tasks", generates: "tasks.md", requires: ["design"] },
  ],
  apply: { requires: ["tasks"], tracks: "tasks.md" },
};

function runOpenspec(
  args: string[],
  cwd: string = repoRoot,
): {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | undefined;
} {
  const command = isWin32 ? (process.env.ComSpec ?? "cmd.exe") : "openspec";
  const commandArgs = isWin32
    ? ["/d", "/s", "/c", "openspec.cmd", ...args]
    : args;
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function parseSchemaYaml(raw: string): SchemaShape {
  const artifacts: ArtifactDep[] = [];
  let apply: ApplyDep | undefined;

  const artifactBlocks = [
    ...raw.matchAll(
      /^[ \t]*-[ \t]+id:[ \t]*(\S+)[ \t]*\r?\n[ \t]*generates:[ \t]*"?([^"\n]+?)"?[ \t]*\r?\n[ \t]*requires:[ \t]*\[([^\]]*)\]/gm,
    ),
  ];
  for (const match of artifactBlocks) {
    const id = match[1]!.trim();
    const generates = match[2]!.trim().replace(/^"|"$/g, "");
    const requiresRaw = match[3]!.trim();
    const requires =
      requiresRaw.length === 0
        ? []
        : requiresRaw.split(",").map((part) => part.trim());
    artifacts.push({ id, generates, requires });
  }

  const applyMatch = raw.match(
    /^apply:\s*\r?\n[ \t]*requires:[ \t]*\[([^\]]*)\][ \t]*\r?\n[ \t]*tracks:[ \t]*(\S+)/m,
  );
  assert.ok(applyMatch, "schema must declare apply");
  const applyRequiresRaw = applyMatch[1]!.trim();
  apply = {
    requires:
      applyRequiresRaw.length === 0
        ? []
        : applyRequiresRaw.split(",").map((part) => part.trim()),
    tracks: applyMatch[2]!.trim(),
  };

  return { artifacts, apply };
}

function assertSchemaMatches(actual: SchemaShape, expected: SchemaShape): void {
  assert.deepEqual(
    actual.artifacts.map((a) => a.id),
    expected.artifacts.map((a) => a.id),
    "artifact order must match",
  );
  for (let i = 0; i < expected.artifacts.length; i++) {
    assert.deepEqual(actual.artifacts[i], expected.artifacts[i]);
  }
  assert.deepEqual(actual.apply, expected.apply);
}

function createDisposableRepo(): string {
  return mkdtempSync(join(tmpdir(), "foreman-release-coverage-"));
}

function copyProjectSchemas(targetRoot: string): void {
  const schemasDir = join(targetRoot, "openspec", "schemas");
  mkdirSync(schemasDir, { recursive: true });
  cpSync(
    join(repoRoot, "openspec", "schemas", "foreman-bounded"),
    join(schemasDir, "foreman-bounded"),
    { recursive: true },
  );
  cpSync(
    join(repoRoot, "openspec", "schemas", "foreman-architectural"),
    join(schemasDir, "foreman-architectural"),
    { recursive: true },
  );
}

function writePlanningStub(
  changeDir: string,
  files: Record<string, string>,
): void {
  mkdirSync(changeDir, { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    const full = join(changeDir, relative);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents, "utf8");
  }
}

function statusArtifacts(cwd: string, changeName: string): StatusArtifact[] {
  const result = runOpenspec(["status", "--change", changeName, "--json"], cwd);
  assert.equal(result.error, undefined, `status spawn error: ${result.error}`);
  assert.equal(
    result.status,
    0,
    `status failed: ${result.stderr || result.stdout}`,
  );
  const parsed = JSON.parse(result.stdout) as StatusJson;
  assert.ok(Array.isArray(parsed.artifacts), "status JSON must include artifacts");
  return parsed.artifacts;
}

function artifactById(
  artifacts: StatusArtifact[],
  id: string,
): StatusArtifact {
  const found = artifacts.find((row) => row.id === id);
  assert.ok(found, `status missing artifact ${id}`);
  return found;
}

describe("release coverage for closed OpenSpec workflows", () => {
  it("validates foreman-bounded and records exact artifact dependencies", () => {
    const validated = runOpenspec(["schema", "validate", "foreman-bounded"]);
    assert.equal(validated.error, undefined, `spawn error: ${validated.error}`);
    assert.equal(
      validated.status,
      0,
      `schema validate foreman-bounded failed: ${validated.stderr || validated.stdout}`,
    );

    const raw = readFileSync(boundedSchemaPath, "utf8");
    const parsed = parseSchemaYaml(raw);
    assertSchemaMatches(parsed, BOUNDED_EXPECTED);
  });

  it("validates foreman-architectural and records exact artifact dependencies", () => {
    const validated = runOpenspec([
      "schema",
      "validate",
      "foreman-architectural",
    ]);
    assert.equal(validated.error, undefined, `spawn error: ${validated.error}`);
    assert.equal(
      validated.status,
      0,
      `schema validate foreman-architectural failed: ${validated.stderr || validated.stdout}`,
    );

    const raw = readFileSync(architecturalSchemaPath, "utf8");
    const parsed = parseSchemaYaml(raw);
    assertSchemaMatches(parsed, ARCHITECTURAL_EXPECTED);
  });

  it("keeps bounded tasks blocked until specs exists", () => {
    const disposable = createDisposableRepo();
    try {
      copyProjectSchemas(disposable);

      const changeName = "bounded-block-tasks";
      const changeDir = join(disposable, "openspec", "changes", changeName);
      writePlanningStub(changeDir, {
        ".openspec.yaml": "schema: foreman-bounded\n",
        "proposal.md": "# proposal\n",
      });

      const beforeSpecs = statusArtifacts(disposable, changeName);
      const tasksBefore = artifactById(beforeSpecs, "tasks");
      assert.equal(tasksBefore.status, "blocked");
      assert.deepEqual(tasksBefore.requires, ["specs"]);

      writePlanningStub(changeDir, {
        "specs/example/spec.md": "# spec\n",
      });

      const afterSpecs = statusArtifacts(disposable, changeName);
      const tasksAfter = artifactById(afterSpecs, "tasks");
      assert.notEqual(tasksAfter.status, "blocked");
    } finally {
      rmSync(disposable, { recursive: true, force: true });
    }
  });

  it("keeps architectural tasks blocked until design exists", () => {
    const disposable = createDisposableRepo();
    try {
      copyProjectSchemas(disposable);

      const changeName = "architectural-block-tasks";
      const changeDir = join(disposable, "openspec", "changes", changeName);
      writePlanningStub(changeDir, {
        ".openspec.yaml": "schema: foreman-architectural\n",
        "proposal.md": "# proposal\n",
        "specs/example/spec.md": "# spec\n",
      });

      const beforeDesign = statusArtifacts(disposable, changeName);
      const tasksBefore = artifactById(beforeDesign, "tasks");
      assert.equal(tasksBefore.status, "blocked");
      assert.deepEqual(tasksBefore.requires, ["design"]);

      writePlanningStub(changeDir, {
        "design.md": "# design\n",
      });

      const afterDesign = statusArtifacts(disposable, changeName);
      const tasksAfter = artifactById(afterDesign, "tasks");
      assert.notEqual(tasksAfter.status, "blocked");
    } finally {
      rmSync(disposable, { recursive: true, force: true });
    }
  });
});

describe("release coverage policy", () => {
  const SCHEMA = 1 as const;
  const ACTIVE_PKG = "openspec-superpowers-convergence";
  const ACTIVE_WF = "foreman-architectural";
  const FUTURE = "future-package";
  const ROADMAP_PATH = "ROADMAP.md";
  const OPENSPEC_PATH =
    "openspec/changes/openspec-superpowers-convergence";
  const TRACK1_KEY = "change:openspec-superpowers-convergence";
  const ROADMAP_KEY = "roadmap:future-package-item";
  const ONE_MIB = 1024 * 1024;

  type Phase = "Bootstrap" | "Lane" | "Release";
  type Brief = ReleasePackageBriefV1;
  type Reason = ReleaseCoverageFailureReason;

  type ValidatorInput = {
    readonly registerText: string;
    readonly activePackageNames: readonly string[];
    readonly roadmapText: string;
    readonly roadmapAssignments: readonly RoadmapAssignmentV1[];
    readonly packageWorkflowByName: Readonly<Record<string, string | null>>;
    readonly expectedPackageBriefByName: Readonly<Record<string, Brief>>;
    readonly packageBriefBytesByName: Readonly<Record<string, Uint8Array>>;
    readonly changedPaths: readonly string[];
    readonly phase: Phase;
    readonly laneOwner?: string;
  };

  type ValidResult = {
    readonly schemaVersion: 1;
    readonly _tag: "Valid";
    readonly activeInventorySha256: string;
    readonly roadmapSha256: string;
    readonly entryCount: number;
  };

  type InvalidResult = {
    readonly schemaVersion: 1;
    readonly _tag: "Invalid";
    readonly reason: Reason;
  };

  type ValidatorResult = ValidResult | InvalidResult;

  const sha256Hex = (bytes: Uint8Array): string =>
    createHash("sha256").update(bytes).digest("hex");

  const utf8 = (s: string): Uint8Array => Buffer.from(s, "utf8");

  const activeInventorySha256 = (names: readonly string[]): string => {
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
  };

  const roadmapRow = (
    key: string,
    owner: string,
    release: RoadmapAssignmentV1["release"] = "v0.4",
    scope = "scope",
  ): RoadmapAssignmentV1 => ({ key, owner, release, scope });

  const renderRoadmapText = (
    rows: readonly RoadmapAssignmentV1[],
  ): string =>
    rows
      .map(
        (r) =>
          `| ${r.key.slice("roadmap:".length)} | ${r.scope} | ${r.owner} | ${r.release} |\n`,
      )
      .join("");

  const tomlString = (s: string): string => JSON.stringify(s);

  const renderRegister = (opts: {
    schemaVersion?: number | string;
    baselineCommit?: string;
    activeInventorySha256?: string;
    roadmapSha256?: string;
    extraScalars?: string;
    futureOwners?: readonly {
      name: string;
      targetRelease: string;
      reason: string;
    }[];
    entries?: readonly {
      key: string;
      sourceKind: string;
      sourcePath: string;
      disposition: string;
      owner: string;
      targetRelease: string;
      reconcile: string;
      reason: string;
    }[];
    rawExtra?: string;
  }): string => {
    const lines: string[] = [
      `schema_version = ${opts.schemaVersion ?? 1}`,
      `baseline_commit = ${tomlString(opts.baselineCommit ?? "bb5c8c2345ac5524ebb9c6a7de0fe16b17242195")}`,
      `active_inventory_sha256 = ${tomlString(opts.activeInventorySha256 ?? "0".repeat(64))}`,
      `roadmap_sha256 = ${tomlString(opts.roadmapSha256 ?? "0".repeat(64))}`,
    ];
    if (opts.extraScalars) lines.push(opts.extraScalars);
    for (const fo of opts.futureOwners ?? []) {
      lines.push(
        "",
        "[[future_owner]]",
        `name = ${tomlString(fo.name)}`,
        `target_release = ${tomlString(fo.targetRelease)}`,
        `reason = ${tomlString(fo.reason)}`,
      );
    }
    for (const e of opts.entries ?? []) {
      lines.push(
        "",
        "[[entry]]",
        `key = ${tomlString(e.key)}`,
        `source_kind = ${tomlString(e.sourceKind)}`,
        `source_path = ${tomlString(e.sourcePath)}`,
        `disposition = ${tomlString(e.disposition)}`,
        `owner = ${tomlString(e.owner)}`,
        `target_release = ${tomlString(e.targetRelease)}`,
        `reconcile = ${tomlString(e.reconcile)}`,
        `reason = ${tomlString(e.reason)}`,
      );
    }
    if (opts.rawExtra) lines.push(opts.rawExtra);
    return `${lines.join("\n")}\n`;
  };

  const canonicalBriefBytes = (brief: Brief): Uint8Array => {
    const keys = Object.keys(brief).sort();
    const obj: Record<string, unknown> = {};
    for (const k of keys) obj[k] = (brief as Record<string, unknown>)[k];
    return utf8(`${JSON.stringify(obj)}\n`);
  };

  const makeBrief = (
    objective: string,
    packageId: string = ACTIVE_PKG,
  ): Brief => ({
    schema: "foreman.release-package-brief.v1",
    familySha256: "b".repeat(64),
    childId: "v040-t1-convergence",
    packageId,
    objective,
    acceptance: ["The package passes its release checks."],
    allowedPaths: ["packages/policy/**"],
  });

  const track1Entry = {
    key: TRACK1_KEY,
    sourceKind: "openspec_change",
    sourcePath: OPENSPEC_PATH,
    disposition: "v040_owner",
    owner: ACTIVE_PKG,
    targetRelease: "v0.4",
    reconcile: "complete",
    reason: "track1 complete",
  };

  const futureRoadmapEntry = {
    key: ROADMAP_KEY,
    sourceKind: "roadmap",
    sourcePath: ROADMAP_PATH,
    disposition: "v040_owner",
    owner: FUTURE,
    targetRelease: "v0.4",
    reconcile: "required",
    reason: "future work",
  };

  const futureOwner = {
    name: FUTURE,
    targetRelease: "v0.4",
    reason: "declared future",
  };

  const baselineAssignments = (): RoadmapAssignmentV1[] => [
    roadmapRow(ROADMAP_KEY, FUTURE, "v0.4", "future scope"),
  ];

  const sealRegister = (
    activeNames: readonly string[],
    roadmapText: string,
    overrides: Parameters<typeof renderRegister>[0] = {},
  ): string => {
    const inv = activeInventorySha256(activeNames);
    const road = sha256Hex(utf8(roadmapText));
    return renderRegister({
      ...overrides,
      activeInventorySha256:
        overrides.activeInventorySha256 ?? inv,
      roadmapSha256: overrides.roadmapSha256 ?? road,
      futureOwners: overrides.futureOwners ?? [futureOwner],
      entries: overrides.entries ?? [track1Entry, futureRoadmapEntry],
    });
  };

  const validBaseline = (
    overrides: Partial<ValidatorInput> = {},
  ): ValidatorInput => {
    const activePackageNames =
      overrides.activePackageNames ?? [ACTIVE_PKG];
    const roadmapAssignments =
      overrides.roadmapAssignments ?? baselineAssignments();
    const roadmapText =
      overrides.roadmapText ?? renderRoadmapText(roadmapAssignments);
    const registerText =
      overrides.registerText ??
      sealRegister(activePackageNames, roadmapText);
    return {
      registerText,
      activePackageNames,
      roadmapText,
      roadmapAssignments,
      packageWorkflowByName:
        overrides.packageWorkflowByName ?? {
          [ACTIVE_PKG]: ACTIVE_WF,
        },
      expectedPackageBriefByName:
        overrides.expectedPackageBriefByName ?? {},
      packageBriefBytesByName:
        overrides.packageBriefBytesByName ?? {},
      changedPaths: overrides.changedPaths ?? [],
      phase: overrides.phase ?? "Bootstrap",
      ...(overrides.laneOwner === undefined
        ? {}
        : { laneOwner: overrides.laneOwner }),
    };
  };

  const cloneInput = (
    base: ValidatorInput,
    overrides: Partial<ValidatorInput>,
  ): ValidatorInput => ({ ...base, ...overrides });

  const run = (input: ValidatorInput): ValidatorResult => {
    const phase: ReleaseCoveragePhaseV1 =
      input.phase === "Bootstrap"
        ? { _tag: "Bootstrap", owner: ACTIVE_PKG }
        : input.phase === "Lane"
          ? { _tag: "Lane", owner: input.laneOwner ?? ACTIVE_PKG }
          : { _tag: "Release" };
    return validateReleaseCoverageV1({
      phase,
      registerText: input.registerText,
      roadmapBytes: utf8(input.roadmapText),
      activeChangeNames: input.activePackageNames,
      roadmapRows: input.roadmapAssignments,
      workflowByChange: input.packageWorkflowByName,
      changedSuperpowersPaths: input.changedPaths,
      expectedBriefByOwner: input.expectedPackageBriefByName,
      packageBriefBytesByOwner: input.packageBriefBytesByName,
    }) as ValidatorResult;
  };

  const expectValid = (
    input: ValidatorInput,
    entryCount: number,
  ): void => {
    const activeSha = activeInventorySha256(input.activePackageNames);
    const roadmapSha = sha256Hex(utf8(input.roadmapText));
    assert.deepEqual(run(input), {
      schemaVersion: SCHEMA,
      _tag: "Valid",
      activeInventorySha256: activeSha,
      roadmapSha256: roadmapSha,
      entryCount,
    });
  };

  const expectInvalid = (
    input: ValidatorInput,
    reason: Reason,
  ): void => {
    assert.deepEqual(run(input), {
      schemaVersion: SCHEMA,
      _tag: "Invalid",
      reason,
    });
  };

  it("exports the pure validator", () => {
    assert.equal(typeof validateReleaseCoverageV1, "function");
  });

  it("accepts the minimal Bootstrap baseline", () => {
    const input = validBaseline();
    expectValid(input, 2);
  });

  it("rejects invalid_register for malformed register text", () => {
    const base = validBaseline();
    const cases: { name: string; registerText: string }[] = [
      {
        name: "wrong schema version",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          { schemaVersion: 2 },
        ),
      },
      {
        name: "unknown scalar",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          { extraScalars: `unknown_field = "x"` },
        ),
      },
      {
        name: "duplicate scalar",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            extraScalars: `schema_version = 1`,
          },
        ),
      },
      {
        name: "duplicate table header",
        registerText: `${sealRegister(
          base.activePackageNames,
          base.roadmapText,
        )}[duplicate]\nvalue = 1\n[duplicate]\nvalue = 2\n`,
      },
      {
        name: "unsupported TOML syntax",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          { rawExtra: `bad = [1, 2` },
        ),
      },
      {
        name: "CRLF",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
        ).replaceAll("\n", "\r\n"),
      },
      {
        name: "controls",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          { extraScalars: `note = "has\u0001control"` },
        ),
      },
      {
        name: "malformed digest",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          { activeInventorySha256: "zz" },
        ),
      },
      {
        name: "malformed Git ID",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          { baselineCommit: "not-a-git-id" },
        ),
      },
      {
        name: "wrong immutable baseline",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          { baselineCommit: "c".repeat(40) },
        ),
      },
      {
        name: "NBSP around schema_version equals",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
        ).replace("schema_version = 1", "schema_version\u00A0=\u00A01"),
      },
      {
        name: "malformed owner",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              { ...track1Entry, owner: "bad/owner" },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "over 1 MiB",
        registerText: `${"x".repeat(ONE_MIB + 1)}\n`,
      },
      {
        name: "unknown enum",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              { ...track1Entry, disposition: "nope" },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "broken cross-field openspec key",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                key: "roadmap:not-openspec",
                sourceKind: "openspec_change",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "released_reference requires released target",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                disposition: "released_reference",
                targetRelease: "v0.4",
                reconcile: "complete",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "superseded requires complete",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                disposition: "superseded",
                owner: FUTURE,
                targetRelease: "v0.5",
                reconcile: "required",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "v050 requires v0.5",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                disposition: "v050",
                targetRelease: "v0.4",
                reconcile: "not_required",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "v040_dependency requires a v0.4 target",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                disposition: "v040_dependency",
                targetRelease: "v0.5",
                reconcile: "complete",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "v040_owner forbids not_required",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                targetRelease: "v0.4",
                reconcile: "not_required",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "v040_dependency forbids not_required",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                disposition: "v040_dependency",
                targetRelease: "v0.4",
                reconcile: "not_required",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "v050 forbids required",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                disposition: "v050",
                targetRelease: "v0.5",
                reconcile: "required",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "released_reference forbids not_required",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                disposition: "released_reference",
                targetRelease: "released",
                reconcile: "not_required",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "superseded forbids source owner",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                disposition: "superseded",
                targetRelease: "v0.5",
                reconcile: "complete",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "v040_owner forbids v0.5",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                targetRelease: "v0.5",
                reconcile: "complete",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "roadmap path must be ROADMAP.md",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              track1Entry,
              {
                ...futureRoadmapEntry,
                sourcePath: "OTHER.md",
              },
            ],
          },
        ),
      },
      {
        name: "unsupported sourceKind",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              track1Entry,
              futureRoadmapEntry,
              {
                key: "change:other",
                sourceKind: "nope",
                sourcePath: "openspec/changes/other",
                disposition: "v050",
                owner: ACTIVE_PKG,
                targetRelease: "v0.5",
                reconcile: "not_required",
                reason: "unsupported kind probe",
              },
            ],
          },
        ),
      },
      {
        name: "unsupported targetRelease",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                targetRelease: "v9.9",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "unsupported reconcile",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              {
                ...track1Entry,
                reconcile: "nope",
              },
              futureRoadmapEntry,
            ],
          },
        ),
      },
      {
        name: "escaped tab in future-owner name",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            futureOwners: [
              {
                name: "bad\towner",
                targetRelease: "v0.4",
                reason: "escaped tab probe",
              },
            ],
          },
        ),
      },
      {
        name: "lone high surrogate in future-owner name",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            futureOwners: [
              {
                name: "\uD800",
                targetRelease: "v0.4",
                reason: "surrogate probe",
              },
            ],
          },
        ),
      },
    ];
    for (const c of cases) {
      expectInvalid(cloneInput(base, { registerText: c.registerText }), "invalid_register");
    }

    const swappedActive = [ACTIVE_PKG, "other"] as const;
    const swappedRegister = sealRegister(swappedActive, base.roadmapText, {
      entries: [
        {
          ...track1Entry,
          sourcePath: "openspec/changes/other",
        },
        {
          key: "change:other",
          sourceKind: "openspec_change",
          sourcePath: OPENSPEC_PATH,
          disposition: "v040_owner",
          owner: ACTIVE_PKG,
          targetRelease: "v0.4",
          reconcile: "complete",
          reason: "swapped key-path pairing",
        },
        futureRoadmapEntry,
      ],
    });
    expectInvalid(
      cloneInput(base, {
        activePackageNames: swappedActive,
        registerText: swappedRegister,
        packageWorkflowByName: {
          [ACTIVE_PKG]: ACTIVE_WF,
          other: ACTIVE_WF,
        },
      }),
      "invalid_register",
    );
  });

  it("covers every register field and enum literal in a valid sealed register", () => {
    const active = [
      ACTIVE_PKG,
      "change-a",
      "change-b",
      "change-c",
      "change-d",
    ];
    const assignments = [
      roadmapRow("roadmap:a", FUTURE, "v0.4", "sa"),
      roadmapRow("roadmap:b", FUTURE, "v0.5", "sb"),
    ];
    const roadmapText = renderRoadmapText(assignments);
    const entries = [
      track1Entry,
      {
        key: "change:change-a",
        sourceKind: "openspec_change",
        sourcePath: "openspec/changes/change-a",
        disposition: "v040_owner",
        owner: ACTIVE_PKG,
        targetRelease: "v0.4",
        reconcile: "complete",
        reason: "owner",
      },
      {
        key: "change:change-b",
        sourceKind: "openspec_change",
        sourcePath: "openspec/changes/change-b",
        disposition: "v040_dependency",
        owner: ACTIVE_PKG,
        targetRelease: "v0.4",
        reconcile: "complete",
        reason: "dependency",
      },
      {
        key: "roadmap:a",
        sourceKind: "roadmap",
        sourcePath: ROADMAP_PATH,
        disposition: "v040_owner",
        owner: FUTURE,
        targetRelease: "v0.4",
        reconcile: "required",
        reason: "roadmap owner",
      },
      {
        key: "roadmap:b",
        sourceKind: "roadmap",
        sourcePath: ROADMAP_PATH,
        disposition: "v050",
        owner: FUTURE,
        targetRelease: "v0.5",
        reconcile: "not_required",
        reason: "later release",
      },
      {
        key: "change:change-c",
        sourceKind: "openspec_change",
        sourcePath: "openspec/changes/change-c",
        disposition: "released_reference",
        owner: ACTIVE_PKG,
        targetRelease: "released",
        reconcile: "complete",
        reason: "released reference",
      },
      {
        key: "change:change-d",
        sourceKind: "openspec_change",
        sourcePath: "openspec/changes/change-d",
        disposition: "superseded",
        owner: ACTIVE_PKG,
        targetRelease: "v0.5",
        reconcile: "complete",
        reason: "superseded source",
      },
    ];
    const registerText = sealRegister(active, roadmapText, {
      futureOwners: [futureOwner],
      entries,
    });
    const packageWorkflowByName = Object.fromEntries(
      active.map((name) => [name, ACTIVE_WF]),
    );
    expectValid(
      validBaseline({
        registerText,
        activePackageNames: active,
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName,
      }),
      entries.length,
    );
  });

  it("rejects invalid_roadmap for malformed assignments and rows", () => {
    const base = validBaseline();
    const cases: {
      name: string;
      roadmapAssignments: RoadmapAssignmentV1[];
      roadmapText?: string;
    }[] = [
      {
        name: "malformed owner field",
        roadmapAssignments: [
          { ...roadmapRow(ROADMAP_KEY, FUTURE), owner: "bad/owner" },
        ],
      },
      {
        name: "non-roadmap key",
        roadmapAssignments: [
          roadmapRow("openspec:x", FUTURE),
        ],
      },
      {
        name: "nonprintable key",
        roadmapAssignments: [
          roadmapRow("roadmap:has\u0001x", FUTURE),
        ],
      },
      {
        name: "over-bound key",
        roadmapAssignments: [
          roadmapRow(`roadmap:${"k".repeat(500)}`, FUTURE),
        ],
      },
      {
        name: "over-bound scope",
        roadmapAssignments: [
          roadmapRow(ROADMAP_KEY, FUTURE, "v0.4", "s".repeat(5000)),
        ],
      },
      {
        name: "invalid release",
        roadmapAssignments: [
          {
            ...roadmapRow(ROADMAP_KEY, FUTURE),
            release: "v9.9" as RoadmapAssignmentV1["release"],
          },
        ],
      },
      {
        name: "duplicate decoded row key",
        roadmapAssignments: [
          roadmapRow(ROADMAP_KEY, FUTURE),
          roadmapRow(ROADMAP_KEY, FUTURE, "v0.5", "other"),
        ],
        roadmapText: renderRoadmapText([
          roadmapRow(ROADMAP_KEY, FUTURE),
          roadmapRow(ROADMAP_KEY, FUTURE, "v0.5", "other"),
        ]),
      },
      {
        name: "non-ASCII key",
        roadmapAssignments: [
          roadmapRow("roadmap:café", FUTURE),
        ],
      },
      {
        name: "empty scope",
        roadmapAssignments: [
          roadmapRow(ROADMAP_KEY, FUTURE, "v0.4", ""),
        ],
      },
      {
        name: "control character in scope",
        roadmapAssignments: [
          roadmapRow(ROADMAP_KEY, FUTURE, "v0.4", "has\u0001control"),
        ],
      },
      {
        name: "multibyte scope over 4096 UTF-8 bytes",
        roadmapAssignments: [
          roadmapRow(ROADMAP_KEY, FUTURE, "v0.4", "é".repeat(2049)),
        ],
      },
      {
        name: "owner over 128 UTF-8 bytes",
        roadmapAssignments: [
          roadmapRow(ROADMAP_KEY, "é".repeat(65)),
        ],
      },
      {
        name: "Roadmap row with an extra own key",
        roadmapAssignments: [
          {
            ...roadmapRow(ROADMAP_KEY, FUTURE),
            unexpected: true,
          } as unknown as RoadmapAssignmentV1,
        ],
      },
      {
        name: "Roadmap row with inherited authority fields",
        roadmapAssignments: [
          Object.create(
            roadmapRow(ROADMAP_KEY, FUTURE),
          ) as RoadmapAssignmentV1,
        ],
      },
    ];
    for (const c of cases) {
      const roadmapAssignments = c.roadmapAssignments;
      const roadmapText =
        c.roadmapText ?? renderRoadmapText(roadmapAssignments);
      const registerText = sealRegister(
        base.activePackageNames,
        roadmapText,
      );
      expectInvalid(
        cloneInput(base, {
          registerText,
          roadmapText,
          roadmapAssignments,
        }),
        "invalid_roadmap",
      );
    }
    const invalidRoadmapBytes = new Uint8Array([0xff]);
    const invalidRoadmapRegister = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      { roadmapSha256: sha256Hex(invalidRoadmapBytes) },
    );
    assert.deepEqual(
      validateReleaseCoverageV1({
        phase: { _tag: "Bootstrap", owner: ACTIVE_PKG },
        registerText: invalidRoadmapRegister,
        roadmapBytes: invalidRoadmapBytes,
        activeChangeNames: base.activePackageNames,
        roadmapRows: base.roadmapAssignments,
        workflowByChange: base.packageWorkflowByName,
        changedSuperpowersPaths: [],
        expectedBriefByOwner: {},
        packageBriefBytesByOwner: {},
      }),
      {
        schemaVersion: SCHEMA,
        _tag: "Invalid",
        reason: "invalid_roadmap",
      },
    );
  });

  it("rejects duplicate_identity and allows shared ROADMAP.md paths", () => {
    const base = validBaseline();
    const dupKey = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      {
        entries: [
          track1Entry,
          { ...track1Entry, reason: "duplicate row" },
          futureRoadmapEntry,
        ],
      },
    );
    expectInvalid(
      cloneInput(base, { registerText: dupKey }),
      "duplicate_identity",
    );

    const dupSource = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      {
        entries: [
          track1Entry,
          {
            ...track1Entry,
            key: "change:other",
            sourcePath: OPENSPEC_PATH,
            reason: "duplicate source row",
          },
          futureRoadmapEntry,
        ],
      },
    );
    expectInvalid(
      cloneInput(base, { registerText: dupSource }),
      "duplicate_identity",
    );

    const dupFuture = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      {
        futureOwners: [
          futureOwner,
          { name: FUTURE, targetRelease: "v0.5", reason: "dup" },
        ],
      },
    );
    expectInvalid(
      cloneInput(base, { registerText: dupFuture }),
      "duplicate_identity",
    );

    const sharedPath = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      {
        entries: [
          track1Entry,
          futureRoadmapEntry,
          {
            key: "roadmap:second",
            sourceKind: "roadmap",
            sourcePath: ROADMAP_PATH,
            disposition: "v050",
            owner: FUTURE,
            targetRelease: "v0.5",
            reconcile: "not_required",
            reason: "shared path ok",
          },
        ],
      },
    );
    const assignments = [
      ...baselineAssignments(),
      roadmapRow("roadmap:second", FUTURE, "v0.5", "second"),
    ];
    const roadmapText = renderRoadmapText(assignments);
    expectValid(
      cloneInput(base, {
        registerText: sealRegister(base.activePackageNames, roadmapText, {
          entries: [
            track1Entry,
            futureRoadmapEntry,
            {
              key: "roadmap:second",
              sourceKind: "roadmap",
              sourcePath: ROADMAP_PATH,
              disposition: "v050",
              owner: FUTURE,
              targetRelease: "v0.5",
              reconcile: "not_required",
              reason: "shared path ok",
            },
          ],
        }),
        roadmapText,
        roadmapAssignments: assignments,
      }),
      3,
    );
    void sharedPath;
  });

  it("rejects unknown_owner when owner is neither active nor future", () => {
    const base = validBaseline();
    const registerText = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      {
        entries: [
          { ...track1Entry, owner: "ghost-package" },
          futureRoadmapEntry,
        ],
      },
    );
    expectInvalid(
      cloneInput(base, { registerText }),
      "unknown_owner",
    );
  });

  it("rejects unknown_owner when Lane owner is neither active nor declared future", () => {
    expectInvalid(
      validBaseline({
        phase: "Lane",
        laneOwner: "ghost-lane-owner",
        expectedPackageBriefByName: {},
        packageBriefBytesByName: {},
      }),
      "unknown_owner",
    );
  });

  const orphanFutureOwner = "orphan-future-owner";
  const orphanFutureOwnerRecord = {
    name: orphanFutureOwner,
    targetRelease: "v0.4",
    reason: "declared without an owned v0.4 entry",
  };

  const orphanFutureRegister = (): {
    readonly registerText: string;
    readonly roadmapText: string;
  } => {
    const roadmapText = renderRoadmapText(baselineAssignments());
    return {
      roadmapText,
      registerText: sealRegister([ACTIVE_PKG], roadmapText, {
        futureOwners: [futureOwner, orphanFutureOwnerRecord],
        entries: [
          track1Entry,
          { ...futureRoadmapEntry, reconcile: "complete" },
        ],
      }),
    };
  };

  it("keeps Bootstrap valid when a v0.4 future owner owns no v0.4 entry", () => {
    const { registerText } = orphanFutureRegister();
    expectValid(
      validBaseline({
        phase: "Bootstrap",
        registerText,
        packageWorkflowByName: { [ACTIVE_PKG]: ACTIVE_WF },
        expectedPackageBriefByName: {},
        packageBriefBytesByName: {},
      }),
      2,
    );
  });

  it("rejects unknown_owner when Lane selects a v0.4 future owner with no owned entry", () => {
    const { registerText } = orphanFutureRegister();
    expectInvalid(
      validBaseline({
        phase: "Lane",
        laneOwner: orphanFutureOwner,
        registerText,
        packageWorkflowByName: { [ACTIVE_PKG]: ACTIVE_WF },
        expectedPackageBriefByName: {},
        packageBriefBytesByName: {},
      }),
      "unknown_owner",
    );
  });

  it("requires workflow authority for a no-entry v0.4 future owner during Release", () => {
    const { registerText } = orphanFutureRegister();
    const activeBrief = makeBrief("ok");
    const futureBrief = makeBrief("future", FUTURE);
    const orphanBrief = makeBrief("orphan", orphanFutureOwner);
    expectInvalid(
      validBaseline({
        phase: "Release",
        registerText,
        packageWorkflowByName: {
          [ACTIVE_PKG]: ACTIVE_WF,
          [FUTURE]: ACTIVE_WF,
        },
        expectedPackageBriefByName: {
          [ACTIVE_PKG]: activeBrief,
          [FUTURE]: futureBrief,
          [orphanFutureOwner]: orphanBrief,
        },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: canonicalBriefBytes(activeBrief),
          [FUTURE]: canonicalBriefBytes(futureBrief),
          [orphanFutureOwner]: canonicalBriefBytes(orphanBrief),
        },
      }),
      "workflow_mismatch",
    );
  });

  it("requires brief authority for a no-entry v0.4 future owner during Release", () => {
    const { registerText } = orphanFutureRegister();
    const activeBrief = makeBrief("ok");
    const futureBrief = makeBrief("future", FUTURE);
    expectInvalid(
      validBaseline({
        phase: "Release",
        registerText,
        packageWorkflowByName: {
          [ACTIVE_PKG]: ACTIVE_WF,
          [FUTURE]: ACTIVE_WF,
          [orphanFutureOwner]: ACTIVE_WF,
        },
        expectedPackageBriefByName: {
          [ACTIVE_PKG]: activeBrief,
          [FUTURE]: futureBrief,
        },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: canonicalBriefBytes(activeBrief),
          [FUTURE]: canonicalBriefBytes(futureBrief),
        },
      }),
      "brief_mismatch",
    );
  });

  it("accepts complete authority for a no-entry v0.4 future owner during Release", () => {
    const { registerText } = orphanFutureRegister();
    const activeBrief = makeBrief("ok");
    const futureBrief = makeBrief("future", FUTURE);
    const orphanBrief = makeBrief("orphan", orphanFutureOwner);
    expectValid(
      validBaseline({
        phase: "Release",
        registerText,
        packageWorkflowByName: {
          [ACTIVE_PKG]: ACTIVE_WF,
          [FUTURE]: ACTIVE_WF,
          [orphanFutureOwner]: ACTIVE_WF,
        },
        expectedPackageBriefByName: {
          [ACTIVE_PKG]: activeBrief,
          [FUTURE]: futureBrief,
          [orphanFutureOwner]: orphanBrief,
        },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: canonicalBriefBytes(activeBrief),
          [FUTURE]: canonicalBriefBytes(futureBrief),
          [orphanFutureOwner]: canonicalBriefBytes(orphanBrief),
        },
      }),
      2,
    );
  });

  it("keeps complete future-owner Lane and Release controls valid", () => {
    const activeBrief = makeBrief("ok");
    const activeBytes = canonicalBriefBytes(activeBrief);
    const futureBrief = makeBrief("future", FUTURE);
    const futureBytes = canonicalBriefBytes(futureBrief);
    const roadmapText = renderRoadmapText(baselineAssignments());
    const completeFutureRegister = sealRegister([ACTIVE_PKG], roadmapText, {
      futureOwners: [futureOwner],
      entries: [
        track1Entry,
        { ...futureRoadmapEntry, reconcile: "complete" },
      ],
    });
    expectValid(
      validBaseline({
        phase: "Lane",
        laneOwner: FUTURE,
        registerText: completeFutureRegister,
        packageWorkflowByName: {
          [ACTIVE_PKG]: ACTIVE_WF,
          [FUTURE]: ACTIVE_WF,
        },
        expectedPackageBriefByName: { [FUTURE]: futureBrief },
        packageBriefBytesByName: { [FUTURE]: futureBytes },
      }),
      2,
    );
    expectValid(
      validBaseline({
        phase: "Release",
        registerText: completeFutureRegister,
        packageWorkflowByName: {
          [ACTIVE_PKG]: ACTIVE_WF,
          [FUTURE]: ACTIVE_WF,
        },
        expectedPackageBriefByName: {
          [ACTIVE_PKG]: activeBrief,
          [FUTURE]: futureBrief,
        },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: activeBytes,
          [FUTURE]: futureBytes,
        },
      }),
      2,
    );
  });

  it("rejects roadmapBytes with exactly 1_048_577 bytes as invalid_roadmap", () => {
    const base = validBaseline();
    const overBytes = new Uint8Array(1_048_577);
    overBytes.fill(0x61);
    const overRegister = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      { roadmapSha256: sha256Hex(overBytes) },
    );
    assert.deepEqual(
      validateReleaseCoverageV1({
        phase: { _tag: "Bootstrap", owner: ACTIVE_PKG },
        registerText: overRegister,
        roadmapBytes: overBytes,
        activeChangeNames: base.activePackageNames,
        roadmapRows: base.roadmapAssignments,
        workflowByChange: base.packageWorkflowByName,
        changedSuperpowersPaths: [],
        expectedBriefByOwner: {},
        packageBriefBytesByOwner: {},
      }),
      {
        schemaVersion: SCHEMA,
        _tag: "Invalid",
        reason: "invalid_roadmap",
      },
    );
  });

  it("accepts roadmapBytes with exactly 1_048_576 bytes when authority matches", () => {
    const base = validBaseline();
    const exactBytes = new Uint8Array(ONE_MIB);
    exactBytes.fill(0x61);
    assert.equal(exactBytes.byteLength, 1_048_576);
    const exactRegister = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      { roadmapSha256: sha256Hex(exactBytes) },
    );
    assert.deepEqual(
      validateReleaseCoverageV1({
        phase: { _tag: "Bootstrap", owner: ACTIVE_PKG },
        registerText: exactRegister,
        roadmapBytes: exactBytes,
        activeChangeNames: base.activePackageNames,
        roadmapRows: base.roadmapAssignments,
        workflowByChange: base.packageWorkflowByName,
        changedSuperpowersPaths: [],
        expectedBriefByOwner: {},
        packageBriefBytesByOwner: {},
      }),
      {
        schemaVersion: SCHEMA,
        _tag: "Valid",
        activeInventorySha256: activeInventorySha256(base.activePackageNames),
        roadmapSha256: sha256Hex(exactBytes),
        entryCount: 2,
      },
    );
  });

  it("rejects inventory_mismatch including UTF-8 byte sort", () => {
    const base = validBaseline();
    expectInvalid(
      cloneInput(base, {
        registerText: sealRegister(base.activePackageNames, base.roadmapText, {
          activeInventorySha256: "ab".repeat(32),
        }),
      }),
      "inventory_mismatch",
    );
    expectInvalid(
      cloneInput(base, {
        activePackageNames: [ACTIVE_PKG, ACTIVE_PKG],
      }),
      "inventory_mismatch",
    );
    expectInvalid(
      cloneInput(base, {
        activePackageNames: ["other-package"],
        registerText: sealRegister(["other-package"], base.roadmapText),
        packageWorkflowByName: { "other-package": ACTIVE_WF },
      }),
      "inventory_mismatch",
    );

    const supplementary = "𐀀-package";
    const privateUse = "-package";
    const names = [ACTIVE_PKG, supplementary, privateUse];
    const correctSha = activeInventorySha256(names);
    const utf16Order = [...names].sort();
    const utf16Sha = sha256Hex(
      utf8(utf16Order.map((name) => `${name}\n`).join("")),
    );
    assert.notEqual(correctSha, utf16Sha);
    const roadmapText = base.roadmapText;
    const entries = [
      track1Entry,
      {
        key: `change:${supplementary}`,
        sourceKind: "openspec_change",
        sourcePath: `openspec/changes/${supplementary}`,
        disposition: "v040_dependency",
        owner: ACTIVE_PKG,
        targetRelease: "v0.4",
        reconcile: "complete",
        reason: "supplementary-plane name",
      },
      {
        key: `change:${privateUse}`,
        sourceKind: "openspec_change",
        sourcePath: `openspec/changes/${privateUse}`,
        disposition: "v040_dependency",
        owner: ACTIVE_PKG,
        targetRelease: "v0.4",
        reconcile: "complete",
        reason: "private-use name",
      },
      futureRoadmapEntry,
    ];
    const correctRegisterText = sealRegister(names, roadmapText, {
      activeInventorySha256: correctSha,
      entries,
    });
    const wrongRegisterText = sealRegister(names, roadmapText, {
      activeInventorySha256: utf16Sha,
      entries,
    });
    expectValid(
      validBaseline({
        registerText: correctRegisterText,
        activePackageNames: names,
        roadmapText,
        packageWorkflowByName: Object.fromEntries(
          names.map((name) => [name, ACTIVE_WF]),
        ),
      }),
      entries.length,
    );
    expectInvalid(
      validBaseline({
        registerText: wrongRegisterText,
        activePackageNames: names,
        roadmapText,
        packageWorkflowByName: Object.fromEntries(
          names.map((name) => [name, ACTIVE_WF]),
        ),
      }),
      "inventory_mismatch",
    );
  });

  it("rejects roadmap_mismatch and hashes CRLF raw", () => {
    const base = validBaseline();
    expectInvalid(
      cloneInput(base, {
        registerText: sealRegister(base.activePackageNames, base.roadmapText, {
          roadmapSha256: "cd".repeat(32),
        }),
      }),
      "roadmap_mismatch",
    );

    const missingInRegister = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      { entries: [track1Entry] },
    );
    expectInvalid(
      cloneInput(base, { registerText: missingInRegister }),
      "roadmap_mismatch",
    );

    const extraInRegister = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      {
        entries: [
          track1Entry,
          futureRoadmapEntry,
          {
            key: "roadmap:extra",
            sourceKind: "roadmap",
            sourcePath: ROADMAP_PATH,
            disposition: "v040_owner",
            owner: FUTURE,
            targetRelease: "v0.4",
            reconcile: "required",
            reason: "extra",
          },
        ],
      },
    );
    expectInvalid(
      cloneInput(base, { registerText: extraInRegister }),
      "roadmap_mismatch",
    );

    const ownerDiff = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      {
        entries: [
          track1Entry,
          { ...futureRoadmapEntry, owner: ACTIVE_PKG },
        ],
        futureOwners: [futureOwner],
      },
    );
    expectInvalid(
      cloneInput(base, { registerText: ownerDiff }),
      "roadmap_mismatch",
    );

    const releaseDiff = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      {
        entries: [
          track1Entry,
          { ...futureRoadmapEntry, targetRelease: "v0.5", disposition: "v050", reconcile: "not_required" },
        ],
      },
    );
    expectInvalid(
      cloneInput(base, { registerText: releaseDiff }),
      "roadmap_mismatch",
    );

    const lfText = renderRoadmapText(baselineAssignments());
    const crlfText = lfText.replaceAll("\n", "\r\n");
    assert.notEqual(sha256Hex(utf8(lfText)), sha256Hex(utf8(crlfText)));
    const crlfRegister = sealRegister(base.activePackageNames, lfText);
    expectInvalid(
      cloneInput(base, {
        registerText: crlfRegister,
        roadmapText: crlfText,
      }),
      "roadmap_mismatch",
    );
  });

  it("rejects workflow_mismatch for phase-relevant packages only", () => {
    const brief = makeBrief("ok");
    const bytes = canonicalBriefBytes(brief);
    const futureBrief = makeBrief("future", FUTURE);
    const futureBytes = canonicalBriefBytes(futureBrief);
    const completeFutureRegister = sealRegister(
      [ACTIVE_PKG],
      renderRoadmapText(baselineAssignments()),
      {
        entries: [
          track1Entry,
          { ...futureRoadmapEntry, reconcile: "complete" },
        ],
      },
    );

    expectInvalid(
      validBaseline({
        phase: "Bootstrap",
        packageWorkflowByName: {},
      }),
      "workflow_mismatch",
    );

    const laneBase = validBaseline({
      phase: "Lane",
      expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
      packageBriefBytesByName: {
        [ACTIVE_PKG]: bytes,
      },
    });

    for (const packageWorkflowByName of [
      { [ACTIVE_PKG]: null },
      {},
      { [ACTIVE_PKG]: "unknown-workflow" },
    ] as const) {
      expectInvalid(
        cloneInput(laneBase, {
          packageWorkflowByName: packageWorkflowByName as ValidatorInput["packageWorkflowByName"],
        }),
        "workflow_mismatch",
      );
    }

    expectInvalid(
      validBaseline({
        phase: "Release",
        registerText: completeFutureRegister,
        packageWorkflowByName: { [ACTIVE_PKG]: ACTIVE_WF },
        expectedPackageBriefByName: {
          [ACTIVE_PKG]: brief,
          [FUTURE]: futureBrief,
        },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: bytes,
          [FUTURE]: futureBytes,
        },
      }),
      "workflow_mismatch",
    );

    const irrelevant = "other-active";
    const names = [ACTIVE_PKG, irrelevant];
    const assignments = baselineAssignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealRegister(names, roadmapText, {
      entries: [
        track1Entry,
        futureRoadmapEntry,
        {
          key: "change:other-active",
          sourceKind: "openspec_change",
          sourcePath: "openspec/changes/other-active",
          disposition: "v050",
          owner: irrelevant,
          targetRelease: "v0.5",
          reconcile: "not_required",
          reason: "phase irrelevant",
        },
      ],
    });
    const brief2 = makeBrief("ok");
    expectValid(
      validBaseline({
        phase: "Lane",
        registerText,
        activePackageNames: names,
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName: { [ACTIVE_PKG]: ACTIVE_WF },
        expectedPackageBriefByName: { [ACTIVE_PKG]: brief2 },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: canonicalBriefBytes(brief2),
        },
      }),
      3,
    );
  });

  it("rejects brief_mismatch across authority shapes and phases", () => {
    const brief = makeBrief("lane brief");
    const bytes = canonicalBriefBytes(brief);
    const laneOk = validBaseline({
      phase: "Lane",
      expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
      packageBriefBytesByName: { [ACTIVE_PKG]: bytes },
    });
    expectValid(laneOk, 2);
    expectValid(
      cloneInput(laneOk, {
        packageWorkflowByName: { [ACTIVE_PKG]: "foreman-bounded" },
      }),
      2,
    );

    const cases: Partial<ValidatorInput>[] = [
      {
        expectedPackageBriefByName: {},
        packageBriefBytesByName: { [ACTIVE_PKG]: bytes },
      },
      {
        expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
        packageBriefBytesByName: {},
      },
      {
        expectedPackageBriefByName: {
          [ACTIVE_PKG]: brief,
          extra: brief,
        },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: bytes,
          extra: bytes,
        },
      },
      {
        expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: utf8("{not-json\n"),
        },
      },
      {
        expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: utf8(
            `${JSON.stringify({
              schema: brief.schema,
              packageId: brief.packageId,
              objective: brief.objective,
              familySha256: brief.familySha256,
              childId: brief.childId,
              allowedPaths: brief.allowedPaths,
              acceptance: brief.acceptance,
            })}\n`,
          ),
        },
      },
      {
        expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: new Uint8Array([0xff, 0xfe, 0xfd, 0x0a]),
        },
      },
      {
        expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: canonicalBriefBytes({
            ...brief,
            objective: "different",
          }),
        },
      },
      {
        expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: utf8(`${"y".repeat(ONE_MIB + 1)}\n`),
        },
      },
    ];
    for (const partial of cases) {
      expectInvalid(cloneInput(laneOk, partial), "brief_mismatch");
    }

    const substitutedFutureBrief = makeBrief("future identity", FUTURE);
    const substitutedFutureBytes = canonicalBriefBytes(substitutedFutureBrief);
    expectInvalid(
      cloneInput(laneOk, {
        expectedPackageBriefByName: { [ACTIVE_PKG]: substitutedFutureBrief },
        packageBriefBytesByName: { [ACTIVE_PKG]: substitutedFutureBytes },
      }),
      "brief_mismatch",
    );

    const driveAbsoluteBrief: Brief = {
      ...makeBrief("drive absolute"),
      allowedPaths: ["C:/escape"],
    };
    const driveAbsoluteBytes = canonicalBriefBytes(driveAbsoluteBrief);
    expectInvalid(
      cloneInput(laneOk, {
        expectedPackageBriefByName: { [ACTIVE_PKG]: driveAbsoluteBrief },
        packageBriefBytesByName: { [ACTIVE_PKG]: driveAbsoluteBytes },
      }),
      "brief_mismatch",
    );

    expectInvalid(
      validBaseline({
        phase: "Bootstrap",
        expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
        packageBriefBytesByName: { [ACTIVE_PKG]: bytes },
      }),
      "brief_mismatch",
    );

    const completeFutureRegister = sealRegister(
      [ACTIVE_PKG],
      renderRoadmapText(baselineAssignments()),
      {
        entries: [
          track1Entry,
          { ...futureRoadmapEntry, reconcile: "complete" },
        ],
      },
    );
    const activeBrief = makeBrief("release active");
    const activeBytes = canonicalBriefBytes(activeBrief);
    const futureBrief = makeBrief("release future", FUTURE);
    const futureBytes = canonicalBriefBytes(futureBrief);
    const releaseOk = validBaseline({
      phase: "Release",
      registerText: completeFutureRegister,
      packageWorkflowByName: {
        [ACTIVE_PKG]: ACTIVE_WF,
        [FUTURE]: ACTIVE_WF,
      },
      expectedPackageBriefByName: {
        [ACTIVE_PKG]: activeBrief,
        [FUTURE]: futureBrief,
      },
      packageBriefBytesByName: {
        [ACTIVE_PKG]: activeBytes,
        [FUTURE]: futureBytes,
      },
    });
    expectValid(releaseOk, 2);

    expectInvalid(
      cloneInput(releaseOk, {
        expectedPackageBriefByName: { [ACTIVE_PKG]: activeBrief },
      }),
      "brief_mismatch",
    );
  });

  it("flags unreconciled required entries across Bootstrap, Lane, and Release", () => {
    const activeBrief = makeBrief("ok");
    const activeBytes = canonicalBriefBytes(activeBrief);
    const futureBrief = makeBrief("future", FUTURE);
    const futureBytes = canonicalBriefBytes(futureBrief);

    expectValid(validBaseline({ phase: "Bootstrap" }), 2);

    const track1Required = sealRegister(
      [ACTIVE_PKG],
      renderRoadmapText(baselineAssignments()),
      {
        entries: [
          { ...track1Entry, reconcile: "required" },
          futureRoadmapEntry,
        ],
      },
    );
    expectInvalid(
      validBaseline({
        phase: "Bootstrap",
        registerText: track1Required,
        packageWorkflowByName: { [ACTIVE_PKG]: ACTIVE_WF },
        expectedPackageBriefByName: {},
        packageBriefBytesByName: {},
      }),
      "unreconciled",
    );

    const track1OwnedByFuture = sealRegister(
      [ACTIVE_PKG],
      renderRoadmapText(baselineAssignments()),
      {
        entries: [
          { ...track1Entry, owner: FUTURE },
          futureRoadmapEntry,
        ],
      },
    );
    expectInvalid(
      validBaseline({
        phase: "Bootstrap",
        registerText: track1OwnedByFuture,
        packageWorkflowByName: {
          [ACTIVE_PKG]: ACTIVE_WF,
          [FUTURE]: ACTIVE_WF,
        },
        expectedPackageBriefByName: {},
        packageBriefBytesByName: {},
      }),
      "unreconciled",
    );

    const track1ReleasedReference = sealRegister(
      [ACTIVE_PKG],
      renderRoadmapText(baselineAssignments()),
      {
        entries: [
          {
            ...track1Entry,
            disposition: "released_reference",
            targetRelease: "released",
            reconcile: "complete",
          },
          futureRoadmapEntry,
        ],
      },
    );
    expectValid(
      validBaseline({
        phase: "Bootstrap",
        registerText: track1ReleasedReference,
        packageWorkflowByName: {
          [ACTIVE_PKG]: ACTIVE_WF,
          [FUTURE]: ACTIVE_WF,
        },
        expectedPackageBriefByName: {},
        packageBriefBytesByName: {},
      }),
      2,
    );

    expectInvalid(
      validBaseline({
        phase: "Lane",
        laneOwner: FUTURE,
        packageWorkflowByName: {
          [ACTIVE_PKG]: ACTIVE_WF,
          [FUTURE]: ACTIVE_WF,
        },
        expectedPackageBriefByName: { [FUTURE]: futureBrief },
        packageBriefBytesByName: { [FUTURE]: futureBytes },
      }),
      "unreconciled",
    );

    expectInvalid(
      validBaseline({
        phase: "Release",
        packageWorkflowByName: {
          [ACTIVE_PKG]: ACTIVE_WF,
          [FUTURE]: ACTIVE_WF,
        },
        expectedPackageBriefByName: {
          [ACTIVE_PKG]: activeBrief,
          [FUTURE]: futureBrief,
        },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: activeBytes,
          [FUTURE]: futureBytes,
        },
      }),
      "unreconciled",
    );

    const completeFuture = sealRegister(
      [ACTIVE_PKG],
      renderRoadmapText(baselineAssignments()),
      {
        entries: [
          track1Entry,
          { ...futureRoadmapEntry, reconcile: "complete" },
        ],
      },
    );

    expectValid(
      validBaseline({
        phase: "Bootstrap",
        registerText: completeFuture,
        packageWorkflowByName: { [ACTIVE_PKG]: ACTIVE_WF },
        expectedPackageBriefByName: {},
        packageBriefBytesByName: {},
      }),
      2,
    );
    expectValid(
      validBaseline({
        phase: "Lane",
        laneOwner: FUTURE,
        registerText: completeFuture,
        packageWorkflowByName: {
          [ACTIVE_PKG]: ACTIVE_WF,
          [FUTURE]: ACTIVE_WF,
        },
        expectedPackageBriefByName: { [FUTURE]: futureBrief },
        packageBriefBytesByName: { [FUTURE]: futureBytes },
      }),
      2,
    );
    expectValid(
      validBaseline({
        phase: "Release",
        registerText: completeFuture,
        packageWorkflowByName: {
          [ACTIVE_PKG]: ACTIVE_WF,
          [FUTURE]: ACTIVE_WF,
        },
        expectedPackageBriefByName: {
          [ACTIVE_PKG]: activeBrief,
          [FUTURE]: futureBrief,
        },
        packageBriefBytesByName: {
          [ACTIVE_PKG]: activeBytes,
          [FUTURE]: futureBytes,
        },
      }),
      2,
    );
  });

  it("rejects competing_plan only for changed docs/superpowers paths", () => {
    const base = validBaseline();
    expectInvalid(
      cloneInput(base, {
        changedPaths: ["docs/superpowers/specs/x.md"],
      }),
      "competing_plan",
    );
    expectInvalid(
      cloneInput(base, {
        changedPaths: ["docs/superpowers/plans/x.md"],
      }),
      "competing_plan",
    );
    expectValid(
      cloneInput(base, {
        changedPaths: ["docs/other/readme.md", "packages/policy/src/x.ts"],
      }),
      2,
    );
  });

  it("returns dependency_failure for malformed collection shapes without throwing", () => {
    const base = validBaseline();
    const malformed: Partial<ValidatorInput>[] = [
      { activePackageNames: null as never },
      { roadmapAssignments: "nope" as never },
      { packageWorkflowByName: [] as never },
      { expectedPackageBriefByName: null as never },
      { packageBriefBytesByName: 1 as never },
      { changedPaths: {} as never },
      { packageWorkflowByName: new Date() as never },
      { expectedPackageBriefByName: new Map() as never },
      { packageBriefBytesByName: new Date() as never },
      { packageWorkflowByName: new Map() as never },
    ];
    for (const partial of malformed) {
      expectInvalid(cloneInput(base, partial), "dependency_failure");
    }

    const common = {
      registerText: base.registerText,
      roadmapBytes: utf8(base.roadmapText),
      activeChangeNames: base.activePackageNames,
      roadmapRows: base.roadmapAssignments,
      workflowByChange: base.packageWorkflowByName,
      changedSuperpowersPaths: base.changedPaths,
      expectedBriefByOwner: base.expectedPackageBriefByName,
      packageBriefBytesByOwner: base.packageBriefBytesByName,
    };
    assert.deepEqual(
      validateReleaseCoverageV1({
        ...common,
        phase: { _tag: "Bootstrap", owner: ACTIVE_PKG, extra: true } as never,
      }),
      {
        schemaVersion: SCHEMA,
        _tag: "Invalid",
        reason: "dependency_failure",
      },
    );

    const laneBrief = makeBrief("phase shape lane");
    const laneBytes = canonicalBriefBytes(laneBrief);
    assert.deepEqual(
      validateReleaseCoverageV1({
        ...common,
        phase: { _tag: "Lane", owner: ACTIVE_PKG, extra: true } as never,
        expectedBriefByOwner: { [ACTIVE_PKG]: laneBrief },
        packageBriefBytesByOwner: { [ACTIVE_PKG]: laneBytes },
      }),
      {
        schemaVersion: SCHEMA,
        _tag: "Invalid",
        reason: "dependency_failure",
      },
    );

    const releaseBrief = makeBrief("phase shape release");
    const releaseBytes = canonicalBriefBytes(releaseBrief);
    const futureBrief = makeBrief("phase shape future", FUTURE);
    const futureBytes = canonicalBriefBytes(futureBrief);
    const completeFutureRegister = sealRegister(
      [ACTIVE_PKG],
      renderRoadmapText(baselineAssignments()),
      {
        entries: [
          track1Entry,
          { ...futureRoadmapEntry, reconcile: "complete" },
        ],
      },
    );
    assert.deepEqual(
      validateReleaseCoverageV1({
        ...common,
        phase: { _tag: "Release", extra: true } as never,
        registerText: completeFutureRegister,
        workflowByChange: {
          [ACTIVE_PKG]: ACTIVE_WF,
          [FUTURE]: ACTIVE_WF,
        },
        expectedBriefByOwner: {
          [ACTIVE_PKG]: releaseBrief,
          [FUTURE]: futureBrief,
        },
        packageBriefBytesByOwner: {
          [ACTIVE_PKG]: releaseBytes,
          [FUTURE]: futureBytes,
        },
      }),
      {
        schemaVersion: SCHEMA,
        _tag: "Invalid",
        reason: "dependency_failure",
      },
    );
  });

  it("accepts the authored coverage.toml with independent authority inputs", () => {
    const authoredPath = new URL(
      "./fixtures/v040/coverage.toml",
      import.meta.url,
    );
    const registerText = readFileSync(authoredPath, "utf8");
    assert.match(registerText, /^schema_version\s*=\s*1\b/m);
    const entryCount = [...registerText.matchAll(/^\[\[entry\]\]$/gm)].length;

    const inventoryText = readFileSync(
      new URL("./fixtures/v040/active-inventory.txt", import.meta.url),
      "utf8",
    );
    const activePackageNames = inventoryText.split("\n").filter((name) => name.length > 0);
    assert.equal(
      activeInventorySha256(activePackageNames),
      "d16bd7a29580b6b642e24e301ffbd8600844b1a0436bfdaab5d1a241e4572c7a",
    );

    const roadmapText = readFileSync(
      new URL("./fixtures/v040/ROADMAP.md", import.meta.url),
      "utf8",
    );
    const roadmapAssignments: RoadmapAssignmentV1[] = [];
    for (const match of roadmapText.matchAll(
      /^\| `([^`]+)` \| ([^|]+) \| `([^`]+)` \| `([^`]+)` \|$/gm,
    )) {
      const key = match[1]!;
      if (!key.startsWith("roadmap:")) continue;
      const scope = match[2]!.trim();
      const release = match[3]! as RoadmapAssignmentV1["release"];
      const owner = match[4]!;
      roadmapAssignments.push({ key, scope, release, owner });
    }
    assert.ok(
      roadmapAssignments.length > 0,
      "ROADMAP.md must declare roadmap assignment rows",
    );

    const packageWorkflowByName: Record<string, string | null> = {};
    for (const name of activePackageNames) {
      const metaPath = join(
        repoRoot,
        "openspec",
        "changes",
        name,
        ".openspec.yaml",
      );
      if (!existsSync(metaPath)) {
        packageWorkflowByName[name] = null;
        continue;
      }
      const raw = readFileSync(metaPath, "utf8");
      const schemaMatch = /^schema:\s*(\S+)\s*$/m.exec(raw);
      packageWorkflowByName[name] = schemaMatch ? schemaMatch[1]! : null;
    }

    const input = validBaseline({
      registerText,
      activePackageNames,
      roadmapText,
      roadmapAssignments,
      packageWorkflowByName,
      phase: "Bootstrap",
      expectedPackageBriefByName: {},
      packageBriefBytesByName: {},
      changedPaths: [],
    });
    expectValid(input, entryCount);

    const releaseInspection = inspectReleaseCoverageRegisterV1({
      registerText,
      phase: { _tag: "Release" },
    });
    assert.equal(releaseInspection._tag, "Valid");
    if (releaseInspection._tag !== "Valid") return;
    assert.deepEqual(releaseInspection.selectedOwners, [
      "external-memory-index",
      "graph-context-builder",
      "graph-eval-falsification",
      "hermetic-foreman-appliance",
      "knowledge-plane-refresh",
      "project-registry",
      "v040-release-program",
      "work-dag-projection",
    ]);

    const expectedPackageBriefByName: Record<string, ReleasePackageBriefV1> = {};
    const packageBriefBytesByName: Record<string, Uint8Array> = {};
    for (const owner of releaseInspection.selectedOwners) {
      assert.notEqual(
        packageWorkflowByName[owner],
        null,
        `${owner} must declare an OpenSpec workflow`,
      );
      const briefPath = join(
        repoRoot,
        "openspec",
        "changes",
        owner,
        "release-brief.json",
      );
      assert.equal(existsSync(briefPath), true, `${owner} must have a release brief`);
      const briefBytes = readFileSync(briefPath);
      expectedPackageBriefByName[owner] = JSON.parse(
        briefBytes.toString("utf8"),
      ) as ReleasePackageBriefV1;
      packageBriefBytesByName[owner] = briefBytes;
    }
    for (const owner of releaseInspection.selectedOwners) {
      expectValid(
        validBaseline({
          registerText,
          activePackageNames,
          roadmapText,
          roadmapAssignments,
          packageWorkflowByName,
          phase: "Lane",
          laneOwner: owner,
          expectedPackageBriefByName: {
            [owner]: expectedPackageBriefByName[owner]!,
          },
          packageBriefBytesByName: {
            [owner]: packageBriefBytesByName[owner]!,
          },
          changedPaths: [],
        }),
        entryCount,
      );
    }
    expectValid(
      validBaseline({
        registerText,
        activePackageNames,
        roadmapText,
        roadmapAssignments,
        packageWorkflowByName,
        phase: "Release",
        expectedPackageBriefByName,
        packageBriefBytesByName,
        changedPaths: [],
      }),
      entryCount,
    );
  });

  it("accepts v050 owner dispositions and refuses v041", () => {
    const owner = "v050-release-program";
    const roadmapAssignments = [
      roadmapRow("roadmap:v050-item", owner, "v0.5", "v0.5 scope"),
    ];
    const roadmapText = renderRoadmapText(roadmapAssignments);
    const registerText = sealRegister([owner], roadmapText, {
      schemaVersion: 2,
      baselineCommit: "00c342bd449948ab2ea5ca0b9d0c890614dd81d6",
      futureOwners: [],
      entries: [
        {
          key: "change:v050-release-program",
          sourceKind: "openspec_change",
          sourcePath: "openspec/changes/v050-release-program",
          disposition: "v050_owner",
          owner,
          targetRelease: "v0.5",
          reconcile: "complete",
          reason: "governor",
        },
        {
          key: "roadmap:v050-item",
          sourceKind: "roadmap",
          sourcePath: "ROADMAP.md",
          disposition: "v050_owner",
          owner,
          targetRelease: "v0.5",
          reconcile: "complete",
          reason: "governor roadmap",
        },
      ],
    });
    const phase: ReleaseCoveragePhaseV1 = {
      _tag: "Bootstrap",
      owner,
    };
    const common = {
      registerText,
      roadmapBytes: utf8(roadmapText),
      activeChangeNames: [owner],
      roadmapRows: roadmapAssignments,
      workflowByChange: { [owner]: ACTIVE_WF },
      changedSuperpowersPaths: [] as const,
      expectedBriefByOwner: {},
      packageBriefBytesByOwner: {},
    };
    assert.deepEqual(
      validateReleaseCoverageV1({
        ...common,
        phase,
        program: "v050",
      }),
      {
        schemaVersion: SCHEMA,
        _tag: "Valid",
        activeInventorySha256: activeInventorySha256([owner]),
        roadmapSha256: sha256Hex(utf8(roadmapText)),
        entryCount: 2,
      },
    );
    assert.deepEqual(
      validateReleaseCoverageV1({
        ...common,
        phase: { _tag: "Bootstrap", owner: ACTIVE_PKG },
        program: "v041" as never,
      }),
      {
        schemaVersion: SCHEMA,
        _tag: "Invalid",
        reason: "wrong_program",
      },
    );
    assert.equal(isReleaseProgram("v050"), true);
    assert.equal(isReleaseProgram("v041"), false);
    assert.deepEqual(releaseProgramTable("v050").dispositions, [
      "v050_owner",
      "v050_dependency",
      "released_reference",
      "superseded",
      "v060",
    ]);
    assert.equal(RELEASE_PROGRAMS.length, 2);
  });

  const V050_BASELINE = "00c342bd449948ab2ea5ca0b9d0c890614dd81d6";
  const V050_OWNER = "v050-release-program";
  const V050_DEP = "captured-facts-convergence";
  const V050_DEFERRED = "graph-store-port";
  const V050_ROADMAP_KEY = "roadmap:v050-publication";

  const v050GovernorEntry = {
    key: "change:v050-release-program",
    sourceKind: "openspec_change",
    sourcePath: "openspec/changes/v050-release-program",
    disposition: "v050_owner",
    owner: V050_OWNER,
    targetRelease: "v0.5",
    reconcile: "complete",
    reason: "governor",
  };

  const v050RoadmapEntry = {
    key: V050_ROADMAP_KEY,
    sourceKind: "roadmap",
    sourcePath: ROADMAP_PATH,
    disposition: "v050_owner",
    owner: V050_OWNER,
    targetRelease: "v0.5",
    reconcile: "complete",
    reason: "publication",
  };

  const v050DeferredEntry = {
    key: "change:graph-store-port",
    sourceKind: "openspec_change",
    sourcePath: "openspec/changes/graph-store-port",
    disposition: "v060",
    owner: V050_OWNER,
    targetRelease: "v0.6",
    reconcile: "not_required",
    reason: "deferred",
  };

  const v050Assignments = (): RoadmapAssignmentV1[] => [
    roadmapRow(V050_ROADMAP_KEY, V050_OWNER, "v0.5", "publication"),
  ];

  const sealV050 = (
    activeNames: readonly string[],
    roadmapText: string,
    overrides: Parameters<typeof renderRegister>[0] = {},
  ): string =>
    sealRegister(activeNames, roadmapText, {
      schemaVersion: 2,
      baselineCommit: V050_BASELINE,
      futureOwners: [],
      entries: [v050GovernorEntry, v050RoadmapEntry],
      ...overrides,
    });

  const runV050 = (
    input: ValidatorInput,
    extras: {
      readonly tasksMarkdownByOwner?: Readonly<Record<string, string>>;
      readonly baselineRegisterText?: string;
      readonly baselineRegisterAbsent?: boolean;
      readonly evidenceTexts?: readonly string[];
      readonly evidenceArtifacts?: readonly {
        readonly path: string;
        readonly text: string;
      }[];
    } = {},
  ): ValidatorResult => {
    const phase: ReleaseCoveragePhaseV1 =
      input.phase === "Bootstrap"
        ? { _tag: "Bootstrap", owner: V050_OWNER }
        : input.phase === "Lane"
          ? { _tag: "Lane", owner: input.laneOwner ?? V050_OWNER }
          : { _tag: "Release" };
    return validateReleaseCoverageV1({
      phase,
      registerText: input.registerText,
      roadmapBytes: utf8(input.roadmapText),
      activeChangeNames: input.activePackageNames,
      roadmapRows: input.roadmapAssignments,
      workflowByChange: input.packageWorkflowByName,
      changedSuperpowersPaths: input.changedPaths,
      expectedBriefByOwner: input.expectedPackageBriefByName,
      packageBriefBytesByOwner: input.packageBriefBytesByName,
      program: "v050",
      ...extras,
    }) as ValidatorResult;
  };

  const v050BaselineInput = (
    overrides: Partial<ValidatorInput> = {},
  ): ValidatorInput => {
    const activePackageNames = overrides.activePackageNames ?? [V050_OWNER];
    const roadmapAssignments = overrides.roadmapAssignments ?? v050Assignments();
    const roadmapText =
      overrides.roadmapText ?? renderRoadmapText(roadmapAssignments);
    const registerText =
      overrides.registerText ?? sealV050(activePackageNames, roadmapText);
    return {
      registerText,
      activePackageNames,
      roadmapText,
      roadmapAssignments,
      packageWorkflowByName:
        overrides.packageWorkflowByName ?? { [V050_OWNER]: ACTIVE_WF },
      expectedPackageBriefByName: overrides.expectedPackageBriefByName ?? {},
      packageBriefBytesByName: overrides.packageBriefBytesByName ?? {},
      changedPaths: overrides.changedPaths ?? [],
      phase: overrides.phase ?? "Bootstrap",
      ...(overrides.laneOwner === undefined ? {} : { laneOwner: overrides.laneOwner }),
    };
  };

  const expectV050Valid = (input: ValidatorInput, entryCount: number): void => {
    assert.deepEqual(runV050(input), {
      schemaVersion: SCHEMA,
      _tag: "Valid",
      activeInventorySha256: activeInventorySha256(input.activePackageNames),
      roadmapSha256: sha256Hex(utf8(input.roadmapText)),
      entryCount,
    });
  };

  const expectV050Invalid = (
    input: ValidatorInput,
    reason: Reason,
    extras: Parameters<typeof runV050>[1] = {},
  ): void => {
    assert.deepEqual(runV050(input, extras), {
      schemaVersion: SCHEMA,
      _tag: "Invalid",
      reason,
    });
  };

  it("accepts a valid v2 register at bootstrap", () => {
    expectV050Valid(v050BaselineInput(), 2);
  });

  it("rejects schema_version 1 for program v050 as invalid_register", () => {
    const base = v050BaselineInput();
    expectV050Invalid(
      v050BaselineInput({
        registerText: sealV050(base.activePackageNames, base.roadmapText, {
          schemaVersion: 1,
        }),
      }),
      "invalid_register",
    );
  });

  it("rejects register_cross_field when a v050_dependency names a v060 owner", () => {
    const active = [V050_OWNER, V050_DEP, V050_DEFERRED];
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealV050(active, roadmapText, {
      entries: [
        v050GovernorEntry,
        v050DeferredEntry,
        {
          key: "change:captured-facts-convergence",
          sourceKind: "openspec_change",
          sourcePath: "openspec/changes/captured-facts-convergence",
          disposition: "v050_dependency",
          owner: V050_DEFERRED,
          targetRelease: "v0.5",
          reconcile: "required",
          reason: "owner is deferred",
        },
        v050RoadmapEntry,
      ],
    });
    expectV050Invalid(
      v050BaselineInput({
        registerText,
        activePackageNames: active,
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName: { [V050_OWNER]: ACTIVE_WF },
      }),
      "register_cross_field",
    );
  });

  it("rejects register_cross_field when a v060 package names a non-governor owner", () => {
    const active = [V050_OWNER, V050_DEFERRED];
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealV050(active, roadmapText, {
      entries: [
        v050GovernorEntry,
        {
          ...v050DeferredEntry,
          owner: V050_DEFERRED,
        },
        v050RoadmapEntry,
      ],
    });
    expectV050Invalid(
      v050BaselineInput({
        registerText,
        activePackageNames: active,
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName: { [V050_OWNER]: ACTIVE_WF },
      }),
      "register_cross_field",
    );
  });

  it("rejects unreconciled when a v050 lane owner still has required entries", () => {
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealV050([V050_OWNER], roadmapText, {
      entries: [
        { ...v050GovernorEntry, reconcile: "required" },
        v050RoadmapEntry,
      ],
    });
    expectV050Invalid(
      v050BaselineInput({
        registerText,
        roadmapText,
        roadmapAssignments: assignments,
        phase: "Lane",
        laneOwner: V050_OWNER,
        expectedPackageBriefByName: {
          [V050_OWNER]: makeBrief("Ship v0.5.", V050_OWNER),
        },
        packageBriefBytesByName: {
          [V050_OWNER]: canonicalBriefBytes(makeBrief("Ship v0.5.", V050_OWNER)),
        },
      }),
      "unreconciled",
    );
  });

  it("rejects iron_rule_violation when the second of two Create targets is forbidden", () => {
    const input = v050BaselineInput({
      phase: "Lane",
      laneOwner: V050_OWNER,
      expectedPackageBriefByName: {
        [V050_OWNER]: makeBrief("Ship v0.5.", V050_OWNER),
      },
      packageBriefBytesByName: {
        [V050_OWNER]: canonicalBriefBytes(makeBrief("Ship v0.5.", V050_OWNER)),
      },
    });
    expectV050Invalid(input, "iron_rule_violation", {
      tasksMarkdownByOwner: {
        [V050_OWNER]: [
          "## Allowed file scope",
          "",
          "- `packages/orchestration/**`",
          "",
          "- [ ] Create `packages/policy/src/ok.ts` then Create `scripts/x.sh`",
          "",
        ].join("\n"),
      },
    });
  });

  it("rejects iron_rule_violation when Create is wrapped in parentheses", () => {
    const input = v050BaselineInput({
      phase: "Lane",
      laneOwner: V050_OWNER,
      expectedPackageBriefByName: {
        [V050_OWNER]: makeBrief("Ship v0.5.", V050_OWNER),
      },
      packageBriefBytesByName: {
        [V050_OWNER]: canonicalBriefBytes(makeBrief("Ship v0.5.", V050_OWNER)),
      },
    });
    expectV050Invalid(input, "iron_rule_violation", {
      tasksMarkdownByOwner: {
        [V050_OWNER]: [
          "## Allowed file scope",
          "",
          "- `packages/orchestration/**`",
          "",
          "- [ ] (Create `scripts/x.sh`)",
          "",
        ].join("\n"),
      },
    });
  });

  it("rejects iron_rule_violation for a new shell product path", () => {
    const input = v050BaselineInput({
      phase: "Lane",
      laneOwner: V050_OWNER,
      expectedPackageBriefByName: {
        [V050_OWNER]: makeBrief("Ship v0.5.", V050_OWNER),
      },
      packageBriefBytesByName: {
        [V050_OWNER]: canonicalBriefBytes(makeBrief("Ship v0.5.", V050_OWNER)),
      },
    });
    expectV050Invalid(input, "iron_rule_violation", {
      tasksMarkdownByOwner: {
        [V050_OWNER]: [
          "## Allowed file scope",
          "",
          "- `packages/orchestration/**`",
          "",
          "- [ ] Create `skills/foreman/scripts/spec-triage.sh`",
          "",
        ].join("\n"),
      },
    });
  });

  it("exempts iron_rule_violation when the line names a thin adapter", () => {
    const input = v050BaselineInput({
      phase: "Lane",
      laneOwner: V050_OWNER,
      expectedPackageBriefByName: {
        [V050_OWNER]: makeBrief("Ship v0.5.", V050_OWNER),
      },
      packageBriefBytesByName: {
        [V050_OWNER]: canonicalBriefBytes(makeBrief("Ship v0.5.", V050_OWNER)),
      },
    });
    const result = runV050(input, {
      tasksMarkdownByOwner: {
        [V050_OWNER]: [
          "## Allowed file scope",
          "",
          "- `packages/orchestration/**`",
          "",
          "- [ ] Create `skills/foreman/scripts/spec-triage.sh` as a thin adapter",
          "",
        ].join("\n"),
      },
    });
    assert.equal(result._tag, "Valid");
  });

  it("rejects deferred_package_changed when compact key spelling is unchanged", () => {
    const active = [V050_OWNER, V050_DEFERRED];
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const spaced = sealV050(active, roadmapText, {
      entries: [v050GovernorEntry, v050DeferredEntry, v050RoadmapEntry],
    });
    const compact = spaced.replace(
      `key = "change:${V050_DEFERRED}"`,
      `key="change:${V050_DEFERRED}"`,
    );
    expectV050Invalid(
      v050BaselineInput({
        registerText: compact,
        activePackageNames: active,
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName: { [V050_OWNER]: ACTIVE_WF },
        changedPaths: ["openspec/changes/graph-store-port/tasks.md"],
      }),
      "deferred_package_changed",
      { baselineRegisterText: compact },
    );
  });

  it("rejects deferred_package_changed when a v060 directory changes and the entry does not", () => {
    const active = [V050_OWNER, V050_DEFERRED];
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealV050(active, roadmapText, {
      entries: [v050GovernorEntry, v050DeferredEntry, v050RoadmapEntry],
    });
    expectV050Invalid(
      v050BaselineInput({
        registerText,
        activePackageNames: active,
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName: { [V050_OWNER]: ACTIVE_WF },
        changedPaths: ["openspec/changes/graph-store-port/tasks.md"],
      }),
      "deferred_package_changed",
      { baselineRegisterText: registerText },
    );
  });

  it("rejects workflow_mismatch when a v050_owner package is absent from workflowByChange", () => {
    const active = [V050_OWNER, "lane-runtime-typescript"];
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealV050(active, roadmapText, {
      entries: [
        v050GovernorEntry,
        {
          key: "change:lane-runtime-typescript",
          sourceKind: "openspec_change",
          sourcePath: "openspec/changes/lane-runtime-typescript",
          disposition: "v050_owner",
          owner: "lane-runtime-typescript",
          targetRelease: "v0.5",
          reconcile: "complete",
          reason: "runtime",
        },
        v050RoadmapEntry,
      ],
    });
    expectV050Invalid(
      v050BaselineInput({
        registerText,
        activePackageNames: active,
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName: {
          [V050_OWNER]: ACTIVE_WF,
        },
      }),
      "workflow_mismatch",
    );
  });

  it("rejects workflow_mismatch when a named v050_owner package has no workflow", () => {
    const active = [V050_OWNER, "lane-runtime-typescript"];
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealV050(active, roadmapText, {
      entries: [
        v050GovernorEntry,
        {
          key: "change:lane-runtime-typescript",
          sourceKind: "openspec_change",
          sourcePath: "openspec/changes/lane-runtime-typescript",
          disposition: "v050_owner",
          owner: "lane-runtime-typescript",
          targetRelease: "v0.5",
          reconcile: "complete",
          reason: "runtime",
        },
        v050RoadmapEntry,
      ],
    });
    expectV050Invalid(
      v050BaselineInput({
        registerText,
        activePackageNames: active,
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName: {
          [V050_OWNER]: ACTIVE_WF,
          "lane-runtime-typescript": null,
        },
      }),
      "workflow_mismatch",
    );
  });

  it("rejects vocabulary_mixed when a release artifact uses UNVERIFIED as a verdict", () => {
    const brief = makeBrief("Ship v0.5.", V050_OWNER);
    const input = v050BaselineInput({
      phase: "Release",
      expectedPackageBriefByName: { [V050_OWNER]: brief },
      packageBriefBytesByName: { [V050_OWNER]: canonicalBriefBytes(brief) },
    });
    expectV050Invalid(input, "vocabulary_mixed", {
      evidenceTexts: ['{"verdict":"UNVERIFIED"}\n'],
    });
  });

  const v050ReleaseLaneInput = (): ValidatorInput => {
    const brief = makeBrief("Ship v0.5.", V050_OWNER);
    return v050BaselineInput({
      phase: "Release",
      expectedPackageBriefByName: { [V050_OWNER]: brief },
      packageBriefBytesByName: { [V050_OWNER]: canonicalBriefBytes(brief) },
    });
  };

  it("rejects vocabulary_mixed for a nested JSON verdict in a subdirectory artifact", () => {
    expectV050Invalid(v050ReleaseLaneInput(), "vocabulary_mixed", {
      evidenceArtifacts: [
        {
          path: "nested/deep/report.json",
          text: '{"outer":{"inner":{"verdict":"UNVERIFIED"}}}\n',
        },
      ],
    });
  });

  it("rejects vocabulary_mixed for APPROVED123", () => {
    expectV050Invalid(v050ReleaseLaneInput(), "vocabulary_mixed", {
      evidenceArtifacts: [
        { path: "verdict.json", text: '{"verdict":"APPROVED123"}\n' },
      ],
    });
  });

  it("rejects vocabulary_mixed for an empty verdict", () => {
    expectV050Invalid(v050ReleaseLaneInput(), "vocabulary_mixed", {
      evidenceArtifacts: [{ path: "verdict.json", text: '{"verdict":""}\n' }],
    });
  });

  it("rejects vocabulary_mixed for a numeric verdict", () => {
    expectV050Invalid(v050ReleaseLaneInput(), "vocabulary_mixed", {
      evidenceArtifacts: [{ path: "verdict.json", text: '{"verdict":1}\n' }],
    });
  });

  it("rejects vocabulary_mixed for lowercase failed", () => {
    expectV050Invalid(v050ReleaseLaneInput(), "vocabulary_mixed", {
      evidenceArtifacts: [
        { path: "measure.json", text: '{"measurement_result":"failed"}\n' },
      ],
    });
  });

  it("rejects vocabulary_mixed for PASS123", () => {
    expectV050Invalid(v050ReleaseLaneInput(), "vocabulary_mixed", {
      evidenceArtifacts: [
        { path: "measure.json", text: '{"measurement_result":"PASS123"}\n' },
      ],
    });
  });

  it("accepts both valid vocabularies in one evidence directory", () => {
    const result = runV050(v050ReleaseLaneInput(), {
      evidenceArtifacts: [
        { path: "nested/verdict.json", text: '{"verdict":"APPROVED"}\n' },
        { path: "nested/measure.md", text: "measurement_result: PASS\n" },
      ],
    });
    assert.equal(result._tag, "Valid");
  });

  it("returns dependency_failure for unparsable JSON evidence", () => {
    expectV050Invalid(v050ReleaseLaneInput(), "dependency_failure", {
      evidenceArtifacts: [{ path: "broken.json", text: "{not-json\n" }],
    });
  });

  it("rejects workflow_mismatch for an empty tasks.md", () => {
    const input = v050BaselineInput({
      phase: "Lane",
      laneOwner: V050_OWNER,
      expectedPackageBriefByName: {
        [V050_OWNER]: makeBrief("Ship v0.5.", V050_OWNER),
      },
      packageBriefBytesByName: {
        [V050_OWNER]: canonicalBriefBytes(makeBrief("Ship v0.5.", V050_OWNER)),
      },
    });
    expectV050Invalid(input, "workflow_mismatch", {
      tasksMarkdownByOwner: { [V050_OWNER]: "" },
    });
  });

  it("rejects workflow_mismatch for a heading-only tasks.md", () => {
    const input = v050BaselineInput({
      phase: "Lane",
      laneOwner: V050_OWNER,
      expectedPackageBriefByName: {
        [V050_OWNER]: makeBrief("Ship v0.5.", V050_OWNER),
      },
      packageBriefBytesByName: {
        [V050_OWNER]: canonicalBriefBytes(makeBrief("Ship v0.5.", V050_OWNER)),
      },
    });
    expectV050Invalid(input, "workflow_mismatch", {
      tasksMarkdownByOwner: { [V050_OWNER]: "## Allowed file scope\n" },
    });
  });

  it("rejects workflow_mismatch when # Tasks follows the allowed file scope heading", () => {
    const input = v050BaselineInput({
      phase: "Lane",
      laneOwner: V050_OWNER,
      expectedPackageBriefByName: {
        [V050_OWNER]: makeBrief("Ship v0.5.", V050_OWNER),
      },
      packageBriefBytesByName: {
        [V050_OWNER]: canonicalBriefBytes(makeBrief("Ship v0.5.", V050_OWNER)),
      },
    });
    expectV050Invalid(input, "workflow_mismatch", {
      tasksMarkdownByOwner: {
        [V050_OWNER]: "## Allowed file scope\n\n# Tasks\n",
      },
    });
  });

  it("rejects workflow_mismatch when ### Tasks follows the allowed file scope heading", () => {
    const input = v050BaselineInput({
      phase: "Lane",
      laneOwner: V050_OWNER,
      expectedPackageBriefByName: {
        [V050_OWNER]: makeBrief("Ship v0.5.", V050_OWNER),
      },
      packageBriefBytesByName: {
        [V050_OWNER]: canonicalBriefBytes(makeBrief("Ship v0.5.", V050_OWNER)),
      },
    });
    expectV050Invalid(input, "workflow_mismatch", {
      tasksMarkdownByOwner: {
        [V050_OWNER]: "## Allowed file scope\n\n### Tasks\n",
      },
    });
  });

  it("accepts a scope heading followed by one path line", () => {
    const input = v050BaselineInput({
      phase: "Lane",
      laneOwner: V050_OWNER,
      expectedPackageBriefByName: {
        [V050_OWNER]: makeBrief("Ship v0.5.", V050_OWNER),
      },
      packageBriefBytesByName: {
        [V050_OWNER]: canonicalBriefBytes(makeBrief("Ship v0.5.", V050_OWNER)),
      },
    });
    const result = runV050(input, {
      tasksMarkdownByOwner: {
        [V050_OWNER]: "## Allowed file scope\n\n- `packages/policy/**`\n",
      },
    });
    assert.equal(result._tag, "Valid");
  });

  it("keeps a missing tasks.md valid for a v050 lane", () => {
    const input = v050BaselineInput({
      phase: "Lane",
      laneOwner: V050_OWNER,
      expectedPackageBriefByName: {
        [V050_OWNER]: makeBrief("Ship v0.5.", V050_OWNER),
      },
      packageBriefBytesByName: {
        [V050_OWNER]: canonicalBriefBytes(makeBrief("Ship v0.5.", V050_OWNER)),
      },
    });
    expectV050Valid(input, 2);
  });

  it("rejects register_cross_field when a v050_owner names a missing package", () => {
    const ghost = "ghost-owner-package";
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealV050([V050_OWNER], roadmapText, {
      entries: [
        { ...v050GovernorEntry, owner: ghost },
        v050RoadmapEntry,
      ],
    });
    expectV050Invalid(
      v050BaselineInput({
        registerText,
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName: { [V050_OWNER]: ACTIVE_WF },
      }),
      "register_cross_field",
    );
  });

  it("rejects inventory_mismatch when a v050 active name is omitted", () => {
    const extra = "lane-runtime-typescript";
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealV050([V050_OWNER, extra], roadmapText, {
      entries: [
        v050GovernorEntry,
        {
          key: `change:${extra}`,
          sourceKind: "openspec_change",
          sourcePath: `openspec/changes/${extra}`,
          disposition: "v050_owner",
          owner: extra,
          targetRelease: "v0.5",
          reconcile: "complete",
          reason: "runtime",
        },
        v050RoadmapEntry,
      ],
    });
    expectV050Invalid(
      v050BaselineInput({
        registerText,
        activePackageNames: [V050_OWNER],
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName: { [V050_OWNER]: ACTIVE_WF, [extra]: ACTIVE_WF },
      }),
      "inventory_mismatch",
    );
  });

  it("rejects inventory_mismatch when a v050 inventory digest does not match", () => {
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    expectV050Invalid(
      v050BaselineInput({
        registerText: sealV050([V050_OWNER], roadmapText, {
          activeInventorySha256: "ab".repeat(32),
        }),
        roadmapText,
        roadmapAssignments: assignments,
      }),
      "inventory_mismatch",
    );
  });

  it("rejects roadmap_mismatch when a v050 row has no matching entry", () => {
    const extraRow = roadmapRow("roadmap:v050-extra", V050_OWNER, "v0.5", "extra");
    const assignments = [...v050Assignments(), extraRow];
    expectV050Invalid(
      v050BaselineInput({
        roadmapAssignments: assignments,
        roadmapText: renderRoadmapText(assignments),
      }),
      "roadmap_mismatch",
    );
  });

  it("rejects roadmap_mismatch when a v050 entry has no matching row", () => {
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealV050([V050_OWNER], roadmapText, {
      entries: [
        v050GovernorEntry,
        v050RoadmapEntry,
        {
          key: "roadmap:v050-extra",
          sourceKind: "roadmap",
          sourcePath: ROADMAP_PATH,
          disposition: "v050_owner",
          owner: V050_OWNER,
          targetRelease: "v0.5",
          reconcile: "complete",
          reason: "extra",
        },
      ],
    });
    expectV050Invalid(
      v050BaselineInput({
        registerText,
        roadmapText,
        roadmapAssignments: assignments,
      }),
      "roadmap_mismatch",
    );
  });

  it("rejects roadmap_mismatch when a v050 row owner does not match", () => {
    const assignments = [
      roadmapRow(V050_ROADMAP_KEY, "lane-runtime-typescript", "v0.5", "publication"),
    ];
    const roadmapText = renderRoadmapText(assignments);
    expectV050Invalid(
      v050BaselineInput({
        registerText: sealV050([V050_OWNER], roadmapText),
        roadmapText,
        roadmapAssignments: assignments,
      }),
      "roadmap_mismatch",
    );
  });

  it("rejects roadmap_mismatch when a v050 row release does not match", () => {
    const assignments = [
      roadmapRow(V050_ROADMAP_KEY, V050_OWNER, "v0.6", "publication"),
    ];
    const roadmapText = renderRoadmapText(assignments);
    expectV050Invalid(
      v050BaselineInput({
        registerText: sealV050([V050_OWNER], roadmapText),
        roadmapText,
        roadmapAssignments: assignments,
      }),
      "roadmap_mismatch",
    );
  });

  it("rejects unreconciled when another v050 entry names the lane owner as required", () => {
    const extra = "captured-facts-convergence";
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealV050([V050_OWNER, extra], roadmapText, {
      entries: [
        v050GovernorEntry,
        {
          key: `change:${extra}`,
          sourceKind: "openspec_change",
          sourcePath: `openspec/changes/${extra}`,
          disposition: "v050_dependency",
          owner: V050_OWNER,
          targetRelease: "v0.5",
          reconcile: "required",
          reason: "dependency still required",
        },
        v050RoadmapEntry,
      ],
    });
    expectV050Invalid(
      v050BaselineInput({
        registerText,
        activePackageNames: [V050_OWNER, extra],
        roadmapText,
        roadmapAssignments: assignments,
        phase: "Lane",
        laneOwner: V050_OWNER,
        packageWorkflowByName: { [V050_OWNER]: ACTIVE_WF },
        expectedPackageBriefByName: {
          [V050_OWNER]: makeBrief("Ship v0.5.", V050_OWNER),
        },
        packageBriefBytesByName: {
          [V050_OWNER]: canonicalBriefBytes(makeBrief("Ship v0.5.", V050_OWNER)),
        },
      }),
      "unreconciled",
    );
  });

  it("skips deferred byte comparison when the baseline has no matching entry", () => {
    const active = [V050_OWNER, V050_DEFERRED];
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const current = sealV050(active, roadmapText, {
      entries: [v050GovernorEntry, v050DeferredEntry, v050RoadmapEntry],
    });
    const baseline = sealV050([V050_OWNER], roadmapText, {
      entries: [v050GovernorEntry, v050RoadmapEntry],
    });
    const result = runV050(
      v050BaselineInput({
        registerText: current,
        activePackageNames: active,
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName: { [V050_OWNER]: ACTIVE_WF },
        changedPaths: ["openspec/changes/graph-store-port/tasks.md"],
      }),
      { baselineRegisterText: baseline },
    );
    assert.equal(result._tag, "Valid");
  });

  it("rejects deferred_package_changed when the baseline register is absent and a v060 directory changes", () => {
    const active = [V050_OWNER, V050_DEFERRED];
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealV050(active, roadmapText, {
      entries: [v050GovernorEntry, v050DeferredEntry, v050RoadmapEntry],
    });
    expectV050Invalid(
      v050BaselineInput({
        registerText,
        activePackageNames: active,
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName: { [V050_OWNER]: ACTIVE_WF },
        changedPaths: ["openspec/changes/graph-store-port/tasks.md"],
      }),
      "deferred_package_changed",
      { baselineRegisterAbsent: true },
    );
  });

  it("accepts an absent baseline register when deferred directories are unchanged", () => {
    const active = [V050_OWNER, V050_DEFERRED];
    const assignments = v050Assignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealV050(active, roadmapText, {
      entries: [v050GovernorEntry, v050DeferredEntry, v050RoadmapEntry],
    });
    const result = runV050(
      v050BaselineInput({
        registerText,
        activePackageNames: active,
        roadmapText,
        roadmapAssignments: assignments,
        packageWorkflowByName: { [V050_OWNER]: ACTIVE_WF },
      }),
      { baselineRegisterAbsent: true },
    );
    assert.equal(result._tag, "Valid");
  });


  it("accepts the live v0.5 register at bootstrap", () => {
    const registerText = readFileSync(
      join(repoRoot, "openspec", "changes", "v050-release-program", "coverage.toml"),
      "utf8",
    );
    assert.match(registerText, /^schema_version\s*=\s*2\b/m);

    const inspection = inspectReleaseCoverageRegisterV1({
      registerText,
      phase: { _tag: "Bootstrap", owner: V050_OWNER },
      program: "v050",
    });
    assert.equal(inspection._tag, "Valid");
    if (inspection._tag !== "Valid") return;

    const changesRoot = join(repoRoot, "openspec", "changes");
    const activePackageNames = readdirSync(changesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "archive")
      .map((entry) => entry.name)
      .sort((a, b) => {
        const ab = utf8(a);
        const bb = utf8(b);
        const n = Math.min(ab.length, bb.length);
        for (let i = 0; i < n; i++) {
          if (ab[i] !== bb[i]) return ab[i]! - bb[i]!;
        }
        return ab.length - bb.length;
      });

    const roadmapText = readFileSync(join(repoRoot, "ROADMAP.md"), "utf8");
    const roadmapAssignments: RoadmapAssignmentV1[] = [];
    for (const match of roadmapText.matchAll(
      /^\| `([^`]+)` \| ([^|]+) \| `([^`]+)` \| `([^`]+)` \|$/gm,
    )) {
      const key = match[1]!;
      if (!key.startsWith("roadmap:")) continue;
      roadmapAssignments.push({
        key,
        scope: match[2]!.trim(),
        release: match[3]! as RoadmapAssignmentV1["release"],
        owner: match[4]!,
      });
    }
    assert.ok(roadmapAssignments.length > 0);

    const ownerNames = v050OwnerPackageNames(registerText, "v050");
    assert.equal(ownerNames.length, 12);
    const packageWorkflowByName: Record<string, string | null> = {};
    for (const owner of ownerNames) {
      const metaPath = join(changesRoot, owner, ".openspec.yaml");
      if (!existsSync(metaPath)) {
        packageWorkflowByName[owner] = null;
        continue;
      }
      const raw = readFileSync(metaPath, "utf8");
      const schemaMatch = /^schema:\s*(\S+)\s*$/m.exec(raw);
      packageWorkflowByName[owner] = schemaMatch ? schemaMatch[1]! : null;
    }
    assert.equal(Object.keys(packageWorkflowByName).length, 12);
    assert.equal(
      Object.values(packageWorkflowByName).every((value) => value !== null),
      true,
    );

    const result = validateReleaseCoverageV1({
      phase: { _tag: "Bootstrap", owner: V050_OWNER },
      registerText,
      roadmapBytes: utf8(roadmapText),
      activeChangeNames: activePackageNames,
      roadmapRows: roadmapAssignments,
      workflowByChange: packageWorkflowByName,
      changedSuperpowersPaths: [],
      expectedBriefByOwner: {},
      packageBriefBytesByOwner: {},
      program: "v050",
    });
    assert.equal(result._tag, "Valid");
    if (result._tag !== "Valid") return;
    assert.equal(
      result.activeInventorySha256,
      activeInventorySha256(activePackageNames),
    );
    assert.equal(result.roadmapSha256, sha256Hex(utf8(roadmapText)));
  });
});
