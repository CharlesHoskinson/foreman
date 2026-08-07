import {
  isNonEmptyClosedString,
  CANONICAL_REGISTER_ID,
  CANONICAL_REGISTER_RELPATH,
  MAX_TRACKED_BATCH_BYTES,
  MAX_TRACKED_DELETE_TARGETS,
  MAX_TRACKED_PATH_BYTES,
  type AdmissionRequest,
  type CheckResult,
  type CurrentEntry,
  type DenialReason,
  type Register,
  type TrackedDeleteTarget,
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

/**
 * Pure path checks for a register-bound tracked_delete target path.
 * Returns null when the path is an exact, canonical repository-relative path.
 */
export function validateTrackedRelPath(path: string): DenialReason | null {
  if (path.length === 0) return "invalid_path";
  if (new TextEncoder().encode(path).byteLength > MAX_TRACKED_PATH_BYTES) {
    return "invalid_path";
  }
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.endsWith("/")
  ) {
    return "invalid_path";
  }
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg.length === 0 || seg === "." || seg === "..") {
      return "invalid_path";
    }
  }
  if (path === ".git" || path.startsWith(".git/")) {
    return "invalid_path";
  }
  if (path === CANONICAL_REGISTER_RELPATH) {
    return "register_self_target";
  }
  if (pathHasGlob(path)) return "glob_target";
  if (pathIsGroup(path)) return "group_target";
  return null;
}

function validateTrackedDeleteTargets(
  targets: readonly TrackedDeleteTarget[],
): DenialReason | null {
  if (targets.length === 0) return "schema_mismatch";
  if (targets.length > MAX_TRACKED_DELETE_TARGETS) {
    return "batch_limit_exceeded";
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const t of targets) {
    const pathReason = validateTrackedRelPath(t.path);
    if (pathReason !== null) return pathReason;
    if (seen.has(t.path)) return "duplicate_target";
    seen.add(t.path);
    if (!Number.isInteger(t.byteLength) || t.byteLength < 0) {
      return "schema_mismatch";
    }
    totalBytes += t.byteLength;
    if (totalBytes > MAX_TRACKED_BATCH_BYTES) return "batch_limit_exceeded";
    if (t.mode !== "100644" && t.mode !== "100755") {
      return "schema_mismatch";
    }
  }
  return null;
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

  if (
    entry.actionKind !== "artifact_relocate" &&
    entry.actionKind !== "tracked_delete"
  ) {
    return denied(entryId, "unsupported_action");
  }
  if (ap.actionKind !== entry.actionKind) {
    return denied(entryId, "approval_mismatch");
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

  if (entry.actionKind === "artifact_relocate") {
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

  // tracked_delete
  const td = entry.trackedDelete;
  if (!td) {
    return denied(entryId, "schema_mismatch");
  }
  const targetReason = validateTrackedDeleteTargets(td.targets);
  if (targetReason !== null) {
    return denied(entryId, targetReason);
  }

  return {
    schemaVersion: 1,
    _tag: "Authorized",
    entryId,
    actionKind: "tracked_delete",
    registerSha256,
  };
}
