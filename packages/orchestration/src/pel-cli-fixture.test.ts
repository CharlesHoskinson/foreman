import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  writeFile,
  readFile,
  cp,
  rm,
  symlink,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDefaultAuthoringSnapshotV1 } from "./pel-host-descriptors.js";
const entry = resolve("packages/orchestration/dist-test/pel-cli-fixture.js");
const assetSource = resolve("packages/orchestration/dist-test/assets");
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function fixtureManifest(dir: string, responses: readonly string[] = []) {
  const assetRoot = join(dir, "assets");
  await cp(assetSource, assetRoot, { recursive: true });
  const manifest = join(dir, "fixture-manifest.json");
  const value = {
    schemaVersion: 1,
    fixtures: { responses },
    assetRoot,
    assetManifestSha256: digest(
      await readFile(join(assetRoot, "manifest.json")),
    ),
  };
  await writeFile(manifest, JSON.stringify(value));
  return {
    manifest,
    assetRoot,
    value,
    context: join(
      assetRoot,
      "runtime/assets/pel/default-authoring-snapshot.json",
    ),
  };
}
test("compiled fixture entry checks source and emits one preview", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pel-fixture-"));
  try {
    const source = join(dir, "source.pel");
    const { context, manifest } = await fixtureManifest(dir);
    await writeFile(source, "(+ 1 2)");
    const run = spawnSync(
      process.execPath,
      [
        entry,
        "--fixture-manifest",
        manifest,
        "plan",
        source,
        "--context",
        context,
        "--json",
      ],
      { encoding: "utf8", cwd: dir },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout).finalValueSummary, {
      kind: "known",
      value: { tag: "number", value: 3 },
    });
    assert.equal(run.stderr, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("fixture main import performs no invocation", () => {
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import './packages/orchestration/src/pel-cli-fixture-main.ts'`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
  assert.equal(run.stderr, "");
});

test("compiled production resolves its installed asset and rejects fixture manifest", async () => {
  const { build } = await import("esbuild");
  const { mkdir } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "pel-production-"));
  try {
    const runtime = join(dir, "runtime");
    const bundle = join(runtime, "dist", "foreman.js");
    const assetDir = join(runtime, "assets", "pel");
    const elsewhere = join(dir, "elsewhere");
    await mkdir(assetDir, { recursive: true });
    await mkdir(elsewhere);
    await writeFile(
      join(assetDir, "default-authoring-snapshot.json"),
      JSON.stringify(createDefaultAuthoringSnapshotV1()),
    );
    await build({
      entryPoints: [
        resolve("packages/orchestration/src/pel-authoring-main.ts"),
      ],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      logLevel: "silent",
    });
    const source = join(elsewhere, "source.pel");
    await writeFile(source, "(+ 1 2)");
    const good = spawnSync(
      process.execPath,
      [bundle, "check", source, "--json"],
      { encoding: "utf8", cwd: elsewhere },
    );
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).tag, "ok");
    assert.equal(good.stderr, "");
    const rejected = spawnSync(
      process.execPath,
      [bundle, "--fixture-manifest", "anything", "check", source, "--json"],
      { encoding: "utf8", cwd: elsewhere },
    );
    assert.equal(rejected.status, 2);
    assert.equal(JSON.parse(rejected.stdout).code, "PEL_CLI_USAGE");
    assert.equal(rejected.stderr, "");
    await rm(join(assetDir, "default-authoring-snapshot.json"));
    const absent = spawnSync(
      process.execPath,
      [bundle, "check", source, "--json"],
      { encoding: "utf8", cwd: elsewhere },
    );
    assert.equal(absent.status, 2);
    assert.match(
      JSON.parse(absent.stdout).input,
      /runtime\/assets\/pel\/default-authoring-snapshot.json$/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compiled fixture generation returns exact source and performs bounded local repair", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pel-generation-cli-"));
  try {
    const { context, manifest } = await fixtureManifest(dir, ["(", "(+ 1 2)"]);
    const args = [
      entry,
      "--fixture-manifest",
      manifest,
      "plan",
      "--prompt",
      "Produce arithmetic",
      "--model",
      "gpt-6-astra",
      "--transport",
      "openai-responses",
      "--context",
      context,
    ];
    const plain = spawnSync(process.execPath, args, {
      encoding: "utf8",
      cwd: dir,
    });
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stdout, "(+ 1 2)");
    assert.deepEqual(JSON.parse(plain.stderr).preview.finalValueSummary, {
      kind: "known",
      value: { tag: "number", value: 3 },
    });
    const json = spawnSync(process.execPath, [...args, "--json"], {
      encoding: "utf8",
      cwd: dir,
    });
    assert.equal(json.status, 0, json.stderr);
    const value = JSON.parse(json.stdout);
    assert.equal(value.attemptCount, 2);
    assert.equal(value.pelSource, "(+ 1 2)");
    assert.equal(json.stderr, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fixture manifest requires asset root, asset digest and bounded fixture records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pel-manifest-required-"));
  try {
    const fixture = await fixtureManifest(dir);
    for (const key of ["assetRoot", "assetManifestSha256", "fixtures"]) {
      const value: Record<string, unknown> = { ...fixture.value };
      delete value[key];
      await writeFile(fixture.manifest, JSON.stringify(value));
      const result = spawnSync(
        process.execPath,
        [
          entry,
          "--fixture-manifest",
          fixture.manifest,
          "plan",
          "--prompt",
          "One",
          "--model",
          "gpt-6-astra",
          "--transport",
          "openai-responses",
          "--json",
        ],
        { encoding: "utf8", cwd: dir },
      );
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.equal(JSON.parse(result.stdout).code, "PEL_SCHEMA");
      assert.equal(result.stderr, "");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fixture assets reject tampered content or manifest hashes before generation", async () => {
  for (const tamper of [
    "manifest-hash",
    "asset-bytes",
    "missing-root",
  ] as const) {
    const dir = await mkdtemp(join(tmpdir(), "pel-manifest-tamper-"));
    try {
      const fixture = await fixtureManifest(dir, ["1"]);
      if (tamper === "manifest-hash")
        await writeFile(
          fixture.manifest,
          JSON.stringify({
            ...fixture.value,
            assetManifestSha256: "0".repeat(64),
          }),
        );
      if (tamper === "asset-bytes") await writeFile(fixture.context, "{}");
      if (tamper === "missing-root")
        await rm(fixture.assetRoot, { recursive: true });
      const result = spawnSync(
        process.execPath,
        [
          entry,
          "--fixture-manifest",
          fixture.manifest,
          "plan",
          "--prompt",
          "One",
          "--model",
          "gpt-6-astra",
          "--transport",
          "openai-responses",
          "--json",
        ],
        { encoding: "utf8", cwd: dir },
      );
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.equal(result.stderr, "");
      assert.ok(
        ["PEL_SCHEMA", "PEL_INPUT"].includes(JSON.parse(result.stdout).code),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("fixture assets reject traversal, symlinks and context paths outside the bound root", async () => {
  for (const escape of ["record", "symlink", "context", "example"] as const) {
    const dir = await mkdtemp(join(tmpdir(), "pel-manifest-escape-"));
    try {
      const fixture = await fixtureManifest(dir);
      const outside = join(dir, "outside.json");
      await cp(fixture.context, outside);
      if (escape === "record") {
        const path = join(fixture.assetRoot, "manifest.json");
        const assets = JSON.parse(await readFile(path, "utf8"));
        assets.files[0].relativePath = "../outside.json";
        const text = JSON.stringify(assets);
        await writeFile(path, text);
        await writeFile(
          fixture.manifest,
          JSON.stringify({
            ...fixture.value,
            assetManifestSha256: digest(Buffer.from(text)),
          }),
        );
      }
      if (escape === "symlink") {
        await rm(fixture.context);
        await symlink(outside, fixture.context);
      }
      const args = [
        entry,
        "--fixture-manifest",
        fixture.manifest,
        "check",
        escape === "example"
          ? "examples/pel/../../../outside.json"
          : "examples/pel/repair.pel",
        "--json",
        ...(escape === "context" ? ["--context", outside] : []),
      ];
      const result = spawnSync(process.execPath, args, {
        encoding: "utf8",
        cwd: dir,
      });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.ok(
        ["PEL_SCHEMA", "PEL_INPUT"].includes(JSON.parse(result.stdout).code),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("fixture resolves bound examples and default snapshot independently of cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pel-manifest-default-"));
  try {
    const fixture = await fixtureManifest(dir);
    const result = spawnSync(
      process.execPath,
      [
        entry,
        "--fixture-manifest",
        fixture.manifest,
        "plan",
        "examples/pel/repair.pel",
        "--json",
      ],
      { encoding: "utf8", cwd: dir },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    assert.ok(JSON.parse(result.stdout).effects.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
