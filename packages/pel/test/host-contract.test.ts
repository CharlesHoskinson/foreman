import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePel } from "../src/parser.js";
import { createHostRegistry } from "../src/host-contract.js";
import {
  startPel,
  createPelEnvironment,
  resumePel,
  DEFAULT_RUN_OPTIONS,
} from "../src/evaluator.js";
function setup(source: string) {
  const p = parsePel(new TextEncoder().encode(source));
  assert.ok(p.ok);
  const r = createHostRegistry();
  assert.ok(r.ok);
  return { program: p.value, registry: r.value };
}
test("R-M1-012 host values remain data and partial host calls do not emit", () => {
  const { program, registry } = setup("(print)");
  assert.equal(startPel(program, createPelEnvironment(registry)).tag, "done");
  const q = setup("(def x [1 2]) (print x)");
  const first = startPel(q.program, createPelEnvironment(q.registry));
  assert.equal(first.tag, "suspend");
  if (first.tag !== "suspend") return;
  const result = resumePel(q.program, q.registry, first.continuation, [
    {
      requestId: first.ready[0].requestId,
      outcome: {
        tag: "success",
        value: { tag: "symbol", name: "attack" } as never,
      },
    },
  ]);
  assert.equal(result.tag, "failed");
  if (result.tag === "failed")
    assert.equal(result.diagnostic.code, "PEL_HOST_RESULT");
});
test("R-M1-014 partial receipt sets preserve emission flags and source ordering", () => {
  const { program, registry } = setup("(do/async (print 1) (print 2))");
  const first = startPel(program, createPelEnvironment(registry));
  assert.equal(first.tag, "suspend");
  if (first.tag !== "suspend") return;
  assert.equal(first.ready.length, 2);
  assert.ok(first.ready.every((r) => !r.alreadyEmitted));
  const empty = resumePel(program, registry, first.continuation, []);
  assert.equal(empty.tag, "suspend");
  if (empty.tag === "suspend")
    assert.ok(empty.ready.every((r) => r.alreadyEmitted));
  const second = resumePel(program, registry, first.continuation, [
    {
      requestId: first.ready[1]!.requestId,
      outcome: { tag: "success", value: { tag: "number", value: 2 } },
    },
  ]);
  assert.equal(second.tag, "suspend");
  if (second.tag !== "suspend") return;
  assert.equal(second.ready.length, 1);
  assert.equal(second.ready[0].alreadyEmitted, true);
  const done = resumePel(program, registry, second.continuation, [
    {
      requestId: second.ready[0].requestId,
      outcome: { tag: "success", value: { tag: "number", value: 1 } },
    },
  ]);
  assert.equal(done.tag, "done");
  if (done.tag === "done")
    assert.deepEqual(done.value, { tag: "number", value: 2 });
});
test("R-M1-014/R-M1-015 receipt validation is atomic and failure preserves siblings", () => {
  const { program, registry } = setup("(do/async (print 1) (print 2))");
  const first = startPel(program, createPelEnvironment(registry));
  assert.equal(first.tag, "suspend");
  if (first.tag !== "suspend") return;
  const good = {
    requestId: first.ready[0].requestId,
    outcome: {
      tag: "success" as const,
      value: { tag: "number" as const, value: 1 },
    },
  };
  const bad = resumePel(program, registry, first.continuation, [good, good]);
  assert.equal(bad.tag, "failed");
  if (bad.tag === "failed") {
    assert.equal(bad.diagnostic.code, "PEL_HOST_RESULT");
    assert.equal(Object.keys(bad.continuation.pending).length, 2);
    assert.equal(bad.continuation.completed.length, 0);
  }
  const failure = {
    code: "provider-failure",
    message: "no response",
    cause: { provider: "fixture", status: 503 },
  };
  const failed = resumePel(program, registry, first.continuation, [
    {
      requestId: first.ready[0].requestId,
      outcome: { tag: "failure", failure },
    },
  ]);
  assert.equal(failed.tag, "failed");
  if (failed.tag === "failed") {
    assert.deepEqual(failed.diagnostic.hostFailure, failure);
    assert.equal(Object.keys(failed.continuation.pending).length, 1);
  }
});
test("R-M1-014 changed source and options cannot resume", () => {
  const { program, registry } = setup("(print 1)");
  const first = startPel(program, createPelEnvironment(registry));
  assert.equal(first.tag, "suspend");
  if (first.tag !== "suspend") return;
  for (const [p, o] of [
    [{ ...program, sourceDigest: "different" }, DEFAULT_RUN_OPTIONS],
    [program, { ...DEFAULT_RUN_OPTIONS, dependencyMode: "automatic" as const }],
  ] as const) {
    const bad = resumePel(p, registry, first.continuation, [], o);
    assert.equal(bad.tag, "failed");
    if (bad.tag === "failed")
      assert.equal(bad.diagnostic.code, "PEL_CONTINUATION_MISMATCH");
  }
});

import { validateRevisionPrefix } from "../src/revision.js";
import { DEFAULT_LIMITS } from "../src/profile.js";
test("T-M1-020 revised prefix reuses two receipts and retains 14 failed-step reductions", () => {
  const old = setup("(print [1 2]) (print [3 4]) (+ 1 missing)");
  let step = startPel(old.program, createPelEnvironment(old.registry));
  const recorded = [];
  let recordedCounters = step.counters;
  while (step.tag === "suspend") {
    const request = step.ready[0];
    recorded.push({
      oldRequestId: request.requestId,
      nodeId: request.nodeId,
      invocationPath: request.invocationPath,
      boundArguments: request.boundArguments,
    });
    recordedCounters = { ...step.counters };
    step = resumePel(old.program, old.registry, step.continuation, [
      {
        requestId: request.requestId,
        outcome: {
          tag: "success",
          value: request.boundArguments.vals as never,
        },
      },
    ]);
  }
  assert.equal(step.tag, "failed");
  assert.equal(recordedCounters.reductions, 10);
  assert.equal(step.counters.reductions, 14);
  const revised = setup("(print [1 2]) (print [3 4]) (len [])");
  const mapping = validateRevisionPrefix(
    old.program,
    revised.program,
    2,
    recorded,
  );
  assert.ok(mapping.ok, JSON.stringify(mapping));
  const options = {
    ...DEFAULT_RUN_OPTIONS,
    replay: {
      mode: "completed-prefix" as const,
      completedPrefixCount: 2,
      prefixDigest: mapping.value.prefixDigest,
      recordedCounters,
      committedCounters: step.counters,
      maxReplayReductions: 10,
    },
  };
  let replay = startPel(
    revised.program,
    createPelEnvironment(revised.registry),
    DEFAULT_LIMITS,
    options,
  );
  let count = 0;
  while (replay.tag === "suspend") {
    const request = replay.ready[0];
    assert.equal((request as { replayOnly?: boolean }).replayOnly, true);
    assert.equal(replay.counters.reductions, 0);
    count++;
    replay = resumePel(
      revised.program,
      revised.registry,
      replay.continuation,
      [
        {
          requestId: request.requestId,
          outcome: {
            tag: "success",
            value: request.boundArguments.vals as never,
          },
        },
      ],
      options,
    );
  }
  assert.equal(count, 2);
  assert.equal(replay.tag, "done", JSON.stringify(replay));
  assert.equal(replay.counters.reductions, 17);
  for (const badOptions of [
    {
      ...options,
      replay: {
        ...options.replay,
        committedCounters: { ...step.counters, reductions: 9 },
      },
    },
    { ...options, replay: { ...options.replay, maxReplayReductions: 1 } },
    { ...options, replay: { ...options.replay, prefixDigest: "wrong" } },
  ]) {
    const bad = startPel(
      revised.program,
      createPelEnvironment(revised.registry),
      DEFAULT_LIMITS,
      badOptions,
    );
    assert.equal(bad.tag, "failed");
  }
});

test('M4 predicate cancellation, refusal and reconciliation abandonment retain closed host failures',async()=>{
 const {validateHostReceipt}=await import('../src/host-contract.js');
 const registry=createHostRegistry();assert.ok(registry.ok);
 const request={requestId:'predicate',sourceDigest:'a'.repeat(64),nodeId:'node',invocationOrdinal:0,invocationPath:'root/condition',registryId:'pel/nl-condition',boundArguments:{scrut:{tag:'number' as const,value:2},condition:{tag:'string' as const,value:'even'}},expectedResultSchemaId:'schema:pel-boolean-v1'};
 for(const code of ['cancelled','provider-refused','reconciliation-abandoned'])assert.equal(validateHostReceipt(registry.value,request,{requestId:request.requestId,outcome:{tag:'failure',failure:{code,message:'Observed terminal provider outcome.'}}}).ok,true,code);
 assert.equal(validateHostReceipt(registry.value,request,{requestId:request.requestId,outcome:{tag:'failure',failure:{code:'invented-failure',message:'Unknown'}}}).ok,false);
});
