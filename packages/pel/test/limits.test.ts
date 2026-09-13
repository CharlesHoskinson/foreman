import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePel } from "../src/parser.js";
import { createHostRegistry } from "../src/host-contract.js";
import { startPel, createPelEnvironment, resumePel } from "../src/evaluator.js";
import { DEFAULT_LIMITS } from "../src/profile.js";
function setup(source: string) {
  const p = parsePel(new TextEncoder().encode(source));
  assert.ok(p.ok);
  const r = createHostRegistry();
  assert.ok(r.ok);
  return { program: p.value, registry: r.value };
}
test("R-M1-010 diagnostics retain precise source spans", () => {
  const { program, registry } = setup("(len 1)");
  const step = startPel(program, createPelEnvironment(registry));
  assert.equal(step.tag, "failed");
  if (step.tag === "failed") {
    assert.equal(step.diagnostic.code, "PEL_TYPE");
    assert.deepEqual(step.diagnostic.span, program.expressions[0]!.span);
    assert.ok(Array.isArray(step.diagnostic.expectedForms));
  }
});
test("R-M1-011 fuel, iteration, depth and value bounds stop before effect release", () => {
  for (const [source, limit] of [
    ["(for [1 2] x (print x))", { maxIterations: 0 }],
    ['(print "large")', { maxValueBytes: 2 }],
    ["(def f (lambda [] (f))) (f)", { maxCallDepth: 3 }],
    ["(print 1)", { maxReductions: 0 }],
  ] as const) {
    const { program, registry } = setup(source);
    const step = startPel(program, createPelEnvironment(registry), {
      ...DEFAULT_LIMITS,
      ...limit,
    });
    assert.equal(step.tag, "failed");
    if (step.tag === "failed") {
      assert.equal(step.diagnostic.code, "PEL_LIMIT");
      assert.equal(Object.keys(step.continuation.pending).length, 0);
    }
  }
});
test("R-M1-011 resume retains consumed fuel and limit", () => {
  const { program, registry } = setup("(print 1) (+ 2 3)");
  const first = startPel(program, createPelEnvironment(registry), {
    ...DEFAULT_LIMITS,
    maxReductions: 4,
  });
  assert.equal(first.tag, "suspend");
  if (first.tag !== "suspend") return;
  const step = resumePel(program, registry, first.continuation, [
    {
      requestId: first.ready[0].requestId,
      outcome: { tag: "success", value: { tag: "number", value: 1 } },
    },
  ]);
  assert.equal(step.tag, "failed");
  if (step.tag === "failed") {
    assert.equal(step.diagnostic.code, "PEL_LIMIT");
    assert.equal(step.counters.reductions, 4);
  }
});
