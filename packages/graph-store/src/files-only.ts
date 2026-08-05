/**
 * Files-only GraphStore: default backend, no database/network/container.
 *
 * On-disk layout (when root is set):
 *
 *   <root>/
 *     CURRENT                 # regular file: generation id + newline
 *     generations/
 *       <genId>/
 *         generation.json     # immutable snapshot (canonical JSON)
 *     .store.lock             # exclusive open/publish lock
 *
 * Optional capabilities — all unavailable: time_travel, branch_merge,
 * cross_run_query.
 */

import {
  canonicalize,
  decodeUtf8Fatal,
  isCoreFailure,
  parseJsonRejectDuplicateKeys,
  readFdBounded,
} from "@foreman/core";
import { Context, Effect, Either, Layer, Scope } from "effect";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  GENERATION_ID_WIDTH,
  GRAPH_STORE_SCHEMA_VERSION,
  MAX_FILE_BYTES,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
  MAX_LOCK_RETRIES,
  MAX_ROOT_FILES,
  MAX_TRAVERSAL_STEPS,
  STORE_LOCK_BOUND_MS,
  STORE_LOCK_SPIN_MS,
} from "./bounds.js";
import {
  GraphStoreError,
  PublishConflictError,
  SchemaNotRegisteredError,
  SchemaValidationError,
  graphStoreFailure,
  isGraphStoreFailure,
  throwFailure,
  type GraphStoreFailure,
} from "./failures.js";
import {
  CAP_TIME_TRAVEL,
  OPTIONAL_CAPABILITIES,
  checkHasCapability,
  checkRequireCapability,
  defaultAsOf,
  runPortQuery,
  type GraphStore,
  type JsonObject,
  type QueryResult,
} from "./port.js";
import { indexFromDocuments, runNamedQuery, asIdSet } from "./queries.js";
import {
  BUSINESS_KEYS,
  deepCloneJson,
  deepEqualJson,
  defaultSchemaPayload,
  detectsCycle,
  isolateJson,
  validateDocument,
  validateDocumentMap,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Process-wide root serialization (one open/publish critical section per root)
// ---------------------------------------------------------------------------

type RootGate = { depth: number };

const rootGates = new Map<string, RootGate>();

/**
 * Re-entrant per-root critical section for the current call stack.
 * Cross-process and cross-handle mutual exclusion is enforced by the
 * exclusive file lock on `.store.lock` during open load and publish.
 */
function withRootGateSync<A>(key: string, fn: () => A): A {
  let gate = rootGates.get(key);
  if (!gate) {
    gate = { depth: 0 };
    rootGates.set(key, gate);
  }
  gate.depth += 1;
  try {
    return fn();
  } finally {
    gate.depth -= 1;
  }
}

// ---------------------------------------------------------------------------
// Generation snapshot shape
// ---------------------------------------------------------------------------

export type GenerationSnapshot = {
  readonly schemaVersion: typeof GRAPH_STORE_SCHEMA_VERSION;
  readonly generationId: string;
  readonly schemaRegistered: boolean;
  readonly schema: unknown;
  readonly schemaAuthor: string;
  readonly schemaMessage: string;
  readonly documents: Readonly<Record<string, JsonObject>>;
};

const SNAPSHOT_KEYS = new Set([
  "schemaVersion",
  "generationId",
  "schemaRegistered",
  "schema",
  "schemaAuthor",
  "schemaMessage",
  "documents",
]);

function emptySnapshot(generationId: string): GenerationSnapshot {
  return {
    schemaVersion: GRAPH_STORE_SCHEMA_VERSION,
    generationId,
    schemaRegistered: false,
    schema: null,
    schemaAuthor: "",
    schemaMessage: "",
    documents: {},
  };
}

function nextGenerationId(prev: string | null): string {
  const n = prev ? Number.parseInt(prev, 10) + 1 : 1;
  if (!Number.isFinite(n) || n < 1) {
    throwFailure(
      graphStoreFailure("corrupt_state", "invalid previous generation id"),
    );
  }
  return String(n).padStart(GENERATION_ID_WIDTH, "0");
}

function countJsonNodes(value: unknown, depth: number): number {
  if (depth > MAX_JSON_DEPTH) return MAX_JSON_NODES + 1;
  if (value === null || typeof value !== "object") return 1;
  if (Array.isArray(value)) {
    let n = 1;
    for (const item of value) n += countJsonNodes(item, depth + 1);
    return n;
  }
  let n = 1;
  for (const k of Object.keys(value as object)) {
    n += 1 + countJsonNodes((value as JsonObject)[k], depth + 1);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Safe filesystem helpers (descriptor-based, no-follow)
// ---------------------------------------------------------------------------

type FileIdentity = { readonly dev: number; readonly ino: number };

function identityOf(st: Stats): FileIdentity {
  return { dev: st.dev, ino: st.ino };
}

function identitiesEqual(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function isEnoent(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "ENOENT"
  );
}

function isEexist(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "EEXIST"
  );
}

function observePathKind(
  path: string,
): "missing" | "regular" | "symlink" | "directory" | "other" {
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch (e) {
    if (isEnoent(e)) return "missing";
    return "other";
  }
  if (st.isSymbolicLink()) return "symlink";
  if (st.isFile()) return "regular";
  if (st.isDirectory()) return "directory";
  return "other";
}

function rejectIfHardLink(st: Stats, label: string): void {
  if (st.nlink > 1) {
    throwFailure(
      graphStoreFailure(
        "hard_link_rejected",
        `${label} is hard-linked (nlink=${st.nlink})`,
      ),
    );
  }
}

/**
 * Resolve root to an absolute real directory path without following a final
 * symlink. Rejects symlink roots and path escape attempts.
 */
function resolveStoreRoot(root: string): string {
  if (typeof root !== "string" || !root.trim()) {
    throwFailure(
      graphStoreFailure("invalid_path", "store root must be a non-empty path"),
    );
  }
  if (root.includes("\0")) {
    throwFailure(graphStoreFailure("invalid_path", "store root contains NUL"));
  }
  const abs = resolve(root);
  const kind = observePathKind(abs);
  if (kind === "symlink") {
    throwFailure(
      graphStoreFailure("symlink_rejected", "store root must not be a symlink"),
    );
  }
  if (kind === "regular" || kind === "other") {
    throwFailure(
      graphStoreFailure("invalid_path", "store root must be a directory"),
    );
  }
  if (kind === "missing") {
    ensureDirectoryTree(abs);
  }
  const after = observePathKind(abs);
  if (after !== "directory") {
    throwFailure(
      graphStoreFailure(
        after === "symlink" ? "symlink_rejected" : "invalid_path",
        "store root must be a real directory",
      ),
    );
  }
  return abs;
}

function ensureDirectoryTree(abs: string): void {
  const parts = abs.split(sep).filter(Boolean);
  let cur = abs.startsWith(sep) ? sep : "";
  for (const part of parts) {
    cur = cur === sep ? `${sep}${part}` : cur ? join(cur, part) : part;
    const kind = observePathKind(cur);
    if (kind === "missing") {
      try {
        mkdirSync(cur);
      } catch (e) {
        if (!isEexist(e)) {
          throwFailure(
            graphStoreFailure(
              "invalid_path",
              "failed to create store directory",
            ),
          );
        }
      }
      const again = observePathKind(cur);
      if (again !== "directory") {
        throwFailure(
          graphStoreFailure(
            again === "symlink" ? "symlink_rejected" : "invalid_path",
            "path component is not a directory",
          ),
        );
      }
    } else if (kind === "symlink") {
      throwFailure(
        graphStoreFailure(
          "symlink_rejected",
          "path component must not be a symlink",
        ),
      );
    } else if (kind !== "directory") {
      throwFailure(
        graphStoreFailure("invalid_path", "path component is not a directory"),
      );
    }
  }
}

function assertUnderRoot(root: string, candidate: string): string {
  const abs = resolve(candidate);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (abs !== root && !abs.startsWith(prefix)) {
    throwFailure(
      graphStoreFailure("path_escape", "path escapes store root"),
    );
  }
  return abs;
}

function countFilesUnder(root: string): number {
  let count = 0;
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(dir, name);
      const kind = observePathKind(p);
      if (kind === "directory") {
        walk(p);
      } else if (kind === "regular") {
        count += 1;
        if (count > MAX_ROOT_FILES) {
          throwFailure(
            graphStoreFailure(
              "limit_exceeded",
              `store root exceeds max file count ${MAX_ROOT_FILES}`,
            ),
          );
        }
      } else if (kind === "symlink") {
        throwFailure(
          graphStoreFailure(
            "symlink_rejected",
            "symlink found under store root",
          ),
        );
      }
    }
  };
  walk(root);
  return count;
}

/**
 * Open a regular file with O_NOFOLLOW, validate the opened descriptor via
 * fstat, read a bounded payload, re-fstat the same descriptor, and reject
 * identity changes. Never follows replacement targets unbounded.
 */
function readRegularFileBounded(path: string, label = "store file"): Buffer {
  let fd: number;
  try {
    fd = openSync(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
  } catch (e) {
    if (isEnoent(e)) {
      throwFailure(
        graphStoreFailure("corrupt_state", `${label} is missing`),
      );
    }
    // ELOOP / EPERM etc. for symlinks depending on platform
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code: unknown }).code)
        : "";
    if (code === "ELOOP" || code === "EMLINK") {
      throwFailure(
        graphStoreFailure("symlink_rejected", `refusing to read symlink (${label})`),
      );
    }
    throwFailure(
      graphStoreFailure("corrupt_state", `failed to open ${label}`),
    );
  }
  try {
    const st = fstatSync(fd);
    if (st.isSymbolicLink()) {
      throwFailure(
        graphStoreFailure("symlink_rejected", `refusing to read symlink (${label})`),
      );
    }
    if (!st.isFile()) {
      throwFailure(
        graphStoreFailure("corrupt_state", `${label} is not a regular file`),
      );
    }
    rejectIfHardLink(st, label);
    if (st.size > MAX_FILE_BYTES) {
      throwFailure(
        graphStoreFailure(
          "oversize_input",
          `file exceeds max ${MAX_FILE_BYTES} bytes`,
        ),
      );
    }
    const before = identityOf(st);
    const data = readFdBounded(fd, MAX_FILE_BYTES);
    if (isCoreFailure(data)) {
      if (data._tag === "OversizeInput") {
        throwFailure(
          graphStoreFailure(
            "oversize_input",
            `file exceeds max ${MAX_FILE_BYTES} bytes`,
          ),
        );
      }
      throwFailure(
        graphStoreFailure("corrupt_state", `failed to read ${label}`),
      );
    }
    const st2 = fstatSync(fd);
    if (!st2.isFile() || st2.nlink > 1) {
      throwFailure(
        graphStoreFailure(
          "identity_changed",
          `${label} identity changed during read`,
        ),
      );
    }
    if (!identitiesEqual(before, identityOf(st2))) {
      throwFailure(
        graphStoreFailure(
          "identity_changed",
          `${label} identity changed during read`,
        ),
      );
    }
    // Also re-lstat the path: reject if the path now points elsewhere.
    try {
      const stPath = lstatSync(path);
      if (
        !stPath.isFile() ||
        stPath.dev !== before.dev ||
        stPath.ino !== before.ino
      ) {
        throwFailure(
          graphStoreFailure(
            "identity_changed",
            `${label} path identity changed during read`,
          ),
        );
      }
    } catch (e) {
      if (isGraphStoreThrown(e)) throw e;
      throwFailure(
        graphStoreFailure(
          "identity_changed",
          `${label} path identity changed during read`,
        ),
      );
    }
    return Buffer.from(data);
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

function parseCanonicalJsonBytes(buf: Buffer): unknown {
  const textOrFail = decodeUtf8Fatal(new Uint8Array(buf));
  if (isCoreFailure(textOrFail)) {
    if (textOrFail._tag === "MalformedUtf8") {
      throwFailure(
        graphStoreFailure("malformed_utf8", "input is not valid UTF-8"),
      );
    }
    throwFailure(
      graphStoreFailure("oversize_input", "input exceeds UTF-8 decode bound"),
    );
  }
  const parsed = parseJsonRejectDuplicateKeys(textOrFail);
  if (isCoreFailure(parsed)) {
    if (parsed._tag === "DuplicateJsonKey") {
      throwFailure(
        graphStoreFailure("duplicate_json_key", "JSON contains duplicate keys"),
      );
    }
    throwFailure(graphStoreFailure("invalid_json", "malformed JSON"));
  }
  if (countJsonNodes(parsed, 1) > MAX_JSON_NODES) {
    throwFailure(
      graphStoreFailure(
        "limit_exceeded",
        `JSON exceeds max node count ${MAX_JSON_NODES}`,
      ),
    );
  }
  return parsed;
}

function fsyncPathDirectory(path: string): void {
  const dir = dirname(path);
  let fd: number;
  try {
    fd = openSync(dir, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  } catch {
    return;
  }
  try {
    fsyncSync(fd);
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Write all bytes via writeSync in a loop (handles short writes).
 */
function writeAllSync(fd: number, data: Buffer): void {
  let offset = 0;
  while (offset < data.byteLength) {
    const n = writeSync(fd, data, offset, data.byteLength - offset);
    if (n <= 0) {
      throwFailure(
        graphStoreFailure("corrupt_state", "short write made no progress"),
      );
    }
    offset += n;
  }
}

export type PublishInjectHooks = {
  /** Simulate a single short write that returns partial byte count once. */
  readonly shortWriteOnce?: boolean;
  /** Fail after generation file is fully written/renamed, before CURRENT. */
  readonly failBeforeCurrent?: boolean;
  /** Fail after memory would have been mutated if callers mutate early. */
  readonly failDuringPublish?: boolean;
};

let activeInject: PublishInjectHooks | null = null;

/**
 * Atomic durable write: full write loop (handles short writes), fsync file,
 * then either O_EXCL create of the final path (immutable generations) or
 * temp+rename for CURRENT selection, then fsync the containing directory.
 */
function atomicWriteFile(
  path: string,
  bytes: Buffer | string,
  opts?: { readonly exclusiveFinal?: boolean },
): void {
  const dir = dirname(path);
  ensureDirectoryTree(dir);
  const data = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  if (data.byteLength > MAX_FILE_BYTES) {
    throwFailure(
      graphStoreFailure(
        "oversize_input",
        `write exceeds max ${MAX_FILE_BYTES} bytes`,
      ),
    );
  }

  const writePayload = (fd: number): void => {
    if (activeInject?.shortWriteOnce) {
      activeInject = { ...activeInject, shortWriteOnce: false };
      if (data.byteLength > 1) {
        const n = writeSync(fd, data, 0, 1);
        if (n !== 1) {
          throwFailure(
            graphStoreFailure("corrupt_state", "injected short write failed"),
          );
        }
        writeAllSync(fd, data.subarray(1));
      } else {
        writeAllSync(fd, data);
      }
    } else {
      writeAllSync(fd, data);
    }
    fsyncSync(fd);
  };

  if (opts?.exclusiveFinal) {
    // Immutable generation: must not overwrite an existing file.
    let fd: number;
    try {
      fd = openSync(
        path,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o644,
      );
    } catch (e) {
      if (isEexist(e)) {
        throwFailure(
          graphStoreFailure(
            "corrupt_state",
            "immutable generation file already exists",
          ),
        );
      }
      throwFailure(
        graphStoreFailure("corrupt_state", "failed to create generation file"),
      );
    }
    try {
      writePayload(fd);
    } catch (e) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(path);
      } catch {
        /* ignore */
      }
      if (isGraphStoreThrown(e)) throw e;
      throwFailure(
        graphStoreFailure("corrupt_state", "atomic write failed"),
      );
    }
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    fsyncPathDirectory(path);
    return;
  }

  const tmp = join(
    dir,
    `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  try {
    const fd = openSync(
      tmp,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o644,
    );
    try {
      writePayload(fd);
    } finally {
      closeSync(fd);
    }
    const st = lstatSync(tmp);
    if (st.isSymbolicLink() || !st.isFile() || st.nlink > 1) {
      throwFailure(
        graphStoreFailure(
          "corrupt_state",
          "temp file is not a safe regular file",
        ),
      );
    }
    renameSync(tmp, path);
    fsyncPathDirectory(path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    if (isGraphStoreThrown(e)) throw e;
    throwFailure(graphStoreFailure("corrupt_state", "atomic write failed"));
  }
}

function isGraphStoreThrown(e: unknown): boolean {
  if (e instanceof GraphStoreError) return true;
  if (isGraphStoreFailure(e)) return true;
  if (
    e &&
    typeof e === "object" &&
    "failure" in e &&
    isGraphStoreFailure((e as { failure: unknown }).failure)
  ) {
    return true;
  }
  return false;
}

function mapUnknownToFailure(e: unknown, fallback: string): GraphStoreFailure {
  if (isGraphStoreFailure(e)) return e;
  if (
    e &&
    typeof e === "object" &&
    "failure" in e &&
    isGraphStoreFailure((e as { failure: unknown }).failure)
  ) {
    return (e as { failure: GraphStoreFailure }).failure;
  }
  // Do not classify arbitrary Error values as domain failures by message.
  return graphStoreFailure("backend_misconfiguration", fallback);
}

// ---------------------------------------------------------------------------
// File lock (descriptor-validated)
// ---------------------------------------------------------------------------

type HeldLock = {
  readonly fd: number;
  readonly path: string;
  readonly identity: FileIdentity;
};

function acquireLockSync(lockFilePath: string): HeldLock {
  const deadline = Date.now() + STORE_LOCK_BOUND_MS;
  let attempts = 0;
  while (Date.now() < deadline && attempts < MAX_LOCK_RETRIES) {
    attempts += 1;
    const kind = observePathKind(lockFilePath);
    if (kind === "symlink" || kind === "directory" || kind === "other") {
      throwFailure(
        graphStoreFailure(
          kind === "symlink" ? "symlink_rejected" : "invalid_path",
          "lock path is not a free regular-file slot",
        ),
      );
    }
    try {
      const fd = openSync(
        lockFilePath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o644,
      );
      try {
        writeAllSync(fd, Buffer.from(`${process.pid}\n`, "utf8"));
        fsyncSync(fd);
      } catch (e) {
        closeSync(fd);
        try {
          unlinkSync(lockFilePath);
        } catch {
          /* ignore */
        }
        if (isGraphStoreThrown(e)) throw e;
        throwFailure(graphStoreFailure("store_busy", "failed to write lock"));
      }
      // Validate the *acquired descriptor*, not only the pathname.
      const stFd = fstatSync(fd);
      if (!stFd.isFile() || stFd.nlink > 1) {
        closeSync(fd);
        try {
          unlinkSync(lockFilePath);
        } catch {
          /* ignore */
        }
        throwFailure(
          graphStoreFailure(
            "corrupt_state",
            "lock descriptor is not a safe regular file",
          ),
        );
      }
      const stPath = lstatSync(lockFilePath);
      if (
        stPath.isSymbolicLink() ||
        !stPath.isFile() ||
        stPath.nlink > 1 ||
        stPath.dev !== stFd.dev ||
        stPath.ino !== stFd.ino
      ) {
        closeSync(fd);
        try {
          unlinkSync(lockFilePath);
        } catch {
          /* ignore */
        }
        throwFailure(
          graphStoreFailure(
            "identity_changed",
            "lock path identity does not match acquired descriptor",
          ),
        );
      }
      return { fd, path: lockFilePath, identity: identityOf(stFd) };
    } catch (e) {
      if (isGraphStoreThrown(e)) throw e;
      if (isEexist(e)) {
        const end = Date.now() + STORE_LOCK_SPIN_MS;
        while (Date.now() < end) {
          /* spin */
        }
        continue;
      }
      throwFailure(
        graphStoreFailure("store_busy", "failed to acquire store lock"),
      );
    }
  }
  throwFailure(
    graphStoreFailure("store_busy", "store lock acquisition timed out"),
  );
}

function releaseLockSync(lock: HeldLock): void {
  try {
    const st = fstatSync(lock.fd);
    if (
      st.isFile() &&
      st.dev === lock.identity.dev &&
      st.ino === lock.identity.ino
    ) {
      // identity still holds
    }
  } catch {
    /* ignore */
  }
  try {
    closeSync(lock.fd);
  } catch {
    /* ignore */
  }
  try {
    const st = lstatSync(lock.path);
    if (
      st.isFile() &&
      st.dev === lock.identity.dev &&
      st.ino === lock.identity.ino
    ) {
      unlinkSync(lock.path);
    }
  } catch {
    /* do not remove a changed lock path */
  }
}

// ---------------------------------------------------------------------------
// Root identity pin
// ---------------------------------------------------------------------------

type PinnedRoot = {
  readonly path: string;
  readonly identity: FileIdentity;
};

function pinRoot(root: string): PinnedRoot {
  const st = lstatSync(root);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throwFailure(
      graphStoreFailure(
        st.isSymbolicLink() ? "symlink_rejected" : "invalid_path",
        "store root must be a real directory",
      ),
    );
  }
  return { path: root, identity: identityOf(st) };
}

function recheckRoot(pin: PinnedRoot): void {
  let st: Stats;
  try {
    st = lstatSync(pin.path);
  } catch {
    throwFailure(
      graphStoreFailure("identity_changed", "store root identity changed"),
    );
  }
  if (
    st.isSymbolicLink() ||
    !st.isDirectory() ||
    st.dev !== pin.identity.dev ||
    st.ino !== pin.identity.ino
  ) {
    throwFailure(
      graphStoreFailure("identity_changed", "store root identity changed"),
    );
  }
}

// ---------------------------------------------------------------------------
// Load / publish generation
// ---------------------------------------------------------------------------

function currentPath(root: string): string {
  return join(root, "CURRENT");
}

function generationsDir(root: string): string {
  return join(root, "generations");
}

function generationFile(root: string, genId: string): string {
  return join(generationsDir(root), genId, "generation.json");
}

function lockPath(root: string): string {
  return join(root, ".store.lock");
}

function decodeSnapshot(raw: unknown): GenerationSnapshot {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throwFailure(
      graphStoreFailure("corrupt_state", "generation snapshot is not an object"),
    );
  }
  const o = raw as JsonObject;
  for (const key of Object.keys(o)) {
    if (!SNAPSHOT_KEYS.has(key)) {
      throwFailure(
        graphStoreFailure(
          "corrupt_state",
          `generation snapshot has unknown key ${JSON.stringify(key)}`,
        ),
      );
    }
  }
  if (o["schemaVersion"] !== GRAPH_STORE_SCHEMA_VERSION) {
    throwFailure(
      graphStoreFailure("corrupt_state", "unsupported generation schemaVersion"),
    );
  }
  if (typeof o["generationId"] !== "string" || !o["generationId"]) {
    throwFailure(
      graphStoreFailure("corrupt_state", "generation missing generationId"),
    );
  }
  if (typeof o["schemaRegistered"] !== "boolean") {
    throwFailure(
      graphStoreFailure("corrupt_state", "generation missing schemaRegistered"),
    );
  }
  if (
    typeof o["schemaAuthor"] !== "string" ||
    typeof o["schemaMessage"] !== "string"
  ) {
    throwFailure(
      graphStoreFailure("corrupt_state", "generation missing schema metadata"),
    );
  }
  if (
    o["documents"] === null ||
    typeof o["documents"] !== "object" ||
    Array.isArray(o["documents"])
  ) {
    throwFailure(
      graphStoreFailure("corrupt_state", "generation missing documents map"),
    );
  }
  const docsRaw = o["documents"] as Record<string, JsonObject>;
  const docs: Record<string, JsonObject> = {};
  for (const [id, doc] of Object.entries(docsRaw)) {
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      throwFailure(
        graphStoreFailure("corrupt_state", `document ${id} is not an object`),
      );
    }
    docs[id] = isolateJson(doc);
  }
  try {
    validateDocumentMap(docs, { maxTraversalSteps: MAX_TRAVERSAL_STEPS });
  } catch (e) {
    if (e instanceof SchemaValidationError) {
      throwFailure(
        graphStoreFailure(
          "corrupt_state",
          `generation fails schema validation: ${e.message}`,
        ),
      );
    }
    if (isGraphStoreThrown(e)) throw e;
    throwFailure(
      graphStoreFailure("corrupt_state", "generation fails schema validation"),
    );
  }
  return {
    schemaVersion: GRAPH_STORE_SCHEMA_VERSION,
    generationId: o["generationId"] as string,
    schemaRegistered: o["schemaRegistered"] as boolean,
    schema: o["schema"] == null ? null : isolateJson(o["schema"]),
    schemaAuthor: o["schemaAuthor"] as string,
    schemaMessage: o["schemaMessage"] as string,
    documents: docs,
  };
}

function loadCurrentGeneration(
  root: string,
  pin: PinnedRoot,
): GenerationSnapshot {
  recheckRoot(pin);
  countFilesUnder(root);
  const cur = currentPath(root);
  const kind = observePathKind(cur);
  if (kind === "missing") {
    return emptySnapshot(nextGenerationId(null));
  }
  if (kind === "symlink") {
    throwFailure(
      graphStoreFailure("symlink_rejected", "CURRENT must not be a symlink"),
    );
  }
  if (kind !== "regular") {
    throwFailure(
      graphStoreFailure("corrupt_state", "CURRENT is not a regular file"),
    );
  }
  const buf = readRegularFileBounded(cur, "CURRENT");
  const textOrFail = decodeUtf8Fatal(new Uint8Array(buf));
  if (isCoreFailure(textOrFail)) {
    throwFailure(
      graphStoreFailure(
        textOrFail._tag === "MalformedUtf8"
          ? "malformed_utf8"
          : "oversize_input",
        "CURRENT is not valid UTF-8",
      ),
    );
  }
  const text = textOrFail.trim();
  if (!/^\d{1,16}$/.test(text)) {
    throwFailure(
      graphStoreFailure(
        "torn_generation",
        "CURRENT does not contain a valid generation id",
      ),
    );
  }
  const genId = text.padStart(GENERATION_ID_WIDTH, "0");
  const genPath = assertUnderRoot(root, generationFile(root, genId));
  const gKind = observePathKind(genPath);
  if (gKind === "missing") {
    throwFailure(
      graphStoreFailure(
        "missing_generation",
        "CURRENT points at a missing generation",
      ),
    );
  }
  if (gKind === "symlink") {
    throwFailure(
      graphStoreFailure(
        "symlink_rejected",
        "generation.json must not be a symlink",
      ),
    );
  }
  if (gKind !== "regular") {
    throwFailure(
      graphStoreFailure("corrupt_state", "generation.json is not a regular file"),
    );
  }
  recheckRoot(pin);
  const raw = parseCanonicalJsonBytes(
    readRegularFileBounded(genPath, "generation.json"),
  );
  const snap = decodeSnapshot(raw);
  if (snap.generationId !== genId) {
    throwFailure(
      graphStoreFailure(
        "corrupt_state",
        "generation id mismatch between CURRENT and snapshot",
      ),
    );
  }
  recheckRoot(pin);
  return snap;
}

function publishSnapshot(
  root: string,
  pin: PinnedRoot,
  snap: GenerationSnapshot,
): void {
  recheckRoot(pin);
  countFilesUnder(root);
  const genDir = assertUnderRoot(
    root,
    join(generationsDir(root), snap.generationId),
  );
  ensureDirectoryTree(genDir);
  fsyncPathDirectory(genDir);
  const genPath = assertUnderRoot(
    root,
    generationFile(root, snap.generationId),
  );
  const payload: GenerationSnapshot = {
    schemaVersion: GRAPH_STORE_SCHEMA_VERSION,
    generationId: snap.generationId,
    schemaRegistered: snap.schemaRegistered,
    schema: snap.schema,
    schemaAuthor: snap.schemaAuthor,
    schemaMessage: snap.schemaMessage,
    documents: Object.fromEntries(
      Object.keys(snap.documents)
        .sort()
        .map((k) => [k, snap.documents[k]!]),
    ),
  };
  const text = canonicalize(payload) + "\n";
  atomicWriteFile(genPath, text, { exclusiveFinal: true });
  fsyncPathDirectory(join(generationsDir(root), snap.generationId));
  fsyncPathDirectory(generationsDir(root));
  if (activeInject?.failBeforeCurrent) {
    activeInject = { ...activeInject, failBeforeCurrent: false };
    throwFailure(
      graphStoreFailure(
        "corrupt_state",
        "injected failure before CURRENT selection",
      ),
    );
  }
  // Select current generation only after the generation file is durable.
  const curText = `${snap.generationId}\n`;
  atomicWriteFile(currentPath(root), curText);
  fsyncPathDirectory(root);
  recheckRoot(pin);
  const st = lstatSync(currentPath(root));
  if (st.isSymbolicLink() || !st.isFile() || st.nlink > 1) {
    throwFailure(
      graphStoreFailure(
        "identity_changed",
        "CURRENT identity is unsafe after publish",
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Merge concurrent handle publications
// ---------------------------------------------------------------------------

function cloneDocMap(
  docs: ReadonlyMap<string, JsonObject> | Readonly<Record<string, JsonObject>>,
): Map<string, JsonObject> {
  const out = new Map<string, JsonObject>();
  if (docs instanceof Map) {
    for (const [k, v] of docs) out.set(k, isolateJson(v));
  } else {
    for (const [k, v] of Object.entries(docs)) out.set(k, isolateJson(v));
  }
  return out;
}

/**
 * Merge this handle's local changes (vs base) onto the live snapshot.
 * Distinct document commits are preserved. Conflicting edits to the same
 * document fail with PublishConflictError.
 */
function mergePublication(
  base: ReadonlyMap<string, JsonObject>,
  local: ReadonlyMap<string, JsonObject>,
  live: ReadonlyMap<string, JsonObject>,
): Map<string, JsonObject> {
  const result = cloneDocMap(live);
  const allKeys = new Set<string>([
    ...base.keys(),
    ...local.keys(),
    ...live.keys(),
  ]);
  for (const key of allKeys) {
    const baseDoc = base.get(key);
    const localDoc = local.get(key);
    const liveDoc = live.get(key);
    const localChanged =
      localDoc === undefined
        ? baseDoc !== undefined
        : baseDoc === undefined
          ? true
          : !deepEqualJson(baseDoc, localDoc);
    if (!localChanged) continue;
    const liveChanged =
      liveDoc === undefined
        ? baseDoc !== undefined
        : baseDoc === undefined
          ? true
          : !deepEqualJson(baseDoc, liveDoc);
    if (liveChanged) {
      // Concurrent change to the same key.
      if (
        localDoc !== undefined &&
        liveDoc !== undefined &&
        deepEqualJson(localDoc, liveDoc)
      ) {
        // Same final value — keep.
        continue;
      }
      throw new PublishConflictError(
        `publish conflict on document ${JSON.stringify(key)}: concurrent modification`,
        { field: key },
      );
    }
    if (localDoc === undefined) {
      result.delete(key);
    } else {
      result.set(key, isolateJson(localDoc));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Effect-owned lock scope
// ---------------------------------------------------------------------------

function acquireLockEffect(
  lockFilePath: string,
): Effect.Effect<HeldLock, GraphStoreFailure, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.try({
      try: () => acquireLockSync(lockFilePath),
      catch: (e) => mapUnknownToFailure(e, "failed to acquire store lock"),
    }),
    (lock) =>
      Effect.sync(() => {
        releaseLockSync(lock);
      }),
  );
}

function withLockedRootEffect<A>(
  root: string,
  pin: PinnedRoot,
  body: () => A,
): Effect.Effect<A, GraphStoreFailure> {
  return Effect.scoped(
    Effect.gen(function* () {
      recheckRoot(pin);
      yield* acquireLockEffect(lockPath(root));
      recheckRoot(pin);
      return yield* Effect.try({
        try: () => body(),
        catch: (e) => {
          if (isGraphStoreThrown(e)) {
            if (e instanceof GraphStoreError) return e.failure;
            if (isGraphStoreFailure(e)) return e;
            if (
              e &&
              typeof e === "object" &&
              "failure" in e &&
              isGraphStoreFailure((e as { failure: unknown }).failure)
            ) {
              return (e as { failure: GraphStoreFailure }).failure;
            }
          }
          return mapUnknownToFailure(e, "store operation failed");
        },
      });
    }),
  );
}

/**
 * Run a critical section under an Effect-scoped lock.
 * Domain failures are rethrown as typed GraphStoreError subclasses outside
 * Effect so callers never observe FiberFailure wrappers.
 */
function withEffectLockSync<A>(
  root: string,
  pin: PinnedRoot,
  body: () => A,
): A {
  const result = Effect.runSync(
    Effect.either(withLockedRootEffect(root, pin, body)),
  );
  if (Either.isLeft(result)) {
    throwFailure(result.left);
  }
  return result.right;
}

// ---------------------------------------------------------------------------
// FilesOnlyGraphStore
// ---------------------------------------------------------------------------

export type FilesOnlyOptions = {
  readonly root?: string | null;
  readonly autoSchema?: boolean;
  /** Test seam: override lock timing. */
  readonly lockBoundMs?: number;
  readonly lockSpinMs?: number;
  /** Test seam: injected publish failures. */
  readonly inject?: PublishInjectHooks;
};

export class FilesOnlyGraphStore implements GraphStore {
  private readonly root: string | null;
  private readonly pin: PinnedRoot | null;
  private memory: Map<string, JsonObject> = new Map();
  /** Snapshot of documents at last successful load/publish (for merge). */
  private baseMemory: Map<string, JsonObject> = new Map();
  private schema: unknown = null;
  private schemaRegistered = false;
  private schemaAuthor = "";
  private schemaMessage = "";
  private generationId: string;
  private baseGenerationId: string;
  private readonly rootKey: string;
  private readonly inject: PublishInjectHooks | null;

  private constructor(
    root: string | null,
    pin: PinnedRoot | null,
    autoSchema: boolean,
    inject: PublishInjectHooks | null,
  ) {
    this.root = root;
    this.pin = pin;
    this.rootKey = root ?? `__memory__:${Math.random().toString(16)}`;
    this.generationId = nextGenerationId(null);
    this.baseGenerationId = this.generationId;
    this.inject = inject;
    if (root !== null && pin !== null) {
      withEffectLockSync(root, pin, () => {
        const snap = loadCurrentGeneration(root, pin);
        this.applySnapshot(snap);
      });
    }
    if (autoSchema) {
      this.registerSchema(defaultSchemaPayload(), {
        author: "foreman",
        message: "auto",
      });
    }
  }

  private applySnapshot(snap: GenerationSnapshot): void {
    this.generationId = snap.generationId;
    this.baseGenerationId = snap.generationId;
    this.schemaRegistered = snap.schemaRegistered;
    this.schema = snap.schema == null ? null : isolateJson(snap.schema);
    this.schemaAuthor = snap.schemaAuthor;
    this.schemaMessage = snap.schemaMessage;
    this.memory = cloneDocMap(snap.documents);
    this.baseMemory = cloneDocMap(snap.documents);
  }

  static open(opts: FilesOnlyOptions = {}): FilesOnlyGraphStore {
    const autoSchema = opts.autoSchema === true;
    const inject = opts.inject ?? null;
    if (opts.root == null || opts.root === "") {
      return new FilesOnlyGraphStore(null, null, autoSchema, inject);
    }
    const root = resolveStoreRoot(opts.root);
    const pin = pinRoot(root);
    return withRootGateSync(
      root,
      () => new FilesOnlyGraphStore(root, pin, autoSchema, inject),
    );
  }

  capabilities(): ReadonlySet<string> {
    return new Set();
  }

  hasCapability(name: string): boolean {
    return checkHasCapability(this.capabilities(), name);
  }

  requireCapability(name: string): void {
    checkRequireCapability(this.capabilities(), name);
  }

  registerSchema(
    schema: unknown,
    opts?: { readonly author?: string; readonly message?: string },
  ): void {
    if (schema === null || schema === undefined) {
      throw new SchemaValidationError("schema payload must not be None");
    }
    const prevSchema = this.schema;
    const prevRegistered = this.schemaRegistered;
    const prevAuthor = this.schemaAuthor;
    const prevMessage = this.schemaMessage;
    this.schema = isolateJson(schema);
    this.schemaRegistered = true;
    this.schemaAuthor = opts?.author ?? "foreman";
    this.schemaMessage = opts?.message ?? "register schema";
    try {
      this.publish();
    } catch (e) {
      this.schema = prevSchema;
      this.schemaRegistered = prevRegistered;
      this.schemaAuthor = prevAuthor;
      this.schemaMessage = prevMessage;
      throw e;
    }
  }

  upsertDocument(doc: JsonObject): string {
    if (!this.schemaRegistered) {
      throw new SchemaNotRegisteredError();
    }
    // Clone first (mutable), validate, stamp @id, then freeze for storage.
    const body = deepCloneJson(doc) as JsonObject;
    const docId = validateDocument(body);
    body["@id"] = docId;
    const stored = isolateJson(body);

    this.checkAcyclicEdges(stored, docId);

    if (stored["resolved_to"] != null) {
      const prior = this.memory.get(docId);
      if (
        prior &&
        prior["resolved_to"] != null &&
        !deepEqualJson(prior["resolved_to"], stored["resolved_to"])
      ) {
        throw new SchemaValidationError(
          `RESOLVED_TO is functional: ${docId} already resolves to ${JSON.stringify(prior["resolved_to"])}`,
          { field: "resolved_to" },
        );
      }
    }

    const prevHad = this.memory.has(docId);
    const prev = prevHad ? this.memory.get(docId)! : null;
    this.memory.set(docId, stored);
    try {
      this.publish();
    } catch (e) {
      if (prevHad) this.memory.set(docId, prev!);
      else this.memory.delete(docId);
      throw e;
    }
    return docId;
  }

  getDocument(
    docType: string,
    key: string | JsonObject,
  ): JsonObject | null {
    if (!(docType in BUSINESS_KEYS)) return null;
    const keyFields = BUSINESS_KEYS[docType]!;
    let parts: string[];
    if (typeof key === "string") {
      if (keyFields.length !== 1) {
        throw new Error(
          `${docType} has multi-field key ${keyFields.join(",")}; pass a mapping`,
        );
      }
      parts = [key];
    } else {
      parts = keyFields.map((f) => String(key[f]));
    }
    const docId = `${docType}/${parts.join("+")}`;
    return this.getDocumentById(docId);
  }

  getDocumentById(docId: string): JsonObject | null {
    const doc = this.memory.get(docId);
    if (!doc) return null;
    return isolateJson(doc);
  }

  listDocuments(docType?: string | null): JsonObject[] {
    const out: JsonObject[] = [];
    for (const id of [...this.memory.keys()].sort()) {
      const doc = this.memory.get(id);
      if (!doc) continue;
      if (docType != null && doc["@type"] !== docType) continue;
      out.push(isolateJson(doc));
    }
    return out;
  }

  query(
    name: string,
    opts: {
      readonly expectEmpty: boolean;
      readonly params?: JsonObject | null;
    },
  ): QueryResult {
    return runPortQuery(this, name, opts);
  }

  runQuery(name: string, params: JsonObject): readonly unknown[] {
    const index = indexFromDocuments(
      Object.fromEntries(
        [...this.memory.entries()].map(([k, v]) => [k, isolateJson(v)]),
      ),
    );
    return runNamedQuery(index, name, isolateJson(params));
  }

  asOf(versionRef: string): GraphStore {
    return defaultAsOf(versionRef, CAP_TIME_TRAVEL);
  }

  /** Current in-memory generation id (tests). */
  currentGenerationId(): string {
    return this.generationId;
  }

  /** Deterministic snapshot bytes for the next publish (tests). */
  snapshotCanonicalBytes(): string {
    const docs = Object.fromEntries(
      [...this.memory.keys()]
        .sort()
        .map((k) => [k, this.memory.get(k)!]),
    );
    const payload: GenerationSnapshot = {
      schemaVersion: GRAPH_STORE_SCHEMA_VERSION,
      generationId: this.generationId,
      schemaRegistered: this.schemaRegistered,
      schema: this.schema,
      schemaAuthor: this.schemaAuthor,
      schemaMessage: this.schemaMessage,
      documents: docs,
    };
    return canonicalize(payload) + "\n";
  }

  private publish(): void {
    if (this.inject?.failDuringPublish) {
      throwFailure(
        graphStoreFailure("corrupt_state", "injected failure during publish"),
      );
    }
    if (this.root === null || this.pin === null) {
      // In-memory: no concurrent merge needed; bump generation id only.
      this.generationId = nextGenerationId(this.generationId);
      this.baseGenerationId = this.generationId;
      this.baseMemory = cloneDocMap(this.memory);
      return;
    }
    const root = this.root;
    const pin = this.pin;
    const prevInject = activeInject;
    activeInject = this.inject;
    try {
      withRootGateSync(root, () => {
        withEffectLockSync(root, pin, () => {
          const live = loadCurrentGeneration(root, pin);
          const liveMap = cloneDocMap(live.documents);
          const merged = mergePublication(
            this.baseMemory,
            this.memory,
            liveMap,
          );
          // Validate merged graph before durable publish
          const mergedRecord = Object.fromEntries(merged.entries());
          try {
            validateDocumentMap(mergedRecord, {
              maxTraversalSteps: MAX_TRAVERSAL_STEPS,
            });
          } catch (e) {
            if (e instanceof SchemaValidationError) throw e;
            throw e;
          }
          const genId = nextGenerationId(live.generationId);
          // Schema: prefer local if registered, else live
          const schemaRegistered =
            this.schemaRegistered || live.schemaRegistered;
          const schema = this.schemaRegistered
            ? this.schema
            : live.schema;
          const schemaAuthor = this.schemaRegistered
            ? this.schemaAuthor
            : live.schemaAuthor;
          const schemaMessage = this.schemaRegistered
            ? this.schemaMessage
            : live.schemaMessage;
          const snap: GenerationSnapshot = {
            schemaVersion: GRAPH_STORE_SCHEMA_VERSION,
            generationId: genId,
            schemaRegistered,
            schema,
            schemaAuthor,
            schemaMessage,
            documents: Object.fromEntries(
              [...merged.keys()]
                .sort()
                .map((k) => [k, merged.get(k)!]),
            ),
          };
          publishSnapshot(root, pin, snap);
          // Commit handle state only after durable publish.
          this.generationId = genId;
          this.baseGenerationId = genId;
          this.memory = cloneDocMap(merged);
          this.baseMemory = cloneDocMap(merged);
          this.schemaRegistered = schemaRegistered;
          this.schema = schema == null ? null : isolateJson(schema);
          this.schemaAuthor = schemaAuthor;
          this.schemaMessage = schemaMessage;
        });
      });
    } finally {
      activeInject = prevInject;
    }
  }

  private checkAcyclicEdges(body: JsonObject, docId: string): void {
    for (const edgeField of [
      "depends_on",
      "subtask_of",
      "broader_than",
      "resolved_to",
    ] as const) {
      if (body[edgeField] == null) continue;
      const edges = new Map<string, Set<string>>();
      for (const d of this.memory.values()) {
        const targets = asIdSet(d[edgeField]);
        if (targets.size > 0) edges.set(String(d["@id"]), targets);
      }
      edges.set(docId, asIdSet(body[edgeField]));
      if (detectsCycle(edges, docId, MAX_TRAVERSAL_STEPS)) {
        throw new SchemaValidationError(
          `${edgeField} would introduce a cycle at ${docId}`,
          { field: edgeField, detail: "acyclicity checked, not assumed" },
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Factories and Effect service
// ---------------------------------------------------------------------------

export function openFilesOnly(opts: FilesOnlyOptions = {}): FilesOnlyGraphStore {
  return FilesOnlyGraphStore.open(opts);
}

export function openFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FilesOnlyGraphStore {
  const kind = (
    env["FOREMAN_GRAPH_STORE"] || "files_only"
  )
    .trim()
    .toLowerCase();
  const root = env["FOREMAN_GRAPH_STORE_ROOT"] || null;
  if (
    kind === "" ||
    kind === "files" ||
    kind === "files_only" ||
    kind === "file" ||
    kind === "default"
  ) {
    return openFilesOnly({ root, autoSchema: true });
  }
  if (kind === "terminusdb" || kind === "tdb" || kind === "terminus") {
    throwFailure(
      graphStoreFailure(
        "backend_misconfiguration",
        "TerminusDB adapter is deferred. Unset FOREMAN_GRAPH_STORE or set it to files_only.",
      ),
    );
  }
  throwFailure(
    graphStoreFailure(
      "backend_misconfiguration",
      `unknown FOREMAN_GRAPH_STORE=${JSON.stringify(kind)}; accepted: files_only`,
    ),
  );
}

export class GraphStoreService extends Context.Tag("GraphStoreService")<
  GraphStoreService,
  {
    readonly open: (
      opts?: FilesOnlyOptions,
    ) => Effect.Effect<FilesOnlyGraphStore, GraphStoreFailure, Scope.Scope>;
  }
>() {}

export const liveGraphStoreService = Layer.succeed(GraphStoreService, {
  open: (opts) =>
    Effect.acquireRelease(
      Effect.try({
        try: () => openFilesOnly(opts),
        catch: (e) => mapUnknownToFailure(e, "open failed"),
      }),
      (_store) => Effect.void,
    ),
});

export function openFilesOnlyEffect(
  opts: FilesOnlyOptions = {},
): Effect.Effect<FilesOnlyGraphStore, GraphStoreFailure, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.try({
      try: () => openFilesOnly(opts),
      catch: (e) => mapUnknownToFailure(e, "open failed"),
    }),
    (_store) => Effect.void,
  );
}

// Re-export helpers used by tests
export {
  resolveStoreRoot,
  loadCurrentGeneration,
  publishSnapshot,
  observePathKind,
  acquireLockSync,
  releaseLockSync,
  OPTIONAL_CAPABILITIES,
  mergePublication,
  readRegularFileBounded,
  decodeSnapshot,
  pinRoot,
  recheckRoot,
  atomicWriteFile,
  isGraphStoreThrown,
  mapUnknownToFailure,
};
