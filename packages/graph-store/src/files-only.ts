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
} from "@foreman/core";
import { Context, Effect, Layer } from "effect";
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
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
  SchemaNotRegisteredError,
  SchemaValidationError,
  graphStoreFailure,
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
  defaultSchemaPayload,
  detectsCycle,
  validateDocument,
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
// Safe filesystem helpers
// ---------------------------------------------------------------------------

type FileIdentity = { readonly dev: number; readonly ino: number };

function identityOf(st: Stats): FileIdentity {
  return { dev: st.dev, ino: st.ino };
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
  // Disallow null bytes and obvious traversal segments in the input form.
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
    // Create parents carefully
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
  // Directories on Unix always have nlink >= 2; hard-link refusal applies to
  // regular store files (CURRENT, generation.json), not the root directory.
  return abs;
}

function ensureDirectoryTree(abs: string): void {
  // Create each component; refuse if any existing component is a symlink.
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
            graphStoreFailure("invalid_path", "failed to create store directory"),
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

function readRegularFileBounded(path: string): Buffer {
  const kind = observePathKind(path);
  if (kind === "symlink") {
    throwFailure(
      graphStoreFailure("symlink_rejected", "refusing to read symlink"),
    );
  }
  if (kind !== "regular") {
    throwFailure(
      graphStoreFailure("corrupt_state", "expected a regular file"),
    );
  }
  const st = lstatSync(path);
  rejectIfHardLink(st, path);
  if (st.size > MAX_FILE_BYTES) {
    throwFailure(
      graphStoreFailure(
        "oversize_input",
        `file exceeds max ${MAX_FILE_BYTES} bytes`,
      ),
    );
  }
  const buf = readFileSync(path);
  if (buf.byteLength > MAX_FILE_BYTES) {
    throwFailure(
      graphStoreFailure(
        "oversize_input",
        `file exceeds max ${MAX_FILE_BYTES} bytes`,
      ),
    );
  }
  // Re-check identity after read
  const st2 = lstatSync(path);
  if (st2.dev !== st.dev || st2.ino !== st.ino || st2.nlink > 1) {
    throwFailure(
      graphStoreFailure("identity_changed", "file identity changed during read"),
    );
  }
  return buf;
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

function atomicWriteFile(path: string, bytes: Buffer | string): void {
  const dir = dirname(path);
  ensureDirectoryTree(dir);
  const tmp = join(dir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    const fd = openSync(
      tmp,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o644,
    );
    try {
      const data = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
      if (data.byteLength > MAX_FILE_BYTES) {
        throwFailure(
          graphStoreFailure(
            "oversize_input",
            `write exceeds max ${MAX_FILE_BYTES} bytes`,
          ),
        );
      }
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const st = lstatSync(tmp);
    if (st.isSymbolicLink() || !st.isFile() || st.nlink > 1) {
      throwFailure(
        graphStoreFailure("corrupt_state", "temp file is not a safe regular file"),
      );
    }
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    if (isGraphStoreThrown(e)) throw e;
    throwFailure(
      graphStoreFailure("corrupt_state", "atomic write failed"),
    );
  }
}

function isGraphStoreThrown(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === "GraphStoreError" ||
      e.name === "SchemaValidationError" ||
      e.name === "SchemaNotRegisteredError" ||
      e.name.endsWith("Error"))
  );
}

// ---------------------------------------------------------------------------
// File lock
// ---------------------------------------------------------------------------

type HeldLock = {
  readonly fd: number;
  readonly path: string;
  readonly identity: FileIdentity;
};

function acquireLockSync(lockPath: string): HeldLock {
  const deadline = Date.now() + STORE_LOCK_BOUND_MS;
  let attempts = 0;
  while (Date.now() < deadline && attempts < MAX_LOCK_RETRIES) {
    attempts += 1;
    const kind = observePathKind(lockPath);
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
        lockPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o644,
      );
      try {
        writeSync(fd, Buffer.from(`${process.pid}\n`, "utf8"));
        fsyncSync(fd);
      } catch {
        closeSync(fd);
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
        throwFailure(graphStoreFailure("store_busy", "failed to write lock"));
      }
      const st = lstatSync(lockPath);
      if (st.isSymbolicLink() || !st.isFile() || st.nlink > 1) {
        closeSync(fd);
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
        throwFailure(
          graphStoreFailure("corrupt_state", "lock file is not a safe regular file"),
        );
      }
      return { fd, path: lockPath, identity: identityOf(st) };
    } catch (e) {
      if (isEexist(e)) {
        // Busy spin
        const end = Date.now() + STORE_LOCK_SPIN_MS;
        while (Date.now() < end) {
          /* spin */
        }
        continue;
      }
      throwFailure(graphStoreFailure("store_busy", "failed to acquire store lock"));
    }
  }
  throwFailure(
    graphStoreFailure("store_busy", "store lock acquisition timed out"),
  );
}

function releaseLockSync(lock: HeldLock): void {
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
  if (typeof o["schemaAuthor"] !== "string" || typeof o["schemaMessage"] !== "string") {
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
  const docs = o["documents"] as Record<string, JsonObject>;
  for (const [id, doc] of Object.entries(docs)) {
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      throwFailure(
        graphStoreFailure("corrupt_state", `document ${id} is not an object`),
      );
    }
  }
  return {
    schemaVersion: GRAPH_STORE_SCHEMA_VERSION,
    generationId: o["generationId"] as string,
    schemaRegistered: o["schemaRegistered"] as boolean,
    schema: o["schema"] ?? null,
    schemaAuthor: o["schemaAuthor"] as string,
    schemaMessage: o["schemaMessage"] as string,
    documents: docs,
  };
}

function loadCurrentGeneration(root: string): GenerationSnapshot {
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
  const buf = readRegularFileBounded(cur);
  const textOrFail = decodeUtf8Fatal(new Uint8Array(buf));
  if (isCoreFailure(textOrFail)) {
    throwFailure(
      graphStoreFailure(
        textOrFail._tag === "MalformedUtf8" ? "malformed_utf8" : "oversize_input",
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
  const raw = parseCanonicalJsonBytes(readRegularFileBounded(genPath));
  const snap = decodeSnapshot(raw);
  if (snap.generationId !== genId) {
    throwFailure(
      graphStoreFailure(
        "corrupt_state",
        "generation id mismatch between CURRENT and snapshot",
      ),
    );
  }
  return snap;
}

function publishSnapshot(root: string, snap: GenerationSnapshot): void {
  countFilesUnder(root);
  const genDir = assertUnderRoot(
    root,
    join(generationsDir(root), snap.generationId),
  );
  ensureDirectoryTree(genDir);
  const genPath = assertUnderRoot(root, generationFile(root, snap.generationId));
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
  atomicWriteFile(genPath, text);
  // Select current generation only after the generation file is durable.
  const curText = `${snap.generationId}\n`;
  atomicWriteFile(currentPath(root), curText);
  // Identity re-check
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
// FilesOnlyGraphStore
// ---------------------------------------------------------------------------

export type FilesOnlyOptions = {
  readonly root?: string | null;
  readonly autoSchema?: boolean;
  /** Test seam: override lock timing. */
  readonly lockBoundMs?: number;
  readonly lockSpinMs?: number;
};

export class FilesOnlyGraphStore implements GraphStore {
  private readonly root: string | null;
  private memory: Map<string, JsonObject> = new Map();
  private schema: unknown = null;
  private schemaRegistered = false;
  private schemaAuthor = "";
  private schemaMessage = "";
  private generationId: string;
  private readonly rootKey: string;

  private constructor(root: string | null, autoSchema: boolean) {
    this.root = root;
    this.rootKey = root ?? `__memory__:${Math.random().toString(16)}`;
    this.generationId = nextGenerationId(null);
    if (root !== null) {
      const lock = acquireLockSync(lockPath(root));
      try {
        const snap = loadCurrentGeneration(root);
        this.generationId = snap.generationId;
        this.schemaRegistered = snap.schemaRegistered;
        this.schema = snap.schema;
        this.schemaAuthor = snap.schemaAuthor;
        this.schemaMessage = snap.schemaMessage;
        this.memory = new Map(Object.entries(snap.documents));
      } finally {
        releaseLockSync(lock);
      }
    }
    if (autoSchema) {
      this.registerSchema(defaultSchemaPayload(), {
        author: "foreman",
        message: "auto",
      });
    }
  }

  static open(opts: FilesOnlyOptions = {}): FilesOnlyGraphStore {
    const autoSchema = opts.autoSchema === true;
    if (opts.root == null || opts.root === "") {
      return new FilesOnlyGraphStore(null, autoSchema);
    }
    const root = resolveStoreRoot(opts.root);
    return withRootGateSync(root, () => new FilesOnlyGraphStore(root, autoSchema));
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
    this.schema = schema;
    this.schemaRegistered = true;
    this.schemaAuthor = opts?.author ?? "foreman";
    this.schemaMessage = opts?.message ?? "register schema";
    this.publish();
  }

  upsertDocument(doc: JsonObject): string {
    if (!this.schemaRegistered) {
      throw new SchemaNotRegisteredError();
    }
    const body: JsonObject = { ...doc };
    const docId = validateDocument(body);
    body["@id"] = docId;

    this.checkAcyclicEdges(body, docId);

    if (body["resolved_to"] != null) {
      const prior = this.memory.get(docId);
      if (
        prior &&
        prior["resolved_to"] != null &&
        prior["resolved_to"] !== body["resolved_to"]
      ) {
        throw new SchemaValidationError(
          `RESOLVED_TO is functional: ${docId} already resolves to ${JSON.stringify(prior["resolved_to"])}`,
          { field: "resolved_to" },
        );
      }
    }

    this.memory.set(docId, body);
    this.publish();
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
    return { ...doc };
  }

  listDocuments(docType?: string | null): JsonObject[] {
    const out: JsonObject[] = [];
    for (const id of [...this.memory.keys()].sort()) {
      const doc = this.memory.get(id);
      if (!doc) continue;
      if (docType != null && doc["@type"] !== docType) continue;
      out.push({ ...doc });
    }
    return out;
  }

  query(
    name: string,
    opts: { readonly expectEmpty: boolean; readonly params?: JsonObject | null },
  ): QueryResult {
    return runPortQuery(this, name, opts);
  }

  runQuery(name: string, params: JsonObject): readonly unknown[] {
    const index = indexFromDocuments(
      Object.fromEntries(this.memory.entries()),
    );
    return runNamedQuery(index, name, params);
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
    if (this.root === null) {
      // In-memory: bump generation id only.
      this.generationId = nextGenerationId(this.generationId);
      return;
    }
    const root = this.root;
    withRootGateSync(root, () => {
      const lock = acquireLockSync(lockPath(root));
      try {
        // Re-load current to detect concurrent external writers and base new gen.
        const live = loadCurrentGeneration(root);
        // Our memory is authoritative for this handle; publish as successor.
        const genId = nextGenerationId(live.generationId);
        this.generationId = genId;
        const docs = Object.fromEntries(
          [...this.memory.keys()]
            .sort()
            .map((k) => [k, this.memory.get(k)!]),
        );
        const snap: GenerationSnapshot = {
          schemaVersion: GRAPH_STORE_SCHEMA_VERSION,
          generationId: genId,
          schemaRegistered: this.schemaRegistered,
          schema: this.schema,
          schemaAuthor: this.schemaAuthor,
          schemaMessage: this.schemaMessage,
          documents: docs,
        };
        publishSnapshot(root, snap);
      } finally {
        releaseLockSync(lock);
      }
    });
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
  const kind = (env["FOREMAN_GRAPH_STORE"] || "files_only").trim().toLowerCase();
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
    ) => Effect.Effect<FilesOnlyGraphStore, GraphStoreFailure>;
  }
>() {}

export const liveGraphStoreService = Layer.succeed(GraphStoreService, {
  open: (opts) =>
    Effect.try({
      try: () => openFilesOnly(opts),
      catch: (e) => {
        if (
          e &&
          typeof e === "object" &&
          "failure" in e &&
          (e as { failure: GraphStoreFailure }).failure
        ) {
          return (e as { failure: GraphStoreFailure }).failure;
        }
        return graphStoreFailure(
          "backend_misconfiguration",
          e instanceof Error ? e.message : "open failed",
        );
      },
    }),
});

export function openFilesOnlyEffect(
  opts: FilesOnlyOptions = {},
): Effect.Effect<FilesOnlyGraphStore, GraphStoreFailure> {
  return Effect.try({
    try: () => openFilesOnly(opts),
    catch: (e) => {
      if (
        e &&
        typeof e === "object" &&
        "failure" in e &&
        (e as { failure: GraphStoreFailure }).failure
      ) {
        return (e as { failure: GraphStoreFailure }).failure;
      }
      return graphStoreFailure(
        "backend_misconfiguration",
        e instanceof Error ? e.message : "open failed",
      );
    },
  });
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
};
