import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Either} from 'effect';
import {Effect} from 'effect';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,existsSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
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

/**
 * The twelve retired controllers are restored under the user-approved temporary exception.
 * Each expected identity below is the historical one recorded in the tree of
 * 6c1515ecf3d28ccbea6205731e9142aede7a8110: `git ls-tree -r` supplies mode and blob id, and
 * `sha256`/`size` describe those exact blob bytes. They are goldens for this test and are not
 * read back from the restored files or from the policy pin module they must independently agree with.
 */
const RESTORED_COHORT=[
 {path:'skills/foreman/scripts/adapters/agy.sh',blob:'914d12338c7a1f39a54da50ab9aaf6df47eb2116',sha256:'ae4440daacdff5edee6174844bed7af932792d4b58cf5c9528561c9f179210be',size:12919},
 {path:'skills/foreman/scripts/adapters/claude.sh',blob:'37c81c4e90e7adad0daf5e99f571042eaecec99a',sha256:'5ab6b2a7e152154d53533cfe4cfeed7d8c46d8664d90fed99ad969b461a4f652',size:11458},
 {path:'skills/foreman/scripts/adapters/codex.sh',blob:'a8ae33ac8cd16c53afcb8d65da0a2f98c2cf5148',sha256:'cbfaf8ee7e40ce54e2ca0788a08a59c5dc3e8d380b5ed98c5be67179c96452eb',size:13078},
 {path:'skills/foreman/scripts/adapters/grok.sh',blob:'5ecd4bc8ac4d28340d916599f183bee4341717a5',sha256:'6dcf82398b49681f66129e38f52e7b8c5a70257044028ee1ed7b6381ff3a4232',size:11315},
 {path:'skills/foreman/scripts/audit-run.sh',blob:'82c690cbd2bc02178eeb7b1d1ee0642a4a995dea',sha256:'0cc03c9c20a103d591413fc576619235077ff41c00e8766e6b5d186a4a5e8263',size:25342},
 {path:'skills/foreman/scripts/lane-run.sh',blob:'e6c49f00701b5bf4d8f17ddb0a43f2d84b393571',sha256:'5368260642cac6d0ff9d38a45597dc359e6c5a0b9a008f49dee3383bc7f16110',size:76129},
 {path:'skills/foreman/scripts/lane-supervise.sh',blob:'1ee0bac08cd6e4ce4d421123a9e4c2b0ce12e391',sha256:'a09929d92ce817fc861800b38529300889a62b8324fc67fea9a305ea32ac7062',size:935},
 {path:'skills/foreman/scripts/lib/worker-cmd.sh',blob:'018fa05ee86f90fa85aa7248ea4999d7cacaed02',sha256:'47deb36862a7bda1c9a174caf215667378e2d03d0ee9796abd81b2f7e364f508',size:2798},
 {path:'skills/foreman/scripts/resume.sh',blob:'22ae5d5e96d8c537c79566ba7869a56ec093f03c',sha256:'8509bacc869c9c06d26030eeef6abe8cd61fa326fe307ef7bf7c6be7af16fe97',size:10602},
 {path:'skills/foreman/scripts/vendor-multiround.sh',blob:'c9d8937989a5525041976534cc9938b694c6b959',sha256:'07686f1cad9d660d1b62ccb34de6e0d5171f75a648b1f8fdb6cf380fc917f406',size:11790},
 {path:'skills/foreman/scripts/watch.sh',blob:'6d4ec0afaca9e3b082fa6f2179bcd776f6adea11',sha256:'6ee0c22f756bf7395c93ff1876d42a877e0c7a0e091b06fe592d23a5b320ff14',size:62260},
 {path:'skills/foreman/scripts/worker-run.sh',blob:'3a97dc436d34319c50e4e069da1cebefde677572',sha256:'359d694a836c722ff9bb9fca243bdcce24188bef62046c8f9a66d78b456bf480',size:21532},
]as const;
type RestoredEntry=(typeof RESTORED_COHORT)[number];
/** Git blob identity of exact bytes: sha1 over "blob <length>\0" and the body. */
const gitBlobId=(bytes:Buffer)=>createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}`),Buffer.from([0]),bytes])).digest('hex');
/** Every way the on-disk cohort member can differ from its historical identity, reported together. */
function historicalFaults(entry:RestoredEntry,bytes:Buffer,fileMode:number):string[]{
 const faults:string[]=[],sha256=createHash('sha256').update(bytes).digest('hex'),blob=gitBlobId(bytes),mode=`100${(fileMode&0o7777).toString(8)}`;
 if(bytes.length!==entry.size)faults.push(`${entry.path}: size ${bytes.length} is not historical ${entry.size}`);
 if(sha256!==entry.sha256)faults.push(`${entry.path}: sha256 ${sha256} is not historical ${entry.sha256}`);
 if(blob!==entry.blob)faults.push(`${entry.path}: git blob ${blob} is not historical ${entry.blob}`);
 if(mode!=='100755')faults.push(`${entry.path}: mode ${mode} is not historical 100755`);
 return faults;
}
/**
 * Legacy command references are admitted only from the exact restored historical bodies, the exact
 * policy module that pins them, and the fixed measurement membership metadata. Every other live
 * path in the scanned scopes, including new scripts, Pel and Council sources, must stay free of them.
 */
const LEGACY_REFERENCE_ALLOWLIST=new Set<string>(RESTORED_COHORT.map(entry=>entry.path));
// Only these reviewed metadata bodies may bypass reference scanning. Changes require explicit review.
const REFERENCE_METADATA_SHA256=new Map<string,string>([
 ['packages/policy/src/architecture-adapter.ts','4f68f1209ffb74fc935e7f7789b15218d49529456a0f2919b583f22885f530b3'],
 ['packages/orchestration/src/pel-simplification.ts','03d7358fa5ab70c863a9488100062aa7f4fb6585cdabfd5a9523e6c82372949e'],
]);
function retiredReferenceOffenders(files:readonly string[],read:(file:string)=>string):string[]{
 const names=RESTORED_COHORT.map(entry=>entry.path.split('/').at(-1)!),offenders:string[]=[];
 for(const file of files){
  if(LEGACY_REFERENCE_ALLOWLIST.has(file))continue;
  if(file.split('/').some(part=>['node_modules','dist','dist-test','fixtures','__golden__','test','tests','.git'].includes(part))||/\.test\.tsx?$/u.test(file))continue;
  if(!/\.(?:tsx?|sh|bash|py|ps1|md|toml|ya?ml|json)$/u.test(file))continue;
  const content=read(file);
  if(REFERENCE_METADATA_SHA256.get(file)===sha256Hex(content))continue;
  for(const name of names)if(content.includes(name))offenders.push(`${file}: ${name}`);
 }
 return offenders;
}
test('T-M6-009 the twelve retained controllers hold their exact historical bytes, hashes and modes',()=>{
 assert.equal(RESTORED_COHORT.length,12);assert.equal(new Set(RESTORED_COHORT.map(entry=>entry.path)).size,12);
 const faults:string[]=[];
 for(const entry of RESTORED_COHORT){
  const file=resolve(entry.path);
  if(!existsSync(file)){faults.push(`${entry.path}: absent, but the approved restoration retains it`);continue;}
  const identity=lstatSync(file);
  if(!identity.isFile()){faults.push(`${entry.path}: not a regular historical file`);continue;}
  faults.push(...historicalFaults(entry,readFileSync(file),identity.mode));
 }
 assert.deepEqual(faults,[],'Restoration is admitted for the exact historical bodies of 6c1515ecf3d28ccbea6205731e9142aede7a8110 only.');
});
test('T-M6-009 live caller scopes reference the retained cohort only from its restored bodies and pins',()=>{
 const list=spawnSync('rg',['--files','--hidden','packages','components/council','skills/foreman','scripts','env','.github'],{encoding:'utf8',maxBuffer:8*1048576});assert.equal(list.status,0,list.stderr);
 const offenders=retiredReferenceOffenders(list.stdout.trim().split('\n'),file=>readFileSync(file,'utf8'));
 assert.deepEqual(offenders,[],'Retained bodies, their exact policy pins and fixed measurement membership are the only admitted references.');
});
test('T-M6-009 a changed historical body or an unexpected new caller stays rejected',()=>{
 const entry=RESTORED_COHORT.find(candidate=>candidate.path.endsWith('lane-supervise.sh'))!,original=readFileSync(resolve(entry.path));
 assert.deepEqual(historicalFaults(entry,original,0o100755),[]);
 assert.ok(historicalFaults(entry,original.subarray(0,-1),0o100755).length>0);
 const edited=Buffer.concat([original,Buffer.from('# appended after restoration\n')]);
 assert.deepEqual(historicalFaults(entry,edited,0o100755).map(fault=>fault.split(': ')[1]!.split(' ')[0]),['size','sha256','git']);
 const flipped=Buffer.from(original);flipped[flipped.length-2]=flipped[flipped.length-2]!^0x20;
 assert.equal(historicalFaults(entry,flipped,0o100755).length,2);
 const relocatedBody=readFileSync(resolve('skills/foreman/scripts/resume.sh'));
 assert.ok(historicalFaults(entry,relocatedBody,0o100755).length>0);
 assert.deepEqual(historicalFaults(entry,original,0o100644).map(fault=>fault.split(': ')[1]),['mode 100644 is not historical 100755']);
 const probes:readonly[string,boolean][]=[
  ['packages/orchestration/src/pel-future-dispatch.ts',true],
  ['components/council/src/council-launch.ts',true],
  ['scripts/new-release-helper.sh',true],
  ['skills/foreman/scripts/new-controller.sh',true],
  ['env/reference-manifest.toml',true],
  ['.github/workflows/new-lane.yml',true],
  ['skills/foreman/scripts/lane-run.sh',false],
  ['packages/policy/src/architecture-adapter.ts',true],
  ['packages/orchestration/src/pel-simplification.ts',true],
  ['packages/orchestration/src/pel-migration.test.ts',false],
  ['packages/orchestration/dist/pel-cli.js',false],
 ];
 for(const file of REFERENCE_METADATA_SHA256.keys()){
  const metadata=readFileSync(resolve(file),'utf8');
  assert.deepEqual(retiredReferenceOffenders([file],()=>metadata),[]);
  assert.ok(retiredReferenceOffenders([file],()=>metadata+'\nexec("lane-run.sh");\n').some(fault=>fault.startsWith(file+': ')));
 }
 const referencing=(file:string)=>probes.some(([path])=>path===file)?'exec "$ROOT/skills/foreman/scripts/lane-run.sh" "$@"\n':assert.fail(`unexpected read of ${file}`);
 assert.deepEqual(retiredReferenceOffenders(probes.map(([path])=>path),referencing),probes.filter(([,rejected])=>rejected).map(([path])=>`${path}: lane-run.sh`));
});
