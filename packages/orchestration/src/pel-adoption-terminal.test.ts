import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,readlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Effect} from 'effect';
import {canonicalize} from '@foreman/core';
import {createPelEnvironment,startPel} from '@foreman/pel';
import {packageFixture} from './fixtures/pel-install/package-fixture.js';
import {pelHostFixture} from './pel-host-test-fixture.js';
import {appendPelRecord} from './pel-journal.js';
import {makeInstallManifest} from './pel-package.js';
import {installPackage} from './pel-install.js';
import {makeLivePelAdoptionServices} from './pel-adoption.js';
import {makePelInstalledAdmission} from './pel-install-admission.js';

test('T-M6-017 terminal failure permits rollback and retained original build can admit a later revision',async()=>{
 const f=await packageFixture(),run=pelHostFixture('(fm/checkpoint "failed")');
 try{
  await Effect.runPromise(run.provide(Effect.gen(function*(){
   const v=yield* run.setup,b=v.context.binding,s=v.context.checked.snapshot;
   const step=startPel(v.context.checked.program,createPelEnvironment(s.registry),s.limits,s.options);
   yield* appendPelRecord(b,'pel.run-result.v1',{resultRef:yield* v.put({
    schemaVersion:1,runId:b.runId,state:'failed',externalOutcome:'none',updatedAt:v.now,
    programDigest:b.checkedProgramDigest,attempt:b.attempt,finalValue:null,artifacts:[],receipts:[],outputs:[],
    usage:{observed:{providerCounters:{}},reservedCostUsd:0,unresolvedEffectIds:[],counters:step.counters},diagnostics:[],
   })});
  })));
  const journal=join(run.root,'runs/host-run/events.ndjson'),before=await readFile(journal);
  const original=f.manifest;
  await Effect.runPromise(installPackage({sourceRoot:f.sourceRoot,prefix:f.prefix}));
  const entry=(id:string)=>pathToFileURL(join(f.prefix,'versions',id,'runtime/dist/foreman.js')).href;
  const originalAdmission=makePelInstalledAdmission(entry(original.buildId),f.root);
  const {buildId:_,...payload}=original;
  const incompatible=makeInstallManifest({...payload,runtimeCompatibility:{runtimeVersion:'1',runtimeHandlerVersion:'older'}});
  await writeFile(join(f.sourceRoot,'manifest.json'),canonicalize(incompatible)+'\n');
  await Effect.runPromise(installPackage({sourceRoot:f.sourceRoot,prefix:f.prefix}));
  const services=makeLivePelAdoptionServices({entryUrl:entry(incompatible.buildId),foremanHome:f.root,loadRegisteredRoots:()=>Effect.succeed([run.root])});
  await Effect.runPromise(services.rollback(original.buildId));
  await Effect.runPromise(services.rollback(incompatible.buildId));
  assert.equal(await readlink(join(f.prefix,'current')),`versions/${incompatible.buildId}`);
  let admitted=0;
  const stale=await Effect.runPromise(originalAdmission(Effect.sync(()=>{admitted++;})).pipe(Effect.either));
  assert.equal(stale._tag,'Left');assert.equal(admitted,0);
  await Effect.runPromise(services.rollback(original.buildId));
  await Effect.runPromise(originalAdmission(Effect.sync(()=>{admitted++;})));
  assert.equal(admitted,1);
  assert.equal(await readlink(join(f.prefix,'current')),`versions/${original.buildId}`);
  assert.deepEqual(await readFile(journal),before);
 }finally{run.close();await f.close();}
});
