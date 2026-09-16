import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Effect, Queue, Redacted, Stream } from 'effect';
import { createCodexAppServerTransport } from './codex-app-server.js';
import { resolveProfile } from '../profiles.js';
import type { ProviderRequestV1 } from '../contract.js';
import type { NativeProcessPort, NativeLaunchV1 } from './native-process.js';
const profile = resolveProfile('gpt-6-astra');
if (!profile.ok)
    throw Error();
const request = (): ProviderRequestV1 => ({ schemaVersion: 1, effectId: 'e', profileId: 'gpt-6-astra', transportId: 'codex-app-server', trustedInstructions: 'Return JSON', artifacts: [], toolPolicy: { mode: 'native-coding', workspaceGrantId: 'w', permissionGrantIds: ['p'], hostPermissionPortRef: 'host' }, outputSchema: { id: 'schema:pel-boolean-v1', content: { type: 'boolean' } }, controls: profile.value.defaults, limits: { deadline: Date.now() + 5000, maxInputTokens: 1000, maxOutputTokens: 100, maxToolCalls: 2, maxOutputBytes: 65536, maxCostUsd: 1, spendReservationRef: 'r' }, credentialProfileRef: 'account', profileHash: profile.value.profileHash, sourceManifestHash: profile.value.sourceManifestHash, transportVersion: 'test-v1' });
function fixture(model = 'gpt-6-astra', extra: Record<string, unknown>[] = [], credentialMaterial: import('../contract.js').CredentialMaterialV1 = { environment: { OPENAI_API_KEY: Redacted.make('fake-key') } }, loginFrames?: Record<string, unknown>[]) {
    const sent: Record<string, unknown>[] = [];
    let opened = 0;
    const launches: NativeLaunchV1[] = [];
    const process: NativeProcessPort = { open: launch => Effect.gen(function* () { opened++; launches.push(launch); const q = yield* Queue.unbounded<Record<string, unknown>>(); return { events: Stream.fromQueue(q), close: () => Effect.void, send: m => Effect.gen(function* () { sent.push(m); if (m.method === 'account/login/start') {
                for(const frame of loginFrames ?? [{ id: m.id, result: { type: 'chatgptAuthTokens' } }, { method: 'account/login/completed', params: { loginId: null, success: true, error: null } }]) yield* Queue.offer(q, frame);
            } if (m.method === 'initialize')
                yield* Queue.offer(q, { id: m.id, result: { userAgent: 'codex/test' } }); if (m.method === 'thread/start')
                yield* Queue.offer(q, { id: m.id, result: { model, modelProvider: 'openai', thread: { id: 'thread', sessionId: 'session' } } }); if (m.method === 'turn/start') {
                yield* Queue.offer(q, { id: m.id, result: { turn: { id: 'turn' } } });
                for (const frame of extra)
                    yield* Queue.offer(q, frame);
                yield* Queue.offer(q, { method: 'item/completed', params: { threadId: 'thread', turnId: 'turn', item: { type: 'agentMessage', id: 'message', phase: 'final_answer', text: '{"value":true}' } } });
                yield* Queue.offer(q, { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } });
            } }) }; }) };
    const host = { cwd: '/tmp', environment: {}, workspaceGrantId: 'w', permissionGrantIds: ['p'], hostPermissionPortRef: 'host', toolPolicyNoneEnforced: false, workspaceBoundaryEnforced: true, permissionBoundaryEnforced: true, permissions: { authorize: () => Effect.succeed('auth'), submit: (_i: unknown, _r: unknown, send: () => Effect.Effect<void, import("../errors.js").ProviderFailure>) => send() } };
    return { transport: createCodexAppServerTransport({ credentials: { resolve: () => Effect.succeed(credentialMaterial) }, process, version: 'test-v1', host }), sent, launches, opened: () => opened };
}

function nativeLogin(account = 'selected-account', refreshed = account) {
    const calls: { refresh: boolean; previousAccountId?: string; deadline: number }[] = [];
    return { calls, material: { chatgpt: { tokens: (input: typeof calls[number]) => {
        calls.push(input);
        return Effect.succeed({ accessToken: Redacted.make(input.refresh ? 'private-refreshed-token' : 'private-access-token'), chatgptAccountId: input.refresh ? refreshed : account });
    } } } };
}
test('Codex uses host-managed ChatGPT login before a thread without key, profile, or token environment', async () => {
    const login = nativeLogin();
    const f = fixture('gpt-6-astra', [], login.material as import('../contract.js').CredentialMaterialV1);
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start(request())); })).pipe(Effect.either));
    assert.equal(result._tag, 'Right');
    assert.equal(f.sent.find(m => m.method === 'account/login/start')?.params && (f.sent.find(m => m.method === 'account/login/start')!.params as Record<string, unknown>).type, 'chatgptAuthTokens');
    assert.ok(f.sent.findIndex(m => m.method === 'account/login/start') < f.sent.findIndex(m => m.method === 'thread/start'));
    assert.doesNotMatch(JSON.stringify(f.launches), /private-access-token|CODEX_HOME|OPENAI_API_KEY/);
    assert.doesNotMatch(JSON.stringify(result), /private-access-token|private-refreshed-token/);
});
test('Codex refresh uses the same host account and never emits credential events', async () => {
    const login = nativeLogin();
    const f = fixture('gpt-6-astra', [{ id: 71, method: 'account/chatgptAuthTokens/refresh', params: { reason: 'unauthorized', previousAccountId: 'selected-account' } }], login.material as import('../contract.js').CredentialMaterialV1);
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start(request())); })).pipe(Effect.either));
    assert.equal(result._tag, 'Right');
    assert.equal(login.calls.filter(c => c.refresh).length, 1);
    assert.equal((f.sent.find(m => m.id === 71)?.result as Record<string, unknown>)?.accessToken, 'private-refreshed-token');
    assert.doesNotMatch(JSON.stringify(result), /private-refreshed-token/);
});
for (const reply of [{ id: 3, result: { type: 'apiKey' } }, { id: 3, error: { message: 'private-error-fixture' } }]) test('Codex refuses a failed or malformed external login before a thread', async () => {
    const f = fixture('gpt-6-astra', [], nativeLogin().material, [reply]);
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start(request())); })).pipe(Effect.either));
    assert.equal(result._tag, 'Left');
    assert.equal(f.sent.some(m => m.method === 'thread/start'), false);
    assert.doesNotMatch(JSON.stringify(result), /private-error-fixture/);
});
test('Codex handles refresh before thread identity exists', async () => {
    const login = nativeLogin();
    const f = fixture('gpt-6-astra', [], login.material, [{ id: 72, method: 'account/chatgptAuthTokens/refresh', params: { reason: 'unauthorized', previousAccountId: 'selected-account' } }, { id: 3, result: { type: 'chatgptAuthTokens' } }, { method: 'account/login/completed', params: { loginId: null, success: true, error: null } }]);
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start(request())); })).pipe(Effect.either));
    assert.equal(result._tag, 'Right');
    assert.equal(login.calls.filter(c => c.refresh).length, 1);
    assert.ok(f.sent.findIndex(m => m.id === 72) < f.sent.findIndex(m => m.method === 'thread/start'));
});
test('Codex rejects a failed external login completion without starting inference', async () => {
    const f = fixture('gpt-6-astra', [], nativeLogin().material, [{ id: 3, result: { type: 'chatgptAuthTokens' } }, { method: 'account/login/completed', params: { loginId: null, success: false, error: 'private-error-fixture' } }]);
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start(request())); })).pipe(Effect.either));
    assert.equal(result._tag, 'Left');
    assert.equal(f.sent.some(m => m.method === 'turn/start'), false);
    assert.doesNotMatch(JSON.stringify(result), /private-error-fixture/);
});
for (const completion of [
    { loginId: null, success: false, error: 'private-error-fixture' },
    { loginId: 'foreign-login', success: true, error: null },
    { loginId: null, success: true, error: 'private-error-fixture' },
    { loginId: null, success: true },
]) test('Codex waits for successful external login completion before thread or inference', async () => {
    const f = fixture('gpt-6-astra', [], nativeLogin().material, [
        { id: 3, result: { type: 'chatgptAuthTokens' } },
        { id: 1, result: { model: 'gpt-6-astra', modelProvider: 'openai', thread: { id: 'thread', sessionId: 'session' } } },
        { method: 'account/login/completed', params: completion },
    ]);
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        return yield* Stream.runCollect(yield* f.transport.start(request()));
    })).pipe(Effect.either));
    assert.equal(result._tag, 'Left');
    assert.equal(f.sent.some(m => m.method === 'thread/start' || m.method === 'turn/start'), false);
    assert.doesNotMatch(JSON.stringify(result), /private-error-fixture/);
});
test('Codex missing external login completion expires without inference', async () => {
    const f = fixture('gpt-6-astra', [], nativeLogin().material, [{ id: 3, result: { type: 'chatgptAuthTokens' } }]);
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        return yield* Stream.runCollect(yield* f.transport.start({ ...request(), limits: { ...request().limits, deadline: Date.now() + 50 } }));
    })).pipe(Effect.either, Effect.timeout('2 seconds')));
    assert.equal(result._tag, 'Left');
    if (result._tag === 'Left') assert.equal(result.left._tag, 'AuthenticationRequired');
    assert.equal(f.sent.some(m => m.method === 'thread/start' || m.method === 'turn/start'), false);
});
test('Codex bounds a hanging host credential callback and sanitizes its failures', async () => {
    const f = fixture('gpt-6-astra', [], { chatgpt: { tokens: () => Effect.never } });
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start({ ...request(), limits: { ...request().limits, deadline: Date.now() + 50 } })); })).pipe(Effect.either));
    assert.equal(result._tag, 'Left');
    if (result._tag === 'Left') assert.equal(result.left._tag, 'AuthenticationRequired');
    assert.equal(f.sent.some(m => m.method === 'thread/start'), false);
});
for (const scenario of ['previous-account', 'changed-account', 'too-many'] as const) test(`Codex rejects unsafe refresh: ${scenario}`, async () => {
    const login = nativeLogin('selected-account', scenario === 'changed-account' ? 'other-account' : 'selected-account');
    const frames = Array.from({ length: scenario === 'too-many' ? 3 : 1 }, (_, i) => ({ id: 70 + i, method: 'account/chatgptAuthTokens/refresh', params: { reason: 'unauthorized', previousAccountId: scenario === 'previous-account' ? 'other-account' : 'selected-account' } }));
    const f = fixture('gpt-6-astra', frames, login.material as import('../contract.js').CredentialMaterialV1);
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start(request())); })).pipe(Effect.either));
    assert.equal(result._tag, 'Left');
    if (result._tag === 'Left') assert.equal(result.left._tag, 'AuthenticationRequired');
    assert.ok(login.calls.filter(c => c.refresh).length <= 2);
    assert.doesNotMatch(JSON.stringify(result), /private-access-token|private-refreshed-token/);
});
test('Codex app server observes exact model before starting one turn and validates final output', async () => {
    const f = fixture();
    const events = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* Stream.runCollect(yield* f.transport.start(request())); })));
    const completed = Array.from(events).find(e => e.payload.type === 'completed');
    assert.ok(completed);
    assert.equal(completed.providerIdentity.kind, 'native');
    assert.equal(completed.providerIdentity.profileId, 'gpt-6-astra');
    assert.equal(f.sent.filter(m => m.method === 'turn/start').length, 1);
    assert.equal((f.sent.find(m => m.method === 'thread/start')?.params as Record<string, unknown>).allowProviderModelFallback, false);
    assert.equal((f.sent.find(m => m.method === 'thread/start')?.params as Record<string, unknown>).sandbox, 'workspace-write');
    assert.equal('environments' in (f.sent.find(m => m.method === 'thread/start')?.params as Record<string, unknown>), false);
    const sandbox = (f.sent.find(m => m.method === 'turn/start')?.params as Record<string, unknown>).sandboxPolicy as Record<string, unknown>;
    assert.equal('readOnlyAccess' in sandbox, false);
    assert.equal(sandbox.networkAccess, false);
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
