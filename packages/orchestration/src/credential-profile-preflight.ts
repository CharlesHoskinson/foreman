/**
 * Profile-bound vendor preflight record (Sprint 3 R7B1).
 *
 * Stores a closed wrapper under the credential-profile authority:
 *   <state-root>/credential-profiles/<profile-id>/preflight/<vendor>.json
 *
 * Never reads, inspects, prints, or modifies vendor credential files.
 * Never authenticates. Live lane admission and leasing stay out of this package.
 */

import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { Context, Effect, Layer } from "effect";
import {
  canonicalize,
  isCoreFailure,
  parseJsonRejectDuplicateKeys,
  rejectUnknownKeys,
} from "@foreman/core";
import {
  isIgnorableParentDirSyncError,
  isValidProfileId,
  MAX_CREDENTIAL_PROFILE_RECORD_BYTES,
  parseCredentialProfileRecordBytes,
  profileAuthorityDir,
  profileIdentityOf,
  PROFILE_JSON_NAME,
  type CredentialVendor,
} from "./credential-profile.js";
import {
  decodeVendorPreflightRecordV1,
  isVendorPreflightContractFailure,
  type VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";

/** Windows keeps best-effort modes; POSIX requires and verifies them. */
const IS_POSIX = process.platform !== "win32";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CREDENTIAL_PROFILE_PREFLIGHT_SCHEMA_VERSION = 1 as const;

/** UTF-8 byte bound for the whole wrapper file body (including trailing LF). */
export const MAX_CREDENTIAL_PROFILE_PREFLIGHT_BYTES = 1_048_576;

export const PROFILE_PREFLIGHT_DIR_NAME = "preflight";

export const DEFAULT_GROK_CREDENTIAL_PROFILE_ID = "grok-default";
export const DEFAULT_CODEX_CREDENTIAL_PROFILE_ID = "codex-default";

export const DEFAULT_CREDENTIAL_PROFILE_ID_BY_VENDOR: Readonly<
  Record<CredentialVendor, string>
> = {
  grok: DEFAULT_GROK_CREDENTIAL_PROFILE_ID,
  codex: DEFAULT_CODEX_CREDENTIAL_PROFILE_ID,
};

export const PROFILE_PREFLIGHT_DECODE_FAILURE_REASONS = [
  "invalid_schema",
  "unknown_key",
  "duplicate_key",
  "malformed_utf8",
  "oversized",
  "invalid_profile_id",
  "unsupported_vendor",
  "profile_mismatch",
  "profile_identity_mismatch",
  "vendor_mismatch",
  "invalid_nested_record",
] as const;

export type ProfilePreflightDecodeFailureReason =
  (typeof PROFILE_PREFLIGHT_DECODE_FAILURE_REASONS)[number];

export type ProfilePreflightDecodeFailure = {
  readonly _tag: "ProfilePreflightDecodeFailure";
  readonly reason: ProfilePreflightDecodeFailureReason;
};

export const PROFILE_PREFLIGHT_STORE_FAILURE_REASONS = [
  "path_invalid",
  "absent",
  "oversized",
  "unreadable",
  "linked_path",
  "malformed",
  "decode_failed",
  "identity_changed",
  "write_failed",
] as const;

export type ProfilePreflightStoreFailureReason =
  (typeof PROFILE_PREFLIGHT_STORE_FAILURE_REASONS)[number];

export class ProfilePreflightStoreFailure {
  readonly _tag = "ProfilePreflightStoreFailure" as const;
  constructor(readonly reason: ProfilePreflightStoreFailureReason) {}
}

// ---------------------------------------------------------------------------
// Closed type
// ---------------------------------------------------------------------------

export type CredentialProfilePreflightV1 = {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly profileIdentity: string;
  readonly vendor: CredentialVendor;
  readonly record: VendorPreflightRecordV1;
};

export type CredentialProfilePreflightExpected = {
  readonly profileId?: string;
  readonly profileIdentity?: string;
  readonly vendor?: CredentialVendor;
};

const WRAPPER_KEYS = [
  "schemaVersion",
  "profileId",
  "profileIdentity",
  "vendor",
  "record",
] as const;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function defaultCredentialProfileId(
  vendor: CredentialVendor,
): string {
  return DEFAULT_CREDENTIAL_PROFILE_ID_BY_VENDOR[vendor];
}

/**
 * Absolute path for a profile-scoped preflight record.
 * Layout: <state-root>/credential-profiles/<profile-id>/preflight/<vendor>.json
 */
export function profilePreflightRecordPath(
  stateRoot: string,
  profileId: string,
  vendor: CredentialVendor,
): string {
  return join(
    profileAuthorityDir(stateRoot, profileId),
    PROFILE_PREFLIGHT_DIR_NAME,
    `${vendor}.json`,
  );
}

/**
 * Copy `processEnv` into a fresh object, set the matching vendor home to
 * `configRoot`, and remove the other vendor-home variable. Does not mutate
 * the caller's environment object.
 *
 * On Windows, every case variant of `GROK_HOME` and `CODEX_HOME` is removed
 * before the canonical matching key is set (Windows env keys are
 * case-insensitive). POSIX stays case-sensitive: only the exact keys are
 * stripped and set.
 */
export function buildVendorHomeChildEnv(
  processEnv: NodeJS.ProcessEnv,
  vendor: CredentialVendor,
  configRoot: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = { ...processEnv };
  if (platform === "win32") {
    for (const key of Object.keys(child)) {
      const upper = key.toUpperCase();
      if (upper === "GROK_HOME" || upper === "CODEX_HOME") {
        delete child[key];
      }
    }
    if (vendor === "grok") {
      child.GROK_HOME = configRoot;
    } else {
      child.CODEX_HOME = configRoot;
    }
    return child;
  }
  // POSIX: case-sensitive — only exact keys.
  if (vendor === "grok") {
    child.GROK_HOME = configRoot;
    delete child.CODEX_HOME;
  } else {
    child.CODEX_HOME = configRoot;
    delete child.GROK_HOME;
  }
  return child;
}

// ---------------------------------------------------------------------------
// Pure decode / render
// ---------------------------------------------------------------------------

function decodeFail(
  reason: ProfilePreflightDecodeFailureReason,
): ProfilePreflightDecodeFailure {
  return { _tag: "ProfilePreflightDecodeFailure", reason };
}

export function isProfilePreflightDecodeFailure(
  v: unknown,
): v is ProfilePreflightDecodeFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { _tag?: unknown })._tag === "ProfilePreflightDecodeFailure" &&
    typeof (v as { reason?: unknown }).reason === "string" &&
    (PROFILE_PREFLIGHT_DECODE_FAILURE_REASONS as readonly string[]).includes(
      (v as { reason: string }).reason,
    )
  );
}

function isProfileIdentityHex(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

function isCredentialVendorLocal(v: unknown): v is CredentialVendor {
  return v === "grok" || v === "codex";
}

/**
 * Decode a closed v1 wrapper. Rejects unknown keys and wrong shapes.
 * Does not parse JSON text (caller must use parseJsonRejectDuplicateKeys).
 */
export function decodeCredentialProfilePreflightV1(
  value: unknown,
  expected?: CredentialProfilePreflightExpected,
): CredentialProfilePreflightV1 | ProfilePreflightDecodeFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return decodeFail("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  const unknown = rejectUnknownKeys(obj, WRAPPER_KEYS as unknown as string[]);
  if (unknown !== null) {
    return decodeFail("unknown_key");
  }
  if (obj["schemaVersion"] !== 1) {
    return decodeFail("invalid_schema");
  }

  const profileId = obj["profileId"];
  if (typeof profileId !== "string" || !isValidProfileId(profileId)) {
    return decodeFail("invalid_profile_id");
  }
  if (
    expected?.profileId !== undefined &&
    expected.profileId !== profileId
  ) {
    return decodeFail("profile_mismatch");
  }

  const profileIdentity = obj["profileIdentity"];
  if (
    typeof profileIdentity !== "string" ||
    !isProfileIdentityHex(profileIdentity)
  ) {
    return decodeFail("invalid_schema");
  }
  if (
    expected?.profileIdentity !== undefined &&
    expected.profileIdentity !== profileIdentity
  ) {
    return decodeFail("profile_identity_mismatch");
  }

  const vendor = obj["vendor"];
  if (!isCredentialVendorLocal(vendor)) {
    return decodeFail("unsupported_vendor");
  }
  if (expected?.vendor !== undefined && expected.vendor !== vendor) {
    return decodeFail("vendor_mismatch");
  }

  const nested = decodeVendorPreflightRecordV1(obj["record"]);
  if (isVendorPreflightContractFailure(nested)) {
    return decodeFail("invalid_nested_record");
  }
  if (nested.vendor !== vendor) {
    return decodeFail("vendor_mismatch");
  }

  return {
    schemaVersion: 1,
    profileId,
    profileIdentity,
    vendor,
    record: nested,
  };
}

/**
 * Canonical wrapper JSON as UTF-8 text (no trailing newline). Key order is
 * sorted by `@foreman/core` canonicalize.
 */
export function renderCredentialProfilePreflight(
  wrapper: CredentialProfilePreflightV1,
): string {
  return canonicalize(wrapper as unknown);
}

/** File body: canonical JSON + single trailing LF. */
export function renderCredentialProfilePreflightFile(
  wrapper: CredentialProfilePreflightV1,
): string {
  return renderCredentialProfilePreflight(wrapper) + "\n";
}

/**
 * Parse raw UTF-8 file bytes into a wrapper. Enforces the byte bound, fatal
 * UTF-8, duplicate-key rejection, and closed decoding.
 */
export function parseCredentialProfilePreflightBytes(
  bytes: Uint8Array,
  expected?: CredentialProfilePreflightExpected,
):
  | { readonly _tag: "Ok"; readonly wrapper: CredentialProfilePreflightV1 }
  | {
      readonly _tag: "Fail";
      readonly reason: ProfilePreflightDecodeFailureReason;
    } {
  if (bytes.byteLength > MAX_CREDENTIAL_PROFILE_PREFLIGHT_BYTES) {
    return { _tag: "Fail", reason: "oversized" };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { _tag: "Fail", reason: "malformed_utf8" };
  }
  // Strip one optional trailing LF for parse (canonical file form).
  const body =
    text.endsWith("\n") && !text.endsWith("\r\n") ? text.slice(0, -1) : text;
  if (body.includes("\0")) {
    return { _tag: "Fail", reason: "invalid_schema" };
  }
  const parsed = parseJsonRejectDuplicateKeys(body);
  if (isCoreFailure(parsed)) {
    if (parsed._tag === "DuplicateJsonKey") {
      return { _tag: "Fail", reason: "duplicate_key" };
    }
    return { _tag: "Fail", reason: "invalid_schema" };
  }
  const decoded = decodeCredentialProfilePreflightV1(parsed, expected);
  if (isProfilePreflightDecodeFailure(decoded)) {
    return { _tag: "Fail", reason: decoded.reason };
  }
  return { _tag: "Ok", wrapper: decoded };
}

export function makeCredentialProfilePreflight(
  profileId: string,
  profileIdentity: string,
  vendor: CredentialVendor,
  record: VendorPreflightRecordV1,
): CredentialProfilePreflightV1 {
  return {
    schemaVersion: 1,
    profileId,
    profileIdentity,
    vendor,
    record,
  };
}

// ---------------------------------------------------------------------------
// Effect store service
// ---------------------------------------------------------------------------

export class CredentialProfilePreflightStore extends Context.Tag(
  "CredentialProfilePreflightStore",
)<
  CredentialProfilePreflightStore,
  {
    readonly read: (
      absolutePath: string,
      expected?: CredentialProfilePreflightExpected,
    ) => Effect.Effect<
      CredentialProfilePreflightV1,
      ProfilePreflightStoreFailure
    >;
    readonly write: (
      absolutePath: string,
      wrapper: CredentialProfilePreflightV1,
    ) => Effect.Effect<void, ProfilePreflightStoreFailure>;
  }
>() {}

function validateAbsolutePath(
  absolutePath: string,
): ProfilePreflightStoreFailure | null {
  if (typeof absolutePath !== "string" || absolutePath.length === 0) {
    return new ProfilePreflightStoreFailure("path_invalid");
  }
  if (absolutePath.includes("\0")) {
    return new ProfilePreflightStoreFailure("path_invalid");
  }
  if (!isAbsolute(absolutePath)) {
    return new ProfilePreflightStoreFailure("path_invalid");
  }
  return null;
}

function closeQuiet(fd: number | undefined): void {
  if (fd === undefined) return;
  try {
    closeSync(fd);
  } catch {
    /* ignore */
  }
}

function authorityOpenFlags(): number {
  const c = fsConstants as Record<string, number | undefined>;
  if (typeof c.O_NOFOLLOW === "number") {
    return fsConstants.O_RDONLY | c.O_NOFOLLOW;
  }
  return fsConstants.O_RDONLY;
}

function dirOpenFlags(): number | null {
  const c = fsConstants as Record<string, number | undefined>;
  if (typeof c.O_DIRECTORY !== "number" || typeof c.O_NOFOLLOW !== "number") {
    return null;
  }
  return fsConstants.O_RDONLY | c.O_DIRECTORY | c.O_NOFOLLOW;
}

let anchorSupportCache: boolean | undefined;

/**
 * True when this process can open no-follow directory descriptors and
 * address children through a verified `/proc/self/fd/<fd>` anchor.
 * Windows and hosts without those primitives cannot prove publication
 * boundaries — callers must fail closed before mutation.
 */
export function profilePreflightDirectoryAnchorSupported(): boolean {
  if (anchorSupportCache !== undefined) return anchorSupportCache;
  if (process.platform === "win32") {
    anchorSupportCache = false;
    return false;
  }
  if (dirOpenFlags() === null) {
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

function procFdPath(fd: number): string | null {
  if (!profilePreflightDirectoryAnchorSupported()) return null;
  if (!Number.isInteger(fd) || fd < 0) return null;
  return `/proc/self/fd/${fd}`;
}

type DirIdentity = { readonly dev: number; readonly ino: number };

type CapturedAuthorityDirs = {
  readonly components: readonly {
    readonly path: string;
    readonly identity: DirIdentity;
  }[];
  /** Absolute path of the R7A profile.json under the profile authority. */
  readonly profileJsonPath: string;
  readonly profileJsonIdentity: DirIdentity;
};

/**
 * Deterministic race seams (tests only). Production never installs a hook.
 */
export type ProfilePreflightRaceHook = {
  /**
   * After the profile authority directory is validated / bound; before
   * descriptor-anchored creation of the `preflight` child.
   */
  readonly beforeCreatePreflightDir?: () => void;
  /**
   * After preflight is observed missing through the held profile descriptor;
   * before the anchored mkdir. Tests use this to supply a concurrent
   * directory so mkdir returns EEXIST.
   */
  readonly beforeMkdirPreflightDir?: () => void;
  /** After authority components are captured; before parent-dir bind / open. */
  readonly afterCaptureAuthority?: () => void;
  /** After the preflight parent directory fd is bound; before temp create. */
  readonly afterBindParentDir?: () => void;
  /** After temp is fsynced and closed; before anchored rename publish. */
  readonly beforePublishRename?: () => void;
};

let raceHook: ProfilePreflightRaceHook | undefined;

/** Install or clear the profile-preflight race seam. Tests only. */
export function setProfilePreflightRaceHook(
  hook: ProfilePreflightRaceHook | undefined,
): void {
  raceHook = hook;
}

function identitiesEqual(
  a: { dev: number; ino: number },
  b: { dev: number; ino: number },
): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/**
 * Observe a path component without following links.
 */
function observeNoFollow(
  path: string,
): "missing" | "directory" | "symlink" | "file" | "other" {
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "missing";
    return "other";
  }
  if (st.isSymbolicLink()) return "symlink";
  if (st.isDirectory()) return "directory";
  if (st.isFile()) return "file";
  return "other";
}

/**
 * Authority directory chain for a preflight record file path:
 *   <state-root>/credential-profiles/<profile-id>/preflight/<vendor>.json
 * Returns [state-root, credential-profiles, profile-id, preflight]
 * outermost → innermost. State root is included so a root symlink or
 * identity swap fails closed before read, write, or success.
 */
function authorityDirChain(
  filePath: string,
): readonly [string, string, string, string] {
  const preflightDir = dirname(filePath);
  const profileDir = dirname(preflightDir);
  const profilesRoot = dirname(profileDir);
  const stateRoot = dirname(profilesRoot);
  return [stateRoot, profilesRoot, profileDir, preflightDir];
}

function captureDirIdentity(path: string): DirIdentity | null {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    return { dev: st.dev, ino: st.ino };
  } catch {
    return null;
  }
}

function captureFileIdentity(path: string): DirIdentity | null {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    return { dev: st.dev, ino: st.ino };
  } catch {
    return null;
  }
}

/**
 * Require a real non-linked directory at `path` and capture its identity.
 * Missing → `absent`; symlink → `linked_path`; other → `failReason`.
 */
function requireRealDir(
  path: string,
  failReason: ProfilePreflightStoreFailureReason,
): DirIdentity {
  const kind = observeNoFollow(path);
  if (kind === "missing") {
    throw new ProfilePreflightStoreFailure("absent");
  }
  if (kind === "symlink") {
    throw new ProfilePreflightStoreFailure("linked_path");
  }
  if (kind !== "directory") {
    throw new ProfilePreflightStoreFailure(failReason);
  }
  const id = captureDirIdentity(path);
  if (id === null) {
    throw new ProfilePreflightStoreFailure(failReason);
  }
  return id;
}

/**
 * Require R7A `profile.json` under the profile authority as a non-linked
 * regular file. The store never creates or rewrites this file.
 */
function requireProfileJson(
  profileDir: string,
  failReason: ProfilePreflightStoreFailureReason,
): { readonly path: string; readonly identity: DirIdentity } {
  const path = join(profileDir, PROFILE_JSON_NAME);
  const kind = observeNoFollow(path);
  if (kind === "missing") {
    throw new ProfilePreflightStoreFailure("absent");
  }
  if (kind === "symlink") {
    throw new ProfilePreflightStoreFailure("linked_path");
  }
  if (kind !== "file") {
    throw new ProfilePreflightStoreFailure(failReason);
  }
  const id = captureFileIdentity(path);
  if (id === null) {
    throw new ProfilePreflightStoreFailure(failReason);
  }
  return { path, identity: id };
}

/**
 * Read `profile.json` with bounded no-follow descriptor I/O and require that
 * the authority record still binds the wrapper:
 *   record.profileId === wrapper.profileId
 *   record.vendor === wrapper.vendor
 *   profileIdentityOf(record) === wrapper.profileIdentity
 *
 * Returns only closed store failure reasons (no paths, bytes, or exception text).
 */
function requireProfileBinding(
  profileJsonPath: string,
  expectedIdentity: DirIdentity,
  wrapper: CredentialProfilePreflightV1,
): void {
  let fd: number | undefined;
  try {
    let st: Stats;
    try {
      st = lstatSync(profileJsonPath);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new ProfilePreflightStoreFailure("absent");
      }
      throw new ProfilePreflightStoreFailure("write_failed");
    }
    if (st.isSymbolicLink()) {
      throw new ProfilePreflightStoreFailure("linked_path");
    }
    if (!st.isFile()) {
      throw new ProfilePreflightStoreFailure("write_failed");
    }
    if (!identitiesEqual(st, expectedIdentity)) {
      throw new ProfilePreflightStoreFailure("identity_changed");
    }
    if (st.size > MAX_CREDENTIAL_PROFILE_RECORD_BYTES) {
      throw new ProfilePreflightStoreFailure("oversized");
    }

    try {
      fd = openSync(profileJsonPath, authorityOpenFlags());
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new ProfilePreflightStoreFailure("absent");
      }
      if (code === "ELOOP" || code === "EMLINK") {
        throw new ProfilePreflightStoreFailure("linked_path");
      }
      throw new ProfilePreflightStoreFailure("write_failed");
    }

    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.isSymbolicLink() ||
      !identitiesEqual(opened, expectedIdentity) ||
      opened.size !== st.size
    ) {
      throw new ProfilePreflightStoreFailure("identity_changed");
    }

    const cap = MAX_CREDENTIAL_PROFILE_RECORD_BYTES + 1;
    const buf = Buffer.allocUnsafe(cap);
    let offset = 0;
    while (offset < cap) {
      const n = readSync(fd, buf, offset, cap - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    if (offset > MAX_CREDENTIAL_PROFILE_RECORD_BYTES) {
      throw new ProfilePreflightStoreFailure("oversized");
    }

    const after = fstatSync(fd);
    if (
      !after.isFile() ||
      !identitiesEqual(after, expectedIdentity) ||
      after.size !== opened.size
    ) {
      throw new ProfilePreflightStoreFailure("identity_changed");
    }

    closeQuiet(fd);
    fd = undefined;

    const parsed = parseCredentialProfileRecordBytes(buf.subarray(0, offset));
    if (parsed._tag === "Fail") {
      // Authority record is not a closed credential-profile document.
      throw new ProfilePreflightStoreFailure("decode_failed");
    }
    const record = parsed.record;
    if (record.profileId !== wrapper.profileId) {
      throw new ProfilePreflightStoreFailure("decode_failed");
    }
    if (record.vendor !== wrapper.vendor) {
      throw new ProfilePreflightStoreFailure("decode_failed");
    }
    if (profileIdentityOf(record) !== wrapper.profileIdentity) {
      throw new ProfilePreflightStoreFailure("decode_failed");
    }
  } finally {
    closeQuiet(fd);
  }
}

/**
 * Validate every authority directory component without following links.
 * All four (state root, credential-profiles, profile id, preflight) must
 * exist as real directories. R7A profile.json must exist as a real file.
 * Captures identities for a later recheck.
 */
function captureAuthorityDirsForRead(
  filePath: string,
): CapturedAuthorityDirs {
  const chain = authorityDirChain(filePath);
  const components: { path: string; identity: DirIdentity }[] = [];
  for (const path of chain) {
    const id = requireRealDir(path, "unreadable");
    components.push({ path, identity: id });
  }
  const profileDir = chain[2];
  const profileJson = requireProfileJson(profileDir, "unreadable");
  return {
    components,
    profileJsonPath: profileJson.path,
    profileJsonIdentity: profileJson.identity,
  };
}

/**
 * Capture the authority chain for write. Never creates `credential-profiles`
 * or the profile authority directory — those and `profile.json` are owned by
 * R7A and must already exist. Only the `preflight` child may be created when
 * its R7A parent authority remains a real non-linked directory, and only
 * through a held profile-directory descriptor (never path-based mkdir/chmod
 * after a pathname-only recheck).
 */
function ensureAuthorityDirsForWrite(
  filePath: string,
  wrapper: CredentialProfilePreflightV1,
): CapturedAuthorityDirs {
  const chain = authorityDirChain(filePath);
  const [stateRoot, profilesRoot, profileDir, preflightDir] = chain;
  const components: { path: string; identity: DirIdentity }[] = [];

  // R7A-owned: state root, credential-profiles, profile authority — no create.
  for (const path of [stateRoot, profilesRoot, profileDir] as const) {
    const id = requireRealDir(path, "write_failed");
    components.push({ path, identity: id });
  }

  const profileJson = requireProfileJson(profileDir, "write_failed");
  // Binding must hold before any preflight mutation.
  requireProfileBinding(profileJson.path, profileJson.identity, wrapper);

  // Fail closed before mutation when descriptor anchoring is unavailable.
  const parentFlags = dirOpenFlags();
  if (parentFlags === null || !profilePreflightDirectoryAnchorSupported()) {
    throw new ProfilePreflightStoreFailure("write_failed");
  }

  // Open the validated profile directory; verify against captured identity.
  let profileFd: number | undefined;
  let preflightFd: number | undefined;
  try {
    const profileLstat = lstatSync(profileDir);
    if (profileLstat.isSymbolicLink()) {
      throw new ProfilePreflightStoreFailure("linked_path");
    }
    if (!profileLstat.isDirectory()) {
      throw new ProfilePreflightStoreFailure("write_failed");
    }
    if (!identitiesEqual(profileLstat, components[2]!.identity)) {
      throw new ProfilePreflightStoreFailure("identity_changed");
    }

    profileFd = openSync(profileDir, parentFlags);
    const profileOpened = fstatSync(profileFd);
    if (
      !profileOpened.isDirectory() ||
      !identitiesEqual(profileOpened, components[2]!.identity)
    ) {
      throw new ProfilePreflightStoreFailure("identity_changed");
    }

    raceHook?.beforeCreatePreflightDir?.();

    // Parent fd must still be the captured profile identity after the seam.
    const profileAfterHook = fstatSync(profileFd);
    if (
      !profileAfterHook.isDirectory() ||
      !identitiesEqual(profileAfterHook, components[2]!.identity)
    ) {
      throw new ProfilePreflightStoreFailure("identity_changed");
    }
    // Revalidate binding after the race seam (in-place rewrite).
    requireProfileBinding(profileJson.path, profileJson.identity, wrapper);

    const anchor = procFdPath(profileFd);
    if (anchor === null) {
      throw new ProfilePreflightStoreFailure("write_failed");
    }
    const preflightAnchored = join(anchor, PROFILE_PREFLIGHT_DIR_NAME);

    // Observe preflight only through the held profile descriptor.
    let preflightKind: ReturnType<typeof observeNoFollow>;
    try {
      const st = lstatSync(preflightAnchored);
      if (st.isSymbolicLink()) {
        throw new ProfilePreflightStoreFailure("linked_path");
      }
      if (!st.isDirectory()) {
        throw new ProfilePreflightStoreFailure("write_failed");
      }
      preflightKind = "directory";
    } catch (e) {
      if (e instanceof ProfilePreflightStoreFailure) throw e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        preflightKind = "missing";
      } else {
        throw new ProfilePreflightStoreFailure("write_failed");
      }
    }

    // True when we observed missing and then created or raced with EEXIST.
    // Concurrent EEXIST must still receive owner-only mode enforcement.
    let enforceOwnerOnlyMode = false;
    if (preflightKind === "missing") {
      // Deterministic race seam: concurrent supply before anchored mkdir.
      raceHook?.beforeMkdirPreflightDir?.();
      try {
        mkdirSync(preflightAnchored, { recursive: false, mode: 0o700 });
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") {
          throw new ProfilePreflightStoreFailure("write_failed");
        }
      }
      enforceOwnerOnlyMode = true;
    }

    // Open the created/existing preflight through the same held profile fd.
    try {
      preflightFd = openSync(preflightAnchored, parentFlags);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ELOOP" || code === "EMLINK") {
        throw new ProfilePreflightStoreFailure("linked_path");
      }
      throw new ProfilePreflightStoreFailure("write_failed");
    }
    const preflightOpened = fstatSync(preflightFd);
    if (!preflightOpened.isDirectory()) {
      throw new ProfilePreflightStoreFailure("write_failed");
    }

    // Profile parent must still be the bound identity.
    const profileStill = fstatSync(profileFd);
    if (
      !profileStill.isDirectory() ||
      !identitiesEqual(profileStill, components[2]!.identity)
    ) {
      throw new ProfilePreflightStoreFailure("identity_changed");
    }

    // Set and verify POSIX mode through the open child descriptor only.
    // Applies to both our create and a concurrent EEXIST supply; never path-based.
    if (enforceOwnerOnlyMode && IS_POSIX) {
      try {
        fchmodSync(preflightFd, 0o700);
      } catch {
        throw new ProfilePreflightStoreFailure("write_failed");
      }
      const mode = fstatSync(preflightFd).mode & 0o777;
      if (mode !== 0o700) {
        throw new ProfilePreflightStoreFailure("write_failed");
      }
    }

    const preflightId: DirIdentity = {
      dev: preflightOpened.dev,
      ino: preflightOpened.ino,
    };
    // Prefer identity after mode set (inode unchanged; re-fstat for safety).
    const preflightFinal = fstatSync(preflightFd);
    if (!preflightFinal.isDirectory()) {
      throw new ProfilePreflightStoreFailure("write_failed");
    }
    const preflightIdentity: DirIdentity = {
      dev: preflightFinal.dev,
      ino: preflightFinal.ino,
    };
    if (!identitiesEqual(preflightIdentity, preflightId)) {
      throw new ProfilePreflightStoreFailure("identity_changed");
    }

    // Logical path must still name a real directory with this identity
    // (recheck before success; does not drive mutation).
    const pathRecheck = captureDirIdentity(preflightDir);
    if (
      pathRecheck === null ||
      !identitiesEqual(pathRecheck, preflightIdentity)
    ) {
      throw new ProfilePreflightStoreFailure("identity_changed");
    }

    components.push({ path: preflightDir, identity: preflightIdentity });

    return {
      components,
      profileJsonPath: profileJson.path,
      profileJsonIdentity: profileJson.identity,
    };
  } finally {
    closeQuiet(preflightFd);
    closeQuiet(profileFd);
  }
}

/**
 * Recheck every captured authority directory and R7A profile.json still name
 * the same non-linked objects. A component that became a link is
 * `linked_path`; any other change is `identity_changed`.
 */
function recheckAuthorityDirs(
  captured: CapturedAuthorityDirs,
): void {
  for (const c of captured.components) {
    const kind = observeNoFollow(c.path);
    if (kind === "symlink") {
      throw new ProfilePreflightStoreFailure("linked_path");
    }
    if (kind !== "directory") {
      throw new ProfilePreflightStoreFailure("identity_changed");
    }
    const id = captureDirIdentity(c.path);
    if (id === null || !identitiesEqual(id, c.identity)) {
      throw new ProfilePreflightStoreFailure("identity_changed");
    }
  }
  const jsonKind = observeNoFollow(captured.profileJsonPath);
  if (jsonKind === "symlink") {
    throw new ProfilePreflightStoreFailure("linked_path");
  }
  if (jsonKind !== "file") {
    throw new ProfilePreflightStoreFailure("identity_changed");
  }
  const jsonId = captureFileIdentity(captured.profileJsonPath);
  if (
    jsonId === null ||
    !identitiesEqual(jsonId, captured.profileJsonIdentity)
  ) {
    throw new ProfilePreflightStoreFailure("identity_changed");
  }
}

/**
 * Bounded no-follow descriptor read. Refuses a linked final path and any
 * linked authority ancestor (`credential-profiles`, profile, or `preflight`).
 * Retains and rechecks directory identities before success.
 * Returns closed failure reasons only (no paths, bytes, or exception text).
 */
export function readProfilePreflightRecord(
  absolutePath: string,
  expected?: CredentialProfilePreflightExpected,
): Effect.Effect<CredentialProfilePreflightV1, ProfilePreflightStoreFailure> {
  return Effect.try({
    try: () => {
      const pathErr = validateAbsolutePath(absolutePath);
      if (pathErr !== null) throw pathErr;

      // Full authority path: refuse linked ancestors before opening the file.
      const authorityDirs = captureAuthorityDirsForRead(absolutePath);

      let fd: number | undefined;
      try {
        let st: Stats;
        try {
          st = lstatSync(absolutePath);
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            throw new ProfilePreflightStoreFailure("absent");
          }
          throw new ProfilePreflightStoreFailure("unreadable");
        }
        if (st.isSymbolicLink()) {
          throw new ProfilePreflightStoreFailure("linked_path");
        }
        if (!st.isFile()) {
          throw new ProfilePreflightStoreFailure("unreadable");
        }
        if (st.size > MAX_CREDENTIAL_PROFILE_PREFLIGHT_BYTES) {
          throw new ProfilePreflightStoreFailure("oversized");
        }

        recheckAuthorityDirs(authorityDirs);

        try {
          fd = openSync(absolutePath, authorityOpenFlags());
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            throw new ProfilePreflightStoreFailure("absent");
          }
          if (code === "ELOOP" || code === "EMLINK") {
            throw new ProfilePreflightStoreFailure("linked_path");
          }
          throw new ProfilePreflightStoreFailure("unreadable");
        }

        const opened = fstatSync(fd);
        if (
          !opened.isFile() ||
          opened.isSymbolicLink() ||
          !identitiesEqual(opened, st) ||
          opened.size !== st.size
        ) {
          throw new ProfilePreflightStoreFailure("identity_changed");
        }

        // Path must still name the same non-linked regular file.
        const pathAfter = lstatSync(absolutePath);
        if (
          pathAfter.isSymbolicLink() ||
          !pathAfter.isFile() ||
          !identitiesEqual(pathAfter, st) ||
          pathAfter.size !== st.size
        ) {
          throw new ProfilePreflightStoreFailure("identity_changed");
        }

        recheckAuthorityDirs(authorityDirs);

        const cap = MAX_CREDENTIAL_PROFILE_PREFLIGHT_BYTES + 1;
        const buf = Buffer.allocUnsafe(cap);
        let offset = 0;
        while (offset < cap) {
          const n = readSync(fd, buf, offset, cap - offset, offset);
          if (n === 0) break;
          offset += n;
        }
        if (offset > MAX_CREDENTIAL_PROFILE_PREFLIGHT_BYTES) {
          throw new ProfilePreflightStoreFailure("oversized");
        }

        const after = fstatSync(fd);
        if (
          !after.isFile() ||
          !identitiesEqual(after, opened) ||
          after.size !== opened.size
        ) {
          throw new ProfilePreflightStoreFailure("identity_changed");
        }

        recheckAuthorityDirs(authorityDirs);

        closeQuiet(fd);
        fd = undefined;

        const parsed = parseCredentialProfilePreflightBytes(
          buf.subarray(0, offset),
          expected,
        );
        if (parsed._tag === "Fail") {
          if (parsed.reason === "oversized") {
            throw new ProfilePreflightStoreFailure("oversized");
          }
          if (
            parsed.reason === "malformed_utf8" ||
            parsed.reason === "duplicate_key" ||
            parsed.reason === "invalid_schema" ||
            parsed.reason === "unknown_key"
          ) {
            throw new ProfilePreflightStoreFailure("malformed");
          }
          throw new ProfilePreflightStoreFailure("decode_failed");
        }
        return parsed.wrapper;
      } finally {
        closeQuiet(fd);
      }
    },
    catch: (e) =>
      e instanceof ProfilePreflightStoreFailure
        ? e
        : new ProfilePreflightStoreFailure("unreadable"),
  });
}

function cleanupTemp(tmpPath: string): void {
  try {
    unlinkSync(tmpPath);
  } catch {
    /* ignore */
  }
}

/**
 * Atomic owner-only write via a held no-follow parent-directory descriptor.
 *
 * Publication is anchored to `/proc/self/fd/<parentFd>/…` so a path swap of
 * the preflight directory after bind cannot redirect the rename. When the
 * runtime cannot prove that boundary (no O_DIRECTORY|O_NOFOLLOW or no
 * `/proc/self/fd`), fail closed before any mutation — never path-based
 * rename followed by a post-hoc recheck.
 *
 * Never recreates R7A `credential-profiles` or the profile authority; only
 * the `preflight` child may be created. State root is in the authority
 * chain. Cleans up the temp file on any failure.
 */
export function writeProfilePreflightRecord(
  absolutePath: string,
  wrapper: CredentialProfilePreflightV1,
): Effect.Effect<void, ProfilePreflightStoreFailure> {
  return Effect.try({
    try: () => {
      const pathErr = validateAbsolutePath(absolutePath);
      if (pathErr !== null) throw pathErr;

      // Re-validate before persist so a corrupted in-memory wrapper never lands.
      const rechecked = decodeCredentialProfilePreflightV1(wrapper);
      if (isProfilePreflightDecodeFailure(rechecked)) {
        throw new ProfilePreflightStoreFailure("decode_failed");
      }

      let body: string;
      try {
        body = renderCredentialProfilePreflightFile(rechecked);
      } catch {
        throw new ProfilePreflightStoreFailure("write_failed");
      }
      if (Buffer.byteLength(body, "utf8") > MAX_CREDENTIAL_PROFILE_PREFLIGHT_BYTES) {
        throw new ProfilePreflightStoreFailure("oversized");
      }

      // Fail closed before mutation when anchored publication is unavailable.
      const parentFlags = dirOpenFlags();
      if (
        parentFlags === null ||
        !profilePreflightDirectoryAnchorSupported()
      ) {
        throw new ProfilePreflightStoreFailure("write_failed");
      }

      // R7A parents required; only preflight child may be created.
      const authorityDirs = ensureAuthorityDirsForWrite(absolutePath, rechecked);
      const preflightDir = dirname(absolutePath);
      const finalName = basename(absolutePath);
      if (
        finalName.length === 0 ||
        finalName === "." ||
        finalName === ".." ||
        finalName.includes("/") ||
        finalName.includes("\\") ||
        finalName.includes("\0")
      ) {
        throw new ProfilePreflightStoreFailure("path_invalid");
      }

      // Refuse a symlink at the final path (no follow, no overwrite of a link).
      try {
        const existing = lstatSync(absolutePath);
        if (existing.isSymbolicLink()) {
          throw new ProfilePreflightStoreFailure("linked_path");
        }
      } catch (e) {
        if (e instanceof ProfilePreflightStoreFailure) throw e;
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          throw new ProfilePreflightStoreFailure("write_failed");
        }
      }

      recheckAuthorityDirs(authorityDirs);
      raceHook?.afterCaptureAuthority?.();
      recheckAuthorityDirs(authorityDirs);

      // Bind the preflight parent through O_DIRECTORY|O_NOFOLLOW and hold it.
      let parentFd: number | undefined;
      let tmpName: string | undefined;
      let fileFd: number | undefined;
      try {
        const parentLstat = lstatSync(preflightDir);
        if (parentLstat.isSymbolicLink()) {
          throw new ProfilePreflightStoreFailure("linked_path");
        }
        if (!parentLstat.isDirectory()) {
          throw new ProfilePreflightStoreFailure("write_failed");
        }
        parentFd = openSync(preflightDir, parentFlags);
        const parentOpened = fstatSync(parentFd);
        if (
          !parentOpened.isDirectory() ||
          !identitiesEqual(parentOpened, parentLstat)
        ) {
          throw new ProfilePreflightStoreFailure("identity_changed");
        }
        // Path must still name the same non-linked directory we opened.
        const pathRecheck = captureDirIdentity(preflightDir);
        if (
          pathRecheck === null ||
          !identitiesEqual(pathRecheck, parentOpened)
        ) {
          throw new ProfilePreflightStoreFailure("identity_changed");
        }
        const capturedPreflight = authorityDirs.components[3];
        if (
          capturedPreflight === undefined ||
          !identitiesEqual(parentOpened, capturedPreflight.identity)
        ) {
          throw new ProfilePreflightStoreFailure("identity_changed");
        }

        const anchor = procFdPath(parentFd);
        if (anchor === null) {
          throw new ProfilePreflightStoreFailure("write_failed");
        }

        raceHook?.afterBindParentDir?.();

        // Parent fd must still be the same directory after the race seam.
        const parentAfterHook = fstatSync(parentFd);
        if (
          !parentAfterHook.isDirectory() ||
          !identitiesEqual(parentAfterHook, parentOpened)
        ) {
          throw new ProfilePreflightStoreFailure("identity_changed");
        }
        recheckAuthorityDirs(authorityDirs);

        tmpName = `.preflight.${randomBytes(16).toString("hex")}.tmp`;
        const tmpAnchored = join(anchor, tmpName);
        const finalAnchored = join(anchor, finalName);

        fileFd = openSync(
          tmpAnchored,
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
          0o600,
        );
        const buf = Buffer.from(body, "utf8");
        let offset = 0;
        while (offset < buf.byteLength) {
          const n = writeSync(fileFd, buf, offset, buf.byteLength - offset);
          offset += n;
        }

        try {
          fchmodSync(fileFd, 0o600);
        } catch {
          if (IS_POSIX) {
            closeQuiet(fileFd);
            fileFd = undefined;
            cleanupTemp(tmpAnchored);
            throw new ProfilePreflightStoreFailure("write_failed");
          }
        }
        if (IS_POSIX) {
          const mode = fstatSync(fileFd).mode & 0o777;
          if (mode !== 0o600) {
            closeQuiet(fileFd);
            fileFd = undefined;
            cleanupTemp(tmpAnchored);
            throw new ProfilePreflightStoreFailure("write_failed");
          }
        }

        fsyncSync(fileFd);
        closeSync(fileFd);
        fileFd = undefined;

        // Parent still bound and path authority unchanged before publish.
        const parentBeforeRename = fstatSync(parentFd);
        if (
          !parentBeforeRename.isDirectory() ||
          !identitiesEqual(parentBeforeRename, parentOpened)
        ) {
          cleanupTemp(tmpAnchored);
          throw new ProfilePreflightStoreFailure("identity_changed");
        }
        recheckAuthorityDirs(authorityDirs);

        raceHook?.beforePublishRename?.();

        // Re-prove parent fd and path authority after the race seam; never
        // publish when the path no longer names the bound parent.
        const parentPreRename = fstatSync(parentFd);
        if (
          !parentPreRename.isDirectory() ||
          !identitiesEqual(parentPreRename, parentOpened)
        ) {
          cleanupTemp(tmpAnchored);
          throw new ProfilePreflightStoreFailure("identity_changed");
        }
        recheckAuthorityDirs(authorityDirs);
        // Authority record must still bind the wrapper immediately before publish.
        requireProfileBinding(
          authorityDirs.profileJsonPath,
          authorityDirs.profileJsonIdentity,
          rechecked,
        );

        // Anchored rename: publishes into the held parent inode only.
        renameSync(tmpAnchored, finalAnchored);
        tmpName = undefined; // published; no temp cleanup of final

        // Success only when the bound parent and full authority chain hold.
        const parentAfterRename = fstatSync(parentFd);
        if (
          !parentAfterRename.isDirectory() ||
          !identitiesEqual(parentAfterRename, parentOpened)
        ) {
          throw new ProfilePreflightStoreFailure("identity_changed");
        }
        recheckAuthorityDirs(authorityDirs);

        // Parent-directory fsync through the held descriptor.
        try {
          fsyncSync(parentFd);
        } catch (syncErr) {
          const code = (syncErr as NodeJS.ErrnoException).code;
          if (!isIgnorableParentDirSyncError(code)) {
            throw new ProfilePreflightStoreFailure("write_failed");
          }
        }
      } catch (e) {
        closeQuiet(fileFd);
        if (tmpName !== undefined && parentFd !== undefined) {
          const anchor = procFdPath(parentFd);
          if (anchor !== null) {
            cleanupTemp(join(anchor, tmpName));
          }
        }
        closeQuiet(parentFd);
        if (e instanceof ProfilePreflightStoreFailure) throw e;
        throw new ProfilePreflightStoreFailure("write_failed");
      }
      closeQuiet(parentFd);
    },
    catch: (e) =>
      e instanceof ProfilePreflightStoreFailure
        ? e
        : new ProfilePreflightStoreFailure("write_failed"),
  });
}

export const liveCredentialProfilePreflightStore = Layer.succeed(
  CredentialProfilePreflightStore,
  {
    read: (absolutePath, expected) =>
      readProfilePreflightRecord(absolutePath, expected),
    write: (absolutePath, wrapper) =>
      writeProfilePreflightRecord(absolutePath, wrapper),
  },
);
