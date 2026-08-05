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
  chmodSync,
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
import { dirname, isAbsolute, join } from "node:path";
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
  profileAuthorityDir,
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
 */
export function buildVendorHomeChildEnv(
  processEnv: NodeJS.ProcessEnv,
  vendor: CredentialVendor,
  configRoot: string,
): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = { ...processEnv };
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

function identitiesEqual(
  a: { dev: number; ino: number },
  b: { dev: number; ino: number },
): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/**
 * Bounded no-follow descriptor read. Never follows a final-component link.
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
 * Atomic owner-only write: same-directory temp, fsync, rename, parent fsync
 * where supported under the closed Windows allowlist. Cleans up the temp file
 * on any failure.
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

      const dir = dirname(absolutePath);
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        if (IS_POSIX) {
          // Best-effort owner-only parent; authority layout is gated by R7A.
          try {
            chmodSync(dir, 0o700);
          } catch {
            /* ignore */
          }
        }
      } catch {
        throw new ProfilePreflightStoreFailure("write_failed");
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

      const tmpName = `.preflight.${randomBytes(16).toString("hex")}.tmp`;
      const tmpPath = join(dir, tmpName);
      let fd: number | undefined;
      try {
        fd = openSync(
          tmpPath,
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
          0o600,
        );
        const buf = Buffer.from(body, "utf8");
        let offset = 0;
        while (offset < buf.byteLength) {
          const n = writeSync(fd, buf, offset, buf.byteLength - offset);
          offset += n;
        }

        try {
          fchmodSync(fd, 0o600);
        } catch {
          if (IS_POSIX) {
            closeQuiet(fd);
            fd = undefined;
            cleanupTemp(tmpPath);
            throw new ProfilePreflightStoreFailure("write_failed");
          }
        }
        if (IS_POSIX) {
          const mode = fstatSync(fd).mode & 0o777;
          if (mode !== 0o600) {
            closeQuiet(fd);
            fd = undefined;
            cleanupTemp(tmpPath);
            throw new ProfilePreflightStoreFailure("write_failed");
          }
        }

        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;

        renameSync(tmpPath, absolutePath);

        // Parent-directory open + fsync after publish.
        try {
          const dirFd = openSync(dir, fsConstants.O_RDONLY);
          try {
            fsyncSync(dirFd);
          } finally {
            closeSync(dirFd);
          }
        } catch (syncErr) {
          const code = (syncErr as NodeJS.ErrnoException).code;
          if (!isIgnorableParentDirSyncError(code)) {
            throw new ProfilePreflightStoreFailure("write_failed");
          }
        }
      } catch (e) {
        closeQuiet(fd);
        cleanupTemp(tmpPath);
        if (e instanceof ProfilePreflightStoreFailure) throw e;
        throw new ProfilePreflightStoreFailure("write_failed");
      }
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
