/**
 * Pure projection helpers shared by both SessionStore backends and the
 * fault-injection index set.
 *
 * The stable desired-state key is `${kind}:${id}`. Mutation is a field on the
 * record, never part of the key — retries after a timeout must land on the
 * same adapter identity so at-least-once delivery stays idempotent at the
 * index when the adapter upserts/retracts by key.
 */

import {
  COUNTED_KINDS,
  rowsOfKind,
  type CountedKind,
  type FactRow,
  type MeasurementRow,
  type ObligationRow,
  type SessionSnapshot,
} from "./entities.js";
import {
  PROJECTABLE_FIELDS,
  type ProjectionMutation,
  type ProjectionRecord,
} from "./port.js";

/** Stable desired-state identity. Mutation is not part of this key. */
export function projectionKey(kind: CountedKind, id: number): string {
  return `${kind}:${id}`;
}

/** Subtractive redaction: only PROJECTABLE_FIELDS may leave the machine. */
export function projectableText(
  kind: CountedKind,
  row: Readonly<Record<string, unknown>>,
): string {
  const allowed = PROJECTABLE_FIELDS[kind];
  return allowed
    .map((f) => row[f])
    .filter((v): v is string => typeof v === "string")
    .join(" — ");
}

export function upsertRecord(
  kind: CountedKind,
  id: number,
  row: Readonly<Record<string, unknown>>,
): ProjectionRecord {
  return {
    key: projectionKey(kind, id),
    kind,
    id,
    mutation: "upsert",
    text: projectableText(kind, row),
  };
}

export function retractRecord(kind: CountedKind, id: number): ProjectionRecord {
  return {
    key: projectionKey(kind, id),
    kind,
    id,
    mutation: "retract",
  };
}

function isLiveCountedRow(row: Readonly<Record<string, unknown>>): boolean {
  return row["superseded_by"] == null;
}

/**
 * Active upserts for every live fact, measurement, and obligation.
 * Superseded rows are omitted: stale recall is worse than none.
 */
export function buildProjection(
  snapshot: SessionSnapshot,
): readonly ProjectionRecord[] {
  const out: ProjectionRecord[] = [];
  for (const kind of COUNTED_KINDS) {
    for (const row of rowsOfKind(snapshot, kind)) {
      const id = row["id"];
      if (typeof id !== "number") continue;
      if (!isLiveCountedRow(row)) continue;
      out.push(upsertRecord(kind, id, row as Record<string, unknown>));
    }
  }
  return out;
}

/** Live projectable identity → upsert record, from a snapshot. */
export function liveProjectionMap(
  snapshot: SessionSnapshot,
): Map<string, Extract<ProjectionRecord, { mutation: "upsert" }>> {
  const map = new Map<string, Extract<ProjectionRecord, { mutation: "upsert" }>>();
  for (const rec of buildProjection(snapshot)) {
    if (rec.mutation === "upsert") map.set(rec.key, rec);
  }
  return map;
}

export function recordFromFact(row: FactRow): ProjectionRecord {
  return upsertRecord("fact", row.id, row as unknown as Record<string, unknown>);
}

export function recordFromMeasurement(row: MeasurementRow): ProjectionRecord {
  return upsertRecord(
    "measurement",
    row.id,
    row as unknown as Record<string, unknown>,
  );
}

export function recordFromObligation(row: ObligationRow): ProjectionRecord {
  return upsertRecord(
    "obligation",
    row.id,
    row as unknown as Record<string, unknown>,
  );
}

export type { ProjectionMutation };
