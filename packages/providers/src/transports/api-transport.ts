import { createHash } from "node:crypto";
import { Effect, Redacted, Stream } from "effect";
import type { Scope } from "effect";
import type {
  CredentialMaterialV1,
  ProviderTransport,
  ProviderRequestV1,
  ProviderIdentityV1,
  ProviderEventV1,
  ProviderEventPayloadV1,
  ProbeFailure,
  ReadinessV1,
  RemoteObservationV1,
  ContinuationV1,
  ProviderUsageV1,
} from "../contract.js";
import type { ProviderFailure } from "../errors.js";
import type { PelDataSchemaV1 } from "@foreman/pel";
import { validateProfileControls, resolveProfile } from "../profiles.js";
import {
  lowerProviderSchema,
  providerSchemaSubset,
  decodeProviderResult,
} from "../output.js";
import {
  apiFailure,
  createFetchHttpPort,
  decodeSse,
  readApiJson,
} from "./api-http.js";
import type { ApiHttpPort, ApiHttpResponse, SseFrame } from "./api-http.js";
import { initialState, object, string } from "./api-protocol.js";
import type { ApiDialect, ApiState, WireObject } from "./api-protocol.js";

export interface ApiTransportOptions {
  readonly credentials: {
    readonly resolve: (
      ref: string,
    ) => Effect.Effect<CredentialMaterialV1, ProviderFailure, Scope.Scope>;
  };
  readonly http?: ApiHttpPort;
  readonly baseUrl?: string;
  readonly now?: () => number;
  readonly schemaRegistry?: Readonly<Record<string, PelDataSchemaV1>>;
  /** Host binds the original admitted schema after process recovery. No adapter storage access. */
  readonly requestForIdentity?: (
    identity: ProviderIdentityV1,
  ) => Effect.Effect<ProviderRequestV1, ProviderFailure>;
}
const hash = (s: string | Uint8Array) =>
  createHash("sha256").update(s).digest("hex");
export const apiPrefixHash = (r: ProviderRequestV1) =>
  hash(
    JSON.stringify({
      instructions: r.trustedInstructions,
      artifacts: r.artifacts,
      controls: r.controls,
      outputSchema: r.outputSchema,
      toolPolicy: r.toolPolicy,
    }),
  );
const identityKey = (i: ProviderIdentityV1) => JSON.stringify(i);
const unwrap = <T>(
  r: { ok: true; value: T } | { ok: false; error: ProviderFailure },
): Effect.Effect<T, ProviderFailure> =>
  r.ok ? Effect.succeed(r.value) : Effect.fail(r.error);
const statusFailure = (status: number): ProviderFailure =>
  status === 401 || status === 403
    ? apiFailure(
        "AuthenticationRequired",
        "Provider rejected the selected credential profile",
      )
    : status === 404
      ? apiFailure(
          "ModelUnavailable",
          "Requested provider model or resource was not found",
        )
      : status === 429
        ? {
            _tag: "RateLimited",
            retryClass: "transient",
            message: "Provider rate limit reached",
          }
        : apiFailure(
            "OutcomeUnknown",
            "Provider request did not produce a known outcome",
          );
export function createApiTransport(
  dialect: ApiDialect,
  options: ApiTransportOptions,
): ProviderTransport {
  const http = options.http ?? createFetchHttpPort();
  const now = options.now ?? Date.now;
  const base = options.baseUrl ?? dialect.baseUrl;
  const version = "1";
  const requests = new Map<string, ProviderRequestV1>();
  const active = new Map<string, AbortController>();
  const checkIdentity = (
    identity: ProviderIdentityV1,
  ): Effect.Effect<void, ProviderFailure> =>
    identity.kind !== "api" ||
    identity.provider !== dialect.provider ||
    identity.transportId !== dialect.id ||
    identity.endpointRevision !== dialect.endpointRevision ||
    !dialect.models.includes(identity.profileId) ||
    (identity.model !== undefined && identity.model !== identity.profileId)
      ? Effect.fail(
          apiFailure(
            "ContinuationMismatch",
            "Identity does not match this exact API transport",
          ),
        )
      : Effect.void;
  const getRequest = (
    identity: ProviderIdentityV1,
  ): Effect.Effect<ProviderRequestV1, ProviderFailure> => {
    const found = requests.get(identityKey(identity));
    return found
      ? Effect.succeed(found)
      : options.requestForIdentity
        ? options.requestForIdentity(identity)
        : Effect.fail(
            apiFailure(
              "OutcomeUnknown",
              "Original admitted request is required to validate the remote result",
            ),
          );
  };
  const requestHttp = (
    ref: string,
    path: string,
    method: "GET" | "POST",
    body?: WireObject,
    signal?: AbortSignal,
  ) =>
    Effect.gen(function* () {
      const credentials = yield* options.credentials.resolve(ref);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...dialect.headers,
      };
      for (const [name, value] of Object.entries(credentials.headers ?? {}))
        headers[name] = Redacted.value(value);
      if (!Object.keys(credentials.headers ?? {}).length)
        return yield* Effect.fail(
          apiFailure(
            "AuthenticationRequired",
            "Selected credential profile has no API headers",
          ),
        );
      return yield* http.request({
        url: base + path,
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal ? { signal } : {}),
      });
    });
  const checkRequest = (r: ProviderRequestV1) =>
    Effect.gen(function* () {
      const profile = yield* unwrap(resolveProfile(r.profileId));
      if (
        r.transportVersion !== version ||
        r.profileHash !== profile.profileHash ||
        r.sourceManifestHash !== profile.sourceManifestHash
      )
        return yield* Effect.fail(
          apiFailure(
            "ModelMismatch",
            "API request has a stale profile, source or transport binding",
          ),
        );
      if (r.transportId !== dialect.id || !dialect.models.includes(r.profileId))
        return yield* Effect.fail(
          apiFailure(
            "ModelMismatch",
            "Request does not select this exact model and transport",
          ),
        );
      if (r.toolPolicy.mode !== "none")
        return yield* Effect.fail(
          apiFailure(
            "UnsupportedCapability",
            "Direct API codingTask is unsupported",
            "toolPolicy",
          ),
        );
      if (r.generation?.resolvedGrammarMode === "grammar")
        return yield* Effect.fail(
          apiFailure(
            "UnsupportedCapability",
            "This endpoint has no qualified Pel grammar mode",
            "generation.resolvedGrammarMode",
          ),
        );
      if (r.controls.toolChoice !== "none" && r.controls.toolChoice !== "auto")
        return yield* Effect.fail(
          apiFailure(
            "UnsupportedCapability",
            "The release admits no API tool catalog",
            "toolChoice",
          ),
        );
      const evidence: ("background" | "store")[] = [
        ...(dialect.cancel ? ["background" as const] : []),
        ...(dialect.id === "anthropic-messages" ? [] : ["store" as const]),
      ];
      yield* unwrap(
        validateProfileControls(r.profileId, r.controls, dialect.id, evidence),
      );
      if (
        r.controls.sampling.topK !== undefined &&
        (dialect.id === "openai-responses" || dialect.id === "xai-responses")
      )
        return yield* Effect.fail(
          apiFailure(
            "UnsupportedCapability",
            "Endpoint does not support topK",
            "sampling.topK",
          ),
        );
      if (r.limits.deadline <= now())
        return yield* Effect.fail(
          apiFailure(
            "OutcomeUnknown",
            "Request deadline expired before API dispatch",
          ),
        );
      if (
        !Number.isSafeInteger(r.limits.maxOutputTokens) ||
        r.limits.maxOutputTokens <= 0 ||
        !Number.isSafeInteger(r.limits.maxOutputBytes) ||
        r.limits.maxOutputBytes <= 0
      )
        return yield* Effect.fail(
          apiFailure(
            "UnsupportedCapability",
            "Positive finite output bounds are required",
            "limits",
          ),
        );
      for (const a of r.artifacts)
        if (a.content === undefined)
          return yield* Effect.fail(
            apiFailure(
              "UnsupportedCapability",
              "Host must resolve artifact content before API dispatch",
              "artifacts.content",
            ),
          );
      return yield* unwrap(
        lowerProviderSchema(
          r.outputSchema,
          providerSchemaSubset(dialect.id),
          options.schemaRegistry,
        ),
      );
    });
  const makeIdentity = (
    r: ProviderRequestV1,
    s: ApiState,
  ): ProviderIdentityV1 => ({
    kind: "api",
    provider: dialect.provider,
    profileId: r.profileId,
    model: s.model,
    transportId: dialect.id,
    credentialProfileRef: r.credentialProfileRef,
    endpointRevision: dialect.endpointRevision,
    responseId: s.id,
  });
  const checkUsage = (
    r: ProviderRequestV1,
    usage: ProviderUsageV1,
    identity?: ProviderIdentityV1,
  ): Effect.Effect<void, ProviderFailure> => {
    // Messages reports cache reads/writes separately. Responses and Interactions
    // include cached tokens in their total input count.
    const input =
      (usage.inputTokens ?? 0) +
      (dialect.id === "anthropic-messages"
        ? (usage.cachedReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
        : 0);
    if (
      input > r.limits.maxInputTokens ||
      (usage.outputTokens ?? 0) > r.limits.maxOutputTokens ||
      (usage.costUsd !== undefined &&
        Number(usage.costUsd) > r.limits.maxCostUsd)
    )
      return Effect.fail({
        ...apiFailure(
          "OutputIncomplete",
          "Provider accounting exceeded its admitted token or cost bound",
          "limits",
        ),
        usage,
        ...(identity ? { providerIdentity: identity } : {}),
      });
    return Effect.void;
  };
  const observeResponse = (
    r: ProviderRequestV1,
    identity: ProviderIdentityV1,
    response: WireObject,
  ): Effect.Effect<RemoteObservationV1, ProviderFailure> =>
    Effect.gen(function* () {
      if (
        r.profileId !== identity.profileId ||
        r.transportId !== identity.transportId ||
        r.credentialProfileRef !== identity.credentialProfileRef
      )
        return yield* Effect.fail(
          apiFailure(
            "ContinuationMismatch",
            "Original request does not bind the observed identity",
          ),
        );
      yield* unwrap(
        lowerProviderSchema(
          r.outputSchema,
          providerSchemaSubset(dialect.id),
          options.schemaRegistry,
        ),
      );
      const state = initialState();
      const delta = dialect.complete(state, response);
      if (state.model !== r.profileId)
        return yield* Effect.fail(
          apiFailure(
            "ModelMismatch",
            "Observed API model does not match the requested exact model",
          ),
        );
      if (identity.kind === "api" && state.id !== identity.responseId)
        return yield* Effect.fail(
          apiFailure(
            "ModelMismatch",
            "Observed API resource does not match the requested identity",
          ),
        );
      if (delta.failure) return yield* Effect.fail(delta.failure);
      yield* checkUsage(r, state.usage, identity);
      if (state.status === "refused")
        return yield* Effect.fail(
          apiFailure("OutputInvalid", "Remote response contains a refusal"),
        );
      if (state.status === "completed") {
        const result = yield* unwrap(
          decodeProviderResult(
            state.text,
            r.outputSchema,
            r.limits.maxOutputBytes,
          ),
        );
        return {
          status: "completed",
          providerIdentity: identity,
          cursor: string(response.id),
          result,
        };
      }
      return {
        status: state.status === "cancelled" ? "cancelled" : "pending",
        providerIdentity: identity,
      };
    });
  const streamResponse = (
    r: ProviderRequestV1,
    response: ApiHttpResponse,
    controller: AbortController,
    resumeIdentity?: ProviderIdentityV1,
  ): Effect.Effect<
    Stream.Stream<ProviderEventV1, ProviderFailure>,
    ProviderFailure,
    Scope.Scope
  > =>
    Effect.gen(function* () {
      if (response.status < 200 || response.status >= 300)
        return yield* Effect.fail(statusFailure(response.status));
      const state = initialState();
      let lastCursor: string | undefined;
      let terminal = false;
      let started = false;
      let identity: ProviderIdentityV1 | undefined = resumeIdentity;
      if (r.continuation) {
        const c = r.continuation;
        if (
          c.sha256 !== hash(c.bytes) ||
          c.prefixHash !== apiPrefixHash(r) ||
          c.transportVersion !== version ||
          c.providerIdentity.profileId !== r.profileId ||
          c.providerIdentity.transportId !== r.transportId ||
          c.providerIdentity.credentialProfileRef !== r.credentialProfileRef ||
          c.bytes.length >
            Math.min(r.limits.maxOutputBytes + 1024 * 1024, 4 * 1024 * 1024)
        )
          return yield* Effect.fail(
            apiFailure(
              "ContinuationMismatch",
              "Opaque continuation binding does not match the request",
            ),
          );
        if (
          c.retention.expiresAt !== undefined &&
          c.retention.expiresAt <= now()
        )
          return yield* Effect.fail(
            apiFailure(
              "ResumeUnavailable",
              "Provider continuation retention has expired",
            ),
          );
        const raw = yield* Effect.try({
          try: () => {
            const value: unknown = JSON.parse(
              Buffer.from(c.bytes).toString("utf8"),
            );
            if (
              !Array.isArray(value) ||
              !value.every((v) => typeof v === "string")
            )
              throw new Error();
            return value as string[];
          },
          catch: () =>
            apiFailure(
              "ContinuationMismatch",
              "Invalid opaque API continuation",
            ),
        });
        for (const frame of raw) {
          const e = yield* Effect.try({
            try: () => object(JSON.parse(frame)),
            catch: () =>
              apiFailure(
                "ContinuationMismatch",
                "Invalid opaque API continuation event",
              ),
          });
          const d = dialect.consume(state, e);
          if (d.failure) return yield* Effect.fail(d.failure);
          state.opaque.push(frame);
        }
      }
      if (resumeIdentity?.kind === "api") {
        state.id = resumeIdentity.responseId;
        state.model = resumeIdentity.profileId;
      }
      const event = (
        payload: ProviderEventPayloadV1,
        frame?: SseFrame,
      ): ProviderEventV1 => ({
        schemaVersion: 1,
        effectId: r.effectId,
        providerIdentity: identity!,
        ...(frame?.id ? { sourceEventId: frame.id } : {}),
        ...(lastCursor === undefined ? {} : { cursor: lastCursor }),
        payload,
      });
      const checkpoint = (): ContinuationV1 => {
        const bytes = Buffer.from(JSON.stringify(state.opaque));
        return {
          schemaVersion: 1,
          providerIdentity: identity!,
          transportVersion: version,
          formatVersion: `${dialect.id}/sse-v1`,
          bytes,
          sha256: hash(bytes),
          prefixHash: apiPrefixHash(r),
          retention: {
            createdAt: now(),
            policy: "provider-account-retention; no expiry inferred",
          },
          ...(lastCursor === undefined ? {} : { cursor: lastCursor }),
        };
      };
      const consume = (
        frame: SseFrame,
      ): Effect.Effect<readonly ProviderEventV1[], ProviderFailure> =>
        Effect.gen(function* () {
          if (frame.data === "[DONE]") return [];
          if (terminal)
            return yield* Effect.fail(
              apiFailure(
                "MalformedEvent",
                "Provider emitted data after a terminal event",
              ),
            );
          const wire = yield* Effect.try({
            try: () => {
              const v: unknown = JSON.parse(frame.data);
              if (!v || typeof v !== "object" || Array.isArray(v))
                throw new Error();
              return v as WireObject;
            },
            catch: () =>
              apiFailure("MalformedEvent", "Invalid provider event JSON"),
          });
          const delta = dialect.consume(state, wire);
          if (delta.failure) return yield* Effect.fail(delta.failure);
          if (state.model && state.model !== r.profileId)
            return yield* Effect.fail(
              apiFailure(
                "ModelMismatch",
                "Provider returned a different exact model",
              ),
            );
          if (
            resumeIdentity?.kind === "api" &&
            state.id !== resumeIdentity.responseId
          )
            return yield* Effect.fail(
              apiFailure(
                "ModelMismatch",
                "Provider replay returned a different resource",
              ),
            );
          if (identity?.kind === "api" && state.id !== identity.responseId)
            return yield* Effect.fail(
              apiFailure(
                "ModelMismatch",
                "Provider stream changed its established response identity",
              ),
            );
          yield* checkUsage(r, state.usage, identity);
          if (
            typeof wire.sequence_number === "number" &&
            Number.isSafeInteger(wire.sequence_number)
          )
            lastCursor = String(wire.sequence_number);
          else if (typeof wire.event_id === "string")
            lastCursor = wire.event_id;
          else if (frame.id) lastCursor = frame.id;
          state.opaque.push(frame.data);
          if (
            Buffer.byteLength(state.text) > r.limits.maxOutputBytes ||
            Buffer.byteLength(JSON.stringify(state.opaque)) >
              Math.min(r.limits.maxOutputBytes + 1024 * 1024, 4 * 1024 * 1024)
          )
            return yield* Effect.fail(
              apiFailure(
                "OutputIncomplete",
                "Provider stream exceeded the admitted byte bound",
              ),
            );
          if (!state.id || !state.model) {
            if (delta.text || delta.terminal)
              return yield* Effect.fail(
                apiFailure(
                  "MalformedEvent",
                  "Provider content arrived without exact response identity",
                ),
              );
            return [];
          }
          identity = makeIdentity(r, state);
          requests.set(identityKey(identity), r);
          active.set(identityKey(identity), controller);
          const out: ProviderEventV1[] = [];
          if (!started) {
            out.push(event({ type: "started" }, frame));
            started = true;
          }
          if (delta.text)
            out.push(event({ type: "text", text: delta.text }, frame));
          out.push(
            event({ type: "checkpoint", checkpoint: checkpoint() }, frame),
          );
          if (delta.terminal) {
            terminal = true;
            active.delete(identityKey(identity));
            if (state.status === "refused")
              out.push(
                event(
                  { type: "refused", message: "Provider refused the request" },
                  frame,
                ),
              );
            else if (state.status === "cancelled")
              out.push(
                event(
                  {
                    type: "cancelled",
                    observation: {
                      requested: false,
                      acknowledged: true,
                      localCleanup: "complete",
                      remoteOutcome: "cancelled",
                    },
                  },
                  frame,
                ),
              );
            else {
              const result = yield* unwrap(
                decodeProviderResult(
                  state.text,
                  r.outputSchema,
                  r.limits.maxOutputBytes,
                ),
              );
              out.push(
                event({ type: "usage", usage: state.usage }, frame),
                event({ type: "completed", result, usage: state.usage }, frame),
              );
            }
          }
          return out;
        });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          controller.abort();
          if (identity) active.delete(identityKey(identity));
        }),
      );
      const frames = response.headers["content-type"]?.includes(
        "text/event-stream",
      )
        ? decodeSse(response.body)
        : Stream.fromEffect(
            readApiJson(response).pipe(
              Effect.map((wire) => ({
                data: JSON.stringify(
                  dialect.id === "anthropic-messages"
                    ? { type: "__full", response: wire }
                    : dialect.id === "google-interactions"
                      ? {
                          event_type: "interaction.completed",
                          interaction: wire,
                        }
                      : { type: "response.completed", response: wire },
                ),
              })),
            ),
          );
      // Streaming endpoints must retain their native event grammar.
      const body = frames.pipe(
        Stream.mapEffect(consume),
        Stream.flatMap(Stream.fromIterable),
      );
      return Stream.concat(
        body,
        Stream.fromEffect(
          Effect.suspend(() =>
            terminal
              ? Effect.void
              : Effect.fail(
                  apiFailure(
                    "OutcomeUnknown",
                    "Provider stream ended before a terminal outcome",
                  ),
                ),
          ),
        ).pipe(Stream.drain),
      );
    });
  const start: ProviderTransport["start"] = (r) =>
    Effect.gen(function* () {
      const schema = yield* checkRequest(r);
      if (r.continuation)
        return yield* Effect.fail(
          apiFailure(
            "ResumeUnavailable",
            "Continuation must use explicit resume on the original identity",
          ),
        );
      const controller = new AbortController();
      yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
      const response = yield* requestHttp(
        r.credentialProfileRef,
        dialect.path,
        "POST",
        dialect.encode(r, schema.jsonSchema),
        controller.signal,
      );
      return yield* streamResponse(r, response, controller);
    });
  const observe: ProviderTransport["observe"] = (identity) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* checkIdentity(identity);
        if (!dialect.retrieve)
          return {
            status: "unsupported",
            providerIdentity: identity,
            reason: "Messages does not expose per-message retrieval",
          };
        if (identity.kind !== "api")
          return yield* Effect.fail(
            apiFailure("ContinuationMismatch", "Expected API identity"),
          );
        const response = yield* requestHttp(
          identity.credentialProfileRef,
          `${dialect.path}/${encodeURIComponent(identity.responseId)}`,
          "GET",
        );
        if (response.status === 404)
          return {
            status: "not-found",
            providerIdentity: identity,
            evidence: "GET returned HTTP 404; this does not prove non-dispatch",
          };
        if (response.status < 200 || response.status >= 300)
          return yield* Effect.fail(statusFailure(response.status));
        const wire = yield* readApiJson(response);
        return yield* observeResponse(
          yield* getRequest(identity),
          identity,
          wire,
        );
      }),
    );
  const cancel: ProviderTransport["cancel"] = (identity) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* checkIdentity(identity);
        const local = active.get(identityKey(identity));
        local?.abort();
        active.delete(identityKey(identity));
        if (!dialect.cancel)
          return {
            requested: true,
            acknowledged: false,
            localCleanup: local ? "complete" : "not-required",
            remoteOutcome:
              dialect.id === "xai-responses" ? "unknown" : "unsupported",
          };
        const original = yield* getRequest(identity);
        if (
          dialect.id === "openai-responses" &&
          original.controls.execution.mode !== "background"
        )
          return {
            requested: true,
            acknowledged: false,
            localCleanup: local ? "complete" : "not-required",
            remoteOutcome: "unknown",
          };
        if (identity.kind !== "api")
          return yield* Effect.fail(
            apiFailure("ContinuationMismatch", "Expected API identity"),
          );
        const response = yield* requestHttp(
          identity.credentialProfileRef,
          `${dialect.path}/${encodeURIComponent(identity.responseId)}/cancel`,
          "POST",
          {},
        );
        if (response.status < 200 || response.status >= 300)
          return yield* Effect.fail(statusFailure(response.status));
        const body = yield* readApiJson(response);
        const status = body.status;
        if (body.model !== undefined && body.model !== identity.profileId)
          return yield* Effect.fail(
            apiFailure(
              "ModelMismatch",
              "Cancellation response returned a different model",
            ),
          );
        return {
          requested: true,
          acknowledged: true,
          localCleanup: local ? "complete" : "not-required",
          remoteOutcome:
            status === "cancelled"
              ? "cancelled"
              : status === "completed"
                ? "completed"
                : "pending",
        };
      }),
    );
  const resume: ProviderTransport["resume"] = (r, identity, cursor) =>
    Effect.gen(function* () {
      yield* checkIdentity(identity);
      yield* checkRequest(r);
      if (!dialect.replay)
        return yield* Effect.fail(
          apiFailure(
            "ResumeUnavailable",
            "This API has no documented cursor replay protocol",
          ),
        );
      if (
        identity.kind !== "api" ||
        identity.profileId !== r.profileId ||
        identity.credentialProfileRef !== r.credentialProfileRef
      )
        return yield* Effect.fail(
          apiFailure(
            "ContinuationMismatch",
            "Resume request changed model or account",
          ),
        );
      if (
        dialect.id === "openai-responses" &&
        r.controls.execution.mode !== "background"
      )
        return yield* Effect.fail(
          apiFailure(
            "ResumeUnavailable",
            "Response replay requires the original background streaming request",
          ),
        );
      if (
        !cursor ||
        cursor.length > 4096 ||
        (dialect.replay === "starting_after" && !/^\d+$/.test(cursor))
      )
        return yield* Effect.fail(
          apiFailure("ContinuationMismatch", "Invalid provider replay cursor"),
        );
      if (
        r.continuation &&
        (r.continuation.schemaVersion !== 1 ||
          r.continuation.formatVersion !== `${dialect.id}/sse-v1` ||
          r.continuation.transportVersion !== version ||
          r.continuation.bytes.length >
            Math.min(r.limits.maxOutputBytes + 1024 * 1024, 4 * 1024 * 1024) ||
          r.continuation.prefixHash !== apiPrefixHash(r) ||
          r.continuation.sha256 !== hash(r.continuation.bytes) ||
          identityKey(r.continuation.providerIdentity) !==
            identityKey(identity))
      )
        return yield* Effect.fail(
          apiFailure(
            "ContinuationMismatch",
            "Resume checkpoint does not match the request",
          ),
        );
      if (
        r.continuation?.retention.expiresAt !== undefined &&
        r.continuation.retention.expiresAt <= now()
      )
        return yield* Effect.fail(
          apiFailure(
            "ResumeUnavailable",
            "Provider continuation retention expired",
          ),
        );
      if (dialect.id === "google-interactions" && !r.continuation)
        return yield* Effect.fail(
          apiFailure(
            "ResumeUnavailable",
            "Interaction replay needs the host-persisted prefix checkpoint",
          ),
        );
      const controller = new AbortController();
      yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
      const response = yield* requestHttp(
        identity.credentialProfileRef,
        `${dialect.path}/${encodeURIComponent(identity.responseId)}?stream=true&${dialect.replay}=${encodeURIComponent(cursor)}`,
        "GET",
        undefined,
        controller.signal,
      );
      return yield* streamResponse(r, response, controller, identity);
    });
  const probe: ProviderTransport["probe"] = (input) =>
    Effect.scoped(
      Effect.gen(function* () {
        if (
          input.transportId !== dialect.id ||
          !dialect.models.includes(input.profileId)
        )
          return yield* Effect.fail(
            apiFailure(
              "ModelMismatch",
              "Probe selects a different exact transport or model",
            ),
          );
        if (input.mode === "bounded-workload")
          return yield* Effect.fail(
            apiFailure(
              "UnsupportedCapability",
              "Bounded workload probes require an admitted schema request through qualification",
            ),
          );
        const response = yield* requestHttp(
          input.credentialProfileRef,
          `/${dialect.id === "google-interactions" ? "v1beta" : "v1"}/models/${encodeURIComponent(input.profileId)}`,
          "GET",
        );
        const baseReadiness: ReadinessV1 = {
          schemaVersion: 1,
          profileId: input.profileId,
          transportId: dialect.id,
          checkedAt: now(),
          mode: input.mode,
          discovery: { state: "available" },
          authentication: {
            state:
              response.status === 401
                ? "signed-out"
                : response.status >= 200 && response.status < 300
                  ? "authenticated"
                  : "unknown",
          },
          currency: { state: "unknown" },
          identity: { state: "unknown" },
          capabilities: [],
        };
        if (response.status === 401)
          return {
            ...baseReadiness,
            authentication: {
              state: "signed-out",
              remediation: "Select an authenticated credential profile",
            },
          } satisfies ReadinessV1;
        if (response.status === 404)
          return {
            ...baseReadiness,
            discovery: { state: "missing" },
          } satisfies ReadinessV1;
        if (response.status < 200 || response.status >= 300)
          return {
            ...baseReadiness,
            discovery: { state: "unknown" },
          } satisfies ReadinessV1;
        const data = yield* readApiJson(response);
        const name =
          string(data.id) || string(data.name).replace(/^models\//, "");
        return {
          ...baseReadiness,
          identity: {
            state:
              name === input.profileId
                ? "exact"
                : name
                  ? "mismatch"
                  : "unknown",
          },
        } satisfies ReadinessV1;
      }),
    ).pipe(
      Effect.timeoutFail({
        duration:
          input.limits && Number.isFinite(input.limits.deadline)
            ? Math.max(1, Math.min(10000, input.limits.deadline - now()))
            : 10000,
        onTimeout: (): ProbeFailure => ({
          _tag: "ProbeUnknown",
          retryClass: "never",
          message: "API metadata observation timed out",
        }),
      }),
      Effect.mapError((e): ProbeFailure =>
        e._tag === "AuthenticationRequired" ||
        e._tag === "ModelMismatch" ||
        e._tag === "ModelUnavailable" ||
        e._tag === "UnsupportedCapability"
          ? e
          : {
              _tag: "ProbeUnknown",
              retryClass: "never",
              message: "API metadata probe did not establish readiness",
            },
      ),
    );
  return {
    id: dialect.id,
    version,
    probe,
    start,
    observe,
    cancel,
    resume,
    sendToolResult: () =>
      Effect.fail(
        apiFailure(
          "UnsupportedCapability",
          "This release admits no direct API tool catalog",
          "toolPolicy",
        ),
      ),
  };
}
