/**
 * Files-only SessionStore: the port's second implementation.
 *
 * No database, no network, no native module. State is a canonical sidecar
 * document published as an immutable generation, with CURRENT naming the live
 * one.
 *
 *   <dir>/
 *     CURRENT                      # generation filename + newline
 *     generations/
 *       <NNNNNNNN>.ndjson          # immutable snapshot, canonical sidecar form
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
 * There is no inter-process lock. `SqliteSessionStore` carries WAL and a
 * `busy_timeout` and is safe under concurrent writers; this backend is not. It
 * exists to prove the contract is implementable twice, and it is correct for a
 * single writer. Do not select it for a shared store.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

import {
  SESSION_MODEL_VERSION,
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
import { decodeSnapshot, encodeSnapshot } from "./sidecar.js";
import type {
  ImportOptions,
  NewFact,
  NewMeasurement,
  NewObligation,
  SessionStore,
  SupersedeResult,
} from "./port.js";

export type FilesOnlyOptions = {
  /** Directory holding CURRENT and generations/. Created if absent. */
  readonly dir: string;
};

const CURRENT = "CURRENT";
const GENERATIONS = "generations";
const GEN_WIDTH = 8;

function genName(n: number): string {
  return `${String(n).padStart(GEN_WIDTH, "0")}.ndjson`;
}

let counter = 0;

/** Write `text` durably into `dir`: temp file, fsync, rename, fsync directory. */
function writeFileDurable(dir: string, name: string, text: string): void {
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

export class FilesOnlySessionStore implements SessionStore {
  readonly modelVersion = SESSION_MODEL_VERSION;

  readonly #dir: string;
  readonly #genDir: string;
  #snap: SessionSnapshot;
  #gen: number;
  #closed = false;

  private constructor(dir: string, snap: SessionSnapshot, gen: number) {
    this.#dir = dir;
    this.#genDir = join(dir, GENERATIONS);
    this.#snap = snap;
    this.#gen = gen;
  }

  static open(opts: FilesOnlyOptions): FilesOnlySessionStore {
    const dir = opts.dir;
    mkdirSync(dir, { recursive: true });
    const genDir = join(dir, GENERATIONS);
    mkdirSync(genDir, { recursive: true });

    const currentPath = join(dir, CURRENT);
    if (!existsSync(currentPath)) {
      const store = new FilesOnlySessionStore(dir, emptySnapshot(), 0);
      store.#publish(store.#snap);
      return store;
    }

    const name = readFileSync(currentPath, "utf8").trim();
    if (name === "") {
      raise("sidecar_malformed", `${CURRENT} is empty in ${JSON.stringify(dir)}`);
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
    const gen = Number.parseInt(name.slice(0, GEN_WIDTH), 10);
    return new FilesOnlySessionStore(
      dir,
      snap,
      Number.isFinite(gen) ? gen : latestGeneration(genDir),
    );
  }

  // -- publication ---------------------------------------------------------

  /**
   * Make `next` the live snapshot.
   *
   * Order matters. The generation is written and fsynced BEFORE CURRENT is
   * moved, so a crash between the two leaves CURRENT naming the previous
   * generation and the store readable at its old value — never naming a
   * generation that does not exist. `encodeSnapshot` runs first of all and
   * throws on an invalid snapshot, so nothing reaches the disk and `#snap` is
   * left untouched.
   */
  #publish(next: SessionSnapshot): void {
    const ordered = sortedSnapshot(next);
    const text = encodeSnapshot(ordered);
    const gen = this.#gen + 1;
    const name = genName(gen);
    writeFileDurable(this.#genDir, name, text);
    writeFileDurable(this.#dir, CURRENT, `${name}\n`);
    this.#gen = gen;
    this.#snap = ordered;
  }

  #assertOpen(): void {
    if (this.#closed) {
      raise("invalid_argument", "store is closed");
    }
  }

  // -- reads ---------------------------------------------------------------

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

  // -- writes --------------------------------------------------------------

  beginSession(args: {
    readonly session_id: string;
    readonly started_ts: string;
    readonly start_sha: string | null;
    readonly note: string | null;
  }): SessionRow {
    this.#assertOpen();
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
    this.#publish({ ...this.#snap, sessions: [...this.#snap.sessions, row] });
    return row;
  }

  endSession(sessionId: string, endedTs: string): SessionRow {
    this.#assertOpen();
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
    this.#publish({
      ...this.#snap,
      sessions: this.#snap.sessions.map((s) =>
        s.session_id === sessionId ? row : s,
      ),
    });
    return row;
  }

  addFact(fact: NewFact): FactRow {
    this.#assertOpen();
    const { row, next } = this.#buildFact(fact);
    this.#publish(next);
    return row;
  }

  /** Shared by addFact and supersedeFact; does not publish. */
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
    this.#assertOpen();
    const { row, next } = this.#buildMeasurement(m);
    this.#publish(next);
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
    this.#assertOpen();
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
    this.#publish({
      ...this.#snap,
      nextIds,
      obligations: [...this.#snap.obligations, row],
    });
    return row;
  }

  closeObligation(
    id: number,
    status: Exclude<ObligationStatus, "open">,
    closedTs: string,
  ): ObligationRow {
    this.#assertOpen();
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
    this.#publish({
      ...this.#snap,
      obligations: this.#snap.obligations.map((o) => (o.id === id ? row : o)),
    });
    return row;
  }

  supersedeFact(
    id: number,
    replacement: NewFact,
    reason: string | null,
    at: string,
  ): SupersedeResult<FactRow> {
    this.#assertOpen();
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
    // One publish, so the insert and the supersession land together or not at
    // all — the atomicity SQLite gets from its transaction.
    this.#publish({
      ...withNew,
      facts: withNew.facts.map((f) => (f.id === id ? old : f)),
    });
    return { superseded: old, replacement: next };
  }

  supersedeMeasurement(
    id: number,
    replacement: NewMeasurement,
    reason: string | null,
    at: string,
  ): SupersedeResult<MeasurementRow> {
    this.#assertOpen();
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
    this.#publish({
      ...withNew,
      measurements: withNew.measurements.map((m) => (m.id === id ? old : m)),
    });
    return { superseded: old, replacement: next };
  }

  retireMeasurement(
    id: number,
    byId: number,
    reason: string | null,
    at: string,
  ): MeasurementRow {
    this.#assertOpen();
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
    this.#publish({
      ...this.#snap,
      measurements: this.#snap.measurements.map((m) => (m.id === id ? row : m)),
    });
    return row;
  }

  // -- snapshot transfer ---------------------------------------------------

  importSnapshot(snapshot: SessionSnapshot, opts: ImportOptions = {}): number {
    this.#assertOpen();
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
    const policy = opts.onIdCollision ?? "refuse";
    const occupied =
      this.#snap.sessions.length > 0 ||
      this.#snap.facts.length > 0 ||
      this.#snap.measurements.length > 0 ||
      this.#snap.obligations.length > 0;

    if (occupied && !force) {
      raise(
        "store_not_empty",
        "target store already has rows; pass force to replace it",
      );
    }
    if (occupied && policy === "remap") {
      raise(
        "invalid_argument",
        "remap id-collision policy is not implemented; import into an empty store",
      );
    }

    const next: SessionSnapshot = {
      modelVersion: snapshot.modelVersion,
      nextIds: snapshot.nextIds,
      sessions: [...snapshot.sessions],
      facts: [...snapshot.facts],
      measurements: [...snapshot.measurements],
      obligations: [...snapshot.obligations],
    };
    this.#publish(next);
    return (
      next.sessions.length +
      next.facts.length +
      next.measurements.length +
      next.obligations.length
    );
  }

  // -- lifecycle -----------------------------------------------------------

  close(): void {
    this.#closed = true;
  }
}

/** Highest generation number present, or 0 when the directory is empty. */
function latestGeneration(genDir: string): number {
  let best = 0;
  for (const name of readdirSync(genDir)) {
    const n = Number.parseInt(name.slice(0, GEN_WIDTH), 10);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

export function openFilesOnlyStore(
  opts: FilesOnlyOptions,
): FilesOnlySessionStore {
  return FilesOnlySessionStore.open(opts);
}
