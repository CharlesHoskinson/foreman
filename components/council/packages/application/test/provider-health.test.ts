/**
 * Provider-health canary application service — deterministic Effect tests.
 * No live provider, no Node process spawn, no network.
 */
import type {
  CanaryChallengeV1,
  ContentHash,
  Sha256Digest,
  TerminalObservationV1,
  UtcTimestamp,
} from "@council/schema";
import {
  hashCanaryChallenge,
  isSuccessfulTerminalObservation,
} from "@council/schema";
import { Effect, Layer } from "effect";
import type { Cause, Exit } from "effect";
import { describe, expect, it } from "vitest";
import type {
  ProviderCanaryAdapterError,
  ProviderCanaryBuildInput,
  ProviderHealthError,
  ProviderProcessObservation,
  ProviderProcessRequest,
  RunProviderHealthCanaryInput,
} from "../src/index.js";
import {
  ProviderCanaryAdapter,
  ProviderProcessError,
  ProviderProcessRunner,
  runProviderHealthCanary,
} from "../src/index.js";

const digest = (hexPair: string): Sha256Digest =>
  hexPair.repeat(32) as Sha256Digest;

const contentHash = (hexPair: string): ContentHash =>
  `sha256:${hexPair.repeat(32)}` as ContentHash;

const challenge: CanaryChallengeV1 = {
  schemaVersion: 1,
  nonce: "canary-nonce-fixed-001",
  checkExpression: "1+1",
  expectedCheckResult: "2",
};

const observedAt = "2026-08-03T12:00:00.000Z" as UtcTimestamp;
const expiresAt = "2026-08-03T12:10:00.000Z" as UtcTimestamp;

const validResponse = {
  schemaVersion: 1 as const,
  nonce: challenge.nonce,
  checkResult: "2" as const,
  status: "ready" as const,
};

const successfulTerminal = (
  overrides: Partial<TerminalObservationV1> = {},
): TerminalObservationV1 => ({
  schemaVersion: 1,
  modelTurnStarted: true,
  terminalRecordObserved: true,
  terminalState: "completed",
  exitCode: 0,
  stopReason: "end_turn",
  pendingToolCalls: 0,
  failedToolCalls: 0,
  parserComplete: true,
  structuredOutputPresent: true,
  structuredOutputError: null,
  stdoutDigest: digest("aa"),
  stderrDigest: digest("bb"),
  errorMessage: null,
  ...overrides,
});

const baseInput = (): RunProviderHealthCanaryInput => ({
  providerFamily: "xai",
  model: "grok-4",
  cliVersion: "0.2.118",
  contractClass: "council-ace-1",
  promptHash: contentHash("11"),
  schemaVariantHash: contentHash("22"),
  canarySchemaVariantHash: contentHash("33"),
  challenge,
  observedAt,
  expiresAt,
  executable: "/usr/bin/grok",
  prompt: { kind: "file", path: "/tmp/canary-prompt.txt" },
  canaryResponseSchemaJson: '{"type":"object"}',
  cwd: "/work",
  environment: { PATH: "/usr/bin" },
  timeoutMs: 30_000,
  stdoutMaxBytes: 65_536,
  stderrMaxBytes: 65_536,
});

const emptySpool = {
  bytes: new Uint8Array(0),
  digest: digest("00"),
  truncated: false,
};

const defaultObservation = (
  overrides: Partial<ProviderProcessObservation> = {},
): ProviderProcessObservation => ({
  started: true,
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: emptySpool,
  stderr: emptySpool,
  ...overrides,
});

const defaultRequest: ProviderProcessRequest = {
  executable: "/usr/bin/grok",
  args: ["--prompt-file", "/tmp/canary-prompt.txt"],
  cwd: "/work",
  environment: { PATH: "/usr/bin" },
  timeoutMs: 30_000,
  stdoutMaxBytes: 65_536,
  stderrMaxBytes: 65_536,
  stdin: null,
};

type AdapterConfig = {
  readonly build?: (
    input: ProviderCanaryBuildInput,
  ) => Effect.Effect<ProviderProcessRequest, ProviderCanaryAdapterError>;
  readonly decode?: (observation: ProviderProcessObservation) => Effect.Effect<
    {
      readonly terminal: TerminalObservationV1;
      readonly structuredOutput: unknown;
    },
    ProviderCanaryAdapterError
  >;
  readonly terminal?: TerminalObservationV1;
  readonly structuredOutput?: unknown;
};

type RunnerConfig = {
  readonly observation?: ProviderProcessObservation;
  readonly fail?: ProviderProcessError;
  readonly captured?: { request: ProviderProcessRequest | null };
};

const makeAdapterLayer = (config: AdapterConfig = {}) =>
  Layer.succeed(ProviderCanaryAdapter, {
    buildRequest: (input) => {
      if (config.build !== undefined) {
        return config.build(input);
      }
      return Effect.succeed(defaultRequest);
    },
    decodeObservation: (observation) => {
      if (config.decode !== undefined) {
        return config.decode(observation);
      }
      return Effect.succeed({
        terminal: config.terminal ?? successfulTerminal(),
        structuredOutput:
          config.structuredOutput !== undefined
            ? config.structuredOutput
            : validResponse,
      });
    },
  });

const makeRunnerLayer = (config: RunnerConfig = {}) =>
  Layer.succeed(ProviderProcessRunner, {
    run: (request) => {
      if (config.captured !== undefined) {
        config.captured.request = request;
      }
      if (config.fail !== undefined) {
        return Effect.fail(config.fail);
      }
      return Effect.succeed(config.observation ?? defaultObservation());
    },
  });

const runCanary = (
  input: RunProviderHealthCanaryInput,
  adapter: AdapterConfig = {},
  runner: RunnerConfig = {},
) =>
  Effect.runPromiseExit(
    runProviderHealthCanary(input).pipe(
      Effect.provide(
        Layer.mergeAll(makeAdapterLayer(adapter), makeRunnerLayer(runner)),
      ),
    ),
  );

const firstFail = (cause: Cause.Cause<unknown>): unknown => {
  if (cause._tag === "Fail") return cause.error;
  if (cause._tag === "Parallel" || cause._tag === "Sequential") {
    return firstFail(cause.left) ?? firstFail(cause.right);
  }
  return undefined;
};

const expectHealthFailure = (
  exit: Exit.Exit<unknown, ProviderHealthError>,
): ProviderHealthError => {
  expect(exit._tag).toBe("Failure");
  if (exit._tag !== "Failure") {
    throw new Error("expected failure");
  }
  const error = firstFail(exit.cause);
  expect(error).toBeDefined();
  const health = error as ProviderHealthError;
  expect(health._tag).toBe("ProviderHealthError");
  // Secret-safe: no raw path/env/output fields on the error object.
  const json = JSON.stringify(health);
  expect(json).not.toMatch(/HOME=|PATH=|\/home\/|stderr:|stdout:/i);
  expect(health).not.toHaveProperty("stdout");
  expect(health).not.toHaveProperty("stderr");
  expect(health).not.toHaveProperty("environment");
  expect(health).not.toHaveProperty("cwd");
  expect(health).not.toHaveProperty("promptFile");
  expect(health).not.toHaveProperty("home");
  return health;
};

describe("runProviderHealthCanary", () => {
  it("returns a strict receipt on a successful fixed check", async () => {
    const terminal = successfulTerminal({
      stdoutDigest: digest("cd"),
      stderrDigest: digest("ef"),
    });
    const exit = await runCanary(
      baseInput(),
      { terminal, structuredOutput: validResponse },
      {},
    );
    expect(exit._tag).toBe("Success");
    if (exit._tag !== "Success") {
      throw new Error("expected success");
    }
    const receipt = exit.value;
    expect(receipt.schemaVersion).toBe(1);
    expect(receipt.providerFamily).toBe("xai");
    expect(receipt.model).toBe("grok-4");
    expect(receipt.cliVersion).toBe("0.2.118");
    expect(receipt.contractClass).toBe("council-ace-1");
    expect(receipt.promptHash).toBe(contentHash("11"));
    expect(receipt.schemaVariantHash).toBe(contentHash("22"));
    expect(receipt.canarySchemaVariantHash).toBe(contentHash("33"));
    expect(receipt.challengeHash).toBe(hashCanaryChallenge(challenge));
    expect(receipt.challenge).toEqual(challenge);
    expect(receipt.response).toEqual(validResponse);
    expect(receipt.response.nonce).toBe(challenge.nonce);
    expect(receipt.terminal.stdoutDigest).toBe(digest("cd"));
    expect(receipt.terminal.stderrDigest).toBe(digest("ef"));
    expect(receipt.observedAt).toBe(observedAt);
    expect(receipt.expiresAt).toBe(expiresAt);
    expect(isSuccessfulTerminalObservation(receipt.terminal)).toBe(true);
  });

  it("maps missing executable / process start failure to typed health failure with no raw data", async () => {
    const exit = await runCanary(
      baseInput(),
      {},
      {
        fail: new ProviderProcessError({
          category: "start_failed",
          reason: "provider executable is missing or not executable",
        }),
      },
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("process_start");
    expect(error.terminal).toBeNull();
    expect(error.reason.length).toBeGreaterThan(0);
    expect(error.reason).not.toMatch(/\/usr\/bin\/grok/);
  });

  it("preserves an internal process-runner failure as a non-start process failure", async () => {
    const exit = await runCanary(
      baseInput(),
      {},
      {
        fail: new ProviderProcessError({
          category: "internal",
          reason: "provider process runner failed internally",
        }),
      },
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("process");
    expect(error.terminal).toBeNull();
  });

  it("never parses a valid-looking response when the terminal is a nonzero auth/provider failure", async () => {
    let decodedBody = false;
    const terminal = successfulTerminal({
      terminalState: "error",
      exitCode: 1,
      structuredOutputPresent: true,
      errorMessage: "provider process exited nonzero",
    });
    const exit = await runCanary(
      baseInput(),
      {
        decode: () =>
          Effect.succeed({
            terminal,
            get structuredOutput() {
              decodedBody = true;
              return validResponse;
            },
          }),
      },
      {},
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("terminal");
    expect(error.terminal?.exitCode).toBe(1);
    expect(error.terminal).not.toBeNull();
    if (error.terminal !== null) {
      expect(isSuccessfulTerminalObservation(error.terminal)).toBe(false);
    }
    // Application must classify terminal before reading structured output.
    expect(decodedBody).toBe(false);
  });

  it("never treats schema rejection as readiness", async () => {
    const exit = await runCanary(
      baseInput(),
      {
        terminal: successfulTerminal(),
        structuredOutput: {
          schemaVersion: 1,
          nonce: challenge.nonce,
          checkResult: "2",
          status: "ready",
          extraField: "not-allowed",
        },
      },
      {},
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("response");
    expect(error.terminal).not.toBeNull();
    if (error.terminal !== null) {
      expect(isSuccessfulTerminalObservation(error.terminal)).toBe(true);
    }
  });

  it("never treats timeout as readiness", async () => {
    const terminal = successfulTerminal({
      modelTurnStarted: false,
      terminalRecordObserved: false,
      terminalState: "timeout",
      exitCode: null,
      stopReason: null,
      parserComplete: false,
      structuredOutputPresent: false,
      errorMessage: "provider process exceeded deadline",
    });
    const exit = await runCanary(
      baseInput(),
      { terminal, structuredOutput: validResponse },
      {},
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("terminal");
    expect(error.terminal?.terminalState).toBe("timeout");
  });

  it("never treats cancellation with a valid-looking response as readiness", async () => {
    const terminal = successfulTerminal({
      terminalState: "cancelled",
      stopReason: "Cancelled",
      errorMessage: "provider stopReason is Cancelled",
    });
    const exit = await runCanary(
      baseInput(),
      { terminal, structuredOutput: validResponse },
      {},
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("terminal");
    expect(error.terminal?.stopReason).toBe("Cancelled");
    if (error.terminal !== null) {
      expect(isSuccessfulTerminalObservation(error.terminal)).toBe(false);
    }
  });

  it("never treats signal termination as readiness", async () => {
    const terminal = successfulTerminal({
      modelTurnStarted: false,
      terminalRecordObserved: false,
      terminalState: "signal",
      exitCode: null,
      stopReason: null,
      parserComplete: false,
      structuredOutputPresent: false,
      errorMessage: "provider process terminated by signal SIGKILL",
    });
    const exit = await runCanary(
      baseInput(),
      { terminal, structuredOutput: validResponse },
      {},
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("terminal");
    expect(error.terminal?.terminalState).toBe("signal");
  });

  it("never treats malformed outer JSON as readiness", async () => {
    const terminal = successfulTerminal({
      modelTurnStarted: false,
      terminalRecordObserved: false,
      terminalState: "error",
      exitCode: 0,
      stopReason: null,
      parserComplete: false,
      structuredOutputPresent: false,
      errorMessage: "provider stdout is not exactly one Grok outer JSON object",
    });
    const exit = await runCanary(
      baseInput(),
      { terminal, structuredOutput: null },
      {},
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("terminal");
    expect(error.terminal?.parserComplete).toBe(false);
  });

  it("fails closed on response nonce mismatch", async () => {
    const exit = await runCanary(
      baseInput(),
      {
        terminal: successfulTerminal(),
        structuredOutput: {
          ...validResponse,
          nonce: "different-nonce-does-not-match",
        },
      },
      {},
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("response");
    expect(error.reason.toLowerCase()).toMatch(/nonce/);
  });

  it("fails closed when the fixed-check result is wrong", async () => {
    const exit = await runCanary(
      baseInput(),
      {
        terminal: successfulTerminal(),
        structuredOutput: {
          schemaVersion: 1,
          nonce: challenge.nonce,
          checkResult: "3",
          status: "ready",
        },
      },
      {},
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("response");
  });

  it("never treats a missing terminal event as readiness", async () => {
    const terminal = successfulTerminal({
      modelTurnStarted: false,
      terminalRecordObserved: false,
      terminalState: "error",
      stopReason: null,
      parserComplete: false,
      structuredOutputPresent: false,
      errorMessage: "provider stdout is not exactly one Grok outer JSON object",
    });
    const exit = await runCanary(
      baseInput(),
      { terminal, structuredOutput: null },
      {},
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("terminal");
    expect(error.terminal?.terminalRecordObserved).toBe(false);
  });

  it("classifies terminal first when a valid-looking body follows cancellation", async () => {
    let structuredAccessed = false;
    const terminal = successfulTerminal({
      terminalState: "cancelled",
      stopReason: "Cancelled",
      errorMessage: "provider stopReason is Cancelled",
    });
    const exit = await runCanary(
      baseInput(),
      {
        decode: () =>
          Effect.succeed({
            terminal,
            get structuredOutput() {
              // If the application read the body before terminal success,
              // this getter would fire and the body would be "exposed".
              structuredAccessed = true;
              return validResponse;
            },
          }),
      },
      {},
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("terminal");
    expect(error.terminal?.terminalState).toBe("cancelled");
    expect(structuredAccessed).toBe(false);
  });

  it("fails closed on invalid receipt chronology", async () => {
    const exit = await runCanary(
      {
        ...baseInput(),
        observedAt: "2026-08-03T12:10:00.000Z" as UtcTimestamp,
        expiresAt: "2026-08-03T12:00:00.000Z" as UtcTimestamp,
      },
      { terminal: successfulTerminal(), structuredOutput: validResponse },
      {},
    );
    const error = expectHealthFailure(exit);
    expect(error.category).toBe("receipt");
    expect(error.terminal).not.toBeNull();
  });

  it("builds the process request through the adapter before running", async () => {
    const captured: { request: ProviderProcessRequest | null } = {
      request: null,
    };
    const customRequest: ProviderProcessRequest = {
      ...defaultRequest,
      args: ["--custom", "argv"],
    };
    const exit = await runCanary(
      baseInput(),
      {
        build: () => Effect.succeed(customRequest),
        terminal: successfulTerminal(),
        structuredOutput: validResponse,
      },
      { captured },
    );
    expect(exit._tag).toBe("Success");
    expect(captured.request).toEqual(customRequest);
  });
});
