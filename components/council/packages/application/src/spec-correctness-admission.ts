import {
  classifyReviewAttempt,
  type ReviewAttemptClassification,
  type ReviewAttemptInput,
} from "@council/domain";
import { alignSpecCorrectnessWithClassification } from "@council/domain/spec-correctness-admission";
import { evaluateSpecCorrectnessV1 } from "@council/domain/spec-correctness";
import type {
  ReviewArtifactDescriptorV1,
  ReviewInfrastructureFailure,
  Sha256Digest,
} from "@council/schema";
import { decodeStrictSync } from "@council/schema";
import type {
  BoundSpecCorrectnessEvaluationV1,
  SpecCorrectnessAdmissionInputV1,
  SpecCorrectnessAdmissionResultV1 as SpecCorrectnessAdmissionResult,
  SpecCorrectnessIdentityV1,
} from "@council/schema/spec-correctness-admission";
import { SpecCorrectnessAdmissionResultV1 as SpecCorrectnessAdmissionResultSchema } from "@council/schema/spec-correctness-admission";
import type { SpecCorrectnessEvaluationResultV1 } from "@council/schema/spec-correctness";
import { Effect } from "effect";
import { ArtifactReader, type ArtifactReaderService } from "./ports.js";
import {
  SpecCorrectnessPrimitives,
  type SpecCorrectnessPrimitivesService,
} from "./spec-correctness-primitives.js";
import { encodeUtf8, sortJsonKeys } from "./schema-lowering.js";

/** Inclusive per-artifact read bound (1 MiB). */
export const SPEC_CORRECTNESS_MAX_ARTIFACT_BYTES = 1_048_576;
/** Inclusive total artifact byte budget (16 MiB). */
export const SPEC_CORRECTNESS_MAX_TOTAL_BYTES = 16_777_216;
/** Inclusive maximum artifact descriptor count. */
export const SPEC_CORRECTNESS_MAX_ARTIFACT_COUNT = 128;

const snapshotBytes = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);

const compareUtf8ByteOrder = (left: string, right: string): number => {
  const leftLength = left.length;
  const rightLength = right.length;
  const limit = leftLength < rightLength ? leftLength : rightLength;
  for (let index = 0; index < limit; index += 1) {
    const delta = left.charCodeAt(index) - right.charCodeAt(index);
    if (delta !== 0) {
      return delta;
    }
  }
  return leftLength - rightLength;
};

const identityEqual = (
  left: SpecCorrectnessIdentityV1,
  right: SpecCorrectnessIdentityV1,
): boolean => {
  // schemaVersion is fixed to 1 by the public decoder; still include it in the
  // field-for-field gate via a widened numeric view so version drift cannot
  // bypass equality if a future host constructs identities out-of-band.
  const leftVersion = (left as { readonly schemaVersion: number })
    .schemaVersion;
  const rightVersion = (right as { readonly schemaVersion: number })
    .schemaVersion;
  return (
    leftVersion === rightVersion &&
    left.candidateCommitSha === right.candidateCommitSha &&
    left.candidateTreeSha === right.candidateTreeSha &&
    left.baseCommitSha === right.baseCommitSha &&
    left.diffSha256 === right.diffSha256 &&
    left.ledgerSha256 === right.ledgerSha256 &&
    left.coverageMatrixSha256 === right.coverageMatrixSha256 &&
    left.specSetSha256 === right.specSetSha256 &&
    left.reviewerId === right.reviewerId &&
    left.providerFamily === right.providerFamily &&
    left.providerReceiptHash === right.providerReceiptHash &&
    left.readyTokenHash === right.readyTokenHash &&
    left.contractHash === right.contractHash &&
    left.promptHash === right.promptHash &&
    left.responseSchemaVariantHash === right.responseSchemaVariantHash
  );
};

const infrastructureFailure = (
  stage: ReviewInfrastructureFailure["stage"],
  reason: string,
  retry: ReviewInfrastructureFailure["retry"] = "new_contract",
): ReviewInfrastructureFailure => ({
  stage,
  reason,
  retry,
});

/**
 * Build a closed Rejected result. When the optional bound evaluation itself
 * fails secret-safe closed decode, drop evaluation rather than leak free text.
 */
const rejected = (
  failure: ReviewInfrastructureFailure,
  evaluation: BoundSpecCorrectnessEvaluationV1 | null = null,
): SpecCorrectnessAdmissionResult => {
  try {
    return decodeStrictSync(SpecCorrectnessAdmissionResultSchema, {
      schemaVersion: 1,
      _tag: "Rejected",
      failure,
      evaluation,
      quorumEligible: false,
      candidateDisposition: "changes_requested",
    });
  } catch {
    return decodeStrictSync(SpecCorrectnessAdmissionResultSchema, {
      schemaVersion: 1,
      _tag: "Rejected",
      failure,
      evaluation: null,
      quorumEligible: false,
      candidateDisposition: "changes_requested",
    });
  }
};

/**
 * Completed invalid provider response. Distinct from infrastructure Rejected.
 * Never converts CompletedInvalidResponse back into ReviewInfrastructureFailure.
 */
const responseRejected = (
  classification: Extract<
    ReviewAttemptClassification,
    { readonly _tag: "CompletedInvalidResponse" }
  >,
  evaluation: BoundSpecCorrectnessEvaluationV1 | null = null,
): SpecCorrectnessAdmissionResult => {
  try {
    return decodeStrictSync(SpecCorrectnessAdmissionResultSchema, {
      schemaVersion: 1,
      _tag: "ResponseRejected",
      evaluation,
      classification: {
        _tag: "CompletedInvalidResponse",
        reason: classification.reason,
        terminal: classification.terminal,
        quorumEligible: false,
        deliberationEligible: false,
      },
      quorumEligible: false,
      candidateDisposition: "changes_requested",
    });
  } catch {
    return decodeStrictSync(SpecCorrectnessAdmissionResultSchema, {
      schemaVersion: 1,
      _tag: "ResponseRejected",
      evaluation: null,
      classification: {
        _tag: "CompletedInvalidResponse",
        reason: classification.reason,
        terminal: classification.terminal,
        quorumEligible: false,
        deliberationEligible: false,
      },
      quorumEligible: false,
      candidateDisposition: "changes_requested",
    });
  }
};

const bindEvaluation = (
  identity: SpecCorrectnessIdentityV1,
  evaluation: SpecCorrectnessEvaluationResultV1,
): BoundSpecCorrectnessEvaluationV1 => ({
  schemaVersion: 1,
  identity,
  evaluation,
});

const computeSpecSetSha256 = (
  specs: readonly ReviewArtifactDescriptorV1[],
  digestsById: ReadonlyMap<string, Sha256Digest>,
  primitives: SpecCorrectnessPrimitivesService,
): Sha256Digest | null => {
  const sorted = [...specs].sort((left, right) =>
    compareUtf8ByteOrder(left.alias, right.alias),
  );
  const records = sorted.map((descriptor) => {
    const sha256 = digestsById.get(descriptor.artifactId);
    if (sha256 === undefined) {
      return null;
    }
    return {
      alias: descriptor.alias,
      artifactId: descriptor.artifactId,
      sha256,
      byteLength: descriptor.byteLength,
    };
  });
  if (records.some((record) => record === null)) {
    return null;
  }
  const sortedRecords = (
    records as readonly {
      readonly alias: string;
      readonly artifactId: string;
      readonly sha256: Sha256Digest;
      readonly byteLength: number;
    }[]
  ).map((record) => sortJsonKeys(record));
  const payload = `${JSON.stringify(sortedRecords)}\n`;
  try {
    return primitives.sha256(snapshotBytes(encodeUtf8(payload)));
  } catch {
    return null;
  }
};

const asReviewAttemptInput = (
  input: SpecCorrectnessAdmissionInputV1["reviewAttempt"],
): ReviewAttemptInput => ({
  preflightStageFailed: input.preflightStageFailed,
  ...(input.preflightFailure !== undefined
    ? { preflightFailure: input.preflightFailure }
    : {}),
  terminal: input.terminal,
  readyTokenCurrent: input.readyTokenCurrent,
  expectedReadyTokenHash: input.expectedReadyTokenHash,
  expectedContractHash: input.expectedContractHash,
  expectedPromptHash: input.expectedPromptHash,
  expectedBundle: input.expectedBundle,
  expectedReviewerId: input.expectedReviewerId,
  expectedCandidateId: input.expectedCandidateId,
  expectedArtifactIds: input.expectedArtifactIds,
  verifiedArtifactIds: input.verifiedArtifactIds,
  bundleVerified: input.bundleVerified,
  designatedStructuredValid: input.designatedStructuredValid,
  declaredEvidenceNamespace: input.declaredEvidenceNamespace,
  ...(input.response !== undefined ? { response: input.response } : {}),
  ...(input.ordinaryText !== undefined
    ? { ordinaryText: input.ordinaryText }
    : {}),
});

const buildCompletedResult = (
  alignment: "approved" | "changes_requested" | "abstention",
  bound: BoundSpecCorrectnessEvaluationV1,
  classification: ReviewAttemptClassification,
): SpecCorrectnessAdmissionResult | null => {
  try {
    if (
      alignment === "approved" &&
      classification._tag === "CompletedVerdict"
    ) {
      return decodeStrictSync(SpecCorrectnessAdmissionResultSchema, {
        schemaVersion: 1,
        _tag: "CompletedApproved",
        evaluation: bound,
        classification,
        quorumEligible: true,
        candidateDisposition: "approved",
      });
    }
    if (
      alignment === "changes_requested" &&
      classification._tag === "CompletedVerdict"
    ) {
      return decodeStrictSync(SpecCorrectnessAdmissionResultSchema, {
        schemaVersion: 1,
        _tag: "CompletedChangesRequested",
        evaluation: bound,
        classification,
        quorumEligible: true,
        candidateDisposition: "changes_requested",
      });
    }
    if (
      alignment === "abstention" &&
      classification._tag === "CompletedAbstention"
    ) {
      return decodeStrictSync(SpecCorrectnessAdmissionResultSchema, {
        schemaVersion: 1,
        _tag: "CompletedAbstention",
        evaluation: bound,
        classification,
        quorumEligible: false,
        candidateDisposition: "abstention",
      });
    }
  } catch {
    return null;
  }
  return null;
};

type LoadedArtifact = {
  readonly descriptor: ReviewArtifactDescriptorV1;
  readonly bytes: Uint8Array;
  readonly digest: Sha256Digest;
  /** UTF-8 text produced once during load; never re-decoded for full artifacts. */
  readonly text: string;
};

const loadArtifacts = (
  input: SpecCorrectnessAdmissionInputV1,
  reader: ArtifactReaderService,
  primitives: SpecCorrectnessPrimitivesService,
): Effect.Effect<readonly LoadedArtifact[], SpecCorrectnessAdmissionResult> =>
  Effect.gen(function* () {
    if (input.artifacts.length > SPEC_CORRECTNESS_MAX_ARTIFACT_COUNT) {
      return yield* Effect.fail(
        rejected(
          infrastructureFailure(
            "dispatch",
            "artifact count exceeds the closed admission bound",
            "changed_preflight",
          ),
        ),
      );
    }

    const loaded: LoadedArtifact[] = [];
    let totalBytes = 0;

    for (const descriptor of input.artifacts) {
      // Pre-read: reject oversized declared length before calling the reader.
      if (descriptor.byteLength > SPEC_CORRECTNESS_MAX_ARTIFACT_BYTES) {
        return yield* Effect.fail(
          rejected(
            infrastructureFailure(
              "dispatch",
              "declared artifact length exceeds the closed per-artifact bound",
              "changed_preflight",
            ),
          ),
        );
      }
      const remainingBudget = SPEC_CORRECTNESS_MAX_TOTAL_BYTES - totalBytes;
      if (descriptor.byteLength > remainingBudget) {
        return yield* Effect.fail(
          rejected(
            infrastructureFailure(
              "dispatch",
              "declared artifact length exceeds the remaining total admission budget",
              "changed_preflight",
            ),
          ),
        );
      }

      const bytes = yield* reader
        .read({
          descriptor,
          maxBytes: SPEC_CORRECTNESS_MAX_ARTIFACT_BYTES,
        })
        .pipe(
          Effect.mapError(() =>
            rejected(
              infrastructureFailure(
                "dispatch",
                "artifact read failed under closed admission bounds",
                "changed_preflight",
              ),
            ),
          ),
        );

      const snapshot = snapshotBytes(bytes);

      // Post-read: independently enforce actual byte bounds (nonconforming
      // readers must not be trusted). Preserve one read per accepted artifact.
      if (snapshot.byteLength > SPEC_CORRECTNESS_MAX_ARTIFACT_BYTES) {
        return yield* Effect.fail(
          rejected(
            infrastructureFailure(
              "dispatch",
              "actual artifact bytes exceed the closed per-artifact bound",
              "changed_preflight",
            ),
          ),
        );
      }
      if (snapshot.byteLength > remainingBudget) {
        return yield* Effect.fail(
          rejected(
            infrastructureFailure(
              "dispatch",
              "actual artifact bytes exceed the remaining total admission budget",
              "changed_preflight",
            ),
          ),
        );
      }

      if (snapshot.byteLength !== descriptor.byteLength) {
        return yield* Effect.fail(
          rejected(
            infrastructureFailure(
              "parse",
              "artifact byte length does not match the descriptor",
              "new_contract",
            ),
          ),
        );
      }

      totalBytes += snapshot.byteLength;

      let digest: Sha256Digest;
      try {
        digest = primitives.sha256(snapshotBytes(snapshot));
      } catch {
        return yield* Effect.fail(
          rejected(
            infrastructureFailure(
              "parse",
              "digest primitive failed during artifact verification",
              "same_contract",
            ),
          ),
        );
      }

      if (digest !== descriptor.digest) {
        return yield* Effect.fail(
          rejected(
            infrastructureFailure(
              "parse",
              "artifact digest does not match the descriptor",
              "new_contract",
            ),
          ),
        );
      }

      // Fatal UTF-8 gate for every matrix, ledger, and specification artifact
      // during the single load. Decode a disposable copy so a hostile primitive
      // cannot mutate the stored snapshot. Reject null, throw, or mutation.
      // Re-encode the returned text with the portable encoder and require exact
      // byte equality with the snapshot so a decoder that substitutes valid
      // text for invalid sequences cannot approve.
      const decodeProbe = snapshotBytes(snapshot);
      let decoded: string | null;
      try {
        decoded = primitives.decodeUtf8(decodeProbe);
      } catch {
        return yield* Effect.fail(
          rejected(
            infrastructureFailure(
              "parse",
              "artifact UTF-8 decode primitive failed",
              "same_contract",
            ),
          ),
        );
      }
      if (decoded === null) {
        return yield* Effect.fail(
          rejected(
            infrastructureFailure(
              "parse",
              "artifact bytes are not valid UTF-8",
              "new_contract",
            ),
          ),
        );
      }
      if (
        decodeProbe.byteLength !== snapshot.byteLength ||
        !decodeProbe.every((byte, index) => byte === snapshot[index])
      ) {
        return yield* Effect.fail(
          rejected(
            infrastructureFailure(
              "parse",
              "UTF-8 decode primitive mutated artifact bytes",
              "same_contract",
            ),
          ),
        );
      }
      let reencoded: Uint8Array;
      try {
        reencoded = encodeUtf8(decoded);
      } catch {
        return yield* Effect.fail(
          rejected(
            infrastructureFailure(
              "parse",
              "artifact UTF-8 re-encode primitive failed",
              "same_contract",
            ),
          ),
        );
      }
      if (
        reencoded.byteLength !== snapshot.byteLength ||
        !reencoded.every((byte, index) => byte === snapshot[index])
      ) {
        return yield* Effect.fail(
          rejected(
            infrastructureFailure(
              "parse",
              "decoded UTF-8 does not round-trip to the original artifact bytes",
              "new_contract",
            ),
          ),
        );
      }

      loaded.push({ descriptor, bytes: snapshot, digest, text: decoded });
    }

    return loaded;
  });

/**
 * SpecCorrectness admission coordinator. Compares identities, verifies
 * artifacts, runs the pure domain evaluator and review classifier, and returns
 * only the closed admission result. Never fails the Effect channel — all
 * infrastructure faults become Rejected results.
 */
export const evaluateSpecCorrectnessAdmission = (
  input: SpecCorrectnessAdmissionInputV1,
): Effect.Effect<
  SpecCorrectnessAdmissionResult,
  never,
  ArtifactReader | SpecCorrectnessPrimitives
> =>
  Effect.gen(function* () {
    const reader = yield* ArtifactReader;
    const primitives = yield* SpecCorrectnessPrimitives;

    // 1–3. Identity field equality and review-attempt cross-binding.
    if (
      !identityEqual(input.expectedIdentity, input.observedIdentity) ||
      !identityEqual(input.expectedIdentity, input.submission.identity)
    ) {
      return rejected(
        infrastructureFailure(
          "parse",
          "expected, observed, and submitted identity must match field-for-field",
          "new_contract",
        ),
      );
    }

    // Review-attempt expected artifact IDs must equal the complete descriptor
    // ID set (same closed surface as SpecCorrectnessAdmissionInputV1).
    const descriptorIds = input.artifacts.map(
      (artifact) => artifact.artifactId,
    );
    const expectedArtifactIds = input.reviewAttempt.expectedArtifactIds;
    if (
      expectedArtifactIds.length !== descriptorIds.length ||
      new Set(expectedArtifactIds).size !== expectedArtifactIds.length
    ) {
      return rejected(
        infrastructureFailure(
          "parse",
          "review-attempt expected artifact IDs must equal the admission descriptor set",
          "new_contract",
        ),
      );
    }
    const descriptorIdSet = new Set(descriptorIds);
    for (const expectedId of expectedArtifactIds) {
      if (!descriptorIdSet.has(expectedId)) {
        return rejected(
          infrastructureFailure(
            "parse",
            "review-attempt expected artifact IDs must equal the admission descriptor set",
            "new_contract",
          ),
        );
      }
    }

    const identity = input.expectedIdentity;
    const bundle = input.reviewAttempt.expectedBundle;
    if (
      identity.candidateCommitSha !== bundle.headSha ||
      identity.baseCommitSha !== bundle.baseSha ||
      identity.diffSha256 !== bundle.diffSha256
    ) {
      return rejected(
        infrastructureFailure(
          "parse",
          "identity candidate/base/diff must bind the review-attempt expected bundle",
          "new_contract",
        ),
      );
    }

    if (
      identity.reviewerId !== input.reviewAttempt.expectedReviewerId ||
      identity.readyTokenHash !== input.reviewAttempt.expectedReadyTokenHash ||
      identity.contractHash !== input.reviewAttempt.expectedContractHash ||
      identity.promptHash !== input.reviewAttempt.expectedPromptHash
    ) {
      return rejected(
        infrastructureFailure(
          "parse",
          "identity reviewer, ready token, contract, and prompt must bind the review attempt",
          "new_contract",
        ),
      );
    }

    // 4–5. Read artifacts once under closed bounds; recompute digests/lengths.
    const loadedOrReject = yield* loadArtifacts(input, reader, primitives).pipe(
      Effect.either,
    );

    if (loadedOrReject._tag === "Left") {
      return loadedOrReject.left;
    }
    const loaded = loadedOrReject.right;

    const byId = new Map(
      loaded.map((item) => [item.descriptor.artifactId, item] as const),
    );

    const matrix = byId.get(input.roles.coverageMatrixArtifactId);
    const ledger = byId.get(input.roles.ledgerArtifactId);
    if (matrix === undefined || ledger === undefined) {
      return rejected(
        infrastructureFailure(
          "dispatch",
          "coverage matrix or ledger artifact is missing after role resolution",
          "changed_preflight",
        ),
      );
    }

    // 6. Recompute raw matrix and ledger digests against identity.
    if (matrix.digest !== identity.coverageMatrixSha256) {
      return rejected(
        infrastructureFailure(
          "parse",
          "coverage matrix digest does not match identity",
          "new_contract",
        ),
      );
    }
    if (ledger.digest !== identity.ledgerSha256) {
      return rejected(
        infrastructureFailure(
          "parse",
          "ledger digest does not match identity",
          "new_contract",
        ),
      );
    }

    const specDescriptors: ReviewArtifactDescriptorV1[] = [];
    const digestsById = new Map<string, Sha256Digest>();
    for (const item of loaded) {
      digestsById.set(item.descriptor.artifactId, item.digest);
    }
    for (const specId of input.roles.specSetArtifactIds) {
      const spec = byId.get(specId);
      if (spec === undefined) {
        return rejected(
          infrastructureFailure(
            "dispatch",
            "spec-set artifact is missing after role resolution",
            "changed_preflight",
          ),
        );
      }
      specDescriptors.push(spec.descriptor);
    }

    // 7. Compute specSetSha256 from sorted alias records.
    let recomputedSpecSet: Sha256Digest | null;
    try {
      recomputedSpecSet = computeSpecSetSha256(
        specDescriptors,
        digestsById,
        primitives,
      );
    } catch {
      return rejected(
        infrastructureFailure(
          "parse",
          "spec-set digest primitive failed",
          "same_contract",
        ),
      );
    }
    if (
      recomputedSpecSet === null ||
      recomputedSpecSet !== identity.specSetSha256
    ) {
      return rejected(
        infrastructureFailure(
          "parse",
          "spec-set digest does not match identity",
          "new_contract",
        ),
      );
    }

    // 8. Evaluate SpecCorrectness with matrix bytes and evidence snapshots.
    const evidenceArtifacts: {
      readonly alias: string;
      readonly sha256: Sha256Digest;
      readonly bytes: Uint8Array;
    }[] = [
      {
        alias: ledger.descriptor.alias,
        sha256: ledger.digest,
        bytes: snapshotBytes(ledger.bytes),
      },
    ];
    for (const specId of input.roles.specSetArtifactIds) {
      const spec = byId.get(specId);
      if (spec === undefined) {
        return rejected(
          infrastructureFailure(
            "dispatch",
            "spec-set artifact is missing after role resolution",
            "changed_preflight",
          ),
        );
      }
      evidenceArtifacts.push({
        alias: spec.descriptor.alias,
        sha256: spec.digest,
        bytes: snapshotBytes(spec.bytes),
      });
    }

    // Full accepted artifacts were UTF-8-decoded once during load. Reuse that
    // text by content digest so the application layer never re-decodes them.
    // Invention slices (and any other non-full payload) still decode once here.
    const decodedTextByDigest = new Map<string, string>(
      loaded.map((item) => [item.digest, item.text] as const),
    );

    let evaluation: SpecCorrectnessEvaluationResultV1;
    try {
      evaluation = evaluateSpecCorrectnessV1({
        coverageMatrixBytes: snapshotBytes(matrix.bytes),
        response: input.submission.response,
        evidenceArtifacts,
        sha256: (bytes) => {
          const copy = snapshotBytes(bytes);
          return primitives.sha256(copy);
        },
        decodeUtf8: (bytes) => {
          const copy = snapshotBytes(bytes);
          try {
            const digest = primitives.sha256(snapshotBytes(copy));
            const cached = decodedTextByDigest.get(digest);
            if (cached !== undefined) {
              return cached;
            }
            return primitives.decodeUtf8(copy);
          } catch {
            return null;
          }
        },
      });
    } catch {
      return rejected(
        infrastructureFailure(
          "parse",
          "spec-correctness evaluator failed closed",
          "same_contract",
        ),
      );
    }

    const bound = bindEvaluation(identity, evaluation);

    if (evaluation._tag === "Invalid") {
      return rejected(
        infrastructureFailure(
          "parse",
          "spec-correctness evaluator returned invalid",
          "new_contract",
        ),
        bound,
      );
    }

    // 9. Classify the review attempt and require advice/outcome alignment.
    let classification: ReviewAttemptClassification;
    try {
      classification = classifyReviewAttempt(
        asReviewAttemptInput(input.reviewAttempt),
      );
    } catch {
      return rejected(
        infrastructureFailure(
          "parse",
          "review-attempt classifier failed closed",
          "same_contract",
        ),
        bound,
      );
    }

    if (
      classification._tag === "ProviderPreflightFailed" ||
      classification._tag === "ReviewAttemptFailed"
    ) {
      return rejected(
        infrastructureFailure(
          classification.failure.stage,
          "review-attempt classifier rejected the attempt",
          classification.failure.retry,
        ),
        bound,
      );
    }

    // Completed invalid response is not infrastructure failure. Preserve the
    // closed classification and do not convert it into ReviewInfrastructureFailure.
    if (classification._tag === "CompletedInvalidResponse") {
      return responseRejected(classification, bound);
    }

    const alignment = alignSpecCorrectnessWithClassification(
      evaluation,
      classification,
    );
    if (alignment._tag === "mismatch") {
      return rejected(
        infrastructureFailure(
          "parse",
          "evaluator outcome does not match completed review advice",
          "new_contract",
        ),
        bound,
      );
    }

    const completed = buildCompletedResult(
      alignment._tag,
      bound,
      classification,
    );
    if (completed === null) {
      return rejected(
        infrastructureFailure(
          "parse",
          "admission result failed strict closed decoding",
          "same_contract",
        ),
        bound,
      );
    }
    return completed;
  }).pipe(
    Effect.catchAllDefect(() =>
      Effect.succeed(
        rejected(
          infrastructureFailure(
            "parse",
            "admission coordinator failed closed on an unexpected defect",
            "same_contract",
          ),
        ),
      ),
    ),
  );
