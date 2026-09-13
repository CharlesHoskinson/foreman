import { Effect } from "effect";
import type { Scope } from "effect";
import {
  ProviderGenerationPort,
  admitCell,
  lowerGenerationRequest,
  makeProviderGenerationPort,
  type AdmittedCellV1,
  type CapabilityEvidenceV1,
  type Capability,
  type GenerationRequest,
  type ProviderRequestV1,
  type ProviderTransport,
  type ProviderFailure,
  type TransportId,
} from "@foreman/providers";
import type { AuthoringServices } from "./pel-authoring-contract.js";
import {
  generatePelPlan,
  makeGenerationRequest,
  makeGenerationBudget,
  GenerationBudgetPort,
} from "./pel-generation.js";
import { makeLiveProviderTransport } from "./pel-provider-live.js";
import type { LiveProviderContext } from "./pel-provider-live.js";
import { readProviderEvidence } from "./pel-provider-evidence.js";
export {
  readProviderEvidence,
  decodeProviderEvidence,
} from "./pel-provider-evidence.js";
export interface LiveAuthoringGenerationPorts {
  readonly readEvidence?: (
    context: LiveProviderContext,
  ) => Effect.Effect<readonly CapabilityEvidenceV1[], ProviderFailure>;
  readonly makeTransport?: (
    request: ProviderRequestV1,
    context: LiveProviderContext,
  ) => Effect.Effect<ProviderTransport, ProviderFailure, Scope.Scope>;
  readonly now?: () => number;
}
const failure = (
  tag: "CapabilityUnverified" | "UnsupportedCapability",
  message: string,
  fieldPath?: string,
): ProviderFailure => ({
  _tag: tag,
  retryClass: "never",
  message,
  ...(fieldPath ? { fieldPath } : {}),
});
const unwrap = <T>(
  result: { ok: true; value: T } | { ok: false; error: ProviderFailure },
) => (result.ok ? Effect.succeed(result.value) : Effect.fail(result.error));
const apiRevisions: Partial<Record<TransportId, string>> = {
  "openai-responses": "v1",
  "xai-responses": "v1",
  "anthropic-messages": "2023-06-01",
  "google-interactions": "v1beta",
};
function requiredCapabilities(
  request: GenerationRequest,
): readonly Capability[] {
  return [
    "generation",
    "structuredOutput",
    ...(request.resolvedGrammarMode === "grammar" ||
    request.grammarMode === "grammar-required"
      ? ["grammar" as const]
      : []),
    ...(["grok-acp", "claude-code", "codex-app-server", "gemini-cli"].includes(
      request.transportId,
    )
      ? ["toolPolicyNone" as const]
      : []),
  ];
}
/** A USD ceiling belongs to this operation, independently of M2's abstract cost-unit allowance. */
export function authoringUsdLimit(
  context: LiveProviderContext,
): Effect.Effect<number, ProviderFailure> {
  const raw = context.environment.FOREMAN_PROVIDER_MAX_COST_USD;
  if (
    raw !== undefined &&
    (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw) ||
      !Number.isFinite(Number(raw)) ||
      Number(raw) <= 0 ||
      Number(raw) > 5)
  )
    return Effect.fail(
      failure(
        "UnsupportedCapability",
        "FOREMAN_PROVIDER_MAX_COST_USD must be a decimal greater than zero and at most 5",
        "FOREMAN_PROVIDER_MAX_COST_USD",
      ),
    );
  return Effect.succeed(raw === undefined ? 5 : Number(raw));
}
function provisionalAdmission(
  request: GenerationRequest,
  evidence: readonly CapabilityEvidenceV1[],
  now: number,
): Effect.Effect<AdmittedCellV1, ProviderFailure> {
  const transportId = request.transportId as TransportId;
  // Evidence selects no provider or alternate model. These candidates only establish that the already-selected cell has current live observations before local transport setup.
  const candidates = evidence.filter(
    (e) =>
      e.state === "live-qualified" &&
      e.fixtureManifestHash === undefined &&
      e.endpointIdentity === undefined &&
      e.capability === "generation" &&
      e.profileId === request.modelProfileId &&
      e.transportId === transportId &&
      e.observedIdentity?.credentialProfileRef === request.credentialProfileRef,
  );
  for (const candidate of candidates) {
    const identity = candidate.observedIdentity!;
    const revision =
      apiRevisions[transportId] ??
      (transportId === "grok-acp"
        ? "1"
        : identity.kind === "native"
          ? identity.protocolVersion
          : "");
    const admitted = admitCell(
      request.modelProfileId,
      transportId,
      requiredCapabilities(request),
      evidence,
      {
        kind: "product",
        now,
        transportVersion: candidate.transportVersion,
        expectedIdentityRevision: revision,
        controls: request.controls,
        credentialProfileRef: request.credentialProfileRef,
      },
    );
    if (admitted.ok) return Effect.succeed(admitted.value);
  }
  return Effect.fail(
    failure(
      "CapabilityUnverified",
      "Generation requires current exact live generation and structured-output evidence",
      "evidence",
    ),
  );
}
/** M2 owns all attempts, repairs and aggregate time/token accounting. This service adds admission and one provider call per existing attempt. */
export function makeLiveAuthoringGenerate(
  context: LiveProviderContext,
  ports: LiveAuthoringGenerationPorts = {},
): NonNullable<AuthoringServices["generate"]> {
  return (input) => {
    const request = makeGenerationRequest(input);
    const now = ports.now ?? Date.now;
    return generatePelPlan(request, input.snapshot).pipe(
      Effect.provideService(
        GenerationBudgetPort,
        makeGenerationBudget(input.snapshot.generationLimits),
      ),
      Effect.provideService(ProviderGenerationPort, {
        generate: (attempt) =>
          Effect.scoped(
            Effect.gen(function* () {
              const operationUsd = yield* authoringUsdLimit(context);
              const records = yield* (
                ports.readEvidence ?? readProviderEvidence
              )(context);
              const evidence = records.filter(
                (record) =>
                  record.state === "live-qualified" &&
                  record.fixtureManifestHash === undefined &&
                  record.endpointIdentity === undefined,
              );
              const admitted = yield* provisionalAdmission(
                attempt,
                evidence,
                now(),
              );
              const maxAttempts =
                Math.min(2, input.snapshot.generationLimits.maxRepairs) + 1;
              const perAttemptUsd = operationUsd / maxAttempts;
              const seed = yield* unwrap(
                lowerGenerationRequest(attempt, admitted, perAttemptUsd),
              );
              const transport = yield* (
                ports.makeTransport ?? makeLiveProviderTransport
              )(seed, context);
              let revision =
                apiRevisions[seed.transportId] ??
                (seed.transportId === "grok-acp" ? "1" : transport.version);
              if (seed.transportId === "gemini-cli") {
                const readiness = yield* transport.probe({
                  profileId: seed.profileId,
                  transportId: seed.transportId,
                  credentialProfileRef: seed.credentialProfileRef,
                  mode: "metadata-only",
                });
                const installed = readiness.discovery.installedVersion;
                if (!installed)
                  return yield* Effect.fail(
                    failure(
                      "CapabilityUnverified",
                      "Gemini CLI did not establish its installed protocol revision",
                      "expectedIdentityRevision",
                    ),
                  );
                revision = installed;
              }
              const finalAdmit = (current: GenerationRequest) =>
                admitCell(
                  current.modelProfileId,
                  seed.transportId,
                  requiredCapabilities(current),
                  evidence,
                  {
                    kind: "product",
                    now: now(),
                    transportVersion: transport.version,
                    expectedIdentityRevision: revision,
                    controls: current.controls,
                    credentialProfileRef: current.credentialProfileRef,
                  },
                );
              yield* unwrap(finalAdmit(attempt));
              return yield* makeProviderGenerationPort({
                transport,
                admit: finalAdmit,
                maxCostUsd: perAttemptUsd,
                now,
              }).generate(attempt);
            }),
          ),
      }),
    );
  };
}
