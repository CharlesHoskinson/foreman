/**
 * MemoryIndex implementations, including the fault-injection set the
 * conformance suite uses to enforce invariant I2.
 *
 * No external adapter lives here. `NullMemoryIndex` is the default and the
 * only implementation, so Foreman is fully functional offline and without
 * credentials.
 *
 * Projection helpers live in projection.ts — this module must not become the
 * authority for desired-state keys or redaction.
 */

import type { EntityRef, MemoryIndex, ProjectionRecord } from "./port.js";
import { COUNTED_KINDS, type CountedKind } from "./entities.js";

export {
  buildProjection,
  projectionKey,
  projectableText,
  retractRecord,
  upsertRecord,
} from "./projection.js";

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
        project_id: "00000000-0000-4000-8000-000000000000",
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
