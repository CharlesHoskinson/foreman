/** Publication turns exact host evidence into a pending observation or one durable result. */
import {Effect} from 'effect';
import {canonicalize,sha256Hex} from '@foreman/core';
import {getHostDescriptor,isPelDataValue,validateDataSchema,type HostRequestV1,type PelDataValue} from '@foreman/pel';
import {recordPelReleaseMilestone} from './pel-host-milestone.js';
import {RunJournal} from '@foreman/event-log';
import {PelRuntime,type HostContextV1,type PelArtifactRefV1,type PelDispatchPreparationV1,type PelHostEffectFailureV1,type PelPreparedHandlerV1,type PelReservationTokenV1,type RunFailure} from './pel-run-contract.js';
import {decodeCandidateRefV1,decodeVerificationReceiptV1,decodeReviewReceiptV1,decodePublicationReceiptV1,pelReleaseCandidateIdentity,type CandidateRefV1,type VerificationReceiptV1,type ReviewReceiptV1,type PublicationReceiptV1} from './pel-host-contract.js';
import {EndstopLedger} from './execution-ledger.js';
import {appendPelRecord,pelHash,PEL_MAX_ARTIFACT_BYTES,readPelRecords,replayPelRun} from './pel-journal.js';
import {readPelArtifactJson} from './pel-recovery.js';
import {validateReservationToken} from './pel-effects.js';
import type {PelPublicationInputV1,PelPublicationServiceV1,PelPublicationObservationV1,PreparedPelPublicationV1} from './pel-publication-service.js';

type Failure=PelHostEffectFailureV1|RunFailure;
export interface PelPublicationResolvedInputV1 {
 readonly candidateRef:PelArtifactRefV1;readonly candidate:CandidateRefV1;
 readonly verificationRef:PelArtifactRefV1;readonly verification:VerificationReceiptV1;
 readonly reviewRef:PelArtifactRefV1;readonly review:ReviewReceiptV1;
 readonly delivery:PelDataValue;readonly integrationReceiptRef:PelArtifactRefV1|null;
}
export interface PelPublicationPorts {
 readonly service:PelPublicationServiceV1;
 /** Resolves only host-recorded current evidence in this run. Ordinary reference strings confer no authority. */
 readonly resolveInput:(input:PelDataValue,context:HostContextV1)=>Effect.Effect<PelPublicationResolvedInputV1,Failure>;
 readonly recordPublication:(receipt:PublicationReceiptV1,ref:PelArtifactRefV1,context:HostContextV1)=>Effect.Effect<void,Failure,PelRuntime|RunJournal>;
}
interface StoredPublication {readonly schemaVersion:1;readonly id:string;readonly input:PelDataValue;readonly resolved:PelPublicationResolvedInputV1;readonly publication:PreparedPelPublicationV1;}
interface ObservedPublication {readonly stage:'publication-observed';readonly operationDigest:string;readonly observation:PelPublicationObservationV1;readonly observedAt:number;}
const invalid=(message:string):PelHostEffectFailureV1=>({code:'publication-authority-invalid',message});
const str=(value:string):PelDataValue=>({tag:'string',value});
const refValue=(ref:PelArtifactRefV1):PelDataValue=>str(`artifact:${ref.artifactId}`);
const assoc=(fields:Record<string,PelDataValue>):PelDataValue=>({tag:'list',items:Object.entries(fields).map(([key,value])=>({tag:'pair',key,value}))});
const put=(value:unknown,context:HostContextV1)=>Effect.flatMap(PelRuntime,runtime=>runtime.artifacts.put(context.binding.runId,Buffer.from(canonicalize(value)),PEL_MAX_ARTIFACT_BYTES,'ordinary'));
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const args=(request:HostRequestV1)=>{const {id,input,destination}=request.boundArguments;return id?.tag==='string'&&destination?.tag==='string'&&input&&isPelDataValue(input)?{id:id.value,input,destination:destination.value}:null;};
function publicationResult(input:PelPublicationResolvedInputV1,receiptRef:PelArtifactRefV1|null):PelDataValue{return assoc({status:str(receiptRef?'published':'needs-action'),candidate:refValue(input.candidateRef),delivery:input.delivery,publication:receiptRef?refValue(receiptRef):{tag:'nil'},'next-action':receiptRef?{tag:'nil'}:str('Register matching publication authority for this exact candidate and destination, then resume this run.'),findings:{tag:'list',items:[]}});}
function validateInput(input:PelPublicationResolvedInputV1,context:HostContextV1){return Effect.gen(function*(){
 if(!decodeCandidateRefV1(input.candidate).ok||!decodeVerificationReceiptV1(input.verification).ok||!decodeReviewReceiptV1(input.review).ok||!isPelDataValue(input.delivery))return yield* Effect.fail(invalid('Publication input does not contain valid host evidence records.'));
 const identity=pelReleaseCandidateIdentity(input.candidate),attempt=context.effect.attempt;
 if(pelHash(input.candidate.repository)!==pelHash(context.workspace.repository)||input.candidate.workspaceGrantId!==context.workspace.grantId||pelHash(input.candidate.producingAttempt)!==pelHash(attempt)||pelHash(input.verification.effect.attempt)!==pelHash(attempt)||pelHash(input.review.effect.attempt)!==pelHash(attempt)||!input.verification.passed||input.review.verdict!=='approved'||input.review.implementer.provider===input.review.reviewer.provider||pelHash(input.verification.candidate)!==pelHash(identity)||pelHash(input.review.candidate)!==pelHash(identity)||pelHash(input.verification.candidateRef)!==pelHash(input.candidateRef)||pelHash(input.review.candidateRef)!==pelHash(input.candidateRef)||pelHash(input.review.verificationRef)!==pelHash(input.verificationRef))return yield* Effect.fail(invalid('Publication requires current passing checks and independent review for the same candidate and attempt.'));
 const runtime=yield* PelRuntime,now=yield* runtime.clock.now;
 if(input.verification.observedAt>input.review.observedAt||input.review.observedAt>now)return yield* Effect.fail(invalid('Publication evidence has invalid observation ordering.'));
 const schema=context.checked.snapshot.registry.dataSchemas['schema:review-result-v1'];if(!schema||!validateDataSchema(input.delivery,schema))return yield* Effect.fail(invalid('The delivery value does not satisfy its exact review schema.'));
 for(const [ref,value] of [[input.candidateRef,input.candidate],[input.verificationRef,input.verification],[input.reviewRef,input.review]] as const)if(pelHash(yield* readPelArtifactJson(context.binding.runId,ref))!==pelHash(value))return yield* Effect.fail(invalid('Publication evidence differs from its immutable artifact.'));
 for(const ref of [input.candidate.manifestRef,input.candidate.diffRef,input.verification.reportRef,input.review.reportRef,...(input.integrationReceiptRef?[input.integrationReceiptRef]:[])])yield* runtime.artifacts.get(context.binding.runId,ref,PEL_MAX_ARTIFACT_BYTES);
 if(context.binding.requiredMilestones.includes('integrated')&&!input.integrationReceiptRef)return yield* Effect.fail(invalid('This contract requires its separately registered integration receipt before publication.'));
});}
const serviceInput=(destinationId:string,input:PelPublicationResolvedInputV1):PelPublicationInputV1=>({destinationId,candidate:pelReleaseCandidateIdentity(input.candidate),evidenceRefs:[input.candidateRef,input.verificationRef,input.reviewRef],integrationReceiptRef:input.integrationReceiptRef});
export function makePelPublishHandler(ports:PelPublicationPorts):PelPreparedHandlerV1 {
 const load=(prepared:PelDispatchPreparationV1,context:HostContextV1)=>Effect.gen(function*(){
  const value=yield* readPelArtifactJson(context.binding.runId,prepared.inputs);
  if(!object(value)||Object.keys(value).sort().join(',')!=='id,input,publication,resolved,schemaVersion'||value.schemaVersion!==1||typeof value.id!=='string'||!isPelDataValue(value.input)||!object(value.resolved)||!object(value.publication)||value.publication.operationDigest!==prepared.operationDigest)return yield* Effect.fail(invalid('The retained publication preparation is invalid.'));
  const stored=value as unknown as StoredPublication;
  yield* validateInput(stored.resolved,context);
  if(pelHash(serviceInput(stored.publication.input.destinationId,stored.resolved))!==pelHash(stored.publication.input)||pelHash(prepared.candidate)!==pelHash(stored.publication.input.candidate))return yield* Effect.fail(invalid('The publication preparation does not bind its original candidate evidence.'));
  return stored;
 });
 const savedObservation=(operationDigest:string,context:HostContextV1)=>Effect.gen(function*(){const replay=replayPelRun(yield* readPelRecords(context.binding.runId));if(!replay.ok)return yield* Effect.fail(replay.error);for(const row of [...replay.value.records].reverse())if(row.type==='pel.effect.observed.v1'&&row.data.effectId===context.effect.effectId&&row.data.externalOutcome==='confirmed-complete'){
  const value=yield* readPelArtifactJson(context.binding.runId,row.data.observationRef);if(!object(value)||value.stage!=='publication-observed')continue;
  if(Object.keys(value).sort().join(',')!=='observation,observedAt,operationDigest,stage'||value.operationDigest!==operationDigest||!Number.isSafeInteger(value.observedAt)||!object(value.observation)||value.observation.kind!=='published'||value.observation.operationDigest!==operationDigest)return yield* Effect.fail(invalid('The retained publication observation is invalid.'));
  return {report:value as unknown as ObservedPublication,reportRef:row.data.observationRef};
 }return null;});
 const observeAndRecord=(observation:PelPublicationObservationV1,context:HostContextV1)=>Effect.gen(function*(){const runtime=yield* PelRuntime,report:ObservedPublication={stage:'publication-observed',operationDigest:observation.operationDigest,observation,observedAt:yield* runtime.clock.now},reportRef=yield* put(report,context);yield* appendPelRecord(context.binding,'pel.effect.observed.v1',{effectId:context.effect.effectId,observationRef:reportRef,providerIdentity:null,externalOutcome:observation.kind==='published'?'confirmed-complete':'unknown'});return {report,reportRef};});
 const finish=(stored:StoredPublication,token:PelReservationTokenV1,observed:{report:ObservedPublication;reportRef:PelArtifactRefV1},context:HostContextV1)=>Effect.gen(function*(){
  const observation=observed.report.observation;
  if(observation.kind==='unknown')return {kind:'waiting' as const,pendingRequestId:context.effect.requestId,reason:'unknown-external-outcome' as const,observationRef:observed.reportRef};
  if(observation.observedObject!==stored.resolved.candidate.commit||observation.destinationDigest!==pelHash(stored.publication.destination)||observation.operationDigest!==stored.publication.operationDigest)return yield* Effect.fail(invalid('The observed publication does not bind the admitted destination and candidate.'));
  const receipt:PublicationReceiptV1={schemaVersion:1,kind:'publication',effect:context.effect,candidateRef:stored.resolved.candidateRef,candidate:pelReleaseCandidateIdentity(stored.resolved.candidate),verificationRef:stored.resolved.verificationRef,reviewRef:stored.resolved.reviewRef,authorityRef:stored.publication.authorityRef,destinationId:stored.publication.input.destinationId,destinationDigest:observation.destinationDigest,operationDigest:observation.operationDigest,observedObject:observation.observedObject,reportRef:observed.reportRef,reservation:token,observedAt:observed.report.observedAt};
  if(!decodePublicationReceiptV1(receipt).ok)return yield* Effect.fail(invalid('The confirmed publication receipt is invalid.'));
  const ref=yield* put(receipt,context);yield* ports.recordPublication(receipt,ref,context);
  const replay=replayPelRun(yield* readPelRecords(context.binding.runId));if(!replay.ok)return yield* Effect.fail(replay.error);let recorded=false;for(const row of replay.value.records)if(row.type==='pel.effect.observed.v1'&&row.data.effectId===context.effect.effectId){const value=yield* readPelArtifactJson(context.binding.runId,row.data.observationRef);if(object(value)&&value.stage==='host-evidence'&&value.kind==='publication'){if(pelHash(value.ref)!==pelHash(ref))return yield* Effect.fail(invalid('A different publication receipt is already recorded.'));recorded=true;}}
  if(!recorded){const observationRef=yield* put({stage:'host-evidence',kind:'publication',ref},context);yield* appendPelRecord(context.binding,'pel.effect.observed.v1',{effectId:context.effect.effectId,observationRef,providerIdentity:null,externalOutcome:'confirmed-complete'});}
  return {kind:'settled' as const,outcome:{tag:'success' as const,value:publicationResult(stored.resolved,ref)}};
 });
 return {
  prepare:(request,context)=>Effect.gen(function*(){
   const decoded=args(request);if(!decoded)return yield* Effect.fail(invalid('Invalid publication arguments.'));
   const resolved=yield* ports.resolveInput(decoded.input,context);yield* validateInput(resolved,context);
   const prepared=yield* ports.service.prepare(serviceInput(decoded.destination,resolved),context);
   if(prepared.kind==='needs-action'){const observationRef=yield* put({stage:'publication-authority-required',input:prepared.input,destination:prepared.destination,authorityRef:prepared.authorityRef,...(prepared.requiredAuthoritySha256?{requiredAuthoritySha256:prepared.requiredAuthoritySha256}:{})},context);return {kind:'needs-action' as const,reason:'reconciliation-required' as const,diagnostic:{code:'publication-authority-required',message:'Publication requires matching registered host authority.',sourceSpan:null,effectId:context.effect.effectId,retryable:false,nextAction:'Register the exact candidate and destination authority, then resume this run.',evidenceRefs:[observationRef]},observationRef,preview:publicationResult(resolved,null)};}
   const descriptor=getHostDescriptor(context.checked.snapshot.registry,request.registryId);if(!descriptor)return yield* Effect.fail(invalid('The publication descriptor is unavailable.'));
   const runtime=yield* PelRuntime,inputs=yield* put({schemaVersion:1,id:decoded.id,input:decoded.input,resolved,publication:prepared.preparation},context);
   return {kind:'dispatch' as const,action:'publish' as const,operationDigest:prepared.preparation.operationDigest,candidate:prepared.preparation.input.candidate,inputs,resources:yield* runtime.resources.resolve(descriptor,request,context),...(context.binding.authority.kind==='v2-child'?{actionAuthority:{taskPlanSha256:prepared.preparation.registration.taskPlanSha256,authorityBundleSha256:prepared.preparation.registration.bundleSha256}}:{})};
  }),
  dispatch:(prepared,token,context)=>Effect.gen(function*(){
   const valid=validateReservationToken(prepared,token,context);if(!valid.ok)return yield* Effect.fail(valid.error);
   const stored=yield* load(prepared,context),current=yield* ports.resolveInput(stored.input,context);yield* validateInput(current,context);if(pelHash(current)!==pelHash(stored.resolved))return yield* Effect.fail(invalid('Current publication evidence changed after preparation.'));
   const observed=yield* observeAndRecord(yield* ports.service.commit(stored.publication,prepared,token,context),context);return yield* finish(stored,token,observed,context);
  }),
  recover:(prepared,token,context)=>Effect.gen(function*(){
   const valid=validateReservationToken(prepared,token,context);if(!valid.ok)return yield* Effect.fail(valid.error);const stored=yield* load(prepared,context);
   const observed=(yield* savedObservation(prepared.operationDigest,context))??(yield* observeAndRecord(yield* ports.service.observe(stored.publication,context),context));return yield* finish(stored,token,observed,context);
  }),
 };
}

/** Register the canonical existing release outcome and milestone; never reserve another action. */
export function makePelPublicationRecorder(ledger:EndstopLedger['Type']):PelPublicationPorts['recordPublication'] {
 return (receipt,ref,context)=>recordPelReleaseMilestone(ledger,receipt,ref,'published',context,receipt.authorityRef);
}
