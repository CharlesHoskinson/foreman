import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SchemaValidationError } from "./failures.js";
import { detectsCycle, validateDocument } from "./schema.js";

describe("validateDocument", () => {
  it("rejects unknown fields", () => {
    assert.throws(
      () =>
        validateDocument({
          "@type": "Task",
          task_key: "t",
          freeform_extra: true,
        }),
      (e: unknown) =>
        e instanceof SchemaValidationError && e.field === "freeform_extra",
    );
  });

  it("rejects unknown kinds", () => {
    assert.throws(
      () => validateDocument({ "@type": "NotAType", key: "x" }),
      SchemaValidationError,
    );
  });

  it("rejects free-float confidence", () => {
    assert.throws(
      () =>
        validateDocument({
          "@type": "Claim",
          claim_key: "c",
          text: "t",
          status: "live",
          confidence: 0.5,
        }),
      (e: unknown) =>
        e instanceof SchemaValidationError && e.field === "confidence",
    );
  });

  it("rejects Mention", () => {
    assert.throws(
      () => validateDocument({ "@type": "Mention", mention_id: "m" }),
      SchemaValidationError,
    );
  });
});

describe("detectsCycle", () => {
  it("finds a simple cycle", () => {
    const edges = new Map<string, Set<string>>([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
    ]);
    assert.equal(detectsCycle(edges, "a"), true);
  });

  it("returns false for acyclic", () => {
    const edges = new Map<string, Set<string>>([
      ["a", new Set(["b"])],
      ["b", new Set(["c"])],
    ]);
    assert.equal(detectsCycle(edges, "a"), false);
  });

  it("bounds oversized traversal as cycle", () => {
    const edges = new Map<string, Set<string>>();
    // long chain
    for (let i = 0; i < 20; i++) {
      edges.set(`n${i}`, new Set([`n${i + 1}`]));
    }
    assert.equal(detectsCycle(edges, "n0", 5), true);
  });
});
