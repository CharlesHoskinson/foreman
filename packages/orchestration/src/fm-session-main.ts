import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  openSync,
  closeSync,
  fsyncSync,
  lstatSync,
  realpathSync,
  accessSync,
  constants,
} from "node:fs";
import { Cause, Effect, Exit } from "effect";
import {
  SqliteSessionStore,
  ENTITY_ORDER,
  countRows,
  decodeSnapshot,
  drainOutbox,
  encodeSnapshot,
  isSessionStoreFailure,
  NullMemoryIndex,
  openSessionStore,
  reasonOf,
  rowsOfKind,
  SessionStoreError,
  specFor,
  type DrainOptions,
  type DrainResult,
  type MemoryIndex,
  type OutboxDrainFailure,
  type SessionRow,
  type SessionSnapshot,
  type SessionStore,
  type SessionStoreFailureReason,
  type SessionStoreSelection,
} from "@foreman/session-store";
import {
  LegacyMigrationRefusal,
  bootstrapStore,
  pathsAlias,
  sidecarPathFor,
} from "./session-legacy-shape.js";

const READ_ONLY_CMDS = new Set(["recover", "freshness", "sidecar"]);
/** Derived-bookkeeping commands: mutate outbox only; skip automatic sidecar refresh. */
const NO_SIDECAR_REFRESH_CMDS = new Set(["sync"]);
const STORE_CMDS = new Set([
  "begin",
  "recover",
  "freshness",
  "end",
  "fact",
  "measure",
  "obligation",
  "close",
  "sidecar",
  "import-sidecar",
  "supersede",
  "retire",
  "sync",
]);

type StringOption =
  | "note"
  | "format"
  | "evidence"
  | "command"
  | "num"
  | "blocker"
  | "status"
  | "out"
  | "into"
  | "by"
  | "reason"
  | "batch"
  | "max-attempts"
  | "timeout-ms"
  | "max-batches";

type ParsedOptions = {
  json: boolean;
  "stale-only": boolean;
  force: boolean;
  note: string | undefined;
  format: string;
  evidence: string | undefined;
  command: string | undefined;
  scope: string[];
  num: string | undefined;
  blocker: string | undefined;
  status: string;
  out: string | undefined;
  into: string | undefined;
  by: string | undefined;
  reason: string | undefined;
  batch: string | undefined;
  "max-attempts": string | undefined;
  "timeout-ms": string | undefined;
  "max-batches": string | undefined;
};

/**
 * Test seam for sync: inject a MemoryIndex or drain function without shipping
 * adapter selection in v0.3.1.
 */
export type SyncTestDeps = {
  readonly index?: MemoryIndex;
  readonly drain?: (
    store: SessionStore,
    index: MemoryIndex,
    opts: DrainOptions,
  ) => Effect.Effect<DrainResult, OutboxDrainFailure>;
};

let syncTestDeps: SyncTestDeps | undefined;

/** Test-only. Pass undefined to clear. */
export function setSyncTestDeps(deps: SyncTestDeps | undefined): void {
  syncTestDeps = deps;
}

type ParsedCli = {
  readonly args: string[];
  readonly options: ParsedOptions;
  /** Option names (without `--`) explicitly present on the argv. */
  readonly present: ReadonlySet<string>;
};

const SYNC_ALLOWED_OPTIONS = new Set([
  "batch",
  "max-attempts",
  "timeout-ms",
  "max-batches",
]);

type Validity = "fresh" | "stale" | "unknown";

type RecoveryFact = {
  readonly kind: "fact";
  readonly id: number;
  readonly statement: string;
  readonly evidence: string | null;
  readonly established_ts: string;
};

type RecoveryMeasurement = {
  readonly kind: "measurement";
  readonly id: number;
  readonly metric: string;
  readonly value: string;
  readonly command: string | null;
  readonly measured_ts: string;
  readonly measured_sha: string;
  readonly scope_paths: readonly string[];
  readonly validity: Validity;
  readonly validity_reason: string;
};

type RecoveryObligation = {
  readonly kind: "obligation";
  readonly id: number;
  readonly statement: string;
  readonly status: string;
  readonly blocker: string | null;
  readonly opened_ts: string;
};

type RecoveryRecord = {
  readonly recovered_at: string;
  readonly head_sha: string;
  readonly last_session: SessionRow | null;
  readonly facts: readonly RecoveryFact[];
  readonly measurements: readonly RecoveryMeasurement[];
  readonly obligations: readonly RecoveryObligation[];
  readonly counts: {
    readonly facts: number;
    readonly measurements_fresh: number;
    readonly measurements_stale: number;
    readonly measurements_unknown: number;
    readonly obligations_open: number;
    readonly obligations_blocked: number;
  };
};

type FreshnessRow = {
  readonly id: number;
  readonly metric: string;
  readonly value: string;
  readonly verdict: string;
  readonly reason: string;
  readonly command: string;
  readonly scope: string;
  readonly sha: string;
  readonly timestamp: string;
};

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function repoRoot(): string {
  try {
    const out = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
    }).trim();
    return dirname(resolve(out));
  } catch {
    return process.cwd();
  }
}

function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function warnOrphanStore(chosen: string): void {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    if (!top) return;
    const orphan = resolve(top, ".foreman", "session.db");
    if (orphan === resolve(chosen) || !existsSync(orphan)) return;
    process.stderr.write(
      `WARNING: an orphaned session store sits at ${orphan}. Nothing reads it. The store in use is ${chosen}.\n`,
    );
  } catch {
    // git is unavailable; skip the orphan warning
  }
}

/**
 * Pure default SQLite path. May warn about orphans; must not mkdir or create
 * `.foreman`. Parent creation belongs to prepareSqlite after SQLite is selected.
 */
function dbPath(): string {
  if (process.env["FOREMAN_SESSION_DB"]) return process.env["FOREMAN_SESSION_DB"];
  const chosen = join(repoRoot(), ".foreman", "session.db");
  warnOrphanStore(chosen);
  return chosen;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function defaultSidecarPath(selection: SessionStoreSelection): string {
  if (selection.locationKind === "file") return sidecarPathFor(selection.location);
  return join(selection.location, "session.ndjson");
}

type OpenedCliStore = {
  readonly store: SessionStore;
  readonly selection: SessionStoreSelection;
};

/**
 * One neutral CLI open: factory selection, SQLite prepare/bootstrap, optional
 * migration sidecar persistence from the already-open store.
 */
function openCliStore(opts: { readonly readOnly?: boolean } = {}): OpenedCliStore {
  const readOnly = opts.readOnly === true;
  let selection: SessionStoreSelection | undefined;
  let migrated = false;
  let store: SessionStore;
  try {
    store = openSessionStore({
      readOnly,
      defaultSqlitePath: dbPath,
      onSelected: (sel) => {
        selection = sel;
      },
      prepareSqlite: (path, access) => {
        mkdirSync(dirname(path), { recursive: true });
        migrated = bootstrapStore(path, access);
      },
    });
  } catch (e) {
    if (e instanceof CliRefusal) throw e;
    if (e instanceof LegacyMigrationRefusal) {
      exitCli(2);
    }
    if (e instanceof SessionStoreError || reasonOf(e) === "backend_misconfiguration") {
      process.stderr.write(`refusing: ${errorMessage(e)}\n`);
      exitCli(2);
    }
    const failedPath = selection?.location ?? dbPath();
    if (
      isSqliteOperationalError(e) &&
      (parentDirNotWritable(failedPath) || pathNotReadable(failedPath))
    ) {
      process.stderr.write(`EACCES: permission denied, open '${failedPath}'\n`);
      exitCli(1);
    }
    if (isSqliteOperationalError(e)) {
      process.stderr.write(`sqlite3.OperationalError\n`);
      exitCli(1);
    }
    process.stderr.write(`${errorMessage(e)}\n`);
    exitCli(1);
  }
  if (selection === undefined) {
    store.close();
    process.stderr.write("refusing: session store opened without a selection\n");
    exitCli(2);
  }
  if (migrated) {
    try {
      persistSidecarAfterMigration(store, selection);
    } catch (e) {
      store.close();
      throw e;
    }
  }
  return { store, selection };
}

/**
 * Explicit SQLite import target for `import-sidecar --into PATH` only.
 * Narrow Task-6 exception: ordinary commands must not call this.
 */
function openExplicitSqliteImportTarget(target: string): SqliteSessionStore {
  try {
    mkdirSync(dirname(target), { recursive: true });
    const migrated = bootstrapStore(target, { allowMigration: true, readOnly: false });
    const store = SqliteSessionStore.open(target);
    if (migrated) {
      try {
        persistSidecarAfterMigration(store, {
          location: target,
          locationKind: "file",
        });
      } catch (e) {
        store.close();
        throw e;
      }
    }
    return store;
  } catch (e) {
    if (e instanceof CliRefusal) throw e;
    const message = errorMessage(e);
    const msg = message.includes("unable to open database file")
      ? "sqlite3.OperationalError"
      : message;
    process.stderr.write(`refusing: cannot open target store: ${msg}\n`);
    exitCli(2);
  }
}

function currentSessionId(store: SessionStore): string | null {
  return store.currentSession()?.session_id ?? null;
}

/**
 * Thrown in place of process.exit so `finally { store.close() }` can run.
 * mainWithSidecar is the only site that calls process.exit, using this code.
 */
export class CliRefusal extends Error {
  readonly exitCode: number;
  constructor(exitCode: number) {
    super(`cli refusal ${exitCode}`);
    this.name = "CliRefusal";
    this.exitCode = exitCode;
  }
}

function exitCli(code: number): never {
  throw new CliRefusal(code);
}

function isSqliteOperationalError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "ERR_SQLITE_ERROR";
}

function parentDirNotWritable(dbFile: string): boolean {
  try {
    accessSync(dirname(dbFile), constants.W_OK);
    return false;
  } catch (e) {
    const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
    return code === "EACCES" || code === "EPERM";
  }
}

function pathNotReadable(file: string): boolean {
  try {
    accessSync(file, constants.R_OK);
    return false;
  } catch (e) {
    const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
    return code === "EACCES" || code === "EPERM";
  }
}

function requirePositional(args: readonly string[], index: number, label: string): string {
  const value = args[index];
  if (value === undefined) {
    process.stderr.write(`refusing: missing ${label}\n`);
    exitCli(2);
  }
  return value;
}

/**
 * Translate a port failure into the CLI's own refusal.
 *
 * The goldens compare bytes, so a command whose behaviour is unchanged must
 * keep its exact legacy stderr text. close, end, and already-superseded
 * supersede change their output deliberately, and they pass their new text
 * here explicitly. measure also refuses a non-finite --num the legacy path
 * stored.
 *
 * `expectedReasons` keeps that legacy text for the reasons the site actually
 * established. Any other store failure is printed as itself.
 */
function refuseFromPort(
  e: unknown,
  legacyMessage: string,
  expectedReasons?: readonly SessionStoreFailureReason[],
): never {
  const reason = reasonOf(e);
  if (isSessionStoreFailure(e) || reason !== null) {
    if (expectedReasons === undefined || (reason !== null && expectedReasons.includes(reason))) {
      process.stderr.write(legacyMessage);
    } else {
      process.stderr.write(`refusing: ${errorMessage(e)}\n`);
    }
    exitCli(2);
  }
  throw e;
}

function scalarOf(text: string): number | null {
  const match = text.match(/^\s*(-?\d+(?:\.\d+)?)/);
  const captured = match?.[1];
  return captured === undefined ? null : parseFloat(captured);
}

function mintSessionId(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const hex = randomBytes(3).toString("hex");
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z-${hex}`;
}

function measurementValidity(
  measuredSha: string | null,
  scopePaths: string | null,
): readonly [Validity, string] {
  if (!measuredSha) return ["unknown", "no measured_sha recorded"];
  const paths = (scopePaths || "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (paths.length === 0) return ["unknown", "no scope_paths recorded; cannot bound what invalidates it"];

  try {
    const out = execFileSync("git", ["rev-list", `${measuredSha}..HEAD`, "--", ...paths], {
      encoding: "utf8",
    });
    const commits = out.split("\n").map((s) => s.trim()).filter(Boolean);
    if (commits.length > 0) {
      return ["stale", `${commits.length} commit(s) touched its scope since measurement`];
    }
    return ["fresh", "no commit has touched its scope since measurement"];
  } catch (e) {
    const err = e as { stderr?: unknown; message?: unknown; name?: unknown };
    const stderrRaw = err.stderr;
    const stderr =
      typeof stderrRaw === "string"
        ? stderrRaw
        : stderrRaw instanceof Uint8Array
          ? Buffer.from(stderrRaw).toString("utf8")
          : "";
    const message = typeof err.message === "string" ? err.message : String(e);
    const name = typeof err.name === "string" ? err.name : "Error";
    const errStr = (stderr || message).trim().substring(0, 80);
    if (stderr) {
      return ["unknown", `git rev-list failed: ${errStr}`];
    }
    return ["unknown", `${name}: ${message}`];
  }
}

/**
 * `blocked` is DERIVED state, never stored.
 *
 * The entity model declares status as open|done|dropped and carries the
 * blocker in its own column, so a blocked obligation IS an open one with a
 * non-null blocker. The v1 reader rewrites the old stored "blocked" to that
 * pair on the way in, so without this derivation the five blocked obligations
 * would silently read as open and the count would move.
 */
function displayStatus(o: { status: string; blocker: string | null }): string {
  return o.status === "open" && o.blocker ? "blocked" : o.status;
}

function buildRecoveryFromStore(store: SessionStore): RecoveryRecord {
  const head = gitSha();
  const sessions = [...store.listSessions()].sort((a, b) =>
    a.session_id < b.session_id ? 1 : a.session_id > b.session_id ? -1 : 0,
  );
  const sess = sessions[0] ?? null;

  const facts = [...store.listFacts()]
    .filter((r) => r.superseded_by === null)
    .sort((a, b) => b.id - a.id)
    .map((r) => ({
      kind: "fact" as const,
      id: r.id,
      statement: r.statement,
      evidence: r.evidence,
      established_ts: r.established_ts,
    }));

  const measurements = [...store.listMeasurements()]
    .filter((r) => r.superseded_by === null)
    .sort((a, b) => b.id - a.id)
    .map((r) => {
      const [validity, why] = measurementValidity(r.measured_sha, r.scope_paths);
      return {
        kind: "measurement" as const,
        id: r.id,
        metric: r.metric,
        value: r.value,
        command: r.command,
        measured_ts: r.measured_ts,
        measured_sha: (r.measured_sha || "").substring(0, 12),
        scope_paths: (r.scope_paths || "").split("\n").filter(Boolean),
        validity,
        validity_reason: why,
      };
    });

  const obligations = [...store.listObligations()]
    .filter((r) => r.status !== "done")
    .map((r) => ({
      kind: "obligation" as const,
      id: r.id,
      statement: r.statement,
      status: displayStatus(r),
      blocker: r.blocker,
      opened_ts: r.opened_ts,
    }));
  const obligationRank = (o: { status: string; blocker: string | null }): number => {
    if (o.status === "open" && !o.blocker) return 0;
    if (o.status === "open" || o.status === "blocked") return 1;
    return 2;
  };
  obligations.sort((a, b) => {
    const ra = obligationRank(a);
    const rb = obligationRank(b);
    if (ra !== rb) return ra - rb;
    return b.id - a.id;
  });

  return {
    recovered_at: nowIso(),
    head_sha: (head || "").substring(0, 12),
    last_session: sess,
    facts,
    measurements,
    obligations,
    counts: {
      facts: facts.length,
      measurements_fresh: measurements.filter((m) => m.validity === "fresh").length,
      measurements_stale: measurements.filter((m) => m.validity === "stale").length,
      measurements_unknown: measurements.filter((m) => m.validity === "unknown").length,
      obligations_open: obligations.filter((o) => o.status === "open").length,
      obligations_blocked: obligations.filter((o) => o.status === "blocked").length,
    },
  };
}

function buildFreshnessFromStore(store: SessionStore, staleOnly: boolean): FreshnessRow[] {
  const out: FreshnessRow[] = [];
  const rows = [...store.listMeasurements()]
    .filter((r) => r.superseded_by === null)
    .sort((a, b) => b.id - a.id);
  for (const row of rows) {
    const [validity, why] = measurementValidity(row.measured_sha, row.scope_paths);
    if (staleOnly && validity === "fresh") continue;
    out.push({
      id: row.id,
      metric: row.metric,
      value: row.value,
      verdict: validity === "stale" ? "STALE" : validity,
      reason: why,
      command: row.command || "(no command recorded)",
      scope: (row.scope_paths || "").split("\n").filter(Boolean).join(","),
      sha: row.measured_sha || "",
      timestamp: row.measured_ts,
    });
  }
  return out;
}

function renderFreshness(measurements: readonly FreshnessRow[], outputFormat: string): string {
  const columns = ["id", "metric", "value", "verdict", "reason", "command", "scope", "sha", "timestamp"] as const;
  if (outputFormat === "tsv") {
    const lines = [columns.join("\t")];
    for (const m of measurements) {
      lines.push(columns.map((c) => String(m[c])).join("\t"));
    }
    return lines.join("\n");
  }

  return measurements
    .map(
      (m) =>
        `[${m.id}] ${m.metric} = ${m.value}  verdict=${m.verdict}  reason=${m.reason}  command=${m.command}  scope=${m.scope}  sha=${m.sha}  timestamp=${m.timestamp}`,
    )
    .join("\n");
}

function render(rec: RecoveryRecord): string {
  const lines: string[] = [];
  const A = (s: string) => lines.push(s);

  A(`FOREMAN RECOVERY  head=${rec.head_sha}  at=${rec.recovered_at}`);
  const ls = rec.last_session;
  if (ls) {
    A(
      `last session: ${ls.session_id}  started=${ls.started_ts}  start_sha=${(ls.start_sha || "").substring(0, 12)}  ${ls.ended_ts ? "ENDED " + ls.ended_ts : "NOT ENDED"}`,
    );
    if (ls.note) {
      A(`  note: ${ls.note}`);
    }
  } else {
    A("last session: (none \u2014 this is the first)");
  }

  const c = rec.counts;
  A("");
  A(`FACTS (${c.facts}) \u2014 durable, true by construction`);
  const FACT_LIMIT = 20;
  const factsShown = rec.facts.slice(0, FACT_LIMIT);
  for (const f of factsShown) {
    A(`  [${f.id}] ${f.statement}`);
    if (f.evidence) A(`       evidence: ${f.evidence}`);
  }
  const factsHidden = rec.facts.length - factsShown.length;
  if (factsHidden > 0) {
    A(`  ... ${factsHidden} more fact(s) not shown. Run: fm-session recover --json`);
  }

  A("");
  A(`MEASUREMENTS \u2014 fresh=${c.measurements_fresh} STALE=${c.measurements_stale} unknown=${c.measurements_unknown}`);
  const MEASUREMENT_LIMIT = 20;
  const measurementsShown = rec.measurements.slice(0, MEASUREMENT_LIMIT);
  const markFor: Record<Validity, string> = { fresh: "OK   ", stale: "STALE", unknown: "?    " };
  for (const m of measurementsShown) {
    A(`  ${markFor[m.validity]} [${m.id}] ${m.metric} = ${m.value}`);
    A(`       ${m.validity_reason}  (measured ${m.measured_ts} @ ${m.measured_sha})`);
    if (m.validity !== "fresh" && m.command) {
      A(`       re-run: ${m.command}`);
    }
  }
  const measurementsHidden = rec.measurements.length - measurementsShown.length;
  if (measurementsHidden > 0) {
    A(`  ... ${measurementsHidden} more measurement(s) not shown. Run: fm-session recover --json`);
  }

  A("");
  A(`OBLIGATIONS \u2014 open=${c.obligations_open} blocked=${c.obligations_blocked}`);
  const OBLIGATION_LIMIT = 20;
  const obligationsShown = rec.obligations.slice(0, OBLIGATION_LIMIT);
  for (const o of obligationsShown) {
    A(`  [${o.id}] (${o.status}) ${o.statement}`);
    if (o.blocker) A(`       blocked by: ${o.blocker}`);
  }
  const obligationsHidden = rec.obligations.length - obligationsShown.length;
  if (obligationsHidden > 0) {
    A(`  ... ${obligationsHidden} more obligation(s) not shown. Run: fm-session recover --json`);
  }

  A("");
  const stale = c.measurements_stale + c.measurements_unknown;
  const live = rec.measurements.length;
  if (stale > 0) {
    A(
      `LAUNCH POINT: ${stale} measurement(s) are not fresh \u2014 re-run them before quoting any of their numbers. Then work the open obligations above.`,
    );
  } else if (live === 0) {
    A(
      "LAUNCH POINT: no measurement is recorded, so nothing here is measured. Measure before you quote a number. Then work the open obligations above.",
    );
  } else {
    A("LAUNCH POINT: every measurement is fresh. Work the open obligations above.");
  }

  return lines.join("\n");
}

/**
 * The tracked record, encoded by the port from a declared snapshot.
 *
 * This used to walk `sqlite_schema` and dump whatever tables it found, which
 * made the backend's table list the contract. Against a port-shaped store that
 * walk writes `store_meta` and `memory_outbox` into the tracked NDJSON, and
 * `decodeSnapshot` then refuses the file the CLI itself just wrote with
 * `unknown v1 table "store_meta"`. encodeSnapshot emits declared entity kinds
 * only, so an undeclared table cannot reach the record at all.
 *
 * Caller owns open/close; this helper never selects a backend.
 */
export function sidecarNdjson(store: SessionStore): [string, number] {
  const snapshot = store.snapshot();
  return [encodeSnapshot(snapshot), countRows(snapshot)];
}

export function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(8).toString("hex")}`;
  try {
    // wx is O_CREAT|O_EXCL. Combined with the per-process, per-attempt
    // suffix, two writers cannot open the same temp path.
    writeFileSync(tmp, text, { encoding: "utf8", flag: "wx" });
    // The sidecar is the tracked, canonical record. Without this flush the
    // rename can land before the bytes do, and the record of truth is the one
    // artefact that must not be able to tear.
    const fd = openSync(tmp, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // force:true hides ENOENT only. EACCES/EPERM must not replace the write error.
    }
    throw e;
  }
  // Commit point is the rename. A later durability flush must not turn a
  // published sidecar into a failed write, and tmp is gone so the catch
  // above must not run here.
  try {
    // rename is atomic on POSIX for the directory entry. The parent
    // directory itself is not durable until it is fsynced. A crash after
    // rename and before that flush can drop the new name even though this
    // command already reported success, and the tracked record silently
    // reverts to whatever the directory last persisted.
    const dirFd = openSync(dirname(path), "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `WARNING: sidecar published, durability flush failed (${msg}). ` +
        `The tracked record is complete.\n`,
    );
  }
}

export type SidecarReplaceKind = "unread" | "unparsed" | "shrink";

export class SidecarReplaceRefused extends Error {
  readonly kind: SidecarReplaceKind;
  constructor(message: string, kind: SidecarReplaceKind) {
    super(message);
    this.name = "SidecarReplaceRefused";
    this.kind = kind;
  }
}

export type SidecarReplaceAssessment =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly oldCount: number;
      readonly newCount: number;
      readonly oldDigest: string;
      readonly newDigest: string;
      readonly kindShrinks: readonly string[];
      readonly lostIdentities: readonly string[];
    };

function identityToken(kind: string, row: Record<string, unknown>, fields: readonly string[]): string {
  return `${kind}\t${fields.map((f) => String(row[f] ?? "")).join("\t")}`;
}

function identityTokens(snapshot: SessionSnapshot): string[] {
  const tokens: string[] = [];
  for (const kind of ENTITY_ORDER) {
    const fields = specFor(kind).identity;
    for (const row of rowsOfKind(snapshot, kind)) {
      tokens.push(identityToken(kind, row, fields));
    }
  }
  tokens.sort();
  return tokens;
}

function identityDigest(tokens: readonly string[]): string {
  return createHash("sha256").update(tokens.join("\n"), "utf8").digest("hex");
}

/**
 * Bound a sidecar replace by per-kind counts and by identity, not by total
 * cardinality. A same-count dump of different rows is a replace.
 *
 * Detects: any kind count dropping, and any declared identity present in
 * the existing sidecar but absent from the new dump.
 *
 * Does not detect: the same identities with mutated payloads (statement,
 * evidence, status, timestamps). nextIds watermark drift is also ignored.
 */
export function assessSidecarReplace(
  oldSnap: SessionSnapshot,
  newSnap: SessionSnapshot,
): SidecarReplaceAssessment {
  const oldTokens = identityTokens(oldSnap);
  const newTokens = identityTokens(newSnap);
  const newSet = new Set(newTokens);
  const lostIdentities = oldTokens.filter((t) => !newSet.has(t));
  const kindShrinks: string[] = [];
  for (const kind of ENTITY_ORDER) {
    const oldN = rowsOfKind(oldSnap, kind).length;
    const newN = rowsOfKind(newSnap, kind).length;
    if (newN < oldN) kindShrinks.push(`${kind}:${oldN}->${newN}`);
  }
  if (kindShrinks.length === 0 && lostIdentities.length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    oldCount: countRows(oldSnap),
    newCount: countRows(newSnap),
    oldDigest: identityDigest(oldTokens),
    newDigest: identityDigest(newTokens),
    kindShrinks,
    lostIdentities,
  };
}

function sidecarDumpElsewhereRemedy(): string {
  return "Dump the store to a new file with `fm-session sidecar --out <fresh-path>`.";
}

function sidecarReplaceMessage(path: string, verdict: Extract<SidecarReplaceAssessment, { ok: false }>): string {
  const kinds = verdict.kindShrinks.length > 0 ? ` kinds ${verdict.kindShrinks.join(",")}` : "";
  const lost =
    verdict.lostIdentities.length > 0
      ? ` missing ${verdict.lostIdentities.length} identit${verdict.lostIdentities.length === 1 ? "y" : "ies"}`
      : "";
  return (
    `refusing: existing sidecar ${path} has ${verdict.oldCount} row(s); ` +
    `refusing to replace it with ${verdict.newCount} row(s)` +
    `${kinds}${lost} ` +
    `(identity-scoped ${verdict.oldDigest.slice(0, 12)} -> ${verdict.newDigest.slice(0, 12)}). ` +
    `Run \`fm-session sidecar --force\` to dump the store over this file, ` +
    `or \`fm-session import-sidecar ${path} --force\` to restore this file into the store.\n`
  );
}

function unreadSidecarMessage(path: string, detail: string): string {
  return (
    `refusing: existing sidecar ${path} could not be read: ${detail}. ` +
    `Refusing to replace a sidecar whose contents could not be established. ` +
    `${sidecarDumpElsewhereRemedy()}\n`
  );
}

function unparsedSidecarMessage(path: string, detail: string): string {
  return (
    `refusing: existing sidecar ${path} could not be parsed: ${detail}. ` +
    `Refusing to replace a sidecar whose contents could not be established. ` +
    `${sidecarDumpElsewhereRemedy()}\n`
  );
}

type SidecarPathKind = "missing" | "regular" | "directory" | "unreadable";

function inspectSidecarPath(path: string): { dest: string; kind: SidecarPathKind } {
  let st;
  try {
    st = lstatSync(path);
  } catch (e) {
    const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
    if (code === "ENOENT") return { dest: path, kind: "missing" };
    throw e;
  }
  if (st.isSymbolicLink()) {
    let resolved: string;
    try {
      resolved = realpathSync(path);
    } catch {
      return { dest: path, kind: "unreadable" };
    }
    return inspectSidecarPath(resolved);
  }
  if (st.isFile()) return { dest: path, kind: "regular" };
  if (st.isDirectory()) return { dest: path, kind: "directory" };
  return { dest: path, kind: "unreadable" };
}

/**
 * Never replace an existing sidecar that would drop a declared identity
 * unless the caller authorises the shrink. Per-kind counts plus the
 * identity digest catch same-total replacements that a row-count guard
 * cannot see.
 *
 * An existing path whose contents cannot be established is not "no old
 * snapshot". The sidecar is the record of truth. Refuse rather than
 * overwrite unread bytes, a FIFO, or a dangling symlink. --force
 * authorises a shrink of a decoded snapshot, not a write over unread
 * bytes. A directory falls through to writeAtomic so a hard write
 * failure stays a hard write failure. A symlink is resolved: the guard
 * and the write both use the target, so --force cannot detach it.
 */
function writeSidecar(
  path: string,
  text: string,
  opts: { readonly allowShrink?: boolean } = {},
): void {
  const inspected = inspectSidecarPath(path);
  if (inspected.kind === "unreadable") {
    throw new SidecarReplaceRefused(unreadSidecarMessage(path, "not a regular file"), "unread");
  }
  const dest = inspected.dest;
  if (inspected.kind === "regular") {
    let raw: string;
    try {
      raw = readFileSync(dest, "utf8");
    } catch (e) {
      throw new SidecarReplaceRefused(unreadSidecarMessage(path, errorMessage(e)), "unread");
    }
    let oldSnap: SessionSnapshot;
    try {
      oldSnap = decodeSnapshot(raw);
    } catch (e) {
      throw new SidecarReplaceRefused(unparsedSidecarMessage(path, errorMessage(e)), "unparsed");
    }
    if (opts.allowShrink !== true) {
      const verdict = assessSidecarReplace(oldSnap, decodeSnapshot(text));
      if (!verdict.ok) {
        throw new SidecarReplaceRefused(sidecarReplaceMessage(path, verdict), "shrink");
      }
    }
  }
  writeAtomic(dest, text);
}

function persistSidecarAfterMigration(
  store: SessionStore,
  selection: SessionStoreSelection,
): void {
  const out = defaultSidecarPath(selection);
  if (pathsAlias(out, selection.location)) return;
  const [lines, rowCount] = sidecarNdjson(store);
  try {
    writeSidecar(out, lines);
    process.stderr.write(`sidecar refreshed: ${rowCount} row(s) -> ${out}\n`);
  } catch (e) {
    if (e instanceof SidecarReplaceRefused) {
      process.stderr.write(e.message);
      return;
    }
    throw e;
  }
}

/**
 * Restore a sidecar into an already-open store.
 * Caller owns open/close; this helper never selects a backend.
 *
 * decodeSnapshot accepts both sidecar formats -- v1 by its header version,
 * v2 otherwise -- and validates the whole snapshot against the declared model
 * before importSnapshot opens a transaction, so a bad file cannot half-apply.
 */
export function importSidecar(store: SessionStore, path: string, force = false): number {
  const snapshot = decodeSnapshot(readFileSync(path, "utf8"));
  return store.importSnapshot(snapshot, { force });
}

function emptyOptions(): ParsedOptions {
  return {
    json: false,
    "stale-only": false,
    force: false,
    note: undefined,
    format: "text",
    evidence: undefined,
    command: undefined,
    scope: [],
    num: undefined,
    blocker: undefined,
    status: "done",
    out: undefined,
    into: undefined,
    by: undefined,
    reason: undefined,
    batch: undefined,
    "max-attempts": undefined,
    "timeout-ms": undefined,
    "max-batches": undefined,
  };
}

const BOOLEAN_ARGS = new Set(["--json", "--stale-only", "--force"]);
const STRING_ARGS = new Set([
  "--note",
  "--format",
  "--evidence",
  "--command",
  "--scope",
  "--num",
  "--blocker",
  "--status",
  "--out",
  "--into",
  "--by",
  "--reason",
  "--batch",
  "--max-attempts",
  "--timeout-ms",
  "--max-batches",
]);

function parseStrictIntInRange(
  raw: string | undefined,
  label: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  // Strict decimal integers only: no sign, no whitespace, no floats.
  if (!/^[0-9]+$/.test(raw)) {
    process.stderr.write(`refusing: ${label} must be a decimal integer\n`);
    exitCli(2);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    process.stderr.write(`refusing: ${label} must be an integer in ${min}..${max}\n`);
    exitCli(2);
  }
  return n;
}

function isStringOption(key: string): key is StringOption {
  return STRING_ARGS.has(`--${key}`);
}

function parseCli(argv: readonly string[]): ParsedCli {
  const options = emptyOptions();
  const present = new Set<string>();
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      if (BOOLEAN_ARGS.has(arg)) {
        const key = arg.slice(2);
        present.add(key);
        if (key === "json" || key === "stale-only" || key === "force") {
          options[key] = true;
        }
      } else if (STRING_ARGS.has(arg) || arg === "--scope") {
        if (i + 1 >= argv.length) {
          process.stderr.write(`error: option ${arg} requires an argument\n`);
          exitCli(2);
        }
        const value = argv[++i];
        if (value === undefined) {
          process.stderr.write(`error: option ${arg} requires an argument\n`);
          exitCli(2);
        }
        if (arg === "--scope") {
          present.add("scope");
          options.scope.push(value);
        } else {
          const key = arg.slice(2);
          present.add(key);
          if (isStringOption(key)) options[key] = value;
        }
      } else {
        process.stderr.write(`error: unrecognized option: ${arg}\n`);
        exitCli(2);
      }
    } else {
      args.push(arg);
    }
  }
  return { args, options, present };
}

/**
 * CLI entry. Most commands return a synchronous exit code. `sync` returns a
 * Promise because it runs an Effect drain; direct entry awaits both forms.
 */
export function main(): number | Promise<number> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd === undefined) {
    process.stderr.write("refusing: missing command\n");
    exitCli(2);
  }
  if (!STORE_CMDS.has(cmd)) {
    process.stderr.write(`refusing: unknown command ${cmd}\n`);
    exitCli(2);
  }

  const parsed = parseCli(args.slice(1));

  if (cmd === "sync") {
    return runSync(parsed);
  }

  if (cmd === "begin") {
    const { store } = openCliStore();
    try {
      const rec = buildRecoveryFromStore(store);
      const sid = mintSessionId();
      try {
        store.beginSession({
          session_id: sid,
          started_ts: nowIso(),
          start_sha: gitSha(),
          note: parsed.options.note || null,
        });
      } catch (e) {
        refuseFromPort(e, "refusing: cannot begin session\n");
      }
      process.stdout.write(render(rec) + "\n\n");
      process.stdout.write(`SESSION BEGUN: ${sid}\n`);
    } finally {
      store.close();
    }
    return 0;
  }

  if (cmd === "recover") {
    const { store } = openCliStore({ readOnly: true });
    try {
      const rec = buildRecoveryFromStore(store);
      if (parsed.options.json) {
        process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
      } else {
        process.stdout.write(render(rec) + "\n");
      }
    } finally {
      store.close();
    }
    return 0;
  }

  if (cmd === "freshness") {
    const staleOnly = parsed.options["stale-only"];
    const { store } = openCliStore({ readOnly: true });
    try {
      const measurements = buildFreshnessFromStore(store, staleOnly);
      process.stdout.write(renderFreshness(measurements, parsed.options.format) + "\n");
    } finally {
      store.close();
    }
    return 0;
  }

  if (cmd === "end") {
    const { store } = openCliStore();
    try {
      const sid = parsed.args[0] || currentSessionId(store);
      if (!sid) {
        process.stderr.write("no open session\n");
        exitCli(2);
      }
      try {
        store.endSession(sid, nowIso());
      } catch (e) {
        if (reasonOf(e) === "supersession_incomplete") {
          process.stderr.write(`refusing: session ${sid} is already ended; ended_ts is set-once\n`);
          exitCli(2);
        }
        refuseFromPort(e, "no open session\n", ["invalid_argument"]);
      }
      process.stdout.write(`session ended: ${sid}\n`);
    } finally {
      store.close();
    }
    return 0;
  }

  if (cmd === "fact") {
    const evidence = parsed.options.evidence || null;
    const { store } = openCliStore();
    try {
      const statement = requirePositional(parsed.args, 0, "STATEMENT");
      let row;
      try {
        row = store.addFact({
          statement,
          evidence,
          established_ts: nowIso(),
          session_id: currentSessionId(store),
        });
      } catch (e) {
        refuseFromPort(e, "refusing: cannot add fact\n");
      }
      process.stdout.write(`fact ${row.id}\n`);
    } finally {
      store.close();
    }
    return 0;
  }

  if (cmd === "measure") {
    const command = parsed.options.command || null;
    const { store } = openCliStore();
    try {
      if (parsed.options.scope.length === 0) {
        process.stderr.write(
          "refusing: --scope is required. A measurement with no path scope can never be shown stale, which is the entire point.\n",
        );
        exitCli(2);
      }
      const metric = parsed.args[0];
      const value = parsed.args[1];
      if (metric === undefined || value === undefined) {
        process.stderr.write("refusing: measure requires METRIC and VALUE\n");
        exitCli(2);
      }
      let vnum: number | null = null;
      if (parsed.options.num !== undefined) vnum = parseFloat(parsed.options.num);
      else vnum = scalarOf(value);
      let row;
      try {
        row = store.addMeasurement({
          metric,
          value,
          value_num: vnum,
          command,
          measured_ts: nowIso(),
          measured_sha: gitSha(),
          scope_paths: parsed.options.scope.join("\n"),
          session_id: currentSessionId(store),
        });
      } catch (e) {
        refuseFromPort(e, "refusing: --num must be a finite number\n");
      }
      process.stdout.write(`measurement ${row.id}\n`);
    } finally {
      store.close();
    }
    return 0;
  }

  if (cmd === "obligation") {
    const blocker = parsed.options.blocker || null;
    const { store } = openCliStore();
    try {
      const statement = requirePositional(parsed.args, 0, "STATEMENT");
      let row;
      try {
        row = store.addObligation({
          statement,
          blocker,
          opened_ts: nowIso(),
          session_id: currentSessionId(store),
        });
      } catch (e) {
        refuseFromPort(e, "refusing: cannot add obligation\n");
      }
      process.stdout.write(`obligation ${row.id}\n`);
    } finally {
      store.close();
    }
    return 0;
  }

  if (cmd === "close") {
    const status = parsed.options.status;
    const { store } = openCliStore();
    try {
      const obligationId = parseInt(requirePositional(parsed.args, 0, "OBLIGATION_ID"), 10);
      if (parsed.options.blocker !== undefined) {
        process.stderr.write("refusing: --blocker is not valid with close\n");
        exitCli(2);
      }
      if (status !== "done" && status !== "dropped") {
        process.stderr.write(`refusing: --status must be done or dropped, got ${JSON.stringify(status)}\n`);
        exitCli(2);
      }
      try {
        store.closeObligation(obligationId, status, nowIso());
      } catch (e) {
        refuseFromPort(
          e,
          `refusing: obligation ${obligationId} is not open; only an open obligation may be closed\n`,
        );
      }
      process.stdout.write(`obligation ${obligationId} -> ${status}\n`);
    } finally {
      store.close();
    }
    return 0;
  }

  if (cmd === "sidecar") {
    const { store, selection } = openCliStore({ readOnly: true });
    const outPath = parsed.options.out || defaultSidecarPath(selection);
    try {
      if (pathsAlias(outPath, selection.location)) {
        process.stderr.write(
          `refusing: sidecar output ${outPath} aliases the session store ${selection.location}\n`,
        );
        exitCli(2);
      }
      // "sidecar" is a read-only command (READ_ONLY_CMDS): it may write the
      // NDJSON it dumps to, never the store it dumps from.
      const [lines, rowCount] = sidecarNdjson(store);
      writeSidecar(outPath, lines, { allowShrink: parsed.options.force });
      process.stdout.write(`dumped ${rowCount} row(s) -> ${outPath}\n`);
      return 0;
    } catch (e) {
      if (e instanceof SidecarReplaceRefused) {
        process.stderr.write(e.message);
        exitCli(2);
      }
      process.stderr.write(`refusing: cannot write sidecar ${outPath}: ${errorMessage(e)}\n`);
      exitCli(2);
    } finally {
      store.close();
    }
  }

  if (cmd === "import-sidecar") {
    const explicitInto = parsed.options.into;
    if (explicitInto !== undefined) {
      // Explicit SQLite import target — the only ordinary-command exception
      // until Task 6. See openExplicitSqliteImportTarget.
      const store = openExplicitSqliteImportTarget(explicitInto);
      try {
        const path = requirePositional(parsed.args, 0, "PATH");
        const count = importSidecar(store, path, parsed.options.force);
        process.stdout.write(`imported ${count} document(s) -> ${explicitInto}\n`);
        return 0;
      } catch (e) {
        if (e instanceof CliRefusal) throw e;
        process.stderr.write(`refusing: ${errorMessage(e)}\n`);
        exitCli(2);
      } finally {
        store.close();
      }
    }
    const { store, selection } = openCliStore();
    try {
      const path = requirePositional(parsed.args, 0, "PATH");
      const count = importSidecar(store, path, parsed.options.force);
      process.stdout.write(`imported ${count} document(s) -> ${selection.location}\n`);
      return 0;
    } catch (e) {
      if (e instanceof CliRefusal) throw e;
      process.stderr.write(`refusing: ${errorMessage(e)}\n`);
      exitCli(2);
    } finally {
      store.close();
    }
  }

  if (cmd === "supersede") {
    const evidence = parsed.options.evidence || null;
    const { store } = openCliStore();
    try {
      const factId = parseInt(requirePositional(parsed.args, 0, "FACT_ID"), 10);
      const statement = requirePositional(parsed.args, 1, "STATEMENT");
      const reason = parsed.options.reason;
      if (!reason) {
        process.stderr.write("error: option --reason requires an argument\n");
        exitCli(2);
      }
      let res;
      try {
        res = store.supersedeFact(
          factId,
          { statement, evidence, established_ts: nowIso(), session_id: currentSessionId(store) },
          reason,
          nowIso(),
        );
      } catch (e) {
        if (reasonOf(e) === "supersession_incomplete") {
          process.stderr.write(
            `refusing: fact ${factId} is already superseded; supersession columns are set-once\n`,
          );
          exitCli(2);
        }
        refuseFromPort(
          e,
          `refusing: cannot supersede fact ${factId}: it does not exist or is already superseded\n`,
          ["invalid_argument"],
        );
      }
      process.stdout.write(`fact ${factId} superseded by ${res.replacement.id}\n`);
    } finally {
      store.close();
    }
    return 0;
  }

  if (cmd === "retire") {
    // Open before semantic refusals so bootstrap rehydrate still runs and
    // stderr stays byte-identical to the prepareInvocation era.
    const { store } = openCliStore();
    try {
      const measurementId = parseInt(requirePositional(parsed.args, 0, "MEASUREMENT_ID"), 10);
      const byId = parseInt(parsed.options.by ?? "", 10);
      const reason = parsed.options.reason;
      if (Number.isNaN(byId)) {
        process.stderr.write("error: option --by requires an argument\n");
        exitCli(2);
      }
      if (!reason) {
        process.stderr.write("error: option --reason requires an argument\n");
        exitCli(2);
      }
      if (byId === measurementId) {
        process.stderr.write("refusing: a measurement cannot supersede itself\n");
        exitCli(2);
      }
      const rows = store.listMeasurements();
      if (!rows.some((r) => r.id === measurementId)) {
        process.stderr.write(`refusing: no measurement ${measurementId} to retire\n`);
        exitCli(2);
      }
      const by = rows.find((r) => r.id === byId);
      if (!by) {
        process.stderr.write(`refusing: no measurement ${byId} to supersede it\n`);
        exitCli(2);
      }
      if (by.superseded_by !== null) {
        process.stderr.write(
          `refusing: measurement ${byId} is itself superseded by ${by.superseded_by}. A retired measurement cannot supersede another one.\n`,
        );
        exitCli(2);
      }
      try {
        store.retireMeasurement(measurementId, byId, reason, nowIso());
      } catch (e) {
        refuseFromPort(e, `refusing: measurement ${measurementId} is already superseded\n`, [
          "supersession_incomplete",
        ]);
      }
      process.stdout.write(`measurement ${measurementId} retired, superseded by ${byId}\n`);
    } finally {
      store.close();
    }
    return 0;
  }

  exitCli(2);
}

async function runSync(parsed: ParsedCli): Promise<number> {
  if (parsed.args.length > 0) {
    process.stderr.write("refusing: sync accepts no positional arguments\n");
    exitCli(2);
  }
  for (const key of parsed.present) {
    if (!SYNC_ALLOWED_OPTIONS.has(key)) {
      process.stderr.write(`refusing: sync does not accept --${key}\n`);
      exitCli(2);
    }
  }
  const opts: DrainOptions = {
    batch: parseStrictIntInRange(parsed.options.batch, "--batch", 1, 1000, 100),
    maxAttempts: parseStrictIntInRange(
      parsed.options["max-attempts"],
      "--max-attempts",
      1,
      10,
      3,
    ),
    timeoutMs: parseStrictIntInRange(
      parsed.options["timeout-ms"],
      "--timeout-ms",
      1,
      300_000,
      5000,
    ),
    maxBatches: parseStrictIntInRange(
      parsed.options["max-batches"],
      "--max-batches",
      1,
      10_000,
      100,
    ),
  };

  const { store } = openCliStore();
  const index = syncTestDeps?.index ?? new NullMemoryIndex();
  const drain = syncTestDeps?.drain ?? drainOutbox;
  try {
    const exit = await Effect.runPromiseExit(drain(store, index, opts));
    if (Exit.isSuccess(exit)) {
      const result = exit.value;
      process.stdout.write(
        `synced ${result.projected} record(s) to ${index.name} in ${result.attempts} attempt(s)\n`,
      );
      return 0;
    }
    const squashed = Cause.squash(exit.cause);
    let reason = "failed";
    let projected = 0;
    let attempts = 0;
    let batches = 0;
    if (
      squashed !== null &&
      typeof squashed === "object" &&
      "_tag" in squashed &&
      (squashed as OutboxDrainFailure)._tag === "OutboxDrainFailure"
    ) {
      const f = squashed as OutboxDrainFailure;
      reason = f.reason;
      projected = f.projected;
      attempts = f.attempts;
      batches = f.batches;
    }
    process.stderr.write(
      `refusing: sync failed (${reason}; projected=${projected} attempts=${attempts} batches=${batches})\n`,
    );
    return 1;
  } finally {
    store.close();
  }
}

async function mainWithSidecar(): Promise<void> {
  let rc = 0;
  try {
    rc = (await Promise.resolve(main())) || 0;
  } catch (e) {
    if (e instanceof CliRefusal) {
      process.exit(e.exitCode);
    }
    const code = e instanceof Error && "code" in e ? String((e as { code?: unknown }).code) : "";
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" || code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
      process.stderr.write(`error: ${errorMessage(e)}\n`);
      rc = 2;
    } else {
      throw e;
    }
  }
  const invoked = process.argv[2];
  if (
    rc !== 0 ||
    process.argv.length < 3 ||
    (invoked !== undefined && READ_ONLY_CMDS.has(invoked)) ||
    (invoked !== undefined && NO_SIDECAR_REFRESH_CMDS.has(invoked))
  ) {
    process.exit(rc);
  }

  // Automatic refresh: reopen the selected store read-only through the factory.
  // Never inspect or open the unselected backend.
  let selection: SessionStoreSelection | undefined;
  let refreshStore: SessionStore | undefined;
  let out = "";
  try {
    refreshStore = openSessionStore({
      readOnly: true,
      defaultSqlitePath: dbPath,
      onSelected: (sel) => {
        selection = sel;
      },
      prepareSqlite: (path, access) => {
        mkdirSync(dirname(path), { recursive: true });
        bootstrapStore(path, access);
      },
    });
    if (selection === undefined) {
      throw new Error("session store reopened without a selection");
    }
    out = defaultSidecarPath(selection);
    // Alias: skip the write but do not process.exit here — that would bypass
    // finally and leak the refresh-store handle. Exit only after close.
    if (!pathsAlias(out, selection.location)) {
      const [lines, rowCount] = sidecarNdjson(refreshStore);
      const allowShrink =
        process.argv.includes("--force") &&
        (invoked === "import-sidecar" || invoked === "sidecar");
      writeSidecar(out, lines, { allowShrink });
      process.stderr.write(`sidecar refreshed: ${rowCount} row(s) -> ${out}\n`);
    }
  } catch (e) {
    if (e instanceof SidecarReplaceRefused) {
      // The store write already committed. On a shrink refusal the existing
      // sidecar is strictly richer, so keep rc=0. Exit 2 invited a
      // duplicating retry. --force works only on a decoded snapshot.
      const remedy =
        e.kind === "shrink"
          ? `Run \`fm-session sidecar --force\` to dump the store over the tracked record, ` +
            `or \`fm-session import-sidecar ${out} --force\` to restore the tracked record into the store.`
          : `The existing sidecar could not be decoded, so --force cannot overwrite it. ` +
            `Dump the store to a new file with \`fm-session sidecar --out <fresh-path>\`.`;
      process.stderr.write(
        `WARNING: the store was written but its sidecar could not be refreshed (${e}). ` +
          `The tracked record is now BEHIND the database. ` +
          `${remedy}\n`,
      );
    } else {
      // A hard write failure is the opposite case: the row is already in
      // the store. Exit 1 so the operator does not treat this as success,
      // and name the same recovery as the refusal: do not re-run the write.
      process.stderr.write(
        `WARNING: the store was written but its sidecar could not be refreshed (${e}). ` +
          `The store write already committed. Re-running this write will duplicate the row. ` +
          `Clear the sidecar fault, then run \`fm-session sidecar --force\` to dump the store over the tracked record.\n`,
      );
      rc = 1;
    }
  } finally {
    refreshStore?.close();
  }
  process.exit(rc);
}
// Run the CLI only when this module IS the program, not when it is imported.
// The previous guard keyed on NODE_ENV, which node:test does not set — so the
// test file ran the CLI on import and died at process.exit before a single
// test executed. It also made production behaviour depend on an environment
// variable: anything setting NODE_ENV=test would silently get a no-op CLI.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void mainWithSidecar().catch((e) => {
    // Promise-safe direct entry: no unhandled rejection, no stack dump.
    process.stderr.write(`refusing: ${errorMessage(e)}\n`);
    process.exit(1);
  });
}
