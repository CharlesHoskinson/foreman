import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateReleaseCoverageV1,
  type ReleaseCoverageFailureReason,
  type ReleaseCoveragePhaseV1,
  type ReleasePackageBriefV1,
  type RoadmapAssignmentV1,
} from "./release-coverage.js";

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
      `baseline_commit = ${tomlString(opts.baselineCommit ?? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")}`,
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

  const makeBrief = (objective: string): Brief => ({
    schema: "foreman.release-package-brief.v1",
    familySha256: "b".repeat(64),
    childId: "v040-t1-convergence",
    packageId: ACTIVE_PKG,
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
      laneOwner: overrides.laneOwner,
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
        )}[[future_owner]]\nname = "x"\ntarget_release = "v0.4"\nreason = "r"\n`,
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
        name: "malformed owner",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              { ...track1Entry, owner: "Bad_Owner" },
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
              track1Entry,
              {
                ...futureRoadmapEntry,
                disposition: "released_reference",
                targetRelease: "v0.4",
                reconcile: "not_required",
              },
            ],
          },
        ),
      },
      {
        name: "superseded requires not_required",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              track1Entry,
              {
                ...futureRoadmapEntry,
                disposition: "superseded",
                targetRelease: "v0.5",
                reconcile: "required",
              },
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
              track1Entry,
              {
                ...futureRoadmapEntry,
                disposition: "v050",
                targetRelease: "v0.4",
                reconcile: "not_required",
              },
            ],
          },
        ),
      },
      {
        name: "v040_dependency complete mismatch",
        registerText: sealRegister(
          base.activePackageNames,
          base.roadmapText,
          {
            entries: [
              track1Entry,
              {
                ...futureRoadmapEntry,
                disposition: "v040_dependency",
                reconcile: "complete",
              },
            ],
          },
        ),
      },
    ];
    for (const c of cases) {
      expectInvalid(cloneInput(base, { registerText: c.registerText }), "invalid_register");
    }
  });

  it("covers every register field and enum literal in a valid sealed register", () => {
    const active = [ACTIVE_PKG];
    const assignments = [
      roadmapRow("roadmap:a", FUTURE, "v0.4", "sa"),
      roadmapRow("roadmap:b", FUTURE, "v0.5", "sb"),
      roadmapRow("roadmap:c", FUTURE, "released", "sc"),
    ];
    const roadmapText = renderRoadmapText(assignments);
    const entries = [
      {
        key: "openspec:change-a",
        sourceKind: "openspec_change",
        sourcePath: "openspec/changes/a/proposal.md",
        disposition: "v040_owner",
        owner: ACTIVE_PKG,
        targetRelease: "v0.4",
        reconcile: "complete",
        reason: "owner",
      },
      {
        key: "openspec:change-b",
        sourceKind: "openspec_change",
        sourcePath: "openspec/changes/b/proposal.md",
        disposition: "v040_dependency",
        owner: ACTIVE_PKG,
        targetRelease: "v0.4",
        reconcile: "required",
        reason: "dep",
      },
      {
        key: "roadmap:a",
        sourceKind: "roadmap",
        sourcePath: ROADMAP_PATH,
        disposition: "v040_owner",
        owner: FUTURE,
        targetRelease: "v0.4",
        reconcile: "required",
        reason: "ra",
      },
      {
        key: "roadmap:b",
        sourceKind: "roadmap",
        sourcePath: ROADMAP_PATH,
        disposition: "v050",
        owner: FUTURE,
        targetRelease: "v0.5",
        reconcile: "not_required",
        reason: "rb",
      },
      {
        key: "roadmap:c",
        sourceKind: "roadmap",
        sourcePath: ROADMAP_PATH,
        disposition: "released_reference",
        owner: FUTURE,
        targetRelease: "released",
        reconcile: "not_required",
        reason: "rc",
      },
      {
        key: "openspec:change-c",
        sourceKind: "openspec_change",
        sourcePath: "openspec/changes/c/proposal.md",
        disposition: "superseded",
        owner: ACTIVE_PKG,
        targetRelease: "v0.4",
        reconcile: "not_required",
        reason: "old",
      },
    ];
    const registerText = sealRegister(active, roadmapText, {
      futureOwners: [futureOwner],
      entries,
    });
    expectValid(
      validBaseline({
        registerText,
        activePackageNames: active,
        roadmapText,
        roadmapAssignments: assignments,
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
          { ...roadmapRow(ROADMAP_KEY, FUTURE), owner: "Bad" },
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
    ];
    for (const c of cases) {
      const roadmapAssignments = c.roadmapAssignments;
      const roadmapText =
        c.roadmapText ?? renderRoadmapText(roadmapAssignments);
      const registerText = sealRegister(
        base.activePackageNames,
        roadmapText,
        {
          entries: [
            track1Entry,
            {
              ...futureRoadmapEntry,
              key: roadmapAssignments[0]?.key ?? ROADMAP_KEY,
              owner: roadmapAssignments[0]?.owner ?? FUTURE,
              targetRelease:
                (roadmapAssignments[0]?.release as string) ?? "v0.4",
            },
          ],
        },
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
  });

  it("rejects duplicate_identity and allows shared ROADMAP.md paths", () => {
    const base = validBaseline();
    const dupKey = sealRegister(
      base.activePackageNames,
      base.roadmapText,
      {
        entries: [
          track1Entry,
          { ...track1Entry, sourcePath: "openspec/changes/other/proposal.md" },
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
            key: "openspec:other",
            sourcePath: OPENSPEC_PATH,
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

    const uniA = "ä-package";
    const uniB = "b-package";
    const namesWrongOrderDigest = [uniB, uniA];
    const sortedSha = activeInventorySha256([uniA, uniB]);
    const swappedSha = activeInventorySha256([uniB, uniA]);
    assert.notEqual(sortedSha, swappedSha);
    const roadmapText = base.roadmapText;
    const registerText = sealRegister(namesWrongOrderDigest, roadmapText, {
      activeInventorySha256: swappedSha,
      entries: [
        { ...track1Entry, owner: uniA },
        futureRoadmapEntry,
      ],
      futureOwners: [futureOwner],
    });
    expectInvalid(
      validBaseline({
        registerText,
        activePackageNames: [uniA, uniB],
        roadmapText,
        packageWorkflowByName: { [uniA]: ACTIVE_WF, [uniB]: ACTIVE_WF },
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
    const brief: Brief = {
      packageName: ACTIVE_PKG,
      workflow: ACTIVE_WF,
      summary: "ok",
    };
    const laneBase = validBaseline({
      phase: "Lane",
      expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
      packageBriefBytesByName: {
        [ACTIVE_PKG]: canonicalBriefBytes(brief),
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

    const irrelevant = "other-active";
    const names = [ACTIVE_PKG, irrelevant];
    const assignments = baselineAssignments();
    const roadmapText = renderRoadmapText(assignments);
    const registerText = sealRegister(names, roadmapText, {
      entries: [
        track1Entry,
        futureRoadmapEntry,
        {
          key: "openspec:irrelevant",
          sourceKind: "openspec_change",
          sourcePath: "openspec/changes/irrelevant/proposal.md",
          disposition: "v050",
          owner: irrelevant,
          targetRelease: "v0.5",
          reconcile: "not_required",
          reason: "phase irrelevant",
        },
      ],
    });
    const brief2: Brief = {
      packageName: ACTIVE_PKG,
      workflow: ACTIVE_WF,
      summary: "ok",
    };
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
    const brief: Brief = {
      packageName: ACTIVE_PKG,
      workflow: ACTIVE_WF,
      summary: "lane brief",
    };
    const bytes = canonicalBriefBytes(brief);
    const laneOk = validBaseline({
      phase: "Lane",
      expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
      packageBriefBytesByName: { [ACTIVE_PKG]: bytes },
    });
    expectValid(laneOk, 2);

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
            `${JSON.stringify({ summary: brief.summary, workflow: brief.workflow, packageName: brief.packageName })}\n`,
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
            summary: "different",
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

    expectInvalid(
      validBaseline({
        phase: "Bootstrap",
        expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
        packageBriefBytesByName: { [ACTIVE_PKG]: bytes },
      }),
      "brief_mismatch",
    );

    const releaseOk = validBaseline({
      phase: "Release",
      expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
      packageBriefBytesByName: { [ACTIVE_PKG]: bytes },
    });
    expectValid(releaseOk, 2);
  });

  it("flags unreconciled required future entries in Lane and Release only", () => {
    const brief: Brief = {
      packageName: ACTIVE_PKG,
      workflow: ACTIVE_WF,
      summary: "ok",
    };
    const bytes = canonicalBriefBytes(brief);
    const inputBootstrap = validBaseline({ phase: "Bootstrap" });
    expectValid(inputBootstrap, 2);

    for (const phase of ["Lane", "Release"] as const) {
      expectInvalid(
        validBaseline({
          phase,
          expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
          packageBriefBytesByName: { [ACTIVE_PKG]: bytes },
        }),
        "unreconciled",
      );
    }

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
    for (const phase of ["Lane", "Release"] as const) {
      expectValid(
        validBaseline({
          phase,
          registerText: completeFuture,
          expectedPackageBriefByName: { [ACTIVE_PKG]: brief },
          packageBriefBytesByName: { [ACTIVE_PKG]: bytes },
        }),
        2,
      );
    }
  });

  it("rejects competing_plan only for changed docs/superpowers paths", () => {
    const base = validBaseline();
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
    ];
    for (const partial of malformed) {
      expectInvalid(cloneInput(base, partial), "dependency_failure");
    }
  });

  it("accepts the authored coverage.toml with derived inputs", () => {
    const authoredPath = new URL(
      "../../../openspec/changes/v040-release-program/coverage.toml",
      import.meta.url,
    );
    const registerText = readFileSync(authoredPath, "utf8");
    assert.match(registerText, /^schema_version\s*=\s*1\b/m);

    const futureOwners: { name: string; targetRelease: string; reason: string }[] =
      [];
    const entries: {
      key: string;
      sourceKind: string;
      sourcePath: string;
      disposition: string;
      owner: string;
      targetRelease: string;
      reconcile: string;
      reason: string;
    }[] = [];
    let section: "none" | "future_owner" | "entry" = "none";
    let cur: Record<string, string> = {};
    const flush = () => {
      if (section === "future_owner") {
        futureOwners.push({
          name: cur.name!,
          targetRelease: cur.target_release!,
          reason: cur.reason!,
        });
      } else if (section === "entry") {
        entries.push({
          key: cur.key!,
          sourceKind: cur.source_kind!,
          sourcePath: cur.source_path!,
          disposition: cur.disposition!,
          owner: cur.owner!,
          targetRelease: cur.target_release!,
          reconcile: cur.reconcile!,
          reason: cur.reason!,
        });
      }
      cur = {};
    };
    for (const line of registerText.split("\n")) {
      const t = line.trim();
      if (t === "[[future_owner]]") {
        flush();
        section = "future_owner";
        continue;
      }
      if (t === "[[entry]]") {
        flush();
        section = "entry";
        continue;
      }
      const m = /^([a-z_]+)\s*=\s*(.+)$/.exec(t);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2]!.trim();
      if (val.startsWith('"')) val = JSON.parse(val) as string;
      if (section === "none") continue;
      cur[key] = String(val);
    }
    flush();

    const activePackageNames = [
      ...new Set(
        entries
          .filter((entry) => entry.sourceKind === "openspec_change")
          .map((entry) => {
            const match = /^openspec\/changes\/([^/]+)$/.exec(
              entry.sourcePath,
            );
            assert.ok(match, `invalid authored OpenSpec source: ${entry.key}`);
            return match[1]!;
          }),
      ),
    ];
    assert.equal(
      activeInventorySha256(activePackageNames),
      "148f3c5862053bbebea1ad7ac8842237b70f3877c402b3bc9209e85c2e7733fb",
    );

    const roadmapEntries = entries.filter((e) => e.sourceKind === "roadmap");
    const roadmapAssignments: RoadmapAssignmentV1[] = roadmapEntries.map(
      (e) =>
        roadmapRow(
          e.key,
          e.owner,
          e.targetRelease as RoadmapAssignmentV1["release"],
          e.reason,
        ),
    );
    const roadmapText = readFileSync(join(repoRoot, "ROADMAP.md"), "utf8");
    const packageWorkflowByName: Record<string, string | null> = {};
    for (const n of activePackageNames) {
      packageWorkflowByName[n] = ACTIVE_WF;
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
    expectValid(input, entries.length);
  });
});
