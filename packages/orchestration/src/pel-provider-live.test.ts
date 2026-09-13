import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Effect, Redacted, Stream } from 'effect';
// The exact transport sources under test, not the generated package bundle.
import { createAnthropicMessagesTransport } from '../../providers/src/transports/anthropic-messages.js';
import { createGoogleInteractionsTransport } from '../../providers/src/transports/google-interactions.js';
import { createOpenaiResponsesTransport } from '../../providers/src/transports/openai-responses.js';
import { createXaiResponsesTransport } from '../../providers/src/transports/xai-responses.js';
import type { ApiHttpPort } from '../../providers/src/transports/api-http.js';
import type { ApiTransportOptions } from '../../providers/src/transports/api-transport.js';
import { defaultProviderControls } from '../../providers/src/controls.js';
import { runQualification } from '../../providers/src/qualification.js';
import type { Capability, ProfileId, ProviderControlsV1, ProviderTransport, TransportId } from '../../providers/src/contract.js';
import { assessLiveQualificationCapability, makeLiveProviderCredentials, makeQualificationRequest } from './pel-provider-live.js';
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
 assert.match(assessLiveQualificationCapability('toolPolicyNone',[observed,completed]).reason,/native protocol/);
});
/** Every admitted API cell, with its exact protocol peer. No live account or network is used. */
const apiCells:[ProfileId,TransportId,string,(o:ApiTransportOptions)=>ProviderTransport][]=[
 ['grok-4.6','xai-responses','xai',createXaiResponsesTransport],
 ['claude-opus-5','anthropic-messages','anthropic',createAnthropicMessagesTransport],
 ['claude-fable-5-1','anthropic-messages','anthropic',createAnthropicMessagesTransport],
 ['gpt-6-astra','openai-responses','openai',createOpenaiResponsesTransport],
 ['gpt-5.6-sol','openai-responses','openai',createOpenaiResponsesTransport],
 ['gemini-3.8-flash','google-interactions','google',createGoogleInteractionsTransport],
];
const fixtureCredentials={resolve:(_ref:string)=>Effect.succeed({headers:{authorization:Redacted.make('fixture-secret')}})};
const peer=(events:readonly unknown[]):ApiHttpPort=>({request:()=>{
 const bytes=Buffer.from(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
 return Effect.succeed({status:200,headers:{'content-type':'text/event-stream'},body:Stream.fromIterable([...bytes].map(b=>Uint8Array.of(b)))});
}});
/** A complete bounded no-tool exchange that returns the exact admitted boolean result. */
function frames(model:string,transportId:TransportId,text='{"value":true}'):readonly unknown[] {
 if(transportId==='anthropic-messages')return [
  {type:'message_start',message:{id:'r1',model,usage:{input_tokens:4}}},
  {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
  {type:'content_block_delta',index:0,delta:{type:'text_delta',text}},
  {type:'content_block_stop',index:0},
  {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:2}},
  {type:'message_stop'},
 ];
 if(transportId==='google-interactions')return [
  {event_type:'interaction.created',interaction:{id:'r1',model}},
  {event_type:'step.start',index:0,step:{type:'model_output'}},
  {event_type:'step.delta',index:0,delta:{type:'text',text}},
  {event_type:'step.stop',index:0},
  {event_type:'interaction.completed',interaction:{id:'r1',model,status:'completed',usage:{total_input_tokens:4,total_output_tokens:2}}},
 ];
 return [
  {type:'response.created',sequence_number:0,response:{id:'r1',model}},
  {type:'response.output_text.delta',sequence_number:1,delta:text},
  {type:'response.completed',sequence_number:2,response:{id:'r1',model,status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:4,output_tokens:2}}},
 ];
}
const controlsFor=(cell:typeof apiCells[number]):ProviderControlsV1=>({...defaultProviderControls(cell[0],cell[2]),toolChoice:'none'});
const noToolCapabilities:readonly Capability[]=['generation','structuredOutput','toolPolicyNone'];
function qualify(cell:typeof apiCells[number],events:readonly unknown[],requiredCapabilities=noToolCapabilities) {
 const now=Date.now();
 const selection={profileId:cell[0],transportId:cell[1],credentialProfileRef:`env:FIXTURE_${cell[2].toUpperCase()}`,controls:controlsFor(cell),limits:{deadline:now+60000,maxInputTokens:12000,maxOutputTokens:1024,maxToolCalls:0,maxCostUsd:0.25,maxOutputBytes:262144,spendReservationRef:'qualification:fixture'},binding:{kind:'qualification-fixture' as const,evidenceRef:'fixture:api-no-tool',expiresAt:now+3600000,fixtureManifestHash:'manifest',endpointIdentity:'fake://api'},requiredCapabilities};
 const request=makeQualificationRequest(selection);
 const transport=cell[3]({credentials:fixtureCredentials,http:peer(events),schemaRegistry:{'schema:pel-boolean-v1':request.outputSchema.content}});
 return Effect.runPromise(runQualification({request:{...request,transportVersion:transport.version},requiredCapabilities,binding:selection.binding},{transport,now:Date.now,assess:(capability,observed,identity)=>Effect.succeed(assessLiveQualificationCapability(capability,observed,identity))}).pipe(Effect.either));
}
for(const cell of apiCells) {
 test(`API ${cell[0]} ${cell[1]} qualification proves no-tool execution only from a complete bound exchange`,async()=>{
  const result=await qualify(cell,frames(cell[0],cell[1]));
  assert.equal(result._tag,'Right');
  if(result._tag!=='Right')return;
  const report=result.right;
  assert.equal(report.outcome,'success');
  for(const capability of noToolCapabilities) {
   assert.equal(report.assertions.find(a=>a.capability===capability)?.passed,true,capability);
   assert.equal(report.evidence.some(e=>e.capability===capability),true,capability);
  }
  assert.match(report.assertions.find(a=>a.capability==='toolPolicyNone')!.reason,/exact API request offered no tool surface/);
  assert.ok(report.observedIdentity);
  assert.equal(report.observedIdentity?.profileId,cell[0]);
 });
}
for(const [name,mutate] of [
 ['a refusal',(cell:typeof apiCells[number])=>cell[1]==='anthropic-messages'
   ?[{type:'message_start',message:{id:'r1',model:cell[0]}},{type:'message_delta',delta:{stop_reason:'refusal'}},{type:'message_stop'}]
   :cell[1]==='google-interactions'
     ?[{event_type:'interaction.created',interaction:{id:'r1',model:cell[0]}},{event_type:'interaction.completed',interaction:{id:'r1',model:cell[0],status:'requires_action'}}]
     :[{type:'response.created',response:{id:'r1',model:cell[0]}},{type:'response.completed',response:{id:'r1',model:cell[0],status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}}]],
 ['an incomplete stream',(cell:typeof apiCells[number])=>frames(cell[0],cell[1]).slice(0,2)],
 ['an identity mismatch',(cell:typeof apiCells[number])=>frames('another-model',cell[1])],
 ['tool activity',(cell:typeof apiCells[number])=>cell[1]==='anthropic-messages'
   ?[{type:'message_start',message:{id:'r1',model:cell[0]}},{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'t1',name:'shell'}}]
   :cell[1]==='google-interactions'
     ?[{event_type:'interaction.created',interaction:{id:'r1',model:cell[0]}},{event_type:'step.start',index:0,step:{type:'function_call'}}]
     :[{type:'response.created',response:{id:'r1',model:cell[0]}},{type:'response.output_item.added',item:{type:'function_call',call_id:'c1',name:'shell'}}]],
] as const) {
 for(const cell of apiCells) {
  test(`API ${cell[0]} ${cell[1]} grants no no-tool evidence after ${name}`,async()=>{
   const result=await qualify(cell,mutate(cell));
   if(result._tag==='Left')return;
   const report=result.right;
   assert.notEqual(report.outcome,'success');
   assert.equal(report.evidence.some(e=>e.capability==='toolPolicyNone'),false);
   assert.equal(report.assertions.find(a=>a.capability==='toolPolicyNone')?.passed,false);
  });
 }
}
test('API no-tool evidence never comes from the request flag alone',async()=>{
 const cell=apiCells[3]!;
 const result=await qualify(cell,frames(cell[0],cell[1]).slice(0,1));
 if(result._tag==='Right') {
  assert.equal(result.right.evidence.some(e=>e.capability==='toolPolicyNone'),false);
  return;
 }
 assert.ok(result.left._tag);
});
