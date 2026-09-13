import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PelNode, SourceSpan } from "../src/ast.js";
import { planArguments } from "../src/arguments.js";
import { builtinArgSpecs } from "../src/builtins.js";
import { parsePel } from "../src/parser.js";
import type { PelClosureValue, Result } from "../src/types.js";

type CallNode = {
  readonly kind: "call";
  readonly items: readonly PelNode[];
  readonly nodeId: string;
  readonly span: SourceSpan;
};

function parseCall(source: string): CallNode {
  const parsed = parsePel(new TextEncoder().encode(source));
  assert.equal(parsed.ok, true);
  const expression = parsed.value.expressions[0];
  if (expression?.kind !== "call") throw new Error("expected call fixture");
  return expression as CallNode;
}

function closure(
  name: string,
  boundArguments: PelClosureValue["boundArguments"] = {},
): PelClosureValue {
  const argSpec = builtinArgSpecs[name];
  assert.ok(argSpec);
  return {
    tag: "closure",
    nodeId: `builtin:${name}`,
    sourceDigest: "a".repeat(64),
    environmentId: "env",
    callable: { kind: "builtin", name },
    argSpec,
    boundArguments,
    defaults: {},
  };
}

function codeOf(result: Result<unknown, { readonly code: string }>): string {
  assert.equal(result.ok, false);
  return result.error.code;
}

describe("planArguments", () => {
  it("plans positional arguments against remaining declaration order", () => {
    const call = parseCall("(+ 4)");
    const planned = planArguments(
      closure("+", {
        x: { kind: "value", value: { tag: "number", value: 3 } },
      }),
      call.items.slice(1),
      call.span,
    );
    assert.equal(planned.ok, true);
    assert.deepEqual(
      planned.value.map(({ name, node, evaluation }) => ({
        name,
        kind: node.kind,
        evaluation,
      })),
      [{ name: "y", kind: "number", evaluation: "strict" }],
    );
  });

  it("plans named arguments in source order with declared strictness", () => {
    const call = parseCall("(+ :y 2 :x 1)");
    const planned = planArguments(closure("+"), call.items.slice(1), call.span);
    assert.equal(planned.ok, true);
    assert.deepEqual(
      planned.value.map(({ name, node, evaluation }) => ({
        name,
        kind: node.kind,
        evaluation,
      })),
      [
        { name: "y", kind: "number", evaluation: "strict" },
        { name: "x", kind: "number", evaluation: "strict" },
      ],
    );

    const definition = parseCall("(def name value)");
    const syntax = planArguments(
      closure("def"),
      definition.items.slice(1),
      definition.span,
    );
    assert.equal(syntax.ok, true);
    assert.deepEqual(
      syntax.value.map((entry) => entry.evaluation),
      ["syntax", "syntax"],
    );
  });

  it("rejects mixed modes before any argument evaluation", () => {
    const call = parseCall("(+ 1 :y missing)");
    assert.equal(
      codeOf(planArguments(closure("+"), call.items.slice(1), call.span)),
      "PEL_ARGUMENT_MODE",
    );
  });

  it("maps unknown, duplicate, and rebound names to PEL_ARGUMENT_NAME", () => {
    for (const source of ["(+ :z 1)", "(+ :x 1 :x 2)"]) {
      const call = parseCall(source);
      assert.equal(
        codeOf(planArguments(closure("+"), call.items.slice(1), call.span)),
        "PEL_ARGUMENT_NAME",
      );
    }
    const rebound = parseCall("(+ :x 2)");
    assert.equal(
      codeOf(
        planArguments(
          closure("+", {
            x: { kind: "value", value: { tag: "number", value: 1 } },
          }),
          rebound.items.slice(1),
          rebound.span,
        ),
      ),
      "PEL_ARGUMENT_NAME",
    );
  });

  it("maps excess positional arguments to PEL_ARITY", () => {
    const call = parseCall("(sqrt 1 2)");
    assert.equal(
      codeOf(planArguments(closure("sqrt"), call.items.slice(1), call.span)),
      "PEL_ARITY",
    );
  });

  it("treats prototype-shaped parameter names as ordinary unbound names", () => {
    const call = parseCall("(f :toString 1)");
    const custom = closure("sqrt");
    const planned = planArguments(
      {
        ...custom,
        argSpec: {
          kind: "fixed",
          parameters: [
            { name: "toString", required: true, evaluation: "strict" },
          ],
        },
      },
      call.items.slice(1),
      call.span,
    );
    assert.equal(planned.ok, true);
    assert.equal(planned.value[0]?.name, "toString");
  });
});
