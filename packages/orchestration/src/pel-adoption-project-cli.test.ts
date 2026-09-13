import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,cp} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {Effect} from 'effect';
import {canonicalize,sha256Hex} from '@foreman/core';
import {verifyPelPackage} from './pel-package.js';
import {packageFixture} from './fixtures/pel-install/package-fixture.js';
import {makeLiveRunJournalLayer,type RunId} from '@foreman/event-log';
import {readPelRecords,replayPelRun} from './pel-journal.js';
import {decodeExecutionContractV1,isExecutionContractFailure} from './execution-contract.js';
import {pelAuthorityFileBytes} from './pel-project-authority.js';
import {EndstopLedger,makeLiveEndstopLedgerLayer} from './execution-ledger.js';

const entry=resolve(process.env.FOREMAN_PEL_ACCEPTANCE_FIXTURE_ENTRY??'packages/orchestration/dist-test/pel-cli-fixture.js');
test('T-M6-002/T-M6-019 compiled project configure writes canonical settings and bare run uses the registered project',async t=>{
 const packaged=process.env.FOREMAN_PEL_ACCEPTANCE_PACKAGE_ROOT?null:await packageFixture();
 const packageRoot=resolve(process.env.FOREMAN_PEL_ACCEPTANCE_PACKAGE_ROOT??packaged!.sourceRoot);
 const root=await mkdtemp(join(tmpdir(),'pel-adoption-project-'));
 try{
  // The fallback is an explicitly synthetic package, with exact shipped source bytes. Release acceptance supplies the verified extracted package.
  if(packaged){await cp(resolve('examples/pel/implement-verify-review.pel'),join(packageRoot,'examples/pel/implement-verify-review.pel'));await packaged.seal();}
  const verified=await Effect.runPromise(verifyPelPackage(packageRoot)),originalManifest=await readFile(join(packageRoot,'manifest.json'));
  const assetRoot=join(root,'assets'),stateRoot=join(root,'state');await mkdir(assetRoot);await mkdir(stateRoot);
  const selected=['runtime/assets/pel/default-authoring-snapshot.json','examples/pel/implement-verify-review.pel'];
  const files=[];
  for(const path of selected){const file=verified.files.find(row=>row.record.path===path);assert.ok(file);await mkdir(dirname(join(assetRoot,path)),{recursive:true});await writeFile(join(assetRoot,path),file.bytes);files.push({relativePath:path,byteLength:file.record.byteLength,sha256:file.record.sha256});}
  const settingsPath='fixtures/pel-adoption/project-settings.json',settings=await readFile(resolve('packages/orchestration/src',settingsPath));await mkdir(dirname(join(assetRoot,settingsPath)),{recursive:true});await writeFile(join(assetRoot,settingsPath),settings);files.push({relativePath:settingsPath,byteLength:settings.length,sha256:sha256Hex(settings)});
  // The product manifest is retained verbatim. Only this separate test asset copy receives a bounded sidecar.
  await writeFile(join(assetRoot,'manifest.json'),originalManifest);
  const sidecar=Buffer.from(canonicalize({schemaVersion:1,files})+'\n');await writeFile(join(assetRoot,'fixture-assets.json'),sidecar);
  const delivery={schemaVersion:1,evidenceKind:'test-fixture',fixtureId:'m6-project-configure',temporaryRoot:root,stateRoot,now:Date.now(),scenario:'approved',roles:'grok-sol',failurePoint:'none'};
  const manifest=join(root,'fixture.json');await writeFile(manifest,canonicalize({schemaVersion:1,assetRoot,assetManifestFile:'fixture-assets.json',assetManifestSha256:sha256Hex(sidecar),fixtures:{responses:[],delivery}})+'\n');
  const invoke=(args:readonly string[])=>spawnSync(process.execPath,[entry,'--fixture-manifest',manifest,...args,'--json'],{cwd:root,encoding:'utf8',timeout:45000});
  const zero=async()=>{const state=await Effect.runPromise(Effect.flatMap(EndstopLedger,p=>p.status('delivery-fixture-contract')).pipe(Effect.provide(makeLiveEndstopLedgerLayer(stateRoot))));assert.ok(Object.values(state.counts).every(count=>count===0));const names=await readdir(join(stateRoot,'runs')).catch(()=>[]);assert.deepEqual(names,['delivery-fixture-contract']);};
  const missing=invoke(['run','examples/pel/implement-verify-review.pel']);assert.equal(missing.status,2,missing.stdout+missing.stderr);assert.doesNotMatch(missing.stderr,/run-started/);await zero();
  const concrete=join(stateRoot,'project-settings.json'),project=JSON.parse(await readFile(concrete,'utf8'));
  const configured=invoke(['project','configure','--settings',concrete]);assert.equal(configured.status,0,configured.stdout+configured.stderr);assert.equal(JSON.parse(configured.stdout).outcome,'configured');
  const stored=join(root,'workspace/.git/foreman/project.json');assert.deepEqual(JSON.parse(await readFile(stored,'utf8')),project);
  const registry=JSON.parse(await readFile(join(root,'home/projects.json'),'utf8'));assert.equal(registry.projects.length,1);assert.equal(registry.projects[0].project_id,project.projectId);assert.equal(registry.projects[0].git_common_dir,project.repository.gitCommonDir);assert.equal(registry.projects[0].store_location,stateRoot);await zero();
  const valid=await readFile(stored);await writeFile(stored,'{"schemaVersion":1,"invalid":true}');
  const invalid=invoke(['run','examples/pel/implement-verify-review.pel']);assert.equal(invalid.status,2,invalid.stdout+invalid.stderr);assert.doesNotMatch(invalid.stderr,/run-started/);await zero();await writeFile(stored,valid);
  const product=spawnSync(process.execPath,[join(packageRoot,'runtime/dist/foreman.js'),'--fixture-manifest',manifest,'run','examples/pel/implement-verify-review.pel','--json'],{cwd:join(root,'workspace'),env:{...process.env,FOREMAN_HOME:join(root,'home')},encoding:'utf8',timeout:15000});assert.equal(product.status,2,product.stdout+product.stderr);await zero();
  const contractBytes=await readFile(join(stateRoot,'project-inputs',project.projectId,project.executionContractTemplate.artifactId));const contractValue=JSON.parse(contractBytes.toString('utf8'));assert.equal(isExecutionContractFailure(decodeExecutionContractV1(contractValue)),false);assert.deepEqual(contractBytes,Buffer.from(pelAuthorityFileBytes(contractValue)));
  const authorityBytes=await readFile(join(stateRoot,'project-inputs',project.projectId,project.authorityRefs[0].authorityRef.artifactId));assert.deepEqual(authorityBytes,Buffer.from(pelAuthorityFileBytes(JSON.parse(authorityBytes.toString('utf8')))));
  const productAuthority=spawnSync(process.execPath,[join(packageRoot,'runtime/dist/foreman.js'),'run',join(assetRoot,'examples/pel/implement-verify-review.pel'),'--json'],{cwd:join(root,'workspace'),env:{...process.env,FOREMAN_HOME:join(root,'home')},encoding:'utf8',timeout:15000});assert.equal(productAuthority.status,2,productAuthority.stdout+productAuthority.stderr);const refusal=JSON.parse(productAuthority.stdout||productAuthority.stderr);assert.equal(refusal.code,'binding-mismatch');assert.deepEqual(refusal.diagnostics,[{message:'The registered authorization is opaque or lacks a supported typed project scope.'}]);assert.doesNotMatch(productAuthority.stderr,/run-started/);await zero();
  const run=invoke(['run','examples/pel/implement-verify-review.pel']);assert.equal(run.status,0,run.stdout+run.stderr);const result=JSON.parse(run.stdout);assert.equal(result.state,'succeeded');assert.equal(result.evidenceKind,'test-fixture');assert.equal(result.checks.passed,true);assert.equal(result.review.verdict,'approved');
  const counts=await Effect.runPromise(Effect.flatMap(EndstopLedger,p=>p.status('delivery-fixture-contract')).pipe(Effect.provide(makeLiveEndstopLedgerLayer(stateRoot))));assert.equal(counts.counts.implement,1);assert.equal(counts.counts.verify,1);assert.equal(counts.counts.audit,1);
  const status=invoke(['status',result.runId]);assert.equal(status.status,0,status.stdout+status.stderr);assert.deepEqual(JSON.parse(status.stdout),result);
  const history=replayPelRun(await Effect.runPromise(readPelRecords(result.runId as RunId).pipe(Effect.provide(makeLiveRunJournalLayer(stateRoot)))));assert.equal(history.ok,true);if(!history.ok||!history.value.bindingRef)throw Error('Expected admitted execution binding');
  const runArtifact=(id:string)=>readFile(join(stateRoot,'runs',result.runId,'artifacts',id),'utf8').then(bytes=>JSON.parse(bytes));
  const binding=await runArtifact(history.value.bindingRef.artifactId);assert.equal(binding.evidenceKind,'test-fixture');assert.equal(binding.stateRoot,project.stateRoot);assert.deepEqual(binding.authority,project.authorityRefs[0]);assert.deepEqual(binding.limits.execution,project.limits.execution);
  const captured=await runArtifact(binding.artifacts.configuration.artifactId);assert.deepEqual(captured,project);const snapshot=await runArtifact(binding.artifacts.snapshot.artifactId);assert.deepEqual(snapshot.roleBindings,project.roleBindings);
  const fixtureAuthority=await runArtifact(project.authorityRefs[0].authorityRef.artifactId);assert.equal(fixtureAuthority.fixtures.delivery.evidenceKind,'test-fixture');
  assert.deepEqual(await readFile(join(packageRoot,'manifest.json')),originalManifest);assert.deepEqual(await readFile(join(assetRoot,'manifest.json')),originalManifest);
  assert.equal((await Effect.runPromise(verifyPelPackage(packageRoot))).manifest.buildId,verified.manifest.buildId);
  t.diagnostic(canonicalize({evidenceKind:'test-fixture',packageBuildId:verified.manifest.buildId,packageSource:packaged?'synthetic-test-package':'verified-extracted-package',files:files.filter(file=>selected.includes(file.relativePath)),runId:result.runId}));
 }finally{await rm(root,{recursive:true,force:true});await packaged?.close();}
});
