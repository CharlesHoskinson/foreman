/** Decode preimages of existing ledger authority. This module never registers authority. */
import {isAbsolute,normalize} from 'node:path';
import {Effect} from 'effect';
import {canonicalize,isCoreFailure,parseJsonRejectDuplicateKeys,sha256Hex} from '@foreman/core';
import {decodeReleaseAuthorityFileV1,type RegisteredReleaseAuthorityV1,type ReleaseActionV1} from '@foreman/policy';
import type {Result} from '@foreman/pel';
import {EndstopLedger,type ExecutionFamilyLedgerStatusV2} from './execution-ledger.js';
import {decodeExecutionContractV1,deriveExecutionContractFamilyV2,executionContractSha256,isExecutionContractFailure,type ExecutionContractV1} from './execution-contract.js';
import {decodeForemanProjectV1} from './pel-project-config.js';
import {decodePelArtifactRefV1,decodePelRepositoryIdentityV1,decodePelWorkspaceGrantV1,type ExecutionBindingV1,type ForemanProjectV1,type PelArtifactRefV1,type PelAuthorityBindingV1,type PelContractDecodeFailureV1,type PelReceiptRefV1,type PelWorkspaceGrantV1,type RunFailure} from './pel-run-contract.js';

export interface PelProjectAuthorityV1 {
 readonly schemaVersion:1;
 readonly repository:ForemanProjectV1['repository'];
 readonly stateRoot:string;
 readonly workspaceGrants:readonly PelWorkspaceGrantV1[];
 readonly taskActions:ForemanProjectV1['taskActions'];
 readonly gates:ForemanProjectV1['gates'];
 readonly destinations:ForemanProjectV1['destinations'];
}
export type PelAuthorityInputLocatorV1=PelArtifactRefV1|{readonly sha256:string};
export type PelAuthorityInputReaderV1=(locator:PelAuthorityInputLocatorV1,maxBytes:number)=>Effect.Effect<Uint8Array,RunFailure>;
export interface PelResolvedProjectAuthorityV1 {
 readonly contract:ExecutionContractV1;
 readonly executionDeadline:number;
 readonly binding:PelAuthorityBindingV1;
 readonly scope:PelProjectAuthorityV1;
 readonly workspaceGrants:readonly PelWorkspaceGrantV1[];
 readonly allowedTaskActions:ForemanProjectV1['taskActions'];
 readonly gates:ForemanProjectV1['gates'];
 readonly destinations:ForemanProjectV1['destinations'];
 readonly retainedInputs:readonly {readonly ref:PelArtifactRefV1;readonly bytes:Uint8Array}[];
 readonly family:ExecutionFamilyLedgerStatusV2|null;
}
const MAX=1048576;
const fail=(message:string):RunFailure=>({_tag:'PelRunFailure',code:'binding-mismatch',diagnostic:{code:'binding-mismatch',message,sourceSpan:null,effectId:null,retryable:false,nextAction:'Reference a typed scope whose bytes match existing registered execution authority.',evidenceRefs:[]}});
const bad=(fieldPath:string):Result<never,PelContractDecodeFailureV1>=>({ok:false,error:{code:'invalid-contract',fieldPath}});
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)&&Reflect.ownKeys(value).every(key=>typeof key==='string'&&'value' in Object.getOwnPropertyDescriptor(value,key)!);
const exact=(value:Record<string,unknown>,fields:readonly string[])=>Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key));
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.isWellFormed()&&Buffer.byteLength(value)<=4096&&!/[\u0000-\u001f\u007f]/u.test(value);
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const positive=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>0;
const list=(value:unknown):value is unknown[]=>Array.isArray(value)&&value.length<=1000&&Object.keys(value).length===value.length;
const strings=(value:unknown):value is string[]=>list(value)&&value.every(text)&&new Set(value).size===value.length;
const map=(value:unknown):value is Record<string,unknown>=>record(value)&&Object.keys(value).length<=1000&&Object.keys(value).every(text);
const same=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
const relativePath=(path:string)=>path==='.'||(!isAbsolute(path)&&normalize(path)===path&&!/[\\*?\u0000-\u001f\u007f]/u.test(path)&&path.split('/').every(part=>part!=='.'&&part!=='..'&&part.length>0));
const sorted=(values:readonly string[])=>[...new Set(values)].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
/** Canonical authority files use UTF-8 canonical JSON with exactly one final newline. */
export function pelAuthorityFileBytes(value:unknown):Uint8Array{return Buffer.from(`${canonicalize(value)}\n`);}
/** V1 has no earlier typed path preimage. This projection binds all authorized relative paths. */
export function pelV1AllowedPathsSha256(grants:readonly PelWorkspaceGrantV1[]):string {
 return sha256Hex(pelAuthorityFileBytes({schema:'foreman.execution-paths.v1',allowedPaths:sorted(grants.flatMap(grant=>grant.writablePaths))}));
}
export function decodePelProjectAuthorityV1(value:unknown):Result<PelProjectAuthorityV1,PelContractDecodeFailureV1>{
 if(!record(value)||!exact(value,['schemaVersion','repository','stateRoot','workspaceGrants','taskActions','gates','destinations'])||value.schemaVersion!==1||!decodePelRepositoryIdentityV1(value.repository).ok||!text(value.stateRoot)||!isAbsolute(value.stateRoot)||normalize(value.stateRoot)!==value.stateRoot)return bad('authority');
 if(!list(value.workspaceGrants)||!value.workspaceGrants.length)return bad('authority.workspaceGrants');
 const ids=new Set<string>(),roots=new Set<string>();
 for(const raw of value.workspaceGrants){const grant=decodePelWorkspaceGrantV1(raw);if(!grant.ok||!same(grant.value.repository,value.repository)||ids.has(grant.value.grantId)||roots.has(grant.value.canonicalRoot)||!grant.value.writablePaths.every(relativePath))return bad('authority.workspaceGrants');ids.add(grant.value.grantId);roots.add(grant.value.canonicalRoot);}
 if(!map(value.taskActions)||!Object.values(value.taskActions).every(action=>action==='implement'||action==='correct'))return bad('authority.taskActions');
 if(!map(value.gates))return bad('authority.gates');
 for(const gate of Object.values(value.gates))if(!record(gate)||!exact(gate,['argv','environmentRefs','environmentSha256','maxOutputBytes','timeoutMs'])||!list(gate.argv)||!gate.argv.length||!gate.argv.every(text)||!strings(gate.environmentRefs)||!digest(gate.environmentSha256)||!positive(gate.maxOutputBytes)||gate.maxOutputBytes>64*MAX||!positive(gate.timeoutMs))return bad('authority.gates');
 if(!map(value.destinations))return bad('authority.destinations');
 for(const destination of Object.values(value.destinations)){
  if(!record(destination)||!exact(destination,['operation','repositoryIdentitySha256','remoteIdentity','ref','expectedOldObject','authorityRef'])||!['integrate','publish'].includes(destination.operation as string)||!record(value.repository)||destination.repositoryIdentitySha256!==value.repository.identitySha256||!text(destination.remoteIdentity)||!text(destination.ref)||!destination.ref.startsWith('refs/')||!decodePelArtifactRefV1(destination.authorityRef).ok||!record(destination.expectedOldObject))return bad('authority.destinations');
  const old=destination.expectedOldObject;if(!(old.kind==='absent'&&exact(old,['kind']))&&!(old.kind==='exact'&&exact(old,['kind','oid'])&&typeof old.oid==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(old.oid)))return bad('authority.destinations.expectedOldObject');
 }
 return {ok:true,value:structuredClone(value) as unknown as PelProjectAuthorityV1};
}
function parseFile(bytes:Uint8Array):Effect.Effect<unknown,RunFailure>{return Effect.try({try:()=>{if(bytes.length>MAX)throw Error();const value=parseJsonRejectDuplicateKeys(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(isCoreFailure(value)||!Buffer.from(bytes).equals(Buffer.from(pelAuthorityFileBytes(value))))throw Error();return value;},catch:()=>fail('The authority input is not bounded canonical JSON with one final newline.')});}
function readVerified(locator:PelAuthorityInputLocatorV1,read:PelAuthorityInputReaderV1):Effect.Effect<{ref:PelArtifactRefV1;bytes:Uint8Array},RunFailure>{return Effect.gen(function*(){
 if(!digest(locator.sha256)||('byteLength' in locator&&!decodePelArtifactRefV1(locator).ok))return yield* Effect.fail(fail('The authority input reference is invalid.'));
 const bytes=Uint8Array.from(yield* read(locator,MAX));if(bytes.length>MAX||sha256Hex(bytes)!==locator.sha256||('byteLength' in locator&&bytes.length!==locator.byteLength))return yield* Effect.fail(fail('The authority input bytes differ from their registered hash or length.'));
 return {ref:{artifactId:`sha256-${locator.sha256}`,byteLength:bytes.length,sha256:locator.sha256},bytes};
});}
function registeredMatches(binding:Extract<PelAuthorityBindingV1,{kind:'v2-child'}>,family:ExecutionFamilyLedgerStatusV2,action?:ReleaseActionV1){
 return family.childAuthorities.filter(item=>item.rootContractId===binding.rootContractId&&item.rootContractSha256===binding.rootContractSha256&&item.familySha256===binding.familySha256&&item.childId===binding.childId&&item.taskPlanSha256===binding.taskPlanSha256&&item.bundleSha256===binding.authorityBundleSha256&&(!action||item.action===action)&&(item.originReservationId===null||item.originReservationId===binding.originReservationId));
}
/** Return one registered identity. Ambiguous or absent child authority never selects a candidate. */
export function resolvePelRegisteredCandidate(binding:PelAuthorityBindingV1,action:ReleaseActionV1):Effect.Effect<RegisteredReleaseAuthorityV1,RunFailure,EndstopLedger>{return Effect.gen(function*(){
 if(binding.kind!=='v2-child')return yield* Effect.fail(fail('This operation requires registered V2 child authority.'));
 const ledger=yield* EndstopLedger,family=yield* ledger.familyStatus(binding).pipe(Effect.mapError(()=>fail('The registered execution family is unavailable.'))),matches=registeredMatches(binding,family,action);
 if(family.root.contract.authorizationSha256!==binding.authoritySha256||binding.authorityRef.sha256!==binding.authoritySha256||matches.length!==1||!family.family.children[binding.childId]||(action==='evaluate'&&(family.family.children[binding.childId]!.contract.limits.kind!=='evaluation'||matches[0]!.effectiveAction!=='evaluate'||matches[0]!.evaluationManifestSha256===null)))return yield* Effect.fail(fail('The requested action has no unique registered child candidate.'));
 return matches[0]!;
});}
export function resolvePelProjectAuthority(project:ForemanProjectV1,readInput:PelAuthorityInputReaderV1):Effect.Effect<PelResolvedProjectAuthorityV1,RunFailure,EndstopLedger>{return Effect.gen(function*(){
 const decoded=decodeForemanProjectV1(project);if(!decoded.ok)return yield* Effect.fail(fail('The project configuration is invalid.'));
 const contractInput=yield* readVerified(project.executionContractTemplate,readInput),contract=decodeExecutionContractV1(yield* parseFile(contractInput.bytes));if(isExecutionContractFailure(contract))return yield* Effect.fail(fail('The execution contract input is invalid.'));
 const ledger=yield* EndstopLedger,state=yield* ledger.status(contract.contractId).pipe(Effect.mapError(()=>fail('The execution contract is not registered.')));
 if(state.contractSha256!==executionContractSha256(contract)||!same(state.contract,contract)||contract.baseCommit!==project.workspaces.immutableBase)return yield* Effect.fail(fail('The contract input differs from registered execution authority.'));
 for(const key of Object.keys(contract.limits) as (keyof ExecutionContractV1['limits'])[])if(project.limits.execution[key]>contract.limits[key])return yield* Effect.fail(fail(`Configured ${key} exceeds registered root limits.`));
 if(!contract.requiredMilestones.every(milestone=>project.requiredMilestones.includes(milestone)))return yield* Effect.fail(fail('Configured milestones omit registered root requirements.'));
 const candidates=project.authorityRefs.filter(ref=>ref.authoritySha256===contract.authorizationSha256&&ref.authorityRef.sha256===contract.authorizationSha256);
 if(candidates.length!==1)return yield* Effect.fail(fail('The project must select exactly one scope bound by the registered root contract.'));
 const binding=candidates[0]!,scopeInput=yield* readVerified(binding.authorityRef,readInput),scopeResult=decodePelProjectAuthorityV1(yield* parseFile(scopeInput.bytes));
 if(!scopeResult.ok)return yield* Effect.fail(fail('The registered authorization is opaque or lacks a supported typed project scope.'));
 const scope=scopeResult.value;
 if(!same(scope.repository,project.repository)||scope.stateRoot!==project.stateRoot||scope.workspaceGrants.some(grant=>grant.immutableBase!==contract.baseCommit))return yield* Effect.fail(fail('The scope belongs to another repository, state root, or immutable base.'));
 for(const grant of project.workspaces.grants){const original=scope.workspaceGrants.find(item=>item.grantId===grant.grantId);if(!original||!same({...grant,writablePaths:[]},{...original,writablePaths:[]})||!grant.writablePaths.every(path=>original.writablePaths.includes(path)))return yield* Effect.fail(fail('Configured workspace grants expand or change registered scope.'));}
 for(const key of ['taskActions','gates','destinations'] as const)for(const [id,value] of Object.entries(project[key]))if(!Object.hasOwn(scope[key],id)||!same(value,scope[key][id]))return yield* Effect.fail(fail(`Configured ${key} expand or change registered scope.`));
 const retainedInputs=[contractInput,scopeInput];let family:ExecutionFamilyLedgerStatusV2|null=null,executionDeadline=Date.parse(contract.deadlineAt);
 if(binding.kind==='v1'){
  if(contract.allowedPathsSha256!==pelV1AllowedPathsSha256(scope.workspaceGrants))return yield* Effect.fail(fail('The registered V1 path hash has no matching typed canonical path projection.'));
 }else{
  if(binding.rootContractId!==contract.contractId||binding.rootContractSha256!==state.contractSha256)return yield* Effect.fail(fail('The selected child belongs to another root contract.'));
  family=yield* ledger.familyStatus(binding).pipe(Effect.mapError(()=>fail('The selected execution family is not registered and active.')));
  const selectedChild=family.family.children[binding.childId];if(!selectedChild)return yield* Effect.fail(fail('The selected child is absent from the registered family.'));
  const childLimits=selectedChild.contract.limits;
  for(const key of Object.keys(project.limits.execution) as (keyof ExecutionContractV1['limits'])[]){const bound=key==='noProductChangeMs'?(childLimits.kind==='evaluation'?childLimits.noProgressMs:childLimits.noProductChangeMs):childLimits[key];if(project.limits.execution[key]>bound)return yield* Effect.fail(fail(`Configured ${key} exceeds registered child limits.`));}
  if(project.limits.execution.totalActions>family.family.manifest.totalActions||project.limits.execution.wallTimeMs>family.family.manifest.wallTimeMs||!selectedChild.contract.requiredMilestones.every(milestone=>project.requiredMilestones.includes(milestone)))return yield* Effect.fail(fail('Configured bounds or milestones exceed the registered execution family.'));
  executionDeadline=Math.min(executionDeadline,Date.parse(selectedChild.contract.deadlineAt),Date.parse(family.family.manifest.deadlineAt));
  const manifest=family.family.manifest,sourceInput=yield* readVerified({sha256:manifest.sourceSha256},readInput),derived=deriveExecutionContractFamilyV2({rootContractId:manifest.rootContractId,rootContractSha256:manifest.rootContractSha256,track1Commit:manifest.track1Commit,track1Tree:manifest.track1Tree,sourceBytes:sourceInput.bytes,createdAt:manifest.createdAt});
  if(derived._tag!=='Valid'||derived.familySha256!==binding.familySha256||!same(derived.manifest,manifest))return yield* Effect.fail(fail('The family source does not reproduce its registered manifest.'));
  const child=derived.source.children.find(item=>item.childId===binding.childId);if(!child)return yield* Effect.fail(fail('The selected child is absent from the family source.'));
  // A workspace path grants recursive writes. Only a covering recursive child path grants that scope.
  for(const grant of project.workspaces.grants)for(const path of grant.writablePaths)if(!child.allowedPaths.some(allowed=>allowed.endsWith('/**')&&(path===allowed.slice(0,-3)||path.startsWith(allowed.slice(0,-2)))))return yield* Effect.fail(fail('A recursive workspace grant exceeds the selected child allowed paths.'));
  const registrations=registeredMatches(binding,family);if(registrations.length!==1)return yield* Effect.fail(fail('The selected child bundle has no unique registered action and candidate.'));
  const registration=registrations[0]!,bundleInput=yield* readVerified({sha256:binding.authorityBundleSha256},readInput),bundle=decodeReleaseAuthorityFileV1(bundleInput.bytes);
  if(bundle._tag!=='Valid'||bundle.value.schema!=='foreman.release-evidence-bundle.v1')return yield* Effect.fail(fail('The registered child authority bundle is invalid.'));
  const value=bundle.value,prior=value.priorReservation,evaluation=value.receipts.find(receipt=>receipt.schema==='foreman.evaluation-authority.v1');
  if((evaluation?.schema==='foreman.evaluation-authority.v1'?evaluation.manifestSha256:null)!==registration.evaluationManifestSha256)return yield* Effect.fail(fail('The evaluation receipt differs from registered child authority.'));
  if(value.rootContractId!==binding.rootContractId||value.rootContractSha256!==binding.rootContractSha256||value.familySha256!==binding.familySha256||value.childId!==binding.childId||value.packageId!==child.packageId||value.action!==registration.action||!same(value.candidate,registration.candidate)||value.taskPlanSha256!==registration.taskPlanSha256||!same(value.receipts.map(receipt=>receipt.schema),registration.receiptSchemas)||!same(value.receipts.map(receipt=>sha256Hex(pelAuthorityFileBytes(receipt))),registration.receiptSha256s)||(prior?.reservationId??null)!==registration.priorReservationId||(prior?.originReservationId??null)!==registration.originReservationId||(prior?.originalAction??value.action)!==registration.effectiveAction)return yield* Effect.fail(fail('The child bundle differs from its registered candidate, action, or receipts.'));
  retainedInputs.push(sourceInput,bundleInput);
 }
 return {contract:state.contract,executionDeadline,binding,scope,workspaceGrants:scope.workspaceGrants,allowedTaskActions:scope.taskActions,gates:scope.gates,destinations:scope.destinations,retainedInputs,family};
});}
export {validatePelRegisteredDecisionAuthority} from './pel-decision-authority.js';
