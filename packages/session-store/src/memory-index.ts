/**
 * MemoryIndex implementations, including the fault-injection set the
 * conformance suite uses to enforce invariant I2.
 *
 * No TencentDB adapter lives here yet, by design: the contract lands first and
 * an adapter is written against it. `NullMemoryIndex` is the default, so
 * Foreman is fully functional offline and without credentials.
 */

import {
  PROJECTABLE_FIELDS,
  type EntityRef,
  type MemoryIndex,
  type ProjectionRecord,
} from "./port.js";
import {
  COUNTED_KINDS,
  rowsOfKind,
  type CountedKind,
  type SessionSnapshot,
} from "./entities.js";

/** Default. Accepts projections, recalls nothing. */
export class NullMemoryIndex implements MemoryIndex {
  readonly name = "null";
  async project(_records: readonly ProjectionRecord[]): Promise<void> {}
  async recall(_query: string, _limit: number): Promise<readonly EntityRef[]> {
    return [];
  }
  async beginEpoch(): Promise<string> {
    return "null-epoch";
  }
  async activateEpoch(_epoch: string): Promise<void> {}
}

/** Every call rejects. Models an unreachable or misconfigured backend. */
export class ThrowingMemoryIndex implements MemoryIndex {
  readonly name = "throwing";
  private fail(): never {
    throw new Error("MemoryIndex unavailable");
  }
  async project(): Promise<void> {
    this.fail();
  }
  async recall(): Promise<readonly EntityRef[]> {
    this.fail();
  }
  async beginEpoch(): Promise<string> {
    this.fail();
  }
  async activateEpoch(): Promise<void> {
    this.fail();
  }
}

/**
 * Every call hangs forever. Models a black-holed endpoint.
 * Any core operation that awaits this would never return — which is precisely
 * what the conformance suite is checking cannot happen.
 */
export class HangingMemoryIndex implements MemoryIndex {
  readonly name = "hanging";
  private hang<T>(): Promise<T> {
    return new Promise<T>(() => {});
  }
  project(): Promise<void> {
    return this.hang<void>();
  }
  recall(): Promise<readonly EntityRef[]> {
    return this.hang<readonly EntityRef[]>();
  }
  beginEpoch(): Promise<string> {
    return this.hang<string>();
  }
  activateEpoch(): Promise<void> {
    return this.hang<void>();
  }
}

/**
 * Returns plausible garbage: references to ids that do not exist, superseded
 * rows, and wrong kinds. Catches correctness paths that merely READ recall and
 * trust it. This is the implementation that finds real bugs.
 */
export class PoisonMemoryIndex implements MemoryIndex {
  readonly name = "poison";
  async project(_records: readonly ProjectionRecord[]): Promise<void> {}
  async recall(_query: string, limit: number): Promise<readonly EntityRef[]> {
    const kinds: readonly CountedKind[] = COUNTED_KINDS;
    const out: EntityRef[] = [];
    for (let i = 0; i < Math.max(1, limit); i++) {
      out.push({
        kind: kinds[i % kinds.length] as CountedKind,
        id: 999_000 + i,
        score: 1,
      });
    }
    return out;
  }
  async beginEpoch(): Promise<string> {
    return "poison-epoch";
  }
  async activateEpoch(_epoch: string): Promise<void> {}
}

/** The fault-injection set the conformance suite runs every case against. */
export function faultInjectionIndexes(): readonly MemoryIndex[] {
  return [
    new NullMemoryIndex(),
    new ThrowingMemoryIndex(),
    new HangingMemoryIndex(),
    new PoisonMemoryIndex(),
  ];
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Build projection records from a snapshot, emitting only projectable fields.
 *
 * Redaction is subtractive, not pattern-based: fields are excluded unless
 * PROJECTABLE_FIELDS lists them. `evidence`, `command`, `scope_paths` and
 * `note` therefore never leave the machine, because they routinely carry
 * absolute paths, hostnames and pasted credentials.
 */
export function buildProjection(
  snapshot: SessionSnapshot,
): readonly ProjectionRecord[] {
  const out: ProjectionRecord[] = [];
  for (const kind of COUNTED_KINDS) {
    const allowed = PROJECTABLE_FIELDS[kind];
    for (const row of rowsOfKind(snapshot, kind)) {
      const id = row["id"];
      if (typeof id !== "number") continue;
      // Superseded rows are not projected: stale recall is worse than none.
      if (row["superseded_by"] != null) continue;
      const text = allowed
        .map((f) => row[f])
        .filter((v): v is string => typeof v === "string")
        .join(" — ");
      if (!text) continue;
      out.push({ key: projectionKey(kind, id, "upsert"), kind, id, text });
    }
  }
  return out;
}

/** Stable idempotency key. A retried delivery after a timeout must not double-write. */
export function projectionKey(
  kind: CountedKind,
  id: number,
  mutation: string,
): string {
  return `${kind}:${id}:${mutation}`;
}
