import { canonicalize, sha256Hex } from "@foreman/core";
import type { PelNode, SourceSpan } from "./ast.js";
import { diagnostic, type PelDiagnostic } from "./diagnostics.js";
import { builtinArgSpecs } from "./builtins.js";
import { PEL_PROFILE } from "./profile.js";
import type {
  ArgSpecV1,
  JsonValue,
  PelDataValue,
  PelPredicateSelectionV1,
  PelValue,
  Result,
} from "./types.js";
import { decodePelData, isPelDataValue } from "./values.js";

export type PelDataSchemaV1 =
  | {
      readonly type: "number";
      readonly integer: boolean;
      readonly minimum: number;
      readonly maximum: number;
    }
  | {
      readonly type: "string";
      readonly maxBytes: number;
      readonly enum?: readonly string[];
    }
  | { readonly type: "boolean" | "nil" }
  | { readonly type: "key"; readonly enum?: readonly string[] }
  | {
      readonly type: "pair";
      readonly key: string;
      readonly value: PelDataSchemaV1;
    }
  | {
      readonly type: "list";
      readonly items: PelDataSchemaV1;
      readonly minItems: number;
      readonly maxItems: number;
    }
  | {
      readonly type: "association";
      readonly fields: readonly {
        readonly key: string;
        readonly schema: PelDataSchemaV1;
        readonly required: boolean;
      }[];
      readonly additionalKeys: false;
    }
  | { readonly type: "union"; readonly variants: readonly PelDataSchemaV1[] }
  | {
      readonly type: "data";
      readonly maxDepth: number;
      readonly maxBytes: number;
    };

export interface HostFailureSchemaV1 {
  readonly codes: readonly string[];
  readonly maxMessageBytes: number;
  readonly maxCauseBytes: number;
  readonly requiredCauseKeys: readonly string[];
}
export interface HostFunctionDescriptorSpecV1 {
  readonly id: string;
  readonly name: string;
  readonly argSpec: ArgSpecV1;
  readonly resultSchemaId: string;
  readonly failureSchemaId: string;
  readonly effectKind: string;
  readonly capabilities: readonly string[];
  readonly resources: {
    readonly reads: readonly string[];
    readonly writes: readonly string[];
    readonly unknown: boolean;
  };
  readonly resourceResolverId: string;
  readonly resourceEnvelope: JsonValue;
}
const DESCRIPTOR_BRAND: unique symbol = Symbol("PelHostDescriptor");
const REGISTRY_BRAND: unique symbol = Symbol("PelHostRegistry");
export type HostFunctionDescriptorV1 = HostFunctionDescriptorSpecV1 & {
  readonly [DESCRIPTOR_BRAND]: true;
};
export interface HostRegistryV1 {
  readonly [REGISTRY_BRAND]: true;
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly profileDigest: string;
  readonly descriptors: readonly HostFunctionDescriptorV1[];
  readonly dataSchemas: Readonly<Record<string, PelDataSchemaV1>>;
  readonly failureSchemas: Readonly<Record<string, HostFailureSchemaV1>>;
  readonly resolverCatalog: Readonly<Record<string, JsonValue>>;
  readonly digest: string;
}
export interface HostEffectFailure {
  readonly code: string;
  readonly message: string;
  readonly cause?: JsonValue;
}
export interface HostRequestV1 {
  readonly requestId: string;
  readonly sourceDigest: string;
  readonly nodeId: string;
  readonly invocationOrdinal: number;
  readonly invocationPath: string;
  readonly registryId: string;
  readonly boundArguments: Readonly<Record<string, PelValue>>;
  readonly expectedResultSchemaId: string;
  readonly selection?: PelPredicateSelectionV1;
  readonly selectionDigest?: string;
}
export interface ReadyHostRequestV1 extends HostRequestV1 {
  readonly alreadyEmitted: boolean;
  readonly replayOnly?: true;
}
export interface HostReceiptV1 {
  readonly requestId: string;
  readonly outcome:
    | { readonly tag: "success"; readonly value: PelDataValue }
    | { readonly tag: "failure"; readonly failure: HostEffectFailure };
}

const ZERO_SPAN: SourceSpan = Object.freeze({
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
});
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const BASE_FAILURE_ID = "schema:pel-host-failure-v1";
const registries = new WeakSet<object>();
const byteSize = (value: unknown): number =>
  Buffer.byteLength(canonicalize(value), "utf8");
const text = (value: unknown, limit = 4096): value is string =>
  typeof value === "string" &&
  value.isWellFormed() &&
  Buffer.byteLength(value) <= limit;
const name = (value: unknown): value is string =>
  text(value, 1024) && value.length > 0 && !/\s|\u0000/u.test(value);
const natural = (
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= maximum;

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (d) => "value" in d && d.enumerable,
  );
}
function array(value: unknown): value is readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  )
    return false;
  if (Object.getOwnPropertyNames(value).length !== value.length + 1)
    return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      return false;
  }
  return true;
}
function keys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const permitted = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => permitted.has(key))
  );
}
function names(value: unknown, empty = true): value is readonly string[] {
  return (
    array(value) &&
    value.length <= MAX_ENTRIES &&
    (empty || value.length > 0) &&
    value.every(name) &&
    new Set(value).size === value.length
  );
}
function json(
  value: unknown,
  maxDepth = 256,
  maxBytes = MAX_BYTES,
): value is JsonValue {
  const seen = new Set<object>();
  let nodes = 0;
  function walk(v: unknown, depth: number): boolean {
    if (++nodes > 100000 || depth > maxDepth) return false;
    if (v === null || typeof v === "boolean") return true;
    if (typeof v === "string") return text(v, maxBytes);
    if (typeof v === "number")
      return (
        Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v))
      );
    if (typeof v !== "object" || seen.has(v)) return false;
    seen.add(v);
    const valid = Array.isArray(v)
      ? array(v) && v.every((x) => walk(x, depth + 1))
      : record(v) &&
        Object.entries(v).every(
          ([k, x]) => text(k, maxBytes) && walk(x, depth + 1),
        );
    seen.delete(v);
    return valid;
  }
  return walk(value, 0) && byteSize(value) <= maxBytes;
}
function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}
function sortedMap<T>(value: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]!]),
  );
}

function validSchema(input: unknown): input is PelDataSchemaV1 {
  let nodes = 0;
  const active = new Set<object>();
  function walk(value: unknown, depth: number): boolean {
    if (
      ++nodes > MAX_ENTRIES ||
      depth > 32 ||
      !record(value) ||
      active.has(value)
    )
      return false;
    active.add(value);
    let valid = false;
    switch (value.type) {
      case "boolean":
      case "nil":
        valid = keys(value, ["type"]);
        break;
      case "number":
        valid =
          keys(value, ["type", "integer", "minimum", "maximum"]) &&
          typeof value.integer === "boolean" &&
          typeof value.minimum === "number" &&
          Number.isFinite(value.minimum) &&
          typeof value.maximum === "number" &&
          Number.isFinite(value.maximum) &&
          value.minimum <= value.maximum &&
          (!value.integer ||
            (Number.isSafeInteger(value.minimum) &&
              Number.isSafeInteger(value.maximum)));
        break;
      case "string":
        valid =
          keys(value, ["type", "maxBytes"], ["enum"]) &&
          natural(value.maxBytes, MAX_BYTES) &&
          (!Object.hasOwn(value, "enum") ||
            (array(value.enum) &&
              value.enum.length > 0 &&
              value.enum.length <= MAX_ENTRIES &&
              value.enum.every((v) => text(v, value.maxBytes as number)) &&
              new Set(value.enum).size === value.enum.length));
        break;
      case "key":
        valid =
          keys(value, ["type"], ["enum"]) &&
          (!Object.hasOwn(value, "enum") || names(value.enum, false));
        break;
      case "pair":
        valid =
          keys(value, ["type", "key", "value"]) &&
          name(value.key) &&
          walk(value.value, depth + 1);
        break;
      case "list":
        valid =
          keys(value, ["type", "items", "minItems", "maxItems"]) &&
          natural(value.minItems) &&
          natural(value.maxItems) &&
          value.minItems <= value.maxItems &&
          walk(value.items, depth + 1);
        break;
      case "association": {
        if (
          !keys(value, ["type", "fields", "additionalKeys"]) ||
          value.additionalKeys !== false ||
          !array(value.fields) ||
          value.fields.length > MAX_ENTRIES
        )
          break;
        const used = new Set<string>();
        valid = value.fields.every((field) => {
          if (
            !record(field) ||
            !keys(field, ["key", "schema", "required"]) ||
            !name(field.key) ||
            used.has(field.key) ||
            typeof field.required !== "boolean"
          )
            return false;
          used.add(field.key);
          return walk(field.schema, depth + 1);
        });
        break;
      }
      case "union":
        valid =
          keys(value, ["type", "variants"]) &&
          array(value.variants) &&
          value.variants.length > 0 &&
          value.variants.length <= MAX_ENTRIES &&
          value.variants.every((v) => walk(v, depth + 1));
        break;
      case "data":
        valid =
          keys(value, ["type", "maxDepth", "maxBytes"]) &&
          natural(value.maxDepth, 256) &&
          natural(value.maxBytes, MAX_BYTES);
        break;
    }
    active.delete(value);
    return valid;
  }
  return walk(input, 1);
}

function validNode(input: unknown): input is PelNode {
  let nodes = 0;
  const active = new Set<object>();
  function walk(value: unknown, depth: number): boolean {
    if (
      ++nodes > MAX_ENTRIES ||
      depth > 32 ||
      !record(value) ||
      active.has(value) ||
      !name(value.nodeId) ||
      !record(value.span)
    )
      return false;
    const span = value.span;
    if (
      !keys(span, ["start", "end", "line", "column", "endLine", "endColumn"]) ||
      !Object.values(span).every((v) => natural(v)) ||
      Number(span.end) < Number(span.start) ||
      Number(span.line) < 1 ||
      Number(span.column) < 1 ||
      Number(span.endLine) < Number(span.line) ||
      Number(span.endColumn) < 1
    )
      return false;
    const base = ["kind", "nodeId", "span"];
    active.add(value);
    let valid = false;
    switch (value.kind) {
      case "nil":
      case "caret":
        valid = keys(value, base);
        break;
      case "number":
        valid =
          keys(value, [...base, "value"]) &&
          typeof value.value === "number" &&
          Number.isFinite(value.value) &&
          (!Number.isInteger(value.value) || Number.isSafeInteger(value.value));
        break;
      case "string":
        valid = keys(value, [...base, "value"]) && text(value.value, MAX_BYTES);
        break;
      case "boolean":
        valid =
          keys(value, [...base, "value"]) && typeof value.value === "boolean";
        break;
      case "key":
      case "symbol":
        valid = keys(value, [...base, "name"]) && name(value.name);
        break;
      case "pair":
        valid =
          keys(value, [...base, "key", "value", "valuePresent"]) &&
          name(value.key) &&
          typeof value.valuePresent === "boolean" &&
          walk(value.value, depth + 1);
        break;
      case "call":
      case "list":
        valid =
          keys(value, [...base, "items"]) &&
          array(value.items) &&
          value.items.length <= MAX_ENTRIES &&
          value.items.every((v) => walk(v, depth + 1));
        break;
      case "quote":
        valid =
          keys(value, [...base, "expression"]) &&
          walk(value.expression, depth + 1);
        break;
      case "pipe":
        valid =
          keys(value, [...base, "left", "right"]) &&
          walk(value.left, depth + 1) &&
          walk(value.right, depth + 1);
        break;
    }
    active.delete(value);
    return valid;
  }
  return walk(input, 1);
}
function validArgSpec(value: unknown): value is ArgSpecV1 {
  if (!record(value)) return false;
  if (value.kind === "sequence") return keys(value, ["kind"]);
  if (
    value.kind !== "fixed" ||
    !keys(value, ["kind", "parameters"]) ||
    !array(value.parameters) ||
    value.parameters.length > 256
  )
    return false;
  const used = new Set<string>();
  return value.parameters.every((parameter) => {
    if (
      !record(parameter) ||
      !keys(
        parameter,
        ["name", "required", "evaluation"],
        ["defaultExpression"],
      ) ||
      !name(parameter.name) ||
      used.has(parameter.name) ||
      typeof parameter.required !== "boolean" ||
      !["strict", "syntax"].includes(String(parameter.evaluation))
    )
      return false;
    used.add(parameter.name);
    const hasDefault = Object.hasOwn(parameter, "defaultExpression");
    return parameter.required
      ? !hasDefault
      : hasDefault && validNode(parameter.defaultExpression);
  });
}
function validFailureSchema(value: unknown): value is HostFailureSchemaV1 {
  return (
    record(value) &&
    keys(value, [
      "codes",
      "maxMessageBytes",
      "maxCauseBytes",
      "requiredCauseKeys",
    ]) &&
    names(value.codes, false) &&
    natural(value.maxMessageBytes, MAX_BYTES) &&
    natural(value.maxCauseBytes, MAX_BYTES) &&
    names(value.requiredCauseKeys)
  );
}
function validDescriptor(
  value: unknown,
): value is HostFunctionDescriptorSpecV1 {
  return (
    record(value) &&
    keys(value, [
      "id",
      "name",
      "argSpec",
      "resultSchemaId",
      "failureSchemaId",
      "effectKind",
      "capabilities",
      "resources",
      "resourceResolverId",
      "resourceEnvelope",
    ]) &&
    name(value.id) &&
    name(value.name) &&
    validArgSpec(value.argSpec) &&
    value.argSpec.kind === "fixed" &&
    name(value.resultSchemaId) &&
    name(value.failureSchemaId) &&
    name(value.effectKind) &&
    names(value.capabilities) &&
    record(value.resources) &&
    keys(value.resources, ["reads", "writes", "unknown"]) &&
    names(value.resources.reads) &&
    names(value.resources.writes) &&
    typeof value.resources.unknown === "boolean" &&
    name(value.resourceResolverId) &&
    json(value.resourceEnvelope, 32, 1024 * 1024)
  );
}

function builtins(): readonly HostFunctionDescriptorSpecV1[] {
  const literal = (
    nodeId: string,
    kind: "string" | "boolean",
    value: string | boolean,
  ): PelNode => ({ nodeId, span: ZERO_SPAN, kind, value }) as PelNode;
  const common = {
    failureSchemaId: BASE_FAILURE_ID,
    resourceResolverId: "static",
    resourceEnvelope: {},
  };
  return [
    {
      ...common,
      id: "print",
      name: "print",
      argSpec: {
        kind: "fixed",
        parameters: [
          { name: "vals", required: true, evaluation: "strict" },
          {
            name: "sep",
            required: false,
            evaluation: "strict",
            defaultExpression: literal("print:sep", "string", ""),
          },
          {
            name: "nl",
            required: false,
            evaluation: "strict",
            defaultExpression: literal("print:nl", "boolean", false),
          },
        ],
      },
      resultSchemaId: "schema:pel-data-v1",
      effectKind: "write",
      capabilities: ["output.write"],
      resources: { reads: [], writes: ["host:output"], unknown: false },
    },
    {
      ...common,
      id: "pel/nl-condition",
      name: "pel/nl-condition",
      argSpec: {
        kind: "fixed",
        parameters: [
          { name: "scrut", required: true, evaluation: "strict" },
          { name: "condition", required: true, evaluation: "strict" },
        ],
      },
      resultSchemaId: "schema:pel-boolean-v1",
      effectKind: "model",
      capabilities: ["model.predicate"],
      resources: { reads: [], writes: [], unknown: true },
    },
  ];
}

export function createHostRegistry(
  descriptors: readonly HostFunctionDescriptorSpecV1[] = [],
  dataSchemas: Readonly<Record<string, PelDataSchemaV1>> = {},
  failureSchemas: Readonly<Record<string, HostFailureSchemaV1>> = {},
  resolverCatalog: Readonly<Record<string, JsonValue>> = {
    static: { version: 1 },
  },
): Result<HostRegistryV1, readonly PelDiagnostic[]> {
  const fail = (
    message: string,
  ): Result<HostRegistryV1, readonly PelDiagnostic[]> => ({
    ok: false,
    error: [diagnostic("PEL_REGISTRY", ZERO_SPAN, message)],
  });
  try {
    if (
      !array(descriptors) ||
      descriptors.length > MAX_ENTRIES ||
      !record(dataSchemas) ||
      !record(failureSchemas) ||
      !record(resolverCatalog)
    )
      return fail("Invalid registry container");
    if (
      Object.keys(dataSchemas).length > MAX_ENTRIES ||
      Object.keys(failureSchemas).length > MAX_ENTRIES ||
      Object.keys(resolverCatalog).length > MAX_ENTRIES
    )
      return fail("Registry entry limit exceeded");
    if (
      !Object.entries(dataSchemas).every(
        ([id, schema]) => name(id) && validSchema(schema),
      ) ||
      !Object.entries(failureSchemas).every(
        ([id, schema]) => name(id) && validFailureSchema(schema),
      )
    )
      return fail("Invalid registry schema");
    if (
      !Object.entries(resolverCatalog).every(
        ([id, value]) => name(id) && json(value, 32, 1024 * 1024),
      ) ||
      !Object.hasOwn(resolverCatalog, "static")
    )
      return fail("Invalid resolver catalog");
    if (
      Object.hasOwn(dataSchemas, "schema:pel-boolean-v1") ||
      Object.hasOwn(dataSchemas, "schema:pel-data-v1") ||
      Object.hasOwn(failureSchemas, BASE_FAILURE_ID)
    )
      return fail("Builtin schema cannot be replaced");
    const allData: Record<string, PelDataSchemaV1> = {
      ...dataSchemas,
      "schema:pel-boolean-v1": { type: "boolean" },
      "schema:pel-data-v1": {
        type: "data",
        maxDepth: 256,
        maxBytes: MAX_BYTES,
      },
    };
    const allFailure: Record<string, HostFailureSchemaV1> = {
      ...failureSchemas,
      [BASE_FAILURE_ID]: {
        codes: [
          "capability-denied",
          "resource-denied",
          "timeout",
          "provider-failure",
          "unknown-external-outcome",
          "reconciliation-required",
        ],
        maxMessageBytes: 4096,
        maxCauseBytes: 65536,
        requiredCauseKeys: [],
      },
    };
    const ids = new Set<string>(),
      exported = new Set(
        Object.keys(builtinArgSpecs).filter(
          (name) => !["print", "pel/nl-condition", "list"].includes(name),
        ),
      );
    const allDescriptors = [...builtins(), ...descriptors];
    for (const item of allDescriptors) {
      if (
        !validDescriptor(item) ||
        ids.has(item.id) ||
        exported.has(item.name) ||
        !Object.hasOwn(allData, item.resultSchemaId) ||
        !Object.hasOwn(allFailure, item.failureSchemaId) ||
        !Object.hasOwn(resolverCatalog, item.resourceResolverId)
      )
        return fail("Invalid or duplicate host descriptor");
      ids.add(item.id);
      exported.add(item.name);
    }
    const payload = structuredClone({
      schemaVersion: 1 as const,
      profileId: PEL_PROFILE.id,
      profileDigest: PEL_PROFILE.digest,
      descriptors: allDescriptors.sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
      dataSchemas: sortedMap(allData),
      failureSchemas: sortedMap(allFailure),
      resolverCatalog: sortedMap(resolverCatalog),
    });
    if (byteSize(payload) > MAX_BYTES)
      return fail("Registry byte limit exceeded");
    const digest = sha256Hex(canonicalize(payload));
    for (const item of payload.descriptors)
      Object.defineProperty(item, DESCRIPTOR_BRAND, { value: true });
    const result = Object.defineProperty(
      { ...payload, digest },
      REGISTRY_BRAND,
      { value: true },
    ) as unknown as HostRegistryV1;
    freeze(result);
    registries.add(result);
    return { ok: true, value: result };
  } catch {
    return fail("Registry contains malformed or non-declarative data");
  }
}

export function verifyRegistry(value: unknown): value is HostRegistryV1 {
  if (typeof value !== "object" || value === null || !registries.has(value))
    return false;
  const registry = value as HostRegistryV1;
  const { digest, ...payload } = registry;
  return (
    Object.isFrozen(registry) &&
    registry.profileDigest === PEL_PROFILE.digest &&
    sha256Hex(canonicalize(payload)) === digest
  );
}
export function getHostDescriptor(
  registry: HostRegistryV1,
  id: string,
): HostFunctionDescriptorV1 | undefined {
  return verifyRegistry(registry)
    ? registry.descriptors.find((descriptor) => descriptor.id === id)
    : undefined;
}

export function validateDataSchema(
  value: unknown,
  schema: PelDataSchemaV1,
): boolean {
  try {
    if (!validSchema(schema) || !isPelDataValue(value)) return false;
    function match(v: PelDataValue, s: PelDataSchemaV1): boolean {
      switch (s.type) {
        case "nil":
          return v.tag === "nil";
        case "boolean":
          return v.tag === "boolean";
        case "number":
          return (
            v.tag === "number" &&
            (!s.integer || Number.isSafeInteger(v.value)) &&
            v.value >= s.minimum &&
            v.value <= s.maximum
          );
        case "string":
          return (
            v.tag === "string" &&
            Buffer.byteLength(v.value) <= s.maxBytes &&
            (!s.enum || s.enum.includes(v.value))
          );
        case "key":
          return v.tag === "key" && (!s.enum || s.enum.includes(v.name));
        case "pair":
          return v.tag === "pair" && v.key === s.key && match(v.value, s.value);
        case "list":
          return (
            v.tag === "list" &&
            v.items.length >= s.minItems &&
            v.items.length <= s.maxItems &&
            v.items.every((item) => match(item, s.items))
          );
        case "union":
          return s.variants.some((variant) => match(v, variant));
        case "association": {
          if (v.tag !== "list") return false;
          let index = 0;
          for (const field of s.fields) {
            const entry = v.items[index];
            if (entry?.tag === "pair" && entry.key === field.key) {
              if (!match(entry.value, field.schema)) return false;
              index++;
            } else if (field.required) return false;
          }
          return index === v.items.length;
        }
        case "data": {
          const depth = (data: PelDataValue): number =>
            data.tag === "pair"
              ? 1 + depth(data.value)
              : data.tag === "list"
                ? 1 +
                  data.items.reduce(
                    (maximum, item) => Math.max(maximum, depth(item)),
                    0,
                  )
                : 0;
          return depth(v) <= s.maxDepth && byteSize(v) <= s.maxBytes;
        }
      }
    }
    return match(value, schema);
  } catch {
    return false;
  }
}

export function validateHostReceipt(
  registry: HostRegistryV1,
  request: HostRequestV1,
  receipt: unknown,
): Result<HostReceiptV1, PelDiagnostic> {
  const fail = (message: string): Result<HostReceiptV1, PelDiagnostic> => ({
    ok: false,
    error: diagnostic("PEL_HOST_RESULT", ZERO_SPAN, message),
  });
  try {
    if (!verifyRegistry(registry))
      return fail("Unknown or modified host registry");
    const descriptor = getHostDescriptor(registry, request.registryId);
    if (
      !descriptor ||
      descriptor.resultSchemaId !== request.expectedResultSchemaId ||
      !name(request.requestId) ||
      !record(request.boundArguments) ||
      !text(request.sourceDigest, 64) ||
      !/^[a-f0-9]{64}$/.test(request.sourceDigest) ||
      !name(request.nodeId) ||
      !natural(request.invocationOrdinal) ||
      !name(request.invocationPath)
    )
      return fail("Host request does not match the registry");
    if (
      !record(receipt) ||
      !keys(receipt, ["requestId", "outcome"]) ||
      receipt.requestId !== request.requestId ||
      !record(receipt.outcome)
    )
      return fail("Host receipt identity or shape is invalid");
    const outcome = receipt.outcome;
    if (outcome.tag === "success") {
      const schema = registry.dataSchemas[request.expectedResultSchemaId];
      if (
        !keys(outcome, ["tag", "value"]) ||
        !schema ||
        !validateDataSchema(outcome.value, schema)
      )
        return fail("Host result violates its registered schema");
      const decoded = decodePelData(outcome.value);
      if (!decoded.ok) return fail("Host result is not canonical data");
      return {
        ok: true,
        value: freeze({
          requestId: request.requestId,
          outcome: { tag: "success", value: decoded.value },
        }),
      };
    } else if (outcome.tag === "failure") {
      const schema = registry.failureSchemas[descriptor.failureSchemaId];
      if (
        !keys(outcome, ["tag", "failure"]) ||
        !record(outcome.failure) ||
        !keys(outcome.failure, ["code", "message"], ["cause"]) ||
        !schema
      )
        return fail("Host failure has an invalid shape");
      const failure = outcome.failure;
      if (
        !name(failure.code) ||
        !schema.codes.includes(failure.code) ||
        !text(failure.message, schema.maxMessageBytes)
      )
        return fail("Host failure code or message is invalid");
      if (
        Object.hasOwn(failure, "cause") &&
        (!json(failure.cause, 32, schema.maxCauseBytes) ||
          (schema.requiredCauseKeys.length > 0 &&
            (!record(failure.cause) ||
              !schema.requiredCauseKeys.every((key) =>
                Object.hasOwn(failure.cause as object, key),
              ))))
      )
        return fail("Host failure cause violates its schema");
    } else return fail("Unknown host receipt outcome");
    return {
      ok: true,
      value: freeze(structuredClone(receipt)) as unknown as HostReceiptV1,
    };
  } catch {
    return fail("Host receipt contains malformed data");
  }
}
