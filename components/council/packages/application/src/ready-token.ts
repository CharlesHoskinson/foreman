import {
  type CanaryReceiptV1,
  CanaryReceiptV1 as CanaryReceiptV1Schema,
  type CanonicalCompiledPromptV1,
  CanonicalCompiledPromptV1 as CanonicalCompiledPromptV1Schema,
  type PromptPreflightReadyV1,
  PromptPreflightReadyV1 as PromptPreflightReadyV1Schema,
  type UtcTimestamp,
  decodeStrictSync,
} from "@council/schema";
import { Effect } from "effect";
import { ReadyTokenIssuanceError } from "./errors.js";

const utcEpochMs = (value: string): number => Date.parse(value);

const tryDecodePrompt = (
  value: unknown,
):
  | { readonly ok: true; readonly prompt: CanonicalCompiledPromptV1 }
  | { readonly ok: false } => {
  try {
    const prompt = decodeStrictSync(CanonicalCompiledPromptV1Schema, value);
    return { ok: true, prompt };
  } catch {
    return { ok: false };
  }
};

const tryDecodeCanary = (
  value: unknown,
):
  | { readonly ok: true; readonly canary: CanaryReceiptV1 }
  | { readonly ok: false } => {
  try {
    const canary = decodeStrictSync(CanaryReceiptV1Schema, value);
    return { ok: true, canary };
  } catch {
    return { ok: false };
  }
};

const tryDecodeReady = (
  value: unknown,
):
  | { readonly ok: true; readonly ready: PromptPreflightReadyV1 }
  | { readonly ok: false } => {
  try {
    const ready = decodeStrictSync(PromptPreflightReadyV1Schema, value);
    return { ok: true, ready };
  } catch {
    return { ok: false };
  }
};

/**
 * Issue one strictly decoded ready-review token from a compiled prompt and a
 * successful canary receipt.
 *
 * Order is fixed and must not be reordered:
 * 1. Strictly decode CanonicalCompiledPromptV1.
 * 2. Strictly decode CanaryReceiptV1.
 * 3. Check ready-triple identity relationships before construction.
 * 4. Check chronology before construction.
 * 5. Construct ReadyReviewTokenV1 without a caller-supplied identity field.
 * 6. Construct and strictly decode PromptPreflightReadyV1.
 *
 * Fail closed on any mismatch. Do not repair, coerce, merge, or prefer one
 * mismatched identity. Do not expose a partially issued token on failure.
 * Timestamps are explicit inputs (no clock port) so tests stay deterministic.
 */
export const issueReadyReviewToken = (input: {
  readonly prompt: CanonicalCompiledPromptV1;
  readonly canary: CanaryReceiptV1;
  readonly issuedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
}): Effect.Effect<PromptPreflightReadyV1, ReadyTokenIssuanceError> =>
  Effect.gen(function* () {
    // 1. Strictly decode the compiled prompt (schema authority at boundary).
    const promptResult = tryDecodePrompt(input.prompt);
    if (!promptResult.ok) {
      return yield* Effect.fail(
        new ReadyTokenIssuanceError({
          category: "prompt_invalid",
          reason:
            "compiled prompt failed strict CanonicalCompiledPromptV1 decoding",
        }),
      );
    }
    const prompt = promptResult.prompt;

    // 2. Strictly decode the canary receipt (schema authority at boundary).
    const canaryResult = tryDecodeCanary(input.canary);
    if (!canaryResult.ok) {
      return yield* Effect.fail(
        new ReadyTokenIssuanceError({
          category: "canary_invalid",
          reason: "canary receipt failed strict CanaryReceiptV1 decoding",
        }),
      );
    }
    const canary = canaryResult.canary;

    // 3. Ready-triple identity relationships before construction.
    if (prompt.profile !== canary.contractClass) {
      return yield* Effect.fail(
        new ReadyTokenIssuanceError({
          category: "identity_mismatch",
          reason: "prompt profile does not equal canary contract class",
        }),
      );
    }
    if (prompt.promptHash !== canary.promptHash) {
      return yield* Effect.fail(
        new ReadyTokenIssuanceError({
          category: "identity_mismatch",
          reason: "prompt hash does not equal canary prompt hash",
        }),
      );
    }
    if (prompt.schemaVariantHash !== canary.schemaVariantHash) {
      return yield* Effect.fail(
        new ReadyTokenIssuanceError({
          category: "identity_mismatch",
          reason:
            "prompt review-schema hash does not equal canary review-schema hash",
        }),
      );
    }

    // 4. Chronology before construction.
    // canary.observedAt <= token.issuedAt < token.expiresAt <= canary.expiresAt
    const observedMs = utcEpochMs(canary.observedAt);
    const issuedMs = utcEpochMs(input.issuedAt);
    const tokenExpiresMs = utcEpochMs(input.expiresAt);
    const canaryExpiresMs = utcEpochMs(canary.expiresAt);

    if (observedMs > issuedMs) {
      return yield* Effect.fail(
        new ReadyTokenIssuanceError({
          category: "chronology_invalid",
          reason: "canary observed time is after token issue time",
        }),
      );
    }
    if (issuedMs >= tokenExpiresMs) {
      return yield* Effect.fail(
        new ReadyTokenIssuanceError({
          category: "chronology_invalid",
          reason: "token issue time is not before token expiry",
        }),
      );
    }
    if (tokenExpiresMs > canaryExpiresMs) {
      return yield* Effect.fail(
        new ReadyTokenIssuanceError({
          category: "chronology_invalid",
          reason: "token expiry is after canary expiry",
        }),
      );
    }

    // 5. Construct ReadyReviewTokenV1 without a caller-supplied identity field.
    // Provider family, model, CLI version, and nonce come from the canary.
    // Contract hash, prompt hash, and review-schema hash come from the prompt.
    // Only issue and expiry timestamps come from this function input.
    const token = {
      schemaVersion: 1 as const,
      providerFamily: canary.providerFamily,
      model: canary.model,
      cliVersion: canary.cliVersion,
      contractHash: prompt.contractHash,
      promptHash: prompt.promptHash,
      schemaVariantHash: prompt.schemaVariantHash,
      nonce: canary.challenge.nonce,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    };

    // 6. Construct the ready triple and strictly decode PromptPreflightReadyV1.
    const candidate = {
      _tag: "ready" as const,
      schemaVersion: 1 as const,
      prompt,
      canary,
      token,
    };

    const readyResult = tryDecodeReady(candidate);
    if (!readyResult.ok) {
      return yield* Effect.fail(
        new ReadyTokenIssuanceError({
          category: "result_invalid",
          reason: "ready triple failed strict PromptPreflightReadyV1 decoding",
        }),
      );
    }

    return readyResult.ready;
  });
