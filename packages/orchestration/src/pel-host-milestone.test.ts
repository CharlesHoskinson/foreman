import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Effect} from 'effect';
import {sha256Hex} from '@foreman/core';
import {PelRuntime,type PelReservationTokenV1,type PelDispatchPreparationV1} from './pel-run-contract.js';
import {pelHostFixture} from './pel-host-test-fixture.js';
import {appendPelRecord,stablePelReservationId,stablePelEffectIdentity,pelHash} from './pel-journal.js';
import {retainPelHostPreparation} from './pel-host-recovery.js';
import {recordPelReleaseMilestone} from './pel-host-milestone.js';
test('host milestone recording uses the existing V1 reservation and exact evidence without another action',async()=>{
 const f=pelHostFixture('(print 1)');try{await Effect.runPromise(f.provide(Effect.gen(function*(){
  const {context,runtime,ledger,put,now}=yield* f.setup,ref=yield* put({checks:'host pass'}),candidate={commit:'a'.repeat(40),tree:'b'.repeat(40),candidateSha256:sha256Hex('a'.repeat(40))},preparationDigest='c'.repeat(64),reservationId=stablePelReservationId(context.effect.effectId,'verify',preparationDigest),token:PelReservationTokenV1={schemaVersion:1,kind:'v1',effect:context.effect,preparationDigest,operationDigest:'d'.repeat(64),authoritySha256:context.binding.authoritySha256,reservationId,candidate,contractId:context.binding.contractId,contractSha256:context.binding.contractSha256,action:'verify'},at=new Date(now).toISOString().replace('.000Z','Z');
  const state=yield* ledger.status(context.binding.contractId);yield* ledger.execute(context.binding.contractId,context.binding.contractSha256,{_tag:'RecordProductChange',candidateSha256:candidate.candidateSha256,allowedPathsSha256:state.contract.allowedPathsSha256,at});yield* ledger.execute(context.binding.contractId,context.binding.contractSha256,{_tag:'ReserveAction',action:'verify',candidateSha256:candidate.candidateSha256,commandSha256:token.operationDigest,reservationId,at});
  yield* appendPelRecord(context.binding,'pel.suspension.v1',{suspensionRef:ref});yield* appendPelRecord(context.binding,'pel.effect.intent.v1',{effect:context.effect,argumentsRef:ref,expectedResultSchemaId:'schema:pel-data-v1',preparationDigest,reservation:token,usageReservation:null});
  const receipt={effect:context.effect,candidate,reservation:token,observedAt:now};
  yield* recordPelReleaseMilestone(ledger,receipt,ref,'checks',context,null).pipe(Effect.provideService(PelRuntime,runtime));
  yield* recordPelReleaseMilestone(ledger,receipt,ref,'checks',context,null).pipe(Effect.provideService(PelRuntime,runtime));
  const result=yield* ledger.status(context.binding.contractId);assert.equal(result.counts.verify,1);assert.equal(result.counts.totalActions,1);assert.equal(result.milestones.checks,ref.sha256);
 })));}finally{f.close();}
});
test('V1 retry milestone requires the original retained effective action and charges no second action',async()=>{
 const f=pelHostFixture('(fm/verify :id "check" :input "artifact:approved-spec" :gate "candidate-full")');
 try{await Effect.runPromise(f.provide(Effect.gen(function*(){
  const fixture=yield* f.setup,{runtime,ledger,put,now}=fixture;
  const context={...fixture.context,effect:stablePelEffectIdentity(fixture.context.binding,fixture.request.requestId,1,fixture.context.effect.effectId)};
  const ref=yield* put({checks:'retried host pass'}),candidate={commit:'a'.repeat(40),tree:'b'.repeat(40),candidateSha256:sha256Hex('a'.repeat(40))};
  const prepared:PelDispatchPreparationV1={kind:'dispatch',operationDigest:'d'.repeat(64),resources:{reads:[],writes:[]},action:'verify',inputs:ref,candidate};
  const preparationDigest=pelHash(prepared),reservationId=stablePelReservationId(context.effect.effectId,'provider_retry',preparationDigest);
  const token:PelReservationTokenV1={schemaVersion:1,kind:'v1',effect:context.effect,preparationDigest,operationDigest:prepared.operationDigest,authoritySha256:context.binding.authoritySha256,reservationId,candidate,contractId:context.binding.contractId,contractSha256:context.binding.contractSha256,action:'provider_retry'};
  Object.assign(runtime,{handlers:new Map([['fm/verify',{prepare:()=>Effect.succeed(prepared),dispatch:()=>Effect.die('not a dispatch test')}]])});
  yield* Effect.gen(function*(){
   const at=new Date(now).toISOString().replace('.000Z','Z');
   yield* ledger.execute(context.binding.contractId,context.binding.contractSha256,{_tag:'RecordProductChange',candidateSha256:candidate.candidateSha256,allowedPathsSha256:fixture.contract.allowedPathsSha256,at});
   yield* ledger.execute(context.binding.contractId,context.binding.contractSha256,{_tag:'ReserveAction',action:'provider_retry',candidateSha256:candidate.candidateSha256,reservationId,at});
   yield* retainPelHostPreparation(prepared,fixture.request,context);
   yield* appendPelRecord(context.binding,'pel.effect.intent.v1',{effect:context.effect,argumentsRef:ref,expectedResultSchemaId:fixture.request.expectedResultSchemaId,preparationDigest,reservation:token,usageReservation:null});
   const receipt={effect:context.effect,candidate,reservation:token,observedAt:now};
   assert.equal((yield* recordPelReleaseMilestone(ledger,receipt,ref,'audit',context,null).pipe(Effect.either))._tag,'Left');
   yield* recordPelReleaseMilestone(ledger,receipt,ref,'checks',context,null);
   yield* recordPelReleaseMilestone(ledger,receipt,ref,'checks',context,null);
   const state=yield* ledger.status(context.binding.contractId);assert.equal(state.counts.provider_retry,1);assert.equal(state.counts.verify,0);assert.equal(state.counts.totalActions,1);assert.equal(state.milestones.checks,ref.sha256);
  }).pipe(Effect.provideService(PelRuntime,runtime));
 })));}finally{f.close();}
});
