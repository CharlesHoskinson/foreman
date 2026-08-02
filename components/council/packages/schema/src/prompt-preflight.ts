import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as Schema from "effect/Schema";
import {
  NonBlankString,
  ReviewAbstention,
  ReviewInfrastructureFailure,
} from "./deliberation.js";
import {
  ArtifactId,
  CandidateId,
  ContractHash,
  ContentHash,
  UtcTimestamp,
} from "./identifiers.js";

const VersionOne = Schema.Literal(1);

const SafePositiveInteger = Schema.Number.pipe(
  Schema.filter(Number.isSafeInteger),
  Schema.positive(),
);

const SafeNonNegativeInteger = Schema.Number.pipe(
  Schema.filter(Number.isSafeInteger),
  Schema.nonNegative(),
);

const SafeInteger = Schema.Number.pipe(Schema.filter(Number.isSafeInteger));

const ContentWord = Schema.String.pipe(Schema.pattern(/^[a-z]+(-[a-z]+)*$/));

const SafeArtifactAlias = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9-]*$/),
);

const MediaType = Schema.String.pipe(
  Schema.pattern(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/),
);

/**
 * Closed provider-family set for ready tokens and canary receipts.
 * Raw provider wire types stay private outside this package.
 */
export const ProviderFamilyV1 = Schema.Literal(
  "anthropic",
  "xai",
  "google",
  "openai",
);
export type ProviderFamilyV1 = typeof ProviderFamilyV1.Type;

/**
 * Reserved ACE function words. Content lexicon entries must not reuse them.
 */
export const ACE_RESERVED_FUNCTION_WORDS = [
  "a",
  "the",
  "every",
  "no",
  "one",
  "exactly",
  "must",
  "may",
  "not",
  "if",
  "then",
  "and",
  "or",
] as const;

const reservedFunctionWordSet = new Set<string>(ACE_RESERVED_FUNCTION_WORDS);

const isReservedFunctionWord = (word: string): boolean =>
  reservedFunctionWordSet.has(word);

/**
 * Council ACE Profile 1 prohibited referential surface forms (version 1).
 *
 * Exhaustive for this profile version: personal, possessive, reflexive,
 * demonstrative, relative/interrogative, indefinite/distributive/quantifier,
 * reciprocal multiword, and explicit anaphoric surface forms. Both the strict
 * `AceLexiconV1` boundary and the domain source scan consume this list.
 *
 * Multiword forms remain here for source scanning; they are already invalid as
 * single content words under `ContentWord`. A new form requires a Profile
 * version bump or an explicit addition with tests — this is not an unbounded
 * natural-language recognizer.
 *
 * `one` is intentionally absent: it is a reserved Profile 1 function word.
 */
export const COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1 = Object.freeze([
  // Reciprocal / multiword (source scan; not valid ContentWord tokens).
  "no one",
  "each other",
  "one another",
  // Personal, possessive, and reflexive.
  "i",
  "me",
  "my",
  "mine",
  "myself",
  "we",
  "us",
  "our",
  "ours",
  "ourselves",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
  "he",
  "him",
  "his",
  "himself",
  "she",
  "her",
  "hers",
  "herself",
  "it",
  "its",
  "itself",
  "they",
  "them",
  "their",
  "theirs",
  "themselves",
  "oneself",
  // Demonstrative.
  "this",
  "that",
  "these",
  "those",
  // Relative / interrogative.
  "who",
  "whom",
  "which",
  "what",
  "whose",
  "whoever",
  "whomever",
  "whatever",
  "whichever",
  "whosoever",
  "whomsoever",
  "whatsoever",
  "whichsoever",
  // Indefinite / distributive / quantifier pronouns.
  "all",
  "another",
  "any",
  "anybody",
  "anyone",
  "anything",
  "both",
  "each",
  "either",
  "enough",
  "everybody",
  "everyone",
  "everything",
  "few",
  "fewer",
  "less",
  "little",
  "many",
  "more",
  "most",
  "much",
  "neither",
  "nobody",
  "none",
  "nothing",
  "other",
  "others",
  "several",
  "some",
  "somebody",
  "someone",
  "something",
  "such",
  // Explicit anaphoric surface forms.
  "aforesaid",
  "aforementioned",
  "former",
  "latter",
  "same",
] as const);

export type CouncilAceProhibitedReferentialFormV1 =
  (typeof COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1)[number];

const singleTokenProhibitedReferentialFormSet: ReadonlySet<string> = new Set(
  COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1.filter(
    (form) => !form.includes(" "),
  ),
);

const isProhibitedReferentialForm = (word: string): boolean =>
  singleTokenProhibitedReferentialFormSet.has(word);

const uniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const utcEpochMs = (value: string): number => Date.parse(value);

/**
 * Closed set of normalized successful stop reasons for provider adapters.
 *
 * Adapters MUST map provider-native stop reasons onto this set before the pure
 * core sees them. Cancellation, timeout, signal, length/max-turn, and error
 * reasons are never successful. `null` means the provider omitted a reason;
 * every other non-null string fails closed.
 */
export const SUCCESSFUL_STOP_REASONS = ["end_turn", "stop"] as const;
export type SuccessfulStopReasonV1 = (typeof SUCCESSFUL_STOP_REASONS)[number];

const successfulStopReasonSet: ReadonlySet<string> = new Set(
  SUCCESSFUL_STOP_REASONS,
);

/**
 * True only when stopReason is null or a member of SUCCESSFUL_STOP_REASONS.
 */
export const isSuccessfulStopReason = (stopReason: string | null): boolean =>
  stopReason === null || successfulStopReasonSet.has(stopReason);

/**
 * Successful terminal observation required for canary receipts and completed
 * classifications. Fail-closed: every transport and parser gate must pass.
 * Cancelled and every other non-success stop reason are never successful.
 */
export const isSuccessfulTerminalObservation = (terminal: {
  readonly modelTurnStarted: boolean;
  readonly terminalRecordObserved: boolean;
  readonly terminalState: string;
  readonly exitCode: number | null;
  readonly stopReason: string | null;
  readonly pendingToolCalls: number;
  readonly failedToolCalls: number;
  readonly parserComplete: boolean;
  readonly structuredOutputPresent: boolean;
  readonly structuredOutputError: string | null;
  readonly errorMessage: string | null;
}): boolean =>
  terminal.modelTurnStarted &&
  terminal.terminalRecordObserved &&
  terminal.terminalState === "completed" &&
  terminal.exitCode === 0 &&
  isSuccessfulStopReason(terminal.stopReason) &&
  terminal.pendingToolCalls === 0 &&
  terminal.failedToolCalls === 0 &&
  terminal.parserComplete &&
  terminal.structuredOutputPresent &&
  terminal.structuredOutputError === null &&
  terminal.errorMessage === null;

export const GitCommitSha = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{40}$/),
  Schema.brand("GitCommitSha"),
);
export type GitCommitSha = typeof GitCommitSha.Type;

export const Sha256Digest = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{64}$/),
  Schema.brand("Sha256Digest"),
);
export type Sha256Digest = typeof Sha256Digest.Type;

export const ReviewBundleIdentityV1 = Schema.Struct({
  schemaVersion: VersionOne,
  baseSha: GitCommitSha,
  headSha: GitCommitSha,
  diffSha256: Sha256Digest,
});
export type ReviewBundleIdentityV1 = typeof ReviewBundleIdentityV1.Type;

export const AceLexiconVerbEntryV1 = Schema.Struct({
  base: ContentWord,
  thirdPerson: ContentWord,
});
export type AceLexiconVerbEntryV1 = typeof AceLexiconVerbEntryV1.Type;

export const AceLexiconV1 = Schema.Struct({
  schemaVersion: VersionOne,
  nouns: Schema.Array(ContentWord),
  verbs: Schema.Array(AceLexiconVerbEntryV1),
}).pipe(
  Schema.filter((lexicon) => {
    if (lexicon.nouns.length < 1) {
      return false;
    }
    if (lexicon.verbs.length < 1) {
      return false;
    }
    if (!uniqueStrings(lexicon.nouns)) {
      return false;
    }
    if (lexicon.nouns.some(isReservedFunctionWord)) {
      return false;
    }
    // Profile 1: single-token prohibited referential forms never enter the
    // content lexicon (noun or either verb form).
    if (lexicon.nouns.some(isProhibitedReferentialForm)) {
      return false;
    }
    const bases = lexicon.verbs.map((verb) => verb.base);
    const thirds = lexicon.verbs.map((verb) => verb.thirdPerson);
    if (!uniqueStrings(bases) || !uniqueStrings(thirds)) {
      return false;
    }
    // Any form used twice across base and third-person is ambiguous.
    if (!uniqueStrings([...bases, ...thirds])) {
      return false;
    }
    if (
      bases.some(isReservedFunctionWord) ||
      thirds.some(isReservedFunctionWord)
    ) {
      return false;
    }
    if (
      bases.some(isProhibitedReferentialForm) ||
      thirds.some(isProhibitedReferentialForm)
    ) {
      return false;
    }
    return true;
  }),
);
export type AceLexiconV1 = typeof AceLexiconV1.Type;

export const ReviewArtifactDescriptorV1 = Schema.Struct({
  schemaVersion: VersionOne,
  alias: SafeArtifactAlias,
  mediaType: MediaType,
  byteLength: SafeNonNegativeInteger,
  digest: Sha256Digest,
  artifactId: ArtifactId,
}).pipe(
  Schema.filter(
    (artifact) => String(artifact.artifactId) === `sha256:${artifact.digest}`,
  ),
);
export type ReviewArtifactDescriptorV1 = typeof ReviewArtifactDescriptorV1.Type;

const uniqueArtifactDescriptors = (
  artifacts: readonly ReviewArtifactDescriptorV1[],
): boolean =>
  uniqueStrings(artifacts.map((artifact) => artifact.artifactId)) &&
  uniqueStrings(artifacts.map((artifact) => artifact.alias));

export const CouncilPromptLimitsV1 = Schema.Struct({
  maxPromptBytes: SafePositiveInteger,
  maxArtifactBytes: SafePositiveInteger,
  maxTurns: SafePositiveInteger,
  maxWallTimeMs: SafePositiveInteger,
  maxRetries: SafePositiveInteger,
});
export type CouncilPromptLimitsV1 = typeof CouncilPromptLimitsV1.Type;

export const CouncilPromptContractV1 = Schema.Struct({
  schemaVersion: VersionOne,
  profile: Schema.Literal("council-ace-1"),
  aceSource: NonBlankString,
  lexicon: AceLexiconV1,
  candidateId: CandidateId,
  bundle: ReviewBundleIdentityV1,
  artifacts: Schema.Array(ReviewArtifactDescriptorV1),
  responseSchemaArtifactId: ArtifactId,
  limits: CouncilPromptLimitsV1,
}).pipe(
  Schema.filter((contract) => {
    if (contract.artifacts.length < 1) {
      return false;
    }
    if (!uniqueArtifactDescriptors(contract.artifacts)) {
      return false;
    }
    return contract.artifacts.some(
      (artifact) => artifact.artifactId === contract.responseSchemaArtifactId,
    );
  }),
);
export type CouncilPromptContractV1 = typeof CouncilPromptContractV1.Type;

/**
 * Ready-review token issued only after a successful canary.
 * `schemaVariantHash` is the provider-lowered **review-response** schema
 * identity (not the canary-response schema).
 */
export const ReadyReviewTokenV1 = Schema.Struct({
  schemaVersion: VersionOne,
  providerFamily: ProviderFamilyV1,
  model: NonBlankString,
  cliVersion: NonBlankString,
  contractHash: ContractHash,
  promptHash: ContentHash,
  schemaVariantHash: ContentHash,
  nonce: NonBlankString,
  issuedAt: UtcTimestamp,
  expiresAt: UtcTimestamp,
}).pipe(
  Schema.filter(
    (token) => utcEpochMs(token.expiresAt) > utcEpochMs(token.issuedAt),
  ),
);
export type ReadyReviewTokenV1 = typeof ReadyReviewTokenV1.Type;

/**
 * Canonical compiled-prompt descriptor after materialization and hashing.
 * Provider wire types stay private outside this package.
 *
 * `schemaVariantHash` identifies the exact provider-lowered **review-response**
 * schema bound into the ready triple. It is not the canary-response schema.
 */
export const CanonicalCompiledPromptV1 = Schema.Struct({
  schemaVersion: VersionOne,
  profile: Schema.Literal("council-ace-1"),
  contractHash: ContractHash,
  promptHash: ContentHash,
  schemaVariantHash: ContentHash,
  canonicalAceText: NonBlankString,
  promptByteLength: SafeNonNegativeInteger,
  candidateId: CandidateId,
  bundle: ReviewBundleIdentityV1,
  artifactIds: Schema.NonEmptyArray(ArtifactId),
  responseSchemaArtifactId: ArtifactId,
}).pipe(
  Schema.filter((prompt) => {
    if (!uniqueStrings(prompt.artifactIds)) {
      return false;
    }
    return prompt.artifactIds.includes(prompt.responseSchemaArtifactId);
  }),
);
export type CanonicalCompiledPromptV1 = typeof CanonicalCompiledPromptV1.Type;

/**
 * Council ACE Profile 1 fixed canary check. This is a versioned health probe,
 * not an expression language. Never evaluate the expression.
 */
export const COUNCIL_ACE_CANARY_CHECK_V1 = {
  checkExpression: "1+1",
  expectedCheckResult: "2",
} as const;

/**
 * Portable UTF-8 encoder. Avoids the TextEncoder host global so the schema
 * package stays runtime-neutral under the architecture gate.
 */
const encodeUtf8 = (value: string): Uint8Array => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        index += 1;
      }
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
 * Canonical UTF-8 encoding of a complete CanaryChallengeV1 for challengeHash.
 *
 * Encoding rules (stable, unambiguous, no whitespace variance):
 * 1. Serialize exactly these keys in this order as a JSON object:
 *    schemaVersion, nonce, checkExpression, expectedCheckResult.
 * 2. Use JSON string escaping for string fields; numbers as decimal.
 * 3. No spaces between tokens (JSON.stringify default for this shape).
 * 4. UTF-8 encode the resulting string with the portable encoder above.
 *
 * Provider runtimes MUST use this encoding. A second representation is invalid.
 */
export const encodeCanaryChallengeCanonical = (challenge: {
  readonly schemaVersion: 1;
  readonly nonce: string;
  readonly checkExpression: string;
  readonly expectedCheckResult: string;
}): Uint8Array => {
  const json = JSON.stringify({
    schemaVersion: challenge.schemaVersion,
    nonce: challenge.nonce,
    checkExpression: challenge.checkExpression,
    expectedCheckResult: challenge.expectedCheckResult,
  });
  return encodeUtf8(json);
};

/**
 * Recompute the ContentHash of a canary challenge from its canonical bytes.
 * Callers must not invent a second hash representation.
 */
export const hashCanaryChallenge = (challenge: {
  readonly schemaVersion: 1;
  readonly nonce: string;
  readonly checkExpression: string;
  readonly expectedCheckResult: string;
}): ContentHash => {
  const digest = bytesToHex(sha256(encodeCanaryChallengeCanonical(challenge)));
  return `sha256:${digest}` as ContentHash;
};

export const CanaryChallengeV1 = Schema.Struct({
  schemaVersion: VersionOne,
  nonce: NonBlankString,
  checkExpression: Schema.Literal(COUNCIL_ACE_CANARY_CHECK_V1.checkExpression),
  expectedCheckResult: Schema.Literal(
    COUNCIL_ACE_CANARY_CHECK_V1.expectedCheckResult,
  ),
});
export type CanaryChallengeV1 = typeof CanaryChallengeV1.Type;

export const CanaryResponseV1 = Schema.Struct({
  schemaVersion: VersionOne,
  nonce: NonBlankString,
  checkResult: Schema.Literal(COUNCIL_ACE_CANARY_CHECK_V1.expectedCheckResult),
  status: Schema.Literal("ready"),
});
export type CanaryResponseV1 = typeof CanaryResponseV1.Type;

export const TerminalStateV1 = Schema.Literal(
  "completed",
  "cancelled",
  "timeout",
  "signal",
  "error",
  "preflight_failed",
);
export type TerminalStateV1 = typeof TerminalStateV1.Type;

/**
 * Provider-neutral terminal observation. Empty spools still have digests;
 * digests are never null.
 */
export const TerminalObservationV1 = Schema.Struct({
  schemaVersion: VersionOne,
  modelTurnStarted: Schema.Boolean,
  terminalRecordObserved: Schema.Boolean,
  terminalState: TerminalStateV1,
  exitCode: Schema.NullOr(SafeInteger),
  stopReason: Schema.NullOr(Schema.String),
  pendingToolCalls: SafeNonNegativeInteger,
  failedToolCalls: SafeNonNegativeInteger,
  parserComplete: Schema.Boolean,
  structuredOutputPresent: Schema.Boolean,
  structuredOutputError: Schema.NullOr(Schema.String),
  stdoutDigest: Sha256Digest,
  stderrDigest: Sha256Digest,
  errorMessage: Schema.NullOr(Schema.String),
});
export type TerminalObservationV1 = typeof TerminalObservationV1.Type;

/**
 * Successful terminal only. Used by canary receipts and completed classifications.
 */
export const SuccessfulTerminalObservationV1 = TerminalObservationV1.pipe(
  Schema.filter(isSuccessfulTerminalObservation, {
    message: () =>
      "terminal observation is not a successful completed observation",
  }),
);
export type SuccessfulTerminalObservationV1 =
  typeof SuccessfulTerminalObservationV1.Type;

/**
 * Successful canary receipt. Internally consistent: challenge matches response,
 * timing is ordered, and the terminal is a successful observation.
 * Spool digests live only on `terminal`.
 *
 * Hash fields:
 * - `schemaVariantHash` — exact provider-lowered **review-response** schema
 *   identity (must match prompt and ready token).
 * - `canarySchemaVariantHash` — exact small **canary-response** schema identity
 *   sent during the canary. It may differ from the review-schema hash.
 * - `challengeHash` — recomputed SHA-256 of the complete challenge (including
 *   nonce) under `encodeCanaryChallengeCanonical`. Caller-supplied hashes that
 *   do not recompute are rejected.
 */
export const CanaryReceiptV1 = Schema.Struct({
  schemaVersion: VersionOne,
  providerFamily: ProviderFamilyV1,
  model: NonBlankString,
  cliVersion: NonBlankString,
  contractClass: NonBlankString,
  promptHash: ContentHash,
  schemaVariantHash: ContentHash,
  canarySchemaVariantHash: ContentHash,
  challengeHash: ContentHash,
  challenge: CanaryChallengeV1,
  response: CanaryResponseV1,
  terminal: SuccessfulTerminalObservationV1,
  observedAt: UtcTimestamp,
  expiresAt: UtcTimestamp,
}).pipe(
  Schema.filter((receipt) => {
    if (utcEpochMs(receipt.expiresAt) <= utcEpochMs(receipt.observedAt)) {
      return false;
    }
    // Fixed Profile 1 check (1+1 → 2) is enforced by CanaryChallengeV1 and
    // CanaryResponseV1 literals. Cross-field: response nonce must match.
    if (receipt.response.nonce !== receipt.challenge.nonce) {
      return false;
    }
    // Recompute challengeHash; never trust a caller-supplied value alone.
    if (receipt.challengeHash !== hashCanaryChallenge(receipt.challenge)) {
      return false;
    }
    return true;
  }),
);
export type CanaryReceiptV1 = typeof CanaryReceiptV1.Type;

/**
 * Cross-field binding for a ready preflight triple.
 *
 * Pipeline order is canary first, then ready-token issuance. The token must
 * not outlive the canary receipt. Chronology:
 *   canary.observedAt <= token.issuedAt < token.expiresAt <= canary.expiresAt
 *
 * Review-schema identity (not canary schema):
 *   prompt.schemaVariantHash === token.schemaVariantHash === canary.schemaVariantHash
 *
 * `canary.canarySchemaVariantHash` is independent and may differ.
 */
const preflightReadyConsistent = (value: {
  readonly prompt: CanonicalCompiledPromptV1;
  readonly canary: CanaryReceiptV1;
  readonly token: ReadyReviewTokenV1;
}): boolean => {
  const { prompt, canary, token } = value;
  if (token.providerFamily !== canary.providerFamily) {
    return false;
  }
  if (token.model !== canary.model) {
    return false;
  }
  if (token.cliVersion !== canary.cliVersion) {
    return false;
  }
  if (token.contractHash !== prompt.contractHash) {
    return false;
  }
  if (token.promptHash !== prompt.promptHash) {
    return false;
  }
  if (token.promptHash !== canary.promptHash) {
    return false;
  }
  // Review-response schema identity must agree across the ready triple.
  if (prompt.schemaVariantHash !== token.schemaVariantHash) {
    return false;
  }
  if (token.schemaVariantHash !== canary.schemaVariantHash) {
    return false;
  }
  if (prompt.schemaVariantHash !== canary.schemaVariantHash) {
    return false;
  }
  // Token nonce is the canary challenge nonce (receipt already binds response).
  if (token.nonce !== canary.challenge.nonce) {
    return false;
  }
  // Canary contract class must match the compiled prompt profile.
  if (canary.contractClass !== prompt.profile) {
    return false;
  }
  // Canary first, then token issuance; token must not outlive the receipt.
  const observed = utcEpochMs(canary.observedAt);
  const issued = utcEpochMs(token.issuedAt);
  const tokenExpires = utcEpochMs(token.expiresAt);
  const canaryExpires = utcEpochMs(canary.expiresAt);
  if (observed > issued) {
    return false;
  }
  if (issued >= tokenExpires) {
    return false;
  }
  if (tokenExpires > canaryExpires) {
    return false;
  }
  return true;
};

export const PromptPreflightReadyV1 = Schema.Struct({
  _tag: Schema.Literal("ready"),
  schemaVersion: VersionOne,
  prompt: CanonicalCompiledPromptV1,
  canary: CanaryReceiptV1,
  token: ReadyReviewTokenV1,
}).pipe(Schema.filter(preflightReadyConsistent));
export type PromptPreflightReadyV1 = typeof PromptPreflightReadyV1.Type;

export const PromptPreflightFailureV1 = Schema.Struct({
  _tag: Schema.Literal("failure"),
  schemaVersion: VersionOne,
  failure: ReviewInfrastructureFailure,
  terminal: Schema.NullOr(TerminalObservationV1),
});
export type PromptPreflightFailureV1 = typeof PromptPreflightFailureV1.Type;

export const PromptPreflightResultV1 = Schema.Union(
  PromptPreflightReadyV1,
  PromptPreflightFailureV1,
);
export type PromptPreflightResultV1 = typeof PromptPreflightResultV1.Type;

export const MaterialFindingV1 = Schema.Struct({
  artifactId: ArtifactId,
  location: NonBlankString,
  summary: NonBlankString,
  nextAction: NonBlankString,
});
export type MaterialFindingV1 = typeof MaterialFindingV1.Type;

const FinalReviewIdentityFields = {
  schemaVersion: VersionOne,
  readyTokenHash: ContentHash,
  contractHash: ContractHash,
  promptHash: ContentHash,
  bundle: ReviewBundleIdentityV1,
  reviewerId: NonBlankString,
  candidateId: CandidateId,
  inspectedArtifactIds: Schema.NonEmptyArray(ArtifactId),
} as const;

export const FinalApprovedResponseV1 = Schema.Struct({
  ...FinalReviewIdentityFields,
  advice: Schema.Struct({
    kind: Schema.Literal("approved"),
  }),
});
export type FinalApprovedResponseV1 = typeof FinalApprovedResponseV1.Type;

export const FinalChangesRequestedResponseV1 = Schema.Struct({
  ...FinalReviewIdentityFields,
  advice: Schema.Struct({
    kind: Schema.Literal("changes_requested"),
    findings: Schema.NonEmptyArray(MaterialFindingV1),
  }),
});
export type FinalChangesRequestedResponseV1 =
  typeof FinalChangesRequestedResponseV1.Type;

export const FinalAbstentionResponseV1 = Schema.Struct({
  ...FinalReviewIdentityFields,
  advice: Schema.Struct({
    kind: Schema.Literal("abstention"),
    abstention: ReviewAbstention,
  }),
});
export type FinalAbstentionResponseV1 = typeof FinalAbstentionResponseV1.Type;

export const FinalVerdictResponseV1 = Schema.Union(
  FinalApprovedResponseV1,
  FinalChangesRequestedResponseV1,
);
export type FinalVerdictResponseV1 = typeof FinalVerdictResponseV1.Type;

export const FinalReviewResponseV1 = Schema.Union(
  FinalApprovedResponseV1,
  FinalChangesRequestedResponseV1,
  FinalAbstentionResponseV1,
);
export type FinalReviewResponseV1 = typeof FinalReviewResponseV1.Type;

export const ProviderPreflightFailedV1 = Schema.Struct({
  _tag: Schema.Literal("ProviderPreflightFailed"),
  failure: ReviewInfrastructureFailure,
  terminal: TerminalObservationV1,
  quorumEligible: Schema.Literal(false),
  deliberationEligible: Schema.Literal(false),
});
export type ProviderPreflightFailedV1 = typeof ProviderPreflightFailedV1.Type;

export const ReviewAttemptFailedV1 = Schema.Struct({
  _tag: Schema.Literal("ReviewAttemptFailed"),
  failure: ReviewInfrastructureFailure,
  terminal: TerminalObservationV1,
  quorumEligible: Schema.Literal(false),
  deliberationEligible: Schema.Literal(false),
});
export type ReviewAttemptFailedV1 = typeof ReviewAttemptFailedV1.Type;

/**
 * Completed verdict classification. Advice lives only inside `response`.
 * Terminal must be a successful completed observation.
 */
export const CompletedVerdictV1 = Schema.Struct({
  _tag: Schema.Literal("CompletedVerdict"),
  response: FinalVerdictResponseV1,
  terminal: SuccessfulTerminalObservationV1,
  quorumEligible: Schema.Literal(true),
  deliberationEligible: Schema.Literal(true),
});
export type CompletedVerdictV1 = typeof CompletedVerdictV1.Type;

/**
 * Completed abstention classification. Advice lives only inside `response`.
 * No duplicated top-level abstention field. Terminal must be successful.
 */
export const CompletedAbstentionV1 = Schema.Struct({
  _tag: Schema.Literal("CompletedAbstention"),
  response: FinalAbstentionResponseV1,
  terminal: SuccessfulTerminalObservationV1,
  quorumEligible: Schema.Literal(false),
  deliberationEligible: Schema.Literal(true),
});
export type CompletedAbstentionV1 = typeof CompletedAbstentionV1.Type;

export const ReviewAttemptClassificationV1 = Schema.Union(
  ProviderPreflightFailedV1,
  ReviewAttemptFailedV1,
  CompletedVerdictV1,
  CompletedAbstentionV1,
);
export type ReviewAttemptClassificationV1 =
  typeof ReviewAttemptClassificationV1.Type;

/**
 * Serialized host observation for pure review-admission classification.
 * Concrete expected identities replace the opaque identityExact shortcut.
 *
 * While both preflight signals exist they must agree:
 *   preflightStageFailed === (preflightFailure !== undefined)
 */
export const ReviewAttemptInputV1 = Schema.Struct({
  preflightStageFailed: Schema.Boolean,
  preflightFailure: Schema.optional(ReviewInfrastructureFailure),
  terminal: TerminalObservationV1,
  readyTokenCurrent: Schema.Boolean,
  expectedReadyTokenHash: ContentHash,
  expectedContractHash: ContractHash,
  expectedPromptHash: ContentHash,
  expectedBundle: ReviewBundleIdentityV1,
  expectedReviewerId: NonBlankString,
  expectedCandidateId: CandidateId,
  expectedArtifactIds: Schema.NonEmptyArray(ArtifactId),
  verifiedArtifactIds: Schema.Array(ArtifactId),
  bundleVerified: Schema.Boolean,
  designatedStructuredValid: Schema.Boolean,
  declaredEvidenceNamespace: Schema.Array(NonBlankString),
  response: Schema.optional(FinalReviewResponseV1),
  ordinaryText: Schema.optional(Schema.String),
}).pipe(
  Schema.filter((input) => {
    const hasFailure = input.preflightFailure !== undefined;
    if (input.preflightStageFailed !== hasFailure) {
      return false;
    }
    if (!uniqueStrings(input.expectedArtifactIds)) {
      return false;
    }
    if (!uniqueStrings(input.verifiedArtifactIds)) {
      return false;
    }
    if (!uniqueStrings(input.declaredEvidenceNamespace)) {
      return false;
    }
    return true;
  }),
);
export type ReviewAttemptInputV1 = typeof ReviewAttemptInputV1.Type;
