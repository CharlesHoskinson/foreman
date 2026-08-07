/**
 * Pure architecture-policy evaluation over a resolved delta and blob map.
 * Deterministic classification only — no Git, no filesystem.
 */

import { decodeUtf8Fatal, isCoreFailure } from "@foreman/core";
import { inspectLegacyAdapter } from "./architecture-adapter.js";
import type { DeltaRecord } from "./architecture-delta.js";
import {
  classifyExecutableSource,
  type FileIdentity,
} from "./architecture-executable.js";
import {
  isLegacyExecutablePath,
  isRuntimeBundlePath,
  isRuntimeManifestPath,
  isTestsFixturesPath,
  isTypeScriptPath,
  prohibitedExtensionReason,
  RUNTIME_MANIFEST_PATH,
} from "./architecture-extensions.js";
import {
  decodeRuntimeManifest,
  matchGeneratedBundle,
  type RuntimeManifest,
} from "./architecture-manifest.js";
import {
  sortFindings,
  sortLegacyDebt,
  type ArchitectureCheckResult,
  type LegacyDebtRecord,
  type PolicyFinding,
  type PolicyReason,
  ARCHITECTURE_SCHEMA_VERSION,
} from "./architecture-schema.js";
import { inspectTypeScriptSource } from "./architecture-ts-inspect.js";

export type EvaluateInput = {
  readonly base: string;
  readonly mergeBase: string;
  readonly head: string;
  readonly records: readonly DeltaRecord[];
  /** Paths present at merge base (for legacy debt). */
  readonly mergeBasePaths: readonly string[];
  /** Paths present at head (for existence after delete). */
  readonly headPaths: readonly string[];
  /**
   * Blob bytes keyed by `commitOid:path`. Missing key means the path is
   * absent at that commit (or unreadable).
   */
  readonly blobs: ReadonlyMap<string, Uint8Array>;
  /**
   * Exact Git tree identity (mode/link/special) keyed by `commitOid:path`.
   * Required for added/modified/renamed product paths.
   */
  readonly identities: ReadonlyMap<string, FileIdentity>;
  readonly linkPaths: ReadonlySet<string>; // `commitOid:path`
};

function blobKey(oid: string, path: string): string {
  return `${oid}:${path}`;
}

function textFromBlob(bytes: Uint8Array): string | null {
  const t = decodeUtf8Fatal(bytes);
  if (isCoreFailure(t)) return null;
  return t;
}

function loadManifest(
  head: string,
  blobs: ReadonlyMap<string, Uint8Array>,
): { manifest: RuntimeManifest | null; error: PolicyReason | null } {
  const bytes = blobs.get(blobKey(head, RUNTIME_MANIFEST_PATH));
  if (!bytes) {
    return { manifest: null, error: null };
  }
  const text = textFromBlob(bytes);
  if (text === null) {
    return { manifest: null, error: "schema_mismatch" };
  }
  const decoded = decodeRuntimeManifest(text);
  if (!decoded.ok) {
    return { manifest: null, error: decoded.reason };
  }
  return { manifest: decoded.manifest, error: null };
}

function manifestDeltaKind(
  records: readonly DeltaRecord[],
): "added" | "modified" | "renamed" | "deleted" | null {
  for (const rec of records) {
    if (rec.kind === "deleted" && isRuntimeManifestPath(rec.path)) {
      return "deleted";
    }
    if (rec.kind === "added" && isRuntimeManifestPath(rec.path)) {
      return "added";
    }
    if (rec.kind === "modified" && isRuntimeManifestPath(rec.path)) {
      return "modified";
    }
    if (rec.kind === "renamed") {
      if (isRuntimeManifestPath(rec.path)) return "renamed";
      if (isRuntimeManifestPath(rec.oldPath)) return "deleted";
    }
  }
  return null;
}

function validateManifestAuthority(args: {
  readonly head: string;
  readonly kind: "added" | "modified" | "renamed";
  readonly blobs: ReadonlyMap<string, Uint8Array>;
  readonly linkPaths: ReadonlySet<string>;
}): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  const path = RUNTIME_MANIFEST_PATH;
  const key = blobKey(args.head, path);

  if (args.linkPaths.has(key)) {
    findings.push({
      path,
      kind: args.kind,
      reason: "manifest_bundle_linked",
    });
    return findings;
  }

  const bytes = args.blobs.get(key);
  if (!bytes) {
    findings.push({
      path,
      kind: args.kind,
      reason: "manifest_bundle_missing",
    });
    return findings;
  }

  const text = textFromBlob(bytes);
  if (text === null) {
    findings.push({ path, kind: args.kind, reason: "schema_mismatch" });
    return findings;
  }

  const decoded = decodeRuntimeManifest(text);
  if (!decoded.ok) {
    findings.push({ path, kind: args.kind, reason: decoded.reason });
    return findings;
  }

  for (const art of decoded.manifest.artifacts) {
    const repoPath = `skills/foreman/runtime/${art.relativePath}`;
    const bKey = blobKey(args.head, repoPath);
    const isLink = args.linkPaths.has(bKey);
    const blob = args.blobs.get(bKey);
    if (!blob) {
      findings.push({
        path: repoPath,
        kind: args.kind,
        reason: "manifest_bundle_missing",
      });
      continue;
    }
    const m = matchGeneratedBundle({
      repoPath,
      blobBytes: blob,
      manifest: decoded.manifest,
      isLink,
    });
    if (!m.ok) {
      findings.push({ path: repoPath, kind: args.kind, reason: m.reason });
    }
  }

  return findings;
}

function checkGeneratedJs(args: {
  readonly path: string;
  readonly kind: "added" | "modified" | "renamed";
  readonly blob: Uint8Array;
  readonly manifest: RuntimeManifest | null;
  readonly isLink: boolean;
}): PolicyFinding | null {
  if (!isRuntimeBundlePath(args.path)) {
    return {
      path: args.path,
      kind: args.kind,
      reason:
        prohibitedExtensionReason(args.path) ?? "prohibited_javascript",
    };
  }
  if (args.manifest === null) {
    return {
      path: args.path,
      kind: args.kind,
      reason: "manifest_bundle_missing",
    };
  }
  const m = matchGeneratedBundle({
    repoPath: args.path,
    blobBytes: args.blob,
    manifest: args.manifest,
    isLink: args.isLink,
  });
  if (!m.ok) {
    return { path: args.path, kind: args.kind, reason: m.reason };
  }
  return null;
}

function checkTypeScript(
  path: string,
  kind: "added" | "modified" | "renamed",
  blob: Uint8Array,
): PolicyFinding | null {
  const text = textFromBlob(blob);
  if (text === null) {
    return { path, kind, reason: "internal_failed" };
  }
  const reason = inspectTypeScriptSource(path, text);
  if (reason === null) return null;
  return { path, kind, reason };
}

/** Exact first-line header that marks existing Bats files as runner test data. */
const BATS_TEST_DATA_HEADER =
  "# bats test data (run via `bats`, not as a product executable)";

/**
 * Closed exception: modified Bats under tests/ that declare the exact
 * test-data header. Does not apply to added/renamed or non-tests paths.
 */
function isModifiedBatsTestData(path: string, blob: Uint8Array): boolean {
  if (!path.startsWith("tests/")) return false;
  if (!path.endsWith(".bats")) return false;
  // Require a path segment after tests/ (rejects empty rest).
  const rest = path.slice("tests/".length);
  if (rest.length === 0 || rest.includes("\0")) return false;
  const text = textFromBlob(blob);
  if (text === null) return false;
  const nl = text.indexOf("\n");
  const firstLine = nl < 0 ? text : text.slice(0, nl);
  return firstLine === BATS_TEST_DATA_HEADER;
}

const DEFAULT_IDENTITY: FileIdentity = {
  present: true,
  mode: "100644",
  isExecutable: false,
  isSymlink: false,
  isSpecial: false,
};

function identityFor(
  head: string,
  path: string,
  identities: ReadonlyMap<string, FileIdentity>,
  linkPaths: ReadonlySet<string>,
): FileIdentity {
  const key = blobKey(head, path);
  const id = identities.get(key);
  if (id) return id;
  // Fallback for pure unit tests that omit identities for ordinary files
  if (linkPaths.has(key)) {
    return {
      present: true,
      mode: "120000",
      isExecutable: false,
      isSymlink: true,
      isSpecial: false,
    };
  }
  return DEFAULT_IDENTITY;
}

function checkPath(args: {
  readonly path: string;
  readonly kind: "added" | "modified" | "renamed";
  readonly head: string;
  readonly blobs: ReadonlyMap<string, Uint8Array>;
  readonly identities: ReadonlyMap<string, FileIdentity>;
  readonly linkPaths: ReadonlySet<string>;
  readonly manifest: RuntimeManifest | null;
}): PolicyFinding | null {
  if (isRuntimeManifestPath(args.path)) {
    return null;
  }
  const key = blobKey(args.head, args.path);
  const identity = identityFor(
    args.head,
    args.path,
    args.identities,
    args.linkPaths,
  );
  const blob = args.blobs.get(key) ?? null;

  // Special/link modes fail before content classification
  if (identity.present && (identity.isSymlink || identity.isSpecial)) {
    if (isRuntimeBundlePath(args.path) || args.path.endsWith(".js")) {
      return checkGeneratedJs({
        path: args.path,
        kind: args.kind,
        blob: blob ?? new Uint8Array(),
        manifest: args.manifest,
        isLink: true,
      });
    }
    return {
      path: args.path,
      kind: args.kind,
      reason: "prohibited_special_mode",
    };
  }

  // Closed exception: test data under tests/fixtures/. A fixture that
  // exercises shell-script handling must itself be a shell script; a
  // fixture that exercises schema rejection must itself be schema-invalid.
  // Applies uniformly to added/modified/renamed (see isTestsFixturesPath) --
  // must run before extension/legacy-adapter/TypeScript/shebang
  // classification, all of which are product-code prohibitions that do not
  // apply to test data.
  if (isTestsFixturesPath(args.path)) {
    return null;
  }

  // Generated runtime bundles: mode-bound digest match only
  if (isRuntimeBundlePath(args.path)) {
    if (blob === null) {
      return {
        path: args.path,
        kind: args.kind,
        reason: "manifest_bundle_missing",
      };
    }
    return checkGeneratedJs({
      path: args.path,
      kind: args.kind,
      blob,
      manifest: args.manifest,
      isLink: false,
    });
  }

  if (blob === null) {
    // Still classify shebang-less executable mode using empty-ish probe
    if (args.kind === "added" || args.kind === "renamed") {
      const execReason = classifyExecutableSource({
        path: args.path,
        identity,
        bytes: blob,
      });
      if (execReason !== null) {
        return { path: args.path, kind: args.kind, reason: execReason };
      }
    }
    if (identity.present && !identity.isSpecial) {
      return { path: args.path, kind: args.kind, reason: "internal_failed" };
    }
    return null;
  }

  // Added/renamed: full extension + shebang + mode prohibition
  if (args.kind === "added" || args.kind === "renamed") {
    const execReason = classifyExecutableSource({
      path: args.path,
      identity,
      bytes: blob,
    });
    if (execReason !== null) {
      return { path: args.path, kind: args.kind, reason: execReason };
    }
    if (isTypeScriptPath(args.path)) {
      return checkTypeScript(args.path, args.kind, blob);
    }
    return null;
  }

  // Modified: TypeScript AST; legacy thin-adapter grammar; shebang/mode on
  // extensionless or newly executable non-TS files.
  if (isTypeScriptPath(args.path)) {
    // Disallow non-Node shebangs even on modified TS
    const shebangOnly = classifyExecutableSource({
      path: args.path,
      identity,
      bytes: blob,
    });
    if (shebangOnly !== null) {
      return { path: args.path, kind: args.kind, reason: shebangOnly };
    }
    return checkTypeScript(args.path, args.kind, blob);
  }

  if (isLegacyExecutablePath(args.path)) {
    const text = textFromBlob(blob);
    if (text === null) {
      return { path: args.path, kind: args.kind, reason: "internal_failed" };
    }
    const reason = inspectLegacyAdapter(args.path, text);
    if (reason !== null) {
      return { path: args.path, kind: args.kind, reason };
    }
    return null;
  }

  // Closed exception: existing modified Bats under tests/ with the exact
  // test-data header. Must run before general executable-source classification
  // so mode 100755 does not trip prohibited_extensionless_executable.
  // Added/renamed Bats never enter this branch (see added/renamed arm above).
  if (isModifiedBatsTestData(args.path, blob)) {
    return null;
  }

  // Modified extensionless / other executable source
  const execReason = classifyExecutableSource({
    path: args.path,
    identity,
    bytes: blob,
  });
  if (execReason !== null) {
    return { path: args.path, kind: args.kind, reason: execReason };
  }

  return null;
}

/**
 * Evaluate architecture policy. Pure and deterministic.
 */
export function evaluateArchitecturePolicy(
  input: EvaluateInput,
): ArchitectureCheckResult {
  const {
    base,
    mergeBase,
    head,
    records,
    mergeBasePaths,
    headPaths,
    blobs,
    identities,
    linkPaths,
  } = input;

  const { manifest, error: manifestError } = loadManifest(head, blobs);

  const findings: PolicyFinding[] = [];
  const deleted = new Set<string>();

  const mfKind = manifestDeltaKind(records);
  if (mfKind === "deleted") {
    findings.push({
      path: RUNTIME_MANIFEST_PATH,
      kind: "modified",
      reason: "manifest_bundle_missing",
    });
  } else if (
    mfKind === "added" ||
    mfKind === "modified" ||
    mfKind === "renamed"
  ) {
    findings.push(
      ...validateManifestAuthority({
        head,
        kind: mfKind,
        blobs,
        linkPaths,
      }),
    );
  }

  for (const rec of records) {
    if (rec.kind === "deleted") {
      deleted.add(rec.path);
      continue;
    }
    if (rec.kind === "added" || rec.kind === "renamed") {
      if (rec.kind === "renamed") deleted.add(rec.oldPath);
      const f = checkPath({
        path: rec.path,
        kind: rec.kind,
        head,
        blobs,
        identities,
        linkPaths,
        manifest: manifestError ? null : manifest,
      });
      if (f) findings.push(f);
      continue;
    }
    if (rec.kind === "modified") {
      const f = checkPath({
        path: rec.path,
        kind: "modified",
        head,
        blobs,
        identities,
        linkPaths,
        manifest: manifestError ? null : manifest,
      });
      if (f) findings.push(f);
    }
  }

  // Legacy debt: prohibited-by-extension paths at merge base still at head.
  // Unchanged extensionless debt is not scanned (would require full-tree
  // mode loads); it never fails the candidate because it is not in the delta.
  const headSet = new Set(headPaths);
  const legacyDebt: LegacyDebtRecord[] = [];
  for (const path of mergeBasePaths) {
    if (deleted.has(path)) continue;
    if (!headSet.has(path)) continue;
    const reason = prohibitedExtensionReason(path);
    if (reason === null) continue;
    if (isRuntimeBundlePath(path)) continue;
    legacyDebt.push({ path, reason });
  }

  const sortedFindings = sortFindings(findings);
  const sortedDebt = sortLegacyDebt(legacyDebt);

  if (sortedFindings.length === 0) {
    return {
      schemaVersion: ARCHITECTURE_SCHEMA_VERSION,
      _tag: "Pass",
      base,
      mergeBase,
      head,
      findings: sortedFindings,
      legacyDebt: sortedDebt,
    };
  }
  return {
    schemaVersion: ARCHITECTURE_SCHEMA_VERSION,
    _tag: "Fail",
    base,
    mergeBase,
    head,
    findings: sortedFindings,
    legacyDebt: sortedDebt,
  };
}
