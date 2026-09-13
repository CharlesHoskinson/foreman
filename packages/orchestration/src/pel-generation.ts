import { randomUUID } from "node:crypto";
import { canonicalize, sha256Hex } from "@foreman/core";
import { Cause, Clock, Context, Effect, Exit, Option } from "effect";
import type { AuthoringSnapshotV1, AuthoringDiagnostic } from "@foreman/pel";
import {
  ProviderGenerationPort,
  type GenerationAttempt,
  type GenerationRequest,
  type ProviderUsageV1,
  type ProviderFailure,
  type ProviderIdentityV1,
} from "@foreman/providers";
import {
  validateAuthoringControlsV1,
  validateAuthoringSnapshotV1,
  checkPel,
  planPel,
} from "@foreman/pel";

export interface GenerationBudgetInputV1 {
  readonly operationId: string;
  readonly attempt: GenerationAttempt;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly conservativeSpendUnits: number;
  readonly deadline: number;
}
export interface GenerationBudgetReservationV1 extends GenerationBudgetInputV1 {
  readonly reference: string;
}
export interface GenerationBudgetFailure {
  readonly _tag: "GenerationBudgetFailure";
  readonly message: string;
}
export interface GenerationBudgetService {
  readonly reserve: (
    input: GenerationBudgetInputV1,
  ) => Effect.Effect<GenerationBudgetReservationV1, GenerationBudgetFailure>;
  readonly settle: (
    reservation: GenerationBudgetReservationV1,
    usage: ProviderUsageV1,
  ) => Effect.Effect<void, GenerationBudgetFailure>;
}
export class GenerationBudgetPort extends Context.Tag(
  "@foreman/orchestration/GenerationBudgetPort",
)<GenerationBudgetPort, GenerationBudgetService>() {}

const finiteCount = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;
export function makeGenerationBudget(limits: {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxCostUnits: number;
}): GenerationBudgetService {
  const reservations = new Map<
    string,
    {
      reservation: GenerationBudgetReservationV1;
      settled: boolean;
      input: number;
      output: number;
      cost: number;
    }
  >();
  let operationId: string | undefined;
  const failure = (message: string): GenerationBudgetFailure => ({
    _tag: "GenerationBudgetFailure",
    message,
  });
  return {
    reserve: (input) =>
      Effect.suspend(() => {
        if (
          ![
            limits.maxInputTokens,
            limits.maxOutputTokens,
            limits.maxCostUnits,
            input.maxInputTokens,
            input.maxOutputTokens,
            input.conservativeSpendUnits,
            input.deadline,
          ].every(finiteCount) ||
          !input.operationId ||
          ![0, 1, 2].includes(input.attempt)
        )
          return Effect.fail(failure("Invalid finite generation reservation"));
        if (operationId !== undefined && operationId !== input.operationId)
          return Effect.fail(
            failure("Generation allowance belongs to another operation"),
          );
        const reference = `${input.operationId}/attempt/${input.attempt}/budget`;
        if (reservations.has(reference))
          return Effect.fail(failure("Attempt already reserved"));
        let totalInput = input.maxInputTokens,
          totalOutput = input.maxOutputTokens,
          totalCost = input.conservativeSpendUnits;
        for (const row of reservations.values()) {
          totalInput += row.input;
          totalOutput += row.output;
          totalCost += row.cost;
        }
        if (
          totalInput > limits.maxInputTokens ||
          totalOutput > limits.maxOutputTokens ||
          totalCost > limits.maxCostUnits
        )
          return Effect.fail(failure("Aggregate generation budget exhausted"));
        operationId = input.operationId;
        const reservation = Object.freeze({ ...input, reference });
        reservations.set(reference, {
          reservation,
          settled: false,
          input: input.maxInputTokens,
          output: input.maxOutputTokens,
          cost: input.conservativeSpendUnits,
        });
        return Effect.succeed(reservation);
      }),
    settle: (reservation, usage) =>
      Effect.suspend(() => {
        const row = reservations.get(reservation.reference);
        if (!row || row.reservation !== reservation || row.settled)
          return Effect.fail(
            failure("Unknown or already settled generation reservation"),
          );
        const cost = usage.providerCounters.costUnits;
        const input = usage.inputTokens ?? row.input,
          output = usage.outputTokens ?? row.output;
        const spend = typeof cost === "number" ? cost : row.cost;
        if (![input, output, spend].every(finiteCount))
          return Effect.fail(failure("Invalid usage accounting"));
        row.input = input;
        row.output = output;
        row.cost = spend;
        row.settled = true;
        if (
          input > reservation.maxInputTokens ||
          output > reservation.maxOutputTokens ||
          spend > reservation.conservativeSpendUnits
        )
          return Effect.fail(
            failure("Provider usage exceeded its reservation"),
          );
        return Effect.void;
      }),
  };
}

export function generationId(input: {
  readonly promptDigest: string;
  readonly snapshotDigest: string;
  readonly modelProfileId: string;
  readonly transportId: string;
  readonly sessionNonce: string;
}): string {
  return sha256Hex(canonicalize(input));
}
export function generationEffectId(
  id: string,
  attempt: GenerationAttempt,
): string {
  return `${id}/attempt/${attempt}`;
}

export const PEL_GENERATION_OUTPUT_SCHEMA: GenerationRequest["outputSchema"] =
  freezeDeep({
    id: "schema:pel-source-v1",
    content: {
      type: "association",
      fields: [
        {
          key: "pelSource",
          schema: { type: "string", maxBytes: 1_048_576 },
          required: true,
        },
      ],
      additionalKeys: false,
    },
  } as const);

export function makeGenerationRequest(input: {
  readonly prompt: string;
  readonly snapshot: AuthoringSnapshotV1;
  readonly modelProfileId: string;
  readonly transportId: string;
  readonly controls: GenerationRequest["controls"];
  readonly credentialProfileRef: string;
  readonly grammarMode?: GenerationRequest["grammarMode"];
  readonly sessionNonce?: string;
}): GenerationRequest {
  const id = generationId({
    promptDigest: sha256Hex(input.prompt),
    snapshotDigest: input.snapshot.snapshotDigest,
    modelProfileId: input.modelProfileId,
    transportId: input.transportId,
    sessionNonce: input.sessionNonce ?? randomUUID(),
  });
  const bounds = input.snapshot.generationLimits;
  const calls = Math.min(2, bounds.maxRepairs) + 1;
  return {
    generationId: id,
    effectId: generationEffectId(id, 0),
    modelProfileId: input.modelProfileId,
    transportId: input.transportId,
    controls: input.controls,
    credentialProfileRef: input.credentialProfileRef,
    prompt: input.prompt,
    trustedTemplateId: "foreman:pel-generation-v1",
    registryCatalog: input.snapshot.registry.descriptors,
    capabilitySnapshot: input.snapshot.policy,
    artifacts: input.snapshot.artifactDescriptors.map((artifact) => ({
      id: artifact.id,
      sourceDigest:
        input.snapshot.artifactDigests.find(
          (digest) => digest.id === artifact.id,
        )?.digest ?? "",
      content: artifact.content,
    })),
    outputSchema: PEL_GENERATION_OUTPUT_SCHEMA,
    grammarMode: input.grammarMode ?? "auto",
    resolvedGrammarMode: "envelope",
    limits: {
      maxInputTokens: Math.floor(bounds.maxInputTokens / calls),
      maxOutputTokens: Math.floor(bounds.maxOutputTokens / calls),
      maxCostUnits: Math.floor(bounds.maxCostUnits / calls),
      maxSourceBytes: Math.min(bounds.maxSourceBytes, 1_048_576),
      timeoutMs: Math.min(bounds.attemptTimeoutMs, 60_000),
      deadline: 0,
    },
    generationBudgetReservationRef: "",
    attempt: 0,
  };
}

export interface GenerationAttemptDiagnosticV1 {
  readonly attempt: GenerationAttempt;
  readonly diagnostics: readonly AuthoringDiagnostic[];
  readonly sourceSample: string;
}
export type PelGenerationCause =
  | {
      readonly _tag: "DeadlineExceeded";
      readonly scope: "attempt" | "operation";
    }
  | { readonly _tag: "Cancelled" }
  | { readonly _tag: "Refusal"; readonly message: string };
export interface PelGenerationFailure {
  readonly _tag: "PelGenerationFailure";
  readonly code:
    | "PEL_PROFILE_UNSUPPORTED"
    | "PEL_SCHEMA"
    | "PEL_GENERATION_EXHAUSTED"
    | "PEL_GENERATION_BUDGET_EXHAUSTED"
    | "PEL_GENERATION_PROVIDER_FAILED"
    | "PEL_GENERATION_TIMEOUT"
    | "PEL_GENERATION_CANCELLED"
    | "PEL_GENERATION_REFUSED";
  readonly message: string;
  readonly attemptDiagnostics: readonly GenerationAttemptDiagnosticV1[];
  readonly cumulativeUsage: ProviderUsageV1;
  readonly providerCause?: ProviderFailure;
  readonly cause?: PelGenerationCause;
}

/** Only a bounded, complete envelope is eligible for local syntax repair. */
export function decodeGenerationEnvelope(
  value: unknown,
):
  | { readonly ok: true; readonly pelSource: string }
  | { readonly ok: false; readonly message: string } {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("pelSource" in value) ||
    typeof value.pelSource !== "string"
  )
    return {
      ok: false,
      message: "Expected the closed {pelSource:string} envelope",
    };
  if (Buffer.byteLength(value.pelSource, "utf8") > 1_048_576)
    return { ok: false, message: "Source exceeds 1 MiB" };
  return { ok: true, pelSource: value.pelSource };
}

export interface GeneratedPlanV1 {
  readonly schemaVersion: 1;
  readonly pelSource: string;
  readonly preview: ReturnType<typeof planPel>;
  readonly attemptCount: number;
  readonly providerIdentities: readonly ProviderIdentityV1[];
  readonly cumulativeUsage: ProviderUsageV1;
}

function fatalProviderFailure(failure: ProviderFailure): ProviderFailure {
  switch (failure._tag) {
    case "ModelUnavailable":
    case "ModelMismatch":
    case "UnsupportedCapability":
    case "CapabilityUnverified":
    case "PromptChannelUnsupported":
    case "AuthenticationRequired":
    case "ProbeUnknown":
    case "OutputInvalid":
    case "OutputIncomplete":
    case "MalformedEvent":
    case "ContinuationMismatch":
    case "ResumeUnavailable":
    case "OutcomeUnknown":
    case "RateLimited":
    case "TransportDisconnected":
      return failure;
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
}

function addDecimal(left: string, right: string): string {
  const [li = "0", lf = ""] = left.split("."),
    [ri = "0", rf = ""] = right.split(".");
  const precision = Math.max(lf.length, rf.length);
  const sum = (
    BigInt(li + lf.padEnd(precision, "0")) +
    BigInt(ri + rf.padEnd(precision, "0"))
  )
    .toString()
    .padStart(precision + 1, "0");
  return precision
    ? `${sum.slice(0, -precision)}.${sum.slice(-precision)}`
    : sum;
}
function cumulativeUsage(
  attempts: readonly ProviderUsageV1[],
): ProviderUsageV1 {
  const result: {
    inputTokens?: number;
    outputTokens?: number;
    cachedReadTokens?: number;
    cacheWriteTokens?: number;
    costUsd?: string;
    priceScheduleRef?: string;
    providerCounters: Record<string, number | string>;
  } = { providerCounters: {} };
  for (const field of [
    "inputTokens",
    "outputTokens",
    "cachedReadTokens",
    "cacheWriteTokens",
  ] as const) {
    if (
      attempts.length &&
      attempts.every((usage) => usage[field] !== undefined)
    ) {
      const total = attempts.reduce((sum, usage) => sum + usage[field]!, 0);
      if (Number.isSafeInteger(total)) result[field] = total;
    }
  }
  if (attempts.length && attempts.every((usage) => usage.costUsd !== undefined))
    result.costUsd = attempts.reduce(
      (sum, usage) => addDecimal(sum, usage.costUsd!),
      "0",
    );
  if (
    attempts[0]?.priceScheduleRef &&
    attempts.every(
      (usage) => usage.priceScheduleRef === attempts[0]!.priceScheduleRef,
    )
  )
    result.priceScheduleRef = attempts[0].priceScheduleRef;
  attempts.forEach((usage, attempt) => {
    for (const field of [
      "inputTokens",
      "outputTokens",
      "cachedReadTokens",
      "cacheWriteTokens",
      "costUsd",
      "priceScheduleRef",
    ] as const) {
      const value = usage[field];
      if (value !== undefined)
        result.providerCounters[`attempt/${attempt}/usage/${field}`] = value;
    }
    for (const [key, value] of Object.entries(usage.providerCounters))
      result.providerCounters[`attempt/${attempt}/providerCounters/${key}`] =
        value;
  });
  return result;
}
function validUsage(usage: ProviderUsageV1): boolean {
  if (
    usage === null ||
    typeof usage !== "object" ||
    usage.providerCounters === null ||
    typeof usage.providerCounters !== "object" ||
    Array.isArray(usage.providerCounters)
  )
    return false;
  if (
    ![
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedReadTokens,
      usage.cacheWriteTokens,
    ].every((count) => count === undefined || finiteCount(count))
  )
    return false;
  if (
    usage.costUsd !== undefined &&
    (typeof usage.costUsd !== "string" ||
      usage.costUsd.length > 128 ||
      !/^\d+(?:\.\d+)?$/.test(usage.costUsd))
  )
    return false;
  const counters = Object.entries(usage.providerCounters);
  return (
    counters.length <= 100 &&
    counters.every(
      ([key, value]) =>
        key.length <= 256 &&
        ((typeof value === "number" && Number.isFinite(value)) ||
          (typeof value === "string" && Buffer.byteLength(value) <= 4096)),
    )
  );
}
function freezeDeep<T>(input: T): T {
  if (input !== null && typeof input === "object" && !Object.isFrozen(input)) {
    for (const item of Object.values(input)) freezeDeep(item);
    Object.freeze(input);
  }
  return input;
}
function localDiagnostic(message: string): AuthoringDiagnostic {
  return {
    code: "PEL_SCHEMA",
    severity: "error",
    message,
    span: { start: 0, end: 0, line: 1, column: 1, endLine: 1, endColumn: 1 },
    relatedSpans: [],
    expectedForms: ["{pelSource:string}"],
  };
}

/** Scan only the admitted prefix. Never copy the complete oversized response. */
function utf8Prefix(value: string, maxBytes: number): string {
  let end = 0,
    bytes = 0;
  for (const point of value) {
    const width = Buffer.byteLength(point, "utf8");
    if (bytes + width > maxBytes) break;
    bytes += width;
    end += point.length;
  }
  return value.slice(0, end);
}

export function generatePelPlan(
  inputRequest: GenerationRequest,
  snapshot: AuthoringSnapshotV1,
): Effect.Effect<
  GeneratedPlanV1,
  PelGenerationFailure,
  ProviderGenerationPort | GenerationBudgetPort
> {
  return Effect.suspend(() => {
    const request = freezeDeep(structuredClone(inputRequest));
    const attempts: GenerationAttemptDiagnosticV1[] = [],
      usages: ProviderUsageV1[] = [],
      identities: ProviderIdentityV1[] = [];
    const failure = (
      code: PelGenerationFailure["code"],
      message: string,
      extra: Partial<
        Pick<PelGenerationFailure, "providerCause" | "cause">
      > = {},
    ): PelGenerationFailure => ({
      _tag: "PelGenerationFailure",
      code,
      message,
      attemptDiagnostics: [...attempts],
      cumulativeUsage: cumulativeUsage(usages),
      ...extra,
    });
    const providerFailure = (cause: ProviderFailure) =>
      failure("PEL_GENERATION_PROVIDER_FAILED", cause.message.slice(0, 4096), {
        providerCause: fatalProviderFailure(cause),
      });
    const body = Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      const validated = validateAuthoringSnapshotV1(snapshot);
      if (!validated.ok)
        return yield* Effect.fail(
          failure("PEL_SCHEMA", "Invalid authoring snapshot"),
        );
      const immutableSnapshot = freezeDeep(validated.value);
      const profile = immutableSnapshot.providerProfiles.find(
        (candidate) =>
          candidate.profileId === request.modelProfileId &&
          candidate.transportId === request.transportId,
      );
      if (
        !profile ||
        !immutableSnapshot.policy.allowedModelTransports.some(
          (pair) =>
            pair.profileId === request.modelProfileId &&
            pair.transportId === request.transportId,
        ) ||
        !immutableSnapshot.policy.allowedCredentialProfileRefs.includes(
          request.credentialProfileRef,
        )
      )
        return yield* Effect.fail(
          failure(
            "PEL_PROFILE_UNSUPPORTED",
            "Exact model, transport or credential reference is not admitted",
          ),
        );
      if (
        !validateAuthoringControlsV1(request.controls, profile).ok ||
        request.controls.toolChoice !== "none"
      )
        return yield* Effect.fail(
          failure(
            "PEL_PROFILE_UNSUPPORTED",
            "Generation requires admitted controls and toolChoice none",
          ),
        );
      const qualified =
        profile.grammarSupport === "qualified" &&
        profile.evidenceKind === "qualified";
      if (
        !["auto", "envelope", "grammar-required"].includes(
          request.grammarMode,
        ) ||
        (request.grammarMode === "grammar-required" && !qualified)
      )
        return yield* Effect.fail(
          failure(
            "PEL_PROFILE_UNSUPPORTED",
            "The exact endpoint lacks qualified grammar support",
          ),
        );
      const bounds = immutableSnapshot.generationLimits;
      if (
        !Object.values(request.limits).every(finiteCount) ||
        request.limits.maxInputTokens > bounds.maxInputTokens ||
        request.limits.maxOutputTokens > bounds.maxOutputTokens ||
        request.limits.maxCostUnits > bounds.maxCostUnits ||
        request.limits.maxSourceBytes >
          Math.min(bounds.maxSourceBytes, 1_048_576) ||
        request.limits.timeoutMs > Math.min(bounds.attemptTimeoutMs, 60_000) ||
        request.limits.timeoutMs === 0 ||
        request.attempt !== 0 ||
        !/^[a-f0-9]{64}$/.test(request.generationId) ||
        request.effectId !== generationEffectId(request.generationId, 0)
      )
        return yield* Effect.fail(
          failure(
            "PEL_SCHEMA",
            "Generation request exceeds its finite admission or has an invalid attempt identity",
          ),
        );
      if (
        request.trustedTemplateId !== "foreman:pel-generation-v1" ||
        canonicalize(request.outputSchema) !==
          canonicalize(PEL_GENERATION_OUTPUT_SCHEMA) ||
        canonicalize(request.registryCatalog) !==
          canonicalize(immutableSnapshot.registry.descriptors) ||
        canonicalize(request.capabilitySnapshot) !==
          canonicalize(immutableSnapshot.policy) ||
        Buffer.byteLength(request.prompt) > 1_048_576
      )
        return yield* Effect.fail(
          failure(
            "PEL_SCHEMA",
            "Generation template, catalog, schema or prompt is invalid",
          ),
        );
      const expectedArtifacts = immutableSnapshot.artifactDescriptors.map(
        (artifact) => ({
          id: artifact.id,
          sourceDigest:
            immutableSnapshot.artifactDigests.find(
              (digest) => digest.id === artifact.id,
            )?.digest ?? "",
          content: artifact.content,
        }),
      );
      if (canonicalize(request.artifacts) !== canonicalize(expectedArtifacts))
        return yield* Effect.fail(
          failure(
            "PEL_SCHEMA",
            "Generation artifacts do not match the immutable snapshot",
          ),
        );
      const stableRequest = request;
      const provider = yield* ProviderGenerationPort;
      const budget = yield* GenerationBudgetPort;
      const localBudget = makeGenerationBudget(bounds);
      const deadline = Math.min(
        startedAt + Math.min(bounds.maxElapsedMs, 180_000),
        request.limits.deadline || Number.MAX_SAFE_INTEGER,
      );
      const maxAttempt = Math.min(2, bounds.maxRepairs);
      let previousSource = "";
      for (let index = 0; index <= maxAttempt; index++) {
        const attempt = index as GenerationAttempt;
        const now = yield* Clock.currentTimeMillis;
        if (now >= deadline)
          return yield* Effect.fail(
            failure(
              "PEL_GENERATION_TIMEOUT",
              "Generation operation deadline elapsed",
              { cause: { _tag: "DeadlineExceeded", scope: "operation" } },
            ),
          );
        const input: GenerationBudgetInputV1 = {
          operationId: request.generationId,
          attempt,
          maxInputTokens: request.limits.maxInputTokens,
          maxOutputTokens: request.limits.maxOutputTokens,
          conservativeSpendUnits: request.limits.maxCostUnits,
          deadline,
        };
        const localReservation = yield* localBudget
          .reserve(input)
          .pipe(
            Effect.mapError((error) =>
              failure("PEL_GENERATION_BUDGET_EXHAUSTED", error.message),
            ),
          );
        const reservation = yield* budget
          .reserve(input)
          .pipe(
            Effect.mapError((error) =>
              failure("PEL_GENERATION_BUDGET_EXHAUSTED", error.message),
            ),
          );
        if (
          typeof reservation.reference !== "string" ||
          !reservation.reference.trim() ||
          Buffer.byteLength(reservation.reference) > 4096 ||
          Object.entries(input).some(
            ([key, value]) =>
              reservation[key as keyof GenerationBudgetInputV1] !== value,
          )
        )
          return yield* Effect.fail(
            failure(
              "PEL_GENERATION_BUDGET_EXHAUSTED",
              "Generation budget returned an invalid reservation identity or reference",
            ),
          );
        const reservedAt = yield* Clock.currentTimeMillis;
        if (reservedAt >= deadline) {
          yield* Effect.uninterruptible(
            budget.settle(reservation, { providerCounters: {} }),
          ).pipe(
            Effect.mapError((error) =>
              failure("PEL_GENERATION_BUDGET_EXHAUSTED", error.message),
            ),
          );
          return yield* Effect.fail(
            failure(
              "PEL_GENERATION_TIMEOUT",
              "Generation deadline elapsed during reservation",
              { cause: { _tag: "DeadlineExceeded", scope: "operation" } },
            ),
          );
        }
        const call: GenerationRequest = freezeDeep({
          ...stableRequest,
          attempt,
          effectId: generationEffectId(request.generationId, attempt),
          resolvedGrammarMode:
            request.grammarMode !== "envelope" && qualified
              ? "grammar"
              : "envelope",
          generationBudgetReservationRef: reservation.reference,
          limits: {
            ...request.limits,
            deadline,
            timeoutMs: Math.min(
              request.limits.timeoutMs,
              deadline - reservedAt,
            ),
          },
          ...(attempt > 0
            ? {
                repair: {
                  previousSource,
                  diagnostics: attempts.at(-1)!.diagnostics,
                  snapshotDigest: immutableSnapshot.snapshotDigest,
                  applicableSignatures: request.registryCatalog,
                },
              }
            : {}),
        });
        const outcome = yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const exit = yield* Effect.exit(
              restore(
                provider.generate(call).pipe(
                  Effect.timeoutFail({
                    duration: call.limits.timeoutMs,
                    onTimeout: () =>
                      failure(
                        "PEL_GENERATION_TIMEOUT",
                        "Generation call deadline elapsed",
                        {
                          cause: {
                            _tag: "DeadlineExceeded",
                            scope: "attempt",
                          },
                        },
                      ),
                  }),
                ),
              ),
            );
            const reported = Exit.isSuccess(exit)
              ? exit.value.usage
              : Option.getOrUndefined(Cause.failureOption(exit.cause));
            const usage = Exit.isSuccess(exit)
              ? exit.value.usage
              : reported && "usage" in reported
                ? reported.usage
                : undefined;
            const accounting =
              usage && validUsage(usage) ? usage : { providerCounters: {} };
            usages.push(accounting);
            const localSettled = yield* Effect.either(
              localBudget.settle(localReservation, accounting),
            );
            const settlementAt = yield* Clock.currentTimeMillis;
            const externalSettled = yield* Effect.either(
              Effect.interruptible(budget.settle(reservation, accounting)).pipe(
                Effect.timeoutFail({
                  duration: Math.max(0, deadline - settlementAt),
                  onTimeout: (): GenerationBudgetFailure => ({
                    _tag: "GenerationBudgetFailure",
                    message: "Generation budget settlement deadline elapsed",
                  }),
                }),
              ),
            );
            if (localSettled._tag === "Left" || externalSettled._tag === "Left")
              return yield* Effect.fail(
                failure(
                  "PEL_GENERATION_BUDGET_EXHAUSTED",
                  localSettled._tag === "Left"
                    ? localSettled.left.message
                    : externalSettled._tag === "Left"
                      ? externalSettled.left.message
                      : "Budget settlement failed",
                ),
              );
            return exit;
          }),
        );
        if (Exit.isFailure(outcome)) {
          const cause = Cause.failureOption(outcome.cause);
          if (Option.isSome(cause))
            return yield* Effect.fail(
              cause.value._tag === "PelGenerationFailure"
                ? failure(
                    cause.value.code,
                    cause.value.message,
                    cause.value.cause ? { cause: cause.value.cause } : {},
                  )
                : providerFailure(cause.value),
            );
          if (Cause.isInterruptedOnly(outcome.cause))
            return yield* Effect.fail(
              failure("PEL_GENERATION_CANCELLED", "Generation cancelled", {
                cause: { _tag: "Cancelled" },
              }),
            );
          return yield* Effect.fail(
            providerFailure({
              _tag: "OutcomeUnknown",
              retryClass: "never",
              message:
                "Provider terminated without a complete observed outcome",
            }),
          );
        }
        if ((yield* Clock.currentTimeMillis) >= deadline)
          return yield* Effect.fail(
            failure(
              "PEL_GENERATION_TIMEOUT",
              "Generation deadline elapsed before candidate validation",
              { cause: { _tag: "DeadlineExceeded", scope: "operation" } },
            ),
          );
        const response = outcome.value;
        if (!validUsage(response.usage))
          return yield* Effect.fail(
            providerFailure({
              _tag: "MalformedEvent",
              retryClass: "never",
              message: "Invalid provider usage accounting",
            }),
          );
        const identity = response.providerIdentity;
        if (
          !identity ||
          identity.profileId !== request.modelProfileId ||
          identity.transportId !== request.transportId ||
          identity.credentialProfileRef !== request.credentialProfileRef
        )
          return yield* Effect.fail(
            providerFailure({
              _tag: "ModelMismatch",
              retryClass: "never",
              message:
                "Observed provider identity differs from the admitted selection",
              ...(identity ? { providerIdentity: identity } : {}),
            }),
          );
        identities.push(identity);
        if (response.refusal)
          return yield* Effect.fail(
            failure("PEL_GENERATION_REFUSED", "Provider refused generation", {
              cause: {
                _tag: "Refusal",
                message: response.refusal.message.slice(0, 4096),
              },
            }),
          );
        const envelope = decodeGenerationEnvelope({
          pelSource: response.pelSource,
        });
        previousSource =
          typeof response.pelSource === "string" ? response.pelSource : "";
        let diagnostics: readonly AuthoringDiagnostic[];
        if (
          !envelope.ok ||
          Buffer.byteLength(previousSource) > request.limits.maxSourceBytes
        )
          diagnostics = [
            localDiagnostic(
              envelope.ok
                ? "Source exceeds the admitted byte bound"
                : envelope.message,
            ),
          ];
        else {
          const checked = checkPel({
            source: new TextEncoder().encode(previousSource),
            snapshot: immutableSnapshot,
          });
          if (checked.tag === "ok") {
            const preview = planPel(checked.checked);
            if ((yield* Clock.currentTimeMillis) >= deadline)
              return yield* Effect.fail(
                failure(
                  "PEL_GENERATION_TIMEOUT",
                  "Generation deadline elapsed during candidate validation",
                  { cause: { _tag: "DeadlineExceeded", scope: "operation" } },
                ),
              );
            return {
              schemaVersion: 1 as const,
              pelSource: previousSource,
              preview,
              attemptCount: attempt + 1,
              providerIdentities: [...identities],
              cumulativeUsage: cumulativeUsage(usages),
            };
          }
          diagnostics = checked.diagnostics;
        }
        const boundedDiagnostics = diagnostics
          .slice(0, 100)
          .map((diagnostic) => ({
            ...diagnostic,
            message: diagnostic.message.slice(0, 4096),
            expectedForms: diagnostic.expectedForms.slice(0, 20),
            relatedSpans: diagnostic.relatedSpans.slice(0, 20),
          }));
        attempts.push({
          attempt,
          diagnostics: boundedDiagnostics,
          sourceSample: utf8Prefix(previousSource, 4096),
        });
        previousSource = utf8Prefix(
          previousSource,
          request.limits.maxSourceBytes,
        );
      }
      return yield* Effect.fail(
        failure(
          "PEL_GENERATION_EXHAUSTED",
          `All ${maxAttempt + 1} candidate validation attempts were invalid`,
        ),
      );
    });
    return Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.scoped(body).pipe(
        Effect.timeoutFail({
          duration: Math.min(
            snapshot.generationLimits.maxElapsedMs,
            180_000,
            request.limits.deadline > 0
              ? Math.max(0, request.limits.deadline - now)
              : 180_000,
          ),
          onTimeout: () =>
            failure(
              "PEL_GENERATION_TIMEOUT",
              "Generation operation deadline elapsed",
              { cause: { _tag: "DeadlineExceeded", scope: "operation" } },
            ),
        }),
      ),
    );
  });
}
