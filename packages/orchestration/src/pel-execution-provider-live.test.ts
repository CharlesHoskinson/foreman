import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Effect } from 'effect';
import { makeExecutionProviderTransport } from './pel-execution-provider-live.js';
import type { HostContextV1 } from './pel-run-contract.js';
import type { ProviderRequestV1 } from '@foreman/providers';
test('execution native factories require an enforced admitted host boundary',async()=>{
 const result=await Effect.runPromise(Effect.scoped(makeExecutionProviderTransport({transportId:'codex-app-server'} as ProviderRequestV1,{} as HostContextV1,{live:{stateRoot:'/state',worktreeRoot:'/workspace',userHome:'/user',environment:{}},permissions:{authorize:()=>Effect.die('forbidden'),submit:()=>Effect.die('forbidden')}})).pipe(Effect.either));
 assert.equal(result._tag,'Left');
});
test('execution API factory uses the actual M3 adapter without creating a qualification workspace',async()=>{
 const result=await Effect.runPromise(Effect.scoped(makeExecutionProviderTransport({transportId:'openai-responses'} as ProviderRequestV1,{checked:{snapshot:{registry:{dataSchemas:{}}}}} as HostContextV1,{live:{stateRoot:'/state',worktreeRoot:'/workspace',userHome:'/user',environment:{}},permissions:{authorize:()=>Effect.die('forbidden'),submit:()=>Effect.die('forbidden')}})));
 assert.equal(result.id,'openai-responses');
});

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Stream } from 'effect';
import { RunJournal, makeLiveRunJournalLayer, type RunId, type LaneId } from '@foreman/event-log';
import { createDefaultAuthoringSnapshotV1 } from './pel-host-descriptors.js';
import { appendPelRecord, makeLivePelArtifactPort, pelHash } from './pel-journal.js';
import { makePelExecutionProviderPort, loadOriginalPelProviderRequest } from './pel-execution-provider-live.js';
import type { ExecutionBindingV1, PelRuntimePorts } from './pel-run-contract.js';
import { resolveProfile, defaultProviderControls, controlsHash, type ProviderIdentityV1, type ApiHttpPort } from '@foreman/providers';
test('execution observation restores immutable original schema and calls only the real M3 GET observer',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pel-live-observe-'));
 try {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
   const journal=yield* RunJournal,runId='run-observe' as RunId,attempt=yield* journal.allocate(runId,'pel' as LaneId),digest='a'.repeat(64);
   const binding={runId,attempt,checkedProgramDigest:digest,authoritySha256:digest,runtimeVersion:'m4',languageProfileId:'pel',languageProfileDigest:digest} as ExecutionBindingV1;
   const context={binding,effect:{effectId:'effect',requestId:'request'},checked:{snapshot:createDefaultAuthoringSnapshotV1()}} as HostContextV1;
   const artifacts=makeLivePelArtifactPort(root),ref=yield* artifacts.put(runId,Buffer.from('{}'),100,'ordinary');
   yield* appendPelRecord(binding,'pel.run.v1',{bindingRef:ref});yield* appendPelRecord(binding,'pel.suspension.v1',{suspensionRef:ref});
   const identity:ProviderIdentityV1={kind:'api',provider:'openai',profileId:'gpt-6-astra',transportId:'openai-responses',credentialProfileRef:'env:OPENAI_API_KEY',endpointRevision:'v1',responseId:'response'};
   const profile=resolveProfile(identity.profileId);assert.equal(profile.ok,true);if(!profile.ok)throw Error('profile');
   const request:ProviderRequestV1={schemaVersion:1,effectId:'effect',profileId:'gpt-6-astra',transportId:'openai-responses',transportVersion:'1',profileHash:profile.value.profileHash,sourceManifestHash:profile.value.sourceManifestHash,credentialProfileRef:identity.credentialProfileRef,trustedInstructions:'Boolean only',artifacts:[],toolPolicy:{mode:'none'},outputSchema:{id:'schema:pel-boolean-v1',content:{type:'boolean'}},controls:{...defaultProviderControls('gpt-6-astra','openai'),toolChoice:'none'},limits:{deadline:Date.now()+60000,maxInputTokens:1000,maxOutputTokens:1000,maxToolCalls:0,maxCostUsd:1,maxOutputBytes:4096,spendReservationRef:'existing'}};
   const requestRef=yield* artifacts.put(runId,Buffer.from(JSON.stringify(request)),10000,'ordinary');
   const observationRef=yield* artifacts.put(runId,Buffer.from(JSON.stringify({requestRef})),10000,'ordinary');
   yield* appendPelRecord(binding,'pel.effect.observed.v1',{effectId:'effect',observationRef,providerIdentity:null,externalOutcome:'unknown'});
   yield* appendPelRecord(binding,'pel.effect.observed.v1',{effectId:'effect',observationRef:ref,providerIdentity:identity,externalOutcome:'pending'});
   const calls:string[]=[];
   const http:ApiHttpPort={request:input=>Effect.sync(()=>{calls.push(input.method);assert.match(input.url,/responses\/response$/);return {status:200,headers:{'content-type':'application/json'},body:Stream.make(Buffer.from(JSON.stringify({id:'response',model:request.profileId,status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"value":true}'}]}]})))};})};
   const runtime={artifacts} as PelRuntimePorts;
   const options={journal,runtime:()=>runtime,live:{stateRoot:root,worktreeRoot:root,userHome:root,environment:{OPENAI_API_KEY:'fixture-secret'}},permissions:{authorize:()=>Effect.die('forbidden'),submit:()=>Effect.die('forbidden')},http};
   const restored=yield* loadOriginalPelProviderRequest(identity,context,options);assert.equal(pelHash(restored.outputSchema),pelHash(request.outputSchema));
   const observed=yield* makePelExecutionProviderPort(options).observe(identity,context);assert.equal(observed.status,'completed');assert.deepEqual(calls,['GET']);if(observed.status==='completed')assert.deepEqual(observed.result.value,{tag:'boolean',value:true});
   const mismatch=yield* loadOriginalPelProviderRequest({...identity,responseId:'other'},context,options).pipe(Effect.either);assert.equal(mismatch._tag,'Left');assert.deepEqual(calls,['GET']);
   const info=yield* Effect.promise(()=>stat(root)),now=Date.now();
   const admittedContext={...context,binding:{...binding,stateRoot:root,evidenceKind:'product' as const},workspace:{canonicalRoot:root,directoryIdentity:`${info.dev}:${info.ino}`}} as HostContextV1;
   const readiness:import('@foreman/providers').ReadinessV1={schemaVersion:1,profileId:request.profileId,transportId:request.transportId,checkedAt:now,mode:'metadata-only',discovery:{state:'available'},authentication:{state:'authenticated'},currency:{state:'current'},identity:{state:'exact',observed:identity},capabilities:[]};
   const evidence:import('@foreman/providers').CapabilityEvidenceV1[]=(['generation','structuredOutput','toolPolicyNone'] as const).map(capability=>({capability,state:'live-qualified',profileId:request.profileId,transportId:request.transportId,profileHash:request.profileHash,sourceManifestHash:request.sourceManifestHash,transportVersion:request.transportVersion,controlsHash:controlsHash(request.controls),observedAt:now-1,expiresAt:now+10000,observedIdentity:identity,evidenceRef:'injected-test-evidence'}));
   const liveOptions={...options,runtime:()=>({...runtime,clock:{now:Effect.succeed(now),sleep:()=>Effect.void}}),readEvidence:()=>Effect.succeed(evidence),readiness:()=>Effect.succeed(readiness)};
   const admitted=yield* makePelExecutionProviderPort(liveOptions).resolve(request,admittedContext);assert.equal(admitted.transport.id,'openai-responses');assert.equal(admitted.admitted.bindingKind,'product');
   const missing=yield* makePelExecutionProviderPort({...liveOptions,readEvidence:()=>Effect.succeed([])}).resolve(request,admittedContext).pipe(Effect.either);assert.equal(missing._tag,'Left');assert.deepEqual(calls,['GET']);

  })).pipe(Effect.provide(makeLiveRunJournalLayer(root))));
 } finally {await rm(root,{recursive:true,force:true});}
});
