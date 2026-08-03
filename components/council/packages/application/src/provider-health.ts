import {
  type CanaryChallengeV1,
  type CanaryReceiptV1,
  CanaryReceiptV1 as CanaryReceiptV1Schema,
  CanaryResponseV1,
  type ContentHash,
  type ProviderFamilyV1,
  type UtcTimestamp,
  decodeStrictSync,
  hashCanaryChallenge,
  isSuccessfulTerminalObservation,
} from "@council/schema";
import { Effect } from "effect";
import type {
  ProviderCanaryAdapterError,
  ProviderProcessError,
} from "./errors.js";
import { ProviderHealthError } from "./errors.js";
import {
  type ProviderCanaryPrompt,
  type ProviderCanarySchema,
  ProviderCanaryAdapter,
  ProviderProcessRunner,
} from "./ports.js";

/**
 * Identity and adapter-invocation fields required to run one bounded canary
 * and construct a strictly validated CanaryReceiptV1 on success.
 */
export type RunProviderHealthCanaryInput = {
  readonly providerFamily: ProviderFamilyV1;
  readonly model: string;
  readonly cliVersion: string;
  readonly contractClass: string;
  readonly promptHash: ContentHash;
  readonly schemaVariantHash: ContentHash;
  readonly canarySchemaVariantHash: ContentHash;
  readonly challenge: CanaryChallengeV1;
  readonly observedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  readonly executable: string;
  readonly prompt: ProviderCanaryPrompt;
  readonly schema: ProviderCanarySchema;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxBytes: number;
};

const mapAdapterError = (
  error: ProviderCanaryAdapterError,
): ProviderHealthError =>
  new ProviderHealthError({
    category: "adapter",
    reason: error.reason,
    terminal: null,
  });

const mapProcessError = (error: ProviderProcessError): ProviderHealthError => {
  if (error.category === "start_failed") {
    return new ProviderHealthError({
      category: "process_start",
      reason: error.reason,
      terminal: null,
    });
  }
  return new ProviderHealthError({
    category: "process",
    reason: error.reason,
    terminal: null,
  });
};

const tryDecodeResponse = (
  value: unknown,
):
  | { readonly ok: true; readonly response: typeof CanaryResponseV1.Type }
  | { readonly ok: false; readonly reason: string } => {
  try {
    const response = decodeStrictSync(CanaryResponseV1, value);
    return { ok: true, response };
  } catch {
    return {
      ok: false,
      reason: "canary response failed strict CanaryResponseV1 decoding",
    };
  }
};

const tryDecodeReceipt = (
  value: unknown,
):
  | { readonly ok: true; readonly receipt: CanaryReceiptV1 }
  | { readonly ok: false; readonly reason: string } => {
  try {
    const receipt = decodeStrictSync(CanaryReceiptV1Schema, value);
    return { ok: true, receipt };
  } catch {
    return {
      ok: false,
      reason:
        "canary receipt failed strict CanaryReceiptV1 decoding (chronology, nonce binding, or terminal state)",
    };
  }
};

/**
 * Execute one bounded provider-health canary through Effect.
 *
 * Order is fixed and must not be reordered:
 * 1. Build the shell-free invocation.
 * 2. Run the bounded provider process.
 * 3. Decode terminal transport.
 * 4. Require isSuccessfulTerminalObservation(terminal).
 * 5. Only after step 4, strictly decode the designated value with CanaryResponseV1.
 * 6. Require exact response nonce equality with the challenge nonce.
 * 7. Recompute challengeHash with hashCanaryChallenge.
 * 8. Construct and strictly decode CanaryReceiptV1.
 *
 * A terminal failure wins over a valid-looking structured value. Raw output
 * never becomes a fallback response. Process start failures remain typed.
 * Effect interruption remains owned by the WP5a process runner.
 */
export const runProviderHealthCanary = (
  input: RunProviderHealthCanaryInput,
): Effect.Effect<
  CanaryReceiptV1,
  ProviderHealthError,
  ProviderCanaryAdapter | ProviderProcessRunner
> =>
  Effect.gen(function* () {
    const adapter = yield* ProviderCanaryAdapter;
    const runner = yield* ProviderProcessRunner;

    // 1. Build the shell-free invocation.
    const request = yield* adapter
      .buildRequest({
        providerFamily: input.providerFamily,
        executable: input.executable,
        model: input.model,
        prompt: input.prompt,
        schema: input.schema,
        cwd: input.cwd,
        environment: input.environment,
        timeoutMs: input.timeoutMs,
        stdoutMaxBytes: input.stdoutMaxBytes,
        stderrMaxBytes: input.stderrMaxBytes,
      })
      .pipe(Effect.mapError(mapAdapterError));

    // 2. Run the bounded provider process.
    const observation = yield* runner
      .run(request)
      .pipe(Effect.mapError(mapProcessError));

    // 3. Decode terminal transport.
    const decoded = yield* adapter
      .decodeObservation(observation)
      .pipe(Effect.mapError(mapAdapterError));

    const terminal = decoded.terminal;

    // 4. Require successful terminal before reading structured output.
    if (!isSuccessfulTerminalObservation(terminal)) {
      return yield* Effect.fail(
        new ProviderHealthError({
          category: "terminal",
          reason:
            terminal.errorMessage ??
            "provider terminal observation is not a successful completed observation",
          terminal,
        }),
      );
    }

    // 5. Strictly decode the designated structured value (terminal-first).
    const responseResult = tryDecodeResponse(decoded.structuredOutput);
    if (!responseResult.ok) {
      return yield* Effect.fail(
        new ProviderHealthError({
          category: "response",
          reason: responseResult.reason,
          terminal,
        }),
      );
    }
    const response = responseResult.response;

    // 6. Exact response nonce equality with the challenge nonce.
    if (response.nonce !== input.challenge.nonce) {
      return yield* Effect.fail(
        new ProviderHealthError({
          category: "response",
          reason: "canary response nonce does not match challenge nonce",
          terminal,
        }),
      );
    }

    // 7. Recompute challengeHash; never trust a caller-supplied value alone.
    const challengeHash = hashCanaryChallenge(input.challenge);

    // 8. Construct and strictly decode CanaryReceiptV1 (chronology authority).
    const candidate = {
      schemaVersion: 1 as const,
      providerFamily: input.providerFamily,
      model: input.model,
      cliVersion: input.cliVersion,
      contractClass: input.contractClass,
      promptHash: input.promptHash,
      schemaVariantHash: input.schemaVariantHash,
      canarySchemaVariantHash: input.canarySchemaVariantHash,
      challengeHash,
      challenge: input.challenge,
      response,
      terminal,
      observedAt: input.observedAt,
      expiresAt: input.expiresAt,
    };

    const receiptResult = tryDecodeReceipt(candidate);
    if (!receiptResult.ok) {
      return yield* Effect.fail(
        new ProviderHealthError({
          category: "receipt",
          reason: receiptResult.reason,
          terminal,
        }),
      );
    }

    return receiptResult.receipt;
  });
