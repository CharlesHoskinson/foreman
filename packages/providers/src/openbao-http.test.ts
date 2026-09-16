import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { Cause, Effect, Redacted } from "effect";
import { makeOpenBaoHttpClient } from "./openbao-http.js";

test("session is lazy and shares one token across sequential requests", async () => {
  let tokenCalls = 0;
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(request.url ?? "");
    response.end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const client = makeOpenBaoHttpClient({
      endpoint: `http://127.0.0.1:${address.port}`, mount: "credentials",
      token: () => Effect.sync(() => { tokenCalls += 1; return Redacted.make("synthetic-token"); }),
    }, true);
    const operation = client.run(() => true, session => session.request("GET", "/first").pipe(
      Effect.flatMap(() => session.request("GET", "/second")),
    ), Date.now() + 1000);
    assert.equal(tokenCalls, 0);
    assert.deepEqual(seen, []);
    await Effect.runPromise(operation);
    assert.equal(tokenCalls, 1);
    assert.deepEqual(seen, ["/first", "/second"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("outer session deadline bounds a multi-request operation", async () => {
  let deadline = 0;
  let tokenCalls = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const server = createServer((request, response) => {
    if (request.url === "/first") response.end("{}");
    else timers.push(setTimeout(() => response.end("{}"), Math.max(0, deadline + 100 - Date.now())));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const client = makeOpenBaoHttpClient({
      endpoint: `http://127.0.0.1:${address.port}`, mount: "credentials",
      token: () => Effect.sync(() => { tokenCalls += 1; return Redacted.make("synthetic-token"); }),
    }, true);
    deadline = Date.now() + 200;
    const exit = await Effect.runPromiseExit(client.run(() => true, session => session.request("GET", "/first").pipe(
      Effect.flatMap(() => session.request("GET", "/second")),
    ), deadline));
    assert.equal(exit._tag, "Failure");
    if (exit._tag === "Failure") {
      assert.deepEqual(exit.cause, Cause.fail({ _tag: "CredentialStoreFailure", code: "Timeout" }));
    }
    assert.equal(tokenCalls, 1);
  } finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
