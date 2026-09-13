import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePel } from "../src/parser.js";
import { PEL_PROFILE, DEFAULT_LIMITS } from "../src/profile.js";
import {
  diagnostic,
  renderPelDiagnostic,
  PEL_DIAGNOSTIC_CODES,
} from "../src/diagnostics.js";
import type { PelNode } from "../src/ast.js";
const bytes = (s: string) => new TextEncoder().encode(s);
function parse(s: string) {
  const result = parsePel(bytes(s));
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function shape(n: PelNode): unknown {
  const { nodeId: _, span: __, ...rest } = n;
  switch (n.kind) {
    case "list":
    case "call":
      return { ...rest, items: n.items.map(shape) };
    case "pair":
      return { ...rest, value: shape(n.value) };
    case "quote":
      return { ...rest, expression: shape(n.expression) };
    case "pipe":
      return { ...rest, left: shape(n.left), right: shape(n.right) };
    default:
      return rest;
  }
}
test("T-M1-001 calls, lists, nil, pair presence and stable identities", () => {
  const p = parse("(+ 1 2) [1 (+ 2 3)] () #nil [:x :y #nil] []");
  assert.equal(p.expressions[0]?.kind, "call");
  assert.equal(p.expressions[1]?.kind, "list");
  assert.equal(p.expressions[2]?.kind, "nil");
  assert.equal(p.expressions[3]?.kind, "nil");
  assert.deepEqual(shape(p.expressions[4]!), {
    kind: "list",
    items: [
      { kind: "pair", key: "x", valuePresent: false, value: { kind: "nil" } },
      { kind: "pair", key: "y", valuePresent: true, value: { kind: "nil" } },
    ],
  });
  assert.deepEqual(shape(p.expressions[5]!), { kind: "list", items: [] });
  assert.deepEqual(parse("x x"), parse("x x"));
  assert.notEqual(
    parse("x x").expressions[0]?.nodeId,
    parse("x x").expressions[1]?.nodeId,
  );
  assert.notEqual(parse("x").sourceDigest, parse("x ;comment").sourceDigest);
});
test("T-M1-001 quotes contain full left-associated pipe chains and disable nested pairs", () => {
  assert.deepEqual(shape(parse("'[ :a [:b 1] ] |> (f)").expressions[0]!), {
    kind: "quote",
    expression: {
      kind: "pipe",
      left: {
        kind: "list",
        items: [
          { kind: "key", name: "a" },
          {
            kind: "list",
            items: [
              { kind: "key", name: "b" },
              { kind: "number", value: 1 },
            ],
          },
        ],
      },
      right: { kind: "call", items: [{ kind: "symbol", name: "f" }] },
    },
  });
  const p = parse("1 |> (f) |> (g)").expressions[0]!;
  assert.equal(p.kind, "pipe");
  if (p.kind === "pipe") assert.equal(p.left.kind, "pipe");
  assert.deepEqual(shape(parse(":x ':a").expressions[0]!), {
    kind: "pair",
    key: "x",
    valuePresent: true,
    value: { kind: "quote", expression: { kind: "key", name: "a" } },
  });
});
test("T-M1-001 exact UTF-8 scalar positions and CRLF", () => {
  const p = parse(';hi\r\n[😀 é]\r\n"\\U0001F600"');
  const list = p.expressions[0]!;
  assert.equal(list.kind, "list");
  if (list.kind === "list") {
    assert.deepEqual(list.items[0]?.span, {
      start: 6,
      end: 10,
      line: 2,
      column: 2,
      endLine: 2,
      endColumn: 3,
    });
    assert.deepEqual(list.items[1]?.span, {
      start: 11,
      end: 13,
      line: 2,
      column: 4,
      endLine: 2,
      endColumn: 5,
    });
  }
  assert.deepEqual(shape(p.expressions[1]!), { kind: "string", value: "😀" });
});
test("T-M1-001 keyword precedence, caret boundaries, constants and string escapes", () => {
  assert.deepEqual(
    parse("':* ':< ':> ':a> ^ - Infinity NaN").expressions.map(shape),
    [
      ...["*", "<", ">", "a>"].map((name) => ({
        kind: "quote",
        expression: { kind: "key", name },
      })),
      { kind: "caret" },
      { kind: "symbol", name: "-" },
      { kind: "symbol", name: "Infinity" },
      { kind: "symbol", name: "NaN" },
    ],
  );
  assert.equal(parse(":a^b").expressions.length, 2);
  assert.deepEqual(parse("#t #f -0 1.25").expressions.map(shape), [
    { kind: "boolean", value: true },
    { kind: "boolean", value: false },
    { kind: "number", value: 0 },
    { kind: "number", value: 1.25 },
  ]);
  assert.deepEqual(
    shape(
      parse('"\\n\\r\\t\\b\\f\\v\\0\\\\\\"\\x41\\u03B1\\U0001F600\n"')
        .expressions[0]!,
    ),
    { kind: "string", value: '\n\r\t\b\f\v\0\\"Aα😀\n' },
  );
});
test("T-M1-002 invalid lexical and grammatical inputs yield no program", () => {
  for (const s of [
    "^>",
    "#true",
    "1e5",
    "9007199254740992",
    "99999999999999999999999.1",
    "a>b",
    ">b",
    "x ▷ (f)",
    "|",
    ":",
    '"\\q"',
    '"\\uD800"',
    '"\\U00110000"',
    '"\\x0"',
    '"unterminated',
  ]) {
    const r = parsePel(bytes(s));
    assert.equal(r.ok, false, s);
    if (!r.ok) {
      assert.equal(r.error[0]?.code, "PEL_LEX", s);
      assert.ok(r.error[0]!.span.end > r.error[0]!.span.start, s);
    }
  }
  for (const s of ["(", "[", "(]", "]", "'", "1 |>"]) {
    const r = parsePel(bytes(s));
    assert.equal(r.ok, false, s);
    if (!r.ok) assert.equal(r.error[0]?.code, "PEL_PARSE", s);
  }
  const invalid = parsePel(Uint8Array.of(0x61, 0x20, 0xf0, 0x80, 0x80, 0x80));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error[0]?.span.start, 2);
  const glyph = parsePel(bytes("x ▷ (f)"));
  if (!glyph.ok) assert.match(glyph.error[0]?.help ?? "", /\|>/);
});
test("T-M1-011 parser bounds fail at the consumed resource", () => {
  for (const [name, s, bound] of [
    ["maxSourceBytes", "😀", 3],
    ["maxTokens", "a b", 1],
    ["maxAstNodes", "[1 2]", 2],
    ["maxSyntaxDepth", "[[1]]", 1],
  ] as const) {
    const r = parsePel(bytes(s), {
      ...PEL_PROFILE,
      limits: { ...DEFAULT_LIMITS, [name]: bound },
    });
    assert.equal(r.ok, false, name);
    if (!r.ok) {
      assert.equal(r.error[0]?.code, "PEL_LIMIT");
      assert.equal(r.error[0]?.bound, name);
      assert.ok((r.error[0]?.consumed ?? 0) > bound);
    }
  }
  assert.ok(
    parsePel(bytes("[1]"), {
      ...PEL_PROFILE,
      limits: { ...DEFAULT_LIMITS, maxSyntaxDepth: 1 },
    }).ok,
  );
  assert.equal(parse("").expressions.length, 0);
  assert.ok(Object.isFrozen(PEL_PROFILE));
  assert.ok(Object.isFrozen(DEFAULT_LIMITS));
});
test("T-M1-010 diagnostics render precise source and applicable signature", () => {
  const source = bytes('1\n(print ["hello" name] :sep " ")');
  const span = parse(new TextDecoder().decode(source)).expressions[1]!.span;
  const d = diagnostic("PEL_ARGUMENT_MODE", span, "Mixed argument modes", {
    signature: ':vals :sep "" :nl #f',
    help: 'Use (print :vals ["hello" name] :sep " ")',
  });
  const text = renderPelDiagnostic(source, d);
  assert.match(text, /PEL_ARGUMENT_MODE/);
  assert.match(text, /2:/);
  assert.match(text, /\^+/);
  assert.match(text, /:vals :sep/);
  assert.match(text, /Use \(print :vals/);
  assert.ok(PEL_DIAGNOSTIC_CODES.includes("PEL_HOST_FAILURE"));
  assert.ok(PEL_DIAGNOSTIC_CODES.includes("PEL_REGISTRY"));
});
test("numeric range checks precede decimal rounding", () => {
  for (const s of [
    "9007199254740991.1",
    "-9007199254740991.1",
    "9007199254740992.0",
  ]) {
    const r = parsePel(bytes(s));
    assert.equal(r.ok, false, s);
    if (!r.ok) assert.equal(r.error[0]?.code, "PEL_LEX");
  }
  assert.ok(parsePel(bytes("9007199254740991.0")).ok);
});
test("explicit higher syntax bounds do not depend on the JavaScript call stack", () => {
  const depth = 4000;
  const source = "[".repeat(depth) + "1" + "]".repeat(depth);
  const r = parsePel(bytes(source), {
    ...PEL_PROFILE,
    limits: { ...DEFAULT_LIMITS, maxSyntaxDepth: depth },
  });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.syntaxDepthPeak, depth);
});
test("T-M1-002 lexical failures mark exact bytes and scalar columns", () => {
  for (const [source, start, end, line, column, endColumn] of [
    ["é >", 3, 4, 1, 3, 4],
    ["a>b", 1, 2, 1, 2, 3],
    ["^>", 1, 2, 1, 2, 3],
    ["\r\n#true", 2, 7, 2, 1, 6],
    ["x ▷ (f)", 2, 5, 1, 3, 4],
    ["1e5", 0, 3, 1, 1, 4],
  ] as const) {
    const r = parsePel(bytes(source));
    assert.equal(r.ok, false);
    if (!r.ok)
      assert.deepEqual(r.error[0]?.span, {
        start,
        end,
        line,
        column,
        endLine: line,
        endColumn,
      });
  }
  const r = parsePel(Uint8Array.of(0xc3, 0xa9, 0x0d, 0x0a, 0xff));
  assert.equal(r.ok, false);
  if (!r.ok)
    assert.deepEqual(r.error[0]?.span, {
      start: 4,
      end: 5,
      line: 2,
      column: 1,
      endLine: 2,
      endColumn: 2,
    });
});
test("AST limits count normalized nodes and exact-bound admission succeeds", () => {
  const source = ":a :b #nil [1]";
  const p = parse(source);
  const pending = [...p.expressions];
  let count = 0;
  const identities = new Set<string>();
  while (pending.length) {
    const n = pending.pop()!;
    count++;
    identities.add(n.nodeId);
    if (n.kind === "pair") pending.push(n.value);
    if (n.kind === "list" || n.kind === "call") pending.push(...n.items);
  }
  assert.equal(p.astNodes, count);
  assert.equal(identities.size, count);
  assert.ok(
    parsePel(bytes(source), {
      ...PEL_PROFILE,
      limits: {
        ...DEFAULT_LIMITS,
        maxSourceBytes: p.sourceBytes,
        maxTokens: p.tokens,
        maxAstNodes: p.astNodes,
        maxSyntaxDepth: p.syntaxDepthPeak,
      },
    }).ok,
  );
  assert.equal(
    parsePel(bytes("1"), {
      ...PEL_PROFILE,
      limits: { ...DEFAULT_LIMITS, maxSyntaxDepth: Number.POSITIVE_INFINITY },
    }).ok,
    false,
  );
});
