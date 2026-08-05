/**
 * Bounded fixture-aware Grok worktree secret scan (Sprint 3 R6 / CW-027).
 *
 * Live scanner accepts one preflighted absolute worktree root, never follows
 * symlinks, never leaves the root, prunes top-level `.git/` and `.harness/`,
 * refuses secret filename classes and PEM private-key headers, and applies
 * explicit positive bounds. Fixture exemptions are exact path+SHA-256 identity
 * under `tests/fixtures/` only.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  type Dirent,
  type Stats,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
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

function toPosixRel(root: string, absPath: string): string {
  const rel = relative(root, absPath);
  return rel.split(sep).join("/");
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

// ---------------------------------------------------------------------------
// Fixture declaration
// ---------------------------------------------------------------------------

type FixtureLoad =
  | { readonly _tag: "Ok"; readonly map: ExemptionMap }
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Malformed" }
  | { readonly _tag: "Unreadable" }
  | { readonly _tag: "Bound" };

function loadFixtureDeclaration(
  root: string,
  bounds: SecretScanBounds,
): FixtureLoad {
  const abs = join(root, ...FIXTURE_DECLARATION_RELPATH.split("/"));
  let st: Stats;
  try {
    st = lstatSync(abs);
  } catch (e) {
    if (isNotFound(e)) return { _tag: "Absent" };
    return { _tag: "Unreadable" };
  }
  if (st.isSymbolicLink()) return { _tag: "Malformed" };
  if (!st.isFile()) return { _tag: "Malformed" };
  if (st.size > bounds.maxFixtureDeclarationBytes) return { _tag: "Bound" };

  const read = readRegularFileBytes(abs, st, bounds.maxFixtureDeclarationBytes);
  if (read._tag !== "Ok") {
    if (read._tag === "Oversized") return { _tag: "Bound" };
    if (read._tag === "IdentityChanged") return { _tag: "Unreadable" };
    return { _tag: "Unreadable" };
  }

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
}

// ---------------------------------------------------------------------------
// Bounded regular-file read with identity recheck
// ---------------------------------------------------------------------------

type FileRead =
  | { readonly _tag: "Ok"; readonly bytes: Buffer }
  | { readonly _tag: "Oversized" }
  | { readonly _tag: "Unreadable" }
  | { readonly _tag: "IdentityChanged" };

function isNotFound(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "ENOENT"
  );
}

function readRegularFileBytes(
  absPath: string,
  before: Stats,
  maxBytes: number,
): FileRead {
  let fd: number | undefined;
  try {
    if (!before.isFile() || before.isSymbolicLink()) {
      return { _tag: "Unreadable" };
    }
    fd = openSync(absPath, "r");
    const opened = fstatSync(fd);
    if (
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      opened.size !== before.size ||
      !opened.isFile()
    ) {
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
  } catch (e) {
    if (isNotFound(e)) return { _tag: "Unreadable" };
    return { _tag: "Unreadable" };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
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

/**
 * Core scanner. Fail-closed; never throws domain errors with path content.
 */
export function scanWorktreeSync(input: SecretScanInput): SecretScanResult {
  const bounds = input.bounds ?? DEFAULT_SECRET_SCAN_BOUNDS;
  if (!isValidAbsoluteRoot(input.worktreeRoot)) {
    return refuse("invalid_worktree");
  }
  const root = normalizeRootInput(input.worktreeRoot);
  if (!isValidAbsoluteRoot(root)) {
    return refuse("invalid_worktree");
  }

  let rootStat: Stats;
  try {
    rootStat = lstatSync(root);
  } catch {
    return refuse("invalid_worktree");
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return refuse("invalid_worktree");
  }

  const fixtures = loadFixtureDeclaration(root, bounds);
  if (fixtures._tag === "Malformed") {
    return refuse("malformed_fixture_declaration");
  }
  if (fixtures._tag === "Unreadable") {
    return refuse("unreadable");
  }
  if (fixtures._tag === "Bound") {
    return refuse("bound_exceeded");
  }
  const exemptions: ExemptionMap =
    fixtures._tag === "Ok" ? fixtures.map : new Map();

  // If declaration paths escape fixture rules they are already rejected.
  // Paths under fixture subtree but pointing at non-secret files are fine.

  const counters: Counters = {
    directoryEntries: 0,
    files: 0,
    totalInspectedBytes: 0,
    lineInspections: 0,
  };

  type Frame = { readonly absDir: string };
  const stack: Frame[] = [{ absDir: root }];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    let dir;
    try {
      dir = opendirSync(frame.absDir);
    } catch {
      return refuse("unreadable");
    }

    try {
      let ent: Dirent | null;
      while ((ent = dir.readSync()) !== null) {
        counters.directoryEntries += 1;
        if (counters.directoryEntries > bounds.maxDirectoryEntries) {
          return refuse("bound_exceeded");
        }

        const name = ent.name;
        if (!isSafeDirentName(name)) {
          return refuse("unsupported_traversal");
        }

        // Top-level prune of .git and .harness only (shell parity).
        if (frame.absDir === root && PRUNE_TOP_LEVEL.has(name)) {
          continue;
        }

        const abs = join(frame.absDir, name);
        let st: Stats;
        try {
          st = lstatSync(abs);
        } catch {
          return refuse("unreadable");
        }

        if (st.isSymbolicLink()) {
          // Never follow. Skip without treating as secret.
          continue;
        }

        if (st.isDirectory()) {
          stack.push({ absDir: abs });
          continue;
        }

        if (!st.isFile()) {
          // sockets, devices, etc. — unsupported for safe traversal
          return refuse("unsupported_traversal");
        }

        counters.files += 1;
        if (counters.files > bounds.maxFiles) {
          return refuse("bound_exceeded");
        }

        const posixRel = toPosixRel(root, abs);
        if (posixRel.length === 0 || posixRel === ".") {
          return refuse("unsupported_traversal");
        }
        if (
          posixRel.startsWith("..") ||
          posixRel.includes("/../") ||
          posixRel.includes("\\")
        ) {
          return refuse("unsupported_traversal");
        }
        const pathBytes = utf8ByteLength(posixRel);
        if (pathBytes > bounds.maxRelativePathBytes) {
          return refuse("bound_exceeded");
        }

        const filenameRefused = isRefusedSecretFilename(name);

        // Always inspect regular-file content for PEM (and for exemption digest).
        // File-size bound applies to every inspected regular file.
        if (st.size > bounds.maxFileBytes) {
          return refuse("bound_exceeded");
        }

        const read = readRegularFileBytes(abs, st, bounds.maxFileBytes);
        if (read._tag === "Oversized") return refuse("bound_exceeded");
        if (read._tag === "IdentityChanged") return refuse("identity_changed");
        if (read._tag === "Unreadable") return refuse("unreadable");

        const bytes = read.bytes;
        counters.totalInspectedBytes += bytes.byteLength;
        if (counters.totalInspectedBytes > bounds.maxTotalInspectedBytes) {
          return refuse("bound_exceeded");
        }

        if (filenameRefused) {
          if (tryExempt(posixRel, bytes, exemptions)) {
            continue;
          }
          return { _tag: "SecretFound" };
        }

        const pemHit = scanPemLines(bytes, counters, bounds);
        if (pemHit !== null) {
          if (pemHit._tag === "SecretFound") {
            if (tryExempt(posixRel, bytes, exemptions)) {
              continue;
            }
            return { _tag: "SecretFound" };
          }
          return pemHit;
        }
      }
    } finally {
      try {
        dir.closeSync();
      } catch {
        /* ignore */
      }
    }
  }

  return { _tag: "Clean" };
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
 * Run the secret-scan CLI. Emits one canonical JSON line on stdout.
 * Exit 0 only for Clean; nonzero for SecretFound, Refused, or bad argv.
 */
export function runSecretScanCli(
  argv: readonly string[],
  io: SecretScanCliIo,
): Effect.Effect<number, never, SecretScan> {
  return Effect.gen(function* () {
    const parsed = parseSecretScanArgv(argv);
    if (parsed._tag === "Invalid") {
      io.writeStderr(MSG_INVALID_ARGUMENTS + "\n");
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
