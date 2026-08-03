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
  buildGrokCanaryInvocation,
  decodeGrokCanaryTerminal,
  GrokProviderCanaryAdapterLive,
} from "../src/index.js";

const digestOf = (text: string): Sha256Digest =>
  createHash("sha256").update(text).digest("hex") as Sha256Digest;

const emptySpool = (text = "") => {
  const bytes = new TextEncoder().encode(text);
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

const canaryInput = {
  executable: "/usr/bin/grok",
  promptFile: "/tmp/prompt.txt",
  schemaJson: '{"type":"object"}',
  model: "grok-4",
  cwd: "/work",
  environment: { PATH: "/usr/bin" },
  timeoutMs: 30_000,
  stdoutMaxBytes: 65_536,
  stderrMaxBytes: 65_536,
};

describe("buildGrokCanaryInvocation", () => {
  it("emits the exact shell-free Grok argument array with empty --tools", () => {
    const request: ProviderProcessRequest =
      buildGrokCanaryInvocation(canaryInput);
    expect(request.executable).toBe(canaryInput.executable);
    expect(request.cwd).toBe(canaryInput.cwd);
    expect(request.environment).toEqual(canaryInput.environment);
    expect(request.timeoutMs).toBe(canaryInput.timeoutMs);
    expect(request.stdoutMaxBytes).toBe(canaryInput.stdoutMaxBytes);
    expect(request.stderrMaxBytes).toBe(canaryInput.stderrMaxBytes);

    // Indexed argv only — never a shell command string.
    expect(Array.isArray(request.args)).toBe(true);
    expect(request.args).toEqual([
      "--prompt-file",
      canaryInput.promptFile,
      "-m",
      canaryInput.model,
      "--permission-mode",
      "plan",
      "--json-schema",
      canaryInput.schemaJson,
      "--no-leader",
      "--output-format",
      "json",
      "--cwd",
      canaryInput.cwd,
      "--max-turns",
      "1",
      "--no-subagents",
      "--disable-web-search",
      "--no-memory",
      "--tools",
      "",
      "--verbatim",
    ]);
    // Empty tools value is retained as a distinct argv entry after --tools.
    const toolsIndex = request.args.indexOf("--tools");
    expect(toolsIndex).toBeGreaterThanOrEqual(0);
    expect(request.args[toolsIndex + 1]).toBe("");
    expect(request.args.join(" ")).not.toMatch(/\b(bash|sh|cmd|powershell)\b/i);
  });

  it("refuses a .json prompt filename", () => {
    expect(() =>
      buildGrokCanaryInvocation({
        ...canaryInput,
        promptFile: "/tmp/prompt.json",
      }),
    ).toThrow(/\.json/i);
    expect(() =>
      buildGrokCanaryInvocation({
        ...canaryInput,
        promptFile: "prompt.JSON",
      }),
    ).toThrow(/\.json/i);
  });
});

describe("decodeGrokCanaryTerminal", () => {
  const structured = {
    schemaVersion: 1,
    nonce: "n1",
    checkResult: "2",
    status: "ready",
  };

  it("decodes a successful completed outer JSON with designated structured output", () => {
    const outer = {
      stopReason: "end_turn",
      structuredOutput: structured,
      structuredOutputError: null,
      num_turns: 1,
      text: "ignore this text body",
    };
    const decoded = decodeGrokCanaryTerminal(
      observation(JSON.stringify(outer)),
    );
    expect(decoded.structuredOutput).toEqual(structured);
    expect(decoded.terminal.terminalState).toBe("completed");
    expect(decoded.terminal.stopReason).toBe("end_turn");
    expect(decoded.terminal.structuredOutputPresent).toBe(true);
    expect(decoded.terminal.structuredOutputError).toBeNull();
    expect(decoded.terminal.parserComplete).toBe(true);
    expect(decoded.terminal.modelTurnStarted).toBe(true);
    expect(decoded.terminal.terminalRecordObserved).toBe(true);
    expect(decoded.terminal.exitCode).toBe(0);
    expect(decoded.terminal.stdoutDigest).toBe(digestOf(JSON.stringify(outer)));
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(true);
  });

  it("does not promote nonce-independent valid-looking text without structured output", () => {
    const outer = {
      stopReason: "end_turn",
      structuredOutput: null,
      structuredOutputError: "model did not produce structured output",
      num_turns: 1,
      text: JSON.stringify(structured),
    };
    const decoded = decodeGrokCanaryTerminal(
      observation(JSON.stringify(outer)),
    );
    expect(decoded.structuredOutput).toBeNull();
    expect(decoded.terminal.structuredOutputPresent).toBe(false);
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("rejects valid-looking structured content followed by stopReason Cancelled", () => {
    const outer = {
      stopReason: "Cancelled",
      structuredOutput: structured,
      structuredOutputError: null,
      num_turns: 1,
      text: "",
    };
    const decoded = decodeGrokCanaryTerminal(
      observation(JSON.stringify(outer)),
    );
    expect(decoded.terminal.stopReason).toBe("Cancelled");
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("fails closed on malformed outer JSON", () => {
    const decoded = decodeGrokCanaryTerminal(observation("{not-json"));
    expect(decoded.structuredOutput).toBeNull();
    expect(decoded.terminal.parserComplete).toBe(false);
    expect(decoded.terminal.terminalRecordObserved).toBe(false);
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("fails closed on authentication-style nonzero exit", () => {
    const outer = {
      stopReason: "end_turn",
      structuredOutput: structured,
      structuredOutputError: null,
      num_turns: 1,
      text: "",
    };
    const decoded = decodeGrokCanaryTerminal(
      observation(JSON.stringify(outer), {
        exitCode: 1,
        stderr: emptySpool("authentication required"),
      }),
    );
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
    expect(decoded.terminal.exitCode).toBe(1);
  });

  it("fails closed on timeout", () => {
    const decoded = decodeGrokCanaryTerminal(
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
    const decoded = decodeGrokCanaryTerminal(
      observation("", {
        signal: "SIGKILL",
        exitCode: null,
        timedOut: false,
      }),
    );
    expect(decoded.terminal.terminalState).toBe("signal");
    expect(decoded.terminal.errorMessage).toMatch(/SIGKILL/);
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("fails closed on non-null signal even when exitCode is zero", () => {
    const outer = {
      stopReason: "end_turn",
      structuredOutput: structured,
      structuredOutputError: null,
      num_turns: 1,
      text: "ignore this text body",
    };
    const decoded = decodeGrokCanaryTerminal(
      observation(JSON.stringify(outer), {
        signal: "SIGTERM",
        exitCode: 0,
        timedOut: false,
      }),
    );
    expect(decoded.terminal.terminalState).toBe("signal");
    expect(decoded.terminal.errorMessage).toMatch(/SIGTERM/);
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
    expect(decoded.structuredOutput).toBeNull();
  });

  it("fails closed when the terminal record is missing from a process that started", () => {
    const decoded = decodeGrokCanaryTerminal(observation(""));
    expect(decoded.terminal.terminalRecordObserved).toBe(false);
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("fails closed when stopReason is present but not a string or null", () => {
    const cases: readonly unknown[] = [42, true, false, { reason: "end_turn" }];
    for (const stopReason of cases) {
      const outer = {
        stopReason,
        structuredOutput: structured,
        structuredOutputError: null,
        num_turns: 1,
        text: "",
      };
      const decoded = decodeGrokCanaryTerminal(
        observation(JSON.stringify(outer)),
      );
      expect(decoded.structuredOutput).toBeNull();
      expect(decoded.terminal.parserComplete).toBe(false);
      expect(decoded.terminal.terminalRecordObserved).toBe(false);
      expect(decoded.terminal.structuredOutputPresent).toBe(false);
      expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
      // Must not coerce numbers/booleans into stopReason strings.
      expect(decoded.terminal.stopReason).toBeNull();
    }
  });

  it("fails closed when structuredOutputError is present but not a string or null", () => {
    const cases: readonly unknown[] = [
      7,
      false,
      { message: "schema mismatch" },
    ];
    for (const structuredOutputError of cases) {
      const outer = {
        stopReason: "end_turn",
        structuredOutput: structured,
        structuredOutputError,
        num_turns: 1,
        text: "",
      };
      const decoded = decodeGrokCanaryTerminal(
        observation(JSON.stringify(outer)),
      );
      expect(decoded.structuredOutput).toBeNull();
      expect(decoded.terminal.parserComplete).toBe(false);
      expect(decoded.terminal.terminalRecordObserved).toBe(false);
      expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
      // Must not map objects to null and continue as a successful parse.
      expect(decoded.terminal.structuredOutputError).toBeNull();
    }
  });

  it("still accepts string | null stopReason and structuredOutputError", () => {
    const withNulls = {
      stopReason: null,
      structuredOutput: structured,
      structuredOutputError: null,
      num_turns: 1,
      text: "",
    };
    const decodedNulls = decodeGrokCanaryTerminal(
      observation(JSON.stringify(withNulls)),
    );
    expect(decodedNulls.terminal.stopReason).toBeNull();
    expect(decodedNulls.terminal.structuredOutputError).toBeNull();
    // null stopReason is a successful stop reason when structured output is present.
    expect(isSuccessfulTerminalObservation(decodedNulls.terminal)).toBe(true);

    const withStrings = {
      stopReason: "end_turn",
      structuredOutput: null,
      structuredOutputError: "model did not produce structured output",
      num_turns: 1,
      text: "",
    };
    const decodedStrings = decodeGrokCanaryTerminal(
      observation(JSON.stringify(withStrings)),
    );
    expect(decodedStrings.terminal.stopReason).toBe("end_turn");
    expect(decodedStrings.terminal.structuredOutputError).toBe(
      "model did not produce structured output",
    );
    expect(decodedStrings.terminal.parserComplete).toBe(true);
    expect(decodedStrings.terminal.terminalRecordObserved).toBe(true);
    expect(isSuccessfulTerminalObservation(decodedStrings.terminal)).toBe(
      false,
    );
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
  // Must be a typed Fail, not a Die defect.
  expect(Cause.isDie(exit.cause)).toBe(false);
  const error = firstFail(exit.cause) as ProviderCanaryAdapterError;
  expect(error).toBeDefined();
  expect(error._tag).toBe("ProviderCanaryAdapterError");
  return error;
};

const layerBuildInput = (
  overrides: Partial<ProviderCanaryBuildInput> = {},
): ProviderCanaryBuildInput => ({
  providerFamily: "xai",
  executable: canaryInput.executable,
  model: canaryInput.model,
  prompt: { kind: "file", path: canaryInput.promptFile },
  schema: { kind: "inline", json: canaryInput.schemaJson },
  cwd: canaryInput.cwd,
  environment: canaryInput.environment,
  timeoutMs: canaryInput.timeoutMs,
  stdoutMaxBytes: canaryInput.stdoutMaxBytes,
  stderrMaxBytes: canaryInput.stderrMaxBytes,
  ...overrides,
});

describe("GrokProviderCanaryAdapterLive", () => {
  it("rejects a non-xai family as a typed adapter error, not a defect", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(
        layerBuildInput({ providerFamily: "anthropic" }),
      );
    }).pipe(Effect.provide(GrokProviderCanaryAdapterLive));

    const exit = await Effect.runPromiseExit(program);
    const error = expectAdapterError(exit);
    expect(error.category).toBe("unsupported_family");
    expect(error.reason.length).toBeGreaterThan(0);
  });

  it("rejects a .json prompt file as a typed adapter error, not a defect", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(
        layerBuildInput({
          prompt: { kind: "file", path: "/tmp/prompt.json" },
        }),
      );
    }).pipe(Effect.provide(GrokProviderCanaryAdapterLive));

    const exit = await Effect.runPromiseExit(program);
    const error = expectAdapterError(exit);
    expect(error.category).toBe("invalid_invocation");
    expect(error.reason).toMatch(/\.json/i);
  });

  it("rejects the stdin prompt variant as a typed adapter error, not a defect", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(
        layerBuildInput({
          prompt: {
            kind: "stdin",
            bytes: new TextEncoder().encode("not for grok"),
          },
        }),
      );
    }).pipe(Effect.provide(GrokProviderCanaryAdapterLive));

    const exit = await Effect.runPromiseExit(program);
    const error = expectAdapterError(exit);
    expect(error.category).toBe("invalid_invocation");
  });

  it("rejects a file schema variant as a typed adapter error without leaking path or schema body", async () => {
    const privatePath = "/tmp/secret-schema-path.json";
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(
        layerBuildInput({
          schema: { kind: "file", path: privatePath },
        }),
      );
    }).pipe(Effect.provide(GrokProviderCanaryAdapterLive));

    const exit = await Effect.runPromiseExit(program);
    const error = expectAdapterError(exit);
    expect(error.category).toBe("invalid_invocation");
    expect(error.reason).not.toContain(privatePath);
    expect(error.reason).not.toContain(canaryInput.schemaJson);
  });

  it("accepts only the inline schema variant and preserves exact Grok argv", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(layerBuildInput());
    }).pipe(Effect.provide(GrokProviderCanaryAdapterLive));

    const request = await Effect.runPromise(program);
    expect(request.args).toEqual(buildGrokCanaryInvocation(canaryInput).args);
    expect(request.args).toContain("--json-schema");
    expect(request.args).toContain(canaryInput.schemaJson);
  });

  it("sets stdin to null for Grok file-prompt requests", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(layerBuildInput());
    }).pipe(Effect.provide(GrokProviderCanaryAdapterLive));

    const request = await Effect.runPromise(program);
    expect(request.stdin).toBeNull();
  });

  it("builds the exact Grok 0.2.118 argument contract for a valid xai input", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(layerBuildInput());
    }).pipe(Effect.provide(GrokProviderCanaryAdapterLive));

    const request = await Effect.runPromise(program);
    expect(request.args).toEqual(buildGrokCanaryInvocation(canaryInput).args);
  });

  it("returns non-success terminals for application classification", async () => {
    const outer = {
      stopReason: "Cancelled",
      structuredOutput: {
        schemaVersion: 1,
        nonce: "n1",
        checkResult: "2",
        status: "ready",
      },
      structuredOutputError: null,
      num_turns: 1,
      text: "",
    };
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.decodeObservation(
        observation(JSON.stringify(outer)),
      );
    }).pipe(Effect.provide(GrokProviderCanaryAdapterLive));

    const decoded = await Effect.runPromise(program);
    expect(decoded.terminal.stopReason).toBe("Cancelled");
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
    expect(decoded.structuredOutput).toEqual(outer.structuredOutput);
  });
});
