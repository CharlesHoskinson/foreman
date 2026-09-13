import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import { parsePel } from "../src/parser.js";
import { createHostRegistry } from "../src/host-contract.js";
import { createPelEnvironment, startPel, resumePel } from "../src/evaluator.js";
const modulePath = "../src/continuation.js";
const codec = (await import(modulePath).catch(
  () => ({}),
)) as typeof import("../src/continuation.js");
function fixture() {
  const registry = createHostRegistry();
  assert.ok(registry.ok);
  const program = parsePel(Buffer.from('(print :vals "hello")'));
  assert.ok(program.ok);
  const step = startPel(program.value, createPelEnvironment(registry.value));
  assert.equal(step.tag, "suspend");
  if (step.tag !== "suspend") throw Error(JSON.stringify(step));
  const c = step.continuation;
  return {
    registry: registry.value,
    program: program.value,
    c,
    bindings: {
      sourceDigest: c.sourceDigest,
      profileDigest: c.profileDigest,
      registryDigest: c.registryDigest,
      optionsDigest: c.optionsDigest,
    },
  };
}
test("continuation codec API exists", () =>
  assert.equal(typeof codec.encodeContinuation, "function"));
test("continuation canonical bytes round trip preserves pending identity and counters and resumes", () => {
  const { c, bindings, program, registry } = fixture();
  const encoded = codec.encodeContinuation(c);
  assert.ok(encoded.ok, JSON.stringify(encoded));
  const decoded = codec.decodeContinuation(encoded.value, bindings);
  assert.ok(decoded.ok, JSON.stringify(decoded));
  assert.deepEqual(decoded.value.pending, c.pending);
  assert.deepEqual(decoded.value.counters, c.counters);
  const again = codec.encodeContinuation(decoded.value);
  assert.ok(again.ok);
  assert.deepEqual(again.value, encoded.value);
  const request = Object.values(c.pending)[0]!.request;
  assert.equal(
    resumePel(program, registry, decoded.value, [
      {
        requestId: request.requestId,
        outcome: { tag: "success", value: { tag: "nil" } },
      },
    ]).tag,
    "done",
  );
});
test("continuation rejects forged digests, wrong bindings and duplicate JSON keys", () => {
  const { c, bindings } = fixture();
  const encoded = codec.encodeContinuation(c);
  assert.ok(encoded.ok);
  const payload = JSON.parse(Buffer.from(encoded.value).toString());
  payload.digest = "0".repeat(64);
  assert.equal(
    codec.decodeContinuation(Buffer.from(JSON.stringify(payload)), bindings).ok,
    false,
  );
  for (const key of [
    "sourceDigest",
    "profileDigest",
    "registryDigest",
    "optionsDigest",
  ] as const)
    assert.equal(
      codec.decodeContinuation(encoded.value, {
        ...bindings,
        [key]: "0".repeat(64),
      }).ok,
      false,
    );
  assert.equal(
    codec.decodeContinuation(
      Buffer.from('{"schemaVersion":1,"schemaVersion":1}'),
      bindings,
    ).ok,
    false,
  );
});
test("continuation rejects malformed operations, forged environment/task/node references and cycles", () => {
  const { c, bindings } = fixture();
  for (const edit of [
    (x: any) => {
      x.tasks[x.root].op = { kind: "execute-arbitrary", command: "oops" };
    },
    (x: any) => {
      x.environments[Object.keys(x.environments)[0]!].parent = "missing";
    },
    (x: any) => {
      x.tasks[x.root].op = { kind: "pass", child: "missing" };
    },
    (x: any) => {
      Object.values(x.pending).forEach((p: any) => (p.taskId = "missing"));
    },
    (x: any) => {
      x.tasks[x.root].nodeId = "foreign:0";
    },
    (x: any) => {
      x.options.extra = true;
    },
    (x: any) => {
      x.tasks[x.root].op = { kind: "pass", child: x.root };
    },
  ]) {
    const mutated = structuredClone(c);
    edit(mutated);
    assert.equal(
      codec.validateContinuation(mutated, bindings).ok,
      false,
      JSON.stringify(mutated.tasks[mutated.root]?.op),
    );
  }
  const cycle: any = {};
  cycle.cycle = cycle;
  assert.equal(codec.validateContinuation(cycle, bindings).ok, false);
  let calls = 0;
  const getter = Object.defineProperty({}, "version", {
    enumerable: true,
    get() {
      calls++;
      return 1;
    },
  });
  assert.equal(codec.validateContinuation(getter, bindings).ok, false);
  assert.equal(calls, 0);
});
test("a rehashed envelope cannot bypass structural validation", () => {
  const { c, bindings } = fixture();
  const encoded = codec.encodeContinuation(c);
  assert.ok(encoded.ok);
  const e = JSON.parse(Buffer.from(encoded.value).toString());
  e.payload.nextId = -1;
  e.digest = sha256Hex(canonicalize(e.payload));
  assert.equal(
    codec.decodeContinuation(Buffer.from(canonicalize(e)), bindings).ok,
    false,
  );
});

test("continuation rejects changed source leaves in detached task syntax and missing scheduler queue", () => {
  const { c, bindings } = fixture();
  const changed = structuredClone(c);
  const task = changed.tasks[changed.root]!;
  task.op = structuredClone(task.op);
  if (task.op.kind !== "block") throw Error("block");
  const call = task.op.nodes[0]!;
  if (call.kind !== "call") throw Error("call");
  const literal = call.items.find((n) => n.kind === "pair" && n.key === "vals");
  assert.ok(literal?.kind === "pair" && literal.value.kind === "string");
  (literal.value as { value: string }).value = "forged";
  assert.equal(codec.validateContinuation(changed, bindings).ok, false);
  const noQueue = structuredClone(c) as any;
  delete noQueue.runnable;
  assert.equal(codec.validateContinuation(noQueue, bindings).ok, false);
});
