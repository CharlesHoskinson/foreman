import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPel, createPelEnvironment, startPel } from '@foreman/pel';
import { createDefaultAuthoringSnapshotV1 } from './pel-host-descriptors.js';
import { validateResolvedHostRequest, validateReservationToken } from './pel-effects.js';
import type { HostContextV1, PreparedHostEffectV1, PelReservationTokenV1 } from './pel-run-contract.js';
function fixture() {
 const snapshot = createDefaultAuthoringSnapshotV1();
 const check = checkPel({ source: Buffer.from('(print :vals [1 2])'), snapshot });
 assert.equal(check.tag, 'ok'); if(check.tag !== 'ok') throw Error('check');
 const step = startPel(check.checked.program, createPelEnvironment(snapshot.registry), snapshot.limits, snapshot.options);
 assert.equal(step.tag,'suspend'); if(step.tag !== 'suspend') throw Error('step');
 const request = step.ready[0]!;
 const context = { checked:check.checked, binding:{ checkedProgramDigest:check.checked.bindingDigest, sourceDigest:check.checked.sourceDigest, registryDigest:snapshot.registryDigest, authoritySha256:'a'.repeat(64), authority:{kind:'v1'}, limits:{} }, effect:{requestId:request.requestId,effectId:'effect'}, workspace:{canonicalRoot:'/workspace'}, project:{} } as unknown as HostContextV1;
 return {request,context};
}
test('T-M4-002 runtime request rejects changes to source, descriptor, known arguments and resource envelope', () => {
 const {request,context} = fixture();
 assert.equal(validateResolvedHostRequest(request,context).ok,true);
 for(const altered of [{...request,sourceDigest:'b'.repeat(64)}, {...request,registryId:'fm/publish'}, {...request,boundArguments:{...request.boundArguments,vals:{tag:'string' as const,value:'different'}}}]) assert.equal(validateResolvedHostRequest(altered,context).ok,false);
 assert.equal(validateResolvedHostRequest(request,context,{reads:[],writes:['/outside']}).ok,false);
});
test('T-M4-019 a token must bind operation, effect, authority, candidate and preparation', () => {
 const {context} = fixture();
 const prepared: Extract<PreparedHostEffectV1,{kind:'dispatch'}> = {kind:'dispatch',operationDigest:'b'.repeat(64),resources:{reads:[],writes:[]},action:'implement',inputs:{artifactId:'input',byteLength:0,sha256:'c'.repeat(64)},candidate:null};
 const token = {kind:'v1',schemaVersion:1,effect:context.effect,preparationDigest:'bad',operationDigest:prepared.operationDigest,authoritySha256:context.binding.authoritySha256,reservationId:'bad',candidate:null,action:'implement'} as PelReservationTokenV1;
 assert.equal(validateReservationToken(prepared,token,context).ok,false);
});

import { mkdtemp, mkdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { RunJournal, makeLiveRunJournalLayer, type RunId } from '@foreman/event-log';
import { EndstopLedger, makeLiveEndstopLedgerLayer } from './execution-ledger.js';
import { executionContractSha256, strictEndstopLimits, type ExecutionContractV1 } from './execution-contract.js';
import { PelRuntime, type PelRuntimePorts, type PelPreparedHandlerV1, type ExecutionBindingV1 } from './pel-run-contract.js';
import { makePelResourceScope } from './pel-resource-scope.js';
import { appendPelRecord, makeLivePelArtifactPort, stablePelEffectIdentity, pelHash, replayPelRun, readPelRecords } from './pel-journal.js';
import { executeHostEffect } from './pel-effects.js';

async function integration(source:string, variant:'dispatch'|'retry'|'predicate'|'read-result'|'needs-action'|'print'|'resource-denied'|'concurrency-denied',registered=true) {
 const root=await mkdtemp(join(tmpdir(),'pel-dispatch-'));
 try {
  const workspace=join(root,'workspace');await mkdir(workspace);const info=await stat(workspace);
  const snapshot=createDefaultAuthoringSnapshotV1(), check=checkPel({source:Buffer.from(source),snapshot});assert.equal(check.tag,'ok',JSON.stringify(check));if(check.tag!=='ok')throw Error('check');
  const step=startPel(check.checked.program,createPelEnvironment(snapshot.registry),snapshot.limits,snapshot.options);assert.equal(step.tag,'suspend');if(step.tag!=='suspend')throw Error('step');const request=step.ready[0]!;
  const contract:ExecutionContractV1={schemaVersion:1,contractId:'pel-dispatch-contract',packageId:'pel',objectiveSha256:'a'.repeat(64),acceptanceSha256:'b'.repeat(64),baseCommit:'1'.repeat(40),allowedPathsSha256:'c'.repeat(64),dependencyContractIds:[],authorizationSha256:'a'.repeat(64),createdAt:'2026-09-13T00:00:00Z',deadlineAt:'2026-09-13T02:00:00Z',limits:strictEndstopLimits,requiredMilestones:['checks']};
  let dispatches=0,prints=0;const childActions:string[]=[];
  const result=await Effect.runPromise(Effect.gen(function*(){
   const journal=yield* RunJournal,ledger=yield* EndstopLedger;yield* ledger.create(contract);
   const runId='run-pel-effects' as RunId,attempt=yield* journal.allocate(runId,'pel' as import('@foreman/event-log').LaneId);
   const artifacts=makeLivePelArtifactPort(root),resources=yield* makePelResourceScope({readResearchIndex:(context,ref,max)=>artifacts.get(context.binding.runId,ref,max).pipe(Effect.mapError(()=>({code:'artifact-missing' as const,message:'Missing fixture research index.'})))});
   const ref=yield* artifacts.put(runId,Buffer.from('{}'),100,'ordinary');
   const researchRef=yield* artifacts.put(runId,Buffer.from(JSON.stringify({schemaVersion:1,bundleId:'bundle:release-sources',capturedAt:'2026-09-13T00:00:00Z',sources:[],graph:null})),1024,'ordinary');
   const binding={schemaVersion:1,evidenceKind:'test-fixture',runId,attempt,contractId:contract.contractId,contractSha256:executionContractSha256(contract),authority:{kind:'v1',authoritySha256:contract.authorizationSha256,authorityRef:ref},authoritySha256:contract.authorizationSha256,checkedProgramDigest:check.checked.bindingDigest,revisionDigest:check.checked.sourceDigest,sourceDigest:check.checked.sourceDigest,registryDigest:snapshot.registryDigest,optionsDigest:snapshot.optionsDigest,runtimeVersion:'pel-m4',languageProfileId:snapshot.languageProfile.id,languageProfileDigest:snapshot.languageProfileDigest,limits:{deadline:Date.parse(contract.deadlineAt),maxConcurrentEffects:1,maxOutputBytes:100000}} as unknown as ExecutionBindingV1;
   const admittedBinding=variant==='predicate'?{...binding,authority:{kind:'v2-child' as const,authoritySha256:binding.authoritySha256,authorityRef:ref,rootContractId:binding.contractId,rootContractSha256:binding.contractSha256,familySha256:'d'.repeat(64),childId:'evaluation-child',originReservationId:'origin',taskPlanSha256:'e'.repeat(64),authorityBundleSha256:'f'.repeat(64)}}:binding;
   const context={binding:admittedBinding,checked:check.checked,effect:stablePelEffectIdentity(admittedBinding,request.requestId,variant==='retry'?1:0,variant==='retry'?'prior-effect':undefined),...(variant==='retry'?{retryContext:{parentRequestId:'parent',attemptIndex:2,logicalOperationKey:'nested-task'}}:{}),workspace:{grantId:'grant',canonicalRoot:workspace,directoryIdentity:`${info.dev}:${info.ino}`,writablePaths:['.']},project:{taskActions:{task:'implement'},destinations:{'destination:pull-request':{operation:'publish'}}}} as unknown as HostContextV1;
   Object.assign(context.project,{researchBundles:{'bundle:release-sources':researchRef}});
   const taskValue:import('@foreman/pel').PelDataValue={tag:'list',items:[{tag:'pair',key:'status',value:{tag:'string',value:'no-change'}},{tag:'pair',key:'candidate',value:{tag:'nil'}},{tag:'pair',key:'artifacts',value:{tag:'list',items:[]}},{tag:'pair',key:'implementation-receipt',value:{tag:'nil'}},{tag:'pair',key:'findings',value:{tag:'list',items:[]}}]};
   const researchValue={tag:'list' as const,items:[{tag:'pair' as const,key:'status',value:{tag:'string' as const,value:'complete'}},{tag:'pair' as const,key:'results',value:{tag:'list' as const,items:[]}}]};
   const handler:PelPreparedHandlerV1={prepare:()=>Effect.gen(function*(){
    if(variant==='read-result')return {kind:'read-result' as const,value:researchValue,sources:[researchRef],preparationDigest:pelHash({researchRef,value:researchValue})};
    if(variant==='needs-action')return {kind:'needs-action' as const,reason:'reconciliation-required' as const,diagnostic:{code:'grant',message:'Host grant required.',sourceSpan:null,effectId:context.effect.effectId,retryable:false,nextAction:'Supply grant.',evidenceRefs:[]},observationRef:ref};
    const descriptor=snapshot.registry.descriptors.find(d=>d.id===request.registryId)!;
    return {kind:'dispatch' as const,operationDigest:pelHash({requestId:request.requestId}),resources:yield* resources.resolve(descriptor,request,context),action:variant==='predicate'?'evaluate' as const:request.registryId==='fm/publish'?'publish' as const:'implement' as const,inputs:ref,candidate:variant==='predicate'?{commit:'1'.repeat(40),tree:'2'.repeat(40),candidateSha256:'3'.repeat(64)}:null,...(variant==='predicate'?{actionAuthority:{taskPlanSha256:'e'.repeat(64),authorityBundleSha256:'9'.repeat(64)}}:{})};
   }),dispatch:(prepared,token,ctx)=>Effect.sync(()=>{assert.equal(validateReservationToken(prepared,token,ctx).ok,true);dispatches++;if(request.registryId==='fm/publish'){assert.equal(token.kind==='v1'?token.action:token.operation.effectiveAction,'publish');return {kind:'settled' as const,outcome:{tag:'failure' as const,failure:{code:'provider-failure',message:'Deterministic publication fixture completed its dispatch boundary.'}}};}return {kind:'settled' as const,outcome:{tag:'success' as const,value:variant==='predicate'?{tag:'boolean' as const,value:true}:request.registryId==='fm/task'?taskValue:researchValue}};})};
   const runtime={artifacts,resources:variant==='resource-denied'?{...resources,resolve:()=>Effect.fail({code:'resource-denied',message:'The workspace identity changed after admission.'})}:variant==='concurrency-denied'?{...resources,acquireConcurrency:()=>Effect.fail({code:'resource-denied',message:'The concurrency grant is unavailable.'})}:resources,handlers:new Map([[request.registryId,handler]]),controls:new Map(),clock:{now:Effect.succeed(Date.parse('2026-09-13T00:01:00Z')),sleep:()=>Effect.void},output:()=>Effect.sync(()=>{prints++;}),providers:{} } as unknown as PelRuntimePorts;
   yield* appendPelRecord(binding,'pel.run.v1',{bindingRef:ref});yield* appendPelRecord(binding,'pel.suspension.v1',{suspensionRef:ref});
   const effectiveLedger=variant==='predicate'?{...ledger,familyStatus:()=>Effect.succeed({childAuthorities:registered?[{rootContractId:binding.contractId,rootContractSha256:binding.contractSha256,familySha256:'d'.repeat(64),childId:'evaluation-child',action:'evaluate',effectiveAction:'evaluate',taskPlanSha256:'e'.repeat(64),bundleSha256:'9'.repeat(64),candidate:{commit:'1'.repeat(40),tree:'2'.repeat(40),candidateSha256:'3'.repeat(64)},priorReservationId:null,originReservationId:null}]:[]} as unknown as import('./execution-ledger.js').ExecutionFamilyLedgerStatusV2),executeChild:(input:Parameters<typeof ledger.executeChild>[0])=>Effect.sync(()=>{if(input.operation._tag==='ReserveAction'){assert.equal(input.operation.originReservationId,input.operation.reservationId);assert.equal(input.operation.authorityBundleSha256,'9'.repeat(64));}childActions.push(input.operation._tag==='ReserveAction'?input.operation.reservationAction:'other');return {decision:{_tag:'Accepted' as const,events:[]},state:{} as import('./execution-terminal-policy.js').ExecutionFamilyStateV2};})}:ledger;
   const first=yield* executeHostEffect(request,context).pipe(Effect.provideService(PelRuntime,runtime),Effect.provideService(EndstopLedger,effectiveLedger));
   if(first.kind==='settled') {const second=yield* executeHostEffect(request,context).pipe(Effect.provideService(PelRuntime,runtime),Effect.provideService(EndstopLedger,effectiveLedger));assert.deepEqual(second,first);}
   const state=yield* ledger.status(contract.contractId),replay=replayPelRun(yield* readPelRecords(runId));assert.equal(replay.ok,true);
   return {first,count:state.counts.totalActions,counts:state.counts,childActions,dispatches,prints,intents:replay.ok?replay.value.intents.size:-1};
  }).pipe(Effect.provide(makeLiveRunJournalLayer(root)),Effect.provide(makeLiveEndstopLedgerLayer(root))));
  return result;
 } finally {await rm(root,{recursive:true,force:true});}
}
test('T-M4-019 read-result and needs-action consume no existing ledger reservations', async()=>{
 const source='(fm/research :id "read" :query "bounded" :bundle "bundle:release-sources")';
 const read=await integration(source,'read-result');assert.equal(read.count,0);assert.equal(read.dispatches,0);assert.equal(read.intents,0);assert.equal(read.first.kind,'settled');if(read.first.kind==='settled')assert.equal(read.first.receipt.outcome.tag,'success');
 const pending=await integration(source,'needs-action');assert.equal(pending.count,0);assert.equal(pending.first.kind,'waiting');
});
test('T-M4-019 dispatch reserves exactly once in the existing ledger and durable receipt replay dispatches zero',async()=>{
 const result=await integration('(fm/task :id "task" :model "role:implementer" :input "artifact:approved-spec" :output "schema:task-result-v1")','dispatch');assert.equal(result.count,1);assert.equal(result.dispatches,1);assert.equal(result.intents,1);
});
test('T-M4-020 native print records one output, returns vals, and replays without output or reservation',async()=>{
 const result=await integration('(print :vals [1 2])','print');assert.equal(result.count,0);assert.equal(result.prints,1);assert.equal(result.first.kind,'settled');if(result.first.kind==='settled')assert.deepEqual(result.first.receipt.outcome,{tag:'success',value:{tag:'list',items:[{tag:'number',value:1},{tag:'number',value:2}]}});
});

test('T-M4-019 a read-only research descriptor cannot be turned into an implementation reservation',async()=>{
 await assert.rejects(integration('(fm/research :id "read" :query "bounded" :bundle "bundle:release-sources")','dispatch'));
});

test('T-M4-019 retry replaces implement with one provider_retry and V2 predicate uses evaluate once',async()=>{
 const retry=await integration('(fm/task :id "task" :model "role:implementer" :input "artifact:approved-spec" :output "schema:task-result-v1")','retry');assert.equal(retry.counts.provider_retry,1);assert.equal(retry.counts.implement,0);assert.equal(retry.dispatches,1);
 const predicate=await integration('(case 2 ["is even" #t #t #f])','predicate');assert.deepEqual(predicate.childActions,['evaluate']);assert.equal(predicate.dispatches,1);assert.equal(predicate.count,0);
});
test('T-M5-012 action-specific child authority must exist before any reservation',async()=>{await assert.rejects(integration('(case 2 ["is even" #t #t #f])','predicate',false));});
test('T-M4-002 post-admission resource denial persists a failed host receipt without reservation or dispatch',async()=>{
 const result=await integration('(fm/task :id "task" :model "role:implementer" :input "artifact:approved-spec" :output "schema:task-result-v1")','resource-denied');
 assert.equal(result.first.kind,'settled');if(result.first.kind==='settled'){assert.equal(result.first.receipt.outcome.tag,'failure');if(result.first.receipt.outcome.tag==='failure')assert.equal(result.first.receipt.outcome.failure.code,'resource-denied');}assert.equal(result.count,0);assert.equal(result.dispatches,0);assert.equal(result.intents,0);
});
test('T-M4-002 concurrency grant failure after reservation persists a failed receipt without dispatch',async()=>{
 const result=await integration('(fm/task :id "task" :model "role:implementer" :input "artifact:approved-spec" :output "schema:task-result-v1")','concurrency-denied');
 assert.equal(result.first.kind,'settled');if(result.first.kind==='settled'){assert.equal(result.first.receipt.outcome.tag,'failure');if(result.first.receipt.outcome.tag==='failure')assert.equal(result.first.receipt.outcome.failure.code,'resource-denied');}assert.equal(result.count,1);assert.equal(result.dispatches,0);assert.equal(result.intents,1);
});
test('T-M4-019 authorized publication reserves publish once and missing authority waits without reservation',async()=>{
 const source='(fm/publish :id "publish" :input "artifact:approved-spec" :destination "destination:pull-request")';
 const dispatched=await integration(source,'dispatch');assert.equal(dispatched.counts.publish,1);assert.equal(dispatched.count,1);assert.equal(dispatched.dispatches,1);assert.equal(dispatched.intents,1);
 const waiting=await integration(source,'needs-action');assert.equal(waiting.first.kind,'waiting');assert.equal(waiting.counts.publish,0);assert.equal(waiting.count,0);assert.equal(waiting.dispatches,0);assert.equal(waiting.intents,0);
});
