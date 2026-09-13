/** Project settings reference existing authority; project input storage never grants it. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,existsSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readSync,realpathSync,renameSync,statSync,unlinkSync,writeSync,type Stats} from 'node:fs';
import {dirname,isAbsolute,join,normalize,parse,relative,resolve,sep} from 'node:path';
import {Effect} from 'effect';
import {canonicalize,isCoreFailure,parseJsonRejectDuplicateKeys} from '@foreman/core';
import {hashAuthoringContent} from '@foreman/pel';
import {decodeForemanProjectV1} from './pel-project-config.js';
import type {ForemanProjectV1,PelArtifactRefV1,PelProjectInputPort,PelRepositoryIdentityV1,RunFailure} from './pel-run-contract.js';
import {loadProjectRegistryFileV1,registerProjectFileV1,resolveProjectV1} from './project-registry.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_SETTINGS=1048576;
const exec=promisify(execFile);
const fail=(message:string):RunFailure=>({_tag:'PelRunFailure',code:'binding-mismatch',diagnostic:{code:'binding-mismatch',message,sourceSpan:null,effectId:null,retryable:false,nextAction:'Configure the canonical project with its registered authority and input references',evidenceRefs:[]}});
const attempt=<A>(work:()=>A,message:string)=>Effect.try({try:work,catch:()=>fail(message)});
const identity=(info:Stats)=>`${info.dev}:${info.ino}`;
function directory(path:string):Stats {
 if(!isAbsolute(path)||normalize(path)!==path||realpathSync(path)!==path)throw Error('noncanonical directory');
 const root=parse(path).root;let current=root;
 for(const component of relative(root,path).split(sep).filter(Boolean)){
  current=join(current,component);const info=lstatSync(current);if(info.isSymbolicLink()||!info.isDirectory())throw Error('unsafe ancestor');
 }
 return statSync(path);
}
function makeDirectory(path:string):void {
 if(existsSync(path)){directory(path);return;}
 const parent=dirname(path);directory(parent);mkdirSync(path,{mode:0o700});directory(path);
 const descriptor=openSync(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(descriptor);}finally{closeSync(descriptor);}
}
/** One nofollow bounded read, with stable parent and file identities across access. */
function readBytes(path:string,maxBytes:number,expected?:PelArtifactRefV1):Uint8Array {
 if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>64*1024*1024)throw Error('invalid bound');
 const parent=dirname(path),before=directory(parent),entry=lstatSync(path);
 if(!entry.isFile()||entry.isSymbolicLink()||entry.nlink!==1||entry.size>maxBytes)throw Error('unsafe input');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const opened=fstatSync(fd);if(identity(opened)!==identity(entry)||opened.size!==entry.size)throw Error('changed input');
  if(expected&&opened.size!==expected.byteLength)throw Error('length mismatch');
  const bytes=Buffer.alloc(opened.size);let offset=0;
  while(offset<bytes.length){const count=readSync(fd,bytes,offset,bytes.length-offset,offset);if(count===0)throw Error('short input');offset+=count;}
  const after=fstatSync(fd);if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||identity(directory(parent))!==identity(before)||identity(lstatSync(path))!==identity(opened))throw Error('changed input');
  if(expected&&createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('hash mismatch');
  return bytes;
 }finally{closeSync(fd);}
}
function decodeSettings(bytes:Uint8Array):ForemanProjectV1 {
 if(bytes.byteLength>MAX_SETTINGS)throw Error('settings bound');
 const json=parseJsonRejectDuplicateKeys(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(isCoreFailure(json))throw Error('invalid JSON');const decoded=decodeForemanProjectV1(json);
 if(!decoded.ok||!UUID.test(decoded.value.projectId))throw Error('invalid settings');return decoded.value;
}
function validateFilesystem(project:ForemanProjectV1,repository:PelRepositoryIdentityV1):void {
 if(canonicalize(project.repository)!==canonicalize(repository))throw Error('foreign repository');
 directory(project.stateRoot);directory(project.workspaces.poolRoot);
 for(const grant of project.workspaces.grants){if(identity(directory(grant.canonicalRoot))!==grant.directoryIdentity)throw Error('changed worktree');}
}
export interface PelProjectLocationV1 {readonly repository:PelRepositoryIdentityV1;readonly worktreePath:string;}
/** Same Git common-dir identity used by the existing project registry across worktrees. */
export function resolvePelRepository(cwd:string):Effect.Effect<PelProjectLocationV1,RunFailure> {
 return Effect.gen(function*(){
  const environment={...process.env};for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE'])delete environment[key];
  const git=(args:readonly string[])=>Effect.tryPromise({try:signal=>exec('git',[...args],{cwd,env:environment,encoding:'utf8',timeout:5000,maxBuffer:16384,signal}),catch:()=>fail('The checkout Git identity cannot be resolved')});
  const common=(yield* git(['rev-parse','--path-format=absolute','--git-common-dir'])).stdout.trim();
  const worktree=(yield* git(['rev-parse','--show-toplevel'])).stdout.trim();
  return yield* attempt(()=>{
   if(!isAbsolute(common)||!isAbsolute(worktree))throw Error('Git returned relative identity');
   const gitCommonDir=realpathSync(common),worktreePath=realpathSync(worktree),info=directory(gitCommonDir);directory(worktreePath);
   return {repository:{gitCommonDir,identitySha256:hashAuthoringContent({gitCommonDir,directoryIdentity:identity(info)})},worktreePath};
  },'The canonical repository directories are unavailable');
 });
}
export interface PelProjectLiveOptions {
 readonly cwd:string;
 readonly foremanHome:string;
 /** Validate actual registered ledger/authority envelopes before settings or registry writes. */
 readonly validateAuthority:(project:ForemanProjectV1,readInput:(ref:PelArtifactRefV1,maxBytes:number)=>Effect.Effect<Uint8Array,RunFailure>,readHash:(sha256:string,maxBytes:number)=>Effect.Effect<Uint8Array,RunFailure>)=>Effect.Effect<void,RunFailure>;
}
export interface PelProjectLiveServices {
 readonly input:PelProjectInputPort;
 readonly readHash:(project:Pick<ForemanProjectV1,'projectId'|'repository'|'stateRoot'>,sha256:string,maxBytes:number)=>Effect.Effect<Uint8Array,RunFailure>;
 readonly read:(stateRootOverride?:string)=>Effect.Effect<ForemanProjectV1,RunFailure>;
 readonly configure:(bytes:Uint8Array)=>Effect.Effect<ForemanProjectV1,RunFailure>;
}
/** Inputs live only at stateRoot/project-inputs/project UUID/sha256-HASH. No arbitrary artifact path is accepted. */
export function makeLivePelProjectServices(options:PelProjectLiveOptions):PelProjectLiveServices {
 const registryPath=join(options.foremanHome,'projects.json');
 const readHash=(project:Pick<ForemanProjectV1,'projectId'|'stateRoot'>,sha256:string,max:number)=>attempt(()=>{
  if(!UUID.test(project.projectId)||!/^([a-f0-9]{64})$/.test(sha256))throw Error('invalid input hash');
  directory(project.stateRoot);
  const bytes=readBytes(join(project.stateRoot,'project-inputs',project.projectId,`sha256-${sha256}`),max);
  if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('hash mismatch');
  return bytes;
 },'The registered input hash is missing, unsafe, changed, or exceeds its bound');
 const readInput=(project:Pick<ForemanProjectV1,'projectId'|'stateRoot'>,ref:PelArtifactRefV1,max:number)=>attempt(()=>{
  if(!UUID.test(project.projectId)||!/^sha256-[a-f0-9]{64}$/.test(ref.artifactId)||ref.artifactId!==`sha256-${ref.sha256}`||!Number.isSafeInteger(ref.byteLength)||ref.byteLength<0)throw Error('invalid input identity');
  directory(project.stateRoot);
  return readBytes(join(project.stateRoot,'project-inputs',project.projectId,ref.artifactId),max,ref);
 },'The registered project input is missing, unsafe, changed, or exceeds its bound');
 const registered=(context:{projectId:string;repository:PelRepositoryIdentityV1;stateRoot:string})=>attempt(()=>{
  directory(options.foremanHome);directory(context.repository.gitCommonDir);directory(context.stateRoot);
  const loaded=loadProjectRegistryFileV1(registryPath);if(loaded._tag!=='Valid')throw Error('invalid registry');
  const record=resolveProjectV1(loaded.value,{git_common_dir:context.repository.gitCommonDir,store_location:context.stateRoot});
  if(!record||record.project_id!==context.projectId)throw Error('unregistered association');
  const expected=hashAuthoringContent({gitCommonDir:context.repository.gitCommonDir,directoryIdentity:identity(directory(context.repository.gitCommonDir))});
  if(expected!==context.repository.identitySha256)throw Error('changed repository');
 },'The project ID, repository, and state root do not match an active registry record');
 const validateWorktrees=(project:ForemanProjectV1)=>Effect.forEach(project.workspaces.grants,grant=>Effect.gen(function*(){const location=yield* resolvePelRepository(grant.canonicalRoot);if(location.worktreePath!==grant.canonicalRoot||canonicalize(location.repository)!==canonicalize(project.repository))return yield* Effect.fail(fail('A workspace grant is not a worktree of the configured repository'));}),{discard:true});
 const input:PelProjectInputPort={read:(context,ref,max)=>Effect.gen(function*(){yield* registered(context);return yield* readInput(context,ref,max);})};
 return {
  input,
  readHash:(project,sha256,max)=>Effect.gen(function*(){yield* registered(project);return yield* readHash(project,sha256,max);}),
  read:override=>Effect.gen(function*(){
   const location=yield* resolvePelRepository(options.cwd);
   const project=yield* attempt(()=>decodeSettings(readBytes(join(location.repository.gitCommonDir,'foreman','project.json'),MAX_SETTINGS)),'Project settings are missing, malformed, or unsafe');
   yield* attempt(()=>validateFilesystem(project,location.repository),'Project settings no longer match the canonical repository or workspace grants');
   yield* validateWorktrees(project);
   if(override!==undefined&&override!==project.stateRoot)return yield* Effect.fail(fail('The requested state root is not the configured registered root'));
   yield* registered(project);return project;
  }),
  configure:bytes=>Effect.gen(function*(){
   const project=yield* attempt(()=>decodeSettings(bytes),'Project settings do not match the closed configuration schema');
   const location=yield* resolvePelRepository(options.cwd);
   yield* attempt(()=>validateFilesystem(project,location.repository),'Project settings reference foreign or changed repository, state root, or workspaces');
   yield* validateWorktrees(project);
   yield* options.validateAuthority(project,(ref,max)=>readInput(project,ref,max),(sha256,max)=>readHash(project,sha256,max));
   yield* attempt(()=>{
    // Stage and flush settings before registry publication. A later rename failure
    // can leave an inert association; read() still refuses missing/old settings.
    if(!isAbsolute(options.foremanHome))throw Error('home must be absolute');
    makeDirectory(options.foremanHome);
    const parent=join(location.repository.gitCommonDir,'foreman');makeDirectory(parent);
    const target=join(parent,'project.json');
    let before:Stats|undefined;
    try{before=lstatSync(target);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(before&&(!before.isFile()||before.isSymbolicLink()||before.nlink!==1))throw Error('unsafe settings target');
    const temporary=join(parent,`.project-${randomUUID()}.tmp`);
    const fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{const content=Buffer.from(canonicalize(project));let offset=0;while(offset<content.length)offset+=writeSync(fd,content,offset,content.length-offset);fsyncSync(fd);}finally{closeSync(fd);}
    try{
     const registration=registerProjectFileV1(registryPath,{project_id:project.projectId,operation_id:randomUUID(),git_common_dir:location.repository.gitCommonDir,worktree_path:location.worktreePath,store_backend:'files-only',store_location:project.stateRoot});
     if(registration._tag!=='Registered')throw Error('registry refused binding');
     validateFilesystem(project,location.repository);directory(parent);
     if(before?identity(lstatSync(target))!==identity(before):existsSync(target))throw Error('concurrent settings replacement');
     renameSync(temporary,target);
     const parentFd=openSync(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(parentFd);}finally{closeSync(parentFd);}
    }finally{if(existsSync(temporary))unlinkSync(temporary);}
   },'Project configuration could not be atomically registered and stored');
   return project;
  }),
 };
}
