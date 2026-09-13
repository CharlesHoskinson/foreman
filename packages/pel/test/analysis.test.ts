import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { checkPel } from "../src/checker.js";
import { validateAuthoringSnapshotV1 } from "../src/snapshot.js";
const snapshot = () => {
  const value = validateAuthoringSnapshotV1(
    JSON.parse(
      readFileSync(
        "packages/pel/test/fixtures/authoring-snapshot.json",
        "utf8",
      ),
    ),
  );
  assert.ok(value.ok, JSON.stringify(value));
  return value.value;
};
function checked(source: string) {
  return checkPel({
    source: new TextEncoder().encode(source),
    snapshot: snapshot(),
  });
}
test("T-M2-001 pure checking preserves values and checks unselected syntax", () => {
  const good = checked("(+ 1 2)");
  assert.equal(good.tag, "ok");
  if (good.tag === "ok")
    assert.deepEqual(good.checked.analysis.finalValueSummary, {
      kind: "known",
      value: { tag: "number", value: 3 },
    });
  for (const [source, code] of [
    ["(if #t 1 missing)", "PEL_UNBOUND_SYMBOL"],
    ["(lambda [:x] missing)", "PEL_UNBOUND_SYMBOL"],
    ["(+ :x missing 2)", "PEL_ARGUMENT_MODE"],
  ] as const) {
    const bad = checked(source);
    assert.equal(bad.tag, "invalid");
    if (bad.tag === "invalid") assert.equal(bad.diagnostics[0]?.code, code);
  }
  assert.equal(checked("'missing").tag, "ok");
});
test("T-M2-016 a known branch defines a subsequent binding", () => {
  const result = checked("(if #t (def x 1) 7) x");
  assert.equal(result.tag, "ok");
  if (result.tag === "ok")
    assert.deepEqual(result.checked.analysis.finalValueSummary, {
      kind: "known",
      value: { tag: "number", value: 1 },
    });
});
test("T-M2-001 pure preview preserves M1 closures, defaults, blocks, pipes, and case", () => {
  const cases: readonly (readonly [string, number | string])[] = [
    ["(def n 5) (def f (lambda [] n)) (do (def n 9) (f))", 5],
    ["(do [(def x 1) (+ x 2)])", 3],
    ["3 |> (+ 4)", 7],
    ['7 |> (case [(gt ^ 5) "big" #t "small"])', "big"],
    ['(case [1 2 3 4 5 6] [(len) |> (gt 5) "big" #t "small"])', "big"],
    ['(def c (case :body [(gt ^ 5) "big" #t "small"])) 7 |> (c)', "big"],
    ["(def make 7 |> (lambda [:x ^])) (def f (make x)) (f)", 7],
    ["(def make 7 |> (lambda :body ^)) (def f (make [:x])) (f 2)", 7],
    ["(if #t 1 (/ 1 0))", 1],
    [
      "(def fact (lambda [:n] (if (lt n 2) 1 (* n (fact (- n 1)))))) (fact 5)",
      120,
    ],
    ["(def apply (lambda [:f] (f 2))) (apply (+ 3))", 5],
  ];
  for (const [source, value] of cases) {
    const result = checked(source);
    assert.equal(result.tag, "ok", JSON.stringify({ source, result }));
    if (result.tag === "ok")
      assert.deepEqual(result.checked.analysis.finalValueSummary, {
        kind: "known",
        value: { tag: typeof value, value },
      });
  }
});
test("T-M2-001 executable syntax is checked without dispatching unreachable bodies", () => {
  assert.equal(checked("(lambda [:f] (f 2))").tag, "ok");
  assert.equal(checked('(if #t 1 (+ "wrong" 2))').tag, "invalid");
  assert.equal(checked("(lambda [:x] (fm/task :bad 1))").tag, "invalid");
});
test("T-M2-007 normalized syntax ignores whitespace but source binding preserves it", () => {
  const a = checked("(+ 1 2)"),
    b = checked("( +  1  2 )");
  assert.equal(a.tag, "ok");
  assert.equal(b.tag, "ok");
  if (a.tag === "ok" && b.tag === "ok") {
    assert.notEqual(a.checked.bindingDigest, b.checked.bindingDigest);
    assert.deepEqual(a.checked.normalizedAst, b.checked.normalizedAst);
  }
});
test("T-M2-006 retry and race include finite child closure effects in their preview", () => {
  const retry = checked(
    '(fm/retry :attempts 2 :on [\':Timeout] :body (lambda [] (fm/checkpoint "retry")))',
  );
  assert.equal(retry.tag, "ok");
  if (retry.tag === "ok") {
    assert.ok(
      retry.checked.analysis.effects.some(
        (e) => e.registryId === "fm/checkpoint",
      ),
    );
    assert.ok(
      retry.checked.analysis.dynamicRegions.some((r) => r.maxCalls >= 2),
    );
  }
  const race = checked(
    '(fm/race :tasks [(lambda [] (fm/checkpoint "a")) (lambda [] (fm/checkpoint "b"))] :winner "first-valid")',
  );
  assert.equal(race.tag, "ok");
  if (race.tag === "ok")
    assert.equal(
      race.checked.analysis.effects.filter(
        (e) => e.registryId === "fm/checkpoint",
      ).length,
      2,
    );
});
test("T-M2-011 errors expose registered signatures and nearby symbol suggestions", () => {
  for (const source of [
    '(fm/task "x" :model "role:implementer")',
    "(fm/tsk)",
  ]) {
    const result = checked(source);
    assert.equal(result.tag, "invalid");
    if (result.tag === "invalid") {
      assert.match(result.diagnostics[0]?.signature ?? "", /fm\/task/);
      assert.ok(result.diagnostics[0]?.help);
    }
  }
});
test("T-M2-001 dead case clauses retain the scrutinee caret scope", () => {
  const result = checked("(case 7 [#t 1 (gt ^ 5) 2])");
  assert.equal(result.tag, "ok");
});
