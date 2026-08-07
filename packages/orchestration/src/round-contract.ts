/**
 * Closed round-plan, report-snapshot, and round-outcome contracts for the
 * attempt-bound round transaction (Sprint 3 R2).
 *
 * Pure decoders only. No filesystem, process, or append logic.
 */

import {
  isSha256Hex,
  rejectUnknownKeys,
} from "@foreman/core";
import {
  decodeAttemptId,
  decodeLaneId,
  decodeRunId,
  isAttemptFailure,
  makeAttemptIdentity,
  type AttemptId,
  type AttemptIdentity,
  type LaneId,
  type RunId,
} from "@foreman/event-log";

// ---------------------------------------------------------------------------
// Bounds (UTF-8 bytes)
// ---------------------------------------------------------------------------

export const MAX_COMMAND_ARGV_ENTRIES = 256;
export const MAX_COMMAND_ARG_BYTES = 65_536;
export const MAX_COMMAND_ARGV_TOTAL_BYTES = 1_048_576;
export const MAX_GATE_COMMAND_BYTES = 1_048_576;
export const MAX_REPORT_PATH_BYTES = 32_768;
export const MAX_REPORT_CONTENT_BYTES = 8_388_608;

// ---------------------------------------------------------------------------
// Failure surface
// ---------------------------------------------------------------------------

export const ROUND_CONTRACT_FAILURE_BRAND = Symbol(
  "@foreman/orchestration/RoundContractFailure",
);

type Branded = { readonly [ROUND_CONTRACT_FAILURE_BRAND]: true };

export type RoundContractFailureReason =
  | "invalid_schema"
  | "unknown_field"
  | "bound_exceeded"
  | "nul_rejected"
  | "invalid_run_id"
  | "invalid_lane_id"
  | "invalid_attempt_id"
  | "invalid_digest"
  | "invalid_byte_length"
  | "invalid_exit_code"
  | "invalid_reason"
  | "invalid_freshness"
  | "invalid_outcome_shape"
  | "empty_command_argv"
  | "empty_first_command_arg"
  | "empty_commit";

export type RoundContractFailure = Branded & {
  readonly _tag: "RoundContractFailure";
  readonly reason: RoundContractFailureReason;
};

export function roundContractFailure(
  reason: RoundContractFailureReason,
): RoundContractFailure {
  return {
    [ROUND_CONTRACT_FAILURE_BRAND]: true,
    _tag: "RoundContractFailure",
    reason,
  };
}

export function isRoundContractFailure(
  v: unknown,
): v is RoundContractFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [ROUND_CONTRACT_FAILURE_BRAND]?: unknown })[
      ROUND_CONTRACT_FAILURE_BRAND
    ] === true &&
    (v as { _tag?: unknown })._tag === "RoundContractFailure"
  );
}

// ---------------------------------------------------------------------------
// ReportSnapshotV1
// ---------------------------------------------------------------------------

export type ReportSnapshotPresentV1 = {
  readonly _tag: "Present";
  readonly digest: string;
  readonly byteLength: number;
};

export type ReportSnapshotV1 =
  | { readonly _tag: "Absent" }
  | ReportSnapshotPresentV1;

const SNAPSHOT_PRESENT_KEYS = ["_tag", "digest", "byteLength"] as const;
const SNAPSHOT_ABSENT_KEYS = ["_tag"] as const;

/**
 * Empty report is Present with byteLength 0 (not Absent).
 */
export function presentReportSnapshot(
  digest: string,
  byteLength: number,
): ReportSnapshotPresentV1 | RoundContractFailure {
  if (typeof digest !== "string" || !isSha256Hex(digest)) {
    return roundContractFailure("invalid_digest");
  }
  if (
    typeof byteLength !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0
  ) {
    return roundContractFailure("invalid_byte_length");
  }
  if (byteLength > MAX_REPORT_CONTENT_BYTES) {
    return roundContractFailure("bound_exceeded");
  }
  return { _tag: "Present", digest, byteLength };
}

export function absentReportSnapshot(): ReportSnapshotV1 {
  return { _tag: "Absent" };
}

export function decodeReportSnapshotV1(
  value: unknown,
): ReportSnapshotV1 | RoundContractFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return roundContractFailure("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  if (!("_tag" in obj)) {
    return roundContractFailure("invalid_schema");
  }
  if (obj["_tag"] === "Absent") {
    const unknown = rejectUnknownKeys(obj, SNAPSHOT_ABSENT_KEYS);
    if (unknown !== null) {
      return roundContractFailure("unknown_field");
    }
    return { _tag: "Absent" };
  }
  if (obj["_tag"] === "Present") {
    const unknown = rejectUnknownKeys(obj, SNAPSHOT_PRESENT_KEYS);
    if (unknown !== null) {
      return roundContractFailure("unknown_field");
    }
    if (!("digest" in obj) || !("byteLength" in obj)) {
      return roundContractFailure("invalid_schema");
    }
    return presentReportSnapshot(
      obj["digest"] as string,
      obj["byteLength"] as number,
    );
  }
  return roundContractFailure("invalid_schema");
}

// ---------------------------------------------------------------------------
// Incomplete reason + exit codes
// ---------------------------------------------------------------------------

export type IncompleteReason =
  | "gate_failed"
  | "report_missing"
  | "report_empty"
  | "report_unchanged"
  | "report_too_large"
  | "report_read_failed";

const INCOMPLETE_REASONS: readonly IncompleteReason[] = [
  "gate_failed",
  "report_missing",
  "report_empty",
  "report_unchanged",
  "report_too_large",
  "report_read_failed",
] as const;

export function isIncompleteReason(v: unknown): v is IncompleteReason {
  return (
    typeof v === "string" &&
    (INCOMPLETE_REASONS as readonly string[]).includes(v)
  );
}

export function isExitCode(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 255;
}

// ---------------------------------------------------------------------------
// RoundPlanV1 / RoundRequestV1
// ---------------------------------------------------------------------------

export type RoundPlanV1 = {
  readonly schemaVersion: 1;
  readonly runId: RunId;
  readonly laneId: LaneId;
  readonly attemptId: AttemptId;
  readonly mode: "round";
  readonly commandArgv: readonly string[];
  readonly gateCommand: string;
  readonly reportPath: string;
  readonly reportBaseline: ReportSnapshotV1;
};

export type RoundRequestV1 = {
  readonly runId: RunId;
  readonly laneId: LaneId;
  readonly commandArgv: readonly string[];
  readonly gateCommand: string;
  readonly reportPath: string;
};

const ROUND_PLAN_KEYS = [
  "schemaVersion",
  "runId",
  "laneId",
  "attemptId",
  "mode",
  "commandArgv",
  "gateCommand",
  "reportPath",
  "reportBaseline",
] as const;

const ROUND_REQUEST_KEYS = [
  "runId",
  "laneId",
  "commandArgv",
  "gateCommand",
  "reportPath",
] as const;

const utf8Encoder = new TextEncoder();

/** Measure string bounds as UTF-8 bytes. */
export function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).byteLength;
}

function containsNul(text: string): boolean {
  return text.includes("\0");
}

/**
 * Decode and bound-check a command argument vector.
 * Preserves empty later entries exactly. Never joins, splits, quotes, or escapes.
 */
export function decodeCommandArgv(
  value: unknown,
): readonly string[] | RoundContractFailure {
  if (!Array.isArray(value)) {
    return roundContractFailure("invalid_schema");
  }
  if (value.length === 0) {
    return roundContractFailure("empty_command_argv");
  }
  if (value.length > MAX_COMMAND_ARGV_ENTRIES) {
    return roundContractFailure("bound_exceeded");
  }
  const args: string[] = [];
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (typeof entry !== "string") {
      return roundContractFailure("invalid_schema");
    }
    if (containsNul(entry)) {
      return roundContractFailure("nul_rejected");
    }
    const bytes = utf8ByteLength(entry);
    if (bytes > MAX_COMMAND_ARG_BYTES) {
      return roundContractFailure("bound_exceeded");
    }
    total += bytes;
    if (total > MAX_COMMAND_ARGV_TOTAL_BYTES) {
      return roundContractFailure("bound_exceeded");
    }
    if (i === 0 && entry.length === 0) {
      return roundContractFailure("empty_first_command_arg");
    }
    args.push(entry);
  }
  return args;
}

function decodeGateCommand(value: unknown): string | RoundContractFailure {
  if (typeof value !== "string") {
    return roundContractFailure("invalid_schema");
  }
  if (containsNul(value)) {
    return roundContractFailure("nul_rejected");
  }
  if (utf8ByteLength(value) > MAX_GATE_COMMAND_BYTES) {
    return roundContractFailure("bound_exceeded");
  }
  return value;
}

function decodeReportPath(value: unknown): string | RoundContractFailure {
  if (typeof value !== "string") {
    return roundContractFailure("invalid_schema");
  }
  if (containsNul(value)) {
    return roundContractFailure("nul_rejected");
  }
  if (utf8ByteLength(value) > MAX_REPORT_PATH_BYTES) {
    return roundContractFailure("bound_exceeded");
  }
  return value;
}

export function decodeRoundRequestV1(
  value: unknown,
): RoundRequestV1 | RoundContractFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return roundContractFailure("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  const unknown = rejectUnknownKeys(obj, ROUND_REQUEST_KEYS);
  if (unknown !== null) {
    return roundContractFailure("unknown_field");
  }
  // Reject attempt ID or report baseline from the caller.
  if ("attemptId" in obj || "reportBaseline" in obj) {
    return roundContractFailure("unknown_field");
  }
  for (const key of ROUND_REQUEST_KEYS) {
    if (!(key in obj)) {
      return roundContractFailure("invalid_schema");
    }
  }

  const run = decodeRunId(obj["runId"] as string);
  if (isAttemptFailure(run)) {
    return roundContractFailure("invalid_run_id");
  }
  const lane = decodeLaneId(obj["laneId"] as string);
  if (isAttemptFailure(lane)) {
    return roundContractFailure("invalid_lane_id");
  }
  const argv = decodeCommandArgv(obj["commandArgv"]);
  if (isRoundContractFailure(argv)) {
    return argv;
  }
  const gate = decodeGateCommand(obj["gateCommand"]);
  if (isRoundContractFailure(gate)) {
    return gate;
  }
  const reportPath = decodeReportPath(obj["reportPath"]);
  if (isRoundContractFailure(reportPath)) {
    return reportPath;
  }
  return {
    runId: run,
    laneId: lane,
    commandArgv: argv,
    gateCommand: gate,
    reportPath,
  };
}

export function decodeRoundPlanV1(
  value: unknown,
): RoundPlanV1 | RoundContractFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return roundContractFailure("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  const unknown = rejectUnknownKeys(obj, ROUND_PLAN_KEYS);
  if (unknown !== null) {
    return roundContractFailure("unknown_field");
  }
  for (const key of ROUND_PLAN_KEYS) {
    if (!(key in obj)) {
      return roundContractFailure("invalid_schema");
    }
  }
  if (obj["schemaVersion"] !== 1) {
    return roundContractFailure("invalid_schema");
  }
  if (obj["mode"] !== "round") {
    return roundContractFailure("invalid_schema");
  }

  const run = decodeRunId(obj["runId"] as string);
  if (isAttemptFailure(run)) {
    return roundContractFailure("invalid_run_id");
  }
  const lane = decodeLaneId(obj["laneId"] as string);
  if (isAttemptFailure(lane)) {
    return roundContractFailure("invalid_lane_id");
  }
  const attempt = decodeAttemptId(obj["attemptId"] as number);
  if (isAttemptFailure(attempt)) {
    return roundContractFailure("invalid_attempt_id");
  }
  const argv = decodeCommandArgv(obj["commandArgv"]);
  if (isRoundContractFailure(argv)) {
    return argv;
  }
  const gate = decodeGateCommand(obj["gateCommand"]);
  if (isRoundContractFailure(gate)) {
    return gate;
  }
  const reportPath = decodeReportPath(obj["reportPath"]);
  if (isRoundContractFailure(reportPath)) {
    return reportPath;
  }
  const baseline = decodeReportSnapshotV1(obj["reportBaseline"]);
  if (isRoundContractFailure(baseline)) {
    return baseline;
  }
  return {
    schemaVersion: 1,
    runId: run,
    laneId: lane,
    attemptId: attempt,
    mode: "round",
    commandArgv: argv,
    gateCommand: gate,
    reportPath,
    reportBaseline: baseline,
  };
}

export function attemptIdentityFromPlan(plan: RoundPlanV1): AttemptIdentity {
  return makeAttemptIdentity(plan.runId, plan.laneId, plan.attemptId);
}

// ---------------------------------------------------------------------------
// RoundOutcomeV1
// ---------------------------------------------------------------------------

export type RoundOutcomeCompletedV1 = {
  readonly _tag: "completed";
  readonly attemptIdentity: AttemptIdentity;
  readonly implementationExitCode: number;
  readonly gateExitCode: 0;
  readonly reportFresh: true;
  readonly reportBaseline: ReportSnapshotV1;
  readonly report: ReportSnapshotPresentV1;
};

export type RoundOutcomeIncompleteV1 = {
  readonly _tag: "incomplete";
  readonly attemptIdentity: AttemptIdentity;
  readonly implementationExitCode: number;
  readonly gateExitCode: number;
  readonly reportFresh: false;
  readonly reason: IncompleteReason;
  readonly reportBaseline: ReportSnapshotV1;
  readonly report: ReportSnapshotV1 | null;
};

export type RoundOutcomeV1 = RoundOutcomeCompletedV1 | RoundOutcomeIncompleteV1;

const OUTCOME_COMPLETED_KEYS = [
  "_tag",
  "attemptIdentity",
  "implementationExitCode",
  "gateExitCode",
  "reportFresh",
  "reportBaseline",
  "report",
] as const;

const OUTCOME_INCOMPLETE_KEYS = [
  "_tag",
  "attemptIdentity",
  "implementationExitCode",
  "gateExitCode",
  "reportFresh",
  "reason",
  "reportBaseline",
  "report",
] as const;

const ATTEMPT_IDENTITY_KEYS = ["runId", "laneId", "attemptId"] as const;

export function decodeAttemptIdentityValue(
  value: unknown,
): AttemptIdentity | RoundContractFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return roundContractFailure("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  const unknown = rejectUnknownKeys(obj, ATTEMPT_IDENTITY_KEYS);
  if (unknown !== null) {
    return roundContractFailure("unknown_field");
  }
  for (const key of ATTEMPT_IDENTITY_KEYS) {
    if (!(key in obj)) {
      return roundContractFailure("invalid_schema");
    }
  }
  const run = decodeRunId(obj["runId"] as string);
  if (isAttemptFailure(run)) {
    return roundContractFailure("invalid_run_id");
  }
  const lane = decodeLaneId(obj["laneId"] as string);
  if (isAttemptFailure(lane)) {
    return roundContractFailure("invalid_lane_id");
  }
  const attempt = decodeAttemptId(obj["attemptId"] as number);
  if (isAttemptFailure(attempt)) {
    return roundContractFailure("invalid_attempt_id");
  }
  return makeAttemptIdentity(run, lane, attempt);
}

/**
 * Enforce the OpenSpec first-match outcome matrix. Reject every incompatible
 * cross-field combination so recovery never trusts a corrupt durable outcome.
 */
export function decodeRoundOutcomeV1(
  value: unknown,
): RoundOutcomeV1 | RoundContractFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return roundContractFailure("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  if (!("_tag" in obj)) {
    return roundContractFailure("invalid_schema");
  }

  if (obj["_tag"] === "completed") {
    const unknown = rejectUnknownKeys(obj, OUTCOME_COMPLETED_KEYS);
    if (unknown !== null) {
      return roundContractFailure("unknown_field");
    }
    for (const key of OUTCOME_COMPLETED_KEYS) {
      if (!(key in obj)) {
        return roundContractFailure("invalid_schema");
      }
    }
    const identity = decodeAttemptIdentityValue(obj["attemptIdentity"]);
    if (isRoundContractFailure(identity)) {
      return identity;
    }
    if (!isExitCode(obj["implementationExitCode"])) {
      return roundContractFailure("invalid_exit_code");
    }
    if (obj["gateExitCode"] !== 0) {
      return roundContractFailure("invalid_outcome_shape");
    }
    if (obj["reportFresh"] !== true) {
      return roundContractFailure("invalid_freshness");
    }
    const baseline = decodeReportSnapshotV1(obj["reportBaseline"]);
    if (isRoundContractFailure(baseline)) {
      return baseline;
    }
    const report = decodeReportSnapshotV1(obj["report"]);
    if (isRoundContractFailure(report)) {
      return report;
    }
    // completed: Present nonempty; baseline absent OR digest differs.
    if (report._tag !== "Present" || report.byteLength === 0) {
      return roundContractFailure("invalid_outcome_shape");
    }
    if (
      baseline._tag === "Present" &&
      baseline.digest === report.digest
    ) {
      return roundContractFailure("invalid_outcome_shape");
    }
    return {
      _tag: "completed",
      attemptIdentity: identity,
      implementationExitCode: obj["implementationExitCode"],
      gateExitCode: 0,
      reportFresh: true,
      reportBaseline: baseline,
      report,
    };
  }

  if (obj["_tag"] === "incomplete") {
    const unknown = rejectUnknownKeys(obj, OUTCOME_INCOMPLETE_KEYS);
    if (unknown !== null) {
      return roundContractFailure("unknown_field");
    }
    for (const key of OUTCOME_INCOMPLETE_KEYS) {
      if (!(key in obj)) {
        return roundContractFailure("invalid_schema");
      }
    }
    const identity = decodeAttemptIdentityValue(obj["attemptIdentity"]);
    if (isRoundContractFailure(identity)) {
      return identity;
    }
    if (!isExitCode(obj["implementationExitCode"])) {
      return roundContractFailure("invalid_exit_code");
    }
    if (!isExitCode(obj["gateExitCode"])) {
      return roundContractFailure("invalid_exit_code");
    }
    if (obj["reportFresh"] !== false) {
      return roundContractFailure("invalid_freshness");
    }
    if (!isIncompleteReason(obj["reason"])) {
      return roundContractFailure("invalid_reason");
    }
    const reason = obj["reason"];
    const gateExitCode = obj["gateExitCode"];
    const baseline = decodeReportSnapshotV1(obj["reportBaseline"]);
    if (isRoundContractFailure(baseline)) {
      return baseline;
    }

    let report: ReportSnapshotV1 | null;
    if (obj["report"] === null) {
      report = null;
    } else {
      const decoded = decodeReportSnapshotV1(obj["report"]);
      if (isRoundContractFailure(decoded)) {
        return decoded;
      }
      report = decoded;
    }

    // Closed incomplete matrix (first-match durable shapes).
    switch (reason) {
      case "gate_failed":
        // Nonzero gate; report MAY be snapshot or null (hidden reader failure).
        if (gateExitCode === 0) {
          return roundContractFailure("invalid_outcome_shape");
        }
        break;
      case "report_too_large":
      case "report_read_failed":
        if (gateExitCode !== 0 || report !== null) {
          return roundContractFailure("invalid_outcome_shape");
        }
        break;
      case "report_missing":
        if (gateExitCode !== 0 || report === null || report._tag !== "Absent") {
          return roundContractFailure("invalid_outcome_shape");
        }
        break;
      case "report_empty":
        if (
          gateExitCode !== 0 ||
          report === null ||
          report._tag !== "Present" ||
          report.byteLength !== 0
        ) {
          return roundContractFailure("invalid_outcome_shape");
        }
        break;
      case "report_unchanged":
        // Both nonempty Present with the same digest (byte lengths ignored).
        if (
          gateExitCode !== 0 ||
          report === null ||
          report._tag !== "Present" ||
          report.byteLength === 0 ||
          baseline._tag !== "Present" ||
          baseline.byteLength === 0 ||
          baseline.digest !== report.digest
        ) {
          return roundContractFailure("invalid_outcome_shape");
        }
        break;
      default: {
        const _exhaustive: never = reason;
        return roundContractFailure("invalid_reason");
      }
    }

    return {
      _tag: "incomplete",
      attemptIdentity: identity,
      implementationExitCode: obj["implementationExitCode"],
      gateExitCode,
      reportFresh: false,
      reason,
      reportBaseline: baseline,
      report,
    };
  }

  return roundContractFailure("invalid_schema");
}

// ---------------------------------------------------------------------------
// CheckpointIdentityV1
// ---------------------------------------------------------------------------

export type CheckpointIdentityV1 = {
  readonly attemptIdentity: AttemptIdentity;
  readonly commit: string;
};

export function decodeCheckpointIdentityV1(
  value: unknown,
): CheckpointIdentityV1 | RoundContractFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return roundContractFailure("invalid_schema");
  }
  const obj = value as Record<string, unknown>;
  const unknown = rejectUnknownKeys(obj, ["attemptIdentity", "commit"]);
  if (unknown !== null) {
    return roundContractFailure("unknown_field");
  }
  if (!("attemptIdentity" in obj) || !("commit" in obj)) {
    return roundContractFailure("invalid_schema");
  }
  const identity = decodeAttemptIdentityValue(obj["attemptIdentity"]);
  if (isRoundContractFailure(identity)) {
    return identity;
  }
  if (typeof obj["commit"] !== "string" || obj["commit"].length === 0) {
    return roundContractFailure("empty_commit");
  }
  return {
    attemptIdentity: identity,
    commit: obj["commit"],
  };
}

export function makeCheckpointIdentity(
  attemptIdentity: AttemptIdentity,
  commit: string,
): CheckpointIdentityV1 | RoundContractFailure {
  if (typeof commit !== "string" || commit.length === 0) {
    return roundContractFailure("empty_commit");
  }
  return { attemptIdentity, commit };
}

/**
 * Compare two attempt identities by value.
 */
export function attemptIdentitiesEqual(
  a: AttemptIdentity,
  b: AttemptIdentity,
): boolean {
  return (
    a.runId === b.runId &&
    a.laneId === b.laneId &&
    a.attemptId === b.attemptId
  );
}

/**
 * Deep-equality for outcomes used by the reducer (pending vs terminal).
 */
export function roundOutcomesEqual(
  a: RoundOutcomeV1,
  b: RoundOutcomeV1,
): boolean {
  if (a._tag !== b._tag) return false;
  if (!attemptIdentitiesEqual(a.attemptIdentity, b.attemptIdentity)) {
    return false;
  }
  if (a.implementationExitCode !== b.implementationExitCode) return false;
  if (a.gateExitCode !== b.gateExitCode) return false;
  if (a.reportFresh !== b.reportFresh) return false;
  if (!snapshotsEqual(a.reportBaseline, b.reportBaseline)) return false;
  if (a._tag === "completed" && b._tag === "completed") {
    return snapshotsEqual(a.report, b.report);
  }
  if (a._tag === "incomplete" && b._tag === "incomplete") {
    if (a.reason !== b.reason) return false;
    if (a.report === null && b.report === null) return true;
    if (a.report === null || b.report === null) return false;
    return snapshotsEqual(a.report, b.report);
  }
  return false;
}

export function snapshotsEqual(
  a: ReportSnapshotV1,
  b: ReportSnapshotV1,
): boolean {
  if (a._tag !== b._tag) return false;
  if (a._tag === "Absent") return true;
  if (b._tag !== "Present") return false;
  return a.digest === b.digest && a.byteLength === b.byteLength;
}
