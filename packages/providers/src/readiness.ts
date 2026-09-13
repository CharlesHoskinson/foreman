import { Effect } from "effect";
import type { Result } from "@foreman/pel";
import type {
  CapabilityEvidenceV1,
  ProbeFailure,
  ProbeInputV1,
  ProviderIdentityV1,
  ReadinessV1,
} from "./contract.js";
import { resolveProfile } from "./profiles.js";
import { exactIdentity } from "./registry.js";
export interface ReadinessMetadataV1 {
  readonly discovery?: ReadinessV1["discovery"];
  readonly authentication?: ReadinessV1["authentication"];
  readonly currency?: ReadinessV1["currency"];
  readonly identity?: ReadinessV1["identity"];
  readonly capabilities?: readonly CapabilityEvidenceV1[];
}
export interface ReadinessPortsV1 {
  readonly metadata: (
    input: ProbeInputV1,
  ) => Effect.Effect<ReadinessMetadataV1, ProbeFailure>;
  readonly workload: (
    input: ProbeInputV1,
  ) => Effect.Effect<readonly CapabilityEvidenceV1[], ProbeFailure>;
  readonly now: () => number;
}
export function qualifyIdentity(
  input: ProbeInputV1,
  observed: ProviderIdentityV1 | undefined,
): Result<ProviderIdentityV1, ProbeFailure> {
  const profile = resolveProfile(input.profileId);
  if (!profile.ok)
    return {
      ok: false,
      error: {
        _tag: "ModelUnavailable",
        retryClass: "never",
        message: "Exact profile is unavailable",
      },
    };
  if (!observed)
    return {
      ok: false,
      error: {
        _tag: "ProbeUnknown",
        retryClass: "never",
        message: "Protocol metadata did not establish model identity",
      },
    };
  if (
    !exactIdentity(
      profile.value,
      input.transportId,
      observed,
      input.credentialProfileRef,
    )
  )
    return {
      ok: false,
      error: {
        _tag: "ModelMismatch",
        retryClass: "never",
        message:
          "Observed protocol identity does not match the requested model and account",
      },
    };
  return { ok: true, value: observed };
}
export function probeReadiness(
  input: ProbeInputV1,
  ports: ReadinessPortsV1,
): Effect.Effect<ReadinessV1, ProbeFailure> {
  return Effect.gen(function* () {
    if (
      input.mode === "bounded-workload" &&
      (!input.limits ||
        input.limits.deadline <= ports.now() ||
        !input.credentialProfileRef)
    )
      return yield* Effect.fail({
        _tag: "UnsupportedCapability",
        retryClass: "never",
        message:
          "Bounded workload probes require explicit account and current limits",
        fieldPath: "limits",
      } as const);
    const metadata = yield* ports.metadata(input).pipe(
      Effect.timeoutFail({
        duration: input.limits
          ? Math.max(1, Math.min(10000, input.limits.deadline - ports.now()))
          : 10000,
        onTimeout: (): ProbeFailure => ({
          _tag: "ProbeUnknown",
          retryClass: "never",
          message: "Metadata observation timed out",
        }),
      }),
      Effect.catchAll(() => Effect.succeed({} as ReadinessMetadataV1)),
    );
    const checkedAt = ports.now();
    const authentication: ReadinessV1["authentication"] =
      metadata.authentication?.state === "signed-out"
        ? {
            state: "signed-out",
            remediation: "Authenticate the selected credential profile.",
          }
        : { state: metadata.authentication?.state ?? "unknown" };
    const verified = qualifyIdentity(input, metadata.identity?.observed);
    const identity: ReadinessV1["identity"] = verified.ok
      ? { state: "exact", observed: verified.value }
      : verified.error._tag === "ModelMismatch"
        ? { state: "mismatch" }
        : { state: "unknown" };
    const capabilities =
      input.mode === "bounded-workload"
        ? yield* ports
            .workload(input)
            .pipe(
              Effect.timeoutFail({
                duration: Math.max(1, input.limits!.deadline - ports.now()),
                onTimeout: (): ProbeFailure => ({
                  _tag: "ProbeUnknown",
                  retryClass: "never",
                  message: "Workload observation timed out",
                }),
              }),
            )
        : (metadata.capabilities ?? []);
    return {
      schemaVersion: 1,
      profileId: input.profileId,
      transportId: input.transportId,
      checkedAt,
      mode: input.mode,
      discovery: {
        ...metadata.discovery,
        state: metadata.discovery?.state ?? "unknown",
        observedAt: metadata.discovery?.observedAt ?? checkedAt,
        evidenceKind: "metadata",
        diagnostic: "Read-only transport discovery observation.",
      },
      authentication: {
        ...authentication,
        observedAt: metadata.authentication?.observedAt ?? checkedAt,
        evidenceKind: "metadata",
        diagnostic: "Selected account authentication observation.",
      },
      currency: {
        ...metadata.currency,
        state: metadata.currency?.state ?? "unknown",
        observedAt: metadata.currency?.observedAt ?? checkedAt,
        evidenceKind: "metadata",
        diagnostic: "Source and installed version currency observation.",
      },
      identity: {
        ...identity,
        observedAt: metadata.identity?.observedAt ?? checkedAt,
        evidenceKind: "metadata",
        diagnostic: "Exact protocol identity observation.",
      },
      capabilities,
    };
  });
}
