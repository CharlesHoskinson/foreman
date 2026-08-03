/**
 * Red TDD tests for preflight-program runtime helpers.
 * No live provider process spawn.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type {
  CanaryMaterializerService,
  ProviderProcessObservation,
  ProviderProcessRequest,
  ProviderProcessRunnerService,
} from "@council/application";
import {
  CanaryMaterializerError,
  PreflightIdentityError,
  ProviderProcessError,
  ProviderVersionProbeError,
  SchemaFileMaterializationError,
} from "@council/application";
import {
  buildCanaryMaterial,
  CanaryMaterializationError,
} from "@council/platform-node";
import type {
  CanaryChallengeV1,
  PreflightCliRequestV1,
  Sha256Digest,
  UtcTimestamp,
} from "@council/schema";
import {
  decodePreflightCliRequestV1,
  decodeStrictSync,
  PromptPreflightResultV1,
} from "@council/schema";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  bytesById,
  diffBytes,
  makeContract,
} from "../../application/test/test-helpers.js";
import {
  CHILD_ENV_NAMES,
  buildChildEnvironment,
  createCanaryMaterializer,
  createPreflightIdentitySource,
  createProviderVersionProbe,
  executePreflightRequest,
  normalizePreflightRequestPaths,
  type CanaryTransportOps,
} from "../src/preflight-program.js";

const DIGEST = "ab".repeat(32) as Sha256Digest;
const SECRET_MARKER = "sk-MARKER-SECRET-LEAK-99";

const spool = (
  text: string,
  overrides: Partial<ProviderProcessObservation["stdout"]> = {},
): ProviderProcessObservation["stdout"] => ({
  bytes: new TextEncoder().encode(text),
  digest: DIGEST,
  truncated: false,
  sourceUtf8Valid: true,
  ...overrides,
});

const emptySpool = (): ProviderProcessObservation["stdout"] => ({
  bytes: new Uint8Array(0),
  digest: DIGEST,
  truncated: false,
  sourceUtf8Valid: true,
});

const validObservation = (
  overrides: Partial<ProviderProcessObservation> = {},
): ProviderProcessObservation => ({
  started: true,
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: spool("grok 0.2.118\nsecond line"),
  stderr: emptySpool(),
  ...overrides,
});

const makeRunner = (config: {
  readonly observation?: ProviderProcessObservation;
  readonly fail?: ProviderProcessError;
  readonly captured?: { request: ProviderProcessRequest | null };
}): ProviderProcessRunnerService => ({
  run: (request) => {
    if (config.captured !== undefined) {
      config.captured.request = request;
    }
    if (config.fail !== undefined) {
      return Effect.fail(config.fail);
    }
    return Effect.succeed(config.observation ?? validObservation());
  },
});

const resolveVersion = (
  runner: ProviderProcessRunnerService,
  executable = "grok",
  cwd = "/work",
  environment: Readonly<Record<string, string>> = { PATH: "/bin" },
) => createProviderVersionProbe(runner).resolve(executable, cwd, environment);

describe("CHILD_ENV_NAMES", () => {
  it("is exactly the closed allowlist in order", () => {
    expect(CHILD_ENV_NAMES).toEqual([
      "PATH",
      "HOME",
      "USERPROFILE",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "LOCALAPPDATA",
      "APPDATA",
      "SYSTEMROOT",
      "COMSPEC",
      "PATHEXT",
      "TMPDIR",
      "TMP",
      "TEMP",
      "LANG",
      "LC_ALL",
    ]);
  });
});

describe("buildChildEnvironment", () => {
  it("copies only present allowlisted string keys and preserves empty values", () => {
    const source = Object.freeze({
      PATH: "/usr/bin",
      HOME: "/home/tester",
      LANG: "",
      API_KEY: SECRET_MARKER,
      TOKEN: "tok-secret",
      ARBITRARY: "nope",
      USERPROFILE: undefined,
      TMP: "/tmp",
    }) as Readonly<Record<string, string | undefined>>;

    const result = buildChildEnvironment(source);

    expect(result).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/tester",
      LANG: "",
      TMP: "/tmp",
    });
    expect(result).not.toHaveProperty("API_KEY");
    expect(result).not.toHaveProperty("TOKEN");
    expect(result).not.toHaveProperty("ARBITRARY");
    expect(result).not.toHaveProperty("USERPROFILE");
    expect(Object.isFrozen(source)).toBe(true);
    expect(source).toMatchObject({
      PATH: "/usr/bin",
      API_KEY: SECRET_MARKER,
      TOKEN: "tok-secret",
      ARBITRARY: "nope",
    });
  });
});

describe("createProviderVersionProbe", () => {
  it("calls the runner once with the fixed version-probe request shape", async () => {
    const captured: { request: ProviderProcessRequest | null } = {
      request: null,
    };
    const runner = makeRunner({
      observation: validObservation(),
      captured,
    });
    const version = await Effect.runPromise(resolveVersion(runner));

    expect(version).toBe("grok 0.2.118");
    expect(captured.request).toEqual({
      executable: "grok",
      args: ["--version"],
      cwd: "/work",
      environment: { PATH: "/bin" },
      timeoutMs: 5000,
      stdoutMaxBytes: 4096,
      stderrMaxBytes: 4096,
      stdin: null,
    });
  });

  it("returns the trimmed first stdout line", async () => {
    const runner = makeRunner({
      observation: validObservation({
        stdout: spool("  grok 0.2.118  \nsecond line\n"),
      }),
    });
    const version = await Effect.runPromise(resolveVersion(runner));
    expect(version).toBe("grok 0.2.118");
  });

  it("fails with invalid_output when sanitized stdout reports sourceUtf8Valid false", async () => {
    // Valid-looking public bytes after non-fatal decode/re-encode, but the
    // capture marked the original stream invalid. Version probe must refuse.
    const stdout = {
      ...spool("grok 0.2.118\n"),
      sourceUtf8Valid: false,
    };
    const runner = makeRunner({
      observation: validObservation({ stdout }),
    });
    const either = await Effect.runPromise(
      Effect.either(resolveVersion(runner)),
    );
    expect(either._tag).toBe("Left");
    if (either._tag !== "Left") {
      throw new Error("expected failure");
    }
    expect(either.left).toBeInstanceOf(ProviderVersionProbeError);
    expect(either.left._tag).toBe("ProviderVersionProbeError");
    expect(either.left.category).toBe("invalid_output");
    expect(typeof either.left.reason).toBe("string");
    expect(either.left.reason.length).toBeGreaterThan(0);
  });

  it.each([
    {
      name: "timedOut",
      observation: validObservation({ timedOut: true }),
      category: "timeout" as const,
    },
    {
      name: "started false",
      observation: validObservation({ started: false }),
      category: "invalid_output" as const,
    },
    {
      name: "nonzero exit",
      observation: validObservation({ exitCode: 1 }),
      category: "invalid_output" as const,
    },
    {
      name: "signal set",
      observation: validObservation({ signal: "SIGTERM", exitCode: null }),
      category: "invalid_output" as const,
    },
    {
      name: "blank stdout",
      observation: validObservation({ stdout: spool("   \n") }),
      category: "invalid_output" as const,
    },
    {
      name: "truncated stdout with valid UTF-8",
      observation: validObservation({
        stdout: spool("grok 0.2.118\n", { truncated: true }),
      }),
      category: "invalid_output" as const,
    },
    {
      name: "invalid UTF-8 stdout",
      observation: validObservation({
        stdout: {
          bytes: new Uint8Array([0xff, 0xfe, 0xfd]),
          digest: DIGEST,
          truncated: false,
          sourceUtf8Valid: true,
        },
      }),
      category: "invalid_output" as const,
    },
  ])(
    "fails with ProviderVersionProbeError category $category for $name",
    async ({ observation, category }) => {
      const runner = makeRunner({ observation });
      const either = await Effect.runPromise(
        Effect.either(resolveVersion(runner)),
      );
      expect(either._tag).toBe("Left");
      if (either._tag !== "Left") {
        throw new Error("expected failure");
      }
      expect(either.left).toBeInstanceOf(ProviderVersionProbeError);
      expect(either.left._tag).toBe("ProviderVersionProbeError");
      expect(either.left.category).toBe(category);
      expect(typeof either.left.reason).toBe("string");
      expect(either.left.reason.length).toBeGreaterThan(0);
    },
  );

  it.each([
    {
      name: "start_failed",
      fail: new ProviderProcessError({
        category: "start_failed",
        reason: "provider executable is missing or not executable",
      }),
      category: "start_failed" as const,
    },
    {
      name: "internal",
      fail: new ProviderProcessError({
        category: "internal",
        reason: "provider process runner failed internally",
      }),
      category: "internal" as const,
    },
  ])(
    "maps runner ProviderProcessError category $name to version category $category",
    async ({ fail, category }) => {
      const runner = makeRunner({ fail });
      const either = await Effect.runPromise(
        Effect.either(resolveVersion(runner)),
      );
      expect(either._tag).toBe("Left");
      if (either._tag !== "Left") {
        throw new Error("expected failure");
      }
      expect(either.left).toBeInstanceOf(ProviderVersionProbeError);
      expect(either.left.category).toBe(category);
      expect(either.left.reason).not.toContain(fail.reason);
    },
  );

  it("never places marker secrets from request or observation into public error reasons", async () => {
    const secretPath = `/opt/${SECRET_MARKER}/grok`;
    const secretCwd = `/home/${SECRET_MARKER}/work`;
    const secretEnv = {
      PATH: `/bin:${SECRET_MARKER}`,
      HOME: `/home/${SECRET_MARKER}`,
    };
    const secretStdout = `version leak ${SECRET_MARKER}\n`;
    const secretStderr = `stderr leak ${SECRET_MARKER}\n`;

    const cases: ReadonlyArray<{
      readonly label: string;
      readonly runner: ProviderProcessRunnerService;
      readonly executable: string;
      readonly cwd: string;
      readonly environment: Readonly<Record<string, string>>;
    }> = [
      {
        label: "invalid output with secret fields",
        runner: makeRunner({
          observation: validObservation({
            exitCode: 2,
            stdout: spool(secretStdout),
            stderr: spool(secretStderr),
          }),
        }),
        executable: secretPath,
        cwd: secretCwd,
        environment: secretEnv,
      },
      {
        label: "timeout with secret fields",
        runner: makeRunner({
          observation: validObservation({
            timedOut: true,
            stdout: spool(secretStdout),
            stderr: spool(secretStderr),
          }),
        }),
        executable: secretPath,
        cwd: secretCwd,
        environment: secretEnv,
      },
      {
        label: "start_failed with secret reason",
        runner: makeRunner({
          fail: new ProviderProcessError({
            category: "start_failed",
            reason: `cannot start ${secretPath} HOME=${secretEnv.HOME} ${SECRET_MARKER}`,
          }),
        }),
        executable: secretPath,
        cwd: secretCwd,
        environment: secretEnv,
      },
      {
        label: "internal with secret reason",
        runner: makeRunner({
          fail: new ProviderProcessError({
            category: "internal",
            reason: `internal boom ${SECRET_MARKER} cwd=${secretCwd}`,
          }),
        }),
        executable: secretPath,
        cwd: secretCwd,
        environment: secretEnv,
      },
    ];

    for (const testCase of cases) {
      const either = await Effect.runPromise(
        Effect.either(
          resolveVersion(
            testCase.runner,
            testCase.executable,
            testCase.cwd,
            testCase.environment,
          ),
        ),
      );
      expect(either._tag).toBe("Left");
      if (either._tag !== "Left") {
        throw new Error(`expected failure for ${testCase.label}`);
      }
      const json = JSON.stringify(either.left);
      expect(json).not.toContain(SECRET_MARKER);
      expect(either.left.reason).not.toContain(SECRET_MARKER);
      expect(either.left.reason).not.toContain(secretPath);
      expect(either.left.reason).not.toContain(secretCwd);
      expect(either.left.reason).not.toContain(secretStdout.trim());
      expect(either.left.reason).not.toContain(secretStderr.trim());
    }
  });
});

describe("createPreflightIdentitySource", () => {
  it("returns injected nonce and UTC timestamp through Effect values", async () => {
    const fixedNonce = "preflight-nonce-fixed-001";
    const fixedDate = new Date("2026-08-03T12:00:00.000Z");
    const service = createPreflightIdentitySource({
      nonce: () => fixedNonce,
      now: () => fixedDate,
    });

    const nonce = await Effect.runPromise(service.nonce);
    const now = await Effect.runPromise(service.now);

    expect(nonce).toBe(fixedNonce);
    expect(now).toBe("2026-08-03T12:00:00.000Z" as UtcTimestamp);
  });

  it.each([
    {
      name: "empty nonce",
      ops: {
        nonce: () => "",
        now: () => new Date("2026-08-03T12:00:00.000Z"),
      },
      category: "nonce_failed" as const,
      which: "nonce" as const,
    },
    {
      name: "thrown nonce",
      ops: {
        nonce: () => {
          throw new Error(`nonce boom ${SECRET_MARKER}`);
        },
        now: () => new Date("2026-08-03T12:00:00.000Z"),
      },
      category: "nonce_failed" as const,
      which: "nonce" as const,
    },
    {
      name: "invalid Date",
      ops: {
        nonce: () => "ok-nonce",
        now: () => new Date(Number.NaN),
      },
      category: "clock_failed" as const,
      which: "now" as const,
    },
    {
      name: "thrown Date",
      ops: {
        nonce: () => "ok-nonce",
        now: () => {
          throw new Error(`clock boom ${SECRET_MARKER}`);
        },
      },
      category: "clock_failed" as const,
      which: "now" as const,
    },
  ])(
    "fails with PreflightIdentityError category $category for $name",
    async ({ ops, category, which }) => {
      const service = createPreflightIdentitySource(ops);
      const effect = which === "nonce" ? service.nonce : service.now;
      const either = await Effect.runPromise(Effect.either(effect));
      expect(either._tag).toBe("Left");
      if (either._tag !== "Left") {
        throw new Error("expected failure");
      }
      expect(either.left).toBeInstanceOf(PreflightIdentityError);
      expect(either.left._tag).toBe("PreflightIdentityError");
      expect(either.left.category).toBe(category);
      expect(typeof either.left.reason).toBe("string");
      expect(either.left.reason.length).toBeGreaterThan(0);
      expect(either.left.reason).not.toContain(SECRET_MARKER);
      expect(JSON.stringify(either.left)).not.toContain(SECRET_MARKER);
    },
  );
});

const TRANSPORT_CHALLENGE: CanaryChallengeV1 = {
  schemaVersion: 1,
  nonce: "nonce-runtime-transport",
  checkExpression: "1+1",
  expectedCheckResult: "2",
};

type TransportCounters = {
  promptAcquired: number;
  promptReleased: number;
  schemaAcquired: number;
  schemaReleased: number;
};

const makeTransportOps = (
  overrides: Partial<CanaryTransportOps> = {},
): {
  readonly ops: CanaryTransportOps;
  readonly counters: TransportCounters;
} => {
  const counters: TransportCounters = {
    promptAcquired: 0,
    promptReleased: 0,
    schemaAcquired: 0,
    schemaReleased: 0,
  };

  const promptFile: CanaryTransportOps["promptFile"] = () =>
    Effect.acquireRelease(
      Effect.sync(() => {
        counters.promptAcquired += 1;
        return "/scoped/prompt.txt";
      }),
      () =>
        Effect.sync(() => {
          counters.promptReleased += 1;
        }),
    );

  const schemaFile: CanaryTransportOps["schemaFile"] = () =>
    Effect.acquireRelease(
      Effect.sync(() => {
        counters.schemaAcquired += 1;
        return "/scoped/schema.json";
      }),
      () =>
        Effect.sync(() => {
          counters.schemaReleased += 1;
        }),
    );

  const ops: CanaryTransportOps = {
    build: buildCanaryMaterial,
    promptFile,
    schemaFile,
    ...overrides,
  };

  return { ops, counters };
};

const prepareWith =
  (service: CanaryMaterializerService) =>
  (family: "anthropic" | "xai" | "openai" | "google") =>
    service.prepare(TRANSPORT_CHALLENGE, family).pipe(Effect.scoped);

describe("createCanaryMaterializer", () => {
  it("anthropic returns stdin prompt, inline schema, exact hash, and acquires no file", async () => {
    const { ops, counters } = makeTransportOps();
    const material = buildCanaryMaterial(TRANSPORT_CHALLENGE);
    const service = createCanaryMaterializer(ops);

    const prepared = await Effect.runPromise(prepareWith(service)("anthropic"));

    expect(prepared.prompt).toEqual({
      kind: "stdin",
      bytes: material.promptBytes,
    });
    expect(prepared.schema).toEqual({
      kind: "inline",
      json: material.schemaJson,
    });
    expect(prepared.canarySchemaVariantHash).toBe(
      material.canarySchemaVariantHash,
    );
    expect(counters.promptAcquired).toBe(0);
    expect(counters.promptReleased).toBe(0);
    expect(counters.schemaAcquired).toBe(0);
    expect(counters.schemaReleased).toBe(0);
  });

  it("xai returns file prompt, inline schema, exact hash, acquires only prompt, and releases after scope", async () => {
    const { ops, counters } = makeTransportOps();
    const material = buildCanaryMaterial(TRANSPORT_CHALLENGE);
    const service = createCanaryMaterializer(ops);

    const prepared = await Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* service.prepare(TRANSPORT_CHALLENGE, "xai");
        expect(counters.promptAcquired).toBe(1);
        expect(counters.promptReleased).toBe(0);
        expect(counters.schemaAcquired).toBe(0);
        expect(counters.schemaReleased).toBe(0);
        return result;
      }).pipe(Effect.scoped),
    );

    expect(prepared.prompt).toEqual({
      kind: "file",
      path: "/scoped/prompt.txt",
    });
    expect(prepared.schema).toEqual({
      kind: "inline",
      json: material.schemaJson,
    });
    expect(prepared.canarySchemaVariantHash).toBe(
      material.canarySchemaVariantHash,
    );
    expect(counters.promptAcquired).toBe(1);
    expect(counters.promptReleased).toBe(1);
    expect(counters.schemaAcquired).toBe(0);
    expect(counters.schemaReleased).toBe(0);
  });

  it("openai returns stdin prompt, schema file, exact hash, acquires only schema, and releases after scope", async () => {
    const { ops, counters } = makeTransportOps();
    const material = buildCanaryMaterial(TRANSPORT_CHALLENGE);
    const service = createCanaryMaterializer(ops);

    const prepared = await Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* service.prepare(TRANSPORT_CHALLENGE, "openai");
        expect(counters.promptAcquired).toBe(0);
        expect(counters.promptReleased).toBe(0);
        expect(counters.schemaAcquired).toBe(1);
        expect(counters.schemaReleased).toBe(0);
        return result;
      }).pipe(Effect.scoped),
    );

    expect(prepared.prompt).toEqual({
      kind: "stdin",
      bytes: material.promptBytes,
    });
    expect(prepared.schema).toEqual({
      kind: "file",
      path: "/scoped/schema.json",
    });
    expect(prepared.canarySchemaVariantHash).toBe(
      material.canarySchemaVariantHash,
    );
    expect(counters.promptAcquired).toBe(0);
    expect(counters.promptReleased).toBe(0);
    expect(counters.schemaAcquired).toBe(1);
    expect(counters.schemaReleased).toBe(1);
  });

  it("google fails with unsupported_family, static nonempty reason, no file acquisition, and no fallback transport", async () => {
    const { ops, counters } = makeTransportOps();
    const service = createCanaryMaterializer(ops);

    const either = await Effect.runPromise(
      Effect.either(prepareWith(service)("google")),
    );

    expect(either._tag).toBe("Left");
    if (either._tag !== "Left") {
      throw new Error("expected failure");
    }
    expect(either.left).toBeInstanceOf(CanaryMaterializerError);
    expect(either.left._tag).toBe("CanaryMaterializerError");
    expect(either.left.category).toBe("unsupported_family");
    expect(typeof either.left.reason).toBe("string");
    expect(either.left.reason.length).toBeGreaterThan(0);
    expect(counters.promptAcquired).toBe(0);
    expect(counters.promptReleased).toBe(0);
    expect(counters.schemaAcquired).toBe(0);
    expect(counters.schemaReleased).toBe(0);
    // No successful PreparedCanary / fallback transport on the error path.
    expect(either.left).not.toHaveProperty("prompt");
    expect(either.left).not.toHaveProperty("schema");
    expect(either.left).not.toHaveProperty("canarySchemaVariantHash");
  });

  it.each([
    {
      name: "prompt-file typed failure",
      family: "xai" as const,
      overrides: {
        promptFile: () =>
          Effect.fail(
            new CanaryMaterializationError({
              category: "create_failed",
              reason: `prompt materialization boom ${SECRET_MARKER}`,
            }),
          ),
      },
    },
    {
      name: "schema-file typed failure",
      family: "openai" as const,
      overrides: {
        schemaFile: () =>
          Effect.fail(
            new SchemaFileMaterializationError({
              category: "create_failed",
              reason: `schema materialization boom ${SECRET_MARKER}`,
            }),
          ),
      },
    },
  ])(
    "maps $name to CanaryMaterializerError prepare_failed without secret leakage",
    async ({ family, overrides }) => {
      const { ops, counters } = makeTransportOps(overrides);
      const service = createCanaryMaterializer(ops);

      const either = await Effect.runPromise(
        Effect.either(prepareWith(service)(family)),
      );

      expect(either._tag).toBe("Left");
      if (either._tag !== "Left") {
        throw new Error("expected failure");
      }
      expect(either.left).toBeInstanceOf(CanaryMaterializerError);
      expect(either.left._tag).toBe("CanaryMaterializerError");
      expect(either.left.category).toBe("prepare_failed");
      expect(typeof either.left.reason).toBe("string");
      expect(either.left.reason.length).toBeGreaterThan(0);
      expect(either.left.reason).not.toContain(SECRET_MARKER);
      expect(JSON.stringify(either.left)).not.toContain(SECRET_MARKER);
      expect(counters.promptReleased).toBe(counters.promptAcquired);
      expect(counters.schemaReleased).toBe(counters.schemaAcquired);
    },
  );

  it("releases the prompt file when the continuation fails after xai acquisition", async () => {
    const { ops, counters } = makeTransportOps();
    const service = createCanaryMaterializer(ops);

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const prepared = yield* service.prepare(TRANSPORT_CHALLENGE, "xai");
        expect(prepared.prompt).toEqual({
          kind: "file",
          path: "/scoped/prompt.txt",
        });
        expect(counters.promptAcquired).toBe(1);
        expect(counters.promptReleased).toBe(0);
        return yield* Effect.fail("caller-failure-after-prompt" as const);
      }).pipe(Effect.scoped),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(counters.promptAcquired).toBe(1);
    expect(counters.promptReleased).toBe(1);
    expect(counters.schemaAcquired).toBe(0);
    expect(counters.schemaReleased).toBe(0);
  });

  it("releases the schema file when the continuation is interrupted after openai acquisition", async () => {
    const { ops, counters } = makeTransportOps();
    const service = createCanaryMaterializer(ops);

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const prepared = yield* service.prepare(TRANSPORT_CHALLENGE, "openai");
        expect(prepared.schema).toEqual({
          kind: "file",
          path: "/scoped/schema.json",
        });
        expect(counters.schemaAcquired).toBe(1);
        expect(counters.schemaReleased).toBe(0);
        return yield* Effect.interrupt;
      }).pipe(Effect.scoped),
    );

    expect(Exit.isInterrupted(exit)).toBe(true);
    expect(counters.promptAcquired).toBe(0);
    expect(counters.promptReleased).toBe(0);
    expect(counters.schemaAcquired).toBe(1);
    expect(counters.schemaReleased).toBe(1);
  });
});

const PATH_SAFE_ENV: Readonly<Record<string, string | undefined>> = {
  PATH: process.env.PATH,
};

const assertSanitizedResult = (result: unknown, marker: string): void => {
  const decoded = decodeStrictSync(PromptPreflightResultV1, result);
  const serialized = JSON.stringify(decoded);
  expect(serialized).not.toContain("API_KEY");
  expect(serialized).not.toContain("PATH=");
  expect(serialized).not.toContain("/home/");
  expect(serialized).not.toContain(marker);
  expect(serialized).not.toContain("stdout");
  expect(serialized).not.toContain("stderr");
  for (const bytes of bytesById().values()) {
    const text = new TextDecoder().decode(bytes);
    if (text.length > 0) {
      expect(serialized).not.toContain(text);
    }
  }
};

const contractBundle = (
  contract: ReturnType<typeof makeContract>,
): { readonly baseSha: string; readonly headSha: string } => {
  const bundle = contract.bundle as {
    readonly baseSha: string;
    readonly headSha: string;
  };
  return { baseSha: bundle.baseSha, headSha: bundle.headSha };
};

const contractLimits = (
  contract: ReturnType<typeof makeContract>,
): { readonly maxArtifactBytes: number } => {
  const limits = contract.limits as { readonly maxArtifactBytes: number };
  return { maxArtifactBytes: limits.maxArtifactBytes };
};

const artifactPathsFor = (
  contract: ReturnType<typeof makeContract>,
  pathForId: (artifactId: string) => string,
): ReadonlyArray<{ readonly artifactId: string; readonly path: string }> => {
  const artifacts = contract.artifacts as ReadonlyArray<{
    readonly artifactId: string;
  }>;
  const store = bytesById();
  return artifacts.map((artifact) => {
    expect(store.has(artifact.artifactId)).toBe(true);
    return {
      artifactId: artifact.artifactId,
      path: pathForId(artifact.artifactId),
    };
  });
};

const buildValidRequest = (options: {
  readonly family?: "xai" | "google" | "anthropic" | "openai";
  readonly executable?: string;
  readonly model?: string;
  readonly baseSha?: string;
  readonly headSha?: string;
  readonly diffPath: string;
  readonly artifactPathForId: (artifactId: string) => string;
  readonly cwd: string;
}): PreflightCliRequestV1 => {
  const contract = makeContract();
  const bundle = contractBundle(contract);
  return decodePreflightCliRequestV1({
    schemaVersion: 1,
    contract,
    provider: {
      family: options.family ?? "xai",
      executable: options.executable ?? process.execPath,
      model: options.model ?? "grok-4.5",
    },
    observedBundle: {
      baseSha: options.baseSha ?? bundle.baseSha,
      headSha: options.headSha ?? bundle.headSha,
      diffPath: options.diffPath,
    },
    artifactPaths: artifactPathsFor(contract, options.artifactPathForId),
    cwd: options.cwd,
  });
};

describe("normalizePreflightRequestPaths", () => {
  it("normalizes runtime paths against one invocation directory", () => {
    const invocationDirectory = resolve("/tmp", "council-invocation");
    const relativeCwd = join("run");
    const relativeDiffPath = join("run", "artifacts", "diff-patch");
    const request = buildValidRequest({
      executable: "grok",
      diffPath: relativeDiffPath,
      artifactPathForId: (artifactId) => join("run", "artifacts", artifactId),
      cwd: relativeCwd,
    });
    const original = structuredClone(request);

    const normalized = normalizePreflightRequestPaths(
      request,
      invocationDirectory,
    );

    expect(normalized.cwd).toBe(resolve(invocationDirectory, relativeCwd));
    expect(normalized.observedBundle.diffPath).toBe(
      resolve(invocationDirectory, relativeDiffPath),
    );
    expect(normalized.artifactPaths).toEqual(
      request.artifactPaths.map((item) => ({
        ...item,
        path: resolve(invocationDirectory, item.path),
      })),
    );
    expect(normalized.provider.executable).toBe("grok");
    expect(request).toEqual(original);
  });

  it("leaves absolute runtime paths unchanged", () => {
    const invocationDirectory = resolve("/tmp", "council-invocation");
    const absoluteRoot = resolve("/var", "council-absolute");
    // Keep a lexical ".." segment so path.resolve would rewrite the string.
    // Byte-for-byte preservation must retain the original absolute form.
    const absoluteCwd = [absoluteRoot, "work", "..", "retained"].join(sep);
    const absoluteDiffPath = [
      absoluteRoot,
      "artifacts",
      "..",
      "artifacts",
      "diff-patch",
    ].join(sep);
    const request = buildValidRequest({
      executable: "grok",
      diffPath: absoluteDiffPath,
      artifactPathForId: (artifactId) =>
        [absoluteRoot, "artifacts", "..", "artifacts", artifactId].join(sep),
      cwd: absoluteCwd,
    });
    const original = structuredClone(request);

    const normalized = normalizePreflightRequestPaths(
      request,
      invocationDirectory,
    );

    expect(absoluteCwd.includes(`${sep}..${sep}`)).toBe(true);
    expect(normalized.cwd).toBe(request.cwd);
    expect(normalized.cwd).toBe(absoluteCwd);
    expect(normalized.observedBundle.diffPath).toBe(
      request.observedBundle.diffPath,
    );
    expect(normalized.observedBundle.diffPath).toBe(absoluteDiffPath);
    expect(normalized.artifactPaths).toEqual(request.artifactPaths);
    for (const item of request.artifactPaths) {
      const matched = normalized.artifactPaths.find(
        (candidate) => candidate.artifactId === item.artifactId,
      );
      expect(matched).toBeDefined();
      expect(matched?.path).toBe(item.path);
      expect(item.path.includes(`${sep}..${sep}`)).toBe(true);
    }
    expect(normalized.provider.executable).toBe("grok");
    expect(normalized.provider.executable).toBe(request.provider.executable);
    expect(request).toEqual(original);
  });
});

describe("executePreflightRequest", () => {
  it("fails closed for google before dispatch without reading marker paths", async () => {
    const marker = SECRET_MARKER;
    const request = buildValidRequest({
      family: "google",
      executable: `/nonexistent/${marker}/gemini-bin`,
      model: "gemini-canary",
      diffPath: `/nonexistent/${marker}/observed.diff`,
      artifactPathForId: (artifactId) =>
        `/nonexistent/${marker}/artifacts/${artifactId}`,
      cwd: `/nonexistent/${marker}/cwd`,
    });

    const result = await executePreflightRequest(request, {});
    const decoded = decodeStrictSync(PromptPreflightResultV1, result);

    expect(decoded._tag).toBe("failure");
    if (decoded._tag !== "failure") {
      throw new Error("expected failure");
    }
    expect(decoded.failure.stage).toBe("dispatch");
    expect(decoded.failure.reason).toBe(
      "Gemini provider canary adapter is not implemented",
    );
    expect(decoded.terminal).toBeNull();
    assertSanitizedResult(decoded, marker);
  });

  it("returns a prompt failure when observed base SHA mismatches", async () => {
    const marker = SECRET_MARKER;
    const otherBase = "c".repeat(40);

    const request = buildValidRequest({
      family: "xai",
      executable: process.execPath,
      baseSha: otherBase,
      diffPath: `/nonexistent/${marker}/base-mismatch.diff`,
      artifactPathForId: (artifactId) =>
        `/nonexistent/${marker}/artifacts/${artifactId}`,
      cwd: process.cwd(),
    });
    expect(request.observedBundle.baseSha).not.toBe(
      request.contract.bundle.baseSha,
    );

    const result = await executePreflightRequest(request, PATH_SAFE_ENV);
    const decoded = decodeStrictSync(PromptPreflightResultV1, result);

    expect(decoded._tag).toBe("failure");
    if (decoded._tag !== "failure") {
      throw new Error("expected failure");
    }
    expect(decoded.failure.stage).toBe("prompt");
    expect(decoded.terminal).toBeNull();
    assertSanitizedResult(decoded, marker);
  });

  it("returns a prompt failure when the observed diff path is missing", async () => {
    const marker = SECRET_MARKER;
    const request = buildValidRequest({
      family: "xai",
      executable: process.execPath,
      diffPath: `/nonexistent/${marker}/missing-observed.diff`,
      artifactPathForId: (artifactId) =>
        `/nonexistent/${marker}/artifacts/${artifactId}`,
      cwd: process.cwd(),
    });

    const result = await executePreflightRequest(request, PATH_SAFE_ENV);
    const decoded = decodeStrictSync(PromptPreflightResultV1, result);

    expect(decoded._tag).toBe("failure");
    if (decoded._tag !== "failure") {
      throw new Error("expected failure");
    }
    expect(decoded.failure.stage).toBe("prompt");
    expect(decoded.terminal).toBeNull();
    assertSanitizedResult(decoded, marker);
  });

  it("verifies the observed diff then fails at artifact compilation", async () => {
    const marker = SECRET_MARKER;
    const root = await mkdtemp(join(tmpdir(), "council-preflight-"));
    try {
      const diffPath = join(root, "observed.diff");
      await writeFile(diffPath, diffBytes);

      const request = buildValidRequest({
        family: "xai",
        executable: process.execPath,
        diffPath,
        artifactPathForId: (artifactId) =>
          join(root, "missing-artifacts", marker, artifactId),
        cwd: process.cwd(),
      });

      const result = await executePreflightRequest(request, PATH_SAFE_ENV);
      const decoded = decodeStrictSync(PromptPreflightResultV1, result);

      expect(decoded._tag).toBe("failure");
      if (decoded._tag !== "failure") {
        throw new Error("expected failure");
      }
      expect(decoded.failure.stage).toBe("prompt");
      expect(decoded.terminal).toBeNull();
      assertSanitizedResult(decoded, marker);
      expect(JSON.stringify(decoded)).not.toContain(diffPath);
      expect(JSON.stringify(decoded)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a prompt failure for an oversized observed diff", async () => {
    const marker = SECRET_MARKER;
    const root = await mkdtemp(join(tmpdir(), "council-preflight-oversize-"));
    try {
      const contract = makeContract();
      const { maxArtifactBytes } = contractLimits(contract);
      const oversized = new Uint8Array(maxArtifactBytes + 1);
      oversized.fill(0x61);
      const diffPath = join(root, `${marker}-oversized.diff`);
      await writeFile(diffPath, oversized);

      const request = buildValidRequest({
        family: "xai",
        executable: process.execPath,
        diffPath,
        artifactPathForId: (artifactId) =>
          join(root, "artifacts", marker, artifactId),
        cwd: process.cwd(),
      });

      const result = await executePreflightRequest(request, PATH_SAFE_ENV);
      const decoded = decodeStrictSync(PromptPreflightResultV1, result);

      expect(decoded._tag).toBe("failure");
      if (decoded._tag !== "failure") {
        throw new Error("expected failure");
      }
      expect(decoded.failure.stage).toBe("prompt");
      expect(decoded.terminal).toBeNull();
      assertSanitizedResult(decoded, marker);
      expect(JSON.stringify(decoded)).not.toContain(diffPath);
      expect(JSON.stringify(decoded)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
