/**
 * Closed platform containment capability vocabulary.
 * Capability is resolved before spawn and never claims unavailable parity.
 */

export const PIDNS_INNER_ENV = "FOREMAN_LAUNCH_PIDNS_INNER";
export const HOST_PID_ENV = "FOREMAN_LAUNCH_HOST_PID";

export type CapabilityKind =
  | "posix_pidns_strong"
  | "posix_process_group_degraded"
  | "windows_job_object_unavailable";

export type CapabilityProbeReason =
  | "already_inner"
  | "unshare_missing"
  | "unshare_probe_failed"
  | "execve_unavailable"
  | "execve_failed"
  | "windows_no_job_object"
  | "probe_ok";

export type PlatformCapability =
  | {
      readonly _tag: "Strong";
      readonly kind: "posix_pidns_strong";
      readonly unsharePath: string;
      readonly hostPid: number;
    }
  | {
      readonly _tag: "Degraded";
      readonly kind: "posix_process_group_degraded" | "windows_job_object_unavailable";
      readonly reason: CapabilityProbeReason;
      readonly detail: string;
    }
  | {
      readonly _tag: "AlreadyInner";
      readonly kind: "posix_pidns_strong";
      readonly hostPid: number;
    };

export type CapabilityDiagnostic = {
  readonly _tag: "CapabilityDiagnostic";
  readonly capability: PlatformCapability;
  /** Bounded single-line diagnostic for stderr only. */
  readonly message: string;
};

export function formatCapabilityDiagnostic(
  cap: PlatformCapability,
): CapabilityDiagnostic {
  switch (cap._tag) {
    case "Strong":
      return {
        _tag: "CapabilityDiagnostic",
        capability: cap,
        message: `foreman-launch: capability=posix_pidns_strong unshare=${cap.unsharePath} host_pid=${cap.hostPid}`,
      };
    case "AlreadyInner":
      return {
        _tag: "CapabilityDiagnostic",
        capability: cap,
        message: `foreman-launch: capability=posix_pidns_strong already_inner host_pid=${cap.hostPid}`,
      };
    case "Degraded":
      return {
        _tag: "CapabilityDiagnostic",
        capability: cap,
        message: `foreman-launch: DEGRADED capability=${cap.kind} reason=${cap.reason} ${cap.detail}`,
      };
  }
}

export function resolveLauncherPid(
  env: NodeJS.ProcessEnv,
  processPid: number,
): number {
  const raw = env[HOST_PID_ENV];
  if (raw === undefined || raw === "") return processPid;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return processPid;
  return n;
}

export function isPidnsInner(env: NodeJS.ProcessEnv): boolean {
  return env[PIDNS_INNER_ENV] === "1";
}

/** Pure transition: probe outcomes to closed capability. */
export function capabilityFromProbe(input: {
  readonly platform: NodeJS.Platform;
  readonly alreadyInner: boolean;
  readonly hostPid: number;
  readonly unsharePath: string | null;
  readonly probeOk: boolean;
  readonly probeDetail: string;
}): PlatformCapability {
  if (input.platform === "win32") {
    return {
      _tag: "Degraded",
      kind: "windows_job_object_unavailable",
      reason: "windows_no_job_object",
      detail:
        "Node has no Job Object primitive in this package; tree kill uses taskkill boundary",
    };
  }
  if (input.alreadyInner) {
    return {
      _tag: "AlreadyInner",
      kind: "posix_pidns_strong",
      hostPid: input.hostPid,
    };
  }
  if (input.unsharePath === null) {
    return {
      _tag: "Degraded",
      kind: "posix_process_group_degraded",
      reason: "unshare_missing",
      detail: input.probeDetail || "unshare not resolved on PATH",
    };
  }
  if (!input.probeOk) {
    return {
      _tag: "Degraded",
      kind: "posix_process_group_degraded",
      reason: "unshare_probe_failed",
      detail: input.probeDetail || "unshare probe failed",
    };
  }
  return {
    _tag: "Strong",
    kind: "posix_pidns_strong",
    unsharePath: input.unsharePath,
    hostPid: input.hostPid,
  };
}
