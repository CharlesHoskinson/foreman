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
 * Codex CLI (0.146.0) canary invocation input. Provider-neutral fields only;
 * wire shapes stay private below.
 */
export type CodexCanaryInvocationInput = {
  readonly executable: string;
  readonly promptBytes: Uint8Array;
  readonly schemaPath: string;
  readonly model: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxBytes: number;
};

export type DecodedCodexCanary = {
  readonly terminal: TerminalObservationV1;
  // Binding contract: designated structured output or null when absent/invalid.
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- interface requires unknown | null
  readonly structuredOutput: unknown | null;
};

/** Private Codex JSONL event wire shapes. Not exported from this package root. */
type CodexThreadStartedWire = {
  readonly type?: unknown;
  readonly thread_id?: unknown;
};

type CodexTurnStartedWire = {
  readonly type?: unknown;
};

type CodexItemCompletedWire = {
  readonly type?: unknown;
  readonly item?: unknown;
};

type CodexTurnCompletedWire = {
  readonly type?: unknown;
  readonly usage?: unknown;
};

/**
 * Build a shell-free Codex canary process request for CLI 0.146.0.
 * Prompt bytes travel only on stdin; argv never contains prompt text or schema JSON.
 */
export const buildCodexCanaryInvocation = (
  input: CodexCanaryInvocationInput,
): ProviderProcessRequest => ({
  executable: input.executable,
  args: [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--cd",
    input.cwd,
    "--output-schema",
    input.schemaPath,
    "--json",
    "--color",
    "never",
    "--model",
    input.model,
    "-",
  ],
  cwd: input.cwd,
  environment: input.environment,
  timeoutMs: input.timeoutMs,
  stdoutMaxBytes: input.stdoutMaxBytes,
  stderrMaxBytes: input.stderrMaxBytes,
  stdin: input.promptBytes,
});

const asStrictNonEmptyString = (
  value: unknown,
): { readonly ok: true; readonly value: string } | { readonly ok: false } => {
  if (typeof value === "string" && value.length > 0) {
    return { ok: true, value };
  }
  return { ok: false };
};

const asStrictString = (
  value: unknown,
): { readonly ok: true; readonly value: string } | { readonly ok: false } => {
  if (typeof value === "string") {
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

/**
 * Parse exactly one JSON value from a line. Reject trailing non-whitespace
 * after the first complete value so multiple JSON values on one line fail.
 */
const parseExactlyOneJsonValue = (
  line: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } => {
  try {
    const parsed: unknown = JSON.parse(line);
    // JSON.parse accepts only one top-level value; re-encode and re-parse is
    // not required. Reject empty object array edge is handled by field checks.
    // Multiple concatenated values (`{}{}`) throw in JSON.parse.
    return { ok: true, value: parsed };
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

const streamFailure = (
  observation: ProviderProcessObservation,
  errorMessage: string,
  terminalState: TerminalObservationV1["terminalState"] = "error",
): DecodedCodexCanary => ({
  structuredOutput: null,
  terminal: failureTerminal(observation, {
    modelTurnStarted: false,
    terminalRecordObserved: false,
    terminalState,
    stopReason: null,
    parserComplete: false,
    structuredOutputPresent: false,
    structuredOutputError: null,
    errorMessage,
  }),
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Decode the private Codex four-event JSONL stream into provider-neutral
 * terminal evidence. Parse `item.text` exactly once as designated structured
 * output. Never scan ordinary text or another field for JSON.
 */
export const decodeCodexCanaryTerminal = (
  observation: ProviderProcessObservation,
): DecodedCodexCanary => {
  if (!observation.started) {
    return streamFailure(
      observation,
      "provider process did not start",
      "error",
    );
  }

  if (observation.timedOut) {
    return streamFailure(
      observation,
      "provider process exceeded deadline",
      "timeout",
    );
  }

  if (observation.signal !== null) {
    return streamFailure(
      observation,
      "provider process terminated by signal",
      "signal",
    );
  }

  if (observation.exitCode === null) {
    return streamFailure(observation, "provider process exit code is null");
  }

  if (observation.exitCode !== 0) {
    return streamFailure(observation, "provider process exited nonzero");
  }

  if (observation.stdout.truncated || observation.stderr.truncated) {
    return streamFailure(observation, "provider process output was truncated");
  }

  const decoded = decodeUtf8(observation.stdout.bytes);
  if (!decoded.ok) {
    return streamFailure(observation, "provider stdout is not valid UTF-8");
  }

  // U+FFFD replacement evidence is never accepted, even if bytes were valid.
  if (decoded.value.includes("\uFFFD")) {
    return streamFailure(
      observation,
      "provider stdout contains Unicode replacement evidence",
    );
  }

  const raw = decoded.value;
  // One final newline is allowed; blank lines elsewhere fail closed.
  const lines =
    raw.endsWith("\n") && raw.length > 0
      ? raw.slice(0, -1).split("\n")
      : raw.split("\n");

  if (lines.length !== 4 || lines.some((line) => line.length === 0)) {
    return streamFailure(
      observation,
      "provider stdout is not exactly four Codex JSONL events",
    );
  }

  const parsedLines: unknown[] = [];
  for (const line of lines) {
    const parsed = parseExactlyOneJsonValue(line);
    if (!parsed.ok || !isPlainObject(parsed.value)) {
      return streamFailure(
        observation,
        "provider stdout is not exactly four Codex JSONL events",
      );
    }
    parsedLines.push(parsed.value);
  }

  const threadStarted = parsedLines[0] as CodexThreadStartedWire;
  const turnStarted = parsedLines[1] as CodexTurnStartedWire;
  const itemCompleted = parsedLines[2] as CodexItemCompletedWire;
  const turnCompleted = parsedLines[3] as CodexTurnCompletedWire;

  if (threadStarted.type !== "thread.started") {
    return streamFailure(
      observation,
      "provider JSONL event sequence is invalid",
    );
  }
  const threadId = asStrictNonEmptyString(threadStarted.thread_id);
  if (!threadId.ok) {
    return streamFailure(
      observation,
      "provider JSONL event sequence is invalid",
    );
  }

  if (turnStarted.type !== "turn.started") {
    return streamFailure(
      observation,
      "provider JSONL event sequence is invalid",
    );
  }

  if (
    itemCompleted.type !== "item.completed" ||
    !isPlainObject(itemCompleted.item)
  ) {
    return streamFailure(
      observation,
      "provider JSONL event sequence is invalid",
    );
  }
  const item = itemCompleted.item;
  const itemId = asStrictNonEmptyString(item.id);
  const itemType = asStrictString(item.type);
  const itemText = asStrictString(item.text);
  if (
    !itemId.ok ||
    !itemType.ok ||
    itemType.value !== "agent_message" ||
    !itemText.ok
  ) {
    return streamFailure(
      observation,
      "provider JSONL event sequence is invalid",
    );
  }

  if (
    turnCompleted.type !== "turn.completed" ||
    !isPlainObject(turnCompleted.usage)
  ) {
    return streamFailure(
      observation,
      "provider JSONL event sequence is invalid",
    );
  }
  const usage = turnCompleted.usage;
  const inputTokens = asStrictNonNegativeInteger(usage.input_tokens);
  const cachedInputTokens = asStrictNonNegativeInteger(
    usage.cached_input_tokens,
  );
  const outputTokens = asStrictNonNegativeInteger(usage.output_tokens);
  if (!inputTokens.ok || !cachedInputTokens.ok || !outputTokens.ok) {
    return streamFailure(
      observation,
      "provider JSONL event sequence is invalid",
    );
  }

  // Designated structured output: parse item.text exactly once.
  let structuredOutput: unknown;
  try {
    structuredOutput = JSON.parse(itemText.value);
  } catch {
    return {
      structuredOutput: null,
      terminal: failureTerminal(observation, {
        modelTurnStarted: true,
        terminalRecordObserved: true,
        terminalState: "completed",
        stopReason: null,
        parserComplete: true,
        structuredOutputPresent: false,
        structuredOutputError: "designated structured output is invalid",
        errorMessage: "designated structured output is missing or errored",
      }),
    };
  }

  return {
    structuredOutput,
    terminal: baseTerminal(observation, {
      modelTurnStarted: true,
      terminalRecordObserved: true,
      terminalState: "completed",
      stopReason: "stop",
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
 * Codex implementation of ProviderCanaryAdapter.
 *
 * - Accepts only provider family `openai`.
 * - Requires stdin prompt bytes; rejects the file prompt variant.
 * - Requires file schema path; rejects the inline schema variant.
 * - Keeps the exact Codex CLI 0.146.0 argument contract.
 * - Decodes exactly four private JSONL events; parses item.text once.
 */
export const CodexProviderCanaryAdapterLive = Layer.succeed(
  ProviderCanaryAdapter,
  {
    buildRequest: (input: ProviderCanaryBuildInput) =>
      Effect.gen(function* () {
        if (input.providerFamily !== "openai") {
          return yield* Effect.fail(
            new ProviderCanaryAdapterError({
              category: "unsupported_family",
              reason:
                "Codex provider canary adapter accepts only provider family openai",
            }),
          );
        }
        if (input.prompt.kind !== "stdin") {
          return yield* Effect.fail(
            new ProviderCanaryAdapterError({
              category: "invalid_invocation",
              reason:
                "Codex provider canary adapter requires stdin prompt bytes",
            }),
          );
        }
        if (input.schema.kind !== "file") {
          return yield* Effect.fail(
            new ProviderCanaryAdapterError({
              category: "invalid_invocation",
              reason:
                "Codex provider canary adapter requires a file schema path",
            }),
          );
        }
        return buildCodexCanaryInvocation({
          executable: input.executable,
          promptBytes: input.prompt.bytes,
          schemaPath: input.schema.path,
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
      const decoded = decodeCodexCanaryTerminal(observation);
      return Effect.succeed({
        terminal: decoded.terminal,
        structuredOutput: decoded.structuredOutput,
      });
    },
  },
);
