import test from 'node:test';
import assert from 'node:assert/strict';
import { Redacted } from 'effect';
import { planTransition, validateEnvelope } from './credential-lifecycle.js';
import type { AccountKey, CurrentObservation, Transition, CurrentMetadata, Result, FailureCode } from './credential-lifecycle.js';
const key = { provider: 'codex', account: 'synthetic' } as const;
const metadata = { currentVersion: 7, deleted: false, destroyed: false, deletionScheduled: false };
const active = { ...key, schemaVersion: 2, generation: 7, state: 'active', material: Redacted.make({ access: 'synthetic-only' }) } as const;
test('remove advances version and erases material from next envelope', () => {
  assert.deepEqual(planTransition(key, { kind: 'present', metadata, envelope: active }, { kind: 'remove', expectedGeneration: 7 }), {
    ok: true, value: { expectedVersion: 7, envelope: { ...key, schemaVersion: 2, generation: 8, state: 'tombstoned' } },
  });
});

const absent = { kind: 'absent', metadataAbsent: true } as const;
const tombstone = { ...key, schemaVersion: 2, generation: 7, state: 'tombstoned' } as const;
const present = (envelope: unknown = active, meta: unknown = metadata) => ({ kind: 'present', metadata: meta, envelope }) as CurrentObservation;
const plan = (current: unknown, transition: unknown, account: unknown = key) => planTransition(account as AccountKey, current as CurrentObservation, transition as Transition);
const validate = (input: unknown, account: unknown = key, meta: unknown = metadata) => validateEnvelope(input, account as AccountKey, meta as CurrentMetadata);
const refused = (result: unknown, code: FailureCode) => assert.deepEqual(result, { ok: false, error: { _tag: 'ManagedFailure', code } });
const value = <A>(result: Result<A>): A => { assert.equal(result.ok, true); if (!result.ok) throw new Error('Expected success'); return result.value; };
const fresh = Redacted.make({ access: 'fresh-synthetic-only' });

for (const provider of ['agy', 'codex', 'claude', 'grok'] as const) {
  test(`${provider}: import, remove, recover and refresh plan exact CAS generations`, () => {
    const account = { ...key, provider };
    const imported = value(plan(absent, { kind: 'import', material: fresh }, account));
    assert.equal(imported.expectedVersion, 0);
    assert.deepEqual(imported.envelope, { ...account, schemaVersion: 2, generation: 1, state: 'active', material: fresh });
    const observed = present(imported.envelope, { ...metadata, currentVersion: 1 });
    const removed = value(plan(observed, { kind: 'remove', expectedGeneration: 1 }, account));
    assert.deepEqual(removed, { expectedVersion: 1, envelope: { ...account, schemaVersion: 2, generation: 2, state: 'tombstoned' } });
    const recovered = value(plan(present(removed.envelope, { ...metadata, currentVersion: 2 }), { kind: 'recover', expectedGeneration: 2, material: fresh }, account));
    assert.deepEqual(recovered, { expectedVersion: 2, envelope: { ...account, schemaVersion: 2, generation: 3, state: 'active', material: fresh } });
    assert.equal(recovered.envelope.state, 'active');
    if (recovered.envelope.state === 'active') assert.deepEqual(Redacted.value(recovered.envelope.material), { access: 'fresh-synthetic-only' });
    const refreshed = value(plan(present(recovered.envelope, { ...metadata, currentVersion: 3 }), { kind: 'refreshCommit', expectedGeneration: 3, material: active.material }, account));
    assert.deepEqual(refreshed, { expectedVersion: 3, envelope: { ...account, schemaVersion: 2, generation: 4, state: 'active', material: active.material } });
    assert.equal(refreshed.envelope.state, 'active');
    if (refreshed.envelope.state === 'active') assert.deepEqual(Redacted.value(refreshed.envelope.material), { access: 'synthetic-only' });
  });
}

test('envelopes require exact fields, identity, state, generation and Redacted material', () => {
  for (const input of [null, [], 'bad', {}, { ...active, extra: true }, { ...active, account: 'other' }, { ...active, provider: 'grok' },
    { ...active, state: 'deleted' }, { ...active, schemaVersion: 3 }, { ...active, material: { access: 'plain' } },
    { ...active, material: undefined }, { ...tombstone, material: active.material }, ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 8, '7'].map(generation => ({ ...active, generation }))]) {
    refused(validate(input), 'Quarantined');
  }
  assert.deepEqual(value(validate(tombstone)), tombstone);
});

test('material grammar and count boundaries are strict; snapshots are frozen and isolated', () => {
  for (const inner of [{}, { access: '' }, { access: 2 }, { 'bad/key': 's' }, { 'a\n': 's' }, { ['a'.repeat(65)]: 's' },
    Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`key${i}`, 's']))]) {
    refused(validate({ ...active, material: Redacted.make(inner) }), 'Quarantined');
    refused(plan(absent, { kind: 'import', material: Redacted.make(inner) }), 'InvalidInput');
  }
  const inner = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [i === 0 ? 'a'.repeat(64) : `key${i}`, 's']));
  const material = Redacted.make(inner);
  const input = { ...active, material };
  const envelope = value(validate(input));
  assert.equal(envelope.state, 'active');
  if (envelope.state !== 'active') return;
  const snapshot = Redacted.value(envelope.material);
  assert.notEqual(snapshot, inner);
  assert.equal(Object.isFrozen(snapshot), true);
  inner.key1 = 'changed';
  assert.equal(snapshot.key1, 's');
  assert.equal(input.material, material);
  const imported = value(plan(absent, { kind: 'import', material }));
  assert.equal(imported.envelope.state, 'active');
  if (imported.envelope.state === 'active') {
    inner.key1 = 'changed-again';
    assert.equal(Redacted.value(imported.envelope.material).key1, 'changed');
  }
  assert.deepEqual(absent, { kind: 'absent', metadataAbsent: true });
});

test('caller arguments are validated before current observation', () => {
  const legacy = present({ schemaVersion: 1 });
  for (const account of [null, {}, { ...key, extra: 1 }, { ...key, provider: 'other' }, ...['', '-bad', 'a\n', 'a'.repeat(65)].map(account => ({ ...key, account }))]) {
    refused(plan(legacy, { kind: 'remove', expectedGeneration: 7 }, account), 'InvalidInput');
    refused(validate(active, account), 'InvalidInput');
  }
  const boundaryKey = { ...key, account: 'a'.repeat(64) };
  value(plan(absent, { kind: 'import', material: fresh }, boundaryKey));
  for (const transition of [null, {}, { kind: 'other' }, { kind: 'import' }, { kind: 'import', material: {} },
    { kind: 'remove', expectedGeneration: 7, material: fresh }, { kind: 'recover', expectedGeneration: 7 },
    { kind: 'refreshCommit', expectedGeneration: 7 }, ...[0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '7'].map(expectedGeneration => ({ kind: 'remove', expectedGeneration }))]) {
    refused(plan(legacy, transition), 'InvalidInput');
  }
});

test('observation corruption and metadata deletion precede legacy and import conflict', () => {
  for (const current of [null, {}, { kind: 'absent' }, { kind: 'absent', metadataAbsent: false }, { ...absent, envelope: active },
    { ...present(), extra: true }, { kind: 'present', envelope: active }, { kind: 'present', metadata }]) {
    refused(plan(current, { kind: 'import', material: fresh }), 'Quarantined');
  }
  for (const meta of [null, {}, { ...metadata, extra: true }, { ...metadata, currentVersion: 0 }, { ...metadata, currentVersion: 8 },
    { ...metadata, deleted: true }, { ...metadata, destroyed: true }, { ...metadata, deletionScheduled: true }, { ...metadata, deleted: 'false' }]) {
    refused(plan(present(active, meta), { kind: 'import', material: fresh }), 'Quarantined');
    refused(validate(active, key, meta), 'Quarantined');
  }
  refused(plan(present({ schemaVersion: 1 }, { ...metadata, deletionScheduled: true }), { kind: 'import', material: fresh }), 'Quarantined');
  refused(plan(present({ schemaVersion: 1, oldField: 'legacy' }), { kind: 'import', material: fresh }), 'MigrationRequired');
  refused(plan(present({ ...active, generation: 8 }), { kind: 'import', material: fresh }), 'Quarantined');
  for (const envelope of [active, tombstone]) refused(plan(present(envelope), { kind: 'import', material: fresh }), 'Conflict');
});

test('generation conflicts precede wrong state; absent operations and overflow refuse', () => {
  for (const kind of ['remove', 'recover', 'refreshCommit'] as const) {
    const transition = { kind, expectedGeneration: 7, ...(kind === 'remove' ? {} : { material: fresh }) };
    refused(plan(absent, transition), 'Quarantined');
    for (const envelope of [active, tombstone]) refused(plan(present(envelope), { ...transition, expectedGeneration: 6 }), 'Conflict');
    refused(plan(present(kind === 'recover' ? active : tombstone), transition), 'Quarantined');
    refused(plan(present({ ...(kind === 'recover' ? tombstone : active), generation: Number.MAX_SAFE_INTEGER }, { ...metadata, currentVersion: Number.MAX_SAFE_INTEGER }), { ...transition, expectedGeneration: Number.MAX_SAFE_INTEGER }), 'Quarantined');
  }
});

test('nonplain, inherited, symbol and accessor data are refused without invoking getters', () => {
  let calls = 0;
  const variants = (base: object) => [Object.assign(Object.create({ inherited: true }), base), Object.assign(Object.create(null), base),
    { ...base, [Symbol('extra')]: true }, Object.defineProperty({ ...base }, 'extra', { get() { calls++; throw new Error('accessor-canary'); } })];
  for (const input of variants(active)) refused(validate(input), 'Quarantined');
  for (const input of variants(key)) refused(plan(absent, { kind: 'import', material: fresh }, input), 'InvalidInput');
  for (const input of variants(metadata)) refused(validate(active, key, input), 'Quarantined');
  for (const input of variants(absent)) refused(plan(input, { kind: 'import', material: fresh }), 'Quarantined');
  for (const input of variants({ kind: 'import', material: fresh })) refused(plan(absent, input), 'InvalidInput');
  for (const input of variants({ access: 's' })) {
    refused(validate({ ...active, material: Redacted.make(input) }), 'Quarantined');
    refused(plan(absent, { kind: 'import', material: Redacted.make(input) }), 'InvalidInput');
  }
  assert.equal(calls, 0);
});

test('revoked proxies and descriptor failures are closed at every public boundary', () => {
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const throwing = new Proxy({}, { getPrototypeOf() { throw new Error('proxy-canary'); } });
  const descriptors = new Proxy({}, { ownKeys() { throw new Error('descriptor-canary'); } });
  for (const bad of [revoked.proxy, throwing, descriptors]) {
    refused(validate(bad), 'InvalidInput');
    refused(validate(active, bad), 'InvalidInput');
    refused(validate(active, key, bad), 'InvalidInput');
    refused(plan(bad, { kind: 'import', material: fresh }), 'InvalidInput');
    refused(plan(absent, bad), 'InvalidInput');
    refused(plan(absent, { kind: 'import', material: fresh }, bad), 'InvalidInput');
    refused(validate({ ...active, material: Redacted.make(bad) }), 'InvalidInput');
  }
  const wiped = Redacted.make({ access: 'wiped-canary' }); Redacted.unsafeWipe(wiped);
  refused(validate({ ...active, material: wiped }), 'InvalidInput');
  refused(plan(absent, { kind: 'import', material: wiped }), 'InvalidInput');
});

test('successful plans preserve inputs and isolate mutable source material for recovery and refresh', () => {
  for (const kind of ['recover', 'refreshCommit'] as const) {
    const source = { access: 'before' };
    const transition = Object.freeze({ kind, expectedGeneration: 7, material: Redacted.make(source) });
    const envelope = Object.freeze(kind === 'recover' ? { ...tombstone } : { ...active });
    const observation = Object.freeze({ kind: 'present', metadata: Object.freeze({ ...metadata }), envelope });
    const output = value(plan(observation, transition));
    source.access = 'after';
    assert.equal(output.envelope.state, 'active');
    if (output.envelope.state === 'active') {
      assert.deepEqual(Redacted.value(output.envelope.material), { access: 'before' });
      assert.equal(Object.isFrozen(Redacted.value(output.envelope.material)), true);
    }
    assert.equal(observation.envelope.generation, 7);
    assert.equal(observation.metadata.currentVersion, 7);
    assert.equal(transition.expectedGeneration, 7);
  }
});

test('material wire size is reserved for the later serializer', () => {
  const large = 's'.repeat(65_537);
  const envelope = value(validate({ ...active, material: Redacted.make({ access: large }) }));
  assert.equal(envelope.state, 'active');
  if (envelope.state === 'active') assert.equal(Redacted.value(envelope.material).access, large);
});
test('schema 1 needs explicit migration', () => {
  assert.deepEqual(validateEnvelope({ ...active, schemaVersion: 1 }, key, metadata), {
    ok: false, error: { _tag: 'ManagedFailure', code: 'MigrationRequired' },
  });
});
