/**
 * Strict runtime-manifest verifier for a skills/foreman/runtime root.
 * Supports schemaVersion 1 (single bundle) and 2 (artifacts array).
 *
 * Link-aware: the manifest must be one regular non-link file. The `dist/`
 * directory is enumerated without following links and must contain exactly the
 * declared regular bundle files — no extras, nested dirs, or specials.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
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
  expectArray,
  canonicalize,
} from "../packages/core/src/index.js";

export type ManifestVerifyOk = {
  readonly ok: true;
  readonly artifacts: readonly {
    readonly relativePath: string;
    readonly sha256: string;
    readonly byteLength: number;
  }[];
};

export type ManifestVerifyFail = {
  readonly ok: false;
  readonly reason: string;
};

export type ManifestVerifyResult = ManifestVerifyOk | ManifestVerifyFail;

function fail(reason: string): ManifestVerifyFail {
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

function verifyOneArtifact(
  runtimeRoot: string,
  relativePath: string,
  sha256: string,
  byteLength: number,
): ManifestVerifyFail | null {
  const bundlePath = join(runtimeRoot, relativePath);
  if (!existsSync(bundlePath)) {
    return fail("bundle_missing");
  }
  const lst = lstatSync(bundlePath);
  if (lst.isSymbolicLink()) {
    return fail("bundle_linked");
  }
  if (!lst.isFile()) {
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
  return null;
}

/**
 * Enumerate `dist/` without following links. Returns relative paths of the
 * form `dist/<name>` for regular files only. Rejects nested directories,
 * symlinks, and non-file specials.
 */
function enumerateDistExact(
  runtimeRoot: string,
): { ok: true; names: Set<string> } | ManifestVerifyFail {
  const distDir = join(runtimeRoot, "dist");
  if (!existsSync(distDir)) {
    return fail("dist_missing");
  }
  const distStat = lstatSync(distDir);
  if (distStat.isSymbolicLink()) {
    return fail("dist_linked");
  }
  if (!distStat.isDirectory()) {
    return fail("dist_not_directory");
  }
  let entries;
  try {
    entries = readdirSync(distDir, { withFileTypes: true });
  } catch {
    return fail("dist_unreadable");
  }
  const names = new Set<string>();
  for (const ent of entries) {
    const rel = `dist/${ent.name}`;
    // Re-lstat via path to avoid Dirent follow edge cases
    const full = join(distDir, ent.name);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      return fail("dist_unreadable");
    }
    if (st.isSymbolicLink()) {
      return fail("dist_entry_linked");
    }
    if (st.isDirectory()) {
      return fail("dist_unexpected_directory");
    }
    if (!st.isFile()) {
      return fail("dist_entry_not_file");
    }
    if (names.has(rel)) {
      return fail("dist_duplicate_path");
    }
    // Path escape / nested names with separators
    if (
      ent.name.includes("/") ||
      ent.name.includes("\\") ||
      ent.name.includes("\0") ||
      ent.name === ".." ||
      ent.name === "."
    ) {
      return fail("dist_path_escape");
    }
    names.add(rel);
  }
  return { ok: true, names };
}

/**
 * Verify `runtimeRoot/manifest.json` against every artifact it names and
 * ensure `dist/` contains exactly those regular files.
 */
export function verifyRuntimeManifest(
  runtimeRoot: string,
): ManifestVerifyResult {
  const manifestPath = join(runtimeRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    return fail("manifest_missing");
  }
  const mlst = lstatSync(manifestPath);
  if (mlst.isSymbolicLink()) {
    return fail("manifest_linked");
  }
  if (!mlst.isFile()) {
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

  const schemaVersion = obj["schemaVersion"];
  let artifacts: {
    relativePath: string;
    sha256: string;
    byteLength: number;
  }[] = [];

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
    artifacts = [{ relativePath: relativePathRaw, sha256, byteLength }];
  } else if (schemaVersion === 2) {
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
    const seen = new Set<string>();
    const required = new Set([
      "dist/architecture-policy.js",
      "dist/destruction-guard.js",
    ]);
    for (const item of artifactsRaw) {
      const aobj = expectObject(item);
      if (isCoreFailure(aobj)) return fail("manifest_schema");
      const aUnk = rejectUnknownKeys(aobj, [
        "byteLength",
        "id",
        "relativePath",
        "sha256",
      ]);
      if (aUnk) return fail("manifest_unknown_field");
      if (aobj["id"] !== undefined) {
        const id = expectString(aobj["id"]);
        if (isCoreFailure(id) || id.length === 0) return fail("manifest_schema");
      }
      const relativePathRaw = expectString(aobj["relativePath"]);
      if (isCoreFailure(relativePathRaw)) return fail("manifest_relative_path");
      const relativePath = normalizeRelativePath(relativePathRaw);
      if (relativePath === null || !relativePath.startsWith("dist/")) {
        return fail("manifest_relative_path");
      }
      // Flat dist entries only for product installs
      const rest = relativePath.slice("dist/".length);
      if (
        rest.length === 0 ||
        rest.includes("/") ||
        rest.includes("\\") ||
        rest.includes("..")
      ) {
        return fail("manifest_relative_path");
      }
      if (seen.has(relativePath)) return fail("manifest_duplicate_path");
      seen.add(relativePath);
      const sha256 = expectString(aobj["sha256"]);
      if (isCoreFailure(sha256) || !isSha256Hex(sha256)) {
        return fail("manifest_sha256");
      }
      const byteLength = expectNumber(aobj["byteLength"]);
      if (
        isCoreFailure(byteLength) ||
        !Number.isInteger(byteLength) ||
        byteLength < 0
      ) {
        return fail("manifest_byte_length");
      }
      artifacts.push({ relativePath, sha256, byteLength });
      required.delete(relativePath);
    }
    if (required.size > 0) {
      return fail("manifest_missing_required_artifact");
    }
  } else {
    return fail("manifest_schema");
  }

  // Digest checks for every declared artifact
  for (const art of artifacts) {
    const one = verifyOneArtifact(
      runtimeRoot,
      art.relativePath,
      art.sha256,
      art.byteLength,
    );
    if (one) return one;
  }

  // Exact dist membership: declared set == enumerated set
  const dist = enumerateDistExact(runtimeRoot);
  if (!dist.ok) return dist;
  const declared = new Set(artifacts.map((a) => a.relativePath));
  for (const name of dist.names) {
    if (!declared.has(name)) {
      return fail("dist_extra_entry");
    }
  }
  for (const name of declared) {
    if (!dist.names.has(name)) {
      return fail("bundle_missing");
    }
  }

  return { ok: true, artifacts };
}
