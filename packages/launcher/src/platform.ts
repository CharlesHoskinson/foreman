/**
 * Pure platform containment planning.
 * Real image replacement goes through an injectable Execve service.
 */

import {
  HOST_PID_ENV,
  PIDNS_INNER_ENV,
  PIDNS_KIND_ENV,
  formatCapabilityDiagnostic,
  isPidnsInner,
  resolveLauncherPid,
  type CapabilityDiagnostic,
  type PlatformCapability,
  type ProbeAttempt,
  type StrongKind,
} from "./capability.js";

export { HOST_PID_ENV, PIDNS_INNER_ENV, PIDNS_KIND_ENV } from "./capability.js";

export const UNSHARE_USERNS_PIDNS_FLAGS = [
  "--user",
  "--map-current-user",
  "--pid",
  "--mount-proc",
  "--fork",
  "--kill-child",
] as const;

/** Exact unshare PID-namespace argv flags (frozen). */
export const UNSHARE_PIDNS_FLAGS = [
  "--pid",
  "--mount-proc",
  "--fork",
  "--kill-child",
] as const;

export const UNSHARE_PROBE_LADDER: readonly {
  readonly kind: StrongKind;
  readonly flags: readonly string[];
}[] = [
  {
    kind: "posix_pidns_userns_strong",
    flags: UNSHARE_USERNS_PIDNS_FLAGS,
  },
  { kind: "posix_pidns_strong", flags: UNSHARE_PIDNS_FLAGS },
];

export type ExecveRequest = {
  readonly path: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
};

export type UnshareProbeResult =
  | {
      readonly _tag: "Ok";
      readonly unsharePath: string;
      readonly kind: StrongKind;
      readonly flags: readonly string[];
      readonly attempts: readonly ProbeAttempt[];
    }
  | {
      readonly _tag: "Failed";
      readonly unsharePath: string | null;
      readonly reason:
        | "unshare_missing"
        | "unshare_eperm"
        | "userns_blocked"
        | "unshare_probe_failed";
      readonly detail: string;
      readonly attempts: readonly ProbeAttempt[];
    };

export function classifyProbeFailure(
  attempts: readonly ProbeAttempt[],
): "unshare_eperm" | "userns_blocked" | "unshare_probe_failed" {
  const isEperm = (attempt: ProbeAttempt): boolean =>
    attempt.stderr.includes("Operation not permitted");
  if (attempts[0] !== undefined && isEperm(attempts[0])) {
    return "userns_blocked";
  }
  if (attempts.some(isEperm)) return "unshare_eperm";
  return "unshare_probe_failed";
}

export function formatAttempts(attempts: readonly ProbeAttempt[]): string {
  return attempts
    .map((attempt) => {
      const status = attempt.status ?? attempt.signal ?? "null";
      return `entry=${attempt.flags.join(" ")} status=${status} stderr=${attempt.stderr}`;
    })
    .join(" | ");
}

/** Pure: argv handed to execve for pidns bootstrap. */
export function buildUnshareArgv(
  execPath: string,
  originalArgs: readonly string[],
  flags: readonly string[] = UNSHARE_PIDNS_FLAGS,
): string[] {
  return [
    "unshare",
    ...flags,
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
  readonly flags: readonly string[];
  readonly kind: StrongKind;
}): ExecveRequest {
  const argv = buildUnshareArgv(
    input.execPath,
    input.originalArgs,
    input.flags,
  );
  const env = buildExecveEnv(input.baseEnv, {
    [HOST_PID_ENV]: String(input.hostPid),
    [PIDNS_INNER_ENV]: "1",
    [PIDNS_KIND_ENV]: input.kind,
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
    const capability: PlatformCapability = {
      _tag: "Degraded",
      kind: "windows_job_object_unavailable",
      reason: "windows_no_job_object",
      detail:
        "Node has no Job Object primitive in this package; tree kill uses taskkill boundary",
      attempts: [],
    };
    return {
      capability,
      diagnostic: formatCapabilityDiagnostic(capability),
      launcherPid,
    };
  }
  if (isPidnsInner(input.env)) {
    const markedKind = input.env[PIDNS_KIND_ENV];
    const kind: StrongKind =
      markedKind === "posix_pidns_userns_strong" ||
      markedKind === "posix_pidns_strong"
        ? markedKind
        : "posix_pidns_strong";
    const capability: PlatformCapability = {
      _tag: "AlreadyInner",
      kind,
      hostPid: launcherPid,
    };
    return {
      capability,
      diagnostic: formatCapabilityDiagnostic(capability),
      launcherPid,
    };
  }
  const probe = input.probe ?? {
    _tag: "Failed" as const,
    unsharePath: null,
    reason: "unshare_missing" as const,
    detail: "probe not run",
    attempts: [],
  };
  if (probe._tag === "Ok") {
    const capability: PlatformCapability = {
      _tag: "Strong",
      kind: probe.kind,
      unsharePath: probe.unsharePath,
      flags: probe.flags,
      hostPid: input.processPid,
      attempts: probe.attempts,
    };
    return {
      capability,
      diagnostic: formatCapabilityDiagnostic(capability),
      launcherPid: input.processPid,
    };
  }
  const capability: PlatformCapability = {
    _tag: "Degraded",
    kind: "posix_process_group_degraded",
    reason: probe.reason,
    detail: probe.detail,
    attempts: probe.attempts,
  };
  return {
    capability,
    diagnostic: formatCapabilityDiagnostic(capability),
    launcherPid: input.processPid,
  };
}
