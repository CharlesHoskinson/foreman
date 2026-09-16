import { Redacted } from 'effect';

export type Provider = 'agy' | 'codex' | 'claude' | 'grok';
export type FailureCode = 'InvalidInput' | 'Denied' | 'NotFound' | 'Conflict' |
  'Unavailable' | 'Timeout' | 'Unsupported' | 'Quarantined' | 'MigrationRequired' |
  'NotReady' | 'ReconciliationRequired';
export interface ManagedFailure { readonly _tag: 'ManagedFailure'; readonly code: FailureCode }
export type Result<A> = { readonly ok: true; readonly value: A } |
  { readonly ok: false; readonly error: ManagedFailure };
export interface AccountKey { readonly provider: Provider; readonly account: string }
export type Material = Redacted.Redacted<Readonly<Record<string, string>>>;
export type Envelope = AccountKey & { readonly schemaVersion: 2; readonly generation: number } &
  ({ readonly state: 'active'; readonly material: Material } | { readonly state: 'tombstoned' });
export interface CurrentMetadata {
  readonly currentVersion: number;
  readonly deleted: boolean;
  readonly destroyed: boolean;
  readonly deletionScheduled: boolean;
}
export type CurrentObservation = { readonly kind: 'absent'; readonly metadataAbsent: true } |
  { readonly kind: 'present'; readonly metadata: CurrentMetadata; readonly envelope: Envelope };
export type Transition = { readonly kind: 'import'; readonly material: Material } |
  { readonly kind: 'remove'; readonly expectedGeneration: number } |
  { readonly kind: 'recover'; readonly expectedGeneration: number; readonly material: Material } |
  { readonly kind: 'refreshCommit'; readonly expectedGeneration: number; readonly material: Material };
export interface CasWrite { readonly expectedVersion: number; readonly envelope: Envelope }
const failure = (code: FailureCode): Result<never> => ({ ok: false, error: { _tag: 'ManagedFailure', code } });

// Read descriptors once: getters never execute and subsequent checks use our snapshot.
function record(input: unknown): Record<string, unknown> | undefined {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const name of Reflect.ownKeys(descriptors)) {
    if (typeof name !== 'string') return undefined;
    const descriptor = descriptors[name];
    if (!descriptor || !('value' in descriptor)) return undefined;
    result[name] = descriptor.value as unknown;
  }
  return result;
}

function fields(input: Record<string, unknown>, names: readonly string[]): boolean {
  return Object.keys(input).length === names.length && names.every(name => Object.hasOwn(input, name));
}

function component(input: unknown): input is string {
  return typeof input === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.exec(input)?.[0] === input;
}

function positive(input: unknown): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input > 0;
}

function accountKey(input: unknown): AccountKey | undefined {
  const data = record(input);
  if (!data || !fields(data, ['provider', 'account']) || !component(data.account)) return undefined;
  if (data.provider !== 'agy' && data.provider !== 'codex' && data.provider !== 'claude' && data.provider !== 'grok') return undefined;
  return { provider: data.provider, account: data.account };
}

function currentMetadata(input: unknown): CurrentMetadata | undefined {
  const data = record(input);
  if (!data || !fields(data, ['currentVersion', 'deleted', 'destroyed', 'deletionScheduled']) ||
    !positive(data.currentVersion) || data.deleted !== false || data.destroyed !== false || data.deletionScheduled !== false) return undefined;
  return { currentVersion: data.currentVersion, deleted: false, destroyed: false, deletionScheduled: false };
}

function materialSnapshot(input: unknown): Material | undefined {
  if (!Redacted.isRedacted(input)) return undefined;
  const data = record(Redacted.value(input));
  if (!data) return undefined;
  const entries = Object.entries(data);
  if (entries.length < 1 || entries.length > 32) return undefined;
  const snapshot: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!component(name) || typeof value !== 'string' || value.length === 0) return undefined;
    Object.defineProperty(snapshot, name, { value, enumerable: true, writable: false, configurable: false });
  }
  return Redacted.make(Object.freeze(snapshot));
}

function envelopeSnapshot(input: unknown, key: AccountKey, metadata: CurrentMetadata): Result<Envelope> {
  const data = record(input);
  if (!data) return failure('Quarantined');
  // A safe legacy record has precedence over schema 2 field and identity checks.
  if (data.schemaVersion === 1) return failure('MigrationRequired');
  const names = ['provider', 'account', 'schemaVersion', 'generation', 'state'];
  if (data.state === 'active') names.push('material');
  if (!fields(data, names) || data.schemaVersion !== 2 || data.provider !== key.provider || data.account !== key.account ||
    !positive(data.generation) || data.generation !== metadata.currentVersion) return failure('Quarantined');
  const base = { ...key, schemaVersion: 2 as const, generation: data.generation };
  if (data.state === 'tombstoned') return { ok: true, value: Object.freeze({ ...base, state: 'tombstoned' }) };
  if (data.state !== 'active') return failure('Quarantined');
  const material = materialSnapshot(data.material);
  return material ? { ok: true, value: Object.freeze({ ...base, state: 'active', material }) } : failure('Quarantined');
}

function transitionSnapshot(input: unknown): Transition | undefined {
  const data = record(input);
  if (!data) return undefined;
  if (data.kind === 'remove') {
    return fields(data, ['kind', 'expectedGeneration']) && positive(data.expectedGeneration)
      ? { kind: 'remove', expectedGeneration: data.expectedGeneration } : undefined;
  }
  if (data.kind !== 'import' && data.kind !== 'recover' && data.kind !== 'refreshCommit') return undefined;
  const names = data.kind === 'import' ? ['kind', 'material'] : ['kind', 'expectedGeneration', 'material'];
  if (!fields(data, names) || (data.kind !== 'import' && !positive(data.expectedGeneration))) return undefined;
  const material = materialSnapshot(data.material);
  if (!material) return undefined;
  if (data.kind === 'import') return { kind: 'import', material };
  // The non-import shape and positive generation have both been checked above.
  return { kind: data.kind, expectedGeneration: data.expectedGeneration as number, material };
}

export function validateEnvelope(input: unknown, key: AccountKey, metadata: CurrentMetadata): Result<Envelope> {
  try {
    const identity = accountKey(key);
    if (!identity) return failure('InvalidInput');
    const observed = currentMetadata(metadata);
    if (!observed) return failure('Quarantined');
    return envelopeSnapshot(input, identity, observed);
  } catch {
    return failure('InvalidInput');
  }
}

/** Pure proposal only: this neither authorizes a write nor performs CAS or provider operations. */
export function planTransition(key: AccountKey, current: CurrentObservation, transition: Transition): Result<CasWrite> {
  try {
    const identity = accountKey(key);
    if (!identity) return failure('InvalidInput');
    const change = transitionSnapshot(transition);
    if (!change) return failure('InvalidInput');
    const observation = record(current);
    if (!observation) return failure('Quarantined');
    if (observation.kind === 'absent') {
      if (!fields(observation, ['kind', 'metadataAbsent']) || observation.metadataAbsent !== true) return failure('Quarantined');
      if (change.kind !== 'import') return failure('Quarantined');
      return { ok: true, value: Object.freeze({ expectedVersion: 0,
        envelope: Object.freeze({ ...identity, schemaVersion: 2, generation: 1, state: 'active', material: change.material }) }) };
    }
    if (observation.kind !== 'present' || !fields(observation, ['kind', 'metadata', 'envelope'])) return failure('Quarantined');
    const metadata = currentMetadata(observation.metadata);
    if (!metadata) return failure('Quarantined');
    const validated = envelopeSnapshot(observation.envelope, identity, metadata);
    if (!validated.ok) return validated;
    const envelope = validated.value;
    if (change.kind === 'import') return failure('Conflict');
    if (change.expectedGeneration !== envelope.generation) return failure('Conflict');
    if (envelope.state !== (change.kind === 'recover' ? 'tombstoned' : 'active')) return failure('Quarantined');
    if (envelope.generation === Number.MAX_SAFE_INTEGER) return failure('Quarantined');
    const base = { ...identity, schemaVersion: 2 as const, generation: envelope.generation + 1 };
    const next: Envelope = change.kind === 'remove' ? { ...base, state: 'tombstoned' } : { ...base, state: 'active', material: change.material };
    return { ok: true, value: Object.freeze({ expectedVersion: metadata.currentVersion, envelope: Object.freeze(next) }) };
  } catch {
    return failure('InvalidInput');
  }
}
