import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, normalize } from "node:path";
import { Effect, Redacted, Stream } from "effect";
import type { Scope } from "effect";
import type { PelDataSchemaV1 } from "@foreman/pel";
import type {
  CredentialMaterialV1,
  ProviderTransport,
  ProviderRequestV1,
  ProviderIdentityV1,
  ProviderEventV1,
  ProviderEventPayloadV1,
  RemoteObservationV1,
} from "../contract.js";
import type { ProviderFailure } from "../errors.js";
import {
  controlsHash,
  validateProfileControls,
  resolveProfile,
} from "../profiles.js";
import {
  lowerProviderSchema,
  providerSchemaSubset,
  decodeProviderResult,
} from "../output.js";
import { validateNativeHost } from "./native-host.js";
import type { NativeHostPort } from "./native-host.js";
import { createNativeProcessPort } from "./native-process.js";
import type { NativeConnectionV1 } from "./native-process.js";
import { apiFailure } from "./api-http.js";
import { object, string, usage } from "./api-protocol.js";

export interface GeminiConfigurationV1 {
  readonly settingsPath: string;
  readonly defaultsPath: string;
  readonly adminPolicyPath: string;
  readonly configDirectory: string;
  readonly settingsSha256: string;
  readonly defaultsSha256: string;
  readonly policySha256: string;
  readonly controlsHash: string;
  /** The host ensures installed system policies cannot suppress --admin-policy and that the configuration paths are immutable during dispatch. */
  readonly systemPoliciesIsolated: boolean;
}
export interface GeminiCliOptions {
  readonly credentials: {
    readonly resolve: (
      ref: string,
    ) => Effect.Effect<CredentialMaterialV1, ProviderFailure, Scope.Scope>;
  };
  readonly host?: NativeHostPort;
  readonly configuration?: GeminiConfigurationV1;
  readonly executable?: string;
  readonly protocolVersion?: string;
  readonly schemaRegistry?: Readonly<Record<string, PelDataSchemaV1>>;
}
const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
/** The host writes these exact files to an isolated immutable scope before invoking start. No credential bytes occur here. */
export function geminiConfigurationFiles(request: ProviderRequestV1): {
  readonly settings: string;
  readonly defaults: string;
  readonly policy: string;
} {
  const generation = {
    thinkingConfig: { thinkingLevel: request.controls.effort.toUpperCase() },
    maxOutputTokens: request.limits.maxOutputTokens,
    ...(request.controls.sampling.temperature === undefined
      ? {}
      : { temperature: request.controls.sampling.temperature }),
    ...(request.controls.sampling.topP === undefined
      ? {}
      : { topP: request.controls.sampling.topP }),
    ...(request.controls.sampling.topK === undefined
      ? {}
      : { topK: request.controls.sampling.topK }),
  };
  return {
    settings: JSON.stringify({
      hooksConfig: { enabled: false },
      admin: {
        secureModeEnabled: true,
        extensions: { enabled: false },
        mcp: { enabled: false },
        skills: { enabled: false },
      },
      context: { fileName: [] },
      modelConfigs: {
        aliases: {
          [request.profileId]: {
            modelConfig: {
              model: request.profileId,
              generateContentConfig: generation,
            },
          },
        },
      },
    }),
    defaults: "{}",
    policy: '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n',
  };
}
const unwrap = <T>(
  v: { ok: true; value: T } | { ok: false; error: ProviderFailure },
) => (v.ok ? Effect.succeed(v.value) : Effect.fail(v.error));
export function createGeminiCliTransport(
  options: GeminiCliOptions,
): ProviderTransport {
  const version = "1";
  const protocolVersion = options.protocolVersion ?? "unknown";
  const active = new Map<string, NativeConnectionV1>();
  const observed = new Map<string, RemoteObservationV1>();
  const key = (i: ProviderIdentityV1) => JSON.stringify(i);
  const valid = (i: ProviderIdentityV1) =>
    i.kind === "native" &&
    i.provider === "google" &&
    i.profileId === "gemini-3.8-flash" &&
    i.transportId === "gemini-cli" &&
    i.protocolVersion === protocolVersion;
  const start: ProviderTransport["start"] = (request) =>
    Effect.gen(function* () {
      const profile = yield* unwrap(resolveProfile(request.profileId));
      if (
        request.transportVersion !== version ||
        request.profileHash !== profile.profileHash ||
        request.sourceManifestHash !== profile.sourceManifestHash
      )
        return yield* Effect.fail(
          apiFailure(
            "ModelMismatch",
            "Gemini request has a stale profile, source or transport binding",
          ),
        );
      if (
        request.profileId !== "gemini-3.8-flash" ||
        request.transportId !== "gemini-cli"
      )
        return yield* Effect.fail(
          apiFailure(
            "ModelMismatch",
            "Gemini CLI requires the exact gemini-3.8-flash profile",
          ),
        );
      if (request.toolPolicy.mode !== "none")
        return yield* Effect.fail(
          apiFailure(
            "UnsupportedCapability",
            "Gemini headless has no admitted bidirectional host permission exchange",
            "toolPolicy",
          ),
        );
      if (request.continuation)
        return yield* Effect.fail(
          apiFailure(
            "ResumeUnavailable",
            "Gemini headless cannot replay an interrupted turn",
          ),
        );
      if (request.generation?.resolvedGrammarMode === "grammar")
        return yield* Effect.fail(
          apiFailure(
            "UnsupportedCapability",
            "Gemini CLI has no Pel grammar constraint",
            "generation.resolvedGrammarMode",
          ),
        );
      yield* unwrap(
        validateProfileControls(
          request.profileId,
          request.controls,
          "gemini-cli",
        ),
      );
      const host = yield* unwrap(validateNativeHost(request, options.host));
      const configuration = options.configuration;
      if (
        !configuration ||
        !configuration.systemPoliciesIsolated ||
        configuration.controlsHash !== controlsHash(request.controls) ||
        protocolVersion === "unknown"
      )
        return yield* Effect.fail(
          apiFailure(
            "CapabilityUnverified",
            "Gemini requires versioned isolated configuration with an exact controls binding",
            "configuration",
          ),
        );
      const expected = geminiConfigurationFiles(request);
      for (const [path, digest, content] of [
        [
          configuration.settingsPath,
          configuration.settingsSha256,
          expected.settings,
        ],
        [
          configuration.defaultsPath,
          configuration.defaultsSha256,
          expected.defaults,
        ],
        [
          configuration.adminPolicyPath,
          configuration.policySha256,
          expected.policy,
        ],
      ]) {
        if (!path || !path.startsWith("/") || !digest || !content)
          return yield* Effect.fail(
            apiFailure(
              "CapabilityUnverified",
              "Gemini configuration requires absolute immutable files",
              "configuration",
            ),
          );
        const bytes = yield* Effect.tryPromise({
          try: () => readFile(path),
          catch: () =>
            apiFailure(
              "CapabilityUnverified",
              "Gemini configuration file cannot be read",
              "configuration",
            ),
        });
        if (
          bytes.length > 1024 * 1024 ||
          sha(bytes) !== digest ||
          bytes.toString("utf8") !== content
        )
          return yield* Effect.fail(
            apiFailure(
              "CapabilityUnverified",
              "Gemini configuration content does not match the admitted controls and restrictions",
              "configuration",
            ),
          );
      }
      const lowered = yield* unwrap(
        lowerProviderSchema(
          request.outputSchema,
          providerSchemaSubset("gemini-cli"),
          options.schemaRegistry,
        ),
      );
      for (const a of request.artifacts)
        if (a.content === undefined)
          return yield* Effect.fail(
            apiFailure(
              "UnsupportedCapability",
              "Host must resolve artifact content before native dispatch",
              "artifacts.content",
            ),
          );
      const material = yield* options.credentials.resolve(
        request.credentialProfileRef,
      );
      const environment: Record<string, string> = { ...host.environment };
      for (const [name, value] of Object.entries(material.environment ?? {}))
        environment[name] = Redacted.value(value);
      if (
        !Object.keys(material.environment ?? {}).length &&
        !material.nativeProfileDirectory
      )
        return yield* Effect.fail(
          apiFailure(
            "AuthenticationRequired",
            "Gemini requires the selected environment or native credential profile",
          ),
        );
      if (
        material.nativeProfileDirectory &&
        (!isAbsolute(material.nativeProfileDirectory) ||
          normalize(material.nativeProfileDirectory) !==
            material.nativeProfileDirectory ||
          basename(material.nativeProfileDirectory) !== ".gemini")
      )
        return yield* Effect.fail(
          apiFailure(
            "AuthenticationRequired",
            "Gemini native credentials must select a canonical .gemini directory",
          ),
        );
      // Gemini core appends .gemini to this home override when locating OAuth state.
      environment.GEMINI_CLI_HOME = material.nativeProfileDirectory
        ? dirname(material.nativeProfileDirectory)
        : configuration.configDirectory;
      environment.GEMINI_CLI_SYSTEM_SETTINGS_PATH = configuration.settingsPath;
      environment.GEMINI_CLI_SYSTEM_DEFAULTS_PATH = configuration.defaultsPath;
      environment.GEMINI_CLI_NO_RELAUNCH = "1";
      const prompt =
        request.trustedInstructions +
        "\n\nReturn only JSON matching this output schema:\n" +
        JSON.stringify(lowered.jsonSchema) +
        "\n\nInput artifacts:\n" +
        JSON.stringify(request.artifacts);
      const connection = yield* (
        host.process ?? createNativeProcessPort()
      ).open({
        cmd: [
          options.executable ?? "gemini",
          "--model",
          request.profileId,
          "--output-format",
          "stream-json",
          "--approval-mode",
          "default",
          "--admin-policy",
          configuration.adminPolicyPath,
          "--extensions",
          "none",
          "--prompt",
          "",
        ],
        cwd: host.cwd,
        environment,
        deadline: request.limits.deadline,
        maxOutputBytes: Math.min(
          64 * 1024 * 1024,
          request.limits.maxOutputBytes + 1024 * 1024,
        ),
        initialInput: Buffer.from(prompt),
        closeInput: true,
      });
      let identity: ProviderIdentityV1 | undefined;
      let text = "";
      let terminal = false;
      let sequence = 0;
      yield* Effect.addFinalizer(() =>
        connection.close().pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (identity) active.delete(key(identity));
            }),
          ),
        ),
      );
      const emit = (
        payload: ProviderEventPayloadV1,
        event: Readonly<Record<string, unknown>>,
      ): ProviderEventV1 => ({
        schemaVersion: 1,
        effectId: request.effectId,
        providerIdentity: identity!,
        ...(typeof event.event_id === "string"
          ? { sourceEventId: event.event_id }
          : {}),
        cursor: String(sequence),
        payload,
      });
      const stream = connection.events.pipe(
        Stream.mapEffect((event) =>
          Effect.gen(function* () {
            sequence++;
            if (terminal)
              return yield* Effect.fail(
                apiFailure(
                  "MalformedEvent",
                  "Gemini emitted an event after its terminal result",
                ),
              );
            if (event.type === "init") {
              if (
                identity ||
                event.model !== request.profileId ||
                !string(event.session_id)
              )
                return yield* Effect.fail(
                  apiFailure(
                    "ModelMismatch",
                    "Gemini initialization did not confirm the exact model and session",
                  ),
                );
              identity = {
                kind: "native",
                provider: "google",
                profileId: request.profileId,
                model: request.profileId,
                transportId: "gemini-cli",
                credentialProfileRef: request.credentialProfileRef,
                protocolVersion,
                sessionId: string(event.session_id),
              };
              active.set(key(identity), connection);
              return [emit({ type: "started" }, event)];
            }
            if (!identity)
              return yield* Effect.fail(
                apiFailure(
                  "MalformedEvent",
                  "Gemini event arrived before exact session identity",
                ),
              );
            if (event.type === "tool_use" || event.type === "tool_result")
              return yield* Effect.fail(
                apiFailure(
                  "UnsupportedCapability",
                  "Gemini attempted a tool exchange under toolPolicy none",
                  "toolPolicy",
                ),
              );
            if (
              event.type === "message" &&
              event.role === "assistant" &&
              event.thought !== true
            ) {
              const delta = string(event.content);
              text += delta;
              if (Buffer.byteLength(text) > request.limits.maxOutputBytes)
                return yield* Effect.fail(
                  apiFailure(
                    "OutputIncomplete",
                    "Gemini output exceeded its admitted byte bound",
                  ),
                );
              return [emit({ type: "text", text: delta }, event)];
            }
            if (event.type === "error")
              return yield* Effect.fail(
                apiFailure(
                  "OutcomeUnknown",
                  "Gemini reported a protocol or provider error",
                ),
              );
            if (event.type === "result") {
              terminal = true;
              active.delete(key(identity));
              if (event.status !== "success")
                return yield* Effect.fail(
                  apiFailure(
                    "OutcomeUnknown",
                    "Gemini did not report a successful terminal turn",
                  ),
                );
              const stats = object(event.stats);
              const models = Object.keys(object(stats.models));
              if (models.length !== 1 || models[0] !== request.profileId)
                return yield* Effect.fail(
                  apiFailure(
                    "ModelMismatch",
                    "Gemini per-model usage does not confirm exclusive use of the exact requested model",
                  ),
                );
              const result = yield* unwrap(
                decodeProviderResult(
                  text,
                  request.outputSchema,
                  request.limits.maxOutputBytes,
                ),
              );
              const accounting = usage({
                ...stats,
                input_tokens_details: { cached_tokens: stats.cached },
              });
              observed.set(key(identity), {
                status: "completed",
                providerIdentity: identity,
                cursor: String(sequence),
                result,
              });
              return [
                emit({ type: "usage", usage: accounting }, event),
                emit({ type: "completed", result, usage: accounting }, event),
              ];
            }
            return [];
          }),
        ),
        Stream.flatMap(Stream.fromIterable),
      );
      return Stream.concat(
        stream,
        Stream.fromEffect(
          Effect.suspend(() =>
            terminal
              ? Effect.void
              : Effect.fail(
                  apiFailure(
                    "OutcomeUnknown",
                    "Gemini stream closed before a terminal result",
                  ),
                ),
          ),
        ).pipe(Stream.drain),
      );
    });
  return {
    id: "gemini-cli",
    version,
    ...(options.protocolVersion ? { installedVersion: protocolVersion } : {}),
    start,
    probe: (input) =>
      input.profileId !== "gemini-3.8-flash" ||
      input.transportId !== "gemini-cli"
        ? Effect.fail({
            _tag: "ModelMismatch",
            retryClass: "never",
            message: "Probe requires exact Gemini profile and transport",
          })
        : Effect.succeed({
            schemaVersion: 1,
            profileId: input.profileId,
            transportId: "gemini-cli",
            checkedAt: Date.now(),
            mode: input.mode,
            discovery: {
              state: "unknown",
              ...(options.protocolVersion
                ? { installedVersion: options.protocolVersion }
                : {}),
            },
            authentication: { state: "unknown" },
            currency: { state: "unknown" },
            identity: { state: "unknown" },
            capabilities: [],
          }),
    sendToolResult: () =>
      Effect.fail(
        apiFailure(
          "UnsupportedCapability",
          "Gemini headless has no admitted host tool-result exchange",
        ),
      ),
    cancel: (identity) =>
      Effect.gen(function* () {
        if (!valid(identity))
          return yield* Effect.fail(
            apiFailure(
              "ContinuationMismatch",
              "Identity does not match the Gemini CLI transport",
            ),
          );
        const connection = active.get(key(identity));
        if (connection) yield* connection.close();
        active.delete(key(identity));
        return {
          requested: true,
          acknowledged: false,
          localCleanup: connection ? "complete" : "not-required",
          remoteOutcome: "unknown",
        };
      }),
    observe: (identity) =>
      valid(identity)
        ? Effect.succeed(
            observed.get(key(identity)) ?? {
              status: "unsupported",
              providerIdentity: identity,
              reason:
                "Gemini headless has no read-only remote turn observation protocol",
            },
          )
        : Effect.fail(
            apiFailure(
              "ContinuationMismatch",
              "Identity does not match Gemini CLI",
            ),
          ),
    resume: () =>
      Effect.fail(
        apiFailure(
          "ResumeUnavailable",
          "Gemini --resume starts another model turn; it is not cursor replay",
        ),
      ),
  };
}
