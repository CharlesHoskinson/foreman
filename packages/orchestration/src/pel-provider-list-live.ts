import { Effect } from "effect";
import {
  PROVIDER_PROFILES,
  listProviderCells,
  type AdmissionBindingV1,
  type TransportId,
} from "@foreman/providers";
import type { ProviderCliServices } from "./pel-provider-cli.js";
import type { LiveProviderContext } from "./pel-provider-live.js";
import { readProviderEvidence } from "./pel-provider-evidence.js";

const apiBindings: Partial<
  Record<TransportId, { readonly account: string; readonly revision: string }>
> = {
  "xai-responses": { account: "env:XAI_API_KEY", revision: "v1" },
  "anthropic-messages": {
    account: "env:ANTHROPIC_API_KEY",
    revision: "2023-06-01",
  },
  "openai-responses": { account: "env:OPENAI_API_KEY", revision: "v1" },
  "google-interactions": { account: "env:GEMINI_API_KEY", revision: "v1beta" },
};

/** Read-only view: native installation metadata and account secrets are never inspected. */
export function makeLiveProviderList(
  context: LiveProviderContext,
): NonNullable<ProviderCliServices["list"]> {
  return () =>
    Effect.gen(function* () {
      const evidence = yield* readProviderEvidence(context, "listing");
      const now = Date.now();
      const bindings = PROVIDER_PROFILES.flatMap((profile) =>
        profile.transports.flatMap((transportId) => {
          const api = apiBindings[transportId];
          if (!api) return [];
          const binding: AdmissionBindingV1 = {
            kind: "product",
            now,
            transportVersion: "1",
            expectedIdentityRevision: api.revision,
            credentialProfileRef: api.account,
            controls: { ...profile.defaults, toolChoice: "none" },
          };
          return [{ profileId: profile.id, transportId, binding }];
        }),
      );
      const liveEvidence = evidence.filter(
        (entry) =>
          entry.state === "live-qualified" &&
          entry.fixtureManifestHash === undefined &&
          entry.endpointIdentity === undefined,
      );
      return listProviderCells(liveEvidence, now, bindings).map((cell) => {
        const records = evidence.filter(
          (entry) =>
            entry.profileId === cell.profileId &&
            entry.transportId === cell.transportId,
        );
        const capabilities = cell.capabilities.map((capability) => ({
          ...capability,
          state:
            capability.state === "live-qualified" ||
            capability.state === "unsupported"
              ? capability.state
              : records.some(
                    (entry) => entry.capability === capability.capability,
                  )
                ? "stale"
                : capability.state,
        }));
        const generation = capabilities.find(
          (capability) => capability.capability === "generation",
        );
        return {
          ...cell,
          capabilities,
          status:
            generation?.state === "stale" ? ("stale" as const) : cell.status,
        };
      });
    });
}
