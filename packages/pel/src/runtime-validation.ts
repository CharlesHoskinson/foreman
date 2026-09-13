import { types as nodeTypes } from "node:util";
import { canonicalize, sha256Hex } from "@foreman/core";
import type { SourceSpan } from "./ast.js";
import {
  diagnostic,
  type PelDiagnostic,
  type PelDiagnosticCode,
} from "./diagnostics.js";
import type {
  JsonValue,
  PelCounters,
  PelLimitsV1,
  PelRunOptionsV1,
  Result,
} from "./types.js";

const span: SourceSpan = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};
const limitKeys = [
  "maxSourceBytes",
  "maxTokens",
  "maxAstNodes",
  "maxSyntaxDepth",
  "maxReductions",
  "maxIterations",
  "maxCallDepth",
  "maxValueBytes",
] as const;
const counterKeys = [
  "sourceBytes",
  "tokens",
  "astNodes",
  "syntaxDepthPeak",
  "reductions",
  "iterations",
  "callDepthPeak",
  "valueBytesPeak",
] as const;
const optionKeys = [
  "dependencyMode",
  "nlConditionProfile",
  "nlConditionProfileDigest",
  "replay",
] as const;
const selectionKeys = [
  "profileId",
  "transportId",
  "controls",
  "credentialProfileRef",
  "outputSchemaId",
] as const;
const replayKeys = [
  "mode",
  "completedPrefixCount",
  "prefixDigest",
  "recordedCounters",
  "committedCounters",
  "maxReplayReductions",
] as const;
const safeNatural = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const scalarString = (value: string): boolean =>
  !/[\uD800-\uDFFF]/u.test(value);

class InvalidRuntimeInput {
  constructor(
    readonly code: PelDiagnosticCode,
    readonly message: string,
    readonly bound?: string,
  ) {}
}
function invalid(
  code: PelDiagnosticCode,
  message: string,
  bound?: string,
): never {
  throw new InvalidRuntimeInput(code, message, bound);
}
function errorResult(
  error: unknown,
  fallback: PelDiagnosticCode,
): Result<never, PelDiagnostic> {
  const failure =
    error instanceof InvalidRuntimeInput
      ? error
      : new InvalidRuntimeInput(
          fallback,
          "Runtime input cannot be inspected as declarative data",
        );
  return {
    ok: false,
    error: diagnostic(
      failure.code,
      span,
      failure.message,
      failure.bound === undefined ? {} : { bound: failure.bound },
    ),
  };
}

/** Copy canonical JSON without executing getters or retaining caller-owned objects. */
function jsonSnapshot(
  value: unknown,
  code: PelDiagnosticCode,
  ancestors = new Set<object>(),
  depth = 0,
): JsonValue {
  // Match the core JSON parser's finite nesting boundary before canonical hashing.
  if (depth > 64)
    invalid(code, "Runtime JSON exceeds the canonical nesting bound");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      invalid(code, "Runtime JSON numbers must be finite");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    if (!scalarString(value))
      invalid(code, "Runtime JSON strings must contain Unicode scalars");
    return value;
  }
  if (typeof value !== "object" || nodeTypes.isProxy(value))
    invalid(code, "Runtime input must contain declarative JSON data");
  if (ancestors.has(value))
    invalid(code, "Runtime input must not contain cycles");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  )
    invalid(code, "Runtime input must use ordinary JSON objects and arrays");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string"))
    invalid(code, "Runtime input must not contain symbol properties");
  ancestors.add(value);
  try {
    if (array) {
      const lengthDescriptor = descriptors.length;
      const length: unknown = lengthDescriptor?.value;
      if (!safeNatural(length) || keys.length !== length + 1)
        invalid(
          code,
          "Runtime JSON arrays must be dense and have no extra fields",
        );
      const output: JsonValue[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (
          !descriptor ||
          !Object.hasOwn(descriptor, "value") ||
          !descriptor.enumerable
        )
          invalid(
            code,
            "Runtime JSON arrays must contain ordinary data elements",
          );
        output.push(jsonSnapshot(descriptor.value, code, ancestors, depth + 1));
      }
      return Object.freeze(output);
    }
    const output: Record<string, JsonValue> = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (
        !scalarString(key) ||
        !Object.hasOwn(descriptor, "value") ||
        !descriptor.enumerable
      )
        invalid(
          code,
          "Runtime JSON objects must contain ordinary scalar-named data fields",
        );
      Object.defineProperty(output, key, {
        value: jsonSnapshot(descriptor.value, code, ancestors, depth + 1),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
}
function record(
  value: JsonValue,
  keys: readonly string[],
  code: PelDiagnosticCode,
  message: string,
): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid(code, message);
  const object = value as Readonly<Record<string, JsonValue>>;
  const actual = Object.keys(object);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(object, key))
  )
    invalid(code, message);
  return object;
}
function counters(value: JsonValue): PelCounters {
  const object = record(
    value,
    counterKeys,
    "PEL_CONTINUATION_MISMATCH",
    "Replay counters must have the exact counter fields",
  );
  for (const key of counterKeys)
    if (!safeNatural(object[key]))
      invalid(
        "PEL_CONTINUATION_MISMATCH",
        "Replay counters must be nonnegative safe integers",
      );
  return object as unknown as PelCounters;
}

export function validateLimits(
  limits: unknown,
): Result<PelLimitsV1, PelDiagnostic> {
  try {
    const object = record(
      jsonSnapshot(limits, "PEL_LIMIT"),
      limitKeys,
      "PEL_LIMIT",
      "Limits must have the exact finite bound fields",
    );
    for (const key of limitKeys)
      if (!safeNatural(object[key]))
        invalid("PEL_LIMIT", "Limits must be nonnegative safe integers", key);
    return { ok: true, value: object as unknown as PelLimitsV1 };
  } catch (error) {
    return errorResult(error, "PEL_LIMIT");
  }
}

export function validateRunOptions(
  options: unknown,
): Result<PelRunOptionsV1, PelDiagnostic> {
  try {
    const object = record(
      jsonSnapshot(options, "PEL_REGISTRY"),
      optionKeys,
      "PEL_REGISTRY",
      "Execution options must have the exact option fields",
    );
    if (
      object.dependencyMode !== "ordered" &&
      object.dependencyMode !== "automatic"
    )
      invalid("PEL_REGISTRY", "Unknown dependency mode");
    if (object.nlConditionProfile === null) {
      if (object.nlConditionProfileDigest !== null)
        invalid(
          "PEL_REGISTRY",
          "An absent predicate selection requires an absent digest",
        );
    } else {
      const selection = record(
        object.nlConditionProfile!,
        selectionKeys,
        "PEL_REGISTRY",
        "Predicate selection must have the exact selection fields",
      );
      for (const key of [
        "profileId",
        "transportId",
        "credentialProfileRef",
      ] as const)
        if (typeof selection[key] !== "string" || selection[key].length === 0)
          invalid(
            "PEL_REGISTRY",
            "Predicate selection identities must be nonempty strings",
          );
      if (selection.outputSchemaId !== "schema:pel-boolean-v1")
        invalid(
          "PEL_REGISTRY",
          "Predicate selection must use the Boolean result schema",
        );
      if (
        !validDigest(object.nlConditionProfileDigest) ||
        sha256Hex(canonicalize(selection)) !== object.nlConditionProfileDigest
      )
        invalid(
          "PEL_REGISTRY",
          "Predicate selection digest does not match the canonical selection",
        );
    }
    const replay = object.replay;
    if (replay === null || typeof replay !== "object" || Array.isArray(replay))
      invalid(
        "PEL_CONTINUATION_MISMATCH",
        "Replay options must be a declared replay record",
      );
    const mode = (replay as Readonly<Record<string, JsonValue>>).mode;
    if (mode === "none")
      record(
        replay,
        ["mode"],
        "PEL_CONTINUATION_MISMATCH",
        "No-replay options must contain only their mode",
      );
    else if (mode === "completed-prefix") {
      const descriptor = record(
        replay,
        replayKeys,
        "PEL_CONTINUATION_MISMATCH",
        "Completed-prefix replay must have the exact replay fields",
      );
      if (
        !safeNatural(descriptor.completedPrefixCount) ||
        !safeNatural(descriptor.maxReplayReductions) ||
        !validDigest(descriptor.prefixDigest)
      )
        invalid(
          "PEL_CONTINUATION_MISMATCH",
          "Completed-prefix replay identity and bounds are invalid",
        );
      const recorded = counters(descriptor.recordedCounters!);
      const committed = counters(descriptor.committedCounters!);
      for (const key of counterKeys)
        if (committed[key] < recorded[key])
          invalid(
            "PEL_CONTINUATION_MISMATCH",
            "Committed counters cannot be below recorded counters",
          );
    } else invalid("PEL_CONTINUATION_MISMATCH", "Unknown replay mode");
    return { ok: true, value: object as unknown as PelRunOptionsV1 };
  } catch (error) {
    return errorResult(error, "PEL_REGISTRY");
  }
}
