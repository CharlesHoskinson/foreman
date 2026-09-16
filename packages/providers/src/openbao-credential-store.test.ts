import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { test } from "node:test";
import { X509Certificate } from "node:crypto";
import { Cause, Deferred, Effect, Fiber, Redacted } from "effect";
import { makeOpenBaoCredentialStore, makeSyntheticOpenBaoCredentialStore } from "./openbao-credential-store.js";

const tokenCanary = "broker-token-canary";
const material = Redacted.make({ access: "foreman-synthetic-access", refresh: "foreman-synthetic-refresh" });
const tlsKey = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgHrxR1QGuFYaDm4PB
cYdcRVXWcCRau7DJB1CgViES4pahRANCAASyD5pKNwmtLQElzH1gSuLvlcEdzpnT
jOoEgTuuLjRdSNS+NidDsfYjSs+DbwQe+O9Ijt5T0YyQAwQ3qjiOnrd5
-----END PRIVATE KEY-----`;
const tlsCert = `-----BEGIN CERTIFICATE-----
MIIBjjCCATSgAwIBAgIUcxtOBkmp9PLAShteMMxWQ2eFn8QwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDkxNTE2NTYwN1oXDTM2MDkxMjE2
NTYwN1owFDESMBAGA1UEAwwJMTI3LjAuMC4xMFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEsg+aSjcJrS0BJcx9YEri75XBHc6Z04zqBIE7ri40XUjUvjYnQ7H2I0rP
g28EHvjvSI7eU9GMkAMEN6o4jp63eaNkMGIwHQYDVR0OBBYEFP0AAmeGAT//IBBy
BLfuI1/F8TUJMB8GA1UdIwQYMBaAFP0AAmeGAT//IBByBLfuI1/F8TUJMA8GA1Ud
EwEB/wQFMAMBAf8wDwYDVR0RBAgwBocEfwAAATAKBggqhkjOPQQDAgNIADBFAiEA
mvyLIXvamH4jDTAeeFHta2baW+dsvApiFnNBCZmqOvUCIGyAtZsyACchrei4CxaI
YFUx6CIP6aRRvVQ3yue9Nrdi
-----END CERTIFICATE-----`;
const ipv6Key = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgZAevkx5716LdQS98
nlWWVTyLQsI7yOcW+bRf0PVn5fWhRANCAASEGtY4iNPk/piLo/GYO3SGhCf+yc4M
Hov+oXRV2UFgrcIt6aGBZFPIJfY0ljoGfSbsgkr6Sw4AYWGTfnoYM3q0
-----END PRIVATE KEY-----`;
const ipv6Cert = `-----BEGIN CERTIFICATE-----
MIIBmzCCAUCgAwIBAgIUPQ70x0KBNvJyxhL97TUJ1V+KaCcwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJaXB2Ni10ZXN0MB4XDTI2MDkxNTE5MzkyN1oXDTM2MDkxMjE5
MzkyN1owFDESMBAGA1UEAwwJaXB2Ni10ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEhBrWOIjT5P6Yi6PxmDt0hoQn/snODB6L/qF0VdlBYK3CLemhgWRTyCX2
NJY6Bn0m7IJK+ksOAGFhk356GDN6tKNwMG4wHQYDVR0OBBYEFC57JNvnVAWD0CGP
zCET62eIENK1MB8GA1UdIwQYMBaAFC57JNvnVAWD0CGPzCET62eIENK1MA8GA1Ud
EwEB/wQFMAMBAf8wGwYDVR0RBBQwEocQAAAAAAAAAAAAAAAAAAAAATAKBggqhkjO
PQQDAgNJADBGAiEA3Uiflvmi/6CCwkkZogJrNFqyqGcv69P4EM2NkQSlFooCIQC7
jBRvTH41RCS+RVaI+SNYnv8XLQh3KbOJn/O6YXcutA==
-----END CERTIFICATE-----`;
const failureCode = async (effect: Effect.Effect<unknown, { readonly code: string }>) => {
  const exit = await Effect.runPromiseExit(effect);
  assert.equal(exit._tag, "Failure");
  if (exit._tag !== "Failure") throw new Error("expected failure");
  const error = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
  assert.ok(error);
  assert.equal(JSON.stringify(exit).includes(tokenCanary), false);
  return error.code;
};
const sanitizedFailure = async (effect: Effect.Effect<unknown, { readonly code: string }>, expected: string, canary: string) => {
  const exit = await Effect.runPromiseExit(effect);
  assert.equal(exit._tag, "Failure");
  if (exit._tag !== "Failure") throw new Error("expected failure");
  assert.equal(JSON.stringify(exit).includes(canary), false);
  assert.equal(Cause.pretty(exit.cause).includes(canary), false);
  assert.deepEqual(exit.cause, Cause.fail({ _tag: "CredentialStoreFailure", code: expected }));
};
const serve = async (handler: (request: IncomingMessage, response: ServerResponse, body: string) => void, run: (origin: string) => Promise<void>) => {
  const server = createServer((request, response) => { const chunks: Buffer[] = []; request.on("data", chunk => chunks.push(chunk)); request.on("end", () => handler(request, response, Buffer.concat(chunks).toString("utf8"))); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  try { await run(`http://127.0.0.1:${address.port}`); } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
};
const config = (origin: string, calls = { value: 0 }) => ({ endpoint: origin, mount: "credentials", namespace: "team/foreman", token: () => Effect.sync(() => { calls.value++; return Redacted.make(tokenCanary); }) });

test("raw reader does not accept a managed schema 2 envelope", async () => {
  await serve((_request, response) => {
    response.end(JSON.stringify({ data: {
      data: { schemaVersion: 2, provider: "agy", account: "main",
        generation: 1, state: "active", material: { access: "foreman-synthetic-a" } },
      metadata: { version: 1 },
    } }));
  }, async origin => {
    const store = makeSyntheticOpenBaoCredentialStore(config(origin));
    assert.equal(await failureCode(store.read("bao:agy:main", Date.now() + 1000)),
      "InvalidResponse");
  });
});

test("writes with CAS, reads the shared envelope, lists sorted accounts, and removes exact versions", async () => {
  const seen: Array<{ url: string; method: string; body: string; namespace: string | undefined }> = [];
  await serve((request, response, body) => {
    seen.push({ url: request.url!, method: request.method!, body, namespace: request.headers["x-vault-namespace"] as string | undefined });
    assert.equal(request.headers["x-vault-token"], tokenCanary);
    if (request.method === "POST" && request.url!.includes("/data/")) return response.end('{"data":{"version":3}}');
    if (request.method === "GET" && request.url!.includes("/data/")) return response.end('{"data":{"data":{"schemaVersion":1,"provider":"agy","account":"main","material":{"access":"foreman-synthetic-access","refresh":"foreman-synthetic-refresh"}},"metadata":{"version":3}}}');
    if (request.method === "GET" && request.url!.endsWith("?list=true")) return response.end('{"data":{"keys":["z","a"]}}');
    response.statusCode = 204; response.end();
  }, async origin => {
    const calls = { value: 0 }; const store = makeSyntheticOpenBaoCredentialStore(config(origin, calls)); const deadline = () => Date.now() + 1_000;
    assert.equal(await Effect.runPromise(store.write("bao:agy:main", material, 2, deadline())), 3);
    const read = await Effect.runPromise(store.read("bao:agy:main", deadline()));
    assert.deepEqual({ provider: read.provider, account: read.account, version: read.version, material: Redacted.value(read.material) }, { provider: "agy", account: "main", version: 3, material: Redacted.value(material) });
    assert.deepEqual(await Effect.runPromise(store.list("agy", deadline())), ["a", "z"]);
    await Effect.runPromise(store.remove("bao:agy:main", [1, 3], deadline()));
    assert.equal(calls.value, 4);
  });
  assert.deepEqual(seen.map(x => [x.method, x.url]), [["POST", "/v1/credentials/data/providers/agy/main"], ["GET", "/v1/credentials/data/providers/agy/main"], ["GET", "/v1/credentials/metadata/providers/agy?list=true"], ["POST", "/v1/credentials/delete/providers/agy/main"]]);
  assert.deepEqual(JSON.parse(seen[0]!.body), { data: { schemaVersion: 1, provider: "agy", account: "main", material: Redacted.value(material) }, options: { cas: 2 } });
  assert.deepEqual(JSON.parse(seen[3]!.body), { versions: [1, 3] });
  assert.ok(seen.every(x => x.namespace === "team/foreman"));
});

test("validates all inputs before resolving a bootstrap token", async () => {
  let calls = 0; const bad = makeSyntheticOpenBaoCredentialStore({ endpoint: "http://localhost:8200", mount: "bad/name", token: () => Effect.sync(() => { calls++; return Redacted.make(tokenCanary); }) });
  assert.equal(await failureCode(bad.read("bad", Date.now() + 100)), "InvalidInput");
  const store = makeSyntheticOpenBaoCredentialStore({ endpoint: "http://127.0.0.1:1", mount: "ok", token: () => Effect.sync(() => { calls++; return Redacted.make(tokenCanary); }) });
  assert.equal(await failureCode(store.write("bao:agy:a", Redacted.make({ x: "not-synthetic" }), 0, Date.now() + 100)), "InvalidInput");
  assert.equal(await failureCode(store.remove("bao:agy:a", [0], Date.now() + 100)), "InvalidInput");
  assert.equal(calls, 0);
  assert.equal(await failureCode(makeOpenBaoCredentialStore(config("http://127.0.0.1:8200")).read("bao:agy:a", Date.now() + 100)), "InvalidInput");
  for (const badMount of ["ok\n", "ok\r"]) {
    const newline = makeSyntheticOpenBaoCredentialStore({ endpoint: "http://127.0.0.1:1", mount: badMount, token: () => Effect.sync(() => { calls++; return Redacted.make(tokenCanary); }) });
    assert.equal(await failureCode(newline.read("bao:agy:a", Date.now() + 100)), "InvalidInput");
  }
  const badNamespace = makeSyntheticOpenBaoCredentialStore({ endpoint: "http://127.0.0.1:1", mount: "ok", namespace: "team/bad\n", token: () => Effect.sync(() => { calls++; return Redacted.make(tokenCanary); }) });
  assert.equal(await failureCode(badNamespace.read("bao:agy:a", Date.now() + 100)), "InvalidInput");
  assert.equal(calls, 0);
});

test("acquires tokens lazily, checks the absolute deadline first, and sanitizes callback defects", async () => {
  let calls = 0;
  const store = makeSyntheticOpenBaoCredentialStore({ endpoint: "http://127.0.0.1:1", mount: "ok", token: () => Effect.sync(() => { calls++; return Redacted.make(tokenCanary); }) });
  const operation = store.read("bao:agy:a", Date.now() + 20);
  assert.equal(calls, 0);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(await failureCode(operation), "InvalidInput");
  assert.equal(calls, 0);
  const throwing = makeSyntheticOpenBaoCredentialStore({ endpoint: "http://127.0.0.1:1", mount: "ok", token: () => { throw new Error(`secret ${tokenCanary}`); } });
  await sanitizedFailure(throwing.read("bao:agy:a", Date.now() + 100), "Unavailable", tokenCanary);
});

test("maps statuses, refuses redirects, malformed and oversized responses", async () => {
  for (const [status, expected] of [[403, "Denied"], [404, "NotFound"], [409, "Conflict"], [503, "Unavailable"], [302, "InvalidResponse"]] as const) await serve((_q, response) => { response.statusCode = status; response.end(`secret ${tokenCanary}`); }, async origin => assert.equal(await failureCode(makeSyntheticOpenBaoCredentialStore(config(origin)).read("bao:agy:a", Date.now() + 1_000)), expected));
  for (const body of ["{", '{"data":{"keys":["nested/"]}}', "x".repeat(65_537)]) await serve((_q, response) => response.end(body), async origin => assert.equal(await failureCode(makeSyntheticOpenBaoCredentialStore(config(origin)).list("agy", Date.now() + 1_000)), "InvalidResponse"));
});

test("maps OpenBao's stale CAS response to Conflict without exposing its body", async () => {
  await serve((_request, response) => {
    response.statusCode = 400;
    response.end(`check-and-set parameter did not match current version ${tokenCanary}`);
  }, async origin => {
    assert.equal(await failureCode(makeSyntheticOpenBaoCredentialStore(config(origin)).write("bao:agy:a", material, 9, Date.now() + 1_000)), "Conflict");
  });
});

test("token callback failure and hanging callback stay within the operation deadline", async () => {
  const unavailable = { _tag: "CredentialStoreFailure", code: "Unavailable" } as const;
  const failing = makeSyntheticOpenBaoCredentialStore({ endpoint: "http://127.0.0.1:1", mount: "ok", token: () => Effect.fail(unavailable) });
  assert.equal(await failureCode(failing.read("bao:agy:a", Date.now() + 100)), "Unavailable");
  const hanging = makeSyntheticOpenBaoCredentialStore({ endpoint: "http://127.0.0.1:1", mount: "ok", token: () => Effect.never });
  assert.equal(await failureCode(hanging.read("bao:agy:a", Date.now() + 30)), "Timeout");
});

test("bootstrap typed failures expose only a declared code", async () => {
  const canary = "typed-bootstrap-canary";
  for (const [callbackFailure, expected] of [
    [{ _tag: "CredentialStoreFailure", code: "Denied", detail: canary }, "Denied"],
    [{ _tag: "CredentialStoreFailure", code: `Unknown-${canary}` }, "Unavailable"],
  ] as const) {
    const store = makeSyntheticOpenBaoCredentialStore({
      endpoint: "http://127.0.0.1:1",
      mount: "ok",
      token: () => Effect.fail(callbackFailure) as never,
    });
    await sanitizedFailure(store.read("bao:codex:work", Date.now() + 100), expected, canary);
  }
});

test("bootstrap defects and malformed token values are sanitized before transport", async () => {
  const canary = "defect-bootstrap-canary";
  let requests = 0;
  await serve((_request, response) => { requests++; response.end("{}"); }, async origin => {
    const defective = makeSyntheticOpenBaoCredentialStore({ endpoint: origin, mount: "ok", token: () => Effect.die(new Error(canary)) as never });
    await sanitizedFailure(defective.read("bao:codex:work", Date.now() + 100), "Unavailable", canary);
    const malformed = makeSyntheticOpenBaoCredentialStore({ endpoint: origin, mount: "ok", token: () => Effect.succeed(canary) as never });
    await sanitizedFailure(malformed.read("bao:codex:work", Date.now() + 100), "Unavailable", canary);
    const nonString = makeSyntheticOpenBaoCredentialStore({ endpoint: origin, mount: "ok", token: () => Effect.succeed(Redacted.make(123)) as never });
    await sanitizedFailure(nonString.read("bao:codex:work", Date.now() + 100), "Unavailable", canary);
    for (const raw of ["", `${canary}\n`, "é", "x".repeat(32769)]) {
      const invalid = makeSyntheticOpenBaoCredentialStore({ endpoint: origin, mount: "ok", token: () => Effect.succeed(Redacted.make(raw)) });
      await sanitizedFailure(invalid.read("bao:codex:work", Date.now() + 100), "InvalidInput", canary);
    }
  });
  assert.equal(requests, 0);
});

test("caller interruption passes through bootstrap token acquisition", async () => {
  const entered = Effect.runSync(Deferred.make<void>());
  const store = makeSyntheticOpenBaoCredentialStore({
    endpoint: "http://127.0.0.1:1",
    mount: "ok",
    token: () => Effect.zipRight(Deferred.succeed(entered, undefined), Effect.never),
  });
  const exit = await Effect.runPromise(Effect.gen(function* () {
    const fiber = yield* Effect.fork(store.read("bao:codex:work", Date.now() + 1_000));
    yield* Deferred.await(entered);
    return yield* Fiber.interrupt(fiber);
  }));
  assert.equal(exit._tag, "Failure");
  if (exit._tag === "Failure") assert.equal(Cause.isInterruptedOnly(exit.cause), true);
});

test("production rejects a self-signed certificate even when the process disables TLS verification", async () => {
  let requests = 0;
  const server = createHttpsServer({ key: tlsKey, cert: tlsCert }, (_request, response) => { requests++; response.end("{}"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    for (const inherited of [undefined, "0"] as const) {
      if (inherited === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = inherited;
      const store = makeOpenBaoCredentialStore(config(`https://127.0.0.1:${address.port}`));
      assert.equal(await failureCode(store.read("bao:agy:a", Date.now() + 1_000)), "Unavailable");
    }
    assert.equal(requests, 0);
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    const trusted = makeOpenBaoCredentialStore({ ...config(`https://127.0.0.1:${address.port}`), caPem: tlsCert });
    assert.equal(await failureCode(trusted.read("bao:agy:a", Date.now() + 1_000)), "InvalidResponse");
    assert.equal(requests, 1);
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("observes input changes made before Effect execution", async () => {
  const mutable: Record<string, string> = { access: "not-synthetic" };
  const versions = [0];
  const store = makeSyntheticOpenBaoCredentialStore(config("http://127.0.0.1:1"));
  const write = store.write("bao:agy:a", Redacted.make(mutable), 0, Date.now() + 1_000);
  const remove = store.remove("bao:agy:a", versions, Date.now() + 1_000);
  mutable.access = "foreman-synthetic-access"; versions[0] = 1;
  assert.equal(await failureCode(write), "Unavailable");
  assert.equal(await failureCode(remove), "Unavailable");
});

test("HTTPS IPv6 literals connect with verified IP certificates and reject untrusted or mismatched certificates", { timeout: 5000 }, async context => {
  for (const [key, cert, shouldConnect] of [[ipv6Key, ipv6Cert, true], [tlsKey, tlsCert, false]] as const) {
    // Each fixture is its own configured trust anchor. Check trust independently
    // from the store's deliberately closed Unavailable transport failure.
    const anchor = new X509Certificate(cert);
    assert.equal(anchor.ca, true);
    assert.equal(anchor.verify(anchor.publicKey), true);
    assert.ok(Date.now() >= Date.parse(anchor.validFrom) && Date.now() < Date.parse(anchor.validTo));
    assert.equal(anchor.checkIP("::1") !== undefined, shouldConnect);
    if (!shouldConnect) assert.equal(anchor.checkIP("127.0.0.1"), "127.0.0.1");
    let requests = 0; let tokens = 0;
    const server = createHttpsServer({ key, cert }, (_request, response) => { requests++; response.end('{"data":{"keys":["account-a"]}}'); });
    try { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "::1", resolve); }); }
    catch (error) {
      if (["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes((error as NodeJS.ErrnoException).code ?? "")) { context.skip("IPv6 loopback is unavailable on this host"); return; }
      throw error;
    }
    const address = server.address(); assert.ok(address && typeof address === "object");
    const endpoint = `https://[::1]:${address.port}`;
    try {
      const token = () => Effect.sync(() => { tokens++; return Redacted.make(tokenCanary); });
      const trusted = makeOpenBaoCredentialStore({ ...config(endpoint), token, caPem: cert });
      if (shouldConnect) assert.deepEqual(await Effect.runPromise(trusted.list("agy", Date.now() + 1000)), ["account-a"]);
      else assert.equal(await failureCode(trusted.list("agy", Date.now() + 1000)), "Unavailable");
      assert.equal(tokens, 1);
      assert.equal(requests, shouldConnect ? 1 : 0);
      const untrusted = makeOpenBaoCredentialStore({ ...config(endpoint), token });
      assert.equal(await failureCode(untrusted.list("agy", Date.now() + 1000)), "Unavailable");
      assert.equal(requests, shouldConnect ? 1 : 0);
      const invalid = makeOpenBaoCredentialStore({ ...config(`${endpoint}/extra`), token });
      assert.equal(await failureCode(invalid.list("agy", Date.now() + 1000)), "InvalidInput");
      assert.equal(tokens, 2);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});

test("token service methods retain their receiver through an explicit closure", async () => {
  const service = { calls: 0, acquire() { this.calls++; return Effect.succeed(Redacted.make(tokenCanary)); } };
  await serve((request, response) => {
    assert.equal(request.headers["x-vault-token"], tokenCanary);
    response.end('{"data":{"keys":["account-a"]}}');
  }, async origin => {
    const store = makeSyntheticOpenBaoCredentialStore({ ...config(origin), token: () => service.acquire() });
    assert.deepEqual(await Effect.runPromise(store.list("agy", Date.now() + 1000)), ["account-a"]);
    assert.equal(service.calls, 1);
  });
});

for (const operation of ["write", "remove"] as const) test(`${operation} preserves authorized HTTP bytes while bootstrap token acquisition is paused`, async () => {
  const entered = Effect.runSync(Deferred.make<void>());
  const release = Effect.runSync(Deferred.make<void>());
  const mutable = { access: "foreman-synthetic-authorized" };
  const versions = [1, 3];
  let received: unknown;
  await serve((_request, response, body) => {
    received = JSON.parse(body);
    response.end(operation === "write" ? '{"data":{"version":4}}' : "");
  }, async origin => {
    const store = makeSyntheticOpenBaoCredentialStore({ ...config(origin), token: () => Effect.zipRight(Deferred.succeed(entered, undefined), Deferred.await(release)).pipe(Effect.as(Redacted.make(tokenCanary))) });
    const task = operation === "write" ? store.write("bao:agy:a", Redacted.make(mutable), 3, Date.now() + 2000) : store.remove("bao:agy:a", versions, Date.now() + 2000);
    const fiber = Effect.runFork(task);
    await Effect.runPromise(Deferred.await(entered));
    mutable.access = "foreman-synthetic-unauthorized"; versions.splice(0, 2, 99);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(fiber));
  });
  assert.deepEqual(received, operation === "write" ? { data: { schemaVersion: 1, provider: "agy", account: "a", material: { access: "foreman-synthetic-authorized" } }, options: { cas: 3 } } : { versions: [1, 3] });
});

test("a hanging peer reaches the short deadline and its socket closes", { timeout: 5000 }, async () => {
  let requests = 0;
  let close!: () => void;
  const closed = new Promise<void>(resolve => { close = resolve; });
  await serve((_request, response) => { requests++; response.socket!.once("close", close); }, async origin => {
    const started = Date.now();
    assert.equal(await failureCode(makeSyntheticOpenBaoCredentialStore(config(origin)).read("bao:agy:a", started + 100)), "Timeout");
    await closed;
    assert.equal(requests, 1);
    assert.ok(Date.now() - started < 1500);
  });
});
