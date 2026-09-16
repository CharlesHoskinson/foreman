import { Context } from "effect";
import type { Effect, Redacted } from "effect";

export type CredentialProvider = "agy" | "codex" | "claude" | "grok";
export interface CredentialStoreFailure {
  readonly _tag: "CredentialStoreFailure";
  readonly code: "InvalidInput" | "InvalidResponse" | "Denied" | "NotFound" | "Conflict" | "Unavailable" | "Timeout";
}
export interface StoredProviderCredential {
  readonly provider: CredentialProvider;
  readonly account: string;
  readonly version: number;
  readonly material: Redacted.Redacted<Readonly<Record<string, string>>>;
}
export interface CredentialStoreService {
  readonly read: (reference: string, deadline: number) => Effect.Effect<StoredProviderCredential, CredentialStoreFailure>;
  readonly write: (reference: string, material: Redacted.Redacted<Readonly<Record<string, string>>>, expectedVersion: number, deadline: number) => Effect.Effect<number, CredentialStoreFailure>;
  readonly list: (provider: CredentialProvider, deadline: number) => Effect.Effect<readonly string[], CredentialStoreFailure>;
  readonly remove: (reference: string, versions: readonly number[], deadline: number) => Effect.Effect<void, CredentialStoreFailure>;
}
export class CredentialStorePort extends Context.Tag("@foreman/providers/CredentialStorePort")<CredentialStorePort, CredentialStoreService>() {}
export interface OpenBaoCredentialStoreConfig {
  readonly endpoint: string;
  readonly mount: string;
  readonly namespace?: string;
  readonly caPem?: string;
  /** No receiver is supplied. Bind service methods or use () => service.acquire(). */
  readonly token: () => Effect.Effect<Redacted.Redacted<string>, CredentialStoreFailure>;
}
