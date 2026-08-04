/**
 * Unforgeable brand for CoreFailure values. User JSON cannot carry this
 * symbol, so ordinary data with a `_tag` string never masquerades as failure.
 */
export const CORE_FAILURE_BRAND = Symbol("@foreman/core/CoreFailure");

type Branded = { readonly [CORE_FAILURE_BRAND]: true };

export type CoreFailure =
  | (Branded & { readonly _tag: "MalformedUtf8" })
  | (Branded & { readonly _tag: "OversizeInput"; readonly maxBytes: number })
  | (Branded & { readonly _tag: "NonCanonicalJson" })
  | (Branded & { readonly _tag: "DuplicateJsonKey" })
  | (Branded & { readonly _tag: "InvalidJson" })
  | (Branded & { readonly _tag: "UnknownField"; readonly field: string })
  | (Branded & { readonly _tag: "SchemaMismatch"; readonly reason: string });

export function malformedUtf8(): CoreFailure {
  return { [CORE_FAILURE_BRAND]: true, _tag: "MalformedUtf8" };
}

export function oversizeInput(maxBytes: number): CoreFailure {
  return { [CORE_FAILURE_BRAND]: true, _tag: "OversizeInput", maxBytes };
}

export function nonCanonicalJson(): CoreFailure {
  return { [CORE_FAILURE_BRAND]: true, _tag: "NonCanonicalJson" };
}

export function duplicateJsonKey(): CoreFailure {
  return { [CORE_FAILURE_BRAND]: true, _tag: "DuplicateJsonKey" };
}

export function invalidJson(): CoreFailure {
  return { [CORE_FAILURE_BRAND]: true, _tag: "InvalidJson" };
}

export function unknownField(field: string): CoreFailure {
  return { [CORE_FAILURE_BRAND]: true, _tag: "UnknownField", field };
}

export function schemaMismatch(reason: string): CoreFailure {
  return { [CORE_FAILURE_BRAND]: true, _tag: "SchemaMismatch", reason };
}

export function isCoreFailure(v: unknown): v is CoreFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [CORE_FAILURE_BRAND]?: unknown })[CORE_FAILURE_BRAND] === true
  );
}
