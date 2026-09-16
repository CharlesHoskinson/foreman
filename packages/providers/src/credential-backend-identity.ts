import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { CredentialStoreFailure, OpenBaoCredentialStoreConfig } from "./credential-store.js";
import { makeOpenBaoCredentialStore } from "./openbao-credential-store.js";

/** Configuration identity only: not server attestation or evidence of equal OS trust stores. */
export interface CredentialBackendIdentity {
  readonly kind: "openbao";
  readonly id: string;
  readonly endpoint: string;
  readonly mount: string;
  readonly namespace: string;
  readonly trustSha256: string;
}
export interface CredentialBackendIdentityConfig {
  readonly endpoint: string;
  readonly mount: string;
  readonly namespace?: string;
  readonly caPem?: string;
  readonly systemTrustIdentity?: string;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const component = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.exec(value)?.[0] === value;

export type OpenBaoCredentialBackendConfig = CredentialBackendIdentityConfig & OpenBaoCredentialStoreConfig;

/** Separate runtime and maintenance instances can share identity without sharing token authority. */
export function makeOpenBaoCredentialBackend(config: OpenBaoCredentialBackendConfig) {
  const snapshot = Object.freeze({ endpoint: config.endpoint, mount: config.mount,
    ...(config.namespace === undefined ? {} : { namespace: config.namespace }),
    ...(config.caPem === undefined ? {} : { caPem: config.caPem }),
    ...(config.systemTrustIdentity === undefined ? {} : { systemTrustIdentity: config.systemTrustIdentity }), token: config.token });
  return makeCredentialBackendIdentity(snapshot).pipe(Effect.flatMap(identity => typeof snapshot.token !== "function"
    ? Effect.fail({ _tag: "CredentialStoreFailure" as const, code: "InvalidInput" as const })
    : Effect.succeed(Object.freeze({ identity, store: makeOpenBaoCredentialStore(snapshot) }))));
}

/** Pure, lazy validation with closed failures; does not acquire tokens or contact the server. */
export function makeCredentialBackendIdentity(config: CredentialBackendIdentityConfig): Effect.Effect<CredentialBackendIdentity, CredentialStoreFailure> {
  const snapshot = { ...config };
  return Effect.try({
    try: () => {
      const url = new URL(snapshot.endpoint);
      if (url.protocol !== "https:" || url.origin !== snapshot.endpoint || url.username || url.password || url.pathname !== "/" || url.search || url.hash || !component(snapshot.mount) || (snapshot.namespace !== undefined && (!snapshot.namespace || !snapshot.namespace.split("/").every(component)))) throw new Error("invalid");
      const custom = snapshot.caPem !== undefined;
      if (custom ? typeof snapshot.caPem !== "string" || !snapshot.caPem || snapshot.systemTrustIdentity !== undefined : typeof snapshot.systemTrustIdentity !== "string" || !snapshot.systemTrustIdentity || snapshot.systemTrustIdentity.length > 1024 || /[\x00-\x1f\x7f]/.test(snapshot.systemTrustIdentity)) throw new Error("invalid");
      const trustSha256 = hash(custom ? ["custom-ca", snapshot.caPem] : ["system-trust-policy", snapshot.systemTrustIdentity]);
      const identity = { kind: "openbao" as const, endpoint: snapshot.endpoint, mount: snapshot.mount, namespace: snapshot.namespace ?? "", trustSha256 };
      return Object.freeze({ ...identity, id: hash(identity) });
    },
    catch: (): CredentialStoreFailure => ({ _tag: "CredentialStoreFailure", code: "InvalidInput" }),
  });
}
