import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Redacted } from "effect";
import * as providers from "./index.js";

test("composed production backend snapshots configuration and authority without exposing secrets", async () => {
  assert.equal(typeof (providers as any).makeOpenBaoCredentialBackend, "function");
  const calls: string[] = [];
  const config = { endpoint: "https://127.0.0.1:1", mount: "credentials", caPem: "raw-ca-canary", token: () => Effect.sync(() => { calls.push("original"); return Redacted.make("token-canary"); }) };
  const pending = (providers as any).makeOpenBaoCredentialBackend(config);
  config.endpoint = "http://invalid.example"; config.mount = "invalid/path"; config.caPem = "mutated-ca";
  config.token = () => Effect.sync(() => { calls.push("mutated"); return Redacted.make("mutated"); });
  const backend: any = await Effect.runPromise(pending);
  assert.equal(backend.identity.endpoint, "https://127.0.0.1:1"); assert.equal(backend.identity.mount, "credentials");
  assert.equal(Object.isFrozen(backend), true);
  const exit = await Effect.runPromiseExit(backend.store.read("bao:codex:main", Date.now() + 1000));
  assert.equal(exit._tag, "Failure"); assert.deepEqual(calls, ["original"]);
  for (const canary of ["raw-ca-canary", "token-canary"]) assert.equal(JSON.stringify({ backend, exit }).includes(canary), false);
  const maintenance: any = await Effect.runPromise((providers as any).makeOpenBaoCredentialBackend({ endpoint: "https://127.0.0.1:1", mount: "credentials", caPem: "raw-ca-canary", token: () => Effect.succeed(Redacted.make("maintenance")) }));
  assert.deepEqual(maintenance.identity, backend.identity);
  const invalid: any = await Effect.runPromiseExit((providers as any).makeOpenBaoCredentialBackend(config));
  assert.equal(invalid.cause.error.code, "InvalidInput"); assert.deepEqual(calls, ["original"]);
});

test("production backend identity binds canonical endpoint, mount, namespace, and trust configuration", async () => {
  assert.equal("makeCredentialBackendIdentity" in providers, true);
  const make = (providers as any).makeCredentialBackendIdentity;
  const config = { endpoint: "https://bao.example", mount: "credentials", namespace: "team/foreman", systemTrustIdentity: "host-policy-v1" };
  const first: any = await Effect.runPromise(make(config));
  assert.deepEqual(await Effect.runPromise(make({ ...config })), first);
  assert.equal(Object.isFrozen(first), true);
  assert.match(first.id, /^[a-f0-9]{64}$/);
  for (const changed of [{ endpoint: "https://other.example" }, { mount: "other" }, { namespace: "other" }, { systemTrustIdentity: "host-policy-v2" }, { caPem: "test-ca-canary", systemTrustIdentity: undefined }]) {
    const identity: any = await Effect.runPromise(make({ ...config, ...changed }));
    assert.notEqual(identity.id, first.id);
    assert.equal(JSON.stringify(identity).includes("test-ca-canary"), false);
  }
  assert.deepEqual(Object.keys(first).sort(), ["endpoint", "id", "kind", "mount", "namespace", "trustSha256"].sort());
});

test("backend identity rejects ambiguous configuration and synthetic origins with closed failures", async () => {
  assert.equal("makeCredentialBackendIdentity" in providers, true);
  const make = (providers as any).makeCredentialBackendIdentity;
  const good = { endpoint: "https://bao.example", mount: "credentials", systemTrustIdentity: "host-policy-v1" };
  for (const bad of [
    { endpoint: "http://127.0.0.1:8200" }, { endpoint: "https://bao.example/" }, { endpoint: "https://user:secret@bao.example" }, { endpoint: "https://bao.example/a" }, { endpoint: "https://bao.example?x=1" }, { endpoint: "https://bao.example#x" },
    { mount: "bad/name" }, { mount: "bad\n" }, { namespace: "bad//name" }, { namespace: "" }, { systemTrustIdentity: "" }, { systemTrustIdentity: undefined }, { caPem: "" }, { caPem: "ca", systemTrustIdentity: "both" },
  ]) {
    const exit: any = await Effect.runPromiseExit(make({ ...good, ...bad }));
    assert.equal(exit._tag, "Failure");
    assert.deepEqual(exit.cause.error, { _tag: "CredentialStoreFailure", code: "InvalidInput" });
    assert.equal(JSON.stringify(exit).includes("secret"), false);
  }
});
