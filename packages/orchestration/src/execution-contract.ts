import {
  canonicalize,
  decodeUtf8Fatal,
  isCommitSha40,
  isCoreFailure,
  isSha256Hex,
  parseJsonRejectDuplicateKeys,
  sha256Hex,
} from "@foreman/core";
import { decodeRunId, isUtcSecondTimestamp } from "@foreman/event-log";
import {
  isReleaseProgram,
  RELEASE_PROGRAMS,
  releaseProgramTable,
  type ReleasePackageBriefV1,
  type ReleaseProgram,
} from "@foreman/policy";

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

export type ExecutionChildTranche = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type ExecutionChildBriefV1 = {
  readonly schema: "foreman.execution-child-brief.v1";
  readonly childId: string;
  readonly tranche: ExecutionChildTranche;
  readonly packageId: string;
  readonly dependencyChildIds: readonly string[];
  readonly objective: string;
  readonly acceptance: readonly string[];
  readonly allowedPaths: readonly string[];
};

export type ExecutionFamilySourceV1 = {
  readonly schema: "foreman.execution-family-source.v1";
  readonly program: ReleaseProgram;
  readonly familyId: "v040-release-20260822-f1";
  readonly children: readonly ExecutionChildBriefV1[];
};

export type StandardChildLimitsV2 = {
  readonly kind: "standard";
  readonly implementationRounds: 30;
  readonly correctionRounds: 20;
  readonly auditRounds: 20;
  readonly councilRounds: 10;
  readonly providerRetries: 10;
  readonly resumeAttempts: 10;
  readonly verificationRunsPerCandidate: 5;
  readonly totalActions: 100;
  readonly wallTimeMs: 1_209_600_000;
  readonly noProductChangeMs: 259_200_000;
};

export type EvaluationChildLimitsV2 = {
  readonly kind: "evaluation";
  readonly implementationRounds: 10;
  readonly correctionRounds: 5;
  readonly auditRounds: 10;
  readonly councilRounds: 5;
  readonly providerRetries: 8;
  readonly resumeAttempts: 5;
  readonly verificationRunsPerCandidate: 3;
  readonly evaluationRuns: 2000;
  readonly totalActions: 2048;
  readonly wallTimeMs: 3_888_000_000;
  readonly noProgressMs: 3_600_000;
};

export type ExecutionChildLimitsV2 =
  | StandardChildLimitsV2
  | EvaluationChildLimitsV2;

export type ExecutionChildContractV2 = {
  readonly childId: string;
  readonly tranche: ExecutionChildTranche;
  readonly packageId: string;
  readonly objectiveSha256: string;
  readonly acceptanceSha256: string;
  readonly allowedPathsSha256: string;
  readonly dependencyChildIds: readonly string[];
  readonly deadlineAt: string;
  readonly limits: ExecutionChildLimitsV2;
  readonly requiredMilestones: readonly ExecutionMilestone[];
};

export type ExecutionContractFamilyV2 = {
  readonly schemaVersion: 2;
  readonly program?: ReleaseProgram;
  readonly familyId: "v040-release-20260822-f1";
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly track1Commit: string;
  readonly track1Tree: string;
  readonly sourceSha256: string;
  readonly createdAt: string;
  readonly deadlineAt: string;
  readonly wallTimeMs: 5_184_000_000;
  readonly totalActions: 4096;
  readonly children: readonly ExecutionChildContractV2[];
};

export type ExecutionFamilyFailureReason =
  | "invalid_source"
  | "invalid_manifest"
  | "invalid_identity"
  | "invalid_digest"
  | "invalid_git_identity"
  | "invalid_timestamp"
  | "invalid_deadline"
  | "invalid_children"
  | "invalid_content"
  | "invalid_paths"
  | "invalid_limits";

export type ExecutionFamilyFailure = {
  readonly _tag: "ExecutionFamilyFailure";
  readonly reason: ExecutionFamilyFailureReason;
};

export type ExecutionFamilyDerivationV2 =
  | {
      readonly _tag: "Valid";
      readonly source: ExecutionFamilySourceV1;
      readonly manifest: ExecutionContractFamilyV2;
      readonly familySha256: string;
      readonly briefs: Readonly<Record<string, ReleasePackageBriefV1>>;
    }
  | { readonly _tag: "Invalid"; readonly reason: ExecutionFamilyFailureReason };

const FAMILY_ID = "v040-release-20260822-f1" as const;
const FAMILY_WALL_TIME_MS = 5_184_000_000 as const;
const FAMILY_TOTAL_ACTIONS = 4096 as const;
const FAMILY_SOURCE_MAX_BYTES = 1_048_576;
const textEncoder = new TextEncoder();

const standardChildLimits: StandardChildLimitsV2 = {
  kind: "standard",
  implementationRounds: 30,
  correctionRounds: 20,
  auditRounds: 20,
  councilRounds: 10,
  providerRetries: 10,
  resumeAttempts: 10,
  verificationRunsPerCandidate: 5,
  totalActions: 100,
  wallTimeMs: 1_209_600_000,
  noProductChangeMs: 259_200_000,
};

const evaluationChildLimits: EvaluationChildLimitsV2 = {
  kind: "evaluation",
  implementationRounds: 10,
  correctionRounds: 5,
  auditRounds: 10,
  councilRounds: 5,
  providerRetries: 8,
  resumeAttempts: 5,
  verificationRunsPerCandidate: 3,
  evaluationRuns: 2000,
  totalActions: 2048,
  wallTimeMs: 3_888_000_000,
  noProgressMs: 3_600_000,
};

const expectedFamilyChildren = [
  {
    tranche: 2,
    childId: "v040-t2-project-registry",
    packageId: "project-registry",
    dependencyChildIds: [],
  },
  {
    tranche: 3,
    childId: "v040-t3-memory-index",
    packageId: "external-memory-index",
    dependencyChildIds: ["v040-t2-project-registry"],
  },
  {
    tranche: 4,
    childId: "v040-t4-appliance",
    packageId: "hermetic-foreman-appliance",
    dependencyChildIds: [],
  },
  {
    tranche: 5,
    childId: "v040-t5-graphify",
    packageId: "knowledge-plane-refresh",
    dependencyChildIds: [],
  },
  {
    tranche: 6,
    childId: "v040-t6-work-dag",
    packageId: "work-dag-projection",
    dependencyChildIds: ["v040-t5-graphify"],
  },
  {
    tranche: 7,
    childId: "v040-t7-context",
    packageId: "graph-context-builder",
    dependencyChildIds: ["v040-t6-work-dag"],
  },
  {
    tranche: 8,
    childId: "v040-t8-evaluation",
    packageId: "graph-eval-falsification",
    dependencyChildIds: [
      "v040-t3-memory-index",
      "v040-t4-appliance",
      "v040-t7-context",
    ],
  },
  {
    tranche: 9,
    childId: "v040-t9-release",
    packageId: "v040-release-program",
    dependencyChildIds: [
      "v040-t2-project-registry",
      "v040-t3-memory-index",
      "v040-t4-appliance",
      "v040-t5-graphify",
      "v040-t6-work-dag",
      "v040-t7-context",
      "v040-t8-evaluation",
    ],
  },
] as const satisfies readonly Pick<
  ExecutionChildBriefV1,
  "tranche" | "childId" | "packageId" | "dependencyChildIds"
>[];

type ExpectedFamilyChild = {
  readonly tranche: ExecutionChildTranche;
  readonly childId: string;
  readonly packageId: string;
  readonly dependencyChildIds: readonly string[];
};

function remapTemplateChildId(
  templateId: string,
  program: ReleaseProgram,
): string {
  const table = releaseProgramTable(program);
  const v040 = releaseProgramTable("v040");
  if (table.evaluationChild !== null && templateId === v040.evaluationChild) {
    return table.evaluationChild;
  }
  if (!templateId.startsWith(v040.childIdPrefix)) return templateId;
  return `${table.childIdPrefix}${templateId.slice(v040.childIdPrefix.length)}`;
}

function expectedChildrenFor(program: ReleaseProgram): readonly ExpectedFamilyChild[] {
  const table = releaseProgramTable(program);
  const [trancheMin, trancheMax] = table.trancheRange;
  const v040Eval = releaseProgramTable("v040").evaluationChild;
  return expectedFamilyChildren
    .filter((child) => {
      if (child.tranche < trancheMin || child.tranche > trancheMax) return false;
      if (table.evaluationChild === null && child.childId === v040Eval) {
        return false;
      }
      return true;
    })
    .map((child) => ({
      tranche: child.tranche,
      childId: remapTemplateChildId(child.childId, program),
      packageId: child.packageId,
      dependencyChildIds: child.dependencyChildIds
        .filter((dep) => {
          const depChild = expectedFamilyChildren.find((row) => row.childId === dep);
          if (depChild === undefined) return false;
          if (depChild.tranche < trancheMin || depChild.tranche > trancheMax) {
            return false;
          }
          if (table.evaluationChild === null && dep === v040Eval) return false;
          return true;
        })
        .map((dep) => remapTemplateChildId(dep, program)),
    }));
}

function childViolatesProgram(
  value: unknown,
  program: ReleaseProgram,
): boolean {
  if (!isPlainRecordV2(value)) return false;
  const table = releaseProgramTable(program);
  const [trancheMin, trancheMax] = table.trancheRange;
  if (
    typeof value.tranche === "number" &&
    (value.tranche < trancheMin || value.tranche > trancheMax)
  ) {
    return true;
  }
  if (typeof value.childId === "string") {
    if (!value.childId.startsWith(table.childIdPrefix)) return true;
    if (
      table.evaluationChild === null &&
      value.childId === releaseProgramTable("v040").evaluationChild
    ) {
      return true;
    }
  }
  return false;
}

const familySourceKeys = new Set(["schema", "program", "familyId", "children"]);
const childBriefKeys = new Set([
  "schema",
  "childId",
  "tranche",
  "packageId",
  "dependencyChildIds",
  "objective",
  "acceptance",
  "allowedPaths",
]);
const familyManifestKeys = new Set([
  "schemaVersion",
  "familyId",
  "rootContractId",
  "rootContractSha256",
  "track1Commit",
  "track1Tree",
  "sourceSha256",
  "createdAt",
  "deadlineAt",
  "wallTimeMs",
  "totalActions",
  "children",
]);
const childContractKeys = new Set([
  "childId",
  "tranche",
  "packageId",
  "objectiveSha256",
  "acceptanceSha256",
  "allowedPathsSha256",
  "dependencyChildIds",
  "deadlineAt",
  "limits",
  "requiredMilestones",
]);

function familyFailure(
  reason: ExecutionFamilyFailureReason,
): ExecutionFamilyFailure {
  return { _tag: "ExecutionFamilyFailure", reason };
}

export function isExecutionFamilyFailure(
  value: unknown,
): value is ExecutionFamilyFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly _tag?: unknown })._tag === "ExecutionFamilyFailure"
  );
}

function isPlainRecordV2(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeysV2(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
): boolean {
  const own = Object.keys(value);
  return own.length === keys.size && own.every((key) => keys.has(key));
}

function hasFamilyManifestKeys(value: Record<string, unknown>): boolean {
  const own = Object.keys(value);
  for (const key of own) {
    if (!familyManifestKeys.has(key) && key !== "program") return false;
  }
  for (const key of familyManifestKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
  }
  return true;
}

function resolveFamilyProgram(value: Record<string, unknown>): ReleaseProgram | null {
  if (!Object.prototype.hasOwnProperty.call(value, "program")) {
    return RELEASE_PROGRAMS[0]!;
  }
  return isReleaseProgram(value.program) ? value.program : null;
}

function validUnicodeText(value: string): boolean {
  const decoded = decodeUtf8Fatal(textEncoder.encode(value));
  return !isCoreFailure(decoded) && decoded === value;
}

function validBoundedText(
  value: unknown,
  maximum: number,
  allowLf: boolean,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    textEncoder.encode(value).byteLength <= maximum &&
    validUnicodeText(value) &&
    !(allowLf ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(
      value,
    )
  );
}

function compareUtf8V2(left: string, right: string): number {
  const a = textEncoder.encode(left);
  const b = textEncoder.encode(right);
  const length = Math.min(a.byteLength, b.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = a[index]! - b[index]!;
    if (difference !== 0) return difference;
  }
  return a.byteLength - b.byteLength;
}

function validAllowedPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^[\x21-\x7e]+$/.test(value) ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.includes("\\")
  ) {
    return false;
  }
  const prefix = value.endsWith("/**");
  const base = prefix ? value.slice(0, -3) : value;
  if (base.length === 0 || /[*?[\]{}]/.test(base)) return false;
  const segments = base.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

export function executionChildPathMatchesV1(
  allowedPath: string,
  changedPath: string,
): boolean {
  if (!validAllowedPath(allowedPath) || !validAllowedPath(changedPath)) {
    return false;
  }
  if (!allowedPath.endsWith("/**")) return allowedPath === changedPath;
  const prefix = allowedPath.slice(0, -2);
  return changedPath.startsWith(prefix) && changedPath.length > prefix.length;
}

function sameStrings(
  value: unknown,
  expected: readonly string[],
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function decodeChildBriefV1(
  value: unknown,
  expected: ExpectedFamilyChild,
  program: ReleaseProgram,
): ExecutionChildBriefV1 | ExecutionFamilyFailure {
  if (!isPlainRecordV2(value) || !hasExactKeysV2(value, childBriefKeys)) {
    return familyFailure("invalid_children");
  }
  const table = releaseProgramTable(program);
  const [trancheMin, trancheMax] = table.trancheRange;
  if (
    value.schema !== "foreman.execution-child-brief.v1" ||
    typeof value.childId !== "string" ||
    value.childId !== expected.childId ||
    !value.childId.startsWith(table.childIdPrefix) ||
    value.tranche !== expected.tranche ||
    expected.tranche < trancheMin ||
    expected.tranche > trancheMax ||
    (table.evaluationChild === null &&
      value.childId === releaseProgramTable("v040").evaluationChild) ||
    (table.evaluationChild !== null &&
      expected.childId === table.evaluationChild &&
      value.childId !== table.evaluationChild) ||
    value.packageId !== expected.packageId ||
    !sameStrings(value.dependencyChildIds, expected.dependencyChildIds)
  ) {
    return familyFailure("invalid_children");
  }
  if (!validBoundedText(value.objective, 16_384, true)) {
    return familyFailure("invalid_content");
  }
  if (
    !Array.isArray(value.acceptance) ||
    value.acceptance.length < 1 ||
    value.acceptance.length > 256 ||
    !value.acceptance.every((item) => validBoundedText(item, 4_096, false))
  ) {
    return familyFailure("invalid_content");
  }
  if (
    !Array.isArray(value.allowedPaths) ||
    value.allowedPaths.length < 1 ||
    value.allowedPaths.length > 256 ||
    !value.allowedPaths.every(validAllowedPath)
  ) {
    return familyFailure("invalid_paths");
  }
  for (let index = 1; index < value.allowedPaths.length; index += 1) {
    if (compareUtf8V2(value.allowedPaths[index - 1]!, value.allowedPaths[index]!) >= 0) {
      return familyFailure("invalid_paths");
    }
  }
  return {
    schema: "foreman.execution-child-brief.v1",
    childId: expected.childId,
    tranche: expected.tranche,
    packageId: expected.packageId,
    dependencyChildIds: [...expected.dependencyChildIds],
    objective: value.objective,
    acceptance: [...value.acceptance] as string[],
    allowedPaths: [...value.allowedPaths] as string[],
  };
}

export function decodeExecutionFamilySourceV1(
  value: unknown,
): ExecutionFamilySourceV1 | ExecutionFamilyFailure {
  if (!isPlainRecordV2(value) || !hasExactKeysV2(value, familySourceKeys)) {
    return familyFailure("invalid_source");
  }
  if (
    value.schema !== "foreman.execution-family-source.v1" ||
    !isReleaseProgram(value.program) ||
    value.familyId !== FAMILY_ID ||
    !Array.isArray(value.children)
  ) {
    return familyFailure("invalid_source");
  }
  const expectedChildren = expectedChildrenFor(value.program);
  if (value.children.length !== expectedChildren.length) {
    return familyFailure("invalid_source");
  }
  const children: ExecutionChildBriefV1[] = [];
  for (const [index, expected] of expectedChildren.entries()) {
    const raw = value.children[index];
    if (childViolatesProgram(raw, value.program)) {
      return familyFailure("invalid_source");
    }
    const child = decodeChildBriefV1(raw, expected, value.program);
    if (isExecutionFamilyFailure(child)) return child;
    children.push(child);
  }
  return {
    schema: "foreman.execution-family-source.v1",
    program: value.program,
    familyId: FAMILY_ID,
    children,
  };
}

export function decodeExecutionFamilySourceFileV1(
  bytes: Uint8Array,
): ExecutionFamilySourceV1 | ExecutionFamilyFailure {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > FAMILY_SOURCE_MAX_BYTES) {
      return familyFailure("invalid_source");
    }
    const text = decodeUtf8Fatal(bytes);
    if (isCoreFailure(text) || !text.endsWith("\n") || text.endsWith("\r\n")) {
      return familyFailure("invalid_source");
    }
    const body = text.slice(0, -1);
    const parsed = parseJsonRejectDuplicateKeys(body);
    if (isCoreFailure(parsed) || canonicalize(parsed) !== body) {
      return familyFailure("invalid_source");
    }
    return decodeExecutionFamilySourceV1(JSON.parse(body) as unknown);
  } catch {
    return familyFailure("invalid_source");
  }
}

function expectedChildLimits(
  program: ReleaseProgram,
  childId: string,
): ExecutionChildLimitsV2 {
  return releaseProgramTable(program).evaluationChild === childId
    ? evaluationChildLimits
    : standardChildLimits;
}

function expectedChildMilestones(
  tranche: ExecutionChildBriefV1["tranche"],
): readonly ExecutionMilestone[] {
  return tranche === 9
    ? ["checks", "audit", "integrated", "published"]
    : ["checks", "audit", "integrated"];
}

function samePlainValue(left: unknown, right: unknown): boolean {
  try {
    return isPlainRecordV2(left) && canonicalize(left) === canonicalize(right);
  } catch {
    return false;
  }
}

export function decodeExecutionContractFamilyV2(
  value: unknown,
): ExecutionContractFamilyV2 | ExecutionFamilyFailure {
  if (!isPlainRecordV2(value) || !hasFamilyManifestKeys(value)) {
    return familyFailure("invalid_manifest");
  }
  const program = resolveFamilyProgram(value);
  if (program === null) {
    return familyFailure("invalid_manifest");
  }
  if (
    value.schemaVersion !== 2 ||
    value.familyId !== FAMILY_ID ||
    value.wallTimeMs !== FAMILY_WALL_TIME_MS ||
    value.totalActions !== FAMILY_TOTAL_ACTIONS
  ) {
    return familyFailure("invalid_manifest");
  }
  if (
    typeof value.rootContractId !== "string" ||
    typeof decodeRunId(value.rootContractId) !== "string"
  ) {
    return familyFailure("invalid_identity");
  }
  if (
    typeof value.rootContractSha256 !== "string" ||
    typeof value.sourceSha256 !== "string" ||
    !isSha256Hex(value.rootContractSha256) ||
    !isSha256Hex(value.sourceSha256)
  ) {
    return familyFailure("invalid_digest");
  }
  if (
    typeof value.track1Commit !== "string" ||
    typeof value.track1Tree !== "string" ||
    !isCommitSha40(value.track1Commit) ||
    !isCommitSha40(value.track1Tree)
  ) {
    return familyFailure("invalid_git_identity");
  }
  if (
    typeof value.createdAt !== "string" ||
    typeof value.deadlineAt !== "string" ||
    !isUtcSecondTimestamp(value.createdAt) ||
    !isUtcSecondTimestamp(value.deadlineAt)
  ) {
    return familyFailure("invalid_timestamp");
  }
  if (
    Date.parse(value.deadlineAt) - Date.parse(value.createdAt) !==
    FAMILY_WALL_TIME_MS
  ) {
    return familyFailure("invalid_deadline");
  }
  const expectedChildren = expectedChildrenFor(program);
  if (!Array.isArray(value.children) || value.children.length !== expectedChildren.length) {
    return familyFailure("invalid_children");
  }

  const children: ExecutionChildContractV2[] = [];
  for (const [index, expected] of expectedChildren.entries()) {
    const raw = value.children[index];
    if (childViolatesProgram(raw, program)) {
      return familyFailure("invalid_manifest");
    }
    if (!isPlainRecordV2(raw) || !hasExactKeysV2(raw, childContractKeys)) {
      return familyFailure("invalid_children");
    }
    if (
      raw.childId !== expected.childId ||
      raw.tranche !== expected.tranche ||
      raw.packageId !== expected.packageId ||
      !sameStrings(raw.dependencyChildIds, expected.dependencyChildIds) ||
      raw.deadlineAt !== value.deadlineAt ||
      !sameStrings(raw.requiredMilestones, expectedChildMilestones(expected.tranche))
    ) {
      return familyFailure("invalid_children");
    }
    if (
      typeof raw.objectiveSha256 !== "string" ||
      typeof raw.acceptanceSha256 !== "string" ||
      typeof raw.allowedPathsSha256 !== "string" ||
      !isSha256Hex(raw.objectiveSha256) ||
      !isSha256Hex(raw.acceptanceSha256) ||
      !isSha256Hex(raw.allowedPathsSha256)
    ) {
      return familyFailure("invalid_digest");
    }
    const limits = expectedChildLimits(program, expected.childId);
    if (!samePlainValue(raw.limits, limits)) {
      return familyFailure("invalid_limits");
    }
    children.push({
      childId: expected.childId,
      tranche: expected.tranche,
      packageId: expected.packageId,
      objectiveSha256: raw.objectiveSha256,
      acceptanceSha256: raw.acceptanceSha256,
      allowedPathsSha256: raw.allowedPathsSha256,
      dependencyChildIds: [...expected.dependencyChildIds],
      deadlineAt: value.deadlineAt,
      limits,
      requiredMilestones: expectedChildMilestones(expected.tranche),
    });
  }
  return {
    schemaVersion: 2,
    ...(Object.prototype.hasOwnProperty.call(value, "program")
      ? { program }
      : {}),
    familyId: FAMILY_ID,
    rootContractId: value.rootContractId,
    rootContractSha256: value.rootContractSha256,
    track1Commit: value.track1Commit,
    track1Tree: value.track1Tree,
    sourceSha256: value.sourceSha256,
    createdAt: value.createdAt,
    deadlineAt: value.deadlineAt,
    wallTimeMs: FAMILY_WALL_TIME_MS,
    totalActions: FAMILY_TOTAL_ACTIONS,
    children,
  };
}

export function executionContractFamilySha256(
  family: ExecutionContractFamilyV2,
): string {
  return sha256Hex(canonicalize(family));
}

function canonicalFileSha256V2(value: unknown): string {
  return sha256Hex(textEncoder.encode(`${canonicalize(value)}\n`));
}

export function deriveExecutionContractFamilyV2(input: {
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly track1Commit: string;
  readonly track1Tree: string;
  readonly sourceBytes: Uint8Array;
  readonly createdAt: string;
}): ExecutionFamilyDerivationV2 {
  try {
    const source = decodeExecutionFamilySourceFileV1(input.sourceBytes);
    if (isExecutionFamilyFailure(source)) {
      return { _tag: "Invalid", reason: source.reason };
    }
    if (
      typeof input.rootContractId !== "string" ||
      typeof decodeRunId(input.rootContractId) !== "string"
    ) {
      return { _tag: "Invalid", reason: "invalid_identity" };
    }
    if (!isSha256Hex(input.rootContractSha256)) {
      return { _tag: "Invalid", reason: "invalid_digest" };
    }
    if (
      !isCommitSha40(input.track1Commit) ||
      !isCommitSha40(input.track1Tree)
    ) {
      return { _tag: "Invalid", reason: "invalid_git_identity" };
    }
    if (!isUtcSecondTimestamp(input.createdAt)) {
      return { _tag: "Invalid", reason: "invalid_timestamp" };
    }
    const deadlineMs = Date.parse(input.createdAt) + FAMILY_WALL_TIME_MS;
    if (!Number.isSafeInteger(deadlineMs)) {
      return { _tag: "Invalid", reason: "invalid_deadline" };
    }
    const deadlineAt = new Date(deadlineMs).toISOString().replace(".000Z", "Z");
    if (!isUtcSecondTimestamp(deadlineAt)) {
      return { _tag: "Invalid", reason: "invalid_deadline" };
    }

    const children: ExecutionChildContractV2[] = source.children.map((child) => ({
      childId: child.childId,
      tranche: child.tranche,
      packageId: child.packageId,
      objectiveSha256: canonicalFileSha256V2({
        schema: "foreman.execution-child-objective.v1",
        childId: child.childId,
        objective: child.objective,
      }),
      acceptanceSha256: canonicalFileSha256V2({
        schema: "foreman.execution-child-acceptance.v1",
        childId: child.childId,
        acceptance: child.acceptance,
      }),
      allowedPathsSha256: canonicalFileSha256V2({
        schema: "foreman.execution-child-paths.v1",
        childId: child.childId,
        allowedPaths: child.allowedPaths,
      }),
      dependencyChildIds: [...child.dependencyChildIds],
      deadlineAt,
      limits: expectedChildLimits(source.program, child.childId),
      requiredMilestones: expectedChildMilestones(child.tranche),
    }));
    const manifest: ExecutionContractFamilyV2 = {
      schemaVersion: 2,
      ...(source.program === RELEASE_PROGRAMS[0]
        ? {}
        : { program: source.program }),
      familyId: FAMILY_ID,
      rootContractId: input.rootContractId,
      rootContractSha256: input.rootContractSha256,
      track1Commit: input.track1Commit,
      track1Tree: input.track1Tree,
      sourceSha256: sha256Hex(input.sourceBytes),
      createdAt: input.createdAt,
      deadlineAt,
      wallTimeMs: FAMILY_WALL_TIME_MS,
      totalActions: FAMILY_TOTAL_ACTIONS,
      children,
    };
    const decodedManifest = decodeExecutionContractFamilyV2(manifest);
    if (isExecutionFamilyFailure(decodedManifest)) {
      return { _tag: "Invalid", reason: decodedManifest.reason };
    }
    const familySha256 = executionContractFamilySha256(decodedManifest);
    const briefs: Record<string, ReleasePackageBriefV1> = {};
    for (const child of source.children) {
      briefs[child.packageId] = {
        schema: "foreman.release-package-brief.v1",
        familySha256,
        childId: child.childId,
        packageId: child.packageId,
        objective: child.objective,
        acceptance: [...child.acceptance],
        allowedPaths: [...child.allowedPaths],
      };
    }
    return {
      _tag: "Valid",
      source,
      manifest: decodedManifest,
      familySha256,
      briefs,
    };
  } catch {
    return { _tag: "Invalid", reason: "invalid_source" };
  }
}
