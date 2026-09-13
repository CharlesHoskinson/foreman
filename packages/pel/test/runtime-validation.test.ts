import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import { DEFAULT_LIMITS } from "../src/profile.js";
import * as validation from "../src/runtime-validation.js";
const defaults = {
  dependencyMode: "ordered",
  nlConditionProfile: null,
  nlConditionProfileDigest: null,
  replay: { mode: "none" },
};
const counters = {
  sourceBytes: 0,
  tokens: 0,
  astNodes: 0,
  syntaxDepthPeak: 0,
  reductions: 0,
  iterations: 0,
  callDepthPeak: 0,
  valueBytesPeak: 0,
};
const selection = (controls: unknown = {}) => ({
  profileId: "fixture",
  transportId: "fixture",
  credentialProfileRef: "account:fixture",
  outputSchemaId: "schema:pel-boolean-v1",
  controls,
});
const selected = (controls: unknown = {}) => {
  const value = selection(controls);
  return {
    ...defaults,
    nlConditionProfile: value,
    nlConditionProfileDigest: sha256Hex(canonicalize(value)),
  };
};
const replay = () => ({
  ...defaults,
  replay: {
    mode: "completed-prefix",
    completedPrefixCount: 1,
    prefixDigest: "a".repeat(64),
    recordedCounters: { ...counters, reductions: 3 },
    committedCounters: { ...counters, reductions: 4 },
    maxReplayReductions: 10,
  },
});
test("runtime validation APIs are available", () => {
  assert.equal(typeof validation.validateRunOptions, "function");
  assert.equal(typeof validation.validateLimits, "function");
});
test("runtime options and limits preserve valid closed values as immutable snapshots", () => {
  const input = selected({ temperature: 0.3, flags: [true, null, "😀"] });
  const result = validation.validateRunOptions(input);
  assert.ok(result.ok);
  assert.deepEqual(result.value, input);
  input.nlConditionProfile.controls = { changed: true };
  assert.deepEqual(result.value.nlConditionProfile?.controls, {
    temperature: 0.3,
    flags: [true, null, "😀"],
  });
  assert.ok(Object.isFrozen(result.value));
  assert.ok(Object.isFrozen(result.value.replay));
  assert.ok(Object.isFrozen(result.value.nlConditionProfile?.controls));
  const limits = validation.validateLimits(DEFAULT_LIMITS);
  assert.ok(limits.ok);
  assert.deepEqual(limits.value, DEFAULT_LIMITS);
  assert.ok(Object.isFrozen(limits.value));
  assert.ok(
    validation.validateRunOptions({ ...defaults, dependencyMode: "automatic" })
      .ok,
  );
  assert.ok(validation.validateRunOptions(replay()).ok);
});
test("runtime options reject missing fields, unknown modes and extra properties", () => {
  for (const input of [
    null,
    {},
    [],
    { ...defaults, extra: true },
    { ...defaults, dependencyMode: "unsafe" },
    { ...defaults, replay: null },
    { ...defaults, replay: { mode: "other" } },
    { ...defaults, replay: { mode: "none", extra: true } },
  ])
    assert.equal(validation.validateRunOptions(input).ok, false);
  const missing = { ...defaults } as Record<string, unknown>;
  delete missing.nlConditionProfileDigest;
  assert.equal(validation.validateRunOptions(missing).ok, false);
});
test("runtime options reject invalid predicate identity, digest and output schema", () => {
  for (const input of [
    { ...defaults, nlConditionProfileDigest: "a".repeat(64) },
    { ...selected(), nlConditionProfileDigest: "a".repeat(64) },
    { ...selected(), nlConditionProfile: { ...selection(), profileId: "" } },
    {
      ...selected(),
      nlConditionProfile: { ...selection(), outputSchemaId: "schema:other" },
    },
    { ...selected(), nlConditionProfile: { ...selection(), extra: 1 } },
  ])
    assert.equal(validation.validateRunOptions(input).ok, false);
});
test("runtime option inspection never invokes accessors and rejects active objects", () => {
  let reads = 0;
  const getter = { ...defaults };
  Object.defineProperty(getter, "dependencyMode", {
    get() {
      reads++;
      return "ordered";
    },
  });
  assert.equal(validation.validateRunOptions(getter).ok, false);
  assert.equal(reads, 0);
  const controls = {};
  Object.defineProperty(controls, "value", {
    enumerable: true,
    get() {
      reads++;
      return 1;
    },
  });
  assert.equal(
    validation.validateRunOptions({
      ...defaults,
      nlConditionProfile: selection(controls),
      nlConditionProfileDigest: "a".repeat(64),
    }).ok,
    false,
  );
  assert.equal(reads, 0);
  const symbol = { ...defaults, [Symbol("hidden")]: 1 };
  assert.equal(validation.validateRunOptions(symbol).ok, false);
  assert.equal(
    validation.validateRunOptions(
      Object.assign(Object.create({ inherited: true }), defaults),
    ).ok,
    false,
  );
  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error("trap");
      },
    },
  );
  assert.equal(validation.validateRunOptions(proxy).ok, false);
});
test("runtime controls reject cycles, unsupported JSON and invalid Unicode", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const sparse = Array(2);
  sparse[1] = 1;
  const extra = [1] as unknown[] & { extra?: number };
  extra.extra = 2;
  for (const controls of [
    cycle,
    NaN,
    Infinity,
    undefined,
    () => 1,
    1n,
    new Date(),
    sparse,
    extra,
    "\ud800",
    { bad: "\udfff" },
  ]) {
    assert.equal(
      validation.validateRunOptions({
        ...defaults,
        nlConditionProfile: selection(controls),
        nlConditionProfileDigest: "a".repeat(64),
      }).ok,
      false,
    );
  }
  let deep: unknown = 0;
  for (let i = 0; i < 65; i++) deep = [deep];
  assert.equal(
    validation.validateRunOptions({
      ...defaults,
      nlConditionProfile: selection(deep),
      nlConditionProfileDigest: "a".repeat(64),
    }).ok,
    false,
  );
});
test("runtime replay counters are exact, safe and monotonic", () => {
  for (const input of [
    { ...replay(), replay: { ...replay().replay, completedPrefixCount: -1 } },
    {
      ...replay(),
      replay: { ...replay().replay, maxReplayReductions: Infinity },
    },
    {
      ...replay(),
      replay: { ...replay().replay, prefixDigest: "not-a-digest" },
    },
    {
      ...replay(),
      replay: {
        ...replay().replay,
        recordedCounters: { ...counters, extra: 1 },
      },
    },
    {
      ...replay(),
      replay: {
        ...replay().replay,
        committedCounters: { ...counters, reductions: 2 },
      },
    },
    {
      ...replay(),
      replay: {
        ...replay().replay,
        recordedCounters: { ...counters, tokens: 0.5 },
      },
    },
    {
      ...replay(),
      replay: {
        ...replay().replay,
        committedCounters: { ...counters, reductions: 2 ** 53 },
      },
    },
  ])
    assert.equal(validation.validateRunOptions(input).ok, false);
});
test("runtime limits reject missing fields, unknown fields, invalid bounds and accessors", () => {
  for (const input of [
    null,
    {},
    [],
    { ...DEFAULT_LIMITS, extra: 1 },
    ...[-1, Infinity, NaN, 0.5, 2 ** 53].map((maxReductions) => ({
      ...DEFAULT_LIMITS,
      maxReductions,
    })),
  ]) {
    const result = validation.validateLimits(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "PEL_LIMIT");
  }
  let reads = 0;
  const input = { ...DEFAULT_LIMITS };
  Object.defineProperty(input, "maxTokens", {
    get() {
      reads++;
      return 1;
    },
  });
  assert.equal(validation.validateLimits(input).ok, false);
  assert.equal(reads, 0);
  assert.ok(
    validation.validateLimits(
      Object.fromEntries(Object.keys(DEFAULT_LIMITS).map((k) => [k, 0])),
    ).ok,
  );
});
test("runtime canonical JSON preserves ordinary prototype-spelled keys and shared data", () => {
  const shared = { x: 1 };
  const controls = JSON.parse(
    '{"__proto__":{"a":1},"constructor":"data"}',
  ) as Record<string, unknown>;
  controls.first = shared;
  controls.second = shared;
  const result = validation.validateRunOptions(selected(controls));
  assert.ok(result.ok);
  assert.deepEqual(result.value.nlConditionProfile?.controls, controls);
});
