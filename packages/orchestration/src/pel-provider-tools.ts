/** M4 owns durable tools, opaque checkpoints, cursors, and bounded cancellation. M3 owns transport I/O. */
import { Effect, Stream } from 'effect';
import { canonicalAuthoringJson, validateDataSchema, type JsonValue } from '@foreman/pel';
import { normalizeUsage, submitToolResult, toolDeduplicationKey, toolContentBytes, validateToolResult, type CancellationObservationV1, type ProviderFailure, type ProviderIdentityV1, type ProviderRequestV1, type ToolRequestV1, type ToolResultV1, type ToolContentV1, type HostPermissionPort, type ProviderTransport } from '@foreman/providers';
import { RunJournal } from '@foreman/event-log';
import { appendPelRecord, readPelRecords, replayPelRun, pelHash, pelBytesHash, pelFailure,projectPelRemainingProviderBudget } from './pel-journal.js';
import { PelRuntime,decodePelArtifactRefV1, type PelRuntimePorts, type HostContextV1, type PelHostEffectFailureV1, type PelHandlerOutcomeV1, type PelStoredProviderContinuationV1, type RunFailure, type ExternalOutcomeV1, type PelArtifactRefV1 } from './pel-run-contract.js';
export const canonicalToolArgumentsDigest = (value:JsonValue):string => pelHash(value);
export function providerFailureToHostFailure(failure:ProviderFailure):PelHostEffectFailureV1 {
 return {code:failure._tag==='OutcomeUnknown'?'unknown-external-outcome':'provider-failure',message:'The provider reported a structured failure.',cause:{providerFailure:failure as unknown as JsonValue}};
}
export function cancellationExternalOutcome(observation:CancellationObservationV1):ExternalOutcomeV1 {
 if(observation.localCleanup!=='complete' && observation.localCleanup!=='not-required') return 'unknown';
 return observation.remoteOutcome==='cancelled'?'confirmed-cancelled':observation.remoteOutcome==='completed'?'confirmed-complete':'unknown';
}
const providerDenied = (message:string):ProviderFailure => ({_tag:'UnsupportedCapability',retryClass:'never',message});
const providerCorrupt = ():ProviderFailure => ({_tag:'OutputInvalid',retryClass:'never',message:'The submitted tool result does not match durable host authorization.'});
export interface PelToolExecutorV1 {
 readonly execute:(identity:ProviderIdentityV1,request:ToolRequestV1,authorization:string,context:HostContextV1)=>Effect.Effect<{readonly content:ToolContentV1;readonly isError:boolean},ProviderFailure>;
}
/** Close over the run services so M3 receives its existing environment-free permission port. */
export function makeDurablePelPermissionPort(options:{readonly context:HostContextV1;readonly journal:typeof RunJournal.Service;readonly runtime:PelRuntimePorts;readonly authorize:HostPermissionPort['authorize']}):HostPermissionPort {
 const provide = <A,E>(effect:Effect.Effect<A,E,RunJournal|PelRuntime>) => effect.pipe(Effect.provideService(RunJournal,options.journal),Effect.provideService(PelRuntime,options.runtime));
 return {
  authorize:(identity,request,policy)=> policy.mode==='none' ? Effect.fail(providerDenied('This admitted request permits no model tools.')) : options.authorize(identity,request,policy),
  submit:(identity,result,send)=>provide(Effect.gen(function*(){
   const valid=validateToolResult(identity,result); if(!valid.ok) return yield* Effect.fail(valid.error);
   if(result.effectId!==options.context.effect.effectId) return yield* Effect.fail(providerCorrupt());
   const replay=replayPelRun(yield* readPelRecords(options.context.binding.runId));
   if(!replay.ok) return yield* Effect.fail(providerCorrupt());
   const durable=replay.value.tools.get(toolDeduplicationKey(result))?.result;
   if(!durable || durable.result.authorizationBinding!==result.authorizationBinding || durable.result.receiptRef!==result.receiptRef || durable.result.contentSha256!==result.contentSha256 || canonicalAuthoringJson(durable.providerIdentity)!==canonicalAuthoringJson(identity)) return yield* Effect.fail(providerCorrupt());
   const bytes=yield* options.runtime.artifacts.get(options.context.binding.runId,durable.result.contentRef,64*1024*1024).pipe(Effect.mapError(providerCorrupt));
   if(Buffer.from(bytes).toString('utf8')!==canonicalAuthoringJson(result.content)) return yield* Effect.fail(providerCorrupt());
   return yield* send();
  })).pipe(Effect.mapError(error=>'_tag' in error && error._tag==='PelRunFailure'?providerCorrupt():error as ProviderFailure)),
 };
}
export function executeDurableProviderTool(event:{readonly providerIdentity:ProviderIdentityV1;readonly request:ToolRequestV1},request:ProviderRequestV1,context:HostContextV1,transport:ProviderTransport,executor:PelToolExecutorV1,permissionPort?:HostPermissionPort) {
 return Effect.gen(function*(){
  const runtime=yield* PelRuntime, identity=event.providerIdentity, tool=event.request;
  const permissions=permissionPort??runtime.providers.permissions;
  if(request.toolPolicy.mode==='none') return yield* Effect.fail(providerDenied('The admitted provider request forbids tools.'));
  const key=toolDeduplicationKey({effectId:context.effect.effectId,providerIdentity:identity,callId:tool.callId}), argumentsSha256=canonicalToolArgumentsDigest(tool.arguments);
  const replay=replayPelRun(yield* readPelRecords(context.binding.runId));
  if(!replay.ok) return yield* Effect.fail(replay.error);
  const prior=replay.value.tools.get(key);
  if(prior?.intent && (prior.intent.argumentsSha256!==argumentsSha256 || prior.intent.authorizationBinding!==tool.authorizationBinding)) return yield* Effect.fail(pelFailure('journal-corrupt','A repeated provider tool key changed arguments or authority.'));
  let result:ToolResultV1;
  if(prior?.result) {
   if(prior.result.argumentsSha256!==argumentsSha256) return yield* Effect.fail(pelFailure('journal-corrupt','A repeated tool result changed argument identity.'));
   const contentBytes=yield* runtime.artifacts.get(context.binding.runId,prior.result.result.contentRef,64*1024*1024);
   result={...prior.result.result,content:JSON.parse(Buffer.from(contentBytes).toString('utf8')) as ToolContentV1};
  } else {
   if(prior?.intent) return yield* Effect.fail({_tag:'OutcomeUnknown',retryClass:'never',message:'A durable tool intent has no terminal result. Reconciliation is required.'} as const);
   const authorization=yield* permissions.authorize(identity,tool,request.toolPolicy);
   if(authorization!==tool.authorizationBinding) return yield* Effect.fail(providerDenied('Tool authorization differs from the bound host grant.'));
   const requestRef=yield* runtime.artifacts.put(context.binding.runId,Buffer.from(canonicalAuthoringJson(tool)),Math.min(request.limits.maxOutputBytes,1048576),'ordinary');
   yield* appendPelRecord(context.binding,'pel.tool.intent.v1',{effectId:context.effect.effectId,providerIdentity:identity,callId:tool.callId,argumentsSha256,authorizationBinding:authorization,requestRef});
   const executed=yield* executor.execute(identity,tool,authorization,context);
   const provisional={effectId:context.effect.effectId,providerIdentity:identity,callId:tool.callId,authorizationBinding:authorization,receiptRef:`pel-tool-${key}`,content:executed.content,isError:executed.isError,maxBytes:Math.min(request.limits.maxOutputBytes,1048576)};
   result={...provisional,contentSha256:pelBytesHash(Buffer.from(toolContentBytes({...provisional,contentSha256:''})))};
   const valid=validateToolResult(identity,result); if(!valid.ok) return yield* Effect.fail(valid.error);
   const contentRef=yield* runtime.artifacts.put(context.binding.runId,Buffer.from(canonicalAuthoringJson(result.content)),64*1024*1024,'ordinary');
   const {content:_,...stored}=result;
   yield* appendPelRecord(context.binding,'pel.tool.result.v1',{effectId:context.effect.effectId,providerIdentity:identity,callId:tool.callId,argumentsSha256,result:{...stored,contentRef}});
  }
  const valid=validateToolResult(identity,result); if(!valid.ok) return yield* Effect.fail(pelFailure('journal-corrupt','The durable provider tool content failed integrity validation.'));
  yield* submitToolResult(permissions,identity,result,()=>transport.sendToolResult(identity,result));
  return result;
 });
}
const noTools:PelToolExecutorV1={execute:()=>Effect.fail(providerDenied('No admitted host tool implementation is attached.'))};
export const pelProviderUsageReservation=(request:ProviderRequestV1)=>({maxInputTokens:request.limits.maxInputTokens,maxOutputTokens:request.limits.maxOutputTokens,maxCostUsd:request.limits.maxCostUsd});
/** Preserve immutable local inputs before reservation. Candidate resources and spend counters remain unchanged. */
export function preparePelProviderRequest(request:ProviderRequestV1,context:HostContextV1){return Effect.gen(function*(){
 const runtime=yield* PelRuntime,replay=replayPelRun(yield* readPelRecords(context.binding.runId));if(!replay.ok)return yield* Effect.fail(replay.error);
 if(request.effectId!==context.effect.effectId||request.continuation)return yield* Effect.fail(pelFailure('binding-mismatch','A fresh provider preparation must bind this effect without a continuation.'));
 for(const row of replay.value.records)if(row.type==='pel.effect.observed.v1'&&row.data.effectId===context.effect.effectId){
  const bytes=yield* runtime.artifacts.get(context.binding.runId,row.data.observationRef,64*1024*1024),data=yield* Effect.try({try:()=>JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string,unknown>,catch:()=>pelFailure('journal-corrupt','Invalid provider preparation metadata.')});
  if(data.stage!=='provider-preparation')continue;
  const ref=decodePelArtifactRefV1(data.requestRef);
  if(Object.keys(data).sort().join(',')!==['stage','requestRef','requestId','checkedDigest'].sort().join(',')||!ref.ok||data.requestId!==context.effect.requestId||data.checkedDigest!==context.binding.checkedProgramDigest||row.data.providerIdentity!==null||row.data.externalOutcome!=='none')return yield* Effect.fail(pelFailure('journal-corrupt','Provider preparation metadata changed its original binding.'));
  const stored=yield* runtime.artifacts.get(context.binding.runId,ref.value,64*1024*1024),original=yield* Effect.try({try:()=>JSON.parse(Buffer.from(stored).toString('utf8')) as ProviderRequestV1,catch:()=>pelFailure('journal-corrupt','Invalid original provider request.')});
  const budget=original.limits&&pelProviderUsageReservation(original);
  if(!budget||Object.values(budget).some(n=>!Number.isFinite(n)||n<0)||budget.maxInputTokens>request.limits.maxInputTokens||budget.maxOutputTokens>request.limits.maxOutputTokens||budget.maxCostUsd>request.limits.maxCostUsd||pelHash(original)!==pelHash({...request,limits:{...request.limits,...budget}}))return yield* Effect.fail(pelFailure('binding-mismatch','Provider preparation differs from its original immutable request.'));
  return {request:original,requestRef:ref.value};
 }
 const remaining=yield* projectPelRemainingProviderBudget(context.binding),budget={maxInputTokens:Math.min(request.limits.maxInputTokens,remaining.maxInputTokens),maxOutputTokens:Math.min(request.limits.maxOutputTokens,remaining.maxOutputTokens),maxCostUsd:Math.min(request.limits.maxCostUsd,remaining.maxCostUsd)};
 if(budget.maxInputTokens<=0||budget.maxOutputTokens<=0||request.limits.maxCostUsd>0&&budget.maxCostUsd<=0)return yield* Effect.fail(pelFailure('budget-exhausted','The original provider token or cost allowance has no remaining budget.'));
 const prepared={...request,limits:{...request.limits,...budget}},requestRef=yield* runtime.artifacts.put(context.binding.runId,Buffer.from(canonicalAuthoringJson(prepared)),64*1024*1024,'ordinary'),observationRef=yield* runtime.artifacts.put(context.binding.runId,Buffer.from(canonicalAuthoringJson({stage:'provider-preparation',requestRef,requestId:context.effect.requestId,checkedDigest:context.binding.checkedProgramDigest})),1048576,'ordinary');
 yield* appendPelRecord(context.binding,'pel.effect.observed.v1',{effectId:context.effect.effectId,observationRef,providerIdentity:null,externalOutcome:'none'});
 return {request:prepared,requestRef};
});}
/** Consume M3's stream in the owner's scope. No retries, budget ledger, or transport implementation here. */
export function executePelProviderRequest(request:ProviderRequestV1,context:HostContextV1,executor?:PelToolExecutorV1) {
 return Effect.gen(function*(){
  const runtime=yield* PelRuntime;
  const restored=replayPelRun(yield* readPelRecords(context.binding.runId));
  if(!restored.ok) return yield* Effect.fail(restored.error);
  const intent=restored.value.intents.get(context.effect.effectId);
  if(!intent?.usageReservation||!intent.reservation||intent.reservation.reservationId!==request.limits.spendReservationRef||pelHash(intent.usageReservation)!==pelHash(pelProviderUsageReservation(request)))return yield* Effect.fail(pelFailure('budget-exhausted','The provider request has no exact durable action and usage reservation.'));
  const saved=restored.value.cursors.get(context.effect.effectId);
  if(saved?.checkpoint) {
   const bytes=yield* runtime.artifacts.get(context.binding.runId,saved.checkpoint.artifact,64*1024*1024);
   const {artifact:_,...metadata}=saved.checkpoint;
   request={...request,continuation:{...metadata,bytes,...(saved.cursor?{cursor:saved.cursor}:{})}};
  }
  const resolving=yield* runtime.providers.resolve(request,context).pipe(Effect.either);
  if(resolving._tag==='Left') {
   const error=resolving.left;
   if(error._tag==='PelRunFailure') return yield* Effect.fail(error);
   if(['AuthenticationRequired','ProbeUnknown','ResumeUnavailable','OutcomeUnknown','TransportDisconnected'].includes(error._tag)) {
    const priorIdentity=saved?.providerIdentity??request.continuation?.providerIdentity??null;
    const observationRef=yield* runtime.artifacts.put(context.binding.runId,Buffer.from(canonicalAuthoringJson({stage:'provider-resolution',confirmedNoDispatch:priorIdentity===null,providerFailure:error})),64*1024*1024,'ordinary');
    yield* appendPelRecord(context.binding,'pel.effect.observed.v1',{effectId:context.effect.effectId,observationRef,providerIdentity:priorIdentity,externalOutcome:priorIdentity?'unknown':'none'});
    return {kind:'waiting',pendingRequestId:context.effect.requestId,reason:'authority-required',observationRef} as const;
   }
   return {kind:'settled',outcome:{tag:'failure',failure:providerFailureToHostFailure(error)}} as const;
  }
  const transport=resolving.right.transport;
  const selectedExecutor=executor??resolving.right.toolExecutor??noTools;
  let identity:ProviderIdentityV1|null=saved?.providerIdentity??null, checkpoint:PelStoredProviderContinuationV1|null=saved?.checkpoint??null;
  let terminal:PelHandlerOutcomeV1|null=null;
  let toolCalls=0, outputBytes=0;
  const observe=(value:unknown,outcome:ExternalOutcomeV1,usage?:import('@foreman/providers').ProviderUsageV1) => Effect.gen(function*(){
   const observationRef=yield* runtime.artifacts.put(context.binding.runId,Buffer.from(canonicalAuthoringJson(value)),64*1024*1024,'ordinary');
   const totals=usage?{...(usage.inputTokens!==undefined?{inputTokens:usage.inputTokens}:{}),...(usage.outputTokens!==undefined?{outputTokens:usage.outputTokens}:{}),...(usage.costUsd!==undefined?{costUsd:usage.costUsd}:{})}:undefined;
   yield* appendPelRecord(context.binding,'pel.effect.observed.v1',{effectId:context.effect.effectId,observationRef,providerIdentity:identity,externalOutcome:outcome,...(totals?{usage:totals}:{})});
   return observationRef;
  });
  const waiting=(value:unknown) => Effect.gen(function*(){
   const observationRef=yield* observe(value,'unknown');
   return {kind:'waiting',pendingRequestId:context.effect.requestId,reason:'unknown-external-outcome',observationRef} as const;
  });
  const cancellation=Effect.gen(function*(){
   if(!identity) { yield* observe({cancellation:{requested:true,acknowledged:false,localCleanup:'unknown',remoteOutcome:'unknown'}},'unknown'); return; }
   const started=yield* runtime.clock.now, until=started+context.binding.limits.cancellationObservationMs;
   let observed:CancellationObservationV1={requested:true,acknowledged:false,localCleanup:'unknown',remoteOutcome:'unknown'};
   const cancelled=yield* transport.cancel(identity).pipe(Effect.timeoutOption(context.binding.limits.cancellationObservationMs),Effect.either);
   if(cancelled._tag==='Right' && cancelled.right._tag==='Some') observed=cancelled.right.value;
   let polls=0;
   while(cancellationExternalOutcome(observed)==='unknown' && (yield* runtime.clock.now)<until && polls++<Math.ceil(context.binding.limits.cancellationObservationMs/50)) {
    const remaining=until-(yield* runtime.clock.now);
    if(remaining<=0) break;
    const remote=yield* transport.observe(identity).pipe(Effect.timeoutOption(remaining),Effect.either);
    if(remote._tag==='Right' && remote.right._tag==='Some') {
     const remoteStatus=remote.right.value.status;
     if(remoteStatus==='cancelled' || remoteStatus==='completed') { observed={...observed,remoteOutcome:remoteStatus}; break; }
     if(remoteStatus==='unsupported' || remoteStatus==='not-found') break;
    }
    yield* runtime.clock.sleep(Math.min(50,remaining));
   }
   yield* observe({cancellation:observed},cancellationExternalOutcome(observed));
  });
  const consume=Effect.gen(function*(){
   const requestRef=yield* runtime.artifacts.put(context.binding.runId,Buffer.from(canonicalAuthoringJson({...request,...(request.continuation?{continuation:checkpoint}:{})})),64*1024*1024,'ordinary');
   yield* observe({requestRef},saved?'pending':'unknown');
   if(saved && !saved.cursor) return yield* waiting({reason:'saved-provider-cursor-unavailable'});
   const stream=yield* (saved?transport.resume(request,saved.providerIdentity,saved.cursor!):request.continuation?transport.resume(request,request.continuation.providerIdentity,request.continuation.cursor??''):transport.start(request));
   yield* Stream.runForEach(stream,event=>Effect.gen(function*(){
    if(event.effectId!==request.effectId || event.effectId!==context.effect.effectId || terminal) return yield* Effect.fail(pelFailure('journal-corrupt','Provider stream changed effect identity or continued after its terminal event.'));
    if(identity && canonicalAuthoringJson(identity)!==canonicalAuthoringJson(event.providerIdentity)) return yield* Effect.fail(pelFailure('journal-corrupt','Provider identity changed inside an effect.'));
    identity=event.providerIdentity;
    const payload=event.payload;
    switch(payload.type) {
     case 'started': yield* observe({type:'started',providerIdentity:identity},'pending'); break;
     case 'text': outputBytes+=Buffer.byteLength(payload.text); if(outputBytes>request.limits.maxOutputBytes) return yield* Effect.fail({_tag:'OutputInvalid',retryClass:'never',message:'Provider text exceeded the admitted output bound.'} as const); break;
     case 'usage':
      if(payload.usage.inputTokens && payload.usage.inputTokens>request.limits.maxInputTokens || payload.usage.outputTokens && payload.usage.outputTokens>request.limits.maxOutputTokens) return yield* Effect.fail({_tag:'OutputInvalid',retryClass:'never',message:'Provider usage exceeded the admitted token bound.'} as const);
      yield* observe({usage:payload.usage},'pending',payload.usage); break;
     case 'tool-request':
      toolCalls++; if(toolCalls>request.limits.maxToolCalls) return yield* Effect.fail(providerDenied('Provider tool count exceeded the admitted bound.'));
      yield* executeDurableProviderTool({providerIdentity:identity,request:payload.request},request,context,transport,selectedExecutor,resolving.right.permissions); break;
     case 'checkpoint': {
      if(canonicalAuthoringJson(payload.checkpoint.providerIdentity)!==canonicalAuthoringJson(identity) || pelBytesHash(payload.checkpoint.bytes)!==payload.checkpoint.sha256) return yield* Effect.fail(pelFailure('journal-corrupt','Provider checkpoint identity or hash changed.'));
      const artifact=yield* runtime.artifacts.put(context.binding.runId,payload.checkpoint.bytes,64*1024*1024,'provider-opaque');
      const {bytes:_,...metadata}=payload.checkpoint; checkpoint={...metadata,artifact}; break;
     }
     case 'completed':
      if(payload.result.schemaId!==request.outputSchema.id || payload.result.schemaSha256!==pelHash(request.outputSchema.content) || !Number.isSafeInteger(payload.result.byteLength) || payload.result.byteLength<0 || payload.result.byteLength>request.limits.maxOutputBytes || !validateDataSchema(payload.result.value,request.outputSchema.content)) return yield* Effect.fail({_tag:'OutputInvalid',retryClass:'never',message:'Provider result does not satisfy its original output schema.'} as const);
      yield* observe({type:'completed',result:payload.result,...(payload.usage?{usage:payload.usage}:{})},'confirmed-complete',payload.usage);
      terminal={kind:'settled',outcome:{tag:'success',value:payload.result.value}}; break;
     case 'refused': yield* observe({type:'refused'},'confirmed-complete'); terminal={kind:'settled',outcome:{tag:'failure',failure:{code:'provider-refused',message:'The provider refused the admitted request.'}}}; break;
     case 'failed':
      if(['OutcomeUnknown','TransportDisconnected','ResumeUnavailable','AuthenticationRequired','ProbeUnknown'].includes(payload.failure._tag)) terminal=yield* waiting({providerFailure:payload.failure});
      else {yield* observe({providerFailure:payload.failure},'confirmed-complete'); terminal={kind:'settled',outcome:{tag:'failure',failure:providerFailureToHostFailure(payload.failure)}};} break;
     case 'cancelled': {
      const external=cancellationExternalOutcome(payload.observation);
      if(external!=='confirmed-cancelled') terminal=yield* waiting({cancellation:payload.observation});
      else {yield* observe({cancellation:payload.observation},external);terminal={kind:'settled',outcome:{tag:'failure',failure:{code:'cancelled',message:'Provider cancellation and local cleanup are confirmed.',cause:{cancellation:payload.observation as unknown as JsonValue}}}};} break;
     }
    }
    if(!terminal && (event.cursor || payload.type==='checkpoint')) {
     const records=yield* readPelRecords(context.binding.runId), last=records.at(-1);
     if(!last) return yield* Effect.fail(pelFailure('journal-corrupt','A provider cursor requires preceding durable state.'));
     yield* appendPelRecord(context.binding,'pel.provider.cursor.v1',{effectId:context.effect.effectId,providerIdentity:identity,cursor:event.cursor??checkpoint?.cursor??null,checkpoint,previousSequence:last.seq,previousHash:pelHash(last)});
    }
   }));
   if(terminal) return terminal;
   return yield* waiting({reason:'provider-stream-ended-without-terminal-result'});
  });
  const now=yield* runtime.clock.now;
  return yield* consume.pipe(Effect.onInterrupt(()=>cancellation.pipe(Effect.orDie)),Effect.timeoutFail({duration:Math.max(1,request.limits.deadline-now),onTimeout:()=>({_tag:'OutcomeUnknown',retryClass:'never',message:'Provider deadline expired before a confirmed outcome.'} as const)}),Effect.catchAll((error):Effect.Effect<PelHandlerOutcomeV1,RunFailure,RunJournal>=>{
   if(error._tag==='PelRunFailure') return Effect.fail(error);
   if(['OutcomeUnknown','TransportDisconnected','ResumeUnavailable','AuthenticationRequired','ProbeUnknown'].includes(error._tag)) return waiting({providerFailure:error});
   return Effect.succeed<PelHandlerOutcomeV1>({kind:'settled',outcome:{tag:'failure',failure:providerFailureToHostFailure(error)}});
  }));
 });
}

/** Sum complete known dimensions; an absent dimension is unknown, including on unresolved effects. */
export function aggregatePelProviderUsage(observations:readonly {readonly effectId:string;readonly usage?:import('@foreman/providers').ProviderUsageV1}[]):import('@foreman/pel').Result<import('@foreman/providers').ProviderUsageV1,RunFailure> {
 const latest=new Map(observations.map(item=>[item.effectId,item.usage]));
 const providerCounters:Record<string,number|string>={};
 for(const [effectId,usage] of latest) if(usage) {
  const valid=normalizeUsage(usage);if(!valid.ok)return {ok:false,error:pelFailure('journal-corrupt','Stored provider usage is invalid.')};
  for(const [key,value] of Object.entries(usage.providerCounters))providerCounters[`${effectId}:${key}`]=value;
 }
 const values=[...latest.values()],result:{inputTokens?:number;outputTokens?:number;cachedReadTokens?:number;cacheWriteTokens?:number;costUsd?:string;priceScheduleRef?:string;priceSchedule?:import('@foreman/providers').PriceScheduleV1;providerCounters:Readonly<Record<string,number|string>>}={providerCounters};
 if(values.length===0)return {ok:true,value:result};
 for(const dimension of ['inputTokens','outputTokens','cachedReadTokens','cacheWriteTokens'] as const) if(values.every(v=>v?.[dimension]!==undefined)) {
  const sum=values.reduce((total,value)=>total+value![dimension]!,0);
  if(!Number.isSafeInteger(sum))return {ok:false,error:pelFailure('journal-corrupt','Aggregate provider usage exceeds the exact integer bound.')};
  result[dimension]=sum;
 }
 if(values.every(v=>v?.costUsd!==undefined)) {
  const decimals=values.map(v=>v!.costUsd!),scale=Math.max(...decimals.map(v=>v.split('.')[1]?.length??0));
  const sum=decimals.reduce((total,value)=>{const [whole,fraction='']=value.split('.');return total+BigInt(whole!+fraction.padEnd(scale,'0'));},0n).toString().padStart(scale+1,'0');
  result.costUsd=scale===0?sum:`${sum.slice(0,-scale)}.${sum.slice(-scale)}`.replace(/\.?0+$/u,'');
 }
 if(values[0]?.priceScheduleRef && values.every(v=>v?.priceScheduleRef===values[0]!.priceScheduleRef))result.priceScheduleRef=values[0].priceScheduleRef;
 if(values[0]?.priceSchedule && values.every(v=>v?.priceSchedule && canonicalAuthoringJson(v.priceSchedule)===canonicalAuthoringJson(values[0]!.priceSchedule)))result.priceSchedule=values[0].priceSchedule;
 return {ok:true,value:result};
}
export function projectPelProviderUsage(binding:import('./pel-run-contract.js').ExecutionBindingV1) {
 return Effect.gen(function*(){
  const runtime=yield* PelRuntime,replay=replayPelRun(yield* readPelRecords(binding.runId));if(!replay.ok)return yield* Effect.fail(replay.error);
  const effects=new Map<string,import('@foreman/providers').ProviderUsageV1|undefined>();
  for(const record of replay.value.records) if(record.type==='pel.effect.observed.v1') {
   const bytes=yield* runtime.artifacts.get(binding.runId,record.data.observationRef,64*1024*1024);
   const value=yield* Effect.try({try:()=>JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string,unknown>,catch:()=>pelFailure('journal-corrupt','Stored usage observation is invalid.')});
   if(!value || typeof value!=='object')continue;
   if(record.data.providerIdentity || value.requestRef) if(!effects.has(record.data.effectId))effects.set(record.data.effectId,undefined);
   const failure=value.providerFailure as {usage?:import('@foreman/providers').ProviderUsageV1}|undefined;
   const usage=(value.usage??failure?.usage) as import('@foreman/providers').ProviderUsageV1|undefined;
   if(usage) {
    const valid=yield* Effect.try({try:()=>normalizeUsage(usage),catch:()=>pelFailure('journal-corrupt','Stored usage dimensions are invalid.')});
    if(!valid.ok)return yield* Effect.fail(pelFailure('journal-corrupt','Stored usage dimensions are invalid.'));
    effects.set(record.data.effectId,valid.value);
   }
  }
  const result=aggregatePelProviderUsage([...effects].map(([effectId,usage])=>({effectId,...(usage?{usage}:{})})));
  return result.ok?result.value:yield* Effect.fail(result.error);
 });
}
