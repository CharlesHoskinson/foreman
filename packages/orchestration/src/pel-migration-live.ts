/** Installed migration uses registered project authority and publishes only new bounded files. */
import {constants,openSync,closeSync,fstatSync,readSync,writeSync,fsyncSync,linkSync,unlinkSync,lstatSync,realpathSync} from 'node:fs';
import {basename,dirname,join,resolve,parse,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Effect,Either} from 'effect';
import {canonicalize,sha256Hex,parseJsonRejectDuplicateKeys,isCoreFailure} from '@foreman/core';
import {makeLiveRunJournalLayer,type RunId} from '@foreman/event-log';
import {validateAuthoringSnapshotV1} from '@foreman/pel';
import {decodeRoundPlanV1,isRoundContractFailure,type RoundPlanV1} from './round-contract.js';
import {decodeExecutionContractV1,isExecutionContractFailure,executionContractSha256,type ExecutionContractV1} from './execution-contract.js';
import {EndstopLedger,makeLiveEndstopLedgerLayer} from './execution-ledger.js';
import {decodeInstallManifest} from './pel-package.js';
import {resolvePelRegisteredRoot} from './pel-registered-root.js';
import {makeLivePelProjectServices} from './pel-project-live.js';
import {resolvePelProjectAuthority} from './pel-project-authority.js';
import {decodePelLegacyCommandBindingV1,importLegacyWorkflow,readPelLegacyRunObservation,type MigratedPelV1,type MigrationDiagnostic,type PelLegacyCommandBindingV1,type PelLegacyRunObservationV1} from './pel-migration.js';

export interface PelMigrationRequest {readonly input:string;readonly contract:string;readonly out:string;}
export interface PelMigrationPublished {readonly result:MigratedPelV1;readonly outputPath:string;readonly parityPath:string;}
export interface PelMigrationServices {readonly migrate:(input:PelMigrationRequest)=>Effect.Effect<PelMigrationPublished,MigrationDiagnostic>;}
export interface PelMigrationResolverInput {readonly round:RoundPlanV1;readonly contract:ExecutionContractV1;readonly roundPath:string;}
export interface PelMigrationServiceOptions {readonly resolve:(input:PelMigrationResolverInput)=>Effect.Effect<{readonly bindings:readonly PelLegacyCommandBindingV1[];readonly legacyState:PelLegacyRunObservationV1},MigrationDiagnostic>;}
const diagnostic=(code:MigrationDiagnostic['code'],locator:string,message:string):MigrationDiagnostic=>({code,exitCode:code==='MigrationIO'?1:code==='ActiveLegacyRun'?3:2,locator,field:'$',message});
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown)=>sha256Hex(canonicalize(v));
const bad=(locator:string,message:string)=>diagnostic('UnsupportedLegacyConstruct',locator,message);
function parent(path:string){const full=resolve(path),dir=dirname(full),root=parse(full).root;let fd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{for(const component of relative(root,dir).split('/').filter(Boolean)){const next=openSync(`/proc/self/fd/${fd}/${component}`,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);closeSync(fd);fd=next;}if(realpathSync(dir)!==dir)throw Error('Noncanonical parent');return {fd,full,dir,name:basename(full),anchor:`/proc/self/fd/${fd}`};}catch(error){closeSync(fd);throw error;}}
function boundedRead(path:string,max=1048576):Uint8Array {const p=parent(path);try{const fd=openSync(join(p.anchor,p.name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=fstatSync(fd);if(!before.isFile()||before.nlink!==1||before.size>max)throw Error('Unsafe or oversized file');const bytes=Buffer.alloc(before.size);let offset=0;while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,offset);if(n===0)throw Error('Short read');offset+=n;}const after=fstatSync(fd);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Changed file');return bytes;}finally{closeSync(fd);}}finally{closeSync(p.fd);}}
function json(bytes:Uint8Array):unknown {const value=parseJsonRejectDuplicateKeys(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(isCoreFailure(value))throw Error('Invalid JSON');return value;}
const read=(path:string)=>Effect.try({try:()=>boundedRead(path),catch:error=>object(error)&&typeof error.code==='string'&&['ENOENT','EACCES','EPERM','EIO','EMFILE','ENFILE'].includes(error.code)?diagnostic('MigrationIO',path,'The migration input could not be read.'):bad(path,'The input must be a bounded regular file with no symlink ancestors.')});
function publish(out:string,result:MigratedPelV1):PelMigrationPublished {
 if(!out.endsWith('.pel'))throw bad(out,'Migration output must have a .pel suffix.');
 const p=parent(out),parityName=`${p.name}.parity.json`,temps:string[]=[],published:{path:string;ino:number;dev:number}[]=[];
 try{
  for(const name of [p.name,parityName]){try{lstatSync(join(p.anchor,name));throw bad(out,'Migration output already exists.');}catch(error){if(!(error instanceof Error)||!('code' in error)||error.code!=='ENOENT')throw error;}}
  const pairs=[[parityName,Buffer.from(canonicalize(result)+'\n')],[p.name,Buffer.from(result.source)]] as const;
  for(const [name,bytes]of pairs){if(bytes.length>1048576)throw bad(out,'Migration output exceeds its byte bound.');const temp=join(p.anchor,`.pel-migrate-${randomUUID()}`);temps.push(temp);const fd=openSync(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);fsyncSync(fd);const info=fstatSync(fd),final=join(p.anchor,name);linkSync(temp,final);published.push({path:final,ino:info.ino,dev:info.dev});}finally{closeSync(fd);}}
  fsyncSync(p.fd);return {result,outputPath:p.full,parityPath:join(p.dir,parityName)};
 }catch(error){for(const entry of published.reverse()){try{const info=lstatSync(entry.path);if(info.ino===entry.ino&&info.dev===entry.dev)unlinkSync(entry.path);}catch{/* The original error remains authoritative. */}}throw error;}finally{for(const path of temps){try{unlinkSync(path);}catch{/* No destination is overwritten. */}}fsyncSync(p.fd);closeSync(p.fd);}
}
export function makePelMigrationServices(options:PelMigrationServiceOptions):PelMigrationServices{return {migrate:request=>Effect.gen(function*(){
 const roundBytes=yield* read(request.input),contractBytes=yield* read(request.contract);
 const round=yield* Effect.try({try:()=>decodeRoundPlanV1(json(roundBytes)),catch:()=>bad(request.input,'The legacy round must be duplicate-free JSON.')});
 const contract=yield* Effect.try({try:()=>decodeExecutionContractV1(json(contractBytes)),catch:()=>bad(request.contract,'The legacy contract must be duplicate-free JSON.')});
 const decoded={round,contract};
 if(isRoundContractFailure(decoded.round)||isExecutionContractFailure(decoded.contract)){
  // The pure importer supplies the original field locator for closed schema failures.
  const result=importLegacyWorkflow({round:{locator:request.input,bytes:roundBytes},contract:{locator:request.contract,bytes:contractBytes},bindings:[],legacyState:{runId:'',state:'absent',owner:null,historySha256:hash([])}});return yield* Effect.fail(Either.isLeft(result)?result.left:bad(request.input,'Invalid legacy input'));
 }
 const resolved=yield* options.resolve({round:decoded.round,contract:decoded.contract,roundPath:resolve(request.input)}),result=importLegacyWorkflow({round:{locator:request.input,bytes:roundBytes},contract:{locator:request.contract,bytes:contractBytes},...resolved});if(Either.isLeft(result))return yield* Effect.fail(result.left);
 return yield* Effect.try({try:()=>publish(request.out,result.right),catch:error=>object(error)&&'exitCode'in error?error as unknown as MigrationDiagnostic:diagnostic('MigrationIO',request.out,'The new migration output pair could not be published.')});
})};}

export interface PelMigrationLiveOptions {readonly entryUrl:string;readonly cwd:string;readonly foremanHome:string;}
/** Assets are relative to the installed executable. CWD supplies only registered project identity. */
export function makeLivePelMigrationServices(options:PelMigrationLiveOptions):PelMigrationServices {
 const runtimeRoot=fileURLToPath(new URL('../../',options.entryUrl));
 const projects=makeLivePelProjectServices({...options,validateAuthority:(project,readInput,readHash)=>resolvePelProjectAuthority(project,(ref,max)=>'byteLength'in ref?readInput(ref,max):readHash(ref.sha256,max)).pipe(Effect.provide(makeLiveEndstopLedgerLayer(project.stateRoot)),Effect.asVoid)});
 return makePelMigrationServices({resolve:input=>Effect.gen(function*(){
  const registered=yield* resolvePelRegisteredRoot(options.cwd,options.foremanHome).pipe(Effect.mapError(()=>bad(input.roundPath,'Migration requires an existing registered project and state root.')));
  const legacyState={...(yield* readPelLegacyRunObservation(input.round.runId).pipe(Effect.provide(makeLiveRunJournalLayer(registered.stateRoot)))),stateRoot:registered.stateRoot};if(legacyState.state==='active'||legacyState.state==='unknown')return {bindings:[],legacyState};
  const project=yield* projects.read().pipe(Effect.mapError(()=>bad(input.roundPath,'The registered project settings are unavailable.')));
  const authority=yield* resolvePelProjectAuthority(project,(ref,max)=>'byteLength'in ref?projects.input.read(project,ref,max):projects.readHash(project,ref.sha256,max)).pipe(Effect.provide(makeLiveEndstopLedgerLayer(project.stateRoot)),Effect.mapError(()=>bad(input.roundPath,'The existing registered authority cannot authorize this import.')));
  if(authority.binding.kind!=='v1'||executionContractSha256(authority.contract)!==executionContractSha256(input.contract)||hash(project.limits.execution)!==hash(input.contract.limits))return yield* Effect.fail(bad(input.roundPath,'The original V1 contract and exact project limits must match existing authority.'));
  const ledgerState=yield* Effect.flatMap(EndstopLedger,ledger=>ledger.status(input.contract.contractId)).pipe(Effect.provide(makeLiveEndstopLedgerLayer(project.stateRoot)),Effect.mapError(()=>bad(input.roundPath,'The original contract has no existing ledger registration.')));
  if(ledgerState.contractSha256!==executionContractSha256(input.contract))return yield* Effect.fail(bad(input.roundPath,'The existing ledger contract hash differs.'));
  const snapshotBytes=yield* projects.input.read(project,project.authoringSnapshot,1048576).pipe(Effect.mapError(()=>bad(input.roundPath,'The original authoring snapshot is unavailable.')));
  const snapshot=yield* Effect.try({try:()=>validateAuthoringSnapshotV1(json(snapshotBytes)),catch:()=>bad(input.roundPath,'Invalid original authoring snapshot.')});if(!snapshot.ok)return yield* Effect.fail(bad(input.roundPath,'Invalid original authoring snapshot.'));
  const spec=snapshot.value.artifactDescriptors.find(a=>a.id==='artifact:approved-spec');if(typeof spec?.content!=='string')return yield* Effect.fail(bad(input.roundPath,'The closed import requires a registered immutable text specification.'));
  const templates=yield* Effect.try({try:()=>{
   const manifest=decodeInstallManifest(boundedRead(join(runtimeRoot,'manifest.json'),4*1048576));if(!manifest.ok)throw Error('manifest');const entries=manifest.value.files;
   return (['implement-verify-review','bounded-rework'] as const).map(template=>{const relativePath=`runtime/assets/pel/migration/${template}/registered-command-bindings.json`,entry=entries.find(a=>object(a)&&a.path===relativePath);const bytes=boundedRead(join(runtimeRoot,relativePath));if(!object(entry)||entry.byteLength!==bytes.length||entry.sha256!==sha256Hex(bytes))throw Error('asset integrity');const decoded=decodePelLegacyCommandBindingV1(json(bytes));if(Either.isLeft(decoded))throw Error('template');return decoded.right;});
  },catch:()=>bad(runtimeRoot,'The installed migration templates are absent or do not match their runtime manifest.')});
  const matches=templates.filter(t=>basename(input.round.commandArgv[2]??'')===basename(t.values.promptPath)&&input.round.reportPath===t.report.path);if(matches.length!==1)return yield* Effect.fail(bad(input.roundPath,'The legacy prompt and report do not identify one registered import template.'));
  const template=matches[0]!,workspace=project.workspaces.grants.find(g=>g.canonicalRoot===input.round.commandArgv[12]),gate=project.gates[template.gate.id],implementer=project.roleBindings['role:implementer'],reviewer=project.roleBindings['role:reviewer'];
  if(!workspace||workspace.immutableBase!==input.contract.baseCommit||!gate||hash(gate.argv)!==template.gate.argvSha256||!implementer||!reviewer||implementer.profileId!==template.implementer.profileId||implementer.transportId!==template.implementer.transportId||reviewer.profileId!==template.reviewer.profileId||reviewer.transportId!==template.reviewer.transportId||project.taskActions.implement!=='implement'||template.correctionLimit===1&&project.taskActions.correct!=='correct')return yield* Effect.fail(bad(input.roundPath,'The original workspace, base, model roles, or task actions lack an exact mapping.'));
  const promptPath=input.round.commandArgv[2]!;const prompt=yield* read(resolve(workspace.canonicalRoot,promptPath));if(sha256Hex(prompt)!==sha256Hex(spec.content))return yield* Effect.fail(bad(promptPath,'The legacy prompt differs from the registered immutable approved specification.'));
  const binding:PelLegacyCommandBindingV1={...template,contractSha256:executionContractSha256(input.contract),values:{promptPath,workspaceRoot:workspace.canonicalRoot},input:{artifactId:'artifact:approved-spec',sha256:hash(spec.content)},workspace:{grantId:workspace.grantId,immutableBase:workspace.immutableBase,writablePaths:workspace.writablePaths},implementer:{...template.implementer,credentialProfileRef:implementer.credentialProfileRef},reviewer:{...template.reviewer,credentialProfileRef:reviewer.credentialProfileRef},gate:{...template.gate,argv:gate.argv,argvSha256:hash(gate.argv)}};
  return {bindings:[binding],legacyState};
 })});
}
