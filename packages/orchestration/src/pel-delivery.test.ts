import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Effect} from 'effect';
import {sha256Hex} from '@foreman/core';
import {makeLiveRunJournalLayer,type RunId} from '@foreman/event-log';
import {EndstopLedger,makeLiveEndstopLedgerLayer} from './execution-ledger.js';
import {readPelRecords,replayPelRun} from './pel-journal.js';
const entry=resolve('packages/orchestration/dist-test/pel-cli-fixture.js'),assets=resolve('packages/orchestration/dist-test/assets');
async function fixture(scenario:string,roles='grok-sol',failurePoint='none'){
 const root=await mkdtemp(join(tmpdir(),'pel-delivery-fixture-')),assetRoot=join(root,'assets'),stateRoot=join(root,'state');await mkdir(stateRoot);await cp(assets,assetRoot,{recursive:true});
 const manifest=join(root,'fixture-manifest.json'),delivery={schemaVersion:1,evidenceKind:'test-fixture',fixtureId:'m5-delivery',temporaryRoot:root,stateRoot,now:Date.now(),scenario,roles,failurePoint};
 await writeFile(manifest,JSON.stringify({schemaVersion:1,assetRoot,assetManifestSha256:sha256Hex(await readFile(join(assetRoot,'manifest.json'))),fixtures:{responses:[],delivery}}));
 const invoke=(args:readonly string[],json=true)=>spawnSync(process.execPath,[entry,'--fixture-manifest',manifest,...args,...(json?['--json']:[])],{cwd:root,encoding:'utf8',timeout:45000});
 const ledger=()=>Effect.runPromise(Effect.flatMap(EndstopLedger,p=>p.status('delivery-fixture-contract')).pipe(Effect.provide(makeLiveEndstopLedgerLayer(stateRoot))));
 const records=(id:string)=>Effect.runPromise(readPelRecords(id as RunId).pipe(Effect.provide(makeLiveRunJournalLayer(stateRoot))));
 return {root,stateRoot,assetRoot,manifest,delivery,invoke,ledger,records,close:()=>rm(root,{recursive:true,force:true})};
}
for(const roles of ['grok-sol','astra-opus'])test(`T-M5-008/T-M5-014/T-M5-016 compiled standard pipeline ${roles} has real Git/checks and exact independent roles`,async()=>{
 const f=await fixture('approved',roles);try{const run=f.invoke(['run','examples/pel/implement-verify-review.pel']);assert.equal(run.status,0,run.stdout+run.stderr);const result=JSON.parse(run.stdout);assert.equal(result.state,'succeeded');assert.equal(result.evidenceKind,'test-fixture');const settings=JSON.parse(await readFile(join(f.stateRoot,'project-settings.json'),'utf8')),assetSettings=JSON.parse(await readFile(join(f.assetRoot,'fixtures/pel-adoption/project-settings.json'),'utf8'));assert.equal(settings.projectId,assetSettings.projectId);assert.equal(settings.workspaces.grants[0].canonicalRoot,join(f.root,assetSettings.paths.workspace));assert.deepEqual(settings.gates[assetSettings.gate.id].argv,assetSettings.gate.argv);assert.equal(settings.roleBindings['role:implementer'].profileId,assetSettings.roleSets[roles].implementer.profileId);assert.equal(result.checks.passed,true);assert.equal(result.review.verdict,'approved');assert.equal(result.review.implementer.profileId,roles==='grok-sol'?'grok-4.6':'gpt-6-astra');assert.equal(result.review.reviewer.profileId,roles==='grok-sol'?'gpt-5.6-sol':'claude-opus-5');assert.ok(result.candidate.value.commit);const captured=JSON.parse(await readFile(join(f.stateRoot,'runs',result.runId,'artifacts',result.candidate.value.manifestRef.artifactId),'utf8'));assert.deepEqual(captured.artifacts.map((a:{path:string})=>a.path),['src/main.ts']);assert.equal(result.usage.observed.inputTokens,20);assert.equal((await f.ledger()).counts.implement,1);assert.equal((await f.ledger()).counts.verify,1);assert.equal((await f.ledger()).counts.audit,1);
  const status=f.invoke(['status',result.runId]);assert.equal(status.status,0,status.stdout+status.stderr);assert.deepEqual(JSON.parse(status.stdout),result);const text=f.invoke(['status',result.runId],false);assert.equal(text.status,0,text.stdout+text.stderr);assert.match(text.stdout,new RegExp(result.candidate.value.commit));assert.match(text.stdout,/approved/);assert.match(text.stdout,/test-fixture/);
 }finally{await f.close();}
});
for(const scenario of ['gate-failed','repair-one','repair-noop','repair-exhausted','repair-immediate'])test(`T-M5-009/T-M5-010 compiled ${scenario} retains bounded source-level decisions`,async()=>{
 const f=await fixture(scenario==='repair-immediate'?'approved':scenario);try{const source=scenario==='gate-failed'?'implement-verify-review.pel':'repair-and-publish.pel',run=f.invoke(['run',`examples/pel/${source}`]);assert.equal(run.status,3,run.stdout+run.stderr);const result=JSON.parse(run.stdout);assert.equal(result.state,'needs-action');const state=await f.ledger();assert.equal(state.counts.implement,1);assert.equal(state.counts.correct,scenario==='gate-failed'||scenario==='repair-immediate'?0:1);assert.equal(state.counts.verify,scenario==='gate-failed'||scenario==='repair-noop'||scenario==='repair-immediate'?1:2);assert.equal(state.counts.audit,scenario==='gate-failed'?0:scenario==='repair-noop'||scenario==='repair-immediate'?1:2);assert.equal(state.counts.publish,0);assert.equal(state.counts.integrate,0);
  const records=await f.records(result.runId),replay=replayPelRun(records);assert.equal(replay.ok,true);if(replay.ok){const starts=replay.value.records.filter(r=>r.type==='pel.effect.observed.v1'&&r.data.providerIdentity&&r.data.externalOutcome==='pending');assert.equal(starts.length,scenario==='gate-failed'?1:scenario==='repair-immediate'?2:scenario==='repair-noop'?3:4);}
  if(scenario==='repair-one')assert.equal(result.review.verdict,'approved');if(scenario==='repair-exhausted')assert.match(run.stdout,/correction-limit/);if(scenario==='repair-noop')assert.match(run.stdout,/no-product-change/);
 }finally{await f.close();}
});
test('T-M5-015 compiled owner death after durable provider completion resumes host capture without another provider start',async()=>{
 const f=await fixture('approved','grok-sol','after-provider-completed');try{const died=f.invoke(['run','examples/pel/implement-verify-review.pel']);assert.equal(died.signal,'SIGKILL',died.stdout+died.stderr);const runId=JSON.parse(died.stderr.trim().split('\n')[0]!).runId;const resumed=f.invoke(['resume',runId]);assert.equal(resumed.status,0,resumed.stdout+resumed.stderr);const result=JSON.parse(resumed.stdout);assert.equal(result.state,'succeeded');const state=await f.ledger();assert.equal(state.counts.implement,1);assert.equal(state.counts.verify,1);assert.equal(state.counts.audit,1);const replay=replayPelRun(await f.records(runId));assert.equal(replay.ok,true);if(replay.ok)assert.equal(replay.value.records.filter(r=>r.type==='pel.effect.observed.v1'&&r.data.providerIdentity?.provider==='xai'&&r.data.externalOutcome==='pending').length,1);
 }finally{await f.close();}
});

test('compiled delivery fixture rejects unknown scripts, escaped roots, mixed execution and product activation',async()=>{
 const f=await fixture('approved');try{const original=JSON.parse(await readFile(f.manifest,'utf8'));for(const changed of [{...original,fixtures:{...original.fixtures,delivery:{...f.delivery,script:'touch /tmp/unauthorized'}}},{...original,fixtures:{...original.fixtures,delivery:{...f.delivery,stateRoot:f.root}}},{...original,fixtures:{...original.fixtures,execution:{}}}]){await writeFile(f.manifest,JSON.stringify(changed));const denied=f.invoke(['run','examples/pel/implement-verify-review.pel']);assert.equal(denied.status,2,denied.stdout+denied.stderr);assert.doesNotMatch(denied.stderr,/run-started/);}await writeFile(f.manifest,JSON.stringify(original));
 const product=spawnSync(process.execPath,[resolve('skills/foreman/runtime/dist/foreman.js'),'--fixture-manifest',f.manifest,'run','examples/pel/implement-verify-review.pel','--json'],{cwd:f.root,encoding:'utf8',timeout:10000});assert.equal(product.status,2,product.stdout+product.stderr);assert.equal((await readFile(resolve('skills/foreman/runtime/dist/foreman.js'),'utf8')).includes('Invalid bounded delivery fixture manifest.'),false);
 }finally{await f.close();}
});
