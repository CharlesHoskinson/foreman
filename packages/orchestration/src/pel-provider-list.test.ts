import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, cp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const entry = resolve("packages/orchestration/dist-test/pel-cli-fixture.js");
const assets = resolve("packages/orchestration/dist-test/assets");
const template = resolve(
  "packages/providers/src/fixtures/qualification/fixture-manifest.json",
);
const isolationImport =
  "data:text/javascript," +
  encodeURIComponent(
    `import childProcess from 'node:child_process';import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';const denied=()=>{throw new Error('Unexpected live provider access in fixture test')};globalThis.fetch=denied;childProcess.spawn=denied;childProcess.execFile=denied;http.request=denied;https.request=denied;http.get=denied;https.get=denied;syncBuiltinESMExports();`,
  );
test("T-M3-018 compiled provider list keeps all exact API/native fixture cells visible without live qualification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fm-provider-list-"));
  try {
    const assetRoot = join(directory, "assets");
    await cp(assets, assetRoot, { recursive: true });
    const manifest = JSON.parse(await readFile(template, "utf8"));
    manifest.assetRoot = assetRoot;
    manifest.assetManifestSha256 = createHash("sha256")
      .update(await readFile(join(assetRoot, "manifest.json")))
      .digest("hex");
    const path = join(directory, "fixture.json");
    await writeFile(path, JSON.stringify(manifest));
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        isolationImport,
        entry,
        "--fixture-manifest",
        path,
        "providers",
        "list",
        "--json",
      ],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 15000,
        env: { PATH: process.env.PATH, HOME: join(directory, "no-live-home") },
      },
    );
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.equal(run.stderr, "");
    const output = JSON.parse(run.stdout);
    assert.equal(output.cells.length, 12);
    assert.equal(
      new Set(output.cells.map((c: { profileId: string }) => c.profileId)).size,
      6,
    );
    assert.ok(
      output.cells.every(
        (c: { status: string }) => c.status === "test-fixture",
      ),
    );
    assert.doesNotMatch(run.stdout, /live-qualified/);
    for (const cell of output.cells)
      if (
        cell.transportId.endsWith("responses") ||
        cell.transportId === "anthropic-messages" ||
        cell.transportId === "google-interactions"
      )
        assert.equal(
          cell.capabilities.find(
            (c: { capability: string }) => c.capability === "codingTask",
          ).state,
          "unsupported",
        );
    await writeFile(
      join(assetRoot, "runtime/assets/pel/default-authoring-snapshot.json"),
      "{}",
    );
    const tampered = spawnSync(
      process.execPath,
      [entry, "--fixture-manifest", path, "providers", "list", "--json"],
      { cwd: directory, encoding: "utf8", timeout: 15000 },
    );
    assert.equal(tampered.status, 2);
    assert.equal(JSON.parse(tampered.stdout).code, "PEL_SCHEMA");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("T-M3-018 provider fixture entry requires its manifest and rejects live endpoint identities", async () => {
  const missing = spawnSync(
    process.execPath,
    [entry, "providers", "list", "--json"],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(missing.status, 2);
  const directory = await mkdtemp(join(tmpdir(), "fm-provider-endpoint-"));
  try {
    const assetRoot = join(directory, "assets");
    await cp(assets, assetRoot, { recursive: true });
    const manifest = JSON.parse(await readFile(template, "utf8"));
    manifest.assetRoot = assetRoot;
    manifest.assetManifestSha256 = createHash("sha256")
      .update(await readFile(join(assetRoot, "manifest.json")))
      .digest("hex");
    manifest.fixtures.providers.endpointIdentity = "https://api.openai.com";
    const path = join(directory, "fixture.json");
    await writeFile(path, JSON.stringify(manifest));
    const run = spawnSync(
      process.execPath,
      [entry, "--fixture-manifest", path, "providers", "list", "--json"],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.equal(run.status, 2);
    assert.equal(JSON.parse(run.stdout).code, "PEL_SCHEMA");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
