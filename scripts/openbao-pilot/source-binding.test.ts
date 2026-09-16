import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { hash, sourceFiles } from "./provenance.js";

test("disposable stale providers dist cannot enter the compiled pilot and negative control detects it", { timeout: 30000 }, async () => {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const fixture = await mkdtemp(join(tmpdir(), "foreman-stale-dist-"));
  try {
    for (const path of [...sourceFiles, "package.json", "package-lock.json", "packages/providers/package.json", "packages/core/package.json"]) {
      await mkdir(dirname(join(fixture, path)), { recursive: true });
      await cp(join(sourceRoot, path), join(fixture, path));
    }
    await cp(join(sourceRoot, "packages/core/src"), join(fixture, "packages/core/src"), { recursive: true });
    await mkdir(join(fixture, "node_modules/@foreman"), { recursive: true });
    for (const name of await readdir(join(sourceRoot, "node_modules"))) {
      if (name !== "@foreman") await symlink(join(sourceRoot, "node_modules", name), join(fixture, "node_modules", name));
    }
    for (const name of ["core", "providers"]) await symlink(join(fixture, "packages", name), join(fixture, "node_modules/@foreman", name));
    await mkdir(join(fixture, "packages/providers/dist"), { recursive: true });
    const poison = 'throw new Error("STALE_PROVIDER_DIST_CONTROL"); export function makeSyntheticOpenBaoCredentialStore() {}';
    await writeFile(join(fixture, "packages/providers/dist/providers.js"), poison);
    // This known-bad build follows the historical package import into the stale dist.
    const bad = await build({ stdin: { contents: 'import { makeSyntheticOpenBaoCredentialStore } from "@foreman/providers"; export { makeSyntheticOpenBaoCredentialStore };', resolveDir: fixture }, bundle: true, platform: "node", format: "esm", write: false });
    const badPath = join(fixture, "known-bad.mjs");
    await writeFile(badPath, bad.outputFiles[0]!.text);
    await assert.rejects(import(pathToFileURL(badPath).href), /STALE_PROVIDER_DIST_CONTROL/);
    const gitDirectory = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: sourceRoot, encoding: "utf8" }).trim();
    execFileSync(process.execPath, ["--import", pathToFileURL(join(sourceRoot, "node_modules/tsx/dist/loader.mjs")).href, join(fixture, "scripts/build-openbao-pilot.ts"), join(fixture, "bundle")], { cwd: tmpdir(), env: { ...process.env, GIT_DIR: gitDirectory, GIT_WORK_TREE: fixture }, timeout: 20000, stdio: "pipe" });
    const entry = await import(pathToFileURL(join(fixture, "bundle/openbao-pilot.mjs")).href);
    const evidence = await entry.getPilotImplementationEvidence();
    const storePath = "packages/providers/src/openbao-credential-store.ts";
    assert.equal(evidence.bundleInputHashes[storePath], hash(await readFile(join(fixture, storePath))));
    const transportPath = "packages/providers/src/openbao-http.ts";
    const transportHash = hash(await readFile(join(fixture, transportPath)));
    assert.equal(evidence.implementationHashes[transportPath], transportHash);
    assert.equal(evidence.bundleInputHashes[transportPath], transportHash);
    assert.ok(evidence.bundleInputs.includes(transportPath));
    assert.equal(Object.keys(evidence.bundleInputHashes).some(path => /^packages\/[^/]+\/dist\//.test(path)), false);
    assert.equal(evidence.executableSha256, hash(await readFile(join(fixture, "bundle/openbao-pilot.mjs"))));
    // A caller's later source edit must not masquerade as the bundled implementation.
    await writeFile(join(fixture, storePath), "// unrelated source after the build\n");
    const after = await entry.getPilotImplementationEvidence();
    assert.equal(after.bundleInputHashes[storePath], evidence.bundleInputHashes[storePath]);
    assert.notEqual(after.bundleInputHashes[storePath], hash(await readFile(join(fixture, storePath))));
    await writeFile(join(fixture, transportPath), "// changed transport after build\n");
    const afterTransportChange = await entry.getPilotImplementationEvidence();
    assert.equal(afterTransportChange.bundleInputHashes[transportPath], transportHash);
    assert.notEqual(afterTransportChange.bundleInputHashes[transportPath],
      hash(await readFile(join(fixture, transportPath))));
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
