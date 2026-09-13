/** Canonical host milestones reuse the effect's existing reservation and ledger. */
import {Effect} from 'effect';
import {canonicalize} from '@foreman/core';
import {RunJournal} from '@foreman/event-log';
import {decodeReleaseAuthorityFileV1,type ReleaseActionOutcomeV1,type ReleaseCandidateIdentityV1} from '@foreman/policy';
import {EndstopLedger} from './execution-ledger.js';
import {PelRuntime,type HostContextV1,type PelArtifactRefV1,type PelEffectIdentityV1,type PelReservationTokenV1,type PelHostEffectFailureV1,type RunFailure} from './pel-run-contract.js';
import {decodePelReservationTokenV1,pelHash,PEL_MAX_ARTIFACT_BYTES,readPelRecords,replayPelRun} from './pel-journal.js';
import {loadPelHostPreparation} from './pel-host-recovery.js';
export interface PelMilestoneReceiptV1 {readonly effect:PelEffectIdentityV1;readonly candidate:ReleaseCandidateIdentityV1;readonly reservation:PelReservationTokenV1;readonly observedAt:number;}
export type PelHostMilestoneV1='checks'|'audit'|'published';
const invalid=(message:string):PelHostEffectFailureV1=>({code:'capability-denied',message});
export function recordPelReleaseMilestone(ledger:EndstopLedger['Type'],receipt:PelMilestoneReceiptV1,evidenceRef:PelArtifactRefV1,milestone:PelHostMilestoneV1,context:HostContextV1,bundleRef:PelArtifactRefV1|null):Effect.Effect<void,RunFailure|PelHostEffectFailureV1,PelRuntime|RunJournal>{return Effect.gen(function*(){
 const token=receipt.reservation,action=milestone==='checks'?'verify':milestone==='audit'?'audit':'publish';
 if(!decodePelReservationTokenV1(token).ok||pelHash(token.effect)!==pelHash(receipt.effect)||pelHash(receipt.effect)!==pelHash(context.effect)||pelHash(token.candidate)!==pelHash(receipt.candidate)||token.authoritySha256!==context.binding.authoritySha256||!Number.isSafeInteger(receipt.observedAt)||receipt.observedAt<0)return yield* Effect.fail(invalid('The host milestone does not bind its original action and candidate.'));
 let effectiveAction=token.kind==='v1'?token.action:token.operation.effectiveAction;
 if(token.kind==='v1'&&token.action==='provider_retry'){
  const original=yield* loadPelHostPreparation(context);
  if(!token.effect.priorEffectId||!original||pelHash(original.token)!==pelHash(token))return yield* Effect.fail(invalid('The retry milestone lacks its original retained action.'));
  effectiveAction=original.prepared.action;
 }
 if(effectiveAction!==action)return yield* Effect.fail(invalid('The host milestone does not bind its original effective action.'));
 const runtime=yield* PelRuntime;yield* runtime.artifacts.get(context.binding.runId,evidenceRef,PEL_MAX_ARTIFACT_BYTES);
 const replay=replayPelRun(yield* readPelRecords(context.binding.runId));if(!replay.ok)return yield* Effect.fail(replay.error);
 if(pelHash(replay.value.intents.get(context.effect.effectId)?.reservation??null)!==pelHash(token))return yield* Effect.fail(invalid('The host milestone has no matching durable dispatch reservation.'));
 const issuedAt=new Date(Math.floor(receipt.observedAt/1000)*1000).toISOString().replace('.000Z','Z');
 if(token.kind==='v1'){
  if(token.contractId!==context.binding.contractId||token.contractSha256!==context.binding.contractSha256)return yield* Effect.fail(invalid('The host milestone belongs to another contract.'));
  const state=yield* ledger.status(token.contractId).pipe(Effect.mapError(()=>invalid('The original execution contract is unavailable.')));
  if(state.contractSha256!==token.contractSha256||state.currentCandidateSha256!==receipt.candidate.candidateSha256)return yield* Effect.fail(invalid('The registered candidate differs from the host milestone.'));
  if(!state.contract.requiredMilestones.includes(milestone)||state.milestones[milestone]===evidenceRef.sha256)return;
  const result=yield* ledger.execute(token.contractId,token.contractSha256,{_tag:'RecordMilestone',milestone,candidateSha256:receipt.candidate.candidateSha256,evidenceSha256:evidenceRef.sha256,at:issuedAt}).pipe(Effect.mapError(()=>invalid('The existing ledger refused the host milestone.')));
  if(!['Accepted','Terminated'].includes(result.decision._tag)||result.state.milestones[milestone]!==evidenceRef.sha256)return yield* Effect.fail(invalid('The existing ledger did not accept the host milestone.'));return;
 }
 const binding=context.binding.authority;
 if(binding.kind!=='v2-child'||!bundleRef||token.rootContractId!==binding.rootContractId||token.rootContractSha256!==binding.rootContractSha256||token.familySha256!==binding.familySha256||token.childId!==binding.childId||bundleRef.sha256!==token.operation.authorityBundleSha256)return yield* Effect.fail(invalid('The milestone lacks the original registered child authority.'));
 const authorityBytes=yield* runtime.artifacts.get(context.binding.runId,bundleRef,PEL_MAX_ARTIFACT_BYTES),authority=decodeReleaseAuthorityFileV1(authorityBytes);
 if(authority._tag!=='Valid'||authority.value.schema!=='foreman.release-evidence-bundle.v1'||authority.sha256!==token.operation.authorityBundleSha256)return yield* Effect.fail(invalid('The canonical action authority is invalid.'));
 const bundle=authority.value;
 if(bundle.rootContractId!==token.rootContractId||bundle.rootContractSha256!==token.rootContractSha256||bundle.familySha256!==token.familySha256||bundle.childId!==token.childId||bundle.action!==token.operation.reservationAction||pelHash(bundle.candidate)!==pelHash(receipt.candidate))return yield* Effect.fail(invalid('The canonical bundle belongs to another action or candidate.'));
 const outcome:ReleaseActionOutcomeV1={schema:'foreman.release-action-outcome.v1',program:bundle.program,rootContractId:token.rootContractId,rootContractSha256:token.rootContractSha256,familySha256:token.familySha256,childId:token.childId,packageId:bundle.packageId,reservationAction:token.operation.reservationAction,effectiveAction:action,reservationId:token.reservationId,originReservationId:token.operation.originReservationId,candidateSha256:receipt.candidate.candidateSha256,status:'PASS',evidenceSha256:evidenceRef.sha256,issuedAt};
 const bytes=Buffer.from(`${canonicalize(outcome)}\n`),decoded=decodeReleaseAuthorityFileV1(bytes);if(decoded._tag!=='Valid')return yield* Effect.fail(invalid('The canonical host outcome is invalid.'));
 yield* runtime.artifacts.put(context.binding.runId,bytes,PEL_MAX_ARTIFACT_BYTES,'ordinary');
 yield* ledger.registerChildOutcome({rootContractId:token.rootContractId,rootContractSha256:token.rootContractSha256,familySha256:token.familySha256,childId:token.childId,reservationId:token.reservationId,originReservationId:token.operation.originReservationId,reservationAction:token.operation.reservationAction,effectiveAction:action,candidateSha256:receipt.candidate.candidateSha256,outcomeSha256:decoded.sha256,outcomeSchema:'foreman.release-action-outcome.v1',registeredAt:issuedAt}).pipe(Effect.mapError(()=>invalid('The existing ledger refused the host outcome.')));
 const state=yield* ledger.familyStatus(binding).pipe(Effect.mapError(()=>invalid('The original execution child is unavailable.'))),child=state.family.children[token.childId];if(!child)return yield* Effect.fail(invalid('The original execution child is unavailable.'));
 if(!child.contract.requiredMilestones.includes(milestone)||child.milestones[milestone]===decoded.sha256)return;
 const recorded=yield* ledger.executeChild({rootContractId:token.rootContractId,rootContractSha256:token.rootContractSha256,familySha256:token.familySha256,childId:token.childId,operation:{_tag:'RecordMilestone',milestone,outcomeSha256:decoded.sha256,reservationId:token.reservationId,originReservationId:token.operation.originReservationId,candidateSha256:receipt.candidate.candidateSha256},at:issuedAt}).pipe(Effect.mapError(()=>invalid('The existing ledger refused the host milestone.')));
 if(!['Accepted','Terminated'].includes(recorded.decision._tag)||recorded.state.children[token.childId]?.milestones[milestone]!==decoded.sha256)return yield* Effect.fail(invalid('The existing ledger did not accept the host milestone.'));
});}
