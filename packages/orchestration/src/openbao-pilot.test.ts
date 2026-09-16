import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { test } from "node:test";
import { Effect, Fiber, Redacted } from "effect";
import { makePilotClient, parsePilotReference } from "./openbao-pilot.js";

const brokerCanary = "broker-token-canary";
const accessCanary = "foreman-synthetic-access-canary";
const refreshCanary = "foreman-synthetic-refresh-canary";

const failureCode = async (effect: Effect.Effect<unknown, { readonly code: string }>) => {
  const exit = await Effect.runPromiseExit(effect);
  assert.equal(exit._tag, "Failure");
  if (exit._tag !== "Failure") throw new Error("expected failure");
  const failure = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
  assert.ok(failure);
  const serialized = JSON.stringify(exit);
  for (const canary of [brokerCanary, accessCanary, refreshCanary]) assert.equal(serialized.includes(canary), false);
  return failure.code;
};

const withServer = async (
  handler: (requestUrl: string, token: string | undefined, response: ServerResponse) => void,
  run: (origin: string) => Promise<void>,
) => {
  const server = createServer((request, response) => handler(request.url ?? "", request.headers["x-vault-token"] as string | undefined, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
};

const envelope = (provider: string, account: string) => JSON.stringify({
  data: { data: { schemaVersion: 1, provider, account, material: { accessToken: accessCanary, refreshToken: refreshCanary } }, metadata: { version: 7 } },
});

test("explicit accounts only", () => {
  assert.deepEqual(parsePilotReference("bao:agy:account-a"), { provider: "agy", account: "account-a" });
  for (const ref of ["bao:gemini:a", "bao:grok:../a", "bao:claude:a%2fb", "bao:codex:a\n", "bao:agy:", `bao:agy:${"a".repeat(65)}`]) {
    assert.equal(parsePilotReference(ref), undefined);
  }
  for (const ending of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) assert.equal(parsePilotReference(`bao:agy:a${ending}`), undefined);
});

test("rejects malformed origins and references before network access", async () => {
  for (const origin of ["https://127.0.0.1:8200", "http://localhost:8200", "http://user@127.0.0.1:8200", "http://127.0.0.1:8200/a", "http://127.0.0.1:8200?x=1", "http://127.0.0.1:8200#x", "http://127.0.0.1"])
    assert.equal(await failureCode(makePilotClient({ origin, token: Redacted.make(brokerCanary) }).read("bao:agy:a", Date.now() + 100)), "InvalidInput");
  assert.equal(await failureCode(makePilotClient({ origin: "http://127.0.0.1:1", token: Redacted.make(brokerCanary) }).read("bad", Date.now() + 100)), "InvalidInput");
});

test("rejects malformed printable-header token input without leaking it", async () => {
  const invalidToken = `invalid-token-${brokerCanary}\n${accessCanary}`;
  const client = makePilotClient({ origin: "http://127.0.0.1:1", token: Redacted.make(invalidToken) });
  assert.equal(await failureCode(client.read("bao:agy:a", Date.now() + 1_000)), "InvalidInput");
});

test("reads eight exact provider and account identities", async () => {
  const pairs = [["codex", "a"], ["codex", "account.2"], ["grok", "a_b"], ["grok", "A-4"], ["claude", "c5"], ["claude", "account.six"], ["agy", "seven"], ["agy", "EIGHT_8"]] as const;
  await withServer((url, token, response) => {
    assert.equal(token, brokerCanary);
    const match = /^\/v1\/foreman-pilot\/data\/providers\/([^/]+)\/([^/]+)$/.exec(url)!;
    response.end(envelope(match[1]!, match[2]!));
  }, async origin => {
    const client = makePilotClient({ origin, token: Redacted.make(brokerCanary) });
    for (const [provider, account] of pairs) {
      const value = await Effect.runPromise(client.read(`bao:${provider}:${account}`, Date.now() + 1_000));
      assert.deepEqual({ provider: value.provider, account: value.account, version: value.version }, { provider, account, version: 7 });
      assert.equal(Redacted.value(value.accessToken), accessCanary);
      assert.equal(Redacted.value(value.refreshToken), refreshCanary);
      assert.equal(JSON.stringify(value).includes(accessCanary), false);
      assert.equal(JSON.stringify(value).includes(refreshCanary), false);
      assert.equal(JSON.stringify(value).includes(brokerCanary), false);
    }
  });
});

test("rejects eight identity mismatches", async () => {
  const mismatches = [["codex", "a", "grok", "a"], ["grok", "b", "grok", "x"], ["claude", "c", "agy", "c"], ["agy", "d", "agy", "x"], ["codex", "e", "claude", "e"], ["grok", "f", "codex", "f"], ["claude", "g", "claude", "z"], ["agy", "h", "codex", "z"]] as const;
  let index = 0;
  await withServer((_url, _token, response) => { const row = mismatches[index++]!; response.end(envelope(row[2], row[3])); }, async origin => {
    const client = makePilotClient({ origin, token: Redacted.make(brokerCanary) });
    for (const [provider, account] of mismatches) assert.equal(await failureCode(client.read(`bao:${provider}:${account}`, Date.now() + 1_000)), "InvalidResponse");
  });
});

test("maps denial, missing, sealed, and conflict to stable failures", async () => {
  for (const [status, expected] of [[403, "Denied"], [404, "Unavailable"], [503, "Unavailable"], [409, "Conflict"]] as const) {
    await withServer((_url, _token, response) => { response.statusCode = status; response.end(`secret ${accessCanary}`); }, async origin => {
      assert.equal(await failureCode(makePilotClient({ origin, token: Redacted.make(brokerCanary) }).read("bao:agy:a", Date.now() + 1_000)), expected);
    });
  }
});

test("rejects malformed, duplicate-key, invalid UTF-8, and invalid records", async () => {
  const bodies = [Buffer.from("{"), Buffer.from('{"data":{"data":{"schemaVersion":1,"schemaVersion":1}}}'), Buffer.from([0xff]), Buffer.from(envelope("agy", "a").replace(accessCanary, "foreman-synthetic-refresh-wrong"))];
  let index = 0;
  await withServer((_url, _token, response) => response.end(bodies[index++]!), async origin => {
    const client = makePilotClient({ origin, token: Redacted.make(brokerCanary) });
    for (const _body of bodies) assert.equal(await failureCode(client.read("bao:agy:a", Date.now() + 1_000)), "InvalidResponse");
  });
});

test("destroys the socket when a response exceeds 64 KiB", async () => {
  let closed!: Promise<void>;
  await withServer((_url, _token, response) => {
    closed = new Promise(resolve => response.socket!.once("close", resolve));
    response.write(Buffer.alloc(65_537, 0x61));
  }, async origin => {
    assert.equal(await failureCode(makePilotClient({ origin, token: Redacted.make(brokerCanary) }).read("bao:agy:a", Date.now() + 1_000)), "InvalidResponse");
    await closed;
  });
});

test("rejects redirects without contacting their target", async () => {
  let targetRequests = 0;
  await withServer((_url, _token, target) => { targetRequests++; target.end(); }, async targetOrigin => {
    let closed!: Promise<void>;
    await withServer((_url, _token, response) => { closed = new Promise(resolve => response.socket!.once("close", resolve)); response.statusCode = 302; response.setHeader("location", `${targetOrigin}/stolen`); response.end(); }, async origin => {
      assert.equal(await failureCode(makePilotClient({ origin, token: Redacted.make(brokerCanary) }).read("bao:agy:a", Date.now() + 1_000)), "InvalidResponse");
      await closed;
    });
  });
  assert.equal(targetRequests, 0);
});

test("deadline destroys the active socket", async () => {
  let closed!: Promise<void>;
  await withServer((_url, _token, response) => { closed = new Promise(resolve => response.socket!.once("close", resolve)); }, async origin => {
    assert.equal(await failureCode(makePilotClient({ origin, token: Redacted.make(brokerCanary) }).read("bao:agy:a", Date.now() + 40)), "Timeout");
    await closed;
  });
});

test("caps a caller deadline at five seconds", async () => {
  let closed!: Promise<void>;
  const started = Date.now();
  await withServer((_url, _token, response) => { closed = new Promise(resolve => response.socket!.once("close", resolve)); }, async origin => {
    assert.equal(await failureCode(makePilotClient({ origin, token: Redacted.make(brokerCanary) }).read("bao:agy:a", Date.now() + 60_000)), "Timeout");
    assert.ok(Date.now() - started >= 4_800 && Date.now() - started < 5_800);
    await closed;
  });
});

test("interruption destroys the active socket", async () => {
  let acceptedResolve!: () => void;
  const accepted = new Promise<void>(resolve => { acceptedResolve = resolve; });
  let closed!: Promise<void>;
  await withServer((_url, _token, response) => { closed = new Promise(resolve => response.socket!.once("close", resolve)); acceptedResolve(); }, async origin => {
    const fiber = Effect.runFork(makePilotClient({ origin, token: Redacted.make(brokerCanary) }).read("bao:agy:a", Date.now() + 5_000));
    await accepted;
    await Effect.runPromise(Fiber.interrupt(fiber));
    await closed;
  });
});
