import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { canonicalize } from "../packages/core/src/canonical-json.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export async function buildPelTestFixture(): Promise<void> {
  const outfile = join(
    root,
    "packages/orchestration/dist-test/pel-cli-fixture.js",
  );
  await mkdir(dirname(outfile), { recursive: true });
  const assetRoot = join(dirname(outfile), "assets");
  const assets = [
    ...['implement-verify-review', 'bounded-rework'].flatMap(name => [
      {source: `packages/orchestration/src/fixtures/pel-migration/${name}/contract-v1.json`, relativePath: `fixtures/pel-migration/${name}/contract-v1.json`},
      {source: `packages/orchestration/src/fixtures/pel-migration/${name}/registered-command-bindings.json`, relativePath: `runtime/assets/pel/migration/${name}/registered-command-bindings.json`},
    ]),
    ...['research-bundle.json', 'pel-paper.json', 'model-evidence.json', 'paper.md', 'models.md'].map(name => ({source: `packages/orchestration/src/fixtures/pel-research/${name}`, relativePath: `fixtures/pel-research/${name}`})),
    {source:'packages/orchestration/src/fixtures/pel-adoption/project-settings.json',relativePath:'fixtures/pel-adoption/project-settings.json'},
    {
      source:
        "skills/foreman/runtime/assets/pel/default-authoring-snapshot.json",
      relativePath: "runtime/assets/pel/default-authoring-snapshot.json",
    },
    ...[
      "implement-verify-review.pel",
      "conditional.pel",
      "parallel-read.pel",
      "repair.pel",
      "repair-and-publish.pel",
      "research-prepare.pel",
      "race-cancel.pel",
      "resume-checkpoint.pel",
      "profiles/gpt-6-astra.pel",
      "profiles/gpt-5.6-sol.pel",
      "profiles/claude-opus-5.pel",
      "profiles/claude-fable-5-1.pel",
      "profiles/grok-4.6.pel",
      "profiles/gemini-3.8-flash.pel",
    ].map((name) => ({
      source: `examples/pel/${name}`,
      relativePath: `examples/pel/${name}`,
    })),
  ];
  const records = [];
  for (const asset of assets) {
    const bytes = await readFile(join(root, asset.source));
    const path = join(assetRoot, asset.relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    records.push({
      relativePath: asset.relativePath,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  records.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "en"),
  );
  await writeFile(
    join(assetRoot, "manifest.json"),
    canonicalize({ schemaVersion: 1, files: records }) + "\n",
  );
  await build({
    entryPoints: [
      join(root, "packages/orchestration/test/pel-cli-fixture-entry.ts"),
    ],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    packages: "bundle",
    logLevel: "silent",
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await buildPelTestFixture();
