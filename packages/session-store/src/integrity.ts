/**
 * Integrity rules the port enforces.
 *
 * The SQLite implementation runs `PRAGMA foreign_keys=OFF`, so none of these
 * are enforced by the backend today. Declaring them here — and checking them on
 * every import — is what stops a hostile or corrupt sidecar from round-tripping
 * "successfully" into the system of record.
 *
 * Validation is whole-snapshot and two-pass: a `superseded_by` pointer may
 * reference a row that appears later in the stream.
 */

import {
  COUNTED_KINDS,
  ENTITY_ORDER,
  isCountedKind,
  rowsOfKind,
  specFor,
  type CountedKind,
  type EntityKind,
  type FieldSpec,
  type SessionSnapshot,
} from "./entities.js";
import { raise } from "./failures.js";

export type Violation = {
  readonly kind: EntityKind;
  readonly field: string | null;
  readonly detail: string;
};

function typeOk(spec: FieldSpec, v: unknown): boolean {
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

function describe(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

/**
 * Check a snapshot against the declared model and all domain rules.
 * Returns every violation found rather than stopping at the first, so a bad
 * sidecar produces one actionable report.
 */
export function findViolations(snapshot: SessionSnapshot): readonly Violation[] {
  const out: Violation[] = [];

  // -- shape: fields present, typed, nullability honoured ------------------
  for (const kind of ENTITY_ORDER) {
    const spec = specFor(kind);
    const declared = new Set(spec.fields.map((f) => f.name));
    const rows = rowsOfKind(snapshot, kind);

    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!declared.has(key)) {
          out.push({ kind, field: key, detail: "field is not in the model" });
        }
      }
      for (const f of spec.fields) {
        if (!(f.name in row)) {
          out.push({
            kind,
            field: f.name,
            detail: "field absent; the model requires an explicit null",
          });
          continue;
        }
        const v = row[f.name];
        if (v === null) {
          if (!f.nullable) {
            out.push({ kind, field: f.name, detail: "null in a non-null field" });
          }
          continue;
        }
        if (v === undefined) {
          out.push({
            kind,
            field: f.name,
            detail: "undefined is not a value; use null",
          });
          continue;
        }
        if (!typeOk(f, v)) {
          out.push({
            kind,
            field: f.name,
            detail: `expected ${f.type}, got ${describe(v)}`,
          });
        }
      }
    }
  }

  // -- ordering: rows ascend by the declared ordering key ------------------
  for (const kind of ENTITY_ORDER) {
    const spec = specFor(kind);
    const rows = rowsOfKind(snapshot, kind);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1] as Record<string, unknown>;
      const cur = rows[i] as Record<string, unknown>;
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

  // -- identity: unique, positive, below the allocation watermark ----------
  const idsByKind = new Map<CountedKind, Set<number>>();
  for (const kind of COUNTED_KINDS) {
    const seen = new Set<number>();
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
          detail: `id ${id} is at or above nextIds.${kind} (${next})`,
        });
      }
    }
    idsByKind.set(kind, seen);
  }

  // -- session references --------------------------------------------------
  const sessionIds = new Set<string>();
  for (const row of rowsOfKind(snapshot, "session")) {
    const sid = row["session_id"];
    if (typeof sid === "string") sessionIds.add(sid);
  }
  for (const kind of COUNTED_KINDS) {
    for (const row of rowsOfKind(snapshot, kind)) {
      const sid = row["session_id"];
      if (sid === null || sid === undefined) continue;
      if (typeof sid === "string" && !sessionIds.has(sid)) {
        out.push({
          kind,
          field: "session_id",
          detail: `references unknown session ${JSON.stringify(sid)}`,
        });
      }
    }
  }

  // -- supersession --------------------------------------------------------
  for (const kind of ENTITY_ORDER) {
    const spec = specFor(kind);
    if (!spec.supersedable || !isCountedKind(kind)) continue;
    const ids = idsByKind.get(kind) ?? new Set<number>();
    const rows = rowsOfKind(snapshot, kind);
    const successorOf = new Map<number, number>();

    for (const row of rows) {
      const id = row["id"];
      const by = row["superseded_by"];
      const at = row["superseded_at"];
      const reason = row["supersede_reason"];

      // all-or-none: by and at travel together
      if ((by === null) !== (at === null)) {
        out.push({
          kind,
          field: "superseded_by",
          detail:
            "superseded_by and superseded_at must both be set or both be null",
        });
      }
      if (by === null && reason !== null) {
        out.push({
          kind,
          field: "supersede_reason",
          detail: "reason present on a row that is not superseded",
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
          detail: `dangling superseded_by ${by}`,
        });
        continue;
      }
      if (typeof id === "number") successorOf.set(id, by);
    }

    // Fan-in is allowed: one successor may legitimately supersede several
    // predecessors at once, e.g. measurement 17 supersedes four stale
    // full-suite runs (measurements 1, 8, 14, and 15) recorded when a fresh
    // run replaced them all in the same pass. The query "what superseded row
    // X" still has exactly one answer per row (superseded_by is single-
    // valued), so nothing becomes ambiguous -- only "what did row Y
    // supersede" becomes one-to-many, and that is exactly the real shape of
    // this data. Do not reinstate a targetCount cardinality check here.

    // cycles: follow each chain, bounded by the number of rows
    for (const start of successorOf.keys()) {
      let cur: number | undefined = start;
      const path = new Set<number>();
      let steps = 0;
      while (cur !== undefined && steps++ <= successorOf.size) {
        if (path.has(cur)) {
          out.push({
            kind,
            field: "superseded_by",
            detail: `supersession cycle through row ${cur}`,
          });
          break;
        }
        path.add(cur);
        cur = successorOf.get(cur);
      }
    }
  }

  // -- obligation status transitions --------------------------------------
  for (const row of rowsOfKind(snapshot, "obligation")) {
    const status = row["status"];
    const closed = row["closed_ts"];
    if (status === "open" && closed !== null) {
      out.push({
        kind: "obligation",
        field: "closed_ts",
        detail: "an open obligation must not have closed_ts",
      });
    }
    if ((status === "done" || status === "dropped") && closed === null) {
      out.push({
        kind: "obligation",
        field: "closed_ts",
        detail: `a ${status} obligation requires closed_ts`,
      });
    }
  }

  return out;
}

export function formatViolations(vs: readonly Violation[]): string {
  return vs
    .map((v) => `  ${v.kind}${v.field ? `.${v.field}` : ""}: ${v.detail}`)
    .join("\n");
}

/** Throw unless the snapshot satisfies every rule. */
export function assertIntegrity(snapshot: SessionSnapshot): void {
  const vs = findViolations(snapshot);
  if (vs.length === 0) return;
  raise(
    "supersession_dangling",
    `snapshot violates ${vs.length} integrity rule(s):\n${formatViolations(vs)}`,
    { detail: formatViolations(vs) },
  );
}
