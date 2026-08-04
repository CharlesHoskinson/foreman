/**
 * @foreman/orchestration — queue admission (Sprint 3 R1).
 *
 * Round ownership, recovery, preflight, and remaining orchestration ports
 * remain open.
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
