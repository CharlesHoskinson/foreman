import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCoreFailure } from "./failures.js";
import { decodeUtf8Fatal, MAX_INPUT_BYTES } from "./utf8.js";

describe("decodeUtf8Fatal", () => {
  it("decodes valid utf-8", () => {
    const bytes = new TextEncoder().encode("hello");
    assert.equal(decodeUtf8Fatal(bytes), "hello");
  });

  it("rejects malformed utf-8", () => {
    const bad = new Uint8Array([0xc3, 0x28]);
    const result = decodeUtf8Fatal(bad);
    assert.ok(isCoreFailure(result));
    assert.equal(result._tag, "MalformedUtf8");
  });

  it("rejects oversize input above 1 MiB", () => {
    const big = new Uint8Array(MAX_INPUT_BYTES + 1);
    const result = decodeUtf8Fatal(big);
    assert.ok(isCoreFailure(result));
    assert.equal(result._tag, "OversizeInput");
    if (result._tag === "OversizeInput") {
      assert.equal(result.maxBytes, MAX_INPUT_BYTES);
    }
  });

  it("accepts exactly 1 MiB", () => {
    const exact = new Uint8Array(MAX_INPUT_BYTES);
    exact.fill(0x41);
    const result = decodeUtf8Fatal(exact);
    assert.equal(typeof result, "string");
    assert.equal((result as string).length, MAX_INPUT_BYTES);
  });

  it("preserves BOM instead of silently stripping it", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x62]); // BOM + "ab"
    const result = decodeUtf8Fatal(bytes);
    assert.equal(result, "\uFEFFab");
  });
});
