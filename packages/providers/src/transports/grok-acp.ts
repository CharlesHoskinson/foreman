import { isAbsolute, resolve } from "node:path";
import { Deferred, Effect, Queue, Redacted, Stream } from "effect";
import type { Scope } from "effect";
import type { JsonValue, PelDataSchemaV1 } from "@foreman/pel";
import { canonicalize } from "@foreman/core";
import type {
  CredentialPort,
  ProviderEventV1,
  ProviderEventPayloadV1,
  ProviderIdentityV1,
  ProviderRequestV1,
  ProviderTransport,
  RemoteObservationV1,
  ToolRequestV1,
} from "../contract.js";
import type { ProviderFailure } from "../errors.js";
import { resolveProfile, validateProfileControls } from "../profiles.js";
import {
  decodeProviderResult,
  lowerProviderSchema,
  providerSchemaSubset,
} from "../output.js";
import {
  createNativeProcessPort,
  type NativeProcessPort,
  type NativeConnectionV1,
} from "./native-process.js";
import { validateNativeHost, type NativeHostPort } from "./native-host.js";
export interface GrokAcpOptions {
  readonly credentials: typeof CredentialPort.Service;
  readonly process?: NativeProcessPort;
  readonly host?: NativeHostPort;
  readonly executable?: string;
  readonly version?: string;
  readonly installedVersion?: string;
  readonly now?: () => number;
  readonly schemaRegistry?: Readonly<Record<string, PelDataSchemaV1>>;
}
type RecordValue = Readonly<Record<string, unknown>>;
type Item =
  | { readonly type: "event"; readonly event: ProviderEventV1 }
  | { readonly type: "failure"; readonly failure: ProviderFailure }
  | { readonly type: "end" };
interface Session {
  readonly identity: ProviderIdentityV1;
  readonly connection: NativeConnectionV1;
  readonly request: ProviderRequestV1;
  readonly queue: Queue.Queue<Item>;
  readonly pendingPermissions: Set<number>;
  observation: RemoteObservationV1;
  cancelRequested: boolean;
  closed: boolean;
}
const record = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const problem = (
  tag:
    | "UnsupportedCapability"
    | "ModelMismatch"
    | "ModelUnavailable"
    | "ProbeUnknown"
    | "MalformedEvent"
    | "OutcomeUnknown"
    | "OutputIncomplete"
    | "ResumeUnavailable"
    | "AuthenticationRequired",
  fieldPath: string,
): ProviderFailure => ({
  _tag: tag,
  retryClass: "never",
  fieldPath,
  message: `Grok ACP cannot establish ${fieldPath}`,
});
function observedModel(value: RecordValue): string | undefined {
  const options = value.configOptions;
  if (Array.isArray(options)) {
    const model = options.find((v) => record(v) && v.category === "model");
    if (record(model) && typeof model.currentValue === "string")
      return model.currentValue;
  }
  if (record(value.models) && typeof value.models.currentModelId === "string")
    return value.models.currentModelId;
  return undefined;
}
function jsonValue(value: unknown, depth = 0): value is JsonValue {
  return (
    depth <= 64 &&
    (value === null ||
      typeof value === "boolean" ||
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value)) ||
      (Array.isArray(value) && value.every((v) => jsonValue(v, depth + 1))) ||
      (record(value) &&
        Object.values(value).every((v) => jsonValue(v, depth + 1))))
  );
}
/** Grok ACP JSON-RPC. The host, not an ACP permission hint, supplies the enforced execution boundary. */
export function createGrokAcpTransport(
  options: GrokAcpOptions,
): ProviderTransport {
  const now = options.now ?? Date.now;
  const version = options.version ?? "1";
  let installedVersion =
    options.installedVersion ??
    (/^\d+\.\d+\.\d+/.test(version) ? version : undefined);
  const sessions = new Map<string, Session>();
  const key = (identity: ProviderIdentityV1) => canonicalize(identity);
  const unsupported = (field: string) =>
    Effect.fail(problem("UnsupportedCapability", field));
  const start = (
    request: ProviderRequestV1,
  ): Effect.Effect<
    Stream.Stream<ProviderEventV1, ProviderFailure>,
    ProviderFailure,
    Scope.Scope
  > =>
    Effect.gen(function* () {
      if (request.continuation !== undefined)
        return yield* Effect.fail(
          problem(
            "ResumeUnavailable",
            "qualified ACP continuation and cursor replay",
          ),
        );
      const profile = resolveProfile(request.profileId);
      if (!profile.ok) return yield* Effect.fail(profile.error);
      if (
        request.transportId !== "grok-acp" ||
        request.profileId !== "grok-4.6" ||
        request.transportVersion !== version ||
        request.profileHash !== profile.value.profileHash ||
        request.sourceManifestHash !== profile.value.sourceManifestHash
      )
        return yield* Effect.fail(
          problem("ModelUnavailable", "profileId/transportId/version"),
        );
      const controls = validateProfileControls(
        request.profileId,
        request.controls,
        "grok-acp",
      );
      if (!controls.ok) return yield* Effect.fail(controls.error);
      if (
        request.controls.thinking.mode !== "provider-default" ||
        request.controls.thinking.budgetTokens !== undefined ||
        Object.keys(request.controls.sampling).length ||
        request.controls.toolChoice === "required" ||
        typeof request.controls.toolChoice === "object"
      )
        return yield* unsupported("controls");
      if (request.generation?.resolvedGrammarMode === "grammar")
        return yield* unsupported("generation.grammar");
      const boundary = validateNativeHost(request, options.host);
      if (!boundary.ok) return yield* Effect.fail(boundary.error);
      const host = boundary.value;
      if (
        !request.credentialProfileRef ||
        !request.effectId ||
        !Number.isFinite(request.limits.deadline) ||
        request.limits.deadline <= now() ||
        !Number.isSafeInteger(request.limits.maxOutputBytes) ||
        request.limits.maxOutputBytes < 1 ||
        request.limits.maxOutputBytes > 8388608 ||
        !Number.isSafeInteger(request.limits.maxToolCalls) ||
        request.limits.maxToolCalls < 0 ||
        !Number.isSafeInteger(request.limits.maxInputTokens) ||
        request.limits.maxInputTokens < 1 ||
        !Number.isSafeInteger(request.limits.maxOutputTokens) ||
        request.limits.maxOutputTokens < 1 ||
        !Number.isFinite(request.limits.maxCostUsd) ||
        request.limits.maxCostUsd < 0 ||
        !request.limits.spendReservationRef
      )
        return yield* unsupported("limits");
      if (Buffer.byteLength(request.trustedInstructions) > 16384)
        return yield* Effect.fail(
          problem("UnsupportedCapability", "trustedInstructions.maxBytes"),
        );
      const lowered = lowerProviderSchema(
        request.outputSchema,
        providerSchemaSubset("xai-responses"),
        options.schemaRegistry,
      );
      if (!lowered.ok) return yield* Effect.fail(lowered.error);
      const prompt = [
        {
          type: "text",
          text: canonicalize({
            artifacts: request.artifacts,
            outputSchema: request.outputSchema,
          }),
        },
      ];
      if (
        Buffer.byteLength(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 999999,
            method: "session/prompt",
            params: { sessionId: "s".repeat(4096), prompt },
          }),
        ) > 1048576 ||
        Buffer.byteLength(JSON.stringify(lowered.value.jsonSchema)) > 65536
      )
        return yield* unsupported("promptChannel.maxBytes");
      const material = yield* options.credentials.resolve(
        request.credentialProfileRef,
      );
      const environment: Record<string, string> = { ...host.environment };
      delete environment.XAI_API_KEY;
      delete environment.GROK_HOME;
      for (const [name, value] of Object.entries(material.environment ?? {}))
        environment[name] = Redacted.value(value);
      const nativeProfileDirectory = material.nativeProfileDirectory;
      if (nativeProfileDirectory !== undefined) {
        if (
          !isAbsolute(nativeProfileDirectory) ||
          resolve(nativeProfileDirectory) !== nativeProfileDirectory
        )
          return yield* unsupported("credential.nativeProfileDirectory");
        environment.GROK_HOME = nativeProfileDirectory;
      }
      const cmd = [
        options.executable ?? "grok",
        "--no-auto-update",
        "--model",
        request.profileId,
        "--effort",
        request.controls.effort,
        "--no-subagents",
        "--no-plan",
        "--disable-web-search",
        "--system-prompt-override",
        request.trustedInstructions,
        "--json-schema",
        JSON.stringify(lowered.value.jsonSchema),
      ];
      if (request.toolPolicy.mode === "none")
        cmd.push("--tools", "", "--deny", "*");
      if (host.sandboxProfile) cmd.push("--sandbox", host.sandboxProfile);
      cmd.push("agent", "stdio");
      const connection = yield* (
        options.process ??
        host.process ??
        createNativeProcessPort(now)
      ).open({
        cmd,
        cwd: host.cwd,
        environment,
        deadline: request.limits.deadline,
        maxOutputBytes: Math.min(
          67108864,
          request.limits.maxOutputBytes + 1048576,
        ),
      });
      const queue = yield* Queue.unbounded<Item>();
      yield* Effect.addFinalizer(() => Queue.shutdown(queue));
      let session: Session | undefined;
      let sequence = 0;
      let output = "";
      let nextId = 1;
      let toolCount = 0;
      let ended = false;
      const pending = new Map<
        number,
        Deferred.Deferred<RecordValue, ProviderFailure>
      >();
      const seenCalls = new Set<string>();
      const authorizedCalls = new Set<string>();
      const emit = (payload: ProviderEventPayloadV1, sourceEventId?: string) =>
        Effect.gen(function* () {
          if (!session) return;
          yield* Queue.offer(queue, {
            type: "event",
            event: {
              schemaVersion: 1,
              effectId: request.effectId,
              providerIdentity: session.identity,
              sourceEventId:
                sourceEventId ??
                `${session.identity.kind === "native" ? session.identity.sessionId : "invalid"}:${++sequence}`,
              cursor: String(sequence),
              payload,
            },
          });
        });
      const finish = () =>
        Effect.gen(function* () {
          if (ended) return;
          ended = true;
          yield* Queue.offer(queue, { type: "end" });
        });
      const fail = (failure: ProviderFailure) =>
        Effect.gen(function* () {
          for (const d of pending.values()) yield* Deferred.fail(d, failure);
          pending.clear();
          if (!ended) {
            yield* Queue.offer(queue, { type: "failure", failure });
            yield* finish();
          }
        });
      const rpc = (
        method: string,
        params: RecordValue,
      ): Effect.Effect<RecordValue, ProviderFailure> =>
        Effect.gen(function* () {
          const id = nextId++;
          const deferred = yield* Deferred.make<RecordValue, ProviderFailure>();
          pending.set(id, deferred);
          yield* connection.send({ jsonrpc: "2.0", id, method, params });
          return yield* Deferred.await(deferred).pipe(
            Effect.timeoutFail({
              duration: Math.max(1, request.limits.deadline - now()),
              onTimeout: () => problem("OutcomeUnknown", method),
            }),
            Effect.ensuring(Effect.sync(() => pending.delete(id))),
          );
        });
      const respondPermission = (message: RecordValue) =>
        Effect.gen(function* () {
          if (
            !session ||
            typeof message.id !== "number" ||
            !record(message.params) ||
            message.params.sessionId !==
              (session.identity.kind === "native"
                ? session.identity.sessionId
                : undefined)
          )
            return yield* Effect.fail(
              problem("MalformedEvent", "permission.sessionId"),
            );
          const params = message.params;
          const id = message.id;
          session.pendingPermissions.add(id);
          const choices = Array.isArray(params.options)
            ? params.options.filter(record)
            : [];
          const reject = choices.find(
            (c) => c.kind === "reject_once" && typeof c.optionId === "string",
          );
          const allow = choices.find(
            (c) => c.kind === "allow_once" && typeof c.optionId === "string",
          );
          let selected = reject;
          const call = params.toolCall;
          if (
            request.toolPolicy.mode === "native-coding" &&
            host.permissions &&
            record(call) &&
            typeof call.toolCallId === "string" &&
            typeof call.kind === "string" &&
            jsonValue(call.rawInput) &&
            !session.cancelRequested
          ) {
            if (!seenCalls.has(call.toolCallId)) {
              seenCalls.add(call.toolCallId);
              toolCount++;
            }
            if (toolCount > request.limits.maxToolCalls)
              return yield* Effect.fail(
                problem("OutputIncomplete", "limits.maxToolCalls"),
              );
            const tool: ToolRequestV1 = {
              callId: call.toolCallId,
              name: call.kind,
              arguments: call.rawInput,
              authorizationBinding: request.toolPolicy.hostPermissionPortRef,
            };
            const authorization = yield* Effect.either(
              host.permissions.authorize(
                session.identity,
                tool,
                request.toolPolicy,
              ),
            );
            if (
              authorization._tag === "Right" &&
              !session.cancelRequested &&
              authorization.right &&
              allow
            ) {
              selected = allow;
              authorizedCalls.add(call.toolCallId);
              yield* emit(
                {
                  type: "tool-request",
                  request: {
                    ...tool,
                    authorizationBinding: authorization.right,
                  },
                },
                `permission:${id}`,
              );
            }
          }
          if (!session.pendingPermissions.has(id)) return;
          const outcome =
            session.cancelRequested || !selected
              ? { outcome: "cancelled" }
              : { outcome: "selected", optionId: selected.optionId };
          session.pendingPermissions.delete(id);
          yield* connection.send({ jsonrpc: "2.0", id, result: { outcome } });
        });
      yield* Effect.forkScoped(
        connection.events.pipe(
          Stream.runForEach((message) =>
            Effect.gen(function* () {
              if (message.jsonrpc !== "2.0")
                return yield* Effect.fail(problem("MalformedEvent", "jsonrpc"));
              if (
                typeof message.id === "number" &&
                pending.has(message.id) &&
                message.method === undefined
              ) {
                const deferred = pending.get(message.id)!;
                if (record(message.error)) {
                  yield* Deferred.fail(
                    deferred,
                    problem("OutcomeUnknown", "rpc response"),
                  );
                } else if (record(message.result))
                  yield* Deferred.succeed(deferred, message.result);
                else
                  yield* Deferred.fail(
                    deferred,
                    problem("MalformedEvent", "rpc.result"),
                  );
                return;
              }
              if (message.method === "session/request_permission") {
                yield* respondPermission(message);
                return;
              }
              if (
                typeof message.id === "number" &&
                typeof message.method === "string"
              ) {
                yield* connection.send({
                  jsonrpc: "2.0",
                  id: message.id,
                  error: {
                    code: -32601,
                    message: "Host capability is not admitted",
                  },
                });
                return;
              }
              if (message.method !== "session/update") return;
              if (
                !session ||
                !record(message.params) ||
                message.params.sessionId !==
                  (session.identity.kind === "native"
                    ? session.identity.sessionId
                    : undefined) ||
                !record(message.params.update)
              )
                return yield* Effect.fail(
                  problem("MalformedEvent", "session.update"),
                );
              const update = message.params.update;
              if (update.sessionUpdate === "config_option_update") {
                const model = observedModel(update);
                if (model && model !== request.profileId)
                  return yield* Effect.fail(
                    problem("ModelMismatch", "session.model"),
                  );
                return;
              }
              if (update.sessionUpdate === "agent_message_chunk") {
                if (
                  !record(update.content) ||
                  update.content.type !== "text" ||
                  typeof update.content.text !== "string"
                )
                  return yield* Effect.fail(
                    problem("MalformedEvent", "message.content"),
                  );
                output += update.content.text;
                if (Buffer.byteLength(output) > request.limits.maxOutputBytes)
                  return yield* Effect.fail(
                    problem("OutputIncomplete", "limits.maxOutputBytes"),
                  );
                yield* emit({ type: "text", text: update.content.text });
                return;
              }
              // Thoughts are deliberately opaque and are never promoted into text or output.
              if (update.sessionUpdate === "agent_thought_chunk") return;
              if (
                update.sessionUpdate === "tool_call" ||
                update.sessionUpdate === "tool_call_update"
              ) {
                if (typeof update.toolCallId !== "string" || !update.toolCallId)
                  return yield* Effect.fail(
                    problem("MalformedEvent", "toolCallId"),
                  );
                if (!seenCalls.has(update.toolCallId)) {
                  seenCalls.add(update.toolCallId);
                  toolCount++;
                }
                if (request.toolPolicy.mode === "none")
                  return yield* Effect.fail({
                    ...problem("UnsupportedCapability", "toolPolicy.none"),
                    usage: { providerCounters: { nativeToolCalls: toolCount } },
                  });
                if (toolCount > request.limits.maxToolCalls)
                  return yield* Effect.fail(
                    problem("OutputIncomplete", "limits.maxToolCalls"),
                  );
                if (
                  ["in_progress", "completed"].includes(
                    String(update.status),
                  ) &&
                  !authorizedCalls.has(update.toolCallId)
                )
                  return yield* Effect.fail(
                    problem(
                      "UnsupportedCapability",
                      "toolPolicy.permissionBoundary",
                    ),
                  );
              }
            }),
          ),
          Effect.flatMap(() =>
            ended
              ? Effect.void
              : fail(problem("OutcomeUnknown", "stream terminal outcome")),
          ),
          Effect.catchAll(fail),
        ),
      );
      const init = yield* rpc("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "foreman", version },
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      });
      if (
        record(init.agentInfo) &&
        typeof init.agentInfo.version === "string" &&
        /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(init.agentInfo.version)
      )
        installedVersion = init.agentInfo.version;
      if (init.protocolVersion !== 1)
        return yield* unsupported("protocolVersion");
      const methods = Array.isArray(init.authMethods)
        ? init.authMethods.filter(record)
        : [];
      const authMethod =
        material.environment?.XAI_API_KEY &&
        methods.some((m) => m.id === "xai.api_key")
          ? "xai.api_key"
          : nativeProfileDirectory &&
              methods.some((m) => m.id === "cached_token")
            ? "cached_token"
            : undefined;
      if (!authMethod)
        return yield* Effect.fail(
          problem("AuthenticationRequired", "credentialProfileRef"),
        );
      yield* rpc("authenticate", {
        methodId: authMethod,
        _meta: { headless: true },
      });
      const created = yield* rpc("session/new", {
        cwd: host.cwd,
        mcpServers: [],
      });
      if (
        typeof created.sessionId !== "string" ||
        !created.sessionId ||
        created.sessionId.length > 4096
      )
        return yield* Effect.fail(problem("MalformedEvent", "sessionId"));
      const model = observedModel(created);
      if (!model)
        return yield* Effect.fail(
          problem("ProbeUnknown", "observed model metadata"),
        );
      if (model !== request.profileId)
        return yield* Effect.fail(
          problem("ModelMismatch", "observed model metadata"),
        );
      const identity: ProviderIdentityV1 = {
        kind: "native",
        provider: "xai",
        profileId: request.profileId,
        model,
        transportId: "grok-acp",
        credentialProfileRef: request.credentialProfileRef,
        protocolVersion: "1",
        sessionId: created.sessionId,
      };
      session = {
        identity,
        connection,
        request,
        queue,
        pendingPermissions: new Set(),
        observation: { status: "pending", providerIdentity: identity },
        cancelRequested: false,
        closed: false,
      };
      sessions.set(key(identity), session);
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          if (session) {
            session.closed = true;
            sessions.delete(key(identity));
          }
          yield* connection.close();
        }),
      );
      yield* emit({ type: "started" }, `session:${created.sessionId}`);
      yield* Effect.forkScoped(
        rpc("session/prompt", { sessionId: created.sessionId, prompt }).pipe(
          Effect.flatMap((result) =>
            Effect.gen(function* () {
              if (!session) return;
              if (result.stopReason === "end_turn") {
                const decoded = decodeProviderResult(
                  output,
                  request.outputSchema,
                  request.limits.maxOutputBytes,
                );
                if (!decoded.ok) return yield* Effect.fail(decoded.error);
                const cursor = `${sequence + 1}`;
                session.observation = {
                  status: "completed",
                  providerIdentity: identity,
                  cursor,
                  result: decoded.value,
                };
                yield* emit(
                  { type: "completed", result: decoded.value },
                  `prompt:${request.effectId}`,
                );
              } else if (result.stopReason === "refusal") {
                yield* emit({
                  type: "refused",
                  message: "The provider refused this request.",
                });
              } else if (result.stopReason === "cancelled") {
                session.observation = {
                  status: "cancelled",
                  providerIdentity: identity,
                };
                yield* emit({
                  type: "cancelled",
                  observation: {
                    requested: session.cancelRequested,
                    acknowledged: true,
                    localCleanup: "pending",
                    remoteOutcome: "cancelled",
                  },
                });
              } else if (
                ["max_tokens", "max_turn_requests"].includes(
                  String(result.stopReason),
                )
              )
                yield* emit({
                  type: "failed",
                  failure: problem("OutputIncomplete", "stopReason"),
                });
              else
                return yield* Effect.fail(
                  problem("MalformedEvent", "stopReason"),
                );
              yield* finish();
            }),
          ),
          Effect.catchAll(fail),
        ),
      );
      return Stream.fromQueue(queue).pipe(
        Stream.takeWhile((item) => item.type !== "end"),
        Stream.mapEffect((item) =>
          item.type === "event"
            ? Effect.succeed(item.event)
            : item.type === "failure"
              ? Effect.fail(item.failure)
              : Effect.die("Unreachable ended stream"),
        ),
      );
    });
  return {
    id: "grok-acp",
    version,
    get installedVersion() {
      return installedVersion;
    },
    probe: (input) =>
      input.profileId !== "grok-4.6" || input.transportId !== "grok-acp"
        ? Effect.fail({
            _tag: "ModelUnavailable",
            retryClass: "never",
            message: "Exact Grok ACP probe profile and transport are required",
          })
        : input.mode === "bounded-workload"
          ? Effect.fail({
              _tag: "UnsupportedCapability",
              retryClass: "never",
              message:
                "Use explicit bounded qualification for Grok workload probing",
              fieldPath: "probe.mode",
            })
          : Effect.succeed({
              schemaVersion: 1,
              profileId: input.profileId,
              transportId: "grok-acp",
              checkedAt: now(),
              mode: input.mode,
              discovery: { state: "unknown" },
              authentication: { state: "unknown" },
              currency: { state: "unknown" },
              identity: { state: "unknown" },
              capabilities: [],
            }),
    start,
    sendToolResult: () => unsupported("ACP host tool result submission"),
    cancel: (identity) =>
      Effect.gen(function* () {
        const session = sessions.get(key(identity));
        if (!session)
          return {
            requested: false,
            acknowledged: false,
            localCleanup: "unknown" as const,
            remoteOutcome: "unknown" as const,
          };
        session.cancelRequested = true;
        for (const id of [...session.pendingPermissions]) {
          session.pendingPermissions.delete(id);
          yield* session.connection.send({
            jsonrpc: "2.0",
            id,
            result: { outcome: { outcome: "cancelled" } },
          });
        }
        yield* session.connection.send({
          jsonrpc: "2.0",
          method: "session/cancel",
          params: {
            sessionId:
              identity.kind === "native" ? identity.sessionId : undefined,
          },
        });
        return {
          requested: true,
          acknowledged: session.observation.status === "cancelled",
          localCleanup: session.closed
            ? ("complete" as const)
            : ("pending" as const),
          remoteOutcome:
            session.observation.status === "cancelled"
              ? ("cancelled" as const)
              : session.observation.status === "completed"
                ? ("completed" as const)
                : ("pending" as const),
        };
      }),
    observe: (identity) =>
      Effect.succeed(
        sessions.get(key(identity))?.observation ?? {
          status: "unsupported",
          providerIdentity: identity,
          reason:
            "Grok ACP does not establish remote observation after this scoped connection closes.",
        },
      ),
    resume: () =>
      Effect.fail(
        problem(
          "ResumeUnavailable",
          "qualified ACP continuation and cursor replay",
        ),
      ),
  };
}
