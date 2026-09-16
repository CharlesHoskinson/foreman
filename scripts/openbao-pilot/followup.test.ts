import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Duplex } from "node:stream";
import { build } from "esbuild";
import { Effect, Redacted } from "effect";
import * as lifecycle from "./lifecycle.js";
import * as binding from "./binary-receipt.js";
import { hash } from "./provenance.js";
import { deletionSemantics } from "./deletion-semantics.js";
import type { CredentialStoreService, StoredProviderCredential } from "../../packages/providers/src/credential-store.js";

test("deletion experiment registers actual old and new material for report leak refusal", { timeout: 5000 }, async () => {
  let version = 0; let deleted = false; let record: StoredProviderCredential | undefined;
  const written: string[] = []; const registered: string[] = [];
  const store: CredentialStoreService = {
    write: (_ref, material, expected) => Effect.suspend(() => {
      if (expected !== version) return Effect.fail({ _tag: "CredentialStoreFailure", code: "Conflict" });
      version++; deleted = false; written.push(Redacted.value(material).accessToken!);
      record = { provider: "claude", account: "deletion-experiment", version, material }; return Effect.succeed(version);
    }),
    read: () => Effect.suspend(() => deleted || !record ? Effect.fail({ _tag: "CredentialStoreFailure", code: "NotFound" }) : Effect.succeed(record)),
    list: () => Effect.succeed(["deletion-experiment"]),
    remove: () => Effect.sync(() => { deleted = true; }),
  };
  const labels = await Effect.runPromise(deletionSemantics(store, value => registered.push(value)));
  assert.deepEqual(registered, written); assert.equal(registered.length, 2);
  assert.ok(labels.includes("recorded-generation-conditional-recovery-with-new-material"));
  for (const canary of written) assert.throws(() => lifecycle.assertNoReportLeaks(JSON.stringify({ canary }), registered), (e: any) => e.code === "ReportLeak");
  lifecycle.assertNoReportLeaks(JSON.stringify(labels), registered);
});

test("administrative setup failures are sanitized and do not disclose header or body canaries", { timeout: 5000 }, async () => {
  const cycle: any = { canary: "body-canary" }; cycle.self = cycle;
  for (const [token, body] of [["token-canary\n", undefined], ["safe", cycle]] as const) {
    await assert.rejects(lifecycle.request("http://127.0.0.1:1", new AbortController().signal, token, "/", "POST", body), error => {
      assert.deepEqual(error, lifecycle.cleanFailure("InvalidInput"));
      assert.equal(String(error).includes("canary"), false); return true;
    });
  }
});

test("readiness rejects sealed and uninitialized states until healthy and bounds unhealthy peers", { timeout: 5000 }, async () => {
  assert.equal(typeof (lifecycle as any).waitReady, "function");
  const statuses = [501, 503, 200]; let calls = 0;
  const server = createServer((_q, r) => { r.writeHead(statuses[Math.min(calls++, statuses.length - 1)]!); r.end(); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    await (lifecycle as any).waitReady(`http://127.0.0.1:${address.port}`, { result: undefined }, new AbortController().signal, 1000);
    assert.equal(calls, 3);
    statuses.splice(0, 3, 503); calls = 0;
    const start = Date.now();
    await assert.rejects((lifecycle as any).waitReady(`http://127.0.0.1:${address.port}`, { result: undefined }, new AbortController().signal, 120), (e: any) => e.code === "ServerTimeout");
    assert.ok(Date.now() - start < 700);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test("private snapshot launches verified bytes after original replacement", { timeout: 5000 }, async () => {
  assert.equal(typeof (binding as any).snapshotBinary, "function");
  const root = await mkdtemp(join(tmpdir(), "foreman-binary-snapshot-"));
  try {
    const original = join(root, "original"); const bytes = await readFile(process.execPath);
    await writeFile(original, bytes, { mode: 0o700 });
    const snapshot = await Effect.runPromise((binding as any).snapshotBinary(original, hash(bytes), root)) as string;
    await writeFile(original, "invalid replacement");
    assert.equal(hash(await readFile(snapshot)), hash(bytes));
    assert.equal((await stat(snapshot)).mode & 0o777, 0o500);
    const child = spawn(snapshot, ["-e", "process.exit(23)"], { stdio: "ignore" });
    const owned = lifecycle.observeChild(child);
    try { assert.deepEqual(await boundedExit(owned), { code: 23, signal: null, spawnFailed: false }); } finally { await owned.stop(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("report scan refuses every registered deletion canary and preserves signal exit", { timeout: 5000 }, async () => {
  assert.equal(typeof (lifecycle as any).assertNoReportLeaks, "function");
  for (const canary of ["foreman-synthetic-old-control", "foreman-synthetic-new-control"]) {
    assert.throws(() => (lifecycle as any).assertNoReportLeaks(JSON.stringify({ assertion: canary }), [canary]), (e: any) => e.code === "ReportLeak");
  }
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const owned = lifecycle.observeChild(child); await once(child, "spawn"); child.kill("SIGTERM");
  try { assert.deepEqual(await boundedExit(owned), { code: null, signal: "SIGTERM", spawnFailed: false }); } finally { await owned.stop(); }
});

async function boundedExit(owned: ReturnType<typeof lifecycle.observeChild>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([owned.exited, new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error("ChildTimeout")), 3000); })]); }
  finally { clearTimeout(timer); }
}

test("proxy-enabled Node routes known-bad fetch through proxy but administrative transport stays direct", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "foreman-proxy-control-"));
  const seen: string[] = []; let direct = 0;
  const sockets = new Set<Duplex>(); const children: ReturnType<typeof lifecycle.observeChild>[] = [];
  const proxy = createServer((q, r) => { seen.push(String(q.headers["x-vault-token"])); r.end("{}"); });
  proxy.on("connect", (_q, socket) => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", bytes => { seen.push(/x-vault-token: ([^\r]+)/i.exec(bytes.toString())?.[1] ?? "missing"); socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"); });
  });
  const peer = createServer((_q, r) => { direct++; r.end("{}"); });
  proxy.listen(0, "127.0.0.1"); peer.listen(0, "127.0.0.1"); await Promise.all([once(proxy, "listening"), once(peer, "listening")]);
  const p = proxy.address(); const a = peer.address(); assert.ok(p && a && typeof p !== "string" && typeof a !== "string");
  try {
    const origin = `http://127.0.0.1:${a.port}`;
    const entry = join(root, "request.mjs");
    await build({ stdin: { contents: `import { request } from ${JSON.stringify(new URL("./lifecycle.ts", import.meta.url).pathname)}; await request(${JSON.stringify(origin)}, new AbortController().signal, 'synthetic-root-canary', '/');`, resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", outfile: entry });
    const env = { ...process.env, NODE_OPTIONS: "", NODE_USE_ENV_PROXY: "1", HTTP_PROXY: `http://127.0.0.1:${p.port}`, http_proxy: `http://127.0.0.1:${p.port}`, NO_PROXY: "", no_proxy: "", ALL_PROXY: "", all_proxy: "" };
    const bad = spawn(process.execPath, ["-e", `fetch(${JSON.stringify(origin)}, {headers:{'x-vault-token':'synthetic-root-canary'}}).then(r=>r.text())`], { env, stdio: "ignore" });
    const badOwned = lifecycle.observeChild(bad); children.push(badOwned);
    assert.equal((await boundedExit(badOwned)).code, 0); assert.deepEqual(seen, ["synthetic-root-canary"]); assert.equal(direct, 0);
    seen.length = 0;
    const good = spawn(process.execPath, [entry], { env, stdio: "ignore" });
    const goodOwned = lifecycle.observeChild(good); children.push(goodOwned);
    assert.equal((await boundedExit(goodOwned)).code, 0); assert.deepEqual(seen, []); assert.equal(direct, 1);
  } finally { await Promise.all(children.map(child => child.stop())); for (const socket of sockets) socket.destroy(); for (const server of [proxy, peer]) { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); } await rm(root, { recursive: true, force: true }); }
});
