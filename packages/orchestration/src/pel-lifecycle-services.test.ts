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

import {packageFixture} from './fixtures/pel-install/package-fixture.js';
import {installPackage,withInstalledPrefix} from './pel-install.js';
import {makeInstallManifest} from './pel-package.js';
import {makeLivePelAdoptionServices} from './pel-adoption.js';
import {makePelInstalledAdmission} from './pel-install-admission.js';
import {canonicalize} from '@foreman/core';
import {writeFile,readlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
test('T-M6-017 real lifecycle admission and rollback serialize, reject a stale invoker, and release before startup',async()=>{
 const f=await fixture(),pkg=await packageFixture();try{
  const {buildId,...payload}=pkg.manifest;void buildId;
  const old=makeInstallManifest({...payload,runtimeCompatibility:{runtimeVersion:'1',runtimeHandlerVersion:'older'}});
  await writeFile(join(pkg.sourceRoot,'manifest.json'),canonicalize(old)+'\n');
  await Effect.runPromise(installPackage({sourceRoot:pkg.sourceRoot,prefix:pkg.prefix}));
  const next=await pkg.seal('1.0.0');await Effect.runPromise(installPackage({sourceRoot:pkg.sourceRoot,prefix:pkg.prefix}));
  const entryUrl=pathToFileURL(join(pkg.prefix,'versions',next.buildId,'runtime/dist/foreman.js')).href;
  Object.assign(f.runtime,{admission:makePelInstalledAdmission(entryUrl,pkg.root)});
  let startupCount=0,blockedAdmission=false;
  const input={source:Buffer.from('42'),sourcePath:'admitted.pel',started:()=>Effect.sync(()=>{startupCount++;})};
  const api=makeLivePelAdoptionServices({entryUrl,foremanHome:pkg.root,loadRegisteredRoots:()=>Effect.gen(function*(){
   const attempt=yield* f.api.run(input).pipe(Effect.either);assert.equal(attempt._tag,'Left');blockedAdmission=true;return [f.root];
  })});
  await Effect.runPromise(api.rollback(old.buildId));assert.equal(blockedAdmission,true);assert.equal(startupCount,0);
  assert.equal(await readlink(join(pkg.prefix,'current')),`versions/${old.buildId}`);
  const stale=await Effect.runPromise(f.api.run(input).pipe(Effect.either));assert.equal(stale._tag,'Left');assert.equal(startupCount,0);
  assert.equal(readdirSync(f.root).includes('runs')?readdirSync(join(f.root,'runs')).filter(name=>name.startsWith('pel-')).length:0,0);
  await Effect.runPromise(installPackage({sourceRoot:pkg.sourceRoot,prefix:pkg.prefix}));
  const admitted=await Effect.runPromise(f.api.run({...input,started:()=>makePelInstalledAdmission(entryUrl,pkg.root)(Effect.sync(()=>{startupCount++;})).pipe(Effect.mapError(()=>({_tag:'AuthoringFailure' as const,code:'test',message:'lock retained at startup',exitCode:1 as const})),Effect.zipRight(Effect.fail({_tag:'AuthoringFailure' as const,code:'test',message:'stop after durable admission',exitCode:1 as const})))}).pipe(Effect.either));
  assert.equal(admitted._tag,'Left');assert.equal(startupCount,1);
  const recheck=makeLivePelAdoptionServices({entryUrl,foremanHome:pkg.root,loadRegisteredRoots:()=>Effect.succeed([f.root])});
  const refused=await Effect.runPromise(recheck.rollback(old.buildId).pipe(Effect.either));assert.equal(refused._tag,'Left');if(refused._tag==='Left')assert.equal(refused.left.exitCode,3);
  assert.equal(await readlink(join(pkg.prefix,'current')),`versions/${next.buildId}`);
 }finally{rmSync(f.root,{recursive:true,force:true});await pkg.close();}
});

test('T-M6-017 rollback excludes second-prefix and checkout admission through the original registry transaction',async()=>{
 const f=await fixture(),pkg=await packageFixture();try{
  const {buildId,...payload}=pkg.manifest;void buildId;const old=makeInstallManifest({...payload,runtimeCompatibility:{runtimeVersion:'1',runtimeHandlerVersion:'older'}});
  await writeFile(join(pkg.sourceRoot,'manifest.json'),canonicalize(old)+'\n');await Effect.runPromise(installPackage({sourceRoot:pkg.sourceRoot,prefix:pkg.prefix}));
  const next=await pkg.seal('1.0.0');await Effect.runPromise(installPackage({sourceRoot:pkg.sourceRoot,prefix:pkg.prefix}));
  const otherPrefix=join(pkg.root,'other-prefix');await Effect.runPromise(installPackage({sourceRoot:pkg.sourceRoot,prefix:otherPrefix}));
  const entryUrl=pathToFileURL(join(pkg.prefix,'versions',next.buildId,'runtime/dist/foreman.js')).href;
  const otherUrl=pathToFileURL(join(otherPrefix,'versions',next.buildId,'runtime/dist/foreman.js')).href;
  let blocked=0,started=0;
  const api=makeLivePelAdoptionServices({entryUrl,foremanHome:pkg.root,loadRegisteredRoots:()=>Effect.gen(function*(){
   for(const url of [otherUrl,import.meta.url]){
    Object.assign(f.runtime,{admission:makePelInstalledAdmission(url,pkg.root)});
    const attempt=yield* f.api.run({source:Buffer.from('42'),sourcePath:'concurrent.pel',started:()=>Effect.sync(()=>{started++;})}).pipe(Effect.either);
    assert.equal(attempt._tag,'Left',url);blocked++;
   }
   return [f.root];
  })});
  await Effect.runPromise(api.rollback(old.buildId));assert.equal(blocked,2);assert.equal(started,0);
  assert.equal(readdirSync(f.root).includes('runs')?readdirSync(join(f.root,'runs')).filter(name=>name.startsWith('pel-')).length:0,0);
  assert.equal(await readlink(join(pkg.prefix,'current')),`versions/${old.buildId}`);
  // Checkout still needs no prefix once rollback has released the transaction.
  const result=await Effect.runPromise(f.api.run({source:Buffer.from('42'),sourcePath:'checkout.pel',started:()=>Effect.sync(()=>{started++;})}));assert.equal(result.state,'succeeded');assert.equal(started,1);
 }finally{rmSync(f.root,{recursive:true,force:true});await pkg.close();}
});
