import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, chmod, mkdtemp, readFile, rm, symlink, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Fiber } from "effect";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { request } from "./openbao-pilot/lifecycle.js";
import * as lifecycle from "./openbao-pilot/lifecycle.js";
import * as pilot from "./openbao-pilot.js";
const binary = process.env.OPENBAO_PILOT_BINARY;
const binarySha256 = process.env.OPENBAO_PILOT_SHA256;
const receiptSha256 = process.env.OPENBAO_PILOT_RECEIPT_SHA256;
const integration = binary && binarySha256 && receiptSha256 ? {} : { skip: "Set OPENBAO_PILOT_BINARY, OPENBAO_PILOT_SHA256, and OPENBAO_PILOT_RECEIPT_SHA256 to run verified real-binary cases" };
const failure = (exit: any) => exit._tag === "Failure" && exit.cause._tag === "Fail" ? exit.cause.error.code : undefined;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "foreman-pilot-test-"));
  const binary = join(root, "bao"); const marker = join(root, "launched");
  await writeFile(binary, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'launched'); setInterval(() => {}, 1000);\n`, { mode: 0o700 });
  const binarySha256 = createHash("sha256").update(await readFile(binary)).digest("hex");
  const provenance = { schemaVersion: 1, binary, binarySha256, signatureVerified: true, release: "v2.6.2", releaseUrl: "https://github.com/openbao/openbao/releases/tag/v2.6.2", assetUrl: "https://github.com/openbao/openbao/releases/download/v2.6.2/openbao_2.6.2_linux_amd64.tar.gz", archiveSha256: "a".repeat(64), publicKeyUrl: "https://openbao.org/assets/openbao-gpg-pub-20240618.asc", primaryKeyFingerprint: "66D15FDD87287219C8E15478D200CD702853E6D0", signingSubkeyFingerprint: "E617DCD4065C2AFC0B2CF7A7BA8BC08C0F691F94", integrityEvidence: "synthetic fixture", signatureEvidence: "synthetic fixture", trustBoundary: "synthetic fixture" };
  const receipt = JSON.stringify(provenance);
  await writeFile(join(root, "provenance.json"), receipt);
  return { root, marker, input: { binary, binarySha256, receiptSha256: createHash("sha256").update(receipt).digest("hex"), outputDirectory: join(root, "output") }, provenance };
}
test("changed receipt bytes are refused before launch despite unchanged binary and receipt fields", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "provenance.json"), `${JSON.stringify(f.provenance)}\n`);
    assert.equal(failure(await Effect.runPromiseExit(pilot.runOpenBaoPilot(f.input))), "InvalidProvenance");
    await assert.rejects(access(f.marker));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
for (const field of ["releaseUrl", "assetUrl", "archiveSha256", "primaryKeyFingerprint", "signingSubkeyFingerprint", "publicKeyUrl"] as const) test(`incorrect receipt ${field} is refused even with its explicit digest`, async () => {
  const f = await fixture();
  try {
    const receipt = JSON.stringify({ ...f.provenance, [field]: "incorrect" });
    await writeFile(join(f.root, "provenance.json"), receipt);
    assert.equal(failure(await Effect.runPromiseExit(pilot.runOpenBaoPilot({ ...f.input, receiptSha256: createHash("sha256").update(receipt).digest("hex") }))), "InvalidProvenance");
    await assert.rejects(access(f.marker));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("digest mismatch is independently refused before execution with otherwise valid provenance", async () => {
  const f = await fixture();
  try {
    const bad = "0".repeat(64);
    const receipt = JSON.stringify({ ...f.provenance, binarySha256: bad });
    await writeFile(join(f.root, "provenance.json"), receipt);
    assert.equal(failure(await Effect.runPromiseExit(pilot.runOpenBaoPilot({ ...f.input, binarySha256: bad, receiptSha256: createHash("sha256").update(receipt).digest("hex") }))), "InvalidProvenance");
    await assert.rejects(access(f.marker));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("changed binary bytes are refused with unchanged trusted receipt and pins", async () => {
  const f = await fixture();
  try {
    await writeFile(f.input.binary, `${await readFile(f.input.binary, "utf8")}\n`);
    assert.equal(failure(await Effect.runPromiseExit(pilot.runOpenBaoPilot(f.input))), "InvalidProvenance");
    await assert.rejects(access(f.marker));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("absent provenance is refused before execution", async () => {
  const f = await fixture();
  try { await rm(join(f.root, "provenance.json")); assert.equal(failure(await Effect.runPromiseExit(pilot.runOpenBaoPilot(f.input))), "InvalidProvenance"); await assert.rejects(access(f.marker)); }
  finally { await rm(f.root, { recursive: true, force: true }); }
});
test("signal exit before shutdown is confirmed without hanging", { timeout: 5000 }, async () => {
  assert.equal(typeof (pilot as any).observeChild, "function");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const owned = (pilot as any).observeChild(child);
  await once(child, "spawn"); child.kill("SIGTERM"); await owned.exited; await owned.stop();
  assert.equal(child.signalCode, "SIGTERM");
});
test("executable permission precheck is sanitized before spawn", { timeout: 5000 }, async () => {
  const f = await fixture();
  try { await chmod(f.input.binary, 0o600); assert.equal(failure(await Effect.runPromiseExit(pilot.runOpenBaoPilot(f.input))), "SpawnFailed"); }
  finally { await rm(f.root, { recursive: true, force: true }); }
});
test("missing interpreter causes a real controller spawn failure and removes owned runtime", { timeout: 5000 }, async () => {
  const f = await fixture(); let runtime = ""; let launched = false;
  try {
    const bytes = `#!${join(f.root, "missing-interpreter")}\n`;
    await writeFile(f.input.binary, bytes);
    const binarySha256 = createHash("sha256").update(bytes).digest("hex");
    const receipt = JSON.stringify({ ...f.provenance, binarySha256 });
    await writeFile(join(f.root, "provenance.json"), receipt);
    const exit = await Effect.runPromiseExit(pilot.runOpenBaoPilotWithOptions({ ...f.input, binarySha256, receiptSha256: createHash("sha256").update(receipt).digest("hex") }, { onPhase: event => Effect.sync(() => { runtime = event.runtime; if (event.phase === "launched") { launched = true; assert.equal(event.pid, undefined); } }) }));
    assert.equal(launched, true);
    assert.equal(failure(exit), "SpawnFailed");
    await assert.rejects(access(runtime));
    await assert.rejects(access(join(f.input.outputDirectory, "openbao-pilot-report.json")));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("controller preserves snapshot I/O failure and removes its owned runtime", { timeout: 5000 }, async () => {
  const f = await fixture(); let runtime = "";
  try {
    const exit = await Effect.runPromiseExit(pilot.runOpenBaoPilotWithOptions(f.input, { onPhase: event => Effect.promise(async () => { runtime = event.runtime; if (event.phase === "acquired") await writeFile(join(runtime, "verified-bao"), "collision-canary"); }) }));
    assert.equal(failure(exit), "SnapshotIOFailed");
    await assert.rejects(access(runtime));
    await assert.rejects(access(f.marker));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
for (const phase of ["acquired", "launched"] as const) test(`cancellation at ${phase} awaits cleanup and stops host work`, { timeout: 5000 }, async () => {
  const f = await fixture(); let runtime = ""; let pid: number | undefined;
  let reached!: () => void; const observed = new Promise<void>(r => { reached = r; });
  const options = { onPhase: (event: any) => { runtime = event.runtime; if (event.phase === phase) { pid = event.pid; reached(); return Effect.never; } return Effect.void; } };
  try {
    assert.equal(typeof (pilot as any).runOpenBaoPilotWithOptions, "function");
    const fiber = Effect.runFork((pilot as any).runOpenBaoPilotWithOptions(f.input, options));
    await observed; await Effect.runPromise(Fiber.interrupt(fiber)); await assert.rejects(access(runtime));
    if (phase === "acquired") await assert.rejects(access(f.marker));
    if (pid) assert.throws(() => process.kill(pid!, 0));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
for (const phase of ["acquired", "launched"] as const) test(`overall timeout at ${phase} is terminal and waits for cleanup`, { timeout: 5000 }, async () => {
  const f = await fixture(); let runtime = "";
  try {
    assert.equal(typeof (pilot as any).runOpenBaoPilotWithOptions, "function");
    const exit = await Effect.runPromiseExit((pilot as any).runOpenBaoPilotWithOptions(f.input, { timeoutMs: 100, onPhase: (event: any) => { runtime = event.runtime; return event.phase === phase ? Effect.never : Effect.void; } }));
    assert.equal(failure(exit), "OverallTimeout"); await assert.rejects(access(runtime)); if (phase === "acquired") await assert.rejects(access(f.marker));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("compiled provenance reports build and runtime identities from an unrelated cwd", { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "foreman-pilot-bundle-"));
  try {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/build-openbao-pilot.ts", root], { stdio: "ignore" });
    const [code] = await once(child, "exit"); assert.equal(code, 0);
    const bundlePath = join(root, "openbao-pilot.mjs");
    const bundle = await import(pathToFileURL(bundlePath).href);
    assert.equal(typeof bundle.getPilotImplementationEvidence, "function");
    const expected = createHash("sha256").update(await readFile(new URL("./openbao-pilot.ts", import.meta.url))).digest("hex");
    const cwd = process.cwd();
    try {
      process.chdir(root);
      const evidence = await bundle.getPilotImplementationEvidence();
      assert.equal(evidence.evidenceMode, "compiled");
      assert.equal(evidence.implementationHashes["scripts/openbao-pilot.ts"], expected);
      assert.equal(evidence.executableSha256, createHash("sha256").update(await readFile(bundlePath)).digest("hex"));
      assert.ok(Object.keys(evidence.bundleInputHashes).some(path => path.startsWith("node_modules/effect/")));
      assert.deepEqual(evidence.bundleInputs, Object.keys(evidence.bundleInputHashes).sort());
      for (const path of evidence.bundleInputs) assert.equal(evidence.bundleInputHashes[path], createHash("sha256").update(await readFile(join(cwd, path))).digest("hex"), path);
      assert.equal(evidence.buildEnvironment.nodeSha256, createHash("sha256").update(await readFile(process.execPath)).digest("hex"));
      assert.deepEqual(evidence.runtimeEnvironment, { nodeVersion: process.version, nodeSha256: createHash("sha256").update(await readFile(process.execPath)).digest("hex") });
      assert.equal(typeof evidence.sourceDirty, "boolean");
      assert.equal(evidence.bundleInputHashes["packages/providers/src/openbao-credential-store.ts"], createHash("sha256").update(await readFile(new URL("../packages/providers/src/openbao-credential-store.ts", import.meta.url))).digest("hex"));
      assert.equal(Object.keys(evidence.bundleInputHashes).some(path => /^packages\/[^/]+\/dist\//.test(path)), false);
      const differentBuild = join(root, "different-build-node.mjs");
      const original = await readFile(bundlePath, "utf8");
      const modified = original.replace(`"nodeVersion":"${process.version}"`, '"nodeVersion":"v24.synthetic-build-control"');
      assert.notEqual(modified, original);
      await writeFile(differentBuild, modified);
      const control = await import(pathToFileURL(differentBuild).href);
      const controlled = await control.getPilotImplementationEvidence();
      assert.equal(controlled.buildEnvironment.nodeVersion, "v24.synthetic-build-control");
      assert.deepEqual(controlled.runtimeEnvironment, evidence.runtimeEnvironment);
      assert.equal(controlled.executableSha256, createHash("sha256").update(modified).digest("hex"));
    } finally { process.chdir(cwd); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("unsafe output symlink is refused without modifying its target", async () => {
  const f = await fixture();
  try {
    const before = (await stat(f.root)).mode;
    await symlink(f.root, f.input.outputDirectory);
    assert.equal(failure(await Effect.runPromiseExit(pilot.runOpenBaoPilot(f.input))), "UnsafeOutput");
    assert.equal((await stat(f.root)).mode, before); await assert.rejects(access(f.marker));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("administrative response body is bounded and cancellation closes a pending request", { timeout: 5000 }, async () => {
  let connected!: () => void; const connection = new Promise<void>(r => { connected = r; });
  let closed!: () => void; const closure = new Promise<void>(r => { closed = r; });
  const server = createServer((req, res) => { if (req.url === "/large") res.end("x".repeat(65537)); else { req.once("close", closed); connected(); } });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal(typeof (lifecycle as any).confirmListenerClosed, "function");
    assert.equal(await (lifecycle as any).confirmListenerClosed(address.port, new AbortController().signal), false);
    await assert.rejects(request(origin, new AbortController().signal, "canary", "/large"), (e: any) => e.code === "ResponseTooLarge");
    const controller = new AbortController(); const result = request(origin, controller.signal, "canary", "/pending");
    const rejection = assert.rejects(result); await connection; controller.abort(); await rejection; await closure;
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
test("executes real subset with confirmed cleanup", { ...integration, timeout: 30000 }, async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "foreman-pilot-report-"));
  try {
    const report = await Effect.runPromise(pilot.runOpenBaoPilot({ binary: binary!, binarySha256: binarySha256!, receiptSha256: receiptSha256!, outputDirectory }));
    for (const id of ["P01", "P02", "P03", "P05", "P06", "P10"]) assert.equal(report.outcomes.find(x => x.id === id)?.status, "passed", id);
    for (const id of ["P04", "P07", "P08", "P09", "P11"]) assert.equal(report.outcomes.find(x => x.id === id)?.status, "not-run", id);
    assert.equal(report.pilotComplete, false);
    assert.deepEqual(report.outcomes.find(x => x.id === "P10")?.assertions, ["duplicate-import-conflict", "existing-version-and-bytes-unchanged", "deleted-read-not-found", "deleted-name-retained", "deleted-cas0-conflict", "recorded-generation-conditional-recovery-with-new-material"]);
    assert.deepEqual(report.processExit, { code: 0, signal: null, spawnFailed: false });
    assert.deepEqual(report.outcomes.find(x => x.id === "P05")?.assertions, ["server-sealed", "sealed-response-unavailable", "closed-endpoint-unavailable"]);
    assert.equal(report.binaryProvenance.verificationScope, "externally-verified-receipt-binding");
    assert.equal(report.binaryProvenance.receiptSha256, receiptSha256);
    assert.equal("signatureVerified" in report.binaryProvenance, false);
    assert.deepEqual(report.cleanup, { childExited: true, listenerClosed: true, temporaryDirectoryRemoved: true });
  } finally { await rm(outputDirectory, { recursive: true, force: true }); }
});
