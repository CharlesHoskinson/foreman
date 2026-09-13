/** Canonical installable payload identity. The root manifest never hashes itself. */
import {canonicalize,sha256Hex,isCoreFailure,parseJsonRejectDuplicateKeys} from '@foreman/core';
export interface PackageFileV1 {readonly path:string;readonly byteLength:number;readonly sha256:string;readonly mode:420|493;}
export interface RuntimeSchemaRangeV1 {readonly min:number;readonly max:number;}
export interface ManifestPayloadV1 {
 readonly schemaVersion:1;readonly releaseName:'Return of the ForeDi';readonly version:string|null;readonly candidateCommit:string;readonly nodeRange:'>=24 <25';
 readonly runtimeCompatibility:{readonly runtimeVersion:string;readonly runtimeHandlerVersion:string};
 readonly runtimeSchemas:{readonly journal:RuntimeSchemaRangeV1;readonly checkpoint:RuntimeSchemaRangeV1;readonly pelContinuation:RuntimeSchemaRangeV1};
 readonly defaultAuthoringSnapshot:{readonly path:'runtime/assets/pel/default-authoring-snapshot.json';readonly sha256:string};
 readonly metricEntry:{readonly path:'runtime/dist/pel-simplification.js';readonly sha256:string};
 readonly files:readonly PackageFileV1[];
}
export interface InstallManifestV1 extends ManifestPayloadV1 {readonly buildId:string;}
export const requiredPelPackagePaths:readonly string[]=[
 'runtime/manifest.json','runtime/dist/install.js','runtime/dist/foreman.js','runtime/dist/pel-package.js','runtime/dist/pel-simplification.js','runtime/assets/pel/default-authoring-snapshot.json',
 'runtime/assets/pel/research/research-bundle.json',...['models','pel','ears','m3','plugin'].map(name=>`runtime/assets/pel/research/sources/${name}/manifest.json`),
 'docs/guides/pel/package-support.json',
 ...['implement-verify-review','parallel-read','repair-and-publish','race-cancel','resume-checkpoint','research-prepare','conditional','repair'].map(name=>`examples/pel/${name}.pel`),
 'examples/pel/project-settings.json',...['grok-4.6','claude-opus-5','claude-fable-5-1','gpt-6-astra','gpt-5.6-sol','gemini-3.8-flash'].map(id=>`examples/pel/profiles/${id}.pel`),
 ...['install','quickstart','examples','migration','research','support'].map(name=>`docs/guides/pel/${name}.md`),
];
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,names:readonly string[])=>Object.keys(v).length===names.length&&names.every(name=>Object.hasOwn(v,name));
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const range=(v:unknown):v is RuntimeSchemaRangeV1=>object(v)&&keys(v,['min','max'])&&integer(v.min)&&integer(v.max)&&v.min>0&&v.min<=v.max&&v.max<=10000;
const utf8order=(a:string,b:string)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
export function validPackagePath(value:unknown):value is string {
 if(typeof value!=='string'||Buffer.byteLength(value)>4096||!value||value.startsWith('/')||/[\\\u0000-\u001f\u007f]/u.test(value))return false;
 const parts=value.split('/');if(parts.some(part=>!part||part==='.'||part==='..'||['node_modules','fixtures','test','tests','.git','.foreman','credentials','workspaces','runs','state'].includes(part)||part==='.env'||part.startsWith('.env.')||part==='.npmrc'))return false;
 if(value.startsWith('runtime/dist/')&&/(?:^|[-.])(?:fixture|test)(?:[-.]|$)/.test(parts.at(-1)!))return false;
 return value==='runtime/manifest.json'||value.startsWith('runtime/dist/')&&value.endsWith('.js')||value.startsWith('runtime/assets/pel/')||value.startsWith('examples/pel/')||value.startsWith('docs/guides/pel/');
}
export function makeInstallManifest(payload:ManifestPayloadV1):InstallManifestV1 {return {...payload,buildId:sha256Hex(canonicalize(payload))};}
export function decodeInstallManifest(bytes:Uint8Array):{readonly ok:true;readonly value:InstallManifestV1}|{readonly ok:false;readonly reason:string}{
 const invalid=(reason:string)=>({ok:false as const,reason});if(bytes.byteLength>4*1024*1024)return invalid('manifest-bound');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return invalid('manifest-encoding');}
 const value=parseJsonRejectDuplicateKeys(text);if(isCoreFailure(value)||!object(value)||!keys(value,['schemaVersion','releaseName','version','candidateCommit','nodeRange','runtimeSchemas','runtimeCompatibility','defaultAuthoringSnapshot','metricEntry','files','buildId']))return invalid('manifest-schema');
 if(value.schemaVersion!==1||value.releaseName!=='Return of the ForeDi'||value.nodeRange!=='>=24 <25'||typeof value.candidateCommit!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(value.candidateCommit)||!hash(value.buildId))return invalid('manifest-identity');
 if(value.version!==null&&(typeof value.version!=='string'||value.version.length>120||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value.version)))return invalid('manifest-version');
 if(!object(value.runtimeCompatibility)||!keys(value.runtimeCompatibility,['runtimeVersion','runtimeHandlerVersion'])||!Object.values(value.runtimeCompatibility).every(v=>typeof v==='string'&&/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(v)))return invalid('manifest-runtime-compatibility');
 if(!object(value.runtimeSchemas)||!keys(value.runtimeSchemas,['journal','checkpoint','pelContinuation'])||!Object.values(value.runtimeSchemas).every(range))return invalid('manifest-runtime-schemas');
 if(!Array.isArray(value.files)||value.files.length>4096)return invalid('manifest-files');
 const files=new Map<string,PackageFileV1>(),folded=new Set<string>();let previous='',total=0;
 for(const file of value.files){if(!object(file)||!keys(file,['path','byteLength','sha256','mode'])||!validPackagePath(file.path)||!integer(file.byteLength)||file.byteLength>128*1024*1024||!hash(file.sha256)||file.mode!==420&&file.mode!==493)return invalid('manifest-file');
  if(previous&&utf8order(previous,file.path)>=0||folded.has(file.path.toLowerCase()))return invalid('manifest-path-order');previous=file.path;folded.add(file.path.toLowerCase());total+=file.byteLength;if(total>512*1024*1024)return invalid('manifest-total-bound');files.set(file.path,file as unknown as PackageFileV1);
 }
 if(requiredPelPackagePaths.some(path=>!files.has(path)))return invalid('manifest-required-file');
 for(const [name,path]of [['defaultAuthoringSnapshot','runtime/assets/pel/default-authoring-snapshot.json'],['metricEntry','runtime/dist/pel-simplification.js']] as const){const ref=value[name];if(!object(ref)||!keys(ref,['path','sha256'])||ref.path!==path||ref.sha256!==files.get(path)?.sha256)return invalid('manifest-required-reference');}
 const {buildId,...payload}=value;if(sha256Hex(canonicalize(payload))!==buildId)return invalid('manifest-digest');if(text!==canonicalize(value)+'\n')return invalid('manifest-canonical');
 return {ok:true,value:value as unknown as InstallManifestV1};
}

import {Effect} from 'effect';
import {join} from 'node:path';
import {InstallFs,liveInstallFs,identitiesEqual,verifyRuntimeTree,type InstallFileIdentity} from '@foreman/policy';
export type InstallFailure={readonly _tag:'PackageIntegrityMismatch'|'InstallPrerequisiteMissing'|'InstallIoFailure'|'RollbackIncompatible'|'UnknownPackage';readonly message:string;readonly path?:string;};
export const installFailure=(tag:InstallFailure['_tag'],message:string,path?:string):InstallFailure=>({_tag:tag,message,...(path===undefined?{}:{path})});
export interface VerifiedPelPackageV1 {readonly root:string;readonly manifest:InstallManifestV1;readonly files:readonly {readonly record:PackageFileV1;readonly bytes:Uint8Array}[];}
/** Reuse the runtime verifier and its descriptor-bound filesystem reads. */
export function verifyPelPackage(sourceRoot:string):Effect.Effect<VerifiedPelPackageV1,InstallFailure>{return Effect.gen(function*(){
 const fs=yield* InstallFs,root=yield* fs.resolvePath(sourceRoot),directories=new Map<string,InstallFileIdentity>();
 const read=(path:string,max:number)=>fs.withOpenFile(path,file=>Effect.gen(function*(){const bytes=yield* file.readBounded(max);if(!identitiesEqual(file.identity,yield* file.recheckIdentity()))return yield* Effect.fail(installFailure('PackageIntegrityMismatch','A package file changed during validation.',path));return {bytes,identity:file.identity};}));
 const manifestFile=yield* read(join(root,'manifest.json'),4*1024*1024),decoded=decodeInstallManifest(manifestFile.bytes);if(!decoded.ok)return yield* Effect.fail(installFailure('PackageIntegrityMismatch',decoded.reason,'manifest.json'));
 if(manifestFile.identity.nlink!==1||(manifestFile.identity.mode&0o7777)!==0o644)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','The package manifest must be a single ordinary 0644 file.'));
 const manifest=decoded.value,expected=new Map(manifest.files.map(file=>[file.path,file])),observed=new Set<string>(),files:{record:PackageFileV1;bytes:Uint8Array}[]=[];
 const walk=(path:string,relative:string):Effect.Effect<void,InstallFailure|import('@foreman/policy').InstallFsError>=>Effect.gen(function*(){const before=yield* fs.lstat(path);if(!before.isDirectory||before.isSymbolicLink)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','Package directories must be ordinary directories.',relative));directories.set(path,before);
  const names=yield* fs.readdirNames(path);if(names.length>4097)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','Package directory exceeds its entry bound.',relative));for(const name of [...names].sort(utf8order)){if(!name||name==='.'||name==='..'||/[\\/\u0000]/u.test(name))return yield* Effect.fail(installFailure('PackageIntegrityMismatch','A package entry has an invalid name.'));const rel=relative?`${relative}/${name}`:name,absolute=join(path,name),info=yield* fs.lstat(absolute);
   if(info.isDirectory&&!info.isSymbolicLink){if(!manifest.files.some(file=>file.path.startsWith(rel+'/')))return yield* Effect.fail(installFailure('PackageIntegrityMismatch','Package contains an undeclared directory.',rel));yield* walk(absolute,rel);continue;}
   if(rel==='manifest.json'){if(!identitiesEqual(info,manifestFile.identity))return yield* Effect.fail(installFailure('PackageIntegrityMismatch','The package manifest changed.'));continue;}
   const record=expected.get(rel);if(!record||!info.isFile||info.isSymbolicLink||info.nlink!==1||info.size!==record.byteLength||(info.mode&0o7777)!==record.mode)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','Package file metadata differs from its declaration.',rel));const opened=yield* read(absolute,record.byteLength);if(!identitiesEqual(info,opened.identity)||sha256Hex(opened.bytes)!==record.sha256)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','Package file content differs from its declaration.',rel));observed.add(rel);files.push({record,bytes:opened.bytes});
  }
 });
 yield* walk(root,'');if(observed.size!==expected.size)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','A declared package file is missing.'));
 const runtime=yield* verifyRuntimeTree(join(root,'runtime'));if(runtime._tag!=='Pass')return yield* Effect.fail(installFailure('PackageIntegrityMismatch',`Runtime validation failed: ${runtime.reason}.`));
 for(const [path,before]of directories)if(!identitiesEqual(before,yield* fs.lstat(path)))return yield* Effect.fail(installFailure('PackageIntegrityMismatch','A package directory changed during validation.'));
 return {root,manifest,files};
}).pipe(Effect.provide(liveInstallFs),Effect.mapError(error=>'_tag' in error&&error._tag!=='InstallFsError'?error as InstallFailure:installFailure('PackageIntegrityMismatch','The complete package could not be read safely.')));}

import {constants,openSync,closeSync,fstatSync,lstatSync,readFileSync,readdirSync,mkdirSync,writeFileSync,fsyncSync,renameSync,rmSync,chmodSync,createWriteStream,createReadStream,realpathSync,linkSync,unlinkSync} from 'node:fs';
import {mkdtemp} from 'node:fs/promises';
import {dirname,resolve,isAbsolute,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import * as tar from 'tar';
import {ProcessExec,liveProcessExec} from './queue-services.js';
import {gitArgv,sanitizedGitEnv} from '@foreman/policy';
export interface ProducePelPackageInputV1 {readonly repositoryRoot:string;readonly candidateCommit:string;readonly out:string;readonly version?:string|null;}
export interface ProducedPelPackageV1 {readonly buildId:string;readonly archivePath:string;readonly archiveSha256:string;}
const packageIo=<A>(f:()=>A)=>Effect.try({try:f,catch:()=>installFailure('InstallIoFailure','The package output could not be prepared.')} );
function sourceBytes(path:string):Buffer {const before=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>128*1024*1024)throw Error('file');const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const opened=fstatSync(fd),bytes=readFileSync(fd),after=fstatSync(fd),named=lstatSync(path);if(before.ino!==opened.ino||before.dev!==opened.dev||opened.ino!==named.ino||opened.dev!==named.dev||opened.size!==bytes.length||opened.mtimeMs!==after.mtimeMs||opened.ctimeMs!==after.ctimeMs)throw Error('changed');return bytes;}finally{closeSync(fd);}}
function stageBytes(root:string,path:string,bytes:Uint8Array,mode:420|493){const destination=join(root,path);mkdirSync(dirname(destination),{recursive:true,mode:0o755});const fd=openSync(destination,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,mode);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}chmodSync(destination,mode);}
const tempStage=()=>Effect.acquireRelease(Effect.tryPromise({try:()=>mkdtemp(join(tmpdir(),'foreman-pel-package-')),catch:()=>installFailure('InstallIoFailure','The package staging directory cannot be created.')}),path=>Effect.sync(()=>rmSync(path,{recursive:true,force:true})));
/** Archive only verified bytes, with stable ordering and zero portable timestamps. */
export function writePelPackageArchive(sourceRoot:string,out:string):Effect.Effect<ProducedPelPackageV1,InstallFailure>{return Effect.scoped(Effect.gen(function*(){
 const verified=yield* verifyPelPackage(sourceRoot),stage=yield* tempStage();for(const file of verified.files){yield* packageIo(()=>stageBytes(stage,file.record.path,file.bytes,file.record.mode));yield* Effect.yieldNow();}yield* packageIo(()=>stageBytes(stage,'manifest.json',Buffer.from(canonicalize(verified.manifest)+'\n'),420));
 const directory=resolve(out);yield* packageIo(()=>{mkdirSync(directory,{recursive:true,mode:0o755});if(realpathSync(directory)!==directory||!lstatSync(directory).isDirectory())throw Error('output');});
 const archivePath=join(directory,`${verified.manifest.buildId}.tar.gz`),temporary=yield* Effect.acquireRelease(packageIo(()=>{const path=join(directory,`.archive-${randomUUID()}`),fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o644);closeSync(fd);return path;}),path=>Effect.sync(()=>rmSync(path,{force:true})));
 const files=['manifest.json',...verified.manifest.files.map(file=>file.path)].sort(utf8order);
 yield* Effect.tryPromise({try:signal=>pipeline(tar.c({cwd:stage,portable:true,gzip:true,mtime:new Date(0),noPax:true,noDirRecurse:true},files),createWriteStream(temporary,{flags:'r+'}),{signal}),catch:()=>installFailure('InstallIoFailure','The package archive could not be closed.')});
 const archiveSha256=yield* Effect.tryPromise({try:async signal=>{const hash=createHash('sha256');await pipeline(createReadStream(temporary),hash,{signal});return hash.digest('hex');},catch:()=>installFailure('InstallIoFailure','The package archive hash could not be read.')});
 yield* packageIo(()=>{const fd=openSync(temporary,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}try{const existing=sourceBytes(archivePath);if(sha256Hex(existing)!==archiveSha256)throw Error('conflicting archive');rmSync(temporary);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;linkSync(temporary,archivePath);unlinkSync(temporary);}const dfd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(dfd);}finally{closeSync(dfd);}}).pipe(Effect.uninterruptible);
 return {buildId:verified.manifest.buildId,archivePath,archiveSha256};
}));}
/** Produce from one exact clean source candidate; generated runtime bytes remain explicitly hashed. */
export function producePelPackage(input:ProducePelPackageInputV1):Effect.Effect<ProducedPelPackageV1,InstallFailure>{return Effect.scoped(Effect.gen(function*(){
 if(!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(input.candidateCommit))return yield* Effect.fail(installFailure('PackageIntegrityMismatch','Use a full candidate Git commit.'));
 const repositoryRoot=yield* packageIo(()=>realpathSync(input.repositoryRoot)),proc=yield* ProcessExec,scratch=yield* tempStage();
 const git=(args:readonly string[])=>proc.runCaptured({command:'git',args:gitArgv(['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.excludesFile=/dev/null','-c','core.ignoreStat=false','-c','core.sparseCheckout=false',...args]),cwd:repositoryRoot,env:{...sanitizedGitEnv(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_INDEX_FILE:join(scratch,'candidate-index')},maxOutputBytes:4*1024*1024,timeoutMs:30000}).pipe(Effect.mapError(()=>installFailure('PackageIntegrityMismatch','The exact source candidate cannot be inspected.')));
 const head=yield* git(['rev-parse','HEAD']);if(head.exitCode!==0||head.stdout.trim()!==input.candidateCommit)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','The current source does not match the candidate commit.'));
 const indexed=yield* git(['read-tree',input.candidateCommit]);if(indexed.exitCode!==0)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','The immutable candidate index cannot be read.'));
 const relevant=['packages','scripts','docs','examples','skills/foreman/runtime','package.json','package-lock.json','tsconfig.all.json'];const status=yield* git(['status','--porcelain=v1','--untracked-files=all','--',...relevant]);if(status.exitCode!==0||status.stdout.length)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','Commit all relevant production, documentation, and example sources before packaging.'));
 const tracked=yield* git(['ls-files','-z']);if(tracked.exitCode!==0)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','The candidate source inventory cannot be read.'));const candidateFiles=new Set(tracked.stdout.split('\0'));
 const stage=yield* tempStage(),records:PackageFileV1[]=[];let total=0;
 const copy=(source:string,target:string):Effect.Effect<void,InstallFailure>=>Effect.gen(function*(){if(target==='runtime/assets/pel/research'||target==='runtime/assets/pel/migration')return;const info=yield* packageIo(()=>lstatSync(source));if(info.isSymbolicLink())return yield* Effect.fail(installFailure('PackageIntegrityMismatch','Package sources cannot contain symlinks.'));if(info.isDirectory()){const names=yield* packageIo(()=>readdirSync(source));for(const name of names.sort(utf8order))yield* copy(join(source,name),`${target}/${name}`);return;}if(!source.startsWith(join(repositoryRoot,'skills/foreman/runtime')+'/')&&!candidateFiles.has(source.slice(repositoryRoot.length+1)))return yield* Effect.fail(installFailure('PackageIntegrityMismatch','Package data must be tracked in the exact source candidate.'));if(!validPackagePath(target)||records.length>=4096)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','A source is outside the package payload.'));const bytes=yield* packageIo(()=>sourceBytes(source));total+=bytes.length;if(total>512*1024*1024)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','The package exceeds its byte bound.'));const mode=target.startsWith('runtime/dist/')?493 as const:420 as const;yield* packageIo(()=>stageBytes(stage,target,bytes,mode));records.push({path:target,byteLength:bytes.length,sha256:sha256Hex(bytes),mode});yield* Effect.yieldNow();});
 yield* copy(join(repositoryRoot,'skills/foreman/runtime'),'runtime');
 // Generated copies are caches. Read research and trusted migration data from the checked candidate sources.
 const research=join(repositoryRoot,'docs/research/pel-release');for(const name of yield* packageIo(()=>readdirSync(research)))yield* copy(join(research,name),`runtime/assets/pel/research/${name}`);
 for(const name of ['implement-verify-review','bounded-rework'])yield* copy(join(repositoryRoot,'packages/orchestration/src/fixtures/pel-migration',name,'registered-command-bindings.json'),`runtime/assets/pel/migration/${name}/registered-command-bindings.json`);yield* copy(join(repositoryRoot,'examples/pel'),'examples/pel');yield* copy(join(repositoryRoot,'docs/guides/pel'),'docs/guides/pel');
 const obligations=yield* packageIo(()=>sourceBytes(join(repositoryRoot,'docs/releases/return-of-the-foredi/adoption-obligations.json')));const value=parseJsonRejectDuplicateKeys(new TextDecoder('utf-8',{fatal:true}).decode(obligations));if(isCoreFailure(value)||!object(value)||value.releaseName!=='Return of the ForeDi'||!Array.isArray(value.entries)||value.entries.length===0)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','The original adoption obligation status is absent.'));
 const support=Buffer.from(canonicalize({schemaVersion:1,releaseName:'Return of the ForeDi',platform:{os:'linux',arch:'x64',nodeRange:'>=24 <25'},obligationsSource:'docs/releases/return-of-the-foredi/adoption-obligations.json',obligationsSha256:sha256Hex(obligations),obligations:value})+'\n');const supportPath='docs/guides/pel/package-support.json';if(records.some(record=>record.path===supportPath))return yield* Effect.fail(installFailure('PackageIntegrityMismatch','Package support metadata must derive from the original obligations.'));yield* packageIo(()=>stageBytes(stage,supportPath,support,420));records.push({path:supportPath,byteLength:support.length,sha256:sha256Hex(support),mode:420});records.sort((a,b)=>utf8order(a.path,b.path));
 const manifest=makeInstallManifest({schemaVersion:1,releaseName:'Return of the ForeDi',version:input.version??null,candidateCommit:input.candidateCommit,nodeRange:'>=24 <25',runtimeCompatibility:{runtimeVersion:PEL_EXECUTION_RUNTIME_VERSION,runtimeHandlerVersion:PEL_EXECUTION_HANDLER_VERSION},runtimeSchemas:{journal:{min:1,max:1},checkpoint:{min:1,max:1},pelContinuation:{min:1,max:1}},defaultAuthoringSnapshot:{path:'runtime/assets/pel/default-authoring-snapshot.json',sha256:records.find(file=>file.path==='runtime/assets/pel/default-authoring-snapshot.json')?.sha256??''},metricEntry:{path:'runtime/dist/pel-simplification.js',sha256:records.find(file=>file.path==='runtime/dist/pel-simplification.js')?.sha256??''},files:records});yield* packageIo(()=>stageBytes(stage,'manifest.json',Buffer.from(canonicalize(manifest)+'\n'),420));
 const after=yield* git(['status','--porcelain=v1','--untracked-files=all','--',...relevant]);const afterHead=yield* git(['rev-parse','HEAD']);if(after.exitCode!==0||after.stdout.length||afterHead.exitCode!==0||afterHead.stdout.trim()!==input.candidateCommit)return yield* Effect.fail(installFailure('PackageIntegrityMismatch','Source identity changed during package capture.'));
 return yield* writePelPackageArchive(stage,input.out);
})).pipe(Effect.provide(liveProcessExec));}

import {PEL_EXECUTION_RUNTIME_VERSION,PEL_EXECUTION_HANDLER_VERSION} from './pel-runtime-version.js';
