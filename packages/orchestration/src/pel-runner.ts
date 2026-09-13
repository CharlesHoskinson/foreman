/** One scoped owner drives M1 boundaries; the dispatcher owns external permits. */
import { canonicalize } from '@foreman/core';
import { Cause, Deferred, Effect, Exit, Fiber, Queue } from 'effect';
import type { Scope } from 'effect';
import { createPelEnvironment, resumePel, startPel } from '@foreman/pel';
import type { HostReceiptV1, HostRequestV1, PelContinuationV1, PelStep } from '@foreman/pel';

export type PelEvaluationOutcome = { readonly kind: 'settled'; readonly receipt: HostReceiptV1; readonly continuation?: PelContinuationV1 } | { readonly kind: 'waiting'; readonly pendingRequestId: string };
export interface PelEvaluationPorts<E, R> {
  readonly persist: (step: Extract<PelStep, {tag:'suspend'}>) => Effect.Effect<void, E, R>;
  readonly dispatch: (request: HostRequestV1, parent: PelContinuationV1) => Effect.Effect<PelEvaluationOutcome, E, R | Scope.Scope>;
}
/** Internal evaluator loop, shared by root and child activation. No lease or ledger is allocated here. */
export function drivePelEvaluation<E, R>(initial: PelStep, ports: PelEvaluationPorts<E,R>): Effect.Effect<{ readonly step: PelStep; readonly waiting: readonly string[] }, E, R | Scope.Scope> {
  return Effect.gen(function* () {
    let step = initial;
    const completions = yield* Queue.unbounded<{ id:string; base:PelContinuationV1; exit:Exit.Exit<PelEvaluationOutcome,E> }>();
    const pending = new Map<string,Fiber.RuntimeFiber<void,never>>();
    const waiting = new Set<string>();
    yield* Effect.addFinalizer(() => Effect.forEach(pending.values(), Fiber.interrupt, { concurrency:'unbounded', discard:true }));
    while (step.tag === 'suspend') {
      yield* ports.persist(step);
      for (const request of step.ready) {
        if (pending.has(request.requestId) || waiting.has(request.requestId)) continue;
        const base = step.continuation;
        const fiber = yield* ports.dispatch(request, base).pipe(
          Effect.exit,
          Effect.flatMap(exit => Queue.offer(completions, {id:request.requestId,base,exit})),
          Effect.asVoid, Effect.forkScoped,
        );
        pending.set(request.requestId, fiber);
      }
      if (pending.size === 0) return {step,waiting:[...waiting]};
      const completion = yield* Queue.take(completions);
      pending.delete(completion.id);
      if (Exit.isFailure(completion.exit)) return yield* Effect.failCause(completion.exit.cause);
      const outcome = completion.exit.value;
      if (outcome.kind === 'waiting') { waiting.add(completion.id); continue; }
      let continuation = step.continuation;
      if (outcome.continuation) {
        // Parallel controls return accounting deltas, never stale evaluator tasks.
        const charged = outcome.continuation;
        continuation = { ...continuation, counters:{...continuation.counters}, mergedChildren:[...continuation.mergedChildren] };
        for (const key of ['reductions','iterations'] as const) continuation.counters[key] += charged.counters[key] - completion.base.counters[key];
        for (const key of ['syntaxDepthPeak','callDepthPeak','valueBytesPeak'] as const) continuation.counters[key] = Math.max(continuation.counters[key],charged.counters[key]);
        for (const id of charged.mergedChildren) if (!continuation.mergedChildren.includes(id)) continuation.mergedChildren.push(id);
      }
      step = resumePel(continuation.program, continuation.registry, continuation, [outcome.receipt], continuation.options);
    }
    return {step,waiting:[...waiting]};
  });
}

import { canonicalAuthoringJson, decodePelContinuation, encodeHostArgumentsV1, encodePelContinuation, hashAuthoringContent, isPelDataValue } from '@foreman/pel';
import type { CheckedProgramV1, PelCounters } from '@foreman/pel';
import { RunJournal } from '@foreman/event-log';
import type { RunId } from '@foreman/event-log';
import { PelRuntime } from './pel-run-contract.js';
import type { ExecutionBindingV1, HostContextV1, HostDispatchOutcomeV1, PelActivationV1, PelArtifactRefV1, PelChildStateV1, PelOwnedRunContextV1, PelPendingEffectV1, PelReceiptRefV1, PelRunDriver, PelRunDiagnosticV1, PelSuspensionV1, RunFailure, RunResultV1, RunServices } from './pel-run-contract.js';
import { RunLease } from './supervisor.js';
import { appendPelRecord, appendPelEffectResult, readPelRecords, replayPelRun, stablePelEffectIdentity } from './pel-journal.js';
import { executeHostEffect, validateResolvedHostRequest } from './pel-effects.js';
import { projectPelProviderUsage } from './pel-provider-tools.js';
import { classifyPelFinalResult } from './pel-run-result.js';
import { retryLogicalOperationKey } from './pel-control-functions.js';

export function pelRunnerFailure(code:RunFailure['code'], message:string):RunFailure {
  return {_tag:'PelRunFailure',code,diagnostic:{code,message,sourceSpan:null,effectId:null,retryable:false,nextAction:'Inspect the bound run journal',evidenceRefs:[]}};
}
export const PEL_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;
export function putPelRunData(binding:ExecutionBindingV1,value:unknown):Effect.Effect<PelArtifactRefV1,RunFailure,PelRuntime> {
  return Effect.gen(function* () {
    const runtime=yield* PelRuntime;
    const bytes=yield* Effect.try({try:()=>Buffer.from(canonicalize(value)),catch:()=>pelRunnerFailure('continuation-incompatible','Durable artifact is not serializable data')});
    return yield* runtime.artifacts.put(binding.runId,bytes,PEL_ARTIFACT_MAX_BYTES,'ordinary');
  });
}
export function persistPelContinuation(binding:ExecutionBindingV1, continuation:PelContinuationV1):Effect.Effect<PelArtifactRefV1,RunFailure,PelRuntime> {
  return Effect.gen(function* () {
    const encoded = encodePelContinuation(continuation);
    if(!encoded.ok) return yield* Effect.fail(pelRunnerFailure('continuation-incompatible',encoded.error.message));
    const runtime = yield* PelRuntime;
    return yield* runtime.artifacts.put(binding.runId,encoded.value,PEL_ARTIFACT_MAX_BYTES,'ordinary');
  });
}
export function persistPelChild(binding:ExecutionBindingV1, child:PelChildStateV1):Effect.Effect<PelChildStateV1,RunFailure,RunServices> {
  return Effect.gen(function* () {
    const childRef = yield* putPelRunData(binding,child);
    const event = yield* appendPelRecord(binding,'pel.child-suspension.v1',{childRef});
    return {...child,lastCounterChargeSequence:event.seq};
  });
}
export function persistPelSuspension(binding:ExecutionBindingV1,continuation:PelContinuationV1,pending:readonly PelPendingEffectV1[],children:readonly PelChildStateV1[]):Effect.Effect<void,RunFailure,RunServices> {
  return Effect.gen(function* () {
    const continuationRef = yield* persistPelContinuation(binding,continuation);
    const suspension:PelSuspensionV1 = {continuationRef,options:binding.options,optionsDigest:binding.optionsDigest,committedCounters:continuation.counters,pending:pending.filter(item=>Object.hasOwn(continuation.pending,item.effect.requestId)),childRecordSequences:children.map(child=>child.lastCounterChargeSequence).filter(sequence=>sequence>0)};
    const suspensionRef = yield* putPelRunData(binding,suspension);
    yield* appendPelRecord(binding,'pel.suspension.v1',{suspensionRef});
  });
}

/** In-process wakeup is supplemental; journal cancellation is the cross-process signal. */
const cancellationSignals = new Map<RunId, Deferred.Deferred<void>>();
export function signalPelRunCancellation(runId:RunId):Effect.Effect<void> {
  return Effect.suspend(() => {const signal=cancellationSignals.get(runId); return signal ? Deferred.succeed(signal,undefined).pipe(Effect.asVoid) : Effect.void;});
}
export function acquirePelRunOwner(binding:ExecutionBindingV1):Effect.Effect<PelOwnedRunContextV1['owner'],RunFailure,RunLease|Scope.Scope> {
  return Effect.gen(function*(){
    const service=yield* RunLease;
    return yield* Effect.acquireRelease(Effect.flatMap(service.acquire(binding.runId),lease=>lease._tag==='Busy'?Effect.fail(pelRunnerFailure('owner-busy','This run already has an active owner')):Effect.succeed({...lease,runId:binding.runId})),lease=>lease.release());
  });
}
export function withPelRunOwner<A,E,R>(binding:ExecutionBindingV1, use:(owner:PelOwnedRunContextV1['owner'])=>Effect.Effect<A,E,R | Scope.Scope>):Effect.Effect<A,E|RunFailure,R|RunLease> {
  return Effect.scoped(Effect.flatMap(acquirePelRunOwner(binding),use));
}
export function runProgram(checked:CheckedProgramV1,binding:ExecutionBindingV1):Effect.Effect<RunResultV1,RunFailure,RunServices> {
  return withPelRunOwner(binding,owner=>Effect.gen(function* () {
    const runtime=yield* PelRuntime;
    const inputs=yield* runtime.loadRunInputs(binding);
    return yield* drivePelRun({kind:'fresh',checked,binding},{...inputs,owner});
  }));
}

/** Recovery supplies the existing supervisor lease. This function never acquires it again. */
export function drivePelRun(activation:PelActivationV1,context:PelOwnedRunContextV1):Effect.Effect<RunResultV1,RunFailure,RunServices|Scope.Scope> {
  return Effect.gen(function* () {
    const {binding,checked}=activation;
    if(context.owner.runId!==binding.runId || context.binding.checkedProgramDigest!==binding.checkedProgramDigest || checked.bindingDigest!==binding.checkedProgramDigest || checked.sourceDigest!==binding.sourceDigest || context.registry.digest!==binding.registryDigest || (binding.options.replay.mode==='none' ? checked.optionsDigest!==binding.optionsDigest : hashAuthoringContent({...binding.options,replay:{mode:'none'}})!==checked.optionsDigest)) return yield* Effect.fail(pelRunnerFailure('binding-mismatch','Owned evaluator inputs differ from the admitted binding'));
    const runtime=yield* PelRuntime;
    const expired=(yield* runtime.clock.now)>=binding.limits.deadline;
    const children:PelChildStateV1[] = activation.kind==='fresh' ? [] : [...activation.children];
    const receipts:PelReceiptRefV1[] = [];
    const pending = new Map<string,PelPendingEffectV1>();
    const waitingOutcomes:Extract<HostDispatchOutcomeV1,{kind:'waiting'}>[]=[];
    const requestSpans=new Map<string,PelRunDiagnosticV1['sourceSpan']>();
    const sourceNodes=[...checked.program.expressions];
    const nodeSpans=new Map<string,PelRunDiagnosticV1['sourceSpan']>();
    while(sourceNodes.length){const node=sourceNodes.pop()!;nodeSpans.set(node.nodeId,node.span);switch(node.kind){case 'pair':sourceNodes.push(node.value);break;case 'call':case 'list':sourceNodes.push(...node.items);break;case 'quote':sourceNodes.push(node.expression);break;case 'pipe':sourceNodes.push(node.left,node.right);break;}}
    const operations=new Map<string,string>();
    const hostContexts=new Map<string,HostContextV1>();
    let latestCounters:PelCounters;
    const restoredMergedChildren=new Set<string>();
    if(expired&&activation.kind!=='fresh'){
      const continuation=activation.kind==='recovered'?activation.continuation:activation.step.tag==='done'?null:activation.step.continuation;
      if(continuation){for(const id of continuation.mergedChildren)restoredMergedChildren.add(id);for(const {request} of Object.values(continuation.pending))requestSpans.set(request.requestId,nodeSpans.get(request.nodeId)??null);}
    }
    const parentContinuations=new Map<string,PelContinuationV1>();
    const replaceChild=(child:PelChildStateV1)=>{const index=children.findIndex(c=>c.childInvocationId===child.childInvocationId); if(index<0) children.push(child); else children[index]=child;};
    const hostContext=(request:HostRequestV1,parent?:HostContextV1):HostContextV1=>{
      const cached=hostContexts.get(request.requestId); if(cached) return cached;
      const retryContext=parent?.retryContext ? {...parent.retryContext,logicalOperationKey:retryLogicalOperationKey(parent.retryContext.parentRequestId,request.invocationPath)} : undefined;
      const prior=retryContext ? operations.get(retryContext.logicalOperationKey) : undefined;
      const effect=stablePelEffectIdentity(binding,request.requestId,retryContext ? retryContext.attemptIndex-1:0,prior);
      if(retryContext) operations.set(retryContext.logicalOperationKey,effect.effectId);
      const workspace=parent?.workspace ?? context.project.workspaces.grants[0];
      if(!workspace) throw new Error('Admitted workspace grant missing');
      const resolved={checked,binding,project:context.project,effect,workspace,...(retryContext?{retryContext}:{}),...(parent?.childInvocationId?{childInvocationId:parent.childInvocationId}:{}),...(parent?.parentRequestId?{parentRequestId:parent.parentRequestId}:{})};
      hostContexts.set(request.requestId,resolved); return resolved;
    };
    const requestMapping=(request:HostRequestV1,continuation:PelContinuationV1,host:HostContextV1)=>Effect.gen(function* () {
      requestSpans.set(request.requestId,nodeSpans.get(request.nodeId)??null);
      const encoded=encodeHostArgumentsV1(request.boundArguments,{sourceDigest:continuation.sourceDigest,registryDigest:continuation.registryDigest,optionsDigest:continuation.optionsDigest,records:continuation.environments});
      if(!encoded.ok) return yield* Effect.fail(pelRunnerFailure('continuation-incompatible',encoded.error.message));
      const argumentsRef=yield* putPelRunData(binding,encoded.value);
      const mapping:PelPendingEffectV1={effect:host.effect,argumentsRef,expectedResultSchemaId:request.expectedResultSchemaId,reservation:null,observationRef:null,providerIdentity:null};
      pending.set(request.requestId,mapping); return mapping;
    });
    const dispatch=(request:HostRequestV1,host:HostContextV1,parent:PelContinuationV1)=>Effect.gen(function* () {
      if((yield* runtime.clock.now)>=binding.limits.deadline) return yield* Effect.fail(pelRunnerFailure('budget-exhausted','The original run deadline has elapsed'));
      parentContinuations.set(request.requestId,parent);
      const control=runtime.controls.get(request.registryId);
      let outcome:HostDispatchOutcomeV1 & {readonly continuation?:PelContinuationV1};
      const admitted=control?validateResolvedHostRequest(request,host):undefined;
      if(admitted && !admitted.ok) {
        const receipt:HostReceiptV1={requestId:request.requestId,outcome:{tag:'failure',failure:admitted.error}};
        outcome={kind:'settled',receipt,receiptRef:yield* appendPelEffectResult(binding,host.effect,receipt)};
      } else outcome=control ? yield* control.execute(request,host,parent,driver) : yield* executeHostEffect(request,host);
      if(outcome.continuation) parentContinuations.set(request.requestId,outcome.continuation);
      if(outcome.kind==='settled') {receipts.push(outcome.receiptRef);pending.delete(request.requestId);} else waitingOutcomes.push(outcome);
      return outcome;
    }).pipe(Effect.mapError(error=>error.code==='budget-exhausted'?{...error,diagnostic:{...error.diagnostic,sourceSpan:error.diagnostic.sourceSpan??requestSpans.get(request.requestId)??nodeSpans.get(request.nodeId)??null,effectId:error.diagnostic.effectId??host.effect.effectId}}:error));
    const driver:PelRunDriver={
      children, updateChild:replaceChild, drive:drivePelRun,
      dispatch:(request,host)=>executeHostEffect(request,host),
      evaluateChild:(first,allocated,host)=>Effect.scoped(Effect.gen(function* () {
        let child=allocated; replaceChild(child);
        let last=first.tag==='done' ? undefined:first.continuation;
        const result=yield* drivePelEvaluation(first,{
          persist:step=>Effect.gen(function* () {
            last=step.continuation;
            const mappings:PelPendingEffectV1[]=[];
            for(const request of step.ready) mappings.push(yield* requestMapping(request,step.continuation,hostContext(request,host)));
            child=yield* persistPelChild(binding,{...child,continuationRef:yield* persistPelContinuation(binding,step.continuation),consumed:step.counters,pending:mappings,trancheOrdinal:child.trancheOrdinal+1});
            replaceChild(child);
            const parent=parentContinuations.get(child.parentRequestId);
            if(parent) yield* persistPelSuspension(binding,parent,[...pending.values()],children);
          }),
          dispatch:(request,parent)=>dispatch(request,hostContext(request,host),parent),
        });
        if(result.step.tag==='suspend') {
          const observation=waitingOutcomes.find(item=>result.waiting.includes(item.pendingRequestId));
          const observationRef=observation?.observationRef ?? (yield* putPelRunData(binding,{pending:result.waiting}));
          return {outcome:{kind:'waiting' as const,pendingRequestId:child.parentRequestId,reason:'unknown-external-outcome' as const,observationRef},child,counters:result.step.counters};
        }
        const receipt:HostReceiptV1={requestId:child.parentRequestId,outcome:result.step.tag==='done' && isPelDataValue(result.step.value) ? {tag:'success',value:result.step.value} : {tag:'failure',failure:result.step.tag==='failed' && result.step.diagnostic.hostFailure ? result.step.diagnostic.hostFailure : {code:'capability-denied',message:result.step.tag==='failed'?result.step.diagnostic.message:'Control returned non-data value'}}};
        const resultRef=yield* putPelRunData(binding,receipt);
        child=yield* persistPelChild(binding,{...child,phase:'done',resultRef,consumed:result.step.counters,pending:[],trancheOrdinal:child.trancheOrdinal+1,...(last?{continuationRef:yield* persistPelContinuation(binding,last)}:{})});
        replaceChild(child);
        // Child results have their own stable identity, so competing children cannot conflict.
        const childEffect=stablePelEffectIdentity(binding,child.childInvocationId,child.childKind==='retry'?child.index-1:0);
        const receiptRef=yield* appendPelEffectResult(binding,childEffect,{...receipt,requestId:child.childInvocationId});
        return {outcome:{kind:'settled' as const,receipt,receiptRef},child,counters:result.step.counters};
      })),
    };
    for(const child of [...children].sort((a,b)=>a.index-b.index)) {
      if(!child.retryContext&&!expired) continue;
      const bytes=yield* runtime.artifacts.get(binding.runId,child.continuationRef,PEL_ARTIFACT_MAX_BYTES);
      const decoded=decodePelContinuation(bytes,{sourceDigest:binding.sourceDigest,profileDigest:binding.languageProfileDigest,registryDigest:binding.registryDigest,optionsDigest:expired?child.optionsDigest:binding.optionsDigest});
      if(!decoded.ok) return yield* Effect.fail(pelRunnerFailure('continuation-incompatible',decoded.error.message));
      if(expired)for(const id of decoded.value.mergedChildren)restoredMergedChildren.add(id);
      for(const {request} of Object.values(decoded.value.pending)) {
        if(expired)requestSpans.set(request.requestId,nodeSpans.get(request.nodeId)??null);
        if(!child.retryContext)continue;
        const key=retryLogicalOperationKey(child.retryContext.parentRequestId,request.invocationPath);
        const identity=child.pending.find(item=>item.effect.requestId===request.requestId)?.effect ?? stablePelEffectIdentity(binding,request.requestId,child.index-1);
        operations.set(key,identity.effectId);
      }
    }
    const initial=expired?null:activation.kind==='evaluated'?activation.step:activation.kind==='fresh'?startPel(checked.program,createPelEnvironment(context.registry),binding.limits.pel,binding.options):resumePel(checked.program,context.registry,activation.continuation,activation.receipts,binding.options);
    latestCounters=initial?.counters??(activation.kind==='recovered'?activation.continuation.counters:activation.kind==='evaluated'?activation.step.counters:{sourceBytes:checked.program.sourceBytes,tokens:checked.program.tokens,astNodes:checked.program.astNodes,syntaxDepthPeak:checked.program.syntaxDepthPeak,reductions:0,iterations:0,callDepthPeak:0,valueBytesPeak:0});
    const evaluation=initial===null?Effect.fail(pelRunnerFailure('budget-exhausted','The original run deadline has elapsed')):Effect.scoped(drivePelEvaluation(initial,{
      persist:step=>Effect.gen(function* () {
        latestCounters=step.counters;
        for(const request of step.ready) if(!pending.has(request.requestId)) yield* requestMapping(request,step.continuation,hostContext(request));
        yield* persistPelSuspension(binding,step.continuation,[...pending.values()],children);
      }),
      dispatch:(request,parent)=>dispatch(request,hostContext(request),parent),
    }));
    const signal=yield* Deferred.make<void>();
    yield* Effect.acquireRelease(Effect.sync(()=>{cancellationSignals.set(binding.runId,signal);}),()=>Effect.sync(()=>{cancellationSignals.delete(binding.runId);}));
    const cancellation=Effect.gen(function* () {
      while(true) {
        const records=yield* readPelRecords(binding.runId);
        if(records.some(record=>record.type==='pel.cancel.v1')) return;
        yield* Effect.raceFirst(runtime.clock.sleep(100),Deferred.await(signal));
        if(yield* Deferred.isDone(signal)) return;
      }
    });
    const result=yield* Effect.raceFirst(evaluation.pipe(Effect.map(value=>({kind:'evaluation' as const,value})),Effect.catchAll(error=>error.code==='budget-exhausted'?Effect.succeed({kind:'failure' as const,error}):Effect.fail(error))),cancellation.pipe(Effect.as({kind:'cancel' as const})));
    const durable=replayPelRun(yield* readPelRecords(binding.runId));
    if(!durable.ok) return yield* Effect.fail(durable.error);
    if(expired)for(const intent of durable.value.intents.values()){
      const observation=durable.value.observations.get(intent.effect.effectId);
      pending.set(intent.effect.requestId,{effect:intent.effect,argumentsRef:intent.argumentsRef,expectedResultSchemaId:intent.expectedResultSchemaId,reservation:intent.reservation,observationRef:observation?.observationRef??null,providerIdentity:observation?.providerIdentity??null});
    }
    for(const [requestId,item] of pending) {
      const observation=durable.value.observations.get(item.effect.effectId);
      if(durable.value.results.has(item.effect.effectId)||observation?.externalOutcome==='confirmed-cancelled'||(!durable.value.intents.has(item.effect.effectId)&&(result.kind==='cancel'||result.kind==='failure'||children.some(child=>child.phase==='abandoned'&&child.pending.some(effect=>effect.effect.requestId===requestId))))) pending.delete(requestId);
    }
    const externalOutcome=[...pending.values()].some(item=>durable.value.intents.has(item.effect.effectId)&&!['none','confirmed-complete','confirmed-cancelled'].includes(durable.value.observations.get(item.effect.effectId)?.externalOutcome??'unknown'))?'unknown' as const:'none' as const;
    const counters={...(result.kind==='evaluation'?result.value.step.counters:latestCounters)};
    for(const child of children) {
      if(restoredMergedChildren.has(child.childInvocationId)||parentContinuations.get(child.parentRequestId)?.mergedChildren.includes(child.childInvocationId)) continue;
      for(const key of ['reductions','iterations'] as const) counters[key]+=child.consumed[key];
      for(const key of ['syntaxDepthPeak','callDepthPeak','valueBytesPeak'] as const) counters[key]=Math.max(counters[key],child.consumed[key]);
    }
    const now=yield* runtime.clock.now;
    const base={schemaVersion:1 as const,runId:binding.runId,updatedAt:now,programDigest:binding.checkedProgramDigest,attempt:binding.attempt,artifacts:[...new Map([...durable.value.results.values()].map(result=>[result.receiptRef.artifactId,result.receiptRef])).values()],receipts:[...durable.value.results.values()].map(result=>({effectId:result.effect.effectId,sequence:result.sequence,sha256:result.resultHash})),outputs:[...durable.value.outputs],usage:{observed:yield* projectPelProviderUsage(binding),reservedCostUsd:pending.size?binding.limits.maxCostUsd:0,unresolvedEffectIds:[...pending.values()].map(item=>item.effect.effectId),counters}};
    let final:RunResultV1;
    if(result.kind==='cancel') {
      const unresolved=[...durable.value.intents.values()].filter(intent=>!durable.value.results.has(intent.effect.effectId)&&!['confirmed-cancelled','confirmed-complete','none'].includes(durable.value.observations.get(intent.effect.effectId)?.externalOutcome??'unknown'));
      const unknown=unresolved.length>0;
      const diagnostics:PelRunDiagnosticV1[]=unknown?unresolved.map(intent=>({code:'unknown-external-outcome',message:'Local cancellation finished, but the external operation has no confirmed final outcome.',sourceSpan:requestSpans.get(intent.effect.requestId)??null,effectId:intent.effect.effectId,retryable:false,nextAction:'Reconcile the recorded external operation before resuming this run.',evidenceRefs:durable.value.observations.get(intent.effect.effectId)?[durable.value.observations.get(intent.effect.effectId)!.observationRef]:[]})):[{code:'run-cancelled',message:'The run was cancelled and local cleanup finished.',sourceSpan:null,effectId:null,retryable:false,nextAction:'Inspect the durable run outputs before starting another run.',evidenceRefs:[]}];
      final=unknown?{...base,state:'needs-action',resumeMode:'pending-effect',externalOutcome:'unknown',finalValue:null,diagnostics}:{...base,state:'cancelled',externalOutcome:'none',finalValue:null,diagnostics};
    } else if(result.kind==='failure') {
      const diagnostic:PelRunDiagnosticV1={...result.error.diagnostic,nextAction:externalOutcome==='unknown'?'Reconcile the remaining external effects before starting further work.':'Inspect the exhausted original allowance and durable run evidence.'};
      final=externalOutcome==='unknown'?{...base,state:'needs-action',resumeMode:'pending-effect',externalOutcome,finalValue:null,diagnostics:[diagnostic]}:{...base,state:'failed',externalOutcome,finalValue:null,diagnostics:[diagnostic]};
    } else {
      const step=result.value.step;
      if(step.tag==='suspend') final={...base,state:'needs-action',resumeMode:'pending-effect',externalOutcome,finalValue:null,diagnostics:waitingOutcomes.map(outcome=>({code:outcome.reason,message:outcome.reason==='authority-required'?'The provider requires authority before dispatch can continue.':externalOutcome==='none'?'The host requires reconciliation before evaluation can continue.':'The external operation needs a durable observation before evaluation can continue.',sourceSpan:requestSpans.get(outcome.pendingRequestId)??null,effectId:pending.get(outcome.pendingRequestId)?.effect.effectId??null,retryable:false,nextAction:outcome.reason==='authority-required'?'Restore the existing provider authority, then resume this run.':externalOutcome==='none'?'Inspect the recorded host requirement and supply its existing authority before resuming.':'Reconcile the recorded external operation, then resume this run.',evidenceRefs:[outcome.observationRef]}))};
      else if(step.tag==='failed') {
        const continuationRef=yield* persistPelContinuation(binding,step.continuation);
        const diagnosticRef=yield* putPelRunData(binding,step.diagnostic);
        yield* appendPelRecord(binding,'pel.failed-step.v1',{continuationRef,counters:step.counters,optionsDigest:binding.optionsDigest,diagnosticRef});
        const diagnostic:PelRunDiagnosticV1={code:step.diagnostic.hostFailure?.code??step.diagnostic.code,message:step.diagnostic.message,sourceSpan:step.diagnostic.span,effectId:null,retryable:false,nextAction:'Inspect the source diagnostic and durable effect evidence',evidenceRefs:[diagnosticRef]};
        final=diagnostic.code==='cancelled'?(externalOutcome==='unknown'?{...base,state:'needs-action',resumeMode:'pending-effect',externalOutcome,finalValue:null,diagnostics:[{...diagnostic,nextAction:'Reconcile the remaining external effects before resuming this cancelled run.'}]}:{...base,state:'cancelled',externalOutcome,finalValue:null,diagnostics:[diagnostic]}):{...base,state:'failed',externalOutcome,finalValue:null,diagnostics:[diagnostic]};
      } else {
        const value=isPelDataValue(step.value)?step.value:null;
        const classified=value===null?{state:'failed' as const,diagnostics:[{code:'final-result-invalid',message:'The program returned a closure or syntax instead of ordinary data',sourceSpan:null,effectId:null,retryable:false,nextAction:'Return an ordinary value matching the declared schema',evidenceRefs:[]}]}:classifyPelFinalResult({binding,value,registry:context.registry,hostEvidence:yield* runtime.hostEvidence(binding),externalOutcome,pendingEffects:pending.size,now,...(checked.program.expressions.at(-1)?{sourceSpan:checked.program.expressions.at(-1)!.span}:{})});
        final=classified.state==='needs-action'?{...base,...classified,state:'needs-action',resumeMode:classified.resumeMode??'final-value',externalOutcome,finalValue:value}:{...base,...classified,state:classified.state,externalOutcome,finalValue:value};
      }
    }
    // Persist the projection as immutable output; status does not execute a provider.
    const resultRef=yield* putPelRunData(binding,final);
    yield* appendPelRecord(binding,'pel.run-result.v1',{resultRef});
    return final;
  });
}
