import {
  expectArray,
  expectExactLiteral,
  expectNumber,
  expectObject,
  expectString,
  isCommitSha40,
  isCoreFailure,
  isSha256Hex,
  rejectUnknownKeys,
  schemaMismatch,
  unknownField,
  type CoreFailure,
} from "@foreman/core";
import { isRfc3339Instant } from "./rfc3339.js";

export { isRfc3339Instant } from "./rfc3339.js";

export const CANONICAL_REGISTER_ID = "foreman-v0.3.0-destruction-register";
export const CANONICAL_REGISTER_RELPATH =
  "docs/releases/v0.3.0-destruction-log.md";

export type ActionKind =
  | "artifact_relocate"
  | "worktree_remove"
  | "branch_delete"
  | "tracked_delete"
  | "artifact_delete"
  | "inventory_only"
  | "none";

export type EntryState =
  | "blocked"
  | "proposed"
  | "proposed_externalize"
  | "proposed_replace"
  | "proposed_relocate"
  | "inventory_required"
  | "protected_reference"
  | "protected_parked"
  | "unauthorized"
  | "approved"
  | "pending";

export type HistoricalState = EntryState | "late_register_replaced_recoverable";

/** Closed recovery statuses. Only recovery_ready may authorize mutation. */
export type RecoveryStatus =
  | "pending"
  | "git_history"
  | "external_path_pending_guard"
  | "external_path"
  | "recovery_ready"
  | "not_applicable";

export type ArtifactRelocate = {
  readonly sourcePath: string;
  readonly recoveryPath: string;
  readonly byteLength: number;
  readonly sha256: string;
};

/** Regular-file modes allowed in a tracked_delete target identity. */
export type TrackedFileMode = "100644" | "100755";

/**
 * Exact tracked-file identity bound into the register for tracked_delete.
 * Path is repository-relative POSIX; blob is Git SHA-1 of the blob object.
 */
export type TrackedDeleteTarget = {
  readonly path: string;
  readonly blobSha1: string;
  readonly byteLength: number;
  readonly mode: TrackedFileMode;
};

/** Closed tracked_delete payload: non-empty ordered exact target list. */
export type TrackedDelete = {
  readonly targets: readonly TrackedDeleteTarget[];
};

/** Bounds for tracked_delete register payloads and live preflight. */
export const MAX_TRACKED_DELETE_TARGETS = 32;
export const MAX_TRACKED_PATH_BYTES = 4096;
/** Total approved target byte-length cap for one tracked_delete batch. */
export const MAX_TRACKED_BATCH_BYTES = 1_048_576;

/**
 * Closed approval facts bound into the register (never trusted from caller).
 * Required when state === "approved".
 */
export type Approval = {
  readonly approver: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly evidence: string;
  readonly actionKind: "artifact_relocate" | "tracked_delete";
  readonly candidateCommitSha: string;
  readonly candidateTreeSha: string;
};

export type CurrentEntry = {
  readonly id: string;
  readonly targetOrAction: string;
  readonly state: EntryState;
  readonly requiredCondition: string;
  readonly owner: string;
  readonly evidence: string;
  readonly recordedAt: string;
  readonly recoveryStatus: RecoveryStatus;
  readonly actionKind: ActionKind;
  readonly artifactRelocate?: ArtifactRelocate;
  readonly trackedDelete?: TrackedDelete;
  readonly approval?: Approval;
};

export type HistoricalIncident = {
  readonly id: string;
  readonly targetOrAction: string;
  readonly state: HistoricalState;
  readonly requiredCondition: string;
  readonly owner: string;
  readonly evidence: string;
  readonly recordedAt: string;
  readonly actionKind?: ActionKind;
};

export type Register = {
  readonly schemaVersion: 1;
  readonly registerId: typeof CANONICAL_REGISTER_ID | string;
  readonly currentEntries: readonly CurrentEntry[];
  readonly historicalIncidents: readonly HistoricalIncident[];
};

/** Caller request: entry only. Authority is the committed register at HEAD. */
export type AdmissionRequest = {
  readonly schemaVersion: 1;
  readonly entryId: string;
};

export type DenialReason =
  | "malformed_utf8"
  | "oversize_input"
  | "missing_begin_sentinel"
  | "missing_end_sentinel"
  | "duplicate_begin_sentinel"
  | "duplicate_end_sentinel"
  | "empty_register"
  | "non_canonical_json"
  | "duplicate_json_key"
  | "invalid_json"
  | "unknown_field"
  | "schema_mismatch"
  | "duplicate_id"
  | "duplicate_register_projection"
  | "register_id_mismatch"
  | "entry_not_found"
  | "historical_incident"
  | "state_blocked"
  | "state_pending"
  | "state_not_approved"
  | "pending_owner"
  | "pending_evidence"
  | "pending_recorded_at"
  | "pending_recovery"
  | "empty_owner"
  | "empty_evidence"
  | "invalid_recorded_at"
  | "missing_approval"
  | "invalid_approval"
  | "approval_mismatch"
  | "approval_commit_ineligible"
  | "approval_delta_mismatch"
  | "recovery_not_ready"
  | "expired_approval"
  | "unsupported_action"
  | "glob_target"
  | "group_target"
  | "register_digest_mismatch"
  | "candidate_mismatch"
  | "tree_mismatch"
  | "authority_dirty"
  | "authority_missing"
  | "source_not_regular_file"
  | "source_is_symlink"
  | "source_is_hardlink"
  | "source_size_mismatch"
  | "source_digest_mismatch"
  | "recovery_target_exists"
  | "recovery_parent_missing"
  | "platform_invariant_unproven"
  | "mutation_rejected"
  | "interrupted"
  | "internal_failed"
  | "invalid_path"
  | "duplicate_target"
  | "register_self_target"
  | "target_missing"
  | "target_untracked"
  | "target_is_submodule"
  | "mode_mismatch"
  | "working_tree_mismatch"
  | "batch_limit_exceeded";

export type ImplementedActionKind = "artifact_relocate" | "tracked_delete";

export type CheckResult =
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Authorized";
      readonly entryId: string;
      readonly actionKind: ImplementedActionKind;
      readonly registerSha256: string;
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Denied";
      readonly entryId: string | null;
      readonly reason: DenialReason;
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Failed";
      readonly reason: DenialReason;
    };

export type RelocateResult =
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Completed";
      readonly entryId: string;
      readonly actionKind: "artifact_relocate";
      readonly registerSha256: string;
      readonly sourceSha256: string;
      readonly recoverySha256: string;
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Denied";
      readonly entryId: string | null;
      readonly reason: DenialReason;
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Failed";
      readonly reason: DenialReason;
    };

/** Closed receipt for successful tracked_delete; no absolute paths or contents. */
export type TrackedDeleteResult =
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Completed";
      readonly entryId: string;
      readonly actionKind: "tracked_delete";
      readonly registerSha256: string;
      readonly recoveryCommitSha: string;
      readonly targets: readonly TrackedDeleteTarget[];
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Denied";
      readonly entryId: string | null;
      readonly reason: DenialReason;
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Failed";
      readonly reason: DenialReason;
    };

const ACTION_KINDS: readonly ActionKind[] = [
  "artifact_relocate",
  "worktree_remove",
  "branch_delete",
  "tracked_delete",
  "artifact_delete",
  "inventory_only",
  "none",
];

const ENTRY_STATES: readonly EntryState[] = [
  "blocked",
  "proposed",
  "proposed_externalize",
  "proposed_replace",
  "proposed_relocate",
  "inventory_required",
  "protected_reference",
  "protected_parked",
  "unauthorized",
  "approved",
  "pending",
];

const HISTORICAL_STATES: readonly HistoricalState[] = [
  ...ENTRY_STATES,
  "late_register_replaced_recoverable",
];

const RECOVERY_STATUSES: readonly RecoveryStatus[] = [
  "pending",
  "git_history",
  "external_path_pending_guard",
  "external_path",
  "recovery_ready",
  "not_applicable",
];

const DST_ID = /^DST-\d{4}$/;

/** Non-empty string with no leading/trailing whitespace. */
export function isNonEmptyClosedString(s: string): boolean {
  return s.length > 0 && s.trim() === s;
}

function coreToDenial(f: CoreFailure): DenialReason {
  switch (f._tag) {
    case "MalformedUtf8":
      return "malformed_utf8";
    case "OversizeInput":
      return "oversize_input";
    case "NonCanonicalJson":
      return "non_canonical_json";
    case "DuplicateJsonKey":
      return "duplicate_json_key";
    case "InvalidJson":
      return "invalid_json";
    case "UnknownField":
      return "unknown_field";
    case "SchemaMismatch":
      return "schema_mismatch";
  }
}

export function mapCoreFailure(f: CoreFailure): DenialReason {
  return coreToDenial(f);
}

function decodeActionKind(value: unknown): ActionKind | CoreFailure {
  const s = expectString(value);
  if (isCoreFailure(s)) return s;
  if ((ACTION_KINDS as readonly string[]).includes(s)) {
    return s as ActionKind;
  }
  return schemaMismatch("action_kind");
}

function decodeEntryState(value: unknown): EntryState | CoreFailure {
  const s = expectString(value);
  if (isCoreFailure(s)) return s;
  if ((ENTRY_STATES as readonly string[]).includes(s)) {
    return s as EntryState;
  }
  return schemaMismatch("entry_state");
}

function decodeHistoricalState(value: unknown): HistoricalState | CoreFailure {
  const s = expectString(value);
  if (isCoreFailure(s)) return s;
  if ((HISTORICAL_STATES as readonly string[]).includes(s)) {
    return s as HistoricalState;
  }
  return schemaMismatch("historical_state");
}

function decodeRecoveryStatus(value: unknown): RecoveryStatus | CoreFailure {
  const s = expectString(value);
  if (isCoreFailure(s)) return s;
  if ((RECOVERY_STATUSES as readonly string[]).includes(s)) {
    return s as RecoveryStatus;
  }
  return schemaMismatch("recovery_status");
}

function decodeArtifactRelocate(
  value: unknown,
): ArtifactRelocate | CoreFailure {
  const obj = expectObject(value);
  if (isCoreFailure(obj)) return obj;
  const unk = rejectUnknownKeys(obj, [
    "sourcePath",
    "recoveryPath",
    "byteLength",
    "sha256",
  ]);
  if (unk) return unk;
  const sourcePath = expectString(obj["sourcePath"]);
  if (isCoreFailure(sourcePath)) return sourcePath;
  const recoveryPath = expectString(obj["recoveryPath"]);
  if (isCoreFailure(recoveryPath)) return recoveryPath;
  const byteLength = expectNumber(obj["byteLength"]);
  if (isCoreFailure(byteLength)) return byteLength;
  if (!Number.isInteger(byteLength) || byteLength < 0) {
    return schemaMismatch("byte_length");
  }
  const sha256 = expectString(obj["sha256"]);
  if (isCoreFailure(sha256)) return sha256;
  if (!isSha256Hex(sha256)) {
    return schemaMismatch("sha256");
  }
  return { sourcePath, recoveryPath, byteLength, sha256 };
}

function decodeTrackedFileMode(value: unknown): TrackedFileMode | CoreFailure {
  const s = expectString(value);
  if (isCoreFailure(s)) return s;
  if (s === "100644" || s === "100755") return s;
  return schemaMismatch("tracked_mode");
}

function decodeTrackedDeleteTarget(
  value: unknown,
): TrackedDeleteTarget | CoreFailure {
  const obj = expectObject(value);
  if (isCoreFailure(obj)) return obj;
  const unk = rejectUnknownKeys(obj, [
    "path",
    "blobSha1",
    "byteLength",
    "mode",
  ]);
  if (unk) return unk;
  const path = expectString(obj["path"]);
  if (isCoreFailure(path)) return path;
  if (
    path.length === 0 ||
    new TextEncoder().encode(path).byteLength > MAX_TRACKED_PATH_BYTES
  ) {
    return schemaMismatch("tracked_path");
  }
  const blobSha1 = expectString(obj["blobSha1"]);
  if (isCoreFailure(blobSha1)) return blobSha1;
  if (!isCommitSha40(blobSha1)) {
    return schemaMismatch("blob_sha1");
  }
  const byteLength = expectNumber(obj["byteLength"]);
  if (isCoreFailure(byteLength)) return byteLength;
  if (!Number.isInteger(byteLength) || byteLength < 0) {
    return schemaMismatch("byte_length");
  }
  const mode = decodeTrackedFileMode(obj["mode"]);
  if (isCoreFailure(mode)) return mode;
  return { path, blobSha1, byteLength, mode };
}

function decodeTrackedDelete(value: unknown): TrackedDelete | CoreFailure {
  const obj = expectObject(value);
  if (isCoreFailure(obj)) return obj;
  const unk = rejectUnknownKeys(obj, ["targets"]);
  if (unk) return unk;
  const raw = expectArray(obj["targets"]);
  if (isCoreFailure(raw)) return raw;
  if (raw.length === 0) {
    return schemaMismatch("empty_targets");
  }
  if (raw.length > MAX_TRACKED_DELETE_TARGETS) {
    return schemaMismatch("too_many_targets");
  }
  const targets: TrackedDeleteTarget[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const item of raw) {
    const t = decodeTrackedDeleteTarget(item);
    if (isCoreFailure(t)) return t;
    if (seen.has(t.path)) {
      return schemaMismatch("duplicate_target");
    }
    seen.add(t.path);
    totalBytes += t.byteLength;
    if (totalBytes > MAX_TRACKED_BATCH_BYTES) {
      return schemaMismatch("batch_bytes");
    }
    targets.push(t);
  }
  return { targets };
}

function decodeApprovalActionKind(
  value: unknown,
): "artifact_relocate" | "tracked_delete" | CoreFailure {
  const s = expectString(value);
  if (isCoreFailure(s)) return s;
  if (s === "artifact_relocate" || s === "tracked_delete") return s;
  return schemaMismatch("approval_action_kind");
}

function decodeApproval(value: unknown): Approval | CoreFailure {
  const obj = expectObject(value);
  if (isCoreFailure(obj)) return obj;
  const unk = rejectUnknownKeys(obj, [
    "approver",
    "approvedAt",
    "expiresAt",
    "evidence",
    "actionKind",
    "candidateCommitSha",
    "candidateTreeSha",
  ]);
  if (unk) return unk;
  const approver = expectString(obj["approver"]);
  if (isCoreFailure(approver)) return approver;
  if (!isNonEmptyClosedString(approver)) {
    return schemaMismatch("approver");
  }
  const approvedAt = expectString(obj["approvedAt"]);
  if (isCoreFailure(approvedAt)) return approvedAt;
  if (!isRfc3339Instant(approvedAt)) {
    return schemaMismatch("approved_at");
  }
  const expiresAt = expectString(obj["expiresAt"]);
  if (isCoreFailure(expiresAt)) return expiresAt;
  if (!isRfc3339Instant(expiresAt)) {
    return schemaMismatch("expires_at");
  }
  const evidence = expectString(obj["evidence"]);
  if (isCoreFailure(evidence)) return evidence;
  if (!isNonEmptyClosedString(evidence)) {
    return schemaMismatch("approval_evidence");
  }
  const actionKind = decodeApprovalActionKind(obj["actionKind"]);
  if (isCoreFailure(actionKind)) return actionKind;
  const candidateCommitSha = expectString(obj["candidateCommitSha"]);
  if (isCoreFailure(candidateCommitSha)) return candidateCommitSha;
  if (!isCommitSha40(candidateCommitSha)) {
    return schemaMismatch("candidate_commit");
  }
  const candidateTreeSha = expectString(obj["candidateTreeSha"]);
  if (isCoreFailure(candidateTreeSha)) return candidateTreeSha;
  if (!isCommitSha40(candidateTreeSha)) {
    return schemaMismatch("candidate_tree");
  }
  return {
    approver,
    approvedAt,
    expiresAt,
    evidence,
    actionKind,
    candidateCommitSha,
    candidateTreeSha,
  };
}

const CURRENT_ENTRY_BASE_KEYS = [
  "id",
  "targetOrAction",
  "state",
  "requiredCondition",
  "owner",
  "evidence",
  "recordedAt",
  "recoveryStatus",
  "actionKind",
] as const;

export function decodeCurrentEntry(
  value: unknown,
): CurrentEntry | CoreFailure {
  const obj = expectObject(value);
  if (isCoreFailure(obj)) return obj;

  const allowed: string[] = [...CURRENT_ENTRY_BASE_KEYS];
  if ("artifactRelocate" in obj) allowed.push("artifactRelocate");
  if ("trackedDelete" in obj) allowed.push("trackedDelete");
  if ("approval" in obj) allowed.push("approval");
  const unk = rejectUnknownKeys(obj, allowed);
  if (unk) return unk;

  const id = expectString(obj["id"]);
  if (isCoreFailure(id)) return id;
  if (!DST_ID.test(id)) {
    return schemaMismatch("entry_id");
  }
  const targetOrAction = expectString(obj["targetOrAction"]);
  if (isCoreFailure(targetOrAction)) return targetOrAction;
  const state = decodeEntryState(obj["state"]);
  if (isCoreFailure(state)) return state;
  const requiredCondition = expectString(obj["requiredCondition"]);
  if (isCoreFailure(requiredCondition)) return requiredCondition;
  const owner = expectString(obj["owner"]);
  if (isCoreFailure(owner)) return owner;
  const evidence = expectString(obj["evidence"]);
  if (isCoreFailure(evidence)) return evidence;
  const recordedAt = expectString(obj["recordedAt"]);
  if (isCoreFailure(recordedAt)) return recordedAt;
  const recoveryStatus = decodeRecoveryStatus(obj["recoveryStatus"]);
  if (isCoreFailure(recoveryStatus)) return recoveryStatus;
  const actionKind = decodeActionKind(obj["actionKind"]);
  if (isCoreFailure(actionKind)) return actionKind;

  let artifactRelocate: ArtifactRelocate | undefined;
  if (actionKind === "artifact_relocate") {
    if (!("artifactRelocate" in obj)) {
      return schemaMismatch("missing_artifact_relocate");
    }
    const ar = decodeArtifactRelocate(obj["artifactRelocate"]);
    if (isCoreFailure(ar)) return ar;
    artifactRelocate = ar;
  } else if ("artifactRelocate" in obj) {
    return unknownField("artifactRelocate");
  }

  let trackedDelete: TrackedDelete | undefined;
  if (actionKind === "tracked_delete") {
    if (!("trackedDelete" in obj)) {
      return schemaMismatch("missing_tracked_delete");
    }
    const td = decodeTrackedDelete(obj["trackedDelete"]);
    if (isCoreFailure(td)) return td;
    trackedDelete = td;
  } else if ("trackedDelete" in obj) {
    return unknownField("trackedDelete");
  }

  let approval: Approval | undefined;
  if (state === "approved") {
    if (!("approval" in obj)) {
      return schemaMismatch("missing_approval");
    }
    const ap = decodeApproval(obj["approval"]);
    if (isCoreFailure(ap)) return ap;
    approval = ap;
  } else if ("approval" in obj) {
    return unknownField("approval");
  }

  const entry: CurrentEntry = {
    id,
    targetOrAction,
    state,
    requiredCondition,
    owner,
    evidence,
    recordedAt,
    recoveryStatus,
    actionKind,
    ...(artifactRelocate !== undefined ? { artifactRelocate } : {}),
    ...(trackedDelete !== undefined ? { trackedDelete } : {}),
    ...(approval !== undefined ? { approval } : {}),
  };
  return entry;
}

export function decodeHistoricalIncident(
  value: unknown,
): HistoricalIncident | CoreFailure {
  const obj = expectObject(value);
  if (isCoreFailure(obj)) return obj;
  const allowed = [
    "id",
    "targetOrAction",
    "state",
    "requiredCondition",
    "owner",
    "evidence",
    "recordedAt",
    "actionKind",
  ];
  if ("artifactRelocate" in obj) {
    return unknownField("artifactRelocate");
  }
  if ("trackedDelete" in obj) {
    return unknownField("trackedDelete");
  }
  if ("approval" in obj) {
    return unknownField("approval");
  }
  const unk = rejectUnknownKeys(obj, allowed);
  if (unk) return unk;

  const id = expectString(obj["id"]);
  if (isCoreFailure(id)) return id;
  if (!DST_ID.test(id)) {
    return schemaMismatch("entry_id");
  }
  const targetOrAction = expectString(obj["targetOrAction"]);
  if (isCoreFailure(targetOrAction)) return targetOrAction;
  const state = decodeHistoricalState(obj["state"]);
  if (isCoreFailure(state)) return state;
  const requiredCondition = expectString(obj["requiredCondition"]);
  if (isCoreFailure(requiredCondition)) return requiredCondition;
  const owner = expectString(obj["owner"]);
  if (isCoreFailure(owner)) return owner;
  const evidence = expectString(obj["evidence"]);
  if (isCoreFailure(evidence)) return evidence;
  const recordedAt = expectString(obj["recordedAt"]);
  if (isCoreFailure(recordedAt)) return recordedAt;

  let actionKind: ActionKind | undefined;
  if ("actionKind" in obj) {
    const ak = decodeActionKind(obj["actionKind"]);
    if (isCoreFailure(ak)) return ak;
    actionKind = ak;
  }

  return {
    id,
    targetOrAction,
    state,
    requiredCondition,
    owner,
    evidence,
    recordedAt,
    ...(actionKind !== undefined ? { actionKind } : {}),
  };
}

export function decodeRegister(value: unknown): Register | CoreFailure {
  const obj = expectObject(value);
  if (isCoreFailure(obj)) return obj;
  const unk = rejectUnknownKeys(obj, [
    "schemaVersion",
    "registerId",
    "currentEntries",
    "historicalIncidents",
  ]);
  if (unk) return unk;

  const schemaVersion = expectExactLiteral(obj["schemaVersion"], 1);
  if (isCoreFailure(schemaVersion)) return schemaVersion;
  const registerId = expectString(obj["registerId"]);
  if (isCoreFailure(registerId)) return registerId;
  if (registerId !== CANONICAL_REGISTER_ID) {
    return schemaMismatch("register_id");
  }
  const currentRaw = expectArray(obj["currentEntries"]);
  if (isCoreFailure(currentRaw)) return currentRaw;
  const historicalRaw = expectArray(obj["historicalIncidents"]);
  if (isCoreFailure(historicalRaw)) return historicalRaw;

  const currentEntries: CurrentEntry[] = [];
  for (const item of currentRaw) {
    const e = decodeCurrentEntry(item);
    if (isCoreFailure(e)) return e;
    currentEntries.push(e);
  }
  const historicalIncidents: HistoricalIncident[] = [];
  for (const item of historicalRaw) {
    const e = decodeHistoricalIncident(item);
    if (isCoreFailure(e)) return e;
    historicalIncidents.push(e);
  }

  const ids = new Set<string>();
  for (const e of currentEntries) {
    if (ids.has(e.id)) {
      return schemaMismatch("duplicate_id");
    }
    ids.add(e.id);
  }
  for (const e of historicalIncidents) {
    if (ids.has(e.id)) {
      return schemaMismatch("duplicate_id");
    }
    ids.add(e.id);
  }

  return {
    schemaVersion: 1,
    registerId,
    currentEntries,
    historicalIncidents,
  };
}

export function decodeAdmissionRequest(
  value: unknown,
): AdmissionRequest | CoreFailure {
  const obj = expectObject(value);
  if (isCoreFailure(obj)) return obj;
  const unk = rejectUnknownKeys(obj, ["schemaVersion", "entryId"]);
  if (unk) return unk;

  const schemaVersion = expectExactLiteral(obj["schemaVersion"], 1);
  if (isCoreFailure(schemaVersion)) return schemaVersion;
  const entryId = expectString(obj["entryId"]);
  if (isCoreFailure(entryId)) return entryId;
  if (!DST_ID.test(entryId)) {
    return schemaMismatch("entry_id");
  }

  return {
    schemaVersion: 1,
    entryId,
  };
}

export function denialFromCore(f: CoreFailure): DenialReason {
  return coreToDenial(f);
}
