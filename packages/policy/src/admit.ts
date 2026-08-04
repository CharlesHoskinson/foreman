import {
  isNonEmptyClosedString,
  CANONICAL_REGISTER_ID,
  type AdmissionRequest,
  type CheckResult,
  type CurrentEntry,
  type DenialReason,
  type Register,
} from "./schema.js";
import {
  approvalChronologyValid,
  isRfc3339Instant,
} from "./rfc3339.js";
import { validateApprovalDelta } from "./approval-delta.js";
import { extractRegister } from "./register.js";
import type { GitCommitSnapshot } from "./services.js";

export type GitIdentitySnapshot = GitCommitSnapshot;

const GLOB_META = /[*?[\]{}]/;
const GROUP_SEP = /[,;|]/;

function pathHasGlob(path: string): boolean {
  return GLOB_META.test(path);
}

function pathIsGroup(path: string): boolean {
  return GROUP_SEP.test(path);
}

function denied(entryId: string | null, reason: DenialReason): CheckResult {
  return { schemaVersion: 1, _tag: "Denied", entryId, reason };
}

function failed(reason: DenialReason): CheckResult {
  return { schemaVersion: 1, _tag: "Failed", reason };
}

/**
 * Pure admission against register extracted from commit C's blob.
 *
 * Non-approved states deny without requiring approval-commit shape or parent
 * register parse.
 * Approved entries require R4 eligibility + single-row approval delta vs P.
 */
export function admitCheck(
  register: Register,
  registerSha256: string,
  request: AdmissionRequest,
  nowMs: number,
  gitIdentity: GitIdentitySnapshot,
): CheckResult {
  if (request.schemaVersion !== 1) {
    return failed("schema_mismatch");
  }

  if (register.registerId !== CANONICAL_REGISTER_ID) {
    return failed("register_id_mismatch");
  }

  const current = register.currentEntries.find((e) => e.id === request.entryId);
  if (!current) {
    const hist = register.historicalIncidents.find(
      (e) => e.id === request.entryId,
    );
    if (hist) {
      return denied(request.entryId, "historical_incident");
    }
    return denied(request.entryId, "entry_not_found");
  }

  return admitEntry(
    current,
    register,
    request.entryId,
    registerSha256,
    nowMs,
    gitIdentity,
  );
}

function admitEntry(
  entry: CurrentEntry,
  currentRegister: Register,
  entryId: string,
  registerSha256: string,
  nowMs: number,
  git: GitIdentitySnapshot,
): CheckResult {
  if (entry.state === "blocked") {
    return denied(entryId, "state_blocked");
  }
  if (entry.state === "pending") {
    return denied(entryId, "state_pending");
  }
  if (entry.state !== "approved") {
    return denied(entryId, "state_not_approved");
  }

  if (entry.owner === "pending") {
    return denied(entryId, "pending_owner");
  }
  if (!isNonEmptyClosedString(entry.owner)) {
    return denied(entryId, "empty_owner");
  }

  if (entry.evidence === "pending") {
    return denied(entryId, "pending_evidence");
  }
  if (!isNonEmptyClosedString(entry.evidence)) {
    return denied(entryId, "empty_evidence");
  }

  if (entry.recordedAt === "pending") {
    return denied(entryId, "pending_recorded_at");
  }
  if (!isRfc3339Instant(entry.recordedAt)) {
    return denied(entryId, "invalid_recorded_at");
  }

  if (entry.recoveryStatus === "pending") {
    return denied(entryId, "pending_recovery");
  }
  if (entry.recoveryStatus !== "recovery_ready") {
    return denied(entryId, "recovery_not_ready");
  }

  if (!entry.approval) {
    return denied(entryId, "missing_approval");
  }
  const ap = entry.approval;

  if (!isNonEmptyClosedString(ap.approver)) {
    return denied(entryId, "invalid_approval");
  }
  if (!isNonEmptyClosedString(ap.evidence)) {
    return denied(entryId, "invalid_approval");
  }

  // Full chronology: recordedAt <= approvedAt <= now < expiresAt
  const chrono = approvalChronologyValid(
    entry.recordedAt,
    ap.approvedAt,
    ap.expiresAt,
    nowMs,
  );
  if (chrono === "recorded_after_approval") {
    return denied(entryId, "invalid_recorded_at");
  }
  if (chrono === "invalid" || chrono === "reversed" || chrono === "not_yet") {
    return denied(entryId, "invalid_approval");
  }
  if (chrono === "expired") {
    return denied(entryId, "expired_approval");
  }

  if (ap.actionKind !== "artifact_relocate") {
    return denied(entryId, "unsupported_action");
  }
  if (entry.actionKind !== "artifact_relocate") {
    return denied(entryId, "unsupported_action");
  }

  if (!git.approvalCommitEligible || git.parentP === null || git.treeP === null) {
    return denied(entryId, "approval_commit_ineligible");
  }
  if (ap.candidateCommitSha !== git.parentP) {
    return denied(entryId, "candidate_mismatch");
  }
  if (ap.candidateTreeSha !== git.treeP) {
    return denied(entryId, "tree_mismatch");
  }

  // Parent register for single-row delta (only when approving)
  if (git.parentBlobBytes === null) {
    return denied(entryId, "approval_commit_ineligible");
  }
  const parentExtracted = extractRegister(git.parentBlobBytes);
  if ("_tag" in parentExtracted) {
    return denied(entryId, "approval_commit_ineligible");
  }
  const delta = validateApprovalDelta(
    parentExtracted.register,
    currentRegister,
    entryId,
  );
  if (delta !== null) {
    return denied(entryId, delta);
  }

  const ar = entry.artifactRelocate;
  if (!ar) {
    return denied(entryId, "schema_mismatch");
  }
  if (pathHasGlob(ar.sourcePath) || pathHasGlob(ar.recoveryPath)) {
    return denied(entryId, "glob_target");
  }
  if (pathIsGroup(ar.sourcePath) || pathIsGroup(ar.recoveryPath)) {
    return denied(entryId, "group_target");
  }

  return {
    schemaVersion: 1,
    _tag: "Authorized",
    entryId,
    actionKind: "artifact_relocate",
    registerSha256,
  };
}
