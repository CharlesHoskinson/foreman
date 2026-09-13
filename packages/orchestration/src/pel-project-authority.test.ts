import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {canonicalize,sha256Hex} from '@foreman/core';
import {hashAuthoringContent} from '@foreman/pel';
import {createDefaultAuthoringSnapshotV1} from './pel-host-descriptors.js';
import {EndstopLedger,makeLiveEndstopLedgerLayer} from './execution-ledger.js';
import {strictEndstopLimits,deriveExecutionContractFamilyV2,executionContractSha256,type ExecutionContractV1} from './execution-contract.js';
import type {ForemanProjectV1,PelArtifactRefV1} from './pel-run-contract.js';
import {decodePelProjectAuthorityV1,pelAuthorityFileBytes,pelV1AllowedPathsSha256,resolvePelProjectAuthority,resolvePelRegisteredCandidate,type PelProjectAuthorityV1,type PelAuthorityInputReaderV1} from './pel-project-authority.js';

function fixture(){
 const base=createDefaultAuthoringSnapshotV1(),repository={gitCommonDir:'/tmp/repository/.git',identitySha256:'a'.repeat(64)};
 const scope:PelProjectAuthorityV1={schemaVersion:1,repository,stateRoot:'/tmp/state',workspaceGrants:[{grantId:'w1',repository,worktreeId:'w1',canonicalRoot:'/tmp/pool/w1',directoryIdentity:'1:2',immutableBase:'a'.repeat(40),writablePaths:['src','test']}],taskActions:{work:'implement'},gates:{unit:{argv:['node','--test'],environmentRefs:[],environmentSha256:'b'.repeat(64),maxOutputBytes:1000,timeoutMs:1000}},destinations:{}};
 const inputs=new Map<string,Uint8Array>();
 const put=(value:unknown):PelArtifactRefV1=>{const bytes=pelAuthorityFileBytes(value),sha256=sha256Hex(bytes);inputs.set(sha256,bytes);return {artifactId:`sha256-${sha256}`,byteLength:bytes.length,sha256};};
 const authorityRef=put(scope);
 const contract:ExecutionContractV1={schemaVersion:1,contractId:'scope-contract',packageId:'scope-package',objectiveSha256:'b'.repeat(64),acceptanceSha256:'c'.repeat(64),baseCommit:'a'.repeat(40),allowedPathsSha256:pelV1AllowedPathsSha256(scope.workspaceGrants),dependencyContractIds:[],authorizationSha256:authorityRef.sha256,createdAt:'2026-09-13T00:00:00Z',deadlineAt:'2026-09-13T02:00:00Z',limits:strictEndstopLimits,requiredMilestones:['checks']};
 const project:ForemanProjectV1={schemaVersion:1,projectId:'scope-project',repository,stateRoot:scope.stateRoot,authorityRefs:[{kind:'v1',authoritySha256:authorityRef.sha256,authorityRef}],executionContractTemplate:put(contract),authoringSnapshot:put(base),runtimeHandlerVersion:'1',limits:{execution:strictEndstopLimits,pel:base.limits,maxConcurrentEffects:1,maxInputTokens:100,maxOutputTokens:100,maxToolCalls:0,maxOutputBytes:10000,maxCostUsd:1,cancellationObservationMs:100,maxReplayReductions:10000},requiredMilestones:['checks'],workspaces:{poolRoot:'/tmp/pool',immutableBase:contract.baseCommit,maxWorktrees:1,maxRaceContenders:1,grants:[{...scope.workspaceGrants[0]!,writablePaths:['src']}]},gates:scope.gates,destinations:{},roleBindings:{},taskActions:scope.taskActions,nlConditionProfile:null,dependencyMode:'ordered',resultContract:{schemaId:'schema:pel-data-v1',schemaSha256:hashAuthoringContent(base.registry.dataSchemas['schema:pel-data-v1']),classification:'generic'}};
 const read:PelAuthorityInputReaderV1=locator=>Effect.sync(()=>{const bytes=inputs.get(locator.sha256);if(!bytes)throw Error('missing fixture');return bytes;});
 return {scope,contract,project,put,inputs,read};
}

test('T-M4-001 authority scope is a closed canonical preimage and paths have one documented hash',()=>{
 const {scope}=fixture();
 assert.equal(decodePelProjectAuthorityV1(scope).ok,true);
 for(const bad of [{...scope,approval:true},{...scope,taskActions:{work:'publish'}},{...scope,workspaceGrants:[{...scope.workspaceGrants[0]!,writablePaths:['../etc']}]},{...scope,gates:{unit:{...scope.gates.unit!,shell:true}}}]) assert.equal(decodePelProjectAuthorityV1(bad).ok,false);
 assert.equal(pelV1AllowedPathsSha256(scope.workspaceGrants),sha256Hex(Buffer.from(`${canonicalize({schema:'foreman.execution-paths.v1',allowedPaths:['src','test']})}\n`)));
});

test('T-M4-001 registered V1 authority validates narrowed scopes without creating records or reservations',async()=>{
 const f=fixture(),root=mkdtempSync(join(tmpdir(),'pel-authority-'));
 try{await Effect.runPromise(Effect.gen(function*(){const ledger=yield* EndstopLedger;yield* ledger.create(f.contract);const before=yield* ledger.status(f.contract.contractId);const result=yield* resolvePelProjectAuthority(f.project,f.read);assert.deepEqual(result.contract,f.contract);assert.deepEqual(result.workspaceGrants,f.scope.workspaceGrants);assert.deepEqual(result.gates,f.scope.gates);assert.equal(result.retainedInputs.length,2);assert.deepEqual(yield* ledger.status(f.contract.contractId),before);
  assert.equal(result.executionDeadline,Date.parse(f.contract.deadlineAt));
  for(const project of [{...f.project,limits:{...f.project.limits,execution:{...f.project.limits.execution,providerRetries:3}}},{...f.project,taskActions:{work:'correct' as const}},{...f.project,gates:{unit:{...f.project.gates.unit!,argv:['node','evil'] as const}}},{...f.project,workspaces:{...f.project.workspaces,grants:[{...f.project.workspaces.grants[0]!,writablePaths:['secret']}]}}]) assert.equal((yield* Effect.either(resolvePelProjectAuthority(project,f.read)))._tag,'Left');
 }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))));}finally{rmSync(root,{recursive:true,force:true});}
});

test('T-M4-001 self-authored replacement, mismatched bytes, and opaque legacy path hashes cannot authorize scope',async()=>{
 const f=fixture(),root=mkdtempSync(join(tmpdir(),'pel-authority-'));
 try{await Effect.runPromise(Effect.gen(function*(){const ledger=yield* EndstopLedger;yield* ledger.create(f.contract);
  const replacement=f.put({...f.scope,taskActions:{work:'correct'}}),mutated={...f.project,authorityRefs:[{kind:'v1' as const,authoritySha256:replacement.sha256,authorityRef:replacement}]};
  assert.equal((yield* Effect.either(resolvePelProjectAuthority(mutated,f.read)))._tag,'Left');
  assert.equal((yield* Effect.either(resolvePelProjectAuthority(f.project,()=>Effect.succeed(Buffer.from('{}\n')))))._tag,'Left');
  const legacy={...f.contract,contractId:'legacy-scope',allowedPathsSha256:'d'.repeat(64)};yield* ledger.create(legacy);
  assert.equal((yield* Effect.either(resolvePelProjectAuthority({...f.project,executionContractTemplate:f.put(legacy)},f.read)))._tag,'Left');
 }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))));}finally{rmSync(root,{recursive:true,force:true});}
});

test('T-M4-001 V2 loads the registered family source and exact child bundle before exposing candidates',async()=>{
 const f=fixture(),root=mkdtempSync(join(tmpdir(),'pel-authority-v2-'));
 Object.assign(f.contract,{limits:{...f.contract.limits,providerRetries:50,totalActions:100}});
 const rows=[['v040-t2-project-registry','project-registry',[]],['v040-t3-memory-index','external-memory-index',['v040-t2-project-registry']],['v040-t4-appliance','hermetic-foreman-appliance',[]],['v040-t5-graphify','knowledge-plane-refresh',[]],['v040-t6-work-dag','work-dag-projection',['v040-t5-graphify']],['v040-t7-context','graph-context-builder',['v040-t6-work-dag']],['v040-t8-evaluation','graph-eval-falsification',['v040-t3-memory-index','v040-t4-appliance','v040-t7-context']],['v040-t9-release','v040-release-program',['v040-t2-project-registry','v040-t3-memory-index','v040-t4-appliance','v040-t5-graphify','v040-t6-work-dag','v040-t7-context','v040-t8-evaluation']]] as const;
 const source={schema:'foreman.execution-family-source.v1',program:'v040',familyId:'v040-release-20260822-f1',children:rows.map(([childId,packageId,dependencyChildIds],index)=>({schema:'foreman.execution-child-brief.v1',childId,packageId,dependencyChildIds,tranche:index+2,objective:'Bounded child work',acceptance:['Declared tests pass'],allowedPaths:['src/**']}))};
 const sourceRef=f.put(source),rootContractSha256=executionContractSha256(f.contract),derived=deriveExecutionContractFamilyV2({rootContractId:f.contract.contractId,rootContractSha256,track1Commit:f.contract.baseCommit,track1Tree:'e'.repeat(40),sourceBytes:f.inputs.get(sourceRef.sha256)!,createdAt:f.contract.createdAt});
 assert.equal(derived._tag,'Valid');if(derived._tag!=='Valid')return;
 const candidate={commit:f.contract.baseCommit,tree:'e'.repeat(40),candidateSha256:sha256Hex(f.contract.baseCommit)},receipt={schema:'foreman.design-approval.v1' as const,program:'v040' as const,packageId:'project-registry',designCommit:candidate.commit,designTree:candidate.tree,approvedOpenSpecSha256:'b'.repeat(64),taskPlanSha256:'c'.repeat(64),approvalStatementSha256:'d'.repeat(64),issuedAt:f.contract.createdAt};
 const bundle={schema:'foreman.release-evidence-bundle.v1',program:'v040',rootContractId:f.contract.contractId,rootContractSha256,familySha256:derived.familySha256,childId:rows[0][0],packageId:rows[0][1],action:'implement',candidate,taskPlanSha256:receipt.taskPlanSha256,receipts:[receipt],issuedAt:f.contract.createdAt},bundleRef=f.put(bundle);
 const binding={kind:'v2-child' as const,authoritySha256:f.contract.authorizationSha256,authorityRef:f.project.authorityRefs[0]!.authorityRef,rootContractId:f.contract.contractId,rootContractSha256,familySha256:derived.familySha256,childId:rows[0][0],originReservationId:'origin-1',taskPlanSha256:receipt.taskPlanSha256,authorityBundleSha256:bundleRef.sha256};
 const project={...f.project,executionContractTemplate:f.put(f.contract),requiredMilestones:['checks','audit','integrated'] as const,authorityRefs:[binding]};
 try{await Effect.runPromise(Effect.gen(function*(){const ledger=yield* EndstopLedger;yield* ledger.create(f.contract);const common={rootContractId:f.contract.contractId,rootContractSha256,familySha256:derived.familySha256,sourceSha256:sourceRef.sha256,auditReceiptSha256:'a'.repeat(64),userReceiptSha256:'b'.repeat(64)};
  yield* ledger.registerFamilyAuthority({...common,manifest:derived.manifest,registeredAt:'2026-09-13T00:01:00Z'});yield* ledger.activateFamily({...common,activatedAt:'2026-09-13T00:02:00Z'});
  assert.equal((yield* Effect.either(resolvePelProjectAuthority(project,f.read)))._tag,'Left');
  yield* ledger.registerChildAuthority({rootContractId:f.contract.contractId,rootContractSha256,familySha256:derived.familySha256,childId:binding.childId,action:'implement',effectiveAction:'implement',priorReservationId:null,originReservationId:null,candidate,taskPlanSha256:receipt.taskPlanSha256,bundleSha256:bundleRef.sha256,receiptSchemas:[receipt.schema],receiptSha256s:[sha256Hex(pelAuthorityFileBytes(receipt))],evaluationManifestSha256:null,registeredAt:'2026-09-13T00:03:00Z'});
  const resolved=yield* resolvePelProjectAuthority(project,f.read);assert.equal(resolved.retainedInputs.length,4);assert.deepEqual((yield* resolvePelRegisteredCandidate(binding,'implement')).candidate,candidate);
  assert.equal(resolved.executionDeadline,Math.min(Date.parse(f.contract.deadlineAt),Date.parse(derived.manifest.deadlineAt),Date.parse(derived.manifest.children[0]!.deadlineAt)));
  assert.equal((yield* Effect.either(resolvePelProjectAuthority({...project,limits:{...project.limits,execution:{...project.limits.execution,providerRetries:11}}},f.read)))._tag,'Left');
  assert.equal((yield* Effect.either(resolvePelRegisteredCandidate(binding,'evaluate')))._tag,'Left');
  assert.equal((yield* Effect.either(resolvePelRegisteredCandidate({...binding,authoritySha256:'f'.repeat(64)},'implement')))._tag,'Left');
  assert.equal((yield* Effect.either(resolvePelProjectAuthority({...project,workspaces:{...project.workspaces,grants:[{...project.workspaces.grants[0]!,writablePaths:['test']}]}},f.read)))._tag,'Left');
  const changedBundle=f.put({...bundle,candidate:{...candidate,tree:'f'.repeat(40)}});assert.equal((yield* Effect.either(resolvePelProjectAuthority({...project,authorityRefs:[{...binding,authorityBundleSha256:changedBundle.sha256}]},f.read)))._tag,'Left');
 }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))));}finally{rmSync(root,{recursive:true,force:true});}
});
