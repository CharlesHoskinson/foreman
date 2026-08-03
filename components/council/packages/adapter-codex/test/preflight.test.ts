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
  buildCodexCanaryInvocation,
  CodexProviderCanaryAdapterLive,
  decodeCodexCanaryTerminal,
} from "../src/index.js";

const digestOf = (text: string): Sha256Digest =>
  createHash("sha256").update(text).digest("hex") as Sha256Digest;

const byteSpool = (
  bytes: Uint8Array,
  truncated = false,
  sourceUtf8Valid = true,
) => ({
  bytes,
  digest: createHash("sha256").update(bytes).digest("hex") as Sha256Digest,
  truncated,
  sourceUtf8Valid,
});

const emptySpool = (text = "", truncated = false) =>
  byteSpool(new TextEncoder().encode(text), truncated);

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
  "council canary prompt body for codex stdin",
);

const schemaPath = "/tmp/council-schema-fixture/schema.json";

const canaryInput = {
  executable: "/usr/bin/codex",
  promptBytes,
  schemaPath,
  model: "gpt-5.4",
  cwd: "/work",
  environment: { PATH: "/usr/bin" },
  timeoutMs: 30_000,
  stdoutMaxBytes: 65_536,
  stderrMaxBytes: 65_536,
};

const structured = {
  schemaVersion: 1,
  nonce: "n1",
  checkResult: "2",
  status: "ready",
};

const structuredText = JSON.stringify(structured);

const successEvents = [
  JSON.stringify({ type: "thread.started", thread_id: "thread-abc" }),
  JSON.stringify({ type: "turn.started" }),
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item-1",
      type: "agent_message",
      text: structuredText,
    },
  }),
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: 12,
      cached_input_tokens: 0,
      output_tokens: 7,
    },
  }),
] as const;

const successStdout = `${successEvents.join("\n")}\n`;

describe("buildCodexCanaryInvocation", () => {
  it("emits the exact shell-free Codex 0.146.0 argument array", () => {
    const request: ProviderProcessRequest =
      buildCodexCanaryInvocation(canaryInput);
    expect(request.executable).toBe(canaryInput.executable);
    expect(request.cwd).toBe(canaryInput.cwd);
    expect(request.environment).toEqual(canaryInput.environment);
    expect(request.timeoutMs).toBe(canaryInput.timeoutMs);
    expect(request.stdoutMaxBytes).toBe(canaryInput.stdoutMaxBytes);
    expect(request.stderrMaxBytes).toBe(canaryInput.stderrMaxBytes);
    expect(Array.isArray(request.args)).toBe(true);
    expect(request.args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--cd",
      canaryInput.cwd,
      "--output-schema",
      canaryInput.schemaPath,
      "--json",
      "--color",
      "never",
      "--model",
      canaryInput.model,
      "-",
    ]);
    expect(request.args.join(" ")).not.toMatch(/\b(bash|sh|cmd|powershell)\b/i);
  });

  it("transports prompt only via stdin bytes and never puts prompt or schema JSON in argv", () => {
    const request = buildCodexCanaryInvocation(canaryInput);
    expect(request.stdin).not.toBeNull();
    expect(request.stdin).toEqual(canaryInput.promptBytes);
    const promptText = new TextDecoder().decode(canaryInput.promptBytes);
    for (const arg of request.args) {
      expect(arg).not.toBe(promptText);
      expect(arg).not.toContain(promptText);
      expect(arg).not.toContain('"type":"object"');
      expect(arg).not.toBe("{");
    }
    expect(request.args).not.toContain("--prompt-file");
    expect(request.args).not.toContain("--json-schema");
  });
});

describe("decodeCodexCanaryTerminal", () => {
  it("decodes the exact four-event success stream and parses item.text once", () => {
    const decoded = decodeCodexCanaryTerminal(observation(successStdout));
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
    expect(decoded.terminal.stdoutDigest).toBe(digestOf(successStdout));
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(true);
  });

  it("accepts exactly four events without a trailing newline", () => {
    const decoded = decodeCodexCanaryTerminal(
      observation(successEvents.join("\n")),
    );
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(true);
    expect(decoded.structuredOutput).toEqual(structured);
  });

  it("never promotes ordinary text or non-item fields to structured output", () => {
    const events = [
      successEvents[0],
      successEvents[1],
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item-1",
          type: "agent_message",
          text: "not-json-structured",
        },
        text: structuredText,
      }),
      successEvents[3],
    ];
    const decoded = decodeCodexCanaryTerminal(
      observation(`${events.join("\n")}\n`),
    );
    expect(decoded.structuredOutput).toBeNull();
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("fails closed on extra, duplicate, reordered, missing, and blank-line streams", () => {
    const cases: readonly string[] = [
      `${successEvents.join("\n")}\n${successEvents[3]}\n`,
      [
        successEvents[0],
        successEvents[0],
        successEvents[2],
        successEvents[3],
      ].join("\n"),
      [
        successEvents[1],
        successEvents[0],
        successEvents[2],
        successEvents[3],
      ].join("\n"),
      [successEvents[0], successEvents[1], successEvents[3]].join("\n"),
      [
        successEvents[0],
        "",
        successEvents[1],
        successEvents[2],
        successEvents[3],
      ].join("\n"),
      "",
    ];
    for (const stdout of cases) {
      const decoded = decodeCodexCanaryTerminal(observation(stdout));
      expect(decoded.structuredOutput).toBeNull();
      expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
      expect(decoded.terminal.pendingToolCalls).toBeNull();
      expect(decoded.terminal.failedToolCalls).toBeNull();
    }
  });

  it("fails closed on wrong event type, wrong item type, and malformed fields", () => {
    const cases: readonly string[] = [
      [
        JSON.stringify({ type: "thread.started", thread_id: "" }),
        successEvents[1],
        successEvents[2],
        successEvents[3],
      ].join("\n"),
      [
        successEvents[0],
        JSON.stringify({ type: "turn.failed" }),
        successEvents[2],
        successEvents[3],
      ].join("\n"),
      [
        successEvents[0],
        successEvents[1],
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item-1",
            type: "reasoning",
            text: structuredText,
          },
        }),
        successEvents[3],
      ].join("\n"),
      [
        successEvents[0],
        successEvents[1],
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "",
            type: "agent_message",
            text: structuredText,
          },
        }),
        successEvents[3],
      ].join("\n"),
      [
        successEvents[0],
        successEvents[1],
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item-1",
            type: "agent_message",
            text: 42,
          },
        }),
        successEvents[3],
      ].join("\n"),
      [
        successEvents[0],
        successEvents[1],
        successEvents[2],
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
          },
        }),
      ].join("\n"),
      [
        successEvents[0],
        successEvents[1],
        successEvents[2],
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 1.5,
            cached_input_tokens: 0,
            output_tokens: 1,
          },
        }),
      ].join("\n"),
      [
        successEvents[0],
        successEvents[1],
        successEvents[2],
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: -1,
            cached_input_tokens: 0,
            output_tokens: 1,
          },
        }),
      ].join("\n"),
      [
        successEvents[0],
        successEvents[1],
        successEvents[2],
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: "1",
            cached_input_tokens: 0,
            output_tokens: 1,
          },
        }),
      ].join("\n"),
    ];
    for (const stdout of cases) {
      const decoded = decodeCodexCanaryTerminal(observation(stdout));
      expect(decoded.structuredOutput).toBeNull();
      expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
      expect(decoded.terminal.pendingToolCalls).toBeNull();
      expect(decoded.terminal.failedToolCalls).toBeNull();
    }
  });

  it("fails closed on invalid JSON events and multiple JSON values on one line", () => {
    const cases: readonly string[] = [
      [successEvents[0], "{not-json", successEvents[2], successEvents[3]].join(
        "\n",
      ),
      [
        successEvents[0],
        successEvents[1],
        `${successEvents[2]}${successEvents[2]}`,
        successEvents[3],
      ].join("\n"),
    ];
    for (const stdout of cases) {
      const decoded = decodeCodexCanaryTerminal(observation(stdout));
      expect(decoded.structuredOutput).toBeNull();
      expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
    }
  });

  it("fails closed on invalid item.text JSON", () => {
    const events = [
      successEvents[0],
      successEvents[1],
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item-1",
          type: "agent_message",
          text: "{not-json",
        },
      }),
      successEvents[3],
    ];
    const decoded = decodeCodexCanaryTerminal(
      observation(`${events.join("\n")}\n`),
    );
    expect(decoded.structuredOutput).toBeNull();
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
  });

  it("rejects malformed UTF-8 and U+FFFD replacement evidence before JSON parsing", () => {
    const prefix = new TextEncoder().encode(successEvents[0] + "\n");
    const suffix = new TextEncoder().encode(
      [successEvents[1], successEvents[2], successEvents[3]].join("\n") + "\n",
    );
    const bytes = new Uint8Array(prefix.byteLength + 1 + suffix.byteLength);
    bytes.set(prefix);
    bytes[prefix.byteLength] = 0x80;
    bytes.set(suffix, prefix.byteLength + 1);

    const decodedInvalid = decodeCodexCanaryTerminal(
      observation("", { stdout: byteSpool(bytes, false, false) }),
    );
    expect(decodedInvalid.structuredOutput).toBeNull();
    expect(isSuccessfulTerminalObservation(decodedInvalid.terminal)).toBe(
      false,
    );

    const withReplacement = `${successEvents[0]}\n\uFFFD\n${successEvents[2]}\n${successEvents[3]}\n`;
    const decodedReplacement = decodeCodexCanaryTerminal(
      observation(withReplacement),
    );
    expect(decodedReplacement.structuredOutput).toBeNull();
    expect(isSuccessfulTerminalObservation(decodedReplacement.terminal)).toBe(
      false,
    );
  });

  it("fails closed on timeout, signal, null exit, nonzero exit, and truncation", () => {
    const cases: readonly ProviderProcessObservation[] = [
      observation(successStdout, { timedOut: true, exitCode: null }),
      observation(successStdout, { signal: "SIGTERM", exitCode: null }),
      observation(successStdout, { exitCode: null }),
      observation(successStdout, { exitCode: 1 }),
      observation(successStdout, {
        stdout: emptySpool(successStdout, true),
      }),
      observation(successStdout, {
        stderr: emptySpool("warn", true),
      }),
      observation(successStdout, { started: false }),
    ];
    for (const failed of cases) {
      const decoded = decodeCodexCanaryTerminal(failed);
      expect(decoded.structuredOutput).toBeNull();
      expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
      expect(decoded.terminal.pendingToolCalls).toBeNull();
      expect(decoded.terminal.failedToolCalls).toBeNull();
      expect(decoded.terminal.errorMessage).toBeTypeOf("string");
      if (typeof decoded.terminal.errorMessage === "string") {
        expect(decoded.terminal.errorMessage.length).toBeGreaterThan(0);
        expect(decoded.terminal.errorMessage).not.toMatch(
          /\/tmp|\/home|thread-/,
        );
      }
    }
  });

  it("uses static secret-safe failure messages without path or schema body", () => {
    const decoded = decodeCodexCanaryTerminal(observation("{not-json"));
    expect(decoded.structuredOutput).toBeNull();
    expect(decoded.terminal.errorMessage).toBeTypeOf("string");
    expect(decoded.terminal.errorMessage).not.toContain(schemaPath);
    expect(decoded.terminal.errorMessage).not.toContain(structuredText);
    expect(decoded.terminal.errorMessage).not.toMatch(/\/home\/|\/tmp\//);
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
  providerFamily: "openai",
  executable: canaryInput.executable,
  model: canaryInput.model,
  prompt: { kind: "stdin", bytes: canaryInput.promptBytes },
  schema: { kind: "file", path: canaryInput.schemaPath },
  cwd: canaryInput.cwd,
  environment: canaryInput.environment,
  timeoutMs: canaryInput.timeoutMs,
  stdoutMaxBytes: canaryInput.stdoutMaxBytes,
  stderrMaxBytes: canaryInput.stderrMaxBytes,
  ...overrides,
});

describe("CodexProviderCanaryAdapterLive", () => {
  it("rejects a non-openai family as a typed adapter error, not a defect", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(
        layerBuildInput({ providerFamily: "xai" }),
      );
    }).pipe(Effect.provide(CodexProviderCanaryAdapterLive));

    const exit = await Effect.runPromiseExit(program);
    const error = expectAdapterError(exit);
    expect(error.category).toBe("unsupported_family");
    expect(error.reason.length).toBeGreaterThan(0);
    expect(error.reason).not.toContain(schemaPath);
  });

  it("rejects a file prompt variant as a typed adapter error", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(
        layerBuildInput({
          prompt: { kind: "file", path: "/tmp/prompt.txt" },
        }),
      );
    }).pipe(Effect.provide(CodexProviderCanaryAdapterLive));

    const exit = await Effect.runPromiseExit(program);
    const error = expectAdapterError(exit);
    expect(error.category).toBe("invalid_invocation");
    expect(error.reason).not.toContain("/tmp/prompt.txt");
  });

  it("rejects an inline schema variant as a typed adapter error", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(
        layerBuildInput({
          schema: { kind: "inline", json: '{"type":"object"}' },
        }),
      );
    }).pipe(Effect.provide(CodexProviderCanaryAdapterLive));

    const exit = await Effect.runPromiseExit(program);
    const error = expectAdapterError(exit);
    expect(error.category).toBe("invalid_invocation");
    expect(error.reason).not.toContain('"type":"object"');
    expect(error.reason).not.toContain(schemaPath);
  });

  it("builds the exact Codex argv and stdin contract for a valid openai file-schema input", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.buildRequest(layerBuildInput());
    }).pipe(Effect.provide(CodexProviderCanaryAdapterLive));

    const request = await Effect.runPromise(program);
    const expected = buildCodexCanaryInvocation(canaryInput);
    expect(request.args).toEqual(expected.args);
    expect(request.stdin).toEqual(expected.stdin);
  });

  it("returns non-success terminals with null tool counts for application classification", async () => {
    const program = Effect.gen(function* () {
      const adapter = yield* ProviderCanaryAdapter;
      return yield* adapter.decodeObservation(
        observation(successStdout, { exitCode: 1 }),
      );
    }).pipe(Effect.provide(CodexProviderCanaryAdapterLive));

    const decoded = await Effect.runPromise(program);
    expect(isSuccessfulTerminalObservation(decoded.terminal)).toBe(false);
    expect(decoded.structuredOutput).toBeNull();
    expect(decoded.terminal.pendingToolCalls).toBeNull();
    expect(decoded.terminal.failedToolCalls).toBeNull();
  });
});
