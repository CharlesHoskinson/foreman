import type { SpecCorrectnessEvaluationResultV1 } from "@council/schema/spec-correctness";
import type { ReviewAttemptClassification } from "./review-admission.js";

/**
 * Alignment between a SpecCorrectness evaluation and a review-attempt
 * classification. Valid accept admits only approved final advice. Valid
 * changes admits only changes-requested final advice. Valid abstain admits
 * only completed abstention and never counts toward quorum. Invalid
 * evaluation never aligns.
 *
 * Admission-only: import from `@council/domain/spec-correctness-admission`.
 * Not re-exported from the domain root barrel.
 */
export type SpecCorrectnessClassificationAlignment =
  | { readonly _tag: "approved" }
  | { readonly _tag: "changes_requested" }
  | { readonly _tag: "abstention" }
  | { readonly _tag: "mismatch"; readonly reason: string };

/**
 * Pure helper that pairs SpecCorrectnessEvaluationResultV1 with
 * ReviewAttemptClassification. Preserves existing classifyReviewAttempt
 * behavior; this is an admission-layer alignment only.
 */
export const alignSpecCorrectnessWithClassification = (
  evaluation: SpecCorrectnessEvaluationResultV1,
  classification: ReviewAttemptClassification,
): SpecCorrectnessClassificationAlignment => {
  if (evaluation._tag === "Invalid") {
    return {
      _tag: "mismatch",
      reason: "evaluator result is invalid",
    };
  }

  if (evaluation.outcome === "accept") {
    if (
      classification._tag === "CompletedVerdict" &&
      classification.response.advice.kind === "approved"
    ) {
      return { _tag: "approved" };
    }
    return {
      _tag: "mismatch",
      reason: "Valid/accept admits only approved final advice",
    };
  }

  if (evaluation.outcome === "changes_requested") {
    if (
      classification._tag === "CompletedVerdict" &&
      classification.response.advice.kind === "changes_requested"
    ) {
      return { _tag: "changes_requested" };
    }
    return {
      _tag: "mismatch",
      reason:
        "Valid/changes_requested admits only changes-requested final advice",
    };
  }

  // outcome === "abstain"
  if (classification._tag === "CompletedAbstention") {
    return { _tag: "abstention" };
  }
  return {
    _tag: "mismatch",
    reason: "Valid/abstain admits only completed abstention",
  };
};
