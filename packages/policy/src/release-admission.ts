import { canonicalize, sha256Hex } from "@foreman/core";

import {
  buildApprovedOpenSpecManifestV1,
  decodeReleaseAuthorityFileV1,
  type ReleaseActionV1,
  type ReleaseAuthorityReceiptV1,
  type ReleaseCandidateIdentityV1,
  type ReleaseEvidenceBundleV1,
} from "./release-authority.js";

export type RegisteredReleaseAuthorityV1 = {
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: string;
  readonly action: ReleaseActionV1;
  readonly effectiveAction: ReleaseActionV1;
  readonly priorReservationId: string | null;
  readonly originReservationId: string | null;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly taskPlanSha256: string;
  readonly bundleSha256: string;
  readonly receiptSchemas: readonly ReleaseAuthorityReceiptV1["schema"][];
  readonly receiptSha256s: readonly string[];
  readonly evaluationManifestSha256: string | null;
  readonly registeredAt: string;
};

export type ReleaseAdmissionFailureReason =
  | "invalid_evidence"
  | "wrong_program"
  | "wrong_package"
  | "wrong_action"
  | "wrong_candidate"
  | "wrong_design_base"
  | "approved_openspec_mismatch"
  | "task_plan_mismatch"
  | "missing_registration"
  | "registration_mismatch"
  | "invalid_retry"
  | "git_resolution_failure";

export type ReleaseEvidenceCheckResultV1 =
  | { readonly schemaVersion: 1; readonly _tag: "EvidenceValid" }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "EvidenceInvalid";
      readonly reason: ReleaseAdmissionFailureReason;
    };

export type ReleaseAdmissionResultV1 =
  | { readonly schemaVersion: 1; readonly _tag: "Admitted" }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Refused";
      readonly reason: ReleaseAdmissionFailureReason;
    };

export type ReleaseEvidenceInputV1 = {
  readonly action: ReleaseActionV1;
  readonly packageId: string;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly approvedOpenSpecBytes: Readonly<Record<string, Uint8Array>>;
  readonly taskPlanBytes: Uint8Array;
  readonly evidenceBytes: Uint8Array;
};

type CheckedEvidence = {
  readonly bundle: ReleaseEvidenceBundleV1;
  readonly bundleSha256: string;
  readonly receiptSchemas: readonly ReleaseAuthorityReceiptV1["schema"][];
  readonly receiptSha256s: readonly string[];
  readonly effectiveAction: ReleaseActionV1;
  readonly priorReservationId: string | null;
  readonly originReservationId: string | null;
  readonly evaluationManifestSha256: string | null;
};

type EvidenceDecision =
  | { readonly _tag: "Valid"; readonly checked: CheckedEvidence }
  | { readonly _tag: "Invalid"; readonly reason: ReleaseAdmissionFailureReason };

const encoder = new TextEncoder();

function invalidEvidence(
  reason: ReleaseAdmissionFailureReason,
): EvidenceDecision {
  return { _tag: "Invalid", reason };
}

function evidenceInvalid(
  reason: ReleaseAdmissionFailureReason,
): ReleaseEvidenceCheckResultV1 {
  return { schemaVersion: 1, _tag: "EvidenceInvalid", reason };
}

function refused(
  reason: ReleaseAdmissionFailureReason,
): ReleaseAdmissionResultV1 {
  return { schemaVersion: 1, _tag: "Refused", reason };
}

function compareUtf8(left: string, right: string): number {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.min(a.byteLength, b.byteLength);
  for (let index = 0; index < length; index += 1) {
    const delta = a[index]! - b[index]!;
    if (delta !== 0) return delta;
  }
  return a.byteLength - b.byteLength;
}

function sameValue(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(left) === canonicalize(right);
  } catch {
    return false;
  }
}

function canonicalFileSha256(value: unknown): string | null {
  try {
    return sha256Hex(encoder.encode(`${canonicalize(value)}\n`));
  } catch {
    return null;
  }
}

function designReceipt(
  bundle: ReleaseEvidenceBundleV1,
): Extract<
  ReleaseAuthorityReceiptV1,
  { readonly schema: "foreman.design-approval.v1" }
> | null {
  const receipt = bundle.receipts[0];
  if (receipt?.schema !== "foreman.design-approval.v1") return null;
  return receipt;
}

function receiptBindingFailure(
  bundle: ReleaseEvidenceBundleV1,
): "wrong_package" | "wrong_candidate" | null {
  for (const receipt of bundle.receipts) {
    if (receipt.packageId !== bundle.packageId) return "wrong_package";
    switch (receipt.schema) {
      case "foreman.checks-evidence.v1":
      case "foreman.release-audit.v1":
        if (!sameValue(receipt.candidate, bundle.candidate)) {
          return "wrong_candidate";
        }
        break;
      case "foreman.council-request.v1":
        if (receipt.candidateSha256 !== bundle.candidate.candidateSha256) {
          return "wrong_candidate";
        }
        break;
      case "foreman.evaluation-authority.v1":
        if (
          bundle.packageId !== "graph-eval-falsification" ||
          bundle.childId !== "v040-t8-evaluation"
        ) {
          return "wrong_package";
        }
        break;
      case "foreman.design-approval.v1":
        break;
    }
  }
  return null;
}

function checkEvidence(
  input: ReleaseEvidenceInputV1,
  allowResolvedImplementationDescendant = false,
): EvidenceDecision {
  if (
    typeof input !== "object" ||
    input === null ||
    !(input.evidenceBytes instanceof Uint8Array) ||
    !(input.taskPlanBytes instanceof Uint8Array)
  ) {
    return invalidEvidence("invalid_evidence");
  }
  const decoded = decodeReleaseAuthorityFileV1(input.evidenceBytes);
  if (decoded._tag !== "Valid") return invalidEvidence("invalid_evidence");
  if (decoded.value.schema !== "foreman.release-evidence-bundle.v1") {
    return invalidEvidence("invalid_evidence");
  }
  const bundle = decoded.value;
  if (bundle.program !== "v040") return invalidEvidence("wrong_program");
  if (bundle.action !== input.action) return invalidEvidence("wrong_action");
  if (bundle.packageId !== input.packageId) {
    return invalidEvidence("wrong_package");
  }
  if (!sameValue(bundle.candidate, input.candidate)) {
    return invalidEvidence("wrong_candidate");
  }

  const design = designReceipt(bundle);
  if (design === null) return invalidEvidence("invalid_evidence");
  if (design.packageId !== bundle.packageId) {
    return invalidEvidence("wrong_package");
  }
  const receiptFailure = receiptBindingFailure(bundle);
  if (receiptFailure !== null) return invalidEvidence(receiptFailure);
  if (
    bundle.action === "implement" &&
    !allowResolvedImplementationDescendant &&
    (bundle.candidate.commit !== design.designCommit ||
      bundle.candidate.tree !== design.designTree)
  ) {
    return invalidEvidence("wrong_design_base");
  }

  const files = Object.entries(input.approvedOpenSpecBytes)
    .map(([path, bytes]) => ({ path, bytes }))
    .sort((left, right) => compareUtf8(left.path, right.path));
  const manifest = buildApprovedOpenSpecManifestV1({
    workflow: Object.prototype.hasOwnProperty.call(
      input.approvedOpenSpecBytes,
      "design.md",
    )
      ? "foreman-architectural"
      : "foreman-bounded",
    files,
  });
  if (
    manifest._tag !== "Valid" ||
    manifest.sha256 !== design.approvedOpenSpecSha256
  ) {
    return invalidEvidence("approved_openspec_mismatch");
  }
  const taskPlanSha256 = sha256Hex(input.taskPlanBytes);
  if (
    taskPlanSha256 !== design.taskPlanSha256 ||
    taskPlanSha256 !== bundle.taskPlanSha256
  ) {
    return invalidEvidence("task_plan_mismatch");
  }

  let effectiveAction: ReleaseActionV1 = bundle.action;
  let priorReservationId: string | null = null;
  let originReservationId: string | null = null;
  if (bundle.action === "provider_retry" || bundle.action === "resume") {
    const prior = bundle.priorReservation;
    if (
      prior === undefined ||
      prior.originalAction === "provider_retry" ||
      prior.originalAction === "resume" ||
      !sameValue(prior.candidate, bundle.candidate)
    ) {
      return invalidEvidence("invalid_retry");
    }
    effectiveAction = prior.originalAction;
    priorReservationId = prior.reservationId;
    originReservationId = prior.originReservationId;
  }

  const receiptSha256s: string[] = [];
  for (const receipt of bundle.receipts) {
    const digest = canonicalFileSha256(receipt);
    if (digest === null) return invalidEvidence("invalid_evidence");
    receiptSha256s.push(digest);
  }
  const evaluation = bundle.receipts.find(
    (receipt) => receipt.schema === "foreman.evaluation-authority.v1",
  );
  return {
    _tag: "Valid",
    checked: {
      bundle,
      bundleSha256: decoded.sha256,
      receiptSchemas: bundle.receipts.map((receipt) => receipt.schema),
      receiptSha256s,
      effectiveAction,
      priorReservationId,
      originReservationId,
      evaluationManifestSha256:
        evaluation?.schema === "foreman.evaluation-authority.v1"
          ? evaluation.manifestSha256
          : null,
    },
  };
}

function registrationMatches(
  checked: CheckedEvidence,
  registered: RegisteredReleaseAuthorityV1,
): boolean {
  const bundle = checked.bundle;
  return (
    registered.rootContractId === bundle.rootContractId &&
    registered.rootContractSha256 === bundle.rootContractSha256 &&
    registered.familySha256 === bundle.familySha256 &&
    registered.childId === bundle.childId &&
    registered.action === bundle.action &&
    registered.effectiveAction === checked.effectiveAction &&
    registered.priorReservationId === checked.priorReservationId &&
    registered.originReservationId === checked.originReservationId &&
    sameValue(registered.candidate, bundle.candidate) &&
    registered.taskPlanSha256 === bundle.taskPlanSha256 &&
    registered.bundleSha256 === checked.bundleSha256 &&
    sameValue(registered.receiptSchemas, checked.receiptSchemas) &&
    sameValue(registered.receiptSha256s, checked.receiptSha256s) &&
    registered.evaluationManifestSha256 === checked.evaluationManifestSha256
  );
}

export function evaluateReleaseEvidenceV1(
  input: ReleaseEvidenceInputV1,
): ReleaseEvidenceCheckResultV1 {
  try {
    const decision = checkEvidence(input);
    if (decision._tag === "Invalid") {
      return evidenceInvalid(decision.reason);
    }
    return { schemaVersion: 1, _tag: "EvidenceValid" };
  } catch {
    return evidenceInvalid("invalid_evidence");
  }
}

/**
 * Internal boundary used only after the Git loader proves a single-parent
 * lineage from the approved design commit to the supplied candidate.
 */
export function evaluateReleaseEvidenceAfterGitResolutionV1(
  input: ReleaseEvidenceInputV1,
): ReleaseEvidenceCheckResultV1 {
  try {
    const decision = checkEvidence(input, true);
    if (decision._tag === "Invalid") {
      return evidenceInvalid(decision.reason);
    }
    return { schemaVersion: 1, _tag: "EvidenceValid" };
  } catch {
    return evidenceInvalid("invalid_evidence");
  }
}

export function evaluateReleaseAdmissionV1(
  input: ReleaseEvidenceInputV1 & {
    readonly registered: RegisteredReleaseAuthorityV1 | null;
  },
): ReleaseAdmissionResultV1 {
  try {
    const decision = checkEvidence(input, true);
    if (decision._tag === "Invalid") return refused(decision.reason);
    if (input.registered === null) return refused("missing_registration");
    if (!registrationMatches(decision.checked, input.registered)) {
      return refused("registration_mismatch");
    }
    return { schemaVersion: 1, _tag: "Admitted" };
  } catch {
    return refused("invalid_evidence");
  }
}
