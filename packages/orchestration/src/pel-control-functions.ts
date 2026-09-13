/** Trusted control arguments stay in M1's data-only closure representation. */
import type { HostEffectFailure, PelValue, Result } from '@foreman/pel';
import type { ProviderFailure } from '@foreman/providers';
export type RetrySelector = 'rate-limited' | 'transport-disconnected';
export function decodeRetrySelectors(value: PelValue | undefined): Result<readonly RetrySelector[], HostEffectFailure> {
  const fail = {ok:false as const,error:{code:'capability-denied',message:'Retry selectors must be evaluated quoted transient keys'}};
  if (value?.tag !== 'list') return fail;
  const selected: RetrySelector[] = [];
  for (const item of value.items) {
    if(item.tag !== 'key' || item.name !== 'rate-limited' && item.name !== 'transport-disconnected') return fail;
    if (!selected.includes(item.name)) selected.push(item.name);
  }
  return {ok:true,value:selected};
}
export function retryCategory(failure: HostEffectFailure): RetrySelector | null {
  if(failure.code !== 'provider-failure' || !failure.cause || typeof failure.cause !== 'object' || Array.isArray(failure.cause)) return null;
  const cause = failure.cause as Record<string,unknown>;
  const provider = cause.providerFailure as ProviderFailure | undefined;
  if(!provider || typeof provider !== 'object') return null;
  switch(provider._tag) {
    case 'RateLimited': return provider.retryClass === 'transient' ? 'rate-limited' : null;
    case 'TransportDisconnected': return provider.retryClass === 'transient' && (cause.confirmedNoDispatch === true || cause.safeContinuation === true) ? 'transport-disconnected' : null;
    case 'ModelUnavailable': case 'ModelMismatch': case 'UnsupportedCapability': case 'CapabilityUnverified': case 'PromptChannelUnsupported': case 'AuthenticationRequired': case 'ProbeUnknown': case 'OutputInvalid': case 'OutputIncomplete': case 'MalformedEvent': case 'ContinuationMismatch': case 'ResumeUnavailable': case 'OutcomeUnknown': return null;
    default: { const exhaustive:never = provider; void exhaustive; return null; }
  }
}
export function retryLogicalOperationKey(parentRequestId:string, invocationPath:string):string {
  const prefix = `${parentRequestId}/retry/`;
  if(!invocationPath.startsWith(prefix)) return `${parentRequestId}/${invocationPath}`;
  return `${parentRequestId}/${invocationPath.slice(prefix.length).replace(/^[1-9][0-9]*\//,'')}`;
}

import { Deferred, Effect, Exit, Fiber, Queue } from 'effect';
import { chargeClosureConsumption, decodePelContinuation, encodeHostArgumentsV1, evaluateClosure, extractClosureEnvironment, isPelDataValue, resumePel, validateHostReceipt } from '@foreman/pel';
import type { HostReceiptV1, HostRequestV1, PelClosureValue, PelContinuationV1, PelCounters, PelDataValue, PelStep } from '@foreman/pel';
import { PelRuntime } from './pel-run-contract.js';
import type { HostContextV1, HostDispatchOutcomeV1, PelChildStateV1, PelControlHandlerV1, PelRunDriver, PelWorkspaceGrantV1, RunFailure, RunServices } from './pel-run-contract.js';
import { appendPelEffectResult, appendPelRecord, pelHash, readPelRecords, replayPelRun, stablePelEffectIdentity } from './pel-journal.js';
import { PEL_ARTIFACT_MAX_BYTES, pelRunnerFailure, persistPelChild, persistPelContinuation, persistPelSuspension, putPelRunData } from './pel-runner.js';

/** A committed loser can discard local completion only after external work is durably settled. */
export function settlePelKnownRaceLoser(request:HostRequestV1,context:HostContextV1,observation:import('./pel-journal.js').PelObservedDataV1|undefined) {
  return Effect.gen(function*(){
    if(!observation||!['none','confirmed-complete','confirmed-cancelled'].includes(observation.externalOutcome))return undefined;
    const receipt:HostReceiptV1={requestId:request.requestId,outcome:{tag:'failure',failure:{code:'cancelled',message:'The committed race winner discarded this joined loser after its external work settled.',cause:{observationRef:{...observation.observationRef},externalOutcome:observation.externalOutcome}}}};
    const valid=validateHostReceipt(context.checked.snapshot.registry,request,receipt);if(!valid.ok)return yield* Effect.fail(pelRunnerFailure('continuation-incompatible',valid.error.message));
    yield* appendPelEffectResult(context.binding,context.effect,receipt);return receipt;
  });
}
function settleJoinedLoser(child:PelChildStateV1,parent:PelContinuationV1,context:HostContextV1,history:import('./pel-journal.js').PelReplayV1) {
  return Effect.gen(function*(){
    if(!child.pending.length)return child;
    const runtime=yield* PelRuntime,bytes=yield* runtime.artifacts.get(context.binding.runId,child.continuationRef,PEL_ARTIFACT_MAX_BYTES),decoded=decodePelContinuation(bytes,{sourceDigest:parent.sourceDigest,profileDigest:parent.profileDigest,registryDigest:parent.registryDigest,optionsDigest:child.optionsDigest});
    if(!decoded.ok)return yield* Effect.fail(pelRunnerFailure('continuation-incompatible',decoded.error.message));
    const pending:PelChildStateV1['pending'][number][]=[];
    for(const item of child.pending){if(history.results.has(item.effect.effectId))continue;const request=decoded.value.pending[item.effect.requestId]?.request;if(!request)return yield* Effect.fail(pelRunnerFailure('journal-corrupt','The abandoned effect has no original child request.'));const settled=history.intents.has(item.effect.effectId)?yield* settlePelKnownRaceLoser(request,{...context,effect:item.effect,workspace:child.workspaceGrant},history.observations.get(item.effect.effectId)):undefined;if(!settled)pending.push(item);}
    return {...child,pending};
  });
}
function loserCancellation(child:PelChildStateV1,history:import('./pel-journal.js').PelReplayV1):string {
  if(child.phase==='done') return 'completed';
  return child.pending.some(item=>history.intents.has(item.effect.effectId)&&!history.results.has(item.effect.effectId)&&history.observations.get(item.effect.effectId)?.externalOutcome!=='confirmed-cancelled')?'unknown':'confirmed-cancelled';
}
const pair=(key:string,value:PelDataValue):PelDataValue=>({tag:'pair',key,value});
const list=(...items:PelDataValue[]):PelDataValue=>({tag:'list',items});
const number=(value:number):PelDataValue=>({tag:'number',value});
const string=(value:string):PelDataValue=>({tag:'string',value});
function settle(request:HostRequestV1,context:HostContextV1,outcome:HostReceiptV1['outcome'],continuation?:PelContinuationV1) {
  return Effect.gen(function* () {
    const receipt:HostReceiptV1={requestId:request.requestId,outcome};
    const validated=validateHostReceipt(context.checked.snapshot.registry,request,receipt);
    if(!validated.ok) return yield* Effect.fail(pelRunnerFailure('continuation-incompatible',validated.error.message));
    const receiptRef=yield* appendPelEffectResult(context.binding,context.effect,receipt);
    return {kind:'settled' as const,receipt,receiptRef,...(continuation?{continuation}:{})};
  });
}
function rejected(request:HostRequestV1,context:HostContextV1,message:string) {
  return settle(request,context,{tag:'failure',failure:{code:'capability-denied',message}});
}
function childContext(parent:PelContinuationV1,request:HostRequestV1,id:string,closure:PelClosureValue,limits:PelChildStateV1['allocatedLimits']) {
  const environment=extractClosureEnvironment(parent,closure);
  if(!environment.ok) return environment;
  return {ok:true as const,value:{program:parent.program,registry:parent.registry,sourceDigest:parent.sourceDigest,profileDigest:parent.profileDigest,registryDigest:parent.registryDigest,parentRequestId:request.requestId,childInvocationId:id,environmentTable:environment.value,limits,options:parent.options,optionsDigest:parent.optionsDigest}};
}
function charge(parent:PelContinuationV1,child:PelChildStateV1):Effect.Effect<PelContinuationV1,RunFailure> {
  if(parent.mergedChildren.includes(child.childInvocationId)) return Effect.succeed(parent);
  const charged=chargeClosureConsumption(parent,child.childInvocationId,child.consumed);
  return charged.ok?Effect.succeed(charged.value):Effect.fail(pelRunnerFailure('budget-exhausted',charged.error.message));
}
function persistControlParent(context:HostContextV1,parent:PelContinuationV1,driver:PelRunDriver) {
  return Effect.gen(function* () {
    if(context.childInvocationId) {
      const child=driver.children.find(child=>child.childInvocationId===context.childInvocationId);
      if(!child) return yield* Effect.fail(pelRunnerFailure('journal-corrupt','Nested control has no durable child owner'));
      const updated=yield* persistPelChild(context.binding,{...child,continuationRef:yield* persistPelContinuation(context.binding,parent),consumed:parent.counters,trancheOrdinal:child.trancheOrdinal+1});
      driver.updateChild(updated); return;
    }
    const replay=replayPelRun(yield* readPelRecords(context.binding.runId));
    if(!replay.ok) return yield* Effect.fail(replay.error);
    const runtime=yield* PelRuntime;
    let pending:import('./pel-run-contract.js').PelPendingEffectV1[]=[];
    if(replay.value.suspensionRef) {
      const bytes=yield* runtime.artifacts.get(context.binding.runId,replay.value.suspensionRef,PEL_ARTIFACT_MAX_BYTES);
      const saved=JSON.parse(Buffer.from(bytes).toString('utf8')) as import('./pel-run-contract.js').PelSuspensionV1;
      pending=saved.pending.filter(item=>Object.hasOwn(parent.pending,item.effect.requestId));
    }
    yield* persistPelSuspension(context.binding,parent,[...pending,...driver.children.flatMap(child=>child.pending)],driver.children);
  });
}
type ChildResult=Awaited<Effect.Effect.Success<ReturnType<PelRunDriver['evaluateChild']>>>;
function runChild(request:HostRequestV1,context:HostContextV1,parent:PelContinuationV1,driver:PelRunDriver,closure:PelClosureValue,kind:'retry'|'race',index:number,workspace:PelWorkspaceGrantV1,divisor:number,beforeEvaluation:Effect.Effect<void> = Effect.void):Effect.Effect<ChildResult,RunFailure,RunServices|import('effect').Scope.Scope> {
  return Effect.gen(function* () {
    const runtime=yield* PelRuntime;
    const id=`${request.requestId}/${kind}/${index}`;
    const encoded=encodeHostArgumentsV1(request.boundArguments,{sourceDigest:parent.sourceDigest,registryDigest:parent.registryDigest,optionsDigest:parent.optionsDigest,records:parent.environments});
    if(!encoded.ok) return yield* Effect.fail(pelRunnerFailure('continuation-incompatible',encoded.error.message));
    const closureArgumentDigest=pelHash(encoded.value);
    let child=driver.children.find(child=>child.childInvocationId===id);
    let first:PelStep;
    if(child) {
      if(child.closureArgumentDigest!==closureArgumentDigest || child.optionsDigest!==parent.optionsDigest) return yield* Effect.fail(pelRunnerFailure('continuation-incompatible','Recovered child closure arguments differ'));
      if(child.resultRef) {
        const bytes=yield* runtime.artifacts.get(context.binding.runId,child.resultRef,PEL_ARTIFACT_MAX_BYTES);
        const receipt=JSON.parse(Buffer.from(bytes).toString('utf8')) as HostReceiptV1;
        const childEffect=stablePelEffectIdentity(context.binding,id,kind==='retry'?index-1:0);
        const receiptRef=yield* appendPelEffectResult(context.binding,childEffect,{...receipt,requestId:id});
        yield* beforeEvaluation;
        return {outcome:{kind:'settled',receipt:{...receipt,requestId:request.requestId},receiptRef},child,counters:child.consumed};
      }
      const bytes=yield* runtime.artifacts.get(context.binding.runId,child.continuationRef,PEL_ARTIFACT_MAX_BYTES);
      const decoded=decodePelContinuation(bytes,{sourceDigest:parent.sourceDigest,profileDigest:parent.profileDigest,registryDigest:parent.registryDigest,optionsDigest:parent.optionsDigest});
      if(!decoded.ok) return yield* Effect.fail(pelRunnerFailure('continuation-incompatible',decoded.error.message));
      const history=replayPelRun(yield* readPelRecords(context.binding.runId));
      if(!history.ok) return yield* Effect.fail(history.error);
      const receipts:HostReceiptV1[]=[];
      for(const recorded of history.value.results.values()) {
        if(!decoded.value.pending[recorded.effect.requestId]) continue;
        const bytes=yield* runtime.artifacts.get(context.binding.runId,recorded.receiptRef,PEL_ARTIFACT_MAX_BYTES);
        receipts.push(JSON.parse(Buffer.from(bytes).toString('utf8')) as HostReceiptV1);
      }
      first=resumePel(parent.program,parent.registry,decoded.value,receipts,parent.options);
    } else {
      const debited=driver.children.filter(other=>Object.hasOwn(parent.pending,other.parentRequestId)&&!parent.mergedChildren.includes(other.childInvocationId));
      const unavailable=(key:'reductions'|'iterations')=>debited.reduce((sum,other)=>sum+(other.phase==='active'?other.allocatedLimits[key==='reductions'?'maxReductions':'maxIterations']:other.consumed[key]),0);
      const limits={...parent.limits,maxReductions:Math.max(0,Math.floor((parent.limits.maxReductions-parent.counters.reductions-unavailable('reductions'))/divisor)),maxIterations:Math.max(0,Math.floor((parent.limits.maxIterations-parent.counters.iterations-unavailable('iterations'))/divisor))};
      const evalContext=childContext(parent,request,id,closure,limits);
      if(!evalContext.ok) return yield* Effect.fail(pelRunnerFailure('continuation-incompatible',evalContext.error.message));
      first=evaluateClosure(closure,[],evalContext.value);
      child={schemaVersion:1,parentRequestId:request.requestId,parentEffectId:context.effect.effectId,childInvocationId:id,childKind:kind,index,phase:'active',closureArgumentDigest,continuationRef:context.binding.artifacts.source,optionsDigest:parent.optionsDigest,allocatedLimits:limits,consumed:first.counters,trancheOrdinal:0,lastCounterChargeSequence:0,pending:[],workspaceGrant:workspace,immutableBase:workspace.immutableBase,winnerDecisionRef:null,...(kind==='retry'?{retryContext:{parentRequestId:request.requestId,attemptIndex:index,logicalOperationKey:request.requestId}}:{})};
      driver.updateChild(child);
      child={...child,continuationRef:yield* persistPelContinuation(context.binding,first.tag==='done'?parent:first.continuation)};
      if(first.tag==='done') {
        if(!isPelDataValue(first.value)) return yield* Effect.fail(pelRunnerFailure('continuation-incompatible','Child completed with non-data'));
        child={...child,phase:'done',resultRef:yield* putPelRunData(context.binding,{requestId:request.requestId,outcome:{tag:'success',value:first.value}})};
      }
      child=yield* persistPelChild(context.binding,child);
    }
    driver.updateChild(child);
    yield* beforeEvaluation;
    const host:HostContextV1={...context,workspace:child.workspaceGrant,parentRequestId:request.requestId,childInvocationId:id,...(child.retryContext?{retryContext:child.retryContext}:{})};
    return yield* driver.evaluateChild(first,child,host);
  });
}
const checkpointHandler:PelControlHandlerV1={execute:(request,context,parent)=>Effect.gen(function* () {
  const name=request.boundArguments.name;
  if(name?.tag!=='string') return yield* rejected(request,context,'Checkpoint name must be a string');
  const replay=replayPelRun(yield* readPelRecords(context.binding.runId));
  if(!replay.ok)return yield* Effect.fail(replay.error);
  for(const record of replay.value.records)if(record.type==='pel.checkpoint.v1'&&record.data.effectId===context.effect.effectId)
    return yield* settle(request,context,{tag:'success',value:list(pair('name',name),pair('sequence',number(record.sequence)))});
  const continuationRef=yield* persistPelContinuation(context.binding,parent);
  const record=yield* appendPelRecord(context.binding,'pel.checkpoint.v1',{effectId:context.effect.effectId,continuationRef});
  return yield* settle(request,context,{tag:'success',value:list(pair('name',name),pair('sequence',number(record.seq)))});
})};
const retryHandler:PelControlHandlerV1={execute:(request,context,initial,driver)=>Effect.gen(function* () {
  const attempts=request.boundArguments.attempts,body=request.boundArguments.body;
  const selected=decodeRetrySelectors(request.boundArguments.on);
  if(!selected.ok) return yield* rejected(request,context,selected.error.message);
  if(attempts?.tag!=='number'||!Number.isSafeInteger(attempts.value)||attempts.value<1||attempts.value>context.binding.limits.pel.maxIterations||body?.tag!=='closure') return yield* rejected(request,context,'Retry requires an admitted positive total attempt bound and a closure');
  let parent=initial;
  for(let index=1;index<=attempts.value;index++) {
    const child=yield* runChild(request,context,parent,driver,body,'retry',index,context.workspace,1);
    if(child.outcome.kind==='waiting') return child.outcome;
    parent=yield* charge(parent,child.child);
    yield* persistControlParent(context,parent,driver);
    const outcome=child.outcome.receipt.outcome;
    if(outcome.tag==='success') return yield* settle(request,context,outcome,parent);
    const category=retryCategory(outcome.failure);
    if(index===attempts.value || category===null || !selected.value.includes(category)) return yield* settle(request,context,outcome,parent);
    const runtime=yield* PelRuntime;
    if((yield* runtime.clock.now)>=context.binding.limits.deadline) return yield* Effect.fail(pelRunnerFailure('budget-exhausted','Retry exhausted its original deadline'));
  }
  return yield* Effect.fail(pelRunnerFailure('budget-exhausted','Retry exhausted its admitted attempts'));
})};
export function validateRaceEnvelope(context:HostContextV1,closures:readonly PelClosureValue[]):boolean {
  const spans=closures.map(closure=>closure.callable.kind==='user'?closure.callable.body.span:null);
  if(spans.some(span=>span===null)) return false;
  const inside=(span:{start:number;end:number})=>spans.some(body=>body!==null&&body.start<=span.start&&body.end>=span.end);
  const effects=context.checked.analysis.effects.filter(effect=>inside(effect.span));
  const isolated=(resource:string)=>resource==='workspace:default'||resource.startsWith('source:');
  if(effects.some(effect=>effect.resources.writes.some(resource=>!isolated(resource)))) return false;
  return context.checked.analysis.dynamicRegions.filter(region=>region.spans.some(inside)).every(region=>Number.isSafeInteger(region.maxCalls)&&region.maxCalls>0&&Number.isSafeInteger(region.maxIterations)&&region.maxIterations>=0&&Number.isFinite(region.maxElapsedMs)&&region.maxElapsedMs>0&&region.resources.writes.every(isolated));
}
const raceHandler:PelControlHandlerV1={execute:(request,context,parent,driver)=>Effect.scoped(Effect.gen(function* () {
  const tasks=request.boundArguments.tasks,winner=request.boundArguments.winner;
  if(tasks?.tag!=='list'||tasks.items.length<1||tasks.items.length>context.project.workspaces.maxRaceContenders||!tasks.items.every(task=>task.tag==='closure')||winner?.tag!=='string'||winner.value!=='first-valid') return yield* rejected(request,context,'Race requires bounded closures and first-valid policy');
  if(!validateRaceEnvelope(context,tasks.items as readonly PelClosureValue[])) return yield* rejected(request,context,'Race closure effects lack finite isolated workspace envelopes');
  const runtime=yield* PelRuntime;
  const existing=driver.children.filter(child=>child.parentRequestId===request.requestId&&child.childKind==='race');
  const replay=replayPelRun(yield* readPelRecords(context.binding.runId));
  if(!replay.ok) return yield* Effect.fail(replay.error);
  for(const record of replay.value.records) {
    if(record.type!=='pel.race.decision.v1') continue;
    const bytes=yield* runtime.artifacts.get(context.binding.runId,record.data.decisionRef,PEL_ARTIFACT_MAX_BYTES);
    const decision=JSON.parse(Buffer.from(bytes).toString('utf8')) as {parentRequestId:string;winnerIndex:number;eligible:readonly {index:number;workspaceGrantId:string}[]};
    if(decision.parentRequestId!==request.requestId) continue;
    const winnerChild=existing.find(child=>child.index===decision.winnerIndex);
    if(!winnerChild?.resultRef || !decision.eligible.some(row=>row.index===winnerChild.index&&row.workspaceGrantId===winnerChild.workspaceGrant.grantId)) return yield* Effect.fail(pelRunnerFailure('journal-corrupt','Committed race winner lacks its bound result and workspace'));
    const resultBytes=yield* runtime.artifacts.get(context.binding.runId,winnerChild.resultRef,PEL_ARTIFACT_MAX_BYTES);
    const receipt=JSON.parse(Buffer.from(resultBytes).toString('utf8')) as HostReceiptV1;
    if(receipt.outcome.tag!=='success'||!isPelDataValue(receipt.outcome.value)) return yield* Effect.fail(pelRunnerFailure('journal-corrupt','Committed race winner is not ordinary success data'));
    let charged=parent; const losers:PelDataValue[]=[];
    for(let child of existing.sort((a,b)=>a.index-b.index)) {
      if(child.index!==winnerChild.index){child=yield* settleJoinedLoser(child,parent,context,replay.value);child=yield* persistPelChild(context.binding,{...child,phase:child.phase==='done'?'done':'abandoned',winnerDecisionRef:{effectId:context.effect.effectId,sequence:record.sequence,sha256:record.data.decisionRef.sha256}});driver.updateChild(child);}
      charged=yield* charge(charged,child);
      if(child.index!==winnerChild.index) losers.push(list(pair('index',number(child.index)),pair('cancellation',string(loserCancellation(child,replay.value))),pair('artifacts',list(...(child.resultRef?[string(child.resultRef.artifactId)]:[])))));
    }
    yield* persistControlParent(context,charged,driver);
    if(runtime.commitRaceWinner) yield* runtime.commitRaceWinner(receipt.outcome.value,winnerChild,context);
    return yield* settle(request,context,{tag:'success',value:list(pair('winner-index',number(winnerChild.index)),pair('value',receipt.outcome.value),pair('losers',list(...losers)))},charged);
  }

  const grants=existing.length===tasks.items.length?existing.sort((a,b)=>a.index-b.index).map(child=>child.workspaceGrant):yield* runtime.resources.allocateContenders(context,tasks.items.length).pipe(Effect.mapError(error=>pelRunnerFailure('binding-mismatch',error.message)));
  if(grants.length!==tasks.items.length||new Set(grants.map(grant=>grant.worktreeId)).size!==tasks.items.length) return yield* rejected(request,context,'Race requires distinct admitted worktree grants');
  const completions=yield* Queue.unbounded<{index:number;exit:Exit.Exit<ChildResult,RunFailure>}>();
  const fibers=[];
  const allAllocated=yield* Deferred.make<void>();
  let allocations=0;
  const beforeEvaluation=Effect.suspend(()=>{allocations++;return allocations===tasks.items.length?Deferred.succeed(allAllocated,undefined).pipe(Effect.asVoid):Deferred.await(allAllocated);});
  for(let offset=0;offset<tasks.items.length;offset++) {
    const index=offset+1;
    const task=tasks.items[offset] as PelClosureValue;
    fibers.push(yield* runChild(request,context,parent,driver,task,'race',index,grants[offset]!,tasks.items.length,beforeEvaluation).pipe(Effect.exit,Effect.flatMap(exit=>Queue.offer(completions,{index,exit})),Effect.forkScoped));
  }
  const results=new Map<number,ChildResult>();
  let selected:{index:number;result:ChildResult}|undefined;
  while(results.size<tasks.items.length && !selected) {
    const first=yield* Queue.take(completions);
    yield* Effect.yieldNow();
    const batch=[first,...(yield* Queue.takeAll(completions))].sort((a,b)=>a.index-b.index);
    for(const item of batch) {
      if(Exit.isFailure(item.exit)) return yield* Effect.failCause(item.exit.cause);
      results.set(item.index,item.exit.value);
      if(!selected && item.exit.value.outcome.kind==='settled' && item.exit.value.outcome.receipt.outcome.tag==='success') selected={index:item.index,result:item.exit.value};
    }
  }
  if(!selected) {
    const waiting=[...results.values()].find(item=>item.outcome.kind==='waiting');
    if(waiting) return waiting.outcome;
    const last=[...results.values()].at(-1)!;
    let charged=parent; for(const result of results.values()) charged=yield* charge(charged,result.child);
    return last.outcome.kind==='settled'?yield* settle(request,context,last.outcome.receipt.outcome,charged):last.outcome;
  }
  const eligible=[...results].filter(([,result])=>result.outcome.kind==='settled'&&result.outcome.receipt.outcome.tag==='success').map(([index,result])=>({index,receipt:(result.outcome as Extract<HostDispatchOutcomeV1,{kind:'settled'}>).receiptRef,workspaceGrantId:grants[index-1]!.grantId}));
  const decisionRef=yield* putPelRunData(context.binding,{parentRequestId:request.requestId,eligible,winnerIndex:selected.index});
  const decision=yield* appendPelRecord(context.binding,'pel.race.decision.v1',{decisionRef});
  yield* Effect.forEach(fibers.filter((_,offset)=>offset+1!==selected!.index),Fiber.interrupt,{concurrency:'unbounded',discard:true});
  let cleanup=replayPelRun(yield* readPelRecords(context.binding.runId));
  if(!cleanup.ok) return yield* Effect.fail(cleanup.error);
  let charged=parent;
  const loserRows:PelDataValue[]=[];
  for(let index=1;index<=tasks.items.length;index++) {
    let child=driver.children.find(child=>child.childInvocationId===`${request.requestId}/race/${index}`);
    if(!child) continue;
    if(index!==selected.index)child=yield* settleJoinedLoser(child,parent,context,cleanup.value);
    child=yield* persistPelChild(context.binding,{...child,phase:index===selected.index?'done':child.phase==='done'?'done':'abandoned',winnerDecisionRef:{effectId:context.effect.effectId,sequence:decision.seq,sha256:decisionRef.sha256}});
    driver.updateChild(child);
    charged=yield* charge(charged,child);
    if(index!==selected.index) loserRows.push(list(pair('index',number(index)),pair('cancellation',string(loserCancellation(child,cleanup.value))),pair('artifacts',list(...(child.resultRef?[string(child.resultRef.artifactId)]:[])))));
  }
  yield* persistControlParent(context,charged,driver);
  const outcome=selected.result.outcome;
  if(outcome.kind!=='settled'||outcome.receipt.outcome.tag!=='success') return yield* Effect.fail(pelRunnerFailure('journal-corrupt','Race selected an ineligible result'));
  if(runtime.commitRaceWinner) yield* runtime.commitRaceWinner(outcome.receipt.outcome.value,selected.result.child,context);
  return yield* settle(request,context,{tag:'success',value:list(pair('winner-index',number(selected.index)),pair('value',outcome.receipt.outcome.value),pair('losers',list(...loserRows)))},charged);
}))};
export function makePelControlHandlers():ReadonlyMap<string,PelControlHandlerV1> {
  return new Map([['fm/checkpoint',checkpointHandler],['fm/retry',retryHandler],['fm/race',raceHandler]]);
}
