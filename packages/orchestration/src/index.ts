/**
 * @foreman/orchestration — queue admission (Sprint 3 R1), attempt-bound
 * round transaction core (Sprint 3 R2 / R3), typed vendor preflight
 * (Sprint 3 R4A), resume services (R5), bounded fixture-aware secret scan
 * (Sprint 3 R6), external credential-profile authority (Sprint 3 R7A), and
 * profile-bound Setup preflight (Sprint 3 R7B1). Remaining orchestration
 * ports, lane admission, profile leasing, and shell adapter seams stay open.
 */

export {
  decodeExecutionContractV1,
  executionContractSha256,
  executionMilestones,
  isExecutionContractFailure,
  strictEndstopLimits,
  type ExecutionContractFailure,
  type ExecutionContractFailureReason,
  type ExecutionContractV1,
  type ExecutionLimitsV1,
  type ExecutionMilestone,
} from "./execution-contract.js";

export {
  decideExecutionCommand,
  evolveExecution,
  executionActionKinds,
  initialExecutionState,
  isExecutionTerminal,
  type ExecutionActionKind,
  type ExecutionCommand,
  type ExecutionCounts,
  type ExecutionDecision,
  type ExecutionEvent,
  type ExecutionState,
  type ExecutionTerminalTag,
  type RunningExecutionState,
  type TerminalExecutionState,
} from "./execution-terminal-policy.js";

export {
  EndstopLedger,
  isEndstopLedgerFailure,
  makeLiveEndstopLedgerLayer,
  type EndstopExecutionResult,
  type EndstopLedgerFailure,
  type EndstopLedgerFailureReason,
} from "./execution-ledger.js";

export {
  ENDSTOP_EXIT_CONFIG,
  ENDSTOP_EXIT_FAIL,
  ENDSTOP_EXIT_OK,
  parseEndstopArgv,
  runEndstopCli,
  type EndstopCliIo,
  type ParsedEndstopArgv,
} from "./execution-guard-cli.js";

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
  OWNED_CHILD_CANCEL_WAIT_MS,
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

// --- Sprint 3 R5A: pure typed round resume decision ---

export {
  selectLatestRoundAttempt,
  decideRoundResume,
  type LatestRoundAttemptV1,
  type ResumeProcessState,
  type ResumeLockState,
  type RoundResumeDecisionV1,
  type DecideRoundResumeInput,
} from "./resume-decision.js";

// --- Sprint 3 R5B: Effect resume-safety observation services ---

export {
  MAX_LOCK_PATH_BYTES,
  classifyResumeProcess,
  classifyResumeLock,
  ResumeProcessProbe,
  ResumeLockProbe,
  observeResumeSafety,
  makeLiveResumeSafetyLayers,
  liveResumeSafetyServices,
  type ProcessProbeOutcome,
  type LockPathKind,
  type ResumeSafetyObservationV1,
  type ResumeSafetyBoundarySeams,
} from "./resume-safety-services.js";

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

// --- Sprint 3 R3: live round runtime ---

export {
  makeLiveRoundServices,
  liveReportRead,
  buildGateProcessVector,
  sanitizedCheckpointEnv,
  parseCheckpointCommit,
  CHECKPOINT_OUTPUT_BOUND_BYTES,
  type LiveRoundContext,
  type GateProcessVector,
  type ReportReadSeams,
} from "./round-live-services.js";

export {
  parseRoundArgv,
  stripRoundNodeArgv,
  preflightRoundParsed,
  isEqualOrDescendant,
  runRoundCli,
  EXIT_COMPLETED,
  EXIT_INCOMPLETE_OR_DEFECT,
  EXIT_INVALID_ARGUMENTS,
  EXIT_BOUNDARY_FAILURE,
  MSG_INVALID_ARGUMENTS,
  MSG_BOUNDARY_FAILURE,
  MSG_INTERNAL_FAILURE,
  type ParsedRoundArgv,
  type RoundPreflightResult,
  type RoundCliIo,
  type RoundCliEnv,
} from "./round-cli.js";

// --- Sprint 3 R4A: typed vendor preflight ---

export {
  VENDOR_IDS,
  VENDOR_EVIDENCE_CLASSES,
  DISCOVERABLE_VALUES,
  AUTH_VALUES,
  CURRENCY_VALUES,
  PROBE_KINDS,
  PROBE_OUTCOMES,
  REMEDIATION_KINDS,
  MAX_REASON_BYTES,
  MAX_INSTRUCTION_BYTES,
  MAX_VERSION_BYTES,
  MAX_PATH_BYTES,
  MAX_PROBE_ARGV_ENTRIES,
  MAX_PROBE_ARG_BYTES,
  MAX_PROBE_ARGV_TOTAL_BYTES,
  MAX_PROBES,
  VENDOR_PREFLIGHT_CONTRACT_FAILURE_BRAND,
  vendorPreflightContractFailure,
  isVendorPreflightContractFailure,
  isStrictUtcRfc3339,
  checkRecordConsistency,
  validateProbeArgv,
  decodeVendorPreflightRecordV1,
  recordIsFullyReady,
  type VendorId,
  type VendorEvidenceClass,
  type DiscoverableValue,
  type AuthValue,
  type CurrencyValue,
  type ProbeKind,
  type ProbeOutcome,
  type RemediationKind,
  type VendorPreflightContractFailureReason,
  type VendorPreflightContractFailure,
  type VendorFactV1,
  type ProbeRecordV1,
  type RemediationV1,
  type VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";

export {
  decodeVendorCapabilityV1,
  decodeVendorCapabilityTableV1,
  capabilityTableToCanonicalJson,
  capabilityTableDigest,
  findCapability,
  parseVendorCapabilitiesFromToml,
  FORBIDDEN_MUTATING_UPDATE_ARGV_TAILS,
  GROK_NON_MUTATING_UPDATE_CHECK_ARGV,
  argvContainsMutatingUpdate,
  type VendorCapabilityV1,
  type VendorCapabilityTableV1,
  type CapabilityParseFailure,
} from "./vendor-preflight-manifest.js";

export {
  parseFirstSemVer,
  compareSemVer,
  formatSemVer,
  classifyCurrency,
  classifyClaudeAuth,
  classifyCodexAuth,
  classifyGrokAuth,
  classifyAuthForVendor,
  decideRemediation,
  makeFact,
  buildMissingRecord,
  buildDiscoveredRecord,
  processFailureToProbeOutcome,
  type SemVer,
  type CurrencyClassification,
  type AuthClassification,
  type RemediationDecision,
} from "./vendor-preflight.js";

export {
  PREFLIGHT_PROBE_TIMEOUT_MS,
  PREFLIGHT_PROBE_OUTPUT_BOUND_BYTES,
  VendorPreflightFailure,
  PreflightClock,
  livePreflightClock,
  VendorPreflight,
  inspectVendor,
  liveVendorPreflight,
  liveVendorPreflightLayer,
  type VendorPreflightFailureReason,
  type InspectVendorOptions,
} from "./vendor-preflight-live.js";

export {
  EXIT_READY as PREFLIGHT_EXIT_READY,
  EXIT_NOT_READY as PREFLIGHT_EXIT_NOT_READY,
  EXIT_INVALID_ARGUMENTS as PREFLIGHT_EXIT_INVALID_ARGUMENTS,
  EXIT_BOUNDARY_FAILURE as PREFLIGHT_EXIT_BOUNDARY_FAILURE,
  MSG_INVALID_ARGUMENTS as PREFLIGHT_MSG_INVALID_ARGUMENTS,
  MSG_UNCONFIGURED_VENDOR as PREFLIGHT_MSG_UNCONFIGURED_VENDOR,
  MSG_BOUNDARY_FAILURE as PREFLIGHT_MSG_BOUNDARY_FAILURE,
  MSG_INTERNAL_FAILURE as PREFLIGHT_MSG_INTERNAL_FAILURE,
  stripPreflightNodeArgv,
  parsePreflightArgv,
  selectRecordedRefusalReason,
  runVendorPreflightCli,
  type PreflightCliIo,
  type ParsedPreflightArgv,
  type PreflightCliRuntime,
  type PreflightCliEnv,
} from "./vendor-preflight-cli.js";

// --- Sprint 3 R4C: persisted preflight record store ---

export {
  MAX_PREFLIGHT_RECORD_BYTES,
  PreflightStoreFailure,
  PreflightRecordStore,
  readPreflightRecord,
  writePreflightRecord,
  livePreflightRecordStore,
  type PreflightStoreFailureReason,
} from "./vendor-preflight-store.js";

export {
  TOOL_CHECK_ROW_STATUSES,
  TOOL_CHECK_ROW_VENDORS,
  MAX_TOOL_CHECK_DETAIL_BYTES,
  sanitizeToolCheckDetail,
  projectVendorPreflightToToolCheckRow,
  formatToolCheckRowTsv,
  isToolCheckRowVendorId,
  type ToolCheckRowStatus,
  type ToolCheckRowVendorId,
  type ToolCheckRowV1,
} from "./vendor-preflight-tool-check.js";

export {
  tryGetEmbeddedCapabilityTable,
  getEmbeddedCapabilityDigest,
  loadCapabilityTableFromTomlText,
} from "./vendor-preflight-embedded.js";

// --- Sprint 3 R4B2: tool-check TypeScript runtime ---

export {
  TOOL_CHECK_PROFILES,
  TOOL_CHECK_LANES,
  EXIT_READY as TOOL_CHECK_EXIT_READY,
  EXIT_NOT_READY as TOOL_CHECK_EXIT_NOT_READY,
  EXIT_INVALID_ARGUMENTS as TOOL_CHECK_EXIT_INVALID_ARGUMENTS,
  EXIT_OUTPUT_WRITE_FAILED as TOOL_CHECK_EXIT_OUTPUT_WRITE_FAILED,
  USAGE as TOOL_CHECK_USAGE,
  MSG_LANE_CLAUDE,
  stripToolCheckNodeArgv,
  parseToolCheckArgv,
  type ToolCheckProfile,
  type ToolCheckLane,
  type ParsedToolCheckArgv,
} from "./tool-check-cli.js";

export {
  buildInventoryJson,
  renderInventoryJson,
  renderReportText,
  laneReadyFromTools,
  profileToolIds,
  SKILL_IDS,
  type ToolStatus,
  type ToolRow,
  type LockAtomicityRow,
  type ToolCheckInventoryV1,
  type ReportModel,
} from "./tool-check-report.js";

export {
  detectWslFromEnv,
  checkHostClass,
  checkFsClassFromProbe,
  nearestExistingPath,
  resolveFsClass,
  type FsClass,
  type HostClass,
} from "./tool-check-platform.js";

export {
  probeMkdirOnce,
  probeFlockOnce,
  probeAtomicity,
  pickProbeRoots,
  checkPinnedVerdict,
  parsePinnedRegisterToml,
  validatePinnedTraceContent,
  countMkdirContentionViolations,
  runMkdirContentionSample,
  type AtomicityProbeResult,
  type PinnedRegisterEntry,
  type PinnedLookupHit,
  type ProbeOnce,
} from "./tool-check-atomicity.js";

export {
  checkOne,
  runToolCheck,
  resolveRepoRoot,
  writeInventoryOutAtomic,
  MAX_INVENTORY_OUT_PATH_BYTES,
  type ToolCheckIo,
  type ToolCheckRunEnv,
  type ToolCheckResult,
  type InventoryOutWriteResult,
} from "./tool-check-run.js";

// --- Sprint 3 R4B3: dependency-drift TypeScript runtime ---

export {
  EXIT_AGREE as DRIFT_EXIT_AGREE,
  EXIT_DRIFT as DRIFT_EXIT_DRIFT,
  EXIT_FAIL_CLOSED as DRIFT_EXIT_FAIL_CLOSED,
  MAX_DRIFT_INPUT_BYTES,
  PSEUDO_IDS,
  UNPROVISIONED_IDS,
  MSG_NO_DRIFT,
  MSG_DRIFT_FOOTER,
  REL_MANIFEST,
  REL_BOOTSTRAP,
  providedBy,
  buildCheckerAuthority,
  collectCheckerAuthority,
  parseManifestTools,
  reconcileDependencyDrift,
  stripDriftNodeArgv,
  runDependencyDrift,
  resolveDriftRepoRoot,
  type ManifestToolRecord,
  type CheckerAuthority,
  type ParseToolsResult,
  type ReconcileInput,
  type ReconcileResult,
  type DriftIo,
  type DriftRunOptions,
} from "./dependency-drift.js";

// --- Sprint 3 R4C2: Setup persistence TypeScript runtime ---

export {
  SETUP_PROFILES,
  SETUP_LANES,
  EXIT_READY as SETUP_EXIT_READY,
  EXIT_NOT_READY as SETUP_EXIT_NOT_READY,
  EXIT_INVALID_ARGUMENTS as SETUP_EXIT_INVALID_ARGUMENTS,
  EXIT_BOUNDARY_FAILURE as SETUP_EXIT_BOUNDARY_FAILURE,
  USAGE as SETUP_USAGE,
  MSG_BOUNDARY_FAILURE as SETUP_MSG_BOUNDARY_FAILURE,
  MSG_MISSING_PREFLIGHT_RECORD as SETUP_MSG_MISSING_PREFLIGHT_RECORD,
  MSG_INTERNAL_FAILURE as SETUP_MSG_INTERNAL_FAILURE,
  MSG_CREDENTIAL_PROFILE_REFUSED as SETUP_MSG_CREDENTIAL_PROFILE_REFUSED,
  MSG_EXPLICIT_PROFILE_UNSCOPED as SETUP_MSG_EXPLICIT_PROFILE_UNSCOPED,
  MAX_DURABLE_CONFIG_BYTES,
  stripSetupNodeArgv,
  parseSetupArgv,
  resolveSetupProfileId,
  authInstruction,
  resolveForemanHome,
  resolvePreflightRecordPath,
  parseDurableEnabledFromToml,
  launcherRunnable,
  ensurePosixLauncher,
  runForemanSetup,
  lexicalStateRootPreflight,
  ensureExternalStateRoot,
  stateRootDirectoryAnchorSupported,
  type SetupProfile,
  type SetupLane,
  type SetupIo,
  type ParsedSetupArgv,
  type LauncherEnsureResult,
  type SetupRunEnv,
  type ProfileBinding,
} from "./foreman-setup.js";

// --- Sprint 3 R5D: bounded restore and Node resume supervisor ---

export {
  WORKTREE_RESTORE_FAILURE_BRAND,
  worktreeRestoreFailure,
  isWorktreeRestoreFailure,
  buildOverlayCheckoutArgs,
  buildStatusPorcelainArgs,
  buildCommitExistsArgs,
  isPorcelainClean,
  rootIdentityKey,
  normalizeAbsoluteWorktreeInput,
  WorktreeRestore,
  RESTORE_GIT_OUTPUT_BOUND_BYTES,
  RESTORE_GIT_TIMEOUT_MS,
  makeLiveWorktreeRestore,
  makeStubWorktreeRestore,
  type WorktreeRestoreFailureReason,
  type WorktreeRestoreFailure,
  type WorktreeRestorePermitV1,
  type WorktreeRestoreResultV1,
  type WorktreeRestoreSeams,
} from "./resume-worktree-restore.js";

export {
  QUEUE_SUBMIT_FAILURE_BRAND,
  queueSubmitFailure,
  isQueueSubmitFailure,
  QueueSubmitter,
  buildLaneRunRoundVector,
  RESUME_QUEUE_EXECUTION_FAILURE_BRAND,
  resumeQueueExecutionFailure,
  isResumeQueueExecutionFailure,
  runResumeQueueExecution,
  makeLiveQueueSubmitter,
  makeStubQueueSubmitter,
  type QueueSubmissionV1,
  type QueueSubmitFailureReason,
  type QueueSubmitFailure,
  type ResumeQueueExecutionResultV1,
  type ResumeQueueExecutionFailureReason,
  type ResumeQueueExecutionFailure,
  type RunResumeQueueExecutionInput,
  type LiveQueueSubmitterOptions,
} from "./resume-queue-execution.js";

export {
  RunDiscovery,
  TypedJournalReader,
  RunLease,
  deriveOwnershipWorktree,
  sweepOneRun,
  runSupervisor,
  formatLaneActionLine,
  formatRunResultLines,
  type OwnershipWorktreeV1,
  type SupervisorLaneActionV1,
  type SupervisorRunResultV1,
  type SupervisorConfig,
  type SupervisorServices,
} from "./supervisor.js";

export {
  makeLiveTypedJournalReader,
  makeLiveRunDiscovery,
  makeLiveRunLease,
  makeLiveSupervisorServices,
  defaultSupervisorPaths,
  type LiveSupervisorContext,
  type SupervisorLiveLayer,
} from "./supervisor-live-services.js";

export {
  EXIT_OK as SUPERVISOR_EXIT_OK,
  EXIT_FAIL as SUPERVISOR_EXIT_FAIL,
  EXIT_CONFIG as SUPERVISOR_EXIT_CONFIG,
  MSG_INVALID_ARGUMENTS as SUPERVISOR_MSG_INVALID_ARGUMENTS,
  MSG_INTERNAL_FAILURE as SUPERVISOR_MSG_INTERNAL_FAILURE,
  USAGE as SUPERVISOR_USAGE,
  stripSupervisorNodeArgv,
  parseSupervisorArgv,
  runSupervisorCli,
  type SupervisorModeArgv,
  type ParsedSupervisorArgv,
  type SupervisorCliIo,
  type SupervisorCliEnv,
} from "./supervisor-cli.js";

// --- Sprint 3 R6: bounded fixture-aware secret scan ---

export {
  SECRET_SCAN_SCHEMA_VERSION,
  PRUNE_TOP_LEVEL,
  FIXTURE_SUBTREE_PREFIX,
  FIXTURE_DECLARATION_RELPATH,
  MAX_DIRECTORY_ENTRIES,
  MAX_FILES,
  MAX_RELATIVE_PATH_BYTES,
  MAX_FILE_BYTES,
  MAX_TOTAL_INSPECTED_BYTES,
  MAX_LINE_INSPECTIONS,
  MAX_EXEMPTIONS,
  MAX_FIXTURE_DECLARATION_BYTES,
  DEFAULT_SECRET_SCAN_BOUNDS,
  EXIT_CLEAN as SECRET_SCAN_EXIT_CLEAN,
  EXIT_NOT_CLEAN as SECRET_SCAN_EXIT_NOT_CLEAN,
  EXIT_INVALID_ARGUMENTS as SECRET_SCAN_EXIT_INVALID_ARGUMENTS,
  MSG_INVALID_ARGUMENTS as SECRET_SCAN_MSG_INVALID_ARGUMENTS,
  MSG_INTERNAL_FAILURE as SECRET_SCAN_MSG_INTERNAL_FAILURE,
  SecretScan,
  isSecretScanResult,
  sha256HexOfBytes,
  renderSecretScanJson,
  isRefusedSecretFilename,
  isPemPrivateKeyLine,
  secretScanDirectoryAnchorSupported,
  setSecretScanDirectoryAnchorCapabilityForTests,
  scanWorktreeSync,
  scanWorktree,
  validateSecretScanBounds,
  liveSecretScan,
  stripSecretScanNodeArgv,
  parseSecretScanArgv,
  runSecretScanCli,
  type SecretScanBounds,
  type SecretScanRefusalReason,
  type SecretScanResult,
  type SecretScanInput,
  type SecretScanCliIo,
  type ParsedSecretScanArgv,
} from "./secret-scan.js";

// --- Sprint 3 R7A: external credential-profile authority ---

export {
  CREDENTIAL_PROFILE_SCHEMA_VERSION,
  MAX_CREDENTIAL_PROFILE_RECORD_BYTES,
  PROFILE_ID_RE,
  CREDENTIAL_VENDORS,
  EXIT_OK as CREDENTIAL_PROFILE_EXIT_OK,
  EXIT_REFUSED as CREDENTIAL_PROFILE_EXIT_REFUSED,
  PROFILES_DIR_NAME,
  HOMES_DIR_NAME,
  PROFILE_JSON_NAME,
  normalizeAbsolutePath,
  isValidProfileId,
  isCredentialVendor,
  configRootRelForVendor,
  profileAuthorityDir,
  profileJsonPath,
  profileHomesDir,
  profileVendorHomeDir,
  absoluteConfigRoot,
  isEqualOrDescendant as isCredentialStateRootInWorktree,
  makeCredentialProfileRecord,
  renderCredentialProfileRecord,
  renderCredentialProfileRecordFile,
  profileIdentityOf,
  recordsEqualExact,
  decodeCredentialProfileRecordV1,
  parseCredentialProfileRecordBytes,
  isCredentialProfileResult,
  CREDENTIAL_PROFILE_REFUSAL_REASONS,
  renderCredentialProfileJson,
  CredentialProfileFs,
  liveCredentialProfileFs,
  liveCredentialProfileFsLayer,
  liveCredentialProfile,
  isIgnorableParentDirSyncError,
  WINDOWS_UNSUPPORTED_PARENT_DIR_SYNC_CODES,
  liveWriteAuthorityExclusive,
  initProfile,
  resolveProfile,
  stripCredentialProfileNodeArgv,
  parseCredentialProfileArgv,
  runCredentialProfileCli,
  writeFully as writeCredentialProfileFully,
  type CredentialVendor,
  type CredentialProfileRecordV1,
  type CredentialProfileRefusalReason,
  type CredentialProfileResult,
  type CredentialProfileInput,
  type CredentialProfileCliIo,
  type ParsedCredentialProfileArgv,
  type PathKind,
  type PathIdentity,
  type CredentialProfileFsShape,
  type CredentialProfileWriteStream,
} from "./credential-profile.js";

// --- Sprint 3 R7B1: profile-bound Setup preflight ---

export {
  CREDENTIAL_PROFILE_PREFLIGHT_SCHEMA_VERSION,
  MAX_CREDENTIAL_PROFILE_PREFLIGHT_BYTES,
  PROFILE_PREFLIGHT_DIR_NAME,
  DEFAULT_GROK_CREDENTIAL_PROFILE_ID,
  DEFAULT_CODEX_CREDENTIAL_PROFILE_ID,
  DEFAULT_CREDENTIAL_PROFILE_ID_BY_VENDOR,
  PROFILE_PREFLIGHT_DECODE_FAILURE_REASONS,
  PROFILE_PREFLIGHT_STORE_FAILURE_REASONS,
  ProfilePreflightStoreFailure,
  CredentialProfilePreflightStore,
  defaultCredentialProfileId,
  profilePreflightRecordPath,
  buildVendorHomeChildEnv,
  isProfilePreflightDecodeFailure,
  decodeCredentialProfilePreflightV1,
  renderCredentialProfilePreflight,
  renderCredentialProfilePreflightFile,
  parseCredentialProfilePreflightBytes,
  makeCredentialProfilePreflight,
  readProfilePreflightRecord,
  writeProfilePreflightRecord,
  liveCredentialProfilePreflightStore,
  profilePreflightDirectoryAnchorSupported,
  type ProfilePreflightDecodeFailureReason,
  type ProfilePreflightDecodeFailure,
  type ProfilePreflightStoreFailureReason,
  type CredentialProfilePreflightV1,
  type CredentialProfilePreflightExpected,
} from "./credential-profile-preflight.js";

// --- Sprint 3 R7B2-A: profile-bound lane admission ---

export {
  CREDENTIAL_PROFILE_LANE_REFUSAL_REASONS,
  admitCredentialProfileLane,
  type CredentialProfileLaneRefusalReason,
  type CredentialProfileLaneResult,
} from "./credential-profile-lane.js";

export {
  CREDENTIAL_PROFILE_LANE_EXIT_OK,
  CREDENTIAL_PROFILE_LANE_EXIT_REFUSED,
  parseCredentialProfileLaneArgv,
  runCredentialProfileLaneCli,
  type CredentialProfileLaneCliIo,
  type ParsedCredentialProfileLaneArgv,
} from "./credential-profile-lane-cli.js";

// --- v0.4 Track 1 Task 2: release-coverage CLI ---

export {
  runReleaseCoverageCli,
  makeLiveReleaseCoverageCliServices,
  liveReleaseCoverageCliServices,
  type ReleaseCoverageCliIo,
  type ReleaseCoverageFileReadService,
  type ReleaseCoverageOpenSpecListService,
  type ReleaseCoverageGitChangedPathsService,
  type ReleaseCoverageFamilySourceService,
  type ReleaseCoverageCliServices,
  type ReleaseCoverageLiveDependencies,
  type ReleaseCoverageChildBriefV1,
  type ReleaseCoverageFamilySourceV1,
  type ReleaseCoverageResolvedFamilyV1,
} from "./release-coverage-cli.js";
