import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect,Layer} from 'effect';
import {makeLiveRunJournalLayer,RunJournal} from '@foreman/event-log';
import {hashAuthoringContent,validateAuthoringSnapshotV1} from '@foreman/pel';
import {createDefaultAuthoringSnapshotV1} from './pel-host-descriptors.js';
import {strictEndstopLimits,type ExecutionContractV1} from './execution-contract.js';
import {makeLiveEndstopLedgerLayer} from './execution-ledger.js';
import {makeLiveRunLease} from './supervisor-live-services.js';
import {makeLivePelArtifactPort,readPelRecords,pelFailure} from './pel-journal.js';
import {makePelResourceScope} from './pel-resource-scope.js';
import {makePelControlHandlers} from './pel-control-functions.js';
import {PelRuntime,type ForemanProjectV1,type PelRuntimePorts} from './pel-run-contract.js';
import {makePelLifecycleServices,type PelLifecycleBackend} from './pel-lifecycle-services.js';
import {loadImmutablePelRunInputs} from './pel-runtime-inputs.js';
import {readPelExecutionBinding} from './pel-run-status.js';

async function fixture() {
  const root=mkdtempSync(join(tmpdir(),'pel-lifecycle-')),baseSnapshot=createDefaultAuthoringSnapshotV1();
  const repository={gitCommonDir:root,identitySha256:'a'.repeat(64)},ref={artifactId:'authority',byteLength:2,sha256:'a'.repeat(64)};
  const project:ForemanProjectV1={schemaVersion:1,projectId:'project-1',repository,stateRoot:root,
    authorityRefs:[{kind:'v1',authoritySha256:ref.sha256,authorityRef:ref}],executionContractTemplate:ref,authoringSnapshot:ref,runtimeHandlerVersion:'1',
    limits:{execution:strictEndstopLimits,pel:baseSnapshot.limits,maxConcurrentEffects:1,maxInputTokens:1000,maxOutputTokens:1000,maxToolCalls:0,maxOutputBytes:65536,maxCostUsd:1,cancellationObservationMs:100,maxReplayReductions:100000},
    requiredMilestones:['checks'],workspaces:{poolRoot:root,immutableBase:'a'.repeat(40),maxWorktrees:1,maxRaceContenders:1,grants:[{grantId:'grant-1',repository,worktreeId:'worktree-1',canonicalRoot:root,directoryIdentity:'1:2',immutableBase:'a'.repeat(40),writablePaths:['.']}]},gates:{},destinations:{},roleBindings:{},taskActions:{},nlConditionProfile:null,dependencyMode:'ordered',resultContract:{schemaId:'schema:pel-data-v1',schemaSha256:hashAuthoringContent(baseSnapshot.registry.dataSchemas['schema:pel-data-v1']),classification:'generic'}};
  const now=Date.parse('2026-01-01T00:00:00Z');
  const contract:ExecutionContractV1={schemaVersion:1,contractId:'contract-1',packageId:'package-1',objectiveSha256:ref.sha256,acceptanceSha256:ref.sha256,baseCommit:project.workspaces.immutableBase,allowedPathsSha256:ref.sha256,dependencyContractIds:[],authorizationSha256:ref.sha256,createdAt:'2026-01-01T00:00:00Z',deadlineAt:'2026-01-01T02:00:00Z',limits:strictEndstopLimits,requiredMilestones:['checks']};
  const artifacts=makeLivePelArtifactPort(root),resources=await Effect.runPromise(makePelResourceScope());
  const runtime:PelRuntimePorts={artifacts,resources,providers:{resolve:()=>Effect.die('provider forbidden'),observe:()=>Effect.die('observation forbidden'),permissions:{authorize:()=>Effect.die('permission forbidden'),submit:()=>Effect.die('submission forbidden')}},clock:{now:Effect.succeed(now),sleep:Effect.sleep},handlers:new Map(),controls:makePelControlHandlers(),output:()=>Effect.void,validateDecisionAuthority:()=>Effect.die('decision forbidden'),hostEvidence:()=>Effect.succeed({milestones:['checks'],receiptRefs:[]}),loadRunInputs:binding=>Effect.gen(function*(){const parsed=validateAuthoringSnapshotV1(JSON.parse(Buffer.from(yield* artifacts.get(binding.runId,binding.artifacts.snapshot,16777216)).toString()));if(!parsed.ok)return yield* Effect.die('invalid fixture snapshot');const snapshot=parsed.value;return {binding,project,contract,snapshot,registry:snapshot.registry};})};
  const loaded={project,baseSnapshot,retainedInputs:[],authority:{binding:project.authorityRefs[0]!,contract,executionDeadline:Date.parse(contract.deadlineAt),workspaceGrants:project.workspaces.grants,allowedTaskActions:{},availableHandlers:new Set(['fm/checkpoint','fm/retry','fm/race','print'])}};
  const services=()=>Layer.mergeAll(Layer.succeed(PelRuntime,runtime),makeLiveRunJournalLayer(root),makeLiveEndstopLedgerLayer(root),makeLiveRunLease(root));
  const backend:PelLifecycleBackend={runtimeVersion:'1',evidenceKind:'test-fixture',now:Effect.succeed(now),load:()=>Effect.succeed(loaded),configured:()=>Effect.succeed(loaded),configure:()=>Effect.void,services,servicesForRun:()=>Effect.succeed(services()),preflight:()=>Effect.void};
  return {root,loaded,backend,api:makePelLifecycleServices(backend),services,artifacts,runtime};
}
test('T-M4-001 fresh lifecycle persists source and binding before startup, then status reads same final result',async()=>{
  const f=await fixture();try{
    let started=false;
    const result=await Effect.runPromise(f.api.run({source:Buffer.from('(fm/checkpoint :name "saved")\n42'),sourcePath:'program.pel',started:runId=>Effect.gen(function*(){
      const events=yield* readPelRecords(runId as import('@foreman/event-log').RunId).pipe(Effect.provide(makeLiveRunJournalLayer(f.root)),Effect.mapError(()=>({_tag:'AuthoringFailure' as const,code:'test',message:'journal',exitCode:1 as const})));
      assert.ok(events.some(e=>e.type==='pel.run.v1'));assert.equal(events.some(e=>e.type==='pel.effect.intent.v1'),false);started=true;
    })}));
    assert.equal(started,true);assert.equal(result.state,'succeeded');assert.deepEqual(result.finalValue,{tag:'number',value:42});
    assert.equal(hashAuthoringContent(await Effect.runPromise(f.api.status(result.runId))),hashAuthoringContent(result));
    assert.equal(hashAuthoringContent(await Effect.runPromise(f.api.cancel(result.runId))),hashAuthoringContent(result));
    const resumed=await Effect.runPromise(Effect.either(f.api.resume({runId:result.runId,started:()=>Effect.void})));
    assert.equal(resumed._tag,'Left');if(resumed._tag==='Left')assert.equal(resumed.left.code,'terminal-run');
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('T-M4-017 original runtime input loader rechecks saved source and ignores replacement working configuration',async()=>{
  const f=await fixture();try{
    const final=await Effect.runPromise(f.api.run({source:Buffer.from('42'),sourcePath:'original.pel',started:()=>Effect.void}));
    const binding=await Effect.runPromise(readPelExecutionBinding(final.runId).pipe(Effect.provide(f.services())));
    const options={artifacts:f.artifacts,runtimeVersion:'1',runtimeHandlerVersion:'1',registryDigest:binding.registryDigest,resolveAuthority:()=>Effect.succeed(f.loaded.authority)};
    const restored=await Effect.runPromise(loadImmutablePelRunInputs(binding,options));
    assert.equal(restored.project.stateRoot,f.root);assert.equal(restored.snapshot.snapshotDigest,binding.snapshotDigest);
    for(const changed of [
      {...binding,configurationDigest:'b'.repeat(64)},
      {...binding,limits:{...binding.limits,maxCostUsd:binding.limits.maxCostUsd+1}},
      {...binding,limits:{...binding.limits,deadline:f.loaded.authority.executionDeadline+1}},
      {...binding,requiredMilestones:[]},
      {...binding,resultContract:{...binding.resultContract,schemaSha256:'b'.repeat(64)}},
      {...binding,languageProfileDigest:'b'.repeat(64)},
      {...binding,options:{...binding.options,dependencyMode:'automatic' as const},optionsDigest:hashAuthoringContent({...binding.options,dependencyMode:'automatic'})},
    ])assert.equal((await Effect.runPromise(Effect.either(loadImmutablePelRunInputs(changed,options))))._tag,'Left');
    const readOnly=makePelLifecycleServices({...f.backend,load:()=>Effect.die('current settings forbidden'),configured:()=>Effect.die('current settings forbidden')});
    assert.equal((await Effect.runPromise(readOnly.status(final.runId))).state,'succeeded');
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('T-M4-001 invalid source and absent reachable handlers allocate no run or provider work',async()=>{
  const f=await fixture();try{
    for(const source of ['(','(fm/task :id "work" :spec "artifact:approved-spec" :model "role:implementer")']){
      const failed=await Effect.runPromise(Effect.either(f.api.run({source:Buffer.from(source),sourcePath:'bad.pel',started:()=>Effect.die('startup forbidden')})));
      assert.equal(failed._tag,'Left');assert.deepEqual(readdirSync(f.root),[]);
    }
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('T-M4-001 retained input validation precedes the durable run record and startup event',async()=>{
  const f=await fixture();try{
    Object.assign(f.runtime,{loadRunInputs:()=>Effect.fail(pelFailure('binding-mismatch','Retained authority changed during admission.'))});
    const result=await Effect.runPromise(Effect.either(f.api.run({source:Buffer.from('42'),sourcePath:'program.pel',started:()=>Effect.die('startup must follow validation')})));
    assert.equal(result._tag,'Left');
    const runId=readdirSync(join(f.root,'runs'))[0] as import('@foreman/event-log').RunId;assert.ok(runId);
    const records=await Effect.runPromise(readPelRecords(runId).pipe(Effect.provide(f.services())));
    assert.equal(records.some(row=>row.type==='pel.run.v1'),false);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
