import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, cp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const entry = resolve("packages/orchestration/dist-test/pel-cli-fixture.js");
const assetSource = resolve("packages/orchestration/dist-test/assets");
const template = resolve(
  "packages/providers/src/fixtures/qualification/fixture-manifest.json",
);
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const isolationImport =
  "data:text/javascript," +
  encodeURIComponent(
    `import childProcess from 'node:child_process';import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';const denied=()=>{throw new Error('Unexpected live provider access in fixture test')};globalThis.fetch=denied;childProcess.spawn=denied;childProcess.execFile=denied;http.request=denied;https.request=denied;http.get=denied;https.get=denied;syncBuiltinESMExports();`,
  );
async function fixture(scenario = "completed") {
  const directory = await mkdtemp(join(tmpdir(), "fm-provider-qualify-"));
  const assetRoot = join(directory, "assets");
  await cp(assetSource, assetRoot, { recursive: true });
  const manifest = JSON.parse(await readFile(template, "utf8"));
  manifest.assetRoot = assetRoot;
  manifest.assetManifestSha256 = sha(
    await readFile(join(assetRoot, "manifest.json")),
  );
  for (const cell of manifest.fixtures.providers.cells)
    cell.scenario = scenario;
  const manifestPath = join(directory, "fixture.json"),
    limitsPath = join(directory, "limits.json"),
    bindingPath = join(directory, "binding.json");
  const manifestText = JSON.stringify(manifest);
  await writeFile(manifestPath, manifestText);
  const limits = {
    deadline: manifest.fixtures.providers.now + 600000,
    maxInputTokens: 60000,
    maxOutputTokens: 60000,
    maxToolCalls: 10,
    maxCostUsd: 20,
    maxOutputBytes: 2000000,
    spendReservationRef: "fixture:reservation",
  };
  const binding = {
    kind: "qualification-fixture",
    evidenceRef: "fixture:qualification-result",
    expiresAt: manifest.fixtures.providers.now + 60000,
    requiredCapabilities: ["generation", "structuredOutput"],
    fixtureManifestHash: sha(manifestText),
    endpointIdentity: manifest.fixtures.providers.endpointIdentity,
  };
  await Promise.all([
    writeFile(limitsPath, JSON.stringify(limits)),
    writeFile(bindingPath, JSON.stringify(binding)),
  ]);
  const run = (
    profile = "gpt-6-astra",
    transport = "openai-responses",
    account = "fixture:account",
  ) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        isolationImport,
        entry,
        "--fixture-manifest",
        manifestPath,
        "providers",
        "qualify",
        "--profile",
        profile,
        "--transport",
        transport,
        "--credential-profile",
        account,
        "--limits",
        limitsPath,
        "--binding",
        bindingPath,
        "--json",
      ],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 15000,
        env: { PATH: process.env.PATH, HOME: join(directory, "no-live-home") },
      },
    );
  return {
    directory,
    assetRoot,
    manifest,
    manifestPath,
    limitsPath,
    bindingPath,
    binding,
    limits,
    run,
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}
test("T-M3-017 compiled fixture qualification uses actual bounded harness for all twelve exact cells", async () => {
  const f = await fixture();
  try {
    for (const cell of f.manifest.fixtures.providers.cells) {
      const run = f.run(cell.profileId, cell.transportId);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.equal(run.stderr, "");
      const report = JSON.parse(run.stdout);
      assert.equal(report.profileId, cell.profileId);
      assert.equal(report.transportId, cell.transportId);
      assert.equal(report.observedIdentity.profileId, cell.profileId);
      assert.equal(report.outcome, "success");
      assert.equal(report.evidence.length, 2);
      assert.ok(
        report.evidence.every(
          (e: { state: string; fixtureManifestHash: string }) =>
            e.state === "fixture-tested" &&
            e.fixtureManifestHash === f.binding.fixtureManifestHash,
        ),
      );
      assert.ok(
        report.assertions.every(
          (a: { evidenceType: string }) =>
            a.evidenceType === "contract-fixture",
        ),
      );
      assert.equal(
        report.bounds.maxInputTokens + report.bounds.maxOutputTokens,
        30000,
      );
      assert.equal(report.bounds.maxToolCalls, 2);
      assert.equal(report.bounds.maxCostUsd, 5);
      assert.equal(
        report.bounds.deadline,
        f.manifest.fixtures.providers.now + 180000,
      );
      assert.doesNotMatch(run.stdout, /live-qualified|live-observation/);
    }
  } finally {
    await f.dispose();
  }
});
test("T-M3-017 fixture outcomes preserve refusal, truncation, stream loss, authentication and cancellation", async () => {
  for (const [scenario, expectedCode, outcome] of [
    ["refused", 1, "failed"],
    ["truncated", 3, "needs-action"],
    ["disconnected", 3, "needs-action"],
    ["authentication-required", 3, "needs-action"],
    ["model-mismatch", 1, "failed"],
    ["cancelled", 4, "cancelled"],
  ] as const) {
    const f = await fixture(scenario);
    try {
      const run = f.run();
      assert.equal(run.status, expectedCode, run.stdout + run.stderr);
      const report = JSON.parse(run.stdout);
      assert.equal(report.outcome, outcome);
      assert.equal(report.evidence.length, 0);
      assert.equal(run.stderr, "");
    } finally {
      await f.dispose();
    }
  }
});
test("T-M3-018 fixture qualification rejects forged binding, product evidence, unbound account and asset tamper", async () => {
  const f = await fixture();
  try {
    for (const binding of [
      { ...f.binding, fixtureManifestHash: "0".repeat(64) },
      { ...f.binding, endpointIdentity: "fake://other" },
      {
        kind: "qualification",
        evidenceRef: "should-not-be-live",
        expiresAt: f.binding.expiresAt,
        requiredCapabilities: ["generation"],
      },
      { ...f.binding, expiresAt: 0 },
    ]) {
      await writeFile(f.bindingPath, JSON.stringify(binding));
      const run = f.run();
      assert.equal(run.status, 2, run.stdout + run.stderr);
      assert.doesNotMatch(run.stdout, /live-qualified/);
    }
    await writeFile(f.bindingPath, JSON.stringify(f.binding));
    assert.equal(
      f.run("gpt-6-astra", "openai-responses", "unbound-live-account").status,
      2,
    );
    await writeFile(
      join(f.assetRoot, "runtime/assets/pel/default-authoring-snapshot.json"),
      "{}",
    );
    const corrupt = f.run();
    assert.equal(corrupt.status, 2);
    assert.equal(JSON.parse(corrupt.stdout).code, "PEL_SCHEMA");
  } finally {
    await f.dispose();
  }
});
test("T-M3-018 product router rejects a fixture qualification binding without a fixture service", async () => {
  const { build } = await import("esbuild");
  const f = await fixture();
  try {
    const product = join(f.directory, "foreman.js");
    await Promise.all([
      writeFile(
        f.limitsPath,
        JSON.stringify({ ...f.limits, deadline: Date.now() + 60000 }),
      ),
      writeFile(
        f.bindingPath,
        JSON.stringify({ ...f.binding, expiresAt: Date.now() + 60000 }),
      ),
    ]);
    await build({
      entryPoints: [
        resolve("packages/orchestration/src/pel-authoring-main.ts"),
      ],
      outfile: product,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      logLevel: "silent",
    });
    const run = spawnSync(
      process.execPath,
      [
        product,
        "providers",
        "qualify",
        "--profile",
        "gpt-6-astra",
        "--transport",
        "openai-responses",
        "--credential-profile",
        "fixture:account",
        "--limits",
        f.limitsPath,
        "--binding",
        f.bindingPath,
        "--json",
      ],
      {
        cwd: f.directory,
        encoding: "utf8",
        timeout: 15000,
        env: {
          PATH: process.env.PATH,
          HOME: join(f.directory, "no-live-home"),
        },
      },
    );
    assert.equal(run.status, 2, run.stdout + run.stderr);
    assert.match(JSON.parse(run.stdout).message, /binding is unavailable/);
    assert.doesNotMatch(run.stdout, /live-qualified/);
  } finally {
    await f.dispose();
  }
});
