import { validateAuthoringSnapshotV1 } from "../src/snapshot.js";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createHostRegistry,
  type HostFunctionDescriptorSpecV1,
} from "../src/host-contract.js";
import {
  createAuthoringSnapshotV1,
  buildEffectiveAuthoringSnapshotV1,
} from "../src/snapshot.js";
import { checkPel } from "../src/checker.js";
import { planPel } from "../src/preview.js";
import type {
  AuthoringSnapshotContentV1,
  AuthoringSnapshotV1,
} from "../src/authoring-types.js";

type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;
function fixture(
  mutate?: (snapshot: Mutable<AuthoringSnapshotContentV1>) => void,
  maxItems = 4,
): AuthoringSnapshotV1 {
  const base = loadAuthoringSnapshotFixture();
  const descriptor = (
    id: string,
    schema: string,
  ): HostFunctionDescriptorSpecV1 => ({
    id,
    name: id,
    argSpec: { kind: "fixed", parameters: [] },
    resultSchemaId: schema,
    failureSchemaId: "schema:pel-host-failure-v1",
    effectKind: "read",
    capabilities: ["fixture.read"],
    resources: { reads: [], writes: [], unknown: false },
    resourceResolverId: "static",
    resourceEnvelope: {},
  });
  const raw = JSON.parse(
    JSON.stringify(base),
  ) as Mutable<AuthoringSnapshotContentV1>;
  const schemas = { ...raw.registry.dataSchemas };
  delete schemas["schema:pel-data-v1"];
  delete schemas["schema:pel-boolean-v1"];
  schemas["schema:fixture-items-v1"] = {
    type: "list",
    minItems: 0,
    maxItems,
    items: { type: "string", maxBytes: 4096 },
  };
  const failures = { ...raw.registry.failureSchemas };
  delete failures["schema:pel-host-failure-v1"];
  const registry = createHostRegistry(
    [
      ...raw.registry.descriptors.filter(
        (d: HostFunctionDescriptorSpecV1) =>
          !["print", "pel/nl-condition"].includes(d.id),
      ),
      descriptor("fixture/bool", "schema:pel-boolean-v1"),
      descriptor("fixture/items", "schema:fixture-items-v1"),
      descriptor("fixture/data", "schema:pel-data-v1"),
    ],
    schemas,
    failures,
    raw.registry.resolverCatalog,
  );
  assert.ok(registry.ok, JSON.stringify(registry));
  raw.policy.allowedCapabilities.push("fixture.read");
  raw.policy.allowedEffectKinds.push("read");
  raw.policy.allowedSchemaIds.push("schema:fixture-items-v1");
  mutate?.(raw);
  const snapshot = createAuthoringSnapshotV1({
    ...raw,
    registry: registry.value,
  });
  assert.ok(snapshot.ok, JSON.stringify(snapshot));
  return snapshot.value;
}
function check(source: string, snapshot = fixture()) {
  return checkPel({ source: new TextEncoder().encode(source), snapshot });
}
function preview(source: string, snapshot = fixture()) {
  const result = check(source, snapshot);
  assert.equal(
    result.tag,
    "ok",
    JSON.stringify(
      result.tag === "invalid" ? result.diagnostics : result.checked.analysis,
    ),
  );
  if (result.tag !== "ok") throw Error("Invalid fixture");
  return planPel(result.checked);
}
function invalid(source: string, code: string, snapshot = fixture()) {
  const result = check(source, snapshot);
  assert.equal(
    result.tag,
    "invalid",
    JSON.stringify(
      result.tag === "invalid" ? result.diagnostics : result.checked.analysis,
    ),
  );
  if (result.tag === "invalid")
    assert.ok(
      result.diagnostics.some((d) => d.code === code),
      JSON.stringify(result.diagnostics),
    );
}
const task = (id: string, input = '"artifact:approved-spec"') =>
  `(fm/task :id "${id}" :model "role:implementer" :input ${input} :output "schema:candidate-v1")`;

test("T-M2-004 unknown Boolean preserves both effect alternatives and required result uncertainty", () => {
  const result = preview(
    `(def c (fixture/bool)) (if c ${task("yes")} ${task("no")})`,
  );
  assert.equal(result.status, "bounded-dynamic");
  assert.equal(
    result.effects.filter((e) => e.registryId === "fm/task").length,
    2,
  );
  assert.ok(
    result.dynamicRegions.some((r) => r.reason === "unknown condition"),
  );
  assert.equal(result.finalValueSummary.kind, "unresolved");
  const tasks = result.effects.filter((e) => e.registryId === "fm/task");
  assert.equal(tasks[0]?.model?.profileId, "grok-4.6");
  assert.equal(tasks[0]?.model?.transportId, "grok-acp");
  assert.notEqual(tasks[0]?.branch, tasks[1]?.branch);
});

test("T-M2-016 both-branch definitions are definite and one-branch definitions are conditional", () => {
  const good = preview("(def c (fixture/bool)) (if c (def x 1) (def x 2)) x");
  assert.equal(good.finalValueSummary.kind, "unresolved");
  if (good.finalValueSummary.kind === "unresolved")
    assert.equal(good.finalValueSummary.schema?.type, "number");
  invalid(
    "(def c (fixture/bool)) (if c (def x 1) 7) x",
    "PEL_CONDITIONAL_BINDING",
  );
});

test("T-M2-004 schema-constrained loops expose the admitted four-iteration bound", () => {
  const result = preview(
    `(def items (fixture/items)) (for items item ${task("loop", "item")})`,
  );
  const loop = result.dynamicRegions.find(
    (r) => r.reason === "unknown collection",
  );
  assert.ok(loop);
  assert.equal(loop.maxIterations, 4);
  assert.equal(loop.maxCalls, 4);
  assert.deepEqual(loop.possibleRegistryIds, ["fm/task"]);
});

test("T-M2-006 arbitrary unknown callable is rejected", () => {
  invalid("((fixture/data) 1)", "PEL_DYNAMIC_EFFECT_UNBOUNDED");
});

test("T-M2-005 reachable denied capability fails while a valid dead effect is omitted", () => {
  const denied = fixture((s) => {
    s.policy.allowedCapabilities = s.policy.allowedCapabilities.filter(
      (x: string) => x !== "task.execute",
    );
  });
  invalid(task("denied"), "PEL_CAPABILITY_DENIED", denied);
  const dead = preview(`(if #f ${task("dead")} 3)`, denied);
  assert.deepEqual(dead.effects, []);
  assert.deepEqual(dead.finalValueSummary, {
    kind: "known",
    value: { tag: "number", value: 3 },
  });
});

test("T-M2-005 unsupported effect kind reports the specified diagnostic", () => {
  const denied = fixture((s) => {
    s.policy.allowedEffectKinds = s.policy.allowedEffectKinds.filter(
      (x: string) => x !== "task",
    );
  });
  invalid(task("unsupported"), "PEL_UNSUPPORTED_EFFECT", denied);
});

test("T-M2-003 an ambiguous exact model never silently selects a transport", () => {
  invalid(
    '(fm/task :id "t" :model "gpt-5.6-sol" :input "artifact:approved-spec" :output "schema:candidate-v1")',
    "PEL_PROFILE_UNSUPPORTED",
  );
});

test("T-M2-004 independent writes require resource serialization", () => {
  const result = preview(`(do/async ${task("a")} ${task("b")})`);
  const tasks = result.effects.filter((e) => e.registryId === "fm/task");
  assert.equal(tasks.length, 2);
  assert.ok(
    result.dependencies.some(
      (d) =>
        d.kind === "serialization" &&
        d.from === tasks[0]!.effectId &&
        d.to === tasks[1]!.effectId,
    ),
  );
});

test("T-M2-005 explicit workspace references outside the admitted envelope are rejected", () => {
  invalid(task("outside", '"workspace:outside"'), "PEL_RESOURCE_DENIED");
});

test("T-M2-004 potentially concurrent writes in separate conditionals retain serialization", () => {
  const result = preview(
    `(def c (fixture/bool)) (do/async (if c ${task("a")} 0) (if c ${task("b")} 0))`,
  );
  const tasks = result.effects.filter((e) => e.registryId === "fm/task");
  assert.equal(tasks.length, 2);
  assert.ok(
    result.dependencies.some(
      (d) =>
        d.kind === "serialization" &&
        d.from === tasks[0]!.effectId &&
        d.to === tasks[1]!.effectId,
    ),
    "Separate conditions may both select their writes",
  );
});

test("T-M2-006 the aggregate of bounded loops fits the whole-plan effect budget", () => {
  const tight = fixture((s) => {
    s.policy.maxEffects = 6;
  });
  const result = check(
    `(def items (fixture/items)) (for items item ${task("a", "item")}) (for items item ${task("b", "item")})`,
    tight,
  );
  assert.equal(
    result.tag,
    "invalid",
    "Two four-call loops plus their producer exceed maxEffects=6",
  );
});

test("T-M2-014 narrowed source and value limits apply during checking", () => {
  const base = fixture();
  const narrowed = buildEffectiveAuthoringSnapshotV1(base, {
    narrowingLimits: { maxSourceBytes: 5 },
  });
  assert.ok(narrowed.ok);
  invalid("(+ 1 2)", "PEL_LIMIT", narrowed.value);
});

test("T-M2-004 literal case predicates require the exact admitted selection", () => {
  const result = preview('(case 3 ["is greater than two" 1 #t 0])');
  const predicate = result.effects.find(
    (e) => e.registryId === "pel/nl-condition",
  );
  assert.ok(predicate);
  assert.equal(predicate.model?.profileId, "gpt-5.6-sol");
  assert.equal(predicate.model?.transportId, "openai-responses");
  invalid(
    '(case 3 ["is greater than two" 1 #t 0])',
    "PEL_PROFILE_UNSUPPORTED",
    fixture((s) => {
      s.nlConditionProfile = null;
    }),
  );
});

test("T-M2-005 review policies must be selected from the admitted policy IDs", () => {
  const result = check(
    '(fm/review :id "r" :model "role:reviewer" :input "artifact:approved-spec" :policy "untrusted:skip-review")',
  );
  assert.equal(
    result.tag,
    "invalid",
    "An arbitrary review policy is not admitted",
  );
});

test("T-M2-011 unresolved association results retain their schema and source origins", () => {
  const result = preview(task("unresolved"));
  assert.equal(result.finalValueSummary.kind, "unresolved");
  if (result.finalValueSummary.kind !== "unresolved") return;
  assert.equal(result.finalValueSummary.schemaId, "schema:task-result-v1");
  assert.ok(result.finalValueSummary.originSpans.length > 0);
});

test("T-M2-004 condition-dependent effects retain their producer dependency", () => {
  const result = preview(
    `(def c (fixture/bool)) (if c ${task("yes")} ${task("no")})`,
  );
  const producer = result.effects.find((e) => e.registryId === "fixture/bool")!;
  for (const effect of result.effects.filter((e) => e.registryId === "fm/task"))
    assert.ok(
      result.dependencies.some(
        (d) => d.from === producer.effectId && d.to === effect.effectId,
      ),
      "A branch cannot run until its condition result exists",
    );
});

test("T-M2-014 narrowed value bounds reject oversized pure values", () => {
  const narrowed = buildEffectiveAuthoringSnapshotV1(fixture(), {
    narrowingLimits: { maxValueBytes: 32 },
  });
  assert.ok(narrowed.ok);
  invalid(
    '"this literal contains more than thirty-two serialized bytes"',
    "PEL_LIMIT",
    narrowed.value,
  );
});

test("T-M2-005 host string identifiers reject nil even when all required arguments are present", () => {
  invalid(
    '(fm/task :id #nil :model "role:implementer" :input "artifact:approved-spec" :output "schema:candidate-v1")',
    "PEL_TYPE",
  );
});

test("T-M2-004 research collection bounds respect the actual requested limit", () => {
  const result = preview(
    `(def result (fm/research :id "r" :query "q" :bundle "artifact:source-a" :limit 4)) (for (result ':results) row ${task("row")})`,
  );
  const region = result.dynamicRegions.find(
    (r) => r.reason === "unknown collection",
  );
  assert.ok(region);
  assert.equal(region.maxIterations, 4);
});

test("T-M2-007 checked analysis cannot be edited into a forged preview", () => {
  const checked = check(task("immutable"));
  assert.equal(checked.tag, "ok");
  if (checked.tag !== "ok") return;
  assert.ok(Object.isFrozen(checked.checked.analysis));
  assert.ok(Object.isFrozen(checked.checked.analysis.effects));
  assert.ok(Object.isFrozen(checked.checked.analysis.effects[0]));
});

test("T-M2-006 finite host closure alternatives preserve distinct partial arguments", () => {
  const result = preview(
    '(def c (fixture/bool)) (def selected (if c (fm/task :id "left") (fm/task :id "right"))) (selected :model "role:implementer" :input "artifact:approved-spec" :output "schema:candidate-v1")',
  );
  const tasks = result.effects.filter((e) => e.registryId === "fm/task");
  assert.equal(tasks.length, 2);
  assert.deepEqual(
    tasks
      .map((e) => e.arguments.id)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    [
      { kind: "known", value: { tag: "string", value: "left" } },
      { kind: "known", value: { tag: "string", value: "right" } },
    ],
  );
});

test("T-M2-006 nested dynamic loop bounds multiply within the aggregate effect budget", () => {
  const tight = fixture((s) => {
    s.policy.maxEffects = 10;
  });
  const result = check(
    `(def items (fixture/items)) (for items outer (for items inner ${task("nested")}))`,
    tight,
  );
  assert.equal(
    result.tag,
    "invalid",
    "Four outer by four inner iterations exceed a ten-effect budget",
  );
});

test("T-M2-006 an unknown collection with maxItems zero emits no phantom body effects", () => {
  const empty = fixture((s) => {
    s.policy.maxEffects = 1;
    s.policy.allowedCapabilities = s.policy.allowedCapabilities.filter(
      (x) => x !== "task.execute",
    );
  }, 0);
  const result = preview(`(for (fixture/items) item ${task("never")})`, empty);
  assert.deepEqual(
    result.effects.map((e) => e.registryId),
    ["fixture/items"],
  );
  assert.ok(result.dynamicRegions.every((r) => r.maxCalls === 0));
});

function loadAuthoringSnapshotFixture() {
  const result = validateAuthoringSnapshotV1(
    JSON.parse(
      readFileSync(
        "packages/pel/test/fixtures/authoring-snapshot.json",
        "utf8",
      ),
    ),
  );
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

test("T-M2-004 merged association fields remain unresolved and cannot prune reachable effects", () => {
  const result = preview(
    `(def c (fixture/bool)) (def result (if c ${task("left")} ${task("right")})) (if (eq (result ':status) "candidate-ready") (fm/checkpoint "eligible") #nil)`,
  );
  assert.equal(
    result.effects.filter((e) => e.registryId === "fm/checkpoint").length,
    1,
    "Both possible task results may have candidate-ready status",
  );
});

test("T-M2-001 schema list bounds reject a statically impossible lookup index", () => {
  invalid("((fixture/items) 100)", "PEL_INDEX");
});

test("T-M2-001 a union with no numeric variant cannot satisfy a numeric argument", () => {
  invalid(`(+ (${task("candidate")} ':candidate) 1)`, "PEL_TYPE");
});

test("T-M2-004 ordered case alternatives retain dependencies on the predicate result", () => {
  const result = preview(
    '(case 1 ["is one" (fm/checkpoint "yes") #t (fm/checkpoint "fallback")])',
  );
  const predicate = result.effects.find(
    (e) => e.registryId === "pel/nl-condition",
  )!;
  for (const effect of result.effects.filter(
    (e) => e.registryId === "fm/checkpoint",
  ))
    assert.ok(
      result.dependencies.some(
        (d) => d.from === predicate.effectId && d.to === effect.effectId,
      ),
      "The first predicate determines whether this case result is selected",
    );
});

test("T-M2-006 retry and race cannot hide denied child capabilities", () => {
  const denied = fixture((s) => {
    s.policy.allowedCapabilities = s.policy.allowedCapabilities.filter(
      (x) => x !== "task.execute",
    );
  });
  invalid(
    `(fm/retry :attempts 2 :on [':Timeout] :body (lambda [] ${task("retry")}))`,
    "PEL_CAPABILITY_DENIED",
    denied,
  );
  invalid(
    `(fm/race :tasks [(lambda [] ${task("race")} ) (lambda [] 1)] :winner "first-valid")`,
    "PEL_CAPABILITY_DENIED",
    denied,
  );
});

test("T-M2-001 list argument-mode validation also applies to direct known selections", () => {
  invalid("([1 2] :at 1 :from 1)", "PEL_ARGUMENT_MODE");
});

test("T-M2-004 an identity lookup preserves an unknown collection schema and iteration bound", () => {
  const result = preview(
    `(for ((fixture/items)) item ${task("identity", "item")})`,
  );
  const loop = result.dynamicRegions.find(
    (r) => r.reason === "unknown collection",
  );
  assert.ok(loop);
  assert.equal(loop.maxIterations, 4);
});

test("T-M2-006 unknown resources remain inside a declared scope or fail before dispatch", () => {
  const result = preview(task("bounded", "(fixture/data)"));
  const region = result.dynamicRegions.find(
    (r) => r.reason === "unknown argument",
  );
  assert.ok(region);
  assert.deepEqual(region.resources, fixture().policy.resourceEnvelope);
  assert.ok(region.deferredRequirements.length);
  const noScope = fixture((s) => {
    s.policy.resourceEnvelope = { reads: [], writes: [] };
  });
  const rejected = check(task("unbounded", "(fixture/data)"), noScope);
  assert.equal(rejected.tag, "invalid");
});

test("T-M2-004 slicing an unknown collection preserves a finite list bound", () => {
  const result = preview(
    `(def items (fixture/items)) (for (items :from 2 :to 4) item ${task("slice", "item")})`,
  );
  assert.equal(
    result.dynamicRegions.find((r) => r.reason === "unknown collection")
      ?.maxIterations,
    3,
  );
});
