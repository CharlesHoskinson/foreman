import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtemp,
  writeFile,
  readFile,
  cp,
  rm,
  symlink,
  mkdir,
  readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDefaultAuthoringSnapshotV1 } from "./pel-host-descriptors.js";
import {Effect} from 'effect';
import {EndstopLedger,makeLiveEndstopLedgerLayer} from './execution-ledger.js';
import {makeLiveRunJournalLayer,type RunId} from '@foreman/event-log';
import {readPelRecords,decodePelRecordV1,decodePelChildStateV1,decodePelRaceDecisionV1} from './pel-journal.js';
import type {PelDataValue} from '@foreman/pel';
import type {PelChildStateV1} from './pel-run-contract.js';
import {setTimeout as delay} from 'node:timers/promises';
const entry = resolve("packages/orchestration/dist-test/pel-cli-fixture.js");
const assetSource = resolve("packages/orchestration/dist-test/assets");
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function fixtureManifest(dir: string, responses: readonly string[] = []) {
  const assetRoot = join(dir, "assets");
  await cp(assetSource, assetRoot, { recursive: true });
  const manifest = join(dir, "fixture-manifest.json");
  const value = {
    schemaVersion: 1,
    fixtures: { responses },
    assetRoot,
    assetManifestSha256: digest(
      await readFile(join(assetRoot, "manifest.json")),
    ),
  };
  await writeFile(manifest, JSON.stringify(value));
  return {
    manifest,
    assetRoot,
    value,
    context: join(
      assetRoot,
      "runtime/assets/pel/default-authoring-snapshot.json",
    ),
  };
}
async function executionFixture(dir:string,failurePoint='none',printDelayMs=0){
  const f=await fixtureManifest(dir),stateRoot=join(dir,'state');await mkdir(stateRoot);
  const execution={schemaVersion:1,evidenceKind:'test-fixture',fixtureId:'m4-compiled',temporaryRoot:dir,stateRoot,bindingRef:'fixture:local-v1',now:Date.now(),capabilities:['print','fm/checkpoint','fm/retry','fm/race'],printDelayMs,failurePoint};
  await writeFile(f.manifest,JSON.stringify({...f.value,fixtures:{...f.value.fixtures,execution}}));
  const source=join(dir,'source.pel');
  const invoke=(...args:string[])=>spawnSync(process.execPath,[entry,'--fixture-manifest',f.manifest,...args,'--json'],{encoding:'utf8',cwd:dir,timeout:30000});
  return {...f,stateRoot,execution,source,invoke};
}
test('T-M4-021 compiled lifecycle recovers checkpoint and race decisions with the same durable receipts',async()=>{
 for(const failurePoint of ['after-checkpoint','after-race-decision']){
  const dir=await mkdtemp(join(tmpdir(),'pel-fixture-exec-'));
  try{const f=await executionFixture(dir,failurePoint);await writeFile(f.source,failurePoint==='after-checkpoint'?'(fm/checkpoint :name "saved")':'(fm/race :tasks [(lambda [] 11) (lambda [] 22)] :winner "first-valid")');
   const failed=f.invoke('run',f.source);assert.equal(failed.status,1,failed.stdout+failed.stderr);const runId=JSON.parse(failed.stderr.trim().split('\n')[0]!).runId;
   const resumed=f.invoke('resume',runId);assert.equal(resumed.status,0,resumed.stdout+resumed.stderr);const result=JSON.parse(resumed.stdout);assert.equal(result.state,'succeeded');
   const status=f.invoke('status',runId);assert.equal(status.status,0,status.stdout+status.stderr);assert.deepEqual(JSON.parse(status.stdout),result);
   const records=await Effect.runPromise(readPelRecords(runId as RunId).pipe(Effect.provide(makeLiveRunJournalLayer(f.stateRoot))));assert.equal(records.filter(record=>record.type===(failurePoint==='after-checkpoint'?'pel.checkpoint.v1':'pel.race.decision.v1')).length,1);if(failurePoint==='after-checkpoint'){const checkpoint=records.find(record=>record.type==='pel.checkpoint.v1')!;assert.deepEqual(result.finalValue,{tag:'list',items:[{tag:'pair',key:'name',value:{tag:'string',value:'saved'}},{tag:'pair',key:'sequence',value:{tag:'number',value:checkpoint.seq}}]});}
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('T-M4-021 compiled run status and cancel share one owner across processes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pel-fixture-exec-'));let child:ReturnType<typeof spawn>|undefined;
 try{const f=await executionFixture(dir,'none',30000);await writeFile(f.source,'(print 7)');child=spawn(process.execPath,[entry,'--fixture-manifest',f.manifest,'run',f.source,'--json'],{cwd:dir,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout!.on('data',chunk=>{stdout+=chunk;});const finished=new Promise<number|null>((resolve,reject)=>{child!.once('close',resolve);child!.once('error',reject);});
  const runId=await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timed out')),15000);child!.stderr!.on('data',chunk=>{stderr+=chunk;if(stderr.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(stderr.split('\n')[0]!).runId);}catch(e){reject(e);}}});});
  const status=f.invoke('status',runId);assert.equal(status.status,5,status.stdout+status.stderr);assert.ok(['running','suspended'].includes(JSON.parse(status.stdout).state));
  const cancelled=f.invoke('cancel',runId);assert.ok([4,5].includes(cancelled.status!),cancelled.stdout+cancelled.stderr);assert.equal(await finished,4,stdout+stderr);assert.equal(JSON.parse(stdout).state,'cancelled');
  const repeated=f.invoke('cancel',runId);assert.equal(repeated.status,4);assert.deepEqual(JSON.parse(repeated.stdout),JSON.parse(stdout));
 }finally{child?.kill('SIGKILL');await rm(dir,{recursive:true,force:true});}
});
test('T-M4-021 compiled provider scripts retain structured failures usage and retry reservation identity',async()=>{
 for(const scenario of ['completed','refused','rate-limited-once','disconnected','authentication-required']){
  const dir=await mkdtemp(join(tmpdir(),'pel-fixture-provider-'));
  try{const f=await executionFixture(dir);const script=Buffer.from(JSON.stringify({schemaVersion:1,events:scenario==='authentication-required'?['authentication-required']:['started','usage',scenario]}));await writeFile(join(dir,'provider-events.json'),script);
   const provider={profileId:'gpt-6-astra',transportId:'openai-responses',credentialProfileRef:'account:test',scenario,events:{relativePath:'provider-events.json',byteLength:script.byteLength,sha256:digest(script)}};
   await writeFile(f.manifest,JSON.stringify({...f.value,fixtures:{responses:[],execution:{...f.execution,capabilities:[...f.execution.capabilities,'fm/task'],provider}}}));
   const task='(fm/task :id "fixture-task" :input "artifact:approved-spec" :model "role:fixture" :output "schema:task-result-v1")';await writeFile(f.source,scenario==='rate-limited-once'?`(fm/retry :attempts 2 :on [':rate-limited] :body (lambda [] ${task}))`:task);
   const run=f.invoke('run',f.source),result=JSON.parse(run.stdout);assert.equal(run.status,scenario==='refused'?1:3,run.stdout+run.stderr);
   assert.equal(result.state,scenario==='refused'?'failed':'needs-action');
   if(['completed','rate-limited-once'].includes(scenario)){assert.equal(result.resumeMode,'final-value');assert.equal(result.usage.observed.inputTokens,scenario==='completed'?2:4);assert.equal(result.receipts.length,scenario==='completed'?1:5);const ledger=await Effect.runPromise(Effect.flatMap(EndstopLedger,ledger=>ledger.status('fixture-contract')).pipe(Effect.provide(makeLiveEndstopLedgerLayer(f.stateRoot))));assert.equal(ledger.counts.implement,1);assert.equal(ledger.counts.provider_retry,scenario==='completed'?0:1);}
   else if(scenario==='authentication-required'){assert.equal(result.externalOutcome,'none');assert.equal(result.diagnostics[0].code,'authority-required');assert.ok(result.diagnostics[0].effectId);assert.equal(result.diagnostics[0].sourceSpan.line,1);}
   else if(scenario==='disconnected'){assert.equal(result.externalOutcome,'unknown');assert.equal(result.resumeMode,'pending-effect');}
   const status=f.invoke('status',result.runId);assert.deepEqual(JSON.parse(status.stdout),result);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('T-M4-021 compiled provider cancellation distinguishes confirmed cleanup from unknown remote work',async()=>{
 for(const scenario of ['hold-unknown','hold-cancelled']){
  const dir=await mkdtemp(join(tmpdir(),'pel-fixture-provider-'));let child:ReturnType<typeof spawn>|undefined;
  try{const f=await executionFixture(dir);const script=Buffer.from(JSON.stringify({schemaVersion:1,events:['started','usage',scenario]}));await writeFile(join(dir,'provider-events.json'),script);
   const provider={profileId:'gpt-6-astra',transportId:'openai-responses',credentialProfileRef:'account:test',scenario,events:{relativePath:'provider-events.json',byteLength:script.byteLength,sha256:digest(script)}};
   await writeFile(f.manifest,JSON.stringify({...f.value,fixtures:{responses:[],execution:{...f.execution,capabilities:[...f.execution.capabilities,'fm/task'],provider}}}));await writeFile(f.source,'(fm/task :id "fixture-task" :input "artifact:approved-spec" :model "role:fixture" :output "schema:task-result-v1")');
   child=spawn(process.execPath,[entry,'--fixture-manifest',f.manifest,'run',f.source,'--json'],{cwd:dir,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout!.on('data',chunk=>{stdout+=chunk;});child.stderr!.on('data',chunk=>{stderr+=chunk;});const finished=new Promise<number|null>((resolve,reject)=>{child!.once('close',resolve);child!.once('error',reject);});
   for(let index=0;index<200&&!stderr.includes('\n');index++)await delay(10);assert.ok(stderr.includes('\n'),stdout+stderr);const runId=JSON.parse(stderr.split('\n')[0]!).runId as RunId;
   let dispatched=false;for(let index=0;index<200;index++){const records=await Effect.runPromise(readPelRecords(runId).pipe(Effect.provide(makeLiveRunJournalLayer(f.stateRoot))));if(records.some(record=>record.type==='pel.provider.cursor.v1')){dispatched=true;break;}await delay(10);}assert.equal(dispatched,true);
   const cancellation=f.invoke('cancel',runId);assert.equal(cancellation.status,5,cancellation.stdout+cancellation.stderr);const exit=await Promise.race([finished,delay(5000).then(()=>-1)]);assert.equal(exit,scenario==='hold-unknown'?3:4,stdout+stderr);const result=JSON.parse(stdout);assert.equal(result.externalOutcome,scenario==='hold-unknown'?'unknown':'none');assert.equal(result.usage.observed.inputTokens,2);assert.ok(result.diagnostics.length>0);
  }finally{child?.kill('SIGKILL');await rm(dir,{recursive:true,force:true});}
 }
});
test('T-M4-021 compiled manifest rejects expanded authority shell fields and changed provider scripts before allocation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pel-fixture-denial-'));
 try{const f=await executionFixture(dir);await writeFile(f.source,'1');
  for(const mutation of [{evidenceKind:'live-qualified'},{shell:'touch escaped'},{stateRoot:tmpdir()},{capabilities:['fm/publish']}]){await writeFile(f.manifest,JSON.stringify({...f.value,fixtures:{responses:[],execution:{...f.execution,...mutation}}}));const result=f.invoke('run',f.source);assert.equal(result.status,2,result.stdout+result.stderr);assert.deepEqual(await readdir(f.stateRoot),[]);}
  await writeFile(join(dir,'events.json'),'{}');const provider={profileId:'gpt-6-astra',transportId:'openai-responses',credentialProfileRef:'account:test',scenario:'completed',events:{relativePath:'events.json',byteLength:2,sha256:'a'.repeat(64)}};
  await writeFile(f.manifest,JSON.stringify({...f.value,fixtures:{responses:[],execution:{...f.execution,capabilities:[...f.execution.capabilities,'fm/task'],provider}}}));assert.equal(f.invoke('run',f.source).status,2);assert.deepEqual(await readdir(f.stateRoot),[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('T-M4-008 compiled provider race retains its winner and unknown remote loser across resume',async()=>{
 for(const failurePoint of ['none','after-race-decision']){
  const dir=await mkdtemp(join(tmpdir(),'pel-fixture-provider-race-'));
  try{const f=await executionFixture(dir,failurePoint),script=Buffer.from(JSON.stringify({schemaVersion:1,events:['started','usage','race-unknown']}));await writeFile(join(dir,'race-events.json'),script);
   const provider={profileId:'gpt-6-astra',transportId:'openai-responses',credentialProfileRef:'account:test',scenario:'race-unknown',events:{relativePath:'race-events.json',byteLength:script.byteLength,sha256:digest(script)}};
   await writeFile(f.manifest,JSON.stringify({...f.value,fixtures:{responses:[],execution:{...f.execution,capabilities:[...f.execution.capabilities,'fm/task'],provider}}}));
   const task='(fm/task :id "fixture-task" :input "artifact:approved-spec" :model "role:fixture" :output "schema:task-result-v1")';await writeFile(f.source,`(fm/race :tasks [(lambda [] ${task}) (lambda [] ${task})] :winner "first-valid")`);
   const initial=f.invoke('run',f.source);assert.equal(initial.status,failurePoint==='none'?3:1,initial.stdout+initial.stderr);const runId=JSON.parse(initial.stderr.trim().split('\n')[0]!).runId as RunId;
   const field=(value:PelDataValue,key:string):PelDataValue=>{assert.equal(value.tag,'list');if(value.tag!=='list')throw Error('association');const pair=value.items.find(pair=>pair.tag==='pair'&&pair.key===key);assert.ok(pair?.tag==='pair');return pair.value;};
   if(failurePoint==='none'){const result=JSON.parse(initial.stdout);assert.equal(result.externalOutcome,'unknown');assert.deepEqual(field(result.finalValue,'winner-index'),{tag:'number',value:2});const losers=field(result.finalValue,'losers');assert.ok(losers.tag==='list');assert.deepEqual(field(losers.items[0]!,'cancellation'),{tag:'string',value:'unknown'});}
   const records=await Effect.runPromise(readPelRecords(runId).pipe(Effect.provide(makeLiveRunJournalLayer(f.stateRoot))));
   const intents=records.filter(record=>record.type==='pel.effect.intent.v1');assert.equal(intents.length,2);assert.equal(records.filter(record=>record.type==='pel.race.decision.v1').length,1);
   const readArtifact=async(ref:{artifactId:string})=>JSON.parse(await readFile(join(f.stateRoot,'runs',runId,'artifacts',ref.artifactId),'utf8'));
   const children=new Map<string,PelChildStateV1>();for(const row of records){if(!row.type.startsWith('pel.'))continue;const decoded=decodePelRecordV1(row);assert.ok(decoded.ok);if(decoded.value.type==='pel.child-suspension.v1'){const child=decodePelChildStateV1(await readArtifact(decoded.value.data.childRef));assert.ok(child.ok);children.set(child.value.childInvocationId,child.value);}}
   assert.equal(children.size,2);assert.equal(new Set([...children.values()].map(child=>child.workspaceGrant.canonicalRoot)).size,2);
   const decisionRow=decodePelRecordV1(records.find(row=>row.type==='pel.race.decision.v1')!);assert.ok(decisionRow.ok&&decisionRow.value.type==='pel.race.decision.v1');const decision=decodePelRaceDecisionV1(await readArtifact(decisionRow.value.data.decisionRef));assert.ok(decision.ok);assert.equal(decision.value.winnerIndex,2);
   const winner=[...children.values()].find(child=>child.index===2);assert.ok(winner?.resultRef);const winnerReceipt=winner.resultRef;
   const resumed=f.invoke('resume',runId);assert.equal(resumed.status,3,resumed.stdout+resumed.stderr);const result=JSON.parse(resumed.stdout);assert.equal(result.externalOutcome,'unknown');assert.equal(result.resumeMode,'pending-effect');
   const after=await Effect.runPromise(readPelRecords(runId).pipe(Effect.provide(makeLiveRunJournalLayer(f.stateRoot))));assert.equal(after.filter(row=>row.type==='pel.effect.intent.v1').length,2);assert.equal(after.filter(row=>row.type==='pel.race.decision.v1').length,1);
   const started=async(rows:typeof after)=>{let count=0;for(const row of rows){if(!row.type.startsWith('pel.'))continue;const decoded=decodePelRecordV1(row);assert.ok(decoded.ok);if(decoded.value.type==='pel.effect.observed.v1'){const observation=await readArtifact(decoded.value.data.observationRef);assert.notEqual(observation.type,'fixture-resume-attempt','A committed race loser must never resume its saved provider cursor');if(observation.type==='started')count++;}}return count;};assert.equal(await started(records),2);assert.equal(await started(after),2);for(const row of after.slice(records.length)){if(!row.type.startsWith('pel.'))continue;const decoded=decodePelRecordV1(row);assert.ok(decoded.ok);if(decoded.value.type==='pel.child-suspension.v1'){const child=decodePelChildStateV1(await readArtifact(decoded.value.data.childRef));assert.ok(child.ok);if(child.value.childInvocationId===winner.childInvocationId)assert.deepEqual(child.value.resultRef,winnerReceipt);}}
   const ledger=await Effect.runPromise(Effect.flatMap(EndstopLedger,ledger=>ledger.status('fixture-contract')).pipe(Effect.provide(makeLiveEndstopLedgerLayer(f.stateRoot))));assert.equal(ledger.counts.implement,2);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('T-M4-020 compiled string predicate uses actual V2 evaluate and print receipts across recovery',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pel-fixture-predicate-'));
 try{const f=await executionFixture(dir,'after-checkpoint');const script=Buffer.from(JSON.stringify({schemaVersion:1,events:['started','usage','predicate-completed']}));await writeFile(join(dir,'predicate-events.json'),script);
  const provider={profileId:'gpt-6-astra',transportId:'openai-responses',credentialProfileRef:'account:test',scenario:'predicate-completed',events:{relativePath:'predicate-events.json',byteLength:script.byteLength,sha256:digest(script)}};
  await writeFile(f.manifest,JSON.stringify({...f.value,fixtures:{responses:[],execution:{...f.execution,capabilities:[...f.execution.capabilities,'pel/nl-condition'],provider}}}));
  await writeFile(f.source,'(case 2 ["is even" (print [1 2]) #t (print [0])])\n(fm/checkpoint :name "after-predicate")\n[1 2]');
  const stopped=f.invoke('run',f.source);assert.equal(stopped.status,1,stopped.stdout+stopped.stderr);assert.equal(JSON.parse(stopped.stdout).code,'journal-write-failed',stopped.stdout+stopped.stderr);const runId=JSON.parse(stopped.stderr.trim().split('\n')[0]!).runId as RunId;await writeFile(f.source,'0');
  const resumed=f.invoke('resume',runId);assert.equal(resumed.status,3,resumed.stdout+resumed.stderr);const result=JSON.parse(resumed.stdout);assert.equal(result.resumeMode,'final-value');assert.deepEqual(result.finalValue,{tag:'list',items:[{tag:'number',value:1},{tag:'number',value:2}]});assert.equal(result.outputs.length,1);assert.equal(result.usage.observed.inputTokens,2);
  const records=await Effect.runPromise(readPelRecords(runId).pipe(Effect.provide(makeLiveRunJournalLayer(f.stateRoot))));assert.equal(records.filter(record=>record.type==='pel.output.v1').length,1);assert.equal(records.filter(record=>record.type==='pel.effect.intent.v1').length,1);
  const intent=records.find(record=>record.type==='pel.effect.intent.v1')!;const payload=intent.payload as {data:{reservation:{operation:{effectiveAction:string;originReservationId:string;reservationId:string};familySha256:string;rootContractId:string;rootContractSha256:string}}};assert.equal(payload.data.reservation.operation.effectiveAction,'evaluate');assert.equal(payload.data.reservation.operation.originReservationId,payload.data.reservation.operation.reservationId);
  const ledger=await Effect.runPromise(Effect.flatMap(EndstopLedger,ledger=>ledger.familyStatus(payload.data.reservation)).pipe(Effect.provide(makeLiveEndstopLedgerLayer(f.stateRoot))));assert.equal(ledger.family.children['v040-t8-evaluation']!.counts.evaluate,1);
  assert.deepEqual(JSON.parse(f.invoke('status',runId).stdout),result);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("compiled fixture entry checks source and emits one preview", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pel-fixture-"));
  try {
    const source = join(dir, "source.pel");
    const { context, manifest } = await fixtureManifest(dir);
    await writeFile(source, "(+ 1 2)");
    const run = spawnSync(
      process.execPath,
      [
        entry,
        "--fixture-manifest",
        manifest,
        "plan",
        source,
        "--context",
        context,
        "--json",
      ],
      { encoding: "utf8", cwd: dir },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout).finalValueSummary, {
      kind: "known",
      value: { tag: "number", value: 3 },
    });
    assert.equal(run.stderr, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("fixture main import performs no invocation", () => {
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import './packages/orchestration/src/pel-cli-fixture-main.ts'`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
  assert.equal(run.stderr, "");
});

test("compiled production resolves its installed asset and rejects fixture manifest", async () => {
  const { build } = await import("esbuild");
  const { mkdir } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "pel-production-"));
  try {
    const runtime = join(dir, "runtime");
    const bundle = join(runtime, "dist", "foreman.js");
    const assetDir = join(runtime, "assets", "pel");
    const elsewhere = join(dir, "elsewhere");
    await mkdir(assetDir, { recursive: true });
    await mkdir(elsewhere);
    await writeFile(
      join(assetDir, "default-authoring-snapshot.json"),
      JSON.stringify(createDefaultAuthoringSnapshotV1()),
    );
    await build({
      entryPoints: [
        resolve("packages/orchestration/src/pel-authoring-main.ts"),
      ],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      logLevel: "silent",
    });
    const source = join(elsewhere, "source.pel");
    await writeFile(source, "(+ 1 2)");
    const good = spawnSync(
      process.execPath,
      [bundle, "check", source, "--json"],
      { encoding: "utf8", cwd: elsewhere },
    );
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).tag, "ok");
    assert.equal(good.stderr, "");
    const rejected = spawnSync(
      process.execPath,
      [bundle, "--fixture-manifest", "anything", "check", source, "--json"],
      { encoding: "utf8", cwd: elsewhere },
    );
    assert.equal(rejected.status, 2);
    assert.equal(JSON.parse(rejected.stdout).code, "PEL_CLI_USAGE");
    assert.equal(rejected.stderr, "");
    await rm(join(assetDir, "default-authoring-snapshot.json"));
    const absent = spawnSync(
      process.execPath,
      [bundle, "check", source, "--json"],
      { encoding: "utf8", cwd: elsewhere },
    );
    assert.equal(absent.status, 2);
    assert.match(
      JSON.parse(absent.stdout).input,
      /runtime\/assets\/pel\/default-authoring-snapshot.json$/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compiled fixture generation returns exact source and performs bounded local repair", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pel-generation-cli-"));
  try {
    const { context, manifest } = await fixtureManifest(dir, ["(", "(+ 1 2)"]);
    const args = [
      entry,
      "--fixture-manifest",
      manifest,
      "plan",
      "--prompt",
      "Produce arithmetic",
      "--model",
      "gpt-6-astra",
      "--transport",
      "openai-responses",
      "--context",
      context,
    ];
    const plain = spawnSync(process.execPath, args, {
      encoding: "utf8",
      cwd: dir,
    });
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stdout, "(+ 1 2)");
    assert.deepEqual(JSON.parse(plain.stderr).preview.finalValueSummary, {
      kind: "known",
      value: { tag: "number", value: 3 },
    });
    const json = spawnSync(process.execPath, [...args, "--json"], {
      encoding: "utf8",
      cwd: dir,
    });
    assert.equal(json.status, 0, json.stderr);
    const value = JSON.parse(json.stdout);
    assert.equal(value.attemptCount, 2);
    assert.equal(value.pelSource, "(+ 1 2)");
    assert.equal(json.stderr, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fixture manifest requires asset root, asset digest and bounded fixture records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pel-manifest-required-"));
  try {
    const fixture = await fixtureManifest(dir);
    for (const key of ["assetRoot", "assetManifestSha256", "fixtures"]) {
      const value: Record<string, unknown> = { ...fixture.value };
      delete value[key];
      await writeFile(fixture.manifest, JSON.stringify(value));
      const result = spawnSync(
        process.execPath,
        [
          entry,
          "--fixture-manifest",
          fixture.manifest,
          "plan",
          "--prompt",
          "One",
          "--model",
          "gpt-6-astra",
          "--transport",
          "openai-responses",
          "--json",
        ],
        { encoding: "utf8", cwd: dir },
      );
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.equal(JSON.parse(result.stdout).code, "PEL_SCHEMA");
      assert.equal(result.stderr, "");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fixture assets reject tampered content or manifest hashes before generation", async () => {
  for (const tamper of [
    "manifest-hash",
    "asset-bytes",
    "missing-root",
  ] as const) {
    const dir = await mkdtemp(join(tmpdir(), "pel-manifest-tamper-"));
    try {
      const fixture = await fixtureManifest(dir, ["1"]);
      if (tamper === "manifest-hash")
        await writeFile(
          fixture.manifest,
          JSON.stringify({
            ...fixture.value,
            assetManifestSha256: "0".repeat(64),
          }),
        );
      if (tamper === "asset-bytes") await writeFile(fixture.context, "{}");
      if (tamper === "missing-root")
        await rm(fixture.assetRoot, { recursive: true });
      const result = spawnSync(
        process.execPath,
        [
          entry,
          "--fixture-manifest",
          fixture.manifest,
          "plan",
          "--prompt",
          "One",
          "--model",
          "gpt-6-astra",
          "--transport",
          "openai-responses",
          "--json",
        ],
        { encoding: "utf8", cwd: dir },
      );
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.equal(result.stderr, "");
      assert.ok(
        ["PEL_SCHEMA", "PEL_INPUT"].includes(JSON.parse(result.stdout).code),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("fixture assets reject traversal, symlinks and context paths outside the bound root", async () => {
  for (const escape of ["record", "symlink", "context", "example"] as const) {
    const dir = await mkdtemp(join(tmpdir(), "pel-manifest-escape-"));
    try {
      const fixture = await fixtureManifest(dir);
      const outside = join(dir, "outside.json");
      await cp(fixture.context, outside);
      if (escape === "record") {
        const path = join(fixture.assetRoot, "manifest.json");
        const assets = JSON.parse(await readFile(path, "utf8"));
        assets.files[0].relativePath = "../outside.json";
        const text = JSON.stringify(assets);
        await writeFile(path, text);
        await writeFile(
          fixture.manifest,
          JSON.stringify({
            ...fixture.value,
            assetManifestSha256: digest(Buffer.from(text)),
          }),
        );
      }
      if (escape === "symlink") {
        await rm(fixture.context);
        await symlink(outside, fixture.context);
      }
      const args = [
        entry,
        "--fixture-manifest",
        fixture.manifest,
        "check",
        escape === "example"
          ? "examples/pel/../../../outside.json"
          : "examples/pel/repair.pel",
        "--json",
        ...(escape === "context" ? ["--context", outside] : []),
      ];
      const result = spawnSync(process.execPath, args, {
        encoding: "utf8",
        cwd: dir,
      });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.ok(
        ["PEL_SCHEMA", "PEL_INPUT"].includes(JSON.parse(result.stdout).code),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("fixture resolves bound examples and default snapshot independently of cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pel-manifest-default-"));
  try {
    const fixture = await fixtureManifest(dir);
    const result = spawnSync(
      process.execPath,
      [
        entry,
        "--fixture-manifest",
        fixture.manifest,
        "plan",
        "examples/pel/repair.pel",
        "--json",
      ],
      { encoding: "utf8", cwd: dir },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    assert.ok(JSON.parse(result.stdout).effects.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
