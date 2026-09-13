import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Stream } from "effect";
import { decodeSse, createFetchHttpPort } from "./api-http.js";
import { createServer } from "node:http";

test("SSE preserves split Unicode, CRLF, multiline data and source IDs", async () => {
  const bytes = Buffer.from(
    'id: evt-7\r\nevent: delta\r\ndata: {"text":\r\ndata: "λ"}\r\n\r\n',
  );
  const chunks = Stream.fromIterable([...bytes].map((n) => Uint8Array.of(n)));
  const result = await Effect.runPromise(Stream.runCollect(decodeSse(chunks)));
  assert.deepEqual(Array.from(result), [
    { id: "evt-7", event: "delta", data: '{"text":\n"λ"}' },
  ]);
});
test("SSE fails on truncated event and bounds unbroken input", async () => {
  for (const input of ["data: {}", "data: " + "x".repeat(65)]) {
    const result = await Effect.runPromise(
      Effect.either(
        Stream.runCollect(decodeSse(Stream.make(Buffer.from(input)), 64)),
      ),
    );
    assert.equal(result._tag, "Left");
  }
});
test("real HTTP port sends exact bytes to loopback and never follows credential redirects", async () => {
  let received = "";
  const server = createServer((req, res) => {
    req.on("data", (chunk) => {
      received += chunk;
    });
    req.on("end", () => {
      res.writeHead(req.url === "/redirect" ? 302 : 200, {
        "content-type": "text/event-stream",
        location: "/leak",
      });
      res.end("data: {}\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const port = createFetchHttpPort();
    const response = await Effect.runPromise(
      Effect.scoped(
        port
          .request({ url, method: "POST", headers: {}, body: "λ\n$(literal)" })
          .pipe(Effect.flatMap((r) => Stream.runCollect(r.body))),
      ),
    );
    assert.ok(response.length > 0);
    assert.equal(received, "λ\n$(literal)");
    const status = await Effect.runPromise(
      Effect.scoped(
        port
          .request({ url: url + "/redirect", method: "GET", headers: {} })
          .pipe(Effect.map((r) => r.status)),
      ),
    );
    assert.equal(status, 302);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
