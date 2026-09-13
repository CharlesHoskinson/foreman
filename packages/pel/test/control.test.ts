import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePel } from "../src/parser.js";
import { createHostRegistry } from "../src/host-contract.js";
import {
  createPelEnvironment,
  startPel,
  resumePel,
  DEFAULT_RUN_OPTIONS,
} from "../src/evaluator.js";
import { DEFAULT_LIMITS } from "../src/profile.js";
import { formatPel } from "../src/values.js";
import type { PelRunOptionsV1 } from "../src/types.js";
const r = createHostRegistry(
  ["test/once", "test/a", "test/b", "test/denied"].map((id) => ({
    id,
    name: id,
    argSpec: { kind: "fixed" as const, parameters: [] },
    resultSchemaId: "schema:pel-data-v1",
    failureSchemaId: "schema:pel-host-failure-v1",
    effectKind: "read" as const,
    capabilities: [],
    resources: { reads: [], writes: [], unknown: false },
    resourceResolverId: "static",
    resourceEnvelope: {},
  })),
);
assert.ok(r.ok);
const registry = r.value;
function start(source: string, options: PelRunOptionsV1 = DEFAULT_RUN_OPTIONS) {
  const parsed = parsePel(new TextEncoder().encode(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return {
    program: parsed.value,
    step: startPel(
      parsed.value,
      createPelEnvironment(registry),
      DEFAULT_LIMITS,
      options,
    ),
  };
}
function value(source: string, expected: string) {
  const { step } = start(source);
  assert.equal(
    step.tag,
    "done",
    source + ": " + (step.tag === "failed" ? step.diagnostic.code : step.tag),
  );
  if (step.tag === "done") assert.equal(formatPel(step.value), expected);
}
function error(source: string, code: string) {
  const { step } = start(source);
  assert.equal(step.tag, "failed", JSON.stringify(step));
  if (step.tag === "failed") assert.equal(step.diagnostic.code, code);
}
test("T-M1-007 one host input feeds repeated carets exactly once", () => {
  const { program, step } = start("(test/once) |> (+ ^ ^)");
  assert.equal(step.tag, "suspend");
  if (step.tag !== "suspend") return;
  assert.equal(step.ready.length, 1);
  assert.equal(step.ready[0].registryId, "test/once");
  const done = resumePel(program, registry, step.continuation, [
    {
      requestId: step.ready[0].requestId,
      outcome: { tag: "success", value: { tag: "number", value: 5 } },
    },
  ]);
  assert.equal(done.tag, "done");
  if (done.tag === "done")
    assert.deepEqual(done.value, { tag: "number", value: 10 });
});
test("T-M1-007 aliases and partial case closures retain condition ownership", () => {
  value('(def c case) 7 |> (c ^ [(gt ^ 5) "big" #t "small"])', '"big"');
  value('(def c (case :body [(gt ^ 5) "big" #t "small"])) 7 |> (c)', '"big"');
  value('7 |> ((if #t case missing) ^ [(gt ^ 5) "big" #t "small"])', '"big"');
});
for (const [kind, source] of [
  ["direct", '7 |> (case [(gt ^ 5) "big" #t "small"])'],
  ["alias", '(def c case) 7 |> (c [(gt ^ 5) "big" #t "small"])'],
  ["partial", '7 |> ((case) [(gt ^ 5) "big" #t "small"])'],
  ["computed", '7 |> ((if #t case missing) [(gt ^ 5) "big" #t "small"])'],
] as const)
  test(`T-M1-007 implicit pipe input excludes ${kind} case body carets`, () =>
    value(source, '"big"'));
test("T-M1-007 nested pipes, quoted carets, captured lambdas, and definitions", () => {
  value("3 |> (+ ^ 4 |> (+ ^ 1))", "8");
  value("(def f (7 |> (lambda [:x] (+ x ^)))) (f 2)", "9");
  value("(+ 1 2) |> (def z ^) z", "3");
  value("'^", "'^");
  value("100 |> (case (- ^ 93) [(gt ^ 5) ^ #t 0])", "100");
  error("(case 7 [#t ^])", "PEL_CARET_SCOPE");
});
test("T-M1-008 native branches and loop scopes evaluate only demanded syntax", () => {
  value("(if #f (test/denied) 7)", "7");
  value("(case 7 [#t 1 #t (test/denied)])", "1");
  value("(for [1 2] i (def x i))", "[1 2]");
  value("(if #t (def x 3) (test/denied)) x", "3");
  error('(def condition "positive") (case 7 [condition 1 #t 0])', "PEL_TYPE");
  value("(def condition (gt :y 5)) (case 7 [condition 1 #t 0])", "1");
});
test("T-M1-008 case scrutinee suspends once and feeds leading call", () => {
  const { program, step } = start("(case (test/once) [(gt 2) 1 #t 0])");
  assert.equal(step.tag, "suspend");
  if (step.tag !== "suspend") return;
  assert.equal(step.ready.length, 1);
  const done = resumePel(program, registry, step.continuation, [
    {
      requestId: step.ready[0].requestId,
      outcome: { tag: "success", value: { tag: "number", value: 5 } },
    },
  ]);
  assert.equal(done.tag, "done");
  if (done.tag === "done") assert.equal(formatPel(done.value), "1");
});
test("T-M1-009 asynchronous B completion leaves only previously emitted A", () => {
  const { program, step } = start("(do/async (test/a) (test/b))");
  assert.equal(step.tag, "suspend");
  if (step.tag !== "suspend") return;
  assert.deepEqual(
    step.ready.map((x) => [x.registryId, x.alreadyEmitted]),
    [
      ["test/a", false],
      ["test/b", false],
    ],
  );
  const a = step.ready[0]!,
    b = step.ready[1]!;
  const partial = resumePel(program, registry, step.continuation, [
    {
      requestId: b.requestId,
      outcome: { tag: "success", value: { tag: "number", value: 2 } },
    },
  ]);
  assert.equal(partial.tag, "suspend");
  if (partial.tag !== "suspend") return;
  assert.deepEqual(
    partial.ready.map((x) => [x.requestId, x.alreadyEmitted]),
    [[a.requestId, true]],
  );
  const done = resumePel(program, registry, partial.continuation, [
    {
      requestId: a.requestId,
      outcome: { tag: "success", value: { tag: "number", value: 1 } },
    },
  ]);
  assert.equal(done.tag, "done");
  if (done.tag === "done") assert.equal(formatPel(done.value), "2");
});
test("T-M1-009 top-level options govern release but preserve the last source value", () => {
  for (const dependencyMode of ["ordered", "automatic"] as const) {
    const options = { ...DEFAULT_RUN_OPTIONS, dependencyMode };
    const { program, step } = start("(test/a) (test/b)", options);
    assert.equal(step.tag, "suspend");
    if (step.tag !== "suspend") continue;
    assert.equal(step.ready.length, dependencyMode === "ordered" ? 1 : 2);
    let next = step as ReturnType<typeof startPel>;
    let count = 0;
    while (next.tag === "suspend") {
      assert.ok(count++ < 3);
      const request = next.ready.at(-1)!;
      next = resumePel(
        program,
        registry,
        next.continuation,
        [
          {
            requestId: request.requestId,
            outcome: {
              tag: "success",
              value: {
                tag: "number",
                value: request.registryId === "test/a" ? 1 : 2,
              },
            },
          },
        ],
        options,
      );
    }
    assert.equal(next.tag, "done");
    if (next.tag === "done") assert.equal(formatPel(next.value), "2");
  }
  value("(do/async (def y (+ x 1)) (def x 2) y)", "3");
  error("(do/async (def x y) (def y x))", "PEL_DEPENDENCY_CYCLE");
  value("(do [])", "#nil");
  value("(do/async [])", "#nil");
});
test("T-M1-021 caret lexing stays separate from demanded evaluation", () => {
  error("^", "PEL_CARET_SCOPE");
  error(":a^b", "PEL_CARET_SCOPE");
  error("Infinity", "PEL_UNBOUND_SYMBOL");
  const { step } = start("-");
  assert.equal(step.tag, "done");
  if (step.tag === "done") assert.equal(step.value.tag, "closure");
  value(":a>", ":a> #nil");
});
