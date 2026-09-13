import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Effect, Stream } from 'effect';
import type { GenerationRequest, ProviderTransport, ProviderRequestV1 } from './contract.js';
import { defaultProviderControls } from './controls.js';
import { resolveProfile } from './profiles.js';
import { lowerGenerationRequest, makeProviderGenerationPort, GENERATION_OUTPUT_SCHEMA } from './generation.js';
import { decodeProviderResult } from './output.js';
const profile = resolveProfile('gpt-6-astra');
if (!profile.ok)
    throw Error('profile');
const controls = { ...defaultProviderControls('gpt-6-astra', 'openai'), toolChoice: 'none' } as const;
const cell = { expectedIdentityRevision: 'v1', profile: profile.value, transportId: 'openai-responses', transportVersion: '1', controls, evidence: [], bindingKind: 'test-fixture' } as const;
const request: GenerationRequest = { generationId: 'g', effectId: 'g/attempt/1', attempt: 1, modelProfileId: 'gpt-6-astra', transportId: 'openai-responses', controls, credentialProfileRef: 'account', prompt: 'Write (print "hello")', trustedTemplateId: 'foreman:pel-generation-v1', registryCatalog: [], capabilitySnapshot: {} as GenerationRequest['capabilitySnapshot'], artifacts: [], outputSchema: GENERATION_OUTPUT_SCHEMA, grammarMode: 'auto', resolvedGrammarMode: 'envelope', limits: { maxInputTokens: 100, maxOutputTokens: 100, maxCostUnits: 4, maxSourceBytes: 1048576, timeoutMs: 60000, deadline: 100 }, generationBudgetReservationRef: 'reservation' };
test('T-M3-019 one request retains M2 identity, reservation, pinned authority and envelope', async () => {
    const lowered = lowerGenerationRequest(request, cell, 1);
    assert.equal(lowered.ok, true);
    if (!lowered.ok)
        return;
    assert.equal(lowered.value.effectId, 'g/attempt/1');
    assert.equal(lowered.value.profileId, request.modelProfileId);
    assert.equal(lowered.value.limits.spendReservationRef, 'reservation');
    assert.deepEqual(lowered.value.toolPolicy, { mode: 'none' });
    assert.equal(lowered.value.controls.toolChoice, 'none');
    assert.equal(lowered.value.credentialProfileRef, 'account');
    const result = decodeProviderResult('{"pelSource":"(print 1)"}', GENERATION_OUTPUT_SCHEMA);
    if (!result.ok)
        throw result.error;
    let dispatches = 0;
    let captured: ProviderRequestV1 | undefined;
    const identity = { kind: 'api', provider: 'openai', profileId: 'gpt-6-astra', transportId: 'openai-responses', credentialProfileRef: 'account', endpointRevision: 'v1', responseId: 'r' } as const;
    const transport: ProviderTransport = { id: 'openai-responses', version: '1', start: r => Effect.sync(() => { dispatches++; captured = r; return Stream.make({ schemaVersion: 1, effectId: r.effectId, providerIdentity: identity, payload: { type: 'completed', result: result.value } } as const); }), probe: () => Effect.die('unexpected'), cancel: () => Effect.die('unexpected'), resume: () => Effect.die('unexpected'), observe: () => Effect.die('unexpected'), sendToolResult: () => Effect.die('unexpected') };
    const port = makeProviderGenerationPort({ transport, admit: () => ({ ok: true, value: cell }), maxCostUsd: 1, now: () => 1 });
    const response = await Effect.runPromise(port.generate(request));
    assert.equal(response.pelSource, '(print 1)');
    assert.equal(dispatches, 1);
    assert.equal(captured?.effectId, request.effectId);
    const unsupported = await Effect.runPromise(Effect.either(port.generate({ ...request, grammarMode: 'grammar-required', resolvedGrammarMode: 'grammar' })));
    assert.equal(unsupported._tag, 'Left');
    assert.equal(dispatches, 1);
    assert.equal(lowerGenerationRequest({ ...request, trustedTemplateId: 'untrusted' }, cell, 1).ok, false);
});
test('T-M3-019 malformed envelopes, source byte overflow and refusal are terminal without repair', async () => {
    let dispatches = 0;
    const identity = { kind: 'api', provider: 'openai', profileId: 'gpt-6-astra', transportId: 'openai-responses', credentialProfileRef: 'account', endpointRevision: 'v1', responseId: 'r' } as const;
    const base = { id: 'openai-responses', version: '1', probe: () => Effect.die('unexpected'), cancel: () => Effect.die('unexpected'), resume: () => Effect.die('unexpected'), observe: () => Effect.die('unexpected'), sendToolResult: () => Effect.die('unexpected') } as const;
    for (const json of [{ pelSource: 3 }, { pelSource: 'ééé' }, { pelSource: 'valid', extra: true }]) {
        const transport: ProviderTransport = { ...base, start: r => Effect.sync(() => { dispatches++; return Stream.make({ schemaVersion: 1, effectId: r.effectId, providerIdentity: identity, payload: { type: 'completed', result: { json, value: { tag: 'nil' }, schemaId: request.outputSchema.id, schemaSha256: 'forged', byteLength: 1 } } } as const); }) };
        const port = makeProviderGenerationPort({ transport, admit: () => ({ ok: true, value: cell }), maxCostUsd: 1, now: () => 1 });
        assert.equal((await Effect.runPromise(Effect.either(port.generate({ ...request, limits: { ...request.limits, maxSourceBytes: 4 } }))))._tag, 'Left');
    }
    assert.equal(dispatches, 3);
    const transport: ProviderTransport = { ...base, start: r => Effect.succeed(Stream.make({ schemaVersion: 1, effectId: r.effectId, providerIdentity: identity, payload: { type: 'refused', message: 'declined' } } as const)) };
    const port = makeProviderGenerationPort({ transport, admit: () => ({ ok: true, value: cell }), maxCostUsd: 1, now: () => 1 });
    assert.equal((await Effect.runPromise(port.generate(request))).refusal?.message, 'declined');
});
test('T-M3-019 M2 artifact sourceDigest binds the descriptor, not content alone',()=>{
 const sourceDigest='a'.repeat(64);const mapped=lowerGenerationRequest({...request,artifacts:[{id:'artifact:1',sourceDigest,content:{text:'bounded'}}]},cell,1);
 assert.equal(mapped.ok,true);if(mapped.ok){assert.equal(mapped.value.artifacts[0]?.contentRef,`artifact:1#${sourceDigest}`);assert.notEqual(mapped.value.artifacts[0]?.sha256,sourceDigest);}
});
test('T-M3-019 admitted endpoint revision remains bound through generation completion',async()=>{
 const result=decodeProviderResult('{"pelSource":"(print 1)"}',GENERATION_OUTPUT_SCHEMA);if(!result.ok)throw result.error;
 let starts=0;const transport:ProviderTransport={id:'openai-responses',version:'1',start:r=>Effect.sync(()=>{starts++;return Stream.make({schemaVersion:1,effectId:r.effectId,providerIdentity:{kind:'api',provider:'openai',profileId:'gpt-6-astra',transportId:'openai-responses',credentialProfileRef:'account',endpointRevision:'changed-v2',responseId:'r'},payload:{type:'completed',result:result.value}} as const);}),probe:()=>Effect.die('unexpected'),cancel:()=>Effect.die('unexpected'),resume:()=>Effect.die('unexpected'),observe:()=>Effect.die('unexpected'),sendToolResult:()=>Effect.die('unexpected')};
 const port=makeProviderGenerationPort({transport,admit:()=>({ok:true,value:cell}),maxCostUsd:1,now:()=>1});const failed=await Effect.runPromise(Effect.either(port.generate(request)));assert.equal(failed._tag,'Left');if(failed._tag==='Left')assert.equal(failed.left._tag,'ModelMismatch');assert.equal(starts,1);
});
