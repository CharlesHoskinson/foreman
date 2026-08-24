import {
  canonicalize,
  decodeUtf8Fatal,
  isCoreFailure,
  parseJsonRejectDuplicateKeys,
} from "@foreman/core";

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const PACKAGE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+:~_-]*$/;
const CONTROL = /[\u0000-\u001f\u007f]/u;

const APPLIANCE_KEYS = [
  "schema_version",
  "dockerfile_frontend",
  "control_base",
  "control_base_linux_amd64",
  "control_base_linux_arm64",
  "node_version",
  "npm_version",
  "codex_version",
  "grok_version",
  "graphify_version",
  "graphify_wheel_sha256",
  "buildx_version",
  "source_date_epoch",
  "supported_platforms",
  "apt_bash",
  "apt_ca_certificates",
  "apt_curl",
  "apt_git",
  "apt_gosu",
  "apt_ipset",
  "apt_iptables",
  "apt_jq",
  "apt_openssh_client",
  "apt_python3",
  "apt_python3_pip",
  "apt_tini",
] as const;

const ROOTLESS_KEYS = [
  "podman_version",
  "docker_compat_api",
  "service_endpoint",
  "minimum_kernel",
  "supported_architectures",
  "package_podman",
  "package_conmon",
  "package_crun",
  "package_fuse_overlayfs",
  "package_passt",
  "package_netavark",
  "package_aardvark_dns",
  "package_uidmap",
  "subuid_start",
  "subuid_count",
  "subgid_start",
  "subgid_count",
] as const;

const QDRANT_KEYS = [
  "version",
  "source_commit",
  "image_index",
  "image_linux_amd64",
  "image_linux_arm64",
  "client",
  "client_integrity",
] as const;

type TomlValue = string | number | readonly string[];
type TomlTable = Readonly<Record<string, TomlValue>>;

export type AppliancePinsV1 = {
  readonly schemaVersion: 1;
  readonly build: {
    readonly dockerfileFrontend: string;
    readonly controlBase: string;
    readonly controlBaseLinuxAmd64: string;
    readonly controlBaseLinuxArm64: string;
    readonly buildxVersion: string;
    readonly sourceDateEpoch: "git-commit";
    readonly supportedPlatforms: readonly ["linux/amd64", "linux/arm64"];
  };
  readonly tools: {
    readonly node: string;
    readonly npm: string;
    readonly codex: string;
    readonly grok: string;
    readonly graphify: string;
    readonly graphifyWheelSha256: string;
  };
  readonly osPackages: Readonly<Record<string, string>>;
  readonly rootlessEngine: {
    readonly podman: string;
    readonly dockerCompatApi: string;
    readonly serviceEndpoint: "127.0.0.1:18443";
    readonly minimumKernel: string;
    readonly supportedArchitectures: readonly ["amd64", "arm64"];
    readonly packages: Readonly<Record<string, string>>;
    readonly subuid: { readonly start: number; readonly count: number };
    readonly subgid: { readonly start: number; readonly count: number };
  };
  readonly semanticMemory: {
    readonly qdrantVersion: string;
    readonly qdrantImageIndex: string;
    readonly qdrantImageLinuxAmd64: string;
    readonly qdrantImageLinuxArm64: string;
  };
};

export type AppliancePinsResultV1 =
  | { readonly _tag: "Valid"; readonly value: AppliancePinsV1 }
  | { readonly _tag: "Invalid" };

export type ApplianceLockValidationResultV1 =
  | { readonly _tag: "Valid" }
  | { readonly _tag: "Invalid" };

export type ApplianceLockDecodeResultV1 = AppliancePinsResultV1;

function invalid(): { readonly _tag: "Invalid" } {
  return { _tag: "Invalid" };
}

function parseTomlValue(raw: string): TomlValue | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (
      typeof parsed === "number" &&
      Number.isSafeInteger(parsed) &&
      parsed >= 0
    ) {
      return parsed;
    }
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function readTables(text: string): ReadonlyMap<string, TomlTable> | null {
  if (CONTROL.test(text.replaceAll("\n", ""))) return null;
  const wanted = new Set([
    "release_dependencies.appliance",
    "release_dependencies.rootless_engine",
    "release_dependencies.qdrant",
  ]);
  const mutable = new Map<string, Record<string, TomlValue>>();
  let current: string | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header !== null) {
      const name = header[1]!;
      current = wanted.has(name) ? name : null;
      if (current !== null) {
        if (mutable.has(current)) return null;
        mutable.set(current, Object.create(null) as Record<string, TomlValue>);
      }
      continue;
    }
    if (current === null) continue;
    const assignment = /^([a-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (assignment === null) return null;
    const key = assignment[1]!;
    const table = mutable.get(current)!;
    if (Object.hasOwn(table, key)) return null;
    const value = parseTomlValue(assignment[2]!);
    if (value === null) return null;
    table[key] = value;
  }
  return mutable;
}

function exactTable(
  tables: ReadonlyMap<string, TomlTable>,
  name: string,
  keys: readonly string[],
): TomlTable | null {
  const table = tables.get(name);
  if (table === undefined) return null;
  const actual = Object.keys(table).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return null;
  }
  return table;
}

function stringAt(table: TomlTable, key: string): string | null {
  const value = table[key];
  return typeof value === "string" && value.length > 0 && !CONTROL.test(value)
    ? value
    : null;
}

function integerAt(table: TomlTable, key: string): number | null {
  const value = table[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function stringArrayAt(table: TomlTable, key: string): readonly string[] | null {
  const value = table[key];
  if (!Array.isArray(value) || value.some((item) => CONTROL.test(item))) {
    return null;
  }
  return value;
}

function exactSemver(value: string | null): value is string {
  return value !== null && SEMVER.test(value);
}

function exactPackageVersion(value: string | null): value is string {
  return value !== null && PACKAGE_VERSION.test(value);
}

function pinnedImage(value: string | null): value is string {
  if (value === null || value.includes("latest")) return false;
  const split = value.lastIndexOf("@");
  return split > 0 && SHA256.test(value.slice(split + 1));
}

function plainDigest(value: string | null): value is string {
  return value !== null && SHA256.test(value);
}

function sameArray(
  value: readonly string[] | null,
  expected: readonly string[],
): boolean {
  return (
    value !== null &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function exactStringArray(
  value: unknown,
  expected: readonly string[],
): boolean {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string") &&
    sameArray(value, expected)
  );
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function validStringRecord(
  value: unknown,
  keys: readonly string[],
): value is Readonly<Record<string, string>> {
  return (
    plainObject(value) &&
    hasExactKeys(value, keys) &&
    keys.every((key) =>
      exactPackageVersion(
        typeof value[key] === "string" ? value[key] : null,
      ),
    )
  );
}

function parsePinsObject(value: unknown): AppliancePinsV1 | null {
  if (
    !plainObject(value) ||
    !hasExactKeys(value, [
      "build",
      "osPackages",
      "rootlessEngine",
      "schemaVersion",
      "semanticMemory",
      "tools",
    ]) ||
    value["schemaVersion"] !== 1
  ) {
    return null;
  }
  const build = value["build"];
  const tools = value["tools"];
  const osPackages = value["osPackages"];
  const rootless = value["rootlessEngine"];
  const semantic = value["semanticMemory"];
  if (
    !plainObject(build) ||
    !hasExactKeys(build, [
      "buildxVersion",
      "controlBase",
      "controlBaseLinuxAmd64",
      "controlBaseLinuxArm64",
      "dockerfileFrontend",
      "sourceDateEpoch",
      "supportedPlatforms",
    ]) ||
    !exactSemver(typeof build["buildxVersion"] === "string" ? build["buildxVersion"] : null) ||
    !pinnedImage(typeof build["controlBase"] === "string" ? build["controlBase"] : null) ||
    !plainDigest(typeof build["controlBaseLinuxAmd64"] === "string" ? build["controlBaseLinuxAmd64"] : null) ||
    !plainDigest(typeof build["controlBaseLinuxArm64"] === "string" ? build["controlBaseLinuxArm64"] : null) ||
    !pinnedImage(typeof build["dockerfileFrontend"] === "string" ? build["dockerfileFrontend"] : null) ||
    build["sourceDateEpoch"] !== "git-commit" ||
    !exactStringArray(build["supportedPlatforms"], [
      "linux/amd64",
      "linux/arm64",
    ])
  ) {
    return null;
  }
  if (
    !plainObject(tools) ||
    !hasExactKeys(tools, [
      "codex",
      "graphify",
      "graphifyWheelSha256",
      "grok",
      "node",
      "npm",
    ]) ||
    !exactSemver(typeof tools["node"] === "string" ? tools["node"] : null) ||
    !exactSemver(typeof tools["npm"] === "string" ? tools["npm"] : null) ||
    !exactSemver(typeof tools["codex"] === "string" ? tools["codex"] : null) ||
    !exactSemver(typeof tools["grok"] === "string" ? tools["grok"] : null) ||
    !exactSemver(typeof tools["graphify"] === "string" ? tools["graphify"] : null) ||
    typeof tools["graphifyWheelSha256"] !== "string" ||
    !/^[0-9a-f]{64}$/.test(tools["graphifyWheelSha256"])
  ) {
    return null;
  }
  const osPackageNames = [
    "bash",
    "ca-certificates",
    "curl",
    "git",
    "gosu",
    "ipset",
    "iptables",
    "jq",
    "openssh-client",
    "python3",
    "python3-pip",
    "tini",
  ] as const;
  if (!validStringRecord(osPackages, osPackageNames)) return null;
  if (
    !plainObject(rootless) ||
    !hasExactKeys(rootless, [
      "dockerCompatApi",
      "minimumKernel",
      "packages",
      "podman",
      "serviceEndpoint",
      "subgid",
      "subuid",
      "supportedArchitectures",
    ]) ||
    !exactSemver(typeof rootless["podman"] === "string" ? rootless["podman"] : null) ||
    rootless["dockerCompatApi"] !== "1.40" ||
    !exactSemver(typeof rootless["minimumKernel"] === "string" ? rootless["minimumKernel"] : null) ||
    rootless["serviceEndpoint"] !== "127.0.0.1:18443" ||
    !exactStringArray(rootless["supportedArchitectures"], ["amd64", "arm64"]) ||
    !validStringRecord(rootless["packages"], [
      "aardvark-dns",
      "conmon",
      "crun",
      "fuse-overlayfs",
      "netavark",
      "passt",
      "podman",
      "uidmap",
    ])
  ) {
    return null;
  }
  const parseRange = (candidate: unknown): { start: number; count: number } | null => {
    if (
      !plainObject(candidate) ||
      !hasExactKeys(candidate, ["count", "start"]) ||
      !Number.isSafeInteger(candidate["start"]) ||
      typeof candidate["start"] !== "number" ||
      candidate["start"] <= 0 ||
      candidate["count"] !== 65_536
    ) {
      return null;
    }
    return { start: candidate["start"], count: 65_536 };
  };
  const subuid = parseRange(rootless["subuid"]);
  const subgid = parseRange(rootless["subgid"]);
  if (subuid === null || subgid === null) return null;
  if (
    !plainObject(semantic) ||
    !hasExactKeys(semantic, [
      "qdrantImageIndex",
      "qdrantImageLinuxAmd64",
      "qdrantImageLinuxArm64",
      "qdrantVersion",
    ]) ||
    !exactSemver(typeof semantic["qdrantVersion"] === "string" ? semantic["qdrantVersion"] : null) ||
    !plainDigest(typeof semantic["qdrantImageIndex"] === "string" ? semantic["qdrantImageIndex"] : null) ||
    !plainDigest(typeof semantic["qdrantImageLinuxAmd64"] === "string" ? semantic["qdrantImageLinuxAmd64"] : null) ||
    !plainDigest(typeof semantic["qdrantImageLinuxArm64"] === "string" ? semantic["qdrantImageLinuxArm64"] : null)
  ) {
    return null;
  }
  return value as unknown as AppliancePinsV1;
}

export function parseAppliancePinsV1(text: string): AppliancePinsResultV1 {
  try {
    const tables = readTables(text);
    if (tables === null) return invalid();
    const appliance = exactTable(
      tables,
      "release_dependencies.appliance",
      APPLIANCE_KEYS,
    );
    const rootless = exactTable(
      tables,
      "release_dependencies.rootless_engine",
      ROOTLESS_KEYS,
    );
    const qdrant = exactTable(
      tables,
      "release_dependencies.qdrant",
      QDRANT_KEYS,
    );
    if (appliance === null || rootless === null || qdrant === null) {
      return invalid();
    }

    const schemaVersion = appliance["schema_version"];
    const dockerfileFrontend = stringAt(appliance, "dockerfile_frontend");
    const controlBase = stringAt(appliance, "control_base");
    const controlBaseLinuxAmd64 = stringAt(
      appliance,
      "control_base_linux_amd64",
    );
    const controlBaseLinuxArm64 = stringAt(
      appliance,
      "control_base_linux_arm64",
    );
    const node = stringAt(appliance, "node_version");
    const npm = stringAt(appliance, "npm_version");
    const codex = stringAt(appliance, "codex_version");
    const grok = stringAt(appliance, "grok_version");
    const graphify = stringAt(appliance, "graphify_version");
    const graphifyWheel = stringAt(appliance, "graphify_wheel_sha256");
    const buildx = stringAt(appliance, "buildx_version");
    const sourceDateEpoch = stringAt(appliance, "source_date_epoch");
    const platforms = stringArrayAt(appliance, "supported_platforms");

    const podman = stringAt(rootless, "podman_version");
    const api = stringAt(rootless, "docker_compat_api");
    const endpoint = stringAt(rootless, "service_endpoint");
    const kernel = stringAt(rootless, "minimum_kernel");
    const architectures = stringArrayAt(rootless, "supported_architectures");
    const subuidStart = integerAt(rootless, "subuid_start");
    const subuidCount = integerAt(rootless, "subuid_count");
    const subgidStart = integerAt(rootless, "subgid_start");
    const subgidCount = integerAt(rootless, "subgid_count");

    const qdrantVersion = stringAt(qdrant, "version");
    const qdrantIndex = stringAt(qdrant, "image_index");
    const qdrantAmd64 = stringAt(qdrant, "image_linux_amd64");
    const qdrantArm64 = stringAt(qdrant, "image_linux_arm64");

    const aptKeys = APPLIANCE_KEYS.filter((key) => key.startsWith("apt_"));
    const rootPackageKeys = ROOTLESS_KEYS.filter((key) =>
      key.startsWith("package_"),
    );
    const osPackages: Record<string, string> = {};
    const rootPackages: Record<string, string> = {};
    for (const key of aptKeys) {
      const value = stringAt(appliance, key);
      if (!exactPackageVersion(value)) return invalid();
      osPackages[key.slice(4).replaceAll("_", "-")] = value;
    }
    for (const key of rootPackageKeys) {
      const value = stringAt(rootless, key);
      if (!exactPackageVersion(value)) return invalid();
      rootPackages[key.slice(8).replaceAll("_", "-")] = value;
    }

    if (
      schemaVersion !== 1 ||
      !pinnedImage(dockerfileFrontend) ||
      !pinnedImage(controlBase) ||
      !plainDigest(controlBaseLinuxAmd64) ||
      !plainDigest(controlBaseLinuxArm64) ||
      !exactSemver(node) ||
      !exactSemver(npm) ||
      !exactSemver(codex) ||
      !exactSemver(grok) ||
      !exactSemver(graphify) ||
      graphifyWheel === null ||
      !/^[0-9a-f]{64}$/.test(graphifyWheel) ||
      !exactSemver(buildx) ||
      sourceDateEpoch !== "git-commit" ||
      !sameArray(platforms, ["linux/amd64", "linux/arm64"]) ||
      !exactSemver(podman) ||
      api !== "1.40" ||
      endpoint !== "127.0.0.1:18443" ||
      !exactSemver(kernel) ||
      !sameArray(architectures, ["amd64", "arm64"]) ||
      subuidStart === null ||
      subuidCount !== 65_536 ||
      subgidStart === null ||
      subgidCount !== 65_536 ||
      !exactSemver(qdrantVersion) ||
      !plainDigest(qdrantIndex) ||
      !plainDigest(qdrantAmd64) ||
      !plainDigest(qdrantArm64)
    ) {
      return invalid();
    }

    return {
      _tag: "Valid",
      value: {
        schemaVersion: 1,
        build: {
          dockerfileFrontend,
          controlBase,
          controlBaseLinuxAmd64,
          controlBaseLinuxArm64,
          buildxVersion: buildx,
          sourceDateEpoch,
          supportedPlatforms: ["linux/amd64", "linux/arm64"],
        },
        tools: {
          node,
          npm,
          codex,
          grok,
          graphify,
          graphifyWheelSha256: graphifyWheel,
        },
        osPackages,
        rootlessEngine: {
          podman,
          dockerCompatApi: api,
          serviceEndpoint: endpoint,
          minimumKernel: kernel,
          supportedArchitectures: ["amd64", "arm64"],
          packages: rootPackages,
          subuid: { start: subuidStart, count: subuidCount },
          subgid: { start: subgidStart, count: subgidCount },
        },
        semanticMemory: {
          qdrantVersion,
          qdrantImageIndex: qdrantIndex,
          qdrantImageLinuxAmd64: qdrantAmd64,
          qdrantImageLinuxArm64: qdrantArm64,
        },
      },
    };
  } catch {
    return invalid();
  }
}

export function renderApplianceLockV1(value: AppliancePinsV1): string {
  return `${canonicalize(value)}\n`;
}

export function decodeApplianceLockV1(
  bytes: Uint8Array,
): ApplianceLockDecodeResultV1 {
  try {
    const text = decodeUtf8Fatal(bytes);
    if (isCoreFailure(text) || !text.endsWith("\n") || text.endsWith("\n\n")) {
      return invalid();
    }
    const body = text.slice(0, -1);
    const decoded = parseJsonRejectDuplicateKeys(body);
    if (isCoreFailure(decoded) || canonicalize(decoded) !== body) {
      return invalid();
    }
    const value = parsePinsObject(JSON.parse(body) as unknown);
    return value === null ? invalid() : { _tag: "Valid", value };
  } catch {
    return invalid();
  }
}

export function validateApplianceLockProjectionV1(input: {
  readonly manifestText: string;
  readonly lockBytes: Uint8Array;
}): ApplianceLockValidationResultV1 {
  try {
    const parsed = parseAppliancePinsV1(input.manifestText);
    if (parsed._tag !== "Valid") return invalid();
    const expected = new TextEncoder().encode(renderApplianceLockV1(parsed.value));
    if (expected.byteLength !== input.lockBytes.byteLength) return invalid();
    for (let index = 0; index < expected.byteLength; index += 1) {
      if (expected[index] !== input.lockBytes[index]) return invalid();
    }
    return { _tag: "Valid" };
  } catch {
    return invalid();
  }
}
