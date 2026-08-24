/**
 * Bounded Effect drain for the SessionStore projection outbox.
 *
 * Delivery is durable at-least-once: a timeout can fire after a remote index
 * applied a batch and before the local receipt is acknowledged, so retries may
 * repeat delivery. Adapters get exactly-once effects only when they treat each
 * desired-state key as an idempotent upsert or retract.
 *
 * Effect timeout stops waiting; it does not cancel MemoryIndex.project. A
 * timed-out Promise may settle later — leave the batch unacknowledged.
 */

import { Duration, Effect } from "effect";

import type {
  MemoryIndex,
  OutboxEntry,
  ProjectionRecord,
  SessionStore,
} from "./port.js";

export type DrainOptions = {
  readonly batch: number; // 1..1000
  readonly maxAttempts: number; // 1..10, includes first attempt
  readonly timeoutMs: number; // 1..300000, per attempt
  readonly maxBatches: number; // 1..10000
};

export type DrainResult = {
  /** Exact receipts acknowledged by this drain. */
  readonly projected: number;
  /** Total MemoryIndex.project calls started. */
  readonly attempts: number;
  /** Successfully projected batches. */
  readonly batches: number;
};

export type OutboxDrainFailureReason =
  | "invalid_options"
  | "project_failed"
  | "list_failed"
  | "timeout"
  | "attempts_exhausted"
  | "ack_failed"
  | "max_batches";

export type OutboxDrainFailure = {
  readonly _tag: "OutboxDrainFailure";
  readonly reason: OutboxDrainFailureReason;
  readonly message: string;
  readonly projected: number;
  readonly attempts: number;
  readonly batches: number;
};

export function outboxDrainFailure(
  reason: OutboxDrainFailureReason,
  message: string,
  progress: {
    readonly projected: number;
    readonly attempts: number;
    readonly batches: number;
  },
): OutboxDrainFailure {
  return {
    _tag: "OutboxDrainFailure",
    reason,
    message,
    projected: progress.projected,
    attempts: progress.attempts,
    batches: progress.batches,
  };
}

function isPositiveSafeIntInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

function validateOptions(
  opts: DrainOptions,
): Effect.Effect<DrainOptions, OutboxDrainFailure> {
  const zero = { projected: 0, attempts: 0, batches: 0 };
  if (!isPositiveSafeIntInRange(opts.batch, 1, 1000)) {
    return Effect.fail(
      outboxDrainFailure(
        "invalid_options",
        `batch must be an integer in 1..1000, got ${String(opts.batch)}`,
        zero,
      ),
    );
  }
  if (!isPositiveSafeIntInRange(opts.maxAttempts, 1, 10)) {
    return Effect.fail(
      outboxDrainFailure(
        "invalid_options",
        `maxAttempts must be an integer in 1..10, got ${String(opts.maxAttempts)}`,
        zero,
      ),
    );
  }
  if (!isPositiveSafeIntInRange(opts.timeoutMs, 1, 300_000)) {
    return Effect.fail(
      outboxDrainFailure(
        "invalid_options",
        `timeoutMs must be an integer in 1..300000, got ${String(opts.timeoutMs)}`,
        zero,
      ),
    );
  }
  if (!isPositiveSafeIntInRange(opts.maxBatches, 1, 10_000)) {
    return Effect.fail(
      outboxDrainFailure(
        "invalid_options",
        `maxBatches must be an integer in 1..10000, got ${String(opts.maxBatches)}`,
        zero,
      ),
    );
  }
  return Effect.succeed(opts);
}

function defensiveRecords(
  entries: readonly OutboxEntry[],
): readonly ProjectionRecord[] {
  return entries.map((e) => {
    const project =
      e.record.project_id === undefined
        ? {}
        : { project_id: e.record.project_id };
    if (e.record.mutation === "upsert") {
      return {
        ...project,
        key: e.record.key,
        kind: e.record.kind,
        id: e.record.id,
        projection_version: e.record.projection_version,
        mutation: "upsert" as const,
        text: e.record.text,
      };
    }
    return {
      ...project,
      key: e.record.key,
      kind: e.record.kind,
      id: e.record.id,
      projection_version: e.record.projection_version,
      mutation: "retract" as const,
    };
  });
}

function projectOnce(
  index: MemoryIndex,
  records: readonly ProjectionRecord[],
  timeoutMs: number,
): Effect.Effect<void, { readonly kind: "timeout" | "reject"; readonly detail: string }> {
  return Effect.tryPromise({
    try: () => index.project(records),
    catch: (e) => ({
      kind: "reject" as const,
      detail: e instanceof Error ? e.message : String(e),
    }),
  }).pipe(
    Effect.timeout(Duration.millis(timeoutMs)),
    Effect.mapError((e) => {
      if (
        typeof e === "object" &&
        e !== null &&
        "_tag" in e &&
        (e as { _tag: string })._tag === "TimeoutException"
      ) {
        return { kind: "timeout" as const, detail: "projection timed out" };
      }
      if (
        typeof e === "object" &&
        e !== null &&
        "kind" in e &&
        ((e as { kind: string }).kind === "timeout" ||
          (e as { kind: string }).kind === "reject")
      ) {
        return e as { kind: "timeout" | "reject"; detail: string };
      }
      return {
        kind: "reject" as const,
        detail: e instanceof Error ? e.message : String(e),
      };
    }),
  );
}

/**
 * Drain pending outbox entries into `index` under bounded batching, attempts,
 * per-attempt timeout, and max successful batches.
 *
 * Successful earlier batches stay acknowledged if a later batch fails.
 * An ack failure stops the drain without retrying project for that batch.
 */
export function drainOutbox(
  store: SessionStore,
  index: MemoryIndex,
  opts: DrainOptions,
): Effect.Effect<DrainResult, OutboxDrainFailure> {
  return Effect.gen(function* () {
    const validated = yield* validateOptions(opts);
    let projected = 0;
    let attempts = 0;
    let batches = 0;

    for (let batchNo = 0; batchNo < validated.maxBatches; batchNo++) {
      let entries: readonly OutboxEntry[];
      try {
        entries = store.listOutbox(validated.batch);
      } catch (e) {
        return yield* Effect.fail(
          outboxDrainFailure(
            "list_failed",
            e instanceof Error ? e.message : String(e),
            { projected, attempts, batches },
          ),
        );
      }
      if (entries.length === 0) {
        return { projected, attempts, batches };
      }

      const receipts = entries.map((e) => e.receipt);
      const records = defensiveRecords(entries);
      let applied = false;
      let lastDetail = "projection failed";

      for (let attempt = 0; attempt < validated.maxAttempts; attempt++) {
        attempts += 1;
        const outcome = yield* Effect.either(
          projectOnce(index, records, validated.timeoutMs),
        );
        if (outcome._tag === "Right") {
          applied = true;
          break;
        }
        lastDetail = outcome.left.detail;
        if (attempt + 1 >= validated.maxAttempts) {
          return yield* Effect.fail(
            outboxDrainFailure(
              outcome.left.kind === "timeout" ? "timeout" : "attempts_exhausted",
              lastDetail,
              { projected, attempts, batches },
            ),
          );
        }
      }

      if (!applied) {
        return yield* Effect.fail(
          outboxDrainFailure("attempts_exhausted", lastDetail, {
            projected,
            attempts,
            batches,
          }),
        );
      }

      let acked: number;
      try {
        acked = store.ackOutbox(receipts);
      } catch (e) {
        return yield* Effect.fail(
          outboxDrainFailure(
            "ack_failed",
            e instanceof Error ? e.message : String(e),
            { projected, attempts, batches },
          ),
        );
      }

      projected += acked;
      batches += 1;

      // If the queue still has work after this batch and we have exhausted
      // maxBatches, the next loop iteration would exceed the bound — check
      // remaining work after a successful batch when at the limit.
      if (batches >= validated.maxBatches) {
        let remaining: readonly OutboxEntry[];
        try {
          remaining = store.listOutbox(1);
        } catch (e) {
          return yield* Effect.fail(
            outboxDrainFailure(
              "list_failed",
              e instanceof Error ? e.message : String(e),
              { projected, attempts, batches },
            ),
          );
        }
        if (remaining.length > 0) {
          return yield* Effect.fail(
            outboxDrainFailure(
              "max_batches",
              `reached maxBatches=${validated.maxBatches} with pending outbox entries`,
              { projected, attempts, batches },
            ),
          );
        }
        return { projected, attempts, batches };
      }
    }

    return { projected, attempts, batches };
  });
}
