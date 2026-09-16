import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Cause, Effect, Fiber, Redacted } from 'effect';
import type { AccountKey, CasWrite, CurrentMetadata, ManagedFailure } from './credential-lifecycle.js';
import type { OpenBaoCredentialStoreConfig } from './credential-store.js';
import { makeOpenBaoManagedStore, makeSyntheticOpenBaoManagedStore } from './openbao-managed-store.js';

const key = { provider: 'codex', account: 'synthetic' } as const;
const metadata = { currentVersion: 7, deleted: false, destroyed: false, deletionScheduled: false } as const;
const wireMetadata = { data: { current_version: 7, versions: { '7': { destroyed: false, deletion_time: '' } } } };
const wireData = { data: { data: { ...key, schemaVersion: 2, generation: 7, state: 'active',
  material: { access: 'foreman-synthetic-observation' } }, metadata: { version: 7, destroyed: false, deletion_time: '' } } };
const metadataPath = '/v1/credentials/metadata/providers/codex/synthetic';
const dataPath = '/v1/credentials/data/providers/codex/synthetic?version=7';
type Reply = { status: number; value?: unknown; bytes?: Buffer; hang?: boolean; delay?: number };
async function withServer(handler: (url: string, count: number) => Reply,
  run: (store: ReturnType<typeof makeSyntheticOpenBaoManagedStore>, seen: string[], config: OpenBaoCredentialStoreConfig, tokens: () => number) => Promise<void>): Promise<void> {
  const seen: string[] = []; let tokens = 0;
  const server = createServer((request, response) => {
    assert.equal(request.method, 'GET');
    const url = request.url ?? ''; seen.push(url);
    const result = handler(url, seen.length);
    if (result.hang) return;
    response.writeHead(result.status, { 'content-type': 'application/json' });
    const timer = setTimeout(() => response.end(result.bytes ?? JSON.stringify(result.value)), result.delay ?? 0);
    response.once('close', () => clearTimeout(timer));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const config = { endpoint: `http://127.0.0.1:${address.port}`, mount: 'credentials',
    token: () => { tokens++; return Effect.succeed(Redacted.make('synthetic-broker-token')); } };
  try { await run(makeSyntheticOpenBaoManagedStore(config), seen, config, () => tokens); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
async function fails<A>(effect: Effect.Effect<A, ManagedFailure>, code: ManagedFailure['code']): Promise<void> {
  const exit = await Effect.runPromiseExit(effect);
  assert.equal(exit._tag, 'Failure');
  if (exit._tag === 'Failure') assert.deepEqual(exit.cause, Cause.fail({ _tag: 'ManagedFailure', code }));
}

const createChange = (): CasWrite => ({ expectedVersion: 0, envelope: { ...key, schemaVersion: 2, generation: 1,
  state: 'active', material: Redacted.make({ access: 'foreman-synthetic-new' }) } });
const removeChange = (): CasWrite => ({ expectedVersion: 1, envelope: { ...key, schemaVersion: 2, generation: 2, state: 'tombstoned' } });
const acknowledgement = (version: number) => ({ data: { version, destroyed: false, deletion_time: '', created_time: '2026-09-15T00:00:00Z', custom_metadata: null } });
const writePath = '/v1/credentials/data/providers/codex/synthetic';
type WriteRequest = { method: string | undefined; url: string | undefined; bytes: Buffer };
async function withWriteServer(handler: (request: WriteRequest) => Reply & { close?: boolean },
  run: (store: ReturnType<typeof makeSyntheticOpenBaoManagedStore>, seen: WriteRequest[], config: OpenBaoCredentialStoreConfig, tokens: () => number) => Promise<void>): Promise<void> {
  const seen: WriteRequest[] = []; let tokens = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const received = { method: request.method, url: request.url, bytes: Buffer.concat(chunks) }; seen.push(received);
      const result = handler(received);
      if (result.close) { request.socket.destroy(); return; }
      if (result.hang) return;
      response.writeHead(result.status, { 'content-type': 'application/json' });
      response.end(result.bytes ?? JSON.stringify(result.value));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const config = { endpoint: `http://127.0.0.1:${address.port}`, mount: 'credentials',
    token: () => { tokens++; return Effect.succeed(Redacted.make('foreman-synthetic-broker-token')); } };
  try { await run(makeSyntheticOpenBaoManagedStore(config), seen, config, () => tokens); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
for (const change of [createChange(), removeChange()]) test(`write submits exact ${change.envelope.state} CAS payload`, async () => {
  await withWriteServer(() => ({ status: 200, value: acknowledgement(change.envelope.generation) }), async (store, seen, _config, tokens) => {
    assert.equal(await Effect.runPromise(store.write(key, change, Date.now() + 1000)), change.envelope.generation);
    const data = change.envelope.state === 'active' ? { schemaVersion: 2, ...key, generation: 1, state: 'active', material: { access: 'foreman-synthetic-new' } } :
      { schemaVersion: 2, ...key, generation: 2, state: 'tombstoned' };
    assert.equal(seen.length, 1); assert.equal(tokens(), 1);
    assert.equal(seen[0]!.method, 'POST'); assert.equal(seen[0]!.url, writePath);
    assert.deepEqual(JSON.parse(seen[0]!.bytes.toString()), { options: { cas: change.expectedVersion }, data });
  });
});

test('write rejects invalid proposals before token acquisition', async () => {
  const base = createChange();
  const wiped = Redacted.make({ access: 'foreman-synthetic-wiped' }); Redacted.unsafeWipe(wiped);
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const invalid: unknown[] = [null, revoked.proxy, { ...base, extra: true },
    ...[-1, 1.5, '0', NaN, Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1].map(expectedVersion => ({ ...base, expectedVersion })),
    { ...removeChange(), expectedVersion: 0, envelope: { ...removeChange().envelope, generation: 1 } },
    ...[{ generation: 2 }, { provider: 'grok' }, { account: 'other' }, { schemaVersion: 1 }, { extra: true },
      { material: { access: 'foreman-synthetic-plaintext' } }, { material: wiped },
      { material: Redacted.make({ access: 'not-synthetic' }) },
      { material: Redacted.make({ access: `foreman-synthetic-${'x'.repeat(65536)}` }) },
      { material: Redacted.make(Object.defineProperty({}, 'access', { get() { throw new Error('foreman-synthetic-accessor'); } })) },
    ].map(fields => ({ ...base, envelope: { ...base.envelope, ...fields } })),
    { ...base, envelope: revoked.proxy },
    Object.defineProperty({}, 'expectedVersion', { get() { throw new Error('foreman-synthetic-accessor'); } }),
  ];
  await withWriteServer(() => ({ status: 200, value: acknowledgement(1) }), async (store, seen, _config, tokens) => {
    for (const change of invalid) await fails(store.write(key, change as CasWrite, Date.now() + 1000), 'InvalidInput');
    for (const invalidKey of [revoked.proxy, { ...key, extra: true }, Object.create(null)]) {
      await fails(store.write(invalidKey as AccountKey, base, Date.now() + 1000), 'InvalidInput');
    }
    assert.equal(tokens(), 0); assert.equal(seen.length, 0);
  });
});
test('write freezes serialized bytes before token wait', async () => {
  await withWriteServer(() => ({ status: 200, value: acknowledgement(1) }), async (_store, seen, config) => {
    let acquired!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { acquired = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const material = { access: 'foreman-synthetic-new' }; const change = createChange();
    Object.assign(change.envelope, { material: Redacted.make(material) }); const identity = { ...key };
    const store = makeSyntheticOpenBaoManagedStore({ ...config, token: () => { acquired(); return Effect.promise(() => gate).pipe(Effect.as(Redacted.make('foreman-synthetic-token'))); } });
    const effect = store.write(identity, change, Date.now() + 2000); assert.equal(seen.length, 0);
    const pending = Effect.runPromise(effect); await started;
    material.access = 'foreman-synthetic-mutated'; Object.assign(identity, { account: 'other' });
    Object.assign(change, { expectedVersion: 20 }); Object.assign(change.envelope, { generation: 21 }); release();
    assert.equal(await pending, 1); assert.equal(seen.length, 1); assert.equal(seen[0]!.url, writePath);
    assert.equal(seen[0]!.bytes.toString(), JSON.stringify({ options: { cas: 0 }, data: { schemaVersion: 2, ...key, generation: 1, state: 'active', material: { access: 'foreman-synthetic-new' } } }));
  });
});
for (const code of ['Conflict', 'NotFound', 'Denied', 'InvalidInput', 'Unavailable', 'Timeout'] as const) test(`write bootstrap ${code} preserves origin`, async () => {
  await withWriteServer(() => ({ status: 200, value: acknowledgement(1) }), async (_store, seen, config) => {
    const store = makeSyntheticOpenBaoManagedStore({ ...config, token: () => Effect.fail({ _tag: 'CredentialStoreFailure', code }) });
    await fails(store.write(key, createChange(), Date.now() + 1000), code === 'Conflict' || code === 'NotFound' ? 'Unavailable' : code);
    assert.equal(seen.length, 0);
  });
});
for (const [status, code] of [[400, 'Conflict'], [403, 'Denied'], [404, 'ReconciliationRequired'], [503, 'ReconciliationRequired'], [500, 'ReconciliationRequired']] as const) test(`write server ${status} classification`, async () => {
  await withWriteServer(() => ({ status, value: { errors: ['check-and-set parameter did not match'] } }), async (store, seen) => {
    await fails(store.write(key, createChange(), Date.now() + 1000), code); assert.equal(seen.length, 1);
  });
});
for (const [name, reply] of [
  ['wrong version', { value: acknowledgement(2) }],
  ['missing data', { value: {} }],
  ...[{ version: 1 }, { version: 1, destroyed: false }, { version: 1, deletion_time: '' },
    { version: 1, destroyed: true, deletion_time: '' }, { version: 1, destroyed: false, deletion_time: 'later' },
    { version: 1, destroyed: false, deletion_time: '', unknown: 'foreman-synthetic-leak' }].map((data, index) => [`flags ${index}`, { value: { data } }] as const),
  ['UTF-8', { bytes: Buffer.from([0xff]) }],
  ['duplicate keys', { bytes: Buffer.from('{"data":{"version":1,"version":1,"destroyed":false,"deletion_time":""}}') }],
  ['oversized', { bytes: Buffer.alloc(65537, 'x') }],
  ['malformed JSON', { bytes: Buffer.from('foreman-synthetic-bad-json') }],
  ['unknown root', { value: { ...acknowledgement(1), unexpected: true } }],
] as const) test(`write acknowledgement ${name} requires reconciliation`, async () => {
  await withWriteServer(() => ({ status: 200, ...reply }), async (store, seen) => {
    await fails(store.write(key, createChange(), Date.now() + 1000), 'ReconciliationRequired'); assert.equal(seen.length, 1);
  });
});
test('write retains committed fake state after socket closes without acknowledgement', async () => {
  let accepted: unknown;
  await withWriteServer(request => { accepted = JSON.parse(request.bytes.toString()).data; return { status: 200, close: true }; }, async (store, seen) => {
    await fails(store.write(key, removeChange(), Date.now() + 1000), 'ReconciliationRequired');
    assert.deepEqual(accepted, { schemaVersion: 2, ...key, generation: 2, state: 'tombstoned' }); assert.equal(seen.length, 1);
  });
});
test('write bootstrap timeout stays Timeout and repeated execution resets invocation state', async () => {
  await withWriteServer(() => ({ status: 200, value: acknowledgement(1) }), async (_store, seen, config) => {
    let attempts = 0;
    const store = makeSyntheticOpenBaoManagedStore({ ...config, token: () => ++attempts === 1 ? Effect.succeed(Redacted.make('foreman-synthetic-token')) : Effect.fail({ _tag: 'CredentialStoreFailure', code: 'Timeout' }) });
    const effect = store.write(key, createChange(), Date.now() + 2000);
    assert.equal(await Effect.runPromise(effect), 1); await fails(effect, 'Timeout'); assert.equal(seen.length, 1);
    await fails(makeSyntheticOpenBaoManagedStore({ ...config, token: () => Effect.never }).write(key, createChange(), Date.now() + 60), 'Timeout');
    assert.equal(seen.length, 1);
  });
});
for (const interrupt of [false, true]) test(`write hanging POST ${interrupt ? 'interruption' : 'deadline'} closes socket`, async () => {
  let arrived!: () => void; let closed!: () => void; let requests = 0;
  const started = new Promise<void>(resolve => { arrived = resolve; }); const ended = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer(request => { requests++; request.socket.once('close', closed); request.resume(); arrived(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  try {
    const store = makeSyntheticOpenBaoManagedStore({ endpoint: `http://127.0.0.1:${address.port}`, mount: 'credentials', token: () => Effect.succeed(Redacted.make('foreman-synthetic-token')) });
    const effect = store.write(key, createChange(), Date.now() + (interrupt ? 2000 : 150));
    if (interrupt) {
      const fiber = Effect.runFork(effect); await started; const exit = await Effect.runPromise(Fiber.interrupt(fiber));
      assert.equal(exit._tag, 'Failure'); if (exit._tag === 'Failure') assert.ok(Cause.isInterruptedOnly(exit.cause));
    } else await fails(effect, 'ReconciliationRequired');
    await ended; assert.equal(requests, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('write competing adapters have one CAS winner and deterministic tombstone state', async () => {
  let serverVersion = 1; let acceptedEnvelope: Record<string, unknown> | undefined;
  await withWriteServer(request => {
    const body = JSON.parse(request.bytes.toString());
    if (body.options.cas !== serverVersion) return { status: 400, value: { errors: ['check-and-set parameter did not match'] } };
    serverVersion++; acceptedEnvelope = body.data;
    return { status: 200, value: acknowledgement(serverVersion) };
  }, async (store, seen, config) => {
    const other = makeSyntheticOpenBaoManagedStore(config);
    const results = await Promise.all([store, other].map(adapter => Effect.runPromise(Effect.either(adapter.write(key, removeChange(), Date.now() + 2000)))));
    assert.equal(results.filter(x => x._tag === 'Right' && x.right === 2).length, 1);
    assert.equal(results.filter(x => x._tag === 'Left' && x.left.code === 'Conflict').length, 1);
    assert.equal(serverVersion, 2); assert.ok(acceptedEnvelope); assert.equal(acceptedEnvelope.generation, 2);
    assert.equal(acceptedEnvelope.state, 'tombstoned'); assert.equal(Object.hasOwn(acceptedEnvelope, 'material'), false);
    assert.equal(seen.length, 2); assert.ok(seen.every(request => request.method === 'POST' && request.url === writePath));
  });
});

test('only metadata request 404 establishes observed absence', async () => {
  await withServer(() => ({ status: 404, value: { errors: [] } }), async (store, seen) => {
    const result = await Effect.runPromise(store.observeMetadata(key, Date.now() + 1000));
    assert.deepEqual(result, { kind: 'metadataAbsent' }); assert.ok(Object.isFrozen(result));
    assert.deepEqual(seen, [metadataPath]);
  });
});
test('metadata safe wire records decode and freeze', async () => {
  await withServer(() => ({ status: 200, value: wireMetadata }), async store => {
    const result = await Effect.runPromise(store.observeMetadata(key, Date.now() + 1000));
    assert.deepEqual(result, { kind: 'metadataPresent', metadata });
    assert.ok(Object.isFrozen(result));
    if (result.kind === 'metadataPresent') assert.ok(Object.isFrozen(result.metadata));
  });
});
const completeWireMetadata = { request_id: 'synthetic-request', lease_id: '', renewable: false, lease_duration: 0,
  data: { cas_required: true, created_time: '2026-09-15T00:00:00Z', current_version: 7,
    custom_metadata: null, delete_version_after: '0s', max_versions: 0, oldest_version: 0,
    updated_time: '2026-09-15T00:00:01Z', versions: {
      '7': { created_time: '2026-09-15T00:00:01Z', destroyed: false, deletion_time: '' },
    }, current_metadata_version: 1, metadata_cas_required: true },
  wrap_info: null, warnings: null, auth: null, mount_type: 'kv' };
test('complete OpenBao 2.6.2 metadata response shape is compatible', async () => {
  await withServer(() => ({ status: 200, value: completeWireMetadata }), async store => {
    assert.deepEqual(await Effect.runPromise(store.observeMetadata(key, Date.now() + 1000)),
      { kind: 'metadataPresent', metadata });
  });
});
for (const [field, value] of [
  ['current_metadata_version', -1], ['current_metadata_version', 1.5],
  ['current_metadata_version', Number.MAX_SAFE_INTEGER + 1], ['current_metadata_version', '1'],
  ['metadata_cas_required', 1], ['metadata_cas_required', 'true'],
] as const) test(`metadata quarantines malformed optional ${field}=${JSON.stringify(value)}`, async () => {
  const data = { ...completeWireMetadata.data, [field]: value };
  await withServer(() => ({ status: 200, value: { ...completeWireMetadata, data } }), async store => {
    await fails(store.observeMetadata(key, Date.now() + 1000), 'Quarantined');
  });
});
test('metadata still quarantines a genuinely unknown field', async () => {
  await withServer(() => ({ status: 200, value: { ...completeWireMetadata,
    data: { ...completeWireMetadata.data, future_metadata_field: true } } }), async store => {
    await fails(store.observeMetadata(key, Date.now() + 1000), 'Quarantined');
  });
});
for (const value of [
  { data: { current_version: 0, versions: {} } },
  { data: { current_version: 7, versions: {} } },
  ...[{ destroyed: true, deletion_time: '' }, { destroyed: false, deletion_time: 'later' },
    { destroyed: false }, { deletion_time: '' }, { destroyed: false, deletion_time: null }]
    .map(entry => ({ data: { current_version: 7, versions: { '7': entry } } })),
]) test(`metadata unsafe structure ${JSON.stringify(value)}`, async () => {
  await withServer(() => ({ status: 200, value }), async (store, seen) => {
    await fails(store.observeMetadata(key, Date.now() + 1000), 'Quarantined'); assert.deepEqual(seen, [metadataPath]);
  });
});
test('metadata 403 remains Denied', async () => {
  await withServer(() => ({ status: 403, value: {} }), async store => {
    await fails(store.observeMetadata(key, Date.now() + 1000), 'Denied');
  });
});
test('data 404 with existing metadata is quarantined', async () => {
  await withServer(url => url.includes('/metadata/') ? { status: 200, value: wireMetadata } : { status: 404, value: {} }, async (store, seen) => {
    await fails(store.observeData(key, metadata, Date.now() + 1000), 'Quarantined');
    assert.deepEqual(seen, [metadataPath, dataPath]);
  });
});
test('schema 1 returns material-free classification, not migration validation', async () => {
  await withServer(url => ({ status: 200, value: url.includes('/metadata/') ? wireMetadata : {
    data: { data: { schemaVersion: 1, provider: 'unknown', extra: true, material: { access: 'legacy-canary' } },
      metadata: { version: 7, destroyed: false, deletion_time: '' } } } }), async (store, seen) => {
    const result = await Effect.runPromise(store.observeData(key, metadata, Date.now() + 1000));
    assert.deepEqual(result, { kind: 'schema1', schemaVersion: 1, metadata, dataVersion: 7 });
    assert.equal(JSON.stringify(result).includes('legacy-canary'), false);
    assert.ok(Object.isFrozen(result)); assert.deepEqual(seen, [metadataPath, dataPath, metadataPath]);
  });
});

for (const provider of ['agy', 'codex', 'claude', 'grok'] as const) test(`safe active ${provider} has one token and exactly three requests`, async () => {
  const identity = { ...key, provider };
  const data = { data: { ...wireData.data, data: { ...wireData.data.data, provider } } };
  await withServer(url => ({ status: 200, value: url.includes('/metadata/') ? wireMetadata : data }), async (store, seen, _config, tokens) => {
    const result = await Effect.runPromise(store.observeData(identity, metadata, Date.now() + 1000));
    assert.equal(result.kind, 'managed'); assert.equal(result.dataVersion, 7);
    assert.deepEqual(result.metadata, metadata); assert.notEqual(result.metadata, metadata);
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.metadata));
    if (result.kind === 'managed') {
      assert.equal(result.envelope.provider, provider); assert.equal(result.envelope.account, key.account);
      assert.equal(result.envelope.generation, 7); assert.equal(result.envelope.schemaVersion, 2);
      assert.equal(result.envelope.state, 'active'); assert.ok(Object.isFrozen(result.envelope));
      if (result.envelope.state === 'active') {
        assert.ok(Redacted.isRedacted(result.envelope.material));
        const material = Redacted.value(result.envelope.material);
        assert.deepEqual(material, data.data.data.material); assert.notEqual(material, data.data.data.material);
        assert.ok(Object.isFrozen(material)); assert.equal(Object.getPrototypeOf(material), Object.prototype);
      }
    }
    assert.equal(tokens(), 1);
    assert.deepEqual(seen, [metadataPath.replace('/codex/', `/${provider}/`), dataPath.replace('/codex/', `/${provider}/`), metadataPath.replace('/codex/', `/${provider}/`)]);
    assert.equal(JSON.stringify(result).includes('foreman-synthetic-observation'), false);
  });
});
test('tombstone has no material and decoded wire objects become ordinary envelopes', async () => {
  const data = { data: { ...wireData.data, data: { ...key, schemaVersion: 2, generation: 7, state: 'tombstoned' } } };
  await withServer(url => ({ status: 200, value: url.includes('/metadata/') ? wireMetadata : data }), async store => {
    const result = await Effect.runPromise(store.observeData(key, metadata, Date.now() + 1000));
    assert.deepEqual(result, { kind: 'managed', metadata, dataVersion: 7, envelope: data.data.data });
    if (result.kind === 'managed') { assert.equal(Object.hasOwn(result.envelope, 'material'), false); assert.equal(Object.getPrototypeOf(result.envelope), Object.prototype); }
  });
});
test('prototype-related valid material keys are copied as own data', async () => {
  const material = { constructor: 'foreman-synthetic-constructor', prototype: 'foreman-synthetic-prototype', toString: 'foreman-synthetic-string' };
  await withServer(url => ({ status: 200, value: url.includes('/metadata/') ? wireMetadata : { data: { ...wireData.data, data: { ...wireData.data.data, material } } } }), async store => {
    const result = await Effect.runPromise(store.observeData(key, metadata, Date.now() + 1000));
    assert.equal(result.kind, 'managed');
    if (result.kind === 'managed' && result.envelope.state === 'active') {
      const actual = Redacted.value(result.envelope.material);
      assert.deepEqual(actual, material); assert.equal(Object.getPrototypeOf(actual), Object.prototype);
      for (const name of Object.keys(material)) assert.ok(Object.hasOwn(actual, name));
    } else assert.fail('expected active envelope');
  });
});
const badDataCases: readonly [string, unknown][] = [
  ['wire version mismatch', { ...wireData.data, metadata: { ...wireData.data.metadata, version: 6 } }],
  ['generation mismatch', { ...wireData.data, data: { ...wireData.data.data, generation: 6 } }],
  ['legacy wire version mismatch', { data: { schemaVersion: 1 }, metadata: { ...wireData.data.metadata, version: 6 } }],
  ['unknown envelope field', { ...wireData.data, data: { ...wireData.data.data, extra: true } }],
  ['wrong identity', { ...wireData.data, data: { ...wireData.data.data, account: 'other' } }],
  ['missing destroyed', { ...wireData.data, metadata: { version: 7, deletion_time: '' } }],
  ['missing deletion_time', { ...wireData.data, metadata: { version: 7, destroyed: false } }],
  ['destroyed', { ...wireData.data, metadata: { ...wireData.data.metadata, destroyed: true } }],
  ['scheduled deletion', { ...wireData.data, metadata: { ...wireData.data.metadata, deletion_time: 'future' } }],
  ['unknown data metadata field', { ...wireData.data, metadata: { ...wireData.data.metadata, extra: true } }],
  ['unknown data wrapper field', { ...wireData.data, extra: true }],
  ['non-synthetic material', { ...wireData.data, data: { ...wireData.data.data, material: { access: 'canary' } } }],
  ['invalid proto key', { ...wireData.data, data: { ...wireData.data.data, material: JSON.parse('{"__proto__":"foreman-synthetic-proto"}') as unknown } }],
  ['tombstone with material', { ...wireData.data, data: { ...wireData.data.data, state: 'tombstoned' } }],
];
for (const [name, data] of badDataCases) test(`data quarantines ${name}`, async () => {
  await withServer(url => ({ status: 200, value: url.includes('/metadata/') ? wireMetadata : { data } }), async (store, seen) => {
    await fails(store.observeData(key, metadata, Date.now() + 1000), 'Quarantined'); assert.deepEqual(seen, [metadataPath, dataPath]);
  });
});
for (const at of [1, 3]) for (const missing of [false, true]) test(`generation guard at request ${at}, missing=${missing}`, async () => {
  await withServer((url, count) => count === at ? missing ? { status: 404, value: {} } : { status: 200, value: { data: { current_version: 8, versions: { '8': { destroyed: false, deletion_time: '' } } } } }
    : { status: 200, value: url.includes('/metadata/') ? wireMetadata : wireData }, async (store, seen) => {
    await fails(store.observeData(key, metadata, Date.now() + 1000), 'Quarantined');
    assert.deepEqual(seen, at === 1 ? [metadataPath] : [metadataPath, dataPath, metadataPath]);
  });
});
for (const bytes of [Buffer.from('{"data":{},"data":{"canary":1}}'), Buffer.from([0xff]), Buffer.alloc(65 * 1024, 'x')]) {
  for (const at of [1, 2]) test(`malformed response ${bytes.length} bytes at ${at}`, async () => {
    await withServer((_url, count) => count === at ? { status: 200, bytes } : { status: 200, value: wireMetadata }, async (store, seen) => {
      await fails(store.observeData(key, metadata, Date.now() + 1000), 'Quarantined'); assert.equal(seen.length, at);
    });
  });
}
test('unsafe initial metadata never requests data', async () => {
  for (const entry of [{ destroyed: true, deletion_time: '' }, { destroyed: false }, { destroyed: false, deletion_time: 'later' }]) {
    await withServer(() => ({ status: 200, value: { data: { current_version: 7, versions: { '7': entry } } } }), async (store, seen) => {
      await fails(store.observeData(key, metadata, Date.now() + 1000), 'Quarantined'); assert.deepEqual(seen, [metadataPath]);
    });
  }
});
test('bootstrap failures are closed and cannot become absence', async () => {
  await withServer(() => ({ status: 200, value: wireMetadata }), async (_store, seen, config) => {
    const callbacks: OpenBaoCredentialStoreConfig['token'][] = [
      () => Effect.fail({ _tag: 'CredentialStoreFailure', code: 'NotFound' }),
      () => { throw new Error('bootstrap-canary'); },
      () => Effect.die(new Error('bootstrap-canary')),
      () => Effect.fail({ bad: 'bootstrap-canary' }) as unknown as ReturnType<OpenBaoCredentialStoreConfig['token']>,
    ];
    for (const token of callbacks) {
      const store = makeSyntheticOpenBaoManagedStore({ ...config, token });
      await fails(store.observeMetadata(key, Date.now() + 1000), 'Unavailable');
      await fails(store.observeData(key, metadata, Date.now() + 1000), 'Unavailable');
    }
    assert.deepEqual(seen, []);
  });
});
test('host config key metadata and deadlines reject malformed values without executing getters or tokens', async () => {
  await withServer(() => ({ status: 200, value: wireMetadata }), async (store, seen, config, tokens) => {
    let getters = 0;
    const hostile = new Proxy({}, { ownKeys() { throw new Error('host-canary'); } });
    const nullRecord = Object.create(null) as Record<string, unknown>;
    const badConfigs: unknown[] = [null, [], nullRecord, hostile, { ...config, extra: true }, { ...config, namespace: undefined },
      { ...config, caPem: 3 }, { ...config, token: 3 }, { ...config, [Symbol()]: true }, Object.create(config),
      Object.defineProperty({ ...config }, 'endpoint', { get() { getters++; throw new Error('getter'); } })];
    for (const bad of badConfigs) {
      const invalid = makeSyntheticOpenBaoManagedStore(bad as OpenBaoCredentialStoreConfig);
      await fails(invalid.observeMetadata(key, Date.now() + 1000), 'InvalidInput');
      await fails(invalid.observeData(key, metadata, Date.now() + 1000), 'InvalidInput');
    }
    for (const bad of [null, [], nullRecord, hostile, { ...key, account: 'bad\n' }, { ...key, provider: 'other' }, { ...key, extra: true },
      { ...key, [Symbol()]: true }, Object.create(key), Object.defineProperty({ ...key }, 'account', { get() { getters++; return 'synthetic'; } })]) {
      await fails(store.observeMetadata(bad as AccountKey, Date.now() + 1000), 'InvalidInput');
      await fails(store.observeData(bad as AccountKey, metadata, Date.now() + 1000), 'InvalidInput');
    }
    for (const bad of [null, [], nullRecord, hostile, { ...metadata, currentVersion: 0 }, { ...metadata, currentVersion: Number.MAX_SAFE_INTEGER + 1 },
      { ...metadata, deleted: true }, { ...metadata, destroyed: true }, { ...metadata, deletionScheduled: true }, { ...metadata, extra: true },
      { ...metadata, [Symbol()]: true }, Object.defineProperty({ ...metadata }, 'currentVersion', { get() { getters++; return 7; } })]) {
      await fails(store.observeData(key, bad as CurrentMetadata, Date.now() + 1000), 'InvalidInput');
    }
    for (const deadline of [NaN, Infinity, 0, Date.now() - 1]) {
      await fails(store.observeMetadata(key, deadline), 'InvalidInput');
      await fails(store.observeData(key, metadata, deadline), 'InvalidInput');
    }
    await fails(makeOpenBaoManagedStore(config).observeMetadata(key, Date.now() + 1000), 'InvalidInput');
    assert.equal(getters, 0); assert.equal(tokens(), 0); assert.deepEqual(seen, []);
  });
});
test('construction and unexecuted effects are lazy; execution snapshots before token wait', async () => {
  await withServer(url => ({ status: 200, value: url.includes('/metadata/') ? wireMetadata : wireData }), async (_store, seen, config) => {
    let tokens = 0; let release!: () => void; let acquired!: () => void;
    const started = new Promise<void>(resolve => { acquired = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const mutableKey: AccountKey = { ...key }; const mutableMetadata = { ...metadata };
    const store = makeSyntheticOpenBaoManagedStore({ ...config, token: () => {
      tokens++; acquired(); return Effect.promise(() => gate).pipe(Effect.as(Redacted.make('synthetic-token')));
    } });
    const effect = store.observeData(mutableKey, mutableMetadata, Date.now() + 1000);
    store.observeMetadata(key, Date.now() + 1000);
    assert.equal(tokens, 0); assert.deepEqual(seen, []);
    const resultPromise = Effect.runPromise(effect); await started;
    Object.assign(mutableKey, { account: 'other' }); Object.assign(mutableMetadata, { currentVersion: 8 }); release();
    const result = await resultPromise; assert.equal(result.dataVersion, 7); assert.deepEqual(result.metadata, metadata);
    assert.equal(tokens, 1); assert.deepEqual(seen, [metadataPath, dataPath, metadataPath]);
  });
});
test('hanging token and peer obey operation deadline', async () => {
  await withServer(() => ({ status: 200, hang: true }), async (store, seen, config) => {
    await fails(makeSyntheticOpenBaoManagedStore({ ...config, token: () => Effect.never }).observeData(key, metadata, Date.now() + 60), 'Timeout');
    assert.deepEqual(seen, []);
    await fails(store.observeData(key, metadata, Date.now() + 100), 'Timeout'); assert.deepEqual(seen, [metadataPath]);
  });
});
test('three requests share the deadline, including token acquisition', async () => {
  await withServer(url => ({ status: 200, delay: 120, value: url.includes('/metadata/') ? wireMetadata : wireData }), async (_store, seen, config) => {
    let tokens = 0;
    const store = makeSyntheticOpenBaoManagedStore({ ...config, token: () => {
      tokens++; return Effect.sleep(80).pipe(Effect.as(Redacted.make('synthetic-token')));
    } });
    await fails(store.observeData(key, metadata, Date.now() + 380), 'Timeout');
    assert.equal(tokens, 1); assert.deepEqual(seen, [metadataPath, dataPath, metadataPath]);
  });
});
test('the complete operation caps a distant deadline at five seconds', async () => {
  await withServer(() => ({ status: 200, value: wireMetadata }), async (_store, seen, config) => {
    const start = Date.now();
    const store = makeSyntheticOpenBaoManagedStore({ ...config, token: () => Effect.never });
    await fails(store.observeData(key, metadata, start + 60_000), 'Timeout');
    assert.ok(Date.now() - start >= 4900); assert.ok(Date.now() - start < 6500); assert.deepEqual(seen, []);
  });
});
test('interruption closes the request socket without retry', async () => {
  let arrived!: () => void; let closed!: () => void;
  const requestStarted = new Promise<void>(resolve => { arrived = resolve; });
  const socketClosed = new Promise<void>(resolve => { closed = resolve; });
  let requests = 0;
  const server = createServer(request => { requests++; request.socket.once('close', closed); arrived(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  try {
    const store = makeSyntheticOpenBaoManagedStore({ endpoint: `http://127.0.0.1:${address.port}`, mount: 'credentials', token: () => Effect.succeed(Redacted.make('synthetic-token')) });
    const fiber = Effect.runFork(store.observeData(key, metadata, Date.now() + 1000));
    await requestStarted;
    const exit = await Effect.runPromise(Fiber.interrupt(fiber));
    assert.equal(exit._tag, 'Failure'); if (exit._tag === 'Failure') assert.ok(Cause.isInterruptedOnly(exit.cause));
    await socketClosed; assert.equal(requests, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
