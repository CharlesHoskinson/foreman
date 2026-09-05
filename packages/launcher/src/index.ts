export {
  FOREMAN_LAUNCH_VERSION,
  EXIT_TIMEOUT,
  EXIT_LAUNCHER_ERROR,
  parseArgs,
  stripNodeArgv,
  formatVersionLine,
  mapSuperviseExit,
  usage,
  argvWithoutDetach,
  type ParsedLaunchArgs,
  type CliParseResult,
} from "./cli.js";

export {
  HEARTBEAT_KEYS,
  formatHeartbeatLine,
  buildHeartbeatLine,
  validateHeartbeatLineText,
  firstValidHeartbeatLine,
  DETACH_HANDOFF_BOUND_MS,
  type HeartbeatLine,
} from "./heartbeat.js";

export {
  PIDNS_INNER_ENV,
  HOST_PID_ENV,
  PIDNS_KIND_ENV,
  formatCapabilityDiagnostic,
  formatRefusalLine,
  capabilityRecord,
  capabilityFromProbe,
  isStrong,
  resolveLauncherPid,
  isPidnsInner,
  type PlatformCapability,
  type CapabilityDiagnostic,
  type CapabilityKind,
  type StrongKind,
  type CapabilityProbeReason,
  type ContainmentRequirement,
  type ProbeAttempt,
  type CapabilityRecord,
} from "./capability.js";

export {
  buildUnshareArgv,
  buildEnvp,
  buildExecveEnv,
  planPidnsExecve,
  planPosixDetachedSpawn,
  processGroupKillTarget,
  buildTaskkillArgv,
  planTaskkill,
  resolveCapability,
  classifyProbeFailure,
  formatAttempts,
  UNSHARE_USERNS_PIDNS_FLAGS,
  UNSHARE_PIDNS_FLAGS,
  UNSHARE_PROBE_LADDER,
  type ExecveRequest,
  type UnshareProbeResult,
} from "./platform.js";

export { supervise, type SuperviseOptions, type SuperviseResult } from "./supervise.js";

export {
  ChildSpawner,
  ProcessGroupTerminator,
  WindowsTreeTerminator,
  ExecveService,
  UnshareProbeService,
  CapabilityWriter,
  HeartbeatWriter,
  ByteSink,
  LauncherClock,
  DetachSpawner,
  StderrLog,
  LiveClockLayer,
  liveClock,
  liveUnshareProbe,
  liveCapabilityWriter,
  type CapabilityWriteError,
} from "./services.js";

export { LiveLauncherLayer } from "./services.js";
export {
  runMain,
  selfScriptArgvPrefix,
  buildSelfScriptArgvPrefix,
} from "./main.js";
