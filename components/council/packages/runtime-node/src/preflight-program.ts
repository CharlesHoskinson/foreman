import { randomBytes } from "node:crypto";
import {
  BundleVerificationError,
  BundleVerifier,
  CanaryMaterializer,
  CanaryMaterializerError,
  PreflightIdentityError,
  PreflightIdentitySource,
  ProviderProcessError,
  ProviderSchemaLowererLive,
  ProviderVersionProbe,
  ProviderVersionProbeError,
  runPromptPreflight,
  type BundleVerifierService,
  type CanaryMaterializerService,
  type PreflightIdentitySourceService,
  type ProviderProcessRunnerService,
  type ProviderVersionProbeService,
} from "@council/application";
import {
  buildCanaryMaterial,
  createFilesystemArtifactReader,
  filesystemArtifactReaderLayer,
  materializeCanaryPromptFile,
  materializeCanarySchemaFile,
  NodeDigestLive,
  NodePromptMaterializerLive,
  NodeProviderProcessRunner,
  NodeProviderProcessRunnerLive,
  sha256Hex,
} from "@council/platform-node";
import {
  type PreflightCliRequestV1,
  type PromptPreflightResultV1,
  PromptPreflightResultV1 as PromptPreflightResultV1Schema,
  UtcTimestamp,
  decodeStrictSync,
} from "@council/schema";
import { Effect, Layer } from "effect";
import { selectProvider } from "./provider-selection.js";

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

const mapRunnerError = (
  error: ProviderProcessError,
): ProviderVersionProbeError => {
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

export type CanaryTransportOps = {
  readonly build: typeof buildCanaryMaterial;
  readonly promptFile: typeof materializeCanaryPromptFile;
  readonly schemaFile: typeof materializeCanarySchemaFile;
};

const defaultCanaryTransportOps: CanaryTransportOps = {
  build: buildCanaryMaterial,
  promptFile: materializeCanaryPromptFile,
  schemaFile: materializeCanarySchemaFile,
};

const prepareFailedError = () =>
  new CanaryMaterializerError({
    category: "prepare_failed",
    reason: "provider canary material preparation failed",
  });

export const createCanaryMaterializer = (
  ops: CanaryTransportOps = defaultCanaryTransportOps,
): CanaryMaterializerService => ({
  prepare: (challenge, providerFamily) => {
    if (providerFamily === "google") {
      return Effect.fail(
        new CanaryMaterializerError({
          category: "unsupported_family",
          reason: "Gemini provider canary materialization is not implemented",
        }),
      );
    }

    return Effect.gen(function* () {
      const material = yield* Effect.try({
        try: () => ops.build(challenge),
        catch: () => prepareFailedError(),
      });

      switch (providerFamily) {
        case "anthropic":
          return {
            prompt: {
              kind: "stdin" as const,
              bytes: material.promptBytes,
            },
            schema: {
              kind: "inline" as const,
              json: material.schemaJson,
            },
            canarySchemaVariantHash: material.canarySchemaVariantHash,
          };
        case "xai": {
          const path = yield* ops.promptFile(material.promptBytes);
          return {
            prompt: {
              kind: "file" as const,
              path,
            },
            schema: {
              kind: "inline" as const,
              json: material.schemaJson,
            },
            canarySchemaVariantHash: material.canarySchemaVariantHash,
          };
        }
        case "openai": {
          const path = yield* ops.schemaFile(material.schemaJson);
          return {
            prompt: {
              kind: "stdin" as const,
              bytes: material.promptBytes,
            },
            schema: {
              kind: "file" as const,
              path,
            },
            canarySchemaVariantHash: material.canarySchemaVariantHash,
          };
        }
      }
    }).pipe(Effect.mapError(() => prepareFailedError()));
  },
});

export const NodeCanaryMaterializerLive = Layer.succeed(
  CanaryMaterializer,
  createCanaryMaterializer(),
);

export const CANARY_STDOUT_MAX_BYTES = 1_048_576;
export const CANARY_STDERR_MAX_BYTES = 65_536;

const createObservedBundleVerifier = (
  request: PreflightCliRequestV1,
): BundleVerifierService => ({
  verify: (bundle) =>
    Effect.gen(function* () {
      if (bundle.baseSha !== request.observedBundle.baseSha) {
        return yield* Effect.fail(
          new BundleVerificationError({
            stage: "bundle_verify",
            reason: "baseSha mismatch",
            field: "baseSha",
          }),
        );
      }
      if (bundle.headSha !== request.observedBundle.headSha) {
        return yield* Effect.fail(
          new BundleVerificationError({
            stage: "bundle_verify",
            reason: "headSha mismatch",
            field: "headSha",
          }),
        );
      }

      const expectedArtifactId = `sha256:${bundle.diffSha256}`;
      const matches = request.contract.artifacts.filter(
        (artifact) => artifact.artifactId === expectedArtifactId,
      );
      const descriptor = matches[0];
      if (matches.length !== 1 || descriptor === undefined) {
        return yield* Effect.fail(
          new BundleVerificationError({
            stage: "bundle_verify",
            reason: "observed bundle diff artifact identity is not unique",
            field: "bundle",
          }),
        );
      }

      const reader = createFilesystemArtifactReader(
        new Map([[descriptor.artifactId, request.observedBundle.diffPath]]),
      );
      const readResult = yield* reader
        .read({
          descriptor,
          maxBytes: request.contract.limits.maxArtifactBytes,
        })
        .pipe(Effect.either);
      if (readResult._tag === "Left") {
        return yield* Effect.fail(
          new BundleVerificationError({
            stage: "bundle_verify",
            reason: "observed bundle diff could not be read within its bound",
            field: "bundle",
          }),
        );
      }

      const bytes = readResult.right;
      if (
        bytes.byteLength !== descriptor.byteLength ||
        sha256Hex(bytes) !== bundle.diffSha256
      ) {
        return yield* Effect.fail(
          new BundleVerificationError({
            stage: "bundle_verify",
            reason: "observed bundle diff identity does not match the contract",
            field: "diffSha256",
          }),
        );
      }
    }),
});

export const executePreflightRequest = (
  request: PreflightCliRequestV1,
  environmentSource: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PromptPreflightResultV1> => {
  const selection = selectProvider(request.provider.family);
  if (selection._tag === "unavailable") {
    return Promise.resolve(
      decodeStrictSync(PromptPreflightResultV1Schema, {
        _tag: "failure",
        schemaVersion: 1,
        failure: {
          stage: "dispatch",
          reason: selection.reason,
          retry: "changed_preflight",
        },
        terminal: null,
      }),
    );
  }

  const compilationArtifactLayer = filesystemArtifactReaderLayer(
    new Map(request.artifactPaths.map((item) => [item.artifactId, item.path])),
  );
  const observedVerifier = createObservedBundleVerifier(request);
  const environment = buildChildEnvironment(environmentSource);

  const layer = Layer.mergeAll(
    compilationArtifactLayer,
    Layer.succeed(BundleVerifier, observedVerifier),
    NodeDigestLive,
    NodePromptMaterializerLive,
    ProviderSchemaLowererLive,
    NodePreflightIdentitySourceLive,
    NodeCanaryMaterializerLive,
    NodeProviderVersionProbeLive,
    NodeProviderProcessRunnerLive,
    selection.layer,
  );

  return Effect.runPromise(
    runPromptPreflight({
      contract: request.contract,
      providerFamily: selection.family,
      executable: request.provider.executable,
      model: request.provider.model,
      cwd: request.cwd,
      environment,
      timeoutMs: request.contract.limits.maxWallTimeMs,
      stdoutMaxBytes: CANARY_STDOUT_MAX_BYTES,
      stderrMaxBytes: CANARY_STDERR_MAX_BYTES,
    }).pipe(Effect.provide(layer)),
  );
};
