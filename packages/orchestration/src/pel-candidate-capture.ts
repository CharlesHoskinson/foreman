/** Observe real worktree bytes and create immutable candidates without changing its index or branch. */
import {constants} from 'node:fs';
import {lstat,stat,realpath,open,readlink,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {dirname,join,isAbsolute,relative,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {Effect} from 'effect';
import type {Scope} from 'effect';
import {canonicalize,sha256Hex} from '@foreman/core';
import {gitArgv,sanitizedGitEnv} from '@foreman/policy';
import type {AttemptIdentity} from '@foreman/event-log';
import {ProcessExec} from './queue-services.js';
import {decodeCandidateRefV1,decodeCandidateArtifactV1,type CandidateRefV1} from './pel-host-contract.js';
import {decodePelArtifactRefV1} from './pel-run-contract.js';
import {pelV1AllowedPathsSha256} from './pel-project-authority.js';
import {canonicalWorkspacePath} from './pel-resource-scope.js';
import type {JsonValue} from '@foreman/pel';
import {PelRuntime,type HostContextV1,type PelArtifactRefV1,type PelHostEffectFailureV1,type PelRepositoryIdentityV1} from './pel-run-contract.js';
const MAX_FILES=4096,MAX_BYTES=64*1024*1024;
const failure=(code:PelHostEffectFailureV1['code'],message:string,cause?:unknown):PelHostEffectFailureV1=>({code,message,...(cause?{cause:JSON.parse(canonicalize(cause)) as JsonValue}:{})});
const within=(root:string,path:string)=>path===root||path.startsWith(root+sep);
const identity=(s:{dev:number;ino:number})=>`${s.dev}:${s.ino}`;
const io=<A>(run:()=>Promise<A>,code:PelHostEffectFailureV1['code']='candidate-changed')=>Effect.tryPromise({try:run,catch:()=>failure(code,'Candidate filesystem evidence changed or could not be read safely.')});
const oid=(text:string):string=>{const value=text.trim();if(!/^[a-f0-9]{40}$/.test(value))throw Error('Invalid Git object identity');return value;};
const limit=(context:HostContextV1)=>Math.min(MAX_BYTES,context.binding.limits.maxOutputBytes);
export interface PelCandidateEntryV1 {readonly path:string;readonly mode:'100644'|'100755'|'120000'|'deleted';readonly content:PelArtifactRefV1|null;readonly unsafeSymlink:boolean;}
export interface PelCandidateObservationV1 {
 readonly schemaVersion:1;readonly repository:PelRepositoryIdentityV1;readonly workspaceGrantId:string;readonly workspaceIdentity:string;
 readonly baseCommit:string;readonly headCommit:string;readonly headTree:string;readonly branchRef:string|null;
 readonly entries:readonly PelCandidateEntryV1[];readonly manifestRef:PelArtifactRefV1;
}
export interface PelCapturedArtifactV1 {readonly path:string;readonly change:"present"|"deleted";readonly mode:"100644"|"100755"|"120000"|null;readonly gitBlobOid:string|null;readonly contentSha256:string|null;readonly artifact:PelArtifactRefV1|null;}
export interface PelCapturedCandidateV1 {
 readonly status:'candidate-ready'|'no-change';readonly repository:PelRepositoryIdentityV1;readonly workspaceGrantId:string;
 readonly baseCommit:string;readonly commit:string|null;readonly tree:string|null;readonly diffRef:PelArtifactRefV1;readonly manifestRef:PelArtifactRefV1;
 readonly treeDigest:string|null;readonly artifactManifestSha256:string;readonly observationRef:PelArtifactRefV1;readonly artifacts:readonly PelCapturedArtifactV1[];
 /** Digest of this concrete workspace grant. CandidateRef separately binds the original authority path digest. */
 readonly allowedPathsSha256:string;readonly changedPaths:readonly string[];readonly attempt:AttemptIdentity;readonly effectId:string;
}
function git(context:HostContextV1,args:readonly string[],extra:NodeJS.ProcessEnv={},allowedStatuses:readonly number[]=[0]){
 return Effect.gen(function*(){
  const runtime=yield* PelRuntime,now=yield* runtime.clock.now;
  if(context.binding.limits.deadline<=now)return yield* Effect.fail(failure('timeout','The original candidate capture deadline expired.'));
  const proc=yield* ProcessExec;
  const result=yield* proc.runCaptured({command:'git',args:gitArgv(['--literal-pathspecs','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.excludesFile=/dev/null','-c','core.sparseCheckout=false','-c','core.ignoreStat=false','-c','core.fileMode=true','-c','commit.gpgSign=false',...args]),cwd:context.workspace.canonicalRoot,env:{...sanitizedGitEnv(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',...extra},maxOutputBytes:limit(context),timeoutMs:Math.min(30000,context.binding.limits.deadline-now)}).pipe(Effect.mapError(()=>failure('candidate-changed','The bounded candidate Git operation did not complete.')));
  if(!allowedStatuses.includes(result.exitCode))return yield* Effect.fail(failure('candidate-changed','Git rejected the observed candidate operation.'));
  return result;
 });
}
function put(context:HostContextV1,bytes:Uint8Array){return Effect.flatMap(PelRuntime,runtime=>runtime.artifacts.put(context.binding.runId,bytes,limit(context),'ordinary')).pipe(Effect.mapError(()=>failure('artifact-missing','Candidate evidence could not be retained.')));}
function stableFile(path:string,max:number){return io(async()=>{
 const entry=await lstat(path);if(!entry.isFile()||entry.nlink!==1||entry.size>max)throw Error('Unsafe file');
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{
  const before=await fd.stat();if(identity(before)!==identity(entry)||before.size>max||before.size<0)throw Error('Changed file');const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const read=await fd.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)throw Error('Short file');offset+=read.bytesRead;}
  const after=await fd.stat(),current=await lstat(path);if(identity(after)!==identity(current)||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Changed file');return bytes;
 }finally{await fd.close();}
});}
/** Compare against a private index. The workspace index, branch, and provider remain untouched. */
export function inspectPelCandidate(context:HostContextV1):Effect.Effect<PelCandidateObservationV1,PelHostEffectFailureV1,ProcessExec|PelRuntime>{
 return Effect.scoped(Effect.gen(function*(){
  const root=context.workspace.canonicalRoot;
  yield* io(async()=>{if(await realpath(root)!==root||identity(await stat(root))!==context.workspace.directoryIdentity)throw Error('Changed workspace');});
  const common=(yield* git(context,['rev-parse','--path-format=absolute','--git-common-dir'])).stdout.trim(),top=(yield* git(context,['rev-parse','--show-toplevel'])).stdout.trim();
  yield* io(async()=>{const canonical=await realpath(common),info=await stat(canonical);if(top!==root||canonical!==context.binding.repository.gitCommonDir||canonical!==context.workspace.repository.gitCommonDir||sha256Hex(canonicalize({gitCommonDir:canonical,directoryIdentity:identity(info)}))!==context.binding.repository.identitySha256||canonicalize(context.binding.repository)!==canonicalize(context.workspace.repository))throw Error('Changed repository');});
  const headCommit=yield* git(context,['rev-parse','HEAD']).pipe(Effect.flatMap(r=>Effect.try({try:()=>oid(r.stdout),catch:()=>failure('candidate-changed','Invalid HEAD identity.')})));
  if(headCommit!==context.workspace.immutableBase)return yield* Effect.fail(failure('candidate-changed','HEAD differs from the admitted immutable base.'));
  const headTree=yield* git(context,['rev-parse',`${headCommit}^{tree}`]).pipe(Effect.flatMap(r=>Effect.try({try:()=>oid(r.stdout),catch:()=>failure('candidate-changed','Invalid tree identity.')})));
  yield* git(context,['cat-file','-e',`${context.workspace.immutableBase}^{commit}`]);
  const branch=(yield* git(context,['symbolic-ref','--quiet','HEAD'],{},[0,1])).stdout.trim();
  // User index flags and stat caches are not candidate content or selection authority.
  const scratch=yield* Effect.acquireRelease(io(()=>mkdtemp(join(tmpdir(),'foreman-observation-'))),path=>Effect.promise(()=>rm(path,{recursive:true,force:true})).pipe(Effect.orDie));
  const environment={GIT_INDEX_FILE:join(scratch,'index')};
  yield* git(context,['read-tree',headCommit],environment);
  const tracked=(yield* git(context,['diff','--no-ext-diff','--no-textconv','--no-renames','--name-only','-z',headCommit,'--'],environment)).stdout;
  // Ignore rules come from the repository. Force-added ignored user-index entries do not alter this set.
  const untracked=(yield* git(context,['ls-files','--others','--exclude-standard','-z'],environment)).stdout;
  const paths=[...new Set([...tracked.split('\0'),...untracked.split('\0')].filter(Boolean))].sort();
  if(paths.length>MAX_FILES)return yield* Effect.fail(failure('task-output-invalid','Candidate file count exceeds its bound.'));
  const entries:PelCandidateEntryV1[]=[];let total=0;
  for(const path of paths){
   if(isAbsolute(path)||path.includes('\uFFFD')||path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'||p==='.git'))return yield* Effect.fail(failure('candidate-out-of-scope','Candidate contains an unsupported or reserved path.'));
   const absolute=join(root,path);
   const info=yield* io(async()=>{try{const parent=await realpath(dirname(absolute));if(!within(root,parent))throw Error('Escaping parent');return await lstat(absolute);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}},'candidate-out-of-scope');
   if(!info){entries.push({path,mode:'deleted',content:null,unsafeSymlink:false});continue;}
   if(!info.isFile()&&!info.isSymbolicLink())return yield* Effect.fail(failure('candidate-out-of-scope','Candidate contains an unsupported special file.'));
   let bytes:Uint8Array,unsafeSymlink=false;
   if(info.isSymbolicLink()){
    const target=yield* io(()=>readlink(absolute));bytes=Buffer.from(target);unsafeSymlink=isAbsolute(target)||!within(root,resolve(dirname(absolute),target))||(yield* canonicalWorkspacePath(resolve(dirname(absolute),target),context).pipe(Effect.either))._tag==='Left';
    const again=yield* io(()=>lstat(absolute));if(identity(again)!==identity(info)||again.mtimeMs!==info.mtimeMs)return yield* Effect.fail(failure('candidate-changed','Candidate symlink changed during capture.'));
   }else bytes=yield* stableFile(absolute,limit(context)-total);
   total+=bytes.byteLength;if(total>limit(context))return yield* Effect.fail(failure('task-output-invalid','Candidate bytes exceed the admitted artifact bound.'));
   entries.push({path,mode:info.isSymbolicLink()?'120000':info.mode&0o111?'100755':'100644',content:yield* put(context,bytes),unsafeSymlink});
  }
  const data={schemaVersion:1 as const,repository:context.binding.repository,workspaceGrantId:context.workspace.grantId,workspaceIdentity:context.workspace.directoryIdentity,baseCommit:context.workspace.immutableBase,headCommit,headTree,branchRef:branch||null,entries};
  const manifestRef=yield* put(context,Buffer.from(canonicalize(data)));
  return {...data,manifestRef};
 }));
}
/** Creates only immutable Git objects and content-addressed evidence under the existing effect scope. */
export function capturePelCandidate(original:PelCandidateObservationV1,context:HostContextV1):Effect.Effect<PelCapturedCandidateV1,PelHostEffectFailureV1,ProcessExec|PelRuntime|Scope.Scope>{
 return Effect.gen(function*(){
  const current=yield* inspectPelCandidate(context);
  for(const key of ['repository','workspaceGrantId','workspaceIdentity','baseCommit','headCommit','headTree','branchRef'] as const)if(canonicalize(original[key])!==canonicalize(current[key]))return yield* Effect.fail(failure('candidate-changed','The original candidate, branch, or workspace identity changed.'));
  const old=new Map(original.entries.map(entry=>[entry.path,entry])),now=new Map(current.entries.map(entry=>[entry.path,entry]));
  const changedPaths=[...new Set([...old.keys(),...now.keys()])].filter(path=>canonicalize(old.get(path)??null)!==canonicalize(now.get(path)??null)).sort();
  const allowed=context.workspace.writablePaths.map(p=>p==='.'?'':p.replace(/\/$/,''));
  if(current.entries.some(entry=>entry.unsafeSymlink||!allowed.some(path=>!path||entry.path===path||entry.path.startsWith(path+'/'))))return yield* Effect.fail(failure('candidate-out-of-scope','Observed candidate paths escape the admitted writable set.',{manifestRef:current.manifestRef,changedPaths}));
  const base={repository:context.binding.repository,workspaceGrantId:context.workspace.grantId,baseCommit:context.workspace.immutableBase,allowedPathsSha256:pelV1AllowedPathsSha256([context.workspace]),changedPaths,attempt:context.effect.attempt,effectId:context.effect.effectId};
  if(!changedPaths.length)return {status:'no-change' as const,...base,commit:null,tree:null,treeDigest:null,artifactManifestSha256:sha256Hex(canonicalize([])),observationRef:current.manifestRef,artifacts:[],manifestRef:current.manifestRef,diffRef:yield* put(context,Buffer.alloc(0))};
  const scratch=yield* Effect.acquireRelease(io(()=>mkdtemp(join(tmpdir(),'foreman-candidate-'))),path=>Effect.promise(()=>rm(path,{recursive:true,force:true})).pipe(Effect.orDie));
  const environment={GIT_INDEX_FILE:join(scratch,'index')};
  yield* git(context,['read-tree',current.headCommit],environment);
  const runtime=yield* PelRuntime,artifacts:PelCapturedArtifactV1[]=[];
  for(const [index,entry] of current.entries.entries()){
   if(entry.mode==='deleted'){yield* git(context,['update-index','--force-remove','--',entry.path],environment);artifacts.push({path:entry.path,change:'deleted',mode:null,gitBlobOid:null,contentSha256:null,artifact:null});continue;}
   const bytes=yield* runtime.artifacts.get(context.binding.runId,entry.content!,limit(context)).pipe(Effect.mapError(()=>failure('artifact-missing','Captured candidate bytes are unavailable.'))),path=join(scratch,`blob-${index}`);
   yield* io(()=>writeFile(path,bytes,{mode:0o600,flag:'wx'}));
   const hash=yield* git(context,['hash-object','-w','--no-filters','--',path],environment).pipe(Effect.flatMap(r=>Effect.try({try:()=>oid(r.stdout),catch:()=>failure('candidate-changed','Invalid captured blob identity.')})));
   yield* git(context,['update-index','--add','--cacheinfo',entry.mode,hash,entry.path],environment);
   artifacts.push({path:entry.path,change:'present',mode:entry.mode,gitBlobOid:hash,contentSha256:entry.content!.sha256,artifact:entry.content});
  }
  const tree=yield* git(context,['write-tree'],environment).pipe(Effect.flatMap(r=>Effect.try({try:()=>oid(r.stdout),catch:()=>failure('candidate-changed','Invalid candidate tree.')})));
  const date=`@${Math.floor(context.binding.limits.deadline/1000)} +0000`;
  const commit=yield* git(context,['commit-tree',tree,'-p',current.headCommit,'-m',`Foreman candidate ${context.effect.effectId}`],{...environment,GIT_AUTHOR_NAME:'Foreman',GIT_AUTHOR_EMAIL:'foreman@invalid',GIT_COMMITTER_NAME:'Foreman',GIT_COMMITTER_EMAIL:'foreman@invalid',GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date}).pipe(Effect.flatMap(r=>Effect.try({try:()=>oid(r.stdout),catch:()=>failure('candidate-changed','Invalid candidate commit.')})));
  const diff=yield* git(context,['diff','--binary','--full-index','--no-ext-diff','--no-textconv','--no-renames',current.baseCommit,commit,'--']);
  const diffRef=yield* put(context,diff.stdoutBytes??Buffer.from(diff.stdout));
  const final=yield* inspectPelCandidate(context);if(final.manifestRef.sha256!==current.manifestRef.sha256)return yield* Effect.fail(failure('candidate-changed','Worktree evidence changed while the immutable candidate was captured.',{commit,tree,diffRef,manifestRef:current.manifestRef}));
  const treeBytes=yield* git(context,['cat-file','tree',tree]);
  const treeDigest=sha256Hex(treeBytes.stdoutBytes??Buffer.from(treeBytes.stdout));
  const data={status:'candidate-ready' as const,...base,commit,tree,treeDigest,diffRef,observationRef:current.manifestRef,artifacts};
  const manifestRef=yield* put(context,Buffer.from(canonicalize(data)));
  return {...data,manifestRef,artifactManifestSha256:manifestRef.sha256};
 });
}

/** Re-observe the exact captured worktree. The digest contains no consuming-effect metadata. */
export function observePelCapturedCandidate(candidate:CandidateRefV1,context:HostContextV1){return Effect.gen(function*(){
 if(!decodeCandidateRefV1(candidate).ok||candidate.workspaceGrantId!==context.workspace.grantId||canonicalize(candidate.repository)!==canonicalize(context.binding.repository)||candidate.baseCommit!==context.workspace.immutableBase)return yield* Effect.fail(failure('candidate-changed','The candidate is outside its original workspace.'));
 const runtime=yield* PelRuntime,bytes=yield* runtime.artifacts.get(context.binding.runId,candidate.manifestRef,MAX_BYTES).pipe(Effect.mapError(()=>failure('artifact-missing','The original candidate manifest is unavailable.')));
 const manifest=yield* Effect.try({try:()=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as Record<string,unknown>,catch:()=>failure('candidate-changed','The candidate manifest is invalid.')});
 const observation=decodePelArtifactRefV1(manifest.observationRef);
 if(!observation.ok||!Object.hasOwn(manifest,'attempt')||manifest.commit!==candidate.commit||manifest.tree!==candidate.tree||manifest.treeDigest!==candidate.treeDigest||manifest.effectId!==candidate.producingEffectId||canonicalize(manifest.attempt)!==canonicalize(candidate.producingAttempt)||!Array.isArray(manifest.artifacts)||manifest.artifacts.some(a=>!decodeCandidateArtifactV1(a).ok))return yield* Effect.fail(failure('candidate-changed','The candidate manifest changed its immutable Git or attempt identity.'));
 yield* runtime.artifacts.get(context.binding.runId,observation.value,MAX_BYTES).pipe(Effect.mapError(()=>failure('artifact-missing','The captured worktree observation is unavailable.')));
 const current=yield* inspectPelCandidate(context);
 if(current.manifestRef.sha256!==observation.value.sha256)return yield* Effect.fail(failure('candidate-changed','The current worktree differs from the captured candidate.'));
 return observation.value.sha256;
});}
