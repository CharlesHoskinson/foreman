import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Hex } from "./sha256.js";

describe("sha256Hex", () => {
  it("matches known empty string vector", () => {
    assert.equal(
      sha256Hex(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches known abc vector", () => {
    assert.equal(
      sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("returns lowercase 64 hex for bytes", () => {
    const dig = sha256Hex(new TextEncoder().encode("abc"));
    assert.equal(dig.length, 64);
    assert.match(dig, /^[0-9a-f]{64}$/);
  });
});
