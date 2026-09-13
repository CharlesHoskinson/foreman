import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,statSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {hashAuthoringContent,canonicalAuthoringJson} from '@foreman/pel';
import {createHash} from 'node:crypto';
import {createDefaultAuthoringSnapshotV1} from './pel-host-descriptors.js';
import {strictEndstopLimits} from './execution-contract.js';
import type {ForemanProjectV1} from './pel-run-contract.js';
import {makeLivePelProjectServices,resolvePelRepository} from './pel-project-live.js';
import {pelRunnerFailure} from './pel-runner.js';
async function fixture() {
 const root=mkdtempSync(join(tmpdir(),'pel-project-live-')),cwd=join(root,'repo'),stateRoot=join(root,'state'),foremanHome=join(root,'home');
 for(const dir of [cwd,stateRoot,foremanHome])mkdirSync(dir);execFileSync('git',['init','-q',cwd]);
 const location=await Effect.runPromise(resolvePelRepository(cwd));const info=statSync(cwd);
 const snapshot=createDefaultAuthoringSnapshotV1(),projectId='11111111-1111-4111-8111-111111111111';
 const bytes=Buffer.from('existing registered authority');const sha256=createHash('sha256').update(bytes).digest('hex');
 const ref={artifactId:`sha256-${sha256}`,byteLength:bytes.length,sha256};
 const project:ForemanProjectV1={schemaVersion:1,projectId,repository:location.repository,stateRoot,authorityRefs:[{kind:'v1',authoritySha256:sha256,authorityRef:ref}],executionContractTemplate:ref,authoringSnapshot:ref,runtimeHandlerVersion:'1',limits:{execution:strictEndstopLimits,pel:snapshot.limits,maxConcurrentEffects:1,maxInputTokens:1000,maxOutputTokens:1000,maxToolCalls:0,maxOutputBytes:65536,maxCostUsd:1,cancellationObservationMs:100,maxReplayReductions:1000},requiredMilestones:[],workspaces:{poolRoot:cwd,immutableBase:'a'.repeat(40),maxWorktrees:1,maxRaceContenders:1,grants:[{grantId:'grant',repository:location.repository,worktreeId:'worktree',canonicalRoot:cwd,directoryIdentity:`${info.dev}:${info.ino}`,immutableBase:'a'.repeat(40),writablePaths:['.']}]},gates:{},destinations:{},roleBindings:{},taskActions:{},nlConditionProfile:null,dependencyMode:'ordered',resultContract:{schemaId:'schema:pel-data-v1',schemaSha256:hashAuthoringContent(snapshot.registry.dataSchemas['schema:pel-data-v1']),classification:'generic'}};
 const inputs=join(stateRoot,'project-inputs',projectId);mkdirSync(inputs,{recursive:true});writeFileSync(join(inputs,ref.artifactId),bytes);
 return {root,cwd,stateRoot,foremanHome,project,ref,bytes,inputs};
}
test('T-M4-001 configure verifies authority before writes and registers canonical checkout state without installation',async()=>{
 const f=await fixture();let validations=0;
 const service=makeLivePelProjectServices({cwd:f.cwd,foremanHome:f.foremanHome,validateAuthority:(project,read,readHash)=>Effect.gen(function*(){validations++;assert.deepEqual(yield* read(project.authorityRefs[0]!.authorityRef,1000),f.bytes);assert.deepEqual(yield* readHash(f.ref.sha256,1000),f.bytes);assert.equal((yield* Effect.either(readHash('../secret',1000)))._tag,'Left');assert.equal((yield* Effect.either(readHash(f.ref.sha256,1)))._tag,'Left');})});
 try{const configured=await Effect.runPromise(service.configure(Buffer.from(canonicalAuthoringJson(f.project))));assert.equal(validations,1);assert.deepEqual(configured,f.project);assert.deepEqual(await Effect.runPromise(service.read()),f.project);assert.deepEqual(await Effect.runPromise(service.input.read({projectId:f.project.projectId,repository:f.project.repository,stateRoot:f.stateRoot},f.ref,1000)),f.bytes);assert.equal(JSON.parse(readFileSync(join(f.foremanHome,'projects.json'),'utf8')).projects[0].store_location,f.stateRoot);}finally{rmSync(f.root,{recursive:true,force:true});}
});
test('T-M4-001 denied authority and foreign state overrides leave configuration absent',async()=>{
 const f=await fixture();const service=makeLivePelProjectServices({cwd:f.cwd,foremanHome:f.foremanHome,validateAuthority:()=>Effect.fail(pelRunnerFailure('binding-mismatch','denied'))});
 try{assert.equal((await Effect.runPromise(Effect.either(service.configure(Buffer.from(canonicalAuthoringJson(f.project))))))._tag,'Left');assert.throws(()=>readFileSync(join(f.project.repository.gitCommonDir,'foreman','project.json')));assert.throws(()=>readFileSync(join(f.foremanHome,'projects.json')));assert.equal((await Effect.runPromise(Effect.either(service.read('/tmp/foreign'))))._tag,'Left');}finally{rmSync(f.root,{recursive:true,force:true});}
});
test('T-M4-017 registered input rejects traversal, symlink aliases, length mismatch and changed hashes',async()=>{
 const f=await fixture();const service=makeLivePelProjectServices({cwd:f.cwd,foremanHome:f.foremanHome,validateAuthority:()=>Effect.void});
 try{await Effect.runPromise(service.configure(Buffer.from(canonicalAuthoringJson(f.project))));const context={projectId:f.project.projectId,repository:f.project.repository,stateRoot:f.stateRoot};for(const ref of [{...f.ref,artifactId:'../secret'},{...f.ref,byteLength:f.ref.byteLength+1},{...f.ref,sha256:'b'.repeat(64)}])assert.equal((await Effect.runPromise(Effect.either(service.input.read(context,ref,1000))))._tag,'Left');rmSync(join(f.inputs,f.ref.artifactId));symlinkSync(join(f.root,'secret'),join(f.inputs,f.ref.artifactId));writeFileSync(join(f.root,'secret'),f.bytes);assert.equal((await Effect.runPromise(Effect.either(service.input.read(context,f.ref,1000))))._tag,'Left');}finally{rmSync(f.root,{recursive:true,force:true});}
});
test('linked worktrees read one common-dir configuration and denied reconfiguration preserves its bytes',async()=>{
 const f=await fixture();const first=makeLivePelProjectServices({cwd:f.cwd,foremanHome:f.foremanHome,validateAuthority:()=>Effect.void});
 try{
  await Effect.runPromise(first.configure(Buffer.from(canonicalAuthoringJson(f.project))));
  execFileSync('git',['-C',f.cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','initial']);
  const linked=join(f.root,'linked');execFileSync('git',['-C',f.cwd,'worktree','add','--detach',linked,'HEAD'],{stdio:'pipe'});
  const location=await Effect.runPromise(resolvePelRepository(linked));assert.deepEqual(location.repository,f.project.repository);
  const second=makeLivePelProjectServices({cwd:linked,foremanHome:f.foremanHome,validateAuthority:()=>Effect.fail(pelRunnerFailure('binding-mismatch','denied reconfigure'))});
  assert.deepEqual(await Effect.runPromise(second.read()),f.project);
  const settingsPath=join(f.project.repository.gitCommonDir,'foreman','project.json'),before=readFileSync(settingsPath),registry=readFileSync(join(f.foremanHome,'projects.json'));
  assert.equal((await Effect.runPromise(Effect.either(second.configure(Buffer.from(canonicalAuthoringJson({...f.project,limits:{...f.project.limits,maxConcurrentEffects:2}}))))))._tag,'Left');
  assert.deepEqual(readFileSync(settingsPath),before);assert.deepEqual(readFileSync(join(f.foremanHome,'projects.json')),registry);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('foreign Git workspaces and replaced directories fail before authority validation',async()=>{
 const f=await fixture();let validations=0;const service=makeLivePelProjectServices({cwd:f.cwd,foremanHome:f.foremanHome,validateAuthority:()=>Effect.sync(()=>{validations++;})});
 try{
  const foreign=join(f.root,'foreign');mkdirSync(foreign);execFileSync('git',['init','-q',foreign]);const info=statSync(foreign);
  const changed={...f.project,workspaces:{...f.project.workspaces,grants:[{...f.project.workspaces.grants[0],canonicalRoot:foreign,directoryIdentity:`${info.dev}:${info.ino}`} ]}};
  assert.equal((await Effect.runPromise(Effect.either(service.configure(Buffer.from(canonicalAuthoringJson(changed))))))._tag,'Left');assert.equal(validations,0);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('hash-only registered reads enforce registration, digest, bound, and nofollow identity',async()=>{
 const f=await fixture(),service=makeLivePelProjectServices({cwd:f.cwd,foremanHome:f.foremanHome,validateAuthority:()=>Effect.void});
 try{
  assert.equal((await Effect.runPromise(Effect.either(service.readHash(f.project,f.ref.sha256,1000))))._tag,'Left');
  await Effect.runPromise(service.configure(Buffer.from(canonicalAuthoringJson(f.project))));
  assert.deepEqual(await Effect.runPromise(service.readHash(f.project,f.ref.sha256,1000)),f.bytes);
  assert.equal((await Effect.runPromise(Effect.either(service.readHash(f.project,f.ref.sha256,1))))._tag,'Left');
  writeFileSync(join(f.inputs,f.ref.artifactId),Buffer.from('changed bytes'));
  assert.equal((await Effect.runPromise(Effect.either(service.readHash(f.project,f.ref.sha256,1000))))._tag,'Left');
  rmSync(join(f.inputs,f.ref.artifactId));writeFileSync(join(f.root,'authority'),f.bytes);symlinkSync(join(f.root,'authority'),join(f.inputs,f.ref.artifactId));
  assert.equal((await Effect.runPromise(Effect.either(service.readHash(f.project,f.ref.sha256,1000))))._tag,'Left');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
