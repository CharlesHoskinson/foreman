import { Effect, Either, Redacted } from 'effect';
import { validateEnvelope, type AccountKey, type CasWrite, type CurrentMetadata, type Envelope, type ManagedFailure } from './credential-lifecycle.js';
import type { CredentialStoreFailure, OpenBaoCredentialStoreConfig } from './credential-store.js';
import { decodeOpenBaoJson, encodeOpenBaoJson, makeOpenBaoHttpClient, type OpenBaoHttpSession } from './openbao-http.js';

export type MetadataObservation =
  | { readonly kind: 'metadataAbsent' }
  | { readonly kind: 'metadataPresent'; readonly metadata: CurrentMetadata };
export interface ManagedDataObservation {
  readonly kind: 'managed'; readonly metadata: CurrentMetadata;
  readonly dataVersion: number; readonly envelope: Envelope;
}
export interface LegacyDataObservation {
  readonly kind: 'schema1'; readonly metadata: CurrentMetadata;
  readonly dataVersion: number; readonly schemaVersion: 1;
}
export type DataObservation = ManagedDataObservation | LegacyDataObservation;
export interface ManagedObservationPort {
  readonly observeMetadata: (key: AccountKey, deadline: number) => Effect.Effect<MetadataObservation, ManagedFailure>;
  readonly observeData: (key: AccountKey, observed: CurrentMetadata, deadline: number) => Effect.Effect<DataObservation, ManagedFailure>;
}
export interface ManagedWritePort {
  readonly write: (key: AccountKey, change: CasWrite, deadline: number) => Effect.Effect<number, ManagedFailure>;
}
export type ManagedStorePort = ManagedObservationPort & ManagedWritePort;

const failure = (code: ManagedFailure['code']): ManagedFailure => ({ _tag: 'ManagedFailure', code });
const responseKeys = ['request_id', 'lease_id', 'renewable', 'lease_duration', 'data', 'wrap_info', 'warnings', 'auth', 'mount_type'];
const metadataKeys = ['cas_required', 'created_time', 'current_version', 'custom_metadata', 'delete_version_after', 'max_versions', 'oldest_version', 'updated_time', 'versions', 'current_metadata_version', 'metadata_cas_required'];

// Host objects must be ordinary records. The JSON decoder's null-prototype
// records are admitted only at the wire boundary. Never execute accessors.
function record(value: unknown, wire = false): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && !(wire && prototype === null)) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const name of Reflect.ownKeys(descriptors)) {
    if (typeof name !== 'string') return undefined;
    const descriptor = descriptors[name];
    if (!descriptor || !('value' in descriptor)) return undefined;
    snapshot[name] = descriptor.value as unknown;
  }
  return snapshot;
}
function fields(value: Record<string, unknown>, allowed: readonly string[], required = allowed): boolean {
  return Object.keys(value).every(name => allowed.includes(name)) && required.every(name => Object.hasOwn(value, name));
}
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function nonnegative(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function keySnapshot(value: unknown): AccountKey | undefined {
  const data = record(value);
  if (!data || !fields(data, ['provider', 'account']) || typeof data.account !== 'string' ||
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.exec(data.account)?.[0] !== data.account ||
    (data.provider !== 'agy' && data.provider !== 'codex' && data.provider !== 'claude' && data.provider !== 'grok')) return undefined;
  return { provider: data.provider, account: data.account };
}
function safeMetadata(version: number): CurrentMetadata {
  return Object.freeze({ currentVersion: version, deleted: false, destroyed: false, deletionScheduled: false });
}
function metadataSnapshot(value: unknown): CurrentMetadata | undefined {
  const data = record(value);
  return data && fields(data, ['currentVersion', 'deleted', 'destroyed', 'deletionScheduled']) && positive(data.currentVersion) &&
    data.deleted === false && data.destroyed === false && data.deletionScheduled === false ? safeMetadata(data.currentVersion) : undefined;
}
function configSnapshot(value: unknown): OpenBaoCredentialStoreConfig | undefined {
  try {
    const data = record(value);
    if (!data || !fields(data, ['endpoint', 'mount', 'token', 'namespace', 'caPem'], ['endpoint', 'mount', 'token']) ||
      typeof data.endpoint !== 'string' || typeof data.mount !== 'string' || typeof data.token !== 'function' ||
      (Object.hasOwn(data, 'namespace') && typeof data.namespace !== 'string') ||
      (Object.hasOwn(data, 'caPem') && typeof data.caPem !== 'string')) return undefined;
    return { endpoint: data.endpoint, mount: data.mount, token: data.token as OpenBaoCredentialStoreConfig['token'],
      ...(typeof data.namespace === 'string' ? { namespace: data.namespace } : {}),
      ...(typeof data.caPem === 'string' ? { caPem: data.caPem } : {}) };
  } catch { return undefined; }
}
function outerFailure(error: CredentialStoreFailure): ManagedFailure {
  return failure(['InvalidInput', 'Denied', 'Unavailable', 'Timeout'].includes(error.code) ?
    error.code as 'InvalidInput' | 'Denied' | 'Unavailable' | 'Timeout' : 'Unavailable');
}
function requestFailure(error: CredentialStoreFailure): ManagedFailure {
  return failure(error.code === 'Denied' || error.code === 'Unavailable' || error.code === 'Timeout' ? error.code : 'Quarantined');
}
function decodeMetadata(bytes: Buffer): Effect.Effect<MetadataObservation, ManagedFailure> {
  return Effect.suspend(() => {
    const root = record(decodeOpenBaoJson(bytes), true);
    const data = root && fields(root, responseKeys, ['data']) ? record(root.data, true) : undefined;
    const versions = data && fields(data, metadataKeys, ['current_version', 'versions']) ? record(data.versions, true) : undefined;
    const version = data?.current_version;
    const current = versions && positive(version) ? record(versions[String(version)], true) : undefined;
    if (!positive(version) || !current ||
      (Object.hasOwn(data!, 'current_metadata_version') && !nonnegative(data!.current_metadata_version)) ||
      (Object.hasOwn(data!, 'metadata_cas_required') && typeof data!.metadata_cas_required !== 'boolean') ||
      !fields(current, ['created_time', 'deletion_time', 'destroyed'], ['deletion_time', 'destroyed']) ||
      current.destroyed !== false || current.deletion_time !== '') return Effect.fail(failure('Quarantined'));
    return Effect.succeed(Object.freeze({ kind: 'metadataPresent' as const, metadata: safeMetadata(version) }));
  });
}
function observeMetadata(session: OpenBaoHttpSession, path: string): Effect.Effect<MetadataObservation, ManagedFailure> {
  // NotFound has absence semantics only for this request, never token bootstrap.
  return session.request('GET', path).pipe(Effect.matchEffect({
    onFailure: error => error.code === 'NotFound' ? Effect.succeed(Object.freeze({ kind: 'metadataAbsent' as const })) : Effect.fail(requestFailure(error)),
    onSuccess: decodeMetadata,
  }));
}
function decodeData(bytes: Buffer, key: AccountKey, metadata: CurrentMetadata, synthetic: boolean): Effect.Effect<DataObservation, ManagedFailure> {
  return Effect.suspend((): Effect.Effect<DataObservation, ManagedFailure> => {
    const root = record(decodeOpenBaoJson(bytes), true);
    const data = root && fields(root, responseKeys, ['data']) ? record(root.data, true) : undefined;
    const wireMetadata = data && fields(data, ['data', 'metadata']) ? record(data.metadata, true) : undefined;
    const envelope = data ? record(data.data, true) : undefined;
    if (!wireMetadata || !fields(wireMetadata, ['created_time', 'custom_metadata', 'deletion_time', 'destroyed', 'version'], ['version', 'destroyed', 'deletion_time']) ||
      !positive(wireMetadata.version) || wireMetadata.version !== metadata.currentVersion || wireMetadata.destroyed !== false || wireMetadata.deletion_time !== '' || !envelope) {
      return Effect.fail(failure('Quarantined'));
    }
    const dataVersion = wireMetadata.version;
    // Classification only. A later migration operation needs its own validated
    // legacy identity and material; none of those fields escape this boundary.
    if (envelope.schemaVersion === 1) return Effect.succeed(Object.freeze({ kind: 'schema1' as const, schemaVersion: 1 as const, metadata, dataVersion }));
    const names = ['provider', 'account', 'schemaVersion', 'generation', 'state'];
    if (envelope.state === 'active') names.push('material');
    if (!fields(envelope, names) || envelope.schemaVersion !== 2 || envelope.generation !== dataVersion) return Effect.fail(failure('Quarantined'));
    const ordinary = { provider: envelope.provider, account: envelope.account, schemaVersion: envelope.schemaVersion,
      generation: envelope.generation, state: envelope.state };
    let input: unknown = ordinary;
    if (envelope.state === 'active') {
      const material = record(envelope.material, true);
      if (!material) return Effect.fail(failure('Quarantined'));
      const copied: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(material)) {
        if (synthetic && (typeof value !== 'string' || !value.startsWith('foreman-synthetic-'))) return Effect.fail(failure('Quarantined'));
        Object.defineProperty(copied, name, { value, enumerable: true, writable: false, configurable: false });
      }
      input = { ...ordinary, material: Redacted.make(copied) };
    }
    const validated = validateEnvelope(input, key, metadata);
    return validated.ok ? Effect.succeed(Object.freeze({ kind: 'managed' as const, metadata, dataVersion, envelope: validated.value })) : Effect.fail(failure('Quarantined'));
  });
}
function requireGeneration(observation: MetadataObservation, expected: number): Effect.Effect<CurrentMetadata, ManagedFailure> {
  return observation.kind === 'metadataPresent' && observation.metadata.currentVersion === expected ?
    Effect.succeed(observation.metadata) : Effect.fail(failure('Quarantined'));
}
function writeSnapshot(change: unknown, key: AccountKey, synthetic: boolean): { body: Buffer; generation: number } | undefined {
  const data = record(change);
  if (!data || !fields(data, ['expectedVersion', 'envelope']) || !nonnegative(data.expectedVersion) ||
    data.expectedVersion >= Number.MAX_SAFE_INTEGER) return undefined;
  const generation = data.expectedVersion + 1;
  const validated = validateEnvelope(data.envelope, key, safeMetadata(generation));
  if (!validated.ok || (data.expectedVersion === 0 && validated.value.state !== 'active')) return undefined;
  const envelope = validated.value;
  const base = { schemaVersion: 2, provider: envelope.provider, account: envelope.account, generation, state: envelope.state };
  let payload: unknown = base;
  if (envelope.state === 'active') {
    const material = Redacted.value(envelope.material);
    if (synthetic && !Object.values(material).every(value => value.startsWith('foreman-synthetic-'))) return undefined;
    payload = { ...base, material };
  }
  const body = encodeOpenBaoJson({ options: { cas: data.expectedVersion }, data: payload });
  return body ? { body, generation } : undefined;
}
function decodeAcknowledgement(bytes: Buffer, generation: number): Effect.Effect<number, ManagedFailure> {
  return Effect.suspend(() => {
    const root = record(decodeOpenBaoJson(bytes), true);
    const data = root && fields(root, responseKeys, ['data']) ? record(root.data, true) : undefined;
    return data && fields(data, ['version', 'destroyed', 'deletion_time', 'created_time', 'custom_metadata'], ['version', 'destroyed', 'deletion_time']) &&
      data.version === generation && data.destroyed === false && data.deletion_time === '' ?
      Effect.succeed(generation) : Effect.fail(failure('ReconciliationRequired'));
  });
}
function make(config: OpenBaoCredentialStoreConfig, synthetic: boolean): ManagedStorePort {
  const snapshot = configSnapshot(config);
  const client = snapshot ? makeOpenBaoHttpClient(snapshot, synthetic) : undefined;
  function run<A>(key: AccountKey, deadline: number, operation: (session: OpenBaoHttpSession, key: AccountKey) => Effect.Effect<A, ManagedFailure>): Effect.Effect<A, ManagedFailure> {
    return Effect.suspend(() => {
      let selected: AccountKey | undefined;
      try { selected = keySnapshot(key); } catch { return Effect.fail(failure('InvalidInput')); }
      if (!client || !selected || !Number.isFinite(deadline) || deadline <= Date.now()) return Effect.fail(failure('InvalidInput'));
      const identity = selected;
      return client.run(() => true, session => Effect.either(operation(session, identity)), deadline).pipe(
        Effect.mapError(outerFailure),
        Effect.flatMap(result => Either.isLeft(result) ? Effect.fail(result.left) : Effect.succeed(result.right)),
      );
    }).pipe(Effect.catchAllDefect(() => Effect.fail(failure('Unavailable'))));
  }
  return {
    write: (key, change, deadline) => Effect.suspend(() => {
      let identity: AccountKey | undefined;
      let proposal: ReturnType<typeof writeSnapshot>;
      try {
        identity = keySnapshot(key);
        if (identity) proposal = writeSnapshot(change, identity, synthetic);
      } catch { return Effect.fail(failure('InvalidInput')); }
      if (!client || !identity || !proposal || !Number.isFinite(deadline) || deadline <= Date.now()) return Effect.fail(failure('InvalidInput'));
      const { body, generation } = proposal;
      const path = `/v1/${snapshot!.mount}/data/providers/${identity.provider}/${identity.account}`;
      // This flag belongs to one execution, including repeated or concurrent
      // runs of the same Effect. A timeout before POST has a different meaning.
      let invoked = false;
      return client.run(() => true, session => Effect.either(Effect.suspend(() => {
        invoked = true;
        return session.request('POST', path, body).pipe(
          Effect.mapError(error => failure(error.code === 'Conflict' || error.code === 'Denied' ? error.code : 'ReconciliationRequired')),
          Effect.flatMap(bytes => decodeAcknowledgement(bytes, generation)),
        );
      })), deadline).pipe(
        Effect.mapError(error => invoked ? failure('ReconciliationRequired') : outerFailure(error)),
        Effect.flatMap(result => Either.isLeft(result) ? Effect.fail(result.left) : Effect.succeed(result.right)),
        Effect.catchAllDefect(() => Effect.fail(failure(invoked ? 'ReconciliationRequired' : 'Unavailable'))),
      );
    }),
    observeMetadata: (key: AccountKey, deadline: number) => run(key, deadline, (session, identity) =>
      observeMetadata(session, `/v1/${snapshot!.mount}/metadata/providers/${identity.provider}/${identity.account}`)),
    observeData: (key, observed, deadline) => Effect.suspend(() => {
      let metadata: CurrentMetadata | undefined;
      try { metadata = metadataSnapshot(observed); } catch { return Effect.fail(failure('InvalidInput')); }
      if (!metadata) return Effect.fail(failure('InvalidInput'));
      const expected = metadata.currentVersion;
      return run(key, deadline, (session, identity) => Effect.gen(function* () {
        const suffix = `providers/${identity.provider}/${identity.account}`;
        const metadataPath = `/v1/${snapshot!.mount}/metadata/${suffix}`;
        const before = yield* observeMetadata(session, metadataPath).pipe(Effect.flatMap(value => requireGeneration(value, expected)));
        const bytes = yield* session.request('GET', `/v1/${snapshot!.mount}/data/${suffix}?version=${expected}`).pipe(Effect.mapError(requestFailure));
        const result = yield* decodeData(bytes, identity, before, synthetic);
        yield* observeMetadata(session, metadataPath).pipe(Effect.flatMap(value => requireGeneration(value, expected)));
        return result;
      }));
    }),
  };
}
export function makeOpenBaoManagedStore(config: OpenBaoCredentialStoreConfig): ManagedStorePort { return make(config, false); }
export function makeSyntheticOpenBaoManagedStore(config: OpenBaoCredentialStoreConfig): ManagedStorePort { return make(config, true); }
