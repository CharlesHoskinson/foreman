import type {
  CandidateId,
  ContentHash,
  ContractHash,
  FinalAbstentionResponseV1,
  FinalReviewResponseV1,
  FinalVerdictResponseV1,
  InvalidReviewResponseReasonV1,
  ReviewAbstention,
  ReviewBundleIdentityV1,
  ReviewInfrastructureFailure,
  TerminalObservationV1,
} from "@council/schema";
import { isSuccessfulStopReason } from "@council/schema";

/**
 * Pure review-admission classifier input. All fields are already-normalized
 * host observations. This module never parses provider wire formats itself.
 */
export type ReviewAttemptInput = {
  readonly preflightStageFailed: boolean;
  readonly preflightFailure?: ReviewInfrastructureFailure;
  readonly terminal: TerminalObservationV1;
  readonly readyTokenCurrent: boolean;
  readonly expectedReadyTokenHash: ContentHash;
  readonly expectedContractHash: ContractHash;
  readonly expectedPromptHash: ContentHash;
  readonly expectedBundle: ReviewBundleIdentityV1;
  readonly expectedReviewerId: string;
  readonly expectedCandidateId: CandidateId;
  readonly expectedArtifactIds: readonly string[];
  readonly verifiedArtifactIds: readonly string[];
  readonly bundleVerified: boolean;
  readonly designatedStructuredValid: boolean;
  readonly declaredEvidenceNamespace: readonly string[];
  readonly response?: FinalReviewResponseV1;
  /**
   * Ordinary model text may contain schema-shaped fragments. The classifier
   * never promotes ordinary text into advice.
   */
  readonly ordinaryText?: string;
};

/**
 * Closed reasons for a completed provider turn whose designated structured
 * output is schema-invalid, identity-invalid, or semantically inadmissible.
 * Single source of truth: schema export InvalidReviewResponseReasonV1.
 */
export type InvalidReviewResponseReason = InvalidReviewResponseReasonV1;

export type ReviewAttemptClassification =
  | {
      readonly _tag: "ProviderPreflightFailed";
      readonly failure: ReviewInfrastructureFailure;
      readonly terminal: TerminalObservationV1;
      readonly quorumEligible: false;
      readonly deliberationEligible: false;
    }
  | {
      readonly _tag: "ReviewAttemptFailed";
      readonly failure: ReviewInfrastructureFailure;
      readonly terminal: TerminalObservationV1;
      readonly quorumEligible: false;
      readonly deliberationEligible: false;
    }
  | {
      readonly _tag: "CompletedVerdict";
      readonly response: FinalVerdictResponseV1;
      readonly terminal: TerminalObservationV1;
      readonly quorumEligible: true;
      readonly deliberationEligible: true;
    }
  | {
      readonly _tag: "CompletedAbstention";
      readonly response: FinalAbstentionResponseV1;
      readonly terminal: TerminalObservationV1;
      readonly quorumEligible: false;
      readonly deliberationEligible: true;
    }
  | {
      readonly _tag: "CompletedInvalidResponse";
      readonly reason: InvalidReviewResponseReason;
      readonly terminal: TerminalObservationV1;
      readonly quorumEligible: false;
      readonly deliberationEligible: false;
    };

const preflightFailure = (
  input: ReviewAttemptInput,
  reason: string,
  stage: ReviewInfrastructureFailure["stage"] = "provider",
  retry: ReviewInfrastructureFailure["retry"] = "changed_preflight",
): ReviewAttemptClassification => ({
  _tag: "ProviderPreflightFailed",
  failure: input.preflightFailure ?? { stage, reason, retry },
  terminal: input.terminal,
  quorumEligible: false,
  deliberationEligible: false,
});

const attemptFailure = (
  input: ReviewAttemptInput,
  reason: string,
  stage: ReviewInfrastructureFailure["stage"] = "transport",
  retry: ReviewInfrastructureFailure["retry"] = "same_contract",
): ReviewAttemptClassification => ({
  _tag: "ReviewAttemptFailed",
  failure: { stage, reason, retry },
  terminal: input.terminal,
  quorumEligible: false,
  deliberationEligible: false,
});

/**
 * Completed invalid response: successful terminal, inadmissible structured
 * output. Never carries raw provider text — only the closed reason.
 */
const completedInvalidResponse = (
  input: ReviewAttemptInput,
  reason: InvalidReviewResponseReason,
): ReviewAttemptClassification => ({
  _tag: "CompletedInvalidResponse",
  reason,
  terminal: input.terminal,
  quorumEligible: false,
  deliberationEligible: false,
});

const sameBundle = (
  left: ReviewBundleIdentityV1,
  right: ReviewBundleIdentityV1,
): boolean =>
  left.baseSha === right.baseSha &&
  left.headSha === right.headSha &&
  left.diffSha256 === right.diffSha256;

const sameArtifactSequence = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const uniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const isNonBlank = (value: string): boolean => value.trim().length > 0;

/**
 * A review starts only when the model turn began, the bundle is verified, and
 * at least one verified artifact belongs to the expected required set.
 */
const reviewStarted = (input: ReviewAttemptInput): boolean => {
  if (!input.terminal.modelTurnStarted || !input.bundleVerified) {
    return false;
  }
  if (input.verifiedArtifactIds.length < 1) {
    return false;
  }
  const expected = new Set(input.expectedArtifactIds);
  return input.verifiedArtifactIds.some((id) => expected.has(id));
};

/**
 * Provider-response binding only: ready token, contract, prompt, bundle,
 * reviewer, candidate, and inspected artifact sequence vs expected IDs.
 * Host-side expected/verified uniqueness and verified==expected are not
 * response properties — see hostArtifactPreconditionsHold.
 */
const responseIdentitiesExact = (
  input: ReviewAttemptInput,
  response: FinalReviewResponseV1,
): boolean => {
  if (response.readyTokenHash !== input.expectedReadyTokenHash) {
    return false;
  }
  if (response.contractHash !== input.expectedContractHash) {
    return false;
  }
  if (response.promptHash !== input.expectedPromptHash) {
    return false;
  }
  if (!sameBundle(response.bundle, input.expectedBundle)) {
    return false;
  }
  if (!isNonBlank(response.reviewerId)) {
    return false;
  }
  if (response.reviewerId !== input.expectedReviewerId) {
    return false;
  }
  if (response.candidateId !== input.expectedCandidateId) {
    return false;
  }
  if (!uniqueStrings(response.inspectedArtifactIds)) {
    return false;
  }
  return sameArtifactSequence(
    response.inspectedArtifactIds,
    input.expectedArtifactIds,
  );
};

/**
 * Host contract preconditions over expected and verified artifact ID lists.
 * Failures are infrastructure (ReviewAttemptFailed), not provider identity
 * mismatch — the provider response is not blamed for a host defect.
 */
const hostArtifactPreconditionsHold = (
  input: ReviewAttemptInput,
): boolean => {
  if (!uniqueStrings(input.expectedArtifactIds)) {
    return false;
  }
  if (!uniqueStrings(input.verifiedArtifactIds)) {
    return false;
  }
  return sameArtifactSequence(
    input.verifiedArtifactIds,
    input.expectedArtifactIds,
  );
};

const expectedArtifactSet = (input: ReviewAttemptInput): ReadonlySet<string> =>
  new Set(input.expectedArtifactIds);

const findingsValid = (
  input: ReviewAttemptInput,
  response: FinalVerdictResponseV1,
): boolean => {
  if (response.advice.kind !== "changes_requested") {
    return true;
  }
  const allowed = expectedArtifactSet(input);
  return response.advice.findings.every(
    (finding) =>
      allowed.has(finding.artifactId) &&
      isNonBlank(finding.location) &&
      isNonBlank(finding.summary) &&
      isNonBlank(finding.nextAction),
  );
};

const evidenceGapsValid = (
  input: ReviewAttemptInput,
  abstention: ReviewAbstention,
): boolean => {
  if (!isNonBlank(abstention.nextAction)) {
    return false;
  }
  const namespace = new Set(input.declaredEvidenceNamespace);
  return abstention.evidenceGaps.every(
    (gap) =>
      isNonBlank(gap.evidenceRef) &&
      isNonBlank(gap.unmetCondition) &&
      namespace.has(gap.evidenceRef),
  );
};

/**
 * Classify a review attempt from terminal transport evidence first.
 * Ordinary text is intentionally ignored for outcome admission.
 */
export const classifyReviewAttempt = (
  input: ReviewAttemptInput,
): ReviewAttemptClassification => {
  // Pre-execution infrastructure failures never start a review and never admit
  // advice. Either preflight signal is decisive, including contradictory values
  // supplied by a caller that bypasses strict decoding.
  if (
    input.preflightStageFailed ||
    input.preflightFailure !== undefined ||
    input.terminal.terminalState === "preflight_failed" ||
    (!input.terminal.modelTurnStarted &&
      input.terminal.errorMessage !== null &&
      input.terminal.terminalState !== "completed")
  ) {
    const reason =
      input.terminal.errorMessage ??
      input.preflightFailure?.reason ??
      "provider preflight failed before model execution";
    return preflightFailure(input, reason);
  }

  if (!reviewStarted(input)) {
    return attemptFailure(
      input,
      "review did not start: model turn, verified bundle, and at least one verified expected artifact are required",
      "dispatch",
    );
  }

  if (!input.terminal.terminalRecordObserved) {
    return attemptFailure(
      input,
      "missing provider terminal record",
      "transport",
    );
  }

  if (input.terminal.terminalState !== "completed") {
    return attemptFailure(
      input,
      `terminal state is '${input.terminal.terminalState}', not completed`,
      input.terminal.terminalState === "cancelled" ? "transport" : "provider",
    );
  }

  // Cancellation and every other non-success stop reason cannot become
  // completion, even when terminalState is "completed" and a caller bypasses
  // schema decoding of SuccessfulTerminalObservationV1.
  if (!isSuccessfulStopReason(input.terminal.stopReason)) {
    return attemptFailure(
      input,
      `stop reason '${String(input.terminal.stopReason)}' is not a successful completion reason`,
      "transport",
    );
  }

  if (input.terminal.exitCode !== 0) {
    return attemptFailure(
      input,
      `process exit code is ${String(input.terminal.exitCode)}, not 0`,
      "provider",
    );
  }

  if (
    input.terminal.pendingToolCalls === null ||
    input.terminal.failedToolCalls === null
  ) {
    return attemptFailure(input, "provider tool state is unknown", "provider");
  }

  if (input.terminal.pendingToolCalls > 0) {
    return attemptFailure(
      input,
      "pending tool calls remain after terminal completion",
      "provider",
    );
  }

  if (input.terminal.failedToolCalls > 0) {
    return attemptFailure(
      input,
      "failed tool calls remain after terminal completion",
      "provider",
    );
  }

  if (!input.terminal.parserComplete) {
    return attemptFailure(input, "provider parser did not complete", "parse");
  }

  if (
    !input.terminal.structuredOutputPresent ||
    input.terminal.structuredOutputError !== null
  ) {
    return attemptFailure(
      input,
      input.terminal.structuredOutputError ??
        "designated structured output is missing",
      "parse",
    );
  }

  if (input.terminal.errorMessage !== null) {
    return attemptFailure(input, input.terminal.errorMessage, "provider");
  }

  // All terminal transport/parser gates passed. From here a present structured
  // channel that fails schema, identity, or semantic admission is a completed
  // invalid response — not infrastructure failure.
  if (!input.designatedStructuredValid || input.response === undefined) {
    return completedInvalidResponse(input, "schema_invalid");
  }

  if (!input.readyTokenCurrent) {
    return attemptFailure(
      input,
      "ready-review token is missing or expired",
      "dispatch",
    );
  }

  // Host contract defects (duplicate expected IDs, incomplete verification)
  // are infrastructure failures with closed stage/retry guidance — not
  // provider-response identity mismatch.
  if (!hostArtifactPreconditionsHold(input)) {
    return attemptFailure(
      input,
      "host artifact contract is invalid: expected and verified IDs must be unique and equal in sequence",
      "dispatch",
      "changed_preflight",
    );
  }

  if (!responseIdentitiesExact(input, input.response)) {
    return completedInvalidResponse(input, "identity_mismatch");
  }

  const response = input.response;
  if (response.advice.kind === "approved") {
    const approved = response as FinalVerdictResponseV1;
    return {
      _tag: "CompletedVerdict",
      response: approved,
      terminal: input.terminal,
      quorumEligible: true,
      deliberationEligible: true,
    };
  }

  if (response.advice.kind === "changes_requested") {
    const changes = response as FinalVerdictResponseV1;
    if (!findingsValid(input, changes)) {
      return completedInvalidResponse(input, "findings_invalid");
    }
    return {
      _tag: "CompletedVerdict",
      response: changes,
      terminal: input.terminal,
      quorumEligible: true,
      deliberationEligible: true,
    };
  }

  // Remaining advice branch is abstention. Advice lives only under response.
  const abstentionResponse = response as FinalAbstentionResponseV1;
  if (evidenceGapsValid(input, abstentionResponse.advice.abstention)) {
    return {
      _tag: "CompletedAbstention",
      response: abstentionResponse,
      terminal: input.terminal,
      quorumEligible: false,
      deliberationEligible: true,
    };
  }

  return completedInvalidResponse(input, "abstention_invalid");
};

/**
 * Quorum participants accept only completed substantive verdicts.
 * Completed abstentions and infrastructure failures never count.
 */
export const isQuorumEligibleClassification = (
  classification: ReviewAttemptClassification,
): boolean => classification._tag === "CompletedVerdict";
