import { createPublicKey, verify as verifyEd25519 } from "node:crypto";
import type { KeyObject } from "node:crypto";

import {
  canonicalize,
  decodeUtf8Fatal,
  isCommitSha40,
  isCoreFailure,
  isSha256Hex,
  parseJsonRejectDuplicateKeys,
  sha256Hex,
} from "@foreman/core";

const ONE_MIB = 1_048_576;
const DOMAIN = "foreman.release-authority.v1";
const PROGRAM = "v040" as const;
const EVAL_PACKAGE = "graph-eval-falsification" as const;
const EVAL_CHILD = "v040-t8-evaluation" as const;
const MANIFEST_SCHEMA = "foreman.approved-openspec.v1" as const;

const USER_KEY_SHA256 =
  "454e04effab1f4bd83757aa23b3885fff8ed3cc9bbc226acdd816496abee370c" as const;
const HOST_KEY_SHA256 =
  "205477e6a7d35c81501a19e6e626b14664b2ed09d20edd7dce0c7c122912511b" as const;

const USER_SPKI_B64URL =
  "MCowBQYDK2VwAyEAhYttcX7HTnczgb7-4HJyKNK6mU__uZmRGAabOV0EJUI" as const;
const HOST_SPKI_B64URL =
  "MCowBQYDK2VwAyEAoczdxczpGA6Kk4gtzp80-6wpCRT1K6wzI6wbKDXLdpY" as const;

const SIGNATURE_B64URL_RE = /^[A-Za-z0-9_-]{86}$/;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const encoder = new TextEncoder();

export type ReleaseCandidateIdentityV1 = {
  readonly commit: string;
  readonly tree: string;
  readonly candidateSha256: string;
};

export type ReleaseActionV1 =
  | "implement"
  | "verify"
  | "audit"
  | "correct"
  | "council"
  | "provider_retry"
  | "resume"
  | "integrate"
  | "publish"
  | "evaluate";

export type ReleaseAuditFindingV1 = {
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly file: string;
  readonly line: number;
  readonly summary: string;
  readonly evidence: string;
};

export type ReleaseChecksSourceV1 = {
  readonly schema: "foreman.checks-source.v1";
  readonly program: "v040";
  readonly packageId: string;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly status: "PASS" | "FAIL";
  readonly commands: readonly {
    readonly commandSha256: string;
    readonly exitCode: number;
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
  }[];
};

export type ReleaseAuditSourceV1 = {
  readonly schema: "foreman.audit-source.v1";
  readonly program: "v040";
  readonly packageId: string;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly verdict: "APPROVED" | "WARNING" | "BLOCKED" | "UNVERIFIED";
  readonly findings: readonly ReleaseAuditFindingV1[];
  readonly auditArtifactSha256: string;
};

export type ReleaseEvaluationReportSourceV1 = {
  readonly schema: "foreman.evaluation-report-source.v1";
  readonly program: "v040";
  readonly packageId: "graph-eval-falsification";
  readonly candidateSha256: string;
  readonly authorityManifestSha256: string;
  readonly evaluationAuthorityReceiptSha256: string;
  readonly result: ReleaseEvaluationVerdictV1["result"];
  readonly plannedRuns: 2000;
  readonly completedRuns: number;
  readonly unavailableRuns: number;
  readonly notRunRuns: number;
  readonly runSetSha256: string;
  readonly reportArtifactSha256: string;
};

export type ReleaseProducerSourceV1 =
  | ReleaseChecksSourceV1
  | ReleaseAuditSourceV1
  | ReleaseEvaluationReportSourceV1;

export type ReleaseAuthorityReceiptV1 =
  | {
      readonly schema: "foreman.design-approval.v1";
      readonly program: "v040";
      readonly packageId: string;
      readonly designCommit: string;
      readonly designTree: string;
      readonly approvedOpenSpecSha256: string;
      readonly taskPlanSha256: string;
      readonly approvalStatementSha256: string;
      readonly issuerKeySha256: typeof USER_KEY_SHA256;
      readonly issuedAt: string;
      readonly signature: string;
    }
  | {
      readonly schema: "foreman.checks-evidence.v1";
      readonly program: "v040";
      readonly packageId: string;
      readonly candidate: ReleaseCandidateIdentityV1;
      readonly status: "PASS" | "FAIL";
      readonly checksSha256: string;
      readonly issuerKeySha256: typeof HOST_KEY_SHA256;
      readonly issuedAt: string;
      readonly signature: string;
    }
  | {
      readonly schema: "foreman.release-audit.v1";
      readonly program: "v040";
      readonly packageId: string;
      readonly candidate: ReleaseCandidateIdentityV1;
      readonly verdict: "APPROVED" | "WARNING" | "BLOCKED" | "UNVERIFIED";
      readonly findings: readonly ReleaseAuditFindingV1[];
      readonly evidenceSha256: string;
      readonly issuerKeySha256: typeof HOST_KEY_SHA256;
      readonly issuedAt: string;
      readonly signature: string;
    }
  | {
      readonly schema: "foreman.council-request.v1";
      readonly program: "v040";
      readonly packageId: string;
      readonly candidateSha256: string;
      readonly questionSha256: string;
      readonly constraintsSha256: string;
      readonly optionsSha256: string;
      readonly issuerKeySha256: typeof HOST_KEY_SHA256;
      readonly issuedAt: string;
      readonly signature: string;
    }
  | {
      readonly schema: "foreman.evaluation-authority.v1";
      readonly program: "v040";
      readonly packageId: "graph-eval-falsification";
      readonly manifestSha256: string;
      readonly issuerKeySha256: typeof USER_KEY_SHA256;
      readonly issuedAt: string;
      readonly signature: string;
    };

export type ReleaseActionOutcomeV1 = {
  readonly schema: "foreman.release-action-outcome.v1";
  readonly program: "v040";
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: string;
  readonly packageId: string;
  readonly reservationAction: ReleaseActionV1;
  readonly effectiveAction: ReleaseActionV1;
  readonly reservationId: string;
  readonly originReservationId: string;
  readonly candidateSha256: string;
  readonly status: "PASS" | "BLOCKING" | "EXTERNAL_FAILURE";
  readonly evidenceSha256: string;
  readonly issuerKeySha256: typeof HOST_KEY_SHA256;
  readonly issuedAt: string;
  readonly signature: string;
};

export type ReleaseCouncilOutcomeV1 = {
  readonly schema: "foreman.council-outcome.v1";
  readonly program: "v040";
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: string;
  readonly packageId: string;
  readonly reservationAction: "council" | "provider_retry" | "resume";
  readonly reservationId: string;
  readonly originReservationId: string;
  readonly candidateSha256: string;
  readonly requestSha256: string;
  readonly decisionSha256: string;
  readonly status: "ADVICE" | "BLOCKING";
  readonly issuerKeySha256: typeof HOST_KEY_SHA256;
  readonly issuedAt: string;
  readonly signature: string;
};

export type ReleaseEvaluationVerdictV1 = {
  readonly schema: "foreman.evaluation-verdict.v1";
  readonly program: "v040";
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: "v040-t8-evaluation";
  readonly packageId: "graph-eval-falsification";
  readonly candidateSha256: string;
  readonly authorityManifestSha256: string;
  readonly evaluationAuthorityReceiptSha256: string;
  readonly result:
    | "PROMOTE"
    | "GRAPH_OFF_FAILED"
    | "GRAPH_OFF_INCONCLUSIVE"
    | "GRAPH_OFF_UNCOMPUTABLE";
  readonly plannedRuns: 2000;
  readonly completedRuns: number;
  readonly unavailableRuns: number;
  readonly notRunRuns: number;
  readonly runSetSha256: string;
  readonly reportSha256: string;
  readonly issuerKeySha256: typeof HOST_KEY_SHA256;
  readonly issuedAt: string;
  readonly signature: string;
};

export type ExecutionChildTerminalApprovalV1 =
  | {
      readonly schema: "foreman.execution-child-cancel.v1";
      readonly program: "v040";
      readonly rootContractId: string;
      readonly rootContractSha256: string;
      readonly familySha256: string;
      readonly childId: string;
      readonly reasonSha256: string;
      readonly issuerKeySha256: typeof USER_KEY_SHA256;
      readonly issuedAt: string;
      readonly signature: string;
    }
  | {
      readonly schema: "foreman.execution-child-invalidate.v1";
      readonly program: "v040";
      readonly rootContractId: string;
      readonly rootContractSha256: string;
      readonly familySha256: string;
      readonly childId: string;
      readonly observedFamilySha256: string;
      readonly reasonSha256: string;
      readonly issuerKeySha256: typeof USER_KEY_SHA256;
      readonly issuedAt: string;
      readonly signature: string;
    };

export type FailedReservationAuthorityV1 = {
  readonly reservationId: string;
  readonly originReservationId: string;
  readonly originalAction: ReleaseActionV1;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly failureEvidenceSha256: string;
};

export type ReleaseEvidenceBundleV1 = {
  readonly schema: "foreman.release-evidence-bundle.v1";
  readonly program: "v040";
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: string;
  readonly packageId: string;
  readonly action: ReleaseActionV1;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly taskPlanSha256: string;
  readonly receipts: readonly ReleaseAuthorityReceiptV1[];
  readonly priorReservation?: FailedReservationAuthorityV1;
  readonly issuerKeySha256: typeof HOST_KEY_SHA256;
  readonly issuedAt: string;
  readonly signature: string;
};

export type ReleaseAuthorityObjectV1 =
  | ReleaseAuthorityReceiptV1
  | ReleaseActionOutcomeV1
  | ReleaseCouncilOutcomeV1
  | ReleaseEvaluationVerdictV1
  | ExecutionChildTerminalApprovalV1
  | ReleaseEvidenceBundleV1;

export type ApprovedOpenSpecManifestV1 = {
  readonly schema: "foreman.approved-openspec.v1";
  readonly files: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
};

export type ReleaseAuthorityObjectParseResultV1 =
  | { readonly _tag: "Valid"; readonly value: ReleaseAuthorityObjectV1 }
  | { readonly _tag: "Invalid" };

export type ReleaseAuthorityFileDecodeResultV1 =
  | {
      readonly _tag: "Valid";
      readonly value: ReleaseAuthorityObjectV1;
      readonly sha256: string;
    }
  | { readonly _tag: "Invalid" };

export type ReleaseProducerSourceDecodeResultV1 =
  | {
      readonly _tag: "Valid";
      readonly value: ReleaseProducerSourceV1;
      readonly sha256: string;
    }
  | { readonly _tag: "Invalid" };

export type ReleaseSourceReceiptBindingResultV1 =
  | { readonly _tag: "Valid" }
  | { readonly _tag: "Invalid" };

export type ApprovedOpenSpecManifestBuildResultV1 =
  | {
      readonly _tag: "Valid";
      readonly manifest: ApprovedOpenSpecManifestV1;
      readonly sha256: string;
    }
  | { readonly _tag: "Invalid" };

export type ApprovedOpenSpecManifestValidationResultV1 =
  | { readonly _tag: "Valid" }
  | { readonly _tag: "Invalid" };

type OpenSpecWorkflowV1 = "foreman-architectural" | "foreman-bounded";

type SchemaRole = "user" | "host";

const SCHEMA_ROLE: Readonly<Record<string, SchemaRole>> = {
  "foreman.design-approval.v1": "user",
  "foreman.checks-evidence.v1": "host",
  "foreman.release-audit.v1": "host",
  "foreman.council-request.v1": "host",
  "foreman.evaluation-authority.v1": "user",
  "foreman.release-action-outcome.v1": "host",
  "foreman.council-outcome.v1": "host",
  "foreman.evaluation-verdict.v1": "host",
  "foreman.execution-child-cancel.v1": "user",
  "foreman.execution-child-invalidate.v1": "user",
  "foreman.release-evidence-bundle.v1": "host",
};

const RELEASE_ACTIONS: readonly ReleaseActionV1[] = [
  "implement",
  "verify",
  "audit",
  "correct",
  "council",
  "provider_retry",
  "resume",
  "integrate",
  "publish",
  "evaluate",
];

const ORDINARY_ACTIONS: readonly ReleaseActionV1[] = [
  "implement",
  "verify",
  "audit",
  "correct",
  "council",
  "integrate",
  "publish",
  "evaluate",
];

const CHECK_STATUSES = ["PASS", "FAIL"] as const;
const AUDIT_VERDICTS = [
  "APPROVED",
  "WARNING",
  "BLOCKED",
  "UNVERIFIED",
] as const;
const BLOCKING_AUDIT_VERDICTS = [
  "WARNING",
  "BLOCKED",
  "UNVERIFIED",
] as const;
const FINDING_SEVERITIES = ["low", "medium", "high", "critical"] as const;
const OUTCOME_STATUSES = ["PASS", "BLOCKING", "EXTERNAL_FAILURE"] as const;
const PASS_OUTCOME_ACTIONS = [
  "verify",
  "audit",
  "integrate",
  "publish",
  "evaluate",
] as const;
const BLOCKING_OUTCOME_ACTIONS = ["verify", "audit", "evaluate"] as const;
const COUNCIL_STATUSES = ["ADVICE", "BLOCKING"] as const;
const COUNCIL_RESERVATION_ACTIONS = [
  "council",
  "provider_retry",
  "resume",
] as const;
const EVAL_RESULTS = [
  "PROMOTE",
  "GRAPH_OFF_FAILED",
  "GRAPH_OFF_INCONCLUSIVE",
  "GRAPH_OFF_UNCOMPUTABLE",
] as const;

const UTC_SECOND =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

function invalidObject(): ReleaseAuthorityObjectParseResultV1 {
  return { _tag: "Invalid" };
}

function invalidFile(): ReleaseAuthorityFileDecodeResultV1 {
  return { _tag: "Invalid" };
}

function invalidSource(): ReleaseProducerSourceDecodeResultV1 {
  return { _tag: "Invalid" };
}

function invalidBinding(): ReleaseSourceReceiptBindingResultV1 {
  return { _tag: "Invalid" };
}

function invalidManifest(): ApprovedOpenSpecManifestBuildResultV1 {
  return { _tag: "Invalid" };
}

function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

function utf8ByteLength(text: string): number {
  return utf8Bytes(text).byteLength;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactOwnKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const own = Object.keys(value);
  if (own.length !== keys.length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
  }
  return true;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  switch (m) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(y) ? 29 : 28;
    default:
      return 0;
  }
}

function isUtcSecondTimestamp(s: string): boolean {
  if (typeof s !== "string" || s.length === 0) return false;
  const m = UTC_SECOND.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) return false;
  const dim = daysInMonth(year, month);
  if (day < 1 || day > dim) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(utc)) return false;
  const check = new Date(utc);
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() + 1 === month &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hour &&
    check.getUTCMinutes() === minute &&
    check.getUTCSeconds() === second
  );
}

function hasForbiddenControl(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isIdentifier(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const bytes = utf8ByteLength(value);
  if (bytes < 1 || bytes > 128) return false;
  if (hasForbiddenControl(value)) return false;
  if (value.includes("/") || value.includes("\\")) return false;
  return true;
}

function isFindingText(
  value: unknown,
  minBytes: number,
  maxBytes: number,
): value is string {
  if (typeof value !== "string") return false;
  const bytes = utf8ByteLength(value);
  if (bytes < minBytes || bytes > maxBytes) return false;
  if (hasForbiddenControl(value)) return false;
  return true;
}

function isLiteral<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isSafeIntInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

function decodeBase64UrlExact(text: string): Uint8Array | null {
  if (typeof text !== "string" || text.length === 0) return null;
  if (text.length % 4 === 1) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const alphabet = BASE64URL_ALPHABET;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i += 1) {
    const idx = alphabet.indexOf(text[i]!);
    if (idx < 0) return null;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex] = (buffer >> bits) & 0xff;
      outIndex += 1;
    }
  }
  if (bits !== 0 && (buffer & ((1 << bits) - 1)) !== 0) return null;
  return out.subarray(0, outIndex);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < bytes.byteLength; i += 1) {
    buffer = (buffer << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += BASE64URL_ALPHABET[(buffer >> bits) & 0x3f]!;
    }
  }
  if (bits > 0) {
    out += BASE64URL_ALPHABET[(buffer << (6 - bits)) & 0x3f]!;
  }
  return out;
}

function isSignatureEncoding(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!SIGNATURE_B64URL_RE.test(value)) return false;
  const decoded = decodeBase64UrlExact(value);
  if (decoded === null || decoded.byteLength !== 64) return false;
  return encodeBase64Url(decoded) === value;
}

function decodeSpkiKey(spkiB64Url: string): KeyObject {
  const der = decodeBase64UrlExact(spkiB64Url);
  if (der === null) {
    throw new Error("invalid_pinned_spki");
  }
  return createPublicKey({
    key: Buffer.from(der),
    format: "der",
    type: "spki",
  });
}

const USER_PUBLIC_KEY = decodeSpkiKey(USER_SPKI_B64URL);
const HOST_PUBLIC_KEY = decodeSpkiKey(HOST_SPKI_B64URL);

function keyForRole(role: SchemaRole): KeyObject {
  return role === "user" ? USER_PUBLIC_KEY : HOST_PUBLIC_KEY;
}

function fingerprintForRole(
  role: SchemaRole,
): typeof USER_KEY_SHA256 | typeof HOST_KEY_SHA256 {
  return role === "user" ? USER_KEY_SHA256 : HOST_KEY_SHA256;
}

function parseCandidate(
  value: unknown,
): ReleaseCandidateIdentityV1 | null {
  if (!isPlainObject(value)) return null;
  if (!hasExactOwnKeys(value, ["commit", "tree", "candidateSha256"])) {
    return null;
  }
  const commit = value["commit"];
  const tree = value["tree"];
  const candidateSha256 = value["candidateSha256"];
  if (typeof commit !== "string" || !isCommitSha40(commit)) return null;
  if (typeof tree !== "string" || !isCommitSha40(tree)) return null;
  if (typeof candidateSha256 !== "string" || !isSha256Hex(candidateSha256)) {
    return null;
  }
  if (sha256Hex(commit) !== candidateSha256) return null;
  return { commit, tree, candidateSha256 };
}

function parseFinding(value: unknown): ReleaseAuditFindingV1 | null {
  if (!isPlainObject(value)) return null;
  if (
    !hasExactOwnKeys(value, [
      "severity",
      "file",
      "line",
      "summary",
      "evidence",
    ])
  ) {
    return null;
  }
  const severity = value["severity"];
  const file = value["file"];
  const line = value["line"];
  const summary = value["summary"];
  const evidence = value["evidence"];
  if (!isLiteral(severity, FINDING_SEVERITIES)) return null;
  if (!isFindingText(file, 1, 4096)) return null;
  if (!isSafeIntInRange(line, 1, 2147483647)) return null;
  if (!isFindingText(summary, 1, 4096)) return null;
  if (!isFindingText(evidence, 1, 16384)) return null;
  return { severity, file, line, summary, evidence };
}

function parseFindings(
  value: unknown,
): readonly ReleaseAuditFindingV1[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > 100) return null;
  const out: ReleaseAuditFindingV1[] = [];
  for (const item of value) {
    const finding = parseFinding(item);
    if (finding === null) return null;
    out.push(finding);
  }
  return out;
}

function parseChecksCommands(
  value: unknown,
): ReleaseChecksSourceV1["commands"] | null {
  if (!Array.isArray(value)) return null;
  if (value.length < 1 || value.length > 256) return null;
  const out: {
    readonly commandSha256: string;
    readonly exitCode: number;
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
  }[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) return null;
    if (
      !hasExactOwnKeys(item, [
        "commandSha256",
        "exitCode",
        "stdoutSha256",
        "stderrSha256",
      ])
    ) {
      return null;
    }
    const commandSha256 = item["commandSha256"];
    const exitCode = item["exitCode"];
    const stdoutSha256 = item["stdoutSha256"];
    const stderrSha256 = item["stderrSha256"];
    if (typeof commandSha256 !== "string" || !isSha256Hex(commandSha256)) {
      return null;
    }
    if (!isSafeIntInRange(exitCode, 0, 255)) return null;
    if (typeof stdoutSha256 !== "string" || !isSha256Hex(stdoutSha256)) {
      return null;
    }
    if (typeof stderrSha256 !== "string" || !isSha256Hex(stderrSha256)) {
      return null;
    }
    out.push({ commandSha256, exitCode, stdoutSha256, stderrSha256 });
  }
  return out;
}

function parseEvaluationCounts(input: {
  readonly plannedRuns: unknown;
  readonly completedRuns: unknown;
  readonly unavailableRuns: unknown;
  readonly notRunRuns: unknown;
}): {
  readonly plannedRuns: 2000;
  readonly completedRuns: number;
  readonly unavailableRuns: number;
  readonly notRunRuns: number;
} | null {
  if (input.plannedRuns !== 2000) return null;
  if (!isSafeIntInRange(input.completedRuns, 0, 2000)) return null;
  if (!isSafeIntInRange(input.unavailableRuns, 0, 2000)) return null;
  if (!isSafeIntInRange(input.notRunRuns, 0, 2000)) return null;
  if (
    input.completedRuns + input.unavailableRuns + input.notRunRuns !==
    2000
  ) {
    return null;
  }
  return {
    plannedRuns: 2000,
    completedRuns: input.completedRuns,
    unavailableRuns: input.unavailableRuns,
    notRunRuns: input.notRunRuns,
  };
}

function requireIssuedAt(value: unknown): string | null {
  if (typeof value !== "string" || !isUtcSecondTimestamp(value)) return null;
  return value;
}

function requireSignature(value: unknown): string | null {
  if (!isSignatureEncoding(value)) return null;
  return value;
}

function requireIssuer(
  value: unknown,
  role: "user",
): typeof USER_KEY_SHA256 | null;
function requireIssuer(
  value: unknown,
  role: "host",
): typeof HOST_KEY_SHA256 | null;
function requireIssuer(
  value: unknown,
  role: SchemaRole,
): typeof USER_KEY_SHA256 | typeof HOST_KEY_SHA256 | null {
  const expected = fingerprintForRole(role);
  if (value !== expected) return null;
  return expected;
}

function parseDesignApproval(
  value: Record<string, unknown>,
): ReleaseAuthorityReceiptV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "packageId",
      "designCommit",
      "designTree",
      "approvedOpenSpecSha256",
      "taskPlanSha256",
      "approvalStatementSha256",
      "issuerKeySha256",
      "issuedAt",
      "signature",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.design-approval.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (!isIdentifier(value["packageId"])) return null;
  if (typeof value["designCommit"] !== "string" || !isCommitSha40(value["designCommit"])) {
    return null;
  }
  if (typeof value["designTree"] !== "string" || !isCommitSha40(value["designTree"])) {
    return null;
  }
  if (
    typeof value["approvedOpenSpecSha256"] !== "string" ||
    !isSha256Hex(value["approvedOpenSpecSha256"])
  ) {
    return null;
  }
  if (
    typeof value["taskPlanSha256"] !== "string" ||
    !isSha256Hex(value["taskPlanSha256"])
  ) {
    return null;
  }
  if (
    typeof value["approvalStatementSha256"] !== "string" ||
    !isSha256Hex(value["approvalStatementSha256"])
  ) {
    return null;
  }
  const issuerKeySha256 = requireIssuer(value["issuerKeySha256"], "user");
  const issuedAt = requireIssuedAt(value["issuedAt"]);
  const signature = requireSignature(value["signature"]);
  if (issuerKeySha256 === null || issuedAt === null || signature === null) {
    return null;
  }
  return {
    schema: "foreman.design-approval.v1",
    program: PROGRAM,
    packageId: value["packageId"],
    designCommit: value["designCommit"],
    designTree: value["designTree"],
    approvedOpenSpecSha256: value["approvedOpenSpecSha256"],
    taskPlanSha256: value["taskPlanSha256"],
    approvalStatementSha256: value["approvalStatementSha256"],
    issuerKeySha256,
    issuedAt,
    signature,
  };
}

function parseChecksEvidence(
  value: Record<string, unknown>,
): ReleaseAuthorityReceiptV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "packageId",
      "candidate",
      "status",
      "checksSha256",
      "issuerKeySha256",
      "issuedAt",
      "signature",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.checks-evidence.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (!isIdentifier(value["packageId"])) return null;
  const candidate = parseCandidate(value["candidate"]);
  if (candidate === null) return null;
  if (!isLiteral(value["status"], CHECK_STATUSES)) return null;
  if (
    typeof value["checksSha256"] !== "string" ||
    !isSha256Hex(value["checksSha256"])
  ) {
    return null;
  }
  const issuerKeySha256 = requireIssuer(value["issuerKeySha256"], "host");
  const issuedAt = requireIssuedAt(value["issuedAt"]);
  const signature = requireSignature(value["signature"]);
  if (issuerKeySha256 === null || issuedAt === null || signature === null) {
    return null;
  }
  return {
    schema: "foreman.checks-evidence.v1",
    program: PROGRAM,
    packageId: value["packageId"],
    candidate,
    status: value["status"],
    checksSha256: value["checksSha256"],
    issuerKeySha256,
    issuedAt,
    signature,
  };
}

function parseReleaseAudit(
  value: Record<string, unknown>,
): ReleaseAuthorityReceiptV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "packageId",
      "candidate",
      "verdict",
      "findings",
      "evidenceSha256",
      "issuerKeySha256",
      "issuedAt",
      "signature",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.release-audit.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (!isIdentifier(value["packageId"])) return null;
  const candidate = parseCandidate(value["candidate"]);
  if (candidate === null) return null;
  if (!isLiteral(value["verdict"], AUDIT_VERDICTS)) return null;
  const findings = parseFindings(value["findings"]);
  if (findings === null) return null;
  if (
    typeof value["evidenceSha256"] !== "string" ||
    !isSha256Hex(value["evidenceSha256"])
  ) {
    return null;
  }
  const issuerKeySha256 = requireIssuer(value["issuerKeySha256"], "host");
  const issuedAt = requireIssuedAt(value["issuedAt"]);
  const signature = requireSignature(value["signature"]);
  if (issuerKeySha256 === null || issuedAt === null || signature === null) {
    return null;
  }
  return {
    schema: "foreman.release-audit.v1",
    program: PROGRAM,
    packageId: value["packageId"],
    candidate,
    verdict: value["verdict"],
    findings,
    evidenceSha256: value["evidenceSha256"],
    issuerKeySha256,
    issuedAt,
    signature,
  };
}

function parseCouncilRequest(
  value: Record<string, unknown>,
): ReleaseAuthorityReceiptV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "packageId",
      "candidateSha256",
      "questionSha256",
      "constraintsSha256",
      "optionsSha256",
      "issuerKeySha256",
      "issuedAt",
      "signature",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.council-request.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (!isIdentifier(value["packageId"])) return null;
  if (
    typeof value["candidateSha256"] !== "string" ||
    !isSha256Hex(value["candidateSha256"])
  ) {
    return null;
  }
  if (
    typeof value["questionSha256"] !== "string" ||
    !isSha256Hex(value["questionSha256"])
  ) {
    return null;
  }
  if (
    typeof value["constraintsSha256"] !== "string" ||
    !isSha256Hex(value["constraintsSha256"])
  ) {
    return null;
  }
  if (
    typeof value["optionsSha256"] !== "string" ||
    !isSha256Hex(value["optionsSha256"])
  ) {
    return null;
  }
  const issuerKeySha256 = requireIssuer(value["issuerKeySha256"], "host");
  const issuedAt = requireIssuedAt(value["issuedAt"]);
  const signature = requireSignature(value["signature"]);
  if (issuerKeySha256 === null || issuedAt === null || signature === null) {
    return null;
  }
  return {
    schema: "foreman.council-request.v1",
    program: PROGRAM,
    packageId: value["packageId"],
    candidateSha256: value["candidateSha256"],
    questionSha256: value["questionSha256"],
    constraintsSha256: value["constraintsSha256"],
    optionsSha256: value["optionsSha256"],
    issuerKeySha256,
    issuedAt,
    signature,
  };
}

function parseEvaluationAuthority(
  value: Record<string, unknown>,
): ReleaseAuthorityReceiptV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "packageId",
      "manifestSha256",
      "issuerKeySha256",
      "issuedAt",
      "signature",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.evaluation-authority.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (value["packageId"] !== EVAL_PACKAGE) return null;
  if (
    typeof value["manifestSha256"] !== "string" ||
    !isSha256Hex(value["manifestSha256"])
  ) {
    return null;
  }
  const issuerKeySha256 = requireIssuer(value["issuerKeySha256"], "user");
  const issuedAt = requireIssuedAt(value["issuedAt"]);
  const signature = requireSignature(value["signature"]);
  if (issuerKeySha256 === null || issuedAt === null || signature === null) {
    return null;
  }
  return {
    schema: "foreman.evaluation-authority.v1",
    program: PROGRAM,
    packageId: EVAL_PACKAGE,
    manifestSha256: value["manifestSha256"],
    issuerKeySha256,
    issuedAt,
    signature,
  };
}

function parseReceipt(
  value: unknown,
): ReleaseAuthorityReceiptV1 | null {
  if (!isPlainObject(value)) return null;
  const schema = value["schema"];
  if (schema === "foreman.design-approval.v1") {
    return parseDesignApproval(value);
  }
  if (schema === "foreman.checks-evidence.v1") {
    return parseChecksEvidence(value);
  }
  if (schema === "foreman.release-audit.v1") {
    return parseReleaseAudit(value);
  }
  if (schema === "foreman.council-request.v1") {
    return parseCouncilRequest(value);
  }
  if (schema === "foreman.evaluation-authority.v1") {
    return parseEvaluationAuthority(value);
  }
  return null;
}

function parseActionOutcome(
  value: Record<string, unknown>,
): ReleaseActionOutcomeV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "rootContractId",
      "rootContractSha256",
      "familySha256",
      "childId",
      "packageId",
      "reservationAction",
      "effectiveAction",
      "reservationId",
      "originReservationId",
      "candidateSha256",
      "status",
      "evidenceSha256",
      "issuerKeySha256",
      "issuedAt",
      "signature",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.release-action-outcome.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (!isIdentifier(value["rootContractId"])) return null;
  if (
    typeof value["rootContractSha256"] !== "string" ||
    !isSha256Hex(value["rootContractSha256"])
  ) {
    return null;
  }
  if (
    typeof value["familySha256"] !== "string" ||
    !isSha256Hex(value["familySha256"])
  ) {
    return null;
  }
  if (!isIdentifier(value["childId"])) return null;
  if (!isIdentifier(value["packageId"])) return null;
  if (!isLiteral(value["reservationAction"], RELEASE_ACTIONS)) return null;
  if (!isLiteral(value["effectiveAction"], RELEASE_ACTIONS)) return null;
  const reservationAction = value["reservationAction"];
  const effectiveAction = value["effectiveAction"];
  const isWrapper =
    reservationAction === "provider_retry" ||
    reservationAction === "resume";
  if (isWrapper) {
    if (!isLiteral(effectiveAction, ORDINARY_ACTIONS)) return null;
  } else if (effectiveAction !== reservationAction) {
    return null;
  }
  if (!isIdentifier(value["reservationId"])) return null;
  if (!isIdentifier(value["originReservationId"])) return null;
  const reservationId = value["reservationId"];
  const originReservationId = value["originReservationId"];
  if (!isWrapper && originReservationId !== reservationId) {
    return null;
  }
  if (
    typeof value["candidateSha256"] !== "string" ||
    !isSha256Hex(value["candidateSha256"])
  ) {
    return null;
  }
  if (!isLiteral(value["status"], OUTCOME_STATUSES)) return null;
  const status = value["status"];
  if (status === "PASS") {
    if (!isLiteral(effectiveAction, PASS_OUTCOME_ACTIONS)) return null;
  } else if (status === "BLOCKING") {
    if (!isLiteral(effectiveAction, BLOCKING_OUTCOME_ACTIONS)) return null;
  }
  if (
    typeof value["evidenceSha256"] !== "string" ||
    !isSha256Hex(value["evidenceSha256"])
  ) {
    return null;
  }
  const issuerKeySha256 = requireIssuer(value["issuerKeySha256"], "host");
  const issuedAt = requireIssuedAt(value["issuedAt"]);
  const signature = requireSignature(value["signature"]);
  if (issuerKeySha256 === null || issuedAt === null || signature === null) {
    return null;
  }
  return {
    schema: "foreman.release-action-outcome.v1",
    program: PROGRAM,
    rootContractId: value["rootContractId"],
    rootContractSha256: value["rootContractSha256"],
    familySha256: value["familySha256"],
    childId: value["childId"],
    packageId: value["packageId"],
    reservationAction,
    effectiveAction,
    reservationId,
    originReservationId,
    candidateSha256: value["candidateSha256"],
    status,
    evidenceSha256: value["evidenceSha256"],
    issuerKeySha256,
    issuedAt,
    signature,
  };
}

function parseCouncilOutcome(
  value: Record<string, unknown>,
): ReleaseCouncilOutcomeV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "rootContractId",
      "rootContractSha256",
      "familySha256",
      "childId",
      "packageId",
      "reservationAction",
      "reservationId",
      "originReservationId",
      "candidateSha256",
      "requestSha256",
      "decisionSha256",
      "status",
      "issuerKeySha256",
      "issuedAt",
      "signature",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.council-outcome.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (!isIdentifier(value["rootContractId"])) return null;
  if (
    typeof value["rootContractSha256"] !== "string" ||
    !isSha256Hex(value["rootContractSha256"])
  ) {
    return null;
  }
  if (
    typeof value["familySha256"] !== "string" ||
    !isSha256Hex(value["familySha256"])
  ) {
    return null;
  }
  if (!isIdentifier(value["childId"])) return null;
  if (!isIdentifier(value["packageId"])) return null;
  if (!isLiteral(value["reservationAction"], COUNCIL_RESERVATION_ACTIONS)) {
    return null;
  }
  const reservationAction = value["reservationAction"];
  if (!isIdentifier(value["reservationId"])) return null;
  if (!isIdentifier(value["originReservationId"])) return null;
  const reservationId = value["reservationId"];
  const originReservationId = value["originReservationId"];
  if (
    reservationAction === "council" &&
    originReservationId !== reservationId
  ) {
    return null;
  }
  if (
    typeof value["candidateSha256"] !== "string" ||
    !isSha256Hex(value["candidateSha256"])
  ) {
    return null;
  }
  if (
    typeof value["requestSha256"] !== "string" ||
    !isSha256Hex(value["requestSha256"])
  ) {
    return null;
  }
  if (
    typeof value["decisionSha256"] !== "string" ||
    !isSha256Hex(value["decisionSha256"])
  ) {
    return null;
  }
  if (!isLiteral(value["status"], COUNCIL_STATUSES)) return null;
  const status = value["status"];
  const issuerKeySha256 = requireIssuer(value["issuerKeySha256"], "host");
  const issuedAt = requireIssuedAt(value["issuedAt"]);
  const signature = requireSignature(value["signature"]);
  if (issuerKeySha256 === null || issuedAt === null || signature === null) {
    return null;
  }
  return {
    schema: "foreman.council-outcome.v1",
    program: PROGRAM,
    rootContractId: value["rootContractId"],
    rootContractSha256: value["rootContractSha256"],
    familySha256: value["familySha256"],
    childId: value["childId"],
    packageId: value["packageId"],
    reservationAction,
    reservationId,
    originReservationId,
    candidateSha256: value["candidateSha256"],
    requestSha256: value["requestSha256"],
    decisionSha256: value["decisionSha256"],
    status,
    issuerKeySha256,
    issuedAt,
    signature,
  };
}

function parseEvaluationVerdict(
  value: Record<string, unknown>,
): ReleaseEvaluationVerdictV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "rootContractId",
      "rootContractSha256",
      "familySha256",
      "childId",
      "packageId",
      "candidateSha256",
      "authorityManifestSha256",
      "evaluationAuthorityReceiptSha256",
      "result",
      "plannedRuns",
      "completedRuns",
      "unavailableRuns",
      "notRunRuns",
      "runSetSha256",
      "reportSha256",
      "issuerKeySha256",
      "issuedAt",
      "signature",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.evaluation-verdict.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (!isIdentifier(value["rootContractId"])) return null;
  if (
    typeof value["rootContractSha256"] !== "string" ||
    !isSha256Hex(value["rootContractSha256"])
  ) {
    return null;
  }
  if (
    typeof value["familySha256"] !== "string" ||
    !isSha256Hex(value["familySha256"])
  ) {
    return null;
  }
  if (value["childId"] !== EVAL_CHILD) return null;
  if (value["packageId"] !== EVAL_PACKAGE) return null;
  if (
    typeof value["candidateSha256"] !== "string" ||
    !isSha256Hex(value["candidateSha256"])
  ) {
    return null;
  }
  if (
    typeof value["authorityManifestSha256"] !== "string" ||
    !isSha256Hex(value["authorityManifestSha256"])
  ) {
    return null;
  }
  if (
    typeof value["evaluationAuthorityReceiptSha256"] !== "string" ||
    !isSha256Hex(value["evaluationAuthorityReceiptSha256"])
  ) {
    return null;
  }
  if (!isLiteral(value["result"], EVAL_RESULTS)) return null;
  const counts = parseEvaluationCounts({
    plannedRuns: value["plannedRuns"],
    completedRuns: value["completedRuns"],
    unavailableRuns: value["unavailableRuns"],
    notRunRuns: value["notRunRuns"],
  });
  if (counts === null) return null;
  if (
    typeof value["runSetSha256"] !== "string" ||
    !isSha256Hex(value["runSetSha256"])
  ) {
    return null;
  }
  if (
    typeof value["reportSha256"] !== "string" ||
    !isSha256Hex(value["reportSha256"])
  ) {
    return null;
  }
  const issuerKeySha256 = requireIssuer(value["issuerKeySha256"], "host");
  const issuedAt = requireIssuedAt(value["issuedAt"]);
  const signature = requireSignature(value["signature"]);
  if (issuerKeySha256 === null || issuedAt === null || signature === null) {
    return null;
  }
  return {
    schema: "foreman.evaluation-verdict.v1",
    program: PROGRAM,
    rootContractId: value["rootContractId"],
    rootContractSha256: value["rootContractSha256"],
    familySha256: value["familySha256"],
    childId: EVAL_CHILD,
    packageId: EVAL_PACKAGE,
    candidateSha256: value["candidateSha256"],
    authorityManifestSha256: value["authorityManifestSha256"],
    evaluationAuthorityReceiptSha256: value["evaluationAuthorityReceiptSha256"],
    result: value["result"],
    plannedRuns: counts.plannedRuns,
    completedRuns: counts.completedRuns,
    unavailableRuns: counts.unavailableRuns,
    notRunRuns: counts.notRunRuns,
    runSetSha256: value["runSetSha256"],
    reportSha256: value["reportSha256"],
    issuerKeySha256,
    issuedAt,
    signature,
  };
}

function parseCancelApproval(
  value: Record<string, unknown>,
): ExecutionChildTerminalApprovalV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "rootContractId",
      "rootContractSha256",
      "familySha256",
      "childId",
      "reasonSha256",
      "issuerKeySha256",
      "issuedAt",
      "signature",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.execution-child-cancel.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (!isIdentifier(value["rootContractId"])) return null;
  if (
    typeof value["rootContractSha256"] !== "string" ||
    !isSha256Hex(value["rootContractSha256"])
  ) {
    return null;
  }
  if (
    typeof value["familySha256"] !== "string" ||
    !isSha256Hex(value["familySha256"])
  ) {
    return null;
  }
  if (!isIdentifier(value["childId"])) return null;
  if (
    typeof value["reasonSha256"] !== "string" ||
    !isSha256Hex(value["reasonSha256"])
  ) {
    return null;
  }
  const issuerKeySha256 = requireIssuer(value["issuerKeySha256"], "user");
  const issuedAt = requireIssuedAt(value["issuedAt"]);
  const signature = requireSignature(value["signature"]);
  if (issuerKeySha256 === null || issuedAt === null || signature === null) {
    return null;
  }
  return {
    schema: "foreman.execution-child-cancel.v1",
    program: PROGRAM,
    rootContractId: value["rootContractId"],
    rootContractSha256: value["rootContractSha256"],
    familySha256: value["familySha256"],
    childId: value["childId"],
    reasonSha256: value["reasonSha256"],
    issuerKeySha256,
    issuedAt,
    signature,
  };
}

function parseInvalidateApproval(
  value: Record<string, unknown>,
): ExecutionChildTerminalApprovalV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "rootContractId",
      "rootContractSha256",
      "familySha256",
      "childId",
      "observedFamilySha256",
      "reasonSha256",
      "issuerKeySha256",
      "issuedAt",
      "signature",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.execution-child-invalidate.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (!isIdentifier(value["rootContractId"])) return null;
  if (
    typeof value["rootContractSha256"] !== "string" ||
    !isSha256Hex(value["rootContractSha256"])
  ) {
    return null;
  }
  if (
    typeof value["familySha256"] !== "string" ||
    !isSha256Hex(value["familySha256"])
  ) {
    return null;
  }
  if (!isIdentifier(value["childId"])) return null;
  if (
    typeof value["observedFamilySha256"] !== "string" ||
    !isSha256Hex(value["observedFamilySha256"])
  ) {
    return null;
  }
  if (
    typeof value["reasonSha256"] !== "string" ||
    !isSha256Hex(value["reasonSha256"])
  ) {
    return null;
  }
  const issuerKeySha256 = requireIssuer(value["issuerKeySha256"], "user");
  const issuedAt = requireIssuedAt(value["issuedAt"]);
  const signature = requireSignature(value["signature"]);
  if (issuerKeySha256 === null || issuedAt === null || signature === null) {
    return null;
  }
  return {
    schema: "foreman.execution-child-invalidate.v1",
    program: PROGRAM,
    rootContractId: value["rootContractId"],
    rootContractSha256: value["rootContractSha256"],
    familySha256: value["familySha256"],
    childId: value["childId"],
    observedFamilySha256: value["observedFamilySha256"],
    reasonSha256: value["reasonSha256"],
    issuerKeySha256,
    issuedAt,
    signature,
  };
}

function parsePriorReservation(
  value: unknown,
): FailedReservationAuthorityV1 | null {
  if (!isPlainObject(value)) return null;
  if (
    !hasExactOwnKeys(value, [
      "reservationId",
      "originReservationId",
      "originalAction",
      "candidate",
      "failureEvidenceSha256",
    ])
  ) {
    return null;
  }
  if (!isIdentifier(value["reservationId"])) return null;
  if (!isIdentifier(value["originReservationId"])) return null;
  if (!isLiteral(value["originalAction"], ORDINARY_ACTIONS)) return null;
  const candidate = parseCandidate(value["candidate"]);
  if (candidate === null) return null;
  if (
    typeof value["failureEvidenceSha256"] !== "string" ||
    !isSha256Hex(value["failureEvidenceSha256"])
  ) {
    return null;
  }
  return {
    reservationId: value["reservationId"],
    originReservationId: value["originReservationId"],
    originalAction: value["originalAction"],
    candidate,
    failureEvidenceSha256: value["failureEvidenceSha256"],
  };
}

function isDesignReceipt(
  receipt: ReleaseAuthorityReceiptV1,
): receipt is Extract<
  ReleaseAuthorityReceiptV1,
  { readonly schema: "foreman.design-approval.v1" }
> {
  return receipt.schema === "foreman.design-approval.v1";
}

function isChecksReceipt(
  receipt: ReleaseAuthorityReceiptV1,
): receipt is Extract<
  ReleaseAuthorityReceiptV1,
  { readonly schema: "foreman.checks-evidence.v1" }
> {
  return receipt.schema === "foreman.checks-evidence.v1";
}

function isAuditReceipt(
  receipt: ReleaseAuthorityReceiptV1,
): receipt is Extract<
  ReleaseAuthorityReceiptV1,
  { readonly schema: "foreman.release-audit.v1" }
> {
  return receipt.schema === "foreman.release-audit.v1";
}

function isCouncilRequestReceipt(
  receipt: ReleaseAuthorityReceiptV1,
): receipt is Extract<
  ReleaseAuthorityReceiptV1,
  { readonly schema: "foreman.council-request.v1" }
> {
  return receipt.schema === "foreman.council-request.v1";
}

function isEvaluationAuthorityReceipt(
  receipt: ReleaseAuthorityReceiptV1,
): receipt is Extract<
  ReleaseAuthorityReceiptV1,
  { readonly schema: "foreman.evaluation-authority.v1" }
> {
  return receipt.schema === "foreman.evaluation-authority.v1";
}

function receiptsMatchOrdinaryAction(
  action: ReleaseActionV1,
  receipts: readonly ReleaseAuthorityReceiptV1[],
): boolean {
  switch (action) {
    case "implement":
    case "verify":
      return receipts.length === 1 && isDesignReceipt(receipts[0]!);
    case "audit":
      return (
        receipts.length === 2 &&
        isDesignReceipt(receipts[0]!) &&
        isChecksReceipt(receipts[1]!) &&
        receipts[1]!.status === "PASS"
      );
    case "correct": {
      if (receipts.length !== 2 || !isDesignReceipt(receipts[0]!)) return false;
      const second = receipts[1]!;
      if (isChecksReceipt(second)) return second.status === "FAIL";
      if (isAuditReceipt(second)) {
        return isLiteral(second.verdict, BLOCKING_AUDIT_VERDICTS);
      }
      return false;
    }
    case "council":
      return (
        receipts.length === 2 &&
        isDesignReceipt(receipts[0]!) &&
        isCouncilRequestReceipt(receipts[1]!)
      );
    case "integrate":
    case "publish":
      return (
        receipts.length === 2 &&
        isDesignReceipt(receipts[0]!) &&
        isAuditReceipt(receipts[1]!) &&
        receipts[1]!.verdict === "APPROVED" &&
        receipts[1]!.findings.length === 0
      );
    case "evaluate":
      return (
        receipts.length === 2 &&
        isDesignReceipt(receipts[0]!) &&
        isEvaluationAuthorityReceipt(receipts[1]!)
      );
    case "provider_retry":
    case "resume":
      return false;
  }
}

function parseEvidenceBundle(
  value: Record<string, unknown>,
): ReleaseEvidenceBundleV1 | null {
  const hasPrior = Object.prototype.hasOwnProperty.call(
    value,
    "priorReservation",
  );
  const baseKeys = [
    "schema",
    "program",
    "rootContractId",
    "rootContractSha256",
    "familySha256",
    "childId",
    "packageId",
    "action",
    "candidate",
    "taskPlanSha256",
    "receipts",
    "issuerKeySha256",
    "issuedAt",
    "signature",
  ] as const;
  const expectedKeys = hasPrior
    ? ([...baseKeys, "priorReservation"] as const)
    : baseKeys;
  if (!hasExactOwnKeys(value, expectedKeys)) return null;
  if (value["schema"] !== "foreman.release-evidence-bundle.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (!isIdentifier(value["rootContractId"])) return null;
  if (
    typeof value["rootContractSha256"] !== "string" ||
    !isSha256Hex(value["rootContractSha256"])
  ) {
    return null;
  }
  if (
    typeof value["familySha256"] !== "string" ||
    !isSha256Hex(value["familySha256"])
  ) {
    return null;
  }
  if (!isIdentifier(value["childId"])) return null;
  if (!isIdentifier(value["packageId"])) return null;
  if (!isLiteral(value["action"], RELEASE_ACTIONS)) return null;
  const candidate = parseCandidate(value["candidate"]);
  if (candidate === null) return null;
  if (
    typeof value["taskPlanSha256"] !== "string" ||
    !isSha256Hex(value["taskPlanSha256"])
  ) {
    return null;
  }
  if (!Array.isArray(value["receipts"])) return null;
  if (value["receipts"].length < 1 || value["receipts"].length > 2) return null;
  const receipts: ReleaseAuthorityReceiptV1[] = [];
  for (const item of value["receipts"]) {
    const receipt = parseReceipt(item);
    if (receipt === null) return null;
    receipts.push(receipt);
  }
  const issuerKeySha256 = requireIssuer(value["issuerKeySha256"], "host");
  const issuedAt = requireIssuedAt(value["issuedAt"]);
  const signature = requireSignature(value["signature"]);
  if (issuerKeySha256 === null || issuedAt === null || signature === null) {
    return null;
  }

  const action = value["action"];
  if (action === "provider_retry" || action === "resume") {
    if (!hasPrior) return null;
    const priorReservation = parsePriorReservation(value["priorReservation"]);
    if (priorReservation === null) return null;
    if (
      !receiptsMatchOrdinaryAction(priorReservation.originalAction, receipts)
    ) {
      return null;
    }
    return {
      schema: "foreman.release-evidence-bundle.v1",
      program: PROGRAM,
      rootContractId: value["rootContractId"],
      rootContractSha256: value["rootContractSha256"],
      familySha256: value["familySha256"],
      childId: value["childId"],
      packageId: value["packageId"],
      action,
      candidate,
      taskPlanSha256: value["taskPlanSha256"],
      receipts,
      priorReservation,
      issuerKeySha256,
      issuedAt,
      signature,
    };
  }

  if (hasPrior) return null;
  if (!receiptsMatchOrdinaryAction(action, receipts)) return null;
  return {
    schema: "foreman.release-evidence-bundle.v1",
    program: PROGRAM,
    rootContractId: value["rootContractId"],
    rootContractSha256: value["rootContractSha256"],
    familySha256: value["familySha256"],
    childId: value["childId"],
    packageId: value["packageId"],
    action,
    candidate,
    taskPlanSha256: value["taskPlanSha256"],
    receipts,
    issuerKeySha256,
    issuedAt,
    signature,
  };
}

function parseAuthorityObject(
  value: unknown,
): ReleaseAuthorityObjectV1 | null {
  if (!isPlainObject(value)) return null;
  const schema = value["schema"];
  if (typeof schema !== "string") return null;
  switch (schema) {
    case "foreman.design-approval.v1":
      return parseDesignApproval(value);
    case "foreman.checks-evidence.v1":
      return parseChecksEvidence(value);
    case "foreman.release-audit.v1":
      return parseReleaseAudit(value);
    case "foreman.council-request.v1":
      return parseCouncilRequest(value);
    case "foreman.evaluation-authority.v1":
      return parseEvaluationAuthority(value);
    case "foreman.release-action-outcome.v1":
      return parseActionOutcome(value);
    case "foreman.council-outcome.v1":
      return parseCouncilOutcome(value);
    case "foreman.evaluation-verdict.v1":
      return parseEvaluationVerdict(value);
    case "foreman.execution-child-cancel.v1":
      return parseCancelApproval(value);
    case "foreman.execution-child-invalidate.v1":
      return parseInvalidateApproval(value);
    case "foreman.release-evidence-bundle.v1":
      return parseEvidenceBundle(value);
    default:
      return null;
  }
}

function stripSignature(
  value: ReleaseAuthorityObjectV1,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (key === "signature") continue;
    out[key] = field;
  }
  return out;
}

function verifyObjectSignature(value: ReleaseAuthorityObjectV1): boolean {
  const role = SCHEMA_ROLE[value.schema];
  if (role === undefined) return false;
  if (value.issuerKeySha256 !== fingerprintForRole(role)) return false;
  const signatureBytes = decodeBase64UrlExact(value.signature);
  if (signatureBytes === null || signatureBytes.byteLength !== 64) return false;
  const message = releaseAuthoritySignaturePreimageV1(stripSignature(value));
  try {
    return verifyEd25519(
      null,
      message,
      keyForRole(role),
      Buffer.from(signatureBytes),
    );
  } catch {
    return false;
  }
}

function decodeCanonicalObjectFile(
  bytes: Uint8Array,
): { readonly value: unknown; readonly sha256: string } | null {
  if (bytes.byteLength > ONE_MIB) return null;
  const textOrFailure = decodeUtf8Fatal(bytes);
  if (isCoreFailure(textOrFailure)) return null;
  const text = textOrFailure;
  if (!text.endsWith("\n") || text.endsWith("\r\n")) return null;
  const body = text.slice(0, -1);
  // Exactly one trailing LF: reject a second LF before it.
  if (body.endsWith("\n")) return null;
  let parsed: unknown;
  try {
    parsed = parseJsonRejectDuplicateKeys(body);
  } catch {
    return null;
  }
  if (isCoreFailure(parsed)) return null;
  let canonical: string;
  try {
    canonical = canonicalize(parsed);
  } catch {
    return null;
  }
  if (canonical !== body) return null;
  return { value: parsed, sha256: sha256Hex(bytes) };
}

function parseChecksSource(
  value: Record<string, unknown>,
): ReleaseChecksSourceV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "packageId",
      "candidate",
      "status",
      "commands",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.checks-source.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (!isIdentifier(value["packageId"])) return null;
  const candidate = parseCandidate(value["candidate"]);
  if (candidate === null) return null;
  if (!isLiteral(value["status"], CHECK_STATUSES)) return null;
  const commands = parseChecksCommands(value["commands"]);
  if (commands === null) return null;
  return {
    schema: "foreman.checks-source.v1",
    program: PROGRAM,
    packageId: value["packageId"],
    candidate,
    status: value["status"],
    commands,
  };
}

function parseAuditSource(
  value: Record<string, unknown>,
): ReleaseAuditSourceV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "packageId",
      "candidate",
      "verdict",
      "findings",
      "auditArtifactSha256",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.audit-source.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (!isIdentifier(value["packageId"])) return null;
  const candidate = parseCandidate(value["candidate"]);
  if (candidate === null) return null;
  if (!isLiteral(value["verdict"], AUDIT_VERDICTS)) return null;
  const findings = parseFindings(value["findings"]);
  if (findings === null) return null;
  if (
    typeof value["auditArtifactSha256"] !== "string" ||
    !isSha256Hex(value["auditArtifactSha256"])
  ) {
    return null;
  }
  return {
    schema: "foreman.audit-source.v1",
    program: PROGRAM,
    packageId: value["packageId"],
    candidate,
    verdict: value["verdict"],
    findings,
    auditArtifactSha256: value["auditArtifactSha256"],
  };
}

function parseEvaluationReportSource(
  value: Record<string, unknown>,
): ReleaseEvaluationReportSourceV1 | null {
  if (
    !hasExactOwnKeys(value, [
      "schema",
      "program",
      "packageId",
      "candidateSha256",
      "authorityManifestSha256",
      "evaluationAuthorityReceiptSha256",
      "result",
      "plannedRuns",
      "completedRuns",
      "unavailableRuns",
      "notRunRuns",
      "runSetSha256",
      "reportArtifactSha256",
    ])
  ) {
    return null;
  }
  if (value["schema"] !== "foreman.evaluation-report-source.v1") return null;
  if (value["program"] !== PROGRAM) return null;
  if (value["packageId"] !== EVAL_PACKAGE) return null;
  if (
    typeof value["candidateSha256"] !== "string" ||
    !isSha256Hex(value["candidateSha256"])
  ) {
    return null;
  }
  if (
    typeof value["authorityManifestSha256"] !== "string" ||
    !isSha256Hex(value["authorityManifestSha256"])
  ) {
    return null;
  }
  if (
    typeof value["evaluationAuthorityReceiptSha256"] !== "string" ||
    !isSha256Hex(value["evaluationAuthorityReceiptSha256"])
  ) {
    return null;
  }
  if (!isLiteral(value["result"], EVAL_RESULTS)) return null;
  const counts = parseEvaluationCounts({
    plannedRuns: value["plannedRuns"],
    completedRuns: value["completedRuns"],
    unavailableRuns: value["unavailableRuns"],
    notRunRuns: value["notRunRuns"],
  });
  if (counts === null) return null;
  if (
    typeof value["runSetSha256"] !== "string" ||
    !isSha256Hex(value["runSetSha256"])
  ) {
    return null;
  }
  if (
    typeof value["reportArtifactSha256"] !== "string" ||
    !isSha256Hex(value["reportArtifactSha256"])
  ) {
    return null;
  }
  return {
    schema: "foreman.evaluation-report-source.v1",
    program: PROGRAM,
    packageId: EVAL_PACKAGE,
    candidateSha256: value["candidateSha256"],
    authorityManifestSha256: value["authorityManifestSha256"],
    evaluationAuthorityReceiptSha256:
      value["evaluationAuthorityReceiptSha256"],
    result: value["result"],
    plannedRuns: counts.plannedRuns,
    completedRuns: counts.completedRuns,
    unavailableRuns: counts.unavailableRuns,
    notRunRuns: counts.notRunRuns,
    runSetSha256: value["runSetSha256"],
    reportArtifactSha256: value["reportArtifactSha256"],
  };
}

function parseProducerSource(
  value: unknown,
): ReleaseProducerSourceV1 | null {
  if (!isPlainObject(value)) return null;
  const schema = value["schema"];
  if (schema === "foreman.checks-source.v1") return parseChecksSource(value);
  if (schema === "foreman.audit-source.v1") return parseAuditSource(value);
  if (schema === "foreman.evaluation-report-source.v1") {
    return parseEvaluationReportSource(value);
  }
  return null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function compareUtf8(a: string, b: string): number {
  const ab = utf8Bytes(a);
  const bb = utf8Bytes(b);
  const n = Math.min(ab.byteLength, bb.byteLength);
  for (let i = 0; i < n; i += 1) {
    if (ab[i]! !== bb[i]!) return ab[i]! - bb[i]!;
  }
  return ab.byteLength - bb.byteLength;
}

function isValidPackageRelativePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  if (hasForbiddenControl(path)) return false;
  if (path.includes("\\")) return false;
  if (path.startsWith("/")) return false;
  if (/^[A-Za-z]:\//.test(path)) return false;
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      return false;
    }
  }
  return true;
}

type ManifestPathKind = "proposal" | "design" | "spec" | "tasks" | "other";

function classifyManifestPath(path: string): ManifestPathKind {
  if (path === "proposal.md") return "proposal";
  if (path === "design.md") return "design";
  if (path === "tasks.md") return "tasks";
  if (
    path.startsWith("specs/") &&
    path.endsWith(".md") &&
    path.length > "specs/".length + ".md".length
  ) {
    return "spec";
  }
  return "other";
}

function parseManifestObject(
  value: unknown,
): ApprovedOpenSpecManifestV1 | null {
  if (!isPlainObject(value)) return null;
  if (!hasExactOwnKeys(value, ["schema", "files"])) return null;
  if (value["schema"] !== MANIFEST_SCHEMA) return null;
  if (!Array.isArray(value["files"])) return null;
  const files: { readonly path: string; readonly sha256: string }[] = [];
  for (const row of value["files"]) {
    if (!isPlainObject(row)) return null;
    if (!hasExactOwnKeys(row, ["path", "sha256"])) return null;
    const path = row["path"];
    const digest = row["sha256"];
    if (typeof path !== "string" || typeof digest !== "string") return null;
    if (!isSha256Hex(digest)) return null;
    files.push({ path, sha256: digest });
  }
  return { schema: MANIFEST_SCHEMA, files };
}

export function releaseAuthoritySignaturePreimageV1(
  unsignedObject: unknown,
): Uint8Array {
  const canonical = canonicalize(unsignedObject);
  const domainBytes = utf8Bytes(DOMAIN);
  const canonicalBytes = utf8Bytes(canonical);
  const out = new Uint8Array(domainBytes.byteLength + 1 + canonicalBytes.byteLength);
  out.set(domainBytes, 0);
  out[domainBytes.byteLength] = 0x0a;
  out.set(canonicalBytes, domainBytes.byteLength + 1);
  return out;
}

export function parseReleaseAuthorityObjectV1(
  value: unknown,
): ReleaseAuthorityObjectParseResultV1 {
  try {
    const parsed = parseAuthorityObject(value);
    if (parsed === null) return invalidObject();
    return { _tag: "Valid", value: parsed };
  } catch {
    return invalidObject();
  }
}

export function decodeReleaseAuthorityFileV1(
  bytes: Uint8Array,
): ReleaseAuthorityFileDecodeResultV1 {
  try {
    if (!(bytes instanceof Uint8Array)) return invalidFile();
    const decoded = decodeCanonicalObjectFile(bytes);
    if (decoded === null) return invalidFile();
    const parsed = parseAuthorityObject(decoded.value);
    if (parsed === null) return invalidFile();
    if (!verifyObjectSignature(parsed)) return invalidFile();
    if (parsed.schema === "foreman.release-evidence-bundle.v1") {
      for (const receipt of parsed.receipts) {
        if (!verifyObjectSignature(receipt)) return invalidFile();
      }
    }
    return {
      _tag: "Valid",
      value: parsed,
      sha256: decoded.sha256,
    };
  } catch {
    return invalidFile();
  }
}

export function decodeReleaseProducerSourceFileV1(
  bytes: Uint8Array,
): ReleaseProducerSourceDecodeResultV1 {
  try {
    if (!(bytes instanceof Uint8Array)) return invalidSource();
    const decoded = decodeCanonicalObjectFile(bytes);
    if (decoded === null) return invalidSource();
    const parsed = parseProducerSource(decoded.value);
    if (parsed === null) return invalidSource();
    return {
      _tag: "Valid",
      value: parsed,
      sha256: decoded.sha256,
    };
  } catch {
    return invalidSource();
  }
}

export function verifyReleaseSourceReceiptBindingV1(
  sourceBytes: Uint8Array,
  receiptBytes: Uint8Array,
): ReleaseSourceReceiptBindingResultV1 {
  try {
    const source = decodeReleaseProducerSourceFileV1(sourceBytes);
    if (source._tag !== "Valid") return invalidBinding();
    const receipt = decodeReleaseAuthorityFileV1(receiptBytes);
    if (receipt._tag !== "Valid") return invalidBinding();

    const src = source.value;
    const rec = receipt.value;

    if (
      src.schema === "foreman.checks-source.v1" &&
      rec.schema === "foreman.checks-evidence.v1"
    ) {
      if (src.packageId !== rec.packageId) return invalidBinding();
      if (!deepEqual(src.candidate, rec.candidate)) return invalidBinding();
      if (src.status !== rec.status) return invalidBinding();
      if (rec.checksSha256 !== source.sha256) return invalidBinding();
      return { _tag: "Valid" };
    }

    if (
      src.schema === "foreman.audit-source.v1" &&
      rec.schema === "foreman.release-audit.v1"
    ) {
      if (src.packageId !== rec.packageId) return invalidBinding();
      if (!deepEqual(src.candidate, rec.candidate)) return invalidBinding();
      if (src.verdict !== rec.verdict) return invalidBinding();
      if (!deepEqual(src.findings, rec.findings)) return invalidBinding();
      if (rec.evidenceSha256 !== source.sha256) return invalidBinding();
      return { _tag: "Valid" };
    }

    if (
      src.schema === "foreman.evaluation-report-source.v1" &&
      rec.schema === "foreman.evaluation-verdict.v1"
    ) {
      if (src.candidateSha256 !== rec.candidateSha256) return invalidBinding();
      if (src.authorityManifestSha256 !== rec.authorityManifestSha256) {
        return invalidBinding();
      }
      if (
        src.evaluationAuthorityReceiptSha256 !==
        rec.evaluationAuthorityReceiptSha256
      ) {
        return invalidBinding();
      }
      if (src.result !== rec.result) return invalidBinding();
      if (src.plannedRuns !== rec.plannedRuns) return invalidBinding();
      if (src.completedRuns !== rec.completedRuns) return invalidBinding();
      if (src.unavailableRuns !== rec.unavailableRuns) return invalidBinding();
      if (src.notRunRuns !== rec.notRunRuns) return invalidBinding();
      if (src.runSetSha256 !== rec.runSetSha256) return invalidBinding();
      if (rec.reportSha256 !== source.sha256) return invalidBinding();
      return { _tag: "Valid" };
    }

    return invalidBinding();
  } catch {
    return invalidBinding();
  }
}

export function buildApprovedOpenSpecManifestV1(input: unknown): ApprovedOpenSpecManifestBuildResultV1 {
  try {
    if (!isPlainObject(input)) return invalidManifest();
    if (!hasExactOwnKeys(input, ["workflow", "files"])) return invalidManifest();
    const workflow = input["workflow"];
    if (
      workflow !== "foreman-architectural" &&
      workflow !== "foreman-bounded"
    ) {
      return invalidManifest();
    }
    const files = input["files"];
    if (!Array.isArray(files) || files.length === 0) return invalidManifest();

    const rows: { readonly path: string; readonly bytes: Uint8Array }[] = [];
    for (const row of files) {
      if (!isPlainObject(row)) return invalidManifest();
      if (!hasExactOwnKeys(row, ["path", "bytes"])) return invalidManifest();
      const path = row["path"];
      const bytes = row["bytes"];
      if (typeof path !== "string") return invalidManifest();
      if (!(bytes instanceof Uint8Array)) return invalidManifest();
      if (!isValidPackageRelativePath(path)) return invalidManifest();
      rows.push({ path, bytes });
    }

    for (let i = 0; i < rows.length; i += 1) {
      if (i > 0 && compareUtf8(rows[i - 1]!.path, rows[i]!.path) >= 0) {
        return invalidManifest();
      }
    }

    let proposalCount = 0;
    let designCount = 0;
    let specCount = 0;
    const manifestFiles: { readonly path: string; readonly sha256: string }[] =
      [];

    for (const row of rows) {
      const kind = classifyManifestPath(row.path);
      if (kind === "tasks" || kind === "other") return invalidManifest();
      if (kind === "design") {
        if (workflow === "foreman-bounded") return invalidManifest();
        designCount += 1;
      } else if (kind === "proposal") {
        proposalCount += 1;
      } else if (kind === "spec") {
        specCount += 1;
      }
      manifestFiles.push({
        path: row.path,
        sha256: sha256Hex(row.bytes),
      });
    }

    if (proposalCount !== 1) return invalidManifest();
    if (specCount < 1) return invalidManifest();
    if (designCount > 1) return invalidManifest();

    const manifest: ApprovedOpenSpecManifestV1 = {
      schema: MANIFEST_SCHEMA,
      files: manifestFiles,
    };
    const digest = sha256Hex(utf8Bytes(canonicalize(manifest)));
    return { _tag: "Valid", manifest, sha256: digest };
  } catch {
    return invalidManifest();
  }
}

export function validateApprovedOpenSpecManifestV1(
  input: unknown,
): ApprovedOpenSpecManifestValidationResultV1 {
  try {
    if (!isPlainObject(input)) return { _tag: "Invalid" };
    if (!hasExactOwnKeys(input, ["workflow", "manifest", "files"])) {
      return { _tag: "Invalid" };
    }
    const workflow = input["workflow"];
    if (
      workflow !== "foreman-architectural" &&
      workflow !== "foreman-bounded"
    ) {
      return { _tag: "Invalid" };
    }
    const manifest = parseManifestObject(input["manifest"]);
    if (manifest === null) return { _tag: "Invalid" };

    const built = buildApprovedOpenSpecManifestV1({
      workflow: workflow as OpenSpecWorkflowV1,
      files: input["files"],
    });
    if (built._tag !== "Valid") return { _tag: "Invalid" };
    if (!deepEqual(built.manifest, manifest)) return { _tag: "Invalid" };
    return { _tag: "Valid" };
  } catch {
    return { _tag: "Invalid" };
  }
}
