import { randomBytes } from "node:crypto";
import {
  PreflightIdentityError,
  PreflightIdentitySource,
  ProviderProcessError,
  ProviderVersionProbe,
  ProviderVersionProbeError,
  type PreflightIdentitySourceService,
  type ProviderProcessRunnerService,
  type ProviderVersionProbeService,
} from "@council/application";
import { NodeProviderProcessRunner } from "@council/platform-node";
import { UtcTimestamp, decodeStrictSync } from "@council/schema";
import { Effect, Layer } from "effect";

export const CHILD_ENV_NAMES = [
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
] as const;

export const buildChildEnvironment = (
  source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> => {
  const result: Record<string, string> = {};
  for (const name of CHILD_ENV_NAMES) {
    const value = source[name];
    if (typeof value === "string") {
      result[name] = value;
    }
  }
  return result;
};

const invalidOutputError = () =>
  new ProviderVersionProbeError({
    category: "invalid_output",
    reason: "provider CLI version probe returned invalid output",
  });

const mapRunnerError = (error: ProviderProcessError): ProviderVersionProbeError => {
  if (error.category === "start_failed") {
    return new ProviderVersionProbeError({
      category: "start_failed",
      reason: "provider CLI version probe failed to start",
    });
  }
  return new ProviderVersionProbeError({
    category: "internal",
    reason: "provider CLI version probe failed internally",
  });
};

const decodeVersionLine = (
  bytes: Uint8Array,
): Effect.Effect<string, ProviderVersionProbeError> =>
  Effect.try({
    try: () => {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const text = decoder.decode(bytes);
      const firstLine = text.split("\n")[0] ?? "";
      const trimmed = firstLine.trim();
      if (trimmed.length === 0) {
        throw new Error("blank");
      }
      return trimmed;
    },
    catch: () => invalidOutputError(),
  });

export const createProviderVersionProbe = (
  runner: ProviderProcessRunnerService,
): ProviderVersionProbeService => ({
  resolve: (executable, cwd, environment) =>
    runner
      .run({
        executable,
        args: ["--version"],
        cwd,
        environment,
        timeoutMs: 5000,
        stdoutMaxBytes: 4096,
        stderrMaxBytes: 4096,
        stdin: null,
      })
      .pipe(
        Effect.mapError((error) =>
          error instanceof ProviderProcessError
            ? mapRunnerError(error)
            : new ProviderVersionProbeError({
                category: "internal",
                reason: "provider CLI version probe failed internally",
              }),
        ),
        Effect.flatMap((observation) => {
          if (observation.timedOut) {
            return Effect.fail(
              new ProviderVersionProbeError({
                category: "timeout",
                reason: "provider CLI version probe timed out",
              }),
            );
          }
          if (
            !observation.started ||
            observation.exitCode !== 0 ||
            observation.signal !== null ||
            !observation.stdout.sourceUtf8Valid ||
            observation.stdout.truncated
          ) {
            // Never include stdout in the error — reason is static only.
            return Effect.fail(invalidOutputError());
          }
          return decodeVersionLine(observation.stdout.bytes);
        }),
      ),
});

export type PreflightIdentityOps = {
  readonly nonce: () => string;
  readonly now: () => Date;
};

const defaultIdentityOps: PreflightIdentityOps = {
  nonce: () => randomBytes(32).toString("hex"),
  now: () => new Date(),
};

export const createPreflightIdentitySource = (
  ops: PreflightIdentityOps = defaultIdentityOps,
): PreflightIdentitySourceService => ({
  nonce: Effect.try({
    try: () => {
      const value = ops.nonce();
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("empty");
      }
      return value;
    },
    catch: () =>
      new PreflightIdentityError({
        category: "nonce_failed",
        reason: "preflight nonce generation failed",
      }),
  }),
  now: Effect.try({
    try: () => {
      const value = ops.now().toISOString();
      return decodeStrictSync(UtcTimestamp, value);
    },
    catch: () =>
      new PreflightIdentityError({
        category: "clock_failed",
        reason: "preflight clock source failed",
      }),
  }),
});

export const NodeProviderVersionProbeLive = Layer.succeed(
  ProviderVersionProbe,
  createProviderVersionProbe(NodeProviderProcessRunner),
);

export const NodePreflightIdentitySourceLive = Layer.succeed(
  PreflightIdentitySource,
  createPreflightIdentitySource(),
);
