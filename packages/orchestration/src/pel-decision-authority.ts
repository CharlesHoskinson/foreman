/** Trusted lifecycle entry point for operator decisions. Never expose registration to a provider. */
import {Effect,type Scope} from 'effect';
import {RunJournal} from '@foreman/event-log';
import {canonicalize} from '@foreman/core';
import {decodePelContinuation,validateHostReceipt,validateDataSchema,isPelDataValue,type HostReceiptV1} from '@foreman/pel';
import {EndstopLedger} from './execution-ledger.js';
import {executionContractSha256} from './execution-contract.js';
import {PelRuntime,decodePelRecoveryDecisionV1,decodePelRevisionDecisionV1,type ExecutionBindingV1,type PelOwnedRunContextV1,type PelReceiptRefV1,type PelRecoveryDecisionV1,type PelRevisionDecisionV1,type RunFailure,type RunServices} from './pel-run-contract.js';
import {appendPelRecord,pelFailure,pelHash,readPelRecords,replayPelRun,PEL_MAX_ARTIFACT_BYTES,type PelReplayV1} from './pel-journal.js';
import {loadPelRecovery,preparePelRunRevision,readPelArtifactJson,readPelRunResult,type PelRecoveredRunV1} from './pel-recovery.js';

type Kind='recovery'|'revision';
type Decision=PelRecoveryDecisionV1|PelRevisionDecisionV1;
type Unsigned=Omit<PelRecoveryDecisionV1,'authorityReceipt'>|Omit<PelRevisionDecisionV1,'authorityReceipt'>;
interface AuthorityBlob {readonly schemaVersion:1;readonly kind:Kind;readonly runId:string;readonly contractId:string;readonly contractSha256:string;readonly authoritySha256:string;readonly checkedDigest:string;readonly decision:Unsigned;}
const same=(a:unknown,b:unknown)=>pelHash(a)===pelHash(b);
const placeholder:PelReceiptRefV1={effectId:'operator-decision-pending',sequence:1,sha256:'0'.repeat(64)};
const fail=(message:string)=>pelFailure('binding-mismatch',message);
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)&&Reflect.ownKeys(value).every(key=>typeof key==='string'&&'value' in Object.getOwnPropertyDescriptor(value,key)!);
function unsigned(decision:Decision):Unsigned{const {authorityReceipt:_receipt,...value}=decision;return value;}
function decode(kind:Kind,value:unknown):Decision|null{const parsed=kind==='recovery'?decodePelRecoveryDecisionV1(value):decodePelRevisionDecisionV1(value);return parsed.ok?parsed.value:null;}
function decodeBlob(value:unknown):AuthorityBlob|null {
 if(!record(value)||Object.keys(value).sort().join(',')!==['schemaVersion','kind','runId','contractId','contractSha256','authoritySha256','checkedDigest','decision'].sort().join(',')||value.schemaVersion!==1||(value.kind!=='recovery'&&value.kind!=='revision')||!record(value.decision)||Object.hasOwn(value.decision,'authorityReceipt'))return null;
 const decision=decode(value.kind,{...value.decision,authorityReceipt:placeholder});
 if(!decision||decision.runId!==value.runId||typeof value.contractId!=='string'||value.contractId.length===0||![value.contractSha256,value.authoritySha256,value.checkedDigest].every(d=>typeof d==='string'&&/^[a-f0-9]{64}$/u.test(d)))return null;
 return value as unknown as AuthorityBlob;
}
function matches(blob:AuthorityBlob,binding:ExecutionBindingV1,kind:Kind,decision:Decision):boolean {
 return blob.kind===kind&&blob.runId===binding.runId&&blob.contractId===binding.contractId&&blob.contractSha256===binding.contractSha256&&blob.authoritySha256===binding.authoritySha256&&blob.checkedDigest===binding.checkedProgramDigest&&same(blob.decision,unsigned(decision));
}
function consumedRecoveryAuthority(binding:ExecutionBindingV1,replay:PelReplayV1,sequence:number,decision:Unsigned):Effect.Effect<boolean,RunFailure,PelRuntime>{return Effect.gen(function*(){
 if(!('effectId' in decision)||decision.decision!=='confirm-no-dispatch')return false;
 for(const row of replay.records)if(row.type==='pel.recovery-decision.v1'&&row.sequence>sequence){
  const applied=decodePelRecoveryDecisionV1(yield* readPelArtifactJson(binding.runId,row.data.decisionRef));
  if(!applied.ok)return yield* Effect.fail(pelFailure('journal-corrupt','A recorded recovery decision is invalid.'));
  if(applied.value.authorityReceipt.sequence===sequence&&applied.value.effectId===decision.effectId&&replay.records.some(next=>next.type==='pel.effect.observed.v1'&&next.data.effectId===decision.effectId&&next.sequence>row.sequence))return true;
 }
 return false;
});}
/** A model receipt or a receipt for different decision bytes confers no authority. */
export function validatePelRegisteredDecisionAuthority(receipt:PelReceiptRefV1,binding:ExecutionBindingV1,kind:Kind,decision:Decision):Effect.Effect<void,RunFailure,RunJournal|PelRuntime>{return Effect.gen(function*(){
 const decoded=decode(kind,decision);if(!decoded||!same(decoded.authorityReceipt,receipt)||decoded.runId!==binding.runId)return yield* Effect.fail(fail('The authority receipt does not bind this complete decision.'));
 const replay=replayPelRun(yield* readPelRecords(binding.runId));if(!replay.ok)return yield* Effect.fail(replay.error);
 const found=replay.value.records.find(row=>row.sequence===receipt.sequence);
 if(!found||found.type!=='pel.operator-decision.v1'||found.data.kind!==kind||found.binding.checkedDigest!==binding.checkedProgramDigest||found.binding.authoritySha256!==binding.authoritySha256||found.binding.runtimeVersion!==binding.runtimeVersion||found.binding.languageProfileId!==binding.languageProfileId||found.binding.languageProfileDigest!==binding.languageProfileDigest||!same(found.binding.attempt,binding.attempt)||receipt.effectId!==`operator-decision-${found.data.decisionRef.sha256}`||receipt.sha256!==found.data.decisionRef.sha256)return yield* Effect.fail(fail('The receipt does not reference registered operator authority in this run.'));
 const blob=decodeBlob(yield* readPelArtifactJson(binding.runId,found.data.decisionRef));
 if(!blob||pelHash(blob.decision)!==found.data.decisionDigest||!matches(blob,binding,kind,decoded))return yield* Effect.fail(fail('The registered authority belongs to different decision bytes or execution bindings.'));
 if(yield* consumedRecoveryAuthority(binding,replay.value,found.sequence,blob.decision))return yield* Effect.fail(fail('This no-dispatch decision was consumed by a later dispatch attempt. Supply new recovery evidence.'));
});}
function validateRecovery(recovered:PelRecoveredRunV1,decision:PelRecoveryDecisionV1):Effect.Effect<void,RunFailure,PelRuntime>{return Effect.gen(function*(){
 const binding=recovered.activation.binding,runtime=yield* PelRuntime,intent=recovered.replay.intents.get(decision.effectId);
 if(decision.runId!==binding.runId||decision.checkedDigest!==binding.checkedProgramDigest||!intent||recovered.replay.results.has(decision.effectId)||decision.evidenceRefs.length===0)return yield* Effect.fail(fail('The decision does not bind an unresolved effect in this checked program.'));
 for(const evidence of decision.evidenceRefs)yield* runtime.artifacts.get(binding.runId,evidence,PEL_MAX_ARTIFACT_BYTES);
 if(recovered.activation.kind!=='recovered')return yield* Effect.fail(fail('The unresolved effect has no pending evaluator continuation.'));
 const requests=Object.values(recovered.activation.continuation.pending).map(value=>value.request);
 for(const child of recovered.activation.children)if(child.phase!=='done'&&child.pending.length>0){
  const bytes=yield* runtime.artifacts.get(binding.runId,child.continuationRef,PEL_MAX_ARTIFACT_BYTES),continuation=decodePelContinuation(bytes,{sourceDigest:binding.sourceDigest,profileDigest:binding.languageProfileDigest,registryDigest:binding.registryDigest,optionsDigest:child.optionsDigest});
  if(!continuation.ok)return yield* Effect.fail(pelFailure('continuation-incompatible','The child continuation is invalid.'));
  requests.push(...Object.values(continuation.value.pending).map(value=>value.request));
 }
 const request=requests.find(value=>value.requestId===intent.effect.requestId);if(!request)return yield* Effect.fail(pelFailure('journal-corrupt','The unresolved intent has no pending evaluator request.'));
 let receipt:HostReceiptV1|undefined;
 if(decision.decision==='accept-result'){
  const value=yield* readPelArtifactJson(binding.runId,decision.resultRef!),schema=recovered.context.registry.dataSchemas[intent.expectedResultSchemaId];
  if(decision.resultRef!.byteLength>binding.limits.maxOutputBytes||!schema||!isPelDataValue(value)||!validateDataSchema(value,schema))return yield* Effect.fail(fail('The accepted result does not satisfy the original effect schema or output bound.'));
  receipt={requestId:request.requestId,outcome:{tag:'success',value}};
 }
 if(decision.decision==='abandon')receipt={requestId:request.requestId,outcome:{tag:'failure',failure:{code:'reconciliation-abandoned',message:'The authorized recovery decision abandoned this effect.'}}};
 if(receipt&&!validateHostReceipt(recovered.context.registry,request,receipt).ok)return yield* Effect.fail(fail('Recovery result violates the original host receipt schema.'));
});}
/** Reconstruct existing receipts under M1. This validation performs no dispatch or durable writes. */
function validateRevision(recovered:PelRecoveredRunV1,decision:PelRevisionDecisionV1,source:Uint8Array|undefined):Effect.Effect<void,RunFailure,PelRuntime> {
 if(!source)return Effect.fail(fail('The revision requires exact immutable source bytes.'));
 return preparePelRunRevision(recovered,source,decision).pipe(Effect.asVoid);
}
export function registerPelOperatorDecision(binding:ExecutionBindingV1,context:PelOwnedRunContextV1,kind:'recovery',input:unknown,revisionSource?:Uint8Array):Effect.Effect<PelRecoveryDecisionV1,RunFailure,RunServices|Scope.Scope>;
export function registerPelOperatorDecision(binding:ExecutionBindingV1,context:PelOwnedRunContextV1,kind:'revision',input:unknown,revisionSource?:Uint8Array):Effect.Effect<PelRevisionDecisionV1,RunFailure,RunServices|Scope.Scope>;
export function registerPelOperatorDecision(binding:ExecutionBindingV1,context:PelOwnedRunContextV1,kind:Kind,input:unknown,revisionSource?:Uint8Array):Effect.Effect<Decision,RunFailure,RunServices|Scope.Scope>{return Effect.gen(function*(){
 if(context.owner.runId!==binding.runId||!same(context.binding,binding)||context.contract.contractId!==binding.contractId||executionContractSha256(context.contract)!==binding.contractSha256)return yield* Effect.fail(fail('Operator decision registration requires the original bound run owner.'));
 if(!record(input))return yield* Effect.fail(fail('The operator decision is not an ordinary closed object.'));
 const inputBytes=yield* Effect.try({try:()=>Buffer.byteLength(canonicalize(input)),catch:()=>fail('The operator decision is not bounded canonical data.')});if(inputBytes>1048576)return yield* Effect.fail(fail('The operator decision exceeds its input bound.'));
 const supplied=Object.hasOwn(input,'authorityReceipt'),decision=decode(kind,supplied?input:{...input,authorityReceipt:placeholder});if(!decision)return yield* Effect.fail(fail('The operator decision does not match its closed schema.'));
 const ledger=yield* EndstopLedger,state=yield* ledger.status(binding.contractId).pipe(Effect.mapError(()=>fail('The original registered contract is unavailable.')));
 if(state.contractSha256!==binding.contractSha256||state.contract.authorizationSha256!==binding.authoritySha256)return yield* Effect.fail(fail('The operator decision belongs to different registered authority.'));
 if(binding.authority.kind==='v2-child')yield* ledger.familyStatus(binding.authority).pipe(Effect.mapError(()=>fail('The selected registered execution child is unavailable.')));
 const recovered=yield* loadPelRecovery(binding.runId,context);if(!same(recovered.activation.binding,binding))return yield* Effect.fail(fail('The operator decision does not use the current durable execution binding.'));
 const previous=yield* readPelRunResult(binding.runId);if(previous&&previous.programDigest===binding.checkedProgramDigest&&(previous.state==='succeeded'||previous.state==='cancelled'||previous.state==='failed'&&kind!=='revision'||previous.state==='needs-action'&&previous.resumeMode==='final-value'))return yield* Effect.fail(pelFailure('terminal-run','This run result cannot accept the requested operator decision.'));
 if(kind==='recovery')yield* validateRecovery(recovered,decision as PelRecoveryDecisionV1);else yield* validateRevision(recovered,decision as PelRevisionDecisionV1,revisionSource);
 if(supplied){yield* validatePelRegisteredDecisionAuthority(decision.authorityReceipt,binding,kind,decision);return decision;}
 const blob:AuthorityBlob={schemaVersion:1,kind,runId:binding.runId,contractId:binding.contractId,contractSha256:binding.contractSha256,authoritySha256:binding.authoritySha256,checkedDigest:binding.checkedProgramDigest,decision:unsigned(decision)};
 const consumedEvidence=new Set<string>();
 for(const row of [...recovered.replay.records].reverse())if(row.type==='pel.operator-decision.v1'&&row.data.kind===kind&&row.binding.checkedDigest===binding.checkedProgramDigest){
  const prior=decodeBlob(yield* readPelArtifactJson(binding.runId,row.data.decisionRef));if(!prior)return yield* Effect.fail(pelFailure('journal-corrupt','A registered operator decision has invalid authority bytes.'));
  const sameTarget=kind==='revision'||('effectId' in prior.decision&&'effectId' in blob.decision&&prior.decision.effectId===blob.decision.effectId);if(!sameTarget)continue;
  if(yield* consumedRecoveryAuthority(binding,recovered.replay,row.sequence,prior.decision)){
   if(same(prior,blob))return yield* Effect.fail(fail('This no-dispatch decision was already consumed. Supply new recovery evidence.'));
   if('evidenceRefs' in prior.decision)for(const evidence of prior.decision.evidenceRefs)consumedEvidence.add(evidence.sha256);
   continue;
  }
  if(!same(prior,blob))return yield* Effect.fail(fail('A conflicting operator decision is already registered for this target.'));
  return {...decision,authorityReceipt:{effectId:`operator-decision-${row.data.decisionRef.sha256}`,sequence:row.sequence,sha256:row.data.decisionRef.sha256}};
 }
 if(consumedEvidence.size&&'evidenceRefs' in blob.decision&&!blob.decision.evidenceRefs.some(evidence=>!consumedEvidence.has(evidence.sha256)))return yield* Effect.fail(fail('A later recovery decision requires new evidence after the consumed dispatch attempt.'));
 const runtime=yield* PelRuntime,decisionRef=yield* runtime.artifacts.put(binding.runId,Buffer.from(canonicalize(blob)),PEL_MAX_ARTIFACT_BYTES,'ordinary'),stored=yield* appendPelRecord(binding,'pel.operator-decision.v1',{decisionRef,decisionDigest:pelHash(blob.decision),kind});
 return {...decision,authorityReceipt:{effectId:`operator-decision-${decisionRef.sha256}`,sequence:stored.seq,sha256:decisionRef.sha256}};
});}
