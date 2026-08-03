import { createHash } from "node:crypto";
import { Cause, Effect } from "effect";
import type { Exit } from "effect";
import { describe, expect, it } from "vitest";
import type {
  ProviderCanaryAdapterError,
  ProviderCanaryBuildInput,
  ProviderProcessObservation,
  ProviderProcessRequest,
} from "@council/application";
import { ProviderCanaryAdapter } from "@council/application";
import type { Sha256Digest } from "@council/schema";
import { isSuccessfulTerminalObservation } from "@council/schema";
import {
  buildClaudeCanaryInvocation,
  ClaudeProviderCanaryAdapterLive,
  decodeClaudeCanaryTerminal,
} from "../src/index.js";

const digestOf = (text: string): Sha256Digest =>
  createHash("sha256").update(text).digest("hex") as Sha256Digest;

const emptySpool = (text = "") => {
  const bytes = new TextEncoder().encode(text);
  return byteSpool(bytes);
};

const byteSpool = (bytes: Uint8Array) => {
  return {
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex") as Sha256Digest,
    truncated: false,
  };
};

const observation = (
  stdoutText: string,
  overrides: Partial<ProviderProcessObservation> = {},
): ProviderProcessObservation => ({
  started: true,
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: emptySpool(stdoutText),
  stderr: emptySpool(""),
  ...overrides,
});

const promptBytes = new TextEncoder().encode(
  "council canary prompt body for stdin transport",
);

const canaryInput = {
  executable: "/usr/bin/claude",
  promptBytes,
  schemaJson: '{"type":"object","required":["nonce"]}',
  model: "claude-sonnet-5",
  cwd: "/work",
  environment: { PATH: "/usr/bin" },
  timeoutMs: 30_000,
  stdoutMaxBytes: 65_536,
  stderrMaxBytes: 65_536,
};

describe("buildClaudeCanaryInvocation", () => {
  it("emits the exact shell-free Claude Code 2.1.220 argument array with empty --tools", () => {
    const request: ProviderProcessRequest =
      buildClaudeCanaryInvocation(canaryInput);
    expect(request.executable).toBe(canaryInput.executable);
    expect(request.cwd).toBe(canaryInput.cwd);
    expect(request.environment).toEqual(canaryInput.environment);
    expect(request.timeoutMs).toBe(canaryInput.timeoutMs);
    expect(request.stdoutMaxBytes).toBe(canaryInput.stdoutMaxBytes);
    expect(request.stderrMaxBytes).toBe(canaryInput.stderrMaxBytes);

    // Indexed argv only — never a shell command string.
    expect(Array.isArray(request.args)).toBe(true);
    expect(request.args).toEqual([
      "-p",
      "--model",
      canaryInput.model,
      "--effort",
      "low",
      "--output-format",
      "json",
      "--json-schema",
      canaryInput.schemaJson,
      "--tools",
      "",
      "--permission-mode",
      "plan",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--safe-mode",
      "--no-chrome",
    ]);
    // Empty tools value is retained as a distinct argv entry after --tools.
    const toolsIndex = request.args.indexOf("--tools");
    expect(toolsIndex).toBeGreaterThanOrEqual(0);
    expect(request.args[toolsIndex + 1]).toBe("");
    expect(request.args.join(" ")).not.toMatch(/\b(bash|sh|cmd|powershell)\b/i);
  });

  it("transports prompt only via stdin bytes and never puts prompt text in argv", () => {
    const request = buildClaudeCanaryInvocation(canaryInput);
    expect(request.stdin).not.toBeNull();
    expect(request.stdin).toEqual(canaryInput.promptBytes);
    const promptText = new TextDecoder().decode(canaryInput.promptBytes);
    for (const arg of request.args) {
      expect(arg).not.toBe(promptText);
      expect(arg).not.toContain(promptText);
    }
    // No prompt-file style arguments either.
    expect(request.args).not.toContain("--prompt-file");
    expect(request.args.some((arg) => arg.endsWith(".txt"))).toBe(false);
  });
});

describe("decodeClaudeCanaryTerminal", () => {
  const structured = {
    schemaVersion: 1,
    nonce: "n1",
    checkResult: "2",
    status: "ready",
  };

  const successfulWire = {
    type: "result",
    subtype: "success",
    is_error: false,
    stop_reason: "tool_use",
    terminal_reason: "completed",
    api_error_status: null,
    num_turns: 1,
    structured_output: structured,
    result: "ignore this text body; never promote",
  };

  it("decodes a successful schema-output wire and normalizes tool_use to stop", () => {
    const decoded = decodeClaudeCanaryTerminal(
      observation(JSON.stringify(successfulWire)),
    );
    expect(decoded.structuredOutput).toEqual(structured);
    expect(decoded.terminal.terminalState).toBe("completed");
    expect(decoded.terminal.stopReason).toBe("stop");
    expect(decoded.terminal.structuredOutputPresent).toBe(true);
    expect(decoded.terminal.structuredOutputError).toBeNull();
    expect(decoded.terminal.parserComplete).toBe(true);
    expect(decoded.terminal.modelTurnStarted).toBe(true);
    expect(decoded.terminal.terminalRecordObserved).toBe(true);
    expect(decoded.terminal.exitCode).toBe(0);
    expect(decoded.terminal.pendingToolCalls).toBe(0);
    expect(decoded.terminal.failedToolCalls).toBe(0);
    expect(decoded.terminal.errorMessage).toBeNull();
    expect(decoded.terminal.stdoutDigest).toBe(
      digestOf(JSON.stringify(successfulWire)),
    );
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(true);
  });

  it("carries designated structured output that includes the challenge nonce", () => {
    const decoded = decodeClaudeCanaryTerminal(
      observation(JSON.stringify(successfulWire)),
    );
    expect(decoded.structuredOutput).toEqual(
      expect.objectContaining({ nonce: "n1" }),
    );
  });

  it("never promotes the result text field to structured output", () => {
    const outer = {
      ...successfulWire,
      structured_output: null,
      result: JSON.stringify(structured),
    };
    const decoded = decodeClaudeCanaryTerminal(
      observation(JSON.stringify(outer)),
    );
    expect(decoded.structuredOutput).toBeNull();
    expect(decoded.terminal.structuredOutputPresent).toBe(false);
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("fails closed when structured_output is missing", () => {
    const outer = {
      type: "result",
      subtype: "success",
      is_error: false,
      stop_reason: "tool_use",
      terminal_reason: "completed",
      api_error_status: null,
      num_turns: 1,
      result: "text only",
    };
    const decoded = decodeClaudeCanaryTerminal(
      observation(JSON.stringify(outer)),
    );
    expect(decoded.structuredOutput).toBeNull();
    expect(decoded.terminal.structuredOutputPresent).toBe(false);
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("fails closed on malformed outer JSON", () => {
    const decoded = decodeClaudeCanaryTerminal(observation("{not-json"));
    expect(decoded.structuredOutput).toBeNull();
    expect(decoded.terminal.parserComplete).toBe(false);
    expect(decoded.terminal.terminalRecordObserved).toBe(false);
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("fails closed on malformed field types without coercion", () => {
    const cases: readonly Record<string, unknown>[] = [
      { ...successfulWire, type: 1 },
      { ...successfulWire, subtype: true },
      { ...successfulWire, is_error: "false" },
      { ...successfulWire, stop_reason: 42 },
      { ...successfulWire, terminal_reason: { done: true } },
      { ...successfulWire, api_error_status: "null" },
      { ...successfulWire, num_turns: "1" },
      { ...successfulWire, result: 42 },
    ];
    for (const outer of cases) {
      const decoded = decodeClaudeCanaryTerminal(
        observation(JSON.stringify(outer)),
      );
      expect(decoded.structuredOutput).toBeNull();
      expect(decoded.terminal.parserComplete).toBe(false);
      expect(decoded.terminal.terminalRecordObserved).toBe(false);
      expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
      expect(decoded.terminal.stopReason).toBeNull();
    }
  });

  it("requires every witnessed success field before accepting a terminal", () => {
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

    for (const field of requiredFields) {
      const outer = Object.fromEntries(
        Object.entries(successfulWire).filter(([key]) => key !== field),
      );
      const decoded = decodeClaudeCanaryTerminal(
        observation(JSON.stringify(outer)),
      );
      expect(decoded.structuredOutput, field).toBeNull();
      expect(decoded.terminal.parserComplete, field).toBe(false);
      expect(decoded.terminal.terminalRecordObserved, field).toBe(false);
      expect(isSuccessfulTerminalObservation(decoded.terminal), field).toBe(
        false,
      );
    }
  });

  it("requires the pinned success values before accepting a terminal", () => {
    const cases: readonly Record<string, unknown>[] = [
      { ...successfulWire, stop_reason: "end_turn" },
      { ...successfulWire, num_turns: 0 },
      { ...successfulWire, num_turns: -1 },
      { ...successfulWire, num_turns: 1.5 },
    ];

    for (const outer of cases) {
      const decoded = decodeClaudeCanaryTerminal(
        observation(JSON.stringify(outer)),
      );
      expect(decoded.structuredOutput).toBeNull();
      expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
    }
  });

  it("rejects malformed UTF-8 before JSON parsing", () => {
    const json = JSON.stringify(successfulWire);
    const marker = "ignore this text body; never promote";
    const markerOffset = json.indexOf(marker);
    expect(markerOffset).toBeGreaterThanOrEqual(0);
    const prefix = new TextEncoder().encode(json.slice(0, markerOffset));
    const suffix = new TextEncoder().encode(json.slice(markerOffset));
    const bytes = new Uint8Array(prefix.byteLength + 1 + suffix.byteLength);
    bytes.set(prefix);
    bytes[prefix.byteLength] = 0x80;
    bytes.set(suffix, prefix.byteLength + 1);

    const decoded = decodeClaudeCanaryTerminal(
      observation("", { stdout: byteSpool(bytes) }),
    );
    expect(decoded.structuredOutput).toBeNull();
    expect(decoded.terminal.parserComplete).toBe(false);
    expect(decoded.terminal.terminalRecordObserved).toBe(false);
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("uses unknown tool counts for every failure observation", () => {
    const failureObservations: readonly ProviderProcessObservation[] = [
      observation("", { timedOut: true, exitCode: null }),
      observation("", { signal: "SIGTERM", exitCode: null }),
      observation("{not-json"),
      observation(JSON.stringify({ ...successfulWire, result: 42 })),
      observation(JSON.stringify(successfulWire), { exitCode: 1 }),
      observation(JSON.stringify({ ...successfulWire, is_error: true })),
      observation(JSON.stringify({ ...successfulWire, api_error_status: 429 })),
      observation(JSON.stringify({ ...successfulWire, subtype: "error" })),
      observation(
        JSON.stringify({ ...successfulWire, terminal_reason: "cancelled" }),
      ),
      observation(
        JSON.stringify({ ...successfulWire, structured_output: null }),
      ),
      observation(
        JSON.stringify({ ...successfulWire, stop_reason: "max_tokens" }),
      ),
    ];

    for (const failedObservation of failureObservations) {
      const decoded = decodeClaudeCanaryTerminal(failedObservation);
      expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
      expect(decoded.terminal.pendingToolCalls).toBeNull();
      expect(decoded.terminal.failedToolCalls).toBeNull();
    }
  });

  it("fails closed when is_error is true", () => {
    const outer = {
      ...successfulWire,
      is_error: true,
    };
    const decoded = decodeClaudeCanaryTerminal(
      observation(JSON.stringify(outer)),
    );
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
    expect(decoded.structuredOutput).toBeNull();
  });

  it("fails closed when api_error_status is a provider error status", () => {
    const outer = {
      ...successfulWire,
      api_error_status: 429,
    };
    const decoded = decodeClaudeCanaryTerminal(
      observation(JSON.stringify(outer)),
    );
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
    expect(decoded.structuredOutput).toBeNull();
  });

  it("fails closed on non-success subtype", () => {
    const outer = {
      ...successfulWire,
      subtype: "error",
    };
    const decoded = decodeClaudeCanaryTerminal(
      observation(JSON.stringify(outer)),
    );
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("fails closed on non-completed terminal_reason", () => {
    const outer = {
      ...successfulWire,
      terminal_reason: "cancelled",
    };
    const decoded = decodeClaudeCanaryTerminal(
      observation(JSON.stringify(outer)),
    );
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("fails closed on authentication-style nonzero exit", () => {
    const decoded = decodeClaudeCanaryTerminal(
      observation(JSON.stringify(successfulWire), {
        exitCode: 1,
        stderr: emptySpool("authentication required"),
      }),
    );
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
    expect(decoded.terminal.exitCode).toBe(1);
  });

  it("fails closed on timeout", () => {
    const decoded = decodeClaudeCanaryTerminal(
      observation("", {
        timedOut: true,
        exitCode: null,
        signal: "SIGTERM",
      }),
    );
    expect(decoded.terminal.terminalState).toBe("timeout");
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("fails closed on signal termination", () => {
    const privateSignal = "sensitive-marker";
    const decoded = decodeClaudeCanaryTerminal(
      observation("", {
        signal: privateSignal,
        exitCode: null,
        timedOut: false,
      }),
    );
    expect(decoded.terminal.terminalState).toBe("signal");
    expect(decoded.terminal.errorMessage).toBe(
      "provider process terminated by signal",
    );
    expect(decoded.terminal.errorMessage).not.toContain(privateSignal);
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("fails closed on non-null signal even when exitCode is zero", () => {
    const decoded = decodeClaudeCanaryTerminal(
      observation(JSON.stringify(successfulWire), {
        signal: "SIGTERM",
        exitCode: 0,
        timedOut: false,
      }),
    );
    expect(decoded.terminal.terminalState).toBe("signal");
    expect(decoded.structuredOutput).toBeNull();
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });
});

const firstFail = (cause: Cause.Cause<unknown>): unknown => {
  if (cause._tag === "Fail") return cause.error;
  if (cause._tag === "Parallel" || cause._tag === "Sequential") {
    return firstFail(cause.left) ?? firstFail(cause.right);
  }
  return undefined;
};

const expectAdapterError = (
  exit: Exit.Exit<unknown, ProviderCanaryAdapterError>,
): ProviderCanaryAdapterError => {
  expect(exit._tag).toBe("Failure");
  if (exit._tag !== "Failure") {
    throw new Error("expected failure");
  }
  expect(Cause.isDie(exit.cause)).toBe(false);
  const error = firstFail(exit.cause) as ProviderCanaryAdapterError;
  expect(error).toBeDefined();
  expect(error._tag).toBe("ProviderCanaryAdapterError");
  return error;
};

const layerBuildInput = (
  overrides: Partial<ProviderCanaryBuildInput> = {},
): ProviderCanaryBuildInput => ({
  providerFamily: "anthropic",
  executable: canaryInput.executable,
  model: canaryInput.model,
  prompt: { kind: "stdin", bytes: canaryInput.promptBytes },
  canaryResponseSchemaJson: canaryInput.schemaJson,
  cwd: canaryInput.cwd,
  environment: canaryInput.environment,
  timeoutMs: canaryInput.timeoutMs,
  stdoutMaxBytes: canaryInput.stdoutMaxBytes,
  stderrMaxBytes: canaryInput.stderrMaxBytes,
  ...overrides,
});

describe("ClaudeProviderCanaryAdapterLive", () => {
  it("rejects a non-anthropic family as a typed adapter error, not a defect", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(
        layerBuildInput({ providerFamily: "xai" }),
      );
    }).pipe(Effect.provide(ClaudeProviderCanaryAdapterLive));

    const exit = await Effect.runPromiseExit(program);
    const error = expectAdapterError(exit);
    expect(error.category).toBe("unsupported_family");
    expect(error.reason.length).toBeGreaterThan(0);
  });

  it("rejects the file prompt variant as a typed adapter error, not a defect", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(
        layerBuildInput({
          prompt: { kind: "file", path: "/tmp/prompt.txt" },
        }),
      );
    }).pipe(Effect.provide(ClaudeProviderCanaryAdapterLive));

    const exit = await Effect.runPromiseExit(program);
    const error = expectAdapterError(exit);
    expect(error.category).toBe("invalid_invocation");
    expect(error.reason.length).toBeGreaterThan(0);
  });

  it("builds the exact Claude argv and stdin contract for a valid anthropic input", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(layerBuildInput());
    }).pipe(Effect.provide(ClaudeProviderCanaryAdapterLive));

    const request = await Effect.runPromise(program);
    const expected = buildClaudeCanaryInvocation(canaryInput);
    expect(request.args).toEqual(expected.args);
    expect(request.stdin).toEqual(expected.stdin);
  });

  it("returns non-success terminals for application classification", async () => {
    const outer = {
      type: "result",
      subtype: "success",
      is_error: false,
      stop_reason: "tool_use",
      terminal_reason: "cancelled",
      api_error_status: null,
      num_turns: 1,
      structured_output: {
        schemaVersion: 1,
        nonce: "n1",
        checkResult: "2",
        status: "ready",
      },
      result: "",
    };
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.decodeObservation(
        observation(JSON.stringify(outer)),
      );
    }).pipe(Effect.provide(ClaudeProviderCanaryAdapterLive));

    const decoded = await Effect.runPromise(program);
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });
});
