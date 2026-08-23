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
  it("exports the pure validator", () => {
    assert.equal(typeof validateReleaseCoverageV1, "function");
  });
});
