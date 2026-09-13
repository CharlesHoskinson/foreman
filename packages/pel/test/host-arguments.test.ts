import assert from "node:assert/strict";
import { test } from "node:test";
import type { PelClosureValue, PelEnvironmentTableV1 } from "../src/types.js";
const modulePath = "../src/host-arguments.js";
const codec = (await import(modulePath).catch(
  () => ({}),
)) as typeof import("../src/host-arguments.js");
const bindings = {
  sourceDigest: "a".repeat(64),
  registryDigest: "b".repeat(64),
  optionsDigest: "c".repeat(64),
};
const body = {
  kind: "symbol" as const,
  name: "self",
  nodeId: `${bindings.sourceDigest}:0`,
  span: { start: 0, end: 4, line: 1, column: 1, endLine: 1, endColumn: 5 },
};
function fixture() {
  const closure: PelClosureValue = {
    tag: "closure",
    sourceDigest: bindings.sourceDigest,
    nodeId: body.nodeId,
    environmentId: "e0",
    argSpec: { kind: "fixed", parameters: [] },
    callable: { kind: "user", body },
    boundArguments: {},
    defaults: {},
  };
  const environmentTable: PelEnvironmentTableV1 = {
    ...bindings,
    records: { e0: { id: "e0", bindings: { self: closure } } },
  };
  return { closure, environmentTable };
}
test("host argument codec exists", () =>
  assert.equal(typeof codec.encodeHostArgumentsV1, "function"));
test("recursive closures encode through stable environment references and round trip canonically", () => {
  const { closure, environmentTable } = fixture();
  const encoded = codec.encodeHostArgumentsV1(
    { fn: closure },
    environmentTable,
  );
  assert.ok(encoded.ok, JSON.stringify(encoded));
  const decoded = codec.decodeHostArgumentsV1(encoded.value, bindings);
  assert.ok(decoded.ok, JSON.stringify(decoded));
  const recovered = decoded.value.boundArguments.fn as PelClosureValue;
  assert.equal(
    decoded.value.environmentTable.records[recovered.environmentId]?.bindings
      .self,
    recovered,
  );
  const again = codec.encodeHostArgumentsV1(
    decoded.value.boundArguments,
    decoded.value.environmentTable,
  );
  assert.ok(again.ok);
  assert.deepEqual(again.value, encoded.value);
});
test("host argument codec rejects forged references and identity changes", () => {
  const { closure, environmentTable } = fixture();
  const encoded = codec.encodeHostArgumentsV1(
    { fn: closure },
    environmentTable,
  );
  assert.ok(encoded.ok);
  assert.equal(
    codec.decodeHostArgumentsV1(encoded.value, {
      ...bindings,
      sourceDigest: "d".repeat(64),
    }).ok,
    false,
  );
  const forged = structuredClone(encoded.value) as any;
  forged.arguments[0].value = { ref: "n999" };
  assert.equal(codec.decodeHostArgumentsV1(forged, bindings).ok, false);
  const missing = { ...environmentTable, records: {} };
  assert.equal(codec.encodeHostArgumentsV1({ fn: closure }, missing).ok, false);
});
test("host argument codec rejects physical cycles, accessors and extra fields without invoking them", () => {
  const { environmentTable } = fixture();
  const cycle: any = { tag: "list", items: [] };
  cycle.items.push(cycle);
  assert.equal(
    codec.encodeHostArgumentsV1({ x: cycle }, environmentTable).ok,
    false,
  );
  let calls = 0;
  const arg = Object.defineProperty({}, "x", {
    enumerable: true,
    get() {
      calls++;
      return { tag: "nil" };
    },
  });
  assert.equal(codec.encodeHostArgumentsV1(arg, environmentTable).ok, false);
  assert.equal(calls, 0);
  assert.equal(
    codec.encodeHostArgumentsV1(
      { x: { tag: "nil", extra: true } as never },
      environmentTable,
    ).ok,
    false,
  );
});

test("actual extracted recursive closure environment survives encoding and child evaluation", async () => {
  const { parsePel } = await import("../src/parser.js");
  const { createHostRegistry } = await import("../src/host-contract.js");
  const pel = await import("../src/evaluator.js");
  const { DEFAULT_LIMITS } = await import("../src/profile.js");
  const program = parsePel(
    Buffer.from(
      "(def self (lambda [:n] (if (eq n 0) 42 (self (- n 1))))) (print self)",
    ),
  );
  assert.ok(program.ok);
  const registry = createHostRegistry();
  assert.ok(registry.ok);
  const step = pel.startPel(
    program.value,
    pel.createPelEnvironment(registry.value),
  );
  assert.equal(step.tag, "suspend");
  if (step.tag !== "suspend") throw Error(JSON.stringify(step));
  const closure = step.ready[0].boundArguments.vals as PelClosureValue;
  const table = pel.extractClosureEnvironment(step.continuation, closure);
  assert.ok(table.ok);
  const encoded = codec.encodeHostArgumentsV1({ fn: closure }, table.value);
  assert.ok(encoded.ok, JSON.stringify(encoded));
  const decoded = codec.decodeHostArgumentsV1(encoded.value, table.value);
  assert.ok(decoded.ok, JSON.stringify(decoded));
  const again = codec.encodeHostArgumentsV1(
    decoded.value.boundArguments,
    decoded.value.environmentTable,
  );
  assert.ok(again.ok);
  assert.deepEqual(again.value, encoded.value);
  const result = pel.evaluateClosure(
    decoded.value.boundArguments.fn as PelClosureValue,
    [{ tag: "number", value: 4 }],
    {
      program: program.value,
      registry: registry.value,
      sourceDigest: program.value.sourceDigest,
      profileDigest: program.value.profileDigest,
      registryDigest: registry.value.digest,
      parentRequestId: step.ready[0].requestId,
      childInvocationId: `${step.ready[0].requestId}/retry/1`,
      environmentTable: decoded.value.environmentTable as never,
      limits: DEFAULT_LIMITS,
      options: pel.DEFAULT_RUN_OPTIONS,
      optionsDigest: step.continuation.optionsDigest,
    },
  );
  assert.equal(
    result.tag,
    "done",
    result.tag === "failed" ? result.diagnostic.message : result.tag,
  );
  if (result.tag === "done")
    assert.deepEqual(result.value, { tag: "number", value: 42 });
});

test("environment parent validation visits a long chain in linear work and rejects a closing cycle", () => {
  const count = 10000;
  const records: Record<
    string,
    { id: string; parent?: string; bindings: Record<string, never> }
  > = Object.create(null);
  for (let i = 0; i < count; i++)
    records[`e${i}`] = {
      id: `e${i}`,
      ...(i ? { parent: `e${i - 1}` } : {}),
      bindings: {},
    };
  let reads = 0;
  // Transparent test instrumentation counts map lookups, rather than relying on wall-clock timing.
  const measured = new Proxy(records, {
    get(target, key, receiver) {
      if (typeof key === "string" && key.startsWith("e")) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  assert.equal(
    codec.validEnvironmentTable({ ...bindings, records: measured }),
    true,
  );
  assert.ok(
    reads <= count * 4,
    `expected linear lookups, observed ${reads} for ${count} records`,
  );
  records.e0!.parent = `e${count - 1}`;
  assert.equal(codec.validEnvironmentTable({ ...bindings, records }), false);
  delete records.e0!.parent;
  records.e0!.parent = "absent";
  assert.equal(codec.validEnvironmentTable({ ...bindings, records }), false);
});
