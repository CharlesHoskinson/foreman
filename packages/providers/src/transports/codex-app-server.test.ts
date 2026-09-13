import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Effect, Queue, Redacted, Stream } from 'effect';
import { createCodexAppServerTransport } from './codex-app-server.js';
import { resolveProfile } from '../profiles.js';
import type { ProviderRequestV1 } from '../contract.js';
import type { NativeProcessPort } from './native-process.js';
const profile = resolveProfile('gpt-6-astra');
if (!profile.ok)
    throw Error();
const request = (): ProviderRequestV1 => ({ schemaVersion: 1, effectId: 'e', profileId: 'gpt-6-astra', transportId: 'codex-app-server', trustedInstructions: 'Return JSON', artifacts: [], toolPolicy: { mode: 'native-coding', workspaceGrantId: 'w', permissionGrantIds: ['p'], hostPermissionPortRef: 'host' }, outputSchema: { id: 'schema:pel-boolean-v1', content: { type: 'boolean' } }, controls: profile.value.defaults, limits: { deadline: Date.now() + 5000, maxInputTokens: 1000, maxOutputTokens: 100, maxToolCalls: 2, maxOutputBytes: 65536, maxCostUsd: 1, spendReservationRef: 'r' }, credentialProfileRef: 'account', profileHash: profile.value.profileHash, sourceManifestHash: profile.value.sourceManifestHash, transportVersion: 'test-v1' });
function fixture(model = 'gpt-6-astra', extra: Record<string, unknown>[] = [], credentialMaterial: import('../contract.js').CredentialMaterialV1 = { environment: { OPENAI_API_KEY: Redacted.make('fake-key') } }) {
    const sent: Record<string, unknown>[] = [];
    let opened = 0;
    const process: NativeProcessPort = { open: () => Effect.gen(function* () { opened++; const q = yield* Queue.unbounded<Record<string, unknown>>(); return { events: Stream.fromQueue(q), close: () => Effect.void, send: m => Effect.gen(function* () { sent.push(m); if (m.method === 'initialize')
                yield* Queue.offer(q, { id: m.id, result: { userAgent: 'codex/test' } }); if (m.method === 'thread/start')
                yield* Queue.offer(q, { id: m.id, result: { model, modelProvider: 'openai', thread: { id: 'thread', sessionId: 'session' } } }); if (m.method === 'turn/start') {
                yield* Queue.offer(q, { id: m.id, result: { turn: { id: 'turn' } } });
                for (const frame of extra)
                    yield* Queue.offer(q, frame);
                yield* Queue.offer(q, { method: 'item/completed', params: { threadId: 'thread', turnId: 'turn', item: { type: 'agentMessage', id: 'message', phase: 'final_answer', text: '{"value":true}' } } });
                yield* Queue.offer(q, { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } });
            } }) }; }) };
    const host = { cwd: '/tmp', environment: {}, workspaceGrantId: 'w', permissionGrantIds: ['p'], hostPermissionPortRef: 'host', toolPolicyNoneEnforced: false, workspaceBoundaryEnforced: true, permissionBoundaryEnforced: true, permissions: { authorize: () => Effect.succeed('auth'), submit: (_i: unknown, _r: unknown, send: () => Effect.Effect<void, import("../errors.js").ProviderFailure>) => send() } };
    return { transport: createCodexAppServerTransport({ credentials: { resolve: () => Effect.succeed(credentialMaterial) }, process, version: 'test-v1', host }), sent, opened: () => opened };
}
test('Codex app server observes exact model before starting one turn and validates final output', async () => {
    const f = fixture();
    const events = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start(request())); })));
    const completed = Array.from(events).find(e => e.payload.type === 'completed');
    assert.ok(completed);
    assert.equal(completed.providerIdentity.kind, 'native');
    assert.equal(completed.providerIdentity.profileId, 'gpt-6-astra');
    assert.equal(f.sent.filter(m => m.method === 'turn/start').length, 1);
    assert.equal((f.sent.find(m => m.method === 'thread/start')?.params as Record<string, unknown>).allowProviderModelFallback, false);
});
test('Codex model mismatch never starts a turn', async () => { const f = fixture('gpt-5.6-sol'); const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start(request())); })).pipe(Effect.either)); assert.equal(result._tag, 'Left'); if (result._tag === 'Left')
    assert.equal(result.left._tag, 'ModelMismatch'); assert.equal(f.sent.filter(m => m.method === 'turn/start').length, 0); });
test('Codex toolPolicy none without an enforced boundary rejects before process or credential use', async () => { const f = fixture(); const result = await Effect.runPromise(Effect.scoped(f.transport.start({ ...request(), toolPolicy: { mode: 'none' } })).pipe(Effect.either)); assert.equal(result._tag, 'Left'); assert.equal(f.opened(), 0); });
test('Codex uncertain resume never dispatches a replacement turn', async () => { const f = fixture(); const id = { kind: 'native' as const, provider: 'openai', profileId: 'gpt-6-astra', transportId: 'codex-app-server', credentialProfileRef: 'account', protocolVersion: 'test-v1', sessionId: 'session', threadId: 'thread', turnId: 'turn' }; const result = await Effect.runPromise(Effect.scoped(f.transport.resume(request(), id, 'cursor')).pipe(Effect.either)); assert.equal(result._tag, 'Left'); assert.equal(f.opened(), 0); });
test('Codex rejects absent selected credential material before native dispatch', async () => { const f = fixture('gpt-6-astra', [], {}); const result = await Effect.runPromise(Effect.scoped(f.transport.start(request())).pipe(Effect.either)); assert.equal(result._tag, 'Left'); if (result._tag === 'Left')
    assert.equal(result.left._tag, 'AuthenticationRequired'); assert.equal(f.opened(), 0); });
test('Codex counts native tools that do not ask for permission', async () => { const f = fixture('gpt-6-astra', Array.from({ length: 3 }, (_, i) => ({ method: 'item/started', params: { threadId: 'thread', turnId: 'turn', item: { id: `tool-${i}`, type: 'commandExecution' } } }))); const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start(request())); })).pipe(Effect.either)); assert.equal(result._tag, 'Left'); if (result._tag === 'Left')
    assert.equal(result.left._tag, 'UnsupportedCapability'); });
test('Codex checks cumulative usage rather than only the last model call', async () => { const f = fixture('gpt-6-astra', [{ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', tokenUsage: { last: { inputTokens: 600, outputTokens: 60 }, total: { inputTokens: 1200, outputTokens: 120 } } } }]); const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start(request())); })).pipe(Effect.either)); assert.equal(result._tag, 'Left'); if (result._tag === 'Left')
    assert.equal(result.left._tag, 'OutputIncomplete'); });
test('Codex text fragments do not borrow their shared item ID as event identity', async () => { const f = fixture('gpt-6-astra', ['one', 'two'].map(delta => ({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'turn', itemId: 'same-item', delta } }))); const events = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start(request())); }))); const fragments = Array.from(events).filter(e => e.payload.type === 'text'); assert.equal(fragments.length, 2); assert.ok(fragments.every(e => e.sourceEventId === undefined)); });
