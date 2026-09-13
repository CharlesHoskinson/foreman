import type { ProviderUsageV1 } from "./usage.js";
import { Effect, Stream } from "effect";
import type { Result } from "@foreman/pel";
import { validateDataSchema } from "@foreman/pel";
import { canonicalize, sha256Hex } from "@foreman/core";
import type {
  Capability,
  CapabilityEvidenceV1,
  ProviderEventV1,
  ProviderIdentityV1,
  ProviderLimitsV1,
  ProviderRequestV1,
  ProviderTransport,
  CancellationObservationV1,
} from "./contract.js";
import type { ProviderFailure } from "./errors.js";
import {
  controlsHash,
  resolveProfile,
  validateProfileControls,
} from "./profiles.js";
import { exactIdentity } from "./registry.js";
export type QualificationBindingV1 =
  | {
      readonly kind: "qualification";
      readonly evidenceRef: string;
      readonly expiresAt: number;
    }
  | {
      readonly kind: "qualification-fixture";
      readonly evidenceRef: string;
      readonly expiresAt: number;
      readonly fixtureManifestHash: string;
      readonly endpointIdentity: string;
    };
export interface QualificationInputV1 {
  readonly request: ProviderRequestV1;
  readonly requiredCapabilities: readonly Capability[];
  readonly binding: QualificationBindingV1;
}
export interface QualificationAssertionV1 {
  readonly capability: Capability;
  readonly passed: boolean;
  readonly evidenceType: "live-observation" | "contract-fixture";
  readonly reason: string;
}
export interface QualificationReportV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly transportId: string;
  readonly requestedIdentity: {
    readonly profileId: string;
    readonly credentialProfileRef: string;
  };
  readonly observedIdentity?: ProviderIdentityV1;
  readonly transportVersion: string;
  readonly apiRevision?: string;
  readonly installedVersion?: string;
  readonly protocolVersion?: string;
  readonly profileHash: string;
  readonly sourceManifestHash: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly bounds: ProviderLimitsV1;
  readonly outcome: "success" | "failed" | "needs-action" | "cancelled";
  readonly assertions: readonly QualificationAssertionV1[];
  readonly evidence: readonly CapabilityEvidenceV1[];
  readonly eventTypes: readonly ProviderEventV1["payload"]["type"][];
  readonly failure?: ProviderFailure;
  readonly cancellation?: CancellationObservationV1;
  readonly usage?: ProviderUsageV1;
}
export interface QualificationPortsV1 {
  readonly transport: ProviderTransport;
  readonly now: () => number;
  /** Explicit additional assertions must inspect recorded observations; the harness never assumes permission or cancellation support. */
  readonly assess?: (
    capability: Capability,
    events: readonly ProviderEventV1[],
    identity: ProviderIdentityV1,
  ) => Effect.Effect<
    { readonly passed: boolean; readonly reason: string },
    ProviderFailure
  >;
}
export function qualificationBounds(
  limits: ProviderLimitsV1,
  now: number,
): Result<ProviderLimitsV1, ProviderFailure> {
  const invalid = (
    fieldPath: string,
  ): Result<ProviderLimitsV1, ProviderFailure> => ({
    ok: false,
    error: {
      _tag: "UnsupportedCapability",
      retryClass: "never",
      message: "Qualification requires finite positive bounds",
      fieldPath,
    },
  });
  for (const field of [
    "maxInputTokens",
    "maxOutputTokens",
    "maxOutputBytes",
  ] as const)
    if (!Number.isSafeInteger(limits[field]) || limits[field] <= 0)
      return invalid(`limits.${field}`);
  if (!Number.isSafeInteger(limits.maxToolCalls) || limits.maxToolCalls < 0)
    return invalid("limits.maxToolCalls");
  if (!Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd <= 0)
    return invalid("limits.maxCostUsd");
  if (!Number.isFinite(limits.deadline) || limits.deadline <= now)
    return invalid("limits.deadline");
  if (!limits.spendReservationRef) return invalid("limits.spendReservationRef");
  const maxOutputTokens = Math.min(limits.maxOutputTokens, 15000);
  const maxInputTokens = Math.min(
    limits.maxInputTokens,
    30000 - maxOutputTokens,
  );
  return {
    ok: true,
    value: {
      ...limits,
      deadline: Math.min(limits.deadline, now + 180000),
      maxInputTokens,
      maxOutputTokens,
      maxToolCalls: Math.min(limits.maxToolCalls, 2),
      maxCostUsd: Math.min(limits.maxCostUsd, 5),
      maxOutputBytes: Math.min(limits.maxOutputBytes, 1048576),
    },
  };
}
export function runQualification(
  input: QualificationInputV1,
  ports: QualificationPortsV1,
): Effect.Effect<QualificationReportV1, ProviderFailure> {
  return Effect.scoped(
    Effect.gen(function* () {
      const startedAt = ports.now();
      const profile = resolveProfile(input.request.profileId);
      if (!profile.ok) return yield* Effect.fail(profile.error);
      const bounded = qualificationBounds(input.request.limits, startedAt);
      if (!bounded.ok) return yield* Effect.fail(bounded.error);
      const request = { ...input.request, limits: bounded.value };
      if (
        !request.credentialProfileRef ||
        !input.binding.evidenceRef ||
        !Number.isFinite(input.binding.expiresAt) ||
        input.binding.expiresAt <= startedAt ||
        request.transportId !== ports.transport.id ||
        request.transportVersion !== ports.transport.version ||
        request.profileHash !== profile.value.profileHash ||
        request.sourceManifestHash !== profile.value.sourceManifestHash ||
        !profile.value.transports.includes(request.transportId)
      )
        return yield* Effect.fail({
          _tag: "UnsupportedCapability",
          retryClass: "never",
          message: "Qualification binding does not match the explicit request",
          fieldPath: "binding",
        } as const);
      if (
        input.binding.kind === "qualification-fixture" &&
        (!input.binding.fixtureManifestHash ||
          !input.binding.endpointIdentity.startsWith("fake://"))
      )
        return yield* Effect.fail({
          _tag: "UnsupportedCapability",
          retryClass: "never",
          message:
            "Fixture qualification requires a manifest and fake endpoint identity",
          fieldPath: "binding",
        } as const);
      const controls = validateProfileControls(
        request.profileId,
        request.controls,
        request.transportId,
        input.requiredCapabilities,
      );
      if (!controls.ok) return yield* Effect.fail(controls.error);
      const events: ProviderEventV1[] = [];
      let identity: ProviderIdentityV1 | undefined;
      let failure: ProviderFailure | undefined;
      let textBytes = 0;
      let toolCalls = 0;
      let cancellation: CancellationObservationV1 | undefined;
      let observedUsage: ProviderUsageV1 | undefined;
      const observed = yield* Effect.gen(function* () {
        const stream = yield* ports.transport.start(request);
        yield* stream.pipe(
          Stream.take(10001),
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (
                !exactIdentity(
                  profile.value,
                  request.transportId,
                  event.providerIdentity,
                  request.credentialProfileRef,
                )
              )
                return yield* Effect.fail({
                  _tag: "ModelMismatch",
                  retryClass: "never",
                  message:
                    "Qualification observed a different model or account",
                } as const);
              if (event.effectId !== request.effectId)
                return yield* Effect.fail({
                  _tag: "MalformedEvent",
                  retryClass: "never",
                  message:
                    "Qualification event has a different effect identity",
                } as const);
              if (
                identity &&
                canonicalize(identity) !== canonicalize(event.providerIdentity)
              )
                return yield* Effect.fail({
                  _tag: "ModelMismatch",
                  retryClass: "never",
                  message:
                    "Qualification stream changed its full provider identity",
                } as const);
              identity = event.providerIdentity;
              events.push(event);
              const payload = event.payload;
              if (
                payload.type === "completed" &&
                (payload.result.schemaId !== request.outputSchema.id ||
                  payload.result.schemaSha256 !==
                    sha256Hex(canonicalize(request.outputSchema.content)) ||
                  !validateDataSchema(
                    payload.result.value,
                    request.outputSchema.content,
                  ) ||
                  !Number.isSafeInteger(payload.result.byteLength) ||
                  payload.result.byteLength < 0 ||
                  payload.result.byteLength > request.limits.maxOutputBytes)
              )
                return yield* Effect.fail({
                  _tag: "OutputInvalid",
                  retryClass: "never",
                  message:
                    "Qualification result failed the original host schema or admitted byte bound",
                } as const);
              if (payload.type === "text")
                textBytes += Buffer.byteLength(payload.text);
              if (payload.type === "tool-request") toolCalls++;
              if (payload.type === "cancelled")
                cancellation = payload.observation;
              if (payload.type === "failed")
                return yield* Effect.fail(payload.failure);
              if (
                events.length > 10000 ||
                textBytes > request.limits.maxOutputBytes ||
                toolCalls > request.limits.maxToolCalls ||
                ports.now() > request.limits.deadline
              )
                return yield* Effect.fail({
                  _tag: "OutputIncomplete",
                  retryClass: "never",
                  message:
                    "Qualification exhausted its admitted event, byte, tool or deadline bound",
                } as const);
              const usage =
                payload.type === "usage" || payload.type === "completed"
                  ? payload.usage
                  : undefined;
              if (usage) observedUsage = usage;
              if (
                usage &&
                ((usage.inputTokens ?? 0) > request.limits.maxInputTokens ||
                  (usage.outputTokens ?? 0) > request.limits.maxOutputTokens ||
                  (usage.costUsd !== undefined &&
                    Number(usage.costUsd) > request.limits.maxCostUsd))
              )
                return yield* Effect.fail({
                  _tag: "OutputIncomplete",
                  retryClass: "never",
                  message:
                    "Qualification exhausted its admitted token or cost bound",
                } as const);
            }),
          ),
        );
      }).pipe(
        Effect.timeoutFail({
          duration: request.limits.deadline - startedAt,
          onTimeout: (): ProviderFailure => ({
            _tag: "OutcomeUnknown",
            retryClass: "never",
            message:
              "Qualification deadline ended before a terminal observation",
          }),
        }),
        Effect.either,
      );
      if (observed._tag === "Left") failure = observed.left;
      if (failure && identity)
        cancellation = yield* ports.transport.cancel(identity).pipe(
          Effect.catchAll(() =>
            Effect.succeed({
              requested: true,
              acknowledged: false,
              localCleanup: "unknown" as const,
              remoteOutcome: "unknown" as const,
            }),
          ),
          Effect.timeoutOption("5 seconds"),
          Effect.map((option) =>
            option._tag === "Some"
              ? option.value
              : {
                  requested: true,
                  acknowledged: false,
                  localCleanup: "unknown" as const,
                  remoteOutcome: "unknown" as const,
                },
          ),
        );
      const terminal = events.findLast((e) =>
        ["completed", "refused", "cancelled"].includes(e.payload.type),
      );
      const assertions: QualificationAssertionV1[] = [];
      const evidence: CapabilityEvidenceV1[] = [];
      for (const capability of [...new Set(input.requiredCapabilities)]) {
        const builtin =
          ["generation", "structuredOutput"].includes(capability) &&
          terminal?.payload.type === "completed";
        const assertion =
          !failure && identity && ports.assess
            ? yield* ports.assess(capability, events, identity).pipe(
                Effect.timeoutFail({
                  duration: Math.max(1, request.limits.deadline - ports.now()),
                  onTimeout: (): ProviderFailure => ({
                    _tag: "OutcomeUnknown",
                    retryClass: "never",
                    message: "Capability assertion exceeded observation bound",
                  }),
                }),
                Effect.catchAll(() =>
                  Effect.succeed({
                    passed: false,
                    reason: "Capability observation failed",
                  }),
                ),
              )
            : {
                passed: !failure && builtin,
                reason: builtin
                  ? "Observed a schema-valid terminal completion"
                  : "No bounded observation established this capability",
              };
        assertions.push({
          capability,
          ...assertion,
          evidenceType:
            input.binding.kind === "qualification"
              ? "live-observation"
              : "contract-fixture",
        });
        if (assertion.passed && identity) {
          evidence.push({
            capability,
            state:
              input.binding.kind === "qualification"
                ? "live-qualified"
                : "fixture-tested",
            profileId: request.profileId,
            transportId: request.transportId,
            profileHash: request.profileHash,
            sourceManifestHash: request.sourceManifestHash,
            transportVersion: request.transportVersion,
            controlsHash: controlsHash(request.controls),
            observedAt: ports.now(),
            expiresAt: input.binding.expiresAt,
            observedIdentity: identity,
            evidenceRef: input.binding.evidenceRef,
            ...(input.binding.kind === "qualification-fixture"
              ? {
                  fixtureManifestHash: input.binding.fixtureManifestHash,
                  endpointIdentity: input.binding.endpointIdentity,
                }
              : {}),
          });
        }
      }
      const confirmedCancellation =
        cancellation?.requested &&
        cancellation.acknowledged &&
        ["complete", "not-required"].includes(cancellation.localCleanup) &&
        cancellation.remoteOutcome === "cancelled";
      const uncertain =
        (cancellation?.requested &&
          ["pending", "unknown", "unsupported"].includes(
            cancellation.remoteOutcome,
          )) ||
        (failure
          ? [
              "OutcomeUnknown",
              "TransportDisconnected",
              "AuthenticationRequired",
            ].includes(failure._tag)
          : !terminal);
      const outcome = confirmedCancellation
        ? "cancelled"
        : uncertain
          ? "needs-action"
          : failure ||
              terminal?.payload.type === "refused" ||
              assertions.some((a) => !a.passed)
            ? "failed"
            : "success";
      return {
        schemaVersion: 1,
        profileId: request.profileId,
        transportId: request.transportId,
        requestedIdentity: {
          profileId: request.profileId,
          credentialProfileRef: request.credentialProfileRef,
        },
        ...(identity
          ? {
              observedIdentity: identity,
              ...(identity.kind === "api"
                ? { apiRevision: identity.endpointRevision }
                : { protocolVersion: identity.protocolVersion }),
            }
          : {}),
        ...(ports.transport.installedVersion
          ? { installedVersion: ports.transport.installedVersion }
          : {}),
        transportVersion: request.transportVersion,
        profileHash: request.profileHash,
        sourceManifestHash: request.sourceManifestHash,
        startedAt,
        completedAt: ports.now(),
        bounds: request.limits,
        outcome,
        assertions,
        evidence,
        eventTypes: events.map((e) => e.payload.type),
        ...(failure ? { failure } : {}),
        ...(cancellation ? { cancellation } : {}),
        ...(observedUsage ? { usage: observedUsage } : {}),
      };
    }),
  );
}
