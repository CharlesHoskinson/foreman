/**
 * Effect-owned attempt-bound round transaction entry point.
 *
 * Uses only injected services for fallible boundaries. No filesystem
 * allocation, process launch, or implicit retries.
 */

import { Context, Effect } from "effect";
import {
  type AttemptIdentity,
  type LaneId,
  type RunId,
} from "@foreman/event-log";
import {
  attemptIdentityFromPlan,
  decodeRoundPlanV1,
  decodeRoundRequestV1,
  isRoundContractFailure,
  type ReportSnapshotV1,
  type RoundOutcomeCompletedV1,
  type RoundOutcomeIncompleteV1,
  type RoundOutcomeV1,
  type RoundPlanV1,
  type RoundRequestV1,
} from "./round-contract.js";
import {
  decideRoundOutcome,
  type ReportReadFailureReason,
  type ReportReadResult,
} from "./report-freshness.js";

// ---------------------------------------------------------------------------
// Boundary failures (fail closed)
// ---------------------------------------------------------------------------

export type RoundBoundaryFailureReason =
  | "allocation_failed"
  | "baseline_read_failed"
  | "append_failed"
  | "implementation_transport_failed"
  | "checkpoint_failed"
  | "gate_transport_failed"
  | "empty_checkpoint_commit"
  | "invalid_exit_code"
  | "invalid_request";

export class RoundBoundaryFailure {
  readonly _tag = "RoundBoundaryFailure" as const;
  constructor(readonly reason: RoundBoundaryFailureReason) {}
}

// ---------------------------------------------------------------------------
// Event drafts recorded by the transaction (payload-complete for R2)
// ---------------------------------------------------------------------------

export type RoundEventDraft =
  | {
      readonly type: "prompt";
      readonly lane: LaneId;
      readonly payload: {
        readonly attempt: number;
        readonly roundPlan: RoundPlanV1;
      };
    }
  | {
      readonly type: "checkpoint";
      readonly lane: LaneId;
      readonly commit: string;
      readonly payload: { readonly attempt: number };
    }
  | {
      readonly type: "state";
      readonly lane: LaneId;
      readonly payload: {
        readonly attempt: number;
        readonly state: "verifying";
      };
    }
  | {
      readonly type: "round_done";
      readonly lane: LaneId;
      readonly payload: {
        readonly attempt: number;
        readonly outcome: RoundOutcomeCompletedV1;
      };
    }
  | {
      readonly type: "waiting_child";
      readonly lane: LaneId;
      readonly payload: {
        readonly attempt: number;
        readonly outcome: RoundOutcomeIncompleteV1;
      };
    }
  | {
      readonly type: "alert";
      readonly lane: LaneId;
      readonly payload: {
        readonly attempt: number;
        readonly kind: "round_incomplete";
        readonly outcome: RoundOutcomeIncompleteV1;
      };
    };

// ---------------------------------------------------------------------------
// Effect services
// ---------------------------------------------------------------------------

export class AttemptAllocator extends Context.Tag("AttemptAllocator")<
  AttemptAllocator,
  {
    /**
     * Sole source of attempt identity for a round. Must not invent attempt 1
     * when the durable counter is unavailable — fail closed instead.
     */
    readonly allocate: (
      runId: RunId,
      laneId: LaneId,
    ) => Effect.Effect<AttemptIdentity, RoundBoundaryFailure>;
  }
>() {}

export class RoundEventSink extends Context.Tag("RoundEventSink")<
  RoundEventSink,
  {
    readonly append: (
      event: RoundEventDraft,
    ) => Effect.Effect<void, RoundBoundaryFailure>;
  }
>() {}

export class ReportSnapshotReader extends Context.Tag("ReportSnapshotReader")<
  ReportSnapshotReader,
  {
    /**
     * Capture a report snapshot. Must enforce the 8,388,608-byte content bound
     * and return report_too_large before retaining oversize content.
     */
    readonly read: (
      reportPath: string,
    ) => Effect.Effect<ReportReadResult, never>;
  }
>() {}

export class ImplementationCommand extends Context.Tag("ImplementationCommand")<
  ImplementationCommand,
  {
    /**
     * Run the implementation with the exact commandArgv vector.
     * Must not join, split, quote, or escape entries.
     * Returns exit code 0–255.
     */
    readonly run: (
      commandArgv: readonly string[],
    ) => Effect.Effect<number, RoundBoundaryFailure>;
  }
>() {}

export class CheckpointCapture extends Context.Tag("CheckpointCapture")<
  CheckpointCapture,
  {
    /** Capture a nonempty commit string for the checkpoint event. */
    readonly capture: () => Effect.Effect<string, RoundBoundaryFailure>;
  }
>() {}

export class GateCommand extends Context.Tag("GateCommand")<
  GateCommand,
  {
    /** Run the gate command string. Returns exit code 0–255. */
    readonly run: (
      gateCommand: string,
    ) => Effect.Effect<number, RoundBoundaryFailure>;
  }
>() {}

export type RoundTransactionServices =
  | AttemptAllocator
  | RoundEventSink
  | ReportSnapshotReader
  | ImplementationCommand
  | CheckpointCapture
  | GateCommand;

function requireExitCode(
  code: number,
): Effect.Effect<number, RoundBoundaryFailure> {
  if (
    typeof code !== "number" ||
    !Number.isSafeInteger(code) ||
    code < 0 ||
    code > 255
  ) {
    return Effect.fail(new RoundBoundaryFailure("invalid_exit_code"));
  }
  return Effect.succeed(code);
}

/**
 * One Effect transaction entry point. Operation order:
 * 1 allocate attempt
 * 2 capture report baseline
 * 3 record prompt
 * 4 run implementation (gate still runs after nonzero exit)
 * 5 capture checkpoint
 * 6 record checkpoint event
 * 7 record verifying state
 * 8 run gate
 * 9 capture post-gate snapshot
 * 10 decide outcome
 * 11 record terminal sequence
 *
 * No implicit retries. Fail closed at injected boundaries.
 */
export function runRoundTransaction(
  request: RoundRequestV1,
): Effect.Effect<RoundOutcomeV1, RoundBoundaryFailure, RoundTransactionServices> {
  return Effect.gen(function* () {
    // 0. Validate the original request value before any injected boundary.
    // Pass the value through closed-schema decode directly — do not project
    // known keys first, or extra fields (attemptId, reportBaseline, …) would
    // be stripped and silently accepted.
    // Empty argv, empty first arg, NUL, unknown fields, and every byte bound
    // fail closed.
    const validated = decodeRoundRequestV1(request);
    if (isRoundContractFailure(validated)) {
      return yield* Effect.fail(new RoundBoundaryFailure("invalid_request"));
    }

    const allocator = yield* AttemptAllocator;
    const sink = yield* RoundEventSink;
    const reader = yield* ReportSnapshotReader;
    const impl = yield* ImplementationCommand;
    const checkpoint = yield* CheckpointCapture;
    const gate = yield* GateCommand;

    // 1. Allocate attempt (sole source of attemptId).
    const attemptIdentity = yield* allocator.allocate(
      validated.runId,
      validated.laneId,
    );

    // 2. Capture report baseline (sole source of reportBaseline).
    // Baseline read failure fails closed (does not start implementation).
    const baselineResult = yield* reader.read(validated.reportPath);
    const reportBaseline = yield* baselineToSnapshotOrFail(baselineResult);

    const candidatePlan: RoundPlanV1 = {
      schemaVersion: 1,
      runId: validated.runId,
      laneId: validated.laneId,
      attemptId: attemptIdentity.attemptId,
      mode: "round",
      commandArgv: validated.commandArgv,
      gateCommand: validated.gateCommand,
      reportPath: validated.reportPath,
      reportBaseline,
    };

    // Never record a plan which decodeRoundPlanV1 rejects.
    const roundPlan = decodeRoundPlanV1(candidatePlan);
    if (isRoundContractFailure(roundPlan)) {
      return yield* Effect.fail(new RoundBoundaryFailure("invalid_request"));
    }

    // Identity in the plan must match allocation (defensive).
    const planIdentity = attemptIdentityFromPlan(roundPlan);
    if (
      planIdentity.runId !== attemptIdentity.runId ||
      planIdentity.laneId !== attemptIdentity.laneId ||
      planIdentity.attemptId !== attemptIdentity.attemptId
    ) {
      return yield* Effect.fail(new RoundBoundaryFailure("allocation_failed"));
    }

    // 3. Durably record the prompt (complete plan under payload.roundPlan).
    yield* sink.append({
      type: "prompt",
      lane: validated.laneId,
      payload: {
        attempt: attemptIdentity.attemptId,
        roundPlan,
      },
    });

    // 4. Run implementation. Nonzero exit still proceeds to checkpoint + gate.
    const implementationExitCode = yield* requireExitCode(
      yield* impl.run(validated.commandArgv),
    );

    // 5–6. Capture checkpoint and record exactly one checkpoint event.
    const commit = yield* checkpoint.capture();
    if (typeof commit !== "string" || commit.length === 0) {
      return yield* Effect.fail(
        new RoundBoundaryFailure("empty_checkpoint_commit"),
      );
    }
    yield* sink.append({
      type: "checkpoint",
      lane: validated.laneId,
      commit,
      payload: { attempt: attemptIdentity.attemptId },
    });

    // 7. Durably record verifying state.
    yield* sink.append({
      type: "state",
      lane: validated.laneId,
      payload: {
        attempt: attemptIdentity.attemptId,
        state: "verifying",
      },
    });

    // 8. Run gate (after implementation, including nonzero implement exit).
    const gateExitCode = yield* requireExitCode(
      yield* gate.run(validated.gateCommand),
    );

    // 9. Capture post-gate report snapshot.
    const postGate = yield* reader.read(validated.reportPath);

    // 10. Decide outcome (first-match order).
    const outcome = decideRoundOutcome({
      attemptIdentity,
      implementationExitCode,
      gateExitCode,
      reportBaseline,
      postGate,
    });

    // 11. Durably record terminal sequence with complete outcome in payload.
    if (outcome._tag === "completed") {
      yield* sink.append({
        type: "round_done",
        lane: validated.laneId,
        payload: {
          attempt: attemptIdentity.attemptId,
          outcome,
        },
      });
    } else {
      yield* sink.append({
        type: "waiting_child",
        lane: validated.laneId,
        payload: {
          attempt: attemptIdentity.attemptId,
          outcome,
        },
      });
      yield* sink.append({
        type: "alert",
        lane: validated.laneId,
        payload: {
          attempt: attemptIdentity.attemptId,
          kind: "round_incomplete",
          outcome,
        },
      });
    }

    return outcome;
  });
}

function baselineToSnapshotOrFail(
  result: ReportReadResult,
): Effect.Effect<ReportSnapshotV1, RoundBoundaryFailure> {
  if (result._tag === "Failure") {
    return Effect.fail(new RoundBoundaryFailure("baseline_read_failed"));
  }
  return Effect.succeed(result.snapshot);
}

/** Re-export reader failure reason for service implementers. */
export type { ReportReadFailureReason, ReportReadResult };
