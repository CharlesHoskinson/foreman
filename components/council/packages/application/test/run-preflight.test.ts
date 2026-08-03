/**
 * Preflight coordinator — deterministic Effect tests.
 * No live provider, no Node process spawn, no network.
 */
import type {
  ContentHash,
  PromptPreflightResultV1,
  Sha256Digest,
  TerminalObservationV1,
  UtcTimestamp,
} from "@council/schema";
import {
  decodeStrictSync,
  PromptPreflightResultV1 as PromptPreflightResultV1Schema,
} from "@council/schema";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  ArtifactMissing,
  ArtifactReader,
  BundleVerifier,
  CanaryMaterializer,
  CanaryMaterializerError,
  Digest,
  PreflightIdentitySource,
  PromptMaterializer,
  ProviderCanaryAdapter,
  ProviderProcessError,
  ProviderProcessRunner,
  ProviderSchemaLowerer,
  ProviderVersionProbe,
  ProviderVersionProbeError,
  runPromptPreflight,
  type ProviderProcessObservation,
  type ProviderProcessRequest,
  type PreflightIdentityError,
  type RunPromptPreflightInput,
} from "../src/index.js";
import {
  bytesById,
  emptyLog,
  lowerProviderSchema,
  makeContract,
  materializePromptBytesLocal,
  sha256Hex,
} from "./test-helpers.js";

const digest = (hexPair: string): Sha256Digest =>
  hexPair.repeat(32) as Sha256Digest;

const contentHash = (hexPair: string): ContentHash =>
  `sha256:${hexPair.repeat(32)}` as ContentHash;

const FIXED_NONCE = "preflight-coord-nonce-001";
const OBSERVED_AT = "2026-08-03T12:00:00.000Z" as UtcTimestamp;
const ISSUED_AT = "2026-08-03T12:01:00.000Z" as UtcTimestamp;
const CLI_VERSION = "0.2.118";

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

const emptySpool = {
  bytes: new Uint8Array(0),
  digest: digest("00"),
  truncated: false,
  sourceUtf8Valid: true,
};

const defaultObservation = (): ProviderProcessObservation => ({
  started: true,
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: emptySpool,
  stderr: emptySpool,
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

type HarnessConfig = {
  readonly input?: RunPromptPreflightInput;
  readonly versionFail?: ProviderVersionProbeError;
  readonly versionDefect?: unknown;
  readonly compileBroken?: boolean;
  readonly nonceFail?: PreflightIdentityError;
  readonly nowFail?: PreflightIdentityError;
  readonly prepareFail?: CanaryMaterializerError;
  readonly prepareDefect?: unknown;
  readonly processFail?: ProviderProcessError;
  readonly terminal?: TerminalObservationV1;
  readonly structuredOutput?: unknown;
};

const baseInput = (): RunPromptPreflightInput => ({
  contract: makeContract(),
  providerFamily: "xai",
  executable: "/usr/bin/grok",
  model: "grok-4",
  cwd: "/work",
  environment: { PATH: "/usr/bin" },
  timeoutMs: 30_000,
  stdoutMaxBytes: 65_536,
  stderrMaxBytes: 65_536,
});

const runPreflight = async (
  config: HarnessConfig = {},
): Promise<{
  readonly result: PromptPreflightResultV1;
  readonly events: string[];
}> => {
  const events: string[] = [];
  const input = config.input ?? baseInput();
  let canaryRan = false;
  let compileStarted = false;

  const compileLog = emptyLog();
  const store = config.compileBroken
    ? new Map<string, Uint8Array>()
    : bytesById();

  const instrumentedCompile = Layer.mergeAll(
    Layer.succeed(ArtifactReader, {
      read: (request) =>
        Effect.gen(function* () {
          if (!compileStarted) {
            compileStarted = true;
            events.push("compile");
          }
          compileLog.reader.push(request.descriptor.artifactId);
          const bytes = store.get(request.descriptor.artifactId);
          if (bytes === undefined) {
            return yield* Effect.fail(
              new ArtifactMissing({
                stage: "artifact_read",
                reason: "artifact is unavailable",
                artifactId: request.descriptor.artifactId,
              }),
            );
          }
          return bytes.slice();
        }),
    }),
    Layer.succeed(BundleVerifier, {
      verify: () =>
        Effect.sync(() => {
          if (!compileStarted) {
            compileStarted = true;
            events.push("compile");
          }
          compileLog.bundle += 1;
        }),
    }),
    Layer.succeed(Digest, {
      sha256: (bytes) =>
        Effect.sync(() => {
          if (!compileStarted) {
            compileStarted = true;
            events.push("compile");
          }
          return sha256Hex(bytes) as Sha256Digest;
        }),
    }),
    Layer.succeed(PromptMaterializer, {
      materialize: (materializerInput) =>
        Effect.sync(() => {
          compileLog.materializer += 1;
          return materializePromptBytesLocal(materializerInput);
        }),
    }),
    Layer.succeed(ProviderSchemaLowerer, {
      lower: (lowerInput) => {
        compileLog.lowerer += 1;
        return lowerProviderSchema(
          lowerInput.providerFamily,
          lowerInput.canonicalSchema,
        );
      },
    }),
  );

  const versionLayer = Layer.succeed(ProviderVersionProbe, {
    resolve: () => {
      events.push("version");
      if (config.versionDefect !== undefined) {
        return Effect.die(config.versionDefect);
      }
      if (config.versionFail !== undefined) {
        return Effect.fail(config.versionFail);
      }
      return Effect.succeed(CLI_VERSION);
    },
  });

  const identityLayer = Layer.succeed(PreflightIdentitySource, {
    nonce: Effect.gen(function* () {
      events.push("nonce");
      if (config.nonceFail !== undefined) {
        return yield* Effect.fail(config.nonceFail);
      }
      return FIXED_NONCE;
    }),
    now: Effect.gen(function* () {
      if (config.nowFail !== undefined) {
        return yield* Effect.fail(config.nowFail);
      }
      if (canaryRan) {
        events.push("issue-token");
        return ISSUED_AT;
      }
      return OBSERVED_AT;
    }),
  });

  const materializerLayer = Layer.succeed(CanaryMaterializer, {
    prepare: () =>
      Effect.gen(function* () {
        events.push("prepare-canary");
        if (config.prepareDefect !== undefined) {
          return yield* Effect.die(config.prepareDefect);
        }
        if (config.prepareFail !== undefined) {
          return yield* Effect.fail(config.prepareFail);
        }
        return {
          prompt: { kind: "file" as const, path: "/tmp/canary-prompt.txt" },
          schema: { kind: "inline" as const, json: '{"type":"object"}' },
          canarySchemaVariantHash: contentHash("33"),
        };
      }),
  });

  const adapterLayer = Layer.succeed(ProviderCanaryAdapter, {
    buildRequest: () => Effect.succeed(defaultRequest),
    decodeObservation: () =>
      Effect.succeed({
        terminal: config.terminal ?? successfulTerminal(),
        structuredOutput:
          config.structuredOutput !== undefined
            ? config.structuredOutput
            : {
                schemaVersion: 1,
                nonce: FIXED_NONCE,
                checkResult: "2",
                status: "ready",
              },
      }),
  });

  const runnerLayer = Layer.succeed(ProviderProcessRunner, {
    run: () => {
      events.push("run-canary");
      canaryRan = true;
      if (config.processFail !== undefined) {
        return Effect.fail(config.processFail);
      }
      return Effect.succeed(defaultObservation());
    },
  });

  const layer = Layer.mergeAll(
    versionLayer,
    identityLayer,
    materializerLayer,
    adapterLayer,
    runnerLayer,
    instrumentedCompile,
  );

  const result = await Effect.runPromise(
    runPromptPreflight(input).pipe(Effect.provide(layer), Effect.scoped),
  );

  return { result, events };
};

const assertSecretSafeFailure = (result: PromptPreflightResultV1): void => {
  expect(result._tag).toBe("failure");
  if (result._tag !== "failure") {
    throw new Error("expected failure");
  }
  const json = JSON.stringify(result);
  expect(json).not.toMatch(/SECRET|\/home\/|PATH=|API_KEY|stack|Error:/i);
  expect(result.failure.reason).not.toMatch(/SECRET|\/home\/|API_KEY/);
  expect(result).not.toHaveProperty("stdout");
  expect(result).not.toHaveProperty("stderr");
  expect(result).not.toHaveProperty("environment");
  expect(result).not.toHaveProperty("cwd");
  expect(decodeStrictSync(PromptPreflightResultV1Schema, result)).toEqual(
    result,
  );
};

describe("runPromptPreflight", () => {
  it("follows exact successful order compile→version→nonce→prepare-canary→run-canary→issue-token", async () => {
    const { result, events } = await runPreflight({});
    expect(events).toEqual([
      "compile",
      "version",
      "nonce",
      "prepare-canary",
      "run-canary",
      "issue-token",
    ]);
    expect(result._tag).toBe("ready");
    if (result._tag !== "ready") {
      throw new Error("expected ready");
    }
    expect(result.schemaVersion).toBe(1);
    expect(result.token.cliVersion).toBe(CLI_VERSION);
    expect(result.token.nonce).toBe(FIXED_NONCE);
    expect(result.canary.cliVersion).toBe(CLI_VERSION);
    expect(decodeStrictSync(PromptPreflightResultV1Schema, result)).toEqual(
      result,
    );
  });

  it("version probe failure stops after compile and before provider execution", async () => {
    const { result, events } = await runPreflight({
      versionFail: new ProviderVersionProbeError({
        category: "start_failed",
        reason: "provider CLI version probe failed to start",
      }),
    });
    expect(events).toEqual(["compile", "version"]);
    expect(events).not.toContain("run-canary");
    expect(events).not.toContain("issue-token");
    expect(result._tag).toBe("failure");
    if (result._tag !== "failure") {
      throw new Error("expected failure");
    }
    expect(result.failure.stage).toBe("dispatch");
    expect(result.failure.retry).toBe("changed_preflight");
    expect(result.terminal).toBeNull();
    assertSecretSafeFailure(result);
  });

  it("compiler failure starts no canary and issues no token", async () => {
    const { result, events } = await runPreflight({
      compileBroken: true,
    });
    expect(events).toEqual(["compile"]);
    expect(events).not.toContain("version");
    expect(events).not.toContain("nonce");
    expect(events).not.toContain("prepare-canary");
    expect(events).not.toContain("run-canary");
    expect(events).not.toContain("issue-token");
    expect(result._tag).toBe("failure");
    if (result._tag !== "failure") {
      throw new Error("expected failure");
    }
    expect(result.failure.stage).toBe("prompt");
    expect(result.failure.retry).toBe("new_contract");
    expect(result.terminal).toBeNull();
    assertSecretSafeFailure(result);
  });

  it("canary terminal failure preserves terminal evidence and issues no token", async () => {
    const terminal = successfulTerminal({
      terminalState: "cancelled",
      stopReason: "Cancelled",
      exitCode: null,
      errorMessage: "turn cancelled",
    });
    const { result, events } = await runPreflight({ terminal });
    expect(events).toEqual([
      "compile",
      "version",
      "nonce",
      "prepare-canary",
      "run-canary",
    ]);
    expect(events).not.toContain("issue-token");
    expect(result._tag).toBe("failure");
    if (result._tag !== "failure") {
      throw new Error("expected failure");
    }
    expect(result.failure.stage).toBe("provider");
    expect(result.failure.retry).toBe("changed_preflight");
    expect(result.terminal).not.toBeNull();
    expect(result.terminal?.terminalState).toBe("cancelled");
    expect(result.terminal?.stdoutDigest).toBe(digest("aa"));
    expect(result.terminal?.stderrDigest).toBe(digest("bb"));
    assertSecretSafeFailure(result);
  });

  it("token issuance follows successful canary only", async () => {
    const { result, events } = await runPreflight({});
    const runIdx = events.indexOf("run-canary");
    const tokenIdx = events.indexOf("issue-token");
    expect(runIdx).toBeGreaterThanOrEqual(0);
    expect(tokenIdx).toBeGreaterThan(runIdx);
    expect(result._tag).toBe("ready");
    if (result._tag !== "ready") {
      throw new Error("expected ready");
    }
    expect(result.token.promptHash).toBe(result.prompt.promptHash);
    expect(result.token.promptHash).toBe(result.canary.promptHash);
    expect(result.canary.terminal.terminalState).toBe("completed");
  });

  it("final ready and failure results pass strict schema decoding", async () => {
    const ready = await runPreflight({});
    expect(() =>
      decodeStrictSync(PromptPreflightResultV1Schema, ready.result),
    ).not.toThrow();
    expect(ready.result._tag).toBe("ready");

    const failure = await runPreflight({
      versionFail: new ProviderVersionProbeError({
        category: "invalid_output",
        reason: "provider CLI version output was invalid",
      }),
    });
    expect(() =>
      decodeStrictSync(PromptPreflightResultV1Schema, failure.result),
    ).not.toThrow();
    expect(failure.result._tag).toBe("failure");
  });

  it("hostile thrown or defect values do not leak into failure reasons", async () => {
    const hostile = {
      message: "SECRET=/home/user/.env API_KEY=sk-leak PATH=/secret",
      stack: "Error: SECRET at /home/user/app.ts:1",
      toString() {
        return "SECRET=/home/user/.env";
      },
    };

    const fromVersion = await runPreflight({ versionDefect: hostile });
    assertSecretSafeFailure(fromVersion.result);
    expect(JSON.stringify(fromVersion.result)).not.toContain("SECRET");
    expect(JSON.stringify(fromVersion.result)).not.toContain("API_KEY");
    expect(JSON.stringify(fromVersion.result)).not.toContain("/home/user");

    const fromPrepare = await runPreflight({ prepareDefect: hostile });
    assertSecretSafeFailure(fromPrepare.result);
    expect(JSON.stringify(fromPrepare.result)).not.toContain("SECRET");
    expect(fromPrepare.events).not.toContain("run-canary");
    expect(fromPrepare.events).not.toContain("issue-token");
  });

  it("maps retryable process transport failure to same_contract", async () => {
    const { result, events } = await runPreflight({
      processFail: new ProviderProcessError({
        category: "internal",
        reason: "provider process runner internal failure",
      }),
    });
    expect(events).toContain("run-canary");
    expect(events).not.toContain("issue-token");
    expect(result._tag).toBe("failure");
    if (result._tag !== "failure") {
      throw new Error("expected failure");
    }
    expect(result.failure.stage).toBe("transport");
    expect(result.failure.retry).toBe("same_contract");
    expect(result.terminal).toBeNull();
    assertSecretSafeFailure(result);
  });

  it("maps canary materializer failure without provider execution", async () => {
    const { result, events } = await runPreflight({
      prepareFail: new CanaryMaterializerError({
        category: "unsupported_family",
        reason: "provider family is not supported for canary materialization",
      }),
    });
    expect(events).toEqual(["compile", "version", "nonce", "prepare-canary"]);
    expect(events).not.toContain("run-canary");
    expect(result._tag).toBe("failure");
    if (result._tag !== "failure") {
      throw new Error("expected failure");
    }
    expect(result.failure.stage).toBe("dispatch");
    expect(result.failure.retry).toBe("changed_preflight");
    assertSecretSafeFailure(result);
  });

  it("does not accept CLI version from input (probe-derived only)", async () => {
    const { result } = await runPreflight({});
    expect(result._tag).toBe("ready");
    if (result._tag !== "ready") {
      throw new Error("expected ready");
    }
    expect(result.token.cliVersion).toBe(CLI_VERSION);
    expect(result.canary.cliVersion).toBe(CLI_VERSION);
  });
});
