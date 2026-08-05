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
  chmodSync,
  closeSync,
  constants as fsConstants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
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
  | "invalid_arguments"
  | "invalid_profile_id"
  | "invalid_state_root"
  | "state_root_in_worktree"
  | "authority_missing"
  | "authority_invalid"
  | "authority_conflict"
  | "linked_path"
  | "identity_changed"
  | "unreadable"
  | "write_failed";

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
 * Normalize an absolute path for comparison: resolve `.`/`..` and strip one
 * trailing separator (except root). Does not follow symbolic links.
 */
export function normalizeAbsolutePath(input: string): string {
  let n = pathResolve(input);
  if (n.length > 1 && (n.endsWith("/") || n.endsWith("\\"))) {
    n = n.slice(0, -1);
  }
  return n;
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

export function isCredentialProfileResult(
  v: unknown,
): v is CredentialProfileResult {
  if (typeof v !== "object" || v === null) return false;
  const tag = (v as { _tag?: unknown })._tag;
  if (tag === "Ready" || tag === "Initialized") {
    const r = v as {
      profileId?: unknown;
      vendor?: unknown;
      configRoot?: unknown;
      profileIdentity?: unknown;
    };
    return (
      typeof r.profileId === "string" &&
      isCredentialVendor(r.vendor) &&
      typeof r.configRoot === "string" &&
      typeof r.profileIdentity === "string" &&
      /^[0-9a-f]{64}$/.test(r.profileIdentity)
    );
  }
  if (tag === "Refused") {
    const reason = (v as { reason?: unknown }).reason;
    return (
      typeof reason === "string" &&
      (
        [
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
        ] as readonly string[]
      ).includes(reason)
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
  /** Create one directory (non-recursive). Mode 0o700 when supported. */
  readonly mkdir: (path: string, mode: number) => void;
  /** Create directories recursively. Mode 0o700 when supported. */
  readonly mkdirp: (path: string, mode: number) => void;
  /** Best-effort chmod. */
  readonly chmod: (path: string, mode: number) => void;
  /**
   * Read up to maxBytes from a regular non-linked file. Returns null on
   * missing; throws typed errors via return tags.
   */
  readonly readFile: (
    path: string,
    maxBytes: number,
  ) =>
    | { readonly _tag: "Ok"; readonly bytes: Buffer }
    | { readonly _tag: "Absent" }
    | { readonly _tag: "Oversized" }
    | { readonly _tag: "Linked" }
    | { readonly _tag: "NotFile" }
    | { readonly _tag: "Unreadable" };
  /**
   * Atomic exclusive publish of authority bytes: temp write + fsync +
   * exclusive hard-link publish + parent fsync. Never renames over a
   * final path (no check-then-rename race).
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
};

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

function liveReadFile(
  path: string,
  maxBytes: number,
): ReturnType<CredentialProfileFsShape["readFile"]> {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) return { _tag: "Linked" };
    if (!st.isFile()) return { _tag: "NotFile" };
    if (st.size > maxBytes) return { _tag: "Oversized" };
    const bytes = readFileSync(path);
    if (bytes.byteLength > maxBytes) return { _tag: "Oversized" };
    // Identity recheck
    const after = lstatSync(path);
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      after.dev !== st.dev ||
      after.ino !== st.ino ||
      after.size !== st.size
    ) {
      return { _tag: "Unreadable" };
    }
    return { _tag: "Ok", bytes };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return { _tag: "Absent" };
    return { _tag: "Unreadable" };
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
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      /* platform may ignore mode */
    }

    // Exclusive publish: hard-link then unlink temp. No rename fallback.
    try {
      if (raceHook?.forceExclusiveLinkCode !== undefined) {
        const err = new Error("forced exclusive link failure") as NodeJS.ErrnoException;
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
    try {
      chmodSync(finalPath, 0o600);
    } catch {
      /* best-effort */
    }
    try {
      const dirFd = openSync(dir, fsConstants.O_RDONLY);
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      /* parent fsync best-effort */
    }
    return { _tag: "Ok" };
  } catch {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    cleanupTemp(tmpPath);
    return { _tag: "WriteFailed" };
  }
}

export const liveCredentialProfileFs: CredentialProfileFsShape = {
  classify: liveClassify,
  identity: liveIdentity,
  mkdir: (path, mode) => {
    mkdirSync(path, { mode });
  },
  mkdirp: (path, mode) => {
    mkdirSync(path, { recursive: true, mode });
  },
  chmod: (path, mode) => {
    chmodSync(path, mode);
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

type ValidatedInput = {
  readonly stateRoot: string;
  readonly worktreeRoot: string;
  readonly profileId: string;
  readonly vendor: CredentialVendor;
  readonly expected: CredentialProfileRecordV1;
  readonly stateRootIdentity: PathIdentity;
};

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

  if (isEqualOrDescendant(stateRoot, worktreeRoot)) {
    return { _tag: "Refused", result: refuse("state_root_in_worktree") };
  }

  // Single identity capture for state root (no separate classify-then-identity
  // pair that re-states the same directory check).
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

function ensureOwnerDir(
  fs: CredentialProfileFsShape,
  path: string,
): CredentialProfileRefusalReason | null {
  const kind = fs.classify(path);
  if (kind === "symlink") return "linked_path";
  if (kind === "file" || kind === "other") return "authority_invalid";
  if (kind === "directory") {
    try {
      fs.chmod(path, 0o700);
    } catch {
      /* best-effort */
    }
    return null;
  }
  try {
    fs.mkdirp(path, 0o700);
    fs.chmod(path, 0o700);
  } catch {
    return "write_failed";
  }
  const after = fs.classify(path);
  if (after === "symlink") return "linked_path";
  if (after !== "directory") return "write_failed";
  return null;
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
  | { readonly _tag: "Ok"; readonly record: CredentialProfileRecordV1 }
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
  return { _tag: "Ok", record: parsed.record };
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
  const { stateRoot, profileId, vendor, expected, stateRootIdentity } = v.value;

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
  for (const p of [profilesRoot, authorityDir, homesDir, vendorHome]) {
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

  // Recheck every tracked identity after the ensure hook (refuse link swap).
  {
    const err = recheckLayoutIdentities(fs, layoutPaths, layoutIds);
    if (err !== null) return refuse(err);
  }

  // Existing authority: exact match → Ready; conflict → refuse (no write).
  // Recheck identities immediately before the authority read.
  {
    const err = recheckLayoutIdentities(fs, layoutPaths, layoutIds);
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
    // Recheck identities before success.
    {
      const err = recheckLayoutIdentities(fs, layoutPaths, layoutIds);
      if (err !== null) return refuse(err);
    }
    return successResult("Ready", stateRoot, existing.record);
  }

  // Absent: exclusive write. Recheck identities before publish.
  {
    const err = recheckLayoutIdentities(fs, layoutPaths, layoutIds);
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

  // Recheck identities before post-write authority read.
  {
    const err = recheckLayoutIdentities(fs, layoutPaths, layoutIds);
    if (err !== null) return refuse(err);
  }

  // Exists race or successful write: re-read and classify.
  const after = readAuthority(fs, jsonPath);
  if (after._tag === "Refused") return refuse(after.reason);
  if (after._tag === "Absent") return refuse("write_failed");
  if (!recordsEqualExact(after.record, expected)) {
    return refuse("authority_conflict");
  }
  // Recheck identities before success.
  {
    const err = recheckLayoutIdentities(fs, layoutPaths, layoutIds);
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
  const { stateRoot, profileId, vendor, expected, stateRootIdentity } = v.value;

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

  // Capture and recheck layout identities before authority read.
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
    const err = recheckLayoutIdentities(fs, layoutPaths, layoutIds);
    if (err !== null) return refuse(err);
  }

  const existing = readAuthority(fs, jsonPath);
  if (existing._tag === "Refused") return refuse(existing.reason);
  if (existing._tag === "Absent") return refuse("authority_missing");
  if (!recordsEqualExact(existing.record, expected)) {
    // Wrong vendor or relative root → conflict; wrong decode already invalid.
    return refuse("authority_conflict");
  }
  {
    const err = recheckLayoutIdentities(fs, layoutPaths, layoutIds);
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

