import { Effect, Redacted } from "effect";
import type { CredentialProvider, CredentialStoreFailure, CredentialStoreService, OpenBaoCredentialStoreConfig, StoredProviderCredential } from "./credential-store.js";
import { decodeOpenBaoJson, encodeOpenBaoJson, makeOpenBaoHttpClient } from "./openbao-http.js";

const component = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const providers = new Set<CredentialProvider>(["agy", "codex", "claude", "grok"]);
const failure = (code: CredentialStoreFailure["code"]): CredentialStoreFailure => ({ _tag: "CredentialStoreFailure", code });
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isComponent = (value: string): boolean => component.exec(value)?.[0] === value;
const allowedKeys = (value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
const responseKeys = ["request_id", "lease_id", "renewable", "lease_duration", "data", "wrap_info", "warnings", "auth", "mount_type"] as const;

function referenceOf(reference: string): { provider: CredentialProvider; account: string } | undefined {
  const match = /^bao:(agy|codex|claude|grok):([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/.exec(reference);
  return match?.[0] === reference ? { provider: match[1] as CredentialProvider, account: match[2]! } : undefined;
}
function validMaterial(material: Readonly<Record<string, string>>, synthetic: boolean): boolean {
  const entries = Object.entries(material);
  return entries.length >= 1 && entries.length <= 32 && entries.every(([key, value]) => isComponent(key) && typeof value === "string" && value.length > 0 && (!synthetic || value.startsWith("foreman-synthetic-")));
}
function make(config: OpenBaoCredentialStoreConfig, synthetic: boolean): CredentialStoreService {
  const snapshot: OpenBaoCredentialStoreConfig = { endpoint: config.endpoint, mount: config.mount, ...(config.namespace === undefined ? {} : { namespace: config.namespace }), ...(config.caPem === undefined ? {} : { caPem: config.caPem }), token: config.token };
  const client = makeOpenBaoHttpClient(snapshot, synthetic);
  const route = (kind: "data" | "metadata" | "delete", provider: CredentialProvider, account?: string) => `/v1/${snapshot.mount}/${kind}/providers/${provider}${account ? `/${account}` : ""}`;
  return {
    read: (reference, deadline) => {
      const selected = referenceOf(reference);
      return client.run(() => !!selected, session => session.request("GET", route("data", selected!.provider, selected!.account)).pipe(Effect.flatMap(bytes => {
        const decoded = decodeOpenBaoJson(bytes);
        if (!object(decoded) || !allowedKeys(decoded, responseKeys, ["data"]) || !object(decoded.data) || !allowedKeys(decoded.data, ["data", "metadata"], ["data", "metadata"]) || !object(decoded.data.data) || !allowedKeys(decoded.data.data, ["schemaVersion", "provider", "account", "material"], ["schemaVersion", "provider", "account", "material"]) || !object(decoded.data.metadata) || !allowedKeys(decoded.data.metadata, ["created_time", "custom_metadata", "deletion_time", "destroyed", "version"], ["version"])) return Effect.fail(failure("InvalidResponse"));
        const record = decoded.data.data; const metadata = decoded.data.metadata;
        if (record.schemaVersion !== 1 || record.provider !== selected!.provider || record.account !== selected!.account || !object(record.material) || !validMaterial(record.material as Record<string, string>, synthetic) || !Number.isSafeInteger(metadata.version) || (metadata.version as number) < 1) return Effect.fail(failure("InvalidResponse"));
        return Effect.succeed({ provider: selected!.provider, account: selected!.account, version: metadata.version, material: Redacted.make({ ...(record.material as Readonly<Record<string, string>>) }) } as StoredProviderCredential);
      })), deadline);
    },
    write: (reference, redacted, expectedVersion, deadline) => Effect.suspend(() => {
      let value: Readonly<Record<string, string>>;
      try { value = { ...Redacted.value(redacted) }; } catch { return Effect.fail(failure("InvalidInput")); }
      const selected = referenceOf(reference);
      const payload = selected ? encodeOpenBaoJson({ data: { schemaVersion: 1, provider: selected.provider, account: selected.account, material: value }, options: { cas: expectedVersion } }) : undefined;
      return client.run(() => !!selected && Number.isSafeInteger(expectedVersion) && expectedVersion >= 0 && validMaterial(value, synthetic) && !!payload, session => session.request("POST", route("data", selected!.provider, selected!.account), payload).pipe(Effect.flatMap(bytes => {
        const decoded = decodeOpenBaoJson(bytes); const version = object(decoded) && allowedKeys(decoded, responseKeys, ["data"]) && object(decoded.data) && allowedKeys(decoded.data, ["created_time", "custom_metadata", "deletion_time", "destroyed", "version"], ["version"]) ? decoded.data.version : undefined;
        return Number.isSafeInteger(version) && (version as number) >= 1 ? Effect.succeed(version as number) : Effect.fail(failure("InvalidResponse"));
      })), deadline);
    }),
    list: (provider, deadline) => client.run(() => providers.has(provider), session => session.request("GET", `${route("metadata", provider)}?list=true`).pipe(Effect.flatMap(bytes => {
      const decoded = decodeOpenBaoJson(bytes); const keys = object(decoded) && allowedKeys(decoded, responseKeys, ["data"]) && object(decoded.data) && allowedKeys(decoded.data, ["keys", "key_info"], ["keys"]) ? decoded.data.keys : undefined;
      if (!Array.isArray(keys) || !keys.every(key => typeof key === "string" && isComponent(key))) return Effect.fail(failure("InvalidResponse"));
      return Effect.succeed([...keys].sort());
    })), deadline),
    remove: (reference, versions, deadline) => Effect.suspend(() => {
      const selected = referenceOf(reference); const selectedVersions = [...versions]; const payload = encodeOpenBaoJson({ versions: selectedVersions });
      return client.run(() => !!selected && selectedVersions.length > 0 && selectedVersions.every(version => Number.isSafeInteger(version) && version > 0) && !!payload, session => session.request("POST", route("delete", selected!.provider, selected!.account), payload).pipe(Effect.asVoid), deadline);
    }),
  };
}
export function makeOpenBaoCredentialStore(config: OpenBaoCredentialStoreConfig): CredentialStoreService { return make(config, false); }
export function makeSyntheticOpenBaoCredentialStore(config: OpenBaoCredentialStoreConfig): CredentialStoreService { return make(config, true); }
