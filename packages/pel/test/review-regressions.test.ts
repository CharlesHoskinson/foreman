import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePel } from "../src/parser.js";
import { createHostRegistry } from "../src/host-contract.js";
import {
  createPelEnvironment,
  startPel,
  resumePel,
  DEFAULT_RUN_OPTIONS,
  digest,
} from "../src/evaluator.js";
import { DEFAULT_LIMITS } from "../src/profile.js";
import type { PelStep } from "../src/evaluator.js";
const registered = createHostRegistry();
assert.ok(registered.ok);
const registry = registered.value;
function program(source: string) {
  const p = parsePel(new TextEncoder().encode(source));
  assert.ok(p.ok);
  return p.value;
}
function rejected(step: PelStep, code?: string) {
  assert.equal(step.tag, "failed");
  if (step.tag === "failed") {
    if (code) assert.equal(step.diagnostic.code, code);
    assert.ok(step.diagnostic.span);
  }
}
for (const [name, options] of [
  ["null", null],
  ["missing fields", {}],
  [
    "unknown dependency mode",
    { ...DEFAULT_RUN_OPTIONS, dependencyMode: "unsafe" },
  ],
  ["null replay", { ...DEFAULT_RUN_OPTIONS, replay: null }],
  ["unknown replay", { ...DEFAULT_RUN_OPTIONS, replay: { mode: "unchecked" } }],
] as const)
  test(`review: malformed options ${name} fail without throwing or releasing requests`, () => {
    rejected(
      startPel(
        program("(print 1)"),
        createPelEnvironment(registry),
        DEFAULT_LIMITS,
        options as never,
      ),
    );
  });
test("review: cyclic predicate controls fail without overflowing canonicalization", () => {
  const controls: Record<string, unknown> = {};
  controls.self = controls;
  const selection = {
    profileId: "fixture",
    transportId: "fixture",
    credentialProfileRef: "account:fixture",
    outputSchemaId: "schema:pel-boolean-v1",
    controls,
  };
  rejected(
    startPel(
      program("(print 1)"),
      createPelEnvironment(registry),
      DEFAULT_LIMITS,
      {
        ...DEFAULT_RUN_OPTIONS,
        nlConditionProfile: selection,
        nlConditionProfileDigest: "0".repeat(64),
      } as never,
    ),
  );
});
for (const [name, malformed] of [
  ["null", null],
  ["missing descriptors", { ...registry, descriptors: null }],
  ["empty object", {}],
] as const)
  test(`review: malformed registry ${name} returns PEL_REGISTRY`, () => {
    rejected(
      startPel(program("(print 1)"), createPelEnvironment(malformed as never)),
      "PEL_REGISTRY",
    );
  });
function suspended() {
  const p = program("(print 1) 2");
  const step = startPel(p, createPelEnvironment(registry));
  assert.equal(step.tag, "suspend");
  if (step.tag !== "suspend") throw new Error("fixture did not suspend");
  return { p, step };
}
for (const [name, change] of [
  [
    "missing root",
    (c: any) => {
      c.root = "absent";
    },
  ],
  [
    "null task table",
    (c: any) => {
      c.tasks = null;
    },
  ],
  [
    "negative reductions",
    (c: any) => {
      c.counters.reductions = -1;
    },
  ],
  [
    "missing pending task",
    (c: any) => {
      Object.values(c.pending).forEach((entry: any) => {
        entry.taskId = "absent";
      });
    },
  ],
] as const)
  test(`review: malformed continuation ${name} fails before resume`, () => {
    const { p, step } = suspended();
    const continuation = structuredClone(step.continuation);
    change(continuation);
    rejected(
      resumePel(p, registry, continuation, [
        {
          requestId: step.ready[0].requestId,
          outcome: { tag: "success", value: { tag: "number", value: 1 } },
        },
      ]),
      "PEL_CONTINUATION_MISMATCH",
    );
  });
test("review: continuation options payload must match its options digest", () => {
  const p = program('(print 1) (case 7 ["positive" 1 #t 0])');
  const step = startPel(p, createPelEnvironment(registry));
  assert.equal(step.tag, "suspend");
  if (step.tag !== "suspend") return;
  const continuation = structuredClone(step.continuation);
  const selection = {
    profileId: "fixture",
    transportId: "fixture",
    credentialProfileRef: "account:fixture",
    outputSchemaId: "schema:pel-boolean-v1",
    controls: {},
  };
  continuation.options = {
    ...DEFAULT_RUN_OPTIONS,
    nlConditionProfile: selection,
    nlConditionProfileDigest: digest(selection),
  };
  rejected(
    resumePel(p, registry, continuation, [
      {
        requestId: step.ready[0].requestId,
        outcome: { tag: "success", value: { tag: "number", value: 1 } },
      },
    ]),
    "PEL_CONTINUATION_MISMATCH",
  );
});
test("review: environment bindings are immutable snapshots", () => {
  const input = {
    seed: {
      tag: "list" as const,
      items: [{ tag: "number" as const, value: 1 }],
    },
  };
  const environment = createPelEnvironment(registry, input);
  input.seed.items[0]!.value = 9;
  const step = startPel(program("seed"), environment);
  assert.equal(step.tag, "done");
  if (step.tag === "done")
    assert.deepEqual(step.value, {
      tag: "list",
      items: [{ tag: "number", value: 1 }],
    });
});
for (const source of [
  "(def __proto__ 3) __proto__",
  "((lambda [:__proto__] __proto__) 3)",
])
  test(`review: prototype-spelled names are ordinary Pel bindings: ${source}`, () => {
    const step = startPel(program(source), createPelEnvironment(registry));
    assert.equal(step.tag, "done");
    if (step.tag === "done")
      assert.deepEqual(step.value, { tag: "number", value: 3 });
  });
for (const [name, source] of [
  ["default", "(def make 7 |> (lambda [:x ^])) (def f (make x)) (f)"],
  ["body", "(def make 7 |> (lambda :body ^)) (def f (make [:x])) (f 2)"],
] as const)
  test(`review: partial lambda preserves captured ${name} caret`, () => {
    const step = startPel(program(source), createPelEnvironment(registry));
    assert.equal(
      step.tag,
      "done",
      step.tag === "failed" ? step.diagnostic.code : step.tag,
    );
    if (step.tag === "done")
      assert.deepEqual(step.value, { tag: "number", value: 7 });
  });
test("review: calling a closure does not inherit an uncaptured caller caret", () => {
  rejected(
    startPel(
      program("(def f (lambda [] ^)) 7 |> (do ^ (f))"),
      createPelEnvironment(registry),
    ),
    "PEL_CARET_SCOPE",
  );
});
test("review: aggregate retained data stops before a following host request", () => {
  const text = "x".repeat(900);
  const source = `(def a "${text}") (def b "${text}") (print 1)`;
  const step = startPel(program(source), createPelEnvironment(registry), {
    ...DEFAULT_LIMITS,
    maxValueBytes: 1600,
  });
  rejected(step, "PEL_LIMIT");
  if (step.tag === "failed")
    assert.equal(Object.keys(step.continuation.pending).length, 0);
});
