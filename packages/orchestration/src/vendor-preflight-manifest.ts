/**
 * Vendor capability table: strict TOML slice parser and JSON decoders.
 * Authored only in env/reference-manifest.toml; embedded at build time.
 */

import { isAbsolute } from "node:path";
import {
  canonicalize,
  rejectUnknownKeys,
  sha256Hex,
} from "@foreman/core";
import {
  MAX_PROBE_ARG_BYTES,
  MAX_PROBE_ARGV_ENTRIES,
  MAX_PROBE_ARGV_TOTAL_BYTES,
  VENDOR_EVIDENCE_CLASSES,
  VENDOR_IDS,
  isVendorPreflightContractFailure,
  vendorPreflightContractFailure,
  type VendorEvidenceClass,
  type VendorId,
  type VendorPreflightContractFailure,
} from "./vendor-preflight-contract.js";

// ---------------------------------------------------------------------------
// Capability types
// ---------------------------------------------------------------------------

export type VendorCapabilityV1 = {
  readonly vendor: VendorId;
  readonly cliName: string;
  readonly evidenceClass: VendorEvidenceClass;
  /** Argv after the executable for the auth probe. */
  readonly authArgv: readonly string[];
  /** Argv after the executable for the version probe. */
  readonly versionArgv: readonly string[];
  readonly versionFloor: string;
  readonly authPositiveMarkers: readonly string[];
  readonly authNegativeMarkers: readonly string[];
  readonly updateMutates: boolean;
  /** Optional non-mutating update-check argv after the executable. */
  readonly updateCheckArgv: readonly string[] | null;
  readonly loginInstruction: string;
  readonly installInstruction: string;
  readonly updateInstruction: string;
  readonly diagnoseInstruction: string;
};

export type VendorCapabilityTableV1 = {
  readonly schemaVersion: 1;
  readonly capabilities: readonly VendorCapabilityV1[];
};

export type CapabilityParseFailure = VendorPreflightContractFailure;

const CAPABILITY_JSON_KEYS = [
  "vendor",
  "cliName",
  "evidenceClass",
  "authArgv",
  "versionArgv",
  "versionFloor",
  "authPositiveMarkers",
  "authNegativeMarkers",
  "updateMutates",
  "updateCheckArgv",
  "loginInstruction",
  "installInstruction",
  "updateInstruction",
  "diagnoseInstruction",
] as const;

const TABLE_JSON_KEYS = ["schemaVersion", "capabilities"] as const;

function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function hasNul(s: string): boolean {
  return s.includes("\0");
}

function isInSet<T extends string>(
  v: unknown,
  set: readonly T[],
): v is T {
  return typeof v === "string" && (set as readonly string[]).includes(v);
}

function decodeNonBlank(
  v: unknown,
  maxBytes = 4_096,
): string | CapabilityParseFailure {
  if (typeof v !== "string") {
    return vendorPreflightContractFailure("invalid_schema");
  }
  if (hasNul(v) || v.trim().length === 0) {
    return v.includes("\0")
      ? vendorPreflightContractFailure("nul_rejected")
      : vendorPreflightContractFailure("blank_string");
  }
  if (utf8ByteLength(v) > maxBytes) {
    return vendorPreflightContractFailure("bound_exceeded");
  }
  return v;
}

/**
 * Marker / non-argv string arrays: entry count + non-blank + optional per-entry
 * UTF-8 byte bound. Not executable vectors.
 */
function decodeStringArray(
  v: unknown,
  opts: {
    readonly allowEmpty: boolean;
    readonly maxEntries?: number;
    readonly maxEntryBytes?: number;
  },
): readonly string[] | CapabilityParseFailure {
  if (!Array.isArray(v)) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  const max = opts.maxEntries ?? 64;
  if (v.length > max) {
    return vendorPreflightContractFailure("bound_exceeded");
  }
  if (!opts.allowEmpty && v.length === 0) {
    return vendorPreflightContractFailure("blank_string");
  }
  const maxEntryBytes = opts.maxEntryBytes ?? 4_096;
  const out: string[] = [];
  for (const entry of v) {
    if (typeof entry !== "string") {
      return vendorPreflightContractFailure("invalid_schema");
    }
    if (hasNul(entry)) {
      return vendorPreflightContractFailure("nul_rejected");
    }
    if (entry.trim().length === 0) {
      return vendorPreflightContractFailure("blank_string");
    }
    if (utf8ByteLength(entry) > maxEntryBytes) {
      return vendorPreflightContractFailure("bound_exceeded");
    }
    out.push(entry);
  }
  return out;
}

/**
 * Capability argv tails: same UTF-8 entry and total bounds as the public probe
 * argv contract (per-entry 65_536, total 262_144, entry count 64).
 */
function decodeCapabilityArgv(
  v: unknown,
): readonly string[] | CapabilityParseFailure {
  if (!Array.isArray(v)) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  if (v.length === 0 || v.length > MAX_PROBE_ARGV_ENTRIES) {
    return vendorPreflightContractFailure("bound_exceeded");
  }
  let total = 0;
  const out: string[] = [];
  for (const entry of v) {
    if (typeof entry !== "string") {
      return vendorPreflightContractFailure("invalid_schema");
    }
    if (hasNul(entry)) {
      return vendorPreflightContractFailure("nul_rejected");
    }
    if (entry.trim().length === 0) {
      return vendorPreflightContractFailure("blank_string");
    }
    const n = utf8ByteLength(entry);
    if (n > MAX_PROBE_ARG_BYTES) {
      return vendorPreflightContractFailure("bound_exceeded");
    }
    total += n;
    if (total > MAX_PROBE_ARGV_TOTAL_BYTES) {
      return vendorPreflightContractFailure("bound_exceeded");
    }
    out.push(entry);
  }
  return out;
}

/**
 * Decode one capability from a plain JSON-shaped object (not TOML).
 */
export function decodeVendorCapabilityV1(
  value: unknown,
): VendorCapabilityV1 | CapabilityParseFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  if (rejectUnknownKeys(obj, CAPABILITY_JSON_KEYS) !== null) {
    return vendorPreflightContractFailure("unknown_field");
  }
  if (!isInSet(obj["vendor"], VENDOR_IDS)) {
    return vendorPreflightContractFailure("invalid_enum");
  }
  if (!isInSet(obj["evidenceClass"], VENDOR_EVIDENCE_CLASSES)) {
    return vendorPreflightContractFailure("invalid_enum");
  }
  const cliName = decodeNonBlank(obj["cliName"], 256);
  if (isVendorPreflightContractFailure(cliName)) return cliName;
  // cli name must not be an absolute path in the authored table
  if (isAbsolute(cliName) || cliName.includes("/") || cliName.includes("\\")) {
    return vendorPreflightContractFailure("invalid_schema");
  }

  const authArgv = decodeCapabilityArgv(obj["authArgv"]);
  if (isVendorPreflightContractFailure(authArgv)) return authArgv;
  const versionArgv = decodeCapabilityArgv(obj["versionArgv"]);
  if (isVendorPreflightContractFailure(versionArgv)) return versionArgv;

  const versionFloor = decodeNonBlank(obj["versionFloor"], 256);
  if (isVendorPreflightContractFailure(versionFloor)) return versionFloor;

  const authPositiveMarkers = decodeStringArray(obj["authPositiveMarkers"], {
    allowEmpty: true,
  });
  if (isVendorPreflightContractFailure(authPositiveMarkers)) {
    return authPositiveMarkers;
  }
  const authNegativeMarkers = decodeStringArray(obj["authNegativeMarkers"], {
    allowEmpty: true,
  });
  if (isVendorPreflightContractFailure(authNegativeMarkers)) {
    return authNegativeMarkers;
  }

  if (typeof obj["updateMutates"] !== "boolean") {
    return vendorPreflightContractFailure("invalid_schema");
  }

  let updateCheckArgv: readonly string[] | null;
  if (obj["updateCheckArgv"] === null) {
    updateCheckArgv = null;
  } else {
    const u = decodeCapabilityArgv(obj["updateCheckArgv"]);
    if (isVendorPreflightContractFailure(u)) return u;
    updateCheckArgv = u;
  }

  const loginInstruction = decodeNonBlank(obj["loginInstruction"]);
  if (isVendorPreflightContractFailure(loginInstruction)) return loginInstruction;
  const installInstruction = decodeNonBlank(obj["installInstruction"]);
  if (isVendorPreflightContractFailure(installInstruction)) {
    return installInstruction;
  }
  const updateInstruction = decodeNonBlank(obj["updateInstruction"]);
  if (isVendorPreflightContractFailure(updateInstruction)) {
    return updateInstruction;
  }
  const diagnoseInstruction = decodeNonBlank(obj["diagnoseInstruction"]);
  if (isVendorPreflightContractFailure(diagnoseInstruction)) {
    return diagnoseInstruction;
  }

  return {
    vendor: obj["vendor"] as VendorId,
    cliName,
    evidenceClass: obj["evidenceClass"] as VendorEvidenceClass,
    authArgv,
    versionArgv,
    versionFloor,
    authPositiveMarkers,
    authNegativeMarkers,
    updateMutates: obj["updateMutates"] as boolean,
    updateCheckArgv,
    loginInstruction,
    installInstruction,
    updateInstruction,
    diagnoseInstruction,
  };
}

export function decodeVendorCapabilityTableV1(
  value: unknown,
): VendorCapabilityTableV1 | CapabilityParseFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  if (rejectUnknownKeys(obj, TABLE_JSON_KEYS) !== null) {
    return vendorPreflightContractFailure("unknown_field");
  }
  if (obj["schemaVersion"] !== 1) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  if (!Array.isArray(obj["capabilities"])) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  const capabilities: VendorCapabilityV1[] = [];
  const seen = new Set<string>();
  for (const entry of obj["capabilities"]) {
    const cap = decodeVendorCapabilityV1(entry);
    if (isVendorPreflightContractFailure(cap)) return cap;
    if (seen.has(cap.vendor)) {
      return vendorPreflightContractFailure("inconsistent_state");
    }
    seen.add(cap.vendor);
    capabilities.push(cap);
  }
  // Stable order by vendor id for determinism
  capabilities.sort((a, b) =>
    a.vendor < b.vendor ? -1 : a.vendor > b.vendor ? 1 : 0,
  );
  return { schemaVersion: 1, capabilities };
}

export function capabilityTableToCanonicalJson(
  table: VendorCapabilityTableV1,
): string {
  return canonicalize(table as unknown);
}

export function capabilityTableDigest(table: VendorCapabilityTableV1): string {
  return sha256Hex(capabilityTableToCanonicalJson(table));
}

export function findCapability(
  table: VendorCapabilityTableV1,
  vendor: VendorId,
): VendorCapabilityV1 | null {
  return table.capabilities.find((c) => c.vendor === vendor) ?? null;
}

// ---------------------------------------------------------------------------
// Strict TOML parser for ONLY [[vendor_capabilities]] array-of-tables
// ---------------------------------------------------------------------------

type TomlScalar = string | boolean | readonly string[];
type TomlTable = Record<string, TomlScalar>;

function stripCommentsAndBlank(line: string): string | null {
  let inStr = false;
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"' && line[i - 1] !== "\\") {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (!inStr && ch === "#") break;
    out += ch;
  }
  const t = out.trim();
  return t.length === 0 ? null : t;
}

function parseTomlString(raw: string): string | null {
  if (!(raw.startsWith('"') && raw.endsWith('"'))) return null;
  const inner = raw.slice(1, -1);
  let s = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === "\\") {
      const n = inner[i + 1];
      if (n === undefined) return null;
      if (n === "n") {
        s += "\n";
        i++;
        continue;
      }
      if (n === "t") {
        s += "\t";
        i++;
        continue;
      }
      if (n === "\\" || n === '"') {
        s += n;
        i++;
        continue;
      }
      return null;
    }
    s += ch;
  }
  return s;
}

/**
 * Strict capability-slice TOML string-array parser.
 * Accepts whitespace around one comma and a single trailing comma.
 * Rejects missing separators, doubled separators, leading separators,
 * trailing non-array content (via outer bracket match), and unterminated strings.
 */
function parseTomlArray(raw: string): string[] | null {
  const t = raw.trim();
  if (!(t.startsWith("[") && t.endsWith("]"))) return null;
  // Reject content after the matching closing bracket only when the raw trim
  // form is not a pure array — already enforced by startsWith/endsWith on trim.
  const body = t.slice(1, -1);
  let i = 0;
  const isWs = (ch: string | undefined): boolean =>
    ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

  const skipWs = (): void => {
    while (i < body.length && isWs(body[i])) i++;
  };

  const parseString = (): string | null => {
    if (body[i] !== '"') return null;
    i++;
    let s = "";
    while (i < body.length) {
      const ch = body[i]!;
      if (ch === "\\") {
        const n = body[i + 1];
        if (n === undefined) return null;
        if (n === "n") s += "\n";
        else if (n === "t") s += "\t";
        else if (n === "\\" || n === '"') s += n;
        else return null;
        i += 2;
        continue;
      }
      if (ch === '"') {
        i++;
        return s;
      }
      s += ch;
      i++;
    }
    // Unterminated string.
    return null;
  };

  skipWs();
  if (i >= body.length) return [];

  // Leading separator is invalid.
  if (body[i] === ",") return null;

  const items: string[] = [];
  const first = parseString();
  if (first === null) return null;
  items.push(first);

  for (;;) {
    skipWs();
    if (i >= body.length) break;
    if (body[i] !== ",") {
      // Missing separator (e.g. ["auth" "status"]).
      return null;
    }
    i++; // consume one comma
    skipWs();
    if (i >= body.length) {
      // Valid trailing comma.
      break;
    }
    if (body[i] === ",") {
      // Doubled separator.
      return null;
    }
    const next = parseString();
    if (next === null) return null;
    items.push(next);
  }
  return items;
}

function parseTomlValue(raw: string): TomlScalar | null {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t.startsWith("[")) {
    return parseTomlArray(t);
  }
  return parseTomlString(t);
}

/**
 * Extract and parse only `[[vendor_capabilities]]` tables from a full
 * reference-manifest TOML document. Other sections are ignored.
 */
export function parseVendorCapabilitiesFromToml(
  text: string,
): VendorCapabilityTableV1 | CapabilityParseFailure {
  if (typeof text !== "string" || text.length === 0) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  if (text.includes("\0")) {
    return vendorPreflightContractFailure("nul_rejected");
  }

  const lines = text.split(/\r?\n/);
  const tables: TomlTable[] = [];
  let current: TomlTable | null = null;
  let inVendorCaps = false;

  for (const rawLine of lines) {
    const line = stripCommentsAndBlank(rawLine);
    if (line === null) continue;

    // Heading
    if (line.startsWith("[")) {
      if (line === "[[vendor_capabilities]]") {
        if (current !== null) tables.push(current);
        current = {};
        inVendorCaps = true;
        continue;
      }
      // Any other table/array heading ends the current capability entry.
      if (current !== null) {
        tables.push(current);
        current = null;
      }
      inVendorCaps = false;
      continue;
    }

    if (!inVendorCaps || current === null) continue;

    const eq = line.indexOf("=");
    if (eq < 0) {
      return vendorPreflightContractFailure("invalid_schema");
    }
    const key = line.slice(0, eq).trim();
    const valRaw = line.slice(eq + 1).trim();
    if (key.length === 0) {
      return vendorPreflightContractFailure("invalid_schema");
    }
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      // duplicate semantic field within one table
      return vendorPreflightContractFailure("inconsistent_state");
    }
    const val = parseTomlValue(valRaw);
    if (val === null) {
      return vendorPreflightContractFailure("invalid_schema");
    }
    current[key] = val;
  }
  if (current !== null) tables.push(current);

  if (tables.length === 0) {
    return vendorPreflightContractFailure("invalid_schema");
  }

  const capabilities: unknown[] = [];
  for (const t of tables) {
    const mapped = mapTomlCapability(t);
    if (isVendorPreflightContractFailure(mapped)) return mapped;
    capabilities.push(mapped);
  }
  return decodeVendorCapabilityTableV1({
    schemaVersion: 1,
    capabilities,
  });
}

function mapTomlCapability(
  t: TomlTable,
): Record<string, unknown> | CapabilityParseFailure {
  const required = [
    "vendor",
    "cli_name",
    "evidence_class",
    "auth_argv",
    "version_argv",
    "version_floor",
    "auth_positive_markers",
    "auth_negative_markers",
    "update_mutates",
    "login_instruction",
    "install_instruction",
    "update_instruction",
    "diagnose_instruction",
  ] as const;

  for (const k of required) {
    if (!(k in t)) {
      return vendorPreflightContractFailure("invalid_schema");
    }
  }

  // Reject unknown keys in the capability table
  const allowed = new Set<string>([
    ...required,
    "update_check_argv",
  ]);
  for (const k of Object.keys(t)) {
    if (!allowed.has(k)) {
      return vendorPreflightContractFailure("unknown_field");
    }
  }

  const updateCheck =
    "update_check_argv" in t ? t["update_check_argv"] : null;

  return {
    vendor: t["vendor"],
    cliName: t["cli_name"],
    evidenceClass: t["evidence_class"],
    authArgv: t["auth_argv"],
    versionArgv: t["version_argv"],
    versionFloor: t["version_floor"],
    authPositiveMarkers: t["auth_positive_markers"],
    authNegativeMarkers: t["auth_negative_markers"],
    updateMutates: t["update_mutates"],
    updateCheckArgv: updateCheck === undefined ? null : updateCheck,
    loginInstruction: t["login_instruction"],
    installInstruction: t["install_instruction"],
    updateInstruction: t["update_instruction"],
    diagnoseInstruction: t["diagnose_instruction"],
  };
}

/**
 * Known mutating update verbs that must never appear in executed probe argv.
 * Used by static tests and runtime guards.
 */
export const FORBIDDEN_MUTATING_UPDATE_ARGV_TAILS: readonly (readonly string[])[] =
  [
    ["update"],
    ["update", "--enable"],
    ["update", "--disable"],
  ] as const;

/**
 * Sole non-mutating update exception: exact tail `update --check --json`.
 * Authorization is vendor-bound — only capability vendor `grok` may use it.
 * Callers must pass the capability's vendor id; executable path and CLI name
 * alone never authorize the exception.
 */
export const GROK_NON_MUTATING_UPDATE_CHECK_ARGV = [
  "update",
  "--check",
  "--json",
] as const;

/**
 * True when argv would execute a mutating update command.
 *
 * @param argv - Full argv as `[executable, ...tail]`.
 * @param vendorBinding - Capability vendor id that owns this argv, or `null`
 *   when no valid vendor binding exists. Path/CLI-name inference is refused.
 */
export function argvContainsMutatingUpdate(
  argv: readonly string[],
  vendorBinding: VendorId | null,
): boolean {
  if (argv.length < 2) return false;
  const tail = argv.slice(1);
  if (tail[0] !== "update") return false;
  // Exact non-mutating exception only for grok capability binding.
  if (
    vendorBinding === "grok" &&
    tail.length === GROK_NON_MUTATING_UPDATE_CHECK_ARGV.length &&
    tail[0] === GROK_NON_MUTATING_UPDATE_CHECK_ARGV[0] &&
    tail[1] === GROK_NON_MUTATING_UPDATE_CHECK_ARGV[1] &&
    tail[2] === GROK_NON_MUTATING_UPDATE_CHECK_ARGV[2]
  ) {
    return false;
  }
  return true;
}
