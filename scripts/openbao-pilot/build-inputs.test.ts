import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { hash } from "./provenance.js";

test("manifest equals actual esbuild input set and captures mts and cts bytes", async () => {
  const module = await import("./build-inputs.js").catch(() => undefined);
  assert.ok(module, "build input validation must exist");
  const root = await mkdtemp(join(tmpdir(), "foreman-build-inputs-"));
  try {
    await writeFile(join(root, "entry.mts"), 'import { value } from "./value.cts"; console.log(value);');
    await writeFile(join(root, "value.cts"), "export const value: number = 42;");
    const hashes: Record<string, string> = {};
    const result = await build({ absWorkingDir: root, entryPoints: ["entry.mts"], bundle: true, platform: "node", write: false, metafile: true, plugins: [module.captureBuildInputs(root, hashes)] });
    assert.deepEqual(module.verifyBuildInputs(root, result.metafile, hashes), ["entry.mts", "value.cts"]);
    for (const path of Object.keys(result.metafile.inputs)) assert.equal(hashes[path], hash(await readFile(join(root, path))));
    const missing = { ...hashes }; delete missing["value.cts"];
    assert.throws(() => module.verifyBuildInputs(root, result.metafile, missing), /manifest/);
    assert.throws(() => module.verifyBuildInputs(root, result.metafile, { ...hashes, "unexpected.ts": "a".repeat(64) }), /manifest/);
    assert.throws(() => module.verifyBuildInputs(root, result.metafile, { ...hashes, "value.cts": "invalid" }), /manifest/);
    const forbidden = "packages/providers/dist/opaque.wasm";
    assert.throws(() => module.verifyBuildInputs(root, { inputs: { [forbidden]: { bytes: 1, imports: [] } }, outputs: {} }, { [forbidden]: "a".repeat(64) }), /dist/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("build refuses workspace dist independently of extension and unknown loaders", async () => {
  const module = await import("./build-inputs.js").catch(() => undefined);
  assert.ok(module, "capture must guard every loader");
  const root = await mkdtemp(join(tmpdir(), "foreman-build-refusal-"));
  try {
    await mkdir(join(root, "packages/providers/dist"), { recursive: true });
    for (const path of ["packages/providers/dist/hidden.mts", "packages/providers/dist/hidden.wasm", "opaque.node", "opaque.wasm"]) {
      await writeFile(join(root, path), "export const value = 1;");
      await assert.rejects(build({ absWorkingDir: root, entryPoints: [path], bundle: true, write: false, metafile: true, logLevel: "silent", plugins: [module.captureBuildInputs(root, {})] }), path.startsWith("packages") ? /dist/ : /Unsupported pilot input extension/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
