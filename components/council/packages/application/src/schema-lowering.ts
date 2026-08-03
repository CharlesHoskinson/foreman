import type { ProviderFamilyV1 } from "@council/schema";
import { Effect } from "effect";
import {
  CanonicalSchemaInvalid,
  ConstraintWeakeningError,
  SchemaLoweringError,
} from "./errors.js";
import type { ConstraintReceipt, SchemaTransformation } from "./ports.js";

const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

const JSON_SCHEMA_TYPES = new Set([
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "integer",
  "string",
]);

/**
 * Portable UTF-8 encoder. Unpaired UTF-16 surrogates become U+FFFD.
 * Never emits UTF-8 encodings of surrogate code points.
 */
export const encodeUtf8 = (value: string): Uint8Array => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 < value.length) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
          index += 1;
        } else {
          code = 0xfffd;
        }
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }
    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === null || prototype === Object.prototype;
};

const emptyRecord = (): Record<string, unknown> =>
  Object.create(null) as Record<string, unknown>;

const defineOwn = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

type CaptureResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly reason: string };

type StableObjectShape = {
  readonly prototype: object | null;
  readonly keys: readonly PropertyKey[];
  readonly descriptors: ReadonlyMap<PropertyKey, PropertyDescriptor>;
};

const captureFailure = (reason: string): CaptureResult<never> => ({
  ok: false,
  reason,
});

const samePropertyKey = (left: PropertyKey, right: PropertyKey): boolean =>
  typeof left === "symbol" || typeof right === "symbol"
    ? left === right
    : left === right;

const sameDescriptor = (
  left: PropertyDescriptor,
  right: PropertyDescriptor,
): boolean => {
  if (
    left.enumerable !== right.enumerable ||
    left.configurable !== right.configurable
  ) {
    return false;
  }
  const leftIsData = Object.hasOwn(left, "value");
  const rightIsData = Object.hasOwn(right, "value");
  if (leftIsData !== rightIsData) return false;
  if (leftIsData) {
    return (
      left.writable === right.writable && Object.is(left.value, right.value)
    );
  }
  return left.get === right.get && left.set === right.set;
};

/**
 * Capture an object shape twice without invoking property getters.
 * A changing or throwing proxy fails before the application uses its values.
 */
const captureStableObjectShape = (
  value: object,
): CaptureResult<StableObjectShape> => {
  try {
    const inspect = (): StableObjectShape | null => {
      const prototype = Reflect.getPrototypeOf(value);
      const keys = Reflect.ownKeys(value);
      const descriptors = new Map<PropertyKey, PropertyDescriptor>();
      for (const key of keys) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined) return null;
        descriptors.set(key, descriptor);
      }
      return { prototype, keys, descriptors };
    };

    const first = inspect();
    const second = inspect();
    if (first === null || second === null) {
      return captureFailure("an own property disappeared during capture");
    }
    if (
      first.prototype !== second.prototype ||
      first.keys.length !== second.keys.length
    ) {
      return captureFailure("object shape changed during capture");
    }
    for (let index = 0; index < first.keys.length; index += 1) {
      const leftKey = first.keys[index];
      const rightKey = second.keys[index];
      if (
        leftKey === undefined ||
        rightKey === undefined ||
        !samePropertyKey(leftKey, rightKey)
      ) {
        return captureFailure("object keys changed during capture");
      }
      const leftDescriptor = first.descriptors.get(leftKey);
      const rightDescriptor = second.descriptors.get(rightKey);
      if (
        leftDescriptor === undefined ||
        rightDescriptor === undefined ||
        !sameDescriptor(leftDescriptor, rightDescriptor)
      ) {
        return captureFailure("property descriptors changed during capture");
      }
    }
    return { ok: true, value: first };
  } catch {
    return captureFailure("object inspection failed");
  }
};

const captureClosedJson = (
  value: unknown,
  active: Set<object> = new Set<object>(),
): CaptureResult<unknown> => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return { ok: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { ok: true, value }
      : captureFailure("JSON numbers must be finite");
  }
  if (typeof value !== "object") {
    return captureFailure("value is not in the closed JSON data model");
  }
  if (active.has(value)) {
    return captureFailure("cyclic JSON references are not supported");
  }

  active.add(value);
  try {
    const shape = captureStableObjectShape(value);
    if (!shape.ok) return shape;

    let arrayValue = false;
    try {
      arrayValue = Array.isArray(value);
    } catch {
      return captureFailure("array inspection failed");
    }

    if (arrayValue) {
      if (shape.value.prototype !== Array.prototype) {
        return captureFailure("JSON arrays must use Array.prototype");
      }
      const lengthDescriptor = shape.value.descriptors.get("length");
      if (
        lengthDescriptor === undefined ||
        !Object.hasOwn(lengthDescriptor, "value") ||
        lengthDescriptor.enumerable === true ||
        typeof lengthDescriptor.value !== "number" ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0
      ) {
        return captureFailure("JSON array length is invalid");
      }
      const length = lengthDescriptor.value;
      if (shape.value.keys.length !== length + 1) {
        return captureFailure(
          "JSON arrays must be dense and have no extra keys",
        );
      }
      const output: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = shape.value.descriptors.get(String(index));
        if (
          descriptor === undefined ||
          !Object.hasOwn(descriptor, "value") ||
          descriptor.enumerable !== true
        ) {
          return captureFailure(
            "JSON arrays must contain enumerable data elements",
          );
        }
        const child = captureClosedJson(descriptor.value, active);
        if (!child.ok) return child;
        output.push(child.value);
      }
      return { ok: true, value: output };
    }

    if (
      shape.value.prototype !== null &&
      shape.value.prototype !== Object.prototype
    ) {
      return captureFailure("JSON objects must use Object.prototype or null");
    }
    const output = emptyRecord();
    for (const key of shape.value.keys) {
      if (typeof key !== "string") {
        return captureFailure("JSON objects must not contain symbol keys");
      }
      const descriptor = shape.value.descriptors.get(key);
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        return captureFailure(
          "JSON objects must contain only enumerable data properties",
        );
      }
      const child = captureClosedJson(descriptor.value, active);
      if (!child.ok) return child;
      defineOwn(output, key, child.value);
    }
    return { ok: true, value: output };
  } finally {
    active.delete(value);
  }
};

export const isClosedJsonValue = (value: unknown): boolean =>
  captureClosedJson(value).ok;

/** Return a detached closed-JSON snapshot, or null when capture fails. */
export const snapshotJsonValue = (value: unknown): unknown => {
  const captured = captureClosedJson(value);
  return captured.ok ? captured.value : null;
};

const ownKeys = (value: Record<string, unknown>): string[] =>
  Object.keys(value);

const sortCapturedJson = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortCapturedJson);
  const sorted = emptyRecord();
  for (const key of ownKeys(value as Record<string, unknown>).sort()) {
    defineOwn(
      sorted,
      key,
      sortCapturedJson((value as Record<string, unknown>)[key]),
    );
  }
  return sorted;
};

/**
 * Recursively sort object keys for stable JSON. Arrays keep order.
 * Preserves own keys including __proto__, constructor, and prototype.
 */
export const sortJsonKeys = (value: unknown): unknown => {
  const captured = captureClosedJson(value);
  if (!captured.ok) {
    throw new TypeError("value is not closed JSON");
  }
  return sortCapturedJson(captured.value);
};

export const stringifyCanonicalJson = (value: unknown): string =>
  JSON.stringify(sortJsonKeys(value));

export const canonicalJsonBytes = (value: unknown): Uint8Array =>
  encodeUtf8(stringifyCanonicalJson(value));

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

/** Semantic keywords version 1 supports. Unknown structural keywords fail. */
const SEMANTIC_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "enum",
  "const",
  "anyOf",
  "items",
  "pattern",
  "minLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
]);

/** Annotations removable only with a typed transformation receipt. */
const ANNOTATION_KEYWORDS = new Set(["title", "description", "$schema"]);

/** Structural forms rejected in version 1. */
const FORBIDDEN_STRUCTURAL = new Set([
  "$ref",
  "$defs",
  "definitions",
  "oneOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "dependentSchemas",
  "dependentRequired",
  "$dynamicRef",
  "$dynamicAnchor",
  "$anchor",
  "$id",
  "$comment",
  "unevaluatedProperties",
  "unevaluatedItems",
  "prefixItems",
  "contains",
  "patternProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "uniqueItems",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
]);

const INLINE_VARIANT_MAX_BYTES = 32_768;

const isJsonValue = isClosedJsonValue;

const jsonEqual = (left: unknown, right: unknown): boolean =>
  stringifyCanonicalJson(left) === stringifyCanonicalJson(right);

type WalkResult = {
  readonly value: unknown;
  readonly transformations: readonly SchemaTransformation[];
  readonly constraintReceipts: readonly ConstraintReceipt[];
};

const failLowering = (
  reason: string,
  path: string,
  keyword?: string,
): Effect.Effect<never, SchemaLoweringError> =>
  Effect.fail(
    new SchemaLoweringError({
      stage: "schema_lowering",
      reason,
      path,
      ...(keyword === undefined ? {} : { keyword }),
    }),
  );

const failCanonical = (
  reason: string,
): Effect.Effect<never, CanonicalSchemaInvalid> =>
  Effect.fail(
    new CanonicalSchemaInvalid({
      stage: "canonical_schema",
      reason,
    }),
  );

/**
 * Closed recursive application-owned schema validation (version 1).
 * Accepts JSON object schemas only. Never coerces values.
 */
const escapePointerSegment = (value: string): string =>
  value.replace(/~/g, "~0").replace(/\//g, "~1");

const validateCanonicalSchemaSnapshot = (
  schema: unknown,
  path = "",
  isRoot = true,
): Effect.Effect<void, CanonicalSchemaInvalid> => {
  if (!isPlainObject(schema)) {
    if (typeof schema === "boolean") {
      return failCanonical(
        `${path || "/"}: boolean JSON Schema forms are not supported in version 1`,
      );
    }
    return failCanonical(
      `${path || "/"}: schema must be a JSON object (arrays, scalars, and null are rejected)`,
    );
  }

  const keys = ownKeys(schema);
  for (const key of keys) {
    if (FORBIDDEN_STRUCTURAL.has(key)) {
      return failCanonical(
        `${path}: unsupported structural keyword '${key}' is rejected in version 1`,
      );
    }
    if (!SEMANTIC_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
      return failCanonical(
        `${path}: unknown structural keyword '${key}' fails closed`,
      );
    }
  }

  if (Object.hasOwn(schema, "$schema")) {
    if (!isRoot) {
      return failCanonical(`${path}: nested $schema is not allowed`);
    }
    if (schema.$schema !== DRAFT_2020_12) {
      return failCanonical(`${path}: root $schema must be ${DRAFT_2020_12}`);
    }
  }

  if (Object.hasOwn(schema, "title") && typeof schema.title !== "string") {
    return failCanonical(`${path}: title must be a string`);
  }
  if (
    Object.hasOwn(schema, "description") &&
    typeof schema.description !== "string"
  ) {
    return failCanonical(`${path}: description must be a string`);
  }

  if (Object.hasOwn(schema, "type")) {
    const typeValue = schema.type;
    if (typeof typeValue === "string") {
      if (!JSON_SCHEMA_TYPES.has(typeValue)) {
        return failCanonical(
          `${path}: type '${typeValue}' is not an allowed JSON Schema type`,
        );
      }
    } else if (Array.isArray(typeValue)) {
      if (typeValue.length === 0) {
        return failCanonical(`${path}: type array must be nonempty`);
      }
      const seen = new Set<string>();
      for (const entry of typeValue) {
        if (typeof entry !== "string" || !JSON_SCHEMA_TYPES.has(entry)) {
          return failCanonical(
            `${path}: type array entries must be allowed type strings`,
          );
        }
        if (seen.has(entry)) {
          return failCanonical(`${path}: type array entries must be unique`);
        }
        seen.add(entry);
      }
    } else {
      return failCanonical(
        `${path}: type must be a string or nonempty array of unique type strings`,
      );
    }
  }

  if (Object.hasOwn(schema, "properties")) {
    if (!isPlainObject(schema.properties)) {
      return failCanonical(`${path}: properties must be a plain object`);
    }
    for (const propName of ownKeys(schema.properties)) {
      const child = schema.properties[propName];
      const childPath = `${path}/properties/${escapePointerSegment(propName)}`;
      if (!isPlainObject(child)) {
        return failCanonical(
          `${childPath}: property schema must be a JSON object`,
        );
      }
    }
  }

  if (Object.hasOwn(schema, "required")) {
    if (!Array.isArray(schema.required)) {
      return failCanonical(`${path}: required must be an array`);
    }
    const seen = new Set<string>();
    for (const entry of schema.required) {
      if (typeof entry !== "string") {
        return failCanonical(
          `${path}: required entries must be strings (no coercion)`,
        );
      }
      if (seen.has(entry)) {
        return failCanonical(`${path}: required entries must be unique`);
      }
      seen.add(entry);
    }
  }

  if (Object.hasOwn(schema, "additionalProperties")) {
    const additional = schema.additionalProperties;
    if (typeof additional === "boolean") {
      // ok
    } else if (isPlainObject(additional)) {
      // recurse below
    } else {
      return failCanonical(
        `${path}: additionalProperties must be a boolean or object schema`,
      );
    }
  }

  if (Object.hasOwn(schema, "enum")) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      return failCanonical(`${path}: enum must be a nonempty array`);
    }
    const seen = new Set<string>();
    for (const entry of schema.enum) {
      if (!isJsonValue(entry)) {
        return failCanonical(`${path}: enum entries must be JSON values`);
      }
      const encoded = stringifyCanonicalJson(entry);
      if (seen.has(encoded)) {
        return failCanonical(`${path}: enum entries must be unique`);
      }
      seen.add(encoded);
    }
  }

  if (Object.hasOwn(schema, "const") && !isJsonValue(schema.const)) {
    return failCanonical(`${path}: const must be a JSON value`);
  }

  if (Object.hasOwn(schema, "anyOf")) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) {
      return failCanonical(`${path}: anyOf must be a nonempty array`);
    }
    const anyOfBranches = schema.anyOf as readonly unknown[];
    for (let index = 0; index < anyOfBranches.length; index += 1) {
      const child: unknown = anyOfBranches[index];
      if (!isPlainObject(child)) {
        return failCanonical(
          `${path}/anyOf/${String(index)}: branch must be a JSON object schema`,
        );
      }
    }
  }

  if (Object.hasOwn(schema, "items")) {
    if (!isPlainObject(schema.items)) {
      return failCanonical(
        `${path}: items must be a single object schema (not null, array, or scalar)`,
      );
    }
  }

  if (Object.hasOwn(schema, "pattern")) {
    if (typeof schema.pattern !== "string") {
      return failCanonical(`${path}: pattern must be a string`);
    }
    try {
      // ECMA-262 RegExp compile check
      void new RegExp(schema.pattern);
    } catch {
      return failCanonical(`${path}: pattern is not a valid ECMA-262 RegExp`);
    }
  }

  for (const key of ["minLength", "minItems", "maxItems"] as const) {
    if (Object.hasOwn(schema, key)) {
      const value = schema[key];
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0
      ) {
        return failCanonical(
          `${path}: ${key} must be a nonnegative safe integer`,
        );
      }
    }
  }

  for (const key of ["minimum", "maximum"] as const) {
    if (Object.hasOwn(schema, key)) {
      const value = schema[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return failCanonical(`${path}: ${key} must be a finite number`);
      }
    }
  }

  if (
    Object.hasOwn(schema, "minimum") &&
    Object.hasOwn(schema, "maximum") &&
    typeof schema.minimum === "number" &&
    typeof schema.maximum === "number" &&
    schema.minimum > schema.maximum
  ) {
    return failCanonical(`${path}: minimum must not be greater than maximum`);
  }

  if (
    Object.hasOwn(schema, "minItems") &&
    Object.hasOwn(schema, "maxItems") &&
    typeof schema.minItems === "number" &&
    typeof schema.maxItems === "number" &&
    schema.minItems > schema.maxItems
  ) {
    return failCanonical(`${path}: minItems must not be greater than maxItems`);
  }

  // Recurse after local checks.
  return Effect.gen(function* () {
    if (isPlainObject(schema.properties)) {
      for (const propName of ownKeys(schema.properties)) {
        yield* validateCanonicalSchemaSnapshot(
          schema.properties[propName],
          `${path}/properties/${escapePointerSegment(propName)}`,
          false,
        );
      }
    }
    if (isPlainObject(schema.additionalProperties)) {
      yield* validateCanonicalSchemaSnapshot(
        schema.additionalProperties,
        `${path}/additionalProperties`,
        false,
      );
    }
    if (Object.hasOwn(schema, "items")) {
      yield* validateCanonicalSchemaSnapshot(
        schema.items,
        `${path}/items`,
        false,
      );
    }
    if (Array.isArray(schema.anyOf)) {
      for (let index = 0; index < schema.anyOf.length; index += 1) {
        yield* validateCanonicalSchemaSnapshot(
          schema.anyOf[index],
          `${path}/anyOf/${String(index)}`,
          false,
        );
      }
    }
  });
};

export const validateCanonicalSchema = (
  schema: unknown,
  path = "",
  isRoot = true,
): Effect.Effect<void, CanonicalSchemaInvalid> => {
  const captured = captureClosedJson(schema);
  if (!captured.ok) {
    return failCanonical(
      `${path || "/"}: schema is not closed JSON (${captured.reason})`,
    );
  }
  return validateCanonicalSchemaSnapshot(captured.value, path, isRoot);
};

const walkSchema = (
  schema: unknown,
  path: string,
  providerFamily: ProviderFamilyV1,
  isRoot: boolean,
): Effect.Effect<
  WalkResult,
  SchemaLoweringError | ConstraintWeakeningError | CanonicalSchemaInvalid
> =>
  Effect.gen(function* () {
    // Validation is owned by validateCanonicalSchema; walk only lowers.
    if (!isPlainObject(schema)) {
      return yield* failLowering(
        "schema node must be an object after validation",
        path,
      );
    }

    const transformations: SchemaTransformation[] = [];
    const output = emptyRecord();
    const sourceKeys = ownKeys(schema);
    const orderedKeys = [...sourceKeys].sort();

    for (const key of orderedKeys) {
      const raw = schema[key];

      if (ANNOTATION_KEYWORDS.has(key)) {
        if (key === "$schema") {
          if (providerFamily === "anthropic" && isRoot) {
            transformations.push({
              path,
              kind: "annotation_removed",
              keyword: "$schema",
              detail: "anthropic dialect rejects root $schema annotation",
            });
            continue;
          }
          defineOwn(output, key, raw);
          continue;
        }
        transformations.push({
          path,
          kind: "annotation_removed",
          keyword: key,
          detail: `annotation '${key}' removed; not a semantic constraint`,
        });
        continue;
      }

      if (key === "const") {
        if (providerFamily === "anthropic") {
          defineOwn(output, "enum", [raw]);
          transformations.push({
            path,
            kind: "const_to_enum",
            keyword: "const",
            detail: "anthropic dialect translates const to single-value enum",
          });
          continue;
        }
        defineOwn(output, "const", raw);
        continue;
      }

      if (key === "properties") {
        if (!isPlainObject(raw)) {
          return yield* failLowering(
            "properties must be an object",
            `${path}/properties`,
            "properties",
          );
        }
        const props = emptyRecord();
        for (const propName of ownKeys(raw).sort()) {
          const child = yield* walkSchema(
            raw[propName],
            `${path}/properties/${escapePointerSegment(propName)}`,
            providerFamily,
            false,
          );
          defineOwn(props, propName, child.value);
          transformations.push(...child.transformations);
        }
        defineOwn(output, "properties", props);
        continue;
      }

      if (key === "items") {
        const child = yield* walkSchema(
          raw,
          `${path}/items`,
          providerFamily,
          false,
        );
        defineOwn(output, "items", child.value);
        transformations.push(...child.transformations);
        continue;
      }

      if (key === "anyOf") {
        if (!Array.isArray(raw)) {
          return yield* failLowering(
            "anyOf must be an array",
            `${path}/anyOf`,
            "anyOf",
          );
        }
        const variants: unknown[] = [];
        for (let index = 0; index < raw.length; index += 1) {
          const child = yield* walkSchema(
            raw[index],
            `${path}/anyOf/${String(index)}`,
            providerFamily,
            false,
          );
          variants.push(child.value);
          transformations.push(...child.transformations);
        }
        defineOwn(output, "anyOf", variants);
        continue;
      }

      if (key === "required") {
        if (!Array.isArray(raw)) {
          return yield* failLowering(
            "required must be an array",
            `${path}/required`,
            "required",
          );
        }
        // Array order is semantic at this boundary and must remain unchanged.
        const requiredFields = [...(raw as readonly string[])];
        defineOwn(output, "required", requiredFields);
        continue;
      }

      if (key === "additionalProperties") {
        if (typeof raw === "boolean") {
          defineOwn(output, "additionalProperties", raw);
          continue;
        }
        const child = yield* walkSchema(
          raw,
          `${path}/additionalProperties`,
          providerFamily,
          false,
        );
        defineOwn(output, "additionalProperties", child.value);
        transformations.push(...child.transformations);
        continue;
      }

      if (key === "enum") {
        defineOwn(output, "enum", raw);
        continue;
      }

      defineOwn(output, key, raw);
    }

    if (Object.hasOwn(schema, "const") && Object.hasOwn(schema, "enum")) {
      return yield* failLowering(
        "schema must not combine const and enum at the same node",
        path,
        "const",
      );
    }

    const ordered = sortCapturedJson(output) as Record<string, unknown>;
    if (!jsonEqual(sourceKeys, orderedKeys)) {
      transformations.push({
        path,
        kind: "key_order_canonicalized",
        keyword: "(order)",
        detail: "object key order canonicalized for stable bytes",
      });
    }

    return {
      value: ordered,
      transformations,
      constraintReceipts: [] as const,
    };
  });

const weakenFail = (
  reason: string,
  path: string,
): Effect.Effect<never, ConstraintWeakeningError> =>
  Effect.fail(
    new ConstraintWeakeningError({
      stage: "constraint_verify",
      reason,
      path,
    }),
  );

/**
 * Semantic equality of combined constraints after approved transformations.
 * Version 1: constraintReceipts must be empty; no host-validation weakening.
 */
export const verifyCombinedConstraints = (
  canonical: unknown,
  lowered: unknown,
  receipts: readonly ConstraintReceipt[],
  path = "",
  transformations: readonly SchemaTransformation[] = [],
): Effect.Effect<void, ConstraintWeakeningError> => {
  if (receipts.length > 0) {
    return weakenFail(
      "version 1 requires constraintReceipts to be empty; host validation is not implemented",
      path,
    );
  }

  const annotationRemoved = (keyword: string): boolean =>
    transformations.some(
      (entry) =>
        entry.path === path &&
        entry.kind === "annotation_removed" &&
        entry.keyword === keyword,
    );

  const constToEnum = (): boolean =>
    transformations.some(
      (entry) => entry.path === path && entry.kind === "const_to_enum",
    );

  if (!isPlainObject(canonical)) {
    if (!jsonEqual(canonical, lowered)) {
      return weakenFail(
        "non-object schema node changed without approval",
        path,
      );
    }
    return Effect.void;
  }

  if (!isPlainObject(lowered)) {
    return weakenFail(
      "lowered schema lost object structure without approval",
      path,
    );
  }

  return Effect.gen(function* () {
    // Reject unknown keys introduced or forbidden keywords in lowered form.
    for (const key of ownKeys(lowered)) {
      if (FORBIDDEN_STRUCTURAL.has(key)) {
        return yield* weakenFail(`unsupported lowered keyword '${key}'`, path);
      }
      if (!SEMANTIC_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
        return yield* weakenFail(`unknown lowered keyword '${key}'`, path);
      }
    }

    // type
    if (Object.hasOwn(canonical, "type")) {
      if (
        !Object.hasOwn(lowered, "type") ||
        !jsonEqual(canonical.type, lowered.type)
      ) {
        return yield* weakenFail("type constraint changed", path);
      }
    } else if (Object.hasOwn(lowered, "type")) {
      return yield* weakenFail("type was fabricated after lowering", path);
    }

    // required: exact order and membership
    if (Object.hasOwn(canonical, "required")) {
      const before = Array.isArray(canonical.required)
        ? [...(canonical.required as string[])]
        : [];
      const after = Array.isArray(lowered.required)
        ? [...(lowered.required as string[])]
        : [];
      if (!jsonEqual(before, after)) {
        return yield* weakenFail("required order or membership changed", path);
      }
    } else if (Object.hasOwn(lowered, "required")) {
      return yield* weakenFail("required was fabricated after lowering", path);
    }

    // additionalProperties
    if (Object.hasOwn(canonical, "additionalProperties")) {
      if (!Object.hasOwn(lowered, "additionalProperties")) {
        return yield* weakenFail(
          "additionalProperties removed without approval",
          path,
        );
      }
      const before = canonical.additionalProperties;
      const after = lowered.additionalProperties;
      if (typeof before === "boolean") {
        if (after !== before) {
          return yield* weakenFail(
            "additionalProperties boolean was weakened",
            path,
          );
        }
      } else {
        if (after === true || typeof after === "boolean") {
          return yield* weakenFail(
            "schema-valued additionalProperties was weakened to a boolean",
            path,
          );
        }
        yield* verifyCombinedConstraints(
          before,
          after,
          receipts,
          `${path}/additionalProperties`,
          transformations,
        );
      }
    } else if (Object.hasOwn(lowered, "additionalProperties")) {
      return yield* weakenFail(
        "additionalProperties was fabricated after lowering",
        path,
      );
    }

    // const / enum
    if (Object.hasOwn(canonical, "const")) {
      if (Object.hasOwn(lowered, "const")) {
        if (!jsonEqual(canonical.const, lowered.const)) {
          return yield* weakenFail("const value changed", path);
        }
      } else if (
        constToEnum() &&
        Array.isArray(lowered.enum) &&
        lowered.enum.length === 1 &&
        jsonEqual(lowered.enum[0], canonical.const)
      ) {
        // approved anthropic const→enum
      } else {
        return yield* weakenFail("const value constraint was weakened", path);
      }
    } else if (Object.hasOwn(lowered, "const")) {
      return yield* weakenFail("const was fabricated after lowering", path);
    }

    if (Object.hasOwn(canonical, "enum")) {
      const before = Array.isArray(canonical.enum)
        ? [...(canonical.enum as unknown[])].map((entry) =>
            stringifyCanonicalJson(entry),
          )
        : [];
      const after = Array.isArray(lowered.enum)
        ? [...(lowered.enum as unknown[])].map((entry) =>
            stringifyCanonicalJson(entry),
          )
        : [];
      // If const→enum at this path and canonical had const only, skip enum check.
      if (!(Object.hasOwn(canonical, "const") && constToEnum())) {
        if (!jsonEqual(before, after)) {
          return yield* weakenFail("enum value set was weakened", path);
        }
      }
    } else if (
      Object.hasOwn(lowered, "enum") &&
      !(Object.hasOwn(canonical, "const") && constToEnum())
    ) {
      return yield* weakenFail("enum was fabricated after lowering", path);
    }

    for (const key of [
      "pattern",
      "minLength",
      "minimum",
      "maximum",
      "minItems",
      "maxItems",
    ] as const) {
      if (Object.hasOwn(canonical, key)) {
        if (!Object.hasOwn(lowered, key) || lowered[key] !== canonical[key]) {
          return yield* weakenFail(`${key} constraint changed`, path);
        }
      } else if (Object.hasOwn(lowered, key)) {
        return yield* weakenFail(`${key} was fabricated after lowering`, path);
      }
    }

    // annotations: may be removed only with receipt
    for (const key of ["title", "description", "$schema"] as const) {
      if (Object.hasOwn(canonical, key) && !Object.hasOwn(lowered, key)) {
        if (!annotationRemoved(key)) {
          return yield* weakenFail(
            `annotation '${key}' removed without transformation receipt`,
            path,
          );
        }
      } else if (
        Object.hasOwn(canonical, key) &&
        Object.hasOwn(lowered, key) &&
        !jsonEqual(canonical[key], lowered[key])
      ) {
        return yield* weakenFail(`annotation '${key}' value changed`, path);
      } else if (
        !Object.hasOwn(canonical, key) &&
        Object.hasOwn(lowered, key)
      ) {
        return yield* weakenFail(
          `annotation '${key}' was fabricated after lowering`,
          path,
        );
      }
    }

    // properties: exact own-key membership (including __proto__)
    if (Object.hasOwn(canonical, "properties")) {
      if (!isPlainObject(canonical.properties)) {
        return yield* weakenFail(
          "canonical properties must be an object",
          path,
        );
      }
      if (!isPlainObject(lowered.properties)) {
        return yield* weakenFail("properties object was removed", path);
      }
      const beforeKeys = ownKeys(canonical.properties).sort();
      const afterKeys = ownKeys(lowered.properties).sort();
      if (!jsonEqual(beforeKeys, afterKeys)) {
        // Under additionalProperties:false, added properties are a weakening.
        return yield* weakenFail(
          "properties membership changed (missing, duplicate, or extra keys)",
          path,
        );
      }
      for (const propName of beforeKeys) {
        // Own-property access (do not use `in` for __proto__).
        if (!Object.hasOwn(lowered.properties, propName)) {
          return yield* weakenFail(
            `property '${propName}' removed`,
            `${path}/properties/${escapePointerSegment(propName)}`,
          );
        }
        yield* verifyCombinedConstraints(
          canonical.properties[propName],
          lowered.properties[propName],
          receipts,
          `${path}/properties/${escapePointerSegment(propName)}`,
          transformations,
        );
      }
    } else if (Object.hasOwn(lowered, "properties")) {
      return yield* weakenFail(
        "properties were fabricated after lowering",
        path,
      );
    }

    if (Object.hasOwn(canonical, "items")) {
      if (!Object.hasOwn(lowered, "items")) {
        return yield* weakenFail("items schema removed", path);
      }
      yield* verifyCombinedConstraints(
        canonical.items,
        lowered.items,
        receipts,
        `${path}/items`,
        transformations,
      );
    } else if (Object.hasOwn(lowered, "items")) {
      return yield* weakenFail("items was fabricated after lowering", path);
    }

    if (Object.hasOwn(canonical, "anyOf")) {
      if (
        !Array.isArray(canonical.anyOf) ||
        !Array.isArray(lowered.anyOf) ||
        lowered.anyOf.length !== canonical.anyOf.length
      ) {
        return yield* weakenFail("anyOf variants were weakened", path);
      }
      for (let index = 0; index < canonical.anyOf.length; index += 1) {
        yield* verifyCombinedConstraints(
          canonical.anyOf[index],
          lowered.anyOf[index],
          receipts,
          `${path}/anyOf/${String(index)}`,
          transformations,
        );
      }
    } else if (Object.hasOwn(lowered, "anyOf")) {
      return yield* weakenFail("anyOf was fabricated after lowering", path);
    }
  });
};

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;

const callIntrinsicGetter = (
  prototype: object,
  key: string,
  receiver: object,
): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
  if (descriptor === undefined || typeof descriptor.get !== "function") {
    throw new TypeError(`missing intrinsic getter ${key}`);
  }
  // The intrinsic accessor requires the explicit receiver supplied here.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return Reflect.apply(descriptor.get, receiver, []);
};

const optionalIntrinsicBoolean = (
  prototype: object,
  key: string,
  receiver: object,
): boolean | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
  if (descriptor === undefined || typeof descriptor.get !== "function") {
    return undefined;
  }
  // The intrinsic accessor requires the explicit receiver supplied here.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return Reflect.apply(descriptor.get, receiver, []) as boolean;
};

/** Capture only an ordinary, fixed, full-span Uint8Array. */
export const snapshotOrdinaryBytes = (value: unknown): Uint8Array | null => {
  try {
    if (
      !ArrayBuffer.isView(value) ||
      Object.getPrototypeOf(value) !== Uint8Array.prototype
    ) {
      return null;
    }
    const bytes = value as Uint8Array;
    const buffer = callIntrinsicGetter(
      typedArrayPrototype,
      "buffer",
      bytes,
    ) as ArrayBufferLike;
    if (
      !(buffer instanceof ArrayBuffer) ||
      Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype
    ) {
      return null;
    }
    const byteLength = callIntrinsicGetter(
      typedArrayPrototype,
      "byteLength",
      bytes,
    ) as number;
    const byteOffset = callIntrinsicGetter(
      typedArrayPrototype,
      "byteOffset",
      bytes,
    ) as number;
    const bufferByteLength = callIntrinsicGetter(
      ArrayBuffer.prototype,
      "byteLength",
      buffer,
    ) as number;
    if (byteOffset !== 0 || byteLength !== bufferByteLength) return null;
    const resizable = optionalIntrinsicBoolean(
      ArrayBuffer.prototype,
      "resizable",
      buffer,
    );
    const maxByteLengthDescriptor = Object.getOwnPropertyDescriptor(
      ArrayBuffer.prototype,
      "maxByteLength",
    );
    const maxByteLength =
      maxByteLengthDescriptor === undefined ||
      typeof maxByteLengthDescriptor.get !== "function"
        ? undefined
        : (callIntrinsicGetter(
            ArrayBuffer.prototype,
            "maxByteLength",
            buffer,
          ) as number);
    const detached = optionalIntrinsicBoolean(
      ArrayBuffer.prototype,
      "detached",
      buffer,
    );
    if (
      resizable === true ||
      (maxByteLength !== undefined && maxByteLength !== bufferByteLength) ||
      detached === true
    ) {
      return null;
    }
    const snapshot = new Uint8Array(byteLength);
    Uint8Array.prototype.set.call(snapshot, bytes);
    return snapshot;
  } catch {
    return null;
  }
};

const captureExactRecord = (
  value: unknown,
  expectedKeys: readonly string[],
): CaptureResult<Record<string, unknown>> => {
  if (value === null || typeof value !== "object") {
    return captureFailure("expected an object record");
  }
  const shape = captureStableObjectShape(value);
  if (!shape.ok) return shape;
  if (
    shape.value.prototype !== null &&
    shape.value.prototype !== Object.prototype
  ) {
    return captureFailure("record must use Object.prototype or null");
  }
  const actualKeys = shape.value.keys;
  if (
    actualKeys.some((key) => typeof key !== "string") ||
    actualKeys.length !== expectedKeys.length
  ) {
    return captureFailure("record keys do not match the closed shape");
  }
  const actualSorted = [...(actualKeys as readonly string[])].sort();
  const expectedSorted = [...expectedKeys].sort();
  if (!actualSorted.every((key, index) => key === expectedSorted[index])) {
    return captureFailure("record keys do not match the closed shape");
  }
  const output = emptyRecord();
  for (const key of actualKeys as readonly string[]) {
    const descriptor = shape.value.descriptors.get(key);
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      return captureFailure("record fields must be enumerable data properties");
    }
    defineOwn(output, key, descriptor.value);
  }
  return { ok: true, value: output };
};

const captureTransformation = (
  value: unknown,
): CaptureResult<SchemaTransformation> => {
  const captured = captureExactRecord(value, [
    "path",
    "kind",
    "keyword",
    "detail",
  ]);
  if (!captured.ok) return captured;
  const { path, kind, keyword, detail } = captured.value;
  if (
    typeof path !== "string" ||
    typeof kind !== "string" ||
    typeof keyword !== "string" ||
    typeof detail !== "string" ||
    ![
      "annotation_removed",
      "const_to_enum",
      "key_order_canonicalized",
    ].includes(kind)
  ) {
    return captureFailure("transformation fields are invalid");
  }
  return {
    ok: true,
    value: {
      path,
      kind: kind as SchemaTransformation["kind"],
      keyword,
      detail,
    },
  };
};

const captureReceipt = (value: unknown): CaptureResult<ConstraintReceipt> => {
  const captured = captureExactRecord(value, [
    "path",
    "weakenedConstraint",
    "hostValidation",
  ]);
  if (!captured.ok) return captured;
  const { path, weakenedConstraint, hostValidation } = captured.value;
  if (
    typeof path !== "string" ||
    typeof weakenedConstraint !== "string" ||
    typeof hostValidation !== "string"
  ) {
    return captureFailure("constraint-receipt fields are invalid");
  }
  return {
    ok: true,
    value: { path, weakenedConstraint, hostValidation },
  };
};

const captureLoweringResult = (
  value: unknown,
): CaptureResult<LowerSchemaResult> => {
  const record = captureExactRecord(value, [
    "loweredSchema",
    "loweredSchemaBytes",
    "transformations",
    "constraintReceipts",
  ]);
  if (!record.ok) return record;
  const loweredSchema = captureClosedJson(record.value.loweredSchema);
  if (!loweredSchema.ok) return loweredSchema;
  const loweredSchemaBytes = snapshotOrdinaryBytes(
    record.value.loweredSchemaBytes,
  );
  if (loweredSchemaBytes === null) {
    return captureFailure("loweredSchemaBytes is not an ordinary byte array");
  }

  const transformationValues = captureClosedJson(record.value.transformations);
  if (!transformationValues.ok || !Array.isArray(transformationValues.value)) {
    return captureFailure("transformations must be a closed dense array");
  }
  const transformations: SchemaTransformation[] = [];
  for (const entry of transformationValues.value) {
    const transformation = captureTransformation(entry);
    if (!transformation.ok) return transformation;
    transformations.push(transformation.value);
  }

  const receiptValues = captureClosedJson(record.value.constraintReceipts);
  if (!receiptValues.ok || !Array.isArray(receiptValues.value)) {
    return captureFailure("constraintReceipts must be a closed dense array");
  }
  const constraintReceipts: ConstraintReceipt[] = [];
  for (const entry of receiptValues.value) {
    const receipt = captureReceipt(entry);
    if (!receipt.ok) return receipt;
    constraintReceipts.push(receipt.value);
  }

  return {
    ok: true,
    value: {
      loweredSchema: loweredSchema.value,
      loweredSchemaBytes,
      transformations,
      constraintReceipts,
    },
  };
};

/**
 * Capture a hostile lowerer result once and compare it with application-owned
 * deterministic lowering. The captured value is safe for later pipeline use.
 */
export const verifyLoweringIndependently = (
  providerFamily: ProviderFamilyV1,
  canonicalSchema: unknown,
  portResult: unknown,
): Effect.Effect<
  LowerSchemaResult,
  SchemaLoweringError | ConstraintWeakeningError | CanonicalSchemaInvalid
> =>
  Effect.gen(function* () {
    const canonical = captureClosedJson(canonicalSchema);
    if (!canonical.ok) {
      return yield* failCanonical(
        `/: canonical schema is not closed JSON (${canonical.reason})`,
      );
    }
    yield* validateCanonicalSchemaSnapshot(canonical.value, "", true);

    const captured = captureLoweringResult(portResult);
    if (!captured.ok) {
      return yield* failLowering(
        `provider lowerer result failed closed capture (${captured.reason})`,
        "",
      );
    }
    yield* validateCanonicalSchemaSnapshot(
      captured.value.loweredSchema,
      "",
      true,
    );

    const expected = yield* lowerProviderSchema(
      providerFamily,
      canonical.value,
    );
    const recomputedBytes = canonicalJsonBytes(captured.value.loweredSchema);
    if (
      !bytesEqual(recomputedBytes, captured.value.loweredSchemaBytes) ||
      !bytesEqual(
        expected.loweredSchemaBytes,
        captured.value.loweredSchemaBytes,
      )
    ) {
      return yield* weakenFail(
        "lowered schema bytes differ from application recomputation",
        "",
      );
    }
    if (!jsonEqual(expected.loweredSchema, captured.value.loweredSchema)) {
      return yield* weakenFail(
        "lowered schema differs from deterministic application lowering",
        "",
      );
    }
    if (!jsonEqual(expected.transformations, captured.value.transformations)) {
      return yield* weakenFail(
        "transformation receipt differs from deterministic application lowering",
        "",
      );
    }
    if (
      !jsonEqual(expected.constraintReceipts, captured.value.constraintReceipts)
    ) {
      return yield* weakenFail(
        "constraint receipts differ from deterministic application lowering",
        "",
      );
    }
    return captured.value;
  });

export type LowerSchemaResult = {
  readonly loweredSchema: unknown;
  readonly loweredSchemaBytes: Uint8Array;
  readonly transformations: readonly SchemaTransformation[];
  readonly constraintReceipts: readonly ConstraintReceipt[];
};

/**
 * Provider-neutral schema lowering walker. Never silently deletes an unknown
 * keyword. Records every removed or translated constraint.
 */
export const lowerProviderSchema = (
  providerFamily: ProviderFamilyV1,
  canonicalSchema: unknown,
): Effect.Effect<
  LowerSchemaResult,
  SchemaLoweringError | ConstraintWeakeningError | CanonicalSchemaInvalid
> =>
  Effect.gen(function* () {
    const captured = captureClosedJson(canonicalSchema);
    if (!captured.ok) {
      return yield* failCanonical(
        `/: schema is not closed JSON (${captured.reason})`,
      );
    }
    const canonicalSnapshot = captured.value;
    yield* validateCanonicalSchemaSnapshot(canonicalSnapshot, "", true);
    const walked = yield* walkSchema(
      canonicalSnapshot,
      "",
      providerFamily,
      true,
    );
    yield* verifyCombinedConstraints(
      canonicalSnapshot,
      walked.value,
      walked.constraintReceipts,
      "",
      walked.transformations,
    );

    const loweredSchemaBytes = canonicalJsonBytes(walked.value);

    if (
      (providerFamily === "anthropic" || providerFamily === "xai") &&
      loweredSchemaBytes.byteLength > INLINE_VARIANT_MAX_BYTES
    ) {
      return yield* failLowering(
        `inline ${providerFamily} schema variant exceeds ${String(INLINE_VARIANT_MAX_BYTES)} UTF-8 bytes`,
        "",
      );
    }

    return {
      loweredSchema: walked.value,
      loweredSchemaBytes,
      transformations: walked.transformations,
      constraintReceipts: walked.constraintReceipts,
    };
  });
