/**
 * Reader for sidecar format version 1.
 *
 * v1 is a dead format: nothing writes it any more. It is still read because
 * v1 files exist outside this checkout — the stale Windows checkout at
 * C:\Users\charl\foreman holds one, and obligation 24 records that the
 * installed-plugin junction still points at it.
 *
 * Two shape differences from v2, plus one value normalization:
 *   - records are {table, row} with plural table names, not {kind, row}
 *   - the header carries no session_model_version and no next_ids
 *   - obligations may carry status "blocked", which the model does not declare
 *
 * The status rewrite lives here rather than in a later migration because
 * decodeSnapshot ends by calling assertIntegrity, and status is a declared enum
 * over OBLIGATION_STATUSES. A blocked row fails validation on the way in, so a
 * post-decode migration could never read the live sidecar at all.
 *
 * The header is validated here too, mirroring readHeader in sidecar.ts: the
 * `format` string must match and no unknown header field is tolerated. Unlike
 * v2, v1 legitimately carries neither `session_model_version` nor `next_ids`,
 * so only `format` and `format_version` are known fields on this path.
 *
 * This file is the only place that knows v1 exists. Delete it whole if the
 * format is ever dropped.
 */

import {
  COUNTED_KINDS,
  type CountedKind,
  type EntityKind,
  type NextIds,
  type SessionSnapshot,
} from "./entities.js";
import { raise } from "./failures.js";

/** Shared with sidecar.ts, which re-exports this as its own SIDECAR_FORMAT. */
export const SIDECAR_FORMAT = "foreman-session-sidecar";
export const V1_FORMAT_VERSION = 1;

/** v1 table names, including the one that is not an entity. */
const TABLE_TO_KIND: Readonly<Record<string, EntityKind>> = {
  sessions: "session",
  facts: "fact",
  measurements: "measurement",
  obligations: "obligation",
};

/**
 * Carried bookkeeping tables, not entity data. Dropped on read.
 *
 * Mixed legacy/port databases can leak `store_meta` and `memory_outbox` into
 * v1 sidecars alongside `schema_meta`. v1 counters are derived from entity row
 * maxima; stale `store_meta` counters are never trusted.
 */
const NON_ENTITY_TABLES: ReadonlySet<string> = new Set([
  "schema_meta",
  "store_meta",
  "memory_outbox",
]);

/** Header fields v1 actually declares. session_model_version and next_ids
 *  are v2-only and must stay optional here — v1 legitimately lacks both. */
const KNOWN_HEADER_FIELDS: ReadonlySet<string> = new Set(["format", "format_version"]);

function parseLine(line: string, lineNo: number): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = JSON.parse(line);
  } catch {
    raise("sidecar_malformed", `line ${lineNo} is not valid JSON`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    raise("sidecar_malformed", `line ${lineNo} is not a JSON object`);
  }
  return doc as Record<string, unknown>;
}

/**
 * Validate the v1 header. Unlike readHeader in sidecar.ts this does not (and
 * must not) require session_model_version or next_ids: v1 never had them.
 * It still enforces the format string and rejects unknown fields, so an
 * NDJSON stream that merely happens to start with `format_version: 1` is not
 * silently accepted as a foreman sidecar.
 */
function readHeaderV1(doc: Record<string, unknown>): void {
  if (doc["format"] !== SIDECAR_FORMAT) {
    raise(
      "sidecar_format",
      `unsupported sidecar format ${JSON.stringify(String(doc["format"]))}`,
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

export function decodeSnapshotV1(lines: readonly string[]): SessionSnapshot {
  if (lines.length === 0) {
    raise("sidecar_format", "sidecar is empty; a header record is required");
  }
  readHeaderV1(parseLine(lines[0] as string, 1));

  const buckets: Record<EntityKind, Record<string, unknown>[]> = {
    session: [],
    fact: [],
    measurement: [],
    obligation: [],
  };
  const seen: Record<EntityKind, Set<string>> = {
    session: new Set(),
    fact: new Set(),
    measurement: new Set(),
    obligation: new Set(),
  };

  for (let i = 1; i < lines.length; i++) {
    const doc = parseLine(lines[i] as string, i + 1);
    const keys = Object.keys(doc).sort().join(",");
    if (keys !== "row,table") {
      raise(
        "sidecar_malformed",
        `line ${i + 1} must contain exactly table and row`,
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
    if (kind === undefined) {
      raise(
        "unknown_entity_kind",
        `unknown v1 table ${JSON.stringify(table)}`,
      );
    }
    const row = doc["row"];
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      raise("sidecar_malformed", `line ${i + 1} row is not an object`);
    }
    const normalized = normalize(kind, row as Record<string, unknown>);
    const identityField = kind === "session" ? "session_id" : "id";
    const identity = String(normalized[identityField] ?? "");
    if (seen[kind].has(identity)) {
      raise(
        "identity_conflict",
        `duplicate ${kind} identity ${identity}`,
        { kind, field: identityField, detail: identity },
      );
    }
    seen[kind].add(identity);
    buckets[kind].push(normalized);
  }

  return {
    modelVersion: 1,
    nextIds: computeNextIds(buckets),
    sessions: buckets.session as never,
    facts: buckets.fact as never,
    measurements: buckets.measurement as never,
    obligations: buckets.obligation as never,
  };
}

/**
 * v1 stored "blocked" in status. The model declares blocker as its own column,
 * so blocked is derived state: open plus a non-null blocker. Rewriting loses
 * nothing.
 */
function normalize(
  kind: EntityKind,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (kind !== "obligation" || row["status"] !== "blocked") {
    return row;
  }
  return { ...row, status: "open" };
}

function computeNextIds(
  buckets: Readonly<Record<EntityKind, readonly Record<string, unknown>[]>>,
): NextIds {
  const next: Record<string, number> = {};
  for (const kind of COUNTED_KINDS) {
    let max = 0;
    for (const row of buckets[kind as CountedKind as EntityKind]) {
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
  return next as unknown as NextIds;
}
