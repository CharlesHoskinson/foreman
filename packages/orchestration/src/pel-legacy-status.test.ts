import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Effect} from 'effect';
import {RunJournal,makeLiveRunJournalLayer,type RunId} from '@foreman/event-log';
import {makeForemanCli} from './pel-authoring-cli.js';
import {makeLivePelLifecycleServices} from './pel-lifecycle-live.js';
import {registerProjectFileV1} from './project-registry.js';
import {RunLease} from './supervisor.js';
import {makeLiveRunLease} from './supervisor-live-services.js';

for(const mode of ['service','compiled']as const)test(`T-M6-009 ${mode} unified status reads active and terminal legacy identity without allocation or owner transfer`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'pel-legacy-status-')),cwd=join(root,'repo'),home=join(root,'home'),state=join(root,'state');
 try {
  for(const path of [cwd,home,state])mkdirSync(path);execFileSync('/usr/bin/git',['init','-q',cwd]);
  assert.equal(registerProjectFileV1(join(home,'projects.json'),{project_id:'11111111-1111-4111-8111-111111111111',operation_id:'22222222-2222-4222-8222-222222222222',git_common_dir:join(cwd,'.git'),worktree_path:cwd,store_backend:'sqlite',store_location:state})._tag,'Registered');
  const round=JSON.parse(readFileSync(new URL('./fixtures/pel-migration/implement-verify-review/round-v1.json',import.meta.url),'utf8')),runId=round.runId as RunId;
  await Effect.runPromise(Effect.gen(function*(){
   const journal=yield* RunJournal,leases=yield* RunLease;
   yield* journal.append(runId,{type:'prompt',lane:round.laneId,payload:{attempt:round.attemptId,roundPlan:round}});
   yield* journal.append(runId,{type:'ownership',lane:round.laneId,payload:{attempt:round.attemptId,pid:process.pid,worktree:cwd}});
   const held=yield* leases.acquire(runId);assert.equal(held._tag,'Held');if(held._tag!=='Held')return;yield* Effect.addFinalizer(()=>held.release());
   const out:string[]=[],output={stdout:(s:string)=>Effect.sync(()=>{out.push(s);}),stderr:()=>Effect.void};
   const lifecycle=makeLivePelLifecycleServices({cwd,foremanHome:home,userHome:home,environment:{},output});
   const cli=makeForemanCli({input:{read:()=>Effect.die('status must not read source')},output,context:{defaultSnapshotPath:'unused'},lifecycle});
   const invoke=(args:readonly string[])=>mode==='service'?cli.run(args):Effect.sync(()=>{const child=spawnSync(process.execPath,[resolve('skills/foreman/runtime/dist/foreman.js'),...args],{cwd,env:{PATH:'/usr/bin:/bin',HOME:home,FOREMAN_HOME:home},encoding:'utf8',timeout:10000});assert.equal(child.error,undefined);assert.equal(child.stderr,'');out.push(child.stdout);return {exitCode:child.status??1};});
   for(const terminal of [false,true]){
    if(terminal){yield* journal.append(runId,{type:'resume_attempt',lane:round.laneId,payload:{attempt:round.attemptId,resumeCount:1}});yield* journal.append(runId,{type:'checkpoint',lane:round.laneId,commit:'a'.repeat(40),payload:{attempt:round.attemptId}});yield* journal.append(runId,{type:'state',lane:round.laneId,payload:{attempt:round.attemptId,state:'verifying'}});yield* journal.append(runId,{type:'round_done',lane:round.laneId,payload:{attempt:round.attemptId,outcome:{_tag:'completed',attemptIdentity:{runId,laneId:round.laneId,attemptId:round.attemptId},implementationExitCode:0,gateExitCode:0,reportFresh:true,reportBaseline:{_tag:'Absent'},report:{_tag:'Present',digest:'b'.repeat(64),byteLength:1}}}});}
    const history=readFileSync(join(state,'runs',runId,'events.ndjson')),names=readdirSync(join(state,'runs',runId)).sort();out.length=0;
    const result=yield* invoke(['status',runId,'--json']);assert.equal(result.exitCode,terminal?0:3,JSON.stringify(out));
    const status=JSON.parse(out[0]!);assert.equal(status.kind,'legacy-round');assert.equal(status.state,terminal?'terminal':'active');assert.deepEqual(status.attempts,[{runId,laneId:round.laneId,attemptId:round.attemptId}]);assert.equal(status.originalController,'unavailable');
    for(const command of ['resume','cancel']){out.length=0;const refused=yield* invoke([command,runId,'--json']);assert.equal(refused.exitCode,3);assert.equal(JSON.parse(out[0]!).code,'ActiveLegacyRun');}
    assert.deepEqual(readFileSync(join(state,'runs',runId,'events.ndjson')),history);assert.deepEqual(readdirSync(join(state,'runs',runId)).sort(),names);assert.equal((yield* leases.acquire(runId))._tag,'Busy');
   }
   const before=readdirSync(join(state,'runs')).sort();assert.equal((yield* invoke(['status','missing-run','--json'])).exitCode,2);assert.deepEqual(readdirSync(join(state,'runs')).sort(),before);
  }).pipe(Effect.provide(makeLiveRunJournalLayer(state)),Effect.provide(makeLiveRunLease(state)),Effect.scoped));
 }finally{rmSync(root,{recursive:true,force:true});}
});
