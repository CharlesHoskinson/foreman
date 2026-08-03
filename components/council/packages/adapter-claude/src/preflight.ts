import {
  type ProviderCanaryBuildInput,
  type ProviderCanaryDecoded,
  type ProviderProcessObservation,
  type ProviderProcessRequest,
  ProviderCanaryAdapter,
  ProviderCanaryAdapterError,
} from "@council/application";
import type { TerminalObservationV1 } from "@council/schema";
import { Effect, Layer } from "effect";

/**
 * Claude Code (2.1.220) canary invocation input. Provider-neutral fields only;
 * wire shapes stay private below.
 */
export type ClaudeCanaryInvocationInput = {
  readonly executable: string;
  readonly promptBytes: Uint8Array;
  readonly schemaJson: string;
  readonly model: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxBytes: number;
};

export type DecodedClaudeCanary = {
  readonly terminal: TerminalObservationV1;
  // Binding contract: designated structured output or null when absent/invalid.
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- interface requires unknown | null
  readonly structuredOutput: unknown | null;
};

/**
 * Private Claude Code outer JSON wire shape from the authenticated probe.
 * Not exported from this package root.
 */
type ClaudeOuterWire = {
  readonly type?: unknown;
  readonly subtype?: unknown;
  readonly is_error?: unknown;
  readonly stop_reason?: unknown;
  readonly terminal_reason?: unknown;
  readonly api_error_status?: unknown;
  readonly num_turns?: unknown;
  readonly structured_output?: unknown;
  readonly result?: unknown;
};

/**
 * Build a shell-free Claude canary process request for CLI 2.1.220.
 * Prompt bytes travel only on stdin; argv never contains prompt text.
 */
export const buildClaudeCanaryInvocation = (
  input: ClaudeCanaryInvocationInput,
): ProviderProcessRequest => ({
  executable: input.executable,
  args: [
    "-p",
    "--model",
    input.model,
    "--effort",
    "low",
    "--output-format",
    "json",
    "--json-schema",
    input.schemaJson,
    "--tools",
    "",
    "--permission-mode",
    "plan",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--safe-mode",
    "--no-chrome",
  ],
  cwd: input.cwd,
  environment: input.environment,
  timeoutMs: input.timeoutMs,
  stdoutMaxBytes: input.stdoutMaxBytes,
  stderrMaxBytes: input.stderrMaxBytes,
  stdin: input.promptBytes,
});

const asStrictString = (
  value: unknown,
): { readonly ok: true; readonly value: string } | { readonly ok: false } => {
  if (typeof value === "string") {
    return { ok: true, value };
  }
  return { ok: false };
};

/**
 * Accept only a boolean. Strings and numbers are never coerced.
 */
const asStrictBoolean = (
  value: unknown,
): { readonly ok: true; readonly value: boolean } | { readonly ok: false } => {
  if (typeof value === "boolean") {
    return { ok: true, value };
  }
  return { ok: false };
};

/**
 * Accept only a finite, non-negative safe integer. Strings are never coerced.
 */
const asStrictNonNegativeInteger = (
  value: unknown,
): { readonly ok: true; readonly value: number } | { readonly ok: false } => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return { ok: true, value };
  }
  return { ok: false };
};

/**
 * Portable strict UTF-8 decode for pure packages (no DOM / Node ambient types).
 * Reject overlong forms, surrogate code points, out-of-range code points,
 * isolated continuation bytes, and truncated sequences.
 */
const decodeUtf8 = (
  bytes: Uint8Array,
): { readonly ok: true; readonly value: string } | { readonly ok: false } => {
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
      const firstContinuationValid =
        (b0 === 0xe0 && b1 >= 0xa0 && b1 <= 0xbf) ||
        (b0 >= 0xe1 && b0 <= 0xec && (b1 & 0xc0) === 0x80) ||
        (b0 === 0xed && b1 >= 0x80 && b1 <= 0x9f) ||
        (b0 >= 0xee && b0 <= 0xef && (b1 & 0xc0) === 0x80);
      if (firstContinuationValid && (b2 & 0xc0) === 0x80) {
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
      const firstContinuationValid =
        (b0 === 0xf0 && b1 >= 0x90 && b1 <= 0xbf) ||
        (b0 >= 0xf1 && b0 <= 0xf3 && (b1 & 0xc0) === 0x80) ||
        (b0 === 0xf4 && b1 >= 0x80 && b1 <= 0x8f);
      if (
        firstContinuationValid &&
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
    return { ok: false };
  }
  return { ok: true, value: out };
};

const parseOuter = (
  stdout: Uint8Array,
):
  | { readonly ok: true; readonly wire: ClaudeOuterWire }
  | { readonly ok: false } => {
  if (stdout.byteLength === 0) return { ok: false };
  const decoded = decodeUtf8(stdout);
  if (!decoded.ok) return { ok: false };
  const text = decoded.value.trim();
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
    const wire: ClaudeOuterWire = parsed;
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

const failureTerminal = (
  observation: ProviderProcessObservation,
  partial: Omit<
    Parameters<typeof baseTerminal>[1],
    "pendingToolCalls" | "failedToolCalls"
  >,
): TerminalObservationV1 =>
  baseTerminal(observation, {
    ...partial,
    pendingToolCalls: null,
    failedToolCalls: null,
  });

/**
 * Map a private Claude stop_reason onto the provider-neutral closed set.
 * Successful schema-output tool_use is normalized to stop (not a pending tool).
 */
const normalizeClaudeStopReason = (
  stopReason: string | null,
): string | null => {
  if (stopReason === "tool_use") return "stop";
  return stopReason;
};

/**
 * Decode exactly one Claude outer JSON object into provider-neutral terminal
 * evidence. Never promotes the `result` text field to structured output.
 * Timeout, signal, nonzero exit, malformed JSON, malformed field types,
 * is_error, provider error status, non-success subtype, non-completed terminal
 * reason, or missing structured_output cannot yield a successful terminal.
 */
export const decodeClaudeCanaryTerminal = (
  observation: ProviderProcessObservation,
): DecodedClaudeCanary => {
  if (observation.timedOut) {
    return {
      structuredOutput: null,
      terminal: failureTerminal(observation, {
        modelTurnStarted: false,
        terminalRecordObserved: false,
        terminalState: "timeout",
        stopReason: null,
        parserComplete: false,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage: "provider process exceeded deadline",
      }),
    };
  }

  if (observation.signal !== null) {
    return {
      structuredOutput: null,
      terminal: failureTerminal(observation, {
        modelTurnStarted: false,
        terminalRecordObserved: false,
        terminalState: "signal",
        stopReason: null,
        parserComplete: false,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage: "provider process terminated by signal",
      }),
    };
  }

  const parsed = parseOuter(observation.stdout.bytes);
  if (!parsed.ok) {
    return {
      structuredOutput: null,
      terminal: failureTerminal(observation, {
        modelTurnStarted: false,
        terminalRecordObserved: false,
        terminalState: "error",
        stopReason: null,
        parserComplete: false,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage:
          observation.exitCode !== null && observation.exitCode !== 0
            ? "provider process exited nonzero without a parseable terminal record"
            : "provider stdout is not exactly one Claude outer JSON object",
      }),
    };
  }

  const wire = parsed.wire;
  const requiredFields = [
    "type",
    "subtype",
    "is_error",
    "stop_reason",
    "terminal_reason",
    "api_error_status",
    "num_turns",
    "result",
  ] as const;
  const requiredFieldsPresent = requiredFields.every((field) =>
    Object.prototype.hasOwnProperty.call(wire, field),
  );
  const typeField = asStrictString(wire.type);
  const subtypeField = asStrictString(wire.subtype);
  const isErrorField = asStrictBoolean(wire.is_error);
  const stopReasonField = asStrictString(wire.stop_reason);
  const terminalReasonField = asStrictString(wire.terminal_reason);
  const numTurnsField = asStrictNonNegativeInteger(wire.num_turns);
  const resultField = asStrictString(wire.result);
  // api_error_status is exactly null on success. A non-negative safe integer
  // is provider-error evidence. Every other value fails without coercion.
  const apiErrorStatus = wire.api_error_status;
  const apiErrorMalformed =
    apiErrorStatus !== null &&
    !(
      typeof apiErrorStatus === "number" &&
      Number.isSafeInteger(apiErrorStatus) &&
      apiErrorStatus >= 0
    );
  const apiErrorPresent =
    typeof apiErrorStatus === "number" &&
    Number.isSafeInteger(apiErrorStatus) &&
    apiErrorStatus >= 0;

  if (
    !requiredFieldsPresent ||
    !typeField.ok ||
    !subtypeField.ok ||
    !isErrorField.ok ||
    !stopReasonField.ok ||
    !terminalReasonField.ok ||
    !numTurnsField.ok ||
    !resultField.ok ||
    apiErrorMalformed
  ) {
    return {
      structuredOutput: null,
      terminal: failureTerminal(observation, {
        modelTurnStarted: false,
        terminalRecordObserved: false,
        terminalState: "error",
        stopReason: null,
        parserComplete: false,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage: "provider outer JSON has a malformed field type",
      }),
    };
  }

  const isError = isErrorField.value;
  const subtype = subtypeField.value;
  const terminalReason = terminalReasonField.value;
  const rawStopReason = stopReasonField.value;
  const numTurns = numTurnsField.value;
  const modelTurnStarted = numTurns >= 1;
  // Never promote `result` — only the designated structured_output field.
  const hasDesignatedOutput =
    Object.prototype.hasOwnProperty.call(wire, "structured_output") &&
    wire.structured_output !== undefined &&
    wire.structured_output !== null;
  const structuredOutput = hasDesignatedOutput ? wire.structured_output : null;

  if (observation.exitCode !== 0) {
    return {
      structuredOutput: null,
      terminal: failureTerminal(observation, {
        modelTurnStarted,
        terminalRecordObserved: true,
        terminalState: "error",
        stopReason: normalizeClaudeStopReason(rawStopReason),
        parserComplete: true,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage: "provider process exited nonzero",
      }),
    };
  }

  if (isError) {
    return {
      structuredOutput: null,
      terminal: failureTerminal(observation, {
        modelTurnStarted,
        terminalRecordObserved: true,
        terminalState: "error",
        stopReason: normalizeClaudeStopReason(rawStopReason),
        parserComplete: true,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage: "provider reported is_error",
      }),
    };
  }

  if (apiErrorPresent) {
    return {
      structuredOutput: null,
      terminal: failureTerminal(observation, {
        modelTurnStarted,
        terminalRecordObserved: true,
        terminalState: "error",
        stopReason: normalizeClaudeStopReason(rawStopReason),
        parserComplete: true,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage: "provider reported an api error status",
      }),
    };
  }

  if (typeField.value !== "result" || subtype !== "success") {
    return {
      structuredOutput: null,
      terminal: failureTerminal(observation, {
        modelTurnStarted,
        terminalRecordObserved: true,
        terminalState: "error",
        stopReason: normalizeClaudeStopReason(rawStopReason),
        parserComplete: true,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage: "provider result subtype is not success",
      }),
    };
  }

  if (terminalReason !== "completed") {
    return {
      structuredOutput: null,
      terminal: failureTerminal(observation, {
        modelTurnStarted,
        terminalRecordObserved: true,
        terminalState: terminalReason === "cancelled" ? "cancelled" : "error",
        stopReason: normalizeClaudeStopReason(rawStopReason),
        parserComplete: true,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage: "provider terminal reason is not completed",
      }),
    };
  }

  if (!hasDesignatedOutput) {
    return {
      structuredOutput: null,
      terminal: failureTerminal(observation, {
        modelTurnStarted,
        terminalRecordObserved: true,
        terminalState: "completed",
        stopReason: normalizeClaudeStopReason(rawStopReason),
        parserComplete: true,
        structuredOutputPresent: false,
        structuredOutputError: "designated structured output is missing",
        errorMessage: "designated structured output is missing or errored",
      }),
    };
  }

  // Successful schema-output path: tool_use maps to provider-neutral stop.
  // Pending and failed tool counts are zero only for this completed record.
  const stopReason = normalizeClaudeStopReason(rawStopReason);
  if (rawStopReason !== "tool_use" || numTurns < 1 || stopReason !== "stop") {
    return {
      structuredOutput: null,
      terminal: failureTerminal(observation, {
        modelTurnStarted,
        terminalRecordObserved: true,
        terminalState: "error",
        stopReason,
        parserComplete: true,
        structuredOutputPresent: false,
        structuredOutputError: null,
        errorMessage: "provider success record does not match pinned contract",
      }),
    };
  }

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
 * Claude implementation of ProviderCanaryAdapter.
 *
 * - Accepts only provider family `anthropic`.
 * - Requires stdin prompt bytes; rejects the file prompt variant.
 * - Keeps the exact Claude Code 2.1.220 argument contract.
 * - Never promotes the outer `result` text field.
 * - Normalizes successful schema-output tool_use to provider-neutral stop.
 */
export const ClaudeProviderCanaryAdapterLive = Layer.succeed(
  ProviderCanaryAdapter,
  {
    buildRequest: (input: ProviderCanaryBuildInput) =>
      Effect.gen(function* () {
        if (input.providerFamily !== "anthropic") {
          return yield* Effect.fail(
            new ProviderCanaryAdapterError({
              category: "unsupported_family",
              reason:
                "Claude provider canary adapter accepts only provider family anthropic",
            }),
          );
        }
        if (input.prompt.kind !== "stdin") {
          return yield* Effect.fail(
            new ProviderCanaryAdapterError({
              category: "invalid_invocation",
              reason:
                "Claude provider canary adapter requires stdin prompt bytes",
            }),
          );
        }
        if (input.schema.kind !== "inline") {
          return yield* Effect.fail(
            new ProviderCanaryAdapterError({
              category: "invalid_invocation",
              reason:
                "Claude provider canary adapter requires inline schema JSON",
            }),
          );
        }
        return buildClaudeCanaryInvocation({
          executable: input.executable,
          promptBytes: input.prompt.bytes,
          schemaJson: input.schema.json,
          model: input.model,
          cwd: input.cwd,
          environment: input.environment,
          timeoutMs: input.timeoutMs,
          stdoutMaxBytes: input.stdoutMaxBytes,
          stderrMaxBytes: input.stderrMaxBytes,
        });
      }),
    decodeObservation: (
      observation: ProviderProcessObservation,
    ): Effect.Effect<ProviderCanaryDecoded> => {
      const decoded = decodeClaudeCanaryTerminal(observation);
      return Effect.succeed({
        terminal: decoded.terminal,
        structuredOutput: decoded.structuredOutput,
      });
    },
  },
);
