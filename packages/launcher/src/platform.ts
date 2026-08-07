/**
 * Pure platform containment planning.
 * Real image replacement goes through an injectable Execve service.
 */

import {
  HOST_PID_ENV,
  PIDNS_INNER_ENV,
  capabilityFromProbe,
  formatCapabilityDiagnostic,
  isPidnsInner,
  resolveLauncherPid,
  type CapabilityDiagnostic,
  type PlatformCapability,
} from "./capability.js";

export { HOST_PID_ENV, PIDNS_INNER_ENV } from "./capability.js";

/** Exact unshare PID-namespace argv flags (frozen). */
export const UNSHARE_PIDNS_FLAGS = [
  "--pid",
  "--mount-proc",
  "--fork",
  "--kill-child",
] as const;

export type ExecveRequest = {
  readonly path: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
};

export type UnshareProbeResult =
  | { readonly _tag: "Ok"; readonly unsharePath: string }
  | {
      readonly _tag: "Failed";
      readonly unsharePath: string | null;
      readonly detail: string;
    };

/** Pure: argv handed to execve for pidns bootstrap. */
export function buildUnshareArgv(
  execPath: string,
  originalArgs: readonly string[],
): string[] {
  return [
    "unshare",
    ...UNSHARE_PIDNS_FLAGS,
    "--",
    execPath,
    ...originalArgs,
  ];
}

/** Pure: env map for execve (explicit; not ambient-only). */
export function buildExecveEnv(
  baseEnv: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string>>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v !== undefined) merged[k] = v;
  }
  Object.assign(merged, overrides);
  return merged;
}

/** Legacy envp string form for tests that assert key=value list. */
export function buildEnvp(
  baseEnv: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string>>,
): string[] {
  return Object.entries(buildExecveEnv(baseEnv, overrides)).map(
    ([k, v]) => `${k}=${v}`,
  );
}

/** Pure plan for strong-path image replacement. Never performs execve. */
export function planPidnsExecve(input: {
  readonly unsharePath: string;
  readonly execPath: string;
  readonly originalArgs: readonly string[];
  readonly hostPid: number;
  readonly baseEnv: NodeJS.ProcessEnv;
}): ExecveRequest {
  const argv = buildUnshareArgv(input.execPath, input.originalArgs);
  const env = buildExecveEnv(input.baseEnv, {
    [HOST_PID_ENV]: String(input.hostPid),
    [PIDNS_INNER_ENV]: "1",
  });
  return {
    path: input.unsharePath,
    argv,
    env,
  };
}

/** POSIX degraded spawn plan: detached process group leader. */
export type PosixSpawnPlan = {
  readonly mode: "detached_process_group";
  readonly file: string;
  readonly args: readonly string[];
  readonly argv0: string;
};

export function planPosixDetachedSpawn(
  cmd: readonly string[],
): PosixSpawnPlan {
  if (cmd.length === 0) {
    throw new Error("empty command");
  }
  const file = cmd[0]!;
  return {
    mode: "detached_process_group",
    file,
    args: cmd.slice(1),
    argv0: file,
  };
}

/** Negative-PID process-group signal target. */
export function processGroupKillTarget(leaderPid: number): number {
  return -leaderPid;
}

/** Windows tree-termination argv behind injectable host boundary. */
export function buildTaskkillArgv(pid: number): readonly string[] {
  return ["taskkill.exe", "/PID", String(pid), "/T", "/F"];
}

export type TaskkillRequest = {
  readonly executable: "taskkill.exe";
  readonly argv: readonly string[];
  readonly pid: number;
};

export function planTaskkill(pid: number): TaskkillRequest {
  return {
    executable: "taskkill.exe",
    argv: buildTaskkillArgv(pid),
    pid,
  };
}

/**
 * Resolve capability from probe without side effects beyond the probe result.
 */
export function resolveCapability(input: {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly processPid: number;
  readonly probe: UnshareProbeResult | null;
}): {
  readonly capability: PlatformCapability;
  readonly diagnostic: CapabilityDiagnostic;
  readonly launcherPid: number;
} {
  const launcherPid = resolveLauncherPid(input.env, input.processPid);
  if (input.platform === "win32") {
    const capability = capabilityFromProbe({
      platform: "win32",
      alreadyInner: false,
      hostPid: launcherPid,
      unsharePath: null,
      probeOk: false,
      probeDetail: "windows",
    });
    return {
      capability,
      diagnostic: formatCapabilityDiagnostic(capability),
      launcherPid,
    };
  }
  if (isPidnsInner(input.env)) {
    const capability = capabilityFromProbe({
      platform: input.platform,
      alreadyInner: true,
      hostPid: launcherPid,
      unsharePath: null,
      probeOk: true,
      probeDetail: "already_inner",
    });
    return {
      capability,
      diagnostic: formatCapabilityDiagnostic(capability),
      launcherPid,
    };
  }
  const probe = input.probe ?? {
    _tag: "Failed" as const,
    unsharePath: null,
    detail: "probe not run",
  };
  if (probe._tag === "Ok") {
    const capability = capabilityFromProbe({
      platform: input.platform,
      alreadyInner: false,
      hostPid: input.processPid,
      unsharePath: probe.unsharePath,
      probeOk: true,
      probeDetail: "probe_ok",
    });
    return {
      capability,
      diagnostic: formatCapabilityDiagnostic(capability),
      launcherPid: input.processPid,
    };
  }
  const capability = capabilityFromProbe({
    platform: input.platform,
    alreadyInner: false,
    hostPid: input.processPid,
    unsharePath: probe.unsharePath,
    probeOk: false,
    probeDetail: probe.detail,
  });
  return {
    capability,
    diagnostic: formatCapabilityDiagnostic(capability),
    launcherPid: input.processPid,
  };
}
