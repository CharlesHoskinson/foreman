/**
 * Files-only SessionStore: the port's second implementation.
 *
 * No database, no network, no native module. State is a canonical sidecar
 * document published as an immutable generation, with CURRENT naming the live
 * one. Projection outbox state is published as a paired immutable generation
 * under the same token.
 *
 *   <dir>/
 *     CURRENT                              # one token + newline
 *     .writer-claims/                      # unique per-owner claim files
 *     generations/
 *       <token>.ndjson                     # immutable snapshot
 *     outbox-generations/
 *       <token>.ndjson                     # versioned canonical outbox
 *
 * Tokens are either legacy `NNNNNNNN.ndjson` (8 digits) or paired
 * `v2-NNNNNNNN.ndjson`. Legacy opens synthesize active upserts in memory when
 * the outbox sidecar is absent; the next writable publish makes the paired
 * format durable. A paired token with a missing or malformed outbox file is
 * `sidecar_malformed`, never an empty queue.
 *
 * WHY THIS EXISTS
 * ---------------
 * A contract satisfied once is a description of its only implementation. Until
 * `contract-suite.ts` passes unchanged against a backend that shares no code
 * with SQLite, "the port is portable" is an assertion rather than a measurement.
 * Every rejection below therefore reuses the SAME failure reason SQLite raises
 * for the same condition — the suite compares `reasonOf(e)` exactly, so
 * refusing correctly with a different tag is still a contract violation.
 *
 * The generation body is produced by `encodeSnapshot`, not by a bespoke
 * serializer. That is deliberate: the canonical encoding is already the declared
 * wire form, already byte-stable, and already covered by the `encoding/*` cases.
 * A second serializer would be a second thing to get wrong. It also validates —
 * `encodeSnapshot` calls `assertIntegrity` — so a mutation that would corrupt
 * the store throws before anything is written and leaves the store exactly as it
 * was, which is how this backend satisfies the port's all-or-nothing clause
 * without transactions.
 *
 * LIMITATION, STATED RATHER THAN DISCOVERED
 * -----------------------------------------
 * Exclusive writer ownership is a single-host claim-file lock under
 * `.writer-claims/` (unique O_EXCL claim per owner; stale claims reaped by
 * their own filenames; one deterministic live winner). It is not a network
 * filesystem lease and must not be treated as one. Concurrent writers on a
 * shared network mount are unsupported. Read-only opens remain lock-free.
 */

import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

import {
  SESSION_MODEL_VERSION,
  countRows,
  emptySnapshot,
  type CountedKind,
  type FactRow,
  type MeasurementRow,
  type NextIds,
  type ObligationRow,
  type ObligationStatus,
  type SessionRow,
  type SessionSnapshot,
} from "./entities.js";
import { raise } from "./failures.js";
import { assertIntegrity } from "./integrity.js";
import {
  additiveImportProjectionUpserts,
  planAdditiveRemapImport,
  resolveIdCollisionPolicy,
  snapshotIsOccupied,
} from "./import-remap.js";
import {
  buildProjection,
  isProjectIdV1,
  liveProjectionMap,
  projectionKey,
  retractRecord,
  upsertRecord,
} from "./projection.js";
import { decodeSnapshot, encodeSnapshot } from "./sidecar.js";
import type {
  ImportOptions,
  NewFact,
  NewMeasurement,
  NewObligation,
  OutboxEntry,
  ProjectionRecord,
  SessionStore,
  SupersedeResult,
} from "./port.js";

export type FilesOnlyOptions = {
  /** Directory holding CURRENT and generations/. Created if absent when writable. */
  readonly dir: string;
  /**
   * Open without creating directories, publishing generations, or writing
   * CURRENT. Mutations refuse with invalid_argument.
   */
  readonly readOnly?: boolean;
};

const CURRENT = "CURRENT";
const GENERATIONS = "generations";
const OUTBOX_GENERATIONS = "outbox-generations";
const WRITER_CLAIMS_DIR = ".writer-claims";
const GEN_WIDTH = 8;
const OUTBOX_LIMIT_MIN = 1;
const OUTBOX_LIMIT_MAX = 1000;
const OUTBOX_FILE_VERSION = 2;
const LEGACY_OUTBOX_FILE_VERSION = 1;
/** Internal numeric receipt form: r followed by a positive decimal (no leading zeros). */
const INTERNAL_NUMERIC_RECEIPT = /^r([1-9][0-9]*)$/;

const LEGACY_TOKEN_RE = /^\d{8}\.ndjson$/;
const PAIRED_TOKEN_RE = /^v2-\d{8}\.ndjson$/;

function genName(n: number): string {
  return `v2-${String(n).padStart(GEN_WIDTH, "0")}.ndjson`;
}

function isLegacyToken(name: string): boolean {
  return LEGACY_TOKEN_RE.test(name);
}

function isPairedToken(name: string): boolean {
  return PAIRED_TOKEN_RE.test(name);
}

function genNumberFromToken(name: string): number | null {
  if (isPairedToken(name)) {
    const n = Number.parseInt(name.slice(3, 3 + GEN_WIDTH), 10);
    return Number.isFinite(n) ? n : null;
  }
  if (isLegacyToken(name)) {
    const n = Number.parseInt(name.slice(0, GEN_WIDTH), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

let counter = 0;

/** Write `text` into `dir` via temp+fsync+rename. Does not fsync the directory. */
function writeFileAtomic(dir: string, name: string, text: string): void {
  const tmp = join(dir, `.tmp-${name}-${process.pid}-${counter++}`);
  const fd = openSync(tmp, "wx", 0o644);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, join(dir, name));
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // the temp file is already gone; the rename failure is the real error
    }
    throw e;
  }
}

/** Write `text` durably into `dir`: temp file, fsync, rename, fsync directory. */
function writeFileDurable(dir: string, name: string, text: string): void {
  writeFileAtomic(dir, name, text);
  fsyncDir(dir);
}

/**
 * fsync a directory so a rename into it is durable.
 *
 * A failure here is reported, never swallowed: on some filesystems opening a
 * directory for fsync is not permitted, and silently continuing would turn a
 * durability gap into a success. It is separated from the write path so the
 * caller can see which step failed.
 */
function fsyncDir(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function sortedSnapshot(s: SessionSnapshot): SessionSnapshot {
  // Row order is part of the declared contract — specFor(kind).ordering, which
  // SQLite honours with ORDER BY. hostile/rows-out-of-declared-order exists
  // precisely because a reader may refuse an out-of-order document.
  return {
    modelVersion: s.modelVersion,
    nextIds: s.nextIds,
    sessions: [...s.sessions].sort((a, b) =>
      a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0,
    ),
    facts: [...s.facts].sort((a, b) => a.id - b.id),
    measurements: [...s.measurements].sort((a, b) => a.id - b.id),
    obligations: [...s.obligations].sort((a, b) => a.id - b.id),
  };
}

function copyRecord(record: ProjectionRecord): ProjectionRecord {
  const project =
    record.project_id === undefined
      ? {}
      : { project_id: record.project_id };
  if (record.mutation === "upsert") {
    return {
      ...project,
      key: record.key,
      kind: record.kind,
      id: record.id,
      mutation: "upsert",
      text: record.text,
    };
  }
  return {
    ...project,
    key: record.key,
    kind: record.kind,
    id: record.id,
    mutation: "retract",
  };
}

function copyEntry(entry: OutboxEntry): OutboxEntry {
  return { receipt: entry.receipt, record: copyRecord(entry.record) };
}

function encodeOutbox(
  entries: readonly OutboxEntry[],
  nextReceipt: number,
  projectId: string | null,
): string {
  return `${JSON.stringify({
    version: OUTBOX_FILE_VERSION,
    projectId,
    nextReceipt,
    entries: entries.map(copyEntry),
  })}\n`;
}

function isCountedKindName(v: unknown): v is CountedKind {
  return v === "fact" || v === "measurement" || v === "obligation";
}

function decodeOutbox(text: string): {
  readonly entries: OutboxEntry[];
  readonly nextReceipt: number;
  readonly projectId: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    raise("sidecar_malformed", "outbox generation is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    raise("sidecar_malformed", "outbox generation root must be an object");
  }
  const root = parsed as Record<string, unknown>;
  if (
    root["version"] !== LEGACY_OUTBOX_FILE_VERSION &&
    root["version"] !== OUTBOX_FILE_VERSION
  ) {
    raise(
      "sidecar_malformed",
      `outbox generation version ${String(root["version"])} is unsupported`,
    );
  }
  const projectId = root["version"] === LEGACY_OUTBOX_FILE_VERSION
    ? null
    : root["projectId"];
  if (projectId !== null && !isProjectIdV1(projectId)) {
    raise("sidecar_malformed", "outbox projectId must be null or a lowercase UUID");
  }
  if (!Array.isArray(root["entries"])) {
    raise("sidecar_malformed", "outbox generation entries must be an array");
  }
  const seenReceipts = new Set<string>();
  const seenIdentities = new Set<string>();
  const entries: OutboxEntry[] = [];
  let maxNumericReceipt = 0;
  for (const raw of root["entries"]) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      raise("sidecar_malformed", "outbox entry must be an object");
    }
    const e = raw as Record<string, unknown>;
    if (typeof e["receipt"] !== "string" || e["receipt"].length === 0) {
      raise("sidecar_malformed", "outbox entry receipt must be a non-empty string");
    }
    if (seenReceipts.has(e["receipt"])) {
      raise("sidecar_malformed", "outbox receipts must be unique");
    }
    seenReceipts.add(e["receipt"]);
    const numeric = INTERNAL_NUMERIC_RECEIPT.exec(e["receipt"]);
    if (numeric) {
      const n = Number(numeric[1]);
      if (Number.isSafeInteger(n) && n > maxNumericReceipt) maxNumericReceipt = n;
    }
    const rec = e["record"];
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      raise("sidecar_malformed", "outbox entry record must be an object");
    }
    const r = rec as Record<string, unknown>;
    if (!isCountedKindName(r["kind"])) {
      raise("sidecar_malformed", "outbox record kind is invalid");
    }
    if (typeof r["id"] !== "number" || !Number.isSafeInteger(r["id"])) {
      raise("sidecar_malformed", "outbox record id must be a safe integer");
    }
    const identity = projectionKey(r["kind"], r["id"], projectId);
    if (seenIdentities.has(identity)) {
      raise(
        "sidecar_malformed",
        "outbox desired-state identities (kind,id) must be unique",
      );
    }
    seenIdentities.add(identity);
    if (typeof r["key"] !== "string" || r["key"] !== identity) {
      raise("sidecar_malformed", "outbox record key does not match its identity");
    }
    if (
      (projectId === null && r["project_id"] !== undefined) ||
      (projectId !== null && r["project_id"] !== projectId)
    ) {
      raise("sidecar_malformed", "outbox record project_id does not match metadata");
    }
    const project = projectId === null ? {} : { project_id: projectId };
    if (r["mutation"] === "upsert") {
      if (typeof r["text"] !== "string") {
        raise("sidecar_malformed", "outbox upsert record text must be a string");
      }
      entries.push({
        receipt: e["receipt"],
        record: {
          ...project,
          key: r["key"],
          kind: r["kind"],
          id: r["id"],
          mutation: "upsert",
          text: r["text"],
        },
      });
    } else if (r["mutation"] === "retract") {
      entries.push({
        receipt: e["receipt"],
        record: {
          ...project,
          key: r["key"],
          kind: r["kind"],
          id: r["id"],
          mutation: "retract",
        },
      });
    } else {
      raise("sidecar_malformed", "outbox record mutation must be upsert or retract");
    }
  }

  if (!Object.prototype.hasOwnProperty.call(root, "nextReceipt")) {
    raise("sidecar_malformed", "outbox generation nextReceipt is required");
  }
  if (
    typeof root["nextReceipt"] !== "number" ||
    !Number.isSafeInteger(root["nextReceipt"]) ||
    root["nextReceipt"] < 1
  ) {
    raise(
      "sidecar_malformed",
      "outbox nextReceipt must be a positive safe integer",
    );
  }
  const nextReceipt = root["nextReceipt"];
  // MAX_SAFE_INTEGER is a valid readable exhausted counter; minting refuses later.
  if (nextReceipt <= maxNumericReceipt) {
    raise(
      "sidecar_malformed",
      "outbox nextReceipt must be strictly greater than every numeric receipt",
    );
  }
  return { entries, nextReceipt, projectId };
}

function synthesizeOutbox(
  snap: SessionSnapshot,
  projectId: string | null = null,
): {
  readonly entries: OutboxEntry[];
  readonly nextReceipt: number;
} {
  const entries: OutboxEntry[] = [];
  let nextReceipt = 1;
  for (const record of buildProjection(snap, projectId)) {
    entries.push({ receipt: `r${nextReceipt++}`, record: copyRecord(record) });
  }
  return { entries, nextReceipt };
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EPERM") return true;
    return false;
  }
}

/** Host process-start identity when `/proc/<pid>/stat` exposes starttime. */
function processStartIdentity(pid: number): string | null {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = raw.lastIndexOf(")");
    if (closeParen < 0) return null;
    const fields = raw.slice(closeParen + 2).split(" ");
    const start = fields[19];
    return start !== undefined && /^\d+$/.test(start) ? start : null;
  } catch {
    return null;
  }
}

type WriterClaimBody = {
  readonly pid: number;
  readonly startIdentity: string | null;
  readonly ownerToken: string;
};

type WriterClaim = {
  readonly path: string;
  readonly token: string;
};

function claimsDir(dir: string): string {
  return join(dir, WRITER_CLAIMS_DIR);
}

function encodeClaim(body: WriterClaimBody): string {
  return `${JSON.stringify(body)}\n`;
}

function parseClaim(text: string): WriterClaimBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  if (typeof o["pid"] !== "number" || !Number.isSafeInteger(o["pid"]) || o["pid"] <= 0) {
    return null;
  }
  if (typeof o["ownerToken"] !== "string" || o["ownerToken"].length === 0) {
    return null;
  }
  const startIdentity =
    o["startIdentity"] === null
      ? null
      : typeof o["startIdentity"] === "string"
        ? o["startIdentity"]
        : null;
  if (o["startIdentity"] !== null && startIdentity === null) return null;
  return {
    pid: o["pid"],
    startIdentity,
    ownerToken: o["ownerToken"],
  };
}

function isClaimLive(body: WriterClaimBody): boolean {
  if (!isProcessAlive(body.pid)) return false;
  if (body.startIdentity === null) return true;
  const current = processStartIdentity(body.pid);
  if (current === null) return true;
  return current === body.startIdentity;
}

/**
 * Acquire exclusive single-writer ownership for this directory.
 * Single-host only: unique claim files under `.writer-claims/`; stale claims
 * are deleted by their own filenames; one deterministic live claim wins.
 */
function acquireWriterLock(dir: string): WriterClaim {
  const dirPath = claimsDir(dir);
  mkdirSync(dirPath, { recursive: true });

  const token = randomBytes(16).toString("hex");
  const startIdentity = processStartIdentity(process.pid);
  const claimName = `claim-${Date.now().toString().padStart(15, "0")}-${token}.json`;
  const claimPath = join(dirPath, claimName);
  const body: WriterClaimBody = {
    pid: process.pid,
    startIdentity,
    ownerToken: token,
  };

  const fd = openSync(claimPath, "wx", 0o644);
  try {
    writeSync(fd, encodeClaim(body));
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    try {
      unlinkSync(claimPath);
    } catch {
      // ignore cleanup failure; surface the write error
    }
    throw e;
  }
  closeSync(fd);
  try {
    fsyncDir(dirPath);
  } catch {
    // directory fsync is best-effort for claim visibility; election still runs
  }

  try {
    type LiveClaim = {
      readonly name: string;
      readonly path: string;
      readonly mtimeMs: number;
    };

    const scanLive = (): LiveClaim[] => {
      const live: LiveClaim[] = [];
      for (const name of readdirSync(dirPath)) {
        if (!name.startsWith("claim-") || !name.endsWith(".json")) continue;
        const path = join(dirPath, name);
        let raw: string;
        try {
          raw = readFileSync(path, "utf8");
        } catch {
          continue;
        }
        const parsed = parseClaim(raw);
        if (parsed === null || !isClaimLive(parsed)) {
          // Delete only stale claims by their unique filenames.
          if (path !== claimPath) {
            try {
              unlinkSync(path);
            } catch {
              // concurrent reap
            }
          }
          continue;
        }
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(path).mtimeMs;
        } catch {
          continue;
        }
        live.push({ name, path, mtimeMs });
      }
      live.sort((a, b) => {
        if (a.mtimeMs !== b.mtimeMs) return a.mtimeMs - b.mtimeMs;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      return live;
    };

    const lose = (winner: LiveClaim | undefined): never => {
      try {
        unlinkSync(claimPath);
      } catch {
        // already gone
      }
      const ownerHint =
        winner !== undefined
          ? `another live claim (${winner.name})`
          : "no winning live claim";
      raise(
        "invalid_argument",
        `files-only store directory is owned by another live writable handle ` +
          `(${ownerHint}); single-host exclusive writer only, not a network filesystem lease`,
      );
    };

    // Stabilize against the create-then-scan race where two reclaimers each
    // briefly observe only their own claim. Oldest mtime wins; losers delete
    // only their own claim. A sole-winner observation is confirmed by at least
    // one delayed rescan so a concurrent creator is not missed.
    let soleWins = 0;
    for (let round = 0; round < 40; round++) {
      const live = scanLive();
      const winner = live[0];
      if (winner === undefined || winner.path !== claimPath) {
        return lose(winner);
      }
      if (live.length === 1) {
        soleWins += 1;
        if (soleWins >= 2) {
          return { path: claimPath, token };
        }
      } else {
        soleWins = 0;
      }
      // Wait briefly without deleting other live claims, then rescan.
      const waitUntil = Date.now() + 10;
      while (Date.now() < waitUntil) {
        // spin
      }
    }
    return lose(scanLive()[0]);
  } catch (e) {
    try {
      unlinkSync(claimPath);
    } catch {
      // already gone
    }
    throw e;
  }
}

/** Release only the exact owned claim file. */
function releaseWriterClaim(claim: WriterClaim): void {
  try {
    unlinkSync(claim.path);
  } catch {
    // already gone
  }
}

type QueueState = {
  entries: OutboxEntry[];
  nextReceipt: number;
};

function cloneQueue(
  entries: readonly OutboxEntry[],
  nextReceipt: number,
): QueueState {
  return {
    entries: entries.map(copyEntry),
    nextReceipt,
  };
}

/** Refuse minting when the counter is exhausted or no longer a mintable value. */
function assertReceiptCounterMintable(nextReceipt: number): void {
  if (
    !Number.isSafeInteger(nextReceipt) ||
    nextReceipt < 1 ||
    nextReceipt >= Number.MAX_SAFE_INTEGER
  ) {
    raise("invalid_argument", "outbox nextReceipt is exhausted");
  }
}

/** Coalesce by (kind,id). Fresh receipt on change; keep original queue position. */
function queueRecord(q: QueueState, record: ProjectionRecord): void {
  assertReceiptCounterMintable(q.nextReceipt);
  const receipt = `r${q.nextReceipt++}`;
  const entry: OutboxEntry = { receipt, record: copyRecord(record) };
  const idx = q.entries.findIndex(
    (e) => e.record.kind === record.kind && e.record.id === record.id,
  );
  if (idx >= 0) {
    q.entries[idx] = entry;
    return;
  }
  q.entries.push(entry);
}

function queueUpsert(
  q: QueueState,
  kind: CountedKind,
  id: number,
  row: Readonly<Record<string, unknown>>,
  projectId: string | null,
): void {
  queueRecord(q, upsertRecord(kind, id, row, projectId));
}

function queueRetract(
  q: QueueState,
  kind: CountedKind,
  id: number,
  projectId: string | null,
): void {
  queueRecord(q, retractRecord(kind, id, projectId));
}

export class FilesOnlySessionStore implements SessionStore {
  readonly modelVersion = SESSION_MODEL_VERSION;

  readonly #dir: string;
  readonly #genDir: string;
  readonly #outboxDir: string;
  readonly #readOnly: boolean;
  readonly #writerClaim: WriterClaim | null;
  #snap: SessionSnapshot;
  #outbox: OutboxEntry[];
  #nextReceipt: number;
  #projectId: string | null;
  #gen: number;
  #closed = false;

  private constructor(
    dir: string,
    snap: SessionSnapshot,
    outbox: readonly OutboxEntry[],
    nextReceipt: number,
    projectId: string | null,
    gen: number,
    readOnly: boolean,
    writerClaim: WriterClaim | null,
  ) {
    this.#dir = dir;
    this.#genDir = join(dir, GENERATIONS);
    this.#outboxDir = join(dir, OUTBOX_GENERATIONS);
    this.#readOnly = readOnly;
    this.#writerClaim = writerClaim;
    this.#snap = snap;
    this.#outbox = outbox.map(copyEntry);
    this.#nextReceipt = nextReceipt;
    this.#projectId = projectId;
    this.#gen = gen;
  }

  static open(opts: FilesOnlyOptions): FilesOnlySessionStore {
    const dir = opts.dir;
    const readOnly = opts.readOnly === true;

    if (readOnly) {
      return FilesOnlySessionStore.#openReadOnly(dir);
    }

    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, GENERATIONS), { recursive: true });
    mkdirSync(join(dir, OUTBOX_GENERATIONS), { recursive: true });

    let claim: WriterClaim | null = null;
    try {
      claim = acquireWriterLock(dir);
      return FilesOnlySessionStore.#openWritable(dir, claim);
    } catch (e) {
      if (claim !== null) releaseWriterClaim(claim);
      throw e;
    }
  }

  static #openReadOnly(dir: string): FilesOnlySessionStore {
    if (!existsSync(dir)) {
      raise(
        "invalid_argument",
        `files-only store directory does not exist: ${JSON.stringify(dir)}`,
      );
    }
    const loaded = FilesOnlySessionStore.#loadLive(dir, join(dir, GENERATIONS));
    return new FilesOnlySessionStore(
      dir,
      loaded.snap,
      loaded.outbox,
      loaded.nextReceipt,
      loaded.projectId,
      loaded.gen,
      true,
      null,
    );
  }

  static #openWritable(
    dir: string,
    claim: WriterClaim,
  ): FilesOnlySessionStore {
    const currentPath = join(dir, CURRENT);
    if (!existsSync(currentPath)) {
      const store = new FilesOnlySessionStore(
        dir,
        emptySnapshot(),
        [],
        1,
        null,
        0,
        false,
        claim,
      );
      store.#publish(store.#snap, [], 1);
      return store;
    }

    const loaded = FilesOnlySessionStore.#loadLive(dir, join(dir, GENERATIONS));
    return new FilesOnlySessionStore(
      dir,
      loaded.snap,
      loaded.outbox,
      loaded.nextReceipt,
      loaded.projectId,
      loaded.gen,
      false,
      claim,
    );
  }

  static #loadLive(
    dir: string,
    genDir: string,
  ): {
    readonly snap: SessionSnapshot;
    readonly outbox: OutboxEntry[];
    readonly nextReceipt: number;
    readonly projectId: string | null;
    readonly gen: number;
  } {
    const currentPath = join(dir, CURRENT);
    if (!existsSync(currentPath)) {
      raise(
        "sidecar_malformed",
        `${CURRENT} is missing in ${JSON.stringify(dir)}`,
      );
    }
    const name = readFileSync(currentPath, "utf8").trim();
    if (name === "") {
      raise("sidecar_malformed", `${CURRENT} is empty in ${JSON.stringify(dir)}`);
    }
    if (!isLegacyToken(name) && !isPairedToken(name)) {
      raise(
        "sidecar_malformed",
        `${CURRENT} names unsupported generation token ${JSON.stringify(name)}`,
      );
    }
    const genPath = join(genDir, name);
    if (!existsSync(genPath)) {
      raise(
        "sidecar_malformed",
        `${CURRENT} names generation ${JSON.stringify(name)}, which does not exist`,
      );
    }
    const snap = decodeSnapshot(readFileSync(genPath, "utf8"));
    if (snap.modelVersion !== SESSION_MODEL_VERSION) {
      raise(
        "model_version_unsupported",
        `stored model version ${snap.modelVersion} != store ${SESSION_MODEL_VERSION}`,
      );
    }
    const parsedGen = genNumberFromToken(name);
    const gen =
      parsedGen !== null ? parsedGen : latestGeneration(genDir);

    if (isLegacyToken(name)) {
      const outboxPath = join(dir, OUTBOX_GENERATIONS, name);
      if (existsSync(outboxPath)) {
        // Unusual legacy layout with an outbox sibling: load it if well-formed.
        const decoded = decodeOutbox(readFileSync(outboxPath, "utf8"));
        return {
          snap,
          outbox: decoded.entries,
          nextReceipt: decoded.nextReceipt,
          projectId: decoded.projectId,
          gen,
        };
      }
      const synthesized = synthesizeOutbox(snap);
      return {
        snap,
        outbox: synthesized.entries,
        nextReceipt: synthesized.nextReceipt,
        projectId: null,
        gen,
      };
    }

    const outboxPath = join(dir, OUTBOX_GENERATIONS, name);
    if (!existsSync(outboxPath)) {
      raise(
        "sidecar_malformed",
        `paired outbox generation ${JSON.stringify(name)} is missing`,
      );
    }
    const decoded = decodeOutbox(readFileSync(outboxPath, "utf8"));
    return {
      snap,
      outbox: decoded.entries,
      nextReceipt: decoded.nextReceipt,
      projectId: decoded.projectId,
      gen,
    };
  }

  // -- publication ---------------------------------------------------------

  /**
   * Make `next` / `nextOutbox` the live paired generation.
   *
   * Order matters for crash atomicity:
   *   1. write+fsync+rename both generation files
   *   2. fsync both generation directories
   *   3. atomically replace+fsync CURRENT last
   *   4. only then update in-memory state
   *
   * A crash before CURRENT moves leaves both the old snapshot and the old
   * outbox live. `encodeSnapshot` runs first and throws on an invalid
   * snapshot, so nothing reaches the disk and in-memory state is untouched.
   */
  #publish(
    next: SessionSnapshot,
    nextOutbox: readonly OutboxEntry[],
    nextReceipt: number,
    projectId: string | null = this.#projectId,
  ): void {
    const ordered = sortedSnapshot(next);
    const snapText = encodeSnapshot(ordered);
    const outboxText = encodeOutbox(nextOutbox, nextReceipt, projectId);
    const gen = this.#gen + 1;
    const name = genName(gen);

    writeFileAtomic(this.#genDir, name, snapText);
    writeFileAtomic(this.#outboxDir, name, outboxText);
    fsyncDir(this.#genDir);
    fsyncDir(this.#outboxDir);
    writeFileDurable(this.#dir, CURRENT, `${name}\n`);

    this.#gen = gen;
    this.#snap = ordered;
    this.#outbox = nextOutbox.map(copyEntry);
    this.#nextReceipt = nextReceipt;
    this.#projectId = projectId;
  }

  #assertOpen(): void {
    if (this.#closed) {
      raise("invalid_argument", "store is closed");
    }
  }

  #assertWritable(): void {
    this.#assertOpen();
    if (this.#readOnly) {
      raise("invalid_argument", "store is read-only");
    }
  }

  // -- reads ---------------------------------------------------------------

  projectId(): string | null {
    this.#assertOpen();
    return this.#projectId;
  }

  bindProject(projectId: string): void {
    this.#assertWritable();
    if (!isProjectIdV1(projectId)) {
      raise("invalid_argument", "project id must be a lowercase UUID");
    }
    if (this.#projectId !== null && this.#projectId !== projectId) {
      raise("identity_conflict", "store is already bound to another project");
    }
    if (this.#projectId === projectId) return;

    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    for (const record of buildProjection(this.#snap, projectId)) {
      queueRecord(q, record);
    }
    this.#publish(this.#snap, q.entries, q.nextReceipt, projectId);
  }

  snapshot(): SessionSnapshot {
    this.#assertOpen();
    return this.#snap;
  }

  listSessions(): readonly SessionRow[] {
    this.#assertOpen();
    return this.#snap.sessions;
  }

  listFacts(): readonly FactRow[] {
    this.#assertOpen();
    return this.#snap.facts;
  }

  listMeasurements(): readonly MeasurementRow[] {
    this.#assertOpen();
    return this.#snap.measurements;
  }

  listObligations(): readonly ObligationRow[] {
    this.#assertOpen();
    return this.#snap.obligations;
  }

  currentSession(): SessionRow | null {
    this.#assertOpen();
    // Matches SQLite: WHERE ended_ts IS NULL ORDER BY session_id DESC LIMIT 1.
    let best: SessionRow | null = null;
    for (const s of this.#snap.sessions) {
      if (s.ended_ts !== null) continue;
      if (best === null || s.session_id > best.session_id) best = s;
    }
    return best;
  }

  peekNextId(kind: CountedKind): number {
    this.#assertOpen();
    return this.#snap.nextIds[kind];
  }

  #mint(kind: CountedKind): { readonly id: number; readonly nextIds: NextIds } {
    const id = this.#snap.nextIds[kind];
    return { id, nextIds: { ...this.#snap.nextIds, [kind]: id + 1 } };
  }

  // -- projection outbox ---------------------------------------------------

  listOutbox(limit: number): readonly OutboxEntry[] {
    this.#assertOpen();
    if (
      typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit < OUTBOX_LIMIT_MIN ||
      limit > OUTBOX_LIMIT_MAX
    ) {
      raise(
        "invalid_argument",
        `listOutbox limit must be an integer in ${OUTBOX_LIMIT_MIN}..${OUTBOX_LIMIT_MAX}`,
      );
    }
    return this.#outbox.slice(0, limit).map(copyEntry);
  }

  ackOutbox(receipts: readonly string[]): number {
    this.#assertWritable();
    if (receipts.length === 0) return 0;
    const unique = [...new Set(receipts)];
    const remove = new Set(unique);
    const remaining: OutboxEntry[] = [];
    let deleted = 0;
    for (const entry of this.#outbox) {
      if (remove.has(entry.receipt)) {
        deleted += 1;
        continue;
      }
      remaining.push(copyEntry(entry));
    }
    if (deleted === 0) return 0;
    // Unchanged snapshot, reduced outbox, new paired generation.
    this.#publish(this.#snap, remaining, this.#nextReceipt);
    return deleted;
  }

  // -- writes --------------------------------------------------------------

  beginSession(args: {
    readonly session_id: string;
    readonly started_ts: string;
    readonly start_sha: string | null;
    readonly note: string | null;
  }): SessionRow {
    this.#assertWritable();
    if (this.#snap.sessions.some((s) => s.session_id === args.session_id)) {
      // SQLite reaches the same refusal through the sessions primary key.
      raise(
        "identity_conflict",
        `session ${JSON.stringify(args.session_id)} already exists`,
      );
    }
    const row: SessionRow = {
      session_id: args.session_id,
      started_ts: args.started_ts,
      start_sha: args.start_sha,
      ended_ts: null,
      note: args.note,
    };
    // Session rows never enter the outbox.
    this.#publish(
      { ...this.#snap, sessions: [...this.#snap.sessions, row] },
      this.#outbox,
      this.#nextReceipt,
    );
    return row;
  }

  endSession(sessionId: string, endedTs: string): SessionRow {
    this.#assertWritable();
    const cur = this.#snap.sessions.find((s) => s.session_id === sessionId);
    if (!cur) {
      raise("invalid_argument", `no such session ${JSON.stringify(sessionId)}`);
    }
    if (cur.ended_ts !== null) {
      raise(
        "supersession_incomplete",
        `session ${JSON.stringify(sessionId)} is already ended; ended_ts is set-once`,
      );
    }
    const row: SessionRow = { ...cur, ended_ts: endedTs };
    this.#publish(
      {
        ...this.#snap,
        sessions: this.#snap.sessions.map((s) =>
          s.session_id === sessionId ? row : s,
        ),
      },
      this.#outbox,
      this.#nextReceipt,
    );
    return row;
  }

  addFact(fact: NewFact): FactRow {
    this.#assertWritable();
    const { row, next } = this.#buildFact(fact);
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueUpsert(
      q,
      "fact",
      row.id,
      row as unknown as Record<string, unknown>,
      this.#projectId,
    );
    this.#publish(next, q.entries, q.nextReceipt);
    return row;
  }

  /** Shared by addFact and supersedeFact; does not publish or queue. */
  #buildFact(fact: NewFact): {
    readonly row: FactRow;
    readonly next: SessionSnapshot;
  } {
    const { id, nextIds } = this.#mint("fact");
    const row: FactRow = {
      id,
      statement: fact.statement,
      evidence: fact.evidence,
      established_ts: fact.established_ts,
      session_id: fact.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null,
    };
    return {
      row,
      next: { ...this.#snap, nextIds, facts: [...this.#snap.facts, row] },
    };
  }

  addMeasurement(m: NewMeasurement): MeasurementRow {
    this.#assertWritable();
    const { row, next } = this.#buildMeasurement(m);
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueUpsert(
      q,
      "measurement",
      row.id,
      row as unknown as Record<string, unknown>,
      this.#projectId,
    );
    this.#publish(next, q.entries, q.nextReceipt);
    return row;
  }

  #buildMeasurement(m: NewMeasurement): {
    readonly row: MeasurementRow;
    readonly next: SessionSnapshot;
  } {
    // Checked before an id is minted, as SQLite does: a refused write must not
    // consume an identity.
    if (m.value_num !== null && !Number.isFinite(m.value_num)) {
      raise("field_type", `value_num must be finite, got ${String(m.value_num)}`);
    }
    const { id, nextIds } = this.#mint("measurement");
    const row: MeasurementRow = {
      id,
      metric: m.metric,
      value: m.value,
      value_num: m.value_num,
      command: m.command,
      measured_ts: m.measured_ts,
      measured_sha: m.measured_sha,
      scope_paths: m.scope_paths,
      session_id: m.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null,
    };
    return {
      row,
      next: {
        ...this.#snap,
        nextIds,
        measurements: [...this.#snap.measurements, row],
      },
    };
  }

  addObligation(o: NewObligation): ObligationRow {
    this.#assertWritable();
    const { id, nextIds } = this.#mint("obligation");
    const row: ObligationRow = {
      id,
      statement: o.statement,
      status: "open",
      blocker: o.blocker,
      opened_ts: o.opened_ts,
      closed_ts: null,
      session_id: o.session_id,
    };
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueUpsert(
      q,
      "obligation",
      row.id,
      row as unknown as Record<string, unknown>,
      this.#projectId,
    );
    this.#publish(
      {
        ...this.#snap,
        nextIds,
        obligations: [...this.#snap.obligations, row],
      },
      q.entries,
      q.nextReceipt,
    );
    return row;
  }

  closeObligation(
    id: number,
    status: Exclude<ObligationStatus, "open">,
    closedTs: string,
  ): ObligationRow {
    this.#assertWritable();
    const cur = this.#snap.obligations.find((o) => o.id === id);
    if (!cur) raise("invalid_argument", `no such obligation ${id}`);
    if (cur.status !== "open") {
      raise(
        "invalid_argument",
        `obligation ${id} is already ${cur.status}; only an open obligation may be closed`,
      );
    }
    // Matches the port's declared semantics: blocker is never written here and
    // closed_ts is always stamped.
    const row: ObligationRow = { ...cur, status, closed_ts: closedTs };
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueUpsert(
      q,
      "obligation",
      id,
      row as unknown as Record<string, unknown>,
      this.#projectId,
    );
    this.#publish(
      {
        ...this.#snap,
        obligations: this.#snap.obligations.map((o) => (o.id === id ? row : o)),
      },
      q.entries,
      q.nextReceipt,
    );
    return row;
  }

  supersedeFact(
    id: number,
    replacement: NewFact,
    reason: string | null,
    at: string,
  ): SupersedeResult<FactRow> {
    this.#assertWritable();
    const cur = this.#snap.facts.find((f) => f.id === id);
    if (!cur) raise("invalid_argument", `no such fact ${id}`);
    if (cur.superseded_by !== null) {
      raise(
        "supersession_incomplete",
        `fact ${id} is already superseded; supersession columns are set-once`,
      );
    }
    const { row: next, next: withNew } = this.#buildFact(replacement);
    const old: FactRow = {
      ...cur,
      superseded_by: next.id,
      superseded_at: at,
      supersede_reason: reason,
    };
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    // Same order as SQLite: upsert replacement, then retract superseded.
    queueUpsert(
      q,
      "fact",
      next.id,
      next as unknown as Record<string, unknown>,
      this.#projectId,
    );
    queueRetract(q, "fact", id, this.#projectId);
    // One publish, so the insert and the supersession land together or not at
    // all — the atomicity SQLite gets from its transaction.
    this.#publish(
      {
        ...withNew,
        facts: withNew.facts.map((f) => (f.id === id ? old : f)),
      },
      q.entries,
      q.nextReceipt,
    );
    return { superseded: old, replacement: next };
  }

  supersedeMeasurement(
    id: number,
    replacement: NewMeasurement,
    reason: string | null,
    at: string,
  ): SupersedeResult<MeasurementRow> {
    this.#assertWritable();
    const cur = this.#snap.measurements.find((m) => m.id === id);
    if (!cur) raise("invalid_argument", `no such measurement ${id}`);
    if (cur.superseded_by !== null) {
      raise(
        "supersession_incomplete",
        `measurement ${id} is already superseded; supersession columns are set-once`,
      );
    }
    const { row: next, next: withNew } = this.#buildMeasurement(replacement);
    const old: MeasurementRow = {
      ...cur,
      superseded_by: next.id,
      superseded_at: at,
      supersede_reason: reason,
    };
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueUpsert(
      q,
      "measurement",
      next.id,
      next as unknown as Record<string, unknown>,
      this.#projectId,
    );
    queueRetract(q, "measurement", id, this.#projectId);
    this.#publish(
      {
        ...withNew,
        measurements: withNew.measurements.map((m) => (m.id === id ? old : m)),
      },
      q.entries,
      q.nextReceipt,
    );
    return { superseded: old, replacement: next };
  }

  retireMeasurement(
    id: number,
    byId: number,
    reason: string | null,
    at: string,
  ): MeasurementRow {
    this.#assertWritable();
    if (byId === id) {
      raise("invalid_argument", `measurement ${id} cannot supersede itself`);
    }
    const cur = this.#snap.measurements.find((m) => m.id === id);
    if (!cur) raise("invalid_argument", `no such measurement ${id}`);
    if (cur.superseded_by !== null) {
      raise(
        "supersession_incomplete",
        `measurement ${id} is already superseded; supersession columns are set-once`,
      );
    }
    const by = this.#snap.measurements.find((m) => m.id === byId);
    if (!by) raise("invalid_argument", `no such measurement ${byId}`);
    if (by.superseded_by !== null) {
      raise(
        "invalid_argument",
        `measurement ${byId} is itself superseded by ${by.superseded_by}; a retired measurement cannot supersede another`,
      );
    }
    const row: MeasurementRow = {
      ...cur,
      superseded_by: byId,
      superseded_at: at,
      supersede_reason: reason,
    };
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    queueRetract(q, "measurement", id, this.#projectId);
    this.#publish(
      {
        ...this.#snap,
        measurements: this.#snap.measurements.map((m) => (m.id === id ? row : m)),
      },
      q.entries,
      q.nextReceipt,
    );
    return row;
  }

  // -- snapshot transfer ---------------------------------------------------

  importSnapshot(snapshot: SessionSnapshot, opts: ImportOptions = {}): number {
    this.#assertWritable();
    // Validated before anything is touched, so a bad snapshot cannot reach the
    // store even partially.
    assertIntegrity(snapshot);
    if (snapshot.modelVersion !== this.modelVersion) {
      raise(
        "model_version_unsupported",
        `snapshot model version ${snapshot.modelVersion} != store ${this.modelVersion}`,
      );
    }

    const force = opts.force ?? false;
    const policy = resolveIdCollisionPolicy(opts.onIdCollision);
    const target = this.#snap;
    const occupied = snapshotIsOccupied(target);

    if (occupied && !force) {
      raise(
        "store_not_empty",
        "target store already has rows; pass force to replace it",
      );
    }

    if (occupied && policy === "remap") {
      if (countRows(snapshot) === 0) return 0;
      const plan = planAdditiveRemapImport(target, snapshot);
      const q = cloneQueue(this.#outbox, this.#nextReceipt);
      for (const rec of additiveImportProjectionUpserts(
        target,
        plan.merged,
        this.#projectId,
      )) {
        queueRecord(q, rec);
      }
      // One paired publish: refused planning or receipt exhaustion never moves CURRENT.
      this.#publish(plan.merged, q.entries, q.nextReceipt);
      return plan.written;
    }

    // Exact replacement (empty target, or force + refuse).
    const oldLive = liveProjectionMap(target, this.#projectId);
    const newLive = liveProjectionMap(snapshot, this.#projectId);
    const q = cloneQueue(this.#outbox, this.#nextReceipt);
    for (const [key, oldRec] of oldLive) {
      if (!newLive.has(key)) {
        queueRetract(q, oldRec.kind, oldRec.id, this.#projectId);
      }
    }
    for (const [key, newRec] of newLive) {
      const oldRec = oldLive.get(key);
      if (!oldRec || oldRec.text !== newRec.text) {
        queueRecord(q, newRec);
      }
    }

    const next: SessionSnapshot = {
      modelVersion: snapshot.modelVersion,
      nextIds: snapshot.nextIds,
      sessions: [...snapshot.sessions],
      facts: [...snapshot.facts],
      measurements: [...snapshot.measurements],
      obligations: [...snapshot.obligations],
    };
    this.#publish(next, q.entries, q.nextReceipt);
    return countRows(next);
  }

  // -- lifecycle -----------------------------------------------------------

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#writerClaim !== null) {
      releaseWriterClaim(this.#writerClaim);
    }
  }
}

/** Highest generation number present, or 0 when the directory is empty. */
function latestGeneration(genDir: string): number {
  let best = 0;
  for (const name of readdirSync(genDir)) {
    const n = genNumberFromToken(name);
    if (n !== null && n > best) best = n;
  }
  return best;
}

export function openFilesOnlyStore(
  opts: FilesOnlyOptions,
): FilesOnlySessionStore {
  return FilesOnlySessionStore.open(opts);
}
