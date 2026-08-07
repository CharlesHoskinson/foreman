import * as Schema from "effect/Schema";
import { NonBlankString, ReviewInfrastructureFailure } from "./deliberation.js";
import { decodeStrictSync } from "./decode.js";
import { ArtifactId, ContentHash, ContractHash } from "./identifiers.js";
import {
  CompletedAbstentionV1,
  CompletedInvalidResponseV1,
  CompletedVerdictV1,
  GitCommitSha,
  ProviderFamilyV1,
  ReviewArtifactDescriptorV1,
  ReviewAttemptInputV1,
  Sha256Digest,
} from "./prompt-preflight.js";
import { SpecCorrectnessEvaluationResultV1 } from "./spec-correctness.js";

const VersionOne = Schema.Literal(1);

const uniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

/**
 * Lowercase 40-hex Git tree object ID. Same surface shape as GitCommitSha but
 * branded separately so tree and commit identities cannot be silently mixed.
 */
export const GitTreeSha = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{40}$/),
  Schema.brand("GitTreeSha"),
);
export type GitTreeSha = typeof GitTreeSha.Type;

/**
 * Exact SpecCorrectness admission identity. Every field is concrete; no opaque
 * identityExact shortcut. Digests are lowercase hex without a sha256: prefix
 * except ContentHash/ContractHash fields which keep the content-address form.
 */
export const SpecCorrectnessIdentityV1 = Schema.Struct({
  schemaVersion: VersionOne,
  candidateCommitSha: GitCommitSha,
  candidateTreeSha: GitTreeSha,
  baseCommitSha: GitCommitSha,
  diffSha256: Sha256Digest,
  ledgerSha256: Sha256Digest,
  coverageMatrixSha256: Sha256Digest,
  specSetSha256: Sha256Digest,
  reviewerId: NonBlankString,
  providerFamily: ProviderFamilyV1,
  providerReceiptHash: ContentHash,
  readyTokenHash: ContentHash,
  contractHash: ContractHash,
  promptHash: ContentHash,
  responseSchemaVariantHash: ContentHash,
});
export type SpecCorrectnessIdentityV1 = typeof SpecCorrectnessIdentityV1.Type;

/**
 * Artifact role map for matrix, ledger, and ordered-but-set-unique specs.
 * Every role ID is unique across matrix, ledger, and the full spec-set list.
 */
export const SpecCorrectnessArtifactRolesV1 = Schema.Struct({
  coverageMatrixArtifactId: ArtifactId,
  ledgerArtifactId: ArtifactId,
  specSetArtifactIds: Schema.NonEmptyArray(ArtifactId),
}).pipe(
  Schema.filter((roles) => {
    const ids = [
      roles.coverageMatrixArtifactId,
      roles.ledgerArtifactId,
      ...roles.specSetArtifactIds,
    ];
    return uniqueStrings(ids);
  }),
);
export type SpecCorrectnessArtifactRolesV1 =
  typeof SpecCorrectnessArtifactRolesV1.Type;

/**
 * Provider submission envelope. `response` stays unknown at this boundary so
 * the domain evaluator remains the only strict decoder for provider payload.
 */
export const SpecCorrectnessProviderSubmissionV1 = Schema.Struct({
  identity: SpecCorrectnessIdentityV1,
  response: Schema.Unknown,
});
export type SpecCorrectnessProviderSubmissionV1 =
  typeof SpecCorrectnessProviderSubmissionV1.Type;

const roleIdSet = (
  roles: SpecCorrectnessArtifactRolesV1,
): ReadonlySet<string> =>
  new Set([
    roles.coverageMatrixArtifactId,
    roles.ledgerArtifactId,
    ...roles.specSetArtifactIds,
  ]);

/**
 * Application admission input. Paths never appear here. Descriptor IDs and
 * aliases are unique, and the role set equals the descriptor set exactly.
 */
export const SpecCorrectnessAdmissionInputV1 = Schema.Struct({
  schemaVersion: VersionOne,
  reviewAttempt: ReviewAttemptInputV1,
  expectedIdentity: SpecCorrectnessIdentityV1,
  observedIdentity: SpecCorrectnessIdentityV1,
  submission: SpecCorrectnessProviderSubmissionV1,
  artifacts: Schema.NonEmptyArray(ReviewArtifactDescriptorV1),
  roles: SpecCorrectnessArtifactRolesV1,
}).pipe(
  Schema.filter((input) => {
    const ids = input.artifacts.map((artifact) => artifact.artifactId);
    const aliases = input.artifacts.map((artifact) => artifact.alias);
    if (!uniqueStrings(ids) || !uniqueStrings(aliases)) {
      return false;
    }
    const roleIds = roleIdSet(input.roles);
    if (roleIds.size !== input.artifacts.length) {
      return false;
    }
    for (const artifact of input.artifacts) {
      if (!roleIds.has(artifact.artifactId)) {
        return false;
      }
    }
    // Review-attempt expected artifact sequence must be exactly the complete
    // admission descriptor ID set. Verified and inspected sequences are already
    // bound to expected by the pure classifier.
    const expectedIds = input.reviewAttempt.expectedArtifactIds;
    if (
      !uniqueStrings(expectedIds) ||
      expectedIds.length !== input.artifacts.length
    ) {
      return false;
    }
    const descriptorIdSet = new Set(ids);
    for (const expectedId of expectedIds) {
      if (!descriptorIdSet.has(expectedId)) {
        return false;
      }
    }
    return true;
  }),
);
export type SpecCorrectnessAdmissionInputV1 =
  typeof SpecCorrectnessAdmissionInputV1.Type;

/**
 * CLI-only path binding. Paths never enter ready tokens, receipts, or results.
 */
export const SpecCorrectnessCliArtifactPathV1 = Schema.Struct({
  artifactId: ArtifactId,
  path: NonBlankString,
});
export type SpecCorrectnessCliArtifactPathV1 =
  typeof SpecCorrectnessCliArtifactPathV1.Type;

/**
 * Closed stdin request for council-spec-correctness. Path artifact IDs are
 * unique and equal the descriptor ID set exactly.
 */
export const SpecCorrectnessCliRequestV1 = Schema.Struct({
  input: SpecCorrectnessAdmissionInputV1,
  artifactPaths: Schema.NonEmptyArray(SpecCorrectnessCliArtifactPathV1),
}).pipe(
  Schema.filter((request) => {
    const pathIds = request.artifactPaths.map((item) => item.artifactId);
    if (!uniqueStrings(pathIds)) {
      return false;
    }
    const descriptorIds = request.input.artifacts.map(
      (artifact) => artifact.artifactId,
    );
    if (pathIds.length !== descriptorIds.length) {
      return false;
    }
    const pathSet = new Set(pathIds);
    return descriptorIds.every((id) => pathSet.has(id));
  }),
);
export type SpecCorrectnessCliRequestV1 =
  typeof SpecCorrectnessCliRequestV1.Type;

/**
 * Evaluator result bound to the exact expected identity. Present only when the
 * domain evaluator produced a result for this admission.
 */
export const BoundSpecCorrectnessEvaluationV1 = Schema.Struct({
  schemaVersion: VersionOne,
  identity: SpecCorrectnessIdentityV1,
  evaluation: SpecCorrectnessEvaluationResultV1,
});
export type BoundSpecCorrectnessEvaluationV1 =
  typeof BoundSpecCorrectnessEvaluationV1.Type;

const evaluationOutcome = (
  bound: BoundSpecCorrectnessEvaluationV1,
): "accept" | "changes_requested" | "abstain" | "invalid" => {
  if (bound.evaluation._tag === "Invalid") {
    return "invalid";
  }
  return bound.evaluation.outcome;
};

const adviceKindOfVerdict = (
  classification: CompletedVerdictV1,
): "approved" | "changes_requested" => classification.response.advice.kind;

/**
 * Shared predicate for every completed branch: evaluation identity must bind
 * the final-review response identity field-for-field on the closed surface.
 */
const completedEvaluationBindsClassificationResponse = (result: {
  readonly evaluation: BoundSpecCorrectnessEvaluationV1;
  readonly classification: CompletedVerdictV1 | CompletedAbstentionV1;
}): boolean => {
  const identity = result.evaluation.identity;
  const response = result.classification.response;
  return (
    identity.candidateCommitSha === response.bundle.headSha &&
    identity.baseCommitSha === response.bundle.baseSha &&
    identity.diffSha256 === response.bundle.diffSha256 &&
    identity.reviewerId === response.reviewerId &&
    identity.readyTokenHash === response.readyTokenHash &&
    identity.contractHash === response.contractHash &&
    identity.promptHash === response.promptHash
  );
};

/**
 * Pure content-address / digest forms that are allowed even when they look
 * like dense token text. Whole-string matches only.
 */
const isContentAddressOrDigest = (value: string): boolean =>
  /^(?:sha256:)?[a-f0-9]{64}$/i.test(value) ||
  /^cand_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);

/**
 * True when a public free-text value contains operational path, environment
 * assignment, process/provider-output marker, private-key marker, or common
 * secret-token form. Content-address hashes and ordinary evidence aliases are
 * not rejected.
 */
export const containsUnsafePublicFreeText = (value: string): boolean => {
  if (value.length === 0 || isContentAddressOrDigest(value)) {
    return false;
  }
  // Operational filesystem roots and Windows drive paths.
  if (
    /(?:^|[^A-Za-z0-9_+.-])\/(?:tmp|home|var|usr|etc|opt|root|Users|private|mnt|media)(?:\/|$|[^A-Za-z0-9_+.-])/.test(
      value,
    ) ||
    /(?:^|[^A-Za-z0-9_+.-])[A-Za-z]:\\/.test(value) ||
    /(?:^|[^A-Za-z0-9_+.-])\\\\/.test(value)
  ) {
    return true;
  }
  // Raw environment assignment (HOME=/path, API_KEY=...).
  if (/\b[A-Z][A-Z0-9_]{1,63}=/.test(value)) {
    return true;
  }
  // Raw process / provider-output markers.
  if (
    /process\.(?:env|stdout|stderr|argv|cwd|exit)\b/i.test(value) ||
    /\b(?:provider[_-]?output|raw[_-]?stdout|raw[_-]?stderr)\b/i.test(value)
  ) {
    return true;
  }
  // Private-key PEM markers.
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
    return true;
  }
  // Common secret token forms (OpenAI-style, Bearer, Slack, GitHub, GitLab,
  // npm, PyPI, AWS, Google, Stripe live, JWT bearer-like).
  if (
    /\bsk-[A-Za-z0-9_-]{10,}\b/.test(value) ||
    /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/i.test(value) ||
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/.test(value) ||
    /\bghp_[A-Za-z0-9]{36,}\b/.test(value) ||
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(value) ||
    /\bglpat-[A-Za-z0-9_-]{20,}\b/.test(value) ||
    /\bnpm_[A-Za-z0-9]{36,}\b/.test(value) ||
    /\bpypi-[A-Za-z0-9_-]{20,}\b/.test(value) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(value) ||
    /\bAIza[0-9A-Za-z_-]{35}\b/.test(value) ||
    /\bsk_live_[A-Za-z0-9]{20,}\b/.test(value) ||
    /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)
  ) {
    return true;
  }
  // Explicit password / secret / token / API-key assignments.
  if (/\b(?:password|secret|token|api[_-]?key)\s*=\s*\S+/i.test(value)) {
    return true;
  }
  return false;
};

const valueTreeContainsUnsafePublicFreeText = (value: unknown): boolean => {
  if (typeof value === "string") {
    return containsUnsafePublicFreeText(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (valueTreeContainsUnsafePublicFreeText(item)) {
        return true;
      }
    }
    return false;
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      if (valueTreeContainsUnsafePublicFreeText(entry)) {
        return true;
      }
    }
    return false;
  }
  return false;
};

/**
 * Closed admission results must not carry operational paths, secrets, or raw
 * process markers in any public free-text field.
 */
const admissionResultFreeTextIsSecretSafe = (result: unknown): boolean =>
  !valueTreeContainsUnsafePublicFreeText(result);

/**
 * Completed approved admission: Valid/accept evaluation plus CompletedVerdict
 * with approved final advice. Quorum eligible.
 */
export const SpecCorrectnessAdmissionApprovedV1 = Schema.Struct({
  schemaVersion: VersionOne,
  _tag: Schema.Literal("CompletedApproved"),
  evaluation: BoundSpecCorrectnessEvaluationV1,
  classification: CompletedVerdictV1,
  quorumEligible: Schema.Literal(true),
  candidateDisposition: Schema.Literal("approved"),
}).pipe(
  Schema.filter(
    (result) =>
      evaluationOutcome(result.evaluation) === "accept" &&
      adviceKindOfVerdict(result.classification) === "approved" &&
      completedEvaluationBindsClassificationResponse(result) &&
      admissionResultFreeTextIsSecretSafe(result),
    {
      message: () =>
        "CompletedApproved requires Valid/accept evaluation, approved final advice, bound identity, and secret-safe free text",
    },
  ),
);
export type SpecCorrectnessAdmissionApprovedV1 =
  typeof SpecCorrectnessAdmissionApprovedV1.Type;

/**
 * Completed changes-requested admission: Valid/changes evaluation plus
 * CompletedVerdict with changes-requested final advice. Quorum eligible.
 */
export const SpecCorrectnessAdmissionChangesRequestedV1 = Schema.Struct({
  schemaVersion: VersionOne,
  _tag: Schema.Literal("CompletedChangesRequested"),
  evaluation: BoundSpecCorrectnessEvaluationV1,
  classification: CompletedVerdictV1,
  quorumEligible: Schema.Literal(true),
  candidateDisposition: Schema.Literal("changes_requested"),
}).pipe(
  Schema.filter(
    (result) =>
      evaluationOutcome(result.evaluation) === "changes_requested" &&
      adviceKindOfVerdict(result.classification) === "changes_requested" &&
      completedEvaluationBindsClassificationResponse(result) &&
      admissionResultFreeTextIsSecretSafe(result),
    {
      message: () =>
        "CompletedChangesRequested requires Valid/changes_requested evaluation, changes-requested final advice, bound identity, and secret-safe free text",
    },
  ),
);
export type SpecCorrectnessAdmissionChangesRequestedV1 =
  typeof SpecCorrectnessAdmissionChangesRequestedV1.Type;

/**
 * Completed abstention admission: Valid/abstain evaluation plus
 * CompletedAbstention. Never quorum eligible.
 */
export const SpecCorrectnessAdmissionAbstentionV1 = Schema.Struct({
  schemaVersion: VersionOne,
  _tag: Schema.Literal("CompletedAbstention"),
  evaluation: BoundSpecCorrectnessEvaluationV1,
  classification: CompletedAbstentionV1,
  quorumEligible: Schema.Literal(false),
  candidateDisposition: Schema.Literal("abstention"),
}).pipe(
  Schema.filter(
    (result) =>
      evaluationOutcome(result.evaluation) === "abstain" &&
      completedEvaluationBindsClassificationResponse(result) &&
      admissionResultFreeTextIsSecretSafe(result),
    {
      message: () =>
        "CompletedAbstention requires Valid/abstain evaluation, bound identity, and secret-safe free text",
    },
  ),
);
export type SpecCorrectnessAdmissionAbstentionV1 =
  typeof SpecCorrectnessAdmissionAbstentionV1.Type;

/**
 * Rejected or infrastructure failure. Candidate disposition is always
 * changes_requested. Evaluation is present only when the evaluator ran.
 * Classification is never promoted to completed advice on this branch.
 */
export const SpecCorrectnessAdmissionRejectedV1 = Schema.Struct({
  schemaVersion: VersionOne,
  _tag: Schema.Literal("Rejected"),
  failure: ReviewInfrastructureFailure,
  evaluation: Schema.NullOr(BoundSpecCorrectnessEvaluationV1),
  quorumEligible: Schema.Literal(false),
  candidateDisposition: Schema.Literal("changes_requested"),
}).pipe(
  Schema.filter((result) => admissionResultFreeTextIsSecretSafe(result), {
    message: () => "Rejected result free text must be secret-safe",
  }),
);
export type SpecCorrectnessAdmissionRejectedV1 =
  typeof SpecCorrectnessAdmissionRejectedV1.Type;

/**
 * Completed provider turn whose designated structured output is schema-invalid,
 * identity-invalid, or semantically inadmissible. Not infrastructure failure.
 * Candidate disposition is always changes_requested. Never quorum eligible.
 * Evaluation is always null — never publish a bound evaluation beside a
 * rejected provider response.
 */
export const SpecCorrectnessAdmissionResponseRejectedV1 = Schema.Struct({
  schemaVersion: VersionOne,
  _tag: Schema.Literal("ResponseRejected"),
  evaluation: Schema.Null,
  classification: CompletedInvalidResponseV1,
  quorumEligible: Schema.Literal(false),
  candidateDisposition: Schema.Literal("changes_requested"),
}).pipe(
  Schema.filter((result) => admissionResultFreeTextIsSecretSafe(result), {
    message: () => "ResponseRejected result free text must be secret-safe",
  }),
);
export type SpecCorrectnessAdmissionResponseRejectedV1 =
  typeof SpecCorrectnessAdmissionResponseRejectedV1.Type;

/**
 * Closed SpecCorrectness admission result union. Sufficient for automation.
 * Never carries paths, raw provider response, artifact bytes, environment
 * values, or secret text.
 */
export const SpecCorrectnessAdmissionResultV1 = Schema.Union(
  SpecCorrectnessAdmissionApprovedV1,
  SpecCorrectnessAdmissionChangesRequestedV1,
  SpecCorrectnessAdmissionAbstentionV1,
  SpecCorrectnessAdmissionRejectedV1,
  SpecCorrectnessAdmissionResponseRejectedV1,
);
export type SpecCorrectnessAdmissionResultV1 =
  typeof SpecCorrectnessAdmissionResultV1.Type;

/**
 * Strict decoder for SpecCorrectnessCliRequestV1. Excess properties are errors.
 */
export const decodeSpecCorrectnessCliRequestV1 = (
  value: unknown,
): SpecCorrectnessCliRequestV1 =>
  decodeStrictSync(SpecCorrectnessCliRequestV1, value);
