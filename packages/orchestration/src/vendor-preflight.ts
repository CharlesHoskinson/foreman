/**
 * Pure classification and semantic-version comparison for vendor preflight.
 * No process I/O.
 */

import type { VendorCapabilityV1 } from "./vendor-preflight-manifest.js";
import type {
  AuthValue,
  CurrencyValue,
  DiscoverableValue,
  ProbeOutcome,
  ProbeRecordV1,
  RemediationKind,
  VendorEvidenceClass,
  VendorFactV1,
  VendorId,
  VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";

// ---------------------------------------------------------------------------
// Semantic version
// ---------------------------------------------------------------------------

export type SemVer = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
};

const SEMVER_TOKEN =
  /\bv?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\b/;

/**
 * Parse the first standalone semantic-version token from vendor version output.
 * Accepts an optional leading `v`. Returns null when unparsable or absent.
 */
export function parseFirstSemVer(text: string | null | undefined): SemVer | null {
  if (text === null || text === undefined) return null;
  if (typeof text !== "string" || text.trim().length === 0) return null;
  const m = SEMVER_TOKEN.exec(text);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return null;
  }
  const preRaw = m[4];
  const prerelease: (string | number)[] = [];
  if (preRaw !== undefined && preRaw.length > 0) {
    for (const id of preRaw.split(".")) {
      if (id.length === 0) return null;
      if (/^(0|[1-9]\d*)$/.test(id)) {
        prerelease.push(Number(id));
      } else {
        prerelease.push(id);
      }
    }
  }
  return { major, minor, patch, prerelease };
}

/**
 * Compare two semantic versions by SemVer 2.0 precedence.
 * Returns negative if a < b, 0 if equal (ignoring build), positive if a > b.
 * A final release sorts after its prerelease.
 */
export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;

  const aPre = a.prerelease;
  const bPre = b.prerelease;
  // No prerelease > any prerelease
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;

  const n = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < n; i++) {
    if (i >= aPre.length) return -1;
    if (i >= bPre.length) return 1;
    const x = aPre[i]!;
    const y = bPre[i]!;
    if (x === y) continue;
    const xNum = typeof x === "number";
    const yNum = typeof y === "number";
    if (xNum && yNum) return (x as number) < (y as number) ? -1 : 1;
    if (xNum && !yNum) return -1;
    if (!xNum && yNum) return 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

export type CurrencyClassification = {
  readonly value: CurrencyValue;
  readonly reason: string;
  readonly reportedVersion: string | null;
};

/**
 * Classify currency by comparing reported version text against the floor.
 */
export function classifyCurrency(
  versionOutput: string | null,
  versionFloor: string,
  versionProbeOutcome: ProbeOutcome | null,
): CurrencyClassification {
  if (versionProbeOutcome === null) {
    return {
      value: "unknown",
      reason: "version probe was not executed",
      reportedVersion: null,
    };
  }
  if (versionProbeOutcome !== "completed") {
    return {
      value: "unknown",
      reason: `version probe outcome ${versionProbeOutcome}`,
      reportedVersion: null,
    };
  }
  if (versionOutput === null || versionOutput.trim().length === 0) {
    return {
      value: "unknown",
      reason: "version output empty or absent",
      reportedVersion: null,
    };
  }
  const reported = parseFirstSemVer(versionOutput);
  if (reported === null) {
    return {
      value: "unknown",
      reason: "version output unparsable",
      reportedVersion: null,
    };
  }
  const floor = parseFirstSemVer(versionFloor);
  if (floor === null) {
    return {
      value: "unknown",
      reason: "version floor unparsable",
      reportedVersion: formatSemVer(reported),
    };
  }
  const cmp = compareSemVer(reported, floor);
  const reportedText = formatSemVer(reported);
  if (cmp < 0) {
    return {
      value: "outdated",
      reason: `reported ${reportedText} is below floor ${versionFloor}`,
      reportedVersion: reportedText,
    };
  }
  return {
    value: "current",
    reason: `reported ${reportedText} meets floor ${versionFloor}`,
    reportedVersion: reportedText,
  };
}

export function formatSemVer(v: SemVer): string {
  const core = `${v.major}.${v.minor}.${v.patch}`;
  if (v.prerelease.length === 0) return core;
  return `${core}-${v.prerelease.map(String).join(".")}`;
}

// ---------------------------------------------------------------------------
// Auth classification helpers (pure)
// ---------------------------------------------------------------------------

export type AuthClassification = {
  readonly value: AuthValue;
  readonly reason: string;
};

export function classifyClaudeAuth(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  outcome: ProbeOutcome,
): AuthClassification {
  if (outcome !== "completed") {
    return {
      value: "unknown",
      reason: `claude auth status probe outcome ${outcome}`,
    };
  }
  const combined = `${stdout}${stderr}`.trim();
  if (combined.length === 0) {
    return { value: "unknown", reason: "claude auth status returned empty output" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(combined);
  } catch {
    // try stdout alone
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      return {
        value: "unknown",
        reason: "claude auth status returned malformed JSON",
      };
    }
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("loggedIn" in parsed)
  ) {
    return {
      value: "unknown",
      reason: "claude auth status JSON missing boolean loggedIn",
    };
  }
  const loggedIn = (parsed as { loggedIn: unknown }).loggedIn;
  if (typeof loggedIn !== "boolean") {
    return {
      value: "unknown",
      reason: "claude auth status loggedIn is not a boolean",
    };
  }
  if (loggedIn === true) {
    return {
      value: "authenticated",
      reason: "claude auth status reported loggedIn true",
    };
  }
  return {
    value: "not-authenticated",
    reason: "claude auth status reported loggedIn false",
  };
  void exitCode;
}

export function classifyCodexAuth(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  outcome: ProbeOutcome,
  negativeMarkers: readonly string[],
): AuthClassification {
  if (outcome !== "completed") {
    return {
      value: "unknown",
      reason: `codex login status probe outcome ${outcome}`,
    };
  }
  if (exitCode === 0) {
    return {
      value: "authenticated",
      reason: "codex login status exited 0",
    };
  }
  const combined = `${stdout}\n${stderr}`;
  for (const marker of negativeMarkers) {
    if (marker.length > 0 && combined.includes(marker)) {
      return {
        value: "not-authenticated",
        reason: `codex login status nonzero exit with signed-out marker`,
      };
    }
  }
  return {
    value: "unknown",
    reason:
      "codex login status nonzero exit without a recognized signed-out marker",
  };
}

export function classifyGrokAuth(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  outcome: ProbeOutcome,
  positiveMarkers: readonly string[],
  negativeMarkers: readonly string[],
): AuthClassification {
  if (outcome !== "completed") {
    return {
      value: "unknown",
      reason: `grok models probe outcome ${outcome}`,
    };
  }
  const combined = `${stdout}\n${stderr}`;
  if (combined.trim().length === 0) {
    return { value: "unknown", reason: "grok models returned empty output" };
  }
  // Negative markers before positive.
  for (const marker of negativeMarkers) {
    if (marker.length > 0 && combined.includes(marker)) {
      return {
        value: "not-authenticated",
        reason: "grok models matched a recognized signed-out marker",
      };
    }
  }
  for (const marker of positiveMarkers) {
    if (marker.length > 0 && combined.includes(marker)) {
      return {
        value: "authenticated",
        reason: "grok models matched the positive logged-in marker",
      };
    }
  }
  return {
    value: "unknown",
    reason:
      "grok models output matched neither the positive logged-in marker nor a recognized signed-out marker",
  };
  void exitCode;
}

export function classifyAuthForVendor(
  vendor: VendorId,
  stdout: string,
  stderr: string,
  exitCode: number | null,
  outcome: ProbeOutcome,
  capability: VendorCapabilityV1,
): AuthClassification {
  switch (vendor) {
    case "claude":
      return classifyClaudeAuth(stdout, stderr, exitCode, outcome);
    case "codex":
      return classifyCodexAuth(
        stdout,
        stderr,
        exitCode,
        outcome,
        capability.authNegativeMarkers,
      );
    case "grok":
      return classifyGrokAuth(
        stdout,
        stderr,
        exitCode,
        outcome,
        capability.authPositiveMarkers,
        capability.authNegativeMarkers,
      );
    case "agy":
      return {
        value: "unknown",
        reason: "agy has no live capability in this slice",
      };
    default: {
      const _exhaustive: never = vendor;
      return { value: "unknown", reason: `unsupported vendor ${_exhaustive}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Remediation priority
// ---------------------------------------------------------------------------

export type RemediationDecision = {
  readonly kind: RemediationKind;
  readonly instruction: string | null;
};

/**
 * Remediation priority:
 * 1. missing CLI -> install
 * 2. positively signed out -> login
 * 3. auth unknown -> diagnose
 * 4. outdated -> update
 * 5. currency unknown -> diagnose
 * 6. otherwise -> none
 */
export function decideRemediation(
  discoverable: DiscoverableValue,
  authenticated: AuthValue,
  current: CurrencyValue,
  capability: VendorCapabilityV1,
): RemediationDecision {
  if (discoverable === "missing") {
    return { kind: "install", instruction: capability.installInstruction };
  }
  if (authenticated === "not-authenticated") {
    return { kind: "login", instruction: capability.loginInstruction };
  }
  if (authenticated === "unknown") {
    return { kind: "diagnose", instruction: capability.diagnoseInstruction };
  }
  if (current === "outdated") {
    return { kind: "update", instruction: capability.updateInstruction };
  }
  if (current === "unknown") {
    return { kind: "diagnose", instruction: capability.diagnoseInstruction };
  }
  if (discoverable === "unknown") {
    return { kind: "diagnose", instruction: capability.diagnoseInstruction };
  }
  return { kind: "none", instruction: null };
}

// ---------------------------------------------------------------------------
// Record assembly helpers
// ---------------------------------------------------------------------------

export function makeFact<V extends string>(
  value: V,
  evidenceClass: VendorEvidenceClass,
  reason: string,
): VendorFactV1<V> {
  return { value, evidenceClass, reason };
}

export function buildMissingRecord(args: {
  readonly vendor: VendorId;
  readonly timestamp: string;
  readonly capability: VendorCapabilityV1;
}): VendorPreflightRecordV1 {
  const evidence = args.capability.evidenceClass;
  const remediation = decideRemediation(
    "missing",
    "unknown",
    "unknown",
    args.capability,
  );
  return {
    schemaVersion: 1,
    vendor: args.vendor,
    timestamp: args.timestamp,
    resolvedPath: null,
    reportedVersion: null,
    versionFloor: args.capability.versionFloor,
    facts: {
      discoverable: makeFact(
        "missing",
        evidence,
        `CLI ${args.capability.cliName} not found on PATH`,
      ),
      authenticated: makeFact(
        "unknown",
        evidence,
        "no auth probe after missing CLI",
      ),
      current: makeFact(
        "unknown",
        evidence,
        "no version probe after missing CLI",
      ),
    },
    probes: [],
    remediation,
  };
}

export function buildDiscoveredRecord(args: {
  readonly vendor: VendorId;
  readonly timestamp: string;
  readonly resolvedPath: string;
  readonly capability: VendorCapabilityV1;
  readonly auth: AuthClassification;
  readonly currency: CurrencyClassification;
  readonly probes: readonly ProbeRecordV1[];
}): VendorPreflightRecordV1 {
  const evidence = args.capability.evidenceClass;
  const remediation = decideRemediation(
    "discoverable",
    args.auth.value,
    args.currency.value,
    args.capability,
  );
  return {
    schemaVersion: 1,
    vendor: args.vendor,
    timestamp: args.timestamp,
    resolvedPath: args.resolvedPath,
    reportedVersion: args.currency.reportedVersion,
    versionFloor: args.capability.versionFloor,
    facts: {
      discoverable: makeFact(
        "discoverable",
        evidence,
        `CLI resolved at ${args.resolvedPath}`,
      ),
      authenticated: makeFact(args.auth.value, evidence, args.auth.reason),
      current: makeFact(args.currency.value, evidence, args.currency.reason),
    },
    probes: args.probes,
    remediation,
  };
}

/**
 * Map ProcessFailure reasons (and classification outcomes) to ProbeOutcome.
 */
export function processFailureToProbeOutcome(
  reason: "spawn_failed" | "timeout" | "output_bound" | "cancelled",
): ProbeOutcome {
  return reason;
}
