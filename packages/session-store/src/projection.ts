/**
 * Pure projection helpers shared by both SessionStore backends and the
 * fault-injection index set.
 *
 * The registered desired-state key is `${projectId}:${kind}:${id}`. Legacy
 * unregistered stores retain `${kind}:${id}` until registration binds them.
 * Mutation is a field on the record, never part of the key.
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

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isProjectIdV1(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ID.test(value);
}

/** Stable desired-state identity. Mutation is not part of this key. */
export function projectionKey(
  kind: CountedKind,
  id: number,
  projectId: string | null = null,
): string {
  if (projectId !== null && !isProjectIdV1(projectId)) {
    throw new Error("invalid project id");
  }
  return projectId === null ? `${kind}:${id}` : `${projectId}:${kind}:${id}`;
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
  projectId: string | null = null,
): ProjectionRecord {
  const base = {
    key: projectionKey(kind, id, projectId),
    kind,
    id,
    mutation: "upsert" as const,
    text: projectableText(kind, row),
  };
  return projectId === null ? base : { project_id: projectId, ...base };
}

export function retractRecord(
  kind: CountedKind,
  id: number,
  projectId: string | null = null,
): ProjectionRecord {
  const base = {
    key: projectionKey(kind, id, projectId),
    kind,
    id,
    mutation: "retract",
  } as const;
  return projectId === null ? base : { project_id: projectId, ...base };
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
  projectId: string | null = null,
): readonly ProjectionRecord[] {
  const out: ProjectionRecord[] = [];
  for (const kind of COUNTED_KINDS) {
    for (const row of rowsOfKind(snapshot, kind)) {
      const id = row["id"];
      if (typeof id !== "number") continue;
      if (!isLiveCountedRow(row)) continue;
      out.push(upsertRecord(kind, id, row as Record<string, unknown>, projectId));
    }
  }
  return out;
}

/** Live projectable identity → upsert record, from a snapshot. */
export function liveProjectionMap(
  snapshot: SessionSnapshot,
  projectId: string | null = null,
): Map<string, Extract<ProjectionRecord, { mutation: "upsert" }>> {
  const map = new Map<string, Extract<ProjectionRecord, { mutation: "upsert" }>>();
  for (const rec of buildProjection(snapshot, projectId)) {
    if (rec.mutation === "upsert") map.set(rec.key, rec);
  }
  return map;
}

export function recordFromFact(
  row: FactRow,
  projectId: string | null = null,
): ProjectionRecord {
  return upsertRecord(
    "fact",
    row.id,
    row as unknown as Record<string, unknown>,
    projectId,
  );
}

export function recordFromMeasurement(
  row: MeasurementRow,
  projectId: string | null = null,
): ProjectionRecord {
  return upsertRecord(
    "measurement",
    row.id,
    row as unknown as Record<string, unknown>,
    projectId,
  );
}

export function recordFromObligation(
  row: ObligationRow,
  projectId: string | null = null,
): ProjectionRecord {
  return upsertRecord(
    "obligation",
    row.id,
    row as unknown as Record<string, unknown>,
    projectId,
  );
}

export type { ProjectionMutation };
