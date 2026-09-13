import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import { PEL_PROFILE } from "../src/profile.js";

const modulePath = "../src/host-contract.js";
const host = (await import(modulePath).catch(
  () => ({}),
)) as typeof import("../src/host-contract.js");
const descriptor = (id = "test/read") => ({
  id,
  name: id,
  argSpec: {
    kind: "fixed",
    parameters: [{ name: "input", required: true, evaluation: "strict" }],
  },
  resultSchemaId: "schema:test",
  failureSchemaId: "schema:test-failure",
  effectKind: "read",
  capabilities: ["test.read"],
  resources: { reads: ["fixture:data"], writes: [], unknown: false },
  resourceResolverId: "static",
  resourceEnvelope: { scope: "fixture" },
});
const dataSchemas = { "schema:test": { type: "boolean" } };
const failureSchemas = {
  "schema:test-failure": {
    codes: ["denied"],
    maxMessageBytes: 32,
    maxCauseBytes: 128,
    requiredCauseKeys: ["reason"],
  },
};
function registry() {
  const result = host.createHostRegistry(
    [descriptor()] as never,
    dataSchemas as never,
    failureSchemas,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("registry rejected");
  return result.value;
}
const request = () => ({
  requestId: "request:1",
  sourceDigest: "a".repeat(64),
  nodeId: "node:1",
  invocationOrdinal: 0,
  invocationPath: "top/0",
  registryId: "test/read",
  boundArguments: { input: { tag: "nil" } },
  expectedResultSchemaId: "schema:test",
});

test("T-M1-017 registry API exists before host execution", () => {
  assert.equal(typeof host.createHostRegistry, "function");
});
test("T-M1-017 registry adds fixed builtins, sorts identity and freezes detached input", () => {
  const a = descriptor("z/read"),
    b = descriptor("a/read");
  const first = host.createHostRegistry(
    [a, b] as never,
    dataSchemas as never,
    failureSchemas,
  );
  const second = host.createHostRegistry(
    [b, a] as never,
    dataSchemas as never,
    failureSchemas,
  );
  assert.ok(first.ok && second.ok);
  assert.equal(first.value.digest, second.value.digest);
  assert.deepEqual(
    first.value.descriptors.map((d) => d.id),
    ["a/read", "pel/nl-condition", "print", "z/read"],
  );
  assert.equal(
    host.getHostDescriptor(first.value, "print")?.argSpec.kind,
    "fixed",
  );
  const predicate = host.getHostDescriptor(first.value, "pel/nl-condition")!;
  assert.deepEqual(predicate.argSpec, {
    kind: "fixed",
    parameters: [
      { name: "scrut", required: true, evaluation: "strict" },
      { name: "condition", required: true, evaluation: "strict" },
    ],
  });
  a.resources.reads.push("changed");
  assert.deepEqual(
    host.getHostDescriptor(first.value, "z/read")?.resources.reads,
    ["fixture:data"],
  );
  assert.equal(Object.isFrozen(first.value), true);
  assert.equal(
    Object.isFrozen(first.value.descriptors[0]?.resources.reads),
    true,
  );
  assert.equal(host.verifyRegistry(first.value), true);
  assert.equal(
    host.verifyRegistry({ ...first.value, digest: "0".repeat(64) }),
    false,
  );
  assert.equal(
    host.verifyRegistry(JSON.parse(JSON.stringify(first.value))),
    false,
  );
  const { digest, ...payload } = first.value;
  assert.equal(digest, sha256Hex(canonicalize(payload)));
  assert.equal(first.value.profileDigest, PEL_PROFILE.digest);
});
test("T-M1-017 malformed descriptors and unknown references fail closed", () => {
  const bad = [
    [descriptor(), descriptor()],
    [descriptor(), { ...descriptor("other"), name: "test/read" }],
    [{ ...descriptor(), resultSchemaId: "unknown" }],
    [{ ...descriptor(), failureSchemaId: "unknown" }],
    [{ ...descriptor(), resourceResolverId: "unknown" }],
    [{ ...descriptor(), extra: true }],
    [
      {
        ...descriptor(),
        resources: { reads: [], writes: [], unknown: false, bypass: true },
      },
    ],
    [
      {
        ...descriptor(),
        argSpec: {
          kind: "fixed",
          parameters: [
            { name: "x", required: true, evaluation: "strict" },
            { name: "x", required: true, evaluation: "strict" },
          ],
        },
      },
    ],
    [
      {
        ...descriptor(),
        argSpec: {
          kind: "fixed",
          parameters: [{ name: "x", required: false, evaluation: "strict" }],
        },
      },
    ],
    [
      {
        ...descriptor(),
        argSpec: {
          kind: "fixed",
          parameters: [{ name: "x", required: true, evaluation: "surprise" }],
        },
      },
    ],
    [{ ...descriptor(), resourceEnvelope: { executable: () => true } }],
    [{ ...descriptor(), name: "print" }],
  ];
  for (const input of bad) {
    const result = host.createHostRegistry(
      input as never,
      dataSchemas as never,
      failureSchemas,
    );
    assert.equal(result.ok, false, JSON.stringify(input));
    if (!result.ok) assert.equal(result.error[0]?.code, "PEL_REGISTRY");
  }
});
test("T-M1-017 schemas reject unknown keys, cycles, impossible bounds and excess complexity", () => {
  const cycle: Record<string, unknown> = {
    type: "list",
    minItems: 0,
    maxItems: 1,
  };
  cycle.items = cycle;
  let deep: unknown = { type: "boolean" };
  for (let n = 0; n < 33; n++)
    deep = { type: "list", minItems: 0, maxItems: 1, items: deep };
  const bad = [
    { type: "boolean", surprise: true },
    { type: "number", integer: true, minimum: 2, maximum: 1 },
    { type: "number", integer: false, minimum: 0, maximum: Infinity },
    { type: "string", maxBytes: -1 },
    cycle,
    deep,
    {
      type: "association",
      fields: [
        { key: "a", schema: { type: "boolean" }, required: true },
        { key: "a", schema: { type: "boolean" }, required: false },
      ],
      additionalKeys: false,
    },
    { type: "union", variants: [] },
  ];
  for (const schema of bad)
    assert.equal(
      host.createHostRegistry(
        [descriptor()] as never,
        { "schema:test": schema } as never,
        failureSchemas,
      ).ok,
      false,
    );
  assert.equal(
    host.createHostRegistry(
      [],
      {},
      { bad: { ...failureSchemas["schema:test-failure"], codes: ["x", "x"] } },
    ).ok,
    false,
  );
  assert.equal(
    host.createHostRegistry([], {
      "schema:pel-boolean-v1": { type: "nil" },
    } as never).ok,
    false,
  );
});
test("T-M1-017 association schema enforces field order, optional absence and unique keys", () => {
  const schema = {
    type: "association",
    fields: [
      { key: "ok", schema: { type: "boolean" }, required: true },
      { key: "note", schema: { type: "string", maxBytes: 4 }, required: false },
    ],
    additionalKeys: false,
  } as const;
  const ok = {
    tag: "pair",
    key: "ok",
    value: { tag: "boolean", value: true },
  } as const;
  const note = {
    tag: "pair",
    key: "note",
    value: { tag: "string", value: "éé" },
  } as const;
  assert.equal(
    host.validateDataSchema({ tag: "list", items: [ok, note] }, schema),
    true,
  );
  assert.equal(
    host.validateDataSchema({ tag: "list", items: [ok] }, schema),
    true,
  );
  for (const items of [[note, ok], [ok, ok], [note], [{ ...ok, key: "other" }]])
    assert.equal(
      host.validateDataSchema({ tag: "list", items }, schema),
      false,
    );
  assert.equal(
    host.validateDataSchema(
      { tag: "number", value: 2 ** 53 },
      { type: "number", integer: true, minimum: 0, maximum: 2 ** 53 },
    ),
    false,
  );
  assert.equal(
    host.validateDataSchema(
      { tag: "string", value: "\ud800" },
      { type: "string", maxBytes: 8 },
    ),
    false,
  );
});
test("T-M1-012 receipts bind identity and schema and reject executable or malformed values", () => {
  const r = registry(),
    req = request();
  const valid = {
    requestId: req.requestId,
    outcome: { tag: "success", value: { tag: "boolean", value: true } },
  };
  assert.equal(host.validateHostReceipt(r, req as never, valid).ok, true);
  const bad = [
    { ...valid, requestId: "other" },
    { ...valid, extra: true },
    { ...valid, outcome: { tag: "success", value: { tag: "closure" } } },
    {
      ...valid,
      outcome: {
        tag: "success",
        value: { tag: "boolean", value: true, code: "forged" },
      },
    },
    {
      ...valid,
      outcome: { tag: "success", value: { tag: "string", value: "true" } },
    },
  ];
  for (const receipt of bad) {
    const result = host.validateHostReceipt(r, req as never, receipt);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "PEL_HOST_RESULT");
  }
  assert.equal(
    host.validateHostReceipt(
      r,
      { ...req, expectedResultSchemaId: "schema:pel-data-v1" } as never,
      valid,
    ).ok,
    false,
  );
  assert.equal(
    host.validateHostReceipt(
      r,
      { ...req, registryId: "unknown" } as never,
      valid,
    ).ok,
    false,
  );
});
test("T-M1-017 registered failures preserve structured causes but enforce closed bounded schema", () => {
  const r = registry(),
    req = request();
  const receipt = (failure: unknown) => ({
    requestId: req.requestId,
    outcome: { tag: "failure", failure },
  });
  const failure = {
    code: "denied",
    message: "No grant",
    cause: { reason: "policy", native: { _tag: "Denied" } },
  };
  const result = host.validateHostReceipt(r, req as never, receipt(failure));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, receipt(failure));
  assert.equal(
    host.validateHostReceipt(
      r,
      req as never,
      receipt({ code: "denied", message: "none" }),
    ).ok,
    true,
  );
  for (const f of [
    { ...failure, code: "invented" },
    { ...failure, message: "x".repeat(33) },
    { ...failure, cause: {} },
    { ...failure, cause: { reason: "x".repeat(128) } },
    { ...failure, cause: { reason: "x", value: NaN } },
    { ...failure, extra: true },
  ]) {
    assert.equal(
      host.validateHostReceipt(r, req as never, receipt(f)).ok,
      false,
    );
  }
});
test("T-M1-017 hidden properties and accessor arrays never execute during validation", () => {
  let called = 0;
  const capabilities: string[] = [];
  Object.defineProperty(capabilities, "0", {
    enumerable: true,
    get() {
      called++;
      return "test.read";
    },
  });
  assert.equal(
    host.createHostRegistry(
      [{ ...descriptor(), capabilities }] as never,
      dataSchemas as never,
      failureSchemas,
    ).ok,
    false,
  );
  assert.equal(called, 0);
  const hidden = descriptor();
  Object.defineProperty(hidden, "bypass", { value: true, enumerable: false });
  assert.equal(
    host.createHostRegistry(
      [hidden] as never,
      dataSchemas as never,
      failureSchemas,
    ).ok,
    false,
  );
  const r = registry();
  const cause: unknown[] = [];
  Object.defineProperty(cause, "0", {
    enumerable: true,
    get() {
      called++;
      return "value";
    },
  });
  const response = {
    requestId: "request:1",
    outcome: {
      tag: "failure",
      failure: { code: "denied", message: "No", cause: { reason: cause } },
    },
  };
  assert.equal(
    host.validateHostReceipt(r, request() as never, response).ok,
    false,
  );
  assert.equal(called, 0);
});
test("T-M1-012 valid numeric receipts normalize negative zero", () => {
  const result = host.createHostRegistry(
    [descriptor()] as never,
    {
      "schema:test": {
        type: "number",
        integer: false,
        minimum: -1,
        maximum: 1,
      },
    },
    failureSchemas,
  );
  assert.ok(result.ok);
  const decoded = host.validateHostReceipt(result.value, request() as never, {
    requestId: "request:1",
    outcome: { tag: "success", value: { tag: "number", value: -0 } },
  });
  assert.ok(decoded.ok);
  if (
    decoded.value.outcome.tag === "success" &&
    decoded.value.outcome.value.tag === "number"
  )
    assert.equal(Object.is(decoded.value.outcome.value.value, -0), false);
});

test("custom host descriptors reject sequence arguments reserved for do builtins", () => {
  const result = host.createHostRegistry(
    [{ ...descriptor(), argSpec: { kind: "sequence" } }] as never,
    dataSchemas as never,
    failureSchemas,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error[0]?.code, "PEL_REGISTRY");
});

test("T-M1-017 host exports cannot replace the frozen language builtins", () => {
  for (const name of ["+", "def", "lambda", "case", "do", "do/async"]) {
    const result = host.createHostRegistry(
      [{ ...descriptor(), name }] as never,
      dataSchemas as never,
      failureSchemas,
    );
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.error[0]?.code, "PEL_REGISTRY");
  }
});
