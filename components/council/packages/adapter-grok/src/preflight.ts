import {
  type ProviderCanaryBuildInput,
  type ProviderCanaryDecoded,
  type ProviderProcessObservation,
  type ProviderProcessRequest,
  ProviderCanaryAdapter,
  ProviderCanaryAdapterError,
} from "@council/application";
import type { TerminalObservationV1 } from "@council/schema";
import { isSuccessfulStopReason } from "@council/schema";
import { Effect, Layer } from "effect";

/**
 * Grok-stable (0.2.118) canary invocation input. Provider-neutral fields only;
 * wire shapes stay private below.
 */
export type GrokCanaryInvocationInput = {
  readonly executable: string;
  readonly promptFile: string;
  readonly schemaJson: string;
  readonly model: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxBytes: number;
};

export type DecodedGrokCanary = {
  readonly terminal: TerminalObservationV1;
  // Binding contract: designated structured output or null when absent/invalid.
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- interface requires unknown | null
  readonly structuredOutput: unknown | null;
};

/** Private Grok outer JSON wire shape. Not exported from this package root. */
type GrokOuterWire = {
  readonly stopReason?: unknown;
  readonly structuredOutput?: unknown;
  readonly structuredOutputError?: unknown;
  readonly num_turns?: unknown;
  readonly text?: unknown;
};

const hasJsonSuffix = (promptFile: string): boolean => {
  const base = promptFile.split(/[/\\]/).pop() ?? promptFile;
  return base.toLowerCase().endsWith(".json");
};

/**
 * Build a shell-free Grok canary process request for stable CLI 0.2.118.
 * Rejects a `.json` prompt filename — 0.2.112 treated those as ACP objects.
 */
export const buildGrokCanaryInvocation = (
  input: GrokCanaryInvocationInput,
): ProviderProcessRequest => {
  if (hasJsonSuffix(input.promptFile)) {
    throw new Error(
      "Grok canary prompt file must not use a .json suffix; use .txt (ACP misparse risk)",
    );
  }
  return {
    executable: input.executable,
    args: [
      "--prompt-file",
      input.promptFile,
      "-m",
      input.model,
      "--permission-mode",
      "plan",
      "--json-schema",
      input.schemaJson,
      "--no-leader",
      "--output-format",
      "json",
      "--cwd",
      input.cwd,
      "--max-turns",
      "1",
      "--no-subagents",
      "--disable-web-search",
      "--no-memory",
      "--tools",
      "",
      "--verbatim",
    ],
    cwd: input.cwd,
    environment: input.environment,
    timeoutMs: input.timeoutMs,
    stdoutMaxBytes: input.stdoutMaxBytes,
    stderrMaxBytes: input.stderrMaxBytes,
  };
};

/**
 * Accept only absent, null, or string for Grok outer string|null fields.
 * Numbers, booleans, and objects are rejected — never coerced.
 */
const asStrictNullableString = (
  value: unknown,
):
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false } => {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value === "string") {
    return { ok: true, value };
  }
  return { ok: false };
};

/**
 * Portable UTF-8 decode for pure packages (no DOM / Node ambient types).
 * Invalid sequences become U+FFFD so JSON parse still fails closed on garbage.
 */
const decodeUtf8 = (bytes: Uint8Array): string => {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i] ?? 0;
    if (b0 <= 0x7f) {
      out += String.fromCharCode(b0);
      i += 1;
      continue;
    }
    if (b0 >= 0xc2 && b0 <= 0xdf && i + 1 < bytes.length) {
      const b1 = bytes[i + 1] ?? 0;
      if ((b1 & 0xc0) === 0x80) {
        out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
        i += 2;
        continue;
      }
    }
    if (b0 >= 0xe0 && b0 <= 0xef && i + 2 < bytes.length) {
      const b1 = bytes[i + 1] ?? 0;
      const b2 = bytes[i + 2] ?? 0;
      if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80) {
        const code = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
        out += String.fromCharCode(code);
        i += 3;
        continue;
      }
    }
    if (b0 >= 0xf0 && b0 <= 0xf4 && i + 3 < bytes.length) {
      const b1 = bytes[i + 1] ?? 0;
      const b2 = bytes[i + 2] ?? 0;
      const b3 = bytes[i + 3] ?? 0;
      if (
        (b1 & 0xc0) === 0x80 &&
        (b2 & 0xc0) === 0x80 &&
        (b3 & 0xc0) === 0x80
      ) {
        let code =
          ((b0 & 0x07) << 18) |
          ((b1 & 0x3f) << 12) |
          ((b2 & 0x3f) << 6) |
          (b3 & 0x3f);
        code -= 0x10000;
        out += String.fromCharCode(
          0xd800 + ((code >> 10) & 0x3ff),
          0xdc00 + (code & 0x3ff),
        );
        i += 4;
        continue;
      }
    }
    out += "\uFFFD";
    i += 1;
  }
  return out;
};

const parseOuter = (
  stdout: Uint8Array,
):
  | { readonly ok: true; readonly wire: GrokOuterWire }
  | { readonly ok: false } => {
  if (stdout.byteLength === 0) return { ok: false };
  const text = decodeUtf8(stdout).trim();
  if (text.length === 0) return { ok: false };
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return { ok: false };
    }
    const wire: GrokOuterWire = parsed;
    return { ok: true, wire };
  } catch {
    return { ok: false };
  }
};

const baseTerminal = (
  observation: ProviderProcessObservation,
  partial: Omit<
    TerminalObservationV1,
    "schemaVersion" | "stdoutDigest" | "stderrDigest" | "exitCode"
  > & {
    readonly exitCode?: number | null;
  },
): TerminalObservationV1 => ({
  schemaVersion: 1,
  exitCode:
    partial.exitCode !== undefined ? partial.exitCode : observation.exitCode,
  stdoutDigest: observation.stdout.digest,
  stderrDigest: observation.stderr.digest,
  modelTurnStarted: partial.modelTurnStarted,
  terminalRecordObserved: partial.terminalRecordObserved,
  terminalState: partial.terminalState,
  stopReason: partial.stopReason,
  pendingToolCalls: partial.pendingToolCalls,
  failedToolCalls: partial.failedToolCalls,
  parserComplete: partial.parserComplete,
  structuredOutputPresent: partial.structuredOutputPresent,
  structuredOutputError: partial.structuredOutputError,
  errorMessage: partial.errorMessage,
});

/**
 * Decode exactly one Grok outer JSON object into provider-neutral terminal
 * evidence. Never promotes the `text` field to structured output. Cancelled,
 * timeout, signal, nonzero exit, malformed JSON, missing structured output, a
 * structured-output error, or a missing terminal record cannot yield a
 * successful terminal observation (schema package is the success authority).
 */
export const decodeGrokCanaryTerminal = (
  observation: ProviderProcessObservation,
): DecodedGrokCanary => {
  if (observation.timedOut) {
    return {
      structuredOutput: null,
      terminal: baseTerminal(observation, {
        modelTurnStarted: false,
        terminalRecordObserved: false,
        terminalState: "timeout",
        stopReason: null,
        pendingToolCalls: 0,
        failedToolCalls: 0,
        parserComplete: false,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage: "provider process exceeded deadline",
      }),
    };
  }

  // Every non-null process signal is a failed terminal observation, regardless
  // of the exit-code field (providers may report signal with exitCode 0).
  if (observation.signal !== null) {
    return {
      structuredOutput: null,
      terminal: baseTerminal(observation, {
        modelTurnStarted: false,
        terminalRecordObserved: false,
        terminalState: "signal",
        stopReason: null,
        pendingToolCalls: 0,
        failedToolCalls: 0,
        parserComplete: false,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage: `provider process terminated by signal ${observation.signal}`,
      }),
    };
  }

  const parsed = parseOuter(observation.stdout.bytes);
  if (!parsed.ok) {
    return {
      structuredOutput: null,
      terminal: baseTerminal(observation, {
        modelTurnStarted: false,
        terminalRecordObserved: false,
        terminalState:
          observation.exitCode !== null && observation.exitCode !== 0
            ? "error"
            : "error",
        stopReason: null,
        pendingToolCalls: 0,
        failedToolCalls: 0,
        parserComplete: false,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage:
          observation.exitCode !== null && observation.exitCode !== 0
            ? "provider process exited nonzero without a parseable terminal record"
            : "provider stdout is not exactly one Grok outer JSON object",
      }),
    };
  }

  const wire = parsed.wire;
  const stopReasonField = asStrictNullableString(wire.stopReason);
  const structuredOutputErrorField = asStrictNullableString(
    wire.structuredOutputError,
  );
  // Present non-(string|null) outer fields fail closed — no coercion.
  if (!stopReasonField.ok || !structuredOutputErrorField.ok) {
    return {
      structuredOutput: null,
      terminal: baseTerminal(observation, {
        modelTurnStarted: false,
        terminalRecordObserved: false,
        terminalState: "error",
        stopReason: null,
        pendingToolCalls: 0,
        failedToolCalls: 0,
        parserComplete: false,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage:
          "provider outer JSON has a malformed stopReason or structuredOutputError field type",
      }),
    };
  }
  const stopReason = stopReasonField.value;
  const structuredOutputError = structuredOutputErrorField.value;
  // Never promote `text` — only the designated structuredOutput field.
  const structuredOutput =
    wire.structuredOutput === undefined ? null : wire.structuredOutput;
  const structuredOutputPresent = structuredOutput !== null;
  const numTurns =
    typeof wire.num_turns === "number" && Number.isFinite(wire.num_turns)
      ? wire.num_turns
      : 0;
  const modelTurnStarted = numTurns >= 1;

  if (stopReason === "Cancelled") {
    return {
      structuredOutput: structuredOutputPresent ? structuredOutput : null,
      terminal: baseTerminal(observation, {
        modelTurnStarted,
        terminalRecordObserved: true,
        terminalState: "cancelled",
        stopReason: "Cancelled",
        pendingToolCalls: 0,
        failedToolCalls: 0,
        parserComplete: true,
        structuredOutputPresent,
        structuredOutputError,
        errorMessage: "provider stopReason is Cancelled",
      }),
    };
  }

  if (observation.exitCode !== 0) {
    return {
      structuredOutput: structuredOutputPresent ? structuredOutput : null,
      terminal: baseTerminal(observation, {
        modelTurnStarted,
        terminalRecordObserved: true,
        terminalState: "error",
        stopReason,
        pendingToolCalls: 0,
        failedToolCalls: 0,
        parserComplete: true,
        structuredOutputPresent,
        structuredOutputError,
        errorMessage: "provider process exited nonzero",
      }),
    };
  }

  if (!structuredOutputPresent || structuredOutputError !== null) {
    return {
      structuredOutput: null,
      terminal: baseTerminal(observation, {
        modelTurnStarted,
        terminalRecordObserved: true,
        terminalState: "completed",
        stopReason,
        pendingToolCalls: 0,
        failedToolCalls: 0,
        parserComplete: true,
        structuredOutputPresent: false,
        structuredOutputError:
          structuredOutputError ?? "designated structured output is missing",
        errorMessage: "designated structured output is missing or errored",
      }),
    };
  }

  if (!isSuccessfulStopReason(stopReason)) {
    return {
      structuredOutput,
      terminal: baseTerminal(observation, {
        modelTurnStarted,
        terminalRecordObserved: true,
        terminalState: "error",
        stopReason,
        pendingToolCalls: 0,
        failedToolCalls: 0,
        parserComplete: true,
        structuredOutputPresent: true,
        structuredOutputError,
        errorMessage: "provider stopReason is not a successful stop reason",
      }),
    };
  }

  // Successful path candidates — schema package remains the final authority
  // via isSuccessfulTerminalObservation at the call site.
  return {
    structuredOutput,
    terminal: baseTerminal(observation, {
      modelTurnStarted,
      terminalRecordObserved: true,
      terminalState: "completed",
      stopReason,
      pendingToolCalls: 0,
      failedToolCalls: 0,
      parserComplete: true,
      structuredOutputPresent: true,
      structuredOutputError: null,
      errorMessage: null,
    }),
  };
};

/**
 * Grok implementation of ProviderCanaryAdapter.
 *
 * - Accepts only provider family `xai`.
 * - Wraps the existing `.json` prompt-file refusal as a typed adapter error.
 * - Keeps the exact Grok 0.2.118 argument contract via buildGrokCanaryInvocation.
 * - Never promotes the outer `text` field (decodeGrokCanaryTerminal).
 * - Returns all non-success terminal states for application classification.
 */
export const GrokProviderCanaryAdapterLive = Layer.succeed(
  ProviderCanaryAdapter,
  {
    buildRequest: (input: ProviderCanaryBuildInput) =>
      Effect.gen(function* () {
        if (input.providerFamily !== "xai") {
          return yield* Effect.fail(
            new ProviderCanaryAdapterError({
              category: "unsupported_family",
              reason:
                "Grok provider canary adapter accepts only provider family xai",
            }),
          );
        }
        try {
          return buildGrokCanaryInvocation({
            executable: input.executable,
            promptFile: input.promptFile,
            schemaJson: input.canaryResponseSchemaJson,
            model: input.model,
            cwd: input.cwd,
            environment: input.environment,
            timeoutMs: input.timeoutMs,
            stdoutMaxBytes: input.stdoutMaxBytes,
            stderrMaxBytes: input.stderrMaxBytes,
          });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Grok canary invocation is invalid";
          return yield* Effect.fail(
            new ProviderCanaryAdapterError({
              category: "invalid_invocation",
              reason: message,
            }),
          );
        }
      }),
    decodeObservation: (
      observation: ProviderProcessObservation,
    ): Effect.Effect<ProviderCanaryDecoded> => {
      const decoded = decodeGrokCanaryTerminal(observation);
      return Effect.succeed({
        terminal: decoded.terminal,
        structuredOutput: decoded.structuredOutput,
      });
    },
  },
);
