/** Git ref publication under existing authority, process ownership, and resource scope. */
import {realpath,stat} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {Effect,type Scope} from 'effect';
import {canonicalize,isCommitSha40,sha256Hex} from '@foreman/core';
import {decodeReleaseAuthorityFileV1,gitArgv,sanitizedGitEnv,type RegisteredReleaseAuthorityV1,type ReleaseCandidateIdentityV1,type ReleaseEvidenceBundleV1} from '@foreman/policy';
import {EndstopLedger} from './execution-ledger.js';
import {ProcessExec,type CapturedProcessResult} from './queue-services.js';
import {PelRuntime,type HostContextV1,type PelArtifactRefV1,type PelDestinationBindingV1,type PelHostEffectFailureV1,type PelReservationTokenV1,type PreparedHostEffectV1,type RunFailure} from './pel-run-contract.js';
import {validateReservationToken} from './pel-effects.js';
import {observePelCapturedCandidate} from './pel-candidate-capture.js';
import {decodeCandidateRefV1,type CandidateRefV1} from './pel-host-contract.js';
import {readPelArtifactJson} from './pel-recovery.js';
import {canonicalWorkspacePath,pelPublicationResource} from './pel-resource-scope.js';

export interface PelPublicationInputV1 {readonly destinationId:string;readonly candidate:ReleaseCandidateIdentityV1;readonly evidenceRefs:readonly PelArtifactRefV1[];readonly integrationReceiptRef:PelArtifactRefV1|null;}
export interface PreparedPelPublicationV1 {
 readonly schemaVersion:1;readonly input:PelPublicationInputV1;readonly destination:PelDestinationBindingV1;
 readonly registration:RegisteredReleaseAuthorityV1;readonly authorityRef:PelArtifactRefV1;readonly remoteDirectoryIdentity:string|null;readonly workspaceDirectoryIdentity:string;
 readonly operationDigest:string;
}
export type PelPublicationPreparationV1={readonly kind:'ready';readonly preparation:PreparedPelPublicationV1}|{readonly kind:'needs-action';readonly input:PelPublicationInputV1;readonly destination:PelDestinationBindingV1;readonly authorityRef:PelArtifactRefV1|null;readonly requiredAuthoritySha256?:string};
export type PelPublicationObservationV1={readonly kind:'published';readonly observedObject:string;readonly destinationDigest:string;readonly operationDigest:string}|{readonly kind:'unknown';readonly observedObject:string|null;readonly destinationDigest:string;readonly operationDigest:string};
type Failure=PelHostEffectFailureV1|RunFailure;
type HostDispatchPreparation=Extract<PreparedHostEffectV1,{kind:'dispatch'}>;
export interface PelPublicationServiceOptionsV1 {
 readonly ledger:Pick<EndstopLedger['Type'],'familyStatus'>;readonly processExec:ProcessExec['Type'];
 /** Select the original host-captured record; the service re-observes it under its destination lock. */
 readonly resolveCapturedCandidate?:(input:PelPublicationInputV1,context:HostContextV1)=>Effect.Effect<CandidateRefV1,Failure,PelRuntime>;
 readonly readAuthority:(ref:PelArtifactRefV1,context:HostContextV1)=>Effect.Effect<Uint8Array,Failure,PelRuntime>;
 readonly readAuthorityHash?:(sha256:string,context:HostContextV1)=>Effect.Effect<{readonly ref:PelArtifactRefV1;readonly bytes:Uint8Array},Failure,PelRuntime>;
 /** Host evidence resolver validates immutable candidate, checks, independent current review, and required integration. */
 readonly validateEvidence:(input:PelPublicationInputV1,context:HostContextV1)=>Effect.Effect<void,Failure,PelRuntime>;
}
const failure=(code:PelHostEffectFailureV1['code'],message:string):PelHostEffectFailureV1=>({code,message});
const invalid=(message:string)=>failure('publication-authority-invalid',message);
const same=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
const bytes=(value:unknown)=>Buffer.from(`${canonicalize(value)}\n`);
const operationDigest=(value:Omit<PreparedPelPublicationV1,'operationDigest'>)=>sha256Hex(canonicalize(value));

export function makePelPublicationService(options:PelPublicationServiceOptionsV1){
 const git=(args:readonly string[],context:HostContextV1,observation=false):Effect.Effect<CapturedProcessResult,Failure,PelRuntime>=>Effect.gen(function*(){
  const runtime=yield* PelRuntime,remaining=context.binding.limits.deadline-(yield* runtime.clock.now);
  if(!observation&&remaining<=0)return yield* Effect.fail(failure('capability-denied','The original publication deadline has expired.'));
  const env={...sanitizedGitEnv(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'};
  return yield* options.processExec.runCaptured({command:'git',args:gitArgv(['-c','core.hooksPath=/dev/null','-c','protocol.allow=never','-c','protocol.file.allow=always','-c','protocol.https.allow=always','-c','protocol.ssh.allow=always','-c','core.sshCommand=ssh',...args]),cwd:context.workspace.canonicalRoot,env,maxOutputBytes:Math.min(65536,context.binding.limits.maxOutputBytes),timeoutMs:observation?15000:Math.min(15000,remaining)}).pipe(Effect.mapError(()=>failure('publication-authority-invalid','The bounded Git operation did not produce a reliable result.')));
 });
 const checkedGit=(args:readonly string[],context:HostContextV1)=>Effect.gen(function*(){const result=yield* git(args,context);if(result.exitCode!==0)return yield* Effect.fail(invalid('The Git identity or lineage check failed.'));return result.stdout.trim();});
 const destination=(input:PelPublicationInputV1,context:HostContextV1):Effect.Effect<PelDestinationBindingV1,Failure>=>Effect.gen(function*(){
  const value=context.project.destinations[input.destinationId];
  if(!value||value.operation!=='publish')return yield* Effect.fail(failure('publication-destination-unsupported','Only a host-admitted external Git ref publication is supported.'));
  if(value.repositoryIdentitySha256!==context.workspace.repository.identitySha256||value.repositoryIdentitySha256!==context.project.repository.identitySha256||!/^refs\/(heads|tags)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value.ref)||value.ref.includes('..')||value.ref.includes('//')||value.ref.endsWith('/')||value.ref.endsWith('.lock'))return yield* Effect.fail(invalid('The destination differs from the admitted repository or ref.'));
  if(value.expectedOldObject.kind==='exact'&&!isCommitSha40(value.expectedOldObject.oid))return yield* Effect.fail(invalid('The expected remote object is invalid.'));
  if(!isAbsolute(value.remoteIdentity)){
   let url:URL;try{url=new URL(value.remoteIdentity);}catch{return yield* Effect.fail(failure('publication-destination-unsupported','Publication requires an exact canonical path, HTTPS URL, or SSH URL.'));}
   if(!['https:','ssh:'].includes(url.protocol)||url.password||url.protocol==='https:'&&url.username||url.search||url.hash||url.href!==value.remoteIdentity)return yield* Effect.fail(failure('publication-destination-unsupported','The remote transport identity is unsupported.'));
  }
  return value;
 });
 const remoteIdentity=(target:PelDestinationBindingV1):Effect.Effect<string|null,Failure>=>!isAbsolute(target.remoteIdentity)?Effect.succeed(null):Effect.tryPromise({try:async()=>{const path=await realpath(target.remoteIdentity),info=await stat(path);if(path!==target.remoteIdentity||!info.isDirectory())throw Error('identity');return `${info.dev}:${info.ino}`;},catch:()=>invalid('The canonical remote directory identity changed.')});
 const validateCandidate=(input:PelPublicationInputV1,target:PelDestinationBindingV1,context:HostContextV1)=>Effect.gen(function*(){
  yield* canonicalWorkspacePath('.',context);
  if(!isCommitSha40(input.candidate.commit)||!isCommitSha40(input.candidate.tree)||input.candidate.candidateSha256!==sha256Hex(input.candidate.commit))return yield* Effect.fail(failure('candidate-changed','The candidate identity is invalid.'));
  const common=yield* checkedGit(['rev-parse','--git-common-dir'],context),commonPath=yield* Effect.tryPromise({try:()=>realpath(resolve(context.workspace.canonicalRoot,common)),catch:()=>invalid('The repository identity is unavailable.')});
  if(commonPath!==context.workspace.repository.gitCommonDir)return yield* Effect.fail(invalid('The candidate belongs to another Git repository.'));
  const tree=yield* checkedGit(['rev-parse','--verify',`${input.candidate.commit}^{tree}`],context);
  if(tree!==input.candidate.tree)return yield* Effect.fail(failure('candidate-changed','The immutable candidate tree changed.'));
  if(options.resolveCapturedCandidate){
   const candidate=yield* options.resolveCapturedCandidate(input,context),ref=input.evidenceRefs[0];
   if(!ref||!decodeCandidateRefV1(candidate).ok||!same({commit:candidate.commit,tree:candidate.tree,candidateSha256:candidate.candidateSha256},input.candidate)||!same(yield* readPelArtifactJson(context.binding.runId,ref),candidate))return yield* Effect.fail(failure('candidate-changed','The captured candidate differs from its original publication evidence.'));
   yield* observePelCapturedCandidate(candidate,context).pipe(Effect.provideService(ProcessExec,options.processExec));
  }else{
   const head=yield* checkedGit(['rev-parse','--verify','HEAD'],context),dirty=yield* checkedGit(['status','--porcelain=v1','--untracked-files=all'],context);
   if(head!==input.candidate.commit||dirty!=='')return yield* Effect.fail(failure('candidate-changed','The candidate worktree or commit changed after evidence capture.'));
  }
  yield* checkedGit(['check-ref-format',target.ref],context);
  // A host config rewrite could silently redirect a literal remote URL.
  const rewrites=yield* git(['config','--get-regexp','^url\\..*\\.(insteadof|pushinsteadof)$'],context);
  if(rewrites.exitCode!==1||rewrites.stdout!=='')return yield* Effect.fail(invalid('Git URL rewrites are incompatible with an exact publication destination.'));
  if(target.expectedOldObject.kind==='exact')yield* checkedGit(['merge-base','--is-ancestor',target.expectedOldObject.oid,input.candidate.commit],context);
 });
 const registeredAuthority=(input:PelPublicationInputV1,target:PelDestinationBindingV1,context:HostContextV1):Effect.Effect<{registration:RegisteredReleaseAuthorityV1;authorityRef:PelArtifactRefV1}|{registration:null;requiredAuthoritySha256?:string},Failure,PelRuntime>=>Effect.gen(function*(){
  const bound=context.binding.authority;if(bound.kind!=='v2-child')return {registration:null};
  const state=yield* options.ledger.familyStatus(bound).pipe(Effect.mapError(()=>invalid('The original registered publication authority is unavailable.')));
  if(state.root.contractSha256!==context.binding.contractSha256||state.root.contract.authorizationSha256!==context.binding.authoritySha256)return yield* Effect.fail(invalid('The registered root authority changed.'));
  let authorityRef=target.authorityRef,authorityBytes:Uint8Array;
  let rows=state.childAuthorities.filter(row=>row.rootContractId===bound.rootContractId&&row.rootContractSha256===bound.rootContractSha256&&row.familySha256===bound.familySha256&&row.childId===bound.childId&&row.action==='publish'&&row.effectiveAction==='publish');
  if(authorityRef){
   authorityBytes=yield* options.readAuthority(authorityRef,context);
   rows=rows.filter(row=>row.bundleSha256===authorityRef!.sha256);
  }else{
   rows=rows.filter(row=>same(row.candidate,input.candidate)&&row.taskPlanSha256===bound.taskPlanSha256&&row.priorReservationId===null&&row.originReservationId===null);
   if(rows.length===0)return {registration:null};
   if(rows.length!==1)return yield* Effect.fail(invalid('The deferred publication authority is ambiguous.'));
   const requiredAuthoritySha256=rows[0]!.bundleSha256;
   if(!options.readAuthorityHash)return {registration:null,requiredAuthoritySha256};
   const loaded=yield* options.readAuthorityHash(requiredAuthoritySha256,context).pipe(Effect.either);
   if(loaded._tag==='Left')return {registration:null,requiredAuthoritySha256};
   authorityRef=loaded.right.ref;authorityBytes=loaded.right.bytes;
   if(authorityRef.sha256!==requiredAuthoritySha256)return yield* Effect.fail(invalid('The deferred publication bundle changed its registered hash.'));
  }
  const decoded=decodeReleaseAuthorityFileV1(authorityBytes);
  if(authorityBytes.byteLength!==authorityRef.byteLength||sha256Hex(authorityBytes)!==authorityRef.sha256||decoded._tag!=='Valid'||decoded.value.schema!=='foreman.release-evidence-bundle.v1')return yield* Effect.fail(invalid('The registered publication bundle bytes are invalid.'));
  const bundle:ReleaseEvidenceBundleV1=decoded.value;
  if(bundle.rootContractId!==bound.rootContractId||bundle.rootContractSha256!==bound.rootContractSha256||bundle.familySha256!==bound.familySha256||bundle.childId!==bound.childId||bundle.action!=='publish'||!same(bundle.candidate,input.candidate))return yield* Effect.fail(invalid('The publication bundle belongs to another action or candidate.'));
  if(rows.length===0)return {registration:null};if(rows.length!==1)return yield* Effect.fail(invalid('The publication authority is ambiguous.'));
  const row=rows[0]!;
  if(row.taskPlanSha256!==bound.taskPlanSha256||row.priorReservationId!==null||row.originReservationId!==null||!same(row.candidate,input.candidate)||!same(state.family.children[bound.childId]?.currentCandidate,input.candidate)||bundle.taskPlanSha256!==row.taskPlanSha256||!same(bundle.receipts.map(receipt=>receipt.schema),row.receiptSchemas)||!same(bundle.receipts.map(receipt=>sha256Hex(bytes(receipt))),row.receiptSha256s))return yield* Effect.fail(invalid('The publication grant does not bind the exact candidate and current evidence.'));
  return {registration:row,authorityRef};
 });
 const remoteObject=(target:PelDestinationBindingV1,context:HostContextV1)=>Effect.gen(function*(){const result=yield* git(['ls-remote','--refs','--',target.remoteIdentity,target.ref],context,true);if(result.exitCode!==0)return yield* Effect.fail(invalid('The exact remote ref could not be observed.'));const lines=result.stdout.trim().split('\n').filter(Boolean);if(lines.length===0)return null;if(lines.length!==1)return yield* Effect.fail(invalid('The remote returned ambiguous ref identities.'));const [oid,ref]=lines[0]!.split('\t');if(!oid||!isCommitSha40(oid)||ref!==target.ref)return yield* Effect.fail(invalid('The remote returned an invalid ref identity.'));return oid;});
 const prepare=(input:PelPublicationInputV1,context:HostContextV1):Effect.Effect<PelPublicationPreparationV1,Failure,PelRuntime>=>Effect.gen(function*(){
  const target=yield* destination(input,context),runtime=yield* PelRuntime;
  yield* runtime.resources.acquire({reads:[pelPublicationResource(target)],writes:[]},context);
  yield* options.validateEvidence(input,context);yield* validateCandidate(input,target,context);
  const selected=yield* registeredAuthority(input,target,context);if(!selected.registration)return {kind:'needs-action' as const,input,destination:target,authorityRef:target.authorityRef,...(selected.requiredAuthoritySha256?{requiredAuthoritySha256:selected.requiredAuthoritySha256}:{})};
  const {registration,authorityRef}=selected;
  const remoteDirectoryIdentity=yield* remoteIdentity(target),observed=yield* remoteObject(target,context),expected=target.expectedOldObject.kind==='exact'?target.expectedOldObject.oid:null;
  if(observed!==expected)return yield* Effect.fail(invalid('The destination no longer contains its expected old object.'));
  const data={schemaVersion:1 as const,input,destination:target,registration,authorityRef,remoteDirectoryIdentity,workspaceDirectoryIdentity:context.workspace.directoryIdentity};return {kind:'ready' as const,preparation:{...data,operationDigest:operationDigest(data)}};
 }).pipe(Effect.scoped);
 const validatePrepared=(prepared:PreparedPelPublicationV1,context:HostContextV1,checkRemote=true)=>Effect.gen(function*(){
  const {operationDigest:digest,...value}=prepared,target=yield* destination(prepared.input,context);
  if(operationDigest(value)!==digest||!same(target,prepared.destination)||prepared.workspaceDirectoryIdentity!==context.workspace.directoryIdentity||checkRemote&&(yield* remoteIdentity(target))!==prepared.remoteDirectoryIdentity)return yield* Effect.fail(invalid('The prepared destination or resource identity changed.'));
  return target;
 });
 const observe=(prepared:PreparedPelPublicationV1,context:HostContextV1):Effect.Effect<PelPublicationObservationV1,Failure,PelRuntime>=>Effect.gen(function*(){
  const target=yield* validatePrepared(prepared,context,false),runtime=yield* PelRuntime;yield* runtime.resources.acquire({reads:[pelPublicationResource(target)],writes:[]},context);
  const identity=yield* remoteIdentity(target).pipe(Effect.either);if(identity._tag==='Left'||identity.right!==prepared.remoteDirectoryIdentity)return {kind:'unknown' as const,observedObject:null,destinationDigest:sha256Hex(canonicalize(target)),operationDigest:prepared.operationDigest};
  const observed=yield* remoteObject(target,context).pipe(Effect.either),oid=observed._tag==='Right'?observed.right:null;return {kind:oid===prepared.input.candidate.commit?'published':'unknown',observedObject:oid,destinationDigest:sha256Hex(canonicalize(target)),operationDigest:prepared.operationDigest} as PelPublicationObservationV1;
 }).pipe(Effect.scoped);
 const commit=(prepared:PreparedPelPublicationV1,hostPrepared:HostDispatchPreparation,token:PelReservationTokenV1,context:HostContextV1):Effect.Effect<PelPublicationObservationV1,Failure,PelRuntime>=>Effect.gen(function*(){
  const valid=validateReservationToken(hostPrepared,token,context);
  if(!valid.ok||token.kind!=='v2-child'||token.operation.effectiveAction!=='publish'||hostPrepared.action!=='publish'||hostPrepared.operationDigest!==prepared.operationDigest||!same(hostPrepared.candidate,prepared.input.candidate)||token.operation.authorityBundleSha256!==prepared.registration.bundleSha256)return yield* Effect.fail(invalid('Publication requires the exact existing dispatcher reservation token.'));
  const runtime=yield* PelRuntime,target=yield* validatePrepared(prepared,context);yield* runtime.resources.acquire({reads:[],writes:[pelPublicationResource(target)]},context);
  yield* options.validateEvidence(prepared.input,context);yield* validateCandidate(prepared.input,target,context);
  const selected=yield* registeredAuthority(prepared.input,target,context);if(!selected.registration||!same(selected.registration,prepared.registration)||!same(selected.authorityRef,prepared.authorityRef))return yield* Effect.fail(invalid('The prepared publication authority changed before commit.'));
  const expected=target.expectedOldObject.kind==='exact'?target.expectedOldObject.oid:null;if((yield* remoteObject(target,context))!==expected)return yield* Effect.fail(invalid('The destination changed before publication.'));
  const result=yield* git(['push','--porcelain','--no-verify',`--force-with-lease=${target.ref}:${expected??''}`,'--',target.remoteIdentity,`${prepared.input.candidate.commit}:${target.ref}`],context).pipe(Effect.either);
  const base={destinationDigest:sha256Hex(canonicalize(target)),operationDigest:prepared.operationDigest};
  if(result._tag==='Left'||result.right.exitCode!==0)return {kind:'unknown' as const,observedObject:null,...base};
  // Do not acquire a second read lock while holding this exact destination write lock.
  const observed=yield* remoteObject(target,context).pipe(Effect.either);return observed._tag==='Right'&&observed.right===prepared.input.candidate.commit?{kind:'published' as const,observedObject:observed.right,...base}:{kind:'unknown' as const,observedObject:observed._tag==='Right'?observed.right:null,...base};
 }).pipe(Effect.scoped);
 return {prepare,commit,observe};
}
export type PelPublicationServiceV1=ReturnType<typeof makePelPublicationService>;
