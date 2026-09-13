import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePel } from "../src/parser.js";
import { createHostRegistry } from "../src/host-contract.js";
import * as pel from "../src/evaluator.js";
import { DEFAULT_LIMITS } from "../src/profile.js";
import type { PelClosureValue } from "../src/types.js";
function parent() {
  const p = parsePel(
    new TextEncoder().encode("(print (lambda [:x] (print x)))"),
  );
  assert.ok(p.ok);
  const r = createHostRegistry();
  assert.ok(r.ok);
  const step = pel.startPel(p.value, pel.createPelEnvironment(r.value));
  assert.equal(step.tag, "suspend");
  if (step.tag !== "suspend") throw Error("suspend");
  return {
    program: p.value,
    registry: r.value,
    step,
    closure: step.ready[0].boundArguments.vals as PelClosureValue,
  };
}
test("R-M1-016 child closures retain lexical data and attempt-specific identities", () => {
  assert.equal(typeof pel.evaluateClosure, "function");
  const { program, registry, step, closure } = parent();
  const table = pel.extractClosureEnvironment(step.continuation, closure);
  assert.ok(table.ok);
  const ids = [];
  for (const attempt of [1, 2]) {
    const child = pel.evaluateClosure(closure, [{ tag: "number", value: 4 }], {
      program,
      registry,
      sourceDigest: program.sourceDigest,
      profileDigest: program.profileDigest,
      registryDigest: registry.digest,
      parentRequestId: step.ready[0].requestId,
      childInvocationId: `${step.ready[0].requestId}/retry/${attempt}`,
      environmentTable: table.value,
      limits: DEFAULT_LIMITS,
      options: pel.DEFAULT_RUN_OPTIONS,
      optionsDigest: pel.digest(pel.DEFAULT_RUN_OPTIONS),
    });
    assert.equal(child.tag, "suspend");
    if (child.tag === "suspend") {
      ids.push(child.ready[0].requestId);
      assert.ok(child.ready[0].invocationPath.includes(`/retry/${attempt}/`));
    }
  }
  assert.notEqual(ids[0], ids[1]);
});
test("R-M1-016 child merge charges once and preserves final failure", () => {
  const { step } = parent();
  const requestId = step.ready[0].requestId;
  const id = `${requestId}/race/1`;
  const counters = { ...step.counters, reductions: 3, iterations: 2 };
  const failure = { code: "timeout", message: "bounded timeout" };
  const merged = pel.mergeClosureResult(
    step.continuation,
    id,
    { requestId, outcome: { tag: "failure", failure } },
    counters,
  );
  assert.equal(merged.tag, "failed");
  if (merged.tag === "failed") {
    assert.equal(merged.counters.reductions, step.counters.reductions + 3);
    assert.deepEqual(merged.diagnostic.hostFailure, failure);
    const duplicate = pel.mergeClosureResult(
      merged.continuation,
      id,
      { requestId, outcome: { tag: "failure", failure } },
      counters,
    );
    assert.equal(duplicate.tag, "failed");
    assert.equal(duplicate.counters.reductions, merged.counters.reductions);
  }
});

test("over-limit child work remains charged in the failed parent continuation", () => {
  const { step } = parent();
  const c = structuredClone(step.continuation);
  c.registry = step.continuation.registry;
  c.limits = { ...c.limits, maxReductions: c.counters.reductions + 1 };
  const consumed = { ...c.counters, reductions: 3, iterations: 0 };
  const requestId = step.ready[0].requestId;
  const merged = pel.mergeClosureResult(
    c,
    `${requestId}/retry/1`,
    {
      requestId,
      outcome: { tag: "success", value: { tag: "number", value: 1 } },
    },
    consumed,
  );
  assert.equal(merged.tag, "failed");
  assert.equal(merged.counters.reductions, c.counters.reductions + 3);
});
