/**
 * @foreman/orchestration — queue admission (Sprint 3 R1) and attempt-bound
 * round transaction core (Sprint 3 R2).
 *
 * Preflight, remaining orchestration ports, and thin shell adapters remain open.
 */

export {
  EXIT_OK,
  EXIT_FAIL,
  EXIT_CONFIG,
  EXIT_MISSING_CLI,
  FIXED_GROUPS,
  GROUP_RE,
  TASK_ID_RE,
  pwshQuote,
  posixQuote,
  isWindowsPueuePath,
  parseShellCommandOverride,
  quoteForShell,
  isPreAcceptRefusal,
  isEmptyAdmissionStdout,
  isRetryablePreAcceptFailure,
  parseTaskId,
  ensureGroup,
  cmdEnsure,
  cmdAdd,
  cmdStatus,
  cmdKill,
  resolvePueueClient,
  resolvePueued,
  readShellCommandOverride,
  type EnsureOptions,
  type QuoteResult,
  type ShellDialect,
  type ShellCommandParse,
  type ShellOverrideRead,
} from "./queue-admission.js";

export {
  parseQueueArgv,
  stripNodeArgv,
  runQueueCli,
  type ParsedCommand,
} from "./queue-cli.js";

export {
  ProcessExec,
  ProcessFailure,
  Sleeper,
  PathLookup,
  BoundedFs,
  EnvVars,
  MAX_CAPTURE_BYTES,
  MAX_CONFIG_BYTES,
  TIMEOUT_STATUS_PROBE_MS,
  TIMEOUT_QUEUE_OP_MS,
  liveQueueServices,
  liveProcessExec,
  terminateOwnedChild,
  readFileBoundedSync,
  type BoundedReadResult,
  type CapturedProcessResult,
  type ProcessFailureReason,
  type QueueIo,
  type RunCapturedOptions,
  type RunForegroundOptions,
  type RunIgnoredStdioOptions,
} from "./queue-services.js";

// --- Sprint 3 R2: attempt-bound round transaction core ---

export {
  MAX_COMMAND_ARGV_ENTRIES,
  MAX_COMMAND_ARG_BYTES,
  MAX_COMMAND_ARGV_TOTAL_BYTES,
  MAX_GATE_COMMAND_BYTES,
  MAX_REPORT_PATH_BYTES,
  MAX_REPORT_CONTENT_BYTES,
  ROUND_CONTRACT_FAILURE_BRAND,
  roundContractFailure,
  isRoundContractFailure,
  presentReportSnapshot,
  absentReportSnapshot,
  decodeReportSnapshotV1,
  isIncompleteReason,
  isExitCode,
  decodeCommandArgv,
  decodeRoundRequestV1,
  decodeRoundPlanV1,
  attemptIdentityFromPlan,
  decodeAttemptIdentityValue,
  decodeRoundOutcomeV1,
  decodeCheckpointIdentityV1,
  makeCheckpointIdentity,
  attemptIdentitiesEqual,
  roundOutcomesEqual,
  snapshotsEqual,
  utf8ByteLength,
  type RoundContractFailureReason,
  type RoundContractFailure,
  type ReportSnapshotPresentV1,
  type ReportSnapshotV1,
  type IncompleteReason,
  type RoundPlanV1,
  type RoundRequestV1,
  type RoundOutcomeCompletedV1,
  type RoundOutcomeIncompleteV1,
  type RoundOutcomeV1,
  type CheckpointIdentityV1,
} from "./round-contract.js";

export {
  isReportFresh,
  decideRoundOutcome,
  isPresentNonempty,
  type ReportReadFailureReason,
  type ReportReadResult,
  type OutcomeDecisionInput,
} from "./report-freshness.js";

export {
  initialRoundReducerState,
  reduceRoundEvent,
  recoverRoundAttempt,
  type RoundReducerPhase,
  type RoundReducerState,
  type RoundTransitionRejectionReason,
  type RoundTransitionResult,
  type RecoveryInvalidReason,
  type RoundRecoveryResult,
} from "./round-reducer.js";

export {
  RoundBoundaryFailure,
  AttemptAllocator,
  RoundEventSink,
  ReportSnapshotReader,
  ImplementationCommand,
  CheckpointCapture,
  GateCommand,
  runRoundTransaction,
  type RoundBoundaryFailureReason,
  type RoundEventDraft,
  type RoundTransactionServices,
} from "./round-transaction.js";
