import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SchemaValidationError } from "./failures.js";
import {
  detectsCycle,
  validateDocument,
  validateDocumentMap,
} from "./schema.js";

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

  it("rejects multi-target Evaluation field values", () => {
    assert.throws(
      () =>
        validateDocument({
          "@type": "Evaluation",
          evaluation_id: "E-mt",
          verdict: "approved",
          evaluates_attempt: ["Attempt/A1", "Attempt/A2"],
        }),
      (e: unknown) =>
        e instanceof SchemaValidationError &&
        e.message.toLowerCase().includes("exactly one"),
    );
  });

  it("rejects Evaluation with two evaluates_* fields", () => {
    assert.throws(
      () =>
        validateDocument({
          "@type": "Evaluation",
          evaluation_id: "E-two",
          verdict: "approved",
          evaluates_attempt: "Attempt/A1",
          evaluates_artifact: "Artifact/p+h",
        }),
      SchemaValidationError,
    );
  });

  it("rejects non-reference Evaluation target", () => {
    assert.throws(
      () =>
        validateDocument({
          "@type": "Evaluation",
          evaluation_id: "E-nr",
          verdict: "approved",
          evaluates_attempt: 17,
        }),
      SchemaValidationError,
    );
  });

  it("rejects empty RESOLVED_TO array", () => {
    assert.throws(
      () =>
        validateDocument({
          "@type": "Entity",
          canonical_name: "a",
          entity_type: "t",
          resolved_to: [],
          resolved_to_reviewer: "r",
          resolved_to_provenance: "p",
        }),
      (e: unknown) =>
        e instanceof SchemaValidationError && e.field === "resolved_to",
    );
  });

  it("rejects misplaced relation fields by kind", () => {
    assert.throws(
      () =>
        validateDocument({
          "@type": "Claim",
          claim_key: "c",
          text: "t",
          status: "live",
          confidence: "low",
          has_attempt: 17,
        }),
      (e: unknown) =>
        e instanceof SchemaValidationError && e.field === "has_attempt",
    );
  });

  it("rejects non-reference link values", () => {
    assert.throws(
      () =>
        validateDocument({
          "@type": "Task",
          task_key: "t",
          depends_on: 42,
        }),
      SchemaValidationError,
    );
  });

  it("accepts conforming Evaluation with one target", () => {
    const id = validateDocument({
      "@type": "Evaluation",
      evaluation_id: "E-ok",
      verdict: "approved",
      evaluates_attempt: "Attempt/A1",
    });
    assert.equal(id, "Evaluation/E-ok");
  });
});

describe("validateDocumentMap", () => {
  it("rejects map key not equal to @id", () => {
    assert.throws(
      () =>
        validateDocumentMap({
          "Task/wrong": {
            "@type": "Task",
            task_key: "right",
            "@id": "Task/right",
          },
        }),
      SchemaValidationError,
    );
  });

  it("rejects invalid documents in the map", () => {
    assert.throws(
      () =>
        validateDocumentMap({
          "Task/t": {
            "@type": "Task",
            task_key: "t",
            freeform: true,
          },
        }),
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
    for (let i = 0; i < 20; i++) {
      edges.set(`n${i}`, new Set([`n${i + 1}`]));
    }
    assert.equal(detectsCycle(edges, "n0", 5), true);
  });
});
