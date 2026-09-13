import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {RunJournal,makeLiveRunJournalLayer,type RunId,type LaneId} from '@foreman/event-log';
import {checkPel,canonicalAuthoringJson,createHostRegistry,createAuthoringSnapshotV1,createPelEnvironment,startPel,encodePelContinuation,encodeHostArgumentsV1,validateRevisionPrefix,hashAuthoringContent} from '@foreman/pel';
import {createDefaultAuthoringSnapshotV1,foremanDescriptorSpecsV1,foremanDataSchemasV1,foremanFailureSchemasV1,foremanResolverCatalogV1} from './pel-host-descriptors.js';
import {deriveExecutionBinding,configurePelSnapshot} from './pel-project-config.js';
import {strictEndstopLimits,type ExecutionContractV1} from './execution-contract.js';
import {EndstopLedger,makeLiveEndstopLedgerLayer} from './execution-ledger.js';
import {makeLivePelArtifactPort,appendPelRecord,stablePelEffectIdentity,pelHash,pelBytesHash,readPelRecords} from './pel-journal.js';
import {PelRuntime,type PelRuntimePorts,type ForemanProjectV1,type PelOwnedRunContextV1} from './pel-run-contract.js';
import {makeLiveRunLease} from './supervisor-live-services.js';
import {registerPelOperatorDecision,validatePelRegisteredDecisionAuthority} from './pel-decision-authority.js';

function fixture(sourceText='(print "pending")',base=createDefaultAuthoringSnapshotV1()){
 const root=mkdtempSync(join(tmpdir(),'pel-decision-')),runId='operator-run' as RunId,source=Buffer.from(sourceText);let snapshot=base;
 const artifacts=makeLivePelArtifactPort(root),ports={artifacts,validateDecisionAuthority:validatePelRegisteredDecisionAuthority} as PelRuntimePorts;
 const setup=Effect.gen(function*(){
  const journal=yield* RunJournal,ledger=yield* EndstopLedger,attempt=yield* journal.allocate(runId,'pel' as LaneId),put=(value:unknown)=>artifacts.put(runId,Buffer.from(canonicalAuthoringJson(value)),1048576,'ordinary');
  const scope=yield* put({registered:'authority'}),repository={gitCommonDir:root,identitySha256:'a'.repeat(64)},grant={grantId:'grant',repository,worktreeId:'worktree',canonicalRoot:root,directoryIdentity:'1:2',immutableBase:'a'.repeat(40),writablePaths:['.']};
  const contract:ExecutionContractV1={schemaVersion:1,contractId:'operator-contract',packageId:'operator-package',objectiveSha256:'b'.repeat(64),acceptanceSha256:'c'.repeat(64),baseCommit:grant.immutableBase,allowedPathsSha256:'d'.repeat(64),dependencyContractIds:[],authorizationSha256:scope.sha256,createdAt:'2026-09-13T00:00:00Z',deadlineAt:'2026-09-13T02:00:00Z',limits:strictEndstopLimits,requiredMilestones:['checks']};yield* ledger.create(contract);
  const project:ForemanProjectV1={schemaVersion:1,projectId:'project',repository,stateRoot:root,authorityRefs:[{kind:'v1',authoritySha256:scope.sha256,authorityRef:scope}],executionContractTemplate:yield* put(contract),authoringSnapshot:yield* put(snapshot),runtimeHandlerVersion:'1',limits:{execution:strictEndstopLimits,pel:snapshot.limits,maxConcurrentEffects:1,maxInputTokens:1000,maxOutputTokens:1000,maxToolCalls:0,maxOutputBytes:65536,maxCostUsd:1,cancellationObservationMs:10,maxReplayReductions:10000},requiredMilestones:['checks'],workspaces:{grants:[grant],maxWorktrees:1,maxRaceContenders:1,poolRoot:root,immutableBase:grant.immutableBase},gates:{},destinations:{},roleBindings:snapshot.roleBindings,taskActions:{},nlConditionProfile:null,dependencyMode:'ordered',resultContract:{schemaId:'schema:pel-data-v1',schemaSha256:pelHash(snapshot.registry.dataSchemas['schema:pel-data-v1']),classification:'generic'}};
  const configured=configurePelSnapshot(base,project);if(!configured.ok)throw Error('configure');snapshot=configured.value;const checked=checkPel({source,snapshot});if(checked.tag!=='ok')throw Error('check');
  const sourceRef=yield* artifacts.put(runId,source,1048576,'ordinary'),refs={source:sourceRef,snapshot:yield* put(snapshot),registry:yield* put(snapshot.registry),configuration:yield* put(project)},derived=deriveExecutionBinding(project,checked.checked,{contract,executionDeadline:Date.parse(contract.deadlineAt),binding:project.authorityRefs[0]!,workspaceGrants:[grant],allowedTaskActions:{},availableHandlers:new Set(snapshot.registry.descriptors.map(descriptor=>descriptor.id))},{attempt,evidenceKind:'test-fixture',runtimeVersion:'1',ownerLeaseRef:'lease',artifacts:refs},Date.parse(contract.createdAt));if(!derived.ok)throw Error(JSON.stringify(derived));const binding=derived.value.binding;
  yield* appendPelRecord(binding,'pel.run.v1',{bindingRef:yield* put(binding)});
  const step=startPel(checked.checked.program,createPelEnvironment(snapshot.registry),snapshot.limits,snapshot.options);
  let effectId:string|null=null;
  if(step.tag==='suspend'){
   const request=step.ready[0]!,effect=stablePelEffectIdentity(binding,request.requestId),encoded=encodePelContinuation(step.continuation),args=encodeHostArgumentsV1(request.boundArguments,{sourceDigest:binding.sourceDigest,registryDigest:binding.registryDigest,optionsDigest:binding.optionsDigest,records:step.continuation.environments});if(!encoded.ok||!args.ok)throw Error('codec');
   const argumentsRef=yield* put(args.value),continuationRef=yield* artifacts.put(runId,encoded.value,1048576,'ordinary');effectId=effect.effectId;
   yield* appendPelRecord(binding,'pel.suspension.v1',{suspensionRef:yield* put({continuationRef,options:binding.options,optionsDigest:binding.optionsDigest,committedCounters:step.counters,pending:[{effect,argumentsRef,expectedResultSchemaId:request.expectedResultSchemaId,reservation:null,observationRef:null,providerIdentity:null}],childRecordSequences:[]})});
   yield* appendPelRecord(binding,'pel.effect.intent.v1',{effect,argumentsRef,expectedResultSchemaId:request.expectedResultSchemaId,preparationDigest:'a'.repeat(64),reservation:null,usageReservation:null});
  }
  const context:PelOwnedRunContextV1={binding,project,contract,snapshot,registry:snapshot.registry,owner:{runId,release:()=>Effect.void}};
  return {binding,context,effectId,put,checked:checked.checked};
 });
 const provide=<A,E,R>(effect:Effect.Effect<A,E,R>)=>effect.pipe(Effect.provideService(PelRuntime,ports),Effect.provide(makeLiveRunJournalLayer(root)),Effect.provide(makeLiveEndstopLedgerLayer(root)),Effect.provide(makeLiveRunLease(root)),Effect.scoped);
 return {root,runId,setup,provide};
}
test('trusted recovery registration binds the complete decision and repeats without a second registration',async()=>{
 const f=fixture();try{await Effect.runPromise(f.provide(Effect.gen(function*(){const {binding,context,effectId,put}=yield* f.setup,evidence=yield* put({observation:'confirmed no dispatch'}),input={schemaVersion:1,runId:binding.runId,effectId:effectId!,checkedDigest:binding.checkedProgramDigest,decision:'confirm-no-dispatch',evidenceRefs:[evidence]};
  const signed=yield* registerPelOperatorDecision(binding,context,'recovery',input);const before=(yield* readPelRecords(binding.runId)).length;
  yield* validatePelRegisteredDecisionAuthority(signed.authorityReceipt,binding,'recovery',signed);
  assert.deepEqual(yield* registerPelOperatorDecision(binding,context,'recovery',input),signed);assert.equal((yield* readPelRecords(binding.runId)).length,before);
  for(const decision of [{...signed,decision:'abandon' as const},{...signed,effectId:'foreign'},{...signed,evidenceRefs:[]}])assert.equal((yield* Effect.either(validatePelRegisteredDecisionAuthority(signed.authorityReceipt,binding,'recovery',decision)))._tag,'Left');
  assert.equal((yield* Effect.either(validatePelRegisteredDecisionAuthority(signed.authorityReceipt,{...binding,runId:'foreign' as RunId},'recovery',signed)))._tag,'Left');
  assert.equal((yield* Effect.either(registerPelOperatorDecision(binding,context,'recovery',{...input,decision:'abandon'})))._tag,'Left');
  assert.equal((yield* Effect.either(registerPelOperatorDecision(binding,{...context,owner:{...context.owner,runId:'foreign' as RunId}},'recovery',input)))._tag,'Left');
 })))}finally{rmSync(f.root,{recursive:true,force:true});}
});
test('operator result schema and revision prefix validation finish before authority publication',async()=>{
 const f=fixture();try{await Effect.runPromise(f.provide(Effect.gen(function*(){const {binding,context,effectId,put}=yield* f.setup,evidence=yield* put({observation:'remote complete'}),bad=yield* put({not:'Pel data'}),before=(yield* readPelRecords(binding.runId)).length;
  assert.equal((yield* Effect.either(registerPelOperatorDecision(binding,context,'recovery',{schemaVersion:1,runId:binding.runId,effectId:effectId!,checkedDigest:binding.checkedProgramDigest,decision:'accept-result',evidenceRefs:[evidence],resultRef:bad})))._tag,'Left');assert.equal((yield* readPelRecords(binding.runId)).length,before);
 })))}finally{rmSync(f.root,{recursive:true,force:true});}
 const revision=fixture('1\n2');try{await Effect.runPromise(revision.provide(Effect.gen(function*(){const {binding,context,checked}=yield* revision.setup,source=Buffer.from('1\n3'),next=checkPel({source,snapshot:checked.snapshot});if(next.tag!=='ok')throw Error('next');const prefix=validateRevisionPrefix(checked.program,next.checked.program,1,[]);if(!prefix.ok)throw Error('prefix');const input={schemaVersion:1,runId:binding.runId,parentSourceDigest:binding.sourceDigest,revisedSourceDigest:hashAuthoringContent('unused'),completedPrefixDigest:prefix.value.prefixDigest,completedTopLevelCount:1,pendingSuffixBoundary:1};input.revisedSourceDigest=pelBytesHash(source);
  const before=(yield* readPelRecords(binding.runId)).length;assert.equal((yield* Effect.either(registerPelOperatorDecision(binding,context,'revision',{...input,completedPrefixDigest:'f'.repeat(64)},source)))._tag,'Left');assert.equal((yield* readPelRecords(binding.runId)).length,before);
  const signed=yield* registerPelOperatorDecision(binding,context,'revision',input,source);yield* validatePelRegisteredDecisionAuthority(signed.authorityReceipt,binding,'revision',signed);
  assert.equal((yield* Effect.either(validatePelRegisteredDecisionAuthority(signed.authorityReceipt,binding,'recovery',signed)))._tag,'Left');
 })))}finally{rmSync(revision.root,{recursive:true,force:true});}
});
test('a consumed no-dispatch authority cannot replay and later evidence can authorize recovery',async()=>{
 const f=fixture();try{await Effect.runPromise(f.provide(Effect.gen(function*(){
  const {binding,context,effectId,put}=yield* f.setup,evidence=yield* put({observation:'first no dispatch'}),input={schemaVersion:1,runId:binding.runId,effectId:effectId!,checkedDigest:binding.checkedProgramDigest,decision:'confirm-no-dispatch',evidenceRefs:[evidence]};
  const signed=yield* registerPelOperatorDecision(binding,context,'recovery',input),applied=yield* appendPelRecord(binding,'pel.recovery-decision.v1',{decisionRef:yield* put(signed)});
  yield* appendPelRecord(binding,'pel.effect.observed.v1',{effectId:effectId!,observationRef:yield* put({redispatchDecisionSequence:applied.seq}),providerIdentity:null,externalOutcome:'unknown'});
  assert.equal((yield* Effect.either(validatePelRegisteredDecisionAuthority(signed.authorityReceipt,binding,'recovery',signed)))._tag,'Left');
  assert.equal((yield* Effect.either(registerPelOperatorDecision(binding,context,'recovery',signed)))._tag,'Left');
  assert.equal((yield* Effect.either(registerPelOperatorDecision(binding,context,'recovery',input)))._tag,'Left');
  assert.equal((yield* Effect.either(registerPelOperatorDecision(binding,context,'recovery',{...input,decision:'abandon'})))._tag,'Left');
  const newer=yield* put({observation:'second outcome remains unknown'}),next=yield* registerPelOperatorDecision(binding,context,'recovery',{...input,decision:'abandon',evidenceRefs:[newer]});
  assert.ok(next.authorityReceipt.sequence>signed.authorityReceipt.sequence);
  yield* validatePelRegisteredDecisionAuthority(next.authorityReceipt,binding,'recovery',next);
  assert.deepEqual(yield* registerPelOperatorDecision(binding,context,'recovery',{...input,decision:'abandon',evidenceRefs:[newer]}),next);
 })))}finally{rmSync(f.root,{recursive:true,force:true});}
});
test('abandon authority is not published when the original descriptor rejects its failure receipt',async()=>{
 const original=foremanFailureSchemasV1['schema:foreman-failure-v1']!,registry=createHostRegistry(foremanDescriptorSpecsV1,foremanDataSchemasV1,{'schema:foreman-failure-v1':{...original,codes:original.codes.filter(code=>code!=='reconciliation-abandoned')}},foremanResolverCatalogV1);assert.ok(registry.ok);
 const snapshot=createAuthoringSnapshotV1({...createDefaultAuthoringSnapshotV1(),registry:registry.value});assert.ok(snapshot.ok);
 const f=fixture('(fm/research :id "read" :query "bounded" :bundle "artifact:approved-spec")',snapshot.value);try{await Effect.runPromise(f.provide(Effect.gen(function*(){
  const {binding,context,effectId,put}=yield* f.setup,evidence=yield* put({observation:'unknown'}),before=(yield* readPelRecords(binding.runId)).length;
  const refused=yield* Effect.either(registerPelOperatorDecision(binding,context,'recovery',{schemaVersion:1,runId:binding.runId,effectId:effectId!,checkedDigest:binding.checkedProgramDigest,decision:'abandon',evidenceRefs:[evidence]}));
  assert.equal(refused._tag,'Left');if(refused._tag==='Left')assert.match(refused.left.diagnostic.message,/receipt schema/u);assert.equal((yield* readPelRecords(binding.runId)).length,before);
 })))}finally{rmSync(f.root,{recursive:true,force:true});}
});
