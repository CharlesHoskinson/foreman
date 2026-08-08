/**
 * External credential-profile authority (Sprint 3 R7A).
 *
 * One named profile selects one vendor configuration root under a preflighted
 * Foreman state root. Never stores profile state in the target worktree.
 * Never reads, copies, inspects, prints, or modifies vendor credential files.
 * Live lanes and Setup login stay out of this package (R7B).
 */

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  resolve as pathResolve,
} from "node:path";
import { Context, Effect, Layer } from "effect";
import {
  canonicalize,
  isCoreFailure,
  parseJsonRejectDuplicateKeys,
  rejectUnknownKeys,
} from "@foreman/core";
import { isEqualOrDescendant } from "./round-cli.js";

/** Windows keeps best-effort modes; POSIX requires and verifies them. */
const IS_POSIX = process.platform !== "win32";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CREDENTIAL_PROFILE_SCHEMA_VERSION = 1 as const;

export const MAX_CREDENTIAL_PROFILE_RECORD_BYTES = 16_384;

export const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const CREDENTIAL_VENDORS = ["grok", "codex"] as const;

export const EXIT_OK = 0;
export const EXIT_REFUSED = 1;

export const PROFILES_DIR_NAME = "credential-profiles";
export const HOMES_DIR_NAME = "homes";
export const PROFILE_JSON_NAME = "profile.json";

export const CREDENTIAL_PROFILE_REFUSAL_REASONS = [
  "invalid_arguments",
  "invalid_profile_id",
  "invalid_state_root",
  "state_root_in_worktree",
  "authority_missing",
  "authority_invalid",
  "authority_conflict",
  "linked_path",
  "identity_changed",
  "unreadable",
  "write_failed",
] as const;

const READY_RESULT_KEYS = [
  "_tag",
  "profileId",
  "vendor",
  "configRoot",
  "profileIdentity",
] as const;

const REFUSED_RESULT_KEYS = ["_tag", "reason"] as const;

// ---------------------------------------------------------------------------
// Closed types
// ---------------------------------------------------------------------------

export type CredentialVendor = "grok" | "codex";

export type CredentialProfileRecordV1 = {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly vendor: CredentialVendor;
  readonly configRootRel: string;
};

export type CredentialProfileRefusalReason =
  (typeof CREDENTIAL_PROFILE_REFUSAL_REASONS)[number];

export type CredentialProfileResult =
  | {
      readonly _tag: "Ready";
      readonly profileId: string;
      readonly vendor: CredentialVendor;
      readonly configRoot: string;
      readonly profileIdentity: string;
    }
  | {
      readonly _tag: "Initialized";
      readonly profileId: string;
      readonly vendor: CredentialVendor;
      readonly configRoot: string;
      readonly profileIdentity: string;
    }
  | {
      readonly _tag: "Refused";
      readonly reason: CredentialProfileRefusalReason;
    };

export type CredentialProfileInput = {
  readonly stateRoot: string;
  readonly worktreeRoot: string;
  readonly profileId: string;
  readonly vendor: CredentialVendor;
};

export type CredentialProfileCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type ParsedCredentialProfileArgv =
  | {
      readonly _tag: "Ok";
      readonly command: "init" | "resolve";
      readonly stateRoot: string;
      readonly worktreeRoot: string;
      readonly profileId: string;
      readonly vendor: CredentialVendor;
    }
  | { readonly _tag: "Invalid" };

// ---------------------------------------------------------------------------
// Path / layout helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Normalize an absolute path for comparison: resolve `.`/`..`. Does not follow
 * symbolic links.
 *
 * Strips no separator of its own. `pathResolve` already collapses separator
 * runs and removes a trailing separator for this platform's path flavour, and
 * it preserves roots (`/`, `C:\`, `\\server\share\`). Stripping one more
 * character was wrong twice over: on POSIX `\` is a legal filename character,
 * so `/tmp/x\` collapsed onto `/tmp/x` -- a path-confusion primitive in
 * credential-authority comparison, where a caller could present a path that
 * compares equal to one directory and denotes another; and on Windows it
 * turned the root `C:\` into `C:`, which `isAbsolute` rejects as
 * drive-relative, so containment would be decided against the per-drive
 * working directory.
 */
export function normalizeAbsolutePath(input: string): string {
  return pathResolve(input);
}

export function isValidProfileId(id: string): boolean {
  return typeof id === "string" && PROFILE_ID_RE.test(id);
}

export function isCredentialVendor(v: unknown): v is CredentialVendor {
  return v === "grok" || v === "codex";
}

/** Relative config root for a vendor. Always uses forward slashes. */
export function configRootRelForVendor(vendor: CredentialVendor): string {
  return `${HOMES_DIR_NAME}/${vendor}`;
}

export function profileAuthorityDir(
  stateRoot: string,
  profileId: string,
): string {
  return join(stateRoot, PROFILES_DIR_NAME, profileId);
}

export function profileJsonPath(stateRoot: string, profileId: string): string {
  return join(profileAuthorityDir(stateRoot, profileId), PROFILE_JSON_NAME);
}

export function profileHomesDir(stateRoot: string, profileId: string): string {
  return join(profileAuthorityDir(stateRoot, profileId), HOMES_DIR_NAME);
}

export function profileVendorHomeDir(
  stateRoot: string,
  profileId: string,
  vendor: CredentialVendor,
): string {
  return join(profileHomesDir(stateRoot, profileId), vendor);
}

/**
 * Absolute vendor configuration root. `configRootRel` uses forward slashes
 * in the record; this helper splits on `/` for portable join.
 */
export function absoluteConfigRoot(
  stateRoot: string,
  profileId: string,
  configRootRel: string,
): string {
  const segments = configRootRel.split("/").filter((s) => s.length > 0);
  return join(stateRoot, PROFILES_DIR_NAME, profileId, ...segments);
}

/**
 * Segment-aware equality / descendant test. Re-export for package consumers
 * that validate state-root vs worktree without importing round-cli.
 */
export { isEqualOrDescendant };

// ---------------------------------------------------------------------------
// Pure record parse / render / identity
// ---------------------------------------------------------------------------

export function makeCredentialProfileRecord(
  profileId: string,
  vendor: CredentialVendor,
): CredentialProfileRecordV1 {
  return {
    schemaVersion: CREDENTIAL_PROFILE_SCHEMA_VERSION,
    profileId,
    vendor,
    configRootRel: configRootRelForVendor(vendor),
  };
}

/**
 * Canonical record bytes as UTF-8 text (no trailing newline). Key order is
 * sorted by `@foreman/core` canonicalize.
 */
export function renderCredentialProfileRecord(
  record: CredentialProfileRecordV1,
): string {
  return canonicalize(record as unknown);
}

/** File body: canonical JSON + single trailing LF. */
export function renderCredentialProfileRecordFile(
  record: CredentialProfileRecordV1,
): string {
  return renderCredentialProfileRecord(record) + "\n";
}

/**
 * Lowercase SHA-256 of the canonical record bytes (no trailing LF, no
 * absolute paths, timestamps, secrets, or environment values).
 */
export function profileIdentityOf(
  record: CredentialProfileRecordV1,
): string {
  const text = renderCredentialProfileRecord(record);
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function recordsEqualExact(
  a: CredentialProfileRecordV1,
  b: CredentialProfileRecordV1,
): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    a.profileId === b.profileId &&
    a.vendor === b.vendor &&
    a.configRootRel === b.configRootRel
  );
}

/**
 * Decode a closed v1 record. Rejects unknown keys and wrong shapes.
 * Does not parse JSON text (caller must use parseJsonRejectDuplicateKeys).
 */
export function decodeCredentialProfileRecordV1(
  value: unknown,
): CredentialProfileRecordV1 | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (
    rejectUnknownKeys(obj, [
      "schemaVersion",
      "profileId",
      "vendor",
      "configRootRel",
    ])
  ) {
    return null;
  }
  if (obj["schemaVersion"] !== 1) return null;
  const profileId = obj["profileId"];
  if (typeof profileId !== "string" || !isValidProfileId(profileId)) {
    return null;
  }
  const vendor = obj["vendor"];
  if (!isCredentialVendor(vendor)) return null;
  const configRootRel = obj["configRootRel"];
  if (typeof configRootRel !== "string") return null;
  if (configRootRel !== configRootRelForVendor(vendor)) return null;
  // Reject backslash or absolute / parent segments in the relative root.
  if (
    configRootRel.includes("\\") ||
    configRootRel.includes("\0") ||
    configRootRel.startsWith("/") ||
    configRootRel.includes("..")
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    profileId,
    vendor,
    configRootRel,
  };
}

/**
 * Parse raw UTF-8 file bytes into a record. Enforces the 16,384-byte bound,
 * fatal UTF-8, duplicate-key rejection, and closed decoding.
 */
export function parseCredentialProfileRecordBytes(
  bytes: Uint8Array,
):
  | { readonly _tag: "Ok"; readonly record: CredentialProfileRecordV1 }
  | {
      readonly _tag: "Fail";
      readonly reason: "authority_invalid" | "unreadable";
    } {
  if (bytes.byteLength > MAX_CREDENTIAL_PROFILE_RECORD_BYTES) {
    return { _tag: "Fail", reason: "authority_invalid" };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { _tag: "Fail", reason: "authority_invalid" };
  }
  // Strip one optional trailing LF for parse (canonical file form).
  const body =
    text.endsWith("\n") && !text.endsWith("\r\n") ? text.slice(0, -1) : text;
  if (body.includes("\0")) {
    return { _tag: "Fail", reason: "authority_invalid" };
  }
  const parsed = parseJsonRejectDuplicateKeys(body);
  if (isCoreFailure(parsed)) {
    return { _tag: "Fail", reason: "authority_invalid" };
  }
  const record = decodeCredentialProfileRecordV1(parsed);
  if (record === null) {
    return { _tag: "Fail", reason: "authority_invalid" };
  }
  return { _tag: "Ok", record };
}

/**
 * Closed decoder for CLI/result shapes. Rejects unknown keys on every
 * variant; does not accept open objects with extra fields.
 */
export function isCredentialProfileResult(
  v: unknown,
): v is CredentialProfileResult {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  const tag = obj["_tag"];
  if (tag === "Ready" || tag === "Initialized") {
    if (rejectUnknownKeys(obj, READY_RESULT_KEYS) !== null) return false;
    const profileId = obj["profileId"];
    const vendor = obj["vendor"];
    const configRoot = obj["configRoot"];
    const profileIdentity = obj["profileIdentity"];
    return (
      typeof profileId === "string" &&
      isCredentialVendor(vendor) &&
      typeof configRoot === "string" &&
      typeof profileIdentity === "string" &&
      /^[0-9a-f]{64}$/.test(profileIdentity)
    );
  }
  if (tag === "Refused") {
    if (rejectUnknownKeys(obj, REFUSED_RESULT_KEYS) !== null) return false;
    const reason = obj["reason"];
    return (
      typeof reason === "string" &&
      (CREDENTIAL_PROFILE_REFUSAL_REASONS as readonly string[]).includes(reason)
    );
  }
  return false;
}

export function renderCredentialProfileJson(
  result: CredentialProfileResult,
): string {
  return canonicalize(result as unknown);
}

// ---------------------------------------------------------------------------
// Filesystem service (injectable; never reads vendor credential files)
// ---------------------------------------------------------------------------

export type PathKind =
  | "missing"
  | "directory"
  | "file"
  | "symlink"
  | "other";

export type PathIdentity = {
  readonly dev: number;
  readonly ino: number;
  readonly kind: PathKind;
};

export type CredentialProfileFsShape = {
  /** Classify a path without following links. */
  readonly classify: (path: string) => PathKind;
  /** Stable identity for a path (lstat). Missing → null. */
  readonly identity: (path: string) => PathIdentity | null;
  /**
   * Permission bits `mode & 0o777` from lstat (no follow). Missing → null.
   * Used on POSIX to require directory 0700 and authority 0600.
   */
  readonly modeBits: (path: string) => number | null;
  /**
   * Create one directory non-recursively. Mode 0o700 when supported.
   * Callers that lose a concurrent-create race (`EEXIST`) must reclassify
   * the exact path and continue only for a non-linked directory with safe
   * POSIX mode. No path-based chmod and no recursive mkdirp on this service.
   */
  readonly mkdir: (path: string, mode: number) => void;
  /**
   * Read up to maxBytes from a regular non-linked file. Opens without
   * following a final-component link; verifies the opened descriptor
   * identity before a bounded read through that descriptor.
   *
   * The `Ok` variant MUST carry the `fstat` identity of the same open
   * descriptor that supplied `bytes`. Callers must not replace that with a
   * pathname identity lookup after the descriptor closes.
   */
  readonly readFile: (
    path: string,
    maxBytes: number,
  ) =>
    | {
        readonly _tag: "Ok";
        readonly bytes: Buffer;
        /** fstat identity of the open descriptor that supplied `bytes`. */
        readonly identity: PathIdentity;
      }
    | { readonly _tag: "Absent" }
    | { readonly _tag: "Oversized" }
    | { readonly _tag: "Linked" }
    | { readonly _tag: "NotFile" }
    | { readonly _tag: "Unreadable" };
  /**
   * Atomic exclusive publish of authority bytes: temp write + fsync +
   * exclusive hard-link publish + parent fsync. Never renames over a
   * final path (no check-then-rename race). Unsupported exclusive
   * hard-link is WriteFailed (no rename fallback). Mode 0600 is set on
   * the open temp descriptor before publish — never path-chmod.
   */
  readonly writeAuthorityExclusive: (
    finalPath: string,
    body: Uint8Array,
  ) =>
    | { readonly _tag: "Ok" }
    | { readonly _tag: "Exists" }
    | { readonly _tag: "WriteFailed" };
};

export class CredentialProfileFs extends Context.Tag("CredentialProfileFs")<
  CredentialProfileFs,
  CredentialProfileFsShape
>() {}

// ---------------------------------------------------------------------------
// Race hooks (tests only) — declared early so live FS can honor them
// ---------------------------------------------------------------------------

export type CredentialProfileRaceHook = {
  /** After classifying state root; before layout work. */
  readonly afterValidateStateRoot?: () => void;
  /** After directories are ensured; before exclusive write. */
  readonly afterEnsureDirs?: () => void;
  /** After exclusive write succeeds; before re-read verification. */
  readonly afterWrite?: () => void;
  /** After reading existing authority; before decode. */
  readonly afterReadAuthority?: () => void;
  /**
   * When set, exclusive hard-link publish throws this errno code instead of
   * calling linkSync. Tests only — proves WriteFailed without rename fallback.
   */
  readonly forceExclusiveLinkCode?: string;
  /**
   * When set, parent-directory open/fsync after publish fails with code EIO
   * (or `forceParentDirSyncCode` when provided). Classification uses
   * `isIgnorableParentDirSyncError`.
   */
  readonly forceParentDirSyncFailure?: boolean;
  /**
   * Errno code for a forced parent-directory sync failure. When set alone,
   * forces the failure. When set with `forceParentDirSyncFailure`, overrides
   * the default EIO code.
   */
  readonly forceParentDirSyncCode?: string;
  /**
   * After safe-mode verification and before the final dual containment /
   * layout-identity / authority-file-identity gate (tests only).
   */
  readonly afterSafeModeVerify?: () => void;
};

/**
 * Closed set of Windows errno codes that mean parent-directory open/fsync is
 * unsupported on the host. Only these may be ignored after authority publish.
 * `EIO`, `EACCES`, and every unknown code MUST surface as WriteFailed.
 *
 * `EPERM` is in the set because it is the code Windows actually produces for
 * this call, not a permission problem to be papered over. There is no
 * directory-fsync equivalent on Windows: `FlushFileBuffers` on a directory
 * handle returns ERROR_ACCESS_DENIED, which Node surfaces as EPERM. Excluding
 * it made the Windows branch unreachable -- every authority publish refused
 * with `write_failed`, so credential profiles, profile-bound Setup and lane
 * admission could not function on the platform at all. Measured on
 * Windows 11 / Node 24.18.0: the exclusion accounted for roughly 32 of the
 * 49 remaining gates-windows failures.
 *
 * The narrowing this loses is real and is stated plainly: a genuine
 * access-denied on the parent directory is no longer distinguishable here from
 * the platform gap. The publish itself is unaffected -- the authority file is
 * already written and hard-linked before this barrier runs, and every other
 * failure mode (link, write, mode, identity) still refuses.
 */
export const WINDOWS_UNSUPPORTED_PARENT_DIR_SYNC_CODES: ReadonlySet<string> =
  new Set(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EINVAL", "EISDIR", "EPERM"]);

/**
 * Whether a parent-directory open/fsync error may be ignored after exclusive
 * authority publication.
 *
 * - POSIX: never ignore (any failure is WriteFailed). EPERM included -- the
 *   barrier exists there and a failure is a real durability failure.
 * - Windows: ignore only the closed unsupported-code set. `EIO`, `EACCES`,
 *   `undefined`, and unknown codes are never ignored.
 */
export function isIgnorableParentDirSyncError(
  code: string | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") return false;
  if (code === undefined) return false;
  return WINDOWS_UNSUPPORTED_PARENT_DIR_SYNC_CODES.has(code);
}

let raceHook: CredentialProfileRaceHook | undefined;

export function setCredentialProfileRaceHook(
  hook: CredentialProfileRaceHook | undefined,
): void {
  raceHook = hook;
}

function classifyFromStats(st: Stats): PathKind {
  // Node reports Windows junctions as symbolic links via lstat.
  if (st.isSymbolicLink()) return "symlink";
  if (st.isDirectory()) return "directory";
  if (st.isFile()) return "file";
  return "other";
}

function liveClassify(path: string): PathKind {
  try {
    return classifyFromStats(lstatSync(path));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return "missing";
    return "other";
  }
}

function liveIdentity(path: string): PathIdentity | null {
  try {
    const st = lstatSync(path);
    return {
      dev: st.dev,
      ino: st.ino,
      kind: classifyFromStats(st),
    };
  } catch {
    return null;
  }
}

function liveModeBits(path: string): number | null {
  try {
    return lstatSync(path).mode & 0o777;
  } catch {
    return null;
  }
}

/**
 * Open flags that refuse to follow a final-component symbolic link when the
 * platform exposes O_NOFOLLOW. On platforms without it, callers still
 * lstat-check before open and recheck identity after open.
 */
function authorityOpenFlags(): number {
  const c = fsConstants as Record<string, number | undefined>;
  if (typeof c.O_NOFOLLOW === "number") {
    return fsConstants.O_RDONLY | c.O_NOFOLLOW;
  }
  return fsConstants.O_RDONLY;
}

function closeQuiet(fd: number | undefined): void {
  if (fd === undefined) return;
  try {
    closeSync(fd);
  } catch {
    /* ignore */
  }
}

/**
 * Identity from an open-descriptor `fstat` result. Kind is derived from the
 * same stats object that names `dev`/`ino` — never from a later path lstat.
 */
function identityFromFdStats(st: Stats): PathIdentity {
  return {
    dev: st.dev,
    ino: st.ino,
    kind: classifyFromStats(st),
  };
}

/**
 * Open the authority without following a link. Verify the opened descriptor
 * and path identity before the bounded read, then read through that descriptor.
 * On success, bind `identity` to the post-read `fstat` of the same FD.
 */
function liveReadFile(
  path: string,
  maxBytes: number,
): ReturnType<CredentialProfileFsShape["readFile"]> {
  let fd: number | undefined;
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) return { _tag: "Linked" };
    if (!st.isFile()) return { _tag: "NotFile" };
    if (st.size > maxBytes) return { _tag: "Oversized" };

    fd = openSync(path, authorityOpenFlags());
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.isSymbolicLink() ||
      opened.dev !== st.dev ||
      opened.ino !== st.ino ||
      opened.size !== st.size
    ) {
      return { _tag: "Unreadable" };
    }

    // Path identity must still name the same non-linked regular file.
    const pathAfter = lstatSync(path);
    if (
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      pathAfter.dev !== st.dev ||
      pathAfter.ino !== st.ino ||
      pathAfter.size !== st.size
    ) {
      return { _tag: "Unreadable" };
    }

    const cap = maxBytes + 1;
    const buf = Buffer.allocUnsafe(cap);
    let offset = 0;
    while (offset < cap) {
      const n = readSync(fd, buf, offset, cap - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    if (offset > maxBytes) return { _tag: "Oversized" };

    // fstat the still-open descriptor that supplied the bytes — this identity
    // is authoritative for the decoded authority, not a post-close path lstat.
    const after = fstatSync(fd);
    if (
      !after.isFile() ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size
    ) {
      return { _tag: "Unreadable" };
    }
    const identity = identityFromFdStats(after);
    if (identity.kind !== "file") {
      return { _tag: "Unreadable" };
    }
    return { _tag: "Ok", bytes: buf.subarray(0, offset), identity };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return { _tag: "Absent" };
    // O_NOFOLLOW hit a symlink (ELOOP / EMLINK) or open failed closed.
    if (err.code === "ELOOP" || err.code === "EINVAL") {
      // Re-classify: a link at the path is Linked; anything else Unreadable.
      try {
        if (lstatSync(path).isSymbolicLink()) return { _tag: "Linked" };
      } catch {
        /* fall through */
      }
    }
    return { _tag: "Unreadable" };
  } finally {
    closeQuiet(fd);
  }
}

function cleanupTemp(tmpPath: string): void {
  try {
    unlinkSync(tmpPath);
  } catch {
    /* ignore */
  }
}

/**
 * Live exclusive authority publish. Hard-link only: an unsupported or failed
 * exclusive hard-link returns WriteFailed. Never falls back to rename (a
 * check-then-rename race can overwrite a conflicting authority file).
 *
 * Mode `0600` is set and verified on the still-open temporary-file descriptor
 * before fsync and hard-link publication. The hard link keeps that inode mode.
 * Path-based chmod is never applied to the final authority path after publish.
 */
export function liveWriteAuthorityExclusive(
  finalPath: string,
  body: Uint8Array,
): ReturnType<CredentialProfileFsShape["writeAuthorityExclusive"]> {
  const dir = dirname(finalPath);
  const tmpName = `.profile.${randomBytes(16).toString("hex")}.tmp`;
  const tmpPath = join(dir, tmpName);
  let fd: number | undefined;
  try {
    // Refuse if final already exists (any kind) before write.
    const existing = liveClassify(finalPath);
    if (existing !== "missing") {
      return { _tag: "Exists" };
    }

    fd = openSync(
      tmpPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    const buf = Buffer.from(body);
    let offset = 0;
    while (offset < buf.byteLength) {
      const n = writeSync(fd, buf, offset, buf.byteLength - offset);
      offset += n;
    }

    // Owner-only mode through the open temp descriptor (not path-based chmod
    // on the published final path). Hard link preserves this inode mode.
    try {
      fchmodSync(fd, 0o600);
    } catch {
      if (IS_POSIX) {
        closeQuiet(fd);
        fd = undefined;
        cleanupTemp(tmpPath);
        return { _tag: "WriteFailed" };
      }
      // Windows: best-effort mode bits.
    }
    if (IS_POSIX) {
      const openedMode = fstatSync(fd).mode & 0o777;
      if (openedMode !== 0o600) {
        closeQuiet(fd);
        fd = undefined;
        cleanupTemp(tmpPath);
        return { _tag: "WriteFailed" };
      }
    }

    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;

    // Exclusive publish: hard-link then unlink temp. No rename fallback.
    // Do not chmod the final path — the hard-linked inode already carries 0600.
    try {
      if (raceHook?.forceExclusiveLinkCode !== undefined) {
        const err = new Error(
          "forced exclusive link failure",
        ) as NodeJS.ErrnoException;
        err.code = raceHook.forceExclusiveLinkCode;
        throw err;
      }
      linkSync(tmpPath, finalPath);
    } catch (linkErr) {
      cleanupTemp(tmpPath);
      const code = (linkErr as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        return { _tag: "Exists" };
      }
      return { _tag: "WriteFailed" };
    }
    cleanupTemp(tmpPath);

    // Parent-directory open + fsync after publish.
    // POSIX: any failure is WriteFailed.
    // Windows: ignore only the closed unsupported-code set; EIO/EACCES/EPERM
    // and unknown codes are WriteFailed.
    try {
      const forcedCode =
        raceHook?.forceParentDirSyncCode ??
        (raceHook?.forceParentDirSyncFailure === true ? "EIO" : undefined);
      if (forcedCode !== undefined) {
        const err = new Error(
          "forced parent directory sync failure",
        ) as NodeJS.ErrnoException;
        err.code = forcedCode;
        throw err;
      }
      const dirFd = openSync(dir, fsConstants.O_RDONLY);
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch (syncErr) {
      const code = (syncErr as NodeJS.ErrnoException).code;
      if (!isIgnorableParentDirSyncError(code)) {
        return { _tag: "WriteFailed" };
      }
    }
    return { _tag: "Ok" };
  } catch {
    closeQuiet(fd);
    cleanupTemp(tmpPath);
    return { _tag: "WriteFailed" };
  }
}

export const liveCredentialProfileFs: CredentialProfileFsShape = {
  classify: liveClassify,
  identity: liveIdentity,
  modeBits: liveModeBits,
  mkdir: (path, mode) => {
    mkdirSync(path, { mode });
  },
  readFile: liveReadFile,
  writeAuthorityExclusive: liveWriteAuthorityExclusive,
};

export const liveCredentialProfileFsLayer = Layer.succeed(
  CredentialProfileFs,
  liveCredentialProfileFs,
);

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function refuse(
  reason: CredentialProfileRefusalReason,
): CredentialProfileResult {
  return { _tag: "Refused", reason };
}

function isAbsolutePathInput(p: string): boolean {
  return (
    typeof p === "string" &&
    p.length > 0 &&
    !p.includes("\0") &&
    isAbsolute(p)
  );
}

function identitiesEqual(a: PathIdentity, b: PathIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.kind === b.kind;
}

/**
 * Recheck a directory component against a previously captured identity.
 * A component that became a link is `linked_path`; any other change is
 * `identity_changed`. Does not follow links.
 */
function recheckDirIdentity(
  fs: CredentialProfileFsShape,
  path: string,
  expected: PathIdentity,
): CredentialProfileRefusalReason | null {
  const kind = fs.classify(path);
  if (kind === "symlink") return "linked_path";
  if (kind !== "directory") return "identity_changed";
  const id = fs.identity(path);
  if (id === null || id.kind !== "directory") return "identity_changed";
  if (!identitiesEqual(id, expected)) return "identity_changed";
  return null;
}

function captureDirIdentity(
  fs: CredentialProfileFsShape,
  path: string,
):
  | { readonly _tag: "Ok"; readonly identity: PathIdentity }
  | { readonly _tag: "Refused"; readonly reason: CredentialProfileRefusalReason } {
  const kind = fs.classify(path);
  if (kind === "symlink") {
    return { _tag: "Refused", reason: "linked_path" };
  }
  if (kind !== "directory") {
    return { _tag: "Refused", reason: "identity_changed" };
  }
  const id = fs.identity(path);
  if (id === null || id.kind !== "directory") {
    return { _tag: "Refused", reason: "identity_changed" };
  }
  return { _tag: "Ok", identity: id };
}

type LayoutIdentities = {
  readonly stateRoot: PathIdentity;
  readonly profilesRoot: PathIdentity;
  readonly authorityDir: PathIdentity;
  readonly homesDir: PathIdentity;
  readonly vendorHome: PathIdentity;
};

function recheckLayoutIdentities(
  fs: CredentialProfileFsShape,
  paths: {
    readonly stateRoot: string;
    readonly profilesRoot: string;
    readonly authorityDir: string;
    readonly homesDir: string;
    readonly vendorHome: string;
  },
  ids: LayoutIdentities,
): CredentialProfileRefusalReason | null {
  const checks: ReadonlyArray<readonly [string, PathIdentity]> = [
    [paths.stateRoot, ids.stateRoot],
    [paths.profilesRoot, ids.profilesRoot],
    [paths.authorityDir, ids.authorityDir],
    [paths.homesDir, ids.homesDir],
    [paths.vendorHome, ids.vendorHome],
  ];
  for (const [path, expected] of checks) {
    const err = recheckDirIdentity(fs, path, expected);
    if (err !== null) return err;
  }
  return null;
}

/**
 * Dual containment gate: normalized logical paths and realpath-resolved
 * physical paths. Both must keep `stateRoot` outside `worktreeRoot`.
 *
 * - Logical: a path such as `<worktree>/link/state` is refused even when
 *   `link` targets an external directory.
 * - Physical: a linked ancestor that places the same state-root inode inside
 *   the worktree is refused even when logical path strings look external.
 */
function recheckContainment(
  stateRoot: string,
  worktreeRoot: string,
): CredentialProfileRefusalReason | null {
  // 1. Normalized logical containment (no symlink follow).
  if (isEqualOrDescendant(stateRoot, worktreeRoot)) {
    return "state_root_in_worktree";
  }
  // 2. Physical containment via realpath (linked-ancestor test).
  const physicalState = physicalDirPath(stateRoot);
  if (physicalState === null) return "invalid_state_root";
  const physicalWorktree = physicalDirPath(worktreeRoot);
  if (physicalWorktree === null) return "invalid_arguments";
  if (isEqualOrDescendant(physicalState, physicalWorktree)) {
    return "state_root_in_worktree";
  }
  return null;
}

/**
 * Gate used before every authority read, before publication, and before
 * success: logical + physical containment first, then layout directory
 * identities.
 */
function recheckBeforeAuthorityGate(
  fs: CredentialProfileFsShape,
  paths: {
    readonly stateRoot: string;
    readonly profilesRoot: string;
    readonly authorityDir: string;
    readonly homesDir: string;
    readonly vendorHome: string;
  },
  ids: LayoutIdentities,
  worktreeRoot: string,
): CredentialProfileRefusalReason | null {
  const contain = recheckContainment(paths.stateRoot, worktreeRoot);
  if (contain !== null) return contain;
  return recheckLayoutIdentities(fs, paths, ids);
}

/**
 * On POSIX, require layout directories `0700` and authority file `0600` before
 * returning Ready (or Initialized). Refuse an unsafe existing profile; do not
 * silently accept group/other bits. Windows is best-effort (no refusal).
 */
function verifySafeProfileModes(
  fs: CredentialProfileFsShape,
  layoutDirs: readonly string[],
  authorityFile: string,
): CredentialProfileRefusalReason | null {
  if (!IS_POSIX) return null;
  for (const dir of layoutDirs) {
    const bits = fs.modeBits(dir);
    if (bits === null) return "unreadable";
    if (bits !== 0o700) return "authority_invalid";
  }
  const fileBits = fs.modeBits(authorityFile);
  if (fileBits === null) return "unreadable";
  if (fileBits !== 0o600) return "authority_invalid";
  return null;
}

type ValidatedInput = {
  readonly stateRoot: string;
  readonly worktreeRoot: string;
  readonly profileId: string;
  readonly vendor: CredentialVendor;
  readonly expected: CredentialProfileRecordV1;
  readonly stateRootIdentity: PathIdentity;
};

/**
 * Resolve the physical directory path via realpath. Used only for
 * containment admission so a linked ancestor cannot place state inside the
 * worktree while logical path strings look external.
 */
function physicalDirPath(absolutePath: string): string | null {
  try {
    const real = realpathSync(absolutePath);
    return normalizeAbsolutePath(real);
  } catch {
    return null;
  }
}

function validateInputs(
  input: CredentialProfileInput,
  fs: CredentialProfileFsShape,
):
  | { readonly _tag: "Ok"; readonly value: ValidatedInput }
  | { readonly _tag: "Refused"; readonly result: CredentialProfileResult } {
  // Absolute-input checks are separate: state root uses invalid_state_root;
  // worktree uses invalid_arguments. Do not fold both into one condition.
  if (!isAbsolutePathInput(input.stateRoot)) {
    return { _tag: "Refused", result: refuse("invalid_state_root") };
  }
  if (!isAbsolutePathInput(input.worktreeRoot)) {
    return { _tag: "Refused", result: refuse("invalid_arguments") };
  }
  if (typeof input.profileId !== "string" || !isValidProfileId(input.profileId)) {
    return { _tag: "Refused", result: refuse("invalid_profile_id") };
  }
  if (!isCredentialVendor(input.vendor)) {
    return { _tag: "Refused", result: refuse("invalid_arguments") };
  }

  const stateRoot = normalizeAbsolutePath(input.stateRoot);
  const worktreeRoot = normalizeAbsolutePath(input.worktreeRoot);

  // Single identity capture for state root (no duplicated absolute-input
  // re-check). Final component must be a real directory, not a link.
  const stateId = fs.identity(stateRoot);
  if (stateId === null) {
    return { _tag: "Refused", result: refuse("invalid_state_root") };
  }
  if (stateId.kind === "symlink") {
    return { _tag: "Refused", result: refuse("linked_path") };
  }
  if (stateId.kind !== "directory") {
    return { _tag: "Refused", result: refuse("invalid_state_root") };
  }

  // Logical + physical containment before admission.
  {
    const contain = recheckContainment(stateRoot, worktreeRoot);
    if (contain !== null) {
      return { _tag: "Refused", result: refuse(contain) };
    }
  }

  raceHook?.afterValidateStateRoot?.();

  // Detect identity change of state root after hook.
  const stateId2 = fs.identity(stateRoot);
  if (
    stateId2 === null ||
    stateId2.kind !== "directory" ||
    !identitiesEqual(stateId, stateId2)
  ) {
    return { _tag: "Refused", result: refuse("identity_changed") };
  }

  return {
    _tag: "Ok",
    value: {
      stateRoot,
      worktreeRoot,
      profileId: input.profileId,
      vendor: input.vendor,
      expected: makeCredentialProfileRecord(input.profileId, input.vendor),
      stateRootIdentity: stateId2,
    },
  };
}

/**
 * Refuse when a layout path is a symbolic link / junction. Missing is ok
 * when `allowMissing` is true. Non-directory when a directory is required
 * maps to authority_invalid.
 */
function checkComponent(
  fs: CredentialProfileFsShape,
  path: string,
  opts: { readonly expect: "dir" | "file"; readonly allowMissing: boolean },
): CredentialProfileRefusalReason | null {
  const kind = fs.classify(path);
  if (kind === "missing") {
    return opts.allowMissing ? null : "authority_missing";
  }
  if (kind === "symlink") return "linked_path";
  if (opts.expect === "dir") {
    if (kind === "file" || kind === "other") return "authority_invalid";
    return null;
  }
  // expect file
  if (kind === "directory" || kind === "other") return "authority_invalid";
  return null;
}

/**
 * Verify an existing layout directory is 0700 on POSIX. Does not chmod to
 * "fix" an unsafe profile — refuse with authority_invalid.
 */
function verifyExistingDirMode(
  fs: CredentialProfileFsShape,
  path: string,
): CredentialProfileRefusalReason | null {
  if (!IS_POSIX) return null;
  const bits = fs.modeBits(path);
  if (bits === null) return "unreadable";
  if (bits !== 0o700) return "authority_invalid";
  return null;
}

/**
 * After a layout mkdir loses a concurrent-create race (`EEXIST`), reclassify
 * the exact path. Continue only for a non-linked directory with safe POSIX
 * `0700`. Refuse a link, file, other kind, unsafe mode, or other mkdir error.
 */
function reclassifyAfterMkdirRace(
  fs: CredentialProfileFsShape,
  path: string,
): CredentialProfileRefusalReason | null {
  const raced = fs.classify(path);
  if (raced === "symlink") return "linked_path";
  if (raced === "file" || raced === "other") return "authority_invalid";
  if (raced === "directory") {
    return verifyExistingDirMode(fs, path);
  }
  // Missing after EEXIST is inconsistent with the race.
  return "write_failed";
}

/**
 * Ensure one layout directory component.
 *
 * - Existing directory: verify `0700` on POSIX and refuse if unsafe. Never
 *   path-based chmod an existing layout directory.
 * - Missing: create non-recursively with mode `0700`, then lstat and verify.
 *   Never path-based chmod after create (umask-stripped modes are write_failed).
 * - Concurrent create (`EEXIST`): reclassify the exact path and continue only
 *   when it is a non-linked directory with safe `0700` POSIX mode.
 * Parents must already exist; callers walk the layout top-down.
 */
function ensureOwnerDir(
  fs: CredentialProfileFsShape,
  path: string,
): CredentialProfileRefusalReason | null {
  const kind = fs.classify(path);
  if (kind === "symlink") return "linked_path";
  if (kind === "file" || kind === "other") return "authority_invalid";
  if (kind === "directory") {
    return verifyExistingDirMode(fs, path);
  }
  // Missing: non-recursive create with owner-only mode.
  try {
    fs.mkdir(path, 0o700);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return reclassifyAfterMkdirRace(fs, path);
    }
    return "write_failed";
  }
  const after = fs.classify(path);
  if (after === "symlink") return "linked_path";
  if (after !== "directory") return "write_failed";
  // Verify mode without path-based chmod. Windows is best-effort.
  if (!IS_POSIX) return null;
  const bits = fs.modeBits(path);
  if (bits === null) return "unreadable";
  if (bits !== 0o700) return "write_failed";
  return null;
}

/**
 * Recheck that `authorityFile` still names the same non-linked regular file
 * that supplied the decoded authority bytes. A same-mode replacement after
 * read must refuse `identity_changed` rather than return stale bytes.
 */
function recheckAuthorityFileIdentity(
  fs: CredentialProfileFsShape,
  authorityFile: string,
  expected: PathIdentity,
): CredentialProfileRefusalReason | null {
  const kind = fs.classify(authorityFile);
  if (kind === "symlink") return "linked_path";
  if (kind === "missing") return "identity_changed";
  if (kind !== "file") return "identity_changed";
  const id = fs.identity(authorityFile);
  if (id === null || id.kind !== "file") return "identity_changed";
  if (!identitiesEqual(id, expected)) return "identity_changed";
  return null;
}

/**
 * Last filesystem gates before Ready/Initialized: verify safe modes, then
 * recheck logical + physical containment and layout identities, then recheck
 * that profile.json still names the authority inode that supplied the bytes.
 * A race that retargets a linked ancestor or replaces the authority file
 * after mode verification must still be refused.
 */
function finalSuccessFilesystemGate(
  fs: CredentialProfileFsShape,
  paths: {
    readonly stateRoot: string;
    readonly profilesRoot: string;
    readonly authorityDir: string;
    readonly homesDir: string;
    readonly vendorHome: string;
  },
  ids: LayoutIdentities,
  worktreeRoot: string,
  layoutDirs: readonly string[],
  authorityFile: string,
  authorityIdentity: PathIdentity,
): CredentialProfileRefusalReason | null {
  const modeErr = verifySafeProfileModes(fs, layoutDirs, authorityFile);
  if (modeErr !== null) return modeErr;
  raceHook?.afterSafeModeVerify?.();
  const gate = recheckBeforeAuthorityGate(fs, paths, ids, worktreeRoot);
  if (gate !== null) return gate;
  return recheckAuthorityFileIdentity(fs, authorityFile, authorityIdentity);
}

function successResult(
  tag: "Ready" | "Initialized",
  stateRoot: string,
  record: CredentialProfileRecordV1,
): CredentialProfileResult {
  const configRoot = absoluteConfigRoot(
    stateRoot,
    record.profileId,
    record.configRootRel,
  );
  return {
    _tag: tag,
    profileId: record.profileId,
    vendor: record.vendor,
    configRoot,
    profileIdentity: profileIdentityOf(record),
  };
}

function readAuthority(
  fs: CredentialProfileFsShape,
  jsonPath: string,
):
  | {
      readonly _tag: "Ok";
      readonly record: CredentialProfileRecordV1;
      /** Non-linked regular-file identity that supplied the decoded bytes. */
      readonly identity: PathIdentity;
    }
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Refused"; readonly reason: CredentialProfileRefusalReason } {
  const kind = fs.classify(jsonPath);
  if (kind === "missing") return { _tag: "Absent" };
  if (kind === "symlink") {
    return { _tag: "Refused", reason: "linked_path" };
  }
  if (kind !== "file") {
    return { _tag: "Refused", reason: "authority_invalid" };
  }

  const before = fs.identity(jsonPath);
  raceHook?.afterReadAuthority?.();
  const after = fs.identity(jsonPath);
  if (
    before === null ||
    after === null ||
    before.kind !== "file" ||
    after.kind !== "file" ||
    before.dev !== after.dev ||
    before.ino !== after.ino
  ) {
    return { _tag: "Refused", reason: "identity_changed" };
  }

  const read = fs.readFile(jsonPath, MAX_CREDENTIAL_PROFILE_RECORD_BYTES);
  switch (read._tag) {
    case "Absent":
      return { _tag: "Absent" };
    case "Linked":
      return { _tag: "Refused", reason: "linked_path" };
    case "NotFile":
    case "Oversized":
      return { _tag: "Refused", reason: "authority_invalid" };
    case "Unreadable":
      return { _tag: "Refused", reason: "unreadable" };
    case "Ok":
      break;
    default: {
      const _e: never = read;
      return { _tag: "Refused", reason: "unreadable" };
    }
  }

  const parsed = parseCredentialProfileRecordBytes(read.bytes);
  if (parsed._tag === "Fail") {
    return { _tag: "Refused", reason: parsed.reason };
  }

  // Carry the fstat identity from the same open descriptor that supplied the
  // decoded bytes. Do not replace it with a pathname identity after close.
  if (read.identity.kind !== "file") {
    return { _tag: "Refused", reason: "identity_changed" };
  }
  // Pre-read path identity must agree with the descriptor that was opened.
  if (!identitiesEqual(read.identity, after)) {
    return { _tag: "Refused", reason: "identity_changed" };
  }
  return { _tag: "Ok", record: parsed.record, identity: read.identity };
}

// ---------------------------------------------------------------------------
// init / resolve
// ---------------------------------------------------------------------------

function initProfileSync(
  input: CredentialProfileInput,
  fs: CredentialProfileFsShape,
): CredentialProfileResult {
  const v = validateInputs(input, fs);
  if (v._tag === "Refused") return v.result;
  const {
    stateRoot,
    worktreeRoot,
    profileId,
    vendor,
    expected,
    stateRootIdentity,
  } = v.value;

  const profilesRoot = join(stateRoot, PROFILES_DIR_NAME);
  const authorityDir = profileAuthorityDir(stateRoot, profileId);
  const homesDir = profileHomesDir(stateRoot, profileId);
  const vendorHome = profileVendorHomeDir(stateRoot, profileId, vendor);
  const jsonPath = profileJsonPath(stateRoot, profileId);
  const layoutPaths = {
    stateRoot,
    profilesRoot,
    authorityDir,
    homesDir,
    vendorHome,
  };
  const layoutDirList = [profilesRoot, authorityDir, homesDir, vendorHome] as const;

  // Intermediate layout components: refuse links / non-dirs.
  for (const p of [profilesRoot, authorityDir, homesDir]) {
    const err = checkComponent(fs, p, { expect: "dir", allowMissing: true });
    if (err !== null) return refuse(err);
  }
  {
    const err = checkComponent(fs, jsonPath, {
      expect: "file",
      allowMissing: true,
    });
    if (err !== null) return refuse(err);
  }

  // Ensure directories (owner-only where supported). Create only the
  // selected vendor home; the other vendor home need not exist.
  for (const p of layoutDirList) {
    const err = ensureOwnerDir(fs, p);
    if (err !== null) return refuse(err);
  }

  // Capture identities of the created layout (and re-bound state root).
  const captured: Partial<Record<keyof LayoutIdentities, PathIdentity>> = {
    stateRoot: stateRootIdentity,
  };
  for (const key of [
    "profilesRoot",
    "authorityDir",
    "homesDir",
    "vendorHome",
  ] as const) {
    const cap = captureDirIdentity(fs, layoutPaths[key]);
    if (cap._tag === "Refused") return refuse(cap.reason);
    captured[key] = cap.identity;
  }
  const layoutIds = captured as LayoutIdentities;

  raceHook?.afterEnsureDirs?.();

  // Recheck physical containment + every tracked identity after ensure hook.
  {
    const err = recheckBeforeAuthorityGate(
      fs,
      layoutPaths,
      layoutIds,
      worktreeRoot,
    );
    if (err !== null) return refuse(err);
  }

  // Existing authority: exact match → Ready; conflict → refuse (no write).
  // Recheck containment + identities immediately before the authority read.
  {
    const err = recheckBeforeAuthorityGate(
      fs,
      layoutPaths,
      layoutIds,
      worktreeRoot,
    );
    if (err !== null) return refuse(err);
  }
  const existing = readAuthority(fs, jsonPath);
  if (existing._tag === "Refused") {
    return refuse(existing.reason);
  }
  if (existing._tag === "Ok") {
    if (!recordsEqualExact(existing.record, expected)) {
      return refuse("authority_conflict");
    }
    // Safe modes, containment, layout, then authority-file identity gate.
    {
      const err = finalSuccessFilesystemGate(
        fs,
        layoutPaths,
        layoutIds,
        worktreeRoot,
        layoutDirList,
        jsonPath,
        existing.identity,
      );
      if (err !== null) return refuse(err);
    }
    return successResult("Ready", stateRoot, existing.record);
  }

  // Absent: exclusive write. Recheck containment + identities before publish.
  {
    const err = recheckBeforeAuthorityGate(
      fs,
      layoutPaths,
      layoutIds,
      worktreeRoot,
    );
    if (err !== null) return refuse(err);
  }
  const body = Buffer.from(renderCredentialProfileRecordFile(expected), "utf8");
  if (body.byteLength > MAX_CREDENTIAL_PROFILE_RECORD_BYTES) {
    return refuse("write_failed");
  }

  const written = fs.writeAuthorityExclusive(jsonPath, body);
  if (written._tag === "WriteFailed") {
    return refuse("write_failed");
  }

  raceHook?.afterWrite?.();

  // Recheck containment + identities before post-write authority read.
  {
    const err = recheckBeforeAuthorityGate(
      fs,
      layoutPaths,
      layoutIds,
      worktreeRoot,
    );
    if (err !== null) return refuse(err);
  }

  // Exists race or successful write: re-read and classify.
  const after = readAuthority(fs, jsonPath);
  if (after._tag === "Refused") return refuse(after.reason);
  if (after._tag === "Absent") return refuse("write_failed");
  if (!recordsEqualExact(after.record, expected)) {
    return refuse("authority_conflict");
  }
  // Safe modes, containment, layout, then authority-file identity gate.
  {
    const err = finalSuccessFilesystemGate(
      fs,
      layoutPaths,
      layoutIds,
      worktreeRoot,
      layoutDirList,
      jsonPath,
      after.identity,
    );
    if (err !== null) return refuse(err);
  }
  if (written._tag === "Exists") {
    // Another initializer published the exact same record.
    return successResult("Ready", stateRoot, after.record);
  }
  return successResult("Initialized", stateRoot, after.record);
}

function resolveProfileSync(
  input: CredentialProfileInput,
  fs: CredentialProfileFsShape,
): CredentialProfileResult {
  const v = validateInputs(input, fs);
  if (v._tag === "Refused") return v.result;
  const {
    stateRoot,
    worktreeRoot,
    profileId,
    vendor,
    expected,
    stateRootIdentity,
  } = v.value;

  const profilesRoot = join(stateRoot, PROFILES_DIR_NAME);
  const authorityDir = profileAuthorityDir(stateRoot, profileId);
  const homesDir = profileHomesDir(stateRoot, profileId);
  const vendorHome = profileVendorHomeDir(stateRoot, profileId, vendor);
  const jsonPath = profileJsonPath(stateRoot, profileId);
  const layoutPaths = {
    stateRoot,
    profilesRoot,
    authorityDir,
    homesDir,
    vendorHome,
  };
  const layoutDirList = [profilesRoot, authorityDir, homesDir, vendorHome] as const;

  for (const p of [profilesRoot, authorityDir]) {
    const err = checkComponent(fs, p, { expect: "dir", allowMissing: false });
    if (err !== null) {
      return refuse(err === "authority_missing" ? "authority_missing" : err);
    }
  }
  {
    const err = checkComponent(fs, jsonPath, {
      expect: "file",
      allowMissing: false,
    });
    if (err !== null) return refuse(err);
  }
  // homes and vendor home must exist and not be linked for resolve readiness.
  for (const p of [homesDir, vendorHome]) {
    const err = checkComponent(fs, p, { expect: "dir", allowMissing: false });
    if (err !== null) return refuse(err);
  }

  // Capture and recheck layout identities + physical containment before read.
  const captured: Partial<Record<keyof LayoutIdentities, PathIdentity>> = {
    stateRoot: stateRootIdentity,
  };
  for (const key of [
    "profilesRoot",
    "authorityDir",
    "homesDir",
    "vendorHome",
  ] as const) {
    const cap = captureDirIdentity(fs, layoutPaths[key]);
    if (cap._tag === "Refused") return refuse(cap.reason);
    captured[key] = cap.identity;
  }
  const layoutIds = captured as LayoutIdentities;
  {
    const err = recheckBeforeAuthorityGate(
      fs,
      layoutPaths,
      layoutIds,
      worktreeRoot,
    );
    if (err !== null) return refuse(err);
  }

  const existing = readAuthority(fs, jsonPath);
  if (existing._tag === "Refused") return refuse(existing.reason);
  if (existing._tag === "Absent") return refuse("authority_missing");
  if (!recordsEqualExact(existing.record, expected)) {
    // Wrong vendor or relative root → conflict; wrong decode already invalid.
    return refuse("authority_conflict");
  }
  // Safe modes, containment, layout, then authority-file identity gate.
  {
    const err = finalSuccessFilesystemGate(
      fs,
      layoutPaths,
      layoutIds,
      worktreeRoot,
      layoutDirList,
      jsonPath,
      existing.identity,
    );
    if (err !== null) return refuse(err);
  }
  return successResult("Ready", stateRoot, existing.record);
}

/**
 * Initialize a credential profile under the external state root. Idempotent
 * for an exact existing record. Never overwrites a conflicting record.
 */
export function initProfile(
  input: CredentialProfileInput,
): Effect.Effect<CredentialProfileResult, never, CredentialProfileFs> {
  return Effect.gen(function* () {
    const fs = yield* CredentialProfileFs;
    return initProfileSync(input, fs);
  });
}

/**
 * Resolve an existing credential profile. Returns Ready only when authority
 * matches the requested profile id and vendor.
 */
export function resolveProfile(
  input: CredentialProfileInput,
): Effect.Effect<CredentialProfileResult, never, CredentialProfileFs> {
  return Effect.gen(function* () {
    const fs = yield* CredentialProfileFs;
    return resolveProfileSync(input, fs);
  });
}

export const liveCredentialProfile = liveCredentialProfileFsLayer;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Strip node binary and script path from process.argv-style input.
 */
export function stripCredentialProfileNodeArgv(
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
      args[0]!.includes("credential-profile"))
  ) {
    args = args.slice(1);
  }
  return args;
}

const FLAG_ORDER = [
  "--state-root",
  "--worktree",
  "--profile",
  "--vendor",
] as const;

/**
 * Fixed-order argv parse. Rejects duplicate, missing, unknown, or reordered
 * flag pairs. Command must be `init` or `resolve`.
 */
export function parseCredentialProfileArgv(
  argv: readonly string[],
): ParsedCredentialProfileArgv {
  const args = stripCredentialProfileNodeArgv(argv);
  if (args.length === 0) return { _tag: "Invalid" };
  const command = args[0];
  if (command !== "init" && command !== "resolve") {
    return { _tag: "Invalid" };
  }
  let i = 1;
  const values: string[] = [];
  for (const opt of FLAG_ORDER) {
    if (i >= args.length || args[i] !== opt) {
      return { _tag: "Invalid" };
    }
    i += 1;
    if (i >= args.length) return { _tag: "Invalid" };
    const v = args[i]!;
    // Empty value is invalid for every flag.
    if (v.length === 0) return { _tag: "Invalid" };
    // A flag token where a value is required is invalid.
    if (v.startsWith("--")) return { _tag: "Invalid" };
    values.push(v);
    i += 1;
  }
  if (i !== args.length) return { _tag: "Invalid" };

  const vendorRaw = values[3]!;
  if (!isCredentialVendor(vendorRaw)) return { _tag: "Invalid" };

  return {
    _tag: "Ok",
    command,
    stateRoot: values[0]!,
    worktreeRoot: values[1]!,
    profileId: values[2]!,
    vendor: vendorRaw,
  };
}

/**
 * Run the credential-profile CLI. Emits exactly one canonical JSON line.
 * Exit 0 only for Ready or Initialized. Failures never include paths,
 * stacks, exception text, record bytes, environment values, or credentials.
 */
export function runCredentialProfileCli(
  argv: readonly string[],
  io: CredentialProfileCliIo,
): Effect.Effect<number, never, CredentialProfileFs> {
  return Effect.gen(function* () {
    const parsed = parseCredentialProfileArgv(argv);
    if (parsed._tag === "Invalid") {
      const refused: CredentialProfileResult = {
        _tag: "Refused",
        reason: "invalid_arguments",
      };
      io.writeStdout(renderCredentialProfileJson(refused) + "\n");
      return EXIT_REFUSED;
    }
    const input: CredentialProfileInput = {
      stateRoot: parsed.stateRoot,
      worktreeRoot: parsed.worktreeRoot,
      profileId: parsed.profileId,
      vendor: parsed.vendor,
    };
    const result =
      parsed.command === "init"
        ? yield* initProfile(input)
        : yield* resolveProfile(input);
    io.writeStdout(renderCredentialProfileJson(result) + "\n");
    if (result._tag === "Ready" || result._tag === "Initialized") {
      return EXIT_OK;
    }
    return EXIT_REFUSED;
  });
}

/**
 * Write all of `text` to a stream, settling once from the write callback.
 * Same contract as secret-scan writeFully for backpressured stdout.
 */
export type CredentialProfileWriteStream = {
  write(chunk: string, cb?: (err?: Error | null) => void): boolean;
  once(event: "error", listener: (err: Error) => void): unknown;
  off(event: "error", listener: (err: Error) => void): unknown;
};

export function writeFully(
  stream: CredentialProfileWriteStream,
  text: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const onError = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    stream.once("error", onError);
    const ok = stream.write(text, (err) => {
      if (settled) return;
      if (err) {
        // Keep listener armed so a subsequent stream error is consumed.
        settled = true;
        reject(err);
        return;
      }
      settled = true;
      stream.off("error", onError);
      resolvePromise();
    });
    if (ok === false) {
      /* backpressure: callback still fires */
    }
  });
}
