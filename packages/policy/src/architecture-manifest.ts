/**
 * Closed runtime-manifest decode for architecture policy (schema v1 and v2).
 * Pure: operates on bytes, never follows links or reads the filesystem.
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
  sha256Hex,
  canonicalize,
} from "@foreman/core";
import type { PolicyReason } from "./architecture-schema.js";
import { RUNTIME_DIST_PREFIX } from "./architecture-extensions.js";

export type ManifestArtifact = {
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
};

export type RuntimeManifest = {
  readonly schemaVersion: 1 | 2;
  readonly nodeRange: string;
  readonly artifacts: readonly ManifestArtifact[];
};

export type ManifestDecodeOk = {
  readonly ok: true;
  readonly manifest: RuntimeManifest;
};

export type ManifestDecodeFail = {
  readonly ok: false;
  readonly reason: PolicyReason;
};

export type ManifestDecodeResult = ManifestDecodeOk | ManifestDecodeFail;

function fail(reason: PolicyReason): ManifestDecodeFail {
  return { ok: false, reason };
}

function normalizeRelativePath(p: string): string | null {
  if (p.length === 0) return null;
  if (p.startsWith("/") || p.includes("\\") || p.includes("\0")) return null;
  if (p.includes("..")) return null;
  // Collapse accidental ./ only at start
  let s = p;
  while (s.startsWith("./")) s = s.slice(2);
  if (s.includes("//")) return null;
  return s;
}

function artifactFromBundleObject(
  bundle: Record<string, unknown>,
): { ok: true; artifact: ManifestArtifact } | ManifestDecodeFail {
  const bUnk = rejectUnknownKeys(bundle, [
    "byteLength",
    "relativePath",
    "sha256",
  ]);
  if (bUnk) return fail("schema_mismatch");
  const relativePathRaw = expectString(bundle["relativePath"]);
  if (isCoreFailure(relativePathRaw)) return fail("schema_mismatch");
  const relativePath = normalizeRelativePath(relativePathRaw);
  if (relativePath === null) return fail("schema_mismatch");
  // Runtime artifact paths must stay under dist/ with no escape.
  if (!relativePath.startsWith("dist/") || relativePath === "dist/") {
    return fail("schema_mismatch");
  }
  if (relativePath.includes("\\") || relativePath.split("/").some((p) => p === "" || p === "." || p === "..")) {
    return fail("schema_mismatch");
  }
  const sha256 = expectString(bundle["sha256"]);
  if (isCoreFailure(sha256) || !isSha256Hex(sha256)) {
    return fail("schema_mismatch");
  }
  const byteLength = expectNumber(bundle["byteLength"]);
  if (
    isCoreFailure(byteLength) ||
    !Number.isInteger(byteLength) ||
    byteLength < 0
  ) {
    return fail("schema_mismatch");
  }
  return { ok: true, artifact: { relativePath, byteLength, sha256 } };
}

/**
 * Decode manifest bytes. Requires canonical JSON body (optional single trailing
 * LF). Rejects duplicate keys, unknown fields, unsafe relative paths, and
 * non-canonical form.
 */
export function decodeRuntimeManifest(
  text: string,
): ManifestDecodeResult {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  const parsed = parseJsonRejectDuplicateKeys(body);
  if (isCoreFailure(parsed)) return fail("schema_mismatch");
  try {
    if (canonicalize(parsed) !== body) {
      return fail("schema_mismatch");
    }
  } catch {
    return fail("schema_mismatch");
  }
  const obj = expectObject(parsed);
  if (isCoreFailure(obj)) return fail("schema_mismatch");

  const schemaVersion = obj["schemaVersion"];
  if (schemaVersion === 1) {
    const unk = rejectUnknownKeys(obj, ["bundle", "nodeRange", "schemaVersion"]);
    if (unk) return fail("schema_mismatch");
    const nodeRange = expectString(obj["nodeRange"]);
    if (isCoreFailure(nodeRange) || nodeRange !== ">=24 <25") {
      return fail("schema_mismatch");
    }
    const bundle = expectObject(obj["bundle"]);
    if (isCoreFailure(bundle)) return fail("schema_mismatch");
    const art = artifactFromBundleObject(bundle);
    if (!art.ok) return art;
    return {
      ok: true,
      manifest: {
        schemaVersion: 1,
        nodeRange,
        artifacts: [art.artifact],
      },
    };
  }

  if (schemaVersion === 2) {
    const unk = rejectUnknownKeys(obj, [
      "artifacts",
      "nodeRange",
      "schemaVersion",
    ]);
    if (unk) return fail("schema_mismatch");
    const sv = expectExactLiteral(obj["schemaVersion"], 2);
    if (isCoreFailure(sv)) return fail("schema_mismatch");
    const nodeRange = expectString(obj["nodeRange"]);
    if (isCoreFailure(nodeRange) || nodeRange !== ">=24 <25") {
      return fail("schema_mismatch");
    }
    const artifactsRaw = expectArray(obj["artifacts"]);
    if (isCoreFailure(artifactsRaw)) return fail("schema_mismatch");
    if (artifactsRaw.length === 0) return fail("schema_mismatch");
    const artifacts: ManifestArtifact[] = [];
    const seen = new Set<string>();
    for (const item of artifactsRaw) {
      const aobj = expectObject(item);
      if (isCoreFailure(aobj)) return fail("schema_mismatch");
      // Allow optional closed id key
      const allowed = ["byteLength", "relativePath", "sha256", "id"];
      const aUnk = rejectUnknownKeys(aobj, allowed);
      if (aUnk) return fail("schema_mismatch");
      if (aobj["id"] !== undefined) {
        const id = expectString(aobj["id"]);
        if (isCoreFailure(id) || id.length === 0) return fail("schema_mismatch");
      }
      const art = artifactFromBundleObject({
        byteLength: aobj["byteLength"],
        relativePath: aobj["relativePath"],
        sha256: aobj["sha256"],
      });
      if (!art.ok) return art;
      const a = art.artifact;
      if (seen.has(a.relativePath)) {
        return fail("manifest_bundle_duplicate");
      }
      seen.add(a.relativePath);
      artifacts.push(a);
    }
    return {
      ok: true,
      manifest: { schemaVersion: 2, nodeRange, artifacts },
    };
  }

  return fail("schema_mismatch");
}

/**
 * Map a repository-relative runtime dist path to the manifest relativePath
 * (e.g. skills/foreman/runtime/dist/x.js → dist/x.js).
 */
export function repoPathToManifestRelative(repoPath: string): string | null {
  if (!repoPath.startsWith(RUNTIME_DIST_PREFIX)) return null;
  const name = repoPath.slice(RUNTIME_DIST_PREFIX.length);
  if (name.length === 0 || name.includes("/") || name.includes("..")) {
    return null;
  }
  return `dist/${name}`;
}

export type BundleMatch =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PolicyReason };

/**
 * Check that a candidate blob is exactly the declared manifest artifact.
 * linked: caller sets isLink when git mode is symlink (120000).
 */
export function matchGeneratedBundle(args: {
  readonly repoPath: string;
  readonly blobBytes: Uint8Array;
  readonly manifest: RuntimeManifest;
  readonly isLink: boolean;
}): BundleMatch {
  if (args.isLink) {
    return { ok: false, reason: "manifest_bundle_linked" };
  }
  const rel = repoPathToManifestRelative(args.repoPath);
  if (rel === null) {
    return { ok: false, reason: "undeclared_generated_bundle" };
  }
  const matches = args.manifest.artifacts.filter((a) => a.relativePath === rel);
  if (matches.length === 0) {
    return { ok: false, reason: "undeclared_generated_bundle" };
  }
  if (matches.length > 1) {
    return { ok: false, reason: "manifest_bundle_duplicate" };
  }
  const art = matches[0]!;
  if (args.blobBytes.byteLength !== art.byteLength) {
    return { ok: false, reason: "manifest_bundle_mismatch" };
  }
  const dig = sha256Hex(args.blobBytes);
  if (dig !== art.sha256) {
    return { ok: false, reason: "manifest_bundle_mismatch" };
  }
  return { ok: true };
}
