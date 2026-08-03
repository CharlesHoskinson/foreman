import { spawnSync } from "node:child_process";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeStrictSync,
  hashCanaryChallenge,
  PromptPreflightResultV1,
  type PromptPreflightResultV1 as PromptPreflightResult,
} from "@council/schema";
import { makeContract } from "../../application/test/test-helpers.js";
import {
  MAX_STDERR_BYTES,
  MAX_STDIN_BYTES,
  runPreflightCli,
  type PreflightCliIo,
} from "../src/preflight-cli.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const contract = makeContract();
const bundle = contract.bundle as { baseSha: string; headSha: string };
const artifacts = contract.artifacts as ReadonlyArray<{
  artifactId: string;
  alias: string;
}>;

const validRequest = {
  schemaVersion: 1 as const,
  contract,
  provider: { family: "xai" as const, executable: "grok", model: "grok-4.5" },
  observedBundle: {
    baseSha: bundle.baseSha,
    headSha: bundle.headSha,
    diffPath: "/review.diff",
  },
  artifactPaths: artifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    path: `/artifacts/${artifact.alias}`,
  })),
  cwd: "/review",
};

const typedFailure: PromptPreflightResult = {
  _tag: "failure",
  schemaVersion: 1,
  failure: {
    stage: "provider",
    reason: "schema rejected",
    retry: "changed_preflight",
  },
  terminal: null,
};

const sha64 = "b".repeat(64);
const artifactDigest = "c".repeat(64);
const artifactId = `sha256:${artifactDigest}`;
const contractHash = `sha256:${"d".repeat(64)}`;
const contentHash = `sha256:${"e".repeat(64)}`;
const candidateId = "cand_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const reviewBundle = {
  schemaVersion: 1 as const,
  baseSha: "a".repeat(40),
  headSha: "1".repeat(40),
  diffSha256: sha64,
};
const challenge = {
  schemaVersion: 1 as const,
  nonce: "nonce-canary",
  checkExpression: "1+1" as const,
  expectedCheckResult: "2" as const,
};
const challengeHash = hashCanaryChallenge(challenge);
const terminalCompleted = {
  schemaVersion: 1 as const,
  modelTurnStarted: true,
  terminalRecordObserved: true,
  terminalState: "completed" as const,
  exitCode: 0,
  stopReason: "end_turn",
  pendingToolCalls: 0,
  failedToolCalls: 0,
  parserComplete: true,
  structuredOutputPresent: true,
  structuredOutputError: null,
  stdoutDigest: sha64,
  stderrDigest: sha64,
  errorMessage: null,
};

const readyResult: PromptPreflightResult = decodeStrictSync(
  PromptPreflightResultV1,
  {
    _tag: "ready",
    schemaVersion: 1,
    prompt: {
      schemaVersion: 1,
      profile: "council-ace-1",
      contractHash,
      promptHash: contentHash,
      schemaVariantHash: contentHash,
      canonicalAceText: "Every reviewer must verify the bundle-identity.",
      promptByteLength: 48,
      candidateId,
      bundle: reviewBundle,
      artifactIds: [artifactId],
      responseSchemaArtifactId: artifactId,
    },
    canary: {
      schemaVersion: 1,
      providerFamily: "anthropic",
      model: "claude-sonnet",
      cliVersion: "1.0.0",
      contractClass: "council-ace-1",
      promptHash: contentHash,
      schemaVariantHash: contentHash,
      canarySchemaVariantHash: `sha256:${"ab".repeat(32)}`,
      challengeHash,
      challenge,
      response: {
        schemaVersion: 1,
        nonce: "nonce-canary",
        checkResult: "2",
        status: "ready",
      },
      terminal: terminalCompleted,
      observedAt: "2026-08-02T12:00:00.000Z",
      expiresAt: "2026-08-02T12:10:00.000Z",
    },
    token: {
      schemaVersion: 1,
      providerFamily: "anthropic",
      model: "claude-sonnet",
      cliVersion: "1.0.0",
      contractHash,
      promptHash: contentHash,
      schemaVariantHash: contentHash,
      nonce: "nonce-canary",
      issuedAt: "2026-08-02T12:01:00.000Z",
      expiresAt: "2026-08-02T12:05:00.000Z",
    },
  },
);

type Capture = {
  readonly stdout: Uint8Array[];
  readonly stderr: Uint8Array[];
  executeCalls: number;
  lastRequest: unknown;
};

const bytesStdin = (
  chunks: readonly Uint8Array[],
): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      await Promise.resolve();
      yield chunk;
    }
  },
});

const emptyStdin = (): AsyncIterable<Uint8Array> => bytesStdin([]);

const trackingStdin = (
  chunks: readonly Uint8Array[],
  consumed: { count: number },
): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      await Promise.resolve();
      consumed.count += 1;
      yield chunk;
    }
  },
});

const makeIo = (
  stdin: AsyncIterable<Uint8Array>,
  execute: PreflightCliIo["execute"] = () => Promise.resolve(typedFailure),
): { io: PreflightCliIo; capture: Capture } => {
  const capture: Capture = {
    stdout: [],
    stderr: [],
    executeCalls: 0,
    lastRequest: undefined,
  };
  const io: PreflightCliIo = {
    stdin,
    writeStdout: (bytes) => {
      capture.stdout.push(bytes);
      return Promise.resolve();
    },
    writeStderr: (bytes) => {
      capture.stderr.push(bytes);
      return Promise.resolve();
    },
    execute: (request) => {
      capture.executeCalls += 1;
      capture.lastRequest = request;
      return execute(request);
    },
  };
  return { io, capture };
};

const stdoutText = (capture: Capture): string =>
  textDecoder.decode(
    (() => {
      const total = capture.stdout.reduce((n, c) => n + c.byteLength, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of capture.stdout) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    })(),
  );

const stderrText = (capture: Capture): string =>
  textDecoder.decode(
    (() => {
      const total = capture.stderr.reduce((n, c) => n + c.byteLength, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of capture.stderr) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    })(),
  );

const encodeJson = (value: unknown): Uint8Array =>
  textEncoder.encode(JSON.stringify(value));

const padToExactBytes = (base: Uint8Array, size: number): Uint8Array => {
  if (base.byteLength > size) {
    throw new Error("fixture exceeds target pad size");
  }
  const out = new Uint8Array(size);
  out.set(base);
  out.fill(0x20, base.byteLength);
  return out;
};

const parseStdoutResult = (capture: Capture): PromptPreflightResult => {
  const text = stdoutText(capture);
  expect(text.endsWith("\n")).toBe(true);
  expect(text.slice(0, -1).includes("\n")).toBe(false);
  const parsed: unknown = JSON.parse(text.slice(0, -1));
  return decodeStrictSync(PromptPreflightResultV1, parsed);
};

describe("runPreflightCli", () => {
  it("rejects any argument with exit 64, usage stderr, no stdout, no execute", async () => {
    const { io, capture } = makeIo(emptyStdin());
    const code = await runPreflightCli(["--help"], io);
    expect(code).toBe(64);
    expect(capture.executeCalls).toBe(0);
    expect(capture.stdout).toEqual([]);
    expect(stderrText(capture)).toBe(
      "usage: council-preflight < request.json\n",
    );
    for (const chunk of capture.stderr) {
      expect(chunk.byteLength).toBeLessThanOrEqual(MAX_STDERR_BYTES);
    }
  });

  it("accepts exactly MAX_STDIN_BYTES far enough to parse and execute", async () => {
    const base = encodeJson(validRequest);
    const padded = padToExactBytes(base, MAX_STDIN_BYTES);
    expect(padded.byteLength).toBe(MAX_STDIN_BYTES);
    const { io, capture } = makeIo(bytesStdin([padded]), () =>
      Promise.resolve(readyResult),
    );
    const code = await runPreflightCli([], io);
    expect(code).toBe(0);
    expect(capture.executeCalls).toBe(1);
    expect(parseStdoutResult(capture)._tag).toBe("ready");
  });

  it("rejects MAX_STDIN_BYTES + 1 without decode or execute", async () => {
    const base = encodeJson(validRequest);
    const oversized = padToExactBytes(base, MAX_STDIN_BYTES + 1);
    expect(oversized.byteLength).toBe(MAX_STDIN_BYTES + 1);
    const { io, capture } = makeIo(bytesStdin([oversized]), () =>
      Promise.reject(new Error("execute must not run")),
    );
    const code = await runPreflightCli([], io);
    expect(code).toBe(1);
    expect(capture.executeCalls).toBe(0);
    const result = parseStdoutResult(capture);
    expect(result._tag).toBe("failure");
    if (result._tag === "failure") {
      expect(result.failure.stage).toBe("parse");
      expect(result.failure.reason.length).toBeGreaterThan(0);
    }
  });

  it("stops consuming further chunks once stdin exceeds the bound", async () => {
    const consumed = { count: 0 };
    const chunks = [
      new Uint8Array(MAX_STDIN_BYTES),
      new Uint8Array([0x20]),
      new Uint8Array(128).fill(0x41),
    ];
    const { io, capture } = makeIo(trackingStdin(chunks, consumed), () =>
      Promise.resolve(typedFailure),
    );
    const code = await runPreflightCli([], io);
    expect(code).toBe(1);
    expect(consumed.count).toBe(2);
    expect(capture.executeCalls).toBe(0);
    expect(parseStdoutResult(capture)._tag).toBe("failure");
  });

  it("fails closed on invalid UTF-8 without execute", async () => {
    const { io, capture } = makeIo(
      bytesStdin([new Uint8Array([0xff, 0xfe, 0xfd])]),
      () => Promise.resolve(typedFailure),
    );
    const code = await runPreflightCli([], io);
    expect(code).toBe(1);
    expect(capture.executeCalls).toBe(0);
    const result = parseStdoutResult(capture);
    expect(result._tag).toBe("failure");
    if (result._tag === "failure") {
      expect(result.failure.stage).toBe("parse");
    }
  });

  it("fails closed on malformed JSON without execute", async () => {
    const secret = "SECRET_TOKEN_malformed_json_path_/home/secret";
    const { io, capture } = makeIo(
      bytesStdin([textEncoder.encode(`{ not-json ${secret}`)]),
      () => Promise.resolve(typedFailure),
    );
    const code = await runPreflightCli([], io);
    expect(code).toBe(1);
    expect(capture.executeCalls).toBe(0);
    const out = stdoutText(capture) + stderrText(capture);
    expect(out.includes(secret)).toBe(false);
    expect(parseStdoutResult(capture)._tag).toBe("failure");
  });

  it("fails closed on trailing JSON data without execute", async () => {
    const body = `${JSON.stringify(validRequest)}\n{"extra":true}`;
    const { io, capture } = makeIo(bytesStdin([textEncoder.encode(body)]), () =>
      Promise.resolve(typedFailure),
    );
    const code = await runPreflightCli([], io);
    expect(code).toBe(1);
    expect(capture.executeCalls).toBe(0);
    expect(parseStdoutResult(capture)._tag).toBe("failure");
  });

  it("rejects unknown request fields without execute", async () => {
    const { io, capture } = makeIo(
      bytesStdin([encodeJson({ ...validRequest, extra: true })]),
      () => Promise.resolve(typedFailure),
    );
    const code = await runPreflightCli([], io);
    expect(code).toBe(1);
    expect(capture.executeCalls).toBe(0);
    expect(parseStdoutResult(capture)._tag).toBe("failure");
  });

  it("writes exactly one stdout line and returns 0 for ready results", async () => {
    const { io, capture } = makeIo(bytesStdin([encodeJson(validRequest)]), () =>
      Promise.resolve(readyResult),
    );
    const code = await runPreflightCli([], io);
    expect(code).toBe(0);
    expect(capture.executeCalls).toBe(1);
    const text = stdoutText(capture);
    expect(text).toBe(`${JSON.stringify(readyResult)}\n`);
    expect(text.split("\n").length).toBe(2);
  });

  it("returns 1 for typed executor failures with exact one-line stdout", async () => {
    const { io, capture } = makeIo(bytesStdin([encodeJson(validRequest)]), () =>
      Promise.resolve(typedFailure),
    );
    const code = await runPreflightCli([], io);
    expect(code).toBe(1);
    expect(capture.executeCalls).toBe(1);
    expect(stdoutText(capture)).toBe(`${JSON.stringify(typedFailure)}\n`);
  });

  it("calls execute exactly once only after a valid request", async () => {
    const { io, capture } = makeIo(bytesStdin([encodeJson(validRequest)]), () =>
      Promise.resolve(typedFailure),
    );
    await runPreflightCli([], io);
    expect(capture.executeCalls).toBe(1);
    expect(capture.lastRequest).toMatchObject({
      schemaVersion: 1,
      provider: { family: "xai", executable: "grok", model: "grok-4.5" },
      cwd: "/review",
    });
  });

  it("maps invalid executor results to a static parse-stage failure", async () => {
    const secret = "SECRET_INVALID_RESULT_/env/API_KEY=xyz";
    const { io, capture } = makeIo(bytesStdin([encodeJson(validRequest)]), () =>
      Promise.resolve({
        _tag: "ready",
        schemaVersion: 1,
        leak: secret,
      } as unknown as PromptPreflightResult),
    );
    const code = await runPreflightCli([], io);
    expect(code).toBe(1);
    expect(capture.executeCalls).toBe(1);
    const result = parseStdoutResult(capture);
    expect(result._tag).toBe("failure");
    if (result._tag === "failure") {
      expect(result.failure.stage).toBe("parse");
    }
    expect(stdoutText(capture).includes(secret)).toBe(false);
    expect(stderrText(capture).includes(secret)).toBe(false);
  });

  it("maps thrown executor errors to a static parse-stage failure without reflection", async () => {
    const secret = "SECRET_THROW path=/home/user/.env token=abc123";
    const { io, capture } = makeIo(bytesStdin([encodeJson(validRequest)]), () =>
      Promise.reject(new Error(secret)),
    );
    const code = await runPreflightCli([], io);
    expect(code).toBe(1);
    expect(capture.executeCalls).toBe(1);
    const result = parseStdoutResult(capture);
    expect(result._tag).toBe("failure");
    if (result._tag === "failure") {
      expect(result.failure.stage).toBe("parse");
    }
    const combined = stdoutText(capture) + stderrText(capture);
    expect(combined.includes(secret)).toBe(false);
    expect(combined.includes("/home/user")).toBe(false);
    expect(combined.includes("abc123")).toBe(false);
  });

  it("never reflects secret-bearing input in failure output", async () => {
    const secret = "SECRET_ENV_VALUE_should_not_leak";
    const { io, capture } = makeIo(
      bytesStdin([
        textEncoder.encode(
          JSON.stringify({
            ...validRequest,
            cwd: `/tmp/${secret}`,
            extraField: secret,
          }),
        ),
      ]),
      () => Promise.resolve(typedFailure),
    );
    const code = await runPreflightCli([], io);
    expect(code).toBe(1);
    expect(capture.executeCalls).toBe(0);
    const combined = stdoutText(capture) + stderrText(capture);
    expect(combined.includes(secret)).toBe(false);
  });

  it("keeps every stderr write within MAX_STDERR_BYTES UTF-8 bytes", async () => {
    const { io, capture } = makeIo(emptyStdin());
    await runPreflightCli(["x"], io);
    expect(capture.stderr.length).toBeGreaterThan(0);
    for (const chunk of capture.stderr) {
      expect(chunk.byteLength).toBeLessThanOrEqual(MAX_STDERR_BYTES);
    }
  });
});

describe("compiled council-preflight process", () => {
  it("runs the built entrypoint and emits one strict failure line", () => {
    const child = spawnSync(
      process.execPath,
      ["packages/runtime-node/dist/preflight-cli.js"],
      {
        cwd: process.cwd(),
        input: "{}\n",
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    expect(child.status).toBe(1);
    expect(child.stderr).toBe("");
    expect(child.stdout.endsWith("\n")).toBe(true);
    expect(child.stdout.slice(0, -1).includes("\n")).toBe(false);

    const parsed: unknown = JSON.parse(child.stdout.slice(0, -1));
    const result = decodeStrictSync(PromptPreflightResultV1, parsed);
    expect(result._tag).toBe("failure");
    if (result._tag === "failure") {
      expect(result.failure.stage).toBe("parse");
      expect(result.terminal).toBe(null);
    }
  });

  it("rejects invalid ACE before starting the provider process", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "council-preflight-ace-"));
    const markerPath = join(tempDir, "provider-started.marker");
    const isWindows = process.platform === "win32";
    const executablePath = isWindows
      ? join(tempDir, "provider-fixture.exe")
      : join(tempDir, "provider-fixture");

    try {
      if (!isWindows) {
        const script = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(markerPath)}, "started\\n");
process.stdout.write("1.0.0\\n");
`;
        await writeFile(executablePath, script, "utf8");
        await chmod(executablePath, 0o755);
      }

      const request = {
        ...validRequest,
        contract: {
          ...validRequest.contract,
          aceSource: "Reviewer maybe checks things.",
        },
        provider: {
          ...validRequest.provider,
          executable: executablePath,
        },
      };

      const child = spawnSync(
        process.execPath,
        ["packages/runtime-node/dist/preflight-cli.js"],
        {
          cwd: process.cwd(),
          input: `${JSON.stringify(request)}\n`,
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      expect(child.status).toBe(1);
      expect(child.stderr).toBe("");
      expect(child.stdout.endsWith("\n")).toBe(true);
      expect(child.stdout.slice(0, -1).includes("\n")).toBe(false);

      const parsed: unknown = JSON.parse(child.stdout.slice(0, -1));
      const result = decodeStrictSync(PromptPreflightResultV1, parsed);
      expect(result._tag).toBe("failure");
      if (result._tag === "failure") {
        expect(result.failure.stage).toBe("prompt");
        expect(result.terminal).toBe(null);
      }

      await expect(access(markerPath)).rejects.toBeDefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
