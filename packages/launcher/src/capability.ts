/** Closed platform containment capability vocabulary. */

import { FOREMAN_LAUNCH_VERSION } from "./cli.js";

export const PIDNS_INNER_ENV = "FOREMAN_LAUNCH_PIDNS_INNER";
export const HOST_PID_ENV = "FOREMAN_LAUNCH_HOST_PID";
export const PIDNS_KIND_ENV = "FOREMAN_LAUNCH_PIDNS_KIND";

export type CapabilityKind =
  | "posix_pidns_userns_strong"
  | "posix_pidns_strong"
  | "posix_process_group_degraded"
  | "windows_job_object_unavailable";

export type StrongKind =
  | "posix_pidns_userns_strong"
  | "posix_pidns_strong";

export type CapabilityProbeReason =
  | "already_inner"
  | "unshare_missing"
  | "unshare_eperm"
  | "userns_blocked"
  | "unshare_probe_failed"
  | "execve_unavailable"
  | "execve_failed"
  | "windows_no_job_object"
  | "probe_ok"
  | "refused_by_policy";

export type ContainmentRequirement = "strong" | "any";

export type ProbeAttempt = {
  readonly flags: readonly string[];
  readonly status: number | null;
  readonly signal: string | null;
  readonly stderr: string;
};

export type PlatformCapability =
  | {
      readonly _tag: "Strong";
      readonly kind: StrongKind;
      readonly unsharePath: string;
      readonly flags: readonly string[];
      readonly hostPid: number;
      /** Attempt evidence is required by the capability record. */
      readonly attempts: readonly ProbeAttempt[];
    }
  | {
      readonly _tag: "AlreadyInner";
      readonly kind: StrongKind;
      readonly hostPid: number;
    }
  | {
      readonly _tag: "Degraded";
      readonly kind:
        | "posix_process_group_degraded"
        | "windows_job_object_unavailable";
      readonly reason: CapabilityProbeReason;
      readonly detail: string;
      readonly attempts: readonly ProbeAttempt[];
    };

export type CapabilityRecord = {
  readonly schema: "foreman-launch-capability/1";
  readonly tag: "Strong" | "AlreadyInner" | "Degraded" | "Refused";
  readonly kind: CapabilityKind;
  readonly reason: CapabilityProbeReason;
  readonly required: ContainmentRequirement;
  readonly flags: readonly string[];
  readonly detail: string;
  readonly attempts: readonly ProbeAttempt[];
  readonly launcher_pid: number;
  readonly launcher_version: string;
  readonly platform: string;
};

export type CapabilityDiagnostic = {
  readonly _tag: "CapabilityDiagnostic";
  readonly capability: PlatformCapability;
  readonly message: string;
};

export function isStrong(cap: PlatformCapability): boolean {
  return cap._tag === "Strong" || cap._tag === "AlreadyInner";
}

export function formatCapabilityDiagnostic(
  cap: PlatformCapability,
): CapabilityDiagnostic {
  switch (cap._tag) {
    case "Strong":
      return {
        _tag: "CapabilityDiagnostic",
        capability: cap,
        message: `foreman-launch: capability=${cap.kind} unshare=${cap.unsharePath} flags=${cap.flags.join(" ")} host_pid=${cap.hostPid}`,
      };
    case "AlreadyInner":
      return {
        _tag: "CapabilityDiagnostic",
        capability: cap,
        message: `foreman-launch: capability=${cap.kind} already_inner host_pid=${cap.hostPid}`,
      };
    case "Degraded":
      return {
        _tag: "CapabilityDiagnostic",
        capability: cap,
        message: `foreman-launch: DEGRADED capability=${cap.kind} reason=${cap.reason} ${cap.detail}`,
      };
  }
}

export function capabilityRecord(
  cap: PlatformCapability,
  required: ContainmentRequirement,
  launcherPid: number,
  refused: boolean,
): CapabilityRecord {
  const flags = cap._tag === "Strong" ? cap.flags : [];
  const attempts = cap._tag === "AlreadyInner" ? [] : cap.attempts;
  const reason: CapabilityProbeReason = refused
    ? "refused_by_policy"
    : cap._tag === "Strong"
      ? "probe_ok"
      : cap._tag === "AlreadyInner"
        ? "already_inner"
        : cap.reason;
  const detail =
    cap._tag === "Strong"
      ? `unshare=${cap.unsharePath}`
      : cap._tag === "AlreadyInner"
        ? "already_inner"
        : cap.detail;
  return {
    schema: "foreman-launch-capability/1",
    tag: refused ? "Refused" : cap._tag,
    kind: cap.kind,
    reason,
    required,
    flags,
    detail,
    attempts,
    launcher_pid: launcherPid,
    launcher_version: FOREMAN_LAUNCH_VERSION,
    platform: process.platform,
  };
}

export function formatRefusalLine(record: CapabilityRecord): string {
  return `foreman-launch: REFUSED capability=${record.kind} reason=${record.reason} required=strong -- no command was spawned`;
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

/** Compatibility adapter for callers of the pre-ladder pure transition. */
export function capabilityFromProbe(input: {
  readonly platform: NodeJS.Platform;
  readonly alreadyInner: boolean;
  readonly hostPid: number;
  readonly unsharePath: string | null;
  readonly probeOk: boolean;
  readonly probeDetail: string;
  readonly kind?: StrongKind;
  readonly flags?: readonly string[];
  readonly attempts?: readonly ProbeAttempt[];
}): PlatformCapability {
  if (input.platform === "win32") {
    return {
      _tag: "Degraded",
      kind: "windows_job_object_unavailable",
      reason: "windows_no_job_object",
      detail:
        "Node has no Job Object primitive in this package; tree kill uses taskkill boundary",
      attempts: [],
    };
  }
  if (input.alreadyInner) {
    return {
      _tag: "AlreadyInner",
      kind: input.kind ?? "posix_pidns_strong",
      hostPid: input.hostPid,
    };
  }
  if (input.unsharePath === null) {
    return {
      _tag: "Degraded",
      kind: "posix_process_group_degraded",
      reason: "unshare_missing",
      detail: input.probeDetail || "unshare not resolved on PATH",
      attempts: input.attempts ?? [],
    };
  }
  if (!input.probeOk) {
    return {
      _tag: "Degraded",
      kind: "posix_process_group_degraded",
      reason: "unshare_probe_failed",
      detail: input.probeDetail || "unshare probe failed",
      attempts: input.attempts ?? [],
    };
  }
  return {
    _tag: "Strong",
    kind: input.kind ?? "posix_pidns_strong",
    unsharePath: input.unsharePath,
    flags: input.flags ?? [],
    hostPid: input.hostPid,
    attempts: input.attempts ?? [],
  };
}
