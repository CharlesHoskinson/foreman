import { canonicalize } from "@foreman/core";
import type {
  CurrentEntry,
  DenialReason,
  Register,
} from "./schema.js";

/**
 * Fields that form the immutable action identity between P and C for the
 * requested entry. Must be byte-identical after canonicalization.
 */
function actionIdentityCanonical(entry: CurrentEntry): string {
  return canonicalize({
    actionKind: entry.actionKind,
    ...(entry.artifactRelocate !== undefined
      ? { artifactRelocate: entry.artifactRelocate }
      : {}),
    id: entry.id,
    requiredCondition: entry.requiredCondition,
    targetOrAction: entry.targetOrAction,
  });
}

/**
 * Validate the semantic register delta from parent P to current C for one
 * requested entry. Returns null when the single-row approval transition is
 * exact; otherwise a closed denial reason.
 */
export function validateApprovalDelta(
  parent: Register,
  current: Register,
  entryId: string,
): DenialReason | null {
  if (
    parent.schemaVersion !== current.schemaVersion ||
    parent.registerId !== current.registerId
  ) {
    return "approval_delta_mismatch";
  }

  if (
    canonicalize(parent.historicalIncidents) !==
    canonicalize(current.historicalIncidents)
  ) {
    return "approval_delta_mismatch";
  }

  if (parent.currentEntries.length !== current.currentEntries.length) {
    return "approval_delta_mismatch";
  }

  for (let i = 0; i < parent.currentEntries.length; i += 1) {
    const pe = parent.currentEntries[i]!;
    const ce = current.currentEntries[i]!;
    if (pe.id !== ce.id) {
      return "approval_delta_mismatch";
    }
    if (pe.id === entryId) {
      continue;
    }
    // Non-requested rows must be byte-identical
    if (canonicalize(pe) !== canonicalize(ce)) {
      return "approval_delta_mismatch";
    }
  }

  const parentEntry = parent.currentEntries.find((e) => e.id === entryId);
  const currentEntry = current.currentEntries.find((e) => e.id === entryId);
  if (!parentEntry || !currentEntry) {
    // Requested row must already exist in P (not newly introduced in C)
    return "approval_delta_mismatch";
  }

  if (parentEntry.state === "approved") {
    return "approval_delta_mismatch";
  }
  if (parentEntry.approval !== undefined) {
    return "approval_delta_mismatch";
  }

  if (actionIdentityCanonical(parentEntry) !== actionIdentityCanonical(currentEntry)) {
    return "approval_delta_mismatch";
  }

  // C must approve this one entry and mark recovery ready
  if (currentEntry.state !== "approved") {
    return "approval_delta_mismatch";
  }
  if (currentEntry.recoveryStatus !== "recovery_ready") {
    return "approval_delta_mismatch";
  }
  if (currentEntry.approval === undefined) {
    return "approval_delta_mismatch";
  }

  // Ensure only allowed fields changed on the requested entry:
  // reconstruct allowed C view from P identity + C mutable fields
  const allowedFromP: CurrentEntry = {
    id: parentEntry.id,
    targetOrAction: parentEntry.targetOrAction,
    requiredCondition: parentEntry.requiredCondition,
    actionKind: parentEntry.actionKind,
    ...(parentEntry.artifactRelocate !== undefined
      ? { artifactRelocate: parentEntry.artifactRelocate }
      : {}),
    state: currentEntry.state,
    owner: currentEntry.owner,
    evidence: currentEntry.evidence,
    recordedAt: currentEntry.recordedAt,
    recoveryStatus: currentEntry.recoveryStatus,
    ...(currentEntry.approval !== undefined
      ? { approval: currentEntry.approval }
      : {}),
  };
  if (canonicalize(allowedFromP) !== canonicalize(currentEntry)) {
    return "approval_delta_mismatch";
  }

  return null;
}
