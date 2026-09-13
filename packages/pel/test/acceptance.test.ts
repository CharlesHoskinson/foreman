import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import { parsePel } from "../src/parser.js";
import { DEFAULT_LIMITS } from "../src/profile.js";
import {
  createPelEnvironment,
  DEFAULT_RUN_OPTIONS,
  evaluateClosure,
  extractClosureEnvironment,
  resumePel,
  startPel,
} from "../src/evaluator.js";
import {
  createHostRegistry,
  type HostFunctionDescriptorSpecV1,
} from "../src/host-contract.js";
import { decodeContinuation, encodeContinuation } from "../src/continuation.js";
import { decodePelData, encodePelData, formatPel } from "../src/values.js";
import type { PelProgram, SourceSpan } from "../src/ast.js";
import type { PelRunOptionsV1 } from "../src/types.js";
import type { PelClosureValue } from "../src/types.js";

const bytes = (source: string): Uint8Array => new TextEncoder().encode(source);

function program(source: string): PelProgram {
  const parsed = parsePel(bytes(source));
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  return parsed.value;
}

function pure(source: string): ReturnType<typeof startPel> {
  const registry = createHostRegistry();
  assert.equal(registry.ok, true);
  return startPel(program(source), createPelEnvironment(registry.value));
}

function value(source: string, expected: string): void {
  const step = pure(source);
  assert.equal(step.tag, "done", JSON.stringify(step));
  if (step.tag === "done") assert.equal(formatPel(step.value), expected);
}

function descriptor(
  id: string,
  parameters: HostFunctionDescriptorSpecV1["argSpec"],
  resultSchemaId = "schema:pel-data-v1",
): HostFunctionDescriptorSpecV1 {
  return {
    id,
    name: id,
    argSpec: parameters,
    resultSchemaId,
    failureSchemaId: "schema:pel-host-failure-v1",
    effectKind: "read",
    capabilities: [],
    resources: { reads: [], writes: [], unknown: false },
    resourceResolverId: "static",
    resourceEnvelope: {},
  };
}

test("catalog T-M1-003 evaluates, formats, and encodes the complete value fixture", () => {
  const step = pure('[1 "two" #t #nil :a 1 :flag :a 2]');
  assert.equal(step.tag, "done", JSON.stringify(step));
  if (step.tag !== "done") return;
  assert.equal(formatPel(step.value), '[1 "two" #t #nil :a 1 :flag #nil :a 2]');
  const encoded = encodePelData(step.value);
  assert.equal(encoded.ok, true);
  if (encoded.ok) assert.deepEqual(decodePelData(encoded.value), encoded);
});

test("catalog T-M1-004 exercises callable lists through the evaluator", () => {
  value("([5 6 7 8] 1)", "5");
  value("([5 6 7 8] () 1 3)", "[5 6 7]");
  value("([:a 1 :b 2] :at [':b ':a])", "[2 1]");
  value("([:a 1] ':missing)", "#nil");
  for (const source of ["([5] 0)", "([5] 1.5)", "([5] 2)"]) {
    const step = pure(source);
    assert.equal(step.tag, "failed", source);
    if (step.tag === "failed") assert.equal(step.diagnostic.code, "PEL_INDEX");
  }
});

test("catalog T-M1-005 and T-M1-006 cover the exact closure and binding matrices", () => {
  const partial = pure("((lambda [:x] x))");
  assert.equal(partial.tag, "done");
  if (partial.tag === "done") assert.equal(partial.value.tag, "closure");
  value("((lambda [:x #nil] x))", "#nil");
  value("((lambda [:x :y 3] [x y]) 1)", "[1 3]");
  value("((lambda [:x 1 :y] [x y]) :y 2)", "[1 2]");
  value("(+ :x 1 :y 2)", "3");
  value("((+ 5) 4)", "9");
  value("(+ [1 2])", "3");
  const incompatible = pure("((+ 5) [1 2])");
  assert.equal(incompatible.tag, "failed");
  if (incompatible.tag === "failed")
    assert.equal(incompatible.diagnostic.code, "PEL_TYPE");
});

test("catalog T-M1-010 renders the evaluator diagnostic and registered signature", async () => {
  const source = '1\n(print ["hello" name] :sep " ")';
  const parsed = program(source);
  const registry = createHostRegistry();
  assert.equal(registry.ok, true);
  const step = startPel(parsed, createPelEnvironment(registry.value));
  assert.equal(step.tag, "failed", JSON.stringify(step));
  if (step.tag !== "failed") return;
  const { renderPelDiagnostic } = await import("../src/diagnostics.js");
  const rendered = renderPelDiagnostic(bytes(source), step.diagnostic);
  assert.equal(step.diagnostic.code, "PEL_ARGUMENT_MODE");
  assert.deepEqual(
    step.diagnostic.span,
    parsed.expressions[1]!.span as SourceSpan,
  );
  assert.match(rendered, /:vals/);
  assert.match(rendered, /:sep/);
});

test("catalog T-M1-011 emits exactly two bounded loop requests", () => {
  const parsed = program("(for [1 2 3] i (print i))");
  const registry = createHostRegistry();
  assert.equal(registry.ok, true);
  let step = startPel(parsed, createPelEnvironment(registry.value), {
    ...DEFAULT_LIMITS,
    maxIterations: 2,
  });
  let emitted = 0;
  while (step.tag === "suspend") {
    assert.equal(step.ready.length, 1);
    emitted += Number(!step.ready[0].alreadyEmitted);
    const request = step.ready[0];
    step = resumePel(parsed, registry.value, step.continuation, [
      {
        requestId: request.requestId,
        outcome: {
          tag: "success",
          value: request.boundArguments.vals as never,
        },
      },
    ]);
  }
  assert.equal(emitted, 2);
  assert.equal(step.tag, "failed");
  if (step.tag === "failed") {
    assert.equal(step.diagnostic.code, "PEL_LIMIT");
    assert.equal(step.diagnostic.bound, "maxIterations");
    assert.equal(step.diagnostic.consumed, 2);
    assert.equal(Object.keys(step.continuation.pending).length, 0);
  }
});

test("catalog T-M1-012 completes the Boolean host flow and rejects a changed registry", () => {
  const flag = descriptor(
    "test/flag",
    { kind: "fixed", parameters: [] },
    "schema:pel-boolean-v1",
  );
  const firstRegistry = createHostRegistry([flag]);
  const changedRegistry = createHostRegistry([
    { ...flag, resourceEnvelope: { changed: true } },
  ]);
  assert.equal(firstRegistry.ok, true);
  assert.equal(changedRegistry.ok, true);
  const parsed = program(
    "(test/flag) |> (if :cond ^ :then (for [1 2] i (* i 2)) :else [])",
  );
  const first = startPel(parsed, createPelEnvironment(firstRegistry.value));
  assert.equal(first.tag, "suspend");
  if (first.tag !== "suspend") return;
  const receipt = [
    {
      requestId: first.ready[0].requestId,
      outcome: {
        tag: "success" as const,
        value: { tag: "boolean" as const, value: true },
      },
    },
  ];
  const mismatch = resumePel(
    parsed,
    changedRegistry.value,
    first.continuation,
    receipt,
  );
  assert.equal(mismatch.tag, "failed");
  if (mismatch.tag === "failed")
    assert.equal(mismatch.diagnostic.code, "PEL_CONTINUATION_MISMATCH");
  const done = resumePel(
    parsed,
    firstRegistry.value,
    first.continuation,
    receipt,
  );
  assert.equal(done.tag, "done", JSON.stringify(done));
  if (done.tag === "done") assert.equal(formatPel(done.value), "[2 4]");

  const echoRegistry = createHostRegistry([
    descriptor("test/echo", {
      kind: "fixed",
      parameters: [{ name: "input", required: true, evaluation: "strict" }],
    }),
  ]);
  assert.equal(echoRegistry.ok, true);
  const incomplete = startPel(
    program("(test/echo)"),
    createPelEnvironment(echoRegistry.value),
  );
  assert.equal(incomplete.tag, "done");
  if (incomplete.tag === "done") assert.equal(incomplete.value.tag, "closure");
});

test("catalog T-M1-013 binds natural-language predicate selection and Boolean results", () => {
  const parsed = program('(case [:tier "premium"] ["is premium" 1 #t 0])');
  const registry = createHostRegistry();
  assert.equal(registry.ok, true);
  const selection = {
    profileId: "gpt-5.6-sol",
    transportId: "openai-responses",
    controls: { temperature: 0 },
    credentialProfileRef: "account:test",
    outputSchemaId: "schema:pel-boolean-v1",
  } as const;
  const options: PelRunOptionsV1 = {
    ...DEFAULT_RUN_OPTIONS,
    nlConditionProfile: selection,
    nlConditionProfileDigest: sha256Hex(canonicalize(selection)),
  };
  const first = startPel(
    parsed,
    createPelEnvironment(registry.value),
    DEFAULT_LIMITS,
    options,
  );
  assert.equal(first.tag, "suspend", JSON.stringify(first));
  if (first.tag !== "suspend") return;
  const request = first.ready[0];
  assert.equal(request.registryId, "pel/nl-condition");
  assert.deepEqual(request.selection, selection);
  assert.equal(request.selectionDigest, options.nlConditionProfileDigest);
  assert.equal(formatPel(request.boundArguments.scrut!), '[:tier "premium"]');
  assert.deepEqual(request.boundArguments.condition, {
    tag: "string",
    value: "is premium",
  });
  const done = resumePel(
    parsed,
    registry.value,
    first.continuation,
    [
      {
        requestId: request.requestId,
        outcome: { tag: "success", value: { tag: "boolean", value: true } },
      },
    ],
    options,
  );
  assert.equal(done.tag, "done");
  if (done.tag === "done") assert.equal(formatPel(done.value), "1");
  const invalid = resumePel(
    parsed,
    registry.value,
    first.continuation,
    [
      {
        requestId: request.requestId,
        outcome: { tag: "success", value: { tag: "string", value: "true" } },
      },
    ],
    options,
  );
  assert.equal(invalid.tag, "failed");
  if (invalid.tag === "failed")
    assert.equal(invalid.diagnostic.code, "PEL_HOST_RESULT");
  const absent = startPel(parsed, createPelEnvironment(registry.value));
  assert.equal(absent.tag, "failed");
  if (absent.tag === "failed")
    assert.equal(absent.diagnostic.code, "PEL_REGISTRY");
});

test("catalog T-M1-014 continuation bytes are canonical with completed and pending async work", () => {
  const parsed = program("(do/async (print (lambda [:x] x)) (print 2))");
  const registry = createHostRegistry();
  assert.equal(registry.ok, true);
  const first = startPel(parsed, createPelEnvironment(registry.value));
  assert.equal(first.tag, "suspend");
  if (first.tag !== "suspend") return;
  assert.equal(first.ready.length, 2);
  const partial = resumePel(parsed, registry.value, first.continuation, [
    {
      requestId: first.ready[1]!.requestId,
      outcome: { tag: "success", value: { tag: "number", value: 2 } },
    },
  ]);
  assert.equal(partial.tag, "suspend", JSON.stringify(partial));
  if (partial.tag !== "suspend") return;
  const encoded = encodeContinuation(partial.continuation);
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  if (!encoded.ok) return;
  const text = new TextDecoder().decode(encoded.value);
  assert.equal(text, canonicalize(JSON.parse(text)));
  const decoded = decodeContinuation(encoded.value, {
    sourceDigest: partial.continuation.sourceDigest,
    profileDigest: partial.continuation.profileDigest,
    registryDigest: partial.continuation.registryDigest,
    optionsDigest: partial.continuation.optionsDigest,
  });
  assert.equal(decoded.ok, true, JSON.stringify(decoded));
  if (!decoded.ok) return;
  const again = encodeContinuation(decoded.value);
  assert.equal(again.ok, true);
  if (again.ok) assert.deepEqual(again.value, encoded.value);
  assert.deepEqual(decoded.value.completed, partial.continuation.completed);
  assert.deepEqual(decoded.value.counters, partial.continuation.counters);
  assert.deepEqual(
    Object.keys(decoded.value.pending),
    Object.keys(partial.continuation.pending),
  );
});

test("catalog T-M1-016 separates retry attempts and race contenders", () => {
  const parsed = program("(print (lambda [:x] (print x)))");
  const registry = createHostRegistry();
  assert.equal(registry.ok, true);
  const parent = startPel(parsed, createPelEnvironment(registry.value));
  assert.equal(parent.tag, "suspend");
  if (parent.tag !== "suspend") return;
  const closure = parent.ready[0].boundArguments.vals as PelClosureValue;
  const environment = extractClosureEnvironment(parent.continuation, closure);
  assert.equal(environment.ok, true);
  if (!environment.ok) return;
  const requestIds = new Set<string>();
  for (const [kind, index] of [
    ["retry", 1],
    ["retry", 2],
    ["race", 1],
    ["race", 2],
  ] as const) {
    const childInvocationId = `${parent.ready[0].requestId}/${kind}/${index}`;
    const child = evaluateClosure(closure, [{ tag: "number", value: index }], {
      program: parsed,
      registry: registry.value,
      sourceDigest: parsed.sourceDigest,
      profileDigest: parsed.profileDigest,
      registryDigest: registry.value.digest,
      parentRequestId: parent.ready[0].requestId,
      childInvocationId,
      environmentTable: environment.value,
      limits: DEFAULT_LIMITS,
      options: DEFAULT_RUN_OPTIONS,
      optionsDigest: parent.continuation.optionsDigest,
    });
    assert.equal(child.tag, "suspend");
    if (child.tag === "suspend") {
      assert.match(
        child.ready[0].invocationPath,
        new RegExp(`/${kind}/${index}/`),
      );
      requestIds.add(child.ready[0].requestId);
    }
  }
  assert.equal(requestIds.size, 4);
});

test("catalog T-M1-017 binds list bounds and resolver content into registry identity", () => {
  const bounded = descriptor(
    "test/bounded",
    { kind: "fixed", parameters: [] },
    "schema:bounded",
  );
  const schema = {
    "schema:bounded": {
      type: "list" as const,
      items: {
        type: "number" as const,
        integer: true,
        minimum: 0,
        maximum: 10,
      },
      minItems: 0,
      maxItems: 4,
    },
  };
  const first = createHostRegistry(
    [bounded],
    schema,
    {},
    { static: { version: 1 } },
  );
  const changed = createHostRegistry(
    [bounded],
    schema,
    {},
    { static: { version: 2 } },
  );
  const changedDescriptor = createHostRegistry(
    [{ ...bounded, effectKind: "model" }],
    schema,
    {},
    { static: { version: 1 } },
  );
  assert.equal(first.ok, true);
  assert.equal(changed.ok, true);
  assert.equal(changedDescriptor.ok, true);
  assert.notEqual(first.value.digest, changed.value.digest);
  assert.notEqual(first.value.digest, changedDescriptor.value.digest);
  const parsed = program("(test/bounded)");
  const step = startPel(parsed, createPelEnvironment(first.value));
  assert.equal(step.tag, "suspend");
  if (step.tag !== "suspend") return;
  for (const [length, expected] of [
    [4, "done"],
    [5, "failed"],
  ] as const) {
    const resumed = resumePel(parsed, first.value, step.continuation, [
      {
        requestId: step.ready[0].requestId,
        outcome: {
          tag: "success",
          value: {
            tag: "list",
            items: Array.from({ length }, (_, value) => ({
              tag: "number",
              value,
            })),
          },
        },
      },
    ]);
    assert.equal(resumed.tag, expected);
    if (resumed.tag === "failed")
      assert.equal(resumed.diagnostic.code, "PEL_HOST_RESULT");
  }
});

test("the public module exports every M1 codec and validation entry point", async () => {
  const pel = (await import("../src/index.js")) as Record<string, unknown>;
  for (const name of [
    "encodeContinuation",
    "decodeContinuation",
    "encodeHostArgumentsV1",
    "decodeHostArgumentsV1",
    "validateRevisionPrefix",
    "validateRunOptions",
    "validateLimits",
  ])
    assert.equal(typeof pel[name], "function", name);
});
