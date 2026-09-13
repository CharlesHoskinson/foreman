import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,statSync,existsSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {Effect} from 'effect';
import {sha256Hex} from '@foreman/core';
import {hashAuthoringContent} from '@foreman/pel';
import {resolvePelRepository} from './pel-project-live.js';
import {createDefaultAuthoringSnapshotV1} from './pel-host-descriptors.js';
import {pelAuthorityFileBytes,pelV1AllowedPathsSha256,type PelProjectAuthorityV1} from './pel-project-authority.js';
import {strictEndstopLimits,type ExecutionContractV1} from './execution-contract.js';
import {EndstopLedger,makeLiveEndstopLedgerLayer} from './execution-ledger.js';
import {makeLivePelLifecycleServices} from './pel-lifecycle-live.js';
import type {ForemanProjectV1,PelArtifactRefV1} from './pel-run-contract.js';
const entry=resolve('skills/foreman/runtime/dist/foreman.js');
for(const variant of ['missing-evidence','unsupported-native','api-task','ambiguous-selection'] as const)test(`T-M5-015 compiled product ${variant} exits2 before allocating or dispatching`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'pel-product-admission-')),cwd=join(root,'repo'),stateRoot=join(root,'state'),home=join(root,'home');
 try{for(const path of [cwd,stateRoot,home])mkdirSync(path);mkdirSync(join(cwd,'src'));execFileSync('/usr/bin/git',['init','-q',cwd]);execFileSync('/usr/bin/git',['-C',cwd,'-c','user.name=fixture','-c','user.email=fixture@invalid','commit','--allow-empty','-qm','base']);
  const location=await Effect.runPromise(resolvePelRepository(cwd)),base=execFileSync('/usr/bin/git',['-C',cwd,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),info=statSync(cwd),projectId='11111111-1111-4111-8111-555555555555',inputDir=join(stateRoot,'project-inputs',projectId);mkdirSync(inputDir,{recursive:true});
  const put=(value:unknown):PelArtifactRefV1=>{const bytes=pelAuthorityFileBytes(value),sha256=sha256Hex(bytes),ref={artifactId:`sha256-${sha256}`,sha256,byteLength:bytes.length};writeFileSync(join(inputDir,ref.artifactId),bytes,{mode:0o600});return ref;};
  const scope:PelProjectAuthorityV1={schemaVersion:1,repository:location.repository,stateRoot,workspaceGrants:[{grantId:'workspace',repository:location.repository,worktreeId:'main',canonicalRoot:cwd,directoryIdentity:`${info.dev}:${info.ino}`,immutableBase:base,writablePaths:['src']}],taskActions:{implement:'implement'},gates:{},destinations:{}};
  const authorityRef=put(scope),snapshot=createDefaultAuthoringSnapshotV1(),now=Math.floor(Date.now()/1000)*1000,iso=(n:number)=>new Date(n).toISOString().replace('.000Z','Z');
  const contract:ExecutionContractV1={schemaVersion:1,contractId:'preflight-fixture-contract',packageId:'fixture',objectiveSha256:'a'.repeat(64),acceptanceSha256:'b'.repeat(64),baseCommit:base,allowedPathsSha256:pelV1AllowedPathsSha256(scope.workspaceGrants),dependencyContractIds:[],authorizationSha256:authorityRef.sha256,createdAt:iso(now),deadlineAt:iso(now+strictEndstopLimits.wallTimeMs),limits:strictEndstopLimits,requiredMilestones:['checks']};
  await Effect.runPromise(Effect.flatMap(EndstopLedger,p=>p.create(contract)).pipe(Effect.provide(makeLiveEndstopLedgerLayer(stateRoot))));
  const project:ForemanProjectV1={schemaVersion:1,projectId,repository:location.repository,stateRoot,authorityRefs:[{kind:'v1',authoritySha256:authorityRef.sha256,authorityRef}],executionContractTemplate:put(contract),authoringSnapshot:put(snapshot),runtimeHandlerVersion:'1',limits:{execution:strictEndstopLimits,pel:snapshot.limits,maxConcurrentEffects:1,maxInputTokens:100,maxOutputTokens:100,maxToolCalls:10,maxOutputBytes:65536,maxCostUsd:1,cancellationObservationMs:100,maxReplayReductions:10000},requiredMilestones:['checks'],workspaces:{poolRoot:cwd,immutableBase:base,grants:scope.workspaceGrants,maxWorktrees:1,maxRaceContenders:1},gates:{},destinations:{},roleBindings:snapshot.roleBindings,taskActions:scope.taskActions,nlConditionProfile:null,dependencyMode:'ordered',resultContract:{schemaId:'schema:delivery-final-v1',schemaSha256:hashAuthoringContent(snapshot.registry.dataSchemas['schema:delivery-final-v1']),classification:'delivery-v1'}};
  const api=makeLivePelLifecycleServices({cwd,foremanHome:home,userHome:home,environment:{PATH:process.env.PATH},output:{stdout:()=>Effect.void,stderr:()=>Effect.void}});await Effect.runPromise(api.configure(pelAuthorityFileBytes(project)));
  if(variant!=='missing-evidence'){mkdirSync(join(stateRoot,'providers'));writeFileSync(join(stateRoot,'providers/evidence.json'),JSON.stringify({schemaVersion:1,evidence:[]}));}
  const selection=variant==='unsupported-native'?':model "claude-opus-5" :transport "claude-code"':variant==='api-task'?':model "grok-4.6" :transport "xai-responses"':variant==='ambiguous-selection'?':model "role:implementer" :transport "codex-app-server"':':model "role:implementer"';
  const source=join(cwd,'task.pel');writeFileSync(source,`(fm/task :id "implement" ${selection} :input "artifact:approved-spec" :output "schema:candidate-v1")`);
  const beforeRuns=existsSync(join(stateRoot,'runs'))?readdirSync(join(stateRoot,'runs')):[];
  const run=spawnSync(process.execPath,[entry,'run',source,'--json'],{cwd,env:{PATH:process.env.PATH,HOME:home,FOREMAN_HOME:home},encoding:'utf8',timeout:20000});assert.equal(run.status,2,run.stdout+run.stderr);assert.doesNotMatch(run.stderr,/run-started/);const result=JSON.parse(run.stdout);assert.equal(result.outcome,'invalid');if(variant==='unsupported-native')assert.match(run.stdout,/cannot enforce/);if(variant==='api-task')assert.match(run.stdout,/native coding/);if(variant==='missing-evidence')assert.match(run.stdout,/evidence|capability/i);
  assert.deepEqual(existsSync(join(stateRoot,'runs'))?readdirSync(join(stateRoot,'runs')):[],beforeRuns);const state=await Effect.runPromise(Effect.flatMap(EndstopLedger,p=>p.status(contract.contractId)).pipe(Effect.provide(makeLiveEndstopLedgerLayer(stateRoot))));assert.equal(state.counts.totalActions,0);assert.equal(execFileSync('/usr/bin/git',['-C',cwd,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),base);
 }finally{rmSync(root,{recursive:true,force:true});}
});
