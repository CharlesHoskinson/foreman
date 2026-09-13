import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Effect, Stream, Redacted } from 'effect';
import { createClaudeCodeTransport } from './claude-code.js';
import type { NativeLaunchV1 } from './native-process.js';
import type { ProviderRequestV1, ProviderIdentityV1, CredentialMaterialV1 } from '../contract.js';
import { resolveProfile } from '../profiles.js';
const profile = resolveProfile('claude-fable-5-1');
if (!profile.ok)
    throw Error('profile');
const request: ProviderRequestV1 = { schemaVersion: 1, effectId: 'e', profileId: 'claude-fable-5-1', transportId: 'claude-code', trustedInstructions: 'Trusted template', artifacts: [{ id: 'context', contentRef: 'context', sha256: 'x', content: 'é\n"$()'.repeat(22000) }], toolPolicy: { mode: 'none' }, outputSchema: { id: 'schema:pel-boolean-v1', content: { type: 'boolean' } }, controls: { ...profile.value.defaults, toolChoice: 'none' }, limits: { deadline: 100, maxInputTokens: 300000, maxOutputTokens: 1000, maxOutputBytes: 1048576, maxToolCalls: 0, maxCostUsd: 1, spendReservationRef: 'r' }, credentialProfileRef: 'a', profileHash: profile.value.profileHash, sourceManifestHash: profile.value.sourceManifestHash, transportVersion: '2.1.270' };
const identity: ProviderIdentityV1 = { kind: 'native', provider: 'anthropic', profileId: request.profileId, model: request.profileId, transportId: 'claude-code', credentialProfileRef: 'a', protocolVersion: '2.1.270', sessionId: 'session' };
function setup(frames: Readonly<Record<string, unknown>>[], material: CredentialMaterialV1 = {environment:{ANTHROPIC_API_KEY:Redacted.make('secret')}}) { let launches: NativeLaunchV1[] = []; let closes = 0; let resolutions = 0; const transport = createClaudeCodeTransport({ version: '2.1.270', now: () => 1, credentials: { resolve: ref => Effect.sync(() => { assert.equal(ref, 'a'); resolutions++; return material; }) }, host: { cwd: '/tmp/isolated', environment: { PATH: '/usr/bin' }, toolPolicyNoneEnforced: true, workspaceBoundaryEnforced: true, permissionBoundaryEnforced: false, process: { open: launch => Effect.sync(() => { launches.push(launch); return { events: Stream.fromIterable(frames), send: () => Effect.void, close: () => Effect.sync(() => { closes++; }) }; }) } } }); return { transport, launches, get closes() { return closes; }, get resolutions() { return resolutions; } }; }
const init = { type: 'system', subtype: 'init', model: request.profileId, session_id: 'session', uuid: 'init-1' };
test('T-M3-004/005 Claude exact identity, protocol prompt bytes and scoped credentials', async () => {
    const fixture = setup([init, { type: 'stream_event', uuid: 'delta-1', session_id: 'session', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'shown' } } }, { type: 'result', subtype: 'success', uuid: 'result-1', session_id: 'session', structured_output: { value: true }, usage: { input_tokens: 5, output_tokens: 3 }, total_cost_usd: 0.001 }]);
    const events = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const stream = yield* fixture.transport.start(request); return yield* Stream.runCollect(stream); })));
    const values = Array.from(events);
    assert.equal(values[0]?.payload.type, 'started');
    assert.deepEqual(values[0]?.providerIdentity, identity);
    assert.equal(values.at(-1)?.payload.type, 'completed');
    assert.equal(fixture.launches.length, 1);
    assert.equal(fixture.resolutions, 1);
    const launch = fixture.launches[0]!;
    assert.ok(launch.cmd.includes('--restricted'));
    assert.ok(launch.cmd.includes('--safe-mode'));
    assert.equal(launch.cmd[launch.cmd.indexOf('--tools') + 1], '');
    assert.ok(!launch.cmd.includes('--dangerously-skip-permissions'));
    const input = JSON.parse(new TextDecoder().decode(launch.initialInput));
    assert.equal(JSON.parse(input.message.content).artifacts[0].content, request.artifacts[0]?.content);
    assert.equal(launch.environment.ANTHROPIC_API_KEY, 'secret');
    assert.equal(JSON.stringify(request).includes('secret'), false);
});
test('T-M3-006 Claude unsupported coding/controls fail before credentials or spawn', async () => {
    const fixture = setup([]);
    for (const changed of [{ toolPolicy: { mode: 'native-coding', workspaceGrantId: 'w', permissionGrantIds: ['p'], hostPermissionPortRef: 'h' } as const }, { controls: { ...request.controls, execution: { mode: 'background', store: 'provider-default' } as const } }, { controls: { ...request.controls, thinking: { mode: 'disabled' } as const } }]) {
        const result = await Effect.runPromise(Effect.scoped(Effect.either(fixture.transport.start({ ...request, ...changed }))));
        assert.equal(result._tag, 'Left');
    }
    assert.equal(fixture.launches.length, 0);
    assert.equal(fixture.resolutions, 0);
});
test('T-M3-007/012 Claude mismatch, refusal, truncation and uncertain resume remain distinct', async () => {
    for (const [frame, tag] of [[{ ...init, model: 'claude-opus-5' }, 'ModelMismatch'], [{ type: 'assistant', session_id: 'session', message: { model: request.profileId, stop_reason: 'max_tokens', content: [] } }, 'OutputIncomplete']] as const) {
        const fixture = setup(tag === 'ModelMismatch' ? [frame] : [init, frame]);
        const result = await Effect.runPromise(Effect.scoped(Effect.either(Effect.flatMap(fixture.transport.start(request), Stream.runCollect))));
        assert.equal(result._tag, 'Left');
        if (result._tag === 'Left')
            assert.equal(result.left._tag, tag);
    }
    const fixture = setup([init, { type: 'assistant', session_id: 'session', message: { model: request.profileId, stop_reason: 'refusal', content: [] } }]);
    const events = await Effect.runPromise(Effect.scoped(Effect.flatMap(fixture.transport.start(request), Stream.runCollect)));
    assert.equal(Array.from(events).at(-1)?.payload.type, 'refused');
    const unknown = setup([]);
    const resumed = await Effect.runPromise(Effect.scoped(Effect.either(unknown.transport.resume(request, identity, 'cursor'))));
    assert.equal(resumed._tag, 'Left');
    assert.equal(unknown.launches.length, 0);
    assert.equal((await Effect.runPromise(unknown.transport.observe(identity))).status, 'unsupported');
});
test('T-M3-010/011 Claude opaque thinking stays out of text and local cleanup cannot fabricate remote cancellation', async () => {
    const fixture = setup([init, { type: 'assistant', uuid: 'think-1', session_id: 'session', message: { model: request.profileId, content: [{ type: 'thinking', thinking: 'hidden\nbytes', signature: 'opaque-signature' }] } }, { type: 'result', subtype: 'success', uuid: 'result-1', session_id: 'session', structured_output: { value: true } }]);
    const events = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const stream = yield* fixture.transport.start(request); return yield* Stream.runCollect(stream.pipe(Stream.tap(event => event.payload.type === 'started' ? Effect.gen(function* () { const cancelled = yield* fixture.transport.cancel(event.providerIdentity); assert.equal(cancelled.localCleanup, 'complete'); assert.equal(cancelled.remoteOutcome, 'unknown'); assert.equal(cancelled.acknowledged, false); }) : Effect.void))); })));
    const values = Array.from(events);
    const checkpoint = values.find(e => e.payload.type === 'checkpoint');
    assert.ok(checkpoint);
    if (checkpoint?.payload.type === 'checkpoint') {
        assert.equal(new TextDecoder().decode(checkpoint.payload.checkpoint.bytes).includes('hidden\\nbytes'), true);
        assert.equal(checkpoint.payload.checkpoint.retention.expiresAt, undefined);
    }
    assert.equal(values.some(e => e.payload.type === 'text' && e.payload.text.includes('hidden')), false);
    assert.ok(fixture.closes >= 1);
});
test('T-M3-007 Claude missing identity and malformed final JSON fail closed', async () => {
    for (const frames of [[{ ...init, model: undefined }], [init, { type: 'result', subtype: 'success', session_id: 'session', structured_output: { value: 'true' } }], [init]]) {
        const fixture = setup(frames);
        const result = await Effect.runPromise(Effect.scoped(Effect.either(Effect.flatMap(fixture.transport.start(request), Stream.runCollect))));
        assert.equal(result._tag, 'Left');
    }
});
test('T-M3-020 Claude preserves per-model counters and stops observed spend exhaustion',async()=>{
 const fixture=setup([init,{type:'result',subtype:'success',uuid:'r',session_id:'session',structured_output:{value:true},modelUsage:{[request.profileId]:{inputTokens:7,outputTokens:5,cacheReadInputTokens:3,costUSD:0.002}},total_cost_usd:0.002}]);
 const events=Array.from(await Effect.runPromise(Effect.scoped(Effect.flatMap(fixture.transport.start(request),Stream.runCollect))));const final=events.at(-1);assert.equal(final?.payload.type,'completed');if(final?.payload.type==='completed')assert.equal(final.payload.usage?.providerCounters[`${request.profileId}.cacheReadInputTokens`],3);
 const excess=setup([init,{type:'result',subtype:'success',uuid:'r',session_id:'session',structured_output:{value:true},total_cost_usd:2}]);assert.equal((await Effect.runPromise(Effect.scoped(Effect.either(Effect.flatMap(excess.transport.start(request),Stream.runCollect)))))._tag,'Left');
});
test('T-M3-027 Claude rejects missing or unrelated credential material before spawn',async()=>{
 for(const material of [{},{environment:{TOKEN:Redacted.make('unrelated')}},{environment:{ANTHROPIC_API_KEY:Redacted.make('')}}]){const fixture=setup([],material);const result=await Effect.runPromise(Effect.scoped(Effect.either(fixture.transport.start(request))));assert.equal(result._tag,'Left');if(result._tag==='Left')assert.equal(result.left._tag,'AuthenticationRequired');assert.equal(fixture.launches.length,0);}
});
test('Claude schema formatter carries output without granting tool authority', async () => {
    const formatter = { type: 'assistant', session_id: 'session', message: { model: request.profileId, content: [{ type: 'tool_use', id: 'format-1', name: 'StructuredOutput', input: { value: true } }] } };
    const final = { type: 'result', subtype: 'success', uuid: 'final', session_id: 'session', structured_output: { value: true } };
    const fixture = setup([init, formatter, final]);
    const events = Array.from(await Effect.runPromise(Effect.scoped(Effect.flatMap(fixture.transport.start(request), Stream.runCollect))));
    assert.deepEqual(events.map(event => event.payload.type), ['started', 'completed']);
    for (const [frames, tag] of [
        [[init, formatter], 'OutcomeUnknown'],
        [[init, formatter, { ...final, structured_output: { value: 'true' } }], 'OutputInvalid'],
        ...['Bash', 'mcp__server__StructuredOutput', 'structuredoutput'].map(name => [[init, { ...formatter, message: { model: request.profileId, content: [{ type: 'tool_use', id: 'tool-1', name, input: {} }] } }, final], 'UnsupportedCapability']),
    ] as const) {
        const denied = setup(frames as Readonly<Record<string, unknown>>[]);
        const result = await Effect.runPromise(Effect.scoped(Effect.either(Effect.flatMap(denied.transport.start(request), Stream.runCollect))));
        assert.equal(result._tag, 'Left');
        if (result._tag === 'Left') assert.equal(result.left._tag, tag);
    }
});
test('Claude synthetic API errors use closed protocol indicators before model validation', async () => {
    for (const [error, tag] of [['rate_limit', 'RateLimited'], ['authentication_failed', 'AuthenticationRequired'], ['model_not_found', 'ModelUnavailable'], ['cloud_credential_error', 'AuthenticationRequired'], ['overloaded', 'TransportDisconnected'], ['unknown', 'OutcomeUnknown']] as const) {
        const fixture = setup([init, { type: 'assistant', error, session_id: 'session', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Untrusted text must not determine the error class' }] } }]);
        const result = await Effect.runPromise(Effect.scoped(Effect.either(Effect.flatMap(fixture.transport.start(request), Stream.runCollect))));
        assert.equal(result._tag, 'Left');
        if (result._tag === 'Left') assert.equal(result.left._tag, tag);
    }
    const fixture = setup([init, { type: 'assistant', session_id: 'session', message: { model: '<synthetic>', content: [{ type: 'text', text: 'rate_limit authentication_failed' }] } }]);
    const result = await Effect.runPromise(Effect.scoped(Effect.either(Effect.flatMap(fixture.transport.start(request), Stream.runCollect))));
    assert.equal(result._tag, 'Left');
    if (result._tag === 'Left') assert.equal(result.left._tag, 'ModelMismatch');
});
test('Claude auxiliary model accounting preserves exact primary identity and all usage', async () => {
    const final = { type: 'result', subtype: 'success', uuid: 'result', session_id: 'session', structured_output: { value: true }, usage: { input_tokens: 2, output_tokens: 113 }, modelUsage: {
        'claude-haiku-4-5-20251001': { inputTokens: 897, outputTokens: 9, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.000942 },
        [request.profileId]: { inputTokens: 2, outputTokens: 113, cacheReadInputTokens: 0, cacheCreationInputTokens: 978, costUSD: 0.012615 },
    }, total_cost_usd: 0.013557 };
    const fixture = setup([init, { type: 'assistant', session_id: 'session', message: { model: request.profileId, content: [] } }, final]);
    const events = Array.from(await Effect.runPromise(Effect.scoped(Effect.flatMap(fixture.transport.start(request), Stream.runCollect))));
    const completed = events.at(-1)!;
    assert.equal(completed.payload.type, 'completed');
    assert.deepEqual(completed.providerIdentity, identity);
    if (completed.payload.type === 'completed') {
        assert.equal(completed.payload.usage?.inputTokens, 899);
        assert.equal(completed.payload.usage?.outputTokens, 122);
        assert.equal(completed.payload.usage?.cacheWriteTokens, 978);
        assert.equal(completed.payload.usage?.costUsd, '0.013557');
        assert.equal(completed.payload.usage?.providerCounters['claude-haiku-4-5-20251001.inputTokens'], 897);
    }
    for (const limits of [{ ...request.limits, maxOutputTokens: 120 }, { ...request.limits, maxInputTokens: 1000 }, { ...request.limits, maxCostUsd: 0.01 }]) {
        const bounded = setup([init, final]);
        const result = await Effect.runPromise(Effect.scoped(Effect.either(Effect.flatMap(bounded.transport.start({ ...request, limits }), Stream.runCollect))));
        assert.equal(result._tag, 'Left');
        if (result._tag === 'Left') assert.equal(result.left._tag, 'OutputIncomplete');
    }
    const rerouted = setup([init, { type: 'assistant', session_id: 'session', message: { model: 'claude-haiku-4-5-20251001', content: [] } }, final]);
    const result = await Effect.runPromise(Effect.scoped(Effect.either(Effect.flatMap(rerouted.transport.start(request), Stream.runCollect))));
    assert.equal(result._tag, 'Left');
    if (result._tag === 'Left') assert.equal(result.left._tag, 'ModelMismatch');
});
test('Claude no-tool observation requires an explicit empty or reply-only init catalog', async () => {
    const final = { type: 'result', subtype: 'success', uuid: 'result', session_id: 'session', structured_output: { value: true } };
    for (const tools of [[], ['StructuredOutput']]) {
        const fixture = setup([{ ...init, tools }, final]);
        const events = Array.from(await Effect.runPromise(Effect.scoped(Effect.flatMap(fixture.transport.start(request), Stream.runCollect))));
        assert.deepEqual(events[0]?.payload, { type: 'started', observedToolPolicy: 'none' });
        assert.equal(events.at(-1)?.payload.type, 'completed');
    }
    const unavailable = setup([init, final]);
    const events = Array.from(await Effect.runPromise(Effect.scoped(Effect.flatMap(unavailable.transport.start(request), Stream.runCollect))));
    assert.deepEqual(events[0]?.payload, { type: 'started' });
    for (const tools of [['Bash'], ['StructuredOutput', 'Read'], ['mcp__server__StructuredOutput'], [{ name: 'StructuredOutput' }]]) {
        const fixture = setup([{ ...init, tools }, final]);
        const result = await Effect.runPromise(Effect.scoped(Effect.either(Effect.flatMap(fixture.transport.start(request), Stream.runCollect))));
        assert.equal(result._tag, 'Left');
    }
    const permission = setup([{ ...init, tools: [] }, { type: 'control_request', session_id: 'session', request: { subtype: 'can_use_tool', tool_name: 'Bash' } }, final]);
    const result = await Effect.runPromise(Effect.scoped(Effect.either(Effect.flatMap(permission.transport.start(request), Stream.runCollect))));
    assert.equal(result._tag, 'Left');
    if (result._tag === 'Left') assert.equal(result.left._tag, 'UnsupportedCapability');
});
