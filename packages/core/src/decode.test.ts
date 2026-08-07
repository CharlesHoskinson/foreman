import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expectObject,
  expectString,
  rejectUnknownKeys,
  isSha256Hex,
  isCommitSha40,
} from "./decode.js";
import { isCoreFailure } from "./failures.js";

describe("decode helpers", () => {
  it("expectObject rejects arrays and null", () => {
    const a = expectObject([]);
    const b = expectObject(null);
    assert.ok(isCoreFailure(a));
    assert.ok(isCoreFailure(b));
    assert.equal(a._tag, "SchemaMismatch");
    assert.equal(b._tag, "SchemaMismatch");
  });

  it("expectString rejects numbers", () => {
    const r = expectString(1);
    assert.ok(isCoreFailure(r));
    assert.equal(r._tag, "SchemaMismatch");
  });

  it("rejectUnknownKeys flags unknown fields", () => {
    const err = rejectUnknownKeys({ a: 1, bad: 2 }, ["a"]);
    assert.ok(err && isCoreFailure(err));
    assert.equal(err._tag, "UnknownField");
    if (err._tag === "UnknownField") assert.equal(err.field, "bad");
  });

  it("rejectUnknownKeys allows exact set", () => {
    assert.equal(rejectUnknownKeys({ a: 1 }, ["a"]), null);
  });

  it("validates sha256 and commit hex", () => {
    assert.equal(
      isSha256Hex(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ),
      true,
    );
    assert.equal(isSha256Hex("ZZ"), false);
    assert.equal(isCommitSha40("a".repeat(40)), true);
    assert.equal(isCommitSha40("A".repeat(40)), false);
  });
});
