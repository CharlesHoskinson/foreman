/**
 * Report freshness uses content identity only (digest + byteLength).
 * No mtime, filename patterns, or report text patterns.
 */

import type { AttemptIdentity } from "@foreman/event-log";
import {
  MAX_REPORT_CONTENT_BYTES,
  type IncompleteReason,
  type ReportSnapshotPresentV1,
  type ReportSnapshotV1,
  type RoundOutcomeCompletedV1,
  type RoundOutcomeIncompleteV1,
  type RoundOutcomeV1,
} from "./round-contract.js";

export type ReportReadFailureReason = "report_too_large" | "report_read_failed";

export type ReportReadResult =
  | { readonly _tag: "Snapshot"; readonly snapshot: ReportSnapshotV1 }
  | { readonly _tag: "Failure"; readonly reason: ReportReadFailureReason };

/**
 * A report is fresh only when the post-gate snapshot is present, nonempty,
 * within the content bound, and content-different from the baseline.
 * An absent baseline followed by a valid present snapshot is fresh.
 *
 * Unchanged identity is digest-only: equal digests are not fresh even when
 * declared byte lengths differ. Do not use snapshotsEqual here.
 */
export function isReportFresh(
  baseline: ReportSnapshotV1,
  postGate: ReportSnapshotV1,
): boolean {
  if (postGate._tag !== "Present") {
    return false;
  }
  if (postGate.byteLength === 0) {
    return false;
  }
  if (postGate.byteLength > MAX_REPORT_CONTENT_BYTES) {
    return false;
  }
  if (baseline._tag === "Present" && baseline.digest === postGate.digest) {
    return false;
  }
  return true;
}

export type OutcomeDecisionInput = {
  readonly attemptIdentity: AttemptIdentity;
  readonly implementationExitCode: number;
  readonly gateExitCode: number;
  readonly reportBaseline: ReportSnapshotV1;
  readonly postGate: ReportReadResult;
};

/**
 * First-match incomplete-reason order from OpenSpec:
 * 1. nonzero gate → gate_failed
 * 2. report_too_large reader failure
 * 3. any other post-gate reader failure → report_read_failed
 * 4. absent post-gate → report_missing
 * 5. zero-byte present → report_empty
 * 6. digest equal to present baseline → report_unchanged
 * 7. else completed
 */
export function decideRoundOutcome(
  input: OutcomeDecisionInput,
): RoundOutcomeV1 {
  const {
    attemptIdentity,
    implementationExitCode,
    gateExitCode,
    reportBaseline,
    postGate,
  } = input;

  if (gateExitCode !== 0) {
    return incomplete(
      attemptIdentity,
      implementationExitCode,
      gateExitCode,
      "gate_failed",
      reportBaseline,
      snapshotOrNull(postGate),
    );
  }

  if (postGate._tag === "Failure") {
    if (postGate.reason === "report_too_large") {
      return incomplete(
        attemptIdentity,
        implementationExitCode,
        gateExitCode,
        "report_too_large",
        reportBaseline,
        null,
      );
    }
    return incomplete(
      attemptIdentity,
      implementationExitCode,
      gateExitCode,
      "report_read_failed",
      reportBaseline,
      null,
    );
  }

  const snap = postGate.snapshot;
  if (snap._tag === "Absent") {
    return incomplete(
      attemptIdentity,
      implementationExitCode,
      gateExitCode,
      "report_missing",
      reportBaseline,
      snap,
    );
  }

  if (snap.byteLength === 0) {
    return incomplete(
      attemptIdentity,
      implementationExitCode,
      gateExitCode,
      "report_empty",
      reportBaseline,
      snap,
    );
  }

  // Digest identity only; declared byte lengths do not change this decision.
  if (reportBaseline._tag === "Present" && reportBaseline.digest === snap.digest) {
    return incomplete(
      attemptIdentity,
      implementationExitCode,
      gateExitCode,
      "report_unchanged",
      reportBaseline,
      snap,
    );
  }

  // completed: present, nonempty, different from baseline (or baseline absent)
  const completed: RoundOutcomeCompletedV1 = {
    _tag: "completed",
    attemptIdentity,
    implementationExitCode,
    gateExitCode: 0,
    reportFresh: true,
    reportBaseline,
    report: snap,
  };
  return completed;
}

function incomplete(
  attemptIdentity: AttemptIdentity,
  implementationExitCode: number,
  gateExitCode: number,
  reason: IncompleteReason,
  reportBaseline: ReportSnapshotV1,
  report: ReportSnapshotV1 | null,
): RoundOutcomeIncompleteV1 {
  return {
    _tag: "incomplete",
    attemptIdentity,
    implementationExitCode,
    gateExitCode,
    reportFresh: false,
    reason,
    reportBaseline,
    report,
  };
}

function snapshotOrNull(postGate: ReportReadResult): ReportSnapshotV1 | null {
  if (postGate._tag === "Failure") {
    return null;
  }
  return postGate.snapshot;
}

/**
 * Type guard: present nonempty snapshot usable as completed evidence.
 */
export function isPresentNonempty(
  snap: ReportSnapshotV1,
): snap is ReportSnapshotPresentV1 {
  return snap._tag === "Present" && snap.byteLength > 0;
}
