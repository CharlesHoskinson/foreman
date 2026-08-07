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
  formatCapabilityDiagnostic,
  capabilityFromProbe,
  resolveLauncherPid,
  isPidnsInner,
  type PlatformCapability,
  type CapabilityDiagnostic,
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
  UNSHARE_PIDNS_FLAGS,
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
  HeartbeatWriter,
  ByteSink,
  LauncherClock,
  DetachSpawner,
  StderrLog,
  LiveClockLayer,
  liveClock,
} from "./services.js";

export { LiveLauncherLayer } from "./services.js";
export { runMain, selfScriptArgvPrefix } from "./main.js";
