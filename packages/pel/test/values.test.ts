import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Hex } from "@foreman/core";
import {
  canonicalPelData,
  decodePelData,
  encodePelData,
  formatPel,
  hashPelData,
  isPelDataValue,
} from "../src/values.js";
import { builtinArgSpecs, callableList, pureBuiltin } from "../src/builtins.js";
import type { PelDataValue, PelValue, Result } from "../src/types.js";

const span = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
} as const;

const nil = { tag: "nil" } as const;
const number = (value: number) => ({ tag: "number", value }) as const;
const string = (value: string) => ({ tag: "string", value }) as const;
const boolean = (value: boolean) => ({ tag: "boolean", value }) as const;
const key = (name: string) => ({ tag: "key", name }) as const;
const pair = (name: string, value: PelValue) =>
  ({ tag: "pair", key: name, value }) as const;
const list = (...items: readonly PelValue[]) =>
  ({ tag: "list", items }) as const;

function valueOf<T, E>(result: Result<T, E>): T {
  assert.equal(result.ok, true);
  return result.value;
}

function errorCode(result: Result<unknown, { readonly code: string }>): string {
  assert.equal(result.ok, false);
  return result.error.code;
}

describe("Pel values", () => {
  it("formats every data tag with deterministic Pel source spelling", () => {
    assert.equal(formatPel(nil), "#nil");
    assert.equal(formatPel(boolean(true)), "#t");
    assert.equal(formatPel(boolean(false)), "#f");
    assert.equal(formatPel(number(-0)), "0");
    assert.equal(formatPel(number(1e21)), "1000000000000000000000");
    assert.equal(formatPel(number(1e-7)), "0.0000001");
    assert.equal(
      formatPel(string('a\n\t"\\\u0001😀')),
      '"a\\n\\t\\"\\\\\\u0001😀"',
    );
    assert.equal(formatPel(key("a")), ":a");
    assert.equal(formatPel(pair("a", number(1))), ":a 1");
    assert.equal(
      formatPel(list(number(1), string("two"), pair("flag", nil))),
      '[1 "two" :flag #nil]',
    );
    assert.equal(formatPel({ tag: "symbol", name: "alpha" }), "'alpha");
  });

  it("formats closures as explicitly non-executable diagnostic text", () => {
    const closure: PelValue = {
      tag: "closure",
      nodeId: "node-1",
      sourceDigest: "a".repeat(64),
      environmentId: "env-1",
      callable: { kind: "builtin", name: "+" },
      argSpec: {
        kind: "fixed",
        parameters: [
          { name: "x", required: true, evaluation: "strict" },
          { name: "y", required: true, evaluation: "strict" },
        ],
      },
      boundArguments: { x: { kind: "value", value: number(1) } },
      defaults: {},
    };
    assert.equal(formatPel(closure), "#<closure:node-1 remaining=y>");
    assert.equal(
      formatPel({
        ...closure,
        nodeId: "sequence",
        argSpec: { kind: "sequence" },
        boundArguments: {},
      }),
      "#<closure:sequence remaining=>",
    );
  });

  it("round-trips canonical tagged JSON and distinguishes pair and list hashes", () => {
    const input = list(
      nil,
      pair("a", number(1)),
      key("雪"),
      string("😀"),
      list(boolean(true)),
    );
    const encoded = valueOf(encodePelData(input));
    assert.deepEqual(valueOf(decodePelData(encoded)), encoded);
    assert.equal(isPelDataValue(encoded), true);

    const canonical = valueOf(canonicalPelData(input));
    assert.equal(
      canonical,
      '{"items":[{"tag":"nil"},{"key":"a","tag":"pair","value":{"tag":"number","value":1}},{"name":"雪","tag":"key"},{"tag":"string","value":"😀"},{"items":[{"tag":"boolean","value":true}],"tag":"list"}],"tag":"list"}',
    );
    assert.equal(valueOf(hashPelData(input)), sha256Hex(canonical));
    assert.notEqual(
      valueOf(hashPelData(pair("a", number(1)))),
      valueOf(hashPelData(list(key("a"), number(1)))),
    );
  });

  it("normalizes negative zero without changing the caller's value", () => {
    const input = number(-0);
    const encoded = valueOf(encodePelData(input));
    assert.equal(
      Object.is(encoded.tag === "number" ? encoded.value : undefined, -0),
      false,
    );
    assert.equal(Object.is(input.value, -0), true);
    assert.equal(
      valueOf(canonicalPelData(input)),
      '{"tag":"number","value":0}',
    );
  });

  it("rejects executable values and malformed host data", () => {
    assert.equal(
      errorCode(encodePelData({ tag: "symbol", name: "x" })),
      "PEL_HOST_RESULT",
    );
    assert.equal(
      errorCode(decodePelData({ tag: "nil", extra: true })),
      "PEL_HOST_RESULT",
    );
    assert.equal(
      errorCode(decodePelData({ tag: "number", value: Infinity })),
      "PEL_HOST_RESULT",
    );
    assert.equal(
      errorCode(
        decodePelData({ tag: "number", value: Number.MAX_SAFE_INTEGER + 1 }),
      ),
      "PEL_HOST_RESULT",
    );
    assert.equal(
      errorCode(decodePelData({ tag: "string", value: "\ud800" })),
      "PEL_HOST_RESULT",
    );
    assert.equal(
      errorCode(decodePelData({ tag: "list", items: [number(1)], extra: 0 })),
      "PEL_HOST_RESULT",
    );
    assert.equal(isPelDataValue({ tag: "closure" }), false);

    const items = [number(1)];
    Object.defineProperty(items, "hidden", { value: true, enumerable: false });
    assert.equal(
      errorCode(decodePelData({ tag: "list", items })),
      "PEL_HOST_RESULT",
    );
  });

  it("rejects cycles rather than recursing indefinitely", () => {
    const cyclic: { tag: string; items: unknown[] } = {
      tag: "list",
      items: [],
    };
    cyclic.items.push(cyclic);
    assert.equal(errorCode(decodePelData(cyclic)), "PEL_HOST_RESULT");
    assert.equal(isPelDataValue(cyclic), false);
  });

  it("turns hostile object inspection into a typed decode failure", () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf(): object {
          throw new Error("hostile proxy");
        },
      },
    );
    assert.doesNotThrow(() => decodePelData(hostile));
    assert.equal(errorCode(decodePelData(hostile)), "PEL_HOST_RESULT");
  });
});

describe("pure builtins", () => {
  it("implements the frozen arithmetic and comparison set", () => {
    assert.deepEqual(
      valueOf(pureBuiltin("+", { x: number(2), y: number(3) }, span)),
      number(5),
    );
    assert.deepEqual(
      valueOf(pureBuiltin("-", { x: number(2), y: number(3) }, span)),
      number(-1),
    );
    assert.deepEqual(
      valueOf(pureBuiltin("*", { x: number(2), y: number(3) }, span)),
      number(6),
    );
    assert.deepEqual(
      valueOf(pureBuiltin("/", { x: number(7), y: number(2) }, span)),
      number(3.5),
    );
    assert.deepEqual(
      valueOf(pureBuiltin("pow", { x: number(2), y: number(8) }, span)),
      number(256),
    );
    assert.deepEqual(
      valueOf(pureBuiltin("sqrt", { x: number(9) }, span)),
      number(3),
    );
    assert.deepEqual(
      valueOf(pureBuiltin("gt", { x: number(3), y: number(2) }, span)),
      boolean(true),
    );
    assert.deepEqual(
      valueOf(pureBuiltin("lt", { x: number(3), y: number(2) }, span)),
      boolean(false),
    );
  });

  it("implements exact utility types and Unicode scalar length", () => {
    assert.deepEqual(
      valueOf(
        pureBuiltin("concat", { x: string("snow "), y: string("雪") }, span),
      ),
      string("snow 雪"),
    );
    assert.deepEqual(
      valueOf(pureBuiltin("len", { value: string("A😀雪") }, span)),
      number(3),
    );
    assert.deepEqual(
      valueOf(pureBuiltin("len", { value: list(number(1), number(2)) }, span)),
      number(2),
    );
    assert.deepEqual(
      valueOf(pureBuiltin("not", { x: boolean(false) }, span)),
      boolean(true),
    );
    assert.equal(
      errorCode(pureBuiltin("concat", { x: string("x"), y: number(1) }, span)),
      "PEL_TYPE",
    );
    assert.equal(errorCode(pureBuiltin("not", { x: nil }, span)), "PEL_TYPE");
  });

  it("supports the fresh single-list plus overload", () => {
    assert.deepEqual(
      valueOf(
        pureBuiltin("+", { x: list(number(1), number(2), number(3)) }, span),
      ),
      number(6),
    );
    assert.deepEqual(valueOf(pureBuiltin("+", { x: list() }, span)), number(0));
    assert.equal(
      errorCode(pureBuiltin("+", { x: list(number(1), string("2")) }, span)),
      "PEL_TYPE",
    );
  });

  it("rejects invalid numeric domains", () => {
    assert.equal(
      errorCode(pureBuiltin("/", { x: number(1), y: number(0) }, span)),
      "PEL_NUMERIC_DOMAIN",
    );
    assert.equal(
      errorCode(pureBuiltin("sqrt", { x: number(-1) }, span)),
      "PEL_NUMERIC_DOMAIN",
    );
    assert.equal(
      errorCode(pureBuiltin("pow", { x: number(10), y: number(400) }, span)),
      "PEL_NUMERIC_DOMAIN",
    );
    assert.equal(
      errorCode(
        pureBuiltin(
          "+",
          { x: number(Number.MAX_SAFE_INTEGER), y: number(1) },
          span,
        ),
      ),
      "PEL_NUMERIC_DOMAIN",
    );
    assert.equal(
      errorCode(pureBuiltin("+", { x: string("1"), y: number(2) }, span)),
      "PEL_TYPE",
    );
  });

  it("compares data structurally and refuses executable closures", () => {
    assert.deepEqual(
      valueOf(
        pureBuiltin(
          "eq",
          { x: list(pair("a", number(1))), y: list(pair("a", number(1))) },
          span,
        ),
      ),
      boolean(true),
    );
    assert.deepEqual(
      valueOf(pureBuiltin("eq", { x: number(1), y: string("1") }, span)),
      boolean(false),
    );

    const closure: PelValue = {
      tag: "closure",
      nodeId: "node",
      sourceDigest: "a".repeat(64),
      environmentId: "env",
      callable: { kind: "builtin", name: "+" },
      argSpec: { kind: "fixed", parameters: [] },
      boundArguments: {},
      defaults: {},
    };
    assert.equal(
      errorCode(pureBuiltin("eq", { x: closure, y: closure }, span)),
      "PEL_TYPE",
    );
    assert.equal(
      errorCode(
        pureBuiltin(
          "eq",
          {
            x: list(number(1), closure),
            y: list(number(2), closure),
          },
          span,
        ),
      ),
      "PEL_TYPE",
    );
  });

  it("compares and formats syntax structurally without source identity", () => {
    const left = {
      kind: "list",
      nodeId: "left",
      span,
      items: [{ kind: "symbol", name: "x", nodeId: "left.0", span }],
    } as const;
    const right = {
      kind: "list",
      nodeId: "right",
      span: { ...span, start: 50, end: 53 },
      items: [
        {
          kind: "symbol",
          name: "x",
          nodeId: "right.0",
          span: { ...span, start: 51, end: 52 },
        },
      ],
    } as const;
    assert.deepEqual(
      valueOf(
        pureBuiltin(
          "eq",
          {
            x: { tag: "syntax", node: left },
            y: { tag: "syntax", node: right },
          },
          span,
        ),
      ),
      boolean(true),
    );
    assert.equal(formatPel({ tag: "syntax", node: left }), "'[x]");
  });
});

describe("callable lists", () => {
  const items = list(number(5), number(6), number(7), number(8));

  it("uses one-based indices and inclusive slices", () => {
    assert.deepEqual(
      valueOf(
        callableList(items.items, { at: number(1), from: nil, to: nil }, span),
      ),
      number(5),
    );
    assert.deepEqual(
      valueOf(
        callableList(
          items.items,
          { at: nil, from: number(1), to: number(3) },
          span,
        ),
      ),
      list(number(5), number(6), number(7)),
    );
    assert.deepEqual(
      valueOf(
        callableList(
          items.items,
          { at: nil, from: number(4), to: number(2) },
          span,
        ),
      ),
      list(),
    );
    assert.deepEqual(
      valueOf(callableList(items.items, { at: nil, from: nil, to: nil }, span)),
      items,
    );
  });

  it("selects numbers and ordered keys with duplicates preserved", () => {
    const association = list(
      pair("a", number(1)),
      pair("b", number(2)),
      pair("a", number(3)),
    );
    assert.deepEqual(
      valueOf(
        callableList(
          association.items,
          { at: key("a"), from: nil, to: nil },
          span,
        ),
      ),
      number(1),
    );
    assert.deepEqual(
      valueOf(
        callableList(
          association.items,
          { at: key("missing"), from: nil, to: nil },
          span,
        ),
      ),
      nil,
    );
    assert.deepEqual(
      valueOf(
        callableList(
          association.items,
          { at: list(key("b"), key("a"), key("b")), from: nil, to: nil },
          span,
        ),
      ),
      list(number(2), number(1), number(2)),
    );
    assert.deepEqual(
      valueOf(
        callableList(
          association.items,
          { at: number(1), from: nil, to: nil },
          span,
        ),
      ),
      pair("a", number(1)),
    );
  });

  it("rejects mixed modes and invalid indices with exact diagnostics", () => {
    assert.equal(
      errorCode(
        callableList(
          items.items,
          { at: number(1), from: number(1), to: nil },
          span,
        ),
      ),
      "PEL_ARGUMENT_MODE",
    );
    for (const invalid of [0, -1, 1.5, 5]) {
      assert.equal(
        errorCode(
          callableList(
            items.items,
            { at: number(invalid), from: nil, to: nil },
            span,
          ),
        ),
        "PEL_INDEX",
      );
    }
    assert.equal(
      errorCode(
        callableList(
          items.items,
          { at: string("1"), from: nil, to: nil },
          span,
        ),
      ),
      "PEL_TYPE",
    );
    assert.equal(
      errorCode(callableList([], { at: nil, from: number(1), to: nil }, span)),
      "PEL_INDEX",
    );
  });
});

describe("builtin argument specifications", () => {
  it("publishes the complete frozen builtin signatures", () => {
    assert.deepEqual(
      Object.keys(builtinArgSpecs).sort(),
      [
        "+",
        "-",
        "*",
        "/",
        "case",
        "concat",
        "def",
        "do",
        "do/async",
        "eq",
        "for",
        "gt",
        "if",
        "lambda",
        "len",
        "list",
        "lt",
        "not",
        "pel/nl-condition",
        "pow",
        "print",
        "sqrt",
      ].sort(),
    );
    assert.deepEqual(builtinArgSpecs["+"]?.kind, "fixed");
    assert.deepEqual(builtinArgSpecs["do"], { kind: "sequence" });
    assert.deepEqual(builtinArgSpecs["do/async"], { kind: "sequence" });
    assert.equal(builtinArgSpecs["toString"], undefined);

    const ifSpec = builtinArgSpecs["if"];
    assert.equal(ifSpec?.kind, "fixed");
    if (ifSpec?.kind === "fixed") {
      assert.deepEqual(
        ifSpec.parameters.map(({ name, required, evaluation }) => ({
          name,
          required,
          evaluation,
        })),
        [
          { name: "cond", required: true, evaluation: "syntax" },
          { name: "then", required: true, evaluation: "syntax" },
          { name: "else", required: false, evaluation: "syntax" },
        ],
      );
      assert.ok(ifSpec.parameters[2]?.defaultExpression);
    }

    const listSpec = builtinArgSpecs["list"];
    assert.equal(listSpec?.kind, "fixed");
    if (listSpec?.kind === "fixed") {
      assert.deepEqual(
        listSpec.parameters.map(({ name, required, evaluation }) => ({
          name,
          required,
          evaluation,
        })),
        [
          { name: "at", required: false, evaluation: "strict" },
          { name: "from", required: false, evaluation: "strict" },
          { name: "to", required: false, evaluation: "strict" },
        ],
      );
      assert.equal(
        listSpec.parameters.every(
          (parameter) => parameter.defaultExpression !== undefined,
        ),
        true,
      );
      assert.equal(
        listSpec.parameters.every((parameter) =>
          Object.isFrozen(parameter.defaultExpression),
        ),
        true,
      );
    }
  });
});
