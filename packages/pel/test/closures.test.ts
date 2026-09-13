import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePel } from "../src/parser.js";
import { createHostRegistry } from "../src/host-contract.js";
import { startPel, createPelEnvironment } from "../src/evaluator.js";
import { formatPel } from "../src/values.js";
function run(source: string) {
  const parsed = parsePel(new TextEncoder().encode(source));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw Error("parse");
  const registry = createHostRegistry();
  assert.equal(registry.ok, true);
  if (!registry.ok) throw Error("registry");
  return startPel(parsed.value, createPelEnvironment(registry.value));
}
function value(source: string, expected: string) {
  const step = run(source);
  assert.equal(step.tag, "done", JSON.stringify(step));
  if (step.tag === "done") assert.equal(formatPel(step.value), expected);
}
function error(source: string, expected: string) {
  const step = run(source);
  assert.equal(step.tag, "failed");
  if (step.tag === "failed") assert.equal(step.diagnostic.code, expected);
}
test("R-M1-005 lexical closures, defaults, partial calls and recursion", () => {
  value("(def add (lambda [:x :y 2] (+ x y))) (add 3)", "5");
  value("(def sub (- 10)) (sub 3)", "7");
  value("(def f (lambda [:x #nil :y] [x y])) (f :y 3)", "[#nil 3]");
  value("(def n 5) (def f (lambda [] n)) (do (def n 9) (f))", "5");
  value(
    "(def fact (lambda [:n] (if (lt n 2) 1 (* n (fact (- n 1)))))) (fact 5)",
    "120",
  );
  error("(def f (lambda [] later)) (def later 2) (f)", "PEL_UNBOUND_SYMBOL");
  error("(def x x)", "PEL_UNINITIALIZED_BINDING");
  error("(def x 1) (def x 2)", "PEL_DUPLICATE_BINDING");
});
test("R-M1-006 binding checks precede evaluation and preserve partial syntax", () => {
  error("(+ :x missing 2)", "PEL_ARGUMENT_MODE");
  error("(+ :bad missing)", "PEL_ARGUMENT_NAME");
  error("(+ 1 2 3)", "PEL_ARITY");
  value("(def bind (def result)) (bind (+ 1 2)) result", "3");
  value("(def f (lambda [:x :y] (+ x y))) (def p (f :y 2)) (p 3)", "5");
  error("(def p (+ :x 1)) (p :x missing)", "PEL_ARGUMENT_NAME");
});
test("case invokes a produced closure once before requiring Boolean", () => {
  error(
    "(def condition (lambda [:x :y] #t)) (case 1 [condition 3 #t 4])",
    "PEL_TYPE",
  );
});
