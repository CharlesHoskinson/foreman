/** Explicit test-entry research inputs. Product assembly never imports this fixture. */
import {join} from 'node:path';
import {Effect} from 'effect';
import {sha256Hex} from '@foreman/core';
import type {AuthoringSnapshotV1} from '@foreman/pel';
import {authoringFailure} from './pel-authoring-contract.js';
import {decodePelExecutionFixture,makePelExecutionFixtureServices,type PelExecutionFixtureV1} from './pel-cli-execution-fixture.js';
import {decodePelResearchIndexExpansion,loadPelResearchBundleInputs} from './pel-research-host.js';
import {pelFailure} from './pel-journal.js';
import type {PelArtifactRefV1} from './pel-run-contract.js';
const object=(x:unknown):x is Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const bad=()=>authoringFailure('PEL_SCHEMA','Invalid explicit research fixture manifest.');
export interface PelResearchFixtureV1 {readonly execution:PelExecutionFixtureV1;readonly bundles:Readonly<Record<string,string>>;}
export function decodePelResearchFixture(value:unknown,assetRoot:string){return Effect.gen(function*(){
 if(!object(value)||!object(value.bundles)||!Array.isArray(value.capabilities)||value.capabilities.length!==1||value.capabilities[0]!=='fm/research'||!['m6-research-prepare','m6-parallel-read'].includes(String(value.fixtureId)))return yield* Effect.fail(bad());
 const {bundles,...execution}=value,decoded=yield* decodePelExecutionFixture({...execution,capabilities:['print']},assetRoot);
 if(decoded.provider||decoded.failurePoint!=='none'||decoded.printDelayMs!==0)return yield* Effect.fail(bad());
 const expected=value.fixtureId==='m6-research-prepare'?{'bundle:release-sources':'fixtures/pel-research/research-bundle.json'}:{'bundle:pel-paper':'fixtures/pel-research/pel-paper.json','bundle:model-evidence':'fixtures/pel-research/model-evidence.json'};
 if(JSON.stringify(Object.entries(bundles).sort())!==JSON.stringify(Object.entries(expected).sort()))return yield* Effect.fail(bad());
 return {execution:{...decoded,capabilities:['fm/research']},bundles:bundles as Record<string,string>} satisfies PelResearchFixtureV1;
});}
export function makePelResearchFixtureServices(fixture:PelResearchFixtureV1,snapshot:AuthoringSnapshotV1,manifestHash:string,manifestBytes:Uint8Array,assetRoot:string,assets:ReadonlyMap<string,Uint8Array>){return Effect.gen(function*(){
 const researchBundles:Record<string,PelArtifactRefV1>={},content=new Map<string,Uint8Array>();
 for(const [id,name] of Object.entries(fixture.bundles)){
  const bytes=assets.get(join(assetRoot,name));if(!bytes)return yield* Effect.fail(bad());const indexRef={artifactId:`sha256-${sha256Hex(bytes)}`,sha256:sha256Hex(bytes),byteLength:bytes.byteLength},expanded=decodePelResearchIndexExpansion(id,indexRef,bytes);if(!expanded||expanded.bundle.includesExternalVault)return yield* Effect.fail(bad());researchBundles[id]=indexRef;content.set(indexRef.sha256,bytes);
  for(const source of expanded.bundle.sources)for(const file of [source.raw,source.clean]){const captured=assets.get(join(assetRoot,'fixtures/pel-research',file.path));if(!captured||sha256Hex(captured)!==file.sha256||captured.byteLength!==file.byteLength)return yield* Effect.fail(bad());content.set(file.sha256,captured);}
 }
 const retainedInputs=yield* loadPelResearchBundleInputs({researchBundles},ref=>{const bytes=content.get(ref.sha256);return bytes?Effect.succeed(bytes):Effect.fail(pelFailure('binding-mismatch','The explicit research fixture source is absent.'));}).pipe(Effect.mapError(bad));
 return yield* makePelExecutionFixtureServices(fixture.execution,snapshot,manifestHash,manifestBytes,{researchBundles,retainedInputs});
});}
