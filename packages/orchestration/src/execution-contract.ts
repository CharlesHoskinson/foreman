import {
  canonicalize,
  isCommitSha40,
  isSha256Hex,
  sha256Hex,
} from "@foreman/core";
import { decodeRunId, isUtcSecondTimestamp } from "@foreman/event-log";

export const executionMilestones = [
  "checks",
  "audit",
  "integrated",
  "published",
] as const;

export type ExecutionMilestone = (typeof executionMilestones)[number];

export type ExecutionLimitsV1 = {
  readonly implementationRounds: number;
  readonly correctionRounds: number;
  readonly auditRounds: number;
  readonly councilRounds: number;
  readonly providerRetries: number;
  readonly resumeAttempts: number;
  readonly verificationRunsPerCandidate: number;
  readonly totalActions: number;
  readonly wallTimeMs: number;
  readonly noProductChangeMs: number;
};

export const strictEndstopLimits: ExecutionLimitsV1 = {
  implementationRounds: 2,
  correctionRounds: 1,
  auditRounds: 1,
  councilRounds: 1,
  providerRetries: 2,
  resumeAttempts: 2,
  verificationRunsPerCandidate: 1,
  totalActions: 12,
  wallTimeMs: 7_200_000,
  noProductChangeMs: 1_800_000,
};

export type ExecutionContractV1 = {
  readonly schemaVersion: 1;
  readonly contractId: string;
  readonly packageId: string;
  readonly objectiveSha256: string;
  readonly acceptanceSha256: string;
  readonly baseCommit: string;
  readonly allowedPathsSha256: string;
  readonly dependencyContractIds: readonly string[];
  readonly authorizationSha256: string;
  readonly createdAt: string;
  readonly deadlineAt: string;
  readonly limits: ExecutionLimitsV1;
  readonly requiredMilestones: readonly ExecutionMilestone[];
  readonly supersedesContractId?: string;
};

export type ExecutionContractFailureReason =
  | "not_object"
  | "unknown_field"
  | "invalid_schema_version"
  | "invalid_identifier"
  | "invalid_digest"
  | "invalid_base_commit"
  | "invalid_dependencies"
  | "invalid_authorization"
  | "invalid_timestamp"
  | "invalid_deadline"
  | "invalid_limits"
  | "invalid_milestones"
  | "invalid_supersession";

export type ExecutionContractFailure = {
  readonly _tag: "ExecutionContractFailure";
  readonly reason: ExecutionContractFailureReason;
};

function failure(reason: ExecutionContractFailureReason): ExecutionContractFailure {
  return { _tag: "ExecutionContractFailure", reason };
}

export function isExecutionContractFailure(
  value: unknown,
): value is ExecutionContractFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly _tag?: unknown })._tag === "ExecutionContractFailure"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const contractKeys = new Set([
  "schemaVersion",
  "contractId",
  "packageId",
  "objectiveSha256",
  "acceptanceSha256",
  "baseCommit",
  "allowedPathsSha256",
  "dependencyContractIds",
  "authorizationSha256",
  "createdAt",
  "deadlineAt",
  "limits",
  "requiredMilestones",
  "supersedesContractId",
]);

const limitKeys = new Set([
  "implementationRounds",
  "correctionRounds",
  "auditRounds",
  "councilRounds",
  "providerRetries",
  "resumeAttempts",
  "verificationRunsPerCandidate",
  "totalActions",
  "wallTimeMs",
  "noProductChangeMs",
]);

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function safeBoundedInteger(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

function decodeLimits(value: unknown): ExecutionLimitsV1 | ExecutionContractFailure {
  if (!isRecord(value) || !hasOnlyKeys(value, limitKeys)) {
    return failure("invalid_limits");
  }
  const countNames = [
    "implementationRounds",
    "correctionRounds",
    "auditRounds",
    "councilRounds",
    "providerRetries",
    "resumeAttempts",
    "verificationRunsPerCandidate",
    "totalActions",
  ] as const;
  for (const name of countNames) {
    if (!safeBoundedInteger(value[name], 1, 100)) {
      return failure("invalid_limits");
    }
  }
  if (
    !safeBoundedInteger(value.wallTimeMs, 1_000, 604_800_000) ||
    !safeBoundedInteger(value.noProductChangeMs, 1_000, value.wallTimeMs)
  ) {
    return failure("invalid_limits");
  }
  const limits = value as unknown as ExecutionLimitsV1;
  if (
    limits.implementationRounds > limits.totalActions ||
    limits.correctionRounds > limits.implementationRounds ||
    limits.auditRounds > limits.totalActions ||
    limits.councilRounds > limits.totalActions ||
    limits.providerRetries > limits.totalActions ||
    limits.resumeAttempts > limits.totalActions ||
    limits.verificationRunsPerCandidate > limits.totalActions
  ) {
    return failure("invalid_limits");
  }
  return { ...limits };
}

function decodeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return typeof decodeRunId(value) === "string" ? value : null;
}

export function decodeExecutionContractV1(
  value: unknown,
): ExecutionContractV1 | ExecutionContractFailure {
  if (!isRecord(value)) return failure("not_object");
  if (!hasOnlyKeys(value, contractKeys)) return failure("unknown_field");
  if (value.schemaVersion !== 1) return failure("invalid_schema_version");

  const contractId = decodeIdentifier(value.contractId);
  const packageId = decodeIdentifier(value.packageId);
  if (contractId === null || packageId === null) {
    return failure("invalid_identifier");
  }

  const objectiveSha256 = value.objectiveSha256;
  const acceptanceSha256 = value.acceptanceSha256;
  const allowedPathsSha256 = value.allowedPathsSha256;
  if (
    typeof objectiveSha256 !== "string" ||
    typeof acceptanceSha256 !== "string" ||
    typeof allowedPathsSha256 !== "string" ||
    !isSha256Hex(objectiveSha256) ||
    !isSha256Hex(acceptanceSha256) ||
    !isSha256Hex(allowedPathsSha256)
  ) {
    return failure("invalid_digest");
  }
  const baseCommit = value.baseCommit;
  if (typeof baseCommit !== "string" || !isCommitSha40(baseCommit)) {
    return failure("invalid_base_commit");
  }
  const authorizationSha256 = value.authorizationSha256;
  if (
    typeof authorizationSha256 !== "string" ||
    !isSha256Hex(authorizationSha256)
  ) {
    return failure("invalid_authorization");
  }

  if (!Array.isArray(value.dependencyContractIds)) {
    return failure("invalid_dependencies");
  }
  const dependencyContractIds: string[] = [];
  const dependencies = new Set<string>();
  for (const raw of value.dependencyContractIds) {
    const dependency = decodeIdentifier(raw);
    if (
      dependency === null ||
      dependency === contractId ||
      dependencies.has(dependency)
    ) {
      return failure("invalid_dependencies");
    }
    dependencies.add(dependency);
    dependencyContractIds.push(dependency);
  }

  if (
    typeof value.createdAt !== "string" ||
    typeof value.deadlineAt !== "string" ||
    !isUtcSecondTimestamp(value.createdAt) ||
    !isUtcSecondTimestamp(value.deadlineAt)
  ) {
    return failure("invalid_timestamp");
  }

  const limits = decodeLimits(value.limits);
  if (isExecutionContractFailure(limits)) return limits;
  const createdMs = Date.parse(value.createdAt);
  const deadlineMs = Date.parse(value.deadlineAt);
  if (deadlineMs <= createdMs || deadlineMs - createdMs !== limits.wallTimeMs) {
    return failure("invalid_deadline");
  }

  if (!Array.isArray(value.requiredMilestones) || value.requiredMilestones.length === 0) {
    return failure("invalid_milestones");
  }
  const milestones = new Set<ExecutionMilestone>();
  const requiredMilestones: ExecutionMilestone[] = [];
  for (const raw of value.requiredMilestones) {
    if (
      typeof raw !== "string" ||
      !executionMilestones.includes(raw as ExecutionMilestone) ||
      milestones.has(raw as ExecutionMilestone)
    ) {
      return failure("invalid_milestones");
    }
    const milestone = raw as ExecutionMilestone;
    milestones.add(milestone);
    requiredMilestones.push(milestone);
  }

  let supersedesContractId: string | undefined;
  if (value.supersedesContractId !== undefined) {
    supersedesContractId = decodeIdentifier(value.supersedesContractId) ?? undefined;
    if (supersedesContractId === undefined || supersedesContractId === contractId) {
      return failure("invalid_supersession");
    }
  }

  return {
    schemaVersion: 1,
    contractId,
    packageId,
    objectiveSha256,
    acceptanceSha256,
    baseCommit,
    allowedPathsSha256,
    dependencyContractIds,
    authorizationSha256,
    createdAt: value.createdAt,
    deadlineAt: value.deadlineAt,
    limits,
    requiredMilestones,
    ...(supersedesContractId === undefined ? {} : { supersedesContractId }),
  };
}

export function executionContractSha256(contract: ExecutionContractV1): string {
  return sha256Hex(canonicalize(contract));
}
