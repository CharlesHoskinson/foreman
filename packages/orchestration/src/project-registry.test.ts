import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  decodeProjectRegistryFileV1,
  emptyProjectRegistryV1,
  registerProjectFileV1,
  registerProjectV1,
  renderProjectRegistryFileV1,
  resolveProjectV1,
  type ProjectRegistryV1,
} from "./index.js";

const PROJECT_A = "123e4567-e89b-42d3-a456-426614174000";
const PROJECT_B = "223e4567-e89b-42d3-a456-426614174000";
const OP_A = "323e4567-e89b-42d3-a456-426614174000";
const OP_B = "423e4567-e89b-42d3-a456-426614174000";
const ROOT = "/registry-test";
const COMMON = join(ROOT, "repo", ".git");
const STORE = join(ROOT, "repo", ".foreman", "session.db");
const WT_A = join(ROOT, "repo");
const WT_B = join(ROOT, "worktrees", "feature");

function register(
  registry: ProjectRegistryV1,
  over: Partial<Parameters<typeof registerProjectV1>[1]> = {},
) {
  return registerProjectV1(registry, {
    project_id: PROJECT_A,
    operation_id: OP_A,
    git_common_dir: COMMON,
    worktree_path: WT_A,
    store_backend: "sqlite",
    store_location: STORE,
    ...over,
  });
}

test("project registry canonical file round-trips", () => {
  const first = register(emptyProjectRegistryV1());
  assert.equal(first._tag, "Registered");
  if (first._tag !== "Registered") return;

  const bytes = renderProjectRegistryFileV1(first.registry);
  assert.equal(new TextDecoder().decode(bytes).endsWith("\n"), true);
  const decoded = decodeProjectRegistryFileV1(bytes);
  assert.deepEqual(decoded, { _tag: "Valid", value: first.registry });
  assert.deepEqual(renderProjectRegistryFileV1(first.registry), bytes);
});

test("linked worktrees share one project identity", () => {
  const first = register(emptyProjectRegistryV1());
  assert.equal(first._tag, "Registered");
  if (first._tag !== "Registered") return;

  const second = register(first.registry, {
    project_id: PROJECT_B,
    operation_id: OP_B,
    worktree_path: WT_B,
  });
  assert.equal(second._tag, "Registered");
  if (second._tag !== "Registered") return;
  assert.equal(second.project.project_id, PROJECT_A);
  assert.equal(second.project.operation_id, OP_A);
  assert.deepEqual(second.project.worktree_paths, [WT_A, WT_B]);
  assert.equal(second.registry.generation, 2);
});

test("identical registration is byte-idempotent", () => {
  const first = register(emptyProjectRegistryV1());
  assert.equal(first._tag, "Registered");
  if (first._tag !== "Registered") return;
  const before = renderProjectRegistryFileV1(first.registry);

  const replay = register(first.registry, {
    project_id: PROJECT_B,
    operation_id: OP_B,
  });
  assert.equal(replay._tag, "Registered");
  if (replay._tag !== "Registered") return;
  assert.equal(replay.changed, false);
  assert.deepEqual(renderProjectRegistryFileV1(replay.registry), before);
});

test("conflicting common directory or store refuses without mutation", () => {
  const first = register(emptyProjectRegistryV1());
  assert.equal(first._tag, "Registered");
  if (first._tag !== "Registered") return;

  for (const input of [
    {
      project_id: PROJECT_B,
      operation_id: OP_B,
      git_common_dir: COMMON,
      worktree_path: join(ROOT, "other"),
      store_backend: "sqlite" as const,
      store_location: join(ROOT, "other", "session.db"),
    },
    {
      project_id: PROJECT_B,
      operation_id: OP_B,
      git_common_dir: join(ROOT, "other", ".git"),
      worktree_path: join(ROOT, "other"),
      store_backend: "sqlite" as const,
      store_location: STORE,
    },
  ]) {
    const result = registerProjectV1(first.registry, input);
    assert.deepEqual(result, { _tag: "Refused", reason: "binding_conflict" });
  }
});

test("resolve requires an exact common-directory and store binding", () => {
  const first = register(emptyProjectRegistryV1());
  assert.equal(first._tag, "Registered");
  if (first._tag !== "Registered") return;
  assert.equal(
    resolveProjectV1(first.registry, {
      git_common_dir: COMMON,
      store_location: STORE,
    })?.project_id,
    PROJECT_A,
  );
  assert.equal(
    resolveProjectV1(first.registry, {
      git_common_dir: join(ROOT, "wrong", ".git"),
      store_location: STORE,
    }),
    null,
  );
});

test("decoder rejects noncanonical, duplicate, unknown, invalid, and oversized input", () => {
  const valid = register(emptyProjectRegistryV1());
  assert.equal(valid._tag, "Registered");
  if (valid._tag !== "Registered") return;
  const text = new TextDecoder().decode(
    renderProjectRegistryFileV1(valid.registry),
  );
  const cases = [
    text.slice(0, -1),
    `${text}\n`,
    text.replace('"generation":1', '"generation":1,"generation":1'),
    text.replace('"generation":1', '"extra":true,"generation":1'),
    text.replace(PROJECT_A, "not-a-uuid"),
    text.replace(COMMON, "relative/.git"),
    "x".repeat(1_048_577),
  ];
  for (const value of cases) {
    assert.deepEqual(
      decodeProjectRegistryFileV1(new TextEncoder().encode(value)),
      { _tag: "Invalid" },
    );
  }
});

test("live registry publishes atomically and preserves conflict bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "foreman-project-registry-"));
  try {
    const home = join(root, "home");
    mkdirSync(home, { mode: 0o700 });
    const path = join(home, "projects.json");
    const first = registerProjectFileV1(path, {
      project_id: PROJECT_A,
      operation_id: OP_A,
      git_common_dir: COMMON,
      worktree_path: WT_A,
      store_backend: "sqlite",
      store_location: STORE,
    });
    assert.equal(first._tag, "Registered");
    const published = readFileSync(path);
    assert.equal(published.at(-1), 0x0a);

    const replay = registerProjectFileV1(path, {
      project_id: PROJECT_B,
      operation_id: OP_B,
      git_common_dir: COMMON,
      worktree_path: WT_A,
      store_backend: "sqlite",
      store_location: STORE,
    });
    assert.equal(replay._tag, "Registered");
    assert.deepEqual(readFileSync(path), published);

    const conflict = registerProjectFileV1(path, {
      project_id: PROJECT_B,
      operation_id: OP_B,
      git_common_dir: COMMON,
      worktree_path: join(ROOT, "other"),
      store_backend: "sqlite",
      store_location: join(ROOT, "other", "session.db"),
    });
    assert.deepEqual(conflict, {
      _tag: "Refused",
      reason: "binding_conflict",
    });
    assert.deepEqual(readFileSync(path), published);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("live registry rejects linked and oversized registry files", () => {
  const root = mkdtempSync(join(tmpdir(), "foreman-project-registry-hostile-"));
  try {
    const input = {
      project_id: PROJECT_A,
      operation_id: OP_A,
      git_common_dir: COMMON,
      worktree_path: WT_A,
      store_backend: "sqlite" as const,
      store_location: STORE,
    };
    const target = join(root, "target.json");
    const linked = join(root, "linked.json");
    writeFileSync(target, "target\n");
    symlinkSync(target, linked);
    assert.deepEqual(registerProjectFileV1(linked, input), {
      _tag: "Refused",
      reason: "unsafe_path",
    });
    assert.equal(readFileSync(target, "utf8"), "target\n");

    const oversized = join(root, "oversized.json");
    writeFileSync(oversized, "x".repeat(1_048_577));
    assert.deepEqual(registerProjectFileV1(oversized, input), {
      _tag: "Refused",
      reason: "invalid_registry",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
