/**
 * Bounded fixture-aware Grok worktree secret scan (Sprint 3 R6 / CW-027).
 *
 * Live scanner accepts one preflighted absolute worktree root, never follows
 * symlinks, never leaves the root, prunes top-level `.git/` and `.harness/`,
 * refuses secret filename classes and PEM private-key headers, and applies
 * explicit positive bounds. Fixture exemptions are exact path+SHA-256 identity
 * under `tests/fixtures/` only.
 *
 * Directory operations bind to stable identities via no-follow directory
 * descriptors and `/proc/self/fd/<fd>` anchors (same pattern as R5D
 * supervisor-live-services). Pathnames are never reused after validation
 * without an open identity. When the host cannot provide that primitive,
 * the live scanner fails closed with `unsupported_traversal`.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  type Dir,
  type Stats,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { canonicalize } from "@foreman/core";
import { utf8ByteLength } from "./round-contract.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

export const SECRET_SCAN_SCHEMA_VERSION = 1 as const;

/** Top-level directory names pruned (match shell find -path $wt/.git|.harness). */
export const PRUNE_TOP_LEVEL = new Set([".git", ".harness"]);

/** Closed fixture subtree prefix (posix, trailing slash). */
export const FIXTURE_SUBTREE_PREFIX = "tests/fixtures/";

/** Repository-relative path of the fixture exemption declaration. */
export const FIXTURE_DECLARATION_RELPATH =
  "tests/fixtures/secret-scan-exemptions.json";

export const MAX_DIRECTORY_ENTRIES = 200_000;
export const MAX_FILES = 100_000;
export const MAX_RELATIVE_PATH_BYTES = 4_096;
/** Per-file content bound (16 MiB). Covers large toolchain binaries under deps. */
export const MAX_FILE_BYTES = 16_777_216;
/** Total inspected content bound (256 MiB). Fail-closed above this. */
export const MAX_TOTAL_INSPECTED_BYTES = 268_435_456;
export const MAX_LINE_INSPECTIONS = 5_000_000;
export const MAX_EXEMPTIONS = 256;
export const MAX_FIXTURE_DECLARATION_BYTES = 65_536;

export const DEFAULT_SECRET_SCAN_BOUNDS: SecretScanBounds = {
  maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
  maxFiles: MAX_FILES,
  maxRelativePathBytes: MAX_RELATIVE_PATH_BYTES,
  maxFileBytes: MAX_FILE_BYTES,
  maxTotalInspectedBytes: MAX_TOTAL_INSPECTED_BYTES,
  maxLineInspections: MAX_LINE_INSPECTIONS,
  maxExemptions: MAX_EXEMPTIONS,
  maxFixtureDeclarationBytes: MAX_FIXTURE_DECLARATION_BYTES,
};

export const EXIT_CLEAN = 0;
export const EXIT_NOT_CLEAN = 1;
export const EXIT_INVALID_ARGUMENTS = 2;

export const MSG_INVALID_ARGUMENTS = "secret-scan: invalid arguments";
export const MSG_INTERNAL_FAILURE = "secret-scan: internal failure";

/** PEM private-key banner at start of a line (shell-equivalent line anchor). */
const PEM_LINE_RE =
  /^[ \t\f\v\r]*-----BEGIN[ \t\f\v\r].*PRIVATE KEY-----[ \t\f\v\r]*$/;

const PRIVATE_KEY_BASENAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

const PRIVATE_KEY_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecretScanBounds = {
  readonly maxDirectoryEntries: number;
  readonly maxFiles: number;
  readonly maxRelativePathBytes: number;
  readonly maxFileBytes: number;
  readonly maxTotalInspectedBytes: number;
  readonly maxLineInspections: number;
  readonly maxExemptions: number;
  readonly maxFixtureDeclarationBytes: number;
};

export type SecretScanRefusalReason =
  | "invalid_worktree"
  | "unreadable"
  | "identity_changed"
  | "unsupported_traversal"
  | "malformed_fixture_declaration"
  | "bound_exceeded";

export type SecretScanResult =
  | { readonly _tag: "Clean" }
  | { readonly _tag: "SecretFound" }
  | {
      readonly _tag: "Refused";
      readonly reason: SecretScanRefusalReason;
    };

export type SecretScanInput = {
  readonly worktreeRoot: string;
  readonly bounds?: SecretScanBounds;
};

export type SecretScanCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type ParsedSecretScanArgv =
  | { readonly _tag: "Ok"; readonly worktreeRoot: string }
  | { readonly _tag: "Invalid" };

type ExemptionMap = ReadonlyMap<string, string>;

type Counters = {
  directoryEntries: number;
  files: number;
  totalInspectedBytes: number;
  lineInspections: number;
};

// ---------------------------------------------------------------------------
// Directory-identity race seams (test-only; production never installs)
// ---------------------------------------------------------------------------

/**
 * Hooks invoked after a directory identity is bound and before the next
 * use of that binding. Production never installs a hook. Tests swap
 * pathnames here to prove descriptor-anchored operations do not follow
 * a parent alias replaced after validation.
 */
export type SecretScanRaceHook = {
  /** After the worktree root is open-bound; before fixture load or listing. */
  readonly afterBindRoot?: () => void;
  /**
   * After a nested directory is open-bound through the parent descriptor;
   * before listing that directory. `posixRel` is repository-relative.
   */
  readonly afterBindDirectory?: (posixRel: string) => void;
  /**
   * After an entry is observed as a regular file and before it is opened
   * for content read. `posixRel` is repository-relative. Tests may replace
   * the path with a symlink to prove identity-changed refusal.
   */
  readonly afterObserveRegularFile?: (posixRel: string) => void;
};

let secretScanRaceHook: SecretScanRaceHook | undefined;

/**
 * Install or clear the secret-scan directory-identity race seam. Tests only.
 */
export function setSecretScanRaceHook(
  hook: SecretScanRaceHook | undefined,
): void {
  secretScanRaceHook = hook;
}

function fireAfterBindRoot(): void {
  const h = secretScanRaceHook?.afterBindRoot;
  if (h) h();
}

function fireAfterBindDirectory(posixRel: string): void {
  const h = secretScanRaceHook?.afterBindDirectory;
  if (h) h(posixRel);
}

function fireAfterObserveRegularFile(posixRel: string): void {
  const h = secretScanRaceHook?.afterObserveRegularFile;
  if (h) h(posixRel);
}

// ---------------------------------------------------------------------------
// Directory identity + descriptor anchors (R5D pattern)
// ---------------------------------------------------------------------------

type DirIdentity = {
  readonly dev: number;
  readonly ino: number;
};

type BoundDir = {
  readonly fd: number;
  readonly identity: DirIdentity;
};

function closeQuiet(fd: number | undefined): void {
  if (fd === undefined) return;
  try {
    closeSync(fd);
  } catch {
    /* ignore */
  }
}

function identityOf(st: Stats): DirIdentity {
  return { dev: st.dev, ino: st.ino };
}

function identitiesEqual(a: DirIdentity, b: DirIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/**
 * Open flags for a no-follow directory descriptor. Null when the host
 * cannot express the required primitive.
 */
function dirOpenFlags(): number | null {
  const c = fsConstants as Record<string, number | undefined>;
  if (typeof c.O_DIRECTORY !== "number" || typeof c.O_NOFOLLOW !== "number") {
    return null;
  }
  return fsConstants.O_RDONLY | c.O_DIRECTORY | c.O_NOFOLLOW;
}

function fileOpenFlags(): number | null {
  const c = fsConstants as Record<string, number | undefined>;
  if (typeof c.O_NOFOLLOW !== "number") return null;
  return fsConstants.O_RDONLY | c.O_NOFOLLOW;
}

let anchorSupportCache: boolean | undefined;

/**
 * Test-only override for directory-anchor capability.
 * `undefined` uses the real probe. Production never installs an override.
 * When forced false, the live scanner must refuse with
 * `unsupported_traversal` and must not fall back to pathname traversal.
 */
let anchorCapabilityOverride: boolean | undefined;

/**
 * Install or clear the test-only directory-anchor capability override.
 * Pass `false` to exercise fail-closed `unsupported_traversal` on every
 * host, including Linux. Pass `undefined` to restore the real probe.
 * Never force `true` to emulate anchors on an unsupported platform.
 */
export function setSecretScanDirectoryAnchorCapabilityForTests(
  supported: boolean | undefined,
): void {
  anchorCapabilityOverride = supported;
}

/**
 * True when this process can open no-follow directory descriptors and
 * address them through a verified `/proc/self/fd/<fd>` anchor.
 * Respects the test-only override when installed; production callers
 * always observe the real capability probe.
 */
export function secretScanDirectoryAnchorSupported(): boolean {
  if (anchorCapabilityOverride !== undefined) {
    return anchorCapabilityOverride;
  }
  if (anchorSupportCache !== undefined) return anchorSupportCache;
  if (process.platform === "win32") {
    anchorSupportCache = false;
    return false;
  }
  if (dirOpenFlags() === null || fileOpenFlags() === null) {
    anchorSupportCache = false;
    return false;
  }
  try {
    const st = lstatSync("/proc/self/fd");
    anchorSupportCache = st.isDirectory();
  } catch {
    anchorSupportCache = false;
  }
  return anchorSupportCache;
}

/**
 * Return a pathname that names the open directory descriptor without
 * re-walking an untrusted parent. Null when the anchor is unavailable.
 */
function procFdPath(fd: number): string | null {
  if (!secretScanDirectoryAnchorSupported()) return null;
  if (!Number.isInteger(fd) || fd < 0) return null;
  return `/proc/self/fd/${fd}`;
}

/**
 * Observe a path with lstat (no follow).
 */
function observeComponent(
  path: string,
): "missing" | "directory" | "file" | "symlink" | "other" {
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch (e) {
    if (isNotFound(e)) return "missing";
    return "other";
  }
  if (st.isSymbolicLink()) return "symlink";
  if (st.isDirectory()) return "directory";
  if (st.isFile()) return "file";
  return "other";
}

function recheckBoundDir(dir: BoundDir): boolean {
  try {
    const st = fstatSync(dir.fd);
    return st.isDirectory() && identitiesEqual(identityOf(st), dir.identity);
  } catch {
    return false;
  }
}

type OpenDirResult =
  | { readonly _tag: "ok"; readonly dir: BoundDir }
  | { readonly _tag: "missing" }
  | { readonly _tag: "bad" };

/**
 * Open a directory by pathname with O_DIRECTORY|O_NOFOLLOW. Does not
 * follow a symlink at the final component. Captures dev/ino from the
 * opened descriptor.
 */
function openBoundDirAtPath(path: string): OpenDirResult {
  const flags = dirOpenFlags();
  if (flags === null || !secretScanDirectoryAnchorSupported()) {
    return { _tag: "bad" };
  }
  const kind = observeComponent(path);
  if (kind === "missing") return { _tag: "missing" };
  if (kind !== "directory") return { _tag: "bad" };
  let fd: number | undefined;
  try {
    fd = openSync(path, flags);
    const st = fstatSync(fd);
    if (!st.isDirectory()) {
      closeQuiet(fd);
      return { _tag: "bad" };
    }
    const anchor = procFdPath(fd);
    if (anchor === null) {
      closeQuiet(fd);
      return { _tag: "bad" };
    }
    // Capability probe: open a directory stream and read at most one entry.
    // Do not materialize an unbounded listing of the root.
    let probe: Dir | undefined;
    try {
      probe = opendirSync(anchor);
      probe.readSync();
    } catch {
      closeQuiet(fd);
      return { _tag: "bad" };
    } finally {
      try {
        probe?.closeSync();
      } catch {
        /* ignore */
      }
    }
    const dir: BoundDir = { fd, identity: identityOf(st) };
    fd = undefined;
    return { _tag: "ok", dir };
  } catch {
    closeQuiet(fd);
    return { _tag: "bad" };
  }
}

/**
 * Open a single-segment child directory under an already-bound parent,
 * addressed only through the parent's fd anchor.
 */
function openBoundChildDir(parent: BoundDir, name: string): OpenDirResult {
  const flags = dirOpenFlags();
  if (flags === null || !isSafeDirentName(name)) return { _tag: "bad" };
  if (!recheckBoundDir(parent)) return { _tag: "bad" };
  const parentAnchor = procFdPath(parent.fd);
  if (parentAnchor === null) return { _tag: "bad" };
  const childPath = join(parentAnchor, name);
  const kind = observeComponent(childPath);
  if (kind === "missing") return { _tag: "missing" };
  if (kind !== "directory") return { _tag: "bad" };
  let fd: number | undefined;
  try {
    fd = openSync(childPath, flags);
    const st = fstatSync(fd);
    if (!st.isDirectory()) {
      closeQuiet(fd);
      return { _tag: "bad" };
    }
    if (!recheckBoundDir(parent)) {
      closeQuiet(fd);
      return { _tag: "bad" };
    }
    const dir: BoundDir = { fd, identity: identityOf(st) };
    fd = undefined;
    return { _tag: "ok", dir };
  } catch {
    closeQuiet(fd);
    return { _tag: "bad" };
  }
}

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export class SecretScan extends Context.Tag("SecretScan")<
  SecretScan,
  {
    readonly scan: (
      input: SecretScanInput,
    ) => Effect.Effect<SecretScanResult>;
  }
>() {}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function isSecretScanResult(v: unknown): v is SecretScanResult {
  if (typeof v !== "object" || v === null) return false;
  const tag = (v as { _tag?: unknown })._tag;
  if (tag === "Clean" || tag === "SecretFound") return true;
  if (tag === "Refused") {
    const reason = (v as { reason?: unknown }).reason;
    return (
      reason === "invalid_worktree" ||
      reason === "unreadable" ||
      reason === "identity_changed" ||
      reason === "unsupported_traversal" ||
      reason === "malformed_fixture_declaration" ||
      reason === "bound_exceeded"
    );
  }
  return false;
}

export function sha256HexOfBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function renderSecretScanJson(result: SecretScanResult): string {
  if (result._tag === "Clean") {
    return canonicalize({
      schemaVersion: SECRET_SCAN_SCHEMA_VERSION,
      verdict: "clean",
    });
  }
  if (result._tag === "SecretFound") {
    return canonicalize({
      schemaVersion: SECRET_SCAN_SCHEMA_VERSION,
      verdict: "secret_found",
    });
  }
  return canonicalize({
    schemaVersion: SECRET_SCAN_SCHEMA_VERSION,
    verdict: "refused",
    reason: result.reason,
  });
}

/**
 * True when the basename matches a refused secret filename class.
 * Matches the shell find -name net (case-sensitive).
 */
export function isRefusedSecretFilename(basename: string): boolean {
  if (basename === ".env") return true;
  if (basename.startsWith(".env.") && basename !== ".env.example") return true;
  if (PRIVATE_KEY_BASENAMES.has(basename)) return true;
  const dot = basename.lastIndexOf(".");
  if (dot >= 0) {
    const ext = basename.slice(dot);
    if (PRIVATE_KEY_EXTENSIONS.has(ext)) return true;
  }
  return false;
}

export function isPemPrivateKeyLine(line: string): boolean {
  return PEM_LINE_RE.test(line);
}

function isValidAbsoluteRoot(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("\0")) return false;
  return isAbsolute(path);
}

function normalizeRootInput(worktree: string): string {
  let n = resolve(worktree);
  if (n.length > 1 && (n.endsWith("/") || n.endsWith("\\"))) {
    n = n.slice(0, -1);
  }
  return n;
}

function isSafeDirentName(name: string): boolean {
  if (name.length === 0) return false;
  if (name === "." || name === "..") return false;
  if (name.includes("\0")) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return true;
}

function isUnderFixtureSubtree(posixRel: string): boolean {
  return (
    posixRel === FIXTURE_SUBTREE_PREFIX.slice(0, -1) ||
    posixRel.startsWith(FIXTURE_SUBTREE_PREFIX)
  );
}

function isSha256HexLower(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

function isSafeExemptionPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("\0") || path.includes("\\")) return false;
  if (path.startsWith("/") || path.startsWith("./")) return false;
  if (path.includes("//") || path.includes("..")) return false;
  if (!path.startsWith(FIXTURE_SUBTREE_PREFIX)) return false;
  if (path.endsWith("/")) return false;
  return true;
}

function isNotFound(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "ENOENT"
  );
}

/**
 * True when `n` is a positive finite safe integer suitable as a bound.
 */
function isPositiveSafeIntegerBound(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0;
}

/**
 * Validate every caller-supplied bound before any filesystem access.
 * Invalid bounds refuse closed as `bound_exceeded`.
 */
export function validateSecretScanBounds(bounds: SecretScanBounds): boolean {
  return (
    isPositiveSafeIntegerBound(bounds.maxDirectoryEntries) &&
    isPositiveSafeIntegerBound(bounds.maxFiles) &&
    isPositiveSafeIntegerBound(bounds.maxRelativePathBytes) &&
    isPositiveSafeIntegerBound(bounds.maxFileBytes) &&
    isPositiveSafeIntegerBound(bounds.maxTotalInspectedBytes) &&
    isPositiveSafeIntegerBound(bounds.maxLineInspections) &&
    isPositiveSafeIntegerBound(bounds.maxExemptions) &&
    isPositiveSafeIntegerBound(bounds.maxFixtureDeclarationBytes)
  );
}

function closeDirQuiet(dir: Dir | undefined): void {
  if (dir === undefined) return;
  try {
    dir.closeSync();
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Bounded regular-file read through a held parent directory descriptor
// ---------------------------------------------------------------------------

type FileRead =
  | { readonly _tag: "Ok"; readonly bytes: Buffer }
  | { readonly _tag: "Oversized" }
  | { readonly _tag: "Unreadable" }
  | { readonly _tag: "IdentityChanged" }
  | { readonly _tag: "Symlink" }
  | { readonly _tag: "NotFile" };

/**
 * Read a single-segment regular file under a bound parent directory.
 * Opens only through the parent's `/proc/self/fd` anchor with O_NOFOLLOW.
 */
function readRegularFileUnder(
  parent: BoundDir,
  name: string,
  maxBytes: number,
): FileRead {
  if (!isSafeDirentName(name)) return { _tag: "Unreadable" };
  const flags = fileOpenFlags();
  if (flags === null) return { _tag: "Unreadable" };
  if (!recheckBoundDir(parent)) return { _tag: "IdentityChanged" };
  const parentAnchor = procFdPath(parent.fd);
  if (parentAnchor === null) return { _tag: "Unreadable" };
  const childPath = join(parentAnchor, name);

  let before: Stats;
  try {
    before = lstatSync(childPath);
  } catch {
    return { _tag: "Unreadable" };
  }
  if (before.isSymbolicLink()) return { _tag: "Symlink" };
  if (!before.isFile()) return { _tag: "NotFile" };
  if (before.size > maxBytes) return { _tag: "Oversized" };

  let fd: number | undefined;
  try {
    fd = openSync(childPath, flags);
    const opened = fstatSync(fd);
    if (
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      opened.size !== before.size ||
      !opened.isFile()
    ) {
      return { _tag: "IdentityChanged" };
    }
    if (!recheckBoundDir(parent)) {
      return { _tag: "IdentityChanged" };
    }
    if (opened.size > maxBytes) {
      return { _tag: "Oversized" };
    }
    const cap = maxBytes + 1;
    const buf = Buffer.allocUnsafe(Math.min(cap, opened.size + 1));
    let offset = 0;
    while (offset < buf.byteLength) {
      const n = readSync(fd, buf, offset, buf.byteLength - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    if (offset > maxBytes) {
      return { _tag: "Oversized" };
    }
    let after: Stats;
    try {
      after = fstatSync(fd);
    } catch {
      return { _tag: "IdentityChanged" };
    }
    if (
      after.ino !== opened.ino ||
      after.dev !== opened.dev ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs
    ) {
      return { _tag: "IdentityChanged" };
    }
    return { _tag: "Ok", bytes: buf.subarray(0, offset) };
  } catch {
    return { _tag: "Unreadable" };
  } finally {
    closeQuiet(fd);
  }
}

// ---------------------------------------------------------------------------
// Fixture declaration (through bound root descriptor chain)
// ---------------------------------------------------------------------------

type FixtureLoad =
  | { readonly _tag: "Ok"; readonly map: ExemptionMap }
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Malformed" }
  | { readonly _tag: "Unreadable" }
  | { readonly _tag: "Bound" }
  | { readonly _tag: "IdentityChanged" };

function loadFixtureDeclaration(
  rootDir: BoundDir,
  bounds: SecretScanBounds,
): FixtureLoad {
  const segments = FIXTURE_DECLARATION_RELPATH.split("/");
  if (segments.length < 2) return { _tag: "Malformed" };

  const opened: BoundDir[] = [];
  try {
    let current = rootDir;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      if (!recheckBoundDir(current)) return { _tag: "IdentityChanged" };
      const child = openBoundChildDir(current, seg);
      if (child._tag === "missing") return { _tag: "Absent" };
      if (child._tag !== "ok") return { _tag: "Unreadable" };
      opened.push(child.dir);
      current = child.dir;
    }

    const fileName = segments[segments.length - 1]!;
    if (!recheckBoundDir(current)) return { _tag: "IdentityChanged" };
    const parentAnchor = procFdPath(current.fd);
    if (parentAnchor === null) return { _tag: "Unreadable" };
    const declKind = observeComponent(join(parentAnchor, fileName));
    if (declKind === "missing") return { _tag: "Absent" };
    if (declKind === "symlink" || declKind === "directory" || declKind === "other") {
      return { _tag: "Malformed" };
    }
    const read = readRegularFileUnder(
      current,
      fileName,
      bounds.maxFixtureDeclarationBytes,
    );
    if (read._tag === "Symlink" || read._tag === "NotFile") {
      return { _tag: "Malformed" };
    }
    if (read._tag === "Oversized") return { _tag: "Bound" };
    if (read._tag === "IdentityChanged") return { _tag: "IdentityChanged" };
    if (read._tag === "Unreadable") return { _tag: "Unreadable" };

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes);
    } catch {
      return { _tag: "Malformed" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { _tag: "Malformed" };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { _tag: "Malformed" };
    }
    const obj = parsed as Record<string, unknown>;
    const keySet = new Set(Object.keys(obj));
    if (
      keySet.size !== 2 ||
      !keySet.has("schemaVersion") ||
      !keySet.has("exemptions")
    ) {
      return { _tag: "Malformed" };
    }
    if (obj["schemaVersion"] !== 1) return { _tag: "Malformed" };
    const ex = obj["exemptions"];
    if (!Array.isArray(ex)) return { _tag: "Malformed" };
    if (ex.length > bounds.maxExemptions) return { _tag: "Bound" };

    const map = new Map<string, string>();
    for (const item of ex) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return { _tag: "Malformed" };
      }
      const rec = item as Record<string, unknown>;
      const rkeys = new Set(Object.keys(rec));
      if (rkeys.size !== 2 || !rkeys.has("path") || !rkeys.has("sha256")) {
        return { _tag: "Malformed" };
      }
      const path = rec["path"];
      const sha = rec["sha256"];
      if (typeof path !== "string" || typeof sha !== "string") {
        return { _tag: "Malformed" };
      }
      if (!isSafeExemptionPath(path) || !isSha256HexLower(sha)) {
        return { _tag: "Malformed" };
      }
      if (map.has(path)) return { _tag: "Malformed" };
      map.set(path, sha);
    }
    return { _tag: "Ok", map };
  } finally {
    for (let i = opened.length - 1; i >= 0; i--) {
      closeQuiet(opened[i]!.fd);
    }
  }
}

// ---------------------------------------------------------------------------
// Scan implementation
// ---------------------------------------------------------------------------

function refuse(reason: SecretScanRefusalReason): SecretScanResult {
  return { _tag: "Refused", reason };
}

function scanPemLines(
  bytes: Buffer,
  counters: Counters,
  bounds: SecretScanBounds,
): SecretScanResult | null {
  // Decode as latin1 so binary content cannot throw; PEM banners are ASCII.
  const text = bytes.toString("latin1");
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const raw = text.slice(start, end);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    counters.lineInspections += 1;
    if (counters.lineInspections > bounds.maxLineInspections) {
      return refuse("bound_exceeded");
    }
    if (isPemPrivateKeyLine(line)) {
      return { _tag: "SecretFound" };
    }
    if (end === text.length) break;
    start = end + 1;
  }
  return null;
}

function tryExempt(
  posixRel: string,
  bytes: Buffer,
  exemptions: ExemptionMap,
): boolean {
  if (!isUnderFixtureSubtree(posixRel)) return false;
  const expected = exemptions.get(posixRel);
  if (expected === undefined) return false;
  return sha256HexOfBytes(bytes) === expected;
}

type Frame = {
  readonly dir: BoundDir;
  readonly posixRel: string;
};

/**
 * Scan one bound directory. Directory listing is incremental and stops at
 * maxDirectoryEntries + 1. Child directories are opened one at a time and
 * fully processed before the next sibling is opened, so only the active
 * depth chain holds descriptors.
 *
 * The caller owns `frame.dir` and must close it. This function closes every
 * child descriptor it opens, including on early return.
 */
function processDirectory(
  frame: Frame,
  exemptions: ExemptionMap,
  counters: Counters,
  bounds: SecretScanBounds,
): SecretScanResult {
  if (frame.posixRel !== "") {
    fireAfterBindDirectory(frame.posixRel);
  }
  if (!recheckBoundDir(frame.dir)) {
    return refuse("identity_changed");
  }
  const anchor = procFdPath(frame.dir.fd);
  if (anchor === null) {
    return refuse("unsupported_traversal");
  }

  let listing: Dir | undefined;
  try {
    listing = opendirSync(anchor);
  } catch {
    return refuse("unreadable");
  }

  try {
    for (;;) {
      let ent: { name: string } | null;
      try {
        ent = listing.readSync();
      } catch {
        return refuse("unreadable");
      }
      if (ent === null) break;

      const name = ent.name;
      if (name === "." || name === "..") continue;

      counters.directoryEntries += 1;
      if (counters.directoryEntries > bounds.maxDirectoryEntries) {
        return refuse("bound_exceeded");
      }

      if (!isSafeDirentName(name)) {
        return refuse("unsupported_traversal");
      }

      const childRel =
        frame.posixRel === "" ? name : `${frame.posixRel}/${name}`;

      // Path bounds apply to every encountered entry before prune and before
      // type dispatch, including directories, symbolic links, and top-level
      // prune names (.git / .harness).
      if (childRel.length === 0 || childRel === ".") {
        return refuse("unsupported_traversal");
      }
      if (
        childRel.startsWith("..") ||
        childRel.includes("/../") ||
        childRel.includes("\\")
      ) {
        return refuse("unsupported_traversal");
      }
      const pathBytes = utf8ByteLength(childRel);
      if (pathBytes > bounds.maxRelativePathBytes) {
        return refuse("bound_exceeded");
      }

      // Top-level prune of .git and .harness only (shell parity). After path
      // bound so prune names cannot bypass maxRelativePathBytes.
      if (frame.posixRel === "" && PRUNE_TOP_LEVEL.has(name)) {
        continue;
      }

      if (!recheckBoundDir(frame.dir)) {
        return refuse("identity_changed");
      }
      const childPath = join(anchor, name);
      const kind = observeComponent(childPath);
      if (kind === "missing") {
        return refuse("unreadable");
      }
      if (kind === "symlink") {
        // Never follow. Path bound already applied. Skip without secret.
        continue;
      }
      if (kind === "other") {
        return refuse("unsupported_traversal");
      }

      if (kind === "directory") {
        const childOpen = openBoundChildDir(frame.dir, name);
        if (childOpen._tag === "missing") {
          return refuse("unreadable");
        }
        if (childOpen._tag !== "ok") {
          // Symlink/type race after observe → fail closed.
          return refuse("identity_changed");
        }
        // One child at a time: process fully, then close before next sibling.
        try {
          const childResult = processDirectory(
            { dir: childOpen.dir, posixRel: childRel },
            exemptions,
            counters,
            bounds,
          );
          if (childResult._tag !== "Clean") {
            return childResult;
          }
        } finally {
          closeQuiet(childOpen.dir.fd);
        }
        continue;
      }

      // Regular file
      counters.files += 1;
      if (counters.files > bounds.maxFiles) {
        return refuse("bound_exceeded");
      }

      const filenameRefused = isRefusedSecretFilename(name);

      // Race seam: entry was observed as regular; a concurrent rename may
      // replace it with a symlink before the no-follow open.
      fireAfterObserveRegularFile(childRel);

      const read = readRegularFileUnder(
        frame.dir,
        name,
        bounds.maxFileBytes,
      );
      if (read._tag === "Symlink") {
        // Observed regular, then became symlink: identity changed. Do not
        // follow. (An entry that is a symlink at initial observation is
        // skipped above and never reaches this branch.)
        return refuse("identity_changed");
      }
      if (read._tag === "NotFile") {
        return refuse("unsupported_traversal");
      }
      if (read._tag === "Oversized") return refuse("bound_exceeded");
      if (read._tag === "IdentityChanged") {
        return refuse("identity_changed");
      }
      if (read._tag === "Unreadable") return refuse("unreadable");

      const bytes = read.bytes;
      counters.totalInspectedBytes += bytes.byteLength;
      if (counters.totalInspectedBytes > bounds.maxTotalInspectedBytes) {
        return refuse("bound_exceeded");
      }

      if (filenameRefused) {
        if (tryExempt(childRel, bytes, exemptions)) {
          continue;
        }
        return { _tag: "SecretFound" };
      }

      const pemHit = scanPemLines(bytes, counters, bounds);
      if (pemHit !== null) {
        if (pemHit._tag === "SecretFound") {
          if (tryExempt(childRel, bytes, exemptions)) {
            continue;
          }
          return { _tag: "SecretFound" };
        }
        return pemHit;
      }
    }

    return { _tag: "Clean" };
  } finally {
    closeDirQuiet(listing);
  }
}

/**
 * Core scanner. Fail-closed; never throws domain errors with path content.
 * Traversal is descriptor-anchored; pathnames are not reopened after bind.
 * Directory listings are incremental; only the active depth chain is held.
 */
export function scanWorktreeSync(input: SecretScanInput): SecretScanResult {
  const bounds = input.bounds ?? DEFAULT_SECRET_SCAN_BOUNDS;
  // Validate every bound before any filesystem access.
  if (!validateSecretScanBounds(bounds)) {
    return refuse("bound_exceeded");
  }
  if (!isValidAbsoluteRoot(input.worktreeRoot)) {
    return refuse("invalid_worktree");
  }
  const root = normalizeRootInput(input.worktreeRoot);
  if (!isValidAbsoluteRoot(root)) {
    return refuse("invalid_worktree");
  }

  if (!secretScanDirectoryAnchorSupported()) {
    return refuse("unsupported_traversal");
  }

  const rootOpen = openBoundDirAtPath(root);
  if (rootOpen._tag === "missing") return refuse("invalid_worktree");
  if (rootOpen._tag !== "ok") return refuse("invalid_worktree");

  try {
    fireAfterBindRoot();
    if (!recheckBoundDir(rootOpen.dir)) {
      return refuse("identity_changed");
    }

    const fixtures = loadFixtureDeclaration(rootOpen.dir, bounds);
    if (fixtures._tag === "Malformed") {
      return refuse("malformed_fixture_declaration");
    }
    if (fixtures._tag === "Unreadable") {
      return refuse("unreadable");
    }
    if (fixtures._tag === "Bound") {
      return refuse("bound_exceeded");
    }
    if (fixtures._tag === "IdentityChanged") {
      return refuse("identity_changed");
    }
    const exemptions: ExemptionMap =
      fixtures._tag === "Ok" ? fixtures.map : new Map();

    const counters: Counters = {
      directoryEntries: 0,
      files: 0,
      totalInspectedBytes: 0,
      lineInspections: 0,
    };

    return processDirectory(
      { dir: rootOpen.dir, posixRel: "" },
      exemptions,
      counters,
      bounds,
    );
  } finally {
    closeQuiet(rootOpen.dir.fd);
  }
}

/**
 * Effect-returning API used by the service and CLI.
 */
export function scanWorktree(
  input: SecretScanInput,
): Effect.Effect<SecretScanResult, never, SecretScan> {
  return Effect.gen(function* () {
    const svc = yield* SecretScan;
    return yield* svc.scan(input);
  });
}

export const liveSecretScan: Layer.Layer<SecretScan> = Layer.succeed(
  SecretScan,
  {
    scan: (input) => Effect.sync(() => scanWorktreeSync(input)),
  },
);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function stripSecretScanNodeArgv(
  argv: readonly string[],
): readonly string[] {
  let args = [...argv];
  if (
    args.length > 0 &&
    (args[0]!.endsWith("node") ||
      args[0]!.endsWith("node.exe") ||
      args[0]!.includes("/node") ||
      args[0]!.includes("\\node"))
  ) {
    args = args.slice(1);
  }
  if (
    args.length > 0 &&
    (args[0]!.endsWith(".js") ||
      args[0]!.endsWith(".ts") ||
      args[0]!.includes("secret-scan"))
  ) {
    args = args.slice(1);
  }
  return args;
}

export function parseSecretScanArgv(
  argv: readonly string[],
): ParsedSecretScanArgv {
  const args = stripSecretScanNodeArgv(argv);
  if (args.length !== 1) return { _tag: "Invalid" };
  const worktreeRoot = args[0]!;
  if (typeof worktreeRoot !== "string" || worktreeRoot.length === 0) {
    return { _tag: "Invalid" };
  }
  if (worktreeRoot.includes("\0")) return { _tag: "Invalid" };
  return { _tag: "Ok", worktreeRoot };
}

/**
 * Run the secret-scan CLI. Emits exactly one canonical JSON line on stdout
 * for every outcome, including invalid argv and fail-closed results.
 * Exit 0 only for Clean; nonzero for SecretFound, Refused, or bad argv.
 * Never emits paths, stacks, exception text, or environment content.
 */
export function runSecretScanCli(
  argv: readonly string[],
  io: SecretScanCliIo,
): Effect.Effect<number, never, SecretScan> {
  return Effect.gen(function* () {
    const parsed = parseSecretScanArgv(argv);
    if (parsed._tag === "Invalid") {
      io.writeStdout(
        renderSecretScanJson({
          _tag: "Refused",
          reason: "invalid_worktree",
        }) + "\n",
      );
      return EXIT_INVALID_ARGUMENTS;
    }
    const result = yield* scanWorktree({
      worktreeRoot: parsed.worktreeRoot,
    });
    io.writeStdout(renderSecretScanJson(result) + "\n");
    if (result._tag === "Clean") return EXIT_CLEAN;
    return EXIT_NOT_CLEAN;
  });
}

// ---------------------------------------------------------------------------
// Stream write helper (used by secret-scan-main and unit-tested here)
// ---------------------------------------------------------------------------

/**
 * Minimal stream surface for writeFully (Node WriteStream or test double).
 */
export type SecretScanWriteStream = {
  write(chunk: string, cb?: (err?: Error | null) => void): boolean;
  once(event: "error", listener: (err: Error) => void): unknown;
  off(event: "error", listener: (err: Error) => void): unknown;
};

/**
 * Write all of `text` to `stream`, settling once from the write callback.
 *
 * After a successful callback, remove the one-time `error` listener.
 * After a callback error, keep the listener armed so a subsequent stream
 * `error` event is consumed and cannot become an uncaught exception (Node
 * may deliver the callback error before the matching `error` event).
 */
export function writeFully(
  stream: SecretScanWriteStream,
  text: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const onError = (err: Error) => {
      stream.off("error", onError);
      settleReject(err);
    };
    stream.once("error", onError);
    stream.write(text, (err) => {
      if (err) {
        // Keep onError until the stream emits `error` (or the process ends).
        settleReject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      stream.off("error", onError);
      if (!settled) {
        settled = true;
        resolvePromise();
      }
    });
  });
}
