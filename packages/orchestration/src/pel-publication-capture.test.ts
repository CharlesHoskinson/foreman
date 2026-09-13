import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {writeFileSync,statSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Effect} from 'effect';
import {canonicalize,sha256Hex} from '@foreman/core';
import {pelHostFixture} from './pel-host-test-fixture.js';
import {PelRuntime} from './pel-run-contract.js';
import {ProcessExec,liveProcessExec} from './queue-services.js';
import {inspectPelCandidate,capturePelCandidate} from './pel-candidate-capture.js';
import {makePelPublicationService} from './pel-publication-service.js';
import type {CandidateRefV1} from './pel-host-contract.js';
test('publication validates synthetic captured worktree without moving HEAD or index and rejects later mutation',async()=>{
 const f=pelHostFixture('(print 1)'),repo=join(f.root,'repo'),git=(...args:string[])=>execFileSync('git',args,{cwd:f.root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git('init','-q',repo);git('-C',repo,'config','user.name','fixture');git('-C',repo,'config','user.email','fixture@example.invalid');writeFileSync(join(repo,'file.ts'),'export const n=1;\n');git('-C',repo,'add','.');git('-C',repo,'commit','-qm','base');const base=git('-C',repo,'rev-parse','HEAD'),index=readFileSync(join(repo,'.git/index'));
 try{await Effect.runPromise(f.provide(Effect.gen(function*(){const x=yield* f.setup,processExec=yield* ProcessExec,info=statSync(repo),repository={gitCommonDir:join(repo,'.git'),identitySha256:sha256Hex(canonicalize({gitCommonDir:join(repo,'.git'),directoryIdentity:`${statSync(join(repo,'.git')).dev}:${statSync(join(repo,'.git')).ino}`}))},workspace={...x.context.workspace,repository,canonicalRoot:repo,directoryIdentity:`${info.dev}:${info.ino}`,immutableBase:base},context={...x.context,workspace,binding:{...x.context.binding,repository},project:{...x.context.project,repository}};
  const work=Effect.gen(function*(){const before=yield* inspectPelCandidate(context);writeFileSync(join(repo,'file.ts'),'export const n=2;\n');const captured=yield* capturePelCandidate(before,context);assert.ok(captured.commit&&captured.tree&&captured.treeDigest);const candidate:CandidateRefV1={schemaVersion:1,repository,workspaceGrantId:workspace.grantId,baseCommit:base,commit:captured.commit,tree:captured.tree,candidateSha256:sha256Hex(captured.commit),treeDigest:captured.treeDigest,diffDigest:captured.diffRef.sha256,allowedPathsSha256:captured.allowedPathsSha256,artifactManifestSha256:captured.artifactManifestSha256,manifestRef:captured.manifestRef,diffRef:captured.diffRef,producingAttempt:captured.attempt,producingEffectId:captured.effectId},candidateRef=yield* x.put(candidate),ref=yield* x.put({fixture:'authority'}),destination={operation:'publish' as const,repositoryIdentitySha256:repository.identitySha256,remoteIdentity:join(f.root,'remote.git'),ref:'refs/heads/reviewed',expectedOldObject:{kind:'exact' as const,oid:base},authorityRef:ref},bound={...context,project:{...context.project,destinations:{reviewed:destination}}},input={destinationId:'reviewed',candidate:{commit:candidate.commit,tree:candidate.tree,candidateSha256:candidate.candidateSha256},evidenceRefs:[candidateRef],integrationReceiptRef:null};
   const service=makePelPublicationService({ledger:x.ledger,processExec,readAuthority:()=>Effect.die('V1 has no publication authority'),validateEvidence:()=>Effect.void,resolveCapturedCandidate:()=>Effect.succeed(candidate)});
   const first=yield* service.prepare(input,bound);assert.equal(first.kind,'needs-action');assert.notEqual(candidate.commit,base);assert.equal(git('-C',repo,'rev-parse','HEAD'),base);assert.deepEqual(readFileSync(join(repo,'.git/index')),index);assert.equal(git('-C',repo,'show',`${candidate.commit}:file.ts`),'export const n=2;');
   writeFileSync(join(repo,'file.ts'),'changed after capture');const changed=yield* Effect.either(service.prepare(input,bound));assert.equal(changed._tag,'Left');if(changed._tag==='Left')assert.equal(changed.left.code,'candidate-changed');
  });yield* work.pipe(Effect.provideService(PelRuntime,x.runtime));
 })).pipe(Effect.provide(liveProcessExec)));}finally{f.close();}
});
