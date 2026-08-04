/**
 * Closed vendor-preflight record contract (Sprint 3 R4A).
 *
 * Pure types and strict decoders. No process, PATH, or clock I/O.
 */

import { isAbsolute } from "node:path";
import { rejectUnknownKeys } from "@foreman/core";

// ---------------------------------------------------------------------------
// Closed domains
// ---------------------------------------------------------------------------

export const VENDOR_IDS = ["claude", "codex", "grok", "agy"] as const;
export type VendorId = (typeof VENDOR_IDS)[number];

export const VENDOR_EVIDENCE_CLASSES = ["declared", "probed"] as const;
export type VendorEvidenceClass = (typeof VENDOR_EVIDENCE_CLASSES)[number];

export const DISCOVERABLE_VALUES = [
  "discoverable",
  "missing",
  "unknown",
] as const;
export type DiscoverableValue = (typeof DISCOVERABLE_VALUES)[number];

export const AUTH_VALUES = [
  "authenticated",
  "not-authenticated",
  "unknown",
] as const;
export type AuthValue = (typeof AUTH_VALUES)[number];

export const CURRENCY_VALUES = ["current", "outdated", "unknown"] as const;
export type CurrencyValue = (typeof CURRENCY_VALUES)[number];

export const PROBE_KINDS = ["version", "auth"] as const;
export type ProbeKind = (typeof PROBE_KINDS)[number];

export const PROBE_OUTCOMES = [
  "completed",
  "timeout",
  "output_bound",
  "spawn_failed",
  "cancelled",
  "empty_output",
  "malformed_output",
  "unmatched_output",
] as const;
export type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];

export const REMEDIATION_KINDS = [
  "none",
  "install",
  "login",
  "update",
  "diagnose",
] as const;
export type RemediationKind = (typeof REMEDIATION_KINDS)[number];

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export const MAX_REASON_BYTES = 4_096;
export const MAX_INSTRUCTION_BYTES = 4_096;
export const MAX_VERSION_BYTES = 256;
export const MAX_PATH_BYTES = 32_768;
export const MAX_PROBE_ARGV_ENTRIES = 64;
export const MAX_PROBE_ARG_BYTES = 65_536;
export const MAX_PROBE_ARGV_TOTAL_BYTES = 262_144;
export const MAX_PROBES = 8;

// ---------------------------------------------------------------------------
// Failure surface
// ---------------------------------------------------------------------------

export const VENDOR_PREFLIGHT_CONTRACT_FAILURE_BRAND = Symbol(
  "@foreman/orchestration/VendorPreflightContractFailure",
);

type Branded = { readonly [VENDOR_PREFLIGHT_CONTRACT_FAILURE_BRAND]: true };

export type VendorPreflightContractFailureReason =
  | "invalid_schema"
  | "unknown_field"
  | "invalid_enum"
  | "blank_string"
  | "relative_path"
  | "invalid_timestamp"
  | "bound_exceeded"
  | "inconsistent_state"
  | "invalid_exit_code"
  | "nul_rejected";

export type VendorPreflightContractFailure = Branded & {
  readonly _tag: "VendorPreflightContractFailure";
  readonly reason: VendorPreflightContractFailureReason;
};

export function vendorPreflightContractFailure(
  reason: VendorPreflightContractFailureReason,
): VendorPreflightContractFailure {
  return {
    [VENDOR_PREFLIGHT_CONTRACT_FAILURE_BRAND]: true,
    _tag: "VendorPreflightContractFailure",
    reason,
  };
}

export function isVendorPreflightContractFailure(
  v: unknown,
): v is VendorPreflightContractFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [VENDOR_PREFLIGHT_CONTRACT_FAILURE_BRAND]?: unknown })[
      VENDOR_PREFLIGHT_CONTRACT_FAILURE_BRAND
    ] === true &&
    (v as { _tag?: unknown })._tag === "VendorPreflightContractFailure"
  );
}

// ---------------------------------------------------------------------------
// Record types
// ---------------------------------------------------------------------------

export type VendorFactV1<V extends string> = {
  readonly value: V;
  readonly evidenceClass: VendorEvidenceClass;
  readonly reason: string;
};

export type ProbeRecordV1 = {
  readonly kind: ProbeKind;
  readonly argv: readonly string[];
  readonly outcome: ProbeOutcome;
  readonly exitCode: number | null;
};

export type RemediationV1 = {
  readonly kind: RemediationKind;
  readonly instruction: string | null;
};

export type VendorPreflightRecordV1 = {
  readonly schemaVersion: 1;
  readonly vendor: VendorId;
  readonly timestamp: string;
  readonly resolvedPath: string | null;
  readonly reportedVersion: string | null;
  readonly versionFloor: string;
  readonly facts: {
    readonly discoverable: VendorFactV1<DiscoverableValue>;
    readonly authenticated: VendorFactV1<AuthValue>;
    readonly current: VendorFactV1<CurrencyValue>;
  };
  readonly probes: readonly ProbeRecordV1[];
  readonly remediation: RemediationV1;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function isNonBlankString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function hasNul(s: string): boolean {
  return s.includes("\0");
}

/**
 * Strict UTC RFC 3339 with optional fractional seconds and required Z.
 * Examples: 2026-08-04T12:00:00Z , 2026-08-04T12:00:00.000Z
 */
export function isStrictUtcRfc3339(s: string): boolean {
  if (typeof s !== "string" || s.length < 20 || s.length > 40) return false;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?Z$/.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 60) return false;
  // Round-trip via Date to reject impossible calendar dates.
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return false;
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    return false;
  }
  return true;
}

function isInSet<T extends string>(
  v: unknown,
  set: readonly T[],
): v is T {
  return typeof v === "string" && (set as readonly string[]).includes(v);
}

function decodeNonBlankBounded(
  v: unknown,
  maxBytes: number,
): string | VendorPreflightContractFailure {
  if (typeof v !== "string") {
    return vendorPreflightContractFailure("invalid_schema");
  }
  if (hasNul(v)) {
    return vendorPreflightContractFailure("nul_rejected");
  }
  if (v.trim().length === 0) {
    return vendorPreflightContractFailure("blank_string");
  }
  if (utf8ByteLength(v) > maxBytes) {
    return vendorPreflightContractFailure("bound_exceeded");
  }
  return v;
}

function decodeOptionalBoundedString(
  v: unknown,
  maxBytes: number,
): string | null | VendorPreflightContractFailure {
  if (v === null) return null;
  return decodeNonBlankBounded(v, maxBytes);
}

const FACT_KEYS = ["value", "evidenceClass", "reason"] as const;
const PROBE_KEYS = ["kind", "argv", "outcome", "exitCode"] as const;
const REMEDIATION_KEYS = ["kind", "instruction"] as const;
const FACTS_KEYS = ["discoverable", "authenticated", "current"] as const;
const RECORD_KEYS = [
  "schemaVersion",
  "vendor",
  "timestamp",
  "resolvedPath",
  "reportedVersion",
  "versionFloor",
  "facts",
  "probes",
  "remediation",
] as const;

function decodeFact<V extends string>(
  value: unknown,
  valueDomain: readonly V[],
): VendorFactV1<V> | VendorPreflightContractFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  if (rejectUnknownKeys(obj, FACT_KEYS) !== null) {
    return vendorPreflightContractFailure("unknown_field");
  }
  if (!isInSet(obj["value"], valueDomain)) {
    return vendorPreflightContractFailure("invalid_enum");
  }
  if (!isInSet(obj["evidenceClass"], VENDOR_EVIDENCE_CLASSES)) {
    return vendorPreflightContractFailure("invalid_enum");
  }
  const reason = decodeNonBlankBounded(obj["reason"], MAX_REASON_BYTES);
  if (isVendorPreflightContractFailure(reason)) return reason;
  return {
    value: obj["value"] as V,
    evidenceClass: obj["evidenceClass"] as VendorEvidenceClass,
    reason,
  };
}

function decodeArgv(
  value: unknown,
): readonly string[] | VendorPreflightContractFailure {
  if (!Array.isArray(value)) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  if (value.length === 0 || value.length > MAX_PROBE_ARGV_ENTRIES) {
    return vendorPreflightContractFailure("bound_exceeded");
  }
  let total = 0;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return vendorPreflightContractFailure("invalid_schema");
    }
    if (hasNul(entry)) {
      return vendorPreflightContractFailure("nul_rejected");
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
  // First argv entry (executable name or path) must be non-blank.
  if (out[0]!.trim().length === 0) {
    return vendorPreflightContractFailure("blank_string");
  }
  return out;
}

function decodeProbe(
  value: unknown,
): ProbeRecordV1 | VendorPreflightContractFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  if (rejectUnknownKeys(obj, PROBE_KEYS) !== null) {
    return vendorPreflightContractFailure("unknown_field");
  }
  if (!isInSet(obj["kind"], PROBE_KINDS)) {
    return vendorPreflightContractFailure("invalid_enum");
  }
  if (!isInSet(obj["outcome"], PROBE_OUTCOMES)) {
    return vendorPreflightContractFailure("invalid_enum");
  }
  const argv = decodeArgv(obj["argv"]);
  if (isVendorPreflightContractFailure(argv)) return argv;
  const exitCode = obj["exitCode"];
  if (exitCode !== null) {
    if (
      typeof exitCode !== "number" ||
      !Number.isSafeInteger(exitCode) ||
      exitCode < 0 ||
      exitCode > 255
    ) {
      return vendorPreflightContractFailure("invalid_exit_code");
    }
  }
  return {
    kind: obj["kind"] as ProbeKind,
    argv,
    outcome: obj["outcome"] as ProbeOutcome,
    exitCode: exitCode as number | null,
  };
}

function decodeRemediation(
  value: unknown,
): RemediationV1 | VendorPreflightContractFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  if (rejectUnknownKeys(obj, REMEDIATION_KEYS) !== null) {
    return vendorPreflightContractFailure("unknown_field");
  }
  if (!isInSet(obj["kind"], REMEDIATION_KINDS)) {
    return vendorPreflightContractFailure("invalid_enum");
  }
  const kind = obj["kind"] as RemediationKind;
  const instruction = obj["instruction"];
  if (instruction === null) {
    if (kind !== "none") {
      // non-none remediations should carry instruction; allow null only for none
      // (diagnose may also have instruction). Consistency is checked separately
      // for login/unknown pairing; blank instruction is rejected when present.
    }
    return { kind, instruction: null };
  }
  const instr = decodeNonBlankBounded(instruction, MAX_INSTRUCTION_BYTES);
  if (isVendorPreflightContractFailure(instr)) return instr;
  return { kind, instruction: instr };
}

/**
 * State consistency rules on a fully decoded record.
 */
export function checkRecordConsistency(
  rec: VendorPreflightRecordV1,
): VendorPreflightContractFailure | null {
  const disc = rec.facts.discoverable.value;
  const auth = rec.facts.authenticated.value;
  const curr = rec.facts.current.value;

  if (disc === "missing") {
    if (rec.resolvedPath !== null) {
      return vendorPreflightContractFailure("inconsistent_state");
    }
    if (rec.probes.length !== 0) {
      return vendorPreflightContractFailure("inconsistent_state");
    }
    if (auth !== "unknown" || curr !== "unknown") {
      return vendorPreflightContractFailure("inconsistent_state");
    }
    if (rec.reportedVersion !== null) {
      return vendorPreflightContractFailure("inconsistent_state");
    }
  }

  if (disc === "discoverable") {
    if (rec.resolvedPath === null || !isAbsolute(rec.resolvedPath)) {
      return vendorPreflightContractFailure("inconsistent_state");
    }
  }

  if (rec.resolvedPath !== null && !isAbsolute(rec.resolvedPath)) {
    return vendorPreflightContractFailure("relative_path");
  }

  // unknown authentication never has login remediation
  if (auth === "unknown" && rec.remediation.kind === "login") {
    return vendorPreflightContractFailure("inconsistent_state");
  }

  // not-authenticated may only pair with login (or diagnose is wrong);
  // require that a not-authenticated fact comes with at least one completed
  // auth probe (positive signed-out signal is a classification obligation —
  // the record shape requires a completed auth probe when not-authenticated).
  if (auth === "not-authenticated") {
    const authProbe = rec.probes.find((p) => p.kind === "auth");
    if (authProbe === undefined || authProbe.outcome !== "completed") {
      return vendorPreflightContractFailure("inconsistent_state");
    }
  }

  return null;
}

export function decodeVendorPreflightRecordV1(
  value: unknown,
): VendorPreflightRecordV1 | VendorPreflightContractFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  if (rejectUnknownKeys(obj, RECORD_KEYS) !== null) {
    return vendorPreflightContractFailure("unknown_field");
  }

  if (obj["schemaVersion"] !== 1) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  if (!isInSet(obj["vendor"], VENDOR_IDS)) {
    return vendorPreflightContractFailure("invalid_enum");
  }
  if (typeof obj["timestamp"] !== "string" || !isStrictUtcRfc3339(obj["timestamp"])) {
    return vendorPreflightContractFailure("invalid_timestamp");
  }

  let resolvedPath: string | null;
  if (obj["resolvedPath"] === null) {
    resolvedPath = null;
  } else if (typeof obj["resolvedPath"] === "string") {
    if (!isNonBlankString(obj["resolvedPath"])) {
      return vendorPreflightContractFailure("blank_string");
    }
    if (hasNul(obj["resolvedPath"])) {
      return vendorPreflightContractFailure("nul_rejected");
    }
    if (utf8ByteLength(obj["resolvedPath"]) > MAX_PATH_BYTES) {
      return vendorPreflightContractFailure("bound_exceeded");
    }
    if (!isAbsolute(obj["resolvedPath"])) {
      return vendorPreflightContractFailure("relative_path");
    }
    resolvedPath = obj["resolvedPath"];
  } else {
    return vendorPreflightContractFailure("invalid_schema");
  }

  const reportedVersion = decodeOptionalBoundedString(
    obj["reportedVersion"],
    MAX_VERSION_BYTES,
  );
  if (isVendorPreflightContractFailure(reportedVersion)) return reportedVersion;

  const versionFloor = decodeNonBlankBounded(
    obj["versionFloor"],
    MAX_VERSION_BYTES,
  );
  if (isVendorPreflightContractFailure(versionFloor)) return versionFloor;

  if (typeof obj["facts"] !== "object" || obj["facts"] === null || Array.isArray(obj["facts"])) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  const factsObj = obj["facts"] as Record<string, unknown>;
  if (rejectUnknownKeys(factsObj, FACTS_KEYS) !== null) {
    return vendorPreflightContractFailure("unknown_field");
  }
  const discoverable = decodeFact(factsObj["discoverable"], DISCOVERABLE_VALUES);
  if (isVendorPreflightContractFailure(discoverable)) return discoverable;
  const authenticated = decodeFact(factsObj["authenticated"], AUTH_VALUES);
  if (isVendorPreflightContractFailure(authenticated)) return authenticated;
  const current = decodeFact(factsObj["current"], CURRENCY_VALUES);
  if (isVendorPreflightContractFailure(current)) return current;

  if (!Array.isArray(obj["probes"])) {
    return vendorPreflightContractFailure("invalid_schema");
  }
  if (obj["probes"].length > MAX_PROBES) {
    return vendorPreflightContractFailure("bound_exceeded");
  }
  const probes: ProbeRecordV1[] = [];
  for (const p of obj["probes"]) {
    const decoded = decodeProbe(p);
    if (isVendorPreflightContractFailure(decoded)) return decoded;
    probes.push(decoded);
  }

  const remediation = decodeRemediation(obj["remediation"]);
  if (isVendorPreflightContractFailure(remediation)) return remediation;

  const record: VendorPreflightRecordV1 = {
    schemaVersion: 1,
    vendor: obj["vendor"] as VendorId,
    timestamp: obj["timestamp"] as string,
    resolvedPath,
    reportedVersion,
    versionFloor,
    facts: { discoverable, authenticated, current },
    probes,
    remediation,
  };

  const consistency = checkRecordConsistency(record);
  if (consistency !== null) return consistency;
  return record;
}

/**
 * True when all three facts are the positive/current values (exit 0 path).
 */
export function recordIsFullyReady(rec: VendorPreflightRecordV1): boolean {
  return (
    rec.facts.discoverable.value === "discoverable" &&
    rec.facts.authenticated.value === "authenticated" &&
    rec.facts.current.value === "current"
  );
}
