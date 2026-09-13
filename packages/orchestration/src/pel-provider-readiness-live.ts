import { join } from "node:path";
import { Effect } from "effect";
import type {
  ProviderTransport,
  ProbeInputV1,
  ReadinessV1,
} from "@foreman/providers";
import { resolveProfile as resolveModel } from "@foreman/providers";
import type { LiveProviderContext } from "./pel-provider-live.js";
import { readPreflightRecord } from "./vendor-preflight-store.js";
import {
  decodeVendorPreflightRecordV1,
  isVendorPreflightContractFailure,
  type VendorId,
  type VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";
import { tryGetEmbeddedCapabilityTable } from "./vendor-preflight-embedded.js";
import type { VendorCapabilityV1 } from "./vendor-preflight-manifest.js";
import { classifyCurrency } from "./vendor-preflight.js";
import { PathLookup, livePathLookup } from "./queue-services.js";
import { resolveProfile, liveCredentialProfile } from "./credential-profile.js";
import {
  readProfilePreflightRecord,
  profilePreflightRecordPath,
} from "./credential-profile-preflight.js";

/** Stored observations are hints with a short host freshness window, never qualification evidence. */
export const PREFLIGHT_READINESS_MAX_AGE_MS = 15 * 60 * 1000;
interface StoredReadinessRecord {
  readonly record: VendorPreflightRecordV1;
  readonly credentialProfileRef?: string;
}
export interface LiveReadinessPorts {
  readonly now?: () => number;
  readonly capability?: (vendor: VendorId) => VendorCapabilityV1 | null;
  readonly executable?: (name: string) => Effect.Effect<string | null>;
  readonly record?: (
    input: ProbeInputV1,
    vendor: VendorId,
  ) => Effect.Effect<StoredReadinessRecord | undefined>;
}
function storedRecord(
  input: ProbeInputV1,
  vendor: VendorId,
  context: LiveProviderContext,
): Effect.Effect<StoredReadinessRecord | undefined> {
  return Effect.gen(function* () {
    const profile =
      /^profile:(grok|codex):([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/.exec(
        input.credentialProfileRef,
      );
    if (profile) {
      const selectedVendor = profile[1] as "grok" | "codex";
      if (selectedVendor !== vendor) return undefined;
      const resolved = yield* resolveProfile({
        stateRoot: context.stateRoot,
        worktreeRoot: context.worktreeRoot,
        profileId: profile[2]!,
        vendor: selectedVendor,
      }).pipe(Effect.provide(liveCredentialProfile));
      if (resolved._tag !== "Ready") return undefined;
      const wrapper = yield* readProfilePreflightRecord(
        profilePreflightRecordPath(
          context.stateRoot,
          resolved.profileId,
          selectedVendor,
        ),
        {
          profileId: resolved.profileId,
          profileIdentity: resolved.profileIdentity,
          vendor: selectedVendor,
        },
      );
      return {
        record: wrapper.record,
        credentialProfileRef: input.credentialProfileRef,
      };
    }
    const record = yield* readPreflightRecord(
      join(context.stateRoot, "preflight", `${vendor}.json`),
    );
    // Legacy records have no account/config identity, including for native default accounts.
    return { record };
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
}
/** Decorates only probe; all workload, continuation and cancellation methods remain the original transport methods. */
export function withLiveProviderReadiness(
  transport: ProviderTransport,
  selected: Pick<
    ProbeInputV1,
    "profileId" | "transportId" | "credentialProfileRef"
  >,
  context: LiveProviderContext,
  ports: LiveReadinessPorts = {},
): ProviderTransport {
  const now = ports.now ?? Date.now;
  return {
    ...transport,
    get installedVersion() {
      return transport.installedVersion;
    },
    probe: (input) =>
      Effect.gen(function* () {
        if (input.mode === "bounded-workload")
          return yield* Effect.fail({
            _tag: "UnsupportedCapability",
            retryClass: "never",
            message:
              "Stored readiness metadata cannot establish bounded workload evidence; use explicit qualification",
            fieldPath: "probe.mode",
          } as const);
        if (
          input.profileId !== selected.profileId ||
          input.transportId !== transport.id ||
          input.transportId !== selected.transportId ||
          input.credentialProfileRef !== selected.credentialProfileRef
        )
          return yield* Effect.fail({
            _tag: "ModelMismatch",
            retryClass: "never",
            message:
              "Readiness probe must match the prepared model, transport and account",
          } as const);
        const profile = resolveModel(input.profileId);
        if (
          !profile.ok ||
          !profile.value.transports.includes(input.transportId)
        )
          return yield* Effect.fail({
            _tag: "ModelUnavailable",
            retryClass: "never",
            message:
              "Readiness requires an exact supported model and transport",
          } as const);
        const base = yield* transport.probe(input);
        const vendor: VendorId | undefined = (
          {
            "grok-acp": "grok",
            "codex-app-server": "codex",
            "claude-code": "claude",
          } as const
        )[input.transportId as "grok-acp" | "codex-app-server" | "claude-code"];
        if (!vendor) return base;
        const capability = ports.capability
          ? ports.capability(vendor)
          : (tryGetEmbeddedCapabilityTable()?.capabilities.find(
              (c) => c.vendor === vendor,
            ) ?? null);
        if (
          !capability ||
          capability.vendor !== vendor ||
          capability.evidenceClass !== "probed"
        )
          return base;
        const executable = yield* ports.executable
          ? ports.executable(capability.cliName)
          : context.environment.PATH === process.env.PATH
            ? Effect.gen(function* () {
                return yield* (yield* PathLookup).which(capability.cliName);
              }).pipe(Effect.provide(livePathLookup))
            : Effect.succeed(null);
        if (!executable || !transport.installedVersion) return base;
        const stored = yield* ports.record
          ? ports.record(input, vendor)
          : storedRecord(input, vendor, context);
        if (!stored) return base;
        const record = decodeVendorPreflightRecordV1(stored.record);
        if (isVendorPreflightContractFailure(record)) return base;
        const observedAt = Date.parse(record.timestamp),
          checkedAt = now();
        if (
          record.vendor !== vendor ||
          observedAt > checkedAt ||
          checkedAt - observedAt > PREFLIGHT_READINESS_MAX_AGE_MS ||
          record.resolvedPath !== executable ||
          record.reportedVersion !== transport.installedVersion ||
          record.versionFloor !== capability.versionFloor
        )
          return base;
        const sameArgv = (a: readonly string[], b: readonly string[]) =>
          a.length === b.length &&
          a.every((value, index) => value === b[index]);
        const version = record.probes.find((p) => p.kind === "version");
        if (
          version?.outcome !== "completed" ||
          version.exitCode !== 0 ||
          !sameArgv(version.argv, [executable, ...capability.versionArgv])
        )
          return base;
        const fact = { observedAt, evidenceKind: "metadata" as const };
        const discovery: ReadinessV1["discovery"] =
          record.facts.discoverable.evidenceClass === "probed" &&
          record.facts.discoverable.value === "discoverable"
            ? {
                ...fact,
                state: "available",
                installedVersion: transport.installedVersion,
                diagnostic:
                  "Stored executable path and version match the current installation.",
              }
            : base.discovery;
        const currencyState = classifyCurrency(
          record.reportedVersion,
          capability.versionFloor,
          "completed",
        ).value;
        const currency: ReadinessV1["currency"] =
          record.facts.current.evidenceClass === "probed"
            ? {
                ...fact,
                state: currencyState === "outdated" ? "stale" : currencyState,
                diagnostic:
                  "Installed version compared with the current preflight version floor; provider source identity is not established.",
              }
            : base.currency;
        const auth = record.probes.find((p) => p.kind === "auth");
        let authentication = base.authentication;
        if (
          stored.credentialProfileRef === input.credentialProfileRef &&
          record.facts.authenticated.evidenceClass === "probed" &&
          auth?.outcome === "completed" &&
          sameArgv(auth.argv, [executable, ...capability.authArgv])
        ) {
          const state = record.facts.authenticated.value;
          authentication = {
            ...fact,
            state: state === "not-authenticated" ? "signed-out" : state,
            diagnostic:
              "Stored authentication metadata matches the selected credential profile and current probe command.",
            ...(state === "not-authenticated"
              ? { remediation: "Authenticate the selected credential profile." }
              : {}),
          };
        }
        return { ...base, checkedAt, discovery, currency, authentication };
      }),
  };
}
