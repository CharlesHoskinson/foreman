import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect, Stream, Deferred } from 'effect';
import { sha256Hex } from '@foreman/core';
import { RunJournal } from '@foreman/event-log';
import type { PelDataValue } from '@foreman/pel';
import type { ProviderTransport } from '@foreman/providers';
import { pelHostFixture } from './pel-host-test-fixture.js';
import { makePelHostLibraryServices } from './pel-host-library.js';
import { makePelTaskHandler } from './pel-host-task.js';
import { PelRuntime, type PelRuntimePorts } from './pel-run-contract.js';
import { ProcessExec, liveProcessExec } from './queue-services.js';
import { makeLiveRunLease } from './supervisor-live-services.js';
import { makePelControlHandlers } from './pel-control-functions.js';
import { runProgram, withPelRunOwner } from './pel-runner.js';
import { resumeProgram, readPelArtifactJson } from './pel-recovery.js';
import { pelHash, pelFailure, readPelRecords, replayPelRun } from './pel-journal.js';
import { pelHostField, readPelHostEvidenceRecords, loadPelHostEvidence, projectPelHostReceiptEvidence } from './pel-host-evidence.js';
const text = (value: string): PelDataValue => ({ tag: 'string', value });
const assoc = (fields: Record<string, PelDataValue>): PelDataValue => ({ tag: 'list', items: Object.entries(fields).map(([key,value]) => ({tag:'pair',key,value})) });
const task = '(fm/task :id "implement" :model "role:implementer" :input "artifact:approved-spec" :output "schema:candidate-v1")';
for(const mode of ['fresh','winner-recovery','verify-recovery','nested-retry','nested-race','unselected-check','unselected-publication'] as const) test(`candidate race ${mode} promotes only durable winner and preserves selected workspace`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'pel-candidate-race-')), repo=join(root,'repo');mkdirSync(repo);
 const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();git('init','-q');git('config','user.email','fixture@invalid');git('config','user.name','fixture');mkdirSync(join(repo,'src'));writeFileSync(join(repo,'src/main.ts'),'base\n');git('add','.');git('commit','-qm','base');
 const base=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}'), common=join(repo,'.git'),ci=statSync(common),repository={gitCommonDir:common,identitySha256:pelHash({gitCommonDir:common,directoryIdentity:`${ci.dev}:${ci.ino}`})};
 const other=join(root,'other');git('worktree','add','--detach',other,base);
 const grants=[repo,other].map((canonicalRoot,index)=>({grantId:`grant-${index}`,repository,worktreeId:`worktree-${index}`,canonicalRoot,directoryIdentity:`${statSync(canonicalRoot).dev}:${statSync(canonicalRoot).ino}`,immutableBase:base,writablePaths:['src']}));
 const blocked=mode.startsWith('unselected-');
 const body=mode==='nested-retry'?`(fm/retry :attempts 1 :on [':transport-disconnected] :body (lambda [] ${task}))`:mode==='unselected-publication'?`${task} |> (fm/publish :id "inside" :input ^ :destination "destination:local")`:mode==='unselected-check'?`${task} |> (fm/verify :id "inside" :input ^ :gate "candidate-full")`:task;
 const race=`(fm/race :tasks [(lambda [] ${body}) (lambda [] ${body})] :winner "first-valid")`;
 const outer=mode==='nested-race'?`(fm/race :tasks [(lambda [] ${race})] :winner "first-valid")`:race;
 const source=blocked?outer:`(def chosen ${outer}) (fm/verify :id "verify" :input ${mode==='nested-race'?"((chosen :at ':value) :at ':value)":"(chosen :at ':value)"} :gate "candidate-full")`;
 const f=pelHostFixture(source,{workspace:grants[0]!,grants,maxConcurrentEffects:2,taskActions:{implement:'implement'},requiredMilestones:['checks'],gates:{'candidate-full':{argv:['/usr/bin/git','diff','--check'],environmentRefs:[],environmentSha256:pelHash({}),maxOutputBytes:4096,timeoutMs:5000}}});
 try {await Effect.runPromise(f.provide(Effect.gen(function*(){
  const fixture=yield* f.setup,journal=yield* RunJournal,process=yield* ProcessExec,runtime:PelRuntimePorts=fixture.runtime,context=fixture.context;
  const ledger=fixture.ledger;let gateRoot:string|null=null, gateRuns=0, starts=0,promotions=0,commits=0;
  const allocations=runtime.resources.allocateContenders;Object.assign(runtime,{resources:{...runtime.resources,allocateContenders:(...args:Parameters<typeof allocations>)=>allocations(...args).pipe(Effect.map(grants=>[...grants].reverse()))}});
  const processExec:ProcessExec['Type']={...process,runCaptured:input=>{if(input.args.includes('--check')){gateRoot=input.cwd??null;gateRuns++;}return process.runCaptured(input);}};
  const library=makePelHostLibraryServices({journal,ledger,processExec,runtime:()=>runtime,transportVersion:()=>Effect.succeed('fixture-v1')});
  const ready=yield* Deferred.make<void>();let registered=0;
  const handler=makePelTaskHandler({resolveInput:library.resolveTaskInput,nativePolicy:()=>Effect.succeed({permissionGrantIds:['fixture'],hostPermissionPortRef:'fixture'}),transportVersion:()=>Effect.succeed('fixture-v1'),actionCandidate:()=>Effect.succeed({commit:base,tree,candidateSha256:sha256Hex(base)}),recordImplementation:(candidate,ref,receipt,receiptRef,host)=>Effect.gen(function*(){yield* library.recordImplementation(candidate,ref,receipt,receiptRef,host);assert.equal((yield* ledger.status(context.binding.contractId)).currentCandidateSha256,sha256Hex(base),'Contender must not promote shared candidate');registered++;if(registered===2)yield* Deferred.succeed(ready,undefined);else yield* Deferred.await(ready);}).pipe(Effect.mapError(()=>pelFailure('binding-mismatch','Fixture ledger read failed')))});
  const provider:ProviderTransport={id:'grok-acp',version:'fixture-v1',start:request=>Effect.sync(()=>{starts++;assert.ok(request.limits.maxInputTokens<=500);const grant=grants.find(grant=>request.toolPolicy.mode==='native-coding'&&request.toolPolicy.workspaceGrantId===grant.grantId)!;assert.ok(grant);writeFileSync(join(grant.canonicalRoot,'src/main.ts'),`${grant.grantId}\n`);const value=assoc({summary:text(grant.grantId),claimedPaths:{tag:'list',items:[text('src/main.ts')]},findings:{tag:'list',items:[]}});return Stream.make({schemaVersion:1,effectId:request.effectId,providerIdentity:{kind:'native',provider:'xai',profileId:request.profileId,transportId:request.transportId,credentialProfileRef:request.credentialProfileRef,protocolVersion:'fixture-v1',sessionId:grant.grantId},payload:{type:'completed',result:{schemaId:request.outputSchema.id,value,json:{},schemaSha256:pelHash(request.outputSchema.content),byteLength:100},usage:{inputTokens:10,outputTokens:5,costUsd:'0.01',providerCounters:{}}}} as const);}),probe:()=>Effect.die('unexpected probe'),resume:()=>Effect.die('unexpected resume'),cancel:()=>Effect.die('unexpected cancel'),observe:()=>Effect.die('unexpected observe'),sendToolResult:()=>Effect.die('unexpected tools')};
  Object.assign(runtime,{handlers:new Map([['fm/task',handler],['fm/verify',library.verification],['fm/review',library.review],['fm/publish',library.publication]]),controls:makePelControlHandlers(),workspaceForHostRequest:library.workspaceForHostRequest,commitRaceWinner:(...args:Parameters<typeof library.commitRaceWinner>)=>Effect.gen(function*(){commits++;if(mode==='winner-recovery'&&commits===1)return yield* Effect.fail(pelFailure('journal-write-failed','Injected crash after committed winner before promotion'));const before=(yield* ledger.status(context.binding.contractId)).currentCandidateSha256;yield* library.commitRaceWinner(...args);if((yield* ledger.status(context.binding.contractId)).currentCandidateSha256!==before)promotions++;}).pipe(Effect.mapError(error=>'diagnostic' in error?error:pelFailure('binding-mismatch','Fixture ledger read failed'))),providers:{...runtime.providers,resolve:()=>Effect.succeed({transport:provider})},loadRunInputs:()=>Effect.succeed({binding:context.binding,project:context.project,contract:fixture.contract,snapshot:context.checked.snapshot,registry:context.checked.snapshot.registry}),hostEvidence:()=>Effect.gen(function*(){const state=yield* ledger.status(context.binding.contractId);return {...(yield* projectPelHostReceiptEvidence(context.binding,state.currentCandidateSha256)),milestones:state.milestones.checks?['checks' as const]:[]};}).pipe(Effect.provideService(PelRuntime,runtime),Effect.provideService(RunJournal,journal))});
  if(mode==='verify-recovery'){const artifacts=runtime.artifacts;let injected=false;Object.assign(runtime,{artifacts:{...artifacts,put:(...args:Parameters<typeof artifacts.put>)=>{if(!injected&&Buffer.from(args[1]).toString('utf8').includes('"kind":"verification"')){injected=true;return Effect.fail(pelFailure('journal-write-failed','Injected crash after gate report before receipt'));}return artifacts.put(...args);}}});}
  yield* Effect.gen(function*(){
   const first=yield* runProgram(context.checked,context.binding).pipe(Effect.either);
   if(blocked){assert.equal(first._tag,'Left');if(first._tag==='Left')assert.match(first.left.diagnostic.message,/committed race winner/);assert.equal(starts,2);assert.equal(gateRoot,null);const state=yield* ledger.status(context.binding.contractId);assert.equal(state.currentCandidateSha256,sha256Hex(base));assert.equal(state.counts.verify,0);assert.equal(state.counts.audit,0);assert.equal(state.counts.publish,0);assert.equal(promotions,0);return;}
   if(mode.endsWith('-recovery'))assert.equal(first._tag,'Left','Crash injection must interrupt the original owner');
   const result=mode.endsWith('-recovery')?yield* withPelRunOwner(context.binding,owner=>resumeProgram(context.binding.runId,{binding:context.binding,project:context.project,contract:fixture.contract,snapshot:context.checked.snapshot,registry:context.checked.snapshot.registry,owner})):first._tag==='Right'?first.right:null;
   assert.ok(result,JSON.stringify(first));assert.equal(starts,2,JSON.stringify(result));
   assert.equal(result.state,'succeeded',JSON.stringify(result));assert.equal(gateRuns,1);assert.equal(promotions,1);assert.equal(commits,mode==='winner-recovery'||mode==='nested-race'?2:1);
   const state=yield* ledger.status(context.binding.contractId);assert.equal(state.counts.implement,2);assert.equal(state.counts.verify,1);assert.ok(state.currentCandidateSha256);
   const evidence=yield* readPelHostEvidenceRecords(context),verificationEntry=evidence.entries.find(entry=>entry.kind==='verification')!;
   const verification=yield* loadPelHostEvidence(verificationEntry.ref,'verification',context);assert.equal(verification.kind,'verification');if(verification.kind!=='verification')throw Error('verification');
   assert.equal(verification.candidate.candidateSha256,state.currentCandidateSha256);
   for(const entry of evidence.entries.filter(entry=>entry.kind==='implementation')){
    const implementation=yield* loadPelHostEvidence(entry.ref,'implementation',context);if(implementation.kind!=='implementation'||!implementation.candidateRef)continue;
    const candidate=yield* readPelArtifactJson(context.binding.runId,implementation.candidateRef);assert.ok(candidate&&typeof candidate==='object'&&'candidateSha256' in candidate);
    if(candidate.candidateSha256!==state.currentCandidateSha256){const denied=yield* library.workspaceForHostRequest({...fixture.request,registryId:'fm/verify',boundArguments:{input:text(`artifact:${implementation.candidateRef.artifactId}`)}},context).pipe(Effect.either);assert.equal(denied._tag,'Left');if(denied._tag==='Left')assert.match(denied.left.diagnostic.message,/committed race winner/);}
   }
   const replay=replayPelRun(yield* readPelRecords(context.binding.runId));assert.ok(replay.ok);assert.equal(replay.value.records.filter(record=>record.type==='pel.race.decision.v1').length,mode==='nested-race'?2:1);
   const captured=yield* readPelArtifactJson(context.binding.runId,verification.candidateRef);assert.ok(captured&&typeof captured==='object'&&'workspaceGrantId' in captured);assert.equal(gateRoot,grants.find(grant=>grant.grantId===captured.workspaceGrantId)?.canonicalRoot);assert.equal(git('rev-parse','HEAD'),base);
  }).pipe(Effect.provideService(PelRuntime,runtime));
 }).pipe(Effect.provide(liveProcessExec),Effect.provide(makeLiveRunLease(f.root)))));}finally{f.close();rmSync(root,{recursive:true,force:true});}
});
