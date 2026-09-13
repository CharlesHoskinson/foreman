import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Either} from 'effect';
import {Effect} from 'effect';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {makePelMigrationServices} from './pel-migration-live.js';
import {sha256Hex} from '@foreman/core';
import {checkPel} from '@foreman/pel';
import {createDefaultAuthoringSnapshotV1} from './pel-host-descriptors.js';
import {decodePelLegacyCommandBindingV1,importLegacyWorkflow,observePelLegacyRun,readPelLegacyRunObservation} from './pel-migration.js';
import {RunJournal,makeLiveRunJournalLayer,type RunId,type LaneId} from '@foreman/event-log';
import {EndstopLedger,makeLiveEndstopLedgerLayer} from './execution-ledger.js';
import {decodeExecutionContractV1,isExecutionContractFailure,executionContractSha256} from './execution-contract.js';
import {RunLease} from './supervisor.js';
import {makeLiveRunLease} from './supervisor-live-services.js';
import {spawnSync} from 'node:child_process';
import {cpSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {readPelRecords,replayPelRun} from './pel-journal.js';

const corpus=join(import.meta.dirname,'fixtures/pel-migration');
function fixture(id:'implement-verify-review'|'bounded-rework'){
 const read=(name:string)=>({locator:join(corpus,id,name),bytes:readFileSync(join(corpus,id,name))});
 const registered=decodePelLegacyCommandBindingV1(JSON.parse(read('registered-command-bindings.json').bytes.toString()));assert.ok(Either.isRight(registered));
 return {round:read('round-v1.json'),contract:read('contract-v1.json'),bindings:[registered.right],legacyState:observePelLegacyRun(JSON.parse(read('round-v1.json').bytes.toString()).runId,[])};
}
for(const id of ['implement-verify-review','bounded-rework'] as const)test(`T-M6-007 closed ${id} import preserves exact registered semantics`,()=>{
 const input=fixture(id),result=importLegacyWorkflow(input);assert.ok(Either.isRight(result),JSON.stringify(result));
 const expected=readFileSync(join(import.meta.dirname,'../../../examples/pel',id==='bounded-rework'?'repair-and-publish.pel':'implement-verify-review.pel'),'utf8');
 assert.equal(result.right.source,expected);assert.equal(result.right.sourceSha256,sha256Hex(expected));
 assert.equal(checkPel({source:Buffer.from(result.right.source),snapshot:createDefaultAuthoringSnapshotV1()}).tag,'ok');
 assert.deepEqual(result.right.parityReport.limits,JSON.parse(Buffer.from(input.contract.bytes).toString()).limits);
 assert.equal(result.right.origin.roundSha256,sha256Hex(input.round.bytes));assert.equal(result.right.origin.contractFileSha256,sha256Hex(input.contract.bytes));
 assert.deepEqual(result.right.parityReport.requiredMilestones,['checks','audit']);
 const manifest=JSON.parse(readFileSync(join(corpus,id,'source-manifest.json'),'utf8'));for(const file of manifest.files)assert.equal(sha256Hex(readFileSync(join(corpus,id,file.path))),file.sha256);
});
test('T-M6-007 unknown command, schema, field, shell, Council, or gate fails at the original source locator',()=>{
 const base=fixture('implement-verify-review');
 for(const [part,field,change] of [
  ['round','$.schemaVersion',{schemaVersion:2}],['round','$.commandArgv[0]',{commandArgv:['bash','-c','touch /tmp/forbidden']}],['round','$.council',{council:{quorum:3}}],['round','$.gateCommand',{gateCommand:'git diff --check; touch /tmp/forbidden'}],['contract','$.schemaVersion',{schemaVersion:2}],['contract','$.queue',{queue:[]}],
 ] as const){const input={...base,[part]:{...base[part],bytes:Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(base[part].bytes).toString()),...change}))}},result=importLegacyWorkflow(input);assert.ok(Either.isLeft(result));assert.equal(result.left.code,'UnsupportedLegacyConstruct');assert.equal(result.left.locator,base[part].locator);assert.equal(result.left.field,field);}
 const duplicate={...base,round:{...base.round,bytes:Buffer.from('{"schemaVersion":1,"schemaVersion":1}')}};assert.ok(Either.isLeft(importLegacyWorkflow(duplicate)));
});
test('T-M6-008 active and uncertain legacy observations refuse without consuming or rewriting the input',()=>{
 const input=fixture('implement-verify-review'),before=sha256Hex(input.round.bytes);
 for(const state of ['active','unknown'] as const){const result=importLegacyWorkflow({...input,legacyState:{runId:'legacy-implement-verify-review',state,historySha256:'a'.repeat(64),owner:{controller:'legacy-round' as const,laneId:'worker',attemptId:1,ownershipSequence:2}}});assert.ok(Either.isLeft(result));assert.equal(result.left.code,'ActiveLegacyRun');assert.equal(result.left.exitCode,3);assert.equal(result.left.originalController,'unavailable');assert.equal('recoveryRoute'in result.left,false);assert.equal(sha256Hex(input.round.bytes),before);}
});
test('migration publication creates a hash-bound pair and refuses overwrite or symlink inputs',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pel-migration-')),f=fixture('implement-verify-review'),input=join(root,'round.json'),contract=join(root,'contract.json'),out=join(root,'workflow.pel');
 try{writeFileSync(input,f.round.bytes);writeFileSync(contract,f.contract.bytes);const service=makePelMigrationServices({resolve:()=>Effect.succeed({bindings:f.bindings,legacyState:f.legacyState})});
 const result=await Effect.runPromise(service.migrate({input,contract,out}));assert.equal(sha256Hex(readFileSync(out)),result.result.sourceSha256);assert.equal(JSON.parse(readFileSync(result.parityPath,'utf8')).sourceSha256,result.result.sourceSha256);
 assert.equal((await Effect.runPromise(Effect.either(service.migrate({input,contract,out}))))._tag,'Left');
 const alias=join(root,'alias.json');symlinkSync(input,alias);assert.equal((await Effect.runPromise(Effect.either(service.migrate({input:alias,contract,out:join(root,'new.pel')}))))._tag,'Left');assert.equal(existsSync(join(root,'new.pel')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('T-M6-008 real active legacy owner, reservation and completed tool evidence survive migration refusal',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pel-active-migration-')),f=fixture('implement-verify-review'),input=join(root,'round.json'),contractPath=join(root,'contract.json');writeFileSync(input,f.round.bytes);writeFileSync(contractPath,f.contract.bytes);
 try{await Effect.runPromise(Effect.gen(function*(){
  const journal=yield* RunJournal,ledger=yield* EndstopLedger,lease=yield* RunLease,round=JSON.parse(Buffer.from(f.round.bytes).toString()),runId=round.runId as RunId;
  const contract=decodeExecutionContractV1(JSON.parse(Buffer.from(f.contract.bytes).toString()));assert.ok(!isExecutionContractFailure(contract));yield* ledger.create(contract);
  const attempt=yield* journal.allocate(runId,round.laneId as LaneId);assert.equal(attempt.attemptId,round.attemptId);
  const held=yield* lease.acquire(runId);assert.equal(held._tag,'Held');if(held._tag!=='Held')return;yield* Effect.addFinalizer(()=>held.release());
  yield* journal.append(runId,{type:'prompt',lane:round.laneId,payload:{attempt:attempt.attemptId,roundPlan:round}});const ownerEvent=yield* journal.append(runId,{type:'ownership',lane:round.laneId,payload:{attempt:attempt.attemptId,pid:process.pid,worktree:root}});yield* journal.append(runId,{type:'tool_result',lane:round.laneId,payload:{attempt:attempt.attemptId,callId:'read-1',result:{status:'completed',sha256:sha256Hex('original evidence')}}});
  yield* ledger.execute(contract.contractId,executionContractSha256(contract),{_tag:'ReserveAction',action:'implement',candidateSha256:sha256Hex(contract.baseCommit),reservationId:'legacy-paid-implementation',at:contract.createdAt});
  const before=yield* readPelLegacyRunObservation(runId),budget=yield* ledger.status(contract.contractId);assert.equal(before.state,'active');assert.equal(before.owner?.ownershipSequence,ownerEvent.seq);
  const service=makePelMigrationServices({resolve:()=>Effect.map(readPelLegacyRunObservation(runId).pipe(Effect.provideService(RunJournal,journal)),legacyState=>({bindings:f.bindings,legacyState}))});
  const result=yield* Effect.either(service.migrate({input,contract:contractPath,out:join(root,'denied.pel')}));assert.ok(Either.isLeft(result));assert.equal(result.left.code,'ActiveLegacyRun');assert.equal(result.left.exitCode,3);assert.deepEqual(yield* readPelLegacyRunObservation(runId),before);assert.deepEqual(yield* ledger.status(contract.contractId),budget);assert.equal((yield* lease.acquire(runId))._tag,'Busy');assert.equal(existsSync(join(root,'denied.pel')),false);
 }).pipe(Effect.provide(makeLiveRunJournalLayer(root)),Effect.provide(makeLiveEndstopLedgerLayer(root)),Effect.provide(makeLiveRunLease(root)),Effect.scoped));}finally{rmSync(root,{recursive:true,force:true});}
});
for(const id of ['implement-verify-review','bounded-rework']as const)test(`T-M6-007 compiled migrate and actual host execution preserve ${id} trace and original limits`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'pel-migration-cli-')),assetRoot=join(root,'assets'),stateRoot=join(root,'state'),manifest=join(root,'fixture-manifest.json'),entry=resolve('packages/orchestration/dist-test/pel-cli-fixture.js'),f=fixture(id),out=join(root,'imported.pel');
 try{mkdirSync(stateRoot);cpSync(resolve('packages/orchestration/dist-test/assets'),assetRoot,{recursive:true});const expected=JSON.parse(readFileSync(join(corpus,id,'expected-trace.json'),'utf8'));
  writeFileSync(manifest,JSON.stringify({schemaVersion:1,assetRoot,assetManifestSha256:sha256Hex(readFileSync(join(assetRoot,'manifest.json'))),fixtures:{responses:[],delivery:{schemaVersion:1,evidenceKind:'test-fixture',fixtureId:`m6-migration-${id}`,temporaryRoot:root,stateRoot,now:Date.now(),scenario:expected.scenario,roles:'grok-sol',failurePoint:'none'}}}));
  const invoke=(args:readonly string[])=>spawnSync(process.execPath,[entry,'--fixture-manifest',manifest,...args,'--json'],{cwd:root,encoding:'utf8',timeout:45000});
  const migrated=invoke(['migrate',f.round.locator,'--contract',f.contract.locator,'--out',out]);assert.equal(migrated.status,0,migrated.stdout+migrated.stderr);
  const parity=JSON.parse(readFileSync(`${out}.parity.json`,'utf8'));assert.equal(parity.origin.roundSha256,sha256Hex(f.round.bytes));assert.equal(parity.origin.contractFileSha256,sha256Hex(f.contract.bytes));
  const run=invoke(['run',out]);assert.equal(run.status,expected.exitCode,run.stdout+run.stderr);const result=JSON.parse(run.stdout);assert.equal(result.state,expected.state);assert.equal(result.evidenceKind,'test-fixture');
  const ledger=await Effect.runPromise(Effect.flatMap(EndstopLedger,l=>l.status('delivery-fixture-contract')).pipe(Effect.provide(makeLiveEndstopLedgerLayer(stateRoot))));for(const [name,count]of Object.entries(expected.counts))assert.equal(ledger.counts[name as keyof typeof ledger.counts],count,name);assert.deepEqual(ledger.contract.limits,expected.limits);assert.deepEqual(ledger.contract.requiredMilestones,expected.requiredMilestones);
  const relocated=JSON.parse(readFileSync(join(stateRoot,'migration-contract-relocation.json'),'utf8'));assert.deepEqual(relocated.originalContract,JSON.parse(Buffer.from(f.contract.bytes).toString()));assert.deepEqual(relocated.executionContract.limits,relocated.originalContract.limits);assert.equal(relocated.executionContract.allowedPathsSha256,relocated.originalContract.allowedPathsSha256);
  const records=await Effect.runPromise(readPelRecords(result.runId).pipe(Effect.provide(makeLiveRunJournalLayer(stateRoot)))),replay=replayPelRun(records);assert.ok(replay.ok);
  const registryIds:string[]=[];for(const row of replay.value.records)if(row.type==='pel.effect.observed.v1'){const artifact=JSON.parse(readFileSync(join(stateRoot,'runs',result.runId,'artifacts',row.data.observationRef.artifactId),'utf8'));if(artifact.stage==='host-preparation')registryIds.push(artifact.registryId);}
  assert.deepEqual(registryIds,expected.requiredEffects.filter((name:string)=>name!=='fm/publish'));
  const identities=replay.value.records.filter(row=>row.type==='pel.effect.observed.v1'&&row.data.externalOutcome==='pending'&&row.data.providerIdentity).map(row=>row.type==='pel.effect.observed.v1'?row.data.providerIdentity!:null);assert.equal(identities.length,id==='bounded-rework'?4:2);for(let index=0;index<identities.length;index++){const actual=identities[index]!,identity=index%2===0?expected.implementer:expected.reviewer;assert.equal(actual.profileId,identity.profileId);assert.equal(actual.transportId,identity.transportId);assert.equal(actual.credentialProfileRef,identity.credentialProfileRef);}
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('migration distinguishes input I/O from malformed contract at its original locator',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pel-migration-io-')),f=fixture('implement-verify-review'),input=join(root,'round.json'),contract=join(root,'contract.json'),out=join(root,'out.pel');
 let resolutions=0;
 try {
  writeFileSync(input,f.round.bytes);
  const service=makePelMigrationServices({resolve:()=>Effect.sync(()=>{resolutions++;return {bindings:f.bindings,legacyState:f.legacyState};})});
  const missing=await Effect.runPromise(Effect.either(service.migrate({input,contract,out})));
  assert.ok(Either.isLeft(missing));assert.equal(missing.left.code,'MigrationIO');assert.equal(missing.left.exitCode,1);assert.equal(missing.left.locator,contract);
  writeFileSync(contract,'{"schemaVersion":1,"schemaVersion":1}');
  const malformed=await Effect.runPromise(Effect.either(service.migrate({input,contract,out})));
  assert.ok(Either.isLeft(malformed));assert.equal(malformed.left.code,'UnsupportedLegacyConstruct');assert.equal(malformed.left.locator,contract);
  assert.equal(resolutions,0);assert.equal(existsSync(out),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('T-M6-009 all twelve retired shell entries are absent and live caller scopes contain no references',()=>{
 const retired=['vendor-multiround.sh','lib/worker-cmd.sh','adapters/grok.sh','adapters/codex.sh','adapters/claude.sh','adapters/agy.sh','lane-run.sh','worker-run.sh','audit-run.sh','resume.sh','watch.sh','lane-supervise.sh'];
 for(const path of retired)assert.equal(existsSync(resolve('skills/foreman/scripts',path)),false,path);
 const list=spawnSync('rg',['--files','--hidden','packages','components/council','skills/foreman','scripts','env','.github'],{encoding:'utf8',maxBuffer:8*1048576});assert.equal(list.status,0,list.stderr);
 const names=retired.map(path=>path.split('/').at(-1)!),offenders:string[]=[];
 for(const file of list.stdout.trim().split('\n')){
  if(file.split('/').some(part=>['node_modules','dist','dist-test','fixtures','__golden__','test','tests','.git'].includes(part))||/\.test\.tsx?$/u.test(file)||file==='packages/orchestration/src/pel-simplification.ts')continue;
  if(!/\.(?:tsx?|sh|bash|py|ps1|md|toml|ya?ml|json)$/u.test(file))continue;
  const content=readFileSync(file,'utf8');for(const name of names)if(content.includes(name))offenders.push(`${file}: ${name}`);
 }
 assert.deepEqual(offenders,[],'Fixed measurement membership is metadata; all other live scopes must omit retired entries.');
});
