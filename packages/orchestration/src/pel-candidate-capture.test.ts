import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync,symlinkSync,chmodSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {sha256Hex} from '@foreman/core';
import type {CandidateRefV1} from './pel-host-contract.js';
import {hashAuthoringContent} from '@foreman/pel';
import {makeLivePelArtifactPort} from './pel-journal.js';
import {PelRuntime,type HostContextV1,type PelRuntimePorts} from './pel-run-contract.js';
import {liveProcessExec} from './queue-services.js';
import {inspectPelCandidate,capturePelCandidate,observePelCapturedCandidate} from './pel-candidate-capture.js';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'pel-candidate-')),repo=join(root,'repo'),state=join(root,'state');mkdirSync(repo);mkdirSync(state);mkdirSync(join(repo,'src'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
 git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','fixture');writeFileSync(join(repo,'src/main.ts'),'export const n = 1;\n');writeFileSync(join(repo,'src/delete.ts'),'delete me\n');git('add','.');git('commit','-qm','base');
 const common=join(repo,'.git'),info=statSync(repo),commonInfo=statSync(common),repository={gitCommonDir:common,identitySha256:hashAuthoringContent({gitCommonDir:common,directoryIdentity:`${commonInfo.dev}:${commonInfo.ino}`})};
 const context={workspace:{grantId:'grant',worktreeId:'worktree',canonicalRoot:repo,directoryIdentity:`${info.dev}:${info.ino}`,repository,immutableBase:git('rev-parse','HEAD'),writablePaths:['src']},binding:{runId:'candidate-run',repository,limits:{deadline:Date.now()+60000,maxOutputBytes:1048576}},effect:{effectId:'candidate-effect',attempt:{runId:'candidate-run',laneId:'pel',attemptId:1}}} as unknown as HostContextV1;
 const runtime={artifacts:makeLivePelArtifactPort(state),clock:{now:Effect.sync(Date.now),sleep:Effect.sleep}} as PelRuntimePorts;
 const run=<A,E>(effect:Effect.Effect<A,E,PelRuntime|import('./queue-services.js').ProcessExec|import('effect').Scope.Scope>)=>Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(liveProcessExec),Effect.provideService(PelRuntime,runtime)));
 return {root,repo,git,context,run,close:()=>rmSync(root,{recursive:true,force:true})};
}
test('T-M5-001 captures observed dirty bytes, untracked files, deletion, symlink and mode without moving HEAD or index',async()=>{
 const f=fixture();try{const before=await f.run(inspectPelCandidate(f.context)),head=f.git('rev-parse','HEAD'),branch=f.git('symbolic-ref','HEAD'),index=readFileSync(join(f.repo,'.git/index'));
  writeFileSync(join(f.repo,'src/main.ts'),'export const n = 2;\n');writeFileSync(join(f.repo,'src/new.ts'),'new data\n');unlinkSync(join(f.repo,'src/delete.ts'));symlinkSync('main.ts',join(f.repo,'src/link'));chmodSync(join(f.repo,'src/main.ts'),0o755);
  const captured=await f.run(capturePelCandidate(before,f.context));assert.equal(captured.status,'candidate-ready');assert.ok(captured.commit);assert.deepEqual(captured.changedPaths,['src/delete.ts','src/link','src/main.ts','src/new.ts']);assert.equal(f.git('show',`${captured.commit}:src/main.ts`),'export const n = 2;');assert.equal(f.git('show',`${captured.commit}:src/new.ts`),'new data');assert.match(f.git('ls-tree',captured.commit,'src/link'),/^120000 blob/);assert.match(f.git('ls-tree',captured.commit,'src/main.ts'),/^100755 blob/);assert.equal(f.git('ls-tree',captured.commit,'src/delete.ts'),'');
  assert.equal(f.git('rev-parse','HEAD'),head);assert.equal(f.git('symbolic-ref','HEAD'),branch);assert.deepEqual(readFileSync(join(f.repo,'.git/index')),index);
  const repeated=await f.run(capturePelCandidate(before,f.context));assert.equal(repeated.commit,captured.commit);assert.deepEqual(repeated.manifestRef,captured.manifestRef);
  const candidate:CandidateRefV1={schemaVersion:1,repository:captured.repository,workspaceGrantId:captured.workspaceGrantId,baseCommit:captured.baseCommit,commit:captured.commit,tree:captured.tree!,candidateSha256:sha256Hex(captured.commit),treeDigest:captured.treeDigest!,diffDigest:captured.diffRef.sha256,allowedPathsSha256:captured.allowedPathsSha256,artifactManifestSha256:captured.artifactManifestSha256,manifestRef:captured.manifestRef,diffRef:captured.diffRef,producingAttempt:captured.attempt,producingEffectId:captured.effectId};
  assert.equal(await f.run(observePelCapturedCandidate(candidate,{...f.context,effect:{...f.context.effect,effectId:'verification'}})),captured.observationRef.sha256);
  writeFileSync(join(f.repo,'src/main.ts'),'changed after capture');const mutation=await f.run(observePelCapturedCandidate(candidate,f.context).pipe(Effect.either));assert.equal(mutation._tag,'Left');if(mutation._tag==='Left')assert.equal(mutation.left.code,'candidate-changed');
 }finally{f.close();}
});
test('T-M5-002 observes forbidden paths and refuses candidate promotion with retained evidence',async()=>{
 const f=fixture();try{const before=await f.run(inspectPelCandidate(f.context));writeFileSync(join(f.repo,'escape.ts'),'not admitted');const result=await f.run(capturePelCandidate(before,f.context).pipe(Effect.either));assert.equal(result._tag,'Left');if(result._tag==='Left'){assert.equal(result.left.code,'candidate-out-of-scope');assert.ok(result.left.cause);}}finally{f.close();}
});
test('T-M5-001 no-op has no invented candidate and preserves preexisting staged index',async()=>{
 const f=fixture();try{writeFileSync(join(f.repo,'src/main.ts'),'staged\n');f.git('add','src/main.ts');const index=readFileSync(join(f.repo,'.git/index'));const before=await f.run(inspectPelCandidate(f.context));const result=await f.run(capturePelCandidate(before,f.context));assert.equal(result.status,'no-change');assert.equal(result.commit,null);assert.deepEqual(readFileSync(join(f.repo,'.git/index')),index);}finally{f.close();}
});
test('T-M5-002 rejects escaping symlinks and changed Git HEAD',async()=>{
 const f=fixture();try{const before=await f.run(inspectPelCandidate(f.context));symlinkSync('/etc/passwd',join(f.repo,'src/escape'));const escaped=await f.run(capturePelCandidate(before,f.context).pipe(Effect.either));assert.equal(escaped._tag,'Left');if(escaped._tag==='Left')assert.equal(escaped.left.code,'candidate-out-of-scope');unlinkSync(join(f.repo,'src/escape'));f.git('commit','--allow-empty','-qm','moved');const moved=await f.run(capturePelCandidate(before,f.context).pipe(Effect.either));assert.equal(moved._tag,'Left');if(moved._tag==='Left')assert.equal(moved.left.code,'candidate-changed');}finally{f.close();}
});

test('T-M5-002 ignored secrets and build output never enter candidate artifacts or mutation observations',async()=>{
 const f=fixture();try{writeFileSync(join(f.repo,'.git/info/exclude'),'.env\nnode_modules/\ndist/\n');writeFileSync(join(f.repo,'.env'),'IGNORED_SECRET_DO_NOT_RETAIN');mkdirSync(join(f.repo,'node_modules'));writeFileSync(join(f.repo,'node_modules/private'),'ignored dependency');
  const before=await f.run(inspectPelCandidate(f.context));assert.deepEqual(before.entries,[]);writeFileSync(join(f.repo,'src/main.ts'),'export const n = 2;\n');const captured=await f.run(capturePelCandidate(before,f.context));assert.ok(captured.commit);assert.equal(f.git('ls-tree','-r','--name-only',captured.commit).includes('.env'),false);assert.equal(f.git('ls-tree','-r','--name-only',captured.commit).includes('node_modules'),false);
  const observed=await f.run(inspectPelCandidate(f.context));mkdirSync(join(f.repo,'dist'));writeFileSync(join(f.repo,'dist/main.js'),'ignored gate output');const afterGate=await f.run(inspectPelCandidate(f.context));assert.deepEqual(afterGate.manifestRef,observed.manifestRef);
  const artifactFiles=await import('node:fs/promises').then(fs=>fs.readdir(join(f.root,'state/runs/candidate-run/artifacts')));assert.equal(artifactFiles.includes(`sha256-${sha256Hex('IGNORED_SECRET_DO_NOT_RETAIN')}`),false);
 }finally{f.close();}
});
test('T-M5-002 rejects preexisting local commits beyond the admitted immutable base before retaining candidate bytes',async()=>{
 const f=fixture();try{writeFileSync(join(f.repo,'outside.ts'),'unadmitted committed change');f.git('add','outside.ts');f.git('commit','-qm','outside original base');const observed=await f.run(inspectPelCandidate(f.context).pipe(Effect.either));assert.equal(observed._tag,'Left');if(observed._tag==='Left')assert.equal(observed.left.code,'candidate-changed');}finally{f.close();}
});
test('T-M5-002 refuses preexisting nonignored dirty content outside the admitted writable set',async()=>{
 const f=fixture();try{writeFileSync(join(f.repo,'preexisting.txt'),'unadmitted local content');const before=await f.run(inspectPelCandidate(f.context));writeFileSync(join(f.repo,'src/main.ts'),'export const n = 3;\n');const captured=await f.run(capturePelCandidate(before,f.context).pipe(Effect.either));assert.equal(captured._tag,'Left');if(captured._tag==='Left')assert.equal(captured.left.code,'candidate-out-of-scope');}finally{f.close();}
});
for(const flag of ['--skip-worktree','--assume-unchanged'])test(`T-M5-002 private candidate comparison detects tracked bytes hidden by ${flag}`,async()=>{
 const f=fixture();try{f.git('update-index',flag,'src/main.ts');const originalIndex=readFileSync(join(f.repo,'.git/index')),before=await f.run(inspectPelCandidate(f.context));writeFileSync(join(f.repo,'src/main.ts'),'export const n = 99;\n');assert.equal(f.git('diff','HEAD','--name-only'),'');const captured=await f.run(capturePelCandidate(before,f.context));assert.equal(captured.status,'candidate-ready');assert.ok(captured.commit);assert.equal(f.git('show',`${captured.commit}:src/main.ts`),'export const n = 99;');assert.deepEqual(readFileSync(join(f.repo,'.git/index')),originalIndex);}finally{f.close();}
});
test('T-M5-001 ordinary git status cache refresh and staging preserve candidate content identity',async()=>{
 const f=fixture();try{const before=await f.run(inspectPelCandidate(f.context)),oldIndex=readFileSync(join(f.repo,'.git/index'));const fs=await import('node:fs/promises');await fs.utimes(join(f.repo,'src/main.ts'),new Date(100000),new Date(100000));f.git('status','--porcelain');assert.notDeepEqual(readFileSync(join(f.repo,'.git/index')),oldIndex);assert.deepEqual((await f.run(inspectPelCandidate(f.context))).manifestRef,before.manifestRef);
  writeFileSync(join(f.repo,'src/main.ts'),'export const n = 2;\n');f.git('add','src/main.ts');const stagedIndex=readFileSync(join(f.repo,'.git/index'));const captured=await f.run(capturePelCandidate(before,f.context));assert.equal(captured.status,'candidate-ready');assert.deepEqual(readFileSync(join(f.repo,'.git/index')),stagedIndex);const capturedObservation=await f.run(inspectPelCandidate(f.context));f.git('reset','-q','HEAD','--','src/main.ts');assert.deepEqual((await f.run(inspectPelCandidate(f.context))).manifestRef,capturedObservation.manifestRef);
 }finally{f.close();}
});
test('T-M5-002 force-added ignored secrets remain excluded even with real index flags',async()=>{
 const f=fixture();try{writeFileSync(join(f.repo,'.git/info/exclude'),'.env\n');const before=await f.run(inspectPelCandidate(f.context));writeFileSync(join(f.repo,'.env'),'FORCE_ADDED_SECRET_NEVER_RETAIN');f.git('add','-f','.env');f.git('update-index','--assume-unchanged','.env');writeFileSync(join(f.repo,'src/main.ts'),'export const n = 2;\n');const index=readFileSync(join(f.repo,'.git/index')),captured=await f.run(capturePelCandidate(before,f.context));assert.ok(captured.commit);assert.equal(f.git('ls-tree','--name-only',captured.commit,'.env'),'');assert.deepEqual(captured.artifacts.map(a=>a.path),['src/main.ts']);assert.deepEqual(readFileSync(join(f.repo,'.git/index')),index);const fs=await import('node:fs/promises');assert.equal((await fs.readdir(join(f.root,'state/runs/candidate-run/artifacts'))).includes(`sha256-${sha256Hex('FORCE_ADDED_SECRET_NEVER_RETAIN')}`),false);}finally{f.close();}
});
test('T-M5-002 ambient Git ignore files cannot hide nonignored candidate bytes',async()=>{
 const f=fixture(),oldXdg=process.env.XDG_CONFIG_HOME;try{const xdg=join(f.root,'xdg');mkdirSync(join(xdg,'git'),{recursive:true});writeFileSync(join(xdg,'git/ignore'),'*.local.ts\n');process.env.XDG_CONFIG_HOME=xdg;const before=await f.run(inspectPelCandidate(f.context));writeFileSync(join(f.repo,'src/visible.local.ts'),'must be captured');const captured=await f.run(capturePelCandidate(before,f.context));assert.ok(captured.commit);assert.equal(f.git('show',`${captured.commit}:src/visible.local.ts`),'must be captured');}finally{if(oldXdg===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=oldXdg;f.close();}
});
test('T-M5-002 index flags cannot hide changed tracked bytes outside the write grant',async()=>{
 const f=fixture();try{writeFileSync(join(f.repo,'outside.ts'),'base content');f.git('add','outside.ts');f.git('commit','-qm','admitted base with protected file');const context={...f.context,workspace:{...f.context.workspace,immutableBase:f.git('rev-parse','HEAD')}};f.git('update-index','--skip-worktree','outside.ts');const before=await f.run(inspectPelCandidate(context));writeFileSync(join(f.repo,'outside.ts'),'forbidden hidden content');writeFileSync(join(f.repo,'src/main.ts'),'export const n = 2;\n');const index=readFileSync(join(f.repo,'.git/index')),captured=await f.run(capturePelCandidate(before,context).pipe(Effect.either));assert.equal(captured._tag,'Left');if(captured._tag==='Left')assert.equal(captured.left.code,'candidate-out-of-scope');assert.deepEqual(readFileSync(join(f.repo,'.git/index')),index);}finally{f.close();}
});
