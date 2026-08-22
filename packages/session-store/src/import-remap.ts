/**
 * Backend-neutral additive remap planner for importSnapshot force+remap.
 *
 * Empty-target exact import and force+refuse replacement stay in the backends.
 * This module only plans a non-empty additive merge: every donor counted row
 * gets a fresh target-derived id, colliding donor sessions are remapped, and
 * the complete merged snapshot is validated before any backend mutates.
 */

import {
  COUNTED_KINDS,
  SESSION_MODEL_VERSION,
  countRows,
  type CountedKind,
  type FactRow,
  type MeasurementRow,
  type NextIds,
  type ObligationRow,
  type SessionRow,
  type SessionSnapshot,
} from "./entities.js";
import { raise } from "./failures.js";
import { assertIntegrity } from "./integrity.js";
import type { IdCollisionPolicy, ProjectionRecord } from "./port.js";
import { liveProjectionMap } from "./projection.js";

export type CountedIdMaps = {
  readonly fact: ReadonlyMap<number, number>;
  readonly measurement: ReadonlyMap<number, number>;
  readonly obligation: ReadonlyMap<number, number>;
};

export type RemappedDonorRows = {
  readonly sessions: readonly SessionRow[];
  readonly facts: readonly FactRow[];
  readonly measurements: readonly MeasurementRow[];
  readonly obligations: readonly ObligationRow[];
};

export type ImportRemapPlan = {
  readonly merged: SessionSnapshot;
  /** Remapped donor-only rows the backend must insert. */
  readonly insert: RemappedDonorRows;
  readonly idMaps: CountedIdMaps;
  readonly sessionMap: ReadonlyMap<string, string>;
  /** Always countRows(donor), including sessions and superseded rows. */
  readonly written: number;
};

/** Resolve a runtime collision policy; unknown values are typed refusals. */
export function resolveIdCollisionPolicy(
  raw: unknown,
): IdCollisionPolicy {
  if (raw === undefined || raw === "refuse") return "refuse";
  if (raw === "remap") return "remap";
  raise(
    "invalid_argument",
    `unknown onIdCollision policy: ${String(raw)}`,
  );
}

export function snapshotIsOccupied(snapshot: SessionSnapshot): boolean {
  return countRows(snapshot) > 0;
}

function hasOpenSession(snapshot: SessionSnapshot): boolean {
  return snapshot.sessions.some((s) => s.ended_ts === null);
}

function sortSessions(rows: readonly SessionRow[]): SessionRow[] {
  return [...rows].sort((a, b) =>
    a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0,
  );
}

function sortById<T extends { readonly id: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.id - b.id);
}

function allocateSessionId(
  original: string,
  reserved: Set<string>,
): string {
  if (!reserved.has(original)) return original;
  let n = 1;
  for (;;) {
    const candidate = `${original}~import-${n}`;
    if (!reserved.has(candidate)) return candidate;
    n += 1;
    if (n >= Number.MAX_SAFE_INTEGER) {
      raise(
        "invalid_argument",
        `cannot allocate import session id for ${JSON.stringify(original)}`,
      );
    }
  }
}

function buildSessionMap(
  target: SessionSnapshot,
  donor: SessionSnapshot,
): {
  readonly sessionMap: Map<string, string>;
  readonly insertSessions: SessionRow[];
} {
  const targetIds = new Set(target.sessions.map((s) => s.session_id));
  const donorOriginals = donor.sessions.map((s) => s.session_id);
  // Reserve every target id and every donor original before allocation so a
  // remapped A cannot land on donor-owned A~import-1.
  const reserved = new Set<string>([...targetIds, ...donorOriginals]);
  const sessionMap = new Map<string, string>();
  const insertSessions: SessionRow[] = [];

  for (const row of sortSessions(donor.sessions)) {
    const mapped = targetIds.has(row.session_id)
      ? allocateSessionId(row.session_id, reserved)
      : row.session_id;
    if (mapped !== row.session_id) reserved.add(mapped);
    sessionMap.set(row.session_id, mapped);
    insertSessions.push(
      mapped === row.session_id ? { ...row } : { ...row, session_id: mapped },
    );
  }

  return { sessionMap, insertSessions };
}

function allocateCountedIds(
  kind: CountedKind,
  targetNext: number,
  donorRows: readonly { readonly id: number }[],
): Map<number, number> {
  const ordered = sortById(donorRows);
  const count = ordered.length;
  if (count === 0) return new Map();

  if (
    typeof targetNext !== "number" ||
    !Number.isSafeInteger(targetNext) ||
    targetNext < 1
  ) {
    raise(
      "invalid_argument",
      `target nextIds.${kind} must be a positive safe integer`,
    );
  }

  const nextAfter = targetNext + count;
  if (!Number.isSafeInteger(nextAfter) || nextAfter < 1) {
    raise(
      "invalid_argument",
      `import remap would overflow nextIds.${kind}`,
    );
  }

  const map = new Map<number, number>();
  let next = targetNext;
  for (const row of ordered) {
    map.set(row.id, next);
    next += 1;
  }
  return map;
}

function mapSessionId(
  sessionId: string | null,
  sessionMap: ReadonlyMap<string, string>,
): string | null {
  if (sessionId === null) return null;
  const mapped = sessionMap.get(sessionId);
  if (mapped === undefined) {
    raise(
      "invalid_argument",
      `donor session_id ${JSON.stringify(sessionId)} missing from session map`,
    );
  }
  return mapped;
}

function remapFacts(
  rows: readonly FactRow[],
  idMap: ReadonlyMap<number, number>,
  sessionMap: ReadonlyMap<string, string>,
): FactRow[] {
  return sortById(rows).map((row) => {
    const id = idMap.get(row.id);
    if (id === undefined) {
      raise("invalid_argument", `fact ${row.id} missing from id map`);
    }
    let superseded_by = row.superseded_by;
    if (superseded_by !== null) {
      const mapped = idMap.get(superseded_by);
      if (mapped === undefined) {
        raise(
          "invalid_argument",
          `fact superseded_by ${superseded_by} missing from id map`,
        );
      }
      superseded_by = mapped;
    }
    return {
      ...row,
      id,
      session_id: mapSessionId(row.session_id, sessionMap),
      superseded_by,
    };
  });
}

function remapMeasurements(
  rows: readonly MeasurementRow[],
  idMap: ReadonlyMap<number, number>,
  sessionMap: ReadonlyMap<string, string>,
): MeasurementRow[] {
  return sortById(rows).map((row) => {
    const id = idMap.get(row.id);
    if (id === undefined) {
      raise("invalid_argument", `measurement ${row.id} missing from id map`);
    }
    let superseded_by = row.superseded_by;
    if (superseded_by !== null) {
      const mapped = idMap.get(superseded_by);
      if (mapped === undefined) {
        raise(
          "invalid_argument",
          `measurement superseded_by ${superseded_by} missing from id map`,
        );
      }
      superseded_by = mapped;
    }
    return {
      ...row,
      id,
      session_id: mapSessionId(row.session_id, sessionMap),
      superseded_by,
    };
  });
}

function remapObligations(
  rows: readonly ObligationRow[],
  idMap: ReadonlyMap<number, number>,
  sessionMap: ReadonlyMap<string, string>,
): ObligationRow[] {
  return sortById(rows).map((row) => {
    const id = idMap.get(row.id);
    if (id === undefined) {
      raise("invalid_argument", `obligation ${row.id} missing from id map`);
    }
    return {
      ...row,
      id,
      session_id: mapSessionId(row.session_id, sessionMap),
    };
  });
}

/**
 * Plan an additive force+remap import.
 *
 * Both inputs and the complete merged output are integrity-checked. Overflow,
 * dual open sessions, and malformed snapshots raise typed invalid_argument /
 * supersession_* failures without implying any backend mutation.
 */
export function planAdditiveRemapImport(
  target: SessionSnapshot,
  donor: SessionSnapshot,
): ImportRemapPlan {
  // Exported planner is backend-independent: assertIntegrity does not check
  // modelVersion, so both inputs must be validated here before any planning.
  if (target.modelVersion !== SESSION_MODEL_VERSION) {
    raise(
      "model_version_unsupported",
      `target model version ${target.modelVersion} != ${SESSION_MODEL_VERSION}`,
    );
  }
  if (donor.modelVersion !== SESSION_MODEL_VERSION) {
    raise(
      "model_version_unsupported",
      `donor model version ${donor.modelVersion} != ${SESSION_MODEL_VERSION}`,
    );
  }

  assertIntegrity(target);
  assertIntegrity(donor);

  if (!snapshotIsOccupied(target)) {
    raise(
      "invalid_argument",
      "planAdditiveRemapImport requires a non-empty target; empty targets use exact import",
    );
  }

  if (hasOpenSession(target) && hasOpenSession(donor)) {
    raise(
      "invalid_argument",
      "force+remap refuses when both target and donor contain an open session",
    );
  }

  const written = countRows(donor);
  if (written === 0) {
    return {
      merged: target,
      insert: {
        sessions: [],
        facts: [],
        measurements: [],
        obligations: [],
      },
      idMaps: {
        fact: new Map(),
        measurement: new Map(),
        obligation: new Map(),
      },
      sessionMap: new Map(),
      written: 0,
    };
  }

  const { sessionMap, insertSessions } = buildSessionMap(target, donor);

  const factMap = allocateCountedIds("fact", target.nextIds.fact, donor.facts);
  const measurementMap = allocateCountedIds(
    "measurement",
    target.nextIds.measurement,
    donor.measurements,
  );
  const obligationMap = allocateCountedIds(
    "obligation",
    target.nextIds.obligation,
    donor.obligations,
  );

  const insertFacts = remapFacts(donor.facts, factMap, sessionMap);
  const insertMeasurements = remapMeasurements(
    donor.measurements,
    measurementMap,
    sessionMap,
  );
  const insertObligations = remapObligations(
    donor.obligations,
    obligationMap,
    sessionMap,
  );

  const nextIds: NextIds = {
    fact: target.nextIds.fact + donor.facts.length,
    measurement: target.nextIds.measurement + donor.measurements.length,
    obligation: target.nextIds.obligation + donor.obligations.length,
  };

  const merged: SessionSnapshot = {
    modelVersion: SESSION_MODEL_VERSION,
    nextIds,
    sessions: sortSessions([...target.sessions, ...insertSessions]),
    facts: sortById([...target.facts, ...insertFacts]),
    measurements: sortById([...target.measurements, ...insertMeasurements]),
    obligations: sortById([...target.obligations, ...insertObligations]),
  };

  assertIntegrity(merged);

  return {
    merged,
    insert: {
      sessions: insertSessions,
      facts: insertFacts,
      measurements: insertMeasurements,
      obligations: insertObligations,
    },
    idMaps: {
      fact: factMap,
      measurement: measurementMap,
      obligation: obligationMap,
    },
    sessionMap,
    written,
  };
}

/**
 * Fresh live upserts implied by merged − target.
 *
 * Because remapped counted ids are always fresh, this is exactly the sanitized
 * upsert set for imported live counted rows. Sessions are never projected.
 */
export function additiveImportProjectionUpserts(
  target: SessionSnapshot,
  merged: SessionSnapshot,
): readonly Extract<ProjectionRecord, { mutation: "upsert" }>[] {
  const oldLive = liveProjectionMap(target);
  const newLive = liveProjectionMap(merged);
  const out: Extract<ProjectionRecord, { mutation: "upsert" }>[] = [];
  for (const [key, rec] of newLive) {
    if (!oldLive.has(key)) out.push(rec);
  }
  // Stable order by kind then id for deterministic receipt minting across backends.
  out.sort((a, b) => {
    const ka = COUNTED_KINDS.indexOf(a.kind);
    const kb = COUNTED_KINDS.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    return a.id - b.id;
  });
  return out;
}
