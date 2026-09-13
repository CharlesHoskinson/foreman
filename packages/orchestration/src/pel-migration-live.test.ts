import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Effect} from 'effect';
import {canonicalize,sha256Hex} from '@foreman/core';
import {createDefaultAuthoringSnapshotV1} from './pel-host-descriptors.js';
import {makeLivePelProjectServices,resolvePelRepository} from './pel-project-live.js';
import {makeLivePelMigrationServices} from './pel-migration-live.js';
import {EndstopLedger,makeLiveEndstopLedgerLayer} from './execution-ledger.js';
import {makeInstallManifest,requiredPelPackagePaths,type PackageFileV1} from './pel-package.js';
import {executionContractSha256,type ExecutionContractV1} from './execution-contract.js';
import {pelAuthorityFileBytes,pelV1AllowedPathsSha256,type PelProjectAuthorityV1} from './pel-project-authority.js';
import type {ForemanProjectV1} from './pel-run-contract.js';
const corpus=join(import.meta.dirname,'fixtures/pel-migration');

test('installed migration instantiates only the registered project contract, immutable spec and exact slots',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pel-migration-live-')),cwd=join(root,'repo'),stateRoot=join(root,'state'),foremanHome=join(root,'home'),packageRoot=join(root,'package');
 try{
  for(const dir of [cwd,stateRoot,foremanHome,packageRoot])mkdirSync(dir);execFileSync('git',['init','-q',cwd]);execFileSync('git',['-C',cwd,'-c','user.name=Fixture','-c','user.email=fixture@invalid','commit','--allow-empty','-qm','base']);
  const location=await Effect.runPromise(resolvePelRepository(cwd)),base=execFileSync('git',['-C',cwd,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),info=statSync(cwd),snapshot=createDefaultAuthoringSnapshotV1();
  const template=JSON.parse(readFileSync(join(corpus,'implement-verify-review','registered-command-bindings.json'),'utf8')),projectId='33333333-3333-4333-8333-333333333333',inputRoot=join(stateRoot,'project-inputs',projectId);mkdirSync(inputRoot,{recursive:true});
  const retain=(value:unknown)=>{const bytes=pelAuthorityFileBytes(value),sha256=sha256Hex(bytes),ref={artifactId:`sha256-${sha256}`,byteLength:bytes.length,sha256};writeFileSync(join(inputRoot,ref.artifactId),bytes);return ref;};
  const grant={grantId:'real-registered-workspace',repository:location.repository,worktreeId:'real-worktree',canonicalRoot:cwd,directoryIdentity:`${info.dev}:${info.ino}`,immutableBase:base,writablePaths:['src']};
  const gates={ 'candidate-full':{argv:template.gate.argv as [string,...string[]],environmentRefs:[],environmentSha256:sha256Hex(canonicalize({})),maxOutputBytes:4096,timeoutMs:5000} },scope:PelProjectAuthorityV1={schemaVersion:1,repository:location.repository,stateRoot,workspaceGrants:[grant],taskActions:{implement:'implement'},gates,destinations:{}},authorityRef=retain(scope);
  const original:ExecutionContractV1=JSON.parse(readFileSync(join(corpus,'implement-verify-review','contract-v1.json'),'utf8')),contract:ExecutionContractV1={...original,contractId:'actual-project-contract',baseCommit:base,allowedPathsSha256:pelV1AllowedPathsSha256([grant]),authorizationSha256:authorityRef.sha256},contractRef=retain(contract),snapshotRef=retain(snapshot);
  const project:ForemanProjectV1={schemaVersion:1,projectId,repository:location.repository,stateRoot,authorityRefs:[{kind:'v1',authoritySha256:authorityRef.sha256,authorityRef}],executionContractTemplate:contractRef,authoringSnapshot:snapshotRef,runtimeHandlerVersion:'1',limits:{execution:contract.limits,pel:snapshot.limits,maxConcurrentEffects:1,maxInputTokens:1000,maxOutputTokens:1000,maxToolCalls:0,maxOutputBytes:65536,maxCostUsd:1,cancellationObservationMs:100,maxReplayReductions:1000},requiredMilestones:['checks','audit'],workspaces:{poolRoot:root,immutableBase:base,maxWorktrees:1,maxRaceContenders:1,grants:[grant]},gates,destinations:{},roleBindings:snapshot.roleBindings,taskActions:scope.taskActions,nlConditionProfile:null,dependencyMode:'ordered',resultContract:{schemaId:'schema:delivery-final-v1',schemaSha256:sha256Hex(canonicalize(snapshot.registry.dataSchemas['schema:delivery-final-v1'])),classification:'delivery-v1'}};
  await Effect.runPromise(Effect.flatMap(EndstopLedger,ledger=>ledger.create(contract)).pipe(Effect.provide(makeLiveEndstopLedgerLayer(stateRoot))));await Effect.runPromise(makeLivePelProjectServices({cwd,foremanHome,validateAuthority:()=>Effect.void}).configure(pelAuthorityFileBytes(project)));
  const paths=[...requiredPelPackagePaths,...(['implement-verify-review','bounded-rework']as const).map(id=>`runtime/assets/pel/migration/${id}/registered-command-bindings.json`)].sort(),files:PackageFileV1[]=[];
  for(const path of paths){const bytes=path.includes('/migration/')?readFileSync(join(corpus,path.split('/').at(-2)!,'registered-command-bindings.json')):Buffer.from('immutable test package asset');mkdirSync(dirname(join(packageRoot,path)),{recursive:true});writeFileSync(join(packageRoot,path),bytes);files.push({path,byteLength:bytes.length,sha256:sha256Hex(bytes),mode:path.endsWith('.js')?493:420});}
  const manifest=makeInstallManifest({schemaVersion:1,releaseName:'Return of the ForeDi',version:null,candidateCommit:'a'.repeat(40),nodeRange:'>=24 <25',runtimeCompatibility:{runtimeVersion:'1',runtimeHandlerVersion:'1'},runtimeSchemas:{journal:{min:1,max:1},checkpoint:{min:1,max:1},pelContinuation:{min:1,max:1}},defaultAuthoringSnapshot:{path:'runtime/assets/pel/default-authoring-snapshot.json',sha256:files.find(f=>f.path.endsWith('default-authoring-snapshot.json'))!.sha256},metricEntry:{path:'runtime/dist/pel-simplification.js',sha256:files.find(f=>f.path.endsWith('pel-simplification.js'))!.sha256},files});writeFileSync(join(packageRoot,'manifest.json'),canonicalize(manifest)+'\n');
  const prompt=join(root,'implement-verify-review.md'),spec=snapshot.artifactDescriptors.find(a=>a.id==='artifact:approved-spec')!.content;assert.equal(typeof spec,'string');writeFileSync(prompt,spec as string);
  const round=JSON.parse(readFileSync(join(corpus,'implement-verify-review','round-v1.json'),'utf8'));round.runId='actual-legacy-run';round.commandArgv[2]=prompt;round.commandArgv[12]=cwd;const input=join(root,'round.json'),contractPath=join(root,'contract.json');writeFileSync(input,JSON.stringify(round));writeFileSync(contractPath,JSON.stringify(contract));
  // A sibling file is never consulted, even when it claims to authorize arbitrary commands.
  writeFileSync(join(root,'registered-command-bindings.json'),JSON.stringify({commandArgv:['bash','-c','false']}));
  const service=makeLivePelMigrationServices({entryUrl:pathToFileURL(join(packageRoot,'runtime/dist/foreman.js')).href,cwd,foremanHome}),result=await Effect.runPromise(service.migrate({input,contract:contractPath,out:join(root,'actual.pel')}));
  assert.equal(result.result.parityReport.contractSha256,executionContractSha256(contract));assert.equal(result.result.parityReport.workspace.grantId,grant.grantId);assert.deepEqual(result.result.parityReport.limits,contract.limits);
  const before=await Effect.runPromise(Effect.flatMap(EndstopLedger,l=>l.status(contract.contractId)).pipe(Effect.provide(makeLiveEndstopLedgerLayer(stateRoot))));assert.equal(before.counts.totalActions,0);
  for(const variant of ['spec','argv','contract','asset']as const){writeFileSync(prompt,variant==='spec'?'changed spec':spec as string);writeFileSync(input,JSON.stringify({...round,commandArgv:variant==='argv'?['bash','-c','touch /tmp/forbidden']:round.commandArgv}));writeFileSync(contractPath,JSON.stringify(variant==='contract'?{...contract,contractId:'unregistered'}:contract));if(variant==='asset')writeFileSync(join(packageRoot,'runtime/assets/pel/migration/implement-verify-review/registered-command-bindings.json'),'{}');const denied=await Effect.runPromise(Effect.either(service.migrate({input,contract:contractPath,out:join(root,`${variant}.pel`)})));assert.equal(denied._tag,'Left',variant);}
  assert.deepEqual(await Effect.runPromise(Effect.flatMap(EndstopLedger,l=>l.status(contract.contractId)).pipe(Effect.provide(makeLiveEndstopLedgerLayer(stateRoot)))),before);
 }finally{rmSync(root,{recursive:true,force:true});}
});
