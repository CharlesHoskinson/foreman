import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PelProgram } from "../src/ast.js";
import {
  chargeClosureConsumption,
  createPelEnvironment,
  DEFAULT_RUN_OPTIONS,
  digest,
  evaluateClosure,
  extractClosureEnvironment,
  mergeClosureResult,
  resumePel,
  startPel,
  type ClosureEvaluationContextV1,
} from "../src/evaluator.js";
import { createHostRegistry } from "../src/host-contract.js";
import { parsePel } from "../src/parser.js";
import { DEFAULT_LIMITS } from "../src/profile.js";
import { validateRevisionPrefix } from "../src/revision.js";
import type { PelClosureValue } from "../src/types.js";

function program(source: string): PelProgram {
  const parsed = parsePel(new TextEncoder().encode(source));
  assert.equal(parsed.ok, true);
  return parsed.value;
}

function suspendedParent() {
  const source = program("(print (lambda [:x] (print x)))");
  const registry = createHostRegistry();
  assert.equal(registry.ok, true);
  const step = startPel(source, createPelEnvironment(registry.value));
  assert.equal(step.tag, "suspend");
  if (step.tag !== "suspend") throw new Error("expected parent suspension");
  const closure = step.ready[0].boundArguments.vals as PelClosureValue;
  const environmentTable = extractClosureEnvironment(
    step.continuation,
    closure,
  );
  assert.equal(environmentTable.ok, true);
  const context = (
    kind: "retry" | "race",
    index: number,
  ): ClosureEvaluationContextV1 => ({
    program: source,
    registry: registry.value,
    sourceDigest: source.sourceDigest,
    profileDigest: source.profileDigest,
    registryDigest: registry.value.digest,
    parentRequestId: step.ready[0].requestId,
    childInvocationId: `${step.ready[0].requestId}/${kind}/${index}`,
    environmentTable: environmentTable.value,
    limits: DEFAULT_LIMITS,
    options: DEFAULT_RUN_OPTIONS,
    optionsDigest: digest(DEFAULT_RUN_OPTIONS),
  });
  return { source, registry: registry.value, step, closure, context };
}

describe("child evaluation boundaries", () => {
  it("rejects a closure that is not referenced by the parent continuation", () => {
    const fixture = suspendedParent();
    const forged = {
      ...fixture.closure,
      nodeId: `${fixture.closure.nodeId}/forged`,
    };
    const extracted = extractClosureEnvironment(
      fixture.step.continuation,
      forged,
    );
    assert.equal(extracted.ok, false);
    if (!extracted.ok)
      assert.equal(extracted.error.code, "PEL_CONTINUATION_MISMATCH");
  });

  it("rejects an attempt-one nested receipt in attempt two", () => {
    const fixture = suspendedParent();
    const first = evaluateClosure(
      fixture.closure,
      [{ tag: "number", value: 1 }],
      fixture.context("retry", 1),
    );
    const second = evaluateClosure(
      fixture.closure,
      [{ tag: "number", value: 1 }],
      fixture.context("retry", 2),
    );
    assert.equal(first.tag, "suspend");
    assert.equal(second.tag, "suspend");
    if (first.tag !== "suspend" || second.tag !== "suspend") return;
    const foreign = resumePel(
      fixture.source,
      fixture.registry,
      second.continuation,
      [
        {
          requestId: first.ready[0].requestId,
          outcome: { tag: "success", value: { tag: "number", value: 1 } },
        },
      ],
      DEFAULT_RUN_OPTIONS,
    );
    assert.equal(foreign.tag, "failed");
    if (foreign.tag === "failed")
      assert.equal(foreign.diagnostic.code, "PEL_HOST_RESULT");
  });

  it("rejects executable child results at the host-library merge boundary", () => {
    const fixture = suspendedParent();
    const invocationId = `${fixture.step.ready[0].requestId}/race/1`;
    const merged = mergeClosureResult(
      fixture.step.continuation,
      invocationId,
      {
        requestId: fixture.step.ready[0].requestId,
        outcome: { tag: "success", value: fixture.closure as never },
      },
      { ...fixture.step.counters, reductions: 1, iterations: 0 },
    );
    assert.equal(merged.tag, "failed");
    if (merged.tag === "failed")
      assert.equal(merged.diagnostic.code, "PEL_HOST_RESULT");
  });

  it("validates every child context binding before evaluation", () => {
    const fixture = suspendedParent();
    const base = fixture.context("retry", 1);
    const changedOptions = {
      ...DEFAULT_RUN_OPTIONS,
      dependencyMode: "automatic" as const,
    };
    const variants: ClosureEvaluationContextV1[] = [
      { ...base, sourceDigest: "0".repeat(64) },
      { ...base, profileDigest: "0".repeat(64) },
      { ...base, registryDigest: "0".repeat(64) },
      { ...base, optionsDigest: "0".repeat(64) },
      {
        ...base,
        options: changedOptions,
        optionsDigest: digest(changedOptions),
      },
      { ...base, childInvocationId: `${base.parentRequestId}/retry/0` },
    ];
    for (const context of variants) {
      const child = evaluateClosure(fixture.closure, [], context);
      assert.equal(child.tag, "failed");
      if (child.tag === "failed")
        assert.equal(child.diagnostic.code, "PEL_CONTINUATION_MISMATCH");
    }
  });

  it("rejects completed-prefix replay options for an ordinary child invocation", () => {
    const fixture = suspendedParent();
    const base = fixture.context("retry", 1);
    const zeroCounters = {
      sourceBytes: 0,
      tokens: 0,
      astNodes: 0,
      syntaxDepthPeak: 0,
      reductions: 0,
      iterations: 0,
      callDepthPeak: 0,
      valueBytesPeak: 0,
    };
    const options = {
      ...DEFAULT_RUN_OPTIONS,
      replay: {
        mode: "completed-prefix" as const,
        completedPrefixCount: 0,
        prefixDigest: digest([]),
        recordedCounters: zeroCounters,
        committedCounters: zeroCounters,
        maxReplayReductions: 0,
      },
    };
    const optionsDigest = digest(options);
    const child = evaluateClosure(fixture.closure, [], {
      ...base,
      options,
      optionsDigest,
      environmentTable: { ...base.environmentTable, optionsDigest },
    });
    assert.equal(child.tag, "failed");
    if (child.tag === "failed")
      assert.equal(child.diagnostic.code, "PEL_CONTINUATION_MISMATCH");
  });

  it("charges abandoned children once and enforces the aggregate envelope", () => {
    const fixture = suspendedParent();
    const invocationId = `${fixture.step.ready[0].requestId}/race/1`;
    const consumed = { ...fixture.step.counters, reductions: 1, iterations: 1 };
    const charged = chargeClosureConsumption(
      fixture.step.continuation,
      invocationId,
      consumed,
    );
    assert.equal(charged.ok, true);
    assert.equal(
      charged.value.counters.reductions,
      fixture.step.counters.reductions + 1,
    );
    const duplicate = chargeClosureConsumption(
      charged.value,
      invocationId,
      consumed,
    );
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok)
      assert.equal(duplicate.error.code, "PEL_CONTINUATION_MISMATCH");

    const exhausted = {
      ...fixture.step.continuation,
      limits: {
        ...fixture.step.continuation.limits,
        maxReductions: fixture.step.counters.reductions,
      },
    };
    const overLimit = chargeClosureConsumption(
      exhausted,
      `${fixture.step.ready[0].requestId}/race/2`,
      consumed,
    );
    assert.equal(overLimit.ok, false);
    if (!overLimit.ok) assert.equal(overLimit.error.code, "PEL_LIMIT");
  });
});

describe("completed-prefix replay boundaries", () => {
  it("rejects changed resume bindings and restores the failed-suffix counter", () => {
    const registry = createHostRegistry();
    assert.equal(registry.ok, true);
    const oldProgram = program("(print [1]) missing");
    const initial = startPel(oldProgram, createPelEnvironment(registry.value));
    assert.equal(initial.tag, "suspend");
    if (initial.tag !== "suspend") return;
    const recordedCounters = initial.counters;
    const oldRequest = initial.ready[0];
    const failed = resumePel(oldProgram, registry.value, initial.continuation, [
      {
        requestId: oldRequest.requestId,
        outcome: {
          tag: "success",
          value: oldRequest.boundArguments.vals as never,
        },
      },
    ]);
    assert.equal(failed.tag, "failed");
    if (failed.tag !== "failed") return;

    const revisedProgram = program("(print [1]) 0");
    const mapping = validateRevisionPrefix(oldProgram, revisedProgram, 1, [
      {
        oldRequestId: oldRequest.requestId,
        nodeId: oldRequest.nodeId,
        invocationPath: oldRequest.invocationPath,
        boundArguments: oldRequest.boundArguments,
      },
    ]);
    assert.equal(mapping.ok, true);
    const options = {
      ...DEFAULT_RUN_OPTIONS,
      replay: {
        mode: "completed-prefix" as const,
        completedPrefixCount: 1,
        prefixDigest: mapping.value.prefixDigest,
        recordedCounters,
        committedCounters: failed.counters,
        maxReplayReductions: recordedCounters.reductions,
      },
    };
    const replay = startPel(
      revisedProgram,
      createPelEnvironment(registry.value),
      DEFAULT_LIMITS,
      options,
    );
    assert.equal(replay.tag, "suspend");
    if (replay.tag !== "suspend") return;
    assert.equal(replay.counters.reductions, 0);

    const changedOptions = { ...options, dependencyMode: "automatic" as const };
    const mismatched = resumePel(
      revisedProgram,
      registry.value,
      replay.continuation,
      [],
      changedOptions,
    );
    assert.equal(mismatched.tag, "failed");
    if (mismatched.tag === "failed")
      assert.equal(mismatched.diagnostic.code, "PEL_CONTINUATION_MISMATCH");

    const done = resumePel(
      revisedProgram,
      registry.value,
      replay.continuation,
      [
        {
          requestId: replay.ready[0].requestId,
          outcome: {
            tag: "success",
            value: replay.ready[0].boundArguments.vals as never,
          },
        },
      ],
      options,
    );
    assert.equal(done.tag, "done");
    assert.equal(done.counters.reductions, failed.counters.reductions + 1);
    assert.equal(done.counters.iterations, failed.counters.iterations);
  });
});
