/** The research host reads admitted immutable context and never dispatches an external action. */
import {Effect} from 'effect';
import {canonicalize,sha256Hex} from '@foreman/core';
import {validateDataSchema,type HostRequestV1,type PelDataValue} from '@foreman/pel';
import {PelRuntime,decodePelArtifactRefV1,type ForemanProjectV1,type HostContextV1,type PelArtifactRefV1,type PelHostEffectFailureV1,type PelPreparedHandlerV1,type ResourceSetV1,type RunFailure} from './pel-run-contract.js';
import {RESEARCH_BOUNDS,decodeResearchBundleV1,parseResearchJson,makePelResearchContextService,researchFailure,type ResearchReadPortV1,type ResearchContextV1,type ResearchFailureV1} from './pel-research-context.js';
import {pelFailure} from './pel-journal.js';
export interface AdmittedResearchBundleV1 {
 readonly bundleId:string;readonly indexRef:PelArtifactRefV1;readonly sources:readonly PelArtifactRefV1[];readonly resources:ResourceSetV1;readonly includesExternalVault:boolean;
 readonly query:(input:{readonly text:string;readonly limit:number})=>Effect.Effect<ResearchContextV1,ResearchFailureV1>;
}
export interface PelResearchHostPortsV1<R=never> {readonly resolveBundle:(id:string,context:HostContextV1)=>Effect.Effect<AdmittedResearchBundleV1,PelHostEffectFailureV1|RunFailure,R>;}
const failure=(code:PelHostEffectFailureV1['code'],message:string):PelHostEffectFailureV1=>({code,message});
const text=(request:HostRequestV1,name:string,max:number)=>{const value=request.boundArguments[name];return value?.tag==='string'&&value.value.length>0&&Buffer.byteLength(value.value)<=max&&!/[\u0000-\u001f\u007f]/u.test(value.value)?value.value:null;};
const string=(value:string):PelDataValue=>({tag:'string',value});
const list=(items:readonly PelDataValue[]):PelDataValue=>({tag:'list',items});
const association=(rows:readonly (readonly [string,PelDataValue])[]):PelDataValue=>list(rows.map(([key,value])=>({tag:'pair',key,value})));
export function makePelResearchHandler<R extends PelRuntime=never>(ports:PelResearchHostPortsV1<R>){
 const prepare=(request:HostRequestV1,context:HostContextV1)=>Effect.gen(function*(){
  const id=text(request,'id',256),query=text(request,'query',4096),bundle=text(request,'bundle',256),limitValue=request.boundArguments.limit,limit=limitValue===undefined?5:limitValue.tag==='number'?limitValue.value:NaN;
  if(request.registryId!=='fm/research'||request.expectedResultSchemaId!=='schema:research-result-v1'||!id||!query||!bundle||!/^bundle:[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(bundle)||!Number.isSafeInteger(limit)||limit<1||limit>20||Object.keys(request.boundArguments).some(k=>!['id','query','bundle','limit'].includes(k)))return yield* Effect.fail(failure('capability-denied','The research arguments are outside their admitted bounds.'));
  if(!context.checked.snapshot.policy.allowedCapabilities.includes('research.read'))return yield* Effect.fail(failure('capability-denied','Research reads are not admitted.'));
  const selected=yield* ports.resolveBundle(bundle,context);
  if(selected.bundleId!==bundle||selected.resources.writes.length||selected.resources.unknownScope||selected.sources.length>1024||![selected.indexRef,...selected.sources].every(ref=>decodePelArtifactRefV1(ref).ok))return yield* Effect.fail(failure('resource-denied','The research bundle changed its immutable read binding.'));
  if(selected.includesExternalVault&&!context.checked.snapshot.policy.allowedCapabilities.includes('vault.read'))return yield* Effect.fail(failure('capability-denied','External vault reads are not admitted.'));
  const result=yield* selected.query({text:query,limit}).pipe(Effect.mapError(error=>failure(error.outcome==='invalid'?'task-output-invalid':'artifact-missing',error.message)));
  if(result.query!==query||result.results.length>limit||result.results.some(row=>!/^[a-f0-9]{64}$/u.test(row.sourceHash)||typeof row.capturedAt!=='string'||row.freshness==='uncaptured'||row.observedAt!==undefined))return yield* Effect.fail(failure('task-output-invalid','Research output differs from its bounded query or source hashes.'));
  const value=association([['status',string(result.status)],['results',list(result.results.map(row=>association([
   ['sourceLocator',string(row.sourceLocator)],['sourceHash',string(row.sourceHash)],['capturedAt',string(row.capturedAt!)],['claimClass',string(row.claimClass)],['freshness',string(row.freshness)],['excerpt',string(row.excerpt)],['coverage',list([...new Set([...row.coverage,...result.warnings,...(result.graph?.coverage??[])])].slice(0,20).map(string))]
  ])))]]);
  const schema=context.checked.snapshot.registry.dataSchemas[request.expectedResultSchemaId];if(!schema||!validateDataSchema(value,schema))return yield* Effect.fail(failure('task-output-invalid','Research output does not match the canonical host schema.'));
  const byId=new Map<string,PelArtifactRefV1>();for(const ref of [selected.indexRef,...selected.sources]){const previous=byId.get(ref.artifactId);if(previous&&canonicalize(previous)!==canonicalize(ref))return yield* Effect.fail(failure('resource-denied','One research artifact changed its immutable metadata.'));byId.set(ref.artifactId,ref);}const sources=[...byId.values()];
  const preparationDigest=sha256Hex(canonicalize({id,query,bundle,limit,indexRef:selected.indexRef,sources,resources:selected.resources,value}));
  return {kind:'read-result' as const,value,sources,preparationDigest};
 });
 return {prepare,dispatch:()=>Effect.fail(failure('capability-denied','Read-only research preparation cannot dispatch an external action.'))} satisfies PelPreparedHandlerV1;
}

export interface PelResearchIndexExpansionV1 {readonly bundleId:string;readonly indexRef:PelArtifactRefV1;readonly sources:readonly PelArtifactRefV1[];readonly resources:ResourceSetV1;readonly bundle:import('./pel-research-context.js').ResearchBundleV1;}
/** Derive references from the one immutable index; never accept filesystem paths as runtime authority. */
export function decodePelResearchIndexExpansion(bundleId:string,indexRef:PelArtifactRefV1,bytes:Uint8Array):PelResearchIndexExpansionV1|null {
 try{if(bytes.byteLength!==indexRef.byteLength||sha256Hex(bytes)!==indexRef.sha256)return null;const bundle=parseResearchJson(bytes);if(!decodeResearchBundleV1(bundle)||bundle.bundleId!==bundleId)return null;
 const references=new Map<string,PelArtifactRefV1>();let total=0;for(const source of bundle.sources)for(const file of [source.raw,source.clean]){const ref={artifactId:`sha256-${file.sha256}`,sha256:file.sha256,byteLength:file.byteLength},previous=references.get(ref.artifactId);if(previous&&previous.byteLength!==ref.byteLength)return null;if(!previous){references.set(ref.artifactId,ref);total+=ref.byteLength;}}if(total>RESEARCH_BOUNDS.totalBytes)return null;
 const sources=[...references.values()],reads=[...new Set([indexRef,...sources].map(ref=>`artifact:${ref.artifactId}`))].sort();return {bundleId,indexRef,sources,resources:{reads,writes:[]},bundle};
 }catch{return null;}
}
export function loadPelResearchBundleInputs(project:Pick<ForemanProjectV1,'researchBundles'>,read:(ref:PelArtifactRefV1,maxBytes:number)=>Effect.Effect<Uint8Array,RunFailure>){return Effect.gen(function*(){
 const inputs=new Map<string,{ref:PelArtifactRefV1;bytes:Uint8Array}>();let total=0;
 const retain=(ref:PelArtifactRefV1,max:number)=>Effect.gen(function*(){const prior=inputs.get(ref.artifactId);if(prior){if(canonicalize(prior.ref)!==canonicalize(ref))return yield* Effect.fail(pelFailure('binding-mismatch','Research input metadata changed for the same content identity.'));return prior.bytes;}const bytes=yield* read(ref,max);if(bytes.byteLength!==ref.byteLength||sha256Hex(bytes)!==ref.sha256)return yield* Effect.fail(pelFailure('binding-mismatch','A research input differs from its registered immutable hash.'));total+=bytes.byteLength;if(total>RESEARCH_BOUNDS.totalBytes)return yield* Effect.fail(pelFailure('binding-mismatch','Research inputs exceed the total byte bound.'));inputs.set(ref.artifactId,{ref,bytes});return bytes;});
 for(const [id,ref] of Object.entries(project.researchBundles??{})){const bytes=yield* retain(ref,RESEARCH_BOUNDS.manifestBytes),expanded=decodePelResearchIndexExpansion(id,ref,bytes);if(!expanded)return yield* Effect.fail(pelFailure('binding-mismatch','The registered research index is missing, changed, or invalid.'));for(const source of expanded.sources)yield* retain(source,RESEARCH_BOUNDS.sourceBytes);}
 return [...inputs.values()];
});}
export function resolvePelResearchIndex(request:HostRequestV1,context:HostContextV1){return Effect.gen(function*(){
 const id=text(request,'bundle',256),ref=id?context.project.researchBundles?.[id]:undefined;if(!id||!ref||!context.checked.snapshot.policy.resourceEnvelope.reads.includes(id))return yield* Effect.fail(failure('resource-denied','The research bundle is not in the original admitted index map.'));
 const runtime=yield* PelRuntime,bytes=yield* runtime.artifacts.get(context.binding.runId,ref,RESEARCH_BOUNDS.manifestBytes).pipe(Effect.mapError(()=>failure('artifact-missing','The original research index is unavailable or changed.'))),expanded=decodePelResearchIndexExpansion(id,ref,bytes);if(!expanded)return yield* Effect.fail(failure('task-output-invalid','The original research index is invalid.'));
 if(expanded.bundle.includesExternalVault&&!context.checked.snapshot.policy.allowedCapabilities.includes('vault.read'))return yield* Effect.fail(failure('capability-denied','The admitted research index requires vault.read.'));return expanded;
});}
/** Production factory consumes only run-owned immutable index/source bytes. */
export function makePelImmutableResearchHandler(){return makePelResearchHandler({resolveBundle:(id,context)=>Effect.gen(function*(){
 const request={boundArguments:{bundle:string(id)}} as unknown as HostRequestV1,expanded=yield* resolvePelResearchIndex(request,context),runtime=yield* PelRuntime;
 const files=new Map(expanded.bundle.sources.flatMap(row=>[row.raw,row.clean]).map(file=>[file.path,file]));
 const reader:ResearchReadPortV1={directory:()=>Effect.succeed(false),read:(_root,path,max)=>Effect.gen(function*(){if(path==='research-bundle.json')return yield* runtime.artifacts.get(context.binding.runId,expanded.indexRef,max).pipe(Effect.mapError(()=>researchFailure('failed','index-unavailable','The original research index is unavailable.')));const file=files.get(path);if(!file)return yield* Effect.fail(researchFailure('invalid','unadmitted-source','The index did not admit this source.'));return yield* runtime.artifacts.get(context.binding.runId,{artifactId:`sha256-${file.sha256}`,sha256:file.sha256,byteLength:file.byteLength},max).pipe(Effect.mapError(()=>researchFailure('failed','source-unavailable','An immutable research source is unavailable.')));})};
 const service=makePelResearchContextService({bundleRoot:'immutable:research',reader});return {...expanded,includesExternalVault:expanded.bundle.includesExternalVault??false,query:service.query};
})});}
