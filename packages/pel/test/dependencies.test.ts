import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PelProgram } from "../src/ast.js";
import { analyzeDependencies, analyzeSequence } from "../src/dependencies.js";
import { parsePel } from "../src/parser.js";

function program(source: string): PelProgram {
  const parsed = parsePel(new TextEncoder().encode(source));
  assert.equal(parsed.ok, true);
  return parsed.value;
}

describe("dependency analysis", () => {
  it("links forward reads to their defining source expression", () => {
    const analysis = analyzeDependencies(
      program("(consume later)\n(def later 7)\n(independent)"),
    );
    assert.deepEqual(analysis.expressions, [
      { index: 0, defines: [], reads: ["consume", "later"], dependencies: [1] },
      { index: 1, defines: ["later"], reads: [], dependencies: [] },
      { index: 2, defines: [], reads: ["independent"], dependencies: [] },
    ]);
    assert.deepEqual(analysis.cycles, []);
  });

  it("reports stable strongly connected dependency cycles", () => {
    const analysis = analyzeDependencies(
      program("(def a b)\n(def b c)\n(def c a)"),
    );
    assert.deepEqual(
      analysis.expressions.map((entry) => entry.dependencies),
      [[1], [2], [0]],
    );
    assert.deepEqual(analysis.cycles, [[0, 1, 2]]);
  });

  it("tracks lambda defaults while excluding parameters and recursive capture", () => {
    const analysis = analyzeDependencies(
      program(
        "(def outside 1)\n(def f (lambda [:x :y outside] (+ x y outside f)))",
      ),
    );
    assert.deepEqual(analysis.expressions[1], {
      index: 1,
      defines: ["f"],
      reads: ["outside", "+"],
      dependencies: [0],
    });
    assert.deepEqual(analysis.cycles, []);
  });

  it("honors for binders and quotation boundaries", () => {
    const analysis = analyzeDependencies(
      program(
        "(def outside 1)\n(for coll item (use item outside))\n'(def ghost outside)",
      ),
    );
    assert.deepEqual(analysis.expressions[1]?.reads, [
      "coll",
      "use",
      "outside",
    ]);
    assert.deepEqual(analysis.expressions[1]?.dependencies, [0]);
    assert.deepEqual(analysis.expressions[2]?.reads, []);
  });

  it("analyzes async block sequences with local forward definitions", () => {
    const outer = program("(do/async [(use later) (def later source)])");
    const expression = outer.expressions[0];
    assert.equal(expression?.kind, "call");
    const body = expression.items[1];
    assert.equal(body?.kind, "list");
    const inner = analyzeSequence(body.items);
    assert.deepEqual(inner.expressions, [
      { index: 0, defines: [], reads: ["use", "later"], dependencies: [1] },
      { index: 1, defines: ["later"], reads: ["source"], dependencies: [] },
    ]);
    assert.deepEqual(inner.cycles, []);

    const outerAnalysis = analyzeDependencies(outer);
    assert.deepEqual(outerAnalysis.expressions[0]?.reads, ["use", "source"]);
  });

  it("leaves direct self reads runnable for uninitialized-binding diagnosis", () => {
    const analysis = analyzeDependencies(program("(def x x)"));
    assert.deepEqual(analysis.expressions[0], {
      index: 0,
      defines: ["x"],
      reads: ["x"],
      dependencies: [],
    });
    assert.deepEqual(analysis.cycles, []);
  });

  it("recognizes named syntax arguments for dependency-owning builtins", () => {
    const analysis = analyzeDependencies(
      program(
        "(use later)\n(def :value source :name later)\n(for :body (consume item outer) :iterator item :coll coll)",
      ),
    );
    assert.deepEqual(analysis.expressions[0]?.dependencies, [1]);
    assert.deepEqual(analysis.expressions[1], {
      index: 1,
      defines: ["later"],
      reads: ["source"],
      dependencies: [],
    });
    assert.deepEqual(analysis.expressions[2]?.reads, [
      "coll",
      "consume",
      "outer",
    ]);
  });
});
