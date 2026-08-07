import {
  isCoreFailure,
  schemaMismatch,
  unknownField,
  type CoreFailure,
} from "./failures.js";

export { isCoreFailure };

export function expectObject(
  value: unknown,
): Record<string, unknown> | CoreFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schemaMismatch("expected_object");
  }
  return value as Record<string, unknown>;
}

export function expectString(value: unknown): string | CoreFailure {
  if (typeof value !== "string") {
    return schemaMismatch("expected_string");
  }
  return value;
}

export function expectNumber(value: unknown): number | CoreFailure {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return schemaMismatch("expected_number");
  }
  return value;
}

export function expectArray(value: unknown): unknown[] | CoreFailure {
  if (!Array.isArray(value)) {
    return schemaMismatch("expected_array");
  }
  return value;
}

export function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
): CoreFailure | null {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) {
      return unknownField(key);
    }
  }
  return null;
}

export function expectExactLiteral<T extends string | number | boolean>(
  value: unknown,
  literal: T,
): T | CoreFailure {
  if (value !== literal) {
    return schemaMismatch("literal_mismatch");
  }
  return literal;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const COMMIT_SHA40 = /^[0-9a-f]{40}$/;

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

export function isCommitSha40(value: string): boolean {
  return COMMIT_SHA40.test(value);
}
