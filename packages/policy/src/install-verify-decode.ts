/**
 * Pure manifest decode for installed-runtime verification.
 * Reuses @foreman/core primitives; never touches the filesystem.
 */

import {
  isCoreFailure,
  isSha256Hex,
  parseJsonRejectDuplicateKeys,
  rejectUnknownKeys,
  expectExactLiteral,
  expectNumber,
  expectObject,
  expectString,
  expectArray,
  canonicalize,
} from "@foreman/core";
import type {
  InstallArtifactDescriptor,
  InstallVerifyReason,
} from "./install-verify-schema.js";

export type DecodedInstallManifest = {
  readonly schemaVersion: 1 | 2;
  readonly nodeRange: string;
  readonly artifacts: readonly InstallArtifactDescriptor[];
  /** Exact canonical body bytes without trailing LF (for drift compare). */
  readonly canonicalBody: string;
};

export type DecodeInstallManifestResult =
  | { readonly ok: true; readonly manifest: DecodedInstallManifest }
  | { readonly ok: false; readonly reason: InstallVerifyReason };

function fail(reason: InstallVerifyReason): DecodeInstallManifestResult {
  return { ok: false, reason };
}

function normalizeRelativePath(p: string): string | null {
  if (p.length === 0) return null;
  if (p.startsWith("/") || p.includes("\\") || p.includes("\0")) return null;
  if (p.includes("..")) return null;
  let s = p;
  while (s.startsWith("./")) s = s.slice(2);
  if (s.includes("//")) return null;
  return s;
}

const REQUIRED_V2 = new Set([
  "dist/architecture-policy.js",
  "dist/destruction-guard.js",
  "dist/lane-queue.js",
  "dist/lane-round.js",
]);

function decodeArtifactObject(
  aobj: Record<string, unknown>,
):
  | { ok: true; artifact: InstallArtifactDescriptor }
  | { ok: false; reason: InstallVerifyReason } {
  const aUnk = rejectUnknownKeys(aobj, [
    "byteLength",
    "id",
    "relativePath",
    "sha256",
  ]);
  if (aUnk) return { ok: false, reason: "manifest_unknown_field" };
  if (aobj["id"] !== undefined) {
    const id = expectString(aobj["id"]);
    if (isCoreFailure(id) || id.length === 0) {
      return { ok: false, reason: "manifest_schema" };
    }
  }
  const relativePathRaw = expectString(aobj["relativePath"]);
  if (isCoreFailure(relativePathRaw)) {
    return { ok: false, reason: "manifest_relative_path" };
  }
  const relativePath = normalizeRelativePath(relativePathRaw);
  if (relativePath === null || !relativePath.startsWith("dist/")) {
    return { ok: false, reason: "manifest_relative_path" };
  }
  const rest = relativePath.slice("dist/".length);
  if (
    rest.length === 0 ||
    rest.includes("/") ||
    rest.includes("\\") ||
    rest.includes("..")
  ) {
    return { ok: false, reason: "manifest_relative_path" };
  }
  const sha256 = expectString(aobj["sha256"]);
  if (isCoreFailure(sha256) || !isSha256Hex(sha256)) {
    return { ok: false, reason: "manifest_sha256" };
  }
  const byteLength = expectNumber(aobj["byteLength"]);
  if (
    isCoreFailure(byteLength) ||
    !Number.isInteger(byteLength) ||
    byteLength < 0
  ) {
    return { ok: false, reason: "manifest_byte_length" };
  }
  return {
    ok: true,
    artifact: { relativePath, sha256, byteLength },
  };
}

/**
 * Decode canonical manifest text. Requires a single trailing LF on the
 * stored file; body without LF must be canonical JSON.
 */
export function decodeInstallManifestText(
  text: string,
): DecodeInstallManifestResult {
  if (!text.endsWith("\n")) {
    return fail("manifest_missing_trailing_lf");
  }
  const body = text.slice(0, -1);
  const parsed = parseJsonRejectDuplicateKeys(body);
  if (isCoreFailure(parsed)) {
    return fail("manifest_invalid_json");
  }
  let canonicalBody: string;
  try {
    canonicalBody = canonicalize(parsed);
  } catch {
    return fail("manifest_non_canonical");
  }
  if (canonicalBody !== body) {
    return fail("manifest_non_canonical");
  }
  const obj = expectObject(parsed);
  if (isCoreFailure(obj)) return fail("manifest_schema");

  const schemaVersion = obj["schemaVersion"];
  if (schemaVersion === 1) {
    const unk = rejectUnknownKeys(obj, ["bundle", "nodeRange", "schemaVersion"]);
    if (unk) return fail("manifest_unknown_field");
    const nodeRange = expectString(obj["nodeRange"]);
    if (isCoreFailure(nodeRange) || nodeRange !== ">=24 <25") {
      return fail("manifest_node_range");
    }
    const bundle = expectObject(obj["bundle"]);
    if (isCoreFailure(bundle)) return fail("manifest_schema");
    const bUnk = rejectUnknownKeys(bundle, [
      "byteLength",
      "relativePath",
      "sha256",
    ]);
    if (bUnk) return fail("manifest_unknown_field");
    const relativePathRaw = expectString(bundle["relativePath"]);
    if (
      isCoreFailure(relativePathRaw) ||
      relativePathRaw !== "dist/destruction-guard.js"
    ) {
      return fail("manifest_relative_path");
    }
    const sha256 = expectString(bundle["sha256"]);
    if (isCoreFailure(sha256) || !isSha256Hex(sha256)) {
      return fail("manifest_sha256");
    }
    const byteLength = expectNumber(bundle["byteLength"]);
    if (
      isCoreFailure(byteLength) ||
      !Number.isInteger(byteLength) ||
      byteLength < 0
    ) {
      return fail("manifest_byte_length");
    }
    return {
      ok: true,
      manifest: {
        schemaVersion: 1,
        nodeRange,
        artifacts: [{ relativePath: relativePathRaw, sha256, byteLength }],
        canonicalBody,
      },
    };
  }

  if (schemaVersion === 2) {
    const unk = rejectUnknownKeys(obj, [
      "artifacts",
      "nodeRange",
      "schemaVersion",
    ]);
    if (unk) return fail("manifest_unknown_field");
    const sv = expectExactLiteral(obj["schemaVersion"], 2);
    if (isCoreFailure(sv)) return fail("manifest_schema");
    const nodeRange = expectString(obj["nodeRange"]);
    if (isCoreFailure(nodeRange) || nodeRange !== ">=24 <25") {
      return fail("manifest_node_range");
    }
    const artifactsRaw = expectArray(obj["artifacts"]);
    if (isCoreFailure(artifactsRaw) || artifactsRaw.length === 0) {
      return fail("manifest_schema");
    }
    const artifacts: InstallArtifactDescriptor[] = [];
    const seen = new Set<string>();
    const required = new Set(REQUIRED_V2);
    for (const item of artifactsRaw) {
      const aobj = expectObject(item);
      if (isCoreFailure(aobj)) return fail("manifest_schema");
      const art = decodeArtifactObject(aobj);
      if (!art.ok) return fail(art.reason);
      if (seen.has(art.artifact.relativePath)) {
        return fail("manifest_duplicate_path");
      }
      seen.add(art.artifact.relativePath);
      artifacts.push(art.artifact);
      required.delete(art.artifact.relativePath);
    }
    if (required.size > 0) {
      return fail("manifest_missing_required_artifact");
    }
    return {
      ok: true,
      manifest: {
        schemaVersion: 2,
        nodeRange,
        artifacts,
        canonicalBody,
      },
    };
  }

  return fail("manifest_schema");
}
