/**
 * Queue-only resume execution for R5D.
 *
 * Fixed mutation order: validate plan/checkpoint → inspect worktree →
 * reserve budget → restore → submit exact lane-run.sh --round vector.
 * Never direct-spawns when pueue is unavailable.
 */

import { Context, Effect, Layer } from "effect";
import {
  RunJournal,
  type ResumeAttemptReservationV1,
  type ResumeAttemptFailure,
  type RunJournalFailure,
} from "@foreman/event-log";
import {
  attemptIdentitiesEqual,
  attemptIdentityFromPlan,
  type CheckpointIdentityV1,
  type RoundPlanV1,
} from "./round-contract.js";
import {
  WorktreeRestore,
  type WorktreeRestoreFailure,
  type WorktreeRestorePermitV1,
  type WorktreeRestoreResultV1,
} from "./resume-worktree-restore.js";
import {
  ProcessExec,
  PathLookup,
  BoundedFs,
  EnvVars,
  Sleeper,
  TIMEOUT_QUEUE_OP_MS,
  type QueueIo,
} from "./queue-services.js";
import {
  cmdEnsure,
  EXIT_OK,
  GROUP_RE,
  parseTaskId,
  quoteForShell,
  readShellCommandOverride,
  resolvePueueClient,
} from "./queue-admission.js";

// ---------------------------------------------------------------------------
// Queue submission
// ---------------------------------------------------------------------------

export type QueueSubmissionV1 =
  | { readonly _tag: "Queued"; readonly taskId: string }
  | { readonly _tag: "Ready"; readonly commandArgv: readonly string[] };

export const QUEUE_SUBMIT_FAILURE_BRAND = Symbol(
  "@foreman/orchestration/QueueSubmitFailure",
);

type Branded = { readonly [QUEUE_SUBMIT_FAILURE_BRAND]: true };

export type QueueSubmitFailureReason =
  | "invalid_group"
  | "empty_command"
  | "queue_config"
  | "queue_failed";

export type QueueSubmitFailure = Branded & {
  readonly _tag: "QueueSubmitFailure";
  readonly reason: QueueSubmitFailureReason;
};

export function queueSubmitFailure(
  reason: QueueSubmitFailureReason,
): QueueSubmitFailure {
  return {
    [QUEUE_SUBMIT_FAILURE_BRAND]: true,
    _tag: "QueueSubmitFailure",
    reason,
  };
}

export function isQueueSubmitFailure(v: unknown): v is QueueSubmitFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [QUEUE_SUBMIT_FAILURE_BRAND]?: unknown })[
      QUEUE_SUBMIT_FAILURE_BRAND
    ] === true &&
    (v as { _tag?: unknown })._tag === "QueueSubmitFailure"
  );
}

export class QueueSubmitter extends Context.Tag("QueueSubmitter")<
  QueueSubmitter,
  {
    readonly submit: (
      group: string,
      commandArgv: readonly string[],
    ) => Effect.Effect<QueueSubmissionV1, QueueSubmitFailure>;
  }
>() {}

// ---------------------------------------------------------------------------
// Round vector
// ---------------------------------------------------------------------------

/**
 * Exact lane-run.sh --round process vector. Preserves every stored argument
 * without join, split, quote, or reconstruction of commandArgv.
 */
export function buildLaneRunRoundVector(input: {
  readonly shellBinary: string;
  readonly laneRunScript: string;
  readonly plan: RoundPlanV1;
  readonly worktree: string;
}): readonly string[] {
  return [
    input.shellBinary,
    input.laneRunScript,
    "--round",
    input.plan.gateCommand,
    input.plan.reportPath,
    String(input.plan.runId),
    String(input.plan.laneId),
    input.worktree,
    "--",
    ...input.plan.commandArgv,
  ];
}

// ---------------------------------------------------------------------------
// Execution result / failure
// ---------------------------------------------------------------------------

export type ResumeQueueExecutionResultV1 = {
  readonly reservation: ResumeAttemptReservationV1;
  readonly restore: WorktreeRestoreResultV1;
  readonly submission: QueueSubmissionV1;
  readonly commandArgv: readonly string[];
};

export const RESUME_QUEUE_EXECUTION_FAILURE_BRAND = Symbol(
  "@foreman/orchestration/ResumeQueueExecutionFailure",
);

type ExecBranded = { readonly [RESUME_QUEUE_EXECUTION_FAILURE_BRAND]: true };

export type ResumeQueueExecutionFailureReason =
  | "plan_identity_mismatch"
  | "checkpoint_identity_mismatch"
  | "inspect_failed"
  | "reserve_failed"
  | "restore_failed"
  | "submit_failed";

export type ResumeQueueExecutionFailure = ExecBranded & {
  readonly _tag: "ResumeQueueExecutionFailure";
  readonly reason: ResumeQueueExecutionFailureReason;
  readonly cause?:
    | WorktreeRestoreFailure
    | ResumeAttemptFailure
    | RunJournalFailure
    | QueueSubmitFailure;
};

export function resumeQueueExecutionFailure(
  reason: ResumeQueueExecutionFailureReason,
  cause?: ResumeQueueExecutionFailure["cause"],
): ResumeQueueExecutionFailure {
  return {
    [RESUME_QUEUE_EXECUTION_FAILURE_BRAND]: true,
    _tag: "ResumeQueueExecutionFailure",
    reason,
    ...(cause !== undefined ? { cause } : {}),
  };
}

export function isResumeQueueExecutionFailure(
  v: unknown,
): v is ResumeQueueExecutionFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [RESUME_QUEUE_EXECUTION_FAILURE_BRAND]?: unknown })[
      RESUME_QUEUE_EXECUTION_FAILURE_BRAND
    ] === true &&
    (v as { _tag?: unknown })._tag === "ResumeQueueExecutionFailure"
  );
}

export type RunResumeQueueExecutionInput = {
  readonly plan: RoundPlanV1;
  readonly checkpointIdentity: CheckpointIdentityV1;
  readonly worktree: string;
  readonly resumeMaxAttempts: number;
  readonly shellBinary: string;
  readonly laneRunScript: string;
  /** Queue group (default misc). */
  readonly group?: string;
};

/**
 * Strict inspect → reserve → restore → submit. A failed reserve stops before
 * restore and queue. A successful reservation remains durable if later steps
 * fail.
 */
export function runResumeQueueExecution(
  input: RunResumeQueueExecutionInput,
): Effect.Effect<
  ResumeQueueExecutionResultV1,
  ResumeQueueExecutionFailure,
  WorktreeRestore | RunJournal | QueueSubmitter
> {
  return Effect.gen(function* () {
    const planIdentity = attemptIdentityFromPlan(input.plan);
    if (
      !attemptIdentitiesEqual(
        planIdentity,
        input.checkpointIdentity.attemptIdentity,
      )
    ) {
      return yield* Effect.fail(
        resumeQueueExecutionFailure("checkpoint_identity_mismatch"),
      );
    }

    // 1–2. Validate identities; inspect worktree and checkpoint first.
    const restoreSvc = yield* WorktreeRestore;
    const permitEither = yield* Effect.either(
      restoreSvc.inspect({
        worktree: input.worktree,
        checkpointIdentity: input.checkpointIdentity,
      }),
    );
    if (permitEither._tag === "Left") {
      return yield* Effect.fail(
        resumeQueueExecutionFailure("inspect_failed", permitEither.left),
      );
    }
    const permit: WorktreeRestorePermitV1 = permitEither.right;

    // 3. Atomically reserve resume budget.
    const journal = yield* RunJournal;
    const reserveEither = yield* Effect.either(
      journal.reserveResumeAttempt(
        input.checkpointIdentity.attemptIdentity,
        input.resumeMaxAttempts,
      ),
    );
    if (reserveEither._tag === "Left") {
      return yield* Effect.fail(
        resumeQueueExecutionFailure("reserve_failed", reserveEither.left),
      );
    }
    const reservation = reserveEither.right;

    // 4. Restore exact checkpoint.
    const restoreEither = yield* Effect.either(
      restoreSvc.restore({ permit, reservation }),
    );
    if (restoreEither._tag === "Left") {
      return yield* Effect.fail(
        resumeQueueExecutionFailure("restore_failed", restoreEither.left),
      );
    }
    const restoreResult = restoreEither.right;

    // 5. Submit exact lane-run.sh --round vector.
    const commandArgv = buildLaneRunRoundVector({
      shellBinary: input.shellBinary,
      laneRunScript: input.laneRunScript,
      plan: input.plan,
      worktree: restoreResult.worktreeRoot,
    });
    const submitter = yield* QueueSubmitter;
    const group = input.group ?? "misc";
    const submitEither = yield* Effect.either(
      submitter.submit(group, commandArgv),
    );
    if (submitEither._tag === "Left") {
      return yield* Effect.fail(
        resumeQueueExecutionFailure("submit_failed", submitEither.left),
      );
    }

    return {
      reservation,
      restore: restoreResult,
      submission: submitEither.right,
      commandArgv,
    };
  });
}

// ---------------------------------------------------------------------------
// Live QueueSubmitter — queue only; Ready when pueue unavailable
// ---------------------------------------------------------------------------

export type LiveQueueSubmitterOptions = {
  readonly io?: QueueIo;
};

const silentIo: QueueIo = {
  writeStdout: () => undefined,
  writeStderr: () => undefined,
};

type QueueServices =
  | ProcessExec
  | Sleeper
  | PathLookup
  | BoundedFs
  | EnvVars;

/**
 * Live queue submitter. Ready only when the client is explicitly missing
 * before admission. A resolved client with a nonzero ensure result is an
 * unhealthy or indeterminate queue and fails closed. Never calls
 * ProcessExec.runForeground.
 */
export function makeLiveQueueSubmitter(
  options?: LiveQueueSubmitterOptions,
): Layer.Layer<QueueSubmitter, never, QueueServices> {
  const io = options?.io ?? silentIo;

  return Layer.effect(
    QueueSubmitter,
    Effect.gen(function* () {
      const proc = yield* ProcessExec;
      const sleeper = yield* Sleeper;
      const paths = yield* PathLookup;
      const fs = yield* BoundedFs;
      const env = yield* EnvVars;

      const provideQueue = <A, E>(
        effect: Effect.Effect<A, E, QueueServices>,
      ): Effect.Effect<A, E> =>
        effect.pipe(
          Effect.provideService(ProcessExec, proc),
          Effect.provideService(Sleeper, sleeper),
          Effect.provideService(PathLookup, paths),
          Effect.provideService(BoundedFs, fs),
          Effect.provideService(EnvVars, env),
        );

      return {
        submit: (
          group: string,
          commandArgv: readonly string[],
        ): Effect.Effect<QueueSubmissionV1, QueueSubmitFailure> =>
          provideQueue(
            Effect.gen(function* () {
              if (!GROUP_RE.test(group)) {
                return yield* Effect.fail(queueSubmitFailure("invalid_group"));
              }
              if (commandArgv.length === 0) {
                return yield* Effect.fail(queueSubmitFailure("empty_command"));
              }

              const readyVector = (): QueueSubmissionV1 => ({
                _tag: "Ready",
                commandArgv: [...commandArgv],
              });

              // Ready only for an explicit missing-client observation before
              // admission. A present client with a failed ensure is not Ready.
              const pueueBin = yield* resolvePueueClient;
              if (pueueBin === null) {
                return readyVector();
              }

              const ensureCode = yield* cmdEnsure(io, { quiet: true });
              if (ensureCode !== EXIT_OK) {
                return yield* Effect.fail(queueSubmitFailure("queue_failed"));
              }

              // Re-resolve after ensure — race to absent → Ready, never spawn.
              const pueueBin2 = yield* resolvePueueClient;
              if (pueueBin2 === null) {
                return readyVector();
              }

              const exeSibling = pueueBin2 + ".exe";
              const hasExeSibling = yield* paths.fileExists(exeSibling);
              const fileExists = (p: string): boolean =>
                p === exeSibling ? hasExeSibling : false;

              const shellRead = yield* readShellCommandOverride;
              if (
                shellRead._tag === "ConfigError" ||
                shellRead._tag === "Override"
              ) {
                return yield* Effect.fail(queueSubmitFailure("queue_config"));
              }

              const quoted = quoteForShell(
                pueueBin2,
                commandArgv,
                null,
                fileExists,
              );
              if (!quoted.ok) {
                return yield* Effect.fail(queueSubmitFailure("queue_config"));
              }

              // Direct pueue add via runCaptured only — never runForeground.
              // Once add is attempted, any transport error, nonzero exit, or
              // malformed task id is indeterminate: fail closed. Never return
              // Ready after admission (could duplicate a daemon-accepted task).
              const addEither = yield* Effect.either(
                proc.runCaptured({
                  command: pueueBin2,
                  args: [
                    "add",
                    "--group",
                    group,
                    "--print-task-id",
                    "--",
                    ...quoted.argv,
                  ],
                  timeoutMs: TIMEOUT_QUEUE_OP_MS,
                }),
              );
              if (addEither._tag === "Left") {
                return yield* Effect.fail(queueSubmitFailure("queue_failed"));
              }
              const result = addEither.right;
              if (result.exitCode !== 0) {
                return yield* Effect.fail(queueSubmitFailure("queue_failed"));
              }
              const taskId = parseTaskId(result.stdout);
              if (taskId === null) {
                return yield* Effect.fail(queueSubmitFailure("queue_failed"));
              }
              return { _tag: "Queued" as const, taskId };
            }),
          ),
      };
    }),
  );
}

/**
 * Stub QueueSubmitter for deterministic tests.
 */
export function makeStubQueueSubmitter(impl: {
  readonly submit: (
    group: string,
    commandArgv: readonly string[],
  ) => Effect.Effect<QueueSubmissionV1, QueueSubmitFailure>;
}): Layer.Layer<QueueSubmitter> {
  return Layer.succeed(QueueSubmitter, impl);
}
