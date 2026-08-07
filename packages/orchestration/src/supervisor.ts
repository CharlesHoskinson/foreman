/**
 * One-shot resume supervisor core (R5D).
 *
 * Injectable Effect services for run discovery, typed journal reads,
 * per-run leases, safety observation, restore, and queue. Uses
 * decideRoundResume; derives worktrees only from ownership events.
 */

import { Context, Effect } from "effect";
import {
  decodeLaneId,
  decodeRunId,
  inspectResumeAttemptBudget,
  isResumeAttemptFailure,
  type AttemptId,
  type AttemptIdentity,
  type LaneId,
  type ReplayRecord,
  type RunId,
  type StoredEvent,
} from "@foreman/event-log";
import {
  decideRoundResume,
  selectLatestRoundAttempt,
  type RoundResumeDecisionV1,
} from "./resume-decision.js";
import {
  observeResumeSafety,
  type ResumeSafetyObservationV1,
} from "./resume-safety-services.js";
import {
  runResumeQueueExecution,
  type QueueSubmissionV1,
  type ResumeQueueExecutionResultV1,
} from "./resume-queue-execution.js";
import { WorktreeRestore } from "./resume-worktree-restore.js";
import { QueueSubmitter } from "./resume-queue-execution.js";
import { RunJournal } from "@foreman/event-log";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Injectable services
// ---------------------------------------------------------------------------

export class RunDiscovery extends Context.Tag("RunDiscovery")<
  RunDiscovery,
  {
    readonly listRuns: () => Effect.Effect<readonly RunId[]>;
  }
>() {}

export class TypedJournalReader extends Context.Tag("TypedJournalReader")<
  TypedJournalReader,
  {
    readonly readRun: (
      runId: RunId,
    ) => Effect.Effect<
      | { readonly _tag: "Ok"; readonly records: readonly ReplayRecord[] }
      | { readonly _tag: "Missing" }
      | { readonly _tag: "Corrupt" }
    >;
  }
>() {}

export class RunLease extends Context.Tag("RunLease")<
  RunLease,
  {
    /**
     * Acquire exclusive per-run lease. Returns Held with a release effect,
     * or Busy when another sweeper holds the lock.
     */
    readonly acquire: (
      runId: RunId,
    ) => Effect.Effect<
      | {
          readonly _tag: "Held";
          readonly release: () => Effect.Effect<void>;
        }
      | { readonly _tag: "Busy" }
    >;
  }
>() {}

// ---------------------------------------------------------------------------
// Ownership / worktree derivation
// ---------------------------------------------------------------------------

export type OwnershipWorktreeV1 =
  | {
      readonly _tag: "Found";
      readonly worktree: string;
      readonly processId: number | null;
    }
  | { readonly _tag: "Missing" };

/**
 * Derive worktree and process id only from ownership events for the lane.
 * For a selected typed attempt, accept only ownership after the current prompt
 * whose payload attempt equals that attempt. Never falls back to a prior
 * attempt's ownership. Never infers from report paths.
 */
export function deriveOwnershipWorktree(
  events: readonly StoredEvent[],
  laneId: LaneId,
  fromPromptSeq: number | null,
  selectedAttemptId: AttemptId | null = null,
): OwnershipWorktreeV1 {
  if (fromPromptSeq === null) {
    return { _tag: "Missing" };
  }

  let latestInRound: StoredEvent | null = null;

  for (const event of events) {
    if (event.type !== "ownership") continue;
    if (event.lane !== laneId) continue;
    if (event.seq < fromPromptSeq) continue;
    if (selectedAttemptId !== null) {
      const attemptRaw = event.payload["attempt"];
      if (
        typeof attemptRaw !== "number" ||
        attemptRaw !== selectedAttemptId
      ) {
        continue;
      }
    }
    if (latestInRound === null || event.seq > latestInRound.seq) {
      latestInRound = event;
    }
  }

  if (latestInRound === null) {
    return { _tag: "Missing" };
  }

  const wt = latestInRound.payload["worktree"];
  if (typeof wt !== "string" || wt.length === 0 || wt.includes("\0")) {
    return { _tag: "Missing" };
  }

  const lpid = latestInRound.payload["launcher_pid"];
  const pid = latestInRound.payload["pid"];
  let processId: number | null = null;
  if (typeof lpid === "number" && Number.isSafeInteger(lpid) && lpid > 0) {
    processId = lpid;
  } else if (typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0) {
    processId = pid;
  }

  return { _tag: "Found", worktree: wt, processId };
}

function lockPathForWorktree(worktree: string): string {
  return join(worktree, ".harness", "lane.lock");
}

function eventsFromRecords(
  records: readonly ReplayRecord[],
): readonly StoredEvent[] {
  return records.map((r) => r.event);
}

/**
 * Sequence-preserving view for round selection and recovery. The budget event
 * type `resume_attempt` is R5C journal accounting; the legacy round reducer
 * treats it as unknown and would refuse with invalid_history. Budget count is
 * read from the full journal via inspectResumeAttemptBudget instead.
 */
function eventsForRoundSelection(
  events: readonly StoredEvent[],
): readonly StoredEvent[] {
  return events.filter((e) => e.type !== "resume_attempt");
}

function lanesFromEvents(events: readonly StoredEvent[]): readonly LaneId[] {
  const seen = new Set<string>();
  const out: LaneId[] = [];
  for (const e of events) {
    if (seen.has(e.lane)) continue;
    const decoded = decodeLaneId(e.lane);
    if (typeof decoded === "string") {
      seen.add(e.lane);
      out.push(decoded);
    }
  }
  return out;
}

function latestPromptSeq(
  events: readonly StoredEvent[],
  laneId: LaneId,
): number | null {
  let seq: number | null = null;
  for (const e of events) {
    if (e.type === "prompt" && e.lane === laneId) {
      if (seq === null || e.seq > seq) seq = e.seq;
    }
  }
  return seq;
}

// ---------------------------------------------------------------------------
// Lane action results
// ---------------------------------------------------------------------------

export type SupervisorLaneActionV1 =
  | {
      readonly _tag: "NoMutation";
      readonly runId: RunId;
      readonly laneId: LaneId;
      readonly decision: RoundResumeDecisionV1 | { readonly _tag: "NoOwnership" };
      readonly dryRun: boolean;
    }
  | {
      readonly _tag: "Planned";
      readonly runId: RunId;
      readonly laneId: LaneId;
      readonly decision: Extract<RoundResumeDecisionV1, { _tag: "Resume" }>;
      readonly worktree: string;
      readonly dryRun: true;
    }
  | {
      readonly _tag: "Executed";
      readonly runId: RunId;
      readonly laneId: LaneId;
      readonly result: ResumeQueueExecutionResultV1;
    }
  | {
      readonly _tag: "ExecutionFailed";
      readonly runId: RunId;
      readonly laneId: LaneId;
      readonly reason: string;
    };

export type SupervisorRunResultV1 =
  | {
      readonly _tag: "Swept";
      readonly runId: RunId;
      readonly actions: readonly SupervisorLaneActionV1[];
    }
  | { readonly _tag: "Busy"; readonly runId: RunId }
  | { readonly _tag: "Missing"; readonly runId: RunId }
  | { readonly _tag: "Corrupt"; readonly runId: RunId };

export type SupervisorConfig = {
  readonly resumeMaxAttempts: number;
  readonly shellBinary: string;
  readonly laneRunScript: string;
  readonly dryRun: boolean;
  readonly queueGroup?: string;
};

export type SupervisorServices =
  | RunDiscovery
  | TypedJournalReader
  | RunLease
  | WorktreeRestore
  | RunJournal
  | QueueSubmitter
  | import("./resume-safety-services.js").ResumeProcessProbe
  | import("./resume-safety-services.js").ResumeLockProbe;

/**
 * Sweep one run: acquire lease, read journal, decide per lane, optionally
 * execute resume queue path.
 */
export function sweepOneRun(
  runId: RunId,
  config: SupervisorConfig,
): Effect.Effect<SupervisorRunResultV1, never, SupervisorServices> {
  return Effect.gen(function* () {
    const leaseSvc = yield* RunLease;
    const lease = yield* leaseSvc.acquire(runId);
    if (lease._tag === "Busy") {
      return { _tag: "Busy" as const, runId };
    }

    try {
      const reader = yield* TypedJournalReader;
      const read = yield* reader.readRun(runId);
      if (read._tag === "Missing") {
        return { _tag: "Missing" as const, runId };
      }
      if (read._tag === "Corrupt") {
        return { _tag: "Corrupt" as const, runId };
      }

      const records = read.records;
      const events = eventsFromRecords(records);
      const lanes = lanesFromEvents(events);
      const actions: SupervisorLaneActionV1[] = [];

      for (const laneId of lanes) {
        const action = yield* decideAndMaybeExecuteLane(
          runId,
          laneId,
          records,
          events,
          config,
        );
        actions.push(action);
      }

      return { _tag: "Swept" as const, runId, actions };
    } finally {
      yield* lease.release();
    }
  });
}

function decideAndMaybeExecuteLane(
  runId: RunId,
  laneId: LaneId,
  records: readonly ReplayRecord[],
  events: readonly StoredEvent[],
  config: SupervisorConfig,
): Effect.Effect<SupervisorLaneActionV1, never, SupervisorServices> {
  return Effect.gen(function* () {
    // Full journal stays for budget inspection; round selection/recovery see
    // a sequence-preserving view without resume_attempt events only.
    const roundEvents = eventsForRoundSelection(events);
    const selected = selectLatestRoundAttempt(roundEvents, runId, laneId);
    const promptSeq =
      selected._tag === "Selected" ||
      selected._tag === "LegacyUnbound" ||
      selected._tag === "Invalid"
        ? latestPromptSeq(roundEvents, laneId)
        : null;

    // Ownership is required for Resume path worktree; Wait decisions still
    // need process/lock observation when Selected. Never fall back to a prior
    // attempt's ownership record.
    const selectedAttemptId =
      selected._tag === "Selected" ? selected.attemptIdentity.attemptId : null;
    const ownership = deriveOwnershipWorktree(
      roundEvents,
      laneId,
      promptSeq,
      selectedAttemptId,
    );

    // Budget inspection for current attempt when Selected. Invalid history
    // fails closed as Refused — never coerce the count to zero and continue.
    let resumeCount = 0;
    if (selected._tag === "Selected") {
      const budget = inspectResumeAttemptBudget(
        records,
        selected.attemptIdentity,
        config.resumeMaxAttempts,
      );
      if (isResumeAttemptFailure(budget)) {
        return {
          _tag: "NoMutation" as const,
          runId,
          laneId,
          decision: {
            _tag: "Refused" as const,
            attemptIdentity: selected.attemptIdentity,
            reason: "invalid_history" as const,
          },
          dryRun: config.dryRun,
        };
      }
      resumeCount = budget.resumeCount;
    }

    let safety: ResumeSafetyObservationV1 = {
      processState: "inactive",
      lockState: "free",
    };

    if (ownership._tag === "Found") {
      safety = yield* observeResumeSafety({
        processId: ownership.processId,
        lockPath: lockPathForWorktree(ownership.worktree),
      });
    } else if (selected._tag === "Selected") {
      // No ownership → cannot observe lock/process honestly; fail-safe Wait
      // via unknown observations is safer for live lanes, but for Selected
      // without worktree we refuse execution. Use inactive/free so decision
      // can reach Resume, then we no-op on missing ownership.
      safety = { processState: "inactive", lockState: "free" };
    }

    const decision = decideRoundResume({
      events: roundEvents,
      runId,
      laneId,
      resumeCount,
      resumeMaxAttempts: config.resumeMaxAttempts,
      processState: safety.processState,
      lockState: safety.lockState,
    });

    if (decision._tag !== "Resume") {
      return {
        _tag: "NoMutation" as const,
        runId,
        laneId,
        decision,
        dryRun: config.dryRun,
      };
    }

    if (ownership._tag === "Missing") {
      return {
        _tag: "NoMutation" as const,
        runId,
        laneId,
        decision: { _tag: "NoOwnership" as const },
        dryRun: config.dryRun,
      };
    }

    if (config.dryRun) {
      return {
        _tag: "Planned" as const,
        runId,
        laneId,
        decision,
        worktree: ownership.worktree,
        dryRun: true as const,
      };
    }

    const execEither = yield* Effect.either(
      runResumeQueueExecution({
        plan: decision.roundPlan,
        checkpointIdentity: decision.checkpointIdentity,
        worktree: ownership.worktree,
        resumeMaxAttempts: config.resumeMaxAttempts,
        shellBinary: config.shellBinary,
        laneRunScript: config.laneRunScript,
        ...(config.queueGroup !== undefined
          ? { group: config.queueGroup }
          : {}),
      }),
    );

    if (execEither._tag === "Left") {
      return {
        _tag: "ExecutionFailed" as const,
        runId,
        laneId,
        reason: execEither.left.reason,
      };
    }

    return {
      _tag: "Executed" as const,
      runId,
      laneId,
      result: execEither.right,
    };
  });
}

/**
 * Sweep one named run or every discovered run under the state root.
 */
export function runSupervisor(input: {
  readonly mode: { readonly _tag: "Once"; readonly runId: string } | {
    readonly _tag: "All";
  };
  readonly config: SupervisorConfig;
}): Effect.Effect<
  readonly SupervisorRunResultV1[],
  never,
  SupervisorServices
> {
  return Effect.gen(function* () {
    if (input.mode._tag === "Once") {
      const runId = decodeRunId(input.mode.runId);
      if (typeof runId !== "string") {
        return [
          {
            _tag: "Missing" as const,
            runId: input.mode.runId as RunId,
          },
        ];
      }
      const one = yield* sweepOneRun(runId, input.config);
      return [one];
    }

    const discovery = yield* RunDiscovery;
    const runs = yield* discovery.listRuns();
    const results: SupervisorRunResultV1[] = [];
    for (const runId of runs) {
      results.push(yield* sweepOneRun(runId, input.config));
    }
    return results;
  });
}

/** Format a bounded deterministic status line for one lane action. */
export function formatLaneActionLine(action: SupervisorLaneActionV1): string {
  const base = `run ${String(action.runId)} lane ${String(action.laneId)}`;
  switch (action._tag) {
    case "NoMutation": {
      const d = action.decision;
      if (d._tag === "NoOwnership") {
        return `${base}: SKIP no ownership worktree`;
      }
      if (d._tag === "Completed") {
        return `${base}: COMPLETED`;
      }
      if (d._tag === "NoRound") {
        return `${base}: no prompt event`;
      }
      if (d._tag === "Wait") {
        return `${base}: WAIT ${d.reason}`;
      }
      if (d._tag === "Refused") {
        return `${base}: REFUSED ${d.reason}`;
      }
      return `${base}: noop`;
    }
    case "Planned":
      return `${base}: [dry-run] would resume worktree=${action.worktree} checkpoint=${action.decision.checkpointIdentity.commit}`;
    case "Executed": {
      const sub = action.result.submission;
      if (sub._tag === "Queued") {
        return `${base}: resumed queued task=${sub.taskId}`;
      }
      return `${base}: resumed ready-to-run`;
    }
    case "ExecutionFailed":
      return `${base}: execution failed ${action.reason}`;
    default: {
      const _e: never = action;
      void _e;
      return `${base}: unknown`;
    }
  }
}

export function formatRunResultLines(
  result: SupervisorRunResultV1,
): readonly string[] {
  switch (result._tag) {
    case "Busy":
      return [
        `run ${String(result.runId)}: .supervise.lock held by another sweep`,
      ];
    case "Missing":
      return [`run ${String(result.runId)}: no events; nothing to sweep`];
    case "Corrupt":
      return [`run ${String(result.runId)}: event log corrupt; skipped`];
    case "Swept":
      if (result.actions.length === 0) {
        return [`run ${String(result.runId)}: no events; nothing to sweep`];
      }
      return result.actions.map(formatLaneActionLine);
    default: {
      const _e: never = result;
      void _e;
      return [];
    }
  }
}

export type { QueueSubmissionV1 };
