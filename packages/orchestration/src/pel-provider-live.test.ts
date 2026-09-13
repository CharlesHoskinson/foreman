import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Effect, Redacted } from 'effect';
import { makeLiveProviderCredentials } from './pel-provider-live.js';
const context = { stateRoot: '/tmp/foreman-state-unused', worktreeRoot: '/tmp/work-unused', userHome: '/tmp/user-unused', environment: { OPENAI_API_KEY: 'private-fixture-openai', ANTHROPIC_API_KEY: 'private-fixture-anthropic' } };
test('provider credential injection resolves only an exact account and transport pair', async () => {
    const service = makeLiveProviderCredentials(context, 'openai-responses');
    const material = await Effect.runPromise(Effect.scoped(service.resolve('env:OPENAI_API_KEY')));
    assert.equal(Redacted.value(material.headers!.Authorization!), 'Bearer private-fixture-openai');
    assert.ok(!JSON.stringify(material).includes('private-fixture'));
    for (const ref of ['env:ANTHROPIC_API_KEY', 'native:claude:default', 'env:MISSING', 'unknown']) {
        const result = await Effect.runPromise(Effect.scoped(service.resolve(ref)).pipe(Effect.either));
        assert.equal(result._tag, 'Left');
        if (result._tag === 'Left') {
            assert.equal(result.left._tag, 'AuthenticationRequired');
            assert.ok(!JSON.stringify(result.left).includes('private-fixture'));
        }
    }
});
test('missing selected credential never borrows an available different account', async () => { const result = await Effect.runPromise(Effect.scoped(makeLiveProviderCredentials({ ...context, environment: { ANTHROPIC_API_KEY: 'available' } }, 'openai-responses').resolve('env:OPENAI_API_KEY')).pipe(Effect.either)); assert.equal(result._tag, 'Left'); });
test('live no-tool qualification requires observed protocol catalog and a validated terminal result',async()=>{
 const {assessLiveQualificationCapability}=await import('./pel-provider-live.js');
 const base={schemaVersion:1 as const,effectId:'e',providerIdentity:{kind:'native' as const,provider:'anthropic',profileId:'claude-opus-5',transportId:'claude-code',credentialProfileRef:'a',protocolVersion:'2.1.270',sessionId:'s'}};
 const completed:import('@foreman/providers').ProviderEventV1={...base,payload:{type:'completed',result:{value:{tag:'boolean',value:true},json:{value:true},schemaId:'schema:pel-boolean-v1',schemaSha256:'a'.repeat(64),byteLength:14}}};
 const observed:import('@foreman/providers').ProviderEventV1={...base,payload:{type:'started',observedToolPolicy:'none'}};
 assert.equal(assessLiveQualificationCapability('toolPolicyNone',[completed]).passed,false);
 assert.equal(assessLiveQualificationCapability('toolPolicyNone',[observed]).passed,false);
 assert.equal(assessLiveQualificationCapability('toolPolicyNone',[observed,completed]).passed,true);
 assert.equal(assessLiveQualificationCapability('codingTask',[observed,completed]).passed,false);
});
