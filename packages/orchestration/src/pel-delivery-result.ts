/** Read-only operator projection of run results and host-owned delivery evidence. */
import {join} from 'node:path';
import {Effect} from 'effect';
import type {ProviderIdentityV1} from '@foreman/providers';
import type {HostContextV1,RunResultV1,PelArtifactRefV1} from './pel-run-contract.js';
import type {CandidateRefV1,VerificationReceiptV1,ReviewReceiptV1,PublicationReceiptV1} from './pel-host-contract.js';
import {decodeCandidateRefV1,decodeReviewReceiptV1} from './pel-host-contract.js';
import {readPelHostEvidenceRecords,loadPelHostEvidence} from './pel-host-evidence.js';
import {readPelArtifactJson} from './pel-recovery.js';
import {pelFailure,pelHash} from './pel-journal.js';
import {decodeRunResultV1} from './pel-run-result.js';
import {readPelCandidateScopes} from './pel-host-candidate-scope.js';
export interface PelDeliveryProviderV1 {readonly kind:'api'|'native';readonly provider:string;readonly profileId:string;readonly transportId:string;readonly model?:string}
export type DeliveryResultV1=RunResultV1 & {
 readonly evidenceKind:HostContextV1['binding']['evidenceKind'];
 readonly candidate:{readonly ref:PelArtifactRefV1;readonly value:CandidateRefV1}|null;
 readonly checks:({readonly ref:PelArtifactRefV1}&Pick<VerificationReceiptV1,'gateId'|'gateDigest'|'environmentDigest'|'policyDigest'|'passed'|'reportRef'>)|null;
 readonly review:({readonly ref:PelArtifactRefV1;readonly implementer:PelDeliveryProviderV1;readonly reviewer:PelDeliveryProviderV1}&Pick<ReviewReceiptV1,'verdict'|'policyId'|'policyDigest'|'reportRef'>)|null;
 readonly publication:({readonly ref:PelArtifactRefV1}&Pick<PublicationReceiptV1,'destinationId'|'destinationDigest'|'operationDigest'|'observedObject'|'reportRef'>)|null;
 readonly findings:readonly string[];
 readonly nextAction:string;
};
const provider=(identity:ProviderIdentityV1):PelDeliveryProviderV1=>({kind:identity.kind,provider:identity.provider,profileId:identity.profileId,transportId:identity.transportId,...(identity.model===undefined?{}:{model:identity.model})});
const same=(a:unknown,b:unknown)=>pelHash(a)===pelHash(b);
export function projectPelDeliveryResult(result:RunResultV1,context:Pick<HostContextV1,'binding'>){
 return Effect.gen(function*(){
  const decoded=decodeRunResultV1(result);
  if(!decoded.ok||result.runId!==context.binding.runId||result.programDigest!==context.binding.checkedProgramDigest||!same(result.attempt,context.binding.attempt))return yield* Effect.fail(pelFailure('binding-mismatch','The delivery result differs from its original run binding.'));
  const {entries,replay}=yield* readPelHostEvidenceRecords(context);
  let candidate:DeliveryResultV1['candidate']=null,checks:DeliveryResultV1['checks']=null,review:DeliveryResultV1['review']=null,publication:DeliveryResultV1['publication']=null,findings:readonly string[]=[];
  const scopes=yield* readPelCandidateScopes(context);
  const implementationEntry=[...entries].reverse().find(entry=>{
   if(entry.kind!=='implementation')return false;
   const requestId=replay.intents.get(entry.effectId)?.effect.requestId;
   const lineage=scopes.lineage(requestId?scopes.owners.get(requestId):undefined);
   return lineage!==null&&!lineage.some(child=>child.childKind==='race'&&scopes.winners.get(child.parentRequestId)!==child.index);
  });
  if(implementationEntry){
   const implementation=yield* loadPelHostEvidence(implementationEntry.ref,'implementation',context);
   if(implementation.kind!=='implementation')return yield* Effect.fail(pelFailure('binding-mismatch','The implementation receipt has the wrong kind.'));
   if(implementation.candidateRef){const value=decodeCandidateRefV1(yield* readPelArtifactJson(context.binding.runId,implementation.candidateRef));
    if(!value.ok||!same(value.value.repository,context.binding.repository)||!same(value.value.producingAttempt,context.binding.attempt))return yield* Effect.fail(pelFailure('binding-mismatch','The delivery candidate differs from its run.'));
    // A no-change implementation can retain the previous captured candidate.
    if(!entries.some(entry=>entry.kind==='implementation'&&entry.effectId===value.value.producingEffectId))return yield* Effect.fail(pelFailure('binding-mismatch','The candidate has no original implementation observation.'));
    candidate={ref:implementation.candidateRef,value:value.value};
   }
  }
  if(candidate){
   let checked:VerificationReceiptV1|null=null,reviewed:ReviewReceiptV1|null=null;
   for(const entry of entries.filter(entry=>entry.kind==='verification')){
    const receipt=yield* loadPelHostEvidence(entry.ref,'verification',context);
    if(receipt.kind==='verification'&&same(receipt.candidateRef,candidate.ref)){checked=receipt;findings=receipt.passed?[]:[`Registered gate ${receipt.gateId} failed.`];checks={ref:entry.ref,gateId:receipt.gateId,gateDigest:receipt.gateDigest,environmentDigest:receipt.environmentDigest,policyDigest:receipt.policyDigest,passed:receipt.passed,reportRef:receipt.reportRef};}
   }
   const invalidatedReviews=new Map<string,number>();
   for(const record of replay.records){if(record.type!=='pel.effect.observed.v1')continue;const observation=yield* readPelArtifactJson(context.binding.runId,record.data.observationRef);if(observation!==null&&typeof observation==='object'&&!Array.isArray(observation)&&'stage' in observation&&observation.stage==='review-in-progress'&&'candidateRef' in observation)invalidatedReviews.set(pelHash(observation.candidateRef),record.sequence);}
   for(const entry of entries.filter(entry=>entry.kind==='review')){
    const original=decodeReviewReceiptV1(yield* readPelArtifactJson(context.binding.runId,entry.ref));
    if(!original.ok)return yield* Effect.fail(pelFailure('binding-mismatch','The retained review receipt is invalid.'));
    if(!same(original.value.candidateRef,candidate.ref)||entry.sequence<(invalidatedReviews.get(pelHash(original.value.candidateRef))??0))continue;
    const receipt=yield* loadPelHostEvidence(entry.ref,'review',context);
    if(receipt.kind==='review'&&same(receipt.candidateRef,candidate.ref)&&checks&&same(receipt.verificationRef,checks.ref)){
     reviewed=receipt;findings=[...receipt.findings];review={ref:entry.ref,verdict:receipt.verdict,policyId:receipt.policyId,policyDigest:receipt.policyDigest,reportRef:receipt.reportRef,implementer:provider(receipt.implementer),reviewer:provider(receipt.reviewer)};
    }
   }
   for(const entry of entries.filter(entry=>entry.kind==='publication')){
    const receipt=yield* loadPelHostEvidence(entry.ref,'publication',context);
    if(receipt.kind==='publication'&&same(receipt.candidateRef,candidate.ref)&&checked?.passed&&reviewed?.verdict==='approved'&&checks&&review&&same(receipt.verificationRef,checks.ref)&&same(receipt.reviewRef,review.ref))publication={ref:entry.ref,destinationId:receipt.destinationId,destinationDigest:receipt.destinationDigest,operationDigest:receipt.operationDigest,observedObject:receipt.observedObject,reportRef:receipt.reportRef};
   }
  }
  const nextAction=result.diagnostics.find(item=>item.nextAction.length>0)?.nextAction??(result.state==='succeeded'?'Inspect the retained delivery evidence.':result.externalOutcome==='unknown'?'Observe the recorded external operation before resuming.':checks?.passed===false?'Inspect the failed verification report.':review?.verdict==='changes-requested'?'Inspect the review findings and remaining correction allowance.':'Inspect the durable run state before resuming.');
  return {...decoded.value,evidenceKind:context.binding.evidenceKind,candidate,checks,review,publication,findings,nextAction} satisfies DeliveryResultV1;
 });
}
export const formatPelDeliveryResultJson=(result:DeliveryResultV1):string=>JSON.stringify(result,null,2)+'\n';
/** artifactPath can provide the original run's immutable artifact directory. */
export function formatPelDeliveryResultText(result:DeliveryResultV1,artifactPath:(ref:PelArtifactRefV1)=>string=ref=>join('runs',result.runId,'artifacts',ref.artifactId)):string{
 const link=(ref:PelArtifactRefV1)=>`[${ref.artifactId}](${artifactPath(ref)})`;
 const lines=[`Run ${result.runId}: ${result.state} (${result.evidenceKind})`];
 if(result.candidate)lines.push(`Candidate ${result.candidate.value.commit}: ${link(result.candidate.ref)}`);
 if(result.checks)lines.push(`Checks ${result.checks.gateId}: ${result.checks.passed?'passed':'failed'} ${link(result.checks.reportRef)}`);
 if(result.review)lines.push(`Review: ${result.review.verdict} (${result.review.reviewer.provider}) ${link(result.review.reportRef)}`);
 if(result.publication)lines.push(`Publication ${result.publication.destinationId}: ${result.publication.observedObject} ${link(result.publication.reportRef)}`);
 for(const item of result.diagnostics)lines.push(`${item.code}${item.sourceSpan?` at ${item.sourceSpan.line}:${item.sourceSpan.column} (bytes ${item.sourceSpan.start}–${item.sourceSpan.end})`:''}${item.effectId?` [${item.effectId}]`:''}: ${item.message}`,...item.evidenceRefs.map(link));
 lines.push(...result.findings.map(value=>`Finding: ${value}`),`Next action: ${result.nextAction}`);return lines.join('\n')+'\n';
}
