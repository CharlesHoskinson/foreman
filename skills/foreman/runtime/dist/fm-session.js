// packages/orchestration/src/fm-session-main.ts
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { join, dirname as dirname2, resolve as resolve2 } from "node:path";
import {
  existsSync as existsSync2,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync2,
  writeFileSync,
  renameSync as renameSync2,
  rmSync as rmSync2,
  openSync,
  closeSync,
  fsyncSync,
  lstatSync,
  realpathSync,
  accessSync,
  constants
} from "node:fs";

// packages/session-store/src/entities.ts
var SESSION_MODEL_VERSION = 1;
var ENTITY_KINDS = [
  "session",
  "fact",
  "measurement",
  "obligation"
];
var COUNTED_KINDS = ["fact", "measurement", "obligation"];
function isCountedKind(kind) {
  return kind !== "session";
}
var OBLIGATION_STATUSES = ["open", "done", "dropped"];
var SUPERSESSION_FIELDS = [
  { name: "superseded_by", type: "integer", nullable: true },
  { name: "superseded_at", type: "timestamp", nullable: true },
  { name: "supersede_reason", type: "string", nullable: true }
];
var SESSION_SPEC = {
  kind: "session",
  identity: ["session_id"],
  ordering: ["session_id"],
  supersedable: false,
  fields: [
    { name: "session_id", type: "string", nullable: false },
    { name: "started_ts", type: "timestamp", nullable: false },
    { name: "start_sha", type: "string", nullable: true },
    { name: "ended_ts", type: "timestamp", nullable: true },
    { name: "note", type: "string", nullable: true }
  ]
};
var FACT_SPEC = {
  kind: "fact",
  identity: ["id"],
  ordering: ["id"],
  supersedable: true,
  fields: [
    { name: "id", type: "integer", nullable: false },
    { name: "statement", type: "string", nullable: false },
    { name: "evidence", type: "string", nullable: true },
    { name: "established_ts", type: "timestamp", nullable: false },
    { name: "session_id", type: "string", nullable: true },
    ...SUPERSESSION_FIELDS
  ]
};
var MEASUREMENT_SPEC = {
  kind: "measurement",
  identity: ["id"],
  ordering: ["id"],
  supersedable: true,
  fields: [
    { name: "id", type: "integer", nullable: false },
    { name: "metric", type: "string", nullable: false },
    { name: "value", type: "string", nullable: false },
    { name: "value_num", type: "real", nullable: true },
    { name: "command", type: "string", nullable: true },
    { name: "measured_ts", type: "timestamp", nullable: false },
    { name: "measured_sha", type: "string", nullable: true },
    { name: "scope_paths", type: "string", nullable: true },
    { name: "session_id", type: "string", nullable: true },
    ...SUPERSESSION_FIELDS
  ]
};
var OBLIGATION_SPEC = {
  kind: "obligation",
  identity: ["id"],
  ordering: ["id"],
  supersedable: false,
  fields: [
    { name: "id", type: "integer", nullable: false },
    { name: "statement", type: "string", nullable: false },
    {
      name: "status",
      type: "enum",
      nullable: false,
      enumValues: OBLIGATION_STATUSES
    },
    { name: "blocker", type: "string", nullable: true },
    { name: "opened_ts", type: "timestamp", nullable: false },
    { name: "closed_ts", type: "timestamp", nullable: true },
    { name: "session_id", type: "string", nullable: true }
  ]
};
var ENTITY_SPECS = {
  session: SESSION_SPEC,
  fact: FACT_SPEC,
  measurement: MEASUREMENT_SPEC,
  obligation: OBLIGATION_SPEC
};
var ENTITY_ORDER = ENTITY_KINDS;
function specFor(kind) {
  return ENTITY_SPECS[kind];
}
function initialNextIds() {
  return { fact: 1, measurement: 1, obligation: 1 };
}
function emptySnapshot() {
  return {
    modelVersion: SESSION_MODEL_VERSION,
    nextIds: initialNextIds(),
    sessions: [],
    facts: [],
    measurements: [],
    obligations: []
  };
}
function rowsOfKind(snapshot, kind) {
  const pick = kind === "session" ? snapshot.sessions : kind === "fact" ? snapshot.facts : kind === "measurement" ? snapshot.measurements : snapshot.obligations;
  return pick;
}
function countRows(snapshot) {
  let total = 0;
  for (const kind of ENTITY_ORDER) total += rowsOfKind(snapshot, kind).length;
  return total;
}
function snapshotsEqual(a, b) {
  if (a.modelVersion !== b.modelVersion) return false;
  for (const kind of COUNTED_KINDS) {
    if (a.nextIds[kind] !== b.nextIds[kind]) return false;
  }
  for (const kind of ENTITY_ORDER) {
    const ra = rowsOfKind(a, kind);
    const rb = rowsOfKind(b, kind);
    if (ra.length !== rb.length) return false;
    const fields = specFor(kind).fields;
    for (let i = 0; i < ra.length; i++) {
      const x = ra[i];
      const y = rb[i];
      for (const f of fields) {
        if (!Object.is(normaliseValue(x[f.name]), normaliseValue(y[f.name]))) {
          return false;
        }
      }
    }
  }
  return true;
}
function normaliseValue(v) {
  return typeof v === "number" && Object.is(v, -0) ? 0 : v;
}

// packages/session-store/src/failures.ts
var SESSION_STORE_FAILURE_BRAND = Symbol(
  "@foreman/session-store/SessionStoreFailure"
);
function sessionStoreFailure(reason, message, extra) {
  return {
    [SESSION_STORE_FAILURE_BRAND]: true,
    _tag: "SessionStoreFailure",
    reason,
    message,
    ...extra?.kind !== void 0 ? { kind: extra.kind } : {},
    ...extra?.field !== void 0 ? { field: extra.field } : {},
    ...extra?.detail !== void 0 ? { detail: extra.detail } : {}
  };
}
function isSessionStoreFailure(v) {
  return typeof v === "object" && v !== null && v[SESSION_STORE_FAILURE_BRAND] === true;
}
var SessionStoreError = class extends Error {
  failure;
  constructor(failure) {
    super(failure.message);
    this.name = "SessionStoreError";
    this.failure = failure;
  }
};
function raise(reason, message, extra) {
  throw new SessionStoreError(sessionStoreFailure(reason, message, extra));
}
function reasonOf(e) {
  if (e instanceof SessionStoreError) return e.failure.reason;
  if (isSessionStoreFailure(e)) return e.reason;
  return null;
}

// packages/session-store/src/integrity.ts
function typeOk(spec, v) {
  switch (spec.type) {
    case "string":
    case "timestamp":
      return typeof v === "string";
    case "enum":
      return typeof v === "string" && (spec.enumValues ?? []).includes(v);
    case "integer":
      return typeof v === "number" && Number.isSafeInteger(v);
    case "real":
      return typeof v === "number" && Number.isFinite(v);
  }
}
function describe(v) {
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}
function at(kind, row) {
  const parts = specFor(kind).identity.map((f) => `${f}=${describe(row[f])}`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}
function findViolations(snapshot) {
  const out = [];
  for (const kind of ENTITY_ORDER) {
    const spec = specFor(kind);
    const declared = new Set(spec.fields.map((f) => f.name));
    const rows = rowsOfKind(snapshot, kind);
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!declared.has(key)) {
          out.push({
            kind,
            field: key,
            detail: `field is not in the model${at(kind, row)}`
          });
        }
      }
      for (const f of spec.fields) {
        if (!(f.name in row)) {
          out.push({
            kind,
            field: f.name,
            detail: `field absent; the model requires an explicit null${at(kind, row)}`
          });
          continue;
        }
        const v = row[f.name];
        if (v === null) {
          if (!f.nullable) {
            out.push({
              kind,
              field: f.name,
              detail: `null in a non-null field${at(kind, row)}`
            });
          }
          continue;
        }
        if (v === void 0) {
          out.push({
            kind,
            field: f.name,
            detail: `undefined is not a value; use null${at(kind, row)}`
          });
          continue;
        }
        if (!typeOk(f, v)) {
          out.push({
            kind,
            field: f.name,
            detail: `expected ${f.type}, got ${describe(v)}${at(kind, row)}`
          });
        }
      }
    }
  }
  for (const kind of ENTITY_ORDER) {
    const spec = specFor(kind);
    const rows = rowsOfKind(snapshot, kind);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      for (const key of spec.ordering) {
        const a = prev[key];
        const b = cur[key];
        if (typeof a === "number" && typeof b === "number") {
          if (b < a) {
            out.push({ kind, field: key, detail: "rows are not in declared order" });
          }
          break;
        }
        if (typeof a === "string" && typeof b === "string") {
          if (b < a) {
            out.push({ kind, field: key, detail: "rows are not in declared order" });
          }
          break;
        }
      }
    }
  }
  const idsByKind = /* @__PURE__ */ new Map();
  for (const kind of COUNTED_KINDS) {
    const seen = /* @__PURE__ */ new Set();
    const next = snapshot.nextIds[kind];
    for (const row of rowsOfKind(snapshot, kind)) {
      const id = row["id"];
      if (typeof id !== "number" || !Number.isSafeInteger(id)) continue;
      if (id < 1) {
        out.push({ kind, field: "id", detail: `id ${id} is not positive` });
      }
      if (seen.has(id)) {
        out.push({ kind, field: "id", detail: `duplicate id ${id}` });
      }
      seen.add(id);
      if (typeof next === "number" && id >= next) {
        out.push({
          kind,
          field: "id",
          detail: `id ${id} is at or above nextIds.${kind} (${next})`
        });
      }
    }
    idsByKind.set(kind, seen);
  }
  const sessionIds = /* @__PURE__ */ new Set();
  for (const row of rowsOfKind(snapshot, "session")) {
    const sid = row["session_id"];
    if (typeof sid === "string") sessionIds.add(sid);
  }
  for (const kind of COUNTED_KINDS) {
    for (const row of rowsOfKind(snapshot, kind)) {
      const sid = row["session_id"];
      if (sid === null || sid === void 0) continue;
      if (typeof sid === "string" && !sessionIds.has(sid)) {
        out.push({
          kind,
          field: "session_id",
          detail: `references unknown session ${JSON.stringify(sid)}`
        });
      }
    }
  }
  for (const kind of ENTITY_ORDER) {
    const spec = specFor(kind);
    if (!spec.supersedable || !isCountedKind(kind)) continue;
    const ids = idsByKind.get(kind) ?? /* @__PURE__ */ new Set();
    const rows = rowsOfKind(snapshot, kind);
    const successorOf = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const id = row["id"];
      const by = row["superseded_by"];
      const at2 = row["superseded_at"];
      const reason = row["supersede_reason"];
      if (by === null !== (at2 === null)) {
        out.push({
          kind,
          field: "superseded_by",
          detail: "superseded_by and superseded_at must both be set or both be null"
        });
      }
      if (by === null && reason !== null) {
        out.push({
          kind,
          field: "supersede_reason",
          detail: "reason present on a row that is not superseded"
        });
      }
      if (by === null || typeof by !== "number") continue;
      if (typeof id === "number" && by === id) {
        out.push({ kind, field: "superseded_by", detail: `row ${id} supersedes itself` });
        continue;
      }
      if (!ids.has(by)) {
        out.push({
          kind,
          field: "superseded_by",
          detail: `dangling superseded_by ${by}`
        });
        continue;
      }
      if (typeof id === "number") successorOf.set(id, by);
    }
    for (const start of successorOf.keys()) {
      let cur = start;
      const path = /* @__PURE__ */ new Set();
      let steps = 0;
      while (cur !== void 0 && steps++ <= successorOf.size) {
        if (path.has(cur)) {
          out.push({
            kind,
            field: "superseded_by",
            detail: `supersession cycle through row ${cur}`
          });
          break;
        }
        path.add(cur);
        cur = successorOf.get(cur);
      }
    }
  }
  for (const row of rowsOfKind(snapshot, "obligation")) {
    const status = row["status"];
    const closed = row["closed_ts"];
    if (status === "open" && closed !== null) {
      out.push({
        kind: "obligation",
        field: "closed_ts",
        detail: "an open obligation must not have closed_ts"
      });
    }
    if ((status === "done" || status === "dropped") && closed === null) {
      out.push({
        kind: "obligation",
        field: "closed_ts",
        detail: `a ${status} obligation requires closed_ts`
      });
    }
  }
  return out;
}
function formatViolations(vs) {
  return vs.map((v) => `  ${v.kind}${v.field ? `.${v.field}` : ""}: ${v.detail}`).join("\n");
}
function assertIntegrity(snapshot) {
  const vs = findViolations(snapshot);
  if (vs.length === 0) return;
  raise(
    "supersession_dangling",
    `snapshot violates ${vs.length} integrity rule(s):
${formatViolations(vs)}`,
    { detail: formatViolations(vs) }
  );
}

// packages/session-store/src/sidecar-v1.ts
var SIDECAR_FORMAT = "foreman-session-sidecar";
var V1_FORMAT_VERSION = 1;
var TABLE_TO_KIND = {
  sessions: "session",
  facts: "fact",
  measurements: "measurement",
  obligations: "obligation"
};
var NON_ENTITY_TABLES = /* @__PURE__ */ new Set([
  "schema_meta",
  "store_meta",
  "memory_outbox"
]);
var KNOWN_HEADER_FIELDS = /* @__PURE__ */ new Set(["format", "format_version"]);
function parseLine(line, lineNo) {
  let doc;
  try {
    doc = JSON.parse(line);
  } catch {
    raise("sidecar_malformed", `line ${lineNo} is not valid JSON`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    raise("sidecar_malformed", `line ${lineNo} is not a JSON object`);
  }
  return doc;
}
function readHeaderV1(doc) {
  if (doc["format"] !== SIDECAR_FORMAT) {
    raise(
      "sidecar_format",
      `unsupported sidecar format ${JSON.stringify(String(doc["format"]))}`
    );
  }
  const fv = doc["format_version"];
  if (fv !== V1_FORMAT_VERSION) {
    raise("sidecar_format", `unsupported sidecar format version ${String(fv)}`);
  }
  for (const k of Object.keys(doc)) {
    if (!KNOWN_HEADER_FIELDS.has(k)) {
      raise("sidecar_format", `unknown header field ${JSON.stringify(k)}`);
    }
  }
}
function decodeSnapshotV1(lines) {
  if (lines.length === 0) {
    raise("sidecar_format", "sidecar is empty; a header record is required");
  }
  readHeaderV1(parseLine(lines[0], 1));
  const buckets = {
    session: [],
    fact: [],
    measurement: [],
    obligation: []
  };
  const seen = {
    session: /* @__PURE__ */ new Set(),
    fact: /* @__PURE__ */ new Set(),
    measurement: /* @__PURE__ */ new Set(),
    obligation: /* @__PURE__ */ new Set()
  };
  for (let i = 1; i < lines.length; i++) {
    const doc = parseLine(lines[i], i + 1);
    const keys = Object.keys(doc).sort().join(",");
    if (keys !== "row,table") {
      raise(
        "sidecar_malformed",
        `line ${i + 1} must contain exactly table and row`
      );
    }
    const table = doc["table"];
    if (typeof table !== "string") {
      raise("sidecar_malformed", `line ${i + 1} table is not a string`);
    }
    if (NON_ENTITY_TABLES.has(table)) {
      continue;
    }
    const kind = TABLE_TO_KIND[table];
    if (kind === void 0) {
      raise(
        "unknown_entity_kind",
        `unknown v1 table ${JSON.stringify(table)}`
      );
    }
    const row = doc["row"];
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      raise("sidecar_malformed", `line ${i + 1} row is not an object`);
    }
    const normalized = normalize(kind, row);
    const identityField = kind === "session" ? "session_id" : "id";
    const identity = String(normalized[identityField] ?? "");
    if (seen[kind].has(identity)) {
      raise(
        "identity_conflict",
        `duplicate ${kind} identity ${identity}`,
        { kind, field: identityField, detail: identity }
      );
    }
    seen[kind].add(identity);
    buckets[kind].push(normalized);
  }
  return {
    modelVersion: 1,
    nextIds: computeNextIds(buckets),
    sessions: buckets.session,
    facts: buckets.fact,
    measurements: buckets.measurement,
    obligations: buckets.obligation
  };
}
function normalize(kind, row) {
  if (kind !== "obligation" || row["status"] !== "blocked") {
    return row;
  }
  return { ...row, status: "open" };
}
function computeNextIds(buckets) {
  const next = {};
  for (const kind of COUNTED_KINDS) {
    let max = 0;
    for (const row of buckets[kind]) {
      const id = row["id"];
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
        raise("field_type", `${kind} row has a non-integer id`);
      }
      if (id > max) {
        max = id;
      }
    }
    next[kind] = max + 1;
  }
  return next;
}

// packages/session-store/src/sidecar.ts
var SIDECAR_FORMAT_VERSION = 2;
var UPGRADES = /* @__PURE__ */ new Map();
function encodeNumber(v) {
  if (!Number.isFinite(v)) {
    raise(
      "field_type",
      `non-finite number ${String(v)} cannot be encoded; reject at write time`
    );
  }
  return JSON.stringify(Object.is(v, -0) ? 0 : v);
}
function encodeValue(v) {
  if (v === null) return "null";
  if (typeof v === "number") return encodeNumber(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  raise("field_type", `value of type ${typeof v} is not encodable`);
}
function encodeObject(row, keys) {
  const parts = keys.map((k) => `${JSON.stringify(k)}:${encodeValue(row[k])}`);
  return `{${parts.join(",")}}`;
}
function encodeSnapshot(snapshot) {
  assertIntegrity(snapshot);
  const lines = [];
  const nextIdParts = COUNTED_KINDS.map(
    (k) => `${JSON.stringify(k)}:${encodeNumber(snapshot.nextIds[k])}`
  );
  lines.push(
    `{"format":${JSON.stringify(SIDECAR_FORMAT)},"format_version":${SIDECAR_FORMAT_VERSION},"session_model_version":${snapshot.modelVersion},"next_ids":{${nextIdParts.join(",")}}}`
  );
  for (const kind of ENTITY_ORDER) {
    const keys = specFor(kind).fields.map((f) => f.name);
    for (const row of rowsOfKind(snapshot, kind)) {
      lines.push(
        `{"kind":${JSON.stringify(kind)},"row":${encodeObject(row, keys)}}`
      );
    }
  }
  return lines.join("\n") + "\n";
}
function assertNoDuplicateKeys(line, lineNo) {
  const seen = /* @__PURE__ */ new Set();
  const re = /"((?:[^"\\]|\\.)*)"\s*:/g;
  let m;
  const depthAt = [];
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    depthAt[i] = depth;
  }
  while ((m = re.exec(line)) !== null) {
    const key = m[1] ?? "";
    const d = depthAt[m.index] ?? 0;
    const tag = `${d}:${key}`;
    if (seen.has(tag)) {
      raise(
        "sidecar_malformed",
        `duplicate key ${JSON.stringify(key)} on line ${lineNo}`
      );
    }
    seen.add(tag);
  }
}
function parseLine2(line, lineNo) {
  assertNoDuplicateKeys(line, lineNo);
  let doc;
  try {
    doc = JSON.parse(line);
  } catch (e) {
    raise(
      "sidecar_malformed",
      `invalid JSON on line ${lineNo}: ${e.message}`
    );
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    raise("sidecar_malformed", `line ${lineNo} is not a JSON object`);
  }
  return doc;
}
function readHeader(doc) {
  if (doc["format"] !== SIDECAR_FORMAT) {
    raise(
      "sidecar_format",
      `unsupported sidecar format ${JSON.stringify(String(doc["format"]))}`
    );
  }
  const fv = doc["format_version"];
  if (fv !== SIDECAR_FORMAT_VERSION) {
    raise("sidecar_format", `unsupported sidecar format version ${String(fv)}`);
  }
  const mv = doc["session_model_version"];
  if (typeof mv !== "number" || !Number.isSafeInteger(mv) || mv < 1) {
    raise("sidecar_format", `invalid session_model_version ${String(mv)}`);
  }
  const rawNext = doc["next_ids"];
  if (typeof rawNext !== "object" || rawNext === null) {
    raise("sidecar_format", "header is missing next_ids");
  }
  const nextRec = rawNext;
  const next = {};
  for (const k of COUNTED_KINDS) {
    const v = nextRec[k];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) {
      raise("sidecar_format", `invalid next_ids.${k}`);
    }
    next[k] = v;
  }
  const known = /* @__PURE__ */ new Set(["format", "format_version", "session_model_version", "next_ids"]);
  for (const k of Object.keys(doc)) {
    if (!known.has(k)) {
      raise("sidecar_format", `unknown header field ${JSON.stringify(k)}`);
    }
  }
  return {
    format: SIDECAR_FORMAT,
    format_version: SIDECAR_FORMAT_VERSION,
    session_model_version: mv,
    next_ids: next
  };
}
function decodeSnapshot(text) {
  if (text.includes("\r")) {
    raise("sidecar_malformed", "sidecar must use LF line endings");
  }
  const rawLines = text.split("\n");
  if (rawLines.length === 0 || rawLines[rawLines.length - 1] !== "") {
    raise("sidecar_malformed", "sidecar must end with exactly one newline");
  }
  const lines = rawLines.slice(0, -1);
  if (lines.length === 0) {
    raise("sidecar_format", "sidecar is empty; a header record is required");
  }
  const head = parseLine2(lines[0], 1);
  if (head["format_version"] === V1_FORMAT_VERSION) {
    const v1 = decodeSnapshotV1(lines);
    assertIntegrity(v1);
    return v1;
  }
  const header = readHeader(head);
  const buckets = {
    session: [],
    fact: [],
    measurement: [],
    obligation: []
  };
  const kindSet = new Set(ENTITY_KINDS);
  for (let i = 1; i < lines.length; i++) {
    const doc = parseLine2(lines[i], i + 1);
    if ("format" in doc) {
      raise("sidecar_format", `second header record on line ${i + 1}`);
    }
    const keys = Object.keys(doc).sort().join(",");
    if (keys !== "kind,row") {
      raise(
        "sidecar_malformed",
        `line ${i + 1} must contain exactly kind and row`
      );
    }
    const kind = doc["kind"];
    if (typeof kind !== "string" || !kindSet.has(kind)) {
      raise("unknown_entity_kind", `unknown entity kind ${JSON.stringify(String(kind))}`);
    }
    const row = doc["row"];
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      raise("sidecar_malformed", `line ${i + 1} row is not an object`);
    }
    buckets[kind].push(row);
  }
  let snapshot = {
    modelVersion: header.session_model_version,
    nextIds: header.next_ids,
    sessions: buckets.session,
    facts: buckets.fact,
    measurements: buckets.measurement,
    obligations: buckets.obligation
  };
  snapshot = applyVersionPolicy(snapshot);
  assertIntegrity(snapshot);
  return snapshot;
}
function applyVersionPolicy(snapshot) {
  if (snapshot.modelVersion > SESSION_MODEL_VERSION) {
    raise(
      "model_version_unsupported",
      `sidecar declares session model version ${snapshot.modelVersion}, but this build understands ${SESSION_MODEL_VERSION}. Refusing before any write. Upgrade Foreman to import it.`
    );
  }
  let cur = snapshot;
  while (cur.modelVersion < SESSION_MODEL_VERSION) {
    const up = UPGRADES.get(cur.modelVersion);
    if (!up) {
      raise(
        "model_version_unsupported",
        `no registered upgrade from session model version ${cur.modelVersion}`
      );
    }
    const next = up(cur);
    if (next.modelVersion <= cur.modelVersion) {
      raise(
        "model_version_unsupported",
        `upgrade from ${cur.modelVersion} did not advance the model version`
      );
    }
    cur = next;
  }
  return cur;
}

// packages/session-store/src/sqlite-store.ts
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
var TABLE = {
  session: "sessions",
  fact: "facts",
  measurement: "measurements",
  obligation: "obligations"
};
var SCHEMA = `
CREATE TABLE IF NOT EXISTS store_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  started_ts TEXT NOT NULL,
  start_sha  TEXT,
  ended_ts   TEXT,
  note       TEXT
);

CREATE TABLE IF NOT EXISTS facts (
  id               INTEGER PRIMARY KEY,
  statement        TEXT NOT NULL,
  evidence         TEXT,
  established_ts   TEXT NOT NULL,
  session_id       TEXT REFERENCES sessions(session_id),
  superseded_by    INTEGER REFERENCES facts(id),
  superseded_at    TEXT,
  supersede_reason TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id               INTEGER PRIMARY KEY,
  metric           TEXT NOT NULL,
  value            TEXT NOT NULL,
  value_num        REAL,
  command          TEXT,
  measured_ts      TEXT NOT NULL,
  measured_sha     TEXT,
  scope_paths      TEXT,
  session_id       TEXT REFERENCES sessions(session_id),
  superseded_by    INTEGER REFERENCES measurements(id),
  superseded_at    TEXT,
  supersede_reason TEXT
);

CREATE TABLE IF NOT EXISTS obligations (
  id         INTEGER PRIMARY KEY,
  statement  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  blocker    TEXT,
  opened_ts  TEXT NOT NULL,
  closed_ts  TEXT,
  session_id TEXT REFERENCES sessions(session_id)
);

-- Derived projection bookkeeping. Written in the same transaction as the row
-- it describes. Deliberately NOT part of SessionSnapshot: it is rebuildable and
-- nothing outside the projector may read it.
CREATE TABLE IF NOT EXISTS memory_outbox (
  key       TEXT PRIMARY KEY,
  kind      TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  mutation  TEXT NOT NULL,
  queued_ts TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meas_metric ON measurements(metric);
CREATE INDEX IF NOT EXISTS idx_oblig_status ON obligations(status);
CREATE INDEX IF NOT EXISTS idx_facts_superseded ON facts(superseded_by);
`;
function quoteIdent(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}
var SqliteSessionStore = class _SqliteSessionStore {
  modelVersion = SESSION_MODEL_VERSION;
  db;
  closed = false;
  constructor(db, opts = {}) {
    this.db = db;
    if (!opts.skipSchemaCheck) this.assertSchemaMatchesModel();
    this.ensureCounters();
  }
  // -- construction --------------------------------------------------------
  static open(path, opts = {}) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    if (opts.readOnly) {
      const db2 = new DatabaseSync(path, { readOnly: true });
      db2.exec("PRAGMA busy_timeout=5000");
      return new _SqliteSessionStore(db2, opts);
    }
    const db = new DatabaseSync(path);
    db.exec("PRAGMA busy_timeout=5000");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA synchronous=NORMAL");
    db.exec(SCHEMA);
    return new _SqliteSessionStore(db, opts);
  }
  /**
   * Compare the live SQLite schema to the declared model and fail on drift.
   * This is the check whose absence let the old code treat `sqlite_schema` as
   * the contract.
   */
  assertSchemaMatchesModel() {
    for (const kind of ENTITY_ORDER) {
      const table = TABLE[kind];
      const info = this.db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
      const actual = new Set(info.map((r) => r.name));
      const declared = specFor(kind).fields.map((f) => f.name);
      const missing = declared.filter((f) => !actual.has(f));
      const extra = [...actual].filter((c) => !declared.includes(c));
      if (missing.length > 0 || extra.length > 0) {
        raise(
          "backend_mismatch",
          `table ${table} does not match the model (missing=[${missing.join(", ")}], extra=[${extra.join(", ")}])`,
          { kind }
        );
      }
    }
  }
  ensureCounters() {
    const init = initialNextIds();
    for (const kind of COUNTED_KINDS) {
      const key = `next_id.${kind}`;
      const row = this.db.prepare("SELECT value FROM store_meta WHERE key = ?").get(key);
      if (row === void 0) {
        this.db.prepare("INSERT OR IGNORE INTO store_meta (key, value) VALUES (?, ?)").run(key, String(init[kind]));
      }
    }
  }
  // -- transaction helper --------------------------------------------------
  tx(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
      }
      throw e;
    }
  }
  // -- identity ------------------------------------------------------------
  peekNextId(kind) {
    const row = this.db.prepare("SELECT value FROM store_meta WHERE key = ?").get(`next_id.${kind}`);
    return row ? Number(row.value) : 1;
  }
  /** Mint the next id for `kind`. Must be called inside a transaction. */
  mintId(kind) {
    const id = this.peekNextId(kind);
    this.db.prepare("UPDATE store_meta SET value = ? WHERE key = ?").run(String(id + 1), `next_id.${kind}`);
    return id;
  }
  setNextIds(next) {
    for (const kind of COUNTED_KINDS) {
      this.db.prepare("UPDATE store_meta SET value = ? WHERE key = ?").run(String(next[kind]), `next_id.${kind}`);
    }
  }
  queueProjection(kind, id, mutation, ts) {
    this.db.prepare(
      "INSERT OR REPLACE INTO memory_outbox (key, kind, entity_id, mutation, queued_ts) VALUES (?, ?, ?, ?, ?)"
    ).run(`${kind}:${id}:${mutation}`, kind, id, mutation, ts);
  }
  // -- reads ---------------------------------------------------------------
  selectRows(kind) {
    const spec = specFor(kind);
    const cols = spec.fields.map((f) => quoteIdent(f.name)).join(", ");
    const order = spec.ordering.map((f) => quoteIdent(f)).join(", ");
    const sql = `SELECT ${cols} FROM ${quoteIdent(TABLE[kind])} ORDER BY ${order}`;
    const raw = this.db.prepare(sql).all();
    return raw.map((r) => {
      const out = {};
      for (const f of spec.fields) out[f.name] = r[f.name] ?? null;
      return out;
    });
  }
  /**
   * A whole-store picture, read inside ONE deferred read transaction.
   *
   * The transaction is load-bearing, not decoration. Without it each table's
   * SELECT is its own read transaction, so a writer committing between two of
   * them yields a torn picture -- facts from before the write and measurements
   * from after. The canonical sidecar is encoded from this value, so a torn
   * snapshot is a torn record of truth. BEGIN (deferred), not BEGIN IMMEDIATE:
   * this takes no write lock and does not block a concurrent writer.
   */
  snapshot() {
    this.db.exec("BEGIN");
    try {
      const out = this.readSnapshot();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
      }
      throw e;
    }
  }
  readSnapshot() {
    const nextIds = {};
    for (const kind of COUNTED_KINDS) nextIds[kind] = this.peekNextId(kind);
    return {
      modelVersion: this.modelVersion,
      nextIds,
      sessions: this.selectRows("session"),
      facts: this.selectRows("fact"),
      measurements: this.selectRows(
        "measurement"
      ),
      obligations: this.selectRows(
        "obligation"
      )
    };
  }
  listSessions() {
    return this.selectRows("session");
  }
  listFacts() {
    return this.selectRows("fact");
  }
  listMeasurements() {
    return this.selectRows("measurement");
  }
  listObligations() {
    return this.selectRows("obligation");
  }
  currentSession() {
    const r = this.db.prepare(
      "SELECT session_id, started_ts, start_sha, ended_ts, note FROM sessions WHERE ended_ts IS NULL ORDER BY session_id DESC LIMIT 1"
    ).get();
    if (!r) return null;
    return {
      session_id: r["session_id"],
      started_ts: r["started_ts"],
      start_sha: r["start_sha"] ?? null,
      ended_ts: r["ended_ts"] ?? null,
      note: r["note"] ?? null
    };
  }
  // -- writes --------------------------------------------------------------
  beginSession(args) {
    return this.tx(() => {
      this.db.prepare(
        "INSERT INTO sessions (session_id, started_ts, start_sha, ended_ts, note) VALUES (?, ?, ?, NULL, ?)"
      ).run(args.session_id, args.started_ts, args.start_sha, args.note);
      return {
        session_id: args.session_id,
        started_ts: args.started_ts,
        start_sha: args.start_sha,
        ended_ts: null,
        note: args.note
      };
    });
  }
  endSession(sessionId, endedTs) {
    return this.tx(() => {
      const existing = this.db.prepare("SELECT session_id, ended_ts FROM sessions WHERE session_id = ?").get(sessionId);
      if (!existing) {
        raise("invalid_argument", `no such session ${JSON.stringify(sessionId)}`);
      }
      if (existing.ended_ts !== null) {
        raise(
          "supersession_incomplete",
          `session ${JSON.stringify(sessionId)} is already ended; ended_ts is set-once`
        );
      }
      this.db.prepare("UPDATE sessions SET ended_ts = ? WHERE session_id = ?").run(endedTs, sessionId);
      const r = this.db.prepare(
        "SELECT session_id, started_ts, start_sha, ended_ts, note FROM sessions WHERE session_id = ?"
      ).get(sessionId);
      return {
        session_id: r["session_id"],
        started_ts: r["started_ts"],
        start_sha: r["start_sha"] ?? null,
        ended_ts: r["ended_ts"] ?? null,
        note: r["note"] ?? null
      };
    });
  }
  addFact(fact2) {
    return this.tx(() => this.insertFact(fact2));
  }
  insertFact(fact2) {
    const id = this.mintId("fact");
    this.db.prepare(
      "INSERT INTO facts (id, statement, evidence, established_ts, session_id, superseded_by, superseded_at, supersede_reason) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)"
    ).run(id, fact2.statement, fact2.evidence, fact2.established_ts, fact2.session_id);
    this.queueProjection("fact", id, "upsert", fact2.established_ts);
    return {
      id,
      statement: fact2.statement,
      evidence: fact2.evidence,
      established_ts: fact2.established_ts,
      session_id: fact2.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null
    };
  }
  addMeasurement(m) {
    return this.tx(() => this.insertMeasurement(m));
  }
  insertMeasurement(m) {
    if (m.value_num !== null && !Number.isFinite(m.value_num)) {
      raise("field_type", `value_num must be finite, got ${String(m.value_num)}`);
    }
    const id = this.mintId("measurement");
    this.db.prepare(
      "INSERT INTO measurements (id, metric, value, value_num, command, measured_ts, measured_sha, scope_paths, session_id, superseded_by, superseded_at, supersede_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)"
    ).run(
      id,
      m.metric,
      m.value,
      m.value_num,
      m.command,
      m.measured_ts,
      m.measured_sha,
      m.scope_paths,
      m.session_id
    );
    this.queueProjection("measurement", id, "upsert", m.measured_ts);
    return {
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
      supersede_reason: null
    };
  }
  addObligation(o) {
    return this.tx(() => {
      const id = this.mintId("obligation");
      this.db.prepare(
        "INSERT INTO obligations (id, statement, status, blocker, opened_ts, closed_ts, session_id) VALUES (?, ?, 'open', ?, ?, NULL, ?)"
      ).run(id, o.statement, o.blocker, o.opened_ts, o.session_id);
      this.queueProjection("obligation", id, "upsert", o.opened_ts);
      return {
        id,
        statement: o.statement,
        status: "open",
        blocker: o.blocker,
        opened_ts: o.opened_ts,
        closed_ts: null,
        session_id: o.session_id
      };
    });
  }
  closeObligation(id, status, closedTs) {
    return this.tx(() => {
      const cur = this.db.prepare("SELECT status FROM obligations WHERE id = ?").get(id);
      if (!cur) raise("invalid_argument", `no such obligation ${id}`);
      if (cur.status !== "open") {
        raise(
          "invalid_argument",
          `obligation ${id} is already ${cur.status}; only an open obligation may be closed`
        );
      }
      this.db.prepare("UPDATE obligations SET status = ?, closed_ts = ? WHERE id = ?").run(status, closedTs, id);
      this.queueProjection("obligation", id, "upsert", closedTs);
      const r = this.db.prepare(
        "SELECT id, statement, status, blocker, opened_ts, closed_ts, session_id FROM obligations WHERE id = ?"
      ).get(id);
      return {
        id: r["id"],
        statement: r["statement"],
        status: r["status"],
        blocker: r["blocker"] ?? null,
        opened_ts: r["opened_ts"],
        closed_ts: r["closed_ts"] ?? null,
        session_id: r["session_id"] ?? null
      };
    });
  }
  supersedeFact(id, replacement, reason, at2) {
    return this.tx(() => {
      const cur = this.db.prepare("SELECT superseded_by FROM facts WHERE id = ?").get(id);
      if (!cur) raise("invalid_argument", `no such fact ${id}`);
      if (cur.superseded_by !== null) {
        raise(
          "supersession_incomplete",
          `fact ${id} is already superseded; supersession columns are set-once`
        );
      }
      const next = this.insertFact(replacement);
      this.db.prepare(
        "UPDATE facts SET superseded_by = ?, superseded_at = ?, supersede_reason = ? WHERE id = ?"
      ).run(next.id, at2, reason, id);
      this.queueProjection("fact", id, "retract", at2);
      const old = this.db.prepare(
        "SELECT id, statement, evidence, established_ts, session_id, superseded_by, superseded_at, supersede_reason FROM facts WHERE id = ?"
      ).get(id);
      return { superseded: old, replacement: next };
    });
  }
  supersedeMeasurement(id, replacement, reason, at2) {
    return this.tx(() => {
      const cur = this.db.prepare("SELECT superseded_by FROM measurements WHERE id = ?").get(id);
      if (!cur) raise("invalid_argument", `no such measurement ${id}`);
      if (cur.superseded_by !== null) {
        raise(
          "supersession_incomplete",
          `measurement ${id} is already superseded; supersession columns are set-once`
        );
      }
      const next = this.insertMeasurement(replacement);
      this.db.prepare(
        "UPDATE measurements SET superseded_by = ?, superseded_at = ?, supersede_reason = ? WHERE id = ?"
      ).run(next.id, at2, reason, id);
      this.queueProjection("measurement", id, "retract", at2);
      const old = this.db.prepare(
        "SELECT id, metric, value, value_num, command, measured_ts, measured_sha, scope_paths, session_id, superseded_by, superseded_at, supersede_reason FROM measurements WHERE id = ?"
      ).get(id);
      return { superseded: old, replacement: next };
    });
  }
  retireMeasurement(id, byId, reason, at2) {
    return this.tx(() => {
      if (byId === id) {
        raise("invalid_argument", `measurement ${id} cannot supersede itself`);
      }
      const cur = this.db.prepare("SELECT superseded_by FROM measurements WHERE id = ?").get(id);
      if (!cur) raise("invalid_argument", `no such measurement ${id}`);
      if (cur.superseded_by !== null) {
        raise(
          "supersession_incomplete",
          `measurement ${id} is already superseded; supersession columns are set-once`
        );
      }
      const by = this.db.prepare("SELECT superseded_by FROM measurements WHERE id = ?").get(byId);
      if (!by) raise("invalid_argument", `no such measurement ${byId}`);
      if (by.superseded_by !== null) {
        raise(
          "invalid_argument",
          `measurement ${byId} is itself superseded by ${by.superseded_by}; a retired measurement cannot supersede another`
        );
      }
      this.db.prepare(
        "UPDATE measurements SET superseded_by = ?, superseded_at = ?, supersede_reason = ? WHERE id = ?"
      ).run(byId, at2, reason, id);
      this.queueProjection("measurement", id, "retract", at2);
      return this.db.prepare(
        "SELECT id, metric, value, value_num, command, measured_ts, measured_sha, scope_paths, session_id, superseded_by, superseded_at, supersede_reason FROM measurements WHERE id = ?"
      ).get(id);
    });
  }
  // -- snapshot transfer ---------------------------------------------------
  importSnapshot(snapshot, opts = {}) {
    assertIntegrity(snapshot);
    if (snapshot.modelVersion !== this.modelVersion) {
      raise(
        "model_version_unsupported",
        `snapshot model version ${snapshot.modelVersion} != store ${this.modelVersion}`
      );
    }
    const force = opts.force ?? false;
    const policy = opts.onIdCollision ?? "refuse";
    return this.tx(() => {
      this.db.exec("PRAGMA defer_foreign_keys=ON");
      const occupied = ENTITY_ORDER.some(
        (k) => this.db.prepare(`SELECT 1 FROM ${quoteIdent(TABLE[k])} LIMIT 1`).get() !== void 0
      );
      if (occupied && !force) {
        raise(
          "store_not_empty",
          "target store already has rows; pass force to replace it"
        );
      }
      if (occupied && policy === "remap") {
        raise(
          "invalid_argument",
          "remap id-collision policy is not implemented; import into an empty store"
        );
      }
      for (const kind of [...ENTITY_ORDER].reverse()) {
        this.db.exec(`DELETE FROM ${quoteIdent(TABLE[kind])}`);
      }
      this.db.exec("DELETE FROM memory_outbox");
      let written = 0;
      for (const kind of ENTITY_ORDER) {
        const spec = specFor(kind);
        const names = spec.fields.map((f) => f.name);
        const cols = names.map(quoteIdent).join(", ");
        const qs = names.map(() => "?").join(", ");
        const stmt = this.db.prepare(
          `INSERT INTO ${quoteIdent(TABLE[kind])} (${cols}) VALUES (${qs})`
        );
        for (const row of rowsOfKind(snapshot, kind)) {
          const r = row;
          stmt.run(...names.map((n) => r[n] ?? null));
          written++;
        }
      }
      this.setNextIds(snapshot.nextIds);
      return written;
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
};

// packages/session-store/src/contract-suite.ts
function assert(cond, msg) {
  if (!cond) {
    const e = new Error(msg);
    e.name = "AssertionError";
    throw e;
  }
}
function assertRejects(fn, reason) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    const got = reasonOf(e);
    assert(
      got === reason,
      `expected failure ${reason}, got ${got ?? e.message}`
    );
  }
  assert(threw, `expected failure ${reason}, but the call succeeded`);
}
function assertViolation(snap, match, msg) {
  const vs = findViolations(snap);
  const found = vs.some((v) => v.detail.includes(match));
  assert(
    found,
    `${msg} (expected a violation detail containing ${JSON.stringify(match)}; got: ${vs.length === 0 ? "no violations" : vs.map((v) => v.detail).join("; ")})`
  );
}
function seedFixture(store) {
  store.beginSession({
    session_id: "S1",
    started_ts: "2026-08-08T10:00:00Z",
    start_sha: "abc123",
    note: null
  });
  const f1 = store.addFact({
    statement: "the port is the contract",
    evidence: null,
    established_ts: "2026-08-08T10:01:00Z",
    session_id: "S1"
  });
  store.supersedeFact(
    f1.id,
    {
      statement: "the port is the contract, and the model declares it",
      evidence: "packages/session-store/src/entities.ts",
      established_ts: "2026-08-08T10:02:00Z",
      session_id: "S1"
    },
    "sharpened",
    "2026-08-08T10:02:00Z"
  );
  store.addMeasurement({
    metric: "typecheck.errors",
    value: "0",
    value_num: 0,
    command: "npm run typecheck",
    measured_ts: "2026-08-08T10:03:00Z",
    measured_sha: "abc123",
    scope_paths: "packages/session-store",
    session_id: "S1"
  });
  const o1 = store.addObligation({
    statement: "write the conformance suite",
    blocker: null,
    opened_ts: "2026-08-08T10:04:00Z",
    session_id: "S1"
  });
  store.closeObligation(o1.id, "done", "2026-08-08T10:05:00Z");
}
function withFacts(base, facts) {
  return { ...base, facts };
}
function baseWithSession() {
  return {
    ...emptySnapshot(),
    sessions: [
      {
        session_id: "S1",
        started_ts: "2026-08-08T10:00:00Z",
        start_sha: null,
        ended_ts: null,
        note: null
      }
    ]
  };
}
function fact(over) {
  return {
    id: 1,
    statement: "s",
    evidence: null,
    established_ts: "2026-08-08T10:00:00Z",
    session_id: "S1",
    superseded_by: null,
    superseded_at: null,
    supersede_reason: null,
    ...over
  };
}
var CASES = [
  {
    name: "roundtrip/empty-store",
    run: (f) => {
      const s = f();
      try {
        const snap = s.snapshot();
        const back = decodeSnapshot(encodeSnapshot(snap));
        assert(snapshotsEqual(snap, back), "empty snapshot did not round-trip");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "roundtrip/populated-store",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const snap = s.snapshot();
        const back = decodeSnapshot(encodeSnapshot(snap));
        assert(snapshotsEqual(snap, back), "populated snapshot did not round-trip");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "roundtrip/import-of-export-is-equal",
    run: (f) => {
      const a = f();
      const b = f();
      try {
        seedFixture(a);
        const snap = a.snapshot();
        b.importSnapshot(decodeSnapshot(encodeSnapshot(snap)));
        assert(
          snapshotsEqual(snap, b.snapshot()),
          "import(export(store)) produced a different snapshot"
        );
      } finally {
        a.close();
        b.close();
      }
    }
  },
  {
    name: "encoding/byte-stable-across-repeated-encodes",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const one = encodeSnapshot(s.snapshot());
        const two = encodeSnapshot(s.snapshot());
        assert(one === two, "two encodes of an untouched store differed");
        const three = encodeSnapshot(decodeSnapshot(one));
        assert(one === three, "encode\u2218decode\u2218encode was not byte-identical");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "encoding/ends-with-exactly-one-newline",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const text = encodeSnapshot(s.snapshot());
        assert(text.endsWith("\n"), "sidecar must end with a newline");
        assert(!text.endsWith("\n\n"), "sidecar must not end with a blank line");
        assert(!text.includes("\r"), "sidecar must not contain CR");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "identity/ids-are-port-minted-and-advance",
    run: (f) => {
      const s = f();
      try {
        assert(s.peekNextId("fact") === 1, "fresh store should mint fact id 1");
        const a = s.addFact({
          statement: "a",
          evidence: null,
          established_ts: "2026-08-08T10:00:00Z",
          session_id: null
        });
        assert(a.id === 1, `expected minted id 1, got ${a.id}`);
        assert(s.peekNextId("fact") === 2, "counter did not advance");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "identity/allocation-state-round-trips",
    run: (f) => {
      const a = f();
      const b = f();
      try {
        seedFixture(a);
        const before = a.peekNextId("fact");
        b.importSnapshot(decodeSnapshot(encodeSnapshot(a.snapshot())));
        assert(
          b.peekNextId("fact") === before,
          `next id did not round-trip: ${b.peekNextId("fact")} != ${before}`
        );
      } finally {
        a.close();
        b.close();
      }
    }
  },
  {
    name: "supersession/set-once",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const superseded = s.listFacts().find((r) => r.superseded_by !== null);
        assert(superseded !== void 0, "fixture should contain a superseded fact");
        assertRejects(
          () => s.supersedeFact(
            superseded.id,
            {
              statement: "third",
              evidence: null,
              established_ts: "2026-08-08T11:00:00Z",
              session_id: "S1"
            },
            null,
            "2026-08-08T11:00:00Z"
          ),
          "supersession_incomplete"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "supersession/fan-in-is-accepted",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: 3, superseded_at: "2026-08-08T10:00:00Z" }),
          fact({ id: 2, superseded_by: 3, superseded_at: "2026-08-08T10:00:00Z" }),
          fact({ id: 3 })
        ]),
        nextIds: { fact: 4, measurement: 1, obligation: 1 }
      };
      assert(
        findViolations(snap).length === 0,
        "legitimate fan-in supersession was rejected"
      );
    }
  },
  {
    name: "supersession/fan-in-does-not-disable-other-checks",
    run: () => {
      const dangling = {
        ...withFacts(baseWithSession(), [
          fact({ superseded_by: 99, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 }
      };
      assertViolation(dangling, "dangling superseded_by", "dangling pointer was accepted");
      const selfSupersede = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: 1, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 }
      };
      assertViolation(selfSupersede, "supersedes itself", "self-supersession was accepted");
      const cycle = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: 2, superseded_at: "2026-08-08T10:00:00Z" }),
          fact({ id: 2, superseded_by: 1, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 3, measurement: 1, obligation: 1 }
      };
      assertViolation(cycle, "supersession cycle", "supersession cycle was accepted");
    }
  },
  {
    name: "obligation/close-is-once-only",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const done = s.listObligations().find((o) => o.status === "done");
        assert(done !== void 0, "fixture should contain a closed obligation");
        assertRejects(
          () => s.closeObligation(done.id, "dropped", "2026-08-08T12:00:00Z"),
          "invalid_argument"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "session/end-is-once-only",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const first = s.endSession("S1", "2026-08-08T12:00:00Z");
        assert(first.ended_ts === "2026-08-08T12:00:00Z", "first end must stamp ended_ts");
        assertRejects(
          () => s.endSession("S1", "2026-08-08T12:01:00Z"),
          "supersession_incomplete"
        );
        const after = s.listSessions().find((row) => row.session_id === "S1");
        assert(
          after?.ended_ts === "2026-08-08T12:00:00Z",
          "a second end must not rewrite ended_ts"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "write/rejects-non-finite-value-num",
    run: (f) => {
      const s = f();
      try {
        assertRejects(
          () => s.addMeasurement({
            metric: "rate",
            value: "Infinity",
            value_num: Number.POSITIVE_INFINITY,
            command: null,
            measured_ts: "2026-08-08T10:00:00Z",
            measured_sha: null,
            scope_paths: null,
            session_id: null
          }),
          "field_type"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "import/refuses-non-empty-store-without-force",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        assertRejects(
          () => s.importSnapshot(emptySnapshot()),
          "store_not_empty"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "import/newer-model-version-refused-without-mutation",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const before = encodeSnapshot(s.snapshot());
        const future = {
          ...emptySnapshot(),
          modelVersion: SESSION_MODEL_VERSION + 1
        };
        assertRejects(
          () => s.importSnapshot(future, { force: true }),
          "model_version_unsupported"
        );
        assert(
          encodeSnapshot(s.snapshot()) === before,
          "store was mutated despite refusing a newer model version"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/points-one-existing-measurement-at-another",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const a = s.addMeasurement({
          metric: "suite.pass",
          value: "700",
          value_num: 700,
          command: "bats tests/",
          measured_ts: "2026-08-08T11:00:00Z",
          measured_sha: "aaa111",
          scope_paths: "tests",
          session_id: "S1"
        });
        const b = s.addMeasurement({
          metric: "suite.pass",
          value: "720",
          value_num: 720,
          command: "bats tests/",
          measured_ts: "2026-08-08T12:00:00Z",
          measured_sha: "bbb222",
          scope_paths: "tests",
          session_id: "S1"
        });
        const before = s.listMeasurements().length;
        const retired = s.retireMeasurement(a.id, b.id, "stale", "2026-08-08T12:00:01Z");
        assert(retired.superseded_by === b.id, "superseded_by was not set to byId");
        assert(retired.superseded_at === "2026-08-08T12:00:01Z", "superseded_at was not set");
        assert(retired.supersede_reason === "stale", "supersede_reason was not set");
        assert(
          s.listMeasurements().length === before,
          "retire inserted a row; it must only link existing rows"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/fan-in-many-predecessors-onto-one-successor",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const mk = (v, ts) => s.addMeasurement({
          metric: "suite.pass",
          value: v,
          value_num: Number(v),
          command: "bats tests/",
          measured_ts: ts,
          measured_sha: "ccc333",
          scope_paths: "tests",
          session_id: "S1"
        });
        const p1 = mk("1", "2026-08-08T11:00:00Z");
        const p2 = mk("2", "2026-08-08T11:01:00Z");
        const p3 = mk("3", "2026-08-08T11:02:00Z");
        const fresh = mk("4", "2026-08-08T12:00:00Z");
        for (const p of [p1, p2, p3]) {
          s.retireMeasurement(p.id, fresh.id, "retired by a fresh reading", "2026-08-08T12:00:01Z");
        }
        const rows = s.listMeasurements();
        const naming = rows.filter((r) => r.superseded_by === fresh.id);
        assert(naming.length === 3, `expected 3 rows naming ${fresh.id}, got ${naming.length}`);
        const back = decodeSnapshot(encodeSnapshot(s.snapshot()));
        assert(snapshotsEqual(s.snapshot(), back), "fan-in snapshot did not round-trip");
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/refuses-missing-target",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        assertRejects(
          () => s.retireMeasurement(9999, 1, "r", "2026-08-08T12:00:00Z"),
          "invalid_argument"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/refuses-missing-successor",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const only = s.listMeasurements()[0];
        assert(only !== void 0, "fixture has no measurement");
        assertRejects(
          () => s.retireMeasurement(only.id, 9999, "r", "2026-08-08T12:00:00Z"),
          "invalid_argument"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/refuses-self-retire",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const only = s.listMeasurements()[0];
        assert(only !== void 0, "fixture has no measurement");
        assertRejects(
          () => s.retireMeasurement(only.id, only.id, "r", "2026-08-08T12:00:00Z"),
          "invalid_argument"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/refuses-already-retired-target",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const mk = (v, ts) => s.addMeasurement({
          metric: "m",
          value: v,
          value_num: Number(v),
          command: null,
          measured_ts: ts,
          measured_sha: null,
          scope_paths: "x",
          session_id: "S1"
        });
        const a = mk("1", "2026-08-08T11:00:00Z");
        const b = mk("2", "2026-08-08T11:01:00Z");
        const c = mk("3", "2026-08-08T11:02:00Z");
        s.retireMeasurement(a.id, b.id, "first", "2026-08-08T11:03:00Z");
        assertRejects(
          () => s.retireMeasurement(a.id, c.id, "second", "2026-08-08T11:04:00Z"),
          "supersession_incomplete"
        );
      } finally {
        s.close();
      }
    }
  },
  {
    name: "retire/refuses-a-retired-successor",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const mk = (v, ts) => s.addMeasurement({
          metric: "m",
          value: v,
          value_num: Number(v),
          command: null,
          measured_ts: ts,
          measured_sha: null,
          scope_paths: "x",
          session_id: "S1"
        });
        const a = mk("1", "2026-08-08T11:00:00Z");
        const b = mk("2", "2026-08-08T11:01:00Z");
        const c = mk("3", "2026-08-08T11:02:00Z");
        s.retireMeasurement(b.id, c.id, "b is retired", "2026-08-08T11:03:00Z");
        assertRejects(
          () => s.retireMeasurement(a.id, b.id, "r", "2026-08-08T11:04:00Z"),
          "invalid_argument"
        );
      } finally {
        s.close();
      }
    }
  }
];
var HOSTILE_CASES = [
  {
    name: "hostile/dangling-superseded-by",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [
          fact({ superseded_by: 99, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 }
      };
      assertViolation(snap, "dangling superseded_by", "dangling pointer was accepted");
    }
  },
  {
    name: "hostile/self-supersession",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: 1, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 }
      };
      assertViolation(snap, "supersedes itself", "self-supersession was accepted");
    }
  },
  {
    name: "hostile/supersession-cycle",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: 2, superseded_at: "2026-08-08T10:00:00Z" }),
          fact({ id: 2, superseded_by: 1, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 3, measurement: 1, obligation: 1 }
      };
      assertViolation(snap, "supersession cycle", "supersession cycle was accepted");
    }
  },
  {
    name: "hostile/partial-supersession-metadata",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: null, superseded_at: "2026-08-08T10:00:00Z" })
        ]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 }
      };
      assertViolation(
        snap,
        "must both be set or both be null",
        "superseded_at without superseded_by was accepted"
      );
    }
  },
  {
    name: "hostile/absent-field-instead-of-null",
    run: () => {
      const partial = { ...fact({}) };
      delete partial["evidence"];
      const snap = withFacts(baseWithSession(), [partial]);
      assert(findViolations(snap).length > 0, "absent key was accepted");
    }
  },
  {
    name: "hostile/unknown-extra-field",
    run: () => {
      const snap = withFacts(baseWithSession(), [fact({ rogue: "x" })]);
      assert(findViolations(snap).length > 0, "unknown field was accepted");
    }
  },
  {
    name: "hostile/unknown-session-reference",
    run: () => {
      const snap = withFacts(baseWithSession(), [fact({ session_id: "NOPE" })]);
      assert(findViolations(snap).length > 0, "dangling session ref was accepted");
    }
  },
  {
    name: "hostile/duplicate-id",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [fact({ id: 1 }), fact({ id: 1 })]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 }
      };
      assert(findViolations(snap).length > 0, "duplicate id was accepted");
    }
  },
  {
    name: "hostile/id-at-or-above-watermark",
    run: () => {
      const snap = withFacts(baseWithSession(), [fact({ id: 5 })]);
      assert(
        findViolations(snap).length > 0,
        "id at/above nextIds watermark was accepted"
      );
    }
  },
  {
    name: "hostile/rows-out-of-declared-order",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [fact({ id: 2 }), fact({ id: 1 })]),
        nextIds: { fact: 3, measurement: 1, obligation: 1 }
      };
      assert(findViolations(snap).length > 0, "out-of-order rows were accepted");
    }
  },
  {
    name: "hostile/open-obligation-with-closed-ts",
    run: () => {
      const snap = {
        ...baseWithSession(),
        nextIds: { fact: 1, measurement: 1, obligation: 2 },
        obligations: [
          {
            id: 1,
            statement: "x",
            status: "open",
            blocker: null,
            opened_ts: "2026-08-08T10:00:00Z",
            closed_ts: "2026-08-08T11:00:00Z",
            session_id: "S1"
          }
        ]
      };
      assert(
        findViolations(snap).length > 0,
        "open obligation with closed_ts was accepted"
      );
    }
  },
  {
    name: "hostile/duplicate-json-key-in-sidecar",
    run: () => {
      const line = '{"format":"foreman-session-sidecar","format_version":2,"session_model_version":1,"next_ids":{"fact":1,"measurement":1,"obligation":1}}\n{"kind":"session","kind":"session","row":{}}\n';
      let threw = false;
      try {
        decodeSnapshot(line);
      } catch {
        threw = true;
      }
      assert(threw, "duplicate JSON key was accepted");
    }
  },
  {
    name: "hostile/crlf-line-endings",
    run: () => {
      let threw = false;
      try {
        decodeSnapshot(encodeSnapshot(emptySnapshot()).replace(/\n/g, "\r\n"));
      } catch {
        threw = true;
      }
      assert(threw, "CRLF sidecar was accepted");
    }
  },
  {
    name: "hostile/missing-trailing-newline",
    run: () => {
      let threw = false;
      try {
        decodeSnapshot(encodeSnapshot(emptySnapshot()).trimEnd());
      } catch {
        threw = true;
      }
      assert(threw, "sidecar without a trailing newline was accepted");
    }
  },
  {
    name: "hostile/unknown-entity-kind",
    run: () => {
      const text = '{"format":"foreman-session-sidecar","format_version":2,"session_model_version":1,"next_ids":{"fact":1,"measurement":1,"obligation":1}}\n{"kind":"wormhole","row":{}}\n';
      let threw = false;
      try {
        decodeSnapshot(text);
      } catch {
        threw = true;
      }
      assert(threw, "unknown entity kind was accepted");
    }
  }
];
var ALL_CASES = [...CASES, ...HOSTILE_CASES];
var STORE_CASES = ALL_CASES.filter(
  (c) => c.run.length > 0
);

// packages/orchestration/src/session-legacy-shape.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
import fs from "node:fs";
import { resolve } from "node:path";

// packages/orchestration/src/session-rebuild.ts
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
function removeJournalSidecars(dbPath2) {
  rmSync(`${dbPath2}-wal`, { force: true });
  rmSync(`${dbPath2}-shm`, { force: true });
}
function rebuildFromSidecar(opts) {
  if (existsSync(opts.dbPath) && opts.force !== true) {
    throw new Error(
      `${opts.dbPath} already exists; pass force to replace it. Rebuilding onto an existing file would skip schema creation.`
    );
  }
  const snapshot = decodeSnapshot(readFileSync(opts.sidecarPath, "utf8"));
  const tmpPath = `${opts.dbPath}.rebuild`;
  rmSync(tmpPath, { force: true });
  removeJournalSidecars(tmpPath);
  const store = SqliteSessionStore.open(tmpPath);
  let rowsWritten;
  try {
    rowsWritten = store.importSnapshot(snapshot);
  } finally {
    store.close();
  }
  removeJournalSidecars(tmpPath);
  const asideWal = `${opts.dbPath}-wal.rebuild-aside`;
  const asideShm = `${opts.dbPath}-shm.rebuild-aside`;
  rmSync(asideWal, { force: true });
  rmSync(asideShm, { force: true });
  const movedWal = existsSync(`${opts.dbPath}-wal`);
  if (movedWal) renameSync(`${opts.dbPath}-wal`, asideWal);
  const movedShm = existsSync(`${opts.dbPath}-shm`);
  if (movedShm) renameSync(`${opts.dbPath}-shm`, asideShm);
  try {
    renameSync(tmpPath, opts.dbPath);
  } catch (e) {
    try {
      if (movedWal) renameSync(asideWal, `${opts.dbPath}-wal`);
      if (movedShm) renameSync(asideShm, `${opts.dbPath}-shm`);
    } catch {
    }
    throw e;
  }
  try {
    opts.afterRename?.();
  } finally {
    rmSync(asideWal, { force: true });
    rmSync(asideShm, { force: true });
    removeJournalSidecars(tmpPath);
  }
  return { rowsWritten, nextIds: snapshot.nextIds };
}

// packages/orchestration/src/session-legacy-shape.ts
var SQLITE_BUSY = 5;
var SQLITE_READONLY = 8;
var SQLITE_CORRUPT = 11;
var SQLITE_CANTOPEN = 14;
var SQLITE_READONLY_DIRECTORY = 1544;
var LegacyMigrationRefusal = class extends Error {
  constructor(message) {
    super(message);
    this.name = "LegacyMigrationRefusal";
  }
};
var V1_TABLE = {
  session: "sessions",
  fact: "facts",
  measurement: "measurements",
  obligation: "obligations"
};
function quoteIdentifier(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}
function asJsonValue(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(asJsonValue);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = asJsonValue(v);
    return out;
  }
  return String(value);
}
function jsonDumps(obj, sortKeys = false) {
  if (obj === null) return "null";
  if (typeof obj === "boolean") return obj ? "true" : "false";
  if (typeof obj === "number") return JSON.stringify(obj);
  if (typeof obj === "string") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map((v) => jsonDumps(v, sortKeys)).join(", ") + "]";
  }
  const keys = sortKeys ? Object.keys(obj).sort() : Object.keys(obj);
  return "{" + keys.map((k) => {
    const value = obj[k];
    return JSON.stringify(k) + ": " + jsonDumps(value === void 0 ? null : value, sortKeys);
  }).join(", ") + "}";
}
function errorMessage(e) {
  return e instanceof Error ? e.message : String(e);
}
function sqliteErrcode(e) {
  if (typeof e !== "object" || e === null) return void 0;
  const code = e.errcode;
  return typeof code === "number" ? code : void 0;
}
function trackedSidecarCanRebuild(dbPath2) {
  const sidecar = sidecarPathFor(dbPath2);
  try {
    if (!fs.existsSync(sidecar)) return true;
    decodeSnapshot(fs.readFileSync(sidecar, "utf8"));
    return true;
  } catch {
    return false;
  }
}
function sidecarRebuildRemedy(dbPath2, asideSuffix) {
  const move = `mv ${dbPath2} ${dbPath2}.${asideSuffix} && fm-session recover`;
  if (trackedSidecarCanRebuild(dbPath2)) {
    return `Move it aside and rebuild from the tracked sidecar: ${move}`;
  }
  return `The tracked sidecar cannot be used to rebuild this store. Clear the sidecar fault, then: ${move}`;
}
function classifyStore(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch (e) {
    const code = typeof e === "object" && e !== null ? e.code : void 0;
    if (code === "ENOENT") return "absent";
    throw e;
  }
  if (st.isSymbolicLink()) {
    try {
      st = fs.statSync(p);
    } catch {
      return "unrecognised";
    }
  }
  if (!st.isFile() && !st.isDirectory()) {
    return "unrecognised";
  }
  const db = new DatabaseSync2(p, { readOnly: true });
  try {
    let names;
    try {
      names = new Set(
        db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((r) => r.name)
      );
    } catch (e) {
      const errcode = sqliteErrcode(e);
      if (errcode === SQLITE_CORRUPT) return "corrupt";
      if (errcode === SQLITE_BUSY || errcode === SQLITE_READONLY || errcode === SQLITE_READONLY_DIRECTORY || errcode === SQLITE_CANTOPEN) {
        throw e;
      }
      return "unrecognised";
    }
    const hasPort = names.has("store_meta");
    const hasLegacy = names.has("schema_meta");
    if (hasPort && hasLegacy) return "corrupt";
    if (hasPort) {
      for (const [kind, table] of [
        ["fact", "facts"],
        ["measurement", "measurements"],
        ["obligation", "obligations"]
      ]) {
        if (!names.has(table)) continue;
        const row = db.prepare(`SELECT MAX(id) AS m FROM ${quoteIdentifier(table)}`).get();
        const max = row && row.m !== null ? Number(row.m) : 0;
        const wm = db.prepare("SELECT value FROM store_meta WHERE key = ?").get(`next_id.${kind}`);
        if (wm === void 0 || typeof wm.value !== "string") return "corrupt";
        const next = Number(wm.value);
        if (!Number.isFinite(next)) return "corrupt";
        if (next <= max) return "corrupt";
      }
      return "port";
    }
    if (hasLegacy) return "legacy";
    return "unrecognised";
  } finally {
    db.close();
  }
}
function legacyDumpV1(p) {
  const db = new DatabaseSync2(p);
  try {
    db.exec("PRAGMA foreign_keys=OFF");
    const present = new Set(
      db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((r) => r.name)
    );
    const documents = [jsonDumps({ format: SIDECAR_FORMAT, format_version: 1 }, true)];
    for (const kind of ENTITY_ORDER) {
      const table = V1_TABLE[kind];
      if (!present.has(table)) {
        throw new LegacyMigrationRefusal(
          `legacy store is missing declared table ${table}; refusing a lossy dump that would recreate it empty. Move it aside and rebuild from the tracked sidecar: mv ${p} ${p}.unmigratable && fm-session recover`
        );
      }
      const spec = specFor(kind);
      const have = new Set(
        db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((r) => r.name)
      );
      const columns = spec.fields.map((f) => f.name);
      const selected = columns.map((c) => have.has(c) ? quoteIdentifier(c) : `NULL AS ${quoteIdentifier(c)}`).join(", ");
      const ordering = spec.ordering.map((c) => quoteIdentifier(c)).join(", ");
      const query = `SELECT ${selected} FROM ${quoteIdentifier(table)} ORDER BY ${ordering}`;
      for (const record of db.prepare(query).all()) {
        const row = {};
        for (const c of columns) row[c] = asJsonValue(record[c] ?? null);
        documents.push(jsonDumps({ row, table }, true));
      }
    }
    return documents.join("\n") + "\n";
  } finally {
    db.close();
  }
}
function sidecarPathFor(p) {
  return p.replace(/\.db$/, ".ndjson");
}
function pathsAlias(left, right) {
  try {
    return resolve(left) === resolve(right);
  } catch {
    return false;
  }
}
function storeIsEmpty(p) {
  const db = new DatabaseSync2(p);
  try {
    const row = db.prepare(
      "SELECT (SELECT COUNT(*) FROM facts) + (SELECT COUNT(*) FROM measurements) + (SELECT COUNT(*) FROM obligations) + (SELECT COUNT(*) FROM sessions) AS n"
    ).get();
    return row !== void 0 && row.n === 0;
  } finally {
    db.close();
  }
}
function rehydrateFromSidecarIfEmpty(p) {
  const sidecar = sidecarPathFor(p);
  if (pathsAlias(sidecar, p) || !fs.existsSync(sidecar)) return;
  try {
    if (!storeIsEmpty(p)) return;
  } catch {
    return;
  }
  try {
    const res = rebuildFromSidecar({ sidecarPath: sidecar, dbPath: p, force: true });
    process.stderr.write(
      `rehydrated ${res.rowsWritten} row(s) from ${sidecar} (the .db is a derived cache; the sidecar is what git tracks)
`
    );
  } catch (e) {
    process.stderr.write(
      `refusing: the session store is empty and the tracked sidecar at ${sidecar} could not be read: ${errorMessage(e)}
`
    );
    throw new LegacyMigrationRefusal(errorMessage(e));
  }
}
function bootstrapStore(p, opts) {
  const shape = classifyStore(p);
  if (shape === "corrupt") {
    process.stderr.write(
      `refusing: the session store at ${p} carries both the legacy and port schemas, or identity counters behind its own rows. It is the half-migrated state a pre-fix open produced. ${sidecarRebuildRemedy(p, "corrupt")}
`
    );
    process.exit(2);
  }
  if (shape === "unrecognised") {
    process.stderr.write(
      `refusing: the session store at ${p} exists but is not a Foreman session database. This tool will not write into a file it does not recognise. ${sidecarRebuildRemedy(p, "unrecognised")}
`
    );
    throw new LegacyMigrationRefusal(`unrecognised session store at ${p}`);
  }
  if (shape === "legacy") {
    if (!opts.allowMigration) {
      process.stderr.write(
        `refusing: the session store at ${p} is in the pre-port schema and this is a read-only command. Run a write command, or \`fm-session import-sidecar\`, to migrate it.
`
      );
      process.exit(2);
    }
    const carrier = `${p}.legacy.ndjson`;
    try {
      fs.writeFileSync(carrier, legacyDumpV1(p), { encoding: "utf8" });
      const res = rebuildFromSidecar({ sidecarPath: carrier, dbPath: p, force: true });
      process.stderr.write(`migrated ${res.rowsWritten} row(s) out of the legacy session schema into ${p}
`);
    } catch (e) {
      process.stderr.write(
        `refusing: the legacy session store at ${p} could not be migrated to the port schema: ${errorMessage(e)}
`
      );
      throw new LegacyMigrationRefusal(errorMessage(e));
    } finally {
      fs.rmSync(carrier, { force: true });
    }
    rehydrateFromSidecarIfEmpty(p);
    return true;
  }
  if (shape === "absent") {
    if (fs.existsSync(p)) {
      process.stderr.write(
        `refusing: the session store at ${p} exists but is not a Foreman session database. This tool will not write into a file it does not recognise. ${sidecarRebuildRemedy(p, "unrecognised")}
`
      );
      throw new LegacyMigrationRefusal(`unrecognised session store at ${p}`);
    }
    SqliteSessionStore.open(p).close();
    try {
      rehydrateFromSidecarIfEmpty(p);
    } catch (e) {
      try {
        for (const suffix of ["", "-wal", "-shm"]) {
          fs.rmSync(p + suffix, { force: true });
        }
      } catch {
      }
      throw e;
    }
    return false;
  }
  if (!opts.readOnly) {
    rehydrateFromSidecarIfEmpty(p);
  }
  return false;
}

// packages/orchestration/src/fm-session-main.ts
var READ_ONLY_CMDS = /* @__PURE__ */ new Set(["recover", "freshness", "sidecar"]);
var STORE_CMDS = /* @__PURE__ */ new Set([
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
  "retire"
]);
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function repoRoot() {
  try {
    const out = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8"
    }).trim();
    return dirname2(resolve2(out));
  } catch {
    return process.cwd();
  }
}
function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
function warnOrphanStore(chosen) {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    if (!top) return;
    const orphan = resolve2(top, ".foreman", "session.db");
    if (orphan === resolve2(chosen) || !existsSync2(orphan)) return;
    process.stderr.write(
      `WARNING: an orphaned session store sits at ${orphan}. Nothing reads it. The store in use is ${chosen}.
`
    );
  } catch {
  }
}
function dbPath() {
  if (process.env["FOREMAN_SESSION_DB"]) return process.env["FOREMAN_SESSION_DB"];
  const d = join(repoRoot(), ".foreman");
  mkdirSync2(d, { recursive: true });
  const chosen = join(d, "session.db");
  warnOrphanStore(chosen);
  return chosen;
}
function errorMessage2(e) {
  return e instanceof Error ? e.message : String(e);
}
function openStore(path, opts = {}) {
  const p = path ?? dbPath();
  mkdirSync2(dirname2(p), { recursive: true });
  const readOnly = opts.readOnly === true;
  bootstrapStore(p, { allowMigration: !readOnly, readOnly });
  return SqliteSessionStore.open(p, { readOnly });
}
function currentSessionId(store) {
  return store.currentSession()?.session_id ?? null;
}
var CliRefusal = class extends Error {
  exitCode;
  constructor(exitCode) {
    super(`cli refusal ${exitCode}`);
    this.name = "CliRefusal";
    this.exitCode = exitCode;
  }
};
function exitCli(code) {
  throw new CliRefusal(code);
}
function isSqliteOperationalError(e) {
  return typeof e === "object" && e !== null && e.code === "ERR_SQLITE_ERROR";
}
function parentDirNotWritable(dbFile) {
  try {
    accessSync(dirname2(dbFile), constants.W_OK);
    return false;
  } catch (e) {
    const code = typeof e === "object" && e !== null ? e.code : void 0;
    return code === "EACCES" || code === "EPERM";
  }
}
function pathNotReadable(file) {
  try {
    accessSync(file, constants.R_OK);
    return false;
  } catch (e) {
    const code = typeof e === "object" && e !== null ? e.code : void 0;
    return code === "EACCES" || code === "EPERM";
  }
}
function requirePositional(args, index, label) {
  const value = args[index];
  if (value === void 0) {
    process.stderr.write(`refusing: missing ${label}
`);
    exitCli(2);
  }
  return value;
}
function refuseFromPort(e, legacyMessage, expectedReasons) {
  const reason = reasonOf(e);
  if (isSessionStoreFailure(e) || reason !== null) {
    if (expectedReasons === void 0 || reason !== null && expectedReasons.includes(reason)) {
      process.stderr.write(legacyMessage);
    } else {
      process.stderr.write(`refusing: ${errorMessage2(e)}
`);
    }
    exitCli(2);
  }
  throw e;
}
function scalarOf(text) {
  const match = text.match(/^\s*(-?\d+(?:\.\d+)?)/);
  const captured = match?.[1];
  return captured === void 0 ? null : parseFloat(captured);
}
function mintSessionId() {
  const d = /* @__PURE__ */ new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const hex = randomBytes(3).toString("hex");
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z-${hex}`;
}
function measurementValidity(measuredSha, scopePaths) {
  if (!measuredSha) return ["unknown", "no measured_sha recorded"];
  const paths = (scopePaths || "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (paths.length === 0) return ["unknown", "no scope_paths recorded; cannot bound what invalidates it"];
  try {
    const out = execFileSync("git", ["rev-list", `${measuredSha}..HEAD`, "--", ...paths], {
      encoding: "utf8"
    });
    const commits = out.split("\n").map((s) => s.trim()).filter(Boolean);
    if (commits.length > 0) {
      return ["stale", `${commits.length} commit(s) touched its scope since measurement`];
    }
    return ["fresh", "no commit has touched its scope since measurement"];
  } catch (e) {
    const err = e;
    const stderrRaw = err.stderr;
    const stderr = typeof stderrRaw === "string" ? stderrRaw : stderrRaw instanceof Uint8Array ? Buffer.from(stderrRaw).toString("utf8") : "";
    const message = typeof err.message === "string" ? err.message : String(e);
    const name = typeof err.name === "string" ? err.name : "Error";
    const errStr = (stderr || message).trim().substring(0, 80);
    if (stderr) {
      return ["unknown", `git rev-list failed: ${errStr}`];
    }
    return ["unknown", `${name}: ${message}`];
  }
}
function displayStatus(o) {
  return o.status === "open" && o.blocker ? "blocked" : o.status;
}
function buildRecoveryFromStore(store) {
  const head = gitSha();
  const sessions = [...store.listSessions()].sort(
    (a, b) => a.session_id < b.session_id ? 1 : a.session_id > b.session_id ? -1 : 0
  );
  const sess = sessions[0] ?? null;
  const facts = [...store.listFacts()].filter((r) => r.superseded_by === null).sort((a, b) => b.id - a.id).map((r) => ({
    kind: "fact",
    id: r.id,
    statement: r.statement,
    evidence: r.evidence,
    established_ts: r.established_ts
  }));
  const measurements = [...store.listMeasurements()].filter((r) => r.superseded_by === null).sort((a, b) => b.id - a.id).map((r) => {
    const [validity, why] = measurementValidity(r.measured_sha, r.scope_paths);
    return {
      kind: "measurement",
      id: r.id,
      metric: r.metric,
      value: r.value,
      command: r.command,
      measured_ts: r.measured_ts,
      measured_sha: (r.measured_sha || "").substring(0, 12),
      scope_paths: (r.scope_paths || "").split("\n").filter(Boolean),
      validity,
      validity_reason: why
    };
  });
  const obligations = [...store.listObligations()].filter((r) => r.status !== "done").map((r) => ({
    kind: "obligation",
    id: r.id,
    statement: r.statement,
    status: displayStatus(r),
    blocker: r.blocker,
    opened_ts: r.opened_ts
  }));
  const obligationRank = (o) => {
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
      obligations_blocked: obligations.filter((o) => o.status === "blocked").length
    }
  };
}
function buildFreshnessFromStore(store, staleOnly) {
  const out = [];
  const rows = [...store.listMeasurements()].filter((r) => r.superseded_by === null).sort((a, b) => b.id - a.id);
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
      timestamp: row.measured_ts
    });
  }
  return out;
}
function renderFreshness(measurements, outputFormat) {
  const columns = ["id", "metric", "value", "verdict", "reason", "command", "scope", "sha", "timestamp"];
  if (outputFormat === "tsv") {
    const lines = [columns.join("	")];
    for (const m of measurements) {
      lines.push(columns.map((c) => String(m[c])).join("	"));
    }
    return lines.join("\n");
  }
  return measurements.map(
    (m) => `[${m.id}] ${m.metric} = ${m.value}  verdict=${m.verdict}  reason=${m.reason}  command=${m.command}  scope=${m.scope}  sha=${m.sha}  timestamp=${m.timestamp}`
  ).join("\n");
}
function render(rec) {
  const lines = [];
  const A = (s) => lines.push(s);
  A(`FOREMAN RECOVERY  head=${rec.head_sha}  at=${rec.recovered_at}`);
  const ls = rec.last_session;
  if (ls) {
    A(
      `last session: ${ls.session_id}  started=${ls.started_ts}  start_sha=${(ls.start_sha || "").substring(0, 12)}  ${ls.ended_ts ? "ENDED " + ls.ended_ts : "NOT ENDED"}`
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
  const markFor = { fresh: "OK   ", stale: "STALE", unknown: "?    " };
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
      `LAUNCH POINT: ${stale} measurement(s) are not fresh \u2014 re-run them before quoting any of their numbers. Then work the open obligations above.`
    );
  } else if (live === 0) {
    A(
      "LAUNCH POINT: no measurement is recorded, so nothing here is measured. Measure before you quote a number. Then work the open obligations above."
    );
  } else {
    A("LAUNCH POINT: every measurement is fresh. Work the open obligations above.");
  }
  return lines.join("\n");
}
function sidecarNdjson(dbFile, opts = {}) {
  const store = SqliteSessionStore.open(
    dbFile,
    opts.readOnly === true ? { readOnly: true } : {}
  );
  try {
    const snapshot = store.snapshot();
    return [encodeSnapshot(snapshot), countRows(snapshot)];
  } finally {
    store.close();
  }
}
function writeAtomic(path, text) {
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(8).toString("hex")}`;
  try {
    writeFileSync(tmp, text, { encoding: "utf8", flag: "wx" });
    const fd = openSync(tmp, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync2(tmp, path);
  } catch (e) {
    try {
      rmSync2(tmp, { force: true });
    } catch {
    }
    throw e;
  }
  try {
    const dirFd = openSync(dirname2(path), "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `WARNING: sidecar published, durability flush failed (${msg}). The tracked record is complete.
`
    );
  }
}
var SidecarReplaceRefused = class extends Error {
  kind;
  constructor(message, kind) {
    super(message);
    this.name = "SidecarReplaceRefused";
    this.kind = kind;
  }
};
function identityToken(kind, row, fields) {
  return `${kind}	${fields.map((f) => String(row[f] ?? "")).join("	")}`;
}
function identityTokens(snapshot) {
  const tokens = [];
  for (const kind of ENTITY_ORDER) {
    const fields = specFor(kind).identity;
    for (const row of rowsOfKind(snapshot, kind)) {
      tokens.push(identityToken(kind, row, fields));
    }
  }
  tokens.sort();
  return tokens;
}
function identityDigest(tokens) {
  return createHash("sha256").update(tokens.join("\n"), "utf8").digest("hex");
}
function assessSidecarReplace(oldSnap, newSnap) {
  const oldTokens = identityTokens(oldSnap);
  const newTokens = identityTokens(newSnap);
  const newSet = new Set(newTokens);
  const lostIdentities = oldTokens.filter((t) => !newSet.has(t));
  const kindShrinks = [];
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
    lostIdentities
  };
}
function sidecarDumpElsewhereRemedy() {
  return "Dump the store to a new file with `fm-session sidecar --out <fresh-path>`.";
}
function sidecarReplaceMessage(path, verdict) {
  const kinds = verdict.kindShrinks.length > 0 ? ` kinds ${verdict.kindShrinks.join(",")}` : "";
  const lost = verdict.lostIdentities.length > 0 ? ` missing ${verdict.lostIdentities.length} identit${verdict.lostIdentities.length === 1 ? "y" : "ies"}` : "";
  return `refusing: existing sidecar ${path} has ${verdict.oldCount} row(s); refusing to replace it with ${verdict.newCount} row(s)${kinds}${lost} (identity-scoped ${verdict.oldDigest.slice(0, 12)} -> ${verdict.newDigest.slice(0, 12)}). Run \`fm-session sidecar --force\` to dump the store over this file, or \`fm-session import-sidecar ${path} --force\` to restore this file into the store.
`;
}
function unreadSidecarMessage(path, detail) {
  return `refusing: existing sidecar ${path} could not be read: ${detail}. Refusing to replace a sidecar whose contents could not be established. ${sidecarDumpElsewhereRemedy()}
`;
}
function unparsedSidecarMessage(path, detail) {
  return `refusing: existing sidecar ${path} could not be parsed: ${detail}. Refusing to replace a sidecar whose contents could not be established. ${sidecarDumpElsewhereRemedy()}
`;
}
function inspectSidecarPath(path) {
  let st;
  try {
    st = lstatSync(path);
  } catch (e) {
    const code = typeof e === "object" && e !== null ? e.code : void 0;
    if (code === "ENOENT") return { dest: path, kind: "missing" };
    throw e;
  }
  if (st.isSymbolicLink()) {
    let resolved;
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
function writeSidecar(path, text, opts = {}) {
  const inspected = inspectSidecarPath(path);
  if (inspected.kind === "unreadable") {
    throw new SidecarReplaceRefused(unreadSidecarMessage(path, "not a regular file"), "unread");
  }
  const dest = inspected.dest;
  if (inspected.kind === "regular") {
    let raw;
    try {
      raw = readFileSync2(dest, "utf8");
    } catch (e) {
      throw new SidecarReplaceRefused(unreadSidecarMessage(path, errorMessage2(e)), "unread");
    }
    let oldSnap;
    try {
      oldSnap = decodeSnapshot(raw);
    } catch (e) {
      throw new SidecarReplaceRefused(unparsedSidecarMessage(path, errorMessage2(e)), "unparsed");
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
function persistSidecarAfterMigration(storePath) {
  const out = sidecarPathFor(storePath);
  if (pathsAlias(out, storePath)) return;
  const [lines, rowCount] = sidecarNdjson(storePath);
  try {
    writeSidecar(out, lines);
    process.stderr.write(`sidecar refreshed: ${rowCount} row(s) -> ${out}
`);
  } catch (e) {
    if (e instanceof SidecarReplaceRefused) {
      process.stderr.write(e.message);
      return;
    }
    throw e;
  }
}
function importSidecar(dbFile, path, force = false) {
  const snapshot = decodeSnapshot(readFileSync2(path, "utf8"));
  const store = SqliteSessionStore.open(dbFile);
  try {
    return store.importSnapshot(snapshot, { force });
  } finally {
    store.close();
  }
}
function emptyOptions() {
  return {
    json: false,
    "stale-only": false,
    force: false,
    note: void 0,
    format: "text",
    evidence: void 0,
    command: void 0,
    scope: [],
    num: void 0,
    blocker: void 0,
    status: "done",
    out: void 0,
    into: void 0,
    by: void 0,
    reason: void 0
  };
}
var BOOLEAN_ARGS = /* @__PURE__ */ new Set(["--json", "--stale-only", "--force"]);
var STRING_ARGS = /* @__PURE__ */ new Set([
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
  "--reason"
]);
function isStringOption(key) {
  return STRING_ARGS.has(`--${key}`);
}
function parseCli(argv) {
  const parsed = { args: [], options: emptyOptions() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === void 0) continue;
    if (arg.startsWith("--")) {
      if (BOOLEAN_ARGS.has(arg)) {
        const key = arg.slice(2);
        if (key === "json" || key === "stale-only" || key === "force") {
          parsed.options[key] = true;
        }
      } else if (STRING_ARGS.has(arg)) {
        if (i + 1 >= argv.length) {
          process.stderr.write(`error: option ${arg} requires an argument
`);
          exitCli(2);
        }
        const value = argv[++i];
        if (value === void 0) {
          process.stderr.write(`error: option ${arg} requires an argument
`);
          exitCli(2);
        }
        if (arg === "--scope") {
          parsed.options.scope.push(value);
        } else {
          const key = arg.slice(2);
          if (isStringOption(key)) parsed.options[key] = value;
        }
      } else {
        process.stderr.write(`error: unrecognized option: ${arg}
`);
        exitCli(2);
      }
    } else {
      parsed.args.push(arg);
    }
  }
  return parsed;
}
function prepareInvocation(cmd, importTarget) {
  try {
    if (cmd === "import-sidecar") {
      const target = importTarget ?? dbPath();
      mkdirSync2(dirname2(target), { recursive: true });
      const migrated2 = bootstrapStore(target, { allowMigration: true, readOnly: false });
      if (migrated2) persistSidecarAfterMigration(target);
      return;
    }
    const p = dbPath();
    mkdirSync2(dirname2(p), { recursive: true });
    const readOnly = READ_ONLY_CMDS.has(cmd);
    const migrated = bootstrapStore(p, { allowMigration: !readOnly, readOnly });
    if (migrated) persistSidecarAfterMigration(p);
  } catch (e) {
    if (cmd === "import-sidecar") {
      const message = errorMessage2(e);
      const msg = message.includes("unable to open database file") ? "sqlite3.OperationalError" : message;
      process.stderr.write(`refusing: cannot open target store: ${msg}
`);
      exitCli(2);
    }
    if (e instanceof LegacyMigrationRefusal) {
      exitCli(2);
    }
    const failedPath = cmd === "import-sidecar" ? importTarget ?? dbPath() : dbPath();
    if (isSqliteOperationalError(e) && (parentDirNotWritable(failedPath) || pathNotReadable(failedPath))) {
      process.stderr.write(`EACCES: permission denied, open '${failedPath}'
`);
      exitCli(1);
    }
    if (isSqliteOperationalError(e)) {
      process.stderr.write(`sqlite3.OperationalError
`);
      exitCli(1);
    }
    process.stderr.write(`${errorMessage2(e)}
`);
    exitCli(1);
  }
}
function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd === void 0) {
    process.stderr.write("refusing: missing command\n");
    exitCli(2);
  }
  if (!STORE_CMDS.has(cmd)) {
    process.stderr.write(`refusing: unknown command ${cmd}
`);
    exitCli(2);
  }
  const parsed = parseCli(args.slice(1));
  let importTarget = "";
  if (cmd === "import-sidecar") {
    importTarget = parsed.options.into ?? dbPath();
  }
  prepareInvocation(cmd, cmd === "import-sidecar" ? importTarget : void 0);
  if (cmd === "begin") {
    const store = openStore();
    try {
      const rec = buildRecoveryFromStore(store);
      const sid = mintSessionId();
      try {
        store.beginSession({
          session_id: sid,
          started_ts: nowIso(),
          start_sha: gitSha(),
          note: parsed.options.note || null
        });
      } catch (e) {
        refuseFromPort(e, "refusing: cannot begin session\n");
      }
      process.stdout.write(render(rec) + "\n\n");
      process.stdout.write(`SESSION BEGUN: ${sid}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "recover") {
    const store = openStore(void 0, { readOnly: true });
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
    const store = openStore(void 0, { readOnly: true });
    try {
      const measurements = buildFreshnessFromStore(store, staleOnly);
      process.stdout.write(renderFreshness(measurements, parsed.options.format) + "\n");
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "end") {
    const store = openStore();
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
          process.stderr.write(`refusing: session ${sid} is already ended; ended_ts is set-once
`);
          exitCli(2);
        }
        refuseFromPort(e, "no open session\n", ["invalid_argument"]);
      }
      process.stdout.write(`session ended: ${sid}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "fact") {
    const statement = requirePositional(parsed.args, 0, "STATEMENT");
    const evidence = parsed.options.evidence || null;
    const store = openStore();
    try {
      let row;
      try {
        row = store.addFact({
          statement,
          evidence,
          established_ts: nowIso(),
          session_id: currentSessionId(store)
        });
      } catch (e) {
        refuseFromPort(e, "refusing: cannot add fact\n");
      }
      process.stdout.write(`fact ${row.id}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "measure") {
    if (parsed.options.scope.length === 0) {
      process.stderr.write(
        "refusing: --scope is required. A measurement with no path scope can never be shown stale, which is the entire point.\n"
      );
      exitCli(2);
    }
    const metric = parsed.args[0];
    const value = parsed.args[1];
    if (metric === void 0 || value === void 0) {
      process.stderr.write("refusing: measure requires METRIC and VALUE\n");
      exitCli(2);
    }
    const command = parsed.options.command || null;
    let vnum = null;
    if (parsed.options.num !== void 0) vnum = parseFloat(parsed.options.num);
    else vnum = scalarOf(value);
    const store = openStore();
    try {
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
          session_id: currentSessionId(store)
        });
      } catch (e) {
        refuseFromPort(e, "refusing: --num must be a finite number\n");
      }
      process.stdout.write(`measurement ${row.id}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "obligation") {
    const statement = requirePositional(parsed.args, 0, "STATEMENT");
    const blocker = parsed.options.blocker || null;
    const store = openStore();
    try {
      let row;
      try {
        row = store.addObligation({
          statement,
          blocker,
          opened_ts: nowIso(),
          session_id: currentSessionId(store)
        });
      } catch (e) {
        refuseFromPort(e, "refusing: cannot add obligation\n");
      }
      process.stdout.write(`obligation ${row.id}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "close") {
    const obligationId = parseInt(requirePositional(parsed.args, 0, "OBLIGATION_ID"), 10);
    const status = parsed.options.status;
    if (parsed.options.blocker !== void 0) {
      process.stderr.write("refusing: --blocker is not valid with close\n");
      exitCli(2);
    }
    const store = openStore();
    try {
      if (status !== "done" && status !== "dropped") {
        process.stderr.write(`refusing: --status must be done or dropped, got ${JSON.stringify(status)}
`);
        exitCli(2);
      }
      try {
        store.closeObligation(obligationId, status, nowIso());
      } catch (e) {
        refuseFromPort(
          e,
          `refusing: obligation ${obligationId} is not open; only an open obligation may be closed
`
        );
      }
      process.stdout.write(`obligation ${obligationId} -> ${status}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "sidecar") {
    const store = dbPath();
    const outPath = parsed.options.out || join(dirname2(store), "session.ndjson");
    if (pathsAlias(outPath, store)) {
      process.stderr.write(`refusing: sidecar output ${outPath} aliases the session store ${store}
`);
      exitCli(2);
    }
    try {
      const [lines, rowCount] = sidecarNdjson(store, { readOnly: true });
      writeSidecar(outPath, lines, { allowShrink: parsed.options.force });
      process.stdout.write(`dumped ${rowCount} row(s) -> ${outPath}
`);
      return 0;
    } catch (e) {
      if (e instanceof SidecarReplaceRefused) {
        process.stderr.write(e.message);
        exitCli(2);
      }
      process.stderr.write(`refusing: cannot write sidecar ${outPath}: ${errorMessage2(e)}
`);
      exitCli(2);
    }
  }
  if (cmd === "import-sidecar") {
    const path = requirePositional(parsed.args, 0, "PATH");
    try {
      const count = importSidecar(importTarget, path, parsed.options.force);
      process.stdout.write(`imported ${count} document(s) -> ${importTarget}
`);
      return 0;
    } catch (e) {
      process.stderr.write(`refusing: ${errorMessage2(e)}
`);
      exitCli(2);
    }
  }
  if (cmd === "supersede") {
    const factId = parseInt(requirePositional(parsed.args, 0, "FACT_ID"), 10);
    const statement = requirePositional(parsed.args, 1, "STATEMENT");
    const evidence = parsed.options.evidence || null;
    const reason = parsed.options.reason;
    if (!reason) {
      process.stderr.write("error: option --reason requires an argument\n");
      exitCli(2);
    }
    const store = openStore();
    try {
      let res;
      try {
        res = store.supersedeFact(
          factId,
          { statement, evidence, established_ts: nowIso(), session_id: currentSessionId(store) },
          reason,
          nowIso()
        );
      } catch (e) {
        if (reasonOf(e) === "supersession_incomplete") {
          process.stderr.write(
            `refusing: fact ${factId} is already superseded; supersession columns are set-once
`
          );
          exitCli(2);
        }
        refuseFromPort(
          e,
          `refusing: cannot supersede fact ${factId}: it does not exist or is already superseded
`,
          ["invalid_argument"]
        );
      }
      process.stdout.write(`fact ${factId} superseded by ${res.replacement.id}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  if (cmd === "retire") {
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
    const store = openStore();
    try {
      const rows = store.listMeasurements();
      if (!rows.some((r) => r.id === measurementId)) {
        process.stderr.write(`refusing: no measurement ${measurementId} to retire
`);
        exitCli(2);
      }
      const by = rows.find((r) => r.id === byId);
      if (!by) {
        process.stderr.write(`refusing: no measurement ${byId} to supersede it
`);
        exitCli(2);
      }
      if (by.superseded_by !== null) {
        process.stderr.write(
          `refusing: measurement ${byId} is itself superseded by ${by.superseded_by}. A retired measurement cannot supersede another one.
`
        );
        exitCli(2);
      }
      try {
        store.retireMeasurement(measurementId, byId, reason, nowIso());
      } catch (e) {
        refuseFromPort(e, `refusing: measurement ${measurementId} is already superseded
`, [
          "supersession_incomplete"
        ]);
      }
      process.stdout.write(`measurement ${measurementId} retired, superseded by ${byId}
`);
    } finally {
      store.close();
    }
    return 0;
  }
  exitCli(2);
}
function mainWithSidecar() {
  let rc = 0;
  try {
    rc = main() || 0;
  } catch (e) {
    if (e instanceof CliRefusal) {
      process.exit(e.exitCode);
    }
    const code = e instanceof Error && "code" in e ? String(e.code) : "";
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" || code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
      process.stderr.write(`error: ${errorMessage2(e)}
`);
      rc = 2;
    } else {
      throw e;
    }
  }
  const invoked = process.argv[2];
  if (rc !== 0 || process.argv.length < 3 || invoked !== void 0 && READ_ONLY_CMDS.has(invoked)) {
    process.exit(rc);
  }
  const store = dbPath();
  const out = sidecarPathFor(store);
  try {
    if (pathsAlias(out, store)) {
      process.exit(rc);
    }
    const [lines, rowCount] = sidecarNdjson(store);
    const allowShrink = process.argv.includes("--force") && (invoked === "import-sidecar" || invoked === "sidecar");
    writeSidecar(out, lines, { allowShrink });
    process.stderr.write(`sidecar refreshed: ${rowCount} row(s) -> ${out}
`);
  } catch (e) {
    if (e instanceof SidecarReplaceRefused) {
      const remedy = e.kind === "shrink" ? `Run \`fm-session sidecar --force\` to dump the store over the tracked record, or \`fm-session import-sidecar ${out} --force\` to restore the tracked record into the store.` : `The existing sidecar could not be decoded, so --force cannot overwrite it. Dump the store to a new file with \`fm-session sidecar --out <fresh-path>\`.`;
      process.stderr.write(
        `WARNING: the store was written but its sidecar could not be refreshed (${e}). The tracked record is now BEHIND the database. ${remedy}
`
      );
    } else {
      process.stderr.write(
        `WARNING: the store was written but its sidecar could not be refreshed (${e}). The store write already committed. Re-running this write will duplicate the row. Clear the sidecar fault, then run \`fm-session sidecar --force\` to dump the store over the tracked record.
`
      );
      rc = 1;
    }
  }
  process.exit(rc);
}
var invokedDirectly = process.argv[1] !== void 0 && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  mainWithSidecar();
}
export {
  CliRefusal,
  SidecarReplaceRefused,
  assessSidecarReplace,
  importSidecar,
  main,
  sidecarNdjson,
  writeAtomic
};
