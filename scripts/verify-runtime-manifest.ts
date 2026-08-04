/**
 * Strict runtime-manifest verifier for a skills/foreman/runtime root.
 * Pure TypeScript; used by verify-runtime against tracked and copied trees.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  isCoreFailure,
  isSha256Hex,
  parseJsonRejectDuplicateKeys,
  rejectUnknownKeys,
  expectExactLiteral,
  expectNumber,
  expectObject,
  expectString,
  canonicalize,
} from "../packages/core/src/index.js";

export type ManifestVerifyOk = {
  readonly ok: true;
  readonly sha256: string;
  readonly byteLength: number;
};

export type ManifestVerifyFail = {
  readonly ok: false;
  readonly reason: string;
};

export type ManifestVerifyResult = ManifestVerifyOk | ManifestVerifyFail;

function fail(reason: string): ManifestVerifyFail {
  return { ok: false, reason };
}

/**
 * Verify `runtimeRoot/manifest.json` against the bundle it names.
 * Requires canonical closed schema, exact node range, relative path,
 * lowercase SHA-256, integer byte length, existing regular file, exact bytes.
 */
export function verifyRuntimeManifest(
  runtimeRoot: string,
): ManifestVerifyResult {
  const manifestPath = join(runtimeRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    return fail("manifest_missing");
  }
  const st = statSync(manifestPath);
  if (!st.isFile()) {
    return fail("manifest_not_file");
  }
  const text = readFileSync(manifestPath, "utf8");
  if (!text.endsWith("\n")) {
    return fail("manifest_missing_trailing_lf");
  }
  const body = text.slice(0, -1);
  const parsed = parseJsonRejectDuplicateKeys(body);
  if (isCoreFailure(parsed)) {
    return fail("manifest_invalid_json");
  }
  try {
    if (canonicalize(parsed) !== body) {
      return fail("manifest_non_canonical");
    }
  } catch {
    return fail("manifest_non_canonical");
  }
  const obj = expectObject(parsed);
  if (isCoreFailure(obj)) return fail("manifest_schema");
  const unk = rejectUnknownKeys(obj, ["bundle", "nodeRange", "schemaVersion"]);
  if (unk) return fail("manifest_unknown_field");
  const schemaVersion = expectExactLiteral(obj["schemaVersion"], 1);
  if (isCoreFailure(schemaVersion)) return fail("manifest_schema");
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
  const relativePath = expectString(bundle["relativePath"]);
  if (isCoreFailure(relativePath) || relativePath !== "dist/destruction-guard.js") {
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
  const bundlePath = join(runtimeRoot, relativePath);
  if (!existsSync(bundlePath)) {
    return fail("bundle_missing");
  }
  const bst = statSync(bundlePath);
  if (!bst.isFile()) {
    return fail("bundle_not_file");
  }
  const bytes = readFileSync(bundlePath);
  if (bytes.byteLength !== byteLength) {
    return fail("bundle_size_mismatch");
  }
  const dig = createHash("sha256").update(bytes).digest("hex");
  if (dig !== sha256) {
    return fail("bundle_digest_mismatch");
  }
  return { ok: true, sha256, byteLength };
}
