import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VersionReferenceError } from "./failures.js";
import { normaliseVersionRef } from "./port.js";

describe("normaliseVersionRef", () => {
  it("accepts bare branch names", () => {
    assert.equal(normaliseVersionRef("main"), "main");
    assert.equal(normaliseVersionRef("lane-b"), "lane-b");
  });

  it("accepts commit:<id>", () => {
    assert.equal(normaliseVersionRef("commit:abc123"), "commit:abc123");
  });

  it("rejects branch: prefix", () => {
    assert.throws(() => normaliseVersionRef("branch:main"), VersionReferenceError);
  });

  it("rejects empty", () => {
    assert.throws(() => normaliseVersionRef("  "), VersionReferenceError);
  });

  it("rejects full path form", () => {
    assert.throws(
      () => normaliseVersionRef("admin/foo/branch/main"),
      VersionReferenceError,
    );
  });

  it("rejects unknown prefix", () => {
    assert.throws(() => normaliseVersionRef("tag:v1"), VersionReferenceError);
  });

  it("rejects empty commit id", () => {
    assert.throws(() => normaliseVersionRef("commit:"), VersionReferenceError);
  });
});
