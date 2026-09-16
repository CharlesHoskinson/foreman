import { makeSyntheticOpenBaoCredentialStore } from "../../providers/src/testing.js";
import type { CredentialProvider, CredentialStoreFailure } from "../../providers/src/credential-store.js";
import { Effect, Redacted } from "effect";

export type PilotProvider = CredentialProvider;
export interface PilotReference { readonly provider: PilotProvider; readonly account: string }
export interface PilotFailure { readonly _tag: "PilotFailure"; readonly code: "InvalidInput" | "Denied" | "Unavailable" | "InvalidResponse" | "Conflict" | "Timeout" }
export interface PilotCredential extends PilotReference { readonly accessToken: Redacted.Redacted<string>; readonly refreshToken: Redacted.Redacted<string>; readonly version: number }
export interface PilotClient { readonly read: (reference: string, deadline: number) => Effect.Effect<PilotCredential, PilotFailure> }

export function parsePilotReference(reference: string): PilotReference | undefined {
  const match = /^bao:(codex|grok|claude|agy):([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/.exec(reference);
  return match?.[0] === reference ? { provider: match[1] as PilotProvider, account: match[2]! } : undefined;
}
const pilotFailure = (value: CredentialStoreFailure): PilotFailure => ({ _tag: "PilotFailure", code: value.code === "NotFound" ? "Unavailable" : value.code });

export function makePilotClient(input: { readonly origin: string; readonly token: Redacted.Redacted<string> }): PilotClient {
  const store = makeSyntheticOpenBaoCredentialStore({ endpoint: input.origin, mount: "foreman-pilot", token: () => Effect.succeed(input.token) });
  return {
    read: (reference, deadline) => store.read(reference, deadline).pipe(
      Effect.flatMap(value => {
        const material = Redacted.value(value.material); const access = material.accessToken; const refresh = material.refreshToken;
        return typeof access === "string" && typeof refresh === "string" && access.startsWith("foreman-synthetic-access-") && refresh.startsWith("foreman-synthetic-refresh-") && access !== refresh
          ? Effect.succeed({ provider: value.provider, account: value.account, version: value.version, accessToken: Redacted.make(access), refreshToken: Redacted.make(refresh) })
          : Effect.fail({ _tag: "PilotFailure", code: "InvalidResponse" } as const);
      }),
      Effect.mapError(error => error._tag === "PilotFailure" ? error : pilotFailure(error)),
    ),
  };
}
