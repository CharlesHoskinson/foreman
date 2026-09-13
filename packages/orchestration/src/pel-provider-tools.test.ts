import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { canonicalToolArgumentsDigest, providerFailureToHostFailure, cancellationExternalOutcome } from './pel-provider-tools.js';
test('T-M4-018 tool arguments canonicalize object keys and retain argument changes', () => {
 assert.equal(canonicalToolArgumentsDigest({a:1,b:2}), canonicalToolArgumentsDigest({b:2,a:1}));
 assert.notEqual(canonicalToolArgumentsDigest({a:1}), canonicalToolArgumentsDigest({a:2}));
});
test('T-M4-010 unsupported cancellation and missing cleanup are never confirmed cancellation', () => {
 const base={requested:true,acknowledged:true,localCleanup:'complete' as const};
 assert.equal(cancellationExternalOutcome({...base,remoteOutcome:'unsupported'}),'unknown');
 assert.equal(cancellationExternalOutcome({...base,remoteOutcome:'cancelled'}),'confirmed-cancelled');
 assert.equal(cancellationExternalOutcome({...base,localCleanup:'pending',remoteOutcome:'cancelled'}),'unknown');
 const failure={_tag:'RateLimited' as const,retryClass:'transient' as const,message:'bounded',retryAfterMs:1};
 assert.deepEqual(providerFailureToHostFailure(failure).cause,{providerFailure:failure});
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { RunJournal, makeLiveRunJournalLayer, type RunId } from '@foreman/event-log';
import type { ProviderIdentityV1, ProviderRequestV1, ProviderTransport, ToolRequestV1 } from '@foreman/providers';
import { PelRuntime, type HostContextV1, type PelRuntimePorts, type ExecutionBindingV1 } from './pel-run-contract.js';
import { makeLivePelArtifactPort, appendPelRecord, pelHash, replayPelRun, readPelRecords,stablePelEffectIdentity,stablePelReservationId,projectPelRemainingProviderBudget } from './pel-journal.js';
import { executeDurableProviderTool, makeDurablePelPermissionPort,preparePelProviderRequest,pelProviderUsageReservation } from './pel-provider-tools.js';
import {EndstopLedger,makeLiveEndstopLedgerLayer} from './execution-ledger.js';
import {strictEndstopLimits,executionContractSha256,type ExecutionContractV1} from './execution-contract.js';

function reserveFixtureProvider(binding:ExecutionBindingV1,context:HostContextV1,ref:import('./pel-run-contract.js').PelArtifactRefV1,request:ProviderRequestV1){return Effect.gen(function*(){
 const digest='a'.repeat(64),reservationId=stablePelReservationId(context.effect.effectId,'implement',digest),prepared={...request,limits:{...request.limits,maxInputTokens:1000,maxOutputTokens:1000,maxCostUsd:1,spendReservationRef:reservationId}};
 const reservation={schemaVersion:1 as const,effect:context.effect,preparationDigest:digest,operationDigest:digest,authoritySha256:binding.authoritySha256,reservationId,candidate:null,kind:'v1' as const,contractId:'fixture-contract',contractSha256:digest,action:'implement' as const};
 yield* appendPelRecord(binding,'pel.effect.intent.v1',{effect:context.effect,argumentsRef:ref,expectedResultSchemaId:request.outputSchema?.id??'schema:pel-data-v1',preparationDigest:digest,reservation,usageReservation:pelProviderUsageReservation(prepared)});
 return prepared;
});}

test('T-M4-018 durable result survives failed send, resends without tool execution, and rejects changed arguments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pel-tools-'));
 try {
  await Effect.runPromise(Effect.gen(function*(){
   const journal=yield* RunJournal,runId='run-tools' as RunId,attempt=yield* journal.allocate(runId,'pel' as import('@foreman/event-log').LaneId);
   const digest='a'.repeat(64),binding={runId,attempt,checkedProgramDigest:digest,revisionDigest:digest,authoritySha256:digest,runtimeVersion:'m4',languageProfileId:'pel',languageProfileDigest:digest} as ExecutionBindingV1;
   const context={binding,effect:{effectId:'effect-tools',requestId:'request-tools'}} as HostContextV1;
   const artifacts=makeLivePelArtifactPort(root),ref=yield* artifacts.put(runId,Buffer.from('{}'),100,'ordinary');
   yield* appendPelRecord(binding,'pel.run.v1',{bindingRef:ref});yield* appendPelRecord(binding,'pel.suspension.v1',{suspensionRef:ref});
   const identity:ProviderIdentityV1={kind:'api',provider:'openai',profileId:'gpt-6-astra',transportId:'openai-responses',credentialProfileRef:'fixture',endpointRevision:'v1',responseId:'response'};
   const tool:ToolRequestV1={callId:'call-1',name:'read',arguments:{path:'src/file'},authorizationBinding:'grant-read'};
   let request={effectId:context.effect.effectId,toolPolicy:{mode:'native-coding',workspaceGrantId:'workspace',permissionGrantIds:['grant-read'],hostPermissionPortRef:'host'},limits:{maxOutputBytes:1000}} as unknown as ProviderRequestV1;
   let executions=0,sends=0;
   const transport={sendToolResult:(_identity:ProviderIdentityV1,result:import('@foreman/providers').ToolResultV1)=>Effect.gen(function*(){
    sends++;assert.equal(result.content.kind,'text');
    if(sends===1) return yield* Effect.fail({_tag:'TransportDisconnected',retryClass:'transient',message:'crash after durable result'} as const);
   })} as unknown as ProviderTransport;
   const runtime={artifacts} as PelRuntimePorts;
   const permissions=makeDurablePelPermissionPort({context,journal,runtime,authorize:()=>Effect.succeed('grant-read')});
   const complete={...runtime,providers:{permissions}} as PelRuntimePorts;
   const executor={execute:()=>Effect.sync(()=>{executions++;return {content:{kind:'text' as const,text:'durable tool bytes'},isError:false};})};
   const first=yield* executeDurableProviderTool({providerIdentity:identity,request:tool},request,context,transport,executor).pipe(Effect.provideService(PelRuntime,complete),Effect.either);
   assert.equal(first._tag,'Left');assert.equal(executions,1);
   const second=yield* executeDurableProviderTool({providerIdentity:identity,request:tool},request,context,transport,executor).pipe(Effect.provideService(PelRuntime,complete));
   assert.deepEqual(second.content,{kind:'text',text:'durable tool bytes'});assert.equal(executions,1);assert.equal(sends,2);
   const changed=yield* executeDurableProviderTool({providerIdentity:identity,request:{...tool,arguments:{path:'other'}}},request,context,transport,executor).pipe(Effect.provideService(PelRuntime,complete),Effect.either);
   assert.equal(changed._tag,'Left');if(changed._tag==='Left')assert.equal(changed.left._tag,'PelRunFailure');assert.equal(executions,1);
   const replay=replayPelRun(yield* readPelRecords(runId));assert.equal(replay.ok,true);if(replay.ok)assert.equal(replay.value.tools.size,1);
  }).pipe(Effect.provide(makeLiveRunJournalLayer(root))));
 } finally {await rm(root,{recursive:true,force:true});}
});

import { Stream, Deferred, Fiber } from 'effect';
import { executePelProviderRequest, projectPelProviderUsage } from './pel-provider-tools.js';
import type { ProviderEventV1 } from '@foreman/providers';

test('T-M4-018 provider checkpoint bytes flush before cursor and restart uses resume without another start',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pel-cursor-'));
 try {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
   const journal=yield* RunJournal,runId='run-cursor' as RunId,attempt=yield* journal.allocate(runId,'pel' as import('@foreman/event-log').LaneId);
   const digest='a'.repeat(64),binding={runId,attempt,checkedProgramDigest:digest,revisionDigest:digest,authoritySha256:digest,runtimeVersion:'m4',languageProfileId:'pel',languageProfileDigest:digest,limits:{maxInputTokens:1000,maxOutputTokens:1000,maxCostUsd:1,deadline:Date.now()+10000,cancellationObservationMs:20}} as ExecutionBindingV1;
   const context={binding,effect:stablePelEffectIdentity(binding,'request-cursor')} as HostContextV1;
   const artifacts=makeLivePelArtifactPort(root),ref=yield* artifacts.put(runId,Buffer.from('{}'),100,'ordinary');
   yield* appendPelRecord(binding,'pel.run.v1',{bindingRef:ref});yield* appendPelRecord(binding,'pel.suspension.v1',{suspensionRef:ref});
   const identity:ProviderIdentityV1={kind:'api',provider:'openai',profileId:'gpt-6-astra',transportId:'openai-responses',credentialProfileRef:'fixture',endpointRevision:'v1',responseId:'response'};
   const bytes=Buffer.from('opaque checkpoint');
   const checkpoint={schemaVersion:1 as const,providerIdentity:identity,transportVersion:'v1',formatVersion:'v1',bytes,sha256:createHash('sha256').update(bytes).digest('hex'),prefixHash:digest,retention:{createdAt:Date.now(),policy:'fixture'},cursor:'cursor-1'};
   const event=(payload:ProviderEventV1['payload'],cursor:string):ProviderEventV1=>({schemaVersion:1,effectId:context.effect.effectId,providerIdentity:identity,cursor,payload});
   let starts=0,resumes=0;
   let request={schemaVersion:1,effectId:context.effect.effectId,toolPolicy:{mode:'none'},outputSchema:{id:'schema:pel-boolean-v1',content:{type:'boolean'}},limits:{deadline:Date.now()+10000,maxOutputBytes:1000,maxToolCalls:0}} as unknown as ProviderRequestV1;
   const transport={start:()=>Effect.sync(()=>{starts++;return Stream.fromIterable([event({type:'started'},'cursor-0'),event({type:'usage',usage:{inputTokens:5,outputTokens:1,costUsd:'0.1',providerCounters:{}}},'usage-0'),event({type:'checkpoint',checkpoint},'cursor-1')]);}),resume:(restored:ProviderRequestV1,id:ProviderIdentityV1,cursor:string)=>Effect.sync(()=>{resumes++;assert.equal(cursor,'cursor-1');assert.equal(pelHash(id),pelHash(identity));assert.deepEqual(restored.continuation?.bytes,bytes);return Stream.make(event({type:'completed',usage:{inputTokens:10,outputTokens:2,costUsd:'0.3',providerCounters:{}},result:{value:{tag:'boolean',value:true},json:true,schemaId:'schema:pel-boolean-v1',schemaSha256:pelHash({type:'boolean'}),byteLength:4}},'cursor-2'));})} as unknown as ProviderTransport;
   request=yield* reserveFixtureProvider(binding,context,ref,request);
   const runtime={artifacts,clock:{now:Effect.sync(Date.now),sleep:(ms:number)=>Effect.sleep(ms)},providers:{resolve:()=>Effect.succeed({transport,admitted:{}})}} as unknown as PelRuntimePorts;
   const unavailable={...runtime,providers:{...runtime.providers,resolve:()=>Effect.fail({_tag:'AuthenticationRequired' as const,retryClass:'never' as const,message:'Account needs authentication.'})}};
   const needsAccount=yield* executePelProviderRequest(request,context).pipe(Effect.provideService(PelRuntime,unavailable));assert.equal(needsAccount.kind,'waiting');assert.equal(starts,0);
   const authReplay=replayPelRun(yield* readPelRecords(runId));assert.equal(authReplay.ok,true);if(authReplay.ok){const obs=authReplay.value.observations.get(context.effect.effectId)!;assert.equal(obs.externalOutcome,'none');const data=JSON.parse(Buffer.from(yield* artifacts.get(runId,obs.observationRef,10000)).toString('utf8'));assert.equal(data.confirmedNoDispatch,true);assert.equal(data.stage,'provider-resolution');assert.equal(data.providerFailure._tag,'AuthenticationRequired');}
   const first=yield* executePelProviderRequest(request,context).pipe(Effect.provideService(PelRuntime,runtime));assert.equal(first.kind,'waiting');
   const replay=replayPelRun(yield* readPelRecords(runId));assert.equal(replay.ok,true);if(replay.ok){const saved=replay.value.cursors.get(context.effect.effectId);assert.equal(saved?.cursor,'cursor-1');assert.equal(saved?.checkpoint?.artifact.sha256,checkpoint.sha256);}
   const resumedNeedsAccount=yield* executePelProviderRequest(request,context).pipe(Effect.provideService(PelRuntime,unavailable));assert.equal(resumedNeedsAccount.kind,'waiting');
   const resumedReplay=replayPelRun(yield* readPelRecords(runId));assert.equal(resumedReplay.ok,true);if(resumedReplay.ok){const obs=resumedReplay.value.observations.get(context.effect.effectId)!;assert.equal(obs.externalOutcome,'unknown');assert.equal(pelHash(obs.providerIdentity),pelHash(identity));const data=JSON.parse(Buffer.from(yield* artifacts.get(runId,obs.observationRef,10000)).toString('utf8'));assert.equal(data.confirmedNoDispatch,false);}
   const second=yield* executePelProviderRequest(request,context).pipe(Effect.provideService(PelRuntime,runtime));assert.equal(second.kind,'settled');assert.equal(starts,1);assert.equal(resumes,1);
   const usage=yield* projectPelProviderUsage(binding).pipe(Effect.provideService(PelRuntime,runtime));assert.equal(usage.inputTokens,10);assert.equal(usage.outputTokens,2);assert.equal(usage.costUsd,'0.3');
  })).pipe(Effect.provide(makeLiveRunJournalLayer(root))));
 } finally {await rm(root,{recursive:true,force:true});}
});

test('T-M4-010 provider interruption persists truthful cancellation within a finite observation window',async()=>{
 for(const remoteOutcome of ['unsupported','cancelled','pending'] as const) {
  const root=await mkdtemp(join(tmpdir(),'pel-cancel-'));
  try {
   await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
    const journal=yield* RunJournal,runId='run-cancel' as RunId,attempt=yield* journal.allocate(runId,'pel' as import('@foreman/event-log').LaneId),digest='a'.repeat(64);
    const binding={runId,attempt,checkedProgramDigest:digest,revisionDigest:digest,authoritySha256:digest,runtimeVersion:'m4',languageProfileId:'pel',languageProfileDigest:digest,limits:{maxInputTokens:1000,maxOutputTokens:1000,maxCostUsd:1,deadline:remoteOutcome==='pending'?Date.now()-1:Date.now()+10000,cancellationObservationMs:30}} as ExecutionBindingV1;
    const context={binding,effect:stablePelEffectIdentity(binding,'request-cancel')} as HostContextV1;
    const artifacts=makeLivePelArtifactPort(root),ref=yield* artifacts.put(runId,Buffer.from('{}'),100,'ordinary');yield* appendPelRecord(binding,'pel.run.v1',{bindingRef:ref});yield* appendPelRecord(binding,'pel.suspension.v1',{suspensionRef:ref});
    const identity:ProviderIdentityV1={kind:'api',provider:'openai',profileId:'gpt-6-astra',transportId:'openai-responses',credentialProfileRef:'fixture',endpointRevision:'v1',responseId:'response'};
    const entered=yield* Deferred.make<void>();let cancels=0;
    const transport={start:()=>Effect.succeed(Stream.concat(Stream.concat(Stream.make({schemaVersion:1 as const,effectId:context.effect.effectId,providerIdentity:identity,payload:{type:'started' as const}}),Stream.fromEffect(Deferred.succeed(entered,undefined)).pipe(Stream.drain)),Stream.never)),cancel:()=>Effect.sync(()=>{cancels++;return {requested:true,acknowledged:true,localCleanup:'complete' as const,remoteOutcome};}),observe:()=>Effect.succeed(remoteOutcome==='pending'?{status:'cancelled' as const,providerIdentity:identity}:{status:'unsupported' as const,providerIdentity:identity,reason:'fixture'})} as unknown as ProviderTransport;
    let request={effectId:context.effect.effectId,toolPolicy:{mode:'none'},limits:{deadline:Date.now()+10000,maxOutputBytes:1000,maxToolCalls:0}} as unknown as ProviderRequestV1;
    request=yield* reserveFixtureProvider(binding,context,ref,request);
   const runtime={artifacts,clock:{now:Effect.sync(Date.now),sleep:(ms:number)=>Effect.sleep(ms)},providers:{resolve:()=>Effect.succeed({transport,admitted:{}})}} as unknown as PelRuntimePorts;
    const fiber=yield* Effect.fork(executePelProviderRequest(request,context).pipe(Effect.provideService(PelRuntime,runtime)));
    yield* Deferred.await(entered);yield* Fiber.interrupt(fiber);
    assert.equal(cancels,1);const replay=replayPelRun(yield* readPelRecords(runId));assert.equal(replay.ok,true);if(replay.ok)assert.equal(replay.value.observations.get(context.effect.effectId)?.externalOutcome,remoteOutcome==='unsupported'?'unknown':'confirmed-cancelled');
   })).pipe(Effect.provide(makeLiveRunJournalLayer(root))));
  } finally {await rm(root,{recursive:true,force:true});}
 }
});

import { aggregatePelProviderUsage } from './pel-provider-tools.js';
test('durable usage aggregates each effect once with exact USD decimals and preserves unknown dimensions',()=>{
 const result=aggregatePelProviderUsage([{effectId:'one',usage:{inputTokens:100,outputTokens:4,costUsd:'0.10',providerCounters:{requests:1}}},{effectId:'one',usage:{inputTokens:110,outputTokens:5,costUsd:'0.20',providerCounters:{requests:1}}},{effectId:'two',usage:{inputTokens:20,costUsd:'0.10',providerCounters:{requests:1}}}]);
 assert.equal(result.ok,true);if(result.ok){assert.equal(result.value.inputTokens,130);assert.equal(result.value.costUsd,'0.3');assert.equal(Object.hasOwn(result.value,'outputTokens'),false);assert.deepEqual(result.value.providerCounters,{'one:requests':1,'two:requests':1});}
 const unknown=aggregatePelProviderUsage([{effectId:'one',usage:{inputTokens:10,costUsd:'1',providerCounters:{}}},{effectId:'two'}]);assert.equal(unknown.ok,true);if(unknown.ok){assert.equal(Object.hasOwn(unknown.value,'inputTokens'),false);assert.equal(Object.hasOwn(unknown.value,'costUsd'),false);}
});
test('T-M4-009 retained preparation survives reservation-before-intent crash and later requests use remaining budgets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pel-budget-preparation-'));
 try{await Effect.runPromise(Effect.gen(function*(){
  const journal=yield* RunJournal,ledger=yield* EndstopLedger,runId='budget-preparation' as RunId,attempt=yield* journal.allocate(runId,'pel' as import('@foreman/event-log').LaneId),digest='a'.repeat(64),artifacts=makeLivePelArtifactPort(root);
  const binding={runId,attempt,checkedProgramDigest:digest,revisionDigest:digest,authoritySha256:digest,runtimeVersion:'m4',languageProfileId:'pel',languageProfileDigest:digest,limits:{maxInputTokens:1000,maxOutputTokens:1000,maxCostUsd:1,deadline:Date.now()+10000}} as ExecutionBindingV1;
  const context={binding,effect:stablePelEffectIdentity(binding,'first')} as HostContextV1,ref=yield* artifacts.put(runId,Buffer.from('{}'),100,'ordinary');yield* appendPelRecord(binding,'pel.run.v1',{bindingRef:ref});yield* appendPelRecord(binding,'pel.suspension.v1',{suspensionRef:ref});
  const runtime={artifacts} as PelRuntimePorts,request={schemaVersion:1,effectId:context.effect.effectId,trustedInstructions:'Fixed prepared request',limits:{maxInputTokens:1000,maxOutputTokens:1000,maxCostUsd:1,deadline:binding.limits.deadline,maxOutputBytes:1000,maxToolCalls:0,spendReservationRef:'pending-reservation'}} as ProviderRequestV1;
  const first=yield* preparePelProviderRequest(request,context).pipe(Effect.provideService(PelRuntime,runtime));
  const contract:ExecutionContractV1={schemaVersion:1,contractId:'budget-action',packageId:'budget',objectiveSha256:digest,acceptanceSha256:digest,baseCommit:'a'.repeat(40),allowedPathsSha256:digest,authorizationSha256:digest,dependencyContractIds:[],createdAt:'2026-09-13T00:00:00Z',deadlineAt:'2026-09-13T02:00:00Z',limits:strictEndstopLimits,requiredMilestones:['checks']};yield* ledger.create(contract);
  const reserve=(prepared:typeof first)=>ledger.execute(contract.contractId,executionContractSha256(contract),{_tag:'ReserveAction',action:'implement',candidateSha256:digest,commandSha256:pelHash(prepared.request),reservationId:stablePelReservationId(context.effect.effectId,'implement',pelHash(prepared)),at:'2026-09-13T00:01:00Z'});
  yield* reserve(first);
  const sibling={...context,effect:stablePelEffectIdentity(binding,'sibling')};yield* reserveFixtureProvider(binding,sibling,ref,{...request,effectId:sibling.effect.effectId});
  const usage={inputTokens:10,outputTokens:20,costUsd:'0.1'},observationRef=yield* artifacts.put(runId,Buffer.from(JSON.stringify({usage})),1000,'ordinary');yield* appendPelRecord(binding,'pel.effect.observed.v1',{effectId:sibling.effect.effectId,observationRef,providerIdentity:null,externalOutcome:'confirmed-complete',usage});
  assert.deepEqual(yield* projectPelRemainingProviderBudget(binding),{maxInputTokens:990,maxOutputTokens:980,maxCostUsd:0.9});
  const restored=yield* preparePelProviderRequest(request,context).pipe(Effect.provideService(PelRuntime,runtime));assert.deepEqual(restored,first);assert.equal((yield* reserve(restored)).state.counts.totalActions,1);
  const next={...context,effect:stablePelEffectIdentity(binding,'next')},prepared=yield* preparePelProviderRequest({...request,effectId:next.effect.effectId},next).pipe(Effect.provideService(PelRuntime,runtime));assert.deepEqual(pelProviderUsageReservation(prepared.request),{maxInputTokens:990,maxOutputTokens:980,maxCostUsd:0.9});
  assert.equal((yield* Effect.either(preparePelProviderRequest({...request,trustedInstructions:'Changed input'},context).pipe(Effect.provideService(PelRuntime,runtime))))._tag,'Left');
 }).pipe(Effect.provide(makeLiveRunJournalLayer(root)),Effect.provide(makeLiveEndstopLedgerLayer(root))));}finally{await rm(root,{recursive:true,force:true});}
});
