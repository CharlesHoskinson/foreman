/** Atomically replace derived research context. Immutable captures are never modified. */
import {dirname,basename,resolve,relative} from 'node:path';
import {rm,realpath,lstat} from 'node:fs/promises';
import {Effect,type Scope} from 'effect';
import {sha256Hex} from '@foreman/core';
import {writeAtomic} from './fm-session-main.js';
import {RESEARCH_BOUNDS,liveResearchReadPort,loadResearchBundle,inspectResearchSources,researchBytes,researchFailure,type ResearchFailureV1,type ResearchReadPortV1,type ResearchSnapshotV1} from './pel-research-context.js';
export interface ResearchRefreshPortsV1 {readonly reader?:ResearchReadPortV1;readonly beforePublish?:()=>Effect.Effect<void,ResearchFailureV1>;readonly write?:(path:string,bytes:Uint8Array)=>Effect.Effect<void,ResearchFailureV1>;}
export function refreshPelResearchBundle(input:{readonly bundleRoot:string;readonly snapshotPath:string},ports:ResearchRefreshPortsV1={}):Effect.Effect<{readonly schemaVersion:1;readonly snapshotSha256:string;readonly sourceCount:number},ResearchFailureV1>{
 const reader=ports.reader??liveResearchReadPort,write=ports.write??((path:string,bytes:Uint8Array)=>Effect.try({try:()=>writeAtomic(path,new TextDecoder('utf-8',{fatal:true}).decode(bytes)),catch:()=>researchFailure('failed','write-failed','The derived research snapshot could not be published.')}));
 return Effect.uninterruptibleMask(restore=>Effect.gen(function*(){
  const loaded=yield* restore(loadResearchBundle(input.bundleRoot,reader).pipe(Effect.mapError(error=>error.code==='bundle-missing'?researchFailure('invalid','bundle-missing','The explicitly selected captured bundle has no manifest.'):error)));
  const snapshotPath=resolve(input.snapshotPath),root=yield* restore(Effect.tryPromise({try:()=>realpath(input.bundleRoot),catch:()=>researchFailure('invalid','invalid-bundle','The captured bundle root is unavailable.')}));
  const outputs=[snapshotPath,snapshotPath+'.incomplete'];
  if(outputs.some(output=>output===resolve(root,'research-bundle.json')||loaded.bundle.sources.some(source=>[source.raw.path,source.clean.path].some(name=>output===resolve(root,name)))))return yield* Effect.fail(researchFailure('invalid','unsafe-output','Derived output cannot replace captured source bytes or their manifest.'));
  yield* restore(Effect.tryPromise({try:async()=>{const parent=await realpath(dirname(snapshotPath));if(parent!==dirname(snapshotPath))throw Error('Symlink output');for(const output of outputs){try{const info=await lstat(output);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe output');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}},catch:()=>researchFailure('invalid','unsafe-output','The derived output location is unsafe.')}));
  const previous=yield* restore(reader.read(dirname(snapshotPath),basename(snapshotPath),RESEARCH_BOUNDS.snapshotBytes));
  const rows=yield* restore(inspectResearchSources(root,loaded.bundle,reader));
  if(rows.some(row=>row.freshness!=='fresh'))return yield* Effect.fail(researchFailure('invalid','source-provenance-invalid','The captured source is missing or differs from its manifest.'));
  const snapshot:ResearchSnapshotV1={schemaVersion:1,bundleDigest:loaded.digest,bundle:loaded.bundle,results:rows,sourceRoot:root},bytes=researchBytes(snapshot);
  if(bytes.length>RESEARCH_BOUNDS.snapshotBytes)return yield* Effect.fail(researchFailure('invalid','snapshot-bound','The derived snapshot exceeds its bound.'));
  // Invalid replacement inputs do not affect the selected snapshot. The marker
  // begins publication, and remains if that publication is interrupted.
  yield* write(snapshotPath+'.incomplete',researchBytes({schemaVersion:1,previousSnapshotSha256:previous?sha256Hex(previous):null}));
  if(ports.beforePublish)yield* restore(ports.beforePublish());
  yield* write(snapshotPath,bytes);
  yield* Effect.tryPromise({try:()=>rm(snapshotPath+'.incomplete',{force:true}),catch:()=>researchFailure('failed','cleanup-failed','The derived snapshot is complete but refresh metadata cleanup failed.')});
  return {schemaVersion:1 as const,snapshotSha256:sha256Hex(bytes),sourceCount:rows.length};
 })).pipe(Effect.scoped);
}

export interface ResearchCliServices {
 readonly query:(input:{readonly query:string;readonly limit:number;readonly vault?:string})=>Effect.Effect<import('./pel-research-context.js').ResearchContextV1,ResearchFailureV1>;
 readonly status:(input:{readonly vault?:string})=>Effect.Effect<Omit<import('./pel-research-context.js').ResearchContextV1,'query'>,ResearchFailureV1>;
 readonly refresh:(input:{readonly bundle:string})=>Effect.Effect<{readonly schemaVersion:1;readonly snapshotSha256:string;readonly sourceCount:number},ResearchFailureV1>;
}
/** Installed immutable defaults plus one writable advisory snapshot. No network or provider ports. */
export function makePelResearchCliServices(options:{readonly entryUrl:string;readonly foremanHome:string;readonly checkoutRoot?:string;readonly derivedSnapshotPath?:string}):ResearchCliServices {
 const snapshotPath=options.derivedSnapshotPath??resolve(options.foremanHome,'research','snapshot.json');
 const context=Effect.gen(function*(){
  const {fileURLToPath}=yield* Effect.promise(()=>import('node:url'));
  let installed:string;try{installed=fileURLToPath(new URL('../assets/pel/research/',options.entryUrl));}catch{return yield* Effect.fail(researchFailure('invalid','invalid-entry','The installed research entry is not a local file URL.'));}
  let bundleRoot=installed;if(!(yield* liveResearchReadPort.directory(installed))&&options.checkoutRoot)bundleRoot=resolve(options.checkoutRoot,'docs/research/pel-release');
  const {makePelResearchContextService}=yield* Effect.promise(()=>import('./pel-research-context.js'));return makePelResearchContextService({bundleRoot,snapshotPath});
 });
 return {query:input=>Effect.flatMap(context,service=>service.query({text:input.query,limit:input.limit,...(input.vault?{vault:input.vault}:{})})),status:input=>Effect.flatMap(context,service=>service.status(input)),refresh:input=>Effect.gen(function*(){
  if(!input.bundle||!input.bundle.isWellFormed()||Buffer.byteLength(input.bundle)>4096||input.bundle.includes('\0'))return yield* Effect.fail(researchFailure('invalid','invalid-bundle','The captured bundle path is invalid.'));
  const bundleRoot=yield* Effect.tryPromise({try:()=>realpath(input.bundle),catch:()=>researchFailure('invalid','invalid-bundle','The selected captured bundle does not exist.')});
  // Validate the selected bundle before creating derived cache directories.
  yield* loadResearchBundle(bundleRoot).pipe(Effect.mapError(error=>error.code==='bundle-missing'?researchFailure('invalid','bundle-missing','The explicitly selected captured bundle has no manifest.'):error));
  yield* Effect.tryPromise({try:async()=>{const {mkdir}=await import('node:fs/promises');await mkdir(dirname(snapshotPath),{recursive:true,mode:0o700});if(await realpath(dirname(snapshotPath))!==dirname(snapshotPath))throw Error('Symlink cache');},catch:()=>researchFailure('failed','cache-unavailable','The advisory research cache is unavailable.')});
  return yield* refreshPelResearchBundle({bundleRoot,snapshotPath});
 })};
}
