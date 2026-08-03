/**
 * Red TDD tests for preflight-program runtime helpers.
 * No live provider process spawn.
 */
import type {
  ProviderProcessObservation,
  ProviderProcessRequest,
  ProviderProcessRunnerService,
} from "@council/application";
import {
  PreflightIdentityError,
  ProviderProcessError,
  ProviderVersionProbeError,
} from "@council/application";
import type { Sha256Digest, UtcTimestamp } from "@council/schema";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  CHILD_ENV_NAMES,
  buildChildEnvironment,
  createPreflightIdentitySource,
  createProviderVersionProbe,
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
) =>
  createProviderVersionProbe(runner).resolve(executable, cwd, environment);

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
