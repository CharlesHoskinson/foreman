import {
  COUNCIL_ACE_CANARY_CHECK_V1,
  type PromptPreflightResultV1,
  PromptPreflightResultV1 as PromptPreflightResultV1Schema,
  type TerminalObservationV1,
  type UtcTimestamp,
  UtcTimestamp as UtcTimestampSchema,
  decodeStrictSync,
} from "@council/schema";
import { Cause, Effect, Option } from "effect";
import type {
  CanaryMaterializerError,
  PreflightIdentityError,
  ProviderHealthError,
  ProviderVersionProbeError,
} from "./errors.js";
import type {
  ArtifactReader,
  BundleVerifier,
  Digest,
  PromptMaterializer,
  ProviderCanaryAdapter,
  ProviderProcessRunner,
  ProviderSchemaLowerer,
} from "./ports.js";
import {
  CanaryMaterializer,
  PreflightIdentitySource,
  ProviderVersionProbe,
} from "./ports.js";
import { compileReviewPrompt } from "./prompt-preflight.js";
import { runProviderHealthCanary } from "./provider-health.js";
import { issueReadyReviewToken } from "./ready-token.js";

/** Canary receipt lifetime after observation. */
const CANARY_TTL_MS = 10 * 60 * 1000;
/** Ready-token lifetime after issuance (must not outlive canary). */
const TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Application input for the preflight coordinator. CLI version is never
 * accepted from the caller — it is derived through ProviderVersionProbe.
 */
export type RunPromptPreflightInput = {
  readonly contract: unknown;
  readonly providerFamily: unknown;
  readonly executable: string;
  readonly model: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxBytes: number;
};

type FailureStage = "prompt" | "dispatch" | "provider" | "transport" | "parse";
type FailureRetry = "same_contract" | "changed_preflight" | "new_contract";

type FailureCandidate = {
  readonly _tag: "failure";
  readonly schemaVersion: 1;
  readonly failure: {
    readonly stage: FailureStage;
    readonly reason: string;
    readonly retry: FailureRetry;
  };
  readonly terminal: TerminalObservationV1 | null;
};

const addUtcMs = (timestamp: UtcTimestamp, deltaMs: number): UtcTimestamp =>
  decodeStrictSync(
    UtcTimestampSchema,
    new Date(Date.parse(timestamp) + deltaMs).toISOString(),
  );

const tryDecodeResult = (
  value: unknown,
):
  | { readonly ok: true; readonly result: PromptPreflightResultV1 }
  | { readonly ok: false } => {
  try {
    const result = decodeStrictSync(PromptPreflightResultV1Schema, value);
    return { ok: true, result };
  } catch {
    return { ok: false };
  }
};

const closedFailure = (
  stage: FailureStage,
  reason: string,
  retry: FailureRetry,
  terminal: TerminalObservationV1 | null,
): FailureCandidate => ({
  _tag: "failure",
  schemaVersion: 1,
  failure: { stage, reason, retry },
  terminal,
});

const decodeOrParseFailure = (
  candidate: unknown,
): Effect.Effect<PromptPreflightResultV1> => {
  const decoded = tryDecodeResult(candidate);
  if (decoded.ok) {
    return Effect.succeed(decoded.result);
  }
  const parseFailure = closedFailure(
    "parse",
    "preflight result failed strict decoding",
    "changed_preflight",
    null,
  );
  const decodedParse = tryDecodeResult(parseFailure);
  if (decodedParse.ok) {
    return Effect.succeed(decodedParse.result);
  }
  // Schema-reachable closed shape; last resort without throwing.
  return Effect.succeed(parseFailure);
};

const mapVersionError = (error: ProviderVersionProbeError): FailureCandidate =>
  closedFailure(
    "dispatch",
    error.reason.length > 0
      ? error.reason
      : "provider CLI version probe failed",
    "changed_preflight",
    null,
  );

const mapCompileError = (): FailureCandidate =>
  closedFailure(
    "prompt",
    "review prompt compilation failed",
    "new_contract",
    null,
  );

const mapIdentityError = (error: PreflightIdentityError): FailureCandidate => {
  if (error.category === "nonce_failed") {
    return closedFailure(
      "dispatch",
      "preflight nonce generation failed",
      "changed_preflight",
      null,
    );
  }
  if (error.category === "clock_failed") {
    return closedFailure(
      "dispatch",
      "preflight clock source failed",
      "changed_preflight",
      null,
    );
  }
  return closedFailure(
    "dispatch",
    "preflight identity source failed",
    "changed_preflight",
    null,
  );
};

const mapMaterializerError = (
  error: CanaryMaterializerError,
): FailureCandidate => {
  if (error.category === "unsupported_family") {
    return closedFailure(
      "dispatch",
      "provider family is not supported for canary materialization",
      "changed_preflight",
      null,
    );
  }
  return closedFailure(
    "dispatch",
    "canary material preparation failed",
    "changed_preflight",
    null,
  );
};

const mapHealthError = (error: ProviderHealthError): FailureCandidate => {
  const terminal = error.terminal;
  switch (error.category) {
    case "adapter":
      return closedFailure(
        "dispatch",
        "provider canary adapter failed",
        "changed_preflight",
        null,
      );
    case "process_start":
      return closedFailure(
        "dispatch",
        "provider process failed to start",
        "changed_preflight",
        null,
      );
    case "process":
      return closedFailure(
        "transport",
        "provider process transport failed",
        "same_contract",
        null,
      );
    case "terminal":
      return closedFailure(
        "provider",
        "provider canary terminal observation failed",
        "changed_preflight",
        terminal,
      );
    case "response":
      return closedFailure(
        "provider",
        "provider canary response validation failed",
        "changed_preflight",
        terminal,
      );
    case "receipt":
      return closedFailure(
        "provider",
        "provider canary receipt validation failed",
        "changed_preflight",
        terminal,
      );
    default:
      return closedFailure(
        "provider",
        "provider health canary failed",
        "changed_preflight",
        terminal,
      );
  }
};

const mapTokenError = (): FailureCandidate =>
  closedFailure(
    "parse",
    "ready review token issuance failed",
    "changed_preflight",
    null,
  );

const secretSafeDefectFailure = (): FailureCandidate =>
  closedFailure(
    "parse",
    "preflight failed due to an internal defect",
    "changed_preflight",
    null,
  );

/**
 * Run prompt preflight: version → compile → nonce → prepare-canary →
 * run-canary → issue-token.
 *
 * Always succeeds with a strictly decoded `PromptPreflightResultV1`. Expected
 * failures are `_tag: "failure"` values, not the Effect error channel.
 * Token issuance never runs before a successful terminal-first canary.
 */
export const runPromptPreflight = (
  input: RunPromptPreflightInput,
): Effect.Effect<
  PromptPreflightResultV1,
  never,
  | ProviderVersionProbe
  | ArtifactReader
  | BundleVerifier
  | Digest
  | PromptMaterializer
  | ProviderSchemaLowerer
  | PreflightIdentitySource
  | CanaryMaterializer
  | ProviderCanaryAdapter
  | ProviderProcessRunner
> =>
  Effect.gen(function* () {
    const versionProbe = yield* ProviderVersionProbe;
    const identity = yield* PreflightIdentitySource;
    const materializer = yield* CanaryMaterializer;

    // 1. version — derive CLI version; never accept from input.
    const cliVersionEither = yield* versionProbe
      .resolve(input.executable, input.cwd, input.environment)
      .pipe(Effect.either);
    if (cliVersionEither._tag === "Left") {
      return yield* decodeOrParseFailure(
        mapVersionError(cliVersionEither.left),
      );
    }
    const cliVersion = cliVersionEither.right;

    // 2. compile — no provider process may start on failure.
    const compiledEither = yield* compileReviewPrompt({
      contract: input.contract,
      providerFamily: input.providerFamily,
    }).pipe(Effect.either);
    if (compiledEither._tag === "Left") {
      return yield* decodeOrParseFailure(mapCompileError());
    }
    const compiled = compiledEither.right;
    const providerFamily = compiled.loweringReceipt.providerFamily;

    // 3. nonce — fixed Profile 1 challenge (1+1 → 2).
    const nonceEither = yield* identity.nonce.pipe(Effect.either);
    if (nonceEither._tag === "Left") {
      return yield* decodeOrParseFailure(mapIdentityError(nonceEither.left));
    }
    const challenge = {
      schemaVersion: 1 as const,
      nonce: nonceEither.right,
      checkExpression: COUNCIL_ACE_CANARY_CHECK_V1.checkExpression,
      expectedCheckResult: COUNCIL_ACE_CANARY_CHECK_V1.expectedCheckResult,
    };

    // 4–5. prepare-canary + run-canary inside one scope (temp file lifetime).
    const canaryEither = yield* Effect.scoped(
      Effect.gen(function* () {
        const preparedEither = yield* materializer
          .prepare(challenge, providerFamily)
          .pipe(Effect.either);
        if (preparedEither._tag === "Left") {
          return {
            _tag: "failure" as const,
            failure: mapMaterializerError(preparedEither.left),
          };
        }
        const prepared = preparedEither.right;

        const observedEither = yield* identity.now.pipe(Effect.either);
        if (observedEither._tag === "Left") {
          return {
            _tag: "failure" as const,
            failure: mapIdentityError(observedEither.left),
          };
        }
        const observedAt = observedEither.right;
        const canaryExpiresAt = addUtcMs(observedAt, CANARY_TTL_MS);

        const receiptEither = yield* runProviderHealthCanary({
          providerFamily,
          model: input.model,
          cliVersion,
          contractClass: compiled.descriptor.profile,
          promptHash: compiled.promptHash,
          schemaVariantHash: compiled.schemaVariantHash,
          canarySchemaVariantHash: prepared.canarySchemaVariantHash,
          challenge,
          observedAt,
          expiresAt: canaryExpiresAt,
          executable: input.executable,
          prompt: prepared.prompt,
          schema: prepared.schema,
          cwd: input.cwd,
          environment: input.environment,
          timeoutMs: input.timeoutMs,
          stdoutMaxBytes: input.stdoutMaxBytes,
          stderrMaxBytes: input.stderrMaxBytes,
        }).pipe(Effect.either);

        if (receiptEither._tag === "Left") {
          return {
            _tag: "failure" as const,
            failure: mapHealthError(receiptEither.left),
          };
        }
        return {
          _tag: "success" as const,
          receipt: receiptEither.right,
        };
      }),
    );

    if (canaryEither._tag === "failure") {
      return yield* decodeOrParseFailure(canaryEither.failure);
    }
    const canary = canaryEither.receipt;

    // 6. issue-token — only after successful terminal-first canary validation.
    const issuedEither = yield* identity.now.pipe(Effect.either);
    if (issuedEither._tag === "Left") {
      return yield* decodeOrParseFailure(mapIdentityError(issuedEither.left));
    }
    const issuedAt = issuedEither.right;
    // Token must not outlive canary; clamp to canary expiry when needed.
    const rawTokenExpires = addUtcMs(issuedAt, TOKEN_TTL_MS);
    const tokenExpiresAt =
      Date.parse(rawTokenExpires) <= Date.parse(canary.expiresAt)
        ? rawTokenExpires
        : canary.expiresAt;

    const readyEither = yield* issueReadyReviewToken({
      prompt: compiled.descriptor,
      canary,
      issuedAt,
      expiresAt: tokenExpiresAt,
    }).pipe(Effect.either);
    if (readyEither._tag === "Left") {
      return yield* decodeOrParseFailure(mapTokenError());
    }

    return yield* decodeOrParseFailure(readyEither.right);
  }).pipe(
    Effect.sandbox,
    Effect.catchAll((cause) => {
      // Expected failures are values on the success channel. Anything that
      // reaches here is a defect or unexpected typed failure — map closed.
      const failureOption = Cause.failureOption(cause);
      if (Option.isSome(failureOption)) {
        return decodeOrParseFailure(secretSafeDefectFailure());
      }
      return decodeOrParseFailure(secretSafeDefectFailure());
    }),
  );
