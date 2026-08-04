import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as Schema from "effect/Schema";
import { NonBlankString } from "./deliberation.js";
import { Sha256Digest } from "./prompt-preflight.js";

const VersionOne = Schema.Literal(1);

/**
 * Nonnegative safe integer. Rejects non-integers and values outside the safe
 * integer range so persisted metrics cannot smuggle imprecise counts.
 */
const NonNegativeSafeInteger = Schema.Number.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value >= 0, {
    message: () => "must be a nonnegative safe integer",
  }),
);

/**
 * Positive safe integer (exclusive end bytes and similar bounds).
 */
const PositiveSafeInteger = Schema.Number.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value > 0, {
    message: () => "must be a positive safe integer",
  }),
);

/**
 * Portable SHA-256 over raw bytes. Uses @noble/hashes so the schema package
 * stays free of Node crypto while supplying a deterministic digest canary for
 * the domain evaluator.
 */
export const portableSha256Hex = (bytes: Uint8Array): Sha256Digest =>
  bytesToHex(sha256(bytes)) as Sha256Digest;

/**
 * Portable UTF-8 encoder. Unpaired UTF-16 surrogates become U+FFFD. Avoids the
 * TextEncoder host global so schema and domain stay runtime-neutral.
 */
export const portableEncodeUtf8 = (value: string): Uint8Array => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 < value.length) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
          index += 1;
        } else {
          code = 0xfffd;
        }
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }
    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
};

/**
 * Closed SpecCorrectnessV1 item dispositions.
 */
export const SpecCorrectnessDispositionV1 = Schema.Literal(
  "mapped",
  "evidenced_defer",
  "omitted",
  "contradiction",
  "unevidenced_defer",
);
export type SpecCorrectnessDispositionV1 =
  typeof SpecCorrectnessDispositionV1.Type;

const itemIdentity = {
  schemaVersion: VersionOne,
  itemId: NonBlankString,
} as const;

export const SpecCorrectnessMappedItemResultV1 = Schema.Struct({
  ...itemIdentity,
  disposition: Schema.Literal("mapped"),
  sprint: NonBlankString,
  requirement: NonBlankString,
  acceptanceEvidence: NonBlankString,
  status: NonBlankString,
});
export type SpecCorrectnessMappedItemResultV1 =
  typeof SpecCorrectnessMappedItemResultV1.Type;

export const SpecCorrectnessEvidencedDeferItemResultV1 = Schema.Struct({
  ...itemIdentity,
  disposition: Schema.Literal("evidenced_defer"),
  reason: NonBlankString,
  owner: NonBlankString,
  targetRelease: NonBlankString,
  blockingDependency: NonBlankString,
  acceptanceEvidence: NonBlankString,
});
export type SpecCorrectnessEvidencedDeferItemResultV1 =
  typeof SpecCorrectnessEvidencedDeferItemResultV1.Type;

export const SpecCorrectnessOmittedItemResultV1 = Schema.Struct({
  ...itemIdentity,
  disposition: Schema.Literal("omitted"),
  assessment: NonBlankString,
});
export type SpecCorrectnessOmittedItemResultV1 =
  typeof SpecCorrectnessOmittedItemResultV1.Type;

export const SpecCorrectnessContradictionItemResultV1 = Schema.Struct({
  ...itemIdentity,
  disposition: Schema.Literal("contradiction"),
  assessment: NonBlankString,
});
export type SpecCorrectnessContradictionItemResultV1 =
  typeof SpecCorrectnessContradictionItemResultV1.Type;

export const SpecCorrectnessUnevidencedDeferItemResultV1 = Schema.Struct({
  ...itemIdentity,
  disposition: Schema.Literal("unevidenced_defer"),
  assessment: NonBlankString,
});
export type SpecCorrectnessUnevidencedDeferItemResultV1 =
  typeof SpecCorrectnessUnevidencedDeferItemResultV1.Type;

/**
 * Discriminated item-result union. Defect dispositions carry only assessment
 * and cannot include mapped or defer fields under strict decoding.
 */
export const SpecCorrectnessItemResultV1 = Schema.Union(
  SpecCorrectnessMappedItemResultV1,
  SpecCorrectnessEvidencedDeferItemResultV1,
  SpecCorrectnessOmittedItemResultV1,
  SpecCorrectnessContradictionItemResultV1,
  SpecCorrectnessUnevidencedDeferItemResultV1,
);
export type SpecCorrectnessItemResultV1 =
  typeof SpecCorrectnessItemResultV1.Type;

/**
 * Actionable whole-line invented-completion record.
 */
export const InventedCompletionV1 = Schema.Struct({
  schemaVersion: VersionOne,
  artifactAlias: NonBlankString,
  artifactSha256: Sha256Digest,
  startByte: NonNegativeSafeInteger,
  endByte: PositiveSafeInteger,
  claimSha256: Sha256Digest,
  recordSha256: Sha256Digest,
  summary: NonBlankString,
  correctiveAction: NonBlankString,
});
export type InventedCompletionV1 = typeof InventedCompletionV1.Type;

export const SpecCorrectnessFindingV1 = Schema.Struct({
  location: NonBlankString,
  summary: NonBlankString,
  nextAction: NonBlankString,
});
export type SpecCorrectnessFindingV1 = typeof SpecCorrectnessFindingV1.Type;

export const SpecCorrectnessEvidenceGapV1 = Schema.Struct({
  evidenceRef: NonBlankString,
  unmetCondition: NonBlankString,
});
export type SpecCorrectnessEvidenceGapV1 =
  typeof SpecCorrectnessEvidenceGapV1.Type;

const providerSharedFields = {
  schemaVersion: VersionOne,
  itemResults: Schema.Array(SpecCorrectnessItemResultV1),
  inventedCompletions: Schema.Array(InventedCompletionV1),
  findings: Schema.Array(SpecCorrectnessFindingV1),
  summary: NonBlankString,
} as const;

export const SpecCorrectnessAcceptResponseV1 = Schema.Struct({
  ...providerSharedFields,
  outcome: Schema.Literal("accept"),
});
export type SpecCorrectnessAcceptResponseV1 =
  typeof SpecCorrectnessAcceptResponseV1.Type;

export const SpecCorrectnessChangesRequestedResponseV1 = Schema.Struct({
  ...providerSharedFields,
  outcome: Schema.Literal("changes_requested"),
});
export type SpecCorrectnessChangesRequestedResponseV1 =
  typeof SpecCorrectnessChangesRequestedResponseV1.Type;

/**
 * Named abstention. Unexplained abstention (no gaps / no next action) is
 * schema-invalid.
 */
export const SpecCorrectnessAbstainResponseV1 = Schema.Struct({
  ...providerSharedFields,
  outcome: Schema.Literal("abstain"),
  evidenceGaps: Schema.NonEmptyArray(SpecCorrectnessEvidenceGapV1),
  nextAction: NonBlankString,
});
export type SpecCorrectnessAbstainResponseV1 =
  typeof SpecCorrectnessAbstainResponseV1.Type;

export const SpecCorrectnessProviderResponseV1 = Schema.Union(
  SpecCorrectnessAcceptResponseV1,
  SpecCorrectnessChangesRequestedResponseV1,
  SpecCorrectnessAbstainResponseV1,
);
export type SpecCorrectnessProviderResponseV1 =
  typeof SpecCorrectnessProviderResponseV1.Type;

/**
 * Coverage numerator for the fixed 44-item baseline. Inclusive range 0..44 so
 * the separately exported ratio schema cannot accept impossible numerators
 * above the baseline count.
 */
const CoverageNumerator = Schema.Number.pipe(
  Schema.filter(
    (value) => Number.isSafeInteger(value) && value >= 0 && value <= 44,
    {
      message: () => "must be an integer in inclusive range 0..44",
    },
  ),
);

export const SpecCorrectnessCoverageRatioV1 = Schema.Struct({
  numerator: CoverageNumerator,
  denominator: Schema.Literal(44),
});
export type SpecCorrectnessCoverageRatioV1 =
  typeof SpecCorrectnessCoverageRatioV1.Type;

/**
 * Host-derived metric record fields before base consistency refinement.
 * Counts are never accepted from the provider.
 */
const SpecCorrectnessMetricsV1Struct = Schema.Struct({
  schemaVersion: VersionOne,
  baselineItemCount: Schema.Literal(44),
  mappedItemCount: NonNegativeSafeInteger,
  evidencedDeferCount: NonNegativeSafeInteger,
  omittedItemCount: NonNegativeSafeInteger,
  contradictionCount: NonNegativeSafeInteger,
  unevidencedDeferCount: NonNegativeSafeInteger,
  inventedCompletionCount: NonNegativeSafeInteger,
  coverageRatio: SpecCorrectnessCoverageRatioV1,
});
type SpecCorrectnessMetricsV1Fields =
  typeof SpecCorrectnessMetricsV1Struct.Type;

const dispositionSum = (metrics: SpecCorrectnessMetricsV1Fields): number =>
  metrics.mappedItemCount +
  metrics.evidencedDeferCount +
  metrics.omittedItemCount +
  metrics.contradictionCount +
  metrics.unevidencedDeferCount;

const coverageNumeratorMatches = (
  metrics: SpecCorrectnessMetricsV1Fields,
): boolean =>
  metrics.coverageRatio.numerator ===
  metrics.mappedItemCount + metrics.evidencedDeferCount;

const metricsBaseConsistent = (
  metrics: SpecCorrectnessMetricsV1Fields,
): boolean =>
  dispositionSum(metrics) === 44 && coverageNumeratorMatches(metrics);

/**
 * Host-derived metric record. Strict decode requires the five disposition
 * counts to sum to 44 and coverage numerator to equal mapped plus
 * evidenced-defer. Stronger result-schema refinements stay on the outcome
 * variants.
 */
export const SpecCorrectnessMetricsV1 = SpecCorrectnessMetricsV1Struct.pipe(
  Schema.filter((metrics) => metricsBaseConsistent(metrics), {
    message: () =>
      "metrics disposition counts must sum to 44 and coverage numerator must equal mapped plus evidenced-defer",
  }),
);
export type SpecCorrectnessMetricsV1 = typeof SpecCorrectnessMetricsV1.Type;

const hasMetricDefectOrInvention = (
  metrics: SpecCorrectnessMetricsV1,
): boolean =>
  metrics.omittedItemCount > 0 ||
  metrics.contradictionCount > 0 ||
  metrics.unevidencedDeferCount > 0 ||
  metrics.inventedCompletionCount > 0;

const isAcceptMetrics = (metrics: SpecCorrectnessMetricsV1): boolean =>
  metricsBaseConsistent(metrics) &&
  metrics.coverageRatio.numerator === 44 &&
  metrics.omittedItemCount === 0 &&
  metrics.contradictionCount === 0 &&
  metrics.unevidencedDeferCount === 0 &&
  metrics.inventedCompletionCount === 0;

/**
 * Closed invalid-reason codes for the pure evaluator.
 */
export const SpecCorrectnessInvalidReasonV1 = Schema.Literal(
  "baseline_id_count_invalid",
  "baseline_set_mismatch",
  "duplicate_matrix_id",
  "duplicate_item_result_id",
  "item_result_order_mismatch",
  "unknown_item_result_id",
  "duplicate_artifact_alias",
  "artifact_digest_mismatch",
  "unknown_invention_artifact",
  "invention_start_misaligned",
  "invention_end_misaligned",
  "invention_range_invalid",
  "invention_slice_invalid_utf8",
  "invention_claim_digest_mismatch",
  "invention_record_digest_mismatch",
  "duplicate_invention_digest",
  "invention_records_unsorted",
  "declared_accept_with_defect",
  "declared_accept_with_findings",
  "declared_changes_without_defect",
  "declared_abstain_with_defect",
  "coverage_matrix_invalid_utf8",
  "provider_response_invalid",
  "primitive_throw",
  "primitive_input_mutation",
  "primitive_return_invalid",
  "digest_disagreement",
  "decoder_byte_substitution",
);
export type SpecCorrectnessInvalidReasonV1 =
  typeof SpecCorrectnessInvalidReasonV1.Type;

export const SpecCorrectnessOutcomeV1 = Schema.Literal(
  "accept",
  "changes_requested",
  "abstain",
);
export type SpecCorrectnessOutcomeV1 = typeof SpecCorrectnessOutcomeV1.Type;

/**
 * Accepted substantive result. Metrics must show full clean coverage; findings
 * must be empty.
 */
export const SpecCorrectnessAcceptedResultV1 = Schema.Struct({
  schemaVersion: VersionOne,
  _tag: Schema.Literal("Valid"),
  outcome: Schema.Literal("accept"),
  metrics: SpecCorrectnessMetricsV1,
  findings: Schema.Array(SpecCorrectnessFindingV1),
}).pipe(
  Schema.filter(
    (result) => isAcceptMetrics(result.metrics) && result.findings.length === 0,
    {
      message: () =>
        "accept result requires full clean coverage and empty findings",
    },
  ),
);
export type SpecCorrectnessAcceptedResultV1 =
  typeof SpecCorrectnessAcceptedResultV1.Type;

/**
 * Changes substantive result. Metrics must sum and cover consistently, and at
 * least one metric defect, invention, or finding must exist.
 */
export const SpecCorrectnessChangesResultV1 = Schema.Struct({
  schemaVersion: VersionOne,
  _tag: Schema.Literal("Valid"),
  outcome: Schema.Literal("changes_requested"),
  metrics: SpecCorrectnessMetricsV1,
  findings: Schema.Array(SpecCorrectnessFindingV1),
}).pipe(
  Schema.filter(
    (result) =>
      metricsBaseConsistent(result.metrics) &&
      (hasMetricDefectOrInvention(result.metrics) ||
        result.findings.length > 0),
    {
      message: () =>
        "changes_requested result requires consistent metrics and at least one defect, invention, or finding",
    },
  ),
);
export type SpecCorrectnessChangesResultV1 =
  typeof SpecCorrectnessChangesResultV1.Type;

/**
 * Named abstention result. Preserves evidence gaps and next action. Valid only
 * when every baseline item is mapped or evidenced-deferred, coverage is full,
 * and there are no metric defects or inventions. Actionable dissent cannot be
 * persisted as Valid/abstain.
 */
export const SpecCorrectnessAbstainResultV1 = Schema.Struct({
  schemaVersion: VersionOne,
  _tag: Schema.Literal("Valid"),
  outcome: Schema.Literal("abstain"),
  metrics: SpecCorrectnessMetricsV1,
  evidenceGaps: Schema.NonEmptyArray(SpecCorrectnessEvidenceGapV1),
  nextAction: NonBlankString,
}).pipe(
  Schema.filter(
    (result) =>
      metricsBaseConsistent(result.metrics) &&
      result.metrics.coverageRatio.numerator === 44 &&
      !hasMetricDefectOrInvention(result.metrics),
    {
      message: () =>
        "abstain result requires full clean coverage without defects or inventions",
    },
  ),
);
export type SpecCorrectnessAbstainResultV1 =
  typeof SpecCorrectnessAbstainResultV1.Type;

/**
 * Valid evaluator results as a discriminated outcome union.
 */
export const SpecCorrectnessValidResultV1 = Schema.Union(
  SpecCorrectnessAcceptedResultV1,
  SpecCorrectnessChangesResultV1,
  SpecCorrectnessAbstainResultV1,
);
export type SpecCorrectnessValidResultV1 =
  typeof SpecCorrectnessValidResultV1.Type;

export const SpecCorrectnessInvalidResultV1 = Schema.Struct({
  schemaVersion: VersionOne,
  _tag: Schema.Literal("Invalid"),
  reason: SpecCorrectnessInvalidReasonV1,
});
export type SpecCorrectnessInvalidResultV1 =
  typeof SpecCorrectnessInvalidResultV1.Type;

/**
 * Evaluator result union: accepted, changes, abstain, or invalid with a closed
 * reason code.
 */
export const SpecCorrectnessEvaluationResultV1 = Schema.Union(
  SpecCorrectnessAcceptedResultV1,
  SpecCorrectnessChangesResultV1,
  SpecCorrectnessAbstainResultV1,
  SpecCorrectnessInvalidResultV1,
);
export type SpecCorrectnessEvaluationResultV1 =
  typeof SpecCorrectnessEvaluationResultV1.Type;
