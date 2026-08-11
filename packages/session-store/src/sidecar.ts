/**
 * Canonical sidecar codec: the wire form of a SessionSnapshot.
 *
 * CANONICAL ENCODING (all of it is contract; changing any of it bumps
 * SESSION_MODEL_VERSION):
 *
 *   - NDJSON. LF line endings. Exactly one terminating newline.
 *   - Line 1 is the header. Exactly one header per file.
 *   - Rows follow in ENTITY_ORDER, and within a kind in that kind's declared
 *     `ordering`.
 *   - Object keys are emitted in DECLARED FIELD ORDER, not sorted. Declared
 *     order is already canonical and stable.
 *   - Every declared field is emitted, including nulls. No key is omitted.
 *   - Numbers use JavaScript shortest-round-trip formatting. Negative zero is
 *     encoded as `0`. Non-finite values are rejected at encode time, because
 *     JSON cannot represent them and SQLite REAL can hold them.
 *   - Strings are passed through as stored. No Unicode normalisation is applied
 *     on either side; normalising would silently rewrite session content.
 *
 * VERSION POLICY:
 *   - The format version and the model version are independent numbers.
 *   - Equal model version  -> validate, then apply.
 *   - Older model version  -> run registered pure upgrade functions, validate
 *                             the upgraded snapshot, then apply.
 *   - Newer model version  -> REFUSE before any mutation. Never best-effort,
 *                             never partial, never discard unknown fields.
 */

import {
  COUNTED_KINDS,
  ENTITY_KINDS,
  ENTITY_ORDER,
  SESSION_MODEL_VERSION,
  initialNextIds,
  rowsOfKind,
  specFor,
  type CountedKind,
  type EntityKind,
  type NextIds,
  type SessionSnapshot,
} from "./entities.js";
import { decodeSnapshotV1, SIDECAR_FORMAT, V1_FORMAT_VERSION } from "./sidecar-v1.js";
import { assertIntegrity } from "./integrity.js";
import { raise } from "./failures.js";

// SIDECAR_FORMAT is declared in sidecar-v1.ts (the v1 header check needs it
// too) and re-exported here so the rest of the codebase can keep importing it
// from ./sidecar.js without a circular import between this file and
// sidecar-v1.ts.
export { SIDECAR_FORMAT };
export const SIDECAR_FORMAT_VERSION = 2;

type Header = {
  readonly format: string;
  readonly format_version: number;
  readonly session_model_version: number;
  readonly next_ids: NextIds;
};

/** A pure snapshot upgrade from version N to N+1. */
export type Upgrade = (snapshot: SessionSnapshot) => SessionSnapshot;

/** Registered upgrades, keyed by the version they upgrade FROM. */
export const UPGRADES: ReadonlyMap<number, Upgrade> = new Map();

// ---------------------------------------------------------------------------
// encode
// ---------------------------------------------------------------------------

function encodeNumber(v: number): string {
  if (!Number.isFinite(v)) {
    raise(
      "field_type",
      `non-finite number ${String(v)} cannot be encoded; reject at write time`,
    );
  }
  return JSON.stringify(Object.is(v, -0) ? 0 : v);
}

function encodeValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "number") return encodeNumber(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  raise("field_type", `value of type ${typeof v} is not encodable`);
}

/** Emit an object with keys in the supplied order. */
function encodeObject(
  row: Record<string, unknown>,
  keys: readonly string[],
): string {
  const parts = keys.map((k) => `${JSON.stringify(k)}:${encodeValue(row[k])}`);
  return `{${parts.join(",")}}`;
}

export function encodeSnapshot(snapshot: SessionSnapshot): string {
  const lines: string[] = [];
  const nextIdParts = COUNTED_KINDS.map(
    (k) => `${JSON.stringify(k)}:${encodeNumber(snapshot.nextIds[k])}`,
  );
  lines.push(
    `{"format":${JSON.stringify(SIDECAR_FORMAT)},` +
      `"format_version":${SIDECAR_FORMAT_VERSION},` +
      `"session_model_version":${snapshot.modelVersion},` +
      `"next_ids":{${nextIdParts.join(",")}}}`,
  );

  for (const kind of ENTITY_ORDER) {
    const keys = specFor(kind).fields.map((f) => f.name);
    for (const row of rowsOfKind(snapshot, kind)) {
      lines.push(
        `{"kind":${JSON.stringify(kind)},"row":${encodeObject(row as Record<string, unknown>, keys)}}`,
      );
    }
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// decode
// ---------------------------------------------------------------------------

/**
 * JSON.parse silently keeps the last of a duplicated key. A sidecar with
 * duplicate keys is malformed and must be rejected, so scan for them.
 */
function assertNoDuplicateKeys(line: string, lineNo: number): void {
  const seen = new Set<string>();
  // Walk the raw text; only count keys at object-key position.
  const re = /"((?:[^"\\]|\\.)*)"\s*:/g;
  let m: RegExpExecArray | null;
  const depthAt: number[] = [];
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
        `duplicate key ${JSON.stringify(key)} on line ${lineNo}`,
      );
    }
    seen.add(tag);
  }
}

function parseLine(line: string, lineNo: number): Record<string, unknown> {
  assertNoDuplicateKeys(line, lineNo);
  let doc: unknown;
  try {
    doc = JSON.parse(line);
  } catch (e) {
    raise(
      "sidecar_malformed",
      `invalid JSON on line ${lineNo}: ${(e as Error).message}`,
    );
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    raise("sidecar_malformed", `line ${lineNo} is not a JSON object`);
  }
  return doc as Record<string, unknown>;
}

function readHeader(doc: Record<string, unknown>): Header {
  if (doc["format"] !== SIDECAR_FORMAT) {
    raise(
      "sidecar_format",
      `unsupported sidecar format ${JSON.stringify(String(doc["format"]))}`,
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
  const nextRec = rawNext as Record<string, unknown>;
  const next: Record<string, number> = {};
  for (const k of COUNTED_KINDS) {
    const v = nextRec[k];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) {
      raise("sidecar_format", `invalid next_ids.${k}`);
    }
    next[k] = v;
  }
  const known = new Set(["format", "format_version", "session_model_version", "next_ids"]);
  for (const k of Object.keys(doc)) {
    if (!known.has(k)) {
      raise("sidecar_format", `unknown header field ${JSON.stringify(k)}`);
    }
  }
  return {
    format: SIDECAR_FORMAT,
    format_version: SIDECAR_FORMAT_VERSION,
    session_model_version: mv,
    next_ids: next as unknown as NextIds,
  };
}

/**
 * Parse a sidecar into a snapshot, applying the version policy.
 * Performs no I/O and mutates nothing.
 */
export function decodeSnapshot(text: string): SessionSnapshot {
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

  const head = parseLine(lines[0] as string, 1);
  if (head["format_version"] === V1_FORMAT_VERSION) {
    const v1 = decodeSnapshotV1(lines);
    assertIntegrity(v1);
    return v1;
  }
  const header = readHeader(head);

  const buckets: Record<EntityKind, Record<string, unknown>[]> = {
    session: [],
    fact: [],
    measurement: [],
    obligation: [],
  };
  const kindSet = new Set<string>(ENTITY_KINDS);

  for (let i = 1; i < lines.length; i++) {
    const doc = parseLine(lines[i] as string, i + 1);
    if ("format" in doc) {
      raise("sidecar_format", `second header record on line ${i + 1}`);
    }
    const keys = Object.keys(doc).sort().join(",");
    if (keys !== "kind,row") {
      raise(
        "sidecar_malformed",
        `line ${i + 1} must contain exactly kind and row`,
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
    buckets[kind as EntityKind].push(row as Record<string, unknown>);
  }

  let snapshot: SessionSnapshot = {
    modelVersion: header.session_model_version,
    nextIds: header.next_ids,
    sessions: buckets.session as never,
    facts: buckets.fact as never,
    measurements: buckets.measurement as never,
    obligations: buckets.obligation as never,
  };

  snapshot = applyVersionPolicy(snapshot);
  assertIntegrity(snapshot);
  return snapshot;
}

/**
 * Equal -> pass through. Older -> upgrade. Newer -> refuse.
 * Refusal happens here, before any caller has touched the store.
 */
export function applyVersionPolicy(snapshot: SessionSnapshot): SessionSnapshot {
  if (snapshot.modelVersion > SESSION_MODEL_VERSION) {
    raise(
      "model_version_unsupported",
      `sidecar declares session model version ${snapshot.modelVersion}, ` +
        `but this build understands ${SESSION_MODEL_VERSION}. Refusing before any write. ` +
        `Upgrade Foreman to import it.`,
    );
  }
  let cur = snapshot;
  while (cur.modelVersion < SESSION_MODEL_VERSION) {
    const up = UPGRADES.get(cur.modelVersion);
    if (!up) {
      raise(
        "model_version_unsupported",
        `no registered upgrade from session model version ${cur.modelVersion}`,
      );
    }
    const next = up(cur);
    if (next.modelVersion <= cur.modelVersion) {
      raise(
        "model_version_unsupported",
        `upgrade from ${cur.modelVersion} did not advance the model version`,
      );
    }
    cur = next;
  }
  return cur;
}

export function emptySidecar(): string {
  return encodeSnapshot({
    modelVersion: SESSION_MODEL_VERSION,
    nextIds: initialNextIds(),
    sessions: [],
    facts: [],
    measurements: [],
    obligations: [],
  });
}

export type { CountedKind };
