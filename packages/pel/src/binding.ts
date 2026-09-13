import { validateAuthoringSnapshotV1 } from "./snapshot.js";
import { canonicalize, sha256Hex } from "@foreman/core";
import type {
  AuthoringDiagnostic,
  AuthoringSnapshotV1,
  PlanBindingV1,
} from "./authoring-types.js";
import type { Result } from "./types.js";

/** Check inert, finite JSON before canonicalizing. Accessors are never evaluated. */
export function canonicalAuthoringJson(value: unknown): string {
  const active = new Set<object>();
  let nodes = 0;
  function walk(item: unknown, depth: number): void {
    if (++nodes > 200000 || depth > 64)
      throw new Error("Authoring JSON limit exceeded");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") {
      if (!item.isWellFormed()) throw new Error("Malformed Unicode");
      return;
    }
    if (typeof item === "number") {
      if (
        !Number.isFinite(item) ||
        (Number.isInteger(item) && !Number.isSafeInteger(item))
      )
        throw new Error("Invalid number");
      return;
    }
    if (typeof item !== "object" || active.has(item))
      throw new Error("Expected acyclic JSON");
    // Registry brands are inert metadata; validation reconstructs authority locally.
    for (const symbol of Object.getOwnPropertySymbols(item)) {
      const d = Object.getOwnPropertyDescriptor(item, symbol)!;
      if (
        !["PelHostRegistry", "PelHostDescriptor"].includes(
          symbol.description ?? "",
        ) ||
        d.enumerable ||
        !("value" in d) ||
        d.value !== true
      )
        throw new Error("Symbol keys are forbidden");
    }
    const proto: unknown = Object.getPrototypeOf(item);
    if (
      Array.isArray(item)
        ? proto !== Array.prototype
        : proto !== null && proto !== Object.prototype
    )
      throw new Error("Expected JSON object");
    active.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (
      Array.isArray(item) &&
      Object.keys(descriptors).length !== item.length + 1
    )
      throw new Error("Sparse or extended array");
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(item) && key === "length") continue;
      if (!("value" in descriptor) || !descriptor.enumerable)
        throw new Error("Expected inert JSON");
      if (Array.isArray(item) && !/^(0|[1-9][0-9]*)$/.test(key))
        throw new Error("Extended array");
      walk(descriptor.value, depth + 1);
    }
    active.delete(item);
  }
  walk(value, 0);
  const encoded = canonicalize(value);
  if (Buffer.byteLength(encoded) > 16 * 1024 * 1024)
    throw new Error("Authoring JSON exceeds 16 MiB");
  return encoded;
}
export const hashAuthoringContent = (value: unknown): string =>
  sha256Hex(canonicalAuthoringJson(value));
export function createPlanBindingV1(
  source: Uint8Array,
  snapshot: AuthoringSnapshotV1,
): PlanBindingV1 {
  return Object.freeze({
    schemaVersion: 1,
    sourceDigest: sha256Hex(source),
    snapshotDigest: snapshot.snapshotDigest,
    languageProfileDigest: snapshot.languageProfileDigest,
    registryDigest: snapshot.registryDigest,
    providerProfilesDigest: snapshot.providerProfilesDigest,
    policyDigest: snapshot.policyDigest,
    optionsDigest: snapshot.optionsDigest,
    artifactDigests: snapshot.artifactDigests,
  });
}
export function validateBinding(
  binding: unknown,
  source: Uint8Array,
  snapshot: AuthoringSnapshotV1,
): Result<PlanBindingV1, AuthoringDiagnostic[]> {
  const validated = validateAuthoringSnapshotV1(snapshot);
  if (!validated.ok) return validated;
  const expected = createPlanBindingV1(source, validated.value);
  try {
    if (canonicalAuthoringJson(binding) === canonicalAuthoringJson(expected))
      return { ok: true, value: expected };
  } catch {
    /* Invalid serialized binding. */
  }
  return {
    ok: false,
    error: [
      {
        code: "PEL_BINDING_MISMATCH",
        severity: "error",
        span: {
          start: 0,
          end: 0,
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 1,
        },
        relatedSpans: [],
        expectedForms: [],
        message:
          "The source or authoring environment differs from the checked binding; check the source again.",
      },
    ],
  };
}
