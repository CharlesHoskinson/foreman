import type { AppliancePinsV1 } from "./appliance-lock.js";

export type RootlessEngineObservationV1 = {
  readonly platform: string;
  readonly architecture: string;
  readonly kernelVersion: string;
  readonly podmanVersion: string;
  readonly dockerCompatApi: string;
  readonly serviceEndpoint: string;
  readonly packages: Readonly<Record<string, string>>;
  readonly account: {
    readonly name: string;
    readonly uid: number;
    readonly gid: number;
    readonly shell: string;
  };
  readonly subuid: {
    readonly start: number;
    readonly count: number;
    readonly overlapsProtectedIds: boolean;
  };
  readonly subgid: {
    readonly start: number;
    readonly count: number;
    readonly overlapsProtectedIds: boolean;
  };
  readonly runtimeDirectory: {
    readonly ownerUid: number;
    readonly ownerGid: number;
    readonly mode: number;
    readonly symbolicLink: boolean;
  };
  readonly dataDirectory: {
    readonly ownerUid: number;
    readonly ownerGid: number;
    readonly mode: number;
    readonly symbolicLink: boolean;
  };
  readonly tls: {
    readonly serverKeyMode: number;
    readonly mutualTlsProbePassed: boolean;
    readonly workerHasClientCredentials: boolean;
  };
  readonly protectedProbes: {
    readonly workspaceRead: boolean;
    readonly workspaceWrite: boolean;
    readonly workspaceTraverse: boolean;
    readonly stateRead: boolean;
    readonly stateWrite: boolean;
    readonly stateTraverse: boolean;
  };
  readonly fallbackSocketFound: boolean;
};

export type RootlessEngineQualificationReasonV1 =
  | "invalid_observation"
  | "unsupported_host"
  | "kernel_mismatch"
  | "version_mismatch"
  | "endpoint_mismatch"
  | "account_mismatch"
  | "subid_mismatch"
  | "path_mismatch"
  | "tls_mismatch"
  | "worker_authority"
  | "protected_path_access"
  | "fallback_socket";

export type RootlessEngineQualificationResultV1 =
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Qualified";
      readonly engine: "podman";
      readonly version: string;
      readonly endpoint: string;
      readonly architecture: "amd64" | "arm64";
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Refused";
      readonly reason: RootlessEngineQualificationReasonV1;
    };

const ROOT_KEYS = [
  "platform",
  "architecture",
  "kernelVersion",
  "podmanVersion",
  "dockerCompatApi",
  "serviceEndpoint",
  "packages",
  "account",
  "subuid",
  "subgid",
  "runtimeDirectory",
  "dataDirectory",
  "tls",
  "protectedProbes",
  "fallbackSocketFound",
] as const;
const ACCOUNT_KEYS = ["name", "uid", "gid", "shell"] as const;
const SUBID_KEYS = ["start", "count", "overlapsProtectedIds"] as const;
const DIRECTORY_KEYS = ["ownerUid", "ownerGid", "mode", "symbolicLink"] as const;
const TLS_KEYS = [
  "serverKeyMode",
  "mutualTlsProbePassed",
  "workerHasClientCredentials",
] as const;
const PROBE_KEYS = [
  "workspaceRead",
  "workspaceWrite",
  "workspaceTraverse",
  "stateRead",
  "stateWrite",
  "stateTraverse",
] as const;

function refused(
  reason: RootlessEngineQualificationReasonV1,
): RootlessEngineQualificationResultV1 {
  return { schemaVersion: 1, _tag: "Refused", reason };
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validStringRecord(value: unknown): value is Record<string, string> {
  return (
    plainObject(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function validObservation(value: unknown): value is RootlessEngineObservationV1 {
  if (!plainObject(value) || !exactKeys(value, ROOT_KEYS)) return false;
  const strings = [
    "platform",
    "architecture",
    "kernelVersion",
    "podmanVersion",
    "dockerCompatApi",
    "serviceEndpoint",
  ] as const;
  if (strings.some((key) => typeof value[key] !== "string")) return false;
  if (!validStringRecord(value["packages"])) return false;
  const account = value["account"];
  if (
    !plainObject(account) ||
    !exactKeys(account, ACCOUNT_KEYS) ||
    typeof account["name"] !== "string" ||
    !safeInteger(account["uid"]) ||
    !safeInteger(account["gid"]) ||
    typeof account["shell"] !== "string"
  ) {
    return false;
  }
  for (const name of ["subuid", "subgid"] as const) {
    const range = value[name];
    if (
      !plainObject(range) ||
      !exactKeys(range, SUBID_KEYS) ||
      !safeInteger(range["start"]) ||
      !safeInteger(range["count"]) ||
      typeof range["overlapsProtectedIds"] !== "boolean"
    ) {
      return false;
    }
  }
  for (const name of ["runtimeDirectory", "dataDirectory"] as const) {
    const directory = value[name];
    if (
      !plainObject(directory) ||
      !exactKeys(directory, DIRECTORY_KEYS) ||
      !safeInteger(directory["ownerUid"]) ||
      !safeInteger(directory["ownerGid"]) ||
      !safeInteger(directory["mode"]) ||
      typeof directory["symbolicLink"] !== "boolean"
    ) {
      return false;
    }
  }
  const tls = value["tls"];
  if (
    !plainObject(tls) ||
    !exactKeys(tls, TLS_KEYS) ||
    !safeInteger(tls["serverKeyMode"]) ||
    typeof tls["mutualTlsProbePassed"] !== "boolean" ||
    typeof tls["workerHasClientCredentials"] !== "boolean"
  ) {
    return false;
  }
  const probes = value["protectedProbes"];
  return (
    plainObject(probes) &&
    exactKeys(probes, PROBE_KEYS) &&
    PROBE_KEYS.every((key) => typeof probes[key] === "boolean") &&
    typeof value["fallbackSocketFound"] === "boolean"
  );
}

function versionParts(value: string): readonly number[] | null {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$/.exec(value);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = versionParts(actual);
  const right = versionParts(minimum);
  if (left === null || right === null) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! > right[index]!) return true;
    if (left[index]! < right[index]!) return false;
  }
  return true;
}

function sameStringRecord(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  return (
    actualKeys.length === keys.length &&
    keys.every(
      (key, index) => actualKeys[index] === key && actual[key] === expected[key],
    )
  );
}

export function qualifyRootlessEngineV1(
  pins: AppliancePinsV1,
  observation: RootlessEngineObservationV1,
): RootlessEngineQualificationResultV1 {
  try {
    if (!validObservation(observation)) return refused("invalid_observation");
    if (
      observation.platform !== "linux" ||
      !pins.rootlessEngine.supportedArchitectures.includes(
        observation.architecture as "amd64" | "arm64",
      )
    ) {
      return refused("unsupported_host");
    }
    if (!versionAtLeast(observation.kernelVersion, pins.rootlessEngine.minimumKernel)) {
      return refused("kernel_mismatch");
    }
    if (
      observation.podmanVersion !== pins.rootlessEngine.podman ||
      observation.dockerCompatApi !== pins.rootlessEngine.dockerCompatApi ||
      !sameStringRecord(observation.packages, pins.rootlessEngine.packages)
    ) {
      return refused("version_mismatch");
    }
    if (observation.serviceEndpoint !== pins.rootlessEngine.serviceEndpoint) {
      return refused("endpoint_mismatch");
    }
    const account = observation.account;
    if (
      account.name !== "foreman-engine" ||
      account.uid !== 61001 ||
      account.gid !== 61001 ||
      account.shell !== "/usr/sbin/nologin"
    ) {
      return refused("account_mismatch");
    }
    if (
      observation.subuid.start !== pins.rootlessEngine.subuid.start ||
      observation.subuid.count !== pins.rootlessEngine.subuid.count ||
      observation.subuid.overlapsProtectedIds ||
      observation.subgid.start !== pins.rootlessEngine.subgid.start ||
      observation.subgid.count !== pins.rootlessEngine.subgid.count ||
      observation.subgid.overlapsProtectedIds
    ) {
      return refused("subid_mismatch");
    }
    for (const directory of [
      observation.runtimeDirectory,
      observation.dataDirectory,
    ]) {
      if (
        directory.ownerUid !== account.uid ||
        directory.ownerGid !== account.gid ||
        directory.mode !== 0o700 ||
        directory.symbolicLink
      ) {
        return refused("path_mismatch");
      }
    }
    if (
      observation.tls.serverKeyMode !== 0o600 ||
      !observation.tls.mutualTlsProbePassed
    ) {
      return refused("tls_mismatch");
    }
    if (observation.tls.workerHasClientCredentials) {
      return refused("worker_authority");
    }
    if (Object.values(observation.protectedProbes).some(Boolean)) {
      return refused("protected_path_access");
    }
    if (observation.fallbackSocketFound) return refused("fallback_socket");
    return {
      schemaVersion: 1,
      _tag: "Qualified",
      engine: "podman",
      version: observation.podmanVersion,
      endpoint: observation.serviceEndpoint,
      architecture: observation.architecture as "amd64" | "arm64",
    };
  } catch {
    return refused("invalid_observation");
  }
}
