import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseJsonRejectDuplicateKeys,
  canonicalize,
  isCanonicalJsonText,
} from "./canonical-json.js";
import { isCoreFailure } from "./failures.js";

describe("parseJsonRejectDuplicateKeys", () => {
  it("parses simple values", () => {
    assert.equal(parseJsonRejectDuplicateKeys("null"), null);
    assert.equal(parseJsonRejectDuplicateKeys("true"), true);
    assert.equal(parseJsonRejectDuplicateKeys("42"), 42);
    assert.equal(parseJsonRejectDuplicateKeys('"hi"'), "hi");
  });

  it("rejects duplicate keys", () => {
    const result = parseJsonRejectDuplicateKeys('{"a":1,"a":2}');
    assert.ok(isCoreFailure(result));
    assert.equal(result._tag, "DuplicateJsonKey");
  });

  it("rejects nested duplicate keys", () => {
    const result = parseJsonRejectDuplicateKeys('{"o":{"x":1,"x":2}}');
    assert.ok(isCoreFailure(result));
    assert.equal(result._tag, "DuplicateJsonKey");
  });

  it("accepts distinct keys", () => {
    const result = parseJsonRejectDuplicateKeys('{"a":1,"b":2}');
    assert.ok(result && typeof result === "object");
    const obj = result as Record<string, unknown>;
    assert.equal(obj["a"], 1);
    assert.equal(obj["b"], 2);
    assert.equal(Object.getPrototypeOf(obj), null);
  });

  it("rejects deep nesting to prevent range error", () => {
    const text = "[".repeat(60000) + "]".repeat(60000);
    const result = parseJsonRejectDuplicateKeys(text);
    assert.ok(isCoreFailure(result));
    assert.equal(result._tag, "InvalidJson");
  });
});
describe("canonicalize", () => {
  it("sorts object keys", () => {
    assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });

  it("has no insignificant whitespace", () => {
    assert.equal(canonicalize({ a: [1, 2], b: "x" }), '{"a":[1,2],"b":"x"}');
  });
});

describe("isCanonicalJsonText", () => {
  it("accepts sorted compact json", () => {
    assert.equal(isCanonicalJsonText('{"a":1,"b":2}'), true);
  });

  it("rejects whitespace", () => {
    assert.equal(isCanonicalJsonText('{ "a": 1 }'), false);
  });

  it("rejects unsorted keys", () => {
    assert.equal(isCanonicalJsonText('{"b":1,"a":2}'), false);
  });

  it("rejects duplicate keys", () => {
    assert.equal(isCanonicalJsonText('{"a":1,"a":2}'), false);
  });
});

describe("prototype pollution resistance", () => {
  it("keeps __proto__ as own enumerable data key", () => {
    const parsed = parseJsonRejectDuplicateKeys(
      '{"__proto__":{"polluted":true},"x":1}',
    );
    assert.ok(parsed && typeof parsed === "object");
    const obj = parsed as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(obj), null);
    assert.ok(Object.prototype.hasOwnProperty.call(obj, "__proto__"));
    const nested = obj["__proto__"] as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(nested), null);
    assert.equal(nested["polluted"], true);
    assert.equal(obj["x"], 1);
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  });

  it("keeps constructor and prototype as own keys", () => {
    const parsed = parseJsonRejectDuplicateKeys(
      '{"constructor":1,"prototype":2}',
    );
    assert.ok(parsed && typeof parsed === "object");
    const obj = parsed as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(obj), null);
    assert.equal(obj["constructor"], 1);
    assert.equal(obj["prototype"], 2);
  });
});

describe("user _tag values never become parser control flow", () => {
  const CORE_TAGS = [
    "MalformedUtf8",
    "OversizeInput",
    "NonCanonicalJson",
    "DuplicateJsonKey",
    "InvalidJson",
    "UnknownField",
    "SchemaMismatch",
  ] as const;

  it("round-trips nested objects whose values are {_tag: ...}", () => {
    const text = '{"a":{"_tag":"x"}}';
    const parsed = parseJsonRejectDuplicateKeys(text);
    assert.ok(!isCoreFailure(parsed));
    const obj = parsed as Record<string, unknown>;
    assert.equal(typeof obj["a"], "object");
    assert.equal((obj["a"] as Record<string, unknown>)["_tag"], "x");
    assert.equal(canonicalize(parsed), text);
    assert.equal(isCanonicalJsonText(text), true);
  });

  it("round-trips every CoreFailure tag string at root and nested", () => {
    for (const tag of CORE_TAGS) {
      const root = `{"_tag":${JSON.stringify(tag)}}`;
      const rootParsed = parseJsonRejectDuplicateKeys(root);
      assert.ok(
        !isCoreFailure(rootParsed),
        `root tag ${tag} must not be CoreFailure`,
      );
      assert.equal(
        (rootParsed as Record<string, unknown>)["_tag"],
        tag,
      );
      assert.equal(canonicalize(rootParsed), root);

      const nested = `{"outer":{"_tag":${JSON.stringify(tag)},"k":1}}`;
      const nestedParsed = parseJsonRejectDuplicateKeys(nested);
      assert.ok(!isCoreFailure(nestedParsed), `nested tag ${tag}`);
      const outer = (nestedParsed as Record<string, unknown>)[
        "outer"
      ] as Record<string, unknown>;
      assert.equal(outer["_tag"], tag);
      assert.equal(outer["k"], 1);
      assert.equal(canonicalize(nestedParsed), nested);
    }
  });

  it("round-trips OversizeInput-shaped object used as ordinary data", () => {
    const text = '{"_tag":"OversizeInput","maxBytes":1}';
    const parsed = parseJsonRejectDuplicateKeys(text);
    assert.ok(!isCoreFailure(parsed));
    assert.equal((parsed as Record<string, unknown>)["_tag"], "OversizeInput");
    assert.equal((parsed as Record<string, unknown>)["maxBytes"], 1);
  });

  it("still returns branded CoreFailure for invalid JSON syntax", () => {
    const bad = parseJsonRejectDuplicateKeys("{");
    assert.ok(isCoreFailure(bad));
    assert.equal(bad._tag, "InvalidJson");
  });
});
