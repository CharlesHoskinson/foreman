/** The one external-effect reservation and dispatch boundary. */
import { isAbsolute, sep } from 'node:path';
import { Effect } from 'effect';
import { canonicalAuthoringJson, encodeHostArgumentsV1, getHostDescriptor, isPelDataValue, resolveModelSelection, validateDataSchema, validateHostReceipt, type HostRequestV1, type HostReceiptV1, type PelValue, type Result, type HostFunctionDescriptorV1 } from '@foreman/pel';
import { executeNativePrint } from './pel-native-host.js';
import { EndstopLedger } from './execution-ledger.js';
import { executionActionKinds } from './execution-terminal-policy.js';
import { PelRuntime, decodePelActionAuthorityV1, type HostContextV1, type PelHostEffectFailureV1, type ResourceSetV1, type PreparedHostEffectV1, type PelReservationTokenV1, type RunFailure, type HostDispatchOutcomeV1 } from './pel-run-contract.js';
import { appendPelRecord, appendPelEffectResult, pelHash, pelFailure, readPelRecords, replayPelRun, stablePelReservationId } from './pel-journal.js';

const denied = (message: string): PelHostEffectFailureV1 => ({code:'capability-denied',message});
const text = (value: PelValue | undefined): string | undefined => value?.tag === 'string' ? value.value : undefined;
const inside = (root:string,path:string) => path === root || path.startsWith(root + sep);
/** Validate concrete M1 arguments against both the precise M2 call and its finite policy. */
export function validateResolvedHostRequest(request:HostRequestV1, context:HostContextV1, resources?:ResourceSetV1):Result<HostFunctionDescriptorV1,PelHostEffectFailureV1> {
 const fail = (message:string):Result<never,PelHostEffectFailureV1> => ({ok:false,error:denied(message)});
 const {checked,binding} = context, snapshot=checked.snapshot, policy=snapshot.policy;
 if(request.sourceDigest!==checked.sourceDigest || binding.sourceDigest!==checked.sourceDigest || binding.checkedProgramDigest!==checked.bindingDigest || binding.registryDigest!==snapshot.registryDigest || snapshot.registry.digest!==binding.registryDigest || context.effect.requestId!==request.requestId) return fail('The resolved request does not match its admitted source and registry.');
 const descriptor=getHostDescriptor(snapshot.registry,request.registryId);
 if(!descriptor || descriptor.resultSchemaId!==request.expectedResultSchemaId) return fail('The resolved host descriptor or result schema changed.');
 const previews=checked.analysis.effects.filter(e=>e.nodeId===request.nodeId && e.registryId===request.registryId);
 const regions=checked.analysis.dynamicRegions.filter(r=>r.possibleRegistryIds.includes(request.registryId) && previews.some(e=>e.regionId===r.regionId || r.spans.some(s=>s.start<=e.span.start && s.end>=e.span.end)));
 if(previews.length===0) return fail('The host call is outside every admitted call-site envelope.');
 const matching=previews.find(e=>Object.entries(e.arguments).every(([key,summary])=> summary.kind!=='known' || canonicalAuthoringJson(summary.value)===canonicalAuthoringJson(request.boundArguments[key])));
 if(!matching) return fail('Resolved arguments differ from the admitted call site.');
 if(!policy.allowedEffectKinds.includes(descriptor.effectKind) || descriptor.capabilities.some(c=>!policy.allowedCapabilities.includes(c))) return fail('The host capability is not admitted.');
 const argSpec=descriptor.argSpec;
 if(argSpec.kind==='fixed' && (Object.keys(request.boundArguments).some(k=>!argSpec.parameters.some(p=>p.name===k)) || argSpec.parameters.some(p=>p.required && !Object.hasOwn(request.boundArguments,p.name)))) return fail('Host arguments do not match the descriptor.');
 if(!['fm/retry','fm/race'].includes(request.registryId) && Object.values(request.boundArguments).some(v=>!isPelDataValue(v))) return fail('External host arguments must be ordinary Pel data.');
 for(const [name,allowed] of [['output',policy.allowedSchemaIds],['policy',policy.allowedReviewPolicies],['gate',policy.allowedGates],['destination',policy.allowedDestinations]] as const) {
   if(request.boundArguments[name] && (!text(request.boundArguments[name]) || !allowed.includes(text(request.boundArguments[name])!))) return fail('A resolved operation selector is outside its finite admitted set.');
 }
 const model=text(request.boundArguments.model);
 if(request.boundArguments.model) {
   if(!model) return fail('Model selection must be a registered exact profile.');
   const selected=resolveModelSelection(snapshot,model,text(request.boundArguments.transport));
   if(!selected.ok) return fail('Model selection is not admitted.');
   if(matching?.model && canonicalAuthoringJson(matching.model)!==canonicalAuthoringJson(selected.value)) return fail('The resolved profile, controls or credential differ from admission.');
   if(regions.length>0 && !regions.some(r=>r.models.some(m=>m.profileId===selected.value.profileId && m.transportId===selected.value.transportId))) return fail('Model selection escaped its dynamic region.');
 }
 if(request.registryId==='pel/nl-condition') {
   if(binding.authority.kind!=='v2-child' || !snapshot.nlConditionProfile || canonicalAuthoringJson(request.selection)!==canonicalAuthoringJson(snapshot.nlConditionProfile) || request.selectionDigest!==snapshot.nlConditionProfileDigest) return fail('Natural-language predicates require the exact registered V2 evaluation child and selection.');
 }
 for(const name of ['input','bundle']) {
   const value=text(request.boundArguments[name]);
   if(!value) continue;
   if(value.includes('\0') || value.startsWith('/') || value.split(/[\\/]/u).includes('..')) return fail('Resolved input escapes its resource envelope.');
   if(/^(artifact:|workspace:|source:)/u.test(value) && !policy.resourceEnvelope.reads.includes(value)) return fail('Resolved input resource is not admitted.');
   if(value.startsWith('artifact:') && !policy.artifactConstraints.allowedIds.includes(value)) return fail('Resolved artifact is not admitted.');
 }
 if(resources) {
   for(const [names,allowed] of [[resources.reads,policy.resourceEnvelope.reads],[resources.writes,policy.resourceEnvelope.writes]] as const) for(const name of names) {
     if(isAbsolute(name)) { if(!inside(context.workspace.canonicalRoot,name) || !allowed.some(p=>p==='workspace:default' || p===`source:${name.slice(context.workspace.canonicalRoot.length+1)}`)) return fail('Canonical resources escaped the admitted workspace.'); }
     else if(!allowed.includes(name)) return fail('Resolved resources escaped the admitted finite envelope.');
   }
   if(resources.unknownScope && (resources.unknownScope!==context.workspace.canonicalRoot || policy.resourceEnvelope.reads.length+policy.resourceEnvelope.writes.length===0)) return fail('Unknown resources require one admitted exclusive workspace scope.');
 }
 return {ok:true,value:descriptor};
}
export function validateReservationToken(prepared:Extract<PreparedHostEffectV1,{kind:'dispatch'}>,token:PelReservationTokenV1,context:HostContextV1):Result<PelReservationTokenV1,PelHostEffectFailureV1> {
 if(prepared.actionAuthority && !decodePelActionAuthorityV1(prepared.actionAuthority).ok) return {ok:false,error:denied('Prepared action authority is invalid.')};
 const preparationDigest=pelHash(prepared), action=context.retryContext && context.retryContext.attemptIndex>1 && context.effect.priorEffectId ? 'provider_retry' : prepared.action;
 if(prepared.actionAuthority?.retry && action!=='provider_retry') return {ok:false,error:denied('Retry authority requires a provider retry operation.')};
 if(token.schemaVersion!==1 || token.preparationDigest!==preparationDigest || token.operationDigest!==prepared.operationDigest || token.authoritySha256!==context.binding.authoritySha256 || canonicalAuthoringJson(token.effect)!==canonicalAuthoringJson(context.effect) || canonicalAuthoringJson(token.candidate)!==canonicalAuthoringJson(prepared.candidate) || token.reservationId!==stablePelReservationId(context.effect.effectId,action,preparationDigest) || token.kind!==context.binding.authority.kind) return {ok:false,error:denied('Dispatch token does not bind this prepared operation.')};
 if(token.kind==='v1' && (token.action!==action || token.contractId!==context.binding.contractId || token.contractSha256!==context.binding.contractSha256)) return {ok:false,error:denied('Dispatch token does not bind this execution contract.')};
 if(token.kind==='v2-child') {
   const authority=context.binding.authority,actionAuthority=prepared.actionAuthority??(authority.kind==='v2-child'?authority:null);
   if(authority.kind!=='v2-child' || token.childId!==authority.childId || token.rootContractId!==authority.rootContractId || token.rootContractSha256!==authority.rootContractSha256 || token.familySha256!==authority.familySha256 || token.operation.reservationId!==token.reservationId || token.operation.reservationAction!==action || token.operation.effectiveAction!==prepared.action || token.operation.originReservationId!==((action==='provider_retry'||action==='resume')?(prepared.actionAuthority?.retry?.originReservationId??authority.originReservationId):token.reservationId) || token.operation.taskPlanSha256!==actionAuthority?.taskPlanSha256 || token.operation.authorityBundleSha256!==actionAuthority?.authorityBundleSha256 || canonicalAuthoringJson(token.operation.candidate)!==canonicalAuthoringJson(prepared.candidate)) return {ok:false,error:denied('Dispatch token does not bind this registered child authority.')};
 }
 return {ok:true,value:token};
}
export const prepareHostEffect = (request:HostRequestV1,context:HostContextV1) => Effect.gen(function*(){
 const runtime=yield* PelRuntime, handler=runtime.handlers.get(request.registryId);
 if(!handler) return yield* Effect.fail(pelFailure('binding-mismatch','A reachable host handler is unavailable.'));
 return yield* handler.prepare(request,context);
});
export function executeHostEffect(request:HostRequestV1,context:HostContextV1) {
 return Effect.scoped(Effect.gen(function*(){
   const runtime=yield* PelRuntime;
   const valid=validateResolvedHostRequest(request,context);
   if(!valid.ok) return yield* Effect.fail(pelFailure('binding-mismatch',valid.error.message));
   const events=yield* readPelRecords(context.binding.runId), replay=replayPelRun(events);
   if(!replay.ok) return yield* Effect.fail(replay.error);
   const previous=replay.value.results.get(context.effect.effectId);
   if(previous) {
     const bytes=yield* runtime.artifacts.get(context.binding.runId,previous.receiptRef,64*1024*1024);
     const receipt=JSON.parse(Buffer.from(bytes).toString('utf8')) as HostReceiptV1;
     const checked=validateHostReceipt(context.checked.snapshot.registry,request,receipt);
     if(!checked.ok) return yield* Effect.fail(pelFailure('journal-corrupt','Stored host receipt does not validate.'));
     return {kind:'settled',receipt:checked.value,receiptRef:{effectId:context.effect.effectId,sequence:previous.sequence,sha256:previous.resultHash}} as const;
   }
   if(runtime.workspaceForHostRequest) context={...context,workspace:yield* runtime.workspaceForHostRequest(request,context)};
   let redispatchDecisionSequence:number|null=null;
   const existingIntent=replay.value.intents.get(context.effect.effectId);
   if(existingIntent) {
     let confirmed=false;
     for(const record of replay.value.records) if(record.type==='pel.recovery-decision.v1') {
       const bytes=yield* runtime.artifacts.get(context.binding.runId,record.data.decisionRef,1048576);
       const decision=JSON.parse(Buffer.from(bytes).toString('utf8')) as import('./pel-run-contract.js').PelRecoveryDecisionV1;
       if(decision.effectId===context.effect.effectId && decision.runId===context.binding.runId && decision.checkedDigest===context.binding.checkedProgramDigest) {
         if(decision.decision==='confirm-no-dispatch'&&replay.value.records.some(later=>later.type==='pel.effect.observed.v1'&&later.data.effectId===decision.effectId&&later.sequence>record.sequence))continue;
         yield* runtime.validateDecisionAuthority(decision.authorityReceipt,context.binding,'recovery',decision);confirmed=decision.decision==='confirm-no-dispatch'; redispatchDecisionSequence=record.sequence;
       }
     }
     const latestObservation=replay.value.records.filter(record=>record.type==='pel.effect.observed.v1' && record.data.effectId===context.effect.effectId).at(-1);
     if(latestObservation && latestObservation.sequence>(redispatchDecisionSequence??0)) confirmed=false;
     if(latestObservation?.type==='pel.effect.observed.v1' && latestObservation.data.externalOutcome==='none' && latestObservation.data.providerIdentity===null) {
       const bytes=yield* runtime.artifacts.get(context.binding.runId,latestObservation.data.observationRef,1048576);
       const observed=JSON.parse(Buffer.from(bytes).toString('utf8')) as {stage?:string;confirmedNoDispatch?:boolean};
       if(observed.stage==='provider-resolution' && observed.confirmedNoDispatch===true) {confirmed=true;redispatchDecisionSequence=latestObservation.sequence;}
     }
     if(!confirmed) return yield* Effect.fail(pelFailure('binding-mismatch','A dispatched effect requires reconciliation before continuation.'));
   }
   const settle = (outcome:HostReceiptV1['outcome']) => Effect.gen(function*(){
     const receipt={requestId:request.requestId,outcome};
     const validated=validateHostReceipt(context.checked.snapshot.registry,request,receipt);
     if(!validated.ok) return yield* Effect.fail(pelFailure('binding-mismatch','The host supplied an invalid result or failure envelope.'));
     const receiptRef=yield* appendPelEffectResult(context.binding,context.effect,validated.value);
     return {kind:'settled',receipt:validated.value,receiptRef} as const;
   });
   const resolution=yield* runtime.resources.resolve(valid.value,request,context).pipe(Effect.either);
   if(resolution._tag==='Left')return yield* settle({tag:'failure',failure:{code:'resource-denied',message:resolution.left.message,cause:{effectId:context.effect.effectId,nodeId:request.nodeId}}});
   const resources=resolution.right;
   const resolved=validateResolvedHostRequest(request,context,resources);
   if(!resolved.ok)return yield* settle({tag:'failure',failure:{code:'resource-denied',message:resolved.error.message,cause:{effectId:context.effect.effectId,nodeId:request.nodeId}}});
   const acquired=yield* runtime.resources.acquire(resources,context).pipe(Effect.either);
   if(acquired._tag==='Left')return yield* settle({tag:'failure',failure:{code:'resource-denied',message:acquired.left.message,cause:{effectId:context.effect.effectId,nodeId:request.nodeId}}});
   if(request.registryId==='print') return yield* executeNativePrint(request,context);
   const preparation=yield* prepareHostEffect(request,context).pipe(Effect.either);
   if(preparation._tag==='Left') {
     if('_tag' in preparation.left) return yield* Effect.fail(preparation.left);
     return yield* settle({tag:'failure',failure:preparation.left});
   }
   const prepared=preparation.right;
   if(prepared.kind==='reuse') {
     const original=replay.value.results.get(prepared.originalReceipt.effectId);
     if(!original || original.sequence!==prepared.originalReceipt.sequence || original.resultHash!==prepared.originalReceipt.sha256) return yield* Effect.fail(pelFailure('binding-mismatch','Reuse does not reference an original durable receipt.'));
     yield* runtime.artifacts.get(context.binding.runId,original.receiptRef,64*1024*1024);
     return yield* settle({tag:'success',value:prepared.value});
   }
   if(prepared.kind==='read-result') {
     for(const source of prepared.sources) yield* runtime.artifacts.get(context.binding.runId,source,64*1024*1024);
     return yield* settle({tag:'success',value:prepared.value});
   }
   if(prepared.kind==='needs-action') {
     yield* appendPelRecord(context.binding,'pel.effect.observed.v1',{effectId:context.effect.effectId,observationRef:prepared.observationRef,providerIdentity:null,externalOutcome:'none'});
     return {kind:'waiting',pendingRequestId:request.requestId,reason:'reconciliation-required',observationRef:prepared.observationRef,...(prepared.preview?{preview:prepared.preview}:{})} as const;
   }
   const expectedAction=request.registryId==='fm/task'?context.project.taskActions[text(request.boundArguments.id)??'']
     : request.registryId==='fm/verify'?'verify'
     : request.registryId==='fm/review'?'audit'
     : request.registryId==='fm/publish'?context.project.destinations[text(request.boundArguments.destination)??'']?.operation
     : request.registryId==='pel/nl-condition'?'evaluate':undefined;
   if(!expectedAction || prepared.action!==expectedAction) return yield* Effect.fail(pelFailure('binding-mismatch','Prepared action does not match the admitted operation action map.'));
   if(canonicalAuthoringJson(prepared.resources)!==canonicalAuthoringJson(resources)) return yield* Effect.fail(pelFailure('binding-mismatch','Preparation changed the resolved resource lock set.'));
   const preparationDigest=pelHash(prepared), authority=context.binding.authority;
   const action:import('./pel-run-contract.js').PelLedgerActionV1=context.retryContext && context.retryContext.attemptIndex>1 && context.effect.priorEffectId ? 'provider_retry' : prepared.action;
   const reservationId=stablePelReservationId(context.effect.effectId,action,preparationDigest);
   const common={schemaVersion:1 as const,effect:context.effect,preparationDigest,operationDigest:prepared.operationDigest,authoritySha256:context.binding.authoritySha256,reservationId,candidate:prepared.candidate};
   const ledger=yield* EndstopLedger, now=yield* runtime.clock.now;
   const prior=action==='provider_retry' && context.effect.priorEffectId?replay.value.intents.get(context.effect.priorEffectId)?.reservation:null;
   const retryOrigin=prepared.actionAuthority?.retry?.originReservationId??(authority.kind==='v2-child'?authority.originReservationId:null);
   if(prepared.actionAuthority && !decodePelActionAuthorityV1(prepared.actionAuthority).ok)return yield* Effect.fail(pelFailure('binding-mismatch','Prepared action authority is invalid.'));
   if(prepared.actionAuthority?.retry && (action!=='provider_retry'||!prior||prior.kind!=='v2-child'||prior.reservationId!==prepared.actionAuthority.retry.priorReservationId||prior.operation.originReservationId!==retryOrigin))return yield* Effect.fail(pelFailure('binding-mismatch','Prepared retry authority does not bind the prior durable reservation.'));
   if(prepared.actionAuthority){
     if(authority.kind!=='v2-child'||!prepared.candidate||!/^[a-f0-9]{64}$/u.test(prepared.actionAuthority.taskPlanSha256)||!/^[a-f0-9]{64}$/u.test(prepared.actionAuthority.authorityBundleSha256))return yield* Effect.fail(pelFailure('binding-mismatch','Action-specific authority requires a registered child candidate.'));
     const family=yield* ledger.familyStatus(authority).pipe(Effect.mapError(()=>pelFailure('binding-mismatch','The original child authority is unavailable.')));
     const matches=family.childAuthorities.filter(row=>row.rootContractId===authority.rootContractId&&row.rootContractSha256===authority.rootContractSha256&&row.familySha256===authority.familySha256&&row.childId===authority.childId&&row.action===action&&row.effectiveAction===prepared.action&&row.taskPlanSha256===prepared.actionAuthority!.taskPlanSha256&&row.bundleSha256===prepared.actionAuthority!.authorityBundleSha256&&canonicalAuthoringJson(row.candidate)===canonicalAuthoringJson(prepared.candidate)&&(action==='provider_retry'?row.originReservationId===retryOrigin&&row.priorReservationId===prior?.reservationId:row.priorReservationId===null&&row.originReservationId===null));
     if(matches.length!==1)return yield* Effect.fail(pelFailure('binding-mismatch','The requested action bundle is not registered for this exact child and candidate.'));
   }
   if(now>=context.binding.limits.deadline) return yield* Effect.fail(pelFailure('budget-exhausted','The admitted execution deadline has expired.'));
   let token:PelReservationTokenV1;
   if(existingIntent?.reservation) {
     token=existingIntent.reservation;
     const reused=validateReservationToken(prepared,token,context);
     if(!reused.ok) return yield* Effect.fail(pelFailure('binding-mismatch','Recovery preparation changed its original reservation.'));
   } else if(authority.kind==='v1') {
     if(!executionActionKinds.includes(action as typeof executionActionKinds[number])) return yield* Effect.fail(pelFailure('binding-mismatch','This action requires registered V2 child authority.'));
     const v1action=action as typeof executionActionKinds[number];
     const reserved=yield* ledger.execute(context.binding.contractId,context.binding.contractSha256,{_tag:'ReserveAction',action:v1action,candidateSha256:prepared.candidate?.candidateSha256 ?? prepared.operationDigest,commandSha256:prepared.operationDigest,reservationId,at:new Date(now).toISOString().replace(/\.\d{3}Z$/,'Z')}).pipe(Effect.mapError(()=>pelFailure('budget-exhausted','Existing ledger refused the reservation.')));
     if(reserved.decision._tag!=='Accepted' && reserved.decision._tag!=='ReusedVerification') return yield* Effect.fail(pelFailure('budget-exhausted','Existing execution contract denied the action.'));
     token={...common,kind:'v1',contractId:context.binding.contractId,contractSha256:context.binding.contractSha256,action:v1action};
   } else {
     if(!prepared.candidate) return yield* Effect.fail(pelFailure('binding-mismatch','Registered child dispatch requires its authority-bound candidate.'));
     if(action==='provider_retry') {
       if(!prior||prior.kind!=='v2-child'||prior.operation.originReservationId!==retryOrigin||prior.childId!==authority.childId||prior.rootContractId!==authority.rootContractId||prior.rootContractSha256!==authority.rootContractSha256||prior.familySha256!==authority.familySha256||prior.operation.effectiveAction!==prepared.action||canonicalAuthoringJson(prior.operation.candidate)!==canonicalAuthoringJson(prepared.candidate))return yield* Effect.fail(pelFailure('binding-mismatch','A child retry or resume must retain its prior durable reservation origin.'));
     }
     const actionAuthority=prepared.actionAuthority??authority;
     const operation={_tag:'ReserveAction' as const,reservationId,reservationAction:action,effectiveAction:prepared.action,originReservationId:(action==='provider_retry')?retryOrigin!:reservationId,candidate:prepared.candidate,taskPlanSha256:actionAuthority.taskPlanSha256,authorityBundleSha256:actionAuthority.authorityBundleSha256};
     const reserved=yield* ledger.executeChild({rootContractId:authority.rootContractId,rootContractSha256:authority.rootContractSha256,familySha256:authority.familySha256,childId:authority.childId,operation,at:new Date(now).toISOString().replace(/\.\d{3}Z$/,'Z')}).pipe(Effect.mapError(()=>pelFailure('budget-exhausted','Existing child ledger refused the reservation.')));
     if(reserved.decision._tag!=='Accepted' && reserved.decision._tag!=='ReusedVerification') return yield* Effect.fail(pelFailure('budget-exhausted','Existing child authority denied the action.'));
     token={...common,kind:'v2-child',rootContractId:authority.rootContractId,rootContractSha256:authority.rootContractSha256,familySha256:authority.familySha256,childId:authority.childId,operation};
   }
   const {retainPelHostPreparation}=yield* Effect.promise(()=>import('./pel-host-recovery.js'));
   yield* retainPelHostPreparation(prepared,request,context);
   const encodedArgs=encodeHostArgumentsV1(request.boundArguments,{sourceDigest:context.checked.sourceDigest,registryDigest:context.binding.registryDigest,optionsDigest:context.binding.optionsDigest,records:{}});
   if(!encodedArgs.ok) return yield* Effect.fail(pelFailure('binding-mismatch','Host arguments could not be encoded.'));
   const args=encodedArgs.value;
   const argumentsRef=yield* runtime.artifacts.put(context.binding.runId,Buffer.from(canonicalAuthoringJson(args)),64*1024*1024,'ordinary');
   yield* appendPelRecord(context.binding,'pel.effect.intent.v1',{effect:context.effect,argumentsRef,expectedResultSchemaId:request.expectedResultSchemaId,preparationDigest,reservation:token,usageReservation:prepared.usageReservation??null});
   const tokenCheck=validateReservationToken(prepared,token,context);
   if(!tokenCheck.ok) return yield* Effect.fail(pelFailure('binding-mismatch',tokenCheck.error.message));
   const concurrency=yield* runtime.resources.acquireConcurrency(context).pipe(Effect.either);
   if(concurrency._tag==='Left')return yield* settle({tag:'failure',failure:{code:'resource-denied',message:concurrency.left.message,cause:{effectId:context.effect.effectId,nodeId:request.nodeId}}});
   if(redispatchDecisionSequence!==null) {
     const observationRef=yield* runtime.artifacts.put(context.binding.runId,Buffer.from(canonicalAuthoringJson({redispatchDecisionSequence})),1024,'ordinary');
     yield* appendPelRecord(context.binding,'pel.effect.observed.v1',{effectId:context.effect.effectId,observationRef,providerIdentity:null,externalOutcome:'unknown'});
   }
   const handler=runtime.handlers.get(request.registryId)!;
   const dispatched=yield* handler.dispatch(prepared,token,context).pipe(Effect.either);
   if(dispatched._tag==='Left') {
     if('_tag' in dispatched.left) return yield* Effect.fail(dispatched.left);
     return yield* settle({tag:'failure',failure:dispatched.left});
   }
   if(dispatched.right.kind==='waiting') return dispatched.right;
   return yield* settle(dispatched.right.outcome);
 }));
}
