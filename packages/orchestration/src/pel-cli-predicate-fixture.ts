/** Fixed local V2 evaluation authority for the compiled test entry only. */
import {Effect} from 'effect';
import {canonicalize,sha256Hex} from '@foreman/core';
import {deriveExecutionContractFamilyV2,executionContractSha256,type ExecutionContractV1} from './execution-contract.js';
import {EndstopLedger} from './execution-ledger.js';
import {pelFailure} from './pel-journal.js';
import type {PelArtifactRefV1,PelAuthorityBindingV1} from './pel-run-contract.js';
const rows=[['v040-t2-project-registry','project-registry',[]],['v040-t3-memory-index','external-memory-index',['v040-t2-project-registry']],['v040-t4-appliance','hermetic-foreman-appliance',[]],['v040-t5-graphify','knowledge-plane-refresh',[]],['v040-t6-work-dag','work-dag-projection',['v040-t5-graphify']],['v040-t7-context','graph-context-builder',['v040-t6-work-dag']],['v040-t8-evaluation','graph-eval-falsification',['v040-t3-memory-index','v040-t4-appliance','v040-t7-context']],['v040-t9-release','v040-release-program',['v040-t2-project-registry','v040-t3-memory-index','v040-t4-appliance','v040-t5-graphify','v040-t6-work-dag','v040-t7-context','v040-t8-evaluation']]] as const;
export const fixturePredicateCandidate={commit:'a'.repeat(40),tree:'b'.repeat(40),candidateSha256:sha256Hex('a'.repeat(40))};
export function prepareFixturePredicateAuthority(contract:ExecutionContractV1,authorityRef:PelArtifactRefV1){return Effect.gen(function*(){
 const rootContractSha256=executionContractSha256(contract),source={schema:'foreman.execution-family-source.v1',program:'v040',familyId:'v040-release-20260822-f1',children:rows.map(([childId,packageId,dependencyChildIds],index)=>({schema:'foreman.execution-child-brief.v1',childId,packageId,dependencyChildIds,tranche:index+2,objective:'Fixed local predicate fixture prerequisite',acceptance:['Recorded fixture checks pass'],allowedPaths:['src/**']}))};
 const bytes=Buffer.from(canonicalize(source)+'\n'),derived=deriveExecutionContractFamilyV2({rootContractId:contract.contractId,rootContractSha256,track1Commit:contract.baseCommit,track1Tree:fixturePredicateCandidate.tree,sourceBytes:bytes,createdAt:contract.createdAt});
 if(derived._tag!=='Valid')return yield* Effect.fail(pelFailure('binding-mismatch','Fixed predicate family did not validate.'));
 const familySha256=derived.familySha256,common={rootContractId:contract.contractId,rootContractSha256,familySha256},sourceRef={artifactId:`sha256-${sha256Hex(bytes)}`,byteLength:bytes.byteLength,sha256:sha256Hex(bytes)};
 const binding:Extract<PelAuthorityBindingV1,{kind:'v2-child'}>={kind:'v2-child',...common,authoritySha256:contract.authorizationSha256,authorityRef,childId:'v040-t8-evaluation',originReservationId:'fixture-evaluation-origin',taskPlanSha256:authorityRef.sha256,authorityBundleSha256:authorityRef.sha256};
 const ledger=yield* EndstopLedger,at=contract.createdAt;
 yield* ledger.create(contract).pipe(Effect.mapError(()=>pelFailure('binding-mismatch','Fixed predicate root could not be created.')));
 const present=yield* ledger.familyStatus(common).pipe(Effect.either);
 if(present._tag==='Right'&&present.right.childAuthorities.some(authority=>authority.childId===binding.childId&&authority.effectiveAction==='evaluate'))return {binding,retained:{ref:sourceRef,bytes}};
 const initialize=Effect.gen(function*(){
  yield* ledger.registerFamilyAuthority({...common,manifest:derived.manifest,sourceSha256:sourceRef.sha256,auditReceiptSha256:authorityRef.sha256,userReceiptSha256:authorityRef.sha256,registeredAt:at});
  yield* ledger.activateFamily({...common,sourceSha256:sourceRef.sha256,auditReceiptSha256:authorityRef.sha256,userReceiptSha256:authorityRef.sha256,activatedAt:at});
  const output={commit:'c'.repeat(40),tree:'d'.repeat(40),candidateSha256:sha256Hex('c'.repeat(40))};
  for(const child of derived.manifest.children.filter(child=>child.tranche<8)){
   const childId=child.childId;
   const register=(action:'implement'|'verify'|'audit'|'integrate',candidate:typeof fixturePredicateCandidate)=>ledger.registerChildAuthority({...common,childId,action,effectiveAction:action,priorReservationId:null,originReservationId:null,candidate,taskPlanSha256:authorityRef.sha256,bundleSha256:authorityRef.sha256,receiptSchemas:['foreman.design-approval.v1'],receiptSha256s:[authorityRef.sha256],evaluationManifestSha256:null,registeredAt:at});
   const reserve=(action:'implement'|'verify'|'audit'|'integrate',candidate:typeof fixturePredicateCandidate)=>ledger.executeChild({...common,childId,operation:{_tag:'ReserveAction',reservationId:`${childId}-${action}`,reservationAction:action,effectiveAction:action,originReservationId:`${childId}-${action}`,candidate,taskPlanSha256:authorityRef.sha256,authorityBundleSha256:authorityRef.sha256},at});
   yield* register('implement',fixturePredicateCandidate);const implemented=yield* reserve('implement',fixturePredicateCandidate);if(implemented.decision._tag!=='Accepted')return yield* Effect.fail(pelFailure('binding-mismatch','Fixed prerequisite implementation was refused.'));
   yield* ledger.executeChild({...common,childId,operation:{_tag:'RecordProductChange',reservationId:`${childId}-implement`,originReservationId:`${childId}-implement`,baseCandidate:fixturePredicateCandidate,candidate:output,allowedPathsSha256:child.allowedPathsSha256},at});
   for(const [action,milestone] of [['verify','checks'],['audit','audit'],['integrate','integrated']] as const){
    yield* register(action,output);const reserved=yield* reserve(action,output);if(reserved.decision._tag!=='Accepted')return yield* Effect.fail(pelFailure('binding-mismatch','Fixed prerequisite check was refused.'));
    const reservationId=`${childId}-${action}`;
    yield* ledger.registerChildOutcome({...common,childId,reservationId,originReservationId:reservationId,reservationAction:action,effectiveAction:action,candidateSha256:output.candidateSha256,outcomeSha256:authorityRef.sha256,outcomeSchema:'foreman.release-action-outcome.v1',registeredAt:at});
    yield* ledger.executeChild({...common,childId,operation:{_tag:'RecordMilestone',milestone,outcomeSha256:authorityRef.sha256,reservationId,originReservationId:reservationId,candidateSha256:output.candidateSha256},at});
   }
  }
  yield* ledger.registerChildAuthority({...common,childId:binding.childId,action:'evaluate',effectiveAction:'evaluate',priorReservationId:null,originReservationId:null,candidate:fixturePredicateCandidate,taskPlanSha256:authorityRef.sha256,bundleSha256:authorityRef.sha256,receiptSchemas:['foreman.evaluation-authority.v1'],receiptSha256s:[authorityRef.sha256],evaluationManifestSha256:authorityRef.sha256,registeredAt:at});
 });
 yield* initialize.pipe(Effect.mapError(()=>pelFailure('binding-mismatch','The fixed predicate prerequisites could not be registered.')));
 return {binding,retained:{ref:sourceRef,bytes}};
});}
